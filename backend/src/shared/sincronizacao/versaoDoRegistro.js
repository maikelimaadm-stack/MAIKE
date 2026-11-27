/**
 * D-PROD-316 — Etapa 3 da sincronização: a VERSÃO do registro e quem alterou.
 *
 * Sem versão, duas pessoas (ou dois aparelhos, um deles sem internet) editando o mesmo registro: a última gravação
 * apagava a outra em silêncio. Agora a edição leva a versão que a pessoa viu (`versao_esperada`) e o servidor só grava
 * se o registro ainda está naquela versão; senão, 409 `REGISTRO_VERSAO_CONFLITO`, nada gravado, com quem alterou e
 * quando, para a pessoa abrir de novo e refazer.
 *
 * A versão é o `updatedAt` do registro (ISO, milissegundos): o Prisma o atualiza em TODA gravação, inclusive as
 * internas (ledger, cascatas) e o UPDATE cru do ponto usa `now()` (conferido na D-PROD-309). Assim qualquer mudança no
 * registro muda a versão, sem migration e sem ter de lembrar de "incrementar" em cada caminho de escrita.
 *
 * Compatível: sem `versao_esperada` (app antigo, cascata interna, comando do servidor), grava como antes.
 * Quem chama segura a trava da linha (FOR NO KEY UPDATE) antes de ler o registro.
 * O tenant vem do `auth_context` (R11); toda consulta começa por `cliente_id`.
 */
import { AppError } from '../errors/AppError.js';

/** Nome do campo no corpo da edição. */
export const CAMPO_VERSAO_ESPERADA = 'versao_esperada';

/** Schema JSON do campo (rotas). */
export const SCHEMA_VERSAO_ESPERADA = Object.freeze({ type: 'string', minLength: 1, maxLength: 40 });

/** @param {unknown} v */
const iso = (v) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? new Date(v).toISOString() : null);

/** A versão do registro (o `updatedAt` em ISO). @param {{ updatedAt?: unknown }} registro */
export const versaoDe = (registro) => iso(registro?.updatedAt);

/**
 * Tira `versao_esperada` do corpo (ela nunca é coluna).
 * @template {Record<string, unknown>} T
 * @param {T} entrada
 * @returns {{ versaoEsperada: string|null, resto: Omit<T, 'versao_esperada'> }}
 */
export const separarVersaoEsperada = (entrada) => {
  const { [CAMPO_VERSAO_ESPERADA]: v, ...resto } = /** @type {any} */ (entrada ?? {});
  if (v === undefined || v === null) return { versaoEsperada: null, resto };
  if (typeof v !== 'string' || !v || Number.isNaN(Date.parse(v))) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'versao_esperada inválida', { details: { field: CAMPO_VERSAO_ESPERADA, reason: 'formato' } });
  }
  return { versaoEsperada: v, resto };
};

/**
 * A última alteração registrada na auditoria (quem e quando), para a mensagem do conflito.
 * @param {any} tx @param {string} clienteId @param {string} entidade @param {string} entidadeId
 */
export const ultimaAlteracao = async (tx, clienteId, entidade, entidadeId) => {
  const a = await tx.auditLog.findFirst({
    where: { cliente_id: clienteId, entidade, entidade_id: entidadeId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { usuario_id: true, createdAt: true },
  });
  if (!a) return { alterado_por_id: null, alterado_por_nome: null, alterado_em: null };
  const u = a.usuario_id ? await tx.usuario.findFirst({ where: { cliente_id: clienteId, id: a.usuario_id }, select: { nome: true, login: true } }) : null;
  return { alterado_por_id: a.usuario_id ?? null, alterado_por_nome: u?.nome || u?.login || null, alterado_em: iso(a.createdAt) };
};

/** Valor comparável: datas em ISO, números (inclusive Decimal) como número, vazio como null. @param {unknown} v */
const comparavel = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v !== null && typeof (/** @type {any} */ (v).toNumber) === 'function') return /** @type {any} */ (v).toNumber();
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
};

/**
 * D-PROD-341 — a edição pedida JÁ ESTÁ no registro? (cada campo pedido igual ao atual)
 *
 * Com o sinal fraco, a edição pode chegar ao servidor e a resposta se perder; o aparelho a guarda e manda de novo com a
 * mesma `versao_esperada`. A primeira gravação mudou a versão, e a repetição levava 409 como se outra pessoa tivesse
 * alterado. Quando o registro já está exatamente como a edição pede, não há conflito: quem alterou foi ela mesma.
 * Pedido vazio nunca conta como aplicado.
 * @param {Record<string, unknown>} registro @param {Record<string, unknown>|null|undefined} pedido
 */
export const pedidoJaAplicado = (registro, pedido) => {
  const campos = Object.keys(pedido ?? {});
  if (!campos.length) return false;
  return campos.every((c) => comparavel(/** @type {any} */ (pedido)[c]) === comparavel(registro?.[c]));
};

/**
 * Exige que o registro ainda esteja na versão que a pessoa viu. Sem versão esperada, nada a conferir.
 * @param {any} tx
 * @param {{ clienteId: string, entidade: string, registro: { id: string, updatedAt?: unknown }, versaoEsperada: string|null, rotulo: string,
 *   pedido?: Record<string, unknown> }} a
 * `rotulo`: o nome do registro na mensagem ("o lote", "o cocho"). `pedido`: os campos que a edição grava (D-PROD-341: se o
 * registro já está assim, a repetição da mesma edição não é conflito).
 * @throws 409 `REGISTRO_VERSAO_CONFLITO` (nada gravado)
 */
export const exigirVersaoEsperada = async (tx, a) => {
  if (!a.versaoEsperada) return;
  const atual = versaoDe(a.registro);
  if (atual && iso(a.versaoEsperada) === atual) return;
  if (pedidoJaAplicado(/** @type {any} */ (a.registro), a.pedido)) return;
  const ultima = await ultimaAlteracao(tx, a.clienteId, a.entidade, a.registro.id);
  const quem = ultima.alterado_por_nome ? ` por ${ultima.alterado_por_nome}` : '';
  throw new AppError('REGISTRO_VERSAO_CONFLITO', `${a.rotulo} foi alterado${quem} depois que você abriu; abra de novo e refaça a alteração; nada foi gravado`, {
    details: { field: CAMPO_VERSAO_ESPERADA, reason: 'registro_alterado', entidade: a.entidade, id: a.registro.id, versao_atual: atual, ...ultima },
  });
};
