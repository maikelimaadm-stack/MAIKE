/**
 * Backend FALSO de Abastecimentos (Patrimônio P1-02, D-PROD-159; revisto pela
 * D-PROD-162, SIMPLIFICA-01) — só para os testes RTL. Nada aqui fala com banco
 * ou API real. Segue o contrato §4.9/§4.11 da D-PROD-162: rotas A1–A6, A7 bens,
 * A8 tanques (com os Produtos aceitos), A11 produtos do filtro, A12 locais e
 * A16 `produtos-do-bem` com a semântica do serviço real (bem ativo → tanques
 * ativos → aceites ATIVOS → Produto ativo, da fazenda, em L ou KG; `resumo` do
 * conjunto inteiro). A baixa é EXATAMENTE a `quantidade` do corpo, na unidade
 * do Produto, sem fator; a capacidade (litros) só vale para Produto em L.
 * Decimais como TEXTO com 4 casas, datas AAAA-MM-DD, corpo FECHADO (campo
 * antigo → 400), `operation_id` idempotente (replay 200 `replay:true`; mesmo
 * id + corpo diferente → 409 IDEMPOTENCY_CONFLICT), `versao` com
 * compare-and-swap e corpo de erro `{code, message, request_id, field?,
 * reason?, details?}` com os códigos REAIS. FIFO pelos lotes com o
 * `dinheiroDecimal` real (BigInt). Sem dependência de Vitest (puro JS).
 */
import { comparar, deUnidades, ehPositivo, multiplicarArredondar, naEscala, paraUnidades, somar, subtrair } from '../../../src/lib/dinheiroDecimal.js';
import { hojeNoFuso } from '../../../src/lib/diaCivil.js';

export const EMPRESA = 'emp-1';
export const TS = '2026-11-08T12:00:00.000Z';
const LIMITE_ESTOQUE = '9999999999.9999';
const UNIDADES = ['L', 'KG'];
const rotuloUnidade = (u) => (u === 'L' ? 'L' : u === 'KG' ? 'kg' : (u ?? '—'));

const erro = (status, code, extra = {}) => ({ status, body: { code, message: 'texto do servidor (falso)', request_id: 'req_fake', ...extra } });
const n4 = (v) => naEscala(v, 4);
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

/**
 * Estado inicial (cada teste cria o seu). Cenários extras (multi-tanque, vários
 * Produtos por tanque, aceite retirado, Produto inativo/de outra fazenda, unidade
 * fora de L/KG) são montados no teste mutando o estado ANTES de montar a tela:
 * `tanques[bem][i].ativo`/`produtos` (ids dos Produtos aceitos ATIVOS),
 * `produtos[i].ativo`/`empresa`/`unidade_principal_estoque`.
 */
export const criarEstadoAbastecimentos = () => {
  const hoje = hojeNoFuso('America/Sao_Paulo');
  return {
    hoje,
    fuso: 'America/Sao_Paulo',
    bens: [
      { id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', ativo: true, medidor: { tipo: 'HORIMETRO', unidade: 'h' }, cadastro: { leitura: '1520.5000', data: '2026-06-01' } },
      { id: 'b2', numero: '8', codigo_frota: 'UT-04', nome: 'Caminhonete flex', natureza: 'VEICULO', ativo: true, medidor: { tipo: 'ODOMETRO', unidade: 'km' }, cadastro: { leitura: '35210.0000', data: '2026-05-30' } },
      { id: 'b3', numero: '9', codigo_frota: 'GR-01', nome: 'Gerador', natureza: 'EQUIPAMENTO', ativo: true, medidor: { tipo: 'SEM_MEDIDOR', unidade: null }, cadastro: null },
      { id: 'b4', numero: '3', codigo_frota: 'CO-01', nome: 'Colhedora parada', natureza: 'MAQUINA', ativo: false, medidor: { tipo: 'CICLOS', unidade: 'ciclos' }, cadastro: { leitura: '10.0000', data: '2026-01-01' } },
    ],
    /** `produtos` = ids dos Produtos aceitos ATIVOS do tanque (`TanqueBemProduto`). */
    tanques: {
      b1: [{ id: 'tq1', identificador: 'Tanque principal', capacidade_litros: '180.0000', produtos: ['p1'] }],
      b2: [{ id: 'tq2', identificador: 'Tanque flex', capacidade_litros: '80.0000', produtos: ['p2', 'p3'] }],
      b3: [{ id: 'tq3', identificador: 'Tanque do gerador', capacidade_litros: '50.0000', produtos: ['p1'] }],
      b4: [],
    },
    produtos: [
      { id: 'p1', nome: 'Diesel S10 granel', codigo_interno: 'DS10', unidade_principal_estoque: 'L', estoque_atual: '150.0000' },
      { id: 'p2', nome: 'Gasolina comum', codigo_interno: 'GC', unidade_principal_estoque: 'L', estoque_atual: '500.0000' },
      { id: 'p3', nome: 'Etanol hidratado', codigo_interno: 'ET', unidade_principal_estoque: 'L', estoque_atual: '300.0000' },
    ],
    locais: { l1: 'Tanque diesel sede', l2: 'Posto da fazenda' },
    lotes: [
      { id: 'lote-A', produto: 'p1', local: 'l1', dia: '2026-06-01', disponivel: '50.0000', custo: '5.2000' },
      { id: 'lote-B', produto: 'p1', local: 'l1', dia: '2026-06-03', disponivel: '100.0000', custo: '5.5000' },
      { id: 'lote-G', produto: 'p2', local: 'l2', dia: '2026-06-02', disponivel: '500.0000', custo: '6.0000' },
      { id: 'lote-E', produto: 'p3', local: 'l2', dia: '2026-06-02', disponivel: '300.0000', custo: '4.0000' },
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

const bemPorId = (e, id) => e.bens.find((b) => b.id === id) ?? null;
const produtoPorId = (e, id) => e.produtos.find((p) => p.id === id) ?? null;
const contador = (tipo) => ['HORIMETRO', 'ODOMETRO', 'CICLOS'].includes(tipo);
const empresaDoProduto = (p) => p.empresa ?? EMPRESA;

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

const consumirFifo = (lotes, quantidade) => {
  let falta = quantidade;
  const fatias = [];
  for (const l of lotes) {
    if (!ehPositivo(falta)) break;
    const q = comparar(l.disponivel, falta) >= 0 ? falta : l.disponivel;
    fatias.push({ ordem: fatias.length + 1, lote_id: l.id, data_lote: l.dia, quantidade: n4(q), custo_unitario: n4(l.custo), valor: multiplicarArredondar(q, l.custo, 4) });
    falta = subtrair(falta, q, 4);
  }
  const disponivel = somar(lotes.map((l) => l.disponivel), 4);
  return { suficiente: !ehPositivo(falta), disponivel, fatias };
};

/** Mesmo plano na prévia e na confirmação (D-PROD-162 §4.9, ordem fixa B0..B10). */
const planejar = (e, c) => {
  const bloqueios = [];
  const b = (code, field, reason, details = {}) => bloqueios.push({ code, field, reason, details });
  const bem = bemPorId(e, c.bem_id);
  const tanque = (e.tanques[c.bem_id] ?? []).find((t) => t.id === c.tanque_id) ?? null;
  const produto = produtoPorId(e, c.produto_id);
  const localNome = e.locais[c.local_estoque_id] ?? null;
  const quantidade = n4(c.quantidade);
  // B0
  const positiva = ehPositivo(quantidade);
  if (!positiva) b('OPERACAO_VALORES_INVALIDOS', 'quantidade', 'quantidade_nao_positiva');
  // B1
  if (c.data_operacional > e.hoje) b('ABASTECIMENTO_DATA_FUTURA', 'data_operacional', 'data_futura', { hoje: e.hoje, fuso: e.fuso });
  // B2
  if (!bem.ativo) b('ABASTECIMENTO_BEM_INELEGIVEL', 'bem_id', 'bem_inativo');
  // B3
  if (!tanque) b('ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inexistente');
  else if (tanque.ativo === false) b('ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inativo');
  // B4
  let produtoValido = false;
  if (!produto) b('ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'inexistente');
  else if (empresaDoProduto(produto) !== EMPRESA) b('ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'outra_empresa');
  else if (produto.ativo === false) b('ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'inativo');
  else produtoValido = true;
  // B5
  const unidadeAceita = Boolean(produto) && UNIDADES.includes(produto.unidade_principal_estoque);
  if (produto && !unidadeAceita) b('ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'produto_id', 'unidade_nao_aceita', { unidade: produto.unidade_principal_estoque });
  const unidade = unidadeAceita ? produto.unidade_principal_estoque : null;
  // B6
  if (tanque && produto && !(tanque.produtos ?? []).includes(produto.id)) b('ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque');
  // B7
  if (!localNome) b('ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inexistente');
  // B8a — só Produto em L
  const confereCapacidade = unidade === 'L';
  if (confereCapacidade && tanque && comparar(quantidade, tanque.capacidade_litros) > 0) {
    b('ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade', 'excede_capacidade_tanque', { capacidade_litros: tanque.capacidade_litros });
  }
  // B8b
  const dentroDoLimite = comparar(quantidade, LIMITE_ESTOQUE) <= 0;
  if (!dentroDoLimite) b('OPERACAO_VALORES_INVALIDOS', 'quantidade', 'valor_excede_limite_estoque', { quantidade });
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
  // B10 — FIFO com a quantidade digitada
  const produtoOk = produtoValido && unidadeAceita;
  let fifo = null;
  let estoque = null;
  if (produtoOk && localNome) {
    const lotes = lotesFifo(e, produto.id, c.local_estoque_id);
    estoque = { saldo_local: somar(lotes.map((l) => l.disponivel), 4), estoque_atual: n4(produto.estoque_atual), unidade };
    if (positiva && dentroDoLimite) {
      const f = consumirFifo(lotes, quantidade);
      const total = somar(f.fatias.map((x) => x.valor), 4);
      fifo = { suficiente: f.suficiente, disponivel: f.disponivel, fatias: f.fatias, custo_total_estimado: total, custo_unitario_estimado: dividir4(total, quantidade) };
      if (!f.suficiente) b('ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'saldo_lote_insuficiente', { disponivel: f.disponivel, solicitado: quantidade, unidade });
      else if (comparar(produto.estoque_atual, quantidade) < 0) b('ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'estoque_atual_insuficiente', { estoque_atual: n4(produto.estoque_atual), solicitado: quantidade, unidade });
      else if (comparar(total, LIMITE_ESTOQUE) > 0) b('OPERACAO_VALORES_INVALIDOS', 'quantidade', 'valor_excede_limite_estoque', { valor_total: total });
    }
  }
  const plano = {
    empresa_id: EMPRESA,
    data_operacional: c.data_operacional,
    hoje: e.hoje,
    bem: { id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota, nome: bem.nome, natureza: bem.natureza, ativo: bem.ativo },
    tanque: tanque ? { id: tanque.id, identificador: tanque.identificador, capacidade_litros: tanque.capacidade_litros, ativo: tanque.ativo !== false } : null,
    produto: produto ? { id: produto.id, nome: produto.nome, codigo_interno: produto.codigo_interno ?? null, unidade_principal_estoque: produto.unidade_principal_estoque } : null,
    local_estoque: localNome ? { id: c.local_estoque_id, nome: localNome } : null,
    quantidade,
    unidade,
    confere_capacidade: confereCapacidade,
    estoque,
    fifo,
    medidor: { tipo: tipoMedidor, unidade: bem.medidor.unidade, leitura: r === null ? null : n4(r), anterior, posterior },
    tanque_cheio: c.tanque_cheio === true,
    custo_e_estimativa: true,
  };
  return { plano, bloqueios, bem, tanque, produto, localNome, quantidade, unidade, fifo };
};

/** Objeto `bem` de A8/A16 (com a leitura vigente do medidor). */
const bemPublicoDe = (e, bem) => ({
  id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota, nome: bem.nome, natureza: bem.natureza, ativo: bem.ativo, medidor: bem.medidor, leitura_vigente: leituraVigente(e, bem.id),
});

const NATUREZAS_COM_TANQUE = ['MAQUINA', 'VEICULO', 'EQUIPAMENTO'];
const porNomeEId = (a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Por que um Produto aceito não serve agora (null = serve): inativo → outra fazenda → unidade. */
const motivoDoProduto = (p) => (p.ativo === false ? 'inativo' : empresaDoProduto(p) !== EMPRESA ? 'outra_empresa' : !UNIDADES.includes(p.unidade_principal_estoque) ? 'unidade_nao_aceita' : null);

/**
 * A16 `produtos-do-bem` (D-PROD-162 §4.9): a MESMA semântica do serviço real.
 * Elegível = aceite ATIVO num tanque ATIVO do bem ∧ Produto ativo ∧ da fazenda
 * do bem ∧ unidade L ou KG. Cada item traz os tanques que o aceitam. `resumo`
 * sobre o conjunto inteiro (ignora `q` e `cursor`).
 */
const produtosDoBem = async (e, query) => {
  const bem = bemPorId(e, query.get('bem_id'));
  if (!bem) return erro(404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', { field: 'bem_id', reason: 'bem_inexistente' });
  if (typeof e.atrasoProdutosDoBem === 'function') {
    const espera = e.atrasoProdutosDoBem(bem.id);
    if (espera) await espera;
  }
  const publico = bemPublicoDe(e, bem);
  const vazio = (motivo, contas = {}) => ({
    status: 200,
    body: { bem: publico, itens: [], has_more: false, next_cursor: null, resumo: { motivo_sem_opcao: motivo, total: 0, fora_de_unidade: 0, inativos_ou_outra_fazenda: 0, ...contas } },
  });
  if (!bem.ativo) return vazio('bem_inativo');
  if (!NATUREZAS_COM_TANQUE.includes(bem.natureza)) return vazio('sem_tanque_ativo');
  const tanques = (e.tanques[bem.id] ?? []).filter((t) => t.ativo !== false).sort((a, b) => (a.identificador < b.identificador ? -1 : a.identificador > b.identificador ? 1 : a.id < b.id ? -1 : 1));
  if (!tanques.length) return vazio('sem_tanque_ativo');
  const aceitos = new Map();
  const tanquesPorProduto = new Map();
  for (const t of tanques) {
    for (const id of t.produtos ?? []) {
      const p = produtoPorId(e, id);
      if (!p) continue;
      aceitos.set(p.id, p);
      const lista = tanquesPorProduto.get(p.id) ?? [];
      if (!lista.some((x) => x.id === t.id)) lista.push({ id: t.id, identificador: t.identificador, capacidade_litros: t.capacidade_litros });
      tanquesPorProduto.set(p.id, lista);
    }
  }
  if (!aceitos.size) return vazio('tanque_sem_produto');
  let total = 0;
  let foraDeUnidade = 0;
  let inativosOuOutraFazenda = 0;
  for (const p of aceitos.values()) {
    const m = motivoDoProduto(p);
    if (m === null) total += 1;
    else if (m === 'unidade_nao_aceita') foraDeUnidade += 1;
    else inativosOuOutraFazenda += 1;
  }
  const resumo = {
    motivo_sem_opcao: total > 0 ? null : foraDeUnidade > 0 ? 'produto_unidade_incompativel' : 'produto_inativo_ou_outra_fazenda',
    total,
    fora_de_unidade: foraDeUnidade,
    inativos_ou_outra_fazenda: inativosOuOutraFazenda,
  };
  if (!total) return vazio(resumo.motivo_sem_opcao, resumo);
  const elegiveis = [...aceitos.values()].filter((p) => motivoDoProduto(p) === null).map((p) => ({ ...p })).sort(porNomeEId);
  const filtrados = filtrarQ(elegiveis, query, ['nome', 'codigo_interno']);
  const consulta = new URLSearchParams(query);
  if (e.paginaProdutosDoBem) consulta.set('limit', String(e.paginaProdutosDoBem));
  const pag = pagina(filtrados, consulta);
  const itens = pag.itens.map((p) => ({
    id: p.id,
    produto: { id: p.id, nome: p.nome, codigo_interno: p.codigo_interno ?? null, unidade_principal_estoque: p.unidade_principal_estoque },
    tanques: (tanquesPorProduto.get(p.id) ?? []).map((t) => ({ ...t })),
    pronto: true,
  }));
  return { status: 200, body: { bem: publico, itens, has_more: pag.has_more, next_cursor: pag.next_cursor, resumo } };
};

const erroDoBloqueio = (bl) => erro(422, bl.code, { field: bl.field, reason: bl.reason, details: { field: bl.field, reason: bl.reason, ...bl.details } });

const movimento = (m) => (m ? { ...m } : null);

/** Métrica por (medidor, unidade) — `abastecimentoConsumo.js` (P-03). */
const METRICA = {
  ODOMETRO: { L: ['KM_POR_LITRO', 'km/L'], KG: ['KM_POR_KG', 'km/kg'] },
  HORIMETRO: { L: ['LITROS_POR_HORA', 'L/h'], KG: ['KG_POR_HORA', 'kg/h'] },
};
const metricaDe = (tipo, unidade) => {
  const m = METRICA[tipo]?.[unidade];
  return m ? { metrica: m[0], unidade_metrica: m[1] } : { metrica: null, unidade_metrica: null };
};

/** Consumo pelo método do tanque cheio (só para o fake: linhas em memória), com acumulados de L e de KG por tanque. */
const intervalosDoBem = (e, bemId) => {
  const bem = bemPorId(e, bemId);
  const tipo = bem.medidor.tipo;
  const porTanque = new Map();
  const confirmados = e.abastecimentos
    .filter((a) => a.bem_id === bemId && a.status === 'CONFIRMADO')
    .sort((a, b) => (a.data_operacional < b.data_operacional ? -1 : a.data_operacional > b.data_operacional ? 1 : a.seq - b.seq));
  const saida = [];
  for (const a of confirmados) {
    const est = porTanque.get(a.tanque_id) ?? { ultimoCheio: null, L: '0.0000', KG: '0.0000' };
    est[a.unidade] = somar([est[a.unidade], a.quantidade], 4);
    if (a.tanque_cheio) {
      const ant = est.ultimoCheio;
      let it = { situacao: 'DADOS_INSUFICIENTES', motivo: 'sem_tanque_cheio_anterior', ...metricaDe(tipo, a.unidade), intervalo: null, quantidade: null, unidade: null, valor: null, abastecimento_inicial_id: null, data_inicial: null, leitura_inicial: null };
      if (ant) {
        const intervalo = subtrair(a.medidor_leitura, ant.leitura, 4);
        const qL = subtrair(est.L, ant.L, 4);
        const qK = subtrair(est.KG, ant.KG, 4);
        const base = { abastecimento_inicial_id: ant.id, data_inicial: ant.data, leitura_inicial: ant.leitura, intervalo };
        if (ehPositivo(qL) && ehPositivo(qK)) it = { ...it, ...base, situacao: 'DADOS_INSUFICIENTES', motivo: 'unidades_misturadas', metrica: null, unidade_metrica: null };
        else {
          const unidade = ehPositivo(qL) ? 'L' : 'KG';
          const quantidade = unidade === 'L' ? qL : qK;
          const m = metricaDe(tipo, unidade);
          if (!ehPositivo(intervalo)) it = { ...it, ...base, ...m, quantidade, unidade, motivo: 'intervalo_nao_positivo' };
          else {
            const valor = m.metrica?.startsWith('KM_') ? dividir4(intervalo, quantidade) : dividir4(quantidade, intervalo);
            it = { ...it, ...base, ...m, situacao: 'CALCULADO', motivo: null, quantidade, unidade, valor };
          }
        }
      }
      saida.push({ abastecimento_id: a.id, numero: a.numero, tanque: { id: a.tanque_id, identificador: a.tanque_identificador }, data_final: a.data_operacional, leitura_final: a.medidor_leitura, ...it });
      est.ultimoCheio = { id: a.id, data: a.data_operacional, leitura: a.medidor_leitura, L: est.L, KG: est.KG };
    }
    porTanque.set(a.tanque_id, est);
  }
  return saida.reverse();
};

export const METODOLOGIA =
  'Método do tanque cheio: entre dois abastecimentos confirmados do mesmo tanque marcados como tanque cheio, somam-se as quantidades abastecidas depois do primeiro até o segundo (inclusive), na unidade do Produto (L ou kg).';

const consumoDoAbastecimento = (e, a) => {
  const bem = bemPorId(e, a.bem_id);
  const vazio = { metrica: null, unidade_metrica: null, valor: null, intervalo: null, quantidade: null, unidade: null, abastecimento_inicial_id: null, metodologia: METODOLOGIA };
  if (a.status === 'CANCELADO') return { situacao: 'NAO_APLICAVEL', motivo: 'cancelado', ...vazio };
  if (!['ODOMETRO', 'HORIMETRO'].includes(bem.medidor.tipo)) return { situacao: 'NAO_APLICAVEL', motivo: bem.medidor.tipo === 'CICLOS' ? 'medidor_ciclos' : 'sem_medidor', ...vazio };
  if (!a.tanque_cheio) return { situacao: 'DADOS_INSUFICIENTES', motivo: 'nao_e_tanque_cheio', ...vazio, ...metricaDe(bem.medidor.tipo, a.unidade) };
  const it = intervalosDoBem(e, a.bem_id).find((x) => x.abastecimento_id === a.id);
  return {
    situacao: it.situacao, motivo: it.motivo, metrica: it.metrica, unidade_metrica: it.unidade_metrica, valor: it.valor, intervalo: it.intervalo, quantidade: it.quantidade, unidade: it.unidade,
    abastecimento_inicial_id: it.abastecimento_inicial_id, metodologia: METODOLOGIA,
  };
};

/** Leitura operacional vigente (cadastro + confirmados), opcionalmente sem um abastecimento. */
const leituraVigente = (e, bemId, excetoId = null) => vigente(pontos(e, bemId).filter((p) => !excetoId || p.abastecimento_id !== excetoId));

export const detalheDe = (e, a) => {
  const bem = bemPorId(e, a.bem_id);
  const produto = produtoPorId(e, a.produto_id);
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
    produto: { id: produto.id, nome: produto.nome, unidade_principal_estoque: produto.unidade_principal_estoque },
    local_estoque: { id: a.local_estoque_id, nome: e.locais[a.local_estoque_id] },
    quantidade: a.quantidade,
    unidade: a.unidade,
    custo_total: a.custo_total,
    custo_unitario: a.custo_unitario,
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
    bem: d.bem, tanque: { id: d.tanque.id, identificador: d.tanque.identificador },
    produto: { id: d.produto.id, nome: d.produto.nome }, local_estoque: d.local_estoque, quantidade: d.quantidade, unidade: d.unidade,
    custo_total: d.custo_total, tanque_cheio: d.tanque_cheio, medidor: { tipo: d.medidor.tipo, unidade: d.medidor.unidade, leitura: d.medidor.leitura },
    referencia_externa: d.referencia_externa, created_date: TS, updated_date: TS, operation_id: a.operation_id,
  };
};

const CORPO_BASE = ['empresa_id', 'bem_id', 'tanque_id', 'produto_id', 'local_estoque_id', 'data_operacional', 'quantidade', 'medidor_leitura', 'tanque_cheio', 'observacao', 'referencia_externa'];
const OBRIG_PREVIA = ['empresa_id', 'bem_id', 'tanque_id', 'produto_id', 'local_estoque_id', 'data_operacional', 'quantidade'];
const RE_QUANTIDADE = /^\d{1,10}(\.\d{1,4})?$/;
const RE_OP = /^[A-Za-z0-9_.:-]{8,128}$/;

/** Corpo fechado: campo extra (inclusive os antigos de fator/litros/tipo), decimal não-texto ou obrigatório ausente → 400. */
const validarCorpo = (body, permitidas, obrigatorias) => {
  for (const k of Object.keys(body ?? {})) if (!permitidas.includes(k)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: k, reason: 'campo_nao_permitido' });
  for (const k of ['quantidade', 'medidor_leitura']) {
    if (body && body[k] != null && typeof body[k] !== 'string') return erro(400, 'REQUEST_VALIDATION_FAILED', { field: k, reason: 'valor_deve_ser_texto', details: { campo: k } });
  }
  for (const k of obrigatorias) if (!(k in (body ?? {}))) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: k, reason: 'obrigatorio' });
  return null;
};

/** Fingerprint canônico v2 (decimais normalizados; textos aparados). */
const fingerprint = (body) => JSON.stringify(Object.keys(body).filter((k) => k !== 'operation_id').sort().map((k) => [k, k === 'quantidade' || k === 'medidor_leitura' ? (body[k] == null ? null : n4(body[k])) : body[k]]));

const empresaOk = (v) => v === EMPRESA;

/**
 * Roteia uma chamada (mesma assinatura de `instalarBackendFake`). `undefined` = rota ausente.
 * D-PROD-162: as rotas removidas (`tipos`, `produtos`, fatores kg/L) não existem (404 do fake).
 * @param {ReturnType<typeof criarEstadoAbastecimentos>} e
 */
export const rotearAbastecimentos = async (e, { method, path, query, body }) => {
  if (method === 'GET' && path === '/empresas') return { status: 200, body: [{ id: EMPRESA, numero_empresa: 1, nome: 'Fazenda Boa Vista', fuso_horario: e.fuso }] };

  // ─── Opções ───
  if (method === 'GET' && path.startsWith('/patrimonio-abastecimentos-opcoes/')) {
    const recurso = path.split('/')[2];
    if (!['bens', 'tanques', 'produtos-filtro', 'locais', 'produtos-do-bem'].includes(recurso)) return undefined;
    if (!empresaOk(query.get('empresa_id'))) return erro(404, 'EMPRESA_NOT_FOUND', { field: 'empresa_id' });
    if (recurso === 'bens') {
      const formulario = (query.get('uso') || 'formulario') === 'formulario';
      const lista = e.bens.filter((b) => !formulario || (b.ativo && (e.tanques[b.id] ?? []).some((t) => t.ativo !== false)));
      return { status: 200, body: pagina(filtrarQ(lista, query, ['nome', 'codigo_frota', 'numero']).map((b) => ({ id: b.id, numero: b.numero, codigo_frota: b.codigo_frota, nome: b.nome, natureza: b.natureza, ativo: b.ativo, medidor: b.medidor })), query) };
    }
    if (recurso === 'tanques') {
      const bem = bemPorId(e, query.get('bem_id'));
      if (!bem) return erro(404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', { field: 'bem_id', reason: 'bem_inexistente' });
      return {
        status: 200,
        body: {
          bem: bemPublicoDe(e, bem),
          itens: (e.tanques[bem.id] ?? [])
            .filter((t) => t.ativo !== false)
            .map((t) => ({
              id: t.id,
              identificador: t.identificador,
              capacidade_litros: t.capacidade_litros,
              produtos: (t.produtos ?? [])
                .map((id) => produtoPorId(e, id))
                .filter(Boolean)
                .sort(porNomeEId)
                .map((p) => {
                  const motivo = motivoDoProduto(p);
                  return { id: p.id, nome: p.nome, codigo_interno: p.codigo_interno ?? null, unidade_principal_estoque: p.unidade_principal_estoque, elegivel: motivo === null, motivo };
                }),
            })),
        },
      };
    }
    if (recurso === 'produtos-do-bem') return produtosDoBem(e, query);
    if (recurso === 'produtos-filtro') return { status: 200, body: pagina(filtrarQ(e.produtos.map((p) => ({ id: p.id, nome: p.nome })), query, ['nome']), query) };
    // locais
    const produto = produtoPorId(e, query.get('produto_id'));
    if (!produto) return erro(404, 'PRODUTO_NOT_FOUND', { field: 'produto_id', reason: 'produto_nao_encontrado' });
    const porLocal = new Map();
    for (const l of e.lotes.filter((x) => x.produto === produto.id && ehPositivo(x.disponivel))) porLocal.set(l.local, somar([porLocal.get(l.local) ?? '0', l.disponivel], 4));
    return { status: 200, body: { itens: [...porLocal.entries()].map(([id, saldo]) => ({ local_estoque_id: id, local_nome: e.locais[id], disponivel: saldo, unidade: produto.unidade_principal_estoque })) } };
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
    return {
      status: 200,
      body: {
        bem: { id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota, nome: bem.nome, medidor_tipo: bem.medidor.tipo, medidor_unidade: bem.medidor.unidade },
        situacao_geral: aplica ? 'DISPONIVEL' : 'NAO_APLICAVEL',
        metodologia: METODOLOGIA,
        intervalos: aplica ? intervalosDoBem(e, bem.id) : [],
      },
    };
  }

  // ─── Prévia ───
  if (method === 'POST' && path === '/patrimonio-abastecimentos-previa') {
    const v = validarCorpo(body, CORPO_BASE, OBRIG_PREVIA);
    if (v) return v;
    if (!RE_QUANTIDADE.test(body.quantidade)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'quantidade', reason: 'formato' });
    if (!bemPorId(e, body.bem_id)) return erro(404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', { field: 'bem_id', reason: 'bem_inexistente' });
    const { plano, bloqueios } = planejar(e, body);
    return { status: 200, body: { plano, bloqueios } };
  }

  // ─── Confirmação ───
  if (method === 'POST' && path === '/patrimonio-abastecimentos') {
    if (e.atraso) await e.atraso;
    const v = validarCorpo(body, [...CORPO_BASE, 'operation_id'], [...OBRIG_PREVIA, 'tanque_cheio', 'operation_id']);
    if (v) return v;
    if (!RE_OP.test(body.operation_id)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'operation_id', reason: 'formato' });
    if (!RE_QUANTIDADE.test(body.quantidade)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'quantidade', reason: 'formato' });
    const chave = `confirmar:${body.operation_id}`;
    const fp = fingerprint(body);
    const recibo = e.recibos.get(chave);
    if (recibo) {
      if (recibo.fingerprint !== fp) return erro(409, 'IDEMPOTENCY_CONFLICT', { details: { operation_id: body.operation_id, tipo_operacao: 'confirmar_abastecimento_bem_v2' } });
      return { status: 200, body: { ...detalheDe(e, e.abastecimentos.find((a) => a.id === recibo.id)), replay: true } };
    }
    if (e.proxima && e.proxima !== 'gravar-e-perder') {
      const r = e.proxima;
      e.proxima = null;
      return r;
    }
    if (!bemPorId(e, body.bem_id)) return erro(404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', { field: 'bem_id', reason: 'bem_inexistente' });
    const p = planejar(e, body);
    if (p.bloqueios.length) return erroDoBloqueio(p.bloqueios[0]);
    e.seq += 1;
    e.numero += 1;
    e.movimento += 1;
    const id = `ab-${e.seq}`;
    for (const f of p.fifo.fatias) {
      const lote = e.lotes.find((l) => l.id === f.lote_id);
      lote.disponivel = subtrair(lote.disponivel, f.quantidade, 4);
    }
    p.produto.estoque_atual = subtrair(p.produto.estoque_atual, p.quantidade, 4);
    const custo = p.fifo.custo_total_estimado;
    const unit = p.fifo.custo_unitario_estimado;
    const contadorBem = contador(p.bem.medidor.tipo);
    const registro = {
      id, seq: e.seq, numero: String(e.numero), status: 'CONFIRMADO', versao: 1, operation_id: body.operation_id,
      bem_id: body.bem_id, tanque_id: body.tanque_id, tanque_identificador: p.tanque.identificador, tanque_capacidade: p.tanque.capacidade_litros,
      produto_id: body.produto_id, local_estoque_id: body.local_estoque_id,
      data_operacional: body.data_operacional, quantidade: p.quantidade, unidade: p.unidade,
      custo_total: custo, custo_unitario: unit, tanque_cheio: body.tanque_cheio === true,
      medidor_tipo: p.bem.medidor.tipo, medidor_unidade: contadorBem ? p.bem.medidor.unidade : null, medidor_leitura: contadorBem ? n4(body.medidor_leitura) : null,
      observacao: body.observacao ?? null, referencia_externa: body.referencia_externa ?? null,
      movimentacao: {
        id: `mov-${e.movimento}`, numero: String(e.movimento), status: 'Ativa', tipo_movimentacao: 'Saída', tipo_detalhado: 'abastecimento_patrimonio',
        data_movimentacao: `${body.data_operacional}T12:00:00.000Z`, quantidade: p.quantidade, unidade: p.unidade, valor_unitario: unit, valor_total: custo,
      },
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
      if (recibo.fingerprint !== fp) return erro(409, 'IDEMPOTENCY_CONFLICT', { details: { operation_id: body.operation_id, tipo_operacao: 'cancelar_abastecimento_bem_v2' } });
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
    const produto = produtoPorId(e, a.produto_id);
    // Unidade EFETIVA (L fica em L; KG e SACO guardam estoque em kg): só a troca que envolve L bloqueia o estorno.
    const efetiva = (u) => (u === 'L' ? 'L' : 'KG');
    if (efetiva(produto.unidade_principal_estoque) !== efetiva(a.unidade)) {
      return erro(409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', { field: 'abastecimento', reason: 'unidade_mudou', details: { field: 'abastecimento', reason: 'unidade_mudou' } });
    }
    const antes = leituraVigente(e, a.bem_id);
    for (const f of a.fatias) {
      const lote = e.lotes.find((l) => l.id === f.lote_id);
      lote.disponivel = somar([lote.disponivel, f.quantidade], 4);
    }
    produto.estoque_atual = somar([produto.estoque_atual, a.quantidade], 4);
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
  return undefined;
};

/** Grava um abastecimento direto no estado (semente da lista), sem passar pela tela. */
export const semearAbastecimento = async (e, corpo) => {
  e.seqOp = (e.seqOp ?? 0) + 1;
  const r = await rotearAbastecimentos(e, {
    method: 'POST',
    path: '/patrimonio-abastecimentos',
    query: new URLSearchParams(),
    body: {
      empresa_id: EMPRESA, medidor_leitura: null, observacao: null, referencia_externa: null, tanque_cheio: false,
      operation_id: `semente-${e.seqOp}-xxxxxxxx`, ...corpo,
    },
  });
  if (r.status !== 201) throw new Error(`semente recusada: ${JSON.stringify(r.body)}`);
  return r.body;
};

/**
 * Mais um Produto do estoque da fazenda (`unidade` L ou KG), com um lote no
 * local e, se `tanques` vier, aceito (ativo) por esses tanques do estado.
 * @param {ReturnType<typeof criarEstadoAbastecimentos>} e
 * @param {string} id @param {string} nome
 * @param {{ unidade?: string, lote?: string|null, local?: string, custo?: string, tanques?: Array<[string, string]>, [k: string]: any }} [opcoes]
 */
export const acrescentarProduto = (e, id, nome, { unidade = 'L', lote = '100.0000', local = 'l1', custo = '5.0000', tanques = [], ...extra } = {}) => {
  e.produtos.push({ id, nome, codigo_interno: id.toUpperCase(), unidade_principal_estoque: unidade, estoque_atual: lote ?? '0.0000', ...extra });
  if (lote) e.lotes.push({ id: `lote-${id}`, produto: id, local, dia: '2026-06-04', disponivel: lote, custo });
  for (const [bem, tanque] of tanques) {
    const t = (e.tanques[bem] ?? []).find((x) => x.id === tanque);
    if (!t) throw new Error(`tanque ${tanque} do bem ${bem} não existe no fake`);
    t.produtos = [...(t.produtos ?? []), id];
  }
};

export { rotuloUnidade };
