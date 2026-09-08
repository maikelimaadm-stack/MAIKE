# README — Ponto de Entrada para Agentes de IA

**Status:** Oficial — pre-flight obrigatório antes de qualquer implementação
**Versão:** 2.0.0
**Repositório:** MAIKE

---

## Propósito

Este é o **primeiro documento** que qualquer agente de IA ou nova sessão deve ler
antes de tocar no código.

O projeto **não depende de memória de chat**. Toda estratégia, arquitetura, estado
e decisão vivem neste repositório.

---

## ESTADO ATUAL DO PROJETO

| Campo | Valor |
|---|---|
| **Produto** | Pecuária — **Mapa Geral + Manejo** (D-PROD-01) |
| **Superfície primária** | `MapaGeral` — a raiz `/` redireciona para lá (D-PROD-05) |
| **Missões concluídas** | **P0** (PR #1), **P1** (PR #6), **P2** (PR #7) — mais a sincronização de SSOT (PR #8) e a emenda D-PROD-22 (PR #9) |
| **Missão atual** | **P3 — Backend + Prisma + PostgreSQL Foundation** (implementada, em PR draft, aguardando auditoria — inclui a correção **P3-R1**) |
| **Próxima missão** | **P4 — Mapa Core Native Persistence** (não iniciada) |
| **Contrato de dados** | `config/modelobase1-pecuario.json` — **oficial** desde o merge da P2 (D-PROD-21) |
| **Escopo executável** | `config/mapa-manejo-scope.json` |
| **Molde arquitetural** | PROJETOMG — **parcial** (D-PROD-03) |
| **Roadmap** | `docs/engineering/ROADMAP.md` |

O MAIKE **não é mais um ERP amplo**. Financeiro, fiscal, folha, máquinas,
combustível, agrícola, safra, comercial, cotação, pesagens individuais,
relatórios genéricos, dashboards paralelos, fichas personalizadas e editor visual
**saíram do produto** e foram fisicamente excluídos (D-PROD-02).

### Inventário atual

| Métrica | Valor |
|---|---|
| Páginas | 16 |
| Arquivos em `src/` | 263 |
| Schemas Base44 | 38 |
| Functions Base44 | 1 (`syncEntityReferences`) |
| Arquivos em `src/` com SDK | 4 — todos **dentro** da fronteira |
| Registry literal do provider | 38 entidades |
| Dependências diretas | 55 (37 `dependencies` + 18 `devDependencies`) |
| Dívida de tipos versionada | 2.319 diagnósticos em `src/` (teto certificado 2.319) |
| Dívida de tipos no `backend/` | **0** — contrato próprio, tolerância zero |
| Testes automatizados | **964** (428 de gate + 495 de smoke + 41 de backend) |
| Etapas do `verify:all` | 18 |
| Bundle de produção — JS | 2.496,62 kB (669,03 kB gzip) |

**Fronteira de dados (`gate:api-boundary`): 0/0/0/0/0/0.** Os seis eixos estão
zerados desde a P1.4 e o baseline versionado tem as seis listas vazias —
qualquer reintrodução reprova.

A **P3** criou `backend/` — Fastify, Prisma e PostgreSQL, com cinco models de
fundação e migration versionada. Acrescentou os gates `gate:tenancy` e
`gate:indices` (55 provas, quase todas negativas) e a etapa `test:backend`,
que roda contra PostgreSQL real.

A correção **P3-R1** fechou cinco bloqueios de auditoria dentro da mesma PR:
identidade em runtime contornando o `@default(cuid())`, relação `AuditLog →
Usuario` sem coerência de tenant, regressão de bundle causada por `NODE_ENV`
no workflow (e **não** pelo backend), `backend/` sem cobertura de tipos e
`prisma validate` que existia como script mas não rodava na cadeia. Três dos
cinco eram invariante **declarada e não verificada** — a mesma classe da P2-R1.
Ver §16 do relatório da P3.

Nem a P2 nem a P3 alteraram `src/`, `base44/`, rotas, menu ou escopo. O backend
existe mas **ainda não é consumido pelo frontend**: a fronteira da P1 continua
apontando para o provider Base44, e a primeira capacidade migra na P4.

Antes/depois completo: `docs/engineering/CURRENT-STATE.md`.

---

## Checklist Pré-Implementação (obrigatório)

Antes de alterar **qualquer** arquivo, leia e verifique:

| # | Documento | Caminho |
|---|---|---|
| 0 | Este arquivo | `README_AI.md` |
| 1 | Constituição | `docs/constitution/00-CONSTITUICAO.md` |
| 2 | Do Not Do | `docs/constitution/07-DO-NOT-DO.md` |
| 3 | Regras de IA | `docs/constitution/08-REGRAS-DE-IA.md` |
| 4 | Estado atual | `docs/engineering/CURRENT-STATE.md` |
| 5 | Decisões | `docs/engineering/DECISIONS.md` |
| 6 | Roadmap | `docs/engineering/ROADMAP.md` |
| 7 | Registro de gates | `docs/engineering/GATE-REGISTRY.md` |
| 8 | Escopo do produto | `config/mapa-manejo-scope.json` |
| 9 | Comandos | `AGENTS.md` |

**Se algum documento estiver desatualizado em relação ao código, atualize-o antes
de prosseguir.**

---

## Durante a implementação — três perspectivas

### 1. Escopo do produto
A mudança serve ao Mapa Geral, ao manejo iniciado pelo Mapa Geral ou à
configuração indispensável dessas capacidades? Se não, ela não entra
(D-PROD-06). Em conflito entre preservar código antigo e cumprir o escopo,
**o escopo do produto vence**.

### 2. Arquitetura
Respeita o molde do PROJETOMG? Cria solução paralela a algo que já existe?
Componente está acessando dado diretamente?

### 3. Independência
Esta mudança aumenta ou diminui o acoplamento com a Base44?
**Nunca pode aumentar.**

---

## Trabalho baseado em evidência

O agente **deve**:

| # | Requisito |
|---|---|
| E1 | Citar caminho de arquivo ao afirmar fato sobre a arquitetura |
| E2 | Ler o arquivo real antes de editar — nunca assumir de memória |
| E3 | Rodar `npm run verify:all` após mudanças estruturais |
| E4 | Reportar falha de gate honestamente — nunca silenciar ou pular |
| E5 | Distinguir "existe no código" de "está planejado no roadmap" |

O agente **não deve**:

- Afirmar que gate passou sem ter rodado
- Inventar módulos, entidades ou funcionalidades que não existem
- Citar conclusão de relatório antigo sem reverificar no código atual
- Ampliar `config/mapa-manejo-scope.json` sem aprovação humana

---

## Disciplina de escopo

| Tipo de missão | Comportamento |
|---|---|
| **Levantamento** | Somente leitura. Produz documento. Zero alteração de código |
| **Fundação** | Só a camada declarada na missão |
| **Schema** | Só `backend/prisma/`. Um módulo por vez |
| **Migração de capacidade** | Só a capacidade declarada. Nunca duas ao mesmo tempo |

Quando a missão disser "não altere X", não altere X — **mesmo que encontre um bug**.
Registre o bug em `docs/engineering/DECISIONS.md` e siga.

---

## O que "verde" significa aqui

`npm run verify:all` sai com **0**. Três das dezoito etapas são **catracas**
(`gate:base44`, `gate:api-boundary` e `gate:types`), e o significado delas é
literal:

| Etapa | Verde significa | Verde **não** significa |
|---|---|---|
| `gate:base44` | o acoplamento com a Base44 não cresceu | que a Base44 saiu |
| `gate:types` | a dívida de tipos não cresceu | que o `tsc` está sem erros |

O projeto **tem** 2.319 diagnósticos de tipo, versionados em
`scripts/gates/typecheck-baseline.json` com teto certificado de 2.319, e sempre
visíveis em `npm run typecheck:raw`. A cobertura é `jsconfig.typecheck.json`,
que inclui todo o `src/`. A dívida só desce (DBT-03).

Uma etapa nova desde a P2 **não** é catraca: `gate:modelobase1-pecuario` é
**absoluto**. Ele valida `config/modelobase1-pecuario.json` contra o contrato
base de persistência e domínio (D-PROD-21) e não tem `--update`, baseline nem
correção automática — não existe estado herdado aceitável num contrato que ainda
não tem implementação.

As etapas da P3 seguem a mesma linha: `gate:tenancy`, `gate:indices` e
`typecheck:backend` também são **absolutos**. `typecheck:backend` usa
`jsconfig.backend.typecheck.json`, separado da catraca legada de propósito — a
catraca de `src/` tolera 2.319 diagnósticos herdados, e o backend novo não
tolera nenhum. Verde ali significa literalmente **zero**.

**Não adianta afrouxar o `jsconfig.typecheck.json`.** Desde o P0.1-R2
(D-PROD-13) o baseline grava o hash canônico da configuração, o comando, a
versão do TypeScript e o contrato de cobertura. `checkJs: false`, `include: []`
ou excluir `src/lib` reprovam com `P01-TYPE-CONTRACT` — a cobertura não é
rebaseável.

**E não adianta rebasear.** Desde o P0.1-R3 (D-PROD-17) a barreira de não
regressão vale em **todos** os modos: nem `--update` nem `--rebase-contract`
aceitam fingerprint novo, multiplicidade aumentada, arquivo pior, total maior ou
total acima do `certifiedCeiling`. Quando ela dispara, o baseline fica byte a
byte intacto. `--seed` não existe mais: baseline ausente é falha dura, e o
arquivo se restaura do Git.

**Código novo nasce limpo.** Diagnóstico introduzido por código novo é corrigido
no código, nunca absorvido pelo baseline.

---

## Certificação de fim de missão

Toda missão termina com relatório em `docs/engineering/` contendo:

1. Arquivos criados ou alterados
2. Resultado de `npm run verify:all` (colado, não resumido)
3. Divergências em relação ao molde do PROJETOMG, com justificativa
4. Pendências e riscos identificados
5. Decisões que precisam de aprovação humana

Todos os relatórios vivem em `docs/engineering/`. Os marcos:

| Missão | Relatório |
|---|---|
| P0.1 | `docs/engineering/P0.1-MAPA-MANEJO-SCOPE-RESET-REPORT.md` (+ R1 a R4) |
| P1.1 | `docs/engineering/P1.1-NATIVE-API-BOUNDARY-EMPRESA-REPORT.md` (+ R1 a R4) |
| P1.2 | `docs/engineering/P1.2-NATIVE-API-BOUNDARY-MAPA-REPORT.md` (+ R1, R2) |
| P1.3 | `docs/engineering/P1.3-NATIVE-API-BOUNDARY-MANEJO-REPORT.md` |
| P1.4 | `docs/engineering/P1.4-NATIVE-API-BOUNDARY-SUPPORT-ADMIN-REPORT.md` |
| P2 | `docs/engineering/P2-MODELOBASE1-PECUARIO-FOUNDATION-REPORT.md` |
| P3 | `docs/engineering/P3-BACKEND-PRISMA-POSTGRESQL-FOUNDATION-REPORT.md` |

Arquitetura de contrato, fora da linha de missões:
`docs/architecture/MODELOBASE1-PECUARIO-CONTRACT.md`.
