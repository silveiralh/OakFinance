// Erros do domínio (tech §2.3): códigos estáveis; exceções só para entrada inválida ou bug.
export type DomainErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_DATE'
  | 'INVALID_ARGUMENT'
  | 'UNSAFE_INTEGER'
  | 'INSTALLMENTS_LOCKED'
  | 'OFX_INVALID'
  | 'NFCE_QR_INVALID'
  | 'NFCE_KEY_DV';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
  }
}
