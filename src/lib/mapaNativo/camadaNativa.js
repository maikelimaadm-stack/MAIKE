/**
 * A camada do Mapa Geral desenhada pelo próprio Android, colada no mapa do Google (D-PROD-376, APK 1.0.9 em diante).
 *
 * Por quê: como marcadores do mapa (D-PROD-374), os ícones andam colados, mas os nomes dos pastos não mudam de tamanho
 * durante o zoom e são refeitos quando o mapa para (a "travadinha"). Aqui a página manda as imagens UMA vez e a regra
 * de tamanho por zoom; o Android (`CamadaDoMapaView.java`) desenha tudo a cada quadro, com a câmera do mapa, sem passar
 * pela ponte durante o gesto. As imagens são as mesmas do sistema: nada muda no desenho dos ícones.
 *
 * O toque continua do mapa: o clique do mapa pergunta à camada qual item está no ponto (`tocar`).
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

/** @typedef {import('./mapaGoogleWeb.js').MarcadorWeb} Marcador */

/** O plugin do próprio app (android/app/src/main/java/com/makgestao/app/CamadaDoMapaPlugin.java). */
export const PLUGIN_CAMADA = "CamadaDoMapa";
/** A partir deste número de APK (`versionCode`) o app tem a camada nativa. APK 1.0.9 = código 10. */
export const APK_CAMADA_NATIVA = 10;
/**
 * D-PROD-377: a camada nativa está DESLIGADA. No teste do proprietário no APK 1.0.9, ícones e nomes "se moviam
 * conforme o zoom": a camada é desenhada por cima do mapa, fora do desenho dele, e no zoom fica atrás do mapa. Os
 * marcadores do próprio mapa (D-PROD-374) ficam colados; o app volta a eles. O código fica para uma versão que desenhe
 * junto com o mapa.
 */
export const CAMADA_NATIVA_LIGADA = false;
/** Zooms do MapLibre das paradas de tamanho (o Android interpola entre elas, como o `icon-size` do MapLibre). */
export const ZOOMS_ESCALA = Object.freeze(Array.from({ length: 25 }, (_, i) => i));
/** Quantas vezes `ligar` tenta achar o mapa (ele acabou de ser criado) e o intervalo (ms). */
const TENTATIVAS_LIGAR = 8;
const MS_ENTRE_TENTATIVAS = 150;

const camada = /** @type {any} */ (registerPlugin(PLUGIN_CAMADA));

/** O app tem a camada nativa (Android com o plugin)? Fora do app, não. */
export function camadaNativaDisponivel() {
  if (!CAMADA_NATIVA_LIGADA) return false;
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable(PLUGIN_CAMADA);
  } catch {
    return false;
  }
}

/** @type {Map<string, string>} chave de cada URL já vista */
const chaves = new Map();

/**
 * Chave curta de uma imagem (a URL `data:` pode ter dezenas de KB): tamanho + resumo do texto inteiro.
 * @param {string} url
 */
export function chaveDaImagem(url) {
  const pronta = chaves.get(url);
  if (pronta) return pronta;
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = (Math.imul(h2, 31) + c) | 0;
  }
  const chave = `${url.length}-${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`;
  if (chaves.size > 2000) chaves.clear();
  chaves.set(url, chave);
  return chave;
}

/**
 * As paradas de tamanho de um marcador que muda com o zoom (o nome do pasto), nos zooms do MapLibre 0 a 24.
 * @param {(zoom: number) => number} escala
 */
export function paradasDaEscala(escala) {
  return ZOOMS_ESCALA.map((z) => {
    const f = escala(z);
    return Number.isFinite(f) && f > 0 ? Math.round(f * 10000) / 10000 : 1;
  });
}

/**
 * Um marcador do Mapa Geral como item da camada nativa.
 * @param {Marcador} m @param {string} chave
 */
export function itemDaCamada(m, chave) {
  return {
    id: String(m.id),
    chave,
    lat: m.lat,
    lng: m.lng,
    w: m.w,
    h: m.h,
    dx: m.dx || 0,
    dy: m.dy || 0,
    ancora: m.ancora === "topo" ? "topo" : "centro",
    // a mesma ordem do site e do MapLibre (o nome por cima, o ponto azul por cima de tudo): a camada não pega toque
    z: m.z ?? 0,
    toque: Boolean(m.onClick) && !m.semToque,
    ...(m.escala ? { escala: paradasDaEscala(m.escala) } : {}),
  };
}

const esperar = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Liga a camada nativa por cima do mapa do Google com esse id. Devolve a camada, ou null se não deu (o app segue com
 * os marcadores do mapa).
 * @param {string} mapId
 */
export async function criarCamadaNativa(mapId) {
  let ligou = false;
  for (let i = 0; i < TENTATIVAS_LIGAR && !ligou; i++) {
    try {
      await camada.ligar({ mapId });
      ligou = true;
    } catch {
      await esperar(MS_ENTRE_TENTATIVAS);
    }
  }
  if (!ligou) return null;

  /** @type {Set<string>} imagens que o Android já tem */
  const enviadas = new Set();
  /** @type {Map<string, Map<string, Marcador>>} grupo → id → marcador (o toque entrega o mais novo) */
  const porGrupo = new Map();
  /** @type {Record<string, number>} */
  const seq = {};
  /** @type {Record<string, string>} o último conteúdo de cada grupo mandado (igual: não manda de novo) */
  const publicado = {};
  let fila = /** @type {Promise<void>} */ (Promise.resolve());
  let vivo = true;

  return {
    /**
     * Troca os itens de um grupo. As imagens novas vão antes (uma vez cada); uma chamada mais nova do mesmo grupo
     * descarta a anterior que ainda não rodou.
     * @param {string} grupo @param {Marcador[]} lista
     */
    definir(grupo, lista) {
      const minha = (seq[grupo] = (seq[grupo] || 0) + 1);
      porGrupo.set(grupo, new Map(lista.map((m) => [String(m.id), m])));
      fila = fila.then(async () => {
        if (!vivo || seq[grupo] !== minha) return;
        /** @type {Array<{ chave: string, url: string }>} */
        const novas = [];
        const itens = lista.map((m) => {
          const chave = chaveDaImagem(m.url);
          if (!enviadas.has(chave)) {
            enviadas.add(chave);
            novas.push({ chave, url: m.url });
          }
          return itemDaCamada(m, chave);
        });
        try {
          if (novas.length) await camada.imagens({ imagens: novas });
          const conteudo = JSON.stringify(itens);
          if (!vivo || publicado[grupo] === conteudo) return;
          publicado[grupo] = conteudo;
          await camada.definir({ grupo, itens });
        } catch {
          for (const n of novas) enviadas.delete(n.chave);
          delete publicado[grupo];
        }
      });
      return fila;
    },
    /**
     * O item de cima, que recebe toque, no ponto do mapa (o clique do mapa), ou null.
     * @param {number} lat @param {number} lng
     * @returns {Promise<Marcador | null>}
     */
    async tocar(lat, lng) {
      if (!vivo || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      try {
        const r = await camada.tocar({ lat, lng });
        return (r?.grupo != null && porGrupo.get(String(r.grupo))?.get(String(r.id))) || null;
      } catch {
        return null;
      }
    },
    /** O mapa parou: nada a fazer (o Android já desenha no tamanho do zoom). */
    aoParar() {},
    /** Tira a camada. */
    async limpar() {
      vivo = false;
      porGrupo.clear();
      await camada.desligar().catch(() => {});
    },
  };
}
