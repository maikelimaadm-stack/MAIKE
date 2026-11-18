# Moldura independente dos pontos

A composição segue o padrão dos ícones de lote da PR #271:

- `redondo.js`: moldura, ponteira, sombra e encaixe da figura. `REDONDO_ORIGINAL_SVG` guarda o arquivo **REDONDO ORIGINAL.svg** fornecido pelo proprietário, sem modificar seu conteúdo.
- `../cocho-descoberto.js`: desenho e preenchimento do cocho.
- `../deposito-sal.js`: desenho e preenchimento do depósito.
- `montarPontoRedondo`: monta uma figura dentro da moldura. Os subícones continuam sem moldura.

Para trocar só o ponto, altere `REDONDO_ORIGINAL_SVG`. Para reposicionar o conteúdo, altere `ENCAIXE_FIGURA` (`x`, `y`, `width`, `height`) na coordenada do SVG original, que tem origem negativa em Y. O encaixe preserva a proporção do desenho.

O fundo branco e a sombra são do SVG enviado. A borda fina é personalizada por `COR_BORDA_REDONDO` na montagem; a constante do SVG original permanece intacta. A sombra é o filtro referenciado no `path`; o arquivo contém também um filtro não utilizado e grupos vazios, preservados como vieram. Não confunda esses dados da moldura com o desenho do cocho/depósito.

Não altera o cálculo do nível, o tamanho externo do marcador ou os subícones.
