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

O deployment originado do merge desta missão é o primeiro a rodar com o
pre-deploy configurado. O que ele precisa mostrar:

1. um estágio de pre-deploy no log, antes do `backend:start`;
2. a linha `deploy:migrate — aplicando migrations versionadas...`;
3. a saída do Prisma aplicando `20260909201703_p4_1_r2_setor_tipo_default`;
4. a linha `deploy:migrate — migrations aplicadas.`;
5. `/health` em 200 com `banco: up` depois disso.

Enquanto os cinco não estiverem registrados, **`DEPLOY-MIGRATION-01B` continua
aberto** — e, com ele, `DEPLOY-MIGRATION-01`. Nenhum relatório desta missão
declara o contrário antes da hora.

O registro dessas linhas entra como adendo a este arquivo, na `main`, assim que
o deployment terminar. Nomes de migration, sucesso/falha e timestamps apenas:
nenhuma connection string, nem mascarada.

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
