import { manejoTecnicoRebanhoPort } from './manejoTecnicoRebanhoNativePort.js';
export const listManejosTecnicoRebanhoNativos = (...args) => manejoTecnicoRebanhoPort.list(...args);
