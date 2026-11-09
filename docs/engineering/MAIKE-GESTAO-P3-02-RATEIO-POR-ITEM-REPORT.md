# MAIKE — Gestão P3-02: rateio gerencial por item (D-PROD-156)

| Campo | Valor |
|---|---|
| Missão | MAIKE-GESTAO-P3-02-RATEIO-POR-ITEM-IMPLEMENTACAO-INTEGRADA (2026-11-09) |
| Decisão | [D-PROD-156](./DECISIONS.md) (autorização explícita do proprietário) |
| PR | #231 (**draft**), branch `claude/maike-gestao-p3-02-rateio-por-item` |
| Base | `origin/main` `f2b81e1b`, merge da PR #230 (P3-01, em produção) |
| Runbook de release | [`MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md), **não executado** |

> **Provas.** Todo número deste relatório é saída real de comando, medida em
> PostgreSQL 17.11 local descartável, com Playwright local, ou no CI da PR.
> Nada foi gravado em Preview nem em produção.

## 1. Gate 0: smoke da release P3-01 (somente leitura, 2026-11-09)

| Item | Resultado |
|---|---|
| `main` | `f2b81e1b` (merge da PR #230). O CI `quality` da `main` foi acompanhado |
| Deploy de produção | `dpl_2oFTcopkiQv1YqQD9sv282zdy7q4` READY, SHA `f2b81e1b`, aliases `www.makgestao.com`, `makgestao.com` e `maike-five.vercel.app` |
| `GET /api/native/health` | 200; `banco: up`; release `f2b81e1b` |
| `/LancamentosFinanceiros` | 200 (`text/html`) |
| API protegida sem sessão | `GET /api/native/operacoes-financeiras` → 401 `TENANT_CONTEXT_REQUIRED`, sem dados |
| Logs do deploy novo | só o aviso `FSTDEP023` (depreciação do Fastify), presente desde 2026-10-23; nenhum 5xx novo |
| Banco (SELECT) | 35 concluídas e 0 com falha; checksum da P3-01 `bb89f4e0…`; 8 tabelas com RLS e sem FORCE; 8 políticas; 0 grants públicos |
| `maxDuration` efetivo | **NAO_COMPROVADO**. O conector da Vercel não expõe o valor; conferir no painel (runbook da P3-01, §8.7) |

Veredito: **PASS**, com uma pendência só de leitura no painel (`maxDuration`).

## 2. O que foi entregue

O comportamento está descrito na D-PROD-156. Em resumo:

- **Escopo do rateio**, no mesmo documento:
  - **GERAL** é o padrão e o comportamento da P3-01;
  - **POR_ITEM** existe só com produtos. Cada item, mercadoria ou serviço, tem a sua própria divisão de natureza e centros, por valor ou percentual, sobre o **valor líquido** do item;
  - os modos são mutuamente exclusivos.
- **Banco:** migration expand-only `20261109200000_gestao_p3_02_rateio_por_item`.
  - Coluna anulável `OperacaoFinanceira.rateio_escopo`.
  - Tabela nova `OperacaoFinanceiraItemRateio`: 20 colunas; 6 FKs compostas com tenant e empresa; 2 CHECKs, um deles de tipo × direção; PK, 2 uniques e 3 índices; RLS e política para `maike_vercel`.
  - O classificador sem alteração devolve `expand: true` e 0 violações.
  - SHA-256 `df4d1ab29144d551793bb2fe43616d60bed86b87f10ec044d1cae2552076f4a0` e DO `dc05126c…bd576`, pinados.
- **Backend:**
  - **Algoritmo único de maiores restos** (`maioresRestos`, BigInt), usado pelo rateio do cabeçalho, pelo rateio geral em percentual e pelo rateio por item. Comparado com a cópia do algoritmo da P3-01 em 6.000 casos, deu igual em todos.
  - **Normalização e plano** com exclusões de escopo, base no líquido do item, invariante Σ = total e `rateio_consolidado`.
  - **Erros** que apontam item e linha.
  - **Serviço:**
    - itens criados com `createManyAndReturn` e linhas associadas pela ordem do item na mesma requisição;
    - linhas apagadas antes dos itens no PUT e no descarte;
    - a confirmação replaneja a partir do banco e recusa um POR_ITEM inválido mesmo vindo direto pela API;
    - retrato dos nomes na confirmação;
    - auditoria com `rateio_escopo`.
- **Tela** (`LancamentosFinanceiros`):
  - seletor "Rateio: Geral | Por item" e blocos por item que recolhem e expandem, com líquido e diferença por item e total;
  - linha única mostrada como 100%; "Aplicar classificação a todos";
  - diálogos de troca nos dois sentidos, sem perda silenciosa;
  - estado preso à chave estável do item; botões para subir e descer item;
  - Confirmar desabilitado enquanto algo não fecha;
  - erro do servidor levado ao campo exato;
  - consulta e prévia com a classificação por item e o consolidado;
  - 390 px sem rolagem horizontal.
- **Backend falso** dos testes espelhando o contrato real.

## 3. Provas

| Prova | Resultado |
|---|---|
| Testes PG da P3 (`gestaoP3*.test.mjs`, 9 arquivos, com `NODE_ENV=test` e `MAIKE_TESTE_AGORA`) | **161/161**, 0 falhas. O arquivo novo `gestaoP3RateioItem.test.mjs` cobre os casos do SPEC §7 (listados abaixo da tabela) |
| Vetores de paridade `tests/smoke/fixtures/rateioPorItemVetores.json` (16 casos: BRL, PYG e KWD; VALOR e PERCENTUAL; empates; desconto+acréscimo; mercadoria+serviço) | Conferidos pelo backend (plano puro e PostgreSQL) e pela tela (função pura e backend falso): **0 divergências**. Sem o arquivo, o teste da tela falha |
| Paridade aleatória backend × tela | 3.000 documentos no teste do backend: 1.859 aceitos, 1.141 recusas iguais, 11.791 linhas idênticas. Fuzz com 2 × 5.000 documentos (sementes 156 e 909): **0 divergências** em 54.472 linhas e 3.957 recusas |
| vitest | Suíte completa: **164 arquivos, 1.967/1.967**. `gestaoLancamentos*`: 7 arquivos, 246/246 |
| E2E real (tela + Fastify + PG17; passos novos 28 e 29) | 1280 e 390 px; `connection_limit` 5 e 3: **58 ✓ / 0 ✗** em cada pool, 174 capturas. Os passos 1 a 27 da P3-01 continuam verdes |
| No banco, depois do E2E | escopo POR_ITEM e nenhuma linha no rateio geral; **1 título por parcela** (771,66 + 771,67 = total); **1 movimento e 1 lote por mercadoria**, com kg × custo = líquido; o serviço não gera movimento; 4 linhas por item exatas; Σ por item = líquido; Σ total = 1.543,33 |
| Gates | `deploy-migrations`, `supabase-public-grants`, `tenancy` (70 models), `indices`, `import-integrity`, `no-secrets`, `base44`, `governance-paths`, `product-scope` e `native-api` passam; `test:gates` 695/695 |
| Lint e tipos | lint com 0 erros (56 avisos herdados); `gate:types` com 815 (teto 1.746); `typecheck:backend` 0 |
| Prisma | `validate` OK; `migrate diff --exit-code` 0 de banco → schema e de migrations → schema |
| `verify:all` no HEAD final | ver §5 |

Casos cobertos pelo arquivo novo `gestaoP3RateioItem.test.mjs` (SPEC §7):
- 3 naturezas; 1 item em 2 centros; mercadoria + serviço;
- desconto e acréscimo; BRL, PYG e KWD;
- soma errada recusada com `indice` e `subindice`;
- natureza ou centro inativo, de outro tenant ou de outra empresa; tipo × direção;
- duplicidade; alteração e remoção de item; cancelamento; replay;
- documento antigo com `rateio_escopo` NULL tratado como GERAL;
- 1000 linhas;
- concorrência PUT×PUT, PUT×confirmar e confirmar×PUT.

## 4. Revisão adversarial

A revisão adversarial focada (lentes de dinheiro, banco e tela) e as correções
com RED→GREEN estão no §4.1, preenchido ao fim da rodada.

### 4.1 Achados e correções
(preenchido ao fim da rodada)

## 5. Gate final
(preenchido com o `verify:all` e o CI do HEAD final)

## 6. Limitações declaradas

- **`rateio_escopo` sem CHECK no banco.** O classificador proíbe CHECK em
  tabela antiga, então o domínio (NULL, GERAL ou POR_ITEM) é garantido no
  serviço e nos testes. NULL é tratado como GERAL.
- **Item de outro documento.** A tabela nova não tem como garantir, por FK, que
  `item.operacao_id` seja igual a `linha.operacao_id`: isso exigiria uma unique
  nova em `OperacaoFinanceiraItem`, e o classificador a proíbe. O serviço
  sempre grava as duas coisas juntas. Uma linha forjada por SQL direto faz a
  confirmação falhar fechada.
- **`rateio_modo` é do documento.** VALOR ou PERCENTUAL vale para todas as
  linhas de todos os itens.
- **Preview da PR.** Ela usa o banco de produção, que ainda não tem o schema da
  P3-02. Não use a Preview para testar.
- **`maxDuration` de 60 s.** Continua sem leitura no painel desde a P3-01.

## 7. Prontidão

| Critério | Estado |
|---|---|
| CODE_READY | ver §5 |
| SCHEMA_APPLIED_PROD | **NÃO**. Nada da P3-02 foi enviado ao Supabase |
| MERGE_READY | **NÃO**. Antes do merge: GO específico, migration aplicada e conferida pelo runbook |
