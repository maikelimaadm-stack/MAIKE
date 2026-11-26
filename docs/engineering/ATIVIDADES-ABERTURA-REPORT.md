# Diário das atividades, parte 1: abertura do serviço (D-PROD-330)

**Data:** 2026-11-26 · **Decisão:** [D-PROD-330](./DECISIONS.md) · **Branch:** `feat/atividades-abertura` · **Migration:** nenhuma · **Backend:** sem mudança

## O que a pessoa vê

Nos Detalhes da área (Manejos), um botão só: **Diário das atividades** (no lugar de "Iniciar atividade" e "Diário da máquina").

| Tela | O que tem |
|---|---|
| 01 · Nova atividade | Os 7 tipos fixos em cartões; "Preparo do solo" traz "Gradeação, calagem". Continuar só com um escolhido. |
| 02 · Nova atividade de <Tipo> | Máquina \*, Implemento (opcional, "— Sem implemento —"), Horímetro inicial \* (pt-BR, vem com a última leitura da máquina), Responsável \*. Com mais de uma operação do tipo, a Operação \* vem antes. "Iniciar serviço". |
| 03 · Diário das atividades | Cabeçalho verde do serviço aberto (tipo, Aberto, máquina, implemento, responsável, pasto, horímetro inicial) e o texto "… chegam nas próximas etapas". Só "Fechar". |

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

- `tests/smoke/aberturaServicoRegras.test.js`: 21 testes (marcador, leitura, horímetro, validação, apontamentos).
- `tests/smoke/diarioDasAtividades.test.jsx`: 8 testes. Cobrem os 7 cartões e o "Continuar", a ordem dos campos e a ausência de "Hora de início", a leitura da máquina no horímetro, os erros de validação, o envio com a abertura na observação e o cabeçalho, a abertura a partir de uma atividade existente, a ausência de cabeçalho sem abertura e a Operação obrigatória com duas operações.
- `tests/smoke/diarioFase2.test.jsx`: atualizado para o botão novo (9 testes).
- Vizinhos (mapa, diário da máquina, Base1): 92 testes passando no total com os acima.

## Fora desta parte

Encher implemento, Trocar pasto, Trocar implemento, Mais e Encerrar o dia; o "Diário da máquina" continua sendo o caminho do diário antigo (com o pasto, pela linha de ação).
