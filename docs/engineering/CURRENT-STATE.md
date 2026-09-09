# Estado Atual

**Atualizado em:** 2026-09-08 (**P0, P1, P2, P3 e a fatia P4.0 mergeadas** — o navegador já autentica contra o backend próprio · **P4 em execução**, com a **P4.1 (Setor) não iniciada**)

---

## Programa

**MAIKE Pecuária — Mapa Geral + Manejo.** Sistema nativo e escalável, com a
Base44 mantida apenas como provider temporário da cadeia preservada (D-PROD-04).

| Campo | Valor |
|---|---|
| Produto | Pecuária — Mapa Geral + Manejo (D-PROD-01) |
| Superfície primária | `MapaGeral` (D-PROD-05) |
| Missão em execução | **P4 — Mapa Core Native Persistence** — fatia **P4.0** concluída; nenhuma fatia em implementação |
| Última mergeada | **P4.0 — Native Transport + Session Activation (PR #12, merge `45599f5`)** — inclui a correção **P4.0-R1**; implementação certificada em `f01201b`, com `npm run verify:all` em 19/19 e exit 0 |
| Mergeadas anteriores | P3 — Backend + Prisma + PostgreSQL Foundation (PR #10, merge `4ce4608`), com a P3-R1; P2 — ModeloBase1 Pecuário Foundation (PR #7, merge `1851503`); SSOT sincronizada nas PRs #8 (`378bfd3`) e #11 (`672ea99`); emenda D-PROD-22 na PR #9 (merge `44b204c`) |
| Próxima fatia autorizável | P4.1 — Setor Native Persistence — **não iniciada** |
| Contrato de dados | `config/modelobase1-pecuario.json` — **oficial**; obrigatório para P3–P6 |
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
| P1 | Native Foundation Bootstrap | **concluída e mergeada** — P1.1 a P1.3 em PRs anteriores; P1.4 e P1.4-R1 na PR #6, merge `7398d85`. Os seis eixos de `gate:api-boundary` estão em zero |
| P2 | ModeloBase1 Pecuário Foundation | **mergeada** (PR #7, merge `1851503`) — inclui a correção P2-R1 |
| P3 | Backend + Prisma + PostgreSQL Foundation | **concluída e mergeada** (PR #10, merge `4ce4608`) — `backend/` com Fastify, Prisma e PostgreSQL; cinco models; `gate:tenancy` e `gate:indices`. Inclui a correção **P3-R1** |
| P4 | Mapa Core Native Persistence | **em execução** — **P4.0** (transporte e sessão nativos) **concluída e mergeada** (PR #12, merge `45599f5`), inclui a **P4.0-R1**; **P4.1** (Setor) e **P4.2** (AreaPastagem) não iniciadas |
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

**Depois da P2**, todos os números acima permanecem idênticos: a missão não
tocou em `src/`, `base44/`, `vite.config.js` nem no manifesto de escopo. Só duas
métricas mudaram, e as duas por acréscimo de verificação:

| Métrica | Depois da P1.4 | Depois da P2 | Depois da P3-R1 | Depois da P4.0 |
|---|---|---|---|---|
| Testes automatizados | 817 (323 gate + 494 smoke) | 862 (368 gate + 494 smoke) | 964 (428 gate + 495 smoke + 41 backend) | **1.046** (452 gate + 534 smoke + 60 backend) |
| Etapas do `verify:all` | 13 | 14 | 18 | **19** |
| Dependências diretas | 49 | 49 | 55 | **56** (38 `dependencies` + 18 `devDependencies`) |
| Bundle de produção — JS | 2.496,61 kB | 2.496,61 kB | 2.496,62 kB | **2.504,83 kB** |
| Dívida de tipos em `src/` | 2.319 | 2.319 | 2.319 (teto 2.319) | **2.318** (teto 2.318) |

A diferença de 0,01 kB na linha do bundle é arredondamento entre ambientes de
medição — as colunas P1.4 e P2 vêm da CI, as colunas P3 vêm de build local
reproduzível. O artefato é o mesmo: base `44b204c` e HEAD da P3-R1 produzem o
**mesmo hash de chunk** (`index-nzvr8O-2.js`) quando construídos com
`NODE_ENV=production`.

**A primeira versão da P3 tinha, sim, uma regressão de bundle na CI** — 3.555,01
kB —, e ela não era do backend: eu havia definido `NODE_ENV: test` no `env:` do
job do workflow, o que alcançava o `npm run build` e fazia o Vite empacotar as
bibliotecas em modo de desenvolvimento. A inflação reproduz igual no commit base,
onde backend não existe. Corrigido na P3-R1 em duas pontas — `NODE_ENV` saiu do
workflow e `verify:all` fixa `production` no passo de build —, com cinco casos
travando as duas. Ver §16.3 do relatório da P3.

Os 45 testes novos são MB1-01 a MB1-20 com sub-casos, todos executando o gate
real em diretórios temporários. Oito deles vieram da **P2-R1**, que fechou três
invariantes que o contrato declarava e o gate não protegia: `headers` e `cookie`
nas fontes proibidas de tenant, `headers` nas fontes proibidas do ator de
auditoria, e o escopo `empresa` da numeração. O contrato JSON e o documento
arquitetural não mudaram — o defeito estava só no verificador. Ver §14 do
relatório da P2.

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

## Contrato base pecuário (P2, D-PROD-21)

A P2 não migrou caminho nenhum, não criou backend e não tocou em `src/`. Ela
transformou identidade, tenancy, timestamps, auditoria, numeração, anexos,
exclusão, concorrência e vocabulário de erro em **contrato versionado e
verificável**, para que a P3 implemente Prisma contra um acordo escrito em vez de
decidir cada regra sob pressão de migration.

| Artefato | Caminho |
|---|---|
| SSOT executável | `config/modelobase1-pecuario.json` |
| Documento legível | `docs/architecture/MODELOBASE1-PECUARIO-CONTRACT.md` |
| Gate | `scripts/gates/gate-modelobase1-pecuario.mjs` |
| Testes | `scripts/tests/gates/modelobase1-pecuario.test.mjs` |
| Relatório | `docs/engineering/P2-MODELOBASE1-PECUARIO-FOUNDATION-REPORT.md` |

O nome vem do PROJETOMG; o significado, não. Lá `ModeloBase1` é o motor visual
de cadastro. Aqui é contrato de dados — não é template visual, não cria runtime
genérico, não cria low-code e não substitui as telas atuais (D-PROD-21).

O gate é **absoluto**: sem `--update`, sem baseline, sem correção automática e
sem escrita no arquivo, nem quando o contrato está inválido. Onze códigos
`P2-MB1-*`, 11 seções obrigatórias, 8 códigos de erro mínimos e 10 padrões
proibidos.

O contrato só seria **oficial** depois do merge humano da PR, e o merge
aconteceu: PR #7, merge `1851503`, 2026-08-28. **O contrato está oficial e
vigente** — é obrigatório para P3, P4, P5 e P6, e nenhuma migration de domínio
pode divergir dele.

A P2 incluiu a correção **P2-R1**, que fechou três invariantes declaradas no
contrato e não protegidas pelo gate: as fontes proibidas de tenant passaram de
três para as cinco do SSOT (`body`, `query`, `params`, `headers`, `cookie`), o
ator de auditoria ficou com as quatro que o SSOT declara, e o escopo `empresa`
da numeração passou a ser exigido junto com `tenant`. Cada uma ganhou prova
negativa executando o gate real — ver §14 do relatório da P2.

## Backend nativo (P3, D-PROD-23)

Pela primeira vez o repositório tem backend próprio. `backend/` existe, com
Fastify, Prisma e PostgreSQL, na camada `route → service → repository → Prisma`.

| Item | Valor |
|---|---|
| Models | 5 — `Cliente`, `Usuario`, `AuditLog`, `EntidadeCodigoSequencia`, `RegistroAnexo` |
| Migration | `backend/prisma/migrations/20260908174141_p3_foundation/` |
| Banco local | Docker Compose, `postgres:16.13-alpine`, versão fixada |
| Banco na CI | serviço efêmero do GitHub Actions, mesma versão, `DATABASE_URL` do job |
| Sessão | JWT via `@fastify/jwt`; senha em hash bcrypt |
| Gates novos | `gate:tenancy`, `gate:indices` — absolutos, sem baseline |
| Typecheck próprio | `npm run typecheck:backend` — `jsconfig.backend.typecheck.json`, tolerância zero, sem baseline |
| Testes | 55 de gate (38 tenancy + 17 indices) e 41 de backend contra PostgreSQL real |

**Nenhum model de domínio foi criado.** Mapa e manejo ficam para P4–P6, uma
capacidade por vez. **À época da P3** o backend ainda não era consumido pelo
frontend: `src/` não foi tocado, e a fronteira da P1 continuava apontando
inteiramente para o provider Base44. A **P4.0** mudou isso para a autenticação —
ver a seção abaixo; o domínio geográfico segue na Base44 até a P4.1.

Duas invariantes do contrato que só o banco prova, e que aqui estão provadas:
40 reservas concorrentes de sequência sem número duplicado (BE-17), e auditoria
dentro de transação revertida que não sobrevive ao rollback (BE-25).

**Duas correções que os testes obrigaram**, ambas de defeito real e não de
fixture. O Fastify vem com `removeAdditional` ligado: um `cliente_id` enviado no
corpo do login era **descartado em silêncio**, não recusado — numa superfície de
tenancy, silêncio é pior que erro, e agora vira 400. E o handler de erro
normalizava qualquer exceção do framework em `INTERNAL_ERROR`, de modo que
requisição malformada devolvia **500** em vez de 400 — o servidor se culpando
por erro do cliente.

### P3-R1 — fechamento corretivo

A auditoria da P3 apontou cinco bloqueios, todos corrigidos na mesma branch e na
mesma PR. Três deles eram **invariante declarada e não verificada** — a mesma
classe da P2-R1:

| # | Defeito | Correção |
|---|---|---|
| B1 | O repositório da sequência criava a linha por `INSERT` cru com `gen_random_uuid()`, contornando o `@default(cuid())` que o schema declarava | `createMany({ skipDuplicates: true })`, que compila para `ON CONFLICT DO NOTHING` e preserva a idempotência. Prova negativa: `P3-TEN-RUNTIME-IDENTITY` |
| B2 | `AuditLog → Usuario` referenciava só o `id`: auditoria do cliente A podia apontar para usuário do cliente B | FK **composta** `[cliente_id, usuario_id] → [cliente_id, id]`, com `@@unique([cliente_id, id])` em `Usuario`. Migration regerada. O PostgreSQL recusa A×B (R1-T06) e o evento de sistema com `usuario_id` nulo continua válido por `MATCH SIMPLE` (R1-T07) |
| B3 | Bundle inflado na CI, ~1 MB acima do patamar | Não era do backend: era `NODE_ENV: test` no `env:` do job, que alcançava o `npm run build`. Ver acima |
| B4 | `backend/` sem cobertura de tipos — lacuna declarada na P3 | `jsconfig.backend.typecheck.json` e `typecheck:backend`, tolerância zero. Os 10 diagnósticos reais foram corrigidos no código, com module augmentation do Fastify — sem `any`, sem `@ts-ignore` |
| B5 | `prisma validate` existia como script e não rodava na cadeia | Passou a ser obrigatório, antes de `generate` e `migrate deploy` |

O isolamento por tenant passou a ser provado pelo caminho **service → repository**
(R1-T09), e não por um `WHERE` escrito dentro do teste — que provaria o `WHERE`,
não a aplicação.

Um detalhe vale registro porque a lição não é óbvia: a primeira versão da regra
de identidade em runtime era um `grep` por `randomUUID` e **reprovou o próprio
repositório** — `requestContext.js` usa `randomUUID()` para o id de correlação da
requisição, que é uso legítimo. A regra foi reescrita para casar só na **posição
de identidade**, e TEN-27 existe como controle positivo para impedir que alguém a
alargue de volta para um scanner textual ingênuo.

## Transporte e sessão nativos (P4.0, D-PROD-24)

Pela primeira vez o navegador fala com o backend próprio. A P4.0 não migrou
capacidade nenhuma — ela construiu a estrada que a P4.1 vai usar.

| Item | Valor |
|---|---|
| URL do backend | `VITE_MAIKE_API_URL` — pública, sem override por query string ou storage |
| Fronteira HTTP | `src/apis/_core/nativeHttpClient.js`, única |
| Sessão | JWT do MAIKE em memória + `sessionStorage`, guarda única |
| Login | `{cliente, login, senha}` — **nunca** `cliente_id` |
| CORS | `FRONTEND_ORIGINS`, allowlist de origins exatas, sem wildcard |
| Gate novo | `gate:native-api` — absoluto, 7 códigos, 24 provas |
| Bootstrap | `npm run auth:bootstrap:local` — script, não endpoint |
| Estados da sessão | `carregando` · `autenticada` · `nao_autenticada` · `validacao_indisponivel` |

**Nenhum model de domínio.** O schema Prisma está inalterado e não há migration
nova; `Setor` e `AreaPastagem` continuam só na Base44.

A dívida de erros que a P3 declarou **fechou**: os oito códigos do contrato
ModeloBase1 entraram em `src/apis/_core/ApiError.js`, com mensagem pública
própria, agora que existe consumidor real.

**A autenticação do aplicativo deixou de ser da Base44**, e não há fallback: se
o backend MAIKE não responde, o usuário vê falha de login. Dual-auth silenciosa
transformaria "o backend caiu" em "sua senha está errada". Com isso, `authRefs`
caiu de 10 para 5 — `redirectToLogin` autenticaria no provider errado, e o
`logout` da Base44 **não deve** ser chamado, porque descartaria o token do SDK
que chega uma única vez pela query string.

Duas coisas ficam ditas sem maquiagem. `sessionStorage` é acessível a
JavaScript: um XSS nesta origem lê o token, e a troca por `localStorage`
**reduz a janela, não a classe do problema** — cookie `HttpOnly`, refresh com
rotação, revogação e CSP são P8. E o logout é local, porque o JWT da P3 é
stateless e não há sessão a invalidar no servidor.

**A P4.0-R1 corrigiu um bloqueador que a auditoria externa encontrou** depois da
CI verde do primeiro HEAD: a restauração da sessão apagava o JWT para *qualquer*
erro, então um backend fora do ar por trinta segundos destruía a sessão de quem
estava trabalhando e pedia senha de novo — punindo o usuário por uma falha de
infraestrutura. Pior: o comentário que eu havia escrito justificava o
comportamento, o que o fazia parecer deliberado.

Agora as duas classes são separadas por **código**: `TENANT_CONTEXT_REQUIRED`
limpa o token; rede, timeout, CORS e 5xx **preservam** o token e levam ao estado
`validacao_indisponivel`, onde o aplicativo continua fechado, o login **não**
aparece, e o usuário recebe *Tentar novamente* — que reusa o mesmo JWT, sem
pedir senha. Fail-closed sem destruir a credencial. Ver §19 do relatório da P4.0
e D-PROD-24 §G.1.

Um detalhe de processo que se repetiu pela terceira vez: **duas regras do gate
novo reprovaram o próprio repositório** na primeira versão — `getNativeApiUrl`
casava na definição, e `Authorization` casava no provider da Base44, que monta
esse cabeçalho legitimamente. É a mesma classe de falso positivo da P3-R1. A
correção foi tornar a regra precisa (verificar *posição*, não palavra), com
controles positivos que quebram se alguém alargar de volta.

## Gates ativos

19 etapas em `npm run verify:all` — ver `docs/engineering/GATE-REGISTRY.md`.
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
| `3c1a90d` | **commit funcional** da P2 | [31108882141](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31108882141) | **verde**, 14/14 |
| `acc2f11` | **commit funcional** da P2-R1 | [31125606483](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31125606483) | **não executou** — ver abaixo |
| `8a5e3ee` | commit vazio da P2-R1, para disparar CI | — | nenhum run criado |
| `80ecf69` | **commit funcional** da P3 | [34243753654](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34243753654) | **verde**, 17/17 |
| `5bcee77` | **HEAD certificado** da P3-R1, mergeado na PR #10 | [34260918759](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34260918759) | **verde**, 18/18 |
| `0185d10` | **commit funcional** da P4.0 | [34269584058](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34269584058) | **verde**, 19/19 |
| `f01201b` | **HEAD certificado** da P4.0-R1, mergeado na PR #12 | [34272006608](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34272006608) | **verde**, 19/19 |

Um commit não pode conter o resultado da própria execução de CI. A execução do
commit funcional fica no corpo da PR aberta — PR #2 para a P1.1, PR #3 para a
P1.2, PR #5 para a P1.3, PR #6 para a P1.4 e a P1.4-R1, PR #7 para a P2, PR #10
para a P3 e a P3-R1, PR #12 para a P4.0 e a P4.0-R1.

Ao contrário da P2-R1, a P3 entrou na `main` com **execução de CI própria e
verde sobre o HEAD exato que foi mergeado**: o job `102178796058` do run
`34260918759` rodou as 18 etapas em `5bcee77`, e é esse commit que o merge
`4ce4608` trouxe. A lacuna declarada em `acc2f11` não se repetiu.

**O commit `acc2f11` entrou na `main` sem execução de CI própria.** Não houve
reprovação: o job `92695474512` nasceu na fila às 18:16:53 de 2026-08-06, nunca
recebeu runner (`runner_id: 0`, 0 ms faturados) e foi cancelado 15 minutos
depois. Re-run pela API foi aceito mas nunca enfileirou; um commit vazio no
mesmo HEAD não gerou run nenhum, enquanto o Vercel fez deploy normalmente no
mesmo push — ou seja, o gatilho chegava e o Actions não executava. A evidência
que existe para esse commit é o `verify:all` local, 14/14 com exit 0, mais a CI
verde do commit imediatamente anterior. O proprietário mergeou com esse quadro
registrado no corpo da PR #7. **A primeira execução verde na `main` cobre essa
lacuna** — até lá, ela fica declarada aqui em vez de escondida.

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
| DBT-03 | 2.319 diagnósticos de dívida de tipos versionados na catraca, com teto certificado de 2.319. A catraca impede crescimento em qualquer modo (D-PROD-17) e impede afrouxar a configuração (D-PROD-13). Trajetória: 2.802 → 2.759 (P1.2) → 2.728 (P1.3-R1) → 2.323 (P1.4, −405) → 2.319 (P1.4-R1, com o contrato de props do `Button` declarado de verdade, sem `any`) → **2.318** (P4.0, com o contrato do `AuthContext` declarado). A P2 e a P3 não mexeram em `src/` e por isso não reduziram nada — a redução voltou com o código nativo da P4.0 | P4–P8 |
| DBT-04 | Sem tela de **entrada** de estoque (D-PROD-08) | P6 |
| DBT-05 | Chave Google Maps antiga permanece no histórico Git — revogar e rotacionar (OWNER-SECURITY-01) | ação do proprietário |
| DBT-06 | Bundle único de ~2,50 MB, sem code splitting | P8 |
| DBT-07 | `LayoutCampo`/`LayoutSecao`/`LayoutConfiguracao` + `src/services/campoEngine.js` sustentam o formulário dinâmico de lote — um mini-motor de layout dentro do produto. A P2 é contrato de dados e não toca em UI (D-PROD-21); o desmonte acontece quando o lote migrar | P5 |
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
