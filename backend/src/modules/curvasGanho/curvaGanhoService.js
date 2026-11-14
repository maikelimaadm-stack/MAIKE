/**
 * Serviço de Curvas de Ganho de Peso da fazenda (D-PROD-189, mensal desde a
 * D-PROD-191), tabela física "CADCURVAGANHO".
 *
 * Uma curva guarda o ganho médio diário (GMD, kg/dia) previsto em cada mês do
 * calendário, de janeiro (`gmd_jan`) a dezembro (`gmd_dez`). A curva NÃO depende
 * das Estações (CADESTACOES): o mês já diz o GMD. Nesta fatia, SEM vínculo:
 * nada lê as curvas (a ligação com a Categoria de Manejo vem depois).
 *
 * Regras:
 *  - tenant só de `auth_context` (R11); a fazenda vem do corpo/query e precisa
 *    ser DESTE tenant (`exigirEmpresaDoTenant`: outra ou inexistente → 404);
 *  - nome em MAIÚSCULAS, único por fazenda (409 `CURVA_GANHO_NAME_CONFLICT`),
 *    com o tamanho conferido depois das maiúsculas ('ß' → 'SS');
 *  - os 12 GMD são obrigatórios na criação: número finito de -2 a 3 kg/dia
 *    (negativo = perda de peso), com no máximo 3 casas decimais. Gravado como
 *    decimal exato; o banco tem CHECK da faixa;
 *  - exclusão física com auditoria (não há dependentes nesta fatia).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { curvaGanhoNotFound, curvaGanhoNomeConflito } from '../../shared/errors/AppError.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo, travarEscopo, ehViolacaoDeUnique } from '../gestao/gestaoComum.js';
import {
  listarCurvas,
  buscarCurva,
  existeCurvaComNome,
  inserirCurva,
  atualizarCurvaPorId,
  excluirCurvaPorId,
} from './curvaGanhoRepository.js';
import { GMD_MINIMO, GMD_MAXIMO, MESES, CAMPOS_GMD } from './curvaGanhoCampos.js';

const ENTIDADE = 'CadCurvaGanho';
export { GMD_MINIMO, GMD_MAXIMO, MESES, CAMPOS_GMD };
/** Largura das colunas VARCHAR (em caracteres, como o PostgreSQL conta). */
const LARGURA = Object.freeze({ nome: 120, observacoes: 2000 });

/** Decimal do Prisma (ou número/texto) → número com até 3 casas. */
const numeroDe = (valor) => (valor === null || valor === undefined ? null : Number(Number(String(valor)).toFixed(3)));

/** @param {Record<string, unknown>} registro */
export const comoCurvaPublica = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  nome: registro.nome,
  ...Object.fromEntries(CAMPOS_GMD.map((campo) => [campo, numeroDe(registro[campo])])),
  observacoes: registro.observacoes ?? null,
  ativo: registro.ativo,
  created_date: registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date: registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

/**
 * @param {string|null|undefined} valor
 * @param {'nome'|'observacoes'} campo
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

/**
 * GMD em kg/dia: número finito na faixa, com no máximo 3 casas. Devolve o texto
 * decimal exato com 3 casas ("0.650"), que o Prisma grava sem erro de ponto
 * flutuante.
 * @param {unknown} valor
 * @param {string} campo
 */
const gmdDoCorpo = (valor, campo) => {
  if (valor === undefined) return undefined;
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw invalido(`${campo} deve ser um número (kg/dia)`, { field: campo, reason: 'gmd_invalido' });
  }
  if (valor < GMD_MINIMO || valor > GMD_MAXIMO) {
    throw invalido(`${campo} deve estar entre ${GMD_MINIMO} e ${GMD_MAXIMO} kg/dia`, { field: campo, reason: 'gmd_fora_da_faixa' });
  }
  const milesimos = Math.round(valor * 1000);
  if (Math.abs(valor * 1000 - milesimos) > 1e-6) {
    throw invalido(`${campo} aceita no máximo 3 casas decimais`, { field: campo, reason: 'gmd_casas_decimais' });
  }
  return (milesimos / 1000).toFixed(3);
};

/**
 * Campos editáveis do corpo, já normalizados. `empresa_id` NÃO está aqui: é o
 * escopo, conferido à parte e nunca alterado por PATCH.
 * @param {Record<string, unknown>} entrada
 */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const campos = {};
  const nome = caberNaColuna(textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true }), 'nome');
  if (nome !== undefined) campos.nome = nome;
  for (const campo of CAMPOS_GMD) {
    const gmd = gmdDoCorpo(entrada[campo], campo);
    if (gmd !== undefined) campos[campo] = gmd;
  }
  const observacoes = caberNaColuna(textoDoCorpo(entrada.observacoes, 'observacoes', { maiusculas: true }), 'observacoes');
  if (observacoes !== undefined) campos.observacoes = observacoes;
  if (entrada.ativo !== undefined) campos.ativo = Boolean(entrada.ativo);
  return campos;
};

/** Trava das escritas de curvas de UMA fazenda (tenant + empresa). */
const travarFazenda = (tx, clienteId, empresaId) => travarEscopo(tx, `curvas-ganho:${clienteId}:${empresaId}`);

/**
 * @template T
 * @param {() => Promise<T>} executar
 * @returns {Promise<T>}
 */
const comConflitoDeNomeEstavel = async (executar) => {
  try {
    return await executar();
  } catch (erro) {
    // Corrida perdida contra o unique (cliente_id, empresa_id, nome): 409, nunca 500.
    if (ehViolacaoDeUnique(erro)) throw curvaGanhoNomeConflito();
    throw erro;
  }
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ empresa_id?: unknown }} consulta
 */
export const listar = async (contexto, consulta) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, consulta?.empresa_id);
  const registros = await listarCurvas(auth.clienteId, empresaId);
  return registros.map(comoCurvaPublica);
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {{ empresa_id?: unknown }} consulta
 */
export const obter = async (contexto, id, consulta) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, consulta?.empresa_id);
  const registro = await buscarCurva(auth.clienteId, empresaId, id);
  if (!registro) throw curvaGanhoNotFound();
  return comoCurvaPublica(registro);
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);
  for (const campo of CAMPOS_GMD) {
    if (campos[campo] === undefined) throw invalido(`${campo} é obrigatório`, { field: campo });
  }
  const ativo = campos.ativo === undefined ? true : Boolean(campos.ativo);

  return comConflitoDeNomeEstavel(() =>
    prisma.$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      await travarFazenda(tx, auth.clienteId, empresaId);

      if (await existeCurvaComNome(tx, auth.clienteId, empresaId, String(campos.nome))) {
        throw curvaGanhoNomeConflito();
      }

      const registro = await inserirCurva(tx, { ...campos, ativo, cliente_id: auth.clienteId, empresa_id: empresaId });
      const publico = comoCurvaPublica(registro);
      await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: publico }, tx);
      return publico;
    })
  );
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {Record<string, unknown>} entrada
 */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  return comConflitoDeNomeEstavel(() =>
    prisma.$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      await travarFazenda(tx, auth.clienteId, empresaId);

      const anterior = await buscarCurva(auth.clienteId, empresaId, id, tx);
      if (!anterior) throw curvaGanhoNotFound();

      if (campos.nome !== undefined && campos.nome !== anterior.nome) {
        if (await existeCurvaComNome(tx, auth.clienteId, empresaId, String(campos.nome), id)) {
          throw curvaGanhoNomeConflito();
        }
      }

      const registro = Object.keys(campos).length ? await atualizarCurvaPorId(tx, auth.clienteId, id, campos) : anterior;
      const publico = comoCurvaPublica(registro);
      await registrarEvento(
        contexto,
        { acao: 'update', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: comoCurvaPublica(anterior), dadosNovos: publico },
        tx
      );
      return publico;
    })
  );
};

/**
 * Exclusão física: nesta fatia nada referencia CADCURVAGANHO (D-PROD-189).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {{ empresa_id?: unknown }} consulta
 */
export const excluir = async (contexto, id, consulta) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, consulta?.empresa_id);
    await travarFazenda(tx, auth.clienteId, empresaId);

    const anterior = await buscarCurva(auth.clienteId, empresaId, id, tx);
    if (!anterior) throw curvaGanhoNotFound();

    await excluirCurvaPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: comoCurvaPublica(anterior) },
      tx
    );
  });
};
