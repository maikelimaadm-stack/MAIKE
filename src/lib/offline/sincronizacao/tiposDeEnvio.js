/**
 * Nomes dos tipos de envio do motor de sincronização (D-PROD-295/296).
 *
 * Só constantes, sem dependências: quem só LÊ a fila (o saldo do depósito, a
 * lista do cocho) usa o nome sem carregar o módulo que envia. O nome é estável:
 * já pode haver item dele guardado em celular, então nunca muda.
 */

/** Leitura de cocho (escore, acesso, estrutura). */
export const TIPO_LEITURA_COCHO = 'cocho.leitura';
/** Transferência entre locais de estoque (entrada/saída do depósito). */
export const TIPO_TRANSFERENCIA_DEPOSITO = 'deposito.transferencia';
