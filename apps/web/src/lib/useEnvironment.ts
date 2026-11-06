import { useSyncExternalStore } from 'react';
import { type Environment, readEnvironment, subscribeEnvironment } from './environment';

let cached: { key: string; env: Environment } | null = null;

function snapshot(): Environment {
  const env = readEnvironment();
  const key = `${env.theme}|${env.glass}|${env.motion}|${env.perf}|${env.values}`;
  if (cached?.key !== key) {
    cached = { key, env };
  }
  return cached.env;
}

/** Os 5 atributos de ambiente (UX §4.10) para componentes JS (BudgetRing, GoalProgress, MoneyText). */
export function useEnvironment(): Environment {
  return useSyncExternalStore(subscribeEnvironment, snapshot, snapshot);
}
