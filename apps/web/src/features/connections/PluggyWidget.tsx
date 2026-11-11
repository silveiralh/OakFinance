// Pluggy Connect sob demanda (tech §6.1.3 passo 3). No build E2E (VITE_E2E=1) entra o `FakePluggyConnect`
// (tech §8.4), que some do build de produção (constante falsa).
//
// O widget de verdade (`react-pluggy-connect`) ainda não entra: o SDK grava no `window` as globais
// `__PLUGGY_CONNECT_SDK_VERSION`/`__REACT_PLUGGY_CONNECT_SDK_VERSION` e o `scripts/check-build.ts` reprova qualquer
// `PLUGGY_` no bundle. O dono escolheu ajustar o padrão para os nomes dos segredos (T-076, opção a); a mudança do
// portão é dele (HANDOFF §4). Até lá a conexão é feita pelo "Tenho um Item ID" (plano B, US-45).
import { type ComponentType, lazy, Suspense } from 'react';
import { t } from '../../i18n/pt-BR';
import { ProgressBar } from '../../ui';

export interface PluggyWidgetProps {
  connectToken: string;
  connectorIds: number[];
  /** Renovar ou atualizar um item existente (T-077). */
  updateItem?: string;
  onSuccess: (itemId: string) => void;
  onError: () => void;
  onClose: () => void;
}

const Fake = import.meta.env.VITE_E2E === '1' ? lazy(() => import('./FakePluggyConnect')) : null;

/** Componente do widget neste build, ou `null` quando só o plano B está disponível. */
const Widget: ComponentType<PluggyWidgetProps> | null = Fake;

export const widgetAvailable = Widget !== null;

export function PluggyWidget(props: PluggyWidgetProps) {
  if (!Widget) {
    return null;
  }
  return (
    <Suspense
      fallback={<ProgressBar valueCents={0} maxCents={1} indeterminate label={t('conn.opening')} />}
    >
      <Widget {...props} />
    </Suspense>
  );
}
