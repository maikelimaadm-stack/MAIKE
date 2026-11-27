/**
 * Mapa do Google no Mapa Geral, no app e no site (D-PROD-366, etapa 1).
 *
 * - App Android/iOS: o mapa NATIVO do Google (Maps SDK). O Google não cobra por ele e o próprio SDK guarda as imagens
 *   já vistas no aparelho: é o mapa do AgriWebb.
 * - Site: o Google Maps do navegador (Maps JavaScript API), pela versão web do mesmo plugin. É cobrado por ABERTURA
 *   do mapa (arrastar e dar zoom não contam), com uma faixa grátis por mês: é o mapa do MAKGESTAO antigo. A Map Tiles
 *   API, que o MapLibre usa hoje, conta cada imagem.
 *
 * Etapa 1: só as áreas (polígonos com as cores do Mapa Geral) sobre o satélite do Google, e o toque na área abre o
 * mesmo detalhe. Fica atrás de uma escolha do próprio aparelho ("Mapa do Google (teste)"). No app ela só aparece com
 * o plugin nativo instalado (APK 1.0.6 em diante); no site, com a chave do Google configurada. Sem isso — APK antigo
 * recebendo a atualização automática, testes — nada muda: o Mapa Geral segue no MapLibre.
 */
import { App } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";

import { getGoogleMapsApiKey } from "@/config/runtimeConfig";

import { parseVertices } from "@/lib/geografia/coords.js";
import { COR_LINHA_AREA, OPACIDADE_FILL_AREA, corExibidaNoMapa } from "@/lib/maplibre/estiloAreas.js";
import { corDaAreaNoMapaGeral } from "@/lib/maplibre/mapaGeralRender.js";

/** Nome com que o plugin `@capacitor/google-maps` se registra. */
export const PLUGIN_MAPA_GOOGLE = "CapacitorGoogleMaps";
/** Escolha do aparelho (localStorage): "1" liga o mapa do Google no Mapa Geral. */
export const CHAVE_PREFERENCIA = "mk_mapa_google_nativo";
/** Cor de reserva da área sem cor (a mesma do MapLibre). */
export const COR_AREA_PADRAO = "#94a3b8";

/** Roda no app Android/iOS (mapa nativo) e não no navegador? */
export function ehMapaGoogleNativo() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * O mapa do Google pode abrir aqui? No app: o plugin nativo está no APK. No site: a chave do Google está configurada
 * (a mesma do satélite; precisa do "Maps JavaScript API" ligado nela).
 */
export function temMapaGoogle() {
  try {
    if (Capacitor.isNativePlatform()) return Capacitor.isPluginAvailable(PLUGIN_MAPA_GOOGLE);
    return getGoogleMapsApiKey() !== null;
  } catch {
    return false;
  }
}

/** A pessoa ligou o mapa do Google neste aparelho? */
export function lerPreferenciaMapaGoogle() {
  try {
    return localStorage.getItem(CHAVE_PREFERENCIA) === "1";
  } catch {
    return false;
  }
}

/** @param {boolean} ligado */
export function gravarPreferenciaMapaGoogle(ligado) {
  try {
    if (ligado) localStorage.setItem(CHAVE_PREFERENCIA, "1");
    else localStorage.removeItem(CHAVE_PREFERENCIA);
  } catch {
    /* armazenamento indisponível: a escolha vale só até fechar */
  }
}

/** O Mapa Geral usa o mapa do Google agora (pode abrir aqui e a escolha está ligada). */
export function usarMapaGoogle() {
  return temMapaGoogle() && lerPreferenciaMapaGoogle();
}

/**
 * Opções do mapa na criação. No site (Maps JavaScript API): arrastar com um dedo no celular (`greedy`; o padrão pede
 * dois dedos), sem os botões e ícones clicáveis do Google por cima da barra do Mapa Geral. O mapa nativo ignora as
 * opções que não conhece.
 * @param {{ center: { lat: number, lng: number }, zoom: number }} vista
 * @param {string} tipo "satellite" | "roadmap"
 */
export function configDoMapaGoogle(vista, tipo) {
  return {
    center: vista.center,
    zoom: vista.zoom,
    mapTypeId: tipo === "satellite" ? "satellite" : "roadmap",
    gestureHandling: "greedy",
    disableDefaultUI: true,
    clickableIcons: false,
    keyboardShortcuts: false,
  };
}

/**
 * Tipo do mapa do Google a partir do tipo do Mapa Geral ("satellite" ou "roadmap"). O satélite do Google vem com os
 * nomes das estradas e cidades por cima quando é "híbrido"; o Mapa Geral mostra a foto limpa: `Satellite`.
 * @param {string} tipo
 */
export function tipoDoMapaGoogle(tipo) {
  return tipo === "satellite" ? "Satellite" : "Normal";
}

/**
 * Preenchimento e contorno de cada estilo de pasto (Cheio, Suave, Contorno), os mesmos do MapLibre
 * (`paintEstiloPasto`): Cheio 78%, Suave 40%, Contorno 8% com a divisa na cor da área.
 * @param {string | undefined} estilo
 * @param {string} cor
 */
export function estiloDoPoligono(estilo, cor) {
  if (estilo === "contorno") return { fillOpacity: 0.08, strokeColor: cor, strokeWeight: 2 };
  if (estilo === "suave") return { fillOpacity: 0.4, strokeColor: COR_LINHA_AREA, strokeWeight: 1 };
  return { fillOpacity: OPACIDADE_FILL_AREA, strokeColor: COR_LINHA_AREA, strokeWeight: 1 };
}

/**
 * Escala das medidas em px (linha, margem) para o mapa do Google: o Android as lê em pixels FÍSICOS da tela; o iOS e o
 * navegador, em pontos (px da página).
 */
export function escalaDoMapaGoogle() {
  try {
    if (Capacitor.getPlatform() === "android") return Math.max(1, Number(globalThis.devicePixelRatio) || 1);
  } catch {
    /* fora do app */
  }
  return 1;
}

/**
 * Polígonos do Google para as áreas do Mapa Geral. Área sem contorno válido (menos de 3 vértices) fica de fora, como
 * no MapLibre. `tag` = id da área: o toque no polígono devolve a área. A cor é a mesma do MapLibre: a da coloração
 * escolhida ou, sem ela (modo padrão), a cor salva da área, com o mesmo clareamento de 5%, sempre `#rrggbb` (o
 * Android não aceita `#abc` nem `rgb(...)`).
 * @param {any[]} areas
 * @param {(area: any) => string | null | undefined} corDaArea
 * @param {string} [estilo]
 * @param {number} [escala] px físicos por px (Android)
 */
export function poligonosDasAreas(areas, corDaArea, estilo, escala = 1) {
  /** @type {Array<{ paths: Array<{ lat: number, lng: number }>, fillColor: string, fillOpacity: number, strokeColor: string, strokeWeight: number, clickable: boolean, tag: string }>} */
  const saida = [];
  for (const area of areas || []) {
    const pontos = parseVertices(area?.coordenadas?.coords);
    if (pontos.length < 3 || area?.id == null) continue;
    const cor = corExibidaNoMapa(corDaAreaNoMapaGeral(area, corDaArea));
    const traco = estiloDoPoligono(estilo, cor);
    saida.push({
      paths: pontos.map((p) => ({ lat: p.lat, lng: p.lng })),
      fillColor: cor,
      ...traco,
      strokeWeight: traco.strokeWeight * escala,
      clickable: true,
      tag: String(area.id),
    });
  }
  return saida;
}

/**
 * Caixa que contém todas as áreas (para enquadrar a fazenda na primeira abertura), ou null sem áreas.
 * @param {Array<{ paths: Array<{ lat: number, lng: number }> }>} poligonos
 */
export function caixaDosPoligonos(poligonos) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of poligonos || []) {
    for (const v of p.paths) {
      s = Math.min(s, v.lat);
      n = Math.max(n, v.lat);
      w = Math.min(w, v.lng);
      e = Math.max(e, v.lng);
    }
  }
  if (!Number.isFinite(s)) return null;
  return {
    southwest: { lat: s, lng: w },
    northeast: { lat: n, lng: e },
    center: { lat: (s + n) / 2, lng: (w + e) / 2 },
  };
}

/**
 * Mesma chave de "vista salva" do Mapa Geral (centro e zoom por fazenda): abrir no mapa do Google ou no MapLibre
 * começa no mesmo lugar. O zoom gravado é o do MapLibre (ladrilhos de 512 px), um nível abaixo do zoom do Google
 * (256 px) para a mesma escala na tela.
 * @param {string | null | undefined} empresaId
 */
export const chaveDaVistaSalva = (empresaId) => `mapa_geral_view_${empresaId || "default"}`;
/** @param {number} zoomMapLibre */
export const zoomDoGoogle = (zoomMapLibre) => zoomMapLibre + 1;
/** @param {number} zoomGoogle */
export const zoomDoMapLibre = (zoomGoogle) => zoomGoogle - 1;

// ——— ciclo de vida do mapa nativo ———
// O mapa nativo continua vivo atrás da WebView se a página recarregar sem `destroy()` (recarregar não roda a limpeza
// do React): ele seguiria pegando os toques daquele retângulo. Por isso o mapa aberto fica registrado aqui, a troca
// da escolha o destrói antes de recarregar, e o id do último mapa criado fica guardado para destruir um órfão na
// abertura seguinte.

const CHAVE_ULTIMO_ID = "mk_mapa_google_ultimo_id";
let contadorDeMapas = 0;
/** @type {{ destroy: () => Promise<void> } | null} */
let mapaAberto = null;

/** Id novo para cada mapa criado (um `destroy` atrasado de um mapa velho não derruba o novo). */
export function novoIdDoMapaGoogle() {
  contadorDeMapas += 1;
  const id = `mk-mapa-geral-google-${Date.now()}-${contadorDeMapas}`;
  try {
    localStorage.setItem(CHAVE_ULTIMO_ID, id);
  } catch {
    /* sem armazenamento */
  }
  return id;
}

/** @param {{ destroy: () => Promise<void> } | null} mapa */
export function registrarMapaGoogleAberto(mapa) {
  mapaAberto = mapa;
}

/** Destrói o mapa aberto (antes de recarregar a página). */
export async function fecharMapaGoogleAberto() {
  const mapa = mapaAberto;
  mapaAberto = null;
  try {
    await mapa?.destroy();
  } catch {
    /* já destruído */
  }
  try {
    localStorage.removeItem(CHAVE_ULTIMO_ID);
  } catch {
    /* sem armazenamento */
  }
}

/** Na abertura sem o mapa do Google: destrói um mapa nativo que ficou vivo de antes (app recarregado no meio). */
export async function limparMapaGoogleOrfao() {
  let id = null;
  try {
    id = localStorage.getItem(CHAVE_ULTIMO_ID);
  } catch {
    id = null;
  }
  if (!id || !ehMapaGoogleNativo() || !temMapaGoogle()) return;
  try {
    const cap = /** @type {any} */ (Capacitor);
    if (typeof cap.nativePromise === "function") await cap.nativePromise(PLUGIN_MAPA_GOOGLE, "destroy", { id });
  } catch {
    /* não havia mapa com esse id */
  }
  try {
    localStorage.removeItem(CHAVE_ULTIMO_ID);
  } catch {
    /* sem armazenamento */
  }
}

// ——— câmera a cada quadro e toque no app (D-PROD-373) ———

/** @type {any} */
let pluginNativo = null;
/**
 * O plugin nativo do mapa do Google, para ouvir eventos que a classe `GoogleMap` não expõe (`onCameraMove`, que o
 * remendo `scripts/app/remendar-google-maps.mjs` liga no APK 1.0.7 em diante).
 */
export function pluginDoMapaGoogle() {
  if (!pluginNativo) pluginNativo = registerPlugin(PLUGIN_MAPA_GOOGLE);
  return pluginNativo;
}

/**
 * A área (a `tag` do polígono) que contém o ponto, ou null. Com áreas sobrepostas, a de cima (a última posta).
 * No app os polígonos não são clicáveis (o toque vai inteiro para o mapa) e o clique do mapa decide: ícone ou área.
 * @param {Array<{ paths: Array<{ lat: number, lng: number }>, tag?: string }>} poligonos
 * @param {number} lat @param {number} lng
 * @returns {string | null}
 */
export function areaNoPonto(poligonos, lat, lng) {
  for (let i = (poligonos || []).length - 1; i >= 0; i -= 1) {
    const { paths, tag } = poligonos[i];
    let dentro = false;
    for (let a = 0, b = paths.length - 1; a < paths.length; b = a, a += 1) {
      const pa = paths[a];
      const pb = paths[b];
      if (pa.lat > lat !== pb.lat > lat && lng < ((pb.lng - pa.lng) * (lat - pa.lat)) / (pb.lat - pa.lat) + pa.lng) dentro = !dentro;
    }
    if (dentro && tag != null) return tag;
  }
  return null;
}

/**
 * A partir deste número de APK (`versionCode`) o mapa nativo aceita a imagem `data:` nos marcadores (remendo
 * D-PROD-374): os ícones do Mapa Geral viram marcadores do próprio mapa. APK 1.0.8 = código 9.
 */
export const APK_MARCADORES_NATIVOS = 9;

/** O número do APK instalado (`versionCode`), ou 0 fora do app ou sem a informação. */
export async function numeroDoApk() {
  try {
    if (!Capacitor.isNativePlatform()) return 0;
    const info = await App.getInfo();
    const n = Number(info?.build);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// ─── Linhas e "minha localização" (D-PROD-375, etapa 4) ───

/** Cor e espessura das linhas e da localização, as mesmas do MapLibre (`ensureMgLayers`). */
export const COR_LINHA_PADRAO = "#f59e0b";
export const LARGURA_LINHA_PX = 3;
export const COR_LOCALIZACAO = "#4285F4";
/** O ponto azul por cima de tudo (como o z-index 10000 do MapLibre). */
export const Z_LOCALIZACAO = 10000;
/** O ponto azul: 24 px, borda branca de 3 px e sombra. */
export const TAMANHO_PONTO_LOCALIZACAO = 24;

/**
 * Linhas do Mapa Geral (cerca, estrada, rede...) para o Google: a cor da linha, 3 px, `tag` = id. Linha com menos de
 * 2 pontos fica de fora.
 * @param {any[]} linhas @param {number} [escala] px do Google por px da página (Android: a densidade da tela)
 */
export function polilinhasDasLinhas(linhas, escala = 1) {
  /** @type {Array<{ path: Array<{ lat: number, lng: number }>, strokeColor: string, strokeOpacity: number, strokeWeight: number, clickable: boolean, zIndex: number, tag: string }>} */
  const saida = [];
  for (const linha of linhas || []) {
    if (!linha || linha.id == null) continue;
    const pontos = parseVertices(linha.coordenadas?.coords);
    if (pontos.length < 2) continue;
    saida.push({
      path: pontos.map((p) => ({ lat: p.lat, lng: p.lng })),
      strokeColor: linha.coordenadas?.cor || linha.cor || COR_LINHA_PADRAO,
      strokeOpacity: 1,
      strokeWeight: LARGURA_LINHA_PX * escala,
      clickable: true,
      zIndex: 2,
      tag: String(linha.id),
    });
  }
  return saida;
}

/**
 * Raio do círculo de precisão (m): a precisão REAL da leitura do GPS, entre 3 e 500 m; sem ela, 20 m (D-PROD-302).
 * @param {unknown} precisao
 */
export function raioDaPrecisao(precisao) {
  const p = Number(precisao);
  return Number.isFinite(p) && p > 0 ? Math.min(Math.max(p, 3), 500) : 20;
}

/**
 * O círculo de precisão em volta da localização (como o do MapLibre: azul, 15% de preenchimento, borda fina).
 * @param {{ lat: number, lng: number, accuracy?: number | null }} pos @param {number} [escala]
 */
export function circuloDaLocalizacao(pos, escala = 1) {
  return {
    center: { lat: pos.lat, lng: pos.lng },
    radius: raioDaPrecisao(pos.accuracy),
    fillColor: COR_LOCALIZACAO,
    fillOpacity: 0.15,
    strokeColor: COR_LOCALIZACAO,
    strokeOpacity: 0.3,
    strokeWeight: 1 * escala,
    clickable: false,
    zIndex: 3,
    tag: "minha-localizacao",
  };
}

/** @type {Map<number, string | null>} */
const pontosDesenhados = new Map();

/**
 * A imagem do ponto azul (URL `data:`), desenhada uma vez por densidade da tela; null sem canvas.
 * @param {number} [pixelRatio]
 */
export function imagemDoPontoDeLocalizacao(pixelRatio = Math.max(1, Number(globalThis.devicePixelRatio) || 1)) {
  const pr = Math.max(1, pixelRatio);
  if (pontosDesenhados.has(pr)) return pontosDesenhados.get(pr) ?? null;
  let url = null;
  try {
    if (typeof document !== "undefined") {
      const t = TAMANHO_PONTO_LOCALIZACAO;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(t * pr);
      canvas.height = Math.ceil(t * pr);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(pr, pr);
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        ctx.beginPath();
        ctx.arc(t / 2, t / 2, t / 2 - 2, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.beginPath();
        ctx.arc(t / 2, t / 2, t / 2 - 5, 0, Math.PI * 2);
        ctx.fillStyle = COR_LOCALIZACAO;
        ctx.fill();
        url = canvas.toDataURL("image/png");
      }
    }
  } catch {
    url = null;
  }
  pontosDesenhados.set(pr, url);
  return url;
}

/**
 * O marcador do ponto azul (o toque passa para o que está por baixo, como no MapLibre), ou null.
 * @param {{ lat: number, lng: number } | null | undefined} pos
 * @returns {import('./mapaGoogleWeb.js').MarcadorWeb | null}
 */
export function marcadorDaLocalizacao(pos) {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return null;
  const url = imagemDoPontoDeLocalizacao();
  if (!url) return null;
  const t = TAMANHO_PONTO_LOCALIZACAO;
  return { id: "eu", lat: pos.lat, lng: pos.lng, url, w: t, h: t, z: Z_LOCALIZACAO, zNativo: Z_LOCALIZACAO, titulo: "Sua localização", semToque: true };
}
