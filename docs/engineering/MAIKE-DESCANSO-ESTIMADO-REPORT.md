# MAIKE-DESCANSO-ESTIMADO — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-223](./DECISIONS.md) ·
Runbook: [`MAIKE-DESCANSO-ESTIMADO-RUNBOOK-RELEASE.md`](./MAIKE-DESCANSO-ESTIMADO-RUNBOOK-RELEASE.md)

Quarto passo do Manejo de Pastagens: depois do Cadastro de Culturas (D-PROD-215), da Área ligada à
Cultura (D-PROD-216), da Medição de Forragem (D-PROD-219) e do farol no mapa (D-PROD-221), o pasto
sem medição recente ganha um farol **estimado** pelos dias de descanso da cultura.

> **Numeração:** a D-PROD-222 está reservada pela branch `claude/design-filters-implementation-agzxk8`
> (outra sessão, aberta). Esta é a D-PROD-223; a próxima livre é a D-PROD-224.

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | migration **EXPAND** `20261117300000_cultura_dias_descanso`: `CADCULTURAS.dias_descanso INTEGER` anulável, sem DEFAULT e sem CHECK. SHA-256 `5a266b174b20a6bc3ca51a7dc15d852378a875d506a805bb7eedfbba01191a4b`, pinado em `MIGRATIONS_APROVADAS`; `COLUNAS_EXIGIDAS` do preflight com a coluna. 66 → 67 migrations, 96 tabelas |
| API `/culturas` | `dias_descanso` no corpo e na resposta; inteiro (ou texto só com dígitos) de **1 a 365**, vazio = `null`; fora disso 400 (`dias_descanso_invalido` / `dias_descanso_fora_da_faixa`); a rota recusa a coerção do Fastify como nas alturas. A lista de referência grava os dias (Marandu 30, Xaraés 30, Piatã 30, Paiaguás 28, Decumbens 25, Humidicola 25, Mombaça 35, Tanzânia 32, Zuri 35, Massai 28, Tifton 85 25) |
| API `/areas-pastagem` | a `cultura` embutida (D-PROD-216) traz `dias_descanso` |
| API `/medicoes-forragem/descanso` | `GET ?empresa_id=` (autenticado; fazenda conferida no tenant; R11): por pasto, `{ area_id, ocupada, ultima_saida }` pelo ledger do rebanho (seção 2) |
| Domínio | `src/domain/pastagem/farolForragem.js`: `estimarSituacaoPorDescanso` (regra pura), `estimativaDoPasto` ("Em pastejo", "Sem estimativa", "<Situação> (estimado)"), `farolQueVale` (medição válida vence) e `farolForragemComEstimativaPorArea` (todos os pastos de uma vez); `corEstimada` = mesma cor, tom 0,7 (o "no olho" é 0,45) |
| Mapa | `MapaGeral.jsx` carrega `descansoPastos` (cache do mapa, só com o modo "Forragem") e pinta pelo farol que vale; o refresh do mapa o recarrega nesse modo. Legenda (`MapaLegenda.jsx` e o painel) com "Descanso / Pronto / Passou do ponto (estimado)" e a nota do tom |
| Detalhe do pasto | `PainelForragemArea.jsx`: "Pronto (estimado) · lote saiu há 32 dias · descanso da cultura 30 dias"; "Em pastejo" com lote no pasto |
| Culturas (tela) | campo **"Dias de descanso"** no formulário (1..365, inteiro) e coluna na grade (ordena pelo número) |
| Dados | passo guardado das 11 culturas da fazenda (runbook §4b), fora do repositório: `aplicar223.sql` / `backfill223.sql` no rascunho da sessão |

## 2. De onde vem a data da saída do último lote

Fonte: **o ledger do rebanho** (R2E), não a Movimentação legada nem o `status_ocupacao` da área.

```sql
-- medicaoForragemRepository.ocupacaoPorPasto(cliente, empresa)
WITH por_dia AS (                      -- partidas ATIVAS por pasto e dia operacional
  SELECT p.area_id, pr.data_operacional AS dia, SUM(pr.delta)::int AS delta
    FROM "PartidaRebanho" pr JOIN "PosicaoRebanho" p ON (tenant, empresa, posicao)
   WHERE tenant/empresa AND pr.ativa
   GROUP BY p.area_id, pr.data_operacional
), saldos AS (                          -- saldo acumulado do pasto no fim de cada dia
  SELECT area_id, dia, SUM(delta) OVER (PARTITION BY area_id ORDER BY dia) AS saldo FROM por_dia
)
SELECT area_id, (último saldo) AS saldo, MAX(dia) FILTER (WHERE saldo <= 0) AS ultima_saida
  FROM saldos GROUP BY area_id
```

- saldo final > 0 → **ocupado agora** → "Em pastejo", sem estimativa;
- saldo final ≤ 0 → **última saída** = o último dia em que o saldo acumulado do pasto chegou a 0;
- pasto sem nenhuma partida → **desconhecido** → sem estimativa.

**Ressalvas.** (a) Fazenda que ainda não ativou o ledger, ou pasto cujo histórico é anterior à virada
para o ledger, não tem partida: sem estimativa até a próxima movimentação. (b) É a saída do **último
lote** do pasto (saldo zerado), não a de cada lote. (c) Partida estornada (`ativa = false`) não conta;
partida retroativa muda a data — o farol acompanha na próxima leitura. (d) Os dias contam no dia civil
da fazenda (fuso da Empresa), como a validade das medições.

## 3. A regra

D = dias de descanso da cultura do pasto; `dias` = dias desde a última saída.

| Condição | Situação estimada |
|---|---|
| `dias < D` | Descanso |
| `D ≤ dias ≤ arredondar(D × 1,5)` | Pronto |
| `dias > arredondar(D × 1,5)` | Passou do ponto |
| sem cultura, sem D, saída desconhecida ou no futuro | sem estimativa |

Nunca **Rapado** por estimativa. Prioridade: medição válida (≤ 15 dias, com situação) → estimativa →
o farol de antes (cinza "sem medição recente" / neutro "nunca medido").

## 4. Validação local

`RESULTADOS_DA_VALIDACAO`

## 5. Pendências e notas

- Migration e passo de dados **pendentes** de GO do proprietário (runbook §3 e §4b), antes do merge.
- Fora do escopo: descanso variável por estação, lotação e dias de pastejo pela forragem, alerta de pasto passado.
