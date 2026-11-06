// H01-S — "Como o valor é calculado" (UX §3 H01, RN-47, RN-49): a fórmula linha a linha, cada linha abre a T01
// filtrada; "ainda vencem" mostra as 3 próximas saídas por data.
import { dayMonth, formatBRL, MINUS_SIGN } from '@oakfinance/domain';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { Amount } from '../../app/values';
import { type MessageKey, t } from '../../i18n/pt-BR';
import { BottomSheet } from '../../ui';
import type { HomeModel } from './model';

interface Line {
  key: string;
  label: string;
  sign: '+' | '-';
  cents: number;
  href: string;
}

/** Linhas do H01-S na ordem da UX; previstas sempre aparecem, resgates só quando há. */
export function formulaLines(model: HomeModel): Line[] {
  const { spendable: s, config } = model;
  const line = (
    key: string,
    label: MessageKey,
    sign: Line['sign'],
    cents: number,
    href: string,
    vars: Record<string, string | number> = {},
  ): Line => ({ key, label: t(label, vars), sign, cents, href });
  const lines: Line[] = [
    line('fixed', 'home.formula.fixed', '+', s.income.fixedCents, '/lancamentos?filtro=income'),
    line(
      'variable',
      'home.formula.variable',
      '+',
      s.income.variableReceivedCents,
      '/lancamentos?filtro=income',
    ),
    line(
      'expected',
      'home.formula.expected',
      '+',
      config.includeExpectedIncome ? s.income.variableExpectedCents : 0,
      '/lancamentos?filtro=forecast',
    ),
  ];
  if (s.withdrawalsCents > 0) {
    lines.push(
      line(
        'withdrawals',
        'home.formula.withdrawals',
        '+',
        s.withdrawalsCents,
        '/lancamentos?filtro=income',
      ),
    );
  }
  lines.push(
    line('spent', 'home.formula.spent', '-', s.spentCents, '/lancamentos?filtro=expense'),
    line(
      'upcoming',
      'home.formula.upcoming',
      '-',
      config.includeUpcoming ? s.upcoming.totalCents : 0,
      '/lancamentos?filtro=forecast',
    ),
    line(
      'savings',
      'home.formula.savings',
      '-',
      s.savingsReserveCents,
      '/lancamentos?faixa=savings',
      {
        p: Math.round(model.savingsPctBp / 100),
      },
    ),
  );
  return lines;
}

export function FormulaSheet({
  model,
  hidden,
  open,
  onClose,
}: {
  model: HomeModel;
  hidden: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const money = (sign: '+' | '-', cents: number) =>
    `${sign === '+' ? '+' : MINUS_SIGN} ${formatBRL(cents)}`;
  return (
    <BottomSheet open={open} onClose={onClose} title={t('home.formula.title')}>
      <div className="home-formula" data-testid="home-formula">
        <ul className="home-formula-lines">
          {formulaLines(model).map((line) => (
            <li key={line.key} data-line={line.key}>
              <Link to={line.href} className="home-formula-line" onClick={onClose}>
                <span>{line.label}</span>
                <span className="money">
                  <Amount text={money(line.sign, line.cents)} hidden={hidden} />
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
              {line.key === 'upcoming' && model.nextOutflows.length > 0 && (
                <div className="home-formula-next">
                  <p>{t('home.formula.next')}</p>
                  <ul>
                    {model.nextOutflows.map((item) => (
                      <li key={item.key}>
                        <span>{`${dayMonth(item.date)} · ${item.label}`}</span>
                        <span className="money">
                          <Amount text={formatBRL(item.amountCents)} hidden={hidden} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="home-formula-total" data-testid="home-formula-total">
          <span>{t('home.formula.total')}</span>
          <span className="money">
            <Amount text={formatBRL(model.spendable.availableCents)} hidden={hidden} />
          </span>
        </p>
        <p className="home-formula-footer">
          <Link to="/ajustes/calculo" onClick={onClose} data-testid="home-formula-adjust">
            {t('home.formula.footer')}
          </Link>
        </p>
      </div>
    </BottomSheet>
  );
}
