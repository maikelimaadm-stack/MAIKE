/**
 * Porta nativa da importação de áreas por arquivo (D-PROD-90).
 *
 * Diferente de `areaPastagemPort`, NÃO passa pelo runtime offline: importação
 * grava várias áreas de uma vez e só pode ser confirmada com o servidor
 * respondendo. Enfileirar offline e mostrar "importado" seria anunciar uma
 * gravação que não aconteceu (e que poderia falhar depois, sem ninguém ver).
 *
 * O corpo vai por lista literal de campos — nada de `cliente_id`, `numero_area`
 * ou `setor_nome`: o servidor recusa (400) e atribui os três.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'AreaPastagem';
const CAMINHO_CONFERIR = '/areas-pastagem/importacao/conferir';
const CAMINHO_IMPORTAR = '/areas-pastagem/importacao';

const CAMPOS_DO_ITEM = Object.freeze([
  'ref',
  'nome',
  'sigla',
  'setor_id',
  'tipo_cultura',
  'tipo_pastagem',
  'area_pastejada',
  'aproveitamento_classificacao',
  'cor',
  'coords',
]);

/**
 * @param {Record<string, unknown>} item
 * @returns {Record<string, unknown>}
 */
export const corpoDoItem = (item) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const campo of CAMPOS_DO_ITEM) {
    if (!Object.prototype.hasOwnProperty.call(item ?? {}, campo)) continue;
    const valor = /** @type {Record<string, unknown>} */ (item)[campo];
    if (valor === undefined) continue;
    corpo[campo] = typeof valor === 'string' && valor.trim() === '' ? null : valor;
  }
  return corpo;
};

/**
 * @param {{ empresaId: string, itens: Record<string, unknown>[] }} pedido
 */
export const conferirImportacaoNativa = ({ empresaId, itens }) =>
  nativeRequest(
    CAMINHO_CONFERIR,
    { method: 'POST', body: { empresa_id: empresaId, itens: itens.map(corpoDoItem) }, autenticado: true },
    { operation: 'conferirImportacaoAreas', resource: RESOURCE }
  );

/**
 * @param {{ operationId: string, empresaId: string, itens: Record<string, unknown>[] }} pedido
 */
export const importarAreasNativa = ({ operationId, empresaId, itens }) =>
  nativeRequest(
    CAMINHO_IMPORTAR,
    {
      method: 'POST',
      body: { operation_id: operationId, empresa_id: empresaId, itens: itens.map(corpoDoItem) },
      autenticado: true,
    },
    { operation: 'importarAreas', resource: RESOURCE }
  );
