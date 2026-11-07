// S10 — Dados e privacidade (UX §3 S01): "Exportar lançamentos (CSV)" com o período em meses (US-59), "Baixar
// backup" e "Restaurar backup" com a confirmação digitando RESTAURAR (US-60). A exclusão da conta chega depois.
import { type ISODate, monthLabel, monthOf, type YearMonth } from '@oakfinance/domain';
import { DatabaseBackup, FileDown, FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAuth } from '../../app/auth';
import { t, uiText } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import { BottomSheet, Button, GlassCard, Select, TextField, useToast } from '../../ui';
import {
  BackupError,
  backupDay,
  exportBackup,
  type ParsedBackup,
  parseBackup,
  type RestoreSummary,
  restoreBackup,
} from './backup';
import { downloadFile, exportTransactions, monthOptions } from './export';

/** "Restaurado: 120 lançamentos, 3 contas, …" (US-60: resumo do que foi restaurado). */
export function restoreSummaryText(summary: RestoreSummary): string {
  const main = ['transactions', 'accounts', 'cards', 'categories'] as const;
  const others = Object.entries(summary)
    .filter(([table]) => !(main as readonly string[]).includes(table) && table !== 'profiles')
    .reduce((sum, [, n]) => sum + (n ?? 0), 0);
  return t('restore.summary', {
    tx: summary.transactions ?? 0,
    contas: summary.accounts ?? 0,
    cartoes: summary.cards ?? 0,
    categorias: summary.categories ?? 0,
    outros: others,
  });
}

function RestoreCard() {
  const { user } = useAuth();
  const showToast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  if (!user) {
    return null;
  }

  const choose = async (file: File | undefined) => {
    if (input.current) {
      input.current.value = '';
    }
    if (!file) {
      return;
    }
    setSummary(null);
    try {
      setPending(parseBackup(await file.text(), user.userId));
      setInvalid(false);
      setTyped('');
    } catch (error) {
      if (!(error instanceof BackupError)) {
        throw error;
      }
      setInvalid(true);
    }
  };

  const confirmed = typed.trim().toUpperCase() === t('restore.word');
  const run = async () => {
    if (!pending || !confirmed) {
      return;
    }
    setBusy(true);
    try {
      const result = await restoreBackup(user.db, pending);
      if (result.ok) {
        user.engine.notifyWrite();
        setSummary(restoreSummaryText(result.value));
        setPending(null);
        showToast({ message: t('restore.done'), tone: 'success' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard level={2} className="export-card" data-testid="restore-card">
      <h2>{t('restore.title')}</h2>
      <p className="account-meta">{t('restore.hint')}</p>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => void choose(event.target.files?.[0])}
        data-testid="restore-file"
      />
      <Button
        variant="secondary"
        iconStart={FileUp}
        fullWidth
        onClick={() => input.current?.click()}
        data-testid="restore-choose"
      >
        {t('restore.choose')}
      </Button>
      {invalid && (
        <p role="alert" data-testid="restore-invalid">
          {t('restore.invalid')}
        </p>
      )}
      {summary && (
        <p role="status" data-testid="restore-summary">
          {summary}
        </p>
      )}
      <BottomSheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('restore.confirmTitle')}
        variant="dialog"
        role="alertdialog"
        data-testid="restore-confirm"
      >
        <p className="dialog-description">
          {t('restore.confirmBody', {
            data: pending ? formatDateBR(backupDay(pending)) : '',
          })}
        </p>
        <TextField
          label={t('restore.typeLabel')}
          value={typed}
          onChange={setTyped}
          autoComplete="off"
          data-testid="restore-word"
        />
        <div className="dialog-actions">
          <Button
            variant="danger"
            fullWidth
            disabled={!confirmed}
            loading={busy}
            onClick={() => void run()}
            data-testid="restore-run"
          >
            {t('restore.confirm')}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setPending(null)}>
            {uiText.cancel}
          </Button>
        </div>
      </BottomSheet>
    </GlassCard>
  );
}

export function DataScreen({
  today: fixedToday,
  download = downloadFile,
}: {
  today?: ISODate;
  download?: (name: string, content: string, type?: string) => void;
}) {
  const today = useToday(fixedToday);
  const { user } = useAuth();
  const showToast = useToast();
  const current = monthOf(today);
  const [from, setFrom] = useState<YearMonth>(current);
  const [to, setTo] = useState<YearMonth>(current);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
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

  const backup = async () => {
    if (!user) {
      return;
    }
    setBackingUp(true);
    try {
      const file = await exportBackup(user.db);
      download(file.name, file.content, 'application/json;charset=utf-8');
      showToast({ message: t('backup.done'), tone: 'success' });
    } finally {
      setBackingUp(false);
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
      <GlassCard level={2} className="export-card" data-testid="backup-card">
        <h2>{t('backup.title')}</h2>
        <p className="account-meta">{t('backup.hint')}</p>
        <Button
          iconStart={DatabaseBackup}
          fullWidth
          loading={backingUp}
          onClick={() => void backup()}
          data-testid="backup-run"
        >
          {t('backup.cta')}
        </Button>
      </GlassCard>
      <RestoreCard />
    </section>
  );
}
