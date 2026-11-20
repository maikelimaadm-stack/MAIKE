**Fatia:** várias áreas no Registrar serviço · **Branch:** `claude/tipo-tarefa-drop-colunas-1aznvv` · **PR:** (a abrir)

**Decisão:** D-PROD-263 (fase 3 da D-PROD-258) · **Data:** 2026-11-20 · **Migration:** nenhuma

## 1. O que mudou

Um "Registrar serviço" agora cobre vários pastos, cada um com os seus hectares (maquete "Nova realização").

- **Campo "Áreas":** lista com busca e caixas ("2 áreas selecionadas"), o mesmo campo da abertura da atividade.
- **Tabela das áreas:** Área · Tamanho (ha) · % · Hectares (ha) · ✕, com a linha **Total** (soma do tamanho e dos hectares). A área entra com 100% do tamanho. Digitar o % muda os hectares e vice-versa (% = hectares ÷ tamanho × 100). Área sem tamanho: o % fica desligado e os hectares são digitados. No celular, um cartão por área.
- **"Hectares feitos"** saiu de "Resultado"; o Operador ficou.
- **Insumos:** a Dose/ha e o Total usam os hectares TOTAIS do registro.
- **Destino:** conta com as várias áreas ("Entra em X; PASTO Y entra nela", aviso de área já concluída nela, ou "Nova atividade será criada: Tipo · Área 1 +N · mmm/aa").
- **Aberta do mapa** (Detalhes da área → Manejos): a área vem marcada e não sai (sem ✕, caixa travada); outras podem entrar. A janela lê as áreas da fazenda.
- **Recusa do servidor:** quando é de uma área, a mensagem diz "Na área …:" e vai para a linha certa (insumo, máquina, pessoa ou serviço) ou para embaixo da área na tabela.

## 2. Como funciona no servidor (`POST /atividades/registrar`)

**Corpo.** `areas: [{ area_id, hectares }]` (1 a 20, área sem repetir, hectares texto decimal > 0) no lugar de `area_id`. Os dois juntos, nenhum, ou `areas[]` com `area_executada_dia` → 400. Corpo fechado, sem coerção, tenant só da sessão. `areas[]` de UM item é o `area_id` de sempre: mesma busca, mesmo nome e o MESMO fingerprint do recibo (o reenvio de um no formato do outro é replay).

**Qual atividade.**
1. Trava consultiva por (cliente, fazenda, tipo, área, mês) para CADA área, em ordem de `area_id`: registros com áreas em comum se enfileiram, sem deadlock.
2. A busca de sempre (aberta, mesmo tipo e fazenda, início no mês, área PLANEJADA ou EM_ANDAMENTO) tenta as áreas na ordem do corpo; a primeira que casa dá a atividade.
3. Área que falta nela entra (`adicionarAreaNaTransacao`, extraída do "Adicionar área") e é iniciada no dia; área PLANEJADA é iniciada (`iniciarAreaNaTransacao`). Área CONCLUIDA nunca casa; se ela já está na atividade achada, o lançamento dela é recusado (409 com a área).
4. Sem nenhuma, cria UMA atividade com todas as áreas (`abrirNa` com `areas[]`, cada uma iniciada no dia), nome `<Tipo> · <Área 1> +N · <mmm/aa>` (N = as outras áreas), dentro de `NOME_MAXIMO`.
5. Um apontamento por área, pela mesma função de sempre (`lancarNaTransacao`), tudo numa transação. Operador, observação e turno em todos; o `area_executada_dia` de cada um são os hectares da área.

**Rateio** (`atividadeRegistroRateio.js`, conta pura). O cliente manda os totais; a área i leva hᵢ ÷ Σh.
- Insumo, mão de obra, serviço e uso de máquina sem medidor: 4 casas, meio para cima; a última área leva o resto e as partes somam exatamente o total. Custo unitário igual; o total de cada parte segue a regra de sempre da linha. Cada parte de insumo passa pelo motor de estoque.
- Máquina com medidor: o intervalo [inicial, final] vira trechos seguidos na ordem das áreas (a 1ª começa na inicial, cada uma começa onde a anterior terminou, a última termina na final). Várias passadas do mesmo bem são uma série só, para o medidor nunca andar para trás entre um apontamento e o próximo. Sem leitura inicial no corpo, vale a vigente na data (`leituraVigenteDoBem`, a mesma regra da linha, sob a trava do bem). Implemento, justificativa e observação são copiados.
- Parte que fica em zero não vira linha: vai para a área de mais hectares.
- Linha que a regra vai recusar (sem uso nem leitura, leitura inicial desconhecida, final abaixo da inicial) vai inteira para a 1ª área, e a recusa é a de sempre.

**Idempotência.** Um `operation_id` para o registro (recibo `atividade_registrar_v1`). A área i grava as linhas com a chave `<operation_id>` (i = 0) ou `<operation_id>:a<i+1>`, de onde saem as das linhas como sempre (`:p1`, `:o1`, `:s1`; até 128 caracteres). O recibo confere as chaves derivadas de todas as áreas. Reenvio igual → 200 replay com os mesmos apontamentos; corpo diferente → 409.

**Resposta.** A forma de sempre (o apontamento da 1ª área, a atividade depois de tudo, os alertas, `registro`) mais `apontamentos[]` (um por área) e `registro.areas[]` (área, área da atividade, apontamento, hectares, adicionada, iniciada). A recusa de uma área leva `details.area_id` e `details.area_indice`, e a linha na posição do CORPO (`indice` do insumo, `linha_indice` dos outros).

## 3. Arquivos

| Arquivo | O quê |
|---|---|
| `backend/src/modules/atividades/atividadeRegistroService.js` | `areas[]`, travas por área, busca na ordem do corpo, áreas que entram/iniciam, abertura com várias áreas, um apontamento por área, recusa com a área, resposta |
| `backend/src/modules/atividades/atividadeRegistroRateio.js` (novo) | partes pelos hectares e trechos do medidor |
| `backend/src/modules/atividades/atividadeRegistroRoutes.js` | schema de `areas[]` (fechado) e anti-coerção de `hectares` |
| `backend/src/modules/atividades/atividadeAreaService.js` | `adicionarAreaNaTransacao` (extraída de "Adicionar área") |
| `backend/src/modules/atividades/atividadeApontamentoMaquinaService.js` | `leituraVigenteDoBem` (a mesma regra da linha, extraída) |
| `backend/src/modules/atividades/atividadeApontamentoService.js` | o recibo confere as chaves derivadas de várias bases |
| `src/components/lancamento-atividades/AreasDoRegistro.jsx` (novo) | campo "Áreas" e tabela/cartões com %, hectares e Total |
| `src/components/lancamento-atividades/SeletorAreasDaAtividade.jsx` | o campo de marcar áreas virou `CampoDeAreasParaMarcar`, usado pela abertura e pelo registro |
| `src/components/lancamento-atividades/RegistroDeCampo.jsx` | as áreas no lugar da área única, sem "Hectares feitos", destino, corpo, recusa por área |
| `src/lib/registroDeCampoRegras.js` | regras puras: % ↔ hectares, erros, corpo, totais, destino, área da recusa |
| `src/lib/lancamentoAtividadesRegras.js` | frases da área concluída/não iniciada e de `areas[n].area_id` |
| `src/apis/atividades/*`, `src/services/lancamentoAtividadesService.js` | `areas[]` no corpo, `apontamentos[]` na resposta, alvo da pendência com as áreas |

## 4. Verificação

- Backend (PostgreSQL 16 local, 183 arquivos): **2.504 testes, 2.495 passam, 3 falham, 6 todo**. Os 3 que falham são do `transporteNativo.test.mjs` (P4B, CORS no app real) e falham igual na `main` limpa (`5261ec13`), no mesmo ambiente: não são desta fatia. Novos: `atividadeRegistroVariasAreas.test.mjs` (17); `atividadeRegistro.test.mjs` (20) sem mudança e verde.
- `verify-all --pular=test:backend`: todas as etapas passam (testes dos gates 1.045/1.045, smoke 3.765/3.765 em 302 arquivos, tipos sem regressão, build).
- Smoke: `registroDeCampoVariasAreas.test.jsx` (10 testes novos). Atualizados onde a tela mudou de propósito: `registroDeCampoVariasLinhas`, `detalhesAreaHistorico` e `lancamentoAtividades` (o corpo leva `areas[]`; as asserções do corpo ficaram iguais ou mais fortes, com `area_id` e `area_executada_dia` ausentes).
- Visual: janela de verdade em Chromium, desktop 1440×900 e celular 390×844, com PASTO DA AROEIRA (38 ha, 100%) e PASTO DO AÇUDE (27,3 ha, 60% = 16,38 ha): tabela, Total, destino, dose/ha pelo total (54,38 ha), recusa na linha certa e a área presa do mapa. Sem rolagem lateral.

## 5. Fica em aberto

- Cancelar o apontamento de uma área cancela só ele (e estorna só a parte dele); os das outras áreas ficam. Cada um é um lançamento.
- Editar os hectares de um apontamento depois não reparte de novo as linhas já gravadas (refaz só a dose/ha dele, como sempre).
- Área já CONCLUIDA na atividade achada é recusada; reabrir sozinha seria mudar a regra da área.
- O `valor_total` do serviço não vem no corpo (é calculado), então não há total digitado a repartir.
