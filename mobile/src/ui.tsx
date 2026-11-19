import { createContext, useContext, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RequestStatus } from '../../shared/types';
import { STATUS_LABELS } from '../../shared/types';
import { colors, s, type Accent } from './theme';
import { useNavOptional } from './nav';
import { useSession } from './session';

export const AccentContext = createContext<Accent>({ main: colors.blue, soft: '#e6eef9' });
export const useAccent = () => useContext(AccentContext);

export function Button({
  title,
  onPress,
  variant = 'solid',
  disabled,
  style,
}: {
  title: string;
  onPress: () => unknown | Promise<unknown>;
  variant?: 'solid' | 'outline' | 'danger' | 'link';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const a = useAccent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bg = variant === 'solid' ? a.main : variant === 'danger' ? colors.red : 'transparent';
  const fg = variant === 'solid' || variant === 'danger' ? '#fff' : variant === 'link' ? a.main : a.main;
  return (
    <View style={style}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled || busy}
        onPress={async () => {
          setError(null);
          setBusy(true);
          try {
            await onPress();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        style={({ pressed }) => ({
          backgroundColor: bg,
          borderWidth: variant === 'link' ? 0 : 1.5,
          borderColor: variant === 'danger' ? colors.red : a.main,
          borderRadius: 10,
          paddingVertical: variant === 'link' ? 8 : 14,
          paddingHorizontal: 16,
          alignItems: 'center',
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        })}
      >
        {busy ? (
          <ActivityIndicator color={fg} />
        ) : (
          <Text style={{ color: fg, fontWeight: '700', fontSize: 16, textDecorationLine: variant === 'link' ? 'underline' : 'none' }}>{title}</Text>
        )}
      </Pressable>
      {error && <Text style={[s.error, { marginTop: 6 }]}>{error}</Text>}
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#9aa4ae" style={[s.input, props.multiline && { minHeight: 70, textAlignVertical: 'top' }]} {...props} />
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle | ViewStyle[]; onPress?: () => void }) {
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, style as ViewStyle, pressed && { opacity: 0.8 }]}>
        {children}
      </Pressable>
    );
  return <View style={[s.card, style as ViewStyle]}>{children}</View>;
}

export function Header({ title, back = true, right }: { title: string; back?: boolean; right?: ReactNode }) {
  const nav = useNavOptional();
  const a = useAccent();
  const canBack = back && nav != null && nav.stack.length > 1;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.block, backgroundColor: '#fff' }}>
      {canBack ? (
        <Pressable onPress={nav.back} hitSlop={12} style={{ width: 40 }}>
          <Text style={{ fontSize: 24, color: colors.navy }}>←</Text>
        </Pressable>
      ) : (
        <Text style={{ width: 70, color: a.main, fontWeight: '800', fontSize: 12 }}>KULAWA</Text>
      )}
      <Text style={[s.h3, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ width: canBack ? 40 : 70, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

/** Écran défilant avec en-tête et pied fixe optionnel. */
export function Screen({ title, children, footer, back, center }: { title: string; children: ReactNode; footer?: ReactNode; back?: boolean; center?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header title={title} back={back} />
      <ScrollView contentContainerStyle={[s.screen, center && { flexGrow: 1, justifyContent: 'center', alignItems: 'center' }]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer && <View style={{ padding: 16, borderTopWidth: 1, borderColor: colors.block, backgroundColor: '#fff' }}>{footer}</View>}
    </View>
  );
}

export function Stars({ value, onChange, size = 30 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Pressable key={i} disabled={!onChange} onPress={() => onChange?.(i)} hitSlop={6} accessibilityLabel={`${i} étoiles`}>
          <Text style={{ fontSize: size, color: i <= Math.round(value) ? colors.gold : '#d6dbe1' }}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

const STATUS_COLORS: Record<RequestStatus, [string, string]> = {
  searching: ['#fff4e0', '#9a5a00'],
  assigned: ['#e6eef9', colors.blue],
  en_route: ['#e6eef9', colors.blue],
  in_progress: ['#e3f5f3', '#0e7d76'],
  awaiting_payment: ['#fdf0e2', '#a4570f'],
  paid: ['#eaf6e4', '#3b7f22'],
  rated: ['#eaf6e4', '#3b7f22'],
  cancelled: ['#fbe9e8', colors.red],
};

export function Badge({ label, bg = colors.block, fg = colors.muted }: { label: string; bg?: string; fg?: string }) {
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export const StatusBadge = ({ status }: { status: RequestStatus }) => <Badge label={STATUS_LABELS[status]} bg={STATUS_COLORS[status][0]} fg={STATUS_COLORS[status][1]} />;

export function Avatar({ name, size = 48 }: { name?: string; size?: number }) {
  const a = useAccent();
  const ini = (name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: a.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: a.main, fontWeight: '800', fontSize: size * 0.38 }}>{ini}</Text>
    </View>
  );
}

export function Loading() {
  const a = useAccent();
  return (
    <View style={[{ flex: 1 }, s.center]}>
      <ActivityIndicator size="large" color={a.main} />
    </View>
  );
}

export function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={[s.between, { paddingVertical: 5 }]}>
      <Text style={[s.text, bold && { fontWeight: '800', fontSize: 17, color: colors.navy }]}>{label}</Text>
      <Text style={[s.text, bold && { fontWeight: '800', fontSize: 17, color: colors.navy }]}>{value}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  const a = useAccent();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.block, borderRadius: 10, padding: 4, gap: 4 }}>
      {options.map(([k, label]) => (
        <Pressable key={k} onPress={() => onChange(k)} style={{ flexGrow: 1, paddingVertical: 9, paddingHorizontal: 6, borderRadius: 8, backgroundColor: value === k ? '#fff' : 'transparent', alignItems: 'center' }}>
          <Text style={{ fontWeight: '600', fontSize: 13, color: value === k ? a.main : colors.muted }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Tabs({ tabs, current, onChange }: { tabs: [string, string, string][]; current: string; onChange: (k: string) => void }) {
  const a = useAccent();
  const { unread } = useSession();
  return (
    <SafeAreaView edges={['bottom']} style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: colors.line, backgroundColor: '#fff' }}>
      {tabs.map(([k, icon, label]) => (
        <Pressable key={k} onPress={() => onChange(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
          <Text style={{ fontSize: 20, opacity: current === k ? 1 : 0.5 }}>{icon}</Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: current === k ? a.main : colors.muted }}>
            {label}
            {k === 'profile' && unread > 0 ? ` (${unread})` : ''}
          </Text>
        </Pressable>
      ))}
    </SafeAreaView>
  );
}

export function ToastBanner() {
  const { toast, dismissToast } = useSession();
  const a = useAccent();
  if (!toast) return null;
  return (
    <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 }} pointerEvents="box-none">
      <Pressable onPress={dismissToast} style={{ margin: 10, backgroundColor: colors.navy, borderLeftWidth: 5, borderLeftColor: a.main, borderRadius: 12, padding: 12, gap: 2 }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>{toast.title}</Text>
        <Text style={{ color: '#d5dee8', fontSize: 13 }}>{toast.body}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

export function Pulse({ icon }: { icon: string }) {
  const a = useAccent();
  return (
    <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: a.soft, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: a.main, alignSelf: 'center' }}>
      <Text style={{ fontSize: 44 }}>{icon}</Text>
    </View>
  );
}

export function NotificationList() {
  const { notifications } = useSession();
  const a = useAccent();
  if (!notifications.length) return <Text style={[s.muted, { textAlign: 'center' }]}>Aucune notification.</Text>;
  return (
    <View style={{ gap: 8 }}>
      {notifications.map((n) => (
        <View key={n.id} style={[s.card, { gap: 3, padding: 12 }, !n.read && { borderLeftWidth: 4, borderLeftColor: a.main, backgroundColor: a.soft }]}>
          <Text style={{ fontWeight: '700', color: colors.navy }}>{n.title}</Text>
          <Text style={s.text}>{n.body}</Text>
          <Text style={s.small}>{new Date(n.createdAt).toLocaleString('fr-FR')}</Text>
        </View>
      ))}
    </View>
  );
}
