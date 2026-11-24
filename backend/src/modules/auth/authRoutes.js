/**
 * Rotas de autenticação.
 *
 * A rota é fina de propósito: contrato HTTP, validação de forma, chamada do
 * service, conversão do resultado. Nenhuma query Prisma, nenhuma regra.
 *
 * O schema aceita só `login`, `senha` e o opt-in `lembrar` — e `additionalProperties: false`.
 * Rejeita na porta `cliente`, `cliente_id` e qualquer outro campo: o tenant vem
 * do usuário autenticado, não do formulário (D-PROD-33).
 */

import { exigirAuthContext, lerEpocasDaSessao } from '../../shared/auth/authContext.js';
import { tenantContextRequired } from '../../shared/errors/AppError.js';
import {
  TTL_TROCA_SENHA_SEGUNDOS,
  chaveTrocaSenhaInicial,
  lerSessaoTrocaSenha,
  montarPayloadTrocaSenha,
} from '../../shared/auth/trocaSenhaInicial.js';
import { autenticar, ehAdministradorDaFazenda, montarPayloadDeSessao, ttlDaSessao } from './authService.js';
import { concluirTrocaSenhaInicial } from './trocaSenhaInicialService.js';

const LOGIN_SCHEMA = {
  body: {
    type: 'object',
    required: ['login', 'senha'],
    additionalProperties: false,
    properties: {
      login: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
      senha: { type: 'string', minLength: 1, maxLength: 512 },
      // "Manter conectado" (D-PROD-136): só muda a validade do token.
      lembrar: { type: 'boolean' },
    },
  },
};

/** D-PROD-290: só o opt-in de validade longa. Nada de identidade no corpo. */
const RENOVAR_SCHEMA = {
  body: {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: {
      lembrar: { type: 'boolean' },
    },
  },
};

/**
 * S04-P2: só a senha temporária e a nova. Nada de identidade no corpo: ela vem
 * do token restrito. `nova_senha` segue o mínimo da troca comum (8).
 */
const TROCA_SENHA_INICIAL_SCHEMA = {
  body: {
    type: 'object',
    required: ['senha_atual', 'nova_senha'],
    additionalProperties: false,
    properties: {
      senha_atual: { type: 'string', minLength: 1, maxLength: 512 },
      nova_senha: { type: 'string', minLength: 8, maxLength: 512 },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarAuthRoutes = async (app) => {
  app.post('/auth/login', { schema: LOGIN_SCHEMA }, async (request, reply) => {
    const { lembrar = false, ...credenciais } = /** @type {{ login: string, senha: string, lembrar?: boolean }} */ (request.body);
    const identidade = await autenticar(credenciais);

    // S04-P2: senha temporária do primeiro acesso. A senha conferiu, mas a
    // sessão normal NÃO nasce aqui: só um token restrito, de chave e escopo
    // próprios, que serve exclusivamente para trocar a senha.
    if (identidade.trocaSenhaPendente) {
      const tokenTroca = await reply.jwtSign(montarPayloadTrocaSenha(identidade), {
        key: chaveTrocaSenhaInicial(),
        expiresIn: TTL_TROCA_SENHA_SEGUNDOS,
      });
      return reply
        .header('Cache-Control', 'no-store')
        .status(200)
        .send({ troca_senha_obrigatoria: true, token_troca_senha: tokenTroca, expira_em_segundos: TTL_TROCA_SENHA_SEGUNDOS });
    }

    const token = await reply.jwtSign(montarPayloadDeSessao(identidade), {
      expiresIn: ttlDaSessao({ lembrar: lembrar === true }),
    });

    return reply.status(200).send({
      token,
      usuario: {
        id: identidade.usuarioId,
        login: identidade.login,
        nome: identidade.nome,
      },
      cliente_id: identidade.clienteId,
    });
  });

  // S04-P2: conclusão da troca obrigatória. Aceita SÓ o token restrito
  // (chave própria + escopo); a conta é relida no service. Nunca emite sessão.
  app.post(
    '/auth/troca-senha-inicial',
    {
      schema: TROCA_SENHA_INICIAL_SCHEMA,
      onRequest: [
        async (request) => {
          try {
            await request.jwtVerify({ key: chaveTrocaSenhaInicial(), algorithms: ['HS256'] });
          } catch (erro) {
            throw tenantContextRequired('etapa de troca de senha expirada ou inválida', { cause: erro });
          }
          request.contexto.trocaSenha = lerSessaoTrocaSenha(/** @type {any} */ (request.user));
        },
      ],
    },
    async (request, reply) => {
      const resultado = await concluirTrocaSenhaInicial(request.contexto.trocaSenha, request.body, {
        requestId: request.contexto.requestId,
      });
      return reply.header('Cache-Control', 'no-store').status(200).send(resultado);
    }
  );

  // D-PROD-290 — renovação da sessão (o app fica conectado até a pessoa sair).
  // Só com uma sessão válida AGORA: `app.autenticar` já conferiu assinatura,
  // validade, conta e cliente ativos e as épocas atuais. O token novo leva as
  // MESMAS épocas, então suspender, trocar senha ou papel continua derrubando a
  // sessão renovada. Tenant e conta vêm do token, nunca do corpo.
  app.post('/auth/renovar', { schema: RENOVAR_SCHEMA, onRequest: [app.autenticar] }, async (request, reply) => {
    const auth = exigirAuthContext(request.contexto.auth);
    const epocas = lerEpocasDaSessao(/** @type {any} */ (request.user));
    const { lembrar = false } = /** @type {{ lembrar?: boolean }} */ (request.body ?? {});
    const token = await reply.jwtSign(
      montarPayloadDeSessao({
        clienteId: auth.clienteId,
        usuarioId: auth.usuarioId,
        login: auth.login,
        clienteSessaoEpoca: epocas.cliente,
        usuarioSessaoEpoca: epocas.usuario,
      }),
      { expiresIn: ttlDaSessao({ lembrar: lembrar === true }) }
    );
    return reply.header('Cache-Control', 'no-store').status(200).send({ token });
  });

  // Devolve o contexto derivado do token. Serve de prova viva de que o tenant
  // vem da sessão: nada no corpo ou na query influencia esta resposta.
  app.get('/auth/contexto', { onRequest: [app.autenticar] }, async (request) => {
    const auth = exigirAuthContext(request.contexto.auth);
    return {
      cliente_id: auth.clienteId,
      usuario_id: auth.usuarioId,
      login: auth.login,
      // Só para o menu: relido do banco a cada chamada, nunca do token.
      administrador_fazenda: await ehAdministradorDaFazenda(auth),
      request_id: request.contexto.requestId,
    };
  });
};
