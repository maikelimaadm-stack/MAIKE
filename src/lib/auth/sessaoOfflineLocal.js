/**
 * Último contexto de sessão confirmado pelo servidor, guardado no aparelho
 * (D-PROD-291).
 *
 * Existe para o app abrir sem internet: quando a sessão foi guardada com
 * "Manter conectado" e o servidor não responde, a tela entra com este contexto
 * e os dados salvos. Guarda só identificadores (conta, login, tenant), nunca o
 * token. Sai junto do token no logout.
 *
 * Não é autorização: nenhuma gravação passa por aqui, e o servidor continua
 * recusando tudo que o token não permitir.
 */

const CHAVE = 'maike_sessao_offline';

const texto = (valor) => (typeof valor === 'string' && valor.trim() ? valor.trim() : '');

const armazenamento = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

/**
 * @typedef {{cliente_id: string, usuario_id: string, login: string}} SessaoOffline
 */

/**
 * Guarda o contexto que o servidor acabou de confirmar.
 *
 * @param {{cliente_id?: unknown, usuario_id?: unknown, login?: unknown}} contexto
 */
export const lembrarSessaoOffline = (contexto) => {
  const salvo = {
    cliente_id: texto(contexto?.cliente_id),
    usuario_id: texto(contexto?.usuario_id),
    login: texto(contexto?.login),
  };
  if (!salvo.cliente_id || !salvo.usuario_id) return;
  try {
    armazenamento()?.setItem(CHAVE, JSON.stringify(salvo));
  } catch {
    // Sem armazenamento o app só não abre sem internet.
  }
};

/** @returns {SessaoOffline|null} */
export const lerSessaoOffline = () => {
  try {
    const bruto = armazenamento()?.getItem(CHAVE);
    const salvo = bruto ? JSON.parse(bruto) : null;
    if (!texto(salvo?.cliente_id) || !texto(salvo?.usuario_id)) return null;
    return { cliente_id: texto(salvo.cliente_id), usuario_id: texto(salvo.usuario_id), login: texto(salvo.login) };
  } catch {
    return null;
  }
};

/** Esquece o contexto (logout ou token recusado). */
export const esquecerSessaoOffline = () => {
  try {
    armazenamento()?.removeItem(CHAVE);
  } catch {
    // Nada a fazer.
  }
};
