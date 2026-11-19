import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, type Socket } from 'socket.io-client';
import type { AppNotification, Role, User } from '../../shared/types';

// URL du serveur Kulawa. Sur téléphone, utilisez l'adresse IP de l'ordinateur
// (ex. http://192.168.1.20:4000) — modifiable depuis l'écran d'accueil.
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const KEY = 'kulawa.mobile.session';
const URL_KEY = 'kulawa.mobile.apiUrl';

interface Stored {
  role: Role;
  token: string;
  user: User;
}

interface Toast {
  id: string;
  title: string;
  body: string;
}

interface SessionValue {
  ready: boolean;
  apiUrl: string;
  setApiUrl: (u: string) => void;
  session: Stored | null;
  user: User | null;
  role: Role | null;
  signIn: (role: Role, token: string, user: User) => void;
  setUser: (u: User) => void;
  logout: () => void;
  api: <T>(path: string, init?: { method?: string; json?: unknown }) => Promise<T>;
  socket: Socket | null;
  notifications: AppNotification[];
  unread: number;
  markRead: () => void;
  toast: Toast | null;
  dismissToast: () => void;
}

const Ctx = createContext<SessionValue | null>(null);

export async function rawApi<T>(base: string, path: string, token?: string | null, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/api${path}`, {
      method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch {
    throw Object.assign(new Error(`Serveur injoignable (${base}). Vérifiez l'adresse du serveur.`), { status: 0 });
  }
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error((data as { error?: string })?.error ?? 'Erreur réseau'), { status: res.status });
  return data as T;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [apiUrl, setApiUrlState] = useState(DEFAULT_API_URL);
  const [session, setSession] = useState<Stored | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const ref = useRef({ apiUrl, token: session?.token });
  ref.current = { apiUrl, token: session?.token };

  useEffect(() => {
    (async () => {
      try {
        const [raw, url] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(URL_KEY)]);
        if (url) setApiUrlState(url);
        if (raw) setSession(JSON.parse(raw));
      } catch {
        /* stockage indisponible */
      }
      setReady(true);
    })();
  }, []);

  const persist = useCallback((next: Stored | null) => {
    setSession(next);
    (next ? AsyncStorage.setItem(KEY, JSON.stringify(next)) : AsyncStorage.removeItem(KEY)).catch(() => {});
  }, []);

  const logout = useCallback(() => {
    persist(null);
    setNotifications([]);
  }, [persist]);

  const api = useCallback(
    async <T,>(path: string, init?: { method?: string; json?: unknown }) => {
      try {
        return await rawApi<T>(ref.current.apiUrl, path, ref.current.token, init);
      } catch (e) {
        if ((e as { status?: number }).status === 401) logout();
        throw e;
      }
    },
    [logout],
  );

  useEffect(() => {
    if (!session?.token) return;
    const sock = io(apiUrl, { auth: { token: session.token }, transports: ['websocket'] });
    let timer: ReturnType<typeof setTimeout> | undefined;
    sock.on('notification', (n: AppNotification) => {
      setNotifications((l) => [n, ...l]);
      setToast({ id: n.id, title: n.title, body: n.body });
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 4500);
    });
    sock.on('connect_error', (err) => err.message === 'unauthorized' && logout());
    setSocket(sock);
    rawApi<AppNotification[]>(apiUrl, '/notifications', session.token).then(setNotifications).catch(() => {});
    rawApi<User>(apiUrl, '/me', session.token)
      .then((u) => persist({ ...session, user: u }))
      .catch((e) => e.status === 401 && logout());
    return () => {
      clearTimeout(timer);
      sock.disconnect();
      setSocket(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, apiUrl]);

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      apiUrl,
      setApiUrl: (u) => {
        const clean = u.trim().replace(/\/$/, '');
        setApiUrlState(clean);
        AsyncStorage.setItem(URL_KEY, clean).catch(() => {});
      },
      session,
      user: session?.user ?? null,
      role: session?.role ?? null,
      signIn: (role, token, user) => persist({ role, token, user }),
      setUser: (user) => session && persist({ ...session, user }),
      logout,
      api,
      socket,
      notifications,
      unread: notifications.filter((n) => !n.read).length,
      markRead: () => {
        setNotifications((l) => l.map((n) => ({ ...n, read: true })));
        api('/notifications/read', { method: 'POST' }).catch(() => {});
      },
      toast,
      dismissToast: () => setToast(null),
    }),
    [ready, apiUrl, session, persist, logout, api, socket, notifications, toast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession hors SessionProvider');
  return v;
}

export function useSocketEvent<T>(event: string, handler: (p: T) => void) {
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
