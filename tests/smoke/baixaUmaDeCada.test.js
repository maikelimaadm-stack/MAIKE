/**
 * D-PROD-307 — "Baixar dados" uma de cada vez, presa à conta, envio antes, formato dos dados.
 *
 * BX-01 duas baixas pedidas juntas (automática + "Sincronizar agora") viram UMA: um envio,
 *       uma leitura de cada parte, o mesmo resultado para os dois.
 * BX-02 pediu OUTRA fazenda durante a baixa: espera e baixa a pedida (não recebe a errada).
 * BX-03 outra conta entrou no meio: não marca nada como baixado.
 * BX-04 nada veio: não marca "baixado".
 * BX-05 formato dos dados: baixa completa marca o formato desta versão; logout esquece.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const chamadas = vi.hoisted(() => ({ envio: 0, mapa: [], cadastros: 0, telas: 0, segurar: null, falhaTudo: false, aoBaixarMapa: null }));

vi.mock('@/lib/offline/sincronizacao/gatilhosDeSincronizacao', () => ({
  sincronizarTudo: vi.fn(async () => {
    chamadas.envio += 1;
  }),
}));
vi.mock('@/services/mapaCacheService', () => ({
  CACHE_KEYS: ['areas', 'pontos'],
  refreshMapaCacheEntryDetalhado: vi.fn(async (chave, empresaId) => {
    chamadas.mapa.push(`${chave}@${empresaId}`);
    if (chamadas.segurar) await chamadas.segurar;
    chamadas.aoBaixarMapa?.();
    return chamadas.falhaTudo ? { erro: 'X' } : { dados: [] };
  }),
}));
vi.mock('@/apis/offline', () => ({
  carregarTodasAsPortas: vi.fn(async () => undefined),
  baixarEntidadesParaOffline: vi.fn(async () => {
    chamadas.cadastros += 1;
    return chamadas.falhaTudo ? { total: 3, falhas: ['a', 'b', 'c'] } : { total: 3, falhas: [] };
  }),
  baixarLeiturasDasTelas: vi.fn(async () => {
    chamadas.telas += 1;
    return chamadas.falhaTudo ? { total: 2, falhas: 2 } : { total: 2, falhas: 0 };
  }),
}));
vi.mock('@/lib/offline/respostasOffline', () => ({ esquecerRespostasDoTenant: vi.fn(async () => undefined) }));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => []) }));

const { setOfflineTenant } = await import('@/lib/offline/offlineTenant');
const servico = await import('@/services/dadosOfflineService');

beforeEach(() => {
  Object.assign(chamadas, { envio: 0, mapa: [], cadastros: 0, telas: 0, segurar: null, falhaTudo: false, aoBaixarMapa: null });
  localStorage.clear();
  setOfflineTenant('cli-1');
});

describe('D-PROD-307 — baixa de dados', () => {
  it('BX-01 duas baixas juntas viram uma (um envio, uma leitura de cada parte)', async () => {
    const progressoA = vi.fn();
    const progressoB = vi.fn();
    const a = servico.baixarDadosParaOffline({ empresaId: 'emp-1', aoAvancar: progressoA });
    const b = servico.baixarDadosParaOffline({ empresaId: 'emp-1', aoAvancar: progressoB });
    expect(b).toBe(a);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
    expect(ra.ok).toBe(true);
    expect(chamadas.envio).toBe(1);
    expect(chamadas.mapa).toEqual(['areas@emp-1', 'pontos@emp-1']);
    expect(chamadas.cadastros).toBe(1);
    expect(chamadas.telas).toBe(1);
    expect(progressoA).toHaveBeenCalled();
    expect(progressoB).toHaveBeenCalled(); // quem chegou depois acompanha a mesma baixa
  });

  it('BX-02 outra fazenda pedida durante a baixa: espera e baixa a pedida', async () => {
    let soltar;
    chamadas.segurar = new Promise((r) => (soltar = r));
    const a = servico.baixarDadosParaOffline({ empresaId: 'emp-1' });
    const b = servico.baixarDadosParaOffline({ empresaId: 'emp-2' });
    expect(b).not.toBe(a);
    soltar();
    chamadas.segurar = null;
    await Promise.all([a, b]);
    expect(chamadas.mapa).toEqual(['areas@emp-1', 'pontos@emp-1', 'areas@emp-2', 'pontos@emp-2']);
  });

  it('BX-03 outra conta entrou no meio da baixa: não marca nada', async () => {
    chamadas.aoBaixarMapa = () => setOfflineTenant('cli-2');
    const r = await servico.baixarDadosParaOffline({ empresaId: 'emp-1' });
    expect(r.em).toBeNull();
    setOfflineTenant('cli-1');
    expect(servico.ultimaBaixaDosDados()).toBeNull();
    setOfflineTenant('cli-2');
    expect(servico.ultimaBaixaDosDados()).toBeNull();
  });

  it('BX-04 nada veio: não marca "baixado"', async () => {
    chamadas.falhaTudo = true;
    const r = await servico.baixarDadosParaOffline({ empresaId: 'emp-1' });
    expect(r).toMatchObject({ ok: false, em: null });
    expect(servico.ultimaBaixaDosDados()).toBeNull();
    expect(servico.dadosNoFormatoAtual()).toBe(false);
  });

  it('BX-05 baixa completa marca o formato desta versão; logout esquece', async () => {
    expect(servico.dadosNoFormatoAtual()).toBe(false);
    await servico.baixarDadosParaOffline({ empresaId: 'emp-1' });
    expect(servico.dadosNoFormatoAtual()).toBe(true);
    // versão anterior (sem a marca de formato): precisa baixar de novo
    localStorage.removeItem('maike_dados_offline_formato:cli-1');
    expect(servico.ultimaBaixaDosDados()).not.toBeNull();
    expect(servico.dadosNoFormatoAtual()).toBe(false);
    await servico.baixarDadosParaOffline({ empresaId: 'emp-1' });
    servico.esquecerDadosOfflineDoTenant('cli-1');
    expect(servico.dadosNoFormatoAtual()).toBe(false);
  });
});
