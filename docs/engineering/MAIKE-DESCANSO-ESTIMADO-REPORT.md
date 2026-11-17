# MAIKE-DESCANSO-ESTIMADO — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-223](./DECISIONS.md) ·
Runbook: [`MAIKE-DESCANSO-ESTIMADO-RUNBOOK-RELEASE.md`](./MAIKE-DESCANSO-ESTIMADO-RUNBOOK-RELEASE.md)

Quarto passo do Manejo de Pastagens: depois do Cadastro de Culturas (D-PROD-215), da Área ligada à
Cultura (D-PROD-216), da Medição de Forragem (D-PROD-219) e do farol no mapa (D-PROD-221), o pasto
sem medição recente ganha um farol **estimado** pelos dias de descanso. Na mesma missão (ampliação
pedida pelo proprietário antes de qualquer aplicação), cada pasto pode ter **parâmetros próprios**
(alturas de entrada e de saída e dias de descanso), para os piquetes mais fracos que a cultura em geral.

> **Numeração:** a D-PROD-222 está reservada pela branch `claude/design-filters-implementation-agzxk8`
> (outra sessão, aberta). Esta é a D-PROD-223; a próxima livre é a D-PROD-224.

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | migration **EXPAND** `20261117300000_descanso_e_alturas_por_area`: `CADCULTURAS.dias_descanso INTEGER` e, em `AreaPastagem`, `altura_entrada_cm`/`altura_saida_cm DECIMAL(6,1)` e `dias_descanso INTEGER` — anuláveis, sem DEFAULT e **sem CHECK** (seção 5). SHA-256 `c391e4b0c28dbefdafa8d0819d948efde952bf8ee5adc20ff58aa930239b477e`, pinado em `MIGRATIONS_APROVADAS`; `COLUNAS_EXIGIDAS` do preflight com as 4. 66 → 67 migrations, 96 tabelas |
| API `/culturas` | `dias_descanso` no corpo e na resposta; inteiro (ou texto só com dígitos) de **1 a 365**, vazio = `null`; fora disso 400 (`dias_descanso_invalido` / `dias_descanso_fora_da_faixa`); a rota recusa a coerção do Fastify como nas alturas. A lista de referência grava os dias (Marandu 30, Xaraés 30, Piatã 30, Paiaguás 28, Decumbens 25, Humidicola 25, Mombaça 35, Tanzânia 32, Zuri 35, Massai 28, Tifton 85 25) |
| API `/areas-pastagem` | a `cultura` embutida (D-PROD-216) traz `altura_entrada_cm`, `altura_saida_cm` e `dias_descanso`; a área lê e grava os 3 parâmetros próprios (POST/PATCH com as mesmas regras da cultura: alturas pt-BR > 0 e até 1000 cm com 1 casa, saída < entrada com as duas do pasto — a nova ou a gravada —, dias 1..365; booleano/objeto barrados antes da coerção) |
| API `/medicoes-forragem/descanso` | `GET ?empresa_id=` (autenticado; fazenda conferida no tenant; R11): por pasto, `{ area_id, ocupada, ultima_saida }` pelo ledger do rebanho (seção 2). A consulta mora no módulo do ledger (`rebanhoLedger/rebanhoLedgerOcupacaoPasto.js`, só leitura): só ele toca `PartidaRebanho` (`gate:rebanho-ssot`, D-PROD-107) |
| Domínio | `parametrosDoPasto(area, cultura)` (o do pasto, senão o da cultura, campo a campo, com a origem), igual no servidor (`medicaoForragemCalculo.js`) e na tela (`medicaoForragem.js`), com teste de paridade; `situacaoPelaAltura` sem situação quando a saída ≥ entrada. `src/domain/pastagem/farolForragem.js`: `estimarSituacaoPorDescanso` (regra pura), `estimativaDoPasto` (dias que valem para o pasto; "Em pastejo", "Sem estimativa", "<Situação> (estimado)"), `farolQueVale` (medição válida vence) e `farolForragemComEstimativaPorArea`; `corEstimada` = mesma cor, tom 0,7 (o "no olho" é 0,45). `src/domain/pastagem/parametrosManejo.js`: leituras puras das alturas e dos dias (reexportadas pelo serviço de Culturas) |
| Medição de Forragem | o servidor grava o retrato `altura_entrada_cm`/`altura_saida_cm` e calcula a situação pelas alturas que valem para o pasto (com cultura ou só com as próprias); o cabeçalho do formulário mostra as alturas e "(do pasto)" quando são próprias |
| Mapa | `MapaGeral.jsx` carrega `descansoPastos` (cache do mapa, só com o modo "Forragem") e pinta pelo farol que vale; o refresh do mapa o recarrega nesse modo. Legenda (`MapaLegenda.jsx` e o painel) com "Descanso / Pronto / Passou do ponto (estimado)" e a nota do tom |
| Detalhe do pasto | `PainelForragemArea.jsx`: "Pronto (estimado) · lote saiu há 32 dias · descanso da cultura 30 dias" (ou "do pasto"); "Em pastejo" com lote no pasto; linha dos parâmetros com a origem ("entrada 25 cm (da cultura) · saída 12 cm (do pasto) · descanso 40 dias (do pasto)") |
| Área (tela) | `FormularioArea.jsx`, só em Pastagem/Agricultura: seção "Parâmetros do pasto (opcional — vazio usa os da cultura)" com os 3 campos e os valores da cultura como dica e placeholder; validação na tela; nos outros usos os 3 vão nulos |
| Culturas (tela) | campo **"Dias de descanso"** no formulário (1..365, inteiro) e coluna na grade (ordena pelo número) |
| Dados | passo guardado das 11 culturas da fazenda (runbook §4b), fora do repositório: `aplicar223.sql` / `backfill223.sql` no rascunho da sessão |

## 2. De onde vem a data da saída do último lote

Fonte: **o ledger do rebanho** (R2E), não a Movimentação legada nem o `status_ocupacao` da área.

```sql
-- rebanhoLedgerOcupacaoPasto.ocupacaoPorPasto(cliente, empresa)
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

D = dias de descanso que valem para o pasto; `dias` = dias desde a última saída.

| Condição | Situação estimada |
|---|---|
| `dias < D` | Descanso |
| `D ≤ dias ≤ arredondar(D × 1,5)` | Pronto |
| `dias > arredondar(D × 1,5)` | Passou do ponto |
| sem cultura, sem D, saída desconhecida ou no futuro | sem estimativa |

Nunca **Rapado** por estimativa. Prioridade: medição válida (≤ 15 dias, com situação) → estimativa →
o farol de antes (cinza "sem medição recente" / neutro "nunca medido").

D (os dias de descanso que valem) = os do pasto, senão os da cultura.

## 4. Validação local

`RESULTADOS_DA_VALIDACAO`

## 5. Sem CHECK no banco (desvio do pedido, registrado)

O pedido de ampliação previa CHECKs nas 3 colunas de `AreaPastagem` espelhando os da `CADCULTURAS`.
A allowlist EXPAND do ferramental de release (`scripts/deploy/premergeMigrateLib.mjs`) recusa CHECK
em tabela antiga (teste B35b o prova): com eles a migration seria **CONTRACT**, com entrada própria em
`MIGRATIONS_CONTRACT_APROVADAS`, guarda, `MIGRATION_CONTRACT_AUTORIZADO` e a sequência de runners "no
dia de cada uma" dos testes de migration refeita. A missão manteve o EXPAND (como já fazia com
`CADCULTURAS.dias_descanso`) e pôs as mesmas faixas na API, com testes (AP-02, AP-03). Se o
proprietário quiser a barreira também no banco, é uma CONTRACT aditiva própria, depois.

## 6. Pendências e notas

- Migration e passo de dados **pendentes** de GO do proprietário (runbook §3 e §4b), antes do merge.
- Fora do escopo: descanso variável por estação, lotação e dias de pastejo pela forragem, alerta de pasto passado.
