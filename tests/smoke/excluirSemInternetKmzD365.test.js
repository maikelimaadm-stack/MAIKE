/**
 * D-PROD-365 — cadastrar no mapa como no AgriWebb, etapa 5:
 *  - KMZ (KML compactado do Google Earth/AgriWebb) abre no aparelho e importa como o KML;
 *  - sem internet, excluir pasto (e ponto ligado a cocho/depósito/bebedouro) não faz nada pela metade: avisa que
 *    precisa de conexão (o histórico só o servidor tem); ponto simples e linha continuam indo para a fila.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zipSync } from 'fflate';
/** Bytes no `Uint8Array` do ambiente de teste (o `fflate` só reconhece arquivo pelo `instanceof` dele). */
const u8 = (texto) => Uint8Array.from(Buffer.from(texto));

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
const E = 'emp-1';
const AQUI = { lat: -15.1, lng: -56.1 };
const KML = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>PASTO 1</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-56.1,-15.1 -56.09,-15.1 -56.09,-15.11 -56.1,-15.11 -56.1,-15.1</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>';

let online = true;
const onLineOriginal = Object.getOwnPropertyDescriptor(navigator, 'onLine');
beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [...Object.values(api), ...Object.values(lotes), ...Object.values(tarefas), ...Object.values(rebanho)]) fn.mockResolvedValue([]);
  lotes.listHistoricoMovimentacoesPagina.mockResolvedValue({ items: [], total: 0 });
  api.deletePonto.mockResolvedValue({});
  supl.consultarElegibilidadeExclusaoPontoSuplementacao.mockImplementation(async (id) => ({ id, pode_excluir: true, motivos: [] }));
  beb.consultarElegibilidadeExclusaoBebedouro.mockImplementation(async (id) => ({ id, pode_excluir: true, motivos: [] }));
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
});
afterEach(() => {
  if (onLineOriginal) Object.defineProperty(navigator, 'onLine', onLineOriginal);
  else delete navigator.onLine;
});

describe('D-PROD-365 — KMZ', () => {
  it('EK-01: abre o doc.kml de dentro do KMZ (imagens ficam de fora) e a importação lê as áreas', async () => {
    const { kmlDoKmz, eKmz } = await import('@/lib/geografia/kmz.js');
    const { lerArquivoDeAreas } = await import('@/lib/geografia/importacaoAreas.js');
    const kmz = zipSync({ 'files/foto.png': new Uint8Array([1, 2, 3]), 'outro.kml': u8('<kml/>'), 'doc.kml': u8(KML) });
    const r = kmlDoKmz(kmz);
    expect(r.ok).toBe(true);
    expect(r.nomeKml).toBe('doc.kml');
    const lido = lerArquivoDeAreas({ nomeArquivo: 'fazenda.kml', texto: r.texto });
    expect(lido.ok).toBe(true);
    expect(lido.contagem.areas).toBe(1);
    expect(eKmz('Fazenda.KMZ')).toBe(true);
    expect(eKmz('fazenda.kml')).toBe(false);
  });

  it('EK-02: KMZ sem KML ou danificado dá mensagem clara', async () => {
    const { kmlDoKmz } = await import('@/lib/geografia/kmz.js');
    expect(kmlDoKmz(zipSync({ 'a.png': new Uint8Array([1]) }))).toMatchObject({ ok: false, erro: expect.stringMatching(/não tem um arquivo \.kml/) });
    expect(kmlDoKmz(new Uint8Array([1, 2, 3, 4]))).toMatchObject({ ok: false, erro: expect.stringMatching(/danificado/) });
  });

  it('EK-03: a tela de importação aceita .kmz', async () => {
    const { readFileSync } = await import('node:fs');
    const tela = readFileSync('src/components/mapa/importacaoAreas/ImportarAreasDialog.jsx', 'utf8');
    expect(tela).toContain('accept=".kml,.kmz,.geojson,.json"');
    expect(tela).toContain('kmlDoKmz(');
  });
});

describe('D-PROD-365 — excluir sem internet', () => {
  it('EX-01: pasto sem internet: avisa que precisa de conexão e não desativa nada', async () => {
    online = false;
    api.listAreas.mockResolvedValue([{ id: 'a1', empresa_id: E, nome: 'PASTO 1' }]);
    const erro = await mapaService.excluirArea('a1', E).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.OFFLINE_DELETE_FORBIDDEN)).toBe(true);
    expect(api.updateArea).not.toHaveBeenCalled();
    expect(lotes.listHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
  });

  it('EX-02: com internet, o pasto sem vínculo sai como antes', async () => {
    api.listAreas.mockResolvedValue([{ id: 'a1', empresa_id: E, nome: 'PASTO 1' }]);
    await mapaService.excluirArea('a1', E);
    expect(api.updateArea).toHaveBeenCalledWith('a1', { ativo: false });
  });

  it('EX-03: ponto ligado a cocho sem internet: avisa e não apaga nada', async () => {
    online = false;
    const ponto = { id: 'p1', empresa_id: E, nome: 'COCHO 1', tipo: 'COCHO', coordenadas: AQUI };
    api.listPontos.mockResolvedValue([ponto]);
    api.listPontosSuplementacao.mockResolvedValue([{ id: 'c1', empresa_id: E, status: 'Ativo', nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', coordenadas: AQUI }]);
    const erro = await mapaService.excluirPontoComCascata('p1', E, ponto).catch((e) => e);
    expect(hasApiErrorCode(erro, API_ERROR_CODES.OFFLINE_DELETE_FORBIDDEN)).toBe(true);
    expect(api.deletePonto).not.toHaveBeenCalled();
    expect(api.deletePontoSuplementacao).not.toHaveBeenCalled();
  });

  it('EX-04: ponto simples sem internet segue para a fila (deletePonto), como antes', async () => {
    online = false;
    const ponto = { id: 'p2', empresa_id: E, nome: 'PORTEIRA', tipo: 'PORTEIRA', coordenadas: AQUI };
    api.listPontos.mockResolvedValue([ponto]);
    await mapaService.excluirPontoComCascata('p2', E, ponto);
    expect(api.deletePonto).toHaveBeenCalledWith('p2');
  });
});
