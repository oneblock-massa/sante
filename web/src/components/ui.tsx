import { useState, type ReactNode } from 'react';
import { useSession } from '../lib/session';
import type { RequestStatus } from '../../../shared/types';
import { STATUS_LABELS } from '../../../shared/types';

export function Stars({ value, onChange, size = 28 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <div className="stars" role={onChange ? 'radiogroup' : undefined} aria-label={`${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={!onChange}
          aria-label={`${i} étoile${i > 1 ? 's' : ''}`}
          className={i <= Math.round(value) ? 'star on' : 'star'}
          style={{ fontSize: size }}
          onClick={() => onChange?.(i)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function Spinner({ size = 48 }: { size?: number }) {
  return <div className="spinner" style={{ width: size, height: size }} />;
}

export function Toasts() {
  const { toasts, dismissToast } = useSession();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className="toast" onClick={() => dismissToast(t.id)}>
          <strong>{t.title}</strong>
          <span>{t.body}</span>
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge st-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function Avatar({ name, size = 44 }: { name?: string; size?: number }) {
  const ini = (name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {ini}
    </div>
  );
}

export function ErrorText({ error }: { error?: string | null }) {
  return error ? <p className="error">{error}</p> : null;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Bouton qui gère son propre état de chargement et d'erreur. */
export function AsyncButton({
  onClick,
  children,
  className = 'btn',
  disabled,
  type = 'button',
}: {
  onClick: () => Promise<unknown>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type={type}
        className={className}
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onClick();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : children}
      </button>
      <ErrorText error={error} />
    </>
  );
}

export function NotificationList() {
  const { notifications } = useSession();
  if (!notifications.length) return <p className="muted center">Aucune notification pour le moment.</p>;
  return (
    <ul className="notif-list">
      {notifications.map((n) => (
        <li key={n.id} className={n.read ? '' : 'unread'}>
          <strong>{n.title}</strong>
          <span>{n.body}</span>
          <small>
            {new Date(n.createdAt).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })} ·{' '}
            {n.channels.join(' + ')}
          </small>
        </li>
      ))}
    </ul>
  );
}
