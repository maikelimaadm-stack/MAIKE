/**
 * O script operacional está mirando um ambiente protegido? (PR145-R5)
 *
 * Antes só `NODE_ENV=production` contava — e o terminal de quem opera
 * normalmente não define isso, mesmo apontado para o banco de produção. Agora
 * também conta qualquer banco fora desta máquina: produção e staging exigem a
 * mesma liberação explícita (`…_ALLOW_PRODUCTION=sim`) e a aprovação separada
 * do runbook. Nunca devolve nem imprime a URL ou o host.
 *
 * @param {NodeJS.ProcessEnv} ambiente
 * @param {string | undefined | null} databaseUrl
 * @returns {string | null} motivo, ou null quando o alvo é local
 */
export const motivoAlvoProtegido = (ambiente, databaseUrl) => {
  if (ambiente.NODE_ENV === 'production') return 'NODE_ENV=production';
  if (!databaseUrl) return null;
  let host;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return 'DATABASE_URL não reconhecida';
  }
  // Sem host = socket local (postgresql://usuario@/banco?host=/tmp).
  return ['', 'localhost', '127.0.0.1', '::1', '[::1]'].includes(host) ? null : 'banco fora desta máquina';
};
