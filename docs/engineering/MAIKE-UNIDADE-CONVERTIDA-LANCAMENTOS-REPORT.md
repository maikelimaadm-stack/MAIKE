# MAIKE — Unidade de conversão no cocho, na transferência e na atividade — relatório (D-PROD-309)

Decisão: [D-PROD-309](./DECISIONS.md) · Runbook: [`MAIKE-UNIDADE-CONVERTIDA-LANCAMENTOS-RUNBOOK-RELEASE.md`](./MAIKE-UNIDADE-CONVERTIDA-LANCAMENTOS-RUNBOOK-RELEASE.md) ·
SPEC: [`MAIKE-PRODUTO-UNIDADES-CONVERSAO-SPEC.md`](./MAIKE-PRODUTO-UNIDADES-CONVERSAO-SPEC.md) §3 e §7 · Branch:
`claude/unidade-convertida-lancamentos` (da `main` `b7a60c48`).

## 1. O pedido e a emenda

O proprietário aprovou em 2026-11-25 a emenda proposta na SPEC de unidades (§7), na opção "Aprovo: cocho, transferência e
atividade": "Na linha de produto da atividade, no cocho e na transferência, a quantidade pode ser digitada numa unidade de
conversão do cadastro do produto (D-PROD-288); o servidor converte para a unidade de estoque pelo fator cadastrado e grava
a unidade, a quantidade e o fator. O abastecimento continua sem conversão."

- `docs/constitution/00-CONSTITUICAO.md`: **Emenda aprovada pelo proprietário (D-PROD-309)**, com a data, dizendo onde ela
  substitui o "exatamente a quantidade digitada, na unidade de estoque do Produto" das expansões D-PROD-193/202 e que a
  revisão D-PROD-162 (abastecimento) continua inteira.
- `docs/constitution/07-DO-NOT-DO.md`: nota D-PROD-309 (exceção ao "converter unidade" das notas D-PROD-193/202, só nesses
  três lançamentos). A proibição do abastecimento (nota D-PROD-159/162) **não foi tocada**.

## 2. Por camada

**Banco.** Migration EXPAND `20261126200000_unidade_convertida_lancamentos`: 6 colunas anuláveis, sem DEFAULT e sem CHECK
— `unidade_lancamento` VARCHAR(8), `quantidade_lancamento` DECIMAL(14,4), `fator_lancamento` DECIMAL(14,4) — em
`MovimentacaoEstoque` (cocho, as duas pernas da transferência, a saída da linha da atividade) e em
`AtividadeApontamentoProduto`. Checksum pinado (`3644b7fd…f169`) no manifesto, colunas no preflight de schema,
B46a/b/c, as contagens dos ensaios de migration (81 pastas) e o espelho sem as colunas (`schemaSemUnidadeConvertida`).
**Não aplicada em produção.**

**Servidor.**
- `backend/src/modules/produtos/unidadeLancamento.js` (novo): lê `unidade_lancamento` (id ou sigla) e
  `quantidade_lancamento`, carrega as conversões vigentes do produto e converte pelo **`resolverUnidade` da D-PROD-288**
  (o mesmo da compra do financeiro: uma conta, 4 casas, ROUND_HALF_UP; fator efetivo em 4 casas). Recusa com 422
  `UNIDADE_LANCAMENTO_INVALIDA` (novo código no catálogo); `quantidade` de estoque enviada junto é conferida
  (`quantidade_divergente`). Na edição na mesma sigla, o fator GRAVADO (como o `comPesoGravado` da retificação).
- `movimentacaoEstoqueComandoService.js` / `movimentacaoEstoqueRoutes.js`: cocho (uso saída) e transferência (qualquer
  ativa) aceitam os campos; `quantidade` passa a ser opcional com a unidade (`anyOf`); fingerprint só com os campos quando
  vêm, no fim; as colunas vão no `complemento` do motor (allowlist `COLUNAS_COMPLEMENTO`).
- Atividade: `atividadeApontamentoProdutoService.js` (lançar, editar, `produtos[]`), `atividadeApontamentoProdutoRoutes.js`
  (schema), `atividadeComum.js` (forma pública, anti-coerção), `atividadeRegistroService.js` (várias áreas: reparte a
  quantidade digitada), `atividadeOpcoesService.js` (as opções de produto trazem as conversões ativas com uso em saída).
- `produtoUnidadesConversao.js`: a sigla usada no cocho, na transferência ou na atividade conta como "em uso" (sai da lista
  → só desativa).

**Tela.**
- `src/lib/unidadeLancamentoRegras.js` (novo): opções do seletor, a conta (a mesma do servidor, via `emUnidadeDeEstoque`),
  "= 250 kg", o corpo, o fator gravado na edição.
- Cocho (`FormularioLancamentoSuplementacao.jsx`): o antigo par KG/Sacos (`LancLoteSegmento` + `quantidade_sacos`) virou o
  seletor "Unidade" (kg e as conversões; o SACO legado aparece pelo peso); a conta embaixo; o aviso "os lotes são em kg".
  A baixa (`montarCorpoDaSaidaSuplementacao`) leva a unidade e a digitada; o evento continua com `unidade_lancamento`,
  `quantidade_sacos` (na unidade SACO) e `peso_por_saco_kg` — o histórico antigo lê igual — e ganha `quantidade_lancamento`.
- Transferência do mapa (`FormularioTransferenciaDeposito.jsx`): mesmo seletor (KG/L e as conversões ativas), a conta numa
  linha inteira da grade; a fila guarda os campos; a edição na fila reabre na unidade.
- Transferência da tela Estoque (`TelaNovoMovimentoEstoque.jsx`, `estoqueEntradasRegras.js`, `estoqueEntradasService.js`):
  "Unidade" ao lado da quantidade, a conta e o campo "Lote" com a quantidade já em kg.
- Atividade (`JanelasDaLinha.jsx` › `CamposDaLinhaProduto`, que também serve ao registro de campo e aos "Jatos de hoje";
  `atividadeLinhasRegras.js`; a porta `lancamentoAtividadePort.js`): "Unidade" ao lado da quantidade, "= 100 kg", a dose
  por hectare em kg, o saldo comparado em kg; o PATCH manda as três juntas quando a quantidade muda.

## 3. Decisões de desenho

- **O SACO antigo** (cocho e transferência do mapa) foi **substituído** pelo seletor geral, não mantido ao lado: a
  D-PROD-288 já copiou a conversão SACO para os produtos com peso por saco, e o produto SACO sem ela continua pelo peso (na
  tela e no `resolverUnidade`). Os registros antigos ficam legíveis porque o evento mantém os campos que o histórico lê.
- **Uso**: cocho e atividade = saída (como a saída manual); transferência = qualquer ativa.
- **Conferência da quantidade de estoque**: a tela manda a conta que mostrou; se o cadastro mudou entre a tela e o envio
  (inclusive sem internet), o servidor recusa em vez de gravar outra quantidade em silêncio.
- **Lotes**: continuam na unidade de estoque (o motor nunca vê a sigla); a tela diz isso quando a unidade é outra.

## 4. Testes (vermelho primeiro)

- **Backend (PostgreSQL real)** — `backend/tests/unidadeConvertidaLancamentos.test.mjs`, 14 casos (UC-1 cocho, UC-2 as duas
  transferências, UC-3 atividade, UC-4 sigla em uso): converte e grava unidade/quantidade/fator; inválida → 422 (desativada,
  desconhecida, de outro produto, KG↔L, divergente) sem gravar; sem unidade → como sempre; reenvio e edição mantêm o fator
  gravado (25 com o cadastro em 30); lote escolhido com a unidade (5 BALDE = 20 kg, A 12 + B 8 → 96,00). **Rodados contra o
  código da `main` (só os testes, a migration e o schema novos): 0/14** — vermelhos; com a implementação, 14/14.
- Ajustados pela forma pública nova: `atividadeLinhaProduto.test.mjs` (colunas da linha, `unidades_conversao` na opção).
- Deploy: `premerge-migrate.test.mjs` (B1 com as 3 colunas de `MovimentacaoEstoque`, B46a/b/c, contagens 81),
  `preflight-schema.test.mjs`; ensaios de migration (`categoriaManejoCadcategoriaMigration`, `estoqueEntradasMotivosMigration`,
  `patrimonioSimplificaMigration`, `diaDaD223`).
- **Smoke/RTL**: `unidadeConvertidaRegras.test.js` (UCR-1..3: opções, a conta com MULTIPLICA/DIVIDE, fator gravado, corpo,
  PATCH); `lancamentoSuplementacaoEstiloManejo.test.jsx` (LM-6 seletor e "= 200 kg" no cocho; LM-6b produto sem conversão
  sem nada novo); `transferenciaDepositoEstiloManejo.test.jsx` (TM-3 com SACO; TM-9 a 390 px, a conta numa linha inteira);
  `estoqueNovoMovimento.test.jsx` (transferência em sacos; sem conversão, o corpo de sempre); `lancamentoAtividadesLinhas.test.jsx`
  (LL-PRODUTO-UCL); `lancamentoCochoOffline.test.js` (LCO-16: a fila guarda e sobe a unidade); `depositoTransferenciaOffline.test.js`
  (ET-09).
- Resultados das suítes e dos gates: §6.

## 5. O que ficou de fora (e por quê)

- **Abastecimento**: proibido pela Constituição (fora da emenda).
- **A unidade digitada nas listas** (Estoque › Movimentos, histórico do depósito): gravada, ainda não mostrada — tela própria.
- **Campo "Lote" na transferência do mapa**: não existia antes desta missão (a da tela Estoque tem); fora do escopo.
- **Saída manual + lote + sigla nova**: o `quantidadeDeEstoque` do campo "Lote" da saída manual (D-PROD-282) só converte o
  SACO pelo peso; numa sigla nova, a soma dos lotes é conferida contra a quantidade digitada (o servidor recusa com
  `lotes_nao_somam`). Achado aqui, fora desta missão.
- **Limites aceitos**: ver a D-PROD-309 (DIVIDE na edição com outra quantidade; "Repetir" com o fator gravado; item sem
  internet com o fator mudado → "precisa de atenção").

## 6. Verificação

PostgreSQL 16 local (banco de teste `maike_ucl`, nunca produção), depois do merge da `main` `d0843361` (PR #394, D-PROD-308):

| Etapa | Resultado |
|---|---|
| `npm run verify:all` | **TODAS AS ETAPAS PASSARAM** (39 etapas, `EXIT 0`, 3.366 s) |
| `test:gates` | 1.093 / 1.093 |
| `gate:types` | PASSOU (374 diagnósticos, sem regressão; teto 625) |
| `typecheck:backend` | 0 diagnóstico |
| `test:backend` | 2.881 testes: 2.875 passam, 0 falham, 6 `todo` |
| `test:smoke` | 353 arquivos, 4.353 / 4.353 |
| `build` / `build:admin` | ok |

A primeira rodada (antes do merge) achou três coisas, corrigidas: um `@param` com nome errado no cocho (`gate:types`); o
hash "byte a byte" do caminho KG/SACO do financeiro (`gestaoP3UnidadeLitros` U4), que passa a tirar as 3 colunas novas
(nulas) do movimento antes do hash, como a D-PROD-282 fez com o lote; e o retrato/impressão digital do ensaio do Patrimônio
(`patrimonioSimplificaMigration` SM-03), que passa a ignorar as 3 colunas posteriores do movimento, como fazia com
`carencia_dias`.

**Produção:** nada aplicado. A migration espera o GO do proprietário (runbook).
