/**
 * Satélite do app que continua aparecendo sem internet (D-PROD-294).
 *
 * Só com a MapTiler, cujos termos permitem "temporary personal cache" no
 * aparelho, para um usuário (MapTiler Cloud Terms, 5.7). O Google proíbe uso
 * offline das imagens da Map Tiles API: com o Google nada é guardado aqui.
 *
 * Cada imagem (tile) vista com internet fica no aparelho (Cache Storage):
 *  - até 7 dias é usada direto, sem ir à rede (menos consumo da cota);
 *  - até 30 dias é usada quando não há internet;
 *  - depois disso sai do aparelho. Não há download de área inteira.
 *
 * Funciona como protocolo do MapLibre (`maike-sat://`). Sem Cache Storage
 * (teste em Node, navegador restrito) a fonte pede `https://` direto.
 */
import maplibregl from "maplibre-gl";

export const PROTOCOLO_SATELITE = "maike-sat";
const NOME_DO_CACHE = "maike-satelite-v1";
const CABECALHO_GUARDADO_EM = "x-maike-guardado-em";
/** Usado sem ir à rede. */
export const FRESCO_MS = 7 * 24 * 60 * 60 * 1000;
/** Usado sem internet; depois sai do aparelho. */
export const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;
/** Teto de imagens guardadas (as mais antigas saem). */
const LIMITE_DE_TILES = 4000;

let registrado = false;
let gravacoesDesdeALimpeza = 0;

export const sateliteGuardadoDisponivel = () => {
  try {
    return typeof caches !== "undefined" && !!caches && typeof caches.open === "function";
  } catch {
    return false;
  }
};

const semInternet = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Chave do tile sem query (a chave de API não vira chave de cache). */
export const chaveDoTile = (url) =>
  String(url).split("?")[0].replace(new RegExp(`^${PROTOCOLO_SATELITE}://`), "https://");

/**
 * @param {string} url
 * @param {number} idadeMaxima
 * @param {() => number} agora
 * @returns {Promise<ArrayBuffer|null>}
 */
export const lerTileGuardado = async (url, idadeMaxima, agora = Date.now) => {
  if (!sateliteGuardadoDisponivel()) return null;
  try {
    const cache = await caches.open(NOME_DO_CACHE);
    const r = await cache.match(chaveDoTile(url));
    if (!r) return null;
    const em = Number(r.headers.get(CABECALHO_GUARDADO_EM));
    if (!Number.isFinite(em)) return null;
    const idade = agora() - em;
    if (idade > VALIDADE_MS) {
      await cache.delete(chaveDoTile(url));
      return null;
    }
    return idade <= idadeMaxima ? await r.arrayBuffer() : null;
  } catch {
    return null;
  }
};

export const limparTilesAntigos = async (agora = Date.now) => {
  if (!sateliteGuardadoDisponivel()) return;
  try {
    const cache = await caches.open(NOME_DO_CACHE);
    const pedidos = await cache.keys();
    const comData = [];
    for (const pedido of pedidos) {
      const r = await cache.match(pedido);
      const em = Number(r?.headers.get(CABECALHO_GUARDADO_EM));
      if (!Number.isFinite(em) || agora() - em > VALIDADE_MS) await cache.delete(pedido);
      else comData.push({ pedido, em });
    }
    if (comData.length > LIMITE_DE_TILES) {
      comData.sort((a, b) => a.em - b.em);
      for (const { pedido } of comData.slice(0, comData.length - LIMITE_DE_TILES)) await cache.delete(pedido);
    }
  } catch {
    // ignora
  }
};

export const guardarTile = async (url, dados, tipo, agora = Date.now) => {
  if (!sateliteGuardadoDisponivel()) return;
  try {
    const cache = await caches.open(NOME_DO_CACHE);
    await cache.put(
      chaveDoTile(url),
      new Response(dados, { headers: { "content-type": tipo || "image/jpeg", [CABECALHO_GUARDADO_EM]: String(agora()) } })
    );
    gravacoesDesdeALimpeza += 1;
    if (gravacoesDesdeALimpeza >= 200) {
      gravacoesDesdeALimpeza = 0;
      await limparTilesAntigos(agora);
    }
  } catch {
    // Guardar é conveniência: o tile já foi entregue ao mapa.
  }
};

/**
 * Carrega um tile: guardado fresco → rede (e guarda) → guardado até 30 dias
 * quando a rede falha ou não há internet.
 *
 * @param {{ url: string }} params
 * @param {AbortController} [abortController]
 * @param {{ fetchImpl?: typeof fetch, agora?: () => number }} [deps]
 */
export const carregarTileSatelite = async (params, abortController, deps = {}) => {
  const url = String(params.url).replace(new RegExp(`^${PROTOCOLO_SATELITE}://`), "https://");
  const agora = deps.agora || Date.now;
  const fresco = await lerTileGuardado(url, semInternet() ? VALIDADE_MS : FRESCO_MS, agora);
  if (fresco) return { data: fresco };
  if (semInternet()) throw new Error(`Sem internet e sem cópia: ${chaveDoTile(url)}`);

  const fetchImpl = deps.fetchImpl || fetch;
  let resp;
  try {
    resp = await fetchImpl(url, { signal: abortController?.signal });
  } catch (erro) {
    if (/** @type {any} */ (erro)?.name === "AbortError") throw erro;
    const velho = await lerTileGuardado(url, VALIDADE_MS, agora);
    if (velho) return { data: velho };
    throw new Error(`Failed to fetch ${chaveDoTile(url)}`);
  }
  if (!resp.ok) {
    throw Object.assign(new Error(`AJAXError: ${resp.status} ${chaveDoTile(url)}`), { status: resp.status });
  }
  const dados = await resp.arrayBuffer();
  guardarTile(url, dados.slice(0), resp.headers.get("content-type") || "image/jpeg", agora).catch(() => {});
  return { data: dados };
};

/** Liga o protocolo `maike-sat://` (uma vez). Devolve se está ativo. */
export const ativarSateliteGuardado = () => {
  if (registrado) return true;
  if (!sateliteGuardadoDisponivel()) return false;
  try {
    maplibregl.addProtocol(PROTOCOLO_SATELITE, (params, abortController) =>
      carregarTileSatelite(/** @type {any} */ (params), abortController)
    );
    registrado = true;
  } catch {
    registrado = false;
  }
  return registrado;
};

/** Texto curto mostrado no rodapé do mapa. */
export const ATRIBUICAO_MAPTILER_TEXTO = "© MapTiler © OpenStreetMap";

export const ATRIBUICAO_MAPTILER =
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>';

/**
 * Fonte raster do satélite MapTiler (guardado no aparelho quando possível).
 * @param {string} chave
 */
export const fonteRasterMapTiler = (chave) => {
  const protocolo = ativarSateliteGuardado() ? PROTOCOLO_SATELITE : "https";
  return {
    type: "raster",
    tiles: [`${protocolo}://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${encodeURIComponent(chave)}`],
    tileSize: 512,
    maxzoom: 20,
    attribution: ATRIBUICAO_MAPTILER,
  };
};
