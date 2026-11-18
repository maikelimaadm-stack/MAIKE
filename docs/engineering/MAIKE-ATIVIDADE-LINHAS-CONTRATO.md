# MAIKE-ATIVIDADE-LINHAS — contrato da Fatia 3 do Lançamento de Atividades

> **fatia 3 · `feat/atividade-itens-produto-maquina` · PR #289**
>
> Decisão **D-PROD-202**. Pedido do proprietário: "FATIA 3 — As linhas que geram custo: produto e máquina. É o
> coração." Base: Fatias 1 e 2 (D-PROD-197 e D-PROD-200), em produção.

## 1. Modelo (fixado no `schema.prisma`)

**Tabelas novas:**
- `AtividadeApontamentoProduto`: linha de produto do apontamento;
- `AtividadeApontamentoProdutoConsumoLote`: as fatias FIFO que a linha consumiu;
- `AtividadeApontamentoMaquina`: linha de máquina.

**Duas colunas anuláveis em cadastros que já existem:**
- `BemPatrimonial.custo_uso_unitario` (custo por hora ou km), copiado para a linha como snapshot;
- `TipoPatrimonial.salto_maximo_medidor`, o teto do salto por lançamento.

Toda FK é composta pelo tenant e `RESTRICT`. O apontamento e o bem entram por `(cliente_id, empresa_id, id)`.

**Migration `20261114600000_atividade_linhas_produto_maquina`, EXPAND:**
- produção vai de 53 para 54 migrations e de 84 para 87 tabelas;
- o código de hoje convive com ela, então pode ser aplicada **antes do merge**;
- só com autorização do proprietário.

## 2. Produto

**Quando a linha é aceita:**
- O tipo da atividade precisa de `permite_produto`; sem ele → 422 `ATIVIDADE_EXIGIDA_PELO_TIPO`, `reason: permite_produto` (a tela esconde).
- O apontamento tem de estar `CONFIRMADO` e a atividade `ABERTA`.
- O produto precisa estar ativo, ser da fazenda e ter unidade aceita.
- Combustível (produto aceito por tanque ativo) é **recusado**: vai pelo abastecimento.

**Baixa de estoque** ao salvar, pelo **mesmo motor FIFO do abastecimento**:
- sequência: `travarProdutosEstoque` → `aplicarSaidaFifo`, com origem `apontamento_atividade` e `dia` = `data_operacional`;
- `numerarMovimentos` roda no fim da transação;
- o movimento fica ligado à linha;
- as fatias vão para `…ConsumoLote`;
- saldo insuficiente → 422 `ESTOQUE_SALDO_INSUFICIENTE`, com a mensagem do motor (disponível × solicitado).

**Cálculos:**
- `unidade` = unidade efetiva do estoque do produto (L | KG; SACO guarda kg), nunca do usuário, sem conversão;
- `custo_unitario` / `custo_total` vêm do custo FIFO;
- `dose_ha = quantidade / area_executada_dia`, quando houver área do dia, só para leitura e recalculada quando a área
  do dia muda.

**Editar e cancelar:**
- **Editar** = `estornarSaida` exato da linha (status `CANCELADO`, origem `EDICAO`) + nova saída numa linha nova, na
  mesma transação. Lote já consumido ou transferido → 409 com a explicação do motor.
- **Cancelar** = estorno exato (`estornarEmLote`).
- **Cancelar o apontamento ou a atividade** estorna todas as linhas confirmadas, num `estornarEmLote`, na mesma
  transação (origem `APONTAMENTO` / `ATIVIDADE`).
- Os pontos de extensão da Fatia 2 já estão marcados em `atividadeApontamentoService.js` e `atividadeService.js`.

**Proteções:**
- **Idempotência:** toda escrita de linha leva `operation_id` (`executarComIdempotencia`, precedente D-PROD-193). Um
  reenvio igual devolve a resposta gravada; com corpo diferente → 409.
- **CAS** pela `versao` do apontamento, incrementada uma vez por escrita de linha.
- A data do apontamento **não muda** com linha de produto ou máquina confirmada: 409. Para mudar, cancelar e lançar de
  novo.

**Conciliação e lote:**
- **Conciliação do estoque:** os CTEs de `reconciliacaoEstoque.js` e a sonda `to_regclass` passam a ler as tabelas
  novas. Sem isso, toda saída vira DIVERGÊNCIA.
- **Lote:** PATCH e DELETE de lote com fatia de linha de atividade → 409 `REGISTRO_OPERACIONAL_IMUTAVEL`
  (`estoqueLoteNotaService`).

## 3. Máquina

**Quando a linha é aceita:**
- A máquina pode entrar em qualquer tipo (decisão do proprietário: só existe `exige_maquina`). A máquina do cabeçalho
  vem como sugestão.
- Natureza aceita: máquina, veículo ou equipamento.
- `implemento_bem_id` precisa de `permite_implemento` no tipo e de natureza `IMPLEMENTO`, e nunca pode ser o mesmo bem
  da máquina.

**Medidor:**
- `medidor_tipo` e `medidor_unidade` vêm do bem (snapshot). Nunca se pergunta ao usuário.
- **Com medidor:**
  - `leitura_inicial` é sugerida pela leitura vigente do bem; a `leitura_final` é obrigatória;
  - final < inicial → 422;
  - final abaixo da leitura vigente anterior na data, ou acima de uma leitura posterior já registrada → 422 (o
    medidor não anda para trás);
  - `quantidade_uso = final − inicial`.
- **Sem leitura:** com `sem_medidor: true` o usuário informa as horas ou o km direto, e a linha fica marcada.
- **Salto:** o quanto o medidor anda no lançamento — da leitura vigente na data até a `leitura_final` (com a inicial
  sugerida, é a própria `quantidade_uso`; uma inicial digitada acima da vigente também conta; sem leitura anterior ou
  "sem medidor", é o uso) — acima de `TipoPatrimonial.salto_maximo_medidor` → 422 `ATIVIDADE_SALTO_MEDIDOR`
  (`details.salto`, `quantidade_uso`, `leitura_vigente`), que pede `justificativa_salto` (3 a 500 caracteres). Com a
  justificativa, aceita; não bloqueia.
- **"Atualiza a leitura atual do bem":** a leitura vive na linha, como no abastecimento. A leitura vigente do bem
  (`leituraVigente` / `pisoOperacional` / `pontosVizinhos` em `abastecimentoMedidor.js`) passa a considerar também as
  linhas de máquina confirmadas. Nada é gravado em `BemPatrimonial.medidor_*` (o CHECK de `medidor_origem` e a nota
  D-PROD-159 do DO-NOT-DO continuam).
  - O abastecimento respeita as leituras das linhas, e as linhas respeitam as do abastecimento.
  - Cancelar uma linha tira a leitura dela do cálculo.

**Custo:**
- `custo_unitario_uso` é snapshot de `BemPatrimonial.custo_uso_unitario`;
- `custo_total = quantidade_uso × custo_unitario_uso`, ou nulo sem custo no cadastro.

**Editar** = cancelar a linha (`EDICAO`) e criar outra. **Cancelar** com motivo.

## 4. API (tenant do `auth_context`, `empresa_id` conferido, decimais como string, schemas fechados)

| Rota | Guarda |
|---|---|
| `POST /atividades/:id/apontamentos/:apId/produtos` · `…/maquinas` | apontamentos: criar (`lancar_apontamento`) |
| `PATCH …/produtos/:linhaId` · `…/maquinas/:linhaId` | apontamentos: editar |
| `POST …/produtos/:linhaId/cancelar` · `…/maquinas/:linhaId/cancelar` | apontamentos: cancelar |
| `POST /atividades/:id/apontamentos` e `…/duplicar` aceitam `produtos[]` e `maquinas[]` (tudo numa transação, um `operation_id`) | apontamentos: criar |
| `GET /atividades/:id/totais` | atividades: ver |
| `GET /atividades-opcoes/produtos?empresa_id=&atividade_id=&q=` (favoritos: os já usados na atividade primeiro) · `…/locais?produto_id=` (com saldo) · `…/implementos` · `…/medidor?bem_id=&data=` (tipo, unidade, leitura vigente, teto) | atividades: ver |

O apontamento (lista e detalhe) passa a trazer `produtos[]` e `maquinas[]`, inclusive as linhas canceladas.

**Totais:**

```
{ area_executada, area_planejada, unidade_area: 'ha',
  produtos: [{ produto_id, nome, unidade, quantidade, custo_total }],
  maquinas: [{ bem_id, nome, medidor_unidade, quantidade_uso, custo_total }],
  custo_total, custo_por_ha }
```

Os totais somam só as linhas confirmadas de apontamentos confirmados; `custo_por_ha` é nulo sem área.
D-PROD-234 (só leitura): a resposta acrescenta `custo_por_tipo: { maquinas, produtos, mao_obra, servicos, combustivel }`
(as parcelas do `custo_total`, cada uma nula sem custo) e `litros_combustivel_por_ha` (litros de combustível ÷ área
executada, 4 casas; nulo sem área ou sem litros; o quilo não entra).

## 5. Tela (só componentes existentes)

**Dentro do apontamento:**
- um bloco por tipo de linha, "Produtos" e "Máquinas", cada um com a lista das linhas;
- "Adicionar produto" e "Adicionar máquina" abrem janela (`B1Janela`):
  - **produto:** produto, com os favoritos no topo; local, com o saldo; quantidade, com a unidade do produto; dose/ha
    calculada;
  - **máquina:** máquina; implemento, se o tipo permitir; leitura inicial sugerida, leitura final e uso calculado; ou
    "sem medidor", com horas ou km; justificativa quando passar do teto.

**Outras peças:**
- **Totalizador fixo** no cabeçalho da atividade: área executada / planejada, total por produto, horas ou km por
  máquina, custo acumulado e custo/ha.
- **"Repetir último lançamento"** traz as linhas do apontamento anterior preenchidas, para o operador só ajustar as
  quantidades. Grava tudo numa transação.
- **Cadastros:** "Custo por hora/km" no formulário do bem e "Teto de salto do medidor" no tipo patrimonial, com campos
  numéricos existentes.

## 6. Constituição (precisa da aprovação do proprietário no merge)

A nota nova re-ancora a exceção de estoque da D-PROD-193 na linha de produto do Lançamento de Atividades:
- mesmo motor, mesma origem e estorno exato;
- **editar = estorno exato + nova saída**;
- custo por hora ou km de uso da máquina como snapshot do cadastro, sem lançamento financeiro;
- leitura do medidor na linha, nunca gravada no bem.

Continua fora: financeiro, título, rateio, devolução de sobra como estorno, manutenção e peças.

## 7. Testes

- baixa e estorno de estoque;
- saldo insuficiente;
- FIFO igual ao do abastecimento;
- medidor para trás recusado;
- leitura final menor que a inicial;
- leitura vigente do bem atualizada (e respeitada pelo abastecimento);
- implemento igual à máquina;
- dose calculada;
- `permite_produto` desligado esconde e recusa;
- totalizador somando certo;
- duas passadas no mesmo dia somando;
- cancelar apontamento e cancelar atividade estornam tudo;
- editar estorna e baixa de novo;
- idempotência;
- conciliação sem divergência;
- lote com fatia de atividade imutável;
- isolamento por tenant;
- schema × banco.
