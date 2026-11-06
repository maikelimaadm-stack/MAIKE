/**
 * Serviço de Empresa (P5.4 + EMPRESA-NUM-01).
 */
import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { carregarAutorizacao, telaPermite, TELAS } from '../../shared/auth/autorizacaoTela.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './empresaRepository.js';
import { reservarNumeroEmpresa } from './empresaSequencia.js';
import { ativarEmpresaNaTransacao } from '../rebanhoLedger/rebanhoLedgerService.js';
import { erroNomeConflitoEmpresa, lancarSeP2002Empresa } from './empresaUniqueViolation.js';
import { exigirAdminTenant } from '../../shared/auth/exigirAdminTenant.js';
import { normalizarFusoIana } from '../rebanhoLedger/rebanhoLedgerTempo.js';

const CAMPOS_GRAVAVEIS = Object.freeze([
  'apelido',
  'nome',
  'tipo_pessoa',
  'cpf',
  'rg',
  'cnpj',
  'inscricao_estadual',
  'telefone',
  'email',
  'endereco',
  'cidade',
  'estado',
  'cep',
  'logotipo_url',
  'observacoes',
]);

const erroNaoEncontrado = () => new AppError('EMPRESA_NOT_FOUND', 'Empresa não encontrado');
const erroNomeConflito = erroNomeConflitoEmpresa;
const erroCampoImutavel = (campo) =>
  new AppError('REQUEST_VALIDATION_FAILED', `Campo não permitido na escrita: ${campo}`);

/** @param {Record<string, unknown>} entrada */
const rejeitarCamposProibidos = (entrada) => {
  if (!entrada || typeof entrada !== 'object') return;
  if ('numero_empresa' in entrada) throw erroCampoImutavel('numero_empresa');
  if ('cliente_id' in entrada) throw erroCampoImutavel('cliente_id');
  if ('id' in entrada) throw erroCampoImutavel('id');
};

/** @param {Record<string, unknown>} entrada */
const normalizarEntrada = (entrada) => {
  rejeitarCamposProibidos(entrada);
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const campo of CAMPOS_GRAVAVEIS) {
    if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
    let valor = entrada[campo];
    if (campo === 'nome' || campo === 'apelido') {
      valor = typeof valor === 'string' ? valor.trim().toUpperCase() : valor;
    }
    if (
      ['cpf', 'rg', 'cnpj', 'inscricao_estadual', 'telefone', 'email', 'endereco', 'cidade', 'estado', 'cep', 'logotipo_url', 'observacoes'].includes(
        campo,
      ) &&
      (valor === '' || valor === undefined)
    ) {
      valor = null;
    }
    saida[campo] = valor;
  }
  return saida;
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} clienteId @param {string} nome @param {string|null} ignorarId */
const existeNome = async (tx, clienteId, nome, ignorarId = null) => {
  const alvo = typeof nome === 'string' ? nome.trim().toUpperCase() : '';
  if (!alvo) return false;
  const registros = await tx.empresa.findMany({
    where: { cliente_id: clienteId },
    select: { id: true, nome: true },
  });
  return registros.some(
    (r) => r.id !== ignorarId && String(r.nome || '').trim().toUpperCase() === alvo,
  );
};

/** @param {Record<string, unknown>} registro */
export const comoPublico = (registro) => {
  // eslint-disable-next-line no-unused-vars -- tenant não exposto na API pública
  const { createdAt, updatedAt, cliente_id, ...resto } = registro;
  return {
    ...resto,
    created_date: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    updated_date: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
};

/**
 * D-PROD-136 (GET-01) — o que o seletor de empresa do Layout, o mapa e os
 * formulários de TODO usuário leem da empresa. ALLOWLIST (não denylist): coluna
 * nova no schema não vaza sozinha para quem não abre a tela Empresa.
 * Consumidores: Layout.jsx (apelido/nome/cidade/estado/cnpj no seletor e no
 * "Trocar empresa"), FichaProduto (logotipo/nome/cidade/estado) e o fuso da
 * fazenda (D-PROD-122).
 */
const CAMPOS_RESUMO = Object.freeze([
  'id', 'numero_empresa', 'apelido', 'nome', 'tipo_pessoa', 'cidade', 'estado', 'logotipo_url', 'fuso_horario',
]);

/** Empresa pessoa física: o "CNPJ" não existe e o campo nunca vai no resumo. */
const ehPessoaFisica = (registro) => String(registro?.tipo_pessoa ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'fisica';

/**
 * @param {Record<string, unknown>} registro
 * @param {{ endereco?: boolean }} [opcoes] `endereco` só para quem abre a Ficha do Produto
 */
export const comoResumo = (registro, opcoes = {}) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const campo of CAMPOS_RESUMO) saida[campo] = registro[campo] ?? null;
  if (!ehPessoaFisica(registro)) saida.cnpj = registro.cnpj ?? null;
  if (opcoes.endereco) saida.endereco = registro.endereco ?? null;
  const { createdAt, updatedAt } = registro;
  saida.created_date = createdAt instanceof Date ? createdAt.toISOString() : createdAt;
  saida.updated_date = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
  return saida;
};

/**
 * GET /empresas fica SEM guarda de tela (o Layout de todo usuário depende dela:
 * 403 ou lista vazia fazem o Layout gravar o tenant como empresa e o mapa fica
 * vazio). A proteção é a PROJEÇÃO, decidida no servidor (D-PROD-136, GET-01):
 *  - tela Empresa (adm-empresa visualizar; admin real e `is_admin` passam) →
 *    registro completo (CPF, RG, IE, contato, endereço, observações);
 *  - os demais → `comoResumo`, sem dado pessoal; `endereco` só com a tela de
 *    Produtos (cabeçalho da Ficha do Produto).
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  void filtros;
  const [registros, aut] = await Promise.all([listarRegistros(auth.clienteId), carregarAutorizacao(contexto)]);
  if (telaPermite(aut, TELAS.EMPRESA, 'visualizar')) return registros.map(comoPublico);
  const endereco = telaPermite(aut, TELAS.PRODUTOS, 'visualizar');
  return registros.map((r) => comoResumo(r, { endereco }));
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const dados = normalizarEntrada(/** @type {Record<string, unknown>} */ (entrada ?? {}));
  if (entrada && Object.prototype.hasOwnProperty.call(entrada, 'fuso_horario')) {
    const fuso = normalizarFusoIana(/** @type {any} */ (entrada).fuso_horario);
    if (!fuso) throw new AppError('EMPRESA_FUSO_INVALIDO', 'fuso_horario deve ser um nome IANA válido (ex.: America/Cuiaba)', { details: { field: 'fuso_horario' } });
    dados.fuso_horario = fuso;
  }
  const prisma = getPrismaClient();

  try {
    const criado = await prisma.$transaction(async (tx) => {
      if (await existeNome(tx, auth.clienteId, String(dados.nome ?? ''))) {
        throw erroNomeConflito();
      }

      const numero = await reservarNumeroEmpresa(tx, auth.clienteId);
      const registro = await inserirRegistro(tx, {
        ...dados,
        cliente_id: auth.clienteId,
        numero_empresa: numero,
      });
      await registrarEvento(
        contexto,
        { acao: 'create', entidade: 'Empresa', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
        tx,
      );
      // PR174-R5 (D-PROD-107): empresa nova nasce no controle por posições — sem
      // histórico, a ativação pelas entradas não tem conflito; nunca existe
      // "empresa nova no modelo legado" (Lote nunca recebe manejo).
      await ativarEmpresaNaTransacao(tx, contexto, { empresaId: registro.id, modo: 'entradas', dataCorte: null });
      return registro;
    });
    return comoPublico(criado);
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    lancarSeP2002Empresa(erro);
    throw erro;
  }
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const dados = normalizarEntrada(/** @type {Record<string, unknown>} */ (entrada ?? {}));
  const prisma = getPrismaClient();

  try {
    const atualizado = await prisma.$transaction(async (tx) => {
      const existente = await buscarRegistro(auth.clienteId, id, tx);
      if (!existente) throw erroNaoEncontrado();
      if (dados.nome && (await existeNome(tx, auth.clienteId, String(dados.nome), id))) {
        throw erroNomeConflito();
      }
      const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, { ...dados });
      await registrarEvento(
        contexto,
        {
          acao: 'update',
          entidade: 'Empresa',
          entidadeId: id,
          dadosAnteriores: comoPublico(existente),
          dadosNovos: comoPublico(registro),
        },
        tx,
      );
      return registro;
    });
    return comoPublico(atualizado);
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    lancarSeP2002Empresa(erro);
    throw erro;
  }
};

/**
 * D-PROD-122 (S1/H1) — configura o fuso IANA da fazenda (define o "hoje" do
 * ledger do rebanho). Só administrador ativo do tenant; empresa travada; troca
 * de um fuso já configurado exige motivo e fica na auditoria (anterior/novo).
 * Não reescreve nenhuma data já gravada. Mesmo valor = nada muda.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {Record<string, unknown>} entrada
 */
export const configurarFusoHorario = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const fuso = normalizarFusoIana(entrada?.fuso_horario);
  const motivo = typeof entrada?.motivo === 'string' && entrada.motivo.trim() ? entrada.motivo.trim() : null;
  const prisma = getPrismaClient();
  const registro = await prisma.$transaction(async (tx) => {
    await exigirAdminTenant(contexto, tx);
    if (!fuso) {
      throw new AppError('EMPRESA_FUSO_INVALIDO', 'fuso_horario deve ser um nome IANA válido (ex.: America/Cuiaba)', { details: { field: 'fuso_horario' } });
    }
    const [travada] = /** @type {Array<{id: string}>} */ (await tx.$queryRaw`SELECT id FROM "Empresa" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR UPDATE`);
    if (!travada) throw erroNaoEncontrado();
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    if (existente.fuso_horario === fuso) return existente;
    if (existente.fuso_horario && !motivo) {
      throw new AppError('REQUEST_VALIDATION_FAILED', 'trocar um fuso já configurado exige motivo', { details: { field: 'motivo', reason: 'required' } });
    }
    const atualizado = await atualizarRegistroPorId(tx, auth.clienteId, id, { fuso_horario: fuso });
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Empresa',
        entidadeId: id,
        dadosAnteriores: { fuso_horario: existente.fuso_horario ?? null },
        dadosNovos: { fuso_horario: fuso, motivo, operacao: 'configurar_fuso_horario' },
      },
      tx,
    );
    return atualizado;
  });
  return comoPublico(registro);
};

/**
 * D-PROD-136 (EMP-01) — models que pertencem a uma empresa: todo model do
 * schema com `cliente_id` E `empresa_id` escalares, derivado de `Prisma.dmmf`
 * (model novo entra sozinho; a lista do frontend era da era Base44 e faltava
 * metade). Só uns poucos têm FK para Empresa; os demais guardam `empresa_id`
 * solto e ficariam ÓRFÃOS — fora de toda tela, sem como reatribuir.
 * `RebanhoLedgerAtivacao` fica de fora: a empresa nasce ativada e a ativação
 * vazia sai junto (PR174-R5).
 */
const MODELOS_DA_EMPRESA = Object.freeze(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.name !== 'Empresa' && m.name !== 'RebanhoLedgerAtivacao')
    .filter((m) => ['cliente_id', 'empresa_id'].every((c) => m.fields.some((f) => f.name === c && f.kind === 'scalar')))
    .map((m) => m.name)
    .sort()
);

/** @param {string} modelo */
const delegadoDe = (modelo) => modelo.charAt(0).toLowerCase() + modelo.slice(1);

/**
 * Contagem dos dependentes da empresa, por model (só os que têm registro).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId @param {string} empresaId
 */
const vinculosDaEmpresa = async (tx, clienteId, empresaId) => {
  const vinculos = [];
  for (const entidade of MODELOS_DA_EMPRESA) {
    const total = await /** @type {any} */ (tx)[delegadoDe(entidade)].count({ where: { cliente_id: clienteId, empresa_id: empresaId } });
    if (total > 0) vinculos.push({ entidade, total });
  }
  return vinculos;
};

export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    // Trava a empresa (o mesmo padrão do fuso e da ativação do ledger): quem cria
    // fato do rebanho lê a empresa com FOR SHARE/UPDATE e espera esta exclusão.
    const [travada] = /** @type {Array<{id: string}>} */ (await tx.$queryRaw`SELECT id FROM "Empresa" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR UPDATE`);
    if (!travada) throw erroNaoEncontrado();
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    // EMP-01: com qualquer dependente, NADA é apagado — 409 com a contagem (antes:
    // 204 e setores/áreas/cochos/produtos/tarefas órfãos; com fato do rebanho, a
    // FK devolvia o enganoso 403 TENANT_SCOPE_VIOLATION).
    const vinculos = await vinculosDaEmpresa(tx, auth.clienteId, id);
    if (vinculos.length) {
      throw new AppError('EMPRESA_COM_VINCULOS', 'a empresa tem registros vinculados e não pode ser excluída', { details: { vinculos } });
    }
    // PR174-R5: a empresa nasce ativada no ledger; sem nenhum dependente (nem fato
    // do rebanho), a ativação vazia não é dado — sai junto.
    await tx.rebanhoLedgerAtivacao.deleteMany({ where: { cliente_id: auth.clienteId, empresa_id: id } });
    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: 'Empresa', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx,
    );
  });
};
