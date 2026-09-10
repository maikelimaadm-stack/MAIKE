# DEPLOY-MIGRATION-01 — Production Migration Barrier

**Decisão:** D-PROD-28 · **Gate:** `gate:deploy-migrations`
**Base:** `main @ 588792bfa67235e85b2bcedff3abc7df918ef4e9` (merge da PR #17)

Infraestrutura de entrega. **Nenhuma entidade migra aqui.** Não é P4.2, não é a
ONDA 1.

---

## 1. O problema

Migration em produção era **ato manual**.

A tabela `Setor` (P4.1) foi aplicada à mão. O default de `Setor.tipo` (P4.1-R2)
também — e ficou horas no repositório sem estar no banco, depois do merge,
porque o deploy do Railway constrói e sobe o código sem aplicar migration
nenhuma. Verificado no ambiente real logo após o merge da PR #17:

| | `main` | produção |
|---|---|---|
| migrations | 3 | 2 |
| `Setor.tipo` default | `'Próprio'` | `null` |

Nada quebrou, porque a API exige `tipo` em todo caminho de escrita. Mas o
mecanismo que produziu esse drift é o mesmo que, numa onda de domínio inteira,
faz o código chegar antes da tabela — e aí o sintoma é erro de aplicação em
produção, não falha de deploy.

Estado encontrado no repositório:

- `npm run prisma:deploy` existia e funcionava;
- a CI já rodava `prisma migrate deploy` contra PostgreSQL descartável;
- **não havia** `railway.json`, `railway.toml`, `nixpacks.toml`, `Dockerfile`,
  `Dockerfile.railway` nem `Procfile` — nenhum arquivo de configuração de
  plataforma versionado;
- o `preDeployCommand` real do serviço estava vazio.

---

## 2. Pesquisa oficial consultada

| Fonte | O que estabeleceu |
|---|---|
| Railway — *Add a Pre-Deploy Command* (`/deployments/pre-deploy-command`) | Roda entre build e deploy, na rede privada, com as variáveis do serviço. **"If your command fails, it will not be retried and the deployment will not proceed."** Precisa sair 0. Container separado, sem volumes. Timeout configurável de 1 a 3600 s. |
| Railway — *Using Config as Code* (`/config-as-code`) | **Depreciado.** Corte duro em **2026-12-01**. **"New services cannot opt into Config as Code."** |
| Railway — *Infrastructure as Code* (`/infrastructure-as-code` e `/infrastructure-as-code/reference`) | Substituto: `.railway/railway.ts`, com campo `preDeploy`. Avaliado pelo CLI (`railway config plan` / `apply`), **project-level**, semântica *omit = delete*. |
| Prisma 6.19 — `migrate deploy` | Aplica só migrations versionadas, idempotente, sem prompt. Lê `env("DATABASE_URL")` do datasource. |
| Supabase — Supavisor session vs transaction mode | Session mode (5432) sustenta sessão e prepared statements; transaction mode (6543) não. Migration precisa de sessão longa e advisory lock. |

---

## 3. Arquitetura escolhida

```
build  →  pre-deploy: npm run deploy:migrate  →  start: npm run backend:start
             │                                        │
             └── MIGRATION_DATABASE_URL                └── DATABASE_URL
                 (sessão/direta, 5432)                     (o que a app usa)
```

### Por que migration não roda no startup

A tentação óbvia é chamar `migrate deploy` no `server.js`. O motivo de não
fazer não é estético — é que isso faz o lifecycle do schema virar o lifecycle
do processo:

- todo restart, todo crash-loop e todo scale-up tentariam migrar;
- com N réplicas, N processos disputam a mesma tarefa. O advisory lock do
  Prisma evita corrupção, mas transforma o start numa fila — e o healthcheck
  não espera fila;
- falha de migration viraria falha de boot, que o orquestrador trata como
  "reinicie": um loop em vez de um erro legível;
- o deploy anterior, saudável, seria substituído antes de alguém saber que o
  schema não subiu.

O `gate:deploy-migrations` prova que os dois estágios não se misturam: nem
`backend:start` nem nenhum arquivo de `backend/src/**` dispara migration.

### Por que uma variável separada, e sem fallback

`MIGRATION_DATABASE_URL`, nunca caindo para `DATABASE_URL`.

As duas conexões têm requisitos diferentes. A aplicação pode falar por um pooler
de transação, feito para muitas conexões curtas. A migration não: roda DDL em
transação longa, com advisory lock, e precisa de sessão de verdade.

Fallback silencioso seria o pior dos mundos. Em produção, com a variável
ausente, o runner usaria a conexão da aplicação e **funcionaria** — até travar
no meio de um `ALTER TABLE`, com o deploy pela metade. Já aconteceu neste
projeto: `migrate deploy` apontado para a 6543 ficou pendurado até o deploy ser
cancelado à mão.

Ausência é falha dura, de propósito.

### Por que o schema Prisma NÃO ganhou `directUrl`

O Prisma 6 suporta `directUrl`, e seria a solução de manual. Recusada: faria
`prisma validate`, `prisma generate`, o desenvolvimento local, a CI e o runtime
passarem todos a depender de uma segunda variável para resolver um problema que
é **só do deploy**.

A fronteira é explícita e mora num lugar só: o runner passa
`DATABASE_URL=<MIGRATION_DATABASE_URL>` ao subprocesso do Prisma, e só a ele. O
ambiente do próprio runner não é mutado — `DM-T08b` prova isso.

O datasource continua:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Por que `railway.backend.json` NÃO foi criado

Era a implementação prevista. A documentação oficial atual a desautoriza:

> **Config as Code is deprecated.** […] Existing `railway.json` /
> `railway.toml` files continue to work for services that already use them
> until **2026-12-01** (hard cutoff). **New services cannot opt into Config as
> Code.**

O serviço de backend **não** usa Config as Code hoje — não há arquivo desses no
repositório e a configuração vem do painel. Adotá-lo agora seria adesão nova,
que a plataforma diz não aceitar, num mecanismo que deixa de ser lido em menos
de três meses.

Versionar um arquivo que a plataforma vai parar de ler — ou que o serviço sequer
consegue adotar — e criar um gate que o certifica seria **teatro**: gate verde,
barreira inexistente. Este repositório tem cinco registros de armadilha de
scanner ingênuo justamente para não fazer isso.

**Ativação usa o campo Pre-deploy Command do painel**, que não está depreciado.
O caminho declarativo futuro é Infrastructure as Code (`.railway/railway.ts`,
campo `preDeploy`), **não autorado nesta fatia** por dois motivos: é
project-level com semântica *omit = delete*, e escrevê-lo sem
`railway config pull` contra o projeto vivo arriscaria apagar variáveis, domínio
e configuração do proprietário — que ainda tem um patch em *staged* no serviço.

---

## 4. O runner

`scripts/deploy/run-migrations.mjs`, exposto como `npm run deploy:migrate`.

Fluxo:

1. lê `MIGRATION_DATABASE_URL`;
2. ausente ou vazia → `DEPLOY-MIGRATION-URL-REQUIRED`, exit ≠ 0. **Sem fallback**;
3. não é `postgres:`/`postgresql:`, ou não parseia → `DEPLOY-MIGRATION-URL-INVALID`;
4. host Supabase na porta 6543 → `DEPLOY-MIGRATION-UNSAFE-POOLER`;
5. executa `npm run prisma:deploy` em subprocesso, `shell: false`, com
   `DATABASE_URL` substituída;
6. propaga o exit code real. Erro não vira sucesso, e nada é engolido.

Não roda seed, `db push`, `migrate dev` nem `migrate reset`.

### Sigilo

O runner **nunca** imprime URL, host, porta, usuário ou senha — nem mascarada.
Uma senha "mascarada" com pedaço visível é uma senha vazada mais devagar. Em
erro de validação sai o código estável e uma frase; quem precisa do valor tem
acesso ao painel, não ao log.

`DM-T09` prova isso nos quatro caminhos (sucesso, falha do subprocesso, URL
inválida, pooler recusado), usando a fixture reconhecível
`SENHA_NAO_PODE_APARECER_123` e exigindo também que nenhum `@` apareça.

---

## 5. Gate

`gate:deploy-migrations`, absoluto, **posição 15** do `verify:all` (20 → 21
etapas). Seis códigos:

| Código | Invariante |
|---|---|
| `P28-DEPLOY-RUNNER` | lê a variável própria, chama o primitive, recusa a 6543, sem fallback |
| `P28-DEPLOY-SCRIPTS` | `deploy:migrate` → runner; `prisma:deploy` é `migrate deploy` e nada mais |
| `P28-DEPLOY-STARTUP` | nem `backend:start` nem `backend/src/**` migram |
| `P28-DEPLOY-CI` | `run-backend-tests.mjs` migra pelo runner, não pelo primitive |
| `P28-DEPLOY-ENV` | variável documentada sem valor, sem variante `VITE_`, ausente do frontend |
| `P28-DEPLOY-ACTIVATION` | a instrução de ativação não drifta do nome do script |

### Mutation proofs — 22, medidas

| Prova | Mutilação | Resultado |
|---|---|---|
| `DGM-03` | remove `deploy:migrate` do `package.json` | reprova |
| `DGM-03b` | `deploy:migrate` passa a chamar o primitive direto | reprova |
| `DGM-04` | `prisma:deploy` vira `migrate dev` | reprova |
| `DGM-05` | `prisma:deploy` vira `db push` | reprova |
| `DGM-06` | runner com `\|\| DATABASE_URL` | reprova |
| `DGM-06b` | runner com `?? DATABASE_URL` | reprova |
| `DGM-07` | migration dentro de `backend:start` | reprova |
| `DGM-07b` | migration dentro do `server.js` | reprova |
| `DGM-08` | runner de teste contorna `deploy:migrate` | reprova |
| `DGM-08b` | runner de teste ausente | reprova |
| `DGM-09` | variável prefixada com `VITE_` | reprova |
| `DGM-09b` | variável não documentada no `.env.example` | reprova |
| `DGM-09c` | frontend citando a variável | reprova |
| `DGM-12` | runner deixa de recusar a 6543 | reprova |
| `DGM-13` | runner passa a executar `migrate dev` | reprova |
| `DGM-14` | runner ausente | reprova |
| `DGM-15` | instrução de ativação ausente | reprova |
| `DGM-15b` | instrução driftou do nome do script | reprova |
| `DGM-10` / `DGM-10b` | **controle positivo:** repositório real e fixture fiel | passa |
| `DGM-11` | **controle positivo:** prosa citando `\|\| DATABASE_URL`, `migrate dev`, `db push` | passa |
| `DGM-11b` | **controle positivo:** backend mencionando migration em comentário | passa |

`DGM-09c` não é decorativa: ela **encontrou um defeito real no gate**. A
primeira versão de `listarFontes` varria só `.js`/`.mjs`, e o frontend deste
repositório é majoritariamente `.jsx` — um componente citando a conexão de banco
passaria batido. Corrigido para `.js|.jsx|.mjs|.cjs`.

### Provas do runner — 13, medidas

`DM-T01` a `DM-T10` em `scripts/tests/deploy/migrations.test.mjs`: variável
ausente, vazia e só-espaço; URL inválida; esquemas não-postgres; pooler 6543 em
dois formatos de host Supabase; conexões válidas; substituição de fronteira sem
mutar o ambiente do runner; falha antes de executar qualquer coisa; propagação
de exit code nos dois sentidos; sigilo; e ausência de `migrate dev`/`db push`.

`DM-T06b` é o controle positivo que impede a regra de virar palpite: **6543 fora
do Supabase não é recusada**. A regra é sobre o pooler do Supabase, não sobre o
número da porta.

---

## 6. A CI passou a exercitar o caminho de produção

`scripts/tests/run-backend-tests.mjs` chamava `prisma migrate deploy` direto.
Agora chama `npm run deploy:migrate`, com `MIGRATION_DATABASE_URL` apontando
para o PostgreSQL efêmero do job.

A diferença importa. Antes, a CI provava que "o Prisma consegue migrar". Agora
prova que **o nosso caminho de produção** consegue migrar. Um runner que
exigisse a variável errada, ou que engolisse o erro, passaria despercebido
enquanto a CI chamasse o primitive por fora. `P28-DEPLOY-CI` impede a volta.

---

## 7. Provas contra PostgreSQL 16 descartável

Cluster efêmero criado e destruído na sessão. Nenhum banco de produção,
staging, Supabase externo ou do proprietário.

```
banco vazio: 0 tabelas em public

1) sem MIGRATION_DATABASE_URL
   deploy:migrate — FALHOU [DEPLOY-MIGRATION-URL-REQUIRED]        exit 1

2) MIGRATION_DATABASE_URL em ...pooler.supabase.com:6543
   deploy:migrate — FALHOU [DEPLOY-MIGRATION-UNSAFE-POOLER]       exit 1

3) conexão descartável válida
   20260908174141_p3_foundation
   20260909112833_p4_1_setor_native
   20260909201703_p4_1_r2_setor_tipo_default
   All migrations have been successfully applied.                 exit 0

   tabelas: AuditLog, Cliente, EntidadeCodigoSequencia,
            RegistroAnexo, Setor, Usuario, _prisma_migrations

4) SEGUNDA execução no mesmo banco (idempotência)
   No pending migrations to apply.                                exit 0
   _prisma_migrations: 3 linhas

5) falha controlada — banco inexistente
   P1001: Can't reach database server                             exit 1
   ocorrências da credencial-fixture na saída: 0
```

O caso 5 prova a semântica que o Railway exige do pre-deploy: exit ≠ 0, erro
não engolido, credencial não vazada. Não foi preciso quebrar nada em produção
para demonstrar.

---

## 8. O que esta PR **não** fecha

O repositório não pode garantir que a plataforma foi configurada para chamar o
comando. Por isso o blocker é dividido:

| | Escopo | Estado |
|---|---|---|
| **DEPLOY-MIGRATION-01A** | barreira no repositório | **fechado por esta PR**, se auditada e mergeada |
| **DEPLOY-MIGRATION-01B** | ativação no Railway | **pendente** — ação do proprietário |

**Nenhuma configuração do Railway foi tocada nesta missão.** Há um patch do
proprietário em *staged* naquele serviço, e misturar mudança de repositório com
mudança externa não auditada é como se perde a capacidade de saber o que causou
o quê.

---

## 9. Ação do proprietário, depois do merge

Passos para o serviço **backend** no Railway. Nenhum valor real aparece aqui.

**A) Criar a variável de migration**

Em *Variables*, criar:

```
MIGRATION_DATABASE_URL
```

O valor é a URI de conexão PostgreSQL obtida no Supabase, em
*Connect → Session pooler* (ou a conexão direta), **porta 5432**.

**Não** use a porta 6543 (*Transaction pooler*). O runner recusa esse caso e o
deploy falha de propósito.

**B) Configurar o pre-deploy**

Em *Settings → Deploy → Pre-deploy Command*:

```
npm run deploy:migrate
```

Opcionalmente, defina *Pre-deploy Timeout* (o campo só aparece depois que o
comando é digitado). Um valor com folga sobre o tempo normal — a migration atual
leva segundos.

**C) Antes de aplicar, revisar os staged changes**

Existem alterações pendentes no serviço, anteriores a esta missão. **Revise uma
a uma.** Não use "Apply all" sem ler.

**D) Fazer um novo deployment.**

**E) Conferir nos logs** o estágio de pre-deploy e a execução das migrations.

**F) Ao compartilhar log**, mostre apenas nomes de migration, sucesso/falha e
timestamps. **Nunca** a connection string.

Depois disso, `DEPLOY-MIGRATION-01B` pode ser fechado — de preferência com uma
demonstração de que uma migration com falha impediria o deploy, feita sem tocar
produção destrutivamente.

---

## 10. Escopo

Nenhum model novo: Prisma continua com **6**. Migrations continuam as mesmas
**3** — nenhuma criada aqui. `AreaPastagem`, `Empresa`, `Lote`,
`PontoReferencia`, `PontoSuplementacao`, `LinhaGeografica`, `ConfiguracaoIcone` e
`MovimentacaoMapa` continuam ausentes do schema. `Setor` não foi alterado.
Nenhuma rota de domínio nova, nenhum provider migrado. Base44 inalterada em
todos os dez eixos.

Nenhum valor de segredo lido, impresso ou versionado. As credenciais nos testes
são fixtures deliberadamente reconhecíveis, e existem para provar que **não**
aparecem na saída.
