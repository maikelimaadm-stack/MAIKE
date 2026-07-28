/**
 * Carregador único do SDK do Google Maps.
 *
 * A chave vem exclusivamente de `VITE_GOOGLE_MAPS_API_KEY`. Nenhuma chave
 * literal pode existir em `src/` — gate:no-secrets reprova.
 */

export const GOOGLE_MAPS_MISSING_KEY_MESSAGE =
  'Google Maps não configurado: defina VITE_GOOGLE_MAPS_API_KEY no arquivo .env.local (ver .env.example).';

export const getGoogleMapsApiKey = () => {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
};

export const isGoogleMapsConfigured = () => getGoogleMapsApiKey() !== null;

const promisesByLibraries = new Map();

/**
 * Carrega o script do Google Maps uma única vez por conjunto de libraries.
 *
 * @param {string} libraries lista de libraries, ex.: 'drawing,geometry'
 * @returns {Promise<void>} rejeita com mensagem clara quando a chave não existe
 */
export const loadGoogleMaps = (libraries = 'geometry') => {
  if (typeof window !== 'undefined' && window.google?.maps?.Map) return Promise.resolve();

  const cached = promisesByLibraries.get(libraries);
  if (cached) return cached;

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return Promise.reject(new Error(GOOGLE_MAPS_MISSING_KEY_MESSAGE));

  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar o Google Maps.')));
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=${libraries}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar o Google Maps.'));
    document.head.appendChild(script);
  });

  promise.catch(() => promisesByLibraries.delete(libraries));
  promisesByLibraries.set(libraries, promise);
  return promise;
};
