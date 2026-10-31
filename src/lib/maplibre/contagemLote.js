/**
 * Tamanho da fonte da quantidade de cabeças no marcador do lote (D-PROD-83;
 * menor e mais alto com o ícone de 44 px, D-PROD-88).
 *
 * O número fica abaixo da figura, numa faixa de LARGURA_MAXIMA_CONTAGEM px que
 * cabe dentro do ícone. Se o texto no tamanho base for mais largo que a faixa
 * (ex.: "5000" numa fonte larga, "12500"), a fonte encolhe na mesma proporção
 * da largura medida, nunca abaixo do mínimo legível.
 */

export const FONTE_CONTAGEM_BASE = 10;
export const FONTE_CONTAGEM_MINIMA = 5;
export const LARGURA_MAXIMA_CONTAGEM = 22;
export const FONTE_CONTAGEM_FAMILIA = 'Inter,Arial,sans-serif';

/** Estimativa sem DOM: dígitos em negrito ocupam ~0,6 em. */
export const larguraEstimada = (texto, px) => String(texto).length * 0.6 * px;

/**
 * Mede a largura real do texto com OffscreenCanvas; onde ele não existe
 * (ex.: jsdom nos testes), usa a estimativa.
 * @returns {(texto: string, px: number) => number}
 */
export const criarMedidorDeTexto = () => {
  const ctx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
  if (!ctx) return larguraEstimada;
  return (texto, px) => {
    ctx.font = `700 ${px}px ${FONTE_CONTAGEM_FAMILIA}`;
    const largura = ctx.measureText(String(texto)).width;
    return largura > 0 ? largura : larguraEstimada(texto, px);
  };
};

/**
 * @param {string|number} texto
 * @param {(texto: string, px: number) => number} [medir]
 * @returns {number} tamanho em px
 */
export const tamanhoFonteContagem = (texto, medir = larguraEstimada) => {
  const largura = medir(String(texto ?? ''), FONTE_CONTAGEM_BASE);
  if (largura <= LARGURA_MAXIMA_CONTAGEM) return FONTE_CONTAGEM_BASE;
  return Math.max(FONTE_CONTAGEM_MINIMA, Math.floor((FONTE_CONTAGEM_BASE * LARGURA_MAXIMA_CONTAGEM) / largura));
};
