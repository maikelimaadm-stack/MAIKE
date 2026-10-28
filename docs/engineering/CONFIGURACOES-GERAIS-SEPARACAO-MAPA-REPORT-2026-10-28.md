# Configurações Gerais × Mapa — separação de domínios (governança)

**Missão:** registrar separação produto (D-PROD-57); correção R3 catálogo global Supabase (28/10/2026)
**Branch:** `cursor/config-gerais-separacao-mapa-516d` · **PR:** [#126](https://github.com/maikelimaadm-stack/MAIKE/pull/126) (DRAFT)
**Base:** `origin/main` @ `1590655fc9ef080d8d178d270c22f9ec3c50fe1d` (merge PR #125)

## Preflight (execução R3)

| Verificação | Resultado |
|---|---|
| Repositório / `origin` | `maikelimaadm-stack/MAIKE` — OK |
| Branch atual | `cursor/config-gerais-separacao-mapa-516d` |
| HEAD local / remoto | `c216753d7fd8b811ff43e2abd07c456537a26d0d` (pré-correção R3; novo commit após edição docs) |
| `git fetch origin main` | OK — `origin/main` = `1590655fc9ef080d8d178d270c22f9ec3c50fe1d` |
| PR #126 | **OPEN**, **DRAFT**, base `main`, head branch acima; 3 arquivos docs (snapshot GitHub pré-R3) |
| PR #125 | **MERGED** |
| PRs abertas (GitHub) | **1** — somente #126 (snapshot pós-fetch R3) |
| Colisão mapa | Trabalho paralelo pode existir sem PR; política de não tocar mapa/código mantida |
| Escopo diff vs `main` | Apenas os três paths autorizados em `docs/engineering/` |

## Correção R3 (pedido do proprietário)

A redação inicial de D-PROD-57 tratava o **repositório Git** como autoridade do catálogo e o banco global Supabase como possibilidade futura. **Corrigido** na mesma decisão (sem nova D-PROD nem novo documento) para exigir:

- Catálogo global oficial editável em runtime: **Supabase PostgreSQL** (metadados, tipos, categorias, ícones, subícones, regras MISTO, revisões).
- Imagens: **Supabase Storage** (referências + revisão/hash; sem binários grandes em SQL).
- **Painel interno exclusivo** produto MAIKE; administrador de fazenda **não** edita catálogo global.
- GitHub: código, contratos, migrations, seed; alterações operacionais normais pelo painel **sem** commit/deploy quando o contrato já suportar.

Plano §1, §5.1 e §6 alinhados; modelo conceitual, MISTO, segurança, offline e migração legado documentados. **Zero** implementação Supabase/Vercel/UI nesta execução.

## Entregas desta missão (acumulado PR #126)

- Plano: [`PLAN-CONFIGURACOES-GERAIS-SEPARACAO-MAPA-2026-10-28.md`](./PLAN-CONFIGURACOES-GERAIS-SEPARACAO-MAPA-2026-10-28.md)
- Decisão: **D-PROD-57** em [`DECISIONS.md`](./DECISIONS.md)
- Relatório: este arquivo
- **Zero** diff em árvores/contratos congelados (mapa, `ConfiguracaoIcone`, Prisma, menu, escopo)

## Estado do código (main — somente leitura)

- `ConfiguracaoIcone` tenant-scoped + `GerenciadorIcones` = **legado**, não modelo global.
- `useMapRenderer` MISTO: comportamento atual documentado para preservação até migração testada.
- Preferências reais do cliente: matriz proposta; **nenhuma** tabela/API até lista fechada.

## Testes e gates

`npm run verify:all` (branch com diff R3, 28/10/2026 UTC):

| Resultado | Detalhe |
|---|---|
| **34/35 etapas PASS** | gates, lint, `typecheck:backend`, smoke **735**, build — OK (~93s) |
| **test:backend FAIL** | `DATABASE_URL` ausente / PostgreSQL local indisponível neste ambiente cloud (exit 1, ~101ms) |

- Testes E2E/visual Configurações Gerais: **PENDING** (missão documental).
- Testes backend catálogo/preferências: **N/A** (sem API nova).
- Supabase/Vercel produção: **não auditados** nesta missão.

## Riscos residuais

- Trabalho mapa/MapLibre não visível no GitHub.
- IDs legados `PontoReferencia` e URLs copiadas.
- Regras MISTO vs sexo lote; empates e cache CDN.
- Auth produto vs tenant; RLS/Storage; offline e revisão de catálogo.
- Desempenho e versionamento de manifest.

## Veredito

**READY FOR DOCUMENT AUDIT — NOT READY FOR IMPLEMENTATION.**

PR #126 permanece **DRAFT**; merge manual pelo proprietário após auditoria. Próximo passo técnico: aguardar mapa → preflight `main` → auditoria Supabase/Vercel autorizada → slice isolada catálogo global.
