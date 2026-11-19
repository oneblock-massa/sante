import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import type { AppNotification, CareRequest, Incident, NurseProfile, PaymentMethod, Service, Settings, User } from '../../../shared/types';
import { PAYMENT_LABELS, STATUS_LABELS, formatFCFA } from '../../../shared/types';
import { SessionProvider, apiFetch, useResource, useSession, useSocketEvent } from '../lib/session';
import { AsyncButton, Avatar, ErrorText, Spinner, Stars, StatusBadge, Toasts } from '../components/ui';
import { MapView, type MapMarker } from '../components/MapView';
import { downloadWithToken, fmtDate, timeAgo } from '../lib/util';

// Compteur incrémenté à chaque événement temps réel : les pages s'en servent pour se rafraîchir.
const TickContext = createContext(0);
const useTick = () => useContext(TickContext);

export default function AdminApp() {
  return (
    <SessionProvider role="admin">
      <AdminRoot />
    </SessionProvider>
  );
}

function AdminRoot() {
  const { token } = useSession();
  if (!token) return <AdminLogin />;
  return <AdminLayout />;
}

function AdminLogin() {
  const { setSession } = useSession();
  const [email, setEmail] = useState('admin@kulawa.ne');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="admin-login">
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const r = await apiFetch<{ token: string; user: User }>('/auth/admin/login', null, { method: 'POST', json: { email, password } });
            setSession(r.token, r.user);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="login-hero">
          <img src="/icon.svg" alt="" width={56} height={56} />
          <h1>Kulawa Back-office</h1>
          <p>Coordination infirmière</p>
        </div>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Mot de passe
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <ErrorText error={error} />
        <button className="btn">Se connecter</button>
        <p className="dev-hint">Démo : admin@kulawa.ne / admin123</p>
      </form>
    </div>
  );
}

function AdminLayout() {
  const { user, logout, notifications } = useSession();
  const [tick, setTick] = useState(0);
  const [menu, setMenu] = useState(false);
  const bump = () => setTick((t) => t + 1);
  useSocketEvent('request:update', bump);
  useSocketEvent('notification', bump);
  const alerts = notifications.filter((n) => !n.read && n.channels.includes('alert')).length;

  const links = [
    ['', '📊', 'Tableau de bord'],
    ['demandes', '📥', 'File des demandes'],
    ['interventions', '🛵', 'Suivi des interventions'],
    ['transactions', '💳', 'Transactions'],
    ['qualite', '⚠️', 'Incidents & qualité'],
    ['infirmiers', '🩺', 'Infirmiers'],
    ['patients', '👥', 'Patients'],
    ['notifications', '🔔', 'Notifications'],
    ['parametres', '⚙️', 'Tarifs & paramètres'],
  ];

  return (
    <TickContext.Provider value={tick}>
      <div className="admin">
        <Toasts />
        <aside className={`sidebar ${menu ? 'open' : ''}`} onClick={() => setMenu(false)}>
          <div className="sidebar-brand">
            <img src="/icon.svg" alt="" width={32} height={32} />
            <div>
              <strong>Kulawa</strong>
              <small>Back-office</small>
            </div>
          </div>
          <nav>
            {links.map(([to, ic, label]) => (
              <NavLink key={to} to={`/admin${to ? `/${to}` : ''}`} end={!to}>
                <span>{ic}</span>
                {label}
                {to === 'qualite' && alerts > 0 && <i className="dot">{alerts}</i>}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-foot">
            <small>{user?.name}</small>
            <button className="link" onClick={logout}>
              Déconnexion
            </button>
          </div>
        </aside>
        <div className="admin-main">
          <button className="menu-btn" onClick={() => setMenu(true)} aria-label="Menu">
            ☰ Menu
          </button>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="demandes" element={<Queue />} />
            <Route path="demandes/:id" element={<RequestDetail />} />
            <Route path="interventions" element={<Tracking />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="qualite" element={<Quality />} />
            <Route path="infirmiers" element={<Nurses />} />
            <Route path="patients" element={<Patients />} />
            <Route path="notifications" element={<NotificationsLog />} />
            <Route path="parametres" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </div>
    </TickContext.Provider>
  );
}

function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      <div className="actions">{children}</div>
    </header>
  );
}

// 02 — Tableau de bord -----------------------------------------------------------------
interface DashboardData {
  requestsToday: number;
  searching: number;
  active: number;
  completedToday: number;
  revenueToday: number;
  commissionToday: number;
  revenueTotal: number;
  commissionTotal: number;
  nursesOnline: number;
  nursesVerified: number;
  nursesPending: number;
  patients: number;
  avgRating: number | null;
  openIncidents: number;
  byService: { name: string; count: number }[];
  days: { day: string; revenue: number; count: number }[];
  recent: CareRequest[];
}

function Dashboard() {
  const tick = useTick();
  const nav = useNavigate();
  const { data } = useResource<DashboardData>('/admin/dashboard', [tick]);
  const { api } = useSession();
  if (!data) return <Spinner />;
  const maxRev = Math.max(1, ...data.days.map((d) => d.revenue));
  const maxSvc = Math.max(1, ...data.byService.map((s) => s.count));
  return (
    <>
      <PageHead title="Tableau de bord" sub={new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
        <AsyncButton
          className="btn btn-outline small"
          onClick={async () => {
            if (!confirm('Réinitialiser toutes les données de démonstration ?')) return;
            await api('/demo/reset', { method: 'POST' });
            location.reload();
          }}
        >
          Réinitialiser la démo
        </AsyncButton>
      </PageHead>
      <div className="kpis">
        <Kpi label="Demandes aujourd'hui" value={data.requestsToday} />
        <Kpi label="En attente d'infirmier" value={data.searching} tone={data.searching ? 'warn' : undefined} onClick={() => nav('/admin/demandes')} />
        <Kpi label="Interventions actives" value={data.active} onClick={() => nav('/admin/interventions')} />
        <Kpi label="Infirmiers en ligne" value={`${data.nursesOnline} / ${data.nursesVerified}`} />
        <Kpi label="CA du jour" value={formatFCFA(data.revenueToday)} />
        <Kpi label="Commission du jour" value={formatFCFA(data.commissionToday)} tone="good" />
        <Kpi label="Note moyenne" value={data.avgRating ? `★ ${data.avgRating}` : '—'} />
        <Kpi label="Incidents ouverts" value={data.openIncidents} tone={data.openIncidents ? 'bad' : undefined} onClick={() => nav('/admin/qualite')} />
      </div>
      <div className="panels">
        <section className="panel">
          <h2>Chiffre d'affaires — 7 derniers jours</h2>
          <div className="bars">
            {data.days.map((d) => (
              <div key={d.day} className="bar-col" title={`${formatFCFA(d.revenue)} · ${d.count} soin(s)`}>
                <span className="bar-val">{d.revenue ? `${Math.round(d.revenue / 1000)}k` : ''}</span>
                <div className="bar" style={{ height: `${(d.revenue / maxRev) * 100}%` }} />
                <small>{new Date(d.day).toLocaleDateString('fr-FR', { weekday: 'short' })}</small>
              </div>
            ))}
          </div>
          <p className="muted small">
            Total cumulé : {formatFCFA(data.revenueTotal)} · commission {formatFCFA(data.commissionTotal)}
          </p>
        </section>
        <section className="panel">
          <h2>Demandes par soin</h2>
          <ul className="hbars">
            {data.byService.map((s) => (
              <li key={s.name}>
                <span>{s.name}</span>
                <div>
                  <i style={{ width: `${(s.count / maxSvc) * 100}%` }} />
                </div>
                <b>{s.count}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="panel">
        <h2>Activité récente</h2>
        <RequestTable rows={data.recent} />
      </section>
      {data.nursesPending > 0 && (
        <button className="warn-banner clickable" onClick={() => nav('/admin/infirmiers')}>
          {data.nursesPending} candidature(s) infirmier en attente de vérification →
        </button>
      )}
    </>
  );
}

function Kpi({ label, value, tone, onClick }: { label: string; value: React.ReactNode; tone?: 'warn' | 'good' | 'bad'; onClick?: () => void }) {
  return (
    <button className={`kpi ${tone ?? ''}`} onClick={onClick} disabled={!onClick}>
      <small>{label}</small>
      <strong>{value}</strong>
    </button>
  );
}

function RequestTable({ rows, empty = 'Aucune demande.' }: { rows: CareRequest[]; empty?: string }) {
  const nav = useNavigate();
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Réf.</th>
            <th>Patient</th>
            <th>Soin</th>
            <th>Adresse</th>
            <th>Infirmier</th>
            <th>Montant</th>
            <th>Statut</th>
            <th>Créée</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => nav(`/admin/demandes/${r.id}`)} className="clickable">
              <td className="mono">{r.code}</td>
              <td>{r.patientName}</td>
              <td>{r.serviceName}</td>
              <td className="ellipsis">{r.address}</td>
              <td>{r.nurseName ?? '—'}</td>
              <td>{formatFCFA(r.total)}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>{timeAgo(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 03 — File des demandes ------------------------------------------------------------------
function Queue() {
  const tick = useTick();
  const { data } = useResource<CareRequest[]>('/admin/requests?status=searching', [tick]);
  const all = useResource<CareRequest[]>('/admin/requests', [tick]);
  const [filter, setFilter] = useState('');
  const rows = (all.data ?? []).filter((r) => !filter || r.status === filter);
  return (
    <>
      <PageHead title="File des demandes" sub="Demandes en attente d'un infirmier — assignez manuellement si personne n'a accepté." />
      <section className="panel">
        <h2>En attente ({data?.length ?? 0})</h2>
        {data?.length === 0 && <p className="muted">Aucune demande en attente. 👌</p>}
        <div className="queue">
          {data?.map((r) => <QueueCard key={r.id} r={r} />)}
        </div>
      </section>
      <section className="panel">
        <div className="row-between">
          <h2>Toutes les demandes</h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <RequestTable rows={rows} />
      </section>
    </>
  );
}

function QueueCard({ r }: { r: CareRequest }) {
  const nav = useNavigate();
  const waitMin = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 60000);
  return (
    <div className={`queue-card ${waitMin >= 5 ? 'late' : ''}`}>
      <div className="row-between">
        <span className="mono">{r.code}</span>
        <span className="muted small">attente {waitMin} min</span>
      </div>
      <strong>{r.serviceName}</strong>
      <span>
        {r.patientName} · {r.patientPhone}
      </span>
      <small className="muted">{r.address}</small>
      {r.declinedBy.length > 0 && <small className="muted">Refusée par {r.declinedBy.length} infirmier(s)</small>}
      <button className="btn small" onClick={() => nav(`/admin/demandes/${r.id}`)}>
        Assigner un infirmier
      </button>
    </div>
  );
}

// 04 — Statut assigné / détail d'une demande -----------------------------------------------------
type Candidate = NurseProfile & { distanceKm: number | null; busy: boolean; declined: boolean };

function RequestDetail() {
  const { id } = useParams();
  const tick = useTick();
  const { api } = useSession();
  const { data: r, setData } = useResource<CareRequest>(`/requests/${id}`, [tick]);
  const cands = useResource<Candidate[]>(r?.status === 'searching' ? `/admin/requests/${id}/candidates` : null, [tick, r?.status]);
  const markers = useMemo(() => {
    if (!r) return [];
    const m: MapMarker[] = [{ id: 'p', lat: r.lat, lng: r.lng, kind: 'patient', label: r.patientName }];
    if (r.nurseLat != null && r.nurseLng != null && r.nurseId) m.push({ id: 'n', lat: r.nurseLat, lng: r.nurseLng, kind: 'nurse' as const, label: r.nurseName ?? '' });
    return m;
  }, [r]);
  if (!r) return <Spinner />;

  const timeline: [string, string | undefined][] = [
    ['Demande créée', r.createdAt],
    [r.assignedByAdmin ? 'Assignée par la coordination' : 'Acceptée par l’infirmier', r.assignedAt],
    ['Soin commencé', r.startedAt],
    ['Compte-rendu envoyé', r.completedAt],
    ['Paiement confirmé', r.payment?.paidAt],
    ['Évaluation reçue', r.rating?.at],
  ];
  if (r.cancelledAt) timeline.push(['Annulée', r.cancelledAt]);

  return (
    <>
      <PageHead title={`Demande ${r.code}`} sub={`${r.serviceName} · ${r.patientName}`}>
        <StatusBadge status={r.status} />
        {['searching', 'assigned', 'en_route'].includes(r.status) && (
          <AsyncButton
            className="btn btn-outline small"
            onClick={async () => {
              if (confirm('Annuler cette demande ?')) setData(await api<CareRequest>(`/requests/${r.id}/cancel`, { method: 'POST' }));
            }}
          >
            Annuler la demande
          </AsyncButton>
        )}
      </PageHead>
      <div className="panels">
        <section className="panel">
          <h2>Détails</h2>
          <div className="kv">
            <span>Patient</span>
            <span>
              {r.patientName} · {r.patientPhone}
            </span>
          </div>
          <div className="kv">
            <span>Adresse</span>
            <span>{r.address}</span>
          </div>
          <div className="kv">
            <span>Soin</span>
            <span>{r.serviceName}</span>
          </div>
          <div className="kv">
            <span>Montant</span>
            <span>
              {formatFCFA(r.total)} ({formatFCFA(r.price)} + {formatFCFA(r.travelFee)} déplacement)
            </span>
          </div>
          {r.notes && (
            <div className="kv">
              <span>Notes</span>
              <span>{r.notes}</span>
            </div>
          )}
          <div className="kv">
            <span>Infirmier</span>
            <span>{r.nurseName ? `${r.nurseName} · ${r.nursePhone}` : '—'}</span>
          </div>
          {r.etaMin != null && r.status === 'en_route' && (
            <div className="kv">
              <span>ETA</span>
              <span>{r.etaMin} min</span>
            </div>
          )}
          {r.payment && (
            <div className="kv">
              <span>Paiement</span>
              <span>
                {PAYMENT_LABELS[r.payment.method]} · {r.payment.reference} · commission {formatFCFA(r.payment.commission)}
              </span>
            </div>
          )}
          {r.rating && (
            <div className="kv">
              <span>Évaluation</span>
              <span>
                <Stars value={r.rating.stars} size={16} /> {r.rating.comment}
              </span>
            </div>
          )}
        </section>
        <section className="panel">
          <MapView markers={markers} height={260} route />
        </section>
      </div>

      {r.status === 'searching' && (
        <section className="panel">
          <h2>Assigner un infirmier</h2>
          {cands.loading && <Spinner />}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Infirmier</th>
                  <th>Distance</th>
                  <th>Note</th>
                  <th>État</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cands.data?.map((n) => (
                  <tr key={n.id}>
                    <td>
                      {n.name} <small className="muted">{n.phone}</small>
                    </td>
                    <td>{n.distanceKm != null ? `${n.distanceKm} km` : '—'}</td>
                    <td>★ {n.rating.toFixed(1)}</td>
                    <td>{n.busy ? <span className="badge st-in_progress">En intervention</span> : n.available ? <span className="badge ver-verified">Disponible</span> : <span className="badge">Hors ligne</span>}{n.declined && <span className="badge st-cancelled">A refusé</span>}</td>
                    <td>
                      <AsyncButton className="btn small" disabled={n.busy} onClick={async () => setData(await api<CareRequest>(`/admin/requests/${r.id}/assign`, { method: 'POST', json: { nurseId: n.id } }))}>
                        Assigner
                      </AsyncButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="panels">
        <section className="panel">
          <h2>Chronologie</h2>
          <ol className="timeline">
            {timeline.map(([label, at]) => (
              <li key={label} className={at ? 'done' : ''}>
                {label}
                {at && <small>{fmtDate(at)}</small>}
              </li>
            ))}
          </ol>
        </section>
        <section className="panel">
          <h2>Compte-rendu & messages</h2>
          {r.report ? (
            <>
              <p>
                <strong>Actes :</strong> {r.report.acts}
              </p>
              <p className="muted">
                {[r.report.bloodPressure && `TA ${r.report.bloodPressure}`, r.report.temperature && `T° ${r.report.temperature}`, r.report.glycemia && `Gly ${r.report.glycemia}`].filter(Boolean).join(' · ')}
              </p>
              {r.report.observations && <p>{r.report.observations}</p>}
              {r.report.recommendations && <p><em>{r.report.recommendations}</em></p>}
            </>
          ) : (
            <p className="muted">Pas encore de compte-rendu.</p>
          )}
          {r.messages.length > 0 && (
            <div className="chat compact">
              {r.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.from === 'nurse' ? 'me' : ''}`}>
                  <b>{m.from === 'nurse' ? 'Infirmier' : 'Patient'} :</b> {m.text}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// 05 — Suivi des interventions ------------------------------------------------------------------
function Tracking() {
  const tick = useTick();
  const { data } = useResource<CareRequest[]>('/admin/requests?status=searching,assigned,en_route,in_progress,awaiting_payment', [tick]);
  const nursesRes = useResource<(NurseProfile & { busy: boolean })[]>('/admin/nurses', [tick]);
  const markers = useMemo(() => {
    const m: { id: string; lat: number; lng: number; kind: 'patient' | 'nurse' | 'request'; label: string }[] = [];
    for (const r of data ?? []) m.push({ id: r.id, lat: r.lat, lng: r.lng, kind: r.status === 'searching' ? 'request' : 'patient', label: `${r.code} · ${r.serviceName}` });
    for (const n of nursesRes.data ?? []) if (n.available && n.lat != null && n.lng != null) m.push({ id: n.id, lat: n.lat, lng: n.lng, kind: 'nurse', label: n.name });
    return m;
  }, [data, nursesRes.data]);
  return (
    <>
      <PageHead title="Suivi des interventions" sub="Vue temps réel de toutes les interventions actives et des infirmiers en ligne." />
      <section className="panel">
        <MapView markers={markers} height={340} zoom={12} />
        <p className="legend">
          <span className="lg-dot nurse" /> Infirmier en ligne <span className="lg-dot request" /> Demande en attente <span className="lg-dot patient" /> Intervention en cours
        </p>
      </section>
      <section className="panel">
        <h2>Interventions actives ({data?.length ?? 0})</h2>
        <RequestTable rows={data ?? []} empty="Aucune intervention active." />
      </section>
    </>
  );
}

// 06 — Transactions -------------------------------------------------------------------------
interface Tx {
  requestId: string;
  code: string;
  patientName: string;
  nurseName: string;
  serviceName: string;
  method: PaymentMethod;
  amount: number;
  commission: number;
  nurseShare: number;
  reference: string;
  paidAt: string;
}

function Transactions() {
  const tick = useTick();
  const { token } = useSession();
  const { data } = useResource<Tx[]>('/admin/transactions', [tick]);
  const nav = useNavigate();
  const totals = (data ?? []).reduce((a, t) => ({ amount: a.amount + t.amount, commission: a.commission + t.commission, nurse: a.nurse + t.nurseShare }), { amount: 0, commission: 0, nurse: 0 });
  return (
    <>
      <PageHead title="Transactions" sub="Paiements patients, commissions Kulawa et reversements infirmiers.">
        <AsyncButton className="btn small" onClick={() => downloadWithToken('/admin/transactions.csv', token!, `kulawa-transactions-${new Date().toISOString().slice(0, 10)}.csv`)}>
          ⬇ Export comptable (CSV)
        </AsyncButton>
      </PageHead>
      <div className="kpis three">
        <Kpi label="Volume encaissé" value={formatFCFA(totals.amount)} />
        <Kpi label="Commissions Kulawa" value={formatFCFA(totals.commission)} tone="good" />
        <Kpi label="Dû aux infirmiers" value={formatFCFA(totals.nurse)} />
      </div>
      <section className="panel">
        {!data?.length ? (
          <p className="muted">Aucune transaction pour le moment.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Date</th>
                  <th>Demande</th>
                  <th>Patient</th>
                  <th>Infirmier</th>
                  <th>Moyen</th>
                  <th>Montant</th>
                  <th>Commission</th>
                  <th>Part infirmier</th>
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.reference} className="clickable" onClick={() => nav(`/admin/demandes/${t.requestId}`)}>
                    <td className="mono">{t.reference}</td>
                    <td>{fmtDate(t.paidAt)}</td>
                    <td className="mono">{t.code}</td>
                    <td>{t.patientName}</td>
                    <td>{t.nurseName}</td>
                    <td>{PAYMENT_LABELS[t.method]}</td>
                    <td>{formatFCFA(t.amount)}</td>
                    <td className="good">{formatFCFA(t.commission)}</td>
                    <td>{formatFCFA(t.nurseShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// 07 — Gestion incidents & qualité ------------------------------------------------------------
interface RatingRow {
  requestId: string;
  code: string;
  nurseName: string;
  patientName: string;
  serviceName: string;
  stars: number;
  comment?: string;
  at: string;
}

function Quality() {
  const tick = useTick();
  const incidents = useResource<Incident[]>('/admin/incidents', [tick]);
  const ratings = useResource<RatingRow[]>('/admin/ratings', [tick]);
  const [open, setOpen] = useState<Incident | null>(null);
  const { markRead } = useSession();
  useEffect(() => markRead(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const catLabel: Record<Incident['category'], string> = { retard: 'Retard', comportement: 'Comportement', paiement: 'Paiement', medical: 'Médical', autre: 'Autre' };
  const stLabel = { open: 'Ouvert', in_review: 'En cours', resolved: 'Résolu' };
  return (
    <>
      <PageHead title="Incidents & qualité" sub="Traitement des signalements et suivi des évaluations." />
      <section className="panel">
        <h2>Signalements</h2>
        {!incidents.data?.length && <p className="muted">Aucun incident signalé.</p>}
        <div className="queue">
          {incidents.data?.map((i) => (
            <div key={i.id} className={`queue-card inc-${i.status}`}>
              <div className="row-between">
                <span className="badge">{catLabel[i.category]}</span>
                <span className={`badge inc-badge-${i.status}`}>{stLabel[i.status]}</span>
              </div>
              <strong>
                {i.reporterName} <small className="muted">({i.reporterRole === 'patient' ? 'patient' : 'infirmier'})</small>
              </strong>
              <p className="clamp">{i.description}</p>
              <small className="muted">
                {i.requestCode ?? 'Sans demande liée'} · {timeAgo(i.createdAt)}
              </small>
              <button className="btn btn-outline small" onClick={() => setOpen(i)}>
                Voir le dossier
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Évaluations récentes</h2>
        {!ratings.data?.length && <p className="muted">Aucune évaluation.</p>}
        <ul className="ratings">
          {ratings.data?.map((r) => (
            <li key={r.requestId} className={r.stars <= 2 ? 'low' : ''}>
              <Stars value={r.stars} size={16} />
              <div>
                <strong>{r.nurseName}</strong> <small className="muted">par {r.patientName} · {r.serviceName} · {r.code}</small>
                {r.comment && <p>« {r.comment} »</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {open && <IncidentDialog inc={open} onClose={() => setOpen(null)} onSaved={() => incidents.reload()} />}
    </>
  );
}

function IncidentDialog({ inc, onClose, onSaved }: { inc: Incident; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const nav = useNavigate();
  const [status, setStatus] = useState(inc.status);
  const [resolution, setResolution] = useState(inc.resolution ?? '');
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Dossier incident</h3>
        <p>
          <strong>{inc.reporterName}</strong> — {fmtDate(inc.createdAt)}
        </p>
        <p className="note">{inc.description}</p>
        {inc.requestId && (
          <button className="link" onClick={() => nav(`/admin/demandes/${inc.requestId}`)}>
            Voir la demande {inc.requestCode} →
          </button>
        )}
        <label>
          Statut
          <select value={status} onChange={(e) => setStatus(e.target.value as Incident['status'])}>
            <option value="open">Ouvert</option>
            <option value="in_review">En cours de traitement</option>
            <option value="resolved">Résolu</option>
          </select>
        </label>
        <label>
          Résolution / réponse envoyée au déclarant
          <textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
        </label>
        <div className="btn-row">
          <button className="btn btn-outline" onClick={onClose}>
            Fermer
          </button>
          <AsyncButton
            className="btn"
            onClick={async () => {
              await api(`/admin/incidents/${inc.id}`, { method: 'PATCH', json: { status, resolution } });
              onSaved();
              onClose();
            }}
          >
            Enregistrer
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}

// Fiches infirmiers ------------------------------------------------------------------------------
function Nurses() {
  const tick = useTick();
  const { api } = useSession();
  const { data, reload } = useResource<(NurseProfile & { busy: boolean; interventions: number; earnings: number })[]>('/admin/nurses', [tick]);
  const sorted = [...(data ?? [])].sort((a, b) => (a.verification === 'pending' ? -1 : 0) - (b.verification === 'pending' ? -1 : 0));
  return (
    <>
      <PageHead title="Infirmiers" sub="Vérification diplôme / Ordre, documents et activité." />
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Infirmier</th>
                <th>Diplôme / Ordre</th>
                <th>Vérification</th>
                <th>État</th>
                <th>Note</th>
                <th>Soins</th>
                <th>Gains</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((n) => (
                <tr key={n.id}>
                  <td>
                    <div className="row">
                      <Avatar name={n.name} size={32} />
                      <div>
                        {n.name}
                        <br />
                        <small className="muted">{n.phone}</small>
                      </div>
                    </div>
                  </td>
                  <td className="mono small">
                    {n.diplomaNumber || '—'}
                    <br />
                    {n.ordreNumber || '—'}
                  </td>
                  <td>
                    <span className={`badge ver-${n.verification}`}>{n.verification === 'verified' ? 'Vérifié' : n.verification === 'pending' ? 'En attente' : 'Refusé'}</span>
                  </td>
                  <td>{n.busy ? 'En intervention' : n.available ? '🟢 En ligne' : 'Hors ligne'}</td>
                  <td>{n.ratingCount ? `★ ${n.rating.toFixed(1)} (${n.ratingCount})` : '—'}</td>
                  <td>{n.interventions}</td>
                  <td>{formatFCFA(n.earnings)}</td>
                  <td>
                    {n.verification !== 'verified' && (
                      <AsyncButton
                        className="btn small"
                        onClick={async () => {
                          await api(`/admin/nurses/${n.id}/verify`, { method: 'POST', json: { decision: 'verify' } });
                          reload();
                        }}
                      >
                        Valider
                      </AsyncButton>
                    )}
                    {n.verification === 'pending' && (
                      <AsyncButton
                        className="btn btn-outline small"
                        onClick={async () => {
                          await api(`/admin/nurses/${n.id}/verify`, { method: 'POST', json: { decision: 'reject' } });
                          reload();
                        }}
                      >
                        Refuser
                      </AsyncButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Patients() {
  const tick = useTick();
  const { data } = useResource<(User & { requests: number; spent: number })[]>('/admin/patients', [tick]);
  return (
    <>
      <PageHead title="Patients" sub={`${data?.length ?? 0} patient(s) inscrit(s)`} />
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Téléphone</th>
                <th>Adresse</th>
                <th>Demandes</th>
                <th>Total payé</th>
                <th>Inscrit</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="mono">{p.phone}</td>
                  <td>{p.address ?? '—'}</td>
                  <td>{p.requests}</td>
                  <td>{formatFCFA(p.spent)}</td>
                  <td>{fmtDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function NotificationsLog() {
  const tick = useTick();
  const { data } = useResource<AppNotification[]>('/admin/notifications/log', [tick]);
  return (
    <>
      <PageHead title="Journal des notifications" sub="Chaque événement système, son destinataire et son canal (carte des notifications)." />
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Heure</th>
                <th>Événement</th>
                <th>Destinataire</th>
                <th>Titre</th>
                <th>Canal</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((n) => (
                <tr key={n.id}>
                  <td>{fmtDate(n.createdAt)}</td>
                  <td className="mono small">{n.event}</td>
                  <td>{n.userId === 'admin' ? <span className="badge mod-admin">Back-office</span> : <span className="badge">Utilisateur</span>}</td>
                  <td>
                    <strong>{n.title}</strong>
                    <br />
                    <small className="muted">{n.body}</small>
                  </td>
                  <td>{n.channels.join(' + ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// Paramètres : tarifs & commission --------------------------------------------------------------
function SettingsPage() {
  const { api } = useSession();
  const { data, reload } = useResource<{ settings: Settings; services: Service[] }>('/admin/settings');
  const [s, setS] = useState<Settings | null>(null);
  const settings = s ?? data?.settings;
  if (!data || !settings) return <Spinner />;
  return (
    <>
      <PageHead title="Tarifs & paramètres" sub="Configuration des tarifs, du taux de commission et du rayon de recherche." />
      <section className="panel settings-form">
        <label>
          Taux de commission Kulawa (%)
          <input type="number" min={0} max={50} value={Math.round(settings.commissionRate * 100)} onChange={(e) => setS({ ...settings, commissionRate: Number(e.target.value) / 100 })} />
        </label>
        <label>
          Frais de déplacement (FCFA)
          <input type="number" min={0} step={100} value={settings.travelFee} onChange={(e) => setS({ ...settings, travelFee: Number(e.target.value) })} />
        </label>
        <label>
          Rayon de recherche (km)
          <input type="number" min={1} max={100} value={settings.searchRadiusKm} onChange={(e) => setS({ ...settings, searchRadiusKm: Number(e.target.value) })} />
        </label>
        <AsyncButton
          className="btn"
          onClick={async () => {
            await api('/admin/settings', { method: 'PUT', json: settings });
            setS(null);
            reload();
          }}
        >
          Enregistrer
        </AsyncButton>
      </section>
      <section className="panel">
        <h2>Catalogue des soins</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>Soin</th>
                <th>Tarif (FCFA)</th>
                <th>Durée (min)</th>
                <th>Actif</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.services.map((sv) => (
                <ServiceRow key={sv.id} s={sv} onSaved={reload} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ServiceRow({ s, onSaved }: { s: Service; onSaved: () => void }) {
  const { api } = useSession();
  const [v, setV] = useState(s);
  const dirty = JSON.stringify(v) !== JSON.stringify(s);
  return (
    <tr>
      <td>{s.icon}</td>
      <td>
        <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </td>
      <td>
        <input type="number" step={500} value={v.price} onChange={(e) => setV({ ...v, price: Number(e.target.value) })} />
      </td>
      <td>
        <input type="number" value={v.durationMin} onChange={(e) => setV({ ...v, durationMin: Number(e.target.value) })} />
      </td>
      <td>
        <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
      </td>
      <td>
        {dirty && (
          <AsyncButton
            className="btn small"
            onClick={async () => {
              await api(`/admin/services/${s.id}`, { method: 'PUT', json: v });
              onSaved();
            }}
          >
            Enregistrer
          </AsyncButton>
        )}
      </td>
    </tr>
  );
}
