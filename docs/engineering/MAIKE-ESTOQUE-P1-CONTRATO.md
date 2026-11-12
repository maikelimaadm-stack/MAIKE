# MAIKE-ESTOQUE-P1 — Contrato de projeto (PROPOSTA)

> **STATUS: PROPOSTA, AGUARDANDO APROVAÇÃO EXPRESSA DO PROPRIETÁRIO.**
> Este documento é **contrato de projeto**: descreve como as próximas PRs do estoque devem funcionar. **Nada aqui está implementado** e nada aqui autoriza código, migration, tela ou rota.
> - A entrada manual de estoque continua **proibida** pela constituição (`00-CONSTITUICAO.md`, expansão D-PROD-155) e pelo `07-DO-NOT-DO.md` (nota D-PROD-155) até a ratificação da emenda proposta em [`MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md`](./MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md).
> - Decisão candidata: **D-PROD-176**, registrada em `DECISIONS.md` como proposta pendente, nunca como autorização.
> - Missão: MAIKE-ESTOQUE-P1-01-GOVERNANCA-R1, derivada da análise somente leitura MAIKE-ESTOQUE-P1-00. Aquela análise **não está versionada** no repositório: tudo o que se aproveita dela está reescrito aqui, com evidência `arquivo:linha`.
> - **O merge desta PR não aprova nem ratifica nada** (ver §8).
> - Base auditada: `origin/main` `74ad3b868ff947f0153c969c51852748690f78a2`.
> - Todas as referências `arquivo:linha` abaixo são desse SHA.
> - **Revisão R2 (2026-11-11, MAIKE-ESTOQUE-P1-01-GOVERNANCA-R2), ainda PROPOSTA.** O proprietário pediu que a Entrada de Estoque tenha as ações **Editar** e **Excluir** e que "Cancelar" deixe de ser o único jeito de corrigir uma entrada. A R2 troca o estado `CANCELADA` por `EXCLUIDA` (exclusão lógica e auditada), cria a **edição de entrada confirmada por revisão versionada** (A8) e refaz a R-IMPL. O que mudou em relação à R1 está no relatório, §9.

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
| **Revisão da entrada** (R2) | Nova versão do documento confirmado: o motor estorna as camadas que mudam e aplica as novas na mesma transação, e a revisão anterior fica registrada (A8). | `UPDATE` de quantidade, custo, data, local, produto ou procedência de movimento ou camada existentes. |
| **Exclusão da entrada** (R2) | Documento `EXCLUIDA`: estorno integral pelo motor, motivo, autor e histórico preservados (A8). | `DELETE` de documento confirmado, de movimento ou de camada. |

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
| M9 | Entrada documentada | Não existe | `EntradaEstoque` + itens versionados + eventos, com reconciliação no **mesmo** slice e dedupe documental bidirecional; Editar e Excluir com guardas (A8) | M1, M2, M3 | P1-05a (documento, confirmar, excluir) e P1-05b (editar confirmada) |
| M10 | Tela de entradas | Não existe; não há página | Página candidata `EntradasEstoque`, com **Editar** e **Excluir** e sem botão "Cancelar" | M9 inteiro (P1-05a e P1-05b) | P1-06 |
| M11 | Lote do fabricante | Não existe | `ProdutoLoteFabricante` (N camadas → 1 lote), sem saldo e sem custo | M9; política de unicidade ratificada | P1-07 |
| M12 | Lote na compra P3 | — | O item financeiro leva o lote até a camada | M11 + decisão própria (toca o P3) | P1-08 |
| M13 | Linhagem e estornos | `movimento_filho_id` com papel duplo; sem estorno de transferência nem de suplementação | Documento de transferência com fatias por FK; comando único de suplementação (R18) | DDL + GO | P1-09..P1-11 |
| M14 | Escala da reconciliação | R2-1, R2-3 | Partição por local; job com snapshot exportado | Slices anteriores | P1-12, P1-13 |

## 3. A — Entradas legítimas, sem compras duplicadas

### A1. Compra e venda mercantil
- **Só** pela `OperacaoFinanceira` da Gestão P3. A confirmação de uma compra com mercadoria cria fato e camada pelo `aplicarEntradaEstoque`, **uma única vez**: o documento ativo é único (`schema.prisma:2081`) e a advisory do documento fica em `operacaoFinanceiraService.js:1447-1453`.
- Uma entrada manual que, na verdade, era compra **não se converte** em compra. A conversão exige decisão própria. Até lá, o caminho é **excluir** a entrada (só sem dependências físicas, A8) e lançar a compra pela Central. A exclusão libera o documento para a compra (A5).
- Editar ou excluir uma entrada manual **nunca** cria, altera ou cancela compra, título, conta a pagar ou receita.
- A entrada manual **não pode**:
  - representar compra;
  - duplicar um documento financeiro;
  - criar ou alterar títulos;
  - criar conta a pagar;
  - contabilizar receita.
- Não existe motivo `COMPRA`.

### A2. Motivos do 1º slice (P1-05a)

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
- para prevenir esse caso, a prévia da **primeira** compra P3 de um produto sem implantação avisa "registre a implantação antes". O aviso não bloqueia e entra no slice P1-05a (toca a P3).

**Por que a devolução fica fora:** o cancelamento do abastecimento devolve **todas** as fatias, conferindo `Σ fatias = quantidade` (`abastecimentoService.js:504-511`). Uma devolução avulsa seguida desse cancelamento devolveria duas vezes. A devolução só entra depois que todo cancelamento passar a descontar as devoluções já feitas.

### A3. Saldo de implantação: elegibilidade sobre TODO o histórico

> Corrige a P1-00, que olhava só "nenhuma camada no local".

**Regra.** A implantação de um produto `P` na empresa `E` só é aceita se o histórico físico de `P` estiver **vazio em todos os locais**, sem exceção de status. Conferir na confirmação, depois de `travarProdutosEstoque([P])`, que trava por advisory + `FOR UPDATE` no Produto (`estoqueFisicoMotor.js:78-85`):
1. nenhuma `EstoqueLoteNota` com `produto_id = P`, em qualquer local e qualquer status (`Disponivel`, `Esgotado`, `Estornado`);
2. nenhuma `MovimentacaoEstoque` com `produto_id = P`, em qualquer local, tipo, origem e status (inclusive `Estornada` e legado `manual`);
3. `Produto.estoque_atual = 0`;
4. nenhum `OperacaoFinanceiraItem` MERCADORIA **confirmado** de `P`. Já está coberto por (1) e (2), mas é conferido explicitamente para dar uma mensagem clara;
5. nenhuma outra `EntradaEstoque` `CONFIRMADA` com motivo `SALDO_IMPLANTACAO` que contenha `P` (**uma implantação ativa por produto e empresa**).

**Exceções propostas na R2 (R-IMPL), só estas duas:**
- **(i) linhas já estornadas de entrada manual.** As condições 1 e 2 desconsideram os fatos ligados por FK (`estoque_lote_nota_id`, `movimentacao_estoque_id`, `movimentacao_estorno_id`) a linhas de `EntradaEstoqueItem` **já estornadas**, de **qualquer motivo**. São as linhas fechadas por revisão (`revisao_fim` não nula) e as de documentos `EXCLUIDA`. Esses fatos nunca explicam baixa, porque só se estorna linha com a prova de A8.3. Isso cobre a implantação excluída, a doação excluída e o produto trocado numa revisão.
- **(ii) linhas vigentes do próprio documento, na revisão da própria implantação.** As condições 1 e 2 desconsideram os fatos ligados por FK às linhas vigentes do próprio documento. A condição 3 vira: `estoque_atual(P)`, lido depois de `travarProdutosEstoque`, é **exatamente igual** à soma do disponível das camadas vigentes do próprio documento para `P`, todas `Disponivel` e com disponível = entrada. Para um produto novo que não estava no documento, a soma é 0. A conta é feita sobre o estado **anterior** ao primeiro estorno. Qualquer divergência é recusada; nunca se subtrai só a linha alterada.

Nenhuma outra exceção. A identificação é sempre por **FK** das linhas de item, nunca por data, nome ou texto. Ver "Implantação: editar, excluir e reimplantar", abaixo.

**Alcance da conferência:**
- vale para `produto_id = P` **independentemente do `empresa_id` gravado no fato**. Assim, um produto legado movido de fazenda antes da P0 também é barrado;
- a empresa do documento precisa ser a empresa atual do Produto.

**Vários locais no mesmo documento:**
- o **primeiro** documento de implantação de `P` pode ter vários itens de `P`, um por local (par `(P, local)` único entre as linhas **vigentes** do documento; linhas fechadas por revisão podem repetir o par);
- todos os itens são pré-validados contra o estado **anterior** à confirmação, antes do primeiro efeito, de modo que o item 2 não é barrado pelo item 1 do mesmo documento;
- depois de confirmado, qualquer **segundo** documento de implantação de `P` dá 409 `ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO`.

**Implantação: editar, excluir e reimplantar (R2; substitui o antigo "cancelamento da implantação"; R-IMPL pendente)**

O usuário corrige o saldo de implantação por **Editar** ou **Excluir**, nunca por "Cancelar". As regras gerais de A8 valem; abaixo estão só as específicas da implantação.

1. **Uma implantação ativa por produto e empresa.** Continua valendo a condição 5. A correção é feita **no mesmo documento**, nunca por um segundo documento.
2. **Editar a implantação confirmada:**
   - **observação e justificativa:** sempre (A8, classe M);
   - **quantidade, custo, unidade, fator, parceiro e documento**, no mesmo par (produto, local) e com a **mesma data**: exigem a prova de A8.3 em **todas** as linhas vigentes do documento (dependência por documento, A8.1) e a janela FIFO de A8.4. Valem **mesmo que `P` tenha outros fatos depois da implantação** (por exemplo, compras). O motivo é que uma camada nunca referenciada não mudou o resultado de nenhuma baixa (A8.4). No caso normal, a camada nova fica na mesma posição da fila, e a janela passa;
   - **produto, local (incluir, trocar ou retirar par) e data:** além do item anterior, `P` e o produto novo, se houver, cumprem as condições 1 a 5 com as exceções (i) e (ii). Assim, a implantação nunca "anda" por cima de um histórico que não é dela;
   - **motivo:** nunca muda, nem de nem para `SALDO_IMPLANTACAO`, em nenhum documento (A8.1, classe I). Errou o motivo: exclui e lança de novo.
3. **Excluir a implantação confirmada:** só com a prova de A8.3 em **todas** as linhas vigentes. O documento vira `EXCLUIDA` e fica no histórico.
4. **Reimplantar depois da exclusão (proposta da R-IMPL):** uma **nova** implantação de `P` só é aceita se as condições 1 a 5 valerem com a exceção (i). Na prática, são desconsiderados exatamente:
   - as camadas apontadas por `EntradaEstoqueItem.estoque_lote_nota_id` das linhas já estornadas. Elas estão `Estornado`, com disponível 0;
   - os movimentos de entrada dessas linhas (`movimentacao_estoque_id`, `Estornada`, com `movimento_filho_id` = o estorno);
   - os estornos dessas linhas (`movimentacao_estorno_id`, com `movimento_pai_id` = a entrada).
   
   **Qualquer outro fato** de `P`, em qualquer local, mantém a recusa `ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO`. Vale também com vários locais.
5. **Por que isso é seguro:** a exclusão, e cada revisão, só estorna uma linha com a prova "camada nunca referenciada" (A8.3). A prova recusa camada consumida, transferida **ou citada por baixa depois estornada**. A fatia de venda ou de abastecimento cancelado nunca é apagada (`operacaoFinanceiraService.js:1822-1823`; `abastecimentoService.js:505-540`), e o JSON `lotes_consumidos` da baixa estornada continua no movimento (`estoqueFisicoMotor.js:522`, `:780-797`). Logo, uma linha estornada de entrada manual nunca teve consumo, e os fatos dela não explicam nenhuma baixa.
6. **Implantação consumida e depois estornada:** a exclusão é **recusada** (`ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS`, `consumo_estornado`), embora o saldo da camada tenha voltado ao valor de entrada. O próximo passo mostrado ao usuário é o futuro ajuste de inventário (fora deste slice). Aceitar a exclusão nesse caso fica **em aberto** (R-EDICAO-EXCLUSAO (b)). A proposta é **não** aceitar: preferir o bloqueio seguro.
7. **Sem reimplantação automática:** a exclusão não cria nada. A nova implantação é um documento novo, criado pelo usuário e sujeito a todas as condições.
8. **Variante estrita (alternativa da R-IMPL):** nunca reimplantar. Vale só a exceção (ii). Os fatos de qualquer linha já estornada contam como histórico. Uma implantação ou uma doação excluída de `P` impedem, para sempre, uma implantação de `P`; a tela avisa isso **antes** da exclusão. **A R-IMPL precisa ser decidida antes da R-EMENDA**, porque muda uma frase do texto proposto (proposta de emenda, §3 e §4.1).

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
| Entrada → compra | Confirmar a entrada, **ou revisá-la com novo parceiro ou documento**, com PAGAR `CONFIRMADO` de mesma identidade → `ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE`, reason `documento_de_compra` (com ou sem produtos no PAGAR) |
| Entrada → venda | O mesmo com RECEBER `CONFIRMADO` → `ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE`, reason `documento_de_venda` (seria devolução de venda disfarçada) |
| Entrada → entrada | Duas `EntradaEstoque` `CONFIRMADA` de mesma identidade, na confirmação ou na revisão → `ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE`, reason `documento_duplicado`. Backstop: `documento_chave_ativa` (preenchida só em `CONFIRMADA`; nula em `RASCUNHO` e `EXCLUIDA`) com `@@unique([cliente_id, empresa_id, parceiro_id, documento_chave_ativa])`, que a tabela nova admite |
| Compra **ou venda** → entrada | **Todo caminho da P3 que grava `documento_chave_ativa`, com direção PAGAR ou RECEBER** (R2: as duas direções), com ou sem produtos, consulta `EntradaEstoque` `CONFIRMADA` de mesma identidade → código próprio. Candidato: `OPERACAO_DOCUMENTO_EM_ENTRADA_ESTOQUE`, com reason `entrada_x_compra` ou `entrada_x_venda`. Os caminhos são três, nas duas direções: `confirmar` (depois de `:1448`); `retificar` nos modos NO_LUGAR (`:2356`) e SUBSTITUICAO (`:2410`), dentro de `exigirDocumentoUnico` (`:2218-2226`); e a prévia (`:1270-1275`), como bloqueio. Assim, "um bloqueia o outro" vale nos dois sentidos e não depende da ordem |

- **Rascunho** financeiro com o mesmo documento gera **aviso**, não bloqueio (a chave é nula em RASCUNHO).
- **Edição e exclusão (R2):**
  - na `EntradaEstoque` `CONFIRMADA`, parceiro e documento só mudam por **revisão com efeito físico** (A8, classe F). O motivo é que eles são copiados para a camada e para o movimento (`estoqueFisicoMotor.js:395-404`, `:647-652`). Logo, só mudam sem dependências físicas;
  - a revisão que muda parceiro ou documento roda a deduplicação **inteira** de novo, nos dois sentidos e contra entradas. Ela toma as advisories do conjunto {chave antiga, chave nova} × {PAGAR, RECEBER}, sem repetição, em ordem crescente da string completa de `chaveDocumento`. Como a direção vem antes do parceiro e do documento na chave, todas as PAGAR vêm antes de todas as RECEBER. Todo comando que toma mais de uma advisory de documento usa esta mesma regra. A chave antiga sai de `documento_chave_ativa` antes de a nova ser gravada, na mesma transação. Conflito → `ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE`;
  - a revisão que **não** muda parceiro nem documento **não** roda de novo a deduplicação contra a Central nem contra outras entradas, porque a identidade não mudou. Assim, um fato posterior não congela a edição;
  - **aviso de documento liberado por revisão:** quando a revisão troca parceiro ou documento, a identidade antiga fica livre com o estoque da entrada **ainda ativo**. Por isso:
    - a prévia e a resposta da revisão mostram aviso com ciência registrada no evento `EDICAO`;
    - a prévia e a confirmação da P3 (PAGAR e RECEBER) mostram **aviso não bloqueante, com ciência registrada**, quando a identidade consta no `snapshot_anterior` de um evento `EDICAO` de entrada ainda `CONFIRMADA`: "documento já usado na entrada nº X (revisão N), que continua confirmada". Não é bloqueio, porque corrigir erro de digitação é legítimo (R-DEDUPE);
  - **a entrada não usa `atualizarProcedencia`** (o "NO_LUGAR de procedência" da P3; `estoqueFisicoMotor.js:1099-1124`; `operacaoFinanceiraService.js:2254-2282`). Na entrada manual, mudar procedência é substituição, nunca reescrita da camada ou do movimento. Esta é uma diferença deliberada em relação à D-PROD-158;
  - **exclusão:** `EXCLUIDA` zera `documento_chave_ativa` e **libera** o documento: uma compra P3 com o mesmo documento passa a ser aceita. O parceiro e o documento continuam gravados no histórico do documento excluído. A prévia da P3 mostra **aviso não bloqueante** "documento já usado na entrada excluída nº X" (R-DEDUPE);
  - **entrada que era compra e já tem dependência física:** não pode ser excluída nem ter parceiro ou documento trocados (A8). Pela recíproca acima, nenhum PAGAR com o mesmo parceiro e documento pode ser confirmado, nem só o título. **Este caso não tem caminho no 1º slice** e fica pendente de **R-CONVERSAO** (§8). A orientação ao usuário **nunca** é lançar a compra sem documento, com outra grafia ou com outro parceiro;
  - **rascunho** de entrada não tem chave ativa e não bloqueia ninguém.
- **Mesma advisory:** a entrada usa `chaveDocumento` (`operacaoFinanceiraService.js:1284`), primeiro com `direcao = 'PAGAR'` e depois com `'RECEBER'`, sempre nessa ordem fixa.
- **Ordem de travas da confirmação** (C4, linha Confirmar), **compatível** com a do financeiro:
  1. cabeçalho `FOR UPDATE`;
  2. locais `FOR KEY SHARE`;
  3. `travarProdutosEstoque`;
  4. advisory do documento (PAGAR → RECEBER);
  5. consultas recíprocas.
  - O financeiro faz cabeçalho (`:1417`) → produtos (`:1422`) → títulos (`:1423`) → advisory de **uma** chave (`:1448`). Ele não trava `LocalEstoque` antes.
  - A entrada não tem títulos. Ela acrescenta locais `FOR KEY SHARE` antes dos produtos, como na ordem canônica do motor (`estoqueFisicoMotor.js:32-38`). É uma trava compartilhada, que não conflita com o financeiro.
  - Em todo comando, camadas e movimentos `FOR UPDATE` vêm **depois** das advisories de documento.
  - Edição e exclusão de confirmada seguem A8.5.
- **Isolamento:** os comandos de entrada e os da P3 envolvidos rodam em **READ COMMITTED**, que é o padrão de `TX_EFEITO` (`operacaoFinanceiraService.js:83`). A consulta recíproca vem **obrigatoriamente depois** da advisory: em REPEATABLE READ, o snapshot anterior à advisory não veria o commit concorrente. Teste PG de corrida nos dois sentidos.
- **Detalhes do 409:** só trazem número e id do outro documento se o usuário tiver `visualizar` na tela dele; senão, só o `reason`.
- **Bloqueio de liberação:** a entrada manual **não pode ser liberada** (tela, permissão ou release) enquanto os três caminhos da P3, **nas duas direções**, não fizerem a consulta recíproca. Os testes cobrem os três caminhos, as duas direções e as corridas entrada × compra e entrada × venda. **Tudo isso pertence à P1-05a** (e a revisão de parceiro ou documento, à P1-05b), com a decisão R-DEDUPE (toca contrato congelado da Gestão). Não é escopo desta PR de documentação.
- **Idempotência:** recibos próprios (`confirmar_entrada_estoque` e `editar_entrada_estoque`) e o 409 de estado protegem contra a repetição da mesma tentativa. A advisory só **serializa**; quem **recusa** são a consulta e a unique acima.

**Limites declarados** (sem promessa de detecção):
- duas operações **sem** documento (por exemplo, doação sem nota);
- **só um** dos lados com documento (`documento_referencia` é opcional, `schema.prisma:2026`);
- **parceiros diferentes para o mesmo fornecedor** (Fornecedor não tem unique de CPF/CNPJ);
- **grafias diferentes** do número ("NF 123", "000123", "123"). A normalização é só trim + maiúsculas;
- o lado bloqueado **alterando o próprio documento** para escapar do 409, antes de confirmar;
- o lado que bloqueia (a entrada confirmada) **trocando o próprio documento por revisão** (classe F, só sem dependência). Isso libera a identidade antiga com o estoque ainda ativo. Nesse caso só há o aviso acima, não bloqueio.

**Mitigação não bloqueante:** na prévia e na confirmação de `DOACAO` e `OUTRA`, aviso obrigatório, com ciência registrada no AuditLog, quando existir PAGAR `CONFIRMADO` com mercadoria do **mesmo produto** e do mesmo parceiro (ou de parceiro com o mesmo CPF/CNPJ) nos últimos N dias. O valor de N fica para ratificação (R-DEDUPE).

### A6. Estados (R2: `CANCELADA` sai; entra `EXCLUIDA`)

| Estado | Efeito físico | Ações visíveis ao usuário | Transições |
|---|---|---|---|
| `RASCUNHO` | Nenhum | Editar, Excluir, Confirmar | Editar (`PUT` com CAS de versão); Excluir (lógico, com versão) → `EXCLUIDA`; Confirmar → `CONFIRMADA` (revisão 1) |
| `CONFIRMADA` | Camadas + movimentos `Entrada` pelo motor; cache += | **Editar** e **Excluir**. Não há botão "Cancelar" | Editar → `CONFIRMADA` com a revisão seguinte (A8); Excluir → `EXCLUIDA` (A8) |
| `EXCLUIDA` | Rascunho: nenhum. Confirmada: estorno integral pelo motor (camadas `Estornado` por CAS + movimentos compensatórios) | Só consulta e histórico | Final. Não há restaurar (mesmo princípio da D-PROD-100 no rebanho) |

- O estorno interno do motor continua existindo e se chama estorno nos movimentos (`tipo_detalhado` próprio, §6.2). O que muda é o **verbo na tela**: o usuário vê Editar e Excluir.
- **Divergência registrada:** a P3 representa a exclusão de confirmado como `CANCELADO` + `excluido_em` (`schema.prisma:2049-2053`; `operacaoFinanceiraService.js:2473-2479`). A entrada usa o status literal `EXCLUIDA`, como o proprietário pediu, mais `excluido_em`, `excluido_por_usuario_id`, `motivo_exclusao` e `excluida_de` (`RASCUNHO` ou `CONFIRMADA`). Ponto de ratificação: R-EDICAO-EXCLUSAO (a).
- Não existe estorno parcial, exclusão parcial, `UPDATE` de quantidade, custo, data, local, produto ou procedência de fato confirmado, nem `DELETE` de documento confirmado, movimento ou camada.
- `unidade_mudou` e `produto_mudou_de_fazenda` **não** são motivos de recusa. Com camada existente, o código já impede a troca de fazenda e a troca de/para L (`produtoService.js:198-212`, `:274-285`). KG ↔ SACO é o mesmo quilo físico e não deve bloquear. Se ocorrerem, são violação de invariante (500), não regra de negócio.
- **O estorno usa o kg gravado na linha de item** (`quantidade_estoque` e `fator`), nunca refaz sacos × peso. É o mesmo princípio da P3 (`operacaoFinanceiraService.js:1358-1361`).

### A7. Datas
- A data operacional segue o fuso IANA da `Empresa` (`Empresa.fuso_horario`, `schema.prisma:986`; `hojeDaEmpresa`, `rebanhoLedgerTempo.js:119`).
- Nunca o dia local do navegador.
- `data_entrada` ≤ hoje da fazenda.
- **Pendente de ratificação (R-DATA):** limitar a data retroativa de `DOACAO` e `OUTRA` a um dia ≥ a data da camada `Disponivel` mais recente do local. A data da camada é a chave FIFO (`ordenarFifo`, `estoqueFisicoMotor.js:100-106`).
- **Janela FIFO (R2, vale para todo motivo, na confirmação e na revisão):** além da R-DATA, uma camada nova nunca pode ficar à frente, no FIFO, de camada que alguma baixa já tocou. A regra exata e o motivo estão em A8.4.
- **Fato do motor que a R2 leva em conta:** a saída FIFO **não filtra por data**. `lotesFifo` só filtra status e disponível (`estoqueFisicoMotor.js:443-450`), e a data da saída vai só para `data_movimentacao` (`:483`, `:513`). Uma entrada retroativa não refaz consumos passados: só muda a fila dali para a frente. O custo já gravado nas baixas nunca é recalculado (`:515-516`, `:522`; `OperacaoFinanceiraConsumoLote` e `AbastecimentoBemConsumoLote`).
- **Saldos dos movimentos:** `saldo_antes` e `saldo_depois` de todo movimento (inclusive estorno e revisão) são o saldo **do momento do comando**, não do dia da entrada (`saldoNoLocal`, `estoqueFisicoMotor.js:269-275`). O contrato não promete saldo histórico "na data".

### A8. Editar e excluir (R2)

> Proposta para ratificação (R-EDICAO-EXCLUSAO). Nada aqui está implementado.

**Molde.** É a D-PROD-158 da Gestão P3 (`DECISIONS.md`, D-PROD-158):
- elegibilidade única no servidor;
- edição de confirmado por substituição atômica;
- exclusão lógica com evento estruturado;
- prova de proveniência `provaDaCompra` (`operacaoFinanceiraService.js:1841-1962`).

A entrada é **mais estrita** que a P3 em dois pontos: nunca reescreve procedência no lugar (A5) e mantém o **mesmo** documento, com revisões em vez de um documento novo renomeado. A correção de entrada de Lote do rebanho (R1, `rebanhoLedgerCorrecaoEntrada.js:1-11`) **não** é o molde: ela reescreve o mesmo fato com os mesmos ids, e isso é proibido aqui.

#### A8.1 Classes de campo

**Alcance da dependência (proposta: por documento).** Basta **uma** camada de **qualquer** linha vigente da entrada ter dependência física (A8.3) para a entrada inteira ficar só com a classe M. Isso segue o pedido do proprietário ("com dependências, só metadados") e prefere o bloqueio seguro. A alternativa, **por item**, só travaria os itens com camada referenciada. Ela fica para ratificação: R-EDICAO-EXCLUSAO (k).

| Classe | Campos | Com dependência física em qualquer linha vigente | Sem dependência física em nenhuma linha |
|---|---|---|---|
| **M — metadado** (só no documento; nunca copiado para camada ou movimento) | observação; texto da justificativa (OUTRA continua exigindo ≥ 20 caracteres) | **Permitido**, com motivo, auditoria e versão | Permitido |
| **F — físico ou de proveniência** (copiado para camada ou movimento) | produto, local, quantidade, unidade, fator do SACO, custo e `custo_zero`, data da entrada, parceiro, documento, inclusão ou retirada de item | **Bloqueado** (`ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS`) | Permitido por **revisão** (A8.2), se passar na janela FIFO (A8.4) e nas regras de confirmação (A2–A5, A7, C1–C3) |
| **I — identidade** | empresa, **motivo da entrada**, número do documento interno, id | Nunca muda | Nunca muda. Trocar empresa ou motivo = excluir e lançar outra entrada |

- **Lote do fabricante** (P1-07): a reclassificação continua sendo comando próprio (B4), fora da edição do documento.
- **Motivo da entrada (R2, classe I):** ele muda a permissão (`confirmar_outra`), o `tipo_detalhado` do movimento e a elegibilidade (A3). Por isso nunca muda por edição, de nem para nenhum motivo. Isso fecha a passagem `DOACAO` → `SALDO_IMPLANTACAO` por revisão, que contornaria a A3.

#### A8.2 Revisão do documento confirmado

**Edição só de classe M:**
- muda só o cabeçalho do documento, com `versao + 1` e `revisao + 1`;
- grava um evento `EDICAO` com modo `METADADOS`;
- não toca motor, camada, movimento nem cache.

**Edição com classe F:** é **uma transação atômica** de substituição versionada.
1. As linhas de item que mudam (e só elas) têm a camada estornada pelo motor. A camada vira `Estornado`, com disponível 0 e CAS. Nasce um movimento compensatório com `movimento_pai_id` apontando para a entrada original, e a original fica `Estornada` com `movimento_filho_id`. A linha recebe `movimentacao_estorno_id` e `revisao_fim = N`.
2. As linhas novas nascem com `revisao_inicio = N + 1`. O motor cria **camada e movimento novos**, com ids novos, origem `entrada_estoque`, custo e procedência da revisão. A data FIFO da camada nova (`data_documento`) é a **data da entrada informada no documento** na revisão, nunca o dia em que se edita. Se a data não mudou, a camada nova tem a mesma data da antiga.
3. Antes de qualquer edição de classe F, a prova de A8.3 é exigida de **todas** as linhas vigentes (alcance por documento, A8.1). As linhas que **não mudam** continuam as mesmas, com a mesma camada e o mesmo movimento.
4. Mudança de **parceiro, documento ou data** atinge todas as linhas, porque esses campos são copiados para todas as camadas. Todas são substituídas.
5. Cabeçalho: `versao + 1`, `revisao = N + 1` e `documento_chave_ativa` recalculada (A5).
6. Evento `EDICAO` com modo `SUBSTITUICAO`. Ele guarda: motivo obrigatório (≤ 500), autor (do `auth_context`), instante, `revisao_anterior` e `revisao_nova`, `versao_anterior` e `versao_nova`, snapshot **antes** e **depois** (cabeçalho e linhas com ids de camada, movimento e estorno), ids dos movimentos estornados, dos estornos criados, dos movimentos novos e das camadas novas.
7. Numeração dos movimentos uma única vez, no fim (`numerarMovimentos` com `[estornos…, novos…]`; `estoqueFisicoMotor.js:1018-1036`).
8. AuditLog com entidade **`EntradaEstoque`** e recibo.

Qualquer falha desfaz tudo, inclusive a reserva do recibo (`operacaoIdempotenteService.js:49`, `:87-98`). Não existe janela observável com o estoque errado: a transação é única, em READ COMMITTED (`TX_EFEITO`, `operacaoFinanceiraService.js:83`), e os leitores veem o antes ou o depois.

**O que nunca acontece na revisão:**
- `UPDATE` de quantidade, custo, data, local, produto ou procedência de `MovimentacaoEstoque` ou `EstoqueLoteNota` existentes;
- `DELETE` de qualquer um deles;
- religar fatias de consumo;
- recalcular custo de baixa já feita;
- reprocessar FIFO de fatos antigos.

As únicas escritas em linhas existentes são as transições de protocolo do próprio motor: status `Estornado`/`Estornada`, `movimento_filho_id`, disponível por CAS e a troca do número provisório (`estoqueFisicoMotor.js:683-687`, `:722-726`, `:1032-1034`).

**Datas:**
- os movimentos de estorno da revisão têm `data_movimentacao` = **dia de hoje da fazenda**, como a substituição da P3 (`operacaoFinanceiraService.js:2395`). Isso não mexe na fila FIFO: estorno não cria camada;
- a camada nova usa a **data da entrada informada no documento** (item 2), que é a chave FIFO.

**Por que o mesmo documento e não um novo** (a P3 cria documento novo e renomeia o antigo `<número>/r<versão>`, `operacaoFinanceiraService.js:2392-2412`): o proprietário quer ver a mesma entrada com "Editado" e o histórico de revisões. As linhas versionadas por intervalo (`revisao_inicio`/`revisao_fim`) mantêm as uniques por camada, movimento e estorno (como `OperacaoFinanceiraItem`, `schema.prisma:2135-2137`). A reconciliação continua explicando cada camada estornada por FK (§6.2, item 8).

**Edição de rascunho:** `PUT` com CAS de versão. Não há motor nem revisão. Fica registrada no AuditLog `EntradaEstoque` (antes e depois do cabeçalho e das linhas). O motivo é opcional no rascunho: as exigências de motivo, evento e revisão valem para a entrada **confirmada**.

#### A8.3 Prova "camada nunca referenciada" (dependência física)

**Por que o saldo não basta:** o critério do motor ("Disponivel e disponível = entrada", `estoqueFisicoMotor.js:709`, `:926-930`) **não basta**. Uma venda ou um abastecimento cancelado devolve a fatia à **mesma** camada (`:779-799`), e a camada volta a parecer intocada. As fatias e os JSONs continuam no banco.

**A prova.** Para **cada** camada `L` das linhas que serão estornadas valem as condições abaixo. Para habilitar qualquer edição de classe F, elas valem também para todas as linhas **vigentes** do documento (alcance por documento, A8.1). A conferência é feita sob as travas de A8.5, sempre por **consulta** e sem filtro de status do consumidor:

| # | Condição | Motivo de recusa (`details.motivos[].codigo`) |
|---|---|---|
| P1 | `L` existe; `cliente_id`, `empresa_id`, `produto_id` e `local_estoque_id` de `L` = os da linha; status `Disponivel`; disponível = entrada = `quantidade_estoque` da linha | `lote_alterado` |
| P2 | Movimento de entrada da linha `Ativa`, com `movimento_filho_id` nulo, e `L.movimentacao_entrada_id` = esse movimento | `lote_alterado` |
| P3 | Nenhuma `OperacaoFinanceiraConsumoLote` com `L`, em qualquer situação do documento (`schema.prisma:2146-2165`) | `lote_consumido`, ou `consumo_estornado` se todas as fatias forem de documentos cancelados |
| P4 | Nenhuma `AbastecimentoBemConsumoLote` com `L`, inclusive CANCELADO (`schema.prisma:2649-2670`). **Explícito**: a `provaDaCompra` não consulta esta tabela | `lote_consumido` / `consumo_estornado` |
| P5 | Nenhum `MovimentacaoEstoque`, de qualquer origem e status, com `lotes_consumidos` citando `L` (chaves `lote_id`, `estoque_lote_nota_id`, `lote_nota_id` ou texto puro, como `operacaoFinanceiraService.js:1857`). Cobre venda, abastecimento, suplementação e transferência | `lote_consumido` / `consumo_estornado`; `lote_transferido` se a citação for de Saída `transferencia_enviada` |
| P6 | Nenhum recibo `saida_suplementacao`/`transferencia_locais` com `rateio[].lote_id = L` desde `createdAt(L)` − 1 h (`operacaoFinanceiraService.js:1756-1758`, `:1861-1870`) | `lote_consumido` |
| P7 | `updatedAt(L) = createdAt(L)`, salvo AuditLog só de escritor benigno (renomeação de `local_estoque_nome`) | `lote_alterado` |
| P8 | Nenhuma **Saída sem rastro** no mesmo empresa + produto + local depois de `createdAt(L)`. É Saída sem rastro a que tem origem legada (`manual` ou `reversao`), ou a que tem `lotes_consumidos` nulo **e não é estorno de entrada**. O estorno de entrada tem `movimento_pai_id` preenchido e `tipo_detalhado` `estorno_compra` ou `estorno_entrada_*`: ele zera a própria camada e não consome outra. É fail-closed, porque o rastro não existe | `consumo_legado_sem_rastro` |
| P9 | `Produto.estoque_atual` ≥ Σ kg a estornar daquele produto | `estoque_atual_insuficiente` (é caso de reconciliação, nunca ajuste silencioso) |
| P10 | Nenhuma linha de `OperacaoFinanceiraItem.estoque_lote_nota_id` aponta para `L` (integridade: camada de entrada manual não é de compra) | `lote_alterado` |

- Qualquer motivo → **409 `ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS`**, com `reason` = o primeiro motivo, `field` = `itens`, índice da linha e a lista completa em `details.motivos` (padrão `bloqueado`, `operacaoFinanceiraService.js:1761-1778`).
- **`consumo_estornado` bloqueia**, como o movimento cancelado bloqueia a correção do Lote (`loteCorrecaoEntradaService.js:15-17`, `:120-124`). Aceitá-lo exigiria provar que o estorno foi total **e** que nenhuma camada ficou explicada por ele. Fica em aberto: R-EDICAO-EXCLUSAO (b).
- **Para camadas da entrada manual criadas pelo motor, a prova é completa por consulta.** Os escritores sem rastro (POST e DELETE genéricos, saída legada) estão fechados (`movimentacaoEstoqueService.js:52-60`, `:122-127`; `estoqueLoteNotaService.js:69-76`, `:223-236`). O P8 cobre o legado.
- **Testes obrigatórios no P1-05a:** um cenário PG por linha da tabela, inclusive "consumida por abastecimento e depois cancelada", que hoje não tem teste na P3 (`gestaoP3EditarExcluir.test.mjs` não cobre abastecimento).

#### A8.4 Janela FIFO (impacto em baixas já feitas)

**Problema.** Uma camada nova, ou uma camada mudada de produto, local ou data, poderia ficar à frente, no FIFO, de outra camada que **alguma baixa já consumiu**. Se a camada certa existisse desde o início, aquela baixa teria consumido a camada nova, com outro custo. O motor não refaz baixas (A7). Por isso a regra é **bloquear**, nunca recalcular.

**"Tocada por baixa".** Uma camada foi tocada por baixa quando é citada por P3–P6, em qualquer status do consumidor, **ou** quando está `Esgotado`, **ou** quando está `Disponivel` com disponível < entrada.
- Camada `Estornado` **não citada** por P3–P6 **não** conta. Ela foi zerada por estorno de entrada, e esse estorno só ocorre com a camada intocada. Isso vale para a compra cancelada e para a linha estornada de entrada manual.
- Assim, revisões e exclusões anteriores não bloqueiam as seguintes, nem a reimplantação.

**Regra `ENTRADA_ESTOQUE_IMPACTO_FIFO`.** Para cada **camada nova** `N` criada por confirmação ou revisão, no par `(empresa, produto, local)`:
- recusa se existir, nesse par, camada `C` tocada por baixa que venha **depois** de `N` na ordem FIFO, isto é, na ordem `(COALESCE(data_documento, createdAt), id)` de `ordenarFifo` (`estoqueFisicoMotor.js:100-106`). Se a camada nova existisse antes, aquela baixa teria consumido `N` antes de `C`. `reason` `camada_posterior_consumida`, com o número da baixa se o usuário puder vê-la;
- recusa se houver, no par, **qualquer** Saída sem rastro (P8), em qualquer data, porque não se sabe que camada ela consumiu. `reason` `baixa_legada_sem_rastro`;
- a conferência roda **depois** de criar `N`, na mesma transação, porque o id é gerado na criação. A recusa desfaz tudo.

**Por que a correção normal passa** (sem exceção escrita na regra): as camadas da revisão anterior nunca foram referenciadas (A8.3). Logo, nenhuma baixa feita enquanto elas existiam alcançou uma posição depois delas na fila. A confirmação original também passou por esta janela. Uma camada nova no mesmo par e com data igual ou posterior só falha num caso: quando uma camada tocada do **mesmo dia** fica depois dela no desempate por id. Nesse caso a recusa é correta, porque a fila de fato mudaria.

**Remover uma camada nunca referenciada** (exclusão, ou a parte "estorno" da revisão) **não muda nenhuma baixa passada**. Toda baixa feita enquanto ela existia se satisfez com camadas que vinham antes dela, e o motor não refaz baixas (A7). "Saldo suficiente" sozinho **não** é prova: a prova é A8.3 junto com esta janela.

**Efeito daqui para a frente:** uma camada com data retroativa entra na frente da fila para as **próximas** baixas. Isso é declarado ao usuário na prévia ("as próximas saídas deste produto neste local usarão esta camada antes de …").

**Limite declarado:** a confirmação de **compra** da P3 não tem esta janela hoje. A proposta não muda a P3. Estender a regra a ela é ponto de R-EDICAO-EXCLUSAO (c).

#### A8.5 Travas, CAS e concorrência (editar e excluir confirmada)

1. Recibo (`executarComIdempotencia`), na mesma transação.
2. Cabeçalho `FOR UPDATE`.
3. Situação: `EXCLUIDA` → `ENTRADA_ESTOQUE_STATUS_INVALIDO` com `documento_excluido`, **antes** do teste de versão, como em `exigirVigente`.
4. CAS da versão: versão diferente → `ENTRADA_ESTOQUE_VERSAO_CONFLITO` (`versao_atual`, `versao_informada`).
5. Locais antigos ∪ novos `FOR KEY SHARE` numa única chamada (`exigirLocaisEstoque`).
6. `travarProdutosEstoque` com produtos antigos ∪ novos, que ordena (`estoqueFisicoMotor.js:78-85`).
7. Releitura do Produto (empresa, unidade, peso).
8. Advisories de documento (A5): o conjunto de chaves antiga e nova × PAGAR e RECEBER, em ordem crescente. Ficam na mesma posição relativa da retificação da P3 (`exigirDocumentoUnico`, `operacaoFinanceiraService.js:2337`), antes dos `FOR UPDATE` de lotes e movimentos (`estoqueFisicoMotor.js:871`, `:880`).
9. Camadas a estornar e camadas vigentes `FOR UPDATE ORDER BY id`. Isso serializa com o PATCH de `local_estoque_nome`, que só toma `FOR NO KEY UPDATE` do lote e não trava o produto (`estoqueLoteNotaService.js:180`).
10. Movimentos originais `FOR UPDATE`, lendo `status` e `movimento_filho_id`.
11. Prova A8.3, janela A8.4 e regras de confirmação, **reavaliadas sob trava** (fonte única, como `avaliarElegibilidade`, `operacaoFinanceiraService.js:2059-2117`).
12. Efeitos.
13. Numeração.
14. Evento e AuditLog.
15. Recibo.

**Concorrência:**
- **Duas edições concorrentes com a mesma versão:** a segunda espera a trava do cabeçalho, vê a versão nova e recebe `ENTRADA_ESTOQUE_VERSAO_CONFLITO`. Nada é gravado.
- **Baixa concorrente** (venda, abastecimento, suplementação, transferência) do mesmo produto: serializa pela trava do produto. Se a baixa vence, a prova vê a fatia e recusa. Se a edição vence, a baixa vê a camada nova.
- **Deadlock ou serialização** → `CONCURRENCY_CONFLICT` (`transacaoConcorrente.js:73-78`, `:92-109`).

#### A8.6 Exclusão

**Rascunho:**
- exclusão lógica com CAS de versão e motivo opcional;
- `EXCLUIDA` com `excluida_de = RASCUNHO`;
- sem motor;
- AuditLog `EntradaEstoque` com o estado anterior, mais autor e data (`excluido_por_usuario_id`, `excluido_em`);
- o número continua reservado (rastreabilidade mínima).

**Confirmada** (só sem dependência física):
- prova A8.3 em **todas** as linhas vigentes;
- estorno integral pelo motor (sem janela FIFO, A8.4);
- `EXCLUIDA` com `excluida_de = CONFIRMADA`;
- `documento_chave_ativa` nula;
- motivo **obrigatório**;
- evento `EXCLUSAO` com snapshot;
- AuditLog `EntradaEstoque`.

**Não há exclusão parcial.** Retirar um item é uma **revisão** (A8.2).

**Interface:**
- o documento sai da lista operacional por padrão. O filtro é análogo ao `SITUACOES_LISTA` da P3, que tem `OPERACIONAIS`, `EXCLUIDOS` e `TODOS` (`operacaoFinanceiraService.js:914`). Para a entrada, os nomes candidatos são `OPERACIONAIS`, `EXCLUIDAS` e `TODAS`. O mesmo `where` vale para a contagem e para a página;
- continua acessível por id, no filtro "Excluídas", no histórico de revisões e na trilha de auditoria.

**Recibos (proposta, R-EDICAO-EXCLUSAO (d)):**
- ao excluir, os recibos de `criar_entrada_estoque`, `confirmar_entrada_estoque` e `editar_entrada_estoque` do documento passam a `STATUS_EXCLUIDO`, inclusive na exclusão de rascunho, como no descarte de rascunho da P3. Um replay recebe 409 `IDEMPOTENCY_EFEITO_EXCLUIDO`, e não um corpo que sugira entrada ativa (precedente: `operacaoIdempotenteService.js:22-34`; descarte de rascunho, `operacaoFinanceiraService.js:1123-1130`; rebanho, `rebanhoLedgerExclusao.js:136-142`). **Diverge** do `excluirConfirmado` da P3, que não marca os recibos;
- depois de uma **edição**, o replay de um recibo anterior devolve o corpo gravado daquela revisão, que traz `revisao` e `versao`. O cliente recarrega.

#### A8.7 Elegibilidade e interface

**Elegibilidade:**
- `GET /entradas-estoque/:id/elegibilidade` (nome candidato) devolve `editar` = `{ permitido, campos_m: true, campos_f_permitidos, motivos[] }` e `excluir` = `{ permitido, motivos[] }`. Roda sem trava e é só informativo;
- os comandos reavaliam sob trava, com a mesma função. Se a elegibilidade mudou, a resposta é 409 com o motivo (D-PROD-112: confirmar exige elegibilidade fresca);
- a elegibilidade é **só consulta**:
  - chama a mesma função de prova (A8.3) e de janela FIFO (A8.4) que os comandos;
  - não chama primitivas do motor e não toma travas de escrita;
  - **não há ensaio do motor em SAVEPOINT** nesta fase. O ensaio tomaria travas de linha fora da ordem canônica e poderia derrubar uma baixa real por deadlock. O precedente do rebanho (`movimentacaoMapaExclusaoService.js:96-123`) ensaia outro ledger;
  - um ensaio futuro exige decisão própria e a ordem completa de A8.5;
  - a janela FIFO da camada nova, que depende do id, é avaliada na elegibilidade com a data informada e confirmada só no comando.

**Na tela (P1-06):**
- os botões **Editar** e **Excluir** aparecem para quem tem a permissão;
- com dependência física em qualquer linha (alcance por documento, A8.1), Editar abre o formulário com **todos** os campos F travados e a razão objetiva. Por exemplo: "a camada desta entrada foi consumida pela venda nº 123 (ou abastecimento, suplementação ou transferência)";
- o próximo passo é mostrado com honestidade. Pela proposta (b), uma baixa depois cancelada **continua** bloqueando, porque o rastro dela fica. Então cancelar a venda ou o abastecimento **não** libera a edição física. O texto é: "a quantidade, o custo, o local, o produto e a data desta entrada não podem mais ser mudados, porque o estoque dela já foi usado (venda nº 123). Você ainda pode editar a observação. Para corrigir o saldo, use o ajuste de inventário quando ele existir (fora desta fase)". Se a ratificação aceitar `consumo_estornado` (b), o texto passa a orientar a desfazer antes as operações dependentes, da mais recente para a mais antiga;
- **entrada `DOACAO` ou `OUTRA` que era compra e já tem dependência:** o texto diz que a compra com esse documento fica bloqueada até existir a conversão (R-CONVERSAO) e que o ajuste de inventário não resolve o financeiro. **Nunca** sugere lançar a compra sem documento, com outra grafia ou com outro parceiro;
- Excluir fica desabilitado com a mesma razão;
- **não há botão "Cancelar"** para a entrada;
- o documento editado mostra "Editado (revisão N)" e o histórico de revisões (autor, data, motivo, antes e depois);
- a confirmação de Excluir diz o efeito: "serão retirados X kg de P do local L";
- o servidor é a única autoridade, e a tela só traduz `motivos[].codigo` em texto.

**Nenhum reajuste silencioso, nenhum reprocessamento automático de fatos históricos.**

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
- **Produto citado por qualquer linha de `EntradaEstoqueItem`**, de documento em qualquer status, inclusive `EXCLUIDA` vindo de rascunho, sem camada. Também o Produto com lote do fabricante ou camada. Ele não troca de empresa nem de unidade incompatível e não é excluído. A exclusão do Produto conta essas linhas antes do DELETE e responde 409 `PRODUTO_DELETE_BLOCKED` (`vinculo: 'entradas de estoque'`). Nunca deixa a FK Restrict responder, porque ela sai como erro de tenant (`errorHandler.js:53-56`). Estender:
  - `conferirTrocaDeUnidade` (`produtoService.js:198-212`);
  - a troca de fazenda (`:274-285`);
  - a exclusão.

### C4. Matriz de comandos, idempotência, concorrência, permissões e erros

| Comando (futuro) | Recibo (`tipo_operacao`) | Fingerprint | Ordem de travas | Permissão | Erros próprios |
|---|---|---|---|---|---|
| Criar rascunho | `criar_entrada_estoque` | corpo canônico sem `operation_id` | Produto `FOR KEY SHARE` em ordem crescente de id (como `travarProdutosDoRascunho` da P3, `operacaoFinanceiraService.js:384-401`) → número reservado | `novo` / `salvar` | `MOTIVO_INVALIDO`, `UNIDADE_INCOMPATIVEL`, `CUSTO_INVALIDO`, `DATA_FUTURA`, `REFERENCIA_INVALIDA` |
| Editar rascunho (`PUT`) | — | — | cabeçalho com CAS de versão | `editar` | `VERSAO_CONFLITO`, `STATUS_INVALIDO` |
| Prévia | — | — | só leitura | `visualizar` | — |
| Confirmar | `confirmar_entrada_estoque` | `{id, empresa_id, versao}` | cabeçalho `FOR UPDATE` → locais `FOR KEY SHARE` → `travarProdutosEstoque` → **releitura** do Produto (empresa, unidade, peso; `exigirProdutoDaEmpresa` depende dela, `estoqueFisicoMotor.js:126-130`) → advisories PAGAR → RECEBER → consultas recíprocas → janela FIFO (A8.4) → motor → `numerarMovimentos` no fim → AuditLog → recibo | `confirmar` (+ `confirmar_outra`) | `IMPLANTACAO_COM_HISTORICO`, `DOCUMENTO_CONFLITANTE`, `IMPACTO_FIFO`, `FATOR_DIVERGENTE`, `VERSAO_CONFLITO` |
| Elegibilidade | — | — | só leitura (sem trava) | `visualizar` | — |
| Editar confirmada (R2) | `editar_entrada_estoque` | canônico de `{id, empresa_id, versao, motivo_edicao, corpo completo da revisão}` | A8.5 | `editar` **e** `confirmar` (+ `confirmar_outra` se o motivo antigo ou o novo for `OUTRA`) | `DEPENDENCIAS_FISICAS`, `IMPACTO_FIFO`, `DOCUMENTO_CONFLITANTE`, `VERSAO_CONFLITO`, `STATUS_INVALIDO`, `IMPLANTACAO_COM_HISTORICO`, `FATOR_DIVERGENTE` |
| Excluir rascunho ou confirmada (R2) | `excluir_entrada_estoque` | canônico de `{id, empresa_id, versao, motivo}` | rascunho: cabeçalho com CAS; confirmada: A8.5 | rascunho: `excluir`; confirmada: `excluir` **e** `confirmar` | `DEPENDENCIAS_FISICAS`, `VERSAO_CONFLITO`, `STATUS_INVALIDO` |

- **R1 → R2:**
  - o comando `cancelar` e o código `CANCELAMENTO_BLOQUEADO` saem;
  - `DOCUMENTO_DE_COMPRA`, `DOCUMENTO_DE_VENDA` e `DOCUMENTO_DUPLICADO` viram um código só, `DOCUMENTO_CONFLITANTE`, com esses três `reason`.
- **Códigos (todos 409, prefixo `ENTRADA_ESTOQUE_`, nenhum existe hoje, sem colisão em `errorCodes.js`):**
  - `DEPENDENCIAS_FISICAS`, com os reasons de A8.3;
  - `IMPACTO_FIFO`, com os reasons de A8.4;
  - `DOCUMENTO_CONFLITANTE`, com os reasons de A5;
  - `VERSAO_CONFLITO`, com `versao_atual` e `versao_informada`. Não se reaproveita `OPERACAO_VERSAO_CONFLITO`, cujo texto fala de rascunho do financeiro;
  - `STATUS_INVALIDO`: `documento_excluido` ou `nao_confirmada`;
  - `IMPLANTACAO_COM_HISTORICO`;
  - `FATOR_DIVERGENTE`.
- Cada código entra em `BACKEND_ONLY_CODES`, com http e significado terminando em "nada foi alterado". Sem isso, o `AppError` vira 500 (`errorCodes.js:549-558`).
- O corpo de erro segue o padrão `field`/`reason` + `details.motivos[]` (`operacaoFinanceiraService.js:1761-1778`).
- Os validadores do rascunho (`MOTIVO_INVALIDO`, `UNIDADE_INCOMPATIVEL`, `CUSTO_INVALIDO`, `DATA_FUTURA`, `REFERENCIA_INVALIDA`) seguem como na R1.
- Códigos de plataforma reaproveitados:
  - `REQUEST_VALIDATION_FAILED` (motivo de edição ou exclusão ausente ou curto);
  - `IDEMPOTENCY_CONFLICT` (mesmo `operation_id` com outro payload, inclusive outra versão ou motivo; `operacaoIdempotenteService.js:59-79`);
  - `IDEMPOTENCY_IN_PROGRESS`, `IDEMPOTENCY_EFEITO_EXCLUIDO` (A8.6) e `CONCURRENCY_CONFLICT`.
- Deadlock ou serialização → `CONCURRENCY_CONFLICT`.
- **Recusa de negócio não deixa recibo:** a transação desfaz a reserva. Depois de corrigir o estado, o cliente pode reenviar com a mesma chave.
- **B-03:** a resposta 201 é JSON puro antes de virar recibo. O replay é idêntico.
- **Permissões:**
  - o vocabulário é o de `ACOES` (`backend/src/shared/auth/autorizacaoTela.js:70`). `editar` e `excluir` **já existem**;
  - ações extras em lista própria, candidata `ACOES_ENTRADA_ESTOQUE = ['confirmar', 'confirmar_outra']`, com teste de paridade entre front e back (precedente: `ACOES_LANCAMENTOS_FINANCEIROS`, `:77`). `cancelar` sai da lista na R2;
  - editar ou excluir **confirmada** exige também `confirmar`, porque desfaz e refaz efeito confirmado. Para editar, é igual à D-PROD-158 (retificar = `editar` + `confirmar`; `guardasRotas.js:240-250`). Para excluir, é **análogo, mas não igual**: a P3 exige `cancelar` + `excluir`. Como a entrada não tem a ação `cancelar`, a proposta é `excluir` + `confirmar` (R-EDICAO-EXCLUSAO (f)). A guarda de rota e a elegibilidade usam a **mesma** fórmula (`porTodas`);
  - **sem concessão automática a perfis não administradores**. O administrador real e `is_admin` têm todas as ações por desenho (`telaPermite`, `autorizacaoTela.js:167-178`). Só a elegibilidade de negócio (A8.3, A8.4) os barra. Exigir para `OUTRA` ou `SALDO_IMPLANTACAO` algo acima do administrador (dupla aprovação) depende de decisão própria;
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
| Entrada documentada: confirmar, editar, excluir | — | **Comandos novos** (P1-05a/b; A8) |
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
   - **Primitiva de produção:** a reversão de entrada usada em produção é `estornarEmLote` (`operacaoFinanceiraService.js:1528`). `estornarEntrada` só é chamada por teste (`backend/tests/gestaoP3Rodada2.test.mjs:24`, `:283`). A entrada manual usa `estornarEmLote` parametrizada, ou uma primitiva irmã com a mesma guarda, aceitando um item no formato da linha da entrada.
   - `tipo_detalhado` dos estornos (candidatos; a coluna é `VarChar(128)`, `schema.prisma:1228`): `estorno_entrada_revisao` e `estorno_entrada_exclusao`.
   - A origem nova `entrada_estoque` cabe em `origem_sistema VarChar(32)` (`schema.prisma:1271`).
   - Os rótulos atuais de compra (`:974`, `:982`) não mudam.
7. **Proteção:**
   - teste "byte a byte" da P3 e `estoqueP0MotorUnico`;
   - o único chamador de produção de `aplicarEntradaEstoque` é `operacaoFinanceiraService.js:1374`.
8. **Endurecimentos que a R2 exige** (P1-02, além de M5):
   - a reversão usada pela entrada (`estornarEmLote` parametrizada ou a primitiva irmã do item 6), e também `estornarEntrada`, confere, para cada linha e antes de qualquer mudança, que `empresa_id`, `produto_id` e `local_estoque_id` da camada lida sob `FOR UPDATE` são os da linha. Se divergir, recusa sem alterar nada. Hoje nenhuma das duas confere:
     - `estornarEmLote` lê esses campos (`:870-873`), mas tira produto e local do item (`:918-919`) e só confere status e quantidades (`:924-930`);
     - `estornarEntrada` usa `a.produto` e `a.local` do chamador (`:700-704`, `:715`, `:721`);
   - a marcação do original como `Estornada` passa a ter CAS `status = 'Ativa' AND movimento_filho_id IS NULL`, conferindo a contagem. Hoje é update só por id (`:683-687`, `:1004-1007`), e só há **uma** coluna de filho;
   - as camadas a estornar são lidas `FOR UPDATE` em toda primitiva de reversão. `estornarEmLote` já faz isso (`:870-871`). `estornarEntrada` lê com `findUnique`, sem trava (`:703`).
9. **Reconciliação, no mesmo slice da P1-05a:**
   - a origem nova entra em `ORIGENS_SISTEMA`, `EXCLUSAO_SOMENTE_EM` e `ORIGENS_PROTOCOLO`, **fora** de `ORIGENS_SEM_FK` e `ORIGENS_COM_FK` (`reconciliacaoEstoque.js:135-141`). Sem isso, o movimento vira `origem_desconhecida` e mascara divergência real do produto inteiro;
   - um CTE novo, análogo ao `compra` (`:502-506`, `:540`), explica a camada `Estornado` pela FK `EntradaEstoqueItem.movimentacao_estorno_id`, com a mesma semântica de entrada inteira;
   - a nova entrada da revisão **não** usa `movimento_pai_id` para apontar a revisão anterior. O vínculo de versão vive no documento, porque pai e filho já são o par original ↔ estorno (`:637`).
10. **AuditLog do documento só com entidade `EntradaEstoque`.** Nunca `EstoqueLoteNota` nem `Produto`: a reconciliação lê essas duas entidades como evidência e rebaixaria divergência real para "legado" (`reconciliacaoEstoque.js:360-397`). O AuditLog leva a allowlist (ids, número, status, versão, revisão, `motivo_informado: true`). O texto do motivo e o antes e depois vão para o evento estruturado (precedente: `operacaoFinanceiraService.js:565-580`).

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
| B-03 | Replay número × string | P1-02 (comandos atuais) e regra de P1-05a/05b |
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
| 6 | P1-05a `EntradaEstoque` backend: documento, confirmar, excluir | Documento + linhas versionadas + eventos (modelo abaixo); A1–A7; exclusão de rascunho e de confirmada (A8.3, A8.6); janela FIFO na confirmação (A8.4); elegibilidade (A8.7); C4; reconciliação **no mesmo slice** (§6.2, itens 9 e 10); dedupe nos dois sentidos | sim (3 tabelas + RLS pinada; **todo o DDL da entrada aqui**, inclusive as colunas de revisão) | 2, 3 |
| 7 | P1-05b edição de entrada confirmada | Revisão versionada atômica (A8.2), classes M/F/I, alcance por documento, janela FIFO pela ordem `(chave, id)`, regras da implantação (A3), testes de concorrência e de falha no meio | não (usa o DDL da P1-05a) | 6 |
| 8 | P1-06 tela Base1 de Entradas | Página, menu, escopo e permissões só aqui; Editar e Excluir com motivos; histórico de revisões; filtro Excluídas; **sem botão Cancelar** | não | 6 **e** 7. A tela nunca é liberada só com exclusão, nem com "Cancelar" como única correção |
| 9 | P1-07 lote do fabricante | B1–B4, I6 | sim | 6; R-LOTE ratificada |
| 10 | P1-08 lote na compra P3 | Decisão própria | não (coluna no P1-07) | 9 |
| 11 | P1-09+ | Linhagem, estornos de suplementação e transferência, reconciliação v3, inventário/ajuste (o "próximo passo" de A8.7 para entrada com dependência), offline | caso a caso | anteriores |

**Dependência a observar (P1-05a/05b × P1-07).** Se o proprietário exigir lote do fabricante já no **primeiro** recebimento manual de produtos perecíveis, P1-07 precisa vir antes de P1-06 (tela).
- As duas migrations **não se misturam** sem justificativa e GO.
- Alternativa sem reordenar: P1-05a/05b/06 recusam produto com `exige_lote_fabricante = true` até P1-07 existir.

**Não se promete:**
- FEFO;
- reconciliação global perfeita;
- cancelamento de transferência sem linhagem;
- edição física ou exclusão de entrada **com** dependência física. Nesses casos a resposta honesta é o bloqueio com razão e próximo passo (A8.7), nunca um reajuste;
- conversão de entrada manual com dependência em compra, ou o título dessa compra com o documento verdadeiro, antes da R-CONVERSAO;
- recálculo de custo de baixas passadas.

**Modelo de dados candidato da entrada** (P1-05a; é DDL e precisa de runbook e GO antes do merge; **nenhuma migration agora**). Todas as tabelas são tenant-scoped, com `cliente_id` obrigatório, índices e uniques começando por `cliente_id` (R9, R10) e RLS pinada.

| Tabela | Papel | Pontos-chave |
|---|---|---|
| `EntradaEstoque` | Cabeçalho | Status: `RASCUNHO`, `CONFIRMADA` ou `EXCLUIDA` (CHECK na tabela nova). Colunas: `versao` (CAS); `revisao` (0 no rascunho, ≥ 1 depois de confirmar); motivo; data; parceiro e documento; `documento_chave_ativa` com a unique de A5; confirmação, exclusão e autor de cada uma; `excluida_de`. Número estável por tenant |
| `EntradaEstoqueItem` | Linha versionada por intervalo | `revisao_inicio`, `revisao_fim` (nula = vigente), produto, local, unidade, quantidade, fator, `quantidade_estoque`, custo e `custo_zero`. FKs compostas `(cliente_id, id)` e Restrict para Produto, LocalEstoque, `EstoqueLoteNota` (camada), movimento de entrada e movimento de estorno, cada uma **unique** por `cliente_id` (como `schema.prisma:2135-2137`). A camada fica protegida contra DELETE pela FK, e a reconciliação a explica pela FK do estorno |
| `EntradaEstoqueEvento` | Histórico append-only das revisões | Tipo: `CONFIRMACAO`, `EDICAO` ou `EXCLUSAO`. Modo: `METADADOS` ou `SUBSTITUICAO`. Colunas: revisão e versão anterior e nova, motivo obrigatório (≤ 500), `usuario_id`, `snapshot_anterior` e `snapshot_novo` em JSON (cabeçalho e linhas com ids de camada, movimento e estorno). FKs Restrict. **Não** é imposto pelo banco: o AuditLog também não é append-only por trigger. É convenção do serviço mais FKs Restrict, sem rota de `UPDATE` ou `DELETE` (precedente `OperacaoFinanceiraEvento`, `schema.prisma:2329-2365`) |

- O texto "nunca `UPDATE` em fato" vale para camada e movimento.
- O cabeçalho do documento é mutável por CAS (versão, revisão, chave ativa, status), como o cabeçalho da P3.
- O histórico do documento vive nos eventos e nas linhas fechadas (`revisao_fim`).

## 8. Pontos que dependem de ratificação humana

> **O merge desta PR não aprova nem ratifica nada.** Isso difere do padrão em que o merge manual do proprietário materializa a aprovação (D-PROD-22/155/157/159/162). Aqui a ratificação exige o texto incorporado em `00` e `07` pelo fluxo da proposta de emenda (§5) e uma nota posterior datada na D-PROD-176.

- **R-EMENDA:** texto de [`MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md`](./MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md) para `00-CONSTITUICAO.md` e `07-DO-NOT-DO.md`.
- **R-MOTIVOS:** os 3 motivos do 1º slice, a exclusão de COMPRA, AJUSTE, DEVOLUCAO e afins, a proibição de usar DOACAO/OUTRA para saldo pré-existente e a ausência de caminho, no 1º slice, para produto com histórico e saldo antigo não registrado.
- **R-IMPL (refeita na R2):** elegibilidade da implantação (A3):
  - uma implantação ativa por produto e empresa, corrigida por **Editar** no mesmo documento enquanto não tiver dependências;
  - **Excluir** só sem dependências;
  - nova implantação só depois de `EXCLUIDA`, desconsiderando exatamente os fatos ligados por FK aos documentos excluídos (variante proposta). A alternativa é a variante estrita (nunca reimplantar);
  - a implantação consumida e depois estornada continua bloqueada.
  Decidir antes da R-EMENDA.
- **R-DATA:** limite da data retroativa de DOACAO/OUTRA (A7).
- **R-DEDUPE:** tudo isso toca contrato congelado da Gestão:
  - a consulta recíproca nos três caminhos da P3 (confirmar, retificar, prévia), **nas duas direções**, PAGAR e RECEBER;
  - a unique entrada × entrada;
  - o valor de N do aviso de A5;
  - o aviso de "implantação antes da primeira compra";
  - os avisos de documento liberado por exclusão e por revisão (A5).
- **R-CONVERSAO (nova na R2, pendente):** entrada `DOACAO` ou `OUTRA` que, na verdade, era compra e já tem dependência física. Ela não pode ser excluída nem ter o documento trocado, e a compra com a nota verdadeira fica bloqueada pela recíproca. **Não há caminho no 1º slice.** Opções para o proprietário:
  - (i) um comando de conversão com decisão própria;
  - (ii) permitir o PAGAR sem mercadoria com o mesmo documento, com declaração expressa;
  - (iii) aceitar o bloqueio até o ajuste de inventário.
- **R-LOTE:** identidade do lote com `ocorrencia` imutável e escolha explícita (B3); reclassificação só na raiz; nome do model.
- **R-ORDEM:** posição de P1-07 em relação a P1-05a/05b/06.
- **R-SPLIT (desvio a aprovar):** a sequência da missão exige a ratificação antes da P1-02 inteira, e é essa a regra adotada aqui. Se o proprietário quiser, pode autorizar dividir em duas PRs, cada uma com missão própria:
  - **P1-02a:** M3–M6, sem a origem `entrada_estoque` nem os parâmetros de motivo e estorno da §6.2;
  - **P1-02b:** a §6.2, só depois da ratificação.
  Sem essa autorização expressa, vale a regra estrita.
- **R-EDICAO-EXCLUSAO (nova na R2):** a semântica de A6 e A8 como um todo, com estes pontos explícitos:
  - (a) status literal `EXCLUIDA` em vez do `CANCELADO` + `excluido_em` da P3;
  - (b) baixa depois estornada **continua** bloqueando editar e excluir (`consumo_estornado`);
  - (c) janela FIFO na confirmação e na revisão da entrada, e se ela deve um dia valer também para a compra da P3, que hoje não a tem;
  - (d) recibos de confirmação e edição viram `STATUS_EXCLUIDO` na exclusão;
  - (e) na implantação com outros fatos do produto, só quantidade, custo, unidade, parceiro e documento no mesmo par e data;
  - (f) permissões compostas (`editar` + `confirmar`; `excluir` + `confirmar`);
  - (g) sem restaurar documento excluído;
  - (h) com dependência, só observação e justificativa são editáveis;
  - (i) estornos da revisão datados no dia de hoje da fazenda;
  - (j) divisão da P1-05 em P1-05a e P1-05b, com a tela só depois das duas;
  - (k) **alcance da dependência** (A8.1):
    - proposta, **por documento**: uma camada referenciada trava a classe F de todos os itens;
    - alternativa, **por item**: só os itens com camada referenciada ficam travados. Data, parceiro e documento travam se qualquer item tiver dependência, e incluir item continua sujeito à janela FIFO.
    - Se a alternativa for escolhida, a A8.1, a A8.2, a A8.3, a A8.7, a A3 e o texto proposto para 00 e 07 mudam juntos;
  - (l) motivo da entrada imutável (classe I).
- **Textos da emenda e pontos abertos:** o texto proposto para 00 e 07 já incorpora as propostas (b) (baixa estornada bloqueia), (c) (janela FIFO só na entrada) e (k) (alcance por documento). Se a ratificação escolher outra opção, a proposta de emenda (§5) indica a frase literal que muda.
- **D-PROD-176:** número e texto da decisão.

> O proprietário deverá aprovar expressamente o texto proposto e ratificar pelo fluxo constitucional antes da P1-02, da P1-05a, da P1-05b e da P1-06.
