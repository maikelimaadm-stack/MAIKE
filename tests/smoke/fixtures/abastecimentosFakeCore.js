/**
 * Backend FALSO de Abastecimentos (Patrimônio P1-02, D-PROD-159) — só para os
 * testes RTL. Nada aqui fala com banco ou API real. Segue o contrato §6:
 * rotas A1–A16 (A16 `produtos-do-bem`, D-PROD-160, com a semântica do serviço
 * real: bem ativo → tanques ativos → combustíveis ativos em L → vínculo ATIVO →
 * Produto ativo em KG; fator vigente ou `pronto:false`; `resumo` do conjunto
 * inteiro), decimais como TEXTO com casas fixas (litros/kg/leitura/custo 4,
 * fator 6), datas AAAA-MM-DD, corpo FECHADO, `operation_id` idempotente
 * (replay 200 `replay:true`; mesmo id + corpo diferente → 409
 * IDEMPOTENCY_CONFLICT), `versao` com compare-and-swap e corpo de erro
 * `{code, message, request_id, field?, reason?, details?}` com os códigos REAIS.
 * KG = ROUND_HALF_UP(litros × fator, 4) e FIFO pelos lotes, com o `dinheiroDecimal`
 * real (BigInt). Sem dependência de Vitest (puro JS).
 */
import { comparar, deUnidades, ehPositivo, multiplicarArredondar, naEscala, paraUnidades, somar, subtrair } from '../../../src/lib/dinheiroDecimal.js';
import { hojeNoFuso } from '../../../src/lib/diaCivil.js';

export const EMPRESA = 'emp-1';
export const TS = '2026-11-08T12:00:00.000Z';
const LIMITE_ESTOQUE = '9999999999.9999';

const erro = (status, code, extra = {}) => ({ status, body: { code, message: 'texto do servidor (falso)', request_id: 'req_fake', ...extra } });
const n4 = (v) => naEscala(v, 4);
const n6 = (v) => naEscala(v, 6);
/** a ÷ b com 4 casas, ROUND_HALF_UP (BigInt). */
const dividir4 = (a, b) => {
  const ua = paraUnidades(a, 4) * 10000n;
  const ub = paraUnidades(b, 4);
  let q = ua / ub;
  if ((ua % ub) * 2n >= ub) q += 1n;
  return deUnidades(q, 4);
};

const pagina = (lista, query, limitPadrao = 50) => {
  const inicio = Number(query.get('cursor') || 0);
  const limit = Number(query.get('limit') || limitPadrao);
  const fatia = lista.slice(inicio, inicio + limit);
  const mais = inicio + limit < lista.length;
  return { itens: fatia, has_more: mais, next_cursor: mais ? String(inicio + limit) : null };
};
const filtrarQ = (lista, query, campos) => {
  const q = (query.get('q') || '').toLowerCase();
  return q ? lista.filter((x) => campos.some((c) => String(x[c] ?? '').toLowerCase().includes(q))) : lista;
};

export const TIPOS = [
  { id: 'c1', codigo: 'DIESEL_S10', nome: 'Diesel S10', unidade: 'L' },
  { id: 'c2', codigo: 'GASOLINA', nome: 'Gasolina', unidade: 'L' },
  { id: 'c3', codigo: 'ETANOL', nome: 'Etanol', unidade: 'L' },
];

/**
 * Estado inicial (cada teste cria o seu). Cenários extras (multi-tanque, vários
 * Produtos por combustível, vínculo inativo, unidade fora de KG) são montados
 * no teste mutando o estado ANTES de montar a tela: `tanques[bem][i].ativo`,
 * `tipos[i].ativo`/`unidade`, `produtos[i].ativo`/`vinculo_ativo`/`unidade_principal_estoque`.
 */
export const criarEstadoAbastecimentos = () => {
  const hoje = hojeNoFuso('America/Sao_Paulo');
  return {
    hoje,
    fuso: 'America/Sao_Paulo',
    /** Catálogo de combustíveis do tenant (cópia: o teste pode inativar sem vazar). */
    tipos: TIPOS.map((t) => ({ ...t, ativo: true })),
    bens: [
      { id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', ativo: true, medidor: { tipo: 'HORIMETRO', unidade: 'h' }, cadastro: { leitura: '1520.5000', data: '2026-06-01' } },
      { id: 'b2', numero: '8', codigo_frota: 'UT-04', nome: 'Caminhonete flex', natureza: 'VEICULO', ativo: true, medidor: { tipo: 'ODOMETRO', unidade: 'km' }, cadastro: { leitura: '35210.0000', data: '2026-05-30' } },
      { id: 'b3', numero: '9', codigo_frota: 'GR-01', nome: 'Gerador', natureza: 'EQUIPAMENTO', ativo: true, medidor: { tipo: 'SEM_MEDIDOR', unidade: null }, cadastro: null },
      { id: 'b4', numero: '3', codigo_frota: 'CO-01', nome: 'Colhedora parada', natureza: 'MAQUINA', ativo: false, medidor: { tipo: 'CICLOS', unidade: 'ciclos' }, cadastro: { leitura: '10.0000', data: '2026-01-01' } },
    ],
    tanques: {
      b1: [{ id: 'tq1', identificador: 'Tanque principal', capacidade_litros: '180.0000', combustiveis: ['c1'] }],
      b2: [{ id: 'tq2', identificador: 'Tanque flex', capacidade_litros: '80.0000', combustiveis: ['c2', 'c3'] }],
      b3: [{ id: 'tq3', identificador: 'Tanque do gerador', capacidade_litros: '50.0000', combustiveis: ['c1'] }],
      b4: [],
    },
    produtos: [
      { id: 'p1', nome: 'Diesel S10 granel', codigo_interno: 'DS10', unidade_principal_estoque: 'KG', tipo: 'c1', estoque_atual: '150.0000' },
      { id: 'p2', nome: 'Gasolina comum', codigo_interno: 'GC', unidade_principal_estoque: 'KG', tipo: 'c2', estoque_atual: '500.0000' },
      { id: 'p3', nome: 'Etanol hidratado', codigo_interno: 'ET', unidade_principal_estoque: 'KG', tipo: 'c3', estoque_atual: '300.0000' },
    ],
    locais: { l1: 'Tanque diesel sede', l2: 'Posto da fazenda' },
    lotes: [
      { id: 'lote-A', produto: 'p1', local: 'l1', dia: '2026-06-01', disponivel: '50.0000', custo: '5.2000' },
      { id: 'lote-B', produto: 'p1', local: 'l1', dia: '2026-06-03', disponivel: '100.0000', custo: '5.5000' },
      { id: 'lote-G', produto: 'p2', local: 'l2', dia: '2026-06-02', disponivel: '500.0000', custo: '6.0000' },
      { id: 'lote-E', produto: 'p3', local: 'l2', dia: '2026-06-02', disponivel: '300.0000', custo: '4.0000' },
    ],
    conversoes: [
      { id: 'f1', tipo: 'c1', produto: 'p1', sequencia: 1, kg_por_litro: '0.840000', ativo: true, versao: 1, encerrado_em: null, criado_por: { id: 'u1', login: 'gerente' } },
      { id: 'f3', tipo: 'c3', produto: 'p3', sequencia: 1, kg_por_litro: '0.789100', ativo: true, versao: 1, encerrado_em: null, criado_por: { id: 'u1', login: 'gerente' } },
    ],
    abastecimentos: [],
    recibos: new Map(),
    seq: 0,
    numero: 0,
    movimento: 40,
    /** Próxima resposta forçada de um comando (POST): `{status, body}` ou `'gravar-e-perder'` (grava e responde 504). */
    proxima: null,
    /** Pausa (Promise) antes de responder ao POST de confirmação (duplo clique). */
    atraso: null,
    /** Tamanho de página forçado na lista (keyset com cursor nos testes). */
    paginaLista: null,
    /** A16: tamanho de página forçado (`has_more` com poucos Produtos). */
    paginaProdutosDoBem: null,
    /** A16: `(bemId) => Promise|null` — segura a resposta daquele bem (resposta atrasada). */
    atrasoProdutosDoBem: null,
  };
};

const tipoPorId = (e, id) => e.tipos.find((t) => t.id === id) ?? null;
const conversaoVigente = (e, tipo, produto) => e.conversoes.find((c) => c.ativo && c.tipo === tipo && c.produto === produto) ?? null;
const opcaoConversao = (c) => (c ? { id: c.id, versao: c.versao, sequencia: c.sequencia, kg_por_litro: c.kg_por_litro } : null);
const bemPorId = (e, id) => e.bens.find((b) => b.id === id) ?? null;
const contador = (tipo) => ['HORIMETRO', 'ODOMETRO', 'CICLOS'].includes(tipo);

/** Pontos do medidor (cadastro + confirmados com leitura). */
const pontos = (e, bemId) => {
  const bem = bemPorId(e, bemId);
  const lista = [];
  if (bem?.cadastro) lista.push({ leitura: bem.cadastro.leitura, data: bem.cadastro.data, origem: 'CADASTRO', abastecimento_id: null, numero: null });
  for (const a of e.abastecimentos) {
    if (a.bem_id === bemId && a.status === 'CONFIRMADO' && a.medidor_leitura) {
      lista.push({ leitura: a.medidor_leitura, data: a.data_operacional, origem: 'ABASTECIMENTO', abastecimento_id: a.id, numero: a.numero });
    }
  }
  return lista;
};
const vigente = (lista) => lista.reduce((m, p) => (!m || comparar(p.leitura, m.leitura) > 0 ? p : m), null);

const lotesFifo = (e, produto, local) => e.lotes.filter((l) => l.produto === produto && l.local === local && ehPositivo(l.disponivel)).sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));

const consumirFifo = (lotes, kg) => {
  let falta = kg;
  const fatias = [];
  for (const l of lotes) {
    if (!ehPositivo(falta)) break;
    const q = comparar(l.disponivel, falta) >= 0 ? falta : l.disponivel;
    fatias.push({ ordem: fatias.length + 1, lote_id: l.id, data_lote: l.dia, quantidade_kg: n4(q), custo_unitario: n4(l.custo), valor: multiplicarArredondar(q, l.custo, 4) });
    falta = subtrair(falta, q, 4);
  }
  const disponivel = somar(lotes.map((l) => l.disponivel), 4);
  return { suficiente: !ehPositivo(falta), disponivel_kg: disponivel, fatias };
};

/** Mesmo plano na prévia e na confirmação (§5.5, ordem fixa dos bloqueios). */
const planejar = (e, c, { comando }) => {
  const bloqueios = [];
  const b = (code, field, reason, details = {}) => bloqueios.push({ code, field, reason, details });
  const bem = bemPorId(e, c.bem_id);
  const tanque = (e.tanques[c.bem_id] ?? []).find((t) => t.id === c.tanque_id) ?? null;
  const tipo = tipoPorId(e, c.tipo_combustivel_id);
  const produto = e.produtos.find((p) => p.id === c.produto_id) ?? null;
  const conversao = produto && tipo ? conversaoVigente(e, tipo.id, produto.id) : null;
  const localNome = e.locais[c.local_estoque_id] ?? null;
  const litros = n4(c.quantidade_litros);
  if (!ehPositivo(litros)) b('OPERACAO_VALORES_INVALIDOS', 'quantidade_litros', 'quantidade_nao_positiva');
  if (c.data_operacional > e.hoje) b('ABASTECIMENTO_DATA_FUTURA', 'data_operacional', 'data_futura', { hoje: e.hoje, fuso: e.fuso });
  if (!bem.ativo) b('ABASTECIMENTO_BEM_INELEGIVEL', 'bem_id', 'bem_inativo');
  if (!tanque) b('ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inexistente');
  else if (tanque.ativo === false) b('ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inativo');
  if (!tipo) b('COMBUSTIVEL_PRODUTO_INVALIDO', 'tipo_combustivel_id', 'tipo_inexistente');
  else if (tipo.ativo === false) b('COMBUSTIVEL_PRODUTO_INVALIDO', 'tipo_combustivel_id', 'tipo_inativo');
  else if (tanque && !tanque.combustiveis.includes(tipo.id)) b('TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'tipo_combustivel_id', 'nao_aceito_pelo_tanque');
  // Vínculo do PAR (tipo, produto) na empresa: inativo (ou de outro tipo) → recusa, nunca troca de produto.
  const vinculoOk = Boolean(produto && tipo && produto.tipo === tipo.id && produto.vinculo_ativo !== false);
  if (!produto) b('COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'inexistente');
  else if (tipo && !vinculoOk) b('COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo');
  if (vinculoOk && !conversao) b('ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente', { tipo_combustivel_id: tipo.id, produto_id: produto.id });
  if (comando && conversao && (c.conversao_id !== conversao.id || c.conversao_versao !== conversao.versao)) {
    b('ABASTECIMENTO_CONVERSAO_ALTERADA', 'conversao_id', 'conversao_alterada', { conversao_vigente_id: conversao.id, conversao_vigente_versao: conversao.versao });
  }
  if (!localNome) b('ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inexistente');
  if (tanque && comparar(litros, tanque.capacidade_litros) > 0) b('ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade_litros', 'excede_capacidade_tanque', { capacidade_litros: tanque.capacidade_litros });
  let kg = null;
  if (conversao && ehPositivo(litros)) {
    kg = multiplicarArredondar(litros, conversao.kg_por_litro, 4);
    if (!ehPositivo(kg)) b('OPERACAO_VALORES_INVALIDOS', 'quantidade_litros', 'quantidade_estoque_zero', { quantidade_kg: kg });
    else if (comparar(kg, LIMITE_ESTOQUE) > 0) b('OPERACAO_VALORES_INVALIDOS', 'quantidade_litros', 'valor_excede_limite_estoque', { quantidade_kg: kg });
  }
  // B9 — medidor.
  const tipoMedidor = bem.medidor.tipo;
  const r = c.medidor_leitura ?? null;
  let anterior = null;
  let posterior = null;
  if (!contador(tipoMedidor) && r !== null) b('MEDIDOR_LEITURA_INVALIDA', 'medidor_leitura', 'sem_medidor');
  else if (contador(tipoMedidor) && r === null) b('MEDIDOR_LEITURA_INVALIDA', 'medidor_leitura', 'obrigatoria');
  else if (contador(tipoMedidor)) {
    const ps = pontos(e, bem.id);
    anterior = ps.filter((p) => p.data <= c.data_operacional).reduce((m, p) => (!m || comparar(p.leitura, m.leitura) > 0 ? p : m), null);
    posterior = ps.filter((p) => p.data > c.data_operacional).reduce((m, p) => (!m || comparar(p.leitura, m.leitura) < 0 ? p : m), null);
    if (anterior && comparar(r, anterior.leitura) < 0) {
      b('MEDIDOR_LEITURA_REGRESSIVA', 'medidor_leitura', 'leitura_regressiva', { leitura_referencia: anterior.leitura, data_referencia: anterior.data, origem_referencia: anterior.origem, abastecimento_id: anterior.abastecimento_id });
    } else if (posterior && comparar(r, posterior.leitura) > 0) {
      b('MEDIDOR_LEITURA_ACIMA_POSTERIOR', 'medidor_leitura', 'leitura_acima_posterior', { leitura_posterior: posterior.leitura, data_posterior: posterior.data, origem_posterior: posterior.origem, abastecimento_id: posterior.abastecimento_id });
    }
  }
  let fifo = null;
  let estoque = null;
  if (kg && produto && localNome && ehPositivo(kg)) {
    const lotes = lotesFifo(e, produto.id, c.local_estoque_id);
    const f = consumirFifo(lotes, kg);
    estoque = { saldo_local_kg: f.disponivel_kg, estoque_atual_kg: n4(produto.estoque_atual) };
    const total = somar(f.fatias.map((x) => x.valor), 4);
    fifo = { suficiente: f.suficiente, disponivel_kg: f.disponivel_kg, fatias: f.fatias, custo_total_estimado: f.suficiente ? total : null, custo_unitario_estimado: f.suficiente ? dividir4(total, kg) : null };
    if (!f.suficiente) b('ESTOQUE_SALDO_INSUFICIENTE', 'quantidade_litros', 'saldo_lote_insuficiente', { disponivel: f.disponivel_kg, solicitado: kg });
  }
  const plano = {
    empresa_id: EMPRESA,
    data_operacional: c.data_operacional,
    hoje: e.hoje,
    bem: { id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota, nome: bem.nome, natureza: bem.natureza, ativo: bem.ativo },
    tanque: tanque ? { id: tanque.id, identificador: tanque.identificador, capacidade_litros: tanque.capacidade_litros, ativo: true } : null,
    tipo_combustivel: tipo ? { id: tipo.id, codigo: tipo.codigo, nome: tipo.nome, unidade: tipo.unidade } : null,
    produto: produto ? { id: produto.id, nome: produto.nome, codigo_interno: produto.codigo_interno, unidade_principal_estoque: produto.unidade_principal_estoque } : null,
    local_estoque: localNome ? { id: c.local_estoque_id, nome: localNome } : null,
    conversao: opcaoConversao(conversao),
    quantidade_litros: litros,
    quantidade_kg: kg,
    estoque,
    fifo,
    medidor: { tipo: tipoMedidor, unidade: bem.medidor.unidade, leitura: r === null ? null : n4(r), anterior, posterior },
    tanque_cheio: c.tanque_cheio === true,
    custo_e_estimativa: true,
  };
  return { plano, bloqueios, bem, tanque, tipo, produto, conversao, localNome, kg, fifo };
};

/** Objeto `bem` de A8/A16 (com a leitura vigente do medidor). */
const bemPublicoDe = (e, bem) => ({
  id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota, nome: bem.nome, natureza: bem.natureza, ativo: bem.ativo, medidor: bem.medidor, leitura_vigente: leituraVigente(e, bem.id),
});

const NATUREZAS_COM_TANQUE = ['MAQUINA', 'VEICULO', 'EQUIPAMENTO'];
const porNomeEId = (a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A16 `produtos-do-bem` (contrato UX-02 §2.3): a MESMA semântica do serviço
 * real. Produto da empresa, ATIVO, com vínculo ATIVO (`vinculo_ativo !== false`)
 * de um tipo aceito por algum tanque ATIVO do bem (tipo ativo, em L), estoque em
 * KG. Sem fator → entra com `pronto:false`. `resumo` sobre o conjunto inteiro
 * (ignora `q` e `cursor`).
 */
const produtosDoBem = async (e, query) => {
  const bem = bemPorId(e, query.get('bem_id'));
  if (!bem) return erro(404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', { field: 'bem_id', reason: 'bem_inexistente' });
  if (typeof e.atrasoProdutosDoBem === 'function') {
    const espera = e.atrasoProdutosDoBem(bem.id);
    if (espera) await espera;
  }
  const publico = bemPublicoDe(e, bem);
  const vazio = (motivo) => ({
    status: 200,
    body: { bem: publico, itens: [], has_more: false, next_cursor: null, resumo: { motivo_sem_opcao: motivo, total: 0, sem_fator: 0, fora_de_kg: 0, tipos_sem_produto: [] } },
  });
  if (!bem.ativo) return vazio('bem_inativo');
  if (!NATUREZAS_COM_TANQUE.includes(bem.natureza)) return vazio('sem_tanque_ativo');
  const tanques = (e.tanques[bem.id] ?? []).filter((t) => t.ativo !== false).sort((a, b) => (a.identificador < b.identificador ? -1 : a.identificador > b.identificador ? 1 : a.id < b.id ? -1 : 1));
  if (!tanques.length) return vazio('sem_tanque_ativo');
  const tiposAceitos = new Map();
  const tanquesPorTipo = new Map();
  for (const t of tanques) {
    for (const id of t.combustiveis) {
      const tipo = tipoPorId(e, id);
      if (!tipo || tipo.ativo === false || tipo.unidade !== 'L') continue;
      tiposAceitos.set(tipo.id, tipo);
      const lista = tanquesPorTipo.get(tipo.id) ?? [];
      lista.push({ id: t.id, identificador: t.identificador, capacidade_litros: t.capacidade_litros });
      tanquesPorTipo.set(tipo.id, lista);
    }
  }
  if (!tiposAceitos.size) return vazio('tanque_sem_combustivel');
  const comVinculo = e.produtos.filter((p) => p.ativo !== false && p.vinculo_ativo !== false && (p.empresa ?? EMPRESA) === EMPRESA && tiposAceitos.has(p.tipo));
  const elegiveis = comVinculo.filter((p) => p.unidade_principal_estoque === 'KG').map((p) => ({ ...p })).sort(porNomeEId);
  const total = elegiveis.length;
  const semFator = elegiveis.filter((p) => !conversaoVigente(e, p.tipo, p.id)).length;
  const foraDeKg = comVinculo.filter((p) => p.unidade_principal_estoque !== 'KG').length;
  const tiposComProduto = new Set(comVinculo.map((p) => p.tipo));
  const resumo = {
    motivo_sem_opcao: total > 0 ? null : foraDeKg > 0 ? 'produto_unidade_nao_kg' : 'nenhum_produto_associado',
    total,
    sem_fator: semFator,
    fora_de_kg: foraDeKg,
    tipos_sem_produto: [...tiposAceitos.values()].filter((t) => !tiposComProduto.has(t.id)).sort(porNomeEId).map((t) => ({ id: t.id, nome: t.nome })),
  };
  const filtrados = filtrarQ(elegiveis, query, ['nome', 'codigo_interno']);
  const consulta = new URLSearchParams(query);
  if (e.paginaProdutosDoBem) consulta.set('limit', String(e.paginaProdutosDoBem));
  const pag = pagina(filtrados, consulta);
  const itens = pag.itens.map((p) => {
    const tipo = tiposAceitos.get(p.tipo);
    const conversao = opcaoConversao(conversaoVigente(e, tipo.id, p.id));
    const bloqueios = conversao ? [] : ['sem_fator'];
    return {
      id: p.id,
      produto: { id: p.id, nome: p.nome, codigo_interno: p.codigo_interno ?? null, unidade_principal_estoque: p.unidade_principal_estoque },
      tipo_combustivel: { id: tipo.id, codigo: tipo.codigo, nome: tipo.nome },
      conversao,
      tanques: (tanquesPorTipo.get(tipo.id) ?? []).map((t) => ({ ...t })),
      bloqueios,
      pronto: bloqueios.length === 0,
    };
  });
  return { status: 200, body: { bem: publico, itens, has_more: pag.has_more, next_cursor: pag.next_cursor, resumo } };
};

const HTTP_DO_BLOQUEIO = { ABASTECIMENTO_CONVERSAO_ALTERADA: 409 };
const erroDoBloqueio = (bl) => erro(HTTP_DO_BLOQUEIO[bl.code] ?? 422, bl.code, { field: bl.field, reason: bl.reason, details: { field: bl.field, reason: bl.reason, ...bl.details } });

const movimento = (m) => (m ? { ...m } : null);

/** Consumo pelo método do tanque cheio (só para o fake: linhas em memória). */
const intervalosDoBem = (e, bemId) => {
  const bem = bemPorId(e, bemId);
  const tipo = bem.medidor.tipo;
  const metrica = tipo === 'ODOMETRO' ? 'KM_POR_LITRO' : tipo === 'HORIMETRO' ? 'LITROS_POR_HORA' : null;
  const porTanque = new Map();
  const confirmados = e.abastecimentos
    .filter((a) => a.bem_id === bemId && a.status === 'CONFIRMADO')
    .sort((a, b) => (a.data_operacional < b.data_operacional ? -1 : a.data_operacional > b.data_operacional ? 1 : a.seq - b.seq));
  const saida = [];
  for (const a of confirmados) {
    const estadoTanque = porTanque.get(a.tanque_id) ?? { ultimoCheio: null, acumulado: '0.0000' };
    estadoTanque.acumulado = somar([estadoTanque.acumulado, a.quantidade_litros], 4);
    if (a.tanque_cheio) {
      const ant = estadoTanque.ultimoCheio;
      let it = { situacao: 'DADOS_INSUFICIENTES', motivo: 'sem_tanque_cheio_anterior', intervalo: null, litros: null, valor: null, abastecimento_inicial_id: null, data_inicial: null, leitura_inicial: null };
      if (ant) {
        const intervalo = subtrair(a.medidor_leitura, ant.leitura, 4);
        const litros = subtrair(estadoTanque.acumulado, ant.acumulado, 4);
        if (!ehPositivo(intervalo)) it = { ...it, motivo: 'intervalo_nao_positivo' };
        else {
          const valor = metrica === 'KM_POR_LITRO' ? dividir4(intervalo, litros) : dividir4(litros, intervalo);
          it = { situacao: 'CALCULADO', motivo: null, intervalo, litros, valor, abastecimento_inicial_id: ant.id, data_inicial: ant.data, leitura_inicial: ant.leitura };
        }
      }
      saida.push({ abastecimento_id: a.id, numero: a.numero, tanque: { id: a.tanque_id, identificador: a.tanque_identificador }, data_final: a.data_operacional, leitura_final: a.medidor_leitura, ...it });
      estadoTanque.ultimoCheio = { id: a.id, data: a.data_operacional, leitura: a.medidor_leitura, acumulado: estadoTanque.acumulado };
    }
    porTanque.set(a.tanque_id, estadoTanque);
  }
  return { metrica, intervalos: saida.reverse() };
};

export const METODOLOGIA =
  'Método do tanque cheio: entre dois abastecimentos confirmados do mesmo tanque marcados como tanque cheio, somam-se os litros abastecidos depois do primeiro até o segundo (inclusive).';

const consumoDoAbastecimento = (e, a) => {
  const bem = bemPorId(e, a.bem_id);
  if (a.status === 'CANCELADO') return { situacao: 'NAO_APLICAVEL', motivo: 'cancelado', metrica: null, unidade_metrica: null, valor: null, intervalo: null, litros: null, abastecimento_inicial_id: null, metodologia: METODOLOGIA };
  if (!['ODOMETRO', 'HORIMETRO'].includes(bem.medidor.tipo)) {
    return { situacao: 'NAO_APLICAVEL', motivo: bem.medidor.tipo === 'CICLOS' ? 'medidor_ciclos' : 'sem_medidor', metrica: null, unidade_metrica: null, valor: null, intervalo: null, litros: null, abastecimento_inicial_id: null, metodologia: METODOLOGIA };
  }
  const { metrica, intervalos } = intervalosDoBem(e, a.bem_id);
  const unidade = metrica === 'KM_POR_LITRO' ? 'km/L' : 'L/h';
  if (!a.tanque_cheio) return { situacao: 'DADOS_INSUFICIENTES', motivo: 'nao_e_tanque_cheio', metrica, unidade_metrica: unidade, valor: null, intervalo: null, litros: null, abastecimento_inicial_id: null, metodologia: METODOLOGIA };
  const it = intervalos.find((x) => x.abastecimento_id === a.id);
  return { situacao: it.situacao, motivo: it.motivo, metrica, unidade_metrica: unidade, valor: it.valor, intervalo: it.intervalo, litros: it.litros, abastecimento_inicial_id: it.abastecimento_inicial_id, metodologia: METODOLOGIA };
};

/** Leitura operacional vigente (cadastro + confirmados), opcionalmente sem um abastecimento. */
const leituraVigente = (e, bemId, excetoId = null) => vigente(pontos(e, bemId).filter((p) => !excetoId || p.abastecimento_id !== excetoId));

export const detalheDe = (e, a) => {
  const bem = bemPorId(e, a.bem_id);
  const conv = e.conversoes.find((c) => c.id === a.conversao_id);
  let efeito = null;
  if (a.status === 'CONFIRMADO' && a.medidor_leitura) {
    const antes = leituraVigente(e, a.bem_id);
    const depois = leituraVigente(e, a.bem_id, a.id);
    efeito = { muda: antes?.abastecimento_id === a.id, leitura_operacional_antes: antes, leitura_operacional_depois: depois };
  }
  return {
    id: a.id,
    empresa_id: EMPRESA,
    numero: a.numero,
    status: a.status,
    versao: a.versao,
    data_operacional: a.data_operacional,
    bem: { id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota, nome: bem.nome },
    tanque: { id: a.tanque_id, identificador: a.tanque_identificador, capacidade_litros: a.tanque_capacidade },
    tipo_combustivel: { id: a.tipo_combustivel_id, codigo: tipoPorId(e, a.tipo_combustivel_id).codigo, nome: tipoPorId(e, a.tipo_combustivel_id).nome },
    produto: { id: a.produto_id, nome: e.produtos.find((p) => p.id === a.produto_id).nome, unidade_principal_estoque: 'KG' },
    local_estoque: { id: a.local_estoque_id, nome: e.locais[a.local_estoque_id] },
    conversao: { id: conv.id, sequencia: conv.sequencia, versao: conv.versao, vigente: conv.ativo },
    quantidade_litros: a.quantidade_litros,
    kg_por_litro: a.kg_por_litro,
    quantidade_kg: a.quantidade_kg,
    custo_total: a.custo_total,
    custo_unitario_kg: a.custo_unitario_kg,
    tanque_cheio: a.tanque_cheio,
    medidor: { tipo: a.medidor_tipo, unidade: a.medidor_unidade, leitura: a.medidor_leitura, origem: a.medidor_leitura ? 'ABASTECIMENTO' : null },
    observacao: a.observacao,
    referencia_externa: a.referencia_externa,
    movimentacao: movimento(a.movimentacao),
    estorno: movimento(a.estorno),
    fatias: a.fatias.map((f) => ({ ...f })),
    cancelamento: a.cancelamento ? { ...a.cancelamento } : null,
    criado_por: { id: 'u1', login: 'operador' },
    consumo: consumoDoAbastecimento(e, a),
    efeito_cancelamento_medidor: efeito,
    created_date: TS,
    updated_date: TS,
  };
};

const resumoDe = (e, a) => {
  const d = detalheDe(e, a);
  return {
    id: d.id, numero: d.numero, status: d.status, versao: d.versao, data_operacional: d.data_operacional,
    bem: d.bem, tanque: { id: d.tanque.id, identificador: d.tanque.identificador }, tipo_combustivel: { id: d.tipo_combustivel.id, nome: d.tipo_combustivel.nome },
    produto: { id: d.produto.id, nome: d.produto.nome }, local_estoque: d.local_estoque, quantidade_litros: d.quantidade_litros, quantidade_kg: d.quantidade_kg,
    kg_por_litro: d.kg_por_litro, custo_total: d.custo_total, tanque_cheio: d.tanque_cheio, medidor: { tipo: d.medidor.tipo, unidade: d.medidor.unidade, leitura: d.medidor.leitura },
    referencia_externa: d.referencia_externa, created_date: TS, updated_date: TS, operation_id: a.operation_id,
  };
};

const conversaoPublica = (e, c) => {
  const tipo = tipoPorId(e, c.tipo);
  const produto = e.produtos.find((p) => p.id === c.produto);
  return {
    id: c.id, empresa_id: EMPRESA, tipo_combustivel: { id: tipo.id, codigo: tipo.codigo, nome: tipo.nome }, produto: { id: produto.id, nome: produto.nome, unidade_principal_estoque: produto.unidade_principal_estoque },
    sequencia: c.sequencia, kg_por_litro: c.kg_por_litro, declara_estoque_em_kg: true, ativo: c.ativo, versao: c.versao, encerrado_em: c.encerrado_em,
    criado_por: c.criado_por ?? null, encerrado_por: c.ativo ? null : { id: 'u1', login: 'gerente' }, created_date: TS, updated_date: TS,
  };
};

const CORPO_BASE = ['empresa_id', 'bem_id', 'tanque_id', 'tipo_combustivel_id', 'produto_id', 'local_estoque_id', 'data_operacional', 'quantidade_litros', 'medidor_leitura', 'tanque_cheio', 'observacao', 'referencia_externa'];
const OBRIG_PREVIA = ['empresa_id', 'bem_id', 'tanque_id', 'tipo_combustivel_id', 'produto_id', 'local_estoque_id', 'data_operacional', 'quantidade_litros'];
const RE_LITROS = /^\d{1,10}(\.\d{1,4})?$/;
const RE_FATOR = /^\d{1,2}(\.\d{1,6})?$/;
const RE_OP = /^[A-Za-z0-9_.:-]{8,128}$/;

/** Corpo fechado: campo extra, decimal não-texto ou obrigatório ausente → 400. */
const validarCorpo = (body, permitidas, obrigatorias) => {
  for (const k of Object.keys(body ?? {})) if (!permitidas.includes(k)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: k, reason: 'campo_nao_permitido' });
  for (const k of ['quantidade_litros', 'medidor_leitura', 'kg_por_litro']) {
    if (body && body[k] != null && typeof body[k] !== 'string') return erro(400, 'REQUEST_VALIDATION_FAILED', { field: k, reason: 'valor_deve_ser_texto', details: { campo: k } });
  }
  for (const k of obrigatorias) if (!(k in (body ?? {}))) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: k, reason: 'obrigatorio' });
  return null;
};

/** Fingerprint canônico (decimais normalizados; textos aparados). */
const fingerprint = (body) => JSON.stringify(Object.keys(body).filter((k) => k !== 'operation_id').sort().map((k) => [k, k === 'quantidade_litros' || k === 'medidor_leitura' ? (body[k] == null ? null : n4(body[k])) : body[k]]));

const empresaOk = (v) => v === EMPRESA;

/**
 * Roteia uma chamada (mesma assinatura de `instalarBackendFake`). `undefined` = rota ausente.
 * @param {ReturnType<typeof criarEstadoAbastecimentos>} e
 */
export const rotearAbastecimentos = async (e, { method, path, query, body }) => {
  if (method === 'GET' && path === '/empresas') return { status: 200, body: [{ id: EMPRESA, numero_empresa: 1, nome: 'Fazenda Boa Vista', fuso_horario: e.fuso }] };

  // ─── Opções ───
  if (method === 'GET' && path.startsWith('/patrimonio-abastecimentos-opcoes/')) {
    const recurso = path.split('/')[2];
    if (recurso !== 'tipos' && !empresaOk(query.get('empresa_id'))) return erro(404, 'EMPRESA_NOT_FOUND', { field: 'empresa_id' });
    if (recurso === 'bens') {
      const formulario = (query.get('uso') || 'formulario') === 'formulario';
      const lista = e.bens.filter((b) => !formulario || (b.ativo && (e.tanques[b.id] ?? []).length));
      return { status: 200, body: pagina(filtrarQ(lista, query, ['nome', 'codigo_frota', 'numero']).map((b) => ({ id: b.id, numero: b.numero, codigo_frota: b.codigo_frota, nome: b.nome, natureza: b.natureza, ativo: b.ativo, medidor: b.medidor })), query) };
    }
    if (recurso === 'tanques') {
      const bem = bemPorId(e, query.get('bem_id'));
      if (!bem) return erro(404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', { field: 'bem_id', reason: 'bem_inexistente' });
      return {
        status: 200,
        body: {
          bem: bemPublicoDe(e, bem),
          itens: (e.tanques[bem.id] ?? []).filter((t) => t.ativo !== false).map((t) => ({ id: t.id, identificador: t.identificador, capacidade_litros: t.capacidade_litros, combustiveis: t.combustiveis.map((id) => tipoPorId(e, id)).filter((c) => c.ativo !== false && c.unidade === 'L').map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome })) })),
        },
      };
    }
    if (recurso === 'tipos') return { status: 200, body: pagina(filtrarQ(e.tipos.filter((t) => t.ativo !== false).map((t) => ({ id: t.id, codigo: t.codigo, nome: t.nome, unidade: t.unidade })), query, ['nome', 'codigo']), query) };
    if (recurso === 'produtos-do-bem') return produtosDoBem(e, query);
    if (recurso === 'produtos') {
      const tipo = query.get('tipo_combustivel_id');
      const lista = e.produtos.filter((p) => p.tipo === tipo).map((p) => ({ id: p.id, nome: p.nome, codigo_interno: p.codigo_interno, unidade_principal_estoque: p.unidade_principal_estoque, conversao: opcaoConversao(conversaoVigente(e, tipo, p.id)) }));
      return { status: 200, body: pagina(filtrarQ(lista, query, ['nome']), query) };
    }
    if (recurso === 'produtos-filtro') return { status: 200, body: pagina(filtrarQ(e.produtos.map((p) => ({ id: p.id, nome: p.nome })), query, ['nome']), query) };
    if (recurso === 'locais') {
      const produto = e.produtos.find((p) => p.id === query.get('produto_id'));
      if (!produto) return erro(404, 'PRODUTO_NOT_FOUND', { field: 'produto_id', reason: 'produto_nao_encontrado' });
      const porLocal = new Map();
      for (const l of e.lotes.filter((x) => x.produto === produto.id && ehPositivo(x.disponivel))) porLocal.set(l.local, somar([porLocal.get(l.local) ?? '0', l.disponivel], 4));
      return { status: 200, body: { itens: [...porLocal.entries()].map(([id, kg]) => ({ local_estoque_id: id, local_nome: e.locais[id], disponivel_kg: kg })) } };
    }
    return undefined;
  }

  // ─── Lista e detalhe ───
  if (method === 'GET' && path === '/patrimonio-abastecimentos') {
    if (!empresaOk(query.get('empresa_id'))) return erro(404, 'EMPRESA_NOT_FOUND', { field: 'empresa_id' });
    const de = query.get('data_de');
    const ate = query.get('data_ate');
    if (de && ate && de > ate) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'data_ate', reason: 'periodo_invertido' });
    let lista = [...e.abastecimentos].sort((a, b) => b.seq - a.seq);
    for (const [campo, chave] of [['bem_id', 'bem_id'], ['tanque_id', 'tanque_id'], ['produto_id', 'produto_id'], ['status', 'status'], ['operation_id', 'operation_id']]) {
      const v = query.get(chave);
      if (v) lista = lista.filter((a) => a[campo] === v);
    }
    if (de) lista = lista.filter((a) => a.data_operacional >= de);
    if (ate) lista = lista.filter((a) => a.data_operacional <= ate);
    const q = query.get('q');
    if (q) lista = lista.filter((a) => a.numero.includes(q) || String(a.referencia_externa ?? '').toLowerCase().includes(q.toLowerCase()));
    const inicio = Number(query.get('cursor') || 0);
    // `paginaLista`: página pequena forçada pelo teste (o motor pede no mínimo 100).
    const limit = e.paginaLista ?? Number(query.get('limit') || 100);
    const fatia = lista.slice(inicio, inicio + limit);
    const mais = inicio + limit < lista.length;
    return { status: 200, body: { items: fatia.map((a) => resumoDe(e, a)), next_cursor: mais ? String(inicio + limit) : null, has_more: mais, total: lista.length, limit } };
  }
  const mDetalhe = /^\/patrimonio-abastecimentos\/([^/]+)$/.exec(path);
  if (method === 'GET' && mDetalhe) {
    const a = e.abastecimentos.find((x) => x.id === mDetalhe[1]);
    if (!a || !empresaOk(query.get('empresa_id'))) return erro(404, 'ABASTECIMENTO_NAO_ENCONTRADO');
    return { status: 200, body: detalheDe(e, a) };
  }

  // ─── Consumo ───
  if (method === 'GET' && path === '/patrimonio-abastecimentos-consumo') {
    const bem = bemPorId(e, query.get('bem_id'));
    if (!bem) return erro(404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', { field: 'bem_id', reason: 'bem_inexistente' });
    const aplica = ['ODOMETRO', 'HORIMETRO'].includes(bem.medidor.tipo);
    const { metrica, intervalos } = aplica ? intervalosDoBem(e, bem.id) : { metrica: null, intervalos: [] };
    return {
      status: 200,
      body: {
        bem: { id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota, nome: bem.nome, medidor_tipo: bem.medidor.tipo, medidor_unidade: bem.medidor.unidade },
        situacao_geral: aplica ? 'DISPONIVEL' : 'NAO_APLICAVEL',
        metrica,
        unidade_metrica: metrica === 'KM_POR_LITRO' ? 'km/L' : metrica ? 'L/h' : null,
        metodologia: METODOLOGIA,
        intervalos,
      },
    };
  }

  // ─── Prévia ───
  if (method === 'POST' && path === '/patrimonio-abastecimentos-previa') {
    const v = validarCorpo(body, CORPO_BASE, OBRIG_PREVIA);
    if (v) return v;
    if (!RE_LITROS.test(body.quantidade_litros)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'quantidade_litros', reason: 'formato' });
    if (!bemPorId(e, body.bem_id)) return erro(404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', { field: 'bem_id', reason: 'bem_inexistente' });
    const { plano, bloqueios } = planejar(e, body, { comando: false });
    return { status: 200, body: { plano, bloqueios } };
  }

  // ─── Confirmação ───
  if (method === 'POST' && path === '/patrimonio-abastecimentos') {
    if (e.atraso) await e.atraso;
    const v = validarCorpo(body, [...CORPO_BASE, 'operation_id', 'conversao_id', 'conversao_versao'], [...OBRIG_PREVIA, 'tanque_cheio', 'operation_id', 'conversao_id', 'conversao_versao']);
    if (v) return v;
    if (!RE_OP.test(body.operation_id)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'operation_id', reason: 'formato' });
    const chave = `confirmar:${body.operation_id}`;
    const fp = fingerprint(body);
    const recibo = e.recibos.get(chave);
    if (recibo) {
      if (recibo.fingerprint !== fp) return erro(409, 'IDEMPOTENCY_CONFLICT', { details: { operation_id: body.operation_id, tipo_operacao: 'confirmar_abastecimento_bem' } });
      return { status: 200, body: { ...detalheDe(e, e.abastecimentos.find((a) => a.id === recibo.id)), replay: true } };
    }
    if (e.proxima && e.proxima !== 'gravar-e-perder') {
      const r = e.proxima;
      e.proxima = null;
      return r;
    }
    if (!bemPorId(e, body.bem_id)) return erro(404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', { field: 'bem_id', reason: 'bem_inexistente' });
    const p = planejar(e, body, { comando: true });
    if (p.bloqueios.length) return erroDoBloqueio(p.bloqueios[0]);
    e.seq += 1;
    e.numero += 1;
    e.movimento += 1;
    const id = `ab-${e.seq}`;
    for (const f of p.fifo.fatias) {
      const lote = e.lotes.find((l) => l.id === f.lote_id);
      lote.disponivel = subtrair(lote.disponivel, f.quantidade_kg, 4);
    }
    p.produto.estoque_atual = subtrair(p.produto.estoque_atual, p.kg, 4);
    const custo = p.fifo.custo_total_estimado;
    const unit = p.fifo.custo_unitario_estimado;
    const contadorBem = contador(p.bem.medidor.tipo);
    const registro = {
      id, seq: e.seq, numero: String(e.numero), status: 'CONFIRMADO', versao: 1, operation_id: body.operation_id,
      bem_id: body.bem_id, tanque_id: body.tanque_id, tanque_identificador: p.tanque.identificador, tanque_capacidade: p.tanque.capacidade_litros,
      tipo_combustivel_id: body.tipo_combustivel_id, produto_id: body.produto_id, local_estoque_id: body.local_estoque_id, conversao_id: p.conversao.id,
      data_operacional: body.data_operacional, quantidade_litros: n4(body.quantidade_litros), kg_por_litro: n6(p.conversao.kg_por_litro), quantidade_kg: p.kg,
      custo_total: custo, custo_unitario_kg: unit, tanque_cheio: body.tanque_cheio === true,
      medidor_tipo: p.bem.medidor.tipo, medidor_unidade: contadorBem ? p.bem.medidor.unidade : null, medidor_leitura: contadorBem ? n4(body.medidor_leitura) : null,
      observacao: body.observacao ?? null, referencia_externa: body.referencia_externa ?? null,
      movimentacao: { id: `mov-${e.movimento}`, numero: String(e.movimento), status: 'Ativa', tipo_movimentacao: 'Saída', tipo_detalhado: 'abastecimento_patrimonio', data_movimentacao: `${body.data_operacional}T12:00:00.000Z`, quantidade_kg: p.kg, valor_unitario: unit, valor_total: custo },
      estorno: null,
      fatias: p.fifo.fatias.map((f) => ({ ...f })),
      cancelamento: null,
    };
    e.abastecimentos.push(registro);
    e.recibos.set(chave, { fingerprint: fp, id });
    if (e.proxima === 'gravar-e-perder') {
      e.proxima = null;
      return { status: 504, body: { message: 'gateway timeout' } };
    }
    return { status: 201, body: { ...detalheDe(e, registro), replay: false } };
  }

  // ─── Cancelamento ───
  const mCancelar = /^\/patrimonio-abastecimentos\/([^/]+)\/cancelar$/.exec(path);
  if (method === 'POST' && mCancelar) {
    const v = validarCorpo(body, ['empresa_id', 'versao', 'motivo', 'operation_id'], ['empresa_id', 'versao', 'motivo', 'operation_id']);
    if (v) return v;
    if (!RE_OP.test(body.operation_id)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'operation_id', reason: 'formato' });
    const chave = `cancelar:${body.operation_id}`;
    const fp = JSON.stringify([mCancelar[1], body.empresa_id, body.versao, String(body.motivo).trim()]);
    const recibo = e.recibos.get(chave);
    if (recibo) {
      if (recibo.fingerprint !== fp) return erro(409, 'IDEMPOTENCY_CONFLICT', { details: { operation_id: body.operation_id, tipo_operacao: 'cancelar_abastecimento_bem' } });
      return { status: 200, body: { ...recibo.body, replay: true } };
    }
    if (e.proxima && e.proxima !== 'gravar-e-perder') {
      const r = e.proxima;
      e.proxima = null;
      return r;
    }
    const a = e.abastecimentos.find((x) => x.id === mCancelar[1]);
    if (!a || !empresaOk(body.empresa_id)) return erro(404, 'ABASTECIMENTO_NAO_ENCONTRADO');
    const motivo = String(body.motivo).trim();
    if (!motivo) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'motivo', reason: 'obrigatorio' });
    if (motivo.length < 3) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'motivo', reason: 'motivo_curto' });
    if (a.status !== 'CONFIRMADO') return erro(409, 'ABASTECIMENTO_STATUS_INVALIDO', { field: 'status', reason: 'status_invalido', details: { status: a.status, esperado: 'CONFIRMADO' } });
    if (a.versao !== body.versao) return erro(409, 'PATRIMONIO_VERSAO_CONFLITO', { details: { versao_atual: a.versao, versao_informada: body.versao } });
    const antes = leituraVigente(e, a.bem_id);
    for (const f of a.fatias) {
      const lote = e.lotes.find((l) => l.id === f.lote_id);
      lote.disponivel = somar([lote.disponivel, f.quantidade_kg], 4);
    }
    const produto = e.produtos.find((p) => p.id === a.produto_id);
    produto.estoque_atual = somar([produto.estoque_atual, a.quantidade_kg], 4);
    e.movimento += 1;
    a.status = 'CANCELADO';
    a.versao += 1;
    a.estorno = { ...a.movimentacao, id: `mov-${e.movimento}`, numero: String(e.movimento), tipo_movimentacao: 'Entrada', tipo_detalhado: 'estorno_abastecimento' };
    a.movimentacao = { ...a.movimentacao, status: 'Estornada' };
    a.cancelamento = { cancelado_em: TS, cancelado_por: { id: 'u1', login: 'operador' }, motivo };
    const depois = leituraVigente(e, a.bem_id);
    const corpo = { ...detalheDe(e, a), leitura_operacional_antes: antes, leitura_operacional_depois: depois };
    e.recibos.set(chave, { fingerprint: fp, body: corpo });
    if (e.proxima === 'gravar-e-perder') {
      e.proxima = null;
      return { status: 504, body: { message: 'gateway timeout' } };
    }
    return { status: 200, body: { ...corpo, replay: false } };
  }

  // ─── Fatores kg/L ───
  if (method === 'GET' && path === '/patrimonio-conversoes-combustivel') {
    if (!empresaOk(query.get('empresa_id'))) return erro(404, 'EMPRESA_NOT_FOUND', { field: 'empresa_id' });
    let lista = [...e.conversoes].reverse();
    if (query.get('situacao') === 'VIGENTES') lista = lista.filter((c) => c.ativo);
    if (query.get('tipo_combustivel_id')) lista = lista.filter((c) => c.tipo === query.get('tipo_combustivel_id'));
    if (query.get('produto_id')) lista = lista.filter((c) => c.produto === query.get('produto_id'));
    return { status: 200, body: { items: lista.map((c) => conversaoPublica(e, c)), next_cursor: null, has_more: false, total: lista.length, limit: Number(query.get('limit') || 100) } };
  }
  if (method === 'POST' && path === '/patrimonio-conversoes-combustivel') {
    const campos = ['empresa_id', 'tipo_combustivel_id', 'produto_id', 'kg_por_litro', 'declara_estoque_em_kg', 'conversao_vigente_id'];
    const v = validarCorpo(body, campos, campos);
    if (v) return v;
    if (e.proxima) {
      const r = e.proxima;
      e.proxima = null;
      return r;
    }
    if (!RE_FATOR.test(body.kg_por_litro)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'kg_por_litro', reason: 'formato' });
    const produto = e.produtos.find((p) => p.id === body.produto_id);
    if (!produto || produto.tipo !== body.tipo_combustivel_id || produto.vinculo_ativo === false) return erro(422, 'COMBUSTIVEL_PRODUTO_INVALIDO', { field: 'produto_id', reason: 'sem_vinculo_ativo' });
    if (!ehPositivo(body.kg_por_litro)) return erro(422, 'ABASTECIMENTO_CONVERSAO_INVALIDA', { field: 'kg_por_litro', reason: 'fator_nao_positivo' });
    if (comparar(body.kg_por_litro, '10') > 0) return erro(422, 'ABASTECIMENTO_CONVERSAO_INVALIDA', { field: 'kg_por_litro', reason: 'fator_acima_do_teto' });
    if (body.declara_estoque_em_kg !== true) return erro(422, 'ABASTECIMENTO_CONVERSAO_INVALIDA', { field: 'declara_estoque_em_kg', reason: 'declaracao_obrigatoria' });
    const atual = conversaoVigente(e, body.tipo_combustivel_id, body.produto_id);
    if ((atual?.id ?? null) !== body.conversao_vigente_id) {
      return erro(409, 'ABASTECIMENTO_CONVERSAO_ALTERADA', { field: 'conversao_vigente_id', reason: 'vigente_divergente', details: { conversao_vigente_id: atual?.id ?? null, conversao_vigente_versao: atual?.versao ?? null } });
    }
    if (atual) Object.assign(atual, { ativo: false, versao: atual.versao + 1, encerrado_em: TS });
    const sequencia = Math.max(0, ...e.conversoes.filter((c) => c.tipo === body.tipo_combustivel_id && c.produto === body.produto_id).map((c) => c.sequencia)) + 1;
    e.seq += 1;
    const nova = { id: `f-${e.seq}`, tipo: body.tipo_combustivel_id, produto: body.produto_id, sequencia, kg_por_litro: n6(body.kg_por_litro), ativo: true, versao: 1, encerrado_em: null, criado_por: { id: 'u1', login: 'operador' } };
    e.conversoes.push(nova);
    return { status: 201, body: conversaoPublica(e, nova) };
  }
  const mEncerrar = /^\/patrimonio-conversoes-combustivel\/([^/]+)\/encerrar$/.exec(path);
  if (method === 'POST' && mEncerrar) {
    const v = validarCorpo(body, ['empresa_id', 'versao'], ['empresa_id', 'versao']);
    if (v) return v;
    const c = e.conversoes.find((x) => x.id === mEncerrar[1]);
    if (!c) return erro(404, 'CONVERSAO_COMBUSTIVEL_NAO_ENCONTRADA');
    if (c.versao !== body.versao) return erro(409, 'PATRIMONIO_VERSAO_CONFLITO');
    if (c.ativo) Object.assign(c, { ativo: false, versao: c.versao + 1, encerrado_em: TS });
    return { status: 200, body: conversaoPublica(e, c) };
  }
  return undefined;
};

/** Grava um abastecimento direto no estado (semente da lista), sem passar pela tela. */
export const semearAbastecimento = async (e, corpo) => {
  const conv = conversaoVigente(e, corpo.tipo_combustivel_id, corpo.produto_id);
  e.seqOp = (e.seqOp ?? 0) + 1;
  const r = await rotearAbastecimentos(e, {
    method: 'POST',
    path: '/patrimonio-abastecimentos',
    query: new URLSearchParams(),
    body: {
      empresa_id: EMPRESA, medidor_leitura: null, observacao: null, referencia_externa: null, tanque_cheio: false,
      conversao_id: conv?.id, conversao_versao: conv?.versao, operation_id: `semente-${e.seqOp}-xxxxxxxx`, ...corpo,
    },
  });
  if (r.status !== 201) throw new Error(`semente recusada: ${JSON.stringify(r.body)}`);
  return r.body;
};
