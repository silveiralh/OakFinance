// Telemetria da sessão (tech §7.3, RN-104): `usage.app_aberto` uma vez por abertura do app e a captura de
// `window.onerror`/`unhandledrejection` enquanto há sessão.
import { useEffect } from 'react';
import { appVersion } from '../lib/env';
import { captureErrors, trackUsage } from '../lib/telemetry';
import { useAuth } from './auth';

let opened = false;

/** Só para testes: permite registrar outra abertura. */
export function resetAppOpened(): void {
  opened = false;
}

export function AppTelemetry() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) {
      return;
    }
    const version = appVersion();
    const stop = captureErrors(user.db, window, version);
    if (!opened) {
      opened = true;
      void trackUsage(
        user.db,
        'app_aberto',
        { offline: typeof navigator !== 'undefined' && !navigator.onLine },
        { appVersion: version },
      );
    }
    return stop;
  }, [user]);
  return null;
}
