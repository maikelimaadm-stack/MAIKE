/**
 * Documentos JSON tenant-scoped (P5.5) — formato público compatível com Base44.
 */

import { AppError } from '../errors/AppError.js';

const RESERVADOS = new Set(['id', 'cliente_id', 'createdAt', 'updatedAt', 'created_date', 'updated_date']);

/**
 * Documento público = `dados` + campos de servidor.
 *
 * `empresa_id` vem da COLUNA (D-PROD-94). `montarDocumento` tira o campo do
 * corpo e grava só na coluna; devolver apenas `dados` fazia todo documento
 * lido sair sem `empresa_id`, e quem filtra por empresa (histórico do lote,
 * cache do mapa) descartava tudo. Um `empresa_id` ou `cliente_id` que esteja
 * dentro de `dados` (legado, importação) nunca vence a coluna nem vaza.
 *
 * @param {Record<string, unknown>} registro
 */
export const documentoComoPublico = (registro) => {
  if (!registro || typeof registro !== 'object') return registro;
  const { id, dados, empresa_id, createdAt, updatedAt } =
    /** @type {{id: string, dados: object, empresa_id?: string, createdAt: Date, updatedAt: Date}} */ (registro);
  const base = dados && typeof dados === 'object' && !Array.isArray(dados) ? { ...dados } : {};
  for (const chave of RESERVADOS) delete base[chave];
  delete base.empresa_id;
  return {
    ...base,
    ...(typeof empresa_id === 'string' && empresa_id ? { empresa_id } : {}),
    id,
    created_date: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    updated_date: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
};

/**
 * @param {string} clienteId
 * @param {Record<string, unknown>} entrada
 * @param {{ atualizacao?: boolean, id?: string, dadosAnteriores?: object }} [opcoes]
 */
export const montarDocumento = (clienteId, entrada, opcoes = {}) => {
  const corpo = { ...(entrada || {}) };
  delete corpo.cliente_id;
  if (!opcoes.atualizacao) delete corpo.id;

  const empresa_id = typeof corpo.empresa_id === 'string' && corpo.empresa_id.trim() ? corpo.empresa_id.trim() : null;
  if (!empresa_id) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'empresa_id é obrigatório', {
      details: { field: 'empresa_id', reason: 'required' },
    });
  }

  /** @type {Record<string, unknown>} */
  const dados = {};
  for (const [chave, valor] of Object.entries(corpo)) {
    if (RESERVADOS.has(chave)) continue;
    if (chave === 'empresa_id') continue;
    dados[chave] = valor;
  }

  if (opcoes.atualizacao && opcoes.id && opcoes.dadosAnteriores && typeof opcoes.dadosAnteriores === 'object') {
    return {
      id: opcoes.id,
      cliente_id: clienteId,
      empresa_id,
      dados: { ...opcoes.dadosAnteriores, ...dados },
    };
  }

  return {
    ...(opcoes.atualizacao && opcoes.id ? { id: opcoes.id } : {}),
    cliente_id: clienteId,
    empresa_id,
    dados,
  };
};
