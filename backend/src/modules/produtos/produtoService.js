/**
 * Serviço de Produto (P5.2, D-PROD-48).
 *
 * D-PROD-161 (Estoque P0): o Cadastro de Produtos NÃO lança estoque.
 * `estoque_atual` é cache DERIVADO das entradas e movimentações e só o motor
 * físico (`estoqueFisicoMotor.js`, `{increment}`/`{decrement}` conferidos sob
 * `travarProdutosEstoque`) o altera. Aqui:
 *  - POST grava SEMPRE 0; o campo ausente ou numericamente 0 é aceito (cliente
 *    antigo), qualquer outro valor → 422 PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL;
 *  - PATCH nunca o escreve: presente no corpo, a linha é travada (FOR NO KEY
 *    UPDATE, espera o FOR UPDATE do motor) e relida; igual ao atual a 4 casas é
 *    ignorado, diferente → 422. Sem escrita absoluta, sem lost update;
 *  - produto com lote, movimento ou cache ≠ 0 não muda de empresa (409
 *    PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA): lotes e movimentos ficariam na
 *    fazenda antiga;
 *  - produto com lote não é excluído (409 PRODUTO_DELETE_BLOCKED, vínculo
 *    'lotes de estoque'): o lote ficaria órfão;
 *  - `preco_custo` é preço de referência: nunca altera lote, movimento ou fatia.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { propagarRenomeacaoDeProduto } from '../referencias/propagacaoPorChaveUnica.js';
import { registrarPropagacao } from '../referencias/syncEntityReferencesService.js';
import {
  decodificarCursor,
  montarEnvelopeKeyset,
  normalizarLimite,
} from '../../shared/pagination/keysetCursor.js';
import { AppError, produtoNotFound, produtoNomeConflito, produtoDeleteBlocked } from '../../shared/errors/AppError.js';
import { travarProdutosEstoque } from '../estoqueFisico/estoqueFisicoMotor.js';
import { CASAS_QUANTIDADE, Dec, dec } from '../financeiro/decimalFinanceiro.js';
import {
  listarProdutos,
  listarProdutosPagina,
  contarProdutos,
  buscarProduto,
  existeProdutoComNome,
  inserirProduto,
  atualizarProdutoPorId,
  excluirProdutoPorId,
  contarMovimentacoesPorProduto,
  contarLotesPorProduto,
} from './produtoRepository.js';

export const ENTIDADE_SEQUENCIA = 'Produto';
export const escopoDaNumeracao = () => ESCOPO_TENANT;

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

const normalizarNomeProduto = (valor) => {
  const limpo = textoOuNulo(valor);
  if (limpo === undefined || limpo === null) return limpo;
  return limpo.toUpperCase();
};

const decimalOuNulo = (valor) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

const decimalComDefault = (valor, padrao) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return padrao;
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
};

const comoNumero = (valor) => (valor === null || valor === undefined ? null : Number(valor));

/** @param {Record<string, unknown>} registro */
export const comoProdutoPublico = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  numero_produto: registro.numero_produto,
  nome_produto: registro.nome_produto,
  tipo_uso: registro.tipo_uso ?? null,
  codigo_interno: registro.codigo_interno ?? null,
  codigo_barras: registro.codigo_barras ?? null,
  categoria: registro.categoria ?? null,
  marca: registro.marca ?? null,
  descricao: registro.descricao ?? null,
  unidade_medida: registro.unidade_medida ?? null,
  preco_custo: comoNumero(registro.preco_custo),
  preco_venda: comoNumero(registro.preco_venda),
  estoque_atual: comoNumero(registro.estoque_atual) ?? 0,
  estoque_minimo: comoNumero(registro.estoque_minimo) ?? 0,
  local_estoque: registro.local_estoque ?? null,
  tipo_consumo: registro.tipo_consumo ?? null,
  percentual_consumo_pv: comoNumero(registro.percentual_consumo_pv),
  consumo_minimo_pv: comoNumero(registro.consumo_minimo_pv),
  consumo_maximo_pv: comoNumero(registro.consumo_maximo_pv),
  unidade_principal_estoque: registro.unidade_principal_estoque ?? 'KG',
  peso_por_saco_kg: comoNumero(registro.peso_por_saco_kg),
  // MAIKE-ENTREGA2 (D-PROD-273): a carência da bula, em dias (nulo = sem carência cadastrada).
  carencia_dias: registro.carencia_dias ?? null,
  observacoes: registro.observacoes ?? null,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

/** MAIKE-ENTREGA2 (D-PROD-273): carência máxima aceita, em dias (a coluna não tem CHECK: a allowlist EXPAND o recusa). */
export const CARENCIA_MAXIMA_DIAS = 365;

/**
 * Carência da bula em dias: inteiro de 0 a 365 (0 = libera no mesmo dia); null limpa. O schema da rota já recusou o que
 * não é inteiro nem null.
 * @param {unknown} v
 * @returns {number|null|undefined}
 */
export const carenciaDoCorpo = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > CARENCIA_MAXIMA_DIAS) {
    throw new AppError('REQUEST_VALIDATION_FAILED', `carencia_dias deve ser um número inteiro de dias, de 0 a ${CARENCIA_MAXIMA_DIAS}`, {
      details: { field: 'carencia_dias', reason: 'carencia_invalida' },
    });
  }
  return v;
};

const CAMPOS_EDITAVEIS = Object.freeze({
  empresa_id: (v) => textoOuNulo(v),
  nome_produto: (v) => normalizarNomeProduto(v),
  tipo_uso: (v) => textoOuNulo(v),
  codigo_interno: (v) => {
    const limpo = textoOuNulo(v);
    return limpo === undefined || limpo === null ? limpo : limpo.toUpperCase();
  },
  codigo_barras: (v) => textoOuNulo(v),
  categoria: (v) => textoOuNulo(v),
  marca: (v) => textoOuNulo(v),
  descricao: (v) => textoOuNulo(v),
  unidade_medida: (v) => textoOuNulo(v),
  preco_custo: (v) => decimalOuNulo(v),
  preco_venda: (v) => decimalOuNulo(v),
  // D-PROD-161: `estoque_atual` NÃO é campo editável (cache do motor físico);
  // o corpo que o traz é conferido por `estoqueInformado`/`exigir*` abaixo.
  estoque_minimo: (v) => decimalComDefault(v, 0),
  local_estoque: (v) => textoOuNulo(v),
  tipo_consumo: (v) => textoOuNulo(v),
  percentual_consumo_pv: (v) => decimalOuNulo(v),
  consumo_minimo_pv: (v) => decimalOuNulo(v),
  consumo_maximo_pv: (v) => decimalOuNulo(v),
  unidade_principal_estoque: (v) => textoOuNulo(v) ?? undefined,
  peso_por_saco_kg: (v) => decimalOuNulo(v),
  carencia_dias: (v) => carenciaDoCorpo(v),
  observacoes: (v) => textoOuNulo(v),
  ativo: (v) => (v === undefined ? undefined : Boolean(v)),
});

/** @param {Record<string, unknown>} entrada */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const [campo, tratar] of Object.entries(CAMPOS_EDITAVEIS)) {
    if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
    const valor = tratar(entrada[campo]);
    if (valor !== undefined) saida[campo] = valor;
  }
  return saida;
};

/**
 * D-PROD-162 / D-PROD-169: unidades de estoque que um tanque do Patrimônio
 * aceita — qualquer unidade do cadastro (L, KG ou SACO; SACO abastece em kg).
 * Espelho de `UNIDADES_PRODUTO_TANQUE` (patrimonio/patrimonioDominio.js).
 */
const UNIDADES_DO_TANQUE = Object.freeze(['L', 'KG', 'SACO']);

/**
 * D-PROD-177 (Estoque P1-02, contrato §5 C1): domínio FECHADO da unidade de
 * estoque do Produto. Unidade física-base: kg para KG e SACO (o SACO vira kg
 * pelo `peso_por_saco_kg`), L para L. Nada de conversão L ↔ KG. `UN` e
 * qualquer outro texto não geram movimento físico.
 *  - criação: ausente → 'KG' (como antes); fora do domínio → 400;
 *  - edição: só a unidade NOVA (diferente da gravada) é conferida. O produto
 *    legado com unidade fora do domínio continua editável nos outros campos
 *    reenviando a MESMA unidade; a migração desses dados depende de GO.
 * Comparação exata, depois de aparar espaços (`camposDe`): 'kg' não é 'KG'.
 */
export const UNIDADES_ESTOQUE = Object.freeze(['KG', 'SACO', 'L']);

/** Recusa a unidade fora do domínio ANTES de qualquer escrita (nada foi gravado). @param {unknown} unidade */
const exigirUnidadeDoDominio = (unidade) => {
  if (UNIDADES_ESTOQUE.includes(/** @type {string} */ (unidade))) return;
  throw new AppError('REQUEST_VALIDATION_FAILED', 'unidade de estoque inválida: use KG, SACO ou L; nada foi gravado', {
    details: { field: 'unidade_principal_estoque', reason: 'unidade_invalida', informado: unidade, permitidos: [...UNIDADES_ESTOQUE] },
  });
};

/**
 * D-PROD-162 (achado D1): o aceite que VALE — ativo, num tanque ativo de um bem
 * ativo. Aceite em tanque inativo (ou de bem inativo) não trava o Produto: o
 * abastecimento relê o Produto e o recusa, e reativar o tanque/bem revalida.
 * @param {string} clienteId @param {string} produtoId
 */
const aceiteQueVale = (clienteId, produtoId) => ({ cliente_id: clienteId, produto_id: produtoId, ativo: true, tanque: { ativo: true, bem: { ativo: true } } });

/** `[{ bem_id, bem_numero, tanque_id, identificador }]` dos aceites que valem (ordem estável). */
const tanquesQueAceitam = async (tx, clienteId, produtoId) => {
  const linhas = await tx.tanqueBemProduto.findMany({
    where: aceiteQueVale(clienteId, produtoId),
    orderBy: { id: 'asc' },
    select: { tanque: { select: { id: true, identificador: true, bem: { select: { id: true, numero: true } } } } },
  });
  return linhas
    .map((l) => ({ bem_id: l.tanque.bem.id, bem_numero: l.tanque.bem.numero, tanque_id: l.tanque.id, identificador: l.tanque.identificador }))
    .sort((a, b) => a.bem_numero.localeCompare(b.bem_numero, 'pt-BR', { numeric: true }) || a.identificador.localeCompare(b.identificador, 'pt-BR') || a.tanque_id.localeCompare(b.tanque_id));
};

const unidadeEmUso = (id, de, para, reason, extra = {}) =>
  new AppError('PRODUTO_UNIDADE_EM_USO', reason === 'aceito_em_tanque'
    ? 'produto aceito em tanque de bem patrimonial só usa estoque em L, KG ou SACO; tire-o dos “Produtos aceitos” do tanque no cadastro de Bens antes; nada foi gravado'
    : 'a unidade de estoque não muda de ou para litros (L) num produto com estoque, lotes, movimentos ou lançamentos; cadastre um Produto novo em litros, ex.: “Diesel S10 (L)”; nada foi gravado', {
    details: { field: 'unidade_principal_estoque', reason, id, de, para, ...extra },
  });

/**
 * D-PROD-162 (§4.6, padrões P-08 e P-10) — a troca da unidade de estoque.
 *  - envolvendo `L` (de L ou para L): só sem histórico — `estoque` (≠ 0) →
 *    `lotes` (algum, mesmo esgotado) → `movimentos` → `lancamentos` (item da
 *    Gestão P3, rascunho inclusive), nessa ordem;
 *  - unidade nova fora de {L, KG, SACO} com aceite que vale → `aceito_em_tanque`
 *    (D-PROD-169: SACO entrou; KG ↔ SACO de Produto aceito em tanque passa —
 *    a unidade EFETIVA do estoque continua kg). D-PROD-177 (P1-02): `atualizar`
 *    já recusa a unidade nova fora de {KG, SACO, L} (400 `unidade_invalida`)
 *    antes de travar; este ramo fica como defesa, para quem chamar sem ela;
 *  - KG ↔ SACO: como antes (P-08), com ou sem tanque.
 * Corre com a linha do Produto já travada (advisory de estoque + FOR UPDATE).
 */
const conferirTrocaDeUnidade = async (tx, clienteId, anterior, para) => {
  const de = anterior.unidade_principal_estoque ?? 'KG';
  const id = anterior.id;
  if (de === 'L' || para === 'L') {
    if (!dec(anterior.estoque_atual ?? 0).isZero()) throw unidadeEmUso(id, de, para, 'estoque');
    const onde = { cliente_id: clienteId, produto_id: id };
    if ((await tx.estoqueLoteNota.count({ where: onde })) > 0) throw unidadeEmUso(id, de, para, 'lotes');
    if ((await contarMovimentacoesPorProduto(tx, clienteId, id)) > 0) throw unidadeEmUso(id, de, para, 'movimentos');
    if ((await tx.operacaoFinanceiraItem.count({ where: onde })) > 0) throw unidadeEmUso(id, de, para, 'lancamentos');
  }
  if (!UNIDADES_DO_TANQUE.includes(para)) {
    const tanques = await tanquesQueAceitam(tx, clienteId, id);
    if (tanques.length) throw unidadeEmUso(id, de, para, 'aceito_em_tanque', { tanques });
  }
};

// ─── D-PROD-161: estoque_atual somente leitura ──────────────────────────────
const ESTOQUE_ATUAL_SOMENTE_LEITURA = Object.freeze({ field: 'estoque_atual', reason: 'somente_leitura' });

const estoqueAtualNaoEditavel = (mensagem) =>
  new AppError('PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL', `${mensagem}; o estoque é alterado em Entradas/Movimentações, não no Cadastro de Produtos; nada foi gravado`, {
    details: { ...ESTOQUE_ATUAL_SOMENTE_LEITURA },
  });

/** O corpo trouxe a chave `estoque_atual` (qualquer valor)? */
const estoqueInformado = (entrada) => Object.prototype.hasOwnProperty.call(entrada ?? {}, 'estoque_atual');

/**
 * Valor do corpo → Dec SEM arredondar. O JSON entrega `number` (float):
 * `new Dec(String(n))`, porque `dec()` recusa float. Não numérico, vazio ou não
 * finito → null (quem chama recusa).
 * @param {unknown} valor
 * @returns {InstanceType<typeof Dec>|null}
 */
const estoqueDoCorpo = (valor) => {
  if (typeof valor === 'number' && !Number.isFinite(valor)) return null;
  if (typeof valor !== 'number' && (typeof valor !== 'string' || !valor.trim())) return null;
  try {
    const d = new Dec(String(valor).trim());
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
};

/**
 * POST: ausente ou numericamente 0 segue (o servidor grava 0); qualquer outro
 * valor → 422, sem arredondar: 0,00001 não é 0 (o cadastro não cria saldo nenhum).
 * @param {Record<string, unknown>} entrada
 */
const exigirEstoqueZeroNaCriacao = (entrada) => {
  if (!estoqueInformado(entrada)) return;
  const valor = estoqueDoCorpo(entrada.estoque_atual);
  if (valor === null || !valor.isZero()) {
    throw estoqueAtualNaoEditavel('estoque_atual não é informado no cadastro do produto: só 0 ou ausente');
  }
};

/**
 * PATCH: com a linha JÁ travada e relida, o valor do corpo arredondado UMA vez
 * (ROUND_HALF_UP, 4 casas: a escala da coluna) tem de ser o atual (sem efeito);
 * diferente → 422. O valor nunca é gravado.
 * @param {Record<string, unknown>} entrada @param {{estoque_atual: unknown}} atual
 */
const exigirEstoqueIgualAoAtual = (entrada, atual) => {
  if (!estoqueInformado(entrada)) return;
  const valor = estoqueDoCorpo(entrada.estoque_atual);
  if (valor === null || !valor.toDecimalPlaces(CASAS_QUANTIDADE, Dec.ROUND_HALF_UP).equals(dec(atual.estoque_atual))) {
    throw estoqueAtualNaoEditavel('estoque_atual não é editável pelo cadastro do produto: só o valor atual (sem efeito) é aceito');
  }
};

/**
 * Troca de empresa (linha já em FOR UPDATE): lote, movimento ou cache ≠ 0
 * ficariam na fazenda antiga → 409. Lotes de qualquer situação contam.
 */
const exigirProdutoSemEstoqueParaTrocarEmpresa = async (tx, clienteId, anterior) => {
  const lotes = await contarLotesPorProduto(tx, clienteId, anterior.id);
  const movimentos = await contarMovimentacoesPorProduto(tx, clienteId, anterior.id);
  const cache = dec(anterior.estoque_atual);
  if (lotes > 0 || movimentos > 0 || !cache.isZero()) {
    throw new AppError(
      'PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA',
      'produto com lote, movimento de estoque ou estoque atual diferente de zero não muda de fazenda: lotes e movimentos ficariam na fazenda antiga; cadastre um produto na fazenda nova; nada foi gravado',
      { details: { id: anterior.id, lotes, movimentos, estoque_atual: cache.toFixed(CASAS_QUANTIDADE) } }
    );
  }
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {{empresa_id?: string, ativo?: boolean}} [filtros] */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarProdutos(auth.clienteId, filtros);
  return registros.map(comoProdutoPublico);
};

/**
 * Listagem paginada keyset — motor Base1 (D-PROD-55).
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} query
 */
export const listarPagina = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const limit = normalizarLimite(query.limit);
  const empresaId =
    typeof query.empresa_id === 'string' && query.empresa_id.trim()
      ? query.empresa_id.trim()
      : null;
  if (!empresaId) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'empresa_id é obrigatório');
  }
  const q = typeof query.q === 'string' ? query.q : null;
  let ativo = null;
  if (query.ativo === true || query.ativo === 'true' || query.ativo === '1') ativo = true;
  if (query.ativo === false || query.ativo === 'false' || query.ativo === '0') ativo = false;

  const cursorBruto = typeof query.cursor === 'string' ? query.cursor : null;
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'cursor inválido', { details: { field: 'cursor', reason: 'cursor_invalido' } });
  }

  const filtro = { empresaId, q, ativo, cursor, limit };
  const [registros, total] = await Promise.all([
    listarProdutosPagina(auth.clienteId, filtro),
    contarProdutos(auth.clienteId, { empresaId, q, ativo }),
  ]);

  return montarEnvelopeKeyset({
    registros,
    limit,
    total,
    mapItem: comoProdutoPublico,
  });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  // D-PROD-161: antes de qualquer leitura/escrita (nem número, nem auditoria).
  exigirEstoqueZeroNaCriacao(entrada);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);
  // D-PROD-177 (P1-02): ausente → 'KG' (abaixo, como antes); informada, só KG, SACO ou L.
  if (campos.unidade_principal_estoque !== undefined) exigirUnidadeDoDominio(campos.unidade_principal_estoque);

  const criado = await prisma.$transaction(async (tx) => {
    const empresaId = String(campos.empresa_id);
    const nome = String(campos.nome_produto);
    if (await existeProdutoComNome(auth.clienteId, empresaId, nome, undefined, tx)) {
      throw produtoNomeConflito();
    }

    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const registro = await inserirProduto(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      numero_produto: String(numero),
      // D-PROD-161: o cadastro nunca cria saldo (o motor físico é a única porta).
      estoque_atual: 0,
      estoque_minimo: campos.estoque_minimo ?? 0,
      unidade_principal_estoque: campos.unidade_principal_estoque ?? 'KG',
    });

    const publico = comoProdutoPublico(registro);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'Produto', entidadeId: registro.id, dadosNovos: publico },
      tx
    );
    return publico;
  });

  return criado;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, unknown>} entrada */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);

  // D-PROD-155 (§8.4): a linha do Produto pode estar em FOR UPDATE por uma
  // confirmação/cancelamento/suplementação: espera em vez de estourar os 5 s
  // padrão (500), até caber nos 20 s do navegador (TRANSACAO_CURTA). PATCH de
  // valores absolutos: repetir depois do 409 leva ao mesmo estado.
  return emTransacao(TRANSACAO_CURTA, async (tx) => {
    const campos = camposDe(entrada);
    // D-PROD-162 (§4.6): trocar a unidade de estoque toma a MESMA trava dos
    // escritores de estoque (advisory `estoque:produto:*` → FOR UPDATE, nesta
    // ordem: sem deadlock com confirmação/cancelamento/abastecimento) ANTES de
    // qualquer outra trava do Produto. A unidade é lida sem trava só para saber
    // se há troca; sob a trava ela é relida e, se mudou no meio, 409.
    const lida = campos.unidade_principal_estoque !== undefined ? await buscarProduto(auth.clienteId, id, tx) : null;
    if (campos.unidade_principal_estoque !== undefined && !lida) throw produtoNotFound();
    const trocaUnidade = Boolean(lida) && campos.unidade_principal_estoque !== (lida.unidade_principal_estoque ?? 'KG');
    // D-PROD-177 (P1-02): a unidade NOVA tem de ser KG, SACO ou L — antes de
    // travar e de qualquer escrita. Reenviar a MESMA unidade legada (fora do
    // domínio) não é troca e passa: o produto legado segue editável nos outros
    // campos. Se a unidade mudou entre esta leitura e a trava, o 409 abaixo sai.
    if (trocaUnidade) exigirUnidadeDoDominio(campos.unidade_principal_estoque);
    if (trocaUnidade) await travarProdutosEstoque(tx, auth.clienteId, lida.empresa_id, [id]);
    // D-PROD-157 (R2) / D-PROD-162: o aceite ATIVO do Produto num tanque do
    // Patrimônio exige que ele continue na MESMA empresa (invariante do serviço:
    // Produto não tem unique por empresa). Corpo com `empresa_id` (o formulário
    // sempre reenvia a que leu) ou com a unidade trava a linha ANTES de ler o
    // estado anterior, para a comparação usar a versão confirmada mais nova
    // (uma troca concorrente fica em fila):
    //  - FOR NO KEY UPDATE, a mesma força do UPDATE comum: não disputa com o
    //    FOR KEY SHARE de rascunhos de lançamento nem de quem acrescenta o
    //    Produto a um tanque;
    //  - só se a fazenda MUDA sobe para FOR UPDATE (espera quem segura o
    //    produto em KEY SHARE, como um aceite em voo), relê e conta.
    //  - D-PROD-161: corpo com `estoque_atual` também trava (FOR NO KEY UPDATE
    //    espera o FOR UPDATE de `travarProdutosEstoque`): a comparação usa o
    //    cache que o motor acabou de commitar, e o valor nunca é gravado.
    //  - D-PROD-161 (R2, achado B-02/LC-1): e QUALQUER corpo trava antes de ler,
    //    não só com `empresa_id`/`estoque_atual`. Sem isso, o PATCH de um cliente
    //    de API com só `{nome_produto}` lia o cache velho e, depois de esperar a
    //    baixa do motor no UPDATE, auditava `estoque_atual` 100→90 — uma escrita
    //    de cache que não fez e que a reconciliação toma como escritor fora do
    //    motor. É a mesma trava que o UPDATE já pegaria, só que antes da
    //    leitura: nenhuma trava nova antes dela, sem ciclo.
    await tx.$queryRaw`SELECT id FROM "Produto" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR NO KEY UPDATE`;
    let anterior = await buscarProduto(auth.clienteId, id, tx);
    if (!anterior) throw produtoNotFound();
    if (lida && ((anterior.unidade_principal_estoque ?? 'KG') !== (lida.unidade_principal_estoque ?? 'KG') || anterior.empresa_id !== lida.empresa_id)) {
      throw new AppError('CONCURRENCY_CONFLICT', 'a unidade de estoque ou a fazenda do produto mudou durante a gravação; recarregue e tente de novo; nada foi gravado', {
        details: { id },
      });
    }
    exigirEstoqueIgualAoAtual(entrada, anterior);

    if (campos.empresa_id !== undefined && campos.empresa_id !== anterior.empresa_id) {
      await tx.$queryRaw`SELECT id FROM "Produto" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR UPDATE`;
      anterior = await buscarProduto(auth.clienteId, id, tx);
      if (!anterior) throw produtoNotFound();
    }
    if (campos.empresa_id !== undefined && campos.empresa_id !== anterior.empresa_id) {
      const tanques = await tanquesQueAceitam(tx, auth.clienteId, id);
      if (tanques.length > 0) {
        throw new AppError('PRODUTO_EM_TANQUE_PATRIMONIO', 'produto aceito em tanque de bem patrimonial não muda de fazenda; tire-o dos “Produtos aceitos” do tanque no cadastro de Bens antes; nada foi gravado', {
          details: { field: 'empresa_id', reason: 'aceito_em_tanque', id, tanques },
        });
      }
      // D-PROD-161: depois do aceite em tanque do Patrimônio (antes, do vínculo a
      // combustível; código e ordem de antes).
      await exigirProdutoSemEstoqueParaTrocarEmpresa(tx, auth.clienteId, anterior);
    }
    if (trocaUnidade) await conferirTrocaDeUnidade(tx, auth.clienteId, anterior, String(campos.unidade_principal_estoque));
    if (campos.nome_produto && campos.nome_produto !== anterior.nome_produto) {
      const empresa = String(campos.empresa_id ?? anterior.empresa_id);
      const nome = String(campos.nome_produto);
      if (await existeProdutoComNome(auth.clienteId, empresa, nome, id, tx)) {
        throw produtoNomeConflito();
      }
    }

    const registro = Object.keys(campos).length
      ? await atualizarProdutoPorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publico = comoProdutoPublico(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Produto',
        entidadeId: id,
        dadosAnteriores: comoProdutoPublico(anterior),
        dadosNovos: publico,
      },
      tx
    );
    // Cochos e manejos só guardam o NOME do produto: acompanham a renomeação
    // aqui, com o nome antigo do banco e na mesma transação — não pelo
    // /referencias/sincronizar, que não aceita mais nome do corpo (D-PROD-137).
    await registrarPropagacao(contexto, 'Produto', id, await propagarRenomeacaoDeProduto(tx, auth.clienteId, anterior, registro), tx);
    return publico;
  }, {}, MENSAGEM_CONFLITO_SEM_CHAVE);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    // D-PROD-157 (R2) / D-PROD-162: trava o produto ANTES das contagens (padrão
    // da exclusão do parceiro): quem o está acrescentando a um tanque do
    // Patrimônio segura a linha (FOR KEY SHARE) e esta exclusão espera o commit;
    // a contagem já o vê e o 409 sai no lugar do 403 da FK.
    await tx.$queryRaw`SELECT id FROM "Produto" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR UPDATE`;
    const anterior = await buscarProduto(auth.clienteId, id, tx);
    if (!anterior) throw produtoNotFound();

    const quantidade = await contarMovimentacoesPorProduto(tx, auth.clienteId, id);
    if (quantidade > 0) {
      throw produtoDeleteBlocked(quantidade, { details: { id, vinculo: 'movimentações de estoque' } });
    }
    // D-PROD-161: lote (de qualquer situação) sem movimento — legado ou import —
    // também segura o produto: a exclusão deixaria o lote órfão (sem FK).
    const lotes = await contarLotesPorProduto(tx, auth.clienteId, id);
    if (lotes > 0) {
      throw new AppError('PRODUTO_DELETE_BLOCKED', 'não é possível excluir produto com lotes de estoque; inative-o', {
        details: { id, vinculo: 'lotes de estoque', quantidade: lotes },
      });
    }
    // D-PROD-155 (§8.5): item de lançamento financeiro (rascunho inclusive) segura
    // o produto pela FK RESTRICT; 409 em vez do enganoso 403.
    const itensFinanceiros = await tx.operacaoFinanceiraItem.count({ where: { cliente_id: auth.clienteId, produto_id: id } });
    if (itensFinanceiros > 0) {
      throw new AppError('PRODUTO_DELETE_BLOCKED', 'não é possível excluir produto usado em lançamentos financeiros; inative-o', {
        details: { id, vinculo: 'lançamentos financeiros', quantidade: itensFinanceiros },
      });
    }
    // D-PROD-162 (§4.6): as linhas de `TanqueBemProduto` que SOBRAM (ativas, ou
    // inativas com histórico — o sync do bem apaga a retirada sem abastecimento)
    // seguram o produto pela FK RESTRICT; 409, nunca 403. Com histórico há
    // movimento, e a contagem de movimentos acima já bloqueou.
    const aceites = await tx.tanqueBemProduto.count({ where: { cliente_id: auth.clienteId, produto_id: id } });
    if (aceites > 0) {
      throw new AppError('PRODUTO_DELETE_BLOCKED', 'não é possível excluir produto aceito em tanque de bem patrimonial; tire-o dos “Produtos aceitos” do tanque no cadastro de Bens ou inative-o', {
        details: { id, vinculo: 'tanques do patrimônio', quantidade: aceites },
      });
    }

    await excluirProdutoPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'Produto',
        entidadeId: id,
        dadosAnteriores: comoProdutoPublico(anterior),
      },
      tx
    );
  });
};
