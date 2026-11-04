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

import { registrarManejoRebanho, registrarJuncaoLotes, registrarBaixaRebanho, registrarTransferenciaLedger } from '@/services/loteManejoService';
import { confirmar } from '@/lib/maikeConfirmar';

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
  'JUNCAO_LOTE_INELEGIVEL',
  'JUNCAO_CLASSIFICACAO_DIVERGENTE',
  'JUNCAO_DATA_RETROATIVA',
  'BAIXA_SALDO_INSUFICIENTE',
  'BAIXA_CLASSIFICACAO_DIVERGENTE',
  'BAIXA_DATA_RETROATIVA',
  'REBANHO_SALDO_HISTORICO_NEGATIVO',
  'REBANHO_PESO_DEPENDENCIA_CAUSAL',
  'REBANHO_DEPENDENCIA_FATO_SEM_SALDO',
  'LOTE_CADASTRO_SOMENTE_ENTRADAS',
  'REBANHO_LEDGER_SOMENTE_POR_COMANDO',
  'IDEMPOTENCY_EFEITO_DESFEITO',
  'REBANHO_ANTES_DO_CORTE',
  'REBANHO_DESTINO_IGUAL_ORIGEM',
  'REBANHO_AREA_INATIVA',
  'REBANHO_LEDGER_INATIVO',
  'POSICAO_REBANHO_NOT_FOUND',
  'REBANHO_CUTOVER_PENDENTE',
]);

export const MENSAGENS_MANEJO_REBANHO = Object.freeze({
  [CODIGO_OFFLINE]: 'Sem conexão: este manejo (nascimento, pesagem, mudança de categoria, junção, morte ou abate) só pode ser registrado online. Nada foi gravado.',
  [CODIGO_PENDENTE]: 'Há um envio anterior sem confirmação. Reenvie o mesmo registro para concluir, ou confira o histórico antes de registrar outro.',
  MANEJO_SALDO_INSUFICIENTE: 'Saldo insuficiente na categoria. Nada foi gravado.',
  MANEJO_ESTADO_INVALIDO: 'Um lote não está mais como na tela (categoria, situação ou área mudaram). Recarregue o mapa. Nada foi gravado.',
  MANEJO_CATEGORIA_MAE_INVALIDA: 'Categoria da mãe inválida: é preciso lote ativo de FÊMEAS de categoria de matriz (Vaca ou Novilha) nesta área. Nada foi gravado.',
  MANEJO_CATEGORIA_INVALIDA: 'Categoria de manejo inválida para a categoria escolhida. Nada foi gravado.',
  MANEJO_CATEGORIA_AMBIGUA: 'Há mais de uma categoria de manejo para esta categoria. Escolha uma no cadastro. Nada foi gravado.',
  MANEJO_CATEGORIA_INCOMPATIVEL: 'A categoria nova não combina com o sexo do lote. Nada foi gravado.',
  MANEJO_DESTINO_AMBIGUO: 'Há mais de um lote de bezerros do mesmo sexo nesta área; não há junção automática. Ajuste os lotes antes. Nada foi gravado.',
  JUNCAO_LOTE_INELEGIVEL: 'Um dos lotes não está mais ativo nesta área (ou está sem cabeças). Recarregue o mapa. Nada foi gravado.',
  JUNCAO_CLASSIFICACAO_DIVERGENTE: 'Os lotes não têm a mesma categoria, sexo ou categoria de manejo (ou falta o sexo). Não é possível juntar. Nada foi gravado.',
  JUNCAO_DATA_RETROATIVA: 'Há registro posterior à data escolhida num dos lotes. Use uma data igual ou posterior. Nada foi gravado.',
  BAIXA_SALDO_INSUFICIENTE: 'A categoria não tem cabeças suficientes nos lotes ativos desta área. Recarregue o mapa. Nada foi baixado.',
  BAIXA_CLASSIFICACAO_DIVERGENTE: 'Há lote desta categoria com sexo incompatível. Corrija o cadastro do lote antes. Nada foi baixado.',
  BAIXA_DATA_RETROATIVA: 'Há registro posterior à data escolhida num dos lotes. Use uma data igual ou posterior. Nada foi baixado.',
  REBANHO_SALDO_HISTORICO_NEGATIVO: 'A transferência deixaria saldo negativo numa data. Nada foi gravado.',
  REBANHO_ANTES_DO_CORTE: 'A data é anterior ao início do controle por posições nesta fazenda. Nada foi gravado.',
  REBANHO_DESTINO_IGUAL_ORIGEM: 'A área de destino é a mesma da origem. Nada foi gravado.',
  REBANHO_AREA_INATIVA: 'A área de destino está inativa. Nada foi gravado.',
  REBANHO_LEDGER_INATIVO: 'O controle por posições não está ativo nesta fazenda. Recarregue o mapa. Nada foi gravado.',
  REBANHO_LEDGER_OPERACAO_NAO_MIGRADA: 'Esta operação ainda não foi migrada para o controle por posições. Nada foi gravado.',
  REBANHO_CUTOVER_PENDENTE: 'Esta fazenda ainda não foi migrada para o controle por posições. O administrador precisa concluir a migração; nada foi gravado.',
  POSICAO_REBANHO_NOT_FOUND: 'Uma posição não está mais nesta área. Recarregue o mapa. Nada foi gravado.',
  LOTE_NOT_FOUND: 'Um lote não está mais ativo nesta área. Recarregue o mapa. Nada foi gravado.',
  AREA_NOT_FOUND: 'Área não encontrada nesta fazenda. Nada foi gravado.',
  REQUEST_VALIDATION_FAILED: 'Dados inválidos (quantidade, peso ou data). Nada foi gravado.',
  IDEMPOTENCY_CONFLICT: 'Este envio já foi usado com outro conteúdo. Abra o formulário de novo. Nada foi gravado.',
  IDEMPOTENCY_IN_PROGRESS: 'O envio anterior ainda está sendo processado. Aguarde e tente de novo com o mesmo registro.',
  LOTE_CADASTRO_SOMENTE_ENTRADAS: 'O cadastro de lotes guarda só entradas: esta operação criaria um lote derivado. Nesta fazenda o controle por posições ainda não está ativo — peça ao administrador para ativá-lo. Nada foi gravado.',
  REBANHO_DEPENDENCIA_FATO_SEM_SALDO: 'Uma pesagem ou nascimento posterior ficaria sem cabeças (ou sem as matrizes) na data dele. Cancele-o antes. Nada foi gravado.',
  REBANHO_PESO_DEPENDENCIA_CAUSAL: 'Um registro posterior calculou o peso com o valor que este manejo mudaria. Cancele o posterior antes. Nada foi gravado.',
  REBANHO_LEDGER_SOMENTE_POR_COMANDO: 'Nesta fazenda o rebanho é controlado por posições: use o manejo do mapa. Nada foi gravado.',
  IDEMPOTENCY_EFEITO_DESFEITO: 'Este envio foi desfeito por um reset de dados de teste. Abra o formulário de novo. Nada foi gravado.',
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

/** Pendência por tenant + usuário (escopo), tipo, empresa e área. */
const chavePendencia = (escopo, corpo) =>
  `maike_manejo_rebanho_pendente:${escopo}:${corpo.tipo || TIPO_JUNCAO_CHAVE}:${corpo.empresa_id}:${corpo.area_id}`;
const TIPO_JUNCAO_CHAVE = 'Junção de Lotes';

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
 *   confirmarDescarte?: (mensagem: string) => boolean | Promise<boolean>, storage?: Storage|null }} opcoes
 */
export const enviarManejoRebanho = async (corpo, opcoes) => {
  const {
    escopo,
    enviar = registrarManejoRebanho,
    online = () => typeof navigator === 'undefined' || navigator.onLine !== false,
    confirmarDescarte = (mensagem) => confirmar({ titulo: 'Envio anterior sem confirmação', descricao: mensagem, textoConfirmar: 'Descartar e registrar', textoCancelar: 'Manter', perigo: true }),
    storage = armazenamentoPadrao(),
  } = opcoes;
  if (!online()) throw erroLocal(CODIGO_OFFLINE);

  const conteudo = JSON.stringify(corpo);
  let pendencia = lerPendencia(escopo, corpo, storage);
  if (pendencia && pendencia.conteudo !== conteudo) {
    const descartar = await confirmarDescarte(
      'Há um envio anterior deste manejo nesta área sem confirmação do servidor. Confira o histórico antes.\n\nDescartar e registrar: descarta o envio anterior e registra este.\nManter: reenvie o mesmo registro para concluir.'
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

/**
 * Junção de Lotes (R2C-P1, D-PROD-104): mesmo envio online-only com pendência
 * idempotente; o corpo só tem ids, data e observação.
 * @param {Record<string, any>} corpo
 * @param {{ escopo: string, enviar?: (c: any) => Promise<any>, online?: () => boolean, confirmarDescarte?: (m: string) => boolean | Promise<boolean>, storage?: Storage|null }} opcoes
 */
export const enviarJuncaoLotes = (corpo, opcoes) => enviarManejoRebanho(corpo, { enviar: registrarJuncaoLotes, ...opcoes });

/**
 * Baixa multi-lote — Morte/Abate (R2D-P1, D-PROD-105): mesmo envio online-only
 * com pendência idempotente (tenant + usuário + tipo + empresa + área). Uma
 * confirmação do formulário = UM POST; o servidor escolhe os lotes.
 * @param {Record<string, any>} corpo
 * @param {{ escopo: string, enviar?: (c: any) => Promise<any>, online?: () => boolean, confirmarDescarte?: (m: string) => boolean | Promise<boolean>, storage?: Storage|null }} opcoes
 */
/**
 * R2E-P1 (D-PROD-107): mensagem com o veredito do servidor (data, área,
 * disponível e pedido) quando a linha do tempo recusa a transferência.
 */
export const mensagemDaTransferenciaLedger = (erro) => {
  // O cliente nativo mescla os `details` do servidor em `erro.details` (nativeHttpClient.detalhesSeguros).
  const d = erro?.details ?? erro?.cause?.details ?? null;
  if (codigoDoErro(erro) === 'REBANHO_SALDO_HISTORICO_NEGATIVO' && d?.data) {
    const dia = String(d.data).split('-').reverse().join('/');
    const qtd = d.disponivel !== null && d.disponivel !== undefined ? ` Disponível na data: ${d.disponivel} cab; pedido: ${d.pedido} cab.` : ` Saldo resultante: ${d.saldo_resultante} cab.`;
    return `Saldo insuficiente em ${d.area_nome ?? 'uma área'} no dia ${dia}.${qtd} Nada foi gravado.`;
  }
  if (codigoDoErro(erro) === 'REBANHO_DEPENDENCIA_FATO_SEM_SALDO' && d?.data) {
    const dia = String(d.data).split('-').reverse().join('/');
    return d.tipo === 'NASCIMENTO'
      ? `O nascimento do dia ${dia} ficaria sem as matrizes registradas nele. Cancele-o antes. Nada foi gravado.`
      : `A pesagem do dia ${dia} ficaria numa posição sem cabeças. Cancele-a antes. Nada foi gravado.`;
  }
  if (codigoDoErro(erro) === 'REBANHO_PESO_DEPENDENCIA_CAUSAL' && d?.data) {
    const dia = String(d.data).split('-').reverse().join('/');
    return `O registro do dia ${dia} calculou o peso com o valor que este manejo mudaria. Cancele-o antes. Nada foi gravado.`;
  }
  return mensagemDoErro(erro);
};

/**
 * Transferência no ledger: online-only e com pendência idempotente (mesmo
 * padrão dos outros comandos). `tipo`/`area_id` só compõem a chave local da
 * pendência — não vão no corpo (o servidor recusa campo desconhecido).
 * @param {Record<string, any>} corpo
 * @param {{ escopo: string, online?: () => boolean, confirmarDescarte?: (m: string) => boolean | Promise<boolean>, storage?: Storage|null, enviar?: (c: any) => Promise<any> }} opcoes
 */
export const enviarTransferenciaLedger = (corpo, opcoes) =>
  enviarManejoRebanho(
    { tipo: 'TRANSFERENCIA_LEDGER', area_id: corpo.area_destino_id, ...corpo },
    {
      ...opcoes,
      enviar: ({ tipo: _t, area_id: _a, ...limpo }) => (opcoes.enviar ?? registrarTransferenciaLedger)(limpo),
    }
  );

export const enviarBaixaRebanho = (corpo, opcoes) => enviarManejoRebanho(corpo, { enviar: registrarBaixaRebanho, ...opcoes });
