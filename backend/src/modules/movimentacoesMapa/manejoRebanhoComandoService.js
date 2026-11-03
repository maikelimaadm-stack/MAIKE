/**
 * Comando atômico de manejo do rebanho — R2B-P1 (D-PROD-101) → PR174-R5.
 *
 * Nascimento, Pesagem e Mudança de Categoria: UMA confirmação da tela é UMA
 * transação PostgreSQL e UM fato do ledger, cancelável como unidade:
 *   1. valida e normaliza a forma (`lerEntradaRebanho`);
 *   2. idempotência por (cliente, operation_id, `manejo_mapa_rebanho`) +
 *      fingerprint do conteúdo normalizado;
 *   3. empresa do tenant, que precisa estar no ledger de posições
 *      (`exigirEmpresaNoLedger`; sem cutover → 409 `REBANHO_CUTOVER_PENDENTE`);
 *   4. o efeito é do ledger (`rebanhoNoLedger`) sobre POSIÇÕES. `Lote` é só o
 *      cadastro de entrada e nunca recebe efeito de manejo (PR174-R5).
 *
 * Falha em qualquer ponto → rollback integral.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { exigirEmpresaNoLedger, rebanhoNoLedger } from '../rebanhoLedger/rebanhoLedgerManejos.js';

export const COMANDO_REBANHO = 'manejo_mapa_rebanho';
export const TIPO_OPERACAO_REBANHO = 'manejo_mapa_rebanho';
export const NASCIMENTO = 'Nascimento';
export const PESAGEM = 'Pesagem';
export const MUDANCA_CATEGORIA = 'Mudança de Categoria';
export const TIPOS_DO_COMANDO_REBANHO = Object.freeze([NASCIMENTO, PESAGEM, MUDANCA_CATEGORIA]);
export const MODOS_PESAGEM = Object.freeze(['por_lote', 'por_categoria', 'todos']);
export const MAX_LINHAS = 50;
/** Domínio aceito de peso médio por cabeça (kg). Acima disso é erro de digitação. */
export const PESO_MAXIMO_KG = 3000;

/**
 * Categorias oficiais (mesma lista do `FormularioMudancaCategoria`) e o sexo
 * que cada uma implica. Categoria fora desta lista não é aceita.
 */
export const CATEGORIAS_OFICIAIS = Object.freeze({
  'Bezerro 0 a 12 meses': 'Macho',
  'Bezerra 0 a 12 meses': 'Fêmea',
  'Garrote 13 a 24 meses': 'Macho',
  'Novilha 13 a 24 meses': 'Fêmea',
  'Boi 25 a 36 meses': 'Macho',
  'Vaca 25 a 36 meses': 'Fêmea',
  'Touro + 36 meses': 'Macho',
  'Vaca + 36 meses': 'Fêmea',
});
export const SEXOS = Object.freeze(['Macho', 'Fêmea']);

/**
 * Política materna (PR168-R2, D-PROD-101): só lotes FÊMEA de categoria oficial
 * de matriz podem ser "categoria da mãe". Novilha 13-24 entra porque o
 * produto já a oferece como mãe no formulário e é a novilha de primeira cria.
 * Bezerra e qualquer categoria masculina, nunca. Nome livre não vale.
 */
export const CATEGORIAS_MATERNAS = Object.freeze(['Vaca 25 a 36 meses', 'Vaca + 36 meses', 'Novilha 13 a 24 meses']);

/** Regra existente do frontend (`categoriaDoFilhote`), agora no servidor. */
export const categoriaDoFilhote = (sexo) => (sexo === 'Macho' ? 'Bezerro 0 a 12 meses' : 'Bezerra 0 a 12 meses');

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const normal = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
const invalido = (mensagem, details = {}) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details });
const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });

const categoriaOficial = (valor) => Object.keys(CATEGORIAS_OFICIAIS).find((c) => normal(c) === normal(valor)) ?? null;

/** Data operacional estrita (mesma regra do comando R2A). */
export const dataOperacionalValida = (valor) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(valor || '');
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia && !Number.isNaN(new Date(valor).getTime());
};

const pesoDaEntrada = (valor, campo, obrigatorio) => {
  if (valor === null || valor === undefined || valor === '') {
    if (obrigatorio) throw invalido('peso obrigatório', { field: campo });
    return null;
  }
  const n = typeof valor === 'number' ? valor : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > PESO_MAXIMO_KG) {
    throw invalido(`peso deve ser número positivo até ${PESO_MAXIMO_KG} kg`, { field: campo });
  }
  return Number(n.toFixed(4));
};

const inteiroPositivo = (valor, campo) => {
  if (!Number.isInteger(valor) || valor <= 0) throw invalido('quantidade deve ser inteiro positivo', { field: campo });
  return valor;
};

/**
 * Valida e normaliza a forma. A ordem das linhas é preservada (é o que o
 * usuário viu); o fingerprint usa esta forma normalizada.
 */
export const lerEntradaRebanho = (entrada) => {
  const tipo = texto(entrada?.tipo);
  if (!TIPOS_DO_COMANDO_REBANHO.includes(tipo)) throw invalido('tipo de manejo não suportado pelo comando', { field: 'tipo' });
  const operationKey = texto(entrada?.operation_id);
  const empresaId = texto(entrada?.empresa_id);
  const areaId = texto(entrada?.area_id);
  const dataMovimentacao = texto(entrada?.data_movimentacao);
  if (!operationKey || !empresaId || !areaId || !dataMovimentacao) {
    throw invalido('operation_id, empresa_id, area_id e data_movimentacao são obrigatórios');
  }
  if (!dataOperacionalValida(dataMovimentacao)) throw invalido('data_movimentacao inválida', { field: 'data_movimentacao' });
  const linhasBrutas = entrada?.linhas;
  if (!Array.isArray(linhasBrutas) || linhasBrutas.length === 0 || linhasBrutas.length > MAX_LINHAS) {
    throw invalido(`linhas deve ter de 1 a ${MAX_LINHAS} itens`, { field: 'linhas' });
  }
  const observacoes = typeof entrada?.observacoes === 'string' ? entrada.observacoes.trim() || null : null;
  const modoPesagem = tipo === PESAGEM ? texto(entrada?.modo_pesagem) ?? 'por_lote' : null;
  if (modoPesagem && !MODOS_PESAGEM.includes(modoPesagem)) throw invalido('modo_pesagem inválido', { field: 'modo_pesagem' });

  const linhas = linhasBrutas.map((l, i) => {
    const campo = (k) => `linhas[${i}].${k}`;
    if (!l || typeof l !== 'object') throw invalido('linha inválida', { field: `linhas[${i}]` });
    if (tipo === NASCIMENTO) {
      const sexo = texto(l.sexo);
      if (!SEXOS.includes(sexo)) throw invalido('sexo deve ser Macho ou Fêmea', { field: campo('sexo') });
      const categoriaMae = texto(l.categoria_mae);
      if (!categoriaMae) throw invalido('categoria da mãe obrigatória', { field: campo('categoria_mae') });
      return {
        sexo,
        categoria_mae: categoriaMae,
        quantidade: inteiroPositivo(l.quantidade, campo('quantidade')),
        peso_medio_kg: pesoDaEntrada(l.peso_medio_kg, campo('peso_medio_kg'), false),
      };
    }
    if (tipo === PESAGEM) {
      const loteId = texto(l.lote_id);
      if (!loteId) throw invalido('lote_id obrigatório', { field: campo('lote_id') });
      return { lote_id: loteId, categoria: texto(l.categoria), peso_medio_kg: pesoDaEntrada(l.peso_medio_kg, campo('peso_medio_kg'), true) };
    }
    const atual = texto(l.categoria_atual);
    const nova = categoriaOficial(l.categoria_nova);
    if (!atual) throw invalido('categoria atual obrigatória', { field: campo('categoria_atual') });
    if (!nova) throw invalido('categoria nova fora das categorias oficiais', { field: campo('categoria_nova') });
    if (normal(atual) === normal(nova)) throw invalido('categoria nova igual à atual', { field: campo('categoria_nova') });
    return {
      categoria_atual: atual,
      categoria_nova: nova,
      quantidade: inteiroPositivo(l.quantidade, campo('quantidade')),
      categoria_manejo_id_novo: texto(l.categoria_manejo_id_novo),
      peso_medio_kg: pesoDaEntrada(l.peso_medio_kg, campo('peso_medio_kg'), false),
    };
  });
  if (tipo === PESAGEM) {
    const ids = linhas.map((l) => l.lote_id);
    if (new Set(ids).size !== ids.length) throw invalido('lote repetido na pesagem', { field: 'linhas' });
  }
  return { operationKey, tipo, empresaId, areaId, dataMovimentacao, observacoes, modoPesagem, linhas };
};

/**
 * Categoria de manejo da empresa para uma categoria oficial. Com id: precisa
 * existir, estar ativa e ser DESSA categoria oficial. Sem id: a única ativa
 * dessa categoria; nenhuma → sem categoria de manejo; mais de uma → ambíguo,
 * o formulário precisa escolher (não se adivinha).
 */
const resolverCategoriaManejo = async (tx, clienteId, empresaId, oficial, idPedido) => {
  if (idPedido) {
    const c = await tx.categoriaManejo.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id: idPedido, ativo: true } });
    if (!c || normal(c.categoria_oficial) !== normal(oficial)) {
      throw recusa('MANEJO_CATEGORIA_INVALIDA', 'categoria de manejo inexistente, inativa ou de outra categoria oficial', { categoria_manejo_id: idPedido });
    }
    return c;
  }
  const candidatas = (await tx.categoriaManejo.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, ativo: true } })).filter(
    (c) => normal(c.categoria_oficial) === normal(oficial)
  );
  if (candidatas.length > 1) {
    throw recusa('MANEJO_CATEGORIA_AMBIGUA', 'há mais de uma categoria de manejo ativa para esta categoria; escolha uma', { categoria: oficial });
  }
  return candidatas[0] ?? null;
};

// ─── Comando ───────────────────────────────────────────────────────────────

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const executarManejoRebanho = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const e = lerEntradaRebanho(entrada);
  const fingerprint = fingerprintDePayload({ comando: COMANDO_REBANHO, ...e, operationKey: undefined });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey: e.operationKey,
      tipoOperacao: TIPO_OPERACAO_REBANHO,
      fingerprint,
      executar: async () => {
        const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: e.empresaId } }, select: { id: true } });
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');
        // R2E-R1 (D-PROD-107): Nascimento/Pesagem/Mudança sobre POSIÇÕES (nunca Lote).
        await exigirEmpresaNoLedger(tx, auth.clienteId, e.empresaId); // PR174-R5: sem modelo legado
        return rebanhoNoLedger(tx, contexto, e, { CATEGORIAS_OFICIAIS, CATEGORIAS_MATERNAS, categoriaDoFilhote, resolverCategoriaManejo });
      },
    })
  );
  return { status: resultado.httpStatus, body: { ...resultado.body, replay: resultado.replay } };
};
