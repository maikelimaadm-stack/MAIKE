/**
 * D-PROD-273 (fatia 4) — EXCLUSÃO COM RECÁLCULO das SAÍDAS (saída manual, cocho, linha de produto da atividade,
 * abastecimento e venda do financeiro).
 *
 * Quem exclui (o serviço da origem) segue o seu caminho de sempre, com as travas na ordem de sempre (cocho e áreas
 * antes do produto), e chama, SOB a trava do produto:
 *  1. `planejarExclusaoComRecalculo` ANTES do estorno: se nada mexeu depois do movimento no depósito dele (a mesma
 *     consulta de hoje, `buscarMovimentoPosterior`), devolve plano vazio e o estorno exato de sempre não muda. Se
 *     mexeu: lê todo o histórico do produto (tetos 422), exige que o replay SEM exclusão reproduza exatamente o
 *     gravado (senão 409 `ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL`) e simula a sequência sem o movimento (saldo
 *     negativo → 409 `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO`; numa saída não acontece, mas a checagem fica). Nada gravado.
 *  2. o estorno exato de hoje (o par original/estorno some das telas — fatia 2);
 *  3. `aplicarExclusaoComRecalculo`: marca o par (`movimentacao_grupo_id`, `marcaDoPar`) — o replay passa a deixá-lo
 *     fora da sequência —, relê o histórico, refaz a sequência e grava SÓ o que mudou: valores, saldos, médios e
 *     fatias (`lotes_consumidos`) dos movimentos posteriores (em todos os depósitos, a transferência leva o custo ao
 *     destino), as camadas (disponível, custo, situação; camada nunca é apagada — a que sobrou de uma transferência
 *     recalculada fica 'Estornado' e a que falta é criada), o rateio das observações, e os DEPENDENTES (SPEC §3):
 *     `SaidaEstoqueItem`, `AtividadeApontamentoProduto` + fatias, `AbastecimentoBem` + fatias,
 *     `OperacaoFinanceiraConsumoLote` e o custo do fechamento do cocho em `SuplementacaoEvento.dados`. Cada valor
 *     reescrito vai para o AuditLog (`estoque.recalculo`, antes → depois, autor, motivo, o movimento excluído). No fim
 *     relê tudo e exige replay = gravado; qualquer diferença desfaz a transação inteira (409).
 *
 * Fora daqui (fatia 5): entradas, compra, transferência, ajuste e edição (D-PROD-271) — continuam com a recusa.
 * O tenant vem do `auth_context` (R11); toda consulta começa por `cliente_id`.
 */
import { randomUUID } from 'node:crypto';

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEventosEmLote } from '../auditoria/auditService.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, dec, paraBanco } from '../financeiro/decimalFinanceiro.js';
import { travarProdutosEstoque } from '../estoqueFisico/estoqueFisicoMotor.js';
import { buscarMovimentoPosterior } from '../estoqueFisico/movimentoPosterior.js';
import { recomporRateio } from '../estoqueFisico/rateioObservacoes.js';
import { recalcularCustosDosCochos } from '../suplementacaoEventos/fechamentoCustoCocho.js';
import {
  CAMPOS_VALOR, CLASSE, MARCA_EXCLUSAO_RECALCULO, classificar, compararCanonico, compararComGravado, fatiaComoTexto, fatiasGravadas, marcaDoPar, reproduzir, simularExclusao, texto4,
} from './estoqueReplay.js';
import { TETO_MOVIMENTOS_AFETADOS, TETO_MOVIMENTOS_PRODUTO, lerHistoricoDoProduto, volumeExcedido } from './estoqueRecalculoLeitor.js';
import { exigirReplayIgualAoGravado, recalculoInviavel } from './estoqueRecalculoService.js';

export const ACAO_AUDITORIA_RECALCULO = 'estoque.recalculo';
const SITUACAO_CANCELADO = 'cancelado';
const AMOSTRA = 20;

/**
 * @typedef {{ produtoId: string, excluirIds: string[], posteriores: number }} PlanoRecalculo
 */

/** Saldo negativo na simulação → 409 `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO` (a recusa da SPEC §4.4). */
const saldoNegativo = (detalhes) =>
  new AppError('ESTOQUE_EXCLUSAO_SALDO_NEGATIVO', `sem este movimento o saldo do depósito ficaria negativo (${detalhes.saldo}) no movimento nº ${detalhes.movimento_numero}; nada foi alterado`, {
    details: { field: 'movimento_id', reason: 'saldo_negativo', ...detalhes },
  });

/** Agrupa os movimentos a excluir por produto (ordem estável). */
const porProduto = (movimentos) => {
  /** @type {Map<string, Array<{ id: string, produtoId: string, localId: string }>>} */
  const mapa = new Map();
  for (const m of movimentos) {
    if (!mapa.has(m.produtoId)) mapa.set(m.produtoId, []);
    mapa.get(m.produtoId)?.push(m);
  }
  return mapa;
};

/**
 * Prova e plano de UM produto (sem escrita): histórico, tetos, replay = gravado e a simulação sem os movimentos.
 * @param {any} tx @param {string} cli @param {{ empresaId: string, produtoId: string, excluirIds: string[], teto?: number, tetoAfetados?: number }} a
 * @returns {Promise<PlanoRecalculo>}
 */
export const provarExclusaoComRecalculo = async (tx, cli, a) => {
  const historico = await lerHistoricoDoProduto(tx, cli, a.empresaId, a.produtoId, { teto: a.teto ?? TETO_MOVIMENTOS_PRODUTO });
  const porId = new Map(historico.movimentos.map((x) => [x.id, x]));
  for (const id of a.excluirIds) {
    const m = porId.get(id);
    if (!m) throw recalculoInviavel('movimento_fora_do_historico', { movimento_id: id });
    if (m.status !== 'Ativa' || m.movimento_filho_id) throw recalculoInviavel('movimento_ja_excluido', { movimento_id: id }, 'este movimento já foi excluído; nada foi alterado');
    // Fatia 4: só SAÍDAS (manual, cocho, atividade, abastecimento, venda). Transferência e entradas são a fatia 5.
    if (classificar(m, porId) !== CLASSE.SAIDA) throw recalculoInviavel('origem_nao_suportada', { movimento_id: id, origem_sistema: m.origem_sistema });
  }
  const excluidos = historico.movimentos.filter((x) => a.excluirIds.includes(x.id)).sort(compararCanonico);
  const posteriores = historico.movimentos.filter((x) => compararCanonico(x, excluidos[0]) > 0 && !a.excluirIds.includes(x.id)).length;
  const tetoAfetados = a.tetoAfetados ?? TETO_MOVIMENTOS_AFETADOS;
  if (posteriores > tetoAfetados) throw volumeExcedido({ afetados: posteriores, teto: tetoAfetados });
  const base = exigirReplayIgualAoGravado(historico);
  const sim = simularExclusao(historico, base, a.excluirIds);
  if (!sim.permitido) {
    const { reason, ...detalhes } = /** @type {any} */ (sim.recusa);
    if (reason === 'saldo_negativo') throw saldoNegativo(detalhes);
    throw recalculoInviavel(reason, detalhes);
  }
  return { produtoId: a.produtoId, excluirIds: [...a.excluirIds], posteriores };
};

/**
 * ANTES do estorno, sob a trava dos produtos: para cada produto, se algum dos movimentos a excluir teve outro
 * movimento DEPOIS no depósito dele (`buscarMovimentoPosterior`, ignorando os próprios excluídos e `ignorarIds`),
 * prova e devolve o plano do recálculo. Produto sem nada depois fica fora (o estorno exato de hoje vale).
 * @param {any} tx @param {string} cli
 * @param {{ empresaId: string, movimentos: Array<{ id: string, produtoId: string, localId: string }>, ignorarIds?: string[],
 *   ignorarParesNeutros?: boolean, teto?: number, tetoAfetados?: number }} a
 * @returns {Promise<PlanoRecalculo[]>}
 */
export const planejarExclusaoComRecalculo = async (tx, cli, a) => {
  const grupos = porProduto(a.movimentos.filter((m) => m.id && m.produtoId && m.localId));
  if (!grupos.size) return [];
  await travarProdutosEstoque(tx, cli, a.empresaId, [...grupos.keys()]);
  const ids = a.movimentos.map((m) => m.id);
  const referencias = new Map((/** @type {any[]} */ (await tx.$queryRaw`SELECT id, numero_movimentacao, "createdAt" FROM "MovimentacaoEstoque"
      WHERE cliente_id = ${cli} AND id = ANY(${ids}::text[])`)).map((m) => [m.id, m]));
  /** @type {PlanoRecalculo[]} */
  const planos = [];
  for (const [produtoId, movimentos] of [...grupos.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    // Os pares já excluídos COM recálculo estão fora da sequência: nunca são "depois" de nada.
    const marcados = /** @type {Array<{ id: string }>} */ (await tx.$queryRaw`SELECT id FROM "MovimentacaoEstoque"
      WHERE cliente_id = ${cli} AND empresa_id = ${a.empresaId} AND produto_id = ${produtoId} AND starts_with(COALESCE(movimentacao_grupo_id, ''), ${MARCA_EXCLUSAO_RECALCULO})`);
    const ignorar = [...movimentos.map((m) => m.id), ...(a.ignorarIds ?? []), ...marcados.map((m) => m.id)];
    let temDepois = false;
    for (const m of movimentos) {
      const ref = referencias.get(m.id);
      if (!ref) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'movimento de estoque não encontrado');
      const depois = await buscarMovimentoPosterior(tx, cli, {
        empresaId: a.empresaId, produtoId, locais: [m.localId], ignorarIds: ignorar,
        desde: { createdAt: ref.createdAt, numero: ref.numero_movimentacao }, ignorarParesNeutros: a.ignorarParesNeutros === true,
      });
      if (depois) {
        temDepois = true;
        break;
      }
    }
    if (!temDepois) continue;
    planos.push(await provarExclusaoComRecalculo(tx, cli, { empresaId: a.empresaId, produtoId, excluirIds: movimentos.map((m) => m.id), teto: a.teto, tetoAfetados: a.tetoAfetados }));
  }
  return planos;
};

const conflito = (details) =>
  new AppError('CONCURRENCY_CONFLICT', 'outro registro mudou durante a exclusão com recálculo; nada foi alterado, tente de novo', { details: { reason: 'recalculo_concorrente', ...details } });

const iguaisDec = (a, b) => (a === null || a === undefined || b === null || b === undefined ? a === b : dec(a).eq(dec(b)));
const fatiasTexto = (json, comDestino = false) => JSON.stringify((fatiasGravadas(json, { comDestino }) ?? []).map(fatiaComoTexto));

/**
 * Reescreve as fatias de um dependente (`*ConsumoLote`) para as fatias recalculadas do movimento: atualiza a linha
 * da mesma camada, cria a que falta e remove a linha de camada que deixou de ser consumida (a camada fica; só a
 * fatia some). Com `ordem` (atividade, abastecimento), a ordem segue a das fatias (troca em duas fases, por causa
 * da unique da ordem).
 * @returns {Promise<{ antes: any[], depois: any[] }|null>} null quando nada mudou
 */
const reescreverFatias = async (delegate, cli, empresaId, campoPai, paiId, comOrdem, existentes, fatias) => {
  const desejadas = fatias.map((f, k) => ({ lote: f.lote_id, ordem: k + 1, quantidade: dec(f.quantidade), custo: dec(f.custo_unitario) }));
  const comoTexto = (l) => ({ lote_id: l.estoque_lote_nota_id, ...(comOrdem ? { ordem: l.ordem } : {}), quantidade: dec(l.quantidade).toFixed(CASAS_QUANTIDADE), custo_unitario: dec(l.custo_unitario).toFixed(CASAS_CUSTO) });
  const antes = [...existentes].sort((x, y) => (comOrdem ? x.ordem - y.ordem : 0)).map(comoTexto);
  const depois = desejadas.map((d) => ({ lote_id: d.lote, ...(comOrdem ? { ordem: d.ordem } : {}), quantidade: d.quantidade.toFixed(CASAS_QUANTIDADE), custo_unitario: d.custo.toFixed(CASAS_CUSTO) }));
  const ordenar = (lista) => [...lista].sort((x, y) => (x.lote_id < y.lote_id ? -1 : x.lote_id > y.lote_id ? 1 : 0));
  if (JSON.stringify(comOrdem ? antes : ordenar(antes)) === JSON.stringify(comOrdem ? depois : ordenar(depois))) return null;
  const porLote = new Map(existentes.map((e) => [e.estoque_lote_nota_id, e]));
  const lotesDesejados = new Set(desejadas.map((d) => d.lote));
  const remover = existentes.filter((e) => !lotesDesejados.has(e.estoque_lote_nota_id));
  if (remover.length) await delegate.deleteMany({ where: { cliente_id: cli, id: { in: remover.map((r) => r.id) } } });
  const manter = existentes.filter((e) => lotesDesejados.has(e.estoque_lote_nota_id));
  if (comOrdem) {
    for (const e of manter) {
      const d = desejadas.find((x) => x.lote === e.estoque_lote_nota_id);
      if (d && d.ordem !== e.ordem) await delegate.update({ where: { cliente_id_id: { cliente_id: cli, id: e.id } }, data: { ordem: e.ordem + 100000 } });
    }
  }
  for (const d of desejadas) {
    const e = porLote.get(d.lote);
    const dados = { quantidade: paraBanco(d.quantidade, CASAS_QUANTIDADE), custo_unitario: paraBanco(d.custo, CASAS_CUSTO), ...(comOrdem ? { ordem: d.ordem } : {}) };
    if (e) {
      if (!dec(e.quantidade).eq(d.quantidade) || !dec(e.custo_unitario).eq(d.custo) || (comOrdem && e.ordem !== d.ordem)) {
        await delegate.update({ where: { cliente_id_id: { cliente_id: cli, id: e.id } }, data: dados });
      }
    } else {
      await delegate.create({ data: { cliente_id: cli, empresa_id: empresaId, [campoPai]: paiId, estoque_lote_nota_id: d.lote, ...dados } });
    }
  }
  return { antes, depois };
};

/**
 * Trava (sem esperar) os cochos cujos lançamentos o recálculo vai reescrever: a trava do cocho vem ANTES da do
 * produto em todos os escritores; quem já segura o produto não pode esperar por ela (ciclo). Ocupada → 409.
 */
const travarCochosSemEsperar = async (tx, cli, empresaId, pontos) => {
  for (const ponto of [...pontos].sort()) {
    const [r] = /** @type {any[]} */ (await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtextextended(${`supl-ponto:${cli}:${empresaId}:${ponto}`}, 0)) AS ok`);
    if (!r?.ok) throw conflito({ ponto_suplementacao_id: ponto, reason: 'cocho_ocupado' });
  }
};

/**
 * Dependentes fora do estoque dos movimentos que mudaram (SPEC §3). Devolve os eventos de auditoria.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {Map<string, { m: any, r: any }>} mudados
 */
const reescreverDependentes = async (tx, cli, empresaId, mudados) => {
  const ids = [...mudados.keys()];
  const auditoria = [];
  if (!ids.length) return auditoria;
  const base = { cliente_id: cli, empresa_id: empresaId, movimentacao_estoque_id: { in: ids } };
  const vu = (id) => dec(/** @type {any} */ (mudados.get(id)).r.valor_unitario ?? 0);
  const vt = (id) => dec(/** @type {any} */ (mudados.get(id)).r.valor_total ?? 0);
  const fatiasDe = (id) => /** @type {any} */ (mudados.get(id)).r.fatias ?? [];

  for (const it of await tx.saidaEstoqueItem.findMany({ where: base })) {
    if (iguaisDec(it.custo_unitario, vu(it.movimentacao_estoque_id)) && iguaisDec(it.valor_total, vt(it.movimentacao_estoque_id))) continue;
    await tx.saidaEstoqueItem.update({
      where: { cliente_id_id: { cliente_id: cli, id: it.id } },
      data: { custo_unitario: paraBanco(vu(it.movimentacao_estoque_id), CASAS_CUSTO), valor_total: paraBanco(vt(it.movimentacao_estoque_id), CASAS_CUSTO) },
    });
    auditoria.push({
      entidade: 'SaidaEstoqueItem', entidadeId: it.id, movimento_id: it.movimentacao_estoque_id,
      antes: { custo_unitario: texto4(it.custo_unitario), valor_total: texto4(it.valor_total) },
      depois: { custo_unitario: texto4(vu(it.movimentacao_estoque_id)), valor_total: texto4(vt(it.movimentacao_estoque_id)) },
    });
  }

  const linhas = await tx.atividadeApontamentoProduto.findMany({ where: base, include: { consumos: true } });
  for (const l of linhas) {
    const id = l.movimentacao_estoque_id;
    const custoMudou = !iguaisDec(l.custo_unitario, vu(id)) || !iguaisDec(l.custo_total, vt(id));
    if (custoMudou) {
      await tx.atividadeApontamentoProduto.update({
        where: { cliente_id_id: { cliente_id: cli, id: l.id } }, data: { custo_unitario: paraBanco(vu(id), CASAS_CUSTO), custo_total: paraBanco(vt(id), CASAS_CUSTO) },
      });
    }
    const f = await reescreverFatias(tx.atividadeApontamentoProdutoConsumoLote, cli, empresaId, 'linha_id', l.id, true, l.consumos, fatiasDe(id));
    if (custoMudou || f) {
      auditoria.push({
        entidade: 'AtividadeApontamentoProduto', entidadeId: l.id, movimento_id: id,
        antes: { custo_unitario: texto4(l.custo_unitario), custo_total: texto4(l.custo_total), ...(f ? { fatias: f.antes } : {}) },
        depois: { custo_unitario: texto4(vu(id)), custo_total: texto4(vt(id)), ...(f ? { fatias: f.depois } : {}) },
      });
    }
  }

  const abastecimentos = await tx.abastecimentoBem.findMany({ where: base });
  for (const ab of abastecimentos) {
    const id = /** @type {string} */ (ab.movimentacao_estoque_id);
    const consumos = await tx.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: cli, abastecimento_id: ab.id } });
    const custoMudou = !iguaisDec(ab.custo_unitario, vu(id)) || !iguaisDec(ab.custo_total, vt(id));
    if (custoMudou) {
      await tx.abastecimentoBem.update({
        where: { cliente_id_id: { cliente_id: cli, id: ab.id } }, data: { custo_unitario: paraBanco(vu(id), CASAS_CUSTO), custo_total: paraBanco(vt(id), CASAS_CUSTO) },
      });
    }
    const f = await reescreverFatias(tx.abastecimentoBemConsumoLote, cli, empresaId, 'abastecimento_id', ab.id, true, consumos, fatiasDe(id));
    if (custoMudou || f) {
      auditoria.push({
        entidade: 'AbastecimentoBem', entidadeId: ab.id, movimento_id: id,
        antes: { custo_unitario: texto4(ab.custo_unitario), custo_total: texto4(ab.custo_total), ...(f ? { fatias: f.antes } : {}) },
        depois: { custo_unitario: texto4(vu(id)), custo_total: texto4(vt(id)), ...(f ? { fatias: f.depois } : {}) },
      });
    }
  }

  const itens = await tx.operacaoFinanceiraItem.findMany({ where: base, include: { consumos: true } });
  for (const it of itens) {
    const id = /** @type {string} */ (it.movimentacao_estoque_id);
    const f = await reescreverFatias(tx.operacaoFinanceiraConsumoLote, cli, empresaId, 'item_id', it.id, false, it.consumos, fatiasDe(id));
    // O preço de venda (`valor_unitario`/`valor_total` do item) não muda; só o custo das fatias.
    if (f) auditoria.push({ entidade: 'OperacaoFinanceiraItem', entidadeId: it.id, movimento_id: id, antes: { fatias: f.antes }, depois: { fatias: f.depois } });
  }

  // Cocho: o custo/kg da saída e o custo do fechamento (cadeia de cada cocho, porque a sobra herda o custo).
  const custoMudou = ids.filter((id) => {
    const x = /** @type {any} */ (mudados.get(id));
    return !iguaisDec(x.m.valor_unitario, x.r.valor_unitario);
  });
  if (custoMudou.length) {
    const ligados = /** @type {any[]} */ (await tx.$queryRaw`SELECT DISTINCT dados->>'ponto_suplementacao_id' AS ponto FROM "SuplementacaoEvento"
      WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND dados->>'movimentacao_estoque_id' = ANY(${custoMudou}::text[])
        AND COALESCE(dados->>'situacao', '') <> ${SITUACAO_CANCELADO}`);
    const pontos = ligados.map((x) => x.ponto).filter((p) => typeof p === 'string' && p);
    if (pontos.length) {
      await travarCochosSemEsperar(tx, cli, empresaId, pontos);
      const eventos = /** @type {any[]} */ (await tx.$queryRaw`SELECT id, dados, "createdAt" FROM "SuplementacaoEvento"
        WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND dados->>'ponto_suplementacao_id' = ANY(${pontos}::text[])
          AND COALESCE(dados->>'situacao', '') <> ${SITUACAO_CANCELADO} ORDER BY id FOR UPDATE`);
      const custos = new Map(custoMudou.map((id) => {
        const x = /** @type {any} */ (mudados.get(id));
        return [id, { antes: x.m.valor_unitario === null ? null : Number(dec(x.m.valor_unitario).toString()), depois: x.r.valor_unitario === null ? null : Number(dec(x.r.valor_unitario).toString()) }];
      }));
      const r = recalcularCustosDosCochos(eventos, custos);
      if (r.recusa) throw recalculoInviavel(r.recusa.reason, { evento_id: r.recusa.evento_id }, 'o custo do fechamento de um lançamento de cocho não pôde ser refeito com segurança; nada foi alterado');
      for (const p of r.patches) {
        await tx.suplementacaoEvento.update({ where: { cliente_id_id: { cliente_id: cli, id: p.id } }, data: { dados: p.dados } });
        const ev = eventos.find((e) => e.id === p.id);
        auditoria.push({ entidade: 'SuplementacaoEvento', entidadeId: p.id, movimento_id: ev?.dados?.movimentacao_estoque_id ?? null, antes: p.antes, depois: p.depois });
      }
    }
  }
  return auditoria;
};

/**
 * Valores de um movimento que o recálculo reescreve (só os que o motor gravou: nulo continua nulo).
 * @param {any} m gravado @param {any} r recalculado
 */
const diferencasDoMovimento = (m, r) => {
  /** @type {Record<string, any>} */
  const data = {};
  const antes = {};
  const depois = {};
  for (const campo of CAMPOS_VALOR) {
    if (m[campo] === null || m[campo] === undefined || r[campo] === null || r[campo] === undefined) continue;
    if (texto4(m[campo]) === texto4(r[campo])) continue;
    data[campo] = paraBanco(r[campo], 4);
    antes[campo] = texto4(m[campo]);
    depois[campo] = texto4(r[campo]);
  }
  let fatiasMudaram = false;
  if (r.fatias && r.regra === 'atual') {
    const gravadas = fatiasTexto(m.lotes_consumidos, true);
    if (gravadas !== JSON.stringify(r.fatias)) {
      fatiasMudaram = true;
      data.lotes_consumidos = r.fatias;
      antes.lotes_consumidos = JSON.parse(gravadas);
      depois.lotes_consumidos = r.fatias;
    }
  }
  return { data, antes, depois, fatiasMudaram };
};

/**
 * DEPOIS do estorno de cada movimento planejado: marca o par, refaz a sequência e grava o recálculo (ver o topo).
 * @param {any} tx @param {{ requestId?: string, auth: any }} contexto
 * @param {PlanoRecalculo[]} planos
 * @param {{ empresaId: string, estornos: Map<string, string>, motivo: string, origem: string }} a
 *   `estornos`: id do original → id do estorno lançado agora
 * @returns {Promise<{ produtos: number, movimentos: number, camadas: number, dependentes: number }>}
 */
export const aplicarExclusaoComRecalculo = async (tx, contexto, planos, a) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const resumo = { produtos: 0, movimentos: 0, camadas: 0, dependentes: 0 };
  for (const plano of planos) {
    await travarProdutosEstoque(tx, cli, a.empresaId, [plano.produtoId]);
    // 1. A marca do par: o replay deixa o original e o estorno fora da sequência.
    for (const originalId of plano.excluirIds) {
      const estornoId = a.estornos.get(originalId);
      if (!estornoId) throw new Error(`exclusão com recálculo: estorno do movimento ${originalId} ausente`);
      const marca = marcaDoPar(originalId);
      const o = await tx.movimentacaoEstoque.updateMany({
        where: { cliente_id: cli, empresa_id: a.empresaId, id: originalId, status: 'Estornada', movimento_filho_id: estornoId, movimentacao_grupo_id: null }, data: { movimentacao_grupo_id: marca },
      });
      const e = await tx.movimentacaoEstoque.updateMany({
        where: { cliente_id: cli, empresa_id: a.empresaId, id: estornoId, movimento_pai_id: originalId, movimentacao_grupo_id: null }, data: { movimentacao_grupo_id: marca },
      });
      if (o.count !== 1 || e.count !== 1) throw conflito({ movimento_id: originalId });
    }
    // 2. A sequência refeita (ids reais para as camadas de destino que uma transferência recalculada precisa criar).
    const historico = await lerHistoricoDoProduto(tx, cli, a.empresaId, plano.produtoId, { teto: TETO_MOVIMENTOS_PRODUTO });
    /** @type {Map<string, { r: any, k: number }>} */
    const novas = new Map();
    const sim = reproduzir(historico, {
      novoIdCamada: (r, k) => {
        const id = `c${randomUUID().replace(/-/g, '')}`;
        novas.set(id, { r, k });
        return id;
      },
    });
    if (!sim.reproduzivel) {
      throw recalculoInviavel('historico_nao_reproduzivel', { problemas: [...sim.problemas, ...(sim.parada ? [sim.parada] : [])].slice(0, AMOSTRA) },
        'o recálculo não conseguiu refazer a sequência deste produto; nada foi alterado');
    }
    const reatribuido = [...sim.resultados.values()].find((r) => r.reatribuido);
    if (reatribuido) throw recalculoInviavel('reatribuicao_de_camada', { movimento_id: reatribuido.id, movimento_numero: reatribuido.numero });

    const porId = new Map(historico.movimentos.map((m) => [m.id, m]));
    const fatos = new Map(historico.camadas.map((l) => [l.id, l]));
    const auditoria = [];
    const comum = { motivo: a.motivo, origem: a.origem, movimentos_excluidos: plano.excluirIds };

    // 3. Camadas: as que mudam (CAS sobre o lido) e as novas (procedência da camada de origem).
    const procedencia = (loteId, guarda = 0) => {
      const fato = fatos.get(loteId);
      if (fato) return fato;
      const nova = novas.get(loteId);
      if (!nova || guarda > 50) return null;
      const s = porId.get(nova.r.movimento_pai_id);
      const fonte = sim.resultados.get(s?.id)?.fatias?.[nova.k]?.lote_id;
      return fonte ? procedencia(fonte, guarda + 1) : null;
    };
    for (const c of sim.camadas.values()) {
      const fato = fatos.get(c.id);
      if (!fato) {
        const nova = novas.get(c.id);
        const origem = nova ? procedencia(c.id) : null;
        const irmas = historico.camadas.find((l) => l.local_estoque_id === c.local);
        if (!nova || !origem) throw recalculoInviavel('camada_nova_sem_origem', { lote_id: c.id });
        const criada = await tx.estoqueLoteNota.create({
          data: {
            id: c.id, cliente_id: cli, empresa_id: a.empresaId, produto_id: plano.produtoId, produto_nome: origem.produto_nome ?? null,
            local_estoque_id: c.local, local_estoque_nome: irmas?.local_estoque_nome ?? null,
            numero_documento: origem.numero_documento ?? null, serie_documento: origem.serie_documento ?? null,
            fornecedor_id: origem.fornecedor_id ?? null, fornecedor_nome: origem.fornecedor_nome ?? null,
            data_documento: c.data_documento, custo_unitario: paraBanco(c.custo, CASAS_CUSTO),
            quantidade_entrada: paraBanco(c.entrada, CASAS_QUANTIDADE), quantidade_disponivel: paraBanco(c.disp, CASAS_QUANTIDADE),
            movimentacao_entrada_id: nova.r.id, status: c.status,
          },
        });
        auditoria.push({ entidade: 'EstoqueLoteNota', entidadeId: criada.id, movimento_id: nova.r.id, antes: null,
          depois: { quantidade_entrada: texto4(c.entrada), quantidade_disponivel: texto4(c.disp), custo_unitario: texto4(c.custo), status: c.status, nova: true } });
        continue;
      }
      const mudou = !iguaisDec(fato.quantidade_disponivel, c.disp) || !iguaisDec(fato.custo_unitario, c.custo) || fato.status !== c.status || !iguaisDec(fato.quantidade_entrada, c.entrada);
      if (!mudou) continue;
      const r = await tx.estoqueLoteNota.updateMany({
        where: { cliente_id: cli, id: c.id, status: fato.status, quantidade_disponivel: fato.quantidade_disponivel, custo_unitario: fato.custo_unitario, quantidade_entrada: fato.quantidade_entrada },
        data: {
          quantidade_disponivel: paraBanco(c.disp, CASAS_QUANTIDADE), custo_unitario: paraBanco(c.custo, CASAS_CUSTO), status: c.status,
          quantidade_entrada: paraBanco(c.entrada, CASAS_QUANTIDADE),
        },
      });
      if (r.count !== 1) throw conflito({ lote_id: c.id });
      auditoria.push({
        entidade: 'EstoqueLoteNota', entidadeId: c.id, movimento_id: null,
        antes: { quantidade_entrada: texto4(fato.quantidade_entrada), quantidade_disponivel: texto4(fato.quantidade_disponivel), custo_unitario: texto4(fato.custo_unitario), status: fato.status },
        depois: { quantidade_entrada: texto4(c.entrada), quantidade_disponivel: texto4(c.disp), custo_unitario: texto4(c.custo), status: c.status },
      });
    }
    for (const l of historico.camadas) if (!sim.camadas.has(l.id)) throw recalculoInviavel('camada_fora_da_sequencia', { lote_id: l.id });

    // 4. Movimentos posteriores: valores, saldos, médios, fatias e o rateio das observações.
    const numeroDoc = (loteId) => {
      const p = procedencia(loteId);
      return { numero_documento: p?.numero_documento ?? null };
    };
    /** @type {Map<string, { m: any, r: any }>} */
    const mudados = new Map();
    const comObservacoes = new Map((/** @type {any[]} */ (await tx.movimentacaoEstoque.findMany({
      where: { cliente_id: cli, empresa_id: a.empresaId, produto_id: plano.produtoId, observacoes: { contains: '[RATEIO_FIFO] ' } }, select: { id: true, observacoes: true },
    }))).map((x) => [x.id, x.observacoes]));
    for (const m of historico.movimentos) {
      const r = sim.resultados.get(m.id);
      if (!r) continue;
      const { data, antes, depois, fatiasMudaram } = diferencasDoMovimento(m, r);
      // Rateio `[RATEIO_FIFO]` das observações (cocho e as duas pernas da transferência): refeito se as fatias mudaram.
      if (comObservacoes.has(m.id)) {
        const recebida = r.classe === CLASSE.TRANSFERENCIA_RECEBIDA;
        const gravadas = fatiasTexto(recebida ? porId.get(m.movimento_pai_id)?.lotes_consumidos : m.lotes_consumidos, true);
        const novas = recebida ? sim.resultados.get(m.movimento_pai_id)?.fatias : r.fatias;
        if (novas && JSON.stringify(novas) !== gravadas) {
          const obs = recomporRateio(comObservacoes.get(m.id), novas.map((f) => ({ quantidade: f.quantidade, lote: numeroDoc(f.lote_id) })));
          if (obs !== null && obs !== comObservacoes.get(m.id)) data.observacoes = obs;
        }
      }
      if (!Object.keys(data).length) continue;
      const u = await tx.movimentacaoEstoque.updateMany({ where: { cliente_id: cli, id: m.id, status: m.status, movimentacao_grupo_id: m.movimentacao_grupo_id ?? null }, data });
      if (u.count !== 1) throw conflito({ movimento_id: m.id });
      if (data.valor_unitario !== undefined || data.valor_total !== undefined || fatiasMudaram) mudados.set(m.id, { m, r });
      auditoria.push({ entidade: 'MovimentacaoEstoque', entidadeId: m.id, movimento_id: m.id, antes, depois: { ...depois, ...(data.observacoes ? { rateio_refeito: true } : {}) } });
    }

    // 5. Dependentes fora do estoque.
    const dependentes = await reescreverDependentes(tx, cli, a.empresaId, mudados);

    // 6. Trilha (antes → depois, autor do auth_context, motivo, excluídos).
    const eventos = [...auditoria, ...dependentes].map((x) => ({
      acao: ACAO_AUDITORIA_RECALCULO, entidade: x.entidade, entidadeId: x.entidadeId,
      dadosAnteriores: x.antes, dadosNovos: { ...(x.depois ?? {}), ...comum, movimento_recalculado_id: x.movimento_id ?? null },
    }));
    eventos.push({
      acao: ACAO_AUDITORIA_RECALCULO, entidade: 'Produto', entidadeId: plano.produtoId, dadosAnteriores: undefined,
      dadosNovos: { ...comum, movimentos_posteriores: plano.posteriores, movimentos_reescritos: auditoria.filter((x) => x.entidade === 'MovimentacaoEstoque').length,
        camadas_reescritas: auditoria.filter((x) => x.entidade === 'EstoqueLoteNota').length, dependentes_reescritos: dependentes.length },
    });
    await registrarEventosEmLote(contexto, eventos, tx);

    // 7. Prova final: relido tudo, o replay tem de reproduzir exatamente o que ficou gravado.
    const depois = await lerHistoricoDoProduto(tx, cli, a.empresaId, plano.produtoId, { teto: TETO_MOVIMENTOS_PRODUTO });
    const prova = reproduzir(depois);
    const divergencias = prova.reproduzivel ? compararComGravado(prova, depois) : [{ problemas: prova.problemas, parada: prova.parada }];
    if (divergencias.length) {
      throw recalculoInviavel('recalculo_nao_confere', { divergencias: divergencias.length, amostra: divergencias.slice(0, AMOSTRA) }, 'o recálculo não fechou com o gravado; nada foi alterado');
    }
    resumo.produtos += 1;
    resumo.movimentos += auditoria.filter((x) => x.entidade === 'MovimentacaoEstoque').length;
    resumo.camadas += auditoria.filter((x) => x.entidade === 'EstoqueLoteNota').length;
    resumo.dependentes += dependentes.length;
  }
  return resumo;
};
