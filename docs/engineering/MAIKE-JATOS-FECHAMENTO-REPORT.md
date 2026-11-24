MAIKE-JATOS-FECHAMENTO (D-PROD-290, D-PROD-291, D-PROD-292) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR (a abrir)

# Relatório — o que faltava dos jatos: tipo existente, fechamento da área, várias máquinas e a linha avulsa

Pedido do proprietário (2026-11-24): "analise toda nossa conversa de ontem e veja o que falta para implantar" e "pode
começar a fazer tudo". A mistura fica manual (decisão do proprietário). Três decisões, um commit cada, uma PR só (uma
branch de trabalho; menos rodadas de CI). **Nenhuma migration.**

## D-PROD-290 — marcar "por jato" num tipo de implemento que já existe

Em produção nenhum tipo estava marcado "por jato" (só dava para marcar ao criar o tipo). Agora, em Bens › ⋯ ›
Gerenciar tipos, o tipo de **Implemento** tem **"Editar"** (os outros continuam "Renomear") com Usa produto?, Como
conta (Por jato), Capacidade do jato e Unidade. "Não" limpa a forma, a capacidade e a unidade. O servidor já aceitava
e conferia (D-PROD-279); a tela passou a mandar os campos no PATCH.

## D-PROD-291 — "Fez o pasto todo?" ao finalizar, o resumo por hectare e os jatos no dia salvo

- **Finalizar** (lista e mapa): por área em andamento, **"Sim, os 25 ha"** / **"Não, fiz só uma parte"** (+ "Quantos
  hectares fez?"); sem resposta, "Escolha se fez o pasto todo." e nada vai. Embaixo, **"Como ficou"**: jatos ("7 jatos
  em 3 dias"), horas de máquina, cada produto por hectare, custo total e custo por hectare (dos lançamentos
  confirmados). O botão diz "Finalizar atividade".
- **Servidor:** `POST /atividades/:id/concluir` aceita `areas: [{ atividade_area_id, hectares }]` (texto decimal; os
  hectares TOTAIS da área). O que falta entre os já lançados e os informados entra num **lançamento de fechamento** no
  dia da conclusão, sem linhas, só com os hectares e a observação "Fechamento: hectares informados ao finalizar", pelo
  caminho único de lançar (`lancarNaTransacao`), na mesma transação do concluir. Assim os totais, o andamento, o mapa e
  o custo por hectare continuam batendo sem mudar nenhuma conta. Informado **menor** que o lançado → 400
  `menor_que_lancado` (para menos, corrija os dias); igual → nada novo. Sem `areas`, o concluir de sempre. Sem migration.
- **Novo lançamento curto com implemento "por jato":** não pergunta os hectares do dia ("Os hectares são perguntados
  quando finalizar a área.").
- **Dia salvo:** o bloco Produtos mostra "3 jatos de 2.000 L · herbicida 34 L · adubo 24 kg" e cada linha "Jato N ·".

## D-PROD-292 — várias máquinas no Novo lançamento curto e o jato na linha avulsa

- **Várias máquinas:** com mais de uma máquina no último dia, "Máquina 1 de 2" e **"Próxima máquina"**: o horímetro
  de cada uma ali mesmo, uma depois da outra (antes, as outras só apareciam no "Mudar").
- **Linha avulsa de insumo** ("Adicionar produto" num dia salvo e "Aplicação de insumos" do mapa): com implemento "por
  jato" no dia (ou, sem máquina no dia, no último lançamento da atividade), o campo **"Jato nº"** (sugere o maior jato do
  dia). Editar troca o jato; em branco tira. As rotas de uma linha de produto aceitam `jato` (texto; `null` tira).

## Verificação

- Backend (PostgreSQL real): `atividadeFechamentoHectares.test.mjs` 4/4; `insumoPorJato.test.mjs` +1 (linha avulsa);
  com `atividadeLinhaProduto`: 27/27.
- Smoke: `fechamentoArea.test.jsx` (5), `jatosDoDia.test.jsx` (+2), `bensGerenciarTipos.test.jsx` (+1),
  `servicoVariosDias.test.jsx` (+1 e os ajustes: o diálogo agora lê o detalhe e os lançamentos), paridade das portas.
- `node scripts/gates/verify-all.mjs --pular=test:backend`: **TODAS AS ETAPAS PASSARAM** (smoke inteiro incluído).

## Fora

- Cadastro de mistura (o proprietário segue manual, com "Repetir o jato anterior").
- O cadastro do tipo "por jato" e a troca do tipo do pulverizador: é do proprietário (agora pelo "Editar" do tipo).
