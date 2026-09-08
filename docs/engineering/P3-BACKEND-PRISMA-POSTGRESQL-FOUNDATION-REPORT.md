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
| `backend/prisma/migrations/20260908174141_p3_foundation/migration.sql` | migration inicial versionada (regerada na P3-R1 — §16.2) |
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

Números da P3 original. A P3-R1 os alterou — a contagem vigente está em §16.6.

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
| Bundle | ~2,50 MB | ~~**inalterado** — nada do backend entra no build Vite~~ |

> **Correção da P3-R1.** A linha do bundle acima está riscada porque a
> afirmação era **falsa como medição**, ainda que a conclusão fosse certa. Eu
> não medi o bundle sob o ambiente da CI antes de escrever "inalterado"; a CI
> desta PR construía com `NODE_ENV: test` e produzia ~1 MB a mais. A causa não
> era o backend — reproduz igual no commit base, onde backend não existe — mas
> isso eu só soube depois, e a linha afirmava mais do que eu havia verificado.
> Medição real, causa e correção estão em §16.3.

Zero import de `@base44/sdk` no backend, travado por `P3-TEN-BASE44`.

## 13. Riscos ainda abertos — nenhum é da P3

| Risco | Estado |
|---|---|
| OWNER-SECURITY-01 | aberto, ação do proprietário |
| Base44 como provider | até a P7 |
| 2.319 diagnósticos de tipos | teto mantido |
| ~~**`backend/` fora do `gate:types`**~~ | **fechado na P3-R1** — `typecheck:backend`, zero diagnóstico (§16.4) |
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

> **Correção da P3-R1.** O parágrafo acima descreve o estado da P3 original e
> fica como está, porque foi o que eu entreguei. Ele **não vale mais**: a
> P3-R1 criou `jsconfig.backend.typecheck.json` e a etapa `typecheck:backend`,
> com tolerância zero e sem baseline. Os 10 diagnósticos que existiam foram
> corrigidos no código, não silenciados. Ver §16.4.

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

---

# 16. P3-R1 — Corrective Contract Closure

Auditoria da P3 apontou cinco bloqueios. Os cinco foram corrigidos **na mesma
branch e na mesma PR #10**. As seções 1 a 15 acima ficam como foram escritas —
elas são o registro do que eu entreguei, incluindo o que entreguei errado. As
correções vêm aqui, com as duas afirmações falsas riscadas no lugar de origem
(§12 e §13) e apontando para cá.

## 16.1 B1 — identidade em runtime

**1. O achado.** `entidadeCodigoRepository.js` criava a linha da sequência por
`INSERT` cru com `gen_random_uuid()` na coluna `id`:

```sql
INSERT INTO "EntidadeCodigoSequencia" (id, cliente_id, entidade, ...)
VALUES (gen_random_uuid(), $1, $2, ...)
ON CONFLICT DO NOTHING
```

O contrato manda que a identidade seja produzida pelo `@default(cuid())` do
Prisma. Aquele caminho produzia UUID v4. O resultado é uma tabela com dois
formatos de chave conforme o registro tenha nascido pelo repositório ou por
qualquer outro caminho — e o contrato deixa de valer exatamente onde ele
prometia valer.

**2. Por que a CI anterior não capturava.** Três verificações passavam por perto
e nenhuma olhava para isso:

- `gate:tenancy` lia o **schema** e as **fontes de tenant**. O schema declarava
  `@default(cuid())` corretamente; o defeito estava no runtime, que o gate não
  lia.
- `test:backend` afirmava que a reserva de número funciona e não duplica. E
  funcionava — o defeito não quebrava comportamento, só trocava o formato da
  chave. Teste de comportamento não pega defeito de forma.
- `gate:modelobase1-pecuario` valida o **contrato**, não a implementação dele.

Ou seja: cada verificação estava certa dentro do seu escopo, e o defeito morava
exatamente na costura entre elas. Foi o mesmo padrão da P2-R1 — invariante
declarada, não verificada.

**3. A correção.** O `INSERT` cru saiu. A criação da linha passa pelo Prisma:

```js
await tx.entidadeCodigoSequencia.createMany({
  data: [{
    // `id` é deliberadamente omitido: quem o produz é o @default(cuid()).
    cliente_id: clienteId, entidade, escopo_tipo: escopoTipo,
    escopo_id: escopoId, proximo_valor: 1,
  }],
  skipDuplicates: true,
});
```

`createMany` com `skipDuplicates` compila para `INSERT ... ON CONFLICT DO
NOTHING`, então a semântica idempotente que o `INSERT` cru tinha é preservada —
duas transações concorrentes que tentem criar a mesma linha continuam sem
estourar. A reserva atômica (`UPDATE ... RETURNING`) não mudou.

**4. A prova negativa nova.** `gate:tenancy` ganhou o código
`P3-TEN-RUNTIME-IDENTITY`.

| Caso | Entrada | Esperado | Real |
|---|---|---|---|
| TEN-25 | runtime real do repositório | passa | **passa** ✅ |
| TEN-26 | `INSERT INTO ... (id, ...) VALUES (gen_random_uuid(), ...)` | `P3-TEN-RUNTIME-IDENTITY` | **reprova** ✅ |
| TEN-27 | `randomUUID()` atribuído a um campo que **não** é `id` | passa | **passa** ✅ |
| TEN-28 | `id: createId()` em objeto de `create` | `P3-TEN-RUNTIME-IDENTITY` | **reprova** ✅ |

TEN-27 é controle positivo, e não é decorativo. A primeira versão desta regra
era um `grep` por `randomUUID` e **reprovou o próprio repositório**:
`requestContext.js` usa `randomUUID()` para o id de correlação da requisição,
que é uso legítimo e nada tem a ver com chave primária. A regra foi reescrita
para casar só na **posição de identidade** — `id` em objeto de `create`, ou a
coluna `id` de um `INSERT` — e TEN-27 existe para que ninguém a alargue de novo
para um scanner textual ingênuo.

## 16.2 B2 — relação cross-tenant

**5. Como estava.** `AuditLog` referenciava `Usuario` só pelo id:

```prisma
usuario Usuario? @relation(fields: [usuario_id], references: [id])
```

`AuditLog` tem `cliente_id` e `Usuario` tem `cliente_id`, mas nada no banco
obrigava os dois a serem **o mesmo**. Um registro de auditoria do cliente A
podia apontar para um usuário do cliente B, e o banco aceitaria. Numa tabela
cuja única função é dizer quem fez o quê, isso é grave: o rastro fica
tecnicamente válido e semanticamente mentiroso.

**6. A constraint nova.** A relação passou a ser composta, com `Usuario`
ganhando a chave referenciável tenant-aware:

```prisma
model Usuario {
  @@unique([cliente_id, login])
  // Chave referenciável tenant-aware: existe para que qualquer FK que
  // aponte para Usuario carregue o tenant junto, e não só o id.
  @@unique([cliente_id, id])
}

model AuditLog {
  // FK COMPOSTA, tenant-aware.
  usuario Usuario? @relation(
    fields: [cliente_id, usuario_id],
    references: [cliente_id, id],
    onDelete: Restrict
  )
}
```

A migration foi **regerada** — `20260908174141_p3_foundation` substitui
`20260908144607_p3_foundation`. Regerar foi possível e correto porque a
migration original nunca foi aplicada em ambiente algum fora de CI e banco
local descartável: ela não foi mergeada. Não há migration de correção porque não
há banco existente para corrigir. O SQL versionado agora contém:

```sql
CREATE UNIQUE INDEX "Usuario_cliente_id_id_key" ON "Usuario"("cliente_id", "id");

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_cliente_id_usuario_id_fkey"
  FOREIGN KEY ("cliente_id", "usuario_id")
  REFERENCES "Usuario"("cliente_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

**7. O teste A×B no PostgreSQL real.** Três casos, contra o banco de verdade, não
contra o Prisma:

| Caso | Cenário | Esperado | Real |
|---|---|---|---|
| R1-T05 | `AuditLog` cliente A → `Usuario` cliente A | grava | **grava** ✅ |
| R1-T06 | `AuditLog` cliente A → `Usuario` cliente B | **o banco recusa** | **recusa**, violação de FK ✅ |
| R1-T07 | evento de sistema, `usuario_id = null` | grava | **grava** ✅ |

R1-T07 é o caso que a solução ingênua quebraria. FK composta em PostgreSQL usa
`MATCH SIMPLE`: com qualquer coluna nula, a constraint **não é verificada**. É
justamente isso que mantém o evento de sistema — auditoria sem usuário — válido,
sem precisar de usuário sintético nem de coluna nullable falsa. A semântica que
o produto precisa e a semântica padrão do PostgreSQL coincidem aqui; o teste
existe para provar a coincidência em vez de confiar nela.

O gate acompanha, com `P3-TEN-CROSS-RELATION`: mutar a relação de volta para
`fields: [usuario_id], references: [id]` reprova (TEN-29), e a relação composta
correta passa (TEN-30).

**Isolamento pelo caminho real (R1-T09, R1-T09b).** O teste de isolamento não usa
mais `WHERE` escrito dentro do próprio teste — ele chama o **service**, que chama
o **repository**. Tenant A pede a listagem e não recebe registro do tenant B,
com o filtro vindo de `auth_context` como em produção. Testar isolamento com um
`WHERE` escrito no teste prova que o `WHERE` funciona, não que a aplicação o
aplica.

## 16.3 B3 — o bundle

**8, 9, 10, 11. Antes, durante, causa e depois.** Medição local reproduzível,
Node 22, `npm ci`, `npx vite build` em árvore limpa, quatro combinações:

| Árvore | `NODE_ENV` | Módulos | JS | gzip | Chunk |
|---|---|---|---|---|---|
| base `44b204c` | `production` | 3.941 | **2.496,62 kB** | 669,03 kB | `index-nzvr8O-2.js` |
| HEAD P3-R1 | `production` | 3.941 | **2.496,62 kB** | 669,03 kB | `index-nzvr8O-2.js` |
| base `44b204c` | `test` | 3.958 | 3.913,03 kB | 831,94 kB | `index-Y5U04JFB.js` |
| HEAD P3-R1 | `test` | 3.958 | 3.477,44 kB | 815,94 kB | `index-CBtPcwPI.js` |

A CI da P3, antes da R1, mediu **3.555,01 kB**.

**A causa está demonstrada, não deduzida.** Base e HEAD, em modo produção,
produzem o **mesmo hash de chunk** — `index-nzvr8O-2.js` — o que é uma
igualdade byte a byte, não uma coincidência de tamanho arredondado. E a inflação
reproduz **no commit base**, onde não existe uma linha de backend. Logo a causa
não pode ser o backend nem a topologia de dependências da D-PROD-23.

A causa é o `NODE_ENV: test` que **eu** introduzi no `env:` do **job** em
`.github/workflows/quality.yml`, na primeira versão da P3. `env:` de job alcança
todos os passos, inclusive `npm run build`. Com `NODE_ENV` diferente de
`production`, React e várias bibliotecas resolvem a condição de export
`development`, e o bundle sai com os builds de desenvolvimento dentro.

O que torna esse defeito traiçoeiro é que ele **não aparece no diff**. Não há
import novo, não há dependência nova no bundle, `src/` está intocado — e a
leitura errada mais provável de "o bundle cresceu 1 MB nesta PR" é culpar o
backend, que é a única coisa visivelmente nova. Foi essa a leitura da auditoria,
e ela era razoável.

**A correção não tocou `src/`**, e tem duas pontas:

1. `NODE_ENV` saiu do workflow, e no lugar ficou o comentário explicando por que
   não pode voltar. Quem precisa da variável declara por conta própria — o
   Vitest já define `test` sozinho.
2. `verify:all` passou a **fixar** `NODE_ENV: 'production'` no passo de build.
   Assim a medição não depende mais do ambiente de quem executa; o passo de
   build mede o artefato que vai a produção, e não o que o shell local sugerir.

Cinco casos novos travam as duas pontas (`build-environment.test.mjs`,
ENV-B1..ENV-B5): o workflow não declara `NODE_ENV`, o comentário que explica a
proibição continua lá, o `verify:all` fixa `production` no build, o runner
**propaga** o env declarado por etapa, e `production` é o único valor de
`NODE_ENV` fixado em qualquer etapa.

**Duas divergências que eu não vou maquiar.** A auditoria informou **2.922
módulos** para o estado pré-P3; eu não consegui reproduzir esse número. O commit
base me dá 3.941 módulos em modo produção — com o tamanho batendo na casa
decimal (2.496,62 kB) e o mesmo hash de chunk. Como o tamanho e o hash coincidem
exatamente, a divergência é de **como o número de módulos foi obtido**, não do
artefato. E a CI mediu 3.555,01 kB onde a minha árvore local mede 3.477,44 kB
sob o mesmo `NODE_ENV=test`: dev-build não é reprodutível entre `node_modules`
instalados em momentos diferentes. Nenhuma das duas divergências afeta a
conclusão, que se apoia no par que é exato: **produção base = produção HEAD,
mesmo hash**.

**Bundle pós-correção: 2.496,62 kB / 669,03 kB gzip / 3.941 módulos** — o
patamar pré-P3, sem mascaramento, porque é literalmente o mesmo arquivo.

## 16.4 B4 — typecheck do backend

**12. Configuração, cobertura e diagnósticos.** A P3 declarou a lacuna e parou
aí. A R1 fecha.

`jsconfig.backend.typecheck.json` é **separado** de `jsconfig.typecheck.json`, de
propósito. Somar `backend/` à catraca legada mudaria o hash do contrato de
cobertura, exigiria `--rebase-contract` e — pela barreira da D-PROD-17 —
obrigaria a passar tudo de uma vez. Pior: misturaria dívida herdada de `src/`
com código novo, e a catraca legada tolera 2.319 diagnósticos. Backend novo não
tolera nenhum.

| Item | Valor |
|---|---|
| Configuração | `jsconfig.backend.typecheck.json` |
| Cobertura | `backend/src/**/*.js` + `backend/src/**/*.d.ts` |
| Modo | `checkJs: true`, `noEmit: true` |
| Tolerância | **zero** — sem baseline, sem teto, sem `--update` |
| Comando | `npm run typecheck:backend` |
| Resultado | **0 diagnósticos**, exit 0 (R1-T10) |

Havia **10 diagnósticos reais**. Nenhum foi silenciado — sem `@ts-nocheck`, sem
`@ts-ignore`, sem `any`. As três classes:

- **`request.contexto` e `app.autenticar` não existiam para o compilador.** São
  decorações do Fastify em runtime. A correção é `backend/src/types/fastify.d.ts`
  com module augmentation de `FastifyRequest`, `FastifyInstance` e do
  `FastifyJWT` do `@fastify/jwt` — o tipo passa a ser **declarado**, que é
  diferente de ser suprimido.
- **`erro.message` em `catch`.** `unknown` não tem `.message`. Corrigido por
  estreitamento explícito, não por cast.
- **Literal alargado para `string`** onde o contrato é `'up' | 'down'`.
  Corrigido com `/** @type {'up'|'down'} */`.

A catraca legada continua **2.319 com teto 2.319**, intocada: são dois contratos
independentes e nenhum dos dois foi afrouxado para acomodar o outro.

## 16.5 B5 — `prisma validate`

**13.** O script existia no `package.json` desde a P3, e ninguém o executava na
cadeia de certificação: `run-backend-tests.mjs` ia direto para `generate` e
`migrate deploy`. Script que existe e não roda é documentação, não verificação.

A ordem agora é obrigatória e para a cadeia na primeira falha:

```
prisma validate  →  prisma generate  →  prisma migrate deploy  →  node --test
```

`migrate deploy` contra o banco da CI, que nasce vazio a cada job, é o **smoke de
migration** de graça: cada execução prova que `banco vazio → migrate deploy →
schema disponível` funciona (R1-T12). E sem `DATABASE_URL` ou `AUTH_SECRET` o
runner **falha**, em vez de pular em silêncio — suíte que se auto-desliga quando
falta configuração reporta verde sem ter verificado nada.

## 16.6 Contagens novas

**14. Testes.**

| Suite | P3 | P3-R1 | Delta |
|---|---|---|---|
| `tenancy.test.mjs` | 30 | **38** | +8 (identidade runtime e cross-tenant) |
| `indices.test.mjs` | 17 | **17** | — |
| `build-environment.test.mjs` | — | **5** | novo |
| `test:gates` (total) | 415 | **428** | +13 |
| `test:backend` | 33 | **41** | +8 |
| `test:smoke` | 495 | **495** | — |
| **Total** | 943 | **964** | +21 |

**15. Etapas do `verify:all`: 17 → 18.** A etapa nova é `typecheck:backend`,
entre `types` e `lint`.

## 16.7 Fechamento

**16. `verify:all` final** e **17. CI final** — a saída completa das 18 etapas e
o run da CI sobre o HEAD novo ficam registrados no corpo da **PR #10**. Um
commit não pode conter o resultado da própria execução.

**A lição, que é a mesma da P2-R1.** Três dos cinco bloqueios — identidade em
runtime, relação cross-tenant e o `prisma validate` que não rodava — eram
invariantes **declaradas e não verificadas**. Passavam em tudo porque nenhuma
verificação olhava para elas. Os dois outros foram afirmação minha sem medição
(o bundle) e lacuna que eu declarei em vez de fechar (o typecheck). Declarar uma
lacuna com honestidade é melhor que escondê-la, e ainda assim continua sendo uma
lacuna.

**Nenhuma D-PROD nova.** Considerei registrar uma decisão superseding a
D-PROD-23 por conta do bundle, e a evidência diz que não cabe: a topologia de
dependências da D-PROD-23 **não é** a causa — a causa reproduz no commit base,
onde ela não existe. D-PROD-23 continua correta como está. O marcador em
`DECISIONS.md` segue em `D-PROD-24`.

**Estado: P3 continua implementada, em PR draft, aguardando auditoria e merge
manual do proprietário. P4 não iniciada.**
