# ModeloBase1 Pecuário — Contrato Base de Persistência e Domínio

**Status:** Oficial após o merge da PR da P2 · **Versão:** 1 · **Missão:** P2
**SSOT executável:** `config/modelobase1-pecuario.json`
**Gate:** `npm run gate:modelobase1-pecuario` · **Decisão:** D-PROD-21

Este documento é a leitura humana do contrato. O que vale mecanicamente é o
JSON — se os dois divergirem, o JSON vence e o gate reprova.

---

## 1. Definição e não objetivos

**ModeloBase1 Pecuário é o contrato base de persistência e domínio** para os
models Prisma que a P3 vai criar. Ele fixa, antes de existir schema, as regras
de identidade, tenancy, timestamps, auditoria, numeração, anexos, exclusão,
concorrência e vocabulário de erro.

O nome vem do PROJETOMG, mas o significado aqui é outro. No MAIKE ele **não** é:

| Não é | Por quê |
|---|---|
| um template visual | não existe `src/ModeloBase1/` no MAIKE e não vai existir |
| um runtime genérico de telas | D-PROD-03 exclui Runtime Universal |
| uma plataforma low-code | fora do roadmap (`docs/constitution/07-DO-NOT-DO.md`, D24) |
| um Template Registry | é MDP do PROJETOMG, fora do escopo |
| substituto das telas atuais | nenhuma tela muda por causa deste contrato |

O que ele **é**: um contrato obrigatório para P3, P4, P5 e P6. Toda migration de
domínio precisa satisfazê-lo.

## 2. Relação com PROJETOMG

O PROJETOMG é molde de **disciplina**, não de código (D-PROD-03). Deste contrato,
o que veio de lá:

| Padrão | Origem no PROJETOMG |
|---|---|
| `id String @id @default(cuid())` em todo model | `backend/prisma/schema.prisma` |
| `cliente_id` obrigatório, `Cliente` como raiz | mesmo arquivo |
| `@@unique([cliente_id, …])` e `@@index([cliente_id, …])` | mesmo arquivo |
| reserva de número por `UPDATE … RETURNING` em transação | `backend/src/modules/sequencias/entidadeCodigoService.js` |
| tenant vindo de `scope.clienteId`, nunca do payload | `backend/src/modules/empresas/repositories/empresaRepository.js` |
| `AuditLog` central, além dos timestamps por model | `backend/prisma/schema.prisma` |

O que **não** veio, e por quê:

| Item | Motivo |
|---|---|
| `src/ModeloBase1/` (motor de cadastro) | é UI genérica — o documento 04-MODELOBASE1-RULES da constituição do PROJETOMG descreve página fina, painéis, hooks e Template Registry. Nada disso é produto aqui |
| MDP, MMM, CADCPS, Marketplace, Studio | D-PROD-03 |
| `id_global` como segunda numeração universal | numeração global de registro não tem consumidor no Mapa Geral + Manejo. Entra por decisão, se algum dia tiver |
| `AuditLog.cliente_id` **nullable** | no PROJETOMG o campo é opcional com `onDelete: SetNull`. Aqui o AuditLog é tenant-scoped e `cliente_id` é obrigatório (§7) |
| `RegistroAnexo.file_url` como campo de primeira classe | aqui a identidade é `storage_key` (§9) |
| `getMaxCodigoInUse` como **atribuição** | no PROJETOMG ele só sincroniza o piso de uma sequência existente. Atribuir por `MAX + 1` é padrão proibido (§8) |

## 3. Relação com a UI atual

**Nenhuma.** Este contrato não altera `src/`, não altera rota, menu ou tela, e
não altera o acoplamento com a Base44.

A fronteira de dados da P1 (D-PROD-18) continua sendo o ponto de contato:

```
página → service do módulo → src/apis/<modulo>/ → provider interno
```

Quando a P3 existir, o provider Base44 é substituído por um provider HTTP
**dentro da fronteira**. A página não muda. É exatamente para isso que a P1
existiu.

Enquanto isso, `numero_lote` e `numero_setor` continuam calculados por `max + 1`
no cliente (DBT-09, DBT-26). Esse padrão está listado como proibido no contrato
porque descreve o **backend próprio** — a UI legada só deixa de usá-lo quando a
capacidade correspondente migrar (P4–P6).

## 4. Identidade

| Regra | Valor |
|---|---|
| campo primário | `id` |
| tipo lógico | `String` |
| gerador Prisma | `cuid()` |
| fornecido pelo cliente HTTP | **não** |
| imutável | **sim** |
| UUID paralelo | **não** |
| ID numérico global como PK | **não** |

Códigos humanos e números sequenciais (`numero_lote`, `numero_setor`, `codigo`)
são **identificadores de negócio**. Eles vivem sob `@@unique([cliente_id, …])` e
sob a política de numeração (§8) — nunca como chave primária.

A razão é operacional: PK estável e opaca sobrevive a renumeração, correção de
digitação e fusão de registros. Número de negócio não sobrevive a nenhuma das
três.

## 5. Tenancy

| Regra | Valor |
|---|---|
| model raiz | `Cliente` |
| campo de tenant | `cliente_id` |
| única exceção estrutural sem `cliente_id` | `Cliente` |
| catálogo global adicional | **vazio** nesta fundação |
| origem do `cliente_id` | contexto autenticado (`auth_context`) |
| origens proibidas | `body`, `query`, `params`, `header`, `cookie` |
| unique de negócio | sempre inclui `cliente_id` |
| índice tenant-scoped | começa por `cliente_id` |
| relação cruzando clientes | proibida |
| exclusão de `Cliente` | política explícita e revisada, nunca cascade acidental |

### Três tipos de model

| Tipo | Definição | Nesta fundação |
|---|---|---|
| **root** | o próprio tenant | `Cliente` |
| **tenant** | todo model de domínio; `cliente_id` obrigatório e não nulo | todos os demais |
| **system catalog** | catálogo realmente global, sem dono | **nenhum** |

O terceiro tipo existe no contrato para que a P3 não precise inventá-lo sob
pressão — e fica vazio de propósito. `UnidadeMedida`, `Marca` e afins **parecem**
catálogo global e não são: cada cliente edita os seus. Uma entrada nova nessa
lista exige decisão própria em `docs/engineering/DECISIONS.md`, e o gate reprova
qualquer adição sem ela.

Isto reafirma D-01, D-02 e as regras D1–D5 de `docs/constitution/07-DO-NOT-DO.md`.

## 6. Timestamps

```
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

Obrigatórios em todo model persistente. A autoridade é o **banco**, não o
frontend: timestamp que chega do cliente é dado de entrada, nunca fonte da
verdade. Exceção só por decisão registrada.

## 7. Auditoria

Duas camadas, com papéis distintos:

| Camada | O que responde |
|---|---|
| **A** — timestamps por model | quando esta linha nasceu e quando mudou pela última vez |
| **B** — `AuditLog` central | quem fez o quê, em qual entidade, com qual antes e depois |

Blueprint mínimo do `AuditLog` (criado na P3):

| Campo | Obrigatório | Observação |
|---|---|---|
| `id` | sim | |
| `cliente_id` | **sim** | o log é tenant-scoped; diverge do PROJETOMG de propósito |
| `usuario_id` | não | ausente apenas quando o evento é de sistema |
| `acao` | sim | |
| `entidade` | sim | |
| `entidade_id` | não | operações em lote podem não ter alvo único |
| `dados_anteriores` | não | `Json` |
| `dados_novos` | não | `Json` |
| `request_id` | sim | correlation id da requisição |
| `createdAt` | sim | |

Regras:

- o **ator vem da sessão**, nunca do corpo da requisição;
- **nada de senha, credencial, segredo ou conteúdo binário** no payload;
- auditoria **não altera o resultado funcional silenciosamente** — ela não pode
  transformar uma escrita bem-sucedida em falha invisível nem o contrário;
- **falha crítica de auditoria é observável**. Perder o rastro em silêncio é o
  pior dos dois mundos: nem o log existe, nem alguém sabe que ele não existe.

A P2 não cria o model. Ela fixa o contrato que a P3 implementa.

## 8. Numeração

| Regra | Valor |
|---|---|
| estratégia | sequência atômica no banco |
| `MAX + 1` | **proibido** |
| `COUNT(*) + 1` | **proibido** |
| incremento | atômico, dentro de transação |
| reuso após exclusão | **não** |
| escopos suportados | `tenant`, `empresa` |
| qual entidade usa qual escopo | decidido por capacidade em P4–P6 |

Blueprint mínimo de `EntidadeCodigoSequencia`:

```
id · cliente_id · entidade · escopo_tipo · escopo_id? · proximo_valor
createdAt · updatedAt
```

Unique conceitual: `[cliente_id, entidade, escopo_tipo, escopo_id]`.

### O cuidado com `NULL` no unique do PostgreSQL

No PostgreSQL, `NULL` nunca é igual a `NULL` num índice unique. Se `escopo_id`
ficar nulo para o escopo `tenant`, **duas linhas de sequência para a mesma
entidade coexistem** — o unique não barra nada, e as duas distribuem números em
paralelo. O sintoma aparece só sob concorrência, que é exatamente quando a
numeração precisa funcionar.

A P3 **deve** escolher uma representação segura antes da primeira migration:

| Aceito | Como |
|---|---|
| valor sentinela não nulo | escopo `tenant` grava `escopo_id = ''` (ou o próprio `cliente_id`), nunca `NULL` |
| unique parcial por tipo de escopo | um índice único parcial por `escopo_tipo`, cada um com predicado próprio |

**Proibido:** `escopo_id` nulo dentro de um unique comum.

O PROJETOMG resolveu o caso mais simples — a chave dele é
`[cliente_id, entity_name]`, sem escopo, então o problema não aparece. Aqui o
escopo é parte do contrato desde o início, e o risco vem junto.

## 9. Anexos

Registro genérico, independente de provider e sem vocabulário Base44:

```
id · cliente_id · entidade · entidade_id · nome_original · storage_key
mime_type · tamanho_bytes · checksum? · criado_por · createdAt
```

| Regra | Valor |
|---|---|
| identidade persistente | `storage_key` |
| URL pública | temporária; **nunca** identidade |
| dono do anexo | `entidade` + `entidade_id`, dentro do tenant |
| mime e tamanho | validados no backend |
| nome original | sanitizado |
| exclusão física | política explícita |
| binário dentro do PostgreSQL | **não** |
| provedor de storage | **não decidido na P2** |

A distinção entre `storage_key` e URL é a diferença entre trocar de provedor com
um `UPDATE` de configuração e ter que reprocessar cada linha da tabela. O MAIKE
já pagou esse preço uma vez: `file_url` da Base44 está espalhado pela cadeia
preservada e é justamente o que a P6 vai ter que reescrever.

## 10. Exclusão

| Regra | Valor |
|---|---|
| hard delete | permitido **somente** quando as regras de vínculo autorizarem |
| soft delete global | **não** aplicado por padrão |
| campo `ativo` | não substitui política de exclusão |
| lifecycle | decidido explicitamente por capacidade |
| auditoria de exclusão | registra as exclusões relevantes |

Não existe `deletedAt` universal. Adicionar um campo a todo model para resolver
um problema que ainda não apareceu é overengineering com custo de consulta em
cada `WHERE`. Quando uma capacidade precisar de retenção, ela declara.

`src/services/deleteGuardService.js` já implementa a versão frontend dessa ideia:
dependência declarada sem carregador **falha**, em vez de virar liberação
silenciosa (D-PROD-20). O backend herda a postura.

## 11. Concorrência

| Regra | Valor |
|---|---|
| operação composta crítica | dentro de transação |
| numeração | transacional |
| unique constraints | última barreira, sempre presente |
| conflito de unique | vira erro estável (`CONCURRENCY_CONFLICT`) |
| `max + 1` no frontend | deixa de ser aceito quando a capacidade migrar |
| framework de saga | **não** nesta fase |

Transação e unique constraint resolvem o que o produto tem hoje. Saga resolve
transação distribuída entre serviços — e o MAIKE tem um banco só. Criar o
mecanismo antes do problema é a "solução paralela" que a Constituição proíbe.

DBT-19 continua aberto até a P3: enquanto o provider for a Base44, operação
composta de manejo não é atômica. O que a P1.2 fez foi tornar a falha parcial
**visível** (`MAPA_PARTIAL_OPERATION`), não eliminá-la.

## 12. Códigos de erro

Vocabulário mínimo do contrato, com o mapeamento HTTP proposto:

| Código | HTTP | Significado |
|---|---|---|
| `TENANT_CONTEXT_REQUIRED` | 401 | requisição sem contexto de tenant autenticado |
| `TENANT_SCOPE_VIOLATION` | 403 | recurso pertence a outro `cliente_id` |
| `SEQUENCE_SCOPE_INVALID` | 400 | escopo de sequência não declarado pela capacidade |
| `SEQUENCE_CONFLICT` | 409 | reserva de número não pôde ser concluída |
| `ATTACHMENT_INVALID` | 400 | mime, tamanho ou nome de anexo reprovado |
| `ATTACHMENT_OWNER_INVALID` | 404 | `entidade` + `entidade_id` não identificam registro do tenant |
| `AUDIT_WRITE_FAILED` | 500 | falha crítica de auditoria — observável, nunca silenciosa |
| `CONCURRENCY_CONFLICT` | 409 | unique constraint barrou escrita concorrente |

**Estes códigos não entram em `src/apis/_core/ApiError.js` na P2.** O catálogo do
frontend só cataloga código que tem consumidor — é a regra SE11, criada na
P1.4-R1 justamente porque `PRODUTO_PARTIAL_IMPORT` estava lá sem nenhum chamador.
Sem backend, nenhum desses oito tem chamador.

O namespace futuro é `backend/src/shared/errors/`, criado na P3. As rotas que os
emitem também.

## 13. Exemplos Prisma — blueprint documental

**Os blocos abaixo não são arquivos executáveis.** Não existe `schema.prisma` no
MAIKE e não pode existir antes da P3. Eles mostram a forma que o contrato exige.

```prisma
model Cliente {
  id        String   @id @default(cuid())
  nome      String   @db.VarChar(255)
  ativo     Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Único model sem cliente_id: ele É o tenant.
  @@index([nome])
}

model Lote {
  id          String   @id @default(cuid())
  cliente_id  String   @db.VarChar(64)
  numero_lote Int
  nome        String   @db.VarChar(255)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  cliente Cliente @relation(fields: [cliente_id], references: [id])

  @@unique([cliente_id, numero_lote])   // unique de negócio inclui o tenant
  @@index([cliente_id, nome])           // índice começa por cliente_id
}

model EntidadeCodigoSequencia {
  id            String   @id @default(cuid())
  cliente_id    String   @db.VarChar(64)
  entidade      String   @db.VarChar(128)
  escopo_tipo   String   @db.VarChar(32)
  escopo_id     String   @db.VarChar(64)   // sentinela, nunca NULL — ver §8
  proximo_valor Int      @default(1)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  cliente Cliente @relation(fields: [cliente_id], references: [id])

  @@unique([cliente_id, entidade, escopo_tipo, escopo_id])
  @@index([cliente_id, entidade])
}
```

Reserva de número — a forma, não o arquivo:

```
UPDATE "EntidadeCodigoSequencia"
   SET "proximo_valor" = "proximo_valor" + 1, "updatedAt" = NOW()
 WHERE "cliente_id" = $1 AND "entidade" = $2
   AND "escopo_tipo" = $3 AND "escopo_id" = $4
 RETURNING ("proximo_valor" - 1) AS atribuido
```

Um `UPDATE … RETURNING` dentro da transação da escrita. Sem `SELECT MAX`, sem
`COUNT`, sem leitura seguida de escrita.

## 14. Gates exigidos na P3

| Gate | Verifica |
|---|---|
| `gate:tenancy` | todo model Prisma tem `cliente_id`, exceto `Cliente` |
| `gate:indices` | todo `@@index`/`@@unique` tenant-scoped começa por `cliente_id` |

Ambos já estão previstos em `docs/engineering/GATE-REGISTRY.md` como gates
futuros. A P2 não os cria: sem `schema.prisma`, eles não teriam o que ler.

O que a P2 cria é o `gate:modelobase1-pecuario`, que protege o **contrato**. Os
dois gates da P3 protegem a **implementação** do contrato. São camadas
diferentes e ambas ficam.

## 15. Riscos e decisões adiadas

| Adiado para | O quê |
|---|---|
| P3 | representação segura de `escopo_id` (sentinela ou unique parcial) |
| P3 | forma da sessão/autenticação própria e do `auth_context` |
| P3 | política concreta de `onDelete` de `Cliente` |
| P4–P6 | qual entidade usa escopo `tenant` e qual usa escopo `empresa` |
| P4–P6 | provedor de storage dos anexos |
| P6 | migração de `file_url` da Base44 para `storage_key` |

Riscos que **permanecem abertos** e não são desta missão: OWNER-SECURITY-01,
Base44 temporária até a P7, 2.319 diagnósticos de tipos, bundle de ~2,50 MB,
`npm audit` pendente, ausência de ACID nas operações Base44 (DBT-19) e ausência
de backend até a P3.

## 16. Critério de certificação

O contrato está certificado quando, cumulativamente:

1. `npm run gate:modelobase1-pecuario` sai com 0;
2. `npm run verify:all` sai com 0 em todas as etapas;
3. a CI do commit funcional fica verde (o run fica registrado no corpo da PR —
   um commit não pode conter o resultado da própria execução);
4. **a PR é mergeada por um humano.**

Enquanto o merge não acontecer, o contrato existe mas não é oficial. Nenhum
agente pode afirmar aprovação antes disso.

## 17. Handoff para P3

A P3 cria, e só ela:

```
backend/  ·  Fastify  ·  Prisma  ·  PostgreSQL
Cliente  ·  Usuario/sessão mínima  ·  AuditLog
EntidadeCodigoSequencia  ·  RegistroAnexo
gate:tenancy  ·  gate:indices
health check  ·  migrations versionadas
```

Três limites que este documento fixa expressamente:

1. **Nenhuma migration de domínio pode começar antes do merge da P2.**
2. **A P3 implementa somente a camada de tenant/fundação** — nenhum model de
   mapa e nenhum model de manejo.
3. **P4–P6 migram capacidades uma de cada vez**, cada uma declarando o próprio
   lifecycle e o próprio escopo de numeração.

O handoff é uma lista de trabalho, não uma autorização para executá-lo nesta PR.
