# MAIKE-LOTES-SALDO-MOVIMENTACOES-REAL-2026-10-30 — relatório

- **Base:** `origin/main` `323318da`.
- **Branch:** `claude/new-session-26kpxu`.
- **PR paralela:** maikelimaadm-stack/MAIKE#149, aberta.
  - Arquivos dela, nenhum tocado aqui:
    - `src/pages/MapaGeral.jsx`
    - `src/components/mapa/useMapRenderer.jsx`
    - `src/components/configuracoes/GerenciadorIcones.jsx`
    - `src/lib/imagens/redimensionarIcone.js`
    - `docs/engineering/DECISIONS.md`
    - 2 testes
  - A decisão abaixo fica registrada aqui. Ela entra em `DECISIONS.md` depois
    do merge da #149, para não colidir.

## Mapa sem WebGL: mensagem legível (incluído na PR #154 a pedido do proprietário)

**Sintoma relatado:** o mapa mostrava sempre um JSON técnico:
`{"type":"webglcontextcreationerror","message":"Failed to initialize WebGL", "statusMessage":"Could not create a WebGL context, ... GL_VENDOR = Disabled ..."}`.

**Causa:** o navegador do computador está com o WebGL desligado
(`GL_VENDOR = Disabled`). Isso acontece com a aceleração gráfica desligada,
GPU bloqueada ou o Chrome desativando o WebGL depois de travas do processo de
vídeo.
- Não é defeito do app.
- Conferido: cada mapa é liberado ao fechar (`map.remove()` em
  `src/lib/maplibre/lifecycle.js` e nos diálogos), sem vazamento de contexto.

**Mudança:** `src/lib/maplibre/falhaWebGL.js`.
- `navegadorTemWebGL()` testa o WebGL antes de abrir o Mapa Geral; o contexto
  de teste é liberado em seguida.
- `mensagemFalhaMapa()` troca a falha de WebGL por uma explicação em
  português com o que fazer: ativar "Usar aceleração gráfica quando
  disponível", reiniciar o navegador, atualizar o driver ou testar outro
  navegador.
- Aplicado no Mapa Geral e nos 5 mapas de diálogo (desenho, seleção de áreas,
  depósito, local de tarefa, captura GPS).
- O botão "Tentar novamente" segue igual.

**Testes:**
- `maplibreFalhaWebGL.test.js` 4/4, com o JSON real do proprietário;
- os testes de mapa existentes passam;
- `maplibreSelecaoDepositoMapa` passou a esperar a mensagem explicativa.

## Editar/excluir só sem histórico (D-PROD-86)

**Pedido do proprietário:** edição e exclusão do lançamento só se não houver
nada depois da entrada (movimento, manejo ou registro). Com histórico, "não
fica nem liberado".

**Histórico = qualquer uma destas condições:**
- lote gerado por manejo;
- registro que cita o lote (mapa, pecuária, suplementação, tarefa, manejo técnico);
- estado divergente da entrada (saldo, área ou categoria).

| Cenário | BEFORE (`main` `46664043`, medido) | AFTER |
|---|---|---|
| Lote 1 com transferência: PATCH de observações, raça, origem, motivo, data, GTA, idade ou sistema | 200 (o lançamento mudava depois da movimentação) | 409 `LOTE_UPDATE_BLOCKED` (`vinculo: movimentacoes_mapa`), registro intacto |
| Lote 2 (gerado por manejo): PATCH de origem | 400 (só a classe da origem era checada) | 409 `LOTE_UPDATE_BLOCKED` (`lote_gerado_por_manejo`) |
| Destino de unificação (recebeu cabeças, sem registro próprio): editar | 200 | 409 (`lote_com_manejo`) |
| Destino de unificação: excluir | — | 409 `LOTE_DELETE_BLOCKED` (`lote_com_manejo`) |
| Lote sem nada depois da entrada | 200 / 204 | 200 / 204 (inalterado) |
| Manejo do mapa no lote com histórico (saldo, status, nome) | 200 | 200 (inalterado) |
| Tela: Editar/Excluir em lote com histórico | abria a edição / pedia confirmação | aviso "Lote com histórico", nada abre; formulário só leitura |

**Testes:**
- backend (PostgreSQL 16): `loteDerivadoIntegridade` 23/23 com os arquivos vizinhos;
  - contra `main`: 3 falham (200, 400, 200);
  - controles livre e mapa passam nos dois.
- smoke: `cadastroLotesEntrada` 8/8 e `lotesSaldoMovimentacoes` 33/33.

**Limite conhecido:** nome, status e identificador são escritos também pelo
mapa (renomear, inativar). O servidor não os bloqueia, para não quebrar os
manejos; a trava deles é na tela do Cadastro.

## Cadastro = entrada (slice corretivo pós-#151, D-PROD-85)

**Pedido do proprietário:** o Cadastro de Lotes é o lançamento da entrada do
rebanho. "Se eu lançar 500 animais e fizer depois movimentações, entradas,
saídas etc., nada muda no meu cadastro de lotes."

**Auditoria do caminho de escrita**
(`CadastroLotes` → `loteCadastroService` → `lotesApi`/`loteNativePort` → `POST/PATCH/DELETE /lotes` → `loteService`):
- O CRUD do Cadastro só grava `Lote`.
- Nenhum ponto cria `MovimentacaoMapa`, `MovimentacaoPecuaria` ou lote derivado.
- Os manejos vivem em `DetalhesLote`/`loteManejoService`/`HistoricoMovimentacoes` (mapa).
- Provado no backend com PostgreSQL real; já valia antes desta correção.

**Campos que os manejos do mapa reescrevem no `Lote`:**

| Manejo | Campos |
|---|---|
| movimentação, morte, abate | `quantidade_cabecas`, `status`, `area_atual_*` |
| mudança de categoria | `categoria`, `categoria_manejo_*`, `sexo` |
| pesagem | `peso_medio_kg` |
| renomear | `nome` |

**Campos da entrada, que nenhum manejo toca:** `quantidade_entrada`,
`categoria_entrada`, `categoria_manejo_entrada_*`, `peso_entrada_kg`,
`area_entrada_*`, data, motivo e origem.

| Achado (no `main` `46664043`) | Arquivo | Gravidade | Correção | Teste depois |
|---|---|---|---|---|
| Saldo atual e "Movimentações (±)" no Cadastro: o lote 1 mudava de 500 para 450 depois da transferência | `TabelaLotes.jsx`, `campoEngine.js`, `saldoLote.js` | P1 | Uma só coluna de quantidade, "Qtd. entrada" (`quantidade_entrada`); saldo, variação, exportações e fórmulas removidos; domínio sem `saldoAtualDoLote`/`movimentacaoLiquidaDoLote`/`resumoDeCabecas` | grade mostra 500 (não 450); nenhuma coluna ou texto de saldo ou movimentação |
| Lotes gerados por manejo listados no Cadastro | `CadastroLotes.jsx` (`incluirSistema: true`) | P1 | A lista traz só entradas no rebanho (nascimento incluso) | lista = lote 1; lote 2 ausente |
| Formulário de edição mostrava categoria, sexo e peso ATUAIS (mudados pelo mapa) e os reenviava no PATCH, podendo desfazer mudança de categoria ou pesagem | `FormularioLote.jsx` | P1 | Na edição, mostra os valores da entrada, só leitura, e não os envia; leitura "Qtd. entrada" sem saldo | peso da entrada 180 (não 260), campos só leitura, payload sem categoria/sexo/peso |
| Migração de layout das colunas "Entrada/Movimentações" (#151) | `TabelaLotes.jsx` | P3 | Removida; ids antigos são descartados na leitura do layout | layout com ids antigos lido só com `cabecas` |

**Testes:**
- smoke: 135/135 nos 7 arquivos de lote (`lotesSaldoMovimentacoes` 30, `cadastroLotesEntrada` 5, catálogo, formulário, rollout, manejo).
  - O teste de catálogo agora espera que a edição não reenvie `categoria_manejo_id`.
- backend: 19/19 (invariantes novos: POST e PATCH sem manejo).

**Mantido da #151:**
- bloqueio de exclusão de lote derivado no servidor;
- classe da origem imutável;
- setor, áreas e quantidades fora do PATCH do cadastro;
- nome da área pelo id.

**Pontos para o proprietário:**
- O status Ativo/Inativo é o do registro: o mapa ainda inativa o lote que zerou.
- Nome e identificação seguem o valor atual (renomear no mapa muda o nome).

**Risco residual:** manejo parcial não atômico, sem mudança. A correção é o L2
do ledger, em slice próprio.

## R3 — finalização (sobre `2bf908f4`)

`origin/main` `f6592e2a` (#150, contagem de cabeças no mapa) foi trazido por
merge, sem force.

**Conflito em `DECISIONS.md`:** o `main` já usava D-PROD-83 (contagem no
mapa, citado em `useMapRenderer.jsx` e `contagemLote.js`). A decisão desta PR
foi renumerada para **D-PROD-84**, depois da do `main`. Próxima: D-PROD-85.
Os arquivos do mapa ficaram idênticos ao `main`.

| Falha | BEFORE (`2bf908f4`, medido) | Correção | AFTER |
|---|---|---|---|
| Setor editável na edição | trocar o Setor pelo Autocomplete zera a Área de Entrada (só leitura) e o salvar trava em "Campos obrigatórios" | Setor `readOnly`/`disabled` no próprio `AutocompleteGenerico`, guarda no `onChange` e no `handleChange`; o PATCH do cadastro não leva `setor_*` nem `area_entrada_*` (sem depender do filtro do port nativo) | Setor e área intactos; salvar passa; payload sem campos históricos; renomear e outros metadados salvam |

**Lote novo e duplicado (POST):** sem mudança. Setor editável, e o payload
leva setor, áreas e quantidade.

**Testes R3** (`lotesSaldoMovimentacoes.test.jsx`, 32/32):
- edição de lote manual, derivado e que saiu e voltou: contra `2bf908f4`, os 3 falham;
- lote duplicado (POST) e lote novo: controles que passam antes e depois.

 (auditoria do arquiteto sobre `34ceaa6a`)

`origin/main` (`af099211`, #149 mergeada) foi trazido por merge, sem
conflito e sem force. Decisão registrada como **D-PROD-84** (o D-PROD-83 ficou com a contagem do mapa, mergeada antes no `main`).

| Falha | BEFORE (`34ceaa6a`, medido) | Correção | AFTER |
|---|---|---|---|
| **A — P1** DELETE de lote derivado sem vínculo próprio | `DELETE /lotes/<lote 2>` → **204**: 50 cabeças somem (a transferência cita só o lote 1) | `loteService.excluir`: dentro da transação, depois de carregar o lote do tenant, recusa origem derivada (`backend/src/modules/lotes/loteOrigem.js`) | **409** `LOTE_DELETE_BLOCKED` (`vinculo: lote_gerado_por_manejo`); 500 cabeças, 2 lotes e 1 movimentação preservados |
| **A — P1** PATCH trocando a classe da origem | `PATCH {origem: 'OUTROS'}` no derivado → **200** (a conta histórica mudaria em silêncio) | `loteService.atualizar` recusa troca entre entrada e gerado por manejo | **400** `REQUEST_VALIDATION_FAILED` (`field: origem`); COMPRA → AJUSTE segue 200; o PATCH de saldo do mapa segue 200 |
| **B — P1** editar a área de entrada movia o lote | lote que saiu e voltou (mesma área, mesmo saldo) → payload com `area_atual_id`; campo de área de entrada editável. O port nativo descarta `area_entrada_id` no PATCH, então a "edição da entrada" só movia o lote | O formulário nunca envia área atual na edição; área de entrada só leitura na edição; sem a inferência "saldo igual = nunca movimentou" | payload sem `area_atual_*` para lote intacto, que saiu e voltou, derivado ou zerado; lote novo continua definindo as duas áreas |

**Já protegido antes da R2 (provado):** `quantidade_entrada` e
`area_entrada_id` não fazem parte do schema de PATCH (400).

**Achado extra:** "EDIÇÃO MOVIMENTAÇÃO" é a recomposição criada ao
editar/desfazer uma movimentação (`movimentacaoReconciliation`). São cabeças
que já existiam, e a origem entra na mesma regra.

O classificador do ledger L1 (`classificarOrigemLote`) não foi alterado: é
módulo isolado e vai ser alinhado no L2.

**Como corrigir:**
- onde o lote está: "Movimentar" no mapa (grava movimentação);
- uma entrada lançada errada: excluir o lote (se não tiver vínculos) e cadastrar de novo.

**Testes R2:**
- `backend/tests/loteDerivadoIntegridade.test.mjs` (PostgreSQL 16):
  - 7/7 depois;
  - contra `loteService` de `34ceaa6a`: 3 falham (204, 204, 200);
  - os controles passam nos dois: lote manual e Nascimento excluíveis, tenant 404, entrada imutável, paridade frontend × servidor.
- `tests/smoke/lotesSaldoMovimentacoes.test.jsx`:
  - 27/27;
  - os testes R2 do formulário contra `34ceaa6a`: 2 falham (saiu e voltou; área de entrada editável).
- O teste da R1 que esperava "nunca movimentado leva a área atual" mudou de expectativa: a política agora é nunca mover pela edição.

## Problema relatado

O Cadastro de Lotes não mostrava a saída de cabeças. O proprietário fez uma
movimentação parcial de 50 cabeças do lote 1 e a tela continuou mostrando 500.

## Fatos (produção, somente `SELECT`, 30/10/2026)

| Registro | Dado |
|---|---|
| Área TESTE | criada 19:56:15 |
| Lote 1 "TESTE" | origem AJUSTE, `quantidade_entrada` 500, `quantidade_cabecas` 450, área TESTE, Ativo |
| Área TET | criada 20:00:02 |
| Lote 2 "TESTE" | origem MOVIMENTAÇÃO, entrada 50, cabeças 50, área TET (`area_atual_nome` = TET), criado 20:00:41 |
| MovimentacaoMapa | Transferência de Área, 50, `area_destino_id` = TET (id correto), `area_destino_nome` = `""`, criada 20:00:45 |

**Conferência:** 450 + 50 = 500. Nenhum saldo negativo foi gravado. O banco
estava certo; a apresentação estava errada.

## Causas (reproduzidas contra `origin/main`)

| # | Causa | Prova BEFORE |
|---|---|---|
| 1 | `CadastroLotes` pedia `incluirSistema:false`, que esconde o lote de origem MOVIMENTAÇÃO | lotes visíveis: só o lote 1 |
| 2 | Coluna genérica "Cabeças" = `quantidade_entrada` (grade, cards, exportação, `campoEngine`, totais) | lote 1 exibido com **500** |
| 3 | Somar "Cabeças" com o lote 2 visível daria **550**: a mesma cabeça contada duas vezes | `calcularAgregacoes` = 550 |
| 4 | Formulário em edição reenviava `quantidade_cabecas`, `origem` (= motivo) e `area_atual_id` (= área de entrada) | payload do lote 2: `origem=OUTROS`; corrigir a "quantidade" para 500 ressuscitaria as 50 cabeças |
| 5 | Nome da área de destino em branco | ver detalhe abaixo |

**Detalhe da causa 5.** `DetalhesLote` tirava o nome do cache local de áreas.
Esse cache devolve a lista antiga primeiro e atualiza em segundo plano, e a
TET tinha sido criada 43 s antes.

O backend de `MovimentacaoMapa` gravava o JSON como veio. Já o de `Lote`
resolve o nome pelo id, por isso o lote 2 saiu certo e a movimentação não.

Teste backend contra o serviço de `main`: `area_destino_nome` = `''`.

## Contrato aplicado (`src/domain/lotes/saldoLote.js`)

| Grandeza | Definição |
|---|---|
| **Entrada (histórico)** | `quantidade_entrada`, retrato imutável. Lote gerado por manejo (MOVIMENTAÇÃO, REVERSÃO MOVIMENTAÇÃO, MUDANÇA DE CATEGORIA) **não** é entrada no rebanho e vale 0 (exibido "—"). Nascimento é entrada. |
| **Saldo atual** | `quantidade_cabecas` |
| **Movimentações (±)** | saldo − entrada: negativo na origem, positivo no destino. É sinal do fluxo, não estoque negativo. |

Invariante por lote e no total: entrada + movimentações = saldo.

**Aceite (caso real):**

| | Entrada | Movimentações | Saldo |
|---|---|---|---|
| Lote 1 | 500 | −50 | 450 |
| Lote 2 | — | +50 | 50 |
| **Rebanho** | **500** | **0** | **500** |

Nunca 550, 450 nem −50.

## O que mudou

**Cadastro (grade, cards, exportação):**
- Lista todos os lotes da empresa.
- Colunas "Entrada (histórico)", "Movimentações (±)" e "Saldo atual". O id
  `cabecas` foi mantido para o layout salvo.
- Totais (soma) sempre visíveis nas três colunas.
- Exportação com números crus e variação com sinal.
- Migração única do layout salvo, para as colunas novas não nascerem ocultas.

**`campoEngine`:**
- `cabecas` = saldo atual.
- Novos campos `entrada` e `movimentacoes`.
- Fórmulas ganham `saldo_atual`, `entrada` e `movimentacoes`.
- `quantidade` continua sendo a quantidade de entrada (valor da compra).

**Formulário (edição):**
- As quantidades ficam só leitura ("Entrada: 500 · Movimentações: -50 · Saldo
  atual: 450"); o saldo muda só por manejo.
- O payload de edição:
  - não leva `quantidade_*`;
  - não troca a `origem` de lote gerado por manejo;
  - só leva a área atual junto com a de entrada se o lote nunca movimentou.
- Lote zerado pode ser editado; antes, "quantidade 0" bloqueava salvar.
- O cadastro de lote novo não mudou.

**Exclusão:** lote gerado por manejo não é excluído pelo cadastro
(`LOTE_DELETE_BLOCKED`), porque apagaria cabeças sem estornar a origem.

**Backend `MovimentacaoMapa`:**
- `area_origem_nome`, `area_destino_nome` e `area_nome` são resolvidos pelo id
  no banco, no mesmo tenant e empresa, em create, bulk e PATCH.
- Id que não resolve é aceito, sem inventar nome: preserva a fila offline e o
  legado.
- Sem migration, rota nova ou mudança de schema.

**Histórico de movimentações:** nome vazio gravado cai para o nome da área pelo
id; fora do cache, mostra um rótulo curto com o fim do id em vez de "-".

**`DetalhesLote`:** se a área do movimento não está no cache, relê as áreas
antes de gravar.

## Dados antigos

O registro `cmvved7x20008ju08gz4zkz1d` continua com `area_destino_nome` vazio
no banco. Nada foi escrito em produção.

- A tela já mostra "TET", pelo id.
- Corrigir o dado gravado exige uma migração controlada e autorizada à parte.

## Riscos residuais (não resolvidos aqui, fora do escopo)

- **Movimentação parcial não é atômica:** `DetalhesLote` cria o lote de
  destino, debita a origem e grava a movimentação em três chamadas.
  - Falha no meio pode deixar cabeças duplicadas ou perdidas.
  - Correção real é o ledger transacional (L2 da #146): exige aprovação e
    slice próprio.
- **Variação × trânsito:** "Movimentações (±)" é a variação líquida desde a
  entrada (inclui morte e abate), não só transferência. Para o detalhe
  evento a evento, o histórico do lote no mapa continua sendo a fonte.
- **Saldo editável fora do cadastro:** o servidor ainda aceita
  `quantidade_cabecas` em PATCH de lote, porque os fluxos de manejo dependem
  disso. A proteção desta missão é na UI do cadastro.
- **Saída e volta ao mesmo lote:** um lote que saiu e voltou ao mesmo saldo,
  na mesma área, é tratado como "nunca movimentado" para a regra da área atual.

## Testes

| Suíte | Resultado |
|---|---|
| `tests/smoke/lotesSaldoMovimentacoes.test.jsx` | 25 testes: domínio, `campoEngine`, exportação, grade real com Totais 500/0/500, migração de layout, exclusão bloqueada, formulário (payload e exibição), nome de área pelo id |
| `backend/tests/movimentacaoMapaNomesArea.test.mjs` (PostgreSQL 16 real) | 5/5 depois. Antes, contra o serviço de `main`: 3 falham com `''` / `'NOME VELHO DO CACHE'`; os 2 de isolamento (outra empresa, outro tenant) passam nos dois |
| Suítes de lote existentes (9 arquivos, 137 testes) | PASS; `lotesBase1Rollout` atualizado para `incluirSistema: true` |

## Próximo passo do proprietário

Abrir o Cadastro de Lotes na empresa do teste e conferir:
- lote 1: 500 / -50 / 450;
- lote 2: — / +50 / 50;
- Totais: 500 / 0 / 500.

Depois:
- exportar o CSV;
- abrir o lote 2 e confirmar que a quantidade não é editável;
- abrir o histórico no mapa e ver "TESTE → TET".
