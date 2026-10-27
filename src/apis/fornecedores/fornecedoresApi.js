/** API pública de Fornecedor (P5.4). */
import { fornecedorPort } from './fornecedorNativePort.js';

export const listFornecedoresNativos = (ordenacao) => fornecedorPort.list(ordenacao);
