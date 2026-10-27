/**
 * Upload nativo (P5.5) — substitui Base44 Core.UploadFile para imagens pequenas.
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { attachmentInvalid } from '../../shared/errors/AppError.js';
import { validarMimeType, validarTamanhoBytes } from '../anexos/attachmentValidation.js';

const LIMITE_DATA_URL = 5 * 1024 * 1024;

const UPLOAD_SCHEMA = {
  body: {
    type: 'object',
    required: ['conteudo_base64', 'mime_type'],
    additionalProperties: false,
    properties: {
      conteudo_base64: { type: 'string', minLength: 1 },
      mime_type: { type: 'string', minLength: 3, maxLength: 255 },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarArquivoUploadRoutes = async (app) => {
  app.post('/arquivos/upload', { onRequest: [app.autenticar], schema: UPLOAD_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { conteudo_base64, mime_type } = /** @type {{conteudo_base64: string, mime_type: string}} */ (
      request.body
    );
    const mime = validarMimeType(mime_type);
    const buffer = Buffer.from(conteudo_base64, 'base64');
    validarTamanhoBytes(buffer.length);
    if (buffer.length > LIMITE_DATA_URL) {
      throw attachmentInvalid('arquivo excede limite para upload nativo');
    }

    const file_url = `data:${mime};base64,${conteudo_base64}`;
    return reply.send({ file_url, mime_type: mime, tamanho_bytes: buffer.length });
  });
};
