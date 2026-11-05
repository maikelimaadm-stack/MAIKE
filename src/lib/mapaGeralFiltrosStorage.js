/**
 * Preferências do Mapa Geral (camadas e filtros) — POR USUÁRIO.
 *
 * Chave: fazenda (cliente) + conta (login) + empresa. Cada usuário tem a sua;
 * duas contas no mesmo aparelho não se misturam. Leitura tolerante a JSON
 * inválido (R3-04).
 *
 * Migração sem perda: na primeira leitura de um usuário, se ainda não houver a
 * chave dele, herda a preferência antiga do aparelho (chave por empresa e, por
 * fim, a legada) — quem já tinha filtrado não começa "limpo".
 */

const chaveLegada = 'mapa_geral_filtros';
const chavePorEmpresa = (empresaId) => `mapa_geral_filtros_${empresaId || 'default'}`;
const PREFIXO_USUARIO = 'mapa_geral_filtros_u:';

/**
 * @typedef {{ clienteId?: string|null, login: string, empresaId: string }} EscopoFiltros
 */

/** @param {EscopoFiltros} escopo */
export const chaveFiltrosDoUsuario = (escopo) =>
  `${PREFIXO_USUARIO}${escopo.clienteId || '-'}:${escopo.login}:${escopo.empresaId}`;

const valido = (escopo) => Boolean(escopo && typeof escopo === 'object' && escopo.login && escopo.empresaId);

const parse = (bruto) => {
  if (!bruto) return null;
  try {
    const parsed = JSON.parse(bruto);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return null;
  }
};

/**
 * @param {EscopoFiltros|null|undefined} escopo
 * @returns {Record<string, unknown>|null}
 */
export const lerFiltrosMapaGeral = (escopo) => {
  if (typeof window === 'undefined' || !valido(escopo)) return null;
  try {
    const doUsuario = parse(window.localStorage.getItem(chaveFiltrosDoUsuario(escopo)));
    if (doUsuario) return doUsuario;
    return (
      parse(window.localStorage.getItem(chavePorEmpresa(escopo.empresaId))) ||
      parse(window.localStorage.getItem(chaveLegada))
    );
  } catch {
    return null;
  }
};

/**
 * @param {EscopoFiltros|null|undefined} escopo
 * @param {Record<string, unknown>} state
 */
export const salvarFiltrosMapaGeral = (escopo, state) => {
  if (typeof window === 'undefined' || !valido(escopo)) return;
  try {
    window.localStorage.setItem(chaveFiltrosDoUsuario(escopo), JSON.stringify(state));
  } catch {
    // storage indisponível — montagem segue com defaults
  }
};
