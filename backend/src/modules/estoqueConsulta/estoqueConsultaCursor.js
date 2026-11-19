/**
 * D-PROD-255 (Estoque E1/E2, P1-04) — cursor ASSINADO das consultas de estoque.
 *
 * Extraído do desenho do cursor da reconciliação (`reconciliacaoEstoque.js`,
 * D-PROD-161) com rótulo próprio: `base64url(JSON(posição) ‖ HMAC-SHA256(k,
 * amarra ‖ "\n" ‖ corpo))`, `k` derivada do AUTH_SECRET por HKDF. A `amarra`
 * prende o cursor ao tipo da consulta, ao tenant do `auth_context`, à empresa e
 * aos filtros e ao limite pedidos; qualquer desvio (forma, assinatura, outro
 * tenant, outro filtro) é o MESMO 400 `REQUEST_VALIDATION_FAILED {field:'cursor',
 * reason:'cursor_invalido'}`, sem oráculo e antes de qualquer ida ao banco.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';

const ROTULO = 'maike-estoque-consulta-cursor:v1';
const SAL = 'maike-estoque-consulta';
const TAMANHO_MAC = 32;
export const TAMANHO_MAXIMO_CURSOR = 4096;

const cursorInvalido = () =>
  new AppError('REQUEST_VALIDATION_FAILED', 'cursor inválido; recomece a consulta sem cursor', {
    details: { field: 'cursor', reason: 'cursor_invalido' },
  });

let chaveCache = /** @type {Buffer|null} */ (null);
let segredoCache = /** @type {string|null} */ (null);
const chave = () => {
  const segredo = env.authSecret;
  if (!segredo) throw new AppError('INTERNAL_ERROR', 'segredo do servidor ausente');
  if (segredoCache !== segredo) {
    chaveCache = Buffer.from(hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.from(SAL, 'utf8'), ROTULO, TAMANHO_MAC));
    segredoCache = segredo;
  }
  return /** @type {Buffer} */ (chaveCache);
};

/** @param {unknown[]} amarra @param {Buffer} corpo */
const macDe = (amarra, corpo) => createHmac('sha256', chave()).update(JSON.stringify(amarra)).update('\n').update(corpo).digest();

/**
 * @param {unknown[]} amarra tipo, tenant, empresa, filtros e limite
 * @param {unknown[]} posicao tupla serializável (a última linha da página)
 * @returns {string}
 */
export const codificarCursorConsulta = (amarra, posicao) => {
  const corpo = Buffer.from(JSON.stringify(posicao), 'utf8');
  return Buffer.concat([corpo, macDe(amarra, corpo)]).toString('base64url');
};

/**
 * @param {unknown} bruto
 * @param {unknown[]} amarra
 * @returns {unknown[]} a tupla de posição
 */
export const decodificarCursorConsulta = (bruto, amarra) => {
  if (typeof bruto !== 'string' || !new RegExp(`^[A-Za-z0-9_-]{1,${TAMANHO_MAXIMO_CURSOR}}$`).test(bruto)) throw cursorInvalido();
  const bytes = Buffer.from(bruto, 'base64url');
  if (bytes.toString('base64url') !== bruto || bytes.length <= TAMANHO_MAC) throw cursorInvalido();
  const corpo = bytes.subarray(0, bytes.length - TAMANHO_MAC);
  const recebido = bytes.subarray(bytes.length - TAMANHO_MAC);
  if (!timingSafeEqual(macDe(amarra, corpo), recebido)) throw cursorInvalido();
  try {
    const posicao = JSON.parse(corpo.toString('utf8'));
    if (!Array.isArray(posicao)) throw cursorInvalido();
    return posicao;
  } catch {
    throw cursorInvalido();
  }
};
