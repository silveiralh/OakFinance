# Fixtures sintéticas de importação (OFX/CSV)

Arquivos **inventados** para os testes de `src/imports/` (T-022). Nenhum vem de extrato real: não há nomes, documentos, agências, contas, cartões nem valores de pessoas reais. Bancos, lojas e empresas são fictícios ("FICTÍCIA", "LOJA X").

| Arquivo | O que exercita |
|---|---|
| `bb-sgml-1252.ofx` | OFX 1.02 SGML "Money 2000+" com `CHARSET:1252` e quebras CRLF; acentos em Windows-1252 ("PAGAMENTO CONTA ÁGUA"); `FITID` repetido; `DTPOSTED` com `[-3:BRT]` às 23:59:59; vírgula decimal; `MEMO` vazio |
| `cartao-ofx2-utf8.ofx` | OFX 2.x XML de cartão (`CCSTMTRS`) em UTF-8, com entidade `&amp;`, `MEMO` vazio fechado, crédito "Pagamento recebido" e valor zero |
| `nubank-fatura.csv` | Preset **provisório** "Nubank — fatura" (`date,title,amount`) com linhas idênticas no mesmo dia |
| `nubank-conta.csv` | Preset **provisório** "Nubank — conta" (`Data,Valor,Identificador,Descrição`), com linha vazia, data inválida e valor inválido |

Anonimização: não houve, porque nada aqui partiu de arquivo real. Identificadores (`ACCTID`, `FITID`, `Identificador`) são rótulos sem dígito verificador e números de conta são zeros. Quando o cliente enviar os arquivos reais (SETUP-14, pergunta Q1), a sessão gera a versão anonimizada **fora do repositório** (troca de nomes, documentos e números, mantendo a estrutura) e só ela entra aqui, descrita nesta tabela.

## Cópias anonimizadas dos arquivos reais (SETUP-14, 11/11/2026)

Geradas fora do repositório a partir dos arquivos que o cliente entregou no canal privado. Os originais nunca entram aqui. O que foi preservado é só o **formato**; todo valor foi trocado.

| Arquivo | Formato real que ele preserva |
|---|---|
| `bb-real-anon.ofx` | OFX do BB "Money 2000+": cabeçalho `OFXHEADER:100`, `DATA:OFXSGML`, `VERSION:102`, `ENCODING:USASCII`, `CHARSET:1252`; **tags com fechamento** e indentação, quebras **LF** (não CRLF); `ORG` "Banco do Brasil", `BANKID` 1, `ACCTTYPE` CHECKING; `STMTTRN` com `TRNTYPE` DEBIT, `DTPOSTED` `AAAAMMDDhhmmss[-3:BRT]`, `TRNAMT` com ponto decimal e sinal, `FITID` de 15 dígitos, `CHECKNUM` de 6 dígitos, `NAME` "Pix - Enviado" e `MEMO` no formato `dd/mm hh:mm <nome>`; `LEDGERBAL` |
| `bb-real-anon-sem-movimento.ofx` | O mesmo extrato do BB num mês **sem movimento**: `BANKTRANLIST` só com `DTSTART`/`DTEND` (o app deve dizer que não há lançamentos, sem erro) |
| `nubank-fatura-real-anon.csv` | Fatura do Nubank: `date,title,amount`, data `AAAA-MM-DD`, títulos sem aspas, **valor sempre entre aspas com vírgula decimal e ponto de milhar** (`"1.456,20"`), **negativo escrito com espaço** (`"- 29,90"`) para pagamento, estorno, crédito e IOF de estorno; parcelas como `<loja> - Parcela 2/3` e `Parcelamento de Compra - <loja> - 1/4`; linhas IOF; linhas idênticas no mesmo dia |
| `nubank-conta-real-anon.csv` | Extrato da conta Nubank: `Data,Valor,Identificador,Descrição`, data `DD/MM/AAAA`, **ponto decimal** com sinal colado (`-150.00`), sem aspas, `Identificador` em formato UUID; descrições "Transferência enviada/recebida pelo Pix - <nome> - <documento mascarado> - <banco> (<código>) Agência: <n> Conta: <n>", "Valor adicionado na conta por cartão de crédito", "Compra no débito", "Resgate RDB", "Pagamento de fatura" e "Recarga de celular" |

Anonimização: OFX transformado tag a tag a partir do original (agência e conta zeradas; `FITID` novos que começam com 1, sem prefixo de cartão; `CHECKNUM`, datas, valores, saldo e `MEMO` inventados). Os CSV têm linhas **inventadas** que copiam só o formato de cada tipo de linha encontrado nos originais. Nomes de pessoas, empresas e bancos são fictícios; CPF aparece só mascarado (`•••.123.456-••`); CNPJ fictício com dígito verificador inválido; nenhum valor, data, identificador ou número de conta real.

**Achado para a issue #128 e a T-087:** o preset provisório "Nubank — fatura" usa `decimal: '.'`, mas a fatura real usa vírgula decimal, ponto de milhar e o negativo com espaço depois do sinal. Com o preset atual, nenhum valor da fatura é lido.
