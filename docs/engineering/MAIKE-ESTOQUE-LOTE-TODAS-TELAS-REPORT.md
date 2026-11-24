# MAIKE-ESTOQUE-LOTE-TODAS-TELAS — relatório

**Decisão:** [D-PROD-297](./DECISIONS.md) · **Data:** 2026-11-24 · **Branch:** `claude/estoque-lote-todas-telas` · **Migration:** nenhuma · base: [D-PROD-282](./DECISIONS.md) (controle de lote por produto)

## O que mudou, tela por tela

| Tela | Antes | Agora |
|---|---|---|
| **Estoque (Saída e transferência)** | campo "Lote" próprio (`CampoLotesSaida`) | o mesmo comportamento; o campo virou o `CampoLotes` reutilizável e o `CampoLotesSaida` é só o invólucro da linha |
| **Cocho** (lançamento de suplementação) | FEFO automático; aviso de vencido só na API | campo "Lote" abaixo do saldo do depósito; `lotes` só com a escolha manual; vencido pede confirmação; o aviso da resposta vira alerta. Produto com lote não leva mais o rateio FIFO do navegador nas observações |
| **Financeiro — compra** | compra de produto com lote **recusada** (422 `lote_obrigatorio`): a tela não mandava o lote | no diálogo de confirmação, por item de produto com lote: "Lote do fabricante" (obrigatório) e "Validade" (obrigatória se o produto controla validade); vão em `lotes_por_item` |
| **Financeiro — venda** | FEFO automático | no diálogo de confirmação, o campo "Lote" por item; `lotes` só com a escolha manual; o aviso de vencido da resposta vira alerta |
| **Atividade** (linha de produto, "Repetir", registro de campo e "Jatos de hoje") | FEFO automático; o servidor não aceitava a escolha | o campo "Lote" depois da quantidade; o servidor aceita `lotes` em lançar, editar e nos `produtos[]` do lançamento. Editar sem escolher e sem trocar produto, local nem quantidade mantém os lotes da linha; "Repetir o jato anterior" não copia a escolha |
| **Abastecimento** | FEFO automático; o servidor não aceitava a escolha | o campo "Lote" depois do local; prévia e confirmação aceitam `lotes` (a prévia mostra as fatias e o custo da escolha; recusas viram bloqueio); posto externo não leva lote |

Produto **sem** controle de lote: nenhum campo aparece, nada é lido e o corpo é o de sempre (custo médio do depósito).

## Servidor

- `GET /estoque/lotes-disponiveis`: guarda própria `GUARDAS.estoque.lotesDisponiveis` (Estoque visualizar **ou** quem grava no cocho, no financeiro, na atividade ou no abastecimento).
- Financeiro: a prévia diz `controla_lote`/`controla_validade` em cada efeito de estoque (o contrato de chaves do vetor compartilhado e o backend falso da tela foram atualizados).
- Atividade: `lotes` (`LOTES_ESCOLHIDOS`) no item de produto; `aplicarSaida` recebe a escolha; na edição sem `lotes`, as fatias da linha editada; opções de produto e a linha pública dizem `controla_lote`.
- Abastecimento: `lotes` no corpo; a prévia usa `consumirPorLote(…, escolhidos)` e converte as recusas em bloqueio `ESTOQUE_LOTE_INVALIDO`; fingerprint com `lotes` só quando vem; opções de produto do bem dizem `controla_lote`.
- Cocho e venda: o servidor já aceitava a escolha (D-PROD-282); só a tela mudou.

## Testes

- **Backend (PostgreSQL real):** `backend/tests/estoqueLoteTodasTelas.test.mjs` — T0 permissões da leitura dos lotes; T1 cocho; T2 financeiro (compra sem lote recusada, com lote e validade gravada; prévia com o controle; venda com escolha, recusas, vencido, cancelamento); T3 atividade (lançar, editar mantendo e trocando lotes, cancelar, `produtos[]` com jatos); T4 abastecimento (prévia e confirmação, recusas, externo, cancelamento). Em cada um: soma certa, soma errada → 422, produto sem lote + lista → 422, vencido → aviso, e o replay do recálculo igual ao gravado.
- **Smoke (RTL):** `estoqueLoteCampo`, `estoqueLoteCocho`, `estoqueLoteFinanceiro`, `estoqueLoteAtividade`, `estoqueLoteAbastecimento` — produto sem lote sem campo, sugestão FEFO, "Escolher lotes" dividindo, vencido pedindo confirmação, corpo com `lotes` só na escolha manual, lista empilhada sem tabela (390 px).
- Ajustados: `atividadeLinhaProduto` (opção de produto com `controla_lote`), o vetor `rateioCabecalhoVetores.json` e `lancamentosFakeCore.js` (chaves da prévia).
- `npm run verify:all` na branch com a `origin/main` mesclada: ver o resultado na descrição da PR.

## Fora desta missão

- Unidade convertida (SACO, galão…) em atividade, abastecimento, cocho e transferência — depende da emenda proposta na SPEC de unidades (§7).
- Reconciliação do valor do estoque (pausada pelo proprietário).
- Lote na **retificação por substituição** do financeiro: a retificação não recebe `lotes_por_item` (comportamento herdado da D-PROD-282).
- `avisos` de vencido na resposta do **lançamento com várias linhas** da atividade (registro, jatos, "Repetir"): a tela já pede a confirmação do vencido antes de enviar; a janela de uma linha mostra o aviso.
- Na mesma gravação com várias linhas do mesmo produto e depósito (jatos), a sugestão de cada linha não desconta as outras; o servidor aplica em ordem e recusa o que faltar.
