/**
 * Upload de arquivo compartilhado (P1.4).
 *
 * Três telas subiam arquivo chamando a integração de upload do SDK
 * diretamente: o logotipo da empresa e os dois campos de imagem do gerenciador
 * de ícones. Nenhuma delas precisa saber o nome da integração.
 *
 * A leitura do `File` continua na UI — é o usuário quem escolhe o arquivo, e o
 * `input[type=file]` é elemento de tela. O que sai daqui é a URL persistida.
 */

import { uploadArquivo } from '@/apis/arquivos';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

/**
 * Envia o arquivo e devolve a URL pública.
 *
 * @param {File|Blob} arquivo
 * @returns {Promise<string>}
 */
export const enviarArquivo = async (arquivo) => {
  const contexto = { operation: 'enviarArquivo', resource: 'Arquivo' };
  if (!arquivo) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, { ...contexto, details: { campo: 'arquivo' } });
  }

  const resultado = await uploadArquivo({ file: arquivo });
  const url = resultado?.file_url;

  if (typeof url !== 'string' || !url) {
    // Upload sem URL é falha, mesmo com HTTP 200: a tela gravaria `undefined`
    // no campo e o registro ficaria apontando para lugar nenhum.
    throw new ApiError(API_ERROR_CODES.OPERATION_FAILED, { ...contexto, details: { motivo: 'sem_file_url' } });
  }

  return url;
};
