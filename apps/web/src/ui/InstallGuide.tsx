import { ArrowDown, CheckCircle, Copy } from '@phosphor-icons/react';
import { Fragment } from 'react';
import { t } from '../i18n/pt-BR';
import { Button } from './Button';
import { type BaseProps, cx } from './types';

export type InstallPlatform = 'ios' | 'android' | 'desktop';
export type InstallVariant =
  | 'ios-17'
  | 'ios-26'
  | 'ios-thirdparty'
  | 'android-chrome'
  | 'android-samsung'
  | 'android-prompt'
  | 'desktop-prompt'
  | 'desktop-manual';

/** Passo como partes: texto comum e nomes de botão (em negrito, como o leitor de tela os anuncia). */
type Step = ReadonlyArray<string | { b: string }>;

// Textos das telas ON02a, ON02b e ON02c da UX (§3).
const STEPS: Readonly<Record<InstallVariant, readonly Step[]>> = {
  'ios-17': [
    ['Toque em ', { b: 'Compartilhar' }, ' (quadrado com seta para cima) na barra inferior.'],
    ['Role e toque em ', { b: 'Adicionar à Tela de Início' }, '.'],
    ['Toque em ', { b: 'Adicionar' }, '.'],
  ],
  'ios-26': [
    ['Toque em ', { b: '•••' }, ' na barra de endereço.'],
    ['Toque em ', { b: 'Compartilhar' }, ' e depois em ', { b: 'Adicionar à Tela de Início' }, '.'],
    ['Mantenha ', { b: 'Abrir como app' }, ' ligado e toque em ', { b: 'Adicionar' }, '.'],
  ],
  'ios-thirdparty': [['Cole na barra de endereço do Safari.']],
  'android-chrome': [
    ['Toque no menu ', { b: '⋮' }, ' no canto superior.'],
    ['Toque em ', { b: 'Instalar app' }, ' (ou ', { b: 'Adicionar à tela inicial' }, ').'],
    ['Confirme em ', { b: 'Instalar' }, '.'],
  ],
  'android-samsung': [
    ['Toque no menu ', { b: '≡' }, ' na parte de baixo.'],
    [{ b: 'Adicionar página a' }, ' → ', { b: 'Tela inicial' }, '.'],
  ],
  'android-prompt': [],
  'desktop-prompt': [],
  'desktop-manual': [['Clique no ícone de instalação na barra de endereço.']],
};

/** Variante pelo user agent (a versão do iOS decide a posição do botão do Safari). */
export function detectInstallVariant(
  ua: string,
  hasPrompt: boolean,
): { platform: InstallPlatform; variant: InstallVariant } {
  if (/iPhone|iPad|iPod/.test(ua)) {
    if (/CriOS|FxiOS|EdgiOS/.test(ua)) {
      return { platform: 'ios', variant: 'ios-thirdparty' };
    }
    const major = Number(/OS (\d+)_/.exec(ua)?.[1] ?? /Version\/(\d+)/.exec(ua)?.[1] ?? 0);
    return { platform: 'ios', variant: major >= 26 ? 'ios-26' : 'ios-17' };
  }
  if (/Android/.test(ua)) {
    if (hasPrompt) {
      return { platform: 'android', variant: 'android-prompt' };
    }
    return {
      platform: 'android',
      variant: /SamsungBrowser/.test(ua) ? 'android-samsung' : 'android-chrome',
    };
  }
  return { platform: 'desktop', variant: hasPrompt ? 'desktop-prompt' : 'desktop-manual' };
}

export interface InstallGuideProps extends BaseProps {
  platform: InstallPlatform;
  variant: InstallVariant;
  state?: 'guide' | 'installed';
  onInstall?: () => void;
  onCopyLink?: () => void;
  onSkip?: () => void;
}

/** UX §5.27: passos em `<ol>`, nomes dos botões em negrito, indicador estático e "Copiar link" na variante de terceiros. */
export function InstallGuide({
  platform,
  variant,
  state = 'guide',
  onInstall,
  onCopyLink,
  onSkip,
  className,
  'data-testid': testId,
}: InstallGuideProps) {
  if (state === 'installed') {
    return (
      <div className={cx('install', className)} role="status" data-testid={testId}>
        <CheckCircle size={32} weight="fill" aria-hidden="true" />
        <p>{t('onb.install.done')}</p>
      </div>
    );
  }
  const steps = STEPS[variant];
  return (
    <div
      className={cx('install', className)}
      data-platform={platform}
      data-variant={variant}
      data-testid={testId}
    >
      {variant === 'ios-thirdparty' && <p>{t('onb.install.ios.notSafari')}</p>}
      {(variant === 'android-prompt' || variant === 'desktop-prompt') && onInstall && (
        <Button onClick={onInstall}>{t('onb.install.android.cta')}</Button>
      )}
      {steps.length > 0 && (
        <ol className="install-steps">
          {steps.map((step, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: passos fixos da variante
            <li key={i}>
              {step.map((part, j) =>
                typeof part === 'string' ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: partes fixas do texto
                  <Fragment key={j}>{part}</Fragment>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: partes fixas do texto
                  <strong key={j}>{part.b}</strong>
                ),
              )}
            </li>
          ))}
        </ol>
      )}
      {variant === 'ios-thirdparty' && onCopyLink && (
        <Button variant="secondary" iconStart={Copy} onClick={onCopyLink}>
          {t('onb.install.ios.copyLink')}
        </Button>
      )}
      {platform === 'ios' && variant !== 'ios-thirdparty' && (
        <>
          <ArrowDown className="install-pointer" size={24} aria-hidden="true" />
          <p>{t('onb.install.ios.after')}</p>
        </>
      )}
      {onSkip && (
        <Button variant="ghost" onClick={onSkip}>
          {platform === 'ios' ? t('onb.install.skip') : t('onb.install.later')}
        </Button>
      )}
    </div>
  );
}
