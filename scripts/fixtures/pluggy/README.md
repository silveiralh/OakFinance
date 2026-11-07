# Fixtures da Pluggy — PROVISÓRIAS

`sandbox.json` alimenta o mock `scripts/mock-pluggy.ts` (E2E e integração, tech §8.2) e os testes do conector
(`supabase/functions/_shared/connectors/pluggy/*.test.ts`).

**São sintéticas e provisórias.** Nenhum dado veio de conta, cartão ou pessoa real: os ids (`item-bb`,
`acc-nu-card`, `tx-nu-001`…), as descrições ("Padaria Exemplo", "Mercado Ficticio"), os valores, os números de conta
(`00000-1`) e o CNPJ (`12.345.678/0001-00`, com dígitos verificadores inválidos de propósito) foram inventados. O
`clientUserId` é um UUID de teste.

O formato segue a documentação da API (tech §6.1.1, conferida em 05/11/2026): `GET /items/{id}`, `GET /accounts`,
`GET /v2/transactions` (cursor em `next`) e `GET /bills`. O sinal de `amount` aparece nos dois jeitos (negativo e
positivo) de propósito: o conector usa o `type` (`DEBIT`/`CREDIT`) como fonte da verdade do sentido.

Cenários cobertos:

- conta corrente com Pix, TED, boleto e compra pendente no débito (`acc-bb-cc`);
- cartão com parcela `2/10` e `billId`, estorno, "Pagamento recebido", compra pendente e compra comum (`acc-nu-card`);
- pagamento da fatura saindo da conta (`acc-nu-cc`);
- item com `LOGIN_ERROR` (`item-login-error`) e item sem `clientUserId` (criado pela Demo do dashboard, `item-bb`);
- `reissue`: `tx-nu-005` some e volta como `tx-nu-005b` (o banco devolve a transação com id novo).

Quando o SETUP-13 estiver feito, a T-083 grava respostas reais do sandbox, **anonimiza** (troca ids, descrições,
valores, números e documentos por valores sintéticos, mantendo só a estrutura e os campos) e substitui este arquivo,
atualizando este README.
