/**
 * Ligação ponto ↔ cocho/depósito quando o registro está no lugar de OUTRO
 * ponto (D-PROD-214, caso real de produção em 2026-11-16): dois pontos "TESTE"
 * de depósito (nº 1 e nº 4) e um único depósito DEP-0001, nas coordenadas do
 * nº 4. O nº 1 é sobra de um cadastro que falhou e não pode "achar" o depósito
 * do nº 4 pelo nome — nem na lista, nem no formulário, nem na exclusão.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolverSuplementacaoDoPonto } from '@/domain/mapa/ligacaoPontoReferencia';
import { pontosComDetalhes } from '@/components/mapa/cadastro/colunasCadastroMapa';

const EMPRESA = 'emp-1';
const LUGAR_1 = { lat: -14.50675131924793, lng: -60.20948193454403 };
const LUGAR_4 = { lat: -14.50677727330729, lng: -60.20940129969895 };
const LUGAR_5 = { lat: -14.50725986956382, lng: -60.20922157410868 };

const ponto1 = { id: 'p1', empresa_id: EMPRESA, numero_ponto: '1', nome: 'TESTE', tipo: 'DEPÓSITO', ativo: true, coordenadas: LUGAR_1 };
const ponto4 = { id: 'p4', empresa_id: EMPRESA, numero_ponto: '4', nome: 'TESTE', tipo: 'Depósito', ativo: true, coordenadas: LUGAR_4 };
const ponto5 = { id: 'p5', empresa_id: EMPRESA, numero_ponto: '5', nome: 'TESTE', tipo: 'Cocho', ativo: true, coordenadas: LUGAR_5 };
const deposito = { id: 'dep1', empresa_id: EMPRESA, numero_ponto: 'DEP-0001', nome_ponto: 'TESTE', categoria_ponto: 'DEPOSITO', status: 'Ativo', coordenadas: LUGAR_4 };
const cocho = { id: 'coc2', empresa_id: EMPRESA, numero_ponto: 'COCHO-0002', nome_ponto: 'TESTE', categoria_ponto: 'COCHO', status: 'Ativo', coordenadas: LUGAR_5 };
const PONTOS = [ponto1, ponto4, ponto5];
const SUPL = [deposito, cocho];

describe('regra de ligação — lugar de outro ponto', () => {
  it('LO1 — o ponto nº 1 (sem depósito próprio) não liga ao depósito do nº 4', () => {
    const r = resolverSuplementacaoDoPonto(ponto1, SUPL, { outrosPontos: PONTOS });
    expect(r).toMatchObject({ registro: null, ambiguo: false });
  });

  it('LO2 — o ponto nº 4 continua ligado ao próprio depósito', () => {
    expect(resolverSuplementacaoDoPonto(ponto4, SUPL, { outrosPontos: PONTOS }).registro?.id).toBe('dep1');
  });

  it('LO3 — o cocho nº 5 continua ligado ao COCHO-0002', () => {
    expect(resolverSuplementacaoDoPonto(ponto5, SUPL, { outrosPontos: PONTOS }).registro?.id).toBe('coc2');
  });

  it('LO4 — ponto movido (coordenadas diferentes) ainda liga pelo nome quando o lugar não é de ninguém', () => {
    const movido = { ...ponto4, coordenadas: { lat: -14.6, lng: -60.3 } };
    expect(resolverSuplementacaoDoPonto(movido, SUPL, { outrosPontos: [ponto1, movido, ponto5] }).registro?.id).toBe('dep1');
  });

  it('LO5 — ponto inativo no lugar não reivindica o depósito', () => {
    const r = resolverSuplementacaoDoPonto(ponto1, SUPL, { outrosPontos: [ponto1, { ...ponto4, ativo: false }] });
    expect(r.registro?.id).toBe('dep1');
  });

  it('LO6 — ponto de outra categoria no mesmo lugar não reivindica', () => {
    const porteira = { ...ponto4, id: 'px', tipo: 'Porteira' };
    expect(resolverSuplementacaoDoPonto(ponto1, SUPL, { outrosPontos: [ponto1, porteira] }).registro?.id).toBe('dep1');
  });

  it('LO10 — ponto de OUTRO nome no mesmo lugar (ímã do editor) não tira o cocho do dono pelo nome', () => {
    const pa = { id: 'pa', empresa_id: EMPRESA, nome: 'COCHO A', tipo: 'Cocho', ativo: true, coordenadas: LUGAR_1 };
    const pb = { id: 'pb', empresa_id: EMPRESA, nome: 'COCHO B', tipo: 'Cocho', ativo: true, coordenadas: LUGAR_4 };
    const sa = { id: 'sa', empresa_id: EMPRESA, nome_ponto: 'COCHO A', categoria_ponto: 'COCHO', status: 'Ativo', coordenadas: LUGAR_4 };
    const sb = { id: 'sb', empresa_id: EMPRESA, nome_ponto: 'COCHO B', categoria_ponto: 'COCHO', status: 'Ativo', coordenadas: LUGAR_4 };
    expect(resolverSuplementacaoDoPonto(pa, [sa, sb], { outrosPontos: [pa, pb] }).registro?.id).toBe('sa');
    expect(resolverSuplementacaoDoPonto(pb, [sa, sb], { outrosPontos: [pa, pb] }).registro?.id).toBe('sb');
  });

  it('LO7 — a lista do Cadastro de Pontos mostra o depósito só no nº 4', () => {
    const linhas = pontosComDetalhes(PONTOS, SUPL, []);
    const porId = Object.fromEntries(linhas.map((l) => [l.id, l.detalhe_suplementacao?.id ?? null]));
    expect(porId).toEqual({ p1: null, p4: 'dep1', p5: 'coc2' });
  });
});

const api = {
  listPontos: vi.fn(), deletePonto: vi.fn(),
  listPontosSuplementacao: vi.fn(), deletePontoSuplementacao: vi.fn(), updatePontoSuplementacao: vi.fn(),
  listBebedouros: vi.fn(),
};
vi.mock('@/apis/mapa', () => api);
vi.mock('@/apis/lotes', () => ({}));
vi.mock('@/apis/tarefas', () => ({}));
vi.mock('@/apis/rebanho', () => ({}));
vi.mock('@/apis/estoque', () => ({ listLocais: vi.fn() }));
const elegibilidade = vi.fn();
vi.mock('@/apis/pontos-suplementacao', () => ({ consultarElegibilidadeExclusaoPontoSuplementacao: elegibilidade }));
vi.mock('@/apis/bebedouros', () => ({ consultarElegibilidadeExclusaoBebedouro: vi.fn() }));

describe('exclusão do ponto nº 1 em produção', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listPontos.mockResolvedValue(PONTOS);
    api.listPontosSuplementacao.mockResolvedValue(SUPL);
    api.listBebedouros.mockResolvedValue([]);
    elegibilidade.mockResolvedValue({ pode_excluir: true, motivos: [] });
  });

  it('LO8 — exclui só o ponto nº 1; o depósito do nº 4 não é tocado nem consultado', async () => {
    const { excluirPontoComCascata } = await import('@/services/mapaService');
    const r = await excluirPontoComCascata('p1', EMPRESA, ponto1);
    expect(api.deletePonto).toHaveBeenCalledWith('p1');
    expect(api.deletePontoSuplementacao).not.toHaveBeenCalled();
    expect(elegibilidade).not.toHaveBeenCalled();
    expect(r.pontosSuplementacaoRemovidos).toBe(0);
  });

  it('LO9 — excluir o nº 4 continua levando o próprio depósito (sem histórico)', async () => {
    const { excluirPontoComCascata } = await import('@/services/mapaService');
    await excluirPontoComCascata('p4', EMPRESA, ponto4);
    expect(api.deletePontoSuplementacao).toHaveBeenCalledWith('dep1');
    expect(api.deletePonto).toHaveBeenCalledWith('p4');
  });
});
