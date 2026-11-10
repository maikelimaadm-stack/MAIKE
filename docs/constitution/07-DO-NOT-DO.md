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

> **Nota (D-PROD-157):** os cadastros de Patrimônio e Frota (`BensPatrimoniais`,
> `FamiliasPatrimoniais`, `TiposPatrimoniais`, `PerfisMedicao`, `Combustiveis`)
> são a única exceção de máquinas/combustível autorizada, nos limites da decisão.
> Continuam proibidos: reabrir as páginas legadas `CadastroMaquinas`, `AtivosFixos`,
> `LancamentosAbastecimento` e `FichaControleCombustivel`; recriar os schemas Base44
> `Maquina`, `TipoAtivo`, `Implemento`, `ManutencaoMaquina` e `AbastecimentoMaquina`;
> e, sem decisão própria, abastecimento, manutenção, custo/hora, apuração ou
> lançamento de depreciação e transferência entre fazendas.

> **Nota (D-PROD-159):** a página `Abastecimentos` é a única exceção de abastecimento
> autorizada, nos limites da decisão. Continua proibido: converter litros em KG por
> `1 L = 1 KG`, por densidade presumida ou por fator inferido do nome, do combustível ou
> do preço; usar `Number`/float em quantidade, fator ou dinheiro; baixar estoque fora do
> motor de estoque (`estoqueFisicoMotor.js`) ou por `Produto.estoque_atual -= …` isolado;
> criar ou fingir `OperacaoFinanceira` para representar abastecimento; gravar leitura de
> abastecimento em `BemPatrimonial` ou com proveniência falsa; apagar abastecimento
> (só cancelar com estorno exato); conceder a tela ou as ações `cancelar` e
> `configurar_conversao` a perfis existentes por padrão; reabrir
> `LancamentosAbastecimento`, `FichaControleCombustivel`, `AbastecimentoMaquina` ou
> `ConfiguracaoFatoresConsumo`; e, sem decisão própria, manutenção, custo/hora, saldo de
> tanque e GNV em tanque de litros.
