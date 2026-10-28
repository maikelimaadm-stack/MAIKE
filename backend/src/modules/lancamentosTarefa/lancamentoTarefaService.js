/**
 * Serviço de LancamentoTarefa e histórico (P5.3, D-PROD-49).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import {
  attachmentOwnerInvalid,
  areaNotFound,
  loteNotFound,
  tipoTarefaNotFound,
} from '../../shared/errors/AppError.js';
import { buscarTipo } from '../tiposTarefa/tipoTarefaRepository.js';
import { buscarLote } from '../lotes/loteRepository.js';
import { buscarArea } from '../areas/areaPastagemRepository.js';
import {
  listarLancamentos,
  buscarLancamento,
  inserirLancamento,
  atualizarLancamentoPorId,
  excluirLancamentoPorId,
} from './lancamentoTarefaRepository.js';
import {
  listarHistoricos,
  buscarHistorico,
  inserirHistorico,
  excluirHistoricoPorId,
} from './historicoLancamentoTarefaRepository.js';

const TIPOS_BASE = ['Manejo', 'Suplementação', 'Manutenção', 'Verificação', 'Sanitário', 'Outro'];
const PRIORIDADES = ['Baixa', 'Média', 'Alta'];
const STATUS = ['Pendente', 'Em Andamento', 'Concluída', 'Cancelada'];
const EVENTOS = [
  'Criação',
  'Edição',
  'Mudança de Local',
  'Mudança de Status',
  'Registro',
  'Conclusão',
  'Cancelamento',
  'Comentário',
];

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

const comoDataIso = (valor) => {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
};

const comoDateTimeIso = (valor) => {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor);
  return texto.includes('T') ? texto : `${texto.slice(0, 10)}T00:00:00.000Z`;
};

/** @param {Record<string, unknown>} registro */
export const comoLancamentoPublico = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  titulo: registro.titulo,
  descricao: registro.descricao ?? null,
  tipo: registro.tipo,
  tipo_tarefa_id: registro.tipo_tarefa_id,
  tipo_tarefa_nome: registro.tipo_tarefa_nome,
  grupo_atividade_id: registro.grupo_atividade_id ?? null,
  grupo_atividade_nome: registro.grupo_atividade_nome ?? null,
  solicitante: registro.solicitante ?? null,
  data_pedido: comoDataIso(registro.data_pedido),
  setor_nome: registro.setor_nome ?? null,
  prioridade: registro.prioridade,
  status: registro.status,
  data_prevista: comoDataIso(registro.data_prevista),
  data_inicio: comoDateTimeIso(registro.data_inicio),
  data_conclusao: comoDataIso(registro.data_conclusao),
  area_id: registro.area_id ?? null,
  area_nome: registro.area_nome ?? null,
  lote_id: registro.lote_id ?? null,
  lote_nome: registro.lote_nome ?? null,
  ponto_suplementacao_id: registro.ponto_suplementacao_id ?? null,
  coordenadas: registro.coordenadas ?? null,
  responsavel_id: registro.responsavel_id ?? null,
  responsavel: registro.responsavel ?? null,
  responsavel_geral: registro.responsavel_geral ?? null,
  observacoes: registro.observacoes ?? null,
  observacoes_conclusao: registro.observacoes_conclusao ?? null,
  fotos: Array.isArray(registro.fotos) ? registro.fotos : [],
  anexos_urls: Array.isArray(registro.anexos_urls) ? registro.anexos_urls : [],
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

/** @param {Record<string, unknown>} registro */
export const comoHistoricoPublico = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  tarefa_id: registro.tarefa_id,
  titulo_tarefa: registro.titulo_tarefa ?? null,
  evento: registro.evento,
  data_evento: comoDateTimeIso(registro.data_evento),
  status: registro.status ?? null,
  responsavel: registro.responsavel ?? null,
  descricao: registro.descricao ?? null,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const parseData = (valor) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const texto = String(valor).slice(0, 10);
  return new Date(`${texto}T00:00:00.000Z`);
};

const parseDateTime = (valor) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const d = new Date(String(valor));
  return Number.isNaN(d.getTime()) ? null : d;
};

const CAMPOS_LANCAMENTO = Object.freeze({
  empresa_id: (v) => textoOuNulo(v),
  titulo: (v) => textoOuNulo(v),
  descricao: (v) => textoOuNulo(v),
  tipo: (v) => textoOuNulo(v),
  tipo_tarefa_id: (v) => textoOuNulo(v),
  solicitante: (v) => textoOuNulo(v),
  data_pedido: (v) => parseData(v),
  prioridade: (v) => textoOuNulo(v),
  status: (v) => textoOuNulo(v),
  data_prevista: (v) => parseData(v),
  data_inicio: (v) => parseDateTime(v),
  data_conclusao: (v) => parseData(v),
  area_id: (v) => textoOuNulo(v),
  lote_id: (v) => textoOuNulo(v),
  ponto_suplementacao_id: (v) => textoOuNulo(v),
  coordenadas: (v) => (v === undefined ? undefined : v && typeof v === 'object' ? v : null),
  responsavel_id: (v) => textoOuNulo(v),
  responsavel: (v) => textoOuNulo(v),
  responsavel_geral: (v) => textoOuNulo(v),
  observacoes: (v) => textoOuNulo(v),
  observacoes_conclusao: (v) => textoOuNulo(v),
  fotos: (v) => (v === undefined ? undefined : Array.isArray(v) ? v.map(String) : []),
  anexos_urls: (v) => (v === undefined ? undefined : Array.isArray(v) ? v.map(String) : []),
});

/** @param {Record<string, unknown>} entrada */
const camposDeLancamento = (entrada) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const [campo, tratar] of Object.entries(CAMPOS_LANCAMENTO)) {
    if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
    const valor = tratar(entrada[campo]);
    if (valor !== undefined) saida[campo] = valor;
  }
  return saida;
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} tipoId
 */
const resolverTipoTarefa = async (tx, clienteId, tipoId) => {
  const tipo = await buscarTipo(clienteId, tipoId, tx);
  if (!tipo) throw tipoTarefaNotFound();
  return {
    tipo_tarefa_id: tipoId,
    tipo_tarefa_nome: tipo.nome_tipo,
    grupo_atividade_id: tipo.grupo_atividade_id,
    grupo_atividade_nome: tipo.grupo_atividade_nome,
  };
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string | null | undefined} loteId
 */
const resolverLote = async (tx, clienteId, loteId) => {
  if (!loteId) return { lote_id: null, lote_nome: null };
  const lote = await buscarLote(clienteId, loteId, tx);
  if (!lote) throw loteNotFound();
  return { lote_id: loteId, lote_nome: lote.nome };
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string | null | undefined} areaId
 */
const resolverArea = async (tx, clienteId, areaId) => {
  if (!areaId) return { area_id: null, area_nome: null, setor_nome: undefined };
  const area = await buscarArea(clienteId, areaId, tx);
  if (!area) throw areaNotFound();
  return { area_id: areaId, area_nome: area.nome, setor_nome: area.setor_nome };
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {Record<string, unknown>} campos
 */
const aplicarCachesDeFk = async (tx, clienteId, campos) => {
  /** @type {Record<string, unknown>} */
  const enriquecido = { ...campos };

  if (Object.prototype.hasOwnProperty.call(campos, 'tipo_tarefa_id')) {
    Object.assign(enriquecido, await resolverTipoTarefa(tx, clienteId, String(campos.tipo_tarefa_id)));
  }

  if (Object.prototype.hasOwnProperty.call(campos, 'lote_id')) {
    Object.assign(enriquecido, await resolverLote(tx, clienteId, /** @type {string|null} */ (campos.lote_id)));
  }

  if (Object.prototype.hasOwnProperty.call(campos, 'area_id')) {
    const area = await resolverArea(tx, clienteId, /** @type {string|null} */ (campos.area_id));
    Object.assign(enriquecido, area);
    if (area.setor_nome !== undefined && !Object.prototype.hasOwnProperty.call(campos, 'setor_nome')) {
      enriquecido.setor_nome = area.setor_nome;
    }
  }

  return enriquecido;
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarLancamentos(auth.clienteId);
  return registros.map(comoLancamentoPublico);
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {import('../../shared/auth/authContext.js').AuthContext} auth
 * @param {Record<string, unknown>} registro
 * @param {{ evento?: string; descricao?: string | null; data_evento?: Date } | null} entradaHistorico
 */
const registrarHistoricoMapaTx = async (contexto, tx, auth, registro, entradaHistorico) => {
  if (!entradaHistorico?.evento) return;
  const registroHistorico = await inserirHistorico(tx, {
    cliente_id: auth.clienteId,
    empresa_id: registro.empresa_id,
    tarefa_id: registro.id,
    titulo_tarefa: registro.titulo,
    evento: entradaHistorico.evento,
    data_evento: entradaHistorico.data_evento ?? new Date(),
    status: registro.status,
    responsavel: registro.responsavel,
    descricao: entradaHistorico.descricao ?? null,
  });
  await registrarEvento(
    contexto,
    {
      acao: 'create',
      entidade: 'HistoricoLancamentoTarefa',
      entidadeId: registroHistorico.id,
      dadosNovos: comoHistoricoPublico(registroHistorico),
    },
    tx
  );
};

/** @param {Record<string, unknown>} entrada */
const separarHistoricoMapa = (entrada) => {
  const {
    historico_evento: evento,
    historico_descricao: descricao,
    historico_data_evento: data_evento,
    ...resto
  } = entrada;
  const historico =
    typeof evento === 'string' && evento.trim()
      ? {
          evento: evento.trim(),
          descricao: typeof descricao === 'string' ? descricao : null,
          data_evento: parseDateTime(data_evento) ?? new Date(),
        }
      : null;
  return { corpo: resto, historico };
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const { corpo, historico } = separarHistoricoMapa(entrada);
  const campos = camposDeLancamento(corpo);

  const criado = await prisma.$transaction(async (tx) => {
    const dados = await aplicarCachesDeFk(tx, auth.clienteId, campos);
    const registro = await inserirLancamento(tx, {
      ...dados,
      cliente_id: auth.clienteId,
    });
    const publico = comoLancamentoPublico(registro);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'LancamentoTarefa', entidadeId: registro.id, dadosNovos: publico },
      tx
    );
    await registrarHistoricoMapaTx(contexto, tx, auth, registro, historico);
    return publico;
  });

  return criado;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, unknown>} entrada */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const { corpo, historico } = separarHistoricoMapa(entrada);

  return prisma.$transaction(async (tx) => {
    const anterior = await buscarLancamento(auth.clienteId, id, tx);
    if (!anterior) throw attachmentOwnerInvalid();

    const campos = camposDeLancamento(corpo);
    const dados =
      Object.keys(campos).length > 0
        ? await aplicarCachesDeFk(tx, auth.clienteId, campos)
        : {};

    const registro =
      Object.keys(dados).length > 0
        ? await atualizarLancamentoPorId(tx, auth.clienteId, id, dados)
        : anterior;

    const publico = comoLancamentoPublico(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'LancamentoTarefa',
        entidadeId: id,
        dadosAnteriores: comoLancamentoPublico(anterior),
        dadosNovos: publico,
      },
      tx
    );
    await registrarHistoricoMapaTx(contexto, tx, auth, registro, historico);
    return publico;
  });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    const anterior = await buscarLancamento(auth.clienteId, id, tx);
    if (!anterior) throw attachmentOwnerInvalid();

    await excluirLancamentoPorId(tx, auth.clienteId, id);

    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'LancamentoTarefa',
        entidadeId: id,
        dadosAnteriores: comoLancamentoPublico(anterior),
      },
      tx
    );
  });
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {{ limite?: number }} [query] */
export const listarHistorico = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarHistoricos(auth.clienteId, query);
  return registros.map(comoHistoricoPublico);
};

const CAMPOS_HISTORICO = Object.freeze({
  empresa_id: (v) => textoOuNulo(v),
  tarefa_id: (v) => textoOuNulo(v),
  titulo_tarefa: (v) => textoOuNulo(v),
  evento: (v) => textoOuNulo(v),
  data_evento: (v) => parseDateTime(v),
  status: (v) => textoOuNulo(v),
  responsavel: (v) => textoOuNulo(v),
  descricao: (v) => textoOuNulo(v),
});

/** @param {Record<string, unknown>} entrada */
const camposDeHistorico = (entrada) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const [campo, tratar] of Object.entries(CAMPOS_HISTORICO)) {
    if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
    const valor = tratar(entrada[campo]);
    if (valor !== undefined) saida[campo] = valor;
  }
  return saida;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criarHistorico = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDeHistorico(entrada);

  const criado = await prisma.$transaction(async (tx) => {
    const tarefaId = String(campos.tarefa_id);
    const tarefa = await buscarLancamento(auth.clienteId, tarefaId, tx);
    if (!tarefa) throw attachmentOwnerInvalid();

    const registro = await inserirHistorico(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      tarefa_id: tarefaId,
    });
    const publico = comoHistoricoPublico(registro);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'HistoricoLancamentoTarefa', entidadeId: registro.id, dadosNovos: publico },
      tx
    );
    return publico;
  });

  return criado;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const excluirHistorico = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    const anterior = await buscarHistorico(auth.clienteId, id, tx);
    if (!anterior) throw attachmentOwnerInvalid();

    await excluirHistoricoPorId(tx, auth.clienteId, id);

    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'HistoricoLancamentoTarefa',
        entidadeId: id,
        dadosAnteriores: comoHistoricoPublico(anterior),
      },
      tx
    );
  });
};

export const enumsContrato = Object.freeze({
  TIPOS_BASE,
  PRIORIDADES,
  STATUS,
  EVENTOS,
});
