# Estado Atual

**Atualizado em:** 2026-08-05 (P0.1 a P1.3 mergeadas · **P1.4 e P1.4-R1 implementadas na PR #6** · P1 tecnicamente fechada na branch, com baseline de fronteira zerado)

---

## Programa

**MAIKE Pecuária — Mapa Geral + Manejo.** Sistema nativo e escalável, com a
Base44 mantida apenas como provider temporário da cadeia preservada (D-PROD-04).

| Campo | Valor |
|---|---|
| Produto | Pecuária — Mapa Geral + Manejo (D-PROD-01) |
| Superfície primária | `MapaGeral` (D-PROD-05) |
| Missão atual | **P1 — Native Foundation Bootstrap**, slice **P1.4** (última) + correção **P1.4-R1** |
| Estado da missão | **P1.4 e P1.4-R1 implementadas na PR #6; aguardando merge do proprietário** — `npm run verify:all` sai com 0, 13/13 etapas |
| Próxima slice | P2 — ModeloBase1 Pecuário Foundation (não iniciada) |
| Branch | `claude/p1-4-native-api-boundary-support-admin` (PR #6, draft) |
| Escopo executável | `config/mapa-manejo-scope.json` |
| Roadmap | `docs/engineering/ROADMAP.md` |
| Molde arquitetural | PROJETOMG, parcial (D-PROD-03) |

**OWNER-SECURITY-01 continua aberto.** A PR #1 foi mergeada pelo proprietário em
2026-08-03 **sem** que a confirmação de rotação da chave do Google Maps tenha
sido registrada. O merge não muda a exposição: a chave antiga permanece no
histórico Git, agora também na `main`. Revogação, criação de chave nova,
restrição por HTTP referrer e por API (Maps JavaScript API e Geometry — a
Drawing Library saiu do loader na P1.2-R1 e não é mais necessária) e
armazenamento apenas em `.env.local` seguem pendentes com o proprietário — ver
`docs/engineering/P0.1-R1-CORRECTIVE-HARDENING-REPORT.md`.

## Progresso por missão

| Missão | Nome | Estado |
|---|---|---|
| P0 | Product Scope Reset | **mergeada** (PR #1, merge `508cf62`) |
| P1 | Native Foundation Bootstrap | **tecnicamente fechada na branch** — P1.1 a P1.3 mergeadas; P1.4 e P1.4-R1 implementadas na PR #6, aguardando merge do proprietário. Os seis eixos de `gate:api-boundary` estão em zero |
| P2 | ModeloBase1 Pecuário Foundation | não iniciada |
| P3 | Backend + Prisma + PostgreSQL Foundation | não iniciada |
| P4 | Mapa Core Native Persistence | não iniciada |
| P5 | Manejo Core Native Persistence | não iniciada |
| P6 | Supporting Capabilities | não iniciada |
| P7 | Base44 Final Removal | não iniciada |
| P8 | Hardening and Release | não iniciada |

## Inventário

Números medidos após `npm ci` e `npm run build` finais.

| Métrica | Antes da P0.1 | pós-P0.1 | pós-P1.1 | pós-P1.2 | pós-P1.3 | Depois da P1.4 |
|---|---|---|---|---|---|---|
| Páginas em `src/pages` | 102 | 16 | 16 | 16 | 16 | **16** |
| Arquivos em `src/` | 472 | 203 | 209 | 230 | 245 | **263** |
| Arquivos em `src/components` | 312 | 157 | 157 | 156 | 156 | **155** |
| Schemas em `base44/entities` | 87 | 38 | 38 | 38 | 38 | **38** |
| Functions em `base44/functions` | 11 | 1 | 1 | 1 | 1 | **1** |
| Dependências diretas (`dependencies`) | 63 | 31 | 31 | 31 | 31 | **31** |
| Dependências diretas (`devDependencies`) | 15 | 18 | 18 | 18 | 18 | **18** |
| Arquivos em `src/` com SDK/base44Client | 197 | 71 | 71 | 46 | 27 | **4** |
| Ocorrências de `base44.entities` | 1014 | 371 | 368 | 230 | 151 | **38** |
| Ocorrências de `base44.auth` | 29 | 16 | 16 | 14 | 14 | **10** |
| Ocorrências de `base44.integrations` | 24 | 6 | 6 | 5 | 4 | **1** |
| Ocorrências de `base44.functions` | 9 | 5 | 5 | 5 | 4 | **1** |
| Acoplamento Base44 fora de `src/` | 22 | 1 | 1 | 1 | 1 | **1** |
| Chaves Google Maps literais | 8 | 0 | 0 | 0 | 0 | **0** |
| Erros de lint | 64 | 0 | 0 | 0 | 0 | **0** |
| Diagnósticos `tsc` (cobertura total) | — | 2.802 | 2.797 | 2.759 | 2.728 | **2.319** (teto 2.319) |
| Testes automatizados | 0 | 183 | 377 | 478 | 625 | **817** (323 de gate + 494 de smoke) |
| Bundle de produção — JS | 4.347,45 kB | 2.461,36 kB | 2.464,58 kB | 2.474,37 kB | 2.482,90 kB | **2.496,61 kB** |
| Bundle de produção — CSS | 120,36 kB | 77,00 kB | 77,00 kB | 77,00 kB | 77,00 kB | **77,00 kB** |

As quatro ocorrências restantes de SDK/`base44Client` em `src/` são, todas,
**dentro da fronteira**: o client (`src/api/base44Client.js`), o adapter
autorizado (`src/apis/_providers/base44Provider.js`) e as duas referências que o
adapter faz a `base44.auth` e `base44.integrations`. Nenhuma página, componente,
hook, lib ou service acessa o provider.

Os artefatos do bundle vêm da CI do **último commit com mudanças executáveis**
desta PR — não de um build local nem de uma execução anterior.

Os artefatos da P1.4 vêm da CI do commit funcional desta PR — o run e o job
ficam registrados no corpo da PR #6, porque um commit não pode conter o
resultado da própria execução.

| Artefato | Tamanho | gzip |
|---|---|---|
| `dist/assets/index-CcAJh1Vu.js` | 2.496,61 kB | 668,91 kB |
| `dist/assets/index-DM5ihJ4E.css` | 77,00 kB | 13,31 kB |
| `dist/index.html` | 0,48 kB | 0,31 kB |

O hash do JS mudou porque a P1.4 alterou `src/`; o do CSS não mudou porque
nenhuma folha de estilo foi tocada. O bundle cresceu 13,71 kB (+0,55%) — os
quatro módulos de API novos, os onze services e os módulos de domínio custam
mais do que os acessos diretos que substituíram. Continua sem code splitting
(DBT-06).

Baselines mecânicos: `scripts/gates/base44-baseline.json` (schema 2) e
`scripts/gates/typecheck-baseline.json` (schema 3: contrato de configuração —
D-PROD-13 — e teto certificado monotônico — D-PROD-17).

## Fronteira de dados (P1.1, D-PROD-18)

| Eixo do `gate:api-boundary` | `main` pós-P0.1 | pós-P1.1 | pós-P1.2 | pós-P1.3 | Depois da P1.4 |
|---|---|---|---|---|---|
| arquivos que importam `@/api/base44Client` | 68 | 67 | 42 | 23 | **0** |
| arquivos que usam `base44.entities` | 64 | 63 | 38 | 20 | **0** |
| arquivos que usam `base44.auth` | 13 | 13 | 9 | 8 | **0** |
| arquivos que usam `base44.integrations` | 5 | 5 | 3 | 2 | **0** |
| arquivos que usam `base44.functions` | 5 | 5 | 5 | 3 | **0** |
| arquivos com acesso computado a `entities` | 3 | 3 | 3 | 2 | **0** |

Cada eixo é uma **lista de caminhos**, não um número: trocar um arquivo por
outro do mesmo tamanho reprova. Todos os eixos acima são subconjuntos estritos
do estado anterior — nenhum arquivo entrou.

Saíram de todos os eixos: `src/pages/Empresa.jsx` (P1.1) e, na P1.2,
`MapaGeral`, `MapaCadastro`, `useSetorAreas`, os 20 componentes de
`src/components/mapa/`, `manejoValidations` e o antigo `mapaOfflineCache`, que
foi removido e substituído por `src/services/mapaCacheService.js`.

O adapter autorizado `src/apis/_providers/base44Provider.js` não conta como
dívida — ele é a fronteira. Registry literal do provider após a P1.4: **38
entidades**, exatamente iguais a `allowedBase44Entities` do manifesto. A P1.4
acrescentou só `Marca` e `UnidadeMedida`, e apenas porque passaram a ter
consumidor migrado.

A P1.3 migrou os cadastros do manejo — lotes, setores, categorias, categorias de
manejo, bebedouros e anexos — e **removeu** os dois repositórios legados
(`loteRepository`, `bebedouroRepository`), sem shim.

A P1.4 migrou os 23 caminhos restantes — casca, autenticação, configurações,
produtos, marcas, unidades, locais de estoque, tarefas, usuários e suplementação
— e **removeu os três monkey patches globais** que o client instalava sobre o
SDK: normalização de texto, guardas de exclusão e runtime offline. Os arquivos
`src/lib/entityDeleteGuards.js` e `src/lib/offlineEntitySync.js` foram excluídos;
`historicoSuplementacaoUtils.jsx` virou `src/services/suplementacaoHistoricoService.js`.
Com isso os seis eixos ficaram em zero e o baseline versionado tem as seis
listas vazias: **qualquer reintrodução reprova**.

Não restam arquivos legados. A P1 está tecnicamente fechada na branch: a única
porta para a Base44 é `src/api/base44Client.js`, consumido só por
`src/apis/_providers/base44Provider.js`.

A **P1.4-R1** não migrou caminho nenhum — corrigiu quatro defeitos que a
contagem zerada escondia: o formato de erro do provider ainda atravessava três
camadas (agora `sessionApi` classifica uma vez e devolve `{ok, value}` /
`{ok, reason}`), o teto de tipos caiu porque a verificação do `Button` fora
desligada com `any` (agora o contrato é declarado de verdade), o rastro de falha
parcial do rename afirmava menos do que havia acontecido, e
`PRODUTO_PARTIAL_IMPORT` estava catalogado sem nenhum chamador. Ver
`docs/engineering/P1.4-NATIVE-API-BOUNDARY-SUPPORT-ADMIN-REPORT.md` §15.

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
| `48d6d66` | **commit funcional** da P1.2 | [30847666490](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30847666490) | **verde**, 13/13 |
| `98b966d` | **commit funcional** da P1.3 | [30868215796](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30868215796) | **verde**, 13/13 |
| `344accb` | **commit funcional** da P1.3-R1 | [31007455901](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31007455901) | **verde**, 13/13 |
| `c72f892` | **commit funcional** da P1.3-R2 | [31009031928](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31009031928) | **verde**, 13/13 |
| `dc7e022` | fechamento documental da P1.3 | [31012186549](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31012186549) | **verde**, 13/13 |
| P1.4 | **commit funcional** da P1.4 | CI registrada no corpo da PR #6 | — |
| P1.4-R1 | **commit funcional** da P1.4-R1 | CI registrada no corpo da PR #6 | — |

Um commit não pode conter o resultado da própria execução de CI. A execução do
commit funcional fica no corpo da PR aberta — PR #2 para a P1.1, PR #3 para a
P1.2, PR #5 para a P1.3 e PR #6 para a P1.4 e a P1.4-R1.

O run vermelho de `8866768` fica registrado em vez de omitido. A reprovação foi
legítima: o relatório da própria P1.1-R1 citava um par nome-de-chave mais
literal ao explicar um achado, e `gate:no-secrets` casa esse padrão em qualquer
arquivo versionado, prosa incluída. Corrigido em `9447884`; ver DBT-17 para o
motivo de o `verify:all` local não ter pego antes.

## Débito conhecido

| # | Item | Tratamento |
|---|---|---|
| DBT-01 | **Fechado na P1.4.** Nenhum componente, página, hook, lib ou service acessa `base44`. As 38 ocorrências de `base44.entities` que restam estão todas dentro do adapter autorizado, uma por entidade do registry | fechado |
| DBT-02 | `requiresAuth: false` em `src/api/base44Client.js` | P3 |
| DBT-03 | 2.319 diagnósticos de dívida de tipos versionados na catraca, com teto certificado de 2.319. A catraca impede crescimento em qualquer modo (D-PROD-17) e impede afrouxar a configuração (D-PROD-13). Trajetória: 2.802 → 2.759 (P1.2) → 2.728 (P1.3-R1) → 2.323 (P1.4, −405) → **2.319** (P1.4-R1, com o contrato de props do `Button` declarado de verdade, sem `any`). Redução segue em P2 | P2 |
| DBT-04 | Sem tela de **entrada** de estoque (D-PROD-08) | P6 |
| DBT-05 | Chave Google Maps antiga permanece no histórico Git — revogar e rotacionar (OWNER-SECURITY-01) | ação do proprietário |
| DBT-06 | Bundle único de ~2,50 MB, sem code splitting | P8 |
| DBT-07 | `LayoutCampo`/`LayoutSecao`/`LayoutConfiguracao` + `src/services/campoEngine.js` sustentam o formulário dinâmico de lote — um mini-motor de layout dentro do produto | P2 |
| DBT-08 | **Fechado na P1.4.** `src/lib/offlineEntitySync.js` foi removido. O runtime offline é provider-agnostic (`src/lib/offline/offlineEntityRuntime.js`) e o catálogo de entidades offline é montado literalmente pelo provider, uma chamada por entidade | fechado |
| DBT-09 | A numeração por `max + 1` lista a coleção inteira e não tem segurança de concorrência. Saiu das telas para os services na P1.4 (produtos, marcas, unidades, locais), o que torna a regra testável — mas duas criações simultâneas ainda podem receber o mesmo número. Fecha com o backend próprio | P3 |
| DBT-10 | **Fechado na P1.4.** `eslint.config.js` cobre `src/**`, `scripts/**` e `tests/**` inteiros, com globais por ambiente (browser, Node, Vitest/JSDOM). Sem `ignores` de diretório, sem regra desligada em massa e sem `eslint-disable` espalhado | fechado |
| DBT-11 | `npm audit` reporta vulnerabilidades nas dependências transitivas remanescentes | P8 |
| DBT-12 | `gate:types` fixa `typescriptVersion` no baseline. Atualizar o TypeScript exige `--rebase-contract` consciente — por desenho, mas é passo manual em toda subida de versão | P1 |
| DBT-14 | **Fechado na P1.4.** Zero arquivos importam `@/api/base44Client` fora do adapter. O baseline de `gate:api-boundary` tem as seis listas vazias, então qualquer reintrodução reprova | fechado |
| DBT-15 | **Fechado na P1.4.** As três telas que subiam arquivo (logotipo da empresa, ícone e sub-ícone) passam por `src/services/arquivoService.js` sobre `src/apis/arquivos/`. Upload sem `file_url` de volta virou falha explícita, em vez de gravar `undefined` no campo | fechado |
| DBT-16 | **Fechado na P1.4.** Os dois arquivos foram removidos. Nenhum acesso computado a `entities` sobrou: o eixo `dynamicEntityFiles` está vazio no baseline | fechado |
| DBT-18 | **Fechado na P1.4 para o repasse por argumento.** O gate reprova entregar o provider — ou um método cru dele — como argumento de qualquer chamada, que era o caminho pelo qual a capacidade cruzava para outro arquivo. Passar o **resultado** de uma chamada continua permitido, e há controle positivo (P14-N7). Continua fora do alcance a análise semântica de wrapper que só se resolve com dataflow entre módulos — mas sem argumento nem export, a capacidade não tem por onde sair | parcial · P3 |
| DBT-17 | **Fechado na P1.4.** `gate:no-secrets` varre rastreados **e** não rastreados não ignorados, deduplicados. Arquivo novo com segredo reprova antes do `git add`; `.env.local` ignorado continua fora da varredura, que é onde o segredo deve ficar | fechado |
| DBT-19 | Operação composta de manejo não é atômica: a Base44 não oferece transação multi-entidade. A P1.2 tornou a falha parcial **visível** (`MAPA_PARTIAL_OPERATION` com etapa concluída e etapa de falha), não a eliminou; a P1.4-R1 tornou o rastro do rename de local **fiel** — cada etapa é registrada quando conclui, com contagem por cocho. Some com o backend próprio | P3 |
| DBT-20 | `DetalhesLote.jsx` segue com ~1.300 linhas. A fronteira de dados fechou na P1.2 e as decisões puras saíram para `src/domain/lotes/`, mas o componente continua grande demais para revisão confortável | P5 |
| DBT-21 | A chave `VITE_GOOGLE_MAPS_API_KEY` vai para o bundle do cliente por definição do Vite. Não é defeito e não tem correção no código: a proteção é restrição por referrer e por API no Google Cloud, mais rotação e monitoramento (P1.2-R1) | ação do proprietário |
| DBT-22 | O sintoma `MAPS_CONFIG_MISSING` em produção não teve causa raiz confirmada. A leitura de env funcionava antes e depois da P1.2-R1 (medido em build real); a explicação compatível com a evidência é ausência da variável no serviço que executa `npm run build`, o que exige inspeção da plataforma de deploy | ação do proprietário |
| DBT-23 | O produto não tem backend nativo neste repositório: é frontend Vite consumindo `@base44/sdk`. Um serviço externo no Railway não é automaticamente o backend do frontend — integrar exige contrato de endpoints, autenticação e CORS. `VITE_BASE44_BACKEND_URL` pertence ao SDK da Base44 e não deve ser apontada para outro destino | P3 |
| DBT-24 | Validação de layout real depende de inspeção visual em produção. Os testes de shell provam estrutura e comportamento em JSDOM, que não calcula layout. Playwright não foi adotado | P8 |
| DBT-25 | **Fechado na P1.4.** `src/domain/numeroPtBR.js` lê vírgula e ponto: `'12,5'` → 12,5, `'1.234,56'` → 1234,56, campo em branco → `null` em vez de `NaN`. Aplicado no cadastro de setor e nos payloads de produto e CSV; o teste S3b foi invertido para fixar a leitura correta | fechado |
| DBT-26 | `numero_lote` e `numero_setor` usam `max + 1` calculado no cliente, sem segurança de concorrência. Só sequência no servidor resolve | P4 |
| DBT-13 | `test:gates` leva ~42 s porque a catraca de tipos roda `tsc` de verdade em ~45 projetos temporários. É o preço de testar o gate real em vez do parser | P8 |
