/**
 * Provider de dados temporário (P1.1, D-PROD-04 + D-PROD-18).
 *
 * **Este é o único arquivo dentro de `src/apis/` autorizado a importar
 * `@/api/base44Client`.** `gate:api-boundary` reprova qualquer outro
 * (`P11-API-BOUNDARY-PROVIDER-LEAK`).
 *
 * Regras que este arquivo materializa:
 *
 *  - o objeto do provider **nunca** é exportado. Não há `export { base44 }`,
 *    `export default base44` nem reexport indireto. O que sai daqui são
 *    funções pequenas, com assinatura própria;
 *  - o acesso a entidade é **literal**. Não existe `entities[nome]` nem
 *    `getEntity(nome)` com nome aberto: o domínio do registry está escrito no
 *    código e é conferível por AST (`P11-API-BOUNDARY-DYNAMIC-ENTITY`);
 *  - o registry cresce **uma entidade por slice**, e só quando existe consumidor
 *    migrado (SCL-P11-02). Nesta slice: `Empresa`, e mais nada.
 *
 * Quando a Base44 sair em P7, este arquivo é substituído por um provider HTTP.
 * Nenhuma página, componente ou service precisa mudar (QLT-P11-02).
 */

import { base44 } from '@/api/base44Client';

/**
 * Registro literal das entidades com consumidor migrado.
 *
 * Toda chave aqui precisa existir em `config/mapa-manejo-scope.json` →
 * `allowedBase44Entities` (`P11-API-BOUNDARY-SCOPE`).
 */
const ENTITY_REGISTRY = Object.freeze({
  Empresa: base44.entities.Empresa,
});

/** Nomes registrados. Usado por teste e diagnóstico; não expõe o provider. */
export const getRegisteredEntityNames = () => Object.keys(ENTITY_REGISTRY);

/**
 * Endpoint interno de uma entidade registrada.
 *
 * Privado de propósito: não é exportado. Um nome fora do registry é erro de
 * programação, não condição de runtime — por isso lança em vez de devolver nulo.
 */
const endpointOf = (nome) => {
  if (!Object.prototype.hasOwnProperty.call(ENTITY_REGISTRY, nome)) {
    throw new Error(`entidade não registrada no provider: ${nome}`);
  }
  return ENTITY_REGISTRY[nome];
};

/**
 * Adapter da entidade `Empresa`.
 *
 * Só as quatro operações que o produto realmente usa. Sem paginação, cache ou
 * filtro que o provider atual não ofereça (QLT-P11-03).
 */
export const empresaProvider = Object.freeze({
  /**
   * @param {string} ordenacao ex.: `-created_date`
   * @returns {Promise<Array<object>>}
   */
  list: (ordenacao) => endpointOf('Empresa').list(ordenacao),

  /**
   * @param {object} dados
   * @returns {Promise<object>}
   */
  create: (dados) => endpointOf('Empresa').create(dados),

  /**
   * @param {string} id
   * @param {object} dados
   * @returns {Promise<object>}
   */
  update: (id, dados) => endpointOf('Empresa').update(id, dados),

  /**
   * @param {string} id
   * @returns {Promise<unknown>}
   */
  delete: (id) => endpointOf('Empresa').delete(id),
});
