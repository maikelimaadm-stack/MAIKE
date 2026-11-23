/**
 * Bloco `[RATEIO_FIFO]` das observações da baixa do cocho e da transferência (D-PROD-161), extraído sem mudança de
 * `movimentacaoEstoqueComandoService.js` para que o recálculo da exclusão (D-PROD-273, fatia 4) refaça o rateio
 * quando as fatias de um movimento posterior mudam. Puro.
 */
import { Dec, dec } from '../financeiro/decimalFinanceiro.js';

/** VarChar(2000) de `MovimentacaoEstoque.observacoes` (schema.prisma). */
const LIMITE_OBSERVACOES = 2000;
export const ROTULO_RATEIO = '[RATEIO_FIFO] ';

/**
 * Observações do usuário (≤ 2000 pelo schema da rota) + `\n[RATEIO_FIFO] NF: q kg | …`
 * com q em Decimal HALF_UP(3). Se passar de 2000 caracteres, corta SÓ o bloco
 * gerado (com reticências) e nunca o texto do usuário; sem espaço útil, o bloco sai.
 * @param {unknown} texto
 * @param {Array<{ quantidade: any, lote: { numero_documento?: string|null } }>} fatias
 */
export const comporObservacoes = (texto, fatias) => {
  const usuario = typeof texto === 'string' ? texto : '';
  const partes = fatias.map((f) => `${f.lote?.numero_documento || 'S/N'}: ${dec(f.quantidade).toFixed(3, Dec.ROUND_HALF_UP)} kg`);
  const gerado = partes.length ? [...`${ROTULO_RATEIO}${partes.join(' | ')}`] : [];
  const cabe = LIMITE_OBSERVACOES - [...usuario].length - (usuario ? 1 : 0);
  let bloco = '';
  if (gerado.length <= cabe) bloco = gerado.join('');
  else if (cabe > ROTULO_RATEIO.length + 1) bloco = `${gerado.slice(0, cabe - 1).join('')}…`;
  return [usuario, bloco].filter(Boolean).join('\n');
};

/**
 * Refaz o bloco do rateio de observações gravadas por `comporObservacoes` com as fatias novas. Sem o bloco
 * (observação livre, movimento de outra origem): `null` (nada a refazer).
 * @param {string|null|undefined} observacoes @param {Array<{ quantidade: any, lote: { numero_documento?: string|null } }>} fatias
 */
export const recomporRateio = (observacoes, fatias) => {
  if (typeof observacoes !== 'string') return null;
  const i = observacoes.startsWith(ROTULO_RATEIO) ? 0 : observacoes.lastIndexOf(`\n${ROTULO_RATEIO}`);
  if (i < 0) return null;
  const usuario = i === 0 ? '' : observacoes.slice(0, i);
  return comporObservacoes(usuario, fatias);
};
