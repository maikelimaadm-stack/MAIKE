/**
 * Regras PURAS da tela Abastecimentos (Patrimônio P1-02, D-PROD-159; revistas
 * pela D-PROD-162, SIMPLIFICA-01).
 *
 * Sem React, sem rede, sem `@/`: só imports relativos com `.js` — o teste de
 * integração do backend (INT-1) importa este módulo no Node e manda à API REAL
 * os corpos que ele monta. Quantidades viajam como TEXTO canônico ("80.5"):
 * nada de `Number`/`parseFloat` em quantidade, leitura ou custo.
 *
 * D-PROD-162: o abastecimento baixa do estoque EXATAMENTE a quantidade
 * digitada, na unidade de estoque do Produto. Não existe fator kg/L nem tipo
 * de combustível: o Produto vem dos "Produtos aceitos" do tanque (opção do
 * servidor) e a tela só mostra a unidade dele. A capacidade do tanque é em
 * litros e só é conferida para Produto em `L`.
 *
 * D-PROD-163: o Produto pode estar em QUALQUER unidade de estoque (`L`, `KG`
 * ou `SACO`). A quantidade é digitada na unidade EFETIVA do estoque: litros
 * para `L`; quilos para `KG` e para `SACO` (o SACO guarda o estoque em kg). O
 * abastecimento gravado continua com `unidade` `L` ou `KG` (SACO grava `KG`).
 *
 * O formulário guarda o texto DIGITADO no formato do Brasil ("80,5"); os
 * `montarCorpo*` convertem para o canônico com `lerNumeroLocal` (nunca
 * arredondam: casa a mais é recusada).
 */
import { comparar, ehCanonico, ehPositivo, formatarMoeda, formatarNumero, lerNumeroLocal, somar } from './dinheiroDecimal.js';
import { ehDiaValido, formatarDia } from './diaCivil.js';

export const LOCALE_ABASTECIMENTO = 'pt-BR';

export const LIMITES_ABASTECIMENTO = Object.freeze({
  QUANTIDADE: Object.freeze({ inteiros: 10, casas: 4 }),
  LEITURA: Object.freeze({ inteiros: 10, casas: 4 }),
});

/** Teto do motor de estoque (quantidade e valor). */
export const LIMITE_ESTOQUE = '9999999999.9999';

export const PADRAO_OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
export const MEDIDORES_CONTADOR = Object.freeze(['HORIMETRO', 'ODOMETRO', 'CICLOS']);
export const STATUS_ABASTECIMENTO = Object.freeze(['CONFIRMADO', 'CANCELADO']);

/**
 * Unidade GRAVADA no abastecimento (`AbastecimentoBem.unidade`, a unidade
 * efetiva do estoque; `UNIDADES_ABASTECIMENTO` no servidor): `L` ou `KG`.
 */
export const UNIDADES_ABASTECIMENTO = Object.freeze(['L', 'KG']);
/**
 * Unidades de estoque do PRODUTO que o abastecimento aceita (D-PROD-163):
 * litros, quilos e sacos.
 */
export const UNIDADES_PRODUTO_ABASTECIMENTO = Object.freeze(['L', 'KG', 'SACO']);
/** Rótulo curto da unidade (`L` / `kg`), o mesmo do servidor (`rotuloDaUnidade`). */
export const ROTULO_UNIDADE_ABASTECIMENTO = Object.freeze(/** @type {Record<string, string>} */ ({ L: 'L', KG: 'kg' }));

/**
 * Dica fixa do Produto controlado em quilos (achado D8 da D-PROD-162): o
 * frentista lê litros na bomba, mas a baixa é em kg. Aparece sob o campo
 * Quantidade e de novo na Revisão.
 */
export const DICA_PRODUTO_EM_KG = 'Este Produto é controlado em quilos: digite kg, não os litros da bomba.';
/** D-PROD-163: o Produto em sacos guarda o estoque em quilos — digita-se kg, não sacos. */
export const DICA_PRODUTO_EM_SACO = 'Este Produto é em sacos, com estoque em quilos: digite kg (não sacos nem os litros da bomba).';

/** @param {unknown} u @returns {u is 'L'|'KG'} */
export const ehUnidadeDeAbastecimento = (u) => typeof u === 'string' && UNIDADES_ABASTECIMENTO.includes(u);
/**
 * Unidade em que a quantidade é digitada e baixada (a unidade EFETIVA do
 * estoque): `L` → `L`; `KG` e `SACO` → `KG`; outra → null.
 * @param {unknown} u @returns {'L'|'KG'|null}
 */
export const unidadeDoAbastecimentoDoProduto = (u) => (u === 'L' ? 'L' : u === 'KG' || u === 'SACO' ? 'KG' : null);
/** "L" / "kg" (SACO → "kg"; '' quando a unidade não é de abastecimento). @param {unknown} u */
export const rotuloDaUnidade = (u) => {
  const efetiva = unidadeDoAbastecimentoDoProduto(u);
  return efetiva ? ROTULO_UNIDADE_ABASTECIMENTO[efetiva] : '';
};
/**
 * Dica sob a quantidade (e na Revisão) pela unidade de estoque do PRODUTO:
 * KG → kg, não litros; SACO → kg, não sacos; L (ou desconhecida) → nenhuma.
 * @param {unknown} u @returns {string|null}
 */
export const dicaDaUnidadeDoProduto = (u) => (u === 'KG' ? DICA_PRODUTO_EM_KG : u === 'SACO' ? DICA_PRODUTO_EM_SACO : null);

/** @param {unknown} tipo */
export const medidorExigeLeitura = (tipo) => typeof tipo === 'string' && MEDIDORES_CONTADOR.includes(tipo);

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
/** @param {unknown} v */
const textoOuNulo = (v) => (texto(v) ? texto(v) : null);
/** @param {unknown} v */
const idDe = (v) => (v && typeof v === 'object' && typeof (/** @type {any} */ (v).id) === 'string' ? /** @type {any} */ (v).id : typeof v === 'string' && v ? v : null);

/**
 * Lê o texto digitado (pt-BR) como canônico, ou null quando vazio/ inválido.
 * @param {unknown} digitado @param {{ inteiros: number, casas: number }} limites
 */
export const canonicoDoDigitado = (digitado, limites) => {
  const r = lerNumeroLocal(digitado, LOCALE_ABASTECIMENTO, limites);
  return r.ok ? /** @type {string} */ (r.valor) : null;
};

/** Bloqueios de quantidade em que o número do plano não é uma baixa: zero ou acima do teto das colunas do estoque. */
const MOTIVOS_SEM_BAIXA = new Set(['quantidade_nao_positiva', 'valor_excede_limite_estoque']);

/**
 * Quantidade que a revisão mostra como baixa do estoque: a do plano (na
 * unidade do Produto), ou null quando o servidor bloqueou a quantidade ou o
 * Produto não está em L, KG nem SACO (aí "baixa de 0 L" ao lado do bloqueio
 * só confunde: nada seria baixado). A unidade é `plano.unidade`.
 * @param {{ plano?: any, bloqueios?: any[] } | null | undefined} previa
 * @returns {string|null}
 */
export const quantidadeDaBaixaNaPrevia = (previa) => {
  const quantidade = previa?.plano?.quantidade;
  if (!ehCanonico(quantidade) || !ehPositivo(quantidade) || !unidadeDoAbastecimentoDoProduto(previa?.plano?.unidade)) return null;
  const bloqueios = Array.isArray(previa?.bloqueios) ? previa.bloqueios : [];
  const semBaixa = bloqueios.some((/** @type {any} */ b) => b?.code === 'OPERACAO_VALORES_INVALIDOS' && MOTIVOS_SEM_BAIXA.has(String(b?.reason ?? '')));
  return semBaixa ? null : /** @type {string} */ (quantidade);
};

/**
 * Formulário em branco. `bem` e `produto` são as OPÇÕES escolhidas (objetos do
 * servidor); os demais, ids ou texto digitado. `quantidade` é o texto digitado
 * na unidade do Produto.
 * @param {string} hoje AAAA-MM-DD no fuso da fazenda
 */
export const formularioVazio = (hoje) => ({
  bem: null,
  tanque_id: null,
  produto: null,
  local_estoque_id: null,
  data_operacional: hoje,
  quantidade: '',
  medidor_leitura: '',
  tanque_cheio: false,
  observacao: '',
  referencia_externa: '',
});

// ─── Opção de PRODUTO do bem → formulário (A16) ──────────────────────────

/**
 * Aplica ao formulário a opção de PRODUTO escolhida (`produtos-do-bem`, A16):
 * os tanques que aceitam o Produto vêm da opção do SERVIDOR (os "Produtos
 * aceitos" de cada tanque), nunca de mapa na tela nem do nome.
 * Tanque: o único, ou o já escolhido se o Produto é o mesmo e o tanque segue
 * aceito; senão a tela pergunta. Local: só sobrevive se o Produto não mudou.
 * @param {any} form @param {any} item
 */
export const opcaoNoFormulario = (form, item) => ({
  ...form,
  produto: { ...item.produto, tanques: item.tanques, pronto: item.pronto === true },
  tanque_id:
    item.tanques.length === 1
      ? String(item.tanques[0].id)
      : item.tanques.some((/** @type {any} */ t) => String(t.id) === String(form.tanque_id)) && String(form.produto?.id) === String(item.produto.id)
        ? form.tanque_id
        : null,
  local_estoque_id: String(form.produto?.id) === String(item.produto.id) ? form.local_estoque_id : null,
});

/**
 * O Produto que a tela escolhe SOZINHA: só quando a resposta é do bem atual,
 * COMPLETA (`has_more === false`) e com exatamente UMA opção. Página parcial,
 * resposta atrasada de outro bem ou várias opções → null (o operador escolhe).
 * @param {any} resposta @param {string|null} bemId
 */
export const produtoAutomatico = (resposta, bemId) => {
  if (!resposta || typeof resposta !== 'object' || !bemId) return null;
  if (String(resposta.bem?.id ?? '') !== String(bemId)) return null;
  if (resposta.has_more !== false) return null;
  const itens = Array.isArray(resposta.itens) ? resposta.itens : [];
  return itens.length === 1 ? itens[0] : null;
};

/**
 * A escolha do formulário ainda está entre as opções do servidor? `ausente` só
 * com resposta COMPLETA do mesmo bem sem o Produto do formulário; página
 * parcial ou resposta de outro bem → `indeterminado` (nada a concluir).
 * @param {any} resposta @param {any} form
 * @returns {'presente'|'ausente'|'indeterminado'}
 */
export const situacaoDaEscolha = (resposta, form) => {
  const produtoId = idDe(form?.produto);
  const bemId = idDe(form?.bem);
  if (!produtoId || !bemId || !resposta || typeof resposta !== 'object') return 'indeterminado';
  if (String(resposta.bem?.id ?? '') !== bemId) return 'indeterminado';
  const itens = Array.isArray(resposta.itens) ? resposta.itens : [];
  if (itens.some((/** @type {any} */ i) => String(i?.produto?.id ?? '') === produtoId)) return 'presente';
  return resposta.has_more === false ? 'ausente' : 'indeterminado';
};

/** O tanque escolhido entre os que aceitam o Produto do formulário (ou null). @param {any} form */
export const tanqueDoFormulario = (form) => {
  const tanques = Array.isArray(form?.produto?.tanques) ? form.produto.tanques : [];
  const id = idDe(form?.tanque_id);
  return id ? (tanques.find((/** @type {any} */ t) => String(t?.id) === id) ?? null) : null;
};

/**
 * Unidade em que a quantidade do formulário é digitada (`L`/`KG`, a unidade
 * EFETIVA do estoque do Produto: SACO → `KG`), ou null.
 * @param {any} form @returns {'L'|'KG'|null}
 */
export const unidadeDoFormulario = (form) => unidadeDoAbastecimentoDoProduto(form?.produto?.unidade_principal_estoque);

/** Tipo do medidor do bem escolhido (opção `bens`: `medidor.tipo`). @param {any} form */
export const medidorDoFormulario = (form) => {
  const tipo = form?.bem?.medidor?.tipo;
  return typeof tipo === 'string' ? tipo : 'SEM_MEDIDOR';
};

/** @param {string} motivo */
const mensagemDoNumero = (motivo) =>
  motivo === 'casas' ? 'No máximo 4 casas decimais.' : motivo === 'limite' ? 'Número grande demais.' : 'Número inválido (use vírgula para decimais, ex.: 80,5).';

/**
 * Validação LOCAL (o servidor confere tudo de novo, sob trava). Mensagens em
 * pt-BR. A capacidade (em litros) só é conferida quando a unidade é `L`; a
 * unidade vem de `ctx.unidade` ou do Produto do formulário (SACO conta como kg).
 * @param {any} form
 * @param {{ hoje?: string|null, capacidadeLitros?: string|null, unidade?: string|null }} [ctx]
 * @returns {{ erros: Record<string, string> }}
 */
export const validarFormulario = (form, ctx = {}) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!idDe(form?.bem)) erros.bem = 'Escolha a máquina ou veículo.';
  if (!idDe(form?.produto)) erros.produto = 'Escolha o Produto.';
  else {
    // Tanque e local dependem do Produto: só cobrados (e só visíveis) depois dele.
    if (!idDe(form?.tanque_id)) erros.tanque_id = 'Escolha qual tanque será abastecido.';
    if (!idDe(form?.local_estoque_id)) erros.local_estoque_id = 'Escolha de qual local do estoque sai o Produto.';
  }
  const dia = texto(form?.data_operacional);
  if (!ehDiaValido(dia)) erros.data_operacional = 'Informe a data do abastecimento.';
  else if (ctx.hoje && ehDiaValido(ctx.hoje) && dia > ctx.hoje) erros.data_operacional = 'A data não pode ser posterior a hoje na fazenda.';
  const unidade = ctx.unidade === undefined ? unidadeDoFormulario(form) : unidadeDoAbastecimentoDoProduto(ctx.unidade);
  const quantidade = lerNumeroLocal(form?.quantidade, LOCALE_ABASTECIMENTO, LIMITES_ABASTECIMENTO.QUANTIDADE);
  if (!quantidade.ok) erros.quantidade = quantidade.motivo === 'vazio' ? 'Informe a quantidade abastecida.' : mensagemDoNumero(String(quantidade.motivo));
  else if (!ehPositivo(/** @type {string} */ (quantidade.valor))) erros.quantidade = 'Informe uma quantidade maior que zero.';
  else if (unidade === 'L' && ehCanonico(ctx.capacidadeLitros) && comparar(/** @type {string} */ (quantidade.valor), /** @type {string} */ (ctx.capacidadeLitros)) > 0) {
    erros.quantidade = 'Os litros passam da capacidade nominal do tanque.';
  }
  if (medidorExigeLeitura(medidorDoFormulario(form))) {
    const leitura = lerNumeroLocal(form?.medidor_leitura, LOCALE_ABASTECIMENTO, LIMITES_ABASTECIMENTO.LEITURA);
    if (!leitura.ok) erros.medidor_leitura = leitura.motivo === 'vazio' ? 'Informe a leitura do medidor.' : mensagemDoNumero(String(leitura.motivo));
  }
  if (texto(form?.observacao).length > 500) erros.observacao = 'No máximo 500 caracteres.';
  if (texto(form?.referencia_externa).length > 64) erros.referencia_externa = 'No máximo 64 caracteres.';
  return { erros };
};

/**
 * Corpo da PRÉVIA (A3): decimais canônicos, leitura null quando o bem não tem
 * contador, textos aparados ou null. Recusa (lança) o que não converte —
 * `validarFormulario` vem antes. D-PROD-162: `quantidade` na unidade do
 * Produto; sem `tipo_combustivel_id` (o servidor responderia 400).
 * @param {string} empresaId @param {any} form
 */
export const montarCorpoPrevia = (empresaId, form) => {
  const quantidade = canonicoDoDigitado(form?.quantidade, LIMITES_ABASTECIMENTO.QUANTIDADE);
  if (!quantidade) throw new RangeError('quantidade_invalida');
  const contador = medidorExigeLeitura(medidorDoFormulario(form));
  const leitura = contador ? canonicoDoDigitado(form?.medidor_leitura, LIMITES_ABASTECIMENTO.LEITURA) : null;
  return {
    empresa_id: empresaId,
    bem_id: idDe(form?.bem),
    tanque_id: idDe(form?.tanque_id),
    produto_id: idDe(form?.produto),
    local_estoque_id: idDe(form?.local_estoque_id),
    data_operacional: texto(form?.data_operacional),
    quantidade,
    medidor_leitura: leitura,
    tanque_cheio: form?.tanque_cheio === true,
    observacao: textoOuNulo(form?.observacao),
    referencia_externa: textoOuNulo(form?.referencia_externa),
  };
};

/**
 * Corpo da CONFIRMAÇÃO (A4) SEM `operation_id` (o serviço põe a chave
 * persistente): EXATAMENTE o da prévia. D-PROD-162: sem fator, o plano não
 * acrescenta nada ao corpo (o servidor relê tudo sob as travas); ele só tem
 * de existir — sem revisão não há confirmação.
 * @param {string} empresaId @param {any} form @param {any} plano
 */
export const montarCorpoConfirmacao = (empresaId, form, plano) => {
  if (!plano || typeof plano !== 'object') throw new RangeError('plano_ausente');
  return montarCorpoPrevia(empresaId, form);
};

/**
 * Corpo do CANCELAMENTO (A5) SEM `operation_id`.
 * @param {string} empresaId @param {any} registro @param {string} motivo
 */
export const montarCorpoCancelamento = (empresaId, registro, motivo) => ({ empresa_id: empresaId, versao: registro?.versao, motivo: texto(motivo) });

/**
 * Assinatura estável do que a prévia viu: se mudar depois da prévia, a prévia
 * deixa de valer (o botão Confirmar some até uma prévia nova).
 * @param {any} form
 */
export const assinaturaDoFormulario = (form) =>
  JSON.stringify([
    idDe(form?.bem),
    idDe(form?.tanque_id),
    idDe(form?.produto),
    idDe(form?.local_estoque_id),
    texto(form?.data_operacional),
    canonicoDoDigitado(form?.quantidade, LIMITES_ABASTECIMENTO.QUANTIDADE) ?? texto(form?.quantidade),
    canonicoDoDigitado(form?.medidor_leitura, LIMITES_ABASTECIMENTO.LEITURA) ?? texto(form?.medidor_leitura),
    form?.tanque_cheio === true,
    texto(form?.observacao),
    texto(form?.referencia_externa),
  ]);

// ─── Exibição (texto canônico → pt-BR, sem float) ───────────────────────

/** "80.0000" → "80,0000" (4 casas fixas). @param {unknown} v */
export const formatarLitros = (v) => formatarNumero(v, { locale: LOCALE_ABASTECIMENTO, casasMin: 4, casasMax: 4 });
/** Litros sem zeros à direita ("180.0000" → "180"; "80.5000" → "80,5"). @param {unknown} v */
export const formatarLitrosCurto = (v) => formatarNumero(v, { locale: LOCALE_ABASTECIMENTO, casasMin: 0, casasMax: 4 });
/**
 * Quantidade na unidade do Produto, 4 casas fixas: ("120.0000", "L") →
 * "120,0000 L"; ("80.0000", "KG") → "80,0000 kg" (SACO também em kg). Sem
 * unidade conhecida, só o número.
 * @param {unknown} v @param {unknown} unidade
 */
export const formatarQuantidade = (v, unidade) => {
  const numero = formatarNumero(v, { locale: LOCALE_ABASTECIMENTO, casasMin: 4, casasMax: 4 });
  const rotulo = rotuloDaUnidade(unidade);
  return rotulo ? `${numero} ${rotulo}` : numero;
};
/** Como `formatarQuantidade`, sem zeros à direita ("80.0000", "L" → "80 L"). @param {unknown} v @param {unknown} unidade */
export const formatarQuantidadeCurta = (v, unidade) => {
  const numero = formatarNumero(v, { locale: LOCALE_ABASTECIMENTO, casasMin: 0, casasMax: 4 });
  const rotulo = rotuloDaUnidade(unidade);
  return rotulo ? `${numero} ${rotulo}` : numero;
};
/** Leitura do medidor ("1550.5000" → "1.550,5"). @param {unknown} v */
export const formatarLeitura = (v) => formatarNumero(v, { locale: LOCALE_ABASTECIMENTO, casasMin: 0, casasMax: 4 });
/** Custo em reais (até 4 casas: "5.2768" → "R$ 5,2768"; "354.6000" → "R$ 354,60"). @param {unknown} v */
export const formatarCusto = (v) => formatarMoeda(v, { locale: LOCALE_ABASTECIMENTO, moeda: 'BRL', casas: 2, casasMax: 4 });
/** @param {unknown} v */
export const formatarDiaAbastecimento = (v) => formatarDia(v, LOCALE_ABASTECIMENTO);

/** Unidade legível do medidor. */
export const UNIDADE_MEDIDOR = Object.freeze(/** @type {Record<string, string>} */ ({ HORIMETRO: 'h', ODOMETRO: 'km', CICLOS: 'ciclos' }));
/** Rótulo do campo de leitura conforme o medidor. */
export const ROTULO_LEITURA = Object.freeze(/** @type {Record<string, string>} */ ({ HORIMETRO: 'Horímetro (h)', ODOMETRO: 'Odômetro (km)', CICLOS: 'Ciclos' }));

/** "TP-02 — Trator TP-02" (ou só o nome). @param {any} bem */
export const rotuloDoBem = (bem) => {
  if (!bem || typeof bem !== 'object') return '';
  const codigo = texto(bem.codigo_frota);
  const nome = texto(bem.nome);
  return codigo && nome ? `${codigo} — ${nome}` : codigo || nome || (bem.numero != null ? `Bem nº ${bem.numero}` : '');
};

/**
 * Totais EXATOS (BigInt) dos abastecimentos CONFIRMADOS de uma lista, POR
 * UNIDADE (litros e quilos nunca se somam): "0.1" + "0.2" = "0.3", nunca
 * 0,30000000000000004. `totais` só traz as unidades presentes, L antes de KG.
 * @param {any[]} itens
 * @returns {{ quantidade: number, totais: Array<{ unidade: 'L'|'KG', total: string }> }}
 */
export const totaisConfirmados = (itens) => {
  const confirmados = (Array.isArray(itens) ? itens : []).filter((i) => i?.status === 'CONFIRMADO');
  /** @type {Array<{ unidade: 'L'|'KG', total: string }>} */
  const totais = [];
  for (const unidade of /** @type {Array<'L'|'KG'>} */ (UNIDADES_ABASTECIMENTO)) {
    const valores = confirmados.filter((i) => i?.unidade === unidade).map((i) => i.quantidade).filter(ehCanonico);
    if (valores.length) totais.push({ unidade, total: somar(valores, 4) });
  }
  return { quantidade: confirmados.length, totais };
};

// ─── Conferência das respostas (§6.1) ───────────────────────────────────

const RE_4 = /^\d+\.\d{4}$/;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {string[]} violacoes @param {string} onde
 * @param {Record<string, any>} obj @param {string[]} chaves
 */
const exigirChaves = (violacoes, onde, obj, chaves) => {
  for (const k of chaves) if (!Object.prototype.hasOwnProperty.call(obj, k)) violacoes.push(`${onde}.${k}: ausente`);
};
/** @param {string[]} v @param {string} onde @param {unknown} valor @param {RegExp} re @param {boolean} [nulo] */
const exigirFormato = (v, onde, valor, re, nulo = false) => {
  if (nulo && valor === null) return;
  if (typeof valor !== 'string' || !re.test(valor)) v.push(`${onde}: formato inválido (${JSON.stringify(valor)})`);
};
/** @param {string[]} v @param {string} onde @param {unknown} valor @param {boolean} [nulo] */
const exigirUnidade = (v, onde, valor, nulo = false) => {
  if (nulo && valor === null) return;
  if (!ehUnidadeDeAbastecimento(valor)) v.push(`${onde}: unidade inválida (${JSON.stringify(valor)})`);
};
/** Campos que saíram com a D-PROD-162 (fator, tipo de combustível, litros e KG separados). */
const CHAVES_REMOVIDAS = ['tipo_combustivel', 'conversao', 'quantidade_litros', 'quantidade_kg', 'kg_por_litro', 'custo_unitario_kg'];
/** @param {string[]} v @param {string} onde @param {Record<string, any>} obj */
const recusarRemovidas = (v, onde, obj) => {
  for (const k of CHAVES_REMOVIDAS) if (Object.prototype.hasOwnProperty.call(obj, k)) v.push(`${onde}.${k}: campo removido pela D-PROD-162`);
};

const CHAVES_DETALHE = [
  'id', 'empresa_id', 'numero', 'status', 'versao', 'data_operacional', 'bem', 'tanque', 'produto', 'local_estoque', 'quantidade', 'unidade',
  'custo_total', 'custo_unitario', 'tanque_cheio', 'medidor', 'observacao', 'referencia_externa', 'movimentacao', 'estorno', 'fatias', 'cancelamento',
  'criado_por', 'consumo', 'efeito_cancelamento_medidor', 'created_date', 'updated_date',
];
const CHAVES_RESUMO = [
  'id', 'numero', 'status', 'versao', 'data_operacional', 'bem', 'tanque', 'produto', 'local_estoque', 'quantidade', 'unidade', 'custo_total',
  'tanque_cheio', 'medidor', 'referencia_externa', 'created_date', 'updated_date',
];
const CHAVES_PLANO = [
  'empresa_id', 'data_operacional', 'hoje', 'bem', 'tanque', 'produto', 'local_estoque', 'quantidade', 'unidade', 'confere_capacidade', 'estoque', 'fifo',
  'medidor', 'tanque_cheio', 'custo_e_estimativa',
];

/** @param {string[]} v @param {string} onde @param {any} m */
const conferirMovimento = (v, onde, m) => {
  if (m === null) return;
  if (!ehObjeto(m)) {
    v.push(`${onde}: não é objeto`);
    return;
  }
  exigirChaves(v, onde, m, ['id', 'numero', 'status', 'tipo_movimentacao', 'tipo_detalhado', 'quantidade', 'unidade', 'valor_unitario', 'valor_total']);
  exigirFormato(v, `${onde}.quantidade`, m.quantidade, RE_4);
  exigirFormato(v, `${onde}.valor_unitario`, m.valor_unitario, RE_4);
  exigirFormato(v, `${onde}.valor_total`, m.valor_total, RE_4);
  if (m.unidade !== null && typeof m.unidade !== 'string') v.push(`${onde}.unidade: não é texto`);
};

/** @param {string[]} v @param {string} onde @param {any} medidor */
const conferirMedidor = (v, onde, medidor) => {
  if (!ehObjeto(medidor)) {
    v.push(`${onde}: não é objeto`);
    return;
  }
  exigirFormato(v, `${onde}.leitura`, medidor.leitura, RE_4, true);
  if (medidor.tipo === 'SEM_MEDIDOR' && medidor.leitura !== null) v.push(`${onde}.leitura: SEM_MEDIDOR com leitura`);
};

/** @param {string[]} v @param {string} onde @param {any} fatias */
const conferirFatias = (v, onde, fatias) => {
  if (!Array.isArray(fatias)) {
    v.push(`${onde}: não é lista`);
    return;
  }
  fatias.forEach((f, i) => {
    const o = `${onde}[${i}]`;
    if (!ehObjeto(f)) {
      v.push(`${o}: não é objeto`);
      return;
    }
    if (!Number.isInteger(f.ordem)) v.push(`${o}.ordem: não é inteiro`);
    exigirFormato(v, `${o}.data_lote`, f.data_lote, RE_DIA, true);
    exigirFormato(v, `${o}.quantidade`, f.quantidade, RE_4);
    exigirFormato(v, `${o}.custo_unitario`, f.custo_unitario, RE_4);
    exigirFormato(v, `${o}.valor`, f.valor, RE_4);
  });
};

/** @param {string[]} v @param {string} onde @param {any} c */
const conferirConsumoDoAbastecimento = (v, onde, c) => {
  if (!ehObjeto(c)) {
    v.push(`${onde}: não é objeto`);
    return;
  }
  exigirChaves(v, onde, c, ['situacao', 'motivo', 'metrica', 'unidade_metrica', 'intervalo', 'quantidade', 'unidade', 'valor']);
  if (!['CALCULADO', 'DADOS_INSUFICIENTES', 'NAO_APLICAVEL'].includes(c.situacao)) v.push(`${onde}.situacao: inválida`);
  exigirFormato(v, `${onde}.valor`, c.valor, RE_4, true);
  exigirFormato(v, `${onde}.quantidade`, c.quantidade, RE_4, true);
  exigirFormato(v, `${onde}.intervalo`, c.intervalo, RE_4, true);
  exigirUnidade(v, `${onde}.unidade`, c.unidade, true);
  if (Object.prototype.hasOwnProperty.call(c, 'litros')) v.push(`${onde}.litros: campo removido pela D-PROD-162`);
};

/** @param {string[]} v @param {string} onde @param {any} d @param {boolean} detalhe */
const conferirAbastecimento = (v, onde, d, detalhe) => {
  exigirChaves(v, onde, d, detalhe ? CHAVES_DETALHE : CHAVES_RESUMO);
  recusarRemovidas(v, onde, d);
  if (!STATUS_ABASTECIMENTO.includes(d.status)) v.push(`${onde}.status: inválido (${JSON.stringify(d.status)})`);
  if (!Number.isInteger(d.versao) || d.versao < 1) v.push(`${onde}.versao: inválida`);
  exigirFormato(v, `${onde}.data_operacional`, d.data_operacional, RE_DIA);
  exigirFormato(v, `${onde}.quantidade`, d.quantidade, RE_4);
  exigirUnidade(v, `${onde}.unidade`, d.unidade);
  exigirFormato(v, `${onde}.custo_total`, d.custo_total, RE_4);
  if (typeof d.tanque_cheio !== 'boolean') v.push(`${onde}.tanque_cheio: não é booleano`);
  conferirMedidor(v, `${onde}.medidor`, d.medidor);
  if (!detalhe) return;
  exigirFormato(v, `${onde}.custo_unitario`, d.custo_unitario, RE_4);
  if (ehObjeto(d.tanque)) exigirFormato(v, `${onde}.tanque.capacidade_litros`, d.tanque.capacidade_litros, RE_4, true);
  conferirMovimento(v, `${onde}.movimentacao`, d.movimentacao);
  if (d.movimentacao === null) v.push(`${onde}.movimentacao: ausente`);
  conferirMovimento(v, `${onde}.estorno`, d.estorno);
  if (d.status === 'CANCELADO' && (d.estorno === null || d.cancelamento === null)) v.push(`${onde}: CANCELADO sem estorno/cancelamento`);
  if (d.status === 'CONFIRMADO' && (d.estorno !== null || d.cancelamento !== null)) v.push(`${onde}: CONFIRMADO com estorno/cancelamento`);
  conferirFatias(v, `${onde}.fatias`, d.fatias);
  conferirConsumoDoAbastecimento(v, `${onde}.consumo`, d.consumo);
};

/** @param {string[]} v @param {any} r */
const conferirPrevia = (v, r) => {
  if (!Array.isArray(r.bloqueios)) v.push('bloqueios: não é lista');
  else {
    r.bloqueios.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
      if (!ehObjeto(b) || typeof b.code !== 'string') v.push(`bloqueios[${i}].code: ausente`);
    });
  }
  const p = r.plano;
  if (!ehObjeto(p)) {
    v.push('plano: não é objeto');
    return;
  }
  exigirChaves(v, 'plano', p, CHAVES_PLANO);
  recusarRemovidas(v, 'plano', p);
  exigirFormato(v, 'plano.data_operacional', p.data_operacional, RE_DIA);
  exigirFormato(v, 'plano.hoje', p.hoje, RE_DIA);
  exigirFormato(v, 'plano.quantidade', p.quantidade, RE_4);
  exigirUnidade(v, 'plano.unidade', p.unidade, true);
  if (typeof p.confere_capacidade !== 'boolean') v.push('plano.confere_capacidade: não é booleano');
  else if (p.confere_capacidade !== (p.unidade === 'L')) v.push('plano.confere_capacidade: só vale para Produto em L');
  if (ehObjeto(p.tanque)) exigirFormato(v, 'plano.tanque.capacidade_litros', p.tanque.capacidade_litros, RE_4, true);
  if (ehObjeto(p.estoque)) {
    exigirFormato(v, 'plano.estoque.saldo_local', p.estoque.saldo_local, RE_4);
    exigirFormato(v, 'plano.estoque.estoque_atual', p.estoque.estoque_atual, RE_4);
    exigirUnidade(v, 'plano.estoque.unidade', p.estoque.unidade);
  }
  if (ehObjeto(p.fifo)) {
    exigirFormato(v, 'plano.fifo.disponivel', p.fifo.disponivel, RE_4);
    exigirFormato(v, 'plano.fifo.custo_total_estimado', p.fifo.custo_total_estimado, RE_4, true);
    exigirFormato(v, 'plano.fifo.custo_unitario_estimado', p.fifo.custo_unitario_estimado, RE_4, true);
    conferirFatias(v, 'plano.fifo.fatias', p.fifo.fatias);
  }
  if (ehObjeto(p.medidor)) exigirFormato(v, 'plano.medidor.leitura', p.medidor.leitura, RE_4, true);
};

/** @param {string[]} v @param {any} r */
const conferirConsumo = (v, r) => {
  exigirChaves(v, 'consumo', r, ['bem', 'situacao_geral', 'metodologia', 'intervalos']);
  if (!['DISPONIVEL', 'NAO_APLICAVEL'].includes(r.situacao_geral)) v.push('consumo.situacao_geral: inválida');
  (Array.isArray(r.intervalos) ? r.intervalos : []).forEach((/** @type {any} */ it, /** @type {number} */ i) => {
    const o = `consumo.intervalos[${i}]`;
    if (!['CALCULADO', 'DADOS_INSUFICIENTES'].includes(it?.situacao)) v.push(`${o}.situacao: inválida`);
    exigirFormato(v, `${o}.valor`, it?.valor, RE_4, true);
    exigirFormato(v, `${o}.quantidade`, it?.quantidade, RE_4, true);
    exigirFormato(v, `${o}.intervalo`, it?.intervalo, RE_4, true);
    exigirUnidade(v, `${o}.unidade`, it?.unidade ?? null, true);
    if (ehObjeto(it) && !Object.prototype.hasOwnProperty.call(it, 'unidade_metrica')) v.push(`${o}.unidade_metrica: ausente`);
    if (ehObjeto(it) && Object.prototype.hasOwnProperty.call(it, 'litros')) v.push(`${o}.litros: campo removido pela D-PROD-162`);
  });
};

/**
 * Violações do contrato §6.1 (revisto pela D-PROD-162) numa resposta do
 * servidor (lista vazia = conforme). Reconhece pela forma: prévia (`plano`),
 * página (`items`), consumo (`intervalos`) ou detalhe.
 * @param {unknown} body
 * @returns {string[]}
 */
export const conferirRespostaAbastecimento = (body) => {
  /** @type {string[]} */
  const v = [];
  if (!ehObjeto(body)) return ['resposta: não é objeto'];
  if (Object.prototype.hasOwnProperty.call(body, 'plano')) conferirPrevia(v, body);
  else if (Array.isArray(body.items)) {
    body.items.forEach((/** @type {any} */ item, /** @type {number} */ i) => {
      if (!ehObjeto(item)) v.push(`items[${i}]: não é objeto`);
      else conferirAbastecimento(v, `items[${i}]`, item, false);
    });
  } else if (Array.isArray(body.intervalos)) conferirConsumo(v, body);
  else conferirAbastecimento(v, 'abastecimento', body, true);
  return v;
};
