import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SessionProvider, rawApi, useSession } from './src/session';
import { AccentContext, Button, Loading, Logo } from './src/ui';
import { colors, nurseAccent, patientAccent, s } from './src/theme';
import PatientApp from './src/patient/PatientApp';
import NurseApp from './src/nurse/NurseApp';
import { APP_VERSION } from '../shared/types';

export default function App() {
  const [splash, setSplash] = useState(true);
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Root />
      </SessionProvider>
      {splash && <Splash onDone={() => setSplash(false)} />}
    </SafeAreaProvider>
  );
}

// Écran d'ouverture : le symbole Kulawa tourne 5 s, puis fondu vers la plateforme.
function Splash({ onDone }: { onDone: () => void }) {
  const spin = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1200, easing: Easing.bezier(0.6, 0, 0.4, 1), useNativeDriver: true }));
    loop.start();
    Animated.timing(word, { toValue: 1, duration: 600, delay: 250, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 450, useNativeDriver: true }).start(() => {
        loop.stop();
        onDone();
      });
    }, 5000);
    return () => clearTimeout(t);
  }, [spin, word, fade, onDone]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', gap: 22, opacity: fade }]}>
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Image source={require('./assets/logo-symbol.png')} style={{ width: 112, height: 112 }} />
      </Animated.View>
      <Animated.Text style={{ fontSize: 40, fontWeight: '800', color: '#1F3A5F', letterSpacing: -0.5, opacity: word }}>Kulawa</Animated.Text>
    </Animated.View>
  );
}

function Root() {
  const { ready, session } = useSession();
  const [mode, setMode] = useState<'patient' | 'nurse' | null>(null);
  const role = session?.role === 'nurse' || session?.role === 'patient' ? session.role : mode;
  if (!ready) return <Loading />;
  const accent = role === 'nurse' ? nurseAccent : patientAccent;
  return (
    <AccentContext.Provider value={accent}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff', borderTopWidth: 4, borderTopColor: role ? accent.main : colors.navy }} edges={['top']}>
        <StatusBar style="dark" />
        {role === 'patient' ? (
          <WithBack onBack={session ? undefined : () => setMode(null)}>
            <PatientApp />
          </WithBack>
        ) : role === 'nurse' ? (
          <WithBack onBack={session ? undefined : () => setMode(null)}>
            <NurseApp />
          </WithBack>
        ) : (
          <Welcome onPick={setMode} />
        )}
      </SafeAreaView>
    </AccentContext.Provider>
  );
}

function WithBack({ onBack, children }: { onBack?: () => void; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      {children}
      {onBack && (
        <Pressable onPress={onBack} style={{ position: 'absolute', top: 8, left: 12, padding: 6 }} hitSlop={10}>
          <Text style={{ fontSize: 22, color: colors.navy }}>←</Text>
        </Pressable>
      )}
    </View>
  );
}

function Welcome({ onPick }: { onPick: (r: 'patient' | 'nurse') => void }) {
  const { apiUrl, setApiUrl } = useSession();
  const [url, setUrl] = useState(apiUrl);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <ScrollView style={{ backgroundColor: colors.navy }} contentContainerStyle={{ padding: 24, gap: 18, flexGrow: 1, justifyContent: 'center' }}>
      <Text style={{ color: '#9fb7d1', letterSpacing: 3, fontSize: 12 }}>SOINS INFIRMIERS À DOMICILE · NIAMEY</Text>
      <Logo size={52} badge />
      <Text style={{ color: '#c9d7e6', fontSize: 17 }}>Un infirmier diplômé chez vous en quelques minutes.</Text>
      <Pressable onPress={() => onPick('patient')} style={{ borderWidth: 1.5, borderColor: '#2f6fcc', borderRadius: 16, padding: 18, gap: 4, backgroundColor: 'rgba(255,255,255,.05)' }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>● Je suis patient</Text>
        <Text style={{ color: '#b6c6d8' }}>Demander un soin, suivre l'infirmier, payer par mobile money.</Text>
      </Pressable>
      <Pressable onPress={() => onPick('nurse')} style={{ borderWidth: 1.5, borderColor: colors.teal, borderRadius: 16, padding: 18, gap: 4, backgroundColor: 'rgba(255,255,255,.05)' }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>● Je suis infirmier</Text>
        <Text style={{ color: '#b6c6d8' }}>Recevoir les demandes à proximité et suivre mes gains.</Text>
      </Pressable>
      <View style={{ gap: 8, marginTop: 12 }}>
        <Text style={{ color: '#9fb7d1', fontSize: 13 }}>Adresse du serveur Kulawa</Text>
        <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={[s.input, { backgroundColor: '#fff' }]} />
        <Button
          title="Enregistrer & tester"
          variant="outline"
          style={{ backgroundColor: '#fff', borderRadius: 10 }}
          onPress={async () => {
            setApiUrl(url);
            try {
              await rawApi(url, '/health');
              setStatus('✓ Serveur joignable');
            } catch (e) {
              setStatus(`✕ ${(e as Error).message}`);
            }
          }}
        />
        {status && <Text style={{ color: status.startsWith('✓') ? '#8fd36f' : '#ffb4ae' }}>{status}</Text>}
      </View>
      <Text style={{ color: '#8ea6c0', fontSize: 12 }}>Version {APP_VERSION}</Text>
    </ScrollView>
  );
}
