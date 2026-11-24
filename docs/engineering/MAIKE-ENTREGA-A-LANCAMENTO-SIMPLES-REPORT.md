MAIKE-ENTREGA-A (D-PROD-281) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR (a abrir)

# Relatório — Entrega A: lançamento simples para quem está no campo

> A missão foi pedida como **D-PROD-280**. `node scripts/dev/proxima-decisao.mjs` na `main` `def1cda2` mostrou que a
> D-PROD-280 está reservada pela PR #367 (Detalhes do Lote v13). Esta entrega é a **D-PROD-281**; o marcador passa a D-PROD-282.

## O que mudou

### 1. Nomes (só texto de tela)

| Antes | Agora |
|---|---|
| "+ Nova realização" / "Nova realização de …" | **"+ Nova atividade"** / **"Nova atividade de …"** |
| "+ Lançar dia" | **"+ Lançamento"** (janela **"Novo lançamento"**) |
| "Concluir" (atividade) | **"Finalizar"** (diálogo "Finalizar atividade"; menus "Finalizar atividade") |
| Situação "Concluída" | **"Finalizada"** |
| "Como fica depois de salvar?" (Em andamento / Concluída) | **"Finalizou a atividade hoje?"** ("Sim, finalizei" / "Não, continua") |
| "100%, falta concluir" | **"Tudo feito · falta finalizar"** |
| Título do planejar de um serviço ("Abrir atividade") | **"Planejar atividade"** |

No mapa (Detalhes da área), "Só máquina / Só mão de obra / Só insumo / Só serviço de terceiro" ficam; "+ Lançar dia" →
"+ Lançamento" e "Concluir" → "Finalizar". Os avisos de sucesso dizem "Atividade nº N finalizada.". Códigos internos,
status (`CONCLUIDA`…) e campos da API não mudaram.

### 2. "Atividades em andamento" no topo da lista

`src/components/lancamento-atividades/AtividadesEmAndamento.jsx`: um card por atividade em andamento entre as linhas
carregadas (o `andamento` do servidor): operação, área ou local, capim do plantio, a barra e
"10 de 40 ha · falta 30 · último dia ontem" (sem área: o local e a quantidade feita, D-PROD-274). Botões
**"+ Lançamento"** (verde) e **"Finalizar"**, com as mesmas regras de permissão da linha (`podeLancarDia`,
`podeConcluirServico`); aos 100% só "Finalizar". 1 / 2 / 3 cards por linha (celular / ≥768px / ≥1200px). A grade, os
filtros e o cartão do celular continuam embaixo, como estavam.

### 3. "Novo lançamento" curto

O `continuar` do `RegistroDeCampo` abre curto (`registro-de-campo-curto`):

1. "Já feito 12 de 40 ha · falta 28".
2. **"Quantos hectares fez hoje?"**, opcional, com "Com isso fica 16 de 40 ha" ou "pode deixar em branco e informar
   quando finalizar". Em branco, o corpo leva `area_id` sem hectares.
3. **Dia** (hoje).
4. A máquina do último dia com o uso (ver Horímetro).
5. **"Vai junto, igual ao último dia"**: resumo só leitura e **"Mudar"**, que mostra o formulário inteiro de sempre com
   tudo o que foi digitado.
6. **"Finalizou a atividade hoje?"** sem nada marcado; sem escolha, nada sai.
7. Cancelar / Salvar (sem "Salvar e novo").

Sem área (Manutenção e Outros pelo local): quantidade feita e unidade no lugar dos hectares. Com várias áreas em aberto:
a tabela das áreas (hectares obrigatórios em cada uma, regra do servidor para `areas[]`). Um erro que só o formulário
inteiro mostra (reforma a escolher, pessoa sem quantidade) abre o "Mudar" sozinho.

A pessoa do último dia agora vem **com a quantidade** ("igual ao último dia") e entra direto na tabela; insumos e
serviços de terceiro continuam não vindo (D-PROD-267).

### 4. Horímetro

Só na janela do registro (`horimetroSimples` em `CamposDaLinhaMaquina`): com medidor `HORIMETRO`, só
**"Horímetro agora"**; a inicial é a leitura vigente (o `useMedidorDaLinha` já a sugeria, nada duplicado); a dica
"última hora lançada: 1.244 · hoje dá 8 horas". **"Horímetro quebrado?"** → **"Horas corridas de trabalho"**
(`sem_medidor` + `quantidade_uso`, o caminho de sempre); **"Voltar a usar o horímetro"** volta. Sem leitura anterior,
"Horímetro no começo" ainda aparece. Salto do medidor e justificativa sem mudança. As janelas "Só máquina" e o odômetro
ficam como estavam.

## Vários lançamentos no mesmo dia

Conferido, **nenhuma mudança**: o único unique do dia em `AtividadeApontamento` é
`(cliente_id, atividade_id, data_operacional, turno, sequencia)` e a `sequencia` é máx + 1; o `POST /atividades/registrar`
só deduplica pelo `operation_id` (recibo), e o cliente gera chave nova a cada envio respondido. Teste novo
`backend/tests/atividadeRegistroMesmoDia.test.mjs` (Postgres real): manhã na A, tarde na B, volta à A → dois
apontamentos na mesma atividade, sequências 1 e 2; reenvio com a mesma chave → `replay: true`, nada duplicado; e o
lançamento sem hectares (`area_id` sem `area_executada_dia`) entra.

## Verificação

- `node --test backend/tests/atividadeRegistroMesmoDia.test.mjs` contra `maike_va2` (76 migrations): 2/2.
- Smoke: os arquivos tocados e a suíte inteira (ver o commit).
- `node scripts/gates/verify-all.mjs --pular=test:backend`: TODAS AS ETAPAS PASSARAM.

## Fora desta entrega

- Título "Finalizadas" acima da grade (a grade segue com o filtro de situação).
- Levar insumos e serviços de terceiro do último dia.
- Com várias máquinas no último dia, o curto mostra o uso da primeira; as outras ficam no "Mudar" (o resumo avisa).
- Nenhuma migration; nenhuma mudança no servidor.
