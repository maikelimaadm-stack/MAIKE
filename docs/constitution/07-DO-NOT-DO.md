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

> **Nota (D-PROD-201):** as linhas de produto do Lançamento de Atividades substituem os itens da D-PROD-193. Continua
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
> Texto redigido pelo agente; vale só com a aprovação explícita do proprietário no merge manual
> (`00-CONSTITUICAO.md` §4).
