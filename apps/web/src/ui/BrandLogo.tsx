import { useId } from 'react';
import { useEnvironment } from '../lib/useEnvironment';
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

const COLORS = {
  light: {
    oak: '#0A2540',
    finance: '#0A5F8C',
    oakSheen: ['#2B4A66', '#0A2540'],
    financeSheen: ['#0B76AE', '#075884'],
  },
  dark: {
    oak: '#EAF6FF',
    finance: '#5CCFFF',
    oakSheen: ['#FFFFFF', '#A9C8DE'],
    financeSheen: ['#7FDBFF', '#2FB6EE'],
  },
} as const;

const MONOGRAM_PATH = 'M330 182 V330 M330 182 H392 M330 256 H376';

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
  const textProps = {
    x: 8,
    y: 45,
    fontFamily: 'Manrope Variable, Manrope, Inter, system-ui, sans-serif',
    fontWeight: 700,
    fontSize: 42,
    letterSpacing: -1.05,
  };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={wide ? '0 0 272 64' : art === 'favicon' ? '0 0 32 32' : '0 0 512 512'}
      height={height}
      width={wide ? Math.round((height * 272) / 64) : height}
      className={cx(className)}
      data-art={art}
      data-testid={testId}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-labelledby={decorative ? undefined : id('t')}
    >
      <title id={id('t')}>{NAME}</title>
      {art === 'wordmark' && (
        <text {...textProps}>
          <tspan fill={theme === 'auto' ? 'var(--brand-oak)' : palette.oak}>Oak</tspan>
          <tspan fill={theme === 'auto' ? 'var(--brand-finance)' : palette.finance} dx="0.5">
            Finance
          </tspan>
        </text>
      )}
      {art === 'wordmark-sheen' && (
        <>
          <defs>
            <linearGradient
              id={id('ink')}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="14"
              x2="0"
              y2="46"
            >
              <stop offset="0" stopColor={palette.oakSheen[0]} />
              <stop offset="1" stopColor={palette.oakSheen[1]} />
            </linearGradient>
            <linearGradient
              id={id('aqua')}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="14"
              x2="0"
              y2="46"
            >
              <stop offset="0" stopColor={palette.financeSheen[0]} />
              <stop offset="1" stopColor={palette.financeSheen[1]} />
            </linearGradient>
          </defs>
          <text {...textProps}>
            <tspan fill={`url(#${id('ink')})`}>Oak</tspan>
            <tspan fill={`url(#${id('aqua')})`} dx="0.5">
              Finance
            </tspan>
          </text>
        </>
      )}
      {art === 'mono-wordmark' && (
        <text {...textProps} fill="currentColor">
          <tspan>Oak</tspan>
          <tspan dx="0.5">Finance</tspan>
        </text>
      )}
      {art === 'monogram' && (
        <>
          <defs>
            <linearGradient id={id('bg')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0B76AE" />
              <stop offset="1" stopColor="#053F5F" />
            </linearGradient>
            <radialGradient id={id('light')} cx="0.3" cy="0.15" r="0.75">
              <stop offset="0" stopColor="#5CCFFF" stopOpacity="0.30" />
              <stop offset="1" stopColor="#5CCFFF" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={id('disc')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.12" />
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id={id('gloss')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.10" />
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect width="512" height="512" rx="112" fill={`url(#${id('bg')})`} />
          <rect width="512" height="512" rx="112" fill={`url(#${id('light')})`} />
          <circle
            cx="256"
            cy="256"
            r="182"
            fill={`url(#${id('disc')})`}
            stroke="#FFFFFF"
            strokeOpacity="0.35"
            strokeWidth="3"
          />
          <path
            d="M90 230 A182 182 0 0 1 422 230 Q256 196 90 230 Z"
            fill={`url(#${id('gloss')})`}
          />
          <g fill="none" stroke="#FFFFFF" strokeWidth="40" strokeLinecap="round">
            <circle cx="194" cy="256" r="74" />
            <path d={MONOGRAM_PATH} />
          </g>
        </>
      )}
      {art === 'favicon' && (
        <>
          <defs>
            <linearGradient id={id('fv')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0B76AE" />
              <stop offset="1" stopColor="#053F5F" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill={`url(#${id('fv')})`} />
          <g fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round">
            <circle cx="11.6" cy="16" r="5.6" />
            <path d="M21.6 10.4 V21.6 M21.6 10.4 H26.2 M21.6 16 H25.2" />
          </g>
        </>
      )}
      {art === 'mono-monogram' && (
        <g fill="none" stroke="currentColor" strokeWidth="40" strokeLinecap="round">
          <circle cx="194" cy="256" r="74" />
          <path d={MONOGRAM_PATH} />
        </g>
      )}
    </svg>
  );
}
