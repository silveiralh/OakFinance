// Rascunho do lançamento (US-64, G11): fica sempre em memória e vai para o `kv` assim que houver espaço.
import type { OakDb } from './db';
import { ok, type Result } from './result';
import { writeLocal } from './storage';

const DRAFT_PREFIX = 'draft:';
const memory = new Map<string, unknown>();
const unsaved = new Set<string>();

export type DraftSaved = 'kv' | 'memory';

/** Guarda o rascunho; com o armazenamento cheio ele fica só em memória até `flushDrafts`. */
export async function saveDraft(
  db: OakDb,
  key: string,
  value: unknown,
): Promise<Result<DraftSaved>> {
  memory.set(key, value);
  const result = await writeLocal(() => db.kv.put({ key: `${DRAFT_PREFIX}${key}`, value }));
  if (result.ok) {
    unsaved.delete(key);
    return ok('kv');
  }
  unsaved.add(key);
  return result.error.code === 'STORAGE_QUOTA' || result.error.code === 'STORAGE_UNAVAILABLE'
    ? ok('memory')
    : result;
}

export async function loadDraft(db: OakDb, key: string): Promise<unknown> {
  if (memory.has(key)) {
    return memory.get(key);
  }
  const entry = await db.kv.get(`${DRAFT_PREFIX}${key}`);
  return entry?.value;
}

/** Rascunhos que ainda não foram gravados no aparelho. */
export function unsavedDrafts(): string[] {
  return [...unsaved];
}

/** Tenta gravar de novo os rascunhos que ficaram só em memória. Devolve quantos continuam pendentes. */
export async function flushDrafts(db: OakDb): Promise<number> {
  for (const key of [...unsaved]) {
    await saveDraft(db, key, memory.get(key));
  }
  return unsaved.size;
}

export async function clearDraft(db: OakDb, key: string): Promise<void> {
  memory.delete(key);
  unsaved.delete(key);
  await writeLocal(() => db.kv.delete(`${DRAFT_PREFIX}${key}`));
}

/** Só para os testes. */
export function resetDrafts(): void {
  memory.clear();
  unsaved.clear();
}
