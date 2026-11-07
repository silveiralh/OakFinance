// Parse no Web Worker (a tela não trava com 5.000 linhas); sem `Worker` (testes, navegador antigo), na própria
// thread.
import { type CsvDelimiter, decodeCsvBytes, tokenizeCsv } from './csv-parse';
import { type ParseOutcome, parseOfxBytes } from './ofx-parse';

export type CsvFileOutcome =
  | {
      ok: true;
      text: string;
      encoding: 'utf-8' | 'windows-1252';
      rows: string[][];
      delimiter: CsvDelimiter;
    }
  | { ok: false; code: 'TOO_LARGE' | 'BAD_FILE' | 'EMPTY' };

/** `create` precisa ser `new Worker(new URL('./x.worker.ts', import.meta.url))` literal: é assim que o Vite gera o chunk. */
function inWorker<T>(create: () => Worker, bytes: Uint8Array, fallback: () => T): Promise<T> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(fallback());
  }
  return new Promise((resolve) => {
    const worker = create();
    const done = (outcome: T) => {
      worker.terminate();
      resolve(outcome);
    };
    worker.onmessage = (event: MessageEvent<T>) => done(event.data);
    worker.onerror = () => done(fallback());
    const copy = bytes.slice();
    worker.postMessage(copy.buffer, [copy.buffer]);
  });
}

export function parseFile(bytes: Uint8Array): Promise<ParseOutcome> {
  return inWorker(
    () => new Worker(new URL('./ofx.worker.ts', import.meta.url), { type: 'module' }),
    bytes,
    () => parseOfxBytes(bytes),
  );
}

export function parseCsvFile(bytes: Uint8Array): Promise<CsvFileOutcome> {
  return inWorker(
    () => new Worker(new URL('./csv.worker.ts', import.meta.url), { type: 'module' }),
    bytes,
    () => {
      const decoded = decodeCsvBytes(bytes);
      return decoded.ok ? { ...decoded, ...tokenizeCsv(decoded.text) } : decoded;
    },
  );
}

/** OFX pelo nome ou pelo conteúdo (`<OFX>` / `OFXHEADER`); o resto é tratado como CSV. */
export function looksLikeOfx(name: string, bytes: Uint8Array): boolean {
  if (/\.ofx$/i.test(name)) {
    return true;
  }
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 512));
  return /OFXHEADER|<OFX>/i.test(head);
}
