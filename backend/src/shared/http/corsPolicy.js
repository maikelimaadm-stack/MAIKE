/**
 * Política de CORS (P4.0, D-PROD-24).
 *
 * A partir da P4.0 o navegador chama este backend diretamente, e frontend e
 * backend podem viver em origins diferentes — Vercel e Railway, por exemplo.
 * CORS é o que decide **quais páginas** podem ler nossas respostas.
 *
 * ─── Por que allowlist exata, e nunca `*` ──────────────────────────────────
 *
 * `origin: '*'` faz qualquer site do mundo poder chamar esta API a partir do
 * navegador de um usuário logado. Como esta fase autentica por `Authorization:
 * Bearer` — e não por cookie — o navegador não anexa credencial sozinho, então
 * `*` não seria imediatamente explorável. Mas isso é um detalhe do transporte
 * de hoje: no dia em que alguém ligar cookie de sessão, `*` vira CSRF
 * completo, e ninguém vai lembrar que a permissividade estava lá.
 *
 * ─── Por que comparação exata, e nunca prefixo ─────────────────────────────
 *
 * `startsWith` e `includes` são a forma clássica de errar isto:
 *
 *   permitido   https://maike.app
 *   atacante    https://maike.app.evil.com      → passa no startsWith
 *   atacante    https://evil.com/#https://maike.app → passa no includes
 *
 * Origin é um valor estruturado com igualdade definida. Comparação é `===`.
 *
 * ─── Requisição sem `Origin` ───────────────────────────────────────────────
 *
 * `curl`, health check, teste server-side e chamada de outro serviço não mandam
 * `Origin`. Elas passam — e isso não afrouxa nada: CORS é uma proteção que o
 * **navegador** aplica a páginas web. Recusar requisição sem `Origin` não
 * bloquearia atacante nenhum (quem controla o cliente controla o header) e
 * quebraria monitoramento e integração. A defesa dessas chamadas é o JWT.
 */

/** Métodos que a API usa hoje. `OPTIONS` entra pelo preflight. */
const METODOS = Object.freeze(['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']);

/**
 * Cabeçalhos que o navegador pode enviar.
 *
 * `Authorization` é obrigatório: sem ele o preflight recusa a sessão nativa
 * inteira e o sintoma aparece como "erro de rede" na tela, sem pista nenhuma.
 */
const HEADERS_PERMITIDOS = Object.freeze(['Content-Type', 'Authorization', 'Accept', 'x-request-id']);

/**
 * A origin está na allowlist?
 *
 * Exportada para teste: é a regra inteira em uma função, e testar a função é
 * mais honesto do que reproduzir a comparação dentro do teste.
 *
 * @param {string|undefined} origin valor do header `Origin`
 * @param {string[]} permitidas allowlist normalizada
 * @returns {boolean}
 */
export const originPermitida = (origin, permitidas) => {
  if (typeof origin !== 'string' || origin === '') return false;
  if (!Array.isArray(permitidas) || permitidas.length === 0) return false;
  return permitidas.includes(origin);
};

/**
 * Opções do `@fastify/cors`.
 *
 * O callback devolve `true`/`false`, nunca a origin recebida: devolver o que
 * chegou é o mesmo que `*` escrito de outro jeito.
 *
 * @param {string[]} permitidas
 */
export const opcoesDeCors = (permitidas) => ({
  /**
   * @param {string|undefined} origin
   * @param {(erro: Error|null, permitido: boolean) => void} callback
   */
  origin: (origin, callback) => {
    // Sem `Origin`: não é requisição de página web. Ver cabeçalho.
    if (origin === undefined || origin === null || origin === '') {
      callback(null, true);
      return;
    }
    // Origin desconhecida não é erro do servidor — é uma resposta sem os
    // cabeçalhos de liberação, e o navegador bloqueia. Passar `Error` aqui
    // produziria 500 e transformaria uma decisão de política em falha.
    callback(null, originPermitida(origin, permitidas));
  },
  methods: [...METODOS],
  allowedHeaders: [...HEADERS_PERMITIDOS],
  // Bearer, não cookie: nada de `Access-Control-Allow-Credentials`. Ligá-lo
  // sem necessidade abriria a porta de CSRF que o Bearer justamente evita.
  credentials: false,
  maxAge: 600,
});
