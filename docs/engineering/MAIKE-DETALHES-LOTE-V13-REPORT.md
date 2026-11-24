# MAIKE — Detalhes do Lote v13: telas do pasto redesenhadas no celular (D-PROD-280)

**Data:** 2026-11-23 · **Decisão:** [D-PROD-280](./DECISIONS.md) · **Branch:** `claude/kind-knuth-tztu1v`

## O que foi pedido

O proprietário pediu propostas para melhorar "detalhes de lotes e lançamentos". Depois de várias rodadas de imagens (atual × proposto, tela a tela, no celular), aprovou a direção e pediu a implementação.

## O que mudou

Só apresentação: os mesmos dados, as mesmas ações, nenhuma chamada nova ao servidor.

| Tela | Mudança |
|---|---|
| Casca | Abas só com o nome e linha verde embaixo; seletor Resumo · Lote · Lista pequeno, à esquerda; rodapé com botões maiores e ação principal em verde |
| Detalhes | Capim no lugar do nome da área, status em etiqueta, régua de UA/ha com as faixas do mapa, Lotação em grade; sem o bloco Categorias |
| Lotes · Resumo | Rótulos inteiros na faixa de totais; duas barras por lote (% cabeças, % da UA) |
| Lotes · Lote | Lotação, Pesagem (origem em etiqueta) e Identificação em grade |
| Lotes · Lista | Continua tabela: compacta no celular, zebrada, total destacado, dica de arrastar só com rolagem |
| Histórico | Botão "Mostrar" e cartões curtos (quantidade em destaque, "De → Até"); linha do tempo mantida |
| Suplementação | Régua do desvio, barra de fornecimento, barra de nível no cocho, gráfico esperado × real por período fechado |
| Manejos | Mesmo modelo e ordem; dois por linha no celular, com uma frase simples; ícone do Mover visível |

## Arquivos principais

- `src/components/mapa/detalhes-lote/`: `AbaDetalhes.jsx`, `BlocosLote.jsx`, `VistaResumo.jsx`, `VistaLista.jsx`, `AbaHistorico.jsx`, `LinhaDoTempo.jsx`, `AbaSuplementacao.jsx`, `suplementacaoDoPasto.js`, `blocos.jsx`, `RodapePasto.jsx`
- `src/components/mapa/AcoesDoLote.jsx`, `src/assets/icones/manejos/mover-lotes-enviado.svg`
- `src/styles/`: `mk-dp-casca-v13.css`, `mk-dp-detalhes-v13.css`, `mk-dp-supl-v13.css` (novos), `mk-dp-lotes.css`, `mk-dp-historico.css`, `acoes-lote-modulos.css`

## Diferenças em relação ao protótipo aprovado

- **Forragem no Detalhes:** não entrou. O Detalhes do Lote não recebe a cultura da área nem a medição de forragem (hoje só o `PainelForragemArea` consulta isso). Fica para uma missão própria.
- **Gráfico esperado × real:** um ponto por período fechado do cocho; com menos de dois, mostra "Ainda sem períodos fechados para comparar."
- **Régua de UA/ha no celular:** só o nome da faixa atual (os cinco não cabem sem cortar). Texto mínimo de 11 px, pelo teste DC-1.
- **Lista no celular:** cerca de 4 colunas por tela com as colunas padrão (as três de Alertas vêm primeiro).
- **Consumo esperado / real:** continua em linhas.

## Verificação

- Suíte smoke completa depois de juntar as quatro frentes: 323 arquivos, 4.078 testes, todos passando.
- Telas reais abertas no celular (390 px) com os dados do KM - P. 01 e com o pasto de exemplo dos testes; Detalhes, Lotes e Manejos também em 1280 px.
- `npm run verify:all` antes da PR.

## Fora do escopo

Formulários de lançamento, tablet e computador com desenho próprio, ordem padrão das colunas da Lista, qualquer mudança de servidor ou migration.
