# MAIKE — Fechamento do consumo: peso médio do período e sobra antiga primeiro no custo (D-PROD-212)

**Data:** 2026-11-16 · **Decisão:** [D-PROD-212](./DECISIONS.md) · **Branch:** `claude/kind-knuth-tztu1v` · **Migration:** nenhuma

## 1. O que o proprietário pediu

Os refinamentos 1 e 2 do fechamento do consumo (D-PROD-206), explicados com o exemplo do COCHO 01 (100 garrotes, PROTEINADO 0,3% PV, notas a R$ 3,00 e R$ 3,50):

1. **Peso médio do período** no esperado do fechamento — "o gado não fica mais de 10 dias sem produto… mas em alguns lugares a pessoa acaba ficando 30 dias".
2. **A sobra antiga sai primeiro** no custo — "pode sair primeiro… essa questão da sobra depois a gente vai ter que ajustar".

O cocho compartilhado ficou para depois (o proprietário vai trazer ideias).

## 2. O que mudou

### 2.1 Peso médio do período (base %PV)
- `src/domain/rebanho/ganhoPelaCurva.js` (novo): `ganhoNoPeriodo` — a mesma regra do servidor (`backend/src/modules/rebanhoLedger/pesoProjetado.js`, D-PROD-198): soma o GMD do mês de cada dia em (de, ate]. Mês sem GMD → `null` (não inventa). `curvaDaProjecaoDePeso` monta a curva mensal a partir da projeção de peso da posição (peso de hoje + peso no fim dos 12 meses seguintes).
- Lançamento (`FormularioLancamentoSuplementacao.jsx`): cada lote grava `gmd_mensal_kg` quando o peso usado é o projetado (posição com projeção dos 12 meses e categoria com curva); senão `null`.
- Fechamento (`pesoMedioDoPeriodo` em `src/domain/suplementacao/fechamentoConsumo.js`): por lote que consome, peso médio = peso do lançamento + ganho do período ÷ 2; esperado do lote × peso médio ÷ peso; o esperado do fechamento escala o esperado do lançamento pela mesma razão. Sem curva/peso/lotes/data → o peso do lançamento, `peso_medio_periodo_aproximado: true` e o motivo.
- O esperado do lançamento (`consumo_esperado_pv_kg`, taxa do nível do cocho) não é regravado. Na base G_CAB_DIA a meta não muda; o peso médio só entra no %PV informativo.

### 2.2 Sobra antiga primeiro no custo
- `camadasDaSobraHerdada`: camadas de custo da sobra herdada (as do fechamento anterior do mesmo cocho, em proporção aos kg herdados; senão o custo/kg do lançamento anterior; senão o do lançamento atual, aproximado).
- `custoDoConsumoComSobraPrimeiro`: consome as camadas herdadas na ordem e depois o fornecido; o que sobra vira `sobra_final_camadas`.
- Serviço (`prepararFechamentoPeriodo`): `sobraHerdadaDoEvento` acha o evento fechado mais recente do mesmo cocho antes deste (só leitura; erro de leitura não impede o fechamento).

### 2.3 Correção: o servidor recusava o PATCH do fechamento
O PATCH de `SuplementacaoEvento` aceitava só `sobra_kg`, `dias_periodo` e `consumo_diario_grupo_kg` (R2A, D-PROD-99). Desde a D-PROD-206 o fechamento manda também o farol, o %PV e o custo — inclusive texto e booleano —, e o servidor recusava o PATCH inteiro (`REGISTRO_OPERACIONAL_IMUTAVEL`); a tela mostrava "Falha ao fechar o período anterior, mas o lançamento foi salvo." e o período ficava aberto. Os testes do front usavam a API simulada e não pegaram. Agora:
- `backend/src/modules/suplementacaoEventos/camposFechamentoEvento.js` (novo, puro): a lista fechada com os campos do fechamento do consumo e o tipo de cada um (`exigirTiposDoFechamento`).
- O teste do front `FR-4` confere que **todo** campo do patch do fechamento e da reabertura está na lista do servidor e passa pela conferência de tipos — a lista não volta a divergir em silêncio.

### 2.4 Tela
`FarolConsumo.jsx`: a célula **Peso médio do período** (com "aproximado: motivo") e a linha **Sobra antiga primeiro: X kg a R$ Y/kg** (com "custo da sobra aproximado").

## 3. Exemplos que viraram teste

| Caso | Antes | Agora |
|---|---|---|
| 100 cab, 0,3% PV, 306 → 312 kg em 10 dias, 95 kg/dia | esperado 91,8 kg/dia, 103,5% | peso médio 309, esperado 92,7 kg/dia, **102,5%** |
| 100 kg herdados a R$ 3,00 + 900 kg a R$ 3,50, sobra 50 | R$ 3.325,00 | **R$ 3.275,00**, R$ 3,28/cab/dia |

## 4. Testes

- `tests/smoke/fechamentoRefinamentos.test.jsx` (novo, 18): FR-1 curva = a do servidor e a curva da projeção; FR-2 peso médio (exemplo, sem curva, sem peso, quem não consome, base G, esperado do lançamento intacto); FR-3 custo (exemplo, sobra maior que o consumo, evento antigo, sem custo); FR-4 lista do servidor × patch do fechamento e da reabertura, tipos recusados; FR-5 serviço acha as camadas do fechamento anterior (e o custo anterior; e sem rede → aproximado); FR-6 tela.
- `tests/smoke/suplementacaoLancamentoBase.test.jsx`: SB-1 (sem curva gravada) e SB-1b (o lote com projeção grava a curva).
- `tests/smoke/fechamentoConsumo.test.jsx` e `tests/smoke/suplementacaoServices.test.js`: patches com os campos novos.
- `backend/tests/movimentacaoCancelamentoR2A.test.mjs`: o PATCH do fechamento do consumo passa e grava; a reabertura passa; tipos errados → 400 com o campo; esperado do lançamento continua imutável.

## 5. Verificação

(ver §5 preenchido abaixo)

## 6. Fora do escopo

- Cocho compartilhado (o proprietário vai trazer ideias).
- O ajuste futuro da regra da sobra.
- Períodos que ficaram abertos em produção enquanto o servidor recusava o PATCH do fechamento: o próximo abastecimento de cada cocho fecha o período aberto mais recente; um período mais antigo que tenha ficado aberto precisa ser conferido à parte.
