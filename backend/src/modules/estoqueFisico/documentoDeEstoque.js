/**
 * D-PROD-261 (R-DEDUPE) — o documento de uma mercadoria que entra no estoque é único na fazenda,
 * entre as duas portas: a entrada manual (Estoque → Novo movimento → Entrada) e o lançamento da
 * Central COM produtos (mercadoria). Um lançamento SEM produtos (só o pagamento) não mexe no
 * estoque e não conflita.
 *
 *  - Identidade: o número do documento sem espaços nas pontas e em maiúsculas, por fazenda
 *    (a entrada normaliza com `chaveDoDocumento` das regras dela; a Central já grava
 *    `documento_referencia` assim).
 *  - Trava: as duas portas tomam a MESMA trava consultiva do documento antes de consultar
 *    (`travarDocumentoDeEstoque`), depois das travas de produto; assim uma entrada e uma compra com
 *    o mesmo documento em paralelo nunca passam as duas.
 */
import { travarEscopo } from '../gestao/gestaoComum.js';

/** @param {any} tx @param {string} cli @param {string} empresaId @param {string} chave */
export const travarDocumentoDeEstoque = (tx, cli, empresaId, chave) => travarEscopo(tx, `estoque:documento:${cli}:${empresaId}:${chave}`);

/**
 * Entrada manual CONFIRMADA da fazenda com este documento.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string} chave
 * @returns {Promise<{id: string, numero: string}|null>}
 */
export const entradaManualComDocumento = async (tx, cli, empresaId, chave) => {
  const r = /** @type {any[]} */ (await tx.$queryRaw`SELECT id, numero FROM "EntradaEstoque" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId}
    AND status = 'CONFIRMADA' AND upper(btrim(documento_numero)) = ${chave} ORDER BY numero LIMIT 1`);
  return r[0] ?? null;
};

/**
 * Lançamento CONFIRMADO da Central, na fazenda, com este documento e com mercadoria (mexe no estoque).
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string} chave @param {string|null} [ignorar]
 * @returns {Promise<{id: string, numero: string, direcao: string}|null>}
 */
export const lancamentoComEstoqueComDocumento = (tx, cli, empresaId, chave, ignorar = null) =>
  tx.operacaoFinanceira.findFirst({
    where: {
      cliente_id: cli, empresa_id: empresaId, status: 'CONFIRMADO', documento_chave_ativa: chave,
      itens: { some: { cliente_id: cli, tipo_item: 'MERCADORIA' } },
      ...(ignorar ? { NOT: { id: ignorar } } : {}),
    },
    select: { id: true, numero: true, direcao: true },
  });
