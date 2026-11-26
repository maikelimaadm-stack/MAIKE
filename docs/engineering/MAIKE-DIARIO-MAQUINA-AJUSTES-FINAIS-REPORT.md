# MAIKE — Diário das atividades: ajustes finais e entrada "Abrir serviço" (relatório, D-PROD-325)

**Branch:** `feat/diario-ajustes-finais` (a partir da `main`, com o Diário da máquina da PR #406 já integrado).
**Decisão:** [D-PROD-325](./DECISIONS.md). **Migration:** nenhuma. **Banco remoto:** nada aplicado. **Commit/push:** não feitos.

## 1. O que mudou, por item

| # | Pedido | O que ficou | Onde |
|---|---|---|---|
| 1 | Abastecer dentro do diário | "Abastecer" em "Mais" abre a seção própria `SecaoAbastecer` (litros ou kg, horímetro; máquina do contexto; produto, tanque e local só quando há escolha). Grava pelo caminho da tela Abastecimentos: `previaDoAbastecimento` + `confirmarAbastecimento`, ligado ao lançamento de hoje. Rota ausente (404/405/501 sem `code`) cai no formulário antigo. | `DiarioSecoes.jsx` (`SecaoAbastecer`), `DiarioDaMaquina.jsx` (`gravarAbastecimento`), `src/apis/_core/nativeHttpClient.js` (marca `rotaAusente`), `src/lib/implementoRegras.js` (`ehFalhaDeRota`), `POST /atividades/:id/diario-dia` |
| 2 | Horímetro sempre salvo | Com transferência: no movimento da sobra. Sem transferência: trajeto novo `POST /atividades/:id/trajetos` (movimento TRANSFERENCIA de volume zero, só horímetros, sem estoque e sem mudar o pasto da mistura). O endpoint de sobra também guarda horímetro em DEVOLUCAO e PERDA. | `atividadeMisturaService.js` (`registrarTrajeto`, `registrarSobra`), `atividadeMisturaRoutes.js`, `DiarioDaMaquina.jsx` (`trocarPasto`) |
| 3 | Passo 2 sem lançamento do dia | `POST /atividades/:id/misturas/:misturaId/aplicar` acha ou cria o lançamento CONFIRMADO de hoje da área, na mesma transação (`lancarNaTransacao`, sem linhas). Idempotente. A PERDA sem `apontamento_id` usa o mesmo lançamento. A rota antiga com `apontamentoId` continua. | `atividadeMisturaService.js` (`garantirApontamentoDoDia`, `aplicarMisturaNoDia`, `executarAplicacao`), rotas, `DiarioSecoes.jsx` (`SecaoPasso2` sem o bloqueio "lance o dia") |
| 4 | Resumo na unidade certa | `volumes_aplicados: [{unidade, volume}]` por pasto e no total, em L e kg separados. Sai `volume_aplicado` (somava L com kg). A sobra mostra a unidade de cada mistura. | `atividadeMisturaService.js` (`resumoDoDia`, `volumesDoMapa`), `DiarioSecoes.jsx` (`SecaoResumo`) |

## 2. Defeitos achados e corrigidos no caminho

Os três abaixo já estavam na `main` (PR #406). Os smoke antigos não pegavam porque os fixtures tinham o formato errado.

1. **O diário nunca ligava com o servidor no ar.** `GET /misturas` respondia `{ misturas }`, mas a porta e o service liam `items`. Corrigido: o servidor responde `{ items }`.
2. **Nome do produto em branco no Passo 2 e no resumo.** A tela lia `produto.nome` e `p.nome`; o servidor manda `produto_nome`/`produto_unidade`. Corrigido em `implementoRegras.js` (helper único) e em `SecaoResumo`.
3. **Sobra sem horímetro era descartada em silêncio** em DEVOLUCAO e PERDA. Corrigido no backend.

## 3. Limites (o que não fica resolvido)

- **Trajeto sem nenhuma mistura na atividade é recusado** (`sem_mistura`). O movimento pede uma mistura (`mistura_id` NOT NULL). Guardar sem mistura exigiria migration; não foi feito.
- **Abastecimento sem a rota nova no servidor** cai no formulário antigo (a janela de sempre). Não há leitura de horímetro nova além da que o bem já dá.
- **Nada foi aplicado em produção.** A migration da D-PROD-323 já está lá; esta missão não cria schema novo. As rotas novas (`/trajetos`, `/diario-dia`, `/misturas/:id/aplicar`) só existem quando o servidor com esta branch for publicado.

## 4. Testes e verificações

- Backend `diarioMaquina.test.mjs` (PostgreSQL local de teste): **29/29** (eram 24; 5 novos: Passo 2 sem lançamento, idempotência, perda sem lançamento, trajeto e as três recusas, resumo L e kg com lista `items`). Os asserts de resumo passaram ao formato novo.
- Smoke do diário (`diarioMaquina`, `diarioMaquinaService`, `diarioFase2`, `implementoRegras`): verde. Novos: trajeto sem sobra (2 cenários), abastecer (caminho, validação, rota ausente, sem máquina), resumo L e kg, regras de trajeto e de falha de rota, `rotaAusente` no cliente HTTP.
- Gates (`npm run test:gates`): 1097/1097. Gates individuais que tocam o escopo, imports, segredos, Base44, tenancy, índices e tipos: verdes.
- `typecheck:backend`: sem erros. `typecheck:raw` (front): 369 erros na base atual, nenhum em arquivo desta missão (o baseline da `main` não foi medido isoladamente).
- Lint nos arquivos alterados: limpo.
- Suíte completa do smoke (`vitest run`): **367 arquivos, 4472/4472** (antes da missão: 4435/4435, sem os testes novos).

## 5. Entrada "Abrir serviço" e o fluxo do dia (missão de entrada, mesma PR)

Pedido: o fluxo de lançar com implemento estava confuso. Redesenho da ENTRADA e do fluxo do diário, sem wizard e sem popup
sobre popup (B1Janela 680px; tela cheia no celular; rodapé embaixo). Decisão: D-PROD-325 (`DECISIONS.md`).

### O fluxo, passo a passo

1. **Entrada única no pasto.** Mapa > detalhes da área > aba Manejos. "Iniciar atividade" saiu. Fica **"Diário das atividades"**
   (`data-testid` `area-diario-maquina`). O mesmo rótulo vale para o item do menu da linha e o da lista de atividades.
   O botão aparece com permissão de lançar e fuso da fazenda, com ou sem atividade em andamento no pasto.
2. **Abrir serviço: só para uma atividade NOVA (correção do fluxo).** O formulário aparece quando o pasto NÃO tem atividade em
   andamento; confirmar CRIA a atividade e abre o serviço no mesmo passo (um só `registrar`). Ele NÃO aparece dentro de uma
   atividade já em andamento. Os campos do formulário:
   - **Máquina** (obrigatória). Vem pré-selecionada a máquina da atividade.
   - **Responsável** (obrigatório). Vem pré-selecionado o de algum lançamento de hoje da atividade.
   - **Implemento** (opcional). Vem pré-selecionado o da última mistura.
   - **Hora de início**, padrão = agora no fuso da fazenda, editável.
   - **Operação**: só aparece quando o pasto NÃO tem atividade em andamento (sem ela não há atividade a abrir).
3. **O que "abrir" faz.** Grava a linha do serviço na observação do lançamento de hoje (ver "Onde o serviço fica"). Sem
   atividade: o mesmo `registrar` cria a atividade (com a operação escolhida) e o lançamento de hoje, num passo só. Depois
   disso a tela vai às ações do dia (o formulário não volta).
4. **Atividade em andamento: direto nas ações do dia, sem formulário.**
   - Com serviço aberto hoje: entra direto nele, sem pedir de novo. O serviço vale para a ATIVIDADE no dia (todas as áreas
     dela): trocar de pasto não pede máquina, responsável nem implemento outra vez.
   - Sem serviço aberto hoje (caso residual: atividade antiga, serviço apagado da observação, dia seguinte): também vai às
     ações do dia, com o aviso discreto "Sem serviço aberto hoje nesta atividade". Não reabre o formulário e não recria a
     atividade. O "Encerrar" só aparece com o serviço aberto.
5. **Cabeçalho do diário:** `máquina · responsável · implemento · desde HH:MM`, tudo do serviço aberto.
6. **Ações do dia**, sobre o serviço aberto:
   - **Lançar produto/mistura** (Passo 1): usa o implemento do serviço, sem perguntar de novo; a mistura já sai com ele.
   - **Aplicar no pasto** (Passo 2): aparece com a mistura aberta; a quantidade sugerida é o saldo; sobra como antes.
   - **Abastecer**: seção própria, no próprio diário (não fica mais dentro de "Mais").
   - **Trocar pasto (horímetro)**: como antes (sobra, horímetros, trajeto).
   - **Encerrar serviço**: grava a hora de fim (no fuso da fazenda) e leva ao **Resumo do dia**. "Fez o pasto todo? Sim" abre a
     conclusão da atividade, como antes.
   - **Mais**: Serviços, Mão de obra e Outros custos (este último abre o lançamento de hoje). Ficam para depois do serviço aberto.
   - **Resumo do dia**.
7. **Serviço encerrado:** o cabeçalho mostra `encerrado às HH:MM` e o "Encerrar" some. **"Abrir outro serviço hoje" saiu.** Motivo:
   com a atividade ainda ABERTA na área, o `registrar` do servidor junta o registro nela (`buscarAtividadeAberta`: operação e
   área em PLANEJADA ou EM_ANDAMENTO). Uma atividade nova só nasce se a atual estiver concluída ou PARADA há mais de 30 dias,
   e aí o `nova_atividade: true` CONCLUI as áreas da antiga. O diário não toma essa decisão sozinho. "Reabrir o mesmo serviço"
   sobrescreveria a hora de fim gravada, então também não foi feito. Não há botão no lugar.

### Onde o serviço fica (sem migration)

Não há coluna para máquina, implemento, hora de início ou de fim no banco. O serviço vai numa linha no INÍCIO da observação do
lançamento do dia, no formato `[diario-servico inicio=07:30 bem=<id> impl=<id> fim=17:05]`
(`src/lib/diarioServicoRegras.js`). O texto que o usuário escreveu depois da linha é preservado. O responsável é o
`operador_usuario_id` do lançamento. Nenhuma migration; nada aplicado em banco remoto.

Por que não outro campo existente: a linha de máquina do apontamento exige quantidade de uso positiva e medidor, então não
serve para registrar a abertura sem uso; a atividade tem `bem_id`, mas é a máquina da atividade, não do dia.

### Degradação

- O "Abrir serviço" usa só rotas que já existem (`GET …/apontamentos`, `POST /atividades/registrar`, `PATCH` do apontamento).
  Por isso abre também no servidor de produção.
- Passo 1, Passo 2, trocar pasto e abastecer seguem a degradação de sempre: sem as rotas novas, o aviso "Diário da máquina
  ainda não está ligado no servidor" e o "Lançamento de hoje".

### Limites

1. **O serviço é texto na observação.** Quem edita ou apaga a observação no "Lançamento de hoje" pode apagar a linha. Aí o
   diário mostra "sem serviço aberto" e deixa abrir outro. Não há busca por hora ou máquina no servidor.
2. **Quem só lança não edita apontamento.** Nesse caso, abrir e encerrar criam um lançamento de hoje SEM linhas (só com a linha
   do serviço). Esses lançamentos vazios aparecem na lista de lançamentos.
3. **Abrir de novo no mesmo dia** cria outra linha; o diário lê a mais nova.
4. **Listas de máquinas, responsáveis e implementos** são a primeira página das opções do servidor. O formulário não busca.
5. **Sem a rota nova**, o diário não mostra o cabeçalho do serviço (fica no aviso de degradação), mas o serviço já aberto
   continua gravado.
6. **Atividade em andamento sem serviço hoje (correção do fluxo).** O diário não abre o serviço do dia nessa atividade: vai às
   ações com o aviso, e o cabeçalho fica sem máquina e responsável naquele dia. Isso é a consequência de não reabrir o
   formulário ali, como pediu o dono. Uma entrada própria de "início de serviço" dentro da atividade aberta resolveria; fica
   para decisão própria.
7. **Sem "abrir outro serviço":** um segundo serviço no mesmo dia, na mesma atividade, não tem entrada própria.
8. **Solução que resolve 1, 2 e 6:** uma migration EXPAND com uma tabela de serviço do diário (`cliente_id`, `empresa_id`,
   `apontamento_id`, máquina, implemento, hora de início e de fim). Não foi feita: é o último caso, e o pedido era sem migration.

### Correção de tipo (achado no gate de tipos)

`gate:types` falhava por `rotaAusente` (criado no item 1 da PR) não existir no tipo `ApiError`. Corrigido com a tipagem do erro
local em `src/apis/_core/nativeHttpClient.js`. Sem mudança de comportamento.

### Testes desta missão

- `tests/smoke/diarioMaquina.test.jsx`: 27/27. Correção do fluxo: reescritos os testes que descreviam o fluxo antigo
  (formulário com atividade em andamento; "Abrir outro serviço"). Agora cobrem: formulário só sem atividade (com operação);
  validação dos erros; sem chute de máquina e responsável; atividade em andamento sem serviço vai às ações, sem formulário,
  com o aviso `diario-sem-servico`; criar atividade e serviço num passo, e o formulário sai da tela; serviço encerrado sem
  "Abrir outro"; Passo 1, Mais, Encerrar e cabeçalho inalterados. A base de mocks agora tem um serviço aberto no dia; o teste de
  abastecer reaproveita o lançamento de hoje (não chama `garantirDiaDoDiario`).
- `tests/smoke/diarioFase2.test.jsx`: a entrada única "Diário das atividades", com e sem atividade em andamento, e a
  ausência de "Iniciar atividade". O diário é trocado por um stub nesse arquivo.
- `tests/smoke/diarioServicoRegras.test.js` (novo): a linha do serviço (montar, ler, preservar o texto), o fim inválido, a hora
  no fuso (America/Cuiaba e UTC) e a validação do "Abrir serviço".
- `tests/smoke/mapaAtividadeAcoes.test.jsx`: o rótulo do menu da linha.
- Suíte completa do smoke (`vitest run`): **368 arquivos, 4496/4496** (antes desta missão: 367 e 4472).
- Typecheck (`tsc` no `jsconfig.typecheck.json`): 370 erros tanto no HEAD da branch quanto no estado atual, mesma lista.
  Nenhum erro novo em arquivo desta missão.
- `gate:types`: PASSOU (369 atuais, sem regressão). Antes falhava pelo `rotaAusente`.
- Gates `import-integrity`, `product-scope`, `no-secrets`, `base44`, `api-boundary`, `source-closure`, `governance-paths`: PASSOU.
- Lint (`eslint`) nos arquivos alterados: limpo.
- Backend: não mudou nesta missão.

### Como reverter

Nenhum passo destrutivo, nenhuma migration, nenhum dado mudou. Reverter é desfazer os commits desta branch.
