/**
 * Fila de envio do motor de sincronização (D-PROD-295) — onde os registros
 * feitos sem internet esperam para ir ao servidor.
 *
 * Só armazenamento: nenhuma regra de envio mora aqui. O motor fala com esta
 * porta, e o teste troca o IndexedDB por memória.
 *
 * A fila é DURÁVEL: sobrevive a fechar o app, reiniciar o celular e sair da
 * conta. Nada é apagado daqui sem pedido explícito do motor (item enviado e já
 * sem ninguém que dependa do resultado dele, ou descarte pedido pela pessoa).
 *
 * IndexedDB próprio (`maike_fila_envio`), separado do cache de leituras e da
 * fila antiga de entidades: mudar um não obriga a migrar o outro.
 */

const BANCO = 'maike_fila_envio';
const LOJA = 'itens';
const VERSAO_DO_BANCO = 1;

/**
 * @typedef {'pendente'|'enviado'|'atencao'} EstadoDoItem
 *
 * @typedef {{
 *   id: string,
 *   formato: number,
 *   tipo: string,
 *   versao: number,
 *   cliente_id: string,
 *   usuario_id: string|null,
 *   empresa_id: string|null,
 *   payload: unknown,
 *   recursos: string[],
 *   referencias: string[],
 *   rotulo: string,
 *   criado_em: string,
 *   sequencia?: number,
 *   estado: EstadoDoItem,
 *   tentado?: boolean,
 *   tentativas: number,
 *   proxima_tentativa_em: number,
 *   ultimo_erro: null | {codigo: string, mensagem: string, em: string},
 *   resultado?: unknown,
 *   enviado_em?: string|null,
 * }} ItemDaFila
 *
 * @typedef {{
 *   listar: () => Promise<ItemDaFila[]>,
 *   ler: (id: string) => Promise<ItemDaFila|undefined>,
 *   gravar: (item: ItemDaFila) => Promise<void>,
 *   remover: (id: string) => Promise<void>,
 * }} PortaDaFila
 */

/** @type {Promise<IDBDatabase|null>|null} */
let abrindo = null;

const abrir = () => {
  if (abrindo) return abrindo;
  abrindo = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        resolve(null);
        return;
      }
      const pedido = indexedDB.open(BANCO, VERSAO_DO_BANCO);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains(LOJA)) {
          const loja = db.createObjectStore(LOJA, { keyPath: 'id' });
          loja.createIndex('cliente_id', 'cliente_id', { unique: false });
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
 * Uma operação numa transação. Ao contrário do cache de leituras, a fila NÃO
 * engole erro de gravação: perder um registro em silêncio é exatamente o que
 * ela existe para impedir. Quem grava fica sabendo.
 *
 * @template T
 * @param {'readonly'|'readwrite'} modo
 * @param {(loja: IDBObjectStore) => IDBRequest} operar
 * @returns {Promise<T>}
 */
const naLoja = async (modo, operar) => {
  const db = await abrir();
  if (!db) throw new Error('fila de envio indisponível neste aparelho');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOJA, modo);
    const pedido = operar(tx.objectStore(LOJA));
    tx.oncomplete = () => resolve(/** @type {T} */ (pedido.result));
    tx.onerror = () => reject(tx.error ?? new Error('falha na fila de envio'));
    tx.onabort = () => reject(tx.error ?? new Error('fila de envio abortada'));
  });
};

/** A fila durável existe neste aparelho? */
export const filaDeEnvioDisponivel = () => typeof indexedDB !== 'undefined' && indexedDB !== null;

/** @returns {PortaDaFila} */
export const criarFilaIndexedDB = () => ({
  listar: async () => {
    const itens = await naLoja('readonly', (loja) => loja.getAll());
    return Array.isArray(itens) ? /** @type {ItemDaFila[]} */ (itens) : [];
  },
  ler: (id) => naLoja('readonly', (loja) => loja.get(id)),
  gravar: async (item) => {
    await naLoja('readwrite', (loja) => loja.put(item));
  },
  remover: async (id) => {
    await naLoja('readwrite', (loja) => loja.delete(id));
  },
});

/**
 * Fila em memória, para teste (e como reserva quando o aparelho não tem
 * IndexedDB — aí o motor recusa guardar e só envia com internet).
 *
 * @returns {PortaDaFila}
 */
export const criarFilaEmMemoria = () => {
  /** @type {Map<string, ItemDaFila>} */
  const itens = new Map();
  const copia = (/** @type {any} */ v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    listar: async () => [...itens.values()].map(copia),
    ler: async (id) => copia(itens.get(id)),
    gravar: async (item) => {
      itens.set(item.id, copia(item));
    },
    remover: async (id) => {
      itens.delete(id);
    },
  };
};
