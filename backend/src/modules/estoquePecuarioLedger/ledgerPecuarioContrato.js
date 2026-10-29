/**
 * Contrato PURO do ledger de estoque pecuário por área (L1 — sem I/O).
 *
 * Decisão do proprietário (ver CONTRATO.md):
 *  - a ENTRADA de um lote é fato histórico: 1.000 animais entram na área A e
 *    esse número nunca é reescrito por movimento posterior;
 *  - TRANSFERÊNCIA é fato conservativo: débito na origem + crédito no destino,
 *    mesma empresa e mesma categoria; o total da empresa não muda;
 *  - a POSIÇÃO (saldo por área + categoria) é derivada dos fatos e pode ser
 *    reconstruída somando as partidas;
 *  - não há rastreio "qual compra" depois da mistura: a posição agrega;
 *  - correção é ESTORNO (novo evento com partidas inversas), nunca UPDATE/DELETE.
 *
 * Este módulo só valida, normaliza e calcula deltas. Quem aplica com trava e
 * transação é `ledgerPecuarioComandoService.js`.
 */

import { CODIGOS_LEDGER_PECUARIO as C, LedgerPecuarioError } from './ledgerPecuarioErros.js';

export const TIPOS_EVENTO = Object.freeze({
  ENTRADA: 'ENTRADA',
  TRANSFERENCIA: 'TRANSFERENCIA',
  ESTORNO: 'ESTORNO',
});

/** Categoria ausente é EXPLÍCITA — nunca string vazia, nunca adivinhada por nome. */
export const CATEGORIA_SEM = 'SEM_CATEGORIA';
const PREFIXO_CATEGORIA_MANEJO = 'cm:';
const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Limite defensivo por evento (rebanho real fica muito abaixo; evita overflow de int4). */
export const QUANTIDADE_MAXIMA_POR_EVENTO = 1_000_000;

/**
 * Quantidade de cabeças: inteiro positivo. Rejeita "10", 10.5, 0, negativos,
 * NaN e Infinity — sem coerção silenciosa.
 * @param {unknown} valor
 * @returns {number}
 */
export const normalizarQuantidade = (valor) => {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor <= 0 || valor > QUANTIDADE_MAXIMA_POR_EVENTO) {
    throw new LedgerPecuarioError(C.QUANTIDADE_INVALIDA, 'quantidade deve ser inteiro positivo', {
      details: { field: 'quantidade' },
    });
  }
  return valor;
};

/**
 * @param {unknown} valor
 * @param {string} campo
 * @param {string} codigo
 * @returns {string}
 */
const exigirId = (valor, campo, codigo) => {
  const id = typeof valor === 'string' ? valor.trim() : '';
  if (!RE_ID.test(id)) {
    throw new LedgerPecuarioError(codigo, `${campo} inválido`, { details: { field: campo } });
  }
  return id;
};

/**
 * Chave canônica da categoria: ID estável da CategoriaManejo (`cm:<id>`) ou
 * `SEM_CATEGORIA` quando o chamador declara explicitamente que não há. Nome
 * livre ("BOI", "Vaca ") NUNCA vira chave — é exatamente a inferência por
 * texto que o legado faz e que o contrato proíbe.
 * @param {{ categoria_manejo_id?: unknown, sem_categoria?: unknown }} entrada
 * @returns {{ chave: string, categoriaManejoId: string | null }}
 */
export const normalizarCategoria = (entrada) => {
  const temId = entrada.categoria_manejo_id !== undefined && entrada.categoria_manejo_id !== null;
  const semCategoria = entrada.sem_categoria === true;
  if (temId && semCategoria) {
    throw new LedgerPecuarioError(C.CATEGORIA_INVALIDA, 'informe categoria_manejo_id OU sem_categoria, não ambos', {
      details: { field: 'categoria_manejo_id' },
    });
  }
  if (semCategoria) return { chave: CATEGORIA_SEM, categoriaManejoId: null };
  if (!temId) {
    throw new LedgerPecuarioError(C.CATEGORIA_INVALIDA, 'categoria obrigatória (categoria_manejo_id ou sem_categoria: true)', {
      details: { field: 'categoria_manejo_id' },
    });
  }
  const id = exigirId(entrada.categoria_manejo_id, 'categoria_manejo_id', C.CATEGORIA_INVALIDA);
  return { chave: `${PREFIXO_CATEGORIA_MANEJO}${id}`, categoriaManejoId: id };
};

/**
 * @param {unknown} valor
 * @returns {string} AAAA-MM-DD (data operacional; não é o createdAt)
 */
export const normalizarDataOperacional = (valor) => {
  const texto = typeof valor === 'string' ? valor.trim().slice(0, 10) : '';
  if (!RE_DATA.test(texto) || Number.isNaN(Date.parse(`${texto}T12:00:00.000Z`))) {
    throw new LedgerPecuarioError(C.DATA_INVALIDA, 'data_operacional deve ser AAAA-MM-DD', {
      details: { field: 'data_operacional' },
    });
  }
  return texto;
};

/**
 * @param {unknown} valor
 * @returns {string}
 */
export const normalizarOperationId = (valor) => {
  const chave = typeof valor === 'string' ? valor.trim() : '';
  if (chave.length < 8 || chave.length > 128) {
    throw new LedgerPecuarioError(C.OPERACAO_INVALIDA, 'operation_id inválido (8–128 caracteres)', {
      details: { field: 'operation_id' },
    });
  }
  return chave;
};

/**
 * @typedef {{ area_id: string, categoria_chave: string, delta: number }} Partida
 * @typedef {{
 *   tipo: string,
 *   empresa_id: string,
 *   categoria_chave: string,
 *   categoria_manejo_id: string | null,
 *   quantidade: number,
 *   area_origem_id: string | null,
 *   area_destino_id: string | null,
 *   lote_referencia_id: string | null,
 *   data_operacional: string,
 *   motivo: string | null,
 *   partidas: Partida[],
 * }} EventoPlanejado
 */

/**
 * @param {unknown} valor
 * @returns {string | null}
 */
const textoOpcional = (valor) => {
  if (valor === undefined || valor === null) return null;
  const t = String(valor).trim();
  return t ? t.slice(0, 255) : null;
};

/**
 * ENTRADA histórica: um crédito na área de entrada. `lote_referencia_id`
 * aponta para o cadastro do lote (fato de compra/nascimento) — só referência;
 * o ledger nunca escreve no Lote.
 * @param {Record<string, unknown>} entrada
 * @returns {EventoPlanejado}
 */
export const planejarEntrada = (entrada) => {
  const empresaId = exigirId(entrada.empresa_id, 'empresa_id', C.EMPRESA_INVALIDA);
  const areaDestino = exigirId(entrada.area_id, 'area_id', C.DESTINO_INVALIDO);
  const quantidade = normalizarQuantidade(entrada.quantidade);
  const { chave, categoriaManejoId } = normalizarCategoria(entrada);
  const lote =
    entrada.lote_referencia_id === undefined || entrada.lote_referencia_id === null
      ? null
      : exigirId(entrada.lote_referencia_id, 'lote_referencia_id', C.LOTE_REFERENCIA_INVALIDO);
  return {
    tipo: TIPOS_EVENTO.ENTRADA,
    empresa_id: empresaId,
    categoria_chave: chave,
    categoria_manejo_id: categoriaManejoId,
    quantidade,
    area_origem_id: null,
    area_destino_id: areaDestino,
    lote_referencia_id: lote,
    data_operacional: normalizarDataOperacional(entrada.data_operacional),
    motivo: textoOpcional(entrada.motivo),
    partidas: [{ area_id: areaDestino, categoria_chave: chave, delta: quantidade }],
  };
};

/**
 * TRANSFERÊNCIA interna conservativa: −q na origem, +q no destino.
 * Origem e destino comparados por ID (nunca por nome).
 * @param {Record<string, unknown>} entrada
 * @returns {EventoPlanejado}
 */
export const planejarTransferencia = (entrada) => {
  const empresaId = exigirId(entrada.empresa_id, 'empresa_id', C.EMPRESA_INVALIDA);
  const origem = exigirId(entrada.area_origem_id, 'area_origem_id', C.ORIGEM_INVALIDA);
  const destino = exigirId(entrada.area_destino_id, 'area_destino_id', C.DESTINO_INVALIDO);
  if (origem === destino) {
    throw new LedgerPecuarioError(C.ORIGEM_IGUAL_DESTINO, 'origem e destino são a mesma área', {
      details: { field: 'area_destino_id' },
    });
  }
  const quantidade = normalizarQuantidade(entrada.quantidade);
  const { chave, categoriaManejoId } = normalizarCategoria(entrada);
  return {
    tipo: TIPOS_EVENTO.TRANSFERENCIA,
    empresa_id: empresaId,
    categoria_chave: chave,
    categoria_manejo_id: categoriaManejoId,
    quantidade,
    area_origem_id: origem,
    area_destino_id: destino,
    lote_referencia_id: null,
    data_operacional: normalizarDataOperacional(entrada.data_operacional),
    motivo: textoOpcional(entrada.motivo),
    partidas: [
      { area_id: origem, categoria_chave: chave, delta: -quantidade },
      { area_id: destino, categoria_chave: chave, delta: quantidade },
    ],
  };
};

/**
 * ESTORNO append-only: partidas exatamente inversas às do evento original.
 * Estorno de estorno é recusado (corrigir um estorno = lançar o fato de novo).
 * @param {{ tipo: string, empresa_id: string, categoria_chave: string, quantidade: number, area_origem_id: string | null, area_destino_id: string | null }} original
 * @param {{ partidas: Partida[] }} partidasOriginais
 * @param {Record<string, unknown>} entrada
 * @returns {EventoPlanejado}
 */
export const planejarEstorno = (original, partidasOriginais, entrada) => {
  if (original.tipo === TIPOS_EVENTO.ESTORNO) {
    throw new LedgerPecuarioError(C.ESTORNO_INVALIDO, 'não é possível estornar um estorno', {
      details: { field: 'evento_id' },
    });
  }
  const motivo = textoOpcional(entrada.motivo);
  if (!motivo) {
    throw new LedgerPecuarioError(C.ESTORNO_INVALIDO, 'estorno exige motivo', { details: { field: 'motivo' } });
  }
  return {
    tipo: TIPOS_EVENTO.ESTORNO,
    empresa_id: original.empresa_id,
    categoria_chave: original.categoria_chave,
    categoria_manejo_id: original.categoria_chave.startsWith(PREFIXO_CATEGORIA_MANEJO)
      ? original.categoria_chave.slice(PREFIXO_CATEGORIA_MANEJO.length)
      : null,
    quantidade: original.quantidade,
    area_origem_id: original.area_destino_id,
    area_destino_id: original.area_origem_id,
    lote_referencia_id: null,
    data_operacional: normalizarDataOperacional(entrada.data_operacional),
    motivo,
    partidas: partidasOriginais.partidas.map((p) => ({ ...p, delta: -p.delta })),
  };
};

/**
 * Ordem determinística de trava (evita deadlock entre transações que tocam
 * as mesmas posições em ordem diferente, ex.: A→B concorrente com B→A).
 * @param {Partida[]} partidas
 * @returns {Array<{ area_id: string, categoria_chave: string }>}
 */
export const chavesDeTravaOrdenadas = (partidas) => {
  const vistas = new Map();
  for (const p of partidas) vistas.set(`${p.area_id}\u0000${p.categoria_chave}`, { area_id: p.area_id, categoria_chave: p.categoria_chave });
  return [...vistas.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
};

/**
 * Aplica partidas a um mapa de saldos (puro). Lança SALDO_INSUFICIENTE se
 * qualquer posição ficaria negativa — o mesmo critério que o serviço aplica
 * sob trava. Retorna um NOVO mapa (não muta a entrada).
 * @param {Map<string, number>} saldos chave `${area}\u0000${categoria}` → saldo
 * @param {Partida[]} partidas
 * @returns {Map<string, number>}
 */
export const aplicarPartidas = (saldos, partidas) => {
  const novo = new Map(saldos);
  for (const p of partidas) {
    const k = `${p.area_id}\u0000${p.categoria_chave}`;
    const atual = novo.get(k) ?? 0;
    const depois = atual + p.delta;
    if (depois < 0) {
      throw new LedgerPecuarioError(C.SALDO_INSUFICIENTE, 'saldo insuficiente na posição de origem', {
        details: { area_id: p.area_id, categoria_chave: p.categoria_chave, saldo: atual, solicitado: -p.delta },
      });
    }
    novo.set(k, depois);
  }
  return novo;
};

/** Soma algébrica das partidas — 0 em transferência/estorno de transferência. */
export const somaDeltas = (partidas) => partidas.reduce((t, p) => t + p.delta, 0);

/**
 * Payload canônico para fingerprint de idempotência (mesma chave + payload
 * diferente = conflito). Sem campos derivados de tempo de servidor.
 * @param {string} tipoComando
 * @param {Record<string, unknown>} entrada
 */
export const payloadCanonico = (tipoComando, entrada) => {
  const campos = [
    'empresa_id',
    'area_id',
    'area_origem_id',
    'area_destino_id',
    'quantidade',
    'categoria_manejo_id',
    'sem_categoria',
    'lote_referencia_id',
    'data_operacional',
    'motivo',
    'evento_id',
  ];
  /** @type {Record<string, unknown>} */
  const canon = { comando: tipoComando };
  for (const c of campos) canon[c] = entrada[c] === undefined ? null : entrada[c];
  return canon;
};
