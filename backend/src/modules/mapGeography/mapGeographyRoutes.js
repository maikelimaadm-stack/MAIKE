/**
 * Rotas de geografia do mapa (P4.3, D-PROD-32): ConfiguracaoIcone,
 * PontoReferencia e LinhaGeografica.
 */

import { SCHEMA_VERSAO_ESPERADA } from '../../shared/sincronizacao/versaoDoRegistro.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  listar as listarIcones,
  criar as criarIcone,
  atualizar as atualizarIcone,
} from './configuracaoIconeService.js';
import {
  listar as listarPontos,
  criar as criarPonto,
  atualizar as atualizarPonto,
  excluir as excluirPonto,
} from './pontoReferenciaService.js';
import {
  listar as listarLinhas,
  criar as criarLinha,
  atualizar as atualizarLinha,
} from './linhaGeograficaService.js';
import {
  apenasAdminTenant,
  porTela,
  TELAS,
  carregarAutorizacao,
  telaPermite,
  somenteCampos,
  acaoNaoPermitida,
} from '../../shared/auth/autorizacaoTela.js';
import { getPrismaClient } from '../../database/prismaClient.js';

/** Mesma tolerância do navegador (`src/domain/mapa/ligacaoPontoReferencia.js`). */
const mesmasCoordenadas = (a, b) => {
  const v = [a?.lat, a?.lng, b?.lat, b?.lng].map(Number);
  return v.every(Number.isFinite) && Math.abs(v[0] - v[2]) <= 1e-7 && Math.abs(v[1] - v[3]) <= 1e-7;
};

/**
 * PATCH de ponto de referência:
 *  - Mapa Cadastro "editar" (ou acesso total) → tudo;
 *  - Locais "editar"/"salvar" → só `{ nome }`, e só num ponto do tipo depósito
 *    que esteja nas coordenadas de um depósito (PontoSuplementacao DEPOSITO
 *    ligado a um local) da MESMA empresa, relido no tenant. É o rename do
 *    local propagado ao mapa (`localEstoqueService.propagarRename`), espelho de
 *    `renomearDeposito` no PATCH do cocho/depósito. Antes esse PATCH era 403
 *    para quem só tem Locais e os nomes ficavam divergentes.
 * @param {any} request
 */
const pontoReferenciaEditar = async (request) => {
  const aut = await carregarAutorizacao(request.contexto);
  const MC = TELAS.MAPA_CADASTRO;
  if (telaPermite(aut, MC, 'editar')) return;
  const negar = () => acaoNaoPermitida({ tela: MC.tela, acao: 'editar' });
  const podeLocais = telaPermite(aut, TELAS.LOCAIS, 'editar') || telaPermite(aut, TELAS.LOCAIS, 'salvar');
  if (!podeLocais || !somenteCampos(request.body, ['nome'])) throw negar();
  const auth = exigirAuthContext(request.contexto?.auth);
  const prisma = getPrismaClient();
  const ponto = await prisma.pontoReferencia.findFirst({
    where: { cliente_id: auth.clienteId, id: request.params?.id },
    select: { empresa_id: true, tipo: true, coordenadas: true },
  });
  const tipo = String(ponto?.tipo ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (!ponto || !tipo.includes('DEPOSITO')) throw negar();
  const depositos = await prisma.pontoSuplementacao.findMany({
    where: {
      cliente_id: auth.clienteId,
      empresa_id: ponto.empresa_id,
      categoria_ponto: { equals: 'DEPOSITO', mode: 'insensitive' },
      local_estoque_id: { not: null },
    },
    select: { coordenadas: true },
  });
  if (!depositos.some((d) => mesmasCoordenadas(d.coordenadas, ponto.coordenadas))) throw negar();
};

/** Janela em que quem criou o ponto ainda pode desfazer a criação sem "excluir". */
export const JANELA_DESFAZER_CRIACAO_MS = 15 * 60 * 1000;

/**
 * DELETE /pontos-referencia/:id.
 *  - Mapa Cadastro "excluir" (ou acesso total): exclui.
 *  - Mapa Cadastro "novo": só DESFAZ a própria criação — o ponto foi criado por
 *    este usuário há no máximo 15 minutos e ninguém o alterou depois. É a
 *    compensação do formulário quando o bebedouro/cocho do ponto novo não pôde
 *    ser gravado; sem ela, quem só pode criar deixava o ponto órfão (403).
 */
const pontoReferenciaExcluir = async (request) => {
  const aut = await carregarAutorizacao(request.contexto);
  const MC = TELAS.MAPA_CADASTRO;
  if (telaPermite(aut, MC, 'excluir')) return;
  const negar = () => acaoNaoPermitida({ tela: MC.tela, acao: 'excluir' });
  if (!telaPermite(aut, MC, 'novo')) throw negar();
  const auth = exigirAuthContext(request.contexto?.auth);
  const id = /** @type {any} */ (request.params)?.id;
  const eventos = await getPrismaClient().auditLog.findMany({
    where: { cliente_id: auth.clienteId, entidade: 'PontoReferencia', entidade_id: id },
    select: { acao: true, usuario_id: true, createdAt: true },
    take: 2,
  });
  const [criacao] = eventos;
  const desfazPropriaCriacao =
    eventos.length === 1 &&
    criacao.acao === 'create' &&
    criacao.usuario_id === auth.usuarioId &&
    Date.now() - new Date(criacao.createdAt).getTime() <= JANELA_DESFAZER_CRIACAO_MS;
  if (!desfazPropriaCriacao) throw negar();
};

const TIPOS_ENTIDADE_ICONE = [
  'Ponto',
  'Area',
  'Lote',
  'Linha',
  'Prioridade Tarefa',
  'Icone Menu Mobile',
];

const TIPOS_LINHA = ['Estrada', 'Cerca', 'Cerca Elétrica', 'Rio', 'Córrego', 'Outro'];

const PARAM_ID = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' } },
};

/** @param {unknown} corpo @returns {Record<string, unknown>} */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

/**
 * A imagem do ícone chega como data URL (`/arquivos/upload`, base64): um PNG de
 * 512 KB vira ~700 mil caracteres. Antes era 1024 e o cadastro com imagem era
 * recusado (D-PROD-79). Colunas em TEXT desde a migration 20261030100000.
 */
const TAMANHO_MAX_URL_ICONE = 1_000_000;
/** Corpo das rotas de ícone/ponto: até duas imagens (principal + subícone). */
const LIMITE_CORPO_ICONE = 3 * 1024 * 1024;

const CAMPOS_ICONE = Object.freeze({
  empresa_id: { type: ['string', 'null'], maxLength: 64 },
  tipo_entidade: { type: 'string', enum: TIPOS_ENTIDADE_ICONE },
  categoria: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  icone_url: { type: ['string', 'null'], maxLength: TAMANHO_MAX_URL_ICONE },
  sub_icone_url: { type: ['string', 'null'], maxLength: TAMANHO_MAX_URL_ICONE },
  cor_padrao: { type: ['string', 'null'], maxLength: 32 },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
  categorias_misto: { type: ['array', 'null'], items: { type: 'string' } },
  ativo: { type: 'boolean' },
});

const CRIAR_ICONE_SCHEMA = {
  body: {
    type: 'object',
    required: ['tipo_entidade', 'categoria'],
    additionalProperties: false,
    properties: { ...CAMPOS_ICONE },
  },
};

const ATUALIZAR_ICONE_SCHEMA = {
  params: PARAM_ID,
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { ...CAMPOS_ICONE },
  },
};

const CAMPOS_PONTO = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  sigla: { type: ['string', 'null'], maxLength: 32 },
  tipo: { type: 'string', minLength: 1, maxLength: 128, pattern: '\\S' },
  configuracao_icone_id: { type: ['string', 'null'], maxLength: 64 },
  icone_url: { type: ['string', 'null'], maxLength: TAMANHO_MAX_URL_ICONE },
  sub_icone_url: { type: ['string', 'null'], maxLength: TAMANHO_MAX_URL_ICONE },
  coordenadas: { type: ['object', 'null'] },
  cor: { type: ['string', 'null'], maxLength: 32 },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
});

const CAMPOS_PONTO_EDIT = Object.freeze(
  Object.fromEntries(Object.entries(CAMPOS_PONTO).filter(([c]) => c !== 'empresa_id'))
);

const CRIAR_PONTO_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'tipo'],
    additionalProperties: false,
    properties: { ...CAMPOS_PONTO },
  },
};

const ATUALIZAR_PONTO_SCHEMA = {
  params: PARAM_ID,
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    // D-PROD-344: a versão que a pessoa viu; diferente da atual → 409, nada gravado.
    properties: { ...CAMPOS_PONTO_EDIT, versao_esperada: SCHEMA_VERSAO_ESPERADA },
  },
};

const CAMPOS_LINHA = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  sigla: { type: ['string', 'null'], maxLength: 32 },
  tipo: { type: 'string', enum: TIPOS_LINHA },
  coordenadas: { type: ['object', 'null'] },
  comprimento_metros: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  cor: { type: ['string', 'null'], maxLength: 32 },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
});

const CAMPOS_LINHA_EDIT = Object.freeze(
  Object.fromEntries(Object.entries(CAMPOS_LINHA).filter(([c]) => c !== 'empresa_id'))
);

const CRIAR_LINHA_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'tipo'],
    additionalProperties: false,
    properties: { ...CAMPOS_LINHA },
  },
};

const ATUALIZAR_LINHA_SCHEMA = {
  params: PARAM_ID,
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    // D-PROD-344: a versão que a pessoa viu; diferente da atual → 409, nada gravado.
    properties: { ...CAMPOS_LINHA_EDIT, versao_esperada: SCHEMA_VERSAO_ESPERADA },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarMapGeographyRoutes = async (app) => {
  app.get('/configuracao-icones', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarIcones(request.contexto);
  });

  app.post(
    '/configuracao-icones',
    { onRequest: [app.autenticar], preHandler: [apenasAdminTenant()], bodyLimit: LIMITE_CORPO_ICONE, schema: CRIAR_ICONE_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const icone = await criarIcone(request.contexto, corpoValidado(request.body));
      return reply.status(201).send(icone);
    }
  );

  app.patch(
    '/configuracao-icones/:id',
    { onRequest: [app.autenticar], preHandler: [apenasAdminTenant()], bodyLimit: LIMITE_CORPO_ICONE, schema: ATUALIZAR_ICONE_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      return atualizarIcone(request.contexto, id, corpoValidado(request.body));
    }
  );

  app.get('/pontos-referencia', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarPontos(request.contexto);
  });

  app.post(
    '/pontos-referencia',
    { onRequest: [app.autenticar], preHandler: [porTela(TELAS.MAPA_CADASTRO, 'novo')], bodyLimit: LIMITE_CORPO_ICONE, schema: CRIAR_PONTO_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const ponto = await criarPonto(request.contexto, corpoValidado(request.body));
      return reply.status(201).send(ponto);
    }
  );

  app.patch(
    '/pontos-referencia/:id',
    { onRequest: [app.autenticar], preHandler: [pontoReferenciaEditar], bodyLimit: LIMITE_CORPO_ICONE, schema: ATUALIZAR_PONTO_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      return atualizarPonto(request.contexto, id, corpoValidado(request.body));
    }
  );

  app.delete(
    '/pontos-referencia/:id',
    { onRequest: [app.autenticar], preHandler: [pontoReferenciaExcluir], schema: { params: PARAM_ID } },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      const removido = await excluirPonto(request.contexto, id);
      return reply.status(200).send(removido);
    }
  );

  app.get('/linhas-geograficas', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarLinhas(request.contexto);
  });

  app.post(
    '/linhas-geograficas',
    { onRequest: [app.autenticar], preHandler: [porTela(TELAS.MAPA_CADASTRO, 'novo')], schema: CRIAR_LINHA_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const linha = await criarLinha(request.contexto, corpoValidado(request.body));
      return reply.status(201).send(linha);
    }
  );

  app.patch(
    '/linhas-geograficas/:id',
    { onRequest: [app.autenticar], preHandler: [porTela(TELAS.MAPA_CADASTRO, 'editar')], schema: ATUALIZAR_LINHA_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      return atualizarLinha(request.contexto, id, corpoValidado(request.body));
    }
  );
};
