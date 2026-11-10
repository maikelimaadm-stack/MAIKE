/**
 * D-PROD-157 / D-PROD-161 — rotas dos bens patrimoniais (por EMPRESA), da
 * prévia de depreciação e das opções dos seletores do formulário do bem
 * (famílias, tipos, Produtos aceitos pelo tanque e os da empresa).
 *
 * Corpo e query FECHADOS (`additionalProperties: false`); tenant só da sessão
 * (`cliente_id` no corpo → 400 na barreira global); guardas da tela
 * `pat-bens-patrimoniais` (ver = visualizar; criar = novo|salvar; editar =
 * editar|salvar e, quando o corpo traz `ativo`, a ação extra `inativar`).
 * `numero`, `natureza` e `empresa_id` não se editam (fora do schema do PATCH
 * → 400; `empresa_id` é só escopo). Sem DELETE: inativação por PATCH.
 * D-PROD-161: `medicoes` e `combustivel_ids` saíram do contrato (→ 400); cada
 * tanque traz `produto_ids` (Produtos do estoque aceitos, L ou KG).
 *
 * Decimais são STRING. O Fastify COERGE tipos (`coerceTypes: 'array'`): um
 * número JSON num campo decimal viraria string já corrompida pelo float. Por
 * isso este plugin (encapsulado: só estas rotas) instala um `preValidation`
 * que recusa decimal não-string nos caminhos do A1 (400 `REQUEST_VALIDATION_FAILED`
 * reason `valor_deve_ser_texto`, `details.campo` = caminho).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import * as familias from './familiaPatrimonialService.js';
import * as tipos from './tipoPatrimonialService.js';
import { atualizar, criar, detalhar, listar, previaDepreciacao } from './bemPatrimonialService.js';
import { opcoesAreas, opcoesCentrosCusto, opcoesParceiros, opcoesProdutosParaTanque, opcoesResponsaveis } from './bemPatrimonialOpcoesService.js';
import { PADRAO_DINHEIRO, PADRAO_MEDIDA, PADRAO_PERCENTUAL } from './bemPatrimonialRegras.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO, recusarCoercaoPatrimonio } from './patrimonioComum.js';
import { MEDIDOR_TIPOS, METODOS_DEPRECIACAO, NATUREZAS, PROPRIEDADES, RESIDUAL_MODOS, UNIDADES_ABASTECIMENTO } from './patrimonioDominio.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const NOME = { type: 'string', minLength: 1, maxLength: 120 };
const TEXTO = (max) => ({ type: ['string', 'null'], maxLength: max });
const ENUM = (lista) => ({ type: 'string', enum: [...lista] });
const ENUM_NULO = (lista) => ({ type: ['string', 'null'], enum: [...lista, null] });
const VERSAO = { type: 'integer', minimum: 1 };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DIA_NULO = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DINHEIRO = { type: 'string', pattern: PADRAO_DINHEIRO.source };
const DINHEIRO_NULO = { type: ['string', 'null'], pattern: PADRAO_DINHEIRO.source };
const MEDIDA = { type: 'string', pattern: PADRAO_MEDIDA.source };
const MEDIDA_NULO = { type: ['string', 'null'], pattern: PADRAO_MEDIDA.source };
const PERCENTUAL_NULO = { type: ['string', 'null'], pattern: PADRAO_PERCENTUAL.source };
/** Ano e vida útil: a faixa de negócio é 422 no service (`BEM_CAMPO_INVALIDO`, `DEPRECIACAO_VIDA_UTIL_INVALIDA`). */
const INTEIRO_NULO = { type: ['integer', 'null'], minimum: 0, maximum: 9999 };
const VIDA_UTIL = { type: 'integer', minimum: 0, maximum: 9999 };
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };

// ─── corpo do bem ───────────────────────────────────────────────────────────

const medidor = (edicao) => ({
  type: ['object', 'null'],
  required: ['tipo'],
  additionalProperties: false,
  properties: {
    tipo: ENUM(MEDIDOR_TIPOS),
    leitura_inicial: MEDIDA_NULO,
    ...(edicao ? { leitura_atual: MEDIDA_NULO } : {}),
    data_leitura: DIA_NULO,
  },
});

/**
 * Tanques: o teto real (10 ativos; 20 Produtos aceitos por tanque, sem
 * repetição) é regra de negócio (422); o schema só barra abuso. `id`/`ativo`
 * só no PATCH. `produto_ids` é obrigatório (pode ser vazio, P-01).
 */
const tanques = (edicao) => ({
  type: 'array',
  maxItems: 30,
  items: {
    type: 'object',
    required: ['identificador', 'capacidade_litros', 'produto_ids'],
    additionalProperties: false,
    properties: {
      ...(edicao ? { id: ID, ativo: { type: 'boolean' } } : {}),
      identificador: { type: 'string', minLength: 1, maxLength: 40 },
      capacidade_litros: MEDIDA,
      produto_ids: { type: 'array', maxItems: 50, items: ID },
      observacao: TEXTO(255),
    },
  },
});

const AQUISICAO = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    data_aquisicao: DIA_NULO,
    data_disponibilidade: DIA_NULO,
    valor_aquisicao: DINHEIRO_NULO,
    custo_incorporacao: DINHEIRO_NULO,
    fornecedor_parceiro_id: ID_NULO,
    documento_referencia: TEXTO(80),
    garantia_ate: DIA_NULO,
  },
};

const DEPRECIACAO = {
  type: 'object',
  required: ['depreciavel'],
  additionalProperties: false,
  properties: {
    depreciavel: { type: 'boolean' },
    metodo: ENUM_NULO(METODOS_DEPRECIACAO),
    vida_util_meses: INTEIRO_NULO,
    residual_modo: ENUM_NULO(RESIDUAL_MODOS),
    valor_residual: DINHEIRO_NULO,
    residual_percentual: PERCENTUAL_NULO,
    data_inicio_depreciacao: DIA_NULO,
  },
};

/** Campos do bem comuns ao POST e ao PATCH (formatos; o domínio é 422 no service). */
const CAMPOS_DO_BEM = {
  nome: NOME,
  familia_id: ID,
  tipo_id: ID,
  codigo_frota: TEXTO(32),
  propriedade: ENUM(PROPRIEDADES),
  proprietario_parceiro_id: ID_NULO,
  responsavel_usuario_id: ID_NULO,
  centro_custo_id: ID_NULO,
  area_id: ID_NULO,
  localizacao_descricao: TEXTO(255),
  marca: TEXTO(80),
  modelo: TEXTO(80),
  ano_fabricacao: INTEIRO_NULO,
  ano_modelo: INTEIRO_NULO,
  numero_serie: TEXTO(40),
  chassi: TEXTO(32),
  placa: TEXTO(16),
  placa_uf: TEXTO(4),
  renavam: TEXTO(16),
  potencia_cv: MEDIDA_NULO,
  material: TEXTO(80),
  ano_conclusao: INTEIRO_NULO,
  compatibilidade: TEXTO(255),
  especificacoes: TEXTO(1000),
  observacoes: TEXTO(2000),
  aquisicao: AQUISICAO,
  depreciacao: DEPRECIACAO,
};

const CRIAR = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'familia_id', 'tipo_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, ...CAMPOS_DO_BEM, medidor: medidor(false), tanques: tanques(false) },
  },
};

const ATUALIZAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao'],
    minProperties: 3,
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      versao: VERSAO,
      ...CAMPOS_DO_BEM,
      medidor: medidor(true),
      tanques: tanques(true),
      ativo: { type: 'boolean' },
    },
  },
};

const LISTAR = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      q: { type: 'string', maxLength: 120 },
      ativo: { type: 'string', enum: ['true', 'false'] },
      familia_id: ID,
      tipo_id: ID,
      natureza: ENUM(NATUREZAS),
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};

const DETALHE = { params: PARAMS, querystring: { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } } };

const PREVIA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'valor_aquisicao', 'residual_modo', 'vida_util_meses', 'data_inicio_depreciacao'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      valor_aquisicao: DINHEIRO,
      custo_incorporacao: DINHEIRO_NULO,
      residual_modo: ENUM(RESIDUAL_MODOS),
      valor_residual: DINHEIRO_NULO,
      residual_percentual: PERCENTUAL_NULO,
      vida_util_meses: VIDA_UTIL,
      data_inicio_depreciacao: DIA,
    },
  },
};

// ─── opções (A3) ────────────────────────────────────────────────────────────

const consultaDeOpcoes = (obrigatorios, extras = {}) => ({
  querystring: {
    type: 'object',
    ...(obrigatorios.length ? { required: obrigatorios } : {}),
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      q: { type: 'string', maxLength: 120 },
      cursor: { type: 'string', minLength: 1, maxLength: 2200 },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_OPCOES_MAXIMO, default: LIMITE_OPCOES_PADRAO },
      ...extras,
    },
  },
});
/** Catálogo do tenant: `empresa_id` opcional e ignorado. */
const OPCOES_CATALOGO = consultaDeOpcoes([]);
const OPCOES_TIPOS = consultaDeOpcoes([], { familia_id: ID });
/** Dependem da empresa: `empresa_id` obrigatório. */
const OPCOES_DA_EMPRESA = consultaDeOpcoes(['empresa_id']);
/** D-PROD-161: Produtos que o tanque pode aceitar (ativos, da fazenda, L ou KG); `unidade` filtra (achado D8). */
const OPCOES_PRODUTOS = consultaDeOpcoes(['empresa_id'], { unidade: ENUM(UNIDADES_ABASTECIMENTO) });

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
const idDe = (request) => /** @type {any} */ (request.params).id;
const corpo = (request) => /** @type {any} */ (request.body);
const consulta = (request) => /** @type {any} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarBemPatrimonialRoutes = async (app) => {
  // Encapsulado neste plugin: vale só para as rotas dos bens e da prévia.
  app.addHook('preValidation', async (request) => {
    recusarCoercaoPatrimonio(request.body);
  });
  const g = GUARDAS.patrimonioBens;
  const autenticado = { onRequest: [app.autenticar] };

  app.get('/bens-patrimoniais', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), consulta(request)));
  app.get('/bens-patrimoniais/:id', { ...autenticado, preHandler: [g.ver], schema: DETALHE }, async (request) =>
    detalhar(ctx(request), idDe(request), consulta(request)));
  app.post('/bens-patrimoniais', { ...autenticado, preHandler: [g.criar], schema: CRIAR }, async (request, reply) =>
    reply.status(201).send(await criar(ctx(request), corpo(request))));
  app.patch('/bens-patrimoniais/:id', { ...autenticado, preHandler: [g.editar], schema: ATUALIZAR }, async (request) =>
    atualizar(ctx(request), idDe(request), corpo(request)));
  // Prévia: só cálculo, nada é gravado (guarda de leitura).
  app.post('/bens-patrimoniais-previa-depreciacao', { ...autenticado, preHandler: [g.ver], schema: PREVIA }, async (request) =>
    previaDepreciacao(ctx(request), corpo(request)));

  // Opções de catálogo (famílias e tipos do formulário do bem, D-PROD-161: guarda de Bens).
  const catalogo = { ...autenticado, preHandler: [g.opcoesCatalogo] };
  app.get('/bens-patrimoniais-opcoes/familias', { ...catalogo, schema: OPCOES_CATALOGO }, async (request) => familias.opcoes(ctx(request), consulta(request)));
  app.get('/bens-patrimoniais-opcoes/tipos', { ...catalogo, schema: OPCOES_TIPOS }, async (request) => tipos.opcoes(ctx(request), consulta(request)));
  // D-PROD-161: "Produtos aceitos" do tanque — quem cadastra OU edita bem (ver sozinho não lista produtos da fazenda).
  app.get('/bens-patrimoniais-opcoes/produtos', { ...autenticado, preHandler: [g.opcoesProdutos], schema: OPCOES_PRODUTOS }, async (request) =>
    opcoesProdutosParaTanque(ctx(request), consulta(request)));
  // Opções da empresa: guarda de leitura dos bens.
  const daEmpresa = { ...autenticado, preHandler: [g.ver], schema: OPCOES_DA_EMPRESA };
  app.get('/bens-patrimoniais-opcoes/responsaveis', daEmpresa, async (request) => opcoesResponsaveis(ctx(request), consulta(request)));
  app.get('/bens-patrimoniais-opcoes/parceiros', daEmpresa, async (request) => opcoesParceiros(ctx(request), consulta(request)));
  app.get('/bens-patrimoniais-opcoes/centros-custo', daEmpresa, async (request) => opcoesCentrosCusto(ctx(request), consulta(request)));
  app.get('/bens-patrimoniais-opcoes/areas', daEmpresa, async (request) => opcoesAreas(ctx(request), consulta(request)));
};
