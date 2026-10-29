# MAIKE-LEDGER-PECUARIO-L1 — relatório (L1 + R2, R3, R4 e R5 de correções da auditoria)

**Branch:** `claude/maike-ledger-pecuario-l1`, numa worktree física separada,
base `origin/main` = `1344ffe2`.\
**PR:** maikelimaadm-stack/MAIKE#146 (DRAFT).\
**Contrato:** [`MAIKE-ESTOQUE-PECUARIO-LEDGER-L1-CONTRATO.md`](./MAIKE-ESTOQUE-PECUARIO-LEDGER-L1-CONTRATO.md)\
**Paralelismo:**
- A PR #145 não foi tocada.
- A lista de arquivos dela é variável: 35 numa leitura inicial, 95 no head
  `9bad34ce`, 125 no head `61a7fa44` (R4), 138 no head `1cf1b9e9` (R5).
- A interseção com os 11 arquivos do L1 é recalculada contra o head atual da
  #145 antes de cada push; foi **vazia** em todas as verificações.

## R2 — auditoria arquitetural (CHANGES_REQUESTED) → correções

Diagnóstico BEFORE: probe sobre o código `9356bb12`, não versionado. As novas
suítes também falham no código antigo, porque dependem das exportações
corretivas.

| Bloqueio | BEFORE (medido) | Correção | AFTER (medido) |
|---|---|---|---|
| **P0** duas ENTRADAS concorrentes do mesmo lote (`operation_id` diferentes) | **10/10** rodadas gravaram DUAS entradas | `SELECT … FOR UPDATE` no `"Lote"` (tenant + empresa) **antes** da checagem de entrada ativa, na transação da idempotência; `lote_referencia_id` obrigatório; snapshot histórico validado | 10/10 rodadas: exatamente 1 entrada, a outra é recusada; 0 idempotência presa; projeção = soma dos fatos |
| **P0** reconciliação descartava a entrada de lote **Inativo** | `total_entradas = 0`; A esperado −1000 (lacuna artificial de 1000) | Entrada conta qualquer que seja o status; status com cara de anulação conta + quarentena; classes de origem (cadastro/nascimento/derivados) | A = 0, B = 1000, total 1000, 0 lacunas, `conciliada` |
| **P1** categoria da entrada pela categoria ATUAL | usou `cm:boi_novo` (atual) | Entrada usa `categoria_manejo_entrada_id`; posição usa a atual; transferência só infere do lote que nunca mudou, senão mapeamento explícito ou quarentena | entrada sob `cm:bezerro`, posição sob `cm:garrote`, movimento em quarentena, `bloqueada_para_backfill` |
| **P1** quantidade truncada | `"10.5"` contou como 10 | `inteiroPositivoEstrito` + quarentena | 0 entradas válidas; 4/4 entradas inválidas em quarentena |
| **P1** sem estado verificável | sem campo `estado` | `conciliada` / `reconciliacao_parcial` / `bloqueada_para_backfill`, geral e `por_empresa` | diferença zero com quarentena nunca sai `conciliada` |
| **P1** data operacional frouxa | aceitava `2026-10-29abc`, `2026-02-30`, `2026-02-29`, `" 2026-10-29"` | Regex na string inteira + reconstrução UTC dos componentes | os 16 casos inválidos são recusados; 2024-02-29 e 2000-02-29 aceitos |
| **P1** esquema arbitrário (DROP CASCADE) | aceitava `auth`, `storage`, `pg_catalog`, `information_schema`, `prisma`, arbitrário | Só `^ledger_l1_[0-9a-f]{12,32}$`; `gerarEsquemaDescartavel()` | 18 nomes negativos recusados (criar e DROP); a suíte prova que criou/removeu só o próprio esquema |

## R3 — correção final do auditor de reconciliação (sobre `8be082f2`)

Escopo: só `scripts/ops/auditarLedgerPecuarioLib.mjs`, o teste de contrato e
estes dois documentos. O motor transacional não foi tocado.

| Defeito | BEFORE (`8be082f2`, medido) | Código afetado | AFTER (medido) |
|---|---|---|---|
| **P1** inferência de categoria do movimento | histórica ausente + atual presente + movimento sem categoria: **aplicado**, sem quarentena (ramo `!lote.categoria_manejo_entrada_id \|\| …`) | bloco "Categoria do movimento" da lib: 3 fontes com proveniência (`evento` / `lote_estavel` / `mapeamento`) | não aplicado; quarentena `categoria_do_movimento_nao_comprovavel`; `bloqueada_para_backfill` |
| **P1** sinal de aptidão | não existia (`apto_para_backfill` ausente) | `apto(...)` por empresa + agregado geral fail-closed; `sem_dados`; `(sem_empresa)` | 150/135: `false`; 1000 A→B conciliado: `true`; quarentena: `false`; lacunas opostas: `false`; self-target sem lacuna: `false` |
| **P1** quantidade fora de inteiro seguro | `MAX_SAFE_INTEGER + 1` e `2^31` **aceitos** | `inteiroPositivoEstrito` + `QUANTIDADE_MAXIMA_REGISTRO_HISTORICO` (int4) | ambos `null` → quarentena; `2.147.483.647` aceito |

**Novas provas negativas** (14 testes no arquivo de contrato):
- categoria (a)–(e), mais pureza do dump;
- `apto_para_backfill` em 6 cenários (inclui empresa só com quarentena,
  `(sem_empresa)` e dump vazio);
- limites `int4` / `MAX_SAFE_INTEGER` em entrada, posição e movimento.

## R5 — tenant verificado e `capturado_em` real (sobre `49f1d274`)

Escopo:
- só `auditarLedgerPecuarioLib.mjs`, o teste de contrato e estes dois
  documentos;
- CLI, motor transacional e schema **não** foram tocados;
- `schema.prisma` só foi **lido**, para documentar que `cliente_id` é
  obrigatório nas duas tabelas.

Diagnóstico BEFORE: probe sobre a lib de `49f1d274`, fixtures sintéticas,
Node 22.22.0.

| Defeito | BEFORE (`49f1d274`, medido) | Correção | AFTER (medido) |
|---|---|---|---|
| **P0** aptidão sem tenant verificado | lote e movimento **sem** `cliente_id`, conta conciliada e manifesto válido: `snapshot.valido: true`, `apto_para_backfill: true`, motivos `[]` (só aviso) | toda linha tem de trazer `cliente_id` texto igual ao escopo; impedimentos `cliente_ausente_em_linhas`, `cliente_invalido_em_linhas`, `cliente_divergente_do_escopo` (com contagem de linhas) | `snapshot.valido: false`, apto `false` (geral e por empresa); `estado: conciliada` e `apto_matematico: true` preservados |
| **P0** `cliente_id: "  "` / numérico | só bloqueava por coincidência (`cliente_divergente_do_escopo`) | espaços = ausente; não-texto = inválido | motivo correto e estável |
| **P1** `capturado_em` normalizado | `2026-02-30`, `2026-04-31`, `1900-02-29` aceitos → apto `true`; `T24:00` só caía por parecer futuro | `instanteUtcEstrito`: componentes, bissexto, limites, reconstrução UTC exata, faixa 1900–9999 | os 33 valores inválidos do teste → `manifesto_capturado_em_invalido` |

**Prova de que os testes discriminam:**
- Rodar a suíte R5 contra a lib de `49f1d274`, com só os novos exports
  preenchidos por stub de R4 (regex + `Date.parse`): **9 de 12 falham**.
- Os 3 que passam também em R4 são controles positivos: tenant correto,
  datas válidas e o multitenant com valor divergente, que a R4 já bloqueava.
- Sem os stubs, a suíte nem carrega (`does not provide an export`).

**Fixtures antigas.**
- As fixtures R3/R4 que esperam `apto=true` passaram a trazer
  `cliente_id: 'cliente-sintetico'` (o tenant do manifesto sintético).
- Nenhum assert negativo foi removido.
- O teste R4 (L), que afirmava "cliente ausente só avisa", foi reescrito:
  ausência agora é provada como impedimento nos testes R5 (1)–(3).

## R4 — integridade do snapshot (sobre `cb5aae23`)

Escopo: os mesmos arquivos da R3 (lib e CLI do auditor, teste de contrato,
estes dois documentos). O motor transacional não foi tocado. Contrato do
manifesto: CONTRATO §7.1.

Diagnóstico BEFORE: probe sobre o código `cb5aae23`, não versionado, com
fixtures sintéticas.

| Defeito | BEFORE (`cb5aae23`, medido) | Correção | AFTER (medido) |
|---|---|---|---|
| **P0** fonte omitida virava zero | `movimentacoes_mapa` omitido → `conciliada`, `apto_para_backfill: true` | `estadoDaFonte` (`ausente` / `malformada` / `presente`) + manifesto externo v1 obrigatório para aptidão | `apto=false`, motivo `fonte_movimentacoes_mapa_ausente`; `[]` só vale zero com manifesto declarando `0` |
| **P0** recorte incompleto indetectável | dump sem uma empresa ou com lotes cortados saía apto | `validarManifestoSnapshot` confere contagens, escopo de empresas, zero explícito por empresa, tenant, consistência e origem; nunca gera manifesto | `contagem_*_divergente`, `empresa_do_escopo_sem_prova_de_zero`, `registro_fora_do_escopo`, `cliente_divergente_do_escopo` |
| **P1** movimento de outra empresa | movimento da empresa Y sobre lote da X: **aplicado**, sem quarentena | quarentena impeditiva `movimento_empresa_divergente_do_lote` antes de qualquer delta | não aplicado em nenhuma das duas empresas; `bloqueada_para_backfill` |
| **P1** IDs duplicados/vazios | lote com ID duplicado → `conciliada`, apto `true` ("a última linha vence"); ID vazio → apto `true` | contagem de IDs; lote duplicado vira `null` no índice; quarentena `lote_id_duplicado`, `movimentacao_id_duplicada`, `lote_referenciado_ambiguo`, `*_id_ausente` | `bloqueada_para_backfill`, apto `false` |
| **P1** estado × aptidão misturados | `apto_para_backfill` só refletia a conta | `estado` continua só matemático; `apto_matematico` (R3) + `apto_para_backfill` (R4) + `motivos_bloqueio_backfill` estáveis | conta fechada sem manifesto: `conciliada`, `apto_matematico: true`, `apto: false`, motivo `manifesto_ausente` |
| CLI | sem gate de aptidão; exit sempre 0 | `--exigir-apto` (0 apto, 3 inapto, 1 falha técnica, 2 uso); relatório mostra manifesto, contagens declaradas × lidas, empresas e motivos | provado por spawn do CLI com fixture temporária (teste M) |

**Testes R4 (14 novos no arquivo de contrato):** A–M do pedido, mais a
validação campo a campo do manifesto. N é a suíte transacional, que continua
27/27.

Duas fixtures da R3 que esperavam `apto=true` receberam manifesto **coerente**
(contagens escritas à mão). Nenhum assert foi afrouxado. O cenário "empresa só
com quarentena" agora prova também que o lote sem empresa está **fora do
escopo** (`apto_para_backfill` de E cai para `false` com `apto_matematico`
`true`). Uma segunda variante sem o lote órfão mostra E apta e F não.

## O que é real × o que é pendente

| Item | Estado |
|---|---|
| Contrato puro + validação contra snapshot do lote | **Código escrito e testado** (unitário) |
| Serviço transacional (idempotência real, trava de Lote e de posições, rollback, retry) | **Código escrito e testado contra PostgreSQL 16 real**, em esquema descartável `ledger_l1_<hex>` |
| Tabelas do ledger | **Prova de conceito:** DDL em esquema descartável. **Não** existe migration nem model Prisma. |
| Reconciliação read-only | **Código escrito e testado** (fixtures sintéticas: Inativo total, caso real 150/250/50, mudança de categoria, texto/mapeamento, quantidades inválidas, anulação/nascimento/derivados, duplicata; R4: manifesto, fontes, escopo, IDs, empresa divergente) |
| Models Prisma + migration, rota, grants/RLS, backfill, mapa lendo a posição | **PENDING L2** (5 `test.todo`), **não automático**: exige aprovação manual de cada etapa (contrato §5) |

**Não está pronto para produção nem para usuários:** não há API, migration nem
integração de frontend.

## Testes

| Arquivo / comando | Resultado |
|---|---|
| `estoquePecuarioLedgerTransacional.test.mjs` (PostgreSQL 16 real) | 27/27 PASS em 5 execuções seguidas na R2 (7,6–8,1 s cada); R4: 27/27 em 3 execuções (9,1–9,4 s) |
| `estoquePecuarioLedgerContrato.test.mjs` | 64 PASS (24 da R2 + 14 da R3 + 14 da R4 + 12 da R5) + 5 `todo` (PENDING L2, não contados como PASS) |
| `npm run verify:all` (R5) | PASS, 29/29 etapas, 370 s. `test:backend`: 382 testes, 377 pass, 0 fail, 5 todo. `test:smoke`: 918/918. Transacional: 27/27 em 3 execuções (7,3–9,6 s). |
| `npm run verify:all` (R4) | PASS, 29/29 etapas, 433 s. `test:backend`: 370 testes, 365 pass, 0 fail, 5 todo. `test:smoke`: 918/918. |
| `npm run verify:all` (R3) | PASS, 29/29 etapas, 405 s. `test:backend`: 342 testes, 337 pass, 0 fail, 5 todo (inclui `prisma validate`). `test:smoke`: 918/918. Typecheck backend, gate:types, lint, tenancy e build PASS. |

## Riscos remanescentes

- A garantia de "uma entrada ativa por lote" é procedural (trava + checagem),
  não declarativa. No L2 avaliar coluna/índice que a torne constraint.
- A trava `FOR UPDATE` no `"Lote"` legado bloqueia por milissegundos um update
  concorrente do mesmo lote durante a ENTRADA do ledger. É aceitável, porque o
  ledger fica desligado para usuários até o L2.
- Nascimento, reversão e mudança de categoria não têm evento no L1: a
  reconciliação bloqueia o backfill enquanto existirem.
- Dados reais nunca foram lidos. Os resultados são de fixtures que reproduzem
  o padrão relatado.
- R3 é mais restritiva: lotes legados sem `categoria_manejo_entrada_id` terão
  as transferências em quarentena até existir categoria no evento ou um
  mapeamento revisado. Isso é intencional: o backfill fica bloqueado.
- `apto_para_backfill === true` é condição necessária, não suficiente.
- R4: o manifesto é declaração de quem extraiu, não prova criptográfica.
  Detecta recorte acidental, não um manifesto escrito para combinar com um
  dump errado. A extração continua sujeita a revisão humana (runbook §7.1).
- R5: linha sem `cliente_id` agora **bloqueia** (antes, na R4, só avisava).
  Tenant correto em toda linha prova que o arquivo não mistura tenants. Não
  prova que o export está completo: isso continua sendo a declaração de
  contagens.

## Próximos passos L2 (após merge da #145; nada automático)

1. Rebase supervisionado.
2. Models/migration Prisma com FKs tenant-aware.
3. Grants/RLS.
4. API autenticada + `errorCodes.js`.
5. E2E real.
6. Export/backup.
7. Reconciliação com dump autorizado.
8. **Aprovação manual** de backfill/cutover.
9. Escrita sombra atômica; ledger desligado até os gates de paridade e
   rollback.
10. Correção de self-target (§8 do contrato).
11. Registrar em `DECISIONS.md` / `CURRENT-STATE.md` no rebase.
