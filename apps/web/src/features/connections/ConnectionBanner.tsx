// Aviso no Início quando uma conexão precisa ser renovada (tech §6.1.3 passo 8; US-47, RN-94): expirada, com erro
// de login ou com o consentimento a 7 dias ou menos. Tocar em Renovar abre a I01.
import { Landmark } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { Banner } from '../../ui';
import { bankName, connectionState, needsRenewal } from './model';

export function ConnectionBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const connections = useLive(user ? () => user.db.bank_connections.toArray() : null, [
    user?.userId,
  ]);
  const now = Date.now();
  const first = (connections ?? []).find(
    (c) => c.deleted_at === null && c.is_active && needsRenewal(connectionState(c, now)),
  );
  if (!first) {
    return null;
  }
  return (
    <Banner
      tone="warning"
      icon={Landmark}
      message={t('conn.banner', { banco: bankName(first) })}
      action={{ label: t('conn.renew'), onPress: () => void navigate('/ajustes/conexoes') }}
      data-testid="connection-banner"
    />
  );
}
