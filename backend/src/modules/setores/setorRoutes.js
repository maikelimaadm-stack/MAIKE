/**
 * Rotas de Setor (P4.1, D-PROD-25).
 *
 * Três rotas. Não quatro.
 *
 * ─── Por que NÃO existe `DELETE /setores/:id` ──────────────────────────────
 *
 * A exclusão de setor é bloqueada por vínculo: área de pastagem, lançamento de
 * tarefa, movimentação do mapa e movimentação pecuária que apontem para ele —
 * por id **ou** por nome denormalizado. Nenhuma dessas quatro entidades é
 * nativa nesta fase; todas continuam na Base44.
 *
 * Um `DELETE` aqui, portanto, só poderia fazer uma de três coisas:
 *
 *   apagar sem verificar        — quebra a integridade que hoje existe;
 *   confiar numa "prova" que o  — o cliente HTTP passaria a decidir se pode
 *   frontend enviasse             apagar, o que é a definição de porta aberta;
 *   consultar a Base44 do       — proibido (`P3-TEN-BASE44`), e faria o backend
 *   backend                       nativo depender da plataforma que ele
 *                                 substitui.
 *
 * A quarta opção é não existir. Enquanto os dependentes não forem nativos, a
 * exclusão fica fechada e o frontend recusa com mensagem própria
 * (`SETOR_DELETE_UNAVAILABLE`), sem chamar o servidor. Segurança e integridade
 * prevalecem sobre paridade de funcionalidade — paridade falsa é pior que
 * função ausente, porque some com o dado.
 *
 * ─── Por que os schemas são fechados ───────────────────────────────────────
 *
 * `additionalProperties: false` mais `removeAdditional: false` (ver `app.js`)
 * fazem campo desconhecido virar 400 em vez de sumir em silêncio. É isso que
 * transforma "o cliente mandou `cliente_id`" em erro visível, e não em campo
 * apagado que ninguém registra. Vale igual para `id`, `numero_setor`,
 * `created_date` e `_isOffline`: nenhum deles é do cliente, e todos apareceriam
 * naturalmente se alguém repassasse o objeto inteiro da tela.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar } from './setorService.js';

/** Os quatro tipos do cadastro. Fechado: enum, não string livre. */
const TIPOS = ['Próprio', 'Arrendado', 'Parceria', 'Terceiros'];

/**
 * Campos de negócio do setor.
 *
 * Os limites de tamanho espelham o schema Prisma. Estarem aqui **também** não é
 * duplicação inútil: sem eles, uma string de 10 MB atravessaria a aplicação
 * inteira para ser recusada pelo PostgreSQL como erro de coluna — 500 opaco em
 * vez de 400 com causa.
 */
/**
 * `pattern: '\\S'` nos obrigatórios, além do `minLength` (P4.1-R1).
 *
 * `minLength: 1` aceita `" "`. O serviço normaliza texto com `textoOuNulo`, que
 * apara e devolve `null` para o que sobrar vazio — então `" "` chegava ao
 * Prisma como `null` numa coluna NOT NULL e virava `INTERNAL_ERROR` 500. É a
 * mesma classe de defeito que o `maxLength` daqui já evita: recusa que o banco
 * faria vira 400 com causa, na fronteira, antes da transação.
 *
 * O padrão é uma **busca**, não uma âncora: exige ao menos um caractere que não
 * seja espaço em qualquer posição. `tipo` não precisa — é enum fechado.
 */
const CAMPOS = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  sigla: { type: ['string', 'null'], maxLength: 32 },
  tipo: { type: 'string', enum: TIPOS },
  responsavel: { type: ['string', 'null'], maxLength: 255 },
  telefone: { type: ['string', 'null'], maxLength: 64 },
  endereco: { type: ['string', 'null'], maxLength: 255 },
  cidade: { type: ['string', 'null'], maxLength: 255 },
  estado: { type: ['string', 'null'], maxLength: 8 },
  area_total: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  capacidade_animais: { type: ['integer', 'null'], minimum: 0, maximum: 2147483647 },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
});

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'tipo'],
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

/**
 * O PATCH aceita o mesmo conjunto, sem obrigatórios — e sem `empresa_id`.
 *
 * Mover um setor de empresa não é edição de cadastro: mudaria a que empresa
 * pertencem, por vínculo denormalizado, todas as áreas, tarefas e movimentações
 * que o citam. Se um dia isso for necessário, é operação própria, com regra
 * própria — não um campo a mais no formulário.
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
 * O Fastify tipa `request.body` como `unknown`, e está certo: antes da
 * validação ele é mesmo qualquer coisa. Depois dela, é um objeto com as chaves
 * do schema e nenhuma outra — `additionalProperties: false` com
 * `removeAdditional: false` recusa o resto com 400. A afirmação abaixo é sobre
 * esse fato, não um `any` para calar o compilador: o service ainda filtra campo
 * a campo por lista literal.
 *
 * @param {unknown} corpo
 * @returns {Record<string, unknown>}
 */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

/** @param {import('fastify').FastifyInstance} app */
export const registrarSetorRoutes = async (app) => {
  app.get('/setores', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  app.post('/setores', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const setor = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(setor);
  });

  app.patch('/setores/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });
};
