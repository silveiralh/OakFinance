// Erros do domínio (tech §2.3): códigos estáveis; exceções só para entrada inválida ou bug.
export type DomainErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_DATE'
  | 'INVALID_ARGUMENT'
  | 'UNSAFE_INTEGER'
  | 'INSTALLMENTS_LOCKED'
  | 'OFX_INVALID'
  | 'IMPORT_TOO_LARGE'
  | 'NFCE_QR_INVALID'
  | 'NFCE_KEY_DV';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  /** Linha do arquivo onde a entrada falhou (OFX_INVALID), quando se aplica. */
  readonly line: number | null;

  constructor(code: DomainErrorCode, message?: string, details: { line?: number } = {}) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.line = details.line ?? null;
  }
}
