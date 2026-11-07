// Web Worker da importação de CSV (I03): decodificação e tokenização fora da thread da tela.
import { decodeCsvBytes, tokenizeCsv } from './csv-parse';

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  const decoded = decodeCsvBytes(new Uint8Array(event.data));
  self.postMessage(decoded.ok ? { ...decoded, ...tokenizeCsv(decoded.text) } : decoded);
};
