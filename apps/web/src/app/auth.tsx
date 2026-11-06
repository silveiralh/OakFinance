// Sessão e dados do usuário (US-01, RN-100, RN-101): a sessão persistida abre o app sem rede; com o login, abre
// o banco local `oakfinance_<userId>` e liga o motor de sync. Sair apaga o banco local (com o G16 antes).
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { deleteUserDb, OakDb } from '../data/db';
import type { SyncEngine } from '../data/sync/engine';
import { pendingCount } from '../data/sync/outbox';
import { getEnv } from '../lib/env';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unconfigured';

export interface UserSession {
  userId: string;
  db: OakDb;
  engine: SyncEngine;
}

export interface AuthValue {
  status: AuthStatus;
  user: UserSession | null;
  client: SupabaseClient | null;
  signInWithGoogle(options?: { selectAccount?: boolean }): Promise<boolean>;
  /** `discard`: sai mesmo com alterações na fila. `send`: sincroniza antes; devolve `false` se sobrou fila. */
  signOut(mode: 'send' | 'discard'): Promise<boolean>;
  pending(): Promise<number>;
}

/** Exportado para os testes de componente montarem uma sessão fixa. */
export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth fora do AuthProvider');
  }
  return value;
}

/** Abre o banco do usuário e cria o motor (carregado sob demanda: zod e o sync ficam fora do bundle inicial). */
async function openUser(userId: string, client: SupabaseClient): Promise<UserSession> {
  const [{ SyncEngine, browserLocks }, { fromSupabase }] = await Promise.all([
    import('../data/sync/engine'),
    import('../data/sync/transport'),
  ]);
  const db = new OakDb(userId);
  const engine = new SyncEngine({
    db,
    transport: fromSupabase(client),
    locks: browserLocks(),
    appVersion: getEnv().version,
  });
  return { userId, db, engine };
}

export interface AuthProviderProps {
  children: ReactNode;
  /** Injetável nos testes; padrão: o cliente do app. */
  client?: SupabaseClient | null;
  /** Liga os gatilhos do sync (desligado nos testes de componente). */
  autoSync?: boolean;
}

export function AuthProvider({ children, client: injected, autoSync = true }: AuthProviderProps) {
  // O supabase-js (~45 KB gzip) vem sob demanda, fora do bundle inicial; `undefined` = carregando
  const [client, setClient] = useState<SupabaseClient | null | undefined>(
    injected !== undefined ? injected : getEnv().supabasePublishableKey ? undefined : null,
  );
  const [status, setStatus] = useState<AuthStatus>(client === null ? 'unconfigured' : 'loading');

  useEffect(() => {
    if (client !== undefined) {
      return;
    }
    let alive = true;
    void import('../lib/supabase').then((m) => {
      if (alive) {
        const created = m.getSupabase();
        setClient(created);
        if (!created) {
          setStatus('unconfigured');
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [client]);
  const [user, setUser] = useState<UserSession | null>(null);

  useEffect(() => {
    if (!client) {
      return;
    }
    let current: UserSession | null = null;
    let wanted: string | null | undefined;
    const apply = async (userId: string | null) => {
      if (wanted === userId) {
        return;
      }
      wanted = userId;
      current?.db.close();
      current = null;
      const next = userId ? await openUser(userId, client) : null;
      if (wanted !== userId) {
        next?.db.close();
        return;
      }
      current = next;
      setUser(next);
      setStatus(userId ? 'signedIn' : 'signedOut');
    };
    // getSession lê a sessão guardada: funciona sem rede (US-01, "abrir sem internet")
    void client.auth.getSession().then(({ data }) => apply(data.session?.user.id ?? null));
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      void apply(session?.user.id ?? null);
    });
    return () => {
      data.subscription.unsubscribe();
      current?.db.close();
    };
  }, [client]);

  useEffect(() => {
    if (!user || !autoSync) {
      return;
    }
    // Seeds depois do primeiro pull que der certo (tech §3.8): um seed apagado em outro aparelho já chegou como
    // tombstone e não volta
    let seeded = false;
    const offSeeds = user.engine.subscribe(() => {
      if (seeded || user.engine.getSnapshot().phase !== 'done') {
        return;
      }
      seeded = true;
      void import('../data/seeds')
        .then((m) => m.ensureSeeds(user.db, user.userId))
        .then(async (result) => {
          // RN-05: despesa agendada cuja data chegou vira efetivada na abertura do app
          const promoted = await (await import('../data/scheduled')).promoteDueExpenses(user.db);
          if ((result.ok && result.value > 0) || promoted > 0) {
            user.engine.notifyWrite();
          }
        });
    });
    const stop = user.engine.start();
    let uninstall: (() => void) | undefined;
    if (import.meta.env.VITE_E2E === '1') {
      void import('./e2e/hooks').then((m) => {
        uninstall = m.installE2eHooks(user);
      });
    }
    return () => {
      offSeeds();
      stop();
      uninstall?.();
    };
  }, [user, autoSync]);

  const signInWithGoogle = useCallback(
    async ({ selectAccount = false } = {}) => {
      if (!client) {
        return false;
      }
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          ...(selectAccount && { queryParams: { prompt: 'select_account' } }),
        },
      });
      return !error;
    },
    [client],
  );

  const pending = useCallback(async () => (user ? pendingCount(user.db) : 0), [user]);

  const signOut = useCallback(
    async (mode: 'send' | 'discard') => {
      if (!client || !user) {
        return true;
      }
      if (mode === 'send') {
        await user.engine.syncNow();
        if ((await pendingCount(user.db)) > 0) {
          return false;
        }
      }
      user.db.close();
      await deleteUserDb(user.userId);
      await client.auth.signOut({ scope: 'local' });
      setUser(null);
      setStatus('signedOut');
      return true;
    },
    [client, user],
  );

  const value = useMemo<AuthValue>(
    () => ({ status, user, client: client ?? null, signInWithGoogle, signOut, pending }),
    [status, user, client, signInWithGoogle, signOut, pending],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
