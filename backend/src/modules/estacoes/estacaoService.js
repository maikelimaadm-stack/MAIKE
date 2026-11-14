/**
 * Serviço de Estações da fazenda (D-PROD-188), tabela física "CADESTACOES".
 *
 * Uma estação é um período de ÁGUAS, TRANSIÇÃO ou SECA, com data de início e
 * de fim, numa fazenda (empresa). Primeira fatia, SEM vínculo com nenhum outro
 * cadastro: nada lê as estações ainda. A curva de ganho NÃO usa as estações
 * (é mensal, D-PROD-190); relatórios e planejamento ficam para missões próprias.
 *
 * Regras:
 *  - tenant só de `auth_context` (R11); a fazenda vem do corpo/query e precisa
 *    ser DESTE tenant (`exigirEmpresaDoTenant`: outra ou inexistente → 404);
 *  - nome em MAIÚSCULAS, único por fazenda (409 `ESTACAO_NAME_CONFLICT`);
 *  - `tipo` ∈ AGUAS | TRANSICAO | SECA (o schema da rota já recusa outro; o
 *    banco tem CHECK);
 *  - datas `AAAA-MM-DD` de dia real; `data_fim >= data_inicio` (400; o banco
 *    tem CHECK);
 *  - duas estações ATIVAS da mesma fazenda não se sobrepõem, nem num único dia
 *    (409 `ESTACAO_PERIODO_SOBREPOSTO`). A checagem roda sob trava do escopo
 *    (tenant + fazenda) até o fim da transação: duas gravações simultâneas não
 *    passam juntas. Estação inativa não entra na regra;
 *  - exclusão física com auditoria (não há dependentes nesta fatia).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import {
  estacaoNotFound,
  estacaoNomeConflito,
  estacaoPeriodoSobreposto,
} from '../../shared/errors/AppError.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo, travarEscopo, ehViolacaoDeUnique } from '../gestao/gestaoComum.js';
import {
  listarEstacoes,
  buscarEstacao,
  existeEstacaoComNome,
  buscarEstacaoAtivaSobreposta,
  inserirEstacao,
  atualizarEstacaoPorId,
  excluirEstacaoPorId,
} from './estacaoRepository.js';

export const TIPOS_ESTACAO = Object.freeze(['AGUAS', 'TRANSICAO', 'SECA']);

const ENTIDADE = 'CadEstacao';
/** Largura das colunas VARCHAR (em caracteres, como o PostgreSQL conta). */
const LARGURA = Object.freeze({ nome: 120, observacoes: 2000 });
const ANO_MINIMO = 1900;
const ANO_MAXIMO = 2100;

/** @param {Date|string|null|undefined} valor */
const diaIso = (valor) => {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return typeof valor === 'string' ? valor.slice(0, 10) : null;
};

/** @param {Record<string, unknown>} registro */
export const comoEstacaoPublica = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  nome: registro.nome,
  tipo: registro.tipo,
  data_inicio: diaIso(/** @type {Date} */ (registro.data_inicio)),
  data_fim: diaIso(/** @type {Date} */ (registro.data_fim)),
  observacoes: registro.observacoes ?? null,
  ativo: registro.ativo,
  created_date: registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date: registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

/**
 * Dia civil `AAAA-MM-DD` que existe no calendário (31/02 é recusado) e cabe na
 * faixa de anos aceita. Devolve a meia-noite UTC daquele dia, que é como o
 * Prisma grava `@db.Date` sem deslocar o dia.
 * @param {unknown} valor
 * @param {string} campo
 */
const diaDoCorpo = (valor, campo) => {
  if (valor === undefined) return undefined;
  const m = typeof valor === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor) : null;
  if (!m) throw invalido(`${campo} deve ser uma data AAAA-MM-DD`, { field: campo });
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  const real = d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
  if (!real) throw invalido(`${campo} não é um dia do calendário`, { field: campo });
  if (ano < ANO_MINIMO || ano > ANO_MAXIMO) {
    throw invalido(`${campo} fora da faixa de anos aceita (${ANO_MINIMO}–${ANO_MAXIMO})`, { field: campo });
  }
  return d;
};

/** @param {unknown} valor */
const tipoDoCorpo = (valor) => {
  if (valor === undefined) return undefined;
  if (typeof valor !== 'string' || !TIPOS_ESTACAO.includes(valor)) {
    throw invalido(`tipo deve ser um de: ${TIPOS_ESTACAO.join(', ')}`, { field: 'tipo' });
  }
  return valor;
};

/**
 * O schema da rota limita o texto ANTES das maiúsculas; algumas letras crescem
 * ao subir ('ß' → 'SS'), e o banco recusaria com P2000 (que viraria 500). Confere
 * de novo depois de normalizar, contando caracteres como o PostgreSQL.
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
 * Campos editáveis do corpo, já normalizados. `empresa_id` NÃO está aqui: é o
 * escopo, conferido à parte e nunca alterado por PATCH.
 * @param {Record<string, unknown>} entrada
 */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const campos = {};
  const nome = caberNaColuna(textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true }), 'nome');
  if (nome !== undefined) campos.nome = nome;
  const tipo = tipoDoCorpo(entrada.tipo);
  if (tipo !== undefined) campos.tipo = tipo;
  const inicio = diaDoCorpo(entrada.data_inicio, 'data_inicio');
  if (inicio !== undefined) campos.data_inicio = inicio;
  const fim = diaDoCorpo(entrada.data_fim, 'data_fim');
  if (fim !== undefined) campos.data_fim = fim;
  const observacoes = caberNaColuna(textoDoCorpo(entrada.observacoes, 'observacoes', { maiusculas: true }), 'observacoes');
  if (observacoes !== undefined) campos.observacoes = observacoes;
  if (entrada.ativo !== undefined) campos.ativo = Boolean(entrada.ativo);
  return campos;
};

/** @param {Date} inicio @param {Date} fim */
const exigirPeriodoCoerente = (inicio, fim) => {
  if (fim.getTime() < inicio.getTime()) {
    throw invalido('data_fim não pode ser anterior a data_inicio', { field: 'data_fim', reason: 'periodo_invertido' });
  }
};

/**
 * Sob a trava do escopo: nenhuma OUTRA estação ativa da fazenda encosta no
 * período. Só roda quando a estação resultante está ativa.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
const exigirSemSobreposicao = async (tx, clienteId, empresaId, inicio, fim, ignorarId) => {
  const outra = await buscarEstacaoAtivaSobreposta(tx, clienteId, empresaId, inicio, fim, ignorarId);
  if (outra) {
    throw estacaoPeriodoSobreposto(undefined, {
      details: {
        estacao_id: outra.id,
        nome: outra.nome,
        data_inicio: diaIso(outra.data_inicio),
        data_fim: diaIso(outra.data_fim),
      },
    });
  }
};

/** Trava das escritas de estações de UMA fazenda (tenant + empresa). */
const travarFazenda = (tx, clienteId, empresaId) => travarEscopo(tx, `estacoes:${clienteId}:${empresaId}`);

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
    if (ehViolacaoDeUnique(erro)) throw estacaoNomeConflito();
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
  const registros = await listarEstacoes(auth.clienteId, empresaId);
  return registros.map(comoEstacaoPublica);
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
  const registro = await buscarEstacao(auth.clienteId, empresaId, id);
  if (!registro) throw estacaoNotFound();
  return comoEstacaoPublica(registro);
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);
  if (!campos.tipo) throw invalido('tipo é obrigatório', { field: 'tipo' });
  if (!campos.data_inicio) throw invalido('data_inicio é obrigatório', { field: 'data_inicio' });
  if (!campos.data_fim) throw invalido('data_fim é obrigatório', { field: 'data_fim' });
  const inicio = /** @type {Date} */ (campos.data_inicio);
  const fim = /** @type {Date} */ (campos.data_fim);
  exigirPeriodoCoerente(inicio, fim);
  const ativo = campos.ativo === undefined ? true : Boolean(campos.ativo);

  return comConflitoDeNomeEstavel(() =>
    prisma.$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      await travarFazenda(tx, auth.clienteId, empresaId);

      if (await existeEstacaoComNome(tx, auth.clienteId, empresaId, String(campos.nome))) {
        throw estacaoNomeConflito();
      }
      if (ativo) await exigirSemSobreposicao(tx, auth.clienteId, empresaId, inicio, fim);

      const registro = await inserirEstacao(tx, {
        ...campos,
        ativo,
        cliente_id: auth.clienteId,
        empresa_id: empresaId,
      });
      const publico = comoEstacaoPublica(registro);

      await registrarEvento(
        contexto,
        { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: publico },
        tx
      );
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

      const anterior = await buscarEstacao(auth.clienteId, empresaId, id, tx);
      if (!anterior) throw estacaoNotFound();

      const inicio = /** @type {Date} */ (campos.data_inicio ?? anterior.data_inicio);
      const fim = /** @type {Date} */ (campos.data_fim ?? anterior.data_fim);
      exigirPeriodoCoerente(inicio, fim);
      const ativo = campos.ativo === undefined ? anterior.ativo : Boolean(campos.ativo);

      if (campos.nome !== undefined && campos.nome !== anterior.nome) {
        if (await existeEstacaoComNome(tx, auth.clienteId, empresaId, String(campos.nome), id)) {
          throw estacaoNomeConflito();
        }
      }
      if (ativo) await exigirSemSobreposicao(tx, auth.clienteId, empresaId, inicio, fim, id);

      const registro = Object.keys(campos).length ? await atualizarEstacaoPorId(tx, auth.clienteId, id, campos) : anterior;
      const publico = comoEstacaoPublica(registro);

      await registrarEvento(
        contexto,
        {
          acao: 'update',
          entidade: ENTIDADE,
          entidadeId: id,
          dadosAnteriores: comoEstacaoPublica(anterior),
          dadosNovos: publico,
        },
        tx
      );
      return publico;
    })
  );
};

/**
 * Exclusão física: nesta fatia nada referencia CADESTACOES (D-PROD-188).
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

    const anterior = await buscarEstacao(auth.clienteId, empresaId, id, tx);
    if (!anterior) throw estacaoNotFound();

    await excluirEstacaoPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: comoEstacaoPublica(anterior) },
      tx
    );
  });
};
