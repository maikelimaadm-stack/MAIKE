# MAIKE — Base técnica de produtividade: pecuária a pasto e lavoura (D-PROD-154)

**O que é:** a referência de negócio do eixo de produtividade. Diz o que a fazenda
precisa medir, com que fórmula, em que frequência e contra qual meta — e traduz
isso em entidades, cálculos e ordem de fatias **neste repositório**.

**Origem:** pesquisa técnica externa (Embrapa, CNA/Cepea, Imea, Rally da Pecuária,
ASABE) cruzada com o inventário do próprio repositório, em 2026-11-08. Toda fonte
está listada no fim.

**Fica fora:** financeiro transacional (lançamento, caixa/banco, tributo, NF-e,
contas a pagar/receber), animal individual e SISBOV, e qualquer alteração de
código. Este documento **não implementa nada**: cada fatia tem a sua própria
decisão e o seu próprio relatório.

**Como usar:** é a fonte dos números de negócio das fatias do eixo. Faixa de
altura, meta de GMD, benchmark de custo e nível de degradação entram no sistema
como **parâmetro do cliente**, nunca escritos no código — as faixas daqui são o
*seed* inicial, a calibrar com o técnico e com os dados da fazenda.

**Regra de escopo:** `config/mapa-manejo-scope.json` exige bijeção entre
`allowedPages` e `src/pages.config.js`, então **não há pré-liberação**: cada fatia
altera o manifesto na mesma PR em que cria a sua tela. Os models Prisma novos não
passam pelo `gate:product-scope` (que trata dos schemas legados em
`base44/entities/`) — passam por `gate:tenancy` e `gate:indices`.

---

## Resumo executivo

Fazenda que não produz quase nunca sofre de falta de tecnologia: sofre de pasto sem meta de altura, solo sem reposição de nutriente e ganho de peso que ninguém mede. A média brasileira em 2025 foi de 5,15 @/ha/ano; Mato Grosso ficou em ~7,7 @/ha; os produtores do Rally da Pecuária chegaram a 12,88 @/ha e os 25% melhores a 22,6 @/ha. Sair de 3–5 para 10–15 @/ha é manejo, não milagre.

Produtividade tem só duas alavancas, e ambas precisam de dado:

```
@/ha/ano  =  lotação (UA/ha)  ×  desempenho individual (GMD)
```

As cinco alavancas que decidem o resultado, e o que o sistema precisa medir em cada uma:

| Alavanca | Decisão que ela gera | O que o sistema mede |
| --- | --- | --- |
| Altura do pasto | Entrar, sair, aumentar ou baixar lotação | Altura média por piquete, semanal, vs. faixa do capim |
| Lotação | Quantos animais cabem em cada piquete | UA/ha por piquete, saldo forrageiro mensal |
| Fertilidade | Onde adubar, onde recuperar, onde fazer ILP | V%, P, K por gleba; kg N/ha; kg PV/kg N |
| Desempenho animal | Qual lote investigar, qual suplemento paga | GMD por lote a cada 30–60 d, consumo g/kg PV |
| Custo por área e por arroba | O que cortar, o que intensificar | COE/COT por centro de custo, custo/@, R$/h de máquina |

O sistema que serve a isso gira em torno de **quatro entidades**: pasto/piquete, lote, ordem de serviço e máquina. Todo o resto pendura nelas. E de **três números semanais**: altura do pasto, GMD por lote, custo por hectare.

A lacuna do mercado é exatamente essa: os softwares de grãos tratam bem talhão e operação, os de pecuária tratam bem animal e lote, e quase nenhum liga altura, lotação, adubação e GMD no mesmo piquete. É aí que o produto tem espaço.

## Diagnóstico: por que a fazenda não produz

A causa número um de lote que perde peso é a relação entre lotação e oferta de forragem. Pasto abaixo da altura de saída (Marandu abaixo de 20 cm, Mombaça abaixo de 45 cm) derruba o tamanho do bocado e o consumo cai, mesmo com capim verde na frente do animal.

As causas, em ordem de impacto, e o dado que prova cada uma:

| Causa | Dado que comprova | Frequência |
| --- | --- | --- |
| Lotação excessiva (superpastejo) | Altura medida vs. meta do capim | Semanal |
| Capim passado (subpastejo) | Altura acima da máxima, % de colmo | Semanal |
| Pasto degradado | Nota 1–4, % de cobertura, NDVI/EVI | Semestral |
| Solo sem correção | Análise: V%, P, K, S, Al, MO | 2–3 anos por gleba |
| Lotação desajustada ao ano | Balanço forrageiro, UA/ha por piquete | Mensal |
| Suplementação ausente ou desigual | GMD por época, consumo g/kg PV | 30–60 d / semanal |
| Água e sombra | Distância e vazão do bebedouro | Cadastro + ronda |
| Verminose e carrapato | Mortalidade por causa, OPG | Evento / trimestral |
| Mistura de categorias no lote | CV do peso dentro do lote | Cada pesagem |
| Reprodução fraca | Prenhez, desmame, IEP | Anual |

Sobre os **capins velhos e sem adubação**: invasora é sintoma, não doença. Capim que não recebe nutriente perde vigor, abre espaço, e aí entra folha larga e cupim. Roçar e passar herbicida sem corrigir fertilidade e sem respeitar altura de resíduo resolve por uma estação e volta.

### Como separar as causas com dado

Pesagem por lote a cada 30–60 dias, cruzada com a altura do piquete e o histórico de ocupação, resolve o "uns ganham e outros perdem". O painel que faz isso mostra, lado a lado por lote:

1. GMD e intervalo entre pesagens
2. Piquetes ocupados, com altura de entrada e de saída
3. UA/ha e oferta de forragem
4. Suplemento fornecido em g/kg PV vs. meta
5. Eventos sanitários e de manejo no período
6. CV do peso dentro do lote

**Fórmulas de referência:**

```
GMD          = (peso final - peso inicial) / dias      [só animais pareados]
UA           = peso vivo / 450
@/ha         = kg PV produzidos × rendimento de carcaça / 15 / ha útil
kg PV/ha     = Σ(saída - entrada + nascimentos - mortes) / ha útil
Oferta (%PV) = [massa kg MS/ha × área / dias] / (PV total / 100)
```

**Gatilhos de investigação que o sistema deve disparar sozinho:**

- GMD abaixo de 0,30 kg/dia nas águas, ou ganho negativo sem justificativa
- CV de peso acima de 15–20% no lote, que indica mistura de categorias
- Altura fora da faixa em mais de 20% dos piquetes medidos
- Consumo de suplemento desviando mais de 20% da meta

## Pastagem: as regras que o sistema precisa embutir

O manejo de pasto no Brasil tem número fechado: cada capim tem altura de entrada e de saída. Essa tabela é a tabela mais importante do sistema, porque ela transforma uma medição de régua em decisão automática.

### Altura de manejo por cultivar

Fonte: [Régua de manejo de pastagens, Embrapa (2017)](https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1077406/1/Reguademanejodepastagens.pdf) e [Embrapa Gado de Corte via Semadesc-MS](https://www.semadesc.ms.gov.br/artigo-manejo-de-pastos-de-brachiaria-brizantha/).

| Cultivar | Contínuo máx–mín (cm) | Rotacionado entrada / saída (cm) |
| --- | --- | --- |
| Marandu | 35–20 (meta 30 ± 5) | 30–35 / 15–20 |
| BRS Piatã | 40–20 | 40 / 20 |
| Xaraés | 40–20 | 30–35 / 15–20 |
| BRS Paiaguás | 35–20 | 35–40 / 20 |
| B. decumbens | 30–15 | — |
| B. humidicola Tupi | 20–10 | — |
| Mombaça | — | 85–90 / 40–45 |
| BRS Zuri | — | 70–80 / 35–40 |
| Tanzânia | — | 70 / 35 |
| BRS Quênia | — | 65 / 35 |
| Massai | — | 55 / 30 |
| BRS Tamani | — | 50 / 25 |
| Capim-elefante | — | 100–120 / 50 |

A regra operacional da régua é simples: **na altura máxima, aumentar a lotação; na mínima, reduzir ou dar descanso.** Em lotação contínua a 30 cm, Marandu, Xaraés e Piatã entregam 765, 760 e 650 g/dia de ganho (Embrapa Gado de Corte).

**Amostragem que o app deve exigir:** 30 pontos até 5 ha, 40 até 10 ha, 50 ou mais acima disso. O sistema calcula média, desvio e % de pontos fora da faixa — não aceita uma leitura única como altura do piquete.

### Lotação e número de piquetes

| Item | Contínua | Rotacionada | Intensiva |
| --- | --- | --- | --- |
| Ocupação | contínua | 1–7 dias | 1 dia |
| Descanso | — | pela altura; Marandu 28–35 d | idem |
| Nº de piquetes | 1 | descanso/ocupação + 1 | ex.: 30/1 + 1 = 31 |
| Área/animal/dia | — | Mombaça e Zuri 120 m²; Marandu e Piatã 200 m² | — |
| N (kg/ha/ano) | 0–100 | ≥ 100 | 150–300 |
| UA/ha águas | 1–2 | 2,5–4 | 4–6 |
| UA/ha seca | 0,5–1 | ~0,9 em Marandu | depende de diferido |

```
UA possível = (massa entre entrada e saída × área × eficiência) / (10 kg MS/UA/dia × dias)
               eficiência de pastejo: 50–80%
Nº piquetes = (dias de descanso / dias de ocupação) + 1
```

### Diferimento para a seca

Isto resolve metade do problema de perda de peso na seca, e custa quase nada. [Embrapa Gado de Corte](https://www.embrapa.br/en/busca-de-noticias/-/noticia/17936416/o-pasto-para-uso-na-seca-deve-ser-reservado-no-final-do-verao):

- Vedar **40% da área no início de fevereiro** (uso de maio a julho) e **60% no início de março** (uso de agosto a outubro).
- Necessidade: 20 kg MS/UA/dia × 150 dias = 3.000 kg MS/UA. Meta de ~4 t MS/ha no início da seca.
- Rebaixar a 10–20 cm antes de vedar.
- Usar Marandu e Piatã. **Não diferir Xaraés**, que floresce em maio.
- O diferido vedado em fevereiro tem apenas 5,8–6,4% de PB: sem proteinado, o animal perde peso mesmo com capim disponível.

### Análise de solo e adubação

**Coleta:** 0–20 cm de rotina, 20–40 cm para decisão de gesso, 0–10 cm em pasto antigo; 15–20 subamostras por gleba.

```
S  = Ca + Mg + K
T  = S + (H+Al)
V% = 100 × S / T
m% = 100 × Al / (S + Al)
NC (t/ha) = (V2 - V1) × T / PRNT
```

| Grupo de capim | V2 alvo |
| --- | --- |
| Pouco exigentes (humidicola, decumbens) | 30–35% |
| B. brizantha (Marandu, Piatã, Xaraés) | 40–45% |
| Panicum (Mombaça, Zuri), Cynodon | 50–60% |

**Fósforo** ([Embrapa](https://www.embrapa.br/documents/1354377/1743400/Adubacao+de+Pastagens.pdf/4c4ad52e-4c49-4804-adc3-f7dd0f7107ce?version=1.0)): P abaixo de 10 mg/dm³ → 80–100 kg P₂O₅/ha; 10–20 → 40–50; 20–30 → 20; acima de 30 → não aplicar. Manutenção: 20–60 kg P₂O₅/ha.

**Nitrogênio** — o ponto que resolve "capim velho faltando adubação":

- Dose = forragem extra desejada ÷ eficiência. Ex.: 12.500 kg MS ÷ 50 = 250 kg N/ha/ano, em 5 doses de 50.
- Regra prática: ~50 kg N por UA adicional que se quer carregar.
- Resposta: 40–50 kg MS por kg de N; 2,4–4,0 kg de peso vivo por kg de N ([Embrapa Cerrados Doc 192](https://www.infoteca.cnptia.embrapa.br/bitstream/doc/215338/1/doc192.pdf)).
- Eficiência cai acima de 300–400 kg N/ha/ano. Dose mínima por aplicação acima de 30 kg N.
- Época: início das águas (out/nov) até fev/mar, logo após a saída dos animais do piquete.
- K₂O ≈ 0,5–0,8 × N quando o K do solo é médio ou baixo.

**A conta do adubo** (com ureia a 16–20 @/t e a arroba em ~R$ 390): 1 kg de N custa R$ 13,6–17,0 e devolve 2,4–3,5 kg de PV, que valem ~R$ 13/kg — algo entre R$ 1,90 e R$ 3,30 por real investido. **Só se a lotação subir junto.** Adubar sem colocar animal para comer o capim extra é jogar dinheiro no pasto.

### Recuperar, renovar ou reformar

Definições da Embrapa: recuperação mantém a forrageira; renovação troca a forrageira; reforma envolve preparo do solo. Pela cartilha de degradação de Moacyr Dias-Filho, a renovação custa em média até três vezes o da recuperação direta.

| Nível de degradação | Quadro no campo | Rota |
| --- | --- | --- |
| 1 — leve | queda de vigor | ajuste de manejo + adubação |
| 2 — moderado | cobertura 50–75%, invasoras começando | recuperação direta |
| 3 — forte | folha larga, início de erosão | renovação ou ILP |
| 4 — muito forte | solo descoberto, cupim, erosão | renovação direta ou indireta |

| Rota | R$/ha | Fonte |
| --- | --- | --- |
| Manutenção (Cerrado) | ~273 | [FGV Bioeconomia](https://portal.fgv.br/en/news/restoration-degraded-pastureland-would-cost-r383-billion-reveals-study-bioeconomy-observatory) |
| Recuperação (Brasil Central) | 630–800 | [Corteva](https://www.corteva.com/br/coeficiente-agro/artigos/integracao-lavoura-pecuaria-lucre-com-sustentabilidade.html) |
| Recuperação, degradação moderada | 1.159,62 | FGV |
| Degradação severa | 1.727,99 | FGV |
| Reforma usual | 2.481,52 | [Pasto Extraordinário](https://www.pastoextraordinario.com.br/custos-de-reforma-e-recuperacao-de-pastagem.html) |
| Reforma de alta tecnologia | 2.982–3.175 | Corteva / Scot |
| ILP | US$ 900–1.200 (antes da receita de grãos) | Embrapa Cerrados |

**Critério de decisão que o sistema pode calcular:** cobertura acima de 50% com problema de fertilidade → recuperar; cobertura abaixo de 50% com invasora e erosão → renovar; área mecanizável → ILP. Falhas maiores que 2 m² sem a forrageira de interesse indicam reforma. A Embrapa propõe recuperação gradual de 10–20% da área por ano — não tudo de uma vez.

**A conta que vende a decisão:** recuperar por R$ 1.160/ha e sair de 4 para 10 @/ha gera +6 @ × ~R$ 380 ≈ R$ 2.280/ha/ano de receita adicional. Payback de 1–2 anos.

### ILP: a lavoura paga a reforma

O sistema Santa Fé (Embrapa) consorcia milho ou sorgo com braquiária usando subdose de nicosulfuron: perda no milho abaixo de 3%. Em soja a perda é significativa, por isso o caminho é milho safrinha + braquiária. Casos documentados: Fazenda Pontal com ~3 UA/ha e 18,5 @/ha; unidade da Embrapa com 777 kg PV/ha contra 145 kg na testemunha. Caminho usual em MT: 1–2 safras de soja mais milho safrinha com braquiária, ou arrendamento com entrega de pasto formado — o calcário e o fósforo ficam no solo.

## Rebanho: desempenho, suplementação, sanidade

### GMD esperado — as metas que o sistema compara

| Categoria / época | Sem suplemento | Com suplemento |
| --- | --- | --- |
| Bezerro até ~210 d | 0,57–1,0 kg/d | creep feeding +0,1–0,2 |
| Recria, águas | 0,53–0,58 (sal mineral 0,54) | proteinado 1 g/kg PV: 0,77 |
| B. brizantha a 30 cm | 0,65–0,77 | — |
| Recria, seca | –0,1 a 0 | proteinado 0,3% PV: 0,24; 0,6% PV: 0,34 |
| Terminação, águas | 0,60–0,65 | 0,6% PV: 0,77; 1,2% PV: 0,89 |
| Semiconfinamento | — | 0,9–1,2 |
| Confinamento | — | 1,4–1,8 |

Repare na linha da seca: **sem suplemento, o animal de recria perde peso.** Isso já explica boa parte de "uns lotes perdem".

### Suplementação

| Tipo | Consumo | Composição | Quando |
| --- | --- | --- | --- |
| Sal mineral | 60–150 g/cab/dia | — | ano todo |
| Proteinado | 1 g/kg PV (1–3) | 30–40% PB, ureia | seca e transição |
| Proteico-energético | 2–4 g/kg PV | ~60% NDT | transição e águas |
| Concentrado | 5–8 g/kg PV | 20% PB, 80% NDT | terminação |
| Creep feeding | livre | 18–22% PB | bezerros 60–210 d |

```
Consumo real (g/kg PV) = kg fornecidos / dias / cabeças / peso médio × 1000
Custo do ganho extra   = R$ suplemento/cab/dia / (GMD suplementado - GMD testemunha)
```

O custo do ganho extra tem um teto claro: o kg de peso vivo vale ~R$ 13. Se o suplemento custa mais que isso por kg de ganho adicional, ele está destruindo margem. Um detalhe contraintuitivo ([RBZ](https://www.scielo.br/j/rbz/a/WhNdn3qLpmHQSj9Fc4DJbkj/?format=html&lang=pt)): na seca, 0,3% PV foi mais eficiente que 0,6% PV — o dobro de suplemento ganhou mais peso, mas com eficiência 39% menor.

### Indicadores de cria

| Indicador | Fórmula | Referência |
| --- | --- | --- |
| Prenhez | prenhes / expostas | ≥ 75% mínimo; 85–90% bom |
| Perda pré-parto | (prenhes – paridas) / prenhes | média 8,2%; meta ≤ 4% |
| Natalidade | nascidos / expostas | 65–70% no Brasil Central |
| Mortalidade de bezerros | mortos / nascidos | 3,0% |
| Desmame | desmamados / expostas | média 74,8%; melhores 78,3% |
| kg desmamados / vaca exposta | — | 162 kg |
| IEP | parto n – parto n-1 | meta 365 d |
| Idade ao 1º parto | — | 24–36 meses |
| Descarte de matrizes | — | 15–20% / ano |

Estação de monta de 90 dias (nov–jan em MT), IATF com repasse por touro (prenhez por IATF de ~50–57%), diagnóstico de gestação por ultrassom em 30–60 dias. O sistema precisa analisar resultado **por lote, por protocolo, por touro e por inseminador** — sem isso não se sabe o que corrigir.

### Recria e engorda

Curva para abate aos 24 meses com ~20 @: desmama com 180–210 kg, primeira seca a +0,3–0,4 kg/d, águas a +0,6 kg/d, terminação intensiva. Em MT, 45% dos bovinos abatidos no primeiro semestre de 2026 tinham até 24 meses — recorde da série do Imea; os abates acima de 36 meses caíram de 65% para 22%. Abate com 18–21 @ e rendimento de carcaça de 50–54%.

```
Desfrute = (vendas - compras ± Δestoque) / rebanho médio      [referência: 20-25%; eficientes 30%+]
```

### Sanidade e obrigações em MT (2026)

| Item | Status |
| --- | --- |
| Aftosa | **Sem vacinação.** MT parou em 2023; OMSA reconheceu o Brasil livre sem vacinação em 29/05/2025. Vacina proibida |
| Brucelose B19 | **Obrigatória** em fêmeas de 3–8 meses, por veterinário cadastrado no [Indea-MT](https://www.indea.mt.gov.br/en/-/6319399-brucelose). Etapas 1/jan–30/jun e 1/jul–31/dez; comunicação até o 2º dia útil do mês seguinte. Multa de 1 UPF/MT por animal; propriedade irregular fica bloqueada para trânsito |
| Raiva | Obrigatória onde há foco ou portaria; primovacinação + reforço em 30 d, depois anual |
| Clostridioses | Recomendada: 2 doses em bezerros, depois anual |
| IBR / BVD / lepto | Cria, antes da estação de monta |
| Vermifugação | Estratégica na seca para jovens (maio/julho/setembro), guiada por OPG |
| Carrapato / mosca | Por infestação, com rodízio de princípio ativo |
| GTA | Obrigatória para todo trânsito; exige brucelose em dia e saldo compatível |
| SISBOV | Voluntário (exportação UE). Com o fim da vacinação contra aftosa, a rastreabilidade individual tende a ser cada vez mais exigida — vale identificar individualmente desde já |

O sistema precisa **conciliar o rebanho interno com o saldo oficial no Indea** e avisar de vencimentos de etapa antes do prazo. Isso é risco de bloqueio de trânsito, não detalhe.

### Pesagem: onde quase todo mundo erra

- **Frequência:** 28–60 dias na recria e engorda; na cria, na desmama, na estação de monta e no descarte. No mínimo na virada de cada estação.
- **Amostral:** só em lote homogêneo, com 10–15% do lote (mínimo de 20–30 animais) e **sempre os mesmos animais**.
- Mesmo horário e mesmo jejum (ideal 12–16 h de sólidos). Intervalo abaixo de 28 dias gera GMD ruidoso por variação de enchimento.
- **Erros que invalidam o dado:** misturar lotes, não baixar mortes e vendas, pesar logo após o animal beber, brinco errado, comparar pesagem de manhã com pesagem de tarde.

No sistema: importação de balança e bastão (CSV ou Bluetooth), bloqueio de outlier (GMD individual fora de –0,5 a +2,0 kg/d cai em validação), curva de peso contra o alvo da categoria.

## Custo por área e resultado

### A metodologia que o mercado usa

Metodologia CNA/Cepea Campo Futuro e Imea. Tudo no sistema deve sair nesses três níveis, porque é com eles que se compara a fazenda com benchmark:

```
COE = desembolsos (suplemento, reposição, sanidade, insumo de pasto,
                   mão de obra, combustível, manutenção, impostos, arrendamento)
COT = COE + depreciações (benfeitoria, máquina, pastagem, reprodutor) + pró-labore
CT  = COT + custo de oportunidade do capital (rebanho, máquinas) e da terra
```

A leitura é direta: receita abaixo do COE é inviável; entre COE e COT descapitaliza; entre COT e CT não remunera o capital; acima do CT há lucro econômico.

### Custo da arroba em MT (referência para comparar)

| Sistema | COT 2º tri/2026 | COE |
| --- | --- | --- |
| Cria | R$ 295,79/@ | R$ 187,67/@ (3º tri/25) |
| Recria e engorda | R$ 369,55/@ | R$ 284,35/@ (3º tri/25), contra R$ 189,48 em 2024 |
| Ciclo completo | R$ 182,25/@ | R$ 124,58/@ (3º tri/25) |

Fonte: Imea, via [Portal DBO](https://portaldbo.com.br/pecuaria-de-corte-custo-operacional-total-avanca-em-todos-os-sistemas-de-producao-em-mt-no-2o-trim-26/) e [Agrolink](https://www.agrolink.com.br/noticias/custo-da-pecuaria-sobe-em-todos-os-sistemas-em-mato-grosso_516979.html). Confirme no Boletim do Boi do Imea antes de usar como meta oficial.

Dois fatos que mudam estratégia: na recria e engorda a **reposição é em média 74% do COE** (chegando a 84% em Pontes e Lacerda-MT) — a margem nasce na compra do bezerro, não na venda do boi. E em Juara-MT, na cria, o sal mineral respondeu por 18% e os insumos de pastagem por 17,1% do COE.

### Centros de custo: a espinha dorsal do sistema

A hierarquia que funciona em fazenda:

```
atividade (cria / recria / engorda / soja / milho / ILP / administração)
  └─ retiro
      └─ pasto ou talhão          ← centro fixo, custo por hectare
          └─ lote                 ← centro MÓVEL, acompanha o animal
máquina                            ← centro de serviço, rateia por hora
estrutura                          ← indireto
```

| Custo | Vai para | Critério |
| --- | --- | --- |
| Adubo, herbicida, semente | pasto ou talhão | direto pela OS |
| Suplemento, sanidade, sêmen | lote | saída de estoque |
| Custo do pasto | lote ocupante | UA × dias de ocupação |
| Máquina | área ou atividade | horas × custo/h |
| Mão de obra | atividade | horas, ou cabeças e área |
| Administração | atividades | % do COE ou área |

O ponto que a maioria dos sistemas erra: **o lote é um centro de custo móvel.** Ele passa por vários piquetes e precisa carregar o custo de cada um pelo tempo que ficou lá (UA × dias). Sem isso, não existe custo por arroba por lote.

### Resultado e ponto de equilíbrio

```
RB              = vendas + variação do inventário (valor final - inicial - compras)
Margem bruta    = RB - COE          (= Lajida)
Margem líquida  = RB - COT
Lucro           = RB - CT
@ produzidas    = estoque final - estoque inicial + vendas - compras   [em @]
Custo/@         = custo total / @ produzidas
Break-even @/ha = custo/ha / preço da @
```

Intensificar derruba o break-even, e esta é a conta mais importante do documento:

| Cenário | Custo/ha | Produção | Break-even |
| --- | --- | --- | --- |
| Extensivo | R$ 1.800 | 5 @/ha | R$ 360/@ |
| Intensificado | R$ 3.000 | 12 @/ha | R$ 250/@ |

Gasta-se 67% mais por hectare e o custo da arroba cai 30%. **Custo fixo só se dilui com arroba produzida** — a 3 @/ha nenhum preço salva a margem.

### Relações de troca (base out–nov/2026)

| Relação | Valor | Fonte |
| --- | --- | --- |
| Boi gordo SP | R$ 389,90/@ (30/10); média de outubro R$ 379,55, recorde real | [Cepea](https://www.noticiasagricolas.com.br/cotacoes/boi-gordo) |
| @ por bezerro | 9,16 | Cepea |
| Bezerros por boi (MT) | 2,13 em agosto, contra 2,29 um ano antes | Imea |
| Desmama nelore MT | R$ 3.477,58 = 9,51 @ | Scot, 06/11/2026 |
| Boi / milho MT | 8,02 sc/@ | Imea |
| Fertilizantes | MAP 14–18 @/t; ureia 16–20; KCl 10–14 | Itaú BBA |

Leitura prática: arroba alta com milho barato favorece suplementação energética e semiconfinamento. Com 9+ arrobas por bezerro, a recria e engorda fica apertada e a cria ou o ciclo completo ficam favorecidos.

### Orçamento e investimento

Ano-pecuário de out a set; safra de jul a jun. Sequência do orçamento: plano de rebanho mensal → plano forrageiro → insumos → máquinas (h × R$/h) → mão de obra → investimentos → receitas → fluxo de caixa mensal. Depois, **orçado contra realizado por centro de custo, todo mês**.

```
VPL     = Σ FCt / (1+i)^t - I0
Payback = I0 / fluxo anual
```

Aplicar a recuperação de pasto (vida útil 4–10 anos), cerca, água e confinamento, usando as arrobas adicionais **medidas**, não estimadas.

## Máquinas e frota

Máquina na fazenda quase nunca tem custo conhecido. O resultado é trator rodando a R$ 345/h achando que custa o diesel. A conta completa (metodologia ASABE, usada pela Embrapa e pela Unesp-FCAV):

| Componente | Fórmula | Parâmetro usual |
| --- | --- | --- |
| Depreciação | (P – S) / V | S = 10% de P; trator 10.000–12.000 h |
| Juros | [(P+S)/2] × i / h por ano | taxa do financiamento |
| Alojamento e seguro | P × 0,02 / h por ano | 2% a.a. |
| Combustível | cv × consumo específico × fator de carga × preço | 0,163 L/cv·h a plena carga |
| Lubrificantes | 15% do combustível | — |
| Reparos | P × fator / V | 100% de P na vida útil do trator |
| Operador | (salário + encargos) / h × 1,2 | — |

**O número que muda a decisão** — trator de 150 cv, P = R$ 600 mil, i = 10%, diesel a R$ 6,00, fator de carga 60% (cálculo com premissas, não dado publicado):

| Componente | 1.000 h/ano | 400 h/ano |
| --- | --- | --- |
| Depreciação | 45,0 | 45,0 |
| Juros | 33,0 | 82,5 |
| Alojamento e seguro | 12,0 | 30,0 |
| Combustível (14,7 L/h) | 88,0 | 88,0 |
| Lubrificantes | 13,2 | 13,2 |
| Reparos | 50,0 | 50,0 |
| Operador | 36,0 | 36,0 |
| **Total R$/h** | **~277** | **~345** |

A mesma máquina custa 25% mais por hora quando roda menos. **Máquina parada é custo fixo** — por isso o sistema precisa de um alerta de utilização abaixo de 400 h/ano, que é gatilho para vender, parar ou terceirizar.

### Rendimento e apontamento

```
CCE (ha/h) = largura (m) × velocidade (km/h) × eficiência de campo / 10
             eficiência de campo: 65-85%
Custo/ha   = custo/h / CCE
```

Campos obrigatórios no apontamento de máquina, dentro da OS: máquina, implemento, operador, operação, área, horímetro inicial e final, hectares feitos, litros abastecidos e paradas com motivo.

### Diesel por operação — a tabela de referência

| Operação | L/ha | L/h (150 cv) |
| --- | --- | --- |
| Aração | 25,7–29,4 | — |
| Grade pesada | 13,9 | 18–21 |
| Grade niveladora | 5,1–6,4 | — |
| Subsolagem | — | 21–23 |
| Semeadura | 4,7–11,6 | 13–16 |
| Pulverização | — | 7–10 |
| Colheita | ~17,5 | — |
| Soja em plantio direto (sistema) | ~22 | — |
| Preparo convencional completo | 45–60 | — |

Fontes: Embrapa Milho e Sorgo, ASABE D497, [FEBRAPDP](https://plantiodireto.com.br/artigos/465).

**Detecção de desvio e furto de diesel** — isto se paga sozinho no primeiro mês:

```
L/h real = litros entre dois tanques cheios / horas no período
Alerta se desviar mais de 15-20% da referência da operação
```

Cruzamentos que o sistema deve fazer automaticamente:

1. Saída do tanque contra abastecimentos lançados
2. Horímetro parado com abastecimento registrado
3. Abastecimento sem OS vinculada
4. L/ha por operador, comparando operadores na mesma operação

### Manutenção preventiva

Plano típico (seguir o manual do fabricante): checagem diária a cada 10 h; óleo e filtros a 250 h; filtros de combustível e ar a 500 h; hidráulico a 1.000 h; revisão a 2.000 h. O sistema dispara a OS de manutenção **por horímetro**, não por data.

Peças críticas em estoque com ponto de pedido = consumo × lead time + estoque de segurança.

### KPIs de frota

| KPI | Fórmula | Meta |
| --- | --- | --- |
| Disponibilidade mecânica | (h programadas – h em manutenção) / h programadas | ≥ 85–90% |
| Utilização | h por ano | alerta abaixo de 400 h |
| Custo de manutenção por hora | R$ manutenção / h rodadas | tendência |
| Custo/h real contra orçado | — | ±10% |
| L/h e L/ha | — | referência ±15% |
| MTBF | h entre falhas | crescente |

**Sem telemetria dá para fazer tudo isso:** foto do horímetro com GPS e hora, bomba de diesel com medidor, área pelo GPS do celular, parada com motivo escolhido de lista fechada. Isso já entrega custo/h e L/ha confiáveis — não precisa comprar hardware para começar.

## Lavoura e satélite

### Referências MT, safra 2025/26 (Imea)

| Indicador | Valor |
| --- | --- |
| Soja — custo total | R$ 7.657,89/ha (+7,69%) |
| Soja — ponto de equilíbrio sobre o COE | 52,49 sc/ha |
| Soja — produtividade projetada | 60,45 sc/ha |
| Soja — Lajida | R$ 1.103,03/ha (–43,76%) |
| Milho — produtividade | 126,27 sc/ha |

Fonte: Imea, via [Revista Cultivar](https://revistacultivar.com.br/noticias/custos-da-safra-2025-26-sobem-em-mato-grosso) e [Mato Grosso Econômico](https://matogrossoeconomico.com.br/agronegocio-mato-grosso/custo-da-soja-supera-r-4-mil-por-hectare-em-mato-grosso-aponta-o-imea/). A margem apertada da soja é justamente o que torna o ILP interessante: entrar na área degradada com milho safrinha e braquiária tem risco menor que apostar em soja de primeiro ano em pasto velho.

```
sc/ha    = kg a 14% de umidade / 60 / ha
Custo/sc = custo/ha / sc/ha
Margem/ha = preço × sc/ha - custo/ha
Gap      = produtividade do top 10% - produtividade real
```

### Planejamento de safra

- **ZARC/Mapa** por município, cultivar e tipo de solo — é condição para seguro e Proagro, então o sistema deve guardar a janela por talhão.
- Soja depois do vazio sanitário (setembro), com chuva regular. Milho safrinha em jan–fev, com risco crescente passado o fim de fevereiro.
- Cadastro por talhão: cultivar, população alvo e real, espaçamento, data, cultura antecessora.
- Rotação: soja → milho + braquiária → pasto por 1–3 anos → soja.
- Solo a 0–20 e 20–40 cm a cada 1–2 anos; foliar em R1–R2 na soja; grid de 1 amostra a cada 1–5 ha; taxa variável de calcário, gesso, P e K.

### MIP e ordem de serviço agrícola

Monitoramento semanal em pontos fixos com pano de batida. Níveis da Embrapa Soja: desfolha de 30% no vegetativo e 15% no reprodutivo; percevejos 2/m para grão e 1/m para semente. Rodiziar grupos IRAC, HRAC e FRAC para não criar resistência.

Campos da OS agrícola — e esta é a mesma estrutura da OS de pecuária, com outro destino:

| Campo | Observação |
| --- | --- |
| Data e hora | programada e executada |
| Talhão | com área trabalhada |
| Operação | lista fechada padronizada |
| Insumo | lote, dose, total aplicado |
| Calda | L/ha |
| Máquina e implemento | com horímetro inicial e final |
| Operador | precisa estar habilitado (NR-31) |
| Clima | pulverização: vento 3–10 km/h, UR acima de 55%, T abaixo de 30 °C |
| Receituário agronômico | obrigatório, anexado |
| Foto e GPS | evidência |

### Satélite: o que dá e o que não dá para fazer

| Fonte | Resolução | Revisita | Custo |
| --- | --- | --- | --- |
| Sentinel-2 | 10 m, com red-edge | ~5 dias | gratuito |
| Landsat 8/9 | 30 m | 16 dias | gratuito |
| Sentinel-1 (radar) | — | — | gratuito, atravessa nuvem |

| Índice | Para que serve | Limite |
| --- | --- | --- |
| NDVI | vigor da planta | satura em biomassa alta |
| NDRE | nitrogênio, sinal precoce | precisa do red-edge (Sentinel-2) |
| EVI | alta biomassa; o Lapig/UFG usa para degradação de pastagem | — |

Usos reais: falha de plantio, mancha de estresse, **direcionar o monitoramento a pé** e tendência de vigor por piquete. Limites honestos: nuvem de outubro a março em MT, piquete pequeno, saturação do NDVI em pasto alto. **NDVI não mede massa de forragem em kg MS/ha** — mede tendência. A régua continua sendo a fonte da altura.

No sistema: ingerir só cena com menos de 20–30% de nuvem; alerta quando o índice cai mais de 15% contra o mesmo período do ano anterior.

### Clima

O dado mais barato e mais útil da fazenda inteira é o **pluviômetro lido às 7h em cada retiro**. Depois dele, estação automática.

```
Graus-dia = Σ [(Tmáx + Tmín)/2 - Tbase]        (milho: Tbase ~10 °C)
Balanço hídrico = P - ETc
```

Serve para decidir aplicação de N, janela de plantio e momento de vedar o pasto.

## Rotina operacional: como a fazenda roda

Sistema sem rotina é banco de dados vazio. O ciclo que funciona em fazenda de médio e grande porte:

| Horizonte | Quando | Quem | Produto |
| --- | --- | --- | --- |
| Anual | jul–ago | dono, gerente, consultor | orçamento, plano de rebanho, plano forrageiro, plano de safra |
| Mensal | 1º dia útil | gerente e encarregados | plano mensal; reunião de resultados (orçado contra realizado) |
| Semanal | segunda-feira | gerente e encarregados | OS por equipe e por máquina; revisão dos alertas |
| Diário | manhã | equipe | execução, apontamento, checklists |

### A ordem de serviço é o coração do sistema

Todo custo, toda hora de máquina e todo insumo entram por ela. Campos mínimos:

```
número · data programada · data executada
atividade (lista fechada padronizada)
local: pasto / piquete / talhão
equipe (pessoas) + horas-homem
máquina + implemento + horímetro inicial e final
insumos: produto, lote, dose, quantidade total
produção realizada: ha, km, cabeças
status + motivo (quando não concluída)
observação + foto + GPS
```

A regra que faz o dado existir: **insumo só sai do estoque com destino preenchido** (pasto, lote, talhão, máquina ou OS). Sem destino, não existe custo por área — só existe custo "da fazenda", que não serve para decidir nada.

### Checklists de campo

| Checklist | Frequência |
| --- | --- |
| Ronda: contagem, animais doentes, mortes com causa | diária |
| Bebedouro: nível, vazão, boia | diária |
| Cocho: nível e kg repostos | diária a 3×/semana |
| Pluviômetro | diária, às 7h |
| Pré-uso da máquina | diária |
| Altura do pasto | semanal |
| Cerca | semanal ou quinzenal |
| Mosca e carrapato | quinzenal nas águas |

### Equipe e NR-31

Indicadores: horas apontadas sobre horas pagas; ha por homem-dia; cabeças por vaqueiro (500–1.000 em sistema extensivo). A NR-31 exige capacitação de operadores e aplicadores, EPI com registro, proteção de máquinas e armazenamento correto de agrotóxicos — **o sistema deve recusar na OS um operador sem habilitação válida**. É controle de passivo trabalhista, não burocracia.

### Gestão por indicadores (PDCA)

Metas mensais concretas (ex.: GMD de 0,6 kg/d nas águas, 2,0 UA/ha, custo abaixo de R$ 250/@) → OS semanal → painel e reunião mensal → plano de ação com responsável e prazo.

### Coleta de dado: a parte que mata projeto de sistema

1. **Quem executa registra**; o encarregado valida no mesmo dia.
2. **App offline com lista fechada.** Fazenda não tem sinal. Papel só como contingência, digitado em 24 h.
3. Validação de faixa no próprio campo, foto do horímetro e da balança, carimbo de usuário, GPS e hora.
4. **O dado precisa voltar como informação para quem coletou.** Ranking de GMD por lote, diesel por operador, OS concluídas. Sem retorno, o registro morre em uns três meses — este é o motivo mais comum de fracasso de software agro.

**Erros que invalidam o dado:** lote desatualizado, área errada, jejum diferente entre pesagens, abastecimento sem horímetro, insumo sem local, lançamento retroativo em massa no fim do mês.

## Dados primários mínimos

Esta é a lista do que precisa ser **digitado por alguém** para os KPIs existirem. Nada aqui é calculado: é matéria-prima.

### Cadastro base (uma vez, revisado anualmente)

| Dado | Onde entra | Crítico porque |
| --- | --- | --- |
| Polígono de cada pasto e talhão, com área útil | mapa ou importação KML | área útil é o denominador de UA/ha e @/ha |
| Cultivar do capim de cada piquete | cadastro de área | define a faixa de altura |
| Água: distância e vazão do bebedouro | cadastro de área | explica lote que não ganha |
| Cocho: metragem linear | cadastro de ponto | explica consumo desigual |
| Nível de degradação 1–4 + foto | avaliação de área | prioriza investimento |
| Capacidade de suporte, águas e seca | cadastro de área | base do ajuste de lotação |
| Lotes e categorias | cadastro de lote | agrupa o desempenho |
| Máquinas: valor, potência, horímetro atual, vida útil | cadastro de máquina | base do custo/h |
| Pessoas e treinamentos (NR-31) | cadastro de pessoa | habilitação na OS |
| Insumos com unidade e preço | cadastro de produto | custeio |
| Centros de custo e resultado | cadastro | destino de todo lançamento |

### Rotina diária

| Dado | Quem | Tempo |
| --- | --- | --- |
| Chuva lida às 7h, por retiro | encarregado | 10 s |
| Ronda: contagem, animal doente, morte com causa | vaqueiro | no fim da ronda |
| Movimentação de lote entre piquetes | vaqueiro | no ato |
| Suplemento fornecido por lote (kg) | tratador | no ato |
| OS: horas, área feita, insumo aplicado | operador | fim do turno |
| Abastecimento com horímetro e litros | operador | na bomba |
| Nota de compra e de venda | escritório | no ato |

### Rotina semanal

| Dado | Quem |
| --- | --- |
| Altura do pasto dos piquetes em uso (30–50 pontos) | encarregado |
| Consumo real de suplemento em g/kg PV | encarregado |
| Programação de OS da semana | gerente |
| Revisão dos alertas abertos | gerente |

### Rotina mensal

| Dado | Quem |
| --- | --- |
| Pesagem dos lotes (ciclo de 30–60 d) | equipe de curral |
| Inventário do rebanho e conciliação com o saldo do Indea | escritório |
| Inventário de estoque e de diesel | almoxarifado |
| Fechamento de custos por centro | escritório |
| Balanço forrageiro dos próximos 6 meses | gerente |
| Manutenções realizadas | oficina |

### Rotina anual ou sazonal

| Dado | Quando |
| --- | --- |
| Análise de solo por gleba | seca, antes do plano de adubação |
| Plano de adubação e de calagem | ago–set |
| Vedação de pasto para diferimento | 40% em fev, 60% em mar |
| Estação de monta, DG, desmama | conforme calendário |
| Brucelose e vacinas obrigatórias | por etapa do Indea |
| Reavaliação de degradação das áreas | fim das águas |
| Orçamento do ano-pecuário | jul–ago |

**Regra de ouro do produto:** se um dado desta lista exige mais de 30 segundos para ser registrado no celular, no meio do pasto, sem sinal, ele não vai ser registrado. Lista fechada, botão grande, offline, zero digitação livre.

## Catálogo de KPIs

Esta tabela é a especificação de cálculo do sistema. Cada linha vira uma função de domínio com teste.

### Produção

| KPI | Fórmula | Freq. | Meta / benchmark |
| --- | --- | --- | --- |
| @/ha/ano | kg PV produzidos × rendimento / 15 / ha útil | mensal e anual | BR 5,15 · MT ~7,7 · Rally 12,88 |
| kg PV/ha | Σ(saída – entrada + nascimentos – mortes) / ha útil | mensal | crescente |
| UA/ha | Σ(peso vivo / 450) / ha útil | semanal | águas 2–4 · seca 0,8–1,2 |
| GMD por lote | (peso final – peso inicial) / dias, pareados | 30–60 d | águas 0,5–0,77 · seca ~0,2 |
| % de piquetes na faixa de altura | piquetes na meta / medidos | semanal | ≥ 80% |
| Oferta de forragem | kg MS / (PV/100) / dias | mensal | ~8–12% PV |
| Saldo forrageiro | oferta – demanda | mensal | ≥ 0 |
| Desfrute | (vendas – compras ± Δestoque) / rebanho médio | anual | ≥ 25–30% |
| Mortalidade | mortes / rebanho médio | mensal | bezerros ≤ 3% |

### Nutrição

| KPI | Fórmula | Freq. | Meta |
| --- | --- | --- | --- |
| Consumo de suplemento | kg / dias / cabeças / peso × 1000 | semanal | meta ±20% |
| Custo do ganho adicional | R$ suplemento / kg de ganho extra | período | abaixo de R$ 13/kg PV |

### Cria

| KPI | Fórmula | Freq. | Meta |
| --- | --- | --- | --- |
| Taxa de prenhez | prenhes / expostas | anual | ≥ 85% |
| Taxa de desmame | desmamados / expostas | anual | ≥ 75–78% |
| kg desmamados por vaca exposta | kg total desmamado / expostas | anual | ≥ 162 kg |
| IEP | parto n – parto n-1 | anual | 365 d |

### Econômicos

| KPI | Fórmula | Freq. | Meta |
| --- | --- | --- | --- |
| COE/@ e COT/@ | custo / @ produzidas | mensal | abaixo do Imea do sistema |
| Custo/ha | custo do centro / ha | mensal | comparado entre áreas |
| Custo/cab/mês | custo do lote / cabeças / meses | mensal | tendência |
| Margem/ha e Lajida/ha | (RB – COE) / ha | mensal | crescente |
| Ponto de equilíbrio | custo/ha / preço da @ | mensal | abaixo da produção real |
| kg PV por kg de N aplicado | ganho extra / N aplicado | safra | ≥ 2,4 |

### Frota

| KPI | Fórmula | Freq. | Meta |
| --- | --- | --- | --- |
| Custo/h real | Σ custos / horas rodadas | mensal | ±10% do orçado |
| L/h e L/ha | litros / horas, litros / ha | por abastecimento | referência ±15% |
| Disponibilidade mecânica | (h programadas – h manutenção) / h programadas | mensal | ≥ 85–90% |
| Utilização | horas por ano | mensal | alerta abaixo de 400 h |

### Operação e lavoura

| KPI | Fórmula | Freq. | Meta |
| --- | --- | --- | --- |
| Cumprimento de OS | concluídas / programadas | semanal | ≥ 90% |
| sc/ha | kg a 14% / 60 / ha | safra | soja 60,45 · milho 126,27 (MT) |
| Custo/saca | custo/ha / sc/ha | safra | abaixo do preço |
| Gap de produtividade | top 10% – real | safra | decrescente |

### Os oito relatórios que realmente mudam decisão

Tudo o mais é secundário. Se o sistema entregar só estes oito, já muda a fazenda:

1. **Mapa de pastos por status de altura**, com lote ocupante e dias de ocupação
2. **Ranking de GMD** por lote × piquete × suplemento
3. **Balanço forrageiro** de 6 meses
4. **Custo/@ e margem** por atividade e por lote
5. **Painel de frota**: horas, L/h, R$/h e desvios
6. **Orçado contra realizado** por centro de custo
7. **Funil da cria**: expostas → prenhes → paridas → desmamadas
8. **Agenda sanitária e legal** com vencimentos

## Modelo de dados no MAIKE

Três achados que mudam o plano, todos a favor:

1. **O ledger de rebanho já é a base de tudo.** `PosicaoRebanho` + `EventoRebanho` + `PartidaRebanho` dão saldo por área em qualquer data. Isso significa que **ocupação de piquete, UA/ha histórico e dias de pastejo são deriváveis hoje**, sem tabela nova.
2. **`PesoRebanho` já guarda peso médio datado com a flag `medido`** (medido contra derivado). O GMD real é um cálculo puro sobre dados que já existem — não é migration, é função de domínio.
3. **`CategoriaManejo` já tem `gmd_janeiro`…`gmd_dezembro`.** Ou seja, a **meta** de GMD por categoria e mês já está cadastrada. Falta o realizado para comparar. Os dois lados do indicador mais importante do sistema estão a uma fatia de distância.

### Entidades novas, por bloco

**Pastagem — o bloco que falta inteiro**

| Entidade | Campos principais | Liga em |
| --- | --- | --- |
| `Cultivar` | nome, espécie, altura_entrada_cm, altura_saida_cm, altura_max_continuo_cm, altura_min_continuo_cm, v_percentual_alvo, producao_ms_ano, diferivel, resistente_cigarrinha | `AreaPastagem.cultivar_id` (hoje `tipo_pastagem` é texto livre) |
| `MedicaoAlturaPasto` | area_id, data, metodo, n_pontos, altura_media_cm, desvio_padrao, pct_fora_faixa, usuario_id, fotos | área + cultivar → situação |
| `AvaliacaoDegradacao` | area_id, data, nivel (1–4), cobertura_pct, invasoras, rota_recomendada, fotos | priorização de investimento |
| `AnaliseSolo` | area_id, data_coleta, profundidade, pH, Ca, Mg, K, Al, H_Al, P, S, MO, argila, V_pct, m_pct, laudo_url | recomendação |
| `PlanoAdubacao` | area_id, ano_safra, calcario_t_ha, gesso_kg_ha, P2O5, K2O, N_total, n_parcelas | gera OS |
| `VedacaoArea` | area_id, data_vedacao, data_abertura_prevista, massa_estimada_kg_ha | diferimento |
| `CapacidadeSuporteSazonal` | area_id, periodo (águas/transição/seca), ua_ha | hoje `capacidade_maxima` é um número único para o ano, o que é incorreto |
| `TaxaAcumuloForragem` | cultivar_id, mes, kg_ms_ha_dia, adubado (bool) | balanço forrageiro |

**Frota — o segundo bloco inteiro**

| Entidade | Campos principais |
| --- | --- |
| `Maquina` | nome, tipo, marca, modelo, ano, potencia_cv, valor_aquisicao, valor_residual, vida_util_horas, horimetro_atual, centro_custo_id |
| `Implemento` | nome, tipo, largura_m, maquina_compativel |
| `Abastecimento` | maquina_id, data, litros, horimetro, valor_unitario, tanque_id, operador_id, tarefa_id |
| `ManutencaoMaquina` | maquina_id, tipo (preventiva/corretiva), horimetro, data, pecas, mao_obra, horas_parada |
| `PlanoManutencao` | maquina_id, intervalo_horas, item, ultima_execucao_horimetro |
| `CustoHoraMaquina` | maquina_id, mes, deprec, juros, combustivel, lubrificante, reparo, operador, total_hora |

`TipoTarefa` **já tem** `pode_ter_maquina` e `pode_ter_implemento` — os ganchos estão prontos, falta o outro lado da FK.

**Clima**

| Entidade | Campos |
| --- | --- |
| `RegistroChuva` | setor_id, data, mm, usuario_id |

Uma tabela, três campos úteis, e é provavelmente o melhor retorno por linha de código do sistema inteiro.

**Sanidade — tipar o que hoje é JSON**

Hoje `EventoSanitario`, `AplicacaoMedicamento` e `ManejoTecnicoRebanho` são `{dados Json}` sem FK nem tela. Precisam virar:

| Entidade | Campos |
| --- | --- |
| `ProtocoloSanitario` | nome, categoria alvo, itens (produto, dose, via, intervalo), periodicidade |
| `AplicacaoSanitaria` | posicao_id ou lote_id, data, protocolo_id, produto_id, dose, cabeças, responsavel, movimentacao_estoque_id |
| `ObrigacaoLegal` | tipo (brucelose/raiva/…), etapa, prazo, status, comprovante_url |

**Lavoura — reaproveitando o que existe**

`AreaPastagem.tipo_cultura` já existe com default "Pastagem". Talhão **não precisa ser entidade nova**: é a mesma área com outro uso. O que falta:

| Entidade | Campos |
| --- | --- |
| `Safra` | nome, cultura, data_inicio, data_fim, ano_agricola |
| `AreaSafra` | area_id, safra_id, cultivar, populacao_alvo, populacao_real, espacamento, data_plantio, antecessora |
| `OperacaoAgricola` | area_safra_id, tipo, data, insumos, dose, maquina_id, operador, condicao_climatica, receituario_url |
| `Colheita` | area_safra_id, data, kg, umidade, sc_ha_corrigido |
| `MonitoramentoMIP` | area_safra_id, data, ponto, praga, contagem, nivel_dano |

**Satélite**

| Entidade | Campos |
| --- | --- |
| `CenaSatelital` | data, fonte, nuvem_pct, raster_url |
| `IndiceVegetacaoArea` | area_id, cena_id, indice (NDVI/NDRE/EVI), valor_medio, valor_min, valor_max |

**Metas**

| Entidade | Campos |
| --- | --- |
| `MetaIndicador` | empresa_id, indicador, escopo (fazenda/setor/area/lote/atividade), periodo, valor_meta |

Sem esta tabela não existe painel: um número sem meta ao lado não gera ação.

### Cálculos que viram função de domínio

Hoje UA, UA/ha e lotação estão em `src/components/mapa/MapaInsights.jsx` — **no frontend, só para exibição**. KPI no componente de tela não serve para relatório, alerta, histórico nem comparação. Precisa descer para `src/domain/` e para o backend, com teste:

```
src/domain/indicadores/
  ua.js                 → ua, uaPorHa, lotacaoCabHa, utilizacaoCapacidade
  gmd.js                → gmdPorPosicao, gmdPorLote, gmdRealVsPrevisto
  producao.js           → kgPvProduzidos, arrobasProduzidas, arrobasPorHa
  forragem.js           → situacaoAltura, ofertaForragem, saldoForrageiro, uaPossivel
  custo.js              → custoPorArea, custoPorLote, custoPorArroba, custoPorCabecaMes
  maquina.js            → custoHora, litrosPorHora, litrosPorHa, disponibilidade
```

### Duas restrições técnicas a respeitar

**1. Polígono é JSON `[lat,lng]`, não PostGIS.** Sem índice espacial e sem consulta por intersecção no banco. Turf resolve no navegador, e isso basta para o mapa. Mas "qual pasto contém este ponto GPS" **no servidor** — necessário para apontamento automático por GPS e para recorte de raster de satélite — exige PostGIS ou cálculo em JS no backend. Decidir isso antes de prometer apontamento automático.

**2. O manifesto de escopo anda junto com o código, nunca antes.** `config/mapa-manejo-scope.json` exige **bijeção**: toda página em `allowedPages` precisa estar registrada em `src/pages.config.js`, e toda registrada precisa estar na lista. Liberar uma tela antes de ela existir **reprova o `gate:product-scope`**, então não existe pré-liberação: cada fatia altera o manifesto na mesma PR em que cria a sua tela. Dois detalhes que mudam o planejamento: `allowedBase44Entities` se refere aos schemas legados em `base44/entities/`, **não aos models Prisma novos** — esses o gate de escopo não barra, quem manda neles é `gate:tenancy` e `gate:indices` (`cliente_id` obrigatório e todo índice começando por ele); e `forbiddenDomains` é conferido por **texto literal** em `pages.config.js`, `App.jsx`, `Layout.jsx` e `menuConfig.js`, onde já constam `CadastroMaquinas`, `LancamentosAbastecimento`, `OperacoesAgricolas`, `GerenciarSafras`, `CustosSafra` e `Pesagens`. As fatias de frota e lavoura precisam de nome de página diferente desses, ou de removê-los da lista com decisão própria.

## O que o MAIKE já tem e o que falta

O MAIKE hoje é um **mapa georreferenciado + movimentação de rebanho por lote e posição**, com ledger de eventos imutável, cadastros de suporte e estoque com FIFO real. A arquitetura está boa: multi-tenant desde o primeiro model, 55 models, 34 migrations, governança por gates. O que falta não é fundação — é o eixo de produtividade.

| Módulo | Estado no MAIKE | O que falta |
| --- | --- | --- |
| Mapa e áreas | **Forte.** `AreaPastagem` com polígono, ha, `area_pastejada`, `capacidade_maxima` em UA, coloração por UA/ha, importação KML, GPS | capacidade sazonal; cultivar como cadastro |
| Rebanho e movimentação | **Muito forte.** Ledger imutável, 9 tipos de evento, saldo por data, cancelamento seguro, junção, drag-and-drop no mapa | nada estrutural |
| Pesagem | **Existe** (`PesoRebanho`, medido vs derivado) | **GMD calculado**, curva contra alvo, CV do lote |
| Categorias | **Existe** com GMD previsto mês a mês | comparar previsto contra realizado |
| Ordem de serviço | **Existe** (`LancamentoTarefa`, `TipoTarefa`, `GrupoAtividade`), com área, lote, posição, fotos, anexos | horas-máquina e horímetro; custo da tarefa |
| Estoque | **Forte.** FIFO real, custo médio, saldo antes/depois, vínculo a lote e área | consumo por hectare e por arroba |
| Suplementação | **Existe** com consumo esperado por %PV, cocho, alertas de reposição | consumo **real** em g/kg PV e custo do ganho adicional |
| Centros e naturezas | **Existe** — a PR que você tem aberta. Hoje são catálogos sem lançamento | apropriação de custo por área, lote e atividade |
| Pastagem (altura, solo, adubação) | **Não existe.** Só `forragem_kg_ha` e `taxa_crescimento` como campos estáticos de cadastro | o bloco inteiro |
| Frota | **Não existe.** Só as flags `pode_ter_maquina` / `pode_ter_implemento` em `TipoTarefa` | o bloco inteiro |
| Clima | **Não existe** | `RegistroChuva` |
| Sanidade e reprodução | **Só `{dados Json}`** sem FK nem tela | tipar + calendário legal |
| Lavoura | **Não existe** | safra, área-safra, operação, colheita, MIP |
| Satélite / NDVI | **Não existe como dado** — satélite é só imagem de fundo do mapa | cena, índice por área, série |
| Indicadores econômicos | **Não existe.** Zero ocorrência de arroba no código | @, custo/@, margem, ponto de equilíbrio |
| Visualização de indicador | Só `MapaInsights`, no frontend | painel com meta ao lado |

### A boa notícia: duas das três pernas já estão de pé

Produtividade é lotação × desempenho, e custo é a terceira perna:

| Perna | Matéria-prima no MAIKE | Falta |
| --- | --- | --- |
| Lotação | ledger dá cabeças por área por dia; `area_pastejada` dá o denominador | série histórica e a **altura** para saber se está certa |
| Desempenho | `PesoRebanho` datado + GMD previsto por categoria | o cálculo do GMD real |
| Custo | `MovimentacaoEstoque` com valor, FIFO e vínculo a área e lote + centros | apropriação e divisão por ha e por @ |

Nenhuma das três pede refundar nada. É cálculo e tela sobre dado que já está lá.

## Roadmap de implantação em fatias

Uma PR por vez, na ordem abaixo. Cada PR usa vários agentes em paralelo internamente, e o relatório começa com **fatia · branch · PR**. Nenhuma fatia mistura configuração e visual.

### Onda 0 — registra a decisão (só documentação)

| Fatia | Branch | O que entra | Pronto quando |
| --- | --- | --- | --- |
| `PRODUTIVIDADE-00` | `claude/produtividade-00-base-tecnica-01` | `docs/engineering/MAIKE-PRODUTIVIDADE-BASE-TECNICA.md` e a decisão **D-PROD-154** no `DECISIONS.md`, com o marcador final passando a D-PROD-155 | `verify:all` verde e nenhum arquivo fora de `docs/` tocado |

Esta fatia **não** mexe no manifesto de escopo, e isso é de propósito: pela bijeção do `gate:product-scope`, liberar página antes de ela existir reprova o CI. O manifesto é alterado por cada fatia, junto com a tela que ela cria.

### Onda 1 — enxergar (o retorno mais rápido, quase sem migration)

| Fatia | Branch | O que entra | Depende | Pronto quando |
| --- | --- | --- | --- | --- |
| `INDICADORES-01` | `claude/indicadores-01-nucleo` | `src/domain/indicadores/` com UA, UA/ha, lotação, **GMD real** a partir de `PesoRebanho` (só `medido=true`), kg PV/ha, **@ produzidas**, GMD real contra o previsto da `CategoriaManejo`; endpoint de indicadores; `MapaInsights` passa a consumir o domínio | 00 | testes cobrindo cada fórmula; mesmo número no mapa e no endpoint |
| `PASTO-01` | `claude/pasto-01-cultivar` | `Cultivar` com altura de entrada e saída, FK em `AreaPastagem`, migração do texto livre de `tipo_pastagem`, seed com a tabela da Embrapa | 00 | toda área com cultivar; faixa de altura disponível por área |
| `PASTO-02` | `claude/pasto-02-altura` | `MedicaoAlturaPasto`, coleta mobile de 30–50 pontos com média e desvio, situação calculada, alerta de fora da faixa, novo modo de coloração do mapa por altura | 01 | medir um piquete no celular, offline, e o mapa mudar de cor |
| `CLIMA-01` | `claude/clima-01-chuva` | `RegistroChuva` por setor, lançamento de 10 segundos, acumulado mensal | 00 | série de chuva por setor no painel |

Ao fim desta onda a fazenda já responde: **quais pastos estão rapados, quais estão passados, e qual lote está ganhando peso.** Isso só é possível porque o ledger e `PesoRebanho` já existem.

### Onda 2 — custar

| Fatia | Branch | O que entra | Depende | Pronto quando |
| --- | --- | --- | --- | --- |
| `PASTO-03` | `claude/pasto-03-lotacao` | Ocupação por área e data derivada do ledger, série de UA/ha, dias de pastejo, `CapacidadeSuporteSazonal` (águas, transição, seca) | `INDICADORES-01` | UA/ha de qualquer área em qualquer data passada |
| `CUSTO-01` | `claude/custo-01-apropriacao` | Apropriação de custo por área, lote e atividade a partir de `MovimentacaoEstoque` (valor e FIFO já existem) e de `LancamentoTarefa`; custo/ha; custo/cab/mês; **custo do pasto rateado ao lote por UA × dias** | `PASTO-03` | custo de uma área e de um lote fecha com a soma dos lançamentos |
| `CUSTO-02` | `claude/custo-02-arroba` | Custo/@ produzida, COE por atividade, margem/ha, Lajida/ha, ponto de equilíbrio em @/ha e R$/@ | `CUSTO-01` | custo/@ comparável com o Imea do sistema |
| `PAINEL-01` | `claude/painel-01-indicadores` | `MetaIndicador` e painel com realizado ao lado da meta; os 8 relatórios que mudam decisão | `CUSTO-02` | cada número do painel tem meta e cor |

Esta onda é a que encaixa na trilha de Gestão Rural que você já abriu: centros e naturezas são justamente o destino da apropriação. **Não precisa de financeiro transacional** — contas a pagar e receber continuam fora do escopo; o custo vem da saída de estoque e da tarefa, que já têm valor e destino.

### Onda 3 — máquinas e solo

| Fatia | Branch | O que entra | Depende |
| --- | --- | --- | --- |
| `FROTA-01` | `claude/frota-01-cadastro` | `Maquina`, `Implemento`, `Abastecimento`; horímetro inicial e final na OS, usando as flags que `TipoTarefa` já tem | 00 |
| `FROTA-02` | `claude/frota-02-custo` | Custo horário completo, L/h, L/ha, alerta de desvio de diesel, manutenção preventiva por horímetro, disponibilidade mecânica | `FROTA-01`, `CUSTO-01` |
| `SOLO-01` | `claude/solo-01-analise` | `AnaliseSolo` com cálculo de V%, m% e necessidade de calcário; `PlanoAdubacao` com dose de N, P₂O₅ e K₂O; geração de OS de aplicação | `PASTO-01` |
| `FORRAGEM-01` | `claude/forragem-01-balanco` | `TaxaAcumuloForragem`, balanço forrageiro de 6 meses, `VedacaoArea` para diferimento, alerta de saldo negativo | `PASTO-02`, `PASTO-03` |

### Onda 4 — expandir

| Fatia | Branch | O que entra | Depende |
| --- | --- | --- | --- |
| `SANIDADE-01` | `claude/sanidade-01-protocolos` | Tipar `EventoSanitario` e `AplicacaoMedicamento` em `ProtocoloSanitario` e `AplicacaoSanitaria`; `ObrigacaoLegal` com vencimento (brucelose por etapa do Indea) | 00 |
| `LAVOURA-01` | `claude/lavoura-01-safra` | `Safra`, `AreaSafra`, `OperacaoAgricola`, `Colheita`, `MonitoramentoMIP`; sc/ha, custo/saca, margem/ha | `CUSTO-01` |
| `SATELITE-01` | `claude/satelite-01-indices` | `CenaSatelital` e `IndiceVegetacaoArea`; NDVI e EVI por área, série e alerta de queda | `PASTO-01` |
| `REPRODUCAO-01` | `claude/reproducao-01-estacao` | Estação de monta, DG, funil da cria, prenhez, desmame, kg por vaca exposta | `SANIDADE-01` |

### Dependências duras, resumidas

```
PRODUTIVIDADE-00  →  tudo

INDICADORES-01  →  PASTO-03  →  CUSTO-01  →  CUSTO-02  →  PAINEL-01
                                       └→  FROTA-02
                                       └→  LAVOURA-01
PASTO-01  →  PASTO-02  →  FORRAGEM-01
     └→  SOLO-01
     └→  SATELITE-01
SANIDADE-01  →  REPRODUCAO-01

Independentes (entram em qualquer ponto): CLIMA-01, FROTA-01
```

### Duas decisões técnicas a tomar antes da Onda 3

1. **PostGIS ou não.** Hoje o polígono é JSON `[lat,lng]`. Para apontamento automático por GPS e recorte de raster no servidor, precisa de geometria no banco. Dá para adiar até `SATELITE-01`, mas não dá para ignorar.
2. **Peso médio por posição continua suficiente?** O ledger é por posição e lote, e animal individual está arquiteturalmente fora. Para GMD por lote, CV e curva, isso basta. Para rastreabilidade individual (SISBOV, que tende a ser mais exigido com o fim da vacinação contra aftosa), não basta — e seria outro eixo de identidade, não um campo novo. Decidir consciente, não por omissão.

## Primeiros 90 dias na fazenda

Isto não espera o sistema. Começa agora, em novembro, que é início das águas — a melhor janela do ano para quem vai intensificar. Caderno e planilha servem; o sistema depois absorve.

### Dias 1–15: enxergar

1. **Mapear os pastos por GPS** e corrigir as áreas. Registrar cultivar, água, cocho e degradação de 1 a 4, com foto. A área errada contamina todo indicador por hectare.
2. **Contar e pesar o rebanho todo.** Formar lotes homogêneos, com CV abaixo de 15%, e acabar com a mistura de categorias.
3. **Medir a altura de todos os pastos** — 30 a 50 pontos por piquete.
4. **Amostrar o solo** (0–20 e 20–40 cm), priorizando as glebas maiores e mais degradadas.
5. **Levantar horímetros** e instalar controle de diesel: bomba com medidor, e abastecimento somente com OS e horímetro.
6. **Regularizar brucelose** (2ª etapa vence em 31/12) e conferir o saldo no Indea.

### Dias 15–45: corrigir o óbvio

7. **Ajustar a lotação pela altura:** tirar animais dos pastos rapados e colocar nos pastos passados. Custa zero e é o maior ganho imediato.
8. **Sal mineral para todos.** Proteinado de ~1 g/kg PV na recria, medindo o custo do ganho adicional.
9. **Áreas de nível 1 e 2: recuperar já nesta estação**, com N mais P e K conforme a análise, começando pelas de melhor resposta. **Níveis 3 e 4: avaliar ILP ou arrendamento** para a safra 2027/28.
10. **Instalar a reunião de segunda-feira** com OS da semana e apontamento diário. É a rotina que faz o dado existir.

### Dias 45–90: medir e planejar

11. **Segunda pesagem** e montagem do ranking de GMD contra altura e suplemento. Investigar todo lote com GMD abaixo de 0,4 kg/d nas águas.
12. **Calcular custo/h e L/h por máquina.** Vender ou parar máquina com menos de 400 h/ano; terceirizar o que é esporádico.
13. **Fechar o primeiro COE por atividade** e o custo/@.
14. **Planejar o diferimento**: vedar 40% no início de fevereiro e 60% no início de março, com Marandu e Piatã, nunca Xaraés. Montar o balanço da seca de 2027.
15. **Montar o orçamento 2027/28** com metas de lotação, GMD, @/ha e custo/@.

### Meta real

| Prazo | @/ha/ano | Como |
| --- | --- | --- |
| 1º ano | 6–8 | manejo por altura, ajuste de lotação, suplemento, N nas melhores áreas |
| Anos 2–3 | 10–15 | recuperação de 10–20% da área por ano, ou ILP |

E a ordem importa: **ajustar lotação pela altura vem antes de adubar, e adubar vem antes de reformar.** Adubar pasto sem ter animal para comer o capim extra não devolve nada, e reformar área que só precisava de manejo custa três vezes mais do que precisava.

## Ressalvas e fontes

Leia isto antes de transformar qualquer número daqui em meta oficial do sistema.

**O que é referência sólida:** alturas de manejo por cultivar, metodologia de COE/COT/CT, fórmulas de UA, GMD e custo horário, calendário de diferimento, critérios de calagem e de nível de degradação. São Embrapa, CNA/Cepea e ASABE, e mudam pouco.

**O que precisa ser confirmado na fonte primária:** os números do Imea de 2025–2026 vieram de veículos que reproduzem os boletins — confirme no Boletim do Boi do Imea. Os dados do Campo Futuro de MT são de 2022 e de propriedades modais. Os ~7,7 @/ha de MT são conversão a partir da Abiec, não número publicado.

**O que é referência de mercado sem fonte primária verificada:** altura do Tifton, disponibilidade mecânica de 85–90%, desfrute de 20–30%, distância ao bebedouro, oferta de 8–12% PV, cabeças por vaqueiro, intervalos de manutenção, GMD de confinamento, critério de gesso e relação K₂O:N. **Calibre com seu técnico e com os dados da própria fazenda** — por isso as faixas devem ser paramétrizadas no sistema, nunca escritas no código.

**O que é cálculo com premissas, não dado publicado:** a tabela de custo horário do trator, o custo-benefício do nitrogênio, o payback da recuperação e os dois cenários de ponto de equilíbrio.

**Normas sanitárias e legais mudam por portaria.** Mantenha a tabela de obrigações paramétrizada por estado e confirme com o Indea-MT. A arroba a R$ 389,90 é volátil; não ancore decisão de investimento nela.

### Fontes

**Pastagem e forragem**

- [Régua de manejo de pastagens — Embrapa (2017)](https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1077406/1/Reguademanejodepastagens.pdf)
- [Manejo de pastos de Brachiaria brizantha — Embrapa via Semadesc-MS](https://www.semadesc.ms.gov.br/artigo-manejo-de-pastos-de-brachiaria-brizantha/)
- [Pastejo rotacionado — Embrapa](https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1072007/1/PastejoRotacionadoFINAL.pdf)
- [Pasto para uso na seca deve ser reservado no fim do verão — Embrapa](https://www.embrapa.br/en/busca-de-noticias/-/noticia/17936416/o-pasto-para-uso-na-seca-deve-ser-reservado-no-final-do-verao)
- [Recuperação de pastagens degradadas — Embrapa](https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1101768/1/Recuperacaopastagens.pdf)
- [Adubação de pastagens — Embrapa](https://www.embrapa.br/documents/1354377/1743400/Adubacao+de+Pastagens.pdf/4c4ad52e-4c49-4804-adc3-f7dd0f7107ce?version=1.0)
- [Adubação nitrogenada — Embrapa Cerrados Doc 192](https://www.infoteca.cnptia.embrapa.br/bitstream/doc/215338/1/doc192.pdf)
- [Custos de reforma e recuperação — Pasto Extraordinário](https://www.pastoextraordinario.com.br/custos-de-reforma-e-recuperacao-de-pastagem.html)
- [Custo de restauração de pastagem degradada — FGV Observatório de Bioeconomia](https://portal.fgv.br/en/news/restoration-degraded-pastureland-would-cost-r383-billion-reveals-study-bioeconomy-observatory)
- [ILP — Corteva Coeficiente Agro](https://www.corteva.com/br/coeficiente-agro/artigos/integracao-lavoura-pecuaria-lucre-com-sustentabilidade.html)
- [Sistema Santa Fé — Embrapa Circular 38](https://www.infoteca.cnptia.embrapa.br/bitstream/doc/208449/1/circ38.pdf)

**Desempenho animal e rebanho**

- [Recria e engorda — Embrapa Doc 108](https://old.cnpgc.embrapa.br/publicacoes/doc/doc_pdf/DOC108.pdf)
- [Suplementação na seca — Revista Brasileira de Zootecnia](https://www.scielo.br/j/rbz/a/WhNdn3qLpmHQSj9Fc4DJbkj/?format=html&lang=pt)
- [Suplementação proteico-energética — Senar](https://ead.senar.org.br/wp-content/uploads/capacitacoes_conteudos/bovino_cultura_de_corte/CURSO_3_NUT-ANIMAL/AULA_12_SUPLEMENTACAO_PROTEICA_ENERGETICA.pdf)
- [Índices zootécnicos de cria — Elanco](https://agropecuaria.elanco.com/br/criasaudavel/gestao/zootecnico)
- [Brucelose — Indea-MT](https://www.indea.mt.gov.br/en/-/6319399-brucelose)

**Produtividade e benchmark**

- [Rally da Pecuária 2025](https://rallydapecuaria.com.br/em-2025-a-pecuaria-superou-o-recorde-do-ano-anterior/)
- [Produtividade cresce 87% em 12 anos — Rally/Athenagro](https://www.acrissul.com.br/noticias/produtividade-cresce-87-em-12-anos-entre-produtores-do-rally-da/23001/)
- [Produtividade da pecuária de MT dobra sem abrir área](https://www.gigante163.com/produtividade/pecuaria-de-mt-dobra-produtividade-sem-abrir-novas-areas/)

**Custos e mercado**

- [Campo Futuro Pecuária de Corte 2022 — CNA](https://cnabrasil.org.br/storage/arquivos/Ebook-Campo-Futuro-2022-Pecuaria-de-Corte.pdf)
- [COT avança em todos os sistemas em MT, 2º tri/26 — Imea via Portal DBO](https://portaldbo.com.br/pecuaria-de-corte-custo-operacional-total-avanca-em-todos-os-sistemas-de-producao-em-mt-no-2o-trim-26/)
- [Custo da pecuária sobe em MT — Imea via Agrolink](https://www.agrolink.com.br/noticias/custo-da-pecuaria-sobe-em-todos-os-sistemas-em-mato-grosso_516979.html)
- [Cotações do boi gordo — Cepea](https://www.noticiasagricolas.com.br/cotacoes/boi-gordo)
- [Custos da safra 2025/26 em MT — Imea via Revista Cultivar](https://revistacultivar.com.br/noticias/custos-da-safra-2025-26-sobem-em-mato-grosso)

**Máquinas e lavoura**

- [Custo operacional de máquinas agrícolas](https://blog.mfrural.com.br/custo-operacional-de-maquinas-agricolas/)
- [Consumo de combustível em plantio direto — FEBRAPDP](https://plantiodireto.com.br/artigos/465)
- [Calculadora de consumo de diesel por hectare](https://agronegocioweb.com.br/calculadora-consumo-diesel-hectare.html)
- [Imagens de satélite na agricultura — Aegro](https://aegro.com.br/blog/imagens-de-satelite-na-agricultura/)
