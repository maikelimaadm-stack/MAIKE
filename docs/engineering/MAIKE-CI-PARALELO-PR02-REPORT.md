# MAIKE-CI-PARALELO-PR02 — perfil `full` em jobs paralelos, mesma cobertura

**Decisão:** [D-PROD-180](./DECISIONS.md). **Base:** [D-PROD-179](./DECISIONS.md) e [`MAIKE-CI-INTELIGENTE-PR01-REPORT.md`](./MAIKE-CI-INTELIGENTE-PR01-REPORT.md).
**Pedido do proprietário (2026-11-13):** "as verificações estão demorando muito". Entre as opções apresentadas, ele escolheu "dividir em jobs paralelos".
**Natureza:** só infraestrutura de CI e de teste. Código de produto, banco, migrations, escopo e permissões ficam como estão.

## 1. Ponto de partida (medido, não estimado)

| Run | Evento | `verify:all` | `test:backend` | `test:smoke` |
|---|---|---|---|---|
| 43422451165 (`da9fb314`, main) | push | 1723,7 s | 1040,3 s | 452,5 s |
| 43426229416 (`d85cb3b8`, PR #255) | pull_request | 1310,1 s | 787,6 s | 346,0 s |

Nas duas runs, o `test:backend` e o `test:smoke` somam de 86 % a 87 % do tempo. Também nas duas, o job falhou no S03-R1 por causa do pool de 3 conexões. Essa falha é corrigida na PR #257, e esta branch parte dela.

## 2. Desenho

```text
classify ──┬── verify:docs-fast                     (só PR de documentação, D-PROD-179)
           └── verify:full (estatico)                gates, prisma:generate, types, typecheck, lint, builds
               verify:full (backend 1/4 .. 4/4)      test:backend por grupo, cada um com PostgreSQL 16.13 próprio
               verify:full (smoke 1/2 .. 2/2)        Vitest --shard
                         │
                    verify:all  (único check exigido; FULL_PASS só se TODAS as partes passarem)
```

- **`estatico`:** roda `node scripts/gates/verify-all.mjs --pular=test:backend,test:smoke`.
  - O `--pular` só aceita etapas que existem: nome desconhecido ou argumento estranho saem com exit 1.
  - Sem o argumento, o `verify:all` local roda a cadeia inteira, como sempre.
- **`backend i/4`:** roda `TEST_BACKEND_SHARD=i/4 npm run test:backend`.
  - O runner valida a especificação **antes** de tocar no banco.
  - Depois aplica todas as migrations no banco vazio, o mesmo smoke de migration de antes, uma vez por grupo.
  - Os arquivos do grupo rodam em série (`--test-concurrency=1`). Grupos diferentes nunca dividem banco.
- **`smoke i/2`:** roda `npm run test:smoke -- --shard=i/2`, com o shard nativo do Vitest.
- **`fail-fast: false`:** todas as falhas aparecem na mesma rodada.
- **Agregação:** `needs.full.result` da matriz só é `success` se todas as partes passarem. O agregador `verify:all` não mudou.

### 2.1 Divisão do backend

`scripts/ci/backend-shards.mjs` divide os arquivos pelo maior peso primeiro, sempre no grupo mais leve, com desempate determinístico.
- **Pesos:** milissegundos de cada arquivo rodado sozinho num PostgreSQL 17 local, em `scripts/ci/backend-test-pesos.json`.
- **Arquivo novo sem peso:** entra com o peso mediano. Pode piorar o equilíbrio, nunca a cobertura.

## 3. Provas de cobertura

| Teste | Prova |
|---|---|
| BS-1 / BS-2 | com os 127 arquivos reais, para n = 1..6, cada arquivo cai em exatamente um grupo e a união é a lista inteira |
| BS-3 | divisão determinística, inclusive com a lista em outra ordem |
| BS-4 | arquivo novo sem peso entra em exatamente um grupo; sem pesos nenhum, ainda cobre tudo |
| BS-5 / BS-8 | especificação inválida é recusada, e o runner falha antes de validar schema ou conectar |
| BS-6 | com os pesos medidos, o grupo mais pesado fica em no máximo 1,25 × a média |
| QP-W7 | a matriz tem exatamente: um `estatico` que pula só `test:backend` e `test:smoke` (etapas que existem no `verify-all.mjs`), os shards `1/n..n/n` do backend e os `1/m..m/m` do Vitest, sem sobra |

## 4. Evidências

**Pesos.** 127 de 127 arquivos medidos, cada um sozinho no PostgreSQL 17.11 local. Nenhum falhou; somam 972,8 s. Divisão resultante:

| n | Grupos (soma local / arquivos) |
|---|---|
| 3 | 324 s/41 · 324 s/42 · 324 s/44 |
| **4 (escolhido)** | **243 s/30 · 243 s/34 · 243 s/31 · 243 s/32** |
| 5 | 195 s/24 · 194 s/25 · 195 s/25 · 195 s/26 · 194 s/27 |

Ficaram 4 grupos de backend porque, assim, cada grupo dura perto do job `estatico` e dos shards do Vitest.

**Prova local de ponta a ponta** (as três partes rodando ao mesmo tempo, na mesma máquina):

| Parte | Resultado |
|---|---|
| `estatico`: `verify-all.mjs --pular=test:backend,test:smoke` | exit 0, "TODAS AS ETAPAS PASSARAM", 222 s |
| `backend 4/4`: `TEST_BACKEND_SHARD=4/4 npm run test:backend`, banco novo | exit 0, 32 de 127 arquivos, 389/389, 329 s com as migrations |
| `smoke 1/2` e `smoke 2/2`: `vitest run --shard=i/2` | exit 0 e exit 0, em 131 s e 88 s; a união dá exatamente os 214 arquivos, sem repetição |

**Testes de gate:** `backend-shards.test.mjs` (BS-1..BS-8), `quality-profile.test.mjs` (com o QP-W7) e `build-environment.test.mjs`: 58/58.

O tempo real na CI fica registrado na PR depois da primeira execução. Antes disso, não afirmo ganho em minutos.

## 5. Limites

- Cada parte faz o próprio `npm ci`, e cada parte de backend roda as migrations: o tempo total de máquina sobe, o tempo de espera cai.
- Os pesos envelhecem. Só o equilíbrio depende deles; a cobertura é garantida pelos testes BS.
- O `verify:all` local continua serial. Quem quiser o paralelo localmente pode rodar os comandos da matriz em terminais separados, com um banco por grupo de backend.
