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

**Estado:** implementada na branch `claude/p2-modelobase1-pecuario-foundation`,
em PR draft, aguardando merge do proprietário.

---

## P3 — Backend + Prisma + PostgreSQL Foundation

Criar `backend/` com Fastify, Prisma e PostgreSQL. Schema apenas com a camada de
tenant. `cliente_id` em todo model desde o primeiro dia. Migrations versionadas.

**Critério de aceite:** `prisma validate` passa; health check responde;
autenticação própria emite sessão válida; zero import de `@base44/sdk` no backend;
`gate:tenancy` e `gate:indices` criados e verdes; tudo conforme
`config/modelobase1-pecuario.json`.

**Estado:** não iniciada. Nenhuma migration de domínio pode começar antes do
merge da P2.

---

## P4 — Mapa Core Native Persistence

Migrar para persistência nativa as entidades geográficas do mapa: `AreaPastagem`,
`PontoReferencia`, `PontoSuplementacao`, `LinhaGeografica`, `Setor`,
`ConfiguracaoIcone`, `MovimentacaoMapa`.

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
