/**
 * D-PROD-382 — os nomes dos pastos desenhados NO CHÃO do mapa nativo do Google (app), como os pastos.
 *
 * Por quê: como marcador, o nome tem tamanho fixo na tela (o mapa nativo não muda o tamanho de um marcador no zoom) e
 * precisava ser trocado (sigla, nome, hectares) quando o mapa parava: travava. No chão, é o próprio mapa que desenha:
 * o nome cresce e diminui junto com o zoom, liso, e nada é trocado no meio do gesto.
 *
 * Um nome por pasto (nome + hectares), do tamanho que cabe no pasto. Quando o mapa PARA:
 *  - perto demais, o nome volta ao tamanho máximo da letra (não fica gigante);
 *  - longe demais (letra pequena demais para ler), some.
 */
import { raioNaTela } from "@/lib/maplibre/nomesNoMapa.js";

/** A letra na tela, no máximo esta parte da letra de 12 px (o tamanho de que o proprietário gostou). */
export const FATOR_MAXIMO = 1;
/** Abaixo desta parte da letra de 12 px (menos de ~5 px) o nome não se lê: some. */
export const FATOR_MINIMO = 0.36;
/** O nome ocupa no máximo esta parte do espaço livre do pasto. */
export const OCUPACAO = 1;
/** Com lote, o espaço entre o ponto do pasto e o topo do nome, em parte da altura do nome. */
export const FOLGA_ABAIXO_DO_LOTE = 0.15;
/** O nome que aparece com menos desta parte da letra de 12 px usa a imagem menor (letra nítida, sem serrilhado). */
export const FATOR_DA_IMAGEM_PEQUENA = 0.6;
/** A imagem menor tem esta parte dos pixels da normal. */
export const PARTE_DA_IMAGEM_PEQUENA = 0.6;
/** O tamanho no chão só é refeito quando muda mais do que isto (proporção). */
export const DIFERENCA_DE_TAMANHO = 0.03;

/** Metros por px da tela no zoom do MapLibre (o do Google é um a mais) e na latitude. */
export function metrosPorPx(lat, zoomMapLibre) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoomMapLibre + 1);
}

/**
 * Tamanho do nome no chão para o zoom em que o mapa parou.
 * @param {{ w: number, h: number }} medida a imagem do nome (px, letra de 12 px)
 * @param {{ lat: number, folga: number } | null} pf ponto do nome e raio livre do pasto (graus de latitude)
 * @param {number} lat @param {boolean} comLote com lote, o nome fica logo abaixo do ponto (só a metade de baixo do espaço)
 * @param {number} zoom zoom do MapLibre
 * @returns {{ metros: number, visivel: boolean, fator: number }} largura da imagem em metros; `fator` = letra ÷ 12 px
 */
export function tamanhoNoChao(medida, pf, lat, comLote, zoom) {
  const mpp = metrosPorPx(lat, zoom);
  const raio = pf ? raioNaTela(pf.folga, pf.lat, zoom) : null;
  // sem o raio livre (pasto sem contorno útil): o tamanho máximo
  let cabe = FATOR_MAXIMO;
  if (raio != null) cabe = (OCUPACAO * (comLote ? raio : 2 * raio)) / Math.hypot(comLote ? medida.w / 2 : medida.w, medida.h);
  const fator = Math.min(FATOR_MAXIMO, cabe);
  return { metros: medida.w * fator * mpp, visivel: cabe >= FATOR_MINIMO, fator };
}

/**
 * Mantém os nomes no chão: manda ao mapa só o que mudou (imagem ou lugar novos; tamanho; mostrar; esconder; tirar).
 * @param {(ops: { por?: any[], tamanhos?: any[], mostrar?: string[], esconder?: string[], tirar?: string[] }) => Promise<any>} enviar
 */
export function criarNomesNoChao(enviar) {
  /** @type {Map<string, { desenho: string, metros: number, visivel: boolean }>} */
  const noMapa = new Map();
  let fila = /** @type {Promise<void>} */ (Promise.resolve());
  let vivo = true;
  return {
    /** @param {Array<{ chave: string, url: string, lat: number, lng: number, ancoraY: number, metros: number, visivel: boolean }>} lista */
    definir(lista) {
      fila = fila.then(async () => {
        if (!vivo) return;
        const por = [];
        const tamanhos = [];
        const mostrar = [];
        const esconder = [];
        const vistos = new Set();
        for (const n of lista) {
          vistos.add(n.chave);
          // o lugar com 6 casas (~10 cm): o nome com lote muda de lugar quando muda de tamanho, e aí entra de novo
          // (o novo entra antes de o velho sair, na mesma passada: não pisca)
          const desenho = `${n.url.length}|${n.url.slice(-48)}|${n.lat.toFixed(6)}|${n.lng.toFixed(6)}|${n.ancoraY}`;
          const a = noMapa.get(n.chave);
          // escondido e já no mapa: fica como está (nada é refeito fora da vista); ao aparecer, é acertado
          if (a && !n.visivel) {
            if (a.visivel) {
              esconder.push(n.chave);
              a.visivel = false;
            }
            continue;
          }
          if (!a || a.desenho !== desenho) {
            por.push({ chave: n.chave, url: n.url, lat: n.lat, lng: n.lng, ancoraY: n.ancoraY, metros: n.metros, visivel: n.visivel, z: 1 });
            noMapa.set(n.chave, { desenho, metros: n.metros, visivel: n.visivel });
            continue;
          }
          if (n.visivel && Math.abs(n.metros / a.metros - 1) > DIFERENCA_DE_TAMANHO) {
            tamanhos.push({ chave: n.chave, metros: n.metros });
            a.metros = n.metros;
          }
          if (n.visivel !== a.visivel) {
            (n.visivel ? mostrar : esconder).push(n.chave);
            a.visivel = n.visivel;
          }
        }
        const tirar = [...noMapa.keys()].filter((k) => !vistos.has(k));
        for (const k of tirar) noMapa.delete(k);
        if (!por.length && !tamanhos.length && !mostrar.length && !esconder.length && !tirar.length) return;
        await enviar({ por, tamanhos, mostrar, esconder, tirar }).catch(() => {});
      });
      return fila;
    },
    async limpar() {
      vivo = false;
      const tirar = [...noMapa.keys()];
      noMapa.clear();
      if (tirar.length) await enviar({ tirar }).catch(() => {});
    },
  };
}
