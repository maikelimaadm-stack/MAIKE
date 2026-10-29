# MAIKE — Ledger de estoque pecuário por área (L1): contrato

**Status:** L1-R2 (correções da auditoria) — backend isolado, **sem rota,
sem migration, sem UI**. Não é produção. A integração (L2) depende do merge da PR #145 e de um rebase
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
| `ENTRADA` | `+q` em (área, categoria) | `lote_referencia_id` **obrigatório**: cadastro de lote = entrada histórica. Ver §2.1. O ledger nunca escreve em `Lote`. Só **uma** entrada ativa (não estornada) por lote. |
| `TRANSFERENCIA` | `−q` origem, `+q` destino | Origem ≠ destino **por ID**. As duas áreas precisam ser da mesma empresa e do mesmo tenant. Destino inativo é recusado; origem inativa pode ser esvaziada. |
| `ESTORNO` | Inverso exato das partidas do original | Exige motivo. Um estorno por original (`UNIQUE(cliente_id, estorno_de_evento_id)`). Estorno de estorno é recusado. Exige saldo para desfazer. |

### 2.1 Entrada = snapshot histórico do cadastro (R2)

A ENTRADA só é aceita se bater com o snapshot do lote, lido com
`SELECT … FOR UPDATE` na tabela real `"Lote"` (escopo tenant + empresa):

| Campo do pedido | Precisa ser igual a | Divergência |
|---|---|---|
| `quantidade` | `Lote.quantidade_entrada`. **Não** a atual `quantidade_cabecas`. | `LEDGER_PECUARIO_ENTRADA_DIVERGENTE_DO_LOTE` |
| `area_id` | `Lote.area_entrada_id` | idem |
| categoria | `cm:<Lote.categoria_manejo_entrada_id>`. Sem nenhuma categoria (nem ID nem texto, de entrada ou atual) = `SEM_CATEGORIA`. Só texto, ou só a categoria atual, não é comprovável e é recusado. | idem |
| origem do lote | classe `cadastro` (§2.2) | `LEDGER_PECUARIO_LOTE_ORIGEM_NAO_SUPORTADA` |

- Nada é "ajustado" em silêncio.
- O status operacional do lote (Ativo/Inativo…) **não** impede lançar a
  entrada histórica.
- Uma área de entrada hoje inativa também não impede.

**Serialização (P0 R2):**
- A trava do Lote acontece **antes** da checagem de "entrada ativa", na mesma
  transação da idempotência.
- Duas ENTRADAS do mesmo lote com `operation_id` diferentes esperam uma pela
  outra; a segunda enxerga a primeira e é recusada
  (`LEDGER_PECUARIO_LOTE_REFERENCIA_INVALIDO`).
- Área diferente para o mesmo lote cai na divergência de snapshot.
- Não há UNIQUE de "entrada ativa por lote" na prova de conceito, porque a
  regra depende da tabela de estornos. A garantia é a trava, provada em 10
  rodadas de transações reais. No L2 avaliar uma coluna/índice que torne a
  regra declarativa.

**Fora do L1 (sem contrato de evento):**
- nascimento, ajuste e entrada sem documento;
- lotes derivados do legado.

Não existe entrada "solta" sem `lote_referencia_id`.

### 2.2 Classes de origem do lote (`classificarOrigemLote`)

Base: `ORIGENS_SISTEMA` em `src/services/loteCadastroService.js`, comparado
sem acento/caixa.

| Origem | Classe | Ledger (comando) | Reconciliação |
|---|---|---|---|
| qualquer outra (ex.: "Compra") | `cadastro` | ENTRADA aceita | conta como entrada |
| `NASCIMENTO` / `Nascimento` | `nascimento` | recusado (L2) | conta como entrada (fato real) + quarentena impeditiva |
| `MOVIMENTAÇÃO` | `derivado_movimento` | recusado | não é entrada; o efeito vem da transferência |
| `REVERSÃO MOVIMENTAÇÃO` | `derivado_reversao` | recusado | não é entrada + quarentena impeditiva |
| `MUDANÇA DE CATEGORIA` | `derivado_categoria` | recusado | não é entrada + quarentena impeditiva |

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
   `data_operacional` estrita: a string **inteira** é `AAAA-MM-DD` e é uma data
   de calendário real.
   - aceitos: 2024-02-29, 2000-02-29;
   - recusados: 2026-02-29, 2026-02-30, mês 13, dia 00, sufixo, hora,
     espaços.
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
10. ENTRADA bate com o snapshot histórico do lote (§2.1) e há no máximo uma
    entrada ativa por lote, mesmo sob concorrência.

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
- a mesma `operation_id` em paralelo grava um único evento;
- **duas ENTRADAS do mesmo lote com `operation_id` diferentes**: exatamente 1
  em 10 rodadas, sem idempotência presa da perdedora.

## 5. Modelo de dados proposto

No L1 as tabelas existem só como DDL em esquema descartável
(`ledgerPecuarioDdl.js`).

**Namespace exclusivo (R2):**
- só nomes `^ledger_l1_[0-9a-f]{12,32}$` são aceitos para criar, operar e
  `DROP SCHEMA … CASCADE`;
- `public`, `auth`, `storage`, `pg_catalog`, `information_schema`, `prisma`,
  esquemas de aplicação, vazio e formato arbitrário são recusados por
  construção;
- `gerarEsquemaDescartavel()` cria o nome;
- a suíte compara os esquemas `ledger_l1_%` antes e depois e prova que criou e
  removeu só o seu.

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
5. **Backfill.** Só com `apto_para_backfill === true` (§7) **e** a
   aprovação humana descrita lá. Em lote, com
   `operation_id` determinístico por registro legado, para que reexecutar
   seja replay.

**O L2 não é automático depois do merge da #145.** Antes de qualquer
migração real, cada item exige aprovação explícita:
- rebase supervisionado;
- models/migration Prisma com FKs tenant-aware;
- grants/RLS;
- API autenticada;
- idempotência operacional;
- E2E real;
- export/backup;
- reconciliação validada com dump autorizado;
- **aprovação manual** de backfill e cutover.

**Escrita sombra:**
- nada de dual-write cliente/servidor em transações separadas sem plano de
  atomicidade/reprocessamento;
- nenhuma entrada histórica duplicada;
- o ledger fica desligado para usuários até os gates de paridade e rollback
  estarem aprovados.

**Leitura do mapa:** não vira para o ledger enquanto houver quarentena ou
dupla fonte de verdade sem consistência comprovada.

## 6. Códigos de erro (estáveis)

| Código | Quando |
|---|---|
| `LEDGER_PECUARIO_QUANTIDADE_INVALIDA` | Quantidade não inteira, ≤ 0, string, acima do limite |
| `LEDGER_PECUARIO_CATEGORIA_INVALIDA` | Sem categoria explícita, ID malformado, categoria de outra empresa/tenant |
| `LEDGER_PECUARIO_ORIGEM_INVALIDA` | Área de origem fora da empresa/tenant |
| `LEDGER_PECUARIO_DESTINO_INVALIDO` | Área de destino fora da empresa/tenant ou inativa |
| `LEDGER_PECUARIO_ORIGEM_IGUAL_DESTINO` | Origem = destino (ID) |
| `LEDGER_PECUARIO_EMPRESA_INVALIDA` | Empresa fora do tenant |
| `LEDGER_PECUARIO_LOTE_REFERENCIA_INVALIDO` | Lote ausente (obrigatório), fora da empresa/tenant, ou com entrada ativa já lançada |
| `LEDGER_PECUARIO_LOTE_ORIGEM_NAO_SUPORTADA` | Lote derivado do legado (movimento/reversão/mudança de categoria) ou nascimento (sem contrato no L1) |
| `LEDGER_PECUARIO_ENTRADA_DIVERGENTE_DO_LOTE` | Quantidade/área/categoria ≠ snapshot histórico do lote, ou categoria histórica não comprovável |
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
| `LEDGER_PECUARIO_ESQUEMA_INVALIDO` | Esquema fora de `ledger_l1_<hex>` (salvaguarda do L1) |

`LedgerPecuarioError` é uma classe própria, porque `AppError` exige código
registrado em `errorCodes.js`, arquivo compartilhado com a #145. O L2 move
esses códigos para o mapa global e define o status HTTP.

## 7. Reconciliação read-only do legado (R2)

`node scripts/ops/auditar-ledger-pecuario.mjs --entrada dump.json [--saida r.json] [--mostrar-ids]`

**Entrada do script:**
- dump local `{ lotes, movimentacoes_mapa, mapeamento_categorias? }`;
- não conecta em banco, não lê env, não tem endereço de produção e não
  escreve fora do arquivo de saída pedido.

**Entradas históricas:**
- Contam pela classe de origem (§2.2), **qualquer que seja o status
  operacional atual**: Ativo, Inativo, Vendido, Abatido, Transferido…
  Status é estado operacional, não prova de anulação.
- O legado não tem mecanismo formal de anulação de compra. Por isso um status
  com cara de anulação (Cancelado/Excluído/Estornado/Anulado) **conta** e vai
  para quarentena (`status_de_anulacao_sem_prova_formal`).

**Categoria da entrada:**
- é a **histórica** (`categoria_manejo_entrada_id`);
- sem ela, conta sob chave `texto:` e gera suspeita impeditiva
  `categoria_somente_texto`;
- a **posição observada** usa a categoria **atual**;
- lote com categoria de entrada ≠ atual → `mudanca_categoria_nao_suportada`
  (impeditiva).

**Categoria da transferência (R3, fail-closed).** Só três fontes contam, e
cada uso fica registrado em `proveniencia_categoria_movimento`:

1. **`evento`:** `dados.categoria_manejo_id` com forma de ID válida.
   - Se o lote tem categorias conhecidas (entrada/atual) e o ID do evento não
     é uma delas: quarentena `categoria_do_movimento_conflitante`.
   - Forma inválida: quarentena `categoria_do_movimento_invalida`.
2. **`lote_estavel`:** só para lote de **cadastro** com
   `categoria_manejo_entrada_id` **presente e igual** à
   `categoria_manejo_id` atual.
   - **Ausência do histórico não prova nada:** vai para quarentena.
   - Lote derivado (MOVIMENTAÇÃO etc.) nunca serve de prova, porque o legado
     copia a categoria de entrada da origem.
3. **`mapeamento`:** texto → ID explícito, revisado por gente. Mapeamento com
   ID malformado: quarentena `mapeamento_categoria_invalido`.
4. **Sem prova:** quarentena impeditiva
   `categoria_do_movimento_nao_comprovavel`. O movimento **não** entra na
   matriz e nenhum nome livre vira ID.

**Quantidades:**
- inteiro **seguro** estrito, 0 < n ≤ 2.147.483.647 (`int4`, o tipo das
  colunas de fatos);
- `10.5`, `""`, `NaN`, negativos, `"12abc"`, `"1e3"`, `2^31` e
  `MAX_SAFE_INTEGER + 1` vão para quarentena, sem truncar nem converter.

**Dois limites, propositalmente diferentes:**
- **Comando do ledger:** até 1.000.000 por evento
  (`QUANTIDADE_MAXIMA_POR_EVENTO`).
- **Auditoria do legado:** até `int4` por registro
  (`QUANTIDADE_MAXIMA_REGISTRO_HISTORICO`). Ela ainda enxerga um registro
  acima de 1.000.000 (que o comando recusaria); acima de `int4` o valor não é
  representável e vai para quarentena.

**Empresa:** registro sem `empresa_id` vai para quarentena `empresa_ausente`
e aparece como `(sem_empresa)` em `por_empresa`, nunca apto.

**Tipos de movimento:**
- só "Transferência de Área" é aplicada;
- os demais vão para quarentena impeditiva `tipo_nao_aplicado`;
- origem = destino é suspeita não impeditiva (neutra no saldo);
- duplicata por assinatura e saldo esperado negativo são suspeitas
  impeditivas.

**Estado (geral e por empresa):**

| Estado | Quando |
|---|---|
| `conciliada` | Nenhuma lacuna, suspeita ou quarentena |
| `reconciliacao_parcial` | Há lacuna ou item não impeditivo |
| `bloqueada_para_backfill` | Há item impeditivo |

Diferença zero com item em quarentena **nunca** sai como `conciliada`.
`por_empresa` traz totais, lacunas e contagem por motivo/tipo, inclusive para
empresas que só aparecem em quarentena ou suspeita. Dump vazio sai como
`sem_dados`.

**`apto_para_backfill` (R3, fail-closed), geral e por empresa:**
- É `true` **somente** com estado `conciliada`, zero lacunas, zero
  suspeitas, zero quarentena, empresa identificada e dados presentes.
- Qualquer outro caso é `false`:
  - `reconciliacao_parcial` com lacuna (150/135);
  - diferença total zero com lacunas opostas por área;
  - self-target sem lacuna;
  - quarentena;
  - empresa ausente;
  - dump vazio.
- Uma empresa inapta torna o geral `false`.

**Mesmo `apto_para_backfill === true` não autoriza nada sozinho.** É só o
pré-requisito mínimo para *considerar* um backfill. Depois ainda dependem:
- revisão humana;
- backup;
- migration revisada;
- ensaios em ambiente descartável;
- **aprovação escrita do proprietário**.

Nunca executar automaticamente.

**Casos provados (fixtures sintéticas; nada lido do remoto):**

| Caso | Resultado |
|---|---|
| 1000 em A → transferência total para B; lote original **Inativo**; lote gerado "MOVIMENTAÇÃO" Ativo em B | A = 0, B = 1000, total 1000, 0 lacunas, `conciliada` |
| 150 → 135 + movimento de 15 para a própria área | lacuna −15 em X, suspeita `origem_igual_destino`, `reconciliacao_parcial` (sem remendo) |
| 250 → 50 parcial (lote gerado 50) → 200 total | P = 0, Q = 50, R = 200; o gerado não é compra |
| Lote que mudou de categoria + transferência anterior | entrada sob a categoria histórica, posição sob a atual, movimento em quarentena, lacuna visível, `bloqueada_para_backfill` |

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

A lista de arquivos da #145 **muda com o tempo**: eram 35 numa leitura
inicial e 95 no head `9bad34ce`. Por isso a interseção é recalculada contra o
head **atual** da #145 a cada push (`git diff --name-only origin/main...<head>`).

Arquivos do L1, todos **novos**:
- `backend/src/modules/estoquePecuarioLedger/*`
- `backend/tests/estoquePecuarioLedger*.test.mjs`
- `scripts/ops/auditar-ledger-pecuario.mjs`
- `scripts/ops/auditarLedgerPecuarioLib.mjs`
- este documento
- `docs/engineering/MAIKE-ESTOQUE-PECUARIO-LEDGER-L1-REPORT.md`

A interseção com a PR #145 atual é **vazia**. Os arquivos
compartilhados não foram tocados (as entradas no registro ficam para o rebase
do L2):
- `schema.prisma`, `app.js`, `errorCodes.js`, `helpers.mjs`;
- `DECISIONS.md`, `CURRENT-STATE.md`.
