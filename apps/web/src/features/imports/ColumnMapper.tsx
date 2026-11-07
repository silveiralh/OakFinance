// ColumnMapper (UX §5.30; US-53, RN-76): separador, colunas de data, valor, descrição e identificador, formato da
// data, decimal e convenção de sinal, com as 5 primeiras linhas interpretadas antes de confirmar.
import { type CsvProfile, formatBRL, type ISODate, mapCsvRows } from '@oakfinance/domain';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { GlassCard, Select } from '../../ui';

export interface ColumnMapperProps {
  csv: { rows: string[][]; profile: CsvProfile; detected: string | null };
  onChange: (profile: CsvProfile) => void;
}

const PREVIEW_ROWS = 5;

/** `mapCsvRows` sem lançar: arquivo acima de 5.000 linhas vira um erro de linha. */
function safeMap(rows: readonly string[][], profile: CsvProfile): ReturnType<typeof mapCsvRows> {
  try {
    return mapCsvRows(rows, profile);
  } catch {
    return { rows: [], errors: [{ line: 1, code: 'CSV_AMOUNT_INVALID' }] };
  }
}

export function ColumnMapper({ csv, onChange }: ColumnMapperProps) {
  const { profile } = csv;
  const header = (csv.rows[profile.headerRow] ?? []).map((h) => h.trim());
  const columns = header.map((h) => ({ value: h, label: h || '—' }));
  const set = (change: Partial<CsvProfile>) => onChange({ ...profile, ...change });
  const setColumn = (key: keyof CsvProfile['columns'], value: string) => {
    const next = { ...profile.columns };
    if (value === '') {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange({ ...profile, columns: next });
  };
  const sample = csv.rows.slice(0, profile.headerRow + 1 + PREVIEW_ROWS);
  const mapped = safeMap(sample, profile);
  const all = safeMap(csv.rows, profile);
  const missingAmount = all.errors.some((e) => e.code === 'CSV_AMOUNT_COLUMN_MISSING');
  return (
    <GlassCard level={2} className="column-mapper" data-testid="column-mapper">
      {csv.detected && (
        <p data-testid="csv-detected">{t('csv.detected', { nome: csv.detected })}</p>
      )}
      <Select
        label={t('csv.delimiter')}
        value={profile.delimiter}
        onChange={(v) => set({ delimiter: v as CsvProfile['delimiter'] })}
        options={[
          { value: ',', label: t('csv.comma') },
          { value: ';', label: t('csv.semicolon') },
          { value: '\t', label: t('csv.tab') },
        ]}
      />
      <Select
        label={t('csv.date')}
        value={profile.columns.date}
        onChange={(v) => setColumn('date', v)}
        options={columns}
      />
      <Select
        label={t('csv.dateFormat')}
        value={profile.dateFormat}
        onChange={(v) => set({ dateFormat: v as CsvProfile['dateFormat'] })}
        options={[
          { value: 'DD/MM/YYYY', label: 'dd/mm/aaaa' },
          { value: 'DD/MM/YY', label: 'dd/mm/aa' },
          { value: 'YYYY-MM-DD', label: 'aaaa-mm-dd' },
        ]}
      />
      <Select
        label={t('csv.amount')}
        value={profile.columns.amount ?? ''}
        onChange={(v) => setColumn('amount', v)}
        options={[{ value: '', label: t('csv.none') }, ...columns]}
        {...(missingAmount ? { error: t('import.noAmountCol') } : {})}
      />
      <Select
        label={t('csv.decimal')}
        value={profile.decimal}
        onChange={(v) => set({ decimal: v as CsvProfile['decimal'] })}
        options={[
          { value: ',', label: t('csv.comma') },
          { value: '.', label: '.' },
        ]}
      />
      <Select
        label={t('csv.sign')}
        value={profile.amountSign}
        onChange={(v) => set({ amountSign: v as CsvProfile['amountSign'] })}
        options={[
          { value: 'expense_negative', label: t('csv.signNegative') },
          { value: 'expense_positive', label: t('csv.signPositive') },
        ]}
      />
      <Select
        label={t('csv.description')}
        value={profile.columns.description}
        onChange={(v) => setColumn('description', v)}
        options={columns}
      />
      <Select
        label={t('csv.externalId')}
        value={profile.columns.externalId ?? ''}
        onChange={(v) => setColumn('externalId', v)}
        options={[{ value: '', label: t('csv.none') }, ...columns]}
      />
      <h3>{t('csv.preview')}</h3>
      <table className="csv-preview" data-testid="csv-preview">
        <tbody>
          {mapped.rows.map((row) => (
            <tr key={row.externalKey}>
              <td>{formatDateBR(row.occurredOn as ISODate)}</td>
              <td>{row.description}</td>
              <td>{formatBRL(row.kind === 'expense' ? -row.amountCents : row.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {all.errors.length > 0 && !missingAmount && (
        <p role="status" data-testid="csv-errors">
          {t('csv.errors', { n: all.errors.length })}
        </p>
      )}
    </GlassCard>
  );
}
