/**
 * Mensagens em português dos erros dos cadastros de Gestão Rural (D-PROD-146).
 *
 * O transporte nativo (`nativeHttpClient`) só preserva códigos catalogados; os
 * códigos novos de Gestão viajam no corpo do servidor, guardado em `erro.cause`
 * (não enumerável, nunca exibido cru). Aqui lemos SÓ `code`, `field`, `reason` e
 * `details` — a `message` do servidor continua descartada.
 *
 * O errorHandler do servidor sobe `field` e `reason` ao topo do corpo quando os
 * dois existem; senão ficam em `details`. Aceitamos os dois lugares.
 */

import { getApiErrorMessage } from '@/apis/_core/ApiError';
import { formatarMoeda, formatarNumero } from '@/lib/dinheiroDecimal';
import { formatarDia } from '@/lib/diaCivil';

/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} erro
 * @returns {{ code: string|null, field: string|null, reason: string|null, details: Record<string, any> }}
 */
export const lerErroGestao = (erro) => {
  const e = /** @type {any} */ (erro);
  const causa = ehObjeto(e?.cause) ? e.cause : {};
  const detalhesCausa = ehObjeto(causa.details) ? causa.details : {};
  const detalhesErro = ehObjeto(e?.details) ? e.details : {};
  const details = { ...detalhesErro, ...detalhesCausa };
  const code = typeof causa.code === 'string' ? causa.code : typeof e?.code === 'string' ? e.code : null;
  const field = [causa.field, detalhesCausa.field, detalhesErro.field].find((v) => typeof v === 'string') ?? null;
  const reason = [causa.reason, detalhesCausa.reason, detalhesErro.reason].find((v) => typeof v === 'string') ?? null;
  return { code, field, reason, details };
};

const ROTULO_DOCUMENTO = /** @type {Record<string, string>} */ ({ cpf: 'CPF', cnpj: 'CNPJ' });

const HIERARQUIA = /** @type {Record<string, string>} */ ({
  ciclo: 'O centro escolhido como pai está abaixo deste centro na hierarquia (formaria um ciclo).',
  profundidade_maxima: 'A hierarquia ultrapassaria o número máximo de níveis permitido.',
  pai_inativo: 'O centro escolhido como pai está inativo. Escolha um pai ativo.',
  pai_fora_da_empresa: 'O centro escolhido como pai não pertence a esta empresa (ou não existe mais).',
  autorreferencia: 'Um centro não pode ser pai de si mesmo.',
});

const HIERARQUIA_NATUREZA = /** @type {Record<string, string>} */ ({
  ciclo: 'A natureza escolhida como pai está abaixo desta natureza na hierarquia (formaria um ciclo).',
  profundidade_maxima: 'A hierarquia ultrapassaria o número máximo de níveis permitido.',
  pai_inativo: 'A natureza escolhida como pai está inativa. Escolha um pai ativo.',
  pai_fora_da_empresa: 'A natureza escolhida como pai não pertence a esta empresa (ou não existe mais).',
  pai_de_outro_tipo: 'A natureza pai precisa ser do mesmo tipo (Receita com Receita, Despesa com Despesa).',
  autorreferencia: 'Uma natureza não pode ser pai de si mesma.',
});

// ─── D-PROD-155 — Central Única de Lançamentos ───────────────────────────

const COLECAO = /** @type {Record<string, string>} */ ({ itens: 'dos itens', rateios: 'do rateio', parcelas: 'das parcelas' });

/**
 * " (linha 2 dos itens)" a partir de `details.colecao` + `details.indice` (0-based).
 * No rateio POR ITEM (D-PROD-156: `colecao: 'itens'`, `subcolecao: 'rateios'`)
 * aponta o item e a linha: " (item 2, linha 3 do rateio)" ou só " (item 2)".
 * @param {Record<string, any>} details
 */
const ondeNaLinha = (details) => {
  const indice = Number.isInteger(details.indice) ? details.indice : Number.isInteger(details.item_ordem) ? details.item_ordem - 1 : null;
  if (indice == null) return '';
  if (details.subcolecao === 'rateios') {
    return ` (item ${indice + 1}${Number.isInteger(details.subindice) ? `, linha ${details.subindice + 1} do rateio` : ''})`;
  }
  const colecao = COLECAO[String(details.colecao ?? (details.item_ordem != null ? 'itens' : ''))] ?? '';
  return ` (linha ${indice + 1}${colecao ? ` ${colecao}` : ''})`;
};

/**
 * Formatação dos valores que o servidor manda em `details` (string canônica).
 * `comandoIdempotente`: a tela reenvia com o MESMO `operation_id` (Central de
 * Lançamentos) — só então a mensagem promete que a repetição não duplica.
 * @typedef {{ locale?: string, moeda?: string, casas?: number, comandoIdempotente?: boolean, direcao?: string|null }} ContextoMoeda
 */
/** @param {unknown} v @param {ContextoMoeda} c */
const dinheiro = (v, c) => (typeof v === 'string' && v ? (c.moeda ? formatarMoeda(v, { locale: c.locale, moeda: c.moeda, casas: c.casas ?? 2 }) : formatarNumero(v, { locale: c.locale, casasMin: 0, casasMax: 4 })) : '');
/** @param {unknown} v @param {ContextoMoeda} c */
const kg = (v, c) => (typeof v === 'string' && v ? `${formatarNumero(v, { locale: c.locale, casasMin: 0, casasMax: 4 })} kg` : '');
/** Dinheiro com mais casas quando o valor as tem (custo/kg com 4, diferença com 8). @param {unknown} v @param {ContextoMoeda} c @param {number} casasMax */
const dinheiroFino = (v, c, casasMax) =>
  typeof v === 'string' && v
    ? c.moeda
      ? formatarMoeda(v, { locale: c.locale, moeda: c.moeda, casas: c.casas ?? 2, casasMax })
      : formatarNumero(v, { locale: c.locale, casasMin: 0, casasMax })
    : '';

/**
 * Texto do motivo de uma linha recusada pela política de custo líquido
 * (`item_liquido_nao_positivo`, `custo_kg_nao_representavel`), com os valores
 * de `details`. O formulário usa o mesmo texto DENTRO do item (sem a linha e
 * sem o fecho "Nada foi gravado", porque nada foi tentado).
 * @param {string|null} reason @param {Record<string, any>} details @param {ContextoMoeda} [c] @param {string} [linha] " (linha N dos itens)"
 * @returns {string|null}
 */
export const mensagemDaLinhaDoRateio = (reason, details, c = {}, linha = '') => {
  if (reason === 'item_liquido_nao_positivo') {
    const valores =
      details.valor_liquido != null
        ? `: subtotal ${dinheiro(details.valor_total, c)}, desconto rateado ${dinheiro(details.valor_desconto_rateado, c)}, acréscimo rateado ${dinheiro(details.valor_acrescimo_rateado, c)}, líquido ${dinheiro(details.valor_liquido, c)}`
        : '';
    return `O desconto rateado deixa o valor líquido do item zero ou negativo${linha}${valores}. Diminua o desconto do cabeçalho ou aumente o valor do item.`;
  }
  if (reason === 'custo_kg_nao_representavel') {
    const valores =
      details.valor_liquido != null
        ? `: líquido ${dinheiro(details.valor_liquido, c)} para ${kg(details.quantidade_estoque, c)} dá ${dinheiroFino(details.custo_kg, c, 4)}/kg, e a diferença de ${dinheiroFino(details.residuo_custo, c, 8)} ficaria fora do custo`
        : '';
    return `O custo por kg não cabe nas 4 casas do estoque${linha}${valores} (o limite é 0,1% do valor líquido da linha, e nunca menos que 1 unidade mínima da moeda). Confira a quantidade, a unidade e o valor unitário do item.`;
  }
  return null;
};

const REFERENCIA_INVALIDA = /** @type {Record<string, string>} */ ({
  parceiro_nao_encontrado: 'O parceiro escolhido não existe mais nesta empresa. Escolha outro.',
  parceiro_inativo: 'O parceiro escolhido está inativo. Reative-o em Parceiros ou escolha outro.',
  parceiro_sem_papel: 'O parceiro escolhido não tem o papel exigido (a pagar: fornecedor ou prestador de serviço; a receber: cliente).',
  natureza_nao_encontrada: 'A natureza escolhida não existe mais nesta empresa. Escolha outra.',
  natureza_inativa: 'A natureza escolhida está inativa. Escolha uma natureza ativa.',
  natureza_tipo_incompativel: 'A natureza precisa ser de Despesa (a pagar) ou de Receita (a receber).',
  natureza_sintetica: 'A natureza escolhida tem naturezas filhas: escolha uma natureza do último nível (analítica).',
  centro_custo_nao_encontrado: 'O centro de custo escolhido não existe mais nesta empresa. Escolha outro.',
  centro_custo_inativo: 'O centro de custo escolhido está inativo. Escolha um ativo.',
  centro_resultado_nao_encontrado: 'O centro de resultado escolhido não existe mais nesta empresa. Escolha outro.',
  centro_resultado_inativo: 'O centro de resultado escolhido está inativo. Escolha um ativo.',
  produto_nao_encontrado: 'O produto escolhido não existe mais nesta empresa. Escolha outro.',
  produto_inativo: 'O produto escolhido está inativo. Escolha um produto ativo.',
  unidade_invalida: 'Unidade inválida para o produto: use KG, ou SACO só quando o produto é controlado em sacos com peso por saco.',
  local_nao_encontrado: 'O local de estoque escolhido não existe mais. Escolha outro.',
  local_inativo: 'O local de estoque escolhido está inativo. Escolha um local ativo.',
  metodo_nao_permitido: 'Forma de pagamento não permitida pelo perfil financeiro da empresa (Pix só existe no Brasil com Real).',
});

const PARCELAS_INVALIDAS = /** @type {Record<string, string>} */ ({
  soma_diferente: 'A soma das parcelas é diferente do total do lançamento.',
  quantidade_invalida: 'Quantidade de parcelas inválida: à vista e a prazo têm 1 parcela; parcelado tem de 2 a 120.',
  vencimento_invalido: 'Vencimento inválido: à vista vence na emissão; os demais vencem na emissão ou depois, em ordem.',
  valor_invalido: 'Toda parcela precisa ter valor maior que zero.',
});

const VALORES_INVALIDOS = /** @type {Record<string, string>} */ ({
  valor_excede_limite: 'Valor acima do limite permitido para lançamentos (99.999.999.999.999,9999).',
  valor_excede_limite_estoque: 'Para mercadoria, quantidade em kg, custo e valor têm o limite do estoque (9.999.999.999,9999). Divida em mais lançamentos.',
  item_valor_zero: 'Há item com valor total zero: confira quantidade e valor unitário.',
  total_nao_positivo: 'O total do lançamento precisa ser maior que zero (confira desconto e acréscimo).',
  quantidade_estoque_zero: 'A quantidade em kg do item ficaria zero depois da conversão. Aumente a quantidade.',
});

const VALIDACAO = /** @type {Record<string, string>} */ ({
  casas_decimais_excedidas: 'Valor com mais casas decimais do que a moeda da empresa permite. Nada foi arredondado nem gravado.',
  moeda_nao_suportada: 'Moeda fora do catálogo do sistema.',
  pais_nao_suportado: 'País fora do catálogo do sistema.',
  locale_nao_suportado: 'Idioma/formato fora do catálogo do sistema.',
  valor_deve_ser_texto: 'Valor enviado em formato inválido. Recarregue a página e tente de novo.',
  tipo_invalido: 'Dado enviado em formato inválido. Recarregue a página e tente de novo.',
  declaracao_obrigatoria: 'Confirme que a mercadoria já foi recebida/entregue antes de gravar.',
  motivo_obrigatorio: 'Informe o motivo (até 500 caracteres).',
  data_invalida: 'Data inválida: use um dia real do calendário.',
  obrigatorio: 'Há campo obrigatório sem preencher.',
  itens_obrigatorios: 'Lançamento com produtos precisa de pelo menos um item.',
  itens_nao_permitidos: 'Lançamento sem produtos não aceita itens.',
  valor_bruto_so_sem_produtos: 'O valor digitado só existe no lançamento sem produtos (com produtos, o valor é a soma dos itens).',
  nao_permitido_sem_mercadoria: 'A data operacional só existe quando há mercadoria.',
  nao_permitido_em_servico: 'Serviço não leva produto nem local de estoque.',
  baixa_no_ato_so_avista: 'A baixa no ato só existe para lançamento à vista.',
  quantidade_nao_positiva: 'A quantidade precisa ser maior que zero.',
  valor_nao_positivo: 'O valor precisa ser maior que zero.',
  tamanho_excedido: 'Texto maior que o permitido.',
});

/** Percentual de `details` (6 casas) sem zeros à direita: "90%". @param {unknown} v @param {ContextoMoeda} c */
const pct = (v, c) => (typeof v === 'string' && v ? `${formatarNumero(v, { locale: c.locale, casasMin: 0, casasMax: 6 })}%` : '');

/**
 * `OPERACAO_RATEIO_INVALIDO` — rateio geral (D-PROD-155) e por item (D-PROD-156,
 * `details.subcolecao = 'rateios'` com `indice` do item e `subindice` da linha).
 * @param {string|null} reason @param {Record<string, any>} details @param {ContextoMoeda} c @param {string} linha
 */
const mensagemDoRateio = (reason, details, c, linha) => {
  const porItem = details.subcolecao === 'rateios' && Number.isInteger(details.indice);
  const item = porItem ? ` ${details.indice + 1}` : '';
  switch (reason) {
    case 'escopo_invalido':
      return 'O escopo do rateio é inválido (use Geral ou Por item). Recarregue a página e tente de novo. Nada foi gravado.';
    case 'escopo_por_item_exige_produtos':
      return 'O rateio por item só existe no lançamento com produtos. Use o rateio geral. Nada foi gravado.';
    case 'rateio_geral_e_por_item':
      return 'O lançamento não pode ter rateio geral e rateio por item ao mesmo tempo: escolha um dos dois. Nada foi gravado.';
    case 'rateio_geral_obrigatorio':
      return 'O rateio geral precisa de pelo menos uma linha (natureza e valor). Nada foi gravado.';
    case 'item_sem_rateio':
      return `O item${item} está sem classificação no rateio por item: inclua pelo menos uma linha. Nada foi gravado.`;
    case 'rateio_item_excede_limite':
      return `O item${item} passa do limite de ${details.limite != null ? String(details.limite) : '20'} linhas de rateio. Junte classificações ou divida o item. Nada foi gravado.`;
    case 'rateio_itens_excede_limite':
      return `O lançamento passa do limite de ${details.limite != null ? String(details.limite) : '1000'} linhas de rateio somando todos os itens. Junte classificações ou divida o lançamento. Nada foi gravado.`;
    case 'soma_diferente':
      if (details.modo === 'PERCENTUAL' && details.informado != null) {
        return porItem
          ? `Os percentuais do item${item} precisam somar 100%: informado ${pct(details.informado, c)} (diferença ${pct(details.diferenca, c)}). Nada foi gravado.`
          : `Os percentuais do rateio precisam somar 100%: informado ${pct(details.informado, c)} (diferença ${pct(details.diferenca, c)}). Nada foi gravado.`;
      }
      if (details.esperado != null) {
        return porItem
          ? `O rateio do item${item} não fecha com o líquido do item: esperado ${dinheiro(details.esperado, c)}, informado ${dinheiro(details.informado, c)} (diferença ${dinheiro(details.diferenca, c)}). Nada foi gravado.`
          : `O rateio não fecha com o total: esperado ${dinheiro(details.esperado, c)}, informado ${dinheiro(details.informado, c)} (diferença ${dinheiro(details.diferenca, c)}). Nada foi gravado.`;
      }
      break;
    case 'valor_linha_zero':
      if (details.modo === 'VALOR' || details.field === 'valor') return `Há linha de rateio com valor zero${linha}. Informe um valor maior que zero ou remova a linha. Nada foi gravado.`;
      return `No rateio por percentual uma linha ficaria com valor zero${linha}. Ajuste os percentuais. Nada foi gravado.`;
    case 'linha_duplicada':
      return porItem
        ? `Há linhas de rateio repetidas no mesmo item (mesma natureza e mesmos centros)${linha}. Junte-as numa linha só. Nada foi gravado.`
        : `Há linhas de rateio repetidas (mesma natureza e mesmos centros)${linha}. Junte-as numa linha só. Nada foi gravado.`;
    case 'soma_percentual_diferente':
    case 'percentual_diferente_de_100':
      return 'Os percentuais do rateio precisam somar exatamente 100%. Nada foi gravado.';
    default:
      break;
  }
  return porItem
    ? `O rateio do item${item} é inválido${linha}. Revise as linhas (de 1 a 20 por item, valores maiores que zero). Nada foi gravado.`
    : `O rateio é inválido${linha}. Revise as linhas (de 1 a 50, valores maiores que zero). Nada foi gravado.`;
};

// ─── D-PROD-158 — elegibilidade, correção (retificar) e exclusão lógica ──

const ROTULO_PERMISSAO = /** @type {Record<string, string>} */ ({
  visualizar: 'Visualizar',
  ver: 'Visualizar',
  novo: 'Novo',
  criar: 'Novo',
  salvar: 'Salvar',
  editar: 'Editar',
  excluir: 'Excluir',
  confirmar: 'Confirmar',
  cancelar: 'Cancelar',
  liquidar: 'Liquidar',
  estornar_liquidacao: 'Estornar baixa',
});

/**
 * Motivos de uma recusa de correção/exclusão (`details.motivos`, ou `motivos`
 * no corpo). Cada um é `{ codigo, mensagem, entidade?, id?, numero?, item_ordem? }`.
 * @param {unknown} erro
 * @returns {Array<Record<string, any>>}
 */
export const motivosDoErro = (erro) => {
  const e = /** @type {any} */ (erro);
  const causa = ehObjeto(e?.cause) ? e.cause : {};
  const det = ehObjeto(causa.details) ? causa.details : ehObjeto(e?.details) ? e.details : {};
  const lista = Array.isArray(det.motivos) ? det.motivos : Array.isArray(causa.motivos) ? causa.motivos : [];
  return lista.filter((/** @type {unknown} */ m) => ehObjeto(m) && typeof m.codigo === 'string');
};

/** " (movimento nº 12)" / " (lançamento nº 7)" de um motivo, quando o servidor conhece o elo. @param {Record<string, any>} m */
const eloDoMotivo = (m) => {
  if (m.numero == null || String(m.numero) === '') return '';
  const entidade = typeof m.entidade === 'string' ? m.entidade : '';
  if (/movimenta/i.test(entidade)) return ` (movimento nº ${String(m.numero)})`;
  if (/operacao|lancamento|documento|venda|compra/i.test(entidade)) return ` (lançamento nº ${String(m.numero)})`;
  return ` (nº ${String(m.numero)})`;
};

/** Permissões que faltam, sem repetição: `exige` (lista do servidor) ou um campo avulso. @param {Record<string, any>} m */
const permissoesQueFaltam = (m) => {
  const candidatas = [...(Array.isArray(m.exige) ? m.exige : []), m.permissao, m.acao, m.entidade, m.id];
  const rotulos = candidatas.filter((v) => typeof v === 'string' && ROTULO_PERMISSAO[v]).map((v) => ROTULO_PERMISSAO[v]);
  return [...new Set(rotulos)];
};

/**
 * Texto de UM motivo da elegibilidade ou de uma recusa (SPEC §3): o código
 * conhecido vira frase própria (com parcela, item e elo que impede); código
 * novo usa a `mensagem` legível que o contrato manda no próprio motivo.
 * `c.direcao` (D-PROD-158, revisão TELA-02): o servidor emite `lote_alterado`
 * na compra (o lote da ENTRADA mudou) e na venda (um lote de onde a mercadoria
 * SAIU não aceita mais a devolução); sem a direção, o texto é neutro.
 * @param {unknown} motivo @param {ContextoMoeda} [c]
 * @returns {string}
 */
export const mensagemDoMotivo = (motivo, c = {}) => {
  const m = ehObjeto(motivo) ? motivo : {};
  const item = Number.isInteger(m.item_ordem) ? ` do item ${m.item_ordem}` : '';
  switch (m.codigo) {
    case 'sem_permissao': {
      const faltam = permissoesQueFaltam(m);
      if (!faltam.length) return 'Você não tem a permissão exigida para esta ação nesta tela. Peça ao administrador para liberar.';
      const lista = faltam.map((r) => `“${r}”`);
      const texto = lista.length === 1 ? `a permissão ${lista[0]}` : `as permissões ${lista.slice(0, -1).join(', ')} e ${lista.at(-1)}`;
      return `Você não tem ${texto} exigida${lista.length === 1 ? '' : 's'} para esta ação nesta tela. Peça ao administrador para liberar.`;
    }
    case 'tem_liquidacao': {
      const parcela = m.numero_parcela ?? m.numero;
      const estornada = m.estornada === true ? ' (já estornada — a baixa continua na história do lançamento)' : ' (mesmo estornada, a baixa continua na história do lançamento)';
      return `A parcela${parcela != null && String(parcela) ? ` nº ${String(parcela)}` : ''} tem pagamento/recebimento registrado${estornada}: com baixa, o lançamento não pode ser corrigido por inteiro nem excluído.`;
    }
    case 'documento_historico':
      return `Este lançamento é histórico (cancelado, excluído ou substituído por uma correção) e não muda mais.${
        m.numero != null && String(m.numero) && /operacao/i.test(String(m.entidade ?? '')) ? ` A versão atual é o lançamento nº ${String(m.numero)}.` : ''
      } Para lançar de novo, use Duplicar.`;
    case 'lote_consumido':
      return `A mercadoria${item} já foi usada no estoque${eloDoMotivo(m)}: o lote desta compra não está mais intacto, então a entrada não pode ser estornada nem refeita.`;
    case 'lote_alterado':
      if (c.direcao === 'RECEBER') {
        return `Um lote de onde saiu a mercadoria da venda${item} mudou depois da venda${eloDoMotivo(m)} e não pode receber a mercadoria de volta: a saída desta venda não pode ser estornada nem refeita.`;
      }
      if (c.direcao === 'PAGAR') return `O lote da mercadoria${item} foi alterado depois da entrada${eloDoMotivo(m)}: a entrada desta compra não pode ser estornada nem refeita.`;
      return `O lote da mercadoria${item} foi alterado depois do lançamento${eloDoMotivo(m)}: o efeito no estoque não pode ser estornado nem refeito.`;
    case 'venda_com_movimento_posterior':
      // Variante do servidor: OUTRO lançamento consumiu, depois da venda, um lote de onde ela saiu.
      if (/operacao|lancamento/i.test(String(m.entidade ?? '')) && m.numero != null && String(m.numero)) {
        return `O lançamento nº ${String(m.numero)} usou, depois desta venda, um lote de onde saiu a mercadoria${item}: refazer a saída mudaria o custo e o saldo das operações seguintes.`;
      }
      return `Há movimento de estoque posterior a esta venda no mesmo produto e local${eloDoMotivo(m)}${item ? ` (mercadoria${item})` : ''}: refazer a saída mudaria o custo e o saldo das operações seguintes.`;
    case 'moeda_mudou':
      return 'A moeda do perfil financeiro da empresa é diferente da moeda deste lançamento: a correção não converte valores.';
    default:
      return typeof m.mensagem === 'string' && m.mensagem.trim() ? m.mensagem.trim() : 'Há um vínculo que impede esta ação.';
  }
};

/**
 * Mensagem dos códigos da Central de Lançamentos (null = não é desta tela).
 * @param {string|null} code @param {string|null} field @param {string|null} reason @param {Record<string, any>} details
 * @param {ContextoMoeda} c
 * @returns {string|null}
 */
const mensagemLancamento = (code, field, reason, details, c) => {
  const linha = ondeNaLinha(details);
  // D-PROD-158: o perfil de moeda mudou desde o lançamento — a correção não converte valores.
  if (reason === 'moeda_mudou') return 'A moeda do perfil financeiro da empresa é diferente da moeda deste lançamento: a correção não converte valores. Nada foi alterado.';
  // D-PROD-158: `duplicado_de_id` de outro tenant/empresa (ou que não existe mais).
  if (field === 'duplicado_de_id' && (code === 'OPERACAO_REFERENCIA_INVALIDA' || code === 'REQUEST_VALIDATION_FAILED')) {
    // Revisão TELA-04: a origem pode ter sido descartada (DELETE do rascunho); a tela deixa de enviar a proveniência.
    return 'O lançamento de origem desta cópia não existe nesta empresa (pode ter sido descartado). Salve de novo: a cópia será gravada como rascunho novo, sem o vínculo de origem. Nada foi gravado.';
  }
  switch (code) {
    case 'OPERACAO_RETIFICACAO_BLOQUEADA':
    case 'OPERACAO_EXCLUSAO_BLOQUEADA': {
      const acao = code === 'OPERACAO_RETIFICACAO_BLOQUEADA' ? 'A correção' : 'A exclusão';
      const motivos = Array.isArray(details.motivos) ? details.motivos : [];
      const textos = motivos.map((/** @type {unknown} */ m) => mensagemDoMotivo(m, c));
      return `${acao} foi recusada pelo servidor${textos.length ? `: ${textos.join(' ')}` : ' (há vínculo que impede).'} Nada foi alterado.`;
    }
    case 'OPERACAO_FINANCEIRA_NOT_FOUND':
      return 'Lançamento não encontrado nesta empresa. A lista será atualizada.';
    case 'IDEMPOTENCY_EFEITO_EXCLUIDO':
      // Reenvio de um POST cujo rascunho já foi descartado: definitivo, a pendência sai.
      return 'Este envio repetia um rascunho que já foi descartado. Salve de novo para criar um rascunho novo. Nada foi gravado.';
    case 'TITULO_FINANCEIRO_NOT_FOUND':
      return 'Parcela não encontrada neste lançamento. Recarregue o lançamento.';
    case 'LIQUIDACAO_FINANCEIRA_NOT_FOUND':
      return 'Baixa não encontrada neste lançamento. Recarregue o lançamento.';
    case 'PERFIL_FINANCEIRO_NAO_CONFIGURADO':
      return 'Configure o perfil financeiro da empresa (país, moeda e formato) antes de lançar. Nada foi gravado.';
    case 'PERFIL_FINANCEIRO_MOEDA_EM_USO':
      return reason === 'estoque_legado_brl'
        ? 'A moeda precisa continuar BRL: esta empresa tem estoque com custo registrado em reais. País e formato podem mudar. Nada foi gravado.'
        : 'A moeda não pode ser trocada: esta empresa já tem lançamentos. País e formato podem mudar. Nada foi gravado.';
    case 'OPERACAO_STATUS_INVALIDO':
      return 'Este lançamento mudou de situação (já foi confirmado, cancelado, excluído, corrigido ou descartado). Recarregue e confira. Nada foi gravado.';
    case 'OPERACAO_VERSAO_CONFLITO':
      return 'O lançamento foi alterado em outro lugar (outra pessoa ou outra aba). Recarregue o lançamento e refaça a alteração. Nada foi gravado.';
    case 'OPERACAO_DOCUMENTO_DUPLICADO':
      if (reason === 'documento_de_entrada_manual') {
        return `Este documento já está na entrada manual de estoque${details?.entrada_numero ? ` nº ${details.entrada_numero}` : ''}: a mercadoria já entrou por ela. Lance só o pagamento (sem produtos) ou exclua a entrada antes. Nada foi gravado.`;
      }
      return 'Já existe um lançamento confirmado com este número de documento para este parceiro e direção. Confira antes de confirmar de novo. Nada foi gravado.';
    case 'OPERACAO_RATEIO_INVALIDO':
      return mensagemDoRateio(reason, details, c, linha);
    case 'OPERACAO_PARCELAS_INVALIDAS':
      return `${PARCELAS_INVALIDAS[reason ?? ''] ?? 'As parcelas são inválidas.'}${linha} Nada foi gravado.`;
    case 'OPERACAO_REFERENCIA_INVALIDA':
      return `${REFERENCIA_INVALIDA[reason ?? ''] ?? `Referência inválida${field ? ` no campo "${field}"` : ''}.`}${linha} Nada foi gravado.`;
    case 'OPERACAO_VALORES_INVALIDOS': {
      const daLinha = mensagemDaLinhaDoRateio(reason, details, c, linha);
      if (daLinha) return `${daLinha} Nada foi gravado.`;
      return `${VALORES_INVALIDOS[reason ?? ''] ?? 'Valores inválidos no lançamento.'}${linha} Nada foi gravado.`;
    }
    case 'OPERACAO_COM_LIQUIDACOES':
      return 'Este lançamento tem pagamentos/recebimentos registrados. Estorne as baixas antes de cancelar. Nada foi alterado.';
    case 'ESTOQUE_JA_CONSUMIDO': {
      const qtd = details.entrada != null ? ` (entrada ${kg(details.entrada, c)}, disponível ${kg(details.disponivel, c)})` : '';
      return `A mercadoria${linha} já foi usada no estoque${qtd}. O lançamento não pode ser cancelado enquanto ela estiver consumida. Nada foi alterado.`;
    }
    case 'ESTOQUE_SALDO_INSUFICIENTE':
      if (reason === 'estoque_atual_insuficiente') {
        return `Estoque do produto insuficiente${linha}: atual ${kg(details.estoque_atual, c)}, pedido ${kg(details.solicitado, c)}. Nada foi gravado.`;
      }
      return `Saldo insuficiente no local escolhido${linha}${details.disponivel != null ? `: disponível ${kg(details.disponivel, c)}, pedido ${kg(details.solicitado, c)}` : ''}. Nada foi gravado.`;
    case 'TITULO_NAO_LIQUIDAVEL':
      return 'Esta parcela não aceita baixa agora (prevista, quitada ou cancelada). Recarregue o lançamento.';
    case 'LIQUIDACAO_EXCEDE_SALDO':
      return `O valor informado${details.valor != null ? ` (${dinheiro(details.valor, c)})` : ''} é maior que o saldo da parcela${details.saldo != null ? ` (${dinheiro(details.saldo, c)})` : ''}. Nada foi gravado.`;
    case 'LIQUIDACAO_JA_ESTORNADA':
      return 'Esta baixa já foi estornada. Recarregue o lançamento.';
    case 'FINANCEIRO_DATA_FUTURA': {
      const hoje = details.hoje ? ` (hoje na fazenda: ${formatarDia(details.hoje, c.locale)}${details.fuso ? `, fuso ${String(details.fuso)}` : ''})` : '';
      return `A data ${details.data ? `${formatarDia(details.data, c.locale)} ` : ''}é futura para a fazenda${hoje}. Use uma data até hoje. Nada foi gravado.`;
    }
    case 'EMPRESA_FUSO_NAO_CONFIGURADO':
      return 'A empresa não tem fuso horário configurado: o administrador precisa definir o fuso em Administração › Empresa. Nada foi gravado.';
    case 'IDEMPOTENCY_CONFLICT':
      return 'Este envio já foi usado com outro conteúdo. Recarregue e confira o registro antes de repetir. Nada foi gravado.';
    case 'IDEMPOTENCY_IN_PROGRESS':
      return 'O envio anterior ainda está sendo processado. Aguarde alguns segundos e tente de novo: o mesmo envio não será duplicado.';
    case 'CONCURRENCY_CONFLICT':
      return c.comandoIdempotente
        ? 'Outra operação mexia nos mesmos dados ao mesmo tempo. Nada foi gravado. Tente novamente: o mesmo envio não será duplicado.'
        : 'Outra operação mexia nos mesmos dados ao mesmo tempo. Nada foi gravado. Recarregue e tente novamente.';
    case 'REQUEST_VALIDATION_FAILED':
      if (reason && VALIDACAO[reason]) return `${VALIDACAO[reason]}${linha}`;
      return null;
    default:
      return null;
  }
};

/**
 * Mensagem clara por código. Nunca devolve vazio; código desconhecido cai na
 * mensagem pública do `ApiError` (catálogo local) ou no fallback.
 * @param {unknown} erro
 * @param {string} fallback
 * @param {ContextoMoeda} [contexto] moeda/locale para formatar valores de `details`
 */
export const mensagemErroGestao = (erro, fallback, contexto = {}) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  const doLancamento = mensagemLancamento(code, field, reason, { ...details, motivos: motivosDoErro(erro) }, contexto);
  if (doLancamento) return doLancamento;
  switch (code) {
    case 'ACAO_NAO_PERMITIDA':
      return 'Você não tem permissão para esta ação nesta tela. Peça ao administrador para liberar.';
    case 'EMPRESA_NOT_FOUND':
      return 'Empresa não encontrada. Selecione a empresa novamente.';
    case 'PARCEIRO_NOT_FOUND':
      return 'Parceiro não encontrado nesta empresa. A lista será atualizada.';
    case 'PARCEIRO_DOCUMENTO_INVALIDO':
      return `${ROTULO_DOCUMENTO[field ?? ''] ?? 'CPF/CNPJ'} inválido: confira os dígitos. Nada foi gravado.`;
    case 'PARCEIRO_DOCUMENTO_DUPLICADO': {
      const doc = ROTULO_DOCUMENTO[field ?? ''] ?? 'documento';
      const numero = details.numero_cadastro != null ? ` (cadastro nº ${String(details.numero_cadastro)})` : '';
      return `Já existe um parceiro com este ${doc} nesta empresa${numero}. Nada foi gravado.`;
    }
    case 'PARCEIRO_FUNCIONARIO_SEM_PAPEL':
      // D-PROD-208: tipo, cargo e custos do funcionário só com o papel Funcionário.
      return 'Os dados do funcionário (tipo, cargo e custos) só valem com o papel Funcionário marcado. Nada foi gravado.';
    case 'CENTRO_CUSTO_NOT_FOUND':
      return 'Centro de custo não encontrado nesta empresa. A lista será atualizada.';
    case 'CENTRO_RESULTADO_NOT_FOUND':
      return 'Centro de resultado não encontrado nesta empresa. A lista será atualizada.';
    case 'CENTRO_NOME_CONFLITO':
      return 'Já existe um centro com este nome nesta empresa. Nada foi gravado.';
    case 'CENTRO_HIERARQUIA_INVALIDA':
      return HIERARQUIA[reason ?? ''] ?? 'Pai inválido para este centro. Nada foi gravado.';
    case 'CENTRO_COM_FILHOS_ATIVOS':
      return 'Este centro tem centros filhos ativos. Inative os filhos antes. Nada foi gravado.';
    case 'CENTRO_LIMITE_ATIVOS': {
      const limite = details.limite != null ? String(details.limite) : '1000';
      return `Esta empresa já tem ${limite} centros ativos deste tipo. Inative algum antes de criar ou reativar. Nada foi gravado.`;
    }
    case 'CENTRO_INATIVO':
      return 'Há centro inativo na seleção: centro inativo não recebe vínculo novo. Nada foi gravado.';
    case 'NATUREZA_FINANCEIRA_NOT_FOUND':
      return 'Natureza financeira não encontrada nesta empresa. A lista será atualizada.';
    case 'NATUREZA_NOME_CONFLITO':
      return 'Já existe uma natureza com este nome e tipo nesta empresa. Nada foi gravado.';
    case 'NATUREZA_HIERARQUIA_INVALIDA':
      if (reason === 'profundidade_maxima' && details.maximo != null) {
        return `A hierarquia ultrapassaria o número máximo de níveis permitido (${String(details.maximo)}).`;
      }
      return HIERARQUIA_NATUREZA[reason ?? ''] ?? 'Pai inválido para esta natureza. Nada foi gravado.';
    case 'NATUREZA_COM_FILHOS_ATIVOS':
      return 'Esta natureza tem naturezas filhas ativas. Inative as filhas antes. Nada foi gravado.';
    case 'REQUEST_VALIDATION_FAILED':
      return field ? `Dados inválidos no campo "${field}". Revise e tente novamente.` : 'Dados inválidos. Revise o formulário e tente novamente.';
    default:
      return getApiErrorMessage(erro, fallback);
  }
};

/** Códigos que significam "o registro não existe mais": a tela relê a lista. */
export const ehNaoEncontradoGestao = (erro) =>
  [
    'PARCEIRO_NOT_FOUND',
    'CENTRO_CUSTO_NOT_FOUND',
    'CENTRO_RESULTADO_NOT_FOUND',
    'NATUREZA_FINANCEIRA_NOT_FOUND',
    // D-PROD-155
    'OPERACAO_FINANCEIRA_NOT_FOUND',
    'TITULO_FINANCEIRO_NOT_FOUND',
    'LIQUIDACAO_FINANCEIRA_NOT_FOUND',
  ].includes(lerErroGestao(erro).code ?? '');

/**
 * Mensagem de um BLOQUEIO da prévia (`{code, field, reason, details}`), no mesmo
 * vocabulário dos erros.
 * @param {{ code?: string, field?: string, reason?: string, details?: Record<string, any> }} bloqueio
 * @param {ContextoMoeda} [contexto]
 */
export const mensagemDoBloqueio = (bloqueio, contexto = {}) =>
  mensagemErroGestao({ cause: { code: bloqueio?.code, field: bloqueio?.field, reason: bloqueio?.reason, details: bloqueio?.details ?? {} } }, 'Há uma pendência que impede a confirmação.', contexto)
    // A prévia só confere: o rascunho JÁ está salvo e nada é tentado, então o
    // fecho dos erros de comando ("Nada foi gravado.") seria falso aqui.
    .replace(/\s*Nada foi (?:gravado|alterado)\.\s*$/, '');

const RE_NUMERO = /^-?\d+(?:\.\d+)?$/;

/**
 * Texto de um aviso da prévia. Aviso NÃO é bloqueio (o servidor manda os
 * bloqueios à parte): nunca vira "pendência que impede a confirmação". Como nos
 * erros, só o `codigo` (e o valor `residuo_total`) é lido — a `mensagem` do
 * servidor não é exibida.
 * @param {unknown} aviso
 * @param {ContextoMoeda & { direcao?: string, residuoTotal?: string|null, semEstoque?: boolean }} [contexto]
 *   `semEstoque`: nenhum item movimenta estoque (só serviços) — o aviso não fala em lote
 *   `residuoTotal`: soma dos resíduos das linhas da prévia (se o aviso não trouxer o total)
 */
export const mensagemDoAvisoDoPlano = (aviso, contexto = {}) => {
  const codigo = ehObjeto(aviso) && typeof aviso.codigo === 'string' ? aviso.codigo : null;
  if (codigo === 'desconto_acrescimo_rateados') {
    if (contexto.semEstoque) return 'Desconto e acréscimo do cabeçalho foram rateados entre os itens proporcionalmente ao subtotal (valor líquido por item). Nenhum item deste lançamento movimenta o estoque.';
    return contexto.direcao === 'RECEBER'
      ? 'Desconto e acréscimo do cabeçalho foram rateados entre os itens proporcionalmente ao subtotal (receita líquida por item). A saída do estoque continua valorizada pelo custo médio do estoque.'
      : 'Desconto e acréscimo do cabeçalho foram rateados entre os itens proporcionalmente ao subtotal: o custo do lote é o valor líquido da mercadoria.';
  }
  if (codigo === 'residuo_custo_estoque') {
    const doAviso = ehObjeto(aviso) && typeof aviso.residuo_total === 'string' && RE_NUMERO.test(aviso.residuo_total) ? aviso.residuo_total : null;
    const total = doAviso ?? contexto.residuoTotal ?? null;
    return `Diferença de arredondamento do custo${total ? `: ${dinheiroFino(total, contexto, 8)} no total` : ''}. O custo por kg do estoque tem 4 casas; essa diferença fica fora do custo FIFO (não entra no lote) e o título não muda.`;
  }
  return 'Há um aviso do plano para conferir antes de confirmar.';
};
