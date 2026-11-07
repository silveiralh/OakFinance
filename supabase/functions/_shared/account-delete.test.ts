// `account-delete` (T-094; US-61, RN-102): confirmação "EXCLUIR", só a própria conta, itens apagados na Pluggy antes
// (falha ali não impede a exclusão) e o outro usuário não é afetado.
import assert from 'node:assert/strict';
import {
  type AccountConnection,
  type AccountDeleteDeps,
  handleAccountDelete,
  revokeItems,
} from './account-delete.ts';

const A = '00000000-0000-7000-8000-0000000000a1';
const B = '00000000-0000-7000-8000-0000000000b2';

/** "Banco" em memória: usuários e conexões; apagar o usuário apaga as conexões dele (cascata). */
function world() {
  const users = new Set([A, B]);
  const connections: (AccountConnection & { user_id: string })[] = [
    { id: 'c-a1', user_id: A, external_item_id: 'item-a-bb', deleted_at: null },
    { id: 'c-a2', user_id: A, external_item_id: 'item-a-old', deleted_at: '2026-11-01T00:00:00Z' },
    { id: 'c-b1', user_id: B, external_item_id: 'item-b-nu', deleted_at: null },
  ];
  const deletedItems: string[] = [];
  const deps = (over: Partial<AccountDeleteDeps> = {}): AccountDeleteDeps => ({
    cors: { appOrigin: 'https://app.example.test' },
    caller: (authorization) =>
      Promise.resolve(
        authorization === 'Bearer token-a'
          ? { userId: A, hit: () => Promise.resolve(true) }
          : authorization === 'Bearer token-b'
            ? { userId: B, hit: () => Promise.resolve(true) }
            : null,
      ),
    connector: () => ({
      deleteItem: (id: string) => {
        deletedItems.push(id);
        return Promise.resolve();
      },
    }),
    store: {
      connections: (userId) => Promise.resolve(connections.filter((c) => c.user_id === userId)),
      deleteUser: (userId) => {
        users.delete(userId);
        for (let i = connections.length - 1; i >= 0; i--) {
          if (connections[i]?.user_id === userId) {
            connections.splice(i, 1);
          }
        }
        return Promise.resolve();
      },
    },
    ...over,
  });
  return { users, connections, deletedItems, deps };
}

function request(body: unknown, token = 'token-a', method = 'POST') {
  return new Request('http://fn.test/account-delete', {
    method,
    headers: { Authorization: `Bearer ${token}`, origin: 'https://app.example.test' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

Deno.test('US-61: com "EXCLUIR", apaga os itens na Pluggy, remove o usuário e o outro usuário não é afetado', async () => {
  const w = world();
  const res = await handleAccountDelete(request({ confirm: 'EXCLUIR' }), w.deps());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(w.deletedItems, ['item-a-bb'], 'só o item ainda conectado de A');
  assert.equal(w.users.has(A), false);
  assert.equal(w.users.has(B), true, 'B continua');
  assert.deepEqual(
    w.connections.map((c) => c.id),
    ['c-b1'],
    'as conexões de B ficam',
  );
});

Deno.test('US-61: sem a palavra exata, nada é apagado', async () => {
  for (const body of [{}, { confirm: 'excluir' }, { confirm: 'EXCLUIR ' }, null]) {
    const w = world();
    const res = await handleAccountDelete(request(body), w.deps());
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(w.users.has(A), true);
    assert.deepEqual(w.deletedItems, []);
  }
});

Deno.test('RN-102: sem token válido, 401; o usuário só apaga a própria conta', async () => {
  const w = world();
  assert.equal(
    (await handleAccountDelete(request({ confirm: 'EXCLUIR' }, 'x'), w.deps())).status,
    401,
  );
  const res = await handleAccountDelete(request({ confirm: 'EXCLUIR' }, 'token-b'), w.deps());
  assert.equal(res.status, 200);
  assert.equal(w.users.has(B), false);
  assert.equal(w.users.has(A), true);
  assert.deepEqual(w.deletedItems, ['item-b-nu']);
});

Deno.test('US-61: Pluggy fora do ar ou não configurada não impede a exclusão', async () => {
  const down = world();
  const res = await handleAccountDelete(
    request({ confirm: 'EXCLUIR' }),
    down.deps({ connector: () => ({ deleteItem: () => Promise.reject(new Error('502')) }) }),
  );
  assert.equal(res.status, 200);
  assert.equal(down.users.has(A), false);
  const unset = world();
  const res2 = await handleAccountDelete(
    request({ confirm: 'EXCLUIR' }),
    unset.deps({
      connector: () => {
        throw new Error('sem PLUGGY_CLIENT_ID');
      },
    }),
  );
  assert.equal(res2.status, 200);
  assert.equal(unset.users.has(A), false);
});

Deno.test('revokeItems: conta os itens que não puderam ser apagados', async () => {
  const conns: AccountConnection[] = [
    { id: '1', external_item_id: 'a', deleted_at: null },
    { id: '2', external_item_id: 'b', deleted_at: null },
    { id: '3', external_item_id: 'c', deleted_at: '2026-11-01T00:00:00Z' },
  ];
  assert.equal(await revokeItems([], () => ({ deleteItem: () => Promise.resolve() })), 0);
  assert.equal(
    await revokeItems(conns, () => ({
      deleteItem: (id) => (id === 'a' ? Promise.resolve() : Promise.reject(new Error('404'))),
    })),
    1,
  );
  assert.equal(
    await revokeItems(conns, () => {
      throw new Error('não configurada');
    }),
    2,
  );
});

Deno.test('tech §6.0: só POST; OPTIONS responde o preflight', async () => {
  const w = world();
  assert.equal((await handleAccountDelete(request(null, 'token-a', 'GET'), w.deps())).status, 405);
  const pre = await handleAccountDelete(
    new Request('http://fn.test/account-delete', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.test' },
    }),
    w.deps(),
  );
  assert.ok(pre.status === 204 || pre.status === 200);
  assert.equal(w.users.has(A), true);
});
