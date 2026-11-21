/**
 * Estoque → Novo movimento → Ajuste de inventário (D-PROD-269): regras PURAS do formulário e as mensagens. Sem rede e
 * sem ponto flutuante: quantidades e custos são TEXTO (lidos com `lerNumeroLocal`; contas em BigInt).
 *
 * Escolhas do proprietário: o usuário digita o saldo CONTADO por produto e depósito; a tela mostra o saldo atual e a
 * diferença (contado − saldo): sobra (+), falta (−) ou sem diferença. Sobra e falta saem pelo custo médio do depósito;
 * só a sobra num depósito SEM saldo (custo médio nulo) pede o custo unitário. Sem data: o ajuste é do dia de hoje da
 * fazenda. Excluir só se nada mexeu depois; editar só a observação. O servidor recalcula a diferença ao gravar, com o
 * saldo do momento, e é quem bloqueia de fato.
 */
import { getApiErrorMessage } from '@/apis/_core/ApiError';
import { lerErroGestao } from '@/lib/gestaoErros';
import { comparar, lerNumeroLocal, multiplicarArredondar, subtrair } from '@/lib/dinheiroDecimal';
import { formatarQtd } from '@/lib/estoqueConsultaRegras';
import { LIMITES_ENTRADA, LOCALE_ENTRADA } from '@/lib/estoqueEntradasRegras';

export const MAX_ITENS_AJUSTE = 100;
export const ROTULO_STATUS_AJUSTE = Object.freeze({ CONFIRMADA: 'Confirmado', EXCLUIDA: 'Excluído' });
export const SOBRA = 'SOBRA';
export const FALTA = 'FALTA';
export const SEM_DIFERENCA = 'SEM_DIFERENCA';
export const ROTULO_TIPO_AJUSTE = Object.freeze(/** @type {Record<string, string>} */ ({ [SOBRA]: 'Sobra', [FALTA]: 'Falta', [SEM_DIFERENCA]: 'Sem diferença' }));

/** @typedef {{ produto_id: string, local_estoque_id: string, unidade_estoque: 'KG'|'L', saldo: string, custo_medio: string|null }} SaldoDoDeposito */

let sequenciaDeLinha = 0;
/** Uma linha vazia do ajuste (a `chave` é só da tela, para o React). */
export const linhaVaziaAjuste = () => ({
  chave: `a${++sequenciaDeLinha}`,
  produto: /** @type {null | { id: string, rotulo: string, unidade_estoque: string, peso_por_saco_kg: string|null }} */ (null),
  deposito: /** @type {null | { id: string, rotulo: string }} */ (null),
  unidade: '',
  contado: '',
  custo: '',
});

export const formularioVazioAjuste = () => ({
  centro_custo: /** @type {null | { id: string, rotulo: string }} */ (null),
  centro_resultado: /** @type {null | { id: string, rotulo: string }} */ (null),
  observacao: '',
  itens: [linhaVaziaAjuste()],
});

/** @param {string} texto */
const lerDecimal = (texto) => lerNumeroLocal(texto, LOCALE_ENTRADA, LIMITES_ENTRADA);
const tamanho = (/** @type {string} */ t) => [...String(t ?? '').trim()].length;

/**
 * O contado na unidade de ESTOQUE do produto (kg ou L), como texto canônico com 4 casas; `null` se ainda não dá
 * para saber (sem contado válido, sem unidade, saco sem peso). @param {any} linha
 */
export const contadoEmEstoque = (linha) => {
  const q = lerDecimal(linha?.contado);
  if (!q.ok || !linha?.unidade) return null;
  if (linha.unidade === 'SACO') {
    const peso = linha.produto?.peso_por_saco_kg;
    if (!peso) return null;
    try {
      return multiplicarArredondar(q.valor, String(peso), 4);
    } catch {
      return null;
    }
  }
  return q.valor;
};

/**
 * Diferença da linha (contado − saldo), na unidade de estoque: `{ contado, diferenca, tipo }`, ou `null` sem saldo
 * carregado ou sem contado válido. @param {any} linha @param {SaldoDoDeposito|null|undefined} saldo
 */
export const diferencaDaLinha = (linha, saldo) => {
  if (!saldo || typeof saldo.saldo !== 'string') return null;
  const contado = contadoEmEstoque(linha);
  if (contado == null) return null;
  try {
    const diferenca = subtrair(contado, saldo.saldo, 4);
    const sinal = comparar(diferenca.replace(/^-/, ''), '0') === 0 ? 0 : diferenca.startsWith('-') ? -1 : 1;
    return { contado, diferenca, tipo: sinal > 0 ? SOBRA : sinal < 0 ? FALTA : SEM_DIFERENCA };
  } catch {
    return null;
  }
};

/** A linha precisa do custo unitário? Só a SOBRA num depósito sem saldo (custo médio nulo). @param {any} linha @param {SaldoDoDeposito|null|undefined} saldo */
export const precisaCusto = (linha, saldo) => Boolean(saldo && saldo.custo_medio === null && diferencaDaLinha(linha, saldo)?.tipo === SOBRA);

/** "+ 10 kg" / "− 10 kg" / "0 kg". @param {string} diferenca canônico com sinal @param {string} unidade */
export const formatarDiferenca = (diferenca, unidade) => {
  const negativo = diferenca.startsWith('-');
  const abs = diferenca.replace(/^-/, '');
  const texto = formatarQtd(abs, unidade);
  if (comparar(abs, '0') === 0) return texto;
  return `${negativo ? '−' : '+'} ${texto}`;
};

/**
 * Confere o formulário. `saldos[i]` é o saldo do depósito da linha `i` (ou `undefined` enquanto carrega). Erros de
 * cada linha como `itens.<i>.<campo>`. @param {any} form @param {Array<SaldoDoDeposito|null|undefined>} saldos
 */
export const validarFormularioAjuste = (form, saldos = []) => {
  /** @type {Record<string, string>} */
  const erros = {};
  const itens = Array.isArray(form.itens) ? form.itens : [];
  if (!itens.length) erros.itens = 'Inclua ao menos um produto.';
  if (itens.length > MAX_ITENS_AJUSTE) erros.itens = `No máximo ${MAX_ITENS_AJUSTE} produtos por ajuste.`;
  const pares = new Map();
  itens.forEach((/** @type {any} */ l, i) => {
    const p = `itens.${i}.`;
    if (!l.produto?.id) erros[`${p}produto`] = 'Escolha o produto.';
    if (!l.deposito?.id) erros[`${p}deposito`] = 'Escolha o depósito.';
    if (!l.unidade) erros[`${p}unidade`] = 'Escolha a unidade.';
    const contado = lerDecimal(l.contado);
    if (!contado.ok) erros[`${p}contado`] = contado.motivo === 'vazio' ? 'Informe o saldo contado (pode ser 0).' : 'Quantidade inválida (até 4 casas decimais).';
    if (precisaCusto(l, saldos[i])) {
      const custo = lerDecimal(l.custo);
      if (!custo.ok) erros[`${p}custo`] = custo.motivo === 'vazio' ? 'Este depósito não tem saldo: informe o custo da sobra.' : 'Valor inválido (até 4 casas decimais).';
      else if (/^0(\.0*)?$/.test(custo.valor)) erros[`${p}custo`] = 'O custo da sobra deve ser maior que zero.';
    }
    if (l.produto?.id && l.deposito?.id) {
      const chave = `${l.produto.id}|${l.deposito.id}`;
      if (pares.has(chave)) erros[`${p}produto`] = 'Este produto já está neste depósito em outra linha.';
      pares.set(chave, i);
    }
  });
  return { erros, ok: Object.keys(erros).length === 0 };
};

/**
 * Corpo do POST: sem data (é hoje na fazenda), contado como TEXTO canônico, e o custo SÓ na sobra de um depósito sem
 * saldo. @param {string} empresaId @param {any} form @param {string} operationId @param {Array<SaldoDoDeposito|null|undefined>} saldos
 */
export const montarCorpoAjuste = (empresaId, form, operationId, saldos = []) => ({
  empresa_id: empresaId,
  operation_id: operationId,
  centro_custo_id: form.centro_custo?.id ?? null,
  centro_resultado_id: form.centro_resultado?.id ?? null,
  observacao: tamanho(form.observacao) ? String(form.observacao).trim() : null,
  itens: form.itens.map((/** @type {any} */ l, /** @type {number} */ i) => ({
    produto_id: l.produto.id,
    local_estoque_id: l.deposito.id,
    unidade: l.unidade,
    quantidade_contada: /** @type {any} */ (lerDecimal(l.contado)).valor,
    custo_unitario: precisaCusto(l, saldos[i]) ? /** @type {any} */ (lerDecimal(l.custo)).valor : null,
  })),
});

/** Id do ajuste de um movimento do Kardex (pelo documento ou pela origem). @param {any} m */
export const ajusteDoMovimento = (m) => {
  if (m?.documento?.tipo === 'AJUSTE_ESTOQUE' && m.documento.id) return { id: String(m.documento.id), numero: String(m.documento.numero ?? ''), rotulo: String(m.documento.rotulo ?? '') };
  if (m?.origem_sistema === 'ajuste_estoque' && typeof m.lancamento_origem_id === 'string' && m.lancamento_origem_id) {
    return { id: m.lancamento_origem_id, numero: '', rotulo: 'Ajuste de inventário' };
  }
  return null;
};

// ─── mensagens ──────────────────────────────────────────────────────────────

const NADA = 'Nada foi gravado.';

const INVALIDO = /** @type {Record<string, string>} */ ({
  unidade_incompativel: 'A unidade escolhida não combina com o estoque do produto.',
  peso_por_saco_ausente: 'O produto não tem o peso do saco cadastrado: informe em quilos.',
  par_duplicado: 'O mesmo produto aparece duas vezes no mesmo depósito.',
  produto_inexistente: 'O produto não existe nesta fazenda.',
  produto_inativo: 'O produto está inativo.',
  local_inexistente: 'O depósito não existe.',
  centro_custo_inexistente: 'O centro de custo não existe nesta fazenda.',
  centro_custo_inativo: 'O centro de custo está inativo.',
  centro_resultado_inexistente: 'O centro de resultado não existe nesta fazenda.',
  centro_resultado_inativo: 'O centro de resultado está inativo.',
});

/** Linha (1-based) e nomes a partir de `details.indice`/`details.item_ordem`. @param {Record<string, any>} details @param {any[]} itens */
const linhaDoErro = (details, itens) => {
  const indice = Number.isInteger(details.indice) ? details.indice : Number.isInteger(details.item_ordem) ? details.item_ordem - 1 : null;
  if (indice == null) return null;
  const l = itens[indice];
  return { numero: indice + 1, produto: l?.produto?.rotulo ?? null, deposito: l?.deposito?.rotulo ?? null };
};

/**
 * Mensagem em português de um erro dos Ajustes, pelo CÓDIGO do servidor (a `message` do servidor nunca é exibida).
 * `itens` são as linhas do formulário, para dizer qual linha foi recusada.
 * @param {unknown} erro @param {string} padrao @param {any[]} [itens]
 */
export const mensagemErroAjuste = (erro, padrao, itens = []) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  const linha = linhaDoErro(details, itens);
  const naLinha = linha ? ` (linha ${linha.numero}${linha.produto && linha.deposito ? `: ${linha.produto} em ${linha.deposito}` : ''})` : '';
  switch (code) {
    case 'AJUSTE_ESTOQUE_NOT_FOUND':
      return 'Ajuste não encontrado nesta fazenda. A lista será atualizada.';
    case 'AJUSTE_ESTOQUE_INVALIDO':
      if (reason === 'nada_a_alterar') return 'Nada mudou na observação.';
      if (reason === 'custo_obrigatorio_sem_saldo') {
        return `Este depósito não tem saldo${linha?.produto ? ` de ${linha.produto}` : ' deste produto'}; informe o custo da sobra${linha ? ` (linha ${linha.numero})` : ''}. ${NADA}`;
      }
      return `${INVALIDO[String(reason)] ?? `O ajuste foi recusado (${field ?? 'dados inválidos'}).`}${naLinha ? ` Confira a${naLinha.slice(2, -1)}.` : ''} ${NADA}`;
    case 'AJUSTE_ESTOQUE_MOVIMENTO_POSTERIOR':
      return 'Um produto deste ajuste já teve outro movimento no depósito depois dele: o ajuste não pode ser excluído. Para corrigir, faça uma nova contagem. Nada foi alterado.';
    case 'AJUSTE_ESTOQUE_STATUS_INVALIDO':
      return 'Este ajuste já foi excluído. Nada foi alterado.';
    case 'AJUSTE_ESTOQUE_VERSAO_CONFLITO':
      return 'O ajuste mudou desde que foi aberto (ou outra operação mexeu no mesmo estoque). Feche e abra de novo. Nada foi alterado.';
    case 'AJUSTE_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA':
      return 'Só a observação se edita. Para mudar a contagem ou os centros, exclua o ajuste e faça outro.';
    case 'ESTOQUE_SALDO_INSUFICIENTE':
      return `O saldo mudou enquanto você contava${naLinha}. Confira o saldo atual e envie de novo. ${NADA}`;
    case 'OPERACAO_VALORES_INVALIDOS':
      if (reason === 'valor_excede_limite_estoque') return `A quantidade ou o valor passa do limite do estoque${naLinha}. ${NADA}`;
      return `Quantidade ou custo inválidos${naLinha}. ${NADA}`;
    case 'ESTOQUE_LOCAL_INVALIDO':
      return `O depósito não existe mais ou está inativo. ${NADA}`;
    case 'EMPRESA_FUSO_NAO_CONFIGURADO':
      return `O fuso horário da fazenda não está configurado (Empresa). ${NADA}`;
    case 'IDEMPOTENCY_CONFLICT':
      return `Esta operação já foi enviada com outro conteúdo. Feche a janela e abra de novo. ${NADA}`;
    default:
      return getApiErrorMessage(erro, padrao);
  }
};
