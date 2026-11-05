// Todas as strings de interface (UX §6). Componentes não têm texto literal.
export const ptBR = {
  'onb.welcome.title': 'OakFinance',
  'onb.welcome.subtitle': 'Registre gastos em segundos e saiba quanto ainda pode gastar no mês.',
} as const;

export type MessageKey = keyof typeof ptBR;

export function t(key: MessageKey): string {
  return ptBR[key];
}
