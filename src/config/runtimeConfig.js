/**
 * Configuração de runtime — fonte única (P1.1, D-PROD-18).
 *
 * Antes, três lugares liam configuração por conta própria: `src/lib/app-params.js`
 * (parâmetros da Base44 vindos de URL/localStorage/env), `src/lib/googleMaps.js`
 * (chave do Maps direto de `import.meta.env`) e o cliente legado. Cada um com sua
 * própria noção de precedência e de o que fazer sem `window`.
 *
 * Este módulo centraliza a leitura. Ele **não** muda comportamento:
 *  - a precedência continua sendo **query string > env/default > `localStorage`**,
 *    exatamente como o legado fazia: um valor de ambiente presente vence o que
 *    está persistido, e o `localStorage` só entra quando os dois faltam;
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

/**
 * Variáveis de build do Vite — **referência estática obrigatória** (P1.2-R1).
 *
 * A versão anterior lia por chave: `import.meta.env?.[nome]`. A troca por
 * referência estática foi feita por um motivo **medido**, e vale registrar qual,
 * porque o motivo intuitivo está errado:
 *
 * O que se supunha: leitura dinâmica não seria substituída pelo Vite e o bundle
 * de produção ficaria sem as variáveis. **Isso não acontece.** Medido em build
 * real: quando o Vite encontra um `import.meta.env` que não consegue
 * especializar, ele materializa o objeto **inteiro** como literal e reescreve o
 * acesso para indexá-lo. A leitura dinâmica funciona.
 *
 * O que realmente muda, e é o motivo desta forma: materializar o objeto inteiro
 * despeja no bundle do cliente **todas** as variáveis `VITE_*` presentes na hora
 * do build, inclusive as que este código nunca referencia. Medido:
 *
 *   forma dinâmica → `{BASE_URL:…, VITE_USADA:…, VITE_NUNCA_REFERENCIADA:…}`
 *   forma estática → só o valor referenciado, inline
 *
 * Ou seja: a forma dinâmica transforma qualquer `VITE_*` futura em conteúdo
 * público do bundle, mesmo sem uso. A forma estática entrega apenas o que o
 * código pede. É contenção de superfície, não correção de leitura.
 *
 * Cada variável conhecida ganha uma função com a propriedade escrita
 * literalmente. É verboso de propósito: a repetição é o que o bundler precisa
 * ver. Variável nova exige uma função nova — não existe forma genérica correta.
 *
 * Proibido, e coberto por teste (ENV1): `import.meta.env[nome]`,
 * `import.meta.env?.[nome]`, `Reflect.get(import.meta.env, ...)`,
 * `Object.entries(import.meta.env)`, `'VITE_' + sufixo`.
 *
 * **A chave `VITE_*` é pública por definição** — ela vai para o bundle do
 * cliente. A proteção correta para o Maps JavaScript API é restrição por
 * referrer e por API no Google Cloud, nunca sigilo do valor.
 */
const normalizarEnv = (valor) =>
  typeof valor === 'string' && valor.trim() ? valor.trim() : null;

/**
 * Fora do bundler (SSR, script Node solto) `import.meta.env` pode não existir.
 * Isso não pode derrubar a aplicação — daí o `try`.
 */
const lerGoogleMapsApiKey = () => {
  try {
    return normalizarEnv(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
  } catch {
    return null;
  }
};

const lerBase44AppId = () => {
  try {
    return normalizarEnv(import.meta.env.VITE_BASE44_APP_ID);
  } catch {
    return null;
  }
};

const lerBase44BackendUrl = () => {
  try {
    return normalizarEnv(import.meta.env.VITE_BASE44_BACKEND_URL);
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
  appId: resolveParam('app_id', { defaultValue: lerBase44AppId() }),
  serverUrl: resolveParam('server_url', { defaultValue: lerBase44BackendUrl() }),
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
 * Chave do Google Maps.
 *
 * Lida **a cada chamada**, não congelada na carga do módulo: os testes trocam o
 * ambiente depois de importar. Isso não conflita com a substituição do Vite —
 * o literal já está no corpo da função quando o bundle é gerado.
 *
 * @returns {string|null}
 */
export const getGoogleMapsApiKey = () => lerGoogleMapsApiKey();

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
