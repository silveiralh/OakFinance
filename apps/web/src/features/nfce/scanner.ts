// I04 — leitura do QR no aparelho (T-089; tech §6.2.1, UX §5.31). `BarcodeDetector` nativo quando existe (Chrome
// no Android); senão o ponyfill `barcode-detector` (zxing-wasm), carregado sob demanda e com o `.wasm`
// self-hosted (vai para o precache pelo glob do `vite.config.ts`). A foto escolhida não é guardada.

/** O mínimo do `BarcodeDetector` que a I04 usa. */
export interface QrDetector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}

interface DetectorCtor {
  new (options?: { formats?: string[] }): QrDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

function nativeCtor(): DetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

async function nativeSupportsQr(ctor: DetectorCtor): Promise<boolean> {
  if (!ctor.getSupportedFormats) {
    return true;
  }
  try {
    return (await ctor.getSupportedFormats()).includes('qr_code');
  } catch {
    return false;
  }
}

let ponyfill: Promise<QrDetector> | null = null;

async function loadPonyfill(): Promise<QrDetector> {
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  // sem isto o zxing-wasm buscaria o .wasm num CDN (e a CSP recusaria)
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasmUrl : prefix + path,
    },
  });
  return new BarcodeDetector({ formats: ['qr_code'] });
}

/** Detector de QR: o nativo, se ler `qr_code`; senão o ponyfill (uma vez por página). */
export async function createQrDetector(): Promise<QrDetector> {
  const ctor = nativeCtor();
  if (ctor && (await nativeSupportsQr(ctor))) {
    return new ctor({ formats: ['qr_code'] });
  }
  ponyfill ??= loadPonyfill().catch((error: unknown) => {
    ponyfill = null;
    throw error;
  });
  return ponyfill;
}

/** Primeiro QR com texto na imagem, ou `null`. Erro do detector conta como "não achou". */
export async function detectQr(
  detector: QrDetector,
  source: ImageBitmapSource,
): Promise<string | null> {
  try {
    const found = await detector.detect(source);
    return found.find((code) => code.rawValue.trim())?.rawValue ?? null;
  } catch {
    return null;
  }
}

/** Lanterna: só quando a trilha de vídeo diz que tem `torch` (UX §5.31). */
export function supportsTorch(track: MediaStreamTrack | undefined): boolean {
  if (!track || typeof track.getCapabilities !== 'function') {
    return false;
  }
  return Boolean((track.getCapabilities() as { torch?: boolean }).torch);
}

export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}
