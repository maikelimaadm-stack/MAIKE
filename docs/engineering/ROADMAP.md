# Roadmap — MAIKE Pecuária (Mapa Geral + Manejo)

**Status:** Oficial · **Versão:** 2.0.0 · **Substitui:** `docs/archive/ROADMAP-SAAS-2026-06.md`

O produto é um sistema nativo de **Pecuária — Mapa Geral + Manejo** (D-PROD-01).
Este roadmap descreve **reconstrução direta**, não migração conservadora: não há
shim de compatibilidade, não há preservação de módulos fora do escopo.

O PROJETOMG é molde de **disciplina e arquitetura** (D-PROD-03): API → service →
repository → Prisma, migrations versionadas, tenancy desde o primeiro model, erros
padronizados, gates obrigatórios, uma missão por PR. **Não** é fonte para copiar
Studio, MDP/MMM, marketplace, runtime universal ou plataforma low-code.

---

## P0 — Product Scope Reset

Reduzir o repositório à cadeia funcional do Mapa Geral + Manejo. Excluir páginas,
componentes, schemas e functions fora do produto. Corrigir a governança para
caminhos executáveis. Instalar os gates de escopo.

**Estado:** P0.1 **mergeada** (PR #1) — relatórios `P0.1-MAPA-MANEJO-SCOPE-RESET`,
`P0.1-R1-CORRECTIVE-HARDENING`, `P0.1-R2-FINAL-CONTRACT-CLOSURE`,
`P0.1-R3-TYPE-RATCHET-NON-REGRESSION` e `P0.1-R4-SSOT-FINAL-SYNCHRONIZATION`.

---

## P1 — Native Foundation Bootstrap

Preparar o repositório para código nativo: estrutura de pastas própria, contratos
de UI em `src/apis/`, padrão de erro único, camada de configuração por ambiente,
testes automatizados mínimos. Nenhum componente ainda acessa provider de dados
direto.

**Critério de aceite:** nenhuma tela do escopo importa `base44` diretamente;
toda leitura/escrita passa por `src/apis/`.

**Estado:** **concluída** — a PR #6 foi mergeada na `main` pelo proprietário
(merge `7398d85`), fechando P1.4 e P1.4-R1. Os seis eixos de
`gate:api-boundary` estão em zero e o baseline versionado tem as seis listas
vazias.

A P1 é executada em slices, uma PR por slice. Cada uma **remove** caminhos do
baseline de `gate:api-boundary`; nenhuma adiciona (SCL-P11-01).

| Slice | Escopo | Estado |
|---|---|---|
| **P1.1** | fundação (`src/apis/`, `ApiError`, `runtimeConfig`, provider interno) + piloto **Empresa** | entregue |
| **P1.2** | Mapa — `MapaGeral`, `MapaCadastro`, `DetalhesLote`, componentes de `src/components/mapa/`, cache offline e `useSetorAreas` | mergeada (PR #3); corrigida por P1.2-R1 e P1.2-R2 |
| **P1.3** | Manejo — `CadastroLotes`, `CadastroSetores`, `Categorias`, `CategoriasManejo`, `Bebedouros`, componentes de lotes e bebedouros, anexos; remoção dos repositórios legados | **mergeada** (PR #5) |
| **P1.4** | Suporte e Administração + fechamento da P1 — casca, autenticação, configurações, produtos, marcas, unidades, locais de estoque, tarefas, usuários e suplementação; remoção dos três monkey patches globais; DBT-10, DBT-17, DBT-18 e DBT-25 | **mergeada** (PR #6, merge `7398d85`) |
| **P1.4-R1** | correção de contrato sobre a P1.4, sem migrar caminho: classificação de erro de sessão só na fronteira (`{ok, value}` / `{ok, reason}`), `Button` tipado de verdade em vez de `any`, rastro fiel do rename parcial, remoção do código de erro órfão | **mergeada** na mesma PR #6 |

A P1 só seria declarada concluída na P1.4, quando o baseline de fronteira
chegasse a zero caminho legado nas telas do escopo. Isso aconteceu, e o merge da
PR #6 formalizou: **a P1 está concluída**.

Zerar os eixos não fechou sozinho a fronteira: a P1.4-R1 mostrou que o formato de
erro do provider ainda atravessava três camadas com a contagem já em zero. Daí a
regra que fica para as próximas slices — **eixo zerado é condição necessária, não
suficiente**; o que prova a fronteira é o contrato que sai dela.

---

## P2 — ModeloBase1 Pecuário Foundation

**Contrato base de persistência e domínio — não é motor visual** (D-PROD-21).

Definir identidade, tenancy, timestamps, auditoria, numeração, anexos, exclusão,
concorrência, vocabulário de erro e padrões proibidos para os futuros models
Prisma, no padrão validado no PROJETOMG e restrito ao escopo do produto.

O nome vem do PROJETOMG, o significado não: lá `ModeloBase1` é o motor visual de
cadastro; aqui é contrato de dados. Nada em `src/` muda por causa dele, e ele não
cria runtime genérico, low-code nem template de tela.

**Entregas:** `config/modelobase1-pecuario.json` (SSOT executável),
`docs/architecture/MODELOBASE1-PECUARIO-CONTRACT.md` (leitura humana),
`gate:modelobase1-pecuario` (verificação absoluta, sem baseline) e os testes
MB1-01 a MB1-20.

**Critério de aceite:** modelo base documentado e aprovado — isto é, **mergeado**
— antes de qualquer migration de domínio.

**Estado:** **concluída e mergeada** — PR #7, merge `1851503`, 2026-08-28.
Inclui a correção **P2-R1**, que fechou três invariantes que o contrato
declarava e o gate ainda não protegia. O contrato é oficial e vigente.

---

## P3 — Backend + Prisma + PostgreSQL Foundation

Criar `backend/` com Fastify, Prisma e PostgreSQL. Schema apenas com a camada de
tenant. `cliente_id` em todo model desde o primeiro dia. Migrations versionadas.

**Critério de aceite:** `prisma validate` passa; health check responde;
autenticação própria emite sessão válida; zero import de `@base44/sdk` no backend;
`gate:tenancy` e `gate:indices` criados e verdes; tudo conforme
`config/modelobase1-pecuario.json`.

**Estado:** **concluída e mergeada — PR #10, merge `4ce4608`**, sobre a
implementação certificada em `5bcee77`. Entregou `backend/` com Fastify, Prisma e
PostgreSQL; os cinco models da fundação; migration versionada; Docker Compose
local e PostgreSQL efêmero na CI; `auth_context` com sessão própria; e os gates
`gate:tenancy` e `gate:indices`, absolutos e com prova negativa por invariante.

Inclui a correção **P3-R1**, que fechou cinco bloqueios de auditoria dentro da
mesma PR: identidade em runtime contornando o `@default(cuid())`, relação
`AuditLog → Usuario` sem coerência de tenant, regressão de bundle causada por
`NODE_ENV` no workflow, `backend/` sem cobertura de tipos e `prisma validate`
que não rodava na cadeia. Ver §16 do relatório da P3.

A precondição de governança `P3-G0.2` foi resolvida antes da implementação: a
colisão entre a Constituição e o contrato sobre `Cliente` sem `cliente_id` virou
a emenda **D-PROD-22**, mergeada na PR #9.

Implementa **somente** a camada de tenant/fundação: nenhum model de mapa e
nenhum model de manejo, que ficam para P4–P6, uma capacidade de cada vez.

---

## P4 — Mapa Core Native Persistence

**Estado:** **em execução**, fatiada.

| Fatia | Nome | Estado |
|---|---|---|
| **P4.0** | Native Transport + Session Activation | **concluída e mergeada** — PR #12, merge `45599f5` (inclui a **P4.0-R1**); corrigida pela **P4.0-R2** — PR #15, merge `b2535ec` |
| **P4.1** | Setor Native Persistence | **concluída e mergeada** — PR #14, merge `b559c48` (inclui a **P4.1-R1**); fechada pela **P4.1-R2** — PR #17, merge `588792b` |
| P4.2 | AreaPastagem Native Persistence | **concluída** — model, migration, rotas, porta única e `gate:area-pastagem-native` (D-PROD-30) |
| P4.3 | PontoReferencia + LinhaGeografica + ConfiguracaoIcone | não iniciada |

A ordem é estrutural, não preferência. A P3 entregou um backend que sabe
autenticar e o frontend continuou autenticando na Base44 — sem URL configurada,
sem cliente HTTP, sem sessão própria. Criar model de domínio antes disso
produziria persistência que ninguém consegue consumir. E `AreaPastagem` depende
de `Setor`, o que fixa o resto da ordem.

A **P4.0** entregou: `VITE_MAIKE_API_URL`, cliente HTTP nativo único, sessão JWT
em `sessionStorage`, login nativo sem dual-auth, CORS com allowlist exata,
bootstrap local do primeiro usuário e o gate absoluto `gate:native-api`.
Fechou também a dívida da P3 (D-PROD-23, item 7): os oito códigos de erro do
contrato entraram em `src/apis/_core/ApiError.js`. **Nenhum model de domínio** —
o schema Prisma está inalterado. Ver D-PROD-24.

A **P4.0-R1** corrigiu, dentro da mesma PR, um bloqueador achado em auditoria
externa: a restauração da sessão apagava o JWT para qualquer erro, confundindo
backend fora do ar com credencial recusada. Ver D-PROD-24 §G.1.

A **P4.0-R2** corrigiu, em PR própria depois do merge, um defeito que chegou ao
usuário: `VITE_MAIKE_API_URL` sem esquema não falhava — virava URL relativa, e o
`POST /auth/login` saía com a senha para a origem do frontend. É fatia corretiva
da P4.0 porque o defeito está no transporte que ela entregou; `P4.2` segue
reservada para `AreaPastagem`. Ver D-PROD-26.

A **P4.1** entregou a primeira capacidade de domínio nativa: model Prisma
`Setor` tenant-scoped, migration versionada, rotas `GET`/`POST`/`PATCH`
autenticadas, numeração por `EntidadeCodigoSequencia` no escopo `tenant`, porta
única no frontend usada pelo cadastro **e** pelo mapa, e o gate absoluto
`gate:setor-native`. Com ela morre o `MAX+1` de `numero_setor` (DBT-26), que só
agora tinha onde ser resolvido de verdade — com a sequência atômica da P3 e o
caminho autenticado da P4.0.

A exclusão de setor ficou **fechada** nesta fatia, por decisão: não existe
`DELETE /setores/:id` enquanto `AreaPastagem`, `LancamentoTarefa`,
`MovimentacaoMapa` e `MovimentacaoPecuaria` — os dependentes que a guarda de
vínculo consulta — não forem nativos. **A P4.2 migrou o primeiro dos quatro e
não reabriu a exclusão**: os outros três seguem na Base44, e reabrir com um
quarto do vínculo verificável seria pior que manter fechado. Ver D-PROD-25 §D e
§N.

A **P4.2** migrou `AreaPastagem`, o próximo nó da árvore de dependências do mapa
e o primeiro com FK composta tenant-aware para `Setor` — a relação que o
`@@unique([cliente_id, id])` da P4.1 existia para tornar possível sem retrofit.
Trouxe também três coisas que não eram óbvias: `setor_nome` deixou de ser
enviado pelo cliente e passou a ser derivado do setor lido na mesma transação;
renomear um setor passou a reescrever o `setor_nome` das áreas nativamente,
fechando um dos seis destinos de `syncEntityReferences`; e os **dois** leitores
de área no frontend (mapa e suplementação) passaram a ter dono único em
`@/apis/areas`. Ver D-PROD-30.

Ainda por migrar nesta fase: `PontoReferencia`, `PontoSuplementacao`,
`LinhaGeografica`, `ConfiguracaoIcone`, `MovimentacaoMapa`.

**Critério de aceite:** `MapaGeral` e `MapaCadastro` operam contra o backend
próprio; `gate:base44` registra queda no acoplamento.

---

## P5 — Manejo Core Native Persistence

Migrar o manejo iniciado no mapa: `Lote`, `CategoriaManejo`, movimentação,
nascimento, morte, abate, mudança de categoria, pesagem do lote, junção,
renomeação, histórico, validação temporal, `ManejoTecnicoRebanho`,
`EventoSanitario`, `AplicacaoMedicamento`.

**Critério de aceite:** `DetalhesLote` opera contra o backend próprio, com regra
de negócio no service e não no componente.

---

## P6 — Supporting Capabilities

Migrar o suporte: suplementação (`SuplementacaoEvento`, `SuplementacaoLote`),
estoque do mapa (`EstoqueLoteNota`, `MovimentacaoEstoque`, `LocalEstoque`),
produtos e unidades, bebedouros e seus históricos, tarefas do mapa
(`LancamentoTarefa`, `TipoTarefa`, `GrupoAtividade`), anexos, empresa,
usuários e permissões.

Inclui reconstruir a **entrada de estoque** do produto, removida em P0.1 junto
com o módulo de movimentações de estoque legado.

---

## P7 — Base44 Final Removal

Remover `@base44/sdk` e `@base44/vite-plugin` do `package.json`, remover o plugin
do `vite.config.js`, arquivar `base44/` como referência histórica e substituir
`gate:base44` por `gate:no-base44` (zero referências).

**Critério de aceite:** `gate:no-base44` passa com contagem zero.

---

## P8 — Hardening and Release

RLS no PostgreSQL, autorização real, rate limiting, observabilidade, backup com
teste de restore, performance do mapa em campo, release.

---

## Fora do roadmap

Plataforma low-code, Studio, MDP/MMM, marketplace, runtime universal, motor de
intelligence genérico, ERP amplo. Ver `docs/constitution/07-DO-NOT-DO.md`.
