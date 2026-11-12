# Fixtures do parser da NFC-e

Páginas **sintéticas**, escritas à mão no formato esperado do portal da SEFAZ-PR (tech §6.2.3). Nenhuma parte veio
de uma nota real: emitente, CNPJ (`12.345.678/0001-00`, com dígito verificador inválido), itens e valores são
fictícios, e não há chave de acesso, CPF nem protocolo. As páginas reais anonimizadas chegam na T-090 (SETUP-14) e
confirmam os seletores.

- `sintetica-completa.html` — 3 itens (um por kg), desconto e total que fecha.
- `sintetica-rotulos.html` — mesmo conteúdo sem as classes, só com os rótulos ("Qtde.:", "Vl. Unit.:").
- `sintetica-captcha.html` — página de verificação com captcha.
- `sintetica-erro.html` — página de erro do portal (sem a tabela de itens).

## Páginas reais anonimizadas (SETUP-14, 12/11/2026, D-095)

Duas consultas reais da SEFAZ-PR, capturadas em 11/11/2026 (HTML do servidor, antes do jQuery Mobile mexer no
DOM). A **marcação** foi mantida byte a byte (tags, classes, ids repetidos, quebras, tabulações, o `/TSPD/` no
`<head>`); todo o **conteúdo** foi trocado por dados inventados: emitente, CNPJ (dígito verificador inválido),
endereço, itens, códigos, quantidades, valores, número, série, protocolo, datas, operador, MD-5 e software. A chave
de acesso segue o layout de 44 dígitos com o CNPJ fictício e o **dígito verificador trocado** (inválido de
propósito). Σ itens = total nas duas, sem desconto. Os originais não entram no repositório.

| Arquivo | Itens | Total | Pagamento | Cobre |
|---|---|---|---|---|
| `real-anon-mercado-kg.html` | 9 | 85,64 | Crédito | itens por `KG`, unidade `BD` com quantidade fracionária, mesmo produto em linhas separadas |
| `real-anon-lanchonete-1-item.html` | 1 | 38,50 | Crédito | nota mínima, Simples Nacional |

Achados para a T-090:

1. A descrição do item usa `.txtTit2` (a spec previa `.txtTit`). Os demais seletores conferem: `#u20.txtTopo`,
   `.text`, `#tabResult tr`, `.RCod`, `.Rqtd`, `.RUN`, `.RvlUnit`, `.valor`, `#totalNota .totalNumb`, `.chave`.
2. **Valor unitário sem casas fixas** (`42,9`, `38,5`, `14,49`). Hoje o parser não lê `42,9` e cai no cálculo
   total ÷ quantidade: no pão de queijo (0,118 kg, `42,9`) sai `unitCents` 4288 em vez de 4290.
3. Unidade `BD` (bandeja) com quantidade fracionária: não inferir "por kg" só pela unidade.
4. O mesmo produto aparece em linhas separadas: não deduplicar por código.
5. Cada forma de pagamento é um `#linhaTotal` com `label.tx` + `.totalNumb` depois do `#linhaForma`; os ids
   `linhaTotal` se repetem, então buscar pelo rótulo.
6. O desafio anti-robô F5 (`/TSPD/`) está no `<head>` mesmo quando a nota vem completa; uma resposta só com o
   desafio deve virar `NFCE_CAPTCHA`.
7. Desconto e duas formas de pagamento não aparecem nestas notas: os testes montam essas variações sobre esta
   marcação e marcam a linha de desconto e a segunda forma como suposição até chegar uma nota real que as tenha.
