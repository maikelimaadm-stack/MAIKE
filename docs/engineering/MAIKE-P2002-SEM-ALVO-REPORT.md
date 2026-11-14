# MAIKE-P2002-SEM-ALVO — Relatório

**`claude/relaxed-cori-51av1f`** · PR #275 (rascunho) · Decisão: [D-PROD-195](./DECISIONS.md) · Origem: o achado fora do escopo da Fatia D do apontamento ([`MAIKE-APONTAMENTO-ITENS-REPORT.md`](./MAIKE-APONTAMENTO-ITENS-REPORT.md) §9)

## 1. Entrega

Em produção o runtime (`maike_vercel`) não é dono das tabelas e elas têm RLS: o PostgreSQL omite o DETAIL da violação de unique e o Prisma 6.19.3 devolve o P2002 com `meta.target` nulo. Todo ponto que traduzia o P2002 casando o alvo com o nome da coluna caía no 409 `CONCURRENCY_CONFLICT` genérico, que o frontend trata como transitório e manda repetir.

Depois desta missão, **nenhuma tradução de P2002 depende só do alvo**: cada uma tem um caminho sem ele, provado sob um papel não dono com RLS, como em produção.

| Camada | O que mudou |
|---|---|
| `emTransacao` (`backend/src/shared/prisma/transacaoConcorrente.js`) | o mapa `unicos` passa a ser de `UniqueDeNegocio { erro, conferir }`, obrigatório pelo tipo. Com o alvo, o trecho decide como antes. Sem o alvo, a chave é conferida depois do rollback, numa leitura nova. `alvoDaUnique` é o único leitor do alvo no backend; `soPeloAlvo` marca as entradas que só valem pelo alvo (lista fechada, sob trava) |
| Abastecimento (`patrimonio/abastecimentoService.js`) | pré-conferência da `operation_id` dentro da transação, antes de tudo (o molde da D-PROD-193), e a mesma função como conferência do mapa |
| Item do apontamento (`apontamentosAtividade/apontamentoAtividadeItemService.js`) | a pré-conferência que já existia vira também a conferência do mapa; a `ordem` fica `soPeloAlvo` |
| Financeiro (`financeiro/operacaoFinanceiraService.js`) | documento `soPeloAlvo` (sem mudança de comportamento: a mesma transação já confere sob a trava `chaveDocumento`); o estorno da liquidação ganha conferência real, a mesma pré-conferência de antes |
| Patrimônio (`patrimonio/patrimonioComum.js`) | sem mudança de comportamento: o alvo é lido por `alvoDaUnique`; as pré-conferências sob trava já eram o caminho sem alvo |
| Empresa (`empresas/empresaUniqueViolation.js`, `empresaService.js`) | sem o alvo, confere o nome e o número reservado depois do rollback |
| MAIKE Admin (`adminMaike/adminClientesGestaoService.js`) | sem o alvo, o `meta.modelName` diz a unique (`Cliente` → código, `Usuario` → login) |
| Testes | `backend/tests/p2002SemAlvo.test.mjs` (10 casos, sob o papel não dono), `papelNaoDono.mjs` (o helper do IT4g extraído), `empresaUniqueViolation.test.mjs` com o caminho sem alvo |
| Documentos | D-PROD-195, este relatório, `CURRENT-STATE`, `GATE-REGISTRY` (o que só o banco prova) e a nota de resolvido no §9 do relatório da Fatia D |

Sem migration, sem rota, sem contrato HTTP novo, sem mudança no frontend. Os códigos de erro são os de antes: o que muda é que, em produção, chega o código certo.

## 2. O defeito, medido

Medido no PostgreSQL 16 de teste por uma sonda fora do repositório, com o papel não dono do IT4g (`SET LOCAL ROLE` num papel sem BYPASSRLS, RLS ligado sem FORCE e política `FOR ALL … USING (true) WITH CHECK (true)`, a `maike_backend_all` de produção). As linhas do `create` (dono e papel) e do SQL bruto ficam fixadas no teste U0:

| Como | `code` | `meta` | mensagem |
|---|---|---|---|
| dono, `tx.cliente.create` duplicado | `P2002` | `{ modelName: 'Cliente', target: ['codigo'] }` | "Unique constraint failed on the fields: (`codigo`)" |
| papel não dono, o mesmo `create` (também `createMany`, `update`, `updateMany`) | `P2002` | `{ modelName: 'Cliente', target: null }` | "Unique constraint failed on the (not available)" |
| papel não dono, `INSERT` em SQL bruto | `P2010` | `{ code: '23505', message: 'Unique constraint failed: ' }` | sem constraint nem coluna |
| papel não dono, `createManyAndReturn({ skipDuplicates: true })` | — | devolve `[]`, sem erro | — |

**O nome da constraint não chega por nenhum caminho do Prisma 6.19 (motor em Rust).** O PostgreSQL ainda o manda: no `psql` (`\set VERBOSITY verbose`), sob o mesmo papel, o erro traz `duplicate key value violates unique constraint "Cliente_codigo_key"` e `CONSTRAINT NAME: Cliente_codigo_key`; só o DETAIL (`Key (codigo)=(…) already exists.`) some. O conector do Prisma monta o alvo só a partir do DETAIL e, sem ele, marca "não disponível". Por isso a opção "casar pelo nome da constraint quando disponível" não existe neste stack; só o `meta.modelName` sobra.

**O P2003 (FK) não é afetado.** Na mesma sonda, sob o papel não dono, o INSERT com FK inexistente e o DELETE barrado por FK RESTRICT chegam como P2003 com `meta.constraint` (por exemplo, `Usuario_cliente_id_fkey`), igual ao dono; o SQL bruto (P2010 com `23503`) traz o nome na mensagem. As traduções por FK do backend — `criarAbastecimento` (o aceite do tanque, `tanque_id_produto_id_fkey`) e `vinculoComApontamentoAtividade` no `errorHandler.js` (D-PROD-190) — continuam certas em produção.

## 3. Antes e depois, sob o papel não dono

Os mesmos testes, rodados contra o código anterior (cada correção desfeita no próprio arquivo, com cópia de segurança, e restaurada em seguida; o `git diff` conferido depois):

| Caso | Antes | Depois |
|---|---|---|
| Abastecimento: a `operation_id` de um abastecimento gravado volta sem o recibo (A1) | 409 `CONCURRENCY_CONFLICT` "registro já existe" (o cliente repete a mesma chave para sempre) | 409 `IDEMPOTENCY_CONFLICT`, nada gravado, reenvio auditado |
| Abastecimento: a chave é ocupada depois da pré-conferência (A2, corrida com portão) | 409 `CONCURRENCY_CONFLICT` | 409 `IDEMPOTENCY_CONFLICT`, pela conferência depois do rollback |
| Mapa genérico do `emTransacao` com a chave ocupada (U1) | o P2002 cru (409 `CONCURRENCY_CONFLICT`) | o erro de negócio do mapa, nada gravado |
| Empresa: duas criações em corrida com o mesmo nome (E1) | 201 + 409 `CONCURRENCY_CONFLICT` "Conflito ao salvar a empresa." | 201 + 409 `EMPRESA_NAME_CONFLICT` |
| MAIKE Admin: dois clientes em corrida com o mesmo código (M1) | 201 + 409 **`ADMIN_LOGIN_DUPLICADO`** (código errado) | 201 + 409 `ADMIN_CLIENTE_CODIGO_DUPLICADO` |
| MAIKE Admin: dois PATCH em corrida para o mesmo código (M1) | 409 `ADMIN_LOGIN_DUPLICADO` (pelo código: o tradutor antigo responde "login" para todo P2002 sem alvo; o M1 antigo já para na corrida do criar) | 409 `ADMIN_CLIENTE_CODIGO_DUPLICADO` |

Como dono das tabelas (CI e testes de antes), o alvo existe e nada disso aparecia: por isso os testes antigos estavam verdes com o defeito em produção.

## 4. Inventário: todos os tradutores de P2002 do backend

| Ponto | Dependia só do alvo? | Caminho sem o alvo |
|---|---|---|
| `shared/prisma/transacaoConcorrente.js` — mapa `unicos` do `emTransacao` | **sim** | conferência da chave depois do rollback (`UniqueDeNegocio.conferir`) |
| `patrimonio/abastecimentoService.js` — `operation_id` | **sim**, e sem pré-conferência | pré-conferência na transação + conferência no mapa |
| `apontamentosAtividade/apontamentoAtividadeItemService.js` — `operation_id` | não (pré-conferência da D-PROD-193) | a mesma função, agora também no mapa |
| `apontamentosAtividade/apontamentoAtividadeItemService.js` — `ordem` | o erro é o mesmo 409 transitório do caminho genérico | `soPeloAlvo`: a ordem nasce sob o FOR UPDATE do apontamento |
| `financeiro/operacaoFinanceiraService.js` — documento (confirmar e retificar) | não: a mesma transação confere o documento sob `travarEscopo(chaveDocumento)` antes de gravar | `soPeloAlvo` (a chave nasce dentro da transação) |
| `financeiro/operacaoFinanceiraService.js` — estorno da liquidação | não: pré-conferência sob o FOR UPDATE do título | a pré-conferência (`estornoDaLiquidacao`) também no mapa |
| `patrimonio/patrimonioComum.js` — `comUnicosEstaveis` (frota; código e nome do tipo) | não: pré-conferências sob `travarEscopo('patrimonio:frota:…')` e `travarCatalogo`, de todos os escritores | sem mudança; o alvo por `alvoDaUnique` |
| `empresas/empresaUniqueViolation.js` | **sim** (o nome em corrida) | conferência do nome e do número depois do rollback |
| `adminMaike/adminClientesGestaoService.js` | **sim** (e dava o código errado) | `meta.modelName` |
| `usuarios/usuarioService.js`, `adminMaike/adminService.js` (2), `catalogoGlobal/catalogoRevisao.js`, `catalogoGlobal/catalogoGlobalService.js`, `estoquePecuarioLedger/ledgerPecuarioComandoService.js`, `shared/errors/errorHandler.js` | não leem o alvo: traduzem pelo comando que falhou, relêem o vencedor, tentam de novo ou são o genérico | sem mudança |

O inventário é **fechado por teste** (S1): o alvo só é lido em `alvoDaUnique`; quem usa `alvoDaUnique` são exatamente o patrimônio, a empresa e o admin; `soPeloAlvo` aparece exatamente no financeiro (documento) e no item do apontamento (ordem). Um tradutor novo, ou uma entrada `soPeloAlvo` nova, reprova até ser inventariado.

## 5. Como foi feito

1. **Medição primeiro.** Um script de sonda (fora do repositório) gravou o erro exato do Prisma como dono, como papel não dono e pelo SQL bruto (§2). Daí saíram as três opções reais: pré-conferência, conferência depois do rollback e `meta.modelName`.
2. **O mecanismo genérico no `emTransacao`.** A transação do P2002 está abortada, então a única conferência genérica possível é depois do rollback, numa leitura nova. Ela é segura porque o PostgreSQL só acusa a unique contra linha commitada (contra linha em voo ele espera o desfecho): quem ocupou a chave já está visível. Conferência que falha conta como "não": o erro original segue o caminho de antes.
3. **O tipo como gate.** `unicos` é `Record<string, UniqueDeNegocio>`; com `checkJs`, o `typecheck:backend` (tolerância zero) reprova a fábrica solta de antes. Conferido por mutação: `TS2322: Type '() => AppError' is not assignable to type 'UniqueDeNegocio'`.
4. **Cada ponto com a técnica que cabe:** pré-conferência onde a chave pode chegar sem recibo (abastecimento); conferência depois do rollback onde a chave é conhecida (abastecimento, item, liquidação, empresa); `meta.modelName` onde o model identifica a unique (admin); `soPeloAlvo` onde a chave nasce dentro da transação e já é conferida sob trava (documento do financeiro, ordem do item).
5. **Testes no molde do IT4g.** O helper `comPapelNaoDono` saiu do teste da Fatia D para `backend/tests/papelNaoDono.mjs` (o IT4g passa a importá-lo, com a mesma checagem de RLS da tabela de itens). As corridas usam um portão (gatilho BEFORE que espera um advisory lock do teste) e `pg_blocking_pids`, como `patrimonioP1AbastecimentosConcorrencia.test.mjs`.
6. **Mutações.** Cada correção desfeita no próprio arquivo (com cópia de segurança), rodado o teste, restaurado o arquivo e conferido o `git diff` (§6).

### Por que não `ON CONFLICT … DO NOTHING RETURNING`

Funciona sob o papel (§2), mas exigiria reescrever o INSERT de cada chamador (o do abastecimento grava 25 colunas e passa pela FK do aceite do tanque, traduzida à parte) e não resolve o mapa genérico, que é o que vários serviços usam. A conferência depois do rollback é uma peça só, resolve a corrida e não muda o caminho feliz.

## 6. Validação

### Testes novos (`backend/tests/p2002SemAlvo.test.mjs`, PostgreSQL real, sob o papel não dono)

| Teste | Prova |
|---|---|
| U0 | a pré-condição de §2: com o dono há alvo; sob o papel, `target` nulo com `modelName`; nem o SQL bruto diz a constraint; fora do helper o app volta ao dono |
| U1 | sem o alvo, o mapa do `emTransacao` dá o erro de negócio pela conferência, que roda uma vez, depois do rollback (não vê a escrita desfeita) e também como o papel; nada gravado |
| U2 | como dono, o trecho do alvo decide e a conferência nem roda; trecho fora do alvo segue o caminho de antes (P2002 cru → 409 `CONCURRENCY_CONFLICT`); `soPeloAlvo` vale pelo alvo |
| U3 | sob o papel, chave livre, conferência que falha, `soPeloAlvo` e mapa vazio seguem o caminho genérico, sem mascarar o erro; nada gravado |
| A1 | o abastecimento inteiro roda sob o papel (controle); a unique `(cliente_id, operation_id)` violada sob o papel vem sem alvo; sem o recibo, a mesma chave dá 409 `IDEMPOTENCY_CONFLICT` com outro corpo, com o mesmo corpo e acima do saldo (a chave vem antes do motor); nada gravado (abastecimento, fatia, movimento, lote, estoque, recibo, sequência); cada reenvio auditado |
| A2 | corrida: o pedido para no portão do movimento (a pré-conferência já passou), a chave é ocupada por fora e commita; aberto o portão, o P2002 sem alvo vira 409 `IDEMPOTENCY_CONFLICT` pela conferência; nada gravado; auditado |
| E1 | corrida de duas empresas com o mesmo nome, a 2ª esperando a numeração da 1ª (`pg_blocking_pids`): 201 + 409 `EMPRESA_NAME_CONFLICT`; uma empresa só; a reserva do perdedor volta |
| M1 | corridas do MAIKE Admin com portão: criar com o mesmo código, criar com o mesmo login, editar para o mesmo código → os códigos certos; sem cliente órfão nem cliente sem administrador |
| M2 | o tradutor do admin: `Cliente` → código, `Usuario` → login, outro model ou sem model → o próprio erro (409 genérico); com o alvo, como antes |
| S1 | o inventário fechado de §4 |

`backend/tests/empresaUniqueViolation.test.mjs` (5): com o alvo, como antes e sem rodar conferência; sem o alvo, nome → número → genérico, e conferência que falha não mascara.

### Provas por mutação (todas pegas, pelo motivo certo)

Cada mutação foi aplicada no arquivo do repositório com cópia de segurança, rodado só o teste indicado e o arquivo restaurado; o `git diff` foi conferido depois de cada uma.

| Mutação | Teste que pegou | Como falhou |
|---|---|---|
| `emTransacao` sem a conferência (só o alvo, como antes) | U1, A2 | U1: o P2002 cru em vez do `AppError`; A2: 409 `CONCURRENCY_CONFLICT` |
| abastecimento sem a pré-conferência (só a conferência do mapa) | A1 | o reenvio "acima do saldo" chega ao motor: 422 `ESTOQUE_SALDO_INSUFICIENTE` em vez de 409 |
| empresa sem a conferência do nome | E1 | 409 `CONCURRENCY_CONFLICT` "Conflito ao salvar a empresa." |
| admin sem o model `Cliente` | M1, M2 | 409 `CONCURRENCY_CONFLICT` na corrida do código |
| abastecimento e `emTransacao` como antes (sem as duas) | A1 | 409 `CONCURRENCY_CONFLICT` "registro já existe" |
| admin como antes (só o alvo) | M1 | 409 `ADMIN_LOGIN_DUPLICADO` na corrida do código |
| fábrica solta no mapa do abastecimento | `typecheck:backend` | `TS2322` |

### Suítes existentes

Rodadas localmente (PostgreSQL 16.15, Node 22) as suítes que tocam os arquivos alterados, como dono das tabelas, mais as duas desta missão: apontamento (nativo, itens nativo com o IT4g, itens concorrência), abastecimento (nativo, concorrência, contrato da tela, medidor, segurança), patrimônio (bens, catálogos, segurança, simplifica 02, abastecimentos, concorrência, migration, permissões, produtos do tanque), Gestão P3 (concorrência, custo líquido, editar/excluir, estoque, financeiro, lançamentos, patrimônio combinado, rateio por item, rodada 2, segurança, litros), empresa (numeração e tradução), MAIKE Admin (gestão de clientes) e `p2002SemAlvo`: **32 arquivos, 472/472**. Também `test:gates` 829/829, `typecheck:backend` sem diagnóstico e `lint` sem erro (os 2 avisos são de `src/pages/CategoriasManejo.jsx` e `src/pages/Produtos.jsx`, anteriores a esta missão).

### `npm run verify:all`

Rodado localmente no head `7213c90` (esta branch já integrada com a `main` `a65ea46`), com o banco de teste **recriado do zero** (as 49 migrations aplicadas pelo runner de deploy, como na CI), PostgreSQL 16.15 e Node 22; sem `NODE_ENV` no ambiente (o `verify:all` fixa `production` no build). O GitHub Actions do proprietário está pausado (§8, R7), então esta é a verificação de registro desta PR, como na PR #273.

- `test:gates`: 846/846;
- `test:backend`: 148 arquivos, 1887 testes, 1882 passaram, 0 falharam, 5 `todo` (do roteiro do ledger pecuário, anteriores a esta missão);
- `test:smoke`: 226 arquivos, 2805/2805.

```
  test:gates           PASS           0      73.7s  npm run test:gates
  governance-paths     PASS           0      181ms  npm run gate:governance-paths
  package-sync         PASS           0      150ms  npm run gate:package-sync
  product-scope        PASS           0      604ms  npm run gate:product-scope
  api-boundary         PASS           0       2.1s  npm run gate:api-boundary
  native-api           PASS           0      228ms  npm run gate:native-api
  setor-native         PASS           0      237ms  npm run gate:setor-native
  marca-native         PASS           0      196ms  npm run gate:marca-native
  unidade-medida-native PASS           0      208ms  npm run gate:unidade-medida-native
  tarefa-cadastro-native PASS           0      176ms  npm run gate:tarefa-cadastro-native
  lote-native          PASS           0      217ms  npm run gate:lote-native
  lancamento-tarefa-native PASS           0      234ms  npm run gate:lancamento-tarefa-native
  p52-cadastros-estoque-native PASS           0      258ms  npm run gate:p52-cadastros-estoque-native
  p54-base44-exit      PASS           0      156ms  npm run gate:p54-base44-exit
  p55-base44-exit-final PASS           0      167ms  npm run gate:p55-base44-exit-final
  area-pastagem-native PASS           0      222ms  npm run gate:area-pastagem-native
  map-geography-native PASS           0      209ms  npm run gate:map-geography-native
  usuario-admin        PASS           0      169ms  npm run gate:usuario-admin
  source-closure       PASS           0      238ms  npm run gate:source-closure
  import-integrity     PASS           0      217ms  npm run gate:import-integrity
  admin-isolation      PASS           0      194ms  npm run gate:admin-isolation
  no-secrets           PASS           0       1.9s  npm run gate:no-secrets
  base44               PASS           0      210ms  npm run gate:base44
  modelobase1-pecuario PASS           0      143ms  npm run gate:modelobase1-pecuario
  motorbase1-independence PASS           0      746ms  npm run gate:motorbase1-independence
  tenancy              PASS           0      232ms  npm run gate:tenancy
  rebanho-ssot         PASS           0      178ms  npm run gate:rebanho-ssot
  indices              PASS           0      154ms  npm run gate:indices
  deploy-migrations    PASS           0      201ms  npm run gate:deploy-migrations
  supabase-public-grants PASS           0      144ms  npm run gate:supabase-public-grants
  prisma:generate      PASS           0       2.6s  npm run prisma:generate
  types                PASS           0      14.5s  npm run gate:types
  typecheck:backend    PASS           0      11.2s  npm run typecheck:backend
  lint                 PASS           0      13.8s  npm run lint
  test:backend         PASS           0    1561.1s  npm run test:backend
  test:smoke           PASS           0     203.4s  npm run test:smoke
  build                PASS           0      19.7s  npm run build
  build:admin          PASS           0       1.6s  npm run build:admin
  admin-isolation:bundles PASS           0      246ms  npm run gate:admin-isolation

  Total: 1912.1s

TODAS AS ETAPAS PASSARAM

verify:all exit=0
```

## 7. Divergências em relação ao molde do PROJETOMG

Nenhuma. A tradução continua na camada de serviço (API → service → repository → Prisma); o contrato de erros é o de antes; nenhuma solução paralela: o mecanismo novo é o mesmo `emTransacao` de sempre, com o mapa tipado, e o helper de teste saiu do IT4g em vez de ser copiado.

## 8. Riscos

| # | Risco | Tratamento |
|---|---|---|
| R1 | Uma versão futura do Prisma deixar de mandar o `meta.modelName` | o admin cai no caminho genérico (409 `CONCURRENCY_CONFLICT`), nunca num código errado; U0 e M1 ficam vermelhos e avisam |
| R2 | Uma versão futura do Prisma passar a mandar o alvo sob RLS (ou o motor sem Rust/adaptadores mandarem o nome da constraint) | o caminho com alvo é o de antes, intacto; as conferências deixam de rodar. U0 fica vermelho e avisa para revisar |
| R3 | A conferência roda depois do rollback: se a linha que ocupou a chave sumir nesse intervalo, não há conferência | o resultado é o caminho de antes (409 genérico), e o reenvio cai na pré-conferência. As chaves conferidas (`operation_id`, estorno da liquidação) não são apagadas; nome e número da empresa raramente mudam no mesmo instante |
| R4 | Custo da conferência | só no caminho de falha (P2002 sem alvo), uma leitura por unique do mapa, numa transação curta (2 s/5 s). O caminho feliz não muda; a pré-conferência do abastecimento é uma leitura pelo índice da unique |
| R5 | Uma entrada nova no mapa sem conferência | o tipo reprova (`typecheck:backend`); `soPeloAlvo` novo reprova o S1 até ser inventariado |
| R6 | A PR #273 foi mergeada na `main` (`a65ea46`) enquanto esta corria | integrada por merge, sem rebase: o único conflito foi o fim do `DECISIONS.md` (as duas decisões entraram, D-PROD-194 antes da D-PROD-195). A #273 não toca em nenhum tradutor de P2002 |
| R7 | O GitHub Actions está pausado na conta do proprietário: a CI `quality` da PR morre em ~2 s, sem executar passos e sem log (o mesmo na `main` `a65ea46` e na #273) | a verificação de registro é o `verify:all` local acima; dito uma vez na PR. Quando o Actions voltar, a CI da PR roda a mesma cadeia |

## 9. Fora do escopo

- As traduções de P2003 (FK): não dependem do alvo e não são afetadas pelo RLS (§2). Não foram tocadas.
- Uma suspeita conferida e descartada: o nome da empresa em caixas diferentes, em corrida, não passa duas vezes. O serviço grava o nome em maiúsculas (`trim().toUpperCase()` em `normalizarEntrada`), então a unique exata `(cliente_id, nome)` já não diferencia caixa: a 2ª criação leva 409 `EMPRESA_NAME_CONFLICT` (conferido no código e numa corrida com portão, numa sonda descartável fora do repositório).
- Nada no frontend: os códigos de erro são os mesmos.

## 10. Decisões que precisam de aprovação humana

- **D-PROD-195** inteira, em especial: o mapa do `emTransacao` passar a exigir a conferência (`UniqueDeNegocio`); a conferência depois do rollback como mecanismo genérico; o uso do `meta.modelName` no admin; e a lista fechada de `soPeloAlvo` (documento do financeiro e ordem do item do apontamento).
- Nenhum texto constitucional muda.
