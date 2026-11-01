/**
 * Envio do comando atômico do rebanho (R2B-P1, D-PROD-101).
 *
 * Online-only: offline o envio é recusado ANTES de qualquer gravação — não há
 * fallback POST+PATCH nem fila de operações parciais.
 *
 * Pendência idempotente (padrão do cancelamento R2A): a chave e o conteúdo são
 * gravados ANTES do envio e mantidos enquanto o resultado for desconhecido
 * (rede, timeout, 5xx). Reenviar o MESMO conteúdo reaproveita a chave — o
 * servidor devolve o que já gravou, nunca grava duas vezes. Conteúdo diferente
 * com pendência aberta só segue se o usuário descartar a pendência
 * conscientemente. Escopo por tenant + usuário + tipo + área.
 */

import { registrarManejoRebanho } from '@/services/loteManejoService';

export const CODIGO_OFFLINE = 'MANEJO_REBANHO_OFFLINE';
export const CODIGO_PENDENTE = 'MANEJO_REBANHO_PENDENTE_DIVERGENTE';

/** Recusas em que o servidor respondeu e NADA foi gravado: a pendência pode sair. */
const RECUSAS_DEFINITIVAS = new Set([
  'REQUEST_VALIDATION_FAILED',
  'IDEMPOTENCY_CONFLICT',
  'EMPRESA_NOT_FOUND',
  'AREA_NOT_FOUND',
  'LOTE_NOT_FOUND',
  'MANEJO_SALDO_INSUFICIENTE',
  'MANEJO_ESTADO_INVALIDO',
  'MANEJO_CATEGORIA_MAE_INVALIDA',
  'MANEJO_CATEGORIA_INVALIDA',
  'MANEJO_CATEGORIA_AMBIGUA',
  'MANEJO_CATEGORIA_INCOMPATIVEL',
  'MANEJO_DESTINO_AMBIGUO',
]);

export const MENSAGENS_MANEJO_REBANHO = Object.freeze({
  [CODIGO_OFFLINE]: 'Sem conexão: nascimento, pesagem e mudança de categoria só podem ser registrados online. Nada foi gravado.',
  [CODIGO_PENDENTE]: 'Há um envio anterior sem confirmação. Reenvie o mesmo registro para concluir, ou confira o histórico antes de registrar outro.',
  MANEJO_SALDO_INSUFICIENTE: 'Saldo insuficiente na categoria. Nada foi gravado.',
  MANEJO_ESTADO_INVALIDO: 'Um lote não está mais como na tela (categoria, situação ou área mudaram). Recarregue o mapa. Nada foi gravado.',
  MANEJO_CATEGORIA_MAE_INVALIDA: 'Categoria da mãe inválida: é preciso lote ativo de FÊMEAS de categoria de matriz (Vaca ou Novilha) nesta área. Nada foi gravado.',
  MANEJO_CATEGORIA_INVALIDA: 'Categoria de manejo inválida para a categoria escolhida. Nada foi gravado.',
  MANEJO_CATEGORIA_AMBIGUA: 'Há mais de uma categoria de manejo para esta categoria. Escolha uma no cadastro. Nada foi gravado.',
  MANEJO_CATEGORIA_INCOMPATIVEL: 'A categoria nova não combina com o sexo do lote. Nada foi gravado.',
  MANEJO_DESTINO_AMBIGUO: 'Há mais de um lote de bezerros do mesmo sexo nesta área; não há junção automática. Ajuste os lotes antes. Nada foi gravado.',
  LOTE_NOT_FOUND: 'Um lote não está mais ativo nesta área. Recarregue o mapa. Nada foi gravado.',
  AREA_NOT_FOUND: 'Área não encontrada nesta fazenda. Nada foi gravado.',
  REQUEST_VALIDATION_FAILED: 'Dados inválidos (quantidade, peso ou data). Nada foi gravado.',
  IDEMPOTENCY_CONFLICT: 'Este envio já foi usado com outro conteúdo. Abra o formulário de novo. Nada foi gravado.',
  IDEMPOTENCY_IN_PROGRESS: 'O envio anterior ainda está sendo processado. Aguarde e tente de novo com o mesmo registro.',
});

/** Código estável do servidor (preservado no `cause` do ApiError) ou local. */
export const codigoDoErro = (erro) =>
  (typeof erro?.cause?.code === 'string' && erro.cause.code) || (typeof erro?.code === 'string' && erro.code.startsWith('MANEJO_REBANHO') ? erro.code : null);

export const mensagemDoErro = (erro) => {
  const codigo = codigoDoErro(erro);
  if (codigo && MENSAGENS_MANEJO_REBANHO[codigo]) return MENSAGENS_MANEJO_REBANHO[codigo];
  return 'Resultado desconhecido (conexão ou servidor). Confira o histórico ou reenvie o MESMO registro: ele não será duplicado.';
};

const erroLocal = (code) => Object.assign(new Error(MENSAGENS_MANEJO_REBANHO[code]), { code });

const chavePendencia = (escopo, corpo) => `maike_manejo_rebanho_pendente:${escopo}:${corpo.tipo}:${corpo.area_id}`;

const novaChave = () =>
  `rebanho-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const armazenamentoPadrao = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export const lerPendencia = (escopo, corpo, storage = armazenamentoPadrao()) => {
  try {
    const bruto = storage?.getItem(chavePendencia(escopo, corpo));
    const dados = bruto ? JSON.parse(bruto) : null;
    return dados && typeof dados.operation_id === 'string' && typeof dados.conteudo === 'string' ? dados : null;
  } catch {
    return null;
  }
};
const gravarPendencia = (escopo, corpo, dados, storage) => {
  try {
    storage?.setItem(chavePendencia(escopo, corpo), JSON.stringify({ ...dados, em: new Date().toISOString() }));
  } catch {
    /* sem storage: a chave vale só nesta tentativa */
  }
};
const limparPendencia = (escopo, corpo, storage) => {
  try {
    storage?.removeItem(chavePendencia(escopo, corpo));
  } catch {
    /* idem */
  }
};

/**
 * @param {Record<string, any>} corpo sem `operation_id`
 * @param {{ escopo: string, enviar?: (c: any) => Promise<any>, online?: () => boolean,
 *   confirmarDescarte?: (mensagem: string) => boolean, storage?: Storage|null }} opcoes
 */
export const enviarManejoRebanho = async (corpo, opcoes) => {
  const {
    escopo,
    enviar = registrarManejoRebanho,
    online = () => typeof navigator === 'undefined' || navigator.onLine !== false,
    confirmarDescarte = (mensagem) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(mensagem) : false),
    storage = armazenamentoPadrao(),
  } = opcoes;
  if (!online()) throw erroLocal(CODIGO_OFFLINE);

  const conteudo = JSON.stringify(corpo);
  let pendencia = lerPendencia(escopo, corpo, storage);
  if (pendencia && pendencia.conteudo !== conteudo) {
    const descartar = confirmarDescarte(
      'Há um envio anterior deste manejo nesta área sem confirmação do servidor. Confira o histórico antes.\n\nOK: descartar o envio anterior e registrar este.\nCancelar: manter (reenvie o mesmo registro para concluir).'
    );
    if (!descartar) throw erroLocal(CODIGO_PENDENTE);
    pendencia = null;
  }
  const operationId = pendencia?.operation_id || novaChave();
  gravarPendencia(escopo, corpo, { operation_id: operationId, conteudo }, storage);
  try {
    const resposta = await enviar({ operation_id: operationId, ...corpo });
    limparPendencia(escopo, corpo, storage);
    return resposta;
  } catch (erro) {
    if (RECUSAS_DEFINITIVAS.has(codigoDoErro(erro) ?? '')) limparPendencia(escopo, corpo, storage);
    throw erro;
  }
};
