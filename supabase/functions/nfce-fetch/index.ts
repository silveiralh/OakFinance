// Edge Function `nfce-fetch` (tech §6.0 [CONTRATO], §6.2.3): auth do usuário, 30 chamadas por hora.
import { readCorsConfig } from '../_shared/http.ts';
import { handleNfceFetch, nfceBaseUrl } from '../_shared/nfce-fetch.ts';
import { userCaller } from '../_shared/pluggy-supabase.ts';

const env = { get: (name: string) => Deno.env.get(name) };

Deno.serve((request) =>
  handleNfceFetch(request, {
    cors: readCorsConfig(env),
    caller: userCaller,
    fetch: (input, init) => fetch(input, init),
    baseUrl: nfceBaseUrl(env),
  }),
);
