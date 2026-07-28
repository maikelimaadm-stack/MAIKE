/**
 * Carregador canônico e idempotente do SDK do Google Maps.
 *
 * Contrato (P0.1-R1, endurecido em P0.1-R2):
 *  - um único conjunto de libraries para todo o produto: `drawing,geometry`.
 *    O Mapa Geral e o Cadastro do Mapa precisam de desenho e geometria, então
 *    não existem loaders concorrentes por combinação diferente;
 *  - uma única promise no escopo do módulo;
 *  - script identificado por ID fixo, reaproveitado quando já existe **e** a URL
 *    é a esperada — ID certo com URL inesperada é script inválido;
 *  - **só resolve com capacidade comprovada**: `google.maps.Map`,
 *    `google.maps.geometry` e `google.maps.drawing` presentes. O evento `load`
 *    e `dataset.loaded` são pistas, nunca prova;
 *  - depois do `load`, aguarda as capacidades de forma limitada até o timeout
 *    total; se seguir incompleto, rejeita com `MAPS_SDK_INCOMPLETE`;
 *  - falha nunca fica em cache: a promise é limpa e o script removido, então a
 *    próxima chamada tenta de novo;
 *  - `window.gm_authFailure` (erro de chave/faturamento do Google) derruba a
 *    carga em andamento, encadeando e restaurando o handler anterior;
 *  - a chave vem de `VITE_GOOGLE_MAPS_API_KEY` e nunca é registrada em log;
 *  - seguro em ambiente sem DOM (SSR/testes).
 *
 * Nenhuma chave literal pode existir em `src/` — `gate:no-secrets` reprova.
 */

export const GOOGLE_MAPS_LIBRARIES = 'drawing,geometry';
export const GOOGLE_MAPS_REQUIRED_LIBRARIES = Object.freeze(['drawing', 'geometry']);
export const GOOGLE_MAPS_SCRIPT_ID = 'maike-google-maps-sdk';
export const GOOGLE_MAPS_SCRIPT_ORIGIN = 'https://maps.googleapis.com/maps/api/js';
export const GOOGLE_MAPS_LOAD_TIMEOUT_MS = 20000;
export const GOOGLE_MAPS_CAPABILITY_POLL_MS = 50;

export const MAPS_ERROR_CODES = Object.freeze({
  CONFIG_MISSING: 'MAPS_CONFIG_MISSING',
  SCRIPT_FAILED: 'MAPS_SCRIPT_FAILED',
  SCRIPT_TIMEOUT: 'MAPS_SCRIPT_TIMEOUT',
  SDK_INCOMPLETE: 'MAPS_SDK_INCOMPLETE',
  ENV_UNAVAILABLE: 'MAPS_ENV_UNAVAILABLE',
});

const MESSAGES = {
  [MAPS_ERROR_CODES.CONFIG_MISSING]:
    'Google Maps não configurado: defina VITE_GOOGLE_MAPS_API_KEY no arquivo .env.local (ver .env.example).',
  [MAPS_ERROR_CODES.SCRIPT_FAILED]: 'Falha ao carregar o Google Maps.',
  [MAPS_ERROR_CODES.SCRIPT_TIMEOUT]: 'Tempo esgotado ao carregar o Google Maps.',
  [MAPS_ERROR_CODES.SDK_INCOMPLETE]:
    'Google Maps carregou sem as capacidades necessárias (mapa, geometria e desenho).',
  [MAPS_ERROR_CODES.ENV_UNAVAILABLE]: 'Google Maps indisponível: ambiente sem DOM.',
};

/** Mantido para compatibilidade com os consumidores já existentes. */
export const GOOGLE_MAPS_MISSING_KEY_MESSAGE = MESSAGES[MAPS_ERROR_CODES.CONFIG_MISSING];

/** Erro padronizado, com `code` estável para o consumidor tratar. */
export class GoogleMapsError extends Error {
  constructor(code, cause) {
    super(MESSAGES[code] || code);
    this.name = 'GoogleMapsError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const readEnvKey = () => {
  try {
    const key = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY;
    return typeof key === 'string' && key.trim() ? key.trim() : null;
  } catch {
    // `import.meta.env` pode não existir fora do bundler.
    return null;
  }
};

export const getGoogleMapsApiKey = () => readEnvKey();

export const isGoogleMapsConfigured = () => readEnvKey() !== null;

const hasDom = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** O SDK está pronto com as capacidades que o produto exige? */
export const isGoogleMapsReady = () => {
  if (!hasDom()) return false;
  const maps = window.google?.maps;
  return Boolean(maps?.Map && maps?.geometry && maps?.drawing);
};

/** Quais capacidades exigidas ainda faltam. Usado só para diagnóstico. */
const missingCapabilities = () => {
  const maps = hasDom() ? window.google?.maps : null;
  return [
    !maps?.Map && 'Map',
    !maps?.geometry && 'geometry',
    !maps?.drawing && 'drawing',
  ].filter(Boolean);
};

// Promise única do módulo. `null` significa "nenhuma carga em andamento".
let loadPromise = null;

/** Somente para testes: descarta o estado do módulo. */
export const __resetGoogleMapsLoaderForTests = () => {
  loadPromise = null;
};

const buildScriptSrc = (apiKey) => {
  const params = new URLSearchParams({
    key: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  return `${GOOGLE_MAPS_SCRIPT_ORIGIN}?${params.toString()}`;
};

/**
 * O script existente é realmente o nosso loader, com as libraries exigidas?
 * Um `<script>` com o ID certo apontando para outro lugar não prova nada.
 */
export const isExpectedScriptSrc = (src) => {
  if (typeof src !== 'string' || !src) return false;
  let url;
  try {
    url = new URL(src, GOOGLE_MAPS_SCRIPT_ORIGIN);
  } catch {
    return false;
  }
  const esperada = new URL(GOOGLE_MAPS_SCRIPT_ORIGIN);
  if (url.origin !== esperada.origin || url.pathname !== esperada.pathname) return false;

  const libraries = (url.searchParams.get('libraries') || '')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  return GOOGLE_MAPS_REQUIRED_LIBRARIES.every((l) => libraries.includes(l));
};

const removeScript = (script) => {
  if (script?.parentNode) script.parentNode.removeChild(script);
};

/**
 * Carrega o SDK do Google Maps uma única vez.
 *
 * @param {{timeoutMs?: number, pollIntervalMs?: number}} [options]
 * @returns {Promise<void>} rejeita com {@link GoogleMapsError}
 */
export const loadGoogleMaps = (options = {}) => {
  const timeoutMs = options.timeoutMs ?? GOOGLE_MAPS_LOAD_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? GOOGLE_MAPS_CAPABILITY_POLL_MS;

  if (isGoogleMapsReady()) return Promise.resolve();
  if (loadPromise) return loadPromise;

  if (!hasDom()) {
    return Promise.reject(new GoogleMapsError(MAPS_ERROR_CODES.ENV_UNAVAILABLE));
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return Promise.reject(new GoogleMapsError(MAPS_ERROR_CODES.CONFIG_MISSING));
  }

  const promise = new Promise((resolve, reject) => {
    let settled = false;
    let deadlineId = null;
    let pollId = null;
    let script = null;
    // O `load` já aconteceu? Distingue "script não respondeu" de "SDK incompleto".
    let scriptCarregou = false;

    const authHandlerAnterior = window.gm_authFailure;
    const tinhaAuthHandler = 'gm_authFailure' in window;

    const cleanup = () => {
      if (deadlineId !== null) clearTimeout(deadlineId);
      if (pollId !== null) clearInterval(pollId);
      deadlineId = null;
      pollId = null;
      script?.removeEventListener('load', onLoad);
      script?.removeEventListener('error', onError);
      if (tinhaAuthHandler) window.gm_authFailure = authHandlerAnterior;
      else delete window.gm_authFailure;
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (code, cause) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Permite nova tentativa: nem script quebrado nem carga incompleta
      // podem bloquear o produto.
      removeScript(script);
      reject(new GoogleMapsError(code, cause));
    };

    /** Resolve apenas com capacidade comprovada. */
    const tentarConcluir = () => {
      if (!isGoogleMapsReady()) return false;
      succeed();
      return true;
    };

    /**
     * O `load` disparou. A partir daqui o SDK ainda pode estar montando os
     * namespaces: aguarda de forma limitada, até o timeout total.
     */
    const observarCapacidades = () => {
      scriptCarregou = true;
      if (tentarConcluir()) return;
      if (pollId === null) pollId = setInterval(tentarConcluir, pollIntervalMs);
    };

    function onLoad() {
      observarCapacidades();
    }
    function onError(event) {
      fail(MAPS_ERROR_CODES.SCRIPT_FAILED, event);
    }

    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
    if (existing) {
      script = existing;
      if (!isExpectedScriptSrc(existing.getAttribute('src'))) {
        fail(MAPS_ERROR_CODES.SCRIPT_FAILED, new Error('script do Google Maps com URL inesperada'));
        return;
      }
      if (existing.dataset.failed === 'true') {
        fail(MAPS_ERROR_CODES.SCRIPT_FAILED);
        return;
      }
    } else {
      script = document.createElement('script');
      script.id = GOOGLE_MAPS_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = buildScriptSrc(apiKey);
    }

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);

    window.gm_authFailure = (...args) => {
      fail(MAPS_ERROR_CODES.SCRIPT_FAILED, new Error('gm_authFailure'));
      if (typeof authHandlerAnterior === 'function') authHandlerAnterior(...args);
    };

    deadlineId = setTimeout(() => {
      if (scriptCarregou || isGoogleMapsReady()) {
        // Carregou mas nunca ficou completo: falha específica e acionável.
        fail(
          MAPS_ERROR_CODES.SDK_INCOMPLETE,
          new Error(`capacidades ausentes: ${missingCapabilities().join(', ') || 'desconhecidas'}`)
        );
      } else {
        fail(MAPS_ERROR_CODES.SCRIPT_TIMEOUT);
      }
    }, timeoutMs);

    if (existing) {
      // `dataset.loaded` é pista de que o `load` já passou — o evento não vai
      // disparar de novo. Nunca é prova de que o SDK está completo.
      if (existing.dataset.loaded === 'true') observarCapacidades();
    } else {
      document.head.appendChild(script);
    }
  });

  loadPromise = promise
    .then(() => {
      const script = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
      if (script) script.dataset.loaded = 'true';
    })
    .catch((error) => {
      // Libera o módulo para uma nova tentativa e propaga o erro padronizado.
      loadPromise = null;
      throw error;
    });

  return loadPromise;
};
