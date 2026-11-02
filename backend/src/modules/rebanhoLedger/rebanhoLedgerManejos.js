/**
 * Manejos do mapa no ledger por posição — R2E-PR174-R1 (D-PROD-107).
 *
 * Numa empresa ATIVADA, os comandos atômicos existentes (R2A manejo-lote,
 * R2B manejo-rebanho, R2C junção, R2D baixa) delegam para cá DENTRO da própria
 * transação e reserva idempotente deles. Nada aqui escreve em `Lote`: todo
 * efeito é evento + partidas (quantidade) + observações de peso, com a linha do
 * tempo revalidada (fim de dia ≥ 0) e a projeção recalculada.
 *
 * As regras de domínio que já existiam nos comandos (categorias oficiais,
 * política materna, categoria do filhote, categoria de manejo, distribuição da
 * baixa) chegam por `deps` — injeção, para não criar ciclo de import.
 *
 * Os ids que o mapa envia numa empresa ativada são ids de POSIÇÃO.
 */

import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  TIPOS_EVENTO,
  ativacaoDaEmpresa,
  auditarPosicoes,
  comoPosicaoPublica,
  criarEvento,
  criarPonteMovimentacao,
  detalheSaldo,
  diaDe,
  exigirDiaNoLedger,
  garantirPesoBase,
  idsCitados,
  inserirPartidas,
  moldeDe,
  normal,
  pesoNaData,
  pesoNum,
  pesoPonderado,
  ponto,
  posicaoDaIdentidade,
  recusa,
  registrarPeso,
  saldoNaData,
  travarAreas,
  travarPosicoes,
  validarEReprojetar,
} from './rebanhoLedgerNucleo.js';
import { executarTransferencia } from './rebanhoLedgerService.js';

/** Limite de origens numa junção no ledger (o mesmo do comando R2C). */
export const MAX_ORIGENS_JUNCAO_LEDGER = 20;

const ordemEstavel = (a, b) => {
  const n = (p) => (/^\d+$/.test(String(p.numero_lote ?? '').trim()) ? Number(String(p.numero_lote).trim()) : Number.POSITIVE_INFINITY);
  return n(a) - n(b) || String(a.numero_lote ?? '').localeCompare(String(b.numero_lote ?? '')) || String(a.id).localeCompare(String(b.id));
};

/** Empresa no ledger? (o comando legado chama e, se sim, delega) */
export const empresaNoLedger = (tx, clienteId, empresaId) => ativacaoDaEmpresa(tx, clienteId, empresaId);

/** Trava a área e as posições vivas dela (ordem área → posição); devolve área e mapa. */
const travarAreaEPosicoes = async (tx, clienteId, empresaId, areaId, extras = []) => {
  const areas = await travarAreas(tx, clienteId, empresaId, [areaId]);
  const area = areas.get(areaId);
  if (!area) throw new AppError('AREA_NOT_FOUND', 'área não encontrada nesta empresa');
  const daArea = await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, area_id: areaId }, select: { id: true } });
  const posicoes = await travarPosicoes(tx, clienteId, [...daArea.map((p) => p.id), ...extras]);
  return { area, areas, posicoes };
};

/** Fecha o fato: valida a linha do tempo, ponte de histórico, auditoria e resposta. */
const concluir = async (tx, contexto, { e, evento, envolvidas, antes, areas, pedidos, dia, dadosPonte, extraBody = {} }) => {
  const auth = exigirAuthContext(contexto?.auth);
  await validarEReprojetar(tx, auth.clienteId, envolvidas, 'REBANHO_SALDO_HISTORICO_NEGATIVO', 'o manejo deixaria saldo negativo numa data; nada foi gravado',
    detalheSaldo(antes, areas, pedidos, dia));
  ponto('apos_validar_manejo');
  const mov = await criarPonteMovimentacao(tx, contexto, { clienteId: auth.clienteId, empresaId: e.empresaId, evento, operationKey: e.operationKey, usuarioId: auth.usuarioId, dados: dadosPonte });
  ponto('antes_auditoria_manejo');
  const depois = await auditarPosicoes(contexto, tx, auth.clienteId, envolvidas, antes);
  const publicas = [...depois.values()].map((p) => comoPosicaoPublica(p, areas.get(p.area_id)?.nome ?? null));
  return { httpStatus: 201, body: { evento: { id: evento.id, tipo: evento.tipo, data_operacional: dia }, movimentacao: documentoComoPublico(mov), lotes: publicas, posicoes: publicas, ...extraBody } };
};

// ─── B1: Morte e Abate (multi-posição, baixa R2D) ──────────────────────────

/**
 * Saldo de cada posição da área NA DATA do manejo (não o saldo de hoje): um
 * manejo retroativo distribui sobre o que existia naquele dia. Eventos futuros
 * são protegidos depois pela validação temporal (REBANHO_SALDO_HISTORICO_NEGATIVO).
 */
const comSaldoNaData = async (tx, clienteId, posicoes, areaId, dia) => {
  const m = new Map();
  for (const p of posicoes.values()) {
    if (p.area_id !== areaId) continue;
    const s = await saldoNaData(tx, clienteId, p.id, dia);
    if (s > 0) m.set(p.id, { ...p, quantidade_cabecas: s });
  }
  return m;
};

/**
 * @param {any} e entrada normalizada da baixa (lerEntradaBaixa)
 * @param {{CATEGORIAS_OFICIAIS: Record<string,string>, distribuirBaixa: Function, POLITICA_ALOCACAO: string}} deps
 */
export const baixaNoLedger = async (tx, contexto, e, deps) => {
  const auth = exigirAuthContext(contexto?.auth);
  const ativacao = await ativacaoDaEmpresa(tx, auth.clienteId, e.empresaId);
  const dia = diaDe(e.dataMovimentacao);
  exigirDiaNoLedger(ativacao, dia);
  const { area, areas, posicoes } = await travarAreaEPosicoes(tx, auth.clienteId, e.empresaId, e.areaId, e.selecionados ?? []);
  if (e.selecionados) {
    const fora = e.selecionados.find((id) => posicoes.get(id)?.empresa_id !== e.empresaId);
    if (fora) throw new AppError('POSICAO_REBANHO_NOT_FOUND', 'posição selecionada não encontrada nesta empresa', { details: { posicao_id: fora } });
  }
  const filtro = e.selecionados ? new Set(e.selecionados) : null;
  const naData = await comSaldoNaData(tx, auth.clienteId, posicoes, area.id, dia);
  const elegiveis = [...naData.values()].filter((p) => !filtro || filtro.has(p.id));
  for (const linha of e.linhas) {
    const oficial = Object.keys(deps.CATEGORIAS_OFICIAIS).find((c) => normal(c) === normal(linha.categoria));
    if (!oficial) continue;
    const divergente = elegiveis.find((p) => normal(p.categoria) === normal(linha.categoria) && p.sexo && normal(p.sexo) !== normal(deps.CATEGORIAS_OFICIAIS[oficial]));
    if (divergente) throw recusa('BAIXA_CLASSIFICACAO_DIVERGENTE', 'há posição desta categoria com sexo incompatível; corrija antes de baixar', { posicao_id: divergente.id, categoria: linha.categoria, sexo: divergente.sexo });
  }
  // Mesma política determinística da R2D, sobre as POSIÇÕES (numero_lote, depois id).
  const linhas = deps.distribuirBaixa(elegiveis, e.linhas);
  const baixaPorPosicao = new Map();
  for (const l of linhas) for (const d of l.distribuicao) baixaPorPosicao.set(d.lote_id, (baixaPorPosicao.get(d.lote_id) ?? 0) + d.quantidade);
  const tipo = e.tipo === 'Morte' ? TIPOS_EVENTO.MORTE : TIPOS_EVENTO.ABATE;
  const evento = await criarEvento(tx, {
    clienteId: auth.clienteId, empresaId: e.empresaId, tipo, dia, usuarioId: auth.usuarioId, operationKey: e.operationKey,
    dados: { tipo: e.tipo, area_id: area.id, linhas: linhas.map((l) => ({ ...l })), ...(e.observacoes ? { observacoes: e.observacoes } : {}) },
  });
  let n = 0;
  for (const [posicaoId, q] of baixaPorPosicao) {
    await inserirPartidas(tx, { clienteId: auth.clienteId, empresaId: e.empresaId, eventoId: evento.id, dia, partidas: [{ posicao_id: posicaoId, delta: -q }] });
    n += 1;
    if (n === 1) ponto('apos_primeira_partida');
  }
  const participantes = [...baixaPorPosicao.keys()].map((id) => posicoes.get(id));
  const nome = (id) => ({ nome: posicoes.get(id).nome, numero_lote: posicoes.get(id).numero_lote ?? null });
  const total = e.linhas.reduce((t, l) => t + l.quantidade, 0);
  const saldosAntes = new Map(participantes.map((p) => [p.id, naData.get(p.id).quantidade_cabecas]));
  return concluir(tx, contexto, {
    e, evento, envolvidas: participantes.map((p) => p.id), antes: posicoes, areas, pedidos: baixaPorPosicao, dia,
    dadosPonte: {
      tipo: e.tipo,
      lote: participantes[0].nome,
      lote_id: participantes[0].lote_entrada_id ?? participantes[0].id,
      lote_ids: idsCitados(participantes),
      quantidade_animais: total,
      data_movimentacao: e.dataMovimentacao,
      area_origem_id: area.id,
      area_origem_nome: area.nome,
      categoria_animal: [...new Set(e.linhas.map((l) => l.categoria))].join(', '),
      baixa: {
        politica_alocacao: deps.POLITICA_ALOCACAO,
        total_cabecas: total,
        lotes: participantes.map((p) => ({ lote_id: p.id, posicao_id: p.id, lote_entrada_id: p.lote_entrada_id ?? null, ...nome(p.id), quantidade: baixaPorPosicao.get(p.id), saldo_antes: saldosAntes.get(p.id), saldo_depois: saldosAntes.get(p.id) - baixaPorPosicao.get(p.id) })),
      },
      linhas: linhas.map((l) => ({ ...l, distribuicao: l.distribuicao.map((d) => ({ ...d, posicao_id: d.lote_id, ...nome(d.lote_id) })) })),
      ...(e.observacoes ? { observacoes: e.observacoes } : {}),
    },
  });
};

/**
 * R2A `manejo-lote` numa empresa ativada: o `lote_id` é uma posição.
 * Transferência → núcleo da transferência; Morte/Abate → baixa de uma posição.
 */
export const manejoLoteNoLedger = async (tx, contexto, e, deps) => {
  const auth = exigirAuthContext(contexto?.auth);
  const p = await tx.posicaoRebanho.findFirst({ where: { cliente_id: auth.clienteId, empresa_id: e.empresaId, id: e.loteId } });
  if (!p) throw new AppError('POSICAO_REBANHO_NOT_FOUND', 'posição não encontrada nesta empresa', { details: { posicao_id: e.loteId } });
  if (e.tipo === 'Transferência de Área') {
    return executarTransferencia(tx, contexto, {
      operationKey: e.operationKey, empresaId: e.empresaId, areaDestinoId: e.areaDestinoId, data: e.dataMovimentacao, dia: diaDe(e.dataMovimentacao),
      itens: [{ posicao_id: p.id, quantidade: e.quantidade }], observacoes: e.observacoes,
    });
  }
  if (!p.categoria) throw recusa('MANEJO_ESTADO_INVALIDO', 'posição sem categoria');
  if (e.categoriaAnimal && normal(e.categoriaAnimal) !== normal(p.categoria)) throw recusa('MANEJO_ESTADO_INVALIDO', 'categoria informada não confere com a categoria da posição', { categoria_posicao: p.categoria });
  return baixaNoLedger(tx, contexto, {
    operationKey: e.operationKey, tipo: e.tipo, empresaId: e.empresaId, areaId: p.area_id, dataMovimentacao: e.dataMovimentacao,
    observacoes: e.observacoes, linhas: [{ categoria: p.categoria, quantidade: e.quantidade }], selecionados: [p.id],
  }, deps);
};

// ─── B2–B4: Nascimento, Pesagem, Mudança de Categoria (R2B) ────────────────

/**
 * @param {any} e entrada normalizada do comando do rebanho (lerEntradaRebanho)
 * @param {{CATEGORIAS_OFICIAIS: Record<string,string>, CATEGORIAS_MATERNAS: readonly string[], categoriaDoFilhote: Function, resolverCategoriaManejo: Function}} deps
 */
export const rebanhoNoLedger = async (tx, contexto, e, deps) => {
  const auth = exigirAuthContext(contexto?.auth);
  const ativacao = await ativacaoDaEmpresa(tx, auth.clienteId, e.empresaId);
  const dia = diaDe(e.dataMovimentacao);
  exigirDiaNoLedger(ativacao, dia);
  const extras = e.tipo === 'Pesagem' ? e.linhas.map((l) => l.lote_id) : [];
  const { area, areas, posicoes } = await travarAreaEPosicoes(tx, auth.clienteId, e.empresaId, e.areaId, extras);
  const naData = await comSaldoNaData(tx, auth.clienteId, posicoes, area.id, dia);
  const vivas = () => [...naData.values()];
  const tipo = { Nascimento: TIPOS_EVENTO.NASCIMENTO, Pesagem: TIPOS_EVENTO.PESAGEM, 'Mudança de Categoria': TIPOS_EVENTO.MUDANCA_CATEGORIA }[e.tipo];
  const evento = await criarEvento(tx, {
    clienteId: auth.clienteId, empresaId: e.empresaId, tipo, dia, usuarioId: auth.usuarioId, operationKey: e.operationKey,
    dados: { tipo: e.tipo, area_id: area.id, linhas: e.linhas, ...(e.observacoes ? { observacoes: e.observacoes } : {}) },
  });
  /** @type {Array<{posicao_id: string, delta: number}>} */
  const partidas = [];
  const pedidos = new Map();
  const linhasPonte = [];
  const tocadas = new Set();

  if (e.tipo === 'Nascimento') {
    for (const linha of e.linhas) {
      const maternal = deps.CATEGORIAS_MATERNAS.some((c) => normal(c) === normal(linha.categoria_mae));
      const maes = vivas().filter((p) => normal(p.categoria) === normal(linha.categoria_mae) && normal(p.sexo) === 'FEMEA');
      if (!maternal || !maes.length) {
        throw recusa('MANEJO_CATEGORIA_MAE_INVALIDA', 'não há posição ativa de FÊMEAS de categoria de matriz desta categoria na área', { categoria_mae: linha.categoria_mae });
      }
      const categoria = deps.categoriaDoFilhote(linha.sexo);
      const cm = await deps.resolverCategoriaManejo(tx, auth.clienteId, e.empresaId, categoria, null);
      // Cabeças NOVAS: origem 'nascimento' (não é compra, não tem cadastro de entrada).
      const { posicao } = await posicaoDaIdentidade(tx, auth.clienteId, e.empresaId, area.id, {
        origem: 'nascimento', lote_entrada_id: null, nome: `NASCIDOS ${categoria}`.toUpperCase(), categoria, sexo: linha.sexo,
        categoria_manejo_id: cm?.id ?? null, categoria_manejo_nome: cm?.nome ?? null,
        linhagem: [{ classe: 'nascimento', area_id: area.id }],
      });
      posicoes.set(posicao.id, posicao);
      await garantirPesoBase(tx, auth.clienteId, posicao);
      const s = await saldoNaData(tx, auth.clienteId, posicao.id, dia);
      const pAnt = await pesoNaData(tx, auth.clienteId, posicao.id, dia);
      await registrarPeso(tx, { clienteId: auth.clienteId, empresaId: e.empresaId, eventoId: evento.id, posicaoId: posicao.id, dia, peso: pesoPonderado(s, pAnt ?? null, linha.quantidade, linha.peso_medio_kg ?? null), medido: linha.peso_medio_kg !== null });
      partidas.push({ posicao_id: posicao.id, delta: linha.quantidade });
      tocadas.add(posicao.id);
      linhasPonte.push({
        sexo: linha.sexo, categoria_mae: linha.categoria_mae, categoria_filhote: categoria, quantidade: linha.quantidade, peso_medio_kg: linha.peso_medio_kg ?? null,
        posicao_id: posicao.id, maes_posicao_ids: maes.map((m) => m.id), maes_lote_ids: [...new Set(maes.map((m) => m.lote_entrada_id).filter(Boolean))],
        lote_criado: false,
      });
    }
  } else if (e.tipo === 'Pesagem') {
    for (const linha of e.linhas) {
      const p = posicoes.get(linha.lote_id);
      if (!p || p.empresa_id !== e.empresaId || p.area_id !== area.id) throw new AppError('POSICAO_REBANHO_NOT_FOUND', 'posição da pesagem não está nesta área', { details: { posicao_id: linha.lote_id } });
      const s = await saldoNaData(tx, auth.clienteId, p.id, dia);
      if (s <= 0) throw recusa('MANEJO_ESTADO_INVALIDO', 'a posição não tinha cabeças na data da pesagem', { posicao_id: p.id, data: dia });
      await garantirPesoBase(tx, auth.clienteId, p);
      const anterior = await pesoNaData(tx, auth.clienteId, p.id, dia);
      await registrarPeso(tx, { clienteId: auth.clienteId, empresaId: e.empresaId, eventoId: evento.id, posicaoId: p.id, dia, peso: linha.peso_medio_kg, medido: true });
      tocadas.add(p.id);
      const ant = anterior ?? null;
      linhasPonte.push({
        lote_id: p.id, posicao_id: p.id, lote_entrada_id: p.lote_entrada_id ?? null, lote_nome: p.nome, quantidade_cabecas: s,
        peso_anterior_kg: ant, peso_novo_kg: linha.peso_medio_kg, ganho_kg: ant === null ? null : Number((linha.peso_medio_kg - ant).toFixed(4)),
      });
    }
  } else {
    // Mudança de Categoria: −q na classificação antiga, +q na nova, mesma origem e área.
    const livre = new Map([...naData.values()].map((p) => [p.id, p.quantidade_cabecas]));
    for (const linha of e.linhas) {
      const sexoNovo = deps.CATEGORIAS_OFICIAIS[linha.categoria_nova];
      const cm = await deps.resolverCategoriaManejo(tx, auth.clienteId, e.empresaId, linha.categoria_nova, linha.categoria_manejo_id_novo);
      const fontes = vivas().filter((p) => normal(p.categoria) === normal(linha.categoria_atual)).sort(ordemEstavel);
      const disponivel = fontes.reduce((t, p) => t + livre.get(p.id), 0);
      if (disponivel < linha.quantidade) throw recusa('MANEJO_SALDO_INSUFICIENTE', 'saldo insuficiente na categoria nesta área', { categoria: linha.categoria_atual, disponivel, pedido: linha.quantidade });
      let restante = linha.quantidade;
      const partes = [];
      for (const f of fontes) {
        if (restante <= 0) break;
        const q = Math.min(restante, livre.get(f.id));
        if (q <= 0) continue;
        if (f.sexo && sexoNovo && normal(f.sexo) !== normal(sexoNovo)) throw recusa('MANEJO_CATEGORIA_INCOMPATIVEL', 'a categoria nova não combina com o sexo da posição', { posicao_id: f.id, sexo: f.sexo, categoria_nova: linha.categoria_nova });
        const { posicao: d } = await posicaoDaIdentidade(tx, auth.clienteId, e.empresaId, area.id, moldeDe(f, { categoria: linha.categoria_nova, categoria_manejo_id: cm?.id ?? null, categoria_manejo_nome: cm?.nome ?? null }));
        posicoes.set(d.id, d);
        await garantirPesoBase(tx, auth.clienteId, d);
        await garantirPesoBase(tx, auth.clienteId, f);
        const sD = await saldoNaData(tx, auth.clienteId, d.id, dia);
        const pD = await pesoNaData(tx, auth.clienteId, d.id, dia);
        const pF = linha.peso_medio_kg ?? (await pesoNaData(tx, auth.clienteId, f.id, dia)) ?? pesoNum(f.peso_medio_kg);
        await registrarPeso(tx, { clienteId: auth.clienteId, empresaId: e.empresaId, eventoId: evento.id, posicaoId: d.id, dia, peso: pesoPonderado(sD, pD ?? null, q, pF ?? null), medido: linha.peso_medio_kg !== null });
        partidas.push({ posicao_id: f.id, delta: -q }, { posicao_id: d.id, delta: q });
        pedidos.set(f.id, (pedidos.get(f.id) ?? 0) + q);
        livre.set(f.id, livre.get(f.id) - q);
        tocadas.add(f.id);
        tocadas.add(d.id);
        restante -= q;
        partes.push({ modo: q === f.quantidade_cabecas ? 'total' : 'parcial', quantidade: q, de_posicao_id: f.id, para_posicao_id: d.id });
      }
      linhasPonte.push({ quantidade: linha.quantidade, categoria_atual: linha.categoria_atual, categoria_nova: linha.categoria_nova, categoria_manejo_nome: cm?.nome ?? null, partes });
    }
  }
  if (partidas.length) await inserirPartidas(tx, { clienteId: auth.clienteId, empresaId: e.empresaId, eventoId: evento.id, dia, partidas });
  ponto('apos_primeira_partida');
  const envolvidas = [...tocadas];
  const lista = envolvidas.map((id) => posicoes.get(id));
  const total = e.tipo === 'Pesagem' ? 0 : e.linhas.reduce((t, l) => t + (l.quantidade ?? 0), 0);
  return concluir(tx, contexto, {
    e, evento, envolvidas, antes: posicoes, areas, pedidos, dia,
    dadosPonte: {
      tipo: e.tipo,
      lote: lista[0]?.nome ?? null,
      lote_id: lista[0]?.lote_entrada_id ?? lista[0]?.id ?? null,
      lote_ids: idsCitados(lista),
      quantidade_animais: total,
      data_movimentacao: e.dataMovimentacao,
      area_origem_id: area.id,
      area_origem_nome: area.nome,
      ...(e.modoPesagem ? { modo_pesagem: e.modoPesagem } : {}),
      linhas: linhasPonte,
      ...(e.observacoes ? { observacoes: e.observacoes } : {}),
    },
  });
};

// ─── B5: Junção (R2C) ──────────────────────────────────────────────────────

/**
 * Junção de POSIÇÕES compatíveis na área: as origens passam todas as cabeças
 * que tinham NA DATA para a principal. Linhagens distintas são permitidas e
 * ficam como contribuições na composição da principal (sem trocar a origem da
 * identidade, sem fabricar entrada). Peso: ponderado só se todos conhecidos.
 * @param {any} e entrada normalizada da junção (lerEntradaJuncao)
 * @param {{SEXOS: readonly string[]}} deps
 */
export const juncaoNoLedger = async (tx, contexto, e, deps) => {
  const auth = exigirAuthContext(contexto?.auth);
  const ativacao = await ativacaoDaEmpresa(tx, auth.clienteId, e.empresaId);
  const dia = diaDe(e.dataMovimentacao);
  exigirDiaNoLedger(ativacao, dia);
  if (e.origens.length > MAX_ORIGENS_JUNCAO_LEDGER) throw recusa('JUNCAO_LOTE_INELEGIVEL', `no máximo ${MAX_ORIGENS_JUNCAO_LEDGER} origens por junção`);
  const ids = [e.principalId, ...e.origens];
  const { area, areas, posicoes } = await travarAreaEPosicoes(tx, auth.clienteId, e.empresaId, e.areaId, ids);
  for (const id of ids) {
    const p = posicoes.get(id);
    if (!p || p.empresa_id !== e.empresaId) throw new AppError('POSICAO_REBANHO_NOT_FOUND', 'posição não encontrada nesta empresa', { details: { posicao_id: id } });
    if (p.area_id !== area.id || p.quantidade_cabecas <= 0) throw recusa('JUNCAO_LOTE_INELEGIVEL', 'posição fora da área ou sem cabeças', { posicao_id: id, area_atual_id: p.area_id, quantidade_cabecas: p.quantidade_cabecas });
  }
  const principal = posicoes.get(e.principalId);
  if (!deps.SEXOS.some((s) => normal(s) === normal(principal.sexo))) throw recusa('JUNCAO_CLASSIFICACAO_DIVERGENTE', 'a posição principal não tem sexo definido', { posicao_id: principal.id, campo: 'sexo' });
  for (const id of e.origens) {
    const o = posicoes.get(id);
    const campos = [];
    if (!principal.categoria || normal(o.categoria) !== normal(principal.categoria)) campos.push('categoria');
    if (normal(o.sexo) !== normal(principal.sexo)) campos.push('sexo');
    if ((o.categoria_manejo_id ?? null) !== (principal.categoria_manejo_id ?? null)) campos.push('categoria_manejo_id');
    if (campos.length) throw recusa('JUNCAO_CLASSIFICACAO_DIVERGENTE', 'as posições não têm a mesma classificação', { posicao_id: o.id, campos });
  }
  const evento = await criarEvento(tx, {
    clienteId: auth.clienteId, empresaId: e.empresaId, tipo: TIPOS_EVENTO.JUNCAO, dia, usuarioId: auth.usuarioId, operationKey: e.operationKey,
    dados: { principal_posicao_id: principal.id, origem_posicao_ids: e.origens, area_id: area.id, ...(e.observacoes ? { observacoes: e.observacoes } : {}) },
  });
  for (const id of ids) await garantirPesoBase(tx, auth.clienteId, posicoes.get(id));
  const sP = await saldoNaData(tx, auth.clienteId, principal.id, dia);
  let peso = await pesoNaData(tx, auth.clienteId, principal.id, dia);
  peso = peso === undefined ? pesoNum(principal.peso_medio_kg) : peso;
  let acumulado = sP;
  const contribuicoes = [];
  const partidas = [];
  const pedidos = new Map();
  for (const id of e.origens) {
    const o = posicoes.get(id);
    const q = await saldoNaData(tx, auth.clienteId, o.id, dia);
    if (q <= 0) throw recusa('JUNCAO_LOTE_INELEGIVEL', 'a posição de origem não tinha cabeças na data da junção', { posicao_id: o.id, data: dia });
    const pO = await pesoNaData(tx, auth.clienteId, o.id, dia);
    peso = pesoPonderado(acumulado, peso, q, pO === undefined ? pesoNum(o.peso_medio_kg) : pO);
    acumulado += q;
    partidas.push({ posicao_id: o.id, delta: -q }, { posicao_id: principal.id, delta: q });
    pedidos.set(o.id, q);
    contribuicoes.push({ classe: 'contribuicao_juncao', evento_id: evento.id, posicao_id: o.id, lote_id: o.lote_entrada_id ?? null, origem: JSON.parse(o.chave_identidade)[0] ?? null, nome: o.nome, numero_lote: o.numero_lote ?? null, quantidade: q, linhagem_origem: o.linhagem ?? [] });
  }
  await inserirPartidas(tx, { clienteId: auth.clienteId, empresaId: e.empresaId, eventoId: evento.id, dia, partidas });
  ponto('apos_primeira_partida');
  await registrarPeso(tx, { clienteId: auth.clienteId, empresaId: e.empresaId, eventoId: evento.id, posicaoId: principal.id, dia, peso });
  await tx.posicaoRebanho.update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: principal.id } }, data: { linhagem: [...(Array.isArray(principal.linhagem) ? principal.linhagem : []), ...contribuicoes] } });
  const participantes = ids.map((id) => posicoes.get(id));
  return concluir(tx, contexto, {
    e, evento, envolvidas: ids, antes: posicoes, areas, pedidos, dia,
    dadosPonte: {
      tipo: 'Junção de Lotes',
      lote: principal.nome,
      lote_id: principal.lote_entrada_id ?? principal.id,
      lote_ids: idsCitados(participantes),
      quantidade_animais: acumulado - sP,
      data_movimentacao: e.dataMovimentacao,
      area_origem_id: area.id,
      area_origem_nome: area.nome,
      categoria_animal: principal.categoria ?? null,
      juncao: {
        principal: { lote_id: principal.id, posicao_id: principal.id, lote_entrada_id: principal.lote_entrada_id ?? null, nome: principal.nome, numero_lote: principal.numero_lote ?? null, quantidade_antes: sP, quantidade_depois: acumulado, peso_antes_kg: pesoNum(principal.peso_medio_kg), peso_depois_kg: peso },
        politica_peso: peso === null ? 'desconhecido_sem_media' : 'media_ponderada',
        total_cabecas: acumulado,
      },
      linhas: contribuicoes.map((c) => ({ lote_id: c.posicao_id, posicao_id: c.posicao_id, lote_entrada_id: c.lote_id, nome: c.nome, numero_lote: c.numero_lote, quantidade: c.quantidade, peso_medio_kg: null })),
      ...(e.observacoes ? { observacoes: e.observacoes } : {}),
    },
  });
};
