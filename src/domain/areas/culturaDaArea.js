/**
 * Cultura da Área (D-PROD-216): a área do mapa aponta para uma cultura do cadastro
 * de Culturas da MESMA fazenda (CADCULTURAS). Regras puras, sem rede, para o
 * formulário e para quem mostra a área.
 *
 *  - a lista do formulário traz as culturas ATIVAS da fazenda, por código; a
 *    cultura que a área já tem continua na lista mesmo se foi inativada depois
 *    (editar a área não obriga a trocar a cultura);
 *  - o rótulo é "001 · BRACHIARIA BRIZANTHA CV. MARANDU";
 *  - área antiga, sem `cultura_id`, continua com o texto de antes em
 *    `tipo_pastagem` (a dica do formulário mostra esse texto até alguém escolher).
 */

/**
 * @typedef {{ id: string, codigo?: string | null, nome?: string | null, tipo?: string | null, ativo?: boolean }} CulturaResumo
 */

/** "001 · NOME" (sem código, só o nome). @param {CulturaResumo | null | undefined} c */
export const rotuloCultura = (c) => {
  if (!c) return '';
  const nome = String(c.nome ?? '').trim();
  const codigo = String(c.codigo ?? '').trim();
  return codigo ? `${codigo} · ${nome}` : nome;
};

/** Código numérico primeiro, na ordem do número; depois os demais, em ordem alfabética. */
const ordemDoCodigo = (a, b) => {
  const ca = String(a.codigo ?? '');
  const cb = String(b.codigo ?? '');
  const na = /^\d+$/.test(ca) ? Number(ca) : Number.POSITIVE_INFINITY;
  const nb = /^\d+$/.test(cb) ? Number(cb) : Number.POSITIVE_INFINITY;
  if (na !== nb) return na - nb;
  return ca.localeCompare(cb, 'pt-BR') || String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR');
};

/**
 * Culturas que o formulário oferece: as ativas da fazenda e, se a área já tem uma
 * cultura inativa, ela também (no fim da ordem de código, como as outras).
 * @param {CulturaResumo[] | null | undefined} lista
 * @param {string | null | undefined} culturaIdAtual
 * @returns {CulturaResumo[]}
 */
export const culturasParaArea = (lista, culturaIdAtual) =>
  (Array.isArray(lista) ? lista : [])
    .filter((c) => c && c.id && (c.ativo !== false || c.id === culturaIdAtual))
    .slice()
    .sort(ordemDoCodigo);

/**
 * Texto que a área mostra para a cultura: o rótulo da cultura ligada; sem ela, o
 * texto antigo de `tipo_pastagem`.
 * @param {{ cultura?: CulturaResumo | null, tipo_pastagem?: string | null } | null | undefined} area
 */
export const textoDaCulturaDaArea = (area) => (area?.cultura ? rotuloCultura(area.cultura) : String(area?.tipo_pastagem ?? '').trim());
