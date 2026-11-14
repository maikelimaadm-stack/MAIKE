# MAIKE-APONTAMENTO-ITENS — Relatório (Fatia D do apontamento)

**fatia D · `feat/apontamento-itens` · PR #__PR__ (rascunho)** · Decisão: [D-PROD-191](./DECISIONS.md)

Contrato do arquiteto: [`MAIKE-APONTAMENTO-ITENS-CONTRATO.md`](./MAIKE-APONTAMENTO-ITENS-CONTRATO.md). Branch empilhada sobre `feat/apontamento-atividade` (PR #269, D-PROD-190, migration `20261113700000_apontamento_atividade` já aplicada em produção).

## 1. Entrega

O apontamento de atividade confirmado passa a receber **itens de custo**. O item **PRODUTO** (ex.: herbicida aplicado numa roçada) baixa o estoque como o abastecimento: escolhe produto e local, sai pelo motor único (FIFO por lote), o custo vem do lote real e cancelar estorna exato. Os itens **SERVIÇO** e **OUTRO** (ex.: mão de obra terceirizada, frete) têm descrição livre, quantidade, valor unitário e total calculado, sem cadastro de serviço e sem efeito de estoque.

| Camada | O que entrou |
|---|---|
| Banco | models `ApontamentoAtividadeItem` e `ApontamentoAtividadeItemConsumoLote` (fatias FIFO por lote), FKs compostas por `cliente_id` todas `RESTRICT`, uniques e índices começando por `cliente_id`, 7 CHECKs; relações inversas só no Prisma. Migration EXPAND `20261113800000_apontamento_atividade_item` com RLS/REVOKE. **Não aplicada** |
| Release | manifesto (sha256 `866dc994…533c`) e hash do DO (`7aaa176c…f710`) pinados no `premergeMigrateLib.mjs`; B15a/B15b no `premerge-migrate`; SQL editor 01–04 (69 tabelas de tenant, 84 no total, as 2 novas antes do `ApontamentoAtividade` na ordem de exclusão e no `LOCK TABLE`); contagens das duas migrations CONTRACT, do S8 e dos ensaios |
| Backend | A1 adicionar item, A2 cancelar item, A3 cancelar apontamento com itens (`operation_id` obrigatório), A4 detalhe com `itens` e `custo_itens`, A6 opções de produto, A7 locais com saldo; origem nova `apontamento_atividade` no motor; reconciliação e guarda do lote (X1) conhecendo as fatias; 6 erros novos |
| Frontend | seção "Itens" no formulário existente (4 estados), rascunho de um item por vez, cancelar item, detalhe no lugar da linha da lista, idempotência no cliente com pendência por escopo, mensagens dos códigos novos. Só componentes existentes; nenhum `.jsx` nem CSS novo |
| Testes | `apontamentoAtividadeItensNativo` (21) e `apontamentoAtividadeItensConcorrencia` (7) em Postgres real; `apontamentoAtividadeNativo` e `permissoesR2Rotas` ajustados; `premerge-migrate` B1/B15a/B15b; `sqlEditorBootstrap` com itens na semente; S8 e testes de contagem; smoke `apontamentosAtividade.test.jsx` (41) |
| Documentos | D-PROD-191 com as palavras do proprietário; este relatório; `CURRENT-STATE`; texto constitucional proposto no `00 §1` e no `07` (vale com a aprovação do proprietário no merge manual) |

## 2. Como foi feito

1. **D1, schema e migration**, sozinha primeiro: fixa os campos. O DDL saiu do `prisma migrate diff` sobre um banco já migrado (igual ao esboço do contrato); os CHECKs e o DO entraram à mão, o DO copiado da migration da Fatia C trocando só a lista. `migrate diff` vazio nos dois sentidos.
2. **Construção em paralelo**, cada frente com arquivos exclusivos (§8 do contrato):
   - **D2 backend:** rotas no plugin existente, serviço novo dos itens, estorno compartilhado entre A2 e A3, origem nova no motor (só as 3 linhas permitidas), reconciliação, X1, erros;
   - **D3 frontend:** porta, API, serviço, regras puras, formulário e página;
   - **D4 testes de backend:** escritos contra o contrato, não contra a implementação; ajuste dos testes que mudaram por D-2 e pelo detalhe com itens;
   - **D5 (por último):** portão de migrations, SQL editor, contagens, ensaios e documentos.
3. **Mutações** (D4): cada mutação do contrato aplicada numa cópia espelhada do backend, fora do repositório, e desfeita; o código das outras frentes conferido por sha256 antes e depois.
4. **Contagens recalculadas do estado real**: `ls` das migrations (45 pastas) e um banco recém-migrado (`maike_d5`): 84 tabelas em `public` (contando `_prisma_migrations`), `cliente_id` em 70 (as 69 de tenant + `OperadorProdutoMaike`), 45 migrations concluídas.

## 3. Regras implementadas

| Regra | Comportamento |
|---|---|
| Tipos fechados | `PRODUTO`, `SERVICO`, `OUTRO` (schema e CHECK) |
| Só em CONFIRMADO | apontamento CANCELADO recusa item: 409 `APONTAMENTO_ATIVIDADE_STATUS_INVALIDO`. Conferência: existe → status → `versao` |
| Serialização | adicionar item, cancelar item e cancelar apontamento travam a linha do apontamento (`FOR UPDATE`) antes de ler itens, locais e produtos; o PATCH continua sem trava e perde o CAS se um item entrou |
| CAS | `versao` do apontamento; adicionar e cancelar item incrementam a `versao` uma vez |
| Idempotência | recibo por `operation_id` + fingerprint; replay = 200 com `replay: true` e nenhum efeito novo; mesma chave com conteúdo diferente = 409 `IDEMPOTENCY_CONFLICT` |
| PRODUTO — cadastro | produto do tenant, da mesma empresa, ativo, unidade efetiva `L` ou `KG` (SACO guarda kg); local existe e está ativo; senão 422 `_ITEM_INVALIDO` por `field`/`reason` |
| PRODUTO — baixa | só `aplicarSaidaFifo`, origem `apontamento_atividade`, na `data_operacional`; quantidade na unidade efetiva, sem conversão; custo FIFO do motor (um arredondamento, 4 casas); fatias gravadas na ordem FIFO; saldo insuficiente = 422 `ESTOQUE_SALDO_INSUFICIENTE`, nada gravado |
| PRODUTO — estorno | `estornarEmLote`: cada fatia volta ao SEU lote, Entrada `estorno_apontamento_atividade` com o mesmo valor, original `Estornada`, `estoque_atual` restaurado, data = hoje da fazenda; conferências antes do motor; recusa = 409 `_ESTORNO_BLOQUEADO`, nada muda |
| SERVICO / OUTRO | descrição 1..255, quantidade > 0, valor unitário ≥ 0; total = `ROUND_HALF_UP(q × vu, 4)` em Decimal no servidor, > 0 e dentro do limite; sem efeito de estoque nem financeiro |
| Imutável | sem PATCH e sem DELETE de item (404 de rota); corrigir = cancelar e lançar de novo |
| Cancelar apontamento | cancela e estorna todos os itens CONFIRMADO na mesma transação (`cancelamento_origem = 'APONTAMENTO'`); uma recusa em qualquer item desfaz tudo |
| Ordem | `MAX(ordem) + 1` sob a trava; nunca reaproveitada; colisão no unique = 409 `CONCURRENCY_CONFLICT` |
| Centro de custo | sem centro no item; vale o centro (snapshot) do cabeçalho (D-4) |
| Tenant | só do `auth_context`; item ou apontamento de outro tenant = 404 com o mesmo corpo do inexistente |
| Sem saldo direto | o serviço não escreve `Produto`, `EstoqueLoteNota` nem `MovimentacaoEstoque`; não altera `preco_custo` |
| Auditoria | `apontamento_atividade.item_adicionar` / `item_cancelar` na mesma transação; o cancelamento do apontamento grava o evento dele + um `item_cancelar` por item; nunca AuditLog de lote ou Produto |
| Lote imutável (X1) | lote consumido por item (confirmado ou cancelado) recusa PATCH/DELETE: 409 `REGISTRO_OPERACIONAL_IMUTAVEL`, `vinculo = 'apontamento_atividade'` |
| Reconciliação | a origem nova está em `ORIGENS_PROTOCOLO` e `ORIGENS_COM_FK`; as fatias dos itens CONFIRMADO entram como consumo do lote e como `soma_fk` do movimento |
| Código antes da migration | a guarda do lote e a reconciliação conferem `to_regclass` antes de citar as tabelas novas (lição do hotfix #259); o módulo do apontamento assume as tabelas (por isso a migration vai antes do deploy) |
| Sem financeiro | nenhum `OperacaoFinanceira`, título, conta a pagar, natureza ou rateio |

## 4. Decisões D-1 a D-9 (interpretação registrada na D-PROD-191; o proprietário revisa na PR)

| # | Ponto | Como ficou |
|---|---|---|
| D-1 | PATCH da data com itens | recusado: mudar `data_operacional` com item PRODUTO CONFIRMADO → 409 `APONTAMENTO_ATIVIDADE_DATA_COM_ITENS`. A tela trava a data na edição, com uma nota |
| D-2 | Cancelar apontamento | `operation_id` **obrigatório** em `POST /:id/cancelar`. Uma aba aberta com a versão antiga recebe 400 até recarregar |
| D-3 | Permissões | adicionar item = `editar|salvar`; cancelar item = `excluir`; opções de produto = `visualizar`; locais com saldo = `editar|salvar`. Nenhuma ação nova; nenhum perfil recebe acesso por padrão |
| D-4 | Centro de custo | sem centro no item; vale o do cabeçalho; trocar o do cabeçalho leva os itens junto |
| D-5 | Prévia de custo | não há; o custo FIFO aparece depois de lançar; a tela mostra o saldo por local |
| D-6 | SERVIÇO × OUTRO | mesmos campos e regras; só o rótulo muda; sem unidade |
| D-7 | Arredondamento | total de SERVIÇO/OUTRO em 4 casas, `ROUND_HALF_UP`; a tela exibe em R$ |
| D-8 | Combustível como item | recusado: produto aceito por algum tanque (`TanqueBemProduto` ativo) → 422 `_ITEM_INVALIDO`, `reason: 'combustivel_no_abastecimento'`. Evita dupla contagem com a Fatia E |
| D-9 | Limite | 200 itens por apontamento, contando os cancelados → 422 `APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS` |

**Divergência do contrato corrigida no registro:** o resumo do §10 diz "409 ao exceder" na D-9, mas a tabela de erros do próprio contrato (§3.5) diz 422, e o código, os testes e a tela seguem o 422. A D-PROD-191 registra 422.

## 5. Validação local

__VALIDACAO__

### Provas por mutação (D4, todas pegas)

Cada mutação foi aplicada numa cópia espelhada do backend e desfeita; o repositório nunca foi mutado.

| Mutação | Teste que pegou |
|---|---|
| M1 origem `abastecimento_patrimonio` | IT1 |
| M2 custo = `preco_custo` do Produto | IT1, IT1b |
| M3 arredondar por fatia | IT1b (6,0618 e não 6,0619) |
| M4 sem fatias / ordem das fatias trocada | IT1, IT6, IT12 |
| M5 estorno sem respeitar as fatias gravadas | IT6 |
| M6 estorno na data operacional | IT6, IT9 |
| M7 sem `versao + 1` | IT1, IT5, IT6 |
| M8 cancelar o apontamento sem os itens | IT9, IT9b, C3, R5 |
| M9 cancelamento parcial com um estorno bloqueado | IT9b |
| M10 item em apontamento CANCELADO | IT5 |
| M11 sem conferir empresa/ativo do produto | IT4a |
| M12 sem `travarProdutosEstoque` | C1 |
| M13 `estoque_atual -=` no serviço | IT1 |
| M14 total em `Number` | IT3 |
| M15 origem fora de `ORIGENS_PROTOCOLO`/`ORIGENS_COM_FK`, sem o CTE das fatias ou sem o ramo do `fk` | IT12 |
| M16 sem a contagem do X1 | IT13 |
| M17 CTE das fatias ignorando o status | IT12 |
| Extras: sem D-8, sem D-1, sem `FOR UPDATE` do apontamento, sem o limite de 200 | IT4a/C5, IT5, C3, IT4d |

Também nesta frente (D5): trocar a ordem das 2 tabelas novas no `c_tenant` do 02 faz o `sqlEditorBootstrap` (SE-09) parar com "ordem de FK inválida (ApontamentoAtividadeItemConsumoLote → ApontamentoAtividadeItem)".

## 6. Release (GO separado; migration ANTES do merge)

1. A migration é **EXPAND** pura: só cria as 2 tabelas novas. **Não foi aplicada.** Aplicar em produção exige um **GO separado e específico** do proprietário, como nas D-PROD-188 e D-PROD-190.
2. **Ordem obrigatória: migration → merge → deploy.** O detalhe do apontamento lê a tabela nova; com o código no ar antes da migration, a tela de apontamentos dá 500 (risco R3). Os módulos antigos (guarda do lote e reconciliação) ficam protegidos por `to_regclass`.
3. **Caminho:** A (`premerge-migrate --aplicar`, o oficial) se a sessão tiver a URL direta do banco; senão B (conector Supabase, uma transação com guardas, `migration.sql` íntegro e `INSERT` em `_prisma_migrations` com o checksum pinado), **registrado como desvio da D-PROD-74**, como nas Estações e na Fatia C. `apply_migration` nunca.
4. **Preflight esperado em produção** (recontar no dia): `system_identifier` 7692130048193495360; 45 concluídas e 0 com falha (a `…600000` da PR #270 já está lá); 83 tabelas em `public`; `to_regclass` nulo para as 2 tabelas novas; as tabelas referenciadas existem (`Cliente`, `ApontamentoAtividade`, `Produto`, `LocalEstoque`, `MovimentacaoEstoque`, `Usuario`, `EstoqueLoteNota`). Depois de aplicar: **46 concluídas e 85 tabelas**, RLS ligado sem FORCE nas 2, política `maike_backend_all` só para `maike_vercel`, `anon`/`authenticated` sem acesso, 11 FKs `RESTRICT`, 7 CHECKs, `get_advisors` sem alerta.
5. **D-2 no deploy:** depois do deploy, uma aba com a versão antiga recebe 400 ao cancelar um apontamento até recarregar a página.
6. **Permissões:** nenhuma ação nova. Quem já tem `editar` na tela `op-apontamentos-atividade` passa a lançar item; quem tem `excluir` passa a cancelar item.
7. **Smoke depois do merge e do deploy (proprietário):** num apontamento CONFIRMADO de teste, lançar um item de Produto (conferir o custo e o saldo do local), um de Serviço e um de Outro custo; cancelar o item de Produto e conferir o saldo de volta; cancelar o apontamento e conferir que os itens ficaram cancelados; tentar lançar um combustível como item e ver a recusa.
8. **Rollback:** as 2 tabelas são novas e nada as referencia. Antes de qualquer item real, reverter é `DROP TABLE "ApontamentoAtividadeItemConsumoLote", "ApontamentoAtividadeItem";` mais a remoção da linha em `_prisma_migrations`, **só com GO próprio** (é CONTRACT). Com itens PRODUTO gravados, o rollback do schema apagaria fatias de movimentos reais: não fazer sem decisão. Se o código já estiver no ar, reverter o código primeiro.
9. **Fila (R4):** a CONTRACT da PR #268 (`20261113500000`) ainda não foi aplicada e tem data anterior a migrations já aplicadas; `20261113800000` não colide, mas quem renomear a #268 não pode usar `…800000`. As contagens fixas (45 migrations, 84 tabelas, 69 de tenant) mudam se #263, #268 ou #270 entrarem antes: recontar no merge (com a #270 antes: 46 / 85 / 70).

## 7. Riscos

| # | Risco | Tratamento |
|---|---|---|
| R1 | Cancelamento travado: lote de origem estornado (compra cancelada) ou unidade do Produto mudada impedem o estorno exato | 409 fail-closed, como o abastecimento. O usuário fica sem saída até existir comando de ajuste (fora do escopo) |
| R2 | Baixa retroativa: a saída fica na data operacional (pode ser antiga) e consome os lotes de hoje (FIFO atual) | Como o abastecimento; só data futura é recusada. A razão por data pode mostrar consumo antes da entrada do lote |
| R3 | Ordem de deploy (#259): código antes da migration = 500 na tela | Migration ANTES do merge/deploy, com GO; módulos antigos protegidos por `to_regclass` (teste T14) |
| R4 | Fila de migrations em produção (#268 CONTRACT pendente, contagens dependentes de #263/#268/#270) | Nome `…800000` sem colisão; recontar no merge |
| R5 | Transação curta (9 s): cancelar apontamento com muitos itens PRODUTO | `estornarEmLote` com nº fixo de idas ao banco; 50 itens PRODUTO cancelados em ~80 ms no teste; limite de 200 itens |
| R6 | Motor compartilhado: a origem nova e a reconciliação tocam abastecimento, Central e suplementação | Só as 3 linhas do motor; suítes `estoqueP0*`, `estoqueP1*`, `patrimonioP1Abastecimentos*` e Gestão P3 inteiras passaram |
| R7 | Proveniência da compra (Gestão P3): consumo por item bloqueia retificar/excluir a compra do lote, mesmo depois do estorno | Regra existente, agora com teste (T13). Avisar o usuário: uma compra cujo lote foi usado num item não se retifica |
| R8 | A `versao` do apontamento muda com itens: quem edita o cabeçalho enquanto outro lança item leva 409 | Comportamento esperado do CAS; a tela relê o detalhe |

## 8. Fora do escopo

- abastecimento ligado ao apontamento (Fatia E): `AbastecimentoBem*` não foi tocado;
- flags `exige_area`/`pode_ter_*`: não voltaram em lugar nenhum;
- edição e exclusão de item; devolução de sobra ao estoque;
- cadastro de serviços e fornecedor no item; unidade no item de SERVIÇO/OUTRO;
- lançamento financeiro, título, conta a pagar, natureza ou rateio a partir do item (`OperacaoFinanceira*` não foi tocado);
- prévia de custo (D-5); custo/hora, manutenção, peças e relatórios de custo;
- motor de estoque além da origem nova; escrita direta de saldo, lote ou movimento;
- trabalho visual: nenhum componente, CSS ou layout novo; nenhuma página nova em `config/mapa-manejo-scope.json`.
