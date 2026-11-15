/**
 * Leitura de cocho e farol do cocho (D-PROD-205) — fonte única.
 *
 * Funções PURAS: sem React, sem `window`, sem storage, sem rede e sem
 * `new Date()` sem argumento. O dia civil de "hoje" (AAAA-MM-DD, no fuso da
 * fazenda) chega sempre por parâmetro (`useDiaCivil(fuso)` / `hojeNoFuso`).
 *
 * Farol = a ÚLTIMA leitura do cocho (dia da leitura, depois a hora do registro):
 *  - VAZIO → vermelho (falta produto: abastecer);
 *  - ADEQUADO → verde;
 *  - CHEIO → azul (sobrando: o gado come menos que o previsto);
 *  - sem leitura, ou a última com mais de `diasValidade` dias (padrão 2) → cinza
 *    "Sem leitura recente". Hoje, ontem e anteontem valem; 3 dias atrás, não.
 * Avisos (acesso RUIM, estrutura REPARO/QUEBRADA) vêm SEMPRE da última leitura,
 * mesmo vencida, com a data: um cocho quebrado continua quebrado até alguém
 * registrar o contrário.
 * A leitura não movimenta estoque e não muda o nível do cocho (D-PROD-178).
 */

import { diasEntre, ehDiaValido } from '@/lib/diaCivil';

export const ESCORES = Object.freeze(['VAZIO', 'ADEQUADO', 'CHEIO']);
export const ACESSOS = Object.freeze(['BOM', 'RUIM']);
export const ESTRUTURAS = Object.freeze(['BOA', 'REPARO', 'QUEBRADA']);

export const ROTULO_ESCORE = Object.freeze({ VAZIO: 'Vazio', ADEQUADO: 'Adequado', CHEIO: 'Cheio' });
export const ROTULO_ACESSO = Object.freeze({ BOM: 'Bom', RUIM: 'Ruim' });
export const ROTULO_ESTRUTURA = Object.freeze({ BOA: 'Boa', REPARO: 'Precisa de reparo', QUEBRADA: 'Quebrada' });

/** Validade padrão da leitura no farol, em dias. */
export const DIAS_VALIDADE_PADRAO = 2;

/** Cores do farol (hex para o marcador do mapa; classes ficam na tela). */
export const COR_FAROL = Object.freeze({ vermelho: '#dc2626', verde: '#16a34a', azul: '#2563eb', cinza: '#94a3b8' });

const COR_DO_ESCORE = Object.freeze({ VAZIO: 'vermelho', ADEQUADO: 'verde', CHEIO: 'azul' });

/** @param {any} l */
const chaveDeOrdem = (l) => `${String(l?.data_leitura ?? '').slice(0, 10)}|${String(l?.created_date ?? '')}|${String(l?.id ?? '')}`;

/**
 * Leituras de um cocho, da mais recente para a mais antiga.
 * @param {any[]|null|undefined} leituras
 * @param {unknown} pontoId
 * @returns {any[]}
 */
export const leiturasDoPonto = (leituras, pontoId) =>
  (Array.isArray(leituras) ? leituras : [])
    .filter((l) => l && String(l.ponto_suplementacao_id) === String(pontoId) && ehDiaValido(String(l.data_leitura ?? '').slice(0, 10)))
    .sort((a, b) => (chaveDeOrdem(a) < chaveDeOrdem(b) ? 1 : chaveDeOrdem(a) > chaveDeOrdem(b) ? -1 : 0));

/**
 * A última leitura do cocho (ou null).
 * @param {any[]|null|undefined} leituras
 * @param {unknown} pontoId
 */
export const ultimaLeituraDoPonto = (leituras, pontoId) => leiturasDoPonto(leituras, pontoId)[0] ?? null;

/**
 * Avisos de manutenção de uma leitura (acesso ruim, estrutura com problema).
 * @param {any} leitura
 * @returns {Array<{ tipo: 'acesso'|'estrutura', texto: string }>}
 */
export const avisosDaLeitura = (leitura) => {
  if (!leitura) return [];
  const avisos = [];
  if (leitura.acesso === 'RUIM') avisos.push({ tipo: /** @type {const} */ ('acesso'), texto: 'Acesso ruim ao cocho' });
  if (leitura.estrutura === 'REPARO') avisos.push({ tipo: /** @type {const} */ ('estrutura'), texto: 'Estrutura precisa de reparo' });
  if (leitura.estrutura === 'QUEBRADA') avisos.push({ tipo: /** @type {const} */ ('estrutura'), texto: 'Estrutura quebrada' });
  return avisos;
};

/**
 * @typedef {{
 *   cor: 'vermelho'|'verde'|'azul'|'cinza',
 *   hex: string,
 *   rotulo: string,
 *   leitura: any|null,
 *   idadeDias: number|null,
 *   vencida: boolean,
 *   avisos: Array<{ tipo: 'acesso'|'estrutura', texto: string }>,
 * }} FarolCocho
 */

/**
 * Farol do cocho pela última leitura.
 * @param {{ leituras: any[]|null|undefined, pontoId: unknown, hoje: string|null|undefined, diasValidade?: number }} p
 * @returns {FarolCocho}
 */
export const farolDoCocho = ({ leituras, pontoId, hoje, diasValidade = DIAS_VALIDADE_PADRAO }) => {
  const leitura = ultimaLeituraDoPonto(leituras, pontoId);
  const avisos = avisosDaLeitura(leitura);
  if (!leitura) {
    return { cor: 'cinza', hex: COR_FAROL.cinza, rotulo: 'Sem leitura recente', leitura: null, idadeDias: null, vencida: true, avisos };
  }
  const dia = String(leitura.data_leitura).slice(0, 10);
  const idade = ehDiaValido(String(hoje ?? '')) ? diasEntre(dia, /** @type {string} */ (hoje)) : null;
  const idadeDias = idade === null ? null : Math.max(0, idade);
  const vencida = idadeDias === null || idadeDias > diasValidade;
  if (vencida) {
    return { cor: 'cinza', hex: COR_FAROL.cinza, rotulo: 'Sem leitura recente', leitura, idadeDias, vencida: true, avisos };
  }
  const cor = COR_DO_ESCORE[leitura.escore] ?? 'cinza';
  const rotulo = cor === 'cinza' ? 'Sem leitura recente' : `Cocho ${String(ROTULO_ESCORE[leitura.escore]).toLowerCase()}`;
  return { cor, hex: COR_FAROL[cor], rotulo, leitura, idadeDias, vencida: cor === 'cinza', avisos };
};

/**
 * Texto curto do farol para o marcador (title/aria-label) do mapa.
 * @param {FarolCocho} farol
 */
export const descreverFarol = (farol) => {
  const partes = [`Leitura: ${farol.rotulo}`];
  if (farol.avisos.length) partes.push(farol.avisos.map((a) => a.texto).join(', '));
  return partes.join(' · ');
};
