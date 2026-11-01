/**
 * Proteção de registros operacionais (R2A, D-PROD-95).
 *
 * Movimento que afeta saldo de animais ou de estoque não se apaga nem se
 * reescreve por rota genérica: o caminho é o cancelamento server-side,
 * transacional e auditado. Esta camada vale no SERVICE — chamada direta à API,
 * replay offline e frontend antigo batem aqui, não só a tela.
 *
 * Exceções são allow-lists fechadas de campos que o fluxo normal grava e que não
 * mexem em saldo (métricas de fechamento de período da suplementação; nome
 * exibido do local de estoque, conferido contra o local vinculado).
 */

import { AppError } from '../errors/AppError.js';

/** Campos de situação/cancelamento: só o servidor escreve. */
export const CAMPOS_RESERVADOS_CANCELAMENTO = Object.freeze([
  'situacao',
  'cancelado',
  'cancelamento',
  'cancelamento_operation_id',
  'estorno',
  'estornado',
  // R2A-R1: proveniência e vínculo de destino são escritos só pelo comando
  // atômico de manejo (`/movimentacoes-mapa/comandos/manejo-lote`).
  'efeito_servidor',
  'modo_transferencia',
  'lote_destino_id',
]);

/** @param {unknown} entrada */
export const rejeitarCamposReservados = (entrada) => {
  if (!entrada || typeof entrada !== 'object') return;
  const encontrados = CAMPOS_RESERVADOS_CANCELAMENTO.filter((campo) =>
    Object.prototype.hasOwnProperty.call(entrada, campo)
  );
  if (encontrados.length) {
    throw new AppError('CAMPO_RESERVADO_CANCELAMENTO', 'situação e cancelamento são definidos só pelo servidor', {
      details: { campos: encontrados },
    });
  }
};

/** @param {string} entidade */
export const movimentoExigeCancelamento = (entidade) =>
  new AppError(
    'MOVIMENTO_CANCELAMENTO_OBRIGATORIO',
    'movimento operacional não é excluído nem alterado diretamente; use o cancelamento',
    { details: { entidade } }
  );

/**
 * Aceita só os campos da allow-list (mais `empresa_id` igual ao atual, que
 * clientes antigos reenviam). Qualquer outro campo → 409, nada gravado.
 *
 * @param {Record<string, unknown>} entrada
 * @param {readonly string[]} permitidos
 * @param {{ entidade: string, empresaAtual?: string|null }} opcoes
 */
export const exigirSomenteCamposPermitidos = (entrada, permitidos, { entidade, empresaAtual = null }) => {
  rejeitarCamposReservados(entrada);
  const proibidos = Object.keys(entrada || {}).filter((campo) => {
    if (permitidos.includes(campo)) return false;
    if (campo === 'empresa_id' && empresaAtual && entrada.empresa_id === empresaAtual) return false;
    return true;
  });
  if (proibidos.length) {
    throw new AppError('REGISTRO_OPERACIONAL_IMUTAVEL', 'campo operacional não é alterável por PATCH', {
      details: { entidade, campos: proibidos },
    });
  }
};

/** Valores aceitos nos campos de métrica: número finito ou null. */
export const exigirNumerosOuNulo = (entrada, entidade) => {
  for (const [campo, valor] of Object.entries(entrada || {})) {
    if (campo === 'empresa_id') continue;
    if (valor === null) continue;
    if (typeof valor !== 'number' || !Number.isFinite(valor)) {
      throw new AppError('REQUEST_VALIDATION_FAILED', 'métrica deve ser número ou null', {
        details: { entidade, field: campo, reason: 'type' },
      });
    }
  }
};
