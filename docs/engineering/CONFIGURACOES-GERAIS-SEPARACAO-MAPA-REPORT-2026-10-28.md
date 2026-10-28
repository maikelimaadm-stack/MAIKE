# Configurações Gerais × Mapa — separação de domínios (governança)

**Missão:** registrar separação produto (D-PROD-57) · Branch `cursor/config-gerais-separacao-mapa-516d`  
**Base:** `origin/main` @ `1590655fc9ef080d8d178d270c22f9ec3c50fe1d` (merge PR #125)

## Preflight

| Verificação | Resultado |
|---|---|
| `git fetch origin main` | OK — ref alinhada a `1590655f…` |
| PR #125 | **MERGED** (`feat(PR125): split Usuários vs Permissões`) |
| CI `quality` em `main` (push do merge #125) | **success** — run `40763802850` |
| PRs abertas no GitHub (snapshot 28/10/2026) | **0** — não prova ausência de branches locais de mapa |
| Prompt PR #126 (MotorBase1 + ícones) | **CONGELADO** — ver plano §3 |

## Entregas desta missão

- Plano versionado: [`PLAN-CONFIGURACOES-GERAIS-SEPARACAO-MAPA-2026-10-28.md`](./PLAN-CONFIGURACOES-GERAIS-SEPARACAO-MAPA-2026-10-28.md)
- Decisão registrada: **D-PROD-57** em [`DECISIONS.md`](./DECISIONS.md)
- **Zero** diff em árvores/contratos congelados (mapa, `ConfiguracaoIcone`, Prisma, menu, escopo)

## Estado do código (main — somente leitura)

- `ConfiguracoesGerais` continua acoplada ao editor tenant-scoped de ícones (`GerenciadorIcones` / `ConfiguracaoIcone`).
- Catálogo global de ícones e migração de `PontoReferencia.configuracao_icone_id` ficam para slice **posterior**, coordenada com mapa.
- Preferências reais do cliente: matriz proposta no plano; **nenhuma** tabela/campo/API criada até lista fechada com consumidores.

## Testes e gates

- `npm run verify:all` na branch (2026-10-28): **34/35 etapas PASS**; `test:backend` **FAIL** — `DATABASE_URL` ausente e Docker indisponível neste ambiente cloud (sem PostgreSQL local). Gates, lint, smoke (735) e build: **PASS**.
- Testes E2E/visual de Configurações Gerais: **PENDING** (missão não implementa UI).
- Testes backend de preferências: **N/A** (sem API nova).

## Veredito

**READY FOR PRODUCT DEFINITION — NOT READY FOR IMPLEMENTATION.**

Próximo passo técnico **bloqueado** até confirmação de merge do trabalho paralelo de mapa + preflight com diff real. Primeira PR de código: preferências aprovadas apenas; PR separada depois: catálogo global de ícones.
