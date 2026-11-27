/**
 * Mapa do Google nativo no app Android/iOS (D-PROD-366, etapa 1).
 *
 * O Google não cobra pelo mapa nativo dos SDKs de Android e iOS (Maps SDK), e o próprio SDK guarda as imagens já
 * vistas no aparelho: é o mapa do AgriWebb. No site o mapa continua o MapLibre (o Google Maps do navegador é cobrado).
 *
 * Etapa 1: só as áreas (polígonos com as cores do Mapa Geral) sobre o satélite do Google, e o toque na área abre o
 * mesmo detalhe. Fica atrás de uma escolha do próprio aparelho ("Mapa do Google (teste)") e só aparece com o plugin
 * nativo instalado (APK 1.0.6 em diante). Sem o plugin — APK antigo recebendo a atualização automática, site,
 * testes — nada muda: o Mapa Geral segue no MapLibre.
 */
import { Capacitor } from "@capacitor/core";

import { parseVertices } from "@/lib/geografia/coords.js";
import { COR_LINHA_AREA, OPACIDADE_FILL_AREA } from "@/lib/maplibre/estiloAreas.js";

/** Nome com que o plugin `@capacitor/google-maps` se registra. */
export const PLUGIN_MAPA_GOOGLE = "CapacitorGoogleMaps";
/** Escolha do aparelho (localStorage): "1" liga o mapa do Google no Mapa Geral. */
export const CHAVE_PREFERENCIA = "mk_mapa_google_nativo";
/** Cor de reserva da área sem cor (a mesma do MapLibre). */
export const COR_AREA_PADRAO = "#94a3b8";

/** O app tem o mapa nativo do Google (plugin instalado no APK)? */
export function temMapaGoogleNativo() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(PLUGIN_MAPA_GOOGLE);
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

/** O Mapa Geral usa o mapa do Google agora (plugin no aparelho e escolha ligada). */
export function usarMapaGoogleNativo() {
  return temMapaGoogleNativo() && lerPreferenciaMapaGoogle();
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
 * Polígonos do Google para as áreas do Mapa Geral. Área sem contorno válido (menos de 3 vértices) fica de fora, como
 * no MapLibre. `tag` = id da área: o toque no polígono devolve a área.
 * @param {any[]} areas
 * @param {(area: any) => string | null | undefined} corDaArea
 * @param {string} [estilo]
 */
export function poligonosDasAreas(areas, corDaArea, estilo) {
  /** @type {Array<{ paths: Array<{ lat: number, lng: number }>, fillColor: string, fillOpacity: number, strokeColor: string, strokeWeight: number, clickable: boolean, tag: string }>} */
  const saida = [];
  for (const area of areas || []) {
    const pontos = parseVertices(area?.coordenadas?.coords);
    if (pontos.length < 3 || area?.id == null) continue;
    const cor = (corDaArea && corDaArea(area)) || COR_AREA_PADRAO;
    saida.push({
      paths: pontos.map((p) => ({ lat: p.lat, lng: p.lng })),
      fillColor: cor,
      ...estiloDoPoligono(estilo, cor),
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
 * começa no mesmo lugar.
 * @param {string | null | undefined} empresaId
 */
export const chaveDaVistaSalva = (empresaId) => `mapa_geral_view_${empresaId || "default"}`;
