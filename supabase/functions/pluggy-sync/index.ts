// Edge Function `pluggy-sync` (tech §6.0 [CONTRATO], §6.1.4): auth do usuário (app) ou 'secret' (pg_cron).

import { syncDeps } from '../_shared/pluggy-supabase.ts';
import { handlePluggySync } from '../_shared/pluggy-sync.ts';

Deno.serve((request) => handlePluggySync(request, syncDeps()));
