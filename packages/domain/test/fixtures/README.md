# Fixtures sintéticas de importação (OFX/CSV)

Arquivos **inventados** para os testes de `src/imports/` (T-022). Nenhum vem de extrato real: não há nomes, documentos, agências, contas, cartões nem valores de pessoas reais. Bancos, lojas e empresas são fictícios ("FICTÍCIA", "LOJA X").

| Arquivo | O que exercita |
|---|---|
| `bb-sgml-1252.ofx` | OFX 1.02 SGML "Money 2000+" com `CHARSET:1252` e quebras CRLF; acentos em Windows-1252 ("PAGAMENTO CONTA ÁGUA"); `FITID` repetido; `DTPOSTED` com `[-3:BRT]` às 23:59:59; vírgula decimal; `MEMO` vazio |
| `cartao-ofx2-utf8.ofx` | OFX 2.x XML de cartão (`CCSTMTRS`) em UTF-8, com entidade `&amp;`, `MEMO` vazio fechado, crédito "Pagamento recebido" e valor zero |
| `nubank-fatura.csv` | Preset **provisório** "Nubank — fatura" (`date,title,amount`) com linhas idênticas no mesmo dia |
| `nubank-conta.csv` | Preset **provisório** "Nubank — conta" (`Data,Valor,Identificador,Descrição`), com linha vazia, data inválida e valor inválido |

Anonimização: não houve, porque nada aqui partiu de arquivo real. Identificadores (`ACCTID`, `FITID`, `Identificador`) são rótulos sem dígito verificador e números de conta são zeros. Quando o cliente enviar os arquivos reais (SETUP-14, pergunta Q1), a sessão gera a versão anonimizada **fora do repositório** (troca de nomes, documentos e números, mantendo a estrutura) e só ela entra aqui, descrita nesta tabela.
