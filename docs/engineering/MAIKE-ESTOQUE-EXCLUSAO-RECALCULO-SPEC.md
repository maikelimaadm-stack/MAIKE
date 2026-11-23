# MAIKE — Estoque: exclusão com recálculo do custo médio (SPEC, D-PROD-273)

**Estado:** especificação aprovada para implementação em fatias · **Decisão:** [D-PROD-273](./DECISIONS.md) · **Migration:** nenhuma prevista

## 1. Regras (escolhas do proprietário, 2026-11-22)

1. **O excluído some das telas.** O movimento excluído (`status = 'Estornada'`) e o estorno dele (`tipo_detalhado` começando por `estorno_`, `movimento_pai_id` = o excluído) saem do Kardex, das listas e dos históricos. Ficam no banco; um filtro **"mostrar excluídos"** os traz de volta, marcados.
2. **Excluir e recalcular.** Qualquer movimento pode ser excluído se, refeita a sequência do produto **sem ele**, o saldo de nenhum depósito ficar negativo em nenhum ponto.
3. **Ordem canônica = ordem de lançamento** (`numero_movimentacao`, numérico; empate/legado por `createdAt`, `id`). É a ordem em que o motor valorizou: o replay sem exclusão reproduz exatamente o que está gravado.
4. **Recálculo a jusante, em todos os depósitos do produto** (a transferência leva o custo da origem para o destino) e **dos valores copiados fora do estoque**.
5. **Trilha:** cada valor reescrito vai para o `AuditLog` (ação `estoque.recalculo`) com antes/depois, autor, motivo e o movimento excluído que causou o recálculo. Sem tabela nova (sem migration).
6. Preço de venda e valor de compra **não mudam**; só o custo derivado do estoque.

## 2. Modelo de custo atual (fatos do código)

- Saída = **custo médio do poço produto × depósito** no momento do processamento (`consumirCustoMedio`, `estoqueFisicoMotor.js`); a ordem FIFO só escolhe de qual camada sai a quantidade (rastro). Depois de cada saída o poço é **reavaliado** (`reavaliarCamadas`): `EstoqueLoteNota.custo_unitario` é o custo vigente da camada. Entrada cria camada com o custo dela, sem reavaliar.
- Gravado na saída: `valor_unitario`, `valor_total`, `custo_medio_antes/depois`, `saldo_antes/depois`, `lotes_consumidos[]` (`lote_id`, `quantidade`, `custo_unitario`, e `lote_destino_id` na transferência); rateio em `observacoes` (suplementação/transferência).
- Estorno exato devolve as fatias às camadas e o **valor gravado** no original.
- Trava por produto (todos os depósitos); `numerarMovimentos` dá a ordem real.

## 3. Dependentes a recalcular

| Origem | Onde o custo vai |
|---|---|
| Transferência | camadas do destino (custo da fatia), poço do destino; cascata transitiva |
| Cocho / suplementação | `SuplementacaoEvento.dados` (custo kg, custo do período, cab/dia, sobra herdada) — hoje calculado no front: portar o cálculo para o servidor (ou derivar na leitura) |
| Apontamento de atividade | `AtividadeApontamentoProduto.custo_unitario/custo_total`, `AtividadeApontamentoProdutoConsumoLote.custo_unitario` (os totais da atividade são somados na leitura) |
| Abastecimento | `AbastecimentoBem.custo_unitario/custo_total`, `AbastecimentoBemConsumoLote.custo_unitario` |
| Venda (financeiro) | `OperacaoFinanceiraConsumoLote.custo_unitario` (preço não muda) |
| Saída manual | `SaidaEstoqueItem.custo_unitario/valor_total` |
| Estornos não excluídos | = valor do original recalculado |

Recibos de idempotência, snapshots de `*Evento` e `AuditLog` antigos **não** são reescritos (são histórico).

## 4. Algoritmo (replay determinístico)

1. Sob `travarProdutosEstoque(produto)`, ler **todos** os movimentos do produto na empresa na ordem canônica.
2. Marcar o movimento a excluir (e o estorno que será lançado) como fora da sequência.
3. Reprocessar do primeiro movimento afetado até o último, por depósito: entradas somam (custo próprio; transferência recebida = custo da fatia enviada recalculada); saídas tiram pelo **médio do poço naquele ponto**; reatribuir as fatias FIFO às camadas.
4. Se algum saldo ficar < 0: **recusa** 409 `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO` com depósito, movimento e saldo; nada é gravado.
5. Se ok: gravar o estorno do excluído (o par some das telas), reescrever os valores derivados e as camadas, recalcular os dependentes (§3) e registrar a trilha (§1.5), tudo na mesma transação.
6. **Prévia:** o mesmo replay sem gravar (`GET …/exclusao/previa`) devolve o que mudaria (movimentos, valores antes/depois, dependentes) para a tela pedir confirmação.
7. **Prova de aceitação:** replay sem exclusão sobre os dados reais de produção (exportados em leitura) = valores gravados, movimento a movimento. Saídas legadas `modo_saida_fifo = 'FIFO'` mantêm o valor FIFO enquanto não houver exclusão antes delas; depois, passam a médio (registrado na trilha).

## 5. Fatias (uma PR cada)

1. Decisão, emenda e esta SPEC (sem código).
2. **Some da tela**: consulta de movimentos com `incluir_excluidos` (padrão falso) e o filtro no Kardex; saldo exibido coerente.
3. **Replay puro + prévia + prova** (sem escrita), com teto fail-closed de volume.
4. **Exclusão com recálculo — saídas** (manual, cocho, atividade, abastecimento, venda): só sobem o saldo, não há risco de negativo; recalcula a jusante e os dependentes.
5. **Exclusão com recálculo — entradas, compra, transferência e ajuste**: prova de saldo ≥ 0 e reatribuição de camadas.
   Feita (relatório, seção Fatia 5). Regras de implementação: o estorno da origem é gravado sem baixar a camada da
   entrada (ou as recebidas na transferência) e o recálculo, na mesma transação, a deixa 'Estornado' com disponível 0
   (nunca apagada); quem consumia dela volta a consumir das outras camadas (FIFO para a fatia, médio do poço sem ela
   para o valor), e as fatias `*ConsumoLote` dos dependentes seguem (atualizada, criada ou removida). A transferência
   sai inteira, como dois pares marcados (S + estorno da enviada, R + estorno da recebida). Com algo depois, o estorno
   exato só vale como saída quando a camada está inteira (disponível = entrada, custo = o do movimento) **e** não há
   nenhuma saída válida depois no poço da entrada (saídas de pares já excluídos não contam): custo igual ao original não
   basta, porque a reavaliação ao médio pode devolver o custo depois de saídas que usaram um médio com a entrada. Com
   saída válida depois, recusa do recálculo é recusa. Planejador e prévia usam a mesma prova. **Sem estorno exato como
   saída** para essas origens: recusa é recusa. **Edição (D-PROD-271)**: continua exigindo "nada depois" — ela relança a
   versão nova no FIM da sequência, então recalcular seria valorizar os posteriores sem a entrada, não com a versão
   corrigida; corrigir no lugar exige uma chave de ordem nova (§1.3) e fica para decisão do proprietário. Hoje: excluir
   com recálculo e lançar de novo.
6. **Reconciliação de valor** (Σ disponível × custo = replay) e gate.

## 6. Riscos

Transação longa (teto e prévia); reatribuição de camadas com FKs `*ConsumoLote` (`Restrict`) — nunca apagar camada, marcar e criar; travas próprias do cocho/áreas antes da trava do produto (respeitar a ordem); o JSON do cocho calculado no front; testes que hoje provam "nada mexeu depois" e "estorno devolve o valor gravado" mudam de expectativa **só** onde a regra nova se aplica.
