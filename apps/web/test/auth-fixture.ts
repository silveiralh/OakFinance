// Sessão fixa para os testes de componente: um usuário com banco em memória e um motor parado.
import { vi } from 'vitest';
import type { AuthStatus, AuthValue } from '../src/app/auth';
import { OakDb } from '../src/data/db';
import { SyncEngine } from '../src/data/sync/engine';

let n = 0;

export function fakeAuth(
  status: AuthStatus = 'signedIn',
  overrides: Partial<AuthValue> = {},
): AuthValue {
  n += 1;
  const db = new OakDb(`auth-fixture-${n}`);
  const engine = new SyncEngine({
    db,
    transport: {
      hasSession: () => Promise.resolve(true),
      rpc: () => Promise.resolve({ data: null, error: { code: 'offline' }, status: 0 }),
    },
    isOnline: () => false,
  });
  return {
    status,
    user: status === 'signedIn' ? { userId: `u${n}`, db, engine } : null,
    client: null,
    signInWithGoogle: vi.fn(() => Promise.resolve(true)),
    signOut: vi.fn(() => Promise.resolve(true)),
    pending: vi.fn(() => Promise.resolve(0)),
    ...overrides,
  };
}
