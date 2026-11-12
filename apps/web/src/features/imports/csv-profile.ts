// Perfil do CSV (RN-76): o salvo para o destino (se ler o arquivo, issue #152), senão o preset detectado pelo cabeçalho (Nubank), senão o
// genérico com as colunas chutadas pela ordem. O mapeamento confirmado fica em `profiles.settings.csvProfiles`,
// um por conta ou cartão.
import { CSV_PRESETS, type CsvProfile, mapCsvRows, sniffCsvProfile } from '@oakfinance/domain';
import type { OakDb } from '../../data/db';
import { saveRow } from '../../data/repositories/rows';
import { tokenizeCsv } from './csv-parse';
import type { Destination } from './ofx-import';

export function profileIdFor(dest: Destination): string {
  return `dest-${dest.kind}-${dest.id}`;
}

export function savedProfiles(settings: unknown): CsvProfile[] {
  const list = (settings as { csvProfiles?: unknown } | null)?.csvProfiles;
  return Array.isArray(list) ? (list as CsvProfile[]) : [];
}

const GENERIC = CSV_PRESETS.find((p) => p.id === 'generico-br') as CsvProfile;

/** Quantas linhas o perfil lê do arquivo; 0 quando não acha as colunas ou o arquivo passa do limite. */
export function readableCount(
  text: string,
  profile: CsvProfile,
  tokenized?: { rows: string[][]; delimiter: CsvProfile['delimiter'] },
): number {
  try {
    const rows =
      tokenized && tokenized.delimiter === profile.delimiter
        ? tokenized.rows
        : tokenizeCsv(text, profile.delimiter).rows;
    return mapCsvRows(rows, profile).rows.length;
  } catch {
    return 0;
  }
}

/**
 * Issue #152: o perfil salvo para o destino vale, a não ser que leia menos linhas que o preset reconhecido pelo
 * cabeçalho (um perfil antigo gravado por uma importação que não leu nada, como o `decimal: '.'` da fatura do
 * Nubank de antes do #138). Aí vem o preset, com "Formato detectado", e o ColumnMapper continua ajustável.
 */
export function savedOrPreset(
  own: CsvProfile,
  header: readonly string[],
  count: (profile: CsvProfile) => number,
): { profile: CsvProfile; detected: string } {
  const preset = sniffCsvProfile(header);
  if (preset) {
    const presetRows = count(preset);
    if (presetRows > 0 && count(own) < presetRows) {
      return { profile: preset, detected: preset.name };
    }
  }
  return { profile: own, detected: own.name };
}

/** Perfil inicial do assistente; `detected` = nome do preset reconhecido (para "Formato detectado"). */
export function initialProfile(
  header: readonly string[],
  saved: readonly CsvProfile[],
  dest: Destination | null,
  delimiter: CsvProfile['delimiter'],
  count?: (profile: CsvProfile) => number,
): { profile: CsvProfile; detected: string | null } {
  const own = dest ? saved.find((p) => p.id === profileIdFor(dest)) : undefined;
  if (own) {
    return count ? savedOrPreset(own, header, count) : { profile: own, detected: own.name };
  }
  const preset = sniffCsvProfile(header);
  if (preset) {
    return { profile: preset, detected: preset.name };
  }
  const cols = header.map((h) => h.trim());
  return {
    profile: {
      ...GENERIC,
      delimiter,
      columns: { date: cols[0] ?? '0', description: cols[1] ?? '1', amount: cols[2] ?? '2' },
    },
    detected: null,
  };
}

/** Guarda o mapeamento confirmado para o destino (substitui o anterior dele). */
export async function saveCsvProfile(
  db: OakDb,
  profile: CsvProfile,
  dest: Destination,
): Promise<void> {
  const row = await db.profiles.toCollection().first();
  if (!row) {
    return;
  }
  const settings = (row.settings ?? {}) as Record<string, unknown>;
  const id = profileIdFor(dest);
  const list = savedProfiles(settings).filter((p) => p.id !== id);
  await saveRow(db, 'profiles', {
    ...row,
    settings: {
      ...settings,
      csvProfiles: [...list, { ...profile, id, target: dest.kind }],
    } as unknown as typeof row.settings,
  });
}

/**
 * Depois de importar: guarda o mapeamento só se a importação gerou lançamentos (issue #152). Uma tentativa que não
 * leu nada não pode gravar o perfil, que passaria a valer para o destino em todo arquivo seguinte.
 */
export async function rememberCsvProfile(
  db: OakDb,
  profile: CsvProfile,
  dest: Destination,
  created: number,
): Promise<boolean> {
  if (created <= 0) {
    return false;
  }
  await saveCsvProfile(db, profile, dest);
  return true;
}
