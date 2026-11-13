# MAIKE-ESTOQUE-P1-02 — Endurecimento do motor único de estoque — Relatório

> Decisão: [D-PROD-183](./DECISIONS.md). Contrato: [`MAIKE-ESTOQUE-P1-CONTRATO.md`](./MAIKE-ESTOQUE-P1-CONTRATO.md) §2 (M2–M6) e §6.2, ratificado pela D-PROD-177.

## 1. Identidade

| Item | Valor |
|---|---|
| Branch | `claude/maike-estoque-p1-02-motor-real` |
| Base | `main` em `6b856962` (merge da PR #254); depois, a `main` em `65ad9d78` (PR #259) entrou por merge commit. Sem rebase e sem force-push |
| PR | Uma só, em DRAFT: "MAIKE-ESTOQUE-P1-02 — Endurecimento do motor único de estoque" |
| CI | `quality`, perfil `full` (D-PROD-179/180): estático, 4 shards de backend e 2 shards de smoke, com o agregador `verify:all`. O run e o SHA verdes estão no corpo da PR e na resposta final da sessão |
| Constituição | D-PROD-177 ratificada na `main`: texto incorporado no merge `b7e5ab11`. Nenhum agente editou `docs/constitution/00`, `07` ou `08` |

## 2. Escopo e limites cumpridos

- **Sem DDL, sem migration e sem mudança no `schema.prisma`.**
- Sem tabela `EntradaEstoque` (fica para a P1-05a).
- Sem frontend, sem rota nova e sem permissão nova.
- Nenhum acesso a produção: Supabase e Vercel não foram lidos nem escritos.
- Todos os testes rodaram em PG17 descartável local (porta 5433), em bancos `maike_p102_*`.
- Os dois SELECTs de pré-checagem foram validados só no banco local, dentro de `BEGIN READ ONLY … ROLLBACK`.

## 3. Matriz M2–M6

### M2 — parâmetros novos do motor (aditivos e opcionais)

| Requisito | Onde |
|---|---|
| Origem `entrada_estoque`, aceita no sistema e na política de exclusão | `estoqueFisicoMotor.js:63` e `:64` (`ORIGENS_SISTEMA`); `:66` (`EXCLUSAO_SOMENTE_EM`) |
| `tipoDetalhado` `entrada_*` só com a origem nova; regex fechada | `estoqueFisicoMotor.js:74`; `rotulosDaEntrada` em `:377` |
| `origem.motivo` obrigatório com a origem nova | `textoInformado` em `:367`; `rotulosDaEntrada` em `:377` |
| `procedencia` em allowlist (`fornecedor_id`, `fornecedor_nome`, `numero_documento`), aplicada só ao lote | `procedenciaDaEntrada` em `:406`; `CAMPOS_PROCEDENCIA_LOTE` em `:1310` |
| Estorno em lote com `efeito: 'ENTRADA'` e rótulos `estorno_entrada_revisao` / `estorno_entrada_exclusao` | `:79`, `:80`, `:83`; `rotulosDoEstornoEmLote` em `:989` |
| Sem parâmetro novo, o comportamento é o da P3, byte a byte | testes P1 e P5 em `estoqueP1M2MotorParametros.test.mjs` |
| A origem nova não tem escritor público (rota e reconciliação só na P1-05a) | teste P7 em `estoqueP1M2MotorParametros.test.mjs`: nenhum arquivo de `backend/src` fora do motor cita a origem |

Violações de contrato de programação (origem desconhecida, chave fora da allowlist) são `Error` e viram 500. Elas não são entrada de usuário: só código interno chama o motor.

### M3 — domínio das unidades {KG, SACO, L}

| Requisito | Onde |
|---|---|
| Cadastro do Produto: `UNIDADES_ESTOQUE`; fora do domínio → 400 `REQUEST_VALIDATION_FAILED` (`unidade_invalida`), antes de gravar | `produtoService.js:171`, `:174`; na criação em `:365`, onde unidade ausente vira `KG`; na edição em `:424` |
| Produto legado continua editável. A checagem só roda quando a unidade muda, e reenviar a mesma unidade legada passa | `produtoService.js:424`, antes de `conferirTrocaDeUnidade` em `:473` |
| Item MERCADORIA da Central: unidade do Produto no domínio (`unidade_produto_invalida`) e unidade do item compatível (`unidade_incompativel`), ambas 422 `OPERACAO_VALORES_INVALIDOS` | `operacaoFinanceiraPlano.js:74`, `:76`, `:400`, `:426` |
| SELECT de pré-checagem, somente leitura | `scripts/ops/sql-editor/estoque-p1-02-precheck-unidades-somente-leitura.sql` |

### M4 — custo e valor negativos

| Requisito | Onde |
|---|---|
| Motor: custo < 0 → `custo_negativo`; valor < 0 → `valor_negativo`. 422 `OPERACAO_VALORES_INVALIDOS`, antes de qualquer leitura; zero é aceito | `estoqueFisicoMotor.js:448`, `:461`, `:466` |
| Plano da Central: `valor_unitario`, desconto e acréscimo < 0 → `valor_negativo`; custo líquido < 0 → `custo_negativo` | `operacaoFinanceiraPlano.js:313`, `:394`, `:535` |

### M5 — invariantes do estorno

| Requisito | Onde |
|---|---|
| Original `Ativa` e com `movimento_filho_id IS NULL`, senão 409 `ESTOQUE_JA_CONSUMIDO` (`original_ja_estornado` ou `original_nao_ativo`) | `exigirOriginalEstornavel` em `estoqueFisicoMotor.js:789` |
| Original da mesma empresa e produto (`vinculo_divergente`) | `:797` |
| Camada lida `FOR UPDATE`, da mesma empresa, produto e local (`camada_divergente`) | `exigirCamadaDaLinha` em `:807`; `estornarEntrada` em `:856`; `estornarEmLote` em `:1087` (lotes) e `:1096` (originais), em ordem de id |
| CAS do original com contagem conferida → 409 `CONCURRENCY_CONFLICT` (`original_alterado`) | `marcarOriginalEstornado` em `:827`; UPDATE em lote com `status='Ativa' AND movimento_filho_id IS NULL` em `:1242` |
| `estornarSaida` (cancelamento de abastecimento) com as mesmas guardas: camadas `FOR UPDATE` em ordem de id e depois o original `FOR UPDATE`, vínculo empresa/produto, camada empresa/produto/local, tudo validado antes da 1ª escrita (**R1 corretiva**, §9) | `estoqueFisicoMotor.js:928`, `:937`, `:944`, `:947`, `:960`, `:980`; `abastecimentoService.js:444`, `:505` |
| SELECT de pré-checagem dos estornos (FINANCEIRO + ABASTECIMENTO), somente leitura | `scripts/ops/sql-editor/estoque-p1-02-precheck-estornos-somente-leitura.sql` |

### M6 / B-03 — replay determinístico

| Requisito | Onde |
|---|---|
| O corpo vira JSON puro antes do recibo, e o 201 devolve esse mesmo objeto | `operacaoIdempotenteService.js:119-129`; `corpoJsonPuro` em `:144` |
| Payload diferente com a mesma chave → 409 `IDEMPOTENCY_CONFLICT`. Fingerprint e recibos legados não mudam | `:62`, `:102`; testes R6-4 e R6-5 |

## 4. Testes

**Arquivos novos**, todos em PG real:

| Arquivo | Testes | Cobre |
|---|---|---|
| `estoqueP1M2MotorParametros.test.mjs` | 8 | P1–P7: padrões idênticos aos da P3; entrada documentada; recusas fail-closed; estorno ENTRADA; origem sem escritor |
| `estoqueP1M3Unidades.test.mjs` | 6 | D1–D5: cadastro; Produto legado editável; Central item × Produto; confirmar com Produto que virou legado; plano puro |
| `estoqueP1M4CustoNegativo.test.mjs` | 6 | N1–N5: motor; zero aceito; limites exatos; plano; HTTP sem recibo |
| `estoqueP1M5EstornoInvariantes.test.mjs` | 6 | I1–I6: duplo estorno; Ativa/filho/vínculo; camada adulterada; outro tenant; rollback total e CAS; `estornarEntrada`/`estornarSaida` |
| `estoqueP1M5Concorrencia.test.mjs` | 5 | K1–K5: reversões concorrentes, com e sem trava do produto; FIFO × reversão; espera no lock da camada; sem deadlock |
| `estoqueP1M6Replay.test.mjs` | 5 | R6-1, R6-3 a R6-6 |

O helper compartilhado é `estoqueP1MCenario.mjs`.

**RED na `main`:**
- R6-1 e R6-6 falham com o serviço de antes. Na transferência entre locais, o replay devolvia número onde o 201 devolveu string.
- Os testes de M3, M4 e M5 exercitam recusas que não existiam antes.

**GREEN:**
- Cada arquivo novo passou duas vezes seguidas com `connection_limit=3`, o pool do runner da CI.
- A suíte inteira de backend rodou em 4 shards locais (`TEST_BACKEND_SHARD=i/4`): shards 1 e 3 com 100% verde.
- O shard 2 teve 1 falha (`catalogoGlobalNativo` CG-08) e o shard 4 teve 4 cancelamentos (`supabasePublicGrantsNativo` BE-P8-GRANTS). Os dois arquivos mexem nos papéis `anon`/`authenticated`, que são globais no cluster PG. Os 4 shards locais compartilhavam o mesmo cluster, então um interferiu no outro.
- Isolados, os dois passam: 41/41 e 4/4. Na CI, cada shard tem o próprio PG.

**Testes existentes ajustados (consequência direta da M3):**
- `produtoUnidadeLitros.test.mjs`: PATCH para `UN` agora dá 400 `unidade_invalida`, e a unidade gravada não muda.
- `patrimonioSimplifica02.test.mjs` C6: PATCH para `UN` agora dá 400 `unidade_invalida`, antes da regra do tanque. Antes dava 409 `aceito_em_tanque`.

**Gates locais:**
- `git diff --check` passou.
- `verify-all.mjs --pular=test:backend,test:smoke` passou: governance-paths, product-scope, no-secrets, tenancy, indices, import-integrity, base44, test:gates, types, typecheck:backend, lint (0 erros), build e build:admin.

## 5. Compatibilidade com a P3

- `reconciliacaoEstoque.js` e `operacaoFinanceiraService.js` não foram alterados.
- `estornarEmLote` deriva `efeito` da `direcao` quando o campo não vem, então os chamadores da Central continuam iguais.
- O P1 da M2 prova, coluna a coluna, que a entrada sem parâmetros novos é idêntica à entrada com os padrões explícitos.

**Mudanças de comportamento intencionais:**
1. Produto com unidade fora de {KG, SACO, L}:
   - não é criado;
   - não troca para essa unidade;
   - não entra como MERCADORIA na Central, com 422 `unidade_produto_invalida`.
2. Valores negativos são recusados pelo nome (`valor_negativo` / `custo_negativo`).
3. Estornos com dado incoerente são recusados com 409, sem alterar nada.

## 6. Achados do revisor D e o que foi feito com cada um

| ID | Achado | Destino |
|---|---|---|
| I1 | `ORIGENS_PROTOCOLO` sem `entrada_estoque` | Adiado para a P1-05a, que traz o escritor e a reconciliação. O teste P7 garante que hoje não há escritor |
| I2 | O bloqueio da unidade legada vale também em criar e substituir rascunho. `conferirTrocaDeUnidade` permite UN→KG mesmo com histórico | Mensagem neutra ("procure o administrador"). **A decisão é do proprietário** (D-PROD-183 item 4) |
| I3 | Dados antigos incoerentes travariam estornos | SELECT de pré-checagem dos estornos |
| I4 | O front (`src/lib/gestaoErros.js`) mostra texto genérico para os reasons novos | Fora do escopo, porque a missão não inclui frontend. Fica pendente para uma PR de front |
| M1/M2 | `movimentoOriginal` e `estornarSaida` usam CAS, não `FOR UPDATE` | Correto por desenho: o CAS com contagem 1 recusa a corrida com 409 e desfaz tudo (testes I5 e I6) |
| M3 | Sem enum de unidade no schema da rota | Proposital: o domínio vive no service, e o 400 é o mesmo |
| M4–M8 | Menores (textos e ordem de checagem) | Registrados aqui; sem efeito funcional |

## 7. GO pendente: pré-checagens em produção

Os dois SELECTs são **somente leitura**: um único SELECT cada, sem DDL, sem DML e sem PII. Eles **não foram executados em produção**. Rodar só com GO explícito do proprietário, antes do deploy:

1. `scripts/ops/sql-editor/estoque-p1-02-precheck-unidades-somente-leitura.sql`. Lista, por cliente, os Produtos com unidade fora de {KG, SACO, L}. Esses produtos deixam de entrar como MERCADORIA.
2. `scripts/ops/sql-editor/estoque-p1-02-precheck-estornos-somente-leitura.sql`. Lista os documentos CONFIRMADOS cujo estorno seria recusado, separados por origem: lançamentos financeiros e abastecimentos (R1, §9.4). A coluna `efeito` separa o que a P1-02 passa a recusar do que já era recusado.

Resultado `NENHUM` nos dois significa que o deploy não muda nada para os dados atuais. Qualquer outra linha vai para o proprietário. Não corrigir por SQL.

## 8. Riscos residuais

1. Produtos legados (por exemplo `UN`) ficam bloqueados como MERCADORIA até que o cadastro seja corrigido. O tamanho do impacto só é conhecido com o SELECT 1.
2. Os textos de erro da tela ainda são genéricos para os reasons novos (I4).
3. A política de UN→KG com histórico e o bloqueio em rascunho dependem de decisão do proprietário (I2).
4. **Operacional, fora desta PR:** o `release-migrate` run `43439565032` falhou fail-closed com `DEPLOY-MIGRATION-URL-REQUIRED`, porque `MIGRATION_DATABASE_URL` estava vazia. É dependência externa. Nada foi configurado, e esta PR não tem migration.

**Desempenho:** a M2 e a M4 só validam em memória. A M5 acrescenta colunas aos SELECTs `FOR UPDATE` que já existiam e um predicado ao UPDATE que já existia. Não há leitura nova por item.

## 9. R1 corretiva (auditoria do arquiteto sobre o HEAD `0f6acc30`)

### 9.1 Causa raiz

A M5 cobria o estorno em lote da Central e `estornarEntrada`, mas não o caminho ativo do cancelamento de abastecimento:

- `abastecimentoService.cancelar` chama `estornarSaida`;
- `estornarSaida` lia o original sem `{empresaId, produtoId}`, ou seja, sem `vinculo_divergente`;
- as fatias eram lidas com `findUnique`, sem `FOR UPDATE` e sem `exigirCamadaDaLinha`.

Consequência provada em PostgreSQL real no HEAD antigo:
- o cancelamento HTTP de um abastecimento cujo movimento original foi adulterado para outro produto respondia **200** e devolvia o estoque;
- uma fatia em lote de outra empresa, produto ou local era devolvida mesmo assim.

### 9.2 Correção

**`estornarSaida`** (`estoqueFisicoMotor.js:928`). Com os produtos já travados por quem chama, a ordem passa a ser:
1. trava as camadas das fatias numa única leitura `FOR UPDATE ORDER BY id`;
2. trava o original `FOR UPDATE`. É a mesma ordem do `estornarEmLote`, então não há inversão entre venda, cancelamento de venda e abastecimento.

Antes da primeira escrita, valida:
- **original**: `Ativa`, sem filho, da empresa e do produto do estorno (`exigirOriginalEstornavel` com vínculo);
- **cada fatia**:
  - lote existente;
  - empresa, produto e local iguais aos da linha (`exigirCamadaDaLinha`);
  - situação `Disponivel` ou `Esgotado`;
  - devolução somada por lote menor ou igual à entrada.

As escritas continuam com CAS no lote e no original. Numeração, AuditLog e cache seguem na mesma transação. Não houve transação nova.

**Abastecimento** (`abastecimentoService.js`):
- a pré-leitura do original deixou de usar `FOR UPDATE`, porque a trava passou ao motor na ordem canônica;
- a pré-leitura continua respondendo os motivos que a tela já conhece (`movimento_inexistente` / `movimento_estornado`);
- tradução dos novos erros do motor:
  - `original_ja_estornado` / `original_nao_ativo` → `movimento_estornado`, motivo já conhecido;
  - `vinculo_divergente` e `camada_divergente` → motivos novos de `ABASTECIMENTO_CANCELAMENTO_BLOQUEADO` (409), com mensagem do servidor.

  A tela atual mostra o texto genérico "o estoque de origem mudou" para esses dois. Isso é honesto (recusa, nada alterado), e não houve mudança de frontend.

Não houve mudança de controle de versão nem de checagem da unidade efetiva.

### 9.3 Provas (PostgreSQL 17 real, `connection_limit=3`)

| Teste | RED no HEAD `0f6acc30` | GREEN |
|---|---|---|
| `estoqueP1M5EstornoInvariantes` I7: vínculo do original (produto/empresa), camada da 2ª fatia (empresa/produto/local), lote inexistente, duas fatias devolvidas cada uma ao seu lote, outro tenant sem oráculo | falha: "a chamada deveria ter sido recusada" | 8/8 |
| `estoqueP1M5Concorrencia` K6: espera real no `FOR UPDATE` da camada e no do original, conferida em `pg_stat_activity`; recusa com o estado novo antes de escrever; dois estornos do mesmo original fora do protocolo → um só | 2 falhas | 7/7, K5 sem deadlock |
| `patrimonioP1Abastecimentos` AB11: HTTP, original de outro produto/empresa → `vinculo_divergente`; lote de outro produto/empresa/local → `camada_divergente`; nada alterado | **200** (cancelou) onde devia dar 409 | 15/15 |
| `estoqueP1PrecheckEstornosSql` (novo): o `.sql` real, numa transação READ ONLY; S5 com venda de 2 itens no mesmo lote | S5 falha com o SQL da 1ª versão da R1 | 2/2 |

Regressão verde: `patrimonioP1AbastecimentosConcorrencia` (11), `…Seguranca` (8), `…ContratoTela` (3), `patrimonioSimplificaAbastecimentos` (10), `gestaoP3Rodada2` (13), mais as demais suítes da P3, M2–M6 e do Patrimônio na CI `full`.

### 9.4 Pré-checagem dos estornos ampliada

`estoque-p1-02-precheck-estornos-somente-leitura.sql` continua sendo um único SELECT, agora sobre:
- **FINANCEIRO**: `OperacaoFinanceira` CONFIRMADO, item MERCADORIA, lote da compra e `OperacaoFinanceiraConsumoLote`;
- **ABASTECIMENTO**: `AbastecimentoBem` CONFIRMADO, `movimentacao_estoque_id` e `AbastecimentoBemConsumoLote` → `EstoqueLoteNota`.

Motivos detectados:
- original inexistente, não ativo ou já estornado;
- `vinculo_divergente`;
- `camada_divergente`;
- fatias que não fecham, lote sem devolução possível e devolução acima da entrada.

A coluna `efeito` separa `NOVA_RECUSA`, o impacto real do release, de `JA_RECUSAVA`. A compra com lote já consumido fica fora: é recusa normal, não dado incoerente. A saída tem só ids técnicos e contagens.

Validação:
- o teste automatizado roda o arquivo numa transação READ ONLY (`transaction_read_only=on`, nunca commita);
- dados limpos (2 abastecimentos, um com 2 fatias, e 1 compra) dão só `NENHUM`;
- abastecimento adulterado dá `ABASTECIMENTO/NOVA_RECUSA/vinculo_divergente`, e o cancelamento real recusa com o mesmo motivo;
- camadas adulteradas aparecem nas duas origens;
- o estado do banco fica idêntico antes e depois;
- no `psql`, `BEGIN READ ONLY; \i …; ROLLBACK` deu exit 0 nos dois arquivos.

Revisão adversarial da R1 (3 lentes; 2 céticos por achado), com um achado confirmado e corrigido:
- **Achado:** no ramo `devolucao_excede_entrada`, o SQL somava as fatias por item. O estorno em lote acumula a devolução no mesmo lote entre os itens da venda. Isso gerava falso negativo, de efeito `JA_RECUSAVA`, em venda com dois itens no mesmo lote.
- **Correção:** agora a soma é por documento no lote.
- **Prova:** teste S5, RED com o SQL anterior e GREEN com o atual. O cancelamento real recusa no 2º item, com `disponivel` 90 = 30 + 60.

Também ficou explícito no cabeçalho que `efeito` é do **motivo**: um documento em `NOVA_RECUSA` pode já ser recusado por outro motivo anterior.

**Produção não foi consultada; o GO continua pendente.**

### 9.5 I2: decisão do proprietário, não implementada

Fatos verificados:
- `conferirTrocaDeUnidade` bloqueia só trocas que envolvem L e unidade não aceita por tanque. **UN→KG com histórico físico passa.**
- Rascunho de MERCADORIA com Produto legado é recusado (422 `unidade_produto_invalida`), porque o plano é o mesmo da confirmação.
- Retificação de lançamento CONFIRMADO que mantém a linha de Produto legado é recusada com 422 e a mensagem "procure o administrador". Porém, a elegibilidade (`avaliarElegibilidade`) continua respondendo `editar.permitido=true`.
  - Não alterei isso: bloquear a edição inteira impediria a saída legítima, que é substituir a linha.
  - Uma correção fina da elegibilidade é escolha de política, ligada ao I2.
- Cancelar e excluir não passam pelo plano e continuam funcionando.

Recomendação arquitetural, como **proposta** e não implementada:
1. manter o rascunho com Produto legado fail-closed até a unidade ser regularizada;
2. recusar UN→KG (e qualquer troca a partir de unidade fora do domínio) quando o Produto tiver saldo, camada, movimento ou item de lançamento;
3. preservar KG↔SACO e as regras de L da D-PROD-162;
4. nunca converter estoque ou valor por inferência.

Critério operacional de release:
- o SELECT de unidades mostra por cliente, em `itens_por_status`, quantos itens CONFIRMADOS ficariam presos;
- com `NENHUM`, nenhuma tela mente;
- com linhas, o deploy espera a decisão I2.

### 9.6 Bandeiras desta rodada

- `CODE_READY` só vale com a CI `full` verde no novo HEAD (run e SHA no corpo da PR e na resposta final).
- `MERGE_READY` é decisão do proprietário após a auditoria.
- `RELEASE_READY=NÃO`: GO dos dois SELECTs e decisão I2 pendentes.

## 10. Bandeiras

```
CODE_READY=SIM
RELEASE_READY=NÃO        (GO dos 2 SELECTs — unidades e estornos FINANCEIRO+ABASTECIMENTO — e decisão I2 pendentes)
SCHEMA_APPLIED=N/A       (sem migration)
DB_WRITES_PRODUCAO=0
CONSTITUTION_RATIFIED=SIM (D-PROD-177 na main, merge b7e5ab11)
CI_READY=ver o corpo da PR e a resposta final (run e SHA do HEAD exato)
```
