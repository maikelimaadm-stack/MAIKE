/**
 * Serviço da Leitura de cocho (D-PROD-205, etapa 3 da suplementação), tabela
 * física "LEITURACOCHO".
 *
 * Uma leitura registra o que se viu no cocho num dia:
 *  - escore: VAZIO | ADEQUADO | CHEIO (obrigatório);
 *  - acesso: BOM | RUIM (padrão BOM);
 *  - estrutura: BOA | REPARO | QUEBRADA (padrão BOA);
 *  - observação livre (opcional).
 * NÃO movimenta estoque. Alimenta o farol do cocho no mapa.
 *
 * Regras:
 *  - tenant só de `auth_context` (R11); a fazenda (`empresa_id`) vem do corpo e
 *    precisa ser DESTE tenant (`exigirEmpresaDoTenant`: outra ou inexistente → 404);
 *  - o cocho (`ponto_suplementacao_id`) precisa existir neste tenant, ser DESTA
 *    fazenda e ser um COCHO (depósito não tem leitura) → senão 400 com
 *    `field`/`reason` (`ponto_inexistente`, `ponto_de_outra_fazenda`, `ponto_nao_e_cocho`);
 *  - `data_leitura` AAAA-MM-DD válida e não posterior a hoje no fuso da fazenda
 *    (sem fuso configurado, America/Sao_Paulo) → senão 400 (`data_invalida`, `data_futura`);
 *  - `registrado_por_nome` vem da conta autenticada (nome, ou o login), nunca do corpo;
 *  - exclusão física por id do tenant (a leitura não tem efeito em outro lugar);
 *  - D-PROD-296: com `operation_id`, a criação é idempotente (`OperacaoIdempotente`,
 *    tipo `leitura_cocho_criar`): o reenvio do app que ficou sem internet devolve
 *    a MESMA leitura, nunca uma segunda. Sem `operation_id` (versão antiga do
 *    app), cria como antes.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { leituraCochoNotFound } from '../../shared/errors/AppError.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { agoraDoServidor, diaNoFuso, normalizarFusoIana } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import {
  listarLeituras,
  buscarLeitura,
  buscarPonto,
  buscarFusoDaEmpresa,
  buscarNomeDoUsuario,
  inserirLeitura,
  excluirLeituraPorId,
} from './leituraCochoRepository.js';

const ENTIDADE = 'LeituraCocho';
export const ESCORES = Object.freeze(['VAZIO', 'ADEQUADO', 'CHEIO']);
export const ACESSOS = Object.freeze(['BOM', 'RUIM']);
export const ESTRUTURAS = Object.freeze(['BOA', 'REPARO', 'QUEBRADA']);
/** Reserva quando a fazenda não tem fuso configurado (a leitura não é fato do rebanho). */
export const FUSO_RESERVA = 'America/Sao_Paulo';
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** @param {Date|string} d */
const diaDe = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/**
 * Formato público da leitura (data como AAAA-MM-DD).
 * @param {any} r
 */
export const comoLeituraPublica = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  ponto_suplementacao_id: r.ponto_suplementacao_id,
  data_leitura: diaDe(r.data_leitura),
  escore: r.escore,
  acesso: r.acesso,
  estrutura: r.estrutura,
  observacoes: r.observacoes ?? null,
  registrado_por_nome: r.registrado_por_nome ?? null,
  created_date: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  updated_date: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
});

/** @param {unknown} v */
const semAcento = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/**
 * Valor fechado: obrigatório (sem padrão) ou com padrão quando ausente/nulo.
 * @param {unknown} valor
 * @param {string} campo
 * @param {readonly string[]} permitidos
 * @param {string|null} padrao
 */
const valorFechado = (valor, campo, permitidos, padrao) => {
  if (valor === undefined || valor === null || valor === '') {
    if (padrao) return padrao;
    throw invalido(`${campo} é obrigatório`, { field: campo, reason: 'obrigatorio' });
  }
  const v = semAcento(valor);
  if (!permitidos.includes(v)) {
    throw invalido(`${campo} deve ser um de: ${permitidos.join(', ')}`, { field: campo, reason: 'valor_invalido' });
  }
  return v;
};

/**
 * Dia AAAA-MM-DD válido no calendário (2026-02-30 não passa).
 * @param {unknown} valor
 */
const diaValido = (valor) => {
  if (typeof valor !== 'string' || !DIA.test(valor)) return null;
  const d = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor ? valor : null;
};

/**
 * @param {any} contexto auth_context da requisição (`contexto.auth`)
 * @param {{ empresa_id?: string, ponto_suplementacao_id?: string, limit?: unknown }} filtros
 */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarLeituras(auth.clienteId, filtros);
  return registros.map(comoLeituraPublica);
};

/** Tipo do recibo de idempotência da criação (D-PROD-296). */
export const TIPO_OPERACAO_CRIAR = 'leitura_cocho_criar';

/** @param {unknown} valor */
const operationIdDaEntrada = (valor) => {
  if (valor === undefined || valor === null) return null;
  const chave = typeof valor === 'string' ? valor.trim() : '';
  if (chave.length < 8 || chave.length > 128) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'operation_id inválido', { details: { field: 'operation_id', reason: 'format' } });
  }
  return chave;
};

/**
 * Valida e grava uma leitura dentro da transação.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {any} contexto
 * @param {{clienteId: string, usuarioId: string, login?: string}} auth
 * @param {Record<string, unknown>} entrada
 */
const gravarLeitura = async (tx, contexto, auth, entrada) => {
  const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);

  const pontoId = typeof entrada.ponto_suplementacao_id === 'string' ? entrada.ponto_suplementacao_id.trim() : '';
  if (!pontoId) throw invalido('ponto_suplementacao_id é obrigatório', { field: 'ponto_suplementacao_id', reason: 'obrigatorio' });
  const ponto = await buscarPonto(tx, auth.clienteId, pontoId);
  if (!ponto) throw invalido('cocho não encontrado neste tenant', { field: 'ponto_suplementacao_id', reason: 'ponto_inexistente' });
  if (ponto.empresa_id !== empresaId) {
    throw invalido('o cocho é de outra fazenda', { field: 'ponto_suplementacao_id', reason: 'ponto_de_outra_fazenda' });
  }
  if (!semAcento(ponto.categoria_ponto || 'COCHO').includes('COCHO')) {
    throw invalido('só cocho tem leitura (depósito não)', { field: 'ponto_suplementacao_id', reason: 'ponto_nao_e_cocho' });
  }

  const dia = diaValido(entrada.data_leitura);
  if (!dia) throw invalido('data_leitura deve ser uma data válida (AAAA-MM-DD)', { field: 'data_leitura', reason: 'data_invalida' });
  const empresa = await buscarFusoDaEmpresa(tx, auth.clienteId, empresaId);
  const fuso = normalizarFusoIana(empresa?.fuso_horario) || FUSO_RESERVA;
  const hoje = diaNoFuso(agoraDoServidor(), fuso);
  if (dia > hoje) {
    throw invalido(`a data ${dia} é posterior a hoje (${hoje}) na fazenda: só leitura já feita`, { field: 'data_leitura', reason: 'data_futura', hoje });
  }

  const escore = valorFechado(entrada.escore, 'escore', ESCORES, null);
  const acesso = valorFechado(entrada.acesso, 'acesso', ACESSOS, 'BOM');
  const estrutura = valorFechado(entrada.estrutura, 'estrutura', ESTRUTURAS, 'BOA');
  const observacoes = textoDoCorpo(entrada.observacoes, 'observacoes') ?? null;
  if (observacoes && [...observacoes].length > 2000) {
    throw invalido('observacoes passa de 2000 caracteres', { field: 'observacoes', reason: 'tamanho_excedido' });
  }

  const usuario = await buscarNomeDoUsuario(tx, auth.clienteId, auth.usuarioId);
  const nome = (usuario?.nome || usuario?.login || auth.login || '').trim().slice(0, 255) || null;

  const registro = await inserirLeitura(tx, {
    cliente_id: auth.clienteId,
    empresa_id: empresaId,
    ponto_suplementacao_id: ponto.id,
    data_leitura: new Date(`${dia}T00:00:00.000Z`),
    escore,
    acesso,
    estrutura,
    observacoes,
    registrado_por_nome: nome,
  });
  await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: comoLeituraPublica(registro) }, tx);
  return registro;
};

/**
 * @param {any} contexto auth_context da requisição (`contexto.auth`)
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const operationKey = operationIdDaEntrada(entrada.operation_id);
  if (!operationKey) {
    const criado = await prisma.$transaction((tx) => gravarLeitura(tx, contexto, auth, entrada));
    return comoLeituraPublica(criado);
  }
  // O fingerprint é do que define a leitura: o mesmo código com outro conteúdo é 409.
  const fingerprint = fingerprintDePayload({
    empresa_id: entrada.empresa_id ?? null,
    ponto_suplementacao_id: entrada.ponto_suplementacao_id ?? null,
    data_leitura: entrada.data_leitura ?? null,
    escore: entrada.escore ?? null,
    acesso: entrada.acesso ?? null,
    estrutura: entrada.estrutura ?? null,
    observacoes: entrada.observacoes ?? null,
  });
  const idem = await prisma.$transaction((tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO_OPERACAO_CRIAR,
      fingerprint,
      executar: async () => ({ httpStatus: 201, body: comoLeituraPublica(await gravarLeitura(tx, contexto, auth, entrada)) }),
    })
  );
  return /** @type {ReturnType<typeof comoLeituraPublica>} */ (/** @type {unknown} */ (idem.body));
};

/**
 * @param {any} contexto auth_context da requisição (`contexto.auth`)
 * @param {string} id
 */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const existente = await buscarLeitura(tx, auth.clienteId, id);
    if (!existente) throw leituraCochoNotFound();
    await excluirLeituraPorId(tx, auth.clienteId, id);
    await registrarEvento(contexto, { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: comoLeituraPublica(existente) }, tx);
  });
};
