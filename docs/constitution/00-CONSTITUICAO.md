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
