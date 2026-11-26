# Diário das atividades, parte 1: abertura do serviço (D-PROD-332)

**Data:** 2026-11-26 · **Decisão:** [D-PROD-332](./DECISIONS.md) · **Branch:** `feat/atividades-abertura` · **Migration:** nenhuma · **Backend:** sem mudança

## O que a pessoa vê

Nos Detalhes da área (Manejos), um botão só: **Diário das atividades** (no lugar de "Iniciar atividade" e "Diário da máquina").

| Tela | O que tem |
|---|---|
| 01 · Nova atividade | Os 7 tipos fixos em cartões; "Preparo do solo" traz "Gradeação, calagem". Continuar só com um escolhido. |
| 02 · Nova atividade de <Tipo> | Máquina \*, Implemento (opcional, "— Sem implemento —"), Horímetro inicial \* (pt-BR, vem com a última leitura da máquina), Responsável \*. Com mais de uma operação do tipo, a Operação \* vem antes. "Iniciar serviço". |
| 03 · Diário das atividades (serviço aberto, maquete 05) | Cabeçalho verde do serviço aberto (tipo, Aberto, máquina, implemento, responsável, pasto, horímetro inicial); as 7 opções em cartões; "Lançado hoje"; "Encerrar serviço". Ver a emenda abaixo. |

Não há "hora de início", nem serviços, mão de obra ou outros custos na abertura.

## Como

- **`src/lib/aberturaServicoRegras.js` (novo):** o marcador da abertura na 1ª linha da observação do apontamento (`marcadorDaAbertura`, `lerAbertura`, `textoDaObservacao`, `observacaoComAbertura`), `validarAbertura`, `parseHorimetroPtBr` ("1.245,0" → "1245.0"), `formatarHorimetro`, `aberturaDosApontamentos`. Usa `lerNumeroLocal` e `formatarNumero` de `dinheiroDecimal.js`.
- **`src/components/lancamento-atividades/DiarioDasAtividades.jsx` (novo):** a janela com os três passos. Envia com `registrarCampo` (um envio só). Sem atividade, começa no tipo; com uma atividade em andamento, começa no cabeçalho, com a abertura lida de `listarApontamentos`.
- **`src/components/cadastro/base1/B1Janela.jsx`:** prop nova `antesDoTitulo` (opcional) para a seta "Voltar", que precisa ficar à esquerda do título. Nenhuma outra tela muda.
- **`src/components/mapa/detalhes-area/AbaDetalhesDaArea.jsx`:** o botão `area-diario-atividades` substitui os dois anteriores. Saíram as importações e estados de `JanelaRegistroDeCampo` e `DiarioDaMaquina` (os arquivos continuam no repositório).
- **`src/styles/cadastro-base1.css`:** `.cartao-sub` (com a variante do celular), `.b1-realizacao__titulo*` e `.b1-aberto-*` (o cabeçalho verde, copiado do `v4.css`).

## Escolhas e limites

- **Horímetro na observação é texto.** Editar a linha à mão pode apagá-la; a tela então diz "Abertura não registrada". Os números reais do horímetro chegam com o "Encerrar o dia", em tabela própria, numa etapa futura.
- **Operação:** com uma só, é usada sem perguntar; com mais de uma, a pessoa escolhe; com nenhuma, o aviso "Cadastre em Tipos de Atividade." e o botão não envia.
- **Permissão e fuso:** os mesmos da Nova realização (`lancarApontamento` e fuso configurado).
- **Com uma atividade em andamento no pasto**, o botão abre o cabeçalho dela e não permite iniciar outra por ali (é o desenho da tela 03, por enquanto).

## Testes

- `tests/smoke/aberturaServicoRegras.test.js`: 26 testes (marcador, leitura, horímetro, validação, apontamentos).
- `tests/smoke/diarioDasAtividades.test.jsx`: 12 testes. Cobrem os 7 cartões e o "Continuar", a ordem dos campos e a ausência de "Hora de início", a leitura da máquina no horímetro, os erros de validação, o envio com a abertura na observação e o cabeçalho, a abertura a partir de uma atividade existente, a ausência de cabeçalho sem abertura e a Operação obrigatória com duas operações.
- `tests/smoke/diarioFase2.test.jsx`: atualizado para o botão novo (9 testes).
- Vizinhos (mapa, diário da máquina, Base1): 92 testes passando no total com os acima.

## Emenda — tela do serviço aberto (maquete 05)

Depois da abertura, o serviço aberto segue a maquete 05 (`05-servico-aberto-menu-mobile/desktop.png`), na mesma janela:

- **Cabeçalho verde** (sem mudança): tipo e "● Aberto", máquina, implemento, responsável, pasto e horímetro inicial.
- **Sete opções** em cartões de duas colunas (a última ocupa a linha): Insumo, Máquina, Abastecimento, Trocar pasto, Mão de obra, Serviço de terceiro, Outros custos. Ícone verde à esquerda, título e linha de apoio; a seta só no desktop. `data-testid` `servico-opcao-<chave>`.
- **Lançado hoje:** as linhas confirmadas de hoje, na ordem do horário (fuso da fazenda), com a quantidade ("1.000 L", "8 h"). Vêm de `listarApontamentos` (a lista já traz as linhas) pela regra pura `lancamentosDoDia`. Sem linha, "Nada lançado ainda" (`servico-nada-lancado`). Sem R$.
- **Opções e "Encerrar serviço": "Em breve"** por enquanto. O corpo vira o painel `servico-em-breve`; o rodapé mostra "Voltar ao serviço" (`servico-voltar`). "Encerrar serviço" (`servico-encerrar`) fica no rodapé quando não há painel.

**Arquivos:** `src/components/lancamento-atividades/DiarioDasAtividades.jsx` (o passo `iniciado`, a consulta e a invalidação depois de "Iniciar serviço"), `src/lib/aberturaServicoRegras.js` (`lancamentosDoDia`), `src/styles/cadastro-base1.css` (`.b1-aberto-opcao*`, `.b1-aberto-secao`, `.b1-aberto-lancado*`, `.b1-aberto-painel`, `.b1-aberto-rodape-unico`).

**Testes:** `tests/smoke/aberturaServicoRegras.test.js` (`lancamentosDoDia`: só linhas confirmadas, hora no fuso, ordem, sem custo, hora de reserva) e `tests/smoke/diarioDasAtividades.test.jsx` (as 7 opções; "Nada lançado ainda"; "Lançado hoje" com um produto 07:45 e uma mão de obra 09:20, sem R$; o painel "Em breve" e o "Voltar"; "Encerrar serviço").

**Limites:** o "Abastecimento" da lista ainda não tem fonte (os abastecimentos não vêm no apontamento). As opções e o "Encerrar serviço" chegam nas próximas etapas.

## Emenda — correções da abertura (review Codex)

Três correções de P2 do review do PR #420 (a abertura do serviço; sem migration, sem mudar D-PROD-332):

1. **Plantio pede o capim.** No Plantio de pastagem, a tela 02 tem "Capim" (`abertura-capim`) depois do Responsável, obrigatório. As opções são as culturas ativas de pastagem/capineira (`listarCulturas`, `capinsDoCadastro`). O envio leva `plantio: { cultura_id }`, e só isso. Nos outros tipos o campo não aparece e `plantio` não vai. Trocar de tipo limpa o capim.
2. **Máquina da abertura no contrato, sem linha de uso.** `POST /atividades/registrar` aceita `bem_id` opcional: é o `bem_id` da atividade criada e não cria linha de uso. A ordem é `bem_id`, a 1ª linha de `maquinas[]` e, por fim, nulo. A validação é a do `abrirNa` (422 como antes). Sem `bem_id`, o fingerprint é byte a byte o de antes. A tela envia `bem_id` e a máquina na observação, mas não envia `maquinas`.
   - **Fallback** (o front chegou antes do backend): se o servidor recusar o campo desconhecido `bem_id`, a tela repete uma vez sem ele (`enviarAbertura` em `DiarioDasAtividades.jsx`; `ehCampoDesconhecido` em `aberturaServicoRegras.js`, via `lerErroGestao`). O `registrarCampo` compartilhado não muda.
   - **Limite:** até o backend novo ser publicado, a atividade nasce sem `bem_id`, e tipo com `exige_maquina` segue recusado (422).
3. **Todas as páginas das opções.** Máquinas, implementos e operadores são lidos com `lerTodasAsPaginas` (segue `next_cursor` enquanto `has_more`, até 40 páginas), e não só a 1ª de 50.

**Migration:** nenhuma. **Testes:** `aberturaServicoRegras.test.js` (capim, paginação, campo desconhecido), `diarioDasAtividades.test.jsx` (Capim só no Plantio, erro sem capim, `plantio` com o capim, `bem_id` sem `maquinas`, páginas, fallback e erro que não é o campo) e `backend/tests/atividadeRegistro.test.mjs` (3 casos novos: `bem_id` sem linha de uso, `bem_id` com `maquinas[]`, `bem_id` inexistente). Os de backend não rodaram aqui (`DATABASE_URL` não definida): ficam para o CI.

## Emenda — pasto com serviço antigo e máquina no envio (D-PROD-335)

Dois defeitos em produção, uma correção (sem migration, sem mudar o backend):

1. **Pasto com serviço em andamento sem abertura.** Os serviços do fluxo antigo (Gradagem, Combate à cigarrinha) não têm a linha de abertura na observação. O Diário abria direto no cabeçalho, com "Abertura não registrada", e não dava para iniciar nada. Agora, lida a abertura sem sucesso, o Diário vai ao formulário de abertura com o tipo e a operação do serviço já escolhidos, com a linha "Este pasto já tem o serviço <nome> em andamento, sem abertura. Preencha para iniciar.". Enquanto lê, aparece "Carregando…". Se a leitura falhar, segue como antes. "Iniciar serviço" reaproveita a atividade aberta (o servidor acha a do mesmo tipo e área).
2. **Máquina não gravada.** `bem_id` não estava na allowlist do registro de campo (`CAMPOS_DO_REGISTRO_DE_CAMPO`, em `lancamentoAtividadePort.js`), então a porta o descartava. Incluído, com comentário.

**Arquivos:** `src/components/lancamento-atividades/DiarioDasAtividades.jsx` (o passo "abrir" a partir do serviço existente, o "Carregando…", a ajuda e o rodapé enquanto lê), `src/apis/atividades/lancamentoAtividadePort.js` (`bem_id`).

**Testes:** `tests/smoke/diarioDasAtividades.test.jsx` (f2 e f3; 1; 3) e `tests/smoke/lancamentoAtividades.test.jsx` (LA-PORTA-BEM).

### Escolher atividade em andamento (mesma D-PROD-335)

Com atividades abertas no pasto, o Diário abre na lista "Em andamento neste pasto" (uma linha por atividade não concluída do resumo da área: nome, início, "Com abertura" ou "Sem abertura") com "Nova atividade". Tocar numa linha lê a atividade: com abertura, vai ao cabeçalho; sem ela, cai no formulário do defeito 1. Sem atividade aberta, o Diário abre no tipo, como antes. Do tipo, o Voltar volta à lista. O tipo com atividade aberta no pasto mostra "Já existe <nome> em andamento neste pasto: iniciar entra nela." (aviso).

**Limite:** o servidor reaproveita a atividade aberta do mesmo tipo e área, então "Nova atividade" do mesmo tipo não cria uma segunda. Uma segunda do mesmo tipo no pasto exige mudança de backend (decisão futura). Uma aberta parada há mais de 30 dias responde 409 `ATIVIDADE_SERVICO_PARADO`; o Diário só mostra a frase e não grava (a escolha fica na Nova realização).

**Arquivos da emenda:** `src/components/lancamento-atividades/DiarioDasAtividades.jsx` (o passo `escolher`, a linha `ItemAtividadeAberta`), `src/components/mapa/detalhes-area/AbaDetalhesDaArea.jsx` (abre sem ler; passa `atividadesAbertas` e `lerAtividade`), `src/styles/cadastro-base1.css` (duas regras: `.b1-aberto-opcoes--lista` e `.b1-aberto-chip--neutro`; sem seletor `.b1-realizacao`). **Testes:** `tests/smoke/diarioEmAndamentoNoPasto.test.jsx` e `tests/smoke/diarioFase2.test.jsx`.

## Fora desta parte

Encher implemento, Trocar pasto, Trocar implemento, Mais e Encerrar o dia; o "Diário da máquina" continua sendo o caminho do diário antigo (com o pasto, pela linha de ação).
