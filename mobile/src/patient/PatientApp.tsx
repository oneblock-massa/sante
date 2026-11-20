import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { CareRequest, PaymentMethod, Service, User } from '../../../shared/types';
import { ACTIVE_STATUSES, PAYMENT_LABELS, STATUS_LABELS, formatFCFA } from '../../../shared/types';
import { colors, s } from '../theme';
import { NavProvider, useNav } from '../nav';
import { rawApi, useResource, useSession, useSocketEvent } from '../session';
import { Avatar, Badge, Button, Card, Field, Loading, Logo, NotificationList, Pulse, Row, Screen, Segmented, Stars, StatusBadge, Tabs, ToastBanner, useAccent } from '../ui';
import { ChatSheet, IncidentSheet, ReportView, call, fmtDate, fmtTime, getPosition } from '../common';

export default function PatientApp() {
  const { session } = useSession();
  if (!session) return <PatientLogin />;
  return (
    <NavProvider initial="tabs">
      <PatientRouter />
      <ToastBanner />
    </NavProvider>
  );
}

function PatientRouter() {
  const { route } = useNav();
  const p = route.params ?? {};
  switch (route.name) {
    case 'service':
      return <ServiceSelect />;
    case 'address':
      return <AddressPrice serviceId={p.serviceId} />;
    case 'request':
      return <RequestFlow id={p.id} justSent={p.justSent === '1'} />;
    default:
      return <TabsScreen />;
  }
}

function TabsScreen() {
  const [tab, setTab] = useState('home');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>{tab === 'home' ? <Home /> : tab === 'history' ? <History /> : <Profile />}</View>
      <Tabs
        current={tab}
        onChange={setTab}
        tabs={[
          ['home', '🏠', 'Accueil'],
          ['history', '📋', 'Historique'],
          ['profile', '👤', 'Profil'],
        ]}
      />
    </View>
  );
}

// 01 — Connexion / OTP
function PatientLogin() {
  const { apiUrl, signIn } = useSession();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [devCode, setDevCode] = useState<string>();

  return (
    <Screen title="Connexion" back={false} center>
      <View style={{ width: '100%', gap: 16 }}>
        <View style={[s.center, { gap: 6, marginBottom: 8 }]}>
          <Logo size={48} />
          <Text style={s.muted}>Un infirmier diplômé chez vous, en quelques minutes.</Text>
        </View>
        {step === 'phone' ? (
          <>
            <Field label="Numéro de téléphone" keyboardType="phone-pad" placeholder="96 00 00 01" value={phone} onChangeText={setPhone} />
            <Button
              title="Recevoir le code"
              disabled={phone.replace(/\D/g, '').length < 8}
              onPress={async () => {
                const r = await rawApi<{ isNew: boolean; devCode?: string }>(apiUrl, '/auth/patient/otp', null, { json: { phone } });
                setIsNew(r.isNew);
                setDevCode(r.devCode);
                setStep('code');
              }}
            />
          </>
        ) : (
          <>
            <Text style={s.text}>Code envoyé au {phone}.</Text>
            {devCode && <Text style={s.devHint}>Mode démo — votre code : {devCode}</Text>}
            <Field label="Code à 6 chiffres" keyboardType="number-pad" maxLength={6} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} />
            {isNew && <Field label="Votre nom complet" value={name} onChangeText={setName} />}
            <Button
              title="Se connecter"
              disabled={code.length !== 6 || (isNew && !name.trim())}
              onPress={async () => {
                const r = await rawApi<{ token: string; user: User }>(apiUrl, '/auth/patient/verify', null, { json: { phone, code, name } });
                signIn('patient', r.token, r.user);
              }}
            />
            <Button title="Modifier le numéro" variant="link" onPress={() => setStep('phone')} />
          </>
        )}
      </View>
    </Screen>
  );
}

function useServices() {
  return useResource<{ services: Service[]; travelFee: number }>('/services');
}

function useMine() {
  const res = useResource<CareRequest[]>('/requests/mine');
  useSocketEvent<CareRequest>('request:update', (r) =>
    res.setData((l) => (!l ? [r] : l.some((x) => x.id === r.id) ? l.map((x) => (x.id === r.id ? r : x)) : [r, ...l])),
  );
  return res;
}

// 02 — Accueil
function Home() {
  const nav = useNav();
  const a = useAccent();
  const { user } = useSession();
  const { data } = useServices();
  const { data: mine } = useMine();
  const active = mine?.find((r) => ACTIVE_STATUSES.includes(r.status));
  return (
    <Screen title="Accueil" back={false}>
      <View style={{ backgroundColor: a.main, borderRadius: 18, padding: 20, gap: 6 }}>
        <Text style={{ color: '#dbe6f5' }}>Bonjour {user?.name?.split(' ')[0]} 👋</Text>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>De quel soin avez-vous besoin ?</Text>
      </View>
      {active && (
        <Card onPress={() => nav.push('request', { id: active.id })} style={{ borderLeftWidth: 4, borderLeftColor: a.main }}>
          <Text style={s.small}>Demande en cours · {active.code}</Text>
          <Text style={s.h3}>{active.serviceName}</Text>
          <StatusBadge status={active.status} />
        </Card>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {(data?.services ?? []).slice(0, 4).map((sv) => (
          <Pressable key={sv.id} onPress={() => nav.push('address', { serviceId: sv.id })} style={{ width: '48%', flexGrow: 1, backgroundColor: colors.block, borderRadius: 14, padding: 14, gap: 4 }}>
            <Text style={{ fontSize: 26 }}>{sv.icon}</Text>
            <Text style={s.h3}>{sv.name}</Text>
            <Text style={s.small}>dès {formatFCFA(sv.price)}</Text>
          </Pressable>
        ))}
      </View>
      <Button title="Demander un soin" disabled={Boolean(active && active.status !== 'paid')} onPress={() => nav.push('service')} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          ['✓ Diplômés', 'Vérifiés par l’Ordre'],
          ['⏱ ~20 min', 'Délai moyen'],
          ['📱 Mobile money', 'Airtel, Moov, Zamani'],
        ].map(([t, d]) => (
          <View key={t} style={{ flex: 1, backgroundColor: colors.block, borderRadius: 10, padding: 10 }}>
            <Text style={{ fontWeight: '700', fontSize: 12 }}>{t}</Text>
            <Text style={s.small}>{d}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

// 03 — Sélection du service
function ServiceSelect() {
  const nav = useNav();
  const a = useAccent();
  const { data } = useServices();
  const [sel, setSel] = useState<string>();
  return (
    <Screen title="Choisir un soin" footer={<Button title="Continuer" disabled={!sel} onPress={() => nav.push('address', { serviceId: sel! })} />}>
      {!data && <ActivityIndicator color={a.main} />}
      {data?.services.map((sv) => (
        <Pressable
          key={sv.id}
          onPress={() => setSel(sv.id)}
          style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: sel === sv.id ? a.main : 'transparent', backgroundColor: sel === sv.id ? a.soft : colors.block }}
        >
          <Text style={{ fontSize: 26 }}>{sv.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.h3}>{sv.name}</Text>
            <Text style={s.small}>{sv.description}</Text>
          </View>
          <Text style={{ fontWeight: '700', color: colors.navy }}>{formatFCFA(sv.price)}</Text>
        </Pressable>
      ))}
    </Screen>
  );
}

// 04 — Adresse & tarif
function AddressPrice({ serviceId }: { serviceId?: string }) {
  const nav = useNav();
  const { api, user } = useSession();
  const { data } = useServices();
  const service = data?.services.find((x) => x.id === serviceId);
  const [pos, setPos] = useState<{ lat: number; lng: number; real: boolean } | null>(null);
  const [address, setAddress] = useState(user?.address ?? '');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    getPosition().then(setPos);
  }, []);
  return (
    <Screen
      title="Adresse & tarif"
      footer={
        <Button
          title="Confirmer la demande"
          disabled={!service || !address.trim() || !pos}
          onPress={async () => {
            const r = await api<CareRequest>('/requests', { json: { serviceId, address, notes, lat: pos!.lat, lng: pos!.lng } });
            nav.reset('tabs');
            nav.push('request', { id: r.id, justSent: '1' });
          }}
        />
      }
    >
      <Card style={{ backgroundColor: colors.block, borderColor: 'transparent' }}>
        <Text style={s.h3}>📍 Lieu du soin</Text>
        <Text style={s.muted}>
          {!pos ? 'Localisation en cours…' : pos.real ? `Position GPS détectée (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})` : 'GPS indisponible — position par défaut : Niamey centre'}
        </Text>
        <Button title="Actualiser ma position" variant="link" onPress={async () => setPos(await getPosition())} />
      </Card>
      <Field label="Adresse / repères" placeholder="ex. Yantala, rue YN-34, portail bleu" value={address} onChangeText={setAddress} />
      <Field label="Informations pour l'infirmier (facultatif)" multiline placeholder="Ordonnance, étage, allergies…" value={notes} onChangeText={setNotes} />
      {service && data && (
        <Card>
          <Row label={`${service.icon} ${service.name}`} value={formatFCFA(service.price)} />
          <Row label="Frais de déplacement" value={formatFCFA(data.travelFee)} />
          <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.line, marginTop: 4, paddingTop: 6 }}>
            <Row label="Total" value={formatFCFA(service.price + data.travelFee)} bold />
          </View>
          <Text style={s.small}>Paiement après le soin, par mobile money ou en espèces.</Text>
        </Card>
      )}
    </Screen>
  );
}

// 05 → 10 — Parcours piloté par le statut
function RequestFlow({ id, justSent }: { id?: string; justSent: boolean }) {
  const { api } = useSession();
  const { data: r, setData, error } = useResource<CareRequest>(`/requests/${id}`);
  const [sending, setSending] = useState(justSent);
  useSocketEvent<CareRequest>('request:update', (u) => u.id === id && setData(u));
  useEffect(() => {
    if (!sending) return;
    const t = setTimeout(() => setSending(false), 1400);
    return () => clearTimeout(t);
  }, [sending]);

  if (error) return <Screen title="Demande"><Text style={s.error}>{error}</Text></Screen>;
  if (!r) return <Loading />;
  if (sending)
    return (
      <Screen title="Envoi" center back={false}>
        <ActivityIndicator size="large" color={colors.blue} />
        <Text style={s.h2}>Envoi de votre demande…</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>Nous prévenons les infirmiers disponibles près de chez vous.</Text>
      </Screen>
    );

  switch (r.status) {
    case 'searching':
      return (
        <Screen title={r.code} center>
          <Pulse icon="🩺" />
          <Text style={s.h2}>Recherche d'un infirmier…</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            {r.serviceName} · {r.address}
          </Text>
          <Text style={[s.small, { textAlign: 'center' }]}>Vous serez notifié dès qu'un infirmier accepte.</Text>
          <Button title="Annuler la demande" variant="outline" onPress={async () => setData(await api<CareRequest>(`/requests/${r.id}/cancel`, { method: 'POST' }))} />
        </Screen>
      );
    case 'assigned':
    case 'en_route':
    case 'in_progress':
      return <Tracking r={r} />;
    case 'awaiting_payment':
      return <Payment r={r} onPaid={setData} />;
    case 'paid':
      return <Rating r={r} onRated={setData} />;
    default:
      return <Summary r={r} />;
  }
}

function NurseCard({ r }: { r: CareRequest }) {
  return (
    <Card>
      <View style={s.row}>
        <Avatar name={r.nurseName} size={54} />
        <View style={{ flex: 1 }}>
          <Text style={s.h3}>{r.nurseName}</Text>
          <Text style={s.small}>Infirmier(ère) diplômé(e) d'État</Text>
          <Text style={{ color: colors.gold, fontWeight: '700' }}>★ {r.nurseRating?.toFixed(1) ?? '—'}</Text>
        </View>
        {r.nursePhone && (
          <Pressable onPress={() => call(r.nursePhone)} style={{ backgroundColor: colors.block, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 20 }}>📞</Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

// 07 — Infirmier trouvé + 08 — Suivi en direct
function Tracking({ r }: { r: CareRequest }) {
  const a = useAccent();
  const [chat, setChat] = useState(false);
  const [incident, setIncident] = useState(false);
  const steps: [string, string, string | undefined][] = [
    ['assigned', 'Demande acceptée', r.assignedAt],
    ['en_route', 'Infirmier en route', undefined],
    ['in_progress', 'Soin en cours', r.startedAt],
  ];
  const idx = ['assigned', 'en_route', 'in_progress'].indexOf(r.status);
  return (
    <Screen title={r.status === 'assigned' ? 'Infirmier trouvé' : 'Suivi en direct'}>
      {r.status === 'assigned' && <Text style={s.success}>✓ Votre demande a été acceptée</Text>}
      <NurseCard r={r} />
      <View style={[s.card, s.between, { backgroundColor: a.soft, borderColor: 'transparent' }]}>
        <Text style={s.text}>{r.status === 'in_progress' ? 'Intervention en cours' : 'Arrivée estimée'}</Text>
        <Text style={{ fontSize: 24, fontWeight: '800', color: a.main }}>{r.status === 'in_progress' ? '🩺' : `${r.etaMin ?? '—'} min`}</Text>
      </View>
      <View style={{ gap: 10, paddingLeft: 4 }}>
        {steps.map(([k, label, at], i) => (
          <View key={k} style={s.between}>
            <View style={s.row}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: i <= idx ? a.main : colors.line }} />
              <Text style={[s.text, i <= idx ? { fontWeight: '700' } : { color: colors.muted }]}>{label}</Text>
            </View>
            {at && <Text style={s.small}>{fmtTime(at)}</Text>}
          </View>
        ))}
      </View>
      <Button title={`Message à l'infirmier${r.messages.length ? ` (${r.messages.length})` : ''}`} variant="outline" onPress={() => setChat(true)} />
      <Button title="Signaler un problème" variant="link" onPress={() => setIncident(true)} />
      <ChatSheet r={r} visible={chat} onClose={() => setChat(false)} />
      <IncidentSheet requestId={r.id} visible={incident} onClose={() => setIncident(false)} />
    </Screen>
  );
}

// 09 — Paiement
function Payment({ r, onPaid }: { r: CareRequest; onPaid: (r: CareRequest) => void }) {
  const { api, user } = useSession();
  const [method, setMethod] = useState<PaymentMethod>('airtel');
  const [phone, setPhone] = useState(user?.phone?.replace('+227', '') ?? '');
  return (
    <Screen
      title="Paiement"
      footer={
        <Button
          title={`Payer ${formatFCFA(r.total)}`}
          onPress={async () => {
            await new Promise((res) => setTimeout(res, 1200)); // confirmation opérateur (simulée)
            onPaid(await api<CareRequest>(`/requests/${r.id}/pay`, { json: { method, phone } }));
          }}
        />
      }
    >
      <Text style={s.success}>✓ Soin terminé par {r.nurseName}</Text>
      <Segmented value={method} onChange={setMethod} options={(['airtel', 'moov', 'zamani', 'cash'] as PaymentMethod[]).map((m) => [m, PAYMENT_LABELS[m]])} />
      <Card>
        <Row label={r.serviceName} value={formatFCFA(r.price)} />
        <Row label="Déplacement" value={formatFCFA(r.travelFee)} />
        <Row label="Total" value={formatFCFA(r.total)} bold />
      </Card>
      {method !== 'cash' && <Field label={`Numéro ${PAYMENT_LABELS[method]}`} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />}
      <ReportView r={r} />
    </Screen>
  );
}

// 10 — Évaluation
function Rating({ r, onRated }: { r: CareRequest; onRated: (r: CareRequest) => void }) {
  const { api } = useSession();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <Screen title="Évaluation">
      <Text style={s.success}>✓ Paiement confirmé · réf. {r.payment?.reference}</Text>
      <Card style={{ alignItems: 'center', gap: 12 }}>
        <Avatar name={r.nurseName} size={64} />
        <Text style={[s.h2, { textAlign: 'center' }]}>Comment s'est passé votre soin avec {r.nurseName?.split(' ')[0]} ?</Text>
        <Stars value={stars} onChange={setStars} size={40} />
        <View style={{ alignSelf: 'stretch' }}>
          <Field label="Commentaire (facultatif)" multiline value={comment} onChangeText={setComment} />
        </View>
        <Button style={{ alignSelf: 'stretch' }} title="Envoyer l'évaluation" onPress={async () => onRated(await api<CareRequest>(`/requests/${r.id}/rate`, { json: { stars, comment } }))} />
      </Card>
    </Screen>
  );
}

function Summary({ r }: { r: CareRequest }) {
  const nav = useNav();
  return (
    <Screen title={r.code}>
      {r.status === 'rated' && <Text style={s.success}>Merci pour votre évaluation ! 💙</Text>}
      <Card>
        <View style={s.between}>
          <Text style={s.h3}>{r.serviceName}</Text>
          <StatusBadge status={r.status} />
        </View>
        <Text style={s.small}>
          {fmtDate(r.createdAt)} · {r.address}
        </Text>
        {r.nurseName && <Text style={s.text}>Infirmier : {r.nurseName}</Text>}
        {r.rating && <Stars value={r.rating.stars} size={18} />}
      </Card>
      <ReportView r={r} />
      {r.payment && (
        <Card>
          <Text style={s.h3}>Reçu de paiement</Text>
          <Row label="Référence" value={r.payment.reference} />
          <Row label="Date" value={fmtDate(r.payment.paidAt)} />
          <Row label="Moyen" value={PAYMENT_LABELS[r.payment.method]} />
          <Row label="Montant" value={formatFCFA(r.payment.amount)} bold />
        </Card>
      )}
      <Button title="Retour à l'accueil" onPress={() => nav.reset('tabs')} />
    </Screen>
  );
}

// Historique
function History() {
  const nav = useNav();
  const { data, loading } = useMine();
  const [filter, setFilter] = useState('all');
  const types = [...new Set((data ?? []).map((r) => r.serviceName))];
  const list = (data ?? []).filter((r) => filter === 'all' || r.serviceName === filter);
  return (
    <Screen title="Historique" back={false}>
      {types.length > 0 && <Segmented value={filter} onChange={setFilter} options={[['all', 'Tous'], ...types.map((t) => [t, t] as [string, string])]} />}
      {loading && <ActivityIndicator />}
      {!loading && list.length === 0 && <Text style={[s.muted, { textAlign: 'center' }]}>Aucune intervention pour le moment.</Text>}
      {list.map((r) => (
        <Card key={r.id} onPress={() => nav.push('request', { id: r.id })}>
          <View style={s.between}>
            <Text style={s.h3}>{r.serviceName}</Text>
            <Text style={{ fontWeight: '700' }}>{formatFCFA(r.total)}</Text>
          </View>
          <View style={s.between}>
            <Text style={s.small}>
              {fmtDate(r.createdAt)} · {r.nurseName ?? STATUS_LABELS[r.status]}
            </Text>
            <StatusBadge status={r.status} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

// Profil
function Profile() {
  const { user, setUser, logout, api, unread, markRead } = useSession();
  const [tab, setTab] = useState<'profil' | 'notifs'>(unread ? 'notifs' : 'profil');
  const [name, setName] = useState(user?.name ?? '');
  const [address, setAddress] = useState(user?.address ?? '');
  const [incident, setIncident] = useState(false);
  useEffect(() => {
    if (tab === 'notifs' && unread) markRead();
  }, [tab, unread, markRead]);
  return (
    <Screen title="Mon compte" back={false}>
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
              <Avatar name={user?.name} />
              <View>
                <Text style={s.h3}>{user?.name}</Text>
                <Text style={s.small}>{user?.phone}</Text>
              </View>
            </View>
          </Card>
          <Field label="Nom" value={name} onChangeText={setName} />
          <Field label="Adresse habituelle" value={address} onChangeText={setAddress} />
          <Button title="Enregistrer" onPress={async () => setUser(await api<User>('/me', { method: 'PATCH', json: { name, address } }))} />
          <Button title="Signaler un incident" variant="outline" onPress={() => setIncident(true)} />
          <Badge label="Patient" />
          <Button title="Se déconnecter" variant="link" onPress={logout} />
        </>
      )}
      <IncidentSheet visible={incident} onClose={() => setIncident(false)} />
    </Screen>
  );
}
