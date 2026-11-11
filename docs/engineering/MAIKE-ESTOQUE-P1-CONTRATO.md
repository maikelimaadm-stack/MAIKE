# MAIKE-ESTOQUE-P1 — Contrato de projeto (PROPOSTA)

> **STATUS: PROPOSTA, AGUARDANDO APROVAÇÃO EXPRESSA DO PROPRIETÁRIO.**
> Este documento é **contrato de projeto**: descreve como as próximas PRs do estoque devem funcionar. **Nada aqui está implementado** e nada aqui autoriza código, migration, tela ou rota.
> - A entrada manual de estoque continua **proibida** pela constituição (`00-CONSTITUICAO.md`, expansão D-PROD-155) e pelo `07-DO-NOT-DO.md` (nota D-PROD-155) até a ratificação da emenda proposta em [`MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md`](./MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md).
> - Decisão candidata: **D-PROD-176**, registrada em `DECISIONS.md` como proposta pendente, nunca como autorização.
> - Missão: MAIKE-ESTOQUE-P1-01-GOVERNANCA-R1, derivada da análise somente leitura MAIKE-ESTOQUE-P1-00. Aquela análise **não está versionada** no repositório: tudo o que se aproveita dela está reescrito aqui, com evidência `arquivo:linha`.
> - **O merge desta PR não aprova nem ratifica nada** (ver §8).
> - Base auditada: `origin/main` `74ad3b868ff947f0153c969c51852748690f78a2`.
> - Todas as referências `arquivo:linha` abaixo são desse SHA.

## 0. Leitura rápida

| Conceito | É | Não é |
|---|---|---|
| **Produto** | Cadastro e identidade. `estoque_atual` é cache derivado, escrito só pelo motor (D-PROD-161). | Lugar de entrada de saldo. Nenhum POST, PATCH ou CSV cria saldo. |
| **Camada física** (`EstoqueLoteNota`) | Quantidade, custo, procedência, local e data FIFO de um recebimento. É a **única** fonte de saldo. | Lote do fabricante. |
| **Movimento** (`MovimentacaoEstoque`) | Fato imutável produzido por um comando do motor. | Registro editável. Não existe "criar movimento livre". |
| **Lote do fabricante** (candidato `ProdutoLoteFabricante`) | Identidade comercial: fabricante, número, fabricação e validade. | Saldo ou custo. O saldo do lote é sempre derivado das camadas. |
| **Entrada** | Documento confirmado que **introduz** quantidade. Hoje só a compra financeira confirmada da Gestão P3. No futuro, também a entrada manual documentada, com motivos fechados. | Compra, receita, título, inventário, devolução ou "acerto" de saldo. |
| **Movimentação** | Consumo, venda, abastecimento, suplementação, transferência e futuras reversões, sempre por comando transacional do motor único. | Edição de saldo. |
| **Histórico** | Fatos imutáveis e estornos compensatórios. | Quantidade reescrita em cadastro. |

**Regra de ouro:** só um comando do motor (`backend/src/modules/estoqueFisico/estoqueFisicoMotor.js`) muda quantidade.
- Toda tela futura (desktop, celular e, um dia, offline) usa a mesma API de comandos, com `operation_id`, fingerprint e versão.
- Não existe motor por tela.
- Esta fase não promete offline para comandos novos.

## 1. Estado de partida (fatos verificados)

**Motor único (D-PROD-161).** As escritas físicas de quantidade estão todas no motor:
- `aplicarEntradaEstoque` :359-407;
- `aplicarSaidaFifo` :479-537;
- `aplicarTransferenciaEstoque` :559-669;
- `estornarEntrada` :698-751, sem chamador de produção;
- `estornarSaida` :765-823;
- `estornarEmLote` :854-1016.

Os caminhos genéricos respondem 409/422:
- `movimentacaoEstoqueService.js:52-60`;
- `estoqueLoteNotaService.js:146-169` e `:223-236`;
- `produtoService.js:246-268`.

**A entrada física de hoje vem só da compra confirmada da P3:**
- chamada do motor em `operacaoFinanceiraService.js:1374`;
- a confirmação em `operacaoFinanceiraService.js:1403-1507`.

**O motor ainda "finge compra" para qualquer entrada:**
- `motivo_movimentacao` é fixo (`estoqueFisicoMotor.js:390`);
- o padrão de `tipo_detalhado` é `compra_financeiro` (`:381`);
- o estorno está amarrado a `direcao === 'PAGAR'` (`:858`), com os rótulos `estorno_compra` e `Estorno de compra…` (`:974`, `:982`).

**Unidade de estoque sem domínio fechado:**
- a rota aceita qualquer texto até 16 caracteres (`produtoRoutes.js:32`), e o service não confere (`produtoService.js:135`);
- o motor rotula `'L'` para Produto em L e `'KG'` para todo o resto (`estoqueFisicoMotor.js:310`);
- a UI oferece só KG, SACO e L.

**Reconciliação** (somente leitura):
- reconhece só as origens de `ORIGENS_PROTOCOLO` (`reconciliacaoEstoque.js:135`);
- explica a camada estornada só por `OperacaoFinanceiraItem.movimentacao_estorno_id` (`:502-506`).

**`LocalEstoque` não tem `empresa_id`** (`schema.prisma:803-824`): é do tenant. **Produto** é da empresa e não muda de empresa com histórico (D-PROD-161).

**Produção** (SELECT só leitura, 2026-11-11):
- 40 migrations;
- 2 tenants, 2 produtos, 3 camadas, 9 movimentos, 2 locais;
- 0 produto com cache divergente das camadas.

## 2. Matriz Antes → Proposta → Pré-requisito → Slice futuro

| # | Tema | Antes (main 74ad3b86) | Proposta deste contrato | Pré-requisito | Slice |
|---|---|---|---|---|---|
| M1 | Governança da entrada manual | Proibida (00 nota D-PROD-155; 07 nota D-PROD-155; D-PROD-08) | Exceção restrita: documento de entrada manual legitimada, com 3 motivos fechados | Ratificação humana da emenda | Ratificação (entre P1-01 e P1-02) |
| M2 | Motor finge compra | Motivo e tipo fixos de compra; estorno amarrado a `PAGAR` | Parâmetros **aditivos e opcionais**, com padrões iguais aos atuais (§6.2) | M1 decidido | P1-02 |
| M3 | Unidade de estoque | Texto livre; rótulo `'KG'` silencioso | Domínio {KG, SACO, L} na rota, no service e no item KG do financeiro | SELECT de pré-checagem em produção, com GO | P1-02 |
| M4 | Custo negativo | Aceito pelo motor (só teto, `:371`) | Recusado no motor e no serviço | — | P1-02 |
| M5 | Estorno sem conferir o original | `movimentoOriginal` só confere se existe (`:676-681`). `estornarEmLote` lê os originais sem `status` (`:879`), só confere a existência (`:905-909`) e marca `Estornada` sem guarda de status (`:1004-1007`) | Nas duas primitivas: ler `status` e `movimento_filho_id`, exigir `Ativa` e filho nulo sob `FOR UPDATE`, e pôr `AND status = 'Ativa'` no UPDATE conferindo a contagem | — | P1-02 |
| M6 | B-03 (replay) | O 201 devolve Decimal como string e o replay devolve número | O corpo vira JSON puro **antes** de gravar o recibo; teste `deepEqual(201, replay)` | — | P1-02 |
| M7 | Índices | LC-2 e R2-2 abertos; sem keyset de movimentos | Índices comuns expand-only, sem `CONCURRENTLY` (o classificador não aceita) | GO + runbook | P1-03 |
| M8 | Consulta de movimentos | GETs sem guarda de tela e sem limite obrigatório | GETs novos, paginados, com guarda e cursor assinado; os antigos ficam para o Mapa | P1-03 | P1-04 |
| M9 | Entrada documentada | Não existe | `EntradaEstoque` + itens, com reconciliação no **mesmo** slice e dedupe documental bidirecional | M1, M2, M3 | P1-05 |
| M10 | Tela de entradas | Não existe; não há página | Página candidata `EntradasEstoque` | M9 | P1-06 |
| M11 | Lote do fabricante | Não existe | `ProdutoLoteFabricante` (N camadas → 1 lote), sem saldo e sem custo | M9; política de unicidade ratificada | P1-07 |
| M12 | Lote na compra P3 | — | O item financeiro leva o lote até a camada | M11 + decisão própria (toca o P3) | P1-08 |
| M13 | Linhagem e estornos | `movimento_filho_id` com papel duplo; sem estorno de transferência nem de suplementação | Documento de transferência com fatias por FK; comando único de suplementação (R18) | DDL + GO | P1-09..P1-11 |
| M14 | Escala da reconciliação | R2-1, R2-3 | Partição por local; job com snapshot exportado | Slices anteriores | P1-12, P1-13 |

## 3. A — Entradas legítimas, sem compras duplicadas

### A1. Compra e venda mercantil
- **Só** pela `OperacaoFinanceira` da Gestão P3. A confirmação de uma compra com mercadoria cria fato e camada pelo `aplicarEntradaEstoque`, **uma única vez**: o documento ativo é único (`schema.prisma:2081`) e a advisory do documento fica em `operacaoFinanceiraService.js:1447-1453`.
- Uma entrada manual que, na verdade, era compra **não se converte** em compra. A conversão exige decisão própria. Até lá, o único caminho é cancelar a entrada (só com camadas intocadas) e lançar a compra.
- A entrada manual **não pode**:
  - representar compra;
  - duplicar um documento financeiro;
  - criar ou alterar títulos;
  - criar conta a pagar;
  - contabilizar receita.
- Não existe motivo `COMPRA`.

### A2. Motivos do 1º slice (P1-05)

| Motivo | Uso legítimo | Custo | Permissão |
|---|---|---|---|
| `SALDO_IMPLANTACAO` | Saldo físico que já existia quando o produto começou a ser controlado no MAIKE | Declarado > 0. Zero só com `custo_zero = true` e justificativa (custo histórico desconhecido) | `confirmar` |
| `DOACAO` | Recebimento sem contrapartida financeira | `custo_zero = true` é o padrão deste motivo. Valor de referência opcional (aí `custo_zero = false`), que vira o custo da camada (auditado) | `confirmar` |
| `OUTRA_COM_JUSTIFICATIVA` | Caso legítimo raro, fora dos anteriores | Declarado ≥ 0. Zero exige justificativa | ação própria e mais forte (`confirmar_outra`), sem concessão automática; justificativa verificável com 20 caracteres ou mais |

**Fora do 1º slice** (cada um exige comando e decisão próprios): `COMPRA`, `AJUSTE_INVENTARIO`, `DEVOLUCAO` (qualquer tipo), transferência entre empresas, retorno de suplementação, entrada por nota fiscal.

`OUTRA_COM_JUSTIFICATIVA` e `DOACAO` **não** são rota alternativa para compra, inventário, devolução, mudança de local **nem saldo pré-existente (implantação)**:
- a justificativa e o motivo são revisáveis por filtro `motivo` e coluna de justificativa na consulta futura (P1-04) e no detalhe da entrada (P1-06). **Não** há página de "relatório": `Relatorios` e `RelatoriosEstoque` são nomes proibidos;
- quando houver identidade documental, aplica-se a deduplicação de A5;
- **produto com histórico e saldo antigo nunca registrado não tem caminho no 1º slice.** A implantação é recusada (A3), e o saldo antigo só entra por um futuro `AJUSTE_INVENTARIO`, com decisão própria. A recusa traz essa orientação e **nunca** sugere `OUTRA`;
- para prevenir esse caso, a prévia da **primeira** compra P3 de um produto sem implantação avisa "registre a implantação antes". O aviso não bloqueia e entra no slice P1-05 (toca a P3).

**Por que a devolução fica fora:** o cancelamento do abastecimento devolve **todas** as fatias, conferindo `Σ fatias = quantidade` (`abastecimentoService.js:504-511`). Uma devolução avulsa seguida desse cancelamento devolveria duas vezes. A devolução só entra depois que todo cancelamento passar a descontar as devoluções já feitas.

### A3. Saldo de implantação: elegibilidade sobre TODO o histórico

> Corrige a P1-00, que olhava só "nenhuma camada no local".

**Regra.** A implantação de um produto `P` na empresa `E` só é aceita se o histórico físico de `P` estiver **vazio em todos os locais**, sem exceção de status. Conferir na confirmação, depois de `travarProdutosEstoque([P])`, que trava por advisory + `FOR UPDATE` no Produto (`estoqueFisicoMotor.js:78-85`):
1. nenhuma `EstoqueLoteNota` com `produto_id = P`, em qualquer local e qualquer status (`Disponivel`, `Esgotado`, `Estornado`);
2. nenhuma `MovimentacaoEstoque` com `produto_id = P`, em qualquer local, tipo, origem e status (inclusive `Estornada` e legado `manual`);
3. `Produto.estoque_atual = 0`;
4. nenhum `OperacaoFinanceiraItem` MERCADORIA **confirmado** de `P`. Já está coberto por (1) e (2), mas é conferido explicitamente para dar uma mensagem clara;
5. nenhuma outra `EntradaEstoque` `CONFIRMADA` com motivo `SALDO_IMPLANTACAO` que contenha `P`.

**Alcance da conferência:**
- vale para `produto_id = P` **independentemente do `empresa_id` gravado no fato**. Assim, um produto legado movido de fazenda antes da P0 também é barrado;
- a empresa do documento precisa ser a empresa atual do Produto.

**Vários locais no mesmo documento:**
- o **primeiro** documento de implantação de `P` pode ter vários itens de `P`, um por local (par `(P, local)` único no documento);
- todos os itens são pré-validados contra o estado **anterior** à confirmação, antes do primeiro efeito, de modo que o item 2 não é barrado pelo item 1 do mesmo documento;
- depois de confirmado, qualquer **segundo** documento de implantação de `P` dá 409 `ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO`.

**Cancelamento da implantação:**
- uma implantação cancelada deixa histórico: camada `Estornado`, movimento `Estornada` e o movimento compensatório. Também podem existir consumos já estornados sobre a camada: uma venda ou abastecimento cancelado devolve a fatia (`estornarSaida`, `estoqueFisicoMotor.js:780-797`), e a camada volta a ficar "intocada" pelo critério do motor;
- **variante estrita (adotada no texto proposto da emenda):** nunca reimplantar. O histórico da implantação cancelada conta como histórico;
- **variante aberta (R-IMPL, pendente):** os fatos de **implantações canceladas** de `P`, e só eles (mais os consumos estornados sobre essas camadas), não contam, desde que não exista nenhum outro fato de `P`. Se o proprietário escolher esta variante, o texto da emenda muda junto (ver a proposta de emenda, §5). **A R-IMPL precisa ser decidida antes da R-EMENDA.**

**Legado e órfãos** (nunca inventar saldo):

| Situação legada | Tratamento |
|---|---|
| Cache ≠ 0 sem camada (saldo sem fato anterior à P0) | Implantação **recusada** (condição 3). É caso de saneamento auditado com GO (P1, item 6 da D-PROD-161), nunca de "implantar por cima" |
| Camadas `Esgotado`/`Estornado` ou movimentos antigos com origem `manual` | Recusada: houve histórico físico |
| Camada órfã de produto apagado | Não afeta um produto novo (outro id). Fica reportada pela reconciliação como hoje |

**Limite declarado da unicidade por `produto_id`** (não há FK de camada nem de movimento para Produto; `schema.prisma:1189-1218`, `:1222-1300`). Não se detecta:
- o mesmo item físico implantado de novo num **outro** Produto (inativo com saldo, outro nome, produto recriado);
- uma compra P3 retroativa, sem documento, referente a mercadoria anterior à implantação.

Mitigação **não bloqueante**:
- a prévia da implantação avisa quando existir, na mesma empresa, Produto inativo com cache ≠ 0 ou camada órfã `Disponivel` com o mesmo `produto_nome`;
- a prévia da confirmação P3 de `P` avisa quando `data_operacional` ≤ data da implantação de `P`.

**Concorrência:**
- duas implantações do mesmo produto em documentos diferentes são serializadas pela trava do Produto;
- a segunda vê o fato da primeira e recebe 409.

### A4. Doação, custo e motivo
- Nenhum caminho cria título financeiro.
- **Custo:**
  - zero só quando o motivo permite **e** com `custo_zero = true`. Na `DOACAO`, `custo_zero = true` é o padrão; nos demais motivos, a flag é explícita;
  - negativo é proibido no serviço **e no motor** (P1-02);
  - o servidor calcula `valor_total = ROUND_HALF_UP(quantidade_estoque × custo, 4)`. O valor total **nunca** vem do corpo (o motor aceita custo e valor independentes, `estoqueFisicoMotor.js:364-366`, `:371`).
- A camada a custo zero produz consumo FIFO a custo zero. É efeito gerencial explícito e visível no relatório de entradas, nunca conta a pagar.

### A5. Deduplicação documental, nos dois sentidos

**Identidade documental** = `(empresa, parceiro_id, documento normalizado)`.
- **Documento externo presente ⇒ `parceiro_id` obrigatório** (CHECK na tabela nova). Sem isso, a chave do financeiro nunca casaria: no financeiro, `parceiro_id` é NOT NULL (`schema.prisma:2023`).
- O parceiro é validado como no financeiro (`operacaoFinanceiraService.js:279-282`): mesma empresa do documento e ativo. Tenant ou empresa divergente → o mesmo corpo de "inexistente".
- **Normalização compartilhada:** `textoDoCorpo(…, { maiusculas: true })`, que já é exportável (`backend/src/modules/gestao/gestaoComum.js:23-39`) e é o mesmo critério do `textoLinha` do financeiro (`operacaoFinanceiraPlano.js:137`). Teto de 64 caracteres (`:146-147`). Nenhuma ponta normaliza por conta própria.

**Bloqueios** (todos 409, todos sob advisory):

| De → para | Regra |
|---|---|
| Entrada → compra | Confirmar a entrada com PAGAR `CONFIRMADO` de mesma identidade → `ENTRADA_ESTOQUE_DOCUMENTO_DE_COMPRA` (com ou sem produtos no PAGAR) |
| Entrada → venda | Confirmar a entrada com RECEBER `CONFIRMADO` de mesma identidade → `ENTRADA_ESTOQUE_DOCUMENTO_DE_VENDA` (seria devolução de venda disfarçada) |
| Entrada → entrada | Duas `EntradaEstoque` `CONFIRMADA` de mesma identidade → `ENTRADA_ESTOQUE_DOCUMENTO_DUPLICADO`. Backstop: `documento_chave_ativa` (preenchida só em `CONFIRMADA`) com `@@unique([cliente_id, empresa_id, parceiro_id, documento_chave_ativa])`, que a tabela nova admite |
| Compra → entrada | **Todo caminho da P3 que grava `documento_chave_ativa` com direção PAGAR**, com ou sem produtos, consulta `EntradaEstoque` `CONFIRMADA` de mesma identidade → código próprio (candidato `OPERACAO_DOCUMENTO_EM_ENTRADA_ESTOQUE`). Os caminhos são três: `confirmar` (depois de `:1448`); `retificar` nos modos NO_LUGAR (`:2356`) e SUBSTITUICAO (`:2410`), dentro de `exigirDocumentoUnico` (`:2218-2226`); e a prévia (`:1270-1275`), como bloqueio |

- **Rascunho** financeiro com o mesmo documento gera **aviso**, não bloqueio (a chave é nula em RASCUNHO).
- Na `EntradaEstoque` `CONFIRMADA`, parceiro e documento são **imutáveis**. Corrigir = cancelar (só com camadas intocadas) e lançar de novo.
- **Mesma advisory:** a entrada usa `chaveDocumento` (`operacaoFinanceiraService.js:1284`), primeiro com `direcao = 'PAGAR'` e depois com `'RECEBER'`, sempre nessa ordem fixa.
- **Ordem de travas igual à do financeiro e à da C4:**
  1. cabeçalho `FOR UPDATE`;
  2. locais `FOR KEY SHARE`;
  3. `travarProdutosEstoque`;
  4. advisory do documento (PAGAR → RECEBER);
  5. consultas recíprocas.
  O financeiro faz `:1417` → `:1422` → `:1448`. A ordem inversa arrisca deadlock.
- **Isolamento:** os comandos de entrada e os da P3 envolvidos rodam em **READ COMMITTED**, que é o padrão de `TX_EFEITO` (`operacaoFinanceiraService.js:83`). A consulta recíproca vem **obrigatoriamente depois** da advisory: em REPEATABLE READ, o snapshot anterior à advisory não veria o commit concorrente. Teste PG de corrida nos dois sentidos.
- **Detalhes do 409:** só trazem número e id do outro documento se o usuário tiver `visualizar` na tela dele; senão, só o `reason`.
- **Bloqueio de liberação:** a entrada manual **não pode ser liberada** (tela, permissão ou release) enquanto os três caminhos da P3 não fizerem a consulta recíproca. Os testes cobrem os três e a corrida. **Tudo isso pertence ao P1-05**, com a decisão R-DEDUPE (toca contrato congelado da Gestão). Não é escopo desta PR de documentação.
- **Idempotência:** recibo próprio (`confirmar_entrada_estoque`) e o 409 de estado protegem contra a repetição da mesma tentativa. A advisory só **serializa**; quem **recusa** são a consulta e a unique acima.

**Limites declarados** (sem promessa de detecção):
- duas operações **sem** documento (por exemplo, doação sem nota);
- **só um** dos lados com documento (`documento_referencia` é opcional, `schema.prisma:2026`);
- **parceiros diferentes para o mesmo fornecedor** (Fornecedor não tem unique de CPF/CNPJ);
- **grafias diferentes** do número ("NF 123", "000123", "123"). A normalização é só trim + maiúsculas;
- o lado bloqueado **alterando o próprio documento** para escapar do 409, antes de confirmar.

**Mitigação não bloqueante:** na prévia e na confirmação de `DOACAO` e `OUTRA`, aviso obrigatório, com ciência registrada no AuditLog, quando existir PAGAR `CONFIRMADO` com mercadoria do **mesmo produto** e do mesmo parceiro (ou de parceiro com o mesmo CPF/CNPJ) nos últimos N dias. O valor de N fica para ratificação (R-DEDUPE).

### A6. Estados

| Estado | Efeito físico | Transições |
|---|---|---|
| `RASCUNHO` | Nenhum | `PUT` com versão (CAS); `DELETE` lógico com versão; `confirmar` |
| `CONFIRMADA` | Camadas + movimentos `Entrada` pelo motor; cache += | `cancelar`, só se **todas** as camadas estiverem intocadas |
| `CANCELADA` | Estorno físico transacional (camada `Estornado` por CAS + movimento compensatório) | Final |

- Não existe estorno parcial, `UPDATE` de quantidade confirmada ou `DELETE` de evento confirmado.
- Cancelamento com consumo ou transferência → 409 `ENTRADA_ESTOQUE_CANCELAMENTO_BLOQUEADO`, com `reason`:
  - `lote_consumido`, o motivo padrão (o motor não distingue consumo de transferência; `estoqueFisicoMotor.js:926`);
  - `lote_transferido`, só quando a consulta de linhagem (`camadasDerivadasPorTransferencia`) confirmar a transferência;
  - `estoque_atual_insuficiente`.
- `unidade_mudou` e `produto_mudou_de_fazenda` **não** são motivos de recusa. Com camada existente, o código já impede a troca de fazenda e a troca de/para L (`produtoService.js:198-212`, `:274-285`). KG ↔ SACO é o mesmo quilo físico e não deve bloquear. Se ocorrerem, são violação de invariante (500), não regra de negócio.
- **O cancelamento usa o kg gravado no item** (`quantidade_estoque` e `fator`), nunca refaz sacos × peso. É o mesmo princípio da P3 (`operacaoFinanceiraService.js:1358-1361`).

### A7. Datas
- A data operacional segue o fuso IANA da `Empresa` (`Empresa.fuso_horario`, `schema.prisma:986`; `hojeDaEmpresa`, `rebanhoLedgerTempo.js:119`).
- Nunca o dia local do navegador.
- `data_entrada` ≤ hoje da fazenda.
- **Pendente de ratificação (R-DATA):** limitar a data retroativa de `DOACAO` e `OUTRA` a um dia ≥ a data da camada `Disponivel` mais recente do local. A data da camada é a chave FIFO (`ordenarFifo`, `estoqueFisicoMotor.js:100-106`).

## 4. B — Lote do fabricante × camada física

### B1. Modelo
- **Candidato:** `ProdutoLoteFabricante`. O nome evita o prefixo `Lote`, que é o rebanho (`schema.prisma:701`), e os códigos `LOTE_*` (`errorCodes.js:244-256`).
- **Relação:** opcional, N camadas → 1 lote.
- **Campos:** fabricante (nome como digitado e chave normalizada), número (informado e normalizado), fabricação e validade (anuláveis), `ativo` e auditoria.
- **Não tem** saldo nem custo.
  - O saldo do lote = Σ `quantidade_disponivel` das camadas `Disponivel` que apontam para ele.
  - O custo continua na camada.
- **Fornecedor ≠ fabricante.** O fabricante é texto obrigatório. Não há papel "fabricante" em Parceiro (`fornecedorDominio.js:62`), e amarrá-lo a Parceiro exige decisão própria.
- **Opção recusada:** colunas soltas em `EstoqueLoteNota`. O classificador expand-only proíbe CHECK e UNIQUE em tabela antiga e recusa `DATE` em `ADD COLUMN` (`scripts/deploy/premergeMigrateLib.mjs:22-23`, `:154`, `:165`). Não haveria integridade, e a validade ficaria copiada e divergente entre camadas.

### B2. Ausência e obrigatoriedade
- **Lote ausente** em produto que não o exige = referência `NULL`.
  - Nunca `S/N`, `SEM LOTE`, `NA`, `0`, `ILEGIVEL` ou outra identidade fabricada: o serviço recusa com 422.
- **Lote obrigatório:** flag explícita por Produto (candidata `exige_lote_fabricante`).
  - Não retroativa.
  - Exceção auditada (ausência + motivo no comando e no AuditLog).

### B3. Unicidade: casos de borda e política (PENDENTE DE RATIFICAÇÃO, R-LOTE)

| Caso | Resultado esperado |
|---|---|
| Mesmo número em fabricantes diferentes | Lotes **distintos** (o fabricante entra na chave) |
| Mesmo número em produtos diferentes | Lotes **distintos** (o produto entra na chave) |
| Mesmo lote recebido em duas notas ou dois recebimentos | **Mesmo** lote; duas camadas apontam para ele |
| Mesmo lote em dois locais (transferência) | **Mesmo** lote; a camada de destino herda a referência |
| Fabricante **reutiliza** o número em outro ano | A chave `(tenant, produto, fabricante, número)` **colide legitimamente**. Não se afirma integridade perfeita só com essa chave |
| Fabricação desconhecida | Permitido (campo nulo) |
| Reclassificação depois do consumo | Permitida como **metadado**, com trilha (B4) |

**Política proposta para a colisão legítima.** A identidade do lote passa a ser `(tenant, produto, fabricante_chave, numero_chave, ocorrencia)`:
- `ocorrencia` é um inteiro ≥ 1, **imutável**, atribuído na criação. As datas são só atributos e podem ser corrigidas (auditado) sem mudar a identidade;
- **todo** recebimento cujo `(produto, fabricante_chave, numero_chave)` já exista exige **escolha explícita**, com ou sem datas e sem padrão: "é o mesmo lote" (aponta para a ocorrência escolhida) ou "é outro lote com o mesmo número" (cria a próxima ocorrência);
- nada é fundido nem separado em silêncio.

O critério de recusa e identificação definitivo é decidido na P1-07, com teste de cada linha da tabela. **Nenhuma migration agora.**

### B4. Transferência, reclassificação e validade
- **Transferência:** a camada de destino preserva custo, idade FIFO (data), procedência e **referência ao lote do fabricante**.
  - Mesmo mecanismo da procedência: `estoqueFisicoMotor.js:647-652`, que copia o que `lotesFifo` lê em `:443-450`.
  - Nunca nasce "lote novo de fábrica" na transferência.
- **Reclassificação:** comando próprio auditado (a rota genérica continua 409).
  - **Só na camada RAIZ** (a do recebimento, nunca `transferencia_recebida`). Camada derivada → 409 (candidato `PRODUTO_LOTE_FABRICANTE_RECLASSIFICAR_NA_RAIZ`). Assim origem e destino nunca divergem.
  - Travas: produto e depois a camada `FOR NO KEY UPDATE`.
  - Propaga para as camadas derivadas por transferência (`camadasDerivadasPorTransferencia`, `:1051-1071`).
  - Sempre a camada inteira; nunca parte dela.
  - Mesmo produto e mesma empresa.
  - Colisão de identidade → 409, sem fusão automática.
- **FIFO não muda.** Sem FEFO e sem bloqueio por validade.
  - A validade gera só **aviso operacional** (`avisos[]` na prévia e na resposta das saídas), sem reordenar o estoque.
  - FEFO ou bloqueio exigem decisão e testes de custo.
- **Reconciliação:**
  - a coluna nova fica fora de `CAMPOS_VINCULO_LOTE` (`reconciliacaoEstoque.js:148-150`);
  - invariante novo I6, somente leitura: produto e empresa da camada = os do lote; destino da transferência com a mesma referência da origem.
  - **I6 e custo ≥ 0 da camada são garantidos só pela aplicação e pela reconciliação**, não pelo banco. O classificador expand-only só aceita FK `("cliente_id", col_nova) → ("cliente_id", "id")` vinda de tabela antiga e recusa CHECK em tabela antiga (`scripts/deploy/premergeMigrateLib.mjs:22`, `:167-168`). Uma camada com custo negativo quebraria baixas futuras, porque as tabelas de consumo têm CHECK `custo_unitario >= 0`. Por isso a M4 é necessária.

## 5. C — Unidades, valores e integridade

### C1. Unidades
- D-PROD-162/169: produtos `L`, `KG` e `SACO`.
- **Unidade física-base:**
  - `KG` para produto em KG ou SACO (o SACO é convertido a kg pelo peso declarado, `peso_por_saco_kg`);
  - `L` para produto em L.
- `UN` (que hoje existe só para SERVIÇO no financeiro, `operacaoFinanceiraPlano.js:209`) e qualquer outro texto **não geram movimento físico** sem decisão e contrato próprios.
- **Proibido:** conversão `L ↔ KG`, densidade presumida, `1 L = 1 KG`, fator vindo do corpo.
- **Item da entrada:**
  - `unidade ∈ {KG, SACO, L}`;
  - SACO só em Produto SACO com peso > 0;
  - KG em Produto KG ou SACO;
  - L ⇔ L.

### C2. Valores
- Quantidade, custo e dinheiro em `Decimal` (`backend/src/modules/financeiro/decimalFinanceiro.js`):
  - 4 casas no saldo do motor;
  - `LIMITE_ESTOQUE` = `Decimal(14,4)`;
  - `ROUND_HALF_UP`.
- Fator, preço e arredondamento seguem os contratos congelados da P3 (`operacaoFinanceiraPlano.js:384-390`, `:480-492`) e do Patrimônio. Nunca `Number` em débito ou crédito.
- Custo ou quantidade negativos são recusados.
- **Fator do SACO:** capturado no rascunho e reconferido na confirmação. Se o peso do Produto mudou → 409 `ENTRADA_ESTOQUE_FATOR_DIVERGENTE`; nunca recálculo silencioso (diferente do replanejamento da P3, `operacaoFinanceiraService.js:1360-1364`).

### C3. Tenancy e referências
- `cliente_id` só do `auth_context` (R11). Toda entidade nova tem `cliente_id`.
- **FKs reais possíveis:**
  - para Produto, Fornecedor e LocalEstoque: `(cliente_id, id)`, como no `OperacaoFinanceiraItem`;
  - entre tabelas novas (entrada ↔ item): `(cliente_id, empresa_id, entrada_id)`.
  - Produto e Fornecedor não têm unique `(cliente_id, empresa_id, id)`, e criar uma seria UNIQUE em tabela antiga, recusado pelo classificador. **O banco garante o tenant, não a empresa.** A coerência de empresa de produto e parceiro com o documento é conferida no serviço, sob `travarProdutosEstoque` e com releitura na confirmação.
- `LocalEstoque` é do tenant, **sem `empresa_id`**: nada de FK ou permissão por empresa que não existe.
  - O local é validado por tenant e `ativo`.
  - A empresa vem do Produto e do documento.
- Referência de outro tenant ou empresa → o mesmo corpo de "inexistente", sem oráculo.
- **Produto com entrada em rascunho, lote do fabricante ou camada** não troca de empresa nem de unidade incompatível, e não é excluído. Estender:
  - `conferirTrocaDeUnidade` (`produtoService.js:198-212`);
  - a troca de fazenda (`:274-285`);
  - a exclusão.

### C4. Matriz de comandos, idempotência, concorrência, permissões e erros

| Comando (futuro) | Recibo (`tipo_operacao`) | Fingerprint | Ordem de travas | Permissão | Erros próprios |
|---|---|---|---|---|---|
| Criar rascunho | `criar_entrada_estoque` | corpo canônico sem `operation_id` | Produto `FOR KEY SHARE` (como o rascunho da P3; `produtoService.js:401-404`) → número reservado | `novo` / `salvar` | `MOTIVO_INVALIDO`, `UNIDADE_INCOMPATIVEL`, `CUSTO_INVALIDO`, `DATA_FUTURA`, `REFERENCIA_INVALIDA` |
| Editar rascunho (`PUT`) | — | — | cabeçalho com CAS de versão | `editar` | `VERSAO_CONFLITO`, `STATUS_INVALIDO` |
| Excluir rascunho | — | — | cabeçalho com CAS de versão | `excluir` | `VERSAO_CONFLITO` |
| Prévia | — | — | só leitura | `visualizar` | — |
| Confirmar | `confirmar_entrada_estoque` | `{id, empresa_id, versao}` | cabeçalho `FOR UPDATE` → locais `FOR KEY SHARE` → `travarProdutosEstoque` → **releitura** do Produto (empresa, unidade, peso; `exigirProdutoDaEmpresa` depende dela, `estoqueFisicoMotor.js:126-130`) → advisories PAGAR → RECEBER → consultas recíprocas → motor → `numerarMovimentos` no fim → AuditLog → recibo | `confirmar` (+ `confirmar_outra`) | `IMPLANTACAO_COM_HISTORICO`, `DOCUMENTO_DE_COMPRA`, `DOCUMENTO_DE_VENDA`, `DOCUMENTO_DUPLICADO`, `FATOR_DIVERGENTE` |
| Cancelar | `cancelar_entrada_estoque` | `{id, empresa_id, versao, motivo}` | mesma ordem | `cancelar` | `CANCELAMENTO_BLOQUEADO` (reasons de A6) |

- Todos os códigos têm o prefixo `ENTRADA_ESTOQUE_` e nenhum existe hoje (`errorCodes.js`).
- Códigos de plataforma reaproveitados: `REQUEST_VALIDATION_FAILED`, `IDEMPOTENCY_*`, `CONCURRENCY_CONFLICT`.
- Deadlock ou serialização → `CONCURRENCY_CONFLICT`.
- **B-03:** a resposta 201 é JSON puro antes de virar recibo. O replay é idêntico.
- **Permissões:**
  - o vocabulário é o de `ACOES` (`backend/src/shared/auth/autorizacaoTela.js:70`): `visualizar`, `novo`, `salvar`, `editar`, `excluir`…
  - ações extras em lista própria, candidata `ACOES_ENTRADA_ESTOQUE = ['confirmar', 'confirmar_outra', 'cancelar']`, com teste de paridade entre front e back (precedente: `ACOES_LANCAMENTOS_FINANCEIROS`, `:77`);
  - **sem concessão automática a perfis não administradores**. O administrador real e `is_admin` têm todas as ações por desenho (`telaPermite`). Exigir para `OUTRA` ou `SALDO_IMPLANTACAO` algo acima do administrador (dupla aprovação) depende de decisão própria;
  - nenhuma permissão nova é concedida por esta proposta.

## 6. D — Central de movimentos e extensibilidade

### 6.1 O que é consulta e o que é comando

| Operação | Hoje | Na central futura |
|---|---|---|
| Entrada por compra; venda | Lançamento P3 confirmado | Só consulta |
| Suplementação; transferência | Comandos em `movimentacaoEstoqueRoutes.js:102-126` | Só consulta |
| Abastecimento | `abastecimentoRoutes.js:150-154` | Só consulta |
| Estorno de compra e venda | `estornarEmLote` | Só consulta |
| Estorno de abastecimento | `estornarSaida` | Só consulta |
| Entrada documentada | — | **Comando novo** (P1-05) |
| Estorno de suplementação | — | **Comando novo**; pré-requisito R18 (comando único evento + baixa) e FK do evento (P1-10) |
| Estorno de transferência | — | **Comando novo**; pré-requisito linhagem por FK, porque `movimento_filho_id` tem papel duplo: `estoqueFisicoMotor.js:660` × `:683-687` (P1-09/P1-11) |
| Ajuste de inventário ± | — | **Comando novo** com decisão própria; correção = novo ajuste |
| Devolução | — | **Comando novo** com decisão própria (ver A2) |

- **`MovimentosEstoque`** (nome candidato) é **consulta consolidada** dos fatos produzidos pelos comandos.
  - Não cria escritor genérico.
  - Não reabre `POST /movimentacoes-estoque`.
  - Não ganha "editar saldo" nem "criar movimento livre".
- **`EntradasEstoque`** (nome candidato) é o documento de recebimento manual legitimado.
- **"Lotes de Produtos"** é rastreabilidade, não segunda forma de lançar estoque.
- **Nomes que continuam proibidos** (`config/mapa-manejo-scope.json`, `forbiddenDomains`): `MovimentacoesEstoque`, `LancamentoProdutosEstoque`, `RelatoriosEstoque`, `Relatorios`, `Dashboard`, `Home`. Esta proposta não os retira.

### 6.2 Parametrização aditiva do motor (P1-02; padrões iguais aos atuais)
1. Origem nova `entrada_estoque` em `ORIGENS_SISTEMA` e em `EXCLUSAO_SOMENTE_EM` (`estoqueFisicoMotor.js:56-63`) e em `ORIGENS_PROTOCOLO` (`reconciliacaoEstoque.js:135`).
2. `origem.motivo` opcional. Padrão: o texto atual de `:390`.
3. `tipo_detalhado` `entrada_<motivo>`. Nunca `compra_financeiro`.
4. `procedencia` opcional, com a allowlist `CAMPOS_PROCEDENCIA_LOTE` (`:1074`).
5. Recusa de custo e valor < 0.
6. **Estorno:** `efeito: 'ENTRADA'` em vez de `direcao === 'PAGAR'` (`:858`), mais `tipoDetalhadoEstorno`/`motivoEstorno` opcionais, como `estornarSaida` já faz (`:806`, `:814`).
7. **Proteção:**
   - teste "byte a byte" da P3 e `estoqueP0MotorUnico`;
   - o único chamador de produção de `aplicarEntradaEstoque` é `operacaoFinanceiraService.js:1374`.

### 6.3 Consultas
- **GETs novos** (P1-04):
  - paginados por keyset `(data_movimentacao DESC, id DESC)`;
  - `empresa_id` obrigatória;
  - guarda de tela;
  - cursor HMAC extraído da reconciliação, com rótulo próprio;
  - filtros fechados;
  - limite padrão 50, máximo 200;
  - Decimal como string.
- **Os GETs atuais** não podem ser reaproveitados como central:
  - não têm guarda de tela;
  - não têm limite obrigatório (`listQueryLimit.js:22-26`; `estoqueLoteNotaRepository.js:6-16`);
  - o Mapa depende deles (`mapaCacheService.js:107`), por isso ficam.
- **SSOT de menu, rotas e permissões:** `src/lib/menuConfig.js`, `src/pages.config.js`, o escopo e as guardas. **Nada disso é tocado agora.**

### 6.4 Offline
- Os comandos novos são idempotentes por desenho (recibo + versão), mas **só online** nesta fase.
- Não entra fila offline de escrita.
- **Backlog separado (S2):** um `update` legado de camada com campo restrito, preso na fila, recebe 409 e trava a fila (`estoqueLoteNotaNativePort.js:53-58`; `offlineEntityRuntime.js:860-862`). Proposta: UI mínima de "descartar com confirmação / exportar".

### 6.5 Riscos P0 que continuam (sem promessa de escala ilimitada)

| Risco | Natureza | Slice |
|---|---|---|
| R2-1 | Chave de produto muito volumosa; 409 fail-closed | P1-12 (partição por local) |
| R2-2 | AuditLog sem índice por produto | P1-03 (índice parcial de expressão) |
| R2-3 | Sem snapshot global entre requisições | P1-13 (job com snapshot exportado) |
| LC-2 | Recibos sem índice `(cliente_id, tipo_operacao, createdAt)` | P1-03 |
| B-03 | Replay número × string | P1-02 (comandos atuais) e regra de P1-05 |
| R18 | Suplementação: evento e baixa em duas transações | Pré-requisito de P1-10 |
| S2 | Fila offline legada | Backlog independente |

## 7. E — Sequência das futuras PRs (nenhuma autorizada por este documento)

Regras comuns:
- uma missão por PR (R7), com relatório (R8);
- `verify:all`;
- testes PG reais em PG16 (CI) e PG17 local;
- E2E 1280/390/412 quando houver tela.

**Com DDL**, a ordem é fixa:
1. runbook no modelo [`MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md);
2. GO escrito do proprietário;
3. ensaio local;
4. aplicação pelo runner oficial;
5. postcheck;
6. **só depois** o merge manual.

A lição está no incidente da P1-01 do Patrimônio (CURRENT-STATE). Sem backfill de cache ou de camadas sem reconciliação e GO.

| Ordem | Slice | Entrega | DDL | Depende de |
|---|---|---|---|---|
| 1 | **P1-01 governança** (esta PR) | Proposta de emenda, contrato, D-PROD-176 proposta | não | — |
| 2 | **Ratificação humana** | O proprietário decide primeiro a R-IMPL e depois aprova o texto da emenda e o incorpora pelo fluxo constitucional (§4 da constituição; A10 impede o agente) | não | 1 |
| 3 | P1-02 endurecimento do motor | §6.2, M3, M4, M5, M6 | não | 2 (a P1-02 inteira; ver R-SPLIT) |
| 4 | P1-03 índices | LC-2, R2-2, keyset | só índices | 1 |
| 5 | P1-04 GETs paginados e protegidos | §6.3, sem UI nova | não | 4 |
| 6 | P1-05 `EntradaEstoque` backend | Documento + itens, A1–A7, C4, reconciliação **no mesmo slice**, dedupe nos dois sentidos | sim (2 tabelas + RLS pinada) | 2, 3 |
| 7 | P1-06 tela Base1 de Entradas | Página, menu, escopo e permissões só aqui | não | 6 |
| 8 | P1-07 lote do fabricante | B1–B4, I6 | sim | 6; R-LOTE ratificada |
| 9 | P1-08 lote na compra P3 | Decisão própria | não (coluna no P1-07) | 8 |
| 10 | P1-09+ | Linhagem, estornos de suplementação e transferência, reconciliação v3, inventário/ajuste, offline | caso a caso | anteriores |

**Dependência a observar (P1-05 × P1-07).** Se o proprietário exigir lote do fabricante já no **primeiro** recebimento manual de produtos perecíveis, P1-07 precisa vir antes de P1-06 (tela).
- As duas migrations **não se misturam** sem justificativa e GO.
- Alternativa sem reordenar: P1-05/06 recusam produto com `exige_lote_fabricante = true` até P1-07 existir.

**Não se promete:** FEFO, reconciliação global perfeita, cancelamento de transferência sem linhagem.

## 8. Pontos que dependem de ratificação humana

> **O merge desta PR não aprova nem ratifica nada.** Isso difere do padrão em que o merge manual do proprietário materializa a aprovação (D-PROD-22/155/157/159/162). Aqui a ratificação exige o texto incorporado em `00` e `07` pelo fluxo da proposta de emenda (§5) e uma nota posterior datada na D-PROD-176.

- **R-EMENDA:** texto de [`MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md`](./MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md) para `00-CONSTITUICAO.md` e `07-DO-NOT-DO.md`.
- **R-MOTIVOS:** os 3 motivos do 1º slice, a exclusão de COMPRA, AJUSTE, DEVOLUCAO e afins, a proibição de usar DOACAO/OUTRA para saldo pré-existente e a ausência de caminho, no 1º slice, para produto com histórico e saldo antigo não registrado.
- **R-IMPL:** elegibilidade da implantação (A3), inclusive se uma implantação cancelada sem consumo libera nova implantação.
- **R-DATA:** limite da data retroativa de DOACAO/OUTRA (A7).
- **R-DEDUPE:** a consulta recíproca nos três caminhos da P3 (confirmar, retificar, prévia), a recíproca com RECEBER, a unique entrada × entrada, o valor de N do aviso de A5 e o aviso de "implantação antes da primeira compra". Tudo isso toca contrato congelado da Gestão.
- **R-LOTE:** identidade do lote com `ocorrencia` imutável e escolha explícita (B3); reclassificação só na raiz; nome do model.
- **R-ORDEM:** posição de P1-07 em relação a P1-05/06.
- **R-SPLIT (desvio a aprovar):** a sequência da missão exige a ratificação antes da P1-02 inteira, e é essa a regra adotada aqui. Se o proprietário quiser, pode autorizar dividir em duas PRs, cada uma com missão própria:
  - **P1-02a:** M3–M6, sem a origem `entrada_estoque` nem os parâmetros de motivo e estorno da §6.2;
  - **P1-02b:** a §6.2, só depois da ratificação.
  Sem essa autorização expressa, vale a regra estrita.
- **D-PROD-176:** número e texto da decisão.

> O proprietário deverá aprovar expressamente o texto proposto e ratificar pelo fluxo constitucional antes da P1-02, da P1-05 e da P1-06.
