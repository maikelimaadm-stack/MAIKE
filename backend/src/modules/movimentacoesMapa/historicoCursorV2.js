/**
 * Cursor v2 do histórico de movimentações (D-PROD-123, H2).
 *
 * A ordem do histórico é a da OCORRÊNCIA do fato, não a do cadastro:
 *
 *   (tem_ocorrencia DESC, ocorrencia DESC, registrado_em DESC, createdAt DESC, id DESC)
 *
 * O cursor carrega exatamente essa tupla — a mesma do ORDER BY e do predicado
 * keyset (`movimentacaoMapaRepository.js`). Não reaproveita o `keysetCursor`
 * compartilhado (createdAt + id), que outros módulos usam e que continua igual.
 *
 * Formato: base64url(JSON { v: 2, o, r, c, i, e, s }):
 *   o = ocorrência 'YYYY-MM-DD' ou null (sem ocorrência informada/válida);
 *   r = registrado_em ISO (ms); c = createdAt ISO (ms); i = id;
 *   e = hash do escopo (tenant + empresa + área + lotes + nomes);
 *   s = HMAC-SHA256 do conteúdo, chave derivada do AUTH_SECRET.
 *
 * O cursor NÃO é autoridade: tenant e filtros vêm do token e da query e são
 * reaplicados no SQL. A assinatura só impede reposicionamento adulterado; o
 * hash de escopo impede reaproveitar o cursor de outra consulta.
 *
 * Qualquer cursor recusado (v1, malformado, adulterado, de outro escopo) é o
 * mesmo 400 estável `HISTORICO_CURSOR_INVALIDO`, com `details.motivo`; o
 * cliente reinicia do começo só nesse código.
 */
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';

export const VERSAO_CURSOR_HISTORICO = 2;
export const ORDEM_HISTORICO = 'ocorrencia_desc_v2';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ID = /^[\x21-\x7e]{1,64}$/;

/** @param {'versao_antiga'|'malformado'|'adulterado'|'escopo_divergente'} motivo */
export const cursorInvalido = (motivo) =>
  new AppError('HISTORICO_CURSOR_INVALIDO', 'cursor do histórico inválido; recomece do início', {
    details: { motivo, versao_aceita: VERSAO_CURSOR_HISTORICO },
  });

let chaveCache = /** @type {Buffer|null} */ (null);
let segredoCache = /** @type {string|null} */ (null);
const chave = () => {
  const segredo = env.authSecret;
  if (!segredo) throw new AppError('INTERNAL_ERROR', 'segredo do servidor ausente');
  if (segredoCache !== segredo) {
    chaveCache = Buffer.from(hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.alloc(0), 'maike-historico-cursor:v2', 32));
    segredoCache = segredo;
  }
  return /** @type {Buffer} */ (chaveCache);
};

/**
 * Hash do escopo da consulta. Listas ordenadas: a mesma consulta gera o mesmo
 * escopo independentemente da ordem dos parâmetros.
 * @param {string} clienteId
 * @param {{ empresaId: string, areaId?: string|null, loteIds?: string[], lotesNomesLegado?: string[] }} filtro
 */
export const hashDoEscopo = (clienteId, filtro) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        clienteId,
        filtro.empresaId,
        filtro.areaId ?? null,
        [...(filtro.loteIds ?? [])].sort(),
        [...(filtro.lotesNomesLegado ?? [])].sort(),
      ])
    )
    .digest('base64url')
    .slice(0, 22);

const conteudo = (p) => JSON.stringify([p.v, p.o, p.r, p.c, p.i, p.e]);
const assinar = (p) => createHmac('sha256', chave()).update(conteudo(p)).digest('base64url');

const isoMs = (valor) => {
  const d = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/**
 * @param {{ ocorrencia: string|null, registrado_em: Date|string, createdAt: Date|string, id: string }} linha
 * @param {string} escopo hash do escopo
 */
export const codificarCursorHistorico = (linha, escopo) => {
  const p = {
    v: VERSAO_CURSOR_HISTORICO,
    o: linha.ocorrencia ?? null,
    r: isoMs(linha.registrado_em),
    c: isoMs(linha.createdAt),
    i: String(linha.id),
    e: escopo,
  };
  return Buffer.from(JSON.stringify({ ...p, s: assinar(p) }), 'utf8').toString('base64url');
};

const diaValido = (s) => {
  if (!DIA.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * Decodifica e confere o cursor. Lança `HISTORICO_CURSOR_INVALIDO` em
 * qualquer desvio — nunca devolve posição parcial ou "melhor palpite".
 * @param {string} bruto
 * @param {string} escopo hash do escopo da consulta atual
 * @returns {{ ocorrencia: string|null, registrado: string, createdAt: string, id: string }}
 */
export const decodificarCursorHistorico = (bruto, escopo) => {
  let obj;
  try {
    obj = JSON.parse(Buffer.from(String(bruto), 'base64url').toString('utf8'));
  } catch {
    throw cursorInvalido('malformado');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw cursorInvalido('malformado');
  // v1 (keyset compartilhado): { t: createdAt, i: id }, sem versão.
  if (obj.v === undefined && 't' in obj && 'i' in obj) throw cursorInvalido('versao_antiga');
  if (obj.v !== VERSAO_CURSOR_HISTORICO) throw cursorInvalido(typeof obj.v === 'number' && obj.v < VERSAO_CURSOR_HISTORICO ? 'versao_antiga' : 'malformado');
  const chaves = Object.keys(obj).sort().join(',');
  if (chaves !== 'c,e,i,o,r,s,v') throw cursorInvalido('malformado');
  const { o, r, c, i, e, s } = obj;
  if (!(o === null || (typeof o === 'string' && diaValido(o)))) throw cursorInvalido('malformado');
  if (typeof r !== 'string' || !ISO_MS.test(r) || isoMs(r) !== r) throw cursorInvalido('malformado');
  if (typeof c !== 'string' || !ISO_MS.test(c) || isoMs(c) !== c) throw cursorInvalido('malformado');
  if (typeof i !== 'string' || !ID.test(i)) throw cursorInvalido('malformado');
  if (typeof e !== 'string' || typeof s !== 'string') throw cursorInvalido('malformado');
  const esperado = Buffer.from(assinar({ v: obj.v, o, r, c, i, e }));
  const recebido = Buffer.from(s);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) throw cursorInvalido('adulterado');
  if (e !== escopo) throw cursorInvalido('escopo_divergente');
  return { ocorrencia: o, registrado: r, createdAt: c, id: i };
};
