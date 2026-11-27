/**
 * D-PROD-357 — as fotos tiradas sem internet sobem em partes que cabem no envio (o servidor aceita até 4 MB por
 * tarefa enviada). Antes iam todas num pedido só: muitas fotos passavam do limite, o servidor recusava e elas ficavam
 * em "precisa de atenção".
 *
 *  FP-01 a divisão: cada parte cabe no limite; a foto maior que o limite vai sozinha; a ordem se mantém
 *  FP-02 a passada manda várias partes; cada parte só sai do aparelho com a resposta dela; parte sem resposta fica
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const LIMITE = Math.floor(3.5 * 1024 * 1024);
const url = (kb, n) => `data:image/jpeg;base64,${String(n).padEnd(kb * 1024, 'A')}`;

let guardadas = [];
const apagadas = [];
const pedidos = [];
let respostaOffline = new Set();

vi.mock('@/components/offline/IndexedDBManager', () => ({
  getAllPendingTarefaImages: async () => guardadas.map((g) => ({ ...g })),
  getTarefaImagesOffline: async () => guardadas.map((g) => ({ ...g })),
  putTarefaImageOffline: async (f) => {
    guardadas = guardadas.map((g) => (g._imgId === f._imgId ? { ...f } : g));
  },
  deleteTarefaImageOffline: async (id) => {
    apagadas.push(id);
    guardadas = guardadas.filter((g) => g._imgId !== id);
  },
  saveTarefaImageOffline: async () => undefined,
}));
vi.mock('@/services/tarefasMapaService', () => ({
  enviarAnexo: async () => ({ file_url: 'nunca' }),
  registrarFotosQueSubiram: () => undefined,
  atualizarTarefa: async (id, dados) => {
    pedidos.push(dados.fotos_adicionar.length);
    if (respostaOffline.has(pedidos.length)) return { id, _isOffline: true };
    return { id, fotos: dados.fotos_adicionar };
  },
}));
vi.mock('@/lib/offline/offlineEntityRuntime', () => ({
  idsComCriacaoPendenteNaFilaDeEntidades: async () => new Set(),
  idsComPendenciaNaFilaDeEntidades: async () => new Set(),
}));
vi.mock('@/lib/offline/sincronizacao/gatilhosDeSincronizacao', () => ({ registrarPassadaExtra: () => undefined }));

beforeEach(() => {
  apagadas.length = 0;
  pedidos.length = 0;
  respostaOffline = new Set();
});

describe('D-PROD-357 — fotos em partes', () => {
  it('FP-01 cada parte cabe; a foto grande vai sozinha; a ordem se mantém', async () => {
    const { emPartesQueCabem } = await import('@/services/fotosDeTarefaAguardandoService');
    const urls = [url(1500, 1), url(1500, 2), url(1500, 3), url(4000, 4), url(100, 5)];
    const fotos = urls.map((_, i) => ({ _imgId: i + 1 }));
    const partes = emPartesQueCabem(fotos, urls);
    expect(partes.map((p) => p.fotos.map((f) => f._imgId))).toEqual([[1, 2], [3], [4], [5]]);
    for (const p of partes.filter((p) => p.urls.length > 1)) {
      expect(p.urls.reduce((s, u) => s + u.length, 0)).toBeLessThanOrEqual(LIMITE);
    }
  });

  it('FP-02 várias partes; cada uma só sai do aparelho com a resposta dela', async () => {
    const fotos = await import('@/services/fotosDeTarefaAguardandoService');
    guardadas = [1, 2, 3].map((n) => ({ _imgId: n, tarefa_offline_id: 'tarefa:t1', url_enviada: url(1500, n), name: `f${n}.jpg` }));
    // A segunda parte fica sem resposta (vai para a fila): a foto dela continua no aparelho.
    respostaOffline = new Set([2]);
    const r = await fotos.enviarFotosDeTarefasGuardadas();
    expect(pedidos).toEqual([2, 1]);
    expect(apagadas).toEqual([1, 2]);
    expect(guardadas.map((g) => g._imgId)).toEqual([3]);
    expect(r.enviadas).toBe(1);
  });
});
