/**
 * Normalização de texto do produto (P0 · reescrita provider-agnostic em P1.4).
 *
 * Este módulo era, até a P1.3, um **monkey patch global**:
 * `installTextNormalization(base44Client)` varria `Object.values(base44Client.entities)`
 * e substituía `create`, `update`, `bulkCreate`, `list`, `filter`, `get`,
 * `subscribe` e os métodos de `auth` de cada entidade do SDK, in place. Três
 * problemas, e nenhum deles é estético:
 *
 *  1. o módulo conhecia o provider — `entities` é vocabulário da Base44, e a
 *     P7 troca o provider inteiro;
 *  2. a substituição era invisível: nada no código de chamada indicava que
 *     `Produto.list()` devolvia dado formatado;
 *  3. mutar objeto do SDK depende de o SDK expor os métodos como propriedades
 *     graváveis — contrato que ninguém prometeu.
 *
 * Agora o comportamento observável é o mesmo, mas por **composição explícita**:
 * o provider chama {@link createNormalizedEntityAdapter} com o endpoint já
 * resolvido e recebe um objeto novo. Nada é mutado, e este arquivo não sabe o
 * que é Base44 — recebe um objeto com operações e devolve outro com as mesmas
 * operações embrulhadas.
 */

function normalizeWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function toTitleCase(value = "") {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function capitalizeFirst(value = "") {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : normalized;
}

function shouldSkipStorageNormalization(key = "") {
  return /(^id$|_id$|_ids$|url|uri|token|secret|file_|coordenadas)/i.test(key);
}

function shouldKeepDisplayAsIs(key = "") {
  return /(^id$|_id$|_ids$|url|uri|token|secret|file_|coordenadas|email)/i.test(key);
}

function shouldUppercaseDisplay(key = "") {
  return /(sigla|codigo|cpf|cnpj|rg|cep|cfop|gta|placa|renavam|chassi|nfe|uf$|estado$)/i.test(key);
}

function shouldCapitalizeStatus(key = "") {
  return /(status)/i.test(key);
}

function shouldTitleCaseDisplay(key = "") {
  return /(nome|titulo|apelido|razao_social|cidade|categoria|subcategoria|responsavel|cliente_nome|fornecedor_nome|produto_nome|safra_nome|grupo_nome|setor_nome|area_nome|lote_nome|maquina_nome|implemento_nome|nome_ponto|tipo$|tipo_|motivo|origem|destino)/i.test(key);
}

export function normalizeDataForStorage(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDataForStorage(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, normalizeDataForStorage(entryValue, entryKey)])
    );
  }

  if (typeof value !== "string") return value;

  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return "";
  if (shouldSkipStorageNormalization(key)) return trimmed;
  return trimmed.toLowerCase();
}

export function formatDataForDisplay(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => formatDataForDisplay(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, formatDataForDisplay(entryValue, entryKey)])
    );
  }

  if (typeof value !== "string") return value;

  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";
  if (shouldKeepDisplayAsIs(key)) return normalized;
  if (shouldUppercaseDisplay(key)) return normalized.toUpperCase();
  if (shouldCapitalizeStatus(key)) return capitalizeFirst(normalized);
  if (shouldTitleCaseDisplay(key)) return toTitleCase(normalized);
  return normalized;
}

/**
 * Operações de entidade que a normalização conhece.
 *
 * Lista fechada e literal: uma operação que não esteja aqui atravessa sem
 * embrulho, e é isso que se quer — o adapter não inventa comportamento para
 * método que não sabe tratar.
 */
export const NORMALIZED_ENTITY_OPERATIONS = Object.freeze([
  'create',
  'update',
  'bulkCreate',
  'list',
  'filter',
  'get',
  'subscribe',
]);

/**
 * Embrulha um endpoint de entidade **já resolvido** com a normalização.
 *
 * Sem nome aberto: quem chama já resolveu o endpoint, e `entityName` entra só
 * como rótulo — nenhuma busca é feita com ele.
 *
 * @param {{entityName: string, endpoint: object}} p
 * @returns {object} objeto novo; o endpoint recebido não é mutado
 */
export const createNormalizedEntityAdapter = ({ entityName, endpoint }) => {
  if (!endpoint || typeof endpoint !== 'object') {
    throw new Error(`normalização: endpoint inválido para "${entityName}"`);
  }

  const adapter = { ...endpoint };

  if (typeof endpoint.create === 'function') {
    adapter.create = async (dados) => formatDataForDisplay(await endpoint.create(normalizeDataForStorage(dados)));
  }
  if (typeof endpoint.update === 'function') {
    adapter.update = async (id, dados) =>
      formatDataForDisplay(await endpoint.update(id, normalizeDataForStorage(dados)));
  }
  if (typeof endpoint.bulkCreate === 'function') {
    adapter.bulkCreate = async (registros) =>
      formatDataForDisplay(await endpoint.bulkCreate(normalizeDataForStorage(registros)));
  }
  if (typeof endpoint.list === 'function') {
    adapter.list = async (...args) => formatDataForDisplay(await endpoint.list(...args));
  }
  if (typeof endpoint.filter === 'function') {
    adapter.filter = async (...args) => formatDataForDisplay(await endpoint.filter(...args));
  }
  if (typeof endpoint.get === 'function') {
    adapter.get = async (...args) => formatDataForDisplay(await endpoint.get(...args));
  }
  if (typeof endpoint.subscribe === 'function') {
    adapter.subscribe = (callback, ...args) =>
      endpoint.subscribe((evento) => {
        callback({
          ...evento,
          data: formatDataForDisplay(evento?.data),
          old_data: formatDataForDisplay(evento?.old_data),
        });
      }, ...args);
  }

  return adapter;
};

/**
 * Mesma ideia para as operações de sessão que devolvem ou recebem dado de
 * usuário. `logout` e `redirectToLogin` passam intactos: não carregam payload.
 *
 * @param {{me?: Function, updateMe?: Function}} operacoes
 */
export const createNormalizedSessionAdapter = (operacoes) => {
  const adapter = { ...operacoes };
  if (typeof operacoes.me === 'function') {
    adapter.me = async (...args) => formatDataForDisplay(await operacoes.me(...args));
  }
  if (typeof operacoes.updateMe === 'function') {
    adapter.updateMe = async (dados) => formatDataForDisplay(await operacoes.updateMe(normalizeDataForStorage(dados)));
  }
  return adapter;
};
