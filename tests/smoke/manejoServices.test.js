/**
 * Services do manejo (P1.3).
 *
 * O foco é o **contrato** que saiu dos repositórios removidos: numeração,
 * normalização, guarda de exclusão por código, catálogo fechado de fontes de
 * opção e anexo pendente. A interface não é montada aqui.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const lotes = {
  listLotes: vi.fn(), filterLotes: vi.fn(), createLote: vi.fn(), updateLote: vi.fn(), deleteLote: vi.fn(),
  listMovimentacoes: vi.fn(), listTodasMovimentacoes: vi.fn(), listMovimentacoesPecuarias: vi.fn(),
  listSuplementacaoLotes: vi.fn(), listFornecedores: vi.fn(), listCategoriasManejo: vi.fn(),
  listLayoutConfiguracoes: vi.fn(), createLayoutConfiguracao: vi.fn(),
  listLayoutSecoes: vi.fn(), createLayoutSecao: vi.fn(), listLayoutCampos: vi.fn(),
  createLayoutCampo: vi.fn(), updateLayoutCampo: vi.fn(), deleteLayoutCampo: vi.fn(),
  sincronizarReferenciasLote: vi.fn(),
};
const estoque = { listProdutos: vi.fn(), listLocais: vi.fn() };
const setores = { listSetores: vi.fn(), createSetor: vi.fn(), updateSetor: vi.fn(), deleteSetor: vi.fn(), sincronizarReferenciasSetor: vi.fn() };
const categorias = { listCategorias: vi.fn(), createCategoria: vi.fn(), updateCategoria: vi.fn(), deleteCategoria: vi.fn() };
const categoriasManejo = { listCategoriasManejo: vi.fn(), createCategoriaManejo: vi.fn(), updateCategoriaManejo: vi.fn(), deleteCategoriaManejo: vi.fn() };
const bebedouros = {
  listBebedouros: vi.fn(), createBebedouro: vi.fn(), updateBebedouro: vi.fn(),
  listHistorico: vi.fn(), createHistorico: vi.fn(), deleteHistorico: vi.fn(),
  listSanidade: vi.fn(), createSanidade: vi.fn(), listAlertas: vi.fn(),
};
const anexos = { filterAnexos: vi.fn(), createAnexo: vi.fn(), deleteAnexo: vi.fn(), ANEXO_DEFAULT_ORDER: '-created_date' };
const arquivos = { uploadArquivo: vi.fn() };
const mapa = { listAreas: vi.fn(), listIcones: vi.fn(), listPontos: vi.fn() };
const tarefas = { listLancamentos: vi.fn() };
const rebanho = { listManejosTecnicos: vi.fn() };
const session = { getCurrentUser: vi.fn(), listPermissoes: vi.fn() };

vi.mock('@/apis/lotes', () => lotes);
vi.mock('@/apis/setores', () => setores);
vi.mock('@/apis/estoque', () => estoque);
vi.mock('@/apis/categorias', () => categorias);
vi.mock('@/apis/categorias-manejo', () => categoriasManejo);
vi.mock('@/apis/bebedouros', () => bebedouros);
vi.mock('@/apis/anexos', () => anexos);
vi.mock('@/apis/arquivos', () => arquivos);
vi.mock('@/apis/mapa', () => mapa);
vi.mock('@/apis/tarefas', () => tarefas);
vi.mock('@/apis/rebanho', () => rebanho);
vi.mock('@/apis/session', () => session);

const loteCadastro = await import('@/services/loteCadastroService');
const setorSvc = await import('@/services/setorService');
const categoriaSvc = await import('@/services/categoriaProdutoService');
const categoriaManejoSvc = await import('@/services/categoriaManejoService');
const bebedouroSvc = await import('@/services/bebedouroDataService');
const anexoSvc = await import('@/services/anexoService');
const { API_ERROR_CODES, hasApiErrorCode, getApiErrorMessage } = await import('@/apis/_core/ApiError');

const EMPRESA = 'emp-1';

beforeEach(() => {
  vi.clearAllMocks();
  for (const grupo of [lotes, setores, estoque, categorias, categoriasManejo, bebedouros, anexos, mapa, tarefas, rebanho]) {
    for (const fn of Object.values(grupo)) {
      if (typeof fn?.mockResolvedValue === 'function') fn.mockResolvedValue([]);
    }
  }
  session.getCurrentUser.mockResolvedValue({ full_name: 'Fulano', email: 'f@x.test' });
});

describe('L — cadastro de lotes', () => {
  it('L1 — lista por empresa', async () => {
    lotes.listLotes.mockResolvedValue([{ id: 'a', empresa_id: EMPRESA }, { id: 'b', empresa_id: 'outra' }]);
    expect(await loteCadastro.listarLotes({ empresaId: EMPRESA })).toEqual([{ id: 'a', empresa_id: EMPRESA }]);
  });

  it('L2 — exclui origens de sistema quando pedido', async () => {
    lotes.listLotes.mockResolvedValue([
      { id: 'a', empresa_id: EMPRESA, origem: 'COMPRA' },
      { id: 'b', empresa_id: EMPRESA, origem: 'MOVIMENTAÇÃO' },
      { id: 'c', empresa_id: EMPRESA, origem: 'Nascimento' },
    ]);
    const visiveis = await loteCadastro.listarLotes({ empresaId: EMPRESA, incluirSistema: false });
    expect(visiveis.map((l) => l.id)).toEqual(['a']);
  });

  it('L3 — próximo número é max + 1, tolerando valor não numérico', () => {
    expect(loteCadastro.proximoNumeroLote([{ numero_lote: '7' }, { numero_lote: 'x' }, { numero_lote: 3 }])).toBe('8');
    expect(loteCadastro.proximoNumeroLote([])).toBe('1');
  });

  it('L4 — criar aplica empresa, número, status e campos personalizados', async () => {
    lotes.listLotes.mockResolvedValue([{ numero_lote: '4' }]);
    lotes.createLote.mockResolvedValue({ id: 'novo' });
    await loteCadastro.criarLote({ nome: 'L' }, { empresaId: EMPRESA });
    expect(lotes.createLote).toHaveBeenCalledWith(
      expect.objectContaining({ empresa_id: EMPRESA, numero_lote: '5', status: 'Ativo', campos_personalizados: {} })
    );
  });

  it('L5 — atualizar sincroniza referências depois de gravar', async () => {
    lotes.updateLote.mockResolvedValue({ id: 'l1', nome: 'NOVO' });
    await loteCadastro.atualizarLote('l1', { nome: 'NOVO' }, { registroAnterior: { nome: 'VELHO' } });
    expect(lotes.updateLote).toHaveBeenCalled();
    expect(lotes.sincronizarReferenciasLote).toHaveBeenCalledWith({
      registro: { id: 'l1', nome: 'NOVO' },
      registroAnterior: { nome: 'VELHO' },
    });
  });

  it('L6 — delete guard bloqueia por código, não por texto', async () => {
    lotes.listLotes.mockResolvedValue([{ id: 'l1', empresa_id: EMPRESA }]);
    lotes.listMovimentacoes.mockResolvedValue([{ id: 'm1', lote_id: 'l1', empresa_id: EMPRESA }]);
    const erro = await loteCadastro.validarExclusaoDeLote('l1').catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.LOTE_DELETE_BLOCKED)).toBe(true);
    expect(getApiErrorMessage(erro)).not.toMatch(/undefined|\[object/);
  });

  it('L6b — sem vínculo, a guarda libera', async () => {
    lotes.listLotes.mockResolvedValue([{ id: 'l1', empresa_id: EMPRESA }]);
    await expect(loteCadastro.validarExclusaoDeLote('l1')).resolves.toBeUndefined();
  });

  it('L7 — áreas ativas da empresa', async () => {
    mapa.listAreas.mockResolvedValue([
      { id: 'a1', empresa_id: EMPRESA, ativo: true },
      { id: 'a2', empresa_id: EMPRESA, ativo: false },
      { id: 'a3', empresa_id: 'outra', ativo: true },
    ]);
    expect((await loteCadastro.listarAreasAtivas(EMPRESA)).map((a) => a.id)).toEqual(['a1']);
  });

  it('L8 — ids com movimentação vêm das duas origens, sem repetir', async () => {
    lotes.listMovimentacoesPecuarias.mockResolvedValue([{ lote_id: 'l1', empresa_id: EMPRESA }]);
    lotes.listTodasMovimentacoes.mockResolvedValue([
      { lote_id: 'l1', empresa_id: EMPRESA },
      { lote_id: 'l2', empresa_id: EMPRESA },
      { lote_id: 'l3', empresa_id: 'outra' },
    ]);
    expect(await loteCadastro.listarIdsDeLotesComMovimentacao(EMPRESA)).toEqual(['l1', 'l2']);
  });

  it('L9/L10 — categorias de manejo ativas e fornecedores por empresa', async () => {
    lotes.listCategoriasManejo.mockResolvedValue([
      { id: 'c1', empresa_id: EMPRESA, ativo: true }, { id: 'c2', empresa_id: EMPRESA, ativo: false },
    ]);
    lotes.listFornecedores.mockResolvedValue([{ id: 'f1', empresa_id: EMPRESA }, { id: 'f2', empresa_id: 'x' }]);
    expect((await loteCadastro.listarCategoriasManejoAtivas(EMPRESA)).map((c) => c.id)).toEqual(['c1']);
    expect((await loteCadastro.listarFornecedores(EMPRESA)).map((f) => f.id)).toEqual(['f1']);
  });

  it('L11 — layout base é idempotente: já existindo, não recria', async () => {
    lotes.listLayoutConfiguracoes.mockResolvedValue([{ id: 'lay', tela: 'CadastroLotes', ativo: true }]);
    lotes.listLayoutSecoes.mockResolvedValue([{ id: 's', layout_id: 'lay', section_id: 'campos_personalizados' }]);
    lotes.listLayoutCampos.mockResolvedValue([
      { id: 'c', layout_id: 'lay', field_name: 'motivo_entrada', metadata: { native_select: true } },
    ]);
    await loteCadastro.garantirLayoutBase();
    expect(lotes.createLayoutConfiguracao).not.toHaveBeenCalled();
    expect(lotes.createLayoutSecao).not.toHaveBeenCalled();
    expect(lotes.updateLayoutCampo).toHaveBeenCalledTimes(1);
  });

  it('L12 — campo nativo protegido não é excluído', async () => {
    const erro = await loteCadastro
      .excluirCampoPersonalizado({ id: 'c', field_name: 'motivo_entrada', metadata: { native_select: true } })
      .catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.LOTE_NATIVE_FIELD_PROTECTED)).toBe(true);
    expect(lotes.deleteLayoutCampo).not.toHaveBeenCalled();
  });

  it('L13/L14 — campo sem dados sai; campo com dados é bloqueado por código', async () => {
    lotes.listLotes.mockResolvedValue([{ id: 'l1', campos_personalizados: { outro: 'x' } }]);
    await loteCadastro.excluirCampoPersonalizado({ id: 'c1', field_name: 'meu_campo' });
    expect(lotes.deleteLayoutCampo).toHaveBeenCalledWith('c1');

    lotes.listLotes.mockResolvedValue([{ id: 'l1', campos_personalizados: { meu_campo: 'valor' } }]);
    const erro = await loteCadastro.excluirCampoPersonalizado({ id: 'c1', field_name: 'meu_campo' }).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.LOTE_FIELD_HAS_DATA)).toBe(true);
  });

  it('P3/L15 — cada fonte é carregada por uma API pública explícita', async () => {
    lotes.listFornecedores.mockResolvedValue([{ id: 'f1', nome: 'ACME' }]);
    estoque.listProdutos.mockResolvedValue([{ id: 'p1', nome_produto: 'RAÇÃO' }]);
    categoriasManejo.listCategoriasManejo.mockResolvedValue([{ id: 'c1', nome: 'BOI' }]);
    setores.listSetores.mockResolvedValue([{ id: 's1', nome: 'PASTO' }]);
    mapa.listAreas.mockResolvedValue([{ id: 'a1', nome: 'PIQUETE' }]);
    estoque.listLocais.mockResolvedValue([{ id: 'l1', nome: 'GALPÃO' }]);

    const r = await loteCadastro.listarFontesDeOpcoes([
      'Fornecedor', 'Produto', 'CategoriaManejo', 'Setor', 'AreaPastagem', 'LocalEstoque',
    ]);

    expect(lotes.listFornecedores).toHaveBeenCalled();
    expect(estoque.listProdutos).toHaveBeenCalled();
    expect(categoriasManejo.listCategoriasManejo).toHaveBeenCalled();
    expect(setores.listSetores).toHaveBeenCalled();
    expect(mapa.listAreas).toHaveBeenCalled();
    expect(estoque.listLocais).toHaveBeenCalled();

    expect(r.Fornecedor[0]).toMatchObject({ value: 'f1', label: 'ACME' });
    // `Produto` usa `nome_produto` como rótulo — o catálogo declara o campo.
    expect(r.Produto[0]).toMatchObject({ value: 'p1', label: 'RAÇÃO' });
  });

  it('L16 — o catálogo é fechado e reflete o que a interface oferece', () => {
    expect(Object.keys(loteCadastro.OPTION_SOURCES).sort()).toEqual(
      ['AreaPastagem', 'CategoriaManejo', 'Fornecedor', 'LocalEstoque', 'Produto', 'Setor']
    );
    expect(loteCadastro.isOptionSourceSuportada('Usuario')).toBe(false);
  });

  it('P4 — fonte desconhecida falha antes de qualquer I/O', async () => {
    lotes.listFornecedores.mockResolvedValue([{ id: 'f1', nome: 'ACME' }]);
    const erro = await loteCadastro
      .listarFontesDeOpcoes(['Fornecedor', 'Usuario'])
      .catch((e) => e);

    expect(hasApiErrorCode(erro, API_ERROR_CODES.LOTE_OPTION_SOURCE_UNSUPPORTED)).toBe(true);
    // Nem a fonte válida foi carregada: a validação é completa antes de começar.
    expect(lotes.listFornecedores).not.toHaveBeenCalled();
    expect(erro.details).toEqual({ fonte: 'Usuario' });
  });
});

describe('S — setores', () => {
  it('S1 — lista por empresa', async () => {
    setores.listSetores.mockResolvedValue([{ id: 's1', empresa_id: EMPRESA }, { id: 's2', empresa_id: 'x' }]);
    expect((await setorSvc.listarSetoresDaEmpresa(EMPRESA)).map((s) => s.id)).toEqual(['s1']);
  });

  it('S2 — número seguinte é string, max + 1', () => {
    expect(setorSvc.proximoNumeroSetor([{ numero_setor: '2' }, { numero_setor: '9' }])).toBe('10');
  });

  it('S3 — normalização preserva o payload real da tela', () => {
    const payload = setorSvc.normalizarSetor(
      { nome: 'pasto a', sigla: 'pa', cidade: '', area_total: '12.5', capacidade_animais: '30' },
      { empresaId: EMPRESA, numeroSetor: '3' }
    );
    expect(payload).toMatchObject({
      nome: 'PASTO A', sigla: 'PA', cidade: null,
      area_total: 12.5, capacidade_animais: 30,
      empresa_id: EMPRESA, numero_setor: '3',
    });
  });

  /**
   * Comportamento herdado, preservado de propósito.
   *
   * A tela usava `parseFloat(data.area_total)`, que não entende vírgula
   * decimal: `'12,5'` vira `12` em silêncio. Corrigir isso mudaria o dado
   * gravado e não é migração de fronteira — fica registrado como dívida.
   */
  it('S3b — vírgula decimal ainda trunca, como antes da migração', () => {
    expect(setorSvc.normalizarSetor({ area_total: '12,5' }).area_total).toBe(12);
  });

  it('S4 — criar numera sobre todos os setores, não só os da empresa', async () => {
    setores.listSetores.mockResolvedValue([{ numero_setor: '4', empresa_id: 'outra' }]);
    await setorSvc.criarSetor({ nome: 'novo' }, { empresaId: EMPRESA });
    expect(setores.createSetor).toHaveBeenCalledWith(expect.objectContaining({ numero_setor: '5' }));
  });

  it('S5/S6 — sincroniza só quando o nome muda', async () => {
    setores.updateSetor.mockResolvedValue({ id: 's1', nome: 'NOVO' });
    await setorSvc.atualizarSetor('s1', { nome: 'novo' }, { registroAnterior: { nome: 'VELHO' } });
    expect(setores.sincronizarReferenciasSetor).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    setores.updateSetor.mockResolvedValue({ id: 's1', nome: 'IGUAL' });
    await setorSvc.atualizarSetor('s1', { nome: 'igual' }, { registroAnterior: { nome: 'IGUAL' } });
    expect(setores.sincronizarReferenciasSetor).not.toHaveBeenCalled();
  });

  it('S7 — sem vínculo, exclui', async () => {
    setores.listSetores.mockResolvedValue([{ id: 's1', empresa_id: EMPRESA, nome: 'A' }]);
    await setorSvc.excluirSetor('s1');
    expect(setores.deleteSetor).toHaveBeenCalledWith('s1');
  });

  it('S8 — com área vinculada, bloqueia por código e não exclui', async () => {
    setores.listSetores.mockResolvedValue([{ id: 's1', empresa_id: EMPRESA, nome: 'A' }]);
    mapa.listAreas.mockResolvedValue([{ id: 'a1', setor_id: 's1', empresa_id: EMPRESA }]);
    const erro = await setorSvc.excluirSetor('s1').catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.SETOR_DELETE_BLOCKED)).toBe(true);
    expect(setores.deleteSetor).not.toHaveBeenCalled();
  });
});

describe('C — categorias de produto', () => {
  it('C1–C4 — list, create, update e delete simples', async () => {
    categorias.listCategorias.mockResolvedValue([{ id: 'c1' }]);
    expect(await categoriaSvc.listarTodasCategorias()).toEqual([{ id: 'c1' }]);
    await categoriaSvc.criarCategoria({ nome: 'X' }, { empresaId: EMPRESA });
    expect(categorias.createCategoria).toHaveBeenCalledWith(expect.objectContaining({ empresa_id: EMPRESA }));
    await categoriaSvc.atualizarCategoria('c1', { nome: 'Y' });
    expect(categorias.updateCategoria).toHaveBeenCalledWith('c1', { nome: 'Y' });
    categorias.listCategorias.mockResolvedValue([{ id: 'c1' }]);
    await categoriaSvc.excluirCategorias(['c1']);
    expect(categorias.deleteCategoria).toHaveBeenCalledWith('c1');
  });

  it('C5 — pai com filhos bloqueia antes de excluir qualquer coisa', async () => {
    categorias.listCategorias.mockResolvedValue([{ id: 'pai' }, { id: 'filho', categoria_pai_id: 'pai' }]);
    const erro = await categoriaSvc.excluirCategorias(['pai']).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.CATEGORIA_HAS_CHILDREN)).toBe(true);
    expect(categorias.deleteCategoria).not.toHaveBeenCalled();
  });

  it('C5b — filho excluído junto não bloqueia o pai', async () => {
    categorias.listCategorias.mockResolvedValue([{ id: 'pai' }, { id: 'filho', categoria_pai_id: 'pai' }]);
    await categoriaSvc.excluirCategorias(['pai', 'filho']);
    expect(categorias.deleteCategoria).toHaveBeenCalledTimes(2);
  });

  it('C6 — exclusão múltipla valida tudo antes de excluir', async () => {
    categorias.listCategorias.mockResolvedValue([
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'x', categoria_pai_id: 'c' },
    ]);
    const erro = await categoriaSvc.excluirCategorias(['a', 'b', 'c']).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.CATEGORIA_HAS_CHILDREN)).toBe(true);
    // Nada foi excluído: nem 'a' nem 'b', que sozinhos seriam válidos.
    expect(categorias.deleteCategoria).not.toHaveBeenCalled();
  });

  it('C7 — falha no meio reporta o que saiu e o que ficou', async () => {
    categorias.listCategorias.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    categorias.deleteCategoria.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('rede'));
    const erro = await categoriaSvc.excluirCategorias(['a', 'b']).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.CATEGORIA_PARTIAL_DELETE)).toBe(true);
    expect(erro.details).toEqual({ excluidas: ['a'], restantes: ['b'] });
  });

  it('C8 — a mensagem pública não carrega o texto do provider', async () => {
    categorias.listCategorias.mockResolvedValue([{ id: 'a' }]);
    categorias.deleteCategoria.mockRejectedValue(new Error('ECONNREFUSED https://interno/api?token=abc'));
    const erro = await categoriaSvc.excluirCategorias(['a']).catch((e) => e);
    const publico = getApiErrorMessage(erro);
    expect(publico).not.toMatch(/ECONNREFUSED|https?:\/\/|token/);
    expect(JSON.stringify(erro)).not.toMatch(/token=abc/);
  });
});

describe('CM — categorias de manejo', () => {
  it('CM1 — lista por empresa', async () => {
    categoriasManejo.listCategoriasManejo.mockResolvedValue([{ id: 'a', empresa_id: EMPRESA }, { id: 'b', empresa_id: 'x' }]);
    expect((await categoriaManejoSvc.listarCategoriasManejoDaEmpresa(EMPRESA)).map((c) => c.id)).toEqual(['a']);
  });

  it('CM2 — ícones de Lote ativos da empresa, via capacidade do mapa', async () => {
    mapa.listIcones.mockResolvedValue([
      { id: 'i1', tipo_entidade: 'Lote', empresa_id: EMPRESA, ativo: true },
      { id: 'i2', tipo_entidade: 'Lote', empresa_id: EMPRESA, ativo: false },
      { id: 'i3', tipo_entidade: 'Ponto', empresa_id: EMPRESA, ativo: true },
    ]);
    expect((await categoriaManejoSvc.listarIconesDeLoteDaEmpresa(EMPRESA)).map((i) => i.id)).toEqual(['i1']);
  });

  /**
   * CM3 — a normalização saiu da página para o service na P1.3-R1, **idêntica**.
   * O caso abaixo é o payload completo que `handleSubmit` montava.
   */
  const FORM = Object.freeze({
    nome: 'boi gordo', sigla: 'bg', especie: 'Bovino', sexo: '', raca: 'nelore',
    idade_minima_meses: '12', idade_maxima_meses: '', categoria_oficial: '',
    ganho_peso_anual_kg: '180.5',
    gmd_janeiro: '0.8', gmd_fevereiro: '', gmd_marco: '0.9', gmd_abril: '',
    gmd_maio: '', gmd_junho: '', gmd_julho: '', gmd_agosto: '',
    gmd_setembro: '', gmd_outubro: '', gmd_novembro: '', gmd_dezembro: '1.1',
  });

  it('CM3 — uppercase, inteiros, decimais, nulls, empresa e ativo', () => {
    const p = categoriaManejoSvc.normalizarCategoriaManejo(FORM, { empresaId: EMPRESA });
    expect(p).toMatchObject({
      empresa_id: EMPRESA,
      nome: 'BOI GORDO',
      sigla: 'BG',
      especie: 'Bovino',
      sexo: null,
      raca: 'NELORE',
      idade_minima_meses: 12,
      idade_maxima_meses: null,
      categoria_oficial: null,
      ganho_peso_anual_kg: 180.5,
      ativo: true,
    });
  });

  it('CM3b — os doze GMDs são normalizados, vazios viram null', () => {
    const p = categoriaManejoSvc.normalizarCategoriaManejo(FORM, { empresaId: EMPRESA });
    const meses = [
      'gmd_janeiro', 'gmd_fevereiro', 'gmd_marco', 'gmd_abril', 'gmd_maio', 'gmd_junho',
      'gmd_julho', 'gmd_agosto', 'gmd_setembro', 'gmd_outubro', 'gmd_novembro', 'gmd_dezembro',
    ];
    for (const mes of meses) expect(p).toHaveProperty(mes);
    expect(p.gmd_janeiro).toBe(0.8);
    expect(p.gmd_marco).toBe(0.9);
    expect(p.gmd_dezembro).toBe(1.1);
    expect(p.gmd_fevereiro).toBeNull();
    expect(meses.filter((m) => p[m] === null)).toHaveLength(9);
  });

  it('CM4 — create e update usam o mesmo normalizador', async () => {
    await categoriaManejoSvc.criarCategoriaManejo(FORM, { empresaId: EMPRESA });
    await categoriaManejoSvc.atualizarCategoriaManejo('c1', FORM, { empresaId: EMPRESA });

    const esperado = categoriaManejoSvc.normalizarCategoriaManejo(FORM, { empresaId: EMPRESA });
    expect(categoriasManejo.createCategoriaManejo).toHaveBeenCalledWith(esperado);
    expect(categoriasManejo.updateCategoriaManejo).toHaveBeenCalledWith('c1', esperado);
  });

  it('CM3c — vírgula decimal continua truncando, como antes (DBT-25)', () => {
    const p = categoriaManejoSvc.normalizarCategoriaManejo(
      { ...FORM, ganho_peso_anual_kg: '180,5' }, { empresaId: EMPRESA }
    );
    expect(p.ganho_peso_anual_kg).toBe(180);
  });

  it('CM6/CM7 — exclui sem vínculo; bloqueia por código com lote vinculado', async () => {
    categoriasManejo.listCategoriasManejo.mockResolvedValue([{ id: 'cm1', empresa_id: EMPRESA, nome: 'BOI' }]);
    await categoriaManejoSvc.excluirCategoriaManejo('cm1');
    expect(categoriasManejo.deleteCategoriaManejo).toHaveBeenCalledWith('cm1');

    vi.clearAllMocks();
    categoriasManejo.listCategoriasManejo.mockResolvedValue([{ id: 'cm1', empresa_id: EMPRESA, nome: 'BOI' }]);
    lotes.listLotes.mockResolvedValue([{ id: 'l1', categoria_manejo_id: 'cm1', empresa_id: EMPRESA }]);
    lotes.listMovimentacoesPecuarias.mockResolvedValue([]);
    lotes.listSuplementacaoLotes.mockResolvedValue([]);
    rebanho.listManejosTecnicos.mockResolvedValue([]);
    const erro = await categoriaManejoSvc.excluirCategoriaManejo('cm1').catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.CATEGORIA_MANEJO_DELETE_BLOCKED)).toBe(true);
    expect(categoriasManejo.deleteCategoriaManejo).not.toHaveBeenCalled();
  });
});

describe('B — bebedouros', () => {
  it('B1 — lista ativos da empresa', async () => {
    bebedouros.listBebedouros.mockResolvedValue([
      { id: 'b1', empresa_id: EMPRESA, ativo: true },
      { id: 'b2', empresa_id: EMPRESA, ativo: false },
      { id: 'b3', empresa_id: 'x', ativo: true },
    ]);
    expect((await bebedouroSvc.listarBebedouros(EMPRESA)).map((b) => b.id)).toEqual(['b1']);
  });

  it('B2 — create e update delegam à API pública', async () => {
    await bebedouroSvc.criarBebedouro({ nome: 'B' });
    await bebedouroSvc.atualizarBebedouro('b1', { nome: 'C' });
    expect(bebedouros.createBebedouro).toHaveBeenCalledWith({ nome: 'B' });
    expect(bebedouros.updateBebedouro).toHaveBeenCalledWith('b1', { nome: 'C' });
  });

  it('B3 — histórico filtra por empresa e, opcionalmente, por bebedouro', async () => {
    bebedouros.listHistorico.mockResolvedValue([
      { id: 'h1', empresa_id: EMPRESA, bebedouro_id: 'b1' },
      { id: 'h2', empresa_id: EMPRESA, bebedouro_id: 'b2' },
      { id: 'h3', empresa_id: 'x', bebedouro_id: 'b1' },
    ]);
    expect((await bebedouroSvc.listarHistorico(EMPRESA)).map((h) => h.id)).toEqual(['h1', 'h2']);
    expect((await bebedouroSvc.listarHistorico(EMPRESA, 'b1')).map((h) => h.id)).toEqual(['h1']);
  });

  it('B4 — o responsável vem da sessão, não de auth.me no componente', async () => {
    await bebedouroSvc.criarHistorico({ bebedouro_id: 'b1' });
    expect(session.getCurrentUser).toHaveBeenCalled();
    expect(bebedouros.createHistorico).toHaveBeenCalledWith(expect.objectContaining({ responsavel: 'Fulano' }));
  });

  it('B4b — responsável explícito do formulário vence o da sessão', async () => {
    await bebedouroSvc.criarHistorico({ bebedouro_id: 'b1', responsavel: 'Beltrano' });
    expect(bebedouros.createHistorico).toHaveBeenCalledWith(expect.objectContaining({ responsavel: 'Beltrano' }));
  });

  it('B5/B6 — sanidade e alertas preservam o recorte', async () => {
    bebedouros.listSanidade.mockResolvedValue([{ id: 's1', empresa_id: EMPRESA, bebedouro_id: 'b1' }]);
    bebedouros.listAlertas.mockResolvedValue([{ id: 'a1', empresa_id: EMPRESA, bebedouro_id: 'b1' }]);
    expect(await bebedouroSvc.listarSanidade(EMPRESA, 'b1')).toHaveLength(1);
    expect(await bebedouroSvc.listarAlertas(EMPRESA, 'b9')).toHaveLength(0);
    await bebedouroSvc.criarSanidade({ bebedouro_id: 'b1' });
    expect(bebedouros.createSanidade).toHaveBeenCalled();
  });
});

describe('AN — anexos', () => {
  it('AN1 — lista do lote pelo par entidade + registro', async () => {
    anexos.filterAnexos.mockResolvedValue([{ id: 'an1' }]);
    await anexoSvc.listarAnexos({ entityName: 'Lote', recordId: 'l1' });
    expect(anexos.filterAnexos).toHaveBeenCalledWith({ entity_name: 'Lote', record_id: 'l1' });
  });

  it('AN5 — sem recordId devolve vazio sem consultar', async () => {
    expect(await anexoSvc.listarAnexos({ entityName: 'Lote', recordId: null })).toEqual([]);
    expect(anexos.filterAnexos).not.toHaveBeenCalled();
  });

  it('AN2/AN3 — upload antes de criar o registro', async () => {
    arquivos.uploadArquivo.mockResolvedValue({ file_url: 'https://x/y.pdf' });
    await anexoSvc.anexarArquivo({
      entityName: 'Lote', recordId: 'l1',
      arquivo: { name: 'doc.pdf', size: 10, type: 'application/pdf' }, nome: 'Contrato',
    });
    expect(arquivos.uploadArquivo).toHaveBeenCalled();
    expect(anexos.createAnexo).toHaveBeenCalledWith(expect.objectContaining({
      entity_name: 'Lote', record_id: 'l1', attachment_name: 'Contrato', file_name: 'doc.pdf',
    }));
  });

  it('AN2b — upload que falha não cria registro órfão', async () => {
    arquivos.uploadArquivo.mockRejectedValue(new Error('falhou'));
    await expect(anexoSvc.anexarArquivo({
      entityName: 'Lote', recordId: 'l1', arquivo: { name: 'a.pdf' }, nome: 'A',
    })).rejects.toBeTruthy();
    expect(anexos.createAnexo).not.toHaveBeenCalled();
  });

  it('AN7 — nome obrigatório', async () => {
    const erro = await anexoSvc.anexarArquivo({
      entityName: 'Lote', recordId: 'l1', arquivo: { name: '' }, nome: '   ',
    }).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.INVALID_ARGUMENT)).toBe(true);
    expect(arquivos.uploadArquivo).not.toHaveBeenCalled();
  });

  it('AN6 — pendentes viram anexos depois que o registro existe', async () => {
    arquivos.uploadArquivo.mockResolvedValue({ file_url: 'https://x/1' });
    await anexoSvc.persistirAnexosPendentes({
      entityName: 'Lote', recordId: 'l1',
      pendentes: [
        { arquivo: { name: 'a.pdf' }, nome: 'A' },
        { arquivo: { name: 'b.pdf' }, nome: 'B' },
      ],
    });
    expect(anexos.createAnexo).toHaveBeenCalledTimes(2);
  });

  it('AN8 — entidade não suportada falha por código', async () => {
    for (const chamada of [
      () => anexoSvc.listarAnexos({ entityName: 'Produto', recordId: 'p1' }),
      () => anexoSvc.anexarArquivo({ entityName: 'Produto', recordId: 'p1', arquivo: {}, nome: 'X' }),
    ]) {
      const erro = await chamada().catch((e) => e);
      expect(hasApiErrorCode(erro, API_ERROR_CODES.ANEXO_ENTITY_UNSUPPORTED)).toBe(true);
    }
  });

  it('AN9 — nenhum valor sensível é registrado em console', async () => {
    const chamadas = [];
    const espioes = ['log', 'info', 'warn', 'error', 'debug'].map((nivel) =>
      vi.spyOn(console, nivel).mockImplementation((...args) => chamadas.push(args.join(' ')))
    );
    arquivos.uploadArquivo.mockResolvedValue({ file_url: 'https://interno/secreto.pdf?token=abc' });
    await anexoSvc.anexarArquivo({
      entityName: 'Lote', recordId: 'l1', arquivo: { name: 'a.pdf' }, nome: 'A',
    });
    expect(chamadas).toEqual([]);
    espioes.forEach((e) => e.mockRestore());
  });
});
