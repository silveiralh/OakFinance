// S07 — Lembretes (UX §3 S01, US-38): status da permissão deste aparelho, "Ativar lembretes" (só no toque),
// textos de permissão negada por plataforma, guia de instalação no iPhone fora da Tela de Início, "Enviar
// notificação de teste" e desativar. As preferências por tipo de lembrete chegam na T-093.
import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../app/auth';
import { deviceId } from '../../data/sync/clock';
import { type MessageKey, t } from '../../i18n/pt-BR';
import { getEnv } from '../../lib/env';
import {
  baseState,
  currentSubscription,
  disablePush,
  enablePush,
  type PushEnvironment,
  type PushState,
  platformOf,
  readEnvironment,
  sendTestPush,
} from '../../lib/push';
import { Button, GlassCard, useToast } from '../../ui';

function vapidKey(): string | null {
  try {
    return getEnv().vapidPublicKey;
  } catch {
    return null;
  }
}

const DENIED: Record<string, MessageKey> = {
  android: 'push.denied.android',
  ios: 'push.denied.ios',
  desktop: 'push.denied.desktop',
  other: 'push.denied.desktop',
};

/** Texto de status da S07 para cada estado (`expired`: permitido, mas sem inscrição neste aparelho). */
export function statusText(state: PushState, env: PushEnvironment, expired: boolean): string {
  switch (state) {
    case 'on':
      return t('push.status.on');
    case 'denied':
      return t(DENIED[platformOf(env.userAgent, env.maxTouchPoints)] ?? 'push.denied.desktop');
    case 'unsupported':
      return t('push.status.unsupported');
    case 'unconfigured':
      return t('push.status.unconfigured');
    case 'ios-not-installed':
      return t('home.install.card');
    default:
      return expired ? t('push.status.expired') : t('push.status.off');
  }
}

export function RemindersScreen({ environment }: { environment?: PushEnvironment }) {
  const { user, client } = useAuth();
  const showToast = useToast();
  const [env] = useState(() => environment ?? readEnvironment());
  const key = vapidKey();
  const [state, setState] = useState<PushState>(() => baseState(env, key));
  const [busy, setBusy] = useState(false);
  const expired = state === 'off' && env.permission === 'granted';

  useEffect(() => {
    if (baseState(env, key) !== 'off') {
      return;
    }
    let alive = true;
    void currentSubscription().then((sub) => {
      if (alive && sub) {
        setState('on');
      }
    });
    return () => {
      alive = false;
    };
  }, [env, key]);

  const activate = async () => {
    if (!client || !user || !key) {
      return;
    }
    setBusy(true);
    try {
      const next = await enablePush(client, key, await deviceId(user.db));
      setState(next);
      if (next === 'on') {
        showToast({ message: t('push.activated'), tone: 'success' });
        const sent = await sendTestPush(client);
        if (sent === null) {
          showToast({ message: t('push.testFailed'), tone: 'warning' });
        }
      }
    } catch {
      setState(baseState(readEnvironment(), key));
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    if (!client) {
      return;
    }
    setBusy(true);
    const sent = await sendTestPush(client);
    setBusy(false);
    showToast(
      sent === null || sent === 0
        ? { message: t('push.testFailed'), tone: 'warning' }
        : { message: t('push.testSent'), tone: 'success' },
    );
  };
  const deactivate = async () => {
    if (!client) {
      return;
    }
    setBusy(true);
    await disablePush(client).catch(() => undefined);
    setBusy(false);
    setState('off');
  };

  const Glyph = state === 'on' ? Bell : BellOff;
  return (
    <section className="screen reminders" data-screen="S07" data-testid="screen-S07">
      <GlassCard level={2} className="reminders-status" data-testid="push-status">
        <span className="reminders-icon" aria-hidden="true">
          <Glyph size={24} />
        </span>
        <p role="status" data-state={state} data-testid="push-state">
          {statusText(state, env, expired)}
        </p>
        {state !== 'on' && <p className="reminders-hint">{t('push.central')}</p>}
        {state === 'ios-not-installed' && (
          <Link to="/instalar" className="home-pill-link" data-tone="accent">
            {t('push.installCta')}
          </Link>
        )}
        {state === 'off' && (
          <Button onClick={() => void activate()} loading={busy} data-testid="push-enable">
            {t('onb.notif.cta')}
          </Button>
        )}
        {state === 'on' && (
          <div className="reserve-actions">
            <Button onClick={() => void test()} loading={busy} data-testid="push-test">
              {t('push.test')}
            </Button>
            <Button variant="ghost" onClick={() => void deactivate()} data-testid="push-disable">
              {t('push.disable')}
            </Button>
          </div>
        )}
      </GlassCard>
    </section>
  );
}
