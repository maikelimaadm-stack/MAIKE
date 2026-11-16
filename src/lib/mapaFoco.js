/**
 * Foco do Mapa Geral (D-PROD-V12): os segmentos Lotes · Pastos · Tarefas da
 * barra do topo escolhem o que o mapa destaca, por cima dos filtros e das
 * permissões de hoje (nada daqui é salvo nem muda a preferência do usuário).
 *
 * - Lotes (padrão): o mapa de sempre.
 * - Pastos: sem marcadores de lote e de tarefa; o rótulo da área mostra a
 *   lotação ("x,x UA (y,yy/ha)") ou, na área sem gado, os dias de descanso.
 * - Tarefas: sem marcadores de lote e sem cochos/depósitos; as tarefas ficam.
 *
 * O foco não é persistido: o mapa abre sempre em Lotes, como no v12.
 * Puro: sem React, sem mapa, sem storage.
 */

/** @typedef {'lotes' | 'pastos' | 'tarefas'} FocoMapa */
/** @typedef {{ lotes: boolean, suplementacao: boolean, tarefas: boolean, lotacaoNoRotulo: boolean }} CamadasDoFoco */

/** @type {FocoMapa} */
export const FOCO_PADRAO = 'lotes';

/** Segmentos da barra do topo, na ordem da tela. */
export const FOCOS_MAPA = Object.freeze([
  Object.freeze({ id: /** @type {FocoMapa} */ ('lotes'), rotulo: 'Lotes' }),
  Object.freeze({ id: /** @type {FocoMapa} */ ('pastos'), rotulo: 'Pastos' }),
  Object.freeze({ id: /** @type {FocoMapa} */ ('tarefas'), rotulo: 'Tarefas' }),
]);

/**
 * Uma constante por foco: o mesmo objeto a cada chamada, para servir de
 * dependência de efeito sem redesenhar o mapa a cada render.
 *
 * @type {Readonly<Record<FocoMapa, Readonly<CamadasDoFoco>>>}
 */
const CAMADAS_POR_FOCO = Object.freeze({
  lotes: Object.freeze({ lotes: true, suplementacao: true, tarefas: true, lotacaoNoRotulo: false }),
  pastos: Object.freeze({ lotes: false, suplementacao: true, tarefas: false, lotacaoNoRotulo: true }),
  tarefas: Object.freeze({ lotes: false, suplementacao: false, tarefas: true, lotacaoNoRotulo: false }),
});

/**
 * @param {unknown} valor
 * @returns {valor is FocoMapa}
 */
export const ehFocoMapa = (valor) => valor === 'lotes' || valor === 'pastos' || valor === 'tarefas';

/**
 * Focos que a conta pode usar (B2): Lotes sempre; Pastos só com "Ver áreas"
 * (sem áreas não há onde mostrar a lotação); Tarefas só com o uso das tarefas
 * no mapa (a mesma regra do antigo botão Tarefas, `podeUsarTarefasMapa`).
 *
 * @param {{ visualizarAreas?: boolean, usarTarefas?: boolean }} [permissoes]
 * @returns {FocoMapa[]}
 */
export function focosPermitidos({ visualizarAreas = false, usarTarefas = false } = {}) {
  /** @type {FocoMapa[]} */
  const lista = [FOCO_PADRAO];
  if (visualizarAreas === true) lista.push('pastos');
  if (usarTarefas === true) lista.push('tarefas');
  return lista;
}

/**
 * Foco em vigor: o escolhido, enquanto a conta puder usá-lo; senão Lotes
 * (perdeu a permissão do foco atual → volta para Lotes).
 *
 * @param {unknown} foco
 * @param {readonly string[]} permitidos
 * @returns {FocoMapa}
 */
export function focoEmVigor(foco, permitidos) {
  return ehFocoMapa(foco) && permitidos.includes(foco) ? foco : FOCO_PADRAO;
}

/**
 * O que o foco deixa no mapa, sempre somado às camadas e permissões de hoje:
 * `lotes` (marcadores de lote), `suplementacao` (cochos e depósitos),
 * `tarefas` (marcadores de tarefa) e `lotacaoNoRotulo` (texto de UA ou de
 * descanso no rótulo da área). Foco desconhecido vale como Lotes.
 *
 * @param {unknown} foco
 * @returns {Readonly<CamadasDoFoco>}
 */
export function camadasDoFoco(foco) {
  return CAMADAS_POR_FOCO[ehFocoMapa(foco) ? foco : FOCO_PADRAO];
}
