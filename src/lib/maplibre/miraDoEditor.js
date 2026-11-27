/**
 * D-PROD-362 — a mira fixa no centro da tela do editor do mapa, como no AgriWebb: a pessoa move o MAPA por baixo
 * da mira e toca "Marcar aqui". No dedo é mais preciso que tocar no ponto (o dedo cobre o lugar), e com "Seguir
 * minha posição" a mira fica em cima de onde a pessoa está.
 *
 * Esta regra diz o que "Marcar aqui" faz em cada situação do editor; a tela só executa.
 */

/**
 * @typedef {{
 *   tipo: 'area'|'linha'|'ponto'|null|undefined,
 *   fechado: boolean,
 *   editando: boolean,
 *   selecionado: number|null,
 *   pontos: number,
 * }} SituacaoDaMira
 *
 * @typedef {{ acao: 'ponto'|'vertice'|'mover-vertice'|null, rotulo: string, dica?: string }} AcaoDaMira
 */

/**
 * @param {SituacaoDaMira} s
 * @returns {AcaoDaMira}
 */
export function acaoDaMira(s) {
  if (s.tipo === "ponto") return { acao: "ponto", rotulo: "Marcar aqui" };
  if (s.tipo !== "area" && s.tipo !== "linha") return { acao: null, rotulo: "Marcar aqui" };
  // Um vértice selecionado (Editar → toque no ponto) vai para a mira.
  if (s.selecionado != null && s.selecionado >= 0 && s.selecionado < s.pontos) {
    return { acao: "mover-vertice", rotulo: `Levar ponto ${s.selecionado + 1} para a mira` };
  }
  // Desenho novo ainda aberto: cada toque em "Marcar aqui" põe o próximo vértice.
  if (!s.editando && !s.fechado) {
    return { acao: "vertice", rotulo: s.pontos === 0 ? "Marcar 1º ponto aqui" : "Marcar ponto aqui" };
  }
  return {
    acao: null,
    rotulo: "Marcar aqui",
    dica: "Para ajustar, toque em Editar e escolha um ponto: ele vai para a mira.",
  };
}

/**
 * O centro da tela do mapa em {lat, lng} (o lugar da mira).
 * @param {any} map
 * @returns {{ lat: number, lng: number } | null}
 */
export function centroDaMira(map) {
  try {
    const c = map?.getCenter?.();
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return null;
    return { lat: c.lat, lng: c.lng };
  } catch {
    return null;
  }
}
