/**
 * Rastreio do trajeto (GPS fase 1) — o service com a porta da API mockada: a rota que não existe no servidor de produção
 * (erro sem código de negócio) vira `{ estado: 'indisponivel' }`; recusa de negócio e falta de rede são lançadas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import * as atividades from '@/apis/atividades';
import { abrirTrajeto, enviarPontos, encerrarTrajeto, listarTrajetosDoDiaDaAtividade, ehRotaIndisponivel } from '@/services/trajetoGpsService';

vi.mock('@/apis/atividades', async (importOriginal) => ({
  ...(await importOriginal()),
  abrirTrajeto: vi.fn(),
  enviarPontosTrajeto: vi.fn(),
  encerrarTrajeto: vi.fn(),
  listarTrajetosDoDia: vi.fn(),
}));

const erro = (code, extra = {}) => new ApiError(code, { operation: 'x', resource: 'Trajeto', ...extra });
const ABRIR = { atividadeId: 'at-1', empresaId: 'emp-1', bemId: 'bem-1', dataOperacional: '2026-11-26', operationId: 'op-abcdefgh' };

beforeEach(() => {
  vi.mocked(atividades.abrirTrajeto).mockReset();
  vi.mocked(atividades.enviarPontosTrajeto).mockReset();
  vi.mocked(atividades.encerrarTrajeto).mockReset();
  vi.mocked(atividades.listarTrajetosDoDia).mockReset();
});

describe('trajetoGpsService — degradação', () => {
  it('rota inexistente (erro sem código de negócio) vira indisponível em todas as funções', async () => {
    vi.mocked(atividades.abrirTrajeto).mockRejectedValue(erro(API_ERROR_CODES.OPERATION_FAILED));
    vi.mocked(atividades.enviarPontosTrajeto).mockRejectedValue(erro(API_ERROR_CODES.OPERATION_FAILED));
    vi.mocked(atividades.encerrarTrajeto).mockRejectedValue(erro(API_ERROR_CODES.OPERATION_FAILED));
    vi.mocked(atividades.listarTrajetosDoDia).mockRejectedValue(erro(API_ERROR_CODES.OPERATION_FAILED));

    expect(await abrirTrajeto(ABRIR)).toEqual({ estado: 'indisponivel' });
    expect(await enviarPontos({ atividadeId: 'at-1', trajetoId: 't', empresaId: 'emp-1', pontos: [] })).toEqual({ estado: 'indisponivel' });
    expect(await encerrarTrajeto({ atividadeId: 'at-1', trajetoId: 't', empresaId: 'emp-1' })).toEqual({ estado: 'indisponivel' });
    expect(await listarTrajetosDoDiaDaAtividade({ atividadeId: 'at-1', empresaId: 'emp-1', dia: '2026-11-26' })).toEqual({ estado: 'indisponivel' });
    expect(ehRotaIndisponivel(erro(API_ERROR_CODES.OPERATION_FAILED))).toBe(true);
  });

  it('recusa de negócio (TRAJETO_ABERTO) é lançada para a tela mostrar a mensagem', async () => {
    vi.mocked(atividades.abrirTrajeto).mockRejectedValue(erro(API_ERROR_CODES.TRAJETO_ABERTO, { details: { trajeto_id: 'tj-1' } }));
    await expect(abrirTrajeto(ABRIR)).rejects.toMatchObject({ code: API_ERROR_CODES.TRAJETO_ABERTO });
  });

  it('falta de rede é lançada (o buffer fica e tenta de novo; não vira indisponível)', async () => {
    vi.mocked(atividades.enviarPontosTrajeto).mockRejectedValue(erro(API_ERROR_CODES.PROVIDER_UNAVAILABLE));
    await expect(enviarPontos({ atividadeId: 'at-1', trajetoId: 't', empresaId: 'emp-1', pontos: [] })).rejects.toMatchObject({
      code: API_ERROR_CODES.PROVIDER_UNAVAILABLE,
    });
  });
});

describe('trajetoGpsService — corpo enviado', () => {
  it('abrir manda só o que existe: sem implemento nem apontamento quando não houver', async () => {
    vi.mocked(atividades.abrirTrajeto).mockResolvedValue({ trajeto: { id: 'tj-1' }, replay: false });
    const r = await abrirTrajeto(ABRIR);
    expect(r).toEqual({ estado: 'ok', trajeto: { id: 'tj-1' }, replay: false });
    expect(vi.mocked(atividades.abrirTrajeto).mock.calls[0][1]).toEqual({
      empresa_id: 'emp-1',
      bem_id: 'bem-1',
      data_operacional: '2026-11-26',
      operation_id: 'op-abcdefgh',
    });
  });

  it('abrir manda implemento e apontamento quando o operador já os tem', async () => {
    vi.mocked(atividades.abrirTrajeto).mockResolvedValue({ trajeto: { id: 'tj-1' }, replay: true });
    await abrirTrajeto({ ...ABRIR, implementoBemId: 'imp-1', apontamentoId: 'ap-1' });
    expect(vi.mocked(atividades.abrirTrajeto).mock.calls[0][1]).toMatchObject({ implemento_bem_id: 'imp-1', apontamento_id: 'ap-1' });
  });
});
