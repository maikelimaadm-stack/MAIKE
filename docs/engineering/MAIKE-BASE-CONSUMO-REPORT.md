# MAIKE-BASE-CONSUMO — Relatório

> **CONTRACT aprovado pelo proprietário** (D-PROD-208): "sobre a tabela que já tem dados pode excluir, não tem
> problema, os dados eram só teste". As 3 tabelas de Formulações estavam com **0 linhas** em produção e a guarda da
> migration exige isso; nenhum dado é migrado ou apagado. A aplicação em produção continua pendente do GO escrito
> desta migration (runbook §7).

Decisão: [D-PROD-208](./DECISIONS.md) · Runbook: [`MAIKE-BASE-CONSUMO-RUNBOOK-RELEASE.md`](./MAIKE-BASE-CONSUMO-RUNBOOK-RELEASE.md)
· Branch `claude/kind-knuth-tztu1v`.

## 1. Entrega

- **Formulação com base do consumo:** `PV` (% do peso vivo) ou `G_CAB_DIA` (gramas por cabeça por dia), uma por
  formulação. Na base G o padrão é `consumo_objetivo_g_cab_dia` (obrigatório) e o %PV padrão fica nulo; as regras por
  categoria que consomem levam `g_cab_dia`. Na base PV o g/cab/dia que já existir é só referência.
- **Sem mistura:** o servidor recusa (400 com `field`/`reason`) %PV na base G, gramas na base PV, os dois na mesma
  regra e a base sem o seu valor; a forma final vale também no PATCH (trocar a base exige os valores da nova).
- **Migration CONTRACT `20261116000000_formulacao_base_consumo`** (SHA-256 `a8c42eeb…3171`): `base_consumo` NOT NULL
  DEFAULT 'PV', `percentual_pv_padrao` anulável, CHECK por base no lugar do CHECK do %PV, `g_cab_dia` na regra e o
  CHECK da forma da regra recriado. Guarda com as 3 tabelas vazias. Oitava entrada de `MIGRATIONS_CONTRACT_APROVADAS`.
- **Tela Formulações:** campo "Base do consumo"; só os campos da base aparecem; trocar a base limpa o padrão e os
  valores das regras; nos gramas, "= 1,5 kg/cab/dia" ao lado; grade com "Consumo padrão" ("0,1% PV" ou "80 g/cab/dia").
- **Lançamento do cocho:** na base G, esperado = Σ cabeças × gramas (regra da categoria, senão o padrão) ÷ 1000, sem
  peso; painel "Consumo esperado em g/cab/dia"; o select mostra "(80 g/cab/dia)" em vez de "% PV". O evento grava
  `base_consumo`, `consumo_esperado_g_cab_dia` e, por lote, `g_cab_dia_lote`; a taxa continua em
  `consumo_esperado_pv_kg` (o nível do cocho, D-PROD-178, não muda).
- **Fechamento:** na base G o farol compara g/cab/dia real × meta (faixa da formulação, padrão 15%); %PV real só como
  informação. O cartão mostra "g/cab/dia real × meta" e "%PV real (informação)".

## 2. Exemplo

Sal mineral na base g/cab/dia, padrão 80 g, BEZERRO MAMANDO não consome, VACA 1.500 g. No pasto: 10 vacas, 8 bezerros
mamando e 20 bois sem peso. Esperado = 10 × 1.500 + 20 × 80 = 16.600 g = **16,6 kg/dia**; meta média das 30 cabeças que
consomem = **553 g/cab/dia**. Num período de 7 dias com 116,2 kg consumidos (16,6 kg/dia), o farol fica 🟢 Dentro.

## 3. Por que CONTRACT

`percentual_pv_padrao` era NOT NULL com CHECK (0, 5], e o CHECK da regra exigia %PV quando consome. A base G sem %PV
só cabe mudando esses dois, e a allowlist EXPAND recusa ALTER COLUMN, DROP/ADD CONSTRAINT e coluna NOT NULL DEFAULT em
tabela antiga. Gravar um %PV de mentira na base G (sentinela) foi descartado.

## 4. Release e testes das migrations anteriores

- A CONTRACT é isolada: `premerge-migrate --contract D-PROD-208` e, no runner oficial, `MIGRATION_CONTRACT_AUTORIZADO`
  exato (B27g, B20 do `migrations.test.mjs`).
- Nos testes das migrations anteriores que usam o runner com a conferência de alvo exigida (D-PROD-195, D-PROD-197,
  D-PROD-200, D-PROD-202, D-PROD-207), a D-PROD-208 sobe **fora de ordem** pelo Prisma direto antes do runner — junto
  com a EXPAND das Formulações (D-PROD-203), de que depende — como já se fazia com a D-PROD-200. Nos caminhos com alvo
  local (sem conferência) ela sobe por último. Os ensaios da D-PROD-162 e da D-PROD-187 a deixam fora da partida.
- Ensaio do `aplicar208.sql`: alvo de produção recusado; aplicou 58 → 59 com 95 tabelas; `migrate status` em dia;
  `migrate diff` vazio; repetir recusado.

## 5. Validação local

Na árvore com a `main` `9a666393` (PR #294) mergeada, etapas do `verify:all` rodadas separadas (como na D-PROD-205 e
na D-PROD-206; o `verify:all` inteiro passa de 30 min localmente com o backend num processo só):

| Etapa | Resultado |
|---|---|
| todos os `gate:*` (30) | passaram |
| `gate:types` | passou (546 ≤ 625) |
| `typecheck:backend` | passou |
| `lint` | 0 erros (2 avisos antigos, fora desta PR) |
| `test:gates` | 943 aprovados, 0 falhas |
| `test:backend` | 2161 testes: 2156 aprovados, 0 falhas, 5 todo |
| `test:smoke` | 242 arquivos, 2981 testes, todos aprovados |
| `build`, `build:admin`, `gate:admin-isolation` | passaram |

## 6. Fora do escopo

- Peso médio do período no fechamento, custo da sobra herdada pelo lote antigo e rateio do cocho compartilhado:
  próximos refinamentos, cada um com decisão própria.
- Módulo futuro **"Manejo de Pastagens"** (nome escolhido pelo proprietário), com o Monitoramento de Forragem (altura,
  massa, calibragem por capim e época) e um catálogo de culturas pré-preenchido.
