/** API pública de Permissao (P5.4). */
import { permissaoPort } from './permissaoNativePort.js';

export const listPermissoesNativas = () => permissaoPort.list();
export const createPermissaoNativa = (dados) => permissaoPort.create(dados);
export const updatePermissaoNativa = (id, dados) => permissaoPort.update(id, dados);
export const deletePermissaoNativa = (id) => permissaoPort.delete(id);
