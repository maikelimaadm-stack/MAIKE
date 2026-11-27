# Tela da área da atividade sem os botões "+" por tipo (D-PROD-376)

**Data:** 2026-11-27 · **Decisão:** [D-PROD-376](./DECISIONS.md) · **Migration:** nenhuma · **APK:** nenhum novo

## Pedido

O proprietário apontou dois caminhos para lançar na atividade aberta: o novo (o Diário das atividades, com a opção
Máquina da frente e o abastecimento) e o antigo. Pediu para tirar o antigo e escolheu os botões "+" por tipo da tela
da área.

## O que mudou

| Onde | Antes | Depois |
|---|---|---|
| Tela da área (`LancamentosDaArea`) | fileira "+ Máquina / + Implemento / + Produto / + Mão de obra / + Serviço" acima da tabela | sem a fileira; a tabela, o total e o ⚡ de cada linha iguais |
| `FluxoPorArea`, `AtividadeAberta` | repassavam `onLancar` | sem `onLancar` |
| `LancamentoAtividades` (página) | `lancarDoMenu`, estado `lancando` e a `JanelaLancamentoPorTipo` aberta pelos botões | removidos (ninguém mais chamava) |
| `atividadeFluxoCampo.js` | `opcoesDeRegistro` (as opções dos botões) | removida |

Fica: a `JanelaLancamentoPorTipo`, que o mapa abre pelo "Só …" da área (`AcoesDaAtividadeDaArea`).

## Por onde se lança agora

- **Atividade aberta:** o "+ Lançamento" (⚡ da linha, card e tabela) abre o Diário das atividades no pasto. Sem pasto,
  ou se o Diário não abre, abre a Nova realização (D-PROD-356).
- **Mão de obra e serviço:** no Diário ainda estão "Em breve". Até lá, vão pelo "Só …" do mapa ou pela Nova realização.

## Testes

- Novo `tests/smoke/helpers/janelaDiretaNoTeste.jsx`: abre a janela do tipo direto, com as props que o mapa passa,
  ao lado da tela e no mesmo QueryClient (o que ela grava relê a tabela da área atrás). Os testes do comportamento da
  janela continuam valendo por ela.
- Os que contavam os botões agora conferem que a fileira não existe: `lancamentoAtividadesLinhas.test.jsx`
  (LL-JANELA-TIPO-4/7, LL-ABERTA-3/4), `lancamentoAtividades.test.jsx` (LA-RAIO-2 e LA-RAIO-5),
  `atividadeAreas.test.jsx` (FL-2). FC-1 (`opcoesDeRegistro`) saiu com a função.
- Os quatro arquivos e `mapaAtividadeAcoes.test.jsx`: 186 testes passando.

## Conferência visual

Cena com dados de exemplo (390 × 844): antes, a fileira com os cinco botões; depois, sem a fileira e com a mesma
tabela (Máquina, Insumo, Mão de obra; total R$ 2.486,50).
