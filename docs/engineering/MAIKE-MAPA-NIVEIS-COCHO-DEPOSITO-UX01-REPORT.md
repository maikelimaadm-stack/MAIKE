# MAIKE-MAPA-NIVEIS-COCHO-DEPOSITO-UX01 — Níveis de cocho e depósito no Mapa Geral

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-178** ([`DECISIONS.md`](./DECISIONS.md)). Substitui em parte a D-PROD-176 |
| Base | `origin/main` `fecbc18c` (merge da PR #249) |
| Branch / PR | `claude/new-session-abgn5w` · PR **#250** em rascunho, exclusiva deste slice |
| Migration / schema | **Nenhuma**. Sem Prisma, sem DDL, sem backend, sem API mutativa |
| Release | Merge e deploy do front, depois da auditoria do arquiteto. O proprietário faz o merge |

## 1. O que mudou

Uma fonte única de cálculo, `src/domain/suplementacao/nivelSuplementacao.js`, é uma função pura que recebe `hoje` (AAAA-MM-DD) por parâmetro. Mapa, detalhe do cocho, detalhe do depósito, tooltip/título do marcador, alertas por ponto e cartão de métricas leem o resultado dela. Antes havia três fórmulas diferentes: o mapa usava a taxa do evento, o detalhe usava fallbacks por lotes atuais, os alertas usavam o maior %PV da área e contavam dias em UTC.

- **Cocho.** O ícone mostra a fração RESTANTE estimada do ciclo:
  - base = fornecido + sobra anterior legítima;
  - saldo = máx(0, base − taxa × dias civis no fuso da fazenda);
  - a taxa é SÓ o `consumo_esperado_pv_kg` gravado no lançamento.

  O marcador muda na virada do dia sem novo lançamento e sem recarregar (`useDiaCivil`: um timer por fuso até a meia-noite, mais `visibilitychange`/`focus`).
- **Detalhe do cocho.** Dois medidores:
  - "Restante do ciclo (estimado)";
  - "Uso do limite operacional": percentual bruto sem clamp no texto, excesso atual em kg, e a linha "No lançamento: X% (Y kg acima)", que continua visível depois do consumo.
- **Depósito.** Ícone e detalhe pelo saldo real ÷ limite operacional, com percentual bruto e excesso (ex.: 200%, 300 kg acima). O preenchimento gráfico vai no máximo a 100%.
  - O estoque mínimo é só o limiar inferior, com uma margem própria.
  - Os saldos reais aparecem por produto; produtos em L ficam fora do kg (P-11).
- **Estados neutros**, com o próximo passo no texto, em vez de 0% ou 100% falsos: sem %PV, compartilhado, sem lançamento, data futura, data inválida, período fechado, sem limite.
- **Cochos que dividem o rebanho.** Mesmo produto, mesmas áreas, ciclos que se sobrepõem no tempo: ficam neutros, sem rateio 50/50 e sem dupla contagem.
  - Isso vale também quando o vizinho fechou o ciclo (gado saiu), trocou de produto ou tem um lançamento futuro.
  - Um cocho abandonado que se esgotou sozinho não contamina o vizinho.
  - O aviso crítico do conjunto volta no limite superior do esgotamento.
  - O índice da fazenda é montado uma vez e reaproveitado por todos os cochos. 150 cochos com 6.000 lançamentos levam cerca de 30 a 60 ms. No pior caso medido, 200 cochos no mesmo pasto com 30.000 lançamentos, levam cerca de 130 ms.
- **Cobertura do depósito.** Uma taxa por rebanho.
- **Alertas por ponto.** Vêm da mesma fonte, com tipos, títulos e severidades preservados, mais `cocho_acima_limite` e `deposito_acima_limite`. `alertasLote` não mudou.

## 2. Dados do cálculo

| Grandeza | Fórmula / fonte |
|---|---|
| Dia civil | `hojeNoFuso(Empresa.fuso_horario)`; sem fuso, o relógio do navegador |
| Base do ciclo aberto | `quantidade_total_kg + sobra_kg` (sobra anterior legítima do evento aberto) |
| Taxa | `consumo_esperado_pv_kg` (> 0) do lançamento; nada além disso |
| Saldo estimado | `máx(0, base − taxa × diasEntre(lançamento, hoje))` |
| Fração do ciclo / ícone | `saldo ÷ base`, quantizada em 1% (ícone, rótulo e texto iguais) |
| Esgotamento | `lançamento + ⌈base ÷ taxa⌉`; ciclo com mais de 36.500 dias fica sem data |
| Uso do limite (cocho) | `saldo ÷ capacidade_cocho_kg × 100` (bruto); excesso = `máx(0, saldo − limite)` |
| No lançamento | `base ÷ limite × 100`; excesso = `máx(0, base − limite)` |
| Depósito | saldo = Σ lotes `Disponivel` em kg (L fora); `saldo ÷ limite × 100` bruto; preenchimento `mín(1, ·)` |
| Mínimo | `abaixoMinimo = saldo ≤ mínimo`; margem = `saldo − mínimo` |
| Período fechado | saldo = sobra informada (sem recálculo); cartão: base = consumo real/dia × dias + sobra final |
| Cobertura do depósito | `saldo ÷ Σ(taxa por rebanho)` |

O limite operacional é o valor configurado HOJE. O campo é mutável e não guarda histórico, então mudar o limite muda o percentual de lançamentos antigos. O detalhe avisa isso.

## 3. Matriz de exemplos (valores reais do código)

Os valores saíram de sondagem sobre o código e conferem com os testes `nivelSuplementacao`, `mapaAlertasSuplementacao` e `mapaNiveisFonteUnica`.

**(a) Cocho de 200 kg, sobra 0, 50 kg/dia, lançado em 10/11/2026**

| hoje | estado | fração | saldo | rótulo/ícone | restam | esgota | alerta |
|---|---|---|---|---|---|---|---|
| 10/11 | ciclo aberto, estimada | 1 | 200 kg | 100% | 4 | 14/11 | — |
| 11/11 | ciclo aberto, estimada | 0,75 | 150 kg | 75% | 3 | 14/11 | — |
| 12/11 | ciclo aberto, estimada | 0,50 | 100 kg | 50% | 2 | 14/11 | — |
| 13/11 | ciclo aberto, estimada | 0,25 | 50 kg | 25% | 1 | 14/11 | `cocho_baixo` |
| 14/11 | ciclo aberto, estimada | 0 | 0 kg | 0% | 0 | 14/11 | `cocho_sem_produto` (crítico) |

**(b) O mesmo cocho com limite operacional de 120 kg**

| hoje | no lançamento | excesso no lançamento | uso atual | excesso atual | preenchimento |
|---|---|---|---|---|---|
| 10/11 | 166,67% | 80 kg | 166,67% | 80 kg | 100% |
| 11/11 | 166,67% | 80 kg | 125% | 30 kg | 100% |
| 12/11 | 166,67% | 80 kg | 83,33% | 0 | 83,33% |
| 14/11 | 166,67% | 80 kg | 0% | 0 | 0% |

Título do marcador no dia 11/11: "Restante estimado: 150 kg de 200 kg (75%). Uso do limite operacional: 125% de 120 kg (30 kg acima)."

**(c) Depósito**

| caso | saldo | uso do limite | excesso | ícone | mínimo | alertas |
|---|---|---|---|---|---|---|
| limite 300, saldo 600, mín. 100 | 600 kg | 200% | 300 kg | cheio (100) | "500 kg acima do mínimo de 100 kg." | `deposito_acima_limite`: "Saldo de 600 kg, 300 kg acima do limite operacional (200%)." |
| limite 300, saldo 90, mín. 100 | 90 kg | 30% | 0 | 30% | "Abaixo do mínimo de 100 kg (faltam 10 kg)." | `deposito_estoque_minimo` |
| sem limite, saldo 600 | 600 kg | — (neutro) | — | "Sem limite" | — | — |
| lote em L (999) | fora do kg | — | — | — | — | — |

**(d) Estados e cenários**

| cenário (hoje 12/11) | resultado |
|---|---|
| sem %PV no lançamento | neutro, "Sem estimativa": "Estimativa de consumo indisponível: o produto não tinha %PV no lançamento." Sem "cocho sem produto" |
| lançamento futuro (20/11) | neutro, "Lançamento futuro" |
| período fechado (sobra final 30) | neutro, "Período fechado"; saldo 30 kg informado; uso do limite pela sobra |
| sem lançamento | neutro, "Sem lançamento"; `cocho_sem_lancamento` (crítico) |
| 2 cochos, mesma área e produto, mesmo dia | os dois neutros, "Estimativa não confiável: 2 cochos…"; o conjunto esgota em lançamento + Σ bases ÷ menor taxa, com crítico nesse dia |
| reabastecimento escalonado (c1 e c2 em 01/11; c1 fechado e reaberto em 06/11) | os dois neutros, sem 0% falso; conjunto em 16/11 para os dois |
| vizinho fechou o ciclo em 06/11 (gado saiu) depois de dividir o rebanho | neutro, sem alerta; conjunto = 06/11 + 200 ÷ 50 = 10/11 (crítico só a partir daí) |
| vizinho trocou de produto em 05/11 | este cocho neutro; o vizinho estimado no produto novo |
| vizinho com lançamento futuro (14/11) que encerra o ciclo de 08/11 | este cocho neutro em 12/11 (o ciclo atual do vizinho conta) |
| produto por id e por nome (legado) misturados em 3 cochos | os três neutros, mesma data de conjunto, sem alerta |
| A esgotado sozinho (01/08), B parado (01/11), C ativo (10/11), mesma área | B 0% com `cocho_sem_produto`; C 50% (sem contaminação em cadeia) |
| vizinho que trocou de produto depois das janelas mínimas (SAL de 12/11 a 22/11) | conjunto = máx(04/11, 22/11) + 800 ÷ 50 = 08/12, sem alerta antes |
| lançamento duplicado no mesmo dia num cocho abandonado | o vizinho ativo segue estimado (50%) |
| vizinho com lançamento de base 0 | este cocho estimado (25%); o vizinho "Sem quantidade" |
| cocho abandonado (01/08, esgotado sozinho) + ativo (10/11) | ativo estimado em 50%; abandonado em 0% com `cocho_sem_produto` |
| 3 cochos encadeados por áreas (A–B em a1, B–C em a2) | grupo único, mesmo conjunto (18/11) para os três |
| vizinho cujo ÚNICO lançamento é futuro | não conta até o dia do lançamento |
| outra fazenda | ignorada |
| troca de produto no vizinho | não compartilha |
| taxa absurda (0,000001 kg/dia) | não quebra; estimada sem data de esgotamento |
| depósito com cocho abandonado + ativo, 150 kg | consumo 50 kg/dia (um rebanho), 3 dias, sem alerta |
| depósito com c1[a1,a2] a 100 kg/dia (08/11) + c2[a1] a 50 (10/11), 150 kg | consumo 150 kg/dia (sobreposição parcial conta a mais, nunca a menos), 1 dia, `deposito_cobertura_baixa` |
| depósito com cocho de lançamento futuro, 80 kg | consumo 50 kg/dia, 1,6 dia, alerta (o rebanho continua comendo) |
| c1[a1,a2] antigo a 10 kg/dia + c2[a1] recente a 50, 40 kg | consumo ≥ 50 (nunca menos que um lançamento), crítico |
| A[a1,a2] abandonado a 40 + B[a1] e C[a2] ativos a 100 cada, 75 kg | consumo 200, crítico |
| lançamento futuro com taxa menor (10) sobre ciclo vigente a 50 | consumo 50 |

## 4. Ícones SVG

O modelo de desenho é o da D-PROD-176 e não mudou. Mudou só a fração que entra no preenchimento: no depósito, era saldo ÷ mínimo e passou a ser saldo ÷ limite.

| fração | cocho (`geometriaNivelCocho`) | depósito (`data-deposito-nivel`) |
|---|---|---|
| 0 | 0, sem preenchimento | sem preenchimento |
| 0,25 | 25 | 25 |
| 0,5 | 50 | 50 |
| 0,75 | 75 | 75 |
| 1 | 100 | 100 |
| 1,25 / 2 | 100 (limitado) | 100 (limitado) |
| −0,3 / NaN | 0 | sem preenchimento |

Todos os SVGs gerados são documentos `<svg>…</svg>` válidos. No mapa, o marcador do depósito em 200% mostra `nivelIcone` 100 e o selo "!" de excesso. O cocho neutro usa o selo "?".

## 5. Evidências

### Testes (RED → GREEN)

Cada grupo de testes novo foi escrito antes do código e falhou pelo motivo certo. Os relatórios dos agentes guardam as saídas de cada RED.

- **Núcleo:** `nivelSuplementacao` (53), `useDiaCivil` (9), `mapaAlertasSuplementacao` (15), `medidorLimiteOperacional`, `mapaDepositoLitros`.
- **Mapa:** `mapaMarcadorNivelSuplementacao`, `mapaNivelSuplementacaoIntegrada` (virada do dia com timers falsos, sem refetch) e `mapaNiveisFonteUnica` (mapa = detalhe = alertas).
- **Detalhes:** `detalhesCochoNiveis` e `detalhesDepositoNiveis`. O DC-5 compara o cartão do detalhe com o do Histórico no período fechado.
- **Cartão:** `cartaoMetricaEventoProjecao`.
- **Formulários:** `formularioPontoLimiteOperacional` e `lancamentoSuplementacaoDataFazenda` (LD-1 a LD-4).
- **Última rodada:** os 8 testes novos (reabastecimento escalonado, cocho parado com vizinho ativo, vizinho futuro, grupo transitivo, taxa absurda, duas coberturas por rebanho e LD-4) falharam no código anterior (`33b7d334`) e passam no final.

### Gates e suíte completa

Ver a seção 9, preenchida com a saída do `verify:all` no HEAD final.

### E2E no navegador

O roteiro é `scripts/dev/e2e-mapa-niveis.mjs`: backend real, Vite e Playwright contra PostgreSQL local descartável. Ele recusa banco remoto, inclusive `?host=` remoto e um `.env` com `POSTGRES_PRISMA_URL`.

Resultado: 4 passos em cada uma das larguras 1280, 390 e 412 px, **12 de 12 OK**, 0 respostas 5xx, 0 escritas disparadas pelas telas e 0 rolagem horizontal.

1. O mapa mostra o cocho em 75% e o depósito cheio com "!". Título: "Saldo de 600 kg: 200% do limite operacional de 300 kg (300 kg acima)".
2. Detalhe do cocho: 75%; "150 kg de 200 kg"; 50 kg/dia; limite 125% (30 kg acima); no lançamento 166,67% (80 kg acima).
3. Detalhe do depósito: 200% (300 kg acima), ícone cheio, "Mínimo 100 kg · 500 kg acima do mínimo", saldo 600 kg.
4. Virada do dia em São Paulo: o MESMO marcador vai de 75% para 50% à meia-noite, com 0 leituras novas de eventos. O detalhe passa a 50% e a linha "No lançamento" continua.

Capturas e dados ficam em [`evidencias/mapa-niveis-ux01/`](./evidencias/mapa-niveis-ux01/): `evidencias.json` e 15 PNG (`mapa-niveis-w{1280,390,412}-0{1..5}-*.png`).

## 6. Arquivos

### Novos

- `src/domain/suplementacao/nivelSuplementacao.js` (fonte única);
- `src/hooks/useDiaCivil.js`;
- `src/components/mapa/MedidorLimiteOperacional.jsx`;
- `scripts/dev/e2e-mapa-niveis.mjs`;
- 12 arquivos de teste em `tests/smoke/`;
- evidências.

### Alterados

**Mapa**
- `pontoStatusUtils.jsx`: os adaptadores delegam à fonte única.
- `mapaAlertasSuplementacaoUtils.jsx`.
- `useMapRenderer.jsx`: título, `aria-label` e selo do marcador.
- `mapaGeralRender.js`.
- `MapaGeral.jsx`: fuso e `hoje`.
- `CochoNivel.jsx`, `DepositoNivel.jsx`.
- `DetalhesPontoSuplementacao.jsx`, `DetalhesDepositoSuplementacao.jsx`.
- `FormularioPonto.jsx`: rótulos de limite operacional e o aviso, que não bloqueia.
- `cadastro/colunasCadastroMapa.js`: rótulo da coluna.
- `services/mapaCacheService.js`: produtos com inativos.
- `assets/icones/deposito-sal.js`: só o comentário.

**Suplementação**
- `CardMetricaEvento.jsx`, `HistoricoSuplementacaoPonto.jsx`: projeção igual à do detalhe.
- `FormularioLancamentoSuplementacao.jsx`: data padrão no dia da fazenda.

**Biblioteca, scripts e gate**
- `src/lib/diaCivil.js`: `somarDias` não lança exceção.
- `scripts/dev/e2e-lancamentos-seed.mjs`: trava de banco local mais estrita.
- `scripts/dev/e2e-estoque-p0.mjs`: seletor `title^=`.
- `scripts/gates/typecheck-baseline.json`: 1746 → 625.

**Testes e documentos**
- 2 testes ajustados.
- Docs: DECISIONS, CURRENT-STATE e este relatório.

### Removido

`src/components/mapa/PontoPercentIcon.jsx`, que ficou órfão.

## 7. Decisões e desvios do contrato

Todos estão registrados na D-PROD-178, itens 4 e 8 a 11.

- **Critério de tempo do compartilhamento.** Janela mínima só quando o cocho esteve sozinho com o rebanho, ciclos fechados incluídos, e grupo transitivo. Ciclos externos (vizinho fechado, outro produto, lançamento futuro) também tiram a estimativa. As versões anteriores davam 0% falso com reabastecimento escalonado e com vizinho fechado ou que trocou de produto; foram corrigidas com teste RED → GREEN.
- **Cobertura do depósito por rebanho.** Mais áreas primeiro; um subconjunto já coberto fica fora; sobreposição parcial entra. Inclui os compartilhados e os lançamentos futuros. O contrato dizia "Σ taxas estimadas".
- **Cartão do período fechado.** Base reconstituída pelo fechamento, em vez de fornecido + sobra final, que estava errado. A "Duração estimada" de eventos fechados com sobra no Histórico muda (ex.: 5 → 4 dias).
- **Textos.**
  - A linha do ciclo é "150 kg de 200 kg" (sem repetir o percentual).
  - O medidor segue o padrão "<saldo> de <limite> · …".
  - Os textos de excesso trazem o saldo.
  - Os números das descrições estão em pt-BR.
  - A coluna do cadastro é "Limite op. (kg) / Capac. (L)".
- **Formulário do ponto.** O aviso de mínimo ≥ limite não bloqueia, para não mudar a regra de cadastro.
- **Formulário de lançamento.** A data padrão vem do fuso da fazenda, aplicada uma vez.
- **`necessidadeEstimada` removido** de `getDepositoIndicator`: não tinha consumidor.

## 8. Riscos

1. **Neutro prolongado.** Um cocho que dividiu o rebanho com outro do mesmo produto, nas mesmas áreas, fica sem estimativa até um lançamento novo nele ou até o outro ser desativado. Isso inclui o vizinho reabastecido, o vizinho que fechou o ciclo e o que trocou de produto. É conservador: nunca mostra número falso. O texto do detalhe orienta.
1a. **Sobra de período fechado antes do lançamento.** Num vizinho sem lançamento depois do fechamento (gado saiu e voltou), essa sobra não entra na estimativa deste cocho. O vizinho mostra a sobra como "Período fechado".
1b. **Cobertura do depósito é aproximada.** Ela pode contar a mais em três casos: sobreposição parcial de áreas, rebanho atendido por dois depósitos e rebanho que mudou de área sem fechar o consumo. Contar a mais deixa a cobertura menor que a real: o alerta de reposição vem cedo, nunca tarde.
2. **Limite sem histórico.** Mudar `capacidade_cocho_kg` muda o percentual de lançamentos antigos. Está documentado e aparece no detalhe.
3. **Taxa gravada.** A estimativa depende do `consumo_esperado_pv_kg` gravado no lançamento. Lançamentos sem %PV ficam neutros, e isso pode aparecer em fazendas que não cadastraram %PV.
4. **Histórico de eventos fechados.** A "Duração estimada" e a "Diferença" mudam, porque a base deixou de ser fornecido + sobra final.
5. **Dados de produção não foram consultados.** Não houve SQL remoto. A distribuição real (quantos cochos compartilhados, quantos sem %PV) não foi medida.
6. **Conflito de numeração.** A PR #248 move o marcador "Próxima decisão" no fim do DECISIONS.md. A ordem de merge dá um conflito textual trivial ali.

## 9. Verificação final

**`npm run verify:all`:** EXIT 0, 39 de 39 etapas, 1349,5 s. Rodou com a árvore de código do commit `44ae6190` (o último commit de código), contra PostgreSQL local descartável (`maike_mapa_verify`), com `AUTH_SECRET` e `FRONTEND_ORIGINS` descartáveis iguais aos da CI.

| etapa | resultado |
|---|---|
| test:gates | 739/739 (91 suítes) |
| test:backend | 1630 testes: 1625 passaram, 0 falharam, 5 *todo* (1029,5 s) |
| test:smoke | 214 arquivos, 2593/2593 |
| gate:types | PASSOU: 625 diagnósticos, teto certificado 625 |
| typecheck:backend, lint, build, build:admin | PASSOU (lint: 0 erros; os 2 avisos já existiam antes desta missão) |
| governance-paths, package-sync, product-scope, api-boundary, native-api, source-closure, import-integrity, admin-isolation, no-secrets, base44, tenancy, rebanho-ssot, indices, deploy-migrations, supabase-public-grants e os gates nativos | todos PASSARAM |

**Verificação adversarial independente.** Rodaram três lentes (cálculo, UI/regressão e escopo), com um cético por achado.

- **Achados reproduzidos e corrigidos:**
  - a regra de compartilhamento dava 0% falso com reabastecimento escalonado;
  - a cobertura do depósito contava o mesmo rebanho duas vezes;
  - uma taxa absurda derrubava o mapa;
  - a trava de banco local do roteiro E2E podia ser contornada pelo `.env`.

  Cada um ganhou teste RED → GREEN.
- **Achado em que o cético deu razão ao código:** a data padrão mudava na virada do dia. Mesmo assim, foi endurecida para ser aplicada uma vez (LD-4).
- **Lente de escopo:** zero arquivos em backend, Prisma, migrations, `config/`, permissões, rotas ou menu. Nenhuma chamada nova de escrita no front. Nenhuma outra PR aberta usa a D-PROD-178 ou a 179.
