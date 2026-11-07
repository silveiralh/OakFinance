// Leitura do OFX (RN-75): decodificação pelo cabeçalho e parser do domínio. Sem Dexie nem tela, para rodar no
// Web Worker (`ofx.worker.ts`) sem levar o resto do app junto.
import {
  DomainError,
  decodeOfxBytes,
  MAX_IMPORT_BYTES,
  type OfxStatement,
  parseOfx,
} from '@oakfinance/domain';

export type ParseOutcome =
  | { ok: true; statements: OfxStatement[] }
  | { ok: false; code: 'TOO_LARGE' | 'BAD_FILE' | 'EMPTY' };

/** Lê o OFX (decodificação da RN-75 + parser). Usado pelo worker e, sem worker, direto. */
export function parseOfxBytes(bytes: Uint8Array): ParseOutcome {
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    return { ok: false, code: 'TOO_LARGE' };
  }
  try {
    const statements = parseOfx(decodeOfxBytes(bytes));
    const count = statements.reduce((n, s) => n + s.transactions.length, 0);
    return count === 0 ? { ok: false, code: 'EMPTY' } : { ok: true, statements };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, code: error.code === 'IMPORT_TOO_LARGE' ? 'TOO_LARGE' : 'BAD_FILE' };
    }
    return { ok: false, code: 'BAD_FILE' };
  }
}
