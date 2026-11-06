// Leitura reativa do Dexie para a UI: a tela re-renderiza quando a tabela muda (escrita local ou pull).
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

/** Resultado de `query` atualizado a cada mudança; `undefined` enquanto carrega (G10). */
export function useLive<T>(
  query: (() => Promise<T>) | null,
  deps: readonly unknown[],
): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    if (!query) {
      setValue(undefined);
      return;
    }
    const subscription = liveQuery(query).subscribe({
      next: setValue,
      error: () => setValue(undefined),
    });
    return () => subscription.unsubscribe();
    // biome-ignore lint/correctness/useExhaustiveDependencies: as dependências da consulta vêm de quem chama
  }, deps);
  return value;
}
