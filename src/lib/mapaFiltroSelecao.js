/** Seleções antigas (texto) e novas (lista) têm o mesmo significado. */
export const filtroSemRestricao = (selecao) => !selecao || (Array.isArray(selecao) ? selecao.length === 0 : selecao === 'todos' || selecao === 'todas');
export const filtroInclui = (selecao, valor) => filtroSemRestricao(selecao) || (Array.isArray(selecao) ? selecao.includes(valor) : selecao === valor);
