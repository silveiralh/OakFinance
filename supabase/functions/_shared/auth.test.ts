// Auth 'secret' das funções do pg_cron (tech §6.0).
import assert from 'node:assert/strict';
import { authorizedSecret, presentedKey, sameSecret, secretKeysFromEnv } from './auth.ts';

const envOf = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
const req = (headers: Record<string, string>) =>
  new Request('https://fn.example.test/x', { method: 'POST', headers });

Deno.test('chaves aceitas: SUPABASE_SECRET_KEYS (JSON) e a service role legada', () => {
  assert.deepEqual(
    secretKeysFromEnv(
      envOf({
        SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a","outra":"sb_secret_b","vazia":" ","n":1}',
        SUPABASE_SERVICE_ROLE_KEY: ' legada ',
      }),
    ),
    ['sb_secret_a', 'sb_secret_b', 'legada'],
  );
  assert.deepEqual(secretKeysFromEnv(envOf({ SUPABASE_SECRET_KEYS: 'não é json' })), []);
  assert.deepEqual(secretKeysFromEnv(envOf({ SUPABASE_SECRET_KEYS: '["sb_secret_a"]' })), []);
  assert.deepEqual(secretKeysFromEnv(envOf({})), []);
});

Deno.test('chave apresentada: apikey ou Authorization Bearer', () => {
  assert.equal(presentedKey(req({ apikey: 'k1' })), 'k1');
  assert.equal(presentedKey(req({ Authorization: 'Bearer k2' })), 'k2');
  assert.equal(presentedKey(req({ Authorization: 'Basic k2' })), null);
  assert.equal(presentedKey(req({})), null);
});

Deno.test('só a chave secreta exata autoriza', () => {
  const keys = ['sb_secret_a'];
  assert.equal(authorizedSecret(req({ apikey: 'sb_secret_a' }), keys), 'sb_secret_a');
  assert.equal(authorizedSecret(req({ apikey: 'sb_secret_b' }), keys), null);
  assert.equal(authorizedSecret(req({ apikey: 'sb_secret_a' }), []), null);
  assert.equal(authorizedSecret(req({}), keys), null);
  assert.equal(sameSecret('abc', 'abcd'), false);
  assert.equal(sameSecret('abc', 'abd'), false);
  assert.equal(sameSecret('abc', 'abc'), true);
});
