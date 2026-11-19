import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler } from 'react-native';

// Navigation par pile minimaliste : chaque module (patient / infirmier) déclare ses écrans.
export interface Route {
  name: string;
  params?: Record<string, string>;
}

interface NavValue {
  route: Route;
  stack: Route[];
  push: (name: string, params?: Record<string, string>) => void;
  replace: (name: string, params?: Record<string, string>) => void;
  back: () => void;
  reset: (name: string, params?: Record<string, string>) => void;
}

const Ctx = createContext<NavValue | null>(null);

export function NavProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: initial }]);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, back]);
  const value = useMemo<NavValue>(
    () => ({
      route: stack[stack.length - 1],
      stack,
      push: (name, params) => setStack((s) => [...s, { name, params }]),
      replace: (name, params) => setStack((s) => [...s.slice(0, -1), { name, params }]),
      back,
      reset: (name, params) => setStack([{ name, params }]),
    }),
    [stack, back],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Variante tolérante, pour les composants utilisables hors navigation (écrans de connexion). */
export const useNavOptional = () => useContext(Ctx);

export function useNav() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNav hors NavProvider');
  return v;
}
