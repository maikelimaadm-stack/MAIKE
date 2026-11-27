/**
 * Os ícones do Mapa Geral como marcadores do PRÓPRIO mapa nativo do Google, no app (D-PROD-374, APK 1.0.8 em diante).
 *
 * Por quê: num `div` por cima do mapa nativo (D-PROD-372/373), os ícones dependem da câmera que o Android manda para a
 * página, com atraso e em rajadas: andam atrás do mapa e tremem. Como marcadores do mapa, andam colados nele.
 *
 * Como: o remendo `scripts/app/remendar-google-maps.mjs` faz o marcador nativo aceitar a imagem `data:` (a mesma do
 * site: lote com a contagem, cocho com o nível e o farol). A posição em px (centro ou topo no ponto + deslocamento)
 * vira uma âncora: a imagem ganha uma margem transparente para o ponto do mapa cair no MEIO dela (âncora 0,5 × 0,5),
 * que vale no Android e no iOS. O nome do pasto, que muda de tamanho com o zoom, é refeito no tamanho do zoom quando o
 * mapa para.
 *
 * O toque no marcador é do Mapa Geral (o remendo faz o mapa não centralizar nem abrir balão): `tocar(idNativo)`.
 */

/** @typedef {import('./mapaGoogleWeb.js').MarcadorWeb} Marcador */

/** Ordem dos nomes no mapa nativo: por baixo dos ícones (a margem transparente do nome não rouba o toque do lote). */
export const Z_NOME_NATIVO = 100;
/** Diferença de tamanho (proporção) a partir da qual o nome é refeito quando o mapa para. */
export const DIFERENCA_REFAZER_NOME = 0.04;

/** Imagens com a margem, por URL, tamanho e âncora. @type {Map<string, Promise<string | null>>} */
const comMargem = new Map();

/**
 * A imagem com uma margem transparente que põe o ponto de âncora (ax, ay em px da imagem) no centro.
 * @param {string} url @param {number} w @param {number} h @param {number} ax @param {number} ay
 * @returns {Promise<{ url: string, w: number, h: number } | null>}
 */
export async function imagemComAncoraNoCentro(url, w, h, ax, ay) {
  // O Android lê o tamanho do ícone em número inteiro: com a margem em px inteiros, o ponto cai no meio exato
  if (Math.abs(ax - w / 2) < 0.01 && Math.abs(ay - h / 2) < 0.01) return { url, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  const meiaL = Math.max(1, Math.ceil(Math.max(Math.abs(ax), Math.abs(w - ax)) - 0.001));
  const meiaA = Math.max(1, Math.ceil(Math.max(Math.abs(ay), Math.abs(h - ay)) - 0.001));
  const L = 2 * meiaL;
  const A = 2 * meiaA;
  const chave = `${url.length}:${url.slice(-64)}|${w.toFixed(2)}|${h.toFixed(2)}|${ax.toFixed(2)}|${ay.toFixed(2)}`;
  let p = comMargem.get(chave);
  if (!p) {
    p = new Promise((resolve) => {
      if (typeof document === "undefined" || typeof Image === "undefined") return resolve(null);
      const img = new Image();
      img.onload = () => {
        try {
          const pr = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(L * pr);
          canvas.height = Math.ceil(A * pr);
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(null);
          ctx.drawImage(img, (meiaL - ax) * pr, (meiaA - ay) * pr, w * pr, h * pr);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    comMargem.set(chave, p);
    if (comMargem.size > 800) comMargem.clear();
  }
  const pronta = await p;
  return pronta ? { url: pronta, w: L, h: A } : null;
}

/**
 * Tamanho e âncora (px da imagem) de um marcador no zoom.
 * @param {Marcador} m @param {number} zoom zoom do MapLibre
 */
export function geometriaNoZoom(m, zoom) {
  const f = m.escala ? m.escala(zoom) : 1;
  const k = Number.isFinite(f) && f > 0 ? f : 1;
  const w = m.w * k;
  const h = m.h * k;
  // o ponto do mapa na imagem: centro (ou topo) da imagem menos o deslocamento
  const ax = w / 2 - (m.dx || 0);
  const ay = (m.ancora === "topo" ? 0 : h / 2) - (m.dy || 0);
  return { w, h, ax, ay };
}

/**
 * A camada de marcadores nativos sobre um mapa do plugin (`GoogleMap`).
 * @param {{ addMarkers: (m: any[]) => Promise<string[]>, removeMarkers: (ids: string[]) => Promise<void> }} mapa
 */
export function criarMarcadoresNativos(mapa) {
  /** @type {Map<string, { m: Marcador, idNativo: string | null, assinatura: string }>} */
  const itens = new Map();
  /** @type {Map<string, string>} idNativo → chave */
  const porNativo = new Map();
  /** @type {Map<string, Marcador[]>} a última lista de cada grupo (para refazer os nomes no zoom) */
  const listas = new Map();
  /** @type {Record<string, number>} */
  const seq = {};
  /** @type {Map<string, number>} o zoom em que cada grupo foi posto (o tamanho dos nomes) */
  const zoomDoGrupo = new Map();
  let zoom = 14;
  let fila = /** @type {Promise<void>} */ (Promise.resolve());
  let vivo = true;

  /** @param {Marcador} m */
  const assinatura = (m) => {
    const g = geometriaNoZoom(m, zoom);
    return [m.url.length, m.url.slice(-48), g.w.toFixed(1), g.h.toFixed(1), g.ax.toFixed(1), g.ay.toFixed(1), m.z ?? 0, m.lat, m.lng].join("|");
  };

  /** @param {Marcador} m */
  const paraNativo = async (m) => {
    const g = geometriaNoZoom(m, zoom);
    const img = await imagemComAncoraNoCentro(m.url, g.w, g.h, g.ax, g.ay);
    if (!img) return null;
    return {
      coordinate: { lat: m.lat, lng: m.lng },
      iconUrl: img.url,
      iconSize: { width: img.w, height: img.h },
      iconAnchor: { x: img.w / 2, y: img.h / 2 },
      // o nome por baixo dos ícones; quem pede outra ordem no app (o ponto azul) usa `zNativo`
      zIndex: m.zNativo ?? (m.semToque ? Z_NOME_NATIVO : m.z ?? 0),
    };
  };

  /**
   * Troca os marcadores de um grupo: o que entrou ou mudou entra no mapa e SÓ DEPOIS o que saiu ou mudou sai (sem
   * buraco: o nome refeito no zoom não pisca). Uma troca de cada vez; uma chamada mais nova do mesmo grupo descarta a
   * anterior que ainda não rodou.
   * @param {string} grupo @param {Marcador[]} lista
   */
  const definir = (grupo, lista) => {
    listas.set(grupo, lista);
    const minha = (seq[grupo] = (seq[grupo] || 0) + 1);
    fila = fila.then(async () => {
      if (!vivo || seq[grupo] !== minha) return;
      const zoomDaTroca = zoom;
      const novos = new Map(lista.map((m) => [`${grupo}|${m.id}`, m]));
      /** @type {Set<string>} */
      const sair = new Set();
      for (const [k, it] of itens) {
        if (!k.startsWith(`${grupo}|`)) continue;
        const m = novos.get(k);
        if (!m || assinatura(m) !== it.assinatura) sair.add(k);
        else it.m = m; // mesmo desenho e lugar: só o clique e o resto dos dados
      }
      /** @type {Array<[string, Marcador, string]>} */
      const por = [];
      for (const [k, m] of novos) if (!itens.has(k) || sair.has(k)) por.push([k, m, assinatura(m)]);
      const prontos = await Promise.all(por.map(([, m]) => paraNativo(m)));
      if (!vivo) return;
      zoomDoGrupo.set(grupo, zoomDaTroca);
      try {
        const validos = por.filter((_, i) => prontos[i]);
        const ids = validos.length ? await mapa.addMarkers(prontos.filter(Boolean)) : [];
        /** @type {string[]} */
        const tirar = [];
        for (const k of sair) {
          const it = itens.get(k);
          if (it?.idNativo) {
            tirar.push(it.idNativo);
            porNativo.delete(it.idNativo);
          }
          itens.delete(k);
        }
        validos.forEach(([k, m, a], i) => {
          const idNativo = ids?.[i] != null ? String(ids[i]) : null;
          itens.set(k, { m, idNativo, assinatura: a });
          if (idNativo) porNativo.set(idNativo, k);
        });
        if (tirar.length) await mapa.removeMarkers(tirar);
      } catch {
        /* mapa fechado no meio */
      }
      // o mapa parou num zoom novo enquanto as imagens eram preparadas: refaz no zoom de agora
      if (vivo && zoom !== zoomDaTroca && seq[grupo] === minha) revisarGrupo(grupo);
    });
    return fila;
  };

  /**
   * Refaz o grupo se o que muda de tamanho com o zoom (os nomes) mudou o bastante desde que ele foi posto.
   * @param {string} grupo
   */
  const revisarGrupo = (grupo) => {
    const lista = listas.get(grupo);
    const comEscala = lista ? lista.filter((m) => m.escala) : [];
    if (!lista || !comEscala.length) return;
    const antes = zoomDoGrupo.get(grupo);
    if (antes == null) return; // a primeira troca ainda não rodou: ela confere o zoom ao terminar
    const mudou = comEscala.some((m) => {
      const a = /** @type {any} */ (m.escala)(antes);
      const b = /** @type {any} */ (m.escala)(zoom);
      return a > 0 && Math.abs(b / a - 1) > DIFERENCA_REFAZER_NOME;
    });
    if (mudou) void definir(grupo, lista);
  };

  return {
    definir,
    /** O toque num marcador nativo: devolve o marcador (o clique é de quem chama). @param {string} idNativo */
    marcadorDoToque(idNativo) {
      const k = porNativo.get(String(idNativo));
      return k ? itens.get(k)?.m || null : null;
    },
    /**
     * O mapa parou num zoom: o que muda de tamanho com o zoom (os nomes) é refeito no tamanho dele, se mudou o bastante.
     * @param {number} z zoom do MapLibre
     */
    aoParar(z) {
      if (!Number.isFinite(z)) return;
      zoom = z;
      for (const grupo of listas.keys()) revisarGrupo(grupo);
    },
    /** Tira todos os marcadores. */
    async limpar() {
      vivo = false;
      const ids = [...porNativo.keys()];
      itens.clear();
      porNativo.clear();
      listas.clear();
      if (ids.length) await mapa.removeMarkers(ids).catch(() => {});
    },
  };
}
