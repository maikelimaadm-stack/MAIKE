/**
 * D-PROD-155 — rotas da Central Única de Lançamentos e do perfil financeiro.
 *
 * Todas `onRequest: [app.autenticar]`, guarda da tela `ges-lancamentos-financeiros`
 * (cada efeito com a SUA ação), schemas FECHADOS (`additionalProperties: false`).
 *
 * Valores (dinheiro, quantidade, preço, percentual) são STRING canônica. O
 * Fastify COERGE tipos (`coerceTypes: 'array'`): `12345678901234.5678` como
 * número chegaria alterado pelo float e passaria no pattern. Por isso este
 * plugin (encapsulado: só estas rotas) tem um `preValidation` que recusa, em
 * todos os níveis, valor que não seja string e declaração que não seja booleano
 * literal — 400 `REQUEST_VALIDATION_FAILED` reason `valor_deve_ser_texto` /
 * `tipo_invalido`, com `details.campo` (caminho), `colecao` e `indice` (e, na
 * linha do rateio de um item, `subcolecao` e `subindice`).
 *
 * D-PROD-156 (rateio por item): `rateio_escopo` e `itens[].rateios` entram no
 * corpo; `rateios` do documento deixa de ser obrigatório (POR_ITEM manda vazio)
 * mas continua tipado. As recusas precisas (escopo, exclusões, item sem linha,
 * teto por item) vêm do normalizador do plano (422 `OPERACAO_RATEIO_INVALIDO`
 * com item e linha exatos) — por isso o schema só tipa o escopo como texto e o
 * teto de linhas por item da rota é o do documento inteiro.
 *
 * D-PROD-158 (editar/excluir/duplicar): GET `/:id/elegibilidade` (ver), POST
 * `/:id/retificar` (editar + confirmar; corpo = documento completo + `versao`,
 * `operation_id`, `motivo`), POST `/:id/excluir` (cancelar + excluir; corpo
 * `{empresa_id, versao, operation_id, motivo}`), `situacao` na lista e
 * `duplicado_de_id` opcional no POST de criação. Schemas fechados.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { AppError } from '../../shared/errors/AppError.js';
import { METODOS } from './financeiroCatalogo.js';
import {
  CONDICOES, CONTEUDOS, DIRECOES, MAX_ITENS, MAX_PARCELAS, MAX_RATEIOS, MAX_RATEIOS_ITENS_TOTAL, RATEIO_MODOS, TIPOS_ITEM,
} from './operacaoFinanceiraPlano.js';
import {
  LIMITE_LISTA_MAXIMO, LIMITE_LISTA_PADRAO, SITUACOES_LISTA, cancelar, confirmar, criarRascunho, descartarRascunho, detalhar, elegibilidade, estornarLiquidacao,
  excluirConfirmado, listar, previa, registrarLiquidacao, retificar, substituirRascunho,
} from './operacaoFinanceiraService.js';
import { definirPerfil, obterPerfil } from './perfilFinanceiroService.js';
import { DATA_VALIDADE, LOTES_ESCOLHIDOS, LOTE_FABRICANTE } from '../estoqueFisico/loteEscolhaSchema.js';
import {
  LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO, opcoesCentros, opcoesLocais, opcoesNaturezas, opcoesParceiros, opcoesProdutos, opcoesSaldos,
} from './operacaoFinanceiraOpcoesService.js';

// ─── tipos de campo (§5 + §8.2) ─────────────────────────────────────────────
const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]{1,64}$' };
const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]{1,64}$' };
const DINHEIRO = { type: 'string', pattern: '^\\d{1,14}(\\.\\d{1,4})?$' };
const DINHEIRO_NULO = { type: ['string', 'null'], pattern: '^\\d{1,14}(\\.\\d{1,4})?$' };
const QUANTIDADE = { type: 'string', pattern: '^\\d{1,10}(\\.\\d{1,4})?$' };
const PRECO = { type: 'string', pattern: '^\\d{1,12}(\\.\\d{1,6})?$' };
const PERCENTUAL_NULO = { type: ['string', 'null'], pattern: '^\\d{1,3}(\\.\\d{1,6})?$' };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DIA_NULO = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const OPERATION_ID = { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' };
const TEXTO_NULO = (max) => ({ type: ['string', 'null'], maxLength: max });
const ENUM = (lista) => ({ type: 'string', enum: [...lista] });
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const SO_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

const RATEIO = {
  type: 'object',
  required: ['natureza_id'],
  additionalProperties: false,
  properties: { natureza_id: ID, centro_custo_id: ID_NULO, centro_resultado_id: ID_NULO, valor: DINHEIRO_NULO, percentual: PERCENTUAL_NULO },
};
const ITEM = {
  type: 'object',
  required: ['tipo_item', 'unidade', 'quantidade', 'valor_unitario'],
  additionalProperties: false,
  properties: {
    tipo_item: ENUM(TIPOS_ITEM),
    produto_id: ID_NULO,
    local_estoque_id: ID_NULO,
    descricao: TEXTO_NULO(255),
    // D-PROD-286: KG, L, SACO, UN (serviço) ou a sigla de uma unidade de conversão do produto (conferida no serviço).
    unidade: { type: 'string', minLength: 1, maxLength: 8 },
    quantidade: QUANTIDADE,
    valor_unitario: PRECO,
    // D-PROD-156: linhas do rateio POR ITEM (mesmo formato da linha geral). O teto
    // por item (20) é do normalizador, com item e linha no erro; aqui só o do documento.
    rateios: { type: 'array', maxItems: MAX_RATEIOS_ITENS_TOTAL, items: RATEIO },
  },
};
const PARCELA = { type: 'object', required: ['vencimento', 'valor'], additionalProperties: false, properties: { vencimento: DIA, valor: DINHEIRO } };

const DOC_PROPS = {
  empresa_id: ID,
  direcao: ENUM(DIRECOES),
  conteudo: ENUM(CONTEUDOS),
  condicao: ENUM(CONDICOES),
  parceiro_id: ID,
  data_emissao: DIA,
  data_operacional: DIA_NULO,
  efeito_fisico_confirmado: { type: ['boolean', 'null'] },
  descricao: TEXTO_NULO(500),
  documento_referencia: TEXTO_NULO(64),
  metodo_preferido: { type: ['string', 'null'], enum: [...METODOS, null] },
  valor_bruto: DINHEIRO_NULO,
  valor_desconto: DINHEIRO_NULO,
  valor_acrescimo: DINHEIRO_NULO,
  itens: { type: 'array', maxItems: MAX_ITENS, items: ITEM },
  rateio_modo: ENUM(RATEIO_MODOS),
  // D-PROD-156: GERAL | POR_ITEM (ausente/null → GERAL). Só tipado: o domínio é do normalizador (422 escopo_invalido).
  rateio_escopo: { type: ['string', 'null'], maxLength: 32 },
  // Sem minItems: POR_ITEM manda vazio; GERAL sem linha → 422 rateio_geral_obrigatorio no normalizador.
  rateios: { type: 'array', maxItems: MAX_RATEIOS, items: RATEIO },
  parcelas: { type: 'array', minItems: 1, maxItems: MAX_PARCELAS, items: PARCELA },
};
const DOC_OBRIGATORIOS = ['empresa_id', 'direcao', 'conteudo', 'condicao', 'parceiro_id', 'data_emissao', 'rateio_modo', 'parcelas'];

// D-PROD-158: `duplicado_de_id` (opcional) = cópia de outro lançamento da MESMA empresa (só proveniência no AuditLog).
const CRIAR = {
  body: { type: 'object', required: [...DOC_OBRIGATORIOS, 'operation_id'], additionalProperties: false, properties: { ...DOC_PROPS, operation_id: OPERATION_ID, duplicado_de_id: ID } },
};
const SUBSTITUIR = {
  params: PARAMS,
  body: { type: 'object', required: [...DOC_OBRIGATORIOS, 'versao'], additionalProperties: false, properties: { ...DOC_PROPS, versao: { type: 'integer', minimum: 1 } } },
};
const DESCARTAR = {
  params: PARAMS,
  querystring: { type: 'object', required: ['empresa_id', 'versao'], additionalProperties: false, properties: { empresa_id: ID, versao: { type: 'integer', minimum: 1 } } },
};
const DETALHE = { params: PARAMS, querystring: SO_EMPRESA };
const PREVIA = { params: PARAMS, body: SO_EMPRESA };
const CONFIRMAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'operation_id', 'versao'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      operation_id: OPERATION_ID,
      versao: { type: 'integer', minimum: 1 },
      baixa_no_ato: {
        type: 'object',
        required: ['metodo', 'data'],
        additionalProperties: false,
        properties: { metodo: ENUM(METODOS), data: DIA, referencia: TEXTO_NULO(120) },
      },
      // D-PROD-282: por item de produto com lote — lote e validade (compra) ou lotes escolhidos (venda; sem eles, FEFO).
      lotes_por_item: {
        type: 'array', maxItems: 200,
        items: {
          type: 'object', required: ['item_ordem'], additionalProperties: false,
          properties: { item_ordem: { type: 'integer', minimum: 1 }, lote_fabricante: LOTE_FABRICANTE, data_validade: DATA_VALIDADE, lotes: LOTES_ESCOLHIDOS },
        },
      },
    },
  },
};
const CANCELAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'operation_id', 'motivo'],
    additionalProperties: false,
    properties: { empresa_id: ID, operation_id: OPERATION_ID, motivo: { type: 'string', minLength: 1, maxLength: 500 } },
  },
};
/** D-PROD-158: motivo obrigatório (até 500), conferido sem só espaços no serviço (400 `obrigatorio`). */
const MOTIVO = { type: 'string', minLength: 1, maxLength: 500 };
const RETIFICAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: [...DOC_OBRIGATORIOS, 'versao', 'operation_id', 'motivo'],
    additionalProperties: false,
    properties: { ...DOC_PROPS, versao: { type: 'integer', minimum: 1 }, operation_id: OPERATION_ID, motivo: MOTIVO },
  },
};
const EXCLUIR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'operation_id', 'motivo'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: { type: 'integer', minimum: 1 }, operation_id: OPERATION_ID, motivo: MOTIVO },
  },
};
const LIQUIDAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'operation_id', 'valor', 'data', 'metodo'],
    additionalProperties: false,
    properties: {
      empresa_id: ID, operation_id: OPERATION_ID, valor: DINHEIRO, data: DIA, metodo: ENUM(METODOS), referencia: TEXTO_NULO(120), observacao: TEXTO_NULO(500),
    },
  },
};
const ESTORNAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'operation_id', 'motivo'],
    additionalProperties: false,
    properties: { empresa_id: ID, operation_id: OPERATION_ID, motivo: { type: 'string', minLength: 1, maxLength: 500 } },
  },
};
const LISTAR = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      direcao: ENUM(DIRECOES),
      status: ENUM(['RASCUNHO', 'CONFIRMADO', 'CANCELADO']),
      conteudo: ENUM(CONTEUDOS),
      parceiro_id: ID,
      emissao_de: DIA,
      emissao_ate: DIA,
      vencimento_de: DIA,
      vencimento_ate: DIA,
      com_estoque: ENUM(['true', 'false']),
      // D-PROD-158: OPERACIONAIS (padrão) | EXCLUIDOS | TODOS.
      situacao: ENUM(SITUACOES_LISTA),
      q: { type: 'string', maxLength: 120 },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_LISTA_MAXIMO, default: LIMITE_LISTA_PADRAO },
    },
  },
};
/**
 * Cursor das opções = base64url(JSON [nome, id]) com o nome INTEIRO (até 255
 * caracteres; até 6 bytes cada no JSON) e id de até 64: no máximo 2135
 * caracteres. Com 512 o servidor emitia cursor que ele mesmo recusava
 * (rodada 2, API-3: 120 caracteres japoneses já davam 523).
 */
const CURSOR_OPCOES = { type: 'string', minLength: 1, maxLength: 2200 };
const OPCOES = (extras = {}, obrigatorios = ['empresa_id']) => ({
  querystring: {
    type: 'object',
    required: obrigatorios,
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      q: { type: 'string', maxLength: 120 },
      cursor: CURSOR_OPCOES,
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_OPCOES_MAXIMO, default: LIMITE_OPCOES_PADRAO },
      ...extras,
    },
  },
});
const OPCOES_LOCAIS = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', maxLength: 120 },
      cursor: CURSOR_OPCOES,
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_OPCOES_MAXIMO, default: LIMITE_OPCOES_PADRAO },
    },
  },
};
const SALDOS = { querystring: { type: 'object', required: ['empresa_id', 'produto_id'], additionalProperties: false, properties: { empresa_id: ID, produto_id: ID } } };
const PERFIL_LER = { querystring: SO_EMPRESA };
const PERFIL_GRAVAR = {
  body: {
    type: 'object',
    required: ['empresa_id', 'pais', 'moeda', 'locale'],
    additionalProperties: false,
    // Domínio fechado conferido no serviço (400 com reason próprio), não aqui.
    properties: { empresa_id: ID, pais: { type: 'string', maxLength: 8 }, moeda: { type: 'string', maxLength: 8 }, locale: { type: 'string', maxLength: 35 } },
  },
};

// ─── anti-coerção (preValidation, antes do AJV) ─────────────────────────────
const VALORES_TOPO = ['valor_bruto', 'valor_desconto', 'valor_acrescimo', 'valor'];
const VALORES_LINHA = Object.freeze({ itens: ['quantidade', 'valor_unitario'], rateios: ['valor', 'percentual'], parcelas: ['valor'] });
/** D-PROD-156: valores da linha do rateio de um item (`itens[i].rateios[j]`). */
const VALORES_LINHA_ITEM = Object.freeze(['valor', 'percentual']);

const recusarTipo = (field, campo, reason, extra = {}) =>
  new AppError('REQUEST_VALIDATION_FAILED', reason === 'valor_deve_ser_texto'
    ? `${field} deve ser texto canônico (ex.: "1234.56"), nunca número`
    : `${field} deve ser booleano (true/false)`, { details: { field, reason, campo, ...extra } });

const conferirValor = (obj, chave, campo, extra) => {
  if (!Object.prototype.hasOwnProperty.call(obj, chave)) return;
  const v = obj[chave];
  if (v !== null && v !== undefined && typeof v !== 'string') throw recusarTipo(chave, campo, 'valor_deve_ser_texto', extra);
};

/**
 * Recusa coerção de tipo em valores e na declaração física (todos os níveis).
 * @param {unknown} corpo
 */
export const recusarCoercaoFinanceira = (corpo) => {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return;
  const c = /** @type {Record<string, any>} */ (corpo);
  for (const chave of VALORES_TOPO) conferirValor(c, chave, chave, {});
  if (Object.prototype.hasOwnProperty.call(c, 'efeito_fisico_confirmado')) {
    const v = c.efeito_fisico_confirmado;
    if (v !== null && v !== undefined && typeof v !== 'boolean') throw recusarTipo('efeito_fisico_confirmado', 'efeito_fisico_confirmado', 'tipo_invalido');
  }
  for (const [colecao, chaves] of Object.entries(VALORES_LINHA)) {
    const linhas = c[colecao];
    if (!Array.isArray(linhas)) continue;
    linhas.forEach((linha, indice) => {
      if (!linha || typeof linha !== 'object' || Array.isArray(linha)) return;
      for (const chave of chaves) conferirValor(linha, chave, `${colecao}.${indice}.${chave}`, { colecao, indice });
    });
  }
  // D-PROD-156: a coerção também chegaria às linhas do rateio por item.
  if (!Array.isArray(c.itens)) return;
  c.itens.forEach((item, indice) => {
    const linhas = item && typeof item === 'object' && !Array.isArray(item) ? item.rateios : null;
    if (!Array.isArray(linhas)) return;
    linhas.forEach((linha, subindice) => {
      if (!linha || typeof linha !== 'object' || Array.isArray(linha)) return;
      for (const chave of VALORES_LINHA_ITEM) {
        conferirValor(linha, chave, `itens.${indice}.rateios.${subindice}.${chave}`, { colecao: 'itens', indice, subcolecao: 'rateios', subindice });
      }
    });
  });
};

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
const corpo = (request) => /** @type {any} */ (request.body);
const consulta = (request) => /** @type {any} */ (request.query);
const idDe = (request) => /** @type {any} */ (request.params).id;

/** @param {import('fastify').FastifyInstance} app */
export const registrarOperacaoFinanceiraRoutes = async (app) => {
  // Encapsulado neste plugin: vale só para as rotas financeiras.
  app.addHook('preValidation', async (request) => {
    recusarCoercaoFinanceira(request.body);
  });
  const g = GUARDAS.operacaoFinanceira;
  const p = GUARDAS.perfilFinanceiro;
  const auth = { onRequest: [app.autenticar] };

  // Perfil financeiro da empresa (onboarding).
  app.get('/perfis-financeiros-empresa', { ...auth, preHandler: [p.ver], schema: PERFIL_LER }, async (request) => obterPerfil(ctx(request), consulta(request)));
  app.put('/perfis-financeiros-empresa', { ...auth, preHandler: [p.editar], schema: PERFIL_GRAVAR }, async (request) => definirPerfil(ctx(request), corpo(request)));

  // Documento.
  app.get('/operacoes-financeiras', { ...auth, preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), consulta(request)));
  app.get('/operacoes-financeiras/:id', { ...auth, preHandler: [g.ver], schema: DETALHE }, async (request) => detalhar(ctx(request), idDe(request), consulta(request)));
  app.post('/operacoes-financeiras', { ...auth, preHandler: [g.criar], schema: CRIAR }, async (request, reply) => {
    const r = await criarRascunho(ctx(request), corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.put('/operacoes-financeiras/:id', { ...auth, preHandler: [g.editar], schema: SUBSTITUIR }, async (request) =>
    substituirRascunho(ctx(request), idDe(request), corpo(request)));
  app.delete('/operacoes-financeiras/:id', { ...auth, preHandler: [g.editar], schema: DESCARTAR }, async (request, reply) => {
    await descartarRascunho(ctx(request), idDe(request), consulta(request));
    return reply.status(204).send();
  });
  app.post('/operacoes-financeiras/:id/previa', { ...auth, preHandler: [g.ver], schema: PREVIA }, async (request) => previa(ctx(request), idDe(request), corpo(request)));
  app.post('/operacoes-financeiras/:id/confirmar', { ...auth, preHandler: [g.confirmar], schema: CONFIRMAR }, async (request) =>
    confirmar(ctx(request), idDe(request), corpo(request)));
  app.post('/operacoes-financeiras/:id/cancelar', { ...auth, preHandler: [g.cancelar], schema: CANCELAR }, async (request) =>
    cancelar(ctx(request), idDe(request), corpo(request)));
  // D-PROD-158: elegibilidade (fonte única), retificação e exclusão lógica do confirmado.
  app.get('/operacoes-financeiras/:id/elegibilidade', { ...auth, preHandler: [g.ver], schema: DETALHE }, async (request) =>
    elegibilidade(ctx(request), idDe(request), consulta(request)));
  app.post('/operacoes-financeiras/:id/retificar', { ...auth, preHandler: [g.retificar], schema: RETIFICAR }, async (request) =>
    retificar(ctx(request), idDe(request), corpo(request)));
  app.post('/operacoes-financeiras/:id/excluir', { ...auth, preHandler: [g.excluirConfirmado], schema: EXCLUIR }, async (request) =>
    excluirConfirmado(ctx(request), idDe(request), corpo(request)));

  // Títulos e liquidações (manuais, sem conciliação bancária).
  app.post('/titulos-financeiros/:id/liquidacoes', { ...auth, preHandler: [g.liquidar], schema: LIQUIDAR }, async (request, reply) => {
    const r = await registrarLiquidacao(ctx(request), idDe(request), corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.post('/liquidacoes-financeiras/:id/estorno', { ...auth, preHandler: [g.estornarLiquidacao], schema: ESTORNAR }, async (request, reply) => {
    const r = await estornarLiquidacao(ctx(request), idDe(request), corpo(request));
    return reply.status(r.status).send(r.body);
  });

  // Seletores da tela (paginados, guardados pela própria tela).
  app.get('/operacoes-financeiras-opcoes/parceiros', { ...auth, preHandler: [g.ver], schema: OPCOES({ direcao: ENUM(DIRECOES) }, ['empresa_id', 'direcao']) }, async (request) =>
    opcoesParceiros(ctx(request), consulta(request)));
  app.get('/operacoes-financeiras-opcoes/produtos', { ...auth, preHandler: [g.ver], schema: OPCOES() }, async (request) => opcoesProdutos(ctx(request), consulta(request)));
  app.get('/operacoes-financeiras-opcoes/locais', { ...auth, preHandler: [g.ver], schema: OPCOES_LOCAIS }, async (request) => opcoesLocais(ctx(request), consulta(request)));
  app.get('/operacoes-financeiras-opcoes/saldos', { ...auth, preHandler: [g.ver], schema: SALDOS }, async (request) => opcoesSaldos(ctx(request), consulta(request)));
  app.get('/operacoes-financeiras-opcoes/naturezas', { ...auth, preHandler: [g.ver], schema: OPCOES({ tipo: ENUM(['RECEITA', 'DESPESA']) }, ['empresa_id', 'tipo']) }, async (request) =>
    opcoesNaturezas(ctx(request), consulta(request)));
  app.get('/operacoes-financeiras-opcoes/centros-custo', { ...auth, preHandler: [g.ver], schema: OPCOES() }, async (request) => opcoesCentros('custo')(ctx(request), consulta(request)));
  app.get('/operacoes-financeiras-opcoes/centros-resultado', { ...auth, preHandler: [g.ver], schema: OPCOES() }, async (request) =>
    opcoesCentros('resultado')(ctx(request), consulta(request)));
};
