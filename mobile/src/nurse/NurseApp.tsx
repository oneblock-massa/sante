import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, View } from 'react-native';
import * as Location from 'expo-location';
import type { CareRequest, NurseProfile, User } from '../../../shared/types';
import { ACTIVE_STATUSES, formatFCFA } from '../../../shared/types';
import { colors, s } from '../theme';
import { NavProvider, useNav } from '../nav';
import { rawApi, useResource, useSession, useSocketEvent } from '../session';
import { Avatar, Badge, Button, Card, Field, Loading, NotificationList, Pulse, Row, Screen, Segmented, Stars, StatusBadge, Tabs, ToastBanner, useAccent } from '../ui';
import { ChatSheet, IncidentSheet, call, fmtDate, getPosition, openMaps } from '../common';

type Offer = CareRequest & { distanceKm?: number; nurseShare: number };
interface Earnings {
  today: number;
  week: number;
  month: number;
  total: number;
  count: number;
  rating: number;
  ratingCount: number;
  recent: { id: string; serviceName: string; patientName: string; amount: number; paidAt: string; rating?: { stars: number } }[];
}

export default function NurseApp() {
  const { session } = useSession();
  if (!session) return <NurseLogin />;
  return (
    <NavProvider initial="tabs">
      <NurseRouter />
      <ToastBanner />
    </NavProvider>
  );
}

function NurseRouter() {
  const { route } = useNav();
  if (route.name === 'offer') return <OfferDetail id={route.params?.id} />;
  if (route.name === 'intervention') return <Intervention id={route.params?.id} />;
  return <TabsScreen />;
}

function TabsScreen() {
  const [tab, setTab] = useState('home');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>{tab === 'home' ? <Availability /> : tab === 'earnings' ? <EarningsScreen /> : <ProfileDocs />}</View>
      <Tabs
        current={tab}
        onChange={setTab}
        tabs={[
          ['home', '📡', 'Demandes'],
          ['earnings', '💰', 'Gains'],
          ['profile', '🪪', 'Profil'],
        ]}
      />
    </View>
  );
}

// 01 — Connexion / candidature
function NurseLogin() {
  const { apiUrl, signIn } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ phone: '', password: '', name: '', diplomaNumber: '', ordreNumber: '' });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Screen title={mode === 'login' ? 'Connexion' : 'Candidature'} back={false} center>
      <View style={{ width: '100%', gap: 14 }}>
        <View style={[s.center, { gap: 6 }]}>
          <Text style={{ fontSize: 30, fontWeight: '900', color: colors.navy }}>Kulawa Pro</Text>
          <Text style={s.muted}>L'application des infirmiers partenaires.</Text>
        </View>
        {mode === 'register' && <Field label="Nom complet" value={f.name} onChangeText={set('name')} />}
        <Field label="Téléphone" keyboardType="phone-pad" value={f.phone} onChangeText={set('phone')} placeholder="90 00 00 01" />
        <Field label="Mot de passe" secureTextEntry value={f.password} onChangeText={set('password')} />
        {mode === 'register' && (
          <>
            <Field label="N° de diplôme d'État" value={f.diplomaNumber} onChangeText={set('diplomaNumber')} />
            <Field label="N° d'inscription à l'Ordre" value={f.ordreNumber} onChangeText={set('ordreNumber')} />
          </>
        )}
        <Button
          title={mode === 'login' ? 'Se connecter' : 'Envoyer ma candidature'}
          onPress={async () => {
            const r = await rawApi<{ token: string; user: User }>(apiUrl, mode === 'login' ? '/auth/nurse/login' : '/auth/nurse/register', null, { json: f });
            signIn('nurse', r.token, r.user);
          }}
        />
        {mode === 'login' && <Text style={s.devHint}>Démo : 90000001 / kulawa123</Text>}
        <Button variant="link" title={mode === 'login' ? 'Devenir infirmier partenaire' : "J'ai déjà un compte"} onPress={() => setMode(mode === 'login' ? 'register' : 'login')} />
      </View>
    </Screen>
  );
}

// 02 — Disponibilité + 03 — Notification reçue
function Availability() {
  const nav = useNav();
  const a = useAccent();
  const { user: u, setUser, api } = useSession();
  const user = u as NurseProfile | null;
  const offers = useResource<Offer[]>('/nurse/offers', [user?.available]);
  const mine = useResource<CareRequest[]>('/requests/mine');
  const earnings = useResource<Earnings>('/nurse/earnings');
  const [error, setError] = useState<string | null>(null);
  useSocketEvent('offer:new', () => offers.reload());
  useSocketEvent<{ requestId: string }>('offer:withdrawn', ({ requestId }) => offers.setData((l) => l?.filter((o) => o.id !== requestId)));
  useSocketEvent('request:update', () => mine.reload());
  useSocketEvent('notification', () => {
    earnings.reload();
    api<User>('/me').then(setUser).catch(() => {});
  });
  const active = mine.data?.find((r) => ACTIVE_STATUSES.includes(r.status) && r.status !== 'paid');
  if (!user) return <Loading />;

  const toggle = async (on: boolean) => {
    setError(null);
    try {
      const pos = on ? await getPosition() : undefined;
      setUser(await api<User>('/nurse/availability', { json: { available: on, lat: pos?.lat, lng: pos?.lng } }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Screen title="Disponibilité" back={false}>
      {user.verification !== 'verified' && (
        <Text style={s.warn}>
          {user.verification === 'pending' ? '⏳ Votre dossier est en cours de vérification. Vous serez notifié dès sa validation.' : '✕ Candidature refusée. Contactez la coordination Kulawa.'}
        </Text>
      )}
      <Card style={[s.between, user.available ? { backgroundColor: a.soft, borderColor: a.main } : {}]}>
        <View style={{ flex: 1 }}>
          <Text style={s.h3}>{user.available ? 'Vous êtes disponible' : 'Vous êtes hors ligne'}</Text>
          <Text style={s.small}>{user.available ? 'Vous recevez les demandes à proximité.' : 'Activez pour recevoir des demandes.'}</Text>
        </View>
        <Switch value={user.available} onValueChange={toggle} disabled={user.verification !== 'verified'} trackColor={{ true: a.main, false: '#cfd6dd' }} thumbColor="#fff" />
      </Card>
      {error && <Text style={s.error}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          ["Aujourd'hui", formatFCFA(earnings.data?.today ?? 0)],
          ['Note', `★ ${user.rating?.toFixed(1) ?? '—'}`],
          ['Soins', String(earnings.data?.count ?? 0)],
        ].map(([l, v]) => (
          <View key={l} style={{ flex: 1, backgroundColor: colors.block, borderRadius: 12, padding: 10 }}>
            <Text style={s.small}>{l}</Text>
            <Text style={{ fontWeight: '800', color: colors.navy }}>{v}</Text>
          </View>
        ))}
      </View>
      {active && (
        <Card onPress={() => nav.push('intervention', { id: active.id })} style={{ borderLeftWidth: 4, borderLeftColor: a.main }}>
          <Text style={s.small}>Intervention en cours · {active.code}</Text>
          <Text style={s.h3}>
            {active.serviceName} — {active.patientName}
          </Text>
          <StatusBadge status={active.status} />
        </Card>
      )}
      {user.available && (
        <>
          <Text style={s.h3}>Demandes à proximité</Text>
          {offers.data?.length === 0 && (
            <View style={{ gap: 8, paddingVertical: 10 }}>
              <Pulse icon="📡" />
              <Text style={[s.muted, { textAlign: 'center' }]}>En attente de nouvelles demandes…</Text>
            </View>
          )}
          {offers.data?.map((o) => (
            <Card key={o.id} onPress={() => nav.push('offer', { id: o.id })} style={{ borderLeftWidth: 4, borderLeftColor: a.main }}>
              <View style={s.between}>
                <Text style={{ color: a.main, fontWeight: '800', fontSize: 12 }}>NOUVELLE DEMANDE</Text>
                {o.distanceKm != null && (
                  <Text style={s.small}>
                    {o.distanceKm} km · ~{o.etaMin} min
                  </Text>
                )}
              </View>
              <Text style={s.h3}>{o.serviceName}</Text>
              <Text style={s.small}>{o.address}</Text>
              <Text style={{ color: a.main, fontWeight: '800' }}>{formatFCFA(o.nurseShare)} pour vous</Text>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

// 04 — Détail & Accepter
function OfferDetail({ id }: { id?: string }) {
  const nav = useNav();
  const a = useAccent();
  const { api } = useSession();
  const { data: o, error } = useResource<Offer>(`/requests/${id}`);
  const [gone, setGone] = useState(false);
  useSocketEvent<{ requestId: string }>('offer:withdrawn', ({ requestId }) => requestId === id && setGone(true));
  if (error) return <Screen title="Demande"><Text style={s.error}>{error}</Text></Screen>;
  if (!o) return <Loading />;
  const available = !gone && o.status === 'searching';
  return (
    <Screen
      title={`Demande ${o.code}`}
      footer={
        available ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              style={{ flex: 1 }}
              title="Accepter"
              onPress={async () => {
                await api(`/requests/${o.id}/accept`, { method: 'POST' });
                nav.replace('intervention', { id: o.id });
              }}
            />
            <Button
              style={{ flex: 1 }}
              title="Refuser"
              variant="outline"
              onPress={async () => {
                await api(`/requests/${o.id}/decline`, { method: 'POST' });
                nav.back();
              }}
            />
          </View>
        ) : undefined
      }
    >
      {!available && <Text style={s.warn}>Cette demande n'est plus disponible (prise en charge ou annulée).</Text>}
      <Card>
        <View style={s.between}>
          <Text style={s.h2}>{o.serviceName}</Text>
          <Text style={{ color: a.main, fontWeight: '800', fontSize: 16 }}>{formatFCFA(o.nurseShare)}</Text>
        </View>
        <Text style={s.text}>👤 {o.patientName}</Text>
        <Text style={s.text}>📍 {o.address}</Text>
        {o.distanceKm != null && (
          <Text style={s.text}>
            🛵 {o.distanceKm} km · environ {o.etaMin} min
          </Text>
        )}
        {o.notes && <Text style={s.note}>« {o.notes} »</Text>}
        <Text style={s.small}>
          Total patient {formatFCFA(o.total)} · reçue {fmtDate(o.createdAt)}
        </Text>
      </Card>
      <Button title="Voir sur la carte" variant="outline" onPress={() => openMaps(o.lat, o.lng, o.patientName)} />
    </Screen>
  );
}

// 05 → 09 — Intervention pilotée par le statut
function Intervention({ id }: { id?: string }) {
  const { data: r, setData, error } = useResource<CareRequest>(`/requests/${id}`);
  useSocketEvent<CareRequest>('request:update', (u) => u.id === id && setData(u));
  const [reporting, setReporting] = useState(false);
  if (error) return <Screen title="Intervention"><Text style={s.error}>{error}</Text></Screen>;
  if (!r) return <Loading />;
  switch (r.status) {
    case 'assigned':
    case 'en_route':
      return <Navigation r={r} onUpdate={setData} />;
    case 'in_progress':
      return reporting ? <ReportForm r={r} onDone={setData} /> : <InProgress r={r} onFinish={() => setReporting(true)} />;
    case 'awaiting_payment':
      return (
        <Screen title="Confirmation de paiement" center>
          <ActivityIndicator size="large" color={colors.teal} />
          <Text style={s.h2}>En attente du paiement</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            {r.patientName} doit régler {formatFCFA(r.total)}. Vous serez notifié dès la confirmation.
          </Text>
        </Screen>
      );
    case 'paid':
    case 'rated':
      return <Earned r={r} />;
    default:
      return (
        <Screen title={r.code}>
          <Text style={s.warn}>Cette intervention a été annulée.</Text>
        </Screen>
      );
  }
}

/** Partage la position pendant le trajet ; sans GPS, simule l'approche (démo). */
function useLiveLocation(r: CareRequest, active: boolean) {
  const { api } = useSession();
  const last = useRef({ lat: r.nurseLat ?? r.lat + 0.02, lng: r.nurseLng ?? r.lng + 0.02 });
  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | undefined;
    let sim: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const send = (lat: number, lng: number) => {
      last.current = { lat, lng };
      api(`/requests/${r.id}/location`, { json: { lat, lng } }).catch(() => {});
    };
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (cancelled) return;
      if (perm?.status === 'granted') {
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 20 }, (p) => send(p.coords.latitude, p.coords.longitude));
        if (cancelled) sub.remove();
      } else {
        sim = setInterval(() => {
          const { lat, lng } = last.current;
          send(lat + (r.lat - lat) * 0.2, lng + (r.lng - lng) * 0.2);
        }, 4000);
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
      if (sim) clearInterval(sim);
    };
  }, [active, r.id, r.lat, r.lng, api]);
}

function Navigation({ r, onUpdate }: { r: CareRequest; onUpdate: (r: CareRequest) => void }) {
  const { api } = useSession();
  const a = useAccent();
  const [chat, setChat] = useState(false);
  useLiveLocation(r, r.status === 'en_route');
  const setStatus = async (status: string) => onUpdate(await api<CareRequest>(`/requests/${r.id}/status`, { json: { status } }));
  return (
    <Screen
      title="Navigation"
      footer={r.status === 'assigned' ? <Button title="Je pars maintenant" onPress={() => setStatus('en_route')} /> : <Button title="Je suis arrivé(e) — commencer" onPress={() => setStatus('in_progress')} />}
    >
      <View style={[s.card, s.between, { backgroundColor: a.soft, borderColor: 'transparent' }]}>
        <Text style={s.text}>Arrivée estimée</Text>
        <Text style={{ fontSize: 24, fontWeight: '800', color: a.main }}>{r.etaMin ?? '—'} min</Text>
      </View>
      <Card>
        <Text style={s.h3}>
          {r.serviceName} — {r.patientName}
        </Text>
        <Text style={s.text}>📍 {r.address}</Text>
        {r.notes && <Text style={s.note}>« {r.notes} »</Text>}
      </Card>
      <Button title="🧭 Itinéraire (Maps)" onPress={() => openMaps(r.lat, r.lng, r.patientName)} variant="outline" />
      {r.patientPhone && <Button title="📞 Appeler le patient" onPress={() => call(r.patientPhone)} variant="outline" />}
      <Button title={`Messages${r.messages.length ? ` (${r.messages.length})` : ''}`} variant="outline" onPress={() => setChat(true)} />
      <ChatSheet r={r} visible={chat} onClose={() => setChat(false)} />
    </Screen>
  );
}

function InProgress({ r, onFinish }: { r: CareRequest; onFinish: () => void }) {
  const a = useAccent();
  const [now, setNow] = useState(Date.now());
  const [incident, setIncident] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const el = Math.max(0, Math.floor((now - new Date(r.startedAt ?? r.createdAt).getTime()) / 1000));
  return (
    <Screen title="Intervention en cours" footer={<Button title="Terminer l'intervention" onPress={onFinish} />}>
      <Card style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 48, fontWeight: '800', color: a.main, fontVariant: ['tabular-nums'] }}>
          {String(Math.floor(el / 60)).padStart(2, '0')}:{String(el % 60).padStart(2, '0')}
        </Text>
        <Text style={s.h3}>{r.serviceName}</Text>
        <Text style={s.text}>{r.patientName}</Text>
        {r.notes && <Text style={s.note}>« {r.notes} »</Text>}
      </Card>
      <Button title="Signaler un incident" variant="link" onPress={() => setIncident(true)} />
      <IncidentSheet requestId={r.id} visible={incident} onClose={() => setIncident(false)} />
    </Screen>
  );
}

function ReportForm({ r, onDone }: { r: CareRequest; onDone: (r: CareRequest) => void }) {
  const { api } = useSession();
  const [f, setF] = useState({ acts: r.serviceName, bloodPressure: '', temperature: '', glycemia: '', observations: '', recommendations: '' });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Screen title="Compte-rendu" footer={<Button title="Envoyer" disabled={!f.acts.trim()} onPress={async () => onDone(await api<CareRequest>(`/requests/${r.id}/report`, { json: f }))} />}>
      <Field label="Actes réalisés *" multiline value={f.acts} onChangeText={set('acts')} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="Tension" placeholder="12/8" value={f.bloodPressure} onChangeText={set('bloodPressure')} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Temp. °C" keyboardType="decimal-pad" placeholder="37.2" value={f.temperature} onChangeText={set('temperature')} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Glycémie" placeholder="1.10" value={f.glycemia} onChangeText={set('glycemia')} />
        </View>
      </View>
      <Field label="Observations" multiline value={f.observations} onChangeText={set('observations')} />
      <Field label="Recommandations au patient" multiline value={f.recommendations} onChangeText={set('recommendations')} />
    </Screen>
  );
}

function Earned({ r }: { r: CareRequest }) {
  const nav = useNav();
  const a = useAccent();
  return (
    <Screen title="Gains & note" footer={<Button title="Retour aux demandes" onPress={() => nav.reset('tabs')} />}>
      <Text style={s.success}>✓ Paiement reçu · {r.payment?.reference}</Text>
      <Card style={{ alignItems: 'center' }}>
        <Text style={s.small}>Votre gain pour cette intervention</Text>
        <Text style={{ fontSize: 34, fontWeight: '800', color: a.main }}>{formatFCFA(r.payment?.nurseShare ?? 0)}</Text>
        <Text style={s.small}>
          Total {formatFCFA(r.total)} − commission {formatFCFA(r.payment?.commission ?? 0)}
        </Text>
      </Card>
      <Card style={{ alignItems: 'center' }}>
        {r.rating ? (
          <>
            <Text style={s.h3}>Évaluation de {r.patientName}</Text>
            <Stars value={r.rating.stars} />
            {r.rating.comment && <Text style={s.note}>« {r.rating.comment} »</Text>}
          </>
        ) : (
          <>
            <Stars value={0} />
            <Text style={s.muted}>En attente de l'évaluation du patient…</Text>
          </>
        )}
      </Card>
    </Screen>
  );
}

function EarningsScreen() {
  const a = useAccent();
  const { data, reload } = useResource<Earnings>('/nurse/earnings');
  useSocketEvent('notification', () => reload());
  if (!data) return <Loading />;
  return (
    <Screen title="Mes gains" back={false}>
      <Card style={{ alignItems: 'center' }}>
        <Text style={s.small}>Ce mois-ci</Text>
        <Text style={{ fontSize: 34, fontWeight: '800', color: a.main }}>{formatFCFA(data.month)}</Text>
      </Card>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          ["Aujourd'hui", formatFCFA(data.today)],
          ['7 jours', formatFCFA(data.week)],
          ['Note', `★ ${data.rating.toFixed(1)} (${data.ratingCount})`],
        ].map(([l, v]) => (
          <View key={l} style={{ flex: 1, backgroundColor: colors.block, borderRadius: 12, padding: 10 }}>
            <Text style={s.small}>{l}</Text>
            <Text style={{ fontWeight: '800', color: colors.navy }}>{v}</Text>
          </View>
        ))}
      </View>
      <Text style={s.h3}>Dernières interventions</Text>
      {data.recent.length === 0 && <Text style={[s.muted, { textAlign: 'center' }]}>Aucune intervention payée.</Text>}
      {data.recent.map((x) => (
        <Card key={x.id}>
          <View style={s.between}>
            <Text style={s.h3}>{x.serviceName}</Text>
            <Text style={{ color: a.main, fontWeight: '800' }}>+{formatFCFA(x.amount)}</Text>
          </View>
          <View style={s.between}>
            <Text style={s.small}>
              {x.patientName} · {fmtDate(x.paidAt)}
            </Text>
            {x.rating && <Text style={{ color: colors.gold }}>{'★'.repeat(x.rating.stars)}</Text>}
          </View>
        </Card>
      ))}
    </Screen>
  );
}

function ProfileDocs() {
  const { user: u, logout, unread, markRead } = useSession();
  const user = u as NurseProfile | null;
  const [tab, setTab] = useState<'profil' | 'notifs'>(unread ? 'notifs' : 'profil');
  useEffect(() => {
    if (tab === 'notifs' && unread) markRead();
  }, [tab, unread, markRead]);
  if (!user) return <Loading />;
  const docColors = { missing: ['#fbe9e8', colors.red], submitted: ['#fff4e0', '#9a5a00'], validated: ['#eaf6e4', '#3b7f22'] } as const;
  const docLabel = { missing: 'Manquant', submitted: 'En vérification', validated: 'Validé' };
  const docs = [
    ['Contrat de partenariat', user.documents?.contract ?? 'missing'],
    ['Attestation d’assurance RC Pro', user.documents?.insurance ?? 'missing'],
    ['Diplôme d’État & Ordre', user.documents?.diploma ?? 'missing'],
  ] as const;
  return (
    <Screen title="Profil & documents" back={false}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          ['profil', 'Profil'],
          ['notifs', `Notifications${unread ? ` (${unread})` : ''}`],
        ]}
      />
      {tab === 'notifs' ? (
        <NotificationList />
      ) : (
        <>
          <Card>
            <View style={s.row}>
              <Avatar name={user.name} />
              <View style={{ gap: 3 }}>
                <Text style={s.h3}>{user.name}</Text>
                <Text style={s.small}>{user.phone}</Text>
                <Badge
                  label={user.verification === 'verified' ? '✓ Vérifié' : user.verification === 'pending' ? 'En vérification' : 'Refusé'}
                  bg={user.verification === 'verified' ? '#eaf6e4' : '#fff4e0'}
                  fg={user.verification === 'verified' ? '#3b7f22' : '#9a5a00'}
                />
              </View>
            </View>
          </Card>
          <Card>
            <Row label="Diplôme d'État" value={user.diplomaNumber || '—'} />
            <Row label="Ordre national" value={user.ordreNumber || '—'} />
            <Row label="Note moyenne" value={`★ ${user.rating?.toFixed(1)} (${user.ratingCount})`} />
          </Card>
          <Text style={s.h3}>Documents</Text>
          {docs.map(([label, st]) => (
            <Card key={label} style={s.between}>
              <Text style={[s.text, { flex: 1 }]}>📄 {label}</Text>
              <Badge label={docLabel[st]} bg={docColors[st][0]} fg={docColors[st][1]} />
            </Card>
          ))}
          <Pressable onPress={logout} style={{ padding: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.red, fontWeight: '600', textDecorationLine: 'underline' }}>Se déconnecter</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}
