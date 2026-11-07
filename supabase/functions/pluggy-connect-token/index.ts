// Edge Function `pluggy-connect-token` (tech §6.0 [CONTRATO], §6.1.3 passo 2): auth do usuário.
import { handleConnectToken } from '../_shared/pluggy-link.ts';
import { pluggyDeps } from '../_shared/pluggy-supabase.ts';

Deno.serve((request) => handleConnectToken(request, pluggyDeps()));
