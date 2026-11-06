import { todayIn } from '@oakfinance/domain';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { saveRow } from '../../data/repositories/rows';
import { t } from '../../i18n/pt-BR';
import { Button, GlassCard } from '../../ui';
import { overdueIncomes } from '../quick-entry/model';

/** RN-34: receita A receber ou Prevista com a data passada → "Confirmar {descrição}" (no Início até a H02). */
export function IncomeToConfirm({
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  today?: string;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const rows = useLive(
    user ? async () => overdueIncomes(await user.db.transactions.toArray(), today) : null,
    [user, today],
  );
  if (!user || !rows || rows.length === 0) {
    return null;
  }
  const update = async (row: (typeof rows)[number], status: 'posted' | 'cancelled') => {
    await saveRow(user.db, 'transactions', { ...row, status });
    user.engine.notifyWrite();
  };
  return (
    <>
      {rows.map((row) => (
        <GlassCard key={row.id} level={2} data-testid={`income-confirm-${row.id}`}>
          <p className="account-name">
            {t('income.confirm.title', { descrição: row.description ?? '' })}
          </p>
          <div className="account-actions">
            <Button size="sm" onClick={() => void update(row, 'posted')}>
              {t('income.confirm.ok')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void navigate(`?editar=${row.id}`)}>
              {t('income.confirm.changeDate')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void update(row, 'cancelled')}>
              {t('income.confirm.wontCome')}
            </Button>
          </div>
        </GlassCard>
      ))}
    </>
  );
}
