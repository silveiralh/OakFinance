import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { t } from '../../i18n/pt-BR';
import {
  installTarget,
  isStandalone,
  readInstallChoices,
  showInstallCard,
} from '../../lib/platform';
import { Banner } from '../../ui';

/** Card "Instale o app para receber lembretes" no Início, depois de "Continuar no navegador" (UX §3 ON02b). */
export function InstallCard() {
  const navigate = useNavigate();
  const [visible] = useState(() => showInstallCard(readInstallChoices(), isStandalone(navigator)));
  if (!visible) {
    return null;
  }
  const target = installTarget(navigator);
  return (
    <Banner
      icon={Smartphone}
      message={t('home.install.card')}
      action={{
        label: t('onb.install.android.cta'),
        onPress: () => void navigate(`/instalar?p=${target}`),
      }}
      data-testid="install-card"
    />
  );
}
