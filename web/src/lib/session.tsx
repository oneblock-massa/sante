import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AppNotification, Role, User } from '../../../shared/types';

// Chaque module garde sa propre session : on peut ouvrir Patient, Infirmier et
// Admin dans trois onglets du même navigateur pour une démonstration complète.
const storageKey = (role: Role) => `kulawa.session.${role}`;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, token?: string | null, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? 'Erreur réseau', res.status);
  return data as T;
}

interface Toast {
  id: string;
  title: string;
  body: string;
}

interface SessionValue<U extends User = User> {
  role: Role;
  token: string | null;
  user: U | null;
  setSession: (token: string, user: U) => void;
  setUser: (u: U) => void;
  logout: () => void;
  api: <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
  socket: Socket | null;
  notifications: AppNotification[];
  unread: number;
  markRead: () => void;
  toasts: Toast[];
  dismissToast: (id: string) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ role, children }: { role: Role; children: ReactNode }) {
  const [state, setState] = useState<{ token: string | null; user: User | null }>(() => {
    try {
      const raw = localStorage.getItem(storageKey(role));
      if (raw) return JSON.parse(raw);
    } catch {
      /* stockage indisponible */
    }
    return { token: null, user: null };
  });
  const [socket, setSocket] = useState<Socket | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const tokenRef = useRef(state.token);
  tokenRef.current = state.token;

  const persist = useCallback(
    (next: { token: string | null; user: User | null }) => {
      setState(next);
      try {
        if (next.token) localStorage.setItem(storageKey(role), JSON.stringify(next));
        else localStorage.removeItem(storageKey(role));
      } catch {
        /* ignore */
      }
    },
    [role],
  );

  const logout = useCallback(() => persist({ token: null, user: null }), [persist]);

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit & { json?: unknown }) => {
      try {
        return await apiFetch<T>(path, tokenRef.current, init);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401 && tokenRef.current) logout();
        throw e;
      }
    },
    [logout],
  );

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Connexion temps réel
  useEffect(() => {
    if (!state.token) return;
    const s = io({ auth: { token: state.token }, transports: ['websocket', 'polling'] });
    s.on('notification', (n: AppNotification) => {
      setNotifications((list) => [n, ...list]);
      // Sur mobile, une seule bannière à la fois pour ne pas masquer l'écran.
      setToasts((t) => [...t.slice(role === 'admin' ? -2 : 0, role === 'admin' ? undefined : 0), { id: n.id, title: n.title, body: n.body }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), role === 'admin' ? 6000 : 4500);
      if ('vibrate' in navigator) navigator.vibrate?.(120);
    });
    s.on('connect_error', (err) => {
      if (err.message === 'unauthorized') logout();
    });
    setSocket(s);
    apiFetch<AppNotification[]>('/notifications', state.token).then(setNotifications).catch(() => {});
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [state.token, logout, role]);

  // Rafraîchit le profil au démarrage
  useEffect(() => {
    if (!state.token) return;
    apiFetch<User>('/me', state.token)
      .then((u) => persist({ token: state.token, user: u }))
      .catch((e) => e instanceof ApiError && e.status === 401 && logout());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.token]);

  const value = useMemo<SessionValue>(
    () => ({
      role,
      token: state.token,
      user: state.user,
      setSession: (token, user) => persist({ token, user }),
      setUser: (user) => persist({ token: tokenRef.current, user }),
      logout,
      api,
      socket,
      notifications,
      unread: notifications.filter((n) => !n.read).length,
      markRead: () => {
        setNotifications((l) => l.map((n) => ({ ...n, read: true })));
        api('/notifications/read', { method: 'POST' }).catch(() => {});
      },
      toasts,
      dismissToast,
    }),
    [role, state, persist, logout, api, socket, notifications, toasts, dismissToast],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession<U extends User = User>() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession hors SessionProvider');
  return ctx as unknown as SessionValue<U>;
}

/** S'abonne à un événement socket tant que le composant est monté. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const { socket } = useSession();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => {
      socket.off(event, fn);
    };
  }, [socket, event]);
}

/** Charge une ressource et expose un rechargement. */
export function useResource<T>(path: string | null, deps: unknown[] = []) {
  const { api } = useSession();
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const reload = useCallback(() => {
    if (!path) return Promise.resolve();
    setLoading(true);
    return api<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path, ...deps]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, setData, error, loading, reload };
}
