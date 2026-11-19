import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { CareRequest, NurseProfile } from '../../../shared/types';
import { ACTIVE_STATUSES, formatFCFA } from '../../../shared/types';
import { SessionProvider, apiFetch, useResource, useSession, useSocketEvent } from '../lib/session';
import { AsyncButton, Avatar, ErrorText, NotificationList, Spinner, Stars, StatusBadge, Toasts } from '../components/ui';
import { MapView, type MapMarker } from '../components/MapView';
import { fmtDate, getPosition } from '../lib/util';
import { ChatSheet, IncidentSheet } from '../patient/PatientApp';
import { NurseDocuments, missingDocs } from '../components/Documents';

type Offer = CareRequest & { distanceKm?: number; nurseShare: number };
interface Earnings {
  today: number;
  week: number;
  month: number;
  total: number;
  count: number;
  rating: number;
  ratingCount: number;
  recent: { id: string; code: string; serviceName: string; patientName: string; amount: number; paidAt: string; rating?: { stars: number; comment?: string } }[];
}

export default function NurseApp() {
  return (
    <SessionProvider role="nurse">
      <NurseRoutes />
    </SessionProvider>
  );
}

function NurseRoutes() {
  const { token } = useSession();
  if (!token) return <NurseLogin />;
  return (
    <div className="app-shell nurse">
      <Toasts />
      <Routes>
        <Route index element={<Availability />} />
        <Route path="offre/:id" element={<OfferDetail />} />
        <Route path="intervention/:id" element={<Intervention />} />
        <Route path="gains" element={<EarningsScreen />} />
        <Route path="profil" element={<ProfileDocs />} />
        <Route path="*" element={<Navigate to="/infirmier" replace />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

function BottomNav() {
  const { unread } = useSession();
  const loc = useLocation();
  if (/\/(offre|intervention)/.test(loc.pathname)) return null;
  return (
    <nav className="bottom-nav">
      <NavLink to="/infirmier" end>
        <span>📡</span>Demandes
      </NavLink>
      <NavLink to="/infirmier/gains">
        <span>💰</span>Gains
      </NavLink>
      <NavLink to="/infirmier/profil">
        <span>🪪</span>Profil{unread > 0 && <i className="dot">{unread}</i>}
      </NavLink>
    </nav>
  );
}

function TopBar({ title, back }: { title: string; back?: string }) {
  const nav = useNavigate();
  return (
    <header className="topbar">
      {back ? (
        <button className="icon-btn" onClick={() => nav(back)} aria-label="Retour">
          ←
        </button>
      ) : (
        <span className="brand-mini">Kulawa Pro</span>
      )}
      <h1>{title}</h1>
      <span style={{ width: 36 }} />
    </header>
  );
}

// 01 — Connexion ----------------------------------------------------------------------
function NurseLogin() {
  const { setSession } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ phone: '', password: '', name: '', diplomaNumber: '', ordreNumber: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ token: string; user: never }>(mode === 'login' ? '/auth/nurse/login' : '/auth/nurse/register', null, { method: 'POST', json: form });
      setSession(r.token, r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell nurse">
      <div className="login">
        <div className="login-hero">
          <img src="/icon.svg" alt="" width={64} height={64} />
          <h1>Kulawa Pro</h1>
          <p>L'application des infirmiers partenaires.</p>
        </div>
        <form className="card stack" onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Nom complet
              <input value={form.name} onChange={set('name')} required />
            </label>
          )}
          <label>
            Téléphone
            <div className="phone-input">
              <span>+227</span>
              <input inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="90 00 00 01" required />
            </div>
          </label>
          <label>
            Mot de passe
            <input type="password" value={form.password} onChange={set('password')} required />
          </label>
          {mode === 'register' && (
            <>
              <label>
                N° de diplôme d'État
                <input value={form.diplomaNumber} onChange={set('diplomaNumber')} required />
              </label>
              <label>
                N° d'inscription à l'Ordre
                <input value={form.ordreNumber} onChange={set('ordreNumber')} required />
              </label>
            </>
          )}
          <ErrorText error={error} />
          <button className="btn" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Se connecter' : 'Envoyer ma candidature'}
          </button>
          {mode === 'login' && <p className="dev-hint">Démo : 90000001 / kulawa123</p>}
          <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Devenir infirmier partenaire' : "J'ai déjà un compte"}
          </button>
        </form>
      </div>
    </div>
  );
}

// 02 — Disponibilité + 03 — Notification reçue ------------------------------------------
function Availability() {
  const nav = useNavigate();
  const { user, setUser, api, notifications } = useSession<NurseProfile>();
  const coordination = notifications.filter((n) => n.event === 'admin_message').slice(0, 2);
  const offers = useResource<Offer[]>('/nurse/offers', [user?.available]);
  const mine = useResource<CareRequest[]>('/requests/mine');
  const earnings = useResource<Earnings>('/nurse/earnings');
  const [error, setError] = useState<string | null>(null);

  useSocketEvent<CareRequest>('offer:new', () => offers.reload());
  useSocketEvent<{ requestId: string }>('offer:withdrawn', ({ requestId }) => offers.setData((l) => l?.filter((o) => o.id !== requestId)));
  useSocketEvent<CareRequest>('request:update', () => mine.reload());
  useSocketEvent('notification', () => {
    earnings.reload();
    api<NurseProfile>('/me').then(setUser).catch(() => {});
  });

  const active = mine.data?.find((r) => ACTIVE_STATUSES.includes(r.status) && r.status !== 'paid');

  async function toggle() {
    setError(null);
    try {
      const pos = !user?.available ? await getPosition() : undefined;
      const u = await api<NurseProfile>('/nurse/availability', { method: 'POST', json: { available: !user?.available, ...pos } });
      setUser(u);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!user) return <Spinner />;
  return (
    <main className="screen">
      <TopBar title="Disponibilité" />
      {user.verification !== 'verified' && (
        <div className="warn-banner">
          {user.verification === 'pending'
            ? '⏳ Votre dossier est en cours de vérification (diplôme, Ordre, assurance). Vous serez notifié dès sa validation.'
            : '✕ Votre candidature a été refusée. Contactez la coordination Kulawa.'}
        </div>
      )}
      {missingDocs(user).length > 0 && (
        <button className="warn-banner clickable" onClick={() => nav('/infirmier/profil')}>
          📄 {missingDocs(user).length} document(s) à fournir : {missingDocs(user).map((d) => d.label).join(', ')} →
        </button>
      )}
      {coordination.map((m) => (
        <div key={m.id} className={`card coord ${m.read ? '' : 'unread'}`}>
          <small>Message de la coordination · {fmtDate(m.createdAt)}</small>
          <strong>{m.title.replace(/^📢\s*/, '')}</strong>
          <p>{m.body}</p>
        </div>
      ))}
      <div className={`card availability ${user.available ? 'on' : ''}`}>
        <div>
          <strong>{user.available ? 'Vous êtes disponible' : 'Vous êtes hors ligne'}</strong>
          <small>{user.available ? 'Vous recevez les demandes à proximité.' : 'Activez pour recevoir des demandes.'}</small>
        </div>
        <button className={`switch ${user.available ? 'on' : ''}`} onClick={toggle} disabled={user.verification !== 'verified'} aria-pressed={user.available} aria-label="Disponibilité">
          <span />
        </button>
      </div>
      <ErrorText error={error} />

      <div className="stats-row">
        <div>
          <small>Aujourd'hui</small>
          <strong>{formatFCFA(earnings.data?.today ?? 0)}</strong>
        </div>
        <div>
          <small>Note</small>
          <strong>★ {user.rating?.toFixed(1) ?? '—'}</strong>
        </div>
        <div>
          <small>Soins</small>
          <strong>{earnings.data?.count ?? 0}</strong>
        </div>
      </div>

      {active && (
        <button className="card active-card" onClick={() => nav(`/infirmier/intervention/${active.id}`)}>
          <div>
            <small>Intervention en cours · {active.code}</small>
            <strong>
              {active.serviceName} — {active.patientName}
            </strong>
            <StatusBadge status={active.status} />
          </div>
          <span className="chev">›</span>
        </button>
      )}

      {user.available && (
        <section>
          <h2 className="section-title">Demandes à proximité</h2>
          {offers.data?.length === 0 && (
            <div className="empty">
              <div className="pulse small">
                <span>📡</span>
              </div>
              <p className="muted">En attente de nouvelles demandes…</p>
            </div>
          )}
          <ul className="offers">
            {offers.data?.map((o) => (
              <li key={o.id}>
                <button className="card offer" onClick={() => nav(`/infirmier/offre/${o.id}`)}>
                  <div className="offer-head">
                    <span className="new">Nouvelle demande</span>
                    <span className="muted small">{o.distanceKm != null ? `${o.distanceKm} km · ~${o.etaMin} min` : ''}</span>
                  </div>
                  <strong>{o.serviceName}</strong>
                  <small>{o.address}</small>
                  <span className="gain">{formatFCFA(o.nurseShare)} pour vous</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

// 04 — Détail & Accepter ---------------------------------------------------------------
function OfferDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { api, user } = useSession<NurseProfile>();
  const { data: o, error } = useResource<Offer>(`/requests/${id}`);
  const [gone, setGone] = useState(false);
  useSocketEvent<{ requestId: string }>('offer:withdrawn', ({ requestId }) => requestId === id && setGone(true));
  const markers = useMemo(() => {
    if (!o) return [];
    const m: MapMarker[] = [{ id: 'p', lat: o.lat, lng: o.lng, kind: 'patient', label: o.patientName }];
    if (user?.lat != null && user.lng != null) m.push({ id: 'n', lat: user.lat, lng: user.lng, kind: 'nurse' as const, label: 'Vous' });
    return m;
  }, [o, user?.lat, user?.lng]);

  if (error) return <main className="screen"><TopBar title="Demande" back="/infirmier" /><ErrorText error={error} /></main>;
  if (!o) return <main className="screen center-screen"><Spinner /></main>;
  if (o.status !== 'searching' && o.nurseId === user?.id) return <Navigate to={`/infirmier/intervention/${o.id}`} replace />;

  return (
    <main className="screen">
      <TopBar title={`Demande ${o.code}`} back="/infirmier" />
      {gone || o.status !== 'searching' ? (
        <div className="warn-banner">Cette demande n'est plus disponible (prise en charge ou annulée).</div>
      ) : null}
      <MapView markers={markers} height={180} route />
      <div className="card stack">
        <div className="row-between">
          <strong className="lg">{o.serviceName}</strong>
          <span className="gain">{formatFCFA(o.nurseShare)}</span>
        </div>
        <span>👤 {o.patientName}</span>
        <span>📍 {o.address}</span>
        {o.distanceKm != null && (
          <span>
            🛵 {o.distanceKm} km · environ {o.etaMin} min
          </span>
        )}
        {o.notes && <p className="note">« {o.notes} »</p>}
        <small className="muted">
          Total patient {formatFCFA(o.total)} · commission Kulawa incluse · reçue {fmtDate(o.createdAt)}
        </small>
      </div>
      {!gone && o.status === 'searching' && (
        <div className="btn-row">
          <AsyncButton
            className="btn btn-lg"
            onClick={async () => {
              await api(`/requests/${o.id}/accept`, { method: 'POST' });
              nav(`/infirmier/intervention/${o.id}`, { replace: true });
            }}
          >
            Accepter
          </AsyncButton>
          <AsyncButton
            className="btn btn-lg btn-outline"
            onClick={async () => {
              await api(`/requests/${o.id}/decline`, { method: 'POST' });
              nav('/infirmier', { replace: true });
            }}
          >
            Refuser
          </AsyncButton>
        </div>
      )}
    </main>
  );
}

// 05 → 09 — Intervention pilotée par le statut ---------------------------------------------
function Intervention() {
  const { id } = useParams();
  const { data: r, setData, error } = useResource<CareRequest>(`/requests/${id}`);
  useSocketEvent<CareRequest>('request:update', (u) => u.id === id && setData(u));
  const [reporting, setReporting] = useState(false);

  if (error) return <main className="screen"><TopBar title="Intervention" back="/infirmier" /><ErrorText error={error} /></main>;
  if (!r) return <main className="screen center-screen"><Spinner /></main>;

  switch (r.status) {
    case 'assigned':
    case 'en_route':
      return <Navigation r={r} onUpdate={setData} />;
    case 'in_progress':
      return reporting ? <ReportForm r={r} onDone={setData} onBack={() => setReporting(false)} /> : <InProgress r={r} onFinish={() => setReporting(true)} />;
    case 'awaiting_payment':
      return <PaymentWait r={r} />;
    case 'paid':
    case 'rated':
      return <EarnedScreen r={r} />;
    case 'cancelled':
      return (
        <main className="screen">
          <TopBar title={r.code} back="/infirmier" />
          <div className="warn-banner">Cette intervention a été annulée.</div>
        </main>
      );
    default:
      return <Navigate to="/infirmier" replace />;
  }
}

/** Partage la position pendant le trajet. Sans GPS, simule un déplacement vers le patient (démo). */
function useLiveLocation(r: CareRequest, active: boolean) {
  const { api } = useSession();
  const last = useRef({ lat: r.nurseLat ?? r.lat + 0.02, lng: r.nurseLng ?? r.lng + 0.02 });
  useEffect(() => {
    if (!active) return;
    let watchId: number | undefined;
    let sim: ReturnType<typeof setInterval> | undefined;
    const send = (lat: number, lng: number) => {
      last.current = { lat, lng };
      api(`/requests/${r.id}/location`, { method: 'POST', json: { lat, lng } }).catch(() => {});
    };
    const simulate = () => {
      sim = setInterval(() => {
        const { lat, lng } = last.current;
        send(lat + (r.lat - lat) * 0.2, lng + (r.lng - lng) * 0.2);
      }, 4000);
    };
    if (navigator.geolocation) {
      let gotFix = false;
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          gotFix = true;
          send(p.coords.latitude, p.coords.longitude);
        },
        () => !sim && simulate(),
        { enableHighAccuracy: true },
      );
      setTimeout(() => !gotFix && !sim && simulate(), 5000);
    } else simulate();
    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (sim) clearInterval(sim);
    };
  }, [active, r.id, r.lat, r.lng, api]);
}

function Navigation({ r, onUpdate }: { r: CareRequest; onUpdate: (r: CareRequest) => void }) {
  const { api } = useSession();
  const [chat, setChat] = useState(false);
  useLiveLocation(r, r.status === 'en_route');
  const markers = useMemo(() => {
    const m: MapMarker[] = [{ id: 'p', lat: r.lat, lng: r.lng, kind: 'patient', label: r.patientName }];
    if (r.nurseLat != null && r.nurseLng != null) m.push({ id: 'n', lat: r.nurseLat, lng: r.nurseLng, kind: 'nurse' as const, label: 'Vous' });
    return m;
  }, [r.lat, r.lng, r.nurseLat, r.nurseLng, r.patientName]);
  const setStatus = async (status: string) => onUpdate(await api<CareRequest>(`/requests/${r.id}/status`, { method: 'POST', json: { status } }));

  return (
    <main className="screen">
      <TopBar title="Navigation" back="/infirmier" />
      <MapView markers={markers} route height={260} />
      <div className="card eta-card">
        <span>{r.status === 'en_route' ? 'Arrivée estimée' : 'Distance'}</span>
        <strong>{r.etaMin ?? '—'} min</strong>
      </div>
      <div className="card stack">
        <strong>
          {r.serviceName} — {r.patientName}
        </strong>
        <span>📍 {r.address}</span>
        {r.notes && <p className="note">« {r.notes} »</p>}
        <div className="btn-row">
          {r.patientPhone && (
            <a className="btn btn-outline" href={`tel:${r.patientPhone}`}>
              📞 Appeler
            </a>
          )}
          <a className="btn btn-outline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`}>
            🧭 Itinéraire
          </a>
        </div>
        <button className="btn btn-outline" onClick={() => setChat(true)}>
          Messages {r.messages.length > 0 && `(${r.messages.length})`}
        </button>
      </div>
      {r.status === 'assigned' ? (
        <AsyncButton className="btn btn-lg" onClick={() => setStatus('en_route')}>
          Je pars maintenant
        </AsyncButton>
      ) : (
        <AsyncButton className="btn btn-lg" onClick={() => setStatus('in_progress')}>
          Je suis arrivé(e) — commencer
        </AsyncButton>
      )}
      {chat && <ChatSheet r={r} onClose={() => setChat(false)} />}
    </main>
  );
}

function InProgress({ r, onFinish }: { r: CareRequest; onFinish: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [incident, setIncident] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - new Date(r.startedAt ?? r.createdAt).getTime()) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  return (
    <main className="screen">
      <TopBar title="Intervention en cours" back="/infirmier" />
      <div className="card center stack">
        <span className="timer">
          {mm}:{ss}
        </span>
        <strong>{r.serviceName}</strong>
        <span>{r.patientName}</span>
        {r.notes && <p className="note">« {r.notes} »</p>}
      </div>
      <button className="btn btn-lg" onClick={onFinish}>
        Terminer l'intervention
      </button>
      <button className="link danger" onClick={() => setIncident(true)}>
        Signaler un incident
      </button>
      {incident && <IncidentSheet requestId={r.id} onClose={() => setIncident(false)} />}
    </main>
  );
}

function ReportForm({ r, onDone, onBack }: { r: CareRequest; onDone: (r: CareRequest) => void; onBack: () => void }) {
  const { api } = useSession();
  const [f, setF] = useState({ acts: r.serviceName, bloodPressure: '', temperature: '', glycemia: '', observations: '', recommendations: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <main className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Retour">
          ←
        </button>
        <h1>Compte-rendu</h1>
        <span style={{ width: 36 }} />
      </header>
      <div className="stack">
        <label>
          Actes réalisés *
          <textarea rows={2} value={f.acts} onChange={set('acts')} />
        </label>
        <div className="grid-3">
          <label>
            Tension
            <input value={f.bloodPressure} onChange={set('bloodPressure')} placeholder="12/8" />
          </label>
          <label>
            Temp. °C
            <input inputMode="decimal" value={f.temperature} onChange={set('temperature')} placeholder="37.2" />
          </label>
          <label>
            Glycémie
            <input value={f.glycemia} onChange={set('glycemia')} placeholder="1.10 g/L" />
          </label>
        </div>
        <label>
          Observations
          <textarea rows={3} value={f.observations} onChange={set('observations')} />
        </label>
        <label>
          Recommandations au patient
          <textarea rows={2} value={f.recommendations} onChange={set('recommendations')} />
        </label>
        <AsyncButton className="btn btn-lg" disabled={!f.acts.trim()} onClick={async () => onDone(await api<CareRequest>(`/requests/${r.id}/report`, { method: 'POST', json: f }))}>
          Envoyer
        </AsyncButton>
      </div>
    </main>
  );
}

function PaymentWait({ r }: { r: CareRequest }) {
  return (
    <main className="screen center-screen">
      <TopBar title="Confirmation de paiement" back="/infirmier" />
      <Spinner size={56} />
      <h2>En attente du paiement</h2>
      <p className="muted">
        {r.patientName} doit régler {formatFCFA(r.total)}. Vous serez notifié dès la confirmation.
      </p>
      <p className="muted small">Si le patient paie en espèces, il confirme la remise dans son application.</p>
    </main>
  );
}

function EarnedScreen({ r }: { r: CareRequest }) {
  const nav = useNavigate();
  return (
    <main className="screen">
      <TopBar title="Gains & note" back="/infirmier" />
      <div className="success-banner">✓ Paiement reçu · {r.payment?.reference}</div>
      <div className="card center stack">
        <small className="muted">Votre gain pour cette intervention</small>
        <span className="big-amount">{formatFCFA(r.payment?.nurseShare ?? 0)}</span>
        <small className="muted">
          Total {formatFCFA(r.total)} − commission Kulawa {formatFCFA(r.payment?.commission ?? 0)}
        </small>
      </div>
      <div className="card center stack">
        {r.rating ? (
          <>
            <strong>Évaluation de {r.patientName}</strong>
            <Stars value={r.rating.stars} />
            {r.rating.comment && <p className="note">« {r.rating.comment} »</p>}
          </>
        ) : (
          <>
            <Stars value={0} />
            <p className="muted">En attente de l'évaluation du patient…</p>
          </>
        )}
      </div>
      <button className="btn btn-lg" onClick={() => nav('/infirmier')}>
        Retour aux demandes
      </button>
    </main>
  );
}

// Gains -----------------------------------------------------------------------------
function EarningsScreen() {
  const { data } = useResource<Earnings>('/nurse/earnings');
  if (!data) return <main className="screen center-screen"><Spinner /></main>;
  return (
    <main className="screen">
      <TopBar title="Mes gains" />
      <div className="card center stack">
        <small className="muted">Ce mois-ci</small>
        <span className="big-amount">{formatFCFA(data.month)}</span>
      </div>
      <div className="stats-row">
        <div>
          <small>Aujourd'hui</small>
          <strong>{formatFCFA(data.today)}</strong>
        </div>
        <div>
          <small>7 jours</small>
          <strong>{formatFCFA(data.week)}</strong>
        </div>
        <div>
          <small>Note</small>
          <strong>
            ★ {data.rating.toFixed(1)} <small>({data.ratingCount})</small>
          </strong>
        </div>
      </div>
      <h2 className="section-title">Dernières interventions</h2>
      {data.recent.length === 0 && <p className="muted center">Aucune intervention payée pour le moment.</p>}
      <ul className="list">
        {data.recent.map((x) => (
          <li key={x.id}>
            <div className="li">
              <div>
                <strong>{x.serviceName}</strong>
                <small>
                  {x.patientName} · {fmtDate(x.paidAt)}
                </small>
              </div>
              <div className="right">
                <span className="gain">+{formatFCFA(x.amount)}</span>
                {x.rating && <small>{'★'.repeat(x.rating.stars)}</small>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

// Profil & documents -------------------------------------------------------------------
function ProfileDocs() {
  const { user, setUser, api, logout, markRead, unread } = useSession<NurseProfile>();
  useSocketEvent('notification', () => api<NurseProfile>('/me').then(setUser).catch(() => {}));
  const [tab, setTab] = useState<'profil' | 'notifs'>(unread ? 'notifs' : 'profil');
  useEffect(() => {
    if (tab === 'notifs' && unread) markRead();
  }, [tab, unread, markRead]);
  if (!user) return null;
  return (
    <main className="screen">
      <TopBar title="Profil & documents" />
      <div className="seg">
        <button className={tab === 'profil' ? 'on' : ''} onClick={() => setTab('profil')}>
          Profil
        </button>
        <button className={tab === 'notifs' ? 'on' : ''} onClick={() => setTab('notifs')}>
          Notifications {unread > 0 && `(${unread})`}
        </button>
      </div>
      {tab === 'notifs' ? (
        <NotificationList />
      ) : (
        <div className="stack">
          <div className="card row">
            <Avatar name={user.name} />
            <div>
              <strong>{user.name}</strong>
              <small className="muted">{user.phone}</small>
              <span className={`badge ver-${user.verification}`}>
                {user.verification === 'verified' ? '✓ Vérifié' : user.verification === 'pending' ? 'En vérification' : 'Refusé'}
              </span>
            </div>
          </div>
          <div className="card">
            <div className="kv">
              <span>Diplôme d'État</span>
              <span>{user.diplomaNumber || '—'}</span>
            </div>
            <div className="kv">
              <span>Ordre national</span>
              <span>{user.ordreNumber || '—'}</span>
            </div>
            <div className="kv">
              <span>Note moyenne</span>
              <span>
                ★ {user.rating?.toFixed(1)} ({user.ratingCount})
              </span>
            </div>
          </div>
          <NurseDocuments />
          <button className="link danger" onClick={logout}>
            Se déconnecter
          </button>
        </div>
      )}
    </main>
  );
}
