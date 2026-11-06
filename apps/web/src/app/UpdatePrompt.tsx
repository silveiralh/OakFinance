import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { shellText } from '../i18n/pt-BR';
import { applyUpdate, isUpdateActivated, isUpdateReady, subscribeUpdate } from '../lib/sw-update';
import { useToast } from '../ui';
import { QUICK_ENTRY_PARAM } from './screens';

/**
 * Recarregar agora apagaria o que está sendo digitado? Enquanto o Q01 estiver aberto (`?novo=`), a recarga espera
 * o sheet fechar (US-03, tech §4.8). A T-040 troca pela checagem do rascunho de verdade.
 */
export function reloadBlocked(search: string): boolean {
  return new URLSearchParams(search).has(QUICK_ENTRY_PARAM);
}

export interface UpdatePromptProps {
  reload?: () => void;
  /** `navigator.serviceWorker` (injetável no teste). */
  serviceWorker?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | undefined;
}

/** Caminho pedido pelo SW (clique em notificação numa janela que ele não controla). */
export function navigateTarget(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const { type, url } = data as { type?: unknown; url?: unknown };
  return type === 'NAVIGATE' &&
    typeof url === 'string' &&
    url.startsWith('/') &&
    !url.startsWith('//')
    ? url
    : null;
}

/**
 * G07: toast persistente "Nova versão disponível." com "Atualizar". Também atende o pedido de navegação do SW
 * (`NAVIGATE`). `RUN_SYNC` e `PUSH_RESUBSCRIBE` ficam com o motor de sync (T-033) e o push (T-064).
 */
export function UpdatePrompt({
  reload = () => window.location.reload(),
  serviceWorker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker,
}: UpdatePromptProps) {
  const toast = useToast();
  const ready = useSyncExternalStore(subscribeUpdate, isUpdateReady, () => false);
  const activated = useSyncExternalStore(subscribeUpdate, isUpdateActivated, () => false);
  const shown = useRef(false);
  const reloaded = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!serviceWorker) {
      return;
    }
    const onMessage = (event: Event) => {
      const target = navigateTarget((event as MessageEvent).data);
      if (target) {
        void navigate(target);
      }
    };
    serviceWorker.addEventListener('message', onMessage);
    return () => serviceWorker.removeEventListener('message', onMessage);
  }, [serviceWorker, navigate]);

  useEffect(() => {
    if (ready && !shown.current) {
      shown.current = true;
      toast({
        message: shellText.updateAvailable,
        tone: 'info',
        duration: Number.POSITIVE_INFINITY,
        action: { label: shellText.update, onPress: applyUpdate },
      });
    }
  }, [ready, toast]);

  useEffect(() => {
    if (activated && !reloaded.current && !reloadBlocked(location.search)) {
      reloaded.current = true;
      reload();
    }
  }, [activated, location.search, reload]);

  return null;
}
