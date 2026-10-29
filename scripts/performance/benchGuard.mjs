/**
 * Guard de ambiente dos benchmarks locais (SCALE-01 R2).
 *
 * Função PURA: recebe um objeto de ambiente e decide, sem abrir conexão nem
 * importar Prisma, se o benchmark pode rodar. O script chama isto DEPOIS de
 * carregar o `.env` (mesmo `dotenv` do backend) e ANTES de qualquer import de
 * banco.
 *
 * Por que comparar aliases: `backend/src/config/env.js` resolve a URL do
 * Prisma como `POSTGRES_PRISMA_URL ?? DATABASE_URL ?? POSTGRES_URL`. Validar
 * só `DATABASE_URL` aprovaria um banco e conectaria em outro (falha original
 * da R1). Aqui qualquer alias de conexão presente precisa ser IDÊNTICO a
 * `DATABASE_URL`, e a URL efetiva calculada com a mesma precedência do
 * backend precisa ser a aprovada.
 *
 * Limitação: hostname local não prova ausência de túnel/port-forward para um
 * banco remoto. O script ainda confere a identidade da conexão aberta
 * (`current_database`, `inet_server_addr`, roles Supabase) antes de mutar —
 * mas o ambiente precisa ser descartável de fato.
 */

/** Aliases que algum caminho do backend/CLI usa como URL de conexão. */
export const ALIASES_CONEXAO = Object.freeze([
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'POSTGRES_URL_NON_POOLING',
  'MIGRATION_DATABASE_URL',
  'DIRECT_URL',
]);

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const PROVEDOR_REMOTO = /supabase|vercel|pooler|neon\.tech|rds\.amazonaws|amazonaws|azure|render\.com|railway/i;

const texto = (env, nome) => {
  const v = env[nome];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/** Mesma precedência de `resolverDatabaseUrl` em backend/src/config/env.js. */
export const urlEfetivaDoBackend = (env) =>
  texto(env, 'POSTGRES_PRISMA_URL') ?? texto(env, 'DATABASE_URL') ?? texto(env, 'POSTGRES_URL');

/** Descrição sem credenciais, segura para log. */
export const descreverUrl = (bruta) => {
  try {
    const u = new URL(bruta);
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '<url inválida>';
  }
};

/**
 * @param {Record<string, string|undefined>} env
 * @returns {{ ok: true, url: string, banco: string, host: string } | { ok: false, motivo: string }}
 */
export const validarAmbienteBench = (env) => {
  const recusa = (motivo) => ({ ok: /** @type {const} */ (false), motivo });

  if (texto(env, 'PERF_TEST_LOCAL') !== 'sim') return recusa('defina PERF_TEST_LOCAL=sim (opt-in explícito).');
  if (texto(env, 'NODE_ENV') === 'production') return recusa('NODE_ENV=production.');

  const aprovada = texto(env, 'DATABASE_URL');
  if (!aprovada) return recusa('DATABASE_URL explícita é obrigatória.');

  for (const alias of ALIASES_CONEXAO) {
    const valor = texto(env, alias);
    if (valor !== null && valor !== aprovada) {
      return recusa(`${alias} presente e diferente de DATABASE_URL — conexão ambígua.`);
    }
  }
  if (urlEfetivaDoBackend(env) !== aprovada) {
    return recusa('URL efetiva do backend difere de DATABASE_URL.');
  }

  let url;
  try {
    url = new URL(aprovada);
  } catch {
    return recusa('DATABASE_URL inválida.');
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) return recusa('DATABASE_URL não é PostgreSQL.');
  if (PROVEDOR_REMOTO.test(aprovada)) return recusa('URL com provedor remoto.');
  if (!HOSTS_LOCAIS.has(url.hostname)) return recusa(`host "${url.hostname}" não é local.`);
  if (url.port === '6543') return recusa('porta 6543 (pooler de transação) recusada.');
  for (const [k, v] of url.searchParams) {
    if (/^host$/i.test(k) && !v.startsWith('/')) return recusa('parâmetro host= remoto na query string.');
    if (/pgbouncer/i.test(k)) return recusa('parâmetro pgbouncer na URL.');
  }
  const banco = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/perf|test/i.test(banco)) return recusa(`banco "${banco}" não tem "perf"/"test" no nome.`);

  return { ok: true, url: aprovada, banco, host: url.hostname };
};

/** IPv4 privado (RFC 1918) — faixas de rede Docker/VM local, nunca públicas. */
const ehIpv4Privado = (ip) => {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

/**
 * `PERF_SERVIDOR_PERMITIDO`: lista de IPs EXATOS de servidor aceitos além do
 * loopback — para PostgreSQL local em container (Docker publica a porta em
 * `localhost`, mas o servidor responde com o IP da bridge, ex.: 172.18.0.2).
 * Só IPv4 privado (RFC 1918) entra; IP público é ignorado.
 *
 * @param {string|undefined|null} bruto
 * @returns {Set<string>}
 */
export const servidoresPermitidos = (bruto) =>
  new Set(
    String(bruto ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter((ip) => ehIpv4Privado(ip))
  );

/**
 * Confere a conexão REALMENTE aberta antes de qualquer mutação.
 *
 * @param {{ banco: string, servidor: string|null, rolesSupabase: number }} identidade
 * @param {string} bancoAprovado
 * @param {Set<string>} [extrasPermitidos] ver `servidoresPermitidos`
 */
export const validarIdentidadeConexao = (identidade, bancoAprovado, extrasPermitidos = new Set()) => {
  if (identidade.banco !== bancoAprovado) {
    return { ok: false, motivo: `conectado em "${identidade.banco}", aprovado "${bancoAprovado}".` };
  }
  const s = identidade.servidor === null ? null : identidade.servidor.replace(/\/\d+$/, '');
  if (s !== null && !['127.0.0.1', '::1'].includes(s) && !extrasPermitidos.has(s)) {
    return {
      ok: false,
      motivo: `servidor ${s} não é loopback (container local? defina PERF_SERVIDOR_PERMITIDO=${s} se for IP privado seu).`,
    };
  }
  if (identidade.rolesSupabase > 0) {
    return { ok: false, motivo: 'roles típicas do Supabase presentes (supabase_admin/authenticator).' };
  }
  return { ok: true };
};
