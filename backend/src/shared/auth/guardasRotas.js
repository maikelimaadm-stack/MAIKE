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
  TELAS, porQualquer, porAcessoTotal, apenasAdminTenant, autorizar, telaPermite, acessoTotal,
  carregarAutorizacao, somenteCampos, acaoNaoPermitida,
} from './autorizacaoTela.js';

const T = TELAS;
/** Criar/alterar/excluir pela tela do cadastro, com telas extras (cadastro rápido). */
const cadastro = (alvo, extras = {}) => ({
  criar: porQualquer([alvo, 'novo'], [alvo, 'salvar'], ...(extras.criar ?? [])),
  editar: porQualquer([alvo, 'editar'], [alvo, 'salvar'], ...(extras.editar ?? [])),
  excluir: porQualquer([alvo, 'excluir'], ...(extras.excluir ?? [])),
});
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
 * D-PROD-136 (F6) — LocalEstoque pela tela cruzada do Mapa Cadastro. O único
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
  // ── Bebedouros ──
  bebedouro: cadastro(T.BEBEDOUROS, { criar: MAPA_CAD_CRIAR, editar: MAPA_CAD_EDITAR }),
  bebedouroHistorico: {
    criar: porQualquer([T.BEBEDOUROS, 'novo'], [T.BEBEDOUROS, 'salvar'], [T.MAPA_GERAL, 'salvar']),
    editar: porQualquer([T.BEBEDOUROS, 'editar'], [T.BEBEDOUROS, 'salvar']),
    excluir: porQualquer([T.BEBEDOUROS, 'excluir'], [T.MAPA_GERAL, 'excluir']),
  },
  bebedouroSemTela: { criar: SO_ADMIN, editar: SO_ADMIN, excluir: SO_ADMIN }, // alertas e sanidade
  // ── Tarefas do mapa ──
  tarefa: porAcessoTotal(),
  // ── Cadastros do menu (tela + cadastro rápido) ──
  setor: cadastro(T.SETORES, { criar: LOTES_GRAVAR }),
  categoriaManejo: cadastro(T.CATEGORIAS_MANEJO, { criar: LOTES_GRAVAR }),
  // F6 (D-PROD-136): pelo Mapa Cadastro só cria o local do depósito novo e renomeia
  // o local de um depósito; desativar/capacidade/excluir só na tela Locais.
  localEstoque: { ...cadastro(T.LOCAIS, { criar: MAPA_CAD_CRIAR }), editar: localEstoqueEditar },
  produto: cadastro(T.PRODUTOS),
  categoria: cadastro(T.CATEGORIAS),
  marca: cadastro(T.MARCAS),
  unidadeMedida: cadastro(T.UNIDADES),
  tipoTarefa: cadastro(T.TIPOS_TAREFA),
  grupoAtividade: cadastro(T.GRUPOS_ATIVIDADE),
  // ── Anexos, upload e referências (efeitos das telas que os usam) ──
  anexo: { criar: porQualquer(...LOTES_GRAVAR), excluir: porQualquer([T.LOTES, 'excluir']) },
  upload: porQualquer(...LOTES_GRAVAR, [T.EMPRESA, 'novo'], [T.EMPRESA, 'editar'], [T.EMPRESA, 'salvar']),
  referencias: referenciasDaEntidade,
  // ── Sem tela no produto atual (nenhum chamador no navegador) ──
  semTela: SO_ADMIN,
});

