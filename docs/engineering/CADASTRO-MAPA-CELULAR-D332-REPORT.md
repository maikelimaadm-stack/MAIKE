# Relatório — o cadastro do mapa no celular (D-PROD-332)

**Data:** 2026-11-26 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-332](./DECISIONS.md)

## Pedido

O proprietário pediu quatro coisas, e aprovou as imagens antes da implementação ("Pode implementar por favor"):

1. "O meu mapa no meu cadastro de áreas, pontos e linhas está totalmente diferente" do Mapa Geral.
2. O formulário lateral fecha quando ele toca na lista.
3. Um botão redondo de cadastro no mapa de pontos, que vai direto ao cadastro de ponto.
4. Um botão para centralizar o ponto na localização dele, na hora do cadastro.

## O que mudou

| Onde | Mudança |
|---|---|
| `src/components/mapa/useMinhaLocalizacaoNoEditor.js` (novo) | Mostra o ponto azul e o círculo da precisão no mapa do cadastro, usando o mesmo GPS do Mapa Geral (`useLocalizacaoNoMapa`). O círculo é refeito quando o fundo troca. |
| `src/components/mapa/MapaDesenho.jsx` | O mapa abre no satélite e mostra a localização. O botão do topo centraliza em você. No ponto, o toque só marca e "Continuar" abre o formulário. Entrou o botão redondo azul "Usar minha localização". Nos três formulários, as listas abrem dentro do painel, e com uma lista aberta o Esc fecha só ela. |
| `src/styles/mk-cadastro-mapa.css` (novo) | As listas abertas dentro do painel recebem toque. |
| `src/pages/MapaGeral.jsx` · `src/styles/mapa-geral.css` | Na aba Pontos entrou o botão redondo verde "+" ("Novo ponto"), só para quem pode cadastrar no mapa. |
| `src/pages/MapaCadastro.jsx` | `?novo=ponto` abre direto o editor de ponto e depois sai do endereço. Fechar volta ao Mapa Geral. |

## Por que a lista fechava o formulário

As listas do celular abrem numa folha própria (`MobileSheet`), colocada no fim da página, fora do painel lateral (Radix Dialog). Para o painel, tocar nela era tocar fora dele, e o painel fechava.

O painel de filtros do Mapa Geral já tinha resolvido isso com `MobileSheetPortalCtx`, que faz a lista abrir num lugar dentro do painel. Os três formulários do cadastro passaram a usar o mesmo arranjo.

## Verificação

- `tests/smoke/cadastroMapaCelularD332.test.jsx` (8 testes):
  - `?novo=ponto` abre o editor de ponto e limpa o endereço.
  - Fechar o editor volta ao Mapa Geral.
  - Sem o pedido, o cadastro abre na lista.
  - "Usar minha localização" marca o ponto no GPS e "Continuar" abre o formulário com a posição.
  - Sem GPS, o ponto não é marcado.
  - A lista do formulário tem como destino um lugar dentro do painel.
  - Os três formulários usam o mesmo arranjo.
  - O mapa abre no satélite e mostra a localização.
- `tests/smoke/mapaFocoBarraV12.test.jsx` BARRA-9 (3 testes):
  - O "+" aparece só na aba Pontos e leva a `/mapacadastro?novo=ponto`.
  - Sem permissão, ele não aparece.
  - Com a permissão `novo` do cadastro do mapa, ele aparece.
- Testes que já existiam e foram ajustados:
  - O `MapaCadastro` agora usa o roteador, então os testes passaram a envolvê-lo em `MemoryRouter`.
  - O nome do botão no ponto passou a ser "Continuar".
