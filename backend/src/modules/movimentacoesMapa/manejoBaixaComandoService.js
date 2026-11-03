/**
 * Comando atômico de BAIXA multi-lote (Morte / Abate) — R2D-P1 (D-PROD-105) → PR174-R5.
 *
 * UMA confirmação do formulário (todas as categorias dela) é:
 *   1. validação da forma (`lerEntradaBaixa`): só categoria e quantidade por
 *      linha, metadados de morte/abate e, opcionalmente, `lotes_selecionados`
 *      (apenas FILTRO, relido e revalidado no servidor);
 *   2. UMA reserva idempotente `manejo_mapa_baixa_rebanho` + fingerprint
 *      canônico (replay idêntico devolve o mesmo resultado; mesma chave com
 *      conteúdo diferente → 409);
 *   3. empresa do tenant, que precisa estar no ledger de posições
 *      (`exigirEmpresaNoLedger`; sem cutover → 409 `REBANHO_CUTOVER_PENDENTE`);
 *   4. a baixa é do ledger (`baixaNoLedger`) sobre as POSIÇÕES da área, com a
 *      política determinística `distribuirBaixa` / `POLITICA_ALOCACAO`.
 *      `Lote` é só o cadastro de entrada e nunca recebe efeito de manejo
 *      (PR174-R5).
 *
 * Metadados: causa (Morte) e peso vivo/carcaça/destino (Abate) são TOTAIS DA
 * LINHA como digitados — ficam na linha, nunca multiplicados nem rateados.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { exigirEmpresaNoLedger, baixaNoLedger } from '../rebanhoLedger/rebanhoLedgerManejos.js';
import { CATEGORIAS_OFICIAIS, dataOperacionalValida } from './manejoRebanhoComandoService.js';
import {
  ABATE,
  CAUSAS_MORTE,
  COMANDO_BAIXA,
  DESTINOS_ABATE,
  DESTINOS_COM_NOME,
  MAX_LINHAS_BAIXA,
  MAX_LOTES_SELECIONADOS,
  MORTE,
  PESO_MAXIMO_POR_CABECA_KG,
  POLITICA_ALOCACAO,
  TIPO_OPERACAO_BAIXA,
  TIPOS_BAIXA,
} from './baixaConstantes.js';

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const normal = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
const invalido = (mensagem, details = {}) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details });
const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });
const ausente = (v) => v === null || v === undefined || v === '';

const pesoTotal = (valor, campo, quantidade) => {
  if (ausente(valor)) return null;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > quantidade * PESO_MAXIMO_POR_CABECA_KG) {
    throw invalido(`peso total deve ser número positivo até ${PESO_MAXIMO_POR_CABECA_KG} kg por cabeça`, { field: campo });
  }
  return Number(valor.toFixed(4));
};

/** Forma canônica (também é a base do fingerprint). Nada de saldo, lote ou efeito do cliente. */
export const lerEntradaBaixa = (entrada) => {
  const operationKey = texto(entrada?.operation_id);
  const tipo = texto(entrada?.tipo);
  const empresaId = texto(entrada?.empresa_id);
  const areaId = texto(entrada?.area_id);
  const dataMovimentacao = texto(entrada?.data_movimentacao);
  if (!operationKey || !empresaId || !areaId || !dataMovimentacao) {
    throw invalido('operation_id, tipo, empresa_id, area_id, data_movimentacao e linhas são obrigatórios');
  }
  if (!TIPOS_BAIXA.includes(tipo)) throw invalido('tipo deve ser Morte ou Abate', { field: 'tipo' });
  if (!dataOperacionalValida(dataMovimentacao)) throw invalido('data_movimentacao inválida', { field: 'data_movimentacao' });
  const brutas = entrada?.linhas;
  if (!Array.isArray(brutas) || brutas.length < 1 || brutas.length > MAX_LINHAS_BAIXA) {
    throw invalido(`linhas deve ter de 1 a ${MAX_LINHAS_BAIXA} itens`, { field: 'linhas' });
  }
  const linhas = brutas.map((l, i) => {
    const campo = (k) => `linhas[${i}].${k}`;
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw invalido('linha inválida', { field: `linhas[${i}]` });
    const categoria = texto(l.categoria);
    if (!categoria) throw invalido('categoria obrigatória', { field: campo('categoria') });
    const quantidade = l.quantidade;
    if (!Number.isInteger(quantidade) || quantidade <= 0) throw invalido('quantidade deve ser inteiro positivo', { field: campo('quantidade') });
    if (tipo === MORTE) {
      for (const k of ['peso_vivo_total_kg', 'peso_carcaca_total_kg', 'destino', 'destino_nome']) {
        if (!ausente(l[k])) throw invalido('campo de abate em registro de morte', { field: campo(k) });
      }
      const causa = texto(l.causa_morte);
      if (!causa || !CAUSAS_MORTE.includes(causa)) throw invalido('causa_morte obrigatória e de uma das opções do formulário', { field: campo('causa_morte') });
      return { categoria, quantidade, causa_morte: causa };
    }
    if (!ausente(l.causa_morte)) throw invalido('causa de morte em registro de abate', { field: campo('causa_morte') });
    const pesoVivo = pesoTotal(l.peso_vivo_total_kg, campo('peso_vivo_total_kg'), quantidade);
    const pesoCarcaca = pesoTotal(l.peso_carcaca_total_kg, campo('peso_carcaca_total_kg'), quantidade);
    if (pesoVivo !== null && pesoCarcaca !== null && pesoCarcaca > pesoVivo) {
      throw invalido('peso de carcaça maior que o peso vivo', { field: campo('peso_carcaca_total_kg') });
    }
    const destino = texto(l.destino);
    if (destino && !DESTINOS_ABATE.includes(destino)) throw invalido('destino fora das opções do formulário', { field: campo('destino') });
    const destinoNome = texto(l.destino_nome);
    if (destinoNome && !destino) throw invalido('destino_nome sem destino', { field: campo('destino_nome') });
    if (destino && DESTINOS_COM_NOME.includes(destino) && !destinoNome) throw invalido('nome do frigorífico/cliente obrigatório para este destino', { field: campo('destino_nome') });
    return { categoria, quantidade, peso_vivo_total_kg: pesoVivo, peso_carcaca_total_kg: pesoCarcaca, destino, destino_nome: destinoNome ? destinoNome.toUpperCase() : null };
  });
  let selecionados = null;
  if (entrada?.lotes_selecionados !== undefined) {
    const brutos = entrada.lotes_selecionados;
    if (!Array.isArray(brutos) || brutos.length < 1 || brutos.length > MAX_LOTES_SELECIONADOS || brutos.some((id) => !texto(id))) {
      throw invalido(`lotes_selecionados deve ter de 1 a ${MAX_LOTES_SELECIONADOS} ids`, { field: 'lotes_selecionados' });
    }
    selecionados = [...new Set(brutos.map(texto))].sort();
  }
  const observacoes = typeof entrada?.observacoes === 'string' ? entrada.observacoes.trim() || null : null;
  return { operationKey, tipo, empresaId, areaId, dataMovimentacao, observacoes, linhas, selecionados };
};

/** Ordem determinística: numero_lote numérico crescente, depois texto/vazio, depois id. */
export const ordemDeAlocacao = (a, b) => {
  const chave = (l) => {
    const t = String(l.numero_lote ?? '').trim();
    const n = /^\d+$/.test(t) ? Number(t) : null;
    return [n === null ? 1 : 0, n ?? 0, t, l.id];
  };
  const [x, y] = [chave(a), chave(b)];
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] < y[i]) return -1;
    if (x[i] > y[i]) return 1;
  }
  return 0;
};

/**
 * Distribuição pura (sem banco): para cada linha, consome os lotes elegíveis
 * da categoria na ordem da política, compartilhando o saldo entre linhas da
 * mesma categoria. Saldo insuficiente → recusa com o disponível.
 * @param {Array<any>} lotesDaArea lotes operáveis da área
 * @param {Array<{categoria: string, quantidade: number}>} linhas
 */
export const distribuirBaixa = (lotesDaArea, linhas) => {
  const saldo = new Map(lotesDaArea.map((l) => [l.id, l.quantidade_cabecas]));
  const pedidoPorCategoria = new Map();
  for (const linha of linhas) pedidoPorCategoria.set(normal(linha.categoria), (pedidoPorCategoria.get(normal(linha.categoria)) ?? 0) + linha.quantidade);
  for (const [cat, pedido] of pedidoPorCategoria) {
    const disponivel = lotesDaArea.filter((l) => normal(l.categoria) === cat).reduce((t, l) => t + l.quantidade_cabecas, 0);
    if (disponivel < pedido) {
      throw recusa('BAIXA_SALDO_INSUFICIENTE', 'a categoria não tem cabeças suficientes nos lotes ativos desta área; nada foi baixado', {
        categoria: linhas.find((l) => normal(l.categoria) === cat).categoria,
        disponivel,
        pedido,
      });
    }
  }
  return linhas.map((linha) => {
    let restante = linha.quantidade;
    const distribuicao = [];
    for (const l of lotesDaArea.filter((x) => normal(x.categoria) === normal(linha.categoria)).sort(ordemDeAlocacao)) {
      if (restante <= 0) break;
      const q = Math.min(restante, saldo.get(l.id));
      if (q <= 0) continue;
      saldo.set(l.id, saldo.get(l.id) - q);
      restante -= q;
      distribuicao.push({ lote_id: l.id, quantidade: q });
    }
    return { ...linha, distribuicao };
  });
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const executarBaixaRebanho = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const e = lerEntradaBaixa(entrada);
  const fingerprint = fingerprintDePayload({ comando: COMANDO_BAIXA, ...e, operationKey: undefined });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey: e.operationKey,
      tipoOperacao: TIPO_OPERACAO_BAIXA,
      fingerprint,
      executar: async () => {
        const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: e.empresaId } }, select: { id: true } });
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');
        // R2E-R1 (D-PROD-107): baixa das POSIÇÕES da área (nunca Lote).
        await exigirEmpresaNoLedger(tx, auth.clienteId, e.empresaId); // PR174-R5: sem modelo legado
        return baixaNoLedger(tx, contexto, e, { CATEGORIAS_OFICIAIS, distribuirBaixa, POLITICA_ALOCACAO });
      },
    })
  );
  return { status: resultado.httpStatus, body: { ...resultado.body, replay: resultado.replay } };
};

export { ABATE, MORTE };
