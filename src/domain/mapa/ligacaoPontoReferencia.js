/**
 * Ligação entre o ponto de referência do mapa (`PontoReferencia`) e os
 * registros operacionais do mesmo lugar: cocho/depósito (`PontoSuplementacao`)
 * e bebedouro (`Bebedouro`).
 *
 * **Fonte única** do casamento: a coluna do Cadastro de Pontos, o formulário do
 * ponto, a exclusão em cascata, o cadastro em lote e o rename do local usam
 * estas funções. Antes cada um tinha a sua regra (nome OU sigla, sem olhar a
 * categoria), e salvar ou excluir um ponto comum inativava ou apagava o cocho
 * que só tinha a mesma sigla.
 *
 * Regra (sem coluna de vínculo no schema, então determinística e estrita):
 *  - Bebedouro: SOMENTE `ponto_referencia_id === ponto.id`.
 *  - Cocho/depósito: mesma empresa + categoria compatível com o tipo do ponto
 *    (COCHO ↔ cocho, DEPÓSITO ↔ depósito; bebedouro nunca casa com cocho) +
 *    nome igual (normalizado). Coordenadas só desempatam. Sigla sozinha nunca
 *    liga. Mais de um candidato depois do desempate = ambíguo: quem chama não
 *    altera nem apaga nada e avisa.
 *
 * Puro: sem React, sem provider, sem `window`, sem storage.
 */

/** @param {unknown} valor */
export const normalizarLigacao = (valor = '') =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();

export const CATEGORIA_COCHO = 'COCHO';
export const CATEGORIA_DEPOSITO = 'DEPOSITO';

/**
 * Categoria de suplementação que o TIPO do ponto de referência pede, ou `null`
 * quando o ponto não é cocho nem depósito. Mesma precedência do formulário:
 * depósito antes de cocho.
 *
 * @param {unknown} tipo
 * @returns {'COCHO'|'DEPOSITO'|null}
 */
export const categoriaSuplementacaoDoTipo = (tipo) => {
  const t = normalizarLigacao(tipo);
  if (!t) return null;
  if (t.includes('DEPOSITO')) return CATEGORIA_DEPOSITO;
  if (t.includes('COCHO')) return CATEGORIA_COCHO;
  return null;
};

/** O tipo do ponto de referência é bebedouro? @param {unknown} tipo */
export const tipoEhBebedouro = (tipo) => normalizarLigacao(tipo).includes('BEBEDOURO');

/** Categoria normalizada do registro de suplementação. @param {any} sup */
export const categoriaDoRegistroSuplementacao = (sup) => {
  const c = normalizarLigacao(sup?.categoria_ponto);
  if (c === CATEGORIA_DEPOSITO) return CATEGORIA_DEPOSITO;
  if (c === CATEGORIA_COCHO) return CATEGORIA_COCHO;
  return null;
};

/** Tolerância de coordenada (~1 cm) para o desempate. */
const TOLERANCIA_COORDENADA = 1e-7;

/** @param {any} a @param {any} b */
export const mesmasCoordenadas = (a, b) => {
  const la = Number(a?.lat);
  const ga = Number(a?.lng);
  const lb = Number(b?.lat);
  const gb = Number(b?.lng);
  if (![la, ga, lb, gb].every(Number.isFinite)) return false;
  return Math.abs(la - lb) <= TOLERANCIA_COORDENADA && Math.abs(ga - gb) <= TOLERANCIA_COORDENADA;
};

/**
 * @typedef {{ registro: any|null, ambiguo: boolean, candidatos: any[] }} ResultadoLigacao
 */

const SEM_LIGACAO = Object.freeze({ registro: null, ambiguo: false, candidatos: [] });

/**
 * Cocho/depósito ligado ao ponto de referência.
 *
 * `pontosSuplementacao` é a lista que o chamador quer considerar (em geral os
 * ativos da empresa). O ponto pode trazer `ponto_suplementacao_id` explícito
 * (itens do cadastro em lote): ele vale se for da mesma empresa e categoria.
 *
 * Cocho/depósito que está EXATAMENTE no lugar de OUTRO ponto de referência
 * ativo da mesma empresa e categoria pertence àquele ponto: não liga por nome a
 * este (`opcoes.outrosPontos`). Caso real de produção: dois pontos "TESTE" de
 * depósito e um único depósito, no lugar do segundo; sem isto o primeiro
 * (sobra de um cadastro que falhou) também "achava" o depósito, e excluí-lo
 * tentaria levar junto o depósito do outro.
 *
 * @param {any} ponto ponto de referência (`id`, `nome`, `tipo`, `empresa_id`, `coordenadas`)
 * @param {any[]} pontosSuplementacao
 * @param {{ tipo?: unknown, outrosPontos?: any[] }} [opcoes] `tipo` substitui `ponto.tipo`
 *   (ex.: tipo anterior numa edição); `outrosPontos` são os pontos de referência
 *   conhecidos (pode incluir o próprio ponto), para saber de quem é cada lugar.
 * @returns {ResultadoLigacao}
 */
export const resolverSuplementacaoDoPonto = (ponto, pontosSuplementacao, opcoes = {}) => {
  if (!ponto) return SEM_LIGACAO;
  const categoria = categoriaSuplementacaoDoTipo(opcoes.tipo !== undefined ? opcoes.tipo : ponto.tipo);
  if (!categoria) return SEM_LIGACAO;

  const lista = Array.isArray(pontosSuplementacao) ? pontosSuplementacao : [];
  const mesmaEmpresa = (sup) => (sup?.empresa_id ?? null) === (ponto.empresa_id ?? null) || !ponto.empresa_id;
  const compativel = (sup) => mesmaEmpresa(sup) && categoriaDoRegistroSuplementacao(sup) === categoria;

  if (ponto.ponto_suplementacao_id) {
    const porId = lista.find((sup) => sup?.id === ponto.ponto_suplementacao_id && compativel(sup));
    if (porId) return { registro: porId, ambiguo: false, candidatos: [porId] };
  }

  const nome = normalizarLigacao(ponto.nome);
  if (!nome) return SEM_LIGACAO;

  const outrosPontos = (Array.isArray(opcoes.outrosPontos) ? opcoes.outrosPontos : []).filter(
    (p) =>
      p &&
      p.ativo !== false &&
      (ponto.id == null || p.id !== ponto.id) &&
      (p.empresa_id ?? null) === (ponto.empresa_id ?? null) &&
      categoriaSuplementacaoDoTipo(p.tipo) === categoria
  );
  const doLugarDeOutroPonto = (sup) =>
    !mesmasCoordenadas(sup.coordenadas, ponto.coordenadas) &&
    outrosPontos.some((p) => mesmasCoordenadas(p.coordenadas, sup.coordenadas));

  const candidatos = lista.filter(
    (sup) => compativel(sup) && normalizarLigacao(sup.nome_ponto) === nome && !doLugarDeOutroPonto(sup)
  );
  if (candidatos.length === 0) return SEM_LIGACAO;
  if (candidatos.length === 1) return { registro: candidatos[0], ambiguo: false, candidatos };

  const noMesmoLugar = candidatos.filter((sup) => mesmasCoordenadas(sup.coordenadas, ponto.coordenadas));
  if (noMesmoLugar.length === 1) return { registro: noMesmoLugar[0], ambiguo: false, candidatos };
  return { registro: null, ambiguo: true, candidatos };
};

/**
 * Bebedouros ligados ao ponto de referência: só pelo id.
 *
 * @param {any} ponto
 * @param {any[]} bebedouros
 * @returns {any[]}
 */
export const bebedourosDoPonto = (ponto, bebedouros) => {
  if (!ponto?.id) return [];
  return (Array.isArray(bebedouros) ? bebedouros : []).filter((b) => b?.ponto_referencia_id === ponto.id);
};

/**
 * O caminho inverso: o ponto de referência de um cocho/depósito (usado pelo
 * rename do local). O nome do depósito acabou de mudar, então o lugar manda:
 * mesma empresa + mesmas coordenadas; mais de um ponto no lugar → só os de
 * categoria compatível → só os de mesmo nome. Sem ninguém no lugar, cai na
 * regra por nome (empresa + categoria + nome). Sobrou mais de um = ambíguo.
 *
 * @param {any} sup registro de suplementação (com o nome ANTERIOR)
 * @param {any[]} pontosReferencia
 * @returns {ResultadoLigacao}
 */
export const resolverPontoReferenciaDaSuplementacao = (sup, pontosReferencia) => {
  if (!sup) return SEM_LIGACAO;
  const categoria = categoriaDoRegistroSuplementacao(sup);
  const nome = normalizarLigacao(sup.nome_ponto);
  const daEmpresa = (Array.isArray(pontosReferencia) ? pontosReferencia : []).filter(
    (p) => p && p.ativo !== false && (p.empresa_id ?? null) === (sup.empresa_id ?? null)
  );
  const decidir = (candidatos) => {
    if (candidatos.length <= 1) return candidatos;
    const compativeis = candidatos.filter((p) => categoriaSuplementacaoDoTipo(p.tipo) === categoria);
    const base = compativeis.length ? compativeis : candidatos;
    if (base.length <= 1) return base;
    const mesmoNome = base.filter((p) => nome && normalizarLigacao(p.nome) === nome);
    return mesmoNome.length ? mesmoNome : base;
  };

  let candidatos = decidir(daEmpresa.filter((p) => mesmasCoordenadas(p.coordenadas, sup.coordenadas)));
  if (candidatos.length === 0 && categoria && nome) {
    candidatos = daEmpresa.filter(
      (p) => categoriaSuplementacaoDoTipo(p.tipo) === categoria && normalizarLigacao(p.nome) === nome
    );
  }
  if (candidatos.length === 0) return SEM_LIGACAO;
  if (candidatos.length === 1) return { registro: candidatos[0], ambiguo: false, candidatos };
  return { registro: null, ambiguo: true, candidatos };
};
