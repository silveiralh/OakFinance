// Backup completo e restauração (US-60, S10). O arquivo `backup_AAAA-MM-DD.json` leva a versão do esquema
// (`schema_version`, a última migração) e as linhas de todas as tabelas que o aparelho grava (sem `user_id` e sem
// os campos locais). Ficam de fora as conexões bancárias e contas externas (segredos de integração, escritas só pelo
// servidor) e as assinaturas push (que nem existem no aparelho). A restauração substitui tudo numa única transação:
// cada linha do arquivo é gravada com o `user_id` de quem restaura, e o que existe no aparelho e não está no
// arquivo recebe exclusão lógica (RN-99). Tudo vai para a outbox e o servidor recebe pelo `sync_push` (RN-102: a
// RLS garante que cada linha fica com o dono da sessão).
import { type ISODate, todayIn } from '@oakfinance/domain';
import { type LocalRow, type OakDb, SYNCED_TABLES, type SyncedTable } from '../../data/db';
import { MapperError, parseRow, toServerRow } from '../../data/mappers';
import { putInTransaction, writeScope } from '../../data/repositories/rows';
import type { Result } from '../../data/result';
import { writeLocal } from '../../data/storage';
import { deviceId } from '../../data/sync/clock';

/** Identifica o arquivo como backup deste app. */
export const BACKUP_FORMAT = 'oakfinance-backup';

/**
 * Versão do esquema do banco que o arquivo segue: o prefixo da última migração em `supabase/migrations`. O teste
 * `backup.test.ts` confere; quem acrescentar uma migração atualiza aqui.
 */
export const BACKUP_SCHEMA_VERSION = '20261105000009';

/** Tabelas fora do backup: segredos de integração (US-60), gravadas só pelo servidor. */
export const BACKUP_EXCLUDED: readonly SyncedTable[] = ['bank_connections', 'external_accounts'];

/** Tabelas do backup, na ordem de dependência (pais antes de filhos). */
export const BACKUP_TABLES: readonly SyncedTable[] = SYNCED_TABLES.filter(
  (table) => !BACKUP_EXCLUDED.includes(table),
);

/** Colunas que não vão para o arquivo: o dono (reescrito na restauração). */
const DROPPED_COLUMNS = new Set(['user_id']);

export type BackupRow = Record<string, unknown> & { id: string };

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schema_version: string;
  app_version: string;
  exported_at: string;
  tables: Partial<Record<SyncedTable, BackupRow[]>>;
}

function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
}

/** "backup_2026-11-07.json" (US-60), com a data de hoje no fuso de São Paulo. */
export function backupFileName(today: ISODate): string {
  return `backup_${today}.json`;
}

function toBackupRow(row: LocalRow<SyncedTable>): BackupRow {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(toServerRow(row))) {
    if (!DROPPED_COLUMNS.has(key)) {
      out[key] = value;
    }
  }
  return out as BackupRow;
}

/** Monta o backup com todas as linhas das tabelas do backup (inclusive as excluídas logicamente), por `id`. */
export async function buildBackup(db: OakDb, nowMs: number = Date.now()): Promise<BackupFile> {
  const tables: Partial<Record<SyncedTable, BackupRow[]>> = {};
  for (const table of BACKUP_TABLES) {
    const rows = (await db.table(table).toArray()) as LocalRow<SyncedTable>[];
    tables[table] = rows.map(toBackupRow).sort((a, b) => a.id.localeCompare(b.id));
  }
  return {
    format: BACKUP_FORMAT,
    schema_version: BACKUP_SCHEMA_VERSION,
    app_version: appVersion(),
    exported_at: new Date(nowMs).toISOString(),
    tables,
  };
}

export interface BackupDownload {
  name: string;
  content: string;
}

/** Arquivo pronto para baixar: JSON com indentação (legível e comparável). */
export async function exportBackup(db: OakDb, nowMs: number = Date.now()): Promise<BackupDownload> {
  const backup = await buildBackup(db, nowMs);
  return {
    name: backupFileName(todayIn('America/Sao_Paulo', new Date(nowMs))),
    content: `${JSON.stringify(backup, null, 2)}\n`,
  };
}

/** Arquivo que não é um backup válido deste app, ou de versão incompatível (US-60). */
export class BackupError extends Error {
  override name = 'BackupError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Backup lido e validado: cada linha já passou pelo zod da tabela, com o `user_id` de quem restaura. */
export interface ParsedBackup {
  schemaVersion: string;
  exportedAt: string;
  tables: Map<SyncedTable, LocalRow<SyncedTable>[]>;
}

/**
 * Lê e valida o arquivo. Recusa (com `BackupError`): JSON inválido, outro formato, versão do esquema mais nova que
 * a do app (ou malformada), tabela desconhecida ou fora do backup, linha que não passa no schema da tabela, `id`
 * repetido e mais de um perfil. Versão mais antiga é aceita se as linhas tiverem todas as colunas de hoje.
 */
export function parseBackup(text: string, userId: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new BackupError('JSON inválido');
  }
  if (!isRecord(data) || data.format !== BACKUP_FORMAT) {
    throw new BackupError('formato desconhecido');
  }
  const version = data.schema_version;
  if (typeof version !== 'string' || !/^\d{14}$/.test(version)) {
    throw new BackupError('versão do esquema ausente');
  }
  if (version > BACKUP_SCHEMA_VERSION) {
    throw new BackupError(`versão do esquema ${version} mais nova que a do app`);
  }
  const exportedAt = data.exported_at;
  if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt))) {
    throw new BackupError('data do backup ausente');
  }
  if (!isRecord(data.tables)) {
    throw new BackupError('sem tabelas');
  }
  const tables = new Map<SyncedTable, LocalRow<SyncedTable>[]>();
  for (const [name, rows] of Object.entries(data.tables)) {
    const table = BACKUP_TABLES.find((t) => t === name);
    if (!table) {
      throw new BackupError(`tabela fora do backup: ${name}`);
    }
    if (!Array.isArray(rows)) {
      throw new BackupError(`tabela ${name} não é uma lista`);
    }
    const seen = new Set<string>();
    const parsed = rows.map((raw: unknown) => {
      if (!isRecord(raw)) {
        throw new BackupError(`linha inválida em ${name}`);
      }
      const owned = { ...raw, user_id: userId, ...(table === 'profiles' ? { id: userId } : {}) };
      let row: LocalRow<SyncedTable>;
      try {
        row = parseRow(table, owned);
      } catch (error) {
        throw new BackupError(error instanceof MapperError ? error.message : String(error));
      }
      if (seen.has(row.id)) {
        throw new BackupError(`id repetido em ${name}`);
      }
      seen.add(row.id);
      return row;
    });
    tables.set(table, parsed);
  }
  if ((tables.get('profiles')?.length ?? 0) > 1) {
    throw new BackupError('mais de um perfil');
  }
  return {
    schemaVersion: version,
    exportedAt,
    tables,
  };
}

/** Dia do backup no fuso de São Paulo, para a confirmação. */
export function backupDay(backup: ParsedBackup): ISODate {
  return todayIn('America/Sao_Paulo', new Date(backup.exportedAt));
}

/** Quantas linhas ativas (sem exclusão lógica) de cada tabela vieram do arquivo. */
export type RestoreSummary = Partial<Record<SyncedTable, number>>;

/**
 * Substitui os dados do usuário pelos do backup, numa única transação local (tudo ou nada). Linhas do arquivo são
 * gravadas inteiras; linhas ativas do aparelho que não estão no arquivo recebem `deleted_at`. O perfil só é trocado
 * quando o arquivo traz um. Chame `engine.notifyWrite()` depois, para enviar.
 */
export async function restoreBackup(
  db: OakDb,
  backup: ParsedBackup,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<Result<RestoreSummary>> {
  const device = await deviceId(db);
  const deletedAt = new Date(nowMs).toISOString();
  return writeLocal(() =>
    db.transaction('rw', writeScope(BACKUP_TABLES), async () => {
      const summary: RestoreSummary = {};
      for (const table of BACKUP_TABLES) {
        const incoming = backup.tables.get(table) ?? [];
        if (table === 'profiles' && incoming.length === 0) {
          continue;
        }
        const keep = new Set(incoming.map((row) => row.id));
        const current = (await db.table(table).toArray()) as LocalRow<SyncedTable>[];
        // Exclusões antes das gravações: libera os índices únicos parciais (`where deleted_at is null`).
        for (const row of current) {
          if (!keep.has(row.id) && row.deleted_at === null) {
            await putInTransaction(db, table, { ...row, deleted_at: deletedAt }, device, nowMs);
          }
        }
        for (const row of incoming) {
          await putInTransaction(db, table, row, device, nowMs);
        }
        summary[table] = incoming.filter((row) => row.deleted_at === null).length;
      }
      return summary;
    }),
  );
}
