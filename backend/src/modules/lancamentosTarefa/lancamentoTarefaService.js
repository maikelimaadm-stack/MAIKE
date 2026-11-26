/**
 * Serviço de LancamentoTarefa e histórico (P5.3, D-PROD-49).
 */

import { exigirLotesNaoExcluidos } from '../../shared/lotes/loteVivo.js';
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
  buscarLancamentoPorIdEmQualquerTenant,
} from './lancamentoTarefaRepository.js';
import { criarComIdDoAparelho, foiExcluidoNoHistorico, idDoAparelhoDe } from '../../shared/idempotency/idDoAparelho.js';
import { NOME_GRUPO_PADRAO_OPERACAO } from '../tiposAtividade/tipoAtividadePadroes.js';
import { agoraDoServidor, diaNoFuso } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import {
  listarHistoricos,
  buscarHistorico,
  inserirHistorico,
  excluirHistoricoPorId,
} from './historicoLancamentoTarefaRepository.js';

const TIPOS_BASE = ['Manejo', 'Suplementação', 'Manutenção', 'Verificação', 'Sanitário', 'Outro'];
const PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Urgente'];
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
  posicao_id: registro.posicao_id ?? null,
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
  if (!loteId) return { lote_id: null, lote_nome: null, posicao_id: null };
  // R2E-R1 (D-PROD-107): no ledger o mapa cita a POSIÇÃO; a tarefa guarda a
  // posição em `posicao_id` e a ENTRADA de origem (cadastro) em `lote_id`.
  const posicao = await tx.posicaoRebanho.findFirst({ where: { cliente_id: clienteId, id: loteId }, select: { id: true, nome: true, lote_entrada_id: true } });
  if (posicao) {
    if (posicao.lote_entrada_id) await exigirLotesNaoExcluidos(tx, clienteId, [posicao.lote_entrada_id]);
    return { lote_id: posicao.lote_entrada_id ?? null, lote_nome: posicao.nome, posicao_id: posicao.id };
  }
  // FOR SHARE + recusa de lote excluído do cadastro (MAIKE-LOTES-R1).
  await exigirLotesNaoExcluidos(tx, clienteId, [loteId]);
  const lote = await buscarLote(clienteId, loteId, tx);
  if (!lote) throw loteNotFound();
  return { lote_id: loteId, lote_nome: lote.nome, posicao_id: null };
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

/** D-PROD-320: o tipo de quem lança a tarefa sem escolher um ("deixa sem e depois eu mudo"). */
export const NOME_TIPO_SEM_TIPO = 'SEM TIPO';
/** Tipo base (enum do contrato) da tarefa sem tipo. */
const TIPO_BASE_SEM_TIPO = 'Outro';
/** Fuso do dia do pedido quando a tela não manda a data (a tarefa não lê a fazenda). */
const FUSO_DO_PEDIDO = 'America/Sao_Paulo';

/** @param {unknown} erro */
const ehUnique = (erro) => /** @type {any} */ (erro)?.code === 'P2002';

/**
 * D-PROD-320 — o tipo "SEM TIPO" do cliente, no grupo padrão "GERAL" (o mesmo das operações, D-PROD-258).
 * O banco exige um tipo em toda tarefa; em vez de mudar o banco, a tarefa lançada sem tipo usa este, criado na
 * primeira vez (auditado), numa transação curta própria. Duas tarefas ao mesmo tempo: a unique do banco decide e
 * a que perde relê (o mesmo grupo e o mesmo tipo). O administrador troca pelo tipo certo depois, na edição.
 * @param {any} contexto @param {string} clienteId @returns {Promise<string>} o id do tipo
 */
const garantirTipoSemTipo = async (contexto, clienteId) => {
  const prisma = getPrismaClient();
  const ler = async () => {
    const grupo = await prisma.grupoAtividade.findFirst({ where: { cliente_id: clienteId, nome_grupo: NOME_GRUPO_PADRAO_OPERACAO } });
    const tipo = grupo
      ? await prisma.tipoTarefa.findFirst({ where: { cliente_id: clienteId, grupo_atividade_id: grupo.id, nome_tipo: NOME_TIPO_SEM_TIPO } })
      : null;
    return { grupo, tipo };
  };
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const { grupo, tipo } = await ler();
    if (tipo) return tipo.id;
    try {
      return await prisma.$transaction(async (tx) => {
        let g = grupo;
        if (!g) {
          g = await tx.grupoAtividade.create({ data: { cliente_id: clienteId, nome_grupo: NOME_GRUPO_PADRAO_OPERACAO, ativo: true } });
          await registrarEvento(contexto, { acao: 'create', entidade: 'GrupoAtividade', entidadeId: g.id, dadosNovos: { id: g.id, nome_grupo: g.nome_grupo, ativo: true, origem: 'tarefa_sem_tipo' } }, tx);
        }
        const t = await tx.tipoTarefa.create({
          data: { cliente_id: clienteId, grupo_atividade_id: g.id, grupo_atividade_nome: g.nome_grupo, nome_tipo: NOME_TIPO_SEM_TIPO, ativo: true },
        });
        await registrarEvento(contexto, { acao: 'create', entidade: 'TipoTarefa', entidadeId: t.id, dadosNovos: { id: t.id, nome_tipo: t.nome_tipo, grupo_atividade_id: g.id, ativo: true, origem: 'tarefa_sem_tipo' } }, tx);
        return t.id;
      });
    } catch (erro) {
      if (!ehUnique(erro)) throw erro; // outra criou ao mesmo tempo: relê
    }
  }
  const { tipo } = await ler();
  if (tipo) return tipo.id;
  throw tipoTarefaNotFound();
};

/**
 * D-PROD-320 — o que a tela simplificada não manda mais e o servidor preenche: o tipo base ("Outro"), a data do
 * pedido (hoje) e quem pediu (quem está lançando). O tipo "SEM TIPO" vem antes (`garantirTipoSemTipo`). O que vier
 * no corpo vale.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {any} contexto
 * @param {import('../../shared/auth/authContext.js').AuthContext} auth @param {Record<string, unknown>} campos
 */
const completarCriacao = async (tx, contexto, auth, campos) => {
  const completo = { ...campos };
  if (!completo.tipo) completo.tipo = TIPO_BASE_SEM_TIPO;
  if (!completo.data_pedido) completo.data_pedido = parseData(diaNoFuso(agoraDoServidor(), FUSO_DO_PEDIDO));
  if (!completo.solicitante) {
    const usuario = auth.usuarioId
      ? await tx.usuario.findFirst({ where: { cliente_id: auth.clienteId, id: auth.usuarioId }, select: { nome: true, login: true } })
      : null;
    const nome = String(usuario?.nome || usuario?.login || auth.login || '').trim().slice(0, 255);
    if (nome) completo.solicitante = nome;
  }
  return completo;
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
  const { id: idInformado, ...semId } = entrada ?? {};
  // D-PROD-319 (Etapa 5a): id gerado no aparelho — repetir a criação (resposta perdida, app fechado no meio)
  // devolve a mesma tarefa, sem segunda tarefa nem segundo registro no histórico.
  const { registro } = await criarComIdDoAparelho({
    id: idDoAparelhoDe(idInformado),
    clienteId: auth.clienteId,
    entidade: 'LancamentoTarefa',
    buscar: async (id) => {
      const existente = await buscarLancamentoPorIdEmQualquerTenant(id);
      if (existente) {
        const { cliente_id: dono, ...publico } = existente;
        return { cliente_id: dono, registro: comoLancamentoPublico(publico) };
      }
      return (await foiExcluidoNoHistorico(auth.clienteId, 'LancamentoTarefa', id))
        ? { cliente_id: auth.clienteId, excluido: true, registro: null }
        : null;
    },
    criar: (id) => criarNaTransacao(contexto, auth, semId, id),
  });
  return registro;
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {import('../../shared/auth/authContext.js').AuthContext} auth
 * @param {Record<string, unknown>} entrada @param {string|null} idDoAparelho
 */
const criarNaTransacao = async (contexto, auth, entrada, idDoAparelho) => {
  const prisma = getPrismaClient();
  const { corpo, historico } = separarHistoricoMapa(entrada);
  const campos = camposDeLancamento(corpo);
  if (!campos.tipo_tarefa_id) campos.tipo_tarefa_id = await garantirTipoSemTipo(contexto, auth.clienteId);

  const criado = await prisma.$transaction(async (tx) => {
    const dados = await aplicarCachesDeFk(tx, auth.clienteId, await completarCriacao(tx, contexto, auth, campos));
    const registro = await inserirLancamento(tx, {
      ...dados,
      ...(idDoAparelho ? { id: idDoAparelho } : {}),
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
  const { corpo: corpoComFotosNovas, historico } = separarHistoricoMapa(entrada);
  const { fotos_adicionar: fotosAdicionar, ...corpo } = corpoComFotosNovas;
  const somarFotos = Array.isArray(fotosAdicionar) && fotosAdicionar.length > 0;

  return prisma.$transaction(async (tx) => {
    // D-PROD-335: quem soma fotos trava a tarefa antes de ler as atuais (dois envios ao mesmo tempo não se apagam).
    if (somarFotos) await tx.$queryRaw`SELECT id FROM "LancamentoTarefa" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR UPDATE`;
    const anterior = await buscarLancamento(auth.clienteId, id, tx);
    if (!anterior) throw attachmentOwnerInvalid();

    const campos = camposDeLancamento(corpo);
    if (somarFotos) {
      // D-PROD-335: a foto tirada sem internet sobe e é SOMADA às fotos que a tarefa tem agora no servidor. Antes o
      // aparelho mandava a lista inteira lida da cópia dele: cópia antiga (ou de outra fazenda) apagava as fotos que
      // a tarefa já tinha. Com `fotos` junto, a soma é sobre ela.
      const base = Array.isArray(campos.fotos) ? campos.fotos : Array.isArray(anterior.fotos) ? anterior.fotos : [];
      campos.fotos = [...new Set([...base.map(String), ...fotosAdicionar.map(String)])];
    }
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

    // D-PROD-137 (TAR-01): empresa, título e status saem da tarefa RELIDA, como no
    // caminho interno (`registrarHistoricoMapaTx`). Com `empresa_id` do corpo, o
    // evento sumia do painel da tarefa (cache por empresa) e aparecia como
    // vínculo de outra empresa.
    const registro = await inserirHistorico(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      tarefa_id: tarefa.id,
      empresa_id: tarefa.empresa_id,
      titulo_tarefa: tarefa.titulo,
      status: tarefa.status,
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
