import { useState } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import type { CareRequest, Incident } from '../../shared/types';
import { colors, s } from './theme';
import { Button, Field, Segmented, useAccent } from './ui';
import { useSession } from './session';

export const NIAMEY = { lat: 13.5137, lng: 2.1098 };

/** Position GPS (avec autorisation) — repli sur le centre de Niamey. */
export async function getPosition(): Promise<{ lat: number; lng: number; real: boolean }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { ...NIAMEY, real: false };
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: p.coords.latitude, lng: p.coords.longitude, real: true };
  } catch {
    return { ...NIAMEY, real: false };
  }
}

export function openMaps(lat: number, lng: number, label = 'Patient') {
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  Linking.openURL(url).catch(() => {});
}

export const call = (phone?: string) => phone && Linking.openURL(`tel:${phone}`).catch(() => {});

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(11,42,74,.45)' }} onPress={onClose} />
      <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 12, maxHeight: '85%' }}>
        <View style={s.between}>
          <Text style={s.h2}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ fontSize: 20 }}>✕</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

export function ChatSheet({ r, visible, onClose }: { r: CareRequest; visible: boolean; onClose: () => void }) {
  const { api, role } = useSession();
  const a = useAccent();
  const [text, setText] = useState('');
  const quick = role === 'patient' ? ['Je suis à la maison', 'Le portail est ouvert', 'Appelez-moi en arrivant'] : ['Je suis en route', 'Je suis devant chez vous', 'Préparez l’ordonnance svp'];
  const send = async (t: string) => {
    if (!t.trim()) return;
    await api(`/requests/${r.id}/messages`, { json: { text: t } });
    setText('');
  };
  return (
    <Sheet visible={visible} title="Messages" onClose={onClose}>
      <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 6 }}>
        {r.messages.length === 0 && <Text style={[s.muted, { textAlign: 'center' }]}>Aucun message.</Text>}
        {r.messages.map((m) => {
          const me = m.from === role;
          return (
            <View key={m.id} style={{ alignSelf: me ? 'flex-end' : 'flex-start', backgroundColor: me ? a.main : colors.block, borderRadius: 14, padding: 10, maxWidth: '80%' }}>
              <Text style={{ color: me ? '#fff' : colors.text }}>{m.text}</Text>
              <Text style={{ color: me ? '#dfe8f5' : colors.muted, fontSize: 10, alignSelf: 'flex-end' }}>{fmtTime(m.at)}</Text>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {quick.map((q) => (
          <Pressable key={q} onPress={() => send(q)} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Text style={{ fontSize: 13 }}>{q}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.row}>
        <TextInput style={[s.input, { flex: 1 }]} value={text} onChangeText={setText} placeholder="Votre message…" placeholderTextColor="#9aa4ae" />
        <Button title="Envoyer" onPress={() => send(text)} />
      </View>
    </Sheet>
  );
}

export function IncidentSheet({ requestId, visible, onClose }: { requestId?: string; visible: boolean; onClose: () => void }) {
  const { api } = useSession();
  const [category, setCategory] = useState<Incident['category']>('retard');
  const [description, setDescription] = useState('');
  const [done, setDone] = useState(false);
  const close = () => {
    setDone(false);
    setDescription('');
    onClose();
  };
  return (
    <Sheet visible={visible} title="Signaler un incident" onClose={close}>
      {done ? (
        <>
          <Text style={s.success}>✓ Signalement transmis à la coordination Kulawa.</Text>
          <Button title="Fermer" onPress={close} />
        </>
      ) : (
        <>
          <Segmented
            value={category}
            onChange={setCategory}
            options={[
              ['retard', 'Retard'],
              ['comportement', 'Comportement'],
              ['paiement', 'Paiement'],
              ['medical', 'Médical'],
              ['autre', 'Autre'],
            ]}
          />
          <Field label="Description" multiline value={description} onChangeText={setDescription} />
          <Button
            title="Envoyer le signalement"
            variant="danger"
            disabled={!description.trim()}
            onPress={async () => {
              await api('/incidents', { json: { requestId, category, description } });
              setDone(true);
            }}
          />
        </>
      )}
    </Sheet>
  );
}

export function ReportView({ r }: { r: CareRequest }) {
  const a = useAccent();
  if (!r.report) return null;
  const rp = r.report;
  const vitals = [rp.bloodPressure && `Tension ${rp.bloodPressure}`, rp.temperature && `Temp. ${rp.temperature} °C`, rp.glycemia && `Glycémie ${rp.glycemia}`].filter(Boolean) as string[];
  return (
    <View style={s.card}>
      <Text style={s.h3}>Compte-rendu de l'infirmier</Text>
      <Text style={s.text}>
        <Text style={{ fontWeight: '700' }}>Actes : </Text>
        {rp.acts}
      </Text>
      {vitals.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {vitals.map((v) => (
            <Text key={v} style={{ backgroundColor: a.soft, color: a.main, fontWeight: '600', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' }}>
              {v}
            </Text>
          ))}
        </View>
      )}
      {rp.observations && <Text style={s.text}>{rp.observations}</Text>}
      {rp.recommendations && <Text style={[s.text, { fontStyle: 'italic' }]}>{rp.recommendations}</Text>}
    </View>
  );
}
