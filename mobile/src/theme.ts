import { StyleSheet } from 'react-native';

export const colors = {
  navy: '#0b2a4a',
  blue: '#0b4a9c',
  teal: '#14a39a',
  green: '#4fa82e',
  gold: '#d9a030',
  red: '#c8423b',
  orange: '#d97f1e',
  bg: '#ffffff',
  block: '#eef1f4',
  line: '#dde3e9',
  text: '#13202e',
  muted: '#66727f',
};

export type Accent = { main: string; soft: string };
export const patientAccent: Accent = { main: colors.blue, soft: '#e6eef9' };
export const nurseAccent: Accent = { main: colors.teal, soft: '#e3f5f3' };

export const s = StyleSheet.create({
  screen: { padding: 16, gap: 14, paddingBottom: 120 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 16, gap: 8 },
  h1: { fontSize: 24, fontWeight: '800', color: colors.navy },
  h2: { fontSize: 18, fontWeight: '800', color: colors.navy },
  h3: { fontSize: 16, fontWeight: '700', color: colors.navy },
  text: { fontSize: 15, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  small: { fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  center: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: colors.navy, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: colors.text, backgroundColor: '#fff' },
  error: { color: colors.red, fontSize: 14 },
  note: { backgroundColor: colors.block, borderRadius: 8, padding: 10, fontStyle: 'italic', color: colors.text },
  success: { backgroundColor: '#eaf6e4', color: '#2f6c19', borderRadius: 10, padding: 12, fontWeight: '600', overflow: 'hidden' },
  warn: { backgroundColor: '#fff4e0', color: '#7d4a00', borderRadius: 10, padding: 12, overflow: 'hidden' },
  devHint: { backgroundColor: '#fffbea', borderWidth: 1, borderStyle: 'dashed', borderColor: '#e4c552', color: '#6b5300', padding: 8, borderRadius: 8, textAlign: 'center', fontSize: 13 },
});
