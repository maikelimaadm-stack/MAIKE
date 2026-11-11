import { SaxesParser } from 'saxes';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
export const MAX_SVG_BYTES = 512 * 1024;
const ELEMENTOS = new Set([
  'svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'use', 'title', 'desc',
  'text', 'tspan', 'filter', 'feGaussianBlur', 'feColorMatrix', 'feBlend', 'feComposite',
  'feOffset', 'feFlood', 'feMerge', 'feMergeNode', 'feDropShadow',
]);
const ATRIBUTOS = new Set((
  'id class style x y x1 y1 x2 y2 dx dy width height viewbox preserveaspectratio version ' +
  'zoomandpan fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap ' +
  'stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color ' +
  'd points transform cx cy r rx ry clip-path clip-rule mask maskunits maskcontentunits ' +
  'gradientunits gradienttransform offset stop-color stop-opacity spreadmethod href ' +
  'filter filterunits primitiveunits in in2 result stddeviation type values mode operator ' +
  'k1 k2 k3 k4 flood-color flood-opacity color-interpolation-filters vector-effect ' +
  'font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing ' +
  'textlength lengthadjust role aria-label aria-hidden focusable space'
).split(/\s+/));
const DESENHOS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use', 'text']);

/** @param {Buffer} buffer */
export const pareceSvg = (buffer) => /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?=[\s/>])/i
  .test(buffer.toString('utf8', 0, 1024).replace(/^\uFEFF/, ''));

/**
 * Aceita somente gráficos SVG estáticos. O XML é analisado, sem executar scripts,
 * carregar referências externas ou converter os caminhos em pixels.
 * @param {Buffer} buffer
 * @returns {{largura: number|null, altura: number|null}}
 */
export function validarSvgEstatico(buffer) {
  if (!buffer.length || buffer.length > MAX_SVG_BYTES) throw new Error('SVG deve ter até 512 KB');
  const texto = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  const parser = new SaxesParser({ xmlns: true });
  let profundidade = 0;
  let elementos = 0;
  let desenhos = 0;
  let largura = /** @type {number|null} */ (null);
  let altura = /** @type {number|null} */ (null);
  const medida = (/** @type {string|undefined} */ valor) => {
    if (!valor || !/^\d+(?:\.\d+)?(?:px)?$/.test(valor)) return null;
    const n = Number.parseFloat(valor);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  parser.on('error', (erro) => { throw erro; });
  parser.on('doctype', () => { throw new Error('SVG não pode conter DOCTYPE'); });
  parser.on('processinginstruction', () => { throw new Error('SVG não pode conter instruções externas'); });
  parser.on('opentag', (tag) => {
    profundidade += 1;
    elementos += 1;
    if (profundidade > 64 || elementos > 10000) throw new Error('SVG excede complexidade permitida');
    if (tag.uri !== SVG_NS || !ELEMENTOS.has(tag.local)) throw new Error(`Elemento SVG não permitido: ${tag.local}`);
    if (elementos === 1 && tag.local !== 'svg') throw new Error('Documento deve começar por svg');
    if (DESENHOS.has(tag.local)) desenhos += 1;
    for (const atributo of Object.values(tag.attributes)) {
      if (atributo.uri === XMLNS_NS) {
        if (![SVG_NS, XLINK_NS].includes(atributo.value)) throw new Error('Namespace SVG não permitido');
        continue;
      }
      const nome = atributo.local.toLowerCase();
      if (!ATRIBUTOS.has(nome)) throw new Error(`Atributo SVG não permitido: ${nome}`);
      if (atributo.uri && atributo.uri !== XLINK_NS && !(atributo.prefix === 'xml' && nome === 'space')) {
        throw new Error('Namespace de atributo SVG não permitido');
      }
      const valor = atributo.value;
      if (nome === 'href' && !/^#[a-z_][\w:.-]*$/i.test(valor)) throw new Error('SVG não pode carregar imagens ou referências externas');
      const semUrlLocal = valor.replace(/url\(\s*(['"]?)#[a-z_][\w:.-]*\1\s*\)/gi, '');
      if (/url\s*\(|@|expression\s*\(|(?:javascript|data|https?):|[\\<>]|\/\*|\*\//i.test(semUrlLocal)) {
        throw new Error('SVG contém referência ou estilo não permitido');
      }
    }
    if (elementos === 1) {
      largura = medida(tag.attributes.width?.value);
      altura = medida(tag.attributes.height?.value);
      const vb = tag.attributes.viewBox?.value.trim().split(/[\s,]+/).map(Number);
      if (vb?.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
        largura ??= vb[2];
        altura ??= vb[3];
      }
    }
  });
  parser.on('closetag', () => { profundidade -= 1; });
  parser.write(texto).close();
  if (!desenhos || largura === null || altura === null) throw new Error('SVG precisa conter desenho e dimensões ou viewBox válidos');
  return { largura, altura };
}
