// Open Finance fora do MVP (D-080, T-115). Constante de build: `VITE_OPEN_FINANCE=1` liga a conexão com banco;
// sem a variável (produção, até a v2) ela é `false` e o caminho de conectar banco some (I02, cards de banco da I01,
// aviso do Início, lembrete de conexão). Só o build E2E (`scripts/build-e2e.mjs`) liga, para o E10 e os demais
// cenários de conexão continuarem cobertos. A tabela de rotas (`screens.ts`) repete a mesma expressão em linha,
// porque o empacotador só descarta o `import()` da conexão quando a condição é literal no próprio módulo.
export const OPEN_FINANCE_ENABLED: boolean = import.meta.env.VITE_OPEN_FINANCE === '1';
