/**
 * D-PROD-344 — Fase 2 da sincronização: a área, o ponto de referência e a linha mandam a versão que a pessoa viu
 * (`versao_esperada`, como o lote e o cocho). O servidor confere: backend/tests/versaoCadastrosD344.test.mjs.
 *
 *  VA-01 a porta da área manda a versão junto dos campos; sem campos, não vai nada à rede (nem só a versão)
 *  VA-02 as portas do ponto e da linha mandam a versão
 *  VA-03 os formulários de área, ponto e linha passam o `updated_date` do registro aberto
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const nativeRequest = vi.fn(async (_c, o) => ({ id: 'x', ...(o?.body ?? {}) }));
vi.mock('@/apis/_core/nativeHttpClient.js', async (original) => ({ ...(await original()), nativeRequest: (...a) => nativeRequest(...a) }));

beforeEach(() => nativeRequest.mockClear());
afterEach(() => vi.restoreAllMocks());

describe('D-PROD-344 — a versão vai ao servidor', () => {
  it('VA-01 área: a versão vai junto dos campos; sem campos, nada vai à rede', async () => {
    const { operacoesNativas } = await import('@/apis/areas/areaPastagemNativePort');
    await operacoesNativas.update('a1', { nome: 'P1', versao_esperada: '2026-11-27T10:00:00.000Z' });
    expect(nativeRequest.mock.calls[0][1].body).toEqual({ nome: 'P1', versao_esperada: '2026-11-27T10:00:00.000Z' });
    nativeRequest.mockClear();
    expect(await operacoesNativas.update('a1', { versao_esperada: '2026-11-27T10:00:00.000Z' })).toEqual({ id: 'a1' });
    expect(nativeRequest).not.toHaveBeenCalled();
  });

  it('VA-02 ponto de referência e linha mandam a versão', async () => {
    const geo = await import('@/apis/mapaGeografia/mapaGeografiaNativePort');
    await geo.pontoReferenciaPort.update('p1', { nome: 'PORTEIRA', versao_esperada: 'v1' });
    await geo.linhaGeograficaPort.update('l1', { nome: 'CERCA', versao_esperada: 'v2' });
    const corpos = nativeRequest.mock.calls.filter((c) => c[1]?.method === 'PATCH').map((c) => c[1].body);
    expect(corpos).toEqual([
      { nome: 'PORTEIRA', versao_esperada: 'v1' },
      { nome: 'CERCA', versao_esperada: 'v2' },
    ]);
  });

  it('VA-03 os formulários passam a versão do registro aberto', async () => {
    const fs = await import('node:fs');
    for (const arquivo of ['src/components/mapa/FormularioArea.jsx', 'src/components/mapa/FormularioLinha.jsx']) {
      expect(fs.readFileSync(arquivo, 'utf8')).toMatch(/item\.updated_date \? \{ versao_esperada: item\.updated_date \}/);
    }
    expect(fs.readFileSync('src/components/mapa/FormularioPonto.jsx', 'utf8')).toMatch(/atualizarPonto\(item\.id, item\.updated_date \? \{ \.\.\.payloadPonto, versao_esperada: item\.updated_date \}/);
  });
});
