/**
 * Leituras que o app baixa antes de abrir pela primeira vez (D-PROD-294).
 *
 * Cada PORTA de módulo (`src/apis/<modulo>/...Port.js`) declara aqui, ao
 * carregar, as leituras que as suas telas fazem ao abrir, com os filtros
 * padrão — o caminho continua só na porta do módulo (regra de porta única).
 * `{empresa}` é trocado pela empresa selecionada na hora de baixar.
 *
 * Para conferir as leituras de uma tela: abra-a e veja os GETs em
 * /api/native (ou rode as telas com backend falso). Tela nova: a porta dela
 * registra as suas leituras aqui.
 */

/** @type {Set<string>} */
const LEITURAS = new Set();

/** @param {string[]} caminhos */
export const registrarLeiturasOffline = (caminhos) => {
  for (const c of caminhos) if (typeof c === 'string' && c.startsWith('/')) LEITURAS.add(c);
};

/** Leituras registradas pelas portas, já com a empresa. */
export const leiturasOfflineRegistradas = (empresaId) => {
  const empresa = empresaId ? encodeURIComponent(empresaId) : null;
  return [...LEITURAS]
    .filter((c) => empresa || !c.includes('{empresa}'))
    .map((c) => (empresa ? c.split('{empresa}').join(empresa) : c));
};
