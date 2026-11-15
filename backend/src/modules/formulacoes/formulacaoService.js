/**
 * Serviço de Formulações de suplemento da fazenda (D-PROD-203, etapa 2a da
 * suplementação), tabelas físicas "CADFORMULACAO", "CADFORMULACAOINGREDIENTE"
 * e "CADFORMULACAOREGRA".
 *
 * Uma formulação é:
 *  - PRONTO: um produto comprado pronto (ex.: sal mineral) — sem ingredientes;
 *  - BATELADA: mistura feita na fazenda com produtos do estoque, com os
 *    ingredientes em kg POR BATIDA (ex.: milho 600, farelo 300, núcleo 100 numa
 *    batida de 1.000 kg). O produto misturado é cadastrado antes em Produtos e
 *    a formulação aponta para ele.
 * `produto_id` é sempre o produto que vai ao cocho (o lançamento baixa ele).
 * O consumo alvo é %PV (peso vivo) padrão, com exceção opcional por Categoria
 * de Manejo: não consome, ou consome com %PV próprio. A produção da batelada
 * (movimento de estoque) não existe aqui — é a etapa 2b.
 *
 * Regras:
 *  - tenant só de `auth_context` (R11); a fazenda vem do corpo/query e precisa
 *    ser DESTE tenant (`exigirEmpresaDoTenant`: outra ou inexistente → 404);
 *  - nome em MAIÚSCULAS, único por fazenda (409 `FORMULACAO_NAME_CONFLICT`);
 *  - produto e cada ingrediente: Produto DESTA fazenda (outro tenant, outra
 *    fazenda ou inexistente → 400 `produto_inexistente`/`ingrediente_inexistente`)
 *    e ATIVO quando a referência é nova (`produto_inativo`/`ingrediente_inativo`);
 *  - PRONTO sem ingredientes; BATELADA com pelo menos 1, sem produto repetido e
 *    sem o próprio produto misturado entre eles;
 *  - %PV (padrão e da regra) de (0, 5], até 4 casas, aceitando vírgula ("0,15");
 *    consumo objetivo (g/cab/dia) opcional, > 0, até 2 casas; ingrediente em kg
 *    por batida > 0, até 3 casas. Gravado como decimal exato;
 *  - regras: Categoria de Manejo DESTA fazenda (ativa quando nova), sem
 *    repetir; não consome → sem %PV e sem gramas; consome → o valor da BASE;
 *  - D-PROD-207, base do consumo (UMA por formulação, sem mistura):
 *    `PV` (% do peso vivo; padrão: `percentual_pv_padrao` obrigatório; regras
 *    que consomem com `percentual_pv`) ou `G_CAB_DIA` (gramas por cabeça por
 *    dia; padrão: `consumo_objetivo_g_cab_dia` obrigatório e %PV nulo; regras
 *    que consomem com `g_cab_dia`). Valor da outra base → 400 (`pv_na_base_g`,
 *    `regra_pv_na_base_g`, `regra_g_na_base_pv`); na base PV o
 *    `consumo_objetivo_g_cab_dia` é só referência. A forma FINAL é conferida
 *    também no PATCH (trocar a base exige mandar os valores da nova base);
 *  - PATCH substitui por inteiro as listas enviadas (`ingredientes`, `regras`),
 *    na mesma transação; a forma final (tipo × ingredientes) é conferida;
 *  - exclusão física só sem lançamento de suplementação que a cite
 *    (`SuplementacaoEvento.dados->>'formulacao_id'`, mesma fazenda); senão 409
 *    `FORMULACAO_EM_USO` `{ lancamentos }`: inative em vez de excluir.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { formulacaoEmUso, formulacaoNotFound, formulacaoNomeConflito } from '../../shared/errors/AppError.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo, travarEscopo, ehViolacaoDeUnique } from '../gestao/gestaoComum.js';
import {
  listarFormulacoes,
  buscarFormulacao,
  existeFormulacaoComNome,
  lerProdutos,
  lerCategorias,
  inserirFormulacao,
  atualizarFormulacao,
  travarFormulacao,
  contarLancamentosDaFormulacao,
  excluirFormulacaoPorId,
} from './formulacaoRepository.js';

const ENTIDADE = 'Formulacao';
export const TIPOS = Object.freeze(['PRONTO', 'BATELADA']);
/** %PV máximo aceito (padrão e da regra). */
export const PV_MAXIMO = 5;
/** D-PROD-207: as bases do consumo (CHECK "CADFORMULACAO_base_consumo_check"). */
export const BASES_CONSUMO = Object.freeze(['PV', 'G_CAB_DIA']);
/** D-PROD-207: teto de gramas por cabeça por dia (20 kg), no padrão e na regra. */
export const G_MAXIMO = 20000;
/** D-PROD-206: faixa de tolerância do farol de consumo, em % do esperado (null = padrão de 15%). */
export const FAIXA_MAXIMA = 100;
/** Largura das colunas VARCHAR (em caracteres, como o PostgreSQL conta). */
const LARGURA = Object.freeze({ nome: 120, observacoes: 2000 });

/** Decimal do Prisma (ou texto/número) → número com até `casas` casas; null fica null. */
const numeroDe = (valor, casas) => (valor === null || valor === undefined ? null : Number(Number(String(valor)).toFixed(casas)));

/**
 * Formato público: números como número; ingredientes com o nome do produto e o
 * percentual de cada um na batida; regras com o nome da categoria; e o total
 * da batida (Σ kg dos ingredientes, 0 no PRONTO).
 * @param {any} registro
 */
export const comoFormulacaoPublica = (registro) => {
  const ingredientes = (registro.ingredientes ?? []).map((i) => ({
    id: i.id,
    produto_id: i.produto_id,
    produto_nome: i.produto?.nome_produto ?? null,
    quantidade_kg: numeroDe(i.quantidade_kg, 3),
    ordem: i.ordem,
  }));
  // Soma exata em gramas (milésimos de kg): sem ruído de ponto flutuante.
  const totalG = ingredientes.reduce((soma, i) => soma + Math.round(Number(i.quantidade_kg) * 1000), 0);
  const total = totalG / 1000;
  return {
    id: registro.id,
    empresa_id: registro.empresa_id,
    nome: registro.nome,
    tipo: registro.tipo,
    produto_id: registro.produto_id,
    produto_nome: registro.produto?.nome_produto ?? null,
    produto_ativo: registro.produto?.ativo ?? null,
    base_consumo: registro.base_consumo ?? 'PV',
    percentual_pv_padrao: numeroDe(registro.percentual_pv_padrao, 4),
    consumo_objetivo_g_cab_dia: numeroDe(registro.consumo_objetivo_g_cab_dia, 2),
    // D-PROD-206: null = o padrão de 15% (quem lê aplica o padrão; o banco não inventa valor).
    faixa_tolerancia_percentual: numeroDe(registro.faixa_tolerancia_percentual, 2),
    observacoes: registro.observacoes ?? null,
    ativo: registro.ativo,
    total_batida_kg: total,
    ingredientes: ingredientes.map((i) => ({
      ...i,
      percentual: totalG > 0 ? Number(((Math.round(Number(i.quantidade_kg) * 1000) / totalG) * 100).toFixed(2)) : 0,
    })),
    regras: (registro.regras ?? []).map((r) => ({
      id: r.id,
      categoria_manejo_id: r.categoria_manejo_id,
      categoria_manejo_nome: r.categoriaManejo?.nome ?? null,
      consome: r.consome,
      percentual_pv: numeroDe(r.percentual_pv, 4),
      g_cab_dia: numeroDe(r.g_cab_dia, 2),
    })),
    created_date: registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
    updated_date: registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
  };
};

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
 * Decimal do corpo: número finito ou texto com vírgula ou ponto decimal
 * ("0,15", "0.15", "600"); "1.000" e "1.250,5" são milhar pt-BR. Devolve o texto decimal
 * exato com `casas` casas, que o Prisma grava sem erro de ponto flutuante.
 * @param {unknown} valor
 * @param {string} campo
 * @param {{ casas: number, maximo?: number, motivo: string, rotulo: string }} regra
 */
const decimalDoCorpo = (valor, campo, { casas, maximo, motivo, rotulo }) => {
  let numero;
  if (typeof valor === 'number') {
    numero = valor;
  } else if (typeof valor === 'string' && /^\s*\d{1,3}(\.\d{3})+(,\d+)?\s*$/.test(valor)) {
    // Milhar pt-BR: "1.000" é mil, não 1 ("1.250,5" → 1250,5).
    numero = Number(valor.trim().replace(/\./g, '').replace(',', '.'));
  } else if (typeof valor === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(valor)) {
    numero = Number(valor.trim().replace(',', '.'));
  } else {
    throw invalido(`${campo} deve ser um número (${rotulo})`, { field: campo, reason: `${motivo}_invalido` });
  }
  if (!Number.isFinite(numero) || numero <= 0 || (maximo !== undefined && numero > maximo)) {
    throw invalido(`${campo} deve ser maior que 0${maximo !== undefined ? ` e no máximo ${maximo}` : ''} (${rotulo})`, {
      field: campo,
      reason: `${motivo}_fora_da_faixa`,
    });
  }
  const escala = 10 ** casas;
  const inteiro = Math.round(numero * escala);
  if (Math.abs(numero * escala - inteiro) > 1e-6) {
    throw invalido(`${campo} aceita no máximo ${casas} casas decimais`, { field: campo, reason: `${motivo}_casas_decimais` });
  }
  return (inteiro / escala).toFixed(casas);
};

const pvDoCorpo = (valor, campo) => decimalDoCorpo(valor, campo, { casas: 4, maximo: PV_MAXIMO, motivo: 'percentual_pv', rotulo: '% do peso vivo' });
const gDoCorpo = (valor, campo, motivo) => decimalDoCorpo(valor, campo, { casas: 2, maximo: G_MAXIMO, motivo, rotulo: 'g/cab/dia' });
/** @param {unknown} v */
const vazio = (v) => v === undefined || v === null || v === '';

/**
 * Campos escalares editáveis do corpo, já normalizados. `empresa_id` NÃO está
 * aqui: é o escopo, conferido à parte e nunca alterado por PATCH.
 * @param {Record<string, unknown>} entrada
 */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const campos = {};
  const nome = caberNaColuna(textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true }), 'nome');
  if (nome !== undefined) campos.nome = nome;
  if (entrada.tipo !== undefined) {
    if (!TIPOS.includes(/** @type {string} */ (entrada.tipo))) throw invalido('tipo deve ser PRONTO ou BATELADA', { field: 'tipo', reason: 'tipo_invalido' });
    campos.tipo = entrada.tipo;
  }
  if (entrada.produto_id !== undefined) campos.produto_id = String(entrada.produto_id);
  if (entrada.base_consumo !== undefined) {
    if (!BASES_CONSUMO.includes(/** @type {string} */ (entrada.base_consumo))) {
      throw invalido('base_consumo deve ser PV ou G_CAB_DIA', { field: 'base_consumo', reason: 'base_consumo_invalida' });
    }
    campos.base_consumo = entrada.base_consumo;
  }
  if (entrada.percentual_pv_padrao !== undefined) {
    campos.percentual_pv_padrao = vazio(entrada.percentual_pv_padrao) ? null : pvDoCorpo(entrada.percentual_pv_padrao, 'percentual_pv_padrao');
  }
  if (entrada.consumo_objetivo_g_cab_dia !== undefined) {
    campos.consumo_objetivo_g_cab_dia = vazio(entrada.consumo_objetivo_g_cab_dia)
      ? null
      : gDoCorpo(entrada.consumo_objetivo_g_cab_dia, 'consumo_objetivo_g_cab_dia', 'consumo_objetivo');
  }
  // D-PROD-206: faixa do farol de consumo (0 < x ≤ 100, até 2 casas); vazio/null = padrão de 15%.
  if (entrada.faixa_tolerancia_percentual !== undefined) {
    campos.faixa_tolerancia_percentual = entrada.faixa_tolerancia_percentual === null || entrada.faixa_tolerancia_percentual === ''
      ? null
      : decimalDoCorpo(entrada.faixa_tolerancia_percentual, 'faixa_tolerancia_percentual', { casas: 2, maximo: FAIXA_MAXIMA, motivo: 'faixa_tolerancia', rotulo: '% de tolerância' });
  }
  const observacoes = caberNaColuna(textoDoCorpo(entrada.observacoes, 'observacoes', { maiusculas: true }), 'observacoes');
  if (observacoes !== undefined) campos.observacoes = observacoes;
  if (entrada.ativo !== undefined) campos.ativo = Boolean(entrada.ativo);
  return campos;
};

/**
 * Ingredientes do corpo (lista inteira), normalizados: kg por batida > 0, até
 * 3 casas; produto repetido → 400 `ingrediente_duplicado`.
 * @param {unknown} lista
 * @returns {Array<{ produto_id: string, quantidade_kg: string }> | undefined}
 */
const ingredientesDe = (lista) => {
  if (lista === undefined) return undefined;
  const itens = /** @type {Array<Record<string, unknown>>} */ (Array.isArray(lista) ? lista : []);
  const vistos = new Set();
  return itens.map((item, i) => {
    const produtoId = String(item.produto_id);
    if (vistos.has(produtoId)) {
      throw invalido('o mesmo produto aparece duas vezes nos ingredientes', { field: `ingredientes[${i}].produto_id`, reason: 'ingrediente_duplicado' });
    }
    vistos.add(produtoId);
    return {
      produto_id: produtoId,
      quantidade_kg: decimalDoCorpo(item.quantidade_kg, `ingredientes[${i}].quantidade_kg`, { casas: 3, motivo: 'quantidade', rotulo: 'kg por batida' }),
    };
  });
};

/**
 * Regras por categoria do corpo (lista inteira), normalizadas: categoria
 * repetida → `regra_duplicada`; não consome com %PV ou gramas →
 * `regra_nao_consome_com_pv` / `regra_nao_consome_com_g`; %PV e gramas na mesma
 * regra → `regra_pv_e_g`. Se o valor que veio é o da BASE certa (e se faltou) é
 * conferido depois, na forma final (`conferirBaseDoConsumo`).
 * @param {unknown} lista
 * @returns {Array<{ categoria_manejo_id: string, consome: boolean, percentual_pv: string | null, g_cab_dia: string | null }> | undefined}
 */
const regrasDe = (lista) => {
  if (lista === undefined) return undefined;
  const itens = /** @type {Array<Record<string, unknown>>} */ (Array.isArray(lista) ? lista : []);
  const vistas = new Set();
  return itens.map((item, i) => {
    const categoriaId = String(item.categoria_manejo_id);
    if (vistas.has(categoriaId)) {
      throw invalido('a mesma categoria de manejo aparece em duas regras', { field: `regras[${i}].categoria_manejo_id`, reason: 'regra_duplicada' });
    }
    vistas.add(categoriaId);
    const consome = item.consome === true;
    const semPv = vazio(item.percentual_pv);
    const semG = vazio(item.g_cab_dia);
    if (!consome) {
      if (!semPv) throw invalido('categoria que não consome não tem %PV', { field: `regras[${i}].percentual_pv`, reason: 'regra_nao_consome_com_pv' });
      if (!semG) throw invalido('categoria que não consome não tem g/cab/dia', { field: `regras[${i}].g_cab_dia`, reason: 'regra_nao_consome_com_g' });
      return { categoria_manejo_id: categoriaId, consome: false, percentual_pv: null, g_cab_dia: null };
    }
    if (!semPv && !semG) {
      throw invalido('a regra leva %PV OU g/cab/dia, conforme a base da formulação; nunca os dois', { field: `regras[${i}].g_cab_dia`, reason: 'regra_pv_e_g' });
    }
    return {
      categoria_manejo_id: categoriaId,
      consome: true,
      percentual_pv: semPv ? null : pvDoCorpo(item.percentual_pv, `regras[${i}].percentual_pv`),
      g_cab_dia: semG ? null : gDoCorpo(item.g_cab_dia, `regras[${i}].g_cab_dia`, 'g_cab_dia'),
    };
  });
};

/** Trava das escritas de formulações de UMA fazenda (tenant + empresa). */
const travarFazenda = (tx, clienteId, empresaId) => travarEscopo(tx, `formulacoes:${clienteId}:${empresaId}`);

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
    if (ehViolacaoDeUnique(erro)) throw formulacaoNomeConflito();
    throw erro;
  }
};

/**
 * D-PROD-207 — a forma FINAL da base do consumo (sem mistura). PV: %PV padrão
 * obrigatório; regra que consome com %PV, sem gramas. G_CAB_DIA: g/cab/dia padrão
 * obrigatório e %PV padrão nulo; regra que consome com gramas, sem %PV.
 * @param {{ base: string, percentual_pv_padrao: unknown, consumo_objetivo_g_cab_dia: unknown,
 *   regras: Array<{ consome: boolean, percentual_pv?: unknown, g_cab_dia?: unknown }> }} final
 */
const conferirBaseDoConsumo = (final) => {
  if (final.base === 'G_CAB_DIA') {
    if (!vazio(final.percentual_pv_padrao)) {
      throw invalido('na base g/cab/dia a formulação não tem %PV padrão', { field: 'percentual_pv_padrao', reason: 'pv_na_base_g' });
    }
    if (vazio(final.consumo_objetivo_g_cab_dia)) {
      throw invalido('informe o consumo padrão em g/cab/dia', { field: 'consumo_objetivo_g_cab_dia', reason: 'g_padrao_obrigatorio' });
    }
  } else if (vazio(final.percentual_pv_padrao)) {
    throw invalido('informe o %PV padrão', { field: 'percentual_pv_padrao', reason: 'pv_padrao_obrigatorio' });
  }
  final.regras.forEach((regra, i) => {
    if (!regra.consome) return;
    if (final.base === 'G_CAB_DIA') {
      if (!vazio(regra.percentual_pv)) throw invalido('na base g/cab/dia a regra não tem %PV', { field: `regras[${i}].percentual_pv`, reason: 'regra_pv_na_base_g' });
      if (vazio(regra.g_cab_dia)) throw invalido('informe os g/cab/dia da categoria que consome', { field: `regras[${i}].g_cab_dia`, reason: 'regra_g_obrigatorio' });
    } else {
      if (!vazio(regra.g_cab_dia)) throw invalido('na base %PV a regra não tem g/cab/dia', { field: `regras[${i}].g_cab_dia`, reason: 'regra_g_na_base_pv' });
      if (vazio(regra.percentual_pv)) throw invalido('informe o %PV da categoria que consome', { field: `regras[${i}].percentual_pv`, reason: 'regra_pv_obrigatorio' });
    }
  });
};

/**
 * Confere a forma FINAL e as referências: produto do cocho, ingredientes e
 * categorias são DESTA fazenda; referência nova precisa estar ativa.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {{ tipo: string, produto_id: string, ingredientes: Array<{ produto_id: string }>, regras: Array<{ categoria_manejo_id: string }> }} final
 * @param {{ produto_id?: string, ingredientes?: Set<string>, categorias?: Set<string> }} anterior
 */
const conferirFormaEReferencias = async (tx, clienteId, empresaId, final, anterior) => {
  if (final.tipo === 'PRONTO' && final.ingredientes.length > 0) {
    throw invalido('formulação de produto pronto não tem ingredientes', { field: 'ingredientes', reason: 'pronto_com_ingredientes' });
  }
  if (final.tipo === 'BATELADA' && final.ingredientes.length === 0) {
    throw invalido('a batelada precisa de pelo menos 1 ingrediente', { field: 'ingredientes', reason: 'batelada_sem_ingredientes' });
  }
  const indiceDoProprio = final.ingredientes.findIndex((i) => i.produto_id === final.produto_id);
  if (indiceDoProprio >= 0) {
    throw invalido('o produto misturado não pode ser ingrediente da própria batelada', {
      field: `ingredientes[${indiceDoProprio}].produto_id`,
      reason: 'ingrediente_e_o_produto',
    });
  }

  const ids = [...new Set([final.produto_id, ...final.ingredientes.map((i) => i.produto_id)])];
  const produtos = new Map((await lerProdutos(tx, clienteId, ids)).filter((p) => p.empresa_id === empresaId).map((p) => [p.id, p]));
  const produto = produtos.get(final.produto_id);
  if (!produto) throw invalido('produto não encontrado nesta fazenda', { field: 'produto_id', reason: 'produto_inexistente' });
  if (!produto.ativo && anterior.produto_id !== final.produto_id) {
    throw invalido('produto inativo não pode ser escolhido', { field: 'produto_id', reason: 'produto_inativo' });
  }
  final.ingredientes.forEach((ingrediente, i) => {
    const p = produtos.get(ingrediente.produto_id);
    if (!p) throw invalido('ingrediente não encontrado nesta fazenda', { field: `ingredientes[${i}].produto_id`, reason: 'ingrediente_inexistente' });
    if (!p.ativo && !anterior.ingredientes?.has(ingrediente.produto_id)) {
      throw invalido('produto inativo não pode entrar como ingrediente', { field: `ingredientes[${i}].produto_id`, reason: 'ingrediente_inativo' });
    }
  });

  const categorias = new Map(
    (await lerCategorias(tx, clienteId, final.regras.map((r) => r.categoria_manejo_id))).filter((c) => c.empresa_id === empresaId).map((c) => [c.id, c])
  );
  final.regras.forEach((regra, i) => {
    const c = categorias.get(regra.categoria_manejo_id);
    if (!c) throw invalido('categoria de manejo não encontrada nesta fazenda', { field: `regras[${i}].categoria_manejo_id`, reason: 'categoria_inexistente' });
    if (!c.ativo && !anterior.categorias?.has(regra.categoria_manejo_id)) {
      throw invalido('categoria de manejo inativa não pode receber regra', { field: `regras[${i}].categoria_manejo_id`, reason: 'categoria_inativa' });
    }
  });
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ empresa_id?: unknown }} consulta
 */
export const listar = async (contexto, consulta) => {
  const auth = exigirAuthContext(contexto?.auth);
  const empresaId = await exigirEmpresaDoTenant(getPrismaClient(), auth.clienteId, consulta?.empresa_id);
  return (await listarFormulacoes(auth.clienteId, empresaId)).map(comoFormulacaoPublica);
};

/**
 * Opções do lançamento de suplementação: só as formulações ATIVAS, com o
 * produto, o %PV padrão e as regras por categoria (sem os ingredientes: o
 * lançamento não produz a batelada).
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ empresa_id?: unknown }} consulta
 */
export const opcoesLancamento = async (contexto, consulta) => {
  const auth = exigirAuthContext(contexto?.auth);
  const empresaId = await exigirEmpresaDoTenant(getPrismaClient(), auth.clienteId, consulta?.empresa_id);
  return (await listarFormulacoes(auth.clienteId, empresaId, { somenteAtivas: true })).map((registro) => {
    const f = comoFormulacaoPublica(registro);
    return {
      id: f.id,
      empresa_id: f.empresa_id,
      nome: f.nome,
      tipo: f.tipo,
      produto_id: f.produto_id,
      produto_nome: f.produto_nome,
      produto_ativo: f.produto_ativo,
      base_consumo: f.base_consumo,
      percentual_pv_padrao: f.percentual_pv_padrao,
      consumo_objetivo_g_cab_dia: f.consumo_objetivo_g_cab_dia,
      faixa_tolerancia_percentual: f.faixa_tolerancia_percentual,
      regras: f.regras.map(({ categoria_manejo_id, categoria_manejo_nome, consome, percentual_pv, g_cab_dia }) => ({ categoria_manejo_id, categoria_manejo_nome, consome, percentual_pv, g_cab_dia })),
    };
  });
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {{ empresa_id?: unknown }} consulta
 */
export const obter = async (contexto, id, consulta) => {
  const auth = exigirAuthContext(contexto?.auth);
  const empresaId = await exigirEmpresaDoTenant(getPrismaClient(), auth.clienteId, consulta?.empresa_id);
  const registro = await buscarFormulacao(auth.clienteId, empresaId, id);
  if (!registro) throw formulacaoNotFound();
  return comoFormulacaoPublica(registro);
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);
  for (const campo of ['tipo', 'produto_id']) {
    if (campos[campo] === undefined) throw invalido(`${campo} é obrigatório`, { field: campo });
  }
  const ingredientes = ingredientesDe(entrada.ingredientes) ?? [];
  const regras = regrasDe(entrada.regras) ?? [];
  conferirBaseDoConsumo({
    base: String(campos.base_consumo ?? 'PV'),
    percentual_pv_padrao: campos.percentual_pv_padrao,
    consumo_objetivo_g_cab_dia: campos.consumo_objetivo_g_cab_dia,
    regras,
  });
  const ativo = campos.ativo === undefined ? true : Boolean(campos.ativo);

  return comConflitoDeNomeEstavel(() =>
    prisma.$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      await travarFazenda(tx, auth.clienteId, empresaId);
      await conferirFormaEReferencias(tx, auth.clienteId, empresaId, {
        tipo: String(campos.tipo), produto_id: String(campos.produto_id), ingredientes, regras,
      }, {});

      if (await existeFormulacaoComNome(tx, auth.clienteId, empresaId, String(campos.nome))) throw formulacaoNomeConflito();

      const registro = await inserirFormulacao(tx, { ...campos, ativo, cliente_id: auth.clienteId, empresa_id: empresaId }, ingredientes, regras);
      const publico = comoFormulacaoPublica(registro);
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
  const ingredientes = ingredientesDe(entrada.ingredientes);
  const regras = regrasDe(entrada.regras);

  return comConflitoDeNomeEstavel(() =>
    prisma.$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      await travarFazenda(tx, auth.clienteId, empresaId);

      const anterior = await buscarFormulacao(auth.clienteId, empresaId, id, tx);
      if (!anterior) throw formulacaoNotFound();

      conferirBaseDoConsumo({
        base: String(campos.base_consumo ?? anterior.base_consumo ?? 'PV'),
        percentual_pv_padrao: campos.percentual_pv_padrao !== undefined ? campos.percentual_pv_padrao : anterior.percentual_pv_padrao,
        consumo_objetivo_g_cab_dia: campos.consumo_objetivo_g_cab_dia !== undefined ? campos.consumo_objetivo_g_cab_dia : anterior.consumo_objetivo_g_cab_dia,
        regras: regras ?? anterior.regras.map((r) => ({ consome: r.consome, percentual_pv: r.percentual_pv, g_cab_dia: r.g_cab_dia })),
      });

      await conferirFormaEReferencias(tx, auth.clienteId, empresaId, {
        tipo: String(campos.tipo ?? anterior.tipo),
        produto_id: String(campos.produto_id ?? anterior.produto_id),
        ingredientes: ingredientes ?? anterior.ingredientes.map((i) => ({ produto_id: i.produto_id })),
        regras: regras ?? anterior.regras.map((r) => ({ categoria_manejo_id: r.categoria_manejo_id })),
      }, {
        produto_id: anterior.produto_id,
        ingredientes: new Set(anterior.ingredientes.map((i) => i.produto_id)),
        categorias: new Set(anterior.regras.map((r) => r.categoria_manejo_id)),
      });

      if (campos.nome !== undefined && campos.nome !== anterior.nome) {
        if (await existeFormulacaoComNome(tx, auth.clienteId, empresaId, String(campos.nome), id)) throw formulacaoNomeConflito();
      }

      const registro = await atualizarFormulacao(tx, anterior, campos, { ingredientes, regras });
      const publico = comoFormulacaoPublica(registro);
      await registrarEvento(
        contexto,
        { acao: 'update', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: comoFormulacaoPublica(anterior), dadosNovos: publico },
        tx
      );
      return publico;
    })
  );
};

/**
 * Exclusão física (ingredientes e regras saem junto). A formulação é travada
 * `FOR UPDATE`; com lançamento de suplementação que a cite → 409
 * `FORMULACAO_EM_USO` `{ lancamentos }` e nada é apagado (inative em vez de
 * excluir: o histórico continua apontando para ela).
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
    await travarFormulacao(tx, auth.clienteId, empresaId, id);
    const anterior = await buscarFormulacao(auth.clienteId, empresaId, id, tx);
    if (!anterior) throw formulacaoNotFound();

    const lancamentos = await contarLancamentosDaFormulacao(tx, auth.clienteId, empresaId, id);
    if (lancamentos > 0) throw formulacaoEmUso(lancamentos);

    await excluirFormulacaoPorId(tx, auth.clienteId, id);
    await registrarEvento(contexto, { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: comoFormulacaoPublica(anterior) }, tx);
  });
};
