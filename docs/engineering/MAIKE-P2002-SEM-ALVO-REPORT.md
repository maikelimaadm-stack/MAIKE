# MAIKE-P2002-SEM-ALVO — Relatório

**`claude/relaxed-cori-51av1f`** · PR #275 (rascunho) · Decisão: [D-PROD-253](./DECISIONS.md) · Origem: o achado fora do escopo da Fatia D do apontamento ([`MAIKE-APONTAMENTO-ITENS-REPORT.md`](./MAIKE-APONTAMENTO-ITENS-REPORT.md) §9)

## 1. Entrega

Em produção o runtime (`maike_vercel`) não é dono das tabelas e elas têm RLS: o PostgreSQL omite o DETAIL da violação de unique e o Prisma 6.19.3 devolve o P2002 com `meta.target` nulo. Todo ponto que traduzia o P2002 casando o alvo com o nome da coluna caía no 409 `CONCURRENCY_CONFLICT` genérico, que o frontend trata como transitório e manda repetir.

Depois desta missão, **nenhuma tradução de P2002 depende só do alvo**: cada uma tem um caminho sem ele, provado sob um papel não dono com RLS, como em produção.

Durante a missão, a `main` `3a329d90` (PRs #276 a #329) trouxe o Lançamento de Atividades (módulo `atividades`, D-PROD-200 a D-PROD-251) e o Cadastro de Culturas (D-PROD-215), com o mesmo defeito, e apagou o apontamento antigo (D-PROD-200), onde a Fatia D tinha a pré-conferência que serviu de molde. Os dois módulos novos entraram no inventário e foram corrigidos no merge, pelo código integrado.

| Camada | O que mudou |
|---|---|
| `emTransacao` (`backend/src/shared/prisma/transacaoConcorrente.js`) | o mapa `unicos` passa a ser de `UniqueDeNegocio { erro, conferir }`, obrigatório pelo tipo. Com o alvo, o trecho decide como antes. Sem o alvo, a chave é conferida depois do rollback, numa leitura nova. `alvoDaUnique` é o único leitor do alvo no backend; `soPeloAlvo` marca as entradas que só valem pelo alvo (lista fechada, sob trava) |
| Abastecimento (`patrimonio/abastecimentoService.js`) | pré-conferência da `operation_id` dentro da transação, antes de tudo (o molde da D-PROD-193), e a mesma função como conferência do mapa; o P2003 do aceite do tanque passa a ler o `meta` por campo |
| Lançamento de Atividades (`atividades/…`) | linhas de máquina, de mão de obra e de serviço: pré-conferência da `operation_id` no início das escritas que gravam linha (lançar, editar) e a mesma conferência no mapa; linha de produto, lançamento do dia com chave e área: a pré-conferência que já existia vira também a conferência do mapa; a ordem das linhas e a sequência do apontamento ficam `soPeloAlvo` |
| Culturas (`culturas/culturaService.js`) | o alvo por `alvoDaUnique`; sem ele, o caminho genérico em vez do palpite "nome" (a pré-conferência sob a trava da fazenda já dá o código certo no reenvio) |
| Financeiro (`financeiro/operacaoFinanceiraService.js`) | documento `soPeloAlvo` (sem mudança de comportamento: a mesma transação já confere sob a trava `chaveDocumento`); o estorno da liquidação ganha conferência real, a mesma pré-conferência de antes |
| Patrimônio (`patrimonio/patrimonioComum.js`) | sem mudança de comportamento: o alvo é lido por `alvoDaUnique`; as pré-conferências sob trava já eram o caminho sem alvo |
| Empresa (`empresas/empresaUniqueViolation.js`, `empresaService.js`) | sem o alvo, confere o nome e o número reservado depois do rollback |
| MAIKE Admin (`adminMaike/adminClientesGestaoService.js`) | sem o alvo, o `meta.modelName` diz a unique (`Cliente` → código, `Usuario` → login) |
| Testes | `backend/tests/p2002SemAlvo.test.mjs` (14 casos, sob o papel não dono), `papelNaoDono.mjs` (o helper do IT4g extraído), `empresaUniqueViolation.test.mjs` com o caminho sem alvo |
| Documentos | D-PROD-253, este relatório, `CURRENT-STATE`, `GATE-REGISTRY` (o que só o banco prova) e a nota de resolvido no §9 do relatório da Fatia D |

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
| Lançamento de Atividades: a chave de uma linha de máquina ou de mão de obra volta sem o recibo, ao lançar ou ao editar (L1) | 409 `CONCURRENCY_CONFLICT` "registro já existe" (o cliente repete a mesma chave para sempre) | 409 `IDEMPOTENCY_CONFLICT`, nada gravado, reenvio auditado (também na linha de serviço, que usa o mesmo esqueleto) |
| Culturas: corrida pelo mesmo código (C1) | 409 `CULTURA_NAME_CONFLICT` (o campo errado: foi o código que colidiu) | 409 `CONCURRENCY_CONFLICT`; o reenvio → 409 `CULTURA_CODIGO_CONFLICT` pela pré-conferência |

Como dono das tabelas (CI e testes de antes), o alvo existe e nada disso aparecia: por isso os testes antigos estavam verdes com o defeito em produção.

## 4. Inventário: todos os tradutores de P2002 do backend

| Ponto | Dependia só do alvo? | Caminho sem o alvo |
|---|---|---|
| `shared/prisma/transacaoConcorrente.js` — mapa `unicos` do `emTransacao` | **sim** | conferência da chave depois do rollback (`UniqueDeNegocio.conferir`) |
| `patrimonio/abastecimentoService.js` — `operation_id` | **sim**, e sem pré-conferência | pré-conferência na transação + conferência no mapa |
| `atividades/atividadeApontamentoMaquinaService.js` e `atividades/atividadeLinhaCustoComum.js` (linhas de máquina, de mão de obra e de serviço) — `operation_id` | **sim**, e sem pré-conferência | pré-conferência no início das escritas que gravam linha (lançar, editar; o cancelar não grava) + conferência no mapa |
| `atividades/atividadeApontamentoProdutoService.js` (linha de produto) — `operation_id` | não (pré-conferência da D-PROD-202) | a mesma função, agora também no mapa |
| `atividades/atividadeApontamentoService.js` (lançamento do dia com chave) — `operation_id` | não (pré-conferência das chaves derivadas `:p`, `:o`, `:s`, D-PROD-202 e D-PROD-207) | a mesma conferência, agora também no mapa. A linha de máquina do lançamento deriva a chave do id do apontamento (`criarLinhasMaquina`): não colide com a do pedido |
| `atividades/atividadeAreaService.js` — `area_id` | não (pré-conferência sob a trava da atividade, D-PROD-249) | a mesma busca, agora também no mapa |
| `atividades/…` — `ordem`/`apontamento_ordem` das linhas e `sequencia` do apontamento | o erro é o mesmo 409 transitório do caminho genérico | `soPeloAlvo`: nascem sob o FOR UPDATE da atividade |
| `estoqueEntradas/entradaEstoqueService.js` — o `criar` (D-PROD-257, merge da PR #340) | só pelo alvo (fábrica solta), e nem com o alvo casa: nenhuma unique gravada tem `operation_id`, a idempotência é o recibo | `{ erro, conferir }` com a conferência no recibo da chave; com o alvo, como antes. Sem a conversão, o `typecheck:backend` reprova o merge (`TS2322`) |
| `culturas/culturaService.js` — `comConflitoEstavel` (código e nome) | lia o alvo pelo `meta` inteiro e, sem ele, respondia "nome" para todo P2002 (o código em corrida, errado). Sem efeito na prática: todos os escritores conferem código e nome sob `travarFazenda` | `alvoDaUnique`; sem o alvo, o caminho genérico, e o reenvio cai na pré-conferência |
| `financeiro/operacaoFinanceiraService.js` — documento (confirmar e retificar) | não: a mesma transação confere o documento sob `travarEscopo(chaveDocumento)` antes de gravar | `soPeloAlvo` (a chave nasce dentro da transação) |
| `financeiro/operacaoFinanceiraService.js` — estorno da liquidação | não: pré-conferência sob o FOR UPDATE do título | a pré-conferência (`estornoDaLiquidacao`) também no mapa |
| `patrimonio/patrimonioComum.js` — `comUnicosEstaveis` (frota; código e nome do tipo) | não: pré-conferências sob `travarEscopo('patrimonio:frota:…')` e `travarCatalogo`, de todos os escritores | sem mudança; o alvo por `alvoDaUnique` |
| `empresas/empresaUniqueViolation.js` | **sim** (o nome em corrida) | conferência do nome e do número depois do rollback |
| `adminMaike/adminClientesGestaoService.js` | **sim** (e dava o código errado) | `meta.modelName` |
| `usuarios/usuarioService.js`, `adminMaike/adminService.js` (2), os nomes de `gestao/centroService.js`, `gestao/naturezaFinanceiraService.js`, `formulacoes/formulacaoService.js`, `estacoes/estacaoService.js` e `curvasGanho/curvaGanhoService.js` (`ehViolacaoDeUnique`), o nome do motivo de entrada (`estoqueEntradas/motivoEntradaEstoqueService.js`, D-PROD-259), `catalogoGlobal/catalogoRevisao.js`, `catalogoGlobal/catalogoGlobalService.js`, `estoquePecuarioLedger/ledgerPecuarioComandoService.js`, `shared/errors/errorHandler.js` | não leem o alvo: traduzem pelo comando que falhou, relêem o vencedor, tentam de novo ou são o genérico | sem mudança |

O inventário é **fechado por teste** (S1): o alvo só é lido em `alvoDaUnique`, e fora dele o `meta` do erro só se lê por campo (`constraint`, `field_name`, `modelName`, `code`, `message`), nunca inteiro (`JSON.stringify(erro.meta)`, `erro['meta']`, `{ meta } = erro`), que foi como o tradutor das culturas escapou da primeira versão do S1. Quem usa `alvoDaUnique` são exatamente o patrimônio, as culturas, a empresa e o admin; `soPeloAlvo` aparece exatamente no financeiro (documento) e no Lançamento de Atividades (a ordem das linhas e a sequência do apontamento). Um tradutor novo, ou uma entrada `soPeloAlvo` nova, reprova até ser inventariado.

## 5. Como foi feito

1. **Medição primeiro.** Um script de sonda (fora do repositório) gravou o erro exato do Prisma como dono, como papel não dono e pelo SQL bruto (§2). Daí saíram as três opções reais: pré-conferência, conferência depois do rollback e `meta.modelName`.
2. **O mecanismo genérico no `emTransacao`.** A transação do P2002 está abortada, então a única conferência genérica possível é depois do rollback, numa leitura nova. Ela é segura porque o PostgreSQL só acusa a unique contra linha commitada (contra linha em voo ele espera o desfecho): quem ocupou a chave já está visível. Conferência que falha conta como "não": o erro original segue o caminho de antes.
3. **O tipo como gate.** `unicos` é `Record<string, UniqueDeNegocio>`; com `checkJs`, o `typecheck:backend` (tolerância zero) reprova a fábrica solta de antes. Conferido por mutação: `TS2322: Type '() => AppError' is not assignable to type 'UniqueDeNegocio'`.
4. **Cada ponto com a técnica que cabe:** pré-conferência onde a chave pode chegar sem recibo (abastecimento, linhas do Lançamento de Atividades); conferência depois do rollback onde a chave é conhecida (abastecimento, linhas, lançamento do dia, área, liquidação, empresa); `meta.modelName` onde o model identifica a unique (admin); `soPeloAlvo` onde a chave nasce dentro da transação e já é conferida sob trava (documento do financeiro, ordem das linhas e sequência do apontamento); o caminho genérico onde todo escritor já confere as uniques sob trava (patrimônio, culturas).
5. **Testes no molde do IT4g.** O helper `comPapelNaoDono` saiu do teste da Fatia D para `backend/tests/papelNaoDono.mjs`; o IT4g o importava até a `main` apagar o apontamento antigo (D-PROD-200), e agora só esta missão o usa. As corridas usam um portão (gatilho BEFORE que espera um advisory lock do teste) e `pg_blocking_pids`, como `patrimonioP1AbastecimentosConcorrencia.test.mjs`.
6. **Mutações.** Cada correção desfeita no próprio arquivo (com cópia de segurança), rodado o teste, restaurado o arquivo e conferido o `git diff` (§6).
7. **O merge da `main` `3a329d90`.** Integrada por merge, sem rebase. O tipo do mapa reprovou os mapas novos do módulo `atividades` (fábricas soltas, `TS2322`), que foram convertidos no próprio merge, para todo commit ficar verde. A releitura do inventário depois do merge achou as culturas, que leem o alvo pelo `meta` inteiro e escapavam da regex do S1; o S1 passou a reprovar essa forma.

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
| L1 | Lançamento de Atividades: a chave de uma linha de mão de obra, de serviço ou de máquina já gravada, sem o recibo, dá 409 `IDEMPOTENCY_CONFLICT` ao lançar e ao editar; nada gravado (linhas, apontamento, versão, recibos); cada reenvio auditado |
| L2 | o lançamento do dia com chave e linhas de mão de obra: sem o recibo, a mesma chave (outro corpo e o mesmo corpo) dá 409 `IDEMPOTENCY_CONFLICT`; nada gravado, nem o apontamento |
| L3 | a chave de uma linha de produto já gravada, sem o recibo, dá 409 `IDEMPOTENCY_CONFLICT`; a mesma área de novo na atividade dá 422 `ja_na_atividade`; nada gravado |
| C1 | culturas, corrida pelo mesmo código com portão no INSERT (o código ocupado por fora depois da pré-conferência): como dono → 409 `CULTURA_CODIGO_CONFLICT`, como antes; sob o papel → 409 `CONCURRENCY_CONFLICT`, nunca "nome", e o reenvio → `CULTURA_CODIGO_CONFLICT`; nada gravado |
| S1 | o inventário fechado de §4, inclusive o `meta` inteiro |

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
| Lançamento de Atividades (máquina, mão de obra e serviço, produto, lançamento do dia, área): só a pré-conferência tirada | nenhum: L1–L3 continuam verdes | a conferência depois do rollback responde o código certo sob o papel (prova que cada `conferir` está certo) |
| os mesmos cinco sem a pré-conferência e sem a conferência (a máquina e a mão de obra ficam como na `main`) | L1, L2, L3 | 409 `CONCURRENCY_CONFLICT` "registro já existe", o defeito de produção |
| o tradutor antigo das culturas | C1, S1 | C1: `CULTURA_NAME_CONFLICT` na corrida do código; S1: o `meta` inteiro em `culturaService.js` |
| o P2003 do aceite do tanque pelo `meta` inteiro, como antes | S1 | o `meta` inteiro em `abastecimentoService.js` |

### Suítes existentes

Rodadas localmente (PostgreSQL 16.15, Node 22), como dono das tabelas, as suítes que tocam os arquivos alterados:

- antes do merge da `main` `3a329d90`: apontamento antigo (nativo, itens nativo com o IT4g, itens concorrência), abastecimento (nativo, concorrência, contrato da tela, medidor, segurança), patrimônio (bens, catálogos, segurança, simplifica 02, abastecimentos, concorrência, migration, permissões, produtos do tanque), Gestão P3 (11 arquivos), empresa (numeração e tradução), MAIKE Admin (gestão de clientes) e `p2002SemAlvo`: **32 arquivos, 472/472**;
- depois do merge: Lançamento de Atividades (linhas de máquina, de mão de obra, de serviço e de produto, apontamento nativo, áreas, abastecimento da atividade, atividade nativa, integração da tela), abastecimento (nativo, concorrência, simplifica abastecimentos e concorrência), MAIKE Admin, empresa (tradução e numeração), Gestão P3 (concorrência, financeiro, editar/excluir): **19 arquivos, 319/319**; depois da correção das culturas e do P2003 do aceite: culturas (nativo, área com cultura), abastecimento (simplifica concorrência, segurança, nativo, simplifica abastecimentos, contrato da tela): **7 arquivos, 76/76**; e `p2002SemAlvo` **14/14**.

A verificação de registro é o `verify:all` abaixo, que roda todas.

### `npm run verify:all`

Rodado localmente no head `946b5965` (esta branch integrada com a `main` `3a329d90`), com o banco de teste **recriado do zero** (as 68 migrations aplicadas pelo runner de deploy, como na CI), PostgreSQL 16.15 e Node 22; sem `NODE_ENV` no ambiente (o `verify:all` fixa `production` no build).

- `test:gates`: 1038/1038;
- `test:backend`: 176 arquivos, 2370 testes, 2364 passaram, 0 falharam, 6 `todo` (5 do roteiro do ledger pecuário e 1 da suplementação, anteriores a esta missão);
- `test:smoke`: 297 arquivos, 3682/3682.

```
  ETAPA                RESULTADO   EXIT    DURAÇÃO  COMANDO
  test:gates           PASS           0      61.5s  npm run test:gates
  governance-paths     PASS           0      132ms  npm run gate:governance-paths
  package-sync         PASS           0      126ms  npm run gate:package-sync
  product-scope        PASS           0      461ms  npm run gate:product-scope
  api-boundary         PASS           0       1.9s  npm run gate:api-boundary
  native-api           PASS           0      207ms  npm run gate:native-api
  setor-native         PASS           0      183ms  npm run gate:setor-native
  marca-native         PASS           0      162ms  npm run gate:marca-native
  unidade-medida-native PASS           0      195ms  npm run gate:unidade-medida-native
  tarefa-cadastro-native PASS           0      189ms  npm run gate:tarefa-cadastro-native
  lote-native          PASS           0      190ms  npm run gate:lote-native
  lancamento-tarefa-native PASS           0      204ms  npm run gate:lancamento-tarefa-native
  p52-cadastros-estoque-native PASS           0      241ms  npm run gate:p52-cadastros-estoque-native
  p54-base44-exit      PASS           0      132ms  npm run gate:p54-base44-exit
  p55-base44-exit-final PASS           0      146ms  npm run gate:p55-base44-exit-final
  area-pastagem-native PASS           0      193ms  npm run gate:area-pastagem-native
  map-geography-native PASS           0      176ms  npm run gate:map-geography-native
  usuario-admin        PASS           0      145ms  npm run gate:usuario-admin
  source-closure       PASS           0      216ms  npm run gate:source-closure
  import-integrity     PASS           0      200ms  npm run gate:import-integrity
  admin-isolation      PASS           0      200ms  npm run gate:admin-isolation
  no-secrets           PASS           0       1.9s  npm run gate:no-secrets
  base44               PASS           0      156ms  npm run gate:base44
  modelobase1-pecuario PASS           0      126ms  npm run gate:modelobase1-pecuario
  motorbase1-independence PASS           0      567ms  npm run gate:motorbase1-independence
  tenancy              PASS           0      216ms  npm run gate:tenancy
  rebanho-ssot         PASS           0      157ms  npm run gate:rebanho-ssot
  indices              PASS           0      138ms  npm run gate:indices
  deploy-migrations    PASS           0      200ms  npm run gate:deploy-migrations
  supabase-public-grants PASS           0      136ms  npm run gate:supabase-public-grants
  prisma:generate      PASS           0       3.1s  npm run prisma:generate
  types                PASS           0      14.4s  npm run gate:types
  typecheck:backend    PASS           0      12.1s  npm run typecheck:backend
  lint                 PASS           0      21.8s  npm run lint
  test:backend         PASS           0    1860.5s  npm run test:backend
  test:smoke           PASS           0     215.2s  npm run test:smoke
  build                PASS           0      18.3s  npm run build
  build:admin          PASS           0       1.3s  npm run build:admin
  admin-isolation:bundles PASS           0      200ms  npm run gate:admin-isolation

  Total: 2217.6s

TODAS AS ETAPAS PASSARAM

verify:all exit=0
```

**A CI da PR rodou a mesma cadeia no mesmo head e ficou verde** (o GitHub Actions voltou; §8, R7): `classify`, `verify:full` (estático, backend 1/4 a 4/4, smoke 1/2 e 2/2) e o agregado `verify:all`. Depois do `946b5965` vieram só documentos (com uma linha de comentário no `abastecimentoService.js`), a renumeração para D-PROD-253 (só texto) e dois merges da `main`, os dois só de frontend e sem arquivo de código em comum com esta branch: `0981d262` (PR #330) e `633f75f0` (PR #331). A #330 quebrou dois testes de smoke (`mapaDepositoLitros` e `leituraCocho`), e a CI do `f7d3417e` ficou vermelha só no `smoke 1/2`, como a da própria `main` no `0981d262`. A #331 corrigiu esses testes na `main`. Depois veio o merge da `main` `9d791735` (PR #332, D-PROD-254), que mexeu no módulo `atividades` sem conflito de texto: o `POST /atividades/registrar` novo grava pelo mesmo `comReciboOpcional` convertido aqui (pré-conferência das chaves derivadas e conferência no mapa), e as escritas novas do cabeçalho usam mapa vazio; `typecheck:backend`, o S1 e as suítes do módulo (205/205, com o `atividadeRegistro` novo) passaram. A CI da PR cobre o head final.

Antes, no head `7213c90` (integrado com a `main` `a65ea46`), o mesmo `verify:all` local tinha passado: 39 etapas, backend 1882/1887 com 5 `todo`, smoke 2805/2805, gates 846/846.

## 7. Divergências em relação ao molde do PROJETOMG

Nenhuma. A tradução continua na camada de serviço (API → service → repository → Prisma); o contrato de erros é o de antes; nenhuma solução paralela: o mecanismo novo é o mesmo `emTransacao` de sempre, com o mapa tipado, e o helper de teste saiu do IT4g em vez de ser copiado.

## 8. Riscos

| # | Risco | Tratamento |
|---|---|---|
| R1 | Uma versão futura do Prisma deixar de mandar o `meta.modelName` | o admin cai no caminho genérico (409 `CONCURRENCY_CONFLICT`), nunca num código errado; U0 e M1 ficam vermelhos e avisam |
| R2 | Uma versão futura do Prisma passar a mandar o alvo sob RLS (ou o motor sem Rust/adaptadores mandarem o nome da constraint) | o caminho com alvo é o de antes, intacto; as conferências deixam de rodar. U0 fica vermelho e avisa para revisar |
| R3 | A conferência roda depois do rollback: se a linha que ocupou a chave sumir nesse intervalo, não há conferência | o resultado é o caminho de antes (409 genérico), e o reenvio cai na pré-conferência. As chaves conferidas (`operation_id`, estorno da liquidação) não são apagadas; nome e número da empresa raramente mudam no mesmo instante |
| R4 | Custo da conferência | só no caminho de falha (P2002 sem alvo), uma leitura por unique do mapa, numa transação curta (2 s/5 s). O caminho feliz não muda, salvo as pré-conferências novas (abastecimento e linhas de máquina, de mão de obra e de serviço), cada uma uma leitura pelo índice da unique |
| R5 | Uma entrada nova no mapa sem conferência | o tipo reprova (`typecheck:backend`); `soPeloAlvo` novo reprova o S1 até ser inventariado |
| R6 | A `main` andou enquanto esta corria: a PR #273 (`a65ea46`), as PRs #276 a #329 (`3a329d90`), a PR #330 (`0981d262`), a PR #331 (`633f75f0`), a PR #332 (`9d791735`) e, depois, as PRs #333 a #341 (até `095b057d`; a #340 trouxe as Entradas de Estoque, com o mapa convertido no merge, e a #341 a D-PROD-259, cujo tradutor do motivo é pelo comando) | integradas por merge, sem rebase. No primeiro, o único conflito foi o fim do `DECISIONS.md`; no terceiro, nenhum (só frontend); no quarto, o fim do `DECISIONS.md` e o topo do `CURRENT-STATE.md`, porque a #331 usou a D-PROD-252: esta decisão passou a D-PROD-253 (a 252 da #331 ficou intacta); no quinto, a PR #332 (`9d791735`), de novo só esses dois documentos: a #332 deixou a 253 reservada e usou a D-PROD-254, e o código dela no módulo `atividades` entrou sem conflito de texto e já coberto (§6). No segundo, o fim do `DECISIONS.md` e o topo do `CURRENT-STATE.md`, e o apontamento antigo que a `main` apagou (D-PROD-200), aceito com as mudanças desta branch nele; os mapas novos do módulo `atividades` foram convertidos no próprio merge (o tipo os reprovava) e as culturas corrigidas pela releitura do inventário |
| R7 | O GitHub Actions esteve pausado na conta do proprietário: a CI `quality` da PR morria em ~2 s, sem executar passos e sem log (o mesmo na `main` `a65ea46` e na #273) | a verificação de registro foi o `verify:all` local, dito uma vez na PR. O Actions voltou em 2026-11-18: a CI da PR rodou a cadeia inteira no `946b5965` e ficou verde (§6) |
| R8 | Um tradutor novo que leia o alvo por um caminho que nenhuma regex do S1 pega (por exemplo, percorrer as chaves do erro) | o S1 reprova `.target`, `['target']`, o `meta` inteiro (`.meta`, `['meta']`) e a desestruturação de `target` e de `meta`; outro caminho passa, e a revisão humana continua sendo a última rede. O AGENTS.md avisa a armadilha |

## 9. Fora do escopo

- As traduções de P2003 (FK): não dependem do alvo e não são afetadas pelo RLS (§2). Não foram tocadas, salvo a do aceite do tanque, que passou a ler o `meta` por campo (o mesmo resultado; o S1 reprova o `meta` inteiro).
- Uma suspeita conferida e descartada: o nome da empresa em caixas diferentes, em corrida, não passa duas vezes. O serviço grava o nome em maiúsculas (`trim().toUpperCase()` em `normalizarEntrada`), então a unique exata `(cliente_id, nome)` já não diferencia caixa: a 2ª criação leva 409 `EMPRESA_NAME_CONFLICT` (conferido no código e numa corrida com portão, numa sonda descartável fora do repositório).
- Nada no frontend: os códigos de erro são os mesmos.

## 10. Decisões que precisam de aprovação humana

- **D-PROD-253** inteira, em especial: o mapa do `emTransacao` passar a exigir a conferência (`UniqueDeNegocio`); a conferência depois do rollback como mecanismo genérico; o uso do `meta.modelName` no admin; as culturas e o patrimônio, sem o alvo, seguirem o caminho genérico (409 transitório) em vez de um código por palpite; e a lista fechada de `soPeloAlvo` (documento do financeiro; ordem das linhas e sequência do apontamento do Lançamento de Atividades).
- Nenhum texto constitucional muda.
