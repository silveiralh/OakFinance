// Tech §6.4.2: a cada abertura, com a permissão já concedida, renova a inscrição de push deste aparelho no servidor;
// quando o SW avisa que a inscrição mudou (`pushsubscriptionchange` → PUSH_RESUBSCRIBE), inscreve de novo.
import { useEffect } from 'react';
import { deviceId } from '../data/sync/clock';
import { getEnv } from '../lib/env';
import { currentSubscription, keyBytes, readEnvironment, registerSubscription } from '../lib/push';
import { PUSH_RESUBSCRIBE } from '../sw/handlers';
import { useAuth } from './auth';

export function PushKeeper() {
  const { user, client } = useAuth();
  useEffect(() => {
    let key: string | null = null;
    try {
      key = getEnv().vapidPublicKey;
    } catch {
      key = null;
    }
    const env = readEnvironment();
    if (!user || !client || !key || env.permission !== 'granted' || !env.hasServiceWorker) {
      return;
    }
    const vapid = key;
    let alive = true;
    const renew = async (resubscribe: boolean) => {
      let sub = await currentSubscription();
      if (!sub && resubscribe) {
        const reg = await navigator.serviceWorker.ready;
        sub = await reg.pushManager
          .subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapid) })
          .catch(() => null);
      }
      if (alive && sub) {
        await registerSubscription(client, sub, await deviceId(user.db));
      }
    };
    void renew(false).catch(() => undefined);
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === PUSH_RESUBSCRIBE) {
        void renew(true).catch(() => undefined);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      alive = false;
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [user, client]);
  return null;
}
