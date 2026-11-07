// S10 — Dados e privacidade (UX §3 S01): por enquanto, "Exportar lançamentos (CSV)" com o período em meses (US-59).
// Backup, restauração e exclusão da conta chegam na T-070 e na T-071.
import { type ISODate, monthLabel, monthOf, type YearMonth } from '@oakfinance/domain';
import { FileDown } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../app/auth';
import { t } from '../../i18n/pt-BR';
import { useToday } from '../../lib/useToday';
import { Button, GlassCard, Select, useToast } from '../../ui';
import { downloadFile, exportTransactions, monthOptions } from './export';

export function DataScreen({
  today: fixedToday,
  download = downloadFile,
}: {
  today?: ISODate;
  download?: (name: string, content: string) => void;
}) {
  const today = useToday(fixedToday);
  const { user } = useAuth();
  const showToast = useToast();
  const current = monthOf(today);
  const [from, setFrom] = useState<YearMonth>(current);
  const [to, setTo] = useState<YearMonth>(current);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const options = monthOptions(current).map((m) => ({ value: m, label: monthLabel(m) }));
  const inverted = to < from;

  const run = async () => {
    if (!user || inverted) {
      return;
    }
    setBusy(true);
    try {
      const result = await exportTransactions(user.db, from, to);
      setEmpty(result.kind === 'empty');
      if (result.kind === 'file') {
        download(result.name, result.content);
        showToast({ message: t('export.done', { n: result.count }), tone: 'success' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="screen data-screen" data-screen="S10" data-testid="screen-S10">
      <GlassCard level={2} className="export-card" data-testid="export-card">
        <h2>{t('export.title')}</h2>
        <p className="account-meta">{t('export.hint')}</p>
        <Select
          label={t('export.from')}
          value={from}
          onChange={(value) => {
            setFrom(value as YearMonth);
            setEmpty(false);
          }}
          options={options}
          data-testid="export-from"
        />
        <Select
          label={t('export.to')}
          value={to}
          onChange={(value) => {
            setTo(value as YearMonth);
            setEmpty(false);
          }}
          options={options}
          {...(inverted ? { error: t('export.inverted') } : {})}
          data-testid="export-to"
        />
        <Button
          iconStart={FileDown}
          fullWidth
          loading={busy}
          disabled={inverted}
          onClick={() => void run()}
          data-testid="export-run"
        >
          {t('export.cta')}
        </Button>
        {empty && (
          <p role="status" data-testid="export-empty">
            {t('export.empty')}
          </p>
        )}
      </GlassCard>
    </section>
  );
}
