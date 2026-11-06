// Service Worker (tech §4.8, injectManifest). Não roda o motor de sync: só precache do shell, rotas de cache,
// atualização sob pedido (SKIP_WAITING), push declarativo e clique na notificação. A lógica fica em handlers.ts.
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';
import {
  broadcast,
  type ClientsLike,
  isSkipWaiting,
  notificationFromPush,
  openFromNotification,
  PUSH_RESUBSCRIBE,
  parsePushData,
  RUN_SYNC,
} from './handlers';

/** Evento com `waitUntil` (ExtendableEvent), sem depender da lib WebWorker no tsconfig do app. */
interface Extendable extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SwScope {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;
  location: Location;
  clients: ClientsLike;
  registration: {
    showNotification(title: string, options?: NotificationOptions): Promise<void>;
  };
  navigator: Navigator & { setAppBadge?: (count?: number) => Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(
    type: string,
    listener: (event: Extendable & Record<string, unknown>) => void,
  ): void;
}

declare const self: SwScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA offline: toda navegação recebe o index.html do precache
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// Fontes, ícones e o .wasm do leitor de QR: cache primeiro (também estão no precache)
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/fonts/') ||
      url.pathname.startsWith('/icons/') ||
      url.pathname.endsWith('.woff2') ||
      url.pathname.endsWith('.wasm')),
  new CacheFirst({ cacheName: 'oak-static' }),
);

// Supabase nunca passa pelo cache HTTP: os dados offline vivem no Dexie
registerRoute(({ url }) => url.hostname.endsWith('.supabase.co'), new NetworkOnly());

self.addEventListener('message', (event) => {
  if (isSkipWaiting(event.data)) {
    void self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  const data = event.data as { text(): string } | null | undefined;
  const spec = notificationFromPush(parsePushData(data ? data.text() : null), self.location.origin);
  const tasks: Array<Promise<unknown>> = [
    self.registration.showNotification(spec.title, spec.options),
  ];
  if (spec.badgeCount !== null && self.navigator.setAppBadge) {
    tasks.push(self.navigator.setAppBadge(spec.badgeCount).catch(() => undefined));
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification as Notification;
  notification.close();
  event.waitUntil(openFromNotification(self.clients, notification.data, self.location.origin));
});

self.addEventListener('sync', (event) => {
  event.waitUntil(broadcast(self.clients, { type: RUN_SYNC }));
});

// A inscrição mudou: as janelas refazem a inscrição ao receber a mensagem (T-064 grava o sinal no kv)
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(broadcast(self.clients, { type: PUSH_RESUBSCRIBE }));
});
