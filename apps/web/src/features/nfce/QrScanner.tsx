// UX §5.31 QRScanner (T-089): explicação antes da permissão, câmera traseira com moldura, Lanterna (se a trilha
// tiver `torch`), e sempre Escolher foto e Digitar chave. A foto é lida e descartada (tech §6.2.1).
import { Camera, CameraOff, Flashlight, ImageUp, Keyboard } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n/pt-BR';
import { Banner, Button, GlassCard, TextField } from '../../ui';
import { groupKey } from './flow';
import { createQrDetector, detectQr, setTorch, supportsTorch } from './scanner';

/** Intervalo entre leituras do quadro da câmera. */
const SCAN_EVERY_MS = 250;

type CameraState = 'intro' | 'starting' | 'on' | 'denied';

export interface QrScannerProps {
  /** Texto do QR lido pela câmera ou pela foto (`null` = a foto não tinha QR). */
  onResult: (payload: string | null) => void;
  /** Chave digitada ou link colado. */
  onManualKey: (key: string) => void;
  busy?: boolean;
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

export function QrScanner({ onResult, onManualKey, busy = false }: QrScannerProps) {
  const [camera, setCamera] = useState<CameraState>('intro');
  const [torch, setTorchState] = useState<'none' | 'off' | 'on'>('none');
  const [manual, setManual] = useState(false);
  const [key, setKey] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const result = useRef(onResult);
  result.current = onResult;

  // desliga a câmera ao sair da tela
  useEffect(() => () => stopStream(stream.current), []);

  // laço de leitura enquanto a câmera está ligada
  useEffect(() => {
    if (camera !== 'on') {
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void createQrDetector()
      .then((detector) => {
        const tick = async () => {
          const el = video.current;
          if (!alive || !el) {
            return;
          }
          const raw = el.readyState >= 2 ? await detectQr(detector, el) : null;
          if (!alive) {
            return;
          }
          if (raw) {
            stopStream(stream.current);
            stream.current = null;
            setCamera('intro');
            setTorchState('none');
            result.current(raw);
            return;
          }
          timer = setTimeout(() => void tick(), SCAN_EVERY_MS);
        };
        void tick();
      })
      .catch(() => alive && setCamera('denied'));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [camera]);

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('denied');
      return;
    }
    setCamera('starting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      stream.current = media;
      const el = video.current;
      if (el) {
        el.srcObject = media;
        await el.play().catch(() => undefined);
      }
      setTorchState(supportsTorch(media.getVideoTracks()[0]) ? 'off' : 'none');
      setCamera('on');
    } catch {
      setCamera('denied');
    }
  };

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) {
      return;
    }
    const next = torch !== 'on';
    if (await setTorch(track, next)) {
      setTorchState(next ? 'on' : 'off');
    }
  };

  const readPhoto = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const raw = await createQrDetector()
      .then((detector) => detectQr(detector, file))
      .catch(() => null);
    if (photo.current) {
      photo.current.value = '';
    }
    onResult(raw);
  };

  const digitsOnly = /^[\d\s]*$/.test(key);
  return (
    <div className="qr-scanner" data-testid="qr-scanner" data-camera={camera}>
      <div className="qr-viewport" hidden={camera !== 'on' && camera !== 'starting'}>
        <video ref={video} muted playsInline />
        <div className="qr-frame" aria-hidden="true" />
      </div>
      {camera === 'intro' && (
        <GlassCard level={2}>
          <p>{t('nfce.cameraIntro')}</p>
          <Button
            fullWidth
            iconStart={Camera}
            onClick={() => void openCamera()}
            data-testid="nfce-camera"
          >
            {t('nfce.openCamera')}
          </Button>
        </GlassCard>
      )}
      {(camera === 'on' || camera === 'starting') && <p className="qr-aim">{t('nfce.aim')}</p>}
      {camera === 'denied' && (
        <Banner
          tone="warning"
          icon={CameraOff}
          message={t('nfce.noCamera')}
          action={{ label: t('nfce.photo'), onPress: () => photo.current?.click() }}
          data-testid="nfce-no-camera"
        />
      )}
      <div className="qr-actions">
        {torch !== 'none' && (
          <Button
            variant={torch === 'on' ? 'primary' : 'secondary'}
            iconStart={Flashlight}
            onClick={() => void toggleTorch()}
          >
            {t('nfce.torch')}
          </Button>
        )}
        <Button
          variant="secondary"
          iconStart={ImageUp}
          onClick={() => photo.current?.click()}
          disabled={busy}
        >
          {t('nfce.photo')}
        </Button>
        <Button variant="secondary" iconStart={Keyboard} onClick={() => setManual((open) => !open)}>
          {t('nfce.manual')}
        </Button>
      </div>
      <input
        ref={photo}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => void readPhoto(event.target.files?.[0])}
        data-testid="nfce-photo"
      />
      {manual && (
        <GlassCard level={2}>
          <TextField
            label={t('nfce.manual')}
            value={digitsOnly ? groupKey(key) : key}
            onChange={setKey}
            inputMode="numeric"
            autoComplete="off"
            data-testid="nfce-input"
          />
          <Button
            fullWidth
            loading={busy}
            disabled={!key.trim()}
            onClick={() => onManualKey(key)}
            data-testid="nfce-submit"
          >
            {t('common.continue')}
          </Button>
        </GlassCard>
      )}
    </div>
  );
}
