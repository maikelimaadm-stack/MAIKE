/**
 * Service de Anexos de registro (P1.3, D-PROD-18).
 *
 * `RegistroAnexo` é genérica no provider: tem `entity_name` livre. Hoje o único
 * consumidor migrado é o Lote, e deixar a superfície aberta criaria um caminho
 * sem dono para as slices seguintes — qualquer tela poderia anexar em qualquer
 * entidade sem que ninguém tivesse migrado a leitura correspondente.
 *
 * A validação fica aqui, no service, porque é conhecimento de domínio: a API
 * não sabe quais entidades o produto já suporta.
 */

import { filterAnexos, createAnexo, deleteAnexo } from '@/apis/anexos';
import { uploadArquivo } from '@/apis/arquivos';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

/** Entidades com suporte real a anexo nesta slice. */
export const ENTIDADES_COM_ANEXO = Object.freeze(['Lote']);

const assertEntidadeSuportada = (entityName, operation) => {
  if (!ENTIDADES_COM_ANEXO.includes(entityName)) {
    throw new ApiError(API_ERROR_CODES.ANEXO_ENTITY_UNSUPPORTED, {
      operation,
      resource: 'RegistroAnexo',
      details: { entidade: typeof entityName === 'string' ? entityName : null },
    });
  }
};

/**
 * Anexos de um registro, do mais novo para o mais antigo.
 *
 * Sem `recordId` devolve lista vazia **sem** consultar: é o estado de um lote
 * ainda não criado, com anexos pendentes só no cliente.
 *
 * @returns {Promise<any[]>}
 */
export const listarAnexos = async ({ entityName, recordId }) => {
  assertEntidadeSuportada(entityName, 'listarAnexos');
  if (!recordId) return [];
  return filterAnexos({ entity_name: entityName, record_id: recordId });
};

/**
 * Envia o arquivo e cria o registro do anexo.
 *
 * O upload vem antes: sem URL não há registro a criar. Se o upload falhar, nada
 * é persistido — não existe anexo órfão apontando para lugar nenhum.
 *
 * Nenhum valor de URL, payload ou conteúdo de arquivo é registrado em log.
 */
export const anexarArquivo = async ({ entityName, recordId, arquivo, nome }) => {
  const contexto = { operation: 'anexarArquivo', resource: 'RegistroAnexo' };
  assertEntidadeSuportada(entityName, contexto.operation);

  const attachmentName = String(nome || arquivo?.name || '').trim();
  if (!attachmentName) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, { ...contexto, details: { argumento: 'nome' } });
  }
  if (!recordId) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, { ...contexto, details: { argumento: 'recordId' } });
  }

  const enviado = await uploadArquivo(arquivo);

  return createAnexo({
    entity_name: entityName,
    record_id: recordId,
    attachment_name: attachmentName,
    file_url: enviado?.file_url,
    file_name: arquivo?.name || attachmentName,
    file_size: arquivo?.size ?? null,
    file_type: arquivo?.type || null,
  });
};

/**
 * Persiste anexos que ficaram pendentes enquanto o registro não existia.
 *
 * O fluxo do cadastro de lote permite escolher arquivos **antes** de salvar; só
 * depois da criação existe `recordId` para vinculá-los.
 *
 * @returns {Promise<{criados: object[]}>}
 */
export const persistirAnexosPendentes = async ({ entityName, recordId, pendentes }) => {
  assertEntidadeSuportada(entityName, 'persistirAnexosPendentes');
  const lista = Array.isArray(pendentes) ? pendentes : [];
  const criados = [];
  for (const pendente of lista) {
    criados.push(
      await anexarArquivo({
        entityName,
        recordId,
        arquivo: pendente.arquivo ?? pendente.file,
        nome: pendente.nome ?? pendente.attachment_name,
      })
    );
  }
  return { criados };
};

export const excluirAnexo = async (id) => deleteAnexo(id);
