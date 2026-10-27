# News Filter

Extensão do Chrome que esconde blocos de notícias com as palavras-chave que você escolher. Cada bloco é coberto por um quadro branco escrito **FILTER BLOCKED** do mesmo tamanho, então o layout do site não se mexe.

## Instalar

1. Abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor**, no canto superior direito.
3. Clique em **Carregar sem compactação** e escolha esta pasta (`news-filter`).
4. Fixe o ícone na barra (ícone de quebra-cabeça → alfinete).

Depois de alterar o código, clique em recarregar no card da extensão e recarregue as abas abertas.

## Uso

- **Config:** adicione palavras-chave. Separe várias por vírgula. Maiúsculas e acentos são ignorados, e `*` pega variações (`elei*` → eleição, eleições, eleitoral).
- **Config → Sites:** escolha onde o filtro roda. **Todos, exceto a lista** filtra em todo lugar menos nos sites listados (whitelist). **Só os sites da lista** filtra apenas neles. Cada site inclui os subdomínios (`globo.com` cobre `g1.globo.com`), e dá para colar a URL inteira.
- **Overview:** marque ou desmarque cada palavra e veja quantos blocos cada uma escondeu na aba atual. Abaixo do contador há um atalho para tirar ou colocar o site atual na lista.
- A chave no topo liga e desliga o filtro inteiro. O número no ícone mostra quantos blocos foram escondidos na aba.

## Arquivos

- `manifest.json`: configuração da extensão (Manifest V3).
- `content.js`: roda nas páginas, encontra o bloco em volta de cada palavra e o cobre.
- `background.js`: atualiza o número no ícone.
- `popup/`: as abas Overview e Config.
- `icons/`: ícones da barra.
