# MAIKE — Cobertura de autorização por endpoint (PR #199 / R2)

Gerado a partir do código: método, rota, arquivo:linha, `onRequest` e `preHandler`
de **todas** as rotas HTTP (`backend/src/modules/*/*Routes.js`). As guardas de
service foram conferidas à mão (coluna "c"/"b").

Classes:
- **a** — guarda por tela/ação (`porTela`, `porMapa`, `porQualquer`, `GUARDAS.*` em
  `backend/src/shared/auth/guardasRotas.js`), avaliada por
  `backend/src/shared/auth/autorizacaoTela.js` antes de qualquer escrita (403 `ACAO_NAO_PERMITIDA`).
- **b** — regra interna comprovada: o service recusa sempre.
- **c** — administração real (`Usuario.papel_tenant`, relido do banco; 403
  `TENANT_ADMIN_REQUIRED`), ou sessão MAIKE Admin (proprietário do produto).
- **d** — leitura autenticada e isolada por tenant, **por design** sem checagem
  de tela (ver abaixo).
- **e** — lacuna. **Nenhuma escrita** está nesta classe no HEAD desta PR.

## Leituras (classe d) — exposição por design

Toda leitura exige token válido e só devolve dados do próprio tenant (R11). As
leituras **não** checam a tela porque são consumidoras compartilhadas.

- **Mapa Geral:** quem só vê o mapa precisa ler lotes, áreas, categorias,
  pontos, linhas, cochos, bebedouros, movimentações e histórico para desenhar o
  mapa e o Detalhes do Lote. Guardar esses GET pela tela do cadastro quebraria o
  produto para o operador real.
- **Leituras de administração:** já filtram no service.
  - `GET /permissoes`: o não administrador vê a própria linha inteira; das
    outras contas, só id e nome.
  - `GET /usuarios`: sem o papel dos colegas.

**Exposição residual (registrada):** um operador sem a tela de um cadastro
(produtos, por exemplo) consegue LER os registros da própria fazenda por
chamada direta.
- Não há exportação no servidor; ela é feita no navegador.
- Fechar isso exige separar as leituras "do mapa" das leituras "do cadastro".
  É o próximo slice (§ plano no relatório).

## Matriz permissão → efeito autorizado → condição verificável (R3)

"0 rotas sem guarda" NÃO quer dizer "0 caminhos de permissão excessiva". Esta matriz diz o que cada concessão
permite gravar e sob qual condição o servidor confere. Todas as condições são relidas do banco a cada requisição.

| Concessão | Efeito autorizado | Condição verificada no servidor |
|---|---|---|
| administrador real (`papel_tenant`) | tudo no tenant, inclusive Permissões, Usuários, ícones, fuso, ativação, cancelamento/exclusão e rotas sem tela | `Usuario` ativo e com papel `administrador` (dentro da transação nas ações administrativas) |
| linha `is_admin` | todas as telas e ações, incluindo as tarefas do mapa | linha da própria conta no tenant. **Não** inclui Permissões, Usuários, ícones, rotas sem tela nem `POST` genérico sem contrato |
| `mover_lotes` | **só** a transferência (comando do ledger / manejo-lote) | chave `=== true`. **R4:** não fecha período, não cria nem edita suplementação e não grava sobras. O formulário de mover não oferece essas opções a quem não pode lançar: avisa que o consumo continua aberto e move |
| `lancar_suplementacao` | criar, editar e **fechar período** de suplementação (evento, lotes, bulk, lançamento com lotes), aproveitar sobra no destino e saída de estoque da suplementação | tela do Mapa Geral visível + chave `=== true` (o service limita o PATCH aos campos do fechamento). **Não** move gado |
| `movimentar_depositos` | transferência entre depósitos | idem |
| demais chaves do mapa (pesar, morte, abate, nascimento, categoria, renomear, juntar) | o comando do tipo correspondente; renomear: PATCH só dos campos de nome e o registro informativo | chave `=== true`; no PATCH de lote, só os campos de nome |
| Mapa Cadastro `novo`/`salvar`/`editar` | áreas, pontos, linhas, cochos, depósitos, locais, bebedouro | ação da tela. Mudar o nome do local nas movimentações e notas aceita **só** `local_origem`, `local_destino` e `local_estoque_nome` |
| Mapa Cadastro `excluir` | excluir pontos e cochos; desvincular cochos do depósito excluído | PATCH de cocho só com `deposito_origem_id` e `deposito_origem_nome` **iguais a null**, e só num cocho que **está** vinculado (relido no banco) |
| Locais `editar`/`salvar` | cadastro de locais + renomear o depósito ligado | `nome_ponto`/`local_estoque_nome` só num **DEPÓSITO ligado a um local**; `deposito_origem_nome` só num cocho **vinculado**. O registro é relido no banco (R3 deixava renomear qualquer ponto) |
| Cadastro de Lotes `novo`/`editar`/`salvar` | lotes; setor e categoria de manejo rápidos (**só criar**); anexos e upload | ação da tela; remover anexo exige `excluir` |
| tela X `editar`/`salvar` (Lote, Produto, Setor, Grupo, Tipo de tarefa) | `/referencias/sincronizar` **da própria entidade X** | `entity_name` do corpo precisa ser a entidade da tela concedida |
| Bebedouros, ou Mapa Geral `salvar`/`excluir` | histórico de bebedouro | ação da tela |
| Empresa `novo`/`editar`/`excluir` | cadastro da empresa | ação da tela (o fuso exige o administrador real) |

## Tabela rota → guarda

Total: 201 rotas · (a) 76 · (b) 2 · (c) 65 · (d) 56 · pública 2 · (e) LACUNA 0

| Método | Rota | Arquivo:linha | Classe — guarda |
|---|---|---|---|
| GET | `/admin-maike/primeiro-acesso` | `backend/src/modules/adminMaike/adminRoutes.js:75` | c — sessão MAIKE Admin |
| POST | `/admin-maike/primeiro-acesso` | `backend/src/modules/adminMaike/adminRoutes.js:80` | pública/c — fluxo de autenticação do MAIKE Admin (credencial + MFA) |
| POST | `/admin-maike/auth/login` | `backend/src/modules/adminMaike/adminRoutes.js:100` | pública/c — fluxo de autenticação do MAIKE Admin (credencial + MFA) |
| POST | `/admin-maike/auth/mfa` | `backend/src/modules/adminMaike/adminRoutes.js:112` | pública/c — fluxo de autenticação do MAIKE Admin (credencial + MFA) |
| POST | `/admin-maike/mfa/inscricao` | `backend/src/modules/adminMaike/adminRoutes.js:127` | pública/c — fluxo de autenticação do MAIKE Admin (credencial + MFA) |
| POST | `/admin-maike/mfa/confirmar` | `backend/src/modules/adminMaike/adminRoutes.js:132` | pública/c — fluxo de autenticação do MAIKE Admin (credencial + MFA) |
| GET | `/admin-maike/sessao` | `backend/src/modules/adminMaike/adminRoutes.js:143` | c — sessão MAIKE Admin |
| POST | `/admin-maike/auth/logout` | `backend/src/modules/adminMaike/adminRoutes.js:153` | pública/c — fluxo de autenticação do MAIKE Admin (credencial + MFA) |
| POST | `/admin-maike/conta/senha` | `backend/src/modules/adminMaike/adminRoutes.js:163` | pública/c — fluxo de autenticação do MAIKE Admin (credencial + MFA) |
| POST | `/admin-maike/conta/login` | `backend/src/modules/adminMaike/adminRoutes.js:175` | pública/c — fluxo de autenticação do MAIKE Admin (credencial + MFA) |
| POST | `/admin-maike/conta/codigos-recuperacao` | `backend/src/modules/adminMaike/adminRoutes.js:187` | pública/c — fluxo de autenticação do MAIKE Admin (credencial + MFA) |
| GET | `/admin-maike/conta/sessoes` | `backend/src/modules/adminMaike/adminRoutes.js:197` | c — sessão MAIKE Admin |
| POST | `/admin-maike/conta/sessoes/revogar-outras` | `backend/src/modules/adminMaike/adminRoutes.js:199` | pública/c — fluxo de autenticação do MAIKE Admin (credencial + MFA) |
| GET | `/admin-maike/catalogo` | `backend/src/modules/adminMaike/adminRoutes.js:205` | c — sessão MAIKE Admin |
| GET | `/admin-maike/catalogo/revisao` | `backend/src/modules/adminMaike/adminRoutes.js:207` | c — sessão MAIKE Admin |
| GET | `/admin-maike/catalogo/validacao` | `backend/src/modules/adminMaike/adminRoutes.js:208` | c — sessão MAIKE Admin |
| GET | `/aplicacoes-medicamento` | `backend/src/modules/aplicacoesMedicamento/aplicacaoMedicamentoRoutes.js:34` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/aplicacoes-medicamento` | `backend/src/modules/aplicacoesMedicamento/aplicacaoMedicamentoRoutes.js:40` | c — GUARDAS.semTela (só administrador real) |
| PATCH | `/aplicacoes-medicamento/:id` | `backend/src/modules/aplicacoesMedicamento/aplicacaoMedicamentoRoutes.js:46` | c — GUARDAS.semTela (só administrador real) |
| DELETE | `/aplicacoes-medicamento/:id` | `backend/src/modules/aplicacoesMedicamento/aplicacaoMedicamentoRoutes.js:52` | c — GUARDAS.semTela (só administrador real) |
| POST | `/areas-pastagem/importacao/conferir` | `backend/src/modules/areas/areaImportacaoRoutes.js:76` | a — porTela(TELAS.MAPA_CADASTRO, 'importar') |
| POST | `/areas-pastagem/importacao` | `backend/src/modules/areas/areaImportacaoRoutes.js:85` | a — porTela(TELAS.MAPA_CADASTRO, 'importar') |
| GET | `/areas-pastagem` | `backend/src/modules/areas/areaPastagemRoutes.js:134` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/areas-pastagem` | `backend/src/modules/areas/areaPastagemRoutes.js:139` | a — porTela(TELAS.MAPA_CADASTRO, 'novo') |
| PATCH | `/areas-pastagem/:id` | `backend/src/modules/areas/areaPastagemRoutes.js:149` | a — porTela(TELAS.MAPA_CADASTRO, 'editar') |
| POST | `/arquivos/upload` | `backend/src/modules/arquivos/arquivoUploadRoutes.js:31` | a — GUARDAS.upload |
| POST | `/auth/login` | `backend/src/modules/auth/authRoutes.js:29` | pública — login (credenciais) |
| GET | `/auth/contexto` | `backend/src/modules/auth/authRoutes.js:49` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/bebedouros` | `backend/src/modules/bebedouros/bebedouroRoutes.js:38` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/bebedouros` | `backend/src/modules/bebedouros/bebedouroRoutes.js:46` | a — GUARDAS.bebedouro.criar |
| PATCH | `/bebedouros/:id` | `backend/src/modules/bebedouros/bebedouroRoutes.js:52` | a — GUARDAS.bebedouro.editar |
| DELETE | `/bebedouros/:id` | `backend/src/modules/bebedouros/bebedouroRoutes.js:58` | a — GUARDAS.bebedouro.excluir |
| GET | `/bebedouros-alertas` | `backend/src/modules/bebedourosAlertas/bebedouroAlertaRoutes.js:34` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/bebedouros-alertas` | `backend/src/modules/bebedourosAlertas/bebedouroAlertaRoutes.js:40` | c — GUARDAS.bebedouroSemTela.criar (só administrador real) |
| PATCH | `/bebedouros-alertas/:id` | `backend/src/modules/bebedourosAlertas/bebedouroAlertaRoutes.js:46` | c — GUARDAS.bebedouroSemTela.editar (só administrador real) |
| DELETE | `/bebedouros-alertas/:id` | `backend/src/modules/bebedourosAlertas/bebedouroAlertaRoutes.js:52` | c — GUARDAS.bebedouroSemTela.excluir (só administrador real) |
| GET | `/bebedouros-historico` | `backend/src/modules/bebedourosHistorico/bebedouroHistoricoRoutes.js:34` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/bebedouros-historico` | `backend/src/modules/bebedourosHistorico/bebedouroHistoricoRoutes.js:40` | a — GUARDAS.bebedouroHistorico.criar |
| PATCH | `/bebedouros-historico/:id` | `backend/src/modules/bebedourosHistorico/bebedouroHistoricoRoutes.js:46` | a — GUARDAS.bebedouroHistorico.editar |
| DELETE | `/bebedouros-historico/:id` | `backend/src/modules/bebedourosHistorico/bebedouroHistoricoRoutes.js:52` | a — GUARDAS.bebedouroHistorico.excluir |
| GET | `/bebedouros-sanidade` | `backend/src/modules/bebedourosSanidade/bebedouroSanidadeRoutes.js:34` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/bebedouros-sanidade` | `backend/src/modules/bebedourosSanidade/bebedouroSanidadeRoutes.js:40` | c — GUARDAS.bebedouroSemTela.criar (só administrador real) |
| PATCH | `/bebedouros-sanidade/:id` | `backend/src/modules/bebedourosSanidade/bebedouroSanidadeRoutes.js:46` | c — GUARDAS.bebedouroSemTela.editar (só administrador real) |
| DELETE | `/bebedouros-sanidade/:id` | `backend/src/modules/bebedourosSanidade/bebedouroSanidadeRoutes.js:52` | c — GUARDAS.bebedouroSemTela.excluir (só administrador real) |
| GET | `/catalogo-global/manifest` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:198` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/catalogo-global/tipos` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:205` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/catalogo-global/categorias` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:210` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/catalogo-global/icones` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:217` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/catalogo-global/regras-misto` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:222` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/catalogo-global/admin/tipos` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:232` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| PATCH | `/catalogo-global/admin/tipos/:id` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:244` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| POST | `/catalogo-global/admin/categorias` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:261` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| POST | `/catalogo-global/admin/assets` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:277` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| POST | `/catalogo-global/admin/icones` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:298` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| PATCH | `/catalogo-global/admin/icones/:id` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:310` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| POST | `/catalogo-global/admin/icones/:id/publicar` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:327` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| POST | `/catalogo-global/admin/icones/:id/desativar` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:343` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| POST | `/catalogo-global/admin/regras-misto` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:359` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| POST | `/catalogo-global/admin/regras-misto/:id/publicar` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:375` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| POST | `/catalogo-global/admin/regras-misto/:id/desativar` | `backend/src/modules/catalogoGlobal/catalogoGlobalRoutes.js:402` | c — sessão MAIKE Admin (proprietário do produto, MFA) |
| GET | `/categorias` | `backend/src/modules/categorias/categoriaRoutes.js:55` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/categorias` | `backend/src/modules/categorias/categoriaRoutes.js:60` | a — GUARDAS.categoria.criar |
| PATCH | `/categorias/:id` | `backend/src/modules/categorias/categoriaRoutes.js:66` | a — GUARDAS.categoria.editar |
| DELETE | `/categorias/:id` | `backend/src/modules/categorias/categoriaRoutes.js:72` | a — GUARDAS.categoria.excluir |
| GET | `/categorias-manejo` | `backend/src/modules/categoriasManejo/categoriaManejoRoutes.js:38` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/categorias-manejo` | `backend/src/modules/categoriasManejo/categoriaManejoRoutes.js:46` | a — GUARDAS.categoriaManejo.criar |
| PATCH | `/categorias-manejo/:id` | `backend/src/modules/categoriasManejo/categoriaManejoRoutes.js:52` | a — GUARDAS.categoriaManejo.editar |
| DELETE | `/categorias-manejo/:id` | `backend/src/modules/categoriasManejo/categoriaManejoRoutes.js:58` | a — GUARDAS.categoriaManejo.excluir |
| GET | `/empresas` | `backend/src/modules/empresas/empresaRoutes.js:85` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/empresas` | `backend/src/modules/empresas/empresaRoutes.js:93` | a — porTela(TELAS.EMPRESA, 'novo') |
| PATCH | `/empresas/:id` | `backend/src/modules/empresas/empresaRoutes.js:99` | a — porTela(TELAS.EMPRESA, 'editar') |
| PUT | `/empresas/:id/fuso-horario` | `backend/src/modules/empresas/empresaRoutes.js:105` | c — empresaService.configurarFusoHorario: exigirAdminTenant na transação |
| DELETE | `/empresas/:id` | `backend/src/modules/empresas/empresaRoutes.js:111` | a — porTela(TELAS.EMPRESA, 'excluir') |
| GET | `/estoque-lotes-nota` | `backend/src/modules/estoqueLotesNota/estoqueLoteNotaRoutes.js:40` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/estoque-lotes-nota/:id` | `backend/src/modules/estoqueLotesNota/estoqueLoteNotaRoutes.js:46` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/estoque-lotes-nota` | `backend/src/modules/estoqueLotesNota/estoqueLoteNotaRoutes.js:52` | c — GUARDAS.estoqueLoteNota.criar (só administrador real) |
| PATCH | `/estoque-lotes-nota/:id` | `backend/src/modules/estoqueLotesNota/estoqueLoteNotaRoutes.js:58` | a — GUARDAS.estoqueLoteNota.editar |
| DELETE | `/estoque-lotes-nota/:id` | `backend/src/modules/estoqueLotesNota/estoqueLoteNotaRoutes.js:64` | c — GUARDAS.estoqueLoteNota.excluir (só administrador real) |
| GET | `/eventos-sanitarios` | `backend/src/modules/eventosSanitarios/eventoSanitarioRoutes.js:34` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/eventos-sanitarios` | `backend/src/modules/eventosSanitarios/eventoSanitarioRoutes.js:40` | c — GUARDAS.semTela (só administrador real) |
| PATCH | `/eventos-sanitarios/:id` | `backend/src/modules/eventosSanitarios/eventoSanitarioRoutes.js:46` | c — GUARDAS.semTela (só administrador real) |
| DELETE | `/eventos-sanitarios/:id` | `backend/src/modules/eventosSanitarios/eventoSanitarioRoutes.js:52` | c — GUARDAS.semTela (só administrador real) |
| GET | `/fornecedores` | `backend/src/modules/fornecedores/fornecedorRoutes.js:38` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/fornecedores` | `backend/src/modules/fornecedores/fornecedorRoutes.js:46` | c — GUARDAS.semTela (só administrador real) |
| PATCH | `/fornecedores/:id` | `backend/src/modules/fornecedores/fornecedorRoutes.js:52` | c — GUARDAS.semTela (só administrador real) |
| DELETE | `/fornecedores/:id` | `backend/src/modules/fornecedores/fornecedorRoutes.js:58` | c — GUARDAS.semTela (só administrador real) |
| GET | `/grupos-atividade` | `backend/src/modules/gruposAtividade/grupoAtividadeRoutes.js:55` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/grupos-atividade` | `backend/src/modules/gruposAtividade/grupoAtividadeRoutes.js:60` | a — GUARDAS.grupoAtividade.criar |
| PATCH | `/grupos-atividade/:id` | `backend/src/modules/gruposAtividade/grupoAtividadeRoutes.js:66` | a — GUARDAS.grupoAtividade.editar |
| DELETE | `/grupos-atividade/:id` | `backend/src/modules/gruposAtividade/grupoAtividadeRoutes.js:72` | a — GUARDAS.grupoAtividade.excluir |
| GET | `/health` | `backend/src/modules/health/healthRoutes.js:12` | pública — saúde |
| GET | `/lancamentos-tarefa` | `backend/src/modules/lancamentosTarefa/lancamentoTarefaRoutes.js:139` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/lancamentos-tarefa` | `backend/src/modules/lancamentosTarefa/lancamentoTarefaRoutes.js:144` | a — GUARDAS.tarefa |
| PATCH | `/lancamentos-tarefa/:id` | `backend/src/modules/lancamentosTarefa/lancamentoTarefaRoutes.js:154` | a — GUARDAS.tarefa |
| DELETE | `/lancamentos-tarefa/:id` | `backend/src/modules/lancamentosTarefa/lancamentoTarefaRoutes.js:164` | a — GUARDAS.tarefa |
| GET | `/historicos-lancamento-tarefa` | `backend/src/modules/lancamentosTarefa/lancamentoTarefaRoutes.js:175` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/historicos-lancamento-tarefa` | `backend/src/modules/lancamentosTarefa/lancamentoTarefaRoutes.js:185` | a — GUARDAS.tarefa |
| DELETE | `/historicos-lancamento-tarefa/:id` | `backend/src/modules/lancamentosTarefa/lancamentoTarefaRoutes.js:195` | a — GUARDAS.tarefa |
| GET | `/locais-estoque` | `backend/src/modules/locaisEstoque/localEstoqueRoutes.js:68` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/locais-estoque/page` | `backend/src/modules/locaisEstoque/localEstoqueRoutes.js:73` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/locais-estoque` | `backend/src/modules/locaisEstoque/localEstoqueRoutes.js:82` | a — GUARDAS.localEstoque.criar |
| PATCH | `/locais-estoque/:id` | `backend/src/modules/locaisEstoque/localEstoqueRoutes.js:88` | a — GUARDAS.localEstoque.editar |
| DELETE | `/locais-estoque/:id` | `backend/src/modules/locaisEstoque/localEstoqueRoutes.js:94` | a — GUARDAS.localEstoque.excluir |
| GET | `/lotes` | `backend/src/modules/lotes/loteRoutes.js:160` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/lotes/:id` | `backend/src/modules/lotes/loteRoutes.js:166` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/lotes/:id/elegibilidade-exclusao` | `backend/src/modules/lotes/loteRoutes.js:172` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/lotes/:id/elegibilidade-correcao-entrada` | `backend/src/modules/lotes/loteRoutes.js:179` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/lotes/:id/correcao-entrada` | `backend/src/modules/lotes/loteRoutes.js:185` | a — porTela(TELAS.LOTES, 'editar') |
| POST | `/lotes` | `backend/src/modules/lotes/loteRoutes.js:192` | a — porTela(TELAS.LOTES, 'novo') |
| PATCH | `/lotes/:id` | `backend/src/modules/lotes/loteRoutes.js:198` | a — autorizarPatchLote |
| DELETE | `/lotes/:id` | `backend/src/modules/lotes/loteRoutes.js:204` | a — porTela(TELAS.LOTES, 'excluir') |
| GET | `/manejos-tecnico-rebanho` | `backend/src/modules/manejosTecnicoRebanho/manejoTecnicoRebanhoRoutes.js:34` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/manejos-tecnico-rebanho` | `backend/src/modules/manejosTecnicoRebanho/manejoTecnicoRebanhoRoutes.js:40` | c — GUARDAS.semTela (só administrador real) |
| PATCH | `/manejos-tecnico-rebanho/:id` | `backend/src/modules/manejosTecnicoRebanho/manejoTecnicoRebanhoRoutes.js:46` | c — GUARDAS.semTela (só administrador real) |
| DELETE | `/manejos-tecnico-rebanho/:id` | `backend/src/modules/manejosTecnicoRebanho/manejoTecnicoRebanhoRoutes.js:52` | c — GUARDAS.semTela (só administrador real) |
| GET | `/configuracao-icones` | `backend/src/modules/mapGeography/mapGeographyRoutes.js:160` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/configuracao-icones` | `backend/src/modules/mapGeography/mapGeographyRoutes.js:165` | c — apenasAdminTenant() |
| PATCH | `/configuracao-icones/:id` | `backend/src/modules/mapGeography/mapGeographyRoutes.js:175` | c — apenasAdminTenant() |
| GET | `/pontos-referencia` | `backend/src/modules/mapGeography/mapGeographyRoutes.js:185` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/pontos-referencia` | `backend/src/modules/mapGeography/mapGeographyRoutes.js:190` | a — porTela(TELAS.MAPA_CADASTRO, 'novo') |
| PATCH | `/pontos-referencia/:id` | `backend/src/modules/mapGeography/mapGeographyRoutes.js:200` | a — porTela(TELAS.MAPA_CADASTRO, 'editar') |
| DELETE | `/pontos-referencia/:id` | `backend/src/modules/mapGeography/mapGeographyRoutes.js:210` | a — porTela(TELAS.MAPA_CADASTRO, 'excluir') |
| GET | `/linhas-geograficas` | `backend/src/modules/mapGeography/mapGeographyRoutes.js:221` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/linhas-geograficas` | `backend/src/modules/mapGeography/mapGeographyRoutes.js:226` | a — porTela(TELAS.MAPA_CADASTRO, 'novo') |
| PATCH | `/linhas-geograficas/:id` | `backend/src/modules/mapGeography/mapGeographyRoutes.js:236` | a — porTela(TELAS.MAPA_CADASTRO, 'editar') |
| GET | `/marcas` | `backend/src/modules/marcas/marcaRoutes.js:79` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/marcas` | `backend/src/modules/marcas/marcaRoutes.js:84` | a — GUARDAS.marca.criar |
| PATCH | `/marcas/:id` | `backend/src/modules/marcas/marcaRoutes.js:90` | a — GUARDAS.marca.editar |
| DELETE | `/marcas/:id` | `backend/src/modules/marcas/marcaRoutes.js:96` | a — GUARDAS.marca.excluir |
| GET | `/movimentacoes-estoque` | `backend/src/modules/movimentacoesEstoque/movimentacaoEstoqueRoutes.js:96` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/movimentacoes-estoque/comandos/saida-suplementacao` | `backend/src/modules/movimentacoesEstoque/movimentacaoEstoqueRoutes.js:102` | a — GUARDAS.movimentacaoEstoque.saidaSuplementacao |
| POST | `/movimentacoes-estoque/comandos/transferencia-locais` | `backend/src/modules/movimentacoesEstoque/movimentacaoEstoqueRoutes.js:115` | a — GUARDAS.movimentacaoEstoque.transferenciaLocais |
| POST | `/movimentacoes-estoque` | `backend/src/modules/movimentacoesEstoque/movimentacaoEstoqueRoutes.js:128` | c — GUARDAS.movimentacaoEstoque.criar (só administrador real) |
| PATCH | `/movimentacoes-estoque/:id` | `backend/src/modules/movimentacoesEstoque/movimentacaoEstoqueRoutes.js:134` | a — GUARDAS.movimentacaoEstoque.editar |
| DELETE | `/movimentacoes-estoque/:id` | `backend/src/modules/movimentacoesEstoque/movimentacaoEstoqueRoutes.js:140` | c — GUARDAS.movimentacaoEstoque.excluir (só administrador real) |
| GET | `/movimentacoes-mapa` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:221` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/movimentacoes-mapa/historico` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:227` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/movimentacoes-mapa/comandos/manejo-lote` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:232` | a — porMapa(chaveDoCorpo) |
| POST | `/movimentacoes-mapa/comandos/manejo-rebanho` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:238` | a — porMapa(chaveDoCorpo) |
| POST | `/movimentacoes-mapa/comandos/juncao-lotes` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:244` | a — porMapa('juntar_lotes') |
| POST | `/movimentacoes-mapa/comandos/baixa-rebanho` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:250` | a — porMapa(chaveDoCorpo) |
| GET | `/movimentacoes-mapa/:id/elegibilidade-cancelamento` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:256` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/movimentacoes-mapa/:id/cancelamento` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:262` | c — cancelamento exige administrador real (movimentacaoMapaCancelamentoService, exigirAdminTenant na transação) |
| GET | `/movimentacoes-mapa/:id/elegibilidade-exclusao` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:270` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/movimentacoes-mapa/:id/exclusao` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:276` | c — exclusão exige administrador real (movimentacaoMapaExclusaoService) |
| POST | `/movimentacoes-mapa` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:285` | a — autorizar((req, aut) => {
      const chave = chaveMapaDoGenerico(/** @type {any} */ (req.body));
      if (chave) return mapaPermite(aut, chave) ? true : { tela: TELAS.MAPA_GERAL.tela, mapa: chave };
      return aut.adminReal ? true : { tela: TELAS.MAPA_GERAL.tela, tipo: 'sem_contrato' };
    }) |
| PATCH | `/movimentacoes-mapa/:id` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:301` | b — service sempre recusa (movimentoExigeCancelamento) |
| DELETE | `/movimentacoes-mapa/:id` | `backend/src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js:307` | b — service sempre recusa (movimentoExigeCancelamento) |
| GET | `/movimentacoes-pecuaria` | `backend/src/modules/movimentacoesPecuaria/movimentacaoPecuariaRoutes.js:34` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/movimentacoes-pecuaria` | `backend/src/modules/movimentacoesPecuaria/movimentacaoPecuariaRoutes.js:40` | c — GUARDAS.semTela (só administrador real) |
| PATCH | `/movimentacoes-pecuaria/:id` | `backend/src/modules/movimentacoesPecuaria/movimentacaoPecuariaRoutes.js:46` | c — GUARDAS.semTela (só administrador real) |
| DELETE | `/movimentacoes-pecuaria/:id` | `backend/src/modules/movimentacoesPecuaria/movimentacaoPecuariaRoutes.js:52` | c — GUARDAS.semTela (só administrador real) |
| GET | `/permissoes` | `backend/src/modules/permissoes/permissaoRoutes.js:35` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/permissoes` | `backend/src/modules/permissoes/permissaoRoutes.js:43` | c — permissaoService: exigirAdminTenant (antes e na transação) |
| PATCH | `/permissoes/:id` | `backend/src/modules/permissoes/permissaoRoutes.js:49` | c — permissaoService: exigirAdminTenant |
| DELETE | `/permissoes/:id` | `backend/src/modules/permissoes/permissaoRoutes.js:55` | c — permissaoService: exigirAdminTenant |
| GET | `/pontos-suplementacao` | `backend/src/modules/pontosSuplementacao/pontoSuplementacaoRoutes.js:38` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/pontos-suplementacao` | `backend/src/modules/pontosSuplementacao/pontoSuplementacaoRoutes.js:46` | a — GUARDAS.pontoSuplementacao.criar |
| PATCH | `/pontos-suplementacao/:id` | `backend/src/modules/pontosSuplementacao/pontoSuplementacaoRoutes.js:52` | a — GUARDAS.pontoSuplementacao.editar |
| DELETE | `/pontos-suplementacao/:id` | `backend/src/modules/pontosSuplementacao/pontoSuplementacaoRoutes.js:58` | a — GUARDAS.pontoSuplementacao.excluir |
| GET | `/produtos` | `backend/src/modules/produtos/produtoRoutes.js:103` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/produtos/page` | `backend/src/modules/produtos/produtoRoutes.js:109` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/produtos` | `backend/src/modules/produtos/produtoRoutes.js:118` | a — GUARDAS.produto.criar |
| PATCH | `/produtos/:id` | `backend/src/modules/produtos/produtoRoutes.js:124` | a — GUARDAS.produto.editar |
| DELETE | `/produtos/:id` | `backend/src/modules/produtos/produtoRoutes.js:130` | a — GUARDAS.produto.excluir |
| GET | `/rebanho/posicoes` | `backend/src/modules/rebanhoLedger/rebanhoLedgerRoutes.js:52` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/rebanho/saldos` | `backend/src/modules/rebanhoLedger/rebanhoLedgerRoutes.js:56` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/rebanho/verificacao` | `backend/src/modules/rebanhoLedger/rebanhoLedgerRoutes.js:60` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/rebanho/ativacao` | `backend/src/modules/rebanhoLedger/rebanhoLedgerRoutes.js:64` | c — rebanhoLedgerService: exigirAdminTenant na transação |
| POST | `/rebanho/comandos/transferencia` | `backend/src/modules/rebanhoLedger/rebanhoLedgerRoutes.js:69` | a — porMapa('mover_lotes') |
| POST | `/referencias/sincronizar` | `backend/src/modules/referencias/referenciasRoutes.js:11` | a — GUARDAS.referencias |
| GET | `/registros-anexo` | `backend/src/modules/registrosAnexo/registroAnexoRoutes.js:31` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/registros-anexo` | `backend/src/modules/registrosAnexo/registroAnexoRoutes.js:37` | a — GUARDAS.anexo.criar |
| DELETE | `/registros-anexo/:id` | `backend/src/modules/registrosAnexo/registroAnexoRoutes.js:43` | a — GUARDAS.anexo.excluir |
| GET | `/setores` | `backend/src/modules/setores/setorRoutes.js:150` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/setores/page` | `backend/src/modules/setores/setorRoutes.js:155` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/setores` | `backend/src/modules/setores/setorRoutes.js:164` | a — GUARDAS.setor.criar |
| PATCH | `/setores/:id` | `backend/src/modules/setores/setorRoutes.js:170` | a — GUARDAS.setor.editar |
| GET | `/suplementacao-eventos` | `backend/src/modules/suplementacaoEventos/suplementacaoEventoRoutes.js:35` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/suplementacao-eventos` | `backend/src/modules/suplementacaoEventos/suplementacaoEventoRoutes.js:41` | a — GUARDAS.suplementacaoEvento.criar |
| POST | `/suplementacao-eventos/comandos/lancamento-com-lotes` | `backend/src/modules/suplementacaoEventos/suplementacaoEventoRoutes.js:47` | a — GUARDAS.suplementacaoEvento.lancamento |
| PATCH | `/suplementacao-eventos/:id` | `backend/src/modules/suplementacaoEventos/suplementacaoEventoRoutes.js:74` | a — GUARDAS.suplementacaoEvento.editar |
| DELETE | `/suplementacao-eventos/:id` | `backend/src/modules/suplementacaoEventos/suplementacaoEventoRoutes.js:80` | c — GUARDAS.suplementacaoEvento.excluir (só administrador real) |
| GET | `/suplementacao-lotes` | `backend/src/modules/suplementacaoLotes/suplementacaoLoteRoutes.js:44` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/suplementacao-lotes` | `backend/src/modules/suplementacaoLotes/suplementacaoLoteRoutes.js:50` | a — GUARDAS.suplementacaoLote.criar |
| PATCH | `/suplementacao-lotes/:id` | `backend/src/modules/suplementacaoLotes/suplementacaoLoteRoutes.js:56` | a — GUARDAS.suplementacaoLote.editar |
| DELETE | `/suplementacao-lotes/:id` | `backend/src/modules/suplementacaoLotes/suplementacaoLoteRoutes.js:62` | c — GUARDAS.suplementacaoLote.excluir (só administrador real) |
| POST | `/suplementacao-lotes/bulk` | `backend/src/modules/suplementacaoLotes/suplementacaoLoteRoutes.js:68` | a — GUARDAS.suplementacaoLote.criar |
| GET | `/tipos-tarefa` | `backend/src/modules/tiposTarefa/tipoTarefaRoutes.js:60` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/tipos-tarefa` | `backend/src/modules/tiposTarefa/tipoTarefaRoutes.js:65` | a — GUARDAS.tipoTarefa.criar |
| PATCH | `/tipos-tarefa/:id` | `backend/src/modules/tiposTarefa/tipoTarefaRoutes.js:71` | a — GUARDAS.tipoTarefa.editar |
| DELETE | `/tipos-tarefa/:id` | `backend/src/modules/tiposTarefa/tipoTarefaRoutes.js:77` | a — GUARDAS.tipoTarefa.excluir |
| GET | `/unidades-medida` | `backend/src/modules/unidadesMedida/unidadeMedidaRoutes.js:72` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/unidades-medida/page` | `backend/src/modules/unidadesMedida/unidadeMedidaRoutes.js:77` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/unidades-medida` | `backend/src/modules/unidadesMedida/unidadeMedidaRoutes.js:86` | a — GUARDAS.unidadeMedida.criar |
| PATCH | `/unidades-medida/:id` | `backend/src/modules/unidadesMedida/unidadeMedidaRoutes.js:92` | a — GUARDAS.unidadeMedida.editar |
| DELETE | `/unidades-medida/:id` | `backend/src/modules/unidadesMedida/unidadeMedidaRoutes.js:98` | a — GUARDAS.unidadeMedida.excluir |
| GET | `/usuarios` | `backend/src/modules/usuarios/usuarioRoutes.js:71` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| GET | `/usuarios/page` | `backend/src/modules/usuarios/usuarioRoutes.js:76` | d — leitura autenticada, isolada por tenant (sem checagem de tela) |
| POST | `/usuarios` | `backend/src/modules/usuarios/usuarioRoutes.js:85` | c — usuarioService: exigirAdminTenant |
| PATCH | `/usuarios/:id` | `backend/src/modules/usuarios/usuarioRoutes.js:91` | c — usuarioService: própria conta (senha/nome) ou exigirAdminTenant |
