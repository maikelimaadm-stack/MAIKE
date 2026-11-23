MAIKE-MAPA-ATIVIDADE-ACOES (D-PROD-278) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR (a abrir)

# MAIKE — Ações da atividade em andamento nos Detalhes da área (Mapa)

Decisão: [D-PROD-278](./DECISIONS.md).

## Problema
No Lançamento de Atividades, o serviço em andamento tem as ações rápidas ("+ Lançar dia", o lançamento
de um tipo só e "Concluir"). No Mapa, "Detalhes da área" → "Atividades em andamento" mostrava a mesma
atividade, mas tocar nela não fazia nada: a pessoa tinha de refazer tudo pela "Nova realização".

## O que mudou
- **Linha tocável** (`src/components/mapa/detalhes-area/AbaDetalhesDaArea.jsx`): com permissão, a
  linha da atividade vira o gatilho do menu das ações da linha (`B1MenuAcoesDaLinha`, o mesmo do ⚡ da
  lista: janela presa à linha no computador, folha de baixo no celular). Sem nenhuma ação permitida, a
  linha continua como antes (só leitura).
- **Ações** (`src/components/mapa/detalhes-area/AcoesDaAtividadeDaArea.jsx`, hook
  `useAcoesDaAtividadeDaArea`):
  - **+ Lançar dia**: `JanelaRegistroDeCampo` com `continuar` (a mesma da lista);
  - **Só máquina / Só mão de obra / Só insumo / Só serviço de terceiro**: `JanelaLancamentoPorTipo`
    presa NESTA área (a área da atividade cuja área do mapa é a dos detalhes); só os tipos que a
    operação permite e só com a área em andamento na atividade;
  - **Concluir**: `DialogoConcluirServico` (`POST /atividades/:id/concluir` com a versão lida), só
    com dia lançado na área.
- **Permissões**: as da lista (`acoesDaAtividade` + fuso da fazenda): lançar pede
  `lancarApontamento`, concluir pede `editar`.
- **Dados**: ao escolher a ação, lê-se o detalhe (`GET /atividades/:id`) e, da lista filtrada pela área
  e pelas abertas, o `andamento`. Depois de gravar, o resumo da área (atividades e custos) e as
  consultas da tela de atividades se relêem.
- **Peças compartilhadas, mínimas**: `B1MenuAcoesDaLinha` ganhou o `gatilho` opcional; a `Linha` dos
  detalhes aceita `ref`; `lancamentosPermitidos(flags)` em `JanelaLancamentoPorTipo.jsx`. A tela de
  atividades não mudou.

## Fora
- **Abrir atividade**: a tela de atividades não abre uma atividade pelo endereço; não se criou rota.
- Servidor, migration e escopo (`config/mapa-manejo-scope.json`) sem mudança.

## Verificação
- `tests/smoke/mapaAtividadeAcoes.test.jsx` (6): menu com os itens permitidos pela operação; área
  planejada só com "+ Lançar dia"; "+ Lançar dia" abre a janela preenchida (`continuar` com o
  `andamento`); "Só máquina" abre a janela presa na área; "Concluir" com a versão do detalhe relê o
  resumo; sem permissão, a linha não é tocável.
- Os smoke tests que tocam os Detalhes da área, o Detalhes do Lote (`blocos`), o menu da linha e o
  Lançamento de Atividades (40 arquivos, 637 testes) passaram.
- `node scripts/gates/verify-all.mjs --pular=test:backend`: TODAS AS ETAPAS PASSARAM.
