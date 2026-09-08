# P3 — Backend + Prisma + PostgreSQL Foundation — Relatório

**Missão:** P3 · **Data:** 2026-09-08 · **Decisões:** D-PROD-22 (precondição), D-PROD-23
**Base:** `main` em `44b204ce9711baa58afa0569cbad84a562b49337` (merge da PR #9)
**Branch:** `claude/p3-backend-prisma-postgresql-foundation`

---

## 1. Precondição — P3-G0

| Item | Estado |
|---|---|
| **P3-G0.1** — PR #8 mergeada | ✅ merge `378bfd3`; a branch da P3 nasceu de `44b204c`, não de `1851503` |
| **P3-G0.2** — colisão constitucional | ✅ resolvida pela emenda **D-PROD-22**, PR #9, merge `44b204c` |
| **P3-G0.3** — catálogo frontend de erros | ⚠️ divergência registrada, contrato **não** alterado — ver §7 |

A P3 parou antes de escrever qualquer arquivo e reportou
`P3-BLOCKED-CONSTITUTION-TENANT-ROOT`. A Constituição §4 é explícita: agente de
IA não emenda, apenas propõe. A emenda foi proposta, revisada pelo arquiteto e
aprovada pelo merge humano da PR #9 — só então a implementação começou.

## 2. Arquivos criados

| Caminho | Finalidade |
|---|---|
| `backend/prisma/schema.prisma` | os cinco models da fundação |
| `backend/prisma/migrations/20260908144607_p3_foundation/migration.sql` | migration inicial versionada |
| `backend/src/config/env.js` | única porta de leitura de `process.env` |
| `backend/src/database/prismaClient.js` | única instância do Prisma |
| `backend/src/shared/errors/errorCodes.js` | os oito códigos do contrato + os do backend |
| `backend/src/shared/errors/AppError.js` | erro com código estável |
| `backend/src/shared/errors/errorHandler.js` | tradutor único de erro para HTTP |
| `backend/src/shared/auth/authContext.js` | `auth_context` — a única autoridade de tenancy |
| `backend/src/shared/request/requestContext.js` | correlation id + contexto |
| `backend/src/modules/auth/{authRoutes,authService,authRepository}.js` | sessão própria |
| `backend/src/modules/health/{healthRoutes,healthService}.js` | health check |
| `backend/src/modules/auditoria/{auditService,auditRepository}.js` | AuditLog |
| `backend/src/modules/sequencias/{entidadeCodigoService,entidadeCodigoRepository}.js` | numeração atômica |
| `backend/src/modules/anexos/attachmentValidation.js` | contrato de anexo |
| `backend/src/{app,server}.js` | montagem e processo |
| `backend/tests/{helpers,foundation.test}.mjs` | 33 testes contra PostgreSQL real |
| `scripts/gates/gate-tenancy.mjs` · `gate-indices.mjs` | os dois gates novos |
| `scripts/gates/lib/prisma-schema.mjs` | parser estrutural de schema |
| `scripts/tests/gates/{tenancy,indices}.test.mjs` | 47 provas, quase todas negativas |
| `scripts/tests/run-backend-tests.mjs` | runner com smoke de migration embutido |
| `docker-compose.yml` | PostgreSQL local, versão fixada |
| este relatório | — |

## 3. Arquivos alterados

| Caminho | Motivo |
|---|---|
| `package.json` · `package-lock.json` | 6 dependências reais + 12 scripts |
| `.github/workflows/quality.yml` | serviço PostgreSQL efêmero e variáveis do job |
| `eslint.config.js` | bloco `backend/**` — sem ele o backend ficava fora de qualquer regra |
| `.env.example` | variáveis do backend, sem prefixo `VITE_` |
| `scripts/gates/verify-all.mjs` | `tenancy`, `indices` e `test:backend` |
| `docs/engineering/DECISIONS.md` | D-PROD-23, append-only |
| `docs/engineering/{CURRENT-STATE,ROADMAP,GATE-REGISTRY}.md` · `README_AI.md` · `AGENTS.md` · `CLAUDE.md` | estado real |

**Não tocados:** `src/`, `base44/`, `config/mapa-manejo-scope.json`,
`config/modelobase1-pecuario.json`, `vite.config.js`, `jsconfig.typecheck.json`,
`scripts/gates/*baseline.json`.

## 4. Dependências

| Pacote | Onde | Por quê |
|---|---|---|
| `fastify` | dependencies | servidor HTTP |
| `@fastify/jwt` | dependencies | sessão assinada |
| `@prisma/client` | dependencies | acesso ao banco |
| `bcryptjs` | dependencies | hash de senha |
| `dotenv` | dependencies | leitura de `.env` |
| `prisma` | devDependencies | CLI de migration |

49 → **55** dependências diretas. O lockfile mudou como consequência legítima da
instalação — nunca editado à mão. `gate:package-sync` verde.

**Deliberadamente não instalados**, apesar de existirem no PROJETOMG:
`@fastify/cors`, `helmet`, `rate-limit`, `multipart`, `compress`, `ioredis`,
`@supabase/supabase-js`, `ajv` explícito, `pg` direto. Nenhum tem consumidor na
P3, e dependência sem consumidor é superfície de ataque que parece
infraestrutura. Entram quando a capacidade que as exige existir.

## 5. Arquitetura

```
HTTP/Fastify → route → service → repository → Prisma → PostgreSQL
```

| Camada | Exemplo | Não faz |
|---|---|---|
| route | `modules/auth/authRoutes.js` | nenhuma query, nenhuma regra |
| service | `modules/auth/authService.js` | não fala Prisma direto |
| repository | `modules/auth/authRepository.js` | não conhece HTTP; recebe tenant já resolvido |

`authRepository.buscarUsuarioPorLogin(clienteId, login)` é o padrão: o tenant
chega como parâmetro explícito, vindo do contexto — nunca de um DTO.

## 6. Schema — cinco models, nenhum a mais

| Model | Tenant | Unique de negócio |
|---|---|---|
| `Cliente` | **raiz** — sem `cliente_id` | `codigo` global (não é tenant-scoped) |
| `Usuario` | sim | `[cliente_id, login]` |
| `AuditLog` | sim, `cliente_id` **obrigatório** | — |
| `EntidadeCodigoSequencia` | sim | `[cliente_id, entidade, escopo_tipo, escopo_id]` |
| `RegistroAnexo` | sim | `[cliente_id, storage_key]` |

Todos: `id String @id @default(cuid())`, `createdAt @default(now())`,
`updatedAt @updatedAt`, `onDelete: Restrict` nas relações com a raiz.

Todos os 10 índices tenant-scoped começam por `cliente_id`. `Cliente` tem
`@@index([nome])` e `@@index([ativo])` sem prefixo — e deve ter: exigir prefixo
da raiz seria exigir tenancy do próprio tenant.

## 7. Divergências deliberadas do PROJETOMG

| Divergência | Justificativa |
|---|---|
| `AuditLog.cliente_id` **obrigatório** (lá é nullable + `SetNull`) | log sem tenant não é auditável em multi-tenant |
| `AuditLog.usuario_id` com `Restrict` (lá é `SetNull`) | anular o ator faria evento humano passar por evento de sistema; o rastro mentiria |
| `onDelete: Restrict` em toda relação com a raiz (lá é `Cascade`) | o contrato exige política explícita e revisada; `Cascade` apagaria a auditoria junto com o tenant |
| Sem `id_global`, sem `RegistroGlobal` | numeração global de registro não tem consumidor no Mapa Geral + Manejo |
| `RegistroAnexo` sem `file_url` | `storage_key` é a identidade; URL é efêmera |
| Sequência com `escopo_tipo`/`escopo_id` (lá é `[cliente_id, entity_name]`) | o produto precisa de escopo por empresa; o custo é o hazard de `NULL`, tratado no item abaixo |
| Sem `Empresa`, `PermissaoEmpresa`, `acesso_global`, perfis | P4–P6 e P8 |
| Nada de Studio, MDP, MMM, CADCPS, Marketplace, ModeloBase1 visual | D-PROD-03 e D-PROD-21 |

### O catálogo de erros do frontend — não cumprido, declarado

O contrato diz `errorNamespace.addedToFrontendCatalogInPhase = "P3"`. A P3 tem
`src/` congelado. Os oito códigos existem no backend; **não** entraram em
`src/apis/_core/ApiError.js`.

Portanto esse campo do contrato **não foi cumprido**, e
`config/modelobase1-pecuario.json` **não foi alterado** para esconder o fato. A
sincronização fica para a P4 — que, além de autorizar `src/`, é quando os
códigos ganham consumidor real, requisito da regra SE11.

## 8. Numeração — a decisão que a P2 adiou

**Escolhido:** `escopo_id String` não nulo. No escopo `tenant`, sentinela = o
próprio `cliente_id`.

**Por que não `NULL`:** no PostgreSQL `NULL` nunca é igual a `NULL` num índice
unique. Com `escopo_id` nullable, duas linhas de sequência para a mesma entidade
coexistiriam e distribuiriam números **em paralelo**. O unique não barraria
nada, e o sintoma só apareceria sob concorrência — exatamente quando a
numeração precisa funcionar.

**Por que não índice parcial:** funciona, mas exigiria SQL fora do
`schema.prisma`, criando segunda fonte de verdade sobre a chave.

A reserva é um `UPDATE … RETURNING` dentro da transação de quem chama, precedido
de `INSERT … ON CONFLICT DO NOTHING`. Sem `SELECT MAX`, sem `COUNT(*)`, sem
leitura seguida de escrita.

**Prova:** BE-17 dispara 40 reservas concorrentes e exige o conjunto exato
`{1..40}` — zero duplicidade.

A P3 **não** atribui escopo a nenhuma entidade de P4–P6.

## 9. Gates novos

Absolutos: sem `--update`, sem baseline, sem correção automática, e nenhum deles
escreve arquivo — provado por TEN-21, TEN-22 e IDX-14, que verificam o schema
byte a byte depois da execução, inclusive com flag de correção passada de
propósito.

| Invariante | Fixture válida | Mutação | Código | Resultado |
|---|---|---|---|---|
| raiz única | schema real | `Usuario` sem `cliente_id` | `P3-TEN-ROOT-CONTRACT` | reprova ✅ |
| raiz única | schema real | segundo model sem `cliente_id` | `P3-TEN-ROOT-CONTRACT` | reprova ✅ |
| raiz sem autorreferência | schema real | `cliente_id` em `Cliente` | `P3-TEN-ROOT-CONTRACT` | reprova ✅ |
| tenant não nulo | schema real | `cliente_id String?` | `P3-TEN-FIELD` | reprova ✅ |
| relação com a raiz | schema real | remover `@relation` | `P3-TEN-RELATION` | reprova ✅ |
| unique tenant-scoped | schema real | `@@unique([login])` | `P3-TEN-BUSINESS-UNIQUE` | reprova ✅ |
| unique isolado | schema real | `login @unique` | `P3-TEN-BUSINESS-UNIQUE` | reprova ✅ |
| PK cuid | schema real | `Int @default(autoincrement())` | `P3-TEN-IDENTITY` | reprova ✅ |
| sem UUID paralelo | schema real | `uuid String @default(uuid())` | `P3-TEN-IDENTITY` | reprova ✅ |
| timestamps | schema real | remover `updatedAt` | `P3-TEN-TIMESTAMPS` | reprova ✅ |
| tenant de `body` | backend limpo | `request.body.cliente_id` | `P3-TEN-SOURCE` | reprova ✅ |
| tenant de `query` | backend limpo | `request.query.cliente_id` | `P3-TEN-SOURCE` | reprova ✅ |
| tenant de `params` | backend limpo | `request.params.cliente_id` | `P3-TEN-SOURCE` | reprova ✅ |
| tenant de `headers` | backend limpo | `request.headers.cliente_id` | `P3-TEN-SOURCE` | reprova ✅ |
| tenant de `cookie` | backend limpo | `request.cookie.cliente_id` | `P3-TEN-SOURCE` | reprova ✅ |
| (as cinco, por colchete) | backend limpo | `request.X['cliente_id']` | `P3-TEN-SOURCE` | reprova ✅ |
| desestruturação | backend limpo | `const { cliente_id } = request.body` | `P3-TEN-SOURCE` | reprova ✅ |
| **controle positivo** | backend limpo | `request.body.nome` | — | **passa** ✅ |
| zero Base44 | backend limpo | `import '@base44/sdk'` | `P3-TEN-BASE44` | reprova ✅ |
| zero Base44 | backend limpo | `require`, `import()`, `base44Client` | `P3-TEN-BASE44` | reprova ✅ |
| índice tenant-first | schema real | `@@index([ativo])` | `P3-IDX-TENANT-PREFIX` | reprova ✅ |
| **ordem importa** | schema real | `@@index([ativo, cliente_id])` | `P3-IDX-TENANT-PREFIX` | reprova ✅ |
| formatação não engana | schema real | mesma mutação, multilinha | `P3-IDX-TENANT-PREFIX` | reprova ✅ |
| unique tenant-first | schema real | `@@unique([login, cliente_id])` | `P3-IDX-BUSINESS-UNIQUE` | reprova ✅ |
| chave da sequência | schema real | sem `cliente_id` | `P3-IDX-SEQUENCE-UNIQUE` | reprova ✅ |
| chave da sequência | schema real | sem `entidade` | `P3-IDX-SEQUENCE-UNIQUE` | reprova ✅ |
| chave da sequência | schema real | sem `escopo_tipo` | `P3-IDX-SEQUENCE-UNIQUE` | reprova ✅ |
| chave da sequência | schema real | sem `escopo_id` | `P3-IDX-SEQUENCE-UNIQUE` | reprova ✅ |
| **hazard de NULL** | schema real | `escopo_id String?` | `P3-IDX-SEQUENCE-NULL-SCOPE` | reprova ✅ |
| **controle positivo** | schema real | raiz com `@@index([nome])` | — | **passa** ✅ |

As cinco fontes proibidas de tenant têm cinco fixtures independentes. A
auditoria P2-R1 mostrou o custo de testar três e concluir pelas cinco.

## 10. Testes

| Suite | Quantidade | Resultado |
|---|---|---|
| `tenancy.test.mjs` | 30 | ✅ |
| `indices.test.mjs` | 17 | ✅ |
| `test:gates` (total) | **415** | ✅ (era 368) |
| `test:backend` | **33** | ✅ contra PostgreSQL 16.13 real |
| `test:smoke` | **495** | ✅ (era 494; +1 pela ENV3b — ver §11) |
| **Total** | **943** | (era 862) |

## 11. Dois defeitos reais que os testes acharam

Nenhum dos dois era bug de fixture.

**`removeAdditional` do Fastify.** O AJV do Fastify vem com `removeAdditional`
ligado: com `additionalProperties: false`, um `cliente_id` enviado no corpo do
login era **apagado em silêncio** e a requisição passava. O comentário que eu
tinha escrito na rota — "é recusado na porta" — era falso. Numa superfície de
tenancy, descartar calado é a pior opção: ninguém fica sabendo que alguém
tentou. Corrigido com `removeAdditional: false`; agora é 400 (BE-09).

**Handler engolindo erro de framework.** `normalizarErro` mandava qualquer
exceção desconhecida para `INTERNAL_ERROR`, então **toda requisição malformada
devolvia 500** — o servidor se culpando por erro do cliente. Corrigido com
tratamento de `FST_ERR_VALIDATION` e de `statusCode` 4xx do Fastify.

## 12. Preservação de P1 e P2

| Invariante | Antes | Depois |
|---|---|---|
| `gate:api-boundary` | 0/0/0/0/0/0 | **0/0/0/0/0/0** |
| Registry do provider | 38 | **38** |
| `gate:base44` | `4/1/38/10/1/1/1/1/38/1` | **idem** |
| `gate:types` | 2.319, teto 2.319 | **2.319, teto 2.319** |
| `lint` | 0 | **0** |
| `gate:modelobase1-pecuario` | verde, absoluto | **verde, absoluto, não enfraquecido** |
| Bundle | ~2,50 MB | **inalterado** — nada do backend entra no build Vite |

Zero import de `@base44/sdk` no backend, travado por `P3-TEN-BASE44`.

## 13. Riscos ainda abertos — nenhum é da P3

| Risco | Estado |
|---|---|
| OWNER-SECURITY-01 | aberto, ação do proprietário |
| Base44 como provider | até a P7 |
| 2.319 diagnósticos de tipos | teto mantido |
| **`backend/` fora do `gate:types`** | **lacuna nova, declarada** — ver abaixo |
| Bundle ~2,50 MB sem code splitting | P8 |
| `npm audit` | P8 |
| DBT-19 — operação Base44 sem ACID | até a capacidade migrar |
| RLS, rate limiting, CORS, observabilidade | P8 |
| Provedor de storage | não escolhido, por desenho |

**A lacuna de tipos merece ser dita sem rodeio.** `jsconfig.typecheck.json`
cobre apenas `src/`; `backend/` não passa pela catraca. Ampliar a cobertura
mudaria o hash do contrato, exigiria `--rebase-contract` e — pela barreira de
não regressão da D-PROD-17 — obrigaria o backend inteiro a estar limpo sob
`checkJs` de uma vez. A P3 não fez isso. O critério P3-AC-60 ("código novo não
introduz diagnóstico novo") é satisfeito **trivialmente**, e essa trivialidade
está registrada aqui em vez de passar por cobertura real. Hoje o backend é
protegido por `eslint` com `no-unused-vars` como erro, pelos dois gates novos e
por 33 testes de integração.

## 14. Itens fora do escopo encontrados — registrados, não corrigidos

1. `docs/constitution/00-CONSTITUICAO.md` §3 continua **sem listar**
   `config/modelobase1-pecuario.json` na hierarquia normativa. Levantado na
   D-PROD-22 e deixado de fora por decisão do arquiteto. A mesma classe de
   colisão pode voltar em P4–P6.
2. `AGENTS.md` §Setup ainda manda `cp .env.example .env.local`, convenção do
   Vite; o backend lê `.env`. Os dois convivem, mas a instrução ficou ambígua.
3. O `concurrency` do `quality.yml` cancela execuções em andamento — o que, em
   agosto, contribuiu para o run travado da P2-R1 nunca enfileirar.

## 15. Estado

**P3 implementada tecnicamente e em PR draft. Aguardando auditoria e merge
manual do proprietário. P4 não iniciada.**
