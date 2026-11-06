// API pública do domínio (tech §5). Regras puras: sem I/O, sem relógio e sem aleatoriedade implícitos.
export * from './categorization.ts';
export * from './dates.ts';
export * from './defaults.ts';
export * from './errors.ts';
export * from './ids.ts';
export * from './installments.ts';
export * from './invoices.ts';
export * from './money.ts';
export * from './nfce/qr.ts';
export * from './recurrence.ts';
export type * from './types.ts';

export const DOMAIN_PACKAGE = '@oakfinance/domain';

/** Fuso de todas as datas de negócio (RN-02). */
export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';
