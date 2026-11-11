# MAIKE-PATRIMONIO-SIMPLIFICA-01 — O Patrimônio recomeça do zero, simplificado

Decisão: **D-PROD-161** ([`DECISIONS.md`](./DECISIONS.md)). A branch nasceu sobre `origin/main`
`e39d318b` (merge da PR #237, Patrimônio UX-02).
Branch: `claude/new-session-abgn5w` · PR `<número>` (**DRAFT**) · código verificado: `<HEAD>`.
Runbook de release (não executado):
[`MAIKE-PATRIMONIO-SIMPLIFICA-01-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-SIMPLIFICA-01-RUNBOOK-RELEASE.md).

> **Esqueleto (frente F0).** As seções 1–4 e 12 trazem o que já está decidido. As seções
> marcadas **[a preencher]** só recebem conteúdo quando houver medição real: arquivos,
> contagens de teste, saída do `verify:all`, CI e desvios. Nenhum PASS é afirmado aqui sem a
> saída do comando (constituição P7).
>
> **Migration CONTRACT, não aplicada.** `20261110300000_patrimonio_simplifica` apaga as 13
> tabelas do Patrimônio, com os dados de todos os clientes, alarga 2 CHECKs de
> `OperacaoFinanceiraItem` e cria 7 tabelas no formato novo. Os testes rodam em PostgreSQL
> **local e descartável**. Nada foi executado em Supabase, Vercel ou outro ambiente remoto.

## 1. O que muda e o que fica igual

**Muda** (decisão do proprietário de 2026-11-10):
- O grupo **Patrimônio e Frota** fica com duas páginas: **Bens Patrimoniais** e **Abastecimentos**.
- **Famílias e Tipos** são escolhidos e criados dentro do formulário do Bem ("+ Nova família",
  "+ Novo tipo") e mantidos em "⋯ › Gerenciar famílias e tipos". O "Instalar catálogo padrão"
  vai para o "⋯", só para administrador.
- Cada **tanque** do bem diz quais **Produtos do estoque** aceita (L ou KG, até 20).
- O **abastecimento** escolhe a máquina e o Produto e baixa do estoque **exatamente** a
  quantidade digitada, na unidade do Produto, sem conversão. A capacidade do tanque só é
  conferida para Produto em litros.
- O **Produto** e a compra/venda da **Gestão P3** ganham a unidade **Litros (L)**.
- **Saem:** perfis de medição, medições de benfeitoria, o cadastro de Combustíveis, o vínculo
  combustível × produto, o fator kg/L e a ação `configurar_conversao`.
- O **Mapa Geral** deixa Produto em L fora dos indicadores de depósito em kg (P-11).

**Fica igual:** o motor FIFO, o custo e o estorno exato (mesma conta); o medidor do bem e o X2;
a Gestão P3 com KG e SACO, byte a byte; rebanho, suplementação, transferência de depósito (só o
rótulo do movimento de Produto em L muda), lotes de nota, empresas, fornecedores e X1; tenancy
(R9–R12) e `config/modelobase1-pecuario.json`; o Mapa Geral sem Produto em L.

## 2. ANTES → DEPOIS

| Tela / fluxo | ANTES (P1-01, P1-02, UX-02) | DEPOIS (SIMPLIFICA-01) |
|---|---|---|
| Menu Patrimônio e Frota | 6 telas: Bens, Abastecimentos, Famílias, Tipos, Perfis de medição, Combustíveis | 2 telas: Bens Patrimoniais e Abastecimentos |
| Família e Tipo | telas próprias, com permissões próprias | dentro do formulário do Bem ("+ Nova família", "+ Novo tipo"; na edição a Natureza fica travada na do bem) e "⋯ › Gerenciar famílias e tipos"; permissões da tela de Bens |
| Tanque do bem | "Combustíveis aceitos" (tipos de combustível) | "Produtos aceitos" do estoque, com selo de unidade (L/kg), filtro Litros/Quilos e aviso para Produto em KG |
| Medições de benfeitoria | aba Medições com perfil de medição | saem |
| Para abastecer um trator | 5 passos: combustível, vínculo com o Produto, fator kg/L, combustível no tanque, abastecimento em litros convertido para kg | 2 passos: Produto aceito no tanque, abastecimento na unidade do Produto |
| Novo abastecimento | Máquina → Produto (pelo vínculo do combustível) → litros, convertidos por fator | Máquina → Produto → Tanque (só com mais de um) → Local → Quantidade (L ou kg) → medidor → "Completou o tanque?" → revisar → confirmar |
| Produto | KG ou SACO | KG, SACO ou **LITROS (L)** |
| Compra P3 | item em KG, SACO (mercadoria) ou UN (serviço) | também L, só para Produto em L |

## 3. Decisões do proprietário, GO e padrões

- **D1 = A** Litros no Produto · **D2 = A** Produtos aceitos por tanque · **D4 = B** medições e
  perfis removidos · **D8 = B** Patrimônio do zero. Também: Famílias e Tipos dentro de Bens,
  menu só com Bens e Abastecimentos, sem tipo de combustível e sem fator kg/L.
- **GO escrito de 2026-11-10 para a limpeza em produção** (palavras literais): "pode apaguar oque
  tiver lançado dessas tabelas", "olha pode fazer não precisa pedir confirmação ok, pode fazer",
  "ok apague oque tiver faça oque tem que fazer". Alcance e limites na D-PROD-161.
- **Padrões P-01…P-12** do contrato (o proprietário não respondeu explicitamente): registrados
  na D-PROD-161, com o porquê de cada um.

## 4. Banco: migration CONTRACT

| Item | Valor |
|---|---|
| Migration | `20261110300000_patrimonio_simplifica` |
| SHA-256 do arquivo | `ea1edf7ec3b494233a8d48c7b160ad179c8d8e9b92cc6c041228f116907302c4` |
| Hash da guarda | `6fbcabd9358eebcd87f0a272b0072cca76bfaa4779314c8426fd13037490794e` |
| Hash do DO de RLS das 7 | `6fc88d930cdbc5038bb4d604abefb9e04d993e6e776bb851369b697a8f966a7e` |
| Tabelas | 85 → **79** (13 apagadas; 6 recriadas; `TanqueBemProduto` nova) |
| Migrations | 39 → **40** |
| Models | 84 → **78** (64 tenant-scoped) |
| Tabela antiga alterada | só `OperacaoFinanceiraItem` (2 CHECKs alargados com `'L'`) |
| Guarda | 0 CONFIRMADO; impressão das contagens igual à do preflight; papel dono das 13; nada criado fora das migrations; `lock_timeout` 5 s |
| Gate | modo CONTRACT fechado no premerge e autorização `MIGRATION_CONTRACT_AUTORIZADO` no runner |

Provas reais (PG 16 local descartável):
- `backend/tests/patrimonioSimplificaMigration.test.mjs`: 14/14. Parte de 39 migrations/85 tabelas com 2 clientes. Os 10 RED recusam com a mensagem própria, e nada muda em nenhum deles: CONFIRMADO, FK de fora, visão, trava (`55P03` em ~6,2 s), sem impressão, impressão errada, papel que não é o dono, gatilho, política, publicação. O runner sem a decisão recusa com `DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED`. O GREEN pelo `npm run deploy:migrate` dá 40/0 e 79 tabelas, as 7 vazias, dono/ACL iguais, RLS sem FORCE e PK/FK/CHECK/índices 7/31/32/55. A `fingerprint_v2` fica idêntica, os CHECKs aceitam `'L'`, o estoque fica idêntico e o `migrate diff` dá 0. A 2ª execução responde "No pending".
- CLI `scripts/dev/ensaio-patrimonio-simplifica.mjs`: OK (10 RED, recusa sem autorização e GREEN completo).
- **Caminho B (envelope do conector), ensaiado em 2026-11-11** com o arquivo exato (sha256 `ea1edf7e…02c4`), 1 cliente e 15 linhas semeadas:
  - impressão errada: recusa ("contagens … não são as aprovadas"), 85 tabelas intactas;
  - impressão certa: COMMIT, 79 tabelas, 40/0, estrutura 7·31·32·55, colunas 31/10/54/12/9/7/11, CHECKs com `'L'`;
  - repetir: `RELEASE_BLOCKED: migration já registrada`.

## 5. Gate CONTRACT e runner

Feitos RED → GREEN:
- `scripts/tests/deploy/premerge-migrate.test.mjs`: 31/31 (B1, B1f, B8-0, B8a–B8r, B9 em repositório git descartável, B10);
- `migrations.test.mjs` com o B11;
- `preflight-schema.test.mjs`: 10/10 (B12);
- `alvo-banco.test.mjs`: 26/26 (AB-05 com `lerHistorico` injetado).

No total, `scripts/tests/deploy`: 80/80, e `npm run test:gates`: 721/721.

## 6. Backend

O contrato §4 foi implementado:
- **Bens e tanques:** tanques com Produtos aceitos (`TanqueBemProduto`; mesma fazenda, ativo, L ou KG, até 20 por tanque). Um aceite retirado sem histórico é apagado; com histórico, é inativado.
- **Famílias e tipos:** `codigo` opcional, gerado do nome; guardas aceitam `pat-bens-patrimoniais`; o catálogo padrão traz só famílias e tipos.
- **Abastecimento:** a quantidade é na unidade do Produto (L ou KG) e a capacidade só é conferida em L. O consumo sai por unidade (km/L, L/h, km/kg, kg/h). Fingerprint v2 e tipos novos de `OperacaoIdempotente`.
- **Produto e P3:** o Produto aceita `L`, e a troca de unidade envolvendo L só vale para Produto nunca usado (P-10). A compra P3 aceita L só para Produto em L; KG e SACO ficam iguais. O movimento de estoque é rotulado pela unidade do Produto.
- **Removido:** perfis, combustíveis, vínculos, fatores e medições. As rotas removidas respondem 404.

## 7. Frontend

- **Menu:** "Patrimônio e Frota" fica só com Bens Patrimoniais e Abastecimentos. As 4 páginas foram removidas do escopo, do `vercel.json` e das permissões; as permissões antigas ficam inertes.
- **Bens:** Família e Tipo com "+ Novo" no formulário; "⋯ > Gerenciar famílias e tipos" e "Instalar catálogo padrão" (só admin); tanques com "Produtos aceitos"; sem a aba Medições.
- **Abastecimentos:** Máquina → Produto → Tanque (se houver mais de um) → Local → Quantidade (na unidade do Produto) → Medidor → Completou o tanque? → Revisar → Confirmar. Sem Fatores, com dica fixa para Produto em kg. A lista mostra "Quantidade" com a unidade.
- **Produto:** opção "Litros (L)".
- **P3 e Mapa:** a P3 trata item em L, e o depósito do Mapa soma só os Produtos em kg (P-11).

## 8. Arquivos alterados

Ver `git diff --stat origin/main...HEAD` na PR [#239](https://github.com/maikelimaadm-stack/MAIKE/pull/239) e os relatos das frentes (tabela de arquivos do §8 do contrato). As exclusões incluem os serviços de perfil, combustível, vínculo e conversão, os componentes de Combustíveis, Perfis e Medições, as 4 páginas e os E2E da UX-02.

## 9. Perguntas ao proprietário

1. **P-10 (troca de unidade envolvendo L).** O contrato só deixa um Produto trocar de unidade
   **de ou para L** se ele **nunca** teve lote, movimento ou item de lançamento e tem estoque 0.
   Um Produto que já foi usado em KG continua em KG, e cadastra-se um Produto novo em litros
   (ex.: "Diesel S10 (L)"). Isso é mais rígido que a leitura literal da D1 ("Produto em KG com
   estoque não muda"). Prefere a leitura literal (aceitar estoque 0 com todos os lotes
   esgotados)? Se sim, só essa regra muda.
2. **Backup, se alguma das 13 tiver linhas no preflight.** (a) Você faz e guarda um
   `pg_dump --data-only` só das 13, na sua máquina, e anota o sha256; ou (b) "não há volta
   parcial; aceito". O GO de 2026-11-10 já aceitou a perda irreversível; a escolha entre (a) e
   (b) continua sua.

## 10. Provas de testes

- **Backend completo** (integração, banco novo): 1497 testes, 0 fail depois do ajuste da linha 182 de `patrimonioSimplificaConcorrencia.test.mjs` (5/5), 5 todo já existentes.
- **Smoke:** 184 arquivos, 2293/2293.
- **Gates:** 721/721.
- **E2E-1** `scripts/dev/e2e-patrimonio-simplifica-real.mjs` (aceite D-PROD-161): **36/36** passos (12 por largura, 1280/820/390), EXIT=0. Cobre Produto "Diesel S10" em L pela tela; compras P3 em L e KG; "+ Nova família" e "+ Novo tipo"; tanque com Produto aceito; abastecimento de 80 L (baixa FIFO 50+30, R$ 425,00); cancelamento com estorno exato; abastecimento de 35 kg num bem com Produto em KG; menu com 2 telas; rotas removidas caindo em "Página não encontrada"; sem rolagem horizontal.
- **E2E-2** `scripts/dev/e2e-abastecimentos-real.mjs`: **30/30** (10 por largura), EXIT=0. Cobre replay e resposta perdida com uma baixa só; troca A→B pela tela de Bens com o histórico intacto; tanque sem Produto; só-visualizar com 403; rotas removidas.

## 11. `verify:all` e CI

`npm run verify:all` local (integração, banco novo): **39/39 etapas PASS**, 1218,0 s. O CI da PR #239 roda o mesmo `verify:all`; resultado no corpo da PR.

## 12. Riscos residuais

1. **Irreversível:** os dados das 13 tabelas (todos os clientes) somem. Só voltam por
   restauração total, ou pelo `pg_dump` do proprietário se ele o fizer.
2. **Janela de 500** no Patrimônio e em 3 rotas antigas (`DELETE /produtos/:id`,
   `PATCH /produtos/:id` com troca de fazenda, `DELETE /empresas/:id`) entre o `COMMIT` e o
   deploy READY. Mitigação: pré-requisitos do merge cumpridos antes, merge imediato e `main`
   congelada.
3. **CONFIRMADO de última hora, ou contagem mudada:** a guarda recusa e a release para.
4. ***Deadlock*** com uma confirmação P3 no instante do alargamento: um dos dois aborta. Se for
   a migration, nada é aplicado e repete-se.
5. **Pooler que descarta `options`** no caminho A: a guarda recusa (`= ausente`). Nesse caso,
   conexão direta ou caminho B.
6. **Unidade de Produto legada** (texto livre): valor diferente de `L`/`KG`/`SACO` fica fora do
   abastecimento (falha fechada). A contagem por unidade sai no preflight.
7. **Suplementação com Produto em L:** baixa o número digitado como hoje, rotulado pela
   `unidade_medida`. Os produtos dela são de Nutrição Animal; fica fora do escopo.
8. **Nomes de coluna em kg com valor em L:** `OperacaoFinanceiraItem.fator_kg` = 1 e
   `quantidade_estoque` em L para item L; os parâmetros `quantidadeKg` do motor recebem L. As
   colunas não são renomeadas (tabela antiga).
9. **Permissões:** quem só tinha as telas antigas perde a criação de família e tipo, que agora é
   de Bens. Não há concessão automática.
10. **Resíduos sem FK** (movimentos de abastecimento cancelado, `AuditLog`, recibos v1,
    sequências, linhas antigas de permissão) ficam como histórico inerte.
11. **Bancos locais com sobras** quebram o `test:backend` até serem recriados (ver `AGENTS.md`).
12. **PR grande** (schema, gate, runner, backend, frontend, Mapa, testes): mitigado pelas frentes
    disjuntas, pelo `verify:all` e pela revisão adversarial antes do GO.

## 13. Desvios do contrato

1. A F6 corrigiu `GerenciarFamiliasTiposDialog.jsx`: a 390 px os botões Editar e Inativar ficavam cortados. Abaixo de 640 px saem as colunas Código e Vida útil (as duas continuam no formulário).
2. Os E2E foram divididos em dois roteiros mais um módulo comum (`e2e-patrimonio-comum.mjs`).
3. O teste `alvo-banco.test.mjs` (fora da lista do §8) ganhou o `lerHistorico` injetado.

## 14. O que NÃO foi feito

- O passo só com teclado da UX-02 (390 px) não foi portado para os E2E novos.
- O rótulo "Leitura inicial" do medidor sai com reticências a 820 px no cadastro do Bem. O defeito é anterior à missão.
- O ramo do papel `maike_vercel` não foi exercitado no cluster local. Em produção ele é conferido pelo postcheck R3/R4.

## 15. Situação

`SCHEMA_APPLIED_PRODUCTION = NÃO` · `MERGE_READY = NÃO` · `OPERATIONAL_RELEASE_READY = NÃO`.
O preflight de produção de 2026-11-11 (só leitura) encontrou 13 linhas, num só dos 2 clientes, 0 CONFIRMADO e a impressão `a35b7cbb0569`. A aplicação segue o runbook, e o resultado fica registrado no §11 dele.
