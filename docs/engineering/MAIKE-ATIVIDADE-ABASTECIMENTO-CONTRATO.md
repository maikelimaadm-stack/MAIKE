# MAIKE — Fatia 5 do Lançamento de Atividades: abastecimento ligado à atividade (contrato, D-PROD-210)

> Branch `feat/atividade-abastecimento`, a partir da `main` `18426967` (merge da PR #299, D-PROD-209).
> Pedido do proprietário (mapa da Fatia 5): "AbastecimentoBem ganha atividade_id / apontamento_id, snapshot de
> centro de custo, leitura anterior do medidor, delta e flag de intervalo confiável, e origem EXTERNO para posto de
> estrada. É o que fecha L/h, km/L e custo de combustível por hectare. Hoje o diesel do dia do operador não tem onde
> entrar." Liberado com "pode iniciar a fatia 5".

## 0. Estado de partida (produção, conferido em 2026-11-16)

- 60 migrations, 0 em aberto; 94 tabelas. Última: `20261116100000_funcionario_tipo_terceirizado`
  (checksum `44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6`).
- `AbastecimentoBem`: **1** linha (CONFIRMADO, com leitura). `Atividade` 4, `AtividadeApontamento` 4,
  `AtividadeApontamentoMaquina` 1.
- O consumo pelo **método do tanque cheio** já existe e é calculado na leitura (`patrimonio/abastecimentoConsumo.js`,
  D-PROD-162). **Continua sendo a única fonte do consumo do bem**: esta fatia não cria um segundo cálculo dele.

## 1. Banco — `AbastecimentoBem` (uma migration, `20261116200000_abastecimento_atividade`)

| Coluna | Tipo | Regra |
|---|---|---|
| `origem` | `VarChar(8)` NOT NULL default `'ESTOQUE'` | `ESTOQUE` \| `EXTERNO` (CHECK) |
| `local_estoque_id` | passa a **NULL** | `ESTOQUE` ⇒ NOT NULL; `EXTERNO` ⇒ NULL |
| `movimentacao_estoque_id` | passa a **NULL** | `ESTOQUE` ⇒ NOT NULL; `EXTERNO` ⇒ NULL (e `movimentacao_estorno_id` NULL sempre) |
| `atividade_id` | `VarChar(64)` NULL | FK `(cliente_id, empresa_id, atividade_id)` → `Atividade(cliente_id, empresa_id, id)`, Restrict |
| `apontamento_id` | `VarChar(64)` NULL | FK `(cliente_id, empresa_id, apontamento_id)` → `AtividadeApontamento(cliente_id, empresa_id, id)`, Restrict. CHECK: `apontamento_id IS NULL OR atividade_id IS NOT NULL` |
| `centro_custo_id` | `VarChar(64)` NULL | FK `(cliente_id, empresa_id, centro_custo_id)` → `CentroCusto`, Restrict. **Snapshot** |
| `medidor_leitura_anterior` | `Decimal(14,4)` NULL | **Snapshot** na confirmação |
| `medidor_delta` | `Decimal(14,4)` NULL | `= medidor_leitura - medidor_leitura_anterior` (CHECK: os dois juntos, só com contador) |
| `intervalo_confiavel` | `Boolean` NOT NULL default `false` | CHECK: `true` ⇒ anterior e delta preenchidos e `delta > 0` |

- CHECKs trocados: `AbastecimentoBem_status_check` (CANCELADO só exige `movimentacao_estorno_id` com `ESTOQUE`) e
  um CHECK novo `AbastecimentoBem_origem_check` (as duas formas acima). Os outros ficam.
- Índices novos, todos começando por `cliente_id` (R10): `(cliente_id, empresa_id, atividade_id)`,
  `(cliente_id, empresa_id, apontamento_id)`, `(cliente_id, empresa_id, centro_custo_id)`.
- Relações Prisma `localEstoque` e `movimentacao` viram opcionais; relações inversas em `Atividade`,
  `AtividadeApontamento` e `CentroCusto`.
- **Backfill** das linhas existentes: `origem = 'ESTOQUE'` (default); `centro_custo_id` = o do bem
  (`BemPatrimonial.centro_custo_id`); `medidor_leitura_anterior`, `medidor_delta` NULL e `intervalo_confiavel` false
  (o snapshot não existia quando foram confirmadas: fica "desconhecido", sem inventar).
- É **CONTRACT** (NOT NULL → NULL e troca de CHECK em tabela antiga): entrada fechada em
  `MIGRATIONS_CONTRACT_APROVADAS` com `decisao: 'D-PROD-210'`, guarda pinada no início (lock_timeout, trava 72707369,
  `ACCESS EXCLUSIVE` em `AbastecimentoBem`, estado esperado: as colunas novas ausentes, o CHECK antigo presente).
  Produção 60 → 61, tabelas 94 (sem mudança). Runbook com preflight, caminho B (guardas `n_ok <> 60`, a anterior
  `20261116100000_funcionario_tipo_terceirizado` com o checksum acima) e postcheck.

## 2. Servidor

### 2.1 Confirmar abastecimento (`POST` de sempre, `patrimonio/abastecimentoService.js`)

Corpo ganha, todos opcionais:
- `origem`: `ESTOQUE` (default) | `EXTERNO`.
  - `ESTOQUE`: exatamente como hoje (FIFO do MESMO motor, `local_estoque_id` obrigatório).
  - `EXTERNO` (posto de estrada): `local_estoque_id` **recusado** se vier; **sem** movimento de estoque, sem
    consumo de lote; `custo_total` **obrigatório** (> 0, até 2 casas — o valor da nota do posto);
    `custo_unitario = custo_total / quantidade` (4 casas). Bem, tanque, produto e aceite do tanque continuam
    obrigatórios e validados como hoje (o combustível entra no tanque do bem). `referencia_externa` é o número da
    nota/cupom. Sem `travarProdutosEstoque`/`LocalEstoque`; mantém a trava do bem.
- `apontamento_id`: o lançamento do dia ao qual o abastecimento pertence. O servidor **deriva** `atividade_id` do
  apontamento (o cliente nunca manda `atividade_id`; se mandar, recusa). Exige: apontamento da empresa, `CONFIRMADO`,
  e a atividade dele `ABERTA` (`CONCLUIDA`/`CANCELADA` recusa, mesma mensagem/erro do apontamento novo). Não exige
  que o bem esteja nas linhas de máquina nem que a data seja a do apontamento (default da tela = data do apontamento).
  Trava na MESMA ordem dos escritores da atividade (Atividade → Apontamento → Bem → Produto); confira a ordem em
  `atividades/atividadeApontamentoService.js` e não crie inversão.
- **Centro de custo (snapshot)**: o da atividade (`Atividade.centro_custo_id`) quando há apontamento; senão o do
  bem (`BemPatrimonial.centro_custo_id`). Nunca digitado, nunca relido depois.
- **Leitura anterior, delta, intervalo confiável (snapshot)**, só com medidor contador: `anterior` = o ponto
  anterior que `avaliarLeitura` já calcula (cadastro, abastecimento ou linha de máquina);
  `medidor_leitura_anterior = anterior.leitura`, `medidor_delta = leitura − anterior`;
  `intervalo_confiavel = anterior existe ∧ delta > 0 ∧ anterior.origem ≠ 'CADASTRO'`. Sem anterior: os três
  vazios/false. A prévia devolve os mesmos três valores (sem gravar).
- Idempotência: o fingerprint inclui `origem`, `apontamento_id` e `custo_total` (troque a versão do fingerprint).

### 2.2 Cancelar abastecimento

- `ESTOQUE`: como hoje (estorno pelo motor). `EXTERNO`: só muda o status (não há movimento); motivo obrigatório igual.
- Ligado a atividade que não está `ABERTA` (concluída): **recusado** (409 `ATIVIDADE_STATUS_INVALIDO`, ação
  `cancelar_abastecimento`); reabra a atividade antes. Trava: Empresa → Atividade (só quando ligado) → Bem → …
- `EXTERNO`: `custo_total`/`custo_unitario` acima do limite do estoque bloqueiam na prévia e na confirmação (422).
- Nada é apagado fisicamente.

### 2.3 Cascata pela atividade (princípio 7 do redesenho)

- Cancelar um **apontamento** cancela os abastecimentos `CONFIRMADO` ligados a ele (estorno quando `ESTOQUE`), na
  mesma transação, com o motivo derivado (mesmo padrão das linhas da Fatia 3, `cancelamento_origem` não existe no
  abastecimento: use o motivo "cancelado com o lançamento N da atividade M").
- Cancelar a **atividade** faz o mesmo para todos os apontamentos dela.
- Concluir/reabrir não mexe nos abastecimentos. Atividade `CONCLUIDA` não aceita abastecimento novo ligado.

### 2.4 Leitura

- Detalhe e lista do abastecimento trazem `origem`, `atividade` `{id, numero, nome}`, `apontamento`
  `{id, data_operacional, turno, sequencia}`, `centro_custo` `{id, nome}`, `medidor_leitura_anterior`,
  `medidor_delta`, `intervalo_confiavel`; `local_estoque` nulo no `EXTERNO`.
- Filtro novo na lista: `apontamento_id` e `atividade_id` (keyset de sempre).
- Totalizador `GET /atividades/:id/totais` (D-PROD-202) ganha:
  - `combustivel`: `{ quantidade_l, quantidade_kg, custo_total }` dos abastecimentos `CONFIRMADO` da atividade;
  - `custo_total` e `custo_por_ha` passam a somar o combustível; `custo_combustivel_por_ha` novo
    (combustível ÷ área executada, nulo sem área);
  - `consumo_por_bem`: para cada bem com combustível ligado na atividade, `{ bem, medidor_tipo, uso, quantidade,
    unidade, metrica, valor }`, com `uso` = soma de `quantidade_uso` das linhas de máquina `CONFIRMADO` do bem em
    apontamentos `CONFIRMADO` da atividade (horas no horímetro, km no odômetro); `L/h` = litros ÷ horas,
    `km/L` = km ÷ litros (mesmas métricas de `abastecimentoConsumo.metricaDoMedidor`); L e kg nunca se somam
    (misturados ⇒ `valor` nulo); sem uso ⇒ `valor` nulo.

## 3. Tela (só componentes existentes, nada visual novo)

- `FormularioAbastecimento`: escolha **Origem** (Estoque da fazenda | Posto externo). Posto externo esconde o local
  de estoque e pede o **valor total** da nota. Quando aberto a partir de um lançamento, mostra a atividade e o
  lançamento em modo leitura (herdados, travados) e a data vem a do lançamento.
- `ConsultaAbastecimento`/tabela: mostram origem, atividade/lançamento, centro de custo, leitura anterior, delta e
  intervalo confiável.
- Lançamento de Atividades, dentro de um lançamento: bloco **Abastecimentos** com a lista dos ligados e o botão
  "Novo abastecimento" (abre o `FormularioAbastecimento` com o `apontamento_id`); o totalizador mostra combustível,
  custo de combustível/ha e o consumo por bem.
- Nada de pedir tipo de medidor (vem do bem) nem centro de custo (snapshot).

## 4. Não fazer

Segundo motor de estoque; segundo cálculo do consumo do tanque cheio; cadastro novo de unidade; apagar
fisicamente; pedir tipo de medidor; digitar setor ou centro de custo; trabalho visual.
