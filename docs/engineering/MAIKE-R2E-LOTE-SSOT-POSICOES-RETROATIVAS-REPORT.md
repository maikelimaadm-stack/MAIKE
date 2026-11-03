# MAIKE-R2E-P1 — Cadastro × posições × movimentações, transferência retroativa (D-PROD-107)

- **Base:** main `f7a8ea3` (merge da #173; contém #172 e #169).
- **Branch:** `claude/r2e-p1-lotes-posicoes-movimentos-retroativos`.
- **PR:** uma, em DRAFT.
- **Decisão:** D-PROD-107. A D-PROD-106 já é da #173, mergeada; nada foi renumerado.

**Escopo desta fase (honesto):**
- o modelo novo (ledger + posições + cadastro separado) está implementado e ativo por empresa;
- a TRANSFERÊNCIA (total, parcial, multi-posição, retroativa, com cancelamento) roda no ledger, de ponta a ponta, com UI;
- as demais operações pecuárias ficam fail-closed na empresa ativada até serem portadas;
- empresas não ativadas seguem no modelo legado, sem mudança de comportamento (fase expand).

## 1. RED (main f7a8ea3, PostgreSQL local, HTTP autenticado)

Evidência: `evidencias/r2e-p1-lotes-ssot/red-main.txt` (`R2E_RED=1`).

| Caso | Main |
|---|---|
| R1: 500 em A; 100 A→B no dia 02, depois 100 no dia 01 | 201/201, mas o `Lote` ganha 2 linhas `MOVIMENTAÇÃO` (3 no cadastro). A tela (`existeLancamentoPosterior`) recusaria o dia 01. |
| R2: segunda transferência no MESMO dia 02 | a tela acusa "posterior" (data `AAAA-MM-DD` = meia-noite × `T12:00Z` gravado) |
| R3: B recebeu no dia 05; B→C no dia 01 | 201: o servidor só olha o saldo de hoje |

## 2. Modelo (diagrama textual)

```
Lote (cadastro de ENTRADA)              1 ─┐
  quantidade_entrada, data/área de entrada  │ lote_entrada_id (FK composta)
                                            ▼
PosicaoRebanho (projeção do saldo)      N ─── área (FK composta), empresa (FK)
  chave_identidade = [lote_entrada_id, categoria, sexo, categoria_manejo_id]
  quantidade_cabecas = Σ partidas ativas (CHECK ≥ 0)
  linhagem [{lote_id, nome, numero_lote, classe}]
            ▲ posicao_id
PartidaRebanho (delta por dia)          N ── evento_id ──► EventoRebanho (fato imutável)
  data_operacional, delta (CHECK ≠ 0), ativa             tipo SALDO_ABERTURA|ENTRADA|TRANSFERENCIA
                                                          data_operacional, registrado_em, autor,
                                                          operation_id, situacao, cancelado_*,
                                                          movimentacao_id → MovimentacaoMapa (histórico)
RebanhoLedgerAtivacao (empresa, data_corte)
```

**Índices e constraints:**
- `PosicaoRebanho`:
  - `@@unique(cliente_id, empresa_id, area_id, chave_identidade)`;
  - `@@index(cliente_id, empresa_id, area_id)`;
  - `@@index(cliente_id, lote_entrada_id)`.
- `PartidaRebanho`:
  - `@@index(cliente_id, posicao_id, data_operacional)` (linha do tempo);
  - `@@index(cliente_id, evento_id)`.
- `EventoRebanho`:
  - `@@unique(cliente_id, empresa_id, tipo, operation_id)`;
  - `@@index(cliente_id, empresa_id, data_operacional)`;
  - `@@index(cliente_id, movimentacao_id)`.
- CHECKs: `PosicaoRebanho_quantidade_nao_negativa`, `PosicaoRebanho_peso_positivo`, `PartidaRebanho_delta_nao_zero`, `EventoRebanho_situacao_valida`, `EventoRebanho_tipo_valido`, `EventoRebanho_cancelamento_coerente`.
- Todas as FKs são compostas com `cliente_id` e `ON DELETE RESTRICT`.
- Supabase: REVOKE anon/authenticated, RLS sem FORCE e política só `maike_vercel`, no padrão D-PROD-56.

## 3. Mapa antigo → novo

| Item | Antes | Agora (empresa ativada) |
|---|---|---|
| Saldo por área | `Lote.quantidade_cabecas` + `area_atual_id` | `PosicaoRebanho` (projeção de `PartidaRebanho`) |
| Transferência parcial | `inserirLote` com `origem: 'MOVIMENTAÇÃO'` | partidas −q/+q entre posições; **0 linhas em `Lote`** |
| Ordem temporal | navegador (`validarOrdemTemporalLote(s)`, teto 200) | servidor, fim de dia ≥ 0 em toda a linha do tempo, sem teto |
| Cancelamento da transferência | snapshot/auditoria de `Lote` | desativa partidas + revalida o futuro (409 com data) |
| Cadastro | Lote com saldo vivo | Lote = entrada; PATCH de saldo/área/status/data → 409 |
| Mapa (`mapaCacheService.lotes`) | `GET /lotes` | `GET /rebanho/posicoes` (posições com a forma de lote, `__posicao`) |
| Mover (DetalhesLote) | laço `manejo-lote` por lote + caminho offline POST/PATCH | `POST /rebanho/comandos/transferencia` uma vez, chave por diálogo |
| Morte/Abate/Nascimento/Pesagem/Mudança/Junção/Baixa | comandos R2A–R2D sobre `Lote` | **fail-closed** 409 `REBANHO_LEDGER_OPERACAO_NAO_MIGRADA`; a tela recusa antes de abrir |
| Histórico | `MovimentacaoMapa` | mesmo (ponte `rebanho_ledger` + `evento_id`); por entrada, por posição e por área |

**APIs novas:**
- `GET /rebanho/posicoes?empresa_id`
- `GET /rebanho/saldos?empresa_id&data=AAAA-MM-DD[&area_id]` (saldo em data passada)
- `GET /rebanho/verificacao?empresa_id` (reconciliação)
- `POST /rebanho/ativacao`
- `POST /rebanho/comandos/transferencia`

## 4. Testes (`r2eP1LedgerRebanho.test.mjs`, 21/21)

| Caso | Resultado |
|---|---|
| L1: exemplo obrigatório | 500 → 400/100 → (dia 01 depois) 300/200; `Lote` 1 linha (entrada 500); 2 eventos; 1 posição em B; saldo em 31/10, 01/11 e 02/11 conferido; 450 no dia 01 → 409 `data=2026-11-01, PASTO A, disponível 400, pedido 450`, nada gravado |
| L2: A=320/B=150/C=30 com retorno | 02 A→B 100; 01 A→B 100 lançado depois; 03 B→C 50; 04 C→A 20. O retorno cai na mesma posição de A. Replay não grava; mesma chave com outro conteúdo → 409 |
| L3: saldo histórico | origem sem estoque na data (B dia 01) → 409 com disponível 0; retroativo que quebra o fato do dia 05 → 409 `2026-11-05`; o limite exato (400) passa |
| L4: mesmo dia | 4 transferências no dia 02 com horas distintas e sem hora; B→C→A no mesmo dia (fim de dia) |
| L5: duas entradas homônimas | duas linhagens separadas no destino, peso desconhecido continua `null` |
| L6: contrato e isolamento | data impossível ou com lixo → 400; antes do corte → 409; mesmo destino → 409; área de outra empresa → 404; posição de outro tenant → 404; campos forjados → 400; sem token → 401 |
| X1: cancelamento | dependente → 409 com data (elegibilidade igual); não admin → 403; replay; segundo → `JA_REALIZADO`; cancela o posterior e depois o anterior; histórico rotulado em A, B, entrada e posição; partidas preservadas |
| X2: cadastro | PATCH de saldo/área/status/categoria/data → 409; nome propaga; DELETE com movimento → 409; depois do cancelamento → tombstone, posição 0 |
| X3: fail-closed | 5 comandos legados → 409 sem gravar; a empresa legada segue funcionando |
| X4: ativação | abertura das linhas legadas (inclusive derivada) sem tocar `Lote`; só admin; corte anterior ao histórico, lote sem área ou data impossível → recusa; segunda ativação → 409 |
| R1: rollback | falha após validar, após evento, após 1ª partida, após reprojeção e antes da auditoria → ZERO mudança em lotes, posições, eventos, partidas, movimentos, auditorias e reservas |
| V1: volume | 2.000+ partidas na mesma posição com 20 canceladas no meio; retroativo validado em ~34 ms; EXPLAIN com Index Scan no índice da linha do tempo |
| K1–K3 × 3 rodadas | duas transferências disputando a mesma origem; A→B × B→A; cancelamento × uso das mesmas cabeças; mesma chave em paralelo; entrada × transferência; DELETE × transferência. Sem deadlock, sem 500, total conservado, verificação íntegra |

**Outras provas:**
- Smoke `r2eLedgerRebanho.test.js` (11): corpo, envio offline, chave, mensagem, mapa, DetalhesLote, duplo toque, histórico.
- Compatibilidade expand: as suítes R2D, R2C e R2A da **main** passam 108/108 contra o banco com a migration aplicada (`compatibilidade-backend-antigo.txt`).
- Scripts do SQL Editor (reset/limpeza) cientes das 4 tabelas: 17/17 nos testes deles.

## 5. E2E Chromium (Web) — 1440 / 768 / 412 / 390: 80/80

Banco demo descartável clonado (`maike_demo_r2e`), ledger ativado com corte 2026-12-15: 218 posições, 40.402 cabeças de abertura, verificação íntegra.

Por largura:
- cadastro de um lote na área A;
- **transferência no dia 20 com duplo toque** → 1 POST, sem `manejo-lote`, PATCH/POST `/lotes` ou POST genérico;
- **transferência no dia 18 lançada depois** → aceita; a mesma entrada fica em 2 posições, nenhum lote novo;
- **dia 19 a partir de B** (B tinha menos naquele dia) → 409 na tela: "Saldo insuficiente em PASTO B no dia 19/12/2026. Disponível na data: X cab; pedido: Y cab. Nada foi gravado.", com o diálogo aberto e nada alterado;
- área B pelo mapa com a posição;
- Morte → recusa clara sem requisição;
- histórico de B e **cancelamento do dia 18 pela UI** (A e B voltam; o dia 20 fica);
- Cadastro de Lotes com a entrada original;
- offline → "Sem conexão", sem requisição de escrita;
- sem overflow e sem erro de página.

Ao final, a verificação deu 251 posições, 0 divergências, 0 dias negativos e 0 Lote `MOVIMENTAÇÃO` criado após a ativação.

**Achados do E2E corrigidos nesta PR:**
- duplo toque no celular gerava 2 transferências: chave por diálogo + trava síncrona + `mutateAsync`;
- offline o React Query pausava a mutação e o botão travava em "Movimentando…": recusa antes;
- o histórico não reconhecia a proveniência do ledger;
- o 409 lia os `details` no lugar errado.

**Safari real não foi testado:** Chromium com emulação de toque não substitui iOS.

## 6. Migrations

| Ambiente | Status |
|---|---|
| PostgreSQL local (`maike_ci`, `maike_demo`, clone `maike_demo_r2e`) | `LOCAL_APPLIED`: do zero, `migrate status` em dia, `migrate diff` sem drift, reaplicação idempotente pelo `migrate deploy` |
| Supabase/produção | `REMOTE_MIGRATION_BLOCKED`: este container não tem `MIGRATION_DATABASE_URL` nem `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER`. Nada foi lido, escrito ou alterado remotamente. A barreira `deploy:migrate` aplica a migration no pre-deploy da publicação. É EXPAND (só tabelas novas), então o backend antigo segue íntegro. |
| Cutover remoto | não executado: depende do merge e da ativação por empresa (`POST /rebanho/ativacao`, admin) depois do deploy |
| Contract (remover colunas operacionais de `Lote`) | não executado: só depois de portar todas as operações e de a versão nova estar comprovada em produção |

**Plano de ativação pós-merge:**
1. Deploy: o pre-deploy aplica a migration.
2. `GET /rebanho/verificacao` em empresa ainda não ativada → `posicoes: 0`.
3. Escolher o corte ≥ último movimento ativo.
4. `POST /rebanho/ativacao`.
5. `GET /rebanho/verificacao` → `integro: true`, total = soma dos lotes ativos.
6. Rollback lógico: não há "desativar" (fatos novos vivem só no ledger). Por isso a ativação deve ser feita primeiro numa empresa de teste.

## 7. Riscos residuais e próximos slices

- **Operações não migradas** ficam indisponíveis na empresa ativada (fail-closed): Morte/Abate (R2D), Nascimento, Pesagem, Mudança de Categoria e Junção. O próximo slice porta cada uma ao ledger: baixa por posição; nascimento como `ENTRADA` sem compra; pesagem como atributo; mudança e junção como partidas entre posições, com `linhagem` de contribuições.
- **Suplementação, tarefas, sanitário e indicadores** ainda citam `lote_id`. No mapa ativado, o `id` exibido é o da POSIÇÃO. Sobras de cocho na mesma confirmação da transferência recusam antes de enviar.
- **Peso** é atributo atual da posição, não historiado: transferência retroativa não recalcula pesos passados.
- **Ativação** não tem desfazer automático; recomenda-se ativar primeiro uma empresa de teste.
- **Safari real** não foi testado.

---

# PR174-R1 — Ledger integral: cadastro, posições, TODOS os manejos, cancelamentos e cutover (complemento da D-PROD-107)

**Mesma PR, mesma branch.**
- HEAD auditado: `0187cdd`.
- Base: main `f7a8ea3`, sem mudança.
- Commits: `6715739` (ondas A/B), `bbc0a2f` (B: saldo na data + matriz + SQL Editor) e o commit desta entrega (C: UI, vínculos, sobras, reset, E2E, docs).

As seções 1–7 acima descrevem a R2E-P1. Onde dizem "fail-closed", "fora desta fase" ou "operações não migradas", **esta seção as substitui**.

## R1.1 Achados da auditoria → RED → GREEN

| # | Achado | RED em `0187cdd` | Correção | GREEN |
|---|---|---|---|---|
| A | Lote derivado vira entrada própria na ativação | falhou | linhagem rastreada pela movimentação certificada; `derivado_rastreado` herda a entrada raiz; sem prova → `legado:<id>` | `r2eR1Achados` |
| B | Cancelar movimento legado em empresa ativada muta `Lote` (drift) | falhou | 409 `REBANHO_LEDGER_CANCELAMENTO_LEGADO` (cancelamento e elegibilidade) | `r2eR1Achados` |
| C | Novos tipos exigiriam editar a migration aplicada | — | migration nova `20261103100000_rebanho_ledger_r1_manejos` (expand) | `migrate diff` sem drift |
| D | Manejos fail-closed | falhou | os mesmos endpoints delegam ao ledger | `r2eR1ManejosLedger` 13/13 |
| E | Corte impede retroatividade até a entrada | falhou | `modo: 'entradas'` + reset controlado de teste | `r2eR1Achados`, `r2eR1ResetTeste` 2/2 |
| F | IDs de posição gravados como `lote_id`; peso sem histórico; sobras desligadas | falhou | `posicao_id` + `lote_id` = entrada; `PesoRebanho`; sobras como passo separado | `r2eR1Achados`, smoke |
| G | Honestidade remota | — | matriz R1.6 | — |

Evidência RED: `evidencias/r2e-p1-lotes-ssot/r1-integracao-completa/red-head-0187cdd.txt` (5/5 falharam no HEAD auditado).

## R1.2 Matriz de operações (empresa ativada)

| Operação | Endpoint | Ledger | Retroativo | Cancelamento | `Lote` escrito? |
|---|---|---|---|---|---|
| Entrada (cadastro) | `POST /lotes` | evento ENTRADA + peso | data_entrada | exclusão #167 | só o cadastro |
| Transferência (total/parcial/multi) | `/rebanho/comandos/transferencia` e R2A `manejo-lote` | sim | sim | sim | não |
| Morte / Abate (multi-categoria) | `comandos/baixa-rebanho` e R2A | sim | sim (saldo NA DATA) | sim | não |
| Nascimento | `comandos/manejo-rebanho` | posição `nascimento` | sim | sim | não |
| Pesagem | `comandos/manejo-rebanho` | série `PesoRebanho` | sim | sim | não |
| Mudança de Categoria | `comandos/manejo-rebanho` | −/+ na linhagem | sim | sim | não |
| Junção (1/5/20 origens) | `comandos/juncao-lotes` | contribuições na linhagem | sim | sim | não |
| Sobras do cocho na transferência | suplementação (passo 2) | `posicao_id` + entrada | — | documento | não |
| Tarefa / suplementação / sanidade | documentos | `posicao_id` + `lote_id` = entrada | — | — | não |
| Renomear | Cadastro de Lotes | o nome é do cadastro | — | — | só o nome |

## R1.3 Testes

**Backend PostgreSQL + HTTP:** `test:backend` 864 testes, 859 pass, 0 fail, 5 todo.
- Ledger: P1 21, R1 achados 5, R1 manejos 13 (39/39), reset 2/2.
- Concorrência: 3 rodadas.
- Tenant isolado.
- Rollback por falha injetada em 3 passos, com zero mudança.
- R2A/R2B/R2C/R2D legados seguem verdes nas empresas não ativadas.
- SQL Editor 17/17, cientes de `PesoRebanho` e da FK tarefa→posição; 58 tabelas.

**Smoke:** 1250/1250.

**`verify:all`:** TODAS AS ETAPAS PASSARAM (`verify-all.txt`).

**E2E Chromium**, `e2e-todas-operacoes-*.txt`, script `e2e-todas-operacoes.cjs`: 1440/768/412/390 = **124/124**. Por resolução, pela UI e sobre posições:
- transferência;
- morte;
- abate retroativo;
- mudança;
- pesagem;
- junção;
- nascimento;
- recusa retroativa;
- histórico + cancelamento;
- offline sem envio.

Em todas: Cadastro (`Lote`) intacto, `verificacao.integro` e conservação, sem overflow e sem erro de página.

**Achado do próprio E2E:** um total igual em duas áreas abria a área errada no clique. O roteiro passou a confirmar o nome da área; o app estava correto.

## R1.4 Cutover / runbook (pós-merge, NÃO executado)

1. Deploy. O pre-deploy `deploy:migrate` aplica as 2 migrations expand. Só `MIGRATION_DATABASE_URL` (5432 session/direct) + `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER`.
2. Empresa de TESTE com histórico legado:
   1. `reset-rebanho-empresa-teste.mjs` em simulação;
   2. depois `--executar --confirmar-empresa "<nome>" --backup <arquivo>`;
   3. `POST /rebanho/ativacao {modo:'entradas'}`;
   4. `GET /rebanho/verificacao` → `integro: true`.
3. Empresa real: `modo: 'saldo_abertura'` com corte ≥ último movimento legado ativo. O reset não se aplica.
4. Rollback: não há desativação (os fatos vivem no ledger). Reverter o deploy mantém o banco expand compatível, e a empresa ativada fica sem manejo no backend antigo. Ativar primeiro uma empresa de teste.
5. Contract (remover colunas operacionais de `Lote`): só depois de produção estável.

## R1.5 Riscos residuais

- **Peso na junção:** as linhas da ponte de histórico registram `peso_medio_kg: null` por origem; a série `PesoRebanho` do principal está correta.
- **"Pesar depois da movimentação":** o atalho do fluxo legado não é oferecido no ledger. A pesagem é pelo menu Pesar.
- **Indicadores e relatórios** que agregam por `lote_id` passam a ver a entrada; quem precisar da posição usa `posicao_id`.
- **Safari real** não foi testado.

## R1.6 Estado de migração e deploy (cada item com evidência)

| Item | Estado | Evidência |
|---|---|---|
| LOCAL_SCHEMA_APPLIED | SIM | `maike_ci`, `maike_demo`, `maike_demo_r2e`: upgrade pelo `migrate deploy`; zero→upgrade nos testes; `migrate diff` vazio |
| LOCAL_DATA_MIGRATED | SIM | `maike_demo_r2e` ativado (saldo_abertura) e E2E de todas as operações; `modo: entradas` e reset provados em PG |
| REMOTE_EXPAND_APPLIED | BLOCKED | container sem `MIGRATION_DATABASE_URL` e `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER`; nada foi lido nem escrito remotamente (REMOTE_MIGRATION_BLOCKED) |
| REMOTE_DATA_MIGRATED | NÃO | depende do deploy; ativação proibida antes do merge |
| REMOTE_CUTOVER_APPLIED | NÃO | idem |
| REMOTE_CLEANUP_APPLIED | NÃO | reset remoto só pós-deploy, com backup |
| PRODUCTION_DEPLOYED | NÃO | PR em DRAFT, sem merge |

---

# PR174-R2 — Fechamento: reset × idempotência, POST genérico, peso causal (complemento da D-PROD-107)

**Mesma PR (#174, DRAFT) e mesma branch.**
- HEAD auditado: `84d0ad5`; CI `verify:all` SUCCESS, run 41501344126.
- Base: main `f7a8ea3`, sem mudança (nada a incorporar).
- Nenhuma outra PR aberta.
- Sem migration nova; nenhuma editada.
- Evidências: `evidencias/r2e-p1-lotes-ssot/r2-fechamento/`.

> Ambiente: o container foi reciclado durante a missão e o PostgreSQL local voltou vazio. O banco descartável `maike_ci` foi recriado (`migrate deploy` do zero) com `maike_ci` superusuário, como no CI; sem isso, o laboratório P8 de grants não cria papéis. O E2E roda num banco descartável próprio, `maike_e2e_r2`: tenant demo, 30 áreas com polígono, empresa ativada pelo endpoint oficial em `modo: 'entradas'`.

## R2.1 RED → GREEN (`backend/tests/r2eR2Fechamento.test.mjs`)

| # | Achado | RED no `84d0ad5` | Correção | GREEN |
|---|---|---|---|---|
| A1 | Replay da mesma chave após o reset | 201 `replay:true` com movimento apagado | reserva → `desfeito`; 409 `IDEMPOTENCY_EFEITO_DESFEITO`; outra empresa/tenant seguem com replay | ok |
| A2 | Documento citando derivado ou movimento apagado | reset prosseguia | 409 fechado `RESET_VINCULOS_PENDENTES` com a lista; nada muda | ok |
| A3 | Reexecução e auditoria | sem campos de rastreio | no-op real; AuditLog anterior intacto; o do reset cita movimentos e chaves | ok |
| A4 | Concorrência reset × comando (3×) | — | movimento existe ⇔ reserva `committed` | ok |
| B1 | POST genérico material em empresa ativada | 201 sem partida | 409 `REBANHO_LEDGER_SOMENTE_POR_COMANDO` (9 tipos × cadastro/posição, outra empresa no corpo, alias pecuária, lote via service); junção e renomear preservados | ok |
| B2 | Empresa legada | — | POST genérico aprovado intacto; PATCH/DELETE seguem 409 | ok |
| B3 | Concorrência ativação × POST (3×) | — | nunca os dois aceitos (Empresa `FOR UPDATE`/`FOR SHARE`) | ok |
| C1 | Cancelar pesagem que alimentou transferência | 200; B ficava 500 com A de volta a 400 | 409 causal (evento/posição/data/500→400); ordem inversa funciona | ok |
| C2 | Pesagem retroativa antes da transferência | 201 | 409; posterior (outro dia ou mesmo dia registrada depois) passa | ok |
| C3 | Transferir dia 02 e depois dia 01, mesmo peso | — | aceito (fluxo principal intacto) | ok |
| C4 | Cancelar junção com peso usado depois; cadeia A→B→A | 200 | 409 causal; saldo e peso protegem a cadeia; ordem inversa funciona | ok |
| C5 | Origem sem peso | — | destino `null` (nunca 0); retroativo que o tornaria conhecido → 409 | ok |
| C6 | Concorrência cancelar pesagem × transferência (3×) | B incoerente | B sempre coerente com A na data | ok |
| C7 | Mesmo dia: pesagem antes da transferência | — | desempate pela ordem de registro; cancelar → 409 | ok |
| C8 | Falha injetada após a verificação causal | — | zero mudança, inclusive na reserva idempotente | ok |

## R2.2 Matriz do POST genérico

| Caminho | Empresa ativada | Empresa legada |
|---|---|---|
| `POST /movimentacoes-mapa` com tipo material (Transferência, Morte, Abate, Nascimento, Pesagem, Mudança, Entrada artificial, Saída, Venda) | 409 `REBANHO_LEDGER_SOMENTE_POR_COMANDO`, nada gravado/auditado | 201 (aprovado) |
| idem com id de POSIÇÃO, ou `empresa_id` de outra empresa | 409 (empresa do lote/posição citado) | — |
| `Junção de Lotes` | 409 `JUNCAO_SOMENTE_POR_COMANDO` | 409 idem |
| `Entrada` + `Renomear Lote` (informativo) | 201 | 201 |
| `POST /movimentacoes-pecuaria` (alias) | 409 | 201 |
| `criarEmLote` (service; não há rota HTTP de lote, `/bulk` → 404) | lança 409, nada gravado | grava |
| PATCH/DELETE genéricos | 409 (R2A) | 409 (R2A) |
| Campos reservados (`lote_ids`, `lote_destino_id`, `efeito_servidor`…) | 400 (R2A) | 400 (R2A) |

## R2.3 Peso causal: regra e desempate

- **Peso derivado:**
  - `peso(D, F) = média ponderada([(saldo de D antes de F, peso de D antes de F)] + entradas)`;
  - cada entrada é `(q, peso da origem antes de F)` ou `(q, peso informado)`;
  - qualquer peso desconhecido com cabeças → `null`.
- **Antes de F:** data menor, ou mesma data e `(registrado_em, id)` menor. `registrado_em` = `clock_timestamp()` depois das travas.
- **Reconferência:** toda mudança (manejo novo, retroativo ou cancelamento) reconfere os fatos derivados ativos de `data ≥ data da mudança` que têm partida nas posições tocadas. Divergência → 409 causal.
- **Não bloqueia:**
  - pesagem posterior independente;
  - retroativo que não muda o valor calculado;
  - fatos de outra linhagem (posição própria).

## R2.4 Regressões, gates e E2E

- **Ledger completo** (P1, R1 achados, R1 manejos, reset, R2): **56/56**. Inclui junção 1/5/20, nascimentos, transferências retroativas, cancelamentos, série de peso, K1 concorrência 3× e M3/C8 com falha injetada.
- **`test:backend`** (código R2 antes dos ajustes finais de UI/junção/trava): 877 testes, 868 pass, 0 fail, 5 todo, 4 cancelados.
  - Os 4 cancelados eram o laboratório P8, que falhou só por permissão do papel local recriado (`permission denied to create role`).
  - Com `maike_ci` superusuário, como no CI, o P8 dá 4/4.
  - O `verify:all` final reexecuta tudo.
- **Smoke** inclui mensagens novas de recusa com data e pesos.
- **E2E Chromium** (`e2e-1440/768/412/390.txt`): **136/136**. Por largura:
  - transferência dia 20 e depois a retroativa do dia 18;
  - morte, abate retroativo, mudança, pesagem, junção e nascimento;
  - recusa retroativa (morte em B antes do gado chegar);
  - histórico com cancelamento;
  - **cancelar pela UI a pesagem que alimentou a junção → recusa causal na pré-checagem, com a data, sem campo de motivo e sem POST**;
  - offline sem envio; Cadastro intacto; verificação íntegra; sem overflow e sem erro de página.
  - Chromium mobile não é Safari real.
- **Reset só por script local:** a UI não tem reset (0 referências em `src/`). A simulação contra a empresa ativada do fixture → `RECUSADO LEDGER_JA_ATIVO`, exit 3 (`reset-somente-script.txt`).

## R2.5 Estado de migração e deploy

| Item | Estado | Evidência |
|---|---|---|
| LOCAL_SCHEMA_APPLIED | SIM | `maike_ci` e `maike_e2e_r2` do zero; validate ok; status em dia; diff vazio (`migrations-e-deploy.txt`) |
| LOCAL_DATA_MIGRATED | SIM | fixture E2E ativado (entradas); testes PG de reset, ativação e manejos |
| REMOTE_EXPAND_APPLIED | BLOCKED | 0 variáveis `MIGRATION_*` no container (REMOTE_MIGRATION_BLOCKED); nada remoto lido ou escrito |
| REMOTE_DATA_MIGRATED | NÃO | ativação só depois do merge e do deploy, em empresa de teste primeiro |
| REMOTE_CUTOVER_APPLIED | NÃO | idem |
| REMOTE_CLEANUP_APPLIED | NÃO | reset remoto só com alvo comprovado, backup e confirmação, depois do deploy |
| PRODUCTION_DEPLOYED | NÃO | PR em DRAFT, sem merge |

## R2.6 Riscos residuais

- **Recusa causal × flexibilidade:** cancelar um fato antigo com dependentes de peso exige desfazer os posteriores na ordem inversa. É seguro, mas trabalhoso. O replay automático da série fica como evolução possível.
- **Eventos sem descritor:** os de antes do R2, só em bancos locais, não são reconferidos. Em produção não existem (nada foi ativado).
- **Varredura de vínculos do reset:** procura ids exatos nas fontes listadas. Fontes futuras precisam entrar na lista; o teste A2 é o guarda.
- **Ordem no mesmo dia:** depende do relógio do banco. Com várias instâncias do app, o relógio é o do PostgreSQL, então é único.

---

# PR174-R3 — Integridade de fatos sem delta e renomeação de formato fechado (complemento da D-PROD-107)

**Mesma PR (#174, DRAFT), mesma branch.** HEAD auditado `ce1ab5b` (CI SUCCESS, run 41520484347); base main `f7a8ea3`, inalterada. Sem migration nova. Evidências: `evidencias/r2e-p1-lotes-ssot/r3-integridade-fatos/`.

## R3.1 RED → GREEN (`backend/tests/r2eR3IntegridadeFatos.test.mjs`)

| # | Hipótese | RED no `ce1ab5b` | GREEN |
|---|---|---|---|
| P1.1 | 100 em A; pesagem dia 05; depois transferência TOTAL A→B no dia 01 | 201 (pesagem ficava numa posição vazia) | 409 `REBANHO_DEPENDENCIA_FATO_SEM_SALDO` (evento, PESAGEM, data, posição, área, `saldo_no_fato: 0`); nada gravado |
| P1.3 | morte, abate e mudança retroativos que zeram a posição pesada | 201 | 409; cancelada a pesagem, a morte passa |
| P1.5 | cancelar a transferência de volta que sustentava a pesagem | 200 | 409 (o cancelamento também é guardado) |
| P2.1 | 20 vacas; nascimento dia 05; depois todas as vacas A→B no dia 01 | 201 | 409 (NASCIMENTO, `posicao_ids` maternas, área, data) |
| P2.2 | várias posições maternas | remover todas → 201 | remover uma com outra certificada presente → 201; remover todas (transferência ou morte) → 409; nascimento cancelado não bloqueia |
| P2.3 | vacas de outra posição chegando depois | 201 | não "salvam" o nascimento: 409 |
| P3.1 | `Entrada` + `Renomear Lote` com quantidade, áreas, categoria ou peso, ou `lote_id` de posição | 201 | 409 `REBANHO_LEDGER_SOMENTE_POR_COMANDO` (unitário e lote); renomeação real → 201 |
| I1 | renomeação com `lote_id` de OUTRO tenant | 201 (achado novo) | 4xx, nada gravado |

**Controles verdes antes e depois:**
- saída parcial que deixa cabeças;
- retirada de outra posição;
- pesagem de outra área;
- mesmo dia: pesagem registrada antes da transferência total → aceita (ordem de registro); pesagem registrada depois, na posição vazia → recusa na criação;
- empresa legada aceita a renomeação antiga com quantidade.

## R3.2 Contrato temporal

- **Saldo "no fato" F:** soma das partidas ativas com data < data(F), ou data = data(F) e `(registrado_em, id)` anterior ao de F. `registrado_em` é o `clock_timestamp()` do banco, depois das travas.
- **Não existe exigência de ordem de LANÇAMENTO entre dias:** retroativos continuam livres quando não violam nada.
- **PESAGEM:** cada posição pesada com saldo > 0 no fato.
- **NASCIMENTO:** em cada linha, Σ (saldo no fato das `maes_posicao_ids` certificadas) > 0.
- **Guarda única** `verificarDependenciasTemporais` (peso causal R2 + pré-condições R3): transação do comando, depois das travas. Cobre transferência, baixa, nascimento, pesagem, mudança, junção e cancelamento.
- **Verificação:** `GET /rebanho/verificacao` → `precondicoes_violadas` e `integro: false` quando houver violação. Prova V1: fixture corrompido por fora do motor, só leitura.

## R3.3 Caso do proprietário, concorrência, idempotência, tenant

- **D2:** 500 em A; A→B 100 no dia 02; depois A→B 100 no dia 01 → 300/200. 1 Lote (sem derivado); peso 400 em B; conservação 500/500.
- **Concorrência 3×:**
  - K1 (transferência retroativa × pesagem) e K2 (transferência retroativa × nascimento): nunca os dois aceitos, sem 500, verificação íntegra;
  - A4, B3 e C6 (R2) continuam verdes.
- **I1:** recusa não reserva chave; o reenvio da mesma chave dá a mesma recusa, sem duplicar.

## R3.4 Regressões, E2E e gates

- **Ledger completo** (R3 15 + R2 15 + P1 + R1 + manejos + reset): **71/71**.
- **E2E Chromium 1440/768/412/390: 144/144** (36 por largura). Cobre o fluxo R2 inteiro mais a **morte retroativa das matrizes antes do nascimento**: a tela mostra "O nascimento do dia 21/12/2026 ficaria sem as matrizes…", o diálogo continua aberto e nada é gravado. Safari real não foi testado.
- **Smoke:** mensagens novas com tipo e data.
- **`verify:all` local no `e58771d`:** TODAS AS ETAPAS PASSARAM. test:backend 894 testes, 889 pass, 0 fail, 5 todo; smoke 1253/1253; lint, tipos, build e gates verdes (`verify-all-local.txt`).
- **Dois vermelhos de CI no caminho, ambos corrigidos na PR:**
  - `0cf1527`: JSDoc de `violacoesDePrecondicao` no `typecheck:backend`;
  - `006abd8`: o teste R2D D2 tinha data fixa `2026-11-02` e o registro sem data conta pelo `createdAt`. Com a virada do relógio para 03/11 a recusa ficou correta e o teste, errado. Passou a usar a data de hoje, sem afrouxar a asserção. A bomba-relógio existe também na main.
- O CI no SHA final é o gate de aceitação.

## R3.5 Migrations e deploy

| Item | Estado |
|---|---|
| Migration nova | NÃO (0 arquivos em `backend/prisma/` desde `ce1ab5b`) |
| Local (`maike_ci`) | validate ok; status "up to date"; `migrate diff --exit-code` = 0 |
| REMOTE_EXPAND_APPLIED | BLOCKED — 0 variáveis `MIGRATION_*` no container; nada remoto lido ou escrito |
| Ativação, reset ou cutover remoto | NÃO executado (proibido antes do merge) |
| PRODUCTION_DEPLOYED | NÃO |

## R3.6 Riscos residuais

- **Outros fatos sem delta:** foram revisados os demais tipos. Entrada e saldo de abertura têm partida; baixa, mudança, junção e transferência têm delta e passam pela regra de saldo. Hoje não há outro fato sem delta com pré-condição.
- **Vínculo materno:** depende de `maes_posicao_ids` gravados pelo servidor na ponte. Ponte ausente (não ocorre pelos comandos) = linha sem pré-condição verificável.
- **Ordem no mesmo dia:** é a de registro no banco; comandos simultâneos são serializados pelas travas de área e posição.

---

# PR174-R4 — Três responsabilidades (Lote = entrada · PosicaoRebanho = estado atual · MovimentacaoMapa = histórico)

Mesma PR (#174, DRAFT). HEAD inicial: `9f7fca7`. Evidências em `evidencias/r2e-p1-lotes-ssot/r4-tres-responsabilidades/`. A decisão por tabela física está na D-PROD-107 (complemento R4).

## R4.1 Fonte da verdade por dado

| Dado | Fonte | Observação |
|---|---|---|
| Entrada original | `Lote` | só cadastro de origem; nenhum manejo cria nem altera (empresa ativada); no legado, nenhum manejo cria |
| Estado atual (área, cabeças, categoria, sexo, peso, nome, linhagem) | `PosicaoRebanho` | proveniência da entrada (raça, sistema, data) exposta só para leitura |
| Histórico navegável de todos os manejos, inclusive pesagem | `MovimentacaoMapa` | 1 registro certificado por comando; `efeito_servidor.evento_id` ↔ `EventoRebanho.movimentacao_id` (1:1) |
| Saldo retroativo / cancelamento | `PartidaRebanho` (interna) | deltas indexados por posição e dia |
| Peso no tempo | `PesoRebanho` (índice interno) | única fonte canônica; o MovimentacaoMapa carrega anterior/novo como cópia de leitura |

## R4.2 RED → GREEN

RED no `9f7fca7`: a empresa legada fabricava registro no cadastro de entradas:
- L1: transferência parcial sem destino criava lote derivado → 201;
- L2: nascimento e mudança parcial criavam lote → 201;
- L3: `POST /lotes` com origem "Movimentação" → 201;
- C2: a posição pública não trazia a proveniência.

O contrato da empresa ativada já valia (C1).

GREEN (`r2eR4ContratoTresResponsabilidades`): **6/6**.
- **L1/L2/L3:** 409 `LOTE_CADASTRO_SOMENTE_ENTRADAS`, com nada gravado.
- **L4:** legado sem fabricação segue funcionando (total, morte).
- **C1 ponta a ponta:**
  - 500 → 300 A / 200 B, com a transferência do dia 02 lançada antes da do dia 01;
  - morte de 5 em B → 195;
  - pesagem de B → peso atual 431,5 na posição e registro "Pesagem" no histórico (posição, 400 → 431,5, 195 cab.);
  - nascimento sem Lote;
  - junção e cancelamento;
  - nº de Lotes = nº de entradas; Lote de 500 intacto;
  - 6 registros de histórico, 1:1 com os eventos internos.
- **C2:** a posição traz raça, sistema e data de entrada.

**Suítes legadas** (`conversao-suites-legadas.txt`): 38 testes convertidos, nenhum pulado, desligado ou apagado.
- A fabricação virou recusa provada.
- Os demais cenários usam destino de ENTRADA ou dado legado pré-existente simulado.

## R4.3 Frontend

- `DetalhesLote`: o fallback do navegador não chama mais `criarLote`. Sem lote igual no destino, mostra a recusa com mensagem própria.
- O erro do servidor `LOTE_CADASTRO_SOMENTE_ENTRADAS` aparece com mensagem clara.
- O Cadastro já listava só entradas (D-PROD-85); agora há smoke que trava isso.
- Mudança visual nenhuma, além da mensagem de recusa. Por isso o E2E não foi repetido (o fluxo do ledger não mudou).

## R4.4 Gates

`verify:all` local no `b7e057b`: TODAS AS ETAPAS PASSARAM.
- test:backend: 900 testes, 895 pass, 0 fail, 5 todo;
- smoke: 1255/1255;
- lint, tipos, build e gates: verdes.

## R4.5 Migrations

- Nenhuma migration nova.
- Local: em dia, sem drift.
- Remoto: BLOCKED (REMOTE_MIGRATION_BLOCKED), sem variáveis `MIGRATION_*`.
- Nada de ativação, reset ou deploy remoto.

## R4.6 Limitações e próximos passos

- **Empresa legada (pré-cutover):** manejos que não fabricam cadastro ainda escrevem o saldo nas colunas do Lote (snapshot legado). O fim desse modo é o cutover pós-merge: ativar cada empresa (teste primeiro) e, a partir daí, o Lote fica congelado.
- **Transferência parcial, nascimento e mudança parcial legados ficam indisponíveis até a ativação** da empresa. Mensagem: "peça ao administrador para ativar".
- **Consolidação física** de `EventoRebanho` e `PesoRebanho` em `MovimentacaoMapa`: só com migration aditiva, backfill e prova de equivalência (plano na D-PROD-107).
