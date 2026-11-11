// Open Finance fora do MVP (D-080, T-115). Constante de build: em produção é `false` e o código da conexão (I02,
// cards de banco da I01, aviso do Início, lembrete de conexão) sai do bundle; só o build E2E (VITE_E2E=1) a liga,
// para o E10 e os demais cenários de conexão continuarem cobertos até a v2. Na v2 basta trocar por `true`.
export const OPEN_FINANCE_ENABLED: boolean = import.meta.env.VITE_E2E === '1';
