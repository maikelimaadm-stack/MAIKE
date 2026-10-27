import { eventoSanitarioPort } from './eventoSanitarioNativePort.js';
export const listEventosSanitariosNativos = (...args) => eventoSanitarioPort.list(...args);
