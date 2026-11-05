/**
 * Regras do Histórico de Movimentações do Mapa (MAIKE-MAPA-HISTORICO-
 * MOVIMENTACOES-R1, D-PROD-94). Funções puras: nada de rede, cache ou React.
 *
 * Dois escopos, com semânticas diferentes de propósito:
 *
 *  - ÁREA: todo fato com a área como origem, destino ou local do evento,
 *    independentemente de onde o lote está hoje. Área vazia não perde
 *    histórico; lote que saiu continua aparecendo na saída. Registro que não
 *    carrega área (medicamento, sanidade, manejo técnico legados) entra só se
 *    for de um lote que ESTÁ na área e depois que esse lote entrou nela.
 *  - LOTES: fatos dos lotes pelo ID, em qualquer área (trajetória).
 *
 * Vínculo de lote: registro com `lote_id` casa SÓ pelo id — homônimo nunca
 * mistura. Registro sem `lote_id` (legado) casa pelo nome, e o item sai
 * marcado `vinculo: 'nome'` para a tela dizer que o vínculo é inferido.
 *
 * ORDEM (D-PROD-123, H2): cronológica por OCORRÊNCIA do fato, a mesma do
 * servidor — (tem_ocorrencia, ocorrência, registrado, criado, id), tudo DESC;
 * ocorrência ausente/inválida = "não informada", no fim, nunca data inventada.
 */

import { idsDeLotesDoMovimento, idsDeMatrizesDoMovimento } from './manejoRebanho.js';

export const ESCOPO_AREA = 'area';
export const ESCOPO_LOTES = 'lotes';
export const TRANSFERENCIA = 'Transferência de Área';

const tempo = (valor) => {
  const t = new Date(valor ?? '').getTime();
  return Number.isFinite(t) ? t : 0;
};
/** Mesma normalização de `normalizeText` (pecuariaUtils): sem acento, maiúsculas, trim. */
const norm = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
const temTexto = (valor) => typeof valor === 'string' && valor.trim() !== '';

/**
 * Dia LITERAL de um campo de data (sem conversão de fuso): 'YYYY-MM-DD' ou
 * 'YYYY-MM-DDT…' com data de calendário válida → 'YYYY-MM-DD'; senão null.
 * Paridade com o SQL do servidor (`DIA_LEGADO`, `pg_input_is_valid`).
 * @param {unknown} valor
 * @returns {string|null}
 */
export const diaLiteral = (valor) => {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}($|T)/.test(valor)) return null;
  const dia = valor.slice(0, 10);
  if (dia.slice(0, 4) === '0000') return null;
  const d = new Date(`${dia}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === dia ? dia : null;
};

const isoOuNulo = (valor) => {
  const t = new Date(valor ?? '').getTime();
  return Number.isFinite(t) && valor ? new Date(t).toISOString() : null;
};

/**
 * @typedef {{ oc: string|null, reg: string|null, criado: string|null, id: string }} ChaveDeOrdem
 */

/**
 * Chave de ordem de um MOVIMENTO. Vindo do servidor (H2), usa as datas que
 * ele calculou (`historico_ocorrencia`, `historico_registrado_em`). Vindo do
 * cache do aparelho (offline), aplica a mesma semântica sobre o documento:
 * ocorrência = dia literal de `data_movimentacao` (no ledger é o mesmo dia
 * gravado em `data_operacional`); registro = `efeito_servidor.registrado_em`
 * ou `created_date`.
 * @param {any} mov
 * @returns {ChaveDeOrdem}
 */
export const chaveDoMovimento = (mov) => {
  const criado = isoOuNulo(mov?.created_date);
  if (mov && Object.prototype.hasOwnProperty.call(mov, 'historico_ocorrencia')) {
    return { oc: diaLiteral(mov.historico_ocorrencia), reg: isoOuNulo(mov.historico_registrado_em) ?? criado, criado, id: String(mov.id ?? '') };
  }
  return {
    oc: diaLiteral(mov?.data_movimentacao),
    reg: isoOuNulo(mov?.efeito_servidor?.registrado_em) ?? criado,
    criado,
    id: String(mov?.id ?? ''),
  };
};

/**
 * Chave de ordem de um registro de OUTRA fonte (nutrição, medicamento,
 * sanidade, manejo técnico): ocorrência = dia literal da data do fato.
 * @param {unknown} dataDoFato @param {unknown} criadoEm @param {string} id
 * @returns {ChaveDeOrdem}
 */
export const chaveDeRegistro = (dataDoFato, criadoEm, id) => {
  const criado = isoOuNulo(criadoEm);
  return { oc: diaLiteral(dataDoFato), reg: criado, criado, id: String(id ?? '') };
};

const ms = (iso) => (iso ? Date.parse(iso) : -Infinity);
/**
 * Comparador DESC da tupla H2. `id` em ordem binária (= `COLLATE "C"` do servidor).
 * @param {ChaveDeOrdem} a @param {ChaveDeOrdem} b
 */
export const compararChavesDesc = (a, b) => {
  const ta = a.oc ? 1 : 0;
  const tb = b.oc ? 1 : 0;
  if (ta !== tb) return tb - ta;
  if (a.oc !== b.oc) return /** @type {string} */ (a.oc) < /** @type {string} */ (b.oc) ? 1 : -1;
  if (ms(a.reg) !== ms(b.reg)) return ms(b.reg) - ms(a.reg);
  if (ms(a.criado) !== ms(b.criado)) return ms(b.criado) - ms(a.criado);
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

/**
 * @typedef {object} ContextoHistorico
 * @property {string} empresaId
 * @property {string} escopo `ESCOPO_AREA` ou `ESCOPO_LOTES`
 * @property {string|null} [areaId]
 * @property {Array<{id?: string, nome?: string, area_entrada_id?: string, data_entrada?: string, created_date?: string}>} [lotes]
 */

const idsDosLotes = (lotes = []) => lotes.map((l) => l?.id).filter(temTexto);
const nomesDosLotes = (lotes = []) => [...new Set(lotes.map((l) => l?.nome).filter(temTexto).map(norm))];

/**
 * Vínculo de um registro com os lotes em foco.
 * @returns {'id'|'nome'|null}
 */
export const vinculoComLotes = (loteId, loteNome, lotes = []) => {
  if (temTexto(loteId)) return idsDosLotes(lotes).includes(loteId) ? 'id' : null;
  const nome = norm(loteNome);
  return nome && nomesDosLotes(lotes).includes(nome) ? 'nome' : null;
};

/**
 * Vínculo de um MOVIMENTO do mapa: movimento agregado (R2B-P1, D-PROD-101)
 * casa por QUALQUER participante (`lote_ids`, efeitos), não só pelo primário.
 */
export const vinculoDoMovimento = (mov, lotes = []) => {
  // Paridade com o servidor (`movimentoCitaLotes`): participantes + lotes de matrizes.
  const ids = [...new Set([...idsDeLotesDoMovimento(mov), ...idsDeMatrizesDoMovimento(mov)])];
  if (ids.length > 1 || idsDeMatrizesDoMovimento(mov).length) return ids.some((id) => idsDosLotes(lotes).includes(id)) ? 'id' : null;
  return vinculoComLotes(mov?.lote_id, mov?.lote, lotes);
};

/** A movimentação toca a área (origem, destino ou local do evento)? */
export const movimentoTocaArea = (mov, areaId) =>
  temTexto(areaId) && (mov?.area_origem_id === areaId || mov?.area_destino_id === areaId || mov?.area_id === areaId);

/**
 * Mesmo filtro do servidor (`GET /movimentacoes-mapa/historico`), para o
 * caminho offline sobre o cache. Empresa sempre exigida.
 *
 * @param {any[]} movimentacoes
 * @param {ContextoHistorico} contexto
 */
export const filtrarMovimentacoes = (movimentacoes, contexto) =>
  (Array.isArray(movimentacoes) ? movimentacoes : [])
    .filter((mov) => mov && mov.empresa_id === contexto.empresaId)
    .filter((mov) =>
      contexto.escopo === ESCOPO_AREA
        ? movimentoTocaArea(mov, contexto.areaId)
        : vinculoDoMovimento(mov, contexto.lotes) !== null
    )
    .sort((a, b) => compararChavesDesc(chaveDoMovimento(a), chaveDoMovimento(b)));

/**
 * Quando cada lote em foco entrou na área (para registros SEM área). Fonte:
 * a transferência por ID para a área; senão, a entrada do próprio lote
 * (`area_entrada_id`, lote derivado de movimentação parcial). Sem prova,
 * `null` — o registro do lote entra sem corte, não é escondido por palpite.
 *
 * @param {any[]} movimentacoes já filtradas pela empresa
 * @param {ContextoHistorico} contexto
 * @returns {Map<string, number|null>}
 */
export const entradasNaArea = (movimentacoes, contexto) => {
  const mapa = new Map();
  for (const lote of contexto.lotes ?? []) {
    if (!temTexto(lote?.id)) continue;
    const transferencias = movimentacoes.filter(
      (m) => m.tipo === TRANSFERENCIA && m.lote_id === lote.id && m.area_destino_id === contexto.areaId
    );
    if (transferencias.length) {
      mapa.set(lote.id, Math.max(...transferencias.map((m) => tempo(m.created_date || m.data_movimentacao))));
    } else if (lote.area_entrada_id === contexto.areaId && (lote.created_date || lote.data_entrada)) {
      mapa.set(lote.id, tempo(lote.created_date || lote.data_entrada));
    } else {
      mapa.set(lote.id, null);
    }
  }
  return mapa;
};

/**
 * Entrada, Saída, Transferência ou Manejo, do ponto de vista da área.
 * @param {{ tipo?: string, area_origem_id?: string, area_destino_id?: string }} mov
 */
export const fluxoNaArea = (mov, areaId) => {
  if (mov?.tipo === TRANSFERENCIA) {
    if (areaId && mov.area_origem_id === areaId) return 'Saída';
    if (areaId && mov.area_destino_id === areaId) return 'Entrada';
    return 'Transferência';
  }
  if (mov?.tipo === 'Nascimento') return 'Entrada';
  if (mov?.tipo === 'Morte' || mov?.tipo === 'Abate') return 'Saída';
  return 'Manejo';
};

/**
 * Registros de outras fontes (nutrição, medicamento, sanidade, manejo
 * técnico) que pertencem ao escopo.
 *
 * @param {object} p
 * @param {any[]} p.registros
 * @param {(r: any) => string|undefined} p.loteId
 * @param {(r: any) => string|undefined} p.loteNome
 * @param {(r: any) => string|undefined} p.criadoEm
 * @param {(r: any) => boolean|null} [p.tocaArea] true/false quando o registro tem área; null quando não tem
 * @param {ContextoHistorico} p.contexto
 * @param {Map<string, number|null>} [p.entradas]
 * @returns {Array<{ registro: any, vinculo: 'id'|'nome'|'area' }>}
 */
export const filtrarRegistrosDeLote = ({ registros, loteId, loteNome, criadoEm, tocaArea, contexto, entradas }) => {
  /** @type {Array<{ registro: any, vinculo: 'id'|'nome'|'area' }>} */
  const saida = [];
  for (const registro of Array.isArray(registros) ? registros : []) {
    if (!registro || registro.empresa_id !== contexto.empresaId) continue;
    const vinculo = vinculoComLotes(loteId(registro), loteNome(registro), contexto.lotes);
    if (contexto.escopo === ESCOPO_LOTES) {
      if (vinculo) saida.push({ registro, vinculo });
      continue;
    }
    const naArea = tocaArea ? tocaArea(registro) : null;
    if (naArea === true) {
      saida.push({ registro, vinculo: vinculo ?? 'area' });
      continue;
    }
    if (naArea === false || !vinculo) continue;
    // Sem área no registro: só lote presente, e depois que entrou na área.
    const id = loteId(registro);
    const corte = vinculo === 'id' ? entradas?.get(id) ?? null : null;
    if (corte !== null && tempo(criadoEm(registro)) < corte) continue;
    saida.push({ registro, vinculo });
  }
  return saida;
};

/**
 * Ordem de exibição = ordem por ocorrência (H2), a mesma da paginação do
 * servidor. Cada item traz `ordem` (`ChaveDeOrdem`); para movimentos vindos do
 * servidor isso só reproduz a ordem global das páginas, nunca a reinventa.
 * @template {{ ordem: ChaveDeOrdem }} T
 * @param {T[]} itens
 * @returns {T[]}
 */
export const ordenarItensDoHistorico = (itens) => [...itens].sort((a, b) => compararChavesDesc(a.ordem, b.ordem));

/**
 * Cobertura das OUTRAS fontes enquanto há páginas de movimentos por carregar:
 * registro mais antigo que o último movimento carregado ficaria fora de lugar
 * (um movimento ainda não carregado pode vir antes dele). Ele espera a próxima
 * página — a lista exibida é sempre um prefixo correto da ordem global.
 * @template {{ ordem: ChaveDeOrdem }} T
 * @param {T[]} outros @param {ChaveDeOrdem|null} fronteira chave do último movimento carregado; null = sem mais páginas
 * @returns {{ visiveis: T[], adiados: number }}
 */
export const recortarPelaFronteira = (outros, fronteira) => {
  if (!fronteira) return { visiveis: outros, adiados: 0 };
  const visiveis = outros.filter((item) => compararChavesDesc(item.ordem, fronteira) <= 0);
  return { visiveis, adiados: outros.length - visiveis.length };
};
