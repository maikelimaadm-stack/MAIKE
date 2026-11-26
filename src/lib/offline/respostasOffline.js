/**
 * Respostas guardadas para usar sem internet (D-PROD-294).
 *
 * Toda leitura autenticada (`GET`) que o servidor respondeu fica guardada no
 * aparelho, por tenant e por caminho. Sem internet, a mesma leitura devolve a
 * última resposta guardada em vez de falhar. É o que faz áreas, cadastros e
 * demais telas abrirem sem sinal depois de baixadas ou vistas com internet.
 *
 * Só leitura: nada de gravação passa por aqui. Separado por tenant (o mesmo
 * dono do armazenamento offline) e apagado no logout.
 *
 * IndexedDB pode faltar (teste em Node, navegador restrito): tudo vira no-op.
 */

const BANCO = 'maike_respostas_offline';
const LOJA = 'respostas';
const VERSAO = 1;
/** Teto de entradas por aparelho: as mais antigas saem primeiro. */
const LIMITE = 3000;

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
      const pedido = indexedDB.open(BANCO, VERSAO);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains(LOJA)) {
          const loja = db.createObjectStore(LOJA, { keyPath: 'chave' });
          loja.createIndex('tenant', 'tenant', { unique: false });
          loja.createIndex('em', 'em', { unique: false });
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

const chaveDe = (tenant, caminho) => `${tenant}|${caminho}`;

/**
 * @template T
 * @param {'readonly'|'readwrite'} modo
 * @param {(loja: IDBObjectStore) => IDBRequest|void} operar
 * @returns {Promise<T|undefined>}
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
 * Guarda a resposta de uma leitura. Nunca lança.
 *
 * @param {string|null} tenant
 * @param {string} caminho
 * @param {unknown} corpo
 * @param {{marca?: string, formato?: number, pedido_em?: number}} [extra] `pedido_em` (D-PROD-318): quando o pedido saiu
 */
export const guardarResposta = async (tenant, caminho, corpo, extra = undefined) => {
  if (!tenant || !caminho) return;
  // D-PROD-309: `extra.marca` (instante do servidor da última sincronização incremental) e
  // `extra.formato` vão junto; uma leitura comum (sem `extra`) apaga a marca — a próxima
  // sincronização incremental começa do zero, nunca de uma marca que não bate com o corpo.
  await comLoja('readwrite', (loja) =>
    loja.put({ chave: chaveDe(tenant, caminho), tenant, caminho, corpo, em: Date.now(), ...(extra ?? {}) })
  );
  await podarSePreciso();
};

/**
 * Última resposta guardada, ou `undefined`.
 *
 * @param {string|null} tenant
 * @param {string} caminho
 * @returns {Promise<{corpo: unknown, em: number, marca: string|null, formato: number|null, pedido_em: number|null}|undefined>}
 */
export const lerResposta = async (tenant, caminho) => {
  if (!tenant || !caminho) return undefined;
  const registro = /** @type {any} */ (await comLoja('readonly', (loja) => loja.get(chaveDe(tenant, caminho))));
  return registro
    ? { corpo: registro.corpo, em: registro.em, marca: registro.marca ?? null, formato: registro.formato ?? null, pedido_em: Number.isFinite(registro.pedido_em) ? registro.pedido_em : null }
    : undefined;
};

/**
 * Caminhos guardados do tenant (para atualizar tudo de uma vez).
 *
 * @param {string|null} tenant
 * @returns {Promise<string[]>}
 */
export const listarCaminhosGuardados = async (tenant) => {
  if (!tenant) return [];
  const registros = /** @type {any[]|undefined} */ (
    await comLoja('readonly', (loja) => loja.index('tenant').getAll(IDBKeyRange.only(tenant)))
  );
  return Array.isArray(registros) ? registros.map((r) => r.caminho) : [];
};

/** Apaga as respostas do tenant (logout). Nunca lança. */
export const esquecerRespostasDoTenant = async (tenant) => {
  if (!tenant) return;
  const caminhos = await listarCaminhosGuardados(tenant);
  if (!caminhos.length) return;
  await comLoja('readwrite', (loja) => {
    caminhos.forEach((c) => loja.delete(chaveDe(tenant, c)));
  });
};

let gravacoesDesdeAPoda = 0;

const podarSePreciso = async () => {
  gravacoesDesdeAPoda += 1;
  if (gravacoesDesdeAPoda < 50) return;
  gravacoesDesdeAPoda = 0;
  const total = /** @type {number|undefined} */ (await comLoja('readonly', (loja) => loja.count()));
  if (!total || total <= LIMITE) return;
  const excesso = total - LIMITE;
  await comLoja('readwrite', (loja) => {
    let removidos = 0;
    const cursor = loja.index('em').openCursor();
    cursor.onsuccess = () => {
      const atual = cursor.result;
      if (!atual || removidos >= excesso) return;
      atual.delete();
      removidos += 1;
      atual.continue();
    };
  });
};
