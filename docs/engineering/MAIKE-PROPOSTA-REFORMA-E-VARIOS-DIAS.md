> **Proposta aprovada pelo proprietário em 2026-11-21** (memória do projeto; copiada sem mudanças do material entregue a ele).
> Partes 2 (serviço de vários dias) e 3 (a regra da Situação) implementadas pela [D-PROD-267](./DECISIONS.md) ([relatório](./MAIKE-VARIOS-DIAS-REPORT.md)); a Parte 1 (plantio com capim e o agrupador de reforma) fica para as próximas fatias (B e C, com migration).

# MAIKE: reforma de pastagem e serviço de vários dias

Proposta v2 · 21/11/2026 · só proposta, nada foi mudado no sistema.

## Resumo (8 linhas)

1. Para a Embrapa, **recuperar** é manter o mesmo capim e **renovar** é trocar o capim. "Reforma" é o nome que o mercado usa, mas a Embrapa diz que confunde.
2. Uma reforma tem 6 a 8 serviços em sequência (formiga, calcário, preparo ou dessecação, plantio, adubo, primeiro pastejo). Somando os prazos das fontes, do calcário ao primeiro pastejo passam uns 4 a 5 meses.
3. Proposta: a **Reforma** vira um **agrupador** ("Reforma do Pasto da Aroeira 2026/27"). O botão **Planejar** cria a reforma, e cada realização daquela área entra nela sozinha. A reforma mostra o custo total e o **R$/ha**.
4. O tipo "Formação de pastagem (plantio)" passa a se chamar **"Plantio de pastagem"**. O único campo novo obrigatório é o **capim** (escolhido no Cadastro de Culturas, que já guarda espécie e cultivar). VC, forma de plantio e semente incrustada ficam opcionais.
5. Serviço de vários dias: **abre uma vez e vai somando os dias**. No dia 1 o funcionário lança normal; nos outros dias toca em **"+ Lançar dia"** e o formulário já vem preenchido. No último dia marca **Concluída**.
6. Regra do mês corrigida: o lançamento **continua o serviço aberto da mesma operação e da mesma área, sem olhar o mês**. Uma trava de 30 dias parado evita juntar serviços que não têm nada a ver.
7. Situação: **sem término = Em andamento, com término = Concluída** vira o padrão já marcado, mas a pergunta "Como fica depois de salvar?" aparece na tela. Nada conclui sozinho só porque chegou a 100%.
8. Ordem dos trabalhos: (A) vários dias + situação, **sem migration**; (B) plantio com capim, **com migration**; (C) agrupador de reforma, **com migration**. São 3 PRs.

---

## Parte 1: Reforma de pastagem no MAIKE

### 1.1 O que a pesquisa diz

**Os nomes certos** ([Doc 397 Embrapa Cerrados][d397]; [Macedo e Zimmer, Embrapa][cart]):
- **Recuperação**: volta a produzir com **o mesmo capim**.
- **Renovação**: **troca** o capim por outra espécie ou cultivar.
- **Direta**: só máquina, calcário, adubo e herbicida. **Indireta**: passa antes por uma lavoura ou um capim anual (milho, sorgo, milheto), que é o caminho da ILP.
- **Reforma**: a Embrapa diz que o termo "causa certa confusão" e que deveria valer só para "intervenções pontuais". Como o dono e o mercado falam "reforma", o MAIKE pode usar a palavra e mostrar ao lado, sozinho, **"(recuperação: mesmo capim)"** ou **"(renovação: troca de capim)"**. Para isso basta comparar o capim novo com o capim que a área tem hoje.
- **Formação**: implantar pasto (área nova, troca de espécie ou reforma). A [Embrapa][ct140] usa "formação" para o processo inteiro (preparo, plantio e primeiro pastejo), não só para o dia do plantio.

**A sequência de uma reforma e os prazos que as fontes dão:**

| # | Serviço | Tipo no MAIKE | Quando |
|---|---|---|---|
| 1 | Análise de solo | Outros | Antes de tudo ([passo a passo][pap]) |
| 2 | Isca para formiga | Aplicação | **15 dias antes do preparo do solo**; depois do plantio, combate localizado **em até 30 dias**; vistoria a cada 6 meses ([Embrapa Florestas][form]) |
| 3 | Calcário (gesso e fósforo se precisar) | Fertilização | **60 a 90 dias antes do plantio** ([passo a passo][pap]); "pelo menos 2 meses", de preferência no fim das águas (mar a abr no Cerrado) ([CT 140][ct140]) |
| 4a | Preparo convencional: grade aradora e depois niveladora | Preparo do solo | Aradora no meio da seca, niveladora logo antes das chuvas ([CT 140][ct140]) |
| 4b | Ou plantio direto: dessecação | Aplicação | Depois das primeiras chuvas, com a rebrota vigorosa (15 a 20 dias após o corte, 20 a 25 cm). Semear **cerca de 20 dias depois**. Segunda dessecação se rebrotar ([Circular 110][c110]) |
| 5 | Plantio + adubo de formação (podem ir juntos) | Plantio + Fertilização | Com as chuvas firmes, **nov a jan no Brasil Central** ([passo a passo][pap]; [Doc 397][d397]) |
| 6 | Conferir quantas plantas nasceram | dentro do Plantio | Depois que nasce. **Não achei o dia exato** em fonte oficial |
| 7 | Adubo de cobertura (N e K) | Fertilização | A fonte cita, mas **não dá prazo** ([CT 140][ct140]) |
| 8 | Primeiro pastejo (leve, só "despontar") | fora do MAIKE (é gado) | Quando o capim chega a **80% da altura normal de manejo, por volta de 40 a 60 dias da emergência** ([CT 140][ct140]), com animais leves ([passo a passo][pap]) |

Entre o preparo e o primeiro pastejo a área fica **sem gado**.

**Plantio (semeadura): o que as fontes dizem:**
- **Taxa**: a Embrapa Gado de Corte dá a taxa mínima em kg de semente pura viável (SPV) por ha: **Marandu 4,0 · Piatã 4,0 · Xaraés 4,5 · Mombaça 3,0 · Tanzânia 3,0 · Massai 3,0 · Estilosantes Campo Grande 3,0** ([passo a passo][pap]). Um texto mais novo recomenda **3 a 5 kg SPV/ha, ou 300 a 500 pontos de VC** ([CT 140][ct140]). As fontes não batem 100%, então **o sistema não deve travar nenhum número**, só guardar e mostrar.
- **Conta do VC**: kg do saco por ha = kg SPV × 100 ÷ VC%. Exemplo: Marandu 4 kg SPV com VC 50% dá 8 kg/ha do produto ([passo a passo][pap]). Pontos de VC = kg/ha × VC% (8 × 50 = 400 pontos).
- **Plantio aéreo**: no mínimo **+50% de semente** e semente de VC alto ([passo a passo][pap]).
- **Forma**: a lanço (esparramadeira ou avião), sempre enterrando depois com rolo ou grade niveladora fechada; em linha (semeadeira ou matraca); ou junto com milho ou sorgo na ILP (semente misturada no adubo, a lanço antes, sobressemeadura, terceira caixa) ([passo a passo][pap]; [Doc 397][d397]).
- **Profundidade**: sementes miúdas (Mombaça, Tanzânia, Massai) **no máximo 3 cm**; Marandu, Piatã e Xaraés **2 a 5 cm** ([passo a passo][pap]). Outro texto fala em 3 a 6 cm ([CT 140][ct140]). Isso é ajuste da máquina, **não precisa virar campo** no sistema.
- **Semente incrustada (revestida)**: pesa mais. Num estudo da Embrapa, só **34% a 43% do peso** do produto revestido era semente, e a semente nua germinou melhor na maioria dos casos ([Doc 200][d200]). Por isso, comparar kg/ha entre semente nua e incrustada engana: vale guardar o tipo e o VC do rótulo.
- **Conferir o nascimento**: o mínimo é **20 plantas por m²** (Marandu, Piatã, Xaraés) e **40 por m²** (Mombaça, Tanzânia, Massai) ([passo a passo][pap]).

**Como o Aegro organiza** (o sistema de referência com material público):
- A **safra** é a "caixa" que junta cultura, período, talhões e todas as atividades ([criar safra][a-safra]).
- Os tipos de atividade são quase os mesmos do dono: Preparo de solo, Plantio, Fertilização, Aplicação, Colheita e Outro ([planejar][a-plan]).
- O custo da safra aparece em **R$ total, R$/ha** (custo ÷ área total) e % por tipo de gasto ([custo realizado][a-custo]).
- Conclusão: o modelo do dono já está alinhado. O que falta no MAIKE é a "caixa" da reforma.

### 1.2 Proposta concreta

**A) A reforma vira um agrupador** (é a "safra" do Aegro, só que para um pasto).
- O nome é sugerido sozinho: **"Reforma · Pasto da Aroeira · 2026/27"**.
- É criada pelo botão **Planejar**, que já existe no modelo. Nesta primeira versão, Planejar cria só a caixa, com 4 campos:
  1. Áreas;
  2. Tipo: **Reforma de pastagem**, **Formação de pasto novo** ou **Outro**;
  3. Capim que vai ficar (opcional; é o que define "recuperação" ou "renovação");
  4. Início previsto.
- Planejar cada serviço com data, insumo e custo previsto (as linhas "Planejada") fica para depois, como o dono já decidiu.

**B) Cada realização entra na reforma sozinha.** Nenhum campo novo para o funcionário.
- Na seção **Planejamento** do formulário, que já existe e é só de leitura, aparece uma linha a mais: **"Faz parte de: Reforma · Pasto da Aroeira · 2026/27 ✓"**.
- Ela já vem marcada quando a área tem uma reforma aberta. Há um "tirar" para o caso de um serviço que não é da reforma (uma cerca, por exemplo).
- Se a área tiver duas reformas abertas (raro), aparece uma lista para escolher.

**C) Onde ver o custo.** Não é preciso tela nova.
- A lista ganha o filtro **"Reforma"**. Com ele ligado, aparece em cima uma barra com: **custo total, R$/ha** (custo das realizações ÷ hectares da reforma), custo por tipo (Preparo, Fertilização, Aplicação, Plantio…) e os serviços em ordem de data, com a situação de cada um.
- No mapa, o Detalhes da área mostra "Em reforma desde 10/09".
- A reforma é **concluída** pelo dono, normalmente depois do primeiro pastejo. Nesse momento o sistema pergunta: **"Trocar o capim da área para MOMBAÇA?"**. Isso mantém o mapa certo, porque o capim da área é o que dá as alturas de manejo.

**D) "Formação de pastagem (plantio)" passa a se chamar "Plantio de pastagem".**
- Motivo: "formação" é o processo inteiro (a reforma toda). O tipo é o dia do plantio.
- O nome cobre semente **e muda** (o Tifton 85 já está na lista de culturas do MAIKE e é plantado por muda).
- No banco continua o mesmo valor `PLANTIO`. Só muda o rótulo, como já foi feito na D-PROD-258.

**E) Campos do Plantio. Pensando no funcionário, o mínimo obrigatório é este:**

| Campo | Obrigatório? | Observação |
|---|---|---|
| Área(s) e hectares | Sim | Já existe |
| Operação | Sim | Já existe |
| Data de início | Sim | Já existe |
| **Capim plantado** | **Sim** | Uma lista só, vinda do Cadastro de Culturas (MARANDU, MOMBAÇA…). A cultura já guarda espécie e cultivar, então o funcionário **não digita espécie nem cultivar** |
| Safra | Automática | Ano agrícola de **1º de julho a 30 de junho** (o mesmo do [Plano Safra][psafra]). 28/11/2026 e 15/01/2027 dão **2026/27**, então uma reforma de nov a jan fica numa safra só |
| Semente (em Insumos) | Não, mas avisa | Sem semente lançada aparece "sem semente, não dá para calcular kg/ha". O kg/ha o sistema já calcula na linha do insumo |
| VC % (na linha da semente) | Não | Está no rótulo do saco. Com ele o sistema mostra **pontos de VC/ha** |
| Forma | Não | A lanço / Em linha / Aérea / Muda |
| Semente incrustada | Não | Sim ou não |
| Plantio de cobertura | Não | Já está no modelo do dono |
| Junto com (consórcio ILP) | Não | Uma lavoura do cadastro (milho, sorgo) |
| Conferência de nascimento | Depois, opcional | Botão "Conferir nascimento" na linha do plantio, com data, plantas por m² e foto. Mostra a meta da Embrapa (20 ou 40 por m²) |

**F) Aviso do primeiro pastejo** (no mesmo estilo do "pasto liberado em" da Aplicação):
- O plantio concluído mostra **"Conferir altura para o 1º pastejo: ~80% da altura de entrada"**. Exemplo: com entrada de 35 cm, conferir a partir de uns 28 cm.
- A altura vem do campo "altura de entrada" que o Cadastro de Culturas **já tem**, e a regra dos 80% é do [CT 140][ct140]. Nenhum campo novo.

**G) Lista curta de capins para o Cadastro de Culturas** (nomes e alturas do 1º pastejo da [Tabela 2 do Doc 397][d397]):

| Capim | Altura 1º pastejo (cm) |
|---|---|
| *U. brizantha* cv. **Marandu** | 30–40 |
| *U. brizantha* cv. **Xaraés** | 30–40 |
| *U. brizantha* cv. **BRS Piatã** | 30–40 |
| *U. brizantha* cv. **BRS Paiaguás** | 30–40 |
| Híbrido **BRS RB331 Ipyporã** | 30–40 |
| *U. ruziziensis* **BRS Integra** | 30–45 |
| *U. decumbens* (comum ou Basilisk) | 20–30 |
| *U. humidicola* (comum e **BRS Tupi**) | 10–20 |
| *M. maximum* cv. **Massai** | 40–50 |
| *M. maximum* **BRS Tamani** | 40–50 |
| *M. maximum* **BRS Quênia** | 50–60 |
| *M. maximum* cv. **Tanzânia** | 55–65 |
| *M. maximum* **BRS Zuri** | 70–80 |
| *M. maximum* cv. **Mombaça** | 70–80 |
| Leguminosa: **Estilosantes Campo Grande** | — (o [passo a passo][pap] traz a taxa, não a altura) |

*U.* = *Urochloa* (antes *Brachiaria*); *M.* = *Megathyrsus* (antes *Panicum*).

Hoje a lista de referência do MAIKE (D-PROD-215) não tem Ipyporã, Integra, Tamani, Quênia, Tupi nem o estilosantes. Também vale conferir as alturas dela: a atual dá Marandu 25/15 e o Doc 397 dá 35/20 (entrada/saída).

### 1.3 Para o programador (Parte 1)

- **Plantio (PR B), com migration EXPAND:**
  - tabela nova 1 para 1 `AtividadePlantio` (`cliente_id`, `empresa_id`, `atividade_id` único, `cultura_id` obrigatório com FK composta para Cultura, `forma_plantio` com CHECK, `semente_incrustada`, `cobertura`, `consorcio_cultura_id`; depois os campos do estande);
  - `vc_percentual` anulável em `AtividadeApontamentoProduto` (sem CHECK, conferido pela API, como foi feito na D-PROD-265);
  - na busca da atividade aberta, para o tipo `PLANTIO`, **o capim também precisa ser o mesmo**: capim diferente abre outra atividade;
  - safra calculada no servidor quando não vier no corpo.
- **Reforma (PR C), com migration EXPAND:**
  - `Planejamento` (`cliente_id`, `empresa_id`, `numero`, `nome`, `tipo` com CHECK, `safra_ciclo`, `cultura_alvo_id`, `data_inicio`, `status` ABERTO/CONCLUIDO/CANCELADO);
  - `PlanejamentoArea` (`cliente_id`, `empresa_id`, `planejamento_id`, `area_id`, `hectares`);
  - `Atividade.planejamento_id` anulável, com FK composta e índice começando por `cliente_id`;
  - o R$/ha é calculado na leitura, não é gravado.
- Regras: R9 e R10 (`cliente_id` primeiro), R1 (rotas e schemas novos em `config/mapa-manejo-scope.json`), R7 (um PR por missão), R8 (relatório).

---

## Parte 2: Serviço de vários dias

### 2.1 O que a pesquisa diz

- **Aegro**: a atividade aceita **várias realizações parciais**, cada uma com seus hectares ou %, e uma barra mostra "área feita ÷ área planejada". As situações são **A fazer, Em progresso, Revisar** (chegou a 100%, falta conferir) e **Concluída**. Só a última é manual ([realizar e concluir][a-real]; [acompanhamento][a-vis]).
- **Senior SimpleFarm** (ordem de serviço): a OS fica **Aberta** e recebe **apontamentos com data** (pessoa, horário, máquina), que vão somando a área. Depois é **Encerrada**, e pode ser reaberta ([status da OS][s-status]; [validação de área][s-area]; [timesheet][s-time]).
- **Lançar logo depois**: a Embrapa orienta anotar "logo após a execução de cada atividade, como forma de evitar possíveis falhas no preenchimento" ([caderno de campo][cad]).
- **Funcionário de pouco estudo**: frases simples, o principal no topo, uma coluna só e menos opções ([Nielsen Norman Group][nng]). O Aegrozap (WhatsApp) **mostra um resumo e pede confirmação** antes de salvar ([Aegrozap][a-zap]).
- **Não achei** fonte oficial que diga quando um serviço de vários dias "conta como concluído". No Aegro, concluir é **sempre manual**, mesmo com 100% feito. Na Senior, a OS encerrada pode ser reaberta.

### 2.2 O jeito recomendado: abre uma vez e vai somando os dias

**Por quê:**
- É exatamente como o MAIKE já grava: a atividade é a pasta e o apontamento é o dia.
- É o que o Aegro e a Senior fazem.
- Dá o custo certo de cada dia (horímetro, diárias, combustível).
- Mostra o andamento enquanto o serviço acontece.
- Lançar **só no fim** continua possível: é um lançamento só, com início e término. Ninguém fica travado.
- Lançar todo dia sem ajuda (digitar tudo de novo) cansa e o funcionário desiste. Por isso o "+ Lançar dia" já vem preenchido.

**Passo a passo (roçada no Pasto da Aroeira, 40 ha, de 28/11 a 07/12):**

**Dia 1 (28/11):** Mapa → Aroeira → Manejos → **Nova realização** → Roçada e tratos.
- Área: Aroeira, **4 ha hoje**. Operação: Roçada mecânica. Início: 28/11. Término: vazio.
- Máquina: Trator 02, horímetro 1.230 → 1.237. Equipe: João, 1 diária.
- **"Como fica depois de salvar?" → Em andamento** (já vem marcado porque não tem término).
- Planejamento: "Nova atividade será criada: Roçada mecânica · Aroeira · nov/26".
- Antes de salvar, um resumo em palavras: *"Roçada no Pasto da Aroeira, hoje, 4 ha, Trator 02, João 1 diária. Vai ficar EM ANDAMENTO (4 de 40 ha)."*

**Dias seguintes:** na linha da lista, ou no Manejos da área, toca em **"+ Lançar dia"**.
- Abre o mesmo formulário já preenchido: tipo, operação, área, máquina (o horímetro inicial é o final de ontem) e equipe. A data é hoje.
- O funcionário só preenche: **hectares de hoje, horímetro final e diárias**.
- Planejamento: "Entra em Roçada mecânica · Aroeira · nov/26 (em andamento, 8 de 40 ha)".
- **Esqueceu alguns dias?** Um lançamento só resolve: início 30/11, término 02/12, os hectares desses dias, 3 diárias, e escolhe **Em andamento**.

**Choveu ou a máquina quebrou (03 a 05/12):** não precisa lançar nada.
- A linha continua "Em andamento" e mostra "último dia: 02/12".
- Se quiser, escreve na observação do próximo dia: "parou 3 dias por chuva".
- Se trocou de máquina, escolhe a outra no dia seguinte.

**Último dia (07/12):** "+ Lançar dia", 3 ha, e toca em **Concluída**. A data de término fica 07/12.
- Lista: **Concluída · 28/11 a 07/12 · 40 de 40 ha (100%)**.
- **Esqueceu de concluir?** O botão **"Concluir"** na linha pergunta só "Qual foi o último dia?" e já sugere o último dia lançado.

**Como a lista mostra:** **uma linha por serviço** (a pasta), nunca uma linha por dia.
- Exemplo: *Nº 123 · Roçada e tratos · Roçada mecânica · Aroeira · 28/11 – · **Em andamento 12 de 40 ha (30%)** · R$ …*.
- Com várias áreas: "Aroeira +2 · Em andamento (1 de 3 áreas concluída)".
- Tocando na linha, aparecem os dias lançados.

**Quando vira Concluída:** só quando alguém diz que acabou: marcando Concluída no último lançamento, ou pelo botão Concluir.
- **Não conclui sozinho aos 100%**: o hectare é estimado e às vezes tem repasse. A linha mostra **"100%, falta concluir"** em destaque, como o "Revisar" do Aegro.
- Quando **todas as áreas** do serviço estão concluídas, a pasta (atividade) **também conclui sozinha**. Hoje ela fica aberta até alguém lembrar.
- Dá para reabrir, como já dá hoje.

### 2.3 A regra do mês corrigida

- **Hoje**: o sistema só procura a atividade aberta que **começou no mesmo mês**. Por isso a roçada de 28/11 a 07/12 viraria duas atividades.
- **Nova regra**: continua na atividade **ABERTA da mesma operação** que tem **a mesma área ainda em andamento ou planejada**, **sem olhar o mês**. O nome continua com o mês do início ("nov/26").
- **Trava contra serviço esquecido aberto**: se o último dia lançado nessa área foi **há mais de 30 dias**, o sistema não junta sozinho. A seção Planejamento pergunta: *"Tem uma Roçada aberta na Aroeira parada desde 03/12. Isto é continuação? [Sim, continuar] [Não, é serviço novo]"*. Se a resposta for "serviço novo", a antiga é concluída no último dia que teve lançamento.

### 2.4 O que muda no banco: **sem migration**

- `atividadeRegistroService.js`:
  - tirar o filtro `data_inicio` do mês (`limitesDoMes`) de `buscarAtividadeAberta`;
  - tirar o mês da chave da trava (`…:${areaId}:${dia.slice(0,7)}` passa a `…:${areaId}`);
  - aplicar a regra dos 30 dias (último `data_operacional`/`data_termino` daquela área).
- `POST /atividades/registrar` aceita dois campos opcionais:
  - `concluir: true`: conclui, na mesma transação, as áreas do lançamento na data de término (ou no dia) e a atividade, se todas as áreas ficarem concluídas;
  - `nova_atividade: true`: o "é serviço novo".
  - Os dois entram no fingerprint só quando vierem, do mesmo jeito que foi feito na D-PROD-265.
- "Concluir" na lista usa a rota que já existe, `POST …/areas/:areaId/concluir`. A data de conclusão nunca pode ficar antes do último dia lançado.
- O resumo da área (`atividadePorAreaService.js`) passa a devolver o último dia lançado por área. A soma de hectares já é devolvida.
- No frontend, `destinoDoRegistro` (`src/lib/registroDeCampoRegras.js`) perde o filtro do mês e passa a mostrar o andamento. É a mesma regra do servidor.
- Opcional: deixar corrigir o término depois pela edição do lançamento (colocar `data_termino` em `CAMPOS_DO_DIA`).

---

## Parte 3: A regra da Situação

| Situação | Quando | O que a lista mostra |
|---|---|---|
| **Planejada** | Só quando o "Planejar" de serviços existir: serviço previsto, sem nenhum dia lançado. Hoje não aparece | Data prevista; em vermelho se passou da data |
| **Em andamento** | Tem pelo menos um dia lançado e ninguém concluiu | "12 de 40 ha (30%)", "último dia 02/12"; "parado há N dias" se passar de 30 |
| **Concluída** | Alguém concluiu (todas as áreas do serviço) | "28/11 a 07/12", hectares finais e custo |

**Sua proposta, revisada:**
- **Fica, como padrão**: sem término, vem marcado Em andamento; com término, vem marcado Concluída.
- **Muda uma coisa**: a escolha aparece na tela como **"Como fica depois de salvar? [Em andamento] [Concluída]"**, e o resumo antes de salvar repete a escolha.
  - Por quê: quem lança vários dias de uma vez (de 30/11 a 02/12) preenche o término mas **ainda não acabou**. A data sozinha não diz isso.
  - O Aegro e a Senior também separam "datas do lançamento" de "serviço encerrado".
- **"Pôr o término depois"** = botão **Concluir** na linha, que pergunta só o último dia.
- Concluída quer dizer **"o serviço acabou"**, mesmo abaixo de 100%. Exemplo: roçou 30 de 40 ha e parou de vez: conclui com 75%.
- Nenhuma data no futuro, como já é hoje. Só a Planejada (quando existir) terá data futura.

---

## Decisões que o dono precisa tomar

1. **Reforma como agrupador**, criada pelo "Planejar", com as realizações da área entrando sozinhas e o R$/ha no filtro da lista.
   **Recomendo: sim.**
2. **Renomear para "Plantio de pastagem"**, com capim obrigatório (do cadastro), safra automática de julho a junho e o resto opcional (VC, forma, incrustada, consórcio).
   **Recomendo: sim.**
3. **Vários dias = abre uma vez e soma**, com "+ Lançar dia" preenchido e uma linha por serviço na lista. Lançar só no fim continua permitido.
   **Recomendo: sim.**
4. **Conclusão sempre por uma pessoa**: a pergunta "Como fica depois de salvar?" já vem marcada pelo término, e o serviço não conclui sozinho aos 100%.
   **Recomendo: sim.**
5. **Prazo da trava "parado"**: depois de quantos dias sem lançamento o sistema pergunta se é o mesmo serviço?
   **Recomendo: 30 dias.**

---

## Fontes (todas abertas e lidas)

- Embrapa Cerrados, **Documentos 397** (2022), *Estratégias para recuperação e renovação de pastagens degradadas no Cerrado*: definições, operações I a V e Tabela 2 (altura do 1º pastejo). https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1152245/1/Doc-397-web.pdf
- Macedo e Zimmer, Embrapa, perguntas 383 a 385 (recuperação, renovação e reforma). https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1023618/1/90000033ebookpdf.pdf
- Embrapa Gado de Corte, *Passo a Passo para a Formação de uma Boa Pastagem*: calcário 60 a 90 dias antes, nov a jan, profundidade, Tabela 1 de taxas, VC, aéreo +50%, 20 e 40 plantas/m², 1º pastejo. https://ainfo.cnptia.embrapa.br/digital/bitstream/CNPGC-2010/12908/1/passo-a-passo.pdf
- Embrapa Gado de Corte, **Comunicado Técnico 140** (2017), *Principais cuidados na formação de pastagens*: 3 a 5 kg SPV ou 300 a 500 pontos de VC, 3 a 6 cm, calcário ≥2 meses, 1º pastejo a 80% da altura, 40 a 60 dias. https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1087115/1/Principaiscuidadosnaformacaodepastagens.pdf
- Embrapa Milho e Sorgo, **Circular Técnica 110** (2008), dessecação de pastagem: cerca de 20 dias até semear. https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/491769/1/Circ110.pdf
- Embrapa Florestas (2014), *Controle de formigas cortadeiras em sistemas de iLPF*: 15 dias antes do preparo, até 30 dias depois do plantio. https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1003116/1/2014folderttformigas.pdf
- Embrapa Gado de Corte, **Documentos 200** (2013), *Qualidade de sementes nuas e recobertas de braquiárias*. https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/996155/1/DOC200.pdf
- Embrapa Uva e Vinho, *Caderno de Campo PIUP*, vol. 2: anotar logo após cada atividade. https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1060080/1/2CadernodeCampoMIOLO1.pdf
- Aegro, *Como planejar atividades*. https://aegro.com.br/suporte/safras/como-planejar-atividades-no-aegro/
- Aegro, *Como realizar e concluir atividades*. https://aegro.com.br/suporte/safras/como-realizar-e-concluir-atividades-no-aegro/
- Aegro, *Formas de visualização e acompanhamento das atividades*. https://aegro.com.br/suporte/safras/formas-de-visualizacao-e-acompanhamento-das-atividades-no-aegro/
- Aegro, *Como criar uma safra*. https://aegro.com.br/suporte/safras/como-criar-uma-safra/
- Aegro, *Formas de visualizar o custo realizado da safra* (R$/ha). https://aegro.com.br/suporte/safras/quais-as-formas-de-visualizar-o-custo-realizado-da-minha-safra/
- Aegro, *Planejar atividades da safra pelo Aegrozap* (resumo e confirmação). https://aegro.com.br/suporte/aegrozap/planejar-atividades-da-safra-pelo-aegrozap/
- Senior SimpleFarm, *Status da Ordem de Serviço*. https://documentacao.senior.com.br/simplefarm/manual-do-usuario/agricola/ordem-de-servico/status-da-ordem-de-servico
- Senior SimpleFarm, *Validação de área*. https://documentacao.senior.com.br/simplefarm/manual-do-usuario/agricola/ordem-de-servico/validacao-de-area
- Senior SimpleFarm, *Timesheet*. https://documentacao.senior.com.br/simplefarm/manual-do-usuario/agricola/ordem-de-servico/timesheet
- Nielsen Norman Group, *Lower-Literacy Users: Writing for a Broad Consumer Audience*. https://www.nngroup.com/articles/writing-for-lower-literacy-users/
- Revista Cultivar, *Plano Safra 2019/2020 entra em vigor nesta segunda-feira, 1º de julho* (vale até 30 de junho). https://revistacultivar.com.br/noticias/plano-safra-2019-2020-entra-em-vigor-nesta-segunda-feira-1o-de-julho

**O que não achei** (e por isso não virou número na proposta): o dia oficial para conferir o nascimento; o prazo da adubação de cobertura; e uma regra oficial de quando um serviço de vários dias está concluído. Taxa e profundidade variam entre as fontes da Embrapa, como já foi dito na Parte 1.

[d397]: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1152245/1/Doc-397-web.pdf
[cart]: https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1023618/1/90000033ebookpdf.pdf
[pap]: https://ainfo.cnptia.embrapa.br/digital/bitstream/CNPGC-2010/12908/1/passo-a-passo.pdf
[ct140]: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1087115/1/Principaiscuidadosnaformacaodepastagens.pdf
[c110]: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/491769/1/Circ110.pdf
[form]: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1003116/1/2014folderttformigas.pdf
[d200]: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/996155/1/DOC200.pdf
[cad]: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1060080/1/2CadernodeCampoMIOLO1.pdf
[a-plan]: https://aegro.com.br/suporte/safras/como-planejar-atividades-no-aegro/
[a-real]: https://aegro.com.br/suporte/safras/como-realizar-e-concluir-atividades-no-aegro/
[a-vis]: https://aegro.com.br/suporte/safras/formas-de-visualizacao-e-acompanhamento-das-atividades-no-aegro/
[a-safra]: https://aegro.com.br/suporte/safras/como-criar-uma-safra/
[a-custo]: https://aegro.com.br/suporte/safras/quais-as-formas-de-visualizar-o-custo-realizado-da-minha-safra/
[a-zap]: https://aegro.com.br/suporte/aegrozap/planejar-atividades-da-safra-pelo-aegrozap/
[s-status]: https://documentacao.senior.com.br/simplefarm/manual-do-usuario/agricola/ordem-de-servico/status-da-ordem-de-servico
[s-area]: https://documentacao.senior.com.br/simplefarm/manual-do-usuario/agricola/ordem-de-servico/validacao-de-area
[s-time]: https://documentacao.senior.com.br/simplefarm/manual-do-usuario/agricola/ordem-de-servico/timesheet
[nng]: https://www.nngroup.com/articles/writing-for-lower-literacy-users/
[psafra]: https://revistacultivar.com.br/noticias/plano-safra-2019-2020-entra-em-vigor-nesta-segunda-feira-1o-de-julho
