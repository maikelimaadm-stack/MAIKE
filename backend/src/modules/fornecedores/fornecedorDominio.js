/**
 * D-PROD-146 (R2) — regras de domínio do Fornecedor/Parceiro compartilhadas pelas
 * duas superfícies que escrevem a tabela `Fornecedor` (`/parceiros` e o CRUD
 * administrativo legado `/fornecedores`).
 *
 * Existe para as duas superfícies aplicarem EXATAMENTE a mesma regra e para
 * desfazer o ciclo de imports `fornecedorService` ↔ `parceiroService`: este
 * módulo não importa nenhum dos dois.
 *
 * Conteúdo:
 *  - funções puras de documento (dígitos, DV de CPF/CNPJ, máscara de CPF);
 *  - vocabulário de papéis com aliases históricos e a regra "é fornecedor";
 *  - projeção de AUDITORIA por allowlist positiva (sem PII);
 *  - a guarda transacional de documento (validade + duplicata na empresa).
 */

import { AppError } from '../../shared/errors/AppError.js';
import { travarEscopo } from '../gestao/gestaoComum.js';

/** @param {unknown} v */
export const digitos = (v) => String(v ?? '').replace(/\D/g, '');

/** @param {unknown} v */
export const cpfValido = (v) => {
  const d = digitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  /** @param {string} base */
  const dv = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i += 1) soma += Number(base[i]) * (base.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(d.slice(0, 9)) === Number(d[9]) && dv(d.slice(0, 10)) === Number(d[10]);
};

/** @param {unknown} v */
export const cnpjValido = (v) => {
  const d = digitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  /** @param {string} base */
  const dv = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + p * Number(base[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
};

/**
 * CPF de terceiro mascarado no padrão usual (`***.456.789-**`): a busca do
 * seletor de Lotes ainda casa pelos dígitos do meio, e o número completo não
 * sai. Formato inesperado → nada (falha fechada).
 * @param {unknown} cpf
 */
export const mascararCpf = (cpf) => {
  const d = digitos(cpf);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : null;
};

export const PAPEIS = Object.freeze(['fornecedor', 'cliente', 'prestador_servico', 'transportador', 'outros']);

/** @param {string} s */
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s-]+/g, '_');
/** @type {Readonly<Record<string, string>>} */
const ALIASES = Object.freeze({
  fornecedor: 'fornecedor', fornecedores: 'fornecedor',
  cliente: 'cliente', clientes: 'cliente', comprador: 'cliente',
  prestador_servico: 'prestador_servico', prestador_de_servico: 'prestador_servico', prestador_de_servicos: 'prestador_servico', prestador: 'prestador_servico', prestadora: 'prestador_servico', servicos: 'prestador_servico', servico: 'prestador_servico',
  transportador: 'transportador', transportadora: 'transportador', transportadores: 'transportador',
  outros: 'outros', outro: 'outros',
});

/** Grafias antigas aceitas para um papel canônico (filtro de listagem). @param {string} papel */
export const aliasesDoPapel = (papel) => Object.entries(ALIASES).filter(([, c]) => c === papel).map(([a]) => a);

/**
 * Separa os `tipos` gravados em papéis conhecidos e valores antigos preservados.
 * @param {unknown} tipos
 */
export const lerPapeis = (tipos) => {
  /** @type {string[]} */
  const papeis = [];
  /** @type {string[]} */
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

/**
 * Pode ser oferecido/associado como FORNECEDOR de compra (Cadastro de Lotes)?
 * Papel `fornecedor` (com aliases históricos) ou, SÓ por retrocompatibilidade do
 * cadastro antigo, `tipos` vazio. Parceiro novo sempre tem papel (a API exige),
 * então `tipos=[]` só existe em registro histórico.
 * @param {unknown} tipos
 */
export const temPapelFornecedor = (tipos) => {
  if (!Array.isArray(tipos) || tipos.length === 0) return true;
  return lerPapeis(tipos).papeis.includes('fornecedor');
};

/**
 * Projeção de AUDITORIA por allowlist positiva (B1/R2): só identificadores
 * internos, empresa, número, tipo de pessoa, situação e papéis canônicos.
 * Nenhum documento (CPF/CNPJ/RG/IE), contato, endereço, nome, nascimento,
 * observação ou texto livre — nem mascarado. `id` + `numero_cadastro` bastam
 * para rastrear; o cadastro vivo responde o resto a quem tem permissão.
 * Valores legados desconhecidos de `tipos` podem ser texto livre: só a contagem.
 * @param {Record<string, any>} r registro do banco
 */
export const comoAuditoriaFornecedor = (r) => {
  const { papeis, legados } = lerPapeis(r?.tipos);
  return {
    id: r?.id ?? null,
    empresa_id: r?.empresa_id ?? null,
    numero_cadastro: r?.numero_cadastro ?? null,
    tipo_pessoa: r?.tipo_pessoa === 'Física' || r?.tipo_pessoa === 'Jurídica' ? r.tipo_pessoa : null,
    ativo: typeof r?.ativo === 'boolean' ? r.ativo : null,
    papeis,
    tipos_legados_qtd: legados.length,
  };
};

/** Colunas cujo NOME pode aparecer em `campos_alterados` (o valor nunca aparece). */
const COLUNAS_AUDITAVEIS = Object.freeze([
  'empresa_id', 'numero_cadastro', 'tipo_pessoa', 'nome', 'razao_social', 'cpf', 'cnpj', 'rg', 'data_nascimento',
  'inscricao_estadual', 'nome_responsavel', 'telefone', 'email', 'endereco', 'cidade', 'codigo_ibge', 'estado', 'cep',
  'observacoes', 'tipos', 'ativo',
]);

/**
 * Nomes das colunas efetivamente alteradas (só nomes conhecidos; chave
 * desconhecida não vira metadado).
 * @param {Record<string, any>} antes
 * @param {Record<string, any>} depois
 */
export const camposAlterados = (antes, depois) =>
  COLUNAS_AUDITAVEIS.filter((c) => JSON.stringify(antes?.[c] ?? null) !== JSON.stringify(depois?.[c] ?? null));

/**
 * Duplicata NOVA do documento na empresa (compara só dígitos; inclui inativos),
 * sob trava por tenant+empresa+documento.
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {'cpf'|'cnpj'} campo
 * @param {string} valor só dígitos
 * @param {string|null} [ignorarId]
 */
export const exigirDocumentoLivre = async (tx, clienteId, empresaId, campo, valor, ignorarId = null) => {
  if (!valor) return;
  await travarEscopo(tx, `gestao:parceiro-doc:${clienteId}:${empresaId}:${campo}:${valor}`);
  const linhas = /** @type {Array<{ id: string, numero_cadastro: string }>} */ (
    campo === 'cpf'
      ? await tx.$queryRaw`SELECT id, numero_cadastro FROM "Fornecedor" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND regexp_replace(coalesce(cpf, ''), '\\D', '', 'g') = ${valor} AND id <> ${ignorarId ?? ''} LIMIT 1`
      : await tx.$queryRaw`SELECT id, numero_cadastro FROM "Fornecedor" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = ${valor} AND id <> ${ignorarId ?? ''} LIMIT 1`
  );
  if (linhas.length) {
    throw new AppError('PARCEIRO_DOCUMENTO_DUPLICADO', `já existe parceiro com este ${campo.toUpperCase()} nesta empresa`, {
      details: { field: campo, numero_cadastro: linhas[0].numero_cadastro },
    });
  }
};

/**
 * Regra de documento das rotas antigas de `/fornecedores`: dígitos verificadores
 * e unicidade por empresa (mesma trava das Parceiros) quando o CPF/CNPJ é novo
 * ou muda. Documento histórico igual ao gravado não é revalidado. O valor
 * gravado continua o que a rota antiga recebeu.
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} empresaId empresa JÁ validada no tenant
 * @param {Record<string, unknown>} entrada
 * @param {Record<string, any>|null} [antes]
 */
export const exigirDocumentosDoLegado = async (tx, clienteId, empresaId, entrada, antes = null) => {
  for (const campo of /** @type {const} */ (['cpf', 'cnpj'])) {
    if (entrada?.[campo] === undefined || entrada[campo] === null) continue;
    const d = digitos(entrada[campo]);
    if (!d) continue;
    if (antes && d === digitos(antes[campo])) continue;
    const ok = campo === 'cpf' ? cpfValido(d) : cnpjValido(d);
    if (!ok) throw new AppError('PARCEIRO_DOCUMENTO_INVALIDO', `${campo.toUpperCase()} inválido`, { details: { field: campo } });
    await exigirDocumentoLivre(tx, clienteId, empresaId, campo, d, antes?.id ?? null);
  }
};

/**
 * B4/R2 — o Lote só ganha um vínculo NOVO de fornecedor se o fornecedor existir
 * neste tenant, for da MESMA empresa do lote, estiver ativo e tiver papel
 * fornecedor (ou o legado `tipos=[]`). Recusa uniforme (não revela se o id
 * existe em outro tenant). Chamada só quando o vínculo muda: o fornecedor já
 * associado a um lote antigo segue exibido e editável mesmo se inativado.
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} empresaId empresa do lote
 * @param {string} fornecedorId
 */
export const exigirFornecedorAssociavel = async (tx, clienteId, empresaId, fornecedorId) => {
  const f = await tx.fornecedor.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id: String(fornecedorId) } },
    select: { empresa_id: true, ativo: true, tipos: true },
  });
  /** @type {string|null} */
  let reason = null;
  if (!f || f.empresa_id !== empresaId) reason = 'fornecedor_nao_encontrado';
  else if (!f.ativo) reason = 'fornecedor_inativo';
  else if (!temPapelFornecedor(f.tipos)) reason = 'parceiro_sem_papel_fornecedor';
  if (reason) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'fornecedor não pode ser associado a este lote', { details: { field: 'fornecedor_id', reason } });
  }
};
