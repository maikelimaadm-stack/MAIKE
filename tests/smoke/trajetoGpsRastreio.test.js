/**
 * Rastreio do trajeto (GPS fase 1) — o hook `useRastreioGps` com `navigator.geolocation` mockado e o service na fronteira:
 *  - filtro (precisão, salto) e amostragem antes do buffer;
 *  - envio em lotes de até 200, reenvio sem duplicar (mesmo seq) e apagar do buffer só depois do 200;
 *  - degradação: rota inexistente (404) desliga o rastreio e não tenta de novo na sessão;
 *  - "Encerrar o dia": envia o resto e encerra; sem rede, não encerra com pontos pendentes;
 *  - não liga o GPS sozinho; retoma o trajeto aberto desta atividade depois de recarregar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { useRastreioGps } from '@/hooks/useRastreioGps';
import * as trajetoGps from '@/services/trajetoGpsService';
import {
  AVISO_SEM_ROTA,
  enviarPendentes,
  encerrarRastreioDoDia,
  resetarRastreioParaTestes,
} from '@/lib/trajetoGpsControlador';
import { listarPontosDoTrajeto, limparBufferDeTesteGps } from '@/lib/offline/trajetoPontosOffline';

vi.mock('@/services/trajetoGpsService', async (importOriginal) => ({
  ...(await importOriginal()),
  abrirTrajeto: vi.fn(),
  enviarPontos: vi.fn(),
  encerrarTrajeto: vi.fn(),
}));

const T0 = Date.UTC(2026, 10, 26, 12, 0, 0);
const CTX = { atividadeId: 'at-1', empresaId: 'emp-1', bemId: 'bem-1', dataOperacional: '2026-11-26' };
/** Desloca a latitude em metros (1 grau ≈ 111.320 m). */
const deslocar = (lat, metros) => lat + metros / 111320;
const leitura = (lat, lng, em, accuracy = 5) => ({ coords: { latitude: lat, longitude: lng, accuracy, speed: null }, timestamp: em });
const erroDeRede = () => new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'enviarPontosTrajeto', resource: 'Trajeto' });

let watch;
const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});
/** Uma leitura do GPS chegando (o watch do navegador), dentro do act: o estado da tela atualiza. */
const enviarGps = async (pos) => {
  await act(async () => {
    watch.ok(pos);
    await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  resetarRastreioParaTestes();
  limparBufferDeTesteGps();
  watch = null;
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok, erro) => {
        watch = { ok, erro };
        return 9;
      }),
      clearWatch: vi.fn(),
    },
  });
  vi.mocked(trajetoGps.abrirTrajeto).mockReset().mockResolvedValue({ estado: 'ok', trajeto: { id: 'tj-1' }, replay: false });
  vi.mocked(trajetoGps.enviarPontos).mockReset().mockResolvedValue({ estado: 'ok', recebidos: 0, novos: 0 });
  vi.mocked(trajetoGps.encerrarTrajeto).mockReset().mockResolvedValue({ estado: 'ok', trajeto: { id: 'tj-1' }, replay: false });
});

describe('useRastreioGps — filtro, buffer e envio', () => {
  it('aplica o filtro (precisão e salto) e guarda só os pontos aceitos no buffer', async () => {
    const { result } = renderHook(() => useRastreioGps('at-1'));
    await act(async () => {
      await result.current.iniciar(CTX);
    });
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);

    await enviarGps(leitura(-15, -59, T0, 8)); // entra (seq 1)
    await enviarGps(leitura(-15.0001, -59, T0 + 3000, 120)); // precisão 120 m: descarta
    await enviarGps(leitura(deslocar(-15, 30), -59, T0 + 12000, 5)); // 30 m em 12 s: entra (seq 2)
    await enviarGps(leitura(deslocar(-15, 5000), -59, T0 + 14000, 5)); // 5 km em 2 s: salto, descarta

    expect(result.current.pendentes).toBe(2);
    expect(result.current.linha).toHaveLength(2);
    expect(result.current.distanciaM).toBeCloseTo(30, 0);
    const buffer = await listarPontosDoTrajeto('tj-1');
    expect(buffer.map((p) => p.seq)).toEqual([1, 2]);
  });

  it('envia em lotes de até 200 e só apaga do buffer depois do sucesso; reenvio usa os mesmos seq', async () => {
    const { result } = renderHook(() => useRastreioGps('at-1'));
    await act(async () => {
      await result.current.iniciar(CTX);
    });
    // 201 pontos: a cada 11 s e 20 m (1,8 m/s, abaixo do salto).
    for (let i = 0; i < 201; i += 1) {
      await enviarGps(leitura(deslocar(-15, i * 20), -59, T0 + i * 11000, 5));
    }
    expect(result.current.pendentes).toBe(201);

    // Primeiro lote falha por falta de rede: nada sai do buffer.
    vi.mocked(trajetoGps.enviarPontos).mockRejectedValueOnce(erroDeRede());
    await act(async () => {
      await enviarPendentes();
    });
    expect(result.current.pendentes).toBe(201);
    expect(await listarPontosDoTrajeto('tj-1')).toHaveLength(201);

    // Depois, o servidor responde 200: envia em dois lotes (200 e 1) e zera o buffer.
    vi.mocked(trajetoGps.enviarPontos).mockResolvedValue({ estado: 'ok', recebidos: 200, novos: 200 });
    await act(async () => {
      await enviarPendentes();
    });
    // Chamadas: [o lote de 200 que falhou, o 1º lote de 200 que deu certo, o lote de 1].
    const chamadas = vi.mocked(trajetoGps.enviarPontos).mock.calls;
    expect(chamadas.map((c) => c[0].pontos.length)).toEqual([200, 200, 1]);
    expect(chamadas[1][0].pontos[0].seq).toBe(1);
    expect(chamadas[2][0].pontos[0].seq).toBe(201);
    expect(result.current.pendentes).toBe(0);
    expect(await listarPontosDoTrajeto('tj-1')).toEqual([]);
  });

  it('o reenvio do mesmo lote manda os mesmos seq (o servidor não duplica)', async () => {
    const { result } = renderHook(() => useRastreioGps('at-1'));
    await act(async () => {
      await result.current.iniciar(CTX);
    });
    await enviarGps(leitura(-15, -59, T0, 5));
    await enviarGps(leitura(deslocar(-15, 30), -59, T0 + 12000, 5));

    vi.mocked(trajetoGps.enviarPontos).mockRejectedValueOnce(erroDeRede()).mockResolvedValue({ estado: 'ok', recebidos: 2, novos: 0 });
    await act(async () => {
      await enviarPendentes();
    });
    await act(async () => {
      await enviarPendentes();
    });
    const [primeiro, segundo] = vi.mocked(trajetoGps.enviarPontos).mock.calls.map((c) => c[0].pontos.map((p) => p.seq));
    expect(primeiro).toEqual([1, 2]);
    expect(segundo).toEqual([1, 2]);
    expect(result.current.pendentes).toBe(0);
  });
});

describe('useRastreioGps — degradação e encerramento', () => {
  it('rota inexistente (404) desliga o rastreio com aviso e não tenta de novo na sessão', async () => {
    vi.mocked(trajetoGps.abrirTrajeto).mockResolvedValue({ estado: 'indisponivel' });
    const { result } = renderHook(() => useRastreioGps('at-1'));
    let r;
    await act(async () => {
      r = await result.current.iniciar(CTX);
    });
    expect(r).toEqual({ estado: 'indisponivel' });
    expect(result.current.indisponivel).toBe(true);
    expect(result.current.aviso).toBe(AVISO_SEM_ROTA);
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();

    await act(async () => {
      r = await result.current.iniciar(CTX);
    });
    expect(r).toEqual({ estado: 'indisponivel' });
    expect(trajetoGps.abrirTrajeto).toHaveBeenCalledTimes(1);
  });

  it('"Encerrar o dia" envia o que falta, encerra o trajeto e para o GPS', async () => {
    const { result } = renderHook(() => useRastreioGps('at-1'));
    await act(async () => {
      await result.current.iniciar(CTX);
    });
    await enviarGps(leitura(-15, -59, T0, 5));
    await enviarGps(leitura(deslocar(-15, 30), -59, T0 + 12000, 5));

    let r;
    await act(async () => {
      r = await encerrarRastreioDoDia();
    });
    expect(r).toEqual({ estado: 'ok' });
    expect(trajetoGps.encerrarTrajeto).toHaveBeenCalledTimes(1);
    expect(navigator.geolocation.clearWatch).toHaveBeenCalled();
    expect(result.current.aberto).toBe(false);
    expect(localStorage.getItem('maike.diario.trajetoGps')).toBeNull();
  });

  it('sem rede, não encerra o trajeto com pontos pendentes (o servidor recusaria o resto)', async () => {
    const { result } = renderHook(() => useRastreioGps('at-1'));
    await act(async () => {
      await result.current.iniciar(CTX);
    });
    await enviarGps(leitura(-15, -59, T0, 5));
    await enviarGps(leitura(deslocar(-15, 30), -59, T0 + 12000, 5));
    vi.mocked(trajetoGps.enviarPontos).mockRejectedValue(erroDeRede());

    let r;
    await act(async () => {
      r = await encerrarRastreioDoDia();
    });
    expect(r).toEqual({ estado: 'pendente' });
    expect(trajetoGps.encerrarTrajeto).not.toHaveBeenCalled();
    expect(result.current.aberto).toBe(true);
    expect(result.current.pendentes).toBe(2);
  });
});

describe('useRastreioGps — quando liga e retomada', () => {
  it('não liga o GPS sozinho ao abrir a tela', () => {
    renderHook(() => useRastreioGps('at-1'));
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
    expect(trajetoGps.abrirTrajeto).not.toHaveBeenCalled();
  });

  it('retoma o trajeto aberto DESTA atividade depois de recarregar (lido do aparelho), sem criar trajeto novo', async () => {
    localStorage.setItem(
      'maike.diario.trajetoGps',
      JSON.stringify({
        trajetoId: 'tj-9',
        atividadeId: 'at-1',
        empresaId: 'emp-1',
        bemId: 'bem-1',
        dataOperacional: '2026-11-26',
        implementoBemId: null,
        apontamentoId: null,
        operationId: 'op-1234567',
        seq: 4,
        distanciaM: 500,
        desejado: true,
        encerrarPendente: false,
      }),
    );
    const { result } = renderHook(() => useRastreioGps('at-1'));
    await flush();
    expect(result.current.trajeto.trajetoId).toBe('tj-9');
    expect(result.current.gravando).toBe(true);
    expect(result.current.distanciaM).toBe(500);
    expect(trajetoGps.abrirTrajeto).not.toHaveBeenCalled();
  });

  it('não retoma trajeto de outra atividade', async () => {
    localStorage.setItem(
      'maike.diario.trajetoGps',
      JSON.stringify({ trajetoId: 'tj-9', atividadeId: 'at-OUTRA', empresaId: 'emp-1', bemId: 'bem-1', dataOperacional: '2026-11-26', implementoBemId: null, apontamentoId: null, operationId: 'op-1234567', seq: 1, distanciaM: 0, desejado: true, encerrarPendente: false }),
    );
    const { result } = renderHook(() => useRastreioGps('at-1'));
    await flush();
    expect(result.current.aberto).toBe(false);
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  });
});
