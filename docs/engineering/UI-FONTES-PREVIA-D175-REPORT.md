# UI-FONTES-PREVIA-D175: relatório

**Fatia:** fontes voltam ao estilo e ao tamanho da prévia escolhida pelo proprietário (D-PROD-175).
**Tipo:** tela (UI), por reversão. Sem migration, rota, regra ou mudança no que vai ao servidor.

## Pedido do proprietário (2026-11-11)

- "ta tudo errado as fontes estão enormes, faça o seguinte deixe as fontes do tamanho que estava no anterior deixe do mesmo tamanho que está no mobile"
- "o estilo e tamanho das fontes eu quero deixe igual está aqui nessa visualização do vercel (prévia `maike-funzkhxes`, tela `/produtos`) […] nesse que tava nas tabelas etc"
- "mande uma foto para eu ver o tamanho que vai ficar": as imagens abaixo foram enviadas antes do envio para produção.

A prévia `maike-funzkhxes` é o commit `836344f` (D-PROD-165). Ela é anterior ao padrão de tipografia (D-PROD-167) e ao mapa com a tipografia do motor (D-PROD-173).

## O que muda

| Peça | Hoje (D-PROD-167 e D-PROD-173) | Depois (como na prévia) |
|---|---|---|
| Fonte | Open Sans no texto, Lato em títulos e números | DM Sans |
| Listas, cabeçalhos de tabela e botões | 14 px | 12 px (nomes e cabeçalhos 12 px / 600), como na prévia |
| Título da tela e título de janela | 18 px e 20 px | 13 px e 15 px |
| Escala do Tailwind | `text-xs` em 13 px | padrão (`text-xs` em 12 px) |
| Detalhes do Lote, painéis e manejos do mapa | 13 a 14 px | 10,5 a 13 px, como antes |
| Rótulos sobre o mapa e card de medição | tamanhos da D-PROD-167 | como na prévia |
| Largura padrão das colunas | aumentada 14/12 | a que cada tela define |

## Como

| Passo | O que fez |
|---|---|
| Reversão da D-PROD-173 | Os 33 arquivos de código voltam idênticos ao que eram antes dela (`cd0926e`). No formulário do Ponto só as duas notas voltam a 11 px, porque o resto dele é da D-PROD-174. O da Área fica como na D-PROD-174 (formulário do motor). |
| Reversão da D-PROD-167 | Fontes, tokens, base do motor, componentes de janela, menu, lista e dica, rótulos do mapa, Tailwind e largura das colunas voltam ao que eram antes dela. |
| Fica | Documentos das duas decisões (histórico); as telas no motor da D-PROD-169 a D-PROD-174, que seguem a tipografia do motor; o título de seção da gestão em 11 px (D-PROD-165). |

## Verificação

- **Medida contra a prévia.** A prévia (`836344f`) e a versão nova rodaram lado a lado, com o mesmo backend falso só de leitura. Cada texto visível foi comparado em família, tamanho e peso.

  | Tela | 1366 px | 390 px |
  |---|---|---|
  | Produtos (lista; o backend falso não tem produtos, então o registro não foi aberto) | igual | igual |
  | Lotes (lista e registro) | igual | igual |
  | Mapa Geral | igual | igual |
  | Detalhes do Lote | igual | igual |
  | Bens (lista) | igual, menos a pílula "Situação", que agora é a do motor | igual |
  | Lançamentos (lista) | painel do perfil financeiro e pílulas no motor (D-PROD-172) | idem |

- **Testes:**
  - `tipografiaPreviaD175.test.js` (novo) segura a volta;
  - sai `tipografiaSistema.test.js`, que testava o padrão revogado;
  - `contagemLote`, `mapaRotulosSemBagunca` e `detalhesLoteVisualGesto` voltam aos valores de antes;
  - `seletorPaginadoCriarNovo` só troca a classe do campo no instantâneo.
- **`npm run verify:all`:** resultado no PR.

## Evidências

`docs/engineering/evidencias/fontes-d175/`:

- `computador-lotes-hoje-e-depois.png`, `computador-produtos-hoje-e-depois.png`: lista hoje (vermelho) e depois (verde);
- `computador-detalhes-lote-hoje-e-depois.png`: Detalhes do Lote;
- `celular-lotes-e-detalhes-hoje-e-depois.png`: Lotes e Detalhes do Lote no celular;
- `previa-e-nova-lotes.png`: a prévia escolhida e a versão nova, iguais.
