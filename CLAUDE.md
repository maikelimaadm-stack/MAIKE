# CLAUDE.md — MAIKE

> **Claude Code: leia este arquivo primeiro.** Pre-flight obrigatório em [`README_AI.md`](./README_AI.md).

## Produto

Sistema nativo e escalável de **Pecuária — Mapa Geral + Manejo**.

Foi originalmente construído na plataforma Base44 como um ERP amplo. O escopo foi
redefinido: o produto agora é **exclusivamente** o Mapa Geral e o manejo iniciado
a partir dele. Ver [`docs/engineering/DECISIONS.md`](./docs/engineering/DECISIONS.md) (D-PROD-01).

**Superfície primária:** `src/pages/MapaGeral.jsx`. A raiz `/` redireciona para lá.

**Missão ativa:** ver [`docs/engineering/CURRENT-STATE.md`](./docs/engineering/CURRENT-STATE.md)

## Referência arquitetural

O repositório **PROJETOMG** é o molde de **disciplina e arquitetura**:
API → service → repository → Prisma, migrations versionadas, tenancy desde o
primeiro model, erros padronizados, gates obrigatórios, uma missão por PR.

**Não é fonte** para copiar Studio, MDP/MMM, marketplace, runtime universal,
low-code ou intelligence engines (D-PROD-03).

## Leitura obrigatória (ordem)

1. [`README_AI.md`](./README_AI.md) — pre-flight e estado atual
2. [`docs/constitution/00-CONSTITUICAO.md`](./docs/constitution/00-CONSTITUICAO.md)
3. [`docs/constitution/07-DO-NOT-DO.md`](./docs/constitution/07-DO-NOT-DO.md)
4. [`docs/constitution/08-REGRAS-DE-IA.md`](./docs/constitution/08-REGRAS-DE-IA.md)
5. [`docs/engineering/CURRENT-STATE.md`](./docs/engineering/CURRENT-STATE.md)
6. [`docs/engineering/DECISIONS.md`](./docs/engineering/DECISIONS.md)
7. [`docs/engineering/ROADMAP.md`](./docs/engineering/ROADMAP.md)
8. [`docs/engineering/GATE-REGISTRY.md`](./docs/engineering/GATE-REGISTRY.md)
9. [`AGENTS.md`](./AGENTS.md) — comandos

**Histórico de chat de sessões anteriores não é autoritativo.**

## Regras invioláveis

| # | Regra | Gate |
|---|---|---|
| R1 | Rotas, menu, schemas e functions vivem dentro de `config/mapa-manejo-scope.json` | `gate:product-scope` |
| R2 | `MapaGeral` é a superfície primária | `gate:product-scope` |
| R3 | Nenhum import em `src/` pode apontar para arquivo inexistente | `gate:import-integrity` |
| R4 | Nenhum segredo literal em `src/`; nenhum `.env` versionado | `gate:no-secrets` |
| R5 | Referências a Base44 só podem **diminuir** | `gate:base44` |
| R6 | Governança vive em `docs/`, sem SSOT duplicado na raiz | `gate:governance-paths` |
| R7 | 1 missão = 1 PR. Sem misturar missões | revisão humana |
| R8 | Toda missão termina com relatório em `docs/engineering/` | revisão humana |

Regras futuras de backend (`cliente_id` em todo model, índice composto por
`cliente_id`, componente sem acesso direto a dado) entram com os gates
correspondentes em P1/P3 — ver [`docs/engineering/GATE-REGISTRY.md`](./docs/engineering/GATE-REGISTRY.md).

## Antes de qualquer PR

```bash
npm run verify:all
```

## Memória

Memória do projeto é o **repositório**, não o chat. Toda decisão vai para
[`docs/engineering/DECISIONS.md`](./docs/engineering/DECISIONS.md) com identificador próprio.
