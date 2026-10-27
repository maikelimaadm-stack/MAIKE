import { aplicacaoMedicamentoPort } from './aplicacaoMedicamentoNativePort.js';
export const listAplicacoesMedicamentoNativas = (...args) => aplicacaoMedicamentoPort.list(...args);
