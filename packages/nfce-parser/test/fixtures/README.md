# Fixtures do parser da NFC-e

Páginas **sintéticas**, escritas à mão no formato esperado do portal da SEFAZ-PR (tech §6.2.3). Nenhuma parte veio
de uma nota real: emitente, CNPJ (`12.345.678/0001-00`, com dígito verificador inválido), itens e valores são
fictícios, e não há chave de acesso, CPF nem protocolo. As páginas reais anonimizadas chegam na T-090 (SETUP-14) e
confirmam os seletores.

- `sintetica-completa.html` — 3 itens (um por kg), desconto e total que fecha.
- `sintetica-rotulos.html` — mesmo conteúdo sem as classes, só com os rótulos ("Qtde.:", "Vl. Unit.:").
- `sintetica-captcha.html` — página de verificação com captcha.
- `sintetica-erro.html` — página de erro do portal (sem a tabela de itens).
