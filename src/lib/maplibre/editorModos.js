/**
 * Máquina de estados do editor de áreas/linhas (D-PROD-65) — helpers puros.
 *
 * NAVEGAR  → arrastar/pinçar/zoom movem o mapa; nenhum toque cria vértice.
 * DESENHAR → clique curto sem movimento cria vértice (snap/45° opcionais).
 * EDITAR   → arrastar vértice, inserir no ponto médio, selecionar e remover.
 * MOVER    → (mão ativa) arrastar o interior translada todos os vértices.
 *
 * Trocar de modo nunca altera pontos, histórico, centro ou zoom.
 */

export const MODOS = Object.freeze({
  NAVEGAR: "navegar",
  DESENHAR: "desenhar",
  EDITAR: "editar",
  MOVER: "mover",
});

/** Mínimo de vértices por tipo (polígono 3, linha 2). */
export function minimoVertices(tipo) {
  return tipo === "area" ? 3 : tipo === "linha" ? 2 : 1;
}

/**
 * Modo inicial: edição de existente começa em EDITAR; novo desenho em DESENHAR.
 * @param {{ tipo?: string | null, editando?: boolean }} p
 */
export function modoInicial({ tipo, editando }) {
  if (!tipo) return MODOS.NAVEGAR;
  if (editando && (tipo === "area" || tipo === "linha")) return MODOS.EDITAR;
  return MODOS.DESENHAR;
}

/** Só DESENHAR com desenho aberto cria vértice. */
export function podeAdicionarVertice(modo, fechado) {
  return modo === MODOS.DESENHAR && !fechado;
}

/** Arrastar/inserir/remover vértice: só em EDITAR (ou ponto único em DESENHAR). */
export function podeEditarVertices(modo, tipo) {
  if (tipo === "ponto") return modo === MODOS.DESENHAR || modo === MODOS.EDITAR;
  return modo === MODOS.EDITAR;
}

/** Mover a área inteira: só com a mão (MOVER) e polígono/linha com pontos. */
export function podeMoverArea(modo, pontos) {
  return modo === MODOS.MOVER && Array.isArray(pontos) && pontos.length > 0;
}

/** Cursor do canvas por modo. */
export function cursorDoModo(modo) {
  if (modo === MODOS.DESENHAR) return "crosshair";
  if (modo === MODOS.MOVER) return "move";
  return "";
}

/**
 * Translada todos os vértices preservando a forma (delta em graus).
 * @param {{ lat: number, lng: number }[]} pontos
 * @param {number} dLat
 * @param {number} dLng
 */
export function transladarPontos(pontos, dLat, dLng) {
  if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return pontos.map((p) => ({ ...p }));
  return pontos.map((p) => ({ lat: p.lat + dLat, lng: p.lng + dLng }));
}

/**
 * Remove o vértice `index`; null quando ficaria abaixo do mínimo do tipo.
 * @param {{ lat: number, lng: number }[]} pontos
 * @param {number} index
 * @param {string} tipo
 */
export function removerVertice(pontos, index, tipo) {
  if (!Array.isArray(pontos) || !Number.isInteger(index) || index < 0 || index >= pontos.length) return null;
  if (pontos.length - 1 < minimoVertices(tipo)) return null;
  return pontos.filter((_, i) => i !== index).map((p) => ({ ...p }));
}

/**
 * Trava o ângulo do segmento em passos de 45° (espaço de pixels).
 * @param {{ x: number, y: number }} de
 * @param {{ x: number, y: number }} para
 * @returns {{ x: number, y: number }}
 */
export function travarAngulo45(de, para) {
  const dx = para.x - de.x;
  const dy = para.y - de.y;
  const dist = Math.hypot(dx, dy);
  if (!(dist > 0)) return { x: para.x, y: para.y };
  const passo = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / passo) * passo;
  return { x: de.x + Math.cos(ang) * dist, y: de.y + Math.sin(ang) * dist };
}

/**
 * Comprimentos de cada segmento (régua). `medir(a,b)` em metros (geodésico).
 * @param {{ lat: number, lng: number }[]} pontos
 * @param {boolean} fechado polígono fechado mede também o último→primeiro
 * @param {(a: any, b: any) => number} medir
 */
export function segmentosDaRegua(pontos, fechado, medir) {
  const out = [];
  const n = pontos.length;
  const total = fechado && n >= 3 ? n : n - 1;
  for (let i = 0; i < total; i += 1) {
    const a = pontos[i];
    const b = pontos[(i + 1) % n];
    out.push({ index: i, meio: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }, metros: medir(a, b) });
  }
  return out;
}

/** Desenho tem alterações em relação ao original (para avisar antes de descartar). */
export function desenhoAlterado(original, atual) {
  const a = Array.isArray(original) ? original : [];
  const b = Array.isArray(atual) ? atual : [];
  if (a.length !== b.length) return true;
  return a.some((p, i) => p.lat !== b[i].lat || p.lng !== b[i].lng);
}
