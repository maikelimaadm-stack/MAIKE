/**
 * D-PROD-145 — Parceiros (pessoa física ou jurídica com papéis múltiplos).
 *
 * Persistência: o model `Fornecedor` continua sendo a entidade canônica — mesmo
 * id, mesmo `numero_cadastro`, mesma tabela. Não existe tabela `Parceiro`: nada
 * a sincronizar, e `Lote.fornecedor_id`, `EstoqueLoteNota.fornecedor_id` e
 * `MovimentacaoEstoque.fornecedor_id` continuam válidos sem tocar nelas.
 *
 * Contrato:
 *  - tenant só da sessão; empresa validada no banco e imutável; leitura e escrita
 *    escopadas por tenant + empresa (outro tenant/empresa = 404, sem revelar);
 *  - DTO explícito (não o allowlist do DMMF): só os campos abaixo;
 *  - papéis normalizados em `tipos`, com aliases antigos; valores antigos
 *    desconhecidos são PRESERVADOS (devolvidos em `tipos_legados`);
 *  - CPF/CNPJ: dígitos verificadores validados quando o documento é novo ou
 *    muda; duplicata nova na mesma empresa → 409 (sob trava). Duplicatas
 *    históricas não são tocadas e continuam lidas;
 *  - sem exclusão: a tela inativa (`ativo=false`) e reativa;
 *  - auditoria minimizada: CPF mascarado, sem RG e sem data de nascimento.
 *  - `GET /fornecedores` (seletor do Cadastro de Lotes, projeção sem PII) não muda.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { decodificarCursor, normalizarLimite, montarEnvelopeKeyset, clausulaKeysetDesc } from '../../shared/pagination/keysetCursor.js';
import { mascararCpf } from '../fornecedores/fornecedorService.js';
import { exigirEmpresaDoTenant, invalido, iso, textoDoCorpo, travarEscopo } from './gestaoComum.js';

/** Mesma sequência do cadastro de Fornecedor: um só contador de código. */
export const ENTIDADE_SEQUENCIA = 'Fornecedor';

export const PAPEIS = Object.freeze(['fornecedor', 'cliente', 'prestador_servico', 'transportador', 'outros']);
export const TIPOS_PESSOA = Object.freeze(['Física', 'Jurídica']);

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s-]+/g, '_');
const ALIASES = Object.freeze({
  fornecedor: 'fornecedor', fornecedores: 'fornecedor',
  cliente: 'cliente', clientes: 'cliente', comprador: 'cliente',
  prestador_servico: 'prestador_servico', prestador_de_servico: 'prestador_servico', prestador_de_servicos: 'prestador_servico', prestador: 'prestador_servico', prestadora: 'prestador_servico', servicos: 'prestador_servico', servico: 'prestador_servico',
  transportador: 'transportador', transportadora: 'transportador', transportadores: 'transportador',
  outros: 'outros', outro: 'outros',
});

/** Separa os `tipos` gravados em papéis conhecidos e valores antigos preservados. */
export const lerPapeis = (tipos) => {
  const papeis = [];
  const legados = [];
  for (const bruto of Array.isArray(tipos) ? tipos : []) {
    if (typeof bruto !== 'string') continue;
    const canonico = ALIASES[semAcento(bruto)];
    if (canonico) {
      if (!papeis.includes(canonico)) papeis.push(canonico);
    } else if (!legados.includes(bruto)) {
      legados.push(bruto);
    }
  }
  return { papeis: PAPEIS.filter((p) => papeis.includes(p)), legados };
};

const digitos = (v) => String(v ?? '').replace(/\D/g, '');

export const cpfValido = (v) => {
  const d = digitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i += 1) soma += Number(base[i]) * (base.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(d.slice(0, 9)) === Number(d[9]) && dv(d.slice(0, 10)) === Number(d[10]);
};

export const cnpjValido = (v) => {
  const d = digitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + p * Number(base[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
};

/** Campos de texto opcionais do DTO, com o limite da coluna. */
const TEXTOS = Object.freeze({
  razao_social: 255, inscricao_estadual: 64, nome_responsavel: 255, rg: 32, telefone: 64, email: 255,
  endereco: 255, cidade: 128, codigo_ibge: 16, estado: 8, cep: 16, observacoes: 2000,
});

const naoEncontrado = () => new AppError('PARCEIRO_NOT_FOUND', 'parceiro não encontrado nesta empresa');

/** Forma pública para a tela de Parceiros (quem tem a tela vê o cadastro inteiro). */
export const comoParceiroPublico = (r) => {
  const { papeis, legados } = lerPapeis(r.tipos);
  return {
    id: r.id,
    empresa_id: r.empresa_id,
    numero_cadastro: r.numero_cadastro,
    tipo_pessoa: r.tipo_pessoa,
    nome: r.nome,
    razao_social: r.razao_social ?? null,
    cpf: r.cpf ?? null,
    cnpj: r.cnpj ?? null,
    rg: r.rg ?? null,
    data_nascimento: r.data_nascimento ? String(iso(r.data_nascimento)).slice(0, 10) : null,
    inscricao_estadual: r.inscricao_estadual ?? null,
    nome_responsavel: r.nome_responsavel ?? null,
    telefone: r.telefone ?? null,
    email: r.email ?? null,
    endereco: r.endereco ?? null,
    cidade: r.cidade ?? null,
    codigo_ibge: r.codigo_ibge ?? null,
    estado: r.estado ?? null,
    cep: r.cep ?? null,
    observacoes: r.observacoes ?? null,
    papeis,
    tipos_legados: legados,
    ativo: r.ativo,
    created_date: iso(r.createdAt),
    updated_date: iso(r.updatedAt),
  };
};

/** Auditoria minimizada: sem RG nem data de nascimento; CPF mascarado. */
const paraAuditoria = (r) => {
  const p = comoParceiroPublico(r);
  const { rg: _rg, data_nascimento: _dn, ...resto } = p; // eslint-disable-line no-unused-vars
  return { ...resto, cpf: mascararCpf(p.cpf) };
};

/** Normaliza o DTO (create ou patch). Só os campos presentes. */
const dadosDoCorpo = (entrada, { criacao }) => {
  /** @type {Record<string, any>} */
  const d = {};
  if (entrada.tipo_pessoa !== undefined || criacao) {
    if (!TIPOS_PESSOA.includes(entrada.tipo_pessoa)) throw invalido('tipo_pessoa deve ser Física ou Jurídica', { field: 'tipo_pessoa' });
    d.tipo_pessoa = entrada.tipo_pessoa;
  }
  if (entrada.nome !== undefined || criacao) d.nome = textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true });
  for (const [campo, max] of Object.entries(TEXTOS)) {
    if (entrada[campo] === undefined) continue;
    const t = textoDoCorpo(entrada[campo], campo);
    if (t && [...t].length > max) throw invalido(`${campo} excede ${max} caracteres`, { field: campo });
    d[campo] = t;
  }
  if (d.estado) d.estado = d.estado.toUpperCase();
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) throw invalido('e-mail inválido', { field: 'email' });
  for (const campo of ['cpf', 'cnpj']) {
    if (entrada[campo] === undefined) continue;
    const t = textoDoCorpo(entrada[campo], campo);
    if (t === null) { d[campo] = null; continue; }
    const ok = campo === 'cpf' ? cpfValido(t) : cnpjValido(t);
    if (!ok) throw new AppError('PARCEIRO_DOCUMENTO_INVALIDO', `${campo.toUpperCase()} inválido`, { details: { field: campo } });
    d[campo] = digitos(t); // gravado só com dígitos (o seletor do Lote mascara o CPF)
  }
  if (entrada.data_nascimento !== undefined) {
    if (entrada.data_nascimento === null || entrada.data_nascimento === '') d.data_nascimento = null;
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entrada.data_nascimento)) || Number.isNaN(Date.parse(`${entrada.data_nascimento}T00:00:00Z`))) {
      throw invalido('data_nascimento deve ser AAAA-MM-DD', { field: 'data_nascimento' });
    } else d.data_nascimento = new Date(`${entrada.data_nascimento}T00:00:00Z`);
  }
  if (entrada.ativo !== undefined) d.ativo = entrada.ativo === true;
  return d;
};

/** Duplicata NOVA do documento na empresa (compara só dígitos; inclui inativos). */
const exigirDocumentoLivre = async (tx, clienteId, empresaId, campo, valor, ignorarId = null) => {
  if (!valor) return;
  await travarEscopo(tx, `gestao:parceiro-doc:${clienteId}:${empresaId}:${campo}:${valor}`);
  const coluna = campo === 'cpf' ? 'cpf' : 'cnpj';
  const linhas = /** @type {Array<{ id: string, numero_cadastro: string }>} */ (
    coluna === 'cpf'
      ? await tx.$queryRaw`SELECT id, numero_cadastro FROM "Fornecedor" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND regexp_replace(coalesce(cpf, ''), '\\D', '', 'g') = ${valor} AND id <> ${ignorarId ?? ''} LIMIT 1`
      : await tx.$queryRaw`SELECT id, numero_cadastro FROM "Fornecedor" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = ${valor} AND id <> ${ignorarId ?? ''} LIMIT 1`
  );
  if (linhas.length) {
    throw new AppError('PARCEIRO_DOCUMENTO_DUPLICADO', `já existe parceiro com este ${coluna.toUpperCase()} nesta empresa`, {
      details: { field: coluna, numero_cadastro: linhas[0].numero_cadastro },
    });
  }
};

const papeisDoCorpo = (papeis) => {
  if (papeis === undefined) return undefined;
  if (!Array.isArray(papeis) || papeis.some((p) => !PAPEIS.includes(p))) throw invalido(`papeis aceita só ${PAPEIS.join(', ')}`, { field: 'papeis' });
  return PAPEIS.filter((p) => papeis.includes(p));
};

const buscar = (tx, clienteId, empresaId, id) => tx.fornecedor.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id } });

export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const limit = normalizarLimite(query.limit);
  const cursorBruto = typeof query.cursor === 'string' ? query.cursor : null;
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) throw invalido('cursor inválido', { field: 'cursor' });
  /** @type {Record<string, any>} */
  const where = { cliente_id: auth.clienteId, empresa_id: empresaId };
  if (query.ativo === 'true') where.ativo = true;
  if (query.ativo === 'false') where.ativo = false;
  /** @type {any[]} */
  const AND = [];
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) {
    const d = digitos(q);
    AND.push({
      OR: [
        { nome: { contains: q, mode: 'insensitive' } },
        { razao_social: { contains: q, mode: 'insensitive' } },
        { numero_cadastro: { contains: q } },
        ...(d.length >= 3 ? [{ cpf: { contains: d } }, { cnpj: { contains: d } }] : []),
      ],
    });
  }
  if (query.papel) {
    // aliases antigos gravados (ex.: "Fornecedor") também contam no filtro
    const nomes = Object.entries(ALIASES).filter(([, c]) => c === query.papel).map(([a]) => a);
    AND.push({ OR: [{ tipos: { has: query.papel } }, ...(query.papel === 'fornecedor' ? [{ tipos: { isEmpty: true } }] : []), ...nomes.map((n) => ({ tipos: { has: n } }))] });
  }
  const total = await prisma.fornecedor.count({ where: { ...where, ...(AND.length ? { AND } : {}) } });
  if (cursor) AND.push(clausulaKeysetDesc(cursor));
  const registros = await prisma.fornecedor.findMany({ where: { ...where, ...(AND.length ? { AND } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
  return montarEnvelopeKeyset({ registros, limit, total, mapItem: comoParceiroPublico });
};

export const detalhar = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const r = await buscar(prisma, auth.clienteId, empresaId, id);
  if (!r) throw naoEncontrado();
  return comoParceiroPublico(r);
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const dados = dadosDoCorpo(entrada, { criacao: true });
  const papeis = papeisDoCorpo(entrada.papeis) ?? [];
  return getPrismaClient().$transaction(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
    await exigirDocumentoLivre(tx, auth.clienteId, empresaId, 'cpf', dados.cpf);
    await exigirDocumentoLivre(tx, auth.clienteId, empresaId, 'cnpj', dados.cnpj);
    const numero = await reservarNumero(tx, { clienteId: auth.clienteId, entidade: ENTIDADE_SEQUENCIA, escopoTipo: ESCOPO_TENANT });
    const registro = await tx.fornecedor.create({
      data: /** @type {any} */ ({ ...dados, cliente_id: auth.clienteId, empresa_id: empresaId, numero_cadastro: String(numero), tipos: papeis }),
    });
    await registrarEvento(contexto, { acao: 'create', entidade: 'Fornecedor', entidadeId: registro.id, dadosNovos: { ...paraAuditoria(registro), via: 'parceiros' } }, tx);
    return comoParceiroPublico(registro);
  });
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const dados = dadosDoCorpo(entrada, { criacao: false });
  const papeis = papeisDoCorpo(entrada.papeis);
  return getPrismaClient().$transaction(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
    await tx.$queryRaw`SELECT id FROM "Fornecedor" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR UPDATE`;
    const antes = await buscar(tx, auth.clienteId, empresaId, id);
    if (!antes) throw naoEncontrado();
    if (dados.cpf !== undefined && dados.cpf !== digitos(antes.cpf)) await exigirDocumentoLivre(tx, auth.clienteId, empresaId, 'cpf', dados.cpf, id);
    if (dados.cnpj !== undefined && dados.cnpj !== digitos(antes.cnpj)) await exigirDocumentoLivre(tx, auth.clienteId, empresaId, 'cnpj', dados.cnpj, id);
    if (dados.cpf !== undefined && dados.cpf === digitos(antes.cpf)) delete dados.cpf; // mesmo documento (só formatação): não regrava
    if (dados.cnpj !== undefined && dados.cnpj === digitos(antes.cnpj)) delete dados.cnpj;
    if (papeis !== undefined) dados.tipos = [...papeis, ...lerPapeis(antes.tipos).legados]; // valores antigos desconhecidos ficam
    if (!Object.keys(dados).length) return comoParceiroPublico(antes);
    const depois = await tx.fornecedor.update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id } }, data: dados });
    await registrarEvento(
      contexto,
      { acao: 'update', entidade: 'Fornecedor', entidadeId: id, dadosAnteriores: paraAuditoria(antes), dadosNovos: { ...paraAuditoria(depois), via: 'parceiros', campos_alterados: Object.keys(dados) } },
      tx
    );
    return comoParceiroPublico(depois);
  });
};
