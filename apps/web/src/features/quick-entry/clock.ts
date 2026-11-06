// Início do lançamento (toque no "+"), para o `duracao_ms` do evento `lancamento_salvo` (RN-104, US-12).
let startedAt: number | null = null;

export function markQuickEntryStart(nowMs: number = performance.now()): void {
  startedAt = nowMs;
}

/** Milissegundos desde o toque no "+" (ou `null` se o lançamento não começou pelo FAB). */
export function quickEntryElapsed(nowMs: number = performance.now()): number | null {
  return startedAt === null ? null : Math.round(nowMs - startedAt);
}

export function resetQuickEntryClock(): void {
  startedAt = null;
}
