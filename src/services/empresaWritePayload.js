/**
 * Campos graváveis de Empresa — espelham o schema Fastify (P5.4).
 * Metadados de leitura (`id`, `created_date`, …) nunca vão no corpo de escrita.
 */

export const EMPRESA_CAMPOS_GRAVAVEIS = Object.freeze([
  'apelido',
  'nome',
  'tipo_pessoa',
  'cpf',
  'rg',
  'cnpj',
  'inscricao_estadual',
  'telefone',
  'email',
  'endereco',
  'cidade',
  'estado',
  'cep',
  'logotipo_url',
  'observacoes',
]);

const OPCIONAIS_STRING = new Set([
  'cpf',
  'rg',
  'cnpj',
  'inscricao_estadual',
  'telefone',
  'email',
  'endereco',
  'cidade',
  'estado',
  'cep',
  'logotipo_url',
  'observacoes',
]);

/**
 * D-PROD-122: o fuso IANA da fazenda só vai no corpo da CRIAÇÃO. Depois, muda
 * apenas pela rota administrativa `PUT /empresas/:id/fuso-horario` (o PATCH
 * genérico recusa o campo).
 * @param {Record<string, unknown>} bruto
 * @param {{criacao?: boolean}} [opcoes]
 * @returns {Record<string, unknown>}
 */
export const projetarPayloadEmpresa = (bruto, { criacao = false } = {}) => {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const campo of EMPRESA_CAMPOS_GRAVAVEIS) {
    if (!(campo in bruto)) continue;
    let valor = bruto[campo];
    if (OPCIONAIS_STRING.has(campo) && (valor === '' || valor === undefined)) {
      valor = null;
    }
    saida[campo] = valor;
  }
  if (criacao && typeof bruto.fuso_horario === 'string' && bruto.fuso_horario.trim()) {
    saida.fuso_horario = bruto.fuso_horario.trim();
  }
  return saida;
};
