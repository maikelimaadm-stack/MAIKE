# MAIKE — Ledger de estoque pecuário por área (L1): contrato

**Status:** L1 — backend isolado, **sem rota, sem migration, sem UI**. Não é
produção. A integração (L2) depende do merge da PR #145 e de um rebase
supervisionado.

**Código:**
- `backend/src/modules/estoquePecuarioLedger/` (contrato puro, DDL proposta,
  repositório PostgreSQL e serviço transacional);
- `scripts/ops/auditar-ledger-pecuario.mjs` (reconciliação read-only).

**Testes:** `backend/tests/estoquePecuarioLedgerContrato.test.mjs` e
`backend/tests/estoquePecuarioLedgerTransacional.test.mjs` (PostgreSQL real).

## 1. Decisão de negócio (proprietário)

| Conceito | Regra |
|---|---|
| Cadastro de lote | É o **lançamento histórico de entrada** (compra/nascimento). 1.000 animais entram em A e esse número nunca é reescrito por movimento. |
| Movimentação | É um **fato** imutável. Transferência interna é conservativa: −q na origem e +q no destino, na mesma empresa e categoria. |
| Posição | Saldo por **empresa + área + categoria**, **derivado** dos fatos e reconstruível pela soma das partidas. |
| Mistura | Animais de compras diferentes se agregam na posição. Não há vínculo animal → compra depois da mistura. |
| Correção | **Estorno**: novo evento com partidas inversas. Nunca UPDATE/DELETE. |

O modelo **não identifica animais individualmente** e não muda o visual do
cadastro nem do mapa.

## 2. Eventos e partidas

| Evento | Partidas | Observações |
|---|---|---|
| `ENTRADA` | `+q` em (área, categoria) | `lote_referencia_id` opcional aponta o cadastro (só referência, o ledger nunca escreve em `Lote`). Só **uma** entrada ativa (não estornada) por lote. |
| `TRANSFERENCIA` | `−q` origem, `+q` destino | Origem ≠ destino **por ID**. As duas áreas precisam ser da mesma empresa e do mesmo tenant. Destino inativo é recusado; origem inativa pode ser esvaziada. |
| `ESTORNO` | Inverso exato das partidas do original | Exige motivo. Um estorno por original (`UNIQUE(cliente_id, estorno_de_evento_id)`). Estorno de estorno é recusado. Exige saldo para desfazer. |

**Categoria:**
- a chave canônica é `cm:<categoria_manejo_id>` (ID estável da
  `CategoriaManejo` da empresa) ou `SEM_CATEGORIA`, declarado explicitamente;
- nome livre ("BOI", "Vaca ") **nunca** vira chave;
- troca de categoria será evento próprio no futuro (fora do L1) e não cria
  entrada fictícia;
- sexo: não entra na chave no L1, porque a `CategoriaManejo` já carrega
  `sexo`. Se o domínio pedir posição por sexo independente da categoria, a
  dimensão entra no L2.

## 3. Invariantes (todas testadas contra PostgreSQL)

1. Quantidade inteira positiva (≤ 1.000.000 por evento); sem coerção de string.
2. Origem ≠ destino (ID).
3. Empresa, áreas, categoria e lote verificados **no tenant do
   `auth_context`**. Nunca vêm de body, query, header ou cookie.
4. Nenhuma transferência cruza empresa ou tenant.
5. Saldo suficiente; **nenhuma posição negativa**. Há três barreiras: a
   checagem sob trava, o `UPDATE … WHERE saldo + delta >= 0` e o
   `CHECK (saldo >= 0)`.
6. A soma do total da empresa é conservada por transferências e estornos de
   transferência.
7. Mesmo `operation_id` + mesmo payload = **replay** do resultado gravado.
   Mesmo `operation_id` + payload diferente (ou outro comando) =
   `LEDGER_PECUARIO_IDEMPOTENCIA_CONFLITO`.
8. Erro em qualquer ponto = **rollback total**: nem evento, nem partida, nem
   saldo, nem linha de idempotência.
9. Eventos e partidas são **append-only no banco**: trigger recusa
   UPDATE/DELETE.

## 4. Concorrência

Cada comando é uma única transação interativa:

1. `executarComIdempotencia` (tabela `OperacaoIdempotente` existente,
   `tipo_operacao = 'ledger_pecuario'`).
2. Garante as linhas de posição (`INSERT … ON CONFLICT DO NOTHING`).
3. Trava as posições **uma a uma, em ordem determinística** (área, categoria)
   com `SELECT … FOR UPDATE`. A ordem é a mesma para A→B e B→A, o que evita
   deadlock.
4. Confere o saldo, grava o evento e as partidas e aplica os deltas com
   update condicional.

Conflitos transitórios (`23505`, `40001`, `40P01`, `25P02`, `P2002`, `P2034`)
têm **retry limitado** (3 tentativas, backoff 15/30/45 ms). Na nova tentativa
a idempotência devolve replay ou o conflito real. Se esgotar:
`LEDGER_PECUARIO_CONCORRENCIA_ESGOTADA`.

**Provas no banco:**
- duas saídas simultâneas pelo mesmo saldo: exatamente uma passa, 10 rodadas;
- 8 transferências A↔B cruzadas sem deadlock;
- a mesma `operation_id` em paralelo grava um único evento.

## 5. Modelo de dados proposto

No L1 as tabelas existem só como DDL em esquema descartável
(`ledgerPecuarioDdl.js`). `public` é recusado.

```
ledger_pecuario_evento   (append-only)
  id PK · cliente_id · empresa_id · tipo ENTRADA|TRANSFERENCIA|ESTORNO
  operation_id · data_operacional (date) · quantidade > 0 · categoria_chave
  area_origem_id? · area_destino_id? · lote_referencia_id? · estorno_de_evento_id?
  motivo? · autor_usuario_id · request_id? · created_at
  UNIQUE (cliente_id, operation_id)
  UNIQUE (cliente_id, estorno_de_evento_id)
  CHECK origem <> destino · CHECK forma por tipo
  INDEX (cliente_id, empresa_id, data_operacional, created_at)
  INDEX (cliente_id, lote_referencia_id) WHERE lote_referencia_id IS NOT NULL

ledger_pecuario_partida  (append-only)
  id PK · evento_id FK→evento (Restrict) · cliente_id · empresa_id · area_id
  categoria_chave · delta <> 0 · created_at
  INDEX (cliente_id, empresa_id, area_id, categoria_chave) · INDEX (evento_id)

ledger_pecuario_posicao  (projeção materializada, reconstruível)
  PK (cliente_id, empresa_id, area_id, categoria_chave)
  saldo >= 0 · versao · atualizado_em
```

**Identidade:**
- na prova de conceito, `bigint GENERATED ALWAYS AS IDENTITY`: o banco gera a
  PK, e o `gate:tenancy` proíbe o runtime de fornecê-la;
- no L2, `String @id @default(cuid())`, como todo o schema.

**Crescimento:**
- eventos e partidas crescem linearmente com as operações;
- a posição é O(áreas × categorias) por empresa;
- a reconstrução é `SUM(delta) GROUP BY` sobre o índice da posição, um único
  passe sem consultas em cadeia;
- arquivamento e particionamento por data ficam para quando o volume pedir.

### Plano de migration aditiva (L2, não executável aqui)

1. **Models Prisma.**
   - Criar `LedgerPecuarioEvento`, `LedgerPecuarioPartida` e
     `LedgerPecuarioPosicao`.
   - Todos com `cliente_id` obrigatório e índices começando por `cliente_id`
     (R9/R10).
   - FKs compostas `(cliente_id, empresa_id)` → `Empresa` e
     `(cliente_id, area_id)` → `AreaPastagem`, ambas `onDelete: Restrict`.
2. **Migration.**
   - Uma migration aditiva com `CREATE TABLE`, os `CHECK`s, os `UNIQUE`s, a
     função e os triggers append-only (SQL manual na migration, como já é
     feito para outras constraints).
   - Sem `ALTER` em tabelas existentes.
3. **Grants/RLS backend-only** (`gate:supabase-public-grants`): sem grant
   para `anon`/`authenticated`.
4. **Rotas.** `POST /estoque-pecuario/entradas|transferencias|estornos` e
   `GET /estoque-pecuario/posicoes`, com `auth_context`, e os códigos abaixo
   registrados no mapa global de erros.
5. **Backfill.** Só depois da reconciliação revisada (§7), em lote, com
   `operation_id` determinístico por registro legado, para que reexecutar
   seja replay.

## 6. Códigos de erro (estáveis)

| Código | Quando |
|---|---|
| `LEDGER_PECUARIO_QUANTIDADE_INVALIDA` | Quantidade não inteira, ≤ 0, string, acima do limite |
| `LEDGER_PECUARIO_CATEGORIA_INVALIDA` | Sem categoria explícita, ID malformado, categoria de outra empresa/tenant |
| `LEDGER_PECUARIO_ORIGEM_INVALIDA` | Área de origem fora da empresa/tenant |
| `LEDGER_PECUARIO_DESTINO_INVALIDO` | Área de destino fora da empresa/tenant ou inativa |
| `LEDGER_PECUARIO_ORIGEM_IGUAL_DESTINO` | Origem = destino (ID) |
| `LEDGER_PECUARIO_EMPRESA_INVALIDA` | Empresa fora do tenant |
| `LEDGER_PECUARIO_LOTE_REFERENCIA_INVALIDO` | Lote fora da empresa/tenant ou com entrada ativa já lançada |
| `LEDGER_PECUARIO_SALDO_INSUFICIENTE` | Posição ficaria negativa |
| `LEDGER_PECUARIO_OPERACAO_INVALIDA` | `operation_id` fora de 8–128 caracteres |
| `LEDGER_PECUARIO_DATA_INVALIDA` | `data_operacional` não é AAAA-MM-DD válida |
| `LEDGER_PECUARIO_EVENTO_NAO_ENCONTRADO` | Estorno de evento inexistente no tenant |
| `LEDGER_PECUARIO_ESTORNO_INVALIDO` | Estorno de estorno, ou sem motivo |
| `LEDGER_PECUARIO_ESTORNO_DUPLICADO` | Evento já estornado |
| `LEDGER_PECUARIO_IDEMPOTENCIA_CONFLITO` | Mesma `operation_id` com payload ou comando diferente |
| `LEDGER_PECUARIO_IDEMPOTENCIA_EM_PROCESSAMENTO` | Mesma chave ainda em processamento |
| `LEDGER_PECUARIO_CONCORRENCIA_ESGOTADA` | Retry de conflito transitório esgotado |
| `LEDGER_PECUARIO_CONTEXTO_OBRIGATORIO` | Sem `auth_context` |
| `LEDGER_PECUARIO_ESQUEMA_INVALIDO` | Esquema `public` ou identificador inválido (salvaguarda do L1) |

`LedgerPecuarioError` é uma classe própria, porque `AppError` exige código
registrado em `errorCodes.js`, arquivo compartilhado com a #145. O L2 move
esses códigos para o mapa global e define o status HTTP.

## 7. Reconciliação read-only do legado

`node scripts/ops/auditar-ledger-pecuario.mjs --entrada dump.json [--saida r.json] [--mostrar-ids]`

- **Entrada:** dump local `{ lotes, movimentacoes_mapa }`. Não conecta em
  banco, não lê env, não tem endereço de produção e não escreve fora do
  arquivo de saída pedido.
- **Entradas legadas:** lote com `origem` ≠ "MOVIMENTAÇÃO" e não cancelado
  conta `quantidade_entrada` em `area_entrada_id`. Lote com origem
  "MOVIMENTAÇÃO" é efeito do movimento parcial do legado e **não conta como
  compra**.
- **Movimentações:** só "Transferência de Área" é aplicada. Morte, abate,
  nascimento, junção, pesagem e mudança de categoria vão para **quarentena**
  (semântica de saldo não comprovada no legado).
- **Matriz** por empresa/área/categoria: entradas, transferências
  entrada/saída, esperada, observada (`quantidade_cabecas` dos lotes ativos em
  `area_atual_id`) e lacuna.
- **Suspeitas apontadas** (nunca corrigidas):
  - origem = destino (self-target);
  - duplicata por assinatura (lote, quantidade, origem, destino, data);
  - saldo esperado negativo;
  - categoria só textual.
- IDs saem com hash curto por padrão; nome de usuário nunca sai.

**Caso real observado (29/10/2026, reproduzido por fixture sintética):**
- **Lote 1** (150 → 135): a reconciliação espera 150 na área de entrada,
  observa 135 (**lacuna −15**) e marca o movimento de 15 para a própria área
  como `origem_igual_destino`.
- **Lote 2** (250 → 50 parcial → 200 total): esperado P = 0, Q = 50, R = 200;
  sem lacuna. O **lote 3** (50, origem "MOVIMENTAÇÃO") fica listado como
  gerado e **não** é somado como compra.

## 8. Correção recomendada no legado (diferida para L2)

`src/domain/lotes/movimentacaoLote.js` → `encontrarLoteDestinoCompativel` não
exclui o próprio lote de origem. Num movimento cujo destino é a área atual da
origem, ele devolve a origem como "destino compatível". O chamador,
`src/components/mapa/DetalhesLote.jsx`, está congelado (caminho da #145), por
isso a aplicação fica no L2:

```diff
 export const encontrarLoteDestinoCompativel = (lotesDestino, { loteOrigem, categoriaMovimento, areaDestinoId }) =>
   (lotesDestino || []).find(
     (candidato) =>
+      candidato?.id !== loteOrigem?.id &&
       candidato?.area_atual_id === areaDestinoId &&
```

Com o ledger, o próprio comando recusa origem = destino
(`LEDGER_PECUARIO_ORIGEM_IGUAL_DESTINO`).

## 9. Riscos, rollback e trade-offs

| Risco | Severidade | Mitigação / rollback |
|---|---|---|
| Rodar a DDL em `public` (drift de SSOT) | Alta | `esquemaSeguro` recusa `public`; a DDL só existe em teste. Rollback: `DROP SCHEMA … CASCADE` do esquema descartável. |
| Backfill contar lote "MOVIMENTAÇÃO" como compra | Alta | A reconciliação separa esses lotes; o backfill do L2 usa a mesma regra e a quarentena revisada. |
| Duas fontes de verdade durante o rollout (Lote.quantidade_cabecas × posição) | Média | No L2, o ledger é escrito em paralelo (sombra) e comparado pela reconciliação antes de o mapa ler a posição. Rollback: o mapa volta a ler `Lote`. |
| 25P02/unique sob mesma chave concorrente | Baixa | Retry limitado + replay (testado). |
| Hotspot de trava numa posição muito disputada | Baixa | A trava é por (área, categoria); operações de áreas diferentes não se bloqueiam. |
| Trigger append-only atrapalhar manutenção | Baixa | Correção é sempre estorno; manutenção excepcional exige migration explícita. |

## 10. Mapa arquivo → dono (L1 × PR #145)

Arquivos do L1, todos **novos**:
- `backend/src/modules/estoquePecuarioLedger/*`
- `backend/tests/estoquePecuarioLedger*.test.mjs`
- `scripts/ops/auditar-ledger-pecuario.mjs`
- `scripts/ops/auditarLedgerPecuarioLib.mjs`
- este documento
- `docs/engineering/MAIKE-ESTOQUE-PECUARIO-LEDGER-L1-REPORT.md`

A interseção com os 35 arquivos da PR #145 é **vazia**. Os arquivos
compartilhados não foram tocados (as entradas no registro ficam para o rebase
do L2):
- `schema.prisma`, `app.js`, `errorCodes.js`, `helpers.mjs`;
- `DECISIONS.md`, `CURRENT-STATE.md`.
