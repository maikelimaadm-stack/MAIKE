/**
 * Porta nativa de Serviços da fazenda (D-PROD-207, Fatia 4 do Lançamento de
 * Atividades). Só online; o tenant vem só do JWT e a fazenda (`empresa_id`) vai
 * na query das leituras e no corpo das escritas. Sem DELETE: inativar e reativar.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'Servico';
const CAMINHO = '/servicos';

const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagem = (filtros = {}) => {
  const params = new URLSearchParams();
  if (typeof filtros.empresa_id === 'string' && filtros.empresa_id.trim()) params.set('empresa_id', filtros.empresa_id.trim());
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  if (typeof filtros.q === 'string' && filtros.q.trim()) params.set('q', filtros.q.trim());
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  const qs = params.toString();
  return qs ? `${CAMINHO}?${qs}` : CAMINHO;
};

/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;
/** @param {string} id */
const doId = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;

export const operacoesNativas = Object.freeze({
  /** @param {Record<string, unknown>} [filtros] */
  listPage: (filtros = {}) => nativeRequest(montarCaminhoListagem(filtros), { autenticado: true }, ctx('listServicosPage')),
  /** @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comEmpresa(doId(id), empresaId), { autenticado: true }, ctx('getServico', { id })),
  /** @param {Record<string, unknown>} corpo */
  create: (corpo) => nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createServico')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  update: (id, corpo) => nativeRequest(doId(id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateServico', { id })),
  /** @param {string} id @param {string} empresaId @param {boolean} ativo */
  situacao: (id, empresaId, ativo) =>
    nativeRequest(`${doId(id)}/${ativo ? 'reativar' : 'inativar'}`, { method: 'POST', body: { empresa_id: empresaId }, autenticado: true }, ctx(ativo ? 'reativarServico' : 'inativarServico', { id })),
  /** Centros de custo ATIVOS da fazenda, para o centro padrão do formulário. @param {string} empresaId */
  opcoesCentrosCusto: (empresaId) =>
    nativeRequest(comEmpresa('/servicos-opcoes/centros-custo', empresaId), { autenticado: true }, ctx('listOpcoesCentrosCustoServico')),
});

// D-PROD-291: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/servicos?empresa_id={empresa}&limit=100&ativo=true',
]);
