# MAIKE-PATRIMONIO-UX-02 — Abastecimento orientado pelo Produto associado ao combustível

Decisão: **D-PROD-160** ([`DECISIONS.md`](./DECISIONS.md)). A branch nasceu sobre `origin/main` `e3ea4c39c5557c85a9f1f130a9c540af7e70f133` (merge da PR #235, Patrimônio P1-02); a `main` atual, `c4070d0d` (merge da PR #236, tipografia Base1), entrou na branch pelo merge `f72308fa`.
Branch: `claude/maike-patrimonio-ux-02-abastecimento-produto` · PR [#237](https://github.com/maikelimaadm-stack/MAIKE/pull/237) (**DRAFT**) · código verificado: commit `f72308fa` (merge da `main` `c4070d0d`, PR #236 de tipografia Base1, sobre `4e2fb07e`); o commit final da PR só completa este relatório (docs, nenhum código).

> **Sem schema, sem migration, sem deploy.** `backend/prisma/schema.prisma` e as migrations não mudam: repositório e produção continuam com 39 migrations e 85 tabelas. Nenhuma API mutativa muda (corpos e respostas de prévia, confirmação, cancelamento, vínculo e fator iguais aos da P1-02). Todos os testes rodaram em PostgreSQL 16 **local e descartável** (socket `/tmp`, porta 5433, um banco por frente). Nada foi executado em Supabase, Vercel ou outro ambiente remoto. A PR fica em **DRAFT** até a revisão humana.

## 1. O que muda e o que fica igual

**Muda** (pedido do proprietário, que prevalece sobre a UX da P1-02):
- **Combustíveis** é onde cada fazenda associa os seus Produtos ao combustível, no próprio cadastro e na edição, vários de uma vez, inclusive ao criar o combustível.
- **Novo abastecimento** pede a máquina ou o veículo e, em seguida, o **Produto** pelo nome real. O tipo de combustível (ex.: "Diesel S10") deixa de ser etapa e rótulo do formulário. O servidor deriva o tipo, os tanques e o fator dos vínculos ativos.
- A troca do Produto associado vale para os **próximos** abastecimentos, sem editar o bem e sem reescrever o histórico.

**Fica igual:** o cadastro do bem e dos tanques (`TanquesBem.jsx`: combustíveis permitidos por tanque, flex = vários); o motor de estoque, FIFO, custo, medidor, estorno, RLS, travas e concorrência; os serviços mutativos do backend (`abastecimentoService.js`, `abastecimentoPlano.js`, `combustivelProdutoService.js`, `conversaoCombustivelService.js`, `tipoCombustivelService.js`); as permissões (nenhuma ação nova); `config/mapa-manejo-scope.json` (nenhuma página nova).

## 2. ANTES → DEPOIS

| Tela / fluxo | ANTES (P1-02) | DEPOIS (UX-02) |
|---|---|---|
| Combustíveis — novo cadastro | código, nome, unidade e descrição; nenhum Produto; a associação só existia depois, no registro gravado | os mesmos campos + seção **"Produtos associados nesta fazenda"** ("Fazenda: <nome>"): escolher 1..N Produtos antes de salvar. Salvar cria o combustível e associa cada Produto pelos endpoints existentes, com resultado explícito: todos associados → "Combustível criado com <n> produto(s) associado(s) nesta fazenda"; alguma falha → aviso (nunca sucesso) e "Não associados" com "Tentar de novo". Antes do POST a tela confere o código: se o combustível já existe (ativo ou inativo), nada é criado nem associado. Sem fazenda: aviso, o combustível é salvo sem Produtos |
| Combustíveis — registro gravado | "Produtos vinculados nesta fazenda", "Vincular produto" um por vez, lista única de ativos e inativos | "Produtos associados nesta fazenda" · "Fazenda: <nome>"; grupos **Associados (n)**, **Inativos (n)** e **Disponíveis** ("Associar produtos", vários de uma vez); "Inativar associação"/"Reativar associação" com o texto do efeito só no futuro; "Tentar de novo" não descarta os Produtos escolhidos no painel |
| Combustíveis — edição | a seção saía da tela | a seção continua e grava na hora, com o aviso "As associações são gravadas na hora, independentemente do botão Salvar." |
| Combustíveis — troca de fazenda | a seção era relida | no cadastro novo, os Produtos escolhidos saem com aviso; se a fazenda muda durante o salvar, o combustível é criado e nenhum Produto é associado (aviso, nunca sucesso); se o topo muda **durante a associação**, os vínculos ficam na fazenda de origem e o aviso a nomeia; uma falha de associação em andamento não se perde quando a seção remonta, e o aviso diz em que fazenda e registro ver "Não associados"; no registro aberto, só a fazenda nova aparece |
| Bem / tanques | combustíveis permitidos por tanque | **igual**. Trocar o Produto associado não toca o bem nem `TanqueBemCombustivel` |
| Novo abastecimento — escolha | Bem → Tanque → **Combustível** → Produto → Local | **Máquina/Veículo → Produto** (nome real). Uma opção completa: já vem marcada. 2..6: botões. Mais de 6 ou `has_more`: seletor paginado com busca no servidor. Nenhuma: aviso pelo motivo do servidor. Escolher de novo a mesma máquina mantém o Produto único marcado |
| Tanque | sempre escolhido | "Qual tanque será abastecido?" só quando o Produto é aceito em mais de um tanque ativo |
| Local do estoque | seletor | "Sai do estoque: <local>" com um só local com saldo; "De qual local do estoque?" com vários (só o nome, sem kg nem lotes); "Sem saldo deste Produto nesta fazenda." com nenhum |
| Demais campos | data, litros, leitura, tanque cheio, observação e referência; estimativa de kg e custo no formulário | data (hoje da fazenda), litros, medidor (se houver), **"Completou o tanque?"** Sim/Não com explicação; observação e referência em "Mais detalhes"; kg e fator só na revisão |
| Produto sem fator | bloqueio só na prévia | rótulo "<nome> (sem fator kg/L)", aviso próprio separado do de associação e "Configurar fator kg/L" (só com `configurar_conversao`) |
| Revisão | "Pré-visualizar", dados técnicos misturados ao resumo | **"Revisar abastecimento"**: resumo humano e "Baixa no estoque: X kg"; **"Detalhes do estoque"** recolhido (tipo de combustível, tanque, fator e versão, custo estimado, saldo, FIFO). Mudar um campo invalida a revisão. Bloqueio na revisão por vínculo, Produto, tanque ou unidade incompatível ou inativo relê os Produtos do bem, e o Produto que saiu não fica marcado |
| Confirmação (API) | `tanque_id`, `tipo_combustivel_id`, `produto_id`, `conversao_id/versao` | **corpo idêntico**; os IDs vêm da opção do servidor, nunca de mapa no front nem de nome |
| Lista (desktop) | Nº, Data, Bem, Tanque, **Combustível**, Produto, Litros, KG, Custo, Leitura, Situação (`colunas_abastecimentos_v1`) | **Data, Máquina/Veículo, Produto, Litros, Medidor, Situação**; opcionais desligados: Nº, Tanque, KG, Custo, Tanque cheio, Referência; "Combustível" removida (`colunas_abastecimentos_v2`). Ordem padrão: **Nº decrescente**, a mesma da paginação do servidor (`createdAt desc`); clicar em Data continua ordenando por data |
| Lista (tablet, 820 px) | — | larguras mínimas Data 101, Máquina/Veículo 124, Produto 130, Litros 97, Medidor 100, Situação 103 = **655 px**, priorizando Produto e Situação: as 6 colunas cabem na área visível da grade. No E2E, antes dessa correção, a grade media 896 px para 712 px úteis e a Situação ficava escondida |
| Lista (celular) | cards com Nº, data, litros, KG, situação e produto | cards com Máquina/Veículo, Produto, Litros, Data e Situação, sem rolagem horizontal |
| Consulta | "Combustível" ao lado do Produto | Produto primeiro; "Tipo de combustível (classificação)"; nenhum dado saiu do detalhe |
| Troca A→B | o formulário pedia o tipo; a troca não tinha fluxo próprio | trocar a associação em Combustíveis → o próximo abastecimento oferece B (depois do fator de B); o histórico de A fica intacto; a confirmação com a opção velha recebe 422 e a tela relê e avisa "O Produto escolhido deixou de estar disponível para este bem. Escolha de novo." |

## 3. Fluxos

### 3.1 Cadastro de Combustíveis com Produtos

```mermaid
flowchart TD
  A["Novo combustível: código, nome, unidade"] --> B["Escolher Produtos desta fazenda (A associar)"]
  B --> P["Conferir o código na lista (ativos e inativos)"]
  P -->|já existe| P1["Já existe um combustível com este código: nada criado nem associado"]
  P -->|"não existe ou leitura sem resposta"| C["Salvar: POST /patrimonio-combustiveis"]
  C -->|201| E["Para cada Produto, em sequência: POST /patrimonio-combustiveis/:id/produtos"]
  C -->|resposta perdida| D["Localizar pelo código"]
  D -->|"achou: não existia na conferência, mesmo nome, ativo"| E
  D -->|não achou| D1["O combustível não foi gravado. Salve de novo."]
  D -->|"achou outro (outro nome ou inativo)"| D3["Já existe: nada criado nem associado"]
  D -->|"leitura falhou ou conferência sem resposta"| D2["Confira a lista antes de salvar de novo: o código não se repete"]
  E -->|201| F["associado"]
  E -->|409 ja_vinculado| G["reler os ativos"]
  E -->|resposta perdida| G
  G -->|ativo| F
  G -->|não ativo| H["falha"]
  E -->|outro erro| H
  F --> R{"todos associados?"}
  H --> R
  R -->|sim| S["Sucesso: criado com n produto(s) associado(s)"]
  R -->|não| W["Aviso, nunca sucesso: Não associados (f)"]
  W --> T["Tentar de novo: só as falhas, para o MESMO combustível"]
  T --> E
```

### 3.2 Novo abastecimento por Produto

```mermaid
flowchart TD
  M["Máquina/Veículo"] --> Q["GET /patrimonio-abastecimentos-opcoes/produtos-do-bem (1a página sem q, limit 100)"]
  Q --> Z{"resumo.total"}
  Z -->|0| Z0["Aviso pelo motivo: associar no cadastro de Combustíveis, ajustar o bem ou a unidade"]
  Z -->|maior que 0| K{"resposta completa?"}
  K -->|"1 item e has_more false"| P1["Produto já marcado"]
  K -->|"2 a 6 itens"| P2["Botões com o nome do Produto"]
  K -->|"mais de 6 ou has_more"| P3["Seletor paginado com busca"]
  P1 --> F{"pronto?"}
  P2 --> F
  P3 --> F
  F -->|não| F0["Configure o fator kg/L deste Produto nesta fazenda"]
  F -->|sim| T{"tanques do Produto"}
  T -->|1| L["Local: GET opcoes/locais"]
  T -->|mais de 1| T2["Qual tanque será abastecido?"] --> L
  L -->|1 com saldo| L1["Sai do estoque: local"]
  L -->|vários| L2["De qual local do estoque?"]
  L -->|nenhum| L0["Sem saldo deste Produto nesta fazenda"]
  L1 --> D["Data, Litros, Medidor, Completou o tanque?"]
  L2 --> D
  D --> V["Revisar abastecimento: POST /patrimonio-abastecimentos-previa"]
  V --> C["Confirmar: POST /patrimonio-abastecimentos com os IDs da opção e operation_id estável"]
```

### 3.3 Troca A→B e histórico

```mermaid
sequenceDiagram
  participant Adm as Responsável (Combustíveis)
  participant Op as Operador (Abastecimentos)
  participant API as Servidor
  Op->>API: confirma X_A com o Produto A (fator A)
  API-->>Op: 201 X_A (Produto A, kg, custo e fatias de A)
  Adm->>API: PATCH vínculo (Diesel S10, A) ativo false
  Adm->>API: POST vínculo (Diesel S10, B)
  Note over API: o bem e TanqueBemCombustivel não mudam
  Op->>API: GET produtos-do-bem
  API-->>Op: B com conversao null e pronto false (o fator de A não vale para B)
  Adm->>API: POST fator kg/L do par (Diesel S10, B)
  Op->>API: confirma X_B com a opção B
  API-->>Op: 201 X_B (Produto B, fator B, fatias só nos lotes de B)
  Op->>API: confirmação com a opção velha A
  API-->>Op: 422 COMBUSTIVEL_PRODUTO_INVALIDO sem_vinculo_ativo, nada gravado
  Op->>API: detalhe de X_A
  API-->>Op: Produto A, fator A, kg, custo e fatias da época
  Op->>API: cancelar X_A
  API-->>Op: 200, lotes de A restaurados (ou 409 produto_mudou_de_fazenda), nunca B
```

## 4. Backend: uma rota nova, só de leitura (A16)

**Por que uma rota nova.** A tela precisa dos Produtos já filtrados por todo o caminho bem → tanques ativos → combustíveis permitidos (ativos, em L) → vínculo ativo na empresa → Produto ativo da empresa em KG → fator vigente, com o tipo derivado **no servidor**. As rotas existentes não serviam: `opcoes/tanques` + `opcoes/produtos?tipo_combustivel_id` exigiriam que o front escolhesse o tipo (a UX proibida) e N chamadas; `GET /bens-patrimoniais/:id/produtos-elegiveis` (P1-01) tem a guarda de Bens (quem só tem Abastecimentos levaria 403), não pagina, não traz fator e não filtra KG. Separar "falta associar", "falta fator" e "unidade ≠ KG" exige um resumo sobre o conjunto inteiro.

**Contrato.** `GET /patrimonio-abastecimentos-opcoes/produtos-do-bem?empresa_id&bem_id[&q][&cursor][&limit]`, `onRequest: [app.autenticar]`, `preHandler: [GUARDAS.patrimonioAbastecimentos.ver]`, query fechada (`q` ≤ 120, `cursor` ≤ 2200, `limit` 1..100, padrão 50). Resposta `{ bem, itens, has_more, next_cursor, resumo }`:
- `bem` = o mesmo objeto de `opcoes/tanques` (A8), com a leitura vigente; a resposta de A8 continua idêntica (o helper comum foi extraído e A8 conferido por `deepEqual`).
- Cada item: `id` = `produto.id`, `produto {id, nome, codigo_interno, unidade_principal_estoque}`, `tipo_combustivel {id, codigo, nome}`, `conversao {id, versao, sequencia, kg_por_litro}` (6 casas, texto) ou `null`, `tanques[]` (ordem identificador, id; capacidade em 4 casas), `bloqueios` ⊆ `['sem_fator']`, `pronto`. Ordem (nome, id), keyset.
- `resumo` (ignora `q` e `cursor`): `total`, `sem_fator`, `fora_de_kg`, `tipos_sem_produto [{id, nome}]`, `motivo_sem_opcao` ∈ `null | bem_inativo | sem_tanque_ativo | tanque_sem_combustivel | nenhum_produto_associado | produto_unidade_nao_kg`, não nulo ⇔ `total = 0`.
- Sem preço, saldo, custo ou lote.
- Erros: 401 `TENANT_CONTEXT_REQUIRED`; 403 `ACAO_NAO_PERMITIDA`; 400 `REQUEST_VALIDATION_FAILED` (sem `empresa_id`/`bem_id`, chave extra como `cliente_id`, `tipo_combustivel_id` ou `uso`, `limit` fora de 1..100); 400 `cursor_invalido`; empresa fora do tenant → o mesmo erro de A8; 404 `BEM_PATRIMONIAL_NAO_ENCONTRADO` com o **mesmo corpo** para bem inexistente, de outra fazenda e de outro tenant (sem oráculo).

**Implementação** (`backend/src/modules/patrimonio/abastecimentoOpcoesService.js`, `opcoesProdutosDoBem`):
- **Instantâneo único:** `emTransacao` RepeatableRead read-only (`maxWait` 2 s, `timeout` 9 s), sem `FOR …` nem trava consultiva — o padrão de leitura da prévia. Resumo e página saem do mesmo snapshot.
- `Produto.empresa_id = empresa` no próprio filtro (vínculo incoerente, de produto movido, nunca entra).
- Fator casado pelo **par exato** `(tipo, produto)`.
- Invariantes fail-closed (500 genérico, nunca resposta errada): mais de um vínculo ativo do mesmo Produto na empresa; Produto da página sem vínculo ativo de tipo aceito.
- Nenhum `Number` em quantidade ou fator.

**Rota** (`backend/src/modules/patrimonio/abastecimentoRoutes.js:203`), schema `OPCOES(['empresa_id','bem_id'], { bem_id: ID })`. Nenhuma outra rota mudou; a tela passa a 16 rotas, todas classe **a** ([cobertura](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md), com os números de linha revistos).

## 5. Frontend

**Combustíveis** (`src/components/patrimonio/{CatalogoPatrimonioTela,FormularioCombustivel,ProdutosDoCombustivel,ProdutosNovoCombustivel}.jsx`, `src/services/combustivelProdutoService.js`):
- `associarProdutosAoCombustivel` (sequencial, nunca lança, resultado por Produto), `confirmarVinculoAtivo` (relê os ativos, até 20 páginas × 100), `buscarCombustivelPorCodigo` (conferência antes do POST, ativos e inativos; já existe → nada é criado nem associado) e `localizarCombustivelCriado` (na resposta perdida, só dá como criado o que não existia na conferência, com o mesmo nome sem caixa e ativo).
- Na criação, o POST do combustível sai com o corpo de sempre (`criarCatalogo` descarta `produtos_pendentes`); famílias, tipos e perfis não mudam.
- Falha nunca vira sucesso, inclusive parcial; "Tentar de novo" repete só as falhas, para o mesmo combustível, e não descarta os Produtos escolhidos no painel; repetir nunca recria o combustível.
- Os "Não associados" ficam guardados por fazenda e combustível na tela (o pai aplica o resultado de cada lote): uma falha em andamento não se perde quando a seção remonta. Se o topo muda de fazenda durante a associação, o aviso nomeia a fazenda de origem e diz em que fazenda e registro ver "Não associados".
- Textos "associado/associação" no lugar de "vinculado"; `mensagemErroPatrimonio` (mensagens de erro do servidor) não foi alterada.

**Abastecimento** (`src/components/patrimonio/{FormularioAbastecimento,AbastecimentosTela,DialogosAbastecimento,ConsultaAbastecimento,TabelaAbastecimentos}.jsx`, `src/lib/abastecimentoRegras.js`, `src/lib/patrimonioErros.js` só na seção Abastecimentos, `src/services/abastecimentoService.js`, `src/apis/patrimonio/{patrimonioApi,patrimonioNativePort}.js`):
- Regras puras novas: `opcaoNoFormulario`, `produtoAutomatico`, `situacaoDaEscolha`, `tanqueDoFormulario`, `formatarLitrosCurto`. `formularioVazio`, `montarCorpo*`, `assinaturaDoFormulario`, `estimarKg`, `kgDaBaixaNaPrevia` e `conferirRespostaAbastecimento` inalterados (o INT-1 os importa).
- Auto-seleção só por `produtoAutomatico` (bem da resposta = bem do formulário, `has_more = false`, 1 item, consulta sem `q`); a resposta de outro bem nunca é usada; resposta completa sem a escolha → limpa e avisa, sem reescolher sozinho. Escolher de novo a mesma máquina mantém o Produto único marcado.
- Bloqueio na revisão por vínculo, Produto, tanque ou unidade incompatível ou inativo relê os Produtos do bem; o Produto que saiu não fica marcado.
- Lista: ordem padrão Nº decrescente, igual à paginação do servidor (`createdAt desc`); larguras mínimas do tablet 101/124/130/97/100/103 = 655 px, priorizando Produto e Situação (`tests/smoke/patrimonioUx02ListaOrdem.test.jsx`).
- `listOpcoesAbastecimento('produtos-do-bem')` exige `bem_id` e tem ramo próprio, que preserva `bem` e `resumo` (a paginação genérica descartava chaves extras).
- Link "Abrir Combustíveis" só com `criar` em `pat-combustiveis`; "Configurar fator kg/L" só com `configurar_conversao`.
- `sem_vinculo_ativo` → "O Produto não está mais associado ao combustível deste bem (cadastro de Combustíveis). Escolha o Produto de novo."

## 6. Matriz de cenários (missão, linha 68)

Arquivos: **PB** = `backend/tests/patrimonioUx02ProdutosDoBem.test.mjs`; **TA** = `backend/tests/patrimonioUx02TrocaAssociacao.test.mjs`; **S** = `backend/tests/patrimonioP1AbastecimentosSeguranca.test.mjs`; **AB/C** = `backend/tests/patrimonioP1Abastecimentos.test.mjs` / `…Concorrencia.test.mjs`; **INT-1** = `backend/tests/patrimonioP1AbastecimentosContratoTela.test.mjs`; **CB** = `tests/smoke/patrimonioUx02Combustiveis.test.jsx`; **UX-A** = `tests/smoke/patrimonioUx02Abastecimento.test.jsx`; **Regras** = `tests/smoke/abastecimentoRegras.test.js`; **FE** = `tests/smoke/patrimonioAbastecimentos.test.jsx`; **LO** = `tests/smoke/patrimonioUx02ListaOrdem.test.jsx`; **E2E-1** = `scripts/dev/e2e-abastecimentos-real.mjs`; **E2E-2** = `scripts/dev/e2e-abastecimentos-ux02-real.mjs` (aceite humano). "Registrado" = resultado anotado pela frente que escreveu o teste, antes das correções da revisão final. **No commit de código `f72308fa`**, todos os arquivos de backend da tabela passaram no `test:backend` completo (1499 testes, 0 fail) e todos os de smoke no `test:smoke` completo (181 arquivos, 2312/2312), ambos dentro do `verify:all` 40/40 (§8). No E2E-2 os Produtos do ensaio são A = "Diesel", B = "Diesel S10 Estoque Novo" e RETIRO = "Diesel Retiro".

| # | Caso da missão | Teste(s) | Status |
|---|---|---|---|
| 1 | Vínculos criados no cadastro de Combustíveis | CB-02 (2 POST exatos, vários de uma vez), CB-03 (novo combustível + 2 Produtos: 1 POST do combustível com o corpo de sempre + 2 POST de vínculo com o id novo); regressão `patrimonioP1CombustivelProduto` (API do vínculo); PB-05 (combustível novo sem Produto) | registrado PASS (CB 24/24; `patrimonioP1CombustivelProduto` 20/20; PB 14/14) · pela tela real: E2E-2 PASS — cadastra `DIESEL_S10` "Diesel S10" escolhendo o Produto na seção "Produtos associados nesta fazenda", com o aviso "Combustível criado com 1 produto(s) associado(s) nesta fazenda" |
| 2 | … inclusive falha parcial recuperável | CB-04 (2: 409 `COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO` no 2º → nunca sucesso, "Não associados (1)", "Tentar de novo" só ele ao MESMO combustível, combustível postado 1 vez; "Descartar"), CB-05 (4: resposta perdida gravada / não gravada / `ja_vinculado` / service nunca lança), CB-06 (3: criação incerta gravada, não gravada, conferência falha), CB-09 (403 na associação da criação); revisão final: conferência do código antes do POST, falha em andamento que sobrevive à remontagem da seção, "Tentar de novo" sem descartar os Produtos do painel (RED→GREEN, §8) | registrado PASS (24/24); mutação "sucesso mesmo com falha" + "incerto = associado" derruba 4/24 · final: PASS no `test:smoke` do `f72308fa` |
| 3 | Troca da fazenda | CB-07 (3: cadastro novo, troca durante o salvar, registro aberto), CB-01 (nada da outra fazenda); PB-08 (mesmo S10 nas duas fazendas, bem da E1 pedido na E2 → 404, vínculo incoerente excluído); TA-02b (a troca A→B na Fazenda 1 não muda o vínculo da Fazenda 2); revisão final: aviso nomeia a fazenda de origem quando o topo muda durante a associação | registrado PASS · TA-02b PASS (17/17) · pela tela real: E2E-2 PASS — a troca de fazenda mostra só os Produtos da fazenda (Retiro vazio; "Diesel Retiro" só lá) |
| 4 | Inativação/reativação | CB-12 (textos e PATCH exatos; histórico listado), CB-10 (combustível inativo); PB-07 (vínculo, produto, fator, tipo, tanque e bem, sem editar o bem); TA-07 (reativar A com B ativo) | registrado PASS (CB, PB) · TA PASS (17/17, nota A→B) |
| 5 | Vários Produtos por combustível | PB-04 (2 Produtos, um sem fator), PB-10; TA-07 (A e B ativos, sem auto-seleção, cada um com o seu fator); UX-A02 (2 Produtos: nenhum marcado), UX-A03 (2..6 botões; mais de 6 → seletor) | registrado PASS |
| 6 | Multi-tanque/flex | PB-02 (flex Gasolina+Etanol), PB-03 (A+B ativos, C inativo; tanques de combustíveis diferentes; A4 no Tanque B); UX-A04 (2); UX-A05 (flex, Gasolina sem fator); TA-07b (multi-tanque A→B: cada opção traz só o seu tanque); TA-08 (gerador S10+S500); INT-1 (flex escolhido pelo `produto.id`) | registrado PASS · TA PASS (17/17) · INT-1 3/3 |
| 7 | Combustível sem Produto | PB-05 (`nenhum_produto_associado`, `tipos_sem_produto`; `produto_unidade_nao_kg`); UX-A06 (7: cada motivo, link só com permissão, erro de leitura); TA-08 (`tipos_sem_produto [S10]`) | registrado PASS · pela tela real: E2E-2 PASS — combustível sem Produto (Gasolina) mostra a mensagem e o link `/combustiveis` |
| 8 | Produto sem fator | PB-04, PB-06 (A3 → `ABASTECIMENTO_CONVERSAO_AUSENTE`, nada gravado); TA-02 (B sem fator; o de A não vale), TA-08 ((S500, A) sem fator); UX-A05 (2); FE4 ("fator ausente") | registrado PASS · TA PASS (17/17) · pela tela real: E2E-2 PASS — B sem fator bloqueia com "Configure o fator kg/L…" e `ABASTECIMENTO_CONVERSAO_AUSENTE` |
| 9 | Produto sem saldo | UX-A07 ("Sem saldo deste Produto nesta fazenda.", nada enviado); TA-04b (B com fator e sem lote → `ESTOQUE_SALDO_INSUFICIENTE`, nenhum lote de A tocado); regressão AB7 (`ESTOQUE_SALDO_INSUFICIENTE`, nada gravado) | registrado PASS · TA-04b PASS (17/17) |
| 10 | Seleção única sem ignorar `has_more` | PB-10 (`limit=1` → 3 páginas, resumo igual nas 3); UX-A02 (página parcial → seletor, nada escolhido); UX-A09 (resposta atrasada do bem anterior não escolhe no bem novo); Regras (`produtoAutomatico`, `situacaoDaEscolha`); INT-1 (`unico` exige 1 item e `has_more:false`); revisão final: escolher de novo a mesma máquina mantém o Produto único marcado | registrado PASS · INT-1 3/3 com os helpers reais |
| 11 | Concorrência alteração do vínculo × confirmação | C7 (`patrimonioP1AbastecimentosConcorrencia.test.mjs:460`, ordem determinística por portões) — **continua sendo o portão obrigatório**; TA-11b (portão determinístico, técnica do C7: cada lado espera a trava do outro, sem 409/40P01); TA-11 (**sondagem**, `Promise.all`, 6 rodadas: aceita `201` com A antes da inativação ou `422 sem_vinculo_ativo`, nunca baixa com B); PB-13 (opção velha, sequencial) | C7 12/12 na regressão final · TA-11 e TA-11b PASS (17/17) · PB-13 registrado PASS |
| 12 | Histórico A→B | PB-12; TA-01..TA-04 (detalhe, linha da lista e linhas do banco de X_A idênticas; fator de B; FIFO só em B); TA-05c (nome atual do mesmo Produto); UX-A10 (2) | PB-12 e UX-A10 registrado PASS · TA PASS (17/17) · pela tela real: E2E-2 PASS — abastecimento com A: 80 L → 67,2000 kg, custo 354,60, 2 fatias; troca A→B no cadastro de Combustíveis sem editar o bem; com o fator de B (0,83): 41,3333 L = 34,3066 kg; histórico de A intacto |
| 13 | Cancelamento de A | PB-12 passo 7; TA-05 (associação atual = B → 200, lotes de A exatos), TA-05b (A movido de fazenda → 409 `produto_mudou_de_fazenda`, nada trocado para B), TA-05c (A renomeado e inativo → cancelar 200, lotes de A restaurados), TA-06 (cancelar B); regressão AB11 (`patrimonioP1Abastecimentos.test.mjs:543`) | PB-12 e AB11 registrado PASS · TA PASS (17/17) · pela tela real: E2E-2 PASS — cancelar A devolve 67,2000 kg aos lotes de A (lotes 50/100, estoque 150,0000), B intocado |
| 14 | Idempotência | TA-09 (replay 200 com a mesma `operation_id`, inclusive depois da troca; mesma chave com Produto A → 409 `IDEMPOTENCY_CONFLICT`); UX-A11 ("Repetir o mesmo envio" conserva o `operation_id`); FE5 (duplo clique, 504, Consultar, FE-02/03/06); CB-05/CB-06 (vínculo e criação sem duplicar) | UX-A, FE, CB registrado PASS · TA PASS (17/17) · pela tela real: E2E-1 PASS — replay com a mesma `operation_id` sem baixa dupla |
| 15 | Permissão | PB-11 (só visualizar 200; sem a linha ou só a de Bens 403; sem token 401); S1/S2 (16 rotas, 12 contas), S3 (bem de outro tenant → 404 igual ao inexistente), S4 (`cliente_id` → 400); CB-09 (4); UX-A05 (`configurar_conversao`), UX-A06 (link só com `criar` em `pat-combustiveis`) | registrado PASS (S 9/9) · pela tela real: E2E-1 PASS — recusas 403 sem efeito |
| 16 | Prévia invalidada | TA-10 (vínculo inativado entre prévia e confirmação → 422; fator trocado → 409 `ABASTECIMENTO_CONVERSAO_ALTERADA`); PB-13; UX-A11 (mudar "Completou o tanque?" invalida); FE4; revisão final: bloqueio na revisão relê os Produtos do bem e o Produto que saiu não fica marcado | PB, UX-A, FE registrado PASS · TA PASS (17/17) |
| 17 | Teclado/mobile | UX-A13 (2: `role="radio"`/`aria-checked`, `aria-expanded`, botões nativos, sem largura fixa; "Mais detalhes" abre com erro); UX-A12 (390 px: cards, sem tabela); LO (larguras do tablet) | registrado PASS (jsdom) · navegador real: E2E-1 PASS — página sem rolagem horizontal em toda captura (1280, 820 e 390 px); em 820 px as 6 colunas cabem na área visível da grade · E2E-2 PASS — fluxo só com teclado em 390 px, com foco visível |
| 18 | Testes reais com PostgreSQL local descartável | §8 | registrado PASS nos arquivos listados · `npm run test:backend` completo no `f72308fa`: 1499 testes, 1494 pass, 0 fail, 5 todo (já existentes), 1063 s |
| 19 | Smoke RTL | §8 | registrado PASS · `npm run test:smoke` completo no `f72308fa`: 181 arquivos, 2312 testes, todos PASS, 156 s |
| 20 | Playwright 390/820/1280 px | E2E-1 (`scripts/dev/e2e-abastecimentos-real.mjs`, larguras padrão `1280,820,390`) e E2E-2 do aceite humano (`scripts/dev/e2e-abastecimentos-ux02-real.mjs`) | E2E-1 no `f72308fa`: 27/27 passos (9 por largura), EXIT=0, "OK: tela real + backend real + PostgreSQL local sem divergências", 56 arquivos de captura e log · E2E-2 no `f72308fa`: 25 passos (8 em 1280, 8 em 820, 9 em 390; o passo só-teclado roda só em 390), EXIT=0, "OK: E2E-2 (aceite humano UX-02) — tela real + backend real + PostgreSQL local sem divergências", 80 arquivos |
| 21 | `verify:all` e CI completos, sem ignorar testes | — | `npm run verify:all` no `f72308fa`: 40/40 etapas PASS, 1362,6 s · CI da PR #237: GitHub Actions `quality` (roda o `verify:all`) no `f72308fa`: **success**, run [42866648972](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/42866648972), 15 min 49 s; o commit final (só este relatório) roda o mesmo check na PR |

**Nota A→B (TA).** Na primeira fase, a frente do cenário obrigatório registrou `patrimonioUx02TrocaAssociacao` **12/12** (TA-01..TA-11 + TA-05b) em 4 execuções seguidas (a 1ª deu 11/12: TA-05b caía no unique de nome do Produto homônimo da Fazenda 2; corrigido no fixture), mais `patrimonioUx02ProdutosDoBem` 14/14, `patrimonioP1Abastecimentos` 17/17, `patrimonioP1AbastecimentosConcorrencia` 12/12 e `patrimonioP1CombustivelProduto` 20/20 (5 arquivos, 75/75, banco `maike_ux02_ab`). Depois o arquivo ganhou TA-02b (o vínculo é da fazenda), TA-04b (B com fator e sem lote), TA-05c (nome atual no histórico; cancelar com A inativo), TA-07b (multi-tanque) e TA-11b (portão determinístico da concorrência). **Reexecução final em PostgreSQL 16 local descartável: 17/17** (TA-01..TA-11, TA-02b, TA-04b, TA-05b, TA-05c, TA-07b, TA-11b), com a regressão `patrimonioUx02ProdutosDoBem` 14/14, `patrimonioP1Abastecimentos` 17/17 e `patrimonioP1AbastecimentosConcorrencia` 12/12. A prova por mutação (todas as mutações pegas) está no §8. O C7 continua sendo o portão obrigatório de concorrência; TA-11 é sondagem e TA-11b é determinístico.

## 7. Arquivos alterados

Levantado com `git diff --name-status origin/main...HEAD` com HEAD = `f72308fa` (a `origin/main` é `c4070d0d`, que já entrou na branch pelo merge; o diff mostra só o que a UX-02 muda).

- **Backend, código (2):** `backend/src/modules/patrimonio/abastecimentoOpcoesService.js` (`opcoesProdutosDoBem` e helpers comuns com A8), `backend/src/modules/patrimonio/abastecimentoRoutes.js` (rota A16, schema, comentário do topo).
- **Backend, testes (5):** novos `backend/tests/patrimonioUx02ProdutosDoBem.test.mjs` (PB-01..PB-14) e `backend/tests/patrimonioUx02TrocaAssociacao.test.mjs` (17 testes: TA-01..TA-11, TA-02b, TA-04b, TA-05b, TA-05c, TA-07b, TA-11b); alterados `backend/tests/patrimonioP1AbastecimentosSeguranca.test.mjs` (A16 em S1–S4), `backend/tests/patrimonioP1AbastecimentosContratoTela.test.mjs` (INT-1: bens → produtos-do-bem → locais), `backend/tests/patrimonioP1AbastecimentoCenario.mjs` (helper `produtosDoBem` e comentário).
- **Frontend (15):** `src/components/patrimonio/{AbastecimentosTela,CatalogoPatrimonioTela,ConsultaAbastecimento,DialogosAbastecimento,FormularioAbastecimento,FormularioCombustivel,ProdutosDoCombustivel,TabelaAbastecimentos}.jsx`, novo `src/components/patrimonio/ProdutosNovoCombustivel.jsx`, `src/lib/{abastecimentoRegras,patrimonioErros}.js`, `src/services/{abastecimentoService,combustivelProdutoService}.js`, `src/apis/patrimonio/{patrimonioApi,patrimonioNativePort}.js`.
- **Smoke (9):** `tests/smoke/{abastecimentoRegras.test.js,patrimonioAbastecimentos.test.jsx,patrimonioCatalogos.test.jsx,patrimonioCombustivelProdutos.test.jsx}`, `tests/smoke/fixtures/{abastecimentosFakeCore.js,abastecimentosTela.jsx}`, novos `tests/smoke/patrimonioUx02Abastecimento.test.jsx` (UX-A01..A13), `tests/smoke/patrimonioUx02Combustiveis.test.jsx` (CB-01..CB-17) e `tests/smoke/patrimonioUx02ListaOrdem.test.jsx` (L1 ordem padrão e L2 larguras do tablet). As contagens por arquivo anotadas pelas frentes (27 e 24 testes) são anteriores à revisão final; o número final está no `test:smoke` completo (§8).
- **E2E, fora do CI (3):** `scripts/dev/e2e-abastecimentos-real.mjs` (E2E-1 no fluxo novo), novos `scripts/dev/e2e-abastecimentos-ux02-real.mjs` e `scripts/dev/e2e-abastecimentos-ux02-seed.mjs` (E2E-2).
- **Docs (5):** `docs/engineering/DECISIONS.md` (D-PROD-160; atualização de estado da D-PROD-159), `docs/engineering/CURRENT-STATE.md`, `docs/engineering/ROADMAP.md`, `docs/engineering/MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md` (linha A16 e números de linha), este relatório.
- **Não tocados:** `backend/prisma/**`, `config/**`, `TanquesBem.jsx`, `src/hooks/**`, `operacaoFinanceiraService.js`, `patrimonioCatalogoService.js` e os serviços mutativos do backend listados no §1.

**Escopo conferido no `f72308fa`:** `git diff --stat origin/main...HEAD` = **39 arquivos, 7749 inserções, 793 remoções** (2 + 5 + 15 + 9 + 3 + 5). Em `backend/src` só mudaram `abastecimentoOpcoesService.js` e `abastecimentoRoutes.js`; `abastecimentoService.js`, `abastecimentoPlano.js` e `combustivelProdutoService.js` do backend e todo `backend/prisma` têm **diff zero** contra a `main` (conferido com `git diff --quiet`). Checkpoints `wip` intermediários da branch chegaram a capturar mutantes temporários; o que vale é o código do `f72308fa`, em que `abastecimentoOpcoesService.js` passa no `test:backend` completo (0 fail), inclusive nos PB e TA que derrubam as mutações do §8. A prova por mutação do cenário A→B rodou numa cópia-sombra do backend, nunca no repositório. Sem migration, sem SQL remoto, sem deploy, sem merge.

## 8. Provas de testes

Comando por arquivo de backend: `DATABASE_URL="postgresql://postgres@localhost:5433/<banco>?host=/tmp" AUTH_SECRET=ci-only-ephemeral-signing-key FRONTEND_ORIGINS=http://localhost:5173 NODE_ENV=test MAIKE_TESTE_AGORA=2027-06-15T15:00:00.000Z node --test --test-concurrency=1 backend/tests/<arquivo>.test.mjs`, banco próprio criado do zero e migrado com `npm run deploy:migrate` ("All migrations have been successfully applied").

**Linha de base** (antes de qualquer edição): 7 arquivos de smoke, 125/125.

| Suíte | Banco / ambiente | Resultado (registrado pela frente ou medido no `f72308fa`, como indicado) | Duração |
|---|---|---|---|
| `patrimonioUx02ProdutosDoBem` (PB-01..PB-14) | `maike_ux02_be` | 14/14 | 23 s |
| `patrimonioP1AbastecimentosSeguranca` (A16 em S1–S4) | `maike_ux02_be` | 9/9 | 15 s |
| `patrimonioP1AbastecimentosContratoTela` (INT-1, mapeamento inline) | `maike_ux02_be` | 3/3 | 7 s |
| Regressão: `patrimonioP1Abastecimentos` 17/17 · `…Concorrencia` 12/12 · `…Medidor` 8/8 · `patrimonioP1CombustivelProduto` 20/20 · `patrimonioP1Bens` 19/19 · `permissoesAutorizacao` 11/11 · `permissoesR2` 10/10 · `permissoesR2Rotas` 7/7 · `permissoesR3` 9/9 · `permissoesR4` 9/9 | `maike_ux02_be` | verde | — |
| Total da frente backend | `maike_ux02_be` | **13 arquivos, 148/148** | — |
| `patrimonioUx02TrocaAssociacao` (TA-01..TA-11 + TA-05b) + 4 de regressão | `maike_ux02_ab` | 12/12 (4 execuções); **5 arquivos, 75/75** | 21 s (arquivo novo) |
| `patrimonioUx02TrocaAssociacao` final (TA-01..TA-11, TA-02b, TA-04b, TA-05b, TA-05c, TA-07b, TA-11b) + regressão `patrimonioUx02ProdutosDoBem` · `patrimonioP1Abastecimentos` · `…Concorrencia` | PG 16 local descartável | **17/17** · 14/14 · 17/17 · 12/12 | — |
| Smoke Combustíveis: `patrimonioCombustivelProdutos`, `patrimonioCatalogos`, `patrimonioUx02Combustiveis`, `produtosBloqueioCombustivel` | jsdom | **4 arquivos, 89/89** | — |
| Smoke Abastecimento: `patrimonioAbastecimentos` 24 · `…Cancelamento` 4 · `…Conversoes` 6 · `patrimonioUx02Abastecimento` 27 · `abastecimentoRegras` 33 | jsdom | **5 arquivos, 94/94** | — |
| Smoke completo (`npx vitest run --config vitest.config.js tests/smoke`) | jsdom | 179 arquivos 2253/2253 (frente Combustíveis) · 180 arquivos 2287/2287 (frente Abastecimento, árvore posterior) | — |
| `npm run typecheck:backend` · `npx eslint backend` · `gate:tenancy` (84 models, 234 arquivos) · `gate:indices` | — | rc 0 · rc 0 · PASSOU · PASSOU | — |
| `npm run lint` · `gate:types` (809 ≤ 1746) · `gate:product-scope` (28 páginas, 35 entidades) · `gate:import-integrity` (586 arquivos) · `NODE_ENV=production npm run build` · `node --check` do E2E-1 | — | 0 erros (2 avisos antigos, fora da missão) · PASSOU · PASSOU · PASSOU · ok · ok | — |
| INT-1 com os helpers reais `opcaoNoFormulario`, `produtoAutomatico`, `situacaoDaEscolha` e `tanqueDoFormulario` (no lugar do mapeamento inline) | PG local | **3/3** | — |
| `npm run test:backend` completo no `f72308fa` | PG 16 local, banco vazio | **1499 testes: 1494 pass, 0 fail, 5 todo** (já existentes). A mesma contagem saiu em `16030fdc`, rodado isolado; o backend não mudou depois disso | 1063 s |
| `npm run test:smoke` completo no `f72308fa` | jsdom | **181 arquivos, 2312 testes, todos PASS** | 156 s |
| E2E-1 (`scripts/dev/e2e-abastecimentos-real.mjs`, 1280/820/390) no `f72308fa` | backend real + Vite + Chromium + PG 16 local | **27/27 passos** (9 por largura), EXIT=0, "OK: tela real + backend real + PostgreSQL local sem divergências", 56 arquivos de captura e log. Tela: sem rolagem horizontal da página em toda captura; colunas padrão exatamente "Data \| Máquina/Veículo \| Produto \| Litros \| Medidor \| Situação", sem coluna de combustível; Situação na linha e no card (Cancelado ≠ Confirmado); em 820 px as 6 colunas cabem na área visível da grade; rótulos de cabeçalho sem reticências (exceto "Máquina/Veículo" abaixo de 1024 px, aceito); coluna Produto ≥ 128 px; formulário sem etapa nem rótulo "Combustível". Banco: fator 0,840000 v1; FIFO em 2 fatias (50,0000 + 17,2000; custo 354,60); estorno; replay com a mesma `operation_id` sem baixa dupla; recusas 403 sem efeito; zero lançamento financeiro | — |
| E2E-2 do aceite humano (`scripts/dev/e2e-abastecimentos-ux02-real.mjs`) no `f72308fa` | idem | **25 passos** (8 em 1280, 8 em 820, 9 em 390; o passo só-teclado roda só em 390), EXIT=0, "OK: E2E-2 (aceite humano UX-02) — tela real + backend real + PostgreSQL local sem divergências", 80 arquivos. Cobre os casos 1, 3, 7, 8, 12, 13 e 17 da matriz (§6) | — |
| `npm run verify:all` no `f72308fa` | todas as etapas | **40/40 etapas PASS**, entre elas `test:backend` e `test:smoke` acima, `lint`, `gate:types` (809 ≤ teto 1746), `typecheck:backend`, `build` e `build:admin` | 1362,6 s |
| CI (GitHub Actions) | `verify:all` | GitHub Actions `quality` (roda o `verify:all`) no `f72308fa`: **success**, run [42866648972](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/42866648972), 15 min 49 s; o commit final (só este relatório) roda o mesmo check na PR | — |

**Sensibilidade (mutação, serviço restaurado e conferido com `cmp`):** sem `empresa_id` no filtro do Produto → PB-08 vermelho; sem o filtro KG → PB-05 vermelho; fator de qualquer par do Produto → PB-04 vermelho; `comFator` sem exigir vínculo ativo de tipo aceito → 7 testes vermelhos. Na tela de Combustíveis, "sucesso mesmo com falha" + "incerto = associado" → 4/24 vermelhos (CB-04, CB-05 ×2, CB-09).

**Mutação do cenário A→B**, numa **cópia-sombra** do backend (nunca no repositório): todas as mutações foram pegas. Destaques:
- fator de qualquer par → TA-08 e PB-04;
- B reaproveita o fator de A → 7 testes;
- vínculo inativo aceito → TA-02, TA-08, TA-09, TA-10 e TA-11;
- Produto do histórico lido do vínculo atual → TA-03, TA-05, TA-05b, TA-07 e TA-11;
- cancelamento estornando em B → TA-05;
- fingerprint sem `produto_id` → TA-09 (depois de reenviar trocando só o `produto_id`);
- `alterarSituacao` sem trava → TA-11b (determinístico, 3/3);
- inativação "global" entre fazendas → TA-02b;
- cancelamento recusando o Produto A inativo → TA-05c e AB12;
- arredondamento HALF_EVEN em vez de HALF_UP → 5 testes.

**Revisão adversarial final.** Seis revisores: A16 no backend, Combustíveis, formulário, lista/consulta, conformidade com a missão e qualidade dos testes. Cada achado foi verificado por um cético, com sondas. A16 e conformidade: sem defeito. Foram 9 achados: 8 confirmados e corrigidos com RED→GREEN e 1 refutado (o texto de `sem_vinculo_ativo` na tela de fatores). Os confirmados:
- **C1** — o aviso de criação nomeia a fazenda de origem quando o topo muda durante a associação.
- **C2** — a falha de associação em andamento não se perde quando a seção remonta; o pai aplica o resultado por lote; o aviso diz em que fazenda e registro ver "Não associados".
- **C3** — "Tentar de novo" não descarta os Produtos escolhidos no painel.
- **C4** — a tela confere pelo código antes do POST e, na resposta perdida, só dá como criado o que não existia antes, com o mesmo nome e ativo.
- **F1** — o bloqueio na revisão por vínculo, Produto, tanque ou unidade incompatível ou inativo relê os Produtos do bem, e o Produto que saiu não fica marcado.
- **F2** — escolher de novo a mesma máquina mantém o Produto único marcado.
- **L1** — ordem padrão da lista Nº decrescente, igual à paginação do servidor (`createdAt desc`).
- **L2** — larguras do tablet 101/124/130/97/100/103 = 655 px, priorizando Produto e Situação.

Foram duas rodadas: a verificação da 1ª achou uma regressão na correção do C2 e lacunas em F1 e L2; a 2ª rodada corrigiu, e os verificadores deram ok. À parte, o E2E-1 achou a Situação invisível no tablet (820 px): a grade media 896 px para 712 px úteis. A correção é a do L2, e o E2E-1 prova as 6 colunas na área visível.

**Citados, não duplicados:** corrida real vínculo × confirmação = C7 (`patrimonioP1AbastecimentosConcorrencia.test.mjs:460`); cancelamento com Produto movido de fazenda = AB11 (`patrimonioP1Abastecimentos.test.mjs:543`).

## 9. Limitação de API

- **Um Produto, um combustível ativo por fazenda** (unique `TipoCombustivelProduto_produto_ativo_key`): o mesmo "Diesel" não serve S10 e S500 ao mesmo tempo na mesma fazenda (409 `COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO`, mostrado na tela). Mudar isso exige schema.
- **Fator por par** `(empresa, tipo, produto)`: B nasce sem fator; o de A nunca é reaproveitado. Confirmar sem `conversao_id/versao` é barrado no schema (400 `required`); com o fator de outro par → 422 `ABASTECIMENTO_CONVERSAO_AUSENTE`. A tela não chega a enviar nenhum dos dois: o aviso de fator vem antes.
- **`TanqueBemCombustivel` sem coluna `ativo`:** a compatibilidade do tanque é a linha existente. A UX-02 nunca grava essa tabela.
- **Sem endpoint atômico "criar combustível + associar":** a criação usa os endpoints existentes, em sequência. Um resultado parcial é possível e fica explícito na tela, com repetição só do que falhou. `POST /patrimonio-combustiveis` **não é idempotente**: antes do POST a tela confere pelo código se o combustível já existe (se existe, nada é criado nem associado); depois de uma resposta perdida, procura pelo código único e só dá como criado o que não existia na conferência, com o mesmo nome e ativo; se a leitura falhar, pede conferência manual. Salvar de novo nunca cria um segundo combustível (o código repetido dá 409).
- **Leitura sem trava:** a opção pode envelhecer entre a tela e a confirmação; a barreira é a confirmação (trava do vínculo, R5 da D-PROD-159), que recusa com 422 `sem_vinculo_ativo`.
- **Dados vivos no detalhe:** `kg_por_litro`, `quantidade_kg`, custo e fatias são snapshot do abastecimento; `conversao.versao`/`conversao.vigente` do detalhe são lidos ao vivo (TA-03: encerrar o fator de A muda `versao` 1 → 2 e `vigente` para `false` no detalhe antigo, sem mudar kg, custo ou fatias).
- **Nome do Produto no histórico:** o abastecimento aponta para o Produto da época pelo id; o nome exibido é o **atual** desse mesmo Produto (renomear A muda o rótulo dos abastecimentos de A, nunca os aponta para B). Fixado pelo TA-05c. Guardar o nome da época exigiria schema.
- **Dois contratos de elegibilidade convivem:** `GET /bens-patrimoniais/:id/produtos-elegiveis` (P1-01, guarda de Bens) fica como está; o formulário usa só A16. `opcoes/tanques` (A8) continua servida, mas o formulário não a chama.
- **Locais** vêm de `opcoes/locais` (A12, exige `novo`/`salvar`): quem só tem `visualizar` vê os Produtos, mas não chega à escolha do local (e não pode confirmar).
- **Mensagens de erro do servidor** (`mensagemErroPatrimonio`, intocada) ainda dizem "vinculado" em alguns textos.

## 10. Riscos

- **R1 — unicidade Produto ↔ combustível:** limita fazendas que usam o mesmo Produto para dois combustíveis; a tela mostra o conflito, a mudança exige schema.
- **R2 — passo extra de fator:** depois de trocar A por B, o responsável precisa configurar o fator de B antes do próximo abastecimento (comportamento desejado, fail-closed).
- **R3 — opção velha:** coberta pela confirmação sob trava (C7 e TA-11b, determinísticos; PB-13 e TA-10; TA-11 como sondagem) e pela releitura da tela (UX-A10; na revisão, o bloqueio relê os Produtos do bem).
- **R4 — criação não idempotente:** a conferência pelo código antes do POST e a regra da resposta perdida (só "criado" o que não existia antes, com o mesmo nome e ativo) evitam dar como criado um combustível que já existia; se o servidor gravar o combustível depois da última leitura, salvar de novo é recusado pelo código repetido (aviso ou 409), nunca duplica, e os Produtos se associam então na seção do registro. Os "Não associados" ficam guardados por fazenda e combustível enquanto a tela está aberta.
- **R5 — custo de leitura:** 4 contagens + 1 `groupBy` + a página por chamada, inclusive nas páginas do seletor; limitado por bem e pelo índice `TipoCombustivelProduto_empresa_tipo_ativo_idx`. O tempo de resposta de `produtos-do-bem` **não foi medido isoladamente**; o E2E chama a rota dezenas de vezes por rodada, sem falha nem timeout.
- **R6 — preferências de coluna:** a chave nova `colunas_abastecimentos_v2` faz cada usuário perder, uma vez, a escolha de colunas salva na P1-02 (de propósito: a preferência antiga traria a coluna "Combustível" de volta).
- **R7 — conflito de texto com a PR #229** (aberta, D-PROD-154): ela acrescenta 89 linhas em `docs/engineering/DECISIONS.md` logo depois da D-PROD-153 (por volta da linha 5529), sem remover nenhuma e sem tocar o marcador de próxima decisão. A UX-02 escreve depois da D-PROD-159 (fim do arquivo) e troca o marcador para D-PROD-161. Os trechos são distantes; o conflito é improvável, mas quem mergear a segunda deve conferir o fim do `DECISIONS.md` e a ordem dos IDs. A UX-02 não toca a PR #229.
- **R8 — lista no tablet:** medida em navegador real (E2E-1 em 1280, 820 e 390 px): sem rolagem horizontal da página e, em 820 px, as 6 colunas padrão na área visível da grade, com a Situação. Fica com reticências o rótulo "Máquina/Veículo" abaixo de 1024 px (aceito); a coluna Produto tem pelo menos 128 px.

## 11. O que NÃO foi feito

- Nenhuma migration, nenhum DDL, nenhum SQL em banco remoto; nenhum deploy; nenhuma variável Vercel; nenhum merge; PR não marcada como ready.
- Nenhuma mudança em schema, motor de estoque/FIFO, custo, medidor, estorno, RLS, travas, concorrência ou API mutativa; nenhum endpoint mutativo novo; nenhum CRUD paralelo de vínculo.
- `TanquesBem.jsx`, mapas, financeiro e outros módulos intocados; PR #235 (mergeada) e PR #229 (aberta) intocadas; a PR #236 (tipografia Base1) entrou só pelo merge da `main`.

## 12. Situação

| Item | Valor |
|---|---|
| PR | [#237](https://github.com/maikelimaadm-stack/MAIKE/pull/237), **DRAFT** |
| Branch | `claude/maike-patrimonio-ux-02-abastecimento-produto` |
| Base | `origin/main` `c4070d0d` (PR #236, tipografia Base1), trazida pelo merge `f72308fa`; a branch nasceu sobre `e3ea4c39` (PR #235) |
| HEAD | código verificado: commit `f72308fa` (merge da `main` `c4070d0d`, PR #236 de tipografia Base1, sobre `4e2fb07e`); o commit final da PR só completa este relatório (docs, nenhum código) |
| CODE_READY | SIM — `verify:all` 40/40 no commit de código `f72308fa`; CI: GitHub Actions `quality` (roda o `verify:all`) no `f72308fa`: **success**, run [42866648972](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/42866648972), 15 min 49 s; o commit final (só este relatório) roda o mesmo check na PR |
| SCHEMA | sem mudança (nenhuma migration a aplicar) |
| MERGE_READY | **NÃO** — PR em draft; depende da revisão humana e do merge manual do proprietário; sem deploy. Não há passo de banco antes do merge |
| OPERATIONAL_RELEASE_READY | NÃO — depende do merge; a Vercel publica a `main` sozinha e não há migration |

Decisões para aprovação humana: a própria D-PROD-160 (U1–U9 e as divergências registradas), os limites aceitos (§9) e o merge manual.
