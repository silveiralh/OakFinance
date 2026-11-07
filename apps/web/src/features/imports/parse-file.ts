// Parse do OFX no Web Worker (a tela não trava com 5.000 linhas); sem `Worker` (testes, navegador antigo), na
// própria thread.
import { type ParseOutcome, parseOfxBytes } from './ofx-parse';

export function parseFile(bytes: Uint8Array): Promise<ParseOutcome> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(parseOfxBytes(bytes));
  }
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./ofx.worker.ts', import.meta.url), { type: 'module' });
    const done = (outcome: ParseOutcome) => {
      worker.terminate();
      resolve(outcome);
    };
    worker.onmessage = (event: MessageEvent<ParseOutcome>) => done(event.data);
    worker.onerror = () => done(parseOfxBytes(bytes));
    const copy = bytes.slice();
    worker.postMessage(copy.buffer, [copy.buffer]);
  });
}
