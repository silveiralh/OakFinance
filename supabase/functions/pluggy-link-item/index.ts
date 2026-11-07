// Edge Function `pluggy-link-item` (tech §6.0 [CONTRATO], §6.1.3 passo 4): auth do usuário.
import { handleLinkItem } from '../_shared/pluggy-link.ts';
import { pluggyDeps } from '../_shared/pluggy-supabase.ts';

Deno.serve((request) => handleLinkItem(request, pluggyDeps()));
