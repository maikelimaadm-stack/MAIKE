/**
 * Serviço de MovimentacaoMapa (P5.5).
 */
import { exigirLotesDosDocumentos } from '../../shared/lotes/loteVivo.js';
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { documentoComoPublico, montarDocumento } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { movimentoExigeCancelamento, rejeitarCamposReservados } from '../../shared/operacional/protecaoOperacional.js';
import { MARCADOR_JUNCAO_LEGADO, TIPO_JUNCAO } from './juncaoConstantes.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  buscarNomesDeAreas,
  listarHistoricoPagina,
  contarHistorico,
} from './movimentacaoMapaRepository.js';
import { decodificarCursor, montarEnvelopeKeyset, normalizarLimite } from '../../shared/pagination/keysetCursor.js';

const ENTIDADE = 'MovimentacaoMapa';
const erroNaoEncontrado = () => new AppError('MOVIMENTACAOMAPA_NOT_FOUND', 'MovimentacaoMapa não encontrado');

/** Pares id → nome de área gravados no documento da movimentação. */
const CAMPOS_DE_AREA = Object.freeze([
  ['area_origem_id', 'area_origem_nome'],
  ['area_destino_id', 'area_destino_nome'],
  ['area_id', 'area_nome'],
]);

/**
 * O id da área é a fonte de verdade; o nome é cópia de leitura. O cliente
 * mandava o nome a partir de um cache local que podia não ter a área recém-
 * criada, e gravava `area_destino_nome: ""` com o id certo. Aqui o nome vem
 * do banco (mesmo tenant e empresa). Id que não resolve fica como veio: não
 * recusa histórico nem fila offline, só não inventa nome.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {Record<string, any>} documento já montado (`montarDocumento`)
 */
const comNomesDeAreaResolvidos = async (tx, clienteId, documento) => {
  const dados = documento.dados && typeof documento.dados === 'object' ? documento.dados : {};
  const ids = [
    ...new Set(
      CAMPOS_DE_AREA.map(([campoId]) => dados[campoId]).filter((id) => typeof id === 'string' && id.trim() !== '')
    ),
  ];
  if (!ids.length) return documento;
  const nomes = await buscarNomesDeAreas(tx, clienteId, documento.empresa_id, ids);
  const resolvidos = { ...dados };
  for (const [campoId, campoNome] of CAMPOS_DE_AREA) {
    const nome = nomes.get(dados[campoId]);
    if (nome) resolvidos[campoNome] = nome;
  }
  return { ...documento, dados: resolvidos };
};

const semAcento = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

/**
 * R2C-P1 (D-PROD-103): junção de lotes só pelo comando atômico. Recusa o
 * tipo novo, o legado ('Entrada' com motivo 'Junção de Lotes') e o marcador
 * de snapshot do navegador antigo. Outras entradas legítimas passam.
 * @param {unknown} entrada
 */
export const rejeitarJuncaoGenerica = (entrada) => {
  if (!entrada || typeof entrada !== 'object') return;
  const e = /** @type {Record<string, unknown>} */ (entrada);
  const ehJuncao =
    semAcento(e.tipo) === semAcento(TIPO_JUNCAO) ||
    semAcento(e.motivo) === semAcento(TIPO_JUNCAO) ||
    (typeof e.observacoes === 'string' && e.observacoes.includes(MARCADOR_JUNCAO_LEGADO));
  if (ehJuncao) {
    throw new AppError('JUNCAO_SOMENTE_POR_COMANDO', 'junção de lotes só pelo comando atômico de junção', {
      details: { comando: '/movimentacoes-mapa/comandos/juncao-lotes' },
    });
  }
};

export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarRegistros(auth.clienteId, filtros);
  return registros.map(documentoComoPublico);
};

/** Página do histórico: padrão 100, teto 200 por requisição. */
export const HISTORICO_LIMITE_PADRAO = 100;
export const HISTORICO_LIMITE_MAXIMO = 200;

const textoOuNulo = (valor) => (typeof valor === 'string' && valor.trim() ? valor.trim() : null);
const listaDeTextos = (valor) =>
  [...new Set((Array.isArray(valor) ? valor : valor == null ? [] : [valor]).map(textoOuNulo).filter(Boolean))];

/**
 * Histórico paginado (só leitura) — D-PROD-94.
 *
 * O tenant é o do token; `empresa_id` é filtro de escopo DENTRO do tenant,
 * nunca autoridade (empresa de outro tenant devolve conjunto vazio). Envelope
 * keyset com `total`, para a tela nunca afirmar completude que não tem.
 *
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} query
 */
export const listarHistorico = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const empresaId = textoOuNulo(query.empresa_id);
  if (!empresaId) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'empresa_id é obrigatório', { details: { field: 'empresa_id', reason: 'required' } });
  }
  const cursorBruto = textoOuNulo(query.cursor);
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) throw new AppError('REQUEST_VALIDATION_FAILED', 'cursor inválido');

  const filtro = {
    empresaId,
    areaId: textoOuNulo(query.area_id),
    loteIds: listaDeTextos(query.lote_ids),
    lotesNomesLegado: listaDeTextos(query.lote_nomes).map((nome) => nome.toLowerCase()),
    cursor,
    limit: normalizarLimite(query.limit, { padrao: HISTORICO_LIMITE_PADRAO, maximo: HISTORICO_LIMITE_MAXIMO }),
  };
  const [registros, total] = await Promise.all([listarHistoricoPagina(auth.clienteId, filtro), contarHistorico(auth.clienteId, filtro)]);
  return montarEnvelopeKeyset({ registros, limit: filtro.limit, total, mapItem: documentoComoPublico });
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  rejeitarCamposReservados(entrada);
  rejeitarJuncaoGenerica(entrada);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    const dados = await comNomesDeAreaResolvidos(tx, auth.clienteId, montarDocumento(auth.clienteId, entrada));
    // Lote excluído do cadastro não recebe registro novo (MAIKE-LOTES-R1).
    await exigirLotesDosDocumentos(tx, auth.clienteId, [dados.dados]);
    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: documentoComoPublico(registro) },
      tx
    );
    return registro;
  });
  return documentoComoPublico(criado);
};

export const criarEmLote = async (contexto, registros) => {
  const auth = exigirAuthContext(contexto?.auth);
  if (!Array.isArray(registros) || registros.length === 0) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'lista vazia');
  }
  registros.forEach(rejeitarCamposReservados);
  registros.forEach(rejeitarJuncaoGenerica);
  const prisma = getPrismaClient();
  const criados = await prisma.$transaction(async (tx) => {
    const saida = [];
    for (const entrada of registros) {
      const dados = await comNomesDeAreaResolvidos(tx, auth.clienteId, montarDocumento(auth.clienteId, entrada));
      // Lote excluído do cadastro não recebe registro novo (MAIKE-LOTES-R1).
      await exigirLotesDosDocumentos(tx, auth.clienteId, [dados.dados]);
      const registro = await inserirRegistro(tx, dados);
      saida.push(registro);
    }
    return saida;
  });
  return criados.map(documentoComoPublico);
};

/**
 * R2A (D-PROD-99): movimento do mapa muda saldo/posição de lote. Não se reescreve
 * por PATCH — o caminho é `POST /movimentacoes-mapa/:id/cancelamento`.
 * Outro tenant continua recebendo 404 (sem revelar existência).
 */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  void entrada;
  const existente = await buscarRegistro(auth.clienteId, id);
  if (!existente) throw erroNaoEncontrado();
  throw movimentoExigeCancelamento(ENTIDADE);
};

/** R2A (D-PROD-99): idem para DELETE — nada é removido. */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const existente = await buscarRegistro(auth.clienteId, id);
  if (!existente) throw erroNaoEncontrado();
  throw movimentoExigeCancelamento(ENTIDADE);
};

