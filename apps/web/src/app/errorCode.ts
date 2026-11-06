// Código curto do erro mostrado no G09 (US-64): ajuda o diagnóstico sem expor mensagem, valores ou dados.

function hash36(text: string): string {
  // FNV-1a de 32 bits
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(7, '0').slice(-6);
}

function isResponseLike(error: unknown): error is { status: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  );
}

/**
 * `R-<status>` para respostas de rota (ex.: `R-404`) e `E-XXXXXX` (6 caracteres, base 36) para exceções, estável
 * para o mesmo tipo e mensagem.
 */
export function errorCode(error: unknown): string {
  if (isResponseLike(error)) {
    return `R-${error.status}`;
  }
  if (error instanceof Error) {
    return `E-${hash36(`${error.name}:${error.message}`)}`;
  }
  return `E-${hash36(String(error))}`;
}
