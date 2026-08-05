# Estado Atual

**Atualizado em:** 2026-08-04 (P0.1, P1.1 e P1.2 mergeadas · P1 em andamento · P1.3 implementada e corrigida na PR #5)

---

## Programa

**MAIKE Pecuária — Mapa Geral + Manejo.** Sistema nativo e escalável, com a
Base44 mantida apenas como provider temporário da cadeia preservada (D-PROD-04).

| Campo | Valor |
|---|---|
| Produto | Pecuária — Mapa Geral + Manejo (D-PROD-01) |
| Superfície primária | `MapaGeral` (D-PROD-05) |
| Missão atual | **P1 — Native Foundation Bootstrap**, slice **P1.3** |
| Estado da missão | **P1.3 implementada e corrigida na PR #5; aguardando merge do proprietário** — `npm run verify:all` sai com 0, 13/13 etapas |
| Próxima slice | P1.4 — telas legadas restantes |
| Branch | `claude/p1-3-native-api-boundary-manejo` (PR #5, draft) |
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
| P1 | Native Foundation Bootstrap | **em andamento** — P1.1, P1.2 e as correções P1.2-R1/R2 mergeadas; P1.3 e P1.3-R1 na PR #5, aguardando merge; P1.4 não iniciada |
| P2 | ModeloBase1 Pecuário Foundation | não iniciada |
| P3 | Backend + Prisma + PostgreSQL Foundation | não iniciada |
| P4 | Mapa Core Native Persistence | não iniciada |
| P5 | Manejo Core Native Persistence | não iniciada |
| P6 | Supporting Capabilities | não iniciada |
| P7 | Base44 Final Removal | não iniciada |
| P8 | Hardening and Release | não iniciada |

## Inventário

Números medidos após `npm ci` e `npm run build` finais.

| Métrica | Antes da P0.1 | pós-P0.1 | pós-P1.1 | pós-P1.2 | Depois da P1.3 |
|---|---|---|---|---|---|
| Páginas em `src/pages` | 102 | 16 | 16 | 16 | **16** |
| Arquivos em `src/` | 472 | 203 | 209 | 230 | **245** |
| Arquivos em `src/components` | 312 | 157 | 157 | 156 | **156** |
| Schemas em `base44/entities` | 87 | 38 | 38 | 38 | **38** |
| Functions em `base44/functions` | 11 | 1 | 1 | 1 | **1** |
| Dependências diretas (`dependencies`) | 63 | 31 | 31 | 31 | **31** |
| Dependências diretas (`devDependencies`) | 15 | 18 | 18 | 18 | **18** |
| Arquivos em `src/` com SDK/base44Client | 197 | 71 | 71 | 46 | **27** |
| Ocorrências de `base44.entities` | 1014 | 371 | 368 | 230 | **152** |
| Ocorrências de `base44.auth` | 29 | 16 | 16 | 14 | **14** |
| Ocorrências de `base44.integrations` | 24 | 6 | 6 | 5 | **4** |
| Ocorrências de `base44.functions` | 9 | 5 | 5 | 5 | **4** |
| Acoplamento Base44 fora de `src/` | 22 | 1 | 1 | 1 | **1** |
| Chaves Google Maps literais | 8 | 0 | 0 | 0 | **0** |
| Erros de lint | 64 | 0 | 0 | 0 | **0** |
| Diagnósticos `tsc` (cobertura total) | — | 2.802 | 2.797 | 2.759 | **2.728** (teto 2.728) |
| Testes automatizados | 0 | 183 | 377 | 478 | **624** (307 de gate + 317 de smoke) |
| Bundle de produção — JS | 4.347,45 kB | 2.461,36 kB | 2.464,58 kB | 2.474,37 kB | **2.482,90 kB** |
| Bundle de produção — CSS | 120,36 kB | 77,00 kB | 77,00 kB | 77,00 kB | **77,00 kB** |

Os artefatos do bundle vêm da CI do **último commit com mudanças executáveis**
desta PR — não de um build local nem de uma execução anterior.

Artefatos medidos no run [30847666490](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30847666490)
(commit `48d6d66`, funcional da P1.2), etapa `build`:

| Artefato | Tamanho | gzip |
|---|---|---|
| `dist/assets/index-B4todyOY.js` | 2.474,37 kB | 662,42 kB |
| `dist/assets/index-DM5ihJ4E.css` | 77,00 kB | 13,31 kB |
| `dist/index.html` | 0,48 kB | 0,31 kB |

O hash do JS mudou em relação à P1.1 (`index-zrBH5BbN.js`) porque a P1.2 alterou
`src/`; o do CSS não mudou porque nenhuma folha de estilo foi tocada. O bundle
cresceu 9,79 kB (+0,4%) — a camada de API, os services e os módulos de domínio
custam mais do que os acessos diretos que substituíram.

Baselines mecânicos: `scripts/gates/base44-baseline.json` (schema 2) e
`scripts/gates/typecheck-baseline.json` (schema 3: contrato de configuração —
D-PROD-13 — e teto certificado monotônico — D-PROD-17).

## Fronteira de dados (P1.1, D-PROD-18)

| Eixo do `gate:api-boundary` | `main` pós-P0.1 | pós-P1.1 | pós-P1.2 | Depois da P1.3 |
|---|---|---|---|---|
| arquivos que importam `@/api/base44Client` | 68 | 67 | 42 | **23** |
| arquivos que usam `base44.entities` | 64 | 63 | 38 | **20** |
| arquivos que usam `base44.auth` | 13 | 13 | 9 | **8** |
| arquivos que usam `base44.integrations` | 5 | 5 | 3 | **2** |
| arquivos que usam `base44.functions` | 5 | 5 | 5 | **3** |
| arquivos com acesso computado a `entities` | 3 | 3 | 3 | **2** |

Cada eixo é uma **lista de caminhos**, não um número: trocar um arquivo por
outro do mesmo tamanho reprova. Todos os eixos acima são subconjuntos estritos
do estado anterior — nenhum arquivo entrou.

Saíram de todos os eixos: `src/pages/Empresa.jsx` (P1.1) e, na P1.2,
`MapaGeral`, `MapaCadastro`, `useSetorAreas`, os 20 componentes de
`src/components/mapa/`, `manejoValidations` e o antigo `mapaOfflineCache`, que
foi removido e substituído por `src/services/mapaCacheService.js`.

O adapter autorizado `src/apis/_providers/base44Provider.js` não conta como
dívida — ele é a fronteira. Registry literal do provider após a P1.2: 26
entidades (`Empresa` e as 25 do mapa e do manejo iniciado por ele).

A P1.3 migrou os cadastros do manejo — lotes, setores, categorias, categorias de
manejo, bebedouros e anexos — e **removeu** os dois repositórios legados
(`loteRepository`, `bebedouroRepository`), sem shim.

Os 23 arquivos restantes são telas fora do escopo do manejo — produto, unidade,
marca, usuário, grupos de atividade, tipos de tarefa, locais de estoque,
configurações — mais `Layout.jsx` e `AuthContext`. Entram na P1.4.

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
| `9447884` | correção do relatório da P1.1-R1 | [30815727984](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30815727984) | **verde**, 13/13 |
| `4acd1d4` | **commit funcional** da P1.1-R2 | [30818797942](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30818797942) | **verde**, 13/13 |
| `5946809` | **commit funcional** da P1.1-R3 | [30836332701](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30836332701) | **verde**, 13/13 |
| `6d88794` | certificação de estado da P1.1-R3 | [30836737386](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30836737386) | **verde**, 13/13 |
| `9767545` | **commit funcional** da P1.1-R4 | [30841392611](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30841392611) | **verde**, 13/13 — origem dos artefatos |
| `48d6d66` | **commit funcional** da P1.2 | [30847666490](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30847666490) | **verde**, 13/13 — origem dos artefatos |
| HEAD atual | só esta certificação de estado | ver corpo da PR #3 | — |

Um commit não pode conter o resultado da própria execução de CI. A execução do
commit documental que sucede o último commit executável fica no corpo da PR
aberta — PR #2 para a P1.1, PR #3 para a P1.2.

O run vermelho de `8866768` fica registrado em vez de omitido. A reprovação foi
legítima: o relatório da própria P1.1-R1 citava um par nome-de-chave mais
literal ao explicar um achado, e `gate:no-secrets` casa esse padrão em qualquer
arquivo versionado, prosa incluída. Corrigido em `9447884`; ver DBT-17 para o
motivo de o `verify:all` local não ter pego antes.

## Débito conhecido

| # | Item | Tratamento |
|---|---|---|
| DBT-01 | Componentes acessam `base44` direto. A camada `src/apis/` existe desde a P1.1; Empresa (P1.1), Mapa (P1.2) e os cadastros do manejo (P1.3) já migraram. Restam 152 chamadas `base44.entities` fora dela | P1 |
| DBT-02 | `requiresAuth: false` em `src/api/base44Client.js` | P3 |
| DBT-03 | 2.759 diagnósticos de dívida de tipos versionados na catraca, com teto certificado de 2.759. `gate:types` impede crescer em qualquer modo (D-PROD-17) e impede afrouxar a configuração (D-PROD-13). P1 deve reduzir | P1 |
| DBT-04 | Sem tela de **entrada** de estoque (D-PROD-08) | P6 |
| DBT-05 | Chave Google Maps antiga permanece no histórico Git — revogar e rotacionar (OWNER-SECURITY-01) | ação do proprietário |
| DBT-06 | Bundle único de ~2,46 MB, sem code splitting | P8 |
| DBT-07 | `LayoutCampo`/`LayoutSecao`/`LayoutConfiguracao` + `src/services/campoEngine.js` sustentam o formulário dinâmico de lote — um mini-motor de layout dentro do produto | P2 |
| DBT-08 | `src/lib/offlineEntitySync.js` mantém lista própria de entidades. O par desalinhado foi desfeito na P1.2: `mapaOfflineCache.jsx` foi removido e o cache do mapa passou a declarar as 18 capacidades explicitamente em `src/services/mapaCacheService.js` | P1 |
| DBT-09 | `getNextSystemNumber` em `src/pages/Produtos.jsx` lista a coleção inteira para calcular o próximo número | P6 |
| DBT-10 | `eslint.config.js` cobre `src/components`, `src/pages`, `src/Layout.jsx` e, desde a P1.1, `src/apis/`, `src/config/` e `src/services/empresaService.js`. `src/lib`, `src/api`, o restante de `src/services` e `scripts/` seguem fora — fechamento em P1.4 | P1 |
| DBT-11 | `npm audit` reporta vulnerabilidades nas dependências transitivas remanescentes | P8 |
| DBT-12 | `gate:types` fixa `typescriptVersion` no baseline. Atualizar o TypeScript exige `--rebase-contract` consciente — por desenho, mas é passo manual em toda subida de versão | P1 |
| DBT-14 | 23 arquivos ainda importam `@/api/base44Client` direto — todos fora do escopo do manejo. A migração termina na P1.4, protegida por `gate:api-boundary` | P1 |
| DBT-15 | `FormularioEmpresa` ainda usa `base44.integrations.Core.UploadFile` para o logotipo. Upload não é dado de módulo e ganha fronteira própria em slice posterior | P1 |
| DBT-16 | 2 arquivos legados (`entityDeleteGuards`, `offlineEntitySync`) acessam `entities` por nome dinâmico. `loteRepository` saiu na P1.3, com catálogo fechado de fontes de opção. Congelados no eixo `dynamicEntityFiles`; migram com seus módulos | P1 |
| DBT-18 | `gate:api-boundary` fecha proveniência **local ao arquivo** para os bindings e expressões cobertos: origem, membro, contêiner, função, alias, `.bind()`, ternário, curto-circuito e `return` em bloco (P1.1-R4). Continua fora do alcance o repasse **interprocedural** — capacidade passada por parâmetro para função de outro arquivo, ou wrapper cujo comportamento exige análise semântica entre módulos. Fechar isso exige dataflow repo-wide | P1.4 |
| DBT-17 | `gate:no-secrets` varre `git ls-files`, então arquivo novo ainda não adicionado ao índice não é varrido: `verify:all` local dá verde e a CI reprova. Aconteceu de verdade na P1.1-R1. Mitigação atual é `git add` antes de `verify:all`; varrer também não-rastreados não-ignorados é mudança de contrato do gate, fica para slice própria | P1.4 |
| DBT-19 | Operação composta de manejo não é atômica: a Base44 não oferece transação multi-entidade. A P1.2 tornou a falha parcial **visível** (`MAPA_PARTIAL_OPERATION` com etapa concluída e etapa de falha), não a eliminou. Some com o backend próprio | P3 |
| DBT-20 | `DetalhesLote.jsx` segue com ~1.300 linhas. A fronteira de dados fechou na P1.2 e as decisões puras saíram para `src/domain/lotes/`, mas o componente continua grande demais para revisão confortável | P5 |
| DBT-21 | A chave `VITE_GOOGLE_MAPS_API_KEY` vai para o bundle do cliente por definição do Vite. Não é defeito e não tem correção no código: a proteção é restrição por referrer e por API no Google Cloud, mais rotação e monitoramento (P1.2-R1) | ação do proprietário |
| DBT-22 | O sintoma `MAPS_CONFIG_MISSING` em produção não teve causa raiz confirmada. A leitura de env funcionava antes e depois da P1.2-R1 (medido em build real); a explicação compatível com a evidência é ausência da variável no serviço que executa `npm run build`, o que exige inspeção da plataforma de deploy | ação do proprietário |
| DBT-23 | O produto não tem backend nativo neste repositório: é frontend Vite consumindo `@base44/sdk`. Um serviço externo no Railway não é automaticamente o backend do frontend — integrar exige contrato de endpoints, autenticação e CORS. `VITE_BASE44_BACKEND_URL` pertence ao SDK da Base44 e não deve ser apontada para outro destino | P3 |
| DBT-24 | Validação de layout real depende de inspeção visual em produção. Os testes de shell provam estrutura e comportamento em JSDOM, que não calcula layout. Playwright não foi adotado | P8 |
| DBT-25 | `parseFloat` no cadastro de setor não entende vírgula decimal: `'12,5'` vira `12` em silêncio. Comportamento herdado, preservado na P1.3 porque corrigi-lo mudaria o dado gravado — fixado no teste S3b | P1.4 |
| DBT-26 | `numero_lote` e `numero_setor` usam `max + 1` calculado no cliente, sem segurança de concorrência. Só sequência no servidor resolve | P4 |
| DBT-13 | `test:gates` leva ~42 s porque a catraca de tipos roda `tsc` de verdade em ~45 projetos temporários. É o preço de testar o gate real em vez do parser | P8 |
