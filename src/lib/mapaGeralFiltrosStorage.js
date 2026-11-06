/**
 * Preferências do Mapa Geral (camadas e filtros) — POR USUÁRIO (D-PROD-135).
 *
 * Chave: fazenda (cliente) + conta (login) + empresa — as TRÊS obrigatórias;
 * sem a fazenda conhecida não há leitura nem gravação (nunca um tenant "-"
 * compartilhado). Leitura tolerante a JSON inválido (R3-04).
 *
 * Legado: as chaves antigas por empresa (`mapa_geral_filtros_<empresa>`) e a
 * global (`mapa_geral_filtros`) não têm titular verificável — qualquer conta do
 * aparelho pode tê-las gravado. NÃO são herdadas por ninguém (herdar copiaria
 * filtros de outra pessoa) e NÃO são apagadas. Sem preferência própria, a conta
 * começa no PADRÃO, que o proprietário definiu: Áreas, Detalhes Áreas e Lotes
 * ligados (quando a permissão deixa ver).
 */

const PREFIXO_USUARIO = 'mapa_geral_filtros_u:';

/** Estado padrão COMPLETO — aplicado inteiro a todo escopo sem preferência. */
export const PADRAO_FILTROS_MAPA = Object.freeze({
  showAreas: true,
  showNomesAreas: true,
  showLotes: true,
  showHectaresAreas: true,
  showPontos: true,
  showLinhas: true,
  showCochos: true,
  showDepositos: true,
  showAlertas: true,
  showUserLocation: false,
  showTaskIcons: true,
  dragLotesEnabled: false,
  filtroCategoria: 'todas',
  filtroIdentificador: 'todos',
  filtroStatus: 'todos',
  filtroSistema: 'todos',
  filtroAlertaTipo: 'todos',
  filtroTipoCultura: 'todas',
  filtroTipoPastagem: 'todas',
  filtroSetor: 'todos',
  filtroPesoMin: null,
  filtroPesoMax: null,
  modoColoracao: 'padrao',
  // Visualização (PR #200): como o pasto é pintado. Enum validado abaixo.
  estiloPasto: 'cheio',
});

/** Estilos de pasto aceitos — os mesmos de `ESTILOS_PASTO` (src/lib/maplibre/mapaGeralRender.js). */
export const ESTILOS_PASTO_VALIDOS = Object.freeze(['cheio', 'suave', 'contorno']);

/**
 * @typedef {{ clienteId: string, login: string, empresaId: string }} EscopoFiltros
 */

/** @param {EscopoFiltros} escopo */
export const chaveFiltrosDoUsuario = (escopo) =>
  `${PREFIXO_USUARIO}${escopo.clienteId}:${escopo.login}:${escopo.empresaId}`;

/** As três partes do escopo são obrigatórias. */
export const escopoValido = (escopo) =>
  Boolean(escopo && typeof escopo === 'object' && escopo.clienteId && escopo.login && escopo.empresaId);

const parse = (bruto) => {
  if (!bruto) return null;
  try {
    const parsed = JSON.parse(bruto);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return null;
  }
};

/**
 * Preferência salva DESTE escopo (só a chave do usuário), ou null.
 * @param {EscopoFiltros|null|undefined} escopo
 * @returns {Record<string, unknown>|null}
 */
export const lerFiltrosMapaGeral = (escopo) => {
  if (typeof window === 'undefined' || !escopoValido(escopo)) return null;
  try {
    return parse(window.localStorage.getItem(chaveFiltrosDoUsuario(escopo)));
  } catch {
    return null;
  }
};

const numeroOuNulo = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Estado COMPLETO do escopo: o padrão, sobrescrito só pelos valores salvos de
 * tipo válido. Nada do escopo anterior sobrevive (troca de conta/empresa).
 * @param {Record<string, unknown>|null|undefined} salvo
 */
export const normalizarFiltrosMapa = (salvo) => {
  const s = salvo && typeof salvo === 'object' ? salvo : {};
  /** @type {Record<string, any>} */
  const out = { ...PADRAO_FILTROS_MAPA };
  for (const [k, padrao] of Object.entries(PADRAO_FILTROS_MAPA)) {
    if (typeof padrao === 'boolean' && typeof s[k] === 'boolean') out[k] = s[k];
    else if (typeof padrao === 'string' && typeof s[k] === 'string') out[k] = s[k];
  }
  if (!ESTILOS_PASTO_VALIDOS.includes(out.estiloPasto)) out.estiloPasto = PADRAO_FILTROS_MAPA.estiloPasto;
  out.filtroPesoMin = numeroOuNulo(s.filtroPesoMin);
  out.filtroPesoMax = numeroOuNulo(s.filtroPesoMax);
  // Formato antigo: um só liga/desliga para cochos e depósitos.
  if (typeof s.showPontosSuplementacao === 'boolean' && typeof s.showCochos !== 'boolean' && typeof s.showDepositos !== 'boolean') {
    out.showCochos = s.showPontosSuplementacao;
    out.showDepositos = s.showPontosSuplementacao;
  }
  return out;
};

/**
 * Campos que SÓ o painel "Filtros e camadas" edita (MapaFiltrosAvancados).
 * Fora daqui, de propósito: `showUserLocation` e `dragLotesEnabled` (têm botão
 * próprio — Minha localização e Mover — com permissão própria), `modoColoracao`
 * e `estiloPasto` (painel Visualização) e `mapType`.
 */
export const CAMPOS_DO_PAINEL_FILTROS = Object.freeze([
  'showAreas', 'showNomesAreas', 'showHectaresAreas', 'showPontos', 'showLinhas', 'showLotes',
  'showCochos', 'showDepositos', 'showAlertas', 'showTaskIcons',
  'filtroCategoria', 'filtroIdentificador', 'filtroStatus', 'filtroSistema', 'filtroAlertaTipo',
  'filtroTipoCultura', 'filtroTipoPastagem', 'filtroSetor', 'filtroPesoMin', 'filtroPesoMax',
]);

/**
 * Preferência APLICADA ao mapa (D-PROD-136, PREF-02). Sem a permissão do painel
 * que edita um campo, o usuário não vê nem desfaz o que salvou: o mapa mostra
 * o PADRÃO nesse campo. A preferência guardada não muda — volta a valer quando
 * a permissão voltar (mesma regra de `camadasVisiveis`).
 * @param {Record<string, any>} pref
 * @param {{ podeFiltrar: boolean, podeColorir: boolean }} poderes
 */
export const preferenciaAplicada = (pref, { podeFiltrar, podeColorir }) => {
  const out = { ...pref };
  if (!podeFiltrar) for (const k of CAMPOS_DO_PAINEL_FILTROS) out[k] = PADRAO_FILTROS_MAPA[k];
  if (!podeColorir) out.modoColoracao = PADRAO_FILTROS_MAPA.modoColoracao;
  return out;
};

/**
 * O que APARECE = preferência E permissão. A permissão nunca reescreve a preferência.
 * @param {Record<string, any>} pref
 * @param {Record<string, any>} perm permissões normalizadas do Mapa Geral
 */
export const camadasVisiveis = (pref, perm) => ({
  showAreas: Boolean(pref.showAreas && perm.visualizar_areas),
  showNomesAreas: Boolean(pref.showNomesAreas && perm.visualizar_nomes_areas),
  showPontos: Boolean(pref.showPontos && perm.visualizar_pontos_referencia),
  showLinhas: Boolean(pref.showLinhas && perm.visualizar_linhas),
  showLotes: Boolean(pref.showLotes && perm.visualizar_lotes),
  showCochos: Boolean(pref.showCochos && perm.visualizar_cochos_suplementacao),
  showDepositos: Boolean(pref.showDepositos && perm.visualizar_cochos_suplementacao),
  showAlertas: Boolean(pref.showAlertas && perm.visualizar_alertas),
  showUserLocation: Boolean(pref.showUserLocation && perm.visualizar_localizacao),
  dragLotesEnabled: Boolean(pref.dragLotesEnabled && perm.mover_lotes),
});

/**
 * @param {EscopoFiltros|null|undefined} escopo
 * @param {Record<string, unknown>} state
 */
export const salvarFiltrosMapaGeral = (escopo, state) => {
  if (typeof window === 'undefined' || !escopoValido(escopo)) return;
  try {
    window.localStorage.setItem(chaveFiltrosDoUsuario(escopo), JSON.stringify(state));
  } catch {
    // storage indisponível — montagem segue com defaults
  }
};
