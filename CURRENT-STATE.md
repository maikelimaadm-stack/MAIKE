# Estado Atual

**Atualizado em:** _(atualizar a cada fase concluída)_

---

## Programa

**Independência da Base44** — tornar o MAKGESTAO um sistema completo e autônomo.

| Campo | Valor |
|---|---|
| Fase atual | **Fase 0 — Pré-requisitos** |
| Próxima fase | Fase 1 — Fundação do backend |
| Branch | `saas-migration` |
| Ponto de retorno | tag `base44-freeze` |

## Progresso por fase

| Fase | Nome | Estado |
|---|---|---|
| 0 | Pré-requisitos | em andamento |
| 1 | Fundação do backend | não iniciada |
| 2 | Schema de domínio | não iniciada |
| 3 | Shim de compatibilidade | não iniciada |
| 4 | Migração módulo a módulo | não iniciada |
| 5 | Endurecimento | não iniciada |
| 6 | Corte final | não iniciada |

## Checklist da Fase 0

- [ ] Exportar CSV de todas as 87 coleções da Base44
- [ ] Validar contagem de registros por coleção
- [ ] Criar tag `base44-freeze`
- [ ] Criar branch `saas-migration`
- [ ] Instalar governança (este conjunto de arquivos)
- [ ] Rodar `npm run verify:all` e registrar baseline
- [ ] Tornar repositório privado
- [ ] Provisionar PostgreSQL de desenvolvimento

## Baseline de acoplamento

Medição inicial em `scripts/gates/base44-baseline.json`:

| Métrica | Valor inicial |
|---|---|
| Arquivos em `src/` com SDK | 197 |
| Chamadas ao SDK | 2.696 |

**Este número só pode diminuir.**

## Débito conhecido

| # | Item | Origem |
|---|---|---|
| DBT-01 | 4 componentes em `src/components/offline/` acessam SDK direto | `gate:apis` |
| DBT-02 | Apenas 2 repositórios para 87 entidades | levantamento inicial |
| DBT-03 | `requiresAuth: false` em `src/api/base44Client.js` | levantamento inicial |
| DBT-04 | Sem RLS (será tratado na Fase 5) | roadmap |
