import { registroAnexoPort } from './registroAnexoNativePort.js';
export const filterRegistrosAnexoNativos = (criterio) => registroAnexoPort.filter(criterio);
export const createRegistroAnexoNativo = (dados) => registroAnexoPort.create(dados);
export const deleteRegistroAnexoNativo = (id) => registroAnexoPort.delete(id);
