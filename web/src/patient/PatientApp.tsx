import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { CareRequest, Incident, PaymentMethod, Service } from '../../../shared/types';
import { ACTIVE_STATUSES, PAYMENT_LABELS, STATUS_LABELS, formatFCFA } from '../../../shared/types';
import { SessionProvider, apiFetch, useResource, useSession, useSocketEvent } from '../lib/session';
import { AsyncButton, Avatar, ErrorText, NotificationList, Sheet, Spinner, Stars, StatusBadge, Toasts } from '../components/ui';
import { MapView, type MapMarker } from '../components/MapView';
import { NIAMEY, fmtDate, fmtTime, getPosition } from '../lib/util';

export default function PatientApp() {
  return (
    <SessionProvider role="patient">
      <PatientRoutes />
    </SessionProvider>
  );
}

function PatientRoutes() {
  const { token } = useSession();
  if (!token) return <PatientLogin />;
  return (
    <div className="app-shell patient">
      <Toasts />
      <Routes>
        <Route index element={<Home />} />
        <Route path="service" element={<ServiceSelect />} />
        <Route path="adresse" element={<AddressPrice />} />
        <Route path="demande/:id" element={<RequestFlow />} />
        <Route path="historique" element={<History />} />
        <Route path="profil" element={<Profile />} />
        <Route path="*" element={<Navigate to="/patient" replace />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

function BottomNav() {
  const { unread } = useSession();
  const loc = useLocation();
  if (/\/(service|adresse|demande)/.test(loc.pathname)) return null;
  return (
    <nav className="bottom-nav">
      <NavLink to="/patient" end>
        <span>🏠</span>Accueil
      </NavLink>
      <NavLink to="/patient/historique">
        <span>📋</span>Historique
      </NavLink>
      <NavLink to="/patient/profil">
        <span>👤</span>Profil{unread > 0 && <i className="dot">{unread}</i>}
      </NavLink>
    </nav>
  );
}

function TopBar({ title, back }: { title: string; back?: string | number }) {
  const nav = useNavigate();
  return (
    <header className="topbar">
      {back !== undefined ? (
        <button className="icon-btn" onClick={() => (typeof back === 'number' ? nav(back) : nav(back))} aria-label="Retour">
          ←
        </button>
      ) : (
        <span className="brand-mini">Kulawa</span>
      )}
      <h1>{title}</h1>
      <span style={{ width: 36 }} />
    </header>
  );
}

// 01 — Connexion / OTP ----------------------------------------------------------
function PatientLogin() {
  const { setSession } = useSession();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [devCode, setDevCode] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ phone: string; isNew: boolean; devCode?: string }>('/auth/patient/otp', null, { method: 'POST', json: { phone } });
      setIsNew(r.isNew);
      setDevCode(r.devCode);
      setStep('code');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ token: string; user: never }>('/auth/patient/verify', null, { method: 'POST', json: { phone, code, name } });
      setSession(r.token, r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell patient">
      <div className="login">
        <div className="login-hero">
          <img src="/icon.svg" alt="" width={64} height={64} />
          <h1>Kulawa</h1>
          <p>Un infirmier diplômé chez vous, en quelques minutes.</p>
        </div>
        {step === 'phone' ? (
          <form className="card stack" onSubmit={sendCode}>
            <label>
              Numéro de téléphone
              <div className="phone-input">
                <span>+227</span>
                <input inputMode="tel" autoComplete="tel" placeholder="96 00 00 01" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </div>
            </label>
            <ErrorText error={error} />
            <button className="btn" disabled={busy}>
              {busy ? '…' : 'Recevoir le code'}
            </button>
            <p className="muted small">Un code à 6 chiffres vous sera envoyé par SMS.</p>
          </form>
        ) : (
          <form className="card stack" onSubmit={verify}>
            <p>
              Code envoyé au <strong>{phone}</strong>.{' '}
              <button type="button" className="link" onClick={() => setStep('phone')}>
                Modifier
              </button>
            </p>
            {devCode && (
              <p className="dev-hint">
                Mode démo — votre code : <strong>{devCode}</strong>
              </p>
            )}
            <label>
              Code de vérification
              <input className="otp" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
            </label>
            {isNew && (
              <label>
                Votre nom complet
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Hadiza Oumarou" required />
              </label>
            )}
            <ErrorText error={error} />
            <button className="btn" disabled={busy || code.length !== 6}>
              {busy ? '…' : 'Se connecter'}
            </button>
            <button type="button" className="link" onClick={() => sendCode()}>
              Renvoyer le code
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// 02 — Accueil -----------------------------------------------------------------------
function useServices() {
  return useResource<{ services: Service[]; travelFee: number }>('/services');
}

function useMyRequests() {
  const res = useResource<CareRequest[]>('/requests/mine');
  useSocketEvent<CareRequest>('request:update', (r) =>
    res.setData((list) => {
      if (!list) return [r];
      return list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [r, ...list];
    }),
  );
  return res;
}

function Home() {
  const { user } = useSession();
  const nav = useNavigate();
  const { data } = useServices();
  const { data: mine } = useMyRequests();
  const active = mine?.find((r) => ACTIVE_STATUSES.includes(r.status));
  const firstName = user?.name?.split(' ')[0];

  return (
    <main className="screen">
      <header className="hero-band">
        <p>Bonjour{firstName ? `, ${firstName}` : ''} 👋</p>
        <h1>De quel soin avez-vous besoin ?</h1>
      </header>

      {active && (
        <button className="card active-card" onClick={() => nav(`/patient/demande/${active.id}`)}>
          <div>
            <small>Demande en cours · {active.code}</small>
            <strong>{active.serviceName}</strong>
            <StatusBadge status={active.status} />
          </div>
          <span className="chev">›</span>
        </button>
      )}

      <div className="grid-2">
        {(data?.services ?? []).slice(0, 4).map((s) => (
          <button key={s.id} className="tile" onClick={() => nav(`/patient/adresse?service=${s.id}`)}>
            <span className="tile-icon">{s.icon}</span>
            <strong>{s.name}</strong>
            <small>dès {formatFCFA(s.price)}</small>
          </button>
        ))}
      </div>
      <button className="btn btn-lg" onClick={() => nav('/patient/service')} disabled={Boolean(active && active.status !== 'paid')}>
        Demander un soin
      </button>

      <section className="info-row">
        <div>
          <strong>✓ Infirmiers diplômés</strong>
          <small>Vérifiés par l'Ordre</small>
        </div>
        <div>
          <strong>⏱ ~20 min</strong>
          <small>Délai moyen</small>
        </div>
        <div>
          <strong>📱 Mobile money</strong>
          <small>Airtel, Moov, Zamani</small>
        </div>
      </section>
    </main>
  );
}

// 03 — Sélection du service --------------------------------------------------------
function ServiceSelect() {
  const nav = useNavigate();
  const { data, loading } = useServices();
  const [selected, setSelected] = useState<string>();
  return (
    <main className="screen with-footer">
      <TopBar title="Choisir un soin" back="/patient" />
      {loading && <Spinner />}
      <div className="stack">
        {data?.services.map((s) => (
          <button key={s.id} className={`option ${selected === s.id ? 'selected' : ''}`} onClick={() => setSelected(s.id)}>
            <span className="tile-icon">{s.icon}</span>
            <div>
              <strong>{s.name}</strong>
              <small>{s.description}</small>
            </div>
            <span className="price">{formatFCFA(s.price)}</span>
          </button>
        ))}
      </div>
      <footer className="sticky-footer">
        <button className="btn btn-lg" disabled={!selected} onClick={() => nav(`/patient/adresse?service=${selected}`)}>
          Continuer
        </button>
      </footer>
    </main>
  );
}

// 04 — Adresse & tarif ---------------------------------------------------------------
function AddressPrice() {
  const nav = useNavigate();
  const { api, user } = useSession();
  const [params] = useSearchParams();
  const { data } = useServices();
  const service = data?.services.find((s) => s.id === params.get('service'));
  const [pos, setPos] = useState(NIAMEY);
  const [located, setLocated] = useState<'pending' | 'gps' | 'default'>('pending');
  const [address, setAddress] = useState(user?.address ?? '');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    getPosition().then((p) => {
      setPos({ lat: p.lat, lng: p.lng });
      setLocated(p.real ? 'gps' : 'default');
    });
  }, []);

  const markers = useMemo(() => [{ id: 'me', ...pos, kind: 'patient' as const, label: 'Lieu du soin' }], [pos]);
  if (data && !service) return <Navigate to="/patient/service" replace />;

  return (
    <main className="screen with-footer">
      <TopBar title="Adresse & tarif" back={-1} />
      <div className="map-wrap">
        <MapView markers={markers} center={pos} onPick={(p) => setPos(p)} height={200} />
        <small className="map-hint">
          {located === 'pending' ? 'Localisation…' : located === 'gps' ? 'Position GPS détectée' : 'Touchez la carte pour placer votre position'}
        </small>
      </div>
      <div className="stack">
        <label>
          Adresse / repères
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ex. Yantala, rue YN-34, portail bleu" />
        </label>
        <label>
          Informations pour l'infirmier (facultatif)
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ordonnance disponible, étage, allergies…" />
        </label>
        {service && data && (
          <div className="card price-card">
            <div>
              <span>
                {service.icon} {service.name}
              </span>
              <span>{formatFCFA(service.price)}</span>
            </div>
            <div>
              <span>Frais de déplacement</span>
              <span>{formatFCFA(data.travelFee)}</span>
            </div>
            <div className="total">
              <span>Total</span>
              <span>{formatFCFA(service.price + data.travelFee)}</span>
            </div>
            <small className="muted">Paiement après le soin, par mobile money ou en espèces.</small>
          </div>
        )}
      </div>
      <footer className="sticky-footer">
        <AsyncButton
          className="btn btn-lg"
          disabled={!service || !address.trim()}
          onClick={async () => {
            const r = await api<CareRequest>('/requests', { method: 'POST', json: { serviceId: service!.id, address, notes, ...pos } });
            nav(`/patient/demande/${r.id}`, { replace: true, state: { justSent: true } });
          }}
        >
          Confirmer la demande
        </AsyncButton>
      </footer>
    </main>
  );
}

// 05 → 10 — Parcours de la demande, piloté par son statut -----------------------------
function RequestFlow() {
  const { id } = useParams();
  const { api } = useSession();
  const loc = useLocation();
  const { data: r, setData, error } = useResource<CareRequest>(`/requests/${id}`);
  const [sending, setSending] = useState(Boolean((loc.state as { justSent?: boolean })?.justSent));
  useSocketEvent<CareRequest>('request:update', (u) => u.id === id && setData(u));

  useEffect(() => {
    if (!sending) return;
    const t = setTimeout(() => setSending(false), 1400);
    return () => clearTimeout(t);
  }, [sending]);

  if (error) return <main className="screen"><TopBar title="Demande" back="/patient" /><ErrorText error={error} /></main>;
  if (!r) return <main className="screen center-screen"><Spinner /></main>;

  if (sending)
    return (
      <main className="screen center-screen">
        <Spinner size={64} />
        <h2>Envoi de votre demande…</h2>
        <p className="muted">Nous prévenons les infirmiers disponibles près de chez vous.</p>
      </main>
    );

  switch (r.status) {
    case 'searching':
      return <Searching r={r} onCancel={() => api<CareRequest>(`/requests/${r.id}/cancel`, { method: 'POST' }).then(setData)} />;
    case 'assigned':
      return <NurseFound r={r} />;
    case 'en_route':
    case 'in_progress':
      return <LiveTracking r={r} />;
    case 'awaiting_payment':
      return <PaymentScreen r={r} onPaid={setData} />;
    case 'paid':
      return <RatingScreen r={r} onRated={setData} />;
    default:
      return <RequestSummary r={r} />;
  }
}

function Searching({ r, onCancel }: { r: CareRequest; onCancel: () => Promise<unknown> }) {
  return (
    <main className="screen center-screen">
      <TopBar title={r.code} back="/patient" />
      <div className="pulse">
        <span>🩺</span>
      </div>
      <h2>Recherche d'un infirmier…</h2>
      <p className="muted">
        {r.serviceName} · {r.address}
      </p>
      <p className="muted small">Vous serez notifié dès qu'un infirmier accepte. Vous pouvez quitter cet écran.</p>
      <AsyncButton className="btn btn-outline" onClick={onCancel}>
        Annuler la demande
      </AsyncButton>
    </main>
  );
}

function NurseCard({ r }: { r: CareRequest }) {
  return (
    <div className="card nurse-card">
      <Avatar name={r.nurseName} size={56} />
      <div>
        <strong>{r.nurseName}</strong>
        <small>Infirmier(ère) diplômé(e) d'État</small>
        <span className="rating">★ {r.nurseRating?.toFixed(1) ?? '—'}</span>
      </div>
      {r.nursePhone && (
        <a className="icon-btn call" href={`tel:${r.nursePhone}`} aria-label="Appeler">
          📞
        </a>
      )}
    </div>
  );
}

function NurseFound({ r }: { r: CareRequest }) {
  const nav = useNavigate();
  const [follow, setFollow] = useState(false);
  if (follow) return <LiveTracking r={r} />;
  return (
    <main className="screen">
      <TopBar title="Infirmier trouvé" back="/patient" />
      <div className="success-banner">✓ Votre demande a été acceptée</div>
      <NurseCard r={r} />
      <div className="card eta-card">
        <span>Arrivée estimée</span>
        <strong>{r.etaMin ?? '—'} min</strong>
      </div>
      <button className="btn btn-lg" onClick={() => setFollow(true)}>
        Suivre l'arrivée
      </button>
      <button className="link" onClick={() => nav('/patient')}>
        Retour à l'accueil
      </button>
    </main>
  );
}

function LiveTracking({ r }: { r: CareRequest }) {
  const [chat, setChat] = useState(false);
  const [incident, setIncident] = useState(false);
  const markers = useMemo(() => {
    const m: MapMarker[] = [{ id: 'p', lat: r.lat, lng: r.lng, kind: 'patient', label: 'Vous' }];
    if (r.nurseLat != null && r.nurseLng != null) m.push({ id: 'n', lat: r.nurseLat, lng: r.nurseLng, kind: 'nurse' as const, label: r.nurseName ?? '' });
    return m;
  }, [r.lat, r.lng, r.nurseLat, r.nurseLng, r.nurseName]);
  const steps = [
    { key: 'assigned', label: 'Demande acceptée', at: r.assignedAt },
    { key: 'en_route', label: 'Infirmier en route' },
    { key: 'in_progress', label: 'Soin en cours', at: r.startedAt },
  ];
  const order = ['assigned', 'en_route', 'in_progress'];
  const idx = order.indexOf(r.status);

  return (
    <main className="screen">
      <TopBar title="Suivi en direct" back="/patient" />
      <MapView markers={markers} route height={230} />
      <div className="card eta-card">
        <span>{r.status === 'in_progress' ? 'Intervention en cours' : 'Arrivée estimée'}</span>
        <strong>{r.status === 'in_progress' ? '🩺' : `${r.etaMin ?? '—'} min`}</strong>
      </div>
      <ol className="timeline">
        {steps.map((s, i) => (
          <li key={s.key} className={i <= idx ? 'done' : ''}>
            {s.label}
            {s.at && <small>{fmtTime(s.at)}</small>}
          </li>
        ))}
      </ol>
      <NurseCard r={r} />
      <button className="btn btn-outline" onClick={() => setChat(true)}>
        Message à l'infirmier {r.messages.length > 0 && `(${r.messages.length})`}
      </button>
      <button className="link danger" onClick={() => setIncident(true)}>
        Signaler un problème
      </button>
      {chat && <ChatSheet r={r} onClose={() => setChat(false)} />}
      {incident && <IncidentSheet requestId={r.id} onClose={() => setIncident(false)} />}
    </main>
  );
}

export function ChatSheet({ r, onClose }: { r: CareRequest; onClose: () => void }) {
  const { api, role } = useSession();
  const [text, setText] = useState('');
  const quick = role === 'patient' ? ['Je suis à la maison', 'Le portail est ouvert', 'Appelez-moi en arrivant'] : ['Je suis en route', 'Je suis devant chez vous', 'Préparez l’ordonnance svp'];
  const send = async (t: string) => {
    if (!t.trim()) return;
    await api(`/requests/${r.id}/messages`, { method: 'POST', json: { text: t } });
    setText('');
  };
  return (
    <Sheet title={role === 'patient' ? `Message à ${r.nurseName ?? 'l’infirmier'}` : `Message à ${r.patientName}`} onClose={onClose}>
      <div className="chat">
        {r.messages.length === 0 && <p className="muted center small">Aucun message.</p>}
        {r.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.from === role ? 'me' : ''}`}>
            {m.text}
            <small>{fmtTime(m.at)}</small>
          </div>
        ))}
      </div>
      <div className="chips">
        {quick.map((q) => (
          <button key={q} className="chip" onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Votre message…" />
        <button className="btn">Envoyer</button>
      </form>
    </Sheet>
  );
}

export function IncidentSheet({ requestId, onClose }: { requestId?: string; onClose: () => void }) {
  const { api } = useSession();
  const [category, setCategory] = useState<Incident['category']>('retard');
  const [description, setDescription] = useState('');
  const [done, setDone] = useState(false);
  return (
    <Sheet title="Signaler un incident" onClose={onClose}>
      {done ? (
        <div className="stack center">
          <p className="success-banner">✓ Signalement transmis à la coordination Kulawa.</p>
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
        </div>
      ) : (
        <div className="stack">
          <label>
            Type
            <select value={category} onChange={(e) => setCategory(e.target.value as Incident['category'])}>
              <option value="retard">Retard</option>
              <option value="comportement">Comportement</option>
              <option value="paiement">Paiement</option>
              <option value="medical">Problème médical</option>
              <option value="autre">Autre</option>
            </select>
          </label>
          <label>
            Description
            <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <AsyncButton
            className="btn btn-danger"
            disabled={!description.trim()}
            onClick={async () => {
              await api('/incidents', { method: 'POST', json: { requestId, category, description } });
              setDone(true);
            }}
          >
            Envoyer le signalement
          </AsyncButton>
        </div>
      )}
    </Sheet>
  );
}

function ReportView({ r }: { r: CareRequest }) {
  if (!r.report) return null;
  const rp = r.report;
  return (
    <details className="card report" open>
      <summary>Compte-rendu de l'infirmier</summary>
      <p>
        <strong>Actes réalisés :</strong> {rp.acts}
      </p>
      <div className="vitals">
        {rp.bloodPressure && <span>Tension {rp.bloodPressure}</span>}
        {rp.temperature && <span>Temp. {rp.temperature} °C</span>}
        {rp.glycemia && <span>Glycémie {rp.glycemia}</span>}
      </div>
      {rp.observations && (
        <p>
          <strong>Observations :</strong> {rp.observations}
        </p>
      )}
      {rp.recommendations && (
        <p>
          <strong>Recommandations :</strong> {rp.recommendations}
        </p>
      )}
    </details>
  );
}

// 09 — Paiement
function PaymentScreen({ r, onPaid }: { r: CareRequest; onPaid: (r: CareRequest) => void }) {
  const { api, user } = useSession();
  const [method, setMethod] = useState<PaymentMethod>('airtel');
  const [phone, setPhone] = useState(user?.phone?.replace('+227', '') ?? '');
  const [processing, setProcessing] = useState(false);
  const methods: PaymentMethod[] = ['airtel', 'moov', 'zamani', 'cash'];

  if (processing)
    return (
      <main className="screen center-screen">
        <Spinner size={64} />
        <h2>Validation du paiement…</h2>
        <p className="muted">{method === 'cash' ? 'Confirmation de la remise en espèces.' : `Confirmez la transaction sur votre téléphone (${PAYMENT_LABELS[method]}).`}</p>
      </main>
    );

  return (
    <main className="screen">
      <TopBar title="Paiement" back="/patient" />
      <div className="success-banner">✓ Soin terminé par {r.nurseName}</div>
      <div className="seg">
        {methods.map((m) => (
          <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>
            {PAYMENT_LABELS[m]}
          </button>
        ))}
      </div>
      <div className="card price-card">
        <div>
          <span>{r.serviceName}</span>
          <span>{formatFCFA(r.price)}</span>
        </div>
        <div>
          <span>Déplacement</span>
          <span>{formatFCFA(r.travelFee)}</span>
        </div>
        <div className="total">
          <span>Total</span>
          <span>{formatFCFA(r.total)}</span>
        </div>
      </div>
      {method !== 'cash' && (
        <label>
          Numéro {PAYMENT_LABELS[method]}
          <div className="phone-input">
            <span>+227</span>
            <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </label>
      )}
      <AsyncButton
        className="btn btn-lg"
        onClick={async () => {
          setProcessing(true);
          try {
            await new Promise((res) => setTimeout(res, 1500));
            onPaid(await api<CareRequest>(`/requests/${r.id}/pay`, { method: 'POST', json: { method, phone } }));
          } finally {
            setProcessing(false);
          }
        }}
      >
        Payer {formatFCFA(r.total)}
      </AsyncButton>
      <ReportView r={r} />
    </main>
  );
}

// 10 — Évaluation
function RatingScreen({ r, onRated }: { r: CareRequest; onRated: (r: CareRequest) => void }) {
  const { api } = useSession();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <main className="screen">
      <TopBar title="Évaluation" back="/patient" />
      <div className="success-banner">✓ Paiement confirmé · réf. {r.payment?.reference}</div>
      <div className="card center stack">
        <Avatar name={r.nurseName} size={64} />
        <h2>Comment s'est passé votre soin avec {r.nurseName?.split(' ')[0]} ?</h2>
        <Stars value={stars} onChange={setStars} size={40} />
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Un commentaire (facultatif)" />
        <AsyncButton className="btn btn-lg" onClick={async () => onRated(await api<CareRequest>(`/requests/${r.id}/rate`, { method: 'POST', json: { stars, comment } }))}>
          Envoyer l'évaluation
        </AsyncButton>
      </div>
    </main>
  );
}

function Receipt({ r }: { r: CareRequest }) {
  if (!r.payment) return null;
  return (
    <div className="card receipt">
      <h3>Reçu de paiement</h3>
      <div>
        <span>Référence</span>
        <span>{r.payment.reference}</span>
      </div>
      <div>
        <span>Date</span>
        <span>{fmtDate(r.payment.paidAt)}</span>
      </div>
      <div>
        <span>Moyen</span>
        <span>{PAYMENT_LABELS[r.payment.method]}</span>
      </div>
      <div>
        <span>Soin</span>
        <span>{r.serviceName}</span>
      </div>
      <div>
        <span>Infirmier</span>
        <span>{r.nurseName}</span>
      </div>
      <div className="total">
        <span>Montant</span>
        <span>{formatFCFA(r.payment.amount)}</span>
      </div>
      <button className="btn btn-outline" onClick={() => window.print()}>
        Imprimer
      </button>
    </div>
  );
}

function RequestSummary({ r }: { r: CareRequest }) {
  const nav = useNavigate();
  return (
    <main className="screen">
      <TopBar title={r.code} back="/patient/historique" />
      <div className="card stack">
        <div className="row-between">
          <strong>{r.serviceName}</strong>
          <StatusBadge status={r.status} />
        </div>
        <small className="muted">
          {fmtDate(r.createdAt)} · {r.address}
        </small>
        {r.nurseName && <span>Infirmier : {r.nurseName}</span>}
        {r.rating && <Stars value={r.rating.stars} size={18} />}
      </div>
      {r.status === 'rated' && <div className="success-banner">Merci pour votre évaluation ! 💙</div>}
      <ReportView r={r} />
      <Receipt r={r} />
      <button className="btn" onClick={() => nav('/patient')}>
        Retour à l'accueil
      </button>
    </main>
  );
}

// Historique ------------------------------------------------------------------
function History() {
  const nav = useNavigate();
  const { data, loading } = useMyRequests();
  const [filter, setFilter] = useState('all');
  const types = [...new Set((data ?? []).map((r) => r.serviceName))];
  const list = (data ?? []).filter((r) => filter === 'all' || r.serviceName === filter);
  return (
    <main className="screen">
      <TopBar title="Historique" />
      <div className="chips scroll">
        <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          Tous
        </button>
        {types.map((t) => (
          <button key={t} className={`chip ${filter === t ? 'on' : ''}`} onClick={() => setFilter(t)}>
            {t}
          </button>
        ))}
      </div>
      {loading && <Spinner />}
      {!loading && list.length === 0 && <p className="muted center">Aucune intervention pour le moment.</p>}
      <ul className="list">
        {list.map((r) => (
          <li key={r.id}>
            <button onClick={() => nav(`/patient/demande/${r.id}`)}>
              <div>
                <strong>{r.serviceName}</strong>
                <small>
                  {fmtDate(r.createdAt)} · {r.nurseName ?? STATUS_LABELS[r.status]}
                </small>
              </div>
              <div className="right">
                <span>{formatFCFA(r.total)}</span>
                <StatusBadge status={r.status} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

// Profil ------------------------------------------------------------------------
function Profile() {
  const { user, setUser, logout, api, markRead, unread } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const [address, setAddress] = useState(user?.address ?? '');
  const [incident, setIncident] = useState(false);
  const [tab, setTab] = useState<'profil' | 'notifs'>(unread ? 'notifs' : 'profil');
  useEffect(() => {
    if (tab === 'notifs' && unread) markRead();
  }, [tab, unread, markRead]);
  return (
    <main className="screen">
      <TopBar title="Mon compte" />
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
            <Avatar name={user?.name} />
            <div>
              <strong>{user?.name}</strong>
              <small className="muted">{user?.phone}</small>
            </div>
          </div>
          <label>
            Nom
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Adresse habituelle
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <AsyncButton className="btn" onClick={async () => setUser(await api('/me', { method: 'PATCH', json: { name, address } }))}>
            Enregistrer
          </AsyncButton>
          <button className="btn btn-outline" onClick={() => setIncident(true)}>
            Signaler un incident
          </button>
          <button className="link danger" onClick={logout}>
            Se déconnecter
          </button>
        </div>
      )}
      {incident && <IncidentSheet onClose={() => setIncident(false)} />}
    </main>
  );
}
