# MAIKE-BASE-CONSUMO — Relatório

> **CONTRACT aprovado pelo proprietário** (D-PROD-210): "sobre a tabela que já tem dados pode excluir, não tem
> problema, os dados eram só teste". As 3 tabelas de Formulações estavam com **0 linhas** em produção e a guarda da
> migration exige isso; nenhum dado é migrado ou apagado. A aplicação em produção continua pendente do GO escrito
> desta migration (runbook §7).

Decisão: [D-PROD-210](./DECISIONS.md) · Runbook: [`MAIKE-BASE-CONSUMO-RUNBOOK-RELEASE.md`](./MAIKE-BASE-CONSUMO-RUNBOOK-RELEASE.md)
· Branch `claude/kind-knuth-tztu1v`.

## 1. Entrega

- **Formulação com base do consumo:** `PV` (% do peso vivo) ou `G_CAB_DIA` (gramas por cabeça por dia), uma por
  formulação. Na base G o padrão é `consumo_objetivo_g_cab_dia` (obrigatório) e o %PV padrão fica nulo; as regras por
  categoria que consomem levam `g_cab_dia`. Na base PV o g/cab/dia que já existir é só referência.
- **Sem mistura:** o servidor recusa (400 com `field`/`reason`) %PV na base G, gramas na base PV, os dois na mesma
  regra e a base sem o seu valor; a forma final vale também no PATCH (trocar a base exige os valores da nova).
- **Migration CONTRACT `20261116200000_formulacao_base_consumo`** (SHA-256 `a8c42eeb…3171`): `base_consumo` NOT NULL
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

- **Numeração:** nasceu D-PROD-207 (`20261115300000_…`), passou a D-PROD-208 (`20261116000000_…`) quando a `main` deu a
  D-PROD-207 à Fatia 4 (PR #294) e é a **D-PROD-210** (`20261116200000_formulacao_base_consumo`) depois de a `main`
  dar a D-PROD-208 ao ajuste da Fatia 4 (PR #298) e a D-PROD-209 ao tipo Terceirizado (PR #299), ambas já aplicadas em
  produção (60 / 0, 94 tabelas). O conteúdo da migration não mudou: checksum `a8c42eeb…3171` e hash da guarda
  `a66ff13e…4819` iguais. A 1ª tentativa de aplicação (guarda de 58) foi barrada pela própria guarda (59 em
  produção naquele instante) e **nada foi alterado**.
- A CONTRACT é isolada: `premerge-migrate --contract D-PROD-210` e, no runner oficial, `MIGRATION_CONTRACT_AUTORIZADO`
  exato (B29g, B22 do `migrations.test.mjs`).
- Testes das migrations anteriores, no padrão que a `main` adotou com a D-PROD-208/209 (espelho do runner, "no dia"):
  a D-PROD-209 passa a subir pelo runner do dia dela (espelho até ela) e a D-PROD-210 por último, pelo runner do
  repositório com a decisão DELA (AC-04, LM-03; o FT-08 prova a ordem 209 → 210 e o `migrate diff` vazio; o MP-08
  fica no dia da D-PROD-209). Nos testes que já subiam a base fora de ordem (D-PROD-195, D-PROD-197), ela continua
  subindo pelo Prisma direto, com as Formulações; nos caminhos com alvo local ela sobe por último. Os testes do dia da
  D-PROD-208 e da D-PROD-209 esperam o `migrate diff` com diferença (exit 2), porque o `schema.prisma` de hoje já tem
  a base do consumo.
- Ensaio do `aplicar210.sql` (banco local com as 60 da `main`): alvo de produção recusado; aplicou 60 → 61 com 94
  tabelas; `migrate status` em dia; `migrate diff` "No difference detected."; repetir recusado.

## 5. Validação local

Na árvore com a `main` `18426967` (PRs #298 e #299) mergeada, etapas do `verify:all` rodadas separadas (como na D-PROD-205 e
na D-PROD-206; o `verify:all` inteiro passa de 30 min localmente com o backend num processo só):

| Etapa | Resultado |
|---|---|
| todos os `gate:*` (28 + `types` + `admin-isolation`) | passaram |
| `gate:types` | passou |
| `typecheck:backend` | passou |
| `lint` | 0 erros (2 avisos antigos, fora desta PR) |
| `test:gates` | 979 aprovados, 0 falhas (inclui `premerge-migrate`, `migrations` B22, `alvo-banco`, `preflight-schema`) |
| `test:backend` | 4 shards (`TEST_BACKEND_SHARD=i/4`, um banco por shard): 2188 testes, 2183 aprovados, 0 falhas, 5 todo. Na rodada paralela, o shard 2 teve 2 falhas: o AM-08 (corrigido: o `migrate diff` do dia da D-PROD-208 acusa a base do consumo) e o `after` do teste da D-PROD-194, que apaga o papel `maike_vercel` compartilhado com os bancos dos outros shards (ambiente, não código); o shard 2 sozinho, depois da correção: 522 / 522 |
| `test:smoke` | 242 arquivos, 2987 testes, todos aprovados |
| `build`, `build:admin` | passaram |

## 6. Fora do escopo

- Peso médio do período no fechamento, custo da sobra herdada pelo lote antigo e rateio do cocho compartilhado:
  próximos refinamentos, cada um com decisão própria.
- Módulo futuro **"Manejo de Pastagens"** (nome escolhido pelo proprietário), com o Monitoramento de Forragem (altura,
  massa, calibragem por capim e época) e um catálogo de culturas pré-preenchido.
