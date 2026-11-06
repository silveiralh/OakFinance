import { useEffect, useState } from 'react';
import { uiText } from '../i18n/pt-BR';
import { AppBackdrop, BrandLogo, ProgressBar } from '../ui';

/** Só mostra a barra se o carregamento passar disso (UX §3.0, S00). */
export const SPLASH_PROGRESS_DELAY_MS = 400;

/** S00 Abertura: wordmark centralizado, sem animação de logo; barra indeterminada só depois de 400 ms. */
export function Splash() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SPLASH_PROGRESS_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="splash" data-testid="splash" aria-busy="true">
      <AppBackdrop />
      <BrandLogo variant="wordmark" height={32} />
      {slow && (
        <ProgressBar
          className="splash-progress"
          valueCents={0}
          maxCents={0}
          indeterminate
          size="xs"
          label={uiText.loading}
        />
      )}
    </div>
  );
}
