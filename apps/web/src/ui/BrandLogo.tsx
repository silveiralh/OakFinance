import { useId } from 'react';
import { useEnvironment } from '../lib/useEnvironment';
import {
  FAVICON_OF,
  MONOGRAM_OF,
  WORDMARK_FINANCE,
  WORDMARK_OAK,
  WORDMARK_RATIO,
  WORDMARK_VIEWBOX,
} from './brand-paths';
import { type BaseProps, cx } from './types';

export type LogoVariant = 'wordmark' | 'wordmark-sheen' | 'monogram' | 'mono';
export type LogoArt =
  | 'wordmark'
  | 'wordmark-sheen'
  | 'monogram'
  | 'favicon'
  | 'mono-wordmark'
  | 'mono-monogram';

export interface BrandLogoProps extends BaseProps {
  variant?: LogoVariant;
  glyph?: 'wordmark' | 'monogram';
  height?: number;
  theme?: 'auto' | 'light' | 'dark';
  decorative?: boolean;
}

const NAME = 'OakFinance';
const WORDMARK_MIN = 22; // 96 px de largura (UX §4.11.6)
const SHEEN_MIN = 32;
const MONOGRAM_MIN = 32;

/** Abaixo dos mínimos da UX §4.11.6 troca sozinho: brilho → chapado → monograma → favicon. */
export function resolveLogoArt(
  variant: LogoVariant,
  glyph: 'wordmark' | 'monogram',
  height: number,
  glassSolid: boolean,
): LogoArt {
  if (variant === 'mono') {
    return glyph === 'wordmark' && height >= WORDMARK_MIN ? 'mono-wordmark' : 'mono-monogram';
  }
  let art: LogoArt = variant;
  if (art === 'wordmark-sheen' && (height < SHEEN_MIN || glassSolid)) {
    art = 'wordmark';
  }
  if (art === 'wordmark' && height < WORDMARK_MIN) {
    art = 'monogram';
  }
  if (art === 'monogram' && height < MONOGRAM_MIN) {
    art = 'favicon';
  }
  return art;
}

/**
 * UXA-013: as cores fixas (quando `theme` não é `auto`) seguem os tokens de marca da UX §4.0 — `--brand-oak` e
 * `--brand-finance` (preto e lima-700 no claro; névoa e lima no escuro) —, sem os azuis do Aero.
 */
const COLORS = {
  light: {
    oak: '#0B0D0A',
    finance: '#4D7C0F',
  },
  dark: {
    oak: '#F2F7EC',
    finance: '#C0E45C',
  },
} as const;

/** UXA-013: monograma e favicon como quadrado preto com o "OF" em lima (UX §4.0), iguais ao `public/favicon.svg`. */
const ICON_BG = '#0B0D0A';
const ICON_INK = '#C0E45C';

/** UX §5.35: SVG inline (herda tokens), ids únicos por instância, sem animação. */
export function BrandLogo({
  variant = 'wordmark',
  glyph = 'wordmark',
  height = 32,
  theme = 'auto',
  decorative = false,
  className,
  'data-testid': testId,
}: BrandLogoProps) {
  const env = useEnvironment();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const id = (name: string) => `${uid}-${name}`;
  const art = resolveLogoArt(variant, glyph, height, env.glass === 'solid');
  const palette = COLORS[theme === 'auto' ? env.theme : theme];
  const wide = art === 'wordmark' || art === 'wordmark-sheen' || art === 'mono-wordmark';
  // D-108: o logo é desenho em contornos (Sora); o "brilho" do Aero saiu, e o wordmark-sheen desenha o chapado
  const oakFill =
    art === 'mono-wordmark' ? 'currentColor' : theme === 'auto' ? 'var(--brand-oak)' : palette.oak;
  const financeFill =
    art === 'mono-wordmark'
      ? 'currentColor'
      : theme === 'auto'
        ? 'var(--brand-finance)'
        : palette.finance;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={wide ? WORDMARK_VIEWBOX : art === 'favicon' ? '0 0 32 32' : '0 0 512 512'}
      height={height}
      width={wide ? Math.round(height * WORDMARK_RATIO) : height}
      className={cx(className)}
      data-art={art}
      data-testid={testId}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-labelledby={decorative ? undefined : id('t')}
    >
      <title id={id('t')}>{NAME}</title>
      {wide && (
        <>
          <path d={WORDMARK_OAK} fill={oakFill} />
          <path d={WORDMARK_FINANCE} fill={financeFill} />
        </>
      )}
      {art === 'monogram' && (
        <>
          <rect width="512" height="512" rx="112" fill={ICON_BG} />
          <path d={MONOGRAM_OF} fill={ICON_INK} />
        </>
      )}
      {art === 'favicon' && (
        <>
          <rect width="32" height="32" rx="8" fill={ICON_BG} />
          <path d={FAVICON_OF} fill={ICON_INK} />
        </>
      )}
      {art === 'mono-monogram' && <path d={MONOGRAM_OF} fill="currentColor" />}
    </svg>
  );
}
