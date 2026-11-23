# MAIKE — Estoque: controle de lote por produto (relatório, D-PROD-279)

Decisão: [D-PROD-279](./DECISIONS.md) · SPEC: [`MAIKE-ESTOQUE-CONTROLE-LOTE-SPEC.md`](./MAIKE-ESTOQUE-CONTROLE-LOTE-SPEC.md) ·
Runbook: [`MAIKE-ESTOQUE-CONTROLE-LOTE-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-CONTROLE-LOTE-RUNBOOK-RELEASE.md) ·
Branch: `claude/estoque-controle-lote` (da `main` `d62a4ef8`, sem push).

## 1. O que foi feito

| Etapa | Commit | Conteúdo |
|---|---|---|
| A — governança | `ee2aa8b0` | D-PROD-279 (escolhas do proprietário, tratamento da sobra), emenda aprovada em `00-CONSTITUICAO.md` §1 e nota em `07-DO-NOT-DO.md`, SPEC |
| B — migration | `78f7bf8a` | `20261123100000_estoque_controle_lote`, `schema.prisma`, pinagem (`MIGRATIONS_APROVADAS` e `MIGRATIONS_CONTRACT_APROVADAS`), colunas do preflight, testes de deploy e espelhos, runbook |
| C — motor e backend | `afdcf6e7` | motor (FEFO, escolha, custo do lote, sem reavaliar), serviços, endpoint de lotes, troca do cadastro, recálculo/replay, teste PG |
| D — telas | `a162c0e0` | cadastro (2 Sim/Não), entrada (obrigatórios), saída e transferência (campo Lote), saldo (detalhe por lote), smoke |
| relatório | (este) | relatório e `CURRENT-STATE` |

### Motor (`backend/src/modules/estoqueFisico/estoqueFisicoMotor.js`)
- `controleDeLote(tx, cli, produto)`: lê `controla_lote`/`controla_validade` (do objeto ou do banco).
- `aplicarEntradaEstoque` aceita `lote: { fabricante, validade }`; produto com lote sem lote → 422
  `ESTOQUE_LOTE_OBRIGATORIO` (`lote_obrigatorio`/`validade_obrigatoria`). Vale para **toda** entrada (documentada,
  compra do financeiro, sobra de ajuste), porque todas passam por ela.
- `consumirPorLote(lotes, kg, escolhidos?)` (pura): FEFO (`ordenarFefo`: validade crescente, sem validade por último,
  empate pela ordem FIFO única) ou a escolha; cada fatia pelo custo da camada; recusas 422 `ESTOQUE_LOTE_INVALIDO`.
- `aplicarSaida` e `aplicarTransferenciaEstoque` usam `consumirPorLote` no produto com lote, gravam
  `modo_saida_fifo = 'LOTE'` e **não reavaliam** (nem origem, nem destino). A camada de destino copia lote e validade.
- `estornarSaida`, `estornarEmLote` e `estornarTransferenciaEstoque` não reavaliam quando o original é `LOTE`.
- Produto sem lote: caminho de antes (custo médio, D-PROD-256), com uma linha a mais: `lotes` informado num produto
  sem lote → 422 `produto_sem_controle_de_lote` (nunca ignorado em silêncio).

### Serviços
| Origem | Lote/validade (entrada) | `lotes` (saída) |
|---|---|---|
| Entrada documentada | as colunas da linha que já existiam (D-PROD-259) vão para a camada | — |
| Compra/venda do financeiro | `lotes_por_item[].lote_fabricante/data_validade` na **confirmação** | `lotes_por_item[].lotes` na confirmação |
| Saída manual | — | `itens[].lotes` (criação e edição) |
| Transferência | copiados da origem | `lotes` no comando |
| Cocho (suplementação) | — | `lotes` no comando |
| Ajuste | sobra: `itens[].lote_fabricante/data_validade` (custo do mesmo lote ou informado) | falta: `itens[].lotes` |
| Atividade, abastecimento | — | **FEFO do servidor** (sem a lista na API; ver §4) |

- `GET /estoque/lotes-disponiveis?empresa_id&produto_id&local_estoque_id` (guarda `estoque.ver`): FEFO, validade,
  saldo, custo, `vencido`, `vence_em_dias` pelo hoje da fazenda.
- `/estoque/saldo` traz `controla_lote`/`controla_validade`; as opções de produto da entrada também.
- Produto: `controla_lote`/`controla_validade` no cadastro; validade sem lote → 400 `validade_sem_lote`; troca com
  saldo (Σ camadas disponíveis ou `estoque_atual` ≠ 0) → 409 `PRODUTO_LOTE_TROCA_COM_SALDO`, sob a trava do produto.
- Prévias do financeiro e do abastecimento pelo custo do lote (FEFO), como o motor.
- Tenant só de `auth_context` em tudo (os ids de camada escolhidos são conferidos no poço do tenant/empresa/depósito).

### Recálculo (`backend/src/modules/estoqueRecalculo/`)
- Replay: saída e transferência `LOTE` usam as fatias gravadas pelo custo gravado, sem reavaliar; o estorno delas
  também; a sobra de ajuste numa camada com lote do fabricante fica no custo gravado.
- Exclusão: a fatia de lote que cai numa camada excluída para a simulação com `lote_consumido` → 409
  `ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL`, "este lote já teve saída (movimento nº N); exclua antes as saídas dele".
  Excluir entrada de lote intocado e excluir saída de lote são estorno exato (no mesmo lote).

### Telas
- `FormularioProduto`: "Controla lote" e "Controla validade" (o segundo só com o primeiro).
- Entrada ("Novo movimento"): Lote e Validade marcados obrigatórios e conferidos conforme o produto.
- Saída e Transferência: `CampoLotesSaida` — sugestão FEFO, "Escolher lotes" (dividir), "Lote vencido em dd/mm" com
  caixa de confirmação (sem ela, o formulário não envia); o corpo leva `lotes` só na escolha manual.
- Saldo: ação "Ver lotes e validade" nos produtos com lote (`JanelaLotesSaldo`), com "Vence em N dias" (≤ 30) e
  "Lote vencido em dd/mm"; tela cheia no celular, lista empilhada (390 px).

## 2. Migration

| Item | Valor |
|---|---|
| Pasta | `backend/prisma/migrations/20261123100000_estoque_controle_lote/migration.sql` |
| sha256 | `b6b33b0ebb35f44d91d7b3766525a51e839d68348aca78388fd26ab2645948fc` |
| Guarda (sha256 do corpo normalizado) | `98e741eef93fcd2931fdea5ae8838c24fd842b89e161df32a6e4b66621c588fc` |
| Classificação | **CONTRACT condicionado e ADITIVO** (`--contract D-PROD-279`): a allowlist EXPAND recusa NOT NULL DEFAULT, DATE e CHECK em tabela antiga. Nenhum DROP, nenhum DML |
| Conteúdo | `Produto.controla_lote`/`controla_validade` BOOLEAN NOT NULL DEFAULT false; CHECK `Produto_controla_validade_check`; `EstoqueLoteNota.lote_fabricante` VARCHAR(64) e `data_validade` DATE anuláveis; índice `EstoqueLoteNota_fefo_idx` (`cliente_id`, `empresa_id`, `produto_id`, `local_estoque_id`, `data_validade`) |
| Produção | **não aplicada**; esperado 75 → 76 migrations, 111 tabelas antes e depois |

## 3. Números e validação

### Teste PG `backend/tests/estoqueControleLote.test.mjs` — 11/11
| Caso | Números |
|---|---|
| FEFO | A 100 a 4 (vence 31/12/27), B 50 a 6 (01/08/27), C 40 a 5 (31/01/28); 60 kg sem escolha → B 50 × 6 + A 10 × 4 = **340,0000**, unitário **5,6667**, `LOTE` |
| Manual | 20 do A → **80,0000** |
| Divisão | 10 do A + 20 do C → **140,0000**, unitário **4,6667**; depois A 60 a 4, B 0 a 6, C 20 a 5 (nenhuma reavaliada) |
| Puro | camadas a (09/27, 5 a 3), b (09/27, 5 a 2, mais nova), c (sem validade): ordem a, b, c; 7 kg → 15 + 4 = **19,0000**, **2,7143** |
| Transferência | 15 do C para L2 → **75,0000**; destino lote C, 31/01/2028, custo 5; depois de D 10 a 9 em L2, 5 do C sai a **25,0000** |
| Vencido | lote de 10/01/2027 (hoje 15/06/2027): `vencido`, dias < 0; 4 kg a 3 aceitos → **12,0000** |
| Troca | com saldo → 409; validade sem lote → 400; zerado → aceita; o contrário com saldo → 409 |
| Exclusões | saída do A (com saída do C depois) → A volta a 100 a 4; entrada do C consumido → 409 `lote_consumido`, nada gravado; entrada do B intocado → Estornado |
| Ajuste | sobra do A (190 → 200) entra a **4** (10 × 4 = 40), validade herdada; lote novo sem custo → 422; com 7 → **35,0000** informado; falta 10 do C → **50,0000** |
| Sem lote | 10 a 2 + 10 a 4, saída 5 → **15,0000** a **3,0000** (`CUSTO_MEDIO`), resto a 3 |
| Replay | "replay = gravado" provado em FEFO, transferência, exclusões, ajuste e sem lote |

### Suítes e gates (Postgres 17, porta 5433, banco `maike_lote` por `migrate deploy`)
| Suíte / gate | Resultado |
|---|---|
| `estoqueControleLote.test.mjs` (novo) | 11/11 |
| `estoque*`, `motorEstornoCochoTransferencia`, `suplementacao*`, `atividade*`, `gestaoP3*`, `depositoCancelar*`, `patrimonioP1Abastec*` (68 arquivos, sem os de migration) | 1059/1059 depois de ajustar o U4 de `gestaoP3UnidadeLitros` (o hash "como antes" agora tira as 2 colunas novas, vazias, da camada; a 1ª rodada deu 1058/1 só nele) |
| testes de migration (`*Migration*`, `sqlEditorBootstrap`, `patrimonioP1Seguranca`, 26 arquivos) | todos verdes, com o espelho `schemaSemControleLote` e as listas de migrations posteriores atualizadas |
| `scripts/tests/deploy/*` (premerge, migrations, preflight, alvo, bench) | 209 + 105 + 10 + 6 + 13, 0 falhas |
| `node scripts/tests/run-gate-tests.mjs` | 1074/1074 |
| `npm run -s test:smoke` | 323 arquivos, 4057 testes, 0 falhas (inclui `tests/smoke/estoqueControleLote.test.jsx`, 4) |
| eslint nos arquivos tocados | 0 erros, 0 avisos |
| `typecheck:backend` | 0 |
| `typecheck` (ratchet) | 374 (base 374), sem regressão |
| gates tenancy, indices, deploy-migrations, governance-paths, no-secrets, product-scope, import-integrity, base44 | PASSOU |

## 4. O que ficou de fora
- **Atividade e abastecimento**: a API não aceita a lista `lotes` (sai pelo FEFO do servidor, com o custo do lote).
  A escolha manual nessas duas origens fica para depois (precisa mexer nos esquemas e fingerprints de linhas que
  hoje têm idempotência própria).
- **Retificação por substituição do financeiro** (D-PROD-158) de compra de produto com lote: não leva lote; o motor
  recusa (`lote_obrigatorio`). Caminho: excluir e lançar de novo, confirmando com `lotes_por_item`.
- **Tela** do financeiro (confirmar com lote/validade) e do cocho/mapa: só a API; a tela de lançamento financeiro não
  pede lote ainda.
- A edição completa da saída (D-PROD-271) não reabre a escolha de lotes da versão anterior (a nova versão vai pelo
  FEFO, salvo escolha nova).
- Aviso de vencimento em até 30 dias aparece no detalhe por lote do Saldo, não na lista do Saldo.

## 5. Ensaio da migration e suítes
- Banco local recriado (`maike_lote_ensaio`) até a `20261122100000_reforma_planejamento` (75), o envelope do runbook
  §3 com o `system_identifier` local aplicou numa transação: postcheck **76**, checksum `b6b33b0e…48fc`, **111**
  tabelas, as 4 colunas como esperado (`controla_lote:boolean:NO:false`, `controla_validade:boolean:NO:false`,
  `data_validade:date:YES`, `lote_fabricante:varchar:YES`), CHECK e índice presentes, 0 produtos marcados; a 2ª
  execução parou em `RELEASE_BLOCKED: migration já registrada`; `prisma migrate status` em dia e `migrate diff` vazio.
- `maike_lote` por `migrate deploy` (76): `migrate diff` vazio.

## 6. Dúvidas
1. A migration foi pedida como "EXPAND"; pelo classificador ela é CONTRACT condicionado (aditiva), como as anteriores
   com NOT NULL DEFAULT/DATE/CHECK em tabela antiga. A release precisa do `--contract D-PROD-279`.
2. Tratamento da sobra de ajuste (custo do mesmo lote, senão custo informado): confirmar com o proprietário.
3. Atividade e abastecimento só com FEFO nesta entrega: aceitável ou a escolha manual entra antes da release?
4. O número D-PROD-279 foi conferido só pelo marcador (sem rede): conferir de novo com
   `scripts/dev/proxima-decisao.mjs` antes de abrir a PR (D-PROD-277).
