/** D-PROD-254 — peças puras do registro de campo e dos detalhes da área. */

const MESES_CURTOS = Object.freeze(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);

/**
 * "2026-11-18" ou "2026-11" → "nov/26" (o mesmo texto que o servidor põe no nome da atividade); vazio se inválido.
 * @param {string|null|undefined} diaOuMes
 */
export const rotuloDoMesCurto = (diaOuMes) => {
  const m = typeof diaOuMes === 'string' ? /^(\d{4})-(\d{2})/.exec(diaOuMes) : null;
  const mes = m ? MESES_CURTOS[Number(m[2]) - 1] : undefined;
  return m && mes ? `${mes}/${m[1].slice(2)}` : '';
};

/** A raiz das consultas dos detalhes da área (resumo, registros e tipos); o registro novo invalida tudo dela. */
export const QUERY_ATIVIDADES_DA_AREA = 'atividades-da-area';
