> **Pesquisa aprovada pelo proprietário em 2026-11-21** (memória do projeto; copiada sem mudanças do material entregue a ele).
> Implementada em parte: o serviço de vários dias e a Situação pela [D-PROD-267](./DECISIONS.md) ([relatório](./MAIKE-VARIOS-DIAS-REPORT.md)); a reforma e o plantio, nas próximas fatias (proposta em [`MAIKE-PROPOSTA-REFORMA-E-VARIOS-DIAS.md`](./MAIKE-PROPOSTA-REFORMA-E-VARIOS-DIAS.md)).

# Serviços de campo em pastos: pesquisa para o MAIKE

Data: 20/11/2026. Escopo: só operações em **áreas** (pastos, cercas, estradas, aguadas). Ficam de fora o rebanho, a lotação, o manejo de animais e a nutrição. A única informação ligada a gado que entra é **quando o pasto pode voltar a receber animais** depois de uma aplicação.

---

## Resumo em 10 linhas

1. Os 7 tipos cobrem o que a Embrapa descreve para formar, recuperar e manter pasto. O que falta é saber **por quê** (alvo, forrageira), **onde** (local fora de pasto) e **quanto foi feito de verdade** (ha, km).
2. A forrageira/cultivar deve ser **obrigatória** na Formação. É o dado que define o pasto e separa recuperação (mesma espécie) de reforma (espécie nova).
3. Aplicação: **alvo em lista fechada curta + "Outro"**, de preferência já gravado no cadastro da operação, para o funcionário não ter de escolher nada.
4. Vale ter **"Pasto liberado em <data>"**, calculado pela carência do produto e não digitado. As bulas variam de "3 dias" (Nepaxir) a "uso não alimentar: vedar até o capim se recuperar" (Tordon, Pastejo).
5. **Safra não deve ser perguntada** ao funcionário: o sistema tira o ano agrícola da data.
6. Manutenção/Outros: área opcional + **Local** + **quantidade feita** (km de cerca, m de aceiro, nº de bebedouros). Sem isso não sai custo por km.
7. A lei pede receita agronômica, aviso aos trabalhadores (área, produto, data e hora, reentrada, carência), devolução das embalagens em até 1 ano e autorização ambiental para queimar.
8. No campo, 82% de quem usa internet na zona rural usa **só o celular**. No Censo Agro 2017, 23% dos produtores não sabiam ler e escrever.
9. Os estudos mostram que formulários de texto erram muito com esse público. Uma pessoa conferindo o lançamento reduziu o erro em cerca de 10 vezes. Isso apoia o modelo "o peão lança o mínimo e o escritório confere".
10. Modo campo proposto: tocar no pasto, escolher o tipo, o serviço, o produto e a equipe, com números inteiros na unidade da embalagem. O lançamento fica "a conferir" até o escritório revisar.

---

## 1. Operações comuns por tipo

### 1.1 Preparo do solo
- **Operações:** análise de solo; calagem; gessagem; grade pesada (incorpora o mato e o calcário); grade niveladora; aração; subsolagem (só se houver compactação); terraço ou curva de nível; combate a formiga e cupim **antes** de plantar.
- **Sequência da Embrapa Gado de Corte:** a grade pesada incorpora o calcário, depois **aguardam-se 60 dias** e a grade niveladora incorpora o adubo. Em declividade acima de 3%, fazer terraço de base larga. A amostra de solo junta de 5 a 10 subamostras de 0 a 20 cm por área.
- **Vale anotar (custo/decisão):** operação, ha feitos, calcário/gesso (t/ha), máquina, implemento e horas, equipe. Tudo isso já cabe no formulário.
- **Opcional:** profundidade (cm) na subsolagem ou aração; se houve análise de solo (data ou foto do laudo).
- **Unidades e época:** ha, t/ha, horas, cm; antes do plantio, com folga para o calcário reagir.

### 1.2 Formação de pastagem (plantio)
- **Operações:** semeadura a lanço (à mão ou máquina) com grade leve para cobrir; plantio em linha com semeadora-adubadora; plantio junto com lavoura (ILP, ex.: milho + braquiária); sobressemeadura; replantio de falhas.
- **Taxa de semeadura (Embrapa Gado de Corte, semente com VC de 60%):**

| Forrageira | kg/ha | Profundidade |
|---|---|---|
| Xaraés | 7,5 | 3 cm |
| Marandu, Piatã | 7,0 | 4 cm |
| Humidícola | 6,0 | 3 cm |
| Decumbens | 6,0 | 2 cm |
| Tanzânia, Mombaça, Massai | 5,0 | 3 cm |

- **VC (valor cultural)** junta pureza e germinação da semente. Os pontos de VC são os kg/ha multiplicados pelo VC: 7 kg × 60 = 420 pontos. Com VC menor, é preciso mais quilo para o mesmo resultado.
- **Vale anotar:** forrageira/cultivar; kg de semente por ha (já sai de insumo + dose/ha); método.
- **Opcional:** VC do lote (vem impresso na etiqueta do saco); cultura do consórcio, quando houver ILP.
- **Época:** com chuva regular. Formiga deve ser combatida antes.

### 1.3 Fertilização
- **Operações:** adubação de plantio; fosfatagem corretiva; adubação de manutenção ou cobertura (nitrogênio com ureia ou outra fonte, potássio, enxofre), muitas vezes dividida em parcelas.
- **Cuidados (Embrapa Pecuária Sudeste):** a ureia é a principal fonte de N em pasto tropical. A perda por volatilização vai **de 0 a 80%**. A recomendação é parcelar e incorporar a ureia ou irrigar depois de aplicar.
- **Ritmo de referência:** fazendas-modelo na Amazônia, citadas pela Embrapa Cerrados, fazem calcário a cada 3 anos, fósforo a cada 2 anos e N, K e controle de mato todo ano.
- **Vale anotar:** produto e kg/ha (já existe); finalidade (plantio, manutenção ou correção).
- **Opcional:** número da parcela (1ª, 2ª).
- **Unidades:** kg/ha ou sacos de 50 kg. Os kg/ha de N, P₂O₅ e K₂O podem ser calculados se o cadastro do produto tiver a fórmula.
- **Época:** nas águas, com solo úmido.

### 1.4 Aplicação
- **Operações:** herbicida seletivo em área total; aplicação localizada (catação, toco depois do corte, tronco); dessecação total para reforma; inseticida para cigarrinha; isca para formiga; tratamento de cupinzeiro; controle de lagarta.
- **Área total ou localizada (Embrapa Cerrados, Doc. 397):** área total se o mato cobre **mais de 40%** do pasto; aplicação dirigida se cobre menos.
- **Herbicidas de pasto:** quase todos são para folha larga (2,4-D, picloram, fluroxipir, triclopir, aminopiralide e misturas). O glifosato serve para dessecar (Embrapa Doc. 185, lista do MAPA de 2011; conferir no AGROFIT).
- **Mato comum** (bula de 2,4-D + picloram para pastagem): assa-peixe, lobeira, malva/guanxuma, fedegoso, joá-bravo, arranha-gato, unha-de-vaca, leiteiro, aroeirinha, maria-mole. Entre os tóxicos ao gado, a Embrapa cita samambaia, erva-de-rato e maria-mole.
- **Cigarrinha-das-pastagens:** *Deois flavopicta*, *Deois incompleta*, *Notozulia entreriana* e *Aeneolamia* spp. A *Mahanarva*, da cana, também passa para o pasto. Os ovos eclodem em set./out., com as primeiras chuvas. A Embrapa Rondônia manda olhar o pasto a cada 15 dias nas águas e controlar a partir de 20 a 25 ninfas por m². Há controle biológico com o fungo *Metarhizium*, e diversificar os capins ajuda.
- **Formiga cortadeira:** isca granulada aplicada com tempo seco, 15 dias antes do preparo do solo. Saúva: 10 g por m² de terra solta. Quenquém: 5 g por ninho. Voltar aos ninhos em até 6 meses (Embrapa Florestas). A bula do Mirex-S Max indica 8 g/m² para saúva.
- **Cupim de montículo:** a Embrapa Gado de Corte (2006) diz que **não há confirmação de dano direto** ao pasto. Cada cupinzeiro ocupa menos de 0,5 m², então 200 por ha tiram só 1% da área. Em pasto que vai ser reformado, não se recomenda controlar antes, porque a reforma já resolve. Quebrar com enxadão não funciona; o implemento que destrói o montículo funciona.
- **Lagartas** (lagarta-militar, curuquerê-dos-capinzais): pragas ocasionais. Controlar os focos iniciais (Embrapa, 1997).
- **Vale anotar:** alvo; produto e dose (L, mL ou kg por ha); data e hora ou turno; quando o pasto fica liberado; número do receituário (escritório).
- **Opcional:** modo (área total ou localizada); volume de calda (L/ha); tempo bom (sim/não); número de formigueiros ou cupinzeiros.
- **Época:**
  - Herbicida: na época de chuva, com temperatura média acima de 20 °C e o mato em pleno crescimento (bula Tordon). Evitar o começo da seca (Corteva).
  - Cigarrinha: início das águas.
  - Isca: tempo seco.

### 1.5 Roçada e tratos
- **Operações:** roçadeira de trator; roçada manual; catação/arranquio; destoca; rolo-faca; mata-broto; queima controlada (só com autorização).
- **Alerta (Embrapa Doc. 185):** roçar só, com manejo ruim, **aumenta o mato com o tempo**, porque o corte forte fortalece a raiz. Nas espécies difíceis, o que funciona é juntar o método mecânico e o químico.
- **Vale anotar:** método; ha realmente roçados (muitas vezes só parte do pasto); máquina e horas ou diárias.
- **Opcional:** mato principal.
- **Obrigatório se houver queima:** número da autorização ambiental.
- **Época:** não achei fonte técnica aberta com época fixa para roçada.

### 1.6 Manutenção
- **Operações (estruturas):** cerca (construir, consertar, trocar mourão, esticar fio, cerca elétrica); aceiro; estrada ou carreador; bebedouro, represa ou aguada; curral; terraço; porteira; mata-burro.
- **Aceiro:** a Lei 14.944/2024 pede largura "condizente" com o terreno e o clima, e prioriza roçadeira e trator na manutenção. Para queima controlada, o Decreto 2.661/1998 exige aceiro de no mínimo 3 m.
- **Custo:** na Embrapa Cerrados (BPD 419), o "manejo físico" (cerca, divisão, vedação) foi a intervenção mais barata (R$ 245,68/ha). Os autores avisam que muitas vezes faltava dado para calcular o custo.
- **Vale anotar:** local/estrutura; quantidade feita e unidade (km ou m de cerca, nº de mourões, m de aceiro, nº de bebedouros); material (já como insumo); equipe; máquina.
- **Unidades:** km, m, unidades, diárias.

### 1.7 Outros
- Coleta de solo, vistoria, plantio de árvores, limpeza de represa e o que não couber nos outros tipos. Leva área opcional e **Local**.

---

## 2. Exigências legais e técnicas que afetam o registro

**Receituário agronômico (Lei 14.785/2023):**
- Art. 39: o agrotóxico só é vendido com receita de profissional habilitado. A receita pode ser preventiva, antes de a praga aparecer.
- Art. 22, §5: o receituário eletrônico traz, no mínimo, o usuário, a cultura, a área tratada, o produto e a quantidade.
- Para o MAIKE: guardar o **nº do receituário** na Aplicação, preenchido pelo escritório.

**Registro de aplicação:**
- O Art. 25 obriga empresas a manter "livro de registro ou outro sistema de controle": produtor pessoa jurídica, comerciante e prestador de serviço.
- **Não achei** artigo que obrigue o produtor pessoa física a manter caderno de aplicações.
- A **NR-31, item 31.7.7**, obriga o empregador a informar a todos os trabalhadores:
  - a área tratada (local, tipo de aplicação, equipamento);
  - o nome comercial do produto e a classe toxicológica;
  - a **data e hora** da aplicação;
  - o **intervalo de reentrada** e a **carência**;
  - as medidas de proteção e o que fazer em caso de intoxicação.
- O registro de Aplicação do MAIKE já é quase esse aviso. Faltam hora (ou turno), reentrada e carência.

**Outros pontos da NR-31 (item 31.7):**
- É proibido manipular agrotóxico quem tem menos de 18 anos, mais de 60, gestante ou lactante.
- É proibido trabalhar na área antes do fim da reentrada sem o EPI indicado, e reutilizar embalagens.
- Quem tem exposição direta precisa de **capacitação de no mínimo 20 h**.
- O empregador fornece o EPI limpo e cuida da descontaminação.
- A área tratada deve ser sinalizada com o período de reentrada.

**Carência e reentrada (bulas reais abertas):**

| Produto (ingrediente, empresa) | O que a bula diz para pastagem |
|---|---|
| Tordon (2,4-D + picloram, Corteva) | Carência "UNA – uso não alimentar". Em área total, deixar o capim se recuperar antes de abrir ao gado. Reentrada: 5 dias (2 h de trabalho) ou 23 dias (8 h). Esterco de gado que pastou ali: não usar em cultura sensível por 60 dias. |
| Tordon HL (Corteva) | Reentrada 5 ou 23 dias. Não informa prazo para o gado. |
| 2,4-D + Picloram CAC | Vedar o pasto até o capim se recuperar. Reentrada 5 ou 23 dias. **Proíbe aplicação com costal ou equipamento manual.** |
| Pastejo (fluroxipir + picloram, Adama) | "UNA". Vedar ao gado até a recuperação. Reentrada: 24 h, depois de a calda secar. |
| Nepaxir (acetamiprido + alfa-cipermetrina, BASF), para cigarrinha | **Carência de 3 dias.** Reentrada: 24 h, depois de a calda secar. 300 a 400 mL/ha em 200 L/ha de calda. No máximo 1 aplicação por ciclo. |
| Mirex-S Max (sulfluramida, isca) | Carência e reentrada "não estabelecido", pelo modo de uso. A versão em sachê **não deve ser usada em pastagens**. |

- Para o Fastac Duo (cigarrinha), a página aberta não mostrava o número de dias. **Não achei.**
- Um artigo da Corteva sobre cigarrinha dá como regra geral "uma semana para gado de corte, duas para leite". Isso não bate com os 3 dias do Nepaxir: **a carência é do produto**, não do tipo de serviço.

**Condições de aplicação de herbicida (bulas e Corteva):**
- Temperatura abaixo de 30 °C e umidade do ar acima de 60%.
- Vento entre 3 e 10 km/h, sem orvalho e fora das horas mais quentes.
- Sem chuva depois de aplicar: 2 a 3 h (Tordon), 4 h (Tordon HL), 6 h (2,4-D + Picloram CAC) ou 3 a 4 h (Corteva).
- Isca: não aplicar com chuva ou com ameaça de chuva.

**Embalagens vazias:**
- Pela Lei 14.785/2023 (art. 41, §2), devolver embalagens, tampas e restos onde comprou, ou em posto, central ou recolhimento itinerante, **em até 1 ano da compra** (ou do vencimento).
- A NR-31 proíbe reutilizar a embalagem.
- Sugestão para o sistema: uma foto do comprovante de devolução.

**Queima controlada:**
- A Lei 14.944/2024 (art. 30) só permite fogo em prática agropastoril com **autorização prévia do órgão ambiental para cada imóvel**.
- O Decreto 2.661/1998 (art. 4º) pede aceiro de no mínimo 3 m, aviso formal aos vizinhos, dia e horário apropriados e atenção ao vento. O Planalto mostra o decreto em vigor, com alteração parcial.
- As regras estaduais variam.

---

## 3. Indicadores que esses registros permitem

- **Custo por hectare por tipo:** insumos + horas de máquina + diárias + terceiro, divididos pelos **ha realmente trabalhados**. Se só a área cheia do pasto for usada, a roçada parcial sai barata demais.
- **Custo por operação:** quanto custou o "Combate contra cigarrinha" no ano, por pasto e por ha.
- **Custo por km de cerca ou m de aceiro:** depende de anotar a quantidade feita.
- **Reforma, recuperação ou manutenção:** depende de marcar a que o serviço pertence. Pela Embrapa, recuperar é restabelecer o pasto com a **mesma** espécie; renovar ou reformar é trocar a espécie.
- **Referência de custo (Embrapa Cerrados, BPD 419, Triângulo Mineiro, 2022-23), média em R$/ha:**

| Intervenção | R$/ha |
|---|---|
| ILP | 5.348,94 |
| Todos os tratos | 4.847,67 |
| Só corretivo/adubo | 2.667,38 |
| Só plantio de semente | 1.245,47 |
| Manejo físico | 245,68 |

- No mesmo estudo, por grupo de atividade:

| Grupo de atividade | R$/ha |
|---|---|
| Corretivos e fertilizantes | 511,46 |
| Diversas | 473,99 |
| Plantio | 344,30 |
| Preparo do solo | 199,74 |
| Adequação de manejo | 123,72 |
| Colheita | 120,00 |
| Controle de invasoras/pragas | 96,38 |

  Esses grupos **batem quase um a um com os 7 tipos do MAIKE**. Outro estudo citado ali mostra que adubo e semente passam de 50% do custo.
- **Histórico do pasto:** forrageira atual e data do plantio; última calagem, fosfatagem e adubação com N; últimas aplicações e o alvo; "liberado em".
- **Avisos configuráveis:** por exemplo, "calcário há mais de 3 anos" e "fósforo há mais de 2", pelas fazendas de referência acima. São parâmetros, não regra.
- **Planejado × realizado:** o Aegro compara automaticamente o orçado e o realizado por talhão à medida que as atividades são concluídas.
- **O que as referências mostram:**
  - **Aegro:** custo por talhão e por ha; baixa do estoque na realização; realização parcial com status Em progresso, Revisar e Concluída; app de campo que funciona sem sinal e sincroniza depois; Aegrozap, assistente no WhatsApp que monta o registro e espera confirmação.
  - **JetBov de Pasto:** mapa de piquetes, tarefas para a equipe com prazo e registros sem internet.
  - **iRancho e Prodap:** **não achei** material público detalhando o registro de operações em pasto.

---

## 4. UX para baixa escolaridade e pouca prática com celular

### 4.1 Números do campo

| Dado | Valor | Fonte |
|---|---|---|
| Usuários de internet (10 anos ou mais), zona rural | 82% (urbana 90%) | TIC Domicílios 2024, C2A |
| Usuários rurais que só usam o celular | 82% | TIC 2024, C16A |
| Uso de internet entre analfabetos/ed. infantil | 40%; destes, 98% só pelo celular | TIC 2024 |
| Pessoas com 60 anos ou mais que usam internet | 63% | TIC 2024 |
| Produtores que não sabem ler e escrever | 23% | Censo Agro 2017 |
| Nunca foram à escola / no máximo o fundamental | 15,5% / 79,1% | Censo Agro 2017 |
| Produtores com internet (2017) | 1,43 mi de 5,07 mi estabelecimentos (cerca de 28%) | Censo Agro 2017 |
| Analfabetos funcionais de 15 a 64 anos | 29% (27% entre trabalhadores) | Inaf 2024 |
| Pesquisa ABMRA 2025 (preliminar, 3.100 produtores) | internet em 98% das propriedades; WhatsApp usado por 96% | Forbes Agro |

Cuidados ao ler esses números:
- São dados de **produtores** ou da população, não de peões.
- Ter internet **na propriedade** não quer dizer ter sinal **no pasto**. Por isso o lançamento precisa funcionar sem internet.

### 4.2 Evidências

**Medhi et al., 2011 (revista ACM TOCHI):** 90 pessoas de baixa escolaridade na Índia, Quênia, Filipinas e África do Sul, mais 70 na Índia.
- Interface de texto é **inutilizável** para quem é pouco letrado e usa pela primeira vez. Mesmo quem lê, sendo novato, erra.
- 56 de 90 não conseguiram navegar menus em árvore, e 48 não entenderam a barra de rolagem.
- No lançamento de dados de saúde por 13 pessoas que sabiam ler, o erro foi de 4,2% no formulário e 4,5% por SMS. **Com um atendente humano, caiu para 0,45%.**
- A interface gráfica teve a maior taxa de conclusão. A de voz foi mais rápida para quem a entendeu.
- Recomendações dos autores:
  - dicas gráficas;
  - áudio de apoio;
  - idioma local;
  - poucos níveis de menu;
  - evitar digitar texto;
  - evitar listas que precisam rolar;
  - ter **pessoas que ensinem e acompanhem**.
- Limite: o estudo é de celular de teclas, não de smartphone. Mesmo assim, as recomendações valem.

**Nielsen Norman Group, 2005:** quem tem pouca leitura lê palavra por palavra, perde o lugar ao rolar a tela e erra a grafia. A recomendação é a ideia principal no topo, uma coluna e menu linear. Com isso, o acerto desse público subiu de 46% para 82%.

**Padrão "o campo lança, o escritório confere":** **não achei estudo brasileiro** sobre isso. A evidência é indireta:
- o atendente humano de Medhi, que reduziu o erro em 10 vezes;
- o status "Revisar" do Aegro antes de concluir;
- o Aegrozap, que pergunta o que falta e só salva depois da confirmação.

### 4.3 Boas práticas para o MAIKE
- Uma pergunta por tela, com botões grandes de ícone e 1 ou 2 palavras.
- Linguagem do campo: "Plantar capim", "Adubar", "Roçar/limpar", "Consertar cerca". Testar as palavras com a equipe antes de fixar.
- Valores padrão:
  - data: hoje;
  - equipe: quem está lançando;
  - máquina: a última usada;
  - local de estoque: o depósito da fazenda.
- Números só inteiros e na **unidade da embalagem** (sacos, galões, litros), com botões + e −. O sistema calcula a dose por ha.
- Nada de texto obrigatório. A observação pode virar foto ou áudio (recurso novo).
- Antes de enviar, um resumo com ícones e números grandes.
- Funcionar sem internet e sincronizar depois.
- WhatsApp como modelo mental: mandar e ver "enviado".
- Treinamento: um "padrinho" por fazenda e 15 a 20 minutos no próprio celular do funcionário. Testar com 3 a 5 pessoas antes de fechar o desenho.

---

## 5. Recomendação para o MAIKE

### 5a. Campos extras por tipo

| Tipo | Campo extra | Obrig.? | Por quê |
|---|---|---|---|
| Todos | Ha feitos (padrão = ha do pasto, editável) | Opcional | Custo/ha certo quando só parte do pasto foi feita |
| Todos | Faz parte de: Reforma / Recuperação / Rotina | Opcional | Indicador de reforma × manutenção |
| Todos | Foto | Opcional (novo) | Prova e conferência |
| Preparo do solo | (nenhum novo; calcário e gesso já entram como insumo) | — | Formulário atual basta |
| Formação | **Forrageira/cultivar** (lista curta + "Outra") | **Obrigatório** | Define o pasto e o histórico; separa recuperação de reforma |
| Formação | Método: lanço / linha / com lavoura (ILP) / sobressemeadura | Opcional | Explica falha de formação |
| Formação | VC da semente (%) | Opcional (escritório) | Calcula pontos de VC/ha |
| Formação e Fertilização | Safra | **Automático pela data** | Peão não sabe; o sistema calcula o ano agrícola |
| Fertilização | Finalidade: plantio / manutenção / correção | Opcional | Separa investimento de custeio |
| Aplicação | **Alvo** (lista abaixo + "Outro") | **Obrigatório com agrotóxico ou isca**, já preenchido pela operação | Relatório, receita, aviso NR-31 |
| Aplicação | **Pasto liberado em** | Automático; escritório confirma | Informação do pasto; a carência muda por produto |
| Aplicação | Modo: área total / localizada / toco / isca | Opcional | Custo e eficácia |
| Aplicação | Nº do receituário | Opcional (escritório) | Lei 14.785 |
| Aplicação | Hora ou turno | Opcional | A NR-31 pede data e hora |
| Roçada e tratos | Método (lista) | Opcional; pode vir da operação | Roçar só não resolve; compara métodos |
| Roçada e tratos | Nº da autorização de queima | **Obrigatório se for queima** | Lei 14.944/2024 |
| Manutenção e Outros | Área | Opcional | Cerca e estrada nem sempre são pasto |
| Manutenção e Outros | **Local** (lista: cerca, aceiro, estrada, água, curral, terraço, outro + texto) | **Obrigatório se não houver área** | Saber onde foi |
| Manutenção | Quantidade feita + unidade (km, m, unidade) | Opcional, recomendado | Custo por km ou por unidade |

**Respostas diretas**
- **A forrageira deve ser obrigatória na Formação?** Sim. Sem ela, o histórico do pasto perde o principal e não dá para separar reforma de recuperação. Para não pesar no campo, ela pode vir preenchida pela semente lançada como insumo, se o cadastro do produto disser a cultivar.
- **Lista curta de alvos para Aplicação:**
  1. Mato (folha larga)
  2. Dessecar tudo (reforma)
  3. Cigarrinha
  4. Formiga
  5. Cupim
  6. Lagarta
  7. Outro (escrever)

  É **lista fechada + "Outro"**: texto livre gera "sigarrinha", "cigarinha" e estraga o relatório, e esse público erra a grafia. O "qual mato" (assa-peixe, lobeira, malva/guanxuma, fedegoso, arranha-gato, leiteiro, samambaia) pode ser um segundo nível opcional para o escritório. O melhor é **gravar o alvo no cadastro da operação** ("Combate contra cigarrinha" leva Cigarrinha), e o peão nem vê a pergunta.
- **Vale o campo "gado pode voltar ao pasto em <data>"?** Sim, com o nome **"Pasto liberado em"** e aparecendo no mapa como "vedado até dd/mm". Ele deve ser **calculado** pela data de término mais a maior carência entre os produtos usados, que fica no cadastro do produto (novo). Se a bula disser "UNA" ou "não determinado" (caso dos herbicidas de pasto, em que o capim precisa se recuperar), o escritório informa a data à mão. O sistema não deve inventar prazo padrão.

### 5b. "Modo campo" para o funcionário

**Passos (uma tela por passo):**
1. No **Mapa**, tocar no pasto. Para cerca ou estrada fora de pasto, o botão é "Outro lugar".
2. **"O que foi feito?":** 7 botões grandes com ícone.
3. **"Qual serviço?":** as operações da fazenda, as mais usadas primeiro, até 6 na tela.
4. **"Usou produto?":** Não ou Sim. Se sim, tocar no produto e informar **quantos** sacos ou litros, com + e −.
5. **"Quem trabalhou?":** a própria pessoa já vem marcada. **"Usou máquina?":** a última já vem marcada; o horímetro é opcional (ou foto, recurso novo).
6. **"Terminou?":** "Sim, hoje" ou "Ainda não".
7. **Resumo com ícones e botão "Enviar".** Aparece "Enviado. O escritório vai conferir."

**O escritório completa:**
- local de estoque, preço e custo, serviço de terceiro;
- nº do receituário, VC da semente;
- conferência das quantidades e dos ha;
- horas e diárias exatas;
- "Pasto liberado em", quando a bula não traz número.

**O que já cabe hoje × o que é novo** (olhei o código só para leitura; confirmar com quem desenvolve):

| Já existe | Seria novo |
|---|---|
| Tipo, áreas, operação, datas, insumo e quantidade, máquina e horímetro, equipe, terceiro, observação | Tela passo a passo com ícones (o formulário atual é para o escritório) |
| Status Aberta/Concluída/Cancelada e apontamentos por dia e turno (código) | Status "a conferir / conferido" (ou combinar o uso de "Aberta" para isso) |
| As Tarefas do mapa já salvam **offline com fotos** (código, IndexedDB) | Offline e foto no **registro de campo**, reaproveitando o que as Tarefas já fazem |
| Cadastro de operações | Alvo e método gravados na operação, para preencher sozinho |
| Cadastro de produtos | Carência, unidade da embalagem e cultivar (semente) no produto; cálculo de "Pasto liberado em" e da dose/ha |
| — | Áudio na observação |

---

## Onde as fontes discordam

- **Prazo para o gado voltar:**
  - herbicidas de pasto (Tordon, Pastejo, 2,4-D + picloram): sem número de dias, "vedar até o capim se recuperar";
  - Nepaxir: 3 dias;
  - artigo da Corteva: "uma semana para corte, duas para leite", como regra geral.
  - Conclusão: o prazo vem **sempre da bula do produto**.
- **Chuva depois do herbicida:** de 2 a 3 h (Tordon) até 6 h (2,4-D + Picloram CAC).
- **Vento:** 3 a 10 km/h (Tordon) e 2 a 10 km/h (Corteva).
- **Quando controlar a cigarrinha:** a Embrapa Rondônia manda começar com 20 a 25 ninfas/m². A Corteva chama 25/m² de "caso extremo" e sugere aproveitar o pasto antes.
- **Cupim de montículo:** a Embrapa (2006) diz que o dano não é confirmado e não recomenda controle antes de reforma. O mercado trata como praga a controlar.
- **Isca para saúva:** 10 g/m² (Embrapa Florestas) contra 8 g/m² (bula Mirex-S Max).
- **Acesso à internet:**
  - Censo 2017: cerca de 28% dos produtores;
  - TIC 2024: 82% dos moradores rurais;
  - ABMRA 2025: 98% das propriedades.
  - As bases e os anos são diferentes, então não dá para comparar direto.
- **Cuidado com a idade das fontes:** várias da Embrapa são antigas (lagartas, 1997; cupins, 2006; lista de herbicidas, 2011). Os registros de produtos mudam, então conferir no AGROFIT.

---

## Fontes (todas abertas nesta pesquisa)

**Embrapa**
- Embrapa Gado de Corte, folder "Formação de pastagens": https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/984948/1/Foramacaodepastagens.pdf
- Embrapa Cerrados, Doc. 397 (2022), recuperação e renovação: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1152245/1/Doc-397-web.pdf
- Embrapa Cerrados, BPD 419 (2024), custos de intervenção: https://ainfo.cnptia.embrapa.br/digital/bitstream/doc/1172478/1/Bolpd-419-CPAC.pdf
- Embrapa Gado de Corte, Doc. 185 (2011), plantas daninhas: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/920044/1/DOC1851.pdf
- Embrapa Gado de Corte, Doc. 160 (2006), cupins-de-montículo: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/326890/1/DOC160.pdf
- Embrapa Florestas (2014), formigas em iLPF: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1003116/1/2014folderttformigas.pdf
- Embrapa Gado de Corte (1997), lagartas das pastagens: https://www.infoteca.cnptia.embrapa.br/infoteca/handle/doc/321423
- Embrapa Pecuária Sudeste, lâmina sobre adubação nitrogenada: https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1093328/1/LaminasPecus5.pdf
- Embrapa Rondônia sobre cigarrinha (Revista Cultivar, 2011): https://revistacultivar.com.br/noticias/cigarrinhas-das-pastagens-comecam-ataque-no-periodo-chuvoso

**Corteva**
- Cigarrinhas: https://www.corteva.com/br/coeficiente-agro/artigos/cigarrinhas-das-pastagens-controle.html
- Herbicidas em pastagem: https://www.corteva.com/br/coeficiente-agro/artigos/5-dicas-para-o-uso-de-herbicidas-em-pastagens.html

**Bulas**
- Tordon: https://revistacultivar.com.br/pesticida/tordon
- Tordon HL: https://www.agrolink.com.br/agrolinkfito/produto/tordon-hl_11656.html
- 2,4-D + Picloram CAC: https://www.agrolink.com.br/agrolinkfito/produto/2-4-d---picloram-cac_13456.html
- Pastejo: https://revistacultivar.com.br/pesticida/pastejo
- Nepaxir (BASF): https://download.basf.com/p1/8a8082e883656fb20183a3f3c2700923/pt/Nepaxir%C2%AE_-_Bula_Flyer_portugu%C3%AAs.pdf
- Fastac Duo: https://www.agrolink.com.br/agrolinkfito/produto/fastac-duo_8906.html
- Mirex-SH / Mirex-S Max: https://www.agrolink.com.br/agrolinkfito/produto/mirex-sh_3241.html

**Leis e normas**
- Lei 14.785/2023: https://planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14785.htm
- NR-31 atualizada (MTE): https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes/nr-31-atualizada-2024.pdf
- Lei 14.944/2024: https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l14944.htm
- Decreto 2.661/1998: https://www.planalto.gov.br/ccivil_03/decreto/d2661.htm

**Dados de acesso e escolaridade**
- TIC Domicílios 2024, C2A: https://www.cetic.br/en/tics/domicilios/2024/individuos/C2A/
- TIC Domicílios 2024, C16A: https://www.cetic.br/en/tics/domicilios/2024/individuos/C16A/
- Censo Agro 2017 (Revista Cultivar): https://revistacultivar.com.br/noticias/censo-agropecuario-mostra-radiografia-do-campo
- Censo Agro 2017 (Brasilagro): https://www.brasilagro.com.br/conteudo/censo-mostra-pais-rural-com-pouca-orientacao-tecnica-e-baixa-alfabetizacao-.html
- Inaf 2024 (Agência Brasil): https://agenciabrasil.ebc.com.br/educacao/noticia/2025-05/tres-cada-10-brasileiros-sao-analfabetos-funcionais-0
- ABMRA 2025 (Forbes Agro): https://forbes.com.br/forbesagro/2025/09/internet-atinge-98-das-propriedades-e-whatsapp-vira-principal-canal-do-agro-diz-nova-pesquisa-abmra/

**UX**
- Medhi et al. (2011): https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf
- Nielsen Norman Group (2005): https://www.nngroup.com/articles/writing-for-lower-literacy-users/

**Softwares de referência**
- Aegro, realização de atividades: https://aegro.com.br/suporte/safras/como-realizar-e-concluir-atividades-no-aegro/
- Aegrozap: https://aegro.com.br/suporte/aegrozap/planejar-atividades-da-safra-pelo-aegrozap/
- Aegro Campo: https://aegro.com.br/produtos/aplicativo-aegro-campo/
- JetBov de Pasto: https://apps.apple.com/app/id6447628321

**Não achei:** prazo de carência em dias do Fastac Duo; norma que obrigue o produtor pessoa física a manter caderno de aplicação; época fixa de roçada em fonte técnica aberta; material público da Prodap e do iRancho sobre registro de operações em pasto; estudo brasileiro sobre o fluxo "campo lança, escritório confere".
