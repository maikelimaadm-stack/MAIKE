/**
 * Validação e sanitização de anexo.
 *
 * A P3 **não** escolhe provedor de storage. O que existe aqui é o contrato que
 * a P6 vai plugar num provider: validação de mime e tamanho no backend,
 * sanitização do nome original, e `storage_key` como identidade.
 *
 * A regra que mais importa: **URL nunca é identidade**. `storage_key` é opaca e
 * estável; URL pública é efêmera e assinada. Confundir as duas é a diferença
 * entre trocar de provedor com um `UPDATE` de configuração e ter que
 * reprocessar cada linha da tabela — preço que o MAIKE já pagou uma vez com o
 * `file_url` da Base44.
 */

import { attachmentInvalid } from '../../shared/errors/AppError.js';
import { env } from '../../config/env.js';

/** Tipos aceitos na fundação. A P6 amplia se a capacidade exigir. */
export const MIME_TYPES_PERMITIDOS = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
]);

const NOME_MAXIMO = 255;

/** Qualquer coisa que se pareça com URL não serve como identidade. */
const PARECE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Caracteres de controle, escritos por escape para o fonte seguir texto. */
const CARACTERES_DE_CONTROLE = /[\u0000-\u001F\u007F]/g;

/**
 * Sanitiza o nome original do arquivo.
 *
 * Remove diretório, caractere de controle e separador de caminho. O nome
 * original é rótulo de exibição — nunca é usado para montar caminho no disco,
 * justamente porque veio de fora.
 *
 * @param {unknown} bruto
 * @returns {string}
 */
export const sanitizarNomeOriginal = (bruto) => {
  const texto = typeof bruto === 'string' ? bruto : '';
  const semCaminho = texto.split(/[\\/]/).pop() || '';
  const limpo = semCaminho
    .replace(CARACTERES_DE_CONTROLE, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, NOME_MAXIMO);

  if (!limpo) {
    throw attachmentInvalid('nome de arquivo inválido');
  }
  return limpo;
};

/**
 * @param {unknown} mimeType
 * @returns {string}
 */
export const validarMimeType = (mimeType) => {
  const texto = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  if (!MIME_TYPES_PERMITIDOS.includes(texto)) {
    throw attachmentInvalid(`mime type não permitido: ${texto || '(vazio)'}`, {
      permitidos: MIME_TYPES_PERMITIDOS,
    });
  }
  return texto;
};

/**
 * @param {unknown} tamanho
 * @returns {number}
 */
export const validarTamanhoBytes = (tamanho) => {
  const valor = Number(tamanho);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw attachmentInvalid('tamanho_bytes deve ser inteiro positivo');
  }
  if (valor > env.anexoTamanhoMaximoBytes) {
    throw attachmentInvalid(`arquivo excede o limite de ${env.anexoTamanhoMaximoBytes} bytes`, {
      limite: env.anexoTamanhoMaximoBytes,
    });
  }
  return valor;
};

/**
 * @param {unknown} storageKey
 * @returns {string}
 */
export const validarStorageKey = (storageKey) => {
  const texto = typeof storageKey === 'string' ? storageKey.trim() : '';
  if (!texto) {
    throw attachmentInvalid('storage_key é obrigatória — ela é a identidade do anexo');
  }
  if (PARECE_URL.test(texto)) {
    throw attachmentInvalid(
      'storage_key não pode ser URL: URL de provider é efêmera e nunca identidade persistente'
    );
  }
  return texto;
};

/**
 * Monta o registro de anexo validado.
 *
 * `cliente_id` e `criado_por` vêm do contexto — não são parâmetros livres.
 *
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {object} entrada
 */
export const montarRegistroDeAnexo = (contexto, entrada) => {
  const auth = contexto?.auth;
  if (!auth?.clienteId || !auth?.usuarioId) {
    throw attachmentInvalid('anexo exige contexto autenticado');
  }

  const entidade = typeof entrada?.entidade === 'string' ? entrada.entidade.trim() : '';
  const entidadeId = typeof entrada?.entidadeId === 'string' ? entrada.entidadeId.trim() : '';
  if (!entidade || !entidadeId) {
    throw attachmentInvalid('entidade e entidade_id identificam o proprietário do anexo');
  }

  return {
    cliente_id: auth.clienteId,
    entidade,
    entidade_id: entidadeId,
    nome_original: sanitizarNomeOriginal(entrada?.nomeOriginal),
    storage_key: validarStorageKey(entrada?.storageKey),
    mime_type: validarMimeType(entrada?.mimeType),
    tamanho_bytes: validarTamanhoBytes(entrada?.tamanhoBytes),
    checksum:
      typeof entrada?.checksum === 'string' && entrada.checksum.trim()
        ? entrada.checksum.trim()
        : null,
    criado_por: auth.usuarioId,
  };
};
