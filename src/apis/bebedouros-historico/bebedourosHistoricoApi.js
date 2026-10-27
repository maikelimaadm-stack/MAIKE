import { bebedouroHistoricoPort } from './bebedouroHistoricoNativePort.js';
export const listBebedouroHistoricoNativo = (...args) => bebedouroHistoricoPort.list(...args);
export const createBebedouroHistoricoNativo = (...args) => bebedouroHistoricoPort.create(...args);
export const deleteBebedouroHistoricoNativo = (...args) => bebedouroHistoricoPort.delete(...args);
