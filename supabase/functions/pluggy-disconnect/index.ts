// Edge Function `pluggy-disconnect` (tech §6.0 [CONTRATO]): auth do usuário.
import { disconnectDeps } from '../_shared/pluggy-supabase.ts';
import { handlePluggyDisconnect } from '../_shared/pluggy-webhook.ts';

Deno.serve((request) => handlePluggyDisconnect(request, disconnectDeps()));
