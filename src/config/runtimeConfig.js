/**
 * Configuração de runtime — fonte única (P1.1, D-PROD-18).
 *
 * Antes, três lugares liam configuração por conta própria: `src/lib/app-params.js`
 * (parâmetros da Base44 vindos de URL/localStorage/env), `src/lib/googleMaps.js`
 * (chave do Maps direto de `import.meta.env`) e o cliente legado. Cada um com sua
 * própria noção de precedência e de o que fazer sem `window`.
 *
 * Este módulo centraliza a leitura. Ele **não** muda comportamento:
 *  - a precedência continua sendo query string > `localStorage` > env/default;
 *  - `access_token` continua sendo removido da URL na primeira leitura;
 *  - os valores continuam sendo persistidos em `localStorage` com o mesmo
 *    prefixo `base44_`, porque a Base44 segue como provider temporário;
 *  - a autenticação não é tocada (`requiresAuth: false` continua em D-PROD/DBT-02).
 *
 * Segurança (QLT-P11-05): a API devolve **valores**, nunca despeja o objeto
 * completo. Não existe `toJSON`, não existe log, e `describeRuntimeConfig()`
 * devolve apenas presença/ausência — nunca o conteúdo de token, chave ou app id.
 */

const STORAGE_PREFIX = 'base44_';

/** `appId` → `app_id`. Mantém a convenção de chave que já existia. */
const toSnakeCase = (texto) => texto.replace(/([A-Z])/g, '_$1').toLowerCase();

const hasWindow = () => typeof window !== 'undefined';

/**
 * `localStorage` pode não existir (SSR/teste) ou lançar (modo privado, cota).
 * Nenhuma dessas situações pode derrubar a aplicação.
 */
const readStorage = (chave) => {
  if (!hasWindow()) return null;
  try {
    return window.localStorage?.getItem(chave) ?? null;
  } catch {
    return null;
  }
};

const writeStorage = (chave, valor) => {
  if (!hasWindow() || valor === null || valor === undefined || valor === '') return;
  try {
    window.localStorage?.setItem(chave, valor);
  } catch {
    /* persistência é otimização, não requisito */
  }
};

/** Lê `import.meta.env` sem quebrar fora do bundler. */
const readEnv = (nome) => {
  try {
    const valor = import.meta.env?.[nome];
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
  } catch {
    return null;
  }
};

/**
 * Resolve um parâmetro de runtime.
 *
 * Precedência preservada de `app-params.js`:
 *   1. query string  (e persiste)
 *   2. `defaultValue` — normalmente a variável de ambiente (e persiste)
 *   3. `localStorage`
 *   4. `null`
 *
 * @param {string} nome nome do parâmetro na URL (ex.: `access_token`)
 * @param {{defaultValue?: string|null, removeFromUrl?: boolean}} [opcoes]
 * @returns {string|null}
 */
const resolveParam = (nome, { defaultValue = null, removeFromUrl = false } = {}) => {
  if (!hasWindow()) return defaultValue;

  const chaveStorage = `${STORAGE_PREFIX}${toSnakeCase(nome)}`;
  let daUrl = null;

  try {
    const params = new URLSearchParams(window.location.search);
    daUrl = params.get(nome);

    if (removeFromUrl && params.has(nome)) {
      // O token não pode ficar na barra de endereços, no histórico do navegador
      // nem no `Referer` de requisições seguintes.
      params.delete(nome);
      const query = params.toString();
      const novaUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
      window.history?.replaceState({}, document.title, novaUrl);
    }
  } catch {
    daUrl = null;
  }

  if (daUrl) {
    writeStorage(chaveStorage, daUrl);
    return daUrl;
  }
  if (defaultValue) {
    writeStorage(chaveStorage, defaultValue);
    return defaultValue;
  }
  return readStorage(chaveStorage);
};

/**
 * Parâmetros do provider Base44.
 *
 * Resolvido uma única vez, no carregamento do módulo — como o `app-params.js`
 * fazia. Isso importa: `access_token` só é removido da URL na primeira leitura,
 * e resolver de novo depois devolveria `null` para quem chegou pela query string.
 */
const providerParams = Object.freeze({
  appId: resolveParam('app_id', { defaultValue: readEnv('VITE_BASE44_APP_ID') }),
  serverUrl: resolveParam('server_url', { defaultValue: readEnv('VITE_BASE44_BACKEND_URL') }),
  token: resolveParam('access_token', { removeFromUrl: true }),
  fromUrl: resolveParam('from_url', { defaultValue: hasWindow() ? window.location.href : null }),
  functionsVersion: resolveParam('functions_version'),
});

/**
 * Parâmetros do provider de dados temporário.
 * @returns {{appId: string|null, serverUrl: string|null, token: string|null, fromUrl: string|null, functionsVersion: string|null}}
 */
export const getDataProviderConfig = () => providerParams;

/**
 * Chave do Google Maps. Lida a cada chamada porque os testes trocam o ambiente.
 * @returns {string|null}
 */
export const getGoogleMapsApiKey = () => readEnv('VITE_GOOGLE_MAPS_API_KEY');

/** O Google Maps está configurado? */
export const isGoogleMapsConfigured = () => getGoogleMapsApiKey() !== null;

/**
 * Descrição **sem segredo**, para diagnóstico e para os gates.
 *
 * Devolve apenas presença/ausência. Nenhum valor de token, chave, app id ou URL
 * aparece aqui — é por isso que este é o único jeito seguro de "olhar" a
 * configuração inteira.
 *
 * @returns {Record<string, boolean>}
 */
export const describeRuntimeConfig = () => ({
  hasAppId: Boolean(providerParams.appId),
  hasServerUrl: Boolean(providerParams.serverUrl),
  hasToken: Boolean(providerParams.token),
  hasFunctionsVersion: Boolean(providerParams.functionsVersion),
  hasGoogleMapsApiKey: isGoogleMapsConfigured(),
});
