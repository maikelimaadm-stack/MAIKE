import { bebedouroSanidadePort } from './bebedouroSanidadeNativePort.js';
export const listBebedouroSanidadeNativo = (...args) => bebedouroSanidadePort.list(...args);
export const createBebedouroSanidadeNativo = (...args) => bebedouroSanidadePort.create(...args);
