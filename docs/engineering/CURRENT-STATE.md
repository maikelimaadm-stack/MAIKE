# Estado Atual

**Atualizado em:** 2026-08-03 (P0.1 mergeada · P1 em andamento · P1.1 **sob correção P1.1-R2**)

---

## Programa

**MAIKE Pecuária — Mapa Geral + Manejo.** Sistema nativo e escalável, com a
Base44 mantida apenas como provider temporário da cadeia preservada (D-PROD-04).

| Campo | Valor |
|---|---|
| Produto | Pecuária — Mapa Geral + Manejo (D-PROD-01) |
| Superfície primária | `MapaGeral` (D-PROD-05) |
| Missão atual | **P1 — Native Foundation Bootstrap**, slice **P1.1** |
| Estado da missão | **P1.1 sob correção P1.1-R2** — bloqueadores de superfície pública, cadeia de service e contrato de `ApiError` |
| Próxima slice | P1.2 — Mapa |
| Branch | `claude/p1-1-native-api-boundary-empresa` (PR #2, draft) |
| Escopo executável | `config/mapa-manejo-scope.json` |
| Roadmap | `docs/engineering/ROADMAP.md` |
| Molde arquitetural | PROJETOMG, parcial (D-PROD-03) |

**OWNER-SECURITY-01 continua aberto.** A PR #1 foi mergeada pelo proprietário em
2026-08-03 **sem** que a confirmação de rotação da chave do Google Maps tenha
sido registrada. O merge não muda a exposição: a chave antiga permanece no
histórico Git, agora também na `main`. Revogação, criação de chave nova,
restrição por HTTP referrer e por API (Maps JavaScript, Drawing, Geometry) e
armazenamento apenas em `.env.local` seguem pendentes com o proprietário — ver
`docs/engineering/P0.1-R1-CORRECTIVE-HARDENING-REPORT.md`.

## Progresso por missão

| Missão | Nome | Estado |
|---|---|---|
| P0 | Product Scope Reset | **mergeada** (PR #1, merge `508cf62`) |
| P1 | Native Foundation Bootstrap | **em andamento** — P1.1 sob correção P1.1-R2; P1.2 a P1.4 não iniciadas |
| P2 | ModeloBase1 Pecuário Foundation | não iniciada |
| P3 | Backend + Prisma + PostgreSQL Foundation | não iniciada |
| P4 | Mapa Core Native Persistence | não iniciada |
| P5 | Manejo Core Native Persistence | não iniciada |
| P6 | Supporting Capabilities | não iniciada |
| P7 | Base44 Final Removal | não iniciada |
| P8 | Hardening and Release | não iniciada |

## Inventário

Números medidos após `npm ci` e `npm run build` finais.

| Métrica | Antes da P0.1 | `main` pós-P0.1 | Depois da P1.1-R2 |
|---|---|---|---|
| Páginas em `src/pages` | 102 | 16 | **16** |
| Arquivos em `src/` | 472 | 203 | **209** |
| Arquivos em `src/components` | 312 | 157 | **157** |
| Schemas em `base44/entities` | 87 | 38 | **38** |
| Functions em `base44/functions` | 11 | 1 | **1** |
| Dependências diretas (`dependencies`) | 63 | 31 | **31** |
| Dependências diretas (`devDependencies`) | 15 | 18 | **18** |
| Arquivos em `src/` com SDK/base44Client | 197 | 71 | **71** |
| Ocorrências de `base44.entities` | 1014 | 371 | **368** |
| Ocorrências de `base44.auth` | 29 | 16 | **16** |
| Ocorrências de `base44.integrations` | 24 | 6 | **6** |
| Ocorrências de `base44.functions` | 9 | 5 | **5** |
| Acoplamento Base44 fora de `src/` | 22 | 1 | **1** |
| Chaves Google Maps literais | 8 | 0 | **0** |
| Erros de lint | 64 | 0 | **0** |
| Diagnósticos `tsc` (cobertura total) | — | 2.802 | **2.797** (teto 2.797) |
| Testes automatizados | 0 | 183 | **322** (234 de gate + 88 de smoke) |
| Bundle de produção — JS | 4.347,45 kB | 2.461,36 kB | <!--BUNDLE-JS--> |
| Bundle de produção — CSS | 120,36 kB | 77,00 kB | <!--BUNDLE-CSS--> |

Os artefatos do bundle vêm da CI do **último commit com mudanças executáveis**
desta PR — não de um build local nem de uma execução anterior.

<!--BUNDLE-BLOCO-->

Baselines mecânicos: `scripts/gates/base44-baseline.json` (schema 2) e
`scripts/gates/typecheck-baseline.json` (schema 3: contrato de configuração —
D-PROD-13 — e teto certificado monotônico — D-PROD-17).

## Fronteira de dados (P1.1, D-PROD-18)

| Eixo do `gate:api-boundary` | `main` pós-P0.1 | Depois da P1.1-R2 |
|---|---|---|
| arquivos que importam `@/api/base44Client` | 68 | **67** |
| arquivos que usam `base44.entities` | 64 | **63** |
| arquivos que usam `base44.auth` | 13 | 13 |
| arquivos que usam `base44.integrations` | 5 | 5 |
| arquivos que usam `base44.functions` | 5 | 5 |
| arquivos com acesso computado a `entities` | 3 | 3 |

`src/pages/Empresa.jsx` saiu de todos os eixos. O adapter autorizado
`src/apis/_providers/base44Provider.js` não conta como dívida — ele é a
fronteira. Registry do provider nesta slice: `Empresa`, e mais nada.

## Gates ativos

13 etapas em `npm run verify:all` — ver `docs/engineering/GATE-REGISTRY.md`.
Todos os gates têm teste com casos de falha reais em `scripts/tests/gates/`; a
catraca de tipos é exercitada ponta a ponta, com `tsc` de verdade em projetos
temporários.

CI em `.github/workflows/quality.yml`.

| Commit | Conteúdo | Run | Resultado |
|---|---|---|---|
| `3c03ecf` | **commit funcional** da P1.1 | [30812723777](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30812723777) | **verde**, 13/13 |
| `df3e6f1` | certificação de estado da P1.1 | [30812950738](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30812950738) | **verde**, 13/13 |
| `8866768` | **commit funcional** da P1.1-R1 | [30815360716](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30815360716) | **vermelha** — `no-secrets` (ver abaixo) |
| `9447884` | correção do relatório | [30815727984](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30815727984) | **verde**, 13/13 — origem dos artefatos |
<!--CI-R2-->
| HEAD atual | só esta certificação de estado | ver corpo da PR #2 | — |

Um commit não pode conter o resultado da própria execução de CI. A execução do
commit documental que sucede `9447884` fica no corpo da PR #2.

O run vermelho de `8866768` fica registrado em vez de omitido. A reprovação foi
legítima: o relatório da própria P1.1-R1 citava um par nome-de-chave mais
literal ao explicar um achado, e `gate:no-secrets` casa esse padrão em qualquer
arquivo versionado, prosa incluída. Corrigido em `9447884`; ver DBT-17 para o
motivo de o `verify:all` local não ter pego antes.

## Débito conhecido

| # | Item | Tratamento |
|---|---|---|
| DBT-01 | Componentes acessam `base44` direto. A camada `src/apis/` existe desde a P1.1, com Empresa migrada e superfície pública protegida desde a P1.1-R2; restam 368 chamadas `base44.entities` fora dela | P1 |
| DBT-02 | `requiresAuth: false` em `src/api/base44Client.js` | P3 |
| DBT-03 | 2.797 diagnósticos de dívida de tipos versionados na catraca, com teto certificado de 2.797. `gate:types` impede crescer em qualquer modo (D-PROD-17) e impede afrouxar a configuração (D-PROD-13). P1 deve reduzir | P1 |
| DBT-04 | Sem tela de **entrada** de estoque (D-PROD-08) | P6 |
| DBT-05 | Chave Google Maps antiga permanece no histórico Git — revogar e rotacionar (OWNER-SECURITY-01) | ação do proprietário |
| DBT-06 | Bundle único de ~2,46 MB, sem code splitting | P8 |
| DBT-07 | `LayoutCampo`/`LayoutSecao`/`LayoutConfiguracao` + `src/services/campoEngine.js` sustentam o formulário dinâmico de lote — um mini-motor de layout dentro do produto | P2 |
| DBT-08 | `src/lib/offlineEntitySync.js` e `src/components/offline/mapaOfflineCache.jsx` mantêm listas de entidades duplicadas e desalinhadas entre si | P1 |
| DBT-09 | `getNextSystemNumber` em `src/pages/Produtos.jsx` lista a coleção inteira para calcular o próximo número | P6 |
| DBT-10 | `eslint.config.js` cobre `src/components`, `src/pages`, `src/Layout.jsx` e, desde a P1.1, `src/apis/`, `src/config/` e `src/services/empresaService.js`. `src/lib`, `src/api`, o restante de `src/services` e `scripts/` seguem fora — fechamento em P1.4 | P1 |
| DBT-11 | `npm audit` reporta vulnerabilidades nas dependências transitivas remanescentes | P8 |
| DBT-12 | `gate:types` fixa `typescriptVersion` no baseline. Atualizar o TypeScript exige `--rebase-contract` consciente — por desenho, mas é passo manual em toda subida de versão | P1 |
| DBT-14 | 67 arquivos ainda importam `@/api/base44Client` direto. A migração continua em P1.2–P1.4, protegida por `gate:api-boundary` | P1 |
| DBT-15 | `FormularioEmpresa` ainda usa `base44.integrations.Core.UploadFile` para o logotipo. Upload não é dado de módulo e ganha fronteira própria em slice posterior | P1 |
| DBT-16 | 3 arquivos legados (`loteRepository`, `entityDeleteGuards`, `offlineEntitySync`) acessam `entities` por nome dinâmico. Congelados no eixo `dynamicEntityFiles`; migram com seus módulos | P1 |
| DBT-18 | `gate:api-boundary` detecta o vazamento do provider por análise sintática direta. Um repasse em dois saltos (`const x = provider; export const y = x;`) escapa. A forma direta — que é a que aparece na prática e a que a auditoria encontrou — está fechada; fechar a indireta exige rastreio de alias dentro do arquivo | P1.4 |
| DBT-17 | `gate:no-secrets` varre `git ls-files`, então arquivo novo ainda não adicionado ao índice não é varrido: `verify:all` local dá verde e a CI reprova. Aconteceu de verdade na P1.1-R1. Mitigação atual é `git add` antes de `verify:all`; varrer também não-rastreados não-ignorados é mudança de contrato do gate, fica para slice própria | P1.4 |
| DBT-13 | `test:gates` leva ~42 s porque a catraca de tipos roda `tsc` de verdade em ~45 projetos temporários. É o preço de testar o gate real em vez do parser | P8 |
