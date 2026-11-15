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
 *  - a guarda transacional de documento (validade + duplicata na empresa);
 *  - D-PROD-208: os dados do papel `funcionario` (tipo, cargo, custo por hora e
 *    por diária), aceitos SÓ com o papel e limpos quando ele sai.
 */

import { AppError } from '../../shared/errors/AppError.js';
import { CASAS_CUSTO, dec } from '../financeiro/decimalFinanceiro.js';
import { invalido, textoDoCorpo, travarEscopo } from '../gestao/gestaoComum.js';

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

/** D-PROD-208: `funcionario` — o funcionário da fazenda é um papel do parceiro (a mão de obra da atividade). */
export const PAPEIS = Object.freeze(['fornecedor', 'cliente', 'prestador_servico', 'transportador', 'funcionario', 'outros']);

/** D-PROD-208 — o papel do funcionário e o do terceiro (prestador de serviço). */
export const PAPEL_FUNCIONARIO = 'funcionario';
export const PAPEL_PRESTADOR_SERVICO = 'prestador_servico';

/** @param {string} s */
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s-]+/g, '_');
/** @type {Readonly<Record<string, string>>} */
const ALIASES = Object.freeze({
  fornecedor: 'fornecedor', fornecedores: 'fornecedor',
  cliente: 'cliente', clientes: 'cliente', comprador: 'cliente',
  prestador_servico: 'prestador_servico', prestador_de_servico: 'prestador_servico', prestador_de_servicos: 'prestador_servico', prestador: 'prestador_servico', prestadora: 'prestador_servico', servicos: 'prestador_servico', servico: 'prestador_servico',
  transportador: 'transportador', transportadora: 'transportador', transportadores: 'transportador',
  funcionario: 'funcionario', funcionarios: 'funcionario', funcionaria: 'funcionario', funcionarias: 'funcionario',
  colaborador: 'funcionario', colaboradores: 'funcionario', empregado: 'funcionario', empregados: 'funcionario',
  outros: 'outros', outro: 'outros',
});

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

// ─── D-PROD-208: dados do papel `funcionario` ───────────────────────────────

/** Tipos do funcionário (CHECK `Fornecedor_funcionario_check`). */
export const TIPOS_FUNCIONARIO = Object.freeze(['MENSALISTA', 'DIARISTA', 'TAREFEIRO']);

/** As quatro colunas do papel `funcionario` (anuláveis; o CHECK confere tipo e custos ≥ 0). */
export const CAMPOS_FUNCIONARIO = Object.freeze(['funcionario_tipo', 'funcionario_cargo', 'funcionario_custo_hora', 'funcionario_custo_diaria']);

/** Os dois custos de referência (decimais em TEXTO no corpo; a linha de mão de obra copia como snapshot). */
export const CUSTOS_FUNCIONARIO = Object.freeze(['funcionario_custo_hora', 'funcionario_custo_diaria']);

/** Largura da coluna do cargo (em caracteres, como o PostgreSQL conta). */
const LARGURA_CARGO = 120;

/** Decimal do custo com 4 casas, ou nulo. @param {unknown} v @returns {string|null} */
export const custo4 = (v) => (v === null || v === undefined ? null : dec(/** @type {any} */ (v)).toFixed(CASAS_CUSTO));

/**
 * Os dados do funcionário presentes no corpo, normalizados (ausente = `undefined`,
 * não entra). Tipo na lista fechada; cargo texto em MAIÚSCULAS (≤ 120 depois de
 * convertido); custos texto decimal ≥ 0 (até 10 dígitos e 4 casas) — número JSON
 * não entra (o `Number` perderia casas). Formato errado → 400.
 * @param {Record<string, unknown>} entrada
 * @returns {Record<string, string|null>}
 */
export const dadosFuncionarioDoCorpo = (entrada) => {
  /** @type {Record<string, string|null>} */
  const d = {};
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  if (e.funcionario_tipo !== undefined) {
    if (e.funcionario_tipo !== null && (typeof e.funcionario_tipo !== 'string' || !TIPOS_FUNCIONARIO.includes(e.funcionario_tipo))) {
      throw invalido(`funcionario_tipo deve ser um de: ${TIPOS_FUNCIONARIO.join(', ')}`, { field: 'funcionario_tipo', reason: 'formato' });
    }
    d.funcionario_tipo = /** @type {string|null} */ (e.funcionario_tipo);
  }
  if (e.funcionario_cargo !== undefined) {
    const cargo = textoDoCorpo(e.funcionario_cargo, 'funcionario_cargo', { maiusculas: true }) ?? null;
    if (cargo !== null && [...cargo].length > LARGURA_CARGO) {
      throw invalido(`funcionario_cargo passa de ${LARGURA_CARGO} caracteres`, { field: 'funcionario_cargo', reason: 'tamanho_excedido' });
    }
    d.funcionario_cargo = cargo;
  }
  for (const campo of CUSTOS_FUNCIONARIO) {
    const v = e[campo];
    if (v === undefined) continue;
    if (v === null) { d[campo] = null; continue; }
    if (typeof v !== 'string' || !/^\d{1,10}(\.\d{1,4})?$/.test(v)) {
      throw invalido(`${campo} deve ser texto decimal não negativo, com até 10 dígitos e 4 casas (ex.: "12.5")`, { field: campo, reason: 'formato' });
    }
    d[campo] = dec(v).toFixed(CASAS_CUSTO);
  }
  return d;
};

/**
 * A regra do papel (D-PROD-208), aplicada sobre os dados já normalizados:
 *  - COM o papel `funcionario` nos papéis finais: os campos enviados ficam;
 *  - SEM o papel: qualquer campo enviado com valor → 422
 *    `PARCEIRO_FUNCIONARIO_SEM_PAPEL` (nulo é aceito: não há o que gravar);
 *    e, se o registro tinha algum dado de funcionário, os quatro são limpos
 *    (tirar o papel limpa os dados).
 * Devolve as colunas a gravar (pode ser `{}`).
 * @param {Record<string, string|null>} dados  saída de `dadosFuncionarioDoCorpo`
 * @param {unknown} tiposFinais  os `tipos` que o registro terá
 * @param {Record<string, any>|null} [antes]  o registro gravado (na edição)
 * @returns {Record<string, string|null>}
 */
export const aplicarPapelFuncionario = (dados, tiposFinais, antes = null) => {
  if (lerPapeis(tiposFinais).papeis.includes(PAPEL_FUNCIONARIO)) return { ...dados };
  const comValor = CAMPOS_FUNCIONARIO.find((c) => dados[c] !== undefined && dados[c] !== null);
  if (comValor) {
    throw new AppError('PARCEIRO_FUNCIONARIO_SEM_PAPEL', 'os dados do funcionário (tipo, cargo e custos) só valem para parceiro com o papel funcionário: marque o papel ou não envie os campos', {
      details: { field: comValor, reason: 'exige_papel_funcionario' },
    });
  }
  const tinha = antes && CAMPOS_FUNCIONARIO.some((c) => antes[c] !== null && antes[c] !== undefined);
  return tinha ? Object.fromEntries(CAMPOS_FUNCIONARIO.map((c) => [c, null])) : {};
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
    // D-PROD-208: do funcionário, o tipo (lista fechada) e os custos de referência (os mesmos valores que a linha de
    // mão de obra já audita como snapshot); o cargo é texto livre: só se há.
    funcionario_tipo: TIPOS_FUNCIONARIO.includes(r?.funcionario_tipo) ? r.funcionario_tipo : null,
    funcionario_custo_hora: custo4(r?.funcionario_custo_hora),
    funcionario_custo_diaria: custo4(r?.funcionario_custo_diaria),
    tem_funcionario_cargo: Boolean(r?.funcionario_cargo),
  };
};

/** Colunas cujo NOME pode aparecer em `campos_alterados` (o valor nunca aparece). */
const COLUNAS_AUDITAVEIS = Object.freeze([
  'empresa_id', 'numero_cadastro', 'tipo_pessoa', 'nome', 'razao_social', 'cpf', 'cnpj', 'rg', 'data_nascimento',
  'inscricao_estadual', 'nome_responsavel', 'telefone', 'email', 'endereco', 'cidade', 'codigo_ibge', 'estado', 'cep',
  'observacoes', 'tipos', 'ativo',
  // D-PROD-208 — dados do papel funcionário.
  'funcionario_tipo', 'funcionario_cargo', 'funcionario_custo_hora', 'funcionario_custo_diaria',
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
