# Estado Atual

**Atualizado em:** 2026-08-03 (P0.1 mergeada · P1 em andamento · P1.1 em implementação)

---

## Programa

**MAIKE Pecuária — Mapa Geral + Manejo.** Sistema nativo e escalável, com a
Base44 mantida apenas como provider temporário da cadeia preservada (D-PROD-04).

| Campo | Valor |
|---|---|
| Produto | Pecuária — Mapa Geral + Manejo (D-PROD-01) |
| Superfície primária | `MapaGeral` (D-PROD-05) |
| Missão atual | **P1 — Native Foundation Bootstrap**, slice **P1.1** |
| Estado da missão | **P1.1 em implementação** — certificada só depois da CI verde no HEAD final |
| Próxima slice | P1.2 — Mapa |
| Branch | `claude/p1-1-native-api-boundary-empresa` (PR nova, draft) |
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
| P1 | Native Foundation Bootstrap | **em andamento** — P1.1 entregue, P1.2 a P1.4 não iniciadas |
| P2 | ModeloBase1 Pecuário Foundation | não iniciada |
| P3 | Backend + Prisma + PostgreSQL Foundation | não iniciada |
| P4 | Mapa Core Native Persistence | não iniciada |
| P5 | Manejo Core Native Persistence | não iniciada |
| P6 | Supporting Capabilities | não iniciada |
| P7 | Base44 Final Removal | não iniciada |
| P8 | Hardening and Release | não iniciada |

## Inventário

Números medidos após `npm ci` e `npm run build` finais.

| Métrica | `main` (pós-merge P0.1) | Depois da P1.1 |
|---|---|---|
| Páginas em `src/pages` | 102 | **16** |
| Arquivos em `src/` | 203 | **209** |
| Arquivos em `src/components` | 312 | **157** |
| Schemas em `base44/entities` | 87 | **38** |
| Functions em `base44/functions` | 11 | **1** |
| Dependências diretas (`dependencies`) | 63 | **31** |
| Dependências diretas (`devDependencies`) | 15 | **18** |
| Arquivos em `src/` com SDK/base44Client | 197 | **71** |
| Ocorrências de `base44.entities` | 371 | **368** |
| Ocorrências de `base44.auth` | 29 | **16** |
| Ocorrências de `base44.integrations` | 24 | **6** |
| Ocorrências de `base44.functions` | 9 | **5** |
| Acoplamento Base44 fora de `src/` | 22 | **1** |
| Chaves Google Maps literais | 8 | **0** |
| Erros de lint | 64 | **0** |
| Diagnósticos `tsc` (cobertura total) | 2.802 | **2.797** (teto certificado 2.797) |
| Testes automatizados | 183 | **255** (185 de gate + 70 de smoke) |
| Bundle de produção — JS | 4.347,45 kB | **2.461,36 kB** |
| Bundle de produção — CSS | 120,36 kB | **77,00 kB** |

Os números do bundle são os da **CI**, não de um build local: run
[30576628418](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30576628418),
etapa `build` do HEAD funcional `eb94fa8`.

| Artefato | Tamanho | gzip |
|---|---|---|
| `dist/assets/index-CAtW8f23.js` | 2.461,36 kB | 657,62 kB |
| `dist/assets/index-DM5ihJ4E.css` | 77,00 kB | 13,31 kB |

Baselines mecânicos: `scripts/gates/base44-baseline.json` (schema 2) e
`scripts/gates/typecheck-baseline.json` (schema 3: contrato de configuração —
D-PROD-13 — e teto certificado monotônico — D-PROD-17).

## Fronteira de dados (P1.1, D-PROD-18)

| Eixo do `gate:api-boundary` | `main` | Depois da P1.1 |
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

A execução do HEAD final da P1.1 é registrada no corpo da PR desta slice — um
commit não pode conter o resultado da própria execução. A última execução verde
da P0.1 foi o run `30578175907` (`7cb0fe3`), antes do merge.

## Débito conhecido

| # | Item | Tratamento |
|---|---|---|
| DBT-01 | Componentes acessam `base44` direto. A camada `src/apis/` existe desde a P1.1, com Empresa migrada; restam 368 chamadas `base44.entities` fora dela | P1 |
| DBT-02 | `requiresAuth: false` em `src/api/base44Client.js` | P3 |
| DBT-03 | 2.802 diagnósticos de dívida de tipos versionados na catraca, com teto certificado de 2.802. `gate:types` impede crescer em qualquer modo (D-PROD-17) e impede afrouxar a configuração (D-PROD-13). P1 deve reduzir | P1 |
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
| DBT-13 | `test:gates` leva ~42 s porque a catraca de tipos roda `tsc` de verdade em ~45 projetos temporários. É o preço de testar o gate real em vez do parser | P8 |
