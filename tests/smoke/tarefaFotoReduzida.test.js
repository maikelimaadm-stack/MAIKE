/**
 * D-PROD-327 — a foto da tarefa é reduzida no celular antes de subir.
 *
 * FR-01 dimensões: cabe em 1600 px, mantém a proporção, não amplia
 * FR-02 foto grande: vira JPEG menor, no tamanho certo
 * FR-03 nunca piora: já pequena, não é imagem, SVG, sem canvas ou reduzida maior → o original
 * FR-04 todo envio de foto de tarefa passa pela redução (`enviarAnexo`)
 */
import { describe, it, expect, vi } from 'vitest';
import { dimensoesDaFoto, reduzirFoto, LADO_MAXIMO_FOTO } from '@/lib/imagens/reduzirFoto';

const arquivo = (tamanho, tipo = 'image/jpeg', nome = 'cam.jpg') => ({ size: tamanho, type: tipo, name: nome });
const imagem = (largura, altura) => vi.fn(async () => ({ largura, altura, desenhar: vi.fn(), liberar: vi.fn() }));
const canvasQueGera = (tamanho) => () => {
  const c = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (cb, tipo) => cb(new Blob([new Uint8Array(tamanho)], { type: tipo })) };
  return c;
};

describe('D-PROD-327 — foto reduzida', () => {
  it('FR-01 dimensões', () => {
    expect(dimensoesDaFoto(4000, 3000)).toEqual({ largura: 1600, altura: 1200 });
    expect(dimensoesDaFoto(3000, 4000)).toEqual({ largura: 1200, altura: 1600 });
    expect(dimensoesDaFoto(800, 600)).toEqual({ largura: 800, altura: 600 });
    expect(dimensoesDaFoto(0, 600)).toEqual({ largura: 0, altura: 0 });
    expect(LADO_MAXIMO_FOTO).toBe(1600);
  });

  it('FR-02 foto grande da câmera vira JPEG menor', async () => {
    let canvas;
    const criarCanvas = () => (canvas = canvasQueGera(300 * 1024)());
    const r = await reduzirFoto(arquivo(4 * 1024 * 1024), { carregar: imagem(4000, 3000), criarCanvas });
    expect(r.type).toBe('image/jpeg');
    expect(r.size).toBe(300 * 1024);
    expect(r.name).toBe('cam.jpg');
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
  });

  it('FR-03 nunca piora o envio', async () => {
    const pequena = arquivo(200 * 1024);
    expect(await reduzirFoto(pequena, { carregar: imagem(1200, 900), criarCanvas: canvasQueGera(10) })).toBe(pequena);
    const pdf = arquivo(5e6, 'application/pdf', 'a.pdf');
    expect(await reduzirFoto(pdf)).toBe(pdf);
    const svg = arquivo(5e6, 'image/svg+xml', 'a.svg');
    expect(await reduzirFoto(svg)).toBe(svg);
    const grande = arquivo(3e6);
    expect(await reduzirFoto(grande, { carregar: vi.fn(async () => { throw new Error('sem decodificar'); }) }), 'não abre').toBe(grande);
    expect(await reduzirFoto(grande, { carregar: imagem(4000, 3000), criarCanvas: () => ({ getContext: () => null }) }), 'sem canvas').toBe(grande);
    expect(await reduzirFoto(grande, { carregar: imagem(4000, 3000), criarCanvas: canvasQueGera(4e6) }), 'reduzida maior').toBe(grande);
    expect(await reduzirFoto(null)).toBe(null);
  });

  it('FR-04 o envio de foto de tarefa passa pela redução', async () => {
    vi.resetModules();
    const uploadArquivo = vi.fn(async () => ({ file_url: 'data:image/jpeg;base64,AA' }));
    const reduzida = { size: 1, type: 'image/jpeg', name: 'cam.jpg' };
    vi.doMock('@/apis/arquivos', () => ({ uploadArquivo }));
    vi.doMock('@/lib/imagens/reduzirFoto', () => ({ reduzirFoto: vi.fn(async () => reduzida) }));
    const { enviarAnexo } = await import('@/services/tarefasMapaService');
    await enviarAnexo({ file: arquivo(4e6) });
    expect(uploadArquivo).toHaveBeenCalledWith({ file: reduzida });
    vi.doUnmock('@/apis/arquivos');
    vi.doUnmock('@/lib/imagens/reduzirFoto');
  });
});
