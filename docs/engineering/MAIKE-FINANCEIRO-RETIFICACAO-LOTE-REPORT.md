# MAIKE-FINANCEIRO-RETIFICACAO-LOTE — relatório

**Decisão:** [D-PROD-301](./DECISIONS.md) · **Data:** 2026-11-25 · **Branch:** `claude/financeiro-retificacao-lote` · **Migration:** nenhuma · base: [D-PROD-300](./DECISIONS.md) (lote na confirmação do financeiro)

## O problema

A correção ("Salvar correção") de um lançamento financeiro **confirmado** que muda o estoque é uma SUBSTITUIÇÃO: a versão anterior é estornada e a nova é gravada pelo mesmo núcleo da confirmação. A confirmação já recebia o lote (`lotes_por_item`, D-PROD-300); a retificação não:

| Correção | Antes | Agora |
|---|---|---|
| **Compra** de produto com lote, com mudança física (quantidade, custo, depósito…) | **recusada** (422 `ESTOQUE_LOTE_OBRIGATORIO`, `lote_obrigatorio`): a rota nem aceitava o campo | o diálogo mostra "Lote do fabricante" e "Validade", já preenchidos com os do lote de entrada da versão anterior; a camada nova nasce com eles |
| **Venda** de produto com lote, com mudança física | FEFO, sem escolha | o diálogo mostra o campo "Lote" (sugestão FEFO, escolher e dividir, vencido pede confirmação); o saldo conta o que a versão anterior baixou (o estorno devolve) |
| Correção **sem** mudança no estoque (NO_LUGAR) | não mexia em lote | igual: nada aparece, nada é lido; o servidor ignora `lotes_por_item` |
| Produto **sem** lote | — | nada aparece; o corpo é o de sempre |

## Servidor

- `operacaoFinanceiraRoutes.js`: o schema de `lotes_por_item` virou a constante `LOTES_POR_ITEM`, usada pela confirmação e pela retificação (`RETIFICAR` aceita o campo).
- `operacaoFinanceiraService.js` — `retificar`: lê o campo com `lotesDaConfirmacao` (o mesmo da confirmação), põe-no no fingerprint só quando vem (um corpo sem o campo tem o fingerprint de antes, então pendências antigas e replays continuam batendo) e o passa a `aplicarEfeitosDoPlano` na SUBSTITUIÇÃO. A resposta da substituição passa a trazer `avisos` quando a saída nova usa lote vencido (como a confirmação; a tela mostra o alerta).
- NO_LUGAR: inalterado (não chama o núcleo de efeitos).

## Tela

- `FormularioLancamento` manda ao diálogo os efeitos de estoque da correção (`mercadoriasDaCorrecao` em `lancamentoModelo.js`: ordem, produto, depósito e kg do resumo, no formato da prévia).
- `DialogoRetificacao.jsx` (novo) envolve o `DialogoAcao` da correção. Só quando `mudaEstoque`: lê `GET /estoque/lotes-disponiveis` por produto e depósito (a mesma chave de cache do `CampoLotes`) para saber `controla_lote`/`controla_validade` (a prévia do servidor só existe para rascunho) e mostra o `LotesDaConfirmacao`.
- **Pré-preenchimento (compra):** o detalhe da versão anterior dá o `estoque_lote_nota_id` do item; a leitura dos lotes do mesmo produto e depósito dá o fabricante e a validade daquele lote. Como a substituição só é possível com o lote de entrada intacto, ele está na leitura. **O dado está disponível**; se o lote não vier na leitura (caso de borda), os campos ficam em branco e bloqueiam até preencher (testado em RL-2).
- **Venda:** as fatias da versão anterior (`consumos` do item, mesmo produto e depósito) entram como `devolvidos` no `CampoLotes` (o mesmo recurso da edição da linha de atividade).
- **Bloqueio:** "Salvar correção" fica desabilitado com pendência de lote (as regras de `lotesDaConfirmacao` da confirmação: lote obrigatório, validade obrigatória se o produto controla, até 64 caracteres; na venda, soma e vencido confirmado) e enquanto os lotes carregam. Leitura com erro: aviso, sem bloqueio (o servidor confere).
- `DialogoAcao` ganhou a prop opcional `bloqueio` (desabilita o envio); `LotesDaConfirmacao` ganhou `aviso` e repassa `efeito.devolvidos`.
- `retificarLancamento` manda `lotes_por_item` só quando há item. Depois de gravar, o aviso de lote vencido da resposta vira alerta, como na confirmação.

## Testes (RED primeiro)

- **Backend (PostgreSQL real)** — `backend/tests/financeiroRetificacaoLote.test.mjs`, 3 testes. RED provado no código da `main`: 3 de 3 falhavam (400 `unknown_field` para `lotes_por_item`; o 422 `lote_obrigatorio` sem o campo já aparecia).
  - R1 compra com lote, 40 → 50 kg: sem `lotes_por_item` → 422 `lote_obrigatorio` e nada muda (lote, status e versão); só o lote → 422 `validade_obrigatoria`; com lote e validade → SUBSTITUIÇÃO e a camada nova com `NF-78`/`2028-01-31` (lote aparado); replay do mesmo `operation_id` → o mesmo documento, `replay: true`, nenhuma camada nem movimento a mais; o mesmo `operation_id` com outro lote → 409.
  - R2 venda: 20 kg pelo FEFO; corrigida para 25 kg do A → sai do A (VELHO 10, B 50, A 75); corrigida de novo para 15 kg sem escolha → FEFO (VELHO 10 + B 5) com o aviso do vencido.
  - R3 NO_LUGAR (só a descrição) com `lotes_por_item` → modo NO_LUGAR, o mesmo lote e a mesma validade.
- **Smoke (RTL, página real com backend falso)** — `tests/smoke/financeiroRetificacaoLote.test.jsx`, 6 testes. RED no código da `main`: 5 de 6 falhavam (o RL-5 é a guarda de regressão).
  - RL-1 compra: o diálogo mostra os campos pré-preenchidos (`NF-77`, `2027-12-31`); sem o lote bloqueia com a mensagem da confirmação; o corpo leva `lotes_por_item`.
  - RL-2 o lote anterior fora da leitura: campos em branco, bloqueio até lote e validade.
  - RL-3 venda: o saldo conta o devolvido; vencido pede confirmação; a escolha manual vai em `lotes`.
  - RL-4 produto sem lote: nada aparece, corpo sem `lotes_por_item`.
  - RL-5 sem mudança no estoque: nenhuma leitura de lotes, nada aparece.
  - RL-6 390 px: o diálogo com os lotes sem rolagem horizontal, campos empilhados.
- Suítes vizinhas sem mudança: `gestaoLancamentosEditarExcluirDuplicar` (inclui EDT-5 e MOB-1 da substituição), `estoqueLoteFinanceiro`, `estoqueLoteCampo`, `gestaoLancamentos*`; backend `gestaoP3EditarExcluir`, `estoqueLoteTodasTelas`, `estoqueP0CorrecoesR2`, `estoqueP0MotorUnico` (89 de 89).
- `npm run verify:all`: ver o resultado na descrição da PR.

## Fora desta missão

- Correção que a tela prevê **sem** mudança no estoque mas o servidor faz por substituição: o diálogo não mostra os campos; a compra com lote é recusada (422) e a pessoa corrige de novo. A previsão da tela usa a mesma assinatura física do servidor, então o caso é raro.
- Troca de direção (compra ↔ venda) com produto de lote: sem tratamento especial (o servidor confere).
- Desabilitar os campos de lote durante o envio (o `DialogoAcao` não expõe o estado do envio; o botão já fica desabilitado).
