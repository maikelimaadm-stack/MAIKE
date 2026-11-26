/**
 * Buffer dos pontos do rastreio do trajeto no aparelho (GPS fase 1).
 *
 * Cada ponto gravado fica aqui ANTES de ser enviado, e só sai depois do 200 do servidor (o envio apaga o lote que deu
 * certo). A chave é `trajetoId|seq`: gravar de novo o mesmo ponto não duplica.
 *
 * Padrão do `respostasOffline.js`: IndexedDB próprio. Sem IndexedDB (navegador restrito, teste em Node/jsdom) o buffer
 * vira memória do aparelho: o que já gravou continua na sessão, mas se o app fechar sem enviar, esses pontos se perdem.
 * Isso fica registrado no relatório da fase 1.
 */

const BANCO = 'maike_trajeto_gps';
const LOJA = 'pontos';
const VERSAO = 1;

/** @type {Promise<IDBDatabase|null>|null} */
let abrindo = null;
/** Fallback sem IndexedDB: chave -> ponto. */
const memoria = new Map();

const chaveDe = (trajetoId, seq) => `${trajetoId}|${seq}`;

const abrir = () => {
  if (abrindo) return abrindo;
  abrindo = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        resolve(null);
        return;
      }
      const pedido = indexedDB.open(BANCO, VERSAO);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains(LOJA)) {
          const loja = db.createObjectStore(LOJA, { keyPath: 'chave' });
          loja.createIndex('trajeto', 'trajetoId', { unique: false });
        }
      };
      pedido.onsuccess = () => resolve(pedido.result);
      pedido.onerror = () => resolve(null);
      pedido.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return abrindo;
};

/**
 * Roda uma operação numa transação e devolve o resultado do pedido (ou `undefined` se o IndexedDB não existe).
 * @param {'readonly'|'readwrite'} modo @param {(loja: IDBObjectStore) => IDBRequest|void} operar
 */
const comLoja = async (modo, operar) => {
  const db = await abrir();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(LOJA, modo);
      const pedido = operar(tx.objectStore(LOJA));
      tx.oncomplete = () => resolve(pedido ? pedido.result : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
};

/**
 * Guarda pontos de um trajeto (sobrescreve o mesmo seq). Nunca lança.
 * @param {string} trajetoId @param {Array<{ seq: number, lat: number, lng: number, precisao_m: number | null, velocidade_ms: number | null, em: number }>} pontos
 */
export const gravarPontosDoTrajeto = async (trajetoId, pontos) => {
  if (!trajetoId || !pontos.length) return;
  const linhas = pontos.map((p) => ({ chave: chaveDe(trajetoId, p.seq), trajetoId, ...p }));
  if (!(await abrir())) {
    for (const l of linhas) memoria.set(l.chave, l);
    return;
  }
  await comLoja('readwrite', (loja) => {
    for (const l of linhas) loja.put(l);
  });
};

/**
 * Os pontos guardados do trajeto, em ordem de seq (sem passar de `limite`).
 * @param {string} trajetoId @param {number} [limite]
 */
export const listarPontosDoTrajeto = async (trajetoId, limite = Infinity) => {
  if (!(await abrir())) {
    return [...memoria.values()].filter((p) => p.trajetoId === trajetoId).sort((a, b) => a.seq - b.seq).slice(0, limite);
  }
  const registros = /** @type {any[]|undefined} */ (await comLoja('readonly', (loja) => loja.index('trajeto').getAll(IDBKeyRange.only(trajetoId))));
  return (Array.isArray(registros) ? registros : []).sort((a, b) => a.seq - b.seq).slice(0, limite);
};

/**
 * Apaga os pontos com estes seq (só depois do envio dar certo).
 * @param {string} trajetoId @param {number[]} seqs
 */
export const apagarPontosDoTrajeto = async (trajetoId, seqs) => {
  if (!seqs.length) return;
  if (!(await abrir())) {
    for (const seq of seqs) memoria.delete(chaveDe(trajetoId, seq));
    return;
  }
  await comLoja('readwrite', (loja) => {
    for (const seq of seqs) loja.delete(chaveDe(trajetoId, seq));
  });
};

/** Quantos pontos estão guardados no aparelho (todos os trajetos). Usado para o teto do buffer. */
export const contarPontosGuardados = async () => {
  if (!(await abrir())) return memoria.size;
  const n = await comLoja('readonly', (loja) => loja.count());
  return typeof n === 'number' ? n : 0;
};

/** Só para testes: esvazia o fallback de memória. */
export const limparBufferDeTesteGps = () => memoria.clear();
