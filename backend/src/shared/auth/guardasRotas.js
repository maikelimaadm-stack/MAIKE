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
import { CAMPOS_PATCH_PERMITIDOS as CAMPOS_PATCH_EVENTO } from '../../modules/suplementacaoEventos/suplementacaoEventoService.js';
import { CAMPOS_PATCH_PERMITIDOS as CAMPOS_PATCH_LOTE } from '../../modules/suplementacaoLotes/suplementacaoLoteService.js';
import {
  TELAS, porQualquer, porAcessoTotal, apenasAdminTenant, autorizar, carregarAutorizacao, mapaPermite,
  telaPermite, acessoTotal, somenteCampos, acaoNaoPermitida,
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
 * R3 — "mover lotes" NÃO é "lançar suplementação". Criar/alterar suplementação
 * livremente exige `lancar_suplementacao`. Com só `mover_lotes`, o PATCH vale
 * apenas como FECHAMENTO DO PERÍODO que a interface faz ao mover o gado
 * (`fecharPeriodoSuplementacao`): o corpo só traz os campos do fechamento E o
 * registro, relido do banco no tenant, ainda está aberto (`dias_periodo` vazio).
 * Período já fechado, registro de outro tenant ou inexistente → negado.
 * @param {'suplementacaoEvento'|'suplementacaoLote'} modelo
 * @param {readonly string[]} camposDoFechamento
 */
const fechamentoOuLancamento = (modelo, camposDoFechamento) => async (request) => {
  const aut = await carregarAutorizacao(request.contexto);
  if (acessoTotal(aut) || mapaPermite(aut, 'lancar_suplementacao')) return;
  const negar = () => acaoNaoPermitida({ tela: TELAS.MAPA_GERAL.tela, mapa: 'lancar_suplementacao', fechamento: 'mover_lotes' });
  if (!mapaPermite(aut, 'mover_lotes') || !somenteCampos(request.body, camposDoFechamento)) throw negar();
  const auth = exigirAuthContext(request.contexto?.auth);
  const id = /** @type {any} */ (request.params)?.id;
  const registro = await /** @type {any} */ (getPrismaClient())[modelo].findFirst({ where: { cliente_id: auth.clienteId, id }, select: { dados: true } });
  const dados = /** @type {any} */ (registro?.dados) ?? null;
  const aberto = dados && (dados.dias_periodo === null || dados.dias_periodo === undefined || dados.dias_periodo === '');
  if (!aberto) throw negar();
};
// Os mesmos campos que o service aceita por PATCH (fonte única: o service).
const CAMPOS_FECHAMENTO_EVENTO = CAMPOS_PATCH_EVENTO;
const CAMPOS_FECHAMENTO_LOTE = CAMPOS_PATCH_LOTE;

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
    editar: fechamentoOuLancamento('suplementacaoLote', CAMPOS_FECHAMENTO_LOTE),
    excluir: SO_ADMIN, // estorno suspenso na interface (politicaEstorno)
  },
  suplementacaoEvento: {
    criar: porQualquer({ mapa: 'lancar_suplementacao' }),
    lancamento: porQualquer({ mapa: 'lancar_suplementacao' }),
    editar: fechamentoOuLancamento('suplementacaoEvento', CAMPOS_FECHAMENTO_EVENTO),
    excluir: SO_ADMIN,
  },
  pontoSuplementacao: {
    criar: porQualquer(...MAPA_CAD_CRIAR),
    // R3: Mapa Cadastro edita tudo; os fluxos cruzados só nos seus campos —
    // excluir depósito desvincula cochos; renomear local renomeia o depósito.
    editar: porQualquer(
      ...MAPA_CAD_EDITAR,
      { de: [T.MAPA_CADASTRO, 'excluir'], campos: ['deposito_origem_id', 'deposito_origem_nome'] },
      { de: [T.LOCAIS, 'editar'], campos: ['nome_ponto', 'local_estoque_nome', 'deposito_origem_nome'] },
      { de: [T.LOCAIS, 'salvar'], campos: ['nome_ponto', 'local_estoque_nome', 'deposito_origem_nome'] }
    ),
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
  localEstoque: cadastro(T.LOCAIS, { criar: MAPA_CAD_CRIAR, editar: MAPA_CAD_EDITAR, excluir: MAPA_CAD_EXCLUIR }),
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

