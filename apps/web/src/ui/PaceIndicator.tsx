import { formatBRL, HIDDEN_AMOUNT, type MonthStatus } from '@oakfinance/domain';
import { CircleAlert, CircleCheck, Info, TrendingUp } from 'lucide-react';
import { t, uiText } from '../i18n/pt-BR';
import { useEnvironment } from '../lib/useEnvironment';
import { type BaseProps, cx } from './types';

export interface PaceIndicatorProps extends BaseProps {
  state: MonthStatus;
  /** Restante em `attention`, excedente em `over` (centavos, positivo). */
  amountCents?: number;
  onPress?: () => void;
}

/** Texto do selo da RN-50 (com Disponível = 0 em `attention`: "No limite do planejado"). */
export function paceText(state: MonthStatus, amountCents: number, hidden: boolean): string {
  const valor = hidden ? HIDDEN_AMOUNT : formatBRL(Math.abs(amountCents));
  switch (state) {
    case 'on_track':
      return t('home.pace.onTrack');
    case 'attention':
      return amountCents === 0 ? t('home.pace.atLimit') : t('home.pace.attention', { valor });
    case 'over':
      return t('home.pace.over', { valor });
    default:
      return t('home.pace.noIncome');
  }
}

const ICON = {
  on_track: CircleCheck,
  attention: TrendingUp,
  over: CircleAlert,
  no_income: Info,
} as const;
const TONE = {
  on_track: 'success',
  attention: 'warning',
  over: 'danger',
  no_income: 'info',
} as const;

/** UX §5.6 e RN-50: ícone + texto na cor de status (nunca só cor); `role="status"`; fundo não muda. */
export function PaceIndicator({
  state,
  amountCents = 0,
  onPress,
  className,
  'data-testid': testId,
}: PaceIndicatorProps) {
  const env = useEnvironment();
  const text = paceText(state, amountCents, env.values === 'hidden');
  const Glyph = ICON[state];
  const content = (
    <>
      <Glyph size={20} strokeWidth={2.5} aria-hidden="true" />
      <span className="sr-only">{`${uiText.monthStatus}: `}</span>
      <span>{text}</span>
    </>
  );
  return (
    <div
      className={cx('pace', className)}
      role="status"
      data-state={state}
      data-tone={TONE[state]}
      data-testid={testId}
    >
      {onPress ? (
        <button type="button" className="pace-button" onClick={onPress}>
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}
