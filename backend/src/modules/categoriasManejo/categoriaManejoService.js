/**
 * Serviço de CategoriaManejo (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError, catalogoGlobalInvalid } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirSomenteColunasGravaveis } from '../../shared/prisma/colunasGravaveis.js';
import { exigirCategoriaVisualLoteVinculavel } from '../catalogoGlobal/catalogoValidacao.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './categoriaManejoRepository.js';



const erroNaoEncontrado = () => new AppError('CATEGORIA_MANEJO_NOT_FOUND', 'CategoriaManejo não encontrado');

const ENTIDADE = 'CategoriaManejo';

/**
 * D-PROD-185 (MAIKE-CATEGORIA-MANEJO-ENXUGAR, Fatia C) — chaves que SAÍRAM do
 * contrato de CategoriaManejo. As colunas ainda existem no banco (o DROP é a
 * Fatia D, migration CONTRACT isolada), então o allowlist de
 * `exigirSomenteColunasGravaveis` ainda as aceitaria: por isso são retiradas
 * do corpo AQUI, antes dele. Mesmo padrão da D-PROD-181: cliente antigo (aba
 * aberta, fila offline) que ainda as envia recebe 201/200, e nada delas é
 * gravado nem devolvido. Lista fechada; qualquer outra chave desconhecida
 * continua 400.
 */
export const CHAVES_LEGADAS_IGNORADAS = Object.freeze([
  'raca',
  'categoria_oficial',
  'ganho_peso_anual_kg',
  'gmd_janeiro',
  'gmd_fevereiro',
  'gmd_marco',
  'gmd_abril',
  'gmd_maio',
  'gmd_junho',
  'gmd_julho',
  'gmd_agosto',
  'gmd_setembro',
  'gmd_outubro',
  'gmd_novembro',
  'gmd_dezembro',
]);

const LEGADAS = new Set(CHAVES_LEGADAS_IGNORADAS);

/**
 * Tira as chaves legadas e só então aplica o allowlist de colunas.
 * @param {unknown} entrada
 * @returns {Record<string, unknown>}
 */
const colunasDoCorpo = (entrada) => {
  const corpo =
    entrada && typeof entrada === 'object' && !Array.isArray(entrada)
      ? Object.fromEntries(Object.entries(entrada).filter(([chave]) => !LEGADAS.has(chave)))
      : entrada;
  return exigirSomenteColunasGravaveis(ENTIDADE, corpo);
};

const CAMPOS_IDADE = /** @type {const} */ (['idade_minima_meses', 'idade_maxima_meses']);
/** Teto do INT4 do Postgres: acima disso o Prisma estouraria (500). */
const IDADE_MAXIMA_ACEITA = 2_147_483_647;

/**
 * @param {string} campo
 * @param {string} reason
 * @param {string} mensagem
 */
const idadeInvalida = (campo, reason, mensagem) =>
  new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details: { entidade: ENTIDADE, field: campo, reason } });

/**
 * Normaliza uma idade em meses: `null`/'' → null; inteiro ≥ 0 (número ou
 * texto só com dígitos) → número; o resto → 400.
 * @param {string} campo
 * @param {unknown} valor
 * @returns {number | null}
 */
const normalizarIdade = (campo, valor) => {
  if (valor === null) return null;
  if (typeof valor === 'string') {
    const limpo = valor.trim();
    if (limpo === '') return null;
    if (!/^\d+$/.test(limpo)) {
      throw idadeInvalida(campo, 'inteiro_nao_negativo', `${campo} deve ser um número inteiro de meses, maior ou igual a zero`);
    }
    valor = Number(limpo);
  }
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 0 || valor > IDADE_MAXIMA_ACEITA) {
    throw idadeInvalida(campo, 'inteiro_nao_negativo', `${campo} deve ser um número inteiro de meses, maior ou igual a zero`);
  }
  return valor;
};

/**
 * Idades opcionais; com as duas presentes, mínima ≤ máxima. Na edição, o lado
 * não enviado é o valor já gravado.
 * @param {Record<string, unknown>} dados
 * @param {Record<string, unknown> | null} [existente]
 * @returns {Record<string, unknown>}
 */
const validarIdades = (dados, existente = null) => {
  const saida = { ...dados };
  for (const campo of CAMPOS_IDADE) {
    if (Object.prototype.hasOwnProperty.call(saida, campo)) saida[campo] = normalizarIdade(campo, saida[campo]);
  }
  /** @param {string} campo */
  const efetivo = (campo) =>
    Object.prototype.hasOwnProperty.call(saida, campo) ? saida[campo] : (existente?.[campo] ?? null);
  const minima = efetivo('idade_minima_meses');
  const maxima = efetivo('idade_maxima_meses');
  if (typeof minima === 'number' && typeof maxima === 'number' && minima > maxima) {
    throw idadeInvalida(
      'idade_minima_meses',
      'idade_minima_maior_que_maxima',
      'a idade mínima não pode ser maior que a idade máxima'
    );
  }
  return saida;
};

const CAMPO_VINCULO = 'catalogo_categoria_visual_id';

/**
 * Normaliza e valida o vínculo opcional com a categoria visual global
 * (D-PROD-69). Ausente no corpo → não mexe; `null`/'' → remove o vínculo;
 * id → só categoria ativa do tipo oficial `lote`. O tenant escolhe a
 * categoria; o ícone continua sendo do catálogo global.
 *
 * Na edição, reenviar o MESMO vínculo já gravado não revalida: se a categoria
 * oficial foi desativada depois, o cadastro antigo continua editável.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Record<string, unknown>} dados
 * @param {Record<string, unknown> | null} [existente]
 */
const validarVinculoCatalogo = async (tx, dados, existente = null) => {
  if (!Object.prototype.hasOwnProperty.call(dados, CAMPO_VINCULO)) return dados;
  const valor = dados[CAMPO_VINCULO];
  if (valor === null || valor === '') return { ...dados, [CAMPO_VINCULO]: null };
  if (typeof valor !== 'string' || valor.length > 64) {
    throw catalogoGlobalInvalid('identificador de categoria oficial inválido', { campo: CAMPO_VINCULO });
  }
  if (existente && existente[CAMPO_VINCULO] === valor) return dados;
  await exigirCategoriaVisualLoteVinculavel(tx, valor);
  return dados;
};

/**
 * Saída pública (resposta e auditoria) com lista EXPLÍCITA de campos
 * (D-PROD-185): o tenant não sai, e as colunas dormentes também não, mesmo
 * que alguém passe aqui uma linha lida sem a seleção do repositório.
 * @param {Record<string, unknown>} registro
 */
export const comoPublico = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  nome: registro.nome,
  sigla: registro.sigla ?? null,
  especie: registro.especie ?? null,
  sexo: registro.sexo ?? null,
  idade_minima_meses: registro.idade_minima_meses ?? null,
  idade_maxima_meses: registro.idade_maxima_meses ?? null,
  catalogo_categoria_visual_id: registro.catalogo_categoria_visual_id ?? null,
  ativo: registro.ativo,
  created_date: registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date: registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarRegistros(auth.clienteId, filtros);
  return registros.map(comoPublico);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    /** @type {Record<string, unknown>} */
    const dados = await validarVinculoCatalogo(tx, { ...validarIdades(colunasDoCorpo(entrada)), cliente_id: auth.clienteId });

    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'CategoriaManejo', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
      tx
    );
    return registro;
  });
  return comoPublico(criado);
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atualizado = await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    const dados = await validarVinculoCatalogo(tx, validarIdades(colunasDoCorpo(entrada), existente), existente);
    // Corpo só com chaves legadas (ou só ecos do servidor): nada a gravar.
    // Mesmo desenho da D-PROD-181 — não toca a linha (nem `updatedAt`) e a
    // auditoria registra a edição com antes = depois.
    const registro = Object.keys(dados).length
      ? await atualizarRegistroPorId(tx, auth.clienteId, id, dados)
      : existente;
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'CategoriaManejo',
        entidadeId: id,
        dadosAnteriores: comoPublico(existente),
        dadosNovos: comoPublico(registro),
      },
      tx
    );
    return registro;
  });
  return comoPublico(atualizado);
};

export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: 'CategoriaManejo', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx
    );
  });
};
