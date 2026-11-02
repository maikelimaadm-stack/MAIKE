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
