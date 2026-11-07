// Card "Complete a configuração: {itens}" no Início (UX §2.3): lista os passos do onboarding pulados; tocar abre o
// primeiro deles, e o card some quando todos forem concluídos.
import { ListChecks } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { Banner } from '../../ui';
import { pendingSteps, pendingText, readOnboarding, STEP_PATH } from '../onboarding/progress';

export function PendingSetupCard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const items = useLive(
    user
      ? async () =>
          pendingSteps(readOnboarding((await user.db.profiles.toCollection().first())?.onboarding))
      : null,
    [user],
  );
  const first = items?.[0];
  if (!items || !first) {
    return null;
  }
  return (
    <Banner
      icon={ListChecks}
      message={pendingText(items)}
      action={{ label: t('onb.pending.cta'), onPress: () => void navigate(STEP_PATH[first]) }}
      data-testid="onb-pending"
    />
  );
}
