# DEPLOY-MIGRATION-01B — Ativação da barreira de migrations no Railway

**Missão:** `DEPLOY-MIGRATION-01B` — ativação, em produção, da barreira criada
na `DEPLOY-MIGRATION-01A` (D-PROD-28).
**Decisão:** D-PROD-29.
**Escopo de código:** nenhum. Nenhum arquivo em `src/`, `backend/`, `scripts/`
ou `config/` foi alterado. Esta missão é **operacional e documental**.

---

## 1. O que estava aberto

A `DEPLOY-MIGRATION-01A` entregou o runner (`scripts/deploy/run-migrations.mjs`),
o gate (`gate:deploy-migrations`) e as provas. O que ela **não** podia entregar é
estado externo: a plataforma precisa ser configurada para chamar o runner.

O drift que motivou tudo isso continuava de pé quando esta missão começou:

| | `main` | produção |
|---|---|---|
| Migrations versionadas | 3 | 2 |
| `Setor.tipo` — default | `'Próprio'` | ausente |

A migration ausente é `20260909201703_p4_1_r2_setor_tipo_default`.

---

## 2. O que foi configurado

Serviço `MAIKE`, ambiente `production`, projeto `MAIKE` no Railway.

**A) `MIGRATION_DATABASE_URL` como variável de referência**

O valor gravado **não** é uma connection string literal. É a referência do
Railway para outra variável do mesmo serviço:

```
MIGRATION_DATABASE_URL = ${{ DATABASE_URL }}
```

Isso é deliberado e tem três consequências que valem ser ditas em voz alta:

1. **Nenhum segredo novo foi criado, lido ou digitado.** A referência é
   resolvida pelo Railway na injeção do ambiente; quem configurou não precisou
   ver o valor.
2. **A rotação da senha do banco passa a ser um único campo.** Antes, trocar a
   senha exigiria editar `DATABASE_URL`, `DIRECT_URL` e `MIGRATION_DATABASE_URL`
   à mão, com três chances de errar e uma janela em que as três discordam.
   Agora `DATABASE_URL` é a única fonte.
3. **Não é fallback.** O runner continua sem fallback nenhum: se
   `MIGRATION_DATABASE_URL` não existir, ele falha com
   `DEPLOY-MIGRATION-URL-REQUIRED`. O que existe aqui é uma decisão explícita do
   operador de que, **hoje**, as duas conexões são a mesma — e são, porque a
   aplicação também fala pelo *session pooler* na 5432, não pelo pooler de
   transação.

O ponto 3 tem prazo de validade. No dia em que a aplicação migrar para o pooler
de transação (6543) por motivo de escala, esta referência **tem de ser
desfeita** e `MIGRATION_DATABASE_URL` passa a apontar para a conexão de sessão
por conta própria. Se alguém esquecer, o runner recusa a 6543 e o deploy falha —
que é exatamente o comportamento desejado, e é por isso que a regra do
`DEPLOY-MIGRATION-UNSAFE-POOLER` existe.

**B) Pre-deploy Command**

```
npm run deploy:migrate
```

Gravado em *Settings → Deploy → Pre-deploy Command* do serviço.

---

## 3. O achado: `redeploy` não é deploy

Esta é a parte que interessa a quem for repetir o procedimento.

Depois de gravar a variável e o pre-deploy, o caminho óbvio é mandar um
*redeploy* e conferir o log. Foi o que foi feito — e o deployment terminou
`SUCCESS` **sem nenhum estágio de pre-deploy**. O log de deploy vai direto de
`Starting Container` para `> node backend/src/server.js`.

Ausência de log não é prova de nada, então em vez de concluir dali, foi montado
um **controle negativo**:

> `MIGRATION_DATABASE_URL` foi apontada para uma fixture reconhecidamente
> inválida — porta **6543** do Supabase, usuário e senha falsos, valor que não é
> segredo nenhum — e um novo *redeploy* foi disparado.
>
> Se a barreira estivesse ativa, o runner recusaria com
> `DEPLOY-MIGRATION-UNSAFE-POOLER` e o deployment **teria de falhar**.
>
> O deployment terminou `SUCCESS`.

Conclusão, agora com prova: **o pre-deploy não estava sendo executado**. A
variável foi restaurada para `${{ DATABASE_URL }}` logo em seguida.

A causa é a semântica do próprio Railway. `redeploy` re-executa um deployment
que já existe, reaproveitando o build **e o restante da especificação daquele
deployment**. Alterações de configuração de deploy — pre-deploy incluído —
entram na especificação de um deployment **novo**, originado da fonte. Um
*redeploy* de um deployment anterior à mudança continua sendo aquele deployment.

Daí a regra operacional, que vale para toda mudança futura de configuração de
deploy neste projeto:

> **Mudança de configuração de deploy só existe no deployment seguinte
> originado da fonte.** Confirmar com um `redeploy` não confirma nada.

E daí também a razão de esta missão ser um commit: o merge na `main` dispara o
deployment a partir da fonte que carrega a configuração nova. O relatório é o
gatilho da própria prova que ele precisa registrar.

---

## 4. Evidência de fechamento

O deployment originado do merge da PR #20 (`257eaaa`) é o primeiro a rodar com o
pre-deploy configurado. Os cinco pontos exigidos, e o que aconteceu:

**Estado do banco antes**, medido direto no PostgreSQL de produção, não inferido:

| | `main` | produção às 18:13 UTC |
|---|---|---|
| Linhas em `_prisma_migrations` | 3 | **2** |
| `Setor.tipo` — `column_default` | `'Próprio'` | **`null`** |

**Log do deployment `f0dab2d0`, 2026-09-10 (UTC):**

```
18:14:46  > maike-mapa-manejo@0.0.0 deploy:migrate
18:14:46  > node scripts/deploy/run-migrations.mjs
18:14:46  deploy:migrate — aplicando migrations versionadas...
18:14:46  > maike-mapa-manejo@0.0.0 prisma:deploy
18:14:46  > prisma migrate deploy --schema backend/prisma/schema.prisma
18:14:46  Prisma schema loaded from backend/prisma/schema.prisma
18:14:48  3 migrations found in prisma/migrations
18:14:51  Applying migration `20260909201703_p4_1_r2_setor_tipo_default`
18:14:52  The following migration(s) have been applied:
18:14:52    └─ 20260909201703_p4_1_r2_setor_tipo_default/
18:14:52  All migrations have been successfully applied.
18:14:52  deploy:migrate — migrations aplicadas.
18:14:55  Stopping Container
18:15:02  Starting Container
18:15:03  > node backend/src/server.js
18:15:03  Server listening at http://127.0.0.1:8080
18:15:05  GET /health → 200
```

As quatro primeiras linhas foram acrescentadas na `DEPLOY-MIGRATION-01B-R1`. A
transcrição original começava em `> prisma migrate deploy`, e com isso deixava
de fora justamente a linha que prova que **o runner** rodou — e não um
`prisma migrate deploy` avulso que alguém tivesse posto no pre-deploy. As duas
coisas produzem a mesma saída do Prisma; só `deploy:migrate — aplicando
migrations versionadas...` distingue uma da outra. Ver §6.

E o corpo da resposta de `/health`, que o ponto 5 exige por inteiro:

```
HTTP/2 200
{"status":"ok","processo":"up","banco":"up","configuracaoIncompleta":[]}
```

O par `Stopping Container` / `Starting Container` entre a migration e o
`backend:start` é o que prova a separação de estágios da D-PROD-28: são
containers diferentes. Migrar e servir tráfego não são a mesma coisa, e agora
isso é observável, não só afirmado.

**Estado do banco depois:**

| | valor |
|---|---|
| Linhas em `_prisma_migrations` | **3** — a terceira com `finished_at` 18:14 |
| `Setor.tipo` — `column_default` | **`'Próprio'::character varying`** |

O drift entre `main` e produção está **fechado**, e fechado pelo caminho certo:
ninguém aplicou SQL à mão. A `20260909201703` foi a última migration deste
repositório aplicada manualmente — e ela nem chegou a ser, porque quem a aplicou
foi a barreira.

Os cinco pontos estão registrados. **`DEPLOY-MIGRATION-01B` está fechado**, e
com ele **`DEPLOY-MIGRATION-01`**. O bloqueio da ONDA 1 cai.

Nenhuma connection string aparece acima. A única linha do log do Prisma que cita
infraestrutura — o host e a porta do datasource — foi deliberadamente omitida
desta transcrição.

---

## 5. O que esta missão não fez

Nenhum model novo — Prisma continua com **6**. Nenhuma migration criada: a
pendente é a que já existia. Nenhuma rota, nenhum provider, nenhum arquivo de
`src/`. `AreaPastagem`, `Empresa`, `Lote`, `PontoReferencia`,
`PontoSuplementacao`, `LinhaGeografica`, `ConfiguracaoIcone` e
`MovimentacaoMapa` continuam ausentes do schema. Base44 inalterada nos dez
eixos.

As alterações pendentes (*staged changes*) anteriores do serviço **não foram
aplicadas** e continuam pendentes. Elas não foram criadas aqui e não fazem parte
desta missão; aplicá-las de passagem seria misturar missões.

Nenhum valor de segredo foi lido, impresso ou versionado. A fixture usada no
controle negativo é deliberadamente falsa e existe para provar uma recusa.

---

## 6. DEPLOY-MIGRATION-01B-R1 — o que a revisão externa pegou

Duas observações do Codex na PR #21, as duas procedentes.

**A) A transcrição não continha todas as cinco evidências que o §4 exigia.**

O §4 desta missão listou cinco pontos e disse que o fechamento dependia dos
cinco. A transcrição publicada tinha três: a aplicação da migration, a linha
final do runner e o `/health` em 200. Faltavam a linha
`deploy:migrate — aplicando migrations versionadas...` e o **corpo** da resposta
com `banco: up`.

Não é diferença cosmética, e vale dizer por quê. Sem a primeira linha, a
transcrição não distingue duas coisas bem diferentes: o **runner** ter rodado, e
alguém ter posto um `prisma migrate deploy` cru no pre-deploy. As duas produzem
saída idêntica do Prisma. Só a linha do runner separa uma da outra — e o runner é
a coisa inteira que a `DEPLOY-MIGRATION-01A` entregou: é ele que recusa a porta
6543, que exige `MIGRATION_DATABASE_URL` e que não faz fallback.

Um relatório que declara "os cinco pontos estão registrados" exibindo três
comete exatamente o erro que esta missão documentou no §3: aceitar evidência
parcial como se fosse a evidência pedida. O §3 fala de ausência de log tratada
como sucesso; isto é a mesma falha com outra roupa.

As duas linhas **existiam** nos logs desde sempre — a janela de consulta é que
começava tarde demais. Foram buscadas de novo e acrescentadas ao §4. O veredito
não muda: a barreira rodou, e agora a transcrição prova isso sozinha.

**B) Os planos ficaram contraditórios sobre a P4.2.**

O fechamento do blocker atualizou o cabeçalho e a tabela de dívidas do
`CURRENT-STATE.md`, mas deixou duas linhas para trás — a da P4 na tabela de
progresso e a da P4.2 no `ROADMAP.md` — ainda dizendo "bloqueada por
DEPLOY-MIGRATION-01". O mesmo documento afirmava, em lugares diferentes, que a
próxima fatia estava liberada e que não estava.

Corrigido nas duas. O ponto geral, que vale para as próximas missões: fechar um
bloqueador não é editar o parágrafo onde ele foi declarado, é varrer todo lugar
que o cita. Um SSOT que discorda de si mesmo é pior que um SSOT desatualizado —
o desatualizado ao menos não dá duas respostas.
