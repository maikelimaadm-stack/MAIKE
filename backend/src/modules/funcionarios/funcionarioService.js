/**
 * Serviço de Funcionários da fazenda (D-PROD-203, Fatia 4 do Lançamento de
 * Atividades). Contrato: `docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §2.
 *
 * Um funcionário é a pessoa cuja mão de obra entra no custo da atividade (não
 * precisa entrar no sistema: não é `Usuario`). NÃO é folha: sem salário,
 * encargos, ponto ou pagamento (D-PROD-02). Só nome, cargo, tipo e os custos de
 * referência (hora e diária) que a linha de mão de obra copia como snapshot.
 *
 * Regras:
 *  - tenant só de `auth_context` (R11); a fazenda vem do corpo/query e precisa
 *    ser DESTE tenant (`exigirEmpresaDoTenant`: outra ou inexistente → 404);
 *    a fazenda do registro é imutável (outra fazenda no PATCH → 404);
 *  - nome e cargo em MAIÚSCULAS; `tipo` ∈ MENSALISTA | DIARISTA | TAREFEIRO
 *    (o schema da rota recusa outro; o banco tem CHECK);
 *  - custos opcionais, texto decimal ≥ 0 com até 4 casas (o schema recusa
 *    negativo e número JSON; o banco tem CHECK);
 *  - número pela sequência atômica do tenant (`reservarNumero`, nunca MAX+1);
 *  - SEM exclusão física: inativar e reativar (cadastro com custo nunca é
 *    apagado); toda escrita audita na mesma transação.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { funcionarioNotFound } from '../../shared/errors/AppError.js';
import { decodificarCursor, montarEnvelopeKeyset, normalizarLimite } from '../../shared/pagination/keysetCursor.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { CASAS_CUSTO, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido, iso, textoDeBusca, textoDoCorpo } from '../gestao/gestaoComum.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import {
  atualizarFuncionarioPorId,
  buscarFuncionario,
  inserirFuncionario,
  listarFuncionariosPagina,
} from './funcionarioRepository.js';

export const TIPOS_FUNCIONARIO = Object.freeze(['MENSALISTA', 'DIARISTA', 'TAREFEIRO']);
/** Decimais do corpo (texto; o `preValidation` da rota recusa número JSON). */
export const DECIMAIS_FUNCIONARIO = Object.freeze(['custo_hora', 'custo_diaria']);

const ENTIDADE = 'Funcionario';
/** Largura das colunas VARCHAR (em caracteres, como o PostgreSQL conta). */
const LARGURA = Object.freeze({ nome: 255, cargo: 120 });

/** @param {unknown} v @returns {string|null} */
const t4 = (v) => (v === null || v === undefined ? null : dec(/** @type {any} */ (v)).toFixed(CASAS_CUSTO));

/** @param {Record<string, any>} r */
export const comoFuncionarioPublico = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  numero: r.numero,
  nome: r.nome,
  cargo: r.cargo ?? null,
  tipo: r.tipo,
  custo_hora: t4(r.custo_hora),
  custo_diaria: t4(r.custo_diaria),
  ativo: r.ativo,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/**
 * O schema limita o texto ANTES das maiúsculas; algumas letras crescem ao subir
 * ('ß' → 'SS'). Confere de novo depois de normalizar (senão P2000 → 500).
 * @param {string|null|undefined} valor @param {'nome'|'cargo'} campo
 */
const caberNaColuna = (valor, campo) => {
  if (typeof valor === 'string' && [...valor].length > LARGURA[campo]) {
    throw invalido(`${campo} passa de ${LARGURA[campo]} caracteres depois de convertido para maiúsculas`, {
      field: campo,
      reason: 'tamanho_excedido',
    });
  }
  return valor;
};

/** @param {unknown} v @param {string} campo @returns {string|null|undefined} */
const decimalDoCorpo = (v, campo) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !/^\d{1,10}(\.\d{1,4})?$/.test(v)) {
    throw invalido(`${campo} deve ser texto decimal não negativo, com até 10 dígitos e 4 casas (ex.: "12.5")`, { field: campo, reason: 'formato' });
  }
  return dec(v).toFixed(CASAS_CUSTO);
};

/** @param {unknown} v */
const tipoDoCorpo = (v) => {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !TIPOS_FUNCIONARIO.includes(v)) {
    throw invalido(`tipo deve ser um de: ${TIPOS_FUNCIONARIO.join(', ')}`, { field: 'tipo' });
  }
  return v;
};

/**
 * Campos editáveis do corpo, já normalizados (só os presentes). `empresa_id`
 * NÃO está aqui: é o escopo, conferido à parte e nunca alterado.
 * @param {Record<string, unknown>} entrada
 */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const campos = {};
  const nome = caberNaColuna(textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true }), 'nome');
  if (nome !== undefined) campos.nome = nome;
  const cargo = caberNaColuna(textoDoCorpo(entrada.cargo, 'cargo', { maiusculas: true }), 'cargo');
  if (cargo !== undefined) campos.cargo = cargo;
  const tipo = tipoDoCorpo(entrada.tipo);
  if (tipo !== undefined) campos.tipo = tipo;
  for (const campo of DECIMAIS_FUNCIONARIO) {
    const valor = decimalDoCorpo(entrada[campo], campo);
    if (valor !== undefined) campos[campo] = valor;
  }
  return campos;
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ empresa_id?: unknown, q?: unknown, ativo?: unknown, limit?: unknown, cursor?: unknown }} consulta
 */
export const listar = async (contexto, consulta = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, consulta.empresa_id);
  const limit = normalizarLimite(consulta.limit);
  const cursorBruto = typeof consulta.cursor === 'string' ? consulta.cursor : null;
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) throw invalido('cursor inválido', { field: 'cursor', reason: 'cursor_invalido' });
  let ativo = null;
  if (consulta.ativo === true || consulta.ativo === 'true') ativo = true;
  if (consulta.ativo === false || consulta.ativo === 'false') ativo = false;
  const q = textoDeBusca(consulta.q);
  const { registros, total } = await listarFuncionariosPagina(auth.clienteId, empresaId, { q, ativo, limit, cursor });
  return montarEnvelopeKeyset({ registros, limit, total, mapItem: comoFuncionarioPublico });
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {{ empresa_id?: unknown }} consulta
 */
export const obter = async (contexto, id, consulta = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, consulta.empresa_id);
  const registro = await buscarFuncionario(auth.clienteId, empresaId, id);
  if (!registro) throw funcionarioNotFound();
  return comoFuncionarioPublico(registro);
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const campos = camposDe(entrada);
  if (!campos.tipo) throw invalido('tipo é obrigatório', { field: 'tipo' });

  return getPrismaClient().$transaction(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
    const numero = await reservarNumero(tx, { clienteId: auth.clienteId, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT });
    const registro = await inserirFuncionario(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      empresa_id: empresaId,
      numero: String(numero),
      ativo: true,
    });
    const publico = comoFuncionarioPublico(registro);
    await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: publico }, tx);
    return publico;
  });
};

/**
 * PATCH dos campos (sem `ativo`: inativar e reativar têm rota própria).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {Record<string, unknown>} entrada
 */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const campos = camposDe(entrada);

  return getPrismaClient().$transaction(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
    const anterior = await buscarFuncionario(auth.clienteId, empresaId, id, tx);
    if (!anterior) throw funcionarioNotFound();
    const antes = comoFuncionarioPublico(anterior);
    const mudou = Object.keys(campos).filter((k) => campos[k] !== /** @type {any} */ (antes)[k]);
    if (!mudou.length) return antes;
    const dados = Object.fromEntries(mudou.map((k) => [k, campos[k]]));
    const registro = await atualizarFuncionarioPorId(tx, auth.clienteId, id, dados);
    const publico = comoFuncionarioPublico(registro);
    await registrarEvento(
      contexto,
      { acao: 'update', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: antes, dadosNovos: { ...publico, campos_alterados: mudou } },
      tx
    );
    return publico;
  });
};

/**
 * Inativar (`ativo = false`) ou reativar (`true`). Idempotente: já no estado
 * pedido devolve o registro sem gravar nem auditar. Nada é apagado; as linhas de
 * mão de obra já lançadas ficam (o funcionário inativo só não é oferecido para
 * linhas novas).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {{ empresa_id?: unknown }} entrada
 * @param {boolean} ativo
 */
export const alterarSituacao = async (contexto, id, entrada, ativo) => {
  const auth = exigirAuthContext(contexto?.auth);
  return getPrismaClient().$transaction(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada?.empresa_id);
    const anterior = await buscarFuncionario(auth.clienteId, empresaId, id, tx);
    if (!anterior) throw funcionarioNotFound();
    if (anterior.ativo === ativo) return comoFuncionarioPublico(anterior);
    const registro = await atualizarFuncionarioPorId(tx, auth.clienteId, id, { ativo });
    const publico = comoFuncionarioPublico(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: comoFuncionarioPublico(anterior),
        dadosNovos: { ...publico, comando: ativo ? 'reativar' : 'inativar' },
      },
      tx
    );
    return publico;
  });
};
