// Leitura do CSV (RN-76): decodificação (UTF-8, senão Windows-1252) e tokenização com o papaparse. Sem Dexie nem
// tela, para rodar no Web Worker (`csv.worker.ts`).
import { MAX_IMPORT_BYTES } from '@oakfinance/domain';
import Papa from 'papaparse';

export type CsvDelimiter = ',' | ';' | '\t';

export type CsvOutcome =
  | { ok: true; text: string; encoding: 'utf-8' | 'windows-1252' }
  | { ok: false; code: 'TOO_LARGE' | 'BAD_FILE' | 'EMPTY' };

/** Bytes → texto: UTF-8 estrito; se falhar, Windows-1252 (exportações antigas de banco). */
export function decodeCsvBytes(bytes: Uint8Array): CsvOutcome {
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    return { ok: false, code: 'TOO_LARGE' };
  }
  let text: string;
  let encoding: 'utf-8' | 'windows-1252' = 'utf-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
    encoding = 'windows-1252';
  }
  text = text.replace(/^﻿/, '');
  if (text.trim() === '') {
    return { ok: false, code: 'EMPTY' };
  }
  if (text.includes('\u0000') || /<OFX>/i.test(text)) {
    return { ok: false, code: 'BAD_FILE' };
  }
  return { ok: true, text, encoding };
}

/** Linhas e colunas; sem separador informado, o do papaparse (vírgula, ponto e vírgula ou tabulação). */
export function tokenizeCsv(
  text: string,
  delimiter?: CsvDelimiter,
): { rows: string[][]; delimiter: CsvDelimiter } {
  const result = Papa.parse<string[]>(text, {
    delimiter: delimiter ?? '',
    delimitersToGuess: [',', ';', '\t'],
    skipEmptyLines: false,
  });
  const used = result.meta.delimiter;
  return {
    rows: result.data.filter((row) => Array.isArray(row)),
    delimiter: used === ';' || used === '\t' ? used : ',',
  };
}
