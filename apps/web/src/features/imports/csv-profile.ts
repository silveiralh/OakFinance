// Perfil do CSV (RN-76): o salvo para o destino, senão o preset detectado pelo cabeçalho (Nubank), senão o
// genérico com as colunas chutadas pela ordem. O mapeamento confirmado fica em `profiles.settings.csvProfiles`,
// um por conta ou cartão.
import { CSV_PRESETS, type CsvProfile, sniffCsvProfile } from '@oakfinance/domain';
import type { OakDb } from '../../data/db';
import { saveRow } from '../../data/repositories/rows';
import type { Destination } from './ofx-import';

export function profileIdFor(dest: Destination): string {
  return `dest-${dest.kind}-${dest.id}`;
}

export function savedProfiles(settings: unknown): CsvProfile[] {
  const list = (settings as { csvProfiles?: unknown } | null)?.csvProfiles;
  return Array.isArray(list) ? (list as CsvProfile[]) : [];
}

const GENERIC = CSV_PRESETS.find((p) => p.id === 'generico-br') as CsvProfile;

/** Perfil inicial do assistente; `detected` = nome do preset reconhecido (para "Formato detectado"). */
export function initialProfile(
  header: readonly string[],
  saved: readonly CsvProfile[],
  dest: Destination | null,
  delimiter: CsvProfile['delimiter'],
): { profile: CsvProfile; detected: string | null } {
  const own = dest ? saved.find((p) => p.id === profileIdFor(dest)) : undefined;
  if (own) {
    return { profile: own, detected: own.name };
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
