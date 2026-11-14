/**
 * R2 (PR #199) — guarda de tela/ação de CADA rota de escrita que antes só
 * autenticava. Fonte única: a rota referencia `GUARDAS.<recurso>.<ação>`.
 *
 * Cada regra espelha o que a INTERFACE já exige do botão que dispara a
 * gravação (levantamento por arquivo:linha no relatório da R2):
 *  - Mapa Geral: as chaves do mapa (`lancar_suplementacao`, `mover_lotes`,
 *    `movimentar_depositos`), sem a heurística do Layout;
 *  - cadastros: a tela do cadastro ("novo"/"salvar" para criar,
 *    "editar"/"salvar" para alterar, "excluir"), OU a tela de onde a interface
 *    faz o cadastro rápido (setor/categoria rápidos no Cadastro de Lotes;
 *    cocho, depósito, local e bebedouro no Mapa Cadastro);
 *  - fluxo sem tela no produto atual (sem chamador no navegador) ou suspenso
 *    na interface (estornos de cocho/depósito) → só o administrador REAL;
 *  - tarefas do mapa: a interface só as abre para o administrador ou a
 *    concessão `is_admin` (`podeUsarTarefasMapa`) → `porAcessoTotal`.
 * Negação: 403 `ACAO_NAO_PERMITIDA` (ou `TENANT_ADMIN_REQUIRED`), antes da escrita.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from './authContext.js';
import {
  TELAS, porQualquer, porTela, porTodas, porAcessoTotal, apenasAdminTenant, autorizar, telaPermite, acessoTotal,
  carregarAutorizacao, somenteCampos, acaoNaoPermitida, adminOuIsAdmin,
} from './autorizacaoTela.js';

const T = TELAS;
/** Criar/alterar/excluir pela tela do cadastro, com telas extras (cadastro rápido). */
const cadastro = (alvo, extras = {}) => ({
  criar: porQualquer([alvo, 'novo'], [alvo, 'salvar'], ...(extras.criar ?? [])),
  editar: porQualquer([alvo, 'editar'], [alvo, 'salvar'], ...(extras.editar ?? [])),
  excluir: porQualquer([alvo, 'excluir'], ...(extras.excluir ?? [])),
});
/**
 * D-PROD-157 (A4) — PATCH de um cadastro do Patrimônio. Decide pela PRESENÇA
 * das chaves no corpo (já validado pelo schema; o banco não é lido):
 *  - `ativo` e, além dele, só `empresa_id`/`versao` → exige `inativar`;
 *  - `ativo` com outros campos → (`editar` ou `salvar`) E `inativar`;
 *  - sem `ativo` → `editar` ou `salvar`.
 * Administrador real ou `is_admin` liberam tudo (como em `telaPermite`).
 */
const CHAVES_DE_ESCOPO_PATRIMONIO = Object.freeze(['empresa_id', 'versao']);
const edicaoPatrimonio = (alvo) =>
  autorizar((req, aut) => {
    const corpo = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const mudaAtivo = Object.prototype.hasOwnProperty.call(corpo, 'ativo');
    const mudaOutros = Object.keys(corpo).some((k) => k !== 'ativo' && !CHAVES_DE_ESCOPO_PATRIMONIO.includes(k));
    const exige = [];
    if ((!mudaAtivo || mudaOutros) && !telaPermite(aut, alvo, 'editar') && !telaPermite(aut, alvo, 'salvar')) exige.push(`${alvo.tela}:editar`);
    if (mudaAtivo && !telaPermite(aut, alvo, 'inativar')) exige.push(`${alvo.tela}:inativar`);
    return exige.length ? { tela: alvo.tela, exige } : true;
  });
/** Cadastro do Patrimônio: ver = visualizar; criar = novo|salvar; editar = `edicaoPatrimonio`. */
const patrimonio = (alvo) => ({
  ver: porTela(alvo, 'visualizar'),
  criar: porQualquer([alvo, 'novo'], [alvo, 'salvar']),
  editar: edicaoPatrimonio(alvo),
});

/**
 * D-PROD-162 / D-PROD-169 — quem CADASTRA ou EDITA bem: cria tipo pelo "+" do
 * formulário e lista os Produtos que um tanque pode aceitar.
 */
const BENS_CRIAR_OU_EDITAR = [[T.PATRIMONIO_BENS, 'novo'], [T.PATRIMONIO_BENS, 'salvar'], [T.PATRIMONIO_BENS, 'editar']];

/**
 * D-PROD-197 — quem CRIA (novo|salvar) ou EDITA (editar|salvar) tipo de
 * atividade lista os centros ATIVOS da fazenda no formulário (Apropriação);
 * não depende das telas de centros, como as opções do apontamento.
 */
const TIPOS_ATIVIDADE_CRIAR_OU_EDITAR = [[T.TIPOS_ATIVIDADE, 'novo'], [T.TIPOS_ATIVIDADE, 'salvar'], [T.TIPOS_ATIVIDADE, 'editar']];

const MAPA_CAD_CRIAR = [[T.MAPA_CADASTRO, 'novo'], [T.MAPA_CADASTRO, 'salvar']];
const MAPA_CAD_EDITAR = [[T.MAPA_CADASTRO, 'editar'], [T.MAPA_CADASTRO, 'salvar']];
const MAPA_CAD_EXCLUIR = [[T.MAPA_CADASTRO, 'excluir']];
const LOTES_GRAVAR = [[T.LOTES, 'novo'], [T.LOTES, 'editar'], [T.LOTES, 'salvar']];
const SO_ADMIN = apenasAdminTenant();

/**
 * R4 — PATCH de cocho/depósito por tela cruzada: além de SÓ os campos do fluxo,
 * o REGISTRO (relido no banco, no tenant) tem de ser o que o fluxo alcança.
 *  - Mapa Cadastro "editar"/"salvar": edita tudo (é a tela do ponto);
 *  - Mapa Cadastro "excluir" (cascata ao excluir o depósito): só DESVINCULAR —
 *    `deposito_origem_id` e `deposito_origem_nome` = null, num cocho vinculado;
 *  - Locais "editar"/"salvar" (renomear o local): `nome_ponto`/`local_estoque_nome`
 *    só num DEPÓSITO ligado a um local; `deposito_origem_nome` só num cocho
 *    vinculado a depósito. (R3 deixava renomear qualquer ponto.)
 */
const pontoSuplementacaoEditar = async (request) => {
  const aut = await carregarAutorizacao(request.contexto);
  const MC = T.MAPA_CADASTRO;
  if (acessoTotal(aut) || telaPermite(aut, MC, 'editar') || telaPermite(aut, MC, 'salvar')) return;
  const corpo = /** @type {Record<string, unknown>} */ (request.body ?? {});
  const negar = () => acaoNaoPermitida({ tela: MC.tela, acao: 'editar' });
  const pode = (alvo, acoes) => acoes.some((a) => telaPermite(aut, alvo, a));
  if (!pode(MC, ['excluir']) && !pode(T.LOCAIS, ['editar', 'salvar'])) throw negar();
  const auth = exigirAuthContext(request.contexto?.auth);
  const ponto = await getPrismaClient().pontoSuplementacao.findFirst({
    where: { cliente_id: auth.clienteId, id: /** @type {any} */ (request.params)?.id },
    select: { categoria_ponto: true, local_estoque_id: true, deposito_origem_id: true },
  });
  if (!ponto) throw negar();
  const desvincular = pode(MC, ['excluir']) && somenteCampos(corpo, ['deposito_origem_id', 'deposito_origem_nome']) &&
    corpo.deposito_origem_id === null && (corpo.deposito_origem_nome ?? null) === null && Boolean(ponto.deposito_origem_id);
  const renomearDeposito = pode(T.LOCAIS, ['editar', 'salvar']) && somenteCampos(corpo, ['nome_ponto', 'local_estoque_nome']) &&
    String(ponto.categoria_ponto).toUpperCase() === 'DEPOSITO' && Boolean(ponto.local_estoque_id);
  const renomearOrigem = pode(T.LOCAIS, ['editar', 'salvar']) && somenteCampos(corpo, ['deposito_origem_nome']) && Boolean(ponto.deposito_origem_id);
  if (!(desvincular || renomearDeposito || renomearOrigem)) throw negar();
};

/**
 * D-PROD-137 (F6) — LocalEstoque pela tela cruzada do Mapa Cadastro. O único
 * PATCH de local que o Mapa Cadastro faz é renomear o local DO DEPÓSITO que está
 * editando (FormularioPonto: `{ nome, descricao }`); antes, "editar"/"salvar" do
 * Mapa Cadastro valia para QUALQUER local (desativar, capacidade, renomear o
 * almoxarifado), como se fosse a tela Locais.
 *  - acesso total ou Locais "editar"/"salvar" → tudo (a tela do cadastro);
 *  - Mapa Cadastro "editar"/"salvar" → só `nome`/`descricao`, e só se o banco
 *    (no tenant) tiver um PontoSuplementacao categoria DEPOSITO ligado a este
 *    local. Senão 403, antes da escrita.
 * DELETE só pela tela Locais (ver `localEstoque.excluir`): a cascata do mapa
 * chama o DELETE com o depósito ainda vivo, e o serviço sempre recusava
 * (`deposito_do_mapa`, 409) — o único efeito real da concessão era excluir local
 * alheio. A cascata conta a recusa como "local ignorado", como antes.
 */
const localEstoqueEditar = async (request) => {
  const aut = await carregarAutorizacao(request.contexto);
  const MC = T.MAPA_CADASTRO;
  if (acessoTotal(aut) || telaPermite(aut, T.LOCAIS, 'editar') || telaPermite(aut, T.LOCAIS, 'salvar')) return;
  const negar = () => acaoNaoPermitida({ exige: [`${T.LOCAIS.tela}:editar`, `${MC.tela}:editar[nome,descricao] no local de um depósito`] });
  if (!telaPermite(aut, MC, 'editar') && !telaPermite(aut, MC, 'salvar')) throw negar();
  if (!somenteCampos(request.body, ['nome', 'descricao'])) throw negar();
  const auth = exigirAuthContext(request.contexto?.auth);
  const deposito = await getPrismaClient().pontoSuplementacao.findFirst({
    where: {
      cliente_id: auth.clienteId,
      local_estoque_id: /** @type {any} */ (request.params)?.id,
      categoria_ponto: { equals: 'DEPOSITO', mode: 'insensitive' },
    },
    select: { id: true },
  });
  if (!deposito) throw negar();
};

/*
 * R4 — "mover lotes" NÃO fecha período de suplementação. Na R3, com só
 * `mover_lotes`, o PATCH dos campos do fechamento passava em QUALQUER período
 * aberto do tenant (sem vínculo com transferência, lote, área ou operação):
 * encerrava o consumo de outro grupo. Não há como o servidor provar, pela rota
 * genérica, que o fechamento decorre de uma transferência; então todo PATCH de
 * suplementação exige `lancar_suplementacao` (fail-closed). O formulário de
 * mover não oferece o fechamento a quem não pode lançar (segue movendo, com o
 * aviso de que o consumo continua aberto).
 */

/**
 * R3 — `/referencias/sincronizar` propaga o nome de UMA entidade: exige a tela
 * dessa entidade (antes: editar em qualquer uma de cinco telas renomeava Lote,
 * movimentações…). Entidade sem tela → só acesso total.
 */
const TELA_DA_ENTIDADE = Object.freeze({
  Lote: T.LOTES, Produto: T.PRODUTOS, Setor: T.SETORES, GrupoAtividade: T.GRUPOS_ATIVIDADE, TipoTarefa: T.TIPOS_TAREFA,
});
const referenciasDaEntidade = autorizar((req, aut) => {
  if (acessoTotal(aut)) return true;
  const corpo = /** @type {any} */ (req.body) ?? {};
  const entidade = corpo.event?.entity_name || corpo.entity_name || null;
  const alvo = entidade ? TELA_DA_ENTIDADE[entidade] : null;
  if (alvo && (telaPermite(aut, alvo, 'editar') || telaPermite(aut, alvo, 'salvar'))) return true;
  return { referencias: entidade ?? null };
});

export const GUARDAS = Object.freeze({
  // ── Mapa Geral: suplementação, cochos/depósitos e estoque ──
  suplementacaoLote: {
    criar: porQualquer({ mapa: 'lancar_suplementacao' }),
    editar: porQualquer({ mapa: 'lancar_suplementacao' }),
    excluir: SO_ADMIN, // estorno suspenso na interface (politicaEstorno)
  },
  suplementacaoEvento: {
    criar: porQualquer({ mapa: 'lancar_suplementacao' }),
    lancamento: porQualquer({ mapa: 'lancar_suplementacao' }),
    editar: porQualquer({ mapa: 'lancar_suplementacao' }),
    excluir: SO_ADMIN,
  },
  pontoSuplementacao: {
    criar: porQualquer(...MAPA_CAD_CRIAR),
    editar: pontoSuplementacaoEditar, // R4: campos + registro alcançado pelo fluxo
    excluir: porQualquer(...MAPA_CAD_EXCLUIR),
  },
  movimentacaoEstoque: {
    saidaSuplementacao: porQualquer({ mapa: 'lancar_suplementacao' }),
    transferenciaLocais: porQualquer({ mapa: 'movimentar_depositos' }),
    criar: SO_ADMIN, // sem chamador na interface
    // R3: o Mapa Cadastro só renomeia o local nas movimentações (FormularioPonto).
    editar: porQualquer(...MAPA_CAD_EDITAR.map((o) => ({ de: o, campos: ['local_origem', 'local_destino'] }))),
    excluir: SO_ADMIN, // estorno suspenso
  },
  estoqueLoteNota: {
    criar: SO_ADMIN,
    editar: porQualquer(...MAPA_CAD_EDITAR.map((o) => ({ de: o, campos: ['local_estoque_nome'] }))),
    excluir: SO_ADMIN,
  },
  // D-PROD-161 (Estoque P0): reconciliação somente leitura do estoque físico; sem tela no produto atual.
  estoqueFisico: { reconciliar: SO_ADMIN },
  // ── Bebedouros ──
  bebedouro: cadastro(T.BEBEDOUROS, { criar: MAPA_CAD_CRIAR, editar: MAPA_CAD_EDITAR }),
  // Espelhado no navegador por `src/lib/bebedouroPermissions.js` (os botões
  // "Lançar"/"Excluir" do bebedouro só aparecem com estas concessões).
  bebedouroHistorico: {
    criar: porQualquer([T.BEBEDOUROS, 'novo'], [T.BEBEDOUROS, 'salvar'], [T.MAPA_GERAL, 'salvar']),
    editar: porQualquer([T.BEBEDOUROS, 'editar'], [T.BEBEDOUROS, 'salvar']),
    // D-PROD-137 (BEB-02): apagar histórico exige a ação da tela DONA do
    // registro. O "excluir" do Mapa Geral é a caixa genérica da linha do mapa
    // (não fala de bebedouro) e não autoriza mais apagar lançamento.
    excluir: porQualquer([T.BEBEDOUROS, 'excluir']),
  },
  bebedouroSemTela: { criar: SO_ADMIN, editar: SO_ADMIN, excluir: SO_ADMIN }, // alertas e sanidade
  // ── Tarefas do mapa ──
  tarefa: porAcessoTotal(),
  // ── Cadastros do menu (tela + cadastro rápido) ──
  setor: cadastro(T.SETORES, { criar: LOTES_GRAVAR }),
  categoriaManejo: {
    ...cadastro(T.CATEGORIAS_MANEJO, { criar: LOTES_GRAVAR }),
    // D-PROD-195 — seletor de curva de ganho: quem cria OU edita categoria (o
    // cadastro rápido do lote incluído) lê as curvas da fazenda, sem a tela de curvas.
    opcoesCurvas: porQualquer(
      [T.CATEGORIAS_MANEJO, 'novo'], [T.CATEGORIAS_MANEJO, 'salvar'], [T.CATEGORIAS_MANEJO, 'editar'], ...LOTES_GRAVAR,
    ),
  },
  // F6 (D-PROD-137): pelo Mapa Cadastro só cria o local do depósito novo e renomeia
  // o local de um depósito; desativar/capacidade/excluir só na tela Locais.
  localEstoque: { ...cadastro(T.LOCAIS, { criar: MAPA_CAD_CRIAR }), editar: localEstoqueEditar },
  produto: cadastro(T.PRODUTOS),
  categoria: cadastro(T.CATEGORIAS),
  marca: cadastro(T.MARCAS),
  // D-PROD-146 — cada tela com a própria ação; ver = visualizar. Inativar e
  // vincular são edição do registro (editar/salvar). Sem DELETE físico.
  parceiro: { ...cadastro(T.PARCEIROS), ver: porTela(T.PARCEIROS, 'visualizar') },
  centroCusto: { ...cadastro(T.CENTROS_CUSTO), ver: porTela(T.CENTROS_CUSTO, 'visualizar') },
  centroResultado: { ...cadastro(T.CENTROS_RESULTADO), ver: porTela(T.CENTROS_RESULTADO, 'visualizar') },
  naturezaFinanceira: { ...cadastro(T.NATUREZAS_FINANCEIRAS), ver: porTela(T.NATUREZAS_FINANCEIRAS, 'visualizar') },
  // D-PROD-155 — Central Única de Lançamentos: cada efeito com a SUA ação da
  // tela (confirmar, cancelar, liquidar, estornar baixa são caixas próprias);
  // os seletores e a prévia só leem (visualizar).
  operacaoFinanceira: {
    ver: porTela(T.LANCAMENTOS_FINANCEIROS, 'visualizar'),
    criar: porQualquer([T.LANCAMENTOS_FINANCEIROS, 'novo'], [T.LANCAMENTOS_FINANCEIROS, 'salvar']),
    editar: porQualquer([T.LANCAMENTOS_FINANCEIROS, 'editar'], [T.LANCAMENTOS_FINANCEIROS, 'salvar']),
    confirmar: porTela(T.LANCAMENTOS_FINANCEIROS, 'confirmar'),
    cancelar: porTela(T.LANCAMENTOS_FINANCEIROS, 'cancelar'),
    liquidar: porTela(T.LANCAMENTOS_FINANCEIROS, 'liquidar'),
    estornarLiquidacao: porTela(T.LANCAMENTOS_FINANCEIROS, 'estornar_liquidacao'),
    // D-PROD-158 (P3-03). Retificar gera efeitos CONFIRMADOS novos (títulos e,
    // na substituição, estorno + entrada/saída): exige editar E confirmar —
    // quem não pode confirmar não retifica. Excluir confirmado estorna títulos e
    // estoque como o cancelamento: exige cancelar (o menor privilégio que cobre
    // o efeito) E a ação de tela excluir. Duplicar é o POST de criação (`criar`;
    // toda ação de tela já exige `visualizar`). O descarte do rascunho segue em `editar`.
    retificar: porTodas(
      [[T.LANCAMENTOS_FINANCEIROS, 'editar'], [T.LANCAMENTOS_FINANCEIROS, 'salvar']],
      [[T.LANCAMENTOS_FINANCEIROS, 'confirmar']],
    ),
    excluirConfirmado: porTodas([[T.LANCAMENTOS_FINANCEIROS, 'cancelar']], [[T.LANCAMENTOS_FINANCEIROS, 'excluir']]),
  },
  // Perfil financeiro: leitura pela tela; escrita só administrador real ou is_admin (§8.6).
  perfilFinanceiro: { ver: porTela(T.LANCAMENTOS_FINANCEIROS, 'visualizar'), editar: adminOuIsAdmin() },
  // D-PROD-157 / D-PROD-162 — Patrimônio e Frota: duas telas (Bens e
  // Abastecimentos); inativar e reativar (PATCH com `ativo`) exigem a ação
  // extra `inativar`. Sem DELETE de bem; D-PROD-169: DELETE só de tipo sem uso.
  patrimonioBens: {
    ...patrimonio(T.PATRIMONIO_BENS),
    // A3: opções de CATÁLOGO (os tipos do formulário do bem; D-PROD-169: famílias saíram).
    opcoesCatalogo: porTela(T.PATRIMONIO_BENS, 'visualizar'),
    // "Produtos aceitos" do tanque: quem cadastra OU edita bem; ver sozinho não lista produtos da fazenda.
    opcoesProdutos: porQualquer(...BENS_CRIAR_OU_EDITAR),
  },
  // D-PROD-162: famílias e tipos vivem no cadastro de Bens; quem cadastra OU edita bem cria tipo pelo "+".
  // Renomear/descrever = Bens editar|salvar; inativar/reativar = Bens `inativar` (`edicaoPatrimonio`).
  // D-PROD-169: família não tem mais rota (nem leitura); excluir tipo ("Gerenciar tipos") = Bens editar|salvar,
  // a mesma permissão de renomear.
  patrimonioTipos: {
    ver: porTela(T.PATRIMONIO_BENS, 'visualizar'),
    criar: porQualquer(...BENS_CRIAR_OU_EDITAR),
    editar: edicaoPatrimonio(T.PATRIMONIO_BENS),
    excluir: porQualquer([T.PATRIMONIO_BENS, 'editar'], [T.PATRIMONIO_BENS, 'salvar']),
  },
  // D-PROD-159 / D-PROD-162 — Abastecimentos. Prévia e confirmação = novo|salvar;
  // cancelar/estornar é ação extra própria; leitura e seletores = visualizar DESTA
  // tela (não dependem da tela de bens nem da Central); saldos = criar. O fator kg/L saiu.
  patrimonioAbastecimentos: {
    ver: porTela(T.PATRIMONIO_ABASTECIMENTOS, 'visualizar'),
    criar: porQualquer([T.PATRIMONIO_ABASTECIMENTOS, 'novo'], [T.PATRIMONIO_ABASTECIMENTOS, 'salvar']),
    cancelar: porTela(T.PATRIMONIO_ABASTECIMENTOS, 'cancelar'),
  },
  // Instalar o catálogo padrão: administrador real ou a concessão `is_admin`.
  patrimonioCatalogoPadrao: adminOuIsAdmin(),
  unidadeMedida: cadastro(T.UNIDADES),
  tipoTarefa: cadastro(T.TIPOS_TAREFA),
  // D-PROD-182. D-PROD-197: opções de centro padrão do formulário = criar OU editar tipo.
  tipoAtividade: { ...cadastro(T.TIPOS_ATIVIDADE), opcoes: porQualquer(...TIPOS_ATIVIDADE_CRIAR_OU_EDITAR) },
  // D-PROD-188 — Estações da fazenda: leitura também pela tela (dado por fazenda).
  estacao: { ...cadastro(T.ESTACOES), ver: porTela(T.ESTACOES, 'visualizar') },
  // D-PROD-189 — Curvas de Ganho de Peso: leitura também pela tela (dado por fazenda).
  curvaGanho: { ...cadastro(T.CURVAS_GANHO), ver: porTela(T.CURVAS_GANHO, 'visualizar') },
  // D-PROD-190 — Apontamento de Atividade: o esquema do cadastro (criar =
  // novo|salvar; editar = editar|salvar). Sem DELETE físico: cancelar é a
  // ação `excluir` da tela. Leitura e seletores = visualizar DESTA tela (dado
  // operacional da fazenda; não dependem das telas de bens nem de centros).
  // D-PROD-193 (D-3), sem ação nova: adicionar item = `editar` (editar|salvar);
  // cancelar item = `cancelar` (excluir); produtos = `ver`; locais com saldo =
  // `editar` (saldo é de quem lança). Nenhum perfil recebe acesso por padrão.
  apontamentoAtividade: {
    ver: porTela(T.APONTAMENTOS_ATIVIDADE, 'visualizar'),
    criar: cadastro(T.APONTAMENTOS_ATIVIDADE).criar,
    editar: cadastro(T.APONTAMENTOS_ATIVIDADE).editar,
    cancelar: cadastro(T.APONTAMENTOS_ATIVIDADE).excluir,
  },
  grupoAtividade: cadastro(T.GRUPOS_ATIVIDADE),
  // ── Anexos, upload e referências (efeitos das telas que os usam) ──
  anexo: { criar: porQualquer(...LOTES_GRAVAR), excluir: porQualquer([T.LOTES, 'excluir']) },
  upload: porQualquer(...LOTES_GRAVAR, [T.EMPRESA, 'novo'], [T.EMPRESA, 'editar'], [T.EMPRESA, 'salvar']),
  referencias: referenciasDaEntidade,
  // ── Sem tela no produto atual (nenhum chamador no navegador) ──
  semTela: SO_ADMIN,
});

