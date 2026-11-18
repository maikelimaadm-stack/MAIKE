/**
 * Frente G2 — ligação PontoReferencia ↔ cocho/depósito/bebedouro, exclusão de
 * ponto e de área, ícones do tenant.
 *
 *  L1–L6  regra única de ligação (`@/domain/mapa/ligacaoPontoReferencia`):
 *         sigla sozinha não liga; bebedouro nunca casa com cocho; categoria do
 *         tipo; coordenadas desempatam; ambiguidade é avisada.
 *  C1–C3  coluna do Cadastro de Pontos usa a mesma regra.
 *  E1–E6  exclusão do ponto: histórico bloqueia (nada é apagado), ambiguidade
 *         bloqueia, bebedouro não apaga cocho homônimo, ordem segura e falha
 *         parcial não vira sucesso.
 *  A1–A2  exclusão de área: bebedouro ligado bloqueia; movimentação consultada
 *         FILTRADA pela área (sem o teto das 500 mais recentes).
 *  I1     ícone sem empresa vale para a empresa (configuração do tenant).
 *  P1–P2  corpos de bebedouro e cocho montados num só lugar, sem numero_ponto.
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
const lotes = {
  listLotes: vi.fn(), listMovimentacoes: vi.fn(), listTodasMovimentacoes: vi.fn(),
  listHistoricoMovimentacoesPagina: vi.fn(), listMovimentacoesPecuarias: vi.fn(), listSuplementacaoEventos: vi.fn(),
};
const tarefas = { listLancamentos: vi.fn() };
const rebanho = { listManejosTecnicos: vi.fn() };
const estoque = { deleteLocal: vi.fn(), listLocais: vi.fn() };
const supl = { consultarElegibilidadeExclusaoPontoSuplementacao: vi.fn() };
const beb = { consultarElegibilidadeExclusaoBebedouro: vi.fn() };

vi.mock('@/apis/mapa', () => api);
vi.mock('@/apis/lotes', () => lotes);
vi.mock('@/apis/tarefas', () => tarefas);
vi.mock('@/apis/rebanho', () => rebanho);
vi.mock('@/apis/estoque', () => estoque);
vi.mock('@/apis/pontos-suplementacao', () => supl);
vi.mock('@/apis/bebedouros', () => beb);

const mapaService = await import('@/services/mapaService');
const { API_ERROR_CODES, hasApiErrorCode } = await import('@/apis/_core/ApiError');
const ligacao = await import('@/domain/mapa/ligacaoPontoReferencia');
const { pontosComDetalhes, valorDoPonto } = await import('@/components/mapa/cadastro/colunasCadastroMapa');
const { montarPayloadBebedouro, montarPayloadSuplementacao } = await import('@/domain/mapa/payloadsPontoMapa');

const E = 'emp-1';
const AQUI = { lat: -15.1, lng: -56.1 };
const ALI = { lat: -15.2, lng: -56.2 };

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [...Object.values(api), ...Object.values(lotes), ...Object.values(tarefas), ...Object.values(rebanho)]) {
    fn.mockResolvedValue([]);
  }
  lotes.listHistoricoMovimentacoesPagina.mockResolvedValue({ items: [], total: 0 });
  estoque.listLocais.mockResolvedValue([]);
  estoque.deleteLocal.mockResolvedValue(undefined);
  api.deletePonto.mockResolvedValue({});
  api.deletePontoSuplementacao.mockResolvedValue(undefined);
  supl.consultarElegibilidadeExclusaoPontoSuplementacao.mockImplementation(async (id) => ({ id, pode_excluir: true, motivos: [] }));
  beb.consultarElegibilidadeExclusaoBebedouro.mockImplementation(async (id) => ({ id, pode_excluir: true, motivos: [] }));
});

const cocho = (extra = {}) => ({ id: 'c1', empresa_id: E, status: 'Ativo', nome_ponto: 'COCHO 1', sigla: 'C1', categoria_ponto: 'COCHO', coordenadas: AQUI, ...extra });
const deposito = (extra = {}) => ({ id: 'd1', empresa_id: E, status: 'Ativo', nome_ponto: 'DEP 1', categoria_ponto: 'DEPOSITO', local_estoque_id: 'loc1', coordenadas: AQUI, ...extra });

describe('regra única de ligação', () => {
  it('L1 — sigla igual sozinha NÃO liga um ponto comum ao cocho', () => {
    const r = ligacao.resolverSuplementacaoDoPonto({ id: 'p', empresa_id: E, nome: 'PORTEIRA', sigla: 'C1', tipo: 'PORTEIRA' }, [cocho()]);
    expect(r.registro).toBeNull();
  });

  it('L2 — ponto BEBEDOURO nunca casa com cocho de mesmo nome', () => {
    const r = ligacao.resolverSuplementacaoDoPonto({ id: 'p', empresa_id: E, nome: 'COCHO 1', tipo: 'BEBEDOURO' }, [cocho()]);
    expect(r.registro).toBeNull();
  });

  it('L3 — categoria do tipo: COCHO não casa com depósito homônimo, DEPÓSITO casa com depósito', () => {
    const lista = [deposito({ nome_ponto: 'SEDE' }), cocho({ id: 'c2', nome_ponto: 'SEDE' })];
    expect(ligacao.resolverSuplementacaoDoPonto({ empresa_id: E, nome: 'Sede', tipo: 'Cocho' }, lista).registro.id).toBe('c2');
    expect(ligacao.resolverSuplementacaoDoPonto({ empresa_id: E, nome: 'sede', tipo: 'Depósito' }, lista).registro.id).toBe('d1');
  });

  it('L4 — outra empresa não liga', () => {
    const r = ligacao.resolverSuplementacaoDoPonto({ empresa_id: 'outra', nome: 'COCHO 1', tipo: 'COCHO' }, [cocho()]);
    expect(r.registro).toBeNull();
  });

  it('L5 — homônimos: coordenadas desempatam; sem desempate é ambíguo', () => {
    const lista = [cocho(), cocho({ id: 'c2', coordenadas: ALI })];
    const desempate = ligacao.resolverSuplementacaoDoPonto({ empresa_id: E, nome: 'COCHO 1', tipo: 'COCHO', coordenadas: ALI }, lista);
    expect(desempate).toMatchObject({ ambiguo: false });
    expect(desempate.registro.id).toBe('c2');
    const amb = ligacao.resolverSuplementacaoDoPonto({ empresa_id: E, nome: 'COCHO 1', tipo: 'COCHO', coordenadas: { lat: 0, lng: 0 } }, lista);
    expect(amb.ambiguo).toBe(true);
    expect(amb.registro).toBeNull();
  });

  it('L6 — bebedouro só por ponto_referencia_id (nome/código iguais não ligam)', () => {
    const bebs = [
      { id: 'b1', nome: 'BEB 1', codigo_interno: 'B1' },
      { id: 'b2', ponto_referencia_id: 'p9', nome: 'OUTRO' },
    ];
    expect(ligacao.bebedourosDoPonto({ id: 'p1', nome: 'BEB 1', sigla: 'B1' }, bebs)).toEqual([]);
    expect(ligacao.bebedourosDoPonto({ id: 'p9' }, bebs).map((b) => b.id)).toEqual(['b2']);
  });
});

describe('coluna do Cadastro de Pontos', () => {
  it('C1 — ponto comum com a sigla de um cocho não mostra o cocho', () => {
    const [p] = pontosComDetalhes([{ id: 'p', empresa_id: E, nome: 'PORTEIRA', sigla: 'C1', tipo: 'PORTEIRA' }], [cocho()], []);
    expect(p.detalhe_suplementacao).toBeNull();
    expect(valorDoPonto(p, 'categoria')).toBe('');
  });

  it('C2 — cocho com bebedouro homônimo continua COCHO, e as áreas são as do cocho', () => {
    const [p] = pontosComDetalhes(
      [{ id: 'p', empresa_id: E, nome: 'COCHO 1', tipo: 'COCHO' }],
      [cocho({ area_vinculada_nomes: ['PASTO DO COCHO'] })],
      [{ id: 'b1', nome: 'COCHO 1', area_vinculada_nomes: ['PASTO DO BEBEDOURO'] }],
    );
    expect(p.detalhe_bebedouro).toBeNull();
    expect(valorDoPonto(p, 'categoria')).toBe('COCHO');
    expect(valorDoPonto(p, 'areas')).toBe('PASTO DO COCHO');
  });

  it('C3 — homônimos sem desempate ficam sem detalhe e marcados como ambíguos', () => {
    const [p] = pontosComDetalhes(
      [{ id: 'p', empresa_id: E, nome: 'COCHO 1', tipo: 'COCHO', coordenadas: { lat: 0, lng: 0 } }],
      [cocho(), cocho({ id: 'c2', coordenadas: ALI })],
      [],
    );
    expect(p.detalhe_suplementacao).toBeNull();
    expect(p.ligacao_suplementacao_ambigua).toBe(true);
  });
});

describe('exclusão de ponto', () => {
  it('E1 — cocho com histórico: bloqueia com MAPA_DELETE_BLOCKED e não apaga NADA', async () => {
    api.listPontosSuplementacao.mockResolvedValue([cocho()]);
    supl.consultarElegibilidadeExclusaoPontoSuplementacao.mockResolvedValue({ id: 'c1', pode_excluir: false, motivos: ['leituras_cocho'] });
    const erro = await mapaService.excluirPontoComCascata('p1', E, { id: 'p1', empresa_id: E, nome: 'Cocho 1', tipo: 'COCHO' }).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.MAPA_DELETE_BLOCKED)).toBe(true);
    expect(erro.details.bloqueios[0]).toMatchObject({ recurso: 'PontoSuplementacao', motivos: ['leituras_cocho'] });
    expect(api.deletePonto).not.toHaveBeenCalled();
    expect(api.deletePontoSuplementacao).not.toHaveBeenCalled();
  });

  it('E2 — bebedouro com histórico também bloqueia', async () => {
    api.listBebedouros.mockResolvedValue([{ id: 'b1', ponto_referencia_id: 'p1' }]);
    beb.consultarElegibilidadeExclusaoBebedouro.mockResolvedValue({ id: 'b1', pode_excluir: false, motivos: ['historico'] });
    const erro = await mapaService.excluirPontoComCascata('p1', E, { id: 'p1', empresa_id: E, nome: 'BEB', tipo: 'BEBEDOURO' }).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.MAPA_DELETE_BLOCKED)).toBe(true);
    expect(api.deletePonto).not.toHaveBeenCalled();
  });

  it('E3 — excluir um BEBEDOURO não apaga o cocho/depósito de mesmo nome', async () => {
    api.listPontosSuplementacao.mockResolvedValue([deposito({ nome_ponto: 'AGUADA' })]);
    api.listBebedouros.mockResolvedValue([{ id: 'b1', ponto_referencia_id: 'p1' }]);
    const r = await mapaService.excluirPontoComCascata('p1', E, { id: 'p1', empresa_id: E, nome: 'AGUADA', tipo: 'BEBEDOURO' });
    expect(api.deletePontoSuplementacao).not.toHaveBeenCalled();
    expect(estoque.deleteLocal).not.toHaveBeenCalled();
    expect(api.deletePonto).toHaveBeenCalledWith('p1');
    expect(r).toMatchObject({ pontosSuplementacaoRemovidos: 0, bebedourosRemovidos: 1 });
  });

  it('E4 — sem histórico: o cocho/depósito sai ANTES do ponto (o servidor cuida do local e dos cochos)', async () => {
    const ordem = [];
    api.listPontosSuplementacao.mockResolvedValue([deposito(), cocho({ id: 'c9', nome_ponto: 'OUTRO', deposito_origem_id: 'd1' })]);
    api.deletePontoSuplementacao.mockImplementation(async (id) => { ordem.push(`supl:${id}`); });
    api.deletePonto.mockImplementation(async (id) => { ordem.push(`ponto:${id}`); });
    const r = await mapaService.excluirPontoComCascata('p1', E, { id: 'p1', empresa_id: E, nome: 'Dep 1', tipo: 'DEPÓSITO' });
    expect(ordem).toEqual(['supl:d1', 'ponto:p1']);
    expect(api.updatePontoSuplementacao).not.toHaveBeenCalled();
    expect(estoque.deleteLocal).not.toHaveBeenCalled();
    expect(r.pontosSuplementacaoRemovidos).toBe(1);
  });

  it('E5 — ligação ambígua: bloqueia e não apaga nada', async () => {
    api.listPontosSuplementacao.mockResolvedValue([cocho(), cocho({ id: 'c2', coordenadas: ALI })]);
    const erro = await mapaService.excluirPontoComCascata('p1', E, { id: 'p1', empresa_id: E, nome: 'COCHO 1', tipo: 'COCHO', coordenadas: { lat: 0, lng: 0 } }).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.MAPA_DELETE_BLOCKED)).toBe(true);
    expect(erro.details.motivo).toBe('ligacao_ambigua');
    expect(api.deletePonto).not.toHaveBeenCalled();
    expect(api.deletePontoSuplementacao).not.toHaveBeenCalled();
  });

  it('E6 — o servidor recusa o ponto depois do cocho sair: falha parcial, nunca sucesso', async () => {
    api.listPontosSuplementacao.mockResolvedValue([cocho()]);
    api.deletePonto.mockRejectedValue(new Error('rede'));
    const erro = await mapaService.excluirPontoComCascata('p1', E, { id: 'p1', empresa_id: E, nome: 'COCHO 1', tipo: 'COCHO' }).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.MAPA_PARTIAL_OPERATION)).toBe(true);
  });

  it('E8 — ponto que deixou de ser bebedouro (bebedouro INATIVO com histórico) pode ser excluído', async () => {
    api.listBebedouros.mockResolvedValue([{ id: 'b1', ponto_referencia_id: 'p1', ativo: false, status: 'Inativo' }]);
    beb.consultarElegibilidadeExclusaoBebedouro.mockResolvedValue({ id: 'b1', pode_excluir: false, motivos: ['historico'] });
    await mapaService.excluirPontoComCascata('p1', E, { id: 'p1', empresa_id: E, nome: 'BEB 01', tipo: 'PORTEIRA' });
    expect(beb.consultarElegibilidadeExclusaoBebedouro).not.toHaveBeenCalled();
    expect(api.deletePonto).toHaveBeenCalledWith('p1');
  });

  it('U1 — desfazer a criação apaga só o ponto (o local do depósito nasce na transação do depósito)', async () => {
    expect(await mapaService.desfazerCriacaoDePonto({ pontoId: 'p1' })).toBe(true);
    expect(api.deletePonto).toHaveBeenCalledWith('p1');
    expect(estoque.deleteLocal).not.toHaveBeenCalled();
    api.deletePonto.mockRejectedValueOnce(new Error('403'));
    expect(await mapaService.desfazerCriacaoDePonto({ pontoId: 'p2' })).toBe(false);
  });

  it('E7 — o servidor recusa o cocho (histórico novo): o ponto NÃO é apagado', async () => {
    api.listPontosSuplementacao.mockResolvedValue([cocho()]);
    api.deletePontoSuplementacao.mockRejectedValue(new Error('409'));
    await expect(mapaService.excluirPontoComCascata('p1', E, { id: 'p1', empresa_id: E, nome: 'COCHO 1', tipo: 'COCHO' })).rejects.toBeTruthy();
    expect(api.deletePonto).not.toHaveBeenCalled();
  });
});

describe('exclusão de área', () => {
  it('A1 — bebedouro ligado ao pasto (pasto_id ou lista de áreas) bloqueia', async () => {
    api.listAreas.mockResolvedValue([{ id: 'a1', empresa_id: E }]);
    api.listBebedouros.mockResolvedValue([{ id: 'b1', empresa_id: E, area_vinculada_ids: ['a0', 'a1'] }]);
    const erro = await mapaService.excluirArea('a1', E).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.MAPA_DELETE_BLOCKED)).toBe(true);
    expect(erro.details.vinculo).toBe('bebedouros');
    expect(api.updateArea).not.toHaveBeenCalled();
  });

  it('A3 — bebedouro INATIVO (o ponto deixou de ser bebedouro) não segura a área', async () => {
    api.listAreas.mockResolvedValue([{ id: 'a1', empresa_id: E }]);
    api.listBebedouros.mockResolvedValue([{ id: 'b1', empresa_id: E, pasto_id: 'a1', ativo: false, status: 'Inativo' }]);
    await mapaService.excluirArea('a1', E);
    expect(api.updateArea).toHaveBeenCalledWith('a1', { ativo: false });
  });

  it('A2 — movimentação antiga: a consulta é FILTRADA pela área no servidor, sem o teto de 500', async () => {
    api.listAreas.mockResolvedValue([{ id: 'a1', empresa_id: E }]);
    lotes.listHistoricoMovimentacoesPagina.mockResolvedValue({
      items: [{ id: 'm-antiga', empresa_id: E, area_origem_id: 'a1' }], total: 1,
    });
    const erro = await mapaService.excluirArea('a1', E).catch((e) => e);
    expect(lotes.listHistoricoMovimentacoesPagina).toHaveBeenCalledWith({ empresaId: E, areaId: 'a1', limit: 1 });
    expect(lotes.listMovimentacoes).not.toHaveBeenCalled();
    expect(hasApiErrorCode(erro, API_ERROR_CODES.MAPA_DELETE_BLOCKED)).toBe(true);
    expect(erro.details.vinculo).toBe('movimentações do mapa');
  });
});

describe('ícones do tenant', () => {
  it('I1 — ícone gravado sem empresa vale para a empresa; o de outra empresa não', async () => {
    api.listIcones.mockResolvedValue([
      { id: 'i1', empresa_id: null, ativo: true },
      { id: 'i2', empresa_id: E, ativo: true },
      { id: 'i3', empresa_id: 'outra', ativo: true },
      { id: 'i4', empresa_id: null, ativo: false },
    ]);
    expect((await mapaService.listarIconesDaEmpresa(E)).map((i) => i.id)).toEqual(['i1', 'i2']);
  });
});

describe('corpos de gravação', () => {
  const areas = [{ id: 'a1', nome: 'PASTO 1', setor_id: 's1', setor_nome: 'SETOR 1' }];
  it('P1 — bebedouro ligado pelo id do ponto, com áreas, setor e capacidade', () => {
    const corpo = montarPayloadBebedouro({
      data: { nome: 'BEB 1', sigla: 'B1', setor_id: 's1', area_vinculada_ids: ['a1'], capacidade_agua_litros: '5000', tipo_bebedouro: 'Australiano' },
      pontoReferenciaId: 'p1', empresaId: E, areas, setores: [], coordenadas: AQUI,
    });
    expect(corpo).toMatchObject({
      empresa_id: E, ponto_referencia_id: 'p1', nome: 'BEB 1', pasto_id: 'a1', area_vinculada_ids: ['a1'],
      setor_nome: 'SETOR 1', capacidade_litros: 5000, tipo: 'Australiano', ativo: true, status: 'Ativo',
    });
  });

  it('P2 — cocho/depósito sem numero_ponto (o servidor numera)', () => {
    const corpo = montarPayloadSuplementacao({
      data: { nome: 'C', tipo: 'COCHO', tipo_categoria: 'COCHO', area_vinculada_ids: ['a1'], capacidade_cocho_kg: '100' },
      empresaId: E, areas, coordenadas: AQUI,
    });
    expect(corpo).not.toHaveProperty('numero_ponto');
    expect(corpo).toMatchObject({ categoria_ponto: 'COCHO', area_vinculada_id: 'a1', capacidade_cocho_kg: 100 });
  });
});
