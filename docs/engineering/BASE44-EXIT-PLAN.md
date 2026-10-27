# Plano de saída da Base44 (MAIKE nativo)

**Atualizado em:** 2026-10-27  
**Decisão:** D-PROD-44 · **Status:** DONE (dados) — P5.5 (D-PROD-51)

## Estado após P5.5

| Camada | Nativo | Residual |
|---|---|---|
| Auth / sessão | JWT + backend MAIKE | — |
| Dados de domínio (mapa + manejo) | PostgreSQL + Fastify | — |
| Upload / sync denormalizado | `/arquivos/upload`, `/referencias/sincronizar` | — |
| Config pública app | Stub nativo | — |
| Infra SDK | Removido do bundle | Schemas JSONC legados (spec) |
| Runtime env Base44 | `VITE_BASE44_*` ainda definível | P7 — remover quando schemas saírem |

## Missões concluídas

1. P5.0–P5.4 — cadastros, tarefas, estoque, empresa (D-PROD-45 … D-PROD-50)
2. **P5.5** — 12 entidades finais + fim do registry (D-PROD-51)

## P7 (opcional)

- Remover `base44/entities` e entradas correspondentes do manifesto
- Limpar `runtimeConfig` de parâmetros Base44
- Storage de anexos além de data-URL (provider externo)
