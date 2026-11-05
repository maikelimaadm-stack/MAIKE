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

import { TELAS, porQualquer, porAcessoTotal, apenasAdminTenant } from './autorizacaoTela.js';

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

export const GUARDAS = Object.freeze({
  // ── Mapa Geral: suplementação, cochos/depósitos e estoque ──
  suplementacaoLote: {
    criar: porQualquer({ mapa: 'lancar_suplementacao' }, { mapa: 'mover_lotes' }),
    editar: porQualquer({ mapa: 'lancar_suplementacao' }, { mapa: 'mover_lotes' }),
    excluir: SO_ADMIN, // estorno suspenso na interface (politicaEstorno)
  },
  suplementacaoEvento: {
    criar: porQualquer({ mapa: 'lancar_suplementacao' }, { mapa: 'mover_lotes' }),
    lancamento: porQualquer({ mapa: 'lancar_suplementacao' }),
    editar: porQualquer({ mapa: 'lancar_suplementacao' }, { mapa: 'mover_lotes' }),
    excluir: SO_ADMIN,
  },
  pontoSuplementacao: {
    criar: porQualquer(...MAPA_CAD_CRIAR),
    editar: porQualquer(...MAPA_CAD_EDITAR, [T.MAPA_CADASTRO, 'excluir'], [T.LOCAIS, 'editar'], [T.LOCAIS, 'salvar']),
    excluir: porQualquer(...MAPA_CAD_EXCLUIR),
  },
  movimentacaoEstoque: {
    saidaSuplementacao: porQualquer({ mapa: 'lancar_suplementacao' }),
    transferenciaLocais: porQualquer({ mapa: 'movimentar_depositos' }),
    criar: SO_ADMIN, // sem chamador na interface
    editar: porQualquer(...MAPA_CAD_EDITAR),
    excluir: SO_ADMIN, // estorno suspenso
  },
  estoqueLoteNota: { criar: SO_ADMIN, editar: porQualquer(...MAPA_CAD_EDITAR), excluir: SO_ADMIN },
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
  anexo: { criar: porQualquer(...LOTES_GRAVAR), excluir: porQualquer([T.LOTES, 'excluir'], [T.LOTES, 'editar']) },
  upload: porQualquer(...LOTES_GRAVAR, [T.EMPRESA, 'novo'], [T.EMPRESA, 'editar'], [T.EMPRESA, 'salvar']),
  referencias: porQualquer(
    ...LOTES_GRAVAR,
    ...[T.PRODUTOS, T.SETORES, T.GRUPOS_ATIVIDADE, T.TIPOS_TAREFA].flatMap((t) => [[t, 'editar'], [t, 'salvar']])
  ),
  // ── Sem tela no produto atual (nenhum chamador no navegador) ──
  semTela: SO_ADMIN,
});

