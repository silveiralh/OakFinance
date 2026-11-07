// Web Worker da importação (I03): o parse do OFX roda fora da thread da tela.
import { parseOfxBytes } from './ofx-parse';

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  self.postMessage(parseOfxBytes(new Uint8Array(event.data)));
};
