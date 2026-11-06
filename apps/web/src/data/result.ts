// Resultado das funções de I/O (tech §2.3): união discriminada; exceção só para bug.

/** Códigos estáveis de erro do armazenamento local (US-64: G11 e G12). */
export type StorageErrorCode = 'STORAGE_QUOTA' | 'STORAGE_UNAVAILABLE' | 'STORAGE_FAILED';

export interface AppError {
  code: StorageErrorCode;
  message: string;
}

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
