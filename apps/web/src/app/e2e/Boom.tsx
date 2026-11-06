// Só no build E2E (VITE_E2E=1): tela que falha ao renderizar, para o cenário do G09.
export function Boom(): never {
  throw new Error('falha simulada do E2E');
}
