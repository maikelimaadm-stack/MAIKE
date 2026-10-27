/**
 * Configuração de runtime — fonte única (P1.1, D-PROD-18; P7 remove legado Base44).
 *
 * Centraliza leitura de variáveis `VITE_*` do build e resolução da URL do backend
 * nativo MAIKE. Antes também carregava parâmetros do SDK Base44 (`app_id`,
 * `server_url`, `access_token`); após P5.5/P7 nenhum consumidor de dados usa
 * isso — removido junto com `VITE_BASE44_*`.
 *
 * Segurança (QLT-P11-05): a API devolve **valores**, nunca despeja o objeto
 * completo. Não existe `toJSON`, não existe log, e `describeRuntimeConfig()`
 * devolve apenas presença/ausência — nunca o conteúdo de chave ou URL.
 */

const hasWindow = () => typeof window !== 'undefined';

/**
 * Variáveis de build do Vite — **referência estática obrigatória** (P1.2-R1).
 *
 * Leitura dinâmica (`import.meta.env[nome]`) materializa o objeto **inteiro** no
 * bundle e publica toda `VITE_*` configurada no build, mesmo sem uso. Cada
 * variável conhecida ganha função com propriedade escrita literalmente.
 *
 * Proibido (ENV1): `import.meta.env[nome]`, `Reflect.get`, `Object.entries`, etc.
 *
 * **A chave `VITE_*` é pública por definição** — proteção do Maps é referrer/API
 * no Google Cloud, não sigilo do valor.
 */
const normalizarEnv = (valor) =>
  typeof valor === 'string' && valor.trim() ? valor.trim() : null;

const lerGoogleMapsApiKey = () => {
  try {
    return normalizarEnv(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
  } catch {
    return null;
  }
};

/**
 * URL do backend **nativo** MAIKE (P4.0, D-PROD-24).
 *
 * Como toda `VITE_*`, é **pública por definição**. Proteção: CORS + JWT no servidor.
 */
const lerMaikeApiUrl = () => {
  try {
    return normalizarEnv(import.meta.env.VITE_MAIKE_API_URL);
  } catch {
    return null;
  }
};

/**
 * Remove barras finais sem tocar no resto da URL.
 */
const semBarraFinal = (url) => (typeof url === 'string' ? url.replace(/\/+$/, '') : url);

const HOST_PURO = /^[a-zA-Z0-9][a-zA-Z0-9.-]*(:\d{1,5})?$/;

const comEsquemaExplicito = (url) => {
  if (typeof url !== 'string' || url === '') return null;
  if (/^https?:\/\//.test(url)) return url;
  return HOST_PURO.test(url) ? `https://${url}` : null;
};

const ehSplitDevLocal = (origem, daEnv) =>
  typeof origem === 'string' &&
  typeof daEnv === 'string' &&
  /localhost/i.test(origem) &&
  /localhost/i.test(daEnv) &&
  origem !== daEnv;

const lerOrigemDoNavegador = () => {
  if (!hasWindow()) return null;
  try {
    return comEsquemaExplicito(semBarraFinal(window.location.origin));
  } catch {
    return null;
  }
};

/**
 * Chave do Google Maps — lida a cada chamada (testes trocam env após import).
 *
 * @returns {string|null}
 */
export const getGoogleMapsApiKey = () => lerGoogleMapsApiKey();

/** O Google Maps está configurado? */
export const isGoogleMapsConfigured = () => getGoogleMapsApiKey() !== null;

/**
 * Base URL do backend nativo MAIKE, sem barra final, ou `null`.
 *
 * Sem override por query string ou `localStorage` (D-PROD-26, D-PROD-36).
 *
 * @returns {string|null}
 */
export const getNativeApiUrl = () => {
  const bruta = semBarraFinal(lerMaikeApiUrl());
  const daEnv = comEsquemaExplicito(bruta);
  const origem = lerOrigemDoNavegador();

  if (bruta && !daEnv) return null;

  if (origem && daEnv && origem !== daEnv) {
    if (ehSplitDevLocal(origem, daEnv)) return daEnv;
    if (origem.startsWith('https://')) return origem;
  }

  if (!daEnv && origem) return origem;

  return daEnv;
};

/** O backend nativo está configurado? */
export const isNativeApiConfigured = () => getNativeApiUrl() !== null;

/**
 * Descrição **sem segredo**, para diagnóstico e gates.
 *
 * @returns {Record<string, boolean>}
 */
export const describeRuntimeConfig = () => ({
  hasGoogleMapsApiKey: isGoogleMapsConfigured(),
  hasNativeApiUrl: isNativeApiConfigured(),
});
