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

## Emenda — pasto com serviço antigo e máquina no envio (D-PROD-339)

Dois defeitos em produção, uma correção (sem migration, sem mudar o backend):

1. **Pasto com serviço em andamento sem abertura.** Os serviços do fluxo antigo (Gradagem, Combate à cigarrinha) não têm a linha de abertura na observação. O Diário abria direto no cabeçalho, com "Abertura não registrada", e não dava para iniciar nada. Agora, lida a abertura sem sucesso, o Diário vai ao formulário de abertura com o tipo e a operação do serviço já escolhidos, com a linha "Este pasto já tem o serviço <nome> em andamento, sem abertura. Preencha para iniciar.". Enquanto lê, aparece "Carregando…". Se a leitura falhar, segue como antes. "Iniciar serviço" reaproveita a atividade aberta (o servidor acha a do mesmo tipo e área).
2. **Máquina não gravada.** `bem_id` não estava na allowlist do registro de campo (`CAMPOS_DO_REGISTRO_DE_CAMPO`, em `lancamentoAtividadePort.js`), então a porta o descartava. Incluído, com comentário.

**Arquivos:** `src/components/lancamento-atividades/DiarioDasAtividades.jsx` (o passo "abrir" a partir do serviço existente, o "Carregando…", a ajuda e o rodapé enquanto lê), `src/apis/atividades/lancamentoAtividadePort.js` (`bem_id`).

**Testes:** `tests/smoke/diarioDasAtividades.test.jsx` (f2 e f3; 1; 3) e `tests/smoke/lancamentoAtividades.test.jsx` (LA-PORTA-BEM).

### Escolher atividade em andamento (mesma D-PROD-339)
> Desde a emenda das frentes, cada atividade aberta vira um cartão por frente (ver abaixo); o que segue descreve a lista inicial.

Com atividades abertas no pasto, o Diário abre na lista "Em andamento neste pasto" (uma linha por atividade não concluída do resumo da área: nome, início, "Com abertura" ou "Sem abertura") com "Nova atividade". Tocar numa linha lê a atividade: com abertura, vai ao cabeçalho; sem ela, cai no formulário do defeito 1. Sem atividade aberta, o Diário abre no tipo, como antes. Do tipo, o Voltar volta à lista. O tipo com atividade aberta no pasto mostra "Já existe <nome> em andamento neste pasto: iniciar entra nela." (aviso).

**Limite:** superado pelas frentes (abaixo): "Nova atividade" do mesmo tipo não cria uma segunda atividade; entra como mais uma frente da que existe. Uma aberta parada há mais de 30 dias responde 409 `ATIVIDADE_SERVICO_PARADO`; o Diário só mostra a frase e não grava (a escolha fica na Nova realização).

**Arquivos da emenda:** `src/components/lancamento-atividades/DiarioDasAtividades.jsx` (o passo `escolher`, a linha `ItemAtividadeAberta`), `src/components/mapa/detalhes-area/AbaDetalhesDaArea.jsx` (abre sem ler; passa `atividadesAbertas` e `lerAtividade`), `src/styles/cadastro-base1.css` (duas regras: `.b1-aberto-opcoes--lista` e `.b1-aberto-chip--neutro`; sem seletor `.b1-realizacao`). **Testes:** `tests/smoke/diarioEmAndamentoNoPasto.test.jsx` e `tests/smoke/diarioFase2.test.jsx`.

### Uma entrada só (pedido do dono, mesma D-PROD-339)

Os Detalhes da área tinham três entradas de diário. Ficou uma: o "Diário das atividades" (`DiarioDoPasto`, que é o `DiarioDasAtividades` com a lista do pasto).

- **Religadas:** a pílula "Manejos" do rodapé (`DetalhesArea.jsx`) abre o Diário das atividades, com a permissão de lançar de sempre; a ação de linha "Diário da máquina" das atividades em andamento (`AcoesDaAtividadeDaArea.jsx`) virou "Diário das atividades" e abre o diário nessa atividade (com abertura, no cabeçalho do serviço; sem ela, no formulário de abertura).
- **Removida:** o botão verde "Diário das atividades" do topo da aba Manejos (`AbaDetalhesDaArea.jsx`), com o estado e o código que só ele usava.
- **Continua na página Lançamento de Atividades:** a "Nova realização" (`RegistroDeCampo.jsx`), com o arquivo inteiro. Os Detalhes da área deixaram de abrir a "Nova realização" pela pílula. A ação de linha "+ Lançamento" continua abrindo a "Nova realização" presa à atividade (D-PROD-278). (A página deixou de usar o "Diário da máquina": ver "Organização das entradas" abaixo.)
- **Testes:** `tests/smoke/diarioFase2.test.jsx` (a aba sem o botão; o `DiarioDoPasto` com a lista e a leitura no toque), `tests/smoke/detalhesAreaHistorico.test.jsx` (a pílula Manejos abre o diário: no tipo sem atividade aberta, na lista com uma), `tests/smoke/mapaAtividadeAcoes.test.jsx` (o rótulo "Diário das atividades" no menu e o toque que abre o diário nessa atividade). Os testes da "Nova realização" pela pílula saíram do `detalhesAreaHistorico`, porque essa ligação não existe mais; a janela continua coberta pelos testes do `RegistroDeCampo`.

### Organização das entradas (pedido do dono, mesma D-PROD-339)

Entradas finais do diário (o mesmo `DiarioDoPasto` nas três):

1. **Pílula "Manejos" do rodapé da área** (Detalhes da área): sem atividade escolhida; lista "Em andamento neste pasto" ou, sem atividade aberta, o tipo.
2. **Ação de linha "Diário das atividades"** da atividade em andamento na área (⚡ na aba Manejos): com a atividade escolhida.
3. **Ação de linha "Diário das atividades"** na página Lançamento de Atividades (⚡ de atividade ABERTA com pasto em andamento; abre no primeiro pasto em andamento). A página lê a atividade e, ao gravar, relê a própria lista (`aoGravar`).

**Religado:** a ação "Diário da máquina" da página virou "Diário das atividades" (`diarioItem` e `abrirDiario` em `src/pages/LancamentoAtividades.jsx`). **Removido da página:** o import e o uso de `DiarioDaMaquina`. Não há mais "Diário da máquina" em menu nenhum.

**Removido (código sem uso, exigido pelo gate `source-closure`):** `DiarioDaMaquina.jsx`, `DiarioSecoes.jsx`, `implementoRegras.js`, `diarioMaquinaService.js` e os testes deles. **Não apagado:** o backend (rotas do diário da máquina), as tabelas e os dados.

**Sobrou e por quê:**
- A "Nova realização" (`RegistroDeCampo`), na página (criar, e os cartões dos 7 tipos) e nos Detalhes da área ("+ Lançamento" e "Só <tipo>"). É o lançamento completo por área e tipo (máquina, mão de obra, insumo e serviço). O diário ainda não cobre isso: no serviço aberto, "Encerrar serviço" e as outras opções seguem "Em breve".
- "Planejar" e "Nova atividade" na página: planejamento, não registro de campo.
- A pílula "Manejos" e a ação de linha da área abrem o mesmo diário, cada uma com o seu caminho. Ficam as duas porque a lista do dono as nomeia. Se o dono quiser uma só, a ação de linha de `AcoesDaAtividadeDaArea.jsx` sai numa linha. É decisão dele.
- "Iniciar serviço" é o botão de dentro do diário, não uma entrada. "Iniciar atividade" não existe mais no código.

**Limite conhecido:** o `DiarioDoPasto` mostra o tamanho do pasto no subtítulo só se a área da atividade trouxer `tamanho_hectares`. A lista da página (`areas[].area`) não traz esse campo nos dados de teste, então ali o subtítulo sai só com o nome.

### Uma abertura por máquina + implemento (frentes, mesma D-PROD-339)

Vários tratores e implementos trabalham no mesmo pasto, no mesmo tipo, ao mesmo tempo. Cada um tem o seu serviço aberto, com a sua abertura, lançado separado.

- **Decisão:** uma atividade por pasto e tipo; cada serviço é uma **frente**, isto é, os apontamentos dessa atividade cuja linha de abertura tem a mesma chave `bemId|implementoId` (implemento vazio vale como chave própria). Sem backend e sem migration: `chaveDaFrente`, `frentesDosApontamentos` e `apontamentosDaFrente` em `src/lib/aberturaServicoRegras.js`.
- **No Diário:** a lista "Em andamento neste pasto" mostra um cartão por frente (máquina + implemento, "Responsável: …", início, e a atividade embaixo). Tocar abre só aquela frente: o cabeçalho, o "Lançado hoje" e a carga usam só os apontamentos dela, e a numeração da carga e o "apontamento de hoje" são por frente. A carga que cria o apontamento do dia leva a linha de abertura da frente na observação (`CargaDeInsumo`, prop `observacaoDoApontamento`), então o dia seguinte continua na frente certa.
- **"Nova atividade" do mesmo tipo** com outra máquina ou implemento envia `registrarCampo` normalmente e o aviso diz que o serviço entra como mais uma frente.
- **Trava:** a mesma máquina com o mesmo implemento não abre uma segunda frente no pasto. Não envia, o botão "Iniciar serviço" fica desabilitado e a ajuda diz para tocar no serviço na lista. Antes do envio, a conferência lê as atividades abertas do tipo (o cache serve quando há).
- **Como casa com o modelo futuro:** uma atividade por área e tipo, com várias frentes dentro, cada uma com a sua abertura, horímetro, responsável, insumo e encerramento. A frente já é a unidade que o modelo vai guardar; hoje a chave mora na observação do apontamento, depois terá registro próprio.
- **Limites:** "Encerrar serviço" ainda é "Em breve", então uma frente aberta não fecha. Frentes não aparecem fora do Diário: o Lançamento de Atividades continua vendo uma atividade só. Apontamentos de dias anteriores gravados antes desta emenda (sem a linha de abertura) não entram em frente nenhuma.

**Revisão do Codex (PR #426, P1):** continuar uma atividade sem abertura, com mais de uma atividade aberta do mesmo tipo no pasto, deixava o servidor escolher a mais recente, e a abertura podia cair em outra. Agora não envia (aviso e botão desabilitado): conclua uma delas e tente de novo.

**Testes:** `tests/smoke/aberturaServicoRegras.test.js` (frentes), `tests/smoke/diarioEmAndamentoNoPasto.test.jsx` (b, c, e, f, f2, g, g2), `tests/smoke/diarioDasAtividades.test.jsx` (carga por frente, d1 e d2).

## Fora desta parte

Encher implemento, Trocar pasto, Trocar implemento, Mais e Encerrar o dia; o "Diário da máquina" (`DiarioDaMaquina`) saiu dos Detalhes da área e da página Lançamento de Atividades; o código da tela antiga foi removido (sem uso).
