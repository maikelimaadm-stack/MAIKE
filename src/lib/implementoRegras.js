/**
 * Regras puras do Diário da máquina (D-PROD-314 e seguintes): a mistura no implemento, o saldo, a aplicação no pasto e a
 * sobra. Sem rede e sem React: a tela e o service usam estas funções.
 *
 * Decimais: na LEITURA aceitam texto do servidor ("2000.0000") ou digitado ("2.000,5"); no ENVIO vão como TEXTO canônico
 * (`textoDecimal`), o que o servidor espera. Volumes e quantidades são L ou KG (a unidade vem do implemento/produto).
 *
 * Contas (o protótipo aprovado pelo dono):
 *  - saldo: o que ainda está no implemento (texto `saldo` da mistura);
 *  - % no implemento: saldo ÷ capacidade;
 *  - produto restante: quantidade do item (por implemento cheio) × saldo ÷ capacidade;
 *  - aplicação: o que saiu do implemento neste pasto = saldo (esvaziou) ou saldo − sobra (sobrou um pouco); o produto
 *    gasto em cada pasto é o mesmo cálculo com o volume aplicado.
 */

import { parseDecimalPtBR } from '@/domain/numeroPtBR';
import { MOTIVO_MINIMO } from '@/lib/lancamentoAtividadesRegras';

/** Status da mistura no servidor (o que o diário lê). */
export const STATUS_MISTURA = Object.freeze({ ABERTA: 'ABERTA', ACABOU: 'ACABOU', DEVOLVIDA: 'DEVOLVIDA', PERDA: 'PERDA' });

/** Tipos de destino da sobra (contrato: `POST …/misturas/:id/sobra`). */
export const TIPO_SOBRA = Object.freeze({ TRANSFERENCIA: 'TRANSFERENCIA', DEVOLUCAO: 'DEVOLUCAO', PERDA: 'PERDA' });

/** Casas decimais de volume e de quantidade no envio. */
const CASAS = 4;

/**
 * Lê um decimal (número, texto do servidor "2000.0000" ou digitado "2.000,5"). Sem valor válido, `null`.
 * @param {unknown} valor @returns {number|null}
 */
export const lerDecimal = (valor) => {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  if (!texto) return null;
  const n = texto.includes(',') ? parseDecimalPtBR(texto) : Number(texto);
  return n !== null && Number.isFinite(n) ? n : null;
};

/**
 * Texto canônico de um decimal para o envio: sem zeros à direita e com ponto ("0.5", "2000"). Vazio/negativo → null.
 * @param {unknown} valor @returns {string|null}
 */
export const textoDecimal = (valor) => {
  const n = lerDecimal(valor);
  if (n === null || n < 0) return null;
  return String(Number(n.toFixed(CASAS)));
};

/** Arredonda para o que a tela mostra (4 casas no cálculo, 2 na exibição). @param {number} n */
const arredondar = (n) => Number(n.toFixed(CASAS));

/** Volume ou quantidade para ler: "1.200 L", "12,5 kg". Sem valor, o traço. @param {unknown} valor @param {string} [unidade] */
export const formatarVolume = (valor, unidade = '') => {
  const n = lerDecimal(valor);
  if (n === null) return '—';
  const numero = n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return unidade ? `${numero} ${rotuloUnidade(unidade)}` : numero;
};

/** L ou KG (qualquer caixa) → "L" ou "kg". Outra coisa volta como veio. @param {unknown} unidade */
export const rotuloUnidade = (unidade) => {
  const u = String(unidade ?? '').trim().toUpperCase();
  if (u === 'L') return 'L';
  if (u === 'KG') return 'kg';
  return String(unidade ?? '').trim();
};

/** A unidade do envio (`L` | `KG`) a partir de um texto qualquer; padrão L. @param {unknown} unidade */
export const unidadeDoEnvio = (unidade) => (String(unidade ?? '').trim().toUpperCase() === 'KG' ? 'KG' : 'L');

// ─── Saldo e barra do implemento ─────────────────────────────────────────

/** @param {any} mistura */
export const saldoDaMistura = (mistura) => lerDecimal(mistura?.saldo) ?? 0;

/** @param {any} mistura */
export const capacidadeDaMistura = (mistura) => lerDecimal(mistura?.capacidade) ?? 0;

/**
 * Quanto do implemento está cheio, em % (0 a 100). Sem capacidade, 0.
 * @param {number} saldo @param {number} capacidade
 */
export const percentualNoImplemento = (saldo, capacidade) => {
  if (!(capacidade > 0)) return 0;
  const p = Math.round((100 * saldo) / capacidade);
  return Math.min(100, Math.max(0, p));
};

/**
 * Produto restante no implemento: `item × saldo ÷ capacidade` (o que sobra de cada produto na calda).
 * @param {{ quantidade: unknown }} item @param {number} saldo @param {number} capacidade @returns {number}
 */
/**
 * O nome e a unidade do produto de um item da mistura, na forma que o servidor manda (`produto_nome`, `produto_unidade`)
 * ou no objeto aninhado (`produto.nome`, `produto.unidade`). Sem um nem outro, vazio.
 * @param {any} it
 */
const nomeDoItem = (it) => String(it?.produto_nome ?? it?.produto?.nome ?? '');
/** @param {any} it */
const unidadeDoItem = (it) => it?.produto_unidade ?? it?.produto?.unidade ?? null;

export const produtoRestante = (item, saldo, capacidade) => {
  const q = lerDecimal(item?.quantidade) ?? 0;
  if (!(capacidade > 0)) return 0;
  return arredondar((q * saldo) / capacidade);
};

/**
 * A mistura ABERTA com saldo (a que o Passo 2 aplica e a barra mostra). Se há mais de uma, a de maior número.
 * @param {any[]} misturas
 */
export const misturaAberta = (misturas) => {
  const abertas = (Array.isArray(misturas) ? misturas : []).filter((m) => m?.status === STATUS_MISTURA.ABERTA && saldoDaMistura(m) > 0);
  if (!abertas.length) return null;
  return abertas.slice().sort((a, b) => (Number(b.numero) || 0) - (Number(a.numero) || 0))[0];
};

/**
 * O resumo do implemento para a barra do diário: saldo, capacidade, %, unidade e o produto restante de cada item.
 * Sem mistura aberta, `existe` é falso e os números vêm zerados.
 * @param {any} mistura
 */
export const resumoDoImplemento = (mistura) => {
  if (!mistura) return { existe: false, saldo: 0, capacidade: 0, unidade: 'L', percentual: 0, produtos: [] };
  const saldo = saldoDaMistura(mistura);
  const capacidade = capacidadeDaMistura(mistura);
  const unidade = unidadeDoEnvio(mistura.unidade);
  const produtos = (Array.isArray(mistura.itens) ? mistura.itens : []).map((it) => ({
    produto_id: String(it.produto_id ?? ''),
    nome: nomeDoItem(it),
    unidade: rotuloUnidade(unidadeDoItem(it) ?? unidade),
    restante: produtoRestante(it, saldo, capacidade),
  }));
  return { existe: true, saldo, capacidade, unidade, percentual: percentualNoImplemento(saldo, capacidade), produtos };
};

/**
 * A linha de texto da barra: "No implemento: 1.200 L de 2.000 L · Herbicida glifosato 2,4 L".
 * @param {ReturnType<typeof resumoDoImplemento>} resumo
 */
export const textoDaBarra = (resumo) => {
  if (!resumo.existe) return 'Nenhuma mistura no implemento';
  const cabeca = `No implemento: ${formatarVolume(resumo.saldo)} ${rotuloUnidade(resumo.unidade)} de ${formatarVolume(resumo.capacidade)} ${rotuloUnidade(resumo.unidade)}`;
  const produtos = resumo.produtos.map((p) => `${p.nome} ${formatarVolume(p.restante)} ${p.unidade}`.trim());
  return [cabeca, ...produtos].join(' · ');
};

// ─── Produto: quantidade padrão por implemento cheio ─────────────────────

/**
 * A quantidade padrão de um produto (por implemento cheio), como vem do servidor: `{ quantidade, unidade }`. Sem padrão,
 * `quantidade` é "" e a unidade cai na de estoque do produto.
 * @param {any} produto
 */
export const quantidadePadraoDoProduto = (produto) => {
  const q = typeof produto?.quantidade_padrao === 'string' || typeof produto?.quantidade_padrao === 'number' ? String(produto.quantidade_padrao) : '';
  const estoque = String(produto?.unidade_principal_estoque ?? '').trim().toUpperCase() === 'L' ? 'L' : 'KG';
  const unidade = produto?.quantidade_padrao_unidade ? unidadeDoEnvio(produto.quantidade_padrao_unidade) : estoque;
  return { quantidade: lerDecimal(q) !== null ? q : '', unidade };
};

// ─── Mistura (Passo 1) ───────────────────────────────────────────────────

/**
 * Valida a mistura antes do envio: o implemento (com capacidade), e cada linha com produto, local e quantidade > 0.
 * `linhas`: `[{ produto_id, local_estoque_id, quantidade }]`. Devolve `{ ok, erros }` (`erros.linhas[i]` por campo).
 * @param {{ implementoId: string, capacidade: unknown, linhas: Array<{ produto_id: string, local_estoque_id: string, quantidade: string }> }} p
 */
export const validarMistura = ({ implementoId, capacidade, linhas }) => {
  /** @type {{ implemento?: string, capacidade?: string, itens?: string, linhas: Array<Record<string, string>> }} */
  const erros = { linhas: [] };
  if (!implementoId) erros.implemento = 'Escolha o implemento.';
  if (implementoId && !(lerDecimal(capacidade) > 0)) erros.capacidade = 'Este implemento não tem capacidade cadastrada.';
  const lista = Array.isArray(linhas) ? linhas : [];
  if (!lista.length) erros.itens = 'Coloque pelo menos um produto.';
  for (const l of lista) {
    /** @type {Record<string, string>} */
    const e = {};
    if (!l.produto_id) e.produto = 'Escolha o produto.';
    if (l.produto_id && !l.local_estoque_id) e.local = 'Escolha o local do estoque.';
    if (!(lerDecimal(l.quantidade) > 0)) e.quantidade = 'Informe a quantidade.';
    erros.linhas.push(e);
  }
  const temErro = Boolean(erros.implemento || erros.capacidade || erros.itens || erros.linhas.some((e) => Object.keys(e).length));
  return { ok: !temErro, erros };
};

/**
 * Corpo da mistura (sem `operation_id`, que o service põe): empresa, implemento, área e os itens com decimais em texto.
 * @param {{ empresaId: string, implementoId: string, areaId: string, linhas: Array<{ produto_id: string, local_estoque_id: string, quantidade: string }> }} p
 */
export const corpoDaMistura = ({ empresaId, implementoId, areaId, linhas }) => ({
  empresa_id: empresaId,
  implemento_bem_id: implementoId,
  area_id: areaId,
  itens: linhas.map((l) => ({ produto_id: l.produto_id, local_estoque_id: l.local_estoque_id, quantidade: textoDecimal(l.quantidade) })),
});

// ─── Aplicação no pasto (Passo 2) ────────────────────────────────────────

/**
 * Valida a aplicação: se NÃO esvaziou, a sobra é obrigatória, maior que zero e menor que o saldo.
 * @param {{ esvaziou: boolean, sobra: string, saldo: number, unidade: string }} p
 * @returns {string|null} a mensagem, ou `null` quando está certo
 */
export const validarAplicacao = ({ esvaziou, sobra, saldo, unidade }) => {
  if (esvaziou) return null;
  const s = lerDecimal(sobra);
  if (s === null || s <= 0) return `Quanto sobrou no implemento? Informe em ${rotuloUnidade(unidade)}.`;
  if (s >= saldo) return `A sobra tem de ser menor que o que tem no implemento (${formatarVolume(saldo)} ${rotuloUnidade(unidade)}).`;
  return null;
};

/**
 * Quanto saiu do implemento neste pasto: saldo (esvaziou) ou saldo − sobra.
 * @param {{ saldo: number, esvaziou: boolean, sobra: string }} p
 */
export const volumeAplicado = ({ saldo, esvaziou, sobra }) => {
  if (esvaziou) return arredondar(saldo);
  const s = lerDecimal(sobra) ?? 0;
  return arredondar(Math.max(0, saldo - s));
};

/**
 * O que foi para o pasto de cada produto: `item × volume ÷ capacidade`.
 * @param {any} mistura @param {number} volume
 */
export const produtosDaAplicacao = (mistura, volume) => {
  const capacidade = capacidadeDaMistura(mistura);
  const unidade = unidadeDoEnvio(mistura?.unidade);
  return (Array.isArray(mistura?.itens) ? mistura.itens : []).map((it) => ({
    produto_id: String(it.produto_id ?? ''),
    nome: nomeDoItem(it),
    unidade: rotuloUnidade(unidadeDoItem(it) ?? unidade),
    quantidade: capacidade > 0 ? arredondar((lerDecimal(it.quantidade) ?? 0) * volume / capacidade) : 0,
  }));
};

/**
 * Corpo da aplicação (sem `operation_id`): sempre `esvaziou`; a `sobra` só vai quando NÃO esvaziou.
 * @param {{ empresaId: string, esvaziou: boolean, sobra: string }} p
 */
export const corpoDaAplicacao = ({ empresaId, esvaziou, sobra }) => {
  const corpo = { empresa_id: empresaId, esvaziou: esvaziou === true };
  if (esvaziou !== true) corpo.sobra = textoDecimal(sobra);
  return corpo;
};

// ─── Sobra (Trocar pasto e Encerrar o dia) ───────────────────────────────

/**
 * Valida o destino da sobra: transferência pede o pasto de chegada; perda pede o motivo (3 caracteres ou mais).
 * @param {{ tipo: string, paraAreaId?: string, motivo?: string }} p @returns {string|null}
 */
export const validarSobra = ({ tipo, paraAreaId = '', motivo = '' }) => {
  if (tipo === TIPO_SOBRA.TRANSFERENCIA && !paraAreaId) return 'Escolha o pasto para onde a sobra vai.';
  if (tipo === TIPO_SOBRA.PERDA && String(motivo ?? '').trim().length < MOTIVO_MINIMO) return `Informe o motivo da perda (ao menos ${MOTIVO_MINIMO} letras).`;
  return null;
};

/**
 * Corpo do destino da sobra (sem `operation_id`). Só vai o que foi preenchido: os horímetros são opcionais e o motivo
 * só existe na perda.
 * @param {{ empresaId: string, tipo: string, paraAreaId?: string, apontamentoId?: string, motivo?: string, horimetroSaida?: string, horimetroChegada?: string }} p
 */
export const corpoDaSobra = ({ empresaId, tipo, paraAreaId, apontamentoId, motivo, horimetroSaida, horimetroChegada }) => {
  /** @type {Record<string, unknown>} */
  const corpo = { empresa_id: empresaId, tipo };
  if (tipo === TIPO_SOBRA.TRANSFERENCIA && paraAreaId) corpo.para_area_id = paraAreaId;
  if (apontamentoId) corpo.apontamento_id = apontamentoId;
  if (tipo === TIPO_SOBRA.PERDA) corpo.motivo = String(motivo ?? '').trim();
  const hs = textoDecimal(horimetroSaida);
  const hc = textoDecimal(horimetroChegada);
  if (hs !== null) corpo.horimetro_saida = hs;
  if (hc !== null) corpo.horimetro_chegada = hc;
  return corpo;
};

// ─── Trajeto sem sobra e falha de rota (D-PROD-325) ──────────────────────

/**
 * Corpo do TRAJETO (só horímetros, sem sobra, sem estoque). Sem nenhum horímetro informado, `null`: a tela não manda nada.
 * @param {{ empresaId: string, deAreaId: string, paraAreaId: string, horimetroSaida?: unknown, horimetroChegada?: unknown }} p
 */
export const corpoDoTrajeto = ({ empresaId, deAreaId, paraAreaId, horimetroSaida, horimetroChegada }) => {
  const hs = textoDecimal(horimetroSaida);
  const hc = textoDecimal(horimetroChegada);
  if (hs === null && hc === null) return null;
  /** @type {Record<string, unknown>} */
  const corpo = { empresa_id: empresaId, de_area_id: deAreaId, para_area_id: paraAreaId };
  if (hs !== null) corpo.horimetro_saida = hs;
  if (hc !== null) corpo.horimetro_chegada = hc;
  return corpo;
};

/**
 * A falha é de ROTA (o servidor ainda não tem a rota nova), e não de negócio: a camada de API marca o erro
 * (`rotaAusente`, nativeHttpClient). Quem chama cai no fluxo antigo. Um 404 de negócio traz `code` e não entra aqui.
 * @param {any} erro
 */
export const ehFalhaDeRota = (erro) => erro?.rotaAusente === true;

// ─── Textos de escolha ───────────────────────────────────────────────────

/** Os textos de escolha da sobra no Trocar pasto, na ordem da tela. */
export const OPCOES_SOBRA_TROCAR = Object.freeze([
  { value: TIPO_SOBRA.TRANSFERENCIA, label: 'Vai junto para o próximo pasto' },
  { value: TIPO_SOBRA.DEVOLUCAO, label: 'Volta ao depósito' },
  { value: TIPO_SOBRA.PERDA, label: 'Perda (com motivo)' },
]);
