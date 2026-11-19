import { useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { DocKey, NurseProfile, User } from '../../../shared/types';
import { DOC_LIST, DOC_STATUS_LABELS, docOf } from '../../../shared/types';
import { colors, s } from '../theme';
import { Badge, Button, Card, useAccent } from '../ui';
import { useSession } from '../session';
import { fmtDate } from '../common';

const MAX = 5 * 1024 * 1024;
const STATUS_COLORS = {
  missing: ['#eef1f4', colors.muted],
  submitted: ['#fff4e0', '#9a5a00'],
  validated: ['#eaf6e4', '#3b7f22'],
  rejected: ['#fbe9e8', colors.red],
} as const;

export const missingDocs = (n: NurseProfile) => DOC_LIST.filter((d) => ['missing', 'rejected'].includes(docOf(n, d.key).status));

async function pickBase64(): Promise<{ name: string; mime: string; data: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true, base64: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  if (a.size && a.size > MAX) throw new Error('Fichier trop volumineux (5 Mo maximum).');
  const data = Platform.OS === 'web' ? (a.base64 ?? a.uri) : await new File(a.uri).base64();
  const mime = a.mimeType ?? (a.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  return { name: a.name, mime, data };
}

export function NurseDocuments() {
  const a = useAccent();
  const { user, setUser, api, apiUrl, session } = useSession();
  const n = user as NurseProfile | null;
  const [busy, setBusy] = useState<DocKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!n) return null;
  const done = DOC_LIST.filter((d) => docOf(n, d.key).status === 'validated').length;

  const upload = async (key: DocKey) => {
    setError(null);
    try {
      const file = await pickBase64();
      if (!file) return;
      setBusy(key);
      setUser(await api<User>(`/nurse/documents/${key}`, { json: file }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={s.between}>
        <Text style={s.h3}>Mes documents</Text>
        <Text style={s.small}>
          {done}/{DOC_LIST.length} validés
        </Text>
      </View>
      <View style={{ height: 8, backgroundColor: colors.block, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ width: `${(done / DOC_LIST.length) * 100}%`, height: '100%', backgroundColor: a.main }} />
      </View>
      <Text style={s.small}>PDF ou photo (JPEG, PNG), 5 Mo maximum. La coordination vérifie chaque pièce et vous notifie.</Text>
      {error && <Text style={s.error}>{error}</Text>}
      {DOC_LIST.map((d) => {
        const doc = docOf(n, d.key);
        const [bg, fg] = STATUS_COLORS[doc.status];
        return (
          <Card key={d.key} style={doc.status === 'rejected' ? { borderColor: '#f0b8b4', backgroundColor: '#fffafa' } : undefined}>
            <View style={[s.between, { alignItems: 'flex-start' }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontWeight: '700', color: colors.navy }}>{d.label}</Text>
                <Text style={s.small}>{doc.fileName ? `${doc.fileName} · ${fmtDate(doc.uploadedAt!)}` : d.hint}</Text>
                {doc.status === 'rejected' && doc.reviewNote && <Text style={[s.small, { color: colors.red }]}>Motif : {doc.reviewNote}</Text>}
              </View>
              <Badge label={DOC_STATUS_LABELS[doc.status]} bg={bg} fg={fg} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              {doc.fileName && (
                <Button
                  title="Voir"
                  variant="outline"
                  onPress={() => Linking.openURL(`${apiUrl}/api/nurse/documents/${d.key}?token=${encodeURIComponent(session!.token)}`)}
                />
              )}
              {doc.status !== 'validated' && (
                <Button title={busy === d.key ? 'Envoi…' : doc.status === 'missing' ? 'Ajouter' : 'Remplacer'} disabled={busy !== null} onPress={() => upload(d.key)} />
              )}
            </View>
          </Card>
        );
      })}
    </View>
  );
}
