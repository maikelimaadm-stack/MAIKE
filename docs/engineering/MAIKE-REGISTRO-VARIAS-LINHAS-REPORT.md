**Fatia:** várias linhas por seção no Registrar serviço · **Branch:** `claude/tipo-tarefa-drop-colunas-1aznvv` · **PR:** (a abrir)

**Decisão:** D-PROD-261 (fase 2 da D-PROD-258) · **Data:** 2026-11-19 · **Migration:** nenhuma · **Backend:** sem mudança

## 1. O que mudou

O "Registrar serviço" (Lançamento de Atividades e Manejos/Detalhes da área no mapa) aceita várias máquinas, insumos, pessoas e serviços num registro só. As seções seguem a maquete "Nova realização" do proprietário: tabelas + "Incluir".

| Seção | Colunas | Botão |
|---|---|---|
| Insumos | Insumo · Local de estoque · Dose/ha · Total | + Incluir insumo |
| Máquinas | Máquina · Implemento · Uso | + Incluir máquina |
| Equipe (antes "Mão de obra") | Pessoa · Medida · Quantidade | + Incluir pessoa |
| Serviço de terceiro (se houver) | Serviço · Prestador · Quantidade · Total | + Incluir serviço |

- A tabela só aparece com item. "+ Incluir …" abre um editor dentro da seção (um por seção, sem segunda janela) com os campos de sempre da linha. "Incluir" valida e o item vira linha; clicar na linha abre de novo ("Atualizar"); ✕ tira. O botão some no 20º item, o máximo do servidor.
- Salvar com um editor preenchido inclui o item antes; se ele não passar, nada sai. Editor vazio não conta. Vai um POST só, com os itens na ordem das tabelas.
- Recusa do servidor: a mensagem fica embaixo da linha certa, com marca vermelha, e o editor abre nela com o campo apontado.
- Operação antiga com "exige máquina": basta uma máquina na tabela. Sem nenhuma, o editor de máquina abre com "Escolha a máquina.".
- A Observação foi para a última seção, "Informações complementares". Hectares feitos e Operador ficaram onde estavam.
- No celular cada item vira um cartão (sem rolagem para o lado), com o mesmo Incluir e o mesmo editor.
- "Salvar e novo" grava e deixa as tabelas vazias.

## 2. Como funciona por dentro

- **Estado** (`RegistroDeCampo.jsx`): `itens` guarda, por seção, os itens já incluídos (cada um com uma `chave`); `editores` guarda no máximo um editor aberto por seção (formulário, erros e o salto pedido pelo servidor).
- **Ganchos:** `useMedidorDaLinha` e `useSaldoDoProduto` vivem só no editor aberto (`LinhasDoRegistro.jsx`). O editor conta ao registro o que leu (o medidor e se a justificativa é pedida; o disponível e o nome do local) por um `ref`, marcado com o `id` da abertura: um editor fechado nunca vale para o novo.
- **Regras:** as de sempre (`validarLinha*` e `corpoDaLinha*` de `atividadeLinhasRegras.js`), nenhuma copiada. A máquina guarda o medidor e a decisão da justificativa do "Incluir", e o corpo sai com `corpoDaLinhaMaquina(item.form, item.medidor, { comJustificativa })`. O insumo guarda o formulário; a dose/ha é recalculada pelos hectares de agora e o "Total" é a quantidade que sai do estoque (o custo é do servidor).
- **Recusa → linha:** cada envio guarda os itens na ordem de cada array enviado. `itemDaRecusa` (`registroDeCampoRegras.js`) usa `linhaEmbutidaRecusada` (`linha_indice` + `entidade`; no produto, `colecao` + `indice`) para achar o item. Sem índice, só quando não há dúvida: a única máquina no salto, ou o único item enviado. Sem resposta ou com envio pendente, nenhuma linha é marcada; "Repetir o mesmo envio" reenvia o mesmo corpo com a mesma chave.
- **Limite:** `LINHAS_NO_LANCAMENTO_MAXIMO = 20` em `atividadeLinhasRegras.js`, o mesmo do servidor (um teste compara com `backend/src/modules/atividades/atividadeComum.js`).
- **Desenho:** nada novo. Tabela das janelas do Base1 (`b1-tipo-tabela`), cartão do celular (`b1-tipo-card`), botão branco em pílula (`tb-btn`) com o ícone +. Só entraram duas regras de CSS para a marca do item em edição e do recusado.

## 3. Arquivos

| Arquivo | O quê |
|---|---|
| `src/components/lancamento-atividades/RegistroDeCampo.jsx` | estado das tabelas e dos editores, salvar com editor aberto, recusa na linha, Observação em "Informações complementares" |
| `src/components/lancamento-atividades/LinhasDoRegistro.jsx` (novo) | a seção (título, tabela ou cartões, "+ Incluir") e o editor com os campos da linha e os ganchos |
| `src/lib/registroDeCampoRegras.js` | peças puras: ordem das seções, formulário vazio, campo-chave, corpo das linhas, `itemDaRecusa`, mensagem da recusa |
| `src/lib/atividadeLinhasRegras.js` | `LINHAS_NO_LANCAMENTO_MAXIMO` |
| `src/styles/cadastro-base1.css` | marca do item em edição e do recusado (tabela e cartão) |
| `tests/smoke/registroDeCampoVariasLinhas.test.jsx` (novo) | os 16 testes da fatia |
| `tests/smoke/detalhesAreaHistorico.test.jsx`, `tests/smoke/lancamentoAtividades.test.jsx` | nomes e ordem novos das seções; os campos aparecem depois do "+ Incluir" |
| `docs/engineering/DECISIONS.md`, `CURRENT-STATE.md`, `MAIKE-ATIVIDADES-TIPOS-FIXOS-REPORT.md` | D-PROD-261, missão ativa, fase 2 marcada como feita |

## 4. Testes

**Novos** — `tests/smoke/registroDeCampoVariasLinhas.test.jsx` (16), com a janela, o service, a porta e o cliente HTTP reais e um backend falso só na rede:

- 2 insumos + 2 máquinas + 2 pessoas + 2 serviços → UM POST em `/atividades/registrar` com arrays de 2 na ordem das tabelas (corpo conferido inteiro), e o que cada tabela mostra;
- editor vazio não vai; editor preenchido entra sozinho ao salvar; preenchido e inválido segura o envio; "Incluir" sem o campo-chave aponta só ele;
- sem resposta, "Repetir o mesmo envio" manda o mesmo corpo com a mesma chave (gravado uma vez);
- editar (Atualizar no lugar, Cancelar não muda, outra linha não abre com o editor preenchido), remover (✕ renumera), dose/ha pelos hectares de agora, o "+ Incluir" some no 20º item;
- recusa com `linha_indice: 1` (máquinas, salto) na máquina 2 e com `colecao: 'produtos', indice: 1` no insumo 2 — com um editor vazio aberto na mesma seção, que não vai e não desloca o índice —, o editor aberto na linha recusada com o campo apontado e o reenvio corrigido; o mesmo para a pessoa;
- operação que exige máquina (uma basta), "Salvar e novo" esvazia as tabelas, celular em cartões, limite igual ao do servidor e `itemDaRecusa` puro.

**Atualizados** (mudança de tela pedida; nenhuma asserção de corpo nem de regra afrouxada):

- `detalhesAreaHistorico.test.jsx`: as quatro seções com os nomes e a ordem da maquete e "Informações complementares" por último; o teste do asterisco abre os quatro "+ Incluir" antes de olhar os campos.
- `lancamentoAtividades.test.jsx` (LA-REGISTRAR-3): os nomes novos das seções.

## 5. Validação

`node scripts/gates/verify-all.mjs --pular=test:backend` na árvore final: **todas as etapas PASS** (o `test:backend` roda em job próprio da CI; esta fatia não muda o backend).

- Fumaça: **301 arquivos, 3753 testes, 0 falhas** (16 novos neste arquivo).
- `gate:types`: sem regressão (374 diagnósticos atuais, teto 625); nenhum diagnóstico nos arquivos tocados.
- `lint`: 0 erros (2 avisos antigos em outros arquivos).
- Build de produção e do admin: PASS.

```
  ETAPA                RESULTADO   EXIT    DURAÇÃO  COMANDO
  test:gates           PASS           0      60.4s  npm run test:gates
  governance-paths     PASS           0      174ms  npm run gate:governance-paths
  package-sync         PASS           0      129ms  npm run gate:package-sync
  product-scope        PASS           0      449ms  npm run gate:product-scope
  api-boundary         PASS           0       2.1s  npm run gate:api-boundary
  native-api           PASS           0      188ms  npm run gate:native-api
  setor-native         PASS           0      207ms  npm run gate:setor-native
  marca-native         PASS           0      173ms  npm run gate:marca-native
  unidade-medida-native PASS           0      180ms  npm run gate:unidade-medida-native
  tarefa-cadastro-native PASS           0      145ms  npm run gate:tarefa-cadastro-native
  lote-native          PASS           0      166ms  npm run gate:lote-native
  lancamento-tarefa-native PASS           0      196ms  npm run gate:lancamento-tarefa-native
  p52-cadastros-estoque-native PASS           0      279ms  npm run gate:p52-cadastros-estoque-native
  p54-base44-exit      PASS           0      135ms  npm run gate:p54-base44-exit
  p55-base44-exit-final PASS           0      136ms  npm run gate:p55-base44-exit-final
  area-pastagem-native PASS           0      179ms  npm run gate:area-pastagem-native
  map-geography-native PASS           0      202ms  npm run gate:map-geography-native
  usuario-admin        PASS           0      126ms  npm run gate:usuario-admin
  source-closure       PASS           0      198ms  npm run gate:source-closure
  import-integrity     PASS           0      223ms  npm run gate:import-integrity
  admin-isolation      PASS           0      194ms  npm run gate:admin-isolation
  no-secrets           PASS           0       1.8s  npm run gate:no-secrets
  base44               PASS           0      171ms  npm run gate:base44
  modelobase1-pecuario PASS           0      130ms  npm run gate:modelobase1-pecuario
  motorbase1-independence PASS           0      628ms  npm run gate:motorbase1-independence
  tenancy              PASS           0      224ms  npm run gate:tenancy
  rebanho-ssot         PASS           0      168ms  npm run gate:rebanho-ssot
  indices              PASS           0      138ms  npm run gate:indices
  deploy-migrations    PASS           0      200ms  npm run gate:deploy-migrations
  supabase-public-grants PASS           0      131ms  npm run gate:supabase-public-grants
  prisma:generate      PASS           0       2.7s  npm run prisma:generate
  types                PASS           0      14.7s  npm run gate:types
  typecheck:backend    PASS           0      12.4s  npm run typecheck:backend
  lint                 PASS           0      23.5s  npm run lint
  test:smoke           PASS           0     235.6s  npm run test:smoke
  build                PASS           0      18.6s  npm run build
  build:admin          PASS           0       1.2s  npm run build:admin
  admin-isolation:bundles PASS           0      189ms  npm run gate:admin-isolation

  Total: 378.7s
  Puladas (rodam em outro job): test:backend

TODAS AS ETAPAS PASSARAM
```

## 6. Pendências e pontos para o proprietário

- O botão continua "Salvar e novo", como nas outras janelas. Se a maquete pede "Salvar e nova", é só trocar o texto.
- O "Total" do insumo mostra a quantidade (ex.: "44 L"). O custo do insumo é do servidor e não aparece na tela.
- Com um editor preenchido aberto, as outras linhas da mesma seção não abrem até "Incluir"/"Atualizar" ou "Cancelar", para não perder o que foi digitado.
- O "Repetir último lançamento" da atividade continua com os cartões de antes (fora desta fatia).
- Molde PROJETOMG: sem divergência (só frontend; o contrato do servidor não mudou).
