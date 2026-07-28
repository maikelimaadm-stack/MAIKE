/**
 * Carregador canônico e idempotente do SDK do Google Maps.
 *
 * Contrato (P0.1-R1):
 *  - um único conjunto de libraries para todo o produto: `drawing,geometry`.
 *    O Mapa Geral e o Cadastro do Mapa precisam de desenho e geometria, então
 *    não existem loaders concorrentes por combinação diferente;
 *  - uma única promise no escopo do módulo;
 *  - script identificado por ID fixo, reaproveitado quando já existe;
 *  - detecta script já carregado (não fica pendurado esperando `load`);
 *  - detecta script ainda carregando e aguarda o mesmo evento;
 *  - após falha, limpa a promise e remove o script para permitir nova tentativa;
 *  - timeout explícito, para nunca ficar pendurado;
 *  - a chave vem de `VITE_GOOGLE_MAPS_API_KEY` e nunca é registrada em log;
 *  - seguro em ambiente sem DOM (SSR/testes).
 *
 * Nenhuma chave literal pode existir em `src/` — `gate:no-secrets` reprova.
 */

export const GOOGLE_MAPS_LIBRARIES = 'drawing,geometry';
export const GOOGLE_MAPS_SCRIPT_ID = 'maike-google-maps-sdk';
export const GOOGLE_MAPS_LOAD_TIMEOUT_MS = 20000;

export const MAPS_ERROR_CODES = Object.freeze({
  CONFIG_MISSING: 'MAPS_CONFIG_MISSING',
  SCRIPT_FAILED: 'MAPS_SCRIPT_FAILED',
  SCRIPT_TIMEOUT: 'MAPS_SCRIPT_TIMEOUT',
  ENV_UNAVAILABLE: 'MAPS_ENV_UNAVAILABLE',
});

const MESSAGES = {
  [MAPS_ERROR_CODES.CONFIG_MISSING]:
    'Google Maps não configurado: defina VITE_GOOGLE_MAPS_API_KEY no arquivo .env.local (ver .env.example).',
  [MAPS_ERROR_CODES.SCRIPT_FAILED]: 'Falha ao carregar o Google Maps.',
  [MAPS_ERROR_CODES.SCRIPT_TIMEOUT]: 'Tempo esgotado ao carregar o Google Maps.',
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
  return `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
};

const removeScript = (script) => {
  if (script?.parentNode) script.parentNode.removeChild(script);
};

/**
 * Carrega o SDK do Google Maps uma única vez.
 *
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<void>} rejeita com {@link GoogleMapsError}
 */
export const loadGoogleMaps = (options = {}) => {
  const timeoutMs = options.timeoutMs ?? GOOGLE_MAPS_LOAD_TIMEOUT_MS;

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
    let timeoutId = null;
    let script = null;

    const cleanup = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      script?.removeEventListener('load', onLoad);
      script?.removeEventListener('error', onError);
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
      // Permite nova tentativa: o script quebrado não pode bloquear o produto.
      removeScript(script);
      reject(new GoogleMapsError(code, cause));
    };

    function onLoad() {
      succeed();
    }
    function onError(event) {
      fail(MAPS_ERROR_CODES.SCRIPT_FAILED, event);
    }

    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
    if (existing) {
      script = existing;
      // Script já concluído: `load` nunca vai disparar de novo.
      if (existing.dataset.loaded === 'true' || isGoogleMapsReady()) {
        succeed();
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

    timeoutId = setTimeout(() => fail(MAPS_ERROR_CODES.SCRIPT_TIMEOUT), timeoutMs);

    if (!existing) document.head.appendChild(script);
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
