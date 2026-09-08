# AGENTS.md — Comandos operacionais

## Setup

```bash
npm install
cp .env.example .env.local
```

Preencha `VITE_GOOGLE_MAPS_API_KEY` em `.env.local`. Sem essa variável o Mapa
Geral abre e mostra "Mapa indisponível" com a mensagem de configuração — não
fica em branco.

### Backend (P3)

```bash
npm run db:up            # sobe o PostgreSQL local (Docker Compose)
npm run prisma:deploy    # aplica as migrations
npm run backend:dev      # sobe o Fastify com --watch
npm run test:backend     # testes contra PostgreSQL real
```

Preencha `DATABASE_URL` e `AUTH_SECRET` em `.env` — ver `.env.example`. O
backend **não sobe** sem os dois: ausência de segredo é falha dura, não
fallback. Nenhuma variável do backend leva prefixo `VITE_`; prefixar publicaria
segredo de servidor no bundle do cliente.

O backend ainda **não é consumido pelo frontend**. A primeira capacidade migra
na P4 — ver `docs/engineering/ROADMAP.md`.

## Desenvolvimento

| Tarefa | Comando |
|---|---|
| Frontend | `npm run dev` |
| Lint | `npm run lint` |
| Dívida de tipos em `src/` (catraca) | `npm run typecheck` |
| Dívida de tipos em `src/` (bruta) | `npm run typecheck:raw` |
| Tipos do `backend/` (tolerância zero) | `npm run typecheck:backend` |
| Smoke automatizado | `npm run test:smoke` |
| Testes dos gates | `npm run test:gates` |
| Testes de backend | `npm run test:backend` |
| Build | `npm run build` |

## Gates

Todos os scripts vivem em `scripts/gates/`.

| Gate | Comando | Verifica |
|---|---|---|
| Testes dos gates | `npm run test:gates` | Os próprios gates, com casos de falha |
| Governança | `npm run gate:governance-paths` | Documentos, links e gates coerentes |
| Package/lock | `npm run gate:package-sync` | `package.json` e `package-lock.json` batem |
| Escopo do produto | `npm run gate:product-scope` | Rotas, menu, schemas, functions **e entidades dentro das functions** (por AST) |
| Fechamento de código | `npm run gate:source-closure` | Nenhum arquivo executável órfão em `src/` |
| Integridade de imports | `npm run gate:import-integrity` | Nenhum import quebrado em `src/` |
| Segredos | `npm run gate:no-secrets` | Nenhum segredo em arquivo versionado; nenhum `.env` |
| Base44 | `npm run gate:base44` | Acoplamento só diminui (10 eixos) |
| Contrato base pecuário | `npm run gate:modelobase1-pecuario` | O contrato de persistência e domínio da P2 (D-PROD-21) — **absoluto**, sem baseline |
| Tenancy | `npm run gate:tenancy` | Schema Prisma e backend cumprem a tenancy — **absoluto** |
| Índices | `npm run gate:indices` | Índice e unique tenant-aware — **absoluto** |
| Tipos (`src/`) | `npm run gate:types` | A dívida de tipos não cresce |
| Tipos (`backend/`) | `npm run typecheck:backend` | O backend tem **zero** diagnóstico — **absoluto**, sem baseline |
| **Todos** | `npm run verify:all` | 18 etapas, build por último |

### Baselines

Ambos são versionados. **Baseline ausente reprova** — nenhum gate cria baseline
sozinho. Execução normal nunca escreve arquivo.

```bash
# só grava se não houver regressão E houver pelo menos uma redução
node scripts/gates/gate-base44-ratchet.mjs --update
node scripts/gates/gate-typecheck-ratchet.mjs --update

# mudança consciente de jsconfig.typecheck.json ou de versão do TypeScript
# (sujeita à mesma barreira de não regressão)
node scripts/gates/gate-typecheck-ratchet.mjs --rebase-contract
```

`gate:types` não tem `--seed`. Baseline perdido se restaura do Git:
`git checkout -- scripts/gates/typecheck-baseline.json`.

`scripts/gates/base44-baseline.json` · `scripts/gates/typecheck-baseline.json`

O baseline de tipos também grava o hash canônico da configuração, o comando e a
versão do compilador (D-PROD-13). Reduzir a cobertura reprova com
`P01-TYPE-CONTRACT` — nem `--rebase-contract` aceita.

## Escopo do produto

O escopo executável é `config/mapa-manejo-scope.json`. Ele declara páginas,
rotas manuais, schemas e functions permitidos, além dos domínios proibidos.

Para adicionar uma página ou entidade:

1. Provar a necessidade pelo fechamento de dependências
2. Registrar a decisão em `docs/engineering/DECISIONS.md`
3. Só então atualizar o manifesto
4. Rodar `npm run verify:all`

## Armadilhas

- **`base44/` é a especificação de origem.** Não altere o desenho de um schema
  preservado. Excluir schema fora do escopo é permitido por D-PROD-02.
- **Nenhum schema ou function Base44 novo.** A Base44 só sai (D-PROD-04).
- **`gate:types` verde significa "a dívida não cresceu", não "sem erros".**
  São 2.319 diagnósticos versionados, com teto certificado de 2.319 (DBT-03).
  Veja os reais com `npm run typecheck:raw`. Afrouxar `jsconfig.typecheck.json`
  não passa: a configuração está no baseline (D-PROD-13). Rebasear também não
  passa: **nenhum modo** aceita diagnóstico novo (D-PROD-17).
- **Código novo entra com zero diagnóstico.** Absorver erro novo no baseline é
  proibido — corrija no código.
- **`backend/` tem contrato de tipos PRÓPRIO, e ele é zero.** A catraca lê
  `jsconfig.typecheck.json`, que inclui apenas `src/`; o backend passa por
  `npm run typecheck:backend`, sobre `jsconfig.backend.typecheck.json`. São
  dois contratos independentes de propósito: a catraca legada tolera 2.319
  diagnósticos herdados, e o backend **não tolera nenhum**. Não existe baseline,
  teto nem `--update` ali. Diagnóstico novo no backend se corrige no código ou
  se declara em `.d.ts` — `any`, `@ts-ignore` e `@ts-nocheck` são fuga, não
  correção.
- **Decoração de Fastify se declara, não se silencia.** `request.contexto` e
  `app.autenticar` existem em runtime e não no compilador. O lugar deles é
  `backend/src/types/fastify.d.ts`, por module augmentation.
- **Não defina `NODE_ENV` no `env:` do job do workflow.** `env:` de job alcança
  TODOS os passos, inclusive o `npm run build`, e qualquer valor diferente de
  `production` faz o Vite empacotar React e outras bibliotecas em modo de
  desenvolvimento — ~1 MB a mais, sem uma linha de `src/` ter mudado, e sem
  aparecer no diff. Aconteceu na primeira versão da P3. `verify:all` fixa
  `production` no passo de build, e `build-environment.test.mjs` trava as duas
  pontas.
- **Backend sem banco não testa.** `npm run test:backend` **falha** sem
  `DATABASE_URL`, em vez de pular. Suíte que se auto-desliga reporta verde sem
  ter verificado nada.
- **Function Base44 não pode indexar `entities` com variável.** Use acesso
  literal ou um registro literal local — senão `gate:product-scope` reprova com
  `P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE` (D-PROD-15).
- **Arquivo órfão reprova** (`gate:source-closure`). Remova-o ou justifique em
  `orphanAllowlist` com consumidor dinâmico real — "pode ser útil depois" não
  é justificativa.
- **Branch.** Uma missão, uma branch, um PR. Não trabalhe na `main`.
- **Menu e rotas têm SSOT único**: `src/lib/menuConfig.js` e `src/pages.config.js`.
