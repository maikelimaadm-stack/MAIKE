# 00 — Constituição MAKGESTAO

**Status:** Oficial · **Versão:** 1.0.0

---

## 1. Missão

Construir o MAIKE como um sistema nativo, escalável e exclusivamente focado em
**Pecuária — Mapa Geral + Manejo**, com o padrão arquitetural validado no
PROJETOMG, removendo integralmente a dependência da Base44.

**Expansão autorizada pelo proprietário (D-PROD-146):** cadastros de **Gestão Rural** —
Parceiros, Centros de Custo e Centros de Resultado, com o vínculo entre os centros —
**sem financeiro transacional** (nada de naturezas, plano de contas, lançamentos,
contas a pagar/receber, compras ou movimento de estoque nesta expansão).

**Expansão autorizada pelo proprietário (D-PROD-153):** cadastro de **Naturezas
Financeiras gerenciais** (RECEITA/DESPESA, com hierarquia) para classificar
futuras receitas e despesas. É catálogo, não plano de contas contábil: continua
**sem** lançamentos, valores, saldos, caixa/bancos, tributos, compras, contas a
pagar/receber e sem efeito em estoque ou mapa.

**Expansão autorizada pelo proprietário (D-PROD-155):** **Central Única de
Lançamentos gerenciais** (página `LancamentosFinanceiros`, missão
MAIKE-GESTAO-P3-01): um documento a pagar ou a receber, com ou sem produtos, com
rateio global por natureza e centros, títulos/parcelas e liquidação manual
registrada pelo usuário. O lançamento só mexe no estoque ao ser **confirmado**
(entrada na compra, saída FIFO na venda) ou cancelado (estorno), por um comando
composto; não há tela avulsa de entrada, e a suplementação e a transferência do
Mapa Geral continuam como estão. Continua **fora**: conciliação, bancos/OFX, caixa/bancos,
DRE, plano de contas, fiscal/tributos/NF-e, câmbio, contabilidade, rateio por
item, pedido de compra e relatórios/dashboards financeiros. O MAIKE não volta a
ser ERP amplo. Texto redigido pelo agente; vale com a aprovação explícita do
proprietário no merge manual (§4).

**Expansão autorizada pelo proprietário (D-PROD-157):** **Patrimônio e Frota —
cadastros** (missão MAIKE-PATRIMONIO-P1-01): bens patrimoniais (benfeitorias,
máquinas, veículos, implementos e equipamentos) com código patrimonial e código de
frota, catálogos de famílias, tipos, perfis de medição e combustíveis, medições
físicas, medidores de uso, tanques com combustíveis permitidos, o vínculo de cada
combustível aos Produtos da fazenda (só cadastro, sem baixa, custo nem conversão de
unidade) e parâmetros de depreciação com prévia **só simulada**. Continua **fora**: abastecimento,
manutenção, peças, baixa de estoque, ordens de serviço, custo/hora, apuração ou
lançamento de depreciação, transferência entre fazendas e qualquer efeito
financeiro ou de estoque. Texto redigido pelo agente; vale com a aprovação
explícita do proprietário no merge manual (§4).

**Expansão autorizada pelo proprietário (D-PROD-159):** **Patrimônio e Frota —
Abastecimentos** (página `Abastecimentos`, missão MAIKE-PATRIMONIO-P1-02): o abastecimento
de um bem com baixa **física real** do combustível no estoque em KG, pelo motor de estoque
existente (FIFO por lote, custo FIFO final, estorno exato no cancelamento), convertendo os
litros por um fator kg/L **informado pelo responsável** e versionado por produto da fazenda
(nunca 1 L = 1 KG nem densidade presumida); a leitura do medidor fica no próprio
abastecimento e o consumo (km/L, L/h) só é calculado com dois tanques cheios declarados.
Esta é a única exceção à lista "fora" da D-PROD-157, e só no trecho abastecimento/baixa de
estoque de combustível. Continua **fora**: lançamento financeiro do abastecimento,
manutenção, peças, ordens de serviço, compras, custo/hora, apuração ou lançamento de
depreciação, transferência entre fazendas, saldo de tanque, mapas e dashboards. Texto
redigido pelo agente; vale com a aprovação explícita do proprietário no merge manual (§4).

**Revisão autorizada pelo proprietário (D-PROD-162):** **Patrimônio e Frota simplificado**
(missão MAIKE-PATRIMONIO-SIMPLIFICA-01). Ficam só duas páginas: `BensPatrimoniais` e
`Abastecimentos`. Famílias e tipos continuam como dados do tenant, criados e mantidos
**dentro** do cadastro de Bens. Saem os perfis de medição, as medições físicas de
benfeitoria, o catálogo de combustíveis, o vínculo combustível × produto e o fator kg/L.
Cada tanque do bem aceita Produtos do estoque. O abastecimento baixa do estoque
**exatamente** a quantidade digitada, na unidade de estoque do Produto (litros `L` ou
quilos `KG`), sem nenhuma conversão entre unidades. A capacidade do tanque, em litros, só
é conferida para Produto em litros; Produto em quilos pode ser aceito num tanque, e então
a capacidade não é conferida. O Produto e a compra/venda da Gestão P3 passam a aceitar a
unidade `L`; KG e SACO continuam como antes. Por decisão única do proprietário, a
migration da D-PROD-162 apagou as tabelas do Patrimônio de todos os clientes, com recusa
se houvesse abastecimento CONFIRMADO. Nos dois parágrafos acima, esta revisão supera:
"perfis de medição", "medições físicas", "combustíveis" como catálogo, "tanques com
combustíveis permitidos", "o vínculo de cada combustível aos Produtos", "no estoque em KG"
e "convertendo os litros por um fator kg/L". O resto deles continua valendo, inclusive as
listas "fora". Texto redigido pelo agente; vale com a aprovação explícita do proprietário
no merge manual (§4).

**Expansão autorizada pelo proprietário (D-PROD-177):** **Estoque — entrada manual
documentada** (missão MAIKE-ESTOQUE-P1). Além da compra confirmada da Central Única de
Lançamentos, a quantidade de estoque também pode nascer de um **documento de Entrada de
Estoque** confirmado, só pelo motor de estoque único e só por um destes motivos fechados:
saldo de implantação, doação e outra causa com justificativa e permissão própria. Há no
máximo uma implantação ativa por produto e empresa, e ela só é aceita se o produto não
tiver nenhum histórico físico em nenhum local; os fatos de itens de entrada manual já
estornados por edição ou exclusão, que por regra nunca tiveram consumo, não contam como
histórico. Corrigir quantidade, custo, unidade, fator, parceiro ou documento da própria
implantação, no mesmo produto, local e data, não é implantar de novo, mesmo que o produto
tenha fatos posteriores; trocar produto, local ou data dela exige que não haja outro
histórico além dos fatos dela mesma. Doação e outra causa não servem para registrar saldo antigo. A entrada manual
não é compra, não cria título, conta a pagar nem receita, e não pode duplicar um
lançamento da Central nem outra entrada: com o mesmo parceiro e documento, um bloqueia o
outro, nos dois sentidos. O usuário pode **editar** e **excluir** a entrada; o motivo
dela nunca muda. O rascunho não mexe no estoque. Na entrada confirmada, editar
quantidade, custo, unidade, fator, produto, local, data, parceiro ou documento, incluir
ou retirar item, ou excluí-la, só é aceito quando nenhuma camada de nenhum item dela foi
consumida, transferida ou citada por outro fato, mesmo que depois estornado; com essa
dependência, só se editam observação e justificativa. Ao confirmar ou editar, nenhuma
camada nova pode ficar, na fila FIFO do produto no local, à frente de camada que alguma
baixa já tocou: o motor não refaz nem recalcula baixas, e a mudança que faria isso é
recusada. Quando não for possível comprovar que nenhuma camada foi usada, ou quando o
saldo do produto divergir das camadas, a mudança também é recusada. A edição vira uma nova revisão do mesmo documento, que estorna pelo motor o que
muda e aplica a versão nova numa só transação; a exclusão estorna tudo e deixa o
documento EXCLUÍDO, fora da lista ativa mas consultável. Nenhum movimento ou camada de
estoque é reescrito ou apagado; cada revisão e cada exclusão da entrada confirmada ficam
registradas com autor, data, motivo e valores antes e depois. Não há estorno parcial de
camada nem exclusão parcial do documento. O Cadastro de Produtos continua sem lançar
estoque. Continua **fora**: entrada por compra fora da Central, ajuste ou inventário,
devolução, transferência entre empresas, entrada por nota fiscal, edição de saldo e
qualquer escritor genérico de estoque. O MAIKE não volta a ser ERP amplo. Nesta parte,
esta expansão supera apenas o trecho "não há tela avulsa de entrada" da expansão
D-PROD-155; o resto da D-PROD-155 continua valendo. Texto proposto pelo agente; vale só
com a aprovação explícita do proprietário (§4), registrada como ratificação na D-PROD-177.

**Expansão autorizada pelo proprietário (D-PROD-193):** **Apontamento de Atividade — itens** (página
`ApontamentosAtividade`, Fatia D do apontamento). O apontamento confirmado recebe itens de custo. O item
**PRODUTO** baixa do estoque **exatamente** a quantidade digitada, na unidade de estoque do Produto, pelo motor de
estoque existente (FIFO por lote, custo FIFO final, estorno exato ao cancelar o item ou o apontamento), como o
abastecimento. Os itens **SERVIÇO** e **OUTRO** têm descrição livre, quantidade e valor unitário, com total
calculado, sem cadastro de serviço, sem fornecedor e sem efeito de estoque. Esta é a segunda exceção à lista
"fora" da D-PROD-157, só no trecho "baixa de estoque" por item de apontamento. Continua **fora**: lançamento
financeiro, título ou conta a pagar a partir do item, rateio por item, cadastro de serviços, fornecedor no item,
devolução de sobra ao estoque, edição de item, custo/hora, manutenção, peças, relatórios de custo e qualquer
mudança no abastecimento. Nesta parte, esta expansão supera apenas o "única" do trecho "Esta é a única
exceção…" da D-PROD-159; o resto dela continua valendo. Texto redigido pelo agente; vale só com a aprovação
explícita do proprietário no merge manual (§4).

**Expansão autorizada pelo proprietário (D-PROD-202):** **Lançamento de Atividades — linhas de produto e de máquina**
(página `LancamentoAtividades`, Fatia 3). Substitui a expansão D-PROD-193 acima, cuja página e itens saíram na
D-PROD-200. A **linha de produto** do apontamento baixa do estoque **exatamente** a quantidade digitada, na unidade de
estoque do Produto, pelo motor de estoque existente (FIFO por lote, custo FIFO, origem `apontamento_atividade`). Ela
tem estorno exato ao cancelar a linha, o apontamento ou a atividade. **Editar a linha** é estorno exato mais uma nova
saída na mesma transação; nunca uma reescrita do movimento. A **linha de máquina** guarda a leitura do medidor na
própria linha, como o abastecimento; nada é gravado no cadastro do bem. O **custo de uso por hora ou km** é um campo
do cadastro do bem, copiado na linha como snapshot para o custo da atividade, sem lançamento financeiro. Continua
**fora**: lançamento financeiro, título ou conta a pagar a partir da linha, rateio, fornecedor na linha, devolução de
sobra ao estoque, manutenção, peças, relatórios de custo além do totalizador da atividade, e qualquer mudança no
abastecimento além de respeitar as leituras das linhas. Nesta parte, esta expansão supera a D-PROD-193 e o trecho
"custo/hora" da lista "fora" da D-PROD-157, só para o custo de uso como snapshot na linha de máquina. Texto redigido
pelo agente e **aprovado pelo proprietário** em 2026-11-14 ("autorizo vocÇe", resposta a "aplica e aprova"), no merge
da PR #289 (§4).

**Expansão autorizada pelo proprietário (D-PROD-207):** **Lançamento de Atividades — mão de obra e serviço de
terceiro** (página `LancamentoAtividades`, Fatia 4, e as telas de cadastro `Funcionarios` e `Servicos`). Entram dois
**cadastros mínimos por fazenda**: **Funcionário** (nome, cargo, tipo `MENSALISTA | DIARISTA | TAREFEIRO`, custo por
hora e por diária, opcionais) e **Serviço** (nome, unidade de medida do cadastro existente, centro de custo padrão e
valor de referência, opcionais). O funcionário é cadastro próprio, nunca uma conta de acesso (`Usuario`). O apontamento
recebe a **linha de mão de obra** (funcionário, hora, diária ou tarefa, quantidade e custo) e a **linha de serviço**
(serviço, quantidade, unidade e valor), como **custo da atividade**: o custo da hora ou da diária é copiado do cadastro
na linha como snapshot, e o da tarefa e o valor do serviço são digitados. O **parceiro prestador** (cadastro de
Parceiros, papel `prestador_servico`) é só uma **referência** opcional na linha de serviço. Continua **fora**: folha de
pagamento (D-PROD-02), salário, encargos, ponto, pagamento, lançamento financeiro, título ou conta a pagar a partir da
linha, rateio e contrato de serviço. Cadastro e linha nunca são apagados: o cadastro só é inativado, e a linha só é
cancelada (editar é cancelar e lançar de novo). Nesta parte, esta expansão supera o trecho "fornecedor na linha" da
lista "fora" da D-PROD-202, só para o parceiro prestador como referência na linha de serviço. Texto redigido pelo
agente; vale só com a aprovação explícita do proprietário no merge manual (§4).

## 2. Princípios fundadores

### P1 — Memória é o repositório
Nenhuma decisão vive apenas no chat. Toda decisão vai para `DECISIONS.md` com
identificador `D-xx`. Sessão nova começa lendo o repositório, não relembrando conversa.

### P2 — O molde já existe, mas é parcial
O PROJETOMG resolveu esta migração. Não se inventa arquitetura nova; replica-se a
disciplina que já funciona. Divergência do molde exige justificativa escrita.
O molde **não** inclui Studio, MDP/MMM, marketplace, runtime universal ou
low-code — ver D-PROD-03.

### P3 — Tenancy desde o primeiro dia
`cliente_id` entra em todo model **tenant-scoped** desde o início, mesmo com um
cliente único. `Cliente` é a raiz estrutural e a única exceção atual sem
`cliente_id`, porque ele é o próprio tenant. Nenhuma segunda exceção é admitida
sem decisão formal e atualização das normas e gates aplicáveis. Retrofitar
tenancy depois é o erro mais caro possível do projeto. Ver D-PROD-22.

### P4 — Independência é monotônica
O acoplamento com a Base44 só pode diminuir. Nunca aumentar. Nem temporariamente.

### P5 — Regra sem gate é sugestão
Toda regra estrutural precisa de script que reprove. Regra que depende de alguém
lembrar não é regra.

### P6 — Uma fase por vez
Fase misturada é fase perdida. Uma fase, um PR, um relatório.

### P7 — Evidência acima de afirmação
"O gate passou" só vale com a saída do comando colada. "O código faz X" só vale
com caminho de arquivo.

## 3. Hierarquia normativa

1. Esta constituição
2. `docs/constitution/07-DO-NOT-DO.md` — proibições explícitas
3. `docs/constitution/08-REGRAS-DE-IA.md` — restrições adicionais para agentes
4. `docs/engineering/DECISIONS.md` — decisões registradas
5. `docs/engineering/ROADMAP.md` — plano de execução
6. `config/mapa-manejo-scope.json` — escopo executável do produto

Em conflito, prevalece o documento de menor número.

## 4. Emenda

Alterar esta constituição exige: registro em `docs/engineering/DECISIONS.md`, justificativa escrita
e aprovação explícita do responsável pelo projeto. Agente de IA **não emenda a
constituição** — apenas propõe.
