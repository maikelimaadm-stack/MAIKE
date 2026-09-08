/**
 * Declaração dos decorators que o backend instala no Fastify.
 *
 * `app.decorate` e `app.decorateRequest` são invisíveis para o TypeScript: o
 * Fastify não tem como saber, do lado dos tipos, que este projeto acrescentou
 * `request.contexto` e `app.autenticar`. Sem esta augmentação, todo acesso a
 * eles vira `TS2339 — Property does not exist`.
 *
 * A alternativa preguiçosa seria `@ts-ignore` ou tipar `request` como `any` nos
 * pontos de uso. As duas apagariam a verificação exatamente onde ela mais
 * importa — no contexto que carrega o tenant. Declarar o contrato de verdade
 * custa este arquivo e mantém `request.contexto.auth.clienteId` verificado.
 */

import 'fastify';
import '@fastify/jwt';

/**
 * Payload da sessão — exatamente o que `montarPayloadDeSessao` assina.
 *
 * Sem esta declaração, `request.user` é `string | object | Buffer` e qualquer
 * leitura de campo vira erro de tipo. Declarar aqui não substitui a validação:
 * `construirAuthContext` continua conferindo os campos em runtime, porque um
 * token pode ser antigo, truncado ou emitido por outra versão do backend.
 */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { cliente_id: string; usuario_id: string; login: string };
    user: { cliente_id: string; usuario_id: string; login: string };
  }
}

declare module 'fastify' {
  interface AuthContext {
    /** Tenant autenticado. Vem do token verificado, nunca da requisição. */
    readonly clienteId: string;
    /** Ator autenticado. */
    readonly usuarioId: string;
    readonly login: string;
  }

  interface RequestContexto {
    /** Correlation id da requisição; obrigatório no AuditLog. */
    requestId: string;
    /** Nulo até a rota exigir autenticação. */
    auth: AuthContext | null;
  }

  interface FastifyRequest {
    contexto: RequestContexto;
  }

  interface FastifyInstance {
    /** Verifica o token e instala o `auth_context` em `request.contexto`. */
    autenticar: (request: FastifyRequest) => Promise<void>;
  }
}
