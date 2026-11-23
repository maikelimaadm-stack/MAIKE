# MAIKE — Estoque: controle de lote por produto (SPEC, D-PROD-279)

Decisão: [D-PROD-279](./DECISIONS.md) · Runbook: [`MAIKE-ESTOQUE-CONTROLE-LOTE-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-CONTROLE-LOTE-RUNBOOK-RELEASE.md) ·
Relatório: [`MAIKE-ESTOQUE-CONTROLE-LOTE-REPORT.md`](./MAIKE-ESTOQUE-CONTROLE-LOTE-REPORT.md) · Base: custo médio
([D-PROD-256](./DECISIONS.md)), exclusão com recálculo ([D-PROD-273](./DECISIONS.md), [SPEC](./MAIKE-ESTOQUE-EXCLUSAO-RECALCULO-SPEC.md)).

## 1. Modelo

| Onde | Campo | Regra |
|---|---|---|
| `Produto` | `controla_lote` BOOLEAN NOT NULL DEFAULT false | "Controla lote" (Sim/Não). Todos os produtos de hoje ficam Não |
| `Produto` | `controla_validade` BOOLEAN NOT NULL DEFAULT false | "Controla validade". CHECK `Produto_controla_validade_check`: validade só com lote |
| `EstoqueLoteNota` | `lote_fabricante` VARCHAR(64) NULL | o lote do fabricante da camada (a camada continua sendo **uma por entrada**) |
| `EstoqueLoteNota` | `data_validade` DATE NULL | a validade da camada |
| índice | `EstoqueLoteNota_fefo_idx` (`cliente_id`, `empresa_id`, `produto_id`, `local_estoque_id`, `data_validade`) | tenant-first (R10), para o FEFO |

A camada (`EstoqueLoteNota`) é o "lote" que o usuário escolhe na saída: cada entrada cria a sua, com o lote do
fabricante, a validade e o **custo da nota**. Duas entradas do mesmo lote do fabricante são duas camadas (custos
diferentes); a tela mostra as duas, cada uma com o seu saldo.

O movimento grava `modo_saida_fifo = 'LOTE'` (coluna texto, nome legado) nas saídas e transferências de produto com
lote; `'CUSTO_MEDIO'` nas demais. É essa marca, e não o cadastro, que diz ao estorno e ao replay como o movimento foi
valorizado (o cadastro pode mudar depois, com saldo zero).

## 2. Regras por origem

**Entradas** (o motor recusa, em `aplicarEntradaEstoque`, antes de gravar; vale para qualquer escritor):

| Origem | De onde vêm lote e validade |
|---|---|
| Entrada documentada (aba Entradas) | `itens[].lote_fabricante` e `itens[].data_validade` (as colunas da linha já existiam, D-PROD-259) |
| Compra do financeiro (P3) | `itens[].lote_fabricante` e `itens[].data_validade` na linha MERCADORIA (no corpo; não há coluna nova na linha: ficam na camada) |
| Sobra de ajuste | `itens[].lote_fabricante` e `itens[].data_validade` (ver abaixo) |
| Transferência recebida | copiados da camada de origem, fatia a fatia |

- Produto com lote: sem `lote_fabricante` → 422 `ESTOQUE_LOTE_OBRIGATORIO` (`reason: 'lote_obrigatorio'`).
- Com "Controla validade": sem `data_validade` → 422 (`reason: 'validade_obrigatoria'`).
- Produto sem lote: lote e validade informados são ignorados (a camada fica vazia, como hoje).

**Sobra de ajuste de produto com lote (tratamento escolhido).** A sobra cria uma camada nova, então exige o lote (e a
validade, se o produto controla). O custo **não** é o médio do depósito (o produto não tem médio): se o depósito já
tem (ou teve) uma camada com o **mesmo lote do fabricante**, a sobra entra pelo custo da camada mais recente desse lote
e herda a validade dela quando a validade não vier; senão, o custo da sobra é obrigatório (`custo_informado = true`,
422 `custo_obrigatorio_sem_saldo` como no depósito vazio). Motivo: uma sobra de contagem é "achei mais do lote X"; o
custo mais honesto é o que o lote X custou.

**Saídas** — saída manual, transferência (origem), cocho, linha de produto da atividade, abastecimento, venda do
financeiro e falta de ajuste: cada linha aceita `lotes: [{ estoque_lote_nota_id, quantidade }]` (opcional).
- Sem a lista, o servidor escolhe pelo **FEFO** (§3).
- Com a lista: cada camada tem de ser do produto, da empresa e do depósito da linha, estar Disponivel, ter o
  disponível; a soma tem de ser a quantidade da linha; a mesma camada não se repete. Recusas 422
  `ESTOQUE_LOTE_INVALIDO` (`lote_inexistente`, `lote_de_outro_deposito`, `lote_sem_saldo`, `lotes_nao_somam`,
  `lote_repetido`). Produto sem lote com lista → 422 (`reason: 'produto_sem_controle_de_lote'`).
- **Vencido** não é recusa: o servidor aceita; a tela avisa "Lote vencido em dd/mm" e pede confirmação antes de enviar.
  A resposta da prévia de lotes diz `vencido: true`.

**Troca do cadastro.** `controla_lote` (ou `controla_validade`) só muda com o saldo do produto **zero em todos os
depósitos** (Σ disponível das camadas, mais `estoque_atual`). Senão 409 `PRODUTO_LOTE_TROCA_COM_SALDO`, com o saldo.
Ligar validade sem lote → 422 (o mesmo do CHECK).

## 3. FEFO

Ordem das camadas Disponivel com saldo do produto no depósito: `data_validade` crescente (sem validade vai **por
último**), depois a entrada mais antiga (`COALESCE(data_documento, createdAt)`, `id`) — a ordem FIFO do motor.
A saída consome nessa ordem até a quantidade. A tela mostra a sugestão (o mesmo cálculo, pelo endpoint do §6) e o
usuário pode trocar ou dividir.

## 4. Custo

- Produto com lote: cada fatia sai pelo **custo da camada** escolhida (o custo da nota). Valor da saída = Σ(fatia ×
  custo da camada), arredondado em 4 casas; `valor_unitario` = valor ÷ quantidade. As camadas **nunca** são
  reavaliadas (nem na saída, nem na entrada, nem no estorno, nem no destino da transferência).
- Transferência: a camada de destino nasce com o custo, o lote, a validade, a data e a procedência da camada de origem.
- Produto sem lote: sem mudança (custo médio do depósito, D-PROD-256; fatias FIFO só como rastro).
- Emenda (aprovada): "Produto que controla lote usa o custo do lote escolhido; os demais seguem no custo médio do
  depósito (D-PROD-256)".

## 5. Recálculo (D-PROD-273)

- **Replay:** saída/transferência com `modo_saida_fifo = 'LOTE'` aplica as **fatias gravadas** pelo custo gravado de
  cada uma, sem reavaliar; o destino da transferência não é reavaliado; o estorno dela devolve às mesmas camadas sem
  reavaliar. Sobra de ajuste em camada com lote do fabricante fica no custo gravado. O replay sem exclusão reproduz o
  gravado; numa exclusão, os movimentos com lote **não mudam de valor** (custo fixo).
- **Excluir uma entrada de produto com lote** (entrada documentada, compra, sobra de ajuste): recusada se alguma saída
  ou transferência consumiu daquela camada — 409 `ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL`, `reason: 'lote_consumido'`,
  "Este lote já teve saída; exclua as saídas dele antes". Sem consumo, é o estorno exato de sempre (camada Estornado).
- **Excluir uma saída de produto com lote:** estorno exato, devolvendo cada fatia à mesma camada, pelo valor gravado;
  nada depois é recalculado (não há médio).
- Transferência de produto com lote: excluir = estorno exato se as camadas recebidas estão intocadas; senão a mesma
  recusa `lote_consumido`.

## 6. Telas e endpoint

- `GET /api/native/estoque/lotes-disponiveis?empresa_id&produto_id&local_estoque_id` → `{ controla_lote,
  controla_validade, lotes: [{ id, lote_fabricante, data_validade, quantidade_disponivel, custo_unitario, vencido,
  vence_em_dias, data_documento }] }`, já na ordem FEFO. Guarda de leitura do Estoque; tenant de `auth_context`.
- Cadastro de produto: dois Sim/Não ("Controla lote", "Controla validade"; o segundo só com o primeiro).
- Entrada: colunas "Lote" e "Validade" na linha, obrigatórias conforme o produto.
- Saída manual e transferência: campo "Lote" com a sugestão FEFO, "Dividir entre lotes" e o aviso de vencido com
  confirmação. Cocho, atividade, abastecimento e venda usam o FEFO do servidor (a lista é aceita na API).
- Saldo: nos produtos com lote, detalhe por lote com validade e o aviso "vence em N dias" (≤ 30) ou "vencido".
- Tudo cabe em 390 px (linhas empilhadas; o detalhe do lote é lista, não tabela larga).
