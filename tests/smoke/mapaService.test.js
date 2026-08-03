/**
 * Regras de negócio do mapa migradas para service (P1.2).
 *
 * O foco é o **contrato**, não a interface: a UI gigante do mapa não é
 * exercitada aqui, e sim a orquestração que saiu dela.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = {
  listAreas: vi.fn(), filterAreas: vi.fn(), updateArea: vi.fn(),
  listPontos: vi.fn(), deletePonto: vi.fn(),
  listPontosSuplementacao: vi.fn(), updatePontoSuplementacao: vi.fn(), deletePontoSuplementacao: vi.fn(),
  listLinhas: vi.fn(), updateLinha: vi.fn(),
  listSetores: vi.fn(), listIcones: vi.fn(), listBebedouros: vi.fn(),
  createArea: vi.fn(), createPonto: vi.fn(), createPontoSuplementacao: vi.fn(), createLinha: vi.fn(),
  updatePonto: vi.fn(),
};
const lotes = { listLotes: vi.fn(), listMovimentacoes: vi.fn(), listMovimentacoesPecuarias: vi.fn(), listSuplementacaoEventos: vi.fn() };
const tarefas = { listLancamentos: vi.fn() };
const rebanho = { listManejosTecnicos: vi.fn() };
const estoque = { deleteLocal: vi.fn(), listLocais: vi.fn() };

vi.mock('@/apis/mapa', () => api);
vi.mock('@/apis/lotes', () => lotes);
vi.mock('@/apis/tarefas', () => tarefas);
vi.mock('@/apis/rebanho', () => rebanho);
vi.mock('@/apis/estoque', () => estoque);

const mapaService = await import('@/services/mapaService');
const { ApiError, API_ERROR_CODES, hasApiErrorCode, getApiErrorMessage, isApiError } = await import('@/apis/_core/ApiError');

const EMPRESA = 'emp-1';

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [...Object.values(api), ...Object.values(lotes), ...Object.values(tarefas), ...Object.values(rebanho)]) {
    if (typeof fn.mockResolvedValue === 'function') fn.mockResolvedValue([]);
  }
  estoque.listLocais.mockResolvedValue([]);
  estoque.deleteLocal.mockResolvedValue(undefined);
});

describe('MapaCadastro — listagens', () => {
  it('MC1 — áreas filtradas por empresa e ativo', async () => {
    api.listAreas.mockResolvedValue([
      { id: 'a1', empresa_id: EMPRESA, ativo: true },
      { id: 'a2', empresa_id: 'outra', ativo: true },
      { id: 'a3', empresa_id: EMPRESA, ativo: false },
    ]);
    expect(await mapaService.listarAreasAtivas(EMPRESA)).toEqual([{ id: 'a1', empresa_id: EMPRESA, ativo: true }]);
  });

  it('MC2 — pontos filtrados por empresa e ativo', async () => {
    api.listPontos.mockResolvedValue([
      { id: 'p1', empresa_id: EMPRESA, ativo: true },
      { id: 'p2', empresa_id: EMPRESA, ativo: false },
    ]);
    expect(await mapaService.listarPontosAtivos(EMPRESA)).toHaveLength(1);
  });

  it('MC3 — linhas filtradas por empresa e ativo', async () => {
    api.listLinhas.mockResolvedValue([
      { id: 'l1', empresa_id: EMPRESA, ativo: true },
      { id: 'l2', empresa_id: 'outra', ativo: true },
    ]);
    expect(await mapaService.listarLinhasAtivas(EMPRESA)).toHaveLength(1);
  });
});

describe('MapaCadastro — exclusão de área', () => {
  it('MC4 — sem vínculo, faz exclusão lógica', async () => {
    api.listAreas.mockResolvedValue([{ id: 'a1', empresa_id: EMPRESA }]);
    await mapaService.excluirArea('a1', EMPRESA);
    expect(api.updateArea).toHaveBeenCalledWith('a1', { ativo: false });
  });

  it('MC5 — com lote vinculado, lança código estável e não exclui', async () => {
    api.listAreas.mockResolvedValue([{ id: 'a1', empresa_id: EMPRESA }]);
    lotes.listLotes.mockResolvedValue([{ id: 'lote-1', empresa_id: EMPRESA, area_atual_id: 'a1' }]);

    const erro = await mapaService.excluirArea('a1', EMPRESA).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.MAPA_DELETE_BLOCKED)).toBe(true);
    expect(erro.details).toMatchObject({ id: 'a1', vinculo: 'lotes', quantidade: 1 });
    expect(api.updateArea).not.toHaveBeenCalled();
  });

  it('MC6 — a mensagem é do catálogo, não texto do provider', async () => {
    api.listAreas.mockResolvedValue([{ id: 'a1', empresa_id: EMPRESA }]);
    lotes.listLotes.mockResolvedValue([{ id: 'l', empresa_id: EMPRESA, area_atual_id: 'a1' }]);
    const erro = await mapaService.excluirArea('a1', EMPRESA).catch((e) => e);
    expect(getApiErrorMessage(erro)).toBe('Não é possível excluir: existem registros vinculados.');
  });

  it('vínculo de outra empresa não bloqueia', async () => {
    api.listAreas.mockResolvedValue([{ id: 'a1', empresa_id: EMPRESA }]);
    lotes.listLotes.mockResolvedValue([{ id: 'l', empresa_id: 'outra', area_atual_id: 'a1' }]);
    await mapaService.excluirArea('a1', EMPRESA);
    expect(api.updateArea).toHaveBeenCalled();
  });
});

describe('MapaCadastro — exclusão de ponto com cascata', () => {
  const ponto = { id: 'pt1', nome: 'Cocho 1', empresa_id: EMPRESA };

  it('MC7 — remove ponto e os pontos de suplementação vinculados pelo nome', async () => {
    api.listPontosSuplementacao.mockResolvedValue([
      { id: 's1', empresa_id: EMPRESA, status: 'Ativo', nome_ponto: 'cocho 1', categoria_ponto: 'Cocho' },
      { id: 's2', empresa_id: EMPRESA, status: 'Ativo', nome_ponto: 'Outro', categoria_ponto: 'Cocho' },
    ]);
    const r = await mapaService.excluirPontoComCascata('pt1', EMPRESA, ponto);
    expect(api.deletePonto).toHaveBeenCalledWith('pt1');
    expect(api.deletePontoSuplementacao).toHaveBeenCalledWith('s1');
    expect(api.deletePontoSuplementacao).not.toHaveBeenCalledWith('s2');
    expect(r.pontosSuplementacaoRemovidos).toBe(1);
  });

  it('MC8 — LocalEstoque ausente é tolerado e contabilizado', async () => {
    api.listPontosSuplementacao.mockResolvedValue([
      { id: 'd1', empresa_id: EMPRESA, status: 'Ativo', nome_ponto: 'Cocho 1', categoria_ponto: 'Depósito', local_estoque_id: 'le1' },
    ]);
    estoque.deleteLocal.mockRejectedValue(new Error('não encontrado'));
    const r = await mapaService.excluirPontoComCascata('pt1', EMPRESA, ponto);
    expect(r.locaisEstoqueIgnorados).toBe(1);
    expect(api.deletePontoSuplementacao).toHaveBeenCalledWith('d1');
  });

  it('MC9 — cocho que apontava para o depósito é desvinculado', async () => {
    api.listPontosSuplementacao.mockResolvedValue([
      { id: 'd1', empresa_id: EMPRESA, status: 'Ativo', nome_ponto: 'Cocho 1', categoria_ponto: 'DEPOSITO', local_estoque_id: 'le1' },
      { id: 'c9', empresa_id: EMPRESA, status: 'Ativo', nome_ponto: 'Outro', deposito_origem_id: 'd1' },
    ]);
    const r = await mapaService.excluirPontoComCascata('pt1', EMPRESA, ponto);
    expect(api.updatePontoSuplementacao).toHaveBeenCalledWith('c9', {
      deposito_origem_id: null, deposito_origem_nome: null,
    });
    expect(r.cochosDesvinculados).toBe(1);
  });

  it('a ordem é preservada: o ponto sai antes da cascata', async () => {
    const ordem = [];
    api.deletePonto.mockImplementation(async () => { ordem.push('ponto'); });
    api.deletePontoSuplementacao.mockImplementation(async () => { ordem.push('supl'); });
    api.listPontosSuplementacao.mockResolvedValue([
      { id: 's1', empresa_id: EMPRESA, status: 'Ativo', nome_ponto: 'Cocho 1' },
    ]);
    await mapaService.excluirPontoComCascata('pt1', EMPRESA, ponto);
    expect(ordem).toEqual(['ponto', 'supl']);
  });
});

describe('MapaCadastro — exclusão de linha', () => {
  it('MC10 — linha recebe ativo: false', async () => {
    await mapaService.excluirLinha('l1');
    expect(api.updateLinha).toHaveBeenCalledWith('l1', { ativo: false });
  });
});

describe('regra de exclusão — fonte única', () => {
  it('a tabela usada pelo mapa é a mesma do guard legado', async () => {
    const dominio = await import('@/domain/deleteRules');
    const legado = await import('@/lib/entityDeleteGuards');
    expect(legado.DELETE_RULES).toBe(dominio.DELETE_RULES);
  });

  it('toda dependência de AreaPastagem tem carregador explícito no service', async () => {
    const { dependenciesOf } = await import('@/domain/deleteRules');
    api.listAreas.mockResolvedValue([{ id: 'a1', empresa_id: EMPRESA }]);
    // Se faltasse carregador, `excluirArea` lançaria em vez de liberar em silêncio.
    await expect(mapaService.excluirArea('a1', EMPRESA)).resolves.toBeTruthy();
    expect(dependenciesOf('AreaPastagem').length).toBeGreaterThan(0);
  });

  it('dependência sem carregador vira erro, não liberação silenciosa', async () => {
    const { evaluateDeleteBlock } = await import('@/domain/deleteRules');
    const veredito = evaluateDeleteBlock({
      entityName: 'AreaPastagem', id: 'a1', currentRecord: { id: 'a1', empresa_id: EMPRESA },
      recordsByEntity: { Lote: [{ id: 'x', empresa_id: EMPRESA, area_entrada_id: 'a1' }] },
    });
    expect(veredito.blocked).toBe(true);
    expect(veredito.label).toBe('lotes');
  });
});

describe('sessão', () => {
  it('DL15/MG1 — online lê do provider e persiste para uso offline', async () => {
    vi.resetModules();
    const getCurrentUserApi = vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.c' });
    vi.doMock('@/apis/session', () => ({ getCurrentUser: getCurrentUserApi, listUsuarios: vi.fn(), listPermissoes: vi.fn() }));
    const { getCurrentUser } = await import('@/services/sessionService');

    const u = await getCurrentUser();
    expect(u).toEqual({ id: 'u1', email: 'a@b.c' });
    expect(JSON.parse(localStorage.getItem('offline_current_user'))).toEqual({ id: 'u1', email: 'a@b.c' });
  });

  it('MG2 — offline devolve o último usuário conhecido sem chamar o provider', async () => {
    vi.resetModules();
    const getCurrentUserApi = vi.fn();
    vi.doMock('@/apis/session', () => ({ getCurrentUser: getCurrentUserApi, listUsuarios: vi.fn(), listPermissoes: vi.fn() }));
    localStorage.setItem('offline_current_user', JSON.stringify({ id: 'cache' }));
    const navSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { getCurrentUser } = await import('@/services/sessionService');

    expect(await getCurrentUser()).toEqual({ id: 'cache' });
    expect(getCurrentUserApi).not.toHaveBeenCalled();
    navSpy.mockRestore();
  });

  it('falha do provider cai no último usuário conhecido', async () => {
    vi.resetModules();
    vi.doMock('@/apis/session', () => ({
      getCurrentUser: vi.fn().mockRejectedValue(new Error('sem rede')),
      listUsuarios: vi.fn(), listPermissoes: vi.fn(),
    }));
    localStorage.setItem('offline_current_user', JSON.stringify({ id: 'antigo' }));
    const { getCurrentUser } = await import('@/services/sessionService');
    expect(await getCurrentUser()).toEqual({ id: 'antigo' });
  });
});

describe('ApiError da P1.2', () => {
  it('os códigos novos têm mensagem pública fixa e catalogada', () => {
    for (const code of [API_ERROR_CODES.MAPA_DELETE_BLOCKED, API_ERROR_CODES.MAPA_PARTIAL_OPERATION]) {
      const erro = new ApiError(code);
      expect(isApiError(erro)).toBe(true);
      expect(erro.message.trim().length).toBeGreaterThan(0);
      expect(new ApiError(code, { message: 'texto do chamador' }).message).toBe(erro.message);
    }
  });
});
