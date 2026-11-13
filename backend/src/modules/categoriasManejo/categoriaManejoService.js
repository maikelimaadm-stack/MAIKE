/**
 * Serviço de CategoriaManejo (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirSomenteColunasGravaveis } from '../../shared/prisma/colunasGravaveis.js';
import {
  FAIXAS_IDADE_CATEGORIA_MANEJO,
  faixaIdadeDaLista,
  sexoOficial,
} from '../movimentacoesMapa/categoriaOficialDerivada.js';
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
 * D-PROD-186 (MAIKE-CATEGORIA-MANEJO-ENXUGAR, Fatia C) e D-PROD-187
 * (MAIKE-CATEGORIA-MANEJO-CADCATEGORIA, Fatia D) — chaves que SAÍRAM do
 * contrato de CategoriaManejo. As 15 da Fatia C e, na Fatia D, o vínculo com o
 * ícone oficial (`catalogo_categoria_visual_id`, emenda do proprietário) já não
 * existem no banco (migration CONTRACT `20261113500000_categoria_manejo_cadcategoria`)
 * nem no Prisma Client, então o allowlist de `exigirSomenteColunasGravaveis` as
 * recusaria com 400. Mesmo padrão da D-PROD-181: para não quebrar cliente
 * antigo (aba aberta, fila offline), elas são retiradas do corpo AQUI, antes do
 * allowlist — 201/200, e nada delas é gravado nem devolvido. Lista fechada;
 * qualquer outra chave desconhecida continua 400.
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
  'catalogo_categoria_visual_id',
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

/** Rótulos das cinco faixas aceitas, para a mensagem de erro. */
const FAIXAS_ACEITAS = FAIXAS_IDADE_CATEGORIA_MANEJO.map((f) => f.rotulo).join(', ');

/**
 * @param {string} campo
 * @param {string} reason
 * @param {string} mensagem
 */
const campoInvalido = (campo, reason, mensagem) =>
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
      throw campoInvalido(campo, 'inteiro_nao_negativo', `${campo} deve ser um número inteiro de meses, maior ou igual a zero`);
    }
    valor = Number(limpo);
  }
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 0 || valor > IDADE_MAXIMA_ACEITA) {
    throw campoInvalido(campo, 'inteiro_nao_negativo', `${campo} deve ser um número inteiro de meses, maior ou igual a zero`);
  }
  return valor;
};

/** @param {Record<string, unknown>} obj @param {string} campo */
const tem = (obj, campo) => Object.prototype.hasOwnProperty.call(obj, campo);

/**
 * Faixa de idade (decisão do proprietário, 2026-11-13): o par
 * (`idade_minima_meses`, `idade_maxima_meses`) é EXATAMENTE uma das cinco
 * faixas fixas de `FAIXAS_IDADE_CATEGORIA_MANEJO`.
 *  - POST: obrigatória (`faixa_obrigatoria` sem nenhuma das duas; senão
 *    `faixa_fora_da_lista`).
 *  - PATCH: só quando o corpo traz alguma das duas chaves; o lado não enviado
 *    é o valor já gravado. Corpo sem chave de idade NUNCA é recusado por causa
 *    do par legado gravado (mesmo invertido ou fora da lista).
 * @param {Record<string, unknown>} dados
 * @param {Record<string, unknown> | null} existente `null` no POST
 * @returns {Record<string, unknown>}
 */
const validarFaixaIdade = (dados, existente) => {
  const enviou = CAMPOS_IDADE.some((campo) => tem(dados, campo));
  if (existente && !enviou) return dados;
  const saida = { ...dados };
  for (const campo of CAMPOS_IDADE) {
    if (tem(saida, campo)) saida[campo] = normalizarIdade(campo, saida[campo]);
  }
  /** @param {string} campo */
  const efetivo = (campo) => (tem(saida, campo) ? saida[campo] : (existente?.[campo] ?? null));
  const minima = efetivo('idade_minima_meses');
  const maxima = efetivo('idade_maxima_meses');
  if (!existente && minima === null && maxima === null) {
    throw campoInvalido('idade_minima_meses', 'faixa_obrigatoria', `a faixa de idade é obrigatória: ${FAIXAS_ACEITAS}`);
  }
  if (!faixaIdadeDaLista(minima, maxima)) {
    throw campoInvalido('idade_minima_meses', 'faixa_fora_da_lista', `a faixa de idade deve ser uma destas: ${FAIXAS_ACEITAS}`);
  }
  return saida;
};

/** Grafia gravada de cada sexo aceito. */
const SEXO_GRAVADO = Object.freeze({ MACHO: 'Macho', FEMEA: 'Fêmea' });

/**
 * Sexo (decisão do proprietário, 2026-11-13): Macho ou Fêmea, gravado nessa
 * grafia ('MACHO', 'femea' etc. são aceitos e normalizados).
 *  - POST: obrigatório.
 *  - PATCH: só quando o corpo traz `sexo`; aí não pode ser vazio nem outro valor.
 * @param {Record<string, unknown>} dados
 * @param {boolean} criando
 * @returns {Record<string, unknown>}
 */
const validarSexo = (dados, criando) => {
  if (!criando && !tem(dados, 'sexo')) return dados;
  const valor = dados.sexo;
  if (valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')) {
    throw campoInvalido('sexo', 'sexo_obrigatorio', 'o sexo é obrigatório: Macho ou Fêmea');
  }
  const sexo = typeof valor === 'string' ? sexoOficial(valor) : null;
  if (!sexo) throw campoInvalido('sexo', 'sexo_invalido', 'o sexo deve ser Macho ou Fêmea');
  return { ...dados, sexo: SEXO_GRAVADO[sexo] };
};

/**
 * Saída pública (resposta e auditoria) com lista EXPLÍCITA de campos
 * (D-PROD-186/D-PROD-187): o tenant não sai, e nenhum campo fora do contrato
 * sai, mesmo que alguém passe aqui uma linha lida sem a seleção do repositório.
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
    const dados = {
      ...validarFaixaIdade(validarSexo(colunasDoCorpo(entrada), true), null),
      cliente_id: auth.clienteId,
    };

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
    const dados = validarFaixaIdade(validarSexo(colunasDoCorpo(entrada), false), existente);
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
