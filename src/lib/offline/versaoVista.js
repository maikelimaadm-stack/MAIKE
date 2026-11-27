/**
 * D-PROD-358 — a versão que a pessoa viu (`versao_esperada`, D-PROD-316), ou nada.
 *
 * Só vale a versão que veio do servidor. A cópia que o celular montou sem internet (`_isOffline`) tem uma hora local:
 * mandá-la daria um falso "alterado por outra pessoa" depois que a fila sobe (a versão real é outra). Sem versão, o
 * servidor grava como antes; a fila sem internet já cuida da ordem das edições (D-PROD-316).
 * @param {any} registro
 * @returns {{ versao_esperada: string } | {}}
 */
export const versaoVista = (registro) =>
  registro && !registro._isOffline && typeof registro.updated_date === 'string' && registro.updated_date
    ? { versao_esperada: registro.updated_date }
    : {};
