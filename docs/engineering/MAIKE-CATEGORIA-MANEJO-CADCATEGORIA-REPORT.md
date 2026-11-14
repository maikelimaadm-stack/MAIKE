FATIA: MAIKE-CATEGORIA-MANEJO-CADCATEGORIA
BRANCH: feat/categoria-manejo-cadcategoria
PR: #268

# MAIKE-CATEGORIA-MANEJO-CADCATEGORIA — Relatório (Fatia D)

Decisão: [D-PROD-187](./DECISIONS.md) · Runbook:
[`MAIKE-CATEGORIA-MANEJO-CADCATEGORIA-RUNBOOK-RELEASE.md`](./MAIKE-CATEGORIA-MANEJO-CADCATEGORIA-RUNBOOK-RELEASE.md)
· Base: `origin/main` `dba4a8c` (merge da PR #264, Fatia C)

> **Release NÃO EXECUTADA.** Nada foi aplicado nem lido em produção nesta fatia. Preflight e
> aplicação dependem de GO explícito do proprietário (runbook §2). A release exige **acesso
> bloqueado** durante a janela: o `RENAME` não tem janela compatível com o código anterior.

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | migration CONTRACT nova `20261113500000_categoria_manejo_cadcategoria`. Faz, nesta ordem: guarda DO; `DROP CONSTRAINT` da FK do ícone; `DROP INDEX` do índice do ícone; `DROP COLUMN` das 16 colunas (as 15 dormentes da Fatia C e `catalogo_categoria_visual_id`); `RENAME TO "CADCATEGORIA"`; os 4 renames de pkey, unique, índice e FK. Sem `CASCADE` e sem `IF EXISTS` |
| Prisma | model `CategoriaManejo` com `@@map("CADCATEGORIA")`. Saem as 15 linhas `@ignore`, o campo do ícone, a relação `catalogoCategoriaVisual`, o índice dele e a relação inversa em `CatalogoCategoriaVisual`. O delegate continua `prisma.categoriaManejo`. `migrate diff --exit-code` vazio depois da migration |
| Portão de release | terceira entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS` (guarda pinada, `drop: []`, literais `CategoriaManejo` e `CADCATEGORIA`, 23 instruções pinadas); a migration no manifesto; o classificador ganha `constraints_removidas`, `indices_removidos`, `tabelas_renomeadas` e `nomes_renomeados`; o rótulo do premerge e a linha de uso citam `--contract D-PROD-187` |
| Backend | `categoriaManejoService.js` sem `validarVinculoCatalogo` e sem o campo em `comoPublico`. `catalogo_categoria_visual_id` entrou em `CHAVES_LEGADAS_IGNORADAS`: aceito e ignorado, 201/200. O repository não seleciona mais o campo. `exigirCategoriaVisualLoteVinculavel` e `CODIGO_TIPO_LOTE` saíram de `catalogoValidacao.js`, sem outro uso. `helpers.mjs` não solta mais o vínculo antes da limpeza |
| Frontend | o seletor "Ícone oficial (catálogo MAK Gestão)" saiu de `FormularioCategoriaManejo.jsx`. O campo saiu de `normalizarCategoriaManejo` e de `CAMPOS_GRAVAVEIS` da porta nativa. A prévia do ícone saiu do `FormularioLote.jsx`: as 2 ocorrências e o cálculo `categoriaVisualIdDoLote`. Foram apagados `IconeOficialLotePreview.jsx`, `CategoriaOficialCatalogoSelect.jsx` e `src/services/catalogoGlobalService.js`, que ficaram sem uso, e `listarIconesDeLoteDaEmpresa`, que já não tinha uso. A porta `@/apis/catalogoGlobal`, só leitura, fica. Nada de visual novo |
| Operação | `preflightSchemaLib.mjs` exige `CADCATEGORIA.idade_minima_meses` no lugar de `CategoriaManejo.catalogo_categoria_visual_id`. Os scripts 01–04 do SQL Editor trocam o nome físico na lista de tabelas de tenant |
| Ensaio | `scripts/dev/ensaio-categoria-manejo-cadcategoria.mjs`, só contra banco local |
| Testes | novo `backend/tests/categoriaManejoCadcategoriaMigration.test.mjs`, além de premerge, barreira do runner, alvo, preflight, contagens das CONTRACT irmãs, backend e smokes (§5) |
| Documentos | D-PROD-187, runbook, este relatório, `CURRENT-STATE` e `GATE-REGISTRY` |

`base44/entities/CategoriaManejo.jsonc` já não tinha o campo. `config/modelobase1-pecuario.json`
e os gates de schema não citavam o campo, o índice nem a relação. Ficam sem mudança: rotas,
permissões, menu, escopo, `entidade: 'CategoriaManejo'` no AuditLog e a entidade offline.

## 2. As 23 instruções pinadas

O plano previa 22: 15 `DROP COLUMN`, 1 `RENAME TO` e 6 renames. A emenda do proprietário mudou
para 23: o ícone sai, com a FK e o índice removidos explicitamente, e com eles saem 2 renames.

```text
 1 ALTER TABLE "CategoriaManejo" DROP CONSTRAINT "CategoriaManejo_catalogo_categoria_visual_id_fkey"
 2 DROP INDEX "CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx"
 3 ALTER TABLE "CategoriaManejo" DROP COLUMN "raca"
 4 ALTER TABLE "CategoriaManejo" DROP COLUMN "categoria_oficial"
 5 ALTER TABLE "CategoriaManejo" DROP COLUMN "ganho_peso_anual_kg"
 6–17 ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_janeiro" … "gmd_dezembro" (12, em ordem de mês)
18 ALTER TABLE "CategoriaManejo" DROP COLUMN "catalogo_categoria_visual_id"
19 ALTER TABLE "CategoriaManejo" RENAME TO "CADCATEGORIA"
20 ALTER TABLE "CADCATEGORIA" RENAME CONSTRAINT "CategoriaManejo_pkey" TO "CADCATEGORIA_pkey"
21 ALTER INDEX "CategoriaManejo_cliente_id_id_key" RENAME TO "CADCATEGORIA_cliente_id_id_key"
22 ALTER INDEX "CategoriaManejo_cliente_id_empresa_id_idx" RENAME TO "CADCATEGORIA_cliente_id_empresa_id_idx"
23 ALTER TABLE "CADCATEGORIA" RENAME CONSTRAINT "CategoriaManejo_cliente_id_fkey" TO "CADCATEGORIA_cliente_id_fkey"
```

- O recorte do classificador compara cada instrução normalizada com o texto pinado. Por isso
  `DROP INDEX` e `ALTER INDEX … RENAME TO` foram pinados sem mudar a lógica do recorte.
- No caminho EXPAND, `RENAME` e `DROP INDEX` continuam recusados (`ALTER_EM_TABELA_ANTIGA` /
  `SQL_NAO_RECONHECIDO`). Os testes B15d e B15f provam isso.
- **Hashes:** SHA-256 do arquivo `83ca58a07439a1cf4e12671fd5f6b89bf62be2aef7ff64112cca6f1418d37e1c`;
  guarda `0efa2ef32dd4faf3d2419896521a6a62552f89c1af8d151b6cf1eb2495c3e384`. Os dois foram
  calculados com `sha256`/`norm`/`semComentarios` da própria lib.
- O número da decisão fica fora do `migration.sql`. As mensagens da guarda começam com
  `categoria_manejo_cadcategoria:`.

## 3. A guarda (trava própria)

Primeira instrução, com hash pinado, falha fechada.

1. `lock_timeout` 5 s, `statement_timeout` 120 s, `pg_advisory_xact_lock(72707369)`.
2. `CategoriaManejo` existe. O nome `CADCATEGORIA` está livre, como relação e como tipo. Depois,
   `LOCK TABLE … ACCESS EXCLUSIVE`.
3. As 16 colunas existem: 2 × `varchar(128)`, 13 × `numeric(14,4)`, 1 × `varchar(64)`; anuláveis,
   sem default, sem identidade, não geradas.
4. Índices = exatamente os 4 de hoje; constraints (fora `NOT NULL`) = exatamente as 3 de hoje; os 3
   nomes novos de índice estão livres (`to_regclass`).
5. `pg_depend`: nenhum dependente das 16 colunas, fora o índice e a FK do ícone (removidos antes,
   pelo nome e restritos a esta tabela).
6. Rotinas: nenhuma função ou procedure fora dos schemas do sistema cita, sem distinguir
   maiúsculas e com `\m…\M`, `categoriamanejo` ou as 16 colunas, no corpo ou em `proargnames`.
7. Impressão `maike.categoria_manejo_legado_impressao`: `left(md5(…), 12)` de
   `concat_ws('|', cliente_id, id, quote_nullable(16 colunas))` sobre as linhas com
   `num_nonnulls(…) > 0`, na ordem `cliente_id, id` (`COLLATE "C"`). Com linhas, ou com o parâmetro
   informado, ela tem de ser igual. Sem linhas, o parâmetro é dispensado; vazio = `d41d8cd98f00`.

Nenhum `DO` vem depois do DDL. A guarda só cita `CategoriaManejo` e `CADCATEGORIA` no padrão que
o classificador confere, e não tem `--`, `/*` nem `$$` dentro de strings.

## 4. Sem janela compatível

Diferente da D-PROD-183, o `RENAME` quebra o código anterior. O código da `main` de hoje dá
`P2021` contra o banco migrado, e o código novo dá `P2021` contra o banco antigo. Consequências,
todas no runbook:
- **acesso bloqueado** pelo proprietário durante a janela;
- caminho B esperado;
- *Instant Rollback* da Vercel para antes do merge desta PR **proibido** depois da aplicação;
- Previews de branches sem esta PR não podem ser usadas.

## 5. Validação local (PostgreSQL 16, bancos descartáveis, nada remoto)

| Prova | Resultado |
|---|---|
| `prisma migrate deploy` num banco novo + `prisma migrate diff --exit-code` | 43 migrations; `CADCATEGORIA` com 12 colunas, 3 índices e 2 constraints; **No difference detected** (exit 0) |
| `node scripts/dev/ensaio-categoria-manejo-cadcategoria.mjs --url …/postgres` | **OK**. 14/14 RED recusados sem mudar nada; o runner sem `MIGRATION_CONTRACT_AUTORIZADO` recusou antes de qualquer DDL; GREEN: 43/0, mesmo OID, ACL, RLS e políticas, 12 colunas, linhas idênticas, nomes novos, FK válida, `migrate diff` 0, `categoriaManejo.findMany()` = 8 linhas, 2ª execução "No pending" |
| `backend/tests/categoriaManejoCadcategoriaMigration.test.mjs` | **20/20** (CD-01, 14 CD-RED, CD-02 a CD-06), ~60 s |
| Envelope do caminho B (runbook §5), aplicado com `psql -c` num banco local no estado de produção (42 migrations e legado) | sem o parâmetro de ensaio: `RELEASE_BLOCKED: alvo divergente`. Com impressão errada: recusado pela guarda, nada mudou. Com a impressão certa: aplicou (43/0, `CADCATEGORIA` com 12 colunas, mesmo OID, linhas iguais, checksum `83ca58a0…`, `applied_steps_count` 1). Repetido: `RELEASE_BLOCKED: migration já registrada`. `migrate diff` 0 |
| `tipoTarefaDropColunasMigration` + `patrimonioSimplificaMigration` | 29/29. Partem de 42 migrations; a D-PROD-187 entra fora de ordem na D-PROD-183 sem problema |
| `premerge-migrate.test.mjs` | 51/51 (novos B15a–B15j) |
| `migrations.test.mjs`, `alvo-banco.test.mjs`, `preflight-schema.test.mjs` | verdes (novo B16) |
| Smokes afetados (`catalogoGlobalLote`, `categoriaManejoEnxuto`, `manejoServices`, `motorbase1Batch01`, `manejoBoundary`) | 104/104 |
| `npm run verify:all` (banco novo) | verde (§6.1) |

## 6. `npm run verify:all`

Rodado com `DATABASE_URL` num banco PostgreSQL 16 local recém-criado, `AUTH_SECRET` local (≥ 32
caracteres) e `FRONTEND_ORIGINS=http://localhost:5173`. Resultado por etapa: preenchido na
seção 6.1 depois da execução.

### 6.1 Resultado

Rodada final em 2026-11-13, com a `main` do hotfix #266 incorporada.

| Etapa | Resultado |
|---|---|
| `test:gates` | 824/824 |
| `test:backend` | 1.742 testes: 1.737 passam, 0 falham, 5 todo |
| `test:smoke` | 217 arquivos, 2.640/2.640 |
| Gates (`tenancy`, `indices`, `deploy-migrations`, `supabase-public-grants`, `import-integrity`, `product-scope`, `base44`, `modelobase1-pecuario`, …) | passam |
| `source-closure` | falhou na primeira rodada: `src/apis/catalogoGlobal/*` ficou sem consumidor depois que o ícone saiu. Os 3 arquivos foram apagados (o painel admin tem cliente próprio) e o gate passou (584/584 alcançáveis); smokes de novo 2.640/2.640 e `test:gates` 824/824 |
| `types` | 625 / teto 625, sem regressão |
| `typecheck:backend`, `lint`, `build`, `build:admin`, `admin-isolation:bundles` | passam |

### 6.2 Depois do merge da `main` com a PR #265 (CADESTACOES, `776befe`)

A `main` trouxe a EXPAND `20261113400000_cadestacoes_cadastro` (D-PROD-188), já aplicada em
produção. O repositório passa a ter **44** migrations: esta CONTRACT parte de **43** concluídas e
termina com **44**; 81 tabelas antes e depois. Conflitos resolvidos mantendo os dois lados:
`MIGRATIONS_APROVADAS` com a CADESTACOES antes desta (ordem dos timestamps; `MIGRATIONS_CONTRACT_APROVADAS`
igual), contagens de `patrimonioSimplificaMigration` (43 → 44 migrations; 87/88/81 tabelas),
`tipoTarefaDropColunasMigration` (43 → 44), os ensaios correspondentes, B1 do `premerge-migrate`,
D-PROD-187/D-PROD-188 em `DECISIONS.md` e os dois blocos de missão em `CURRENT-STATE.md`. Este teste
e o ensaio desta fatia passam a esperar 43 → 44.

Rodada em 2026-11-13, banco PostgreSQL 16 local recém-criado:

| Etapa | Resultado |
|---|---|
| `test:gates` | 824/824 |
| `test:backend` (140 arquivos) | 1.765 testes: 1.760 passam, 0 falham, 5 todo |
| `test:smoke` | 218 arquivos, 2.652/2.652 |
| `source-closure` | 591/591 alcançáveis |
| `types` | 625 / teto 625 |
| Demais gates, `prisma:generate`, `typecheck:backend`, `lint`, `build`, `build:admin`, `admin-isolation:bundles` | passam — **TODAS AS ETAPAS PASSARAM** (1.633 s) |
| Ensaio local | `ok: true`; 14/14 RED recusados; runner sem autorização recusou; GREEN 44/0, 12 colunas, `migrate diff` 0, 2ª execução sem pendência |

**Ensaio local** (`scripts/dev/ensaio-categoria-manejo-cadcategoria.mjs`, rodada anterior ao merge): `ok: true`. Os 14
cenários RED recusam sem mudar nada (sem impressão, impressão errada, índice, índice extra, visão,
visão do ícone, política, função, função com o nome físico, função em caixa mista, `RETURNS
TABLE`, `CADCATEGORIA` existente, nome novo ocupado, trava concorrente). O runner sem autorização
recusa antes de DDL. GREEN: mesmo OID, as 12 colunas, 3 índices e 2 constraints novos, FKs
válidas, `migrate diff` 0, Prisma Client lendo a tabela, 2ª execução sem pendências.

### 6.2b Depois do merge da `main` com a PR #270 (CADCURVAGANHO, `cf07309`)

A `main` trouxe a EXPAND `20261113600000_cadcurvaganho_cadastro` (D-PROD-189), **já aplicada em
produção** às 23:18 UTC de 2026-11-13. O repositório passa a ter **45** migrations: esta CONTRACT parte
de **44** concluídas e termina com **45**; **82** tabelas antes e depois. Conflitos resolvidos mantendo
os dois lados: `MIGRATIONS_APROVADAS` em ordem de timestamp (`…500000` desta fatia, depois `…600000`),
B1 do `premerge-migrate`, D-PROD-189 em `DECISIONS.md` (marcador final: próxima decisão
**D-PROD-191**, com a D-PROD-185 na PR #263 e a D-PROD-190 na PR #269), os blocos de missão em
`CURRENT-STATE.md` e as contagens de `patrimonioSimplificaMigration` (44 → 45 migrations; 88/89/82
tabelas; 75 que ficam) e `tipoTarefaDropColunasMigration` (44 → 45), com os ensaios irmãos.

**Ordem fora dos nomes.** Em produção esta CONTRACT (`…500000`) entra **depois** da `…600000`. Nada
recusa nem aceita errado por isso: o `premerge-migrate` só olha as novas contra a `main`
(`origin/main...HEAD` = só esta), e `conferirHistoricoRemoto`, `contractsPendentes`,
`exigirContractAutorizado` (runner oficial), o `preflight-schema` e o `prisma migrate deploy` conferem por
conjunto. Sem correção de código; só a prova: B15k (pura, alvo com as 44 e a CADCURVAGANHO por último),
B15j (main sintética com migration de nome posterior), e o teste/ensaio desta fatia, que partem com a
CADCURVAGANHO concluída e conferem que as duas últimas aplicadas são `[…600000, …500000]`.

Rodada de `npm run verify:all` em 2026-11-13/14, banco PostgreSQL 16 local recém-criado:

| Etapa | Resultado |
|---|---|
| `test:gates` | 825/825 |
| `test:backend` (141 arquivos) | 1.779 testes: 1.774 passam, 0 falham, 5 todo (1.286 s) |
| `test:smoke` | 219 arquivos, 2.661/2.661 |
| `source-closure` | 598/598 alcançáveis |
| `types` | 625 / teto 625 |
| Demais gates, `prisma:generate`, `typecheck:backend`, `lint`, `build`, `build:admin`, `admin-isolation:bundles` | passam — **TODAS AS ETAPAS PASSARAM** (1.609 s) |
| Ensaio local | `ok: true`; partida 44/0, 82 tabelas, 28 colunas, impressão de 6 linhas; 14/14 RED recusados; runner sem autorização recusou sem mudar nada; GREEN 45/0 (14 revertidas dos RED), últimas aplicadas `[…600000_cadcurvaganho_cadastro, …500000_categoria_manejo_cadcategoria]`, 82 tabelas, 12 colunas, nenhuma divergência, `migrate diff` 0, Prisma Client lê 8 linhas, 2ª execução sem pendência |

### 6.3 Ensaio do envelope do caminho B (44 → 45, depois da CADCURVAGANHO)

Refeito em 2026-11-13 depois do merge da `main` com a PR #270. O envelope do §5 do runbook (o bloco
do caminho B copiado do runbook, com `n_ok <> 44`), com a linha do marcador trocada pelo conteúdo
integral do `migration.sql` (`83ca58a0…7e1c`, conferido com `sha256sum`) e o marcador da impressão
trocado pela impressão calculada, rodou com `psql -c` (uma chamada, como a `execute_sql`) contra um
PG 16 local no estado de produção:

- partida: as **44** migrations da `main` (cópia de `backend/prisma/migrations` sem esta pasta, com
  o `schema.prisma` da `origin/main`, por `prisma migrate deploy`), CADESTACOES e CADCURVAGANHO
  incluídas; 44/0, **82** tabelas, `CategoriaManejo` com 28 colunas;
- sementes: 1 `Cliente` e 4 categorias de manejo, 3 com o legado da Fatia C (`raca` `COMPOSTO`,
  `categoria_oficial`, 12 GMDs 0) e 1 sem nada nas 16 colunas;
- impressão pelo bloco B do runbook: 3 linhas, `b73c266a9b92`; `md5_12_colunas` do bloco A: 4
  linhas, `d527d6b403bf38d16754c4b0d416b9bd`;
- `PGOPTIONS="-c maike.categoria_manejo_ensaio_alvo=<system_identifier local>"`.

| Cenário | Resultado |
|---|---|
| (a) sem a linha `SET LOCAL maike.categoria_manejo_legado_impressao`, com `PGOPTIONS` | recusado pela guarda: "os valores das colunas apagadas (3 categorias de manejo) não são os aprovados no GO (… = ausente) … nada foi alterado". Depois: 44/0, `CategoriaManejo` com 28 colunas, 82 tabelas, `md5_12_colunas` igual |
| (b) com a impressão, sem `PGOPTIONS` | `RELEASE_BLOCKED: alvo divergente`. Depois: 44/0, nada mudou |
| (c) com a impressão e `PGOPTIONS` | `COMMIT`. **45/0**; as duas últimas aplicadas são a `…600000_cadcurvaganho_cadastro` e esta CONTRACT (checksum `83ca58a0…7e1c`, `applied_steps_count` 1), ou seja, fora da ordem dos nomes, como em produção; `CategoriaManejo` ausente, `CADCATEGORIA` com o mesmo OID e as 12 colunas; 82 tabelas; `md5_12_colunas` igual ao de antes (4 linhas preservadas); `prisma migrate diff --from-url <banco> --to-schema-datamodel backend/prisma/schema.prisma --exit-code`: **No difference detected** (exit 0). Em seguida, `npm run deploy:migrate` no mesmo banco: "No pending migrations to apply"; `prisma migrate status`: 45 migrations, "Database schema is up to date!" |

## 7. Testes alterados ou apagados

- **Apagado:** `backend/tests/categoriaManejoVinculoCatalogo.test.mjs`. Ele só testava o vínculo
  com o catálogo (validação 422, troca, desativação concorrente, FK `RESTRICT`), e esse vínculo
  deixou de existir. A prova que fica: a chave é aceita e ignorada (`categoriaManejoEnxuto` E-00,
  E-01 e E-05), e a FK sumiu (E-00b e CD-03).
- `categoriaManejoEnxuto.test.mjs` (backend): SQL cru em `"CADCATEGORIA"`. Sai o que dependia das
  colunas apagadas (leitura e semeadura do legado). Entram a prova estrutural (E-00b) e a da chave
  do ícone ignorada (E-05).
- `autorizacaoIntegradaBloqueadores.test.mjs` F2: não lê mais a coluna do ícone; confere que a
  linha fica intocada.
- `tipoTarefaDropColunasMigration`, `patrimonioSimplificaMigration` e os dois ensaios irmãos:
  41 → 42 e 42 → 43 (e, nos merges das PRs #265 e #270, 43 → 44 e 44 → 45).
- `premerge-migrate`, `migrations` (B11/B14 com a terceira CONTRACT concluída) e `alvo-banco`
  AB-05: três CONTRACT.
- `preflight-schema`: a coluna exigida nova.
- Smokes: `catalogoGlobalLote.test.jsx` foi reescrito. Prova que o ícone saiu do formulário e do
  lote, que o lote não consulta o catálogo, que os arquivos removidos não existem e que o payload
  não leva o campo. `categoriaManejoEnxuto.test.jsx` mostra o formulário com Nome, Sigla,
  Espécie, Sexo e Faixa de idade, sem consulta ao catálogo. `manejoServices` e `motorbase1Batch01`
  não usam mais `listarIconesDeLoteDaEmpresa`.
- `scripts/ci/backend-test-pesos.json`: sai o teste apagado e entra o novo (~60 s).

## 8. Riscos e limites conhecidos

- **Fatos de produção não reconferidos.** As contagens vêm do plano e dos registros das PRs #265 e
  #270: 44/0 (a última, `…600000_cadcurvaganho_cadastro`, aplicada às 23:18 UTC de 2026-11-13), 82
  tabelas, categorias com o legado e nenhuma com vínculo. O plano fala em 4 linhas com legado; a emenda, em 5 categorias.
  O bloco B do preflight dá o número real; a impressão se calcula lá.
- **Janela com acesso bloqueado** (§4). Se a release for abortada depois de bloquear e antes de
  aplicar, basta não mergear e liberar o acesso.
- **Rotina de Supabase com `raca` como palavra:** a busca da guarda é fail-closed. Uma rotina
  assim recusa a release (bloco C do preflight lista antes).
- **PG 18 (não é o caso de produção, PG 17):** as constraints `NOT NULL` nomeadas do PG 18
  (`CategoriaManejo_<coluna>_not_null`) manteriam o nome antigo depois do `RENAME`. O Prisma não
  modela esses nomes (o `migrate diff` não muda) e a guarda já as ignora (`contype <> 'n'`).
- `ConfiguracaoIcone` (ícones do mapa por tenant) não muda. O que saiu foi só o vínculo com o
  catálogo global e a prévia que dependia dele.

## 9. Próximo passo

GO-1 (preflight só leitura) → GO-2 (bloquear acesso, aplicar pelo caminho B, postcheck, merge,
conferir, liberar acesso), pelo runbook. Depois, a Fatia E ("Categoria de evolução").
