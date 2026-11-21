/**
 * D-PROD-269 (MAIKE-ENTREGA2) — os CAMPOS DE CADA TIPO da "Nova realização de <Tipo>": peças puras (sem React), as
 * mesmas regras do servidor (`atividadeRegistroService.js`), que é quem decide.
 *
 *  - Plantio de pastagem: o capim (obrigatório, do Cadastro de Culturas), a safra (automática, só leitura), forma de
 *    plantio, semente incrustada, plantio de cobertura e "junto com" (consórcio), e o VC % na linha da semente;
 *  - Fertilização: a safra (automática, só leitura);
 *  - Aplicação: o alvo (do cadastro da operação, só leitura), o nº do receituário (opcional) e o "pasto liberado em"
 *    (calculado, nunca gravado);
 *  - Manutenção e Outros: a área é opcional e, sem ela, o local é obrigatório; a Manutenção tem a quantidade feita e a
 *    unidade.
 */

import { lerNumeroLocal, paraTextoDeEdicao } from './dinheiroDecimal.js';

/** As formas de plantio (o CHECK do banco), com o rótulo da tela. */
export const FORMAS_PLANTIO = Object.freeze([
  Object.freeze({ value: 'A_LANCO', label: 'A lanço' }),
  Object.freeze({ value: 'EM_LINHA', label: 'Em linha' }),
  Object.freeze({ value: 'AEREA', label: 'Aérea' }),
  Object.freeze({ value: 'MUDA', label: 'Muda' }),
]);

/** As unidades da quantidade feita quando a operação não tem unidade de produção. */
export const UNIDADES_FEITAS = Object.freeze([
  Object.freeze({ value: 'KM', label: 'KM' }),
  Object.freeze({ value: 'M', label: 'M' }),
  Object.freeze({ value: 'UN', label: 'UNIDADES' }),
]);

/** O rótulo curto da unidade feita ("1,2 km", "30 m", "4 unidades"). @param {unknown} sigla */
export const rotuloDaUnidadeFeita = (sigla) => {
  const s = typeof sigla === 'string' ? sigla.toUpperCase() : '';
  if (s === 'KM') return 'km';
  if (s === 'M') return 'm';
  if (s === 'UN') return 'unidades';
  return typeof sigla === 'string' ? sigla : '';
};

/**
 * A lista curta de alvos da Aplicação (pesquisa, §5a): lista fechada + "Outro" (escrever). O cadastro da operação grava
 * o texto em MAIÚSCULAS.
 */
export const ALVOS_DA_APLICACAO = Object.freeze(['MATO (FOLHA LARGA)', 'DESSECAR TUDO (REFORMA)', 'CIGARRINHA', 'FORMIGA', 'CUPIM', 'LAGARTA']);

/** Os tipos fixos sem área obrigatória (Manutenção e Outros). */
export const TIPOS_SEM_AREA = Object.freeze(['BENFEITORIA', 'OUTROS']);

/**
 * Quais campos o formulário mostra para o tipo fixo (e a operação, pela chave `exige_safra`).
 * @param {string} tipoFixo @param {any} [operacao]
 */
export const camposDoTipo = (tipoFixo, operacao = null) => ({
  plantio: tipoFixo === 'PLANTIO',
  safra: tipoFixo === 'PLANTIO' || tipoFixo === 'TRATO_CULTURAL' || operacao?.exige_safra === true,
  aplicacao: tipoFixo === 'APLICACAO',
  areaOpcional: TIPOS_SEM_AREA.includes(tipoFixo),
  quantidadeFeita: tipoFixo === 'BENFEITORIA',
});

/**
 * O ano agrícola do dia, de 1º de julho a 30 de junho ("AAAA/AA"): 28/11/2026 e 15/01/2027 → "2026/27". Vazio sem dia.
 * @param {string|null|undefined} dia `AAAA-MM-DD`
 */
export const safraDoDia = (dia) => {
  if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return '';
  const ano = Number(dia.slice(0, 4));
  const inicio = Number(dia.slice(5, 7)) >= 7 ? ano : ano - 1;
  return `${inicio}/${String(inicio + 1).slice(-2)}`;
};

/**
 * "Pasto liberado em": o fim do serviço (término ou dia) mais a MAIOR carência (dias) entre os produtos. Sem nenhuma
 * carência cadastrada, `{ dia: null }` (o sistema não inventa prazo).
 * @param {string|null|undefined} fim `AAAA-MM-DD` @param {Array<unknown>} carencias
 * @returns {{ dia: string|null, carencia: number|null }}
 */
export const pastoLiberadoEm = (fim, carencias) => {
  const validas = (Array.isArray(carencias) ? carencias : []).filter((c) => Number.isInteger(c) && /** @type {number} */ (c) >= 0).map(Number);
  if (!validas.length || typeof fim !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) return { dia: null, carencia: null };
  const maior = Math.max(...validas);
  const d = new Date(`${fim}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + maior);
  return { dia: d.toISOString().slice(0, 10), carencia: maior };
};

/** "dd/mm/aaaa" de um dia `AAAA-MM-DD`. @param {string|null|undefined} dia */
export const diaPorExtenso = (dia) => (typeof dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : '');

const LIMITES_VC = Object.freeze({ inteiros: 3, casas: 2 });

/**
 * O VC (%) digitado ("50", "62,5"): vazio = sem VC; senão texto canônico ("62.5") maior que 0 e até 100, ou o erro.
 * @param {unknown} texto @returns {{ valor: string|null, erro: string|null }}
 */
export const lerVc = (texto) => {
  const t = String(texto ?? '').trim();
  if (!t) return { valor: null, erro: null };
  const lido = lerNumeroLocal(t, 'pt-BR', LIMITES_VC);
  if (!lido.ok || lido.valor === null) return { valor: null, erro: 'O VC está em formato inválido: use 50 ou 62,5.' };
  const n = Number(lido.valor);
  if (!(n > 0) || n > 100) return { valor: null, erro: 'O VC é de mais de 0 até 100%.' };
  return { valor: /** @type {string} */ (lido.valor), erro: null };
};

/**
 * Os pontos de VC por hectare: kg/ha × VC% (8 kg/ha com VC 50% = 400 pontos), e os kg de semente pura viável por ha
 * (kg/ha × VC ÷ 100). Sem dose ou sem VC, null.
 * @param {string|null|undefined} doseHa canônico @param {string|null|undefined} vc canônico
 * @returns {{ pontos: number, kgSpv: number } | null}
 */
export const pontosDeVc = (doseHa, vc) => {
  const d = Number(doseHa);
  const v = Number(vc);
  if (!doseHa || !vc || !Number.isFinite(d) || !Number.isFinite(v) || d <= 0 || v <= 0) return null;
  return { pontos: Math.round(d * v), kgSpv: Math.round(d * v) / 100 };
};

/** "VC 50% · 500 pontos de VC/ha" (só o VC sem dose). @param {string|null} vc @param {string|null} doseHa */
export const textoDoVc = (vc, doseHa) => {
  if (!vc) return '';
  const pct = paraTextoDeEdicao(vc, 'pt-BR', { casasMax: 2 });
  const p = pontosDeVc(doseHa, vc);
  return p ? `VC ${pct}% · ${p.pontos.toLocaleString('pt-BR')} pontos de VC/ha` : `VC ${pct}%`;
};

/** O local digitado (Manutenção e Outros sem área): aparado, espaços juntos, em MAIÚSCULAS (como o servidor grava). @param {unknown} texto */
export const localDoTexto = (texto) => String(texto ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/** "Espécie cv. Cultivar · do cadastro de culturas" (a dica embaixo do capim). @param {any} cultura */
export const dicaDaCultura = (cultura) => {
  if (!cultura) return '';
  const especie = typeof cultura.especie === 'string' ? cultura.especie.trim() : '';
  const cultivar = typeof cultura.cultivar === 'string' ? cultura.cultivar.trim() : '';
  const nome = [especie, cultivar ? `cv. ${cultivar}` : ''].filter(Boolean).join(' ');
  return nome ? `${nome} · do cadastro de culturas` : 'do cadastro de culturas';
};

/** As culturas que servem de capim plantado: as ATIVAS de pastagem ou capineira, por código. @param {any[]} culturas */
export const capinsDoCadastro = (culturas) =>
  (Array.isArray(culturas) ? culturas : [])
    .filter((c) => c && c.ativo !== false && (c.tipo === 'PASTAGEM' || c.tipo === 'CAPINEIRA'))
    .sort((a, b) => String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''), 'pt-BR', { numeric: true }));

/** As culturas do "Junto com" (consórcio): as ATIVAS, menos o capim escolhido. @param {any[]} culturas @param {string} capimId */
export const consorciosDoCadastro = (culturas, capimId) =>
  (Array.isArray(culturas) ? culturas : [])
    .filter((c) => c && c.ativo !== false && String(c.id) !== String(capimId ?? ''))
    .sort((a, b) => String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''), 'pt-BR', { numeric: true }));

/**
 * O objeto `plantio` do corpo: o capim e só os opcionais escolhidos (o que não foi tocado não vai).
 * @param {{ culturaId: string, forma: string, incrustada: boolean|null, cobertura: boolean|null, consorcioId: string }} f
 */
export const corpoDoPlantio = ({ culturaId, forma, incrustada, cobertura, consorcioId }) => ({
  cultura_id: culturaId,
  ...(forma ? { forma_plantio: forma } : {}),
  ...(typeof incrustada === 'boolean' ? { semente_incrustada: incrustada } : {}),
  ...(typeof cobertura === 'boolean' ? { cobertura } : {}),
  ...(consorcioId ? { consorcio_cultura_id: consorcioId } : {}),
});

/**
 * O que o "+ Lançar dia" preenche do serviço (a atividade da lista): o capim e os dados do plantio, o local e a unidade.
 * @param {any} atividade
 */
export const camposDoServico = (atividade) => {
  const p = atividade?.plantio ?? null;
  return {
    culturaId: p?.cultura_id ? String(p.cultura_id) : '',
    forma: typeof p?.forma_plantio === 'string' ? p.forma_plantio : '',
    incrustada: typeof p?.semente_incrustada === 'boolean' ? p.semente_incrustada : null,
    cobertura: typeof p?.cobertura === 'boolean' ? p.cobertura : null,
    consorcioId: p?.consorcio_cultura_id ? String(p.consorcio_cultura_id) : '',
    local: typeof atividade?.local === 'string' ? atividade.local : '',
    unidade: typeof atividade?.unidade_producao_sigla === 'string' ? atividade.unidade_producao_sigla.toUpperCase() : '',
    safra: typeof atividade?.safra_ciclo === 'string' ? atividade.safra_ciclo : '',
  };
};
