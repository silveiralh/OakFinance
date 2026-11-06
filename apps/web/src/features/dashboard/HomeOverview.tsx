// Início no visual da D-023: cartão preto com o mês (Entradas, Saídas, Guardado), atalhos em pílula e os últimos
// lançamentos. O valor "Disponível para gastar" (RN-47) entra no lugar do resumo na T-058.
import { formatBRL, type ISODate, todayIn, type YearMonth } from '@oakfinance/domain';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Landmark, List, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { shellText, t, uiText } from '../../i18n/pt-BR';
import { TransactionRow } from '../../ui';
import { monthRange, monthSummary, monthTitle } from '../transactions/list';
import { toRow } from '../transactions/TransactionsScreen';

const RECENT = 5;

export function HomeOverview({
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  today?: ISODate;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const month = today.slice(0, 7) as YearMonth;
  const { from, to } = monthRange(month);
  const data = useLive(
    user
      ? async () => {
          const rows = (
            await user.db.transactions.where('occurred_on').between(from, to, true, true).toArray()
          ).filter((r) => r.deleted_at === null);
          const recent = (await user.db.transactions.orderBy('occurred_on').reverse().toArray())
            .filter((r) => r.deleted_at === null)
            .slice(0, RECENT);
          const categories = new Map((await user.db.categories.toArray()).map((c) => [c.id, c]));
          return { rows, recent, categories };
        }
      : null,
    [user, from, to],
  );
  const summary = data ? monthSummary(data.rows, data.categories) : null;
  const actions = [
    { key: 'expense', label: t('quick.type.expense'), icon: ArrowUpRight, href: '?novo=despesa' },
    { key: 'income', label: t('quick.type.income'), icon: ArrowDownLeft, href: '?novo=receita' },
    { key: 'list', label: shellText.screens.T01, icon: List, href: '/lancamentos' },
    { key: 'accounts', label: shellText.screens.S03, icon: Landmark, href: '/ajustes/contas' },
  ] as const;
  return (
    <div className="home" data-testid="home-overview">
      <section className="home-card glass" data-tone="dark" aria-labelledby="home-month">
        <div className="home-card-head">
          <h2 id="home-month" className="home-card-month">
            {monthTitle(month)}
          </h2>
          <button
            type="button"
            className="home-card-new"
            onClick={() => void navigate('?novo=despesa')}
          >
            <span className="home-card-new-icon" aria-hidden="true">
              <Plus size={20} />
            </span>
            {uiText.newEntry}
          </button>
        </div>
        <p className="home-card-label">{t('list.summary.out')}</p>
        <p className="home-card-value money" data-testid="home-out">
          {formatBRL(summary?.outCents ?? 0)}
        </p>
        <dl className="home-card-stats">
          <div>
            <dt>{t('list.summary.in')}</dt>
            <dd className="money">{formatBRL(summary?.inCents ?? 0)}</dd>
          </div>
          <div>
            <dt>{t('list.summary.saved')}</dt>
            <dd className="money">{formatBRL(summary?.savedCents ?? 0)}</dd>
          </div>
        </dl>
      </section>
      <nav className="home-actions" aria-label={uiText.actions}>
        {actions.map(({ key, label, icon: Glyph, href }, index) => (
          <Link
            key={key}
            to={href}
            className="home-action"
            data-accent={index === actions.length - 1 ? 'true' : undefined}
          >
            <Glyph size={24} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      {data && (
        <section className="home-recent" aria-labelledby="home-recent">
          <div className="home-section-head">
            <h2 id="home-recent">{t('home.recent')}</h2>
            <Link to="/lancamentos" className="home-see-all">
              {t('home.seeAll')}
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="glass home-recent-list">
            {data.recent.length === 0 && (
              <p className="home-recent-empty">{t('list.empty', { mês: monthTitle(month) })}</p>
            )}
            {data.recent.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={toRow(
                  tx,
                  tx.category_id ? data.categories.get(tx.category_id) : undefined,
                  today,
                )}
                onPress={() => void navigate(`?editar=${tx.id}`)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
