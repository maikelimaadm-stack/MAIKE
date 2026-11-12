# Estado Atual

**Atualizado em:** 2026-10-27 (**pós-P7** + auditoria de gap — PR **#85** mergeada;
dados e SDK Base44 fora do runtime; Supabase `_prisma_migrations` **14/14** e **38**
tabelas de app alinhadas ao Prisma — ver
[`GAP-AUDIT-POS-BASE44-2026-10-27.md`](./GAP-AUDIT-POS-BASE44-2026-10-27.md) e
`POST-P7-PRODUCAO-REPORT-2026-10-27.md`; UX Base1 — gate §H **5/6** aguardando **H.5**;
rollout pausado **D-PROD-41**)

---

## Missão ativa (2026-11-11) — UI-FONTES-PREVIA: fontes voltam ao estilo e ao tamanho da prévia escolhida (D-PROD-175)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-175**, pedida pelo proprietário em 2026-11-11: "as fontes estão enormes […] deixe as fontes do tamanho que estava no anterior" e "o estilo e tamanho das fontes eu quero deixe igual está aqui nessa visualização do vercel" (prévia `maike-funzkhxes`, commit `836344f`) |
| Branch / PR | `claude/design-implementation-optimize-7wr2qh`, sobre a `main` com a D-PROD-174 |
| Escopo | Reversão do código da D-PROD-173 e da D-PROD-167: DM Sans e os tamanhos de antes em todo o sistema e no mapa. Medido igual à prévia em Produtos, Lotes, Mapa Geral e Detalhes do Lote (1366 e 390 px). Ficam as telas no motor da D-PROD-169 a D-PROD-174 |
| Migration | Nenhuma |
| Release | Merge e deploy, depois do OK do proprietário nas imagens |
| Relatório | [`UI-FONTES-PREVIA-D175-REPORT.md`](./UI-FONTES-PREVIA-D175-REPORT.md) |

## Missão anterior (2026-11-11) — UI-CADASTRO-MAPA: Cadastro de Áreas, Pontos e Linhas no motor Base1 (D-PROD-174)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-174**, pedida pelo proprietário em 2026-11-11: "Já aproveite e já ajuste também para cadastro de áreas, etc" |
| Branch / PR | `claude/design-implementation-optimize-7wr2qh`, sobre a `main` com a D-PROD-173 |
| Escopo | Cada aba (Áreas, Pontos, Linhas) vira uma tela do motor: barra, faixa, grade e cards, registro. "+ Novo" desenha no mapa; GPS, seleção no mapa, importação, pontos em lote e ações em lote das áreas em "Mais opções"; "Editar no mapa" no registro. Formulário da Área com campos e listas do motor; Ponto e Linha com a lista do motor (`SelectDoMotor`) e travados em leitura. Saem as tabelas antigas |
| Migration | Nenhuma |
| Release | Merge e deploy |
| Relatório | [`UI-CADASTRO-MAPA-D174-REPORT.md`](./UI-CADASTRO-MAPA-D174-REPORT.md) |

## Missão anterior (2026-11-11) — UI-MAPA-TIPOGRAFIA: o Mapa Geral com a tipografia do motor Base1 (D-PROD-173)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-173**, pedida pelo proprietário em 2026-11-11: "ajuste todas as fontes do meu mapa para igual a fonte do motor base 1 […] Detalhes de lote, etc" |
| Branch / PR | `claude/design-implementation-optimize-7wr2qh`, sobre a `main` com a D-PROD-172 |
| Escopo | Detalhes do Lote (tabela de papéis `TIPO`), Filtros e Visualização, manejos e janelas abertos pelo mapa: texto 14 px, apoio 13 px, títulos em Lato 13 px / 600, nada abaixo de 13 px fora as peças do próprio motor. Ficam os rótulos desenhados sobre o mapa e a atribuição. Fora: Cadastro de Áreas, Pontos e Linhas no motor (D-PROD-174) |
| Migration | Nenhuma |
| Release | Merge e deploy |
| Relatório | [`UI-MAPA-TIPOGRAFIA-D173-REPORT.md`](./UI-MAPA-TIPOGRAFIA-D173-REPORT.md) |

## Missão anterior (2026-11-11) — UI-GESTAO-MOTOR: Gestão, Patrimônio e Financeiro no padrão do motor Base1 (D-PROD-172)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-172**, pedida pelo proprietário em 2026-11-11: filtros fora da barra (na faixa do motor), campos, listagem e escolha iguais ao motor em Bens, Abastecimentos e no financeiro. Antes dela, na mesma branch: **D-PROD-171** (PR #243, mergeada em `899df140`), que devolveu os filtros do celular às folhas e deixou só o menu "⋮" da coluna como "Mais opções" |
| Branch / PR | `claude/design-implementation-optimize-7wr2qh`, sobre a `main` `899df140` |
| Escopo | Filtros da tela como pílulas da faixa (Centros, Parceiros, Naturezas, Bens, Abastecimentos, Lançamentos); `CampoSelect` com pesquisa, MAIÚSCULAS e ✕ (sem opção vazia); `SeletorPaginadoGestao` na janela das listas do motor; painel de perfil financeiro no cartão do motor. Fora: Cadastro de Áreas, Pontos e Linhas e fontes do Mapa Geral (próxima missão) |
| Migration | Nenhuma |
| Release | Merge e deploy; nada é gravado de outro jeito |
| Relatório | [`UI-GESTAO-MOTOR-D172-REPORT.md`](./UI-GESTAO-MOTOR-D172-REPORT.md) |

## Missão anterior (2026-11-11) — MAIKE-PATRIMONIO-SIMPLIFICA-02: Produtos aceitos em qualquer unidade, sem Área/Localização, Família fora da tela (D-PROD-169)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-169**, pedida pelo proprietário em 2026-11-11 depois de testar a SIMPLIFICA-01 em produção. Respostas: "Família some", "Tipo de bem + Tipo", "Junta tudo numa PR só". **D-PROD-170**: Patrimônio no modelo do motor Base1 (janelas `B1Janela` e botões do motor), pedido do proprietário antes do merge |
| Branch / PR | `claude/new-session-abgn5w`, base `origin/main` `87e8a5ca` (merge da PR #239), com a `main` da PR #242 (SVG, D-PROD-163) e da PR #240 (motor Base1, D-PROD-164 a D-PROD-168) integrada por merge. Vai junto da PR [#241](https://github.com/maikelimaadm-stack/MAIKE/pull/241), que registra a release da D-PROD-162 |
| Escopo | **Tanque e abastecimento:** Produtos aceitos em L, KG ou SACO; SACO abastece em kg, a unidade de estoque. **Bem:** saem Área e Localização; sai a Família; a lista fixa "Tipo de bem" (natureza) vem com o "Tipo" do usuário, com "+ Novo tipo" e "Gerenciar tipos" (listar, renomear, excluir; tipo em uso → 409 `PATRIMONIO_TIPO_EM_USO`). **Catálogo:** garantido automaticamente, com a família padrão `OUTROS` |
| Migration | Nenhuma |
| Release | Merge e deploy; não há escrita no banco |
| Relatório | [`MAIKE-PATRIMONIO-SIMPLIFICA-02-REPORT.md`](./MAIKE-PATRIMONIO-SIMPLIFICA-02-REPORT.md) |

## Missão anterior (2026-11-10) — MAIKE-PATRIMONIO-SIMPLIFICA-01: o Patrimônio recomeça do zero, simplificado (D-PROD-162)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-162**, decidida pelo proprietário em 2026-11-10: Litros no Produto (D1-A), Produtos aceitos por tanque (D2-A), medições e perfis removidos (D4-B), Patrimônio do zero (D8-B), Famílias e Tipos dentro de Bens, menu só com Bens e Abastecimentos, sem tipo de combustível e sem fator kg/L. Padrões P-01…P-12 do contrato registrados na decisão. Supera em parte a D-PROD-157 e a D-PROD-159 e quase toda a D-PROD-160. Exceção CONTRACT única à D-PROD-72 item 3 e à D-PROD-107 R7. Emendas **propostas** em [`00-CONSTITUICAO.md`](../constitution/00-CONSTITUICAO.md) §1 e em [`07-DO-NOT-DO.md`](../constitution/07-DO-NOT-DO.md) (notas D-PROD-157 e D-PROD-159); valem só com a aprovação explícita do proprietário no merge |
| Branch / PR | `claude/new-session-abgn5w`, base `origin/main` `e39d318b` (merge da PR #237, UX-02), com a `main` `e8472481` (PR #238, Estoque P0-01, D-PROD-161) integrada por merge · schema e migration no commit `8442e9f5` · PR **draft**; número, HEAD final e CI registrados no relatório |
| Escopo | **Bens:** Família e Tipo escolhidos e criados no próprio formulário ("+ Nova família", "+ Novo tipo"), "⋯ › Gerenciar famílias e tipos" e "Instalar catálogo padrão" (só administrador); cada tanque com "Produtos aceitos" do estoque (L ou KG, até 20). **Abastecimentos:** Máquina/Veículo → Produto → Tanque (só com mais de um) → Local → quantidade na unidade do Produto → medidor → "Completou o tanque?" → revisar → confirmar; o estoque baixa **exatamente** a quantidade digitada, sem conversão; capacidade conferida só para Produto em L; consumo km/L, L/h, km/kg ou kg/h. **Produto e Gestão P3:** unidade "LITROS (L)"; KG e SACO byte a byte como antes. **Mapa Geral:** depósito soma só Produtos em kg (P-11). **Saem:** as páginas `FamiliasPatrimoniais`, `TiposPatrimoniais`, `PerfisMedicao` e `Combustiveis`, perfis de medição, medições de benfeitoria, tipos de combustível, vínculo combustível × produto, fator kg/L e a ação `configurar_conversao`. **Fora:** manutenção, OS, custo/hora, saldo de tanque, unidade que não seja L nem KG |
| Backend | Rotas removidas respondem 404; Abastecimentos 16 → **11** rotas; nova `GET /bens-patrimoniais-opcoes/produtos`; famílias e tipos guardados pela tela de Bens ([cobertura](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md)). Idempotência v2 do abastecimento (recibo v1 nunca reaproveitado) |
| Migration | `20261110300000_patrimonio_simplifica`, **CONTRACT** (exceção única): guarda fail-closed (0 abastecimento CONFIRMADO, impressão das contagens aprovada, papel dono das 13, nada criado fora das migrations), **apaga as 13 tabelas do Patrimônio** com os dados de todos os clientes, alarga 2 CHECKs de `OperacaoFinanceiraItem` para aceitar `'L'` e cria 7 tabelas no formato novo (inclusive `TanqueBemProduto`). SHA-256 `787d6d118939c6eca4e3c3f45bf94a4f94d1f1625cbfb2ea2102b190ad944222`. Repositório: 39 → **40** migrations, 85 → **79** tabelas. `deploy:migrate` remoto só aplica com `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-162`, que só o `premerge-migrate --aplicar --contract D-PROD-162` define. **Não aplicada em nenhum ambiente remoto** |
| Release | Migration **antes** do merge, pelo runbook [`MAIKE-PATRIMONIO-SIMPLIFICA-01-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-SIMPLIFICA-01-RUNBOOK-RELEASE.md), **executado em 2026-11-11** (caminho B; PR #239 mergeada em `87e8a5ca`; deploy READY; postcheck R1–R9 e C1–C4 ok; registro no §11 do runbook). Entre o `COMMIT` e o deploy READY o runtime antigo responde 500 no Patrimônio e em 3 rotas de produto/empresa: merge imediato, `main` congelada, horário de pouco uso. Dado apagado só volta pelo backup do banco inteiro; reversão de schema só até a primeira escrita (P-12) |
| GO do proprietário | Escrito em 2026-11-10 para a limpeza em produção: "pode apaguar oque tiver lançado dessas tabelas", "olha pode fazer não precisa pedir confirmação ok, pode fazer", "ok apague oque tiver faça oque tem que fazer". Alcance e limites na D-PROD-162: as barreiras técnicas fail-closed continuam valendo |
| Relatório | [`MAIKE-PATRIMONIO-SIMPLIFICA-01-REPORT.md`](./MAIKE-PATRIMONIO-SIMPLIFICA-01-REPORT.md) |
| Antes dela | Estoque P0-01 (D-PROD-161): PR #238 mergeada na `main` (`e8472481`, 2026-11-11 00:27:25 UTC), sem migration. Antes, UX-02 (D-PROD-160): PR #237 mergeada (`e39d318b`, 2026-11-10 19:51:48 UTC), sem migration. Produção: 39 migrations, 85 tabelas |

## Missão anterior (2026-11-10) — MAIKE-ESTOQUE-P0-01: motor físico único, ENTRADA ≠ MOVIMENTAÇÃO (D-PROD-161)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-161** (a D-PROD-160 é a da PR #237, já mergeada), autorizada pelo proprietário na missão (2026-11-10) |
| Branch / PR | `claude/maike-estoque-p0-motor-unico-01`, base `origin/main` `e3ea4c39` (PRs #232, #234 e #235 mergeadas), com a `main` integrada por merge · PR [#238](https://github.com/maikelimaadm-stack/MAIKE/pull/238) **mergeada** na `main` (`e8472481`, 2026-11-11 00:27:25 UTC; registrado pela SIMPLIFICA-01) |
| Escopo | Um único motor físico (`estoqueFisicoMotor.js`): suplementação e transferência entre locais migradas para o FIFO Decimal com CAS (o segundo FIFO em `Number`, `fifoEstoque.js`, foi apagado; corrigido o lote de destino com ano 2001); Cadastro de Produtos sem efeito de estoque (`estoque_atual` é cache derivado: POST só 0, PATCH só o valor atual sem efeito, troca de empresa e DELETE bloqueados com estoque, CSV sem estoque, aviso no formulário); escritas genéricas fechadas (`POST /movimentacoes-estoque`, `POST`/`DELETE /estoque-lotes-nota` e `PATCH` de lote fora da renomeação → 409 `ESTOQUE_ESCRITA_DIRETA_RECUSADA`); reconciliação somente leitura `GET /estoque-fisico/reconciliacao` (só administrador real). A reconciliação tem orçamento por chamada, páginas por chave de produto (órfãos incluídos) e exclusões legadas como fase própria. O cursor é HMAC amarrado ao tenant e ao escopo, e a conclusão global só é COMPROVADA num snapshot único. Bloqueios R2-1/2/3 ficam registrados para a P1. No fechamento R2 também entraram as máscaras do Cadastro de Produtos (o valor exibido agora é o gravado) e a folha "Local de Destino" do celular dentro do diálogo certo. Nenhuma tela nova |
| Migration | **Nenhuma (zero DDL)**: `git diff origin/main -- backend/prisma` vazio. `SCHEMA_APPLIED_PROD = N/A` |
| Produção (só leitura) | Preflight 2026-11-10 15:50 UTC: 39/39 migrations, 0 produto com cache divergente, 0 lote fora de faixa/situação, 0 lote de transferência com ano 2001, 0 saldo sem fato, 0 número provisório, 0 movimento fora do protocolo (2 produtos, 2 lotes, 3 movimentos, 1 local). Nada foi corrigido nem escrito |
| Release | Sem migration: o merge manual do proprietário publica o código. Nada a aplicar no banco |
| Testes / CI | Pós-merge da `main` (`6da66a55`), em PG17 local novo: `verify:all` integral PASS; backend 1593/1598 (0 fail, 5 todo); testes de tela 2353/2353; gates 716/716. E2E reais nos pools 3 e 5, sem 5xx: estoque 8/8 em 1280/390/412, Central Financeira 68/68, Patrimônio 27/27, UX-02 25/25. CI `quality` verde ([run 42917240485](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/42917240485)). Detalhes no relatório §11 |
| Relatório | [`MAIKE-ESTOQUE-P0-01-REPORT.md`](./MAIKE-ESTOQUE-P0-01-REPORT.md) |
| Antes dela | Patrimônio UX-02 (D-PROD-160): PR #237 mergeada na `main` (`e39d318b`), sem migration |

## Missão anterior (2026-11-10) — MAIKE-PATRIMONIO-UX-02: abastecimento orientado pelo Produto associado ao combustível (D-PROD-160)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-160**, autorizada pelo proprietário na missão (2026-11-10). Refina só a UX e a leitura de elegibilidade da D-PROD-159; nenhuma decisão anterior é reescrita. **Superada quase inteira pela D-PROD-162** |
| Branch / PR | `claude/maike-patrimonio-ux-02-abastecimento-produto`, base `origin/main` `e3ea4c39` (merge da PR #235) · PR [#237](https://github.com/maikelimaadm-stack/MAIKE/pull/237) **mergeada** na `main` (`e39d318b`, 2026-11-10 19:51:48 UTC; registrado pela SIMPLIFICA-01) · HEAD final e CI registrados no relatório |
| Escopo | **Combustíveis:** seção "Produtos associados nesta fazenda" no cadastro e na edição (Associados, Inativos, Disponíveis; vários de uma vez; o combustível novo já sai com os Produtos, com resultado explícito e repetição só do que falhou). **Novo abastecimento:** Máquina/Veículo → **Produto** (o nome real; o tipo de combustível sai do fluxo) → tanque só se houver mais de um → local automático com um só saldo → litros, medidor, "Completou o tanque?" → "Revisar abastecimento" → confirmar. Lista com Data, Máquina/Veículo, Produto, Litros, Medidor e Situação. Trocar o Produto associado vale para os próximos abastecimentos, sem editar o bem e sem reescrever o histórico. **Fora:** schema, migration, FIFO, custo, medidor, estorno, RLS, concorrência, APIs mutativas, `TanquesBem.jsx`, mapas e financeiro |
| Backend | Só uma rota nova, **de leitura**: `GET /patrimonio-abastecimentos-opcoes/produtos-do-bem` (A16, guarda `pat-abastecimentos` `visualizar`, instantâneo RepeatableRead só leitura, resumo do conjunto inteiro). As 16 rotas da tela continuam classe **a** ([cobertura](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md)). Os corpos de prévia, confirmação, cancelamento, vínculo e fator não mudam |
| Migration | **Nenhuma.** `schema.prisma` e migrations intocados; repositório e produção continuam com 39 migrations e 85 tabelas |
| Release | Sem migration. Mergeada pelo proprietário (`e39d318b`); deploy e smoke de produção não foram conferidos pela SIMPLIFICA-01 |
| Relatório | [`MAIKE-PATRIMONIO-UX-02-ABASTECIMENTO-PRODUTO-REPORT.md`](./MAIKE-PATRIMONIO-UX-02-ABASTECIMENTO-PRODUTO-REPORT.md) |
| Antes dela | P1-02 (D-PROD-159): migration aplicada em produção (2026-11-10, 13:18:33 UTC) e PR #235 mergeada (`e3ea4c39`, 13:41:02 UTC) |

## Missão anterior (2026-11-10) — MAIKE-PATRIMONIO-P1-02: abastecimentos e consumo de combustível da frota (D-PROD-159)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-159**, autorizada pelo proprietário na missão (2026-11-10). Constituição: nota de expansão em [`00-CONSTITUICAO.md`](../constitution/00-CONSTITUICAO.md) e em [`07-DO-NOT-DO.md`](../constitution/07-DO-NOT-DO.md) |
| Branch / PR | `claude/maike-patrimonio-p1-02-abastecimentos`, base `origin/main` `a2347741` (PRs #232 e #234 mergeadas) · PR [#235](https://github.com/maikelimaadm-stack/MAIKE/pull/235) **mergeada** na `main` (`e3ea4c39`, 2026-11-10 13:41:02 UTC; registrado pela UX-02) · código final `6dd34014` |
| Escopo | Página nativa **Abastecimentos** (`pat-abastecimentos`) no grupo Patrimônio e Frota: fator kg/L por fazenda × combustível × produto, informado pelo responsável e versionado; prévia sem escrita; confirmação transacional com baixa **física real em KG** pelo motor de estoque (FIFO por lote, custo FIFO final, origem `abastecimento_patrimonio`, nenhum lançamento financeiro); idempotência por `operation_id`; cancelamento com estorno exato das fatias; leitura do medidor no próprio abastecimento (série monotônica, sem gravar o bem); consumo km/L ou L/h pelo tanque cheio declarado. Permissões negadas por padrão (`visualizar`, `novo`/`salvar`, `cancelar`, `configurar_conversao`). **Fora:** manutenção, OS, compras, financeiro, custo/hora, depreciação apurada, transferência, mapas, dashboards, saldo de tanque |
| Migration | `20261110200000_patrimonio_p1_02_abastecimentos`, expand-only: 3 tabelas novas (`ConversaoCombustivelProduto`, `AbastecimentoBem`, `AbastecimentoBemConsumoLote`), nenhum DDL em tabela antiga. SHA-256 `20f8f9609a8e09f123dac0ed7ba87747069b26ad07411e843481ffec59b15fba`, hash do DO `ac1d201b0ef75b629d018b8c3c98354eb9453d752ab5e62ee4c3edb23c14bddd`, pinados. Repositório: 39 migrations, 85 tabelas. **Aplicada em produção em 2026-11-10 às 13:18:33 UTC** com GO expresso do proprietário, caminho B; postcheck completo no §11 do runbook (`SCHEMA_APPLIED_PRODUCTION: SIM`). Produção: 39 migrations, 85 tabelas |
| Release | **Concluído na ordem certa:** migration aplicada (acima) e, depois dela, merge manual da PR #235 (`e3ea4c39`; registrado pela UX-02). Deploy e smoke de produção não foram conferidos pela UX-02. A migration precisava vir **antes** do merge (o runtime novo sem as tabelas daria 500 também em `GET`/`PATCH /bens-patrimoniais/:id`, `PATCH`/`DELETE /estoque-lotes-nota/:id` e `DELETE /empresas/:id`). Runbook com preflight, aplicação, postcheck e rollback de schema vazio: [`MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md) |
| Testes / CI | `verify:all` 39/39 PASS em `6dd34014` (1157 s) · CI run [42761888698](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/42761888698) verde em `6dd34014` (18 min 31 s) · contagens no relatório §15 |
| Relatório | [`MAIKE-PATRIMONIO-P1-02-ABASTECIMENTOS-REPORT.md`](./MAIKE-PATRIMONIO-P1-02-ABASTECIMENTOS-REPORT.md) |
| Antes dela | P1-01 (D-PROD-157): PR #232 mergeada (`76edc913`) e migration aplicada em produção (2026-11-09, 23:04:22 UTC). P3-03 (D-PROD-158): migration aplicada (21:32:01 UTC) e PR #234 mergeada (`a2347741`). Produção: 38 migrations |

## Missão anterior (2026-11-09) — MAIKE-GESTAO-P3-03: editar, excluir e duplicar lançamentos (D-PROD-158)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-158** (nasceu como D-PROD-157; renumerada ao integrar a `main` `76edc913`, onde a D-PROD-157 é o Patrimônio P1-01). O comentário dentro do `migration.sql` da P3-03, já aplicado em produção, ainda diz D-PROD-157 e fica imutável (checksum) |
| Branch / PR | `claude/maike-gestao-p3-03-editar-excluir-duplicar`, PR #234 **mergeada** na `main` (`a2347741`; registrado pela P1-02), depois de integrada com a `origin/main` `76edc913` (PR #232, Patrimônio) por merge não destrutivo |
| Escopo | Na tela `LancamentosFinanceiros`: **Editar** documento confirmado por retificação (no lugar, quando a assinatura física não muda; por substituição, com estorno e documento novo de mesmo número, quando muda); **Excluir** confirmado de forma lógica (estorno, `excluido_em`, evento); **Duplicar** como rascunho novo. Bloqueios por liquidação, consumo de lote e movimento posterior. Histórico em `OperacaoFinanceiraEvento` e AuditLog |
| Migration | `20261109300000_gestao_p3_03_editar_excluir`, expand-only: colunas anuláveis `OperacaoFinanceira.excluido_em` e `.retificado_em` e tabela nova `OperacaoFinanceiraEvento`. SHA-256 `3f3af00e…df890b`. **Aplicada em produção em 2026-11-09 às 21:32:01 UTC** (caminho B, GO escrito), 37 migrations, conferida pelo §6 do runbook |
| Release | **Concluído:** GO, preflight, backup comprovado (PITR desligado), ensaio local, migration, conferência e merge manual da PR #234 (`a2347741`). Deploy e smoke não foram conferidos pela P1-02. Runbook com o §11 preenchido: [`MAIKE-GESTAO-P3-03-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-03-RUNBOOK-RELEASE.md) |
| Relatório | [`MAIKE-GESTAO-P3-03-EDITAR-EXCLUIR-DUPLICAR-REPORT.md`](./MAIKE-GESTAO-P3-03-EDITAR-EXCLUIR-DUPLICAR-REPORT.md) |
| Antes dela | P3-02 (D-PROD-156) em produção: migration aplicada em 2026-11-09 às 17:42:13 UTC e PR #231 mergeada (`e4e907ea`) |

## Missão anterior (2026-11-09) — MAIKE-PATRIMONIO-P1-01: cadastros patrimoniais, frota e parâmetros operacionais (D-PROD-157)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-157** (nasceu como D-PROD-156; renumerada ao integrar a `main`, onde a D-PROD-156 é a Gestão P3-02), autorizada pelo proprietário na missão (2026-11-09). Constituição: nota de expansão em [`00-CONSTITUICAO.md`](../constitution/00-CONSTITUICAO.md) |
| Branch / PR | `claude/maike-patrimonio-p1-01-cadastros-inventario` · PR #232 **mergeada** na `main` (`76edc913`) |
| Escopo | Grupo de menu **Patrimônio e Frota** com 5 telas nativas (`BensPatrimoniais`, `FamiliasPatrimoniais`, `TiposPatrimoniais`, `PerfisMedicao`, `Combustiveis`): bens por fazenda com código patrimonial e código de frota, medições físicas, medidor de uso, tanques com combustíveis permitidos, aquisição e depreciação com prévia só simulada. **R2:** vínculo combustível × produto por empresa na tela Combustíveis e contrato só de leitura dos produtos elegíveis de um bem (para a P1-02). **Fora:** abastecimento, manutenção, financeiro, estoque, apuração de depreciação e transferência |
| Migration | `20261110100000_patrimonio_p1_01_cadastros` (expand-only, 10 tabelas novas, nenhum DDL em tabela antiga; nunca aplicada em ambiente remoto, por isso ampliada na R2 com `TipoCombustivelProduto`). SHA-256 final `b8818ba8f16528580b7ba6053b0c89f07f0d4fd434955f4b9c5830a62ffd64dc`, hash do DO `01dbf9ae4875444fa77082d37e1b71da655f217ecc25cc95a4d1b8a4a108a0a3` (os da R1 são inválidos). Com a `main`: 37 migrations, 81 tabelas. **Não aplicada em produção** |
| Release | **Incidente de sequência:** a PR #232 foi mergeada (`76edc913`, deploy às ~21:41 UTC) **antes** de a migration `20261110100000_patrimonio_p1_01_cadastros` ser aplicada. Às 22:30 UTC (só leitura) a migration não estava aplicada e os domínios de produção serviam o deploy anterior `afbebcbc`. **Depois, por outro fluxo:** migration aplicada em 2026-11-09 às 23:04:22 UTC (checksum `b8818ba8…ffd64dc`, `applied_steps_count = 1`). A produção ficou com 38 concluídas e 0 com falha, 82 tabelas, as 10 do Patrimônio vazias, com RLS sem FORCE e 0 grants públicos, e o advisor com 0 alertas (conferido por esta PR, só leitura, às 23:19 UTC). Os domínios continuavam em `afbebcbc`. Runbook: [`MAIKE-PATRIMONIO-P1-01-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-P1-01-RUNBOOK-RELEASE.md) |
| Relatório | [`MAIKE-PATRIMONIO-P1-01-REPORT.md`](./MAIKE-PATRIMONIO-P1-01-REPORT.md) |
| Antes dela | Gestão P3-02, rateio por item (D-PROD-156): mergeada na `main` pela PR #231 (`e4e907ea`), migration aplicada em produção; P3-01 (D-PROD-155) idem pela PR #230 |

## Missão anterior (2026-11-09) — MAIKE-GESTAO-P3-02: rateio gerencial por item (D-PROD-156)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-156**, autorizada pelo proprietário na missão de 2026-11-09, depois do merge da P3-01 |
| Branch / PR | `claude/maike-gestao-p3-02-rateio-por-item`, PR #231 **mergeada** pelo proprietário (`e4e907ea`) |
| Escopo | Na mesma tela `LancamentosFinanceiros` e só com produtos, o rateio pode ser Geral (padrão) ou Por item. Por item, cada linha é dividida por natureza e centros, em valor ou percentual, sobre o **líquido** do item. A soma é exata por item e no total, os dois modos nunca convivem e existe um resumo consolidado. Não há efeito novo em títulos, estoque ou custo |
| Migration | `20261109200000_gestao_p3_02_rateio_por_item`, expand-only: coluna anulável `OperacaoFinanceira.rateio_escopo` e tabela nova `OperacaoFinanceiraItemRateio`. SHA-256 `df4d1ab2…2076f4a0` pinado. **Aplicada em produção em 2026-11-09 às 17:42:13 UTC** (caminho B, GO escrito) e conferida pelo §6 do runbook |
| Release | **Concluído:** GO, preflight, ensaio local, migration (36 concluídas), conferência e merge manual da PR #231 (`e4e907ea`), com deploy em produção. Runbook com o §11 preenchido: [`MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md) |
| Relatório | [`MAIKE-GESTAO-P3-02-RATEIO-POR-ITEM-REPORT.md`](./MAIKE-GESTAO-P3-02-RATEIO-POR-ITEM-REPORT.md) |
| Antes dela | P3-01 (D-PROD-155) em produção: migration aplicada em 2026-11-09 às 14:08:36 UTC e PR #230 mergeada (`f2b81e1b`) |

## Missão anterior (2026-11-09, rodada 4) — MAIKE-GESTAO-P3-01: Central Única de Lançamentos (D-PROD-155)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-155**, autorizada pelo proprietário na missão (2026-11-08). Constituição: nota de expansão em [`00-CONSTITUICAO.md`](../constitution/00-CONSTITUICAO.md) |
| Branch / PR | `claude/maike-gestao-p3-01-lancamento-unico` · PR #230, **mergeada** pelo proprietário (`f2b81e1b`) |
| Escopo | Página nativa `LancamentosFinanceiros` (tela `ges-lancamentos-financeiros`): documento PAGAR/RECEBER com ou sem produtos, rateio global, títulos/parcelas, liquidação manual e efeito de estoque só na confirmação (estorno no cancelamento), por comando composto. **Fora:** conciliação, bancos/OFX, DRE, plano de contas, fiscal, câmbio, contabilidade, caixa/bancos, rateio por item, pedido de compra, relatórios/dashboards |
| Migration | `20261109100000_gestao_p3_01_central_lancamentos` (8 tabelas novas, expand-only). SHA-256 `bb89f4e0…4a451dc18a` (rodada 4), DO `0289125d…ab4fe`, pinados. **Aplicada em produção em 2026-11-09 às 14:08:36 UTC** (caminho B, GO escrito do proprietário), conferida pelo runbook §6 |
| Custo (rodada 4) | Custo de aquisição **líquido**: desconto e acréscimo do cabeçalho rateados entre as linhas pelos maiores restos; lote = líquido ÷ kg (4 casas), movimento = líquido exato; resíduo explícito fora do FIFO, recusado acima de 0,1% da linha, nunca menos que 1 unidade mínima da moeda (`custo_kg_nao_representavel`) |
| Vercel | `vercel.json` fixa `maxDuration` 60 s para `api/fastify.js`; vale no deploy de produção depois do merge (não comprovado em produção) |
| Release | **Concluída:** GO, preflight, backup diário comprovado (PITR desligado), migration (35 concluídas), conferência, merge manual da PR #230 (`f2b81e1b`) e deploy de produção `dpl_2oFTcopkiQv1YqQD9sv282zdy7q4` READY. Smoke só leitura feito: health 200, rota 200, API anônima 401, só o FSTDEP023 preexistente nos logs. Pendente: Max Duration de 60 s no painel da Vercel. Runbook, com o §11 preenchido: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md) |
| Relatório | [`MAIKE-GESTAO-P3-01-LANCAMENTO-UNICO-REPORT.md`](./MAIKE-GESTAO-P3-01-LANCAMENTO-UNICO-REPORT.md) |
| Antes dela | Gestão P1 (D-PROD-146) e P2 (D-PROD-153): cadastros de Parceiros, Centros e Naturezas, sem lançamento |

---

## Backend, migrations e deploy

| Campo | Valor |
|---|---|
| Plano operacional | `docs/engineering/PLAN-BACKEND-MIGRACAO-100.md` |
| Migrations no repositório | **18** (`backend/prisma/migrations/`) — até `20261028240000_p8_supabase_public_revoke_rls` |
| Models Prisma (domínio + fundação) | Fundação P3 + mapa P4 + cadastros/manejo P5.x + hygiene P6.1 (schema completo pós-P5.5) |
| Runner de produção | `npm run deploy:migrate` — variável **`MIGRATION_DATABASE_URL`** (sem fallback para `DATABASE_URL`) |
| Banco local | `npm run db:up` (Docker `postgres:16.13-alpine`) + `npm run prisma:deploy` |
| Testes backend | `npm run test:backend` — **142** testes; falha dura sem `DATABASE_URL`. Rodada integrada da D-PROD-137 (HEAD `1e2b9fc5`, `node --test`): **998** testes, 993 passam, 0 falhas, 5 `todo` |
| Monólito Vercel | `api/fastify.js` + `vercel.json` reescreve **todas** as rotas nativas para `/api/fastify` (correção 2026-10-27) |
| Supabase (MAIKE) | **18/18** `_prisma_migrations` (P8 D-PROD-56 aplicado 2026-10-28: RLS 40/40, grants anon/authenticated zerados; ver `P8-SUPABASE-PUBLIC-GRANTS-RLS-REPORT.md`) |
| Deploy | Monólito Vercel + Supabase; `npm run deploy:migrate` no pipeline quando `MIGRATION_DATABASE_URL` definida |
| Certificação agente 2026-10-27 (pós-P7) | `/health` **200**; rotas `/marcas`, `/empresas`, `/lancamentos-tarefa` **401** sem JWT; Vercel MCP enxerga projeto `maike`; login autenticado não repetido (senha fora do repo) |

Checklist operacional de go-live: [`PRODUCAO-GO-LIVE-CHECKLIST.md`](./PRODUCAO-GO-LIVE-CHECKLIST.md).

Variáveis críticas: `DATABASE_URL`, `MIGRATION_DATABASE_URL` (pre-deploy), `AUTH_SECRET`,
`FRONTEND_ORIGINS`, `VITE_MAIKE_API_URL` (build frontend). Detalhes em `.env.example`.

---

## Migração Base44 × banco — auditoria 2026-10-27

**Não falta migração de entidades nem DDL pendente** para o escopo do produto.

| Verificação | Resultado |
|---|---|
| `allowedBase44Entities` (35) × models Prisma | **100%** — `User` → `Usuario`; zero entidade do manifesto sem tabela |
| Migrations repo × Supabase `_prisma_migrations` | **14/14** |
| Runtime `src/` → Base44 como provider de dados | **Ausente** — registry vazio; APIs nativas |
| Próximo trabalho de plataforma | **P8** (RLS se PostgREST, observabilidade, release) — não schema |

Telas vazias ou poucos registros (ex.: lotes, produtos) são **conteúdo operacional**
(bootstrap de tenant via `npm run auth:bootstrap:local`; empresa e cadastros pela UI
`/Empresa` e demais rotas), não lacuna de migração. Relatório completo:
[`GAP-AUDIT-POS-BASE44-2026-10-27.md`](./GAP-AUDIT-POS-BASE44-2026-10-27.md).

Arquivos `base44/entities/*.jsonc` e entradas no manifesto são **spec legada** —
não implicam que o app ainda persista na Base44.

---

## Cadastros — o que funciona hoje

**Matriz operacional (menu, rota, backend nativo vs Base44, UI, produção):**
[`CADASTROS-E-MODULOS-STATUS.md`](./CADASTROS-E-MODULOS-STATUS.md).

Resumo: **todas as telas do escopo** persistem no PostgreSQL via APIs nativas (`src/apis/*` → monólito Vercel). **Base44** permanece só como schemas JSONC de referência (`base44/entities`) — sem SDK nem provider de dados (P5.5 + P7). Não há tela de **Cliente** (tenant) — só bootstrap. Áreas não têm menu próprio: use **Mapa Geral** / **Cadastro do Mapa**. Matriz detalhada: [`CADASTROS-E-MODULOS-STATUS.md`](./CADASTROS-E-MODULOS-STATUS.md).

---

## Programa UX Base1 (cadastros)

| Campo | Valor |
|---|---|
| Plano | `docs/engineering/PLAN-EXECUCAO-PARIDADE-BASE1.md` |
| Piloto único | **Marcas** — checklist `docs/engineering/MARCAS-MODELO-BASE1-CHECKLIST.md` |
| Rollout demais cadastros | **Pausado** até aceite proprietário (**H.5**) — **D-PROD-41** |
| Gate §H (checklist modelo) | **H.1–H.4, H.6** DONE; **H.5** TODO (produto) — ver `MARCAS-MODELO-BASE1-CHECKLIST.md` |
| Merges UX Base1 (2026-10-26) | #51–#58 · **#59** `eb3866ee` · **#60** `d05304d4` (UX-50 SSOT limpar filtros+busca) |
| Próximo passo Marcas | **Aguardando H.5** — aceite proprietário via `docs/engineering/MARCAS-H5-MANUAL-TEST.md` (matriz screenshots + smoke: `cadastroListaClearFilters`, prefs coluna, camadas fpop) |

---

## Programa

**MAIKE Pecuária — Mapa Geral + Manejo.** Sistema nativo e escalável; persistência
100% PostgreSQL no escopo. Base44 resta só como **especificação JSONC** no
repositório (D-PROD-04 / P7 opcional de arquivo).

| Campo | Valor |
|---|---|
| Produto | Pecuária — Mapa Geral + Manejo (D-PROD-01) |
| Superfície primária | `MapaGeral` (D-PROD-05) |
| Missão em execução | **MAIKE-GESTAO-P3-03 — editar, excluir e duplicar lançamentos** (**D-PROD-158**, PR #234 draft; ver "Missão ativa" no topo). Antes dela: **P3-02** (D-PROD-156), PR #231 mergeada; **P3-01** (D-PROD-155), PR #230 mergeada. Registro anterior desta linha: **Missão integrada: autorização real e preferências do Mapa Geral** (**D-PROD-137**, então a decisão mais recente). Parte 1 na `main` (PR #205). Parte 2 na branch `claude/autorizacao-preferencias-integradas` (HEAD `1e2b9fc5`). Relatório: `MAIKE-MISSAO-INTEGRADA-AUTORIZACAO-PREFERENCIAS-REPORT.md`. Antes dela: **P8 — Hardening** (**D-PROD-56**); catálogo **D-PROD-57/60/62** (#126/#130/#132); UX Base1 **H.5**; MapLibre M1/M2-A/M2-B1/M2-B2/M2-B3 (**D-PROD-58/59/61/63/64**, #127/#129/#131/#133/#134) em `main`; **MapLibre áreas unificadas + Mapa Geral MapLibre + satélite Map Tiles** (**D-PROD-65**, R1 polígonos) **mergeada** em `main` (#139, merge `e8540e7d`, CI 40876450764 verde); **paridade visual do editor de polígonos** (**D-PROD-66**) **mergeada** (#141); **fechar/finalizar polígono e prévia do formulário** (**D-PROD-67**) **mergeada** (#142); **pontos médios no cadastro de área aberta** (**D-PROD-68**, `MAPLIBRE-PONTOS-MÉDIOS-NO-CADASTRO-03`) na branch `claude/new-session-26kpxu` — PR DRAFT, merge só após auditoria |
| Última mergeada (runtime) | **P7 — Base44 legacy cleanup** (PR **#85**, D-PROD-52); dados nativos fechados em **P5.5** (PR #84) |
| Mergeadas anteriores | P3 — Backend + Prisma + PostgreSQL Foundation (PR #10, merge `4ce4608`), com a P3-R1; P2 — ModeloBase1 Pecuário Foundation (PR #7, merge `1851503`); SSOT sincronizada nas PRs #8 (`378bfd3`) e #11 (`672ea99`); emenda D-PROD-22 na PR #9 (merge `44b204c`) |
| Próxima fatia autorizável | **P8 — Hardening and Release** (ver `ROADMAP.md`) |
| Contrato de dados | `config/modelobase1-pecuario.json` — **oficial**; obrigatório para P3–P6 |
| Escopo executável | `config/mapa-manejo-scope.json` |
| Roadmap | `docs/engineering/ROADMAP.md` |
| Molde arquitetural | PROJETOMG, parcial (D-PROD-03) |

**OWNER-SECURITY-01 continua aberto.** A PR #1 foi mergeada pelo proprietário em
2026-08-03 **sem** que a confirmação de rotação da chave do Google Maps tenha
sido registrada. O merge não muda a exposição: a chave antiga permanece no
histórico Git, agora também na `main`. Revogação, criação de chave nova,
restrição por HTTP referrer e por API (Maps JavaScript API e Geometry — a
Drawing Library saiu do loader na P1.2-R1 e não é mais necessária) e
armazenamento apenas em `.env.local` seguem pendentes com o proprietário — ver
`docs/engineering/P0.1-R1-CORRECTIVE-HARDENING-REPORT.md`.

## Progresso por missão

| Missão | Nome | Estado |
|---|---|---|
| P0 | Product Scope Reset | **mergeada** (PR #1, merge `508cf62`) |
| P1 | Native Foundation Bootstrap | **concluída e mergeada** — P1.1 a P1.3 em PRs anteriores; P1.4 e P1.4-R1 na PR #6, merge `7398d85`. Os seis eixos de `gate:api-boundary` estão em zero |
| P2 | ModeloBase1 Pecuário Foundation | **mergeada** (PR #7, merge `1851503`) — inclui a correção P2-R1 |
| P3 | Backend + Prisma + PostgreSQL Foundation | **concluída e mergeada** (PR #10, merge `4ce4608`) — `backend/` com Fastify, Prisma e PostgreSQL; cinco models; `gate:tenancy` e `gate:indices`. Inclui a correção **P3-R1** |
| P4 | Mapa Core Native Persistence | **concluída** — P4.0–P4.3 mergeadas; geografia e setor/área nativos em produção |
| P5 | Manejo Core Native Persistence | **concluída (P5.x + P5.5)** — lotes, movimentações, bebedouros, manejo técnico nativos; ver relatórios P5.x |
| P6 | Supporting Capabilities | **majoritariamente entregue** — cadastros, tarefas, empresa, usuários/permissoes nativos; entrada de estoque (DBT-04) permanece; endereçada pela Gestão P3-01 (D-PROD-155) só pelo lançamento confirmado, pendente de merge e release |
| P7 | Base44 Final Removal | **runtime concluído** (PR **#85**) — sem SDK/`VITE_BASE44_*` em `src/`; opcional: arquivar schemas `base44/` e ratchet |
| P8 | Hardening and Release | **em curso** — fatia grants/RLS (**D-PROD-56**) aplicada no remoto; restam CSP/cookies, observabilidade, release |

## Inventário

Números medidos após `npm ci` e `npm run build` finais.

| Métrica | Antes da P0.1 | pós-P0.1 | pós-P1.1 | pós-P1.2 | pós-P1.3 | Depois da P1.4 |
|---|---|---|---|---|---|---|
| Páginas em `src/pages` | 102 | 16 | 16 | 16 | 16 | **16** |
| Arquivos em `src/` | 472 | 203 | 209 | 230 | 245 | **263** |
| Arquivos em `src/components` | 312 | 157 | 157 | 156 | 156 | **155** |
| Schemas em `base44/entities` | 87 | 38 | 38 | 38 | 38 | **38** |
| Functions em `base44/functions` | 11 | 1 | 1 | 1 | 1 | **1** |
| Dependências diretas (`dependencies`) | 63 | 31 | 31 | 31 | 31 | **31** |
| Dependências diretas (`devDependencies`) | 15 | 18 | 18 | 18 | 18 | **18** |
| Arquivos em `src/` com SDK/base44Client | 197 | 71 | 71 | 46 | 27 | **4** |
| Ocorrências de `base44.entities` | 1014 | 371 | 368 | 230 | 151 | **38** |
| Ocorrências de `base44.auth` | 29 | 16 | 16 | 14 | 14 | **10** |
| Ocorrências de `base44.integrations` | 24 | 6 | 6 | 5 | 4 | **1** |
| Ocorrências de `base44.functions` | 9 | 5 | 5 | 5 | 4 | **1** |
| Acoplamento Base44 fora de `src/` | 22 | 1 | 1 | 1 | 1 | **1** |
| Chaves Google Maps literais | 8 | 0 | 0 | 0 | 0 | **0** |
| Erros de lint | 64 | 0 | 0 | 0 | 0 | **0** |
| Diagnósticos `tsc` (cobertura total) | — | 2.802 | 2.797 | 2.759 | 2.728 | **2.319** (teto 2.319) |
| Testes automatizados | 0 | 183 | 377 | 478 | 625 | **817** (323 de gate + 494 de smoke) |
| Bundle de produção — JS | 4.347,45 kB | 2.461,36 kB | 2.464,58 kB | 2.474,37 kB | 2.482,90 kB | **2.496,61 kB** |
| Bundle de produção — CSS | 120,36 kB | 77,00 kB | 77,00 kB | 77,00 kB | 77,00 kB | **77,00 kB** |

**Depois da P2**, todos os números acima permanecem idênticos: a missão não
tocou em `src/`, `base44/`, `vite.config.js` nem no manifesto de escopo. Só duas
métricas mudaram, e as duas por acréscimo de verificação:

| Métrica | Depois da P1.4 | Depois da P2 | Depois da P3-R1 | Depois da P4.0 | Depois da P4.1 |
|---|---|---|---|---|---|
| Testes automatizados | 817 (323 gate + 494 smoke) | 862 (368 gate + 494 smoke) | 964 (428 gate + 495 smoke + 41 backend) | 1.046 (452 gate + 534 smoke + 60 backend) | **1.140** (494 gate + 556 smoke + 90 backend) |
| Etapas do `verify:all` | 13 | 14 | 18 | 19 | **20** |
| Dependências diretas | 49 | 49 | 55 | 56 | **56** (38 `dependencies` + 18 `devDependencies`) |
| Bundle de produção — JS | 2.496,61 kB | 2.496,61 kB | 2.496,62 kB | 2.504,83 kB | **2.505,17 kB** (671,56 kB gzip) |
| Dívida de tipos em `src/` | 2.319 | 2.319 | 2.319 (teto 2.319) | 2.318 (teto 2.318) | **2.318** (teto 2.318) |
| Arquivos em `src/` | 263 | 263 | 263 | 263 | **271** |
| Models Prisma | — | — | 5 | 5 | **6+** (fundação + domínio mapa + P6.1) |
| Migrations versionadas | — | — | 1 | 1 | **6** (2026-10-27) |
| Registry literal do provider | 38 | 38 | 38 | 38 | **37** (o manifesto menos `Setor`) |
| Ocorrências de `base44.entities` | 38 | 38 | 38 | 38 | **37** |

A **P4.1** é a primeira missão desde a P1.4 a mexer no registry do provider, e a
primeira a fazê-lo **para baixo**: `Setor` saiu porque a persistência dele é
nativa (D-PROD-25). `base44/entities/Setor.jsonc` continua existindo e `Setor`
continua em `allowedBase44Entities` — `syncEntityReferences` ainda o cita, e
`gate:product-scope` exige manifesto e schemas iguais nos dois sentidos. Por
isso `schemas` continua 38 enquanto `entitiesRefs` caiu para 37.

O bundle cresceu 0,34 kB (+0,01%): a porta nativa e os dois códigos de erro
novos custam mais que o `setoresProvider` removido. Continua sem code splitting
(DBT-06).

A diferença de 0,01 kB na linha do bundle é arredondamento entre ambientes de
medição — as colunas P1.4 e P2 vêm da CI, as colunas P3 vêm de build local
reproduzível. O artefato é o mesmo: base `44b204c` e HEAD da P3-R1 produzem o
**mesmo hash de chunk** (`index-nzvr8O-2.js`) quando construídos com
`NODE_ENV=production`.

**A primeira versão da P3 tinha, sim, uma regressão de bundle na CI** — 3.555,01
kB —, e ela não era do backend: eu havia definido `NODE_ENV: test` no `env:` do
job do workflow, o que alcançava o `npm run build` e fazia o Vite empacotar as
bibliotecas em modo de desenvolvimento. A inflação reproduz igual no commit base,
onde backend não existe. Corrigido na P3-R1 em duas pontas — `NODE_ENV` saiu do
workflow e `verify:all` fixa `production` no passo de build —, com cinco casos
travando as duas. Ver §16.3 do relatório da P3.

Os 45 testes novos são MB1-01 a MB1-20 com sub-casos, todos executando o gate
real em diretórios temporários. Oito deles vieram da **P2-R1**, que fechou três
invariantes que o contrato declarava e o gate não protegia: `headers` e `cookie`
nas fontes proibidas de tenant, `headers` nas fontes proibidas do ator de
auditoria, e o escopo `empresa` da numeração. O contrato JSON e o documento
arquitetural não mudaram — o defeito estava só no verificador. Ver §14 do
relatório da P2.

As quatro ocorrências restantes de SDK/`base44Client` em `src/` são, todas,
**dentro da fronteira**: o client (`src/api/base44Client.js`), o adapter
autorizado (`src/apis/_providers/base44Provider.js`) e as duas referências que o
adapter faz a `base44.auth` e `base44.integrations`. Nenhuma página, componente,
hook, lib ou service acessa o provider.

Os artefatos do bundle vêm da CI do **último commit com mudanças executáveis**
desta PR — não de um build local nem de uma execução anterior.

Os artefatos da P1.4 vêm da CI do commit funcional desta PR — o run e o job
ficam registrados no corpo da PR #6, porque um commit não pode conter o
resultado da própria execução.

| Artefato | Tamanho | gzip |
|---|---|---|
| `dist/assets/index-CcAJh1Vu.js` | 2.496,61 kB | 668,91 kB |
| `dist/assets/index-DM5ihJ4E.css` | 77,00 kB | 13,31 kB |
| `dist/index.html` | 0,48 kB | 0,31 kB |

O hash do JS mudou porque a P1.4 alterou `src/`; o do CSS não mudou porque
nenhuma folha de estilo foi tocada. O bundle cresceu 13,71 kB (+0,55%) — os
quatro módulos de API novos, os onze services e os módulos de domínio custam
mais do que os acessos diretos que substituíram. Continua sem code splitting
(DBT-06).

Baselines mecânicos: `scripts/gates/base44-baseline.json` (schema 2) e
`scripts/gates/typecheck-baseline.json` (schema 3: contrato de configuração —
D-PROD-13 — e teto certificado monotônico — D-PROD-17).

## Fronteira de dados (P1.1, D-PROD-18)

| Eixo do `gate:api-boundary` | `main` pós-P0.1 | pós-P1.1 | pós-P1.2 | pós-P1.3 | Depois da P1.4 |
|---|---|---|---|---|---|
| arquivos que importam `@/api/base44Client` | 68 | 67 | 42 | 23 | **0** |
| arquivos que usam `base44.entities` | 64 | 63 | 38 | 20 | **0** |
| arquivos que usam `base44.auth` | 13 | 13 | 9 | 8 | **0** |
| arquivos que usam `base44.integrations` | 5 | 5 | 3 | 2 | **0** |
| arquivos que usam `base44.functions` | 5 | 5 | 5 | 3 | **0** |
| arquivos com acesso computado a `entities` | 3 | 3 | 3 | 2 | **0** |

Cada eixo é uma **lista de caminhos**, não um número: trocar um arquivo por
outro do mesmo tamanho reprova. Todos os eixos acima são subconjuntos estritos
do estado anterior — nenhum arquivo entrou.

Saíram de todos os eixos: `src/pages/Empresa.jsx` (P1.1) e, na P1.2,
`MapaGeral`, `MapaCadastro`, `useSetorAreas`, os 20 componentes de
`src/components/mapa/`, `manejoValidations` e o antigo `mapaOfflineCache`, que
foi removido e substituído por `src/services/mapaCacheService.js`.

O adapter autorizado `src/apis/_providers/base44Provider.js` não conta como
dívida — ele é a fronteira. Registry literal do provider após a P1.4: **38
entidades**, exatamente iguais a `allowedBase44Entities` do manifesto. A P1.4
acrescentou só `Marca` e `UnidadeMedida`, e apenas porque passaram a ter
consumidor migrado.

A P1.3 migrou os cadastros do manejo — lotes, setores, categorias, categorias de
manejo, bebedouros e anexos — e **removeu** os dois repositórios legados
(`loteRepository`, `bebedouroRepository`), sem shim.

A P1.4 migrou os 23 caminhos restantes — casca, autenticação, configurações,
produtos, marcas, unidades, locais de estoque, tarefas, usuários e suplementação
— e **removeu os três monkey patches globais** que o client instalava sobre o
SDK: normalização de texto, guardas de exclusão e runtime offline. Os arquivos
`src/lib/entityDeleteGuards.js` e `src/lib/offlineEntitySync.js` foram excluídos;
`historicoSuplementacaoUtils.jsx` virou `src/services/suplementacaoHistoricoService.js`.
Com isso os seis eixos ficaram em zero e o baseline versionado tem as seis
listas vazias: **qualquer reintrodução reprova**.

Não restam arquivos legados. A P1 está tecnicamente fechada na branch: a única
porta para a Base44 é `src/api/base44Client.js`, consumido só por
`src/apis/_providers/base44Provider.js`.

A **P1.4-R1** não migrou caminho nenhum — corrigiu quatro defeitos que a
contagem zerada escondia: o formato de erro do provider ainda atravessava três
camadas (agora `sessionApi` classifica uma vez e devolve `{ok, value}` /
`{ok, reason}`), o teto de tipos caiu porque a verificação do `Button` fora
desligada com `any` (agora o contrato é declarado de verdade), o rastro de falha
parcial do rename afirmava menos do que havia acontecido, e
`PRODUTO_PARTIAL_IMPORT` estava catalogado sem nenhum chamador. Ver
`docs/engineering/P1.4-NATIVE-API-BOUNDARY-SUPPORT-ADMIN-REPORT.md` §15.

## Contrato base pecuário (P2, D-PROD-21)

A P2 não migrou caminho nenhum, não criou backend e não tocou em `src/`. Ela
transformou identidade, tenancy, timestamps, auditoria, numeração, anexos,
exclusão, concorrência e vocabulário de erro em **contrato versionado e
verificável**, para que a P3 implemente Prisma contra um acordo escrito em vez de
decidir cada regra sob pressão de migration.

| Artefato | Caminho |
|---|---|
| SSOT executável | `config/modelobase1-pecuario.json` |
| Documento legível | `docs/architecture/MODELOBASE1-PECUARIO-CONTRACT.md` |
| Gate | `scripts/gates/gate-modelobase1-pecuario.mjs` |
| Testes | `scripts/tests/gates/modelobase1-pecuario.test.mjs` |
| Relatório | `docs/engineering/P2-MODELOBASE1-PECUARIO-FOUNDATION-REPORT.md` |

O nome vem do PROJETOMG; o significado, não. Lá `ModeloBase1` é o motor visual
de cadastro. Aqui é contrato de dados — não é template visual, não cria runtime
genérico, não cria low-code e não substitui as telas atuais (D-PROD-21).

O gate é **absoluto**: sem `--update`, sem baseline, sem correção automática e
sem escrita no arquivo, nem quando o contrato está inválido. Onze códigos
`P2-MB1-*`, 11 seções obrigatórias, 8 códigos de erro mínimos e 10 padrões
proibidos.

O contrato só seria **oficial** depois do merge humano da PR, e o merge
aconteceu: PR #7, merge `1851503`, 2026-08-28. **O contrato está oficial e
vigente** — é obrigatório para P3, P4, P5 e P6, e nenhuma migration de domínio
pode divergir dele.

A P2 incluiu a correção **P2-R1**, que fechou três invariantes declaradas no
contrato e não protegidas pelo gate: as fontes proibidas de tenant passaram de
três para as cinco do SSOT (`body`, `query`, `params`, `headers`, `cookie`), o
ator de auditoria ficou com as quatro que o SSOT declara, e o escopo `empresa`
da numeração passou a ser exigido junto com `tenant`. Cada uma ganhou prova
negativa executando o gate real — ver §14 do relatório da P2.

## Backend nativo (P3, D-PROD-23)

Pela primeira vez o repositório tem backend próprio. `backend/` existe, com
Fastify, Prisma e PostgreSQL, na camada `route → service → repository → Prisma`.

| Item | Valor |
|---|---|
| Models | 5 — `Cliente`, `Usuario`, `AuditLog`, `EntidadeCodigoSequencia`, `RegistroAnexo` |
| Migration | `backend/prisma/migrations/20260908174141_p3_foundation/` |
| Banco local | Docker Compose, `postgres:16.13-alpine`, versão fixada |
| Banco na CI | serviço efêmero do GitHub Actions, mesma versão, `DATABASE_URL` do job |
| Sessão | JWT via `@fastify/jwt`; senha em hash bcrypt |
| Gates novos | `gate:tenancy`, `gate:indices` — absolutos, sem baseline |
| Typecheck próprio | `npm run typecheck:backend` — `jsconfig.backend.typecheck.json`, tolerância zero, sem baseline |
| Testes | 55 de gate (38 tenancy + 17 indices) e 41 de backend contra PostgreSQL real |

**Nenhum model de domínio foi criado.** Mapa e manejo ficam para P4–P6, uma
capacidade por vez. **À época da P3** o backend ainda não era consumido pelo
frontend: `src/` não foi tocado, e a fronteira da P1 continuava apontando
inteiramente para o provider Base44. A **P4.0** mudou isso para a autenticação —
ver a seção abaixo; o domínio geográfico segue na Base44 até a P4.1.

Duas invariantes do contrato que só o banco prova, e que aqui estão provadas:
40 reservas concorrentes de sequência sem número duplicado (BE-17), e auditoria
dentro de transação revertida que não sobrevive ao rollback (BE-25).

**Duas correções que os testes obrigaram**, ambas de defeito real e não de
fixture. O Fastify vem com `removeAdditional` ligado: um `cliente_id` enviado no
corpo do login era **descartado em silêncio**, não recusado — numa superfície de
tenancy, silêncio é pior que erro, e agora vira 400. E o handler de erro
normalizava qualquer exceção do framework em `INTERNAL_ERROR`, de modo que
requisição malformada devolvia **500** em vez de 400 — o servidor se culpando
por erro do cliente.

### P3-R1 — fechamento corretivo

A auditoria da P3 apontou cinco bloqueios, todos corrigidos na mesma branch e na
mesma PR. Três deles eram **invariante declarada e não verificada** — a mesma
classe da P2-R1:

| # | Defeito | Correção |
|---|---|---|
| B1 | O repositório da sequência criava a linha por `INSERT` cru com `gen_random_uuid()`, contornando o `@default(cuid())` que o schema declarava | `createMany({ skipDuplicates: true })`, que compila para `ON CONFLICT DO NOTHING` e preserva a idempotência. Prova negativa: `P3-TEN-RUNTIME-IDENTITY` |
| B2 | `AuditLog → Usuario` referenciava só o `id`: auditoria do cliente A podia apontar para usuário do cliente B | FK **composta** `[cliente_id, usuario_id] → [cliente_id, id]`, com `@@unique([cliente_id, id])` em `Usuario`. Migration regerada. O PostgreSQL recusa A×B (R1-T06) e o evento de sistema com `usuario_id` nulo continua válido por `MATCH SIMPLE` (R1-T07) |
| B3 | Bundle inflado na CI, ~1 MB acima do patamar | Não era do backend: era `NODE_ENV: test` no `env:` do job, que alcançava o `npm run build`. Ver acima |
| B4 | `backend/` sem cobertura de tipos — lacuna declarada na P3 | `jsconfig.backend.typecheck.json` e `typecheck:backend`, tolerância zero. Os 10 diagnósticos reais foram corrigidos no código, com module augmentation do Fastify — sem `any`, sem `@ts-ignore` |
| B5 | `prisma validate` existia como script e não rodava na cadeia | Passou a ser obrigatório, antes de `generate` e `migrate deploy` |

O isolamento por tenant passou a ser provado pelo caminho **service → repository**
(R1-T09), e não por um `WHERE` escrito dentro do teste — que provaria o `WHERE`,
não a aplicação.

Um detalhe vale registro porque a lição não é óbvia: a primeira versão da regra
de identidade em runtime era um `grep` por `randomUUID` e **reprovou o próprio
repositório** — `requestContext.js` usa `randomUUID()` para o id de correlação da
requisição, que é uso legítimo. A regra foi reescrita para casar só na **posição
de identidade**, e TEN-27 existe como controle positivo para impedir que alguém a
alargue de volta para um scanner textual ingênuo.

## Transporte e sessão nativos (P4.0, D-PROD-24)

Pela primeira vez o navegador fala com o backend próprio. A P4.0 não migrou
capacidade nenhuma — ela construiu a estrada que a P4.1 vai usar.

| Item | Valor |
|---|---|
| URL do backend | `VITE_MAIKE_API_URL` — pública, sem override por query string ou storage |
| Fronteira HTTP | `src/apis/_core/nativeHttpClient.js`, única |
| Sessão | JWT do MAIKE em memória + `sessionStorage`, guarda única; com "Manter conectado" no armazenamento persistente, validade `AUTH_TOKEN_TTL_LEMBRAR` (D-PROD-136) |
| Login | `{cliente, login, senha}` — **nunca** `cliente_id` |
| CORS | `FRONTEND_ORIGINS`, allowlist de origins exatas, sem wildcard |
| Gate novo | `gate:native-api` — absoluto, 7 códigos, 24 provas |
| Bootstrap | `npm run auth:bootstrap:local` — script, não endpoint |
| Estados da sessão | `carregando` · `autenticada` · `nao_autenticada` · `validacao_indisponivel` |

**Nenhum model de domínio.** O schema Prisma está inalterado e não há migration
nova; `Setor` e `AreaPastagem` continuam só na Base44.

A dívida de erros que a P3 declarou **fechou**: os oito códigos do contrato
ModeloBase1 entraram em `src/apis/_core/ApiError.js`, com mensagem pública
própria, agora que existe consumidor real.

**A autenticação do aplicativo deixou de ser da Base44**, e não há fallback: se
o backend MAIKE não responde, o usuário vê falha de login. Dual-auth silenciosa
transformaria "o backend caiu" em "sua senha está errada". Com isso, `authRefs`
caiu de 10 para 5 — `redirectToLogin` autenticaria no provider errado, e o
`logout` da Base44 **não deve** ser chamado, porque descartaria o token do SDK
que chega uma única vez pela query string.

Duas coisas ficam ditas sem maquiagem. `sessionStorage` é acessível a
JavaScript: um XSS nesta origem lê o token, e a troca por `localStorage`
**reduz a janela, não a classe do problema** — cookie `HttpOnly`, refresh com
rotação, revogação e CSP são P8. E o logout é local, porque o JWT da P3 é
stateless e não há sessão a invalidar no servidor.

**A P4.0-R1 corrigiu um bloqueador que a auditoria externa encontrou** depois da
CI verde do primeiro HEAD: a restauração da sessão apagava o JWT para *qualquer*
erro, então um backend fora do ar por trinta segundos destruía a sessão de quem
estava trabalhando e pedia senha de novo — punindo o usuário por uma falha de
infraestrutura. Pior: o comentário que eu havia escrito justificava o
comportamento, o que o fazia parecer deliberado.

Agora as duas classes são separadas por **código**: `TENANT_CONTEXT_REQUIRED`
limpa o token; rede, timeout, CORS e 5xx **preservam** o token e levam ao estado
`validacao_indisponivel`, onde o aplicativo continua fechado, o login **não**
aparece, e o usuário recebe *Tentar novamente* — que reusa o mesmo JWT, sem
pedir senha. Fail-closed sem destruir a credencial. Ver §19 do relatório da P4.0
e D-PROD-24 §G.1.

Um detalhe de processo que se repetiu pela terceira vez: **duas regras do gate
novo reprovaram o próprio repositório** na primeira versão — `getNativeApiUrl`
casava na definição, e `Authorization` casava no provider da Base44, que monta
esse cabeçalho legitimamente. É a mesma classe de falso positivo da P3-R1. A
correção foi tornar a regra precisa (verificar *posição*, não palavra), com
controles positivos que quebram se alguém alargar de volta.

## Setor nativo (P4.1, D-PROD-25)

A **primeira capacidade de domínio** a sair da Base44.

| Camada | Antes da P4.1 | Depois da P4.1 |
|---|---|---|
| Persistência | entidade `Setor` da Base44 | `model Setor` no PostgreSQL, tenant-scoped, migration `20260909112833_p4_1_setor_native` |
| Leitura do cadastro | `setoresProvider.list` | `GET /setores`, autenticado |
| Leitura do mapa | `mapaProvider.listSetores` — **segunda** leitura do mesmo agregado | a **mesma** função, reexportada de `@/apis/setores` |
| Criação | `POST` na Base44 com `numero_setor` calculado no navegador | `POST /setores`; o número vem de `EntidadeCodigoSequencia` |
| Numeração | `MAX + 1` sobre a lista carregada | sequência atômica, escopo `tenant`, na transação da criação |
| Atualização | `PATCH` na Base44 | `PATCH /setores/:id`, autenticado |
| Exclusão | `DELETE` na Base44, com guarda de vínculo | **não existe rota**; recusa local com `SETOR_DELETE_UNAVAILABLE` |
| Auditoria | nenhuma | `AuditLog` na mesma transação da escrita |
| Offline | cache + fila sobre as operações da Base44 | cache + fila sobre as operações **nativas** |

O `MAX + 1` não era questão de estilo. A lista carregada é uma **fotografia**:
dois navegadores criando setor ao mesmo tempo liam o mesmo máximo e pediam o
mesmo número. `BE-P41-08` cria 12 setores em paralelo contra PostgreSQL real e
exige exatamente 1..12 — o caso que uma criação em série nunca distinguiria.

Três decisões que custam explicação e estão registradas em D-PROD-25:

- **escopo `tenant`, não `empresa`** (§B): `Empresa` só é nativa na P6, e o
  backend não consegue validar o `empresa_id` que recebe. Ancorar uma sequência
  num identificador não verificável criaria uma sequência por string arbitrária;
- **sem `DELETE`** (§D): a guarda de vínculo consulta quatro entidades que ainda
  vivem na Base44. Todas as formas de conciliar as duas bases numa operação
  destrutiva são inseguras, e a recusa tem código próprio — nunca
  `SETOR_DELETE_BLOCKED`, que afirmaria um vínculo não verificado;
- **corpo montado por lista literal** (§G): o objeto da tela de edição carrega
  `id`, `numero_setor` e `created_date`, e o registro criado offline carrega
  `_isOffline` e um id `offline_…`. A filtragem mora na porta, e não no service,
  porque o replay da fila chama as operações direto. **A regra de identidade do
  backend não foi enfraquecida para acomodar o offline** — o offline é que
  passou a respeitá-la.

`gate:setor-native` trava **doze** invariantes, com **54 provas** quase todas
negativas. Ver `docs/engineering/GATE-REGISTRY.md`.

### P4.1-R1 — fechamento corretivo

Três defeitos achados em revisão da própria PR e corrigidos dentro dela, como a
P4.0-R1 foi na PR #12. Os dois primeiros existem porque a P4.1 mudou **quem
autentica o replay** da fila offline:

- **escrita entre tenants.** Cache e fila eram particionados por
  `entidade::empresa_id`, sem tenant, e `logout()` descarta só o JWT. O replay
  passou a mandar `Authorization: Bearer` do MAIKE e o backend grava pelo tenant
  do token, então a operação enfileirada pelo cliente A era aplicada dentro do
  cliente B que entrasse depois no mesmo navegador. Agora cache, fila e replay
  têm dono, e a entrada de outro dono fica na fila até ele voltar — pular não é
  perder;
- **fila legada travando tudo.** `operacoesNativas` não tem `delete`. Uma
  exclusão enfileirada antes do corte estourava `TypeError`, e o replay retorna
  no primeiro erro: a fila **inteira**, de todas as entidades, parava ali para
  sempre. Entradas anteriores ao corte não têm dono, e são descartadas — a única
  perda de dado deste desenho, dita em vez de escondida;
- **obrigatório só com espaço.** `minLength: 1` aceitava `" "`, que virava
  `null` na normalização e `INTERNAL_ERROR` 500 no Prisma. `pattern: '\\S'` move a
  recusa para a fronteira, com 400.

Nada do backend foi afrouxado: o tenant continua vindo só do token. A correção é
toda do lado do navegador, que era quem estava errado. Gate
`P41-SETOR-OFFLINE-TENANT`, provas SN-13 a SN-18 e OFF21 a OFF29. Ver D-PROD-25 §L.

## Base URL nativa (P4.0-R2, D-PROD-26)

Correção de um defeito que **chegou ao usuário**, e a primeira desta missão que
não veio de análise e sim de produção.

`VITE_MAIKE_API_URL` estava na Vercel como `maike-production.up.railway.app`,
sem `https://`. Como `nativeRequest` concatena base e caminho, o `fetch` recebeu
uma URL **relativa** e o navegador a resolveu contra a origem do frontend: o
`POST /auth/login`, com a senha no corpo, foi para a Vercel, que respondeu `404`
em `text/plain`. Na tela, erro genérico de login.

O que isso ensinou, e está registrado em D-PROD-26:

- **o sintoma mentia.** `curl` contra o backend autenticava com `200`; só o
  navegador falhava. Backend, banco, JWT e CORS estavam corretos o tempo todo;
- **configuração ausente falhava bem; configuração malformada, não.** A P4.0 já
  tratava `null` corretamente (`PROVIDER_UNAVAILABLE`, sem tocar na rede). O
  buraco era o valor presente e inválido;
- **o custo foi credencial no host errado**, não indisponibilidade.

`getNativeApiUrl()` agora normaliza host puro para `https://`, preserva
`http://`/`https://` explícitos e devolve `null` para toda forma ambígua —
`//outro.host`, `javascript:`, `ftp://`, caminho relativo. Gate próprio,
`P4-NATIVE-SCHEME`, com provas negativas NAT-25/26/27 e controle positivo
NAT-28.


## Sem backfill da Base44 (P4.1-R2, D-PROD-27)

Decisão do **proprietário**, não do arquiteto: os registros históricos da Base44
**não** serão migrados. As capacidades nativas nascem vazias e o que for
necessário é recadastrado.

Some do caminho: backfill, dual-write, reconciliação de contagem/checksum,
rollback de dado e downtime de corte. Sobra migração de **capacidade** — schema,
rotas, serviços, troca de provider.

O que a decisão **não** autoriza, e está escrito porque é fácil ler errado:

- **não** apagar `Cliente`, `Usuario`, `AuditLog`, `EntidadeCodigoSequencia`,
  `RegistroAnexo` ou `Setor` já existentes no backend nativo;
- **não** apagar nada da Base44 — ela continua sendo a fonte de 37 entidades em
  produção;
- **não** fazer limpeza automática em lugar nenhum sem ação explícita e nomeada
  do proprietário.

Cada capacidade migrada aparece zerada na tela até ser recadastrada. É esperado.

A premissa está oficializada; o replanejamento das fases é trabalho da próxima
fatia, com auditoria própria. A **P4.2 continua não iniciada**.

## Gates ativos

20 etapas em `npm run verify:all` — ver `docs/engineering/GATE-REGISTRY.md`.
Todos os gates têm teste com casos de falha reais em `scripts/tests/gates/`; a
catraca de tipos é exercitada ponta a ponta, com `tsc` de verdade em projetos
temporários.

CI em `.github/workflows/quality.yml`.

| Commit | Conteúdo | Run | Resultado |
|---|---|---|---|
| `3c03ecf` | **commit funcional** da P1.1 | [30812723777](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30812723777) | **verde**, 13/13 |
| `df3e6f1` | certificação de estado da P1.1 | [30812950738](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30812950738) | **verde**, 13/13 |
| `8866768` | **commit funcional** da P1.1-R1 | [30815360716](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30815360716) | **vermelha** — `no-secrets` (ver abaixo) |
| `9447884` | correção do relatório da P1.1-R1 | [30815727984](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30815727984) | **verde**, 13/13 |
| `4acd1d4` | **commit funcional** da P1.1-R2 | [30818797942](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30818797942) | **verde**, 13/13 |
| `5946809` | **commit funcional** da P1.1-R3 | [30836332701](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30836332701) | **verde**, 13/13 |
| `6d88794` | certificação de estado da P1.1-R3 | [30836737386](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30836737386) | **verde**, 13/13 |
| `9767545` | **commit funcional** da P1.1-R4 | [30841392611](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30841392611) | **verde**, 13/13 — origem dos artefatos |
| `48d6d66` | **commit funcional** da P1.2 | [30847666490](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30847666490) | **verde**, 13/13 |
| `98b966d` | **commit funcional** da P1.3 | [30868215796](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30868215796) | **verde**, 13/13 |
| `344accb` | **commit funcional** da P1.3-R1 | [31007455901](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31007455901) | **verde**, 13/13 |
| `c72f892` | **commit funcional** da P1.3-R2 | [31009031928](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31009031928) | **verde**, 13/13 |
| `dc7e022` | fechamento documental da P1.3 | [31012186549](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31012186549) | **verde**, 13/13 |
| P1.4 | **commit funcional** da P1.4 | CI registrada no corpo da PR #6 | — |
| P1.4-R1 | **commit funcional** da P1.4-R1 | CI registrada no corpo da PR #6 | — |
| `3c1a90d` | **commit funcional** da P2 | [31108882141](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31108882141) | **verde**, 14/14 |
| `acc2f11` | **commit funcional** da P2-R1 | [31125606483](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31125606483) | **não executou** — ver abaixo |
| `8a5e3ee` | commit vazio da P2-R1, para disparar CI | — | nenhum run criado |
| `80ecf69` | **commit funcional** da P3 | [34243753654](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34243753654) | **verde**, 17/17 |
| `5bcee77` | **HEAD certificado** da P3-R1, mergeado na PR #10 | [34260918759](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34260918759) | **verde**, 18/18 |
| `0185d10` | **commit funcional** da P4.0 | [34269584058](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34269584058) | **verde**, 19/19 |
| `f01201b` | **HEAD certificado** da P4.0-R1, mergeado na PR #12 | [34272006608](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34272006608) | **verde**, 19/19 |
| `8c477f9` | **commit funcional** da P4.1 | [34349251485](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34349251485) | **verde**, 20/20 |

Um commit não pode conter o resultado da própria execução de CI. A execução do
commit funcional fica no corpo da PR aberta — PR #2 para a P1.1, PR #3 para a
P1.2, PR #5 para a P1.3, PR #6 para a P1.4 e a P1.4-R1, PR #7 para a P2, PR #10
para a P3 e a P3-R1, PR #12 para a P4.0 e a P4.0-R1, PR #14 para a P4.1.

Ao contrário da P2-R1, a P3 entrou na `main` com **execução de CI própria e
verde sobre o HEAD exato que foi mergeado**: o job `102178796058` do run
`34260918759` rodou as 18 etapas em `5bcee77`, e é esse commit que o merge
`4ce4608` trouxe. A lacuna declarada em `acc2f11` não se repetiu.

**O commit `acc2f11` entrou na `main` sem execução de CI própria.** Não houve
reprovação: o job `92695474512` nasceu na fila às 18:16:53 de 2026-08-06, nunca
recebeu runner (`runner_id: 0`, 0 ms faturados) e foi cancelado 15 minutos
depois. Re-run pela API foi aceito mas nunca enfileirou; um commit vazio no
mesmo HEAD não gerou run nenhum, enquanto o Vercel fez deploy normalmente no
mesmo push — ou seja, o gatilho chegava e o Actions não executava. A evidência
que existe para esse commit é o `verify:all` local, 14/14 com exit 0, mais a CI
verde do commit imediatamente anterior. O proprietário mergeou com esse quadro
registrado no corpo da PR #7. **A primeira execução verde na `main` cobre essa
lacuna** — até lá, ela fica declarada aqui em vez de escondida.

O run vermelho de `8866768` fica registrado em vez de omitido. A reprovação foi
legítima: o relatório da própria P1.1-R1 citava um par nome-de-chave mais
literal ao explicar um achado, e `gate:no-secrets` casa esse padrão em qualquer
arquivo versionado, prosa incluída. Corrigido em `9447884`; ver DBT-17 para o
motivo de o `verify:all` local não ter pego antes.

## Débito conhecido

| # | Item | Tratamento |
|---|---|---|
| DBT-01 | **Fechado na P1.4.** Nenhum componente, página, hook, lib ou service acessa `base44`. As 37 ocorrências de `base44.entities` que restam estão todas dentro do adapter autorizado, uma por entidade do registry — eram 38 até a P4.1 migrar `Setor` | fechado |
| DBT-02 | `requiresAuth: false` em `src/api/base44Client.js` | P3 |
| DBT-03 | 2.318 diagnósticos de dívida de tipos versionados na catraca, com teto certificado de 2.318. A catraca impede crescimento em qualquer modo (D-PROD-17) e impede afrouxar a configuração (D-PROD-13). Trajetória: 2.802 → 2.759 (P1.2) → 2.728 (P1.3-R1) → 2.323 (P1.4, −405) → 2.319 (P1.4-R1, com o contrato de props do `Button` declarado de verdade, sem `any`) → **2.318** (P4.0, com o contrato do `AuthContext` declarado) → 2.318 (P4.1, estável: o diagnóstico que o código novo introduziu foi corrigido no código, não absorvido). A P2 e a P3 não mexeram em `src/` e por isso não reduziram nada. *O número de abertura desta linha dizia 2.319 desde a P4.0, contradizendo a própria trajetória e a tabela de inventário do mesmo documento; corrigido na P4.1.* | P4–P8 |
| DBT-04 | Sem tela de **entrada** de estoque (D-PROD-08). **Endereçado pela Gestão P3-01 (D-PROD-155), em produção desde 2026-11-09 (PR #230):** a entrada passa a existir só como efeito do lançamento confirmado de compra com mercadoria (`LancamentosFinanceiros`, comando composto do motor de estoque). Não há tela avulsa de entrada, e `MovimentacoesEstoque`/`LancamentoProdutosEstoque` continuam proibidas | P6 → fechado pela PR #230 (merge `f2b81e1b`) |
| DBT-05 | Chave Google Maps antiga permanece no histórico Git — revogar e rotacionar (OWNER-SECURITY-01) | ação do proprietário |
| DBT-06 | Bundle único de ~2,50 MB, sem code splitting | P8 |
| DBT-07 | `LayoutCampo`/`LayoutSecao`/`LayoutConfiguracao` + `src/services/campoEngine.js` sustentam o formulário dinâmico de lote — um mini-motor de layout dentro do produto. A P2 é contrato de dados e não toca em UI (D-PROD-21); o desmonte acontece quando o lote migrar | P5 |
| DBT-08 | **Fechado na P1.4.** `src/lib/offlineEntitySync.js` foi removido. O runtime offline é provider-agnostic (`src/lib/offline/offlineEntityRuntime.js`) e o catálogo de entidades offline é montado literalmente pelo provider, uma chamada por entidade | fechado |
| DBT-09 | A numeração por `max + 1` lista a coleção inteira e não tem segurança de concorrência. Saiu das telas para os services na P1.4 (produtos, marcas, unidades, locais), o que torna a regra testável — mas duas criações simultâneas ainda podem receber o mesmo número. Fecha com o backend próprio | P3 |
| DBT-10 | **Fechado na P1.4.** `eslint.config.js` cobre `src/**`, `scripts/**` e `tests/**` inteiros, com globais por ambiente (browser, Node, Vitest/JSDOM). Sem `ignores` de diretório, sem regra desligada em massa e sem `eslint-disable` espalhado | fechado |
| DBT-11 | `npm audit` reporta vulnerabilidades nas dependências transitivas remanescentes | P8 |
| DBT-12 | `gate:types` fixa `typescriptVersion` no baseline. Atualizar o TypeScript exige `--rebase-contract` consciente — por desenho, mas é passo manual em toda subida de versão | P1 |
| DBT-14 | **Fechado na P1.4.** Zero arquivos importam `@/api/base44Client` fora do adapter. O baseline de `gate:api-boundary` tem as seis listas vazias, então qualquer reintrodução reprova | fechado |
| DBT-15 | **Fechado na P1.4.** As três telas que subiam arquivo (logotipo da empresa, ícone e sub-ícone) passam por `src/services/arquivoService.js` sobre `src/apis/arquivos/`. Upload sem `file_url` de volta virou falha explícita, em vez de gravar `undefined` no campo | fechado |
| DBT-16 | **Fechado na P1.4.** Os dois arquivos foram removidos. Nenhum acesso computado a `entities` sobrou: o eixo `dynamicEntityFiles` está vazio no baseline | fechado |
| DBT-18 | **Fechado na P1.4 para o repasse por argumento.** O gate reprova entregar o provider — ou um método cru dele — como argumento de qualquer chamada, que era o caminho pelo qual a capacidade cruzava para outro arquivo. Passar o **resultado** de uma chamada continua permitido, e há controle positivo (P14-N7). Continua fora do alcance a análise semântica de wrapper que só se resolve com dataflow entre módulos — mas sem argumento nem export, a capacidade não tem por onde sair | parcial · P3 |
| DBT-17 | **Fechado na P1.4.** `gate:no-secrets` varre rastreados **e** não rastreados não ignorados, deduplicados. Arquivo novo com segredo reprova antes do `git add`; `.env.local` ignorado continua fora da varredura, que é onde o segredo deve ficar | fechado |
| DBT-19 | Operação composta de manejo não é atômica: a Base44 não oferece transação multi-entidade. A P1.2 tornou a falha parcial **visível** (`MAPA_PARTIAL_OPERATION` com etapa concluída e etapa de falha), não a eliminou; a P1.4-R1 tornou o rastro do rename de local **fiel** — cada etapa é registrada quando conclui, com contagem por cocho. Some com o backend próprio | P3 |
| DBT-20 | `DetalhesLote.jsx` segue com ~1.300 linhas. A fronteira de dados fechou na P1.2 e as decisões puras saíram para `src/domain/lotes/`, mas o componente continua grande demais para revisão confortável | P5 |
| DBT-21 | A chave `VITE_GOOGLE_MAPS_API_KEY` vai para o bundle do cliente por definição do Vite. Não é defeito e não tem correção no código: a proteção é restrição por referrer e por API no Google Cloud, mais rotação e monitoramento (P1.2-R1) | ação do proprietário |
| DBT-22 | O sintoma `MAPS_CONFIG_MISSING` em produção não teve causa raiz confirmada. A leitura de env funcionava antes e depois da P1.2-R1 (medido em build real); a explicação compatível com a evidência é ausência da variável no serviço que executa `npm run build`, o que exige inspeção da plataforma de deploy | ação do proprietário |
| DBT-23 | O produto não tem backend nativo neste repositório: é frontend Vite consumindo `@base44/sdk`. Um serviço externo no Railway não é automaticamente o backend do frontend — integrar exige contrato de endpoints, autenticação e CORS. `VITE_BASE44_BACKEND_URL` pertence ao SDK da Base44 e não deve ser apontada para outro destino | P3 |
| DBT-24 | Validação de layout real depende de inspeção visual em produção. Os testes de shell provam estrutura e comportamento em JSDOM, que não calcula layout. Playwright não foi adotado | P8 |
| DBT-25 | **Fechado na P1.4.** `src/domain/numeroPtBR.js` lê vírgula e ponto: `'12,5'` → 12,5, `'1.234,56'` → 1234,56, campo em branco → `null` em vez de `NaN`. Aplicado no cadastro de setor e nos payloads de produto e CSV; o teste S3b foi invertido para fixar a leitura correta | fechado |
| DBT-26 | **Parcialmente fechado na P4.1.** `numero_setor` passou a vir de `EntidadeCodigoSequencia`, no escopo `tenant`, dentro da transação da criação — provado com 12 criações concorrentes contra PostgreSQL real (BE-P41-08). `numero_lote` continua com `max + 1` no cliente: `Lote` é P5 | parcial · P5 |
| DBT-27 | A exclusão de setor está **fechada**: não existe `DELETE /setores/:id`, e o frontend recusa com `SETOR_DELETE_UNAVAILABLE` sem ir à rede. Não é omissão — a guarda de vínculo consulta quatro entidades que ainda vivem na Base44, e nenhuma forma de conciliar as duas bases numa operação destrutiva é segura (D-PROD-25 §D). **Reabrir exige reconciliar `deleteRules` com os seis destinos de `syncEntityReferences`, as FKs nativas e a semântica de `Lote` e `PontoSuplementacao`** — não basta "as quatro dependências migraram" (D-PROD-25 §N) | P4.2 |
| DBT-28 | Setor criado **offline** não tem `numero_setor` até o replay: o número vem da sequência do servidor. A tabela mostra o campo vazio nesse intervalo. A alternativa — deixar o navegador escolher — seria reintroduzir o `MAX + 1` que a P4.1 removeu, e ainda por cima sem ver a lista inteira | P4.2 |
| DBT-29 | **Parcialmente fechado na P4.2.** `AreaPastagem` saiu: renomear um setor agora reescreve o `setor_nome` das áreas na mesma transação, nativamente (D-PROD-31). Os outros cinco destinos seguem. `syncEntityReferences` continua na Base44 e continua sendo chamada quando o nome de um setor muda: os **seis** destinos denormalizados (`AreaPastagem`, `PontoSuplementacao`, `Lote`, `LancamentoTarefa`, `MovimentacaoMapa`, `MovimentacaoPecuaria`) ainda são entidades de lá. É a única razão pela qual `Setor` permanece em `allowedBase44Entities`. **Não são os mesmos quatro da guarda de exclusão** — ver D-PROD-25 §N | P4.2 |
| **DEPLOY-MIGRATION-01** | **Fechado.** 01A (runner, gate, provas — D-PROD-28) na PR #19; 01B (ativação no Railway — D-PROD-29) nas PRs #20, #21 e #22. O deployment `f0dab2d0`, originado do merge `257eaaa`, aplicou `20260909201703_p4_1_r2_setor_tipo_default` pelo pre-deploy, em container separado do `backend:start`. Produção passou de **2** para **3** migrations e `Setor.tipo` ganhou o default `'Próprio'` sem ninguém rodar SQL à mão. Fica a regra do achado: configuração de deploy só vale no próximo deployment **originado da fonte** — `redeploy` reexecuta a especificação antiga e não prova ativação | fechado |
| DBT-30 | `deleteRules.Setor` (4 dependências) e os destinos de `syncEntityReferences` (6) não coincidem, e o SSOT tratava os dois como o mesmo contrato até a P4.1-R2. Reabrir o `DELETE` exige reconciliar os dois, mais as FKs nativas e a semântica de `Lote` e `PontoSuplementacao` — D-PROD-25 §N | P4.2 |
| DBT-31 | `AreaPastagem.quantidade_atual` e `status_ocupacao` continuam editáveis pelo cliente. Os dois descrevem ocupação, que é consequência de `Lote` — entidade da P5. Enquanto o lote não for nativo, o backend não tem como derivá-los sem consultar a Base44 (proibido); inventá-los produziria número errado com cara de calculado (D-PROD-30) | P5 |
| DBT-32 | `syncEntityReferences` continua na Base44 e continua citando `AreaPastagem` entre os destinos — ramificação que, desde a P4.2, escreve em dado que ninguém lê. Inofensiva; sai quando os outros cinco destinos migrarem. A propagação que importa passou a ser nativa e transacional (`propagarNomeDoSetor`) | P5–P6 |
| DBT-13 | `test:gates` leva ~42 s porque a catraca de tipos roda `tsc` de verdade em ~45 projetos temporários. É o preço de testar o gate real em vez do parser | P8 |
