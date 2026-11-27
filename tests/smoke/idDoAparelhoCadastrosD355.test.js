/**
 * D-PROD-355 — área, ponto de referência, linha e setor nascem no celular com o id definitivo (UUID) e o mandam na
 * criação; repetir a criação (resposta perdida com o sinal fraco) não grava em dobro. O servidor:
 * backend/tests/idDoAparelhoCadastrosD355.test.mjs.
 *
 *  IC-01 a criação manda o id do aparelho; id que não é do aparelho não vai
 *  IC-02 as portas pedem o id do aparelho (sem internet, o registro nasce com UUID)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const nativeRequest = vi.fn(async (_c, o) => ({ ...(o?.body ?? {}) }));
vi.mock('@/apis/_core/nativeHttpClient.js', async (original) => ({ ...(await original()), nativeRequest: (...a) => nativeRequest(...a) }));

const UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

beforeEach(() => nativeRequest.mockClear());

describe('D-PROD-355 — id do aparelho nos cadastros do mapa', () => {
  it('IC-01 a criação manda o id do aparelho', async () => {
    const { operacoesNativas: area } = await import('@/apis/areas/areaPastagemNativePort');
    const { operacoesNativas: setor } = await import('@/apis/setores/setorNativePort');
    const geo = await import('@/apis/mapaGeografia/mapaGeografiaNativePort');
    await area.create({ id: UUID, empresa_id: 'e1', setor_id: 's1', nome: 'P1', tamanho_hectares: 1 });
    await setor.create({ id: UUID, empresa_id: 'e1', nome: 'RETIRO', tipo: 'Próprio' });
    await geo.pontoReferenciaPort.create({ id: UUID, empresa_id: 'e1', nome: 'PORTEIRA', tipo: 'PORTEIRA' });
    await geo.linhaGeograficaPort.create({ id: UUID, empresa_id: 'e1', nome: 'CERCA', tipo: 'Cerca' });
    const posts = nativeRequest.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(posts.map((c) => c[1].body.id)).toEqual([UUID, UUID, UUID, UUID]);
    nativeRequest.mockClear();
    await setor.create({ id: 'offline_Setor_1', empresa_id: 'e1', nome: 'X', tipo: 'Próprio' });
    expect(nativeRequest.mock.calls[0][1].body.id).toBeUndefined();
  });

  it('IC-02 as portas pedem o id do aparelho', () => {
    const contar = (arquivo) => (readFileSync(arquivo, 'utf8').match(/idDoAparelho: true/g) ?? []).length;
    expect(contar('src/apis/areas/areaPastagemNativePort.js')).toBe(1);
    expect(contar('src/apis/setores/setorNativePort.js')).toBe(1);
    expect(contar('src/apis/mapaGeografia/mapaGeografiaNativePort.js')).toBe(2);
  });
});
