// Edge Function `pluggy-webhook` (tech §6.0 [CONTRATO], §6.1.4): auth 'none' + token próprio (`?t=`); 202 imediato.
import { webhookDeps } from '../_shared/pluggy-supabase.ts';
import { handlePluggyWebhook } from '../_shared/pluggy-webhook.ts';

Deno.serve((request) => handlePluggyWebhook(request, webhookDeps()));
