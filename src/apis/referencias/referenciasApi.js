import { sincronizarReferenciasNativas } from './referenciasNativePort.js';
export const sincronizarReferencias = (payload) => sincronizarReferenciasNativas(payload);
