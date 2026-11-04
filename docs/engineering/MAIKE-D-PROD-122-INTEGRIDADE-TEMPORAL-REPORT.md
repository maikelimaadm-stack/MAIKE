# D-PROD-122 — S1/H1: integridade temporal do rebanho

**Decisão:** [D-PROD-122](./DECISIONS.md)
**Base:** `origin/main` `f49004a1` (merge da #189)
**Escopo:** só o S1/H1. Ficam fora o H2 (ordem do histórico), o H4 (mensagens de bloqueio) e o H3 (categorias).
**Produção, Preview e Supabase:** nenhuma escrita e nenhuma conexão. Todos os testes rodaram em PostgreSQL 16 local com dados sintéticos.

## Problema (KM - 06, leitura do arquiteto em 04/11/2026)

Uma morte com data de 27/11, registrada em 04/11, entrou na projeção. Resultado: `PosicaoRebanho` mostrava 49 cabeças, contra 50 no saldo as-of de 04/11.

As causas, confirmadas no código:

1. `reprojetar()` soma todas as partidas ativas, sem corte de data.
2. Nenhum comando recusava data posterior a hoje. Havia só checagem de formato e o corte inferior (`REBANHO_ANTES_DO_CORTE`).
3. Não havia fuso da fazenda. O único "hoje" do backend era o dia UTC, usado na ativação sem entradas.

## O que mudou

| Peça | Arquivo | Efeito |
|---|---|---|
| Fuso da fazenda | `backend/prisma/schema.prisma`, migration `20261104200000_empresa_fuso_horario` | Coluna `Empresa.fuso_horario VARCHAR(64) NULL`, sem DEFAULT. EXPAND puro, também no manifesto do pré-merge. |
| Tempo da fazenda | `backend/src/modules/rebanhoLedger/rebanhoLedgerTempo.js` | `normalizarFusoIana` (Intl, canônico, offset recusado); `diaNoFuso`; `hojeDaEmpresa`, que falha fechado sem fuso; `exigirDiaNaoFuturo`; relógio de teste, só em `NODE_ENV=test`. |
| Guarda única | `rebanhoLedgerNucleo.js` → `exigirDiaNoLedger(tx, clienteId, ativacao, dia)` | Aplica corte e "hoje" em todo fato novo. Roda dentro da transação, depois da idempotência e antes de qualquer escrita. |
| Ativação | `rebanhoLedgerService.js` → `ativarEmpresaNaTransacao` | Valida `data_corte` (saldo de abertura) e o conjunto de entradas (modo entradas, com `details.lotes`). O corte informativo deixa de ser o dia UTC. |
| Erros estáveis | `errorCodes.js` | `REBANHO_DATA_FUTURA` 409 `{data, hoje, fuso}`, `EMPRESA_FUSO_NAO_CONFIGURADO` 409 `{empresa_id}`, `EMPRESA_FUSO_INVALIDO` 400. |
| Configuração | `empresaRoutes.js` / `empresaService.js` | `PUT /empresas/:id/fuso-horario`: só administrador, empresa travada, AuditLog com anterior e novo. Trocar um fuso existente exige motivo; o mesmo valor não muda nada. `POST /empresas` aceita `fuso_horario` opcional. O PATCH genérico continua recusando o campo. |
| UI mínima | `FormularioEmpresa.jsx`, `Empresa.jsx`, `apis/empresa`, `empresaService`, `empresaWritePayload` | Campo "Fuso horário da fazenda" com a lista do Brasil, sem padrão e sem inferir pela UF. Na criação, vai no POST. Na edição, o botão "Salvar fuso" chama a rota administrativa, online. Não houve mudança no mapa nem nos formulários de manejo. |
| Inventário | `scripts/ops/inventario-futuros-rebanho.mjs` + `inventarioFuturosRebanhoLib.mjs` | Somente leitura, em transação `READ ONLY`, e só em banco local. Detalhes em [Inventário](#inventário-de-fatos-futuros). |
| Testes | `backend/tests/dProd122IntegridadeTemporal.test.mjs` (37), `tests/smoke/empresaFusoHorario.test.jsx` (6) | — |
| Runner e fixtures | `scripts/tests/run-backend-tests.mjs`; 27 arquivos de teste | O runner define `NODE_ENV=test` e `MAIKE_TESTE_AGORA` só no processo dos testes. As fixtures que criam Empresa recebem `fuso_horario` explícito. Nenhuma data foi reescrita. |

## Política

- **Fato realizado × planejado.** O ledger só registra o que já aconteceu. Agendamento seria outro domínio, sem partidas, e não foi criado.
- **Hoje.** É o relógio do servidor convertido para o fuso IANA da Empresa. Nunca o navegador, nunca UTC, nunca inferido de UF ou cidade.
- **Data operacional.** Vale o dia literal informado (AAAA-MM-DD).
  - Hora ou offset na string não deslocam o dia. Por exemplo, `2026-11-04T23:00:00-03:00` conta como 04/11.
  - É a mesma semântica de `diaDe` desde a R2A.
  - Nenhum dado gravado muda de dia.
- **Retroativo e mesmo dia.** Continuam aceitos, com as guardas de sempre: saldo ≥ 0 em toda a linha do tempo, ordem causal e corte.
- **Sem fuso.** Todo fato novo recebe `EMPRESA_FUSO_NAO_CONFIGURADO`. Leitura, as-of, verificação, histórico, elegibilidade e exclusão continuam funcionando.
  - Exceção: a empresa nova sem entradas nasce ativada sem fuso. Ali nenhum fato é criado.
- **Replay.** Um recibo committed idêntico devolve a mesma resposta, mesmo que o fato seja futuro e mesmo sem fuso. Uma operação nova recusada não deixa linha, recibo nem auditoria.
- **Troca de fuso.** Só o administrador troca, com motivo, e a troca fica no AuditLog. Nenhuma data antiga é reescrita.
  - A troca afeta só o "hoje" de fatos novos.
  - Na fronteira do dia, um mesmo instante pode ser hoje ou amanhã conforme o fuso (provado no teste F-fuso).

## Caminhos de escrita cobertos

Inventário refeito na main atual. O único escritor de `EventoRebanho`, `PartidaRebanho` e `PesoRebanho` é o módulo `rebanhoLedger`. O `estoquePecuarioLedger` não tem rota e grava em schema próprio.

| Caminho | Entrada | Guarda |
|---|---|---|
| Entrada (cadastro de Lote em empresa ativada) | `POST /lotes` → `registrarEntradaSeAtivo` | `exigirDiaNoLedger` |
| Transferência (comando) | `POST /rebanho/comandos/transferencia` | idem |
| Transferência (legado) | `POST /movimentacoes-mapa/comandos/manejo-lote` → `executarTransferencia` | idem |
| Morte (legado) | manejo-lote → `baixaNoLedger` | idem |
| Morte e abate (baixa) | `POST /movimentacoes-mapa/comandos/baixa-rebanho` | idem |
| Nascimento, pesagem e mudança | `POST /movimentacoes-mapa/comandos/manejo-rebanho` | idem |
| Junção | `POST /movimentacoes-mapa/comandos/juncao-lotes` | idem |
| Ativação: saldo de abertura | `POST /rebanho/ativacao`, cutover | `data_corte <= hoje` |
| Ativação: entradas | idem, mais `POST /empresas` (empresa nova) | nenhuma entrada futura no conjunto |
| Cadastro em empresa NÃO ativada (legado) | `POST /lotes` | sem guarda: não é fato do ledger. A ativação recusa depois se houver entrada futura (teste A2). |

## RED → GREEN

Evidência: `evidencias/d-prod-122/red-green.txt`.

**Na main `f49004a1`, sem implementação:** 32 de 36 falham. A transferência para amanhã é aceita com 201 onde se exige 409.

**Na branch:** 37 de 37 passam.

| Grupo | Testes |
|---|---|
| Puros | P1 (23:59/00:00 em SP, Cuiabá e Rio Branco; virada UTC; bissexto), P2 (IANA válido e inválido), P3 (relógio concorrente isolado), P4 (fora de teste o relógio é recusado e `MAIKE_TESTE_AGORA` é ignorado) |
| Caminhos | F ×10: amanhã → 409 sem escrita (fotografia de lotes, posições, eventos, partidas, pesos, movimentos, recibos e auditoria); hoje → 201 |
| Bordas | F-R (retroativo), F-ISO (dia literal), F-borda (23:59/00:00 nos três fusos), F-fuso (mesmo instante em SP e Rio Branco), F-conc (3 futuros simultâneos) |
| Ativação | A1 (corte futuro), A2 (entrada futura no conjunto), A3, A4 (corte = hoje da fazenda, não UTC), A5 (sem fuso, rollback) |
| Sem fuso | S1: os 10 caminhos dão 409; leitura, as-of, verificação, histórico, elegibilidade e exclusão seguem |
| Futuro legado | R1 (replay idêntico, inclusive sem fuso), R2 (operação nova → 409, sem recibo), R3 (exclusão segura restaura exatamente, sem bloqueio por data nem fuso) |
| Configuração | C1 (admin, inválido, comum 403, PATCH recusa, leitura), C2 (motivo e auditoria), C3 (tenant B), C4 (404), C5 (`POST /empresas` com e sem fuso) |
| Inventário | K1 (KM-06 sintético: projeção 49 × as-of 50), K2 (escrita na transação recusada pelo PostgreSQL), K3 (sem fuso), K4 (ids com hash) |

**Regressão:** suíte backend completa local, 811 testes (805 passando, 5 `todo` pré-existentes, 0 falhas depois das fixtures). Gates `test:gates` 12/12 no pré-merge. `gate:rebanho-ssot` PASSOU. Smoke de Empresa 51/51.

## Migration local

Evidência: `evidencias/d-prod-122/migration-local.txt`.

1. Banco vazio → `deploy:migrate` aplica as 30 migrations.
2. Reaplicar → "No pending migrations".
3. A coluna criada é `varchar(64)`, anulável, sem DEFAULT.
4. O checksum em `_prisma_migrations` bate com o manifesto.
5. A base local já povoada recebe só a migration nova. Nenhuma empresa recebe fuso automaticamente.

## Inventário de fatos futuros

Evidências: `evidencias/d-prod-122/inventario-cli.txt` e `inventario-km06-sintetico.json`.

- **Alvo.** Usa o mesmo do runtime (`POSTGRES_PRISMA_URL ?? DATABASE_URL ?? POSTGRES_URL`).
  - Recusa host não local, nome de banco com `prod` ou `supabase` e servidor com papéis Supabase.
  - Não há flag para contornar. A URL nunca é impressa.
- **Saída por empresa ativada com fuso:**
  - eventos futuros (tipo, data, registro, posições, áreas, fatos posteriores nas mesmas posições);
  - posições divergentes (projeção × até hoje × futuro), com a causa: `fato_futuro` ou `projecao_inconsistente`;
  - pesos futuros;
  - totais.
- Empresas sem fuso saem listadas à parte.
- **KM-06 sintético** (relógio real 04/11/2026, fuso SP): 1 MORTE futura em 2026-11-27. Na posição Bezerro, a projeção é 0 e o saldo até hoje é 1 (futuro −1, causa `fato_futuro`). Totais: 49 × 50.

## Runbook de rollout (não executado; exige autorização do proprietário)

1. **Backup restaurável** comprovado do banco de produção.
2. **Migration**, isolada e compatível com o backend atual, que não lê a coluna.
3. **Configurar o fuso de cada empresa**, de forma explícita, pelo administrador:
   - pela tela de Empresa ("Fuso horário da fazenda" → "Salvar fuso"); ou
   - pela rota `PUT /empresas/:id/fuso-horario`.
   - Não há preenchimento em massa e nada é inferido da UF.
4. **Conferir** que nenhuma empresa ativada ficou sem fuso. O inventário lista `empresas_sem_fuso` (só em banco local ou cópia; remoto exige autorização separada).
5. **Publicar o runtime novo.** Se o passo 3 não estiver completo, as empresas sem fuso passam a receber `EMPRESA_FUSO_NAO_CONFIGURADO` em todo manejo novo e em todo lote novo. Por isso a ordem é obrigatória.
6. **Rollback.** Basta reverter o runtime, porque a coluna é inofensiva para o backend antigo. A coluna só se remove se nenhuma empresa tiver fuso.

## Saneamento manual dos futuros legados (não executado)

Para cada item do inventário:

1. Identificar a cadeia: fatos posteriores nas mesmas posições.
2. Decidir com o proprietário, caso a caso, entre:
   - **manter até a data**: a projeção se corrige sozinha quando o dia chega;
   - **excluir** pelo `POST /movimentacoes-mapa/:id/exclusao` (elegibilidade, motivo, auditoria) e relançar com a data certa.
3. Nunca usar UPDATE direto em `EventoRebanho`, `PartidaRebanho` ou movimentos. Nunca reprojetar em massa.

O KM - 06 de produção NÃO foi tocado.

## Riscos e limites

- **Futuros já gravados continuam.** A projeção atual pode divergir do as-of até a data de cada um ou até o saneamento. O deploy sozinho não corrige o histórico.
- **Fila offline do Lote.** Um lote criado offline com data futura, ou em empresa sem fuso, recebe 409 na sincronização e fica parado no primeiro item da fila (comportamento atual para qualquer 4xx). Não gera duplicata. Os comandos de manejo são só online.
- **UI dos formulários de manejo.** Os inputs de data continuam sem `max`, e há padrões `toISOString()` (UTC) no `DetalhesLote` e em outros pontos. O servidor recusa com mensagem em pt-BR. O ajuste da UI fica para um slice próprio. Nunca é segurança.
- **Relógio de teste.** Existe só com `NODE_ENV=test`. O runner o define apenas no processo dos testes, nunca no job do CI.
- **Ativação de empresa nova sem fuso.** O `data_corte` do modo entradas é informativo (o dia do servidor) e não decide nenhuma regra.
- **Inventário.** Varre todas as empresas do banco alvo, que é local. O uso em cópia ou produção exige autorização separada.
