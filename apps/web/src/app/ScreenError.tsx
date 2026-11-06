import { WarningCircle } from '@phosphor-icons/react';
import { useRouteError } from 'react-router';
import { shellText } from '../i18n/pt-BR';
import { EmptyState } from '../ui';
import { errorCode } from './errorCode';

export interface ScreenErrorViewProps {
  error: unknown;
  onRetry?: () => void;
}

function reload() {
  window.location.reload();
}

/**
 * G09 (UX §3 G, §6.6; US-64): substitui o conteúdo da tela, com "Tentar novamente" e um código curto do erro.
 * Os dados locais não são tocados; tentar de novo recarrega a tela.
 */
export function ScreenErrorView({ error, onRetry = reload }: ScreenErrorViewProps) {
  return (
    <div className="screen-error" data-testid="screen-error">
      <EmptyState
        variant="error"
        icon={WarningCircle}
        title={shellText.screenErrorTitle}
        description={shellText.screenErrorDescription}
        primaryAction={{ label: shellText.retry, onPress: onRetry }}
      />
      <p className="screen-error-code">
        <code>{errorCode(error)}</code>
      </p>
    </div>
  );
}

/** `ErrorBoundary` das rotas do React Router. */
export function ScreenError() {
  const error = useRouteError();
  return <ScreenErrorView error={error} />;
}
