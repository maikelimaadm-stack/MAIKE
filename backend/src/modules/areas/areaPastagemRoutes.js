/**
 * Rotas de AreaPastagem (P4.2, D-PROD-30).
 *
 * Três rotas, como em Setor. Não quatro.
 *
 * ─── Por que NÃO existe `DELETE /areas-pastagem/:id` ───────────────────────
 *
 * Porque exclusão de área **nunca foi** exclusão, nem no legado: `excluirArea`
 * em `src/services/mapaService.js` consulta a guarda de vínculo e, quando ela
 * libera, chama `updateArea(id, { ativo: false })`. É baixa lógica, e continua
 * sendo — pelo caminho que já existe, o PATCH.
 *
 * Criar um `DELETE` que faz `UPDATE ativo = false` seria pior que redundante:
 * daria ao verbo HTTP um significado que ele não tem, e o dia em que alguém
 * quisesse apagar de verdade encontraria uma rota com o nome certo e o
 * comportamento errado.
 *
 * A guarda de vínculo continua no frontend nesta fatia, e continua consultando
 * a Base44 para `Lote`, `LancamentoTarefa` e `MovimentacaoPecuaria`. Trazê-la
 * para cá exigiria que o backend enxergasse entidades que ainda não são dele.
 *
 * ─── Por que os schemas são fechados ───────────────────────────────────────
 *
 * `additionalProperties: false` mais `removeAdditional: false` fazem campo
 * desconhecido virar 400 em vez de sumir em silêncio. Aqui isso protege quatro
 * campos que o servidor atribui e o cliente não pode mandar: `id`,
 * `cliente_id`, `numero_area` e `setor_nome`.
 *
 * `setor_nome` é o mais importante dos quatro. Ele aparece naturalmente em
 * qualquer objeto vindo da tela — o formulário do mapa o carrega para desenhar
 * o rótulo — e aceitar o valor enviado seria reabrir exatamente a divergência
 * que esta missão fecha. Recusar com 400 é o que garante que a única origem
 * possível do campo seja o setor lido no servidor.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar } from './areaPastagemService.js';

/** Enums fechados do cadastro, herdados de `base44/entities/AreaPastagem.jsonc`. */
const CLASSIFICACOES = ['Alta', 'Média', 'Baixa'];
const CULTURAS = ['Pastagem', 'Agricultura', 'Reserva', 'APP', 'Infraestrutura'];
const OCUPACOES = ['Disponível', 'Médio', 'Alto', 'Sobrepastoreado'];
const ESTACOES = ['Seco', 'Intermediário', 'Chuvoso'];

/**
 * Campos de negócio da área.
 *
 * Os limites espelham o schema Prisma. Estarem aqui **também** não é duplicação
 * inútil: sem eles, uma string de 10 MB atravessaria a aplicação inteira para
 * ser recusada pelo PostgreSQL como erro de coluna — 500 opaco em vez de 400
 * com causa.
 *
 * `pattern: '\\S'` nos obrigatórios de texto, além do `minLength`, pela mesma
 * razão da P4.1-R1: `minLength: 1` aceita `" "`, que o serviço normaliza para
 * `null` e o Prisma recusa numa coluna NOT NULL — 500 em vez de 400.
 */
const CAMPOS = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  setor_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  sigla: { type: ['string', 'null'], maxLength: 32 },
  tamanho_hectares: { type: 'number', minimum: 0, maximum: 99999999.9999 },
  area_pastejada: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  capacidade_maxima: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  tipo_pastagem: { type: ['string', 'null'], maxLength: 128 },
  aproveitamento_classificacao: { type: 'string', enum: CLASSIFICACOES },
  tipo_cultura: { type: 'string', enum: CULTURAS },
  cor: { type: ['string', 'null'], maxLength: 32 },
  quantidade_atual: { type: 'integer', minimum: 0, maximum: 2147483647 },
  status_ocupacao: { type: 'string', enum: OCUPACOES },
  forragem_kg_ha: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  taxa_crescimento_kg_ha_dia: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  // Percentual, 0 a 100 — não 0 a 1. É como o legado grava e como a tela exibe.
  taxa_aproveitamento: { type: ['number', 'null'], minimum: 0, maximum: 100 },
  periodo_estacao: { type: ['string', 'null'], enum: [...ESTACOES, null] },
  // O polígono do mapa. `additionalProperties: true` aqui é deliberado: a forma
  // do desenho pertence ao consumidor de mapa, e travá-la neste schema
  // transformaria cada campo novo do desenho numa migration de backend.
  coordenadas: { type: ['object', 'null'] },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
});

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'setor_id', 'nome', 'tamanho_hectares'],
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

/**
 * O PATCH aceita o mesmo conjunto, sem obrigatórios — e sem `empresa_id`.
 *
 * Mesma regra de Setor: mover uma área de empresa mudaria o vínculo de tudo que
 * a cita, e isso é operação própria, não campo de formulário. `setor_id`
 * **continua** editável: mover área entre setores é operação de mapa
 * corriqueira, e o servidor rederiva `setor_nome` quando acontece.
 */
const CAMPOS_EDITAVEIS = Object.freeze(
  Object.fromEntries(Object.entries(CAMPOS).filter(([campo]) => campo !== 'empresa_id'))
);

const ATUALIZAR_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { ...CAMPOS_EDITAVEIS },
  },
};

/**
 * O corpo já passou pelo schema quando chega aqui.
 *
 * A afirmação é sobre esse fato, não um `any` para calar o compilador: o
 * service ainda filtra campo a campo por lista literal.
 *
 * @param {unknown} corpo
 * @returns {Record<string, unknown>}
 */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAreaPastagemRoutes = async (app) => {
  app.get('/areas-pastagem', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  app.post(
    '/areas-pastagem',
    { onRequest: [app.autenticar], schema: CRIAR_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const area = await criar(request.contexto, corpoValidado(request.body));
      return reply.status(201).send(area);
    }
  );

  app.patch(
    '/areas-pastagem/:id',
    { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      return atualizar(request.contexto, id, corpoValidado(request.body));
    }
  );
};
