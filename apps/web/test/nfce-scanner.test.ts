// T-089: leitura do QR no aparelho (tech §6.2.1, UX §5.31): nativo quando lê `qr_code`, senão o ponyfill com o
// `.wasm` self-hosted; erro do detector conta como "não achou"; Lanterna só com `torch`.
import { afterEach, describe, expect, it, vi } from 'vitest';

const prepare = vi.fn();
const ponyfillDetect = vi.fn(() => Promise.resolve([{ rawValue: 'do ponyfill' }]));

vi.mock('barcode-detector/ponyfill', () => ({
  prepareZXingModule: prepare,
  BarcodeDetector: class {
    detect = ponyfillDetect;
  },
}));

async function load() {
  vi.resetModules();
  return import('../src/features/nfce/scanner');
}

afterEach(() => {
  vi.unstubAllGlobals();
  prepare.mockClear();
});

describe('US-54: detector de QR', () => {
  it('US-54: usa o BarcodeDetector nativo quando ele lê qr_code', async () => {
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats() {
          return Promise.resolve(['qr_code', 'ean_13']);
        }
        detect() {
          return Promise.resolve([{ rawValue: 'nativo' }]);
        }
      },
    );
    const { createQrDetector, detectQr } = await load();
    const detector = await createQrDetector();
    expect(await detectQr(detector, new Blob())).toBe('nativo');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('US-54: sem nativo (Safari no iPhone), carrega o ponyfill com o .wasm do próprio app', async () => {
    vi.stubGlobal('BarcodeDetector', undefined);
    const { createQrDetector, detectQr } = await load();
    const detector = await createQrDetector();
    expect(await detectQr(detector, new Blob())).toBe('do ponyfill');
    expect(prepare).toHaveBeenCalledTimes(1);
    const locate = prepare.mock.calls[0]?.[0].overrides.locateFile as (
      p: string,
      prefix: string,
    ) => string;
    expect(locate('zxing_reader.wasm', 'https://cdn.example.test/')).not.toContain('cdn');
    expect(locate('zxing_reader.wasm', 'https://cdn.example.test/')).toContain('zxing_reader');
    // uma vez por página
    await createQrDetector();
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('US-54: nativo sem qr_code também cai no ponyfill', async () => {
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats() {
          return Promise.resolve(['ean_13']);
        }
        detect() {
          return Promise.resolve([]);
        }
      },
    );
    const { createQrDetector } = await load();
    await createQrDetector();
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('US-54: erro do detector ou texto vazio contam como "não achou"', async () => {
    const { detectQr } = await load();
    expect(await detectQr({ detect: () => Promise.reject(new Error('x')) }, new Blob())).toBeNull();
    expect(
      await detectQr({ detect: () => Promise.resolve([{ rawValue: ' ' }]) }, new Blob()),
    ).toBeNull();
  });

  it('UX §5.31: Lanterna só quando a trilha diz que tem torch', async () => {
    const { supportsTorch, setTorch } = await load();
    const track = (torch?: boolean, fail = false) =>
      ({
        getCapabilities: () => (torch === undefined ? {} : { torch }),
        applyConstraints: () => (fail ? Promise.reject(new Error('x')) : Promise.resolve()),
      }) as unknown as MediaStreamTrack;
    expect(supportsTorch(undefined)).toBe(false);
    expect(supportsTorch(track())).toBe(false);
    expect(supportsTorch(track(true))).toBe(true);
    expect(await setTorch(track(true), true)).toBe(true);
    expect(await setTorch(track(true, true), true)).toBe(false);
  });
});
