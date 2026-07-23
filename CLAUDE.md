# CLAUDE.md — MAKGESTAO

> **Claude Code: leia este arquivo primeiro.** Pre-flight obrigatório em [`README_AI.md`](./README_AI.md).

## Projeto

ERP de pecuária construído originalmente na plataforma Base44. O trabalho atual é
torná-lo um sistema completo e independente, removendo integralmente a Base44.

**Programa ativo:** Independência da Base44 — ver `docs/engineering/CURRENT-STATE.md`

## Referência arquitetural

O repositório **PROJETOMG** já resolveu esta mesma migração. Ele é o **molde**.

Antes de desenhar qualquer coisa nova, leia como o PROJETOMG fez e replique o padrão.
**Não invente arquitetura. Copie a que já funciona.**

## Leitura obrigatória (ordem)

1. [`README_AI.md`](./README_AI.md) — pre-flight e estado atual
2. [`docs/constitution/00-CONSTITUICAO.md`](./docs/constitution/00-CONSTITUICAO.md)
3. [`docs/constitution/07-DO-NOT-DO.md`](./docs/constitution/07-DO-NOT-DO.md)
4. [`docs/constitution/08-REGRAS-DE-IA.md`](./docs/constitution/08-REGRAS-DE-IA.md)
5. [`docs/engineering/CURRENT-STATE.md`](./docs/engineering/CURRENT-STATE.md)
6. [`docs/engineering/DECISIONS.md`](./docs/engineering/DECISIONS.md)
7. [`docs/engineering/ROADMAP-SAAS.md`](./docs/engineering/ROADMAP-SAAS.md)
8. [`AGENTS.md`](./AGENTS.md) — comandos

**Histórico de chat de sessões anteriores não é autoritativo.**

## Regras invioláveis

| # | Regra | Gate |
|---|---|---|
| R1 | Todo model Prisma tem `cliente_id` | `gate:tenancy` |
| R2 | Todo índice de consulta começa por `cliente_id` | `gate:indices` |
| R3 | Chave única de negócio é `@@unique([cliente_id, ...])` | `gate:indices` |
| R4 | Componente React nunca acessa provider de dados direto | `gate:apis` |
| R5 | Referências a Base44 só podem **diminuir** | `gate:base44` |
| R6 | `base44/` é somente leitura — é a especificação de origem | `gate:base44` |
| R7 | 1 fase = 1 PR. Sem misturar fases | revisão humana |
| R8 | Toda fase termina com relatório em `docs/` | revisão humana |

## Antes de qualquer PR

```bash
npm run verify:all
```

## Memória

Memória do projeto é o **repositório**, não o chat. Toda decisão vai para
`docs/engineering/DECISIONS.md` com identificador `D-xx`.
