/**
 * Services de suporte e administração (P1.4).
 *
 * O foco é o **contrato** que saiu das telas: numeração, unicidade, guarda de
 * exclusão por código, resultado parcial explícito, propagação de rename e
 * leitura decimal em pt-BR. Interface não é montada aqui.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const produtos = {
  listProdutos: vi.fn(), filterProdutos: vi.fn(), createProduto: vi.fn(),
  updateProduto: vi.fn(), deleteProduto: vi.fn(),
  listMovimentacoesEstoque: vi.fn(), sincronizarReferenciasProduto: vi.fn(),
};
const marcas = { listMarcas: vi.fn(), createMarca: vi.fn(), updateMarca: vi.fn(), deleteMarca: vi.fn() };
const unidades = {
  listUnidades: vi.fn(), createUnidade: vi.fn(), updateUnidade: vi.fn(),
  deleteUnidade: vi.fn(), listProdutosVinculados: vi.fn(),
};
const estoque = {
  listLocais: vi.fn(), createLocal: vi.fn(), updateLocal: vi.fn(), deleteLocal: vi.fn(),
  listTodasMovimentacoes: vi.fn(), listLotesNota: vi.fn(),
};
const mapa = {
  listPontosSuplementacao: vi.fn(), updatePontoSuplementacao: vi.fn(),
  listPontos: vi.fn(), updatePonto: vi.fn(),
  listIcones: vi.fn(), createIcone: vi.fn(), updateIcone: vi.fn(),
};
const tarefas = {
  listGrupos: vi.fn(), listTipos: vi.fn(), listLancamentos: vi.fn(),
  createGrupo: vi.fn(), updateGrupo: vi.fn(), deleteGrupo: vi.fn(),
  createTipo: vi.fn(), updateTipo: vi.fn(), deleteTipo: vi.fn(),
  sincronizarReferenciasTarefa: vi.fn(),
};
const session = {
  getCurrentUser: vi.fn(), listUsuarios: vi.fn(), listPermissoes: vi.fn(),
  updateUsuario: vi.fn(), createPermissao: vi.fn(), updatePermissao: vi.fn(), deletePermissao: vi.fn(),
  logout: vi.fn(), redirectToLogin: vi.fn(), getAppPublicSettings: vi.fn(),
  getCapacidadesDeSessao: vi.fn(() => ({ logout: true, redirectToLogin: true, updateMe: false })),
};
const categorias = { listCategorias: vi.fn() };
const arquivos = { uploadArquivo: vi.fn() };
const rebanho = { listManejosTecnicos: vi.fn() };

vi.mock('@/apis/produtos', () => produtos);
vi.mock('@/apis/marcas', () => marcas);
vi.mock('@/apis/unidades-medida', () => unidades);
vi.mock('@/apis/estoque', () => estoque);
vi.mock('@/apis/mapa', () => mapa);
vi.mock('@/apis/tarefas', () => tarefas);
vi.mock('@/apis/session', () => session);
vi.mock('@/apis/categorias', () => categorias);
vi.mock('@/apis/arquivos', () => arquivos);
vi.mock('@/apis/rebanho', () => rebanho);

const produtoSvc = await import('@/services/produtoService');
const marcaSvc = await import('@/services/marcaService');
const unidadeSvc = await import('@/services/unidadeMedidaService');
const localSvc = await import('@/services/localEstoqueService');
const tarefaSvc = await import('@/services/tarefaCadastroService');
const sessionSvc = await import('@/services/sessionService');
const iconeSvc = await import('@/services/configuracaoIconeService');
const arquivoSvc = await import('@/services/arquivoService');
const csv = await import('@/domain/produtos/csvProduto');
const { parseDecimalPtBR, parseInteiroPtBR } = await import('@/domain/numeroPtBR');
const { API_ERROR_CODES, hasApiErrorCode } = await import('@/apis/_core/ApiError');

const EMPRESA = 'emp-1';

beforeEach(() => {
  vi.clearAllMocks();
  for (const grupo of [produtos, marcas, unidades, estoque, mapa, tarefas, session, categorias, rebanho]) {
    for (const fn of Object.values(grupo)) {
      if (typeof fn?.mockResolvedValue === 'function') fn.mockResolvedValue([]);
    }
  }
  session.getCapacidadesDeSessao.mockReturnValue({ logout: true, redirectToLogin: true, updateMe: false });
  localStorage.clear();
});

// ── Produtos ──────────────────────────────────────────────────────────────

describe('PR — produtos', () => {
  it('PR1 — nome duplicado na mesma empresa reprova por código', async () => {
    const existentes = [{ id: 'p1', empresa_id: EMPRESA, nome_produto: 'MILHO' }];
    await expect(
      produtoSvc.criarProduto({ dados: { nome_produto: ' milho ' }, empresaId: EMPRESA, produtos: existentes })
    ).rejects.toSatisfy((erro) => hasApiErrorCode(erro, API_ERROR_CODES.PRODUTO_NAME_CONFLICT));
    expect(produtos.createProduto).not.toHaveBeenCalled();
  });

  it('PR2 — nome igual em outra empresa não conflita', async () => {
    const existentes = [{ id: 'p1', empresa_id: 'outra', nome_produto: 'MILHO' }];
    produtos.listProdutos.mockResolvedValue([]);
    produtos.createProduto.mockResolvedValue({ id: 'novo' });
    await produtoSvc.criarProduto({ dados: { nome_produto: 'MILHO' }, empresaId: EMPRESA, produtos: existentes });
    expect(produtos.createProduto).toHaveBeenCalled();
  });

  it('PR3 — numeração é max + 1 e descarta timestamps acidentais', async () => {
    produtos.listProdutos.mockResolvedValue([
      { numero_produto: '7' }, { numero_produto: '12' }, { numero_produto: '1755000000000' },
    ]);
    expect(await produtoSvc.proximoNumeroDeProduto()).toBe(13);
  });

  it('PR4 — número vai como string e a empresa entra no payload', async () => {
    produtos.listProdutos.mockResolvedValue([{ numero_produto: '4' }]);
    produtos.createProduto.mockResolvedValue({ id: 'novo' });
    await produtoSvc.criarProduto({ dados: { nome_produto: 'SAL' }, empresaId: EMPRESA, produtos: [] });
    expect(produtos.createProduto).toHaveBeenCalledWith(
      expect.objectContaining({ empresa_id: EMPRESA, numero_produto: '5' })
    );
  });

  it('PR5 — update sincroniza as referências denormalizadas', async () => {
    produtos.updateProduto.mockResolvedValue({ id: 'p1', nome_produto: 'MILHO NOVO' });
    await produtoSvc.atualizarProduto({
      id: 'p1', dados: { nome_produto: 'MILHO NOVO' }, oldData: { nome_produto: 'MILHO' },
      empresaId: EMPRESA, produtos: [],
    });
    expect(produtos.sincronizarReferenciasProduto).toHaveBeenCalledWith({
      data: { id: 'p1', nome_produto: 'MILHO NOVO' },
      oldData: { nome_produto: 'MILHO' },
    });
  });

  it('PR6 — exclusão bloqueada por movimentação, com a contagem em details', async () => {
    produtos.listMovimentacoesEstoque.mockResolvedValue([
      { produto_id: 'p1' }, { produto_id: 'p1' }, { produto_id: 'outro' },
    ]);
    await expect(produtoSvc.excluirProduto('p1')).rejects.toSatisfy(
      (erro) => hasApiErrorCode(erro, API_ERROR_CODES.PRODUTO_DELETE_BLOCKED) && erro.details.quantidade === 2
    );
    expect(produtos.deleteProduto).not.toHaveBeenCalled();
  });

  it('PR7 — sem movimentação, exclui', async () => {
    produtos.listMovimentacoesEstoque.mockResolvedValue([{ produto_id: 'outro' }]);
    await produtoSvc.excluirProduto('p1');
    expect(produtos.deleteProduto).toHaveBeenCalledWith('p1');
  });

  it('PR8 — payload novo zera estoque_atual; edição não mexe', () => {
    const base = { nome_produto: 'sal', codigo_interno: 'a1', unidade_medida: 'kg', ativo: true };
    expect(produtoSvc.normalizarProduto(base).estoque_atual).toBe(0);
    expect(produtoSvc.normalizarProduto(base, { isEditing: true }).estoque_atual).toBeUndefined();
  });

  it('PR9 — payload sobe em maiúsculas e lê vírgula decimal', () => {
    const payload = produtoSvc.normalizarProduto({
      nome_produto: ' milho ', codigo_interno: 'mi1', unidade_medida: 'kg',
      preco_custo: '12,50', percentual_consumo_pv: '0,8',
      unidade_principal_estoque: 'SACO', peso_por_saco_kg: '30,5',
    });
    expect(payload.nome_produto).toBe('MILHO');
    expect(payload.preco_custo).toBe(12.5);
    expect(payload.percentual_consumo_pv).toBe(0.8);
    expect(payload.peso_por_saco_kg).toBe(30.5);
  });

  it('PR10 — peso por saco só entra quando a unidade principal é SACO', () => {
    const payload = produtoSvc.normalizarProduto({ unidade_principal_estoque: 'KG', peso_por_saco_kg: '30' });
    expect(payload.peso_por_saco_kg).toBeUndefined();
    expect(payload.unidade_principal_estoque).toBe('KG');
  });

  it('PR11 — fontes do formulário vêm de um catálogo fechado de quatro listas', async () => {
    categorias.listCategorias.mockResolvedValue([{ id: 'c1' }]);
    unidades.listUnidades.mockResolvedValue([{ id: 'u1' }]);
    estoque.listLocais.mockResolvedValue([{ id: 'l1' }]);
    marcas.listMarcas.mockResolvedValue([{ id: 'm1', empresa_id: EMPRESA, ativo: true }]);

    const fontes = await produtoSvc.carregarFontesDoFormulario(EMPRESA);
    expect(Object.keys(fontes).sort()).toEqual(['categorias', 'locais', 'marcas', 'unidades']);
    expect(fontes.marcas).toHaveLength(1);
  });

  it('PR12 — importação é best-effort com resultado explícito', async () => {
    produtos.createProduto
      .mockResolvedValueOnce({ id: 'a' })
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce({ id: 'c' });

    const progresso = [];
    const r = await produtoSvc.importarProdutos([{}, {}, {}], (p) => progresso.push(p.atual));
    expect(r).toEqual({ importados: 2, falhas: 1, total: 3 });
    expect(progresso).toEqual([1, 2, 3]);
  });
});

// ── CSV puro ──────────────────────────────────────────────────────────────

describe('CSV — importação e exportação de produtos', () => {
  const CABECALHO = 'Nome;Código;Cód Barras;Categoria;Descrição;UN;Custo;Venda;Estoque;Mínimo;Obs';

  it('CSV1 — vírgula decimal é lida corretamente', () => {
    const { validos } = csv.parseCsvDeProdutos(
      `${CABECALHO}\nMILHO;M1;789;RAÇÃO;desc;KG;10,50;15,00;100;10;obs`,
      { empresaId: EMPRESA, numeroInicial: 7 }
    );
    expect(validos).toHaveLength(1);
    expect(validos[0].preco_custo).toBe(10.5);
    expect(validos[0].preco_venda).toBe(15);
    expect(validos[0].numero_produto).toBe('7');
    expect(validos[0].empresa_id).toBe(EMPRESA);
  });

  it('CSV2 — linha sem nome vira erro e não consome número', () => {
    const { validos, erros } = csv.parseCsvDeProdutos(
      `${CABECALHO}\n;;;;;;;;;;\nSAL;S1;;;;KG;1;2;3;4;`,
      { empresaId: EMPRESA, numeroInicial: 1 }
    );
    expect(erros).toHaveLength(1);
    expect(erros[0].linha).toBe(2);
    expect(validos).toHaveLength(1);
    expect(validos[0].numero_produto).toBe('1');
  });

  it('CSV3 — numeração avança por registro válido', () => {
    const { validos } = csv.parseCsvDeProdutos(
      `${CABECALHO}\nA;;;;;;;;;;\nB;;;;;;;;;;`,
      { empresaId: EMPRESA, numeroInicial: 10 }
    );
    expect(validos.map((p) => p.numero_produto)).toEqual(['10', '11']);
  });

  it('CSV4 — arquivo só com cabeçalho não produz nada', () => {
    expect(csv.parseCsvDeProdutos(CABECALHO, { empresaId: EMPRESA, numeroInicial: 1 })).toEqual({
      validos: [], erros: [],
    });
  });

  it('CSV5 — template e exportação preservam BOM e separador', () => {
    expect(csv.montarTemplateCsv().split('\n')[0]).toBe(CABECALHO);
    expect(csv.BOM_UTF8.charCodeAt(0)).toBe(0xfeff);
    const exportado = csv.montarCsvDeProdutos([{ nome_produto: 'A;B', unidade_medida: 'KG' }]);
    expect(exportado).toContain('"A;B"');
  });
});

// ── Marcas ────────────────────────────────────────────────────────────────

describe('MA — marcas', () => {
  it('MA1 — filtro por empresa', async () => {
    marcas.listMarcas.mockResolvedValue([
      { id: 'a', empresa_id: EMPRESA }, { id: 'b', empresa_id: 'outra' },
    ]);
    expect(await marcaSvc.listarMarcasDaEmpresa(EMPRESA)).toEqual([{ id: 'a', empresa_id: EMPRESA }]);
  });

  it('MA2 — nome duplicado reprova por código', async () => {
    await expect(
      marcaSvc.criarMarca({ dados: { nome: ' nelore ' }, empresaId: EMPRESA, marcasDaEmpresa: [{ id: 'x', nome: 'NELORE' }] })
    ).rejects.toSatisfy((erro) => hasApiErrorCode(erro, API_ERROR_CODES.MARCA_NAME_CONFLICT));
  });

  it('MA3 — numeração max + 1 sobre todas as marcas', async () => {
    marcas.listMarcas.mockResolvedValue([{ numero_marca: '3' }, { numero_marca: '9' }]);
    marcas.createMarca.mockResolvedValue({ id: 'nova' });
    await marcaSvc.criarMarca({ dados: { nome: 'ANGUS' }, empresaId: EMPRESA, marcasDaEmpresa: [] });
    expect(marcas.createMarca).toHaveBeenCalledWith(expect.objectContaining({ numero_marca: '10' }));
  });

  it('MA4 — exclusão múltipla devolve o que saiu e o que falhou', async () => {
    marcas.deleteMarca.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
    const r = await marcaSvc.excluirMarcas(['a', 'b']);
    expect(r.excluidas).toEqual(['a']);
    expect(r.falhas).toHaveLength(1);
  });
});

// ── Unidades de medida ────────────────────────────────────────────────────

describe('UM — unidades de medida', () => {
  it('UM1 — numeração max + 1', async () => {
    unidades.listUnidades.mockResolvedValue([{ numero_unidade: '2' }, { numero_unidade: '5' }]);
    unidades.createUnidade.mockResolvedValue({ id: 'u' });
    await unidadeSvc.criarUnidade({ sigla: 'KG' });
    expect(unidades.createUnidade).toHaveBeenCalledWith(expect.objectContaining({ numero_unidade: '6' }));
  });

  it('UM2 — autonumeração só toca quem não tem número', async () => {
    unidades.listUnidades.mockResolvedValue([{ numero_unidade: '1' }]);
    const r = await unidadeSvc.numerarUnidadesSemNumero([{ id: 'a' }, { id: 'b', numero_unidade: '1' }]);
    expect(r.numeradas).toEqual(['a']);
    expect(unidades.updateUnidade).toHaveBeenCalledTimes(1);
  });

  it('UM3 — produto que usa a sigla bloqueia a exclusão', async () => {
    unidades.listProdutosVinculados.mockResolvedValue([{ id: 'p1', unidade_medida: 'kg' }]);
    await expect(
      unidadeSvc.excluirUnidade('u1', { unidades: [{ id: 'u1', sigla: 'KG' }] })
    ).rejects.toSatisfy((erro) => hasApiErrorCode(erro, API_ERROR_CODES.UNIDADE_MEDIDA_DELETE_BLOCKED));
    expect(unidades.deleteUnidade).not.toHaveBeenCalled();
  });

  it('UM4 — as três dependências da tabela são consultadas', async () => {
    await unidadeSvc.excluirUnidade('u1', { unidades: [{ id: 'u1', sigla: 'KG' }] });
    expect(unidades.listProdutosVinculados).toHaveBeenCalled();
    expect(estoque.listTodasMovimentacoes).toHaveBeenCalled();
    expect(rebanho.listManejosTecnicos).toHaveBeenCalled();
    expect(unidades.deleteUnidade).toHaveBeenCalledWith('u1');
  });

  it('UM5 — exclusão múltipla devolve bloqueados com código', async () => {
    unidades.listProdutosVinculados.mockResolvedValue([{ unidade_medida: 'kg' }]);
    const r = await unidadeSvc.excluirUnidades(['u1', 'u2'], {
      unidades: [{ id: 'u1', sigla: 'KG' }, { id: 'u2', sigla: 'L' }],
    });
    expect(r.excluidas).toEqual(['u2']);
    expect(r.bloqueadas[0].code).toBe(API_ERROR_CODES.UNIDADE_MEDIDA_DELETE_BLOCKED);
  });
});

// ── Locais de estoque ─────────────────────────────────────────────────────

describe('LE — locais de estoque', () => {
  it('LE1 — numeração max + 1', async () => {
    estoque.listLocais.mockResolvedValue([{ numero_local: '8' }]);
    estoque.createLocal.mockResolvedValue({ id: 'l' });
    await localSvc.criarLocal({ nome: 'GALPÃO' });
    expect(estoque.createLocal).toHaveBeenCalledWith(expect.objectContaining({ numero_local: '9' }));
  });

  it('LE2 — rename propaga para depósito, ponto de referência e cochos', async () => {
    const deposito = { id: 'd1', local_estoque_id: 'l1', categoria_ponto: 'DEPOSITO', coordenadas: { lat: 1, lng: 2 } };
    mapa.listPontosSuplementacao.mockResolvedValue([
      deposito,
      { id: 'c1', deposito_origem_id: 'd1' },
      { id: 'c2', deposito_origem_id: 'd1' },
    ]);
    mapa.listPontos.mockResolvedValue([{ id: 'r1', coordenadas: { lat: 1, lng: 2 } }]);
    estoque.updateLocal.mockResolvedValue({ id: 'l1', nome: 'NOVO' });

    const r = await localSvc.atualizarLocal({
      id: 'l1', dados: { nome: 'NOVO' }, locais: [{ id: 'l1', nome: 'VELHO' }],
    });

    expect(mapa.updatePontoSuplementacao).toHaveBeenCalledWith('d1', { nome_ponto: 'NOVO', local_estoque_nome: 'NOVO' });
    expect(mapa.updatePonto).toHaveBeenCalledWith('r1', { nome: 'NOVO' });
    expect(mapa.updatePontoSuplementacao).toHaveBeenCalledWith('c1', { deposito_origem_nome: 'NOVO' });
    expect(r.etapas).toEqual(['deposito', 'ponto_referencia', 'cochos:2']);
  });

  it('LE3 — sem mudança de nome, nada é propagado', async () => {
    estoque.updateLocal.mockResolvedValue({ id: 'l1' });
    await localSvc.atualizarLocal({ id: 'l1', dados: { capacidade: '10' }, locais: [{ id: 'l1', nome: 'VELHO' }] });
    expect(mapa.listPontosSuplementacao).not.toHaveBeenCalled();
  });

  it('LE4 — rename que falha no meio vira erro parcial com as etapas', async () => {
    mapa.listPontosSuplementacao.mockResolvedValue([
      { id: 'd1', local_estoque_id: 'l1', categoria_ponto: 'DEPOSITO' },
    ]);
    mapa.updatePontoSuplementacao.mockRejectedValue(new Error('rede'));
    estoque.updateLocal.mockResolvedValue({ id: 'l1' });

    await expect(
      localSvc.atualizarLocal({ id: 'l1', dados: { nome: 'NOVO' }, locais: [{ id: 'l1', nome: 'VELHO' }] })
    ).rejects.toSatisfy(
      (erro) => hasApiErrorCode(erro, API_ERROR_CODES.LOCAL_ESTOQUE_PARTIAL_OPERATION)
        && erro.details.etapas.includes('local')
    );
  });

  it('LE5 — as quatro travas de exclusão bloqueiam', async () => {
    const casos = [
      ['deposito_do_mapa', { pontos: [{ local_estoque_id: 'l1', categoria_ponto: 'DEPOSITO' }] }],
      ['produtos_vinculados', { prods: [{ local_estoque: 'GALPÃO' }] }],
      ['movimentacoes_vinculadas', { movs: [{ local_estoque_origem: 'l1' }] }],
      ['saldo_em_estoque', { lotes: [{ local_estoque_id: 'l1', quantidade_disponivel: 5 }] }],
    ];

    for (const [motivo, dados] of casos) {
      vi.clearAllMocks();
      produtos.listProdutos.mockResolvedValue(dados.prods || []);
      estoque.listTodasMovimentacoes.mockResolvedValue(dados.movs || []);
      estoque.listLotesNota.mockResolvedValue(dados.lotes || []);
      mapa.listPontosSuplementacao.mockResolvedValue(dados.pontos || []);

      const r = await localSvc.excluirLocais(['l1'], { locais: [{ id: 'l1', nome: 'GALPÃO' }] });
      expect(r.excluidos, motivo).toEqual([]);
      expect(r.bloqueados[0].motivo, motivo).toBe(motivo);
      expect(r.bloqueados[0].code, motivo).toBe(API_ERROR_CODES.LOCAL_ESTOQUE_DELETE_BLOCKED);
      expect(estoque.deleteLocal, motivo).not.toHaveBeenCalled();
    }
  });

  it('LE6 — sem vínculo, exclui', async () => {
    const r = await localSvc.excluirLocais(['l1'], { locais: [{ id: 'l1', nome: 'GALPÃO' }] });
    expect(r.excluidos).toEqual(['l1']);
    expect(estoque.deleteLocal).toHaveBeenCalledWith('l1');
  });
});

// ── Tarefas ───────────────────────────────────────────────────────────────

describe('TA — grupos e tipos de tarefa', () => {
  it('TA1 — update propaga referências com nome de entidade fechado', async () => {
    tarefas.updateGrupo.mockResolvedValue({ id: 'g1', nome_grupo: 'NOVO' });
    await tarefaSvc.atualizarGrupo({ id: 'g1', dados: { nome_grupo: 'NOVO' }, oldData: { nome_grupo: 'VELHO' } });
    expect(tarefas.sincronizarReferenciasTarefa).toHaveBeenCalledWith({
      entidade: 'GrupoAtividade', data: { id: 'g1', nome_grupo: 'NOVO' }, oldData: { nome_grupo: 'VELHO' },
    });
  });

  it('TA2 — grupo com tipo vinculado é bloqueado, e o resultado é parcial', async () => {
    tarefas.listTipos.mockResolvedValue([{ id: 't1', grupo_atividade_id: 'g1' }]);
    const r = await tarefaSvc.excluirGrupos(['g1', 'g2'], { grupos: [{ id: 'g1' }, { id: 'g2' }] });
    expect(r.excluidos).toEqual(['g2']);
    expect(r.bloqueados[0]).toEqual({ id: 'g1', code: API_ERROR_CODES.GRUPO_ATIVIDADE_DELETE_BLOCKED });
    expect(tarefas.deleteGrupo).toHaveBeenCalledTimes(1);
  });

  it('TA3 — tipo com lançamento vinculado é bloqueado', async () => {
    tarefas.listLancamentos.mockResolvedValue([{ id: 'l1', tipo_tarefa_id: 't1' }]);
    const r = await tarefaSvc.excluirTipos(['t1'], { tipos: [{ id: 't1' }] });
    expect(r.excluidos).toEqual([]);
    expect(r.bloqueados[0].code).toBe(API_ERROR_CODES.TIPO_TAREFA_DELETE_BLOCKED);
  });
});

// ── Sessão, permissões e ícones ───────────────────────────────────────────

describe('SE — sessão e permissões', () => {
  it('SE1 — usuário online é persistido para uso offline', async () => {
    session.getCurrentUser.mockResolvedValue({ email: 'a@b.c' });
    expect(await sessionSvc.getCurrentUser()).toEqual({ email: 'a@b.c' });
    expect(JSON.parse(localStorage.getItem('offline_current_user'))).toEqual({ email: 'a@b.c' });
  });

  it('SE2 — falha cai no último usuário conhecido', async () => {
    localStorage.setItem('offline_current_user', JSON.stringify({ email: 'cache@local' }));
    session.getCurrentUser.mockRejectedValue(new Error('sem rede'));
    expect(await sessionSvc.getCurrentUser()).toEqual({ email: 'cache@local' });
  });

  it('SE3 — verificarAutenticacao NÃO cai no cache e classifica 401/403', async () => {
    localStorage.setItem('offline_current_user', JSON.stringify({ email: 'cache@local' }));
    const erro = Object.assign(new Error('x'), { cause: { status: 401 } });
    session.getCurrentUser.mockRejectedValue(erro);

    const veredito = await sessionSvc.verificarAutenticacao();
    expect(veredito).toEqual({ autenticado: false, usuario: null, precisaAutenticar: true });
  });

  it('SE4 — falha sem status não pede autenticação', async () => {
    session.getCurrentUser.mockRejectedValue(new Error('rede'));
    expect((await sessionSvc.verificarAutenticacao()).precisaAutenticar).toBe(false);
  });

  it('SE5 — logout limpa o usuário offline', async () => {
    localStorage.setItem('offline_current_user', JSON.stringify({ email: 'a@b.c' }));
    await sessionSvc.encerrarSessao('https://app/x');
    expect(localStorage.getItem('offline_current_user')).toBe(null);
    expect(session.logout).toHaveBeenCalledWith('https://app/x');
  });

  it('SE6 — admin por papel ou por permissão', () => {
    expect(sessionSvc.ehAdministrador({ role: 'admin' }, null)).toBe(true);
    expect(sessionSvc.ehAdministrador({ role: 'user' }, { is_admin: true })).toBe(true);
    expect(sessionSvc.ehAdministrador({ role: 'user' }, { is_admin: false })).toBe(false);
  });

  it('SE7 — permissão nova carrega os cinco campos e o nome do usuário', async () => {
    session.createPermissao.mockResolvedValue({ id: 'perm' });
    await sessionSvc.salvarPermissao({
      dados: {
        user_email: 'a@b.c', modulos_permitidos: ['mapa'], permissoes_telas: ['x'],
        mobile_menu_ids: ['m'], is_admin: true, mapa_geral_permissoes: { editar: true },
      },
      permissoes: [], usuarios: [{ id: 'u1', email: 'a@b.c' }],
      userNome: 'ANA', nomeAtualUsuario: 'ANTIGA',
    });

    expect(session.updateUsuario).toHaveBeenCalledWith('u1', { nome: 'ANA' });
    expect(session.createPermissao).toHaveBeenCalledWith({
      user_email: 'a@b.c', user_nome: 'ANA', modulos_permitidos: ['mapa'], permissoes_telas: ['x'],
      mobile_menu_ids: ['m'], is_admin: true, mapa_geral_permissoes: { editar: true },
    });
  });

  it('SE8 — permissão existente é atualizada, não duplicada', async () => {
    session.updatePermissao.mockResolvedValue({ id: 'p1' });
    await sessionSvc.salvarPermissao({
      dados: { user_email: 'a@b.c' }, permissoes: [{ id: 'p1', user_email: 'a@b.c' }],
      usuarios: [], userNome: 'ANA', nomeAtualUsuario: 'ANA',
    });
    expect(session.updatePermissao).toHaveBeenCalledWith('p1', expect.objectContaining({ user_nome: 'ANA' }));
    expect(session.createPermissao).not.toHaveBeenCalled();
    expect(session.updateUsuario).not.toHaveBeenCalled();
  });

  it('SE9 — remover a própria permissão é bloqueado por código', async () => {
    await expect(
      sessionSvc.removerPermissao({
        userEmail: 'eu@x.com', permissoes: [{ id: 'p1', user_email: 'eu@x.com' }], emailDoUsuarioAtual: 'eu@x.com',
      })
    ).rejects.toSatisfy((erro) => hasApiErrorCode(erro, API_ERROR_CODES.PERMISSAO_SELF_DELETE_BLOCKED));
    expect(session.deletePermissao).not.toHaveBeenCalled();
  });

  it('SE10 — remover permissão de outro usuário funciona', async () => {
    const r = await sessionSvc.removerPermissao({
      userEmail: 'outro@x.com', permissoes: [{ id: 'p2', user_email: 'outro@x.com' }], emailDoUsuarioAtual: 'eu@x.com',
    });
    expect(r).toEqual({ removida: true });
    expect(session.deletePermissao).toHaveBeenCalledWith('p2');
  });
});

describe('IC/AR — ícones e upload', () => {
  it('IC1 — a listagem esconde inativos e a exclusão é lógica', async () => {
    mapa.listIcones.mockResolvedValue([{ id: 'a', ativo: true }, { id: 'b', ativo: false }, { id: 'c' }]);
    expect((await iconeSvc.listarIconesAtivos()).map((i) => i.id)).toEqual(['a', 'c']);

    await iconeSvc.desativarIcone('a');
    expect(mapa.updateIcone).toHaveBeenCalledWith('a', { ativo: false });
  });

  it('IC2 — criar marca o ícone como ativo e preserva a query key', async () => {
    await iconeSvc.criarIcone({ tipo_entidade: 'LOTE' });
    expect(mapa.createIcone).toHaveBeenCalledWith({ tipo_entidade: 'LOTE', ativo: true });
    expect(iconeSvc.ICONES_QUERY_KEY).toEqual(['configuracao-icones-global']);
    expect(iconeSvc.CATEGORIA_MISTO).toBe('MISTO');
  });

  it('AR1 — upload devolve a URL', async () => {
    arquivos.uploadArquivo.mockResolvedValue({ file_url: 'https://x/y.png' });
    expect(await arquivoSvc.enviarArquivo(new Blob(['x']))).toBe('https://x/y.png');
  });

  it('AR2 — upload sem file_url é falha, mesmo sem erro do provider', async () => {
    arquivos.uploadArquivo.mockResolvedValue({});
    await expect(arquivoSvc.enviarArquivo(new Blob(['x']))).rejects.toSatisfy(
      (erro) => hasApiErrorCode(erro, API_ERROR_CODES.OPERATION_FAILED)
    );
  });

  it('AR3 — sem arquivo, argumento inválido', async () => {
    await expect(arquivoSvc.enviarArquivo(null)).rejects.toSatisfy(
      (erro) => hasApiErrorCode(erro, API_ERROR_CODES.INVALID_ARGUMENT)
    );
    expect(arquivos.uploadArquivo).not.toHaveBeenCalled();
  });
});

// ── DBT-25 ────────────────────────────────────────────────────────────────

describe('DEC — leitura de decimal pt-BR (DBT-25)', () => {
  it('DEC1 — vírgula e ponto valem como separador decimal', () => {
    expect(parseDecimalPtBR('12,5')).toBe(12.5);
    expect(parseDecimalPtBR('12.5')).toBe(12.5);
    expect(parseDecimalPtBR(12.5)).toBe(12.5);
  });

  it('DEC2 — com vírgula presente, o ponto é separador de milhar', () => {
    expect(parseDecimalPtBR('1.234,56')).toBe(1234.56);
    expect(parseDecimalPtBR('1.234.567,89')).toBe(1234567.89);
  });

  it('DEC3 — campo opcional em branco vira null, nunca NaN', () => {
    for (const vazio of ['', '   ', null, undefined]) {
      expect(parseDecimalPtBR(vazio)).toBe(null);
    }
    expect(parseDecimalPtBR('abc')).toBe(null);
    expect(Number.isNaN(parseDecimalPtBR('abc'))).toBe(false);
  });

  it('DEC4 — inteiro trunca depois de ler', () => {
    expect(parseInteiroPtBR('12,9')).toBe(12);
    expect(parseInteiroPtBR('1.200,0')).toBe(1200);
    expect(parseInteiroPtBR('')).toBe(null);
  });
});
