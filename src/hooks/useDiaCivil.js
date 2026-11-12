/**
 * Dia civil de "hoje" (AAAA-MM-DD) no fuso IANA da fazenda, que vira sozinho à
 * meia-noite NAQUELE fuso (D-PROD-178).
 *
 *  - Um ÚNICO timer de módulo por fuso, compartilhado por todos os
 *    componentes (`useSyncExternalStore`): sem polling por ponto, sem
 *    `setInterval` por tela.
 *  - O timer mira a próxima meia-noite no fuso e o atraso é recalculado a cada
 *    disparo (cobre horário de verão e relógio ajustado), com teto de
 *    segurança de 1 h.
 *  - Aba em segundo plano e suspensão atrasam timers: `visibilitychange`
 *    (aba visível) e `focus` rechecam o dia na hora.
 *  - Sem fuso (empresa sem `fuso_horario`) ou fuso inválido: relógio do
 *    navegador, como `hojeNoFuso(null)` — a tela que precisar avisa.
 *
 * A aritmética de datas de negócio continua em `src/lib/diaCivil.js`.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { hojeNoFuso } from '@/lib/diaCivil';

/** Teto do atraso de um disparo: mesmo com conta errada, recheca de hora em hora. */
export const TETO_ATRASO_DIA_CIVIL_MS = 60 * 60 * 1000;
/** Folga depois da meia-noite, para o disparo cair já no dia novo. */
const FOLGA_MS = 50;
const MS_DIA = 86400000;

/**
 * Hora de parede (h, min, s) no fuso; fuso inválido → relógio do navegador.
 * @param {string|null|undefined} fuso
 * @param {Date} agora
 */
const horaDeParede = (fuso, agora) => {
  /** @param {string|undefined} timeZone */
  const ler = (timeZone) => {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit', numberingSystem: 'latn',
    }).formatToParts(agora);
    const v = (/** @type {string} */ tipo) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
    return { hora: v('hour') % 24, minuto: v('minute'), segundo: v('second') };
  };
  try {
    return ler(fuso || undefined);
  } catch {
    return ler(undefined);
  }
};

/**
 * Milissegundos de `agora` até a próxima meia-noite no fuso (função pura).
 * Conta pela hora de parede do fuso; num dia com troca de horário a conta pode
 * errar pelo tamanho da troca, e por isso quem agenda recheca o dia no
 * disparo e reagenda.
 *
 * @param {string|null|undefined} fuso  IANA (ex.: "America/Sao_Paulo"); vazio → navegador
 * @param {Date} agora
 * @returns {number} entre 1 e 86 400 000
 */
export function msAteProximaMeiaNoite(fuso, agora) {
  const t = agora.getTime();
  const { hora, minuto, segundo } = horaDeParede(fuso, agora);
  const ms = ((t % 1000) + 1000) % 1000;
  const decorrido = ((hora * 60 + minuto) * 60 + segundo) * 1000 + ms;
  return Math.max(1, MS_DIA - decorrido);
}

/**
 * Atraso do próximo disparo: até a meia-noite no fuso (com folga), limitado ao
 * teto de 1 h.
 * @param {string|null|undefined} fuso
 * @param {Date} agora
 */
export function atrasoAteVirada(fuso, agora) {
  return Math.min(TETO_ATRASO_DIA_CIVIL_MS, msAteProximaMeiaNoite(fuso, agora) + FOLGA_MS);
}

// ── Loja de módulo: uma por fuso ───────────────────────────────────────────

/**
 * @typedef {Object} LojaDia
 * @property {string|null} fuso
 * @property {string} dia
 * @property {Set<() => void>} ouvintes
 * @property {ReturnType<typeof setTimeout>|null} timer
 */

/** @type {Map<string, LojaDia>} */
const lojas = new Map();
let ouvindoJanela = false;

/** @param {string|null|undefined} fuso @returns {LojaDia} */
const obterLoja = (fuso) => {
  const chave = fuso || '';
  let loja = lojas.get(chave);
  if (!loja) {
    loja = { fuso: fuso || null, dia: hojeNoFuso(fuso || null), ouvintes: new Set(), timer: null };
    lojas.set(chave, loja);
  }
  return loja;
};

/** Recalcula o dia e avisa os ouvintes se mudou. @param {LojaDia} loja */
const rechecar = (loja) => {
  const dia = hojeNoFuso(loja.fuso);
  if (dia === loja.dia) return;
  loja.dia = dia;
  loja.ouvintes.forEach((ouvinte) => ouvinte());
};

/** (Re)agenda o único timer da loja; sem ouvintes, não deixa timer. @param {LojaDia} loja */
const agendar = (loja) => {
  if (loja.timer != null) clearTimeout(loja.timer);
  loja.timer = null;
  if (!loja.ouvintes.size) return;
  loja.timer = setTimeout(() => {
    loja.timer = null;
    rechecar(loja);
    agendar(loja);
  }, atrasoAteVirada(loja.fuso, new Date()));
};

const aoVoltar = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  lojas.forEach((loja) => {
    if (!loja.ouvintes.size) return;
    rechecar(loja);
    agendar(loja);
  });
};

const sincronizarOuvintesDaJanela = () => {
  if (typeof window === 'undefined') return;
  const precisa = [...lojas.values()].some((loja) => loja.ouvintes.size > 0);
  if (precisa === ouvindoJanela) return;
  ouvindoJanela = precisa;
  if (precisa) {
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
  } else {
    document.removeEventListener('visibilitychange', aoVoltar);
    window.removeEventListener('focus', aoVoltar);
  }
};

/**
 * "Hoje" (AAAA-MM-DD) no fuso da fazenda, atualizado na virada do dia.
 * @param {string|null|undefined} fuso  `Empresa.fuso_horario`; null → navegador
 * @returns {string}
 */
export function useDiaCivil(fuso) {
  const chave = fuso || null;

  const assinar = useCallback((/** @type {() => void} */ ouvinte) => {
    const loja = obterLoja(chave);
    loja.ouvintes.add(ouvinte);
    sincronizarOuvintesDaJanela();
    rechecar(loja);
    agendar(loja);
    return () => {
      loja.ouvintes.delete(ouvinte);
      agendar(loja);
      sincronizarOuvintesDaJanela();
    };
  }, [chave]);

  const ler = useCallback(() => {
    const loja = obterLoja(chave);
    // Sem ouvintes não há timer: o valor guardado pode ser de outro dia.
    if (!loja.ouvintes.size) loja.dia = hojeNoFuso(loja.fuso);
    return loja.dia;
  }, [chave]);

  return useSyncExternalStore(assinar, ler, ler);
}
