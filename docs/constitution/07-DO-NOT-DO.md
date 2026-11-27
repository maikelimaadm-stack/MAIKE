# 07 — Lista do Que Não Fazer

**Status:** Oficial · Explícita e vinculante.
Violação exige **rollback**, não flexibilização da regra.

---

## 1. Tenancy

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D1 | Criar model tenant-scoped sem `cliente_id`, ou criar nova exceção estrutural não autorizada | Todo model tenant-scoped tem `cliente_id` obrigatório e não nulo. `Cliente` é a única exceção atual, por ser a raiz do tenant (D-PROD-22) |
| D2 | Criar `@unique` isolado em chave de negócio | `@@unique([cliente_id, ...])` |
| D3 | Criar `@@index` sem `cliente_id` como primeira coluna | Índice composto começando por `cliente_id` |
| D4 | Ler `cliente_id` de parâmetro de request | Ler do contexto de autenticação |
| D5 | Adiar tenancy "porque é um cliente só" | Implementar desde o primeiro model |

## 2. Base44

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D6 | Editar arquivos em `base44/` | Somente leitura. É a especificação de origem |
| D7 | Adicionar nova chamada ao SDK da Base44 | Nenhuma referência nova; ver D-PROD-04 |
| D8 | Aumentar o baseline do gate de Base44 | Baseline só desce |
| D9 | Remover `@base44/sdk` antes de P7 | Migrar capacidade a capacidade primeiro |

## 3. Arquitetura

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D10 | Componente React chamando dado direto | Passar por `src/apis/<modulo>/` |
| D11 | Colocar regra de negócio em componente | Service no backend |
| D12 | Repository com lógica de UI | Repository = adaptador de dados |
| D13 | Criar padrão novo quando o PROJETOMG já tem um | Copiar o molde |
| D14 | Criar solução paralela a algo existente | Estender o existente |
| D15 | Scaffold manual de módulo | Seguir a estrutura padrão de `backend/src/modules/` |

## 4. Processo

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D16 | Misturar duas missões no mesmo PR | Uma missão, um PR |
| D17 | Migrar dois módulos ao mesmo tempo | Um módulo por vez |
| D18 | Afirmar que gate passou sem rodar | Colar a saída do comando |
| D19 | Corrigir bug fora do escopo da missão | Registrar em `docs/engineering/DECISIONS.md` e seguir |
| D20 | Trabalhar na branch `main` | Branch própria por missão |

## 5. Escopo do produto

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D21 | Reintroduzir módulo fora de Mapa Geral + Manejo | Ver `config/mapa-manejo-scope.json` |
| D22 | Registrar página que não está em `allowedPages` | Atualizar o manifesto com justificativa primeiro |
| D23 | Criar schema ou function Base44 nova | Nenhuma. A Base44 só sai, nunca entra |
| D24 | Copiar Studio, MDP/MMM, marketplace ou low-code do PROJETOMG | Copiar só a disciplina (D-PROD-03) |
| D25 | Hardcodar chave ou segredo em `src/` | Variável de ambiente + `.env.example` |
| D26 | Criar segunda fonte de menu ou de rota | SSOT em `src/lib/menuConfig.js` e `src/pages.config.js` |

> **Nota (D-PROD-155):** a Central Única de Lançamentos (`LancamentosFinanceiros`)
> é a única exceção financeira autorizada, nos limites da decisão. Continua
> proibido: conciliação bancária, bancos/contas bancárias/OFX, módulo de
> caixa/bancos, DRE, plano de contas, fiscal/tributos/NF-e, câmbio, contabilidade,
> rateio por item, pedido de compra, relatórios/dashboards financeiros e ERP
> amplo; reabrir os domínios legados de `forbiddenDomains` (`Financeiro`,
> `LancamentoFinanceiro`, `ContasFinanceiras`, `CaixaBancos`, `FormasPagamento`,
> `MovimentacoesEstoque`, `LancamentoProdutosEstoque`…); criar entrada de estoque
> avulsa (tela ou rota própria) ou mover estoque a partir de um lançamento fora do
> comando composto da confirmação e do cancelamento; e somar dinheiro com float.

> **Nota (D-PROD-157, revista pela D-PROD-162):** o cadastro de Patrimônio e Frota é a
> página `BensPatrimoniais` (famílias, tipos e tanques dentro dela). Ela é a única exceção
> de máquinas/combustível autorizada, nos limites das decisões. As páginas
> `FamiliasPatrimoniais`, `TiposPatrimoniais`, `PerfisMedicao` e `Combustiveis` foram
> removidas pela D-PROD-162 e não voltam sem decisão própria.
> Continuam proibidos: reabrir as páginas legadas `CadastroMaquinas`, `AtivosFixos`,
> `LancamentosAbastecimento` e `FichaControleCombustivel`; recriar os schemas Base44
> `Maquina`, `TipoAtivo`, `Implemento`, `ManutencaoMaquina` e `AbastecimentoMaquina`;
> e, sem decisão própria, abastecimento, manutenção, custo/hora, apuração ou
> lançamento de depreciação e transferência entre fazendas.

> **Nota (D-PROD-159, revista pela D-PROD-162):** a página `Abastecimentos` é a única
> exceção de abastecimento autorizada, nos limites das decisões. O abastecimento baixa
> **exatamente** a quantidade digitada na unidade de estoque do Produto (`L` ou `KG`).
> Continua proibido:
> - converter a quantidade entre unidades, seja por `1 L = 1 KG`, por fator, por densidade
>   ou por inferência do nome, do combustível ou do preço;
> - abastecer Produto cuja unidade de estoque não seja `L` nem `KG`;
> - deixar a tela de abastecimento de Produto em `KG` sem o aviso de que se digitam quilos;
> - usar `Number`/float em quantidade ou dinheiro;
> - baixar estoque fora do motor de estoque (`estoqueFisicoMotor.js`) ou por
>   `Produto.estoque_atual -= …` isolado;
> - criar ou fingir `OperacaoFinanceira` para representar abastecimento;
> - gravar leitura de abastecimento em `BemPatrimonial` ou com proveniência falsa;
> - apagar abastecimento (só cancelar com estorno exato). A única exceção foi a limpeza
>   única da D-PROD-162, que recusaria se houvesse abastecimento CONFIRMADO;
> - conceder a tela ou a ação `cancelar` a perfis existentes por padrão;
> - reabrir `LancamentosAbastecimento`, `FichaControleCombustivel`, `AbastecimentoMaquina`,
>   `ConfiguracaoFatoresConsumo` ou as telas de combustível e fator removidas pela
>   D-PROD-162;
> - sem decisão própria: manutenção, custo/hora, saldo de tanque e abastecimento em
>   unidade que não seja `L` nem `KG` (ex.: GNV em m³).

> **Nota (D-PROD-177):** o documento de Entrada de Estoque, nos limites da decisão e da
> expansão constitucional, é a única exceção à proibição de "criar entrada de estoque
> avulsa" da nota D-PROD-155. O usuário edita e exclui a entrada; não existe "cancelar"
> como ação dela. Continua proibido:
> - lançar estoque pelo Cadastro de Produtos, por CSV, por rota genérica de movimento ou de
>   lote, ou por qualquer caminho fora do motor de estoque (`estoqueFisicoMotor.js`);
> - usar a entrada manual como compra, inventário/ajuste, devolução, transferência entre
>   empresas ou entrada por nota fiscal, ou criar, alterar ou cancelar título, conta a
>   pagar ou receita a partir dela, inclusive ao editá-la ou excluí-la;
> - usar doação ou outra causa para registrar saldo antigo (pré-existente); mudar o
>   motivo de uma entrada;
> - confirmar ou editar uma entrada manual com o mesmo parceiro e documento de um
>   lançamento confirmado da Central (a pagar ou a receber) ou de outra entrada
>   confirmada, e confirmar ou retificar (no lugar ou por substituição) na Central um
>   lançamento, a pagar ou a receber, com o mesmo parceiro e documento de uma entrada
>   confirmada;
> - ter mais de uma implantação ativa por produto e empresa, ou implantar saldo de um
>   produto que já tenha histórico físico em qualquer local, salvo os fatos de itens de
>   entrada manual já estornados por edição ou exclusão e, na revisão da própria
>   implantação, os fatos das linhas vigentes do mesmo documento (corrigir quantidade,
>   custo, unidade, fator, parceiro ou documento da implantação, no mesmo produto, local e
>   data, não é implantar de novo);
> - editar quantidade, custo, unidade, fator, produto, local, data, parceiro ou documento,
>   incluir ou retirar item, ou excluir uma entrada confirmada quando alguma camada de
>   algum item dela foi consumida, transferida ou citada por outro fato, mesmo que depois
>   estornado;
> - confirmar ou editar uma entrada manual de modo que uma camada nova fique, na fila FIFO
>   do produto no local, à frente de camada que alguma baixa já tocou, ou sem prova da
>   posição dela na fila (saída sem rastro que possa ter tocado as camadas posteriores);
> - liberar a edição ou a exclusão de uma entrada confirmada sem prova de que nenhuma
>   camada dela foi usada (rastro ilegível, origem legada ou volume acima do limite contam
>   como falta de prova), ou com o saldo do produto divergente das camadas;
> - corrigir uma entrada confirmada reescrevendo ou apagando movimento ou camada de estoque
>   (`UPDATE` de quantidade, custo, data, local, produto ou procedência, ou `DELETE`), em
>   vez de uma nova revisão pelo motor; recalcular o custo de baixas passadas;
> - editar ou excluir a entrada confirmada sem motivo, sem autor, sem versão ou sem
>   registrar os valores antes e depois; estornar camada em parte, excluir o documento em
>   parte ou restaurar entrada excluída;
> - conceder a tela ou as ações da entrada a perfis existentes por padrão;
> - reabrir qualquer nome de `forbiddenDomains` (`config/mapa-manejo-scope.json`), em
>   especial `MovimentacoesEstoque`, `LancamentoProdutosEstoque`, `RelatoriosEstoque`,
>   `Relatorios`, `Dashboard` e `Home`.

> **Nota (D-PROD-259, emenda aprovada pelo proprietário em 2026-11-19):** na nota D-PROD-177, no lugar de
> "usar a entrada manual como compra, inventário/ajuste, …", vale: usar a entrada manual como inventário/ajuste,
> devolução, transferência entre empresas ou entrada por nota fiscal, ou criar, alterar ou cancelar título, conta
> a pagar ou receita a partir dela. "Doação ou outra causa" passa a ler-se "um motivo de entrada do cadastro".
> Continua proibido mudar o motivo de uma entrada e conceder a ação `entrada` a perfis existentes por padrão.

> **Nota (D-PROD-261, emenda aprovada pelo proprietário em 2026-11-19):** na nota D-PROD-177, no lugar de
> "confirmar ou editar uma entrada manual com o mesmo parceiro e documento de um lançamento confirmado da Central
> (a pagar ou a receber) ou de outra entrada confirmada, e confirmar ou retificar (no lugar ou por substituição)
> na Central um lançamento, a pagar ou a receber, com o mesmo parceiro e documento de uma entrada confirmada",
> vale: confirmar ou editar uma entrada manual com o mesmo documento de outra entrada confirmada ou de um
> lançamento confirmado da Central com produtos (a pagar ou a receber), e confirmar ou retificar (no lugar ou
> por substituição) na Central um lançamento com produtos com o mesmo documento de uma entrada confirmada. O
> lançamento sem produtos (só o pagamento) não conflita. Continua proibido conceder a ação `entrada` a perfis
> existentes por padrão.

> **Nota (D-PROD-264, emenda aprovada pelo proprietário em 2026-11-20):** a saída manual documentada (Estoque →
> Novo movimento → Saída) é exceção à proibição de mover estoque fora dos comandos autorizados, nos limites da
> decisão. Continua proibido: baixar estoque fora do motor de estoque; digitar o valor da saída ou valorizá-la por
> outro custo que não o médio do depósito; usar a saída manual como venda, ajuste/inventário, devolução a
> fornecedor ou transferência entre empresas, ou criar título, conta a receber ou receita a partir dela; excluir
> uma saída depois de outro movimento do produto no mesmo depósito; mudar motivo, data, centros, produto,
> quantidade ou depósito de uma saída lançada; conceder a ação `saida` a perfis existentes por padrão.

> **Nota (D-PROD-271, emenda aprovada pelo proprietário em 2026-11-21):** a edição completa da entrada e da saída manual (D-PROD-271) substitui, nos limites da decisão, a regra de que o motivo da entrada nunca muda e a proibição de mudar motivo, data, centros, produto, quantidade ou depósito de uma saída lançada. Continua proibido: editar quando algo mexeu depois; editar sem motivo da edição, autor, versão ou registro do antes e do depois; reescrever ou apagar movimento ou camada de estoque em vez de estornar pelo motor; digitar o valor da saída; editar documento excluído; conceder as ações `entrada` ou `saida` a perfis existentes por padrão.

> **Nota (D-PROD-272, emenda aprovada pelo proprietário em 2026-11-20):** o ajuste de inventário documentado (Estoque → Novo movimento → Ajuste) é exceção à proibição de inventário/ajuste, nos limites da decisão. Continua proibido: ajustar estoque fora do motor ou escrevendo saldo direto; digitar o valor da sobra quando o depósito tem custo médio, ou da falta; ajustar com data diferente de hoje; usar o ajuste para devolução, transferência entre empresas ou venda, ou criar título, conta ou receita a partir dele; excluir um ajuste depois de outro movimento do produto no mesmo depósito; mudar a contagem de um ajuste lançado; conceder a ação `ajuste` a perfis existentes por padrão. A entrada manual continua não servindo como inventário/ajuste.

> **Nota (D-PROD-273, emenda aprovada pelo proprietário em 2026-11-22):** a exclusão com recálculo é exceção, nos limites da decisão, às proibições de excluir depois de outro movimento e de recalcular o custo de baixas passadas. Continua proibido: excluir quando o saldo de algum depósito ficaria negativo em algum ponto da sequência; recalcular fora do motor de estoque único ou por outra ordem que não a de lançamento; reescrever valor sem registrar o antes, o depois, o autor e o motivo; apagar fisicamente movimento ou camada; mudar preço de venda ou valor de compra; conceder ações do estoque a perfis existentes por padrão.

> **Nota (D-PROD-314, emenda aprovada pelo proprietário em 2026-11-25):** a exceção da D-PROD-273 deixa de valer para movimento com registro posterior. É proibido excluir ou cancelar um movimento de estoque quando, depois dele, no mesmo produto e depósito (na transferência, origem ou destino), há outro movimento que ainda vale. Também é proibido contornar essa recusa pelo estorno exato ou pelo recálculo do custo, inclusive na edição da linha de produto da atividade. Continuam proibidos: apagar fisicamente movimento ou camada, e mudar preço de venda ou valor de compra.

> **Nota (D-PROD-282, emenda aprovada pelo proprietário em 2026-11-23):** produto que controla lote usa o custo do lote escolhido; os demais seguem no custo médio do depósito (D-PROD-256). É exceção, nos limites da decisão, à regra de que toda saída é valorizada pelo médio do depósito. Continua proibido: reavaliar a camada de produto com lote; dar entrada em produto com lote sem o lote (ou sem a validade, quando controla); escolher lote de outro produto, empresa ou depósito; trocar "Controla lote"/"Controla validade" com saldo; recalcular por média a saída de produto com lote; excluir a entrada de um lote que já teve saída.

> **Nota (D-PROD-193):** os itens do Apontamento de Atividade são a segunda exceção, depois do abastecimento, à
> lista "fora" da D-PROD-157, só no trecho baixa de estoque, nos limites da decisão. Continua proibido: baixar o
> item fora do motor de estoque ou por `Produto.estoque_atual -= …`; gravar o movimento com a origem do
> abastecimento ou do financeiro; converter unidade; apagar ou editar item (só cancelar com estorno exato); tratar
> devolução de sobra como estorno; criar `OperacaoFinanceira`, título ou rateio a partir do item; cadastro de
> serviços ou fornecedor no item; reintroduzir as flags `exige_area`/`pode_ter_*`; conceder a tela ou as ações a
> perfis existentes por padrão. Texto redigido pelo agente; vale só com a aprovação explícita do proprietário no
> merge manual (`00-CONSTITUICAO.md` §4).

> **Nota (D-PROD-197):** a proibição de reintroduzir as flags `exige_area`/`pode_ter_*` da nota acima vale para o
> **TipoTarefa** (D-PROD-181/183) e para o **item do apontamento**. O **Tipo de Atividade** tem, por pedido expresso
> do proprietário, as 8 flags da D-PROD-197 (`exige_area`, `exige_safra`, `exige_maquina`, `permite_implemento`,
> `permite_produto`, `permite_servico`, `permite_mao_obra`, `exige_producao`), sem os nomes aposentados
> `pode_ter_*`. Continua proibido: qualquer flag no TipoTarefa; flag digitada no lançamento no lugar da do tipo;
> lista fixa ou cadastro novo de unidade (a unidade de produção é `UnidadeMedida`). Texto redigido pelo agente; vale
> só com a aprovação explícita do proprietário no merge manual (`00-CONSTITUICAO.md` §4).

> **Nota (D-PROD-202):** as linhas de produto do Lançamento de Atividades substituem os itens da D-PROD-193. Continua
> proibido:
> - baixar fora do motor de estoque, ou por `Produto.estoque_atual -= …`;
> - gravar o movimento com a origem do abastecimento ou do financeiro;
> - converter unidade;
> - editar a linha sem o estorno exato da anterior;
> - apagar linha (só cancelar com estorno exato);
> - tratar devolução de sobra como estorno;
> - gravar a leitura da linha de máquina em `BemPatrimonial.medidor_*`;
> - deixar o medidor andar para trás;
> - aceitar salto acima do teto do tipo do bem sem justificativa;
> - criar `OperacaoFinanceira`, título ou rateio a partir da linha;
> - conceder as ações de linha a perfis existentes por padrão.
>
> Texto redigido pelo agente e **aprovado pelo proprietário** em 2026-11-14 ("autorizo vocÇe", resposta a
> "aplica e aprova"), no merge da PR #289 (`00-CONSTITUICAO.md` §4).

> **Nota (D-PROD-310, emenda aprovada pelo proprietário em 2026-11-25):** na linha de produto da atividade, no cocho e na
> transferência entre depósitos, a quantidade pode ser digitada numa unidade de conversão do cadastro do produto
> (D-PROD-288), e o servidor a converte para a unidade de estoque pelo fator cadastrado. É exceção, só nesses três
> lançamentos, ao "converter unidade" das notas D-PROD-193 e D-PROD-202 acima. Continua proibido: converter no
> **abastecimento** (nota D-PROD-159/162, inteira); converter por fator que não seja o do cadastro do próprio produto
> (digitado na tela, de outro produto, de unidade desativada ou desconhecida); converter fora do servidor ou deixar a
> quantidade do movimento noutra unidade que não a de estoque; recalcular o lançamento já gravado pelo fator novo do
> cadastro (editar e reenviar mantêm o fator gravado); converter entre KG e L.

> **Nota (D-PROD-371, emenda aprovada pelo proprietário em 2026-11-27):** o estoque fica na Unidade de Medida do
> cadastro do produto (KG, L, SC, UN, CX...). Continua proibido:
> - trocar a unidade de estoque de produto que já tem lote, movimento ou item de lançamento;
> - converter entre KG e L;
> - abastecer produto cuja unidade de estoque não seja L nem KG;
> - pôr no cocho, ou somar no nível do depósito, produto sem "kg por unidade de estoque" (sem conversão KG no
>   cadastro);
> - rotular movimento, saldo ou lote com unidade diferente da unidade de estoque do produto.

> **Nota (D-PROD-207):** os cadastros mínimos de **Funcionário** e de **Serviço**, por fazenda, e as linhas de mão de
> obra e de serviço do Lançamento de Atividades existem só como **custo da atividade** (snapshot na linha); o parceiro
> prestador é só uma referência na linha de serviço. Continua **fora**: folha de pagamento (D-PROD-02), salário,
> encargos, ponto, pagamento, lançamento financeiro, título, rateio e contrato de serviço. Continua proibido:
> - apagar cadastro de funcionário ou de serviço (só inativar) ou apagar linha (só cancelar);
> - criar `OperacaoFinanceira`, título ou rateio a partir das linhas de mão de obra ou de serviço;
> - usar `Usuario` (conta de acesso) como funcionário;
> - conceder as telas novas ou as ações das linhas a perfis existentes por padrão.
>
> Texto redigido pelo agente e **aprovado pelo proprietário em 2026-11-15 ("Aplica e aprova")**, no merge da PR #294
> (`00-CONSTITUICAO.md` §4).
>
> **Ajuste (D-PROD-208):** o **Funcionário** deixa de ser cadastro próprio e passa a ser **papel do parceiro**
> (papel `funcionario`), com tipo, cargo e custos por hora e por diária; a mão de obra pode ser de **funcionário** ou de
> **terceiro** (parceiro prestador de serviço, custo digitado). Continua **fora** tudo o que a D-PROD-207 deixou fora:
> folha de pagamento (D-PROD-02), salário, encargos, ponto, pagamento, lançamento financeiro, título e rateio. Continua
> proibido usar `Usuario` como funcionário, apagar linha (só cancelar) e criar `OperacaoFinanceira`, título ou rateio a
> partir das linhas. Texto redigido pelo agente e **aprovado pelo proprietário em 2026-11-15 ("aplica e aprova")**, no merge da PR #298
> (`00-CONSTITUICAO.md` §4).

> **Nota proposta (D-PROD-256):** com o custo médio ponderado, onde as notas acima proíbem mexer na "fila FIFO" ou
> reescrever custo, a proibição passa a valer para o **poço produto × depósito e para o `custo_unitario` gravado em
> movimento, fatia ou consumo**: continua proibido reescrever movimento, fatia ou consumo, criar um segundo cálculo de
> custo fora do motor único (`estoqueFisicoMotor.js`) e valorizar saída por qualquer outro método. A reavaliação do
> `custo_unitario` das camadas **disponíveis**, feita só pelo motor, na mesma transação do movimento que altera o poço, é
> o mecanismo do método e não é reescrita de histórico. Texto proposto pelo agente; vale só com a aprovação explícita
> do proprietário no merge manual (`00-CONSTITUICAO.md` §4).
