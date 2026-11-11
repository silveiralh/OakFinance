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

/** Sem resposta do Worker em 20 s, a leitura segue na própria thread (issue #128: nada pode ficar sem retorno). */
export const WORKER_TIMEOUT_MS = 20_000;

/** Resposta do Worker no formato esperado (`{ ok: boolean, … }`). */
function isOutcome(data: unknown): boolean {
  return (
    typeof data === 'object' && data !== null && typeof (data as { ok?: unknown }).ok === 'boolean'
  );
}

/**
 * `create` precisa ser `new Worker(new URL('./x.worker.ts', import.meta.url))` literal: é assim que o Vite gera o
 * chunk. Qualquer falha do Worker (não criou, erro no script, mensagem ilegível, resposta fora do formato ou sem
 * resposta) cai na leitura na própria thread; um erro dessa leitura rejeita a promessa, e a tela mostra o aviso.
 */
function inWorker<T>(
  create: () => Worker,
  bytes: Uint8Array,
  fallback: () => T,
  timeoutMs = WORKER_TIMEOUT_MS,
): Promise<T> {
  const local = () => new Promise<T>((resolve) => resolve(fallback()));
  if (typeof Worker === 'undefined') {
    return local();
  }
  let worker: Worker;
  try {
    worker = create();
  } catch {
    return local();
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: { data: T } | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (outcome) {
        resolve(outcome.data);
      } else {
        local().then(resolve, reject);
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    worker.onmessage = (event: MessageEvent<T>) =>
      finish(isOutcome(event.data) ? { data: event.data } : null);
    worker.onerror = (event) => {
      event.preventDefault();
      finish(null);
    };
    worker.onmessageerror = () => finish(null);
    try {
      const copy = bytes.slice();
      worker.postMessage(copy.buffer, [copy.buffer]);
    } catch {
      finish(null);
    }
  });
}

/** Só para os testes: o mesmo caminho de `parseCsvFile` com um Worker qualquer. */
export const inWorkerForTests = inWorker;

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
