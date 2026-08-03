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

**Estado:** P0.1 entregue — ver `docs/engineering/P0.1-MAPA-MANEJO-SCOPE-RESET-REPORT.md`

---

## P1 — Native Foundation Bootstrap

Preparar o repositório para código nativo: estrutura de pastas própria, contratos
de UI em `src/apis/`, padrão de erro único, camada de configuração por ambiente,
testes automatizados mínimos. Nenhum componente ainda acessa provider de dados
direto.

**Critério de aceite:** nenhuma tela do escopo importa `base44` diretamente;
toda leitura/escrita passa por `src/apis/`.

---

## P2 — ModeloBase1 Pecuário Foundation

Definir o modelo base do domínio pecuário (identidade, tenancy, auditoria,
numeração, anexos) no padrão validado no PROJETOMG, restrito ao escopo do produto.

**Critério de aceite:** modelo base documentado e aprovado antes de qualquer
migration de domínio.

---

## P3 — Backend + Prisma + PostgreSQL Foundation

Criar `backend/` com Fastify, Prisma e PostgreSQL. Schema apenas com a camada de
tenant. `cliente_id` em todo model desde o primeiro dia. Migrations versionadas.

**Critério de aceite:** `prisma validate` passa; health check responde;
autenticação própria emite sessão válida; zero import de `@base44/sdk` no backend.

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
