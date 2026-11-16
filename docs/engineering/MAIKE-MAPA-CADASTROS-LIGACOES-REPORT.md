FATIA: MAIKE-MAPA-CADASTROS-LIGACOES
BRANCH: fix/mapa-cadastros-ligacoes
PR: #305

# MAIKE-MAPA-CADASTROS-LIGACOES — Relatório

**Decisão:** [D-PROD-214](./DECISIONS.md) · **Base:** `origin/main` `83206ab5` (PR #302, D-PROD-213) · **Migration:** nenhuma

## 1. Pedido

O proprietário pediu uma verificação completa dos cadastros do mapa (pontos, áreas, linhas, cochos, depósitos, bebedouros), do cadastro em lote e das ligações entre áreas, pontos e lotes, porque "há vários bugs", e a correção do que fosse achado. Também pediu uma pausa nos lotes; por isso os bugs do lote e das movimentações ficaram só registrados (§6).

## 2. Como foi feito

1. **Leitura do banco de produção** (só `SELECT`): 107 áreas, 3 pontos de referência, 0 linhas, 0 bebedouros, 2 cochos/depósitos, 84 lotes (73 ativos). Nenhuma ligação órfã, nenhum nome em cache divergente. **Um defeito de dado:** `AreaPastagem.quantidade_atual`/`status_ocupacao` nunca são atualizados — 69 áreas com lote ativo aparecem "Disponível" com 0 cabeças.
2. **Varredura do código:** 8 frentes (áreas, pontos/linhas, suplementação, bebedouros, lotes, movimentações, orquestração das telas, contrato front↔back). Cada achado passou por **2 revisores céticos independentes**: 77 achados, **74 confirmados por 2/2**, 1 dividido, 2 refutados. Muitos repetidos entre frentes: ~30 problemas distintos.
3. **Correção:** 6 frentes com arquivos disjuntos. Cada frente passou por um revisor independente do diff, e as frentes aplicaram os 15 pontos que procediam.

## 3. O que foi corrigido

### Áreas

| Problema | Correção |
|---|---|
| Editar área com área pastejada decimal multiplicava o valor (10,5 → 105; "1.5" → 15) ou travava com "pastejada maior que a total" | `FormularioArea` abre o valor em pt-BR e lê com `lerHectaresDigitados` (`src/domain/areas/regrasCadastroArea.js`): milhar só com o padrão `1.500`, decimal com ponto ou vírgula |
| Área de Infraestrutura (curral, galpão…) abria sem o tipo e não salvava sem escolher de novo | O tipo vem de `tipo_pastagem` quando o uso é Infraestrutura (não há coluna própria) |
| "Reatribuir códigos" sempre dava 400 (a porta tirava `numero_area`; feito offline, travava a fila) | Rota nova `POST /areas-pastagem/renumerar` (transação, troca 1↔2 em duas fases sem colidir no unique, auditoria, sequência alinhada); só online; mensagens em português (`mensagemErroRenumeracao.js`) |
| Lote "Tipo de uso"/"Cultura" no Selecionar no mapa gravava combinações que o cadastro recusa (curral deixava de ser curral) | Regra pura `planejarLoteUsoCultura` (`src/domain/areas/loteUsoCulturaAreas.js`): grava só onde vale e diz quais ficaram de fora |
| Registro do Cadastro do Mapa: "Cancelar" não desfazia e o cabeçalho ficava com o nome antigo | `TelaCadastroMapa` remonta o formulário ao cancelar e relê o registro gravado |
| **Ocupação** (produção: 69 áreas com gado "Disponível"/0) | Servidor deriva `quantidade_atual` e `status_ocupacao` na leitura, numa consulta agregada, com a mesma fonte do mapa (PosicaoRebanho onde o ledger está ativo, Lote nos demais); o Mapa Geral colore pela mesma regra a partir dos lotes que ele mostra. Faixas: sem gado "Disponível"; UA/capacidade até 70% "Médio", até 110% "Alto", acima "Sobrepastoreado" |
| Renomear área ou setor não levava o nome a lotes, cochos, bebedouros, tarefas e movimentações | Propagação na mesma transação do PATCH, por id e por `cliente_id` do `auth_context` (`DEPENDENTES_NOME_AREA` em `propagationRules.js`; listas paralelas `area_vinculada_ids/nomes` reescritas posição a posição) |
| Exclusão de área olhava só as 500 movimentações mais recentes e ignorava bebedouros | Consulta filtrada pela área no servidor; bebedouro ativo ligado (`pasto_id`/`area_vinculada_ids`) bloqueia |

### Pontos, cochos, depósitos e bebedouros

| Problema | Correção |
|---|---|
| A ligação ponto ↔ cocho/depósito/bebedouro era por nome **ou sigla**: salvar um ponto inativava o cocho de outro; excluir um bebedouro apagava o cocho de mesmo nome; o formulário puxava áreas de outro registro | Regra única `src/domain/mapa/ligacaoPontoReferencia.js`: bebedouro **só** por `ponto_referencia_id`; cocho/depósito por empresa + categoria compatível com o tipo do ponto + nome, coordenadas só desempatam, sigla sozinha nunca liga; ambiguidade → nada é alterado |
| Excluir ponto apagava cocho/depósito **com histórico** (leituras sumiam em cascata), deixava bebedouro órfão e mostrava sucesso | Rotas `GET …/elegibilidade-exclusao` de cocho/depósito e bebedouro; com histórico a exclusão é bloqueada (409 `PONTO_SUPLEMENTACAO_COM_HISTORICO` / `BEBEDOURO_COM_HISTORICO`, e o DELETE do servidor recusa de novo); sem histórico sai junto; o local do depósito é **inativado** (D-PROD-137); falha no meio → `MAPA_PARTIAL_OPERATION`, nunca sucesso |
| `numero_ponto` do cocho/depósito era calculado no navegador só com os ativos da empresa e colidia com o unique do tenant (ponto ficava órfão; fila offline travava) | Número gerado no **servidor** pela sequência do tenant, com nova tentativa em colisão; local do depósito novo criado na mesma transação; ponto recém-criado é desfeito se o cocho/bebedouro falhar |
| Cadastro em lote de pontos do tipo Bebedouro não criava o Bebedouro | Cria com `ponto_referencia_id`, mesmo corpo do formulário (`payloadsPontoMapa.js`), com desfazer por item |
| Trocar o tipo do ponto (Bebedouro/Depósito → outro) deixava o registro antigo ativo | Com histórico, a troca é bloqueada; sem histórico, o registro antigo sai; bebedouro vira inativo preservando o histórico |
| Formulário de ponto novo zerava o que já tinha sido digitado quando as listas terminavam de carregar | Reset só quando o item muda |
| Renomear depósito pela tela Locais exigia Mapa Cadastro "editar" no ponto (nomes divergiam) | PATCH do ponto aceita só `nome` de quem tem Locais "editar", e só no ponto do próprio depósito |
| Ícones filtrados por empresa, mas gravados sem empresa (ponto virava círculo no editor e nas tarefas) | Ícone é configuração do tenant: `empresa_id` nulo vale para todas as empresas |

### Mapa Geral e telas

| Problema | Correção |
|---|---|
| Cadastrar, editar ou excluir no Cadastro do Mapa e voltar: o Mapa Geral mostrava o dado antigo por até 5 min | `invalidarCachesDoMapa` (`src/components/mapa/invalidarCachesMapa.js`) em todos os salvamentos/exclusões; marca só as chaves afetadas para a próxima leitura ir ao servidor (o IndexedDB e a janela de 60 s seguravam a cópia velha) |
| Clicar num bebedouro podia abrir outro (busca por "includes" de nome) e lançar no bebedouro errado | Só por `ponto_referencia_id` |
| Filtro por setor escondia todos os depósitos; filtros de uso/pastagem escondiam a área mas deixavam lotes, cochos e tarefas dela | Filtros de área valem para tudo o que está na área; depósito pelo próprio setor ou pelo cocho que abastece |
| "Situação do pasto" contava dias desde a entrada do lote na fazenda e escolhia o descanso pela ordem da lista | Dias desde o início da ocupação contínua **naquele pasto**; descanso pela saída mais recente por data |
| Editar o traçado de uma linha não recalculava o comprimento | Recalcula com a mesma conta da criação |
| Lançamento de cocho com muitas áreas: `area_nome` passava de 255 e dava 400 | Rótulo cabe em 255 ("PASTO A, PASTO B +10"); o evento guarda a lista completa |
| Transferência de depósito: data padrão em UTC (à noite gravava amanhã), locais inativos como destino, histórico não atualizava | Dia civil da fazenda (`hojeNoFuso`), sem data futura; inativos fora do destino; cache relido antes de invalidar |
| Alerta "Duração fora do esperado" lia campos que não existem | Validação morta removida (a faixa de frequência, se o produto quiser, é missão própria com migration) |
| Ficha do bebedouro: próxima limpeza/inspeção e último registro pela ordem de criação; excluir lançamento não atualizava a lista | Pela data do lançamento; exclusão invalida a lista |

## 4. Validação

Resultado na §7. Testes novos: `tests/smoke/g1AreasCadastroCorrecoes.test.jsx`, `g1SelecaoAreasMapaLote.test.jsx`, `g2FormularioPontoLigacoes.test.jsx`, `g2PontosLigacoesServico.test.js`, `g3CadastroInvalidaMapa.test.jsx`, `g3FormularioLinhaEPicker.test.jsx`, `g3MapaGeralDerivados.test.js`, `g3MapaGeralIntegrado.test.jsx`, `g4AreasRenumeracaoPorta.test.js`, `suplementacaoFormsG5.test.jsx`, `suplementacaoFormsG5Lancamento.test.jsx`, `bebedouroHistoricoPorData.test.jsx`; backend `backend/tests/g2PontosLigacoes.test.mjs`, `backend/tests/g4AreaPropagacaoOcupacao.test.mjs`. `tests/smoke/mapaService.test.js` atualizado para a exclusão nova (MC7–MC9).

## 5. Produção

- Sem migration, sem escrita no banco. Merge e deploy normais.
- A ocupação passa a aparecer certa sozinha (derivada na leitura); nada a corrigir nos dados.
- Ponto ligado a cocho/depósito com histórico deixa de poder ser excluído: para tirá-lo do mapa é preciso antes resolver o histórico (ou manter o ponto).

## 6. Registrado, não corrigido (pausa nos lotes)

Confirmados por 2/2 revisores, ficam para quando o proprietário retomar os lotes:

1. Switch "Ativo" do Cadastro de Lotes nunca grava (a porta descarta `estado_esperado` → `LOTE_ESTADO_CONFLITO`).
2. Lote criado com "Ativo" desligado fica preso (não reativa, não corrige, não exclui).
3. "Editar Informação" do lote no mapa trava em "Salvando…" em qualquer erro e renomeia sem histórico.
4. Mover: trocar a "Área de saída" no formulário não muda a origem real e fecha o consumo do cocho de outro pasto.
5. Mover: chave idempotente do diálogo vence a da pendência (reenviar impossível; "Descartar" pode duplicar).
6. Juntar Lotes: data padrão em UTC (à noite o servidor recusa com `REBANHO_DATA_FUTURA`).
7. Mudança de Categoria muda cabeças de posições que não estavam na tela.
8. Detalhes do Lote perde o histórico de pesagem depois de Mover/Mudar Categoria (alerta falso de "Pesagem atrasada").
9. Juntar Lotes oferecido para lotes que o servidor sempre recusa.
10. Recusas definitivas (`REBANHO_DATA_FUTURA` etc.) deixam pendência local presa.
11. Depois de Mover com fechamento de consumo, o mapa não relê os eventos de suplementação.
12. (dividido 1/2) Renomear o lote no mapa fora do ledger bloqueia a correção/exclusão da entrada no Cadastro.

Também ficou fora: fila offline que trava inteira num 4xx definitivo (`src/lib/offline/offlineEntityRuntime.js`, compartilhado por todas as telas) — merece missão própria.

## 7. Resultado da verificação

| Onde | Etapa | Resultado |
|---|---|---|
| Local | gates (`product-scope`, `import-integrity`, `source-closure`, `no-secrets`, `base44`, `tenancy`, `indices`, `rebanho-ssot`, `deploy-migrations`, …), `lint`, `build`, `build:admin` | passam |
| Local | `gate:types` | passa — dívida 481 → **479** (teto 625) |
| Local | `typecheck:backend` | passa (depois do ajuste de 2 anotações) |
| Local | `test:smoke` | 256 arquivos, **3.144/3.144** |
| CI `quality` (commit `ca93db7b`) | `verify:full` estático, smoke 1/2 e 2/2, backend 1/4 a 4/4, `verify:all` | **todos verdes** |

## 8. Correção pós-merge (2026-11-16) — depósito no lugar de outro ponto

- **Achado na conferência de produção (só leitura):** dois pontos "TESTE" de depósito (nº 1 e nº 4) e um único depósito `DEP-0001`, nas coordenadas do nº 4. O nº 1 é sobra de um cadastro que falhou antes desta missão. Pela regra da §3 (nome + categoria; coordenadas só desempatam), o nº 1 também "achava" o `DEP-0001`: a lista mostraria o depósito nos dois e excluir o nº 1 tentaria levar o depósito do nº 4.
- **Correção:** `resolverSuplementacaoDoPonto` recebe `outrosPontos`; cocho/depósito que está exatamente no lugar de OUTRO ponto ativo da mesma empresa e categoria (e não no lugar deste) pertence àquele ponto e não liga por nome. Lista do Cadastro de Pontos, formulário e exclusão passam a lista de pontos.
- **Testes:** `tests/smoke/ligacaoPontoLugarOcupado.test.js` (LO1–LO9, com as coordenadas reais); com a regra antiga, LO1, LO7 e LO8 falham.
- **Sem migration, sem dado alterado.** Depois do deploy, o ponto nº 1 pode ser excluído sozinho.
