# MAIKE-PATRIMONIO-P1-02 — Abastecimentos e consumo de combustível da frota

Decisão: **D-PROD-159** ([`DECISIONS.md`](./DECISIONS.md)). Base: `origin/main` `a23477414cf2b2512143868d57c5ec68fa9501ab` (PRs #232 Patrimônio P1-01 e #234 Gestão P3-03 mergeadas).
Branch: `claude/maike-patrimonio-p1-02-abastecimentos` · PR ⟨PREENCHER⟩ (**DRAFT**) · HEAD final ⟨PREENCHER⟩.
Runbook de release (não executado): [`MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md).

> **`SCHEMA_APPLIED_PRODUCTION: NÃO`.** Nenhum DDL foi executado em Supabase, Vercel, staging ou qualquer banco remoto. Todos os testes rodaram em PostgreSQL 16/17 **local** e descartável. A PR fica em **DRAFT** até a revisão humana e o GO expresso da migration.

## 1. O que entra e o que fica fora

**Entra** — a primeira operação real de Patrimônio e Frota:
- página nativa **Abastecimentos** (tela `pat-abastecimentos`), 2º item do grupo "Patrimônio e Frota", no Motor Base1;
- **fator kg/L** por fazenda × tipo de combustível × produto, informado pelo responsável e versionado;
- **prévia sem escrita** e **confirmação transacional** com baixa **física real** em KG pelo motor de estoque existente (FIFO por lote, custo FIFO final, movimento de saída com origem própria);
- histórico paginado no servidor, detalhe com fatias e movimentos, **cancelamento/estorno exato** auditado;
- leitura do medidor no próprio abastecimento (série monotônica, sem gravar o bem) e **consumo** km/L ou L/h pelo método do tanque cheio declarado.

**Fica fora** (cada item só com decisão própria): manutenção, OS, peças, compras, financeiro/contas a pagar, custo/hora contábil, mapas, dashboards, transferência entre fazendas, apuração de depreciação, saldo de tanque, GNV (m³) em tanque de litros, densidade oficial ou fator inferido, edição de abastecimento confirmado, seed de produção. **Nenhuma `OperacaoFinanceira` é criada ou fingida.** Páginas e schemas legados (`LancamentosAbastecimento`, `FichaControleCombustivel`, `AbastecimentoMaquina`, `ConfiguracaoFatoresConsumo`) continuam proibidos em `config/mapa-manejo-scope.json`.

## 2. Arquivos

**Banco:** `backend/prisma/schema.prisma` (3 models + back-relations, sem DDL em model antigo; 84 models, 70 tenant-scoped) e `backend/prisma/migrations/20261110200000_patrimonio_p1_02_abastecimentos/migration.sql` (§13).

**Backend novo** (`backend/src/modules/patrimonio/`):
- `abastecimentoPlano.js` — normalização (decimais só como texto), fingerprints canônicos, `converterLitrosEmKg`, avaliação da leitura e o **plano puro** `planejarAbastecimento` (mesma função na prévia e na confirmação);
- `abastecimentoMedidor.js` — pontos da série (cadastro + confirmados), `pisoOperacional`, `pontosVizinhos`, `leituraVigente`;
- `abastecimentoConsumo.js` — consumo D11 por SQL com janela, `METODOLOGIA_CONSUMO`;
- `abastecimentoService.js` — `listar`, `detalhar`, `previa`, `confirmar`, `cancelar`;
- `abastecimentoOpcoesService.js` — seletores próprios (bens, tanques, tipos, produtos, produtos-filtro, locais);
- `conversaoCombustivelService.js` — fatores (`listar`, `criar`, `encerrar`);
- `abastecimentoRoutes.js` — 15 rotas, `preValidation` anti-coerção encapsulado.

**Backend alterado (mínimo):**
- `estoqueFisico/estoqueFisicoMotor.js` — M1–M6 (§6), padrões = comportamento atual;
- `estoqueLotesNota/estoqueLoteNotaService.js` — X1 (§9);
- `patrimonio/bemPatrimonialRegras.js` e `bemPatrimonialService.js` — X2 e `medidor_operacional` (§9);
- `shared/auth/autorizacaoTela.js` (`TELAS.PATRIMONIO_ABASTECIMENTOS`, `ACOES_ABASTECIMENTO_EXTRAS`), `shared/auth/guardasRotas.js` (`GUARDAS.patrimonioAbastecimentos`), `shared/errors/errorCodes.js` (bloco D-PROD-159, 14 códigos), `app.js` (registro das rotas).

**Frontend novo:** `src/pages/Abastecimentos.jsx`; `src/components/patrimonio/{AbastecimentosTela,TabelaAbastecimentos,FormularioAbastecimento,ConsultaAbastecimento,DialogosAbastecimento,ConversoesCombustivel,PainelConsumoBem}.jsx`; `src/lib/abastecimentoRegras.js` (puro, só imports relativos: importado também pelo teste de integração no Node); `src/services/abastecimentoService.js`.

**Frontend alterado:** `src/apis/patrimonio/{patrimonioNativePort,patrimonioApi,index}.js`, `src/pages.config.js`, `src/lib/menuConfig.js`, `src/components/navigation/MobileModulesView.jsx`, `src/lib/{patrimonioPermissions,permissions,patrimonioErros}.js`, `src/components/usuarios/ConfiguracaoPermissoesTelas.jsx`, `src/hooks/usePatrimonioSessao.js`, `src/components/patrimonio/{bemFormulario.js,FormularioBem.jsx,MedidorBem.jsx}`, `config/mapa-manejo-scope.json` (+`Abastecimentos`), `vercel.json` (gerado pelo sync). `src/services/operacaoFinanceiraService.js` e `src/components/financeiroGestao/**` só são importados.

**Infra:** `scripts/deploy/premergeMigrateLib.mjs` (pin do SHA e do DO), `scripts/tests/deploy/premerge-migrate.test.mjs` (B1 e B1e), `scripts/ops/sql-editor/01..04` (85 tabelas, "+ 3 de Patrimônio P1-02"), `backend/tests/sqlEditorBootstrap.test.mjs`, `backend/tests/patrimonioP1Seguranca.test.mjs` (S8), `backend/tests/helpers.mjs` (`limparBanco`).

**Testes novos:** `backend/tests/patrimonioP1AbastecimentoCenario.mjs` (cenário reutilizável), `patrimonioP1Abastecimentos.test.mjs`, `patrimonioP1AbastecimentosMedidor.test.mjs`, `patrimonioP1AbastecimentosConcorrencia.test.mjs`, `patrimonioP1AbastecimentosSeguranca.test.mjs`, `patrimonioP1AbastecimentosContratoTela.test.mjs` (INT-1); `tests/smoke/fixtures/{abastecimentoVetores.json,abastecimentosFakeCore.js,abastecimentosTela.jsx}`, `tests/smoke/{patrimonioAbastecimentos,patrimonioAbastecimentosCancelamento,patrimonioAbastecimentosConversoes}.test.jsx`, `tests/smoke/abastecimentoRegras.test.js`; `scripts/dev/e2e-abastecimentos-real.mjs` + `e2e-abastecimentos-seed.mjs` (E2E-1, fora do CI).

## 3. Modelo (3 tabelas novas)

| Tabela | Colunas | O que guarda | Garantias no banco |
|---|---|---|---|
| `ConversaoCombustivelProduto` | 16 | fator kg/L por `(cliente, empresa, tipo, produto)`, `sequencia` (1, 2, 3… por par), `kg_por_litro DECIMAL(10,6)`, `declara_estoque_em_kg`, `ativo`/`ativo_chave`, `encerrado_em/por`, `criado_por`, `versao` | FK de 4 colunas para `TipoCombustivelProduto_par_key` (o fator é do par do vínculo R2); CHECK `0 < f ≤ 10`; CHECK declaração `= true`; CHECK de vigência NULL-safe (vigente ⇔ `ativo_chave IS TRUE` e sem encerramento); unique de **um vigente por par** e de `sequencia` por par |
| `AbastecimentoBem` | 34 | número, status (`CONFIRMADO`/`CANCELADO`), bem, tanque, tipo, produto, local, `conversao_id`, data operacional, `quantidade_litros DECIMAL(14,4)`, snapshot `kg_por_litro`, `quantidade_kg DECIMAL(14,4)`, `custo_total`, `custo_unitario_kg`, `tanque_cheio`, medidor (tipo, unidade, leitura, origem), observação, referência externa, `operation_id`, movimento de saída e de estorno, autor/cancelador, motivo, `versao` | FK de **5 colunas** para o fator do **mesmo par** (C1); FKs compostas com `cliente_id` para empresa, bem, tanque, local, movimentos e usuários; CHECK `quantidade_kg = round(quantidade_litros * kg_por_litro, 4)`; CHECK de status (cancelado ⇔ estorno, data e motivo ≥ 3); CHECK de medidor (contador ⇒ leitura + unidade coerente + origem `'ABASTECIMENTO'`; `SEM_MEDIDOR` ⇒ tudo NULL); CHECK de `operation_id`; uniques `(cliente_id, operation_id)`, `(cliente_id, numero)`, `(cliente_id, movimentacao_estoque_id)`, `(cliente_id, movimentacao_estorno_id)` |
| `AbastecimentoBemConsumoLote` | 10 | fatia FIFO: lote, `ordem`, `quantidade`, `custo_unitario` | FK `(cliente_id, empresa_id, abastecimento_id)` (fatia da **mesma** empresa do abastecimento); uniques por `(abastecimento, lote)` e `(abastecimento, ordem)`; CHECK `quantidade > 0` |

Totais: 3 PKs, 17 FKs (todas `ON UPDATE CASCADE ON DELETE RESTRICT`, todas com `cliente_id`; 15 para tabelas antigas: `Cliente` ×3, `Empresa`, `Usuario` ×4, `BemPatrimonial`, `TanqueBem`, `TipoCombustivelProduto`, `LocalEstoque`, `MovimentacaoEstoque` ×2, `EstoqueLoteNota`), 13 CHECKs, 25 índices (3 PK, 13 unique, 9 outros), todos começando por `cliente_id`; RLS ligado sem FORCE, REVOKE de `anon`/`authenticated` e política `maike_backend_all` só para `maike_vercel`. Nenhuma tabela antiga é alterada nem referencia as novas. Como `BemPatrimonial`, `TanqueBem` e `Produto` não têm unique `(cliente_id, empresa_id|bem_id, id)` e **não** são alterados, a coerência bem × tanque × empresa × produto é invariante do serviço, relida sob trava (§7).

## 4. Fator kg/L e conversão

- **Contrato explícito:** o fator é parâmetro operacional **informado e validado pelo responsável**, não densidade presumida. Nunca é inferido do nome, do combustível, do preço ou da internet. Exige: vínculo R2 **ativo** (tipo × produto na mesma fazenda), tipo em litros (`unidade = 'L'`; GNV em m³ → 422 `TANQUE_COMBUSTIVEL_INCOMPATIVEL unidade_nao_litro`), produto com `unidade_principal_estoque = 'KG'` (senão 422 `ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL`), `0 < f ≤ 10` com até 6 casas e a declaração `declara_estoque_em_kg = true` (422 `ABASTECIMENTO_CONVERSAO_INVALIDA`).
- **Precisão:** `DECIMAL(10,6)` — seis casas bastam para fatores de combustível líquido (ordem de 0,7–0,9 kg/L) com erro de arredondamento abaixo de 0,0001 kg por litro, e o teto 10 impede um fator absurdo de inflar a baixa.
- **Versionamento:** `POST /patrimonio-conversoes-combustivel` com `conversao_vigente_id` (null para o primeiro). Alterar = encerrar o vigente e criar a sequência seguinte, numa transação, sob a trava consultiva do vínculo (`patrimonio:combustivel-produto:<cliente>:<empresa>:<produto>`); vigente divergente → 409 `ABASTECIMENTO_CONVERSAO_ALTERADA vigente_divergente`. Encerrar sem substituir deixa o par sem fator (próxima confirmação → 422 `ABASTECIMENTO_CONVERSAO_AUSENTE`). Criar e encerrar ficam no AuditLog (`conversao_combustivel.criar`/`.encerrar`). O histórico nunca é apagado e cada abastecimento guarda `conversao_id` e o `kg_por_litro` usado.
- **Conversão uma vez:** `kg = ROUND_HALF_UP(litros × fator, 4)` (`Prisma.Decimal`, precisão 50), na prévia e na confirmação pela mesma função. Recusas: `kg ≤ 0` → 422 `OPERACAO_VALORES_INVALIDOS quantidade_estoque_zero`; `kg > 9999999999.9999` → `valor_excede_limite_estoque`. O CHECK do banco repete a regra. Exemplos dos vetores compartilhados (`tests/smoke/fixtures/abastecimentoVetores.json`): 80 L × 0,840000 = **67,2000 kg**; 0,0003 L × 0,500000 = 0,00015 → **0,0002 kg** (HALF_UP); 0,0001 L × 0,400000 → recusado.
- **Prévia × confirmação:** a confirmação manda `conversao_id` + `conversao_versao` vistos na prévia; se o fator mudou → 409 `ABASTECIMENTO_CONVERSAO_ALTERADA` e nada é gravado.

## 5. Litros, capacidade e tanque

- Litros `DECIMAL(14,4)` > 0, recebidos como **texto** (`"80"`, `"80.5"`; número JSON → 400 `valor_deve_ser_texto`).
- Regra por evento: `litros ≤ capacidade_litros` do tanque (422 `ABASTECIMENTO_EXCEDE_CAPACIDADE`, `details.capacidade_litros`). `capacidade_litros` nunca é tratada como quantidade abastecida, e o sistema **não** presume saldo do tanque: abastecimentos parciais seguidos (20 L + 30 L num tanque de 180 L) são aceitos.
- Veículo flex = um tanque com dois tipos aceitos; o produto precisa ter vínculo ativo com **o tipo escolhido** (gasolina com tipo ETANOL → 422 `COMBUSTIVEL_PRODUTO_INVALIDO sem_vinculo_ativo`).

## 6. Baixa física pelo motor de estoque (M1–M6)

O abastecimento usa as primitivas do motor vigente (`travarProdutosEstoque`, `lotesFifo`, `aplicarSaidaFifo`, `estornarSaida`) com uma generalização **mínima e compatível**; nenhum chamador antigo passa os parâmetros novos, então as linhas do financeiro ficam iguais:
- **M1/M2:** `ORIGEM_ABASTECIMENTO = 'abastecimento_patrimonio'`; `camposComuns` aceita só as origens conhecidas (fail-closed) e grava `origem_sistema`/`exclusao_somente_em` com ela. `lancamento_origem_id` = id do abastecimento (gerado antes da baixa).
- **M3/M4:** `motivo` e `tipoDetalhado` da saída e `tipoDetalhadoEstorno`/`motivoEstorno` do estorno são opcionais (`abastecimento_patrimonio` / `estorno_abastecimento`).
- **M5:** o motor recusa `kg ≤ 0` (o `decrement` negativo seria um aumento) e `kg > LIMITE_ESTOQUE`, com os códigos já existentes.
- **M6:** `numeroMovimentoProvisorio()` (`p-…`) e `numerarMovimentos()` — o número definitivo vem da sequência única de movimentos, reservada no fim da transação; nenhum `p-…` chega ao commit. O financeiro não foi alterado.

Movimento de saída: `tipo_movimentacao 'Saída'`, `unidade_medida 'KG'`, `documento = { numero: referencia_externa, data: data_operacional }`, sem parceiro (C9) e sem preencher `vinculado/tipo_vinculo/maquina_vinculada_*` (C8). Lotes baixados por CAS em `quantidade_disponivel`, `Produto.estoque_atual` baixado no mesmo passo (nunca `estoque_atual -= …` isolado). Saldo = lotes da empresa naquele local; sem lote suficiente → 422 `ESTOQUE_SALDO_INSUFICIENTE saldo_lote_insuficiente {disponivel, solicitado}`; `estoque_atual` legado menor → `estoque_atual_insuficiente`. Custo FIFO final gravado (aceite TP-02: 50 kg × 5,2000 + 17,2 kg × 5,5000 = **354,6000**, 5,2768/kg). A prévia mostra o custo como **estimativa** (`custo_e_estimativa: true`); só a confirmação grava o custo final.

## 7. Ordem única de travas (R0..R13) e TOCTOU

Confirmação (`TRANSACAO_CURTA`):

| Passo | Recurso |
|---|---|
| R0 | `lock_timeout` 8 s |
| R1 | recibo `OperacaoIdempotente` (ON CONFLICT DO NOTHING) — só espera quem usa a MESMA chave |
| R2 | `Empresa FOR SHARE` (`hojeDaEmpresa`: fuso e "hoje" da fazenda) |
| R3 | `BemPatrimonial FOR UPDATE` (mesma 1ª trava do PATCH do bem) |
| R4 | `AbastecimentoBem FOR UPDATE` + releitura — **só no cancelamento** |
| R5 | advisory do vínculo `patrimonio:combustivel-produto:<cli>:<emp>:<produto>` (o mesmo do escritor do fator e do vínculo) |
| R6 | `TipoCombustivel FOR KEY SHARE` |
| R7 | `LocalEstoque FOR KEY SHARE` |
| R8 | `travarProdutosEstoque` (advisory `estoque:produto` + `Produto FOR UPDATE`), uma vez |
| — | `carregarEstado` relê tudo sob as travas: bem (ativo, natureza com tanque), tanque ativo do bem, tipo aceito pelo tanque, vínculo ativo, produto ativo da mesma empresa e em KG, fator vigente, local ativo, lotes, medidor |
| R9 | `EstoqueLoteNota` (CAS do motor) |
| R10 | `MovimentacaoEstoque` INSERT (nº provisório) |
| R11 | INSERT `AbastecimentoBem` + `createMany` das fatias |
| R12 | sequências `AbastecimentoBem` e `MovimentacaoEstoque` — sempre por último |
| R13 | AuditLog na mesma transação → recibo `committed` |

Cancelamento: R0 → R1 → R2 (dia do estorno) → leitura sem trava só de `bem_id/produto_id` → R3 → R4 → medidor antes → R8 → movimento original `FOR UPDATE` → `estornarSaida` (lotes + movimento) → R11 (CAS) → R12 → R13. **Prévia:** nenhuma trava (RepeatableRead só leitura; o "hoje" lido sem `FOR SHARE`, C5) e a mesma função de plano. A ausência de ciclo foi provada par a par contra P3-01/02/03 (confirmar, cancelar, retificar, excluir), suplementação/transferência, PATCH/DELETE de lote, PATCH/DELETE de Produto e PATCH do bem; as corridas C1–C11 (§15) confirmam a serialização, e `pg_stat_database.deadlocks` não mudou durante o arquivo de concorrência.

## 8. Idempotência e cancelamento

- **Confirmar:** `operation_id` (`^[A-Za-z0-9_.:-]{8,128}$`) estável por envio (a tela gera `lanc-<uuid>` e o reusa em retry, duplo clique, timeout e "Repetir o mesmo envio"). Mesmo id + mesmo corpo canônico → **200 `replay: true`** com o corpo gravado e uma única baixa; `"80"` ≡ `"80.0000"`. Mesmo id + corpo diferente → **409 `IDEMPOTENCY_CONFLICT`**, nada gravado, AuditLog `abastecimento_bem.reenvio_conflitante` numa transação curta separada (best-effort). Pedido simultâneo da mesma chave → espera o recibo do primeiro e devolve o replay (ou 409 `IDEMPOTENCY_IN_PROGRESS`). A mesma chave em outro tenant é operação nova. Defesa final: unique `(cliente_id, operation_id)`.
- **Cancelar** (`POST /patrimonio-abastecimentos/:id/cancelar {empresa_id, versao, motivo, operation_id}`): exige a ação `cancelar`, motivo 3..500, a `versao` vista (senão 409 `PATRIMONIO_VERSAO_CONFLITO`). Devolve exatamente o kg e as fatias gravados (cada uma ao seu lote), cria o movimento `Entrada`/`estorno_abastecimento` com os valores do original e a trilha pai/filho, marca o original `Estornada`, devolve `estoque_atual`, passa a linha a `CANCELADO` (`versao` 2) e audita `abastecimento_bem.cancelar` com `leitura_operacional_antes/depois`. Nunca reconverte litros e nunca toca `BemPatrimonial`. Segundo cancelamento (outra chave) → 409 `ABASTECIMENTO_STATUS_INVALIDO {status, esperado}`; replay da mesma chave → 200 com o mesmo corpo. Recusas fail-closed (409 `ABASTECIMENTO_CANCELAMENTO_BLOQUEADO`, nada alterado): `produto_mudou_de_fazenda`, `movimento_inexistente`, `movimento_estornado`, `fatias_inconsistentes`, `lote_indisponivel_para_devolucao` (ex.: compra P3 cancelada depois de reposição), `devolucao_excede_entrada`, `estoque_excede_limite`. Qualquer erro → rollback total. Cancelar é permitido com bem, tanque, produto ou local inativos (C14).

## 9. Medidor (D4), X1 e X2

- O abastecimento **nunca grava `BemPatrimonial`** (nem `versao` nem colunas do medidor): o CHECK antigo de `BemPatrimonial.medidor_origem` continua sem `'ABASTECIMENTO'` e um PATCH do bem aberto antes de um abastecimento grava sem 409. A leitura vive no abastecimento (`medidor_origem = 'ABASTECIMENTO'`, snapshot de tipo e unidade).
- Bem com contador: leitura **obrigatória** (422 `MEDIDOR_LEITURA_INVALIDA obrigatoria`); `SEM_MEDIDOR`: leitura proibida (`sem_medidor`).
- **Série monotônica por data** (pontos = leitura do cadastro + abastecimentos CONFIRMADOS com leitura): uma leitura `r` na data `d` vale se `r ≥` todo ponto de data ≤ `d` e `r ≤` todo ponto de data > `d`. Abaixo → 422 `MEDIDOR_LEITURA_REGRESSIVA` (com o ponto de referência); acima de um posterior → 422 `MEDIDOR_LEITURA_ACIMA_POSTERIOR`; data posterior ao hoje da fazenda → 422 `ABASTECIMENTO_DATA_FUTURA {hoje, fuso}`. Inserção retroativa coerente é aceita; regressiva nunca. A prévia mostra os vizinhos efetivos (anterior/posterior).
- **Cancelamento:** remover um ponto mantém a série monotônica, então é permitido; o detalhe traz `efeito_cancelamento_medidor {muda, leitura_operacional_antes, leitura_operacional_depois}`, a resposta e a auditoria trazem antes/depois, e o diálogo da tela avisa quando a leitura operacional atual vai mudar. O odômetro/horímetro do cadastro nunca é reduzido.
- **X2 (PATCH do bem):** com abastecimento CONFIRMADO com leitura, o ajuste do medidor exige leitura ≥ a maior operacional (422 `MEDIDOR_LEITURA_REGRESSIVA origem_referencia=ABASTECIMENTO`) e data ≥ a dela (422 `MEDIDOR_DATA_REGRESSIVA`); trocar o tipo ou a leitura inicial deixa de ser possível (409 `MEDIDOR_TIPO_IMUTAVEL medidor_com_abastecimento`). Sem leitura operacional, o comportamento é o da P1-01. O detalhe do bem ganha `medidor_operacional {leitura, data, abastecimento_id} | null` e a tela do bem mostra tipo e leitura inicial fixos com o motivo.
- **X1 (lote):** PATCH restrito e DELETE de lote com fatia de abastecimento (confirmado ou cancelado) → 409 `REGISTRO_OPERACIONAL_IMUTAVEL vinculo=abastecimento_bem`; PATCH só de `local_estoque_nome` continua passando.
- X3/X4 (local e produto com abastecimento) **não** foram implementados: já são barrados por `movimentacoes_vinculadas` e pelos movimentos existentes (C13).

## 10. Consumo (D11)

- `tanque_cheio` é declarado pelo operador em cada abastecimento.
- Entre dois CONFIRMADOS consecutivos **do mesmo tanque** marcados como tanque cheio e com leitura: litros = soma dos confirmados do tanque depois do 1º até o 2º (inclusive); **km/L** (odômetro) = distância ÷ litros; **L/h** (horímetro) = litros ÷ horas; intervalo > 0; Decimal, 4 casas, HALF_UP. Vetores: TP-02 horímetro **5,0000 L/h**; caminhonete odômetro **8,7500 km/L**.
- Sem dois cheios consecutivos com leitura e intervalo positivo → `DADOS_INSUFICIENTES` (com motivo), nunca uma média inventada. `CICLOS` e `SEM_MEDIDOR` → `NAO_APLICAVEL`. Tanque cheio de outro tanque não fecha intervalo; o flex soma gasolina e etanol do mesmo tanque.
- A metodologia vai em texto na resposta. Calculado no banco por SQL com janela (sem carregar as linhas do bem no Node); a lista não traz consumo; o detalhe e `GET /patrimonio-abastecimentos-consumo` trazem.

## 11. Permissões (negadas por padrão)

| Ação da tela `pat-abastecimentos` | Rotas |
|---|---|
| `visualizar` | lista, detalhe, consumo, opções de bens/tanques/tipos/produtos/produtos-filtro, lista de fatores |
| `novo` ou `salvar` | prévia, confirmar, opções de locais (com saldo) |
| `cancelar` (extra) | cancelar/estornar |
| `configurar_conversao` (extra) | criar/alterar e encerrar fator |

- As caixas extras (`ACOES_ABASTECIMENTO_EXTRAS = ['cancelar','configurar_conversao']`) existem só nesta tela e nascem desmarcadas; rótulos "CANCELAR/ESTORNAR ABASTECIMENTO" e "CONFIGURAR FATOR KG/L".
- Nenhum perfil existente ganha acesso automático, nem quem tem `pat-bens-patrimoniais` completo. `is_admin` e o administrador real passam.
- Seletores guardados pela própria tela (quem só tem Abastecimentos não leva 403 de Bens/Central) (C12). A tela respeita as mesmas ações (prévia e cancelamento inclusive).
- Tenant só da sessão; empresa validada no banco; recurso de outro tenant/empresa → 404 com a mesma resposta do inexistente (sem oráculo). Cobertura das 15 rotas: [`MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md`](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md).

## 12. API e erros

| # | Rota | Guarda |
|---|---|---|
| A1 | `GET /patrimonio-abastecimentos` (keyset; filtros empresa, bem, tanque, produto, status, período, `operation_id`, `q`) | ver |
| A2 | `GET /patrimonio-abastecimentos/:id` (fatias, movimento, estorno, consumo, efeito no medidor) | ver |
| A3 | `POST /patrimonio-abastecimentos-previa` → `{plano, bloqueios}` | criar |
| A4 | `POST /patrimonio-abastecimentos` → 201 / replay 200 | criar |
| A5 | `POST /patrimonio-abastecimentos/:id/cancelar` | cancelar |
| A6 | `GET /patrimonio-abastecimentos-consumo` | ver |
| A7–A11 | `GET /patrimonio-abastecimentos-opcoes/{bens,tanques,tipos,produtos,produtos-filtro}` | ver |
| A12 | `GET /patrimonio-abastecimentos-opcoes/locais` (saldo da empresa) | criar |
| A13 | `GET /patrimonio-conversoes-combustivel` | ver |
| A14 | `POST /patrimonio-conversoes-combustivel` | configurar_conversao |
| A15 | `POST /patrimonio-conversoes-combustivel/:id/encerrar` | configurar_conversao |

Todas com `onRequest: [app.autenticar]` (sem token → 401 `TENANT_CONTEXT_REQUIRED`), corpo e query **fechados** (campo extra, `cliente_id` no corpo ou decimal como número → 400 `REQUEST_VALIDATION_FAILED`). Decimais sempre string com casas fixas (litros/kg/leitura/custo/capacidade 4, fator 6). **Erros novos** (bloco D-PROD-159 de `errorCodes.js`): `ABASTECIMENTO_NAO_ENCONTRADO` 404, `ABASTECIMENTO_STATUS_INVALIDO` 409, `ABASTECIMENTO_BEM_INELEGIVEL` 422, `ABASTECIMENTO_TANQUE_INVALIDO` 422, `ABASTECIMENTO_LOCAL_INVALIDO` 422, `ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL` 422, `ABASTECIMENTO_CONVERSAO_AUSENTE` 422, `ABASTECIMENTO_CONVERSAO_ALTERADA` 409, `ABASTECIMENTO_CONVERSAO_INVALIDA` 422, `ABASTECIMENTO_EXCEDE_CAPACIDADE` 422, `ABASTECIMENTO_DATA_FUTURA` 422, `ABASTECIMENTO_CANCELAMENTO_BLOQUEADO` 409, `MEDIDOR_LEITURA_ACIMA_POSTERIOR` 422, `CONVERSAO_COMBUSTIVEL_NAO_ENCONTRADA` 404. Toda recusa diz "nada foi gravado/alterado".

## 13. Migration e hashes

- `backend/prisma/migrations/20261110200000_patrimonio_p1_02_abastecimentos/migration.sql`: 3 `CREATE TABLE`, índices, FKs, CHECKs escritos à mão e o bloco `DO` de REVOKE/RLS. Nenhum `BEGIN`/`COMMIT` próprio, nenhum `DELETE`/`UPDATE`/`INSERT` de dado; o único `DROP` é `DROP POLICY IF EXISTS` nas tabelas novas.
- **SHA-256** `20f8f9609a8e09f123dac0ed7ba87747069b26ad07411e843481ffec59b15fba`; **hash do DO** `ac1d201b0ef75b629d018b8c3c98354eb9453d752ab5e62ee4c3edb23c14bddd`; pinados em `MIGRATIONS_APROVADAS`/`DO_RLS_APROVADOS` (as entradas anteriores intactas).
- **Classificador** (`classificarMigrations`): P1-02 sozinha e agregada → `expand: true`, `tabelas_novas` = as 3, `colunas_novas_em_tabelas_antigas: []`, 0 violações. Sem o pin: `MIGRATION_NAO_APROVADA` + `DO_NAO_RECONHECIDO` (RED). B1e cobre os negativos (CHECK com `'ABASTECIMENTO'` em `BemPatrimonial`, unique novo em `BemPatrimonial`, coluna nova em `MovimentacaoEstoque`, DO com tabela antiga, 1 byte a mais).
- `premerge-migrate.mjs --sha <HEAD>` em árvore limpa: `migrations_novas` = só a P1-02, "ANÁLISE LOCAL OK"; `--aplicar` sem configuração → `ALVO_SEM_CONFIGURACAO`.
- **Prova local** (PG16 e PG17.11 descartáveis, papéis `anon`, `authenticated`, `service_role` e `maike_vercel`): banco vazio → 39 migrations, reexecução "No pending migrations to apply"; 85 tabelas em `public`, todas com RLS e nenhuma com FORCE; 0 privilégios para `anon`/`authenticated`/`PUBLIC` (também com default hostil que concede tudo); `prisma migrate diff --exit-code` = 0 (migrations × schema e banco × schema). **Upgrade do estado de produção conhecido** (38 migrations, 82 tabelas) pelo runner `--verificar-alvo`/`--aplicar`: só a P1-02 entra no histórico; a impressão digital das 82 tabelas antigas é idêntica antes e depois (`TOTAL|2223|129448571f9f2c161c27979033c53721`); o upgrade só acrescentou (60 colunas, 33 constraints, 25 índices, 17 FKs, 3 políticas, 3 tabelas). **Rollback** de schema vazio ensaiado: guarda recusa com linha; rollback real volta a 38 concluídas e à impressão de 38; repetir é recusado; reaplicar volta a 39.
- Contagens: migrations **38 → 39**; tabelas `public` **82 → 85**; models **81 → 84**; tenant-scoped **67 → 70**.

## 14. Efeitos aceitos na Gestão P3 (D14)

Regras da P3-03 que passam a valer também para o consumo por abastecimento (testadas, não são regras novas):
- compra P3 cujo lote um abastecimento consumiu: retificar → 409 `OPERACAO_RETIFICACAO_BLOQUEADA lote_consumido`, excluir → 409 `OPERACAO_EXCLUSAO_BLOQUEADA`, cancelar → 409 `ESTOQUE_JA_CONSUMIDO`;
- depois de cancelar o abastecimento: cancelar a compra volta a funcionar; **retificar e excluir continuam bloqueados** (o movimento estornado continua citando o lote em `lotes_consumidos`);
- venda P3 com abastecimento posterior no mesmo produto e local: excluir → 409 `venda_com_movimento_posterior`;
- duplicar uma compra durante um abastecimento cria só rascunho, sem efeito físico.

## 15. Testes

Comando por arquivo (PostgreSQL 16 local, um banco por agente):
`DATABASE_URL=… AUTH_SECRET=ci-only-ephemeral-signing-key FRONTEND_ORIGINS=http://localhost:5173 NODE_ENV=test MAIKE_TESTE_AGORA=2027-06-15T15:00:00.000Z node --test --test-concurrency=1 backend/tests/<arquivo>.test.mjs`.

Resultados registrados pelas frentes na branch (antes do HEAD final); os números finais e o `verify:all` ficam no fim da tabela.

| Suíte | Tipo | Resultado registrado | Duração |
|---|---|---|---|
| `patrimonioP1Abastecimentos` (AB1–AB16) | PG real + Fastify | 17/0 | 24,0 s |
| `patrimonioP1AbastecimentosMedidor` (M1–M8) | PG real + Fastify | 8/0 | 11,8 s |
| `patrimonioP1AbastecimentosConcorrencia` (C1–C11) | PG real, portões por gatilho, espera por condição | 12/0 | 24,3 s (C9 ≈ 9 s pelo `lock_timeout`) |
| `patrimonioP1AbastecimentosSeguranca` (S1–S9) | PG real + SQL direto | 8/0 | 11,5 s |
| `patrimonioP1AbastecimentosContratoTela` (INT-1) | módulo puro da tela × API real × PG | ⟨PREENCHER⟩ | ⟨PREENCHER⟩ |
| Regressão P1-01: `patrimonioP1Bens` 19/0 · `patrimonioP1CombustivelProduto` 20/0 · `patrimonioP1Catalogos` 14/0 · `patrimonioP1Seguranca` 12/0 (S8 com as 3 novas) | PG real | verde | — |
| Regressão P3 e estoque: `gestaoP3Estoque` 17/0 · `gestaoP3Rodada2` 13/0 · `gestaoP3Concorrencia` 13/0 · `gestaoP3Lancamentos` 14/0 · `gestaoP3EditarExcluir` 45/0 · `gestaoP3Financeiro` 22/0 · `gestaoP3CustoLiquido` 38/0 · `gestaoP3RateioItem` 38/0 · `gestaoP3Seguranca` 9/0 · `gestaoP3PatrimonioCombinado` 3/0 · `cadastrosEstoqueNativo` 10/0 · `estabP0LancamentosNativo` 7/0 | PG real | verde | — |
| Regressão permissões e infra: `permissoesR2Rotas` 7/0 · `permissoesAutorizacao` 11/0 · `permissoesR2` 10/0 · `permissoesR3` 9/0 · `permissoesR4` 9/0 · `autorizacaoIntegradaBloqueadores` 14/0 · `leiturasCadastrosIntegrada` 20/0 · `supabasePublicGrantsNativo` 4/0 · `sqlEditorBootstrap` 10/0 · `sqlEditorPreservaMaike` 7/0 · `inicializarTenantMaikeCli` 11/0 | PG real | verde | — |
| `tests/smoke/patrimonioAbastecimentos.test.jsx` (FE1–FE5) | React + backend falso com os códigos reais | 20 | ⟨PREENCHER⟩ |
| `tests/smoke/patrimonioAbastecimentosCancelamento.test.jsx` (FE6) | idem | 4 | ⟨PREENCHER⟩ |
| `tests/smoke/patrimonioAbastecimentosConversoes.test.jsx` (FE7) | idem | 4 | ⟨PREENCHER⟩ |
| `tests/smoke/abastecimentoRegras.test.js` (FE8, todos os vetores) | regras puras | 24 | ⟨PREENCHER⟩ |
| `patrimonioMenuPermissoes`, `vercelSpaRoutes`, `bensPatrimoniais` (FE9–FE11, atualizados) | React | verde | — |
| `scripts/tests/deploy/premerge-migrate.test.mjs` (B1, B1e, B7) | gates | 16/16 | 0,4 s |
| `npm run test:gates` | gates | 698/698 (frente de infra) · ⟨PREENCHER⟩ (HEAD final) | 60 s |
| E2E-1 `scripts/dev/e2e-abastecimentos-real.mjs` (1280 e 390 px, fora do CI) | backend real + Vite + Chromium + conferência no banco | ⟨PREENCHER⟩ | ⟨PREENCHER⟩ |
| `npm run verify:all` no HEAD final | todas as etapas | ⟨PREENCHER⟩ | ⟨PREENCHER⟩ |
| CI (`verify:all`, teto 30 min) | GitHub Actions | run ⟨PREENCHER⟩ | ⟨PREENCHER⟩ |

Sensibilidade (mutação numa cópia da árvore no scratchpad, nunca na árvore real): sem `FOR UPDATE` do bem → C6 vermelho; sem o advisory do vínculo → C7 vermelho; sem `travarProdutosEstoque` → C3 e C5 vermelhos; L/h invertido → M1, M3, M7 vermelhos; sem checagem do ponto posterior → M4 vermelho; sem `produto_mudou_de_fazenda` → AB11 vermelho. Falhas provocadas por gatilho (S5) no 2º lote, na auditoria e no INSERT do fator novo → 5xx genérico e `fotoAbastecimento` idêntica (3 tabelas, lotes, movimentos, `estoque_atual`, recibos, auditoria, sequências).

Orçamento de CI: a suíte levava ~20,5 min antes desta PR; os arquivos novos de backend somam ≈ 72 s registrados + INT-1 (⟨PREENCHER⟩). Duração final do job: ⟨PREENCHER⟩.

## 16. Decisões de contrato (C1–C15, todas fail-closed)

| # | Decisão | Motivo |
|---|---|---|
| C1 | O abastecimento referencia o fator por FK de 5 colunas `(cliente, empresa, tipo, produto, conversao_id)`; o fator tem FK de 4 colunas para o par do vínculo R2. Sem FK direta para `Produto`/`TipoCombustivel` | o banco garante que o fator usado é do mesmo par do vínculo; menos travas na migration |
| C2 | `medidor_tipo` é snapshot NOT NULL (também `SEM_MEDIDOR`); contador ⇒ leitura NOT NULL (CHECK) | leitura obrigatória em contador garantida pelo banco |
| C3 | `sequencia` (1, 2, 3… por par, unique) + `versao` (CAS) no fator | histórico legível ("versão 2") e defesa de corrida |
| C4 | `MEDIDOR_LEITURA_ACIMA_POSTERIOR` para leitura maior que um ponto posterior; abaixo reusa `MEDIDOR_LEITURA_REGRESSIVA`. Novos `ABASTECIMENTO_TANQUE_INVALIDO`, `ABASTECIMENTO_LOCAL_INVALIDO`, `CONVERSAO_COMBUSTIVEL_NAO_ENCONTRADA` | inserção retroativa: a série tem dois lados |
| C5 | A prévia lê `Empresa.fuso_horario` sem `FOR SHARE` | prévia sem nenhuma trava |
| C6 | A lista aceita `operation_id` | o "Consultar" depois de resultado incerto acha o gravado pela chave pendente |
| C7 | A tela reusa `enviarComPendencia` e afins da Central sem alterá-los, com escopo `abastecimento:<cliente>:<login>` | zero regressão na Central |
| C8 | O movimento não preenche `vinculado/tipo_vinculo/maquina_vinculada_*` | telas legadas leem esses campos |
| C9 | `documento = {numero: referencia_externa, data}`, sem parceiro; estorno no hoje da fazenda | rastreio sem fingir documento financeiro |
| C10 | Consumo por SQL com janela; fora da lista | sem carregamento irrestrito |
| C11 | Vetores compartilhados + INT-1 (módulo puro da tela × API real) + E2E fora do CI | integração real, como o repositório já faz |
| C12 | Seletores próprios da tela; `locais` exige `criar` | quem só tem Abastecimentos não leva 403 |
| C13 | X3/X4 não implementados | local e produto com abastecimento já são barrados pelos movimentos |
| C14 | Cancelar com cadastros inativos; confirmar exige todos ativos | o estorno não fica refém de cadastro |
| C15 | 4 back-relations em `Usuario` (autor/cancelador; criador/encerrador), FKs anuláveis | padrão da P3 |

## 17. Frontend

- Página `Abastecimentos` no Motor Base1: lista com filtros (bem, produto, período; situação; "Fatores kg/L" na barra), "Carregar mais" por cursor, linha "Confirmados na lista: N · X L · Y kg" somada em BigInt (sem float), detalhe com fatias, movimentos, estorno, consumo e efeito no medidor.
- Formulário: bem → tanque → combustível (botões; flex mostra os dois) → produto → local (com saldo), data, litros em texto pt-BR, leitura só para contador, tanque cheio, observação e referência. Exibe código de frota, unidade, capacidade, estoque disponível e custo **estimado**. Trocar o bem limpa os dependentes; seleção automática quando há uma única opção.
- Prévia e confirmação usam o **mesmo snapshot** do formulário; mudar qualquer campo depois da prévia a invalida. "Confirmar" só existe no diálogo da prévia. Duplo clique = um POST; timeout (60 s) ou 504 → "resultado incerto" e "Repetir o mesmo envio" com o **mesmo** `operation_id`; "Consultar" busca pela chave pendente.
- Fatores kg/L num diálogo próprio (histórico vigente/encerrado, novo, alterar = nova versão, encerrar), só com `configurar_conversao`; a prévia oferece "Configurar fator" quando falta.
- Cancelamento com motivo ≥ 3, ciência explícita e o aviso de mudança da leitura operacional.
- Responsivo (1280 e 390 px no E2E-1); mensagens pt-BR a partir dos códigos estáveis (`mensagemErroAbastecimento`, `mensagemDoBloqueioAbastecimento`).

## 18. Riscos e limitações

- **Ordem de release:** a Vercel publica a `main` sozinha. Se o código entrar antes da migration, respondem 500 (P2021) as 15 rotas novas **e rotas antigas**: `GET`/`PATCH /bens-patrimoniais/:id` de bem com contador, `PATCH`/`DELETE /estoque-lotes-nota/:id` e `DELETE /empresas/:id`. A migration tem de ser aplicada com GO **antes** do merge (runbook). Na P1-01 houve incidente de sequência (merge antes da migration); este runbook repete a barreira.
- **Rollback de código depois de existir abastecimento:** o runtime antigo não conhece X1 nem X2. Nessa janela, o administrador poderia alterar o saldo de um lote consumido por abastecimento (o estorno exato passaria a ser recusado por `devolucao_excede_entrada`, fail-closed) e ajustar o medidor do bem abaixo da leitura operacional. Excluir lote, produto ou empresa ligado ao abastecimento cairia na FK RESTRICT (403 enganoso `TENANT_SCOPE_VIOLATION`, sem perda de dado). Orientação no runbook §9.2.
- **Fator informado pelo usuário:** fator errado gera kg errado. Mitigação: faixa 0 < f ≤ 10, declaração explícita, versionamento, snapshot por abastecimento e cancelamento exato; não existe validação física.
- **Coerência produto × empresa é do serviço** (sem unique composto em tabela antiga): SQL direto fora do serviço pode quebrá-la; toda confirmação relê sob trava.
- **Produto que muda de fazenda** com abastecimento confirmado (inativar o vínculo + `PATCH /produtos` com outra fazenda é permitido): o cancelamento desse abastecimento fica 409 `produto_mudou_de_fazenda` até o produto voltar.
- **D14 é permanente** para retificar/excluir a compra P3 cujo lote foi consumido (§14).
- X2 também bloqueia a correção "só da data" do cadastro do medidor enquanto houver piso operacional.
- `opcoes/bens?uso=formulario` lista bem com tanque ativo mesmo que nenhum combustível do tanque seja L/ativo (só UX; a prévia e a confirmação recusam).
- Capacidade de tanque aceita até 9999999999,9999 L (herdado da P1-01).
- A auditoria do reenvio conflitante é best-effort (transação separada); a resposta 409 não depende dela.
- Os portões de concorrência param o comando só em DML; a ausência de ciclo em qualquer intercalação se apoia na prova par a par da ordem (§7), conferida no código.
- `preflightSchemaLib.mjs` não lista as 3 tabelas em `TABELAS_PROTEGIDAS` (a detecção depende de "migrations pendentes", como na P1-01).
- Locks: a migration toma `SHARE ROW EXCLUSIVE` em 9 tabelas antigas até o COMMIT (escritas esperam); o rollback toma `ACCESS EXCLUSIVE` nelas (leitura também espera) — rodar fora de pico.
- O smoke do frontend usa backend falso; a integração real é o INT-1 (no `test:backend`) e o E2E-1 (fora do CI).

## 19. O que NÃO foi feito

- Nenhuma migration aplicada fora do PostgreSQL local; nenhum DDL em Supabase; nenhuma variável Vercel alterada; nenhum deploy promovido; nenhum cadastro de teste em produção; nenhum merge; PR não marcada como ready.
- Sem manutenção, OS, compras, financeiro, custo/hora, depreciação apurada, transferência, mapas, dashboards, saldo de tanque, GNV em tanque de litros, edição de abastecimento confirmado, importação/exportação no servidor, offline próprio.
- X3/X4 (C13). Nenhuma alteração em migrations antigas, no `migration.sql` da P1-01 ou da P3-03, nem nas linhas de `_prisma_migrations`.

## 20. Situação

| Item | Valor |
|---|---|
| CODE_READY | ⟨PREENCHER⟩ (depende do `verify:all` e da CI no HEAD final) |
| SCHEMA_READY_LOCAL | SIM — banco novo local (PG16 e PG17): 39 migrations, reexecução sem pendências, `migrate diff` 0, upgrade de 38 → 39 só acrescenta, rollback ensaiado |
| SCHEMA_APPLIED_PRODUCTION | **NÃO** — nenhum DDL remoto |
| MERGE_READY | **NÃO** — depende da revisão humana, do GO expresso da migration e da aplicação conferida pelo runbook |
| OPERATIONAL_RELEASE_READY | NÃO |

Decisões para aprovação humana: a própria D-PROD-159 (expansão de escopo: abastecimento com baixa física real e fator kg/L informado), o GO da migration em produção pelo runbook e o merge manual. Depois do merge, a tela nasce **sem acesso** para todos os perfis: o proprietário concede `pat-abastecimentos` (e as ações extras) a quem deve usar.
