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
| **Missões concluídas** | **P0** (PR #1), **P1** (PR #6), **P2** (PR #7), **P3** (PR #10, merge `4ce4608` — inclui a **P3-R1**) — mais as sincronizações de SSOT (PRs #8, #11 e #13) e a emenda D-PROD-22 (PR #9) |
| **Missão em execução** | **P4 — Mapa Core Native Persistence** — fatias **P4.0** (PR #12, merge `45599f5`, inclui **P4.0-R1**; corrigida pela **P4.0-R2**, PR #15, merge `b2535ec`) e **P4.1** (PR #14, merge `b559c48`, inclui **P4.1-R1**) mergeadas; **P4.1-R2** implementada, em revisão |
| **Próxima fatia autorizável** | **P4.2 — AreaPastagem Native Persistence** — **não iniciada** |
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
| Arquivos em `src/` | 271 |
| Schemas Base44 | 38 |
| Functions Base44 | 1 (`syncEntityReferences`) |
| Arquivos em `src/` com SDK | 4 — todos **dentro** da fronteira |
| Registry literal do provider | 37 entidades — o manifesto menos `Setor`, já nativo (D-PROD-25) |
| Models Prisma | 6 (5 de fundação + `Setor`) · 2 migrations versionadas |
| Dependências diretas | 56 (38 `dependencies` + 18 `devDependencies`) |
| Dívida de tipos versionada | 2.318 diagnósticos em `src/` (teto certificado 2.318) |
| Dívida de tipos no `backend/` | **0** — contrato próprio, tolerância zero |
| Testes automatizados | **1.140** (494 de gate + 556 de smoke + 90 de backend) |
| Etapas do `verify:all` | 20 |
| Bundle de produção — JS | 2.505,17 kB (671,56 kB gzip) |

**Fronteira de dados (`gate:api-boundary`): 0/0/0/0/0/0.** Os seis eixos estão
zerados desde a P1.4 e o baseline versionado tem as seis listas vazias —
qualquer reintrodução reprova.

A **P3** criou `backend/` — Fastify, Prisma e PostgreSQL, com cinco models de
fundação e migration versionada. Acrescentou os gates `gate:tenancy` e
`gate:indices` (55 provas, quase todas negativas) e a etapa `test:backend`,
que roda contra PostgreSQL real. Está **mergeada**: PR #10, merge `4ce4608`,
sobre a implementação certificada em `5bcee77`.

A correção **P3-R1** fechou cinco bloqueios de auditoria dentro da mesma PR #10:
identidade em runtime contornando o `@default(cuid())`, relação `AuditLog →
Usuario` sem coerência de tenant, regressão de bundle causada por `NODE_ENV`
no workflow (e **não** pelo backend), `backend/` sem cobertura de tipos e
`prisma validate` que existia como script mas não rodava na cadeia. Três dos
cinco eram invariante **declarada e não verificada** — a mesma classe da P2-R1.
Ver §16 do relatório da P3.

A **P4.0** abriu a P4 ligando o navegador ao backend próprio: URL nativa
(`VITE_MAIKE_API_URL`), cliente HTTP único, sessão JWT em `sessionStorage`,
login nativo, CORS com allowlist exata e o gate absoluto `gate:native-api`.
Fechou também a dívida de erros que a P3 declarou: os oito códigos do contrato
entraram no catálogo do frontend. **Nenhum model de domínio** — Setor e
AreaPastagem são P4.1 e P4.2. Ver D-PROD-24.

A correção **P4.0-R1** fechou um bloqueador achado em auditoria externa: a
restauração da sessão apagava o JWT para qualquer erro, confundindo backend fora
do ar com credencial recusada. Agora só `TENANT_CONTEXT_REQUIRED` limpa o token;
indisponibilidade preserva a credencial, mantém o aplicativo fechado e oferece
retry sem pedir senha. Ver D-PROD-24 §G.1.

A P4.0, com a R1, está **mergeada**: PR #12, merge `45599f5`, sobre a
implementação certificada em `f01201b`.

A **P4.1** migrou a **primeira capacidade de domínio**: `Setor` passou a ser
model Prisma tenant-scoped, com migration versionada, rotas `GET`/`POST`/`PATCH`
autenticadas e numeração por `EntidadeCodigoSequencia` — o `MAX + 1` que o
navegador calculava deixou de existir. O frontend tem uma **porta única**
(`src/apis/setores/setorNativePort.js`), usada tanto pelo cadastro quanto pelo
mapa, e a Base44 deixou de ser origem, destino e **fallback** do dado de Setor.
A exclusão está **fechada por decisão**: não existe `DELETE /setores/:id`
enquanto os dependentes (`AreaPastagem`, `LancamentoTarefa`,
`MovimentacaoMapa`, `MovimentacaoPecuaria`) não forem nativos. Acrescentou o
gate absoluto `gate:setor-native` (42 provas). Ver D-PROD-25 e
`docs/engineering/P4.1-SETOR-NATIVE-PERSISTENCE-REPORT.md`.

Nem a P2 nem a P3 alteraram `src/`, `base44/`, rotas, menu ou escopo — e, à
época delas, o backend existia sem ser consumido pelo frontend.

**Isso mudou com a P4.0 e a P4.1.** Hoje a **autenticação, a sessão e o cadastro
de Setor** falam com o backend nativo. O **resto do domínio geográfico ainda não
migrou**: `AreaPastagem`, `PontoReferencia`, `PontoSuplementacao`,
`LinhaGeografica`, `ConfiguracaoIcone` e `MovimentacaoMapa` continuam no
provider Base44, e a fronteira da P1 continua apontando para lá para esses
dados. A próxima capacidade é **P4.2 (AreaPastagem)**, que **não foi iniciada**.

`base44/entities/Setor.jsonc` **continua existindo** e `Setor` continua em
`allowedBase44Entities`: a function `syncEntityReferences`, que propaga o nome
do setor para os campos denormalizados de **seis** destinos — `AreaPastagem`, `PontoSuplementacao`, `Lote`, `LancamentoTarefa`, `MovimentacaoMapa` e `MovimentacaoPecuaria` — ainda roda na Base44 e ainda o cita. São **seis**, não as quatro da guarda
de exclusão: os dois contratos não coincidem, e a diferença está registrada em
D-PROD-25 §N. Independência declarada antes dos destinos migrarem seria
falsa — e `gate:product-scope` reprovaria.

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

`npm run verify:all` sai com **0**. Três das vinte etapas são **catracas**
(`gate:base44`, `gate:api-boundary` e `gate:types`), e o significado delas é
literal:

| Etapa | Verde significa | Verde **não** significa |
|---|---|---|
| `gate:base44` | o acoplamento com a Base44 não cresceu | que a Base44 saiu |
| `gate:types` | a dívida de tipos não cresceu | que o `tsc` está sem erros |

O projeto **tem** 2.318 diagnósticos de tipo, versionados em
`scripts/gates/typecheck-baseline.json` com teto certificado de 2.318, e sempre
visíveis em `npm run typecheck:raw`. A cobertura é `jsconfig.typecheck.json`,
que inclui todo o `src/`. A dívida só desce (DBT-03).

Uma etapa nova desde a P2 **não** é catraca: `gate:modelobase1-pecuario` é
**absoluto**. Ele valida `config/modelobase1-pecuario.json` contra o contrato
base de persistência e domínio (D-PROD-21) e não tem `--update`, baseline nem
correção automática — não existe estado herdado aceitável num contrato que ainda
não tem implementação.

As etapas da P3, da P4.0 e da P4.1 seguem a mesma linha: `gate:tenancy`,
`gate:indices`, `typecheck:backend`, `gate:native-api` e `gate:setor-native`
também são **absolutos**. `typecheck:backend` usa
`jsconfig.backend.typecheck.json`, separado da catraca legada de propósito — a
catraca de `src/` tolera 2.318 diagnósticos herdados, e o backend novo não
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
| P4.0 | `docs/engineering/P4.0-NATIVE-TRANSPORT-SESSION-ACTIVATION-REPORT.md` (+ P4.0-R1) |
| P4.1 | `docs/engineering/P4.1-SETOR-NATIVE-PERSISTENCE-REPORT.md` |

Arquitetura de contrato, fora da linha de missões:
`docs/architecture/MODELOBASE1-PECUARIO-CONTRACT.md`.
