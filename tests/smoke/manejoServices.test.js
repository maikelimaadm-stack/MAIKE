/**
 * Services do manejo (P1.3).
 *
 * O foco é o **contrato** que saiu dos repositórios removidos: numeração,
 * normalização, guarda de exclusão por código, catálogo fechado de fontes de
 * opção e anexo pendente. A interface não é montada aqui.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proximoNumeroLote } from '@/domain/lotes/movimentacaoLote.js';

const lotes = {
  listLotes: vi.fn(), filterLotes: vi.fn(), createLote: vi.fn(), updateLote: vi.fn(), deleteLote: vi.fn(),
  listMovimentacoes: vi.fn(), listTodasMovimentacoes: vi.fn(), listMovimentacoesPecuarias: vi.fn(),
  listSuplementacaoLotes: vi.fn(), listFornecedores: vi.fn(), listCategoriasManejo: vi.fn(),
  sincronizarReferenciasLote: vi.fn(), consultarElegibilidadeExclusaoLote: vi.fn(), excluirLoteOnline: vi.fn(),
};
const estoque = { listProdutos: vi.fn(), listLocais: vi.fn() };
// Sem `deleteSetor`: a superfície do módulo deixou de exportá-lo na P4.1
// (D-PROD-25). Um mock com o método faria o teste descrever uma API que não
// existe mais.
const setores = { listSetores: vi.fn(), createSetor: vi.fn(), updateSetor: vi.fn(), sincronizarReferenciasSetor: vi.fn() };
const categorias = { listCategorias: vi.fn(), createCategoria: vi.fn(), updateCategoria: vi.fn(), deleteCategoria: vi.fn() };
const categoriasManejo = {
  listCategoriasManejo: vi.fn(), createCategoriaManejo: vi.fn(), updateCategoriaManejo: vi.fn(), deleteCategoriaManejo: vi.fn(),
  listOpcoesCurvasGanhoCategoriaManejo: vi.fn(),
};
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
const session = {
  getCurrentUser: vi.fn(), listPermissoes: vi.fn(), listUsuarios: vi.fn(),
  updateUsuario: vi.fn(), createPermissao: vi.fn(), updatePermissao: vi.fn(), deletePermissao: vi.fn(),
  logout: vi.fn(), redirectToLogin: vi.fn(), getAppPublicSettings: vi.fn(), verificarSessao: vi.fn(),
  getCapacidadesDeSessao: vi.fn(() => ({})),
  RAZOES_DE_SESSAO: Object.freeze({ AUTH_REQUIRED: 'auth_required', USER_NOT_REGISTERED: 'user_not_registered', UNKNOWN: 'unknown' }),
};

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
    expect(proximoNumeroLote([{ numero_lote: '7' }, { numero_lote: 'x' }, { numero_lote: 3 }])).toBe('8');
    expect(proximoNumeroLote([])).toBe('1');
  });

  it('L4 — criar aplica empresa, status e campos personalizados (numero_lote no servidor)', async () => {
    lotes.createLote.mockResolvedValue({ id: 'novo' });
    await loteCadastro.criarLote({ nome: 'L' }, { empresaId: EMPRESA });
    expect(lotes.createLote).toHaveBeenCalledWith(
      expect.objectContaining({
        empresa_id: EMPRESA,
        status: 'Ativo',
        campos_personalizados: {},
        motivo_entrada: 'Inventário',
      })
    );
    expect(lotes.createLote.mock.calls[0][0]).not.toHaveProperty('numero_lote');
  });

  it('L4b — motivo_entrada maiúsculo vira enum do backend', async () => {
    lotes.createLote.mockResolvedValue({ id: 'novo' });
    await loteCadastro.criarLote({ nome: 'L', motivo_entrada: 'COMPRA' }, { empresaId: EMPRESA });
    expect(lotes.createLote).toHaveBeenCalledWith(
      expect.objectContaining({ motivo_entrada: 'Compra' })
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

  // MAIKE-LOTES-R1: quem decide é o servidor (elegibilidade); listas da tela não autorizam nem bloqueiam.
  it('L6 — delete guard bloqueia por código (servidor), não por texto', async () => {
    lotes.consultarElegibilidadeExclusaoLote.mockResolvedValue({ lote_id: 'l1', tipo: 'bloqueado', motivo: 'movimentacao_ativa' });
    const erro = await loteCadastro.validarExclusaoDeLote('l1').catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.LOTE_DELETE_BLOCKED)).toBe(true);
    expect(getApiErrorMessage(erro)).not.toMatch(/undefined|\[object/);
    expect(lotes.listMovimentacoes).not.toHaveBeenCalled();
  });

  it('L6b — servidor libera (física ou lógica): a guarda devolve o tipo', async () => {
    lotes.consultarElegibilidadeExclusaoLote.mockResolvedValue({ lote_id: 'l1', tipo: 'exclusao_logica', motivo: 'historico_somente_cancelado' });
    await expect(loteCadastro.validarExclusaoDeLote('l1')).resolves.toMatchObject({ tipo: 'exclusao_logica' });
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

});

describe('S — setores', () => {
  it('S1 — lista por empresa', async () => {
    setores.listSetores.mockResolvedValue([{ id: 's1', empresa_id: EMPRESA }, { id: 's2', empresa_id: 'x' }]);
    expect((await setorSvc.listarSetoresDaEmpresa(EMPRESA)).map((s) => s.id)).toEqual(['s1']);
  });

  /**
   * P4.1 — o `MAX + 1` saiu daqui.
   *
   * Até a P4.0 este teste fixava `proximoNumeroSetor`, que calculava o próximo
   * número sobre a lista carregada. Era uma fotografia: dois navegadores
   * criando setor ao mesmo tempo liam o mesmo máximo e pediam o mesmo número.
   * Quem numera agora é `EntidadeCodigoSequencia`, no backend, na mesma
   * transação da gravação (D-PROD-25) — provado em
   * `backend/tests/setorNativo.test.mjs` (BE-P41-05..10), contra PostgreSQL
   * real e com criações concorrentes de verdade.
   *
   * O que sobra aqui é a prova de que a função não voltou.
   */
  it('S2 — o service NÃO numera mais: proximoNumeroSetor não existe', () => {
    expect(setorSvc.proximoNumeroSetor).toBeUndefined();
  });

  it('S3 — normalização preserva o payload real da tela, sem numerar', () => {
    const payload = setorSvc.normalizarSetor(
      { nome: 'pasto a', sigla: 'pa', cidade: '', area_total: '12.5', capacidade_animais: '30' },
      { empresaId: EMPRESA }
    );
    expect(payload).toMatchObject({
      nome: 'PASTO A', sigla: 'PA', cidade: null,
      area_total: 12.5, capacidade_animais: 30,
      empresa_id: EMPRESA,
    });
    expect(payload).not.toHaveProperty('numero_setor');
  });

  /**
   * DBT-25 fechado na P1.4.
   *
   * Até a P1.3 este teste fixava o **truncamento**: `parseFloat('12,5')`
   * devolvia 12 e a metade decimal sumia sem aviso. O comportamento estava
   * documentado como dívida justamente porque corrigi-lo muda o dado gravado —
   * e agora foi corrigido, com `parseDecimalPtBR`.
   */
  it('S3b — vírgula decimal é lida corretamente (DBT-25)', () => {
    expect(setorSvc.normalizarSetor({ area_total: '12,5' }).area_total).toBe(12.5);
    expect(setorSvc.normalizarSetor({ area_total: '12.5' }).area_total).toBe(12.5);
    expect(setorSvc.normalizarSetor({ area_total: '1.234,56' }).area_total).toBe(1234.56);
    expect(setorSvc.normalizarSetor({ area_total: '' }).area_total).toBe(null);
    // Ponto sozinho continua sendo separador **decimal**: `'1.200'` é 1,2 —
    // não 1200. Sem vírgula na string não há como distinguir milhar de decimal,
    // e adivinhar mudaria silenciosamente o dado de quem digita no formato
    // internacional. Com vírgula presente, o ponto vira milhar.
    expect(setorSvc.normalizarSetor({ capacidade_animais: '1.200,0' }).capacidade_animais).toBe(1200);
    expect(setorSvc.normalizarSetor({ capacidade_animais: '30' }).capacidade_animais).toBe(30);
  });

  it('S4 — criar envia o payload normalizado SEM número e sem carregar a lista', async () => {
    await setorSvc.criarSetor({ nome: 'novo' }, { empresaId: EMPRESA });

    expect(setores.createSetor).toHaveBeenCalledWith(
      expect.objectContaining({ nome: 'NOVO', empresa_id: EMPRESA })
    );
    expect(setores.createSetor.mock.calls[0][0]).not.toHaveProperty('numero_setor');
    // A leitura da lista inteira existia só para calcular o `MAX + 1`. Sem ela,
    // criar um setor deixou de custar uma varredura de todos os setores.
    expect(setores.listSetores).not.toHaveBeenCalled();
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

  /**
   * P4.1 — a exclusão fecha, e fecha por decisão.
   *
   * A guarda de vínculo de Setor consulta `AreaPastagem`, `LancamentoTarefa`,
   * `MovimentacaoMapa` e `MovimentacaoPecuaria` — as quatro ainda na Base44,
   * enquanto o Setor não está mais. Apagar no nativo conferindo vínculo no
   * legado seria uma operação destrutiva decidida por dois sistemas, sem
   * transação em volta (D-PROD-25).
   */
  it('S7 — excluir recusa SEM ir à rede, com código próprio da recusa', async () => {
    const erro = await setorSvc.excluirSetor('s1').catch((e) => e);

    expect(hasApiErrorCode(erro, API_ERROR_CODES.SETOR_DELETE_UNAVAILABLE)).toBe(true);
    // Nem lista, nem guarda, nem chamada de escrita: a recusa é local.
    expect(setores.listSetores).not.toHaveBeenCalled();
    expect(mapa.listAreas).not.toHaveBeenCalled();
    expect(setores.updateSetor).not.toHaveBeenCalled();
  });

  it('S8 — a recusa NÃO se disfarça de bloqueio por vínculo', async () => {
    const erro = await setorSvc.excluirSetor('s1').catch((e) => e);

    // `SETOR_DELETE_BLOCKED` significaria "existem registros vinculados", e
    // ninguém verificou vínculo nenhum. O código saiu do catálogo por não ter
    // mais consumidor — a mesma regra que removeu `PRODUTO_PARTIAL_IMPORT`.
    expect(API_ERROR_CODES.SETOR_DELETE_BLOCKED).toBeUndefined();
    expect(erro.code).toBe('SETOR_DELETE_UNAVAILABLE');
    expect(erro.message).toMatch(/indispon/i);
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

  it('C5b — filho excluído junto não bloqueia o pai (ordem folha→raiz)', async () => {
    /** @type {{ id: string, categoria_pai_id?: string }[]} */
    let store = [{ id: 'pai' }, { id: 'filho', categoria_pai_id: 'pai' }];
    categorias.listCategorias.mockImplementation(async () => store.map((item) => ({ ...item })));
    categorias.deleteCategoria.mockImplementation(async (id) => {
      const temFilho = store.some((item) => item.categoria_pai_id === id);
      if (temFilho) throw new Error('FK: categoria com subcategorias');
      store = store.filter((item) => item.id !== id);
    });

    await categoriaSvc.excluirCategorias(['pai', 'filho']);
    expect(categorias.deleteCategoria).toHaveBeenCalledTimes(2);
    expect(categorias.deleteCategoria.mock.calls.map((c) => c[0])).toEqual(['filho', 'pai']);
    expect(store).toEqual([]);
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

  it('CM2 — D-PROD-187: o service de Categoria de Manejo não expõe nada de ícone (o vínculo com o ícone oficial saiu)', () => {
    expect(Object.keys(categoriaManejoSvc).filter((k) => /icone/i.test(k))).toEqual([]);
  });

  /**
   * CM3 — a normalização saiu da página para o service na P1.3-R1.
   *
   * D-PROD-186 (Fatia C): o cadastro ficou só com nome, sigla, espécie, sexo e
   * faixa de idade; o vínculo com o ícone oficial saiu na Fatia D (D-PROD-187).
   * O FORM abaixo é o que o formulário enxuto envia hoje (com a curva de
   * ganho obrigatória, D-PROD-195).
   */
  const FORM = Object.freeze({
    nome: 'boi gordo', sigla: 'bg', especie: 'Bovino', sexo: '',
    idade_minima_meses: 13, idade_maxima_meses: 24,
    curva_ganho_id: 'cg-1', curva_ganho_nome: 'CURVA PADRÃO',
  });

  /** As 16 chaves que saíram do contrato (15 na D-PROD-186 + o vínculo do ícone na D-PROD-187). */
  const CHAVES_REMOVIDAS = Object.freeze([
    'raca', 'categoria_oficial', 'ganho_peso_anual_kg',
    'gmd_janeiro', 'gmd_fevereiro', 'gmd_marco', 'gmd_abril', 'gmd_maio', 'gmd_junho',
    'gmd_julho', 'gmd_agosto', 'gmd_setembro', 'gmd_outubro', 'gmd_novembro', 'gmd_dezembro',
    'catalogo_categoria_visual_id',
  ]);

  /** Registro antigo aberto para edição (ou em cache): ainda traz os campos legados, inclusive o vínculo do ícone. */
  const FORM_LEGADO = Object.freeze({
    ...FORM,
    raca: 'nelore', categoria_oficial: 'Boi', ganho_peso_anual_kg: '180,5',
    gmd_janeiro: '0.8', gmd_fevereiro: '', gmd_marco: '0,9', gmd_abril: '',
    gmd_maio: '', gmd_junho: '', gmd_julho: '', gmd_agosto: '',
    gmd_setembro: '', gmd_outubro: '', gmd_novembro: '', gmd_dezembro: '1.1',
    catalogo_categoria_visual_id: 'cv-bez',
  });

  it('CM3 — uppercase, inteiros, nulls, empresa e ativo; só o contrato enxuto', () => {
    const p = categoriaManejoSvc.normalizarCategoriaManejo(FORM, { empresaId: EMPRESA });
    expect(p).toEqual({
      empresa_id: EMPRESA,
      nome: 'BOI GORDO',
      sigla: 'BG',
      especie: 'Bovino',
      sexo: null,
      curva_ganho_id: 'cg-1',
      idade_minima_meses: 13,
      idade_maxima_meses: 24,
      ativo: true,
    });
    for (const chave of CHAVES_REMOVIDAS) expect(p).not.toHaveProperty(chave);
    // O nome da curva é só de exibição (vem da relação): não vai no corpo.
    expect(p).not.toHaveProperty('curva_ganho_nome');
  });

  it('CM3d — D-PROD-195: curva_ganho_id vai SEMPRE, na criação e na edição (inclusive sem mexer na faixa); vazio vira null', () => {
    const p = (extra, opcoes = {}) => categoriaManejoSvc.normalizarCategoriaManejo({ ...FORM, ...extra }, { empresaId: EMPRESA, ...opcoes });
    expect(p({})).toMatchObject({ curva_ganho_id: 'cg-1' });
    expect(p({}, { edicao: true })).toMatchObject({ curva_ganho_id: 'cg-1' });
    expect(p({ faixa_idade_alterada: true }, { edicao: true })).toMatchObject({ curva_ganho_id: 'cg-1' });
    expect(p({ curva_ganho_id: ' cg-2 ' }, { edicao: true })).toMatchObject({ curva_ganho_id: 'cg-2' });
    for (const vazio of ['', '   ', null, undefined]) {
      expect(p({ curva_ganho_id: vazio })).toHaveProperty('curva_ganho_id', null);
      expect(p({ curva_ganho_id: vazio }, { edicao: true })).toHaveProperty('curva_ganho_id', null);
    }
  });

  it('CM3e — D-PROD-195: as curvas do seletor vêm da rota de opções do cadastro, com a fazenda', async () => {
    const curvas = [{ id: 'cg-1', nome: 'CURVA PADRÃO', ativo: true }];
    categoriasManejo.listOpcoesCurvasGanhoCategoriaManejo.mockResolvedValue(curvas);
    expect(await categoriaManejoSvc.listarCurvasGanhoParaCategoria(EMPRESA)).toEqual(curvas);
    expect(categoriasManejo.listOpcoesCurvasGanhoCategoriaManejo).toHaveBeenCalledWith(EMPRESA);
  });

  it('CM3b — registro legado com raça, categoria oficial, ganho, 12 GMDs e vínculo do ícone: nenhuma das 16 chaves sai no payload', () => {
    expect(CHAVES_REMOVIDAS).toHaveLength(16);
    const p = categoriaManejoSvc.normalizarCategoriaManejo(FORM_LEGADO, { empresaId: EMPRESA });
    for (const chave of CHAVES_REMOVIDAS) expect(p).not.toHaveProperty(chave);
    expect(p).toEqual(categoriaManejoSvc.normalizarCategoriaManejo(FORM, { empresaId: EMPRESA }));
  });

  it('CM4 — create e update usam o mesmo normalizador (update em modo edição)', async () => {
    await categoriaManejoSvc.criarCategoriaManejo(FORM, { empresaId: EMPRESA });
    await categoriaManejoSvc.atualizarCategoriaManejo('c1', FORM, { empresaId: EMPRESA });

    expect(categoriasManejo.createCategoriaManejo).toHaveBeenCalledWith(
      categoriaManejoSvc.normalizarCategoriaManejo(FORM, { empresaId: EMPRESA })
    );
    expect(categoriasManejo.updateCategoriaManejo).toHaveBeenCalledWith(
      'c1', categoriaManejoSvc.normalizarCategoriaManejo(FORM, { empresaId: EMPRESA, edicao: true })
    );
  });

  it('CM3c — faixa de idade: na criação o par vai sempre; na edição só quando o select foi alterado', () => {
    const p = (min, max, opcoes = {}, extra = {}) =>
      categoriaManejoSvc.normalizarCategoriaManejo(
        { ...FORM, idade_minima_meses: min, idade_maxima_meses: max, ...extra }, { empresaId: EMPRESA, ...opcoes }
      );
    // Criação: o par escolhido (uma das cinco faixas) vai no corpo, texto vira inteiro.
    expect(p(' 13 ', '24')).toMatchObject({ idade_minima_meses: 13, idade_maxima_meses: 24 });
    expect(p('0', '8')).toMatchObject({ idade_minima_meses: 0, idade_maxima_meses: 8 });
    expect(p(37, null)).toMatchObject({ idade_minima_meses: 37, idade_maxima_meses: null });
    expect(p('  ', undefined)).toMatchObject({ idade_minima_meses: null, idade_maxima_meses: null });
    // Edição sem mexer no select: as idades NÃO vão (o par gravado, mesmo legado, fica intocado).
    for (const extra of [{}, { faixa_idade_alterada: false }]) {
      const semIdade = p(10, 20, { edicao: true }, extra);
      expect(semIdade).not.toHaveProperty('idade_minima_meses');
      expect(semIdade).not.toHaveProperty('idade_maxima_meses');
      expect(semIdade).toMatchObject({ nome: 'BOI GORDO', ativo: true });
    }
    // Edição com o select alterado: vai o par da faixa nova.
    expect(p(25, 36, { edicao: true }, { faixa_idade_alterada: true })).toMatchObject({ idade_minima_meses: 25, idade_maxima_meses: 36 });
    expect(p(37, '', { edicao: true }, { faixa_idade_alterada: true })).toMatchObject({ idade_minima_meses: 37, idade_maxima_meses: null });
    // A marca do formulário nunca vai no corpo.
    expect(p(25, 36, { edicao: true }, { faixa_idade_alterada: true })).not.toHaveProperty('faixa_idade_alterada');
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

describe('CM-D5 — exclusão: id e nome bloqueiam; a categoria oficial DERIVADA não (hotfix)', () => {
  /** Carrega os quatro dependentes. */
  const dependentes = ({ lotesDeps = [], movs = [], manejos = [], suplementos = [] } = {}) => {
    lotes.listLotes.mockResolvedValue(lotesDeps);
    lotes.listMovimentacoesPecuarias.mockResolvedValue(movs);
    lotes.listSuplementacaoLotes.mockResolvedValue(suplementos);
    rebanho.listManejosTecnicos.mockResolvedValue(manejos);
  };
  const BEZERRO = { id: 'cm1', empresa_id: EMPRESA, nome: 'TESTE', sexo: 'Macho', idade_minima_meses: 0, idade_maxima_meses: 8 };
  const OFICIAL = 'Bezerro 0 a 12 meses';

  beforeEach(() => {
    vi.clearAllMocks();
    categoriasManejo.listCategoriasManejo.mockResolvedValue([BEZERRO]);
  });

  const bloqueia = async () => {
    const erro = await categoriaManejoSvc.excluirCategoriaManejo('cm1').catch((e) => e);
    return hasApiErrorCode(erro, API_ERROR_CODES.CATEGORIA_MANEJO_DELETE_BLOCKED);
  };

  it('caso de produção: 22 lotes de OUTRA categoria com o texto oficial "Bezerro 0 a 12 meses" não impedem excluir a categoria Macho 0–8', async () => {
    dependentes({
      lotesDeps: Array.from({ length: 22 }, (_, i) => ({ id: `l${i}`, empresa_id: EMPRESA, categoria_manejo_id: 'outra', categoria: OFICIAL, categoria_entrada: OFICIAL })),
      movs: ['categoria_animal', 'categoria_nova', 'transferencia_origem', 'transferencia_destino'].map((campo, i) => ({ id: `m${i}`, empresa_id: EMPRESA, [campo]: OFICIAL })),
      manejos: [{ id: 'mt1', empresa_id: EMPRESA, categoria: OFICIAL }],
      suplementos: [{ id: 's1', empresa_id: EMPRESA, categoria: OFICIAL }],
    });
    expect(await bloqueia()).toBe(false);
    expect(categoriasManejo.deleteCategoriaManejo).toHaveBeenCalledWith('cm1');
  });

  it('lote ligado pelo id (categoria_manejo_id ou de entrada) bloqueia', async () => {
    for (const lote of [
      { id: 'l1', empresa_id: EMPRESA, categoria_manejo_id: 'cm1' },
      { id: 'l1', empresa_id: EMPRESA, categoria_manejo_entrada_id: 'cm1' },
    ]) {
      vi.clearAllMocks();
      categoriasManejo.listCategoriasManejo.mockResolvedValue([BEZERRO]);
      dependentes({ lotesDeps: [lote] });
      expect(await bloqueia(), JSON.stringify(lote)).toBe(true);
      expect(categoriasManejo.deleteCategoriaManejo).not.toHaveBeenCalled();
    }
  });

  it('o NOME da categoria em cada campo-alvo continua bloqueando', async () => {
    const casos = [
      { lotesDeps: [{ id: 'l1', empresa_id: EMPRESA, categoria_manejo_nome: 'teste' }] },
      { lotesDeps: [{ id: 'l1', empresa_id: EMPRESA, categoria: 'TESTE ' }] },
      ...['categoria_animal', 'categoria_nova', 'transferencia_origem', 'transferencia_destino'].map((campo) => ({
        movs: [{ id: 'm1', empresa_id: EMPRESA, [campo]: 'TESTE' }],
      })),
      { manejos: [{ id: 'mt1', empresa_id: EMPRESA, categoria: 'TESTE' }] },
      { suplementos: [{ id: 's1', empresa_id: EMPRESA, categoria: 'TESTE' }] },
    ];
    for (const caso of casos) {
      vi.clearAllMocks();
      categoriasManejo.listCategoriasManejo.mockResolvedValue([BEZERRO]);
      dependentes(caso);
      expect(await bloqueia(), JSON.stringify(caso)).toBe(true);
    }
  });

  it('domínio puro: as regras de CategoriaManejo não têm fonte calculada nem categoria oficial', async () => {
    const { evaluateDeleteBlock, DELETE_RULES } = await import('@/domain/deleteRules');
    const fontes = DELETE_RULES.CategoriaManejo.flatMap((r) => (r.valueMatches || []).map((v) => v.sourceField));
    expect(new Set(fontes)).toEqual(new Set(['nome']));
    const v = evaluateDeleteBlock({
      entityName: 'CategoriaManejo', id: 'cm1', currentRecord: BEZERRO,
      recordsByEntity: { Lote: [{ id: 'l1', empresa_id: EMPRESA, categoria: OFICIAL }] },
    });
    expect(v.blocked).toBe(false);
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
