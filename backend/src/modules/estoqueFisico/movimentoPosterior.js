/**
 * D-PROD-264 → D-PROD-268 — "nada depois no poço": a regra do ÚLTIMO, compartilhada.
 *
 * Extraída sem mudança de `exigirNadaDepois` (saidaEstoqueService.js, D-PROD-264). Um movimento só pode ser
 * desfeito pelo estorno exato se o produto NÃO teve outro movimento, no(s) depósito(s) dele, depois dele: o
 * estorno devolve o valor gravado e nunca recalcula o que veio depois (uma baixa posterior foi valorizada
 * pelo médio que já incluía o movimento a desfazer).
 *
 * "Depois" é fail-closed por TRÊS critérios, qualquer um basta (o mesmo SQL da D-PROD-264):
 *  - `createdAt` igual ou posterior ao da referência;
 *  - número de movimento não numérico (provisório `p-…` ou legado): sem ordem provada, conta como depois;
 *  - número sequencial maior que o da referência (atribuído sob a trava do produto, logo na ordem real),
 *    quando o número da referência é numérico.
 *
 * Quem chama segura a trava do produto (`travarProdutosEstoque`): nenhum escritor do protocolo corre junto.
 * Toda consulta começa por `cliente_id` (R11: o tenant vem do auth_context de quem chama) e usa o índice
 * `(cliente_id, produto_id)`.
 *
 * PAR NEUTRO (D-PROD-268, cocho, opcional): uma Saída 'Estornada' no MESMO depósito cujo filho é uma Entrada
 * `estorno_*` ativa, com pai = ela, no mesmo depósito, com a mesma quantidade e o mesmo valor total, as DUAS
 * pernas depois da referência. O motor devolve o valor gravado, então o par não muda nem a quantidade nem o
 * valor do poço. A transferência nunca é par neutro (o filho dela é a Entrada no OUTRO depósito), nem a
 * compra + `estorno_compra` (o pai é a Entrada).
 */
import { AppError } from '../../shared/errors/AppError.js';
import { dec } from '../financeiro/decimalFinanceiro.js';

/**
 * D-PROD-273 (fatia 4) — marca do par excluído COM recálculo (`movimentacao_grupo_id` do original e do estorno). Esse
 * par está FORA da sequência (o recálculo regravou o que veio depois sem ele): nunca é "movimento posterior" de nada,
 * em nenhum caminho (exclusão, cancelamento do cocho e da transferência, edição D-PROD-271). A regra mora AQUI, num
 * ponto só; o replay (`estoqueReplay.js`) usa a mesma constante.
 */
export const MARCA_EXCLUSAO_RECALCULO = 'exclusao_recalculo:';

/** Teto de linhas lidas no modo com pares neutros; acima dele a recusa é fail-closed (primeira linha). */
const TETO_POSTERIORES = 500;

/**
 * @typedef {{ id: string, numero_movimentacao: string, createdAt: Date, tipo_movimentacao: string, tipo_detalhado: string|null,
 *   status: string, local_estoque_origem: string|null, local_estoque_destino: string|null, local_estoque_id: string|null }} MovimentoPosterior
 */

/** Local do poço (dentre `locais`) que o movimento toca: o de origem primeiro. */
const localTocado = (m, locais) => (locais.includes(m.local_estoque_origem) ? m.local_estoque_origem : locais.includes(m.local_estoque_destino) ? m.local_estoque_destino : null);

const comoPosterior = (m, locais) => ({
  id: m.id,
  numero_movimentacao: m.numero_movimentacao,
  createdAt: m.createdAt,
  tipo_movimentacao: m.tipo_movimentacao,
  tipo_detalhado: m.tipo_detalhado ?? null,
  status: m.status,
  local_estoque_origem: m.local_estoque_origem ?? null,
  local_estoque_destino: m.local_estoque_destino ?? null,
  local_estoque_id: localTocado(m, locais),
});

const mesmoValor = (a, b) => (a === null || a === undefined || b === null || b === undefined ? a === b : dec(a).eq(dec(b)));

/**
 * Pares neutros entre as linhas posteriores (as duas pernas na lista): Saída 'Estornada' só com origem no
 * poço → Entrada `estorno_*` 'Ativa', sem filho, com pai = ela, só com destino no mesmo local, mesma
 * quantidade e mesmo valor total.
 * @param {any[]} linhas @param {string[]} locais
 * @returns {Set<string>} ids das pernas neutras
 */
const paresNeutros = (linhas, locais) => {
  const porId = new Map(linhas.map((m) => [m.id, m]));
  /** @type {Set<string>} */
  const neutros = new Set();
  for (const s of linhas) {
    if (s.tipo_movimentacao !== 'Saída' || s.status !== 'Estornada' || !s.movimento_filho_id) continue;
    if (!locais.includes(s.local_estoque_origem) || s.local_estoque_destino) continue;
    const e = porId.get(s.movimento_filho_id);
    if (!e || e.tipo_movimentacao !== 'Entrada' || e.status !== 'Ativa' || e.movimento_filho_id || e.movimento_pai_id !== s.id) continue;
    if (e.local_estoque_destino !== s.local_estoque_origem || e.local_estoque_origem) continue;
    if (typeof e.tipo_detalhado !== 'string' || !e.tipo_detalhado.startsWith('estorno_')) continue;
    if (!mesmoValor(e.quantidade, s.quantidade) || !mesmoValor(e.valor_total, s.valor_total)) continue;
    neutros.add(s.id);
    neutros.add(e.id);
  }
  return neutros;
};

/**
 * Primeiro movimento do produto, nos `locais` (origem OU destino), DEPOIS da referência `desde`, fora de
 * `ignorarIds` e dos pares excluídos com recálculo (`MARCA_EXCLUSAO_RECALCULO`); `null` quando não há nenhum. Ordem: `createdAt` decrescente, depois id (a da D-PROD-264).
 * Com `ignorarParesNeutros: false` (padrão) é exatamente a consulta de `exigirNadaDepois` da D-PROD-264
 * (com um local e um id ignorado). Com `true`, desconta os pares neutros (ver o topo do arquivo).
 * Quem chama decide o código de erro.
 * @param {any} tx
 * @param {string} clienteId do auth_context de quem chama
 * @param {{ empresaId: string, produtoId: string, locais: string[], ignorarIds: string[],
 *   desde: { createdAt: Date, numero: string|null }, ignorarParesNeutros?: boolean }} a
 * @returns {Promise<MovimentoPosterior|null>}
 */
export const buscarMovimentoPosterior = async (tx, clienteId, a) => {
  const locais = [...new Set((a.locais ?? []).filter((v) => typeof v === 'string' && v))];
  const ignorar = [...new Set((a.ignorarIds ?? []).filter((v) => typeof v === 'string' && v))];
  if (!locais.length) throw new Error('buscarMovimentoPosterior: ao menos um local');
  if (!(a.desde?.createdAt instanceof Date) || Number.isNaN(a.desde.createdAt.getTime())) throw new Error('buscarMovimentoPosterior: desde.createdAt obrigatório');
  const numero = a.desde.numero ?? '';
  const neutros = a.ignorarParesNeutros === true;
  const limite = neutros ? TETO_POSTERIORES : 1;
  const linhas = /** @type {any[]} */ (await tx.$queryRaw`SELECT m.id, m.numero_movimentacao, m."createdAt", m.tipo_movimentacao, m.tipo_detalhado, m.status,
        m.local_estoque_origem, m.local_estoque_destino, m.movimento_pai_id, m.movimento_filho_id, m.quantidade, m.valor_total
      FROM "MovimentacaoEstoque" m
      WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${a.empresaId} AND m.produto_id = ${a.produtoId} AND m.id <> ALL(${ignorar}::text[])
        AND (m.local_estoque_origem = ANY(${locais}::text[]) OR m.local_estoque_destino = ANY(${locais}::text[]))
        AND NOT starts_with(COALESCE(m.movimentacao_grupo_id, ''), ${MARCA_EXCLUSAO_RECALCULO})
        AND (m."createdAt" >= ${a.desde.createdAt}
          OR m.numero_movimentacao !~ '^[0-9]{1,30}$'
          OR (${numero} ~ '^[0-9]{1,30}$' AND m.numero_movimentacao::numeric > ${numero}::numeric))
      ORDER BY m."createdAt" DESC, m.id LIMIT ${limite}::int`);
  if (!linhas.length) return null;
  if (!neutros) return comoPosterior(linhas[0], locais);
  const descontar = paresNeutros(linhas, locais);
  const restante = linhas.find((m) => !descontar.has(m.id));
  // Teto atingido só com pares neutros: pode haver mais linhas não lidas → recusa (fail-closed).
  if (!restante && linhas.length >= limite) return comoPosterior(linhas[0], locais);
  return restante ? comoPosterior(restante, locais) : null;
};

/**
 * Atalho por movimento de referência: lê o movimento (id, número, `createdAt`) por `(cliente_id, id)` e
 * procura o primeiro posterior no `localId`, ignorando só ele. É o laço de `exigirNadaDepois` (D-PROD-264).
 * @param {any} tx
 * @param {string} clienteId do auth_context de quem chama
 * @param {{ empresaId: string, movimentoId: string, produtoId: string, localId: string, ignorarParesNeutros?: boolean }} a
 * @returns {Promise<MovimentoPosterior|null>}
 * @throws 404 MOVIMENTACAO_ESTOQUE_NOT_FOUND se o movimento de referência não existe no tenant
 */
export const buscarMovimentoPosteriorA = async (tx, clienteId, a) => {
  const [original] = /** @type {any[]} */ (await tx.$queryRaw`SELECT id, numero_movimentacao, "createdAt" FROM "MovimentacaoEstoque" WHERE cliente_id = ${clienteId} AND id = ${a.movimentoId}`);
  if (!original) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'movimento de estoque da saída não encontrado');
  return buscarMovimentoPosterior(tx, clienteId, {
    empresaId: a.empresaId,
    produtoId: a.produtoId,
    locais: [a.localId],
    ignorarIds: [original.id],
    desde: { createdAt: original.createdAt, numero: original.numero_movimentacao },
    ignorarParesNeutros: a.ignorarParesNeutros === true,
  });
};

/**
 * D-PROD-314 — "só o último" no estoque: o primeiro REGISTRO POSTERIOR QUE AINDA VALE, no produto e nos `locais`
 * (origem OU destino), depois da referência `desde` (o mesmo critério fail-closed de "depois" de
 * `buscarMovimentoPosterior`), fora de `ignorarIds`. Não contam (não vinculam nada ao movimento de referência):
 *  - os pares excluídos com recálculo (`MARCA_EXCLUSAO_RECALCULO`);
 *  - o original 'Estornada' que tem um estorno `estorno_*` dele (o par saiu: volta o valor gravado);
 *  - o estorno `estorno_*` de um original 'Estornada'.
 * Qualquer outro movimento depois (cocho, saída, venda, atividade, abastecimento, transferência, entrada, compra,
 * ajuste) foi lançado com o saldo e o médio que incluíam o movimento de referência: ele vincula e recusa a exclusão.
 * Devolve o MAIS RECENTE deles (é o que tem de sair primeiro), com a data e o nome do depósito para a mensagem.
 * @param {any} tx @param {string} clienteId do auth_context de quem chama
 * @param {{ empresaId: string, produtoId: string, locais: string[], ignorarIds: string[], desde: { createdAt: Date, numero: string|null } }} a
 * @returns {Promise<(MovimentoPosterior & { data_movimentacao: Date|null, origem_sistema: string|null, local_nome: string|null })|null>}
 */
export const buscarRegistroPosteriorValendo = async (tx, clienteId, a) => {
  const locais = [...new Set((a.locais ?? []).filter((v) => typeof v === 'string' && v))];
  const ignorar = [...new Set((a.ignorarIds ?? []).filter((v) => typeof v === 'string' && v))];
  if (!locais.length) throw new Error('buscarRegistroPosteriorValendo: ao menos um local');
  if (!(a.desde?.createdAt instanceof Date) || Number.isNaN(a.desde.createdAt.getTime())) throw new Error('buscarRegistroPosteriorValendo: desde.createdAt obrigatório');
  const numero = a.desde.numero ?? '';
  const [m] = /** @type {any[]} */ (await tx.$queryRaw`SELECT m.id, m.numero_movimentacao, m."createdAt", m.tipo_movimentacao, m.tipo_detalhado, m.status,
        m.local_estoque_origem, m.local_estoque_destino, m.data_movimentacao, m.origem_sistema
      FROM "MovimentacaoEstoque" m
      WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${a.empresaId} AND m.produto_id = ${a.produtoId} AND m.id <> ALL(${ignorar}::text[])
        AND (m.local_estoque_origem = ANY(${locais}::text[]) OR m.local_estoque_destino = ANY(${locais}::text[]))
        AND NOT starts_with(COALESCE(m.movimentacao_grupo_id, ''), ${MARCA_EXCLUSAO_RECALCULO})
        AND (m."createdAt" >= ${a.desde.createdAt}
          OR m.numero_movimentacao !~ '^[0-9]{1,30}$'
          OR (${numero} ~ '^[0-9]{1,30}$' AND m.numero_movimentacao::numeric > ${numero}::numeric))
        AND NOT (m.status = 'Estornada' AND EXISTS (SELECT 1 FROM "MovimentacaoEstoque" e
          WHERE e.cliente_id = m.cliente_id AND e.movimento_pai_id = m.id AND starts_with(COALESCE(e.tipo_detalhado, ''), 'estorno_')))
        AND NOT (starts_with(COALESCE(m.tipo_detalhado, ''), 'estorno_') AND EXISTS (SELECT 1 FROM "MovimentacaoEstoque" o
          WHERE o.cliente_id = m.cliente_id AND o.id = m.movimento_pai_id AND o.status = 'Estornada'))
      ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1`);
  if (!m) return null;
  const base = comoPosterior(m, locais);
  const local = base.local_estoque_id
    ? await tx.localEstoque.findFirst({ where: { cliente_id: clienteId, id: base.local_estoque_id }, select: { nome: true } })
    : null;
  return { ...base, data_movimentacao: m.data_movimentacao ?? null, origem_sistema: m.origem_sistema ?? null, local_nome: local?.nome ?? null };
};

/** Nome do registro posterior para a mensagem (o mesmo vocabulário da tela). */
const nomeDoRegistro = (m) => {
  const t = typeof m.tipo_detalhado === 'string' ? m.tipo_detalhado : '';
  if (t === 'suplementacao' || m.origem_sistema === 'suplementacao') return 'o lançamento no cocho';
  if (m.origem_sistema === 'abastecimento_patrimonio') return 'o abastecimento';
  if (m.origem_sistema === 'apontamento_atividade') return 'a atividade';
  if (t.startsWith('transferencia')) return 'a transferência';
  if (t === 'venda_financeiro') return 'a venda';
  if (t === 'compra_financeiro') return 'a compra';
  if (t === 'ajuste_sobra' || t === 'ajuste_falta') return 'o ajuste de inventário';
  if (t === 'saida_manual') return 'a saída';
  return m.tipo_movimentacao === 'Entrada' ? 'a entrada' : 'a saída';
};

const diaBr = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10).split('-').reverse().join('/') : null);

/**
 * 409 `ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR` (D-PROD-314): há um registro depois deste movimento, no mesmo produto e
 * depósito, que ainda vale. Exclua primeiro o mais recente.
 * @param {NonNullable<Awaited<ReturnType<typeof buscarRegistroPosteriorValendo>>>} p
 * @param {{ movimento_id?: string, linha_id?: string }} [extra]
 */
export const recusaRegistroPosterior = (p, extra = {}) => {
  const dia = diaBr(p.data_movimentacao);
  const onde = p.local_nome ? ` no depósito ${p.local_nome}` : '';
  const qual = `${nomeDoRegistro(p)} nº ${p.numero_movimentacao}${dia ? ` de ${dia}` : ''}`;
  return new AppError('ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', `há registro lançado depois deste movimento${onde}; exclua primeiro o mais recente (${qual}); nada foi alterado`, {
    details: {
      field: 'movimento_id', reason: 'registro_posterior', ...extra,
      posterior_id: p.id, posterior_numero: p.numero_movimentacao, posterior_tipo: p.tipo_detalhado ?? p.tipo_movimentacao,
      posterior_origem: p.origem_sistema, posterior_data: dia ? /** @type {Date} */ (p.data_movimentacao).toISOString().slice(0, 10) : null,
      local_estoque_id: p.local_estoque_id, local_nome: p.local_nome,
    },
  });
};

/**
 * D-PROD-314 — os PARES JÁ EXCLUÍDOS pelo estorno exato (sem a marca do recálculo) lançados depois da referência, no
 * produto e nos `locais`. Quando só eles vêm depois (`buscarRegistroPosteriorValendo` vazio), o recálculo os tira da
 * sequência junto com o movimento excluído (e os marca), em vez de refazê-los: refeitos sem o movimento, a perna de
 * saída do par deixaria um saldo negativo falso no meio da sequência e o movimento nunca mais sairia.
 * Devolve os pares no desenho do replay (`paresMarcados`): [original, estorno]; na transferência, os DOIS pares
 * (S + E_o e R + E_d) ou nenhum. Par com perna de grupo legado preenchido fica de fora (não se sobrescreve).
 * @param {any} tx @param {string} clienteId do auth_context de quem chama
 * @param {{ empresaId: string, produtoId: string, locais: string[], ignorarIds: string[], desde: { createdAt: Date, numero: string|null } }} a
 * @returns {Promise<Array<[string, string]>>}
 */
export const buscarParesExcluidosDepois = async (tx, clienteId, a) => {
  const locais = [...new Set((a.locais ?? []).filter((v) => typeof v === 'string' && v))];
  const ignorar = [...new Set((a.ignorarIds ?? []).filter((v) => typeof v === 'string' && v))];
  if (!locais.length) return [];
  const numero = a.desde.numero ?? '';
  const originais = /** @type {any[]} */ (await tx.$queryRaw`SELECT m.id FROM "MovimentacaoEstoque" m
      WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${a.empresaId} AND m.produto_id = ${a.produtoId} AND m.id <> ALL(${ignorar}::text[])
        AND (m.local_estoque_origem = ANY(${locais}::text[]) OR m.local_estoque_destino = ANY(${locais}::text[]))
        AND m.status = 'Estornada' AND m.movimentacao_grupo_id IS NULL AND NOT starts_with(COALESCE(m.tipo_detalhado, ''), 'estorno_')
        AND (m."createdAt" >= ${a.desde.createdAt}
          OR m.numero_movimentacao !~ '^[0-9]{1,30}$'
          OR (${numero} ~ '^[0-9]{1,30}$' AND m.numero_movimentacao::numeric > ${numero}::numeric))
      ORDER BY m."createdAt", m.id LIMIT ${TETO_POSTERIORES}::int`);
  if (!originais.length) return [];
  const ids = originais.map((o) => o.id);
  // As pernas e os estornos que podem estar envolvidos: os originais, os filhos e os pais deles e os filhos destes.
  const ler = (lista) => tx.movimentacaoEstoque.findMany({
    where: { cliente_id: clienteId, empresa_id: a.empresaId, OR: [{ id: { in: lista } }, { movimento_pai_id: { in: lista } }] },
    select: { id: true, status: true, tipo_detalhado: true, movimento_pai_id: true, movimento_filho_id: true, movimentacao_grupo_id: true },
  });
  const primeiros = await ler(ids);
  const ligados = [...new Set(primeiros.flatMap((m) => [m.movimento_pai_id, m.movimento_filho_id]).filter(Boolean))];
  const todos = new Map([...primeiros, ...(ligados.length ? await ler(ligados) : [])].map((m) => [m.id, m]));
  const livre = (m) => m && (m.movimentacao_grupo_id === null || m.movimentacao_grupo_id === undefined);
  const ehEstorno = (m) => typeof m?.tipo_detalhado === 'string' && m.tipo_detalhado.startsWith('estorno_');
  /** Par simples: original 'Estornada' + o filho estorno dele. */
  const parSimples = (o) => {
    const e = o?.movimento_filho_id ? todos.get(o.movimento_filho_id) : null;
    return o?.status === 'Estornada' && livre(o) && e && ehEstorno(e) && e.movimento_pai_id === o.id && livre(e) ? [o.id, e.id] : null;
  };
  /** Transferência: S (filho = R) + E_o (pai = S) e R + E_d (filho de R). */
  const parTransferencia = (s) => {
    const r = s?.movimento_filho_id ? todos.get(s.movimento_filho_id) : null;
    const eo = [...todos.values()].find((x) => x.movimento_pai_id === s?.id && x.tipo_detalhado === 'estorno_transferencia_enviada');
    const pr = r && r.tipo_detalhado === 'transferencia_recebida' ? parSimples(r) : null;
    if (!s || s.status !== 'Estornada' || !livre(s) || !eo || !livre(eo) || !pr) return [];
    return [[s.id, eo.id], pr];
  };
  /** @type {Map<string, [string, string]>} */
  const pares = new Map();
  for (const id of ids) {
    const o = todos.get(id);
    if (!o) continue;
    const s = o.tipo_detalhado === 'transferencia_enviada' ? o : o.tipo_detalhado === 'transferencia_recebida' ? todos.get(o.movimento_pai_id) : null;
    const lista = s ? parTransferencia(s) : [parSimples(o)].filter(Boolean);
    for (const p of lista) pares.set(p[0], /** @type {[string, string]} */ (p));
  }
  return [...pares.values()];
};
