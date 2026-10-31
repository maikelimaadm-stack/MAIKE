/**
 * Regras de campo da área importada (D-PROD-90) — puras, sem banco.
 *
 * Espelho no servidor de `src/domain/areas/regrasCadastroArea.js` (formulário
 * manual e assistente). As duas camadas não se importam — backend não lê
 * `src/` —, então a igualdade é provada por teste de paridade
 * (`tests/smoke/importacaoAreasParidade.test.js`), caso a caso.
 *
 * Diferença só de nome de campo: na tela o tipo de infraestrutura é
 * `tipo_infraestrutura`; aqui, como na coluna gravada, é `tipo_pastagem`.
 */

export const TIPOS_USO = Object.freeze(['Pastagem', 'Agricultura', 'Reserva', 'APP', 'Infraestrutura']);
export const TIPOS_CULTURA = Object.freeze([
  'Brachiaria', 'Mombaça', 'Tanzânia', 'Tifton', 'Piatã', 'Marandu', 'Panicum', 'Elefante',
  'Milho', 'Soja', 'Sorgo', 'Arroz', 'Trigo', 'Cevada', 'Cana-de-açúcar', 'Algodão',
  'Feijão', 'Girassol', 'Aveia', 'Café', 'Eucalipto', 'Floresta', 'Outros',
]);
export const TIPOS_INFRAESTRUTURA = Object.freeze([
  'Curral', 'Oficina', 'Casa', 'Barracão', 'Galpão', 'Depósito', 'Embarcador', 'Brete', 'Outro',
]);
export const APROVEITAMENTOS = Object.freeze(['Alta', 'Média', 'Baixa']);
export const CORES_DA_PALETA = Object.freeze([
  '#f8f9fa', '#d8dee2', '#2c303e', '#0d67ad', '#61aad9', '#efcb19', '#92ca25', '#f5a01b', '#966fe1',
]);
export const COR_PADRAO = '#f8f9fa';
export const MAX_NOME = 255;
export const MAX_SIGLA = 10;

const USOS_COM_EXPLORACAO = new Set(['Pastagem', 'Agricultura']);
/** Tolerância da comparação pastejada ≤ total, em ha (arredondamento a 2 casas). */
const TOLERANCIA_HA = 0.005;

export const textoLimpo = (valor) => (typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '');

/**
 * @typedef {{campo: string, codigo: string, mensagem: string}} Pendencia
 */

/**
 * Pendências dos campos administrativos (sem setor, geometria e duplicidade,
 * que dependem do banco) e os valores normalizados que seriam gravados.
 *
 * @param {Record<string, unknown>} item
 * @param {number | null} totalHa área total já arredondada a 2 casas (null sem contorno válido)
 */
export const pendenciasDeCampos = (item, totalHa) => {
  /** @type {Pendencia[]} */
  const pendencias = [];
  const falta = (campo, mensagem) => pendencias.push({ campo, codigo: 'CAMPO_OBRIGATORIO', mensagem });
  const invalido = (campo, mensagem, codigo = 'CAMPO_INVALIDO') => pendencias.push({ campo, codigo, mensagem });

  const nome = textoLimpo(item.nome).toUpperCase();
  if (!nome) falta('nome', 'Informe o nome da área.');
  else if (nome.length > MAX_NOME) invalido('nome', `Nome com mais de ${MAX_NOME} caracteres.`);

  const sigla = textoLimpo(item.sigla).toUpperCase();
  if (sigla.length > MAX_SIGLA) invalido('sigla', `Sigla com mais de ${MAX_SIGLA} caracteres.`);

  if (!textoLimpo(item.setor_id)) falta('setor_id', 'Escolha o setor.');

  const uso = textoLimpo(item.tipo_cultura);
  if (!uso) falta('tipo_cultura', 'Escolha o tipo de uso.');
  else if (!TIPOS_USO.includes(uso)) invalido('tipo_cultura', 'Tipo de uso desconhecido.');

  const tipo = textoLimpo(item.tipo_pastagem);
  const pastejada = item.area_pastejada;
  const temPastejada = typeof pastejada === 'number' && Number.isFinite(pastejada);
  if (uso === 'Infraestrutura') {
    if (!tipo) falta('tipo_pastagem', 'Escolha o tipo de infraestrutura.');
    else if (!TIPOS_INFRAESTRUTURA.includes(tipo)) invalido('tipo_pastagem', 'Tipo de infraestrutura desconhecido.');
    if (temPastejada && pastejada !== 0) invalido('area_pastejada', 'Infraestrutura não tem área pastejada.');
  } else if (uso && TIPOS_USO.includes(uso)) {
    if (USOS_COM_EXPLORACAO.has(uso) && !tipo) falta('tipo_pastagem', 'Escolha o tipo de cultura ou pastagem.');
    if (tipo && !TIPOS_CULTURA.includes(tipo)) invalido('tipo_pastagem', 'Tipo de cultura desconhecido.');
    if (!temPastejada) falta('area_pastejada', 'Informe a área pastejada ou arável (0 é aceito).');
    else if (/** @type {number} */ (pastejada) < 0) invalido('area_pastejada', 'Área pastejada não pode ser negativa.');
    else if (totalHa !== null && /** @type {number} */ (pastejada) > totalHa + TOLERANCIA_HA) {
      invalido('area_pastejada', 'Área pastejada maior que a área total.', 'PASTEJADA_MAIOR_QUE_TOTAL');
    }
  }

  const aproveitamento = textoLimpo(item.aproveitamento_classificacao) || 'Média';
  if (!APROVEITAMENTOS.includes(aproveitamento)) invalido('aproveitamento_classificacao', 'Aproveitamento desconhecido.');
  const cor = textoLimpo(item.cor).toLowerCase() || COR_PADRAO;
  if (!CORES_DA_PALETA.includes(cor)) invalido('cor', 'Cor fora da paleta do mapa.');

  return {
    pendencias,
    valores: {
      nome,
      sigla,
      uso,
      tipo,
      pastejada: temPastejada ? /** @type {number} */ (pastejada) : null,
      aproveitamento,
      cor,
    },
  };
};
