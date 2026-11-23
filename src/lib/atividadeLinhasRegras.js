/**
 * Regras puras das LINHAS do apontamento — produto e máquina (D-PROD-202,
 * Fatia 3), mão de obra e serviço (Fatia 4) — e do totalizador da atividade.
 * Contratos: docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md (§2 a §5) e
 * docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md (§3 a §7).
 *
 * Quem decide é o servidor; aqui ficam o estado das janelas, a validação
 * local, o corpo do envio, o PATCH mínimo, a dose/ha e o uso calculados para
 * LEITURA, o "Repetir" com as linhas e as mensagens das recusas.
 *
 *  - Decimais em TEXTO canônico (4 casas no máximo, Decimal(14, 4)).
 *  - Produto: a quantidade é na unidade do ESTOQUE do produto (L; kg para KG
 *    e SACO), nunca digitada nem convertida; custo (FIFO) e dose/ha são do
 *    servidor — a dose mostrada aqui é só prévia (quantidade / área do dia).
 *  - Máquina: tipo e unidade do medidor vêm do BEM (nunca perguntados); a
 *    leitura inicial é sugerida pela leitura vigente; o uso é final − inicial
 *    ou, "sem medidor", o que a pessoa informa. O teto do salto é do tipo
 *    patrimonial: passou, a justificativa é pedida (não bloqueia).
 *  - Mão de obra: funcionário, medida (HORA | DIARIA | TAREFA, sugerida pelo
 *    tipo do funcionário) e quantidade. Hora e diária: o custo unitário é o do
 *    cadastro (snapshot no servidor, só mostrado aqui); tarefa: digitado.
 *  - Serviço: serviço, parceiro prestador (opcional), quantidade na unidade do
 *    serviço, valor unitário (preenchido com o de referência) e documento.
 *  - O total mostrado (quantidade × unitário, 4 casas HALF_UP) é só prévia.
 */

import {
  comparar,
  deUnidades,
  ehCanonico,
  ehPositivo,
  formatarMoeda,
  formatarNumero,
  lerNumeroLocal,
  multiplicarArredondar,
  paraTextoDeEdicao,
  paraUnidades,
  percentualDe,
  somar,
  subtrair,
} from './dinheiroDecimal.js';
import {
  MEDIDORES_CONTADOR,
  ROTULO_LEITURA,
  UNIDADE_MEDIDOR,
  formatarCusto,
  formatarDiaAbastecimento,
  rotuloDaUnidade,
  rotuloDoBem,
  unidadeDoAbastecimentoDoProduto,
} from './abastecimentoRegras.js';
import { lerErroGestao } from './gestaoErros.js';
import {
  LIMITES_DECIMAL_ATIVIDADE,
  LOCALE_ATIVIDADE,
  STATUS_CANCELADO,
  STATUS_CONFIRMADO,
  formatarDiaAtividade,
  mensagemDeErroAtividade,
  rotuloDoTurno,
} from './lancamentoAtividadesRegras.js';
import { RAIZ_CONSULTAS_ATIVIDADES, rotuloDaPassada } from './atividadeApontamentoRegras.js';

export const LINHA_PRODUTO = 'produtos';
export const LINHA_MAQUINA = 'maquinas';
/** Fatia 4: o segmento da rota da mão de obra (`…/mao-obra`) e do serviço (`…/servicos`). */
export const LINHA_MAO_OBRA = 'mao-obra';
export const LINHA_SERVICO = 'servicos';
/**
 * A coleção de cada tipo de linha no apontamento (lista e detalhe) e no corpo do lançamento com linhas: a mão de obra
 * é `mao_obra[]` (a rota é `…/mao-obra`).
 */
export const COLECAO_DA_LINHA = Object.freeze(
  /** @type {Record<string, 'produtos'|'maquinas'|'mao_obra'|'servicos'>} */ ({
    [LINHA_PRODUTO]: 'produtos',
    [LINHA_MAQUINA]: 'maquinas',
    [LINHA_MAO_OBRA]: 'mao_obra',
    [LINHA_SERVICO]: 'servicos',
  }),
);
/** Medidas da mão de obra (CHECK do servidor). */
export const MEDIDAS_MAO_OBRA = Object.freeze(['HORA', 'DIARIA', 'TAREFA']);
/** Rótulo de cada medida (a escolha da janela). */
export const ROTULO_MEDIDA = Object.freeze(/** @type {Record<string, string>} */ ({ HORA: 'Hora', DIARIA: 'Diária', TAREFA: 'Tarefa' }));
/**
 * Sugestão (não regra) da medida pelo tipo do funcionário (§3); o terceiro não tem sugestão (hora). D-PROD-209: o
 * funcionário TERCEIRIZADO (no lugar do TAREFEIRO) sugere hora; a medida TAREFA continua existindo, escolhida na linha.
 */
export const MEDIDA_SUGERIDA = Object.freeze(/** @type {Record<string, string>} */ ({ MENSALISTA: 'HORA', DIARISTA: 'DIARIA', TERCEIRIZADO: 'HORA' }));
/** Origem da mão de obra (D-PROD-208): parceiro com o papel funcionário ou prestador de serviço (terceiro). */
export const ORIGEM_FUNCIONARIO = 'FUNCIONARIO';
export const ORIGEM_TERCEIRO = 'TERCEIRO';
/** Rótulo do tipo do funcionário (detalhe da opção do seletor). */
export const ROTULO_TIPO_FUNCIONARIO = Object.freeze(/** @type {Record<string, string>} */ ({ MENSALISTA: 'Mensalista', DIARISTA: 'Diarista', TERCEIRIZADO: 'Terceirizado' }));
/** Documento de referência do serviço (VarChar(120)). */
export const MAX_DOCUMENTO_SERVICO = 120;
/** Observação da linha (VarChar(500)). */
export const MAX_OBSERVACAO_LINHA = 500;
/** Justificativa do salto do medidor (§3): 3 a 500 caracteres úteis. */
export const JUSTIFICATIVA_MINIMA = 3;
export const JUSTIFICATIVA_MAXIMA = 500;
/** Quantidade, leituras e uso: Decimal(14, 4). */
export const LIMITES_LINHA = LIMITES_DECIMAL_ATIVIDADE;
/**
 * Máximo de linhas de CADA coleção (`produtos[]`, `maquinas[]`, `mao_obra[]`, `servicos[]`) num lançamento com linhas:
 * o `LINHAS_NO_LANCAMENTO_MAXIMO` do servidor (`backend/src/modules/atividades/atividadeComum.js`, o `maxItems` do corpo).
 */
export const LINHAS_NO_LANCAMENTO_MAXIMO = 20;

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} t */
const tamanho = (t) => [...t].length;
/** Texto canônico gravado → texto do campo ("12.5000" → "12,5"). @param {unknown} v */
const paraEdicao = (v) => paraTextoDeEdicao(v, LOCALE_ATIVIDADE, { casasMax: LIMITES_LINHA.casas });
/** "12,5" (sem zeros à direita); vazio sem valor. @param {unknown} v */
export const formatarDecimalLinha = (v) => (ehCanonico(v) ? formatarNumero(/** @type {string} */ (v), { locale: LOCALE_ATIVIDADE, casasMin: 0, casasMax: 4 }) : '');

/**
 * Decimal digitado (pt-BR) → canônico; vazio → null; inválido → erro do campo.
 * @param {unknown} digitado @param {string} oque ex.: "A quantidade"
 * @returns {{ valor: string|null, erro: string|null }}
 */
const lerDecimal = (digitado, oque) => {
  const t = texto(digitado);
  if (!t) return { valor: null, erro: null };
  const lida = lerNumeroLocal(t, LOCALE_ATIVIDADE, LIMITES_LINHA);
  if (lida.ok) return { valor: /** @type {string} */ (lida.valor), erro: null };
  if (lida.motivo === 'casas') return { valor: null, erro: `Use no máximo ${LIMITES_LINHA.casas} casas decimais.` };
  if (lida.motivo === 'limite') return { valor: null, erro: `${oque} passa do limite permitido.` };
  return { valor: null, erro: `${oque} está em formato inválido: use 1.234,5.` };
};

// ─── Chaves das consultas ────────────────────────────────────────────────

/** Totais de UMA atividade (o totalizador do cabeçalho). @param {string|null|undefined} empresaId @param {string|null|undefined} atividadeId */
export const chaveTotais = (empresaId, atividadeId) => [RAIZ_CONSULTAS_ATIVIDADES, 'totais', empresaId ?? null, atividadeId ?? null];
/** Locais com saldo de um produto (relida depois de baixa, estorno e recusa de saldo). @param {string|null} empresaId @param {string|null} produtoId */
export const chaveLocaisDoProduto = (empresaId, produtoId) => [RAIZ_CONSULTAS_ATIVIDADES, 'locais', empresaId ?? null, produtoId ?? null];
/** Medidor de um bem na data do apontamento. @param {string|null} empresaId @param {string|null} bemId @param {string|null} dia */
export const chaveMedidor = (empresaId, bemId, dia) => [RAIZ_CONSULTAS_ATIVIDADES, 'medidor', empresaId ?? null, bemId ?? null, dia ?? null];

// ─── O que o tipo permite ────────────────────────────────────────────────

/**
 * Flags do TIPO da atividade que valem para as linhas: `permite_produto` (sem ela o bloco Produtos some e o servidor
 * recusa), `permite_implemento` e, na Fatia 4, `permite_mao_obra` e `permite_servico` (os blocos Mão de obra e
 * Serviços). O servidor confere o tipo ATUAL; a tela usa o que a atividade trouxer (`permite_*` ou
 * `tipo_atividade.permite_*`) e, sem isso, o tipo da lista de tipos. Sem saber: fechado.
 * @param {any} atividade @param {any[]} [tipos]
 * @returns {{ permiteProduto: boolean, permiteImplemento: boolean, permiteMaoObra: boolean, permiteServico: boolean }}
 */
export const flagsDoTipoDaAtividade = (atividade, tipos = []) => {
  const doTipo = (Array.isArray(tipos) ? tipos : []).find((t) => ehObjeto(t) && String(t.id) === String(atividade?.tipo_atividade_id ?? ''));
  /** @param {string} flag */
  const flag = (flag) => {
    if (typeof atividade?.[flag] === 'boolean') return atividade[flag];
    if (typeof atividade?.tipo_atividade?.[flag] === 'boolean') return atividade.tipo_atividade[flag];
    return doTipo?.[flag] === true;
  };
  return {
    permiteProduto: flag('permite_produto'),
    permiteImplemento: flag('permite_implemento'),
    permiteMaoObra: flag('permite_mao_obra'),
    permiteServico: flag('permite_servico'),
  };
};

// ─── Linhas gravadas (lista e detalhe do apontamento) ────────────────────

/** @param {any} a @param {any} b */
const porOrdem = (a, b) => (Number(a?.ordem) || 0) - (Number(b?.ordem) || 0);

/** @param {any} apontamento @param {string} colecao */
const gravadas = (apontamento, colecao) => (Array.isArray(apontamento?.[colecao]) ? apontamento[colecao] : []).filter((l) => ehObjeto(l) && l.id != null).sort(porOrdem);

/**
 * As linhas do apontamento como o servidor devolve (`produtos[]`, `maquinas[]`, `mao_obra[]`, `servicos[]`, canceladas
 * inclusive), por ordem.
 * @param {any} apontamento
 * @returns {{ produtos: any[], maquinas: any[], mao_obra: any[], servicos: any[] }}
 */
export const linhasDoApontamento = (apontamento) => ({
  produtos: gravadas(apontamento, 'produtos'),
  maquinas: gravadas(apontamento, 'maquinas'),
  mao_obra: gravadas(apontamento, 'mao_obra'),
  servicos: gravadas(apontamento, 'servicos'),
});

/** As linhas de UM tipo (o segmento da rota: `produtos`, `maquinas`, `mao-obra`, `servicos`). @param {any} apontamento @param {string} tipo */
export const linhasDoTipo = (apontamento, tipo) => linhasDoApontamento(apontamento)[COLECAO_DA_LINHA[tipo] ?? 'produtos'];

/** Tem alguma linha CONFIRMADA (produto, máquina, mão de obra ou serviço)? @param {any} apontamento */
export const temLinhaConfirmada = (apontamento) => {
  const { produtos, maquinas, mao_obra, servicos } = linhasDoApontamento(apontamento);
  return [...produtos, ...maquinas, ...mao_obra, ...servicos].some((l) => l.status === STATUS_CONFIRMADO);
};

/** Nome do produto da linha (resumo do servidor ou o snapshot). @param {any} l */
export const rotuloDoProdutoDaLinha = (l) => texto(l?.produto?.nome) || texto(l?.produto_nome);
/** Nome do local de onde saiu. @param {any} l */
export const rotuloDoLocalDaLinha = (l) => texto(l?.local_estoque?.nome) || texto(l?.local_nome) || texto(l?.local?.nome);
/** Máquina da linha ("TP-02 — Trator"). @param {any} l */
export const rotuloDaMaquinaDaLinha = (l) => rotuloDoBem(l?.bem) || texto(l?.bem_nome);
/** Implemento da linha. @param {any} l */
export const rotuloDoImplementoDaLinha = (l) => rotuloDoBem(l?.implemento) || texto(l?.implemento_nome);
/** Funcionário ou terceiro da linha de mão de obra (o resumo `parceiro` do servidor ou o nome). @param {any} l */
export const rotuloDaMaoObraDaLinha = (l) => texto(l?.parceiro?.nome) || texto(l?.parceiro_nome);
/** A linha (ou o total) de mão de obra é de terceiro? @param {any} l */
export const ehMaoObraDeTerceiro = (l) => l?.origem === ORIGEM_TERCEIRO;
/** "Nome" ou "Nome (terceiro)". @param {string} nome @param {any} l */
export const comMarcaDeTerceiro = (nome, l) => (nome && ehMaoObraDeTerceiro(l) ? `${nome} (terceiro)` : nome);
/** Serviço da linha. @param {any} l */
export const rotuloDoServicoDaLinha = (l) => texto(l?.servico?.nome) || texto(l?.servico_nome);
/** Parceiro (prestador) da linha de serviço; vazio sem parceiro. @param {any} l */
export const rotuloDoParceiroDaLinha = (l) =>
  texto(l?.fornecedor_parceiro?.nome) || texto(l?.parceiro?.nome) || texto(l?.fornecedor_parceiro_nome) || texto(l?.parceiro_nome);

/**
 * Unidade em que a quantidade do produto é digitada e baixada (`L` | `KG`): a unidade EFETIVA do estoque (SACO
 * guarda kg). Da opção de produto (`unidade_principal_estoque`) ou da linha gravada (`unidade`).
 * @param {any} produtoOuLinha
 * @returns {'L'|'KG'|null}
 */
export const unidadeDoProduto = (produtoOuLinha) =>
  unidadeDoAbastecimentoDoProduto(produtoOuLinha?.unidade_principal_estoque) ??
  unidadeDoAbastecimentoDoProduto(produtoOuLinha?.unidade) ??
  unidadeDoAbastecimentoDoProduto(produtoOuLinha?.produto?.unidade_principal_estoque);

/** "12,5 L" / "80 kg"; vazio sem valor. @param {unknown} v @param {unknown} unidade */
export const formatarQuantidadeLinha = (v, unidade) => {
  const n = formatarDecimalLinha(v);
  if (!n) return '';
  const u = rotuloDaUnidade(unidade);
  return u ? `${n} ${u}` : n;
};

/** Custo em reais (até 4 casas); vazio sem valor. @param {unknown} v */
export const formatarCustoLinha = (v) => (ehCanonico(v) ? formatarCusto(v) : '');

// ─── Abastecimento ligado à atividade (D-PROD-211, só leitura) ───────────

/** "Nº 3 — Cigarrinha Pasto 01" (a atividade do abastecimento: `{id, numero, nome}`); "—" sem ela. @param {any} atividade */
export const rotuloDaAtividadeDoAbastecimento = (atividade) => {
  if (!ehObjeto(atividade)) return '—';
  const numero = atividade.numero != null && String(atividade.numero) !== '' ? `Nº ${atividade.numero}` : '';
  return [numero, texto(atividade.nome)].filter(Boolean).join(' — ') || '—';
};

/** "12/11/2026 · Manhã · 1ª passada" (o lançamento: `{id, data_operacional, turno, sequencia}`); "—" sem ele. @param {any} apontamento */
export const rotuloDoLancamentoDoAbastecimento = (apontamento) => {
  if (!ehObjeto(apontamento)) return '—';
  return [formatarDiaAtividade(apontamento.data_operacional), rotuloDoTurno(apontamento.turno), rotuloDaPassada(apontamento.sequencia)].filter(Boolean).join(' · ') || '—';
};

// ─── Dose/ha e uso (só leitura) ──────────────────────────────────────────

/**
 * Dose/ha = quantidade / área do dia, 4 casas (HALF_UP), em BigInt — só prévia (o servidor grava e recalcula quando a
 * área do dia muda). Sem área (ou área zero) → null.
 * @param {unknown} quantidade @param {unknown} area
 * @returns {string|null}
 */
export const doseHa = (quantidade, area) => {
  if (!ehCanonico(quantidade) || !ehCanonico(area) || !ehPositivo(/** @type {string} */ (area))) return null;
  try {
    const q = paraUnidades(quantidade, 4);
    const a = paraUnidades(area, 4);
    const n = q * 10000n;
    let r = n / a;
    if ((n % a) * 2n >= a) r += 1n;
    return deUnidades(r, 4);
  } catch {
    return null;
  }
};

/** "2,5 L/ha"; vazio sem dose. @param {unknown} dose @param {unknown} unidade */
export const formatarDose = (dose, unidade) => {
  const n = formatarDecimalLinha(dose);
  if (!n) return '';
  const u = rotuloDaUnidade(unidade);
  return `${n} ${u ? `${u}/ha` : 'por ha'}`;
};

/** Medidor que conta (horímetro, odômetro, ciclos): pede leitura. @param {unknown} tipo */
export const ehContador = (tipo) => typeof tipo === 'string' && MEDIDORES_CONTADOR.includes(tipo);

const UNIDADE_DO_TEXTO = Object.freeze(/** @type {Record<string, string>} */ ({ H: 'h', HORA: 'h', HORAS: 'h', HR: 'h', KM: 'km', CICLOS: 'ciclos', CICLO: 'ciclos' }));

/**
 * Unidade legível do medidor ("h", "km", "ciclos"): a gravada/do bem e, sem ela, a do tipo do medidor.
 * @param {unknown} tipo @param {unknown} unidade
 */
export const rotuloDaUnidadeDoMedidor = (tipo, unidade) => {
  const u = texto(unidade);
  if (u) return UNIDADE_DO_TEXTO[u.toUpperCase()] ?? u;
  return UNIDADE_MEDIDOR[String(tipo ?? '')] ?? '';
};

/** "Horímetro (h)" / "Odômetro (km)" / "Sem medidor". @param {unknown} tipo */
export const rotuloDoMedidor = (tipo) => ROTULO_LEITURA[String(tipo ?? '')] ?? 'Sem medidor';

/** "8 h" / "120 km"; vazio sem valor. @param {unknown} v @param {unknown} tipo @param {unknown} unidade */
export const formatarUso = (v, tipo, unidade) => {
  const n = formatarDecimalLinha(v);
  if (!n) return '';
  const u = rotuloDaUnidadeDoMedidor(tipo, unidade);
  return u ? `${n} ${u}` : n;
};

/**
 * Medidor de um bem (`/atividades-opcoes/medidor`), normalizado: tipo e unidade (do bem), se conta, a leitura vigente
 * na data (`{ leitura, data, origem, numero }`) e o teto do salto. Aceita os nomes do contrato e os do abastecimento.
 * @param {unknown} r
 * @returns {{ tipo: string|null, unidade: string, contador: boolean, vigente: { leitura: string, data: string|null, origem: string|null, numero: unknown } | null, teto: string|null, custo: string|null }}
 */
export const medidorDaResposta = (r) => {
  const o = ehObjeto(r) ? r : {};
  const m = ehObjeto(o.medidor) ? o.medidor : o;
  const tipo = texto(m.medidor_tipo) || texto(m.tipo) || null;
  const bruto = m.leitura_vigente ?? m.vigente ?? null;
  /** @type {{ leitura: string, data: string|null, origem: string|null, numero: unknown } | null} */
  let vigente = null;
  if (ehObjeto(bruto) && ehCanonico(bruto.leitura)) {
    vigente = { leitura: bruto.leitura, data: texto(bruto.data) || null, origem: texto(bruto.origem) || null, numero: bruto.numero ?? null };
  } else if (ehCanonico(m.leitura_sugerida)) {
    vigente = { leitura: m.leitura_sugerida, data: texto(m.data) || null, origem: null, numero: null };
  } else if (ehCanonico(bruto)) {
    vigente = { leitura: /** @type {string} */ (bruto), data: texto(m.leitura_vigente_data) || null, origem: texto(m.leitura_vigente_origem) || null, numero: null };
  }
  const teto = [m.salto_maximo, m.salto_maximo_medidor, m.teto].find(ehCanonico) ?? null;
  const custo = [m.custo_uso_unitario, m.custo_unitario_uso].find(ehCanonico) ?? null;
  return { tipo, unidade: rotuloDaUnidadeDoMedidor(tipo, m.medidor_unidade ?? m.unidade), contador: ehContador(tipo), vigente, teto, custo };
};

/** "Última leitura: 1.550 h em 12/11/2026 (abastecimento nº 4)". @param {ReturnType<typeof medidorDaResposta>} medidor */
export const textoDaLeituraVigente = (medidor) => {
  const v = medidor?.vigente;
  if (!v) return 'Sem leitura registrada para este bem até esta data.';
  const dia = v.data ? ` em ${formatarDiaAbastecimento(v.data)}` : '';
  const origem =
    v.origem === 'CADASTRO' ? ' (cadastro do bem)' : v.origem === 'ABASTECIMENTO' ? ` (abastecimento${v.numero != null ? ` nº ${v.numero}` : ''})` : v.origem === 'ATIVIDADE' ? ' (lançamento de atividade)' : '';
  return `Última leitura: ${formatarDecimalLinha(v.leitura)}${medidor.unidade ? ` ${medidor.unidade}` : ''}${dia}${origem}.`;
};

// ─── Linha de PRODUTO (janela e "Repetir") ───────────────────────────────

/**
 * @typedef {{ id: string, rotulo: string, unidade_principal_estoque: string|null, carencia_dias?: number|null } | null} ProdutoEscolhido
 * @typedef {{ produto: ProdutoEscolhido, local_estoque_id: string|null, quantidade: string, observacao: string, vc?: string }} FormularioLinhaProduto
 *   D-PROD-274: `carencia_dias` (a carência da bula, para o "Pasto liberado em") e `vc` (o VC % digitado, Plantio).
 */

/** A opção do seletor (ou o resumo gravado) como o formulário guarda. @param {any} o @returns {ProdutoEscolhido} */
export const produtoEscolhido = (o) =>
  ehObjeto(o) && o.id != null
    ? {
        id: String(o.id),
        rotulo: texto(o.nome) || texto(o.rotulo) || String(o.id),
        unidade_principal_estoque: texto(o.unidade_principal_estoque) || texto(o.unidade) || null,
        // D-PROD-274: a carência da bula (dias), quando a opção a traz.
        ...(Number.isInteger(o.carencia_dias) ? { carencia_dias: o.carencia_dias } : {}),
      }
    : null;

/** @returns {FormularioLinhaProduto} */
export const formularioProdutoVazio = () => ({ produto: null, local_estoque_id: null, quantidade: '', observacao: '' });

/** Formulário a partir da linha gravada (editar, "Repetir"). @param {any} l @returns {FormularioLinhaProduto} */
export const formularioDaLinhaProduto = (l) => ({
  produto: l?.produto_id
    ? {
        id: String(l.produto_id),
        rotulo: rotuloDoProdutoDaLinha(l) || String(l.produto_id),
        unidade_principal_estoque: texto(l?.produto?.unidade_principal_estoque) || texto(l?.unidade) || null,
      }
    : null,
  local_estoque_id: texto(l?.local_estoque_id) || null,
  quantidade: paraEdicao(l?.quantidade),
  observacao: typeof l?.observacao === 'string' ? l.observacao : '',
});

/**
 * Validação local da linha de produto. Saldo: a quantidade acima do disponível do local AVISA com o disponível ×
 * pedido (o servidor confere sob trava e recusa com ESTOQUE_SALDO_INSUFICIENTE); não bloqueia aqui porque o saldo
 * lido pode estar velho.
 * @param {FormularioLinhaProduto} form @param {{ disponivel?: string|null }} [ctx]
 * @returns {{ erros: Record<string, string>, aviso: string|null }}
 */
export const validarLinhaProduto = (form, ctx = {}) => {
  /** @type {Record<string, string>} */
  const erros = {};
  let aviso = null;
  if (!form?.produto?.id) erros.produto = 'Escolha o produto.';
  else if (!unidadeDoProduto(form.produto)) {
    erros.produto = 'O estoque deste produto não está em litros (L), quilos (KG) nem sacos (SACO): ele não pode ser lançado na atividade.';
  } else if (!form.local_estoque_id) erros.local_estoque_id = 'Escolha de qual local do estoque sai o produto.';
  const q = lerDecimal(form?.quantidade, 'A quantidade');
  if (q.erro) erros.quantidade = q.erro;
  else if (!q.valor) erros.quantidade = 'Informe a quantidade.';
  else if (!ehPositivo(q.valor)) erros.quantidade = 'Informe uma quantidade maior que zero.';
  else if (ehCanonico(ctx.disponivel) && comparar(q.valor, /** @type {string} */ (ctx.disponivel)) > 0) {
    const u = rotuloDaUnidade(unidadeDoProduto(form.produto));
    aviso = `Saldo insuficiente neste local: disponível ${formatarDecimalLinha(ctx.disponivel)}${u ? ` ${u}` : ''}, pedido ${formatarDecimalLinha(q.valor)}${u ? ` ${u}` : ''}. O servidor recusa a baixa acima do saldo.`;
  }
  if (tamanho(texto(form?.observacao)) > MAX_OBSERVACAO_LINHA) erros.observacao = `No máximo ${MAX_OBSERVACAO_LINHA} caracteres.`;
  return { erros, aviso };
};

/**
 * Corpo da linha de produto (formulário JÁ VALIDADO): produto, local, quantidade em texto canônico e observação
 * (vazia = null). A unidade, o custo e a dose são do servidor.
 * @param {FormularioLinhaProduto} form
 */
export const corpoDaLinhaProduto = (form) => ({
  produto_id: form.produto?.id ?? null,
  local_estoque_id: form.local_estoque_id ?? null,
  quantidade: lerDecimal(form.quantidade, '').valor,
  observacao: texto(form.observacao) || null,
});

// ─── Linha de MÁQUINA (janela e "Repetir") ───────────────────────────────

/**
 * @typedef {{ id: string, rotulo: string } | null} BemEscolhido
 * @typedef {{
 *   bem: BemEscolhido,
 *   implemento: BemEscolhido,
 *   sem_medidor: boolean,
 *   leitura_inicial: string,
 *   leitura_final: string,
 *   quantidade_uso: string,
 *   justificativa_salto: string,
 *   observacao: string,
 * }} FormularioLinhaMaquina
 */

/** @param {any} o @returns {BemEscolhido} */
export const bemEscolhido = (o) => (ehObjeto(o) && o.id != null ? { id: String(o.id), rotulo: rotuloDoBem(o) || texto(o.rotulo) || String(o.id) } : null);

/**
 * Linha nova: a máquina do CABEÇALHO vem como sugestão (o operador troca).
 * @param {any} [bemDoCabecalho] @returns {FormularioLinhaMaquina}
 */
export const formularioMaquinaVazio = (bemDoCabecalho = null) => ({
  bem: bemEscolhido(bemDoCabecalho),
  implemento: null,
  sem_medidor: false,
  leitura_inicial: '',
  leitura_final: '',
  quantidade_uso: '',
  justificativa_salto: '',
  observacao: '',
});

/** Formulário a partir da linha gravada (editar). @param {any} l @returns {FormularioLinhaMaquina} */
export const formularioDaLinhaMaquina = (l) => ({
  bem: l?.bem_id ? { id: String(l.bem_id), rotulo: rotuloDaMaquinaDaLinha(l) || String(l.bem_id) } : null,
  implemento: l?.implemento_bem_id ? { id: String(l.implemento_bem_id), rotulo: rotuloDoImplementoDaLinha(l) || String(l.implemento_bem_id) } : null,
  sem_medidor: l?.sem_medidor === true,
  leitura_inicial: paraEdicao(l?.leitura_inicial),
  leitura_final: paraEdicao(l?.leitura_final),
  quantidade_uso: l?.sem_medidor === true ? paraEdicao(l?.quantidade_uso) : '',
  justificativa_salto: typeof l?.justificativa_salto === 'string' ? l.justificativa_salto : '',
  observacao: typeof l?.observacao === 'string' ? l.observacao : '',
});

/**
 * "Repetir": a máquina e o implemento da linha base; a leitura NÃO é copiada (a inicial é sugerida de novo pela
 * leitura vigente e a final fica em branco); "sem medidor" copia o uso, para o operador só ajustar.
 * @param {any} l @returns {FormularioLinhaMaquina}
 */
export const formularioMaquinaDaBase = (l) => {
  const f = formularioDaLinhaMaquina(l);
  return { ...f, leitura_inicial: '', leitura_final: '', justificativa_salto: '' };
};

/**
 * A linha usa o caminho "sem medidor"? O bem sem medidor que conta só tem esse caminho.
 * @param {FormularioLinhaMaquina} form @param {{ contador: boolean }} medidor
 */
export const usaSemMedidor = (form, medidor) => form?.sem_medidor === true || !medidor?.contador;

/**
 * Uso da linha (só leitura): final − inicial com leitura; o informado sem medidor. Inválido ou negativo → null.
 * @param {FormularioLinhaMaquina} form @param {{ contador: boolean }} medidor
 * @returns {string|null}
 */
export const usoDaLinha = (form, medidor) => {
  if (usaSemMedidor(form, medidor)) return lerDecimal(form?.quantidade_uso, '').valor;
  const i = lerDecimal(form?.leitura_inicial, '').valor;
  const f = lerDecimal(form?.leitura_final, '').valor;
  if (!i || !f || comparar(f, i) < 0) return null;
  return subtrair(f, i, 4);
};

/** O uso passa do teto do salto do tipo patrimonial? @param {string|null} uso @param {string|null} teto */
export const passaDoTeto = (uso, teto) => ehCanonico(uso) && ehCanonico(teto) && comparar(/** @type {string} */ (uso), /** @type {string} */ (teto)) > 0;

/**
 * Validação local da linha de máquina (o servidor confere tudo de novo, inclusive o medidor para trás).
 * @param {FormularioLinhaMaquina} form
 * @param {{ medidor: { contador: boolean, unidade?: string }, permiteImplemento: boolean, pedeJustificativa: boolean }} ctx
 * @returns {Record<string, string>}
 */
export const validarLinhaMaquina = (form, { medidor, permiteImplemento, pedeJustificativa }) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!form?.bem?.id) erros.bem = 'Escolha a máquina.';
  if (form?.implemento?.id) {
    if (!permiteImplemento) erros.implemento = 'O tipo desta atividade não permite implemento.';
    else if (form.implemento.id === form?.bem?.id) erros.implemento = 'O implemento não pode ser a própria máquina.';
  }
  if (usaSemMedidor(form, medidor)) {
    const uso = lerDecimal(form?.quantidade_uso, 'O uso');
    if (uso.erro) erros.quantidade_uso = uso.erro;
    else if (!uso.valor) erros.quantidade_uso = `Informe o uso${medidor?.unidade ? ` (${medidor.unidade})` : ' (horas ou km)'}.`;
    else if (!ehPositivo(uso.valor)) erros.quantidade_uso = 'Informe um uso maior que zero.';
  } else {
    const i = lerDecimal(form?.leitura_inicial, 'A leitura inicial');
    const f = lerDecimal(form?.leitura_final, 'A leitura final');
    if (i.erro) erros.leitura_inicial = i.erro;
    else if (!i.valor) erros.leitura_inicial = 'Informe a leitura inicial.';
    if (f.erro) erros.leitura_final = f.erro;
    else if (!f.valor) erros.leitura_final = 'Informe a leitura final.';
    else if (i.valor && comparar(f.valor, i.valor) < 0) erros.leitura_final = 'A leitura final é menor que a inicial: o medidor não anda para trás.';
  }
  const just = texto(form?.justificativa_salto);
  if (pedeJustificativa) {
    if (tamanho(just) < JUSTIFICATIVA_MINIMA) erros.justificativa_salto = `Informe a justificativa do salto (pelo menos ${JUSTIFICATIVA_MINIMA} caracteres).`;
    else if (tamanho(just) > JUSTIFICATIVA_MAXIMA) erros.justificativa_salto = `No máximo ${JUSTIFICATIVA_MAXIMA} caracteres.`;
  }
  if (tamanho(texto(form?.observacao)) > MAX_OBSERVACAO_LINHA) erros.observacao = `No máximo ${MAX_OBSERVACAO_LINHA} caracteres.`;
  return erros;
};

/**
 * Corpo da linha de máquina (formulário JÁ VALIDADO). Com leitura: as duas leituras (o uso é do servidor); sem
 * medidor: `sem_medidor: true` e o uso informado. Tipo e unidade do medidor e o custo são do bem e nunca vão.
 * @param {FormularioLinhaMaquina} form @param {{ contador: boolean }} medidor @param {{ comJustificativa: boolean }} ctx
 */
export const corpoDaLinhaMaquina = (form, medidor, { comJustificativa }) => {
  const sem = usaSemMedidor(form, medidor);
  return {
    bem_id: form.bem?.id ?? null,
    implemento_bem_id: form.implemento?.id ?? null,
    sem_medidor: sem,
    leitura_inicial: sem ? null : lerDecimal(form.leitura_inicial, '').valor,
    leitura_final: sem ? null : lerDecimal(form.leitura_final, '').valor,
    quantidade_uso: sem ? lerDecimal(form.quantidade_uso, '').valor : null,
    justificativa_salto: comJustificativa ? texto(form.justificativa_salto) || null : null,
    observacao: texto(form.observacao) || null,
  };
};

// ─── Total da linha (só leitura) ─────────────────────────────────────────

/**
 * Total da linha = quantidade × unitário, 4 casas (HALF_UP), em BigInt — só prévia (o servidor grava o total). Sem
 * um dos dois (ou inválido): null.
 * @param {unknown} quantidade @param {unknown} unitario
 * @returns {string|null}
 */
export const totalDaLinha = (quantidade, unitario) => {
  if (!ehCanonico(quantidade) || !ehCanonico(unitario)) return null;
  try {
    return multiplicarArredondar(/** @type {string} */ (quantidade), /** @type {string} */ (unitario), 4);
  } catch {
    return null;
  }
};

// ─── Linha de MÃO DE OBRA (janela e "Repetir") ───────────────────────────

/**
 * @typedef {{ id: string, rotulo: string, origem: 'FUNCIONARIO'|'TERCEIRO', tipo: string|null, custo_hora: string|null,
 *   custo_diaria: string|null } | null} MaoObraEscolhida
 *   O parceiro da linha (D-PROD-208): funcionário (com o tipo e os custos do cadastro dele) ou terceiro (prestador de
 *   serviço, sem custo de cadastro: o custo é sempre digitado).
 * @typedef {{ parceiro_id: string, tipo_medida: string, custo_unitario: string|null, parceiro?: MaoObraEscolhida } | null} MaoObraGravada
 *   O que a linha EDITADA gravou (o snapshot do custo e o parceiro com a ORIGEM gravada): com o mesmo funcionário e a
 *   mesma medida, a edição mantém esse custo; só o "Repetir" e a linha nova usam o cadastro de agora.
 * @typedef {{ parceiro: MaoObraEscolhida, tipo_medida: string, quantidade: string, custo_unitario: string, observacao: string,
 *   gravado?: MaoObraGravada }} FormularioLinhaMaoObra
 */

/** @param {unknown} v */
const decimalOuNulo = (v) => (ehCanonico(v) ? /** @type {string} */ (v) : null);

/** @param {unknown} origem @returns {'FUNCIONARIO'|'TERCEIRO'} */
const origemDe = (origem) => (origem === ORIGEM_TERCEIRO ? ORIGEM_TERCEIRO : ORIGEM_FUNCIONARIO);

/**
 * A opção do seletor (`/atividades-opcoes/mao-obra`: `{ id, nome, origem, funcionario_tipo, funcionario_custo_hora,
 * funcionario_custo_diaria }`) como o formulário guarda. O terceiro não leva custo de cadastro.
 * @param {any} o @returns {MaoObraEscolhida}
 */
export const maoObraEscolhida = (o) => {
  if (!ehObjeto(o) || o.id == null) return null;
  const origem = origemDe(o.origem);
  const funcionario = origem === ORIGEM_FUNCIONARIO;
  return {
    id: String(o.id),
    rotulo: texto(o.nome) || texto(o.rotulo) || String(o.id),
    origem,
    tipo: funcionario ? texto(o.funcionario_tipo) || null : null,
    custo_hora: funcionario ? decimalOuNulo(o.funcionario_custo_hora) : null,
    custo_diaria: funcionario ? decimalOuNulo(o.funcionario_custo_diaria) : null,
  };
};

/** Medida sugerida pelo tipo do funcionário (MENSALISTA → HORA, DIARISTA → DIARIA, TERCEIRIZADO → HORA). @param {unknown} tipo */
export const medidaSugerida = (tipo) => MEDIDA_SUGERIDA[String(tipo ?? '')] ?? 'HORA';

/** Medida sugerida ao escolher o parceiro: a do tipo do funcionário; terceiro, sem sugestão (hora). @param {MaoObraEscolhida} p */
export const medidaSugeridaDaMaoObra = (p) => (p && p.origem === ORIGEM_FUNCIONARIO ? medidaSugerida(p.tipo) : 'HORA');

/** "Hora (h)" na unidade da quantidade: "h", "diária(s)", "tarefa(s)". @param {unknown} medida */
export const unidadeDaMedida = (medida) => (medida === 'DIARIA' ? 'diária(s)' : medida === 'TAREFA' ? 'tarefa(s)' : medida === 'HORA' ? 'h' : '');

/** "8 h" / "2 diária(s)" / "3 tarefa(s)"; vazio sem valor. @param {unknown} v @param {unknown} medida */
export const formatarQuantidadeMaoObra = (v, medida) => {
  const n = formatarDecimalLinha(v);
  if (!n) return '';
  const u = unidadeDaMedida(medida);
  return u ? `${n} ${u}` : n;
};

/**
 * Custo unitário que vem do CADASTRO do funcionário (hora → `custo_hora`, diária → `custo_diaria`); tarefa, terceiro
 * (digitado) ou sem custo no cadastro: null.
 * @param {MaoObraEscolhida} parceiro @param {unknown} medida
 * @returns {string|null}
 */
export const custoDoCadastro = (parceiro, medida) => {
  if (!parceiro || parceiro.origem === ORIGEM_TERCEIRO) return null;
  if (medida === 'HORA') return parceiro.custo_hora;
  if (medida === 'DIARIA') return parceiro.custo_diaria;
  return null;
};

/**
 * O custo unitário é digitado? Na tarefa do funcionário e SEMPRE no terceiro (D-PROD-208).
 * @param {unknown} medida @param {unknown} [origem]
 */
export const custoDigitado = (medida, origem = null) => origem === ORIGEM_TERCEIRO || medida === 'TAREFA';

/** O custo do formulário é digitado? @param {FormularioLinhaMaoObra} form */
const custoDigitadoNoForm = (form) => custoDigitado(form?.tipo_medida, form?.parceiro?.origem);

/** @returns {FormularioLinhaMaoObra} */
export const formularioMaoObraVazio = () => ({ parceiro: null, tipo_medida: 'HORA', quantidade: '', custo_unitario: '', observacao: '', gravado: null });

/**
 * Formulário a partir da linha gravada (EDITAR). Guarda em `gravado` o parceiro, a medida e o custo unitário da
 * linha (o snapshot): enquanto parceiro e medida forem os mesmos (funcionário, hora/diária), a prévia mostra esse custo
 * (o servidor o mantém e só recalcula o total). O resumo `parceiro` do servidor traz os custos ATUAIS do cadastro do
 * funcionário: são eles que a prévia mostra ao trocar o parceiro ou a medida (só sem eles na resposta, o snapshot da
 * linha na medida dela). Terceiro: o custo gravado volta como o digitado.
 * @param {any} l @returns {FormularioLinhaMaoObra}
 */
export const formularioDaLinhaMaoObra = (l) => {
  const medida = MEDIDAS_MAO_OBRA.includes(l?.tipo_medida) ? l.tipo_medida : 'HORA';
  const p = ehObjeto(l?.parceiro) ? l.parceiro : {};
  const origem = origemDe(l?.origem);
  const snapshot = decimalOuNulo(l?.custo_unitario);
  /** @param {'funcionario_custo_hora'|'funcionario_custo_diaria'} campo @param {string} daMedida */
  const doCadastro = (campo, daMedida) =>
    origem === ORIGEM_TERCEIRO ? null : Object.prototype.hasOwnProperty.call(p, campo) ? decimalOuNulo(p[campo]) : medida === daMedida ? snapshot : null;
  /** @type {MaoObraEscolhida} */
  const parceiro = l?.parceiro_id
    ? {
        id: String(l.parceiro_id),
        rotulo: rotuloDaMaoObraDaLinha(l) || String(l.parceiro_id),
        origem,
        tipo: origem === ORIGEM_FUNCIONARIO ? texto(p.funcionario_tipo) || null : null,
        custo_hora: doCadastro('funcionario_custo_hora', 'HORA'),
        custo_diaria: doCadastro('funcionario_custo_diaria', 'DIARIA'),
      }
    : null;
  return {
    parceiro,
    tipo_medida: medida,
    quantidade: paraEdicao(l?.quantidade),
    custo_unitario: custoDigitado(medida, origem) ? paraEdicao(l?.custo_unitario) : '',
    observacao: typeof l?.observacao === 'string' ? l.observacao : '',
    gravado: parceiro ? { parceiro_id: parceiro.id, tipo_medida: medida, custo_unitario: snapshot, parceiro } : null,
  };
};

/**
 * Formulário da linha da BASE no "Repetir" (linha nova): os mesmos dados, mas sem o `gravado` — o servidor grava o
 * snapshot do cadastro de AGORA, e é ele que a prévia mostra. A origem é a ATUAL do parceiro (`parceiro.origem_atual`,
 * a que o servidor decide para a linha nova), não a gravada: se o parceiro mudou de papel, o custo segue a regra da
 * origem de agora (passar a terceiro pede o custo digitado de novo); sem papel de mão de obra, inativo ou de outra
 * fazenda (`origem_atual` nula), o parceiro fica vazio para a pessoa escolher.
 * @param {any} l @returns {FormularioLinhaMaoObra}
 */
export const formularioMaoObraDaBase = (l) => {
  const p = ehObjeto(l?.parceiro) ? l.parceiro : null;
  const comAtual = Boolean(p) && Object.prototype.hasOwnProperty.call(p, 'origem_atual');
  if (!comAtual) return { ...formularioDaLinhaMaoObra(l), gravado: null };
  const atual = /** @type {any} */ (p).origem_atual;
  if (atual !== ORIGEM_FUNCIONARIO && atual !== ORIGEM_TERCEIRO) return { ...formularioDaLinhaMaoObra(l), parceiro: null, custo_unitario: '', gravado: null };
  const gravada = origemDe(l?.origem);
  const form = formularioDaLinhaMaoObra({ ...l, origem: atual });
  // Mudou para uma origem em que o custo é digitado e antes não era: o custo antigo (do cadastro) não vale.
  const limpaCusto = atual !== gravada && !custoDigitado(form.tipo_medida, gravada);
  return { ...form, custo_unitario: limpaCusto ? '' : form.custo_unitario, gravado: null };
};

/**
 * A mudança do formulário ao escolher no seletor "Funcionário ou terceiro": a opção nova com a medida sugerida; na
 * EDIÇÃO, voltar ao parceiro GRAVADO da linha restaura a origem, a medida e o custo gravados (o servidor mantém a
 * origem com que a linha entrou, mesmo que o papel do parceiro tenha mudado).
 * @param {any} o a opção do seletor (ou null ao limpar) @param {FormularioLinhaMaoObra} form
 * @returns {Partial<FormularioLinhaMaoObra>}
 */
export const mudancaDaMaoObraEscolhida = (o, form) => {
  const g = form?.gravado;
  if (ehObjeto(o) && o.id != null && g?.parceiro && String(o.id) === g.parceiro_id) {
    const parceiro = g.parceiro;
    const digitado = custoDigitado(g.tipo_medida, parceiro.origem);
    return { parceiro, tipo_medida: g.tipo_medida, custo_unitario: digitado ? paraEdicao(g.custo_unitario) : form.custo_unitario };
  }
  const parceiro = maoObraEscolhida(o);
  return { parceiro, tipo_medida: parceiro ? medidaSugeridaDaMaoObra(parceiro) : form?.tipo_medida ?? 'HORA' };
};

/**
 * A edição mantém o custo gravado? Hora/diária do funcionário com o MESMO parceiro e a MESMA medida da linha gravada
 * (o servidor não relê o cadastro). Tarefa e terceiro: o custo é sempre o digitado.
 * @param {FormularioLinhaMaoObra} form
 */
export const custoMantidoDaLinha = (form) => {
  const g = form?.gravado;
  return Boolean(g) && !custoDigitadoNoForm(form) && form?.parceiro?.id === g?.parceiro_id && form?.tipo_medida === g?.tipo_medida;
};

/**
 * Custo unitário e total da linha de mão de obra (só leitura): tarefa e terceiro, o digitado; hora/diária do
 * funcionário, o GRAVADO na linha editada enquanto parceiro e medida forem os mesmos (`custoMantidoDaLinha`), senão o
 * do cadastro atual.
 * @param {FormularioLinhaMaoObra} form
 * @returns {{ unitario: string|null, total: string|null }}
 */
export const custoDaLinhaMaoObra = (form) => {
  const unitario = custoDigitadoNoForm(form)
    ? lerDecimal(form?.custo_unitario, '').valor
    : custoMantidoDaLinha(form)
      ? (form.gravado?.custo_unitario ?? null)
      : custoDoCadastro(form?.parceiro ?? null, form?.tipo_medida);
  return { unitario, total: totalDaLinha(lerDecimal(form?.quantidade, '').valor, unitario) };
};

/**
 * Validação local da linha de mão de obra (o servidor confere tudo de novo). O custo digitado (tarefa ou terceiro) é
 * obrigatório.
 * @param {FormularioLinhaMaoObra} form
 * @returns {Record<string, string>}
 */
export const validarLinhaMaoObra = (form) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!form?.parceiro?.id) erros.parceiro = 'Escolha o funcionário ou terceiro.';
  if (!MEDIDAS_MAO_OBRA.includes(form?.tipo_medida)) erros.tipo_medida = 'Escolha a medida: hora, diária ou tarefa.';
  const q = lerDecimal(form?.quantidade, 'A quantidade');
  if (q.erro) erros.quantidade = q.erro;
  else if (!q.valor) erros.quantidade = 'Informe a quantidade.';
  else if (!ehPositivo(q.valor)) erros.quantidade = 'Informe uma quantidade maior que zero.';
  if (custoDigitadoNoForm(form)) {
    const terceiro = form?.parceiro?.origem === ORIGEM_TERCEIRO;
    const c = lerDecimal(form?.custo_unitario, terceiro ? 'O custo unitário' : 'O custo da tarefa');
    if (c.erro) erros.custo_unitario = c.erro;
    else if (!c.valor) erros.custo_unitario = terceiro ? 'Informe o custo unitário: para terceiro ele é sempre digitado.' : 'Informe o custo da tarefa.';
  }
  if (tamanho(texto(form?.observacao)) > MAX_OBSERVACAO_LINHA) erros.observacao = `No máximo ${MAX_OBSERVACAO_LINHA} caracteres.`;
  return erros;
};

/**
 * Corpo da linha de mão de obra (formulário JÁ VALIDADO): parceiro, medida, quantidade e observação; o custo
 * unitário SÓ quando digitado (tarefa ou terceiro — hora e diária do funcionário vêm do cadastro, no servidor, e o
 * corpo não os aceita).
 * @param {FormularioLinhaMaoObra} form
 */
export const corpoDaLinhaMaoObra = (form) => ({
  parceiro_id: form.parceiro?.id ?? null,
  tipo_medida: form.tipo_medida,
  quantidade: lerDecimal(form.quantidade, '').valor,
  ...(custoDigitadoNoForm(form) ? { custo_unitario: lerDecimal(form.custo_unitario, '').valor } : {}),
  observacao: texto(form.observacao) || null,
});

// ─── Linha de SERVIÇO (janela e "Repetir") ───────────────────────────────

/**
 * @typedef {{ id: string, rotulo: string, unidade: string, valor_referencia: string|null } | null} ServicoEscolhido
 * @typedef {{ id: string, rotulo: string } | null} ParceiroEscolhido
 * @typedef {{
 *   servico: ServicoEscolhido,
 *   parceiro: ParceiroEscolhido,
 *   quantidade: string,
 *   valor_unitario: string,
 *   documento_referencia: string,
 *   observacao: string,
 * }} FormularioLinhaServico
 */

/** Sigla da unidade (texto ou o resumo `{ sigla }`). @param {unknown} u */
export const siglaDaUnidade = (u) => (ehObjeto(u) ? texto(u.sigla) || texto(u.descricao) : texto(u));

/** A opção do seletor (`/atividades-opcoes/servicos`) como o formulário guarda. @param {any} o @returns {ServicoEscolhido} */
export const servicoEscolhido = (o) =>
  ehObjeto(o) && o.id != null
    ? {
        id: String(o.id),
        rotulo: texto(o.nome) || texto(o.rotulo) || String(o.id),
        unidade: siglaDaUnidade(o.unidade) || siglaDaUnidade(o.unidade_medida) || texto(o.unidade_sigla),
        valor_referencia: decimalOuNulo(o.valor_referencia),
      }
    : null;

/** A opção do seletor (`/atividades-opcoes/parceiros-servico`). @param {any} o @returns {ParceiroEscolhido} */
export const parceiroEscolhido = (o) => (ehObjeto(o) && o.id != null ? { id: String(o.id), rotulo: texto(o.nome) || texto(o.rotulo) || String(o.id) } : null);

/** "3 ha" / "2 un"; vazio sem valor. @param {unknown} v @param {unknown} unidade */
export const formatarQuantidadeServico = (v, unidade) => {
  const n = formatarDecimalLinha(v);
  if (!n) return '';
  const u = siglaDaUnidade(unidade);
  return u ? `${n} ${u}` : n;
};

/** @returns {FormularioLinhaServico} */
export const formularioServicoVazio = () => ({ servico: null, parceiro: null, quantidade: '', valor_unitario: '', documento_referencia: '', observacao: '' });

/**
 * A mudança do formulário ao escolher o serviço: o valor unitário vem preenchido com o de referência (a pessoa troca).
 * @param {any} opcao @returns {{ servico: ServicoEscolhido, valor_unitario: string }}
 */
export const mudancaDoServicoEscolhido = (opcao) => {
  const servico = servicoEscolhido(opcao);
  return { servico, valor_unitario: servico?.valor_referencia ? paraEdicao(servico.valor_referencia) : '' };
};

/** "Repetir": o serviço da base com a mesma quantidade e valor; o documento NÃO é copiado (é do dia). @param {any} l @returns {FormularioLinhaServico} */
export const formularioServicoDaBase = (l) => ({ ...formularioDaLinhaServico(l), documento_referencia: '' });

/** Formulário a partir da linha gravada (editar, "Repetir"). @param {any} l @returns {FormularioLinhaServico} */
export const formularioDaLinhaServico = (l) => ({
  servico: l?.servico_id
    ? {
        id: String(l.servico_id),
        rotulo: rotuloDoServicoDaLinha(l) || String(l.servico_id),
        unidade: siglaDaUnidade(l?.unidade) || siglaDaUnidade(l?.servico?.unidade),
        valor_referencia: decimalOuNulo(l?.servico?.valor_referencia),
      }
    : null,
  parceiro: l?.fornecedor_parceiro_id ? { id: String(l.fornecedor_parceiro_id), rotulo: rotuloDoParceiroDaLinha(l) || String(l.fornecedor_parceiro_id) } : null,
  quantidade: paraEdicao(l?.quantidade),
  valor_unitario: paraEdicao(l?.valor_unitario),
  documento_referencia: typeof l?.documento_referencia === 'string' ? l.documento_referencia : '',
  observacao: typeof l?.observacao === 'string' ? l.observacao : '',
});

/** Total da linha de serviço (só leitura). @param {FormularioLinhaServico} form */
export const valorDaLinhaServico = (form) => totalDaLinha(lerDecimal(form?.quantidade, '').valor, lerDecimal(form?.valor_unitario, '').valor);

/**
 * Validação local da linha de serviço (o servidor confere o serviço, a unidade e o papel do parceiro).
 * @param {FormularioLinhaServico} form
 * @returns {Record<string, string>}
 */
export const validarLinhaServico = (form) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!form?.servico?.id) erros.servico = 'Escolha o serviço.';
  const q = lerDecimal(form?.quantidade, 'A quantidade');
  if (q.erro) erros.quantidade = q.erro;
  else if (!q.valor) erros.quantidade = 'Informe a quantidade.';
  else if (!ehPositivo(q.valor)) erros.quantidade = 'Informe uma quantidade maior que zero.';
  const v = lerDecimal(form?.valor_unitario, 'O valor unitário');
  if (v.erro) erros.valor_unitario = v.erro;
  else if (!v.valor) erros.valor_unitario = 'Informe o valor unitário.';
  if (tamanho(texto(form?.documento_referencia)) > MAX_DOCUMENTO_SERVICO) erros.documento_referencia = `No máximo ${MAX_DOCUMENTO_SERVICO} caracteres.`;
  if (tamanho(texto(form?.observacao)) > MAX_OBSERVACAO_LINHA) erros.observacao = `No máximo ${MAX_OBSERVACAO_LINHA} caracteres.`;
  return erros;
};

/**
 * Corpo da linha de serviço (formulário JÁ VALIDADO). A unidade (snapshot) e o total são do servidor.
 * @param {FormularioLinhaServico} form
 */
export const corpoDaLinhaServico = (form) => ({
  servico_id: form.servico?.id ?? null,
  fornecedor_parceiro_id: form.parceiro?.id ?? null,
  quantidade: lerDecimal(form.quantidade, '').valor,
  valor_unitario: lerDecimal(form.valor_unitario, '').valor,
  documento_referencia: texto(form.documento_referencia) || null,
  observacao: texto(form.observacao) || null,
});

// ─── PATCH mínimo das linhas ─────────────────────────────────────────────

const DECIMAIS_DA_LINHA = Object.freeze(['quantidade', 'leitura_inicial', 'leitura_final', 'quantidade_uso', 'custo_unitario', 'valor_unitario']);

/**
 * Só as chaves que mudaram em relação à linha gravada (decimal como decimal, texto aparado, vazio = null).
 * @param {any} linha @param {Record<string, any>} corpo
 * @returns {Record<string, any>}
 */
export const camposAlteradosDaLinha = (linha, corpo) => {
  /** @type {Record<string, any>} */
  const saida = {};
  for (const [campo, valor] of Object.entries(corpo)) {
    const antes = linha?.[campo] ?? null;
    let igual;
    if (DECIMAIS_DA_LINHA.includes(campo)) igual = valor === null || antes === null ? valor === antes : ehCanonico(antes) && ehCanonico(valor) && comparar(valor, antes) === 0;
    else if (typeof valor === 'boolean') igual = valor === (antes === true);
    else igual = (texto(valor) || null) === (texto(antes) || null);
    if (!igual) saida[campo] = valor;
  }
  return saida;
};

/**
 * PATCH mínimo da mão de obra: trocar a medida ou o parceiro com o custo DIGITADO (tarefa ou terceiro) leva sempre o
 * custo (mesmo que igual ao snapshot anterior), para o servidor não herdar o custo do cadastro nem o da linha antiga.
 * @param {any} linha @param {Record<string, any>} corpo
 */
export const camposAlteradosDaLinhaMaoObra = (linha, corpo) => {
  const saida = camposAlteradosDaLinha(linha, corpo);
  const trocou = Object.prototype.hasOwnProperty.call(saida, 'tipo_medida') || Object.prototype.hasOwnProperty.call(saida, 'parceiro_id');
  if (trocou && Object.prototype.hasOwnProperty.call(corpo, 'custo_unitario')) saida.custo_unitario = corpo.custo_unitario;
  return saida;
};

// ─── "Repetir último lançamento" com as linhas ───────────────────────────

/**
 * @typedef {{ chave: string, form: FormularioLinhaProduto }} RascunhoProduto
 * @typedef {{ chave: string, form: FormularioLinhaMaquina }} RascunhoMaquina
 * @typedef {{ chave: string, form: FormularioLinhaMaoObra }} RascunhoMaoObra
 * @typedef {{ chave: string, form: FormularioLinhaServico }} RascunhoServico
 * @typedef {{ produtos: RascunhoProduto[], maquinas: RascunhoMaquina[], mao_obra: RascunhoMaoObra[], servicos: RascunhoServico[] }} RascunhosDoLancamento
 */

/**
 * As linhas CONFIRMADAS da base para o "Repetir": produtos com a mesma quantidade e o mesmo local (o operador ajusta),
 * máquinas com a leitura sugerida de novo, mão de obra e serviços com os mesmos dados (o documento do serviço não).
 * @param {any} base
 * @returns {RascunhosDoLancamento}
 */
export const linhasParaRepetir = (base) => {
  const { produtos, maquinas, mao_obra, servicos } = linhasDoApontamento(base);
  /** @param {any} l */
  const confirmada = (l) => l.status === STATUS_CONFIRMADO;
  return {
    produtos: produtos.filter(confirmada).map((l) => ({ chave: `p-${l.id}`, form: formularioDaLinhaProduto(l) })),
    maquinas: maquinas.filter(confirmada).map((l) => ({ chave: `m-${l.id}`, form: formularioMaquinaDaBase(l) })),
    mao_obra: mao_obra.filter(confirmada).map((l) => ({ chave: `o-${l.id}`, form: formularioMaoObraDaBase(l) })),
    servicos: servicos.filter(confirmada).map((l) => ({ chave: `s-${l.id}`, form: formularioServicoDaBase(l) })),
  };
};

// ─── Totalizador ─────────────────────────────────────────────────────────

/**
 * Totais da atividade (`GET /atividades/:id/totais`) prontos para exibir; sem resposta, a área do cabeçalho.
 * @param {any} totais @param {any} atividade
 */
export const totaisParaExibir = (totais, atividade) => {
  const t = ehObjeto(totais) ? totais : {};
  const executada = formatarDecimalLinha(t.area_executada ?? atividade?.area_executada);
  const planejada = formatarDecimalLinha(t.area_planejada ?? atividade?.area_planejada);
  const unidadeArea = texto(t.unidade_area) || 'ha';
  const area = executada || planejada ? `${executada || '—'} / ${planejada || '—'} ${unidadeArea}` : '—';
  const produtos = (Array.isArray(t.produtos) ? t.produtos : []).filter(ehObjeto).map((p) => ({
    chave: String(p.produto_id ?? p.nome ?? ''),
    nome: texto(p.nome) || texto(p.produto?.nome) || 'Produto',
    quantidade: formatarQuantidadeLinha(p.quantidade, p.unidade) || '—',
    custo: formatarCustoLinha(p.custo_total),
  }));
  const maquinas = (Array.isArray(t.maquinas) ? t.maquinas : []).filter(ehObjeto).map((m) => ({
    chave: `${String(m.bem_id ?? m.nome ?? '')}${m.medidor_unidade ? `-${m.medidor_unidade}` : ''}`,
    nome: texto(m.nome) || rotuloDoBem(m.bem) || 'Máquina',
    uso: formatarUso(m.quantidade_uso, m.medidor_tipo, m.medidor_unidade) || '—',
    custo: formatarCustoLinha(m.custo_total),
  }));
  // D-PROD-208: por parceiro (funcionário ou terceiro) e medida; o terceiro vem marcado no nome.
  const maoObra = (Array.isArray(t.mao_obra) ? t.mao_obra : []).filter(ehObjeto).map((o) => ({
    chave: `${String(o.parceiro_id ?? o.nome ?? '')}${o.origem ? `-${o.origem}` : ''}${o.tipo_medida ? `-${o.tipo_medida}` : ''}`,
    nome: comMarcaDeTerceiro(texto(o.nome) || texto(o.parceiro?.nome) || 'Mão de obra', o),
    quantidade: formatarQuantidadeMaoObra(o.quantidade, o.tipo_medida) || '—',
    custo: formatarCustoLinha(o.custo_total),
  }));
  // O servidor agrupa o serviço por serviço E unidade (o snapshot da linha): a chave também.
  const servicos = (Array.isArray(t.servicos) ? t.servicos : []).filter(ehObjeto).map((v) => ({
    chave: `${String(v.servico_id ?? v.nome ?? '')}${texto(v.unidade) ? `-${texto(v.unidade)}` : ''}`,
    nome: texto(v.nome) || texto(v.servico?.nome) || 'Serviço',
    quantidade: formatarQuantidadeServico(v.quantidade, v.unidade) || '—',
    custo: formatarCustoLinha(v.custo_total ?? v.valor_total),
  }));
  /** @param {unknown} v */
  const positivoOuNulo = (v) => (ehCanonico(v) && ehPositivo(/** @type {string} */ (v)) ? v : null);
  // D-PROD-211: combustível dos abastecimentos CONFIRMADOS ligados à atividade — litros e quilos à parte (nunca se somam).
  const c = ehObjeto(t.combustivel) ? t.combustivel : null;
  const combustivel = c
    ? [formatarQuantidadeLinha(positivoOuNulo(c.quantidade_l), 'L'), formatarQuantidadeLinha(positivoOuNulo(c.quantidade_kg), 'KG'), formatarCustoLinha(c.custo_total)]
        .filter(Boolean)
        .join(' · ') || '—'
    : null;
  // Consumo por bem (L/h, km/L…) pelo uso das linhas de máquina; sem uso ou com L e kg misturados o servidor manda `valor` nulo.
  const consumoPorBem = (Array.isArray(t.consumo_por_bem) ? t.consumo_por_bem : []).filter(ehObjeto).map((b) => {
    // L e kg misturados no mesmo bem: o servidor manda `unidade`/`quantidade` nulos e as parcelas à parte (sem consumo).
    const misturado = !texto(b.unidade) && Boolean(formatarDecimalLinha(b.quantidade_l)) && Boolean(formatarDecimalLinha(b.quantidade_kg));
    const quantidade = misturado
      ? `${formatarQuantidadeLinha(b.quantidade_l, 'L')} e ${formatarQuantidadeLinha(b.quantidade_kg, 'KG')} (litros e quilos não se somam)`
      : formatarQuantidadeLinha(b.quantidade, b.unidade);
    const uso = formatarUso(b.uso, b.medidor_tipo, null);
    const metrica = texto(b.unidade_metrica);
    const valor = ehCanonico(b.valor) ? `${formatarDecimalLinha(b.valor)}${metrica ? ` ${metrica}` : ''}` : '';
    const base = [quantidade, uso ? `em ${uso}` : 'sem uso nas máquinas'].filter(Boolean).join(' ');
    return {
      chave: `${String(b.bem?.id ?? b.bem_id ?? '')}${texto(b.unidade) ? `-${texto(b.unidade)}` : ''}`,
      nome: rotuloDoBem(b.bem) || 'Máquina',
      valor: valor ? `${valor} · ${base}` : base || '—',
    };
  });
  return {
    area,
    produtos,
    maquinas,
    maoObra,
    servicos,
    combustivel,
    custoCombustivelPorHa: c && ehCanonico(t.custo_combustivel_por_ha) ? `${formatarCusto(t.custo_combustivel_por_ha)}/${unidadeArea}` : c ? '—' : null,
    consumoPorBem,
    custo: formatarCustoLinha(t.custo_total) || '—',
    custoPorHa: ehCanonico(t.custo_por_ha) ? `${formatarCusto(t.custo_por_ha)}/${unidadeArea}` : '—',
  };
};

// ─── Resumo do "Concluir atividade" (D-PROD-232) ─────────────────────────

/** "03/11" de um dia "2026-11-03"; vazio fora do formato. @param {unknown} dia */
const diaCurto = (dia) => (typeof dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : '');
/** Moeda com 2 casas ("R$ 463,31"); null sem valor. @param {unknown} v */
const moeda2 = (v) => (ehCanonico(v) ? formatarMoeda(/** @type {string} */ (v), { locale: LOCALE_ATIVIDADE, moeda: 'BRL', casas: 2 }) : null);

/**
 * O resumo do diálogo "Concluir atividade" (protótipo do proprietário, D-PROD-232), SÓ com o que o servidor deu:
 * nada é inventado — sem o valor, o campo vem `null` (a tela mostra "—").
 *  - período: início da atividade → "hoje" (ou o dia escolhido para a conclusão) · dias lançados (`totais.dias_com_apontamento`
 *    do detalhe — dias com apontamento CONFIRMADO);
 *  - área feita / planejada e o percentual (de `GET /atividades/:id/totais`; sem ele, a do cabeçalho), a barra e o que
 *    falta quando a feita é menor que a planejada;
 *  - custo total, custo por hectare e combustível (L e kg à parte), de `/totais`.
 * @param {{ atividade: any, totais?: any, detalhe?: any, hoje: string, dataConclusao?: string }} p
 */
export const resumoParaConcluir = ({ atividade, totais = null, detalhe = null, hoje, dataConclusao = '' }) => {
  const t = ehObjeto(totais) ? totais : null;
  const unidade = texto(t?.unidade_area) || 'ha';
  const inicio = diaCurto(atividade?.data_inicio ?? detalhe?.data_inicio);
  const fim = !dataConclusao || dataConclusao === hoje ? 'hoje' : diaCurto(dataConclusao) || 'hoje';
  const diasBrutos = atividade?.totais?.dias_com_apontamento ?? detalhe?.totais?.dias_com_apontamento;
  const dias = Number.isInteger(diasBrutos) && diasBrutos >= 0 ? /** @type {number} */ (diasBrutos) : null;
  const textoDias = dias === null ? '' : ` · ${dias} ${dias === 1 ? 'dia lançado' : 'dias lançados'}`;
  const periodo = inicio ? `${inicio} → ${fim}${textoDias}` : null;

  // Área: a de /totais (mesmo instante das linhas); sem ela, a do cabeçalho.
  const executada = t && t.area_executada !== undefined ? t.area_executada : atividade?.area_executada;
  const planejada = t && t.area_planejada !== undefined ? t.area_planejada : atividade?.area_planejada;
  const execTxt = formatarDecimalLinha(executada);
  const planTxt = formatarDecimalLinha(planejada);
  const comPlano = ehCanonico(planejada) && ehPositivo(/** @type {string} */ (planejada));
  const execOuZero = ehCanonico(executada) ? /** @type {string} */ (executada) : '0';
  const pct = comPlano ? Number(percentualDe(execOuZero, /** @type {string} */ (planejada), 4, 0)) : null;
  const area = execTxt || planTxt ? `${execTxt || '—'} / ${planTxt || '—'} ${unidade}${pct !== null ? ` (${pct}%)` : ''}` : null;
  const faltaCanonica = comPlano && comparar(execOuZero, /** @type {string} */ (planejada)) < 0 ? subtrair(/** @type {string} */ (planejada), execOuZero, 4) : null;
  const falta = faltaCanonica ? { faltam: formatarDecimalLinha(faltaCanonica), planejada: planTxt, unidade } : null;

  const c = t && ehObjeto(t.combustivel) ? t.combustivel : null;
  /** @param {unknown} v */
  const positivo = (v) => (ehCanonico(v) && ehPositivo(/** @type {string} */ (v)) ? v : null);
  const combustivel = c
    ? [formatarQuantidadeLinha(positivo(c.quantidade_l), 'L'), formatarQuantidadeLinha(positivo(c.quantidade_kg), 'KG')].filter(Boolean).join(' · ') || null
    : null;

  return {
    periodo,
    area,
    barra: pct === null ? null : Math.min(100, Math.max(0, pct)),
    falta,
    custo: t ? moeda2(t.custo_total) : null,
    custoPorHa: t ? moeda2(t.custo_por_ha) : null,
    combustivel,
  };
};

// ─── Recusas do servidor ─────────────────────────────────────────────────

/** Campo da janela que cada coluna recusada destaca (`details.field`). */
export const CAMPO_DA_LINHA = Object.freeze(
  /** @type {Record<string, string>} */ ({
    produto_id: 'produto',
    local_estoque_id: 'local_estoque_id',
    quantidade: 'quantidade',
    bem_id: 'bem',
    implemento_bem_id: 'implemento',
    leitura_inicial: 'leitura_inicial',
    leitura_final: 'leitura_final',
    quantidade_uso: 'quantidade_uso',
    sem_medidor: 'quantidade_uso',
    justificativa_salto: 'justificativa_salto',
    parceiro_id: 'parceiro',
    tipo_medida: 'tipo_medida',
    custo_unitario: 'custo_unitario',
    servico_id: 'servico',
    fornecedor_parceiro_id: 'parceiro',
    valor_unitario: 'valor_unitario',
    documento_referencia: 'documento_referencia',
    observacao: 'observacao',
  }),
);

/** Frase de cada recusa da linha (`ATIVIDADE_LINHA_INVALIDA`, `field` × `reason`). */
const LINHA_INVALIDA = Object.freeze(
  /** @type {Record<string, Record<string, string>>} */ ({
    produto_id: {
      inexistente: 'O produto não foi encontrado nesta fazenda',
      outra_empresa: 'O produto é de outra fazenda',
      inativo: 'O produto está inativo',
      unidade_nao_aceita: 'O estoque deste produto não está em litros (L), quilos (KG) nem sacos (SACO): ele não pode ser lançado',
      combustivel_no_abastecimento: 'Este produto é combustível (aceito por um tanque): lance-o pelo Abastecimento, não pela atividade',
    },
    local_estoque_id: { inexistente: 'O local de estoque não foi encontrado', inativo: 'O local de estoque está inativo' },
    quantidade: {
      quantidade_nao_positiva: 'Informe uma quantidade maior que zero',
      nao_positiva: 'Informe uma quantidade maior que zero',
      obrigatoria: 'Informe a quantidade',
      custo_excede_limite: 'O total da linha (quantidade × unitário) passa do limite permitido',
    },
    bem_id: {
      inexistente: 'A máquina não foi encontrada nesta fazenda',
      inativo: 'A máquina está inativa',
      outra_empresa: 'A máquina é de outra fazenda',
      natureza: 'O bem escolhido não é máquina, veículo nem equipamento',
    },
    implemento_bem_id: {
      igual_a_maquina: 'O implemento não pode ser a própria máquina',
      natureza: 'O bem escolhido como implemento não é um implemento',
      inexistente: 'O implemento não foi encontrado nesta fazenda',
      outra_empresa: 'O implemento é de outra fazenda',
      inativo: 'O implemento está inativo',
      nao_permitido: 'O tipo desta atividade não permite implemento',
    },
    leitura_inicial: {
      obrigatoria: 'Informe a leitura inicial do medidor',
      abaixo_da_vigente: 'A leitura inicial está abaixo da leitura vigente do medidor nesta data: o medidor não anda para trás',
      nao_aceita: 'A linha sem medidor não leva leitura',
    },
    leitura_final: {
      obrigatoria: 'Informe a leitura final do medidor',
      menor_que_inicial: 'A leitura final é menor que a inicial: o medidor não anda para trás',
      abaixo_da_vigente: 'A leitura final está abaixo da leitura vigente do medidor nesta data: o medidor não anda para trás',
      acima_de_posterior: 'A leitura final passa de uma leitura posterior já registrada para este medidor',
      nao_aceita: 'A linha sem medidor não leva leitura',
    },
    quantidade_uso: {
      obrigatoria: 'Informe as horas ou o km de uso',
      nao_aceita: 'Com medidor, o uso é calculado pelas leituras (final − inicial): não informe o uso',
      nao_positiva: 'O uso deve ser maior que zero',
      quantidade_nao_positiva: 'O uso deve ser maior que zero',
    },
    sem_medidor: { medidor_obrigatorio: 'A máquina não tem medidor: lance com "sem medidor", informando as horas ou o km' },
    justificativa_salto: { curta: 'A justificativa do salto precisa de pelo menos 3 caracteres', longa: 'A justificativa do salto pode ter no máximo 500 caracteres' },
    parceiro_id: { obrigatorio: 'Escolha o funcionário ou terceiro' },
    tipo_medida: { obrigatorio: 'Escolha a medida: hora, diária ou tarefa', formato: 'Escolha a medida: hora, diária ou tarefa', invalido: 'Escolha a medida: hora, diária ou tarefa' },
    custo_unitario: {
      obrigatorio: 'Informe o custo unitário (na tarefa e para terceiro ele é digitado)',
      obrigatoria: 'Informe o custo unitário (na tarefa e para terceiro ele é digitado)',
      nao_aceito: 'Na hora e na diária do funcionário o custo vem do cadastro dele: não informe o custo',
      nao_aceita: 'Na hora e na diária do funcionário o custo vem do cadastro dele: não informe o custo',
      negativo: 'O custo unitário não pode ser negativo',
    },
    servico_id: {
      obrigatorio: 'Escolha o serviço',
      inexistente: 'O serviço não foi encontrado nesta fazenda',
      outra_empresa: 'O serviço é de outra fazenda',
      inativo: 'O serviço está inativo',
    },
    valor_unitario: { obrigatorio: 'Informe o valor unitário', obrigatoria: 'Informe o valor unitário', negativo: 'O valor unitário não pode ser negativo' },
    documento_referencia: { longo: 'O documento pode ter no máximo 120 caracteres', longa: 'O documento pode ter no máximo 120 caracteres' },
    corpo: { sem_alteracao: 'Os dados são os mesmos da linha gravada: não há o que alterar' },
  }),
);

/**
 * Recusa uniforme por campo (sem revelar o porquê): o parceiro do serviço só é aceito se for prestador de serviço
 * ativo desta fazenda — o servidor não diz se o id existe.
 */
const LINHA_INVALIDA_DO_CAMPO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    fornecedor_parceiro_id: 'O parceiro escolhido não pode ser usado: ele precisa ser um prestador de serviço ativo desta fazenda',
    // D-PROD-208: o funcionário ou terceiro da mão de obra (parceiro ativo com o papel funcionário ou prestador de serviço).
    parceiro_id: 'O funcionário ou terceiro escolhido não pode ser usado: ele precisa ser um parceiro ativo desta fazenda com o papel funcionário ou prestador de serviço',
  }),
);

/** Por que o estorno exato foi recusado (`ATIVIDADE_ESTORNO_BLOQUEADO`, `details.reason`). */
const ESTORNO_BLOQUEADO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    produto_mudou_de_fazenda: 'o produto desta linha mudou de fazenda',
    unidade_mudou: 'a unidade de estoque do produto mudou desde o lançamento',
    movimento_inexistente: 'o movimento de saída desta linha não existe mais',
    movimento_estornado: 'o movimento de saída desta linha já foi estornado',
    fatias_inconsistentes: 'os lotes gravados não somam a quantidade da linha',
    lote_indisponivel_para_devolucao: 'um lote de onde o produto saiu não pode receber a devolução (estornado, transferido ou removido)',
    devolucao_excede_entrada: 'a devolução passaria da entrada de um lote de onde o produto saiu (ele já foi consumido)',
    estoque_excede_limite: 'a devolução passaria do limite do estoque',
    vinculo_divergente: 'o movimento de saída desta linha é de outro produto ou outra fazenda',
    camada_divergente: 'um lote de onde o produto saiu é de outro produto, outra fazenda ou outro local',
    lote_indisponivel: 'um lote de onde o produto saiu já foi consumido ou transferido',
  }),
);

/** "disponível 3 L, pedido 5 L". @param {unknown} v @param {string} u */
const comUnidade = (v, u) => `${formatarDecimalLinha(v) || String(v ?? '')}${u ? ` ${u}` : ''}`;

/**
 * Mensagem clara da recusa de uma escrita de linha (ou do apontamento com linhas). Os códigos da Fatia 3 primeiro;
 * o resto cai no Lançamento de Atividades e no catálogo de Gestão.
 * @param {unknown} erro @param {string} fallback
 * @param {{ unidade?: string|null, medidorUnidade?: string|null }} [ctx] unidade do produto e do medidor da linha
 */
export const mensagemDeErroLinha = (erro, fallback, ctx = {}) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  const u = rotuloDaUnidade(details.unidade) || rotuloDaUnidade(ctx.unidade) || '';
  const um = rotuloDaUnidadeDoMedidor(null, details.medidor_unidade) || texto(ctx.medidorUnidade);
  switch (code) {
    case 'ESTOQUE_SALDO_INSUFICIENTE':
      if (reason === 'estoque_atual_insuficiente') return 'O estoque atual do produto é menor que o pedido. Nada foi gravado.';
      return details.disponivel != null
        ? `Saldo insuficiente deste produto no local escolhido: disponível ${comUnidade(details.disponivel, u)}, pedido ${comUnidade(details.solicitado, u)}. Nada foi gravado.`
        : 'Saldo insuficiente deste produto no local escolhido. Nada foi gravado.';
    case 'ATIVIDADE_SALTO_MEDIDOR': {
      const uso = details.quantidade_uso != null ? ` (${comUnidade(details.quantidade_uso, um)})` : '';
      const teto = details.salto_maximo != null ? ` (${comUnidade(details.salto_maximo, um)})` : '';
      // O salto conta da leitura vigente: com a inicial digitada acima dela, o medidor anda mais que o uso.
      if (ehCanonico(details.salto) && ehCanonico(details.quantidade_uso) && comparar(details.salto, details.quantidade_uso) !== 0) {
        const desde = ehCanonico(details.leitura_vigente) ? ` desde a última leitura (${formatarDecimalLinha(details.leitura_vigente)})` : '';
        return `O medidor anda ${comUnidade(details.salto, um)}${desde} neste lançamento e passa do teto de salto${teto}. Confira a leitura inicial ou informe a justificativa (3 a 500 caracteres) e envie de novo. Nada foi gravado.`;
      }
      return `O uso da máquina${uso} passa do teto de salto do medidor${teto}. Informe a justificativa (3 a 500 caracteres) e envie de novo. Nada foi gravado.`;
    }
    case 'ATIVIDADE_LINHA_INVALIDA': {
      const frase = LINHA_INVALIDA[field ?? '']?.[reason ?? ''] ?? LINHA_INVALIDA_DO_CAMPO[field ?? ''];
      return `${frase ?? 'A linha foi recusada: confira os dados da linha (produto, máquina, mão de obra ou serviço)'}. Nada foi gravado.`;
    }
    case 'ATIVIDADE_LINHA_NOT_FOUND':
      return 'Esta linha não foi encontrada neste apontamento. Os lançamentos serão relidos. Nada foi alterado.';
    case 'ATIVIDADE_ESTORNO_BLOQUEADO':
    case 'ESTOQUE_JA_CONSUMIDO':
      return `O estorno exato do produto não é seguro agora: ${ESTORNO_BLOQUEADO[reason ?? ''] ?? 'o lote de onde ele saiu já foi consumido, transferido ou mudou'}. Nada foi alterado.`;
    case 'ATIVIDADE_DATA_COM_LINHAS':
      return 'A data do apontamento não muda com linha de produto, máquina, mão de obra ou serviço confirmada: cancele o apontamento e lance de novo. Nada foi gravado.';
    case 'ATIVIDADE_EXIGIDA_PELO_TIPO':
      if (reason === 'permite_produto' || field === 'produtos') return 'O tipo desta atividade não permite produto. Nada foi gravado.';
      if (reason === 'permite_implemento' || field === 'implemento_bem_id') return 'O tipo desta atividade não permite implemento. Nada foi gravado.';
      if (reason === 'permite_mao_obra' || field === 'mao_obra') return 'O tipo desta atividade não permite mão de obra. Nada foi gravado.';
      if (reason === 'permite_servico' || field === 'servicos') return 'O tipo desta atividade não permite serviço. Nada foi gravado.';
      return mensagemDeErroAtividade(erro, fallback);
    case 'MEDIDOR_LEITURA_REGRESSIVA':
      return `A leitura é menor que a registrada${details.data_referencia ? ` em ${formatarDiaAbastecimento(details.data_referencia)}` : ''}${
        details.leitura_referencia != null ? ` (${comUnidade(details.leitura_referencia, um)})` : ''
      }: o medidor não anda para trás. Nada foi gravado.`;
    case 'MEDIDOR_LEITURA_ACIMA_POSTERIOR':
      return `A leitura é maior que a registrada depois${details.data_posterior ? `, em ${formatarDiaAbastecimento(details.data_posterior)}` : ''}${
        details.leitura_posterior != null ? ` (${comUnidade(details.leitura_posterior, um)})` : ''
      }. Nada foi gravado.`;
    case 'IDEMPOTENCY_CONFLICT':
      return 'Este envio já foi usado com outro conteúdo. Feche, confira as linhas do apontamento e lance de novo. Nada foi gravado.';
    case 'IDEMPOTENCY_IN_PROGRESS':
      return 'O mesmo envio ainda está sendo processado. Aguarde alguns segundos e consulte: ele não será duplicado.';
    case 'CONCURRENCY_CONFLICT':
      return 'Outra operação mexia nos mesmos dados ao mesmo tempo. Nada foi gravado. Repita o mesmo envio: ele não será duplicado.';
    default:
      return mensagemDeErroAtividade(erro, fallback);
  }
};

/**
 * A edição foi recusada por não mudar nada (`ATIVIDADE_LINHA_INVALIDA`, `reason: sem_alteracao`)? A janela trata
 * como "Sem alterações" (o mesmo de quando ela nem envia).
 * @param {unknown} erro
 */
export const ehSemAlteracaoDaLinha = (erro) => {
  const { code, reason } = lerErroGestao(erro);
  return code === 'ATIVIDADE_LINHA_INVALIDA' && reason === 'sem_alteracao';
};

/** Campo da janela que a recusa aponta, ou null (o salto aponta a justificativa). @param {unknown} erro */
export const campoDaLinhaRecusada = (erro) => {
  const { code, field } = lerErroGestao(erro);
  if (code === 'ATIVIDADE_SALTO_MEDIDOR') return 'justificativa_salto';
  if (code === 'ESTOQUE_SALDO_INSUFICIENTE') return 'quantidade';
  if (code === 'MEDIDOR_LEITURA_REGRESSIVA' || code === 'MEDIDOR_LEITURA_ACIMA_POSTERIOR') return field === 'leitura_inicial' ? 'leitura_inicial' : 'leitura_final';
  if (code === 'ATIVIDADE_LINHA_INVALIDA' || code === 'ATIVIDADE_EXIGIDA_PELO_TIPO') return CAMPO_DA_LINHA[field ?? ''] ?? null;
  return null;
};

/** Coleções das linhas embutidas no corpo da criação do apontamento. */
const COLECOES_EMBUTIDAS = Object.freeze(['produtos', 'maquinas', 'mao_obra', 'servicos']);
/** A coleção de cada `details.entidade` das recusas de linha. */
const COLECAO_DA_ENTIDADE = Object.freeze(
  /** @type {Record<string, string>} */ ({ linha_maquina: 'maquinas', linha_mao_obra: 'mao_obra', linha_servico: 'servicos', linha_produto: 'produtos' }),
);

/**
 * Qual linha embutida (no corpo da criação do apontamento) a recusa aponta:
 * `{ colecao: 'produtos'|'maquinas'|'mao_obra'|'servicos', indice }` (0-based), ou null.
 * @param {unknown} erro
 */
export const linhaEmbutidaRecusada = (erro) => {
  const { details } = lerErroGestao(erro);
  // Máquina, mão de obra e serviço: `details.linha_indice` com `details.entidade` (`linha_maquina`, `linha_mao_obra`,
  // `linha_servico`); produto: `details.colecao = 'produtos'` + `details.indice`.
  const daEntidade = COLECAO_DA_ENTIDADE[String(details.entidade ?? '')] ?? null;
  const colecao = typeof details.colecao === 'string' && COLECOES_EMBUTIDAS.includes(details.colecao) ? details.colecao : daEntidade;
  const indice = Number.isInteger(details.indice) ? details.indice : Number.isInteger(details.linha_indice) ? details.linha_indice : null;
  if (indice === null) return null;
  if (colecao) return { colecao, indice: /** @type {number} */ (indice) };
  return Number.isInteger(details.linha_indice) ? { colecao: LINHA_MAQUINA, indice: /** @type {number} */ (details.linha_indice) } : null;
};

/** É o pedido de justificativa do salto do medidor? @param {unknown} erro */
export const ehSaltoDoMedidor = (erro) => lerErroGestao(erro).code === 'ATIVIDADE_SALTO_MEDIDOR';

/** O status da linha para o selo (CONFIRMADO | CANCELADO). @param {any} l */
export const statusDaLinha = (l) => (l?.status === STATUS_CANCELADO ? STATUS_CANCELADO : STATUS_CONFIRMADO);

// ─── Janela por tipo de lançamento (D-PROD-233) ──────────────────────────

/** O campo do valor de cada tipo de linha (o serviço tem `valor_total`; os outros, `custo_total`). */
export const CAMPO_DO_VALOR_DA_LINHA = Object.freeze(
  /** @type {Record<string, 'custo_total'|'valor_total'>} */ ({
    [LINHA_PRODUTO]: 'custo_total',
    [LINHA_MAQUINA]: 'custo_total',
    [LINHA_MAO_OBRA]: 'custo_total',
    [LINHA_SERVICO]: 'valor_total',
  }),
);

/**
 * Soma do valor das linhas CONFIRMADAS de um tipo, em texto canônico (4 casas), só com o que o servidor devolveu:
 * linha sem valor (ex.: máquina sem custo de uso no cadastro) não entra; nenhuma com valor = null (a janela mostra "—").
 * @param {any[]} linhas @param {string} tipo
 * @returns {string|null}
 */
export const totalDasLinhas = (linhas, tipo) => {
  const campo = CAMPO_DO_VALOR_DA_LINHA[tipo] ?? 'custo_total';
  const valores = (Array.isArray(linhas) ? linhas : [])
    .filter((l) => statusDaLinha(l) === STATUS_CONFIRMADO)
    .map((l) => l?.[campo])
    .filter((v) => ehCanonico(v));
  return valores.length ? somar(valores, 4) : null;
};

/** "Manhã · 2ª passada" (o seletor da janela por tipo quando o dia tem mais de um lançamento). @param {any} ap */
export const rotuloDoLancamentoNoDia = (ap) => [rotuloDoTurno(ap?.turno), rotuloDaPassada(ap?.sequencia)].filter(Boolean).join(' · ') || 'Lançamento';

// ─── Atividade aberta no desenho do protótipo (D-PROD-234) ───────────────

/** Moeda com 2 casas para a atividade aberta ("R$ 4.262,47"); vazio sem valor. @param {unknown} v */
export const formatarMoedaAtividade = (v) => moeda2(v) ?? '';

/**
 * As linhas CONFIRMADAS de UM tipo em TODOS os lançamentos CONFIRMADOS da atividade (todos os dias): a mesma regra dos
 * totais do servidor (linha cancelada ou de lançamento cancelado não conta).
 * @param {any[]} apontamentos @param {string} tipo
 */
export const linhasConfirmadasDaAtividade = (apontamentos, tipo) =>
  (Array.isArray(apontamentos) ? apontamentos : [])
    .filter((ap) => ehObjeto(ap) && ap.status === STATUS_CONFIRMADO)
    .flatMap((ap) => linhasDoTipo(ap, tipo).filter((l) => statusDaLinha(l) === STATUS_CONFIRMADO));

/**
 * Soma de uma quantidade por unidade, na ordem em que a unidade aparece: `[[unidade, total canônico]]`.
 * @param {any[]} linhas @param {(l: any) => unknown} quantidade @param {(l: any) => string} unidade
 */
const somaPorUnidade = (linhas, quantidade, unidade) => {
  /** @type {Map<string, string[]>} */
  const porUnidade = new Map();
  for (const l of linhas) {
    const q = quantidade(l);
    if (!ehCanonico(q)) continue;
    const u = unidade(l);
    porUnidade.set(u, [...(porUnidade.get(u) ?? []), /** @type {string} */ (q)]);
  }
  return [...porUnidade.entries()].map(([u, qs]) => /** @type {[string, string]} */ ([u, somar(qs, 4)]));
};

/** "NPK 20-05-20" ou "NPK 20-05-20 (+2)": o primeiro nome e quantos outros DIFERENTES. @param {string[]} nomes */
const primeiroEMais = (nomes) => {
  const unicos = [...new Set(nomes.filter(Boolean))];
  if (!unicos.length) return '';
  return unicos.length > 1 ? `${unicos[0]} (+${unicos.length - 1})` : unicos[0];
};

/**
 * O resumo curto de um tipo na tabela "Lançamentos" da atividade aberta (protótipo do proprietário), SÓ com o que as
 * linhas gravadas e os totais do servidor têm — sem linha, vazio (a tela oferece "+ Lançar"):
 *  - máquinas: o uso somado por unidade do medidor ("5 h", "5 h · 120 km") e os litros de combustível dos
 *    abastecimentos ligados (`totais.combustivel.quantidade_l`, "43 L");
 *  - insumos: o primeiro produto e quantos outros ("NPK 20-05-20 (+1)");
 *  - mão de obra: quantas pessoas (parceiros distintos) e a quantidade por medida ("1 pessoa · 5 h");
 *  - custos extras: quantos itens ("2 itens").
 * @param {string} tipo @param {any[]} linhas (as CONFIRMADAS do tipo na atividade) @param {any} [totais]
 */
export const resumoDoTipoNaAtividade = (tipo, linhas, totais = null) => {
  const ls = Array.isArray(linhas) ? linhas : [];
  if (!ls.length) return '';
  if (tipo === LINHA_MAQUINA) {
    const usos = somaPorUnidade(ls, (l) => l?.quantidade_uso, (l) => rotuloDaUnidadeDoMedidor(l?.medidor_tipo, l?.medidor_unidade))
      .map(([u, q]) => (u ? `${formatarDecimalLinha(q)} ${u}` : formatarDecimalLinha(q)));
    const c = ehObjeto(totais) && ehObjeto(totais.combustivel) ? totais.combustivel : null;
    const litros = c && ehCanonico(c.quantidade_l) && ehPositivo(c.quantidade_l) ? formatarQuantidadeLinha(c.quantidade_l, 'L') : '';
    return [...usos, litros].filter(Boolean).join(' · ') || `${ls.length} ${ls.length === 1 ? 'máquina' : 'máquinas'}`;
  }
  if (tipo === LINHA_PRODUTO) return primeiroEMais(ls.map((l) => rotuloDoProdutoDaLinha(l))) || `${ls.length} ${ls.length === 1 ? 'insumo' : 'insumos'}`;
  if (tipo === LINHA_MAO_OBRA) {
    const pessoas = new Set(ls.map((l) => String(l?.parceiro_id ?? l?.parceiro?.id ?? rotuloDaMaoObraDaLinha(l)))).size;
    const qtds = somaPorUnidade(ls, (l) => l?.quantidade, (l) => String(l?.tipo_medida ?? '')).map(([m, q]) => formatarQuantidadeMaoObra(q, m));
    return [`${pessoas} ${pessoas === 1 ? 'pessoa' : 'pessoas'}`, ...qtds].filter(Boolean).join(' · ');
  }
  return `${ls.length} ${ls.length === 1 ? 'item' : 'itens'}`;
};

/**
 * O valor de um tipo na atividade aberta, da parcela que o servidor calcula (`totais.custo_por_tipo`, D-PROD-234).
 * "Trabalho de máquinas" leva também o combustível dos abastecimentos ligados aos dias (no protótipo, o diesel é da
 * máquina): assim a soma dos quatro tipos é o custo total. Sem a parcela (nenhuma linha com custo), null ("—").
 * @param {string} tipo @param {any} totais
 * @returns {string|null}
 */
export const valorDoTipoNaAtividade = (tipo, totais) => {
  const p = ehObjeto(totais) && ehObjeto(totais.custo_por_tipo) ? totais.custo_por_tipo : null;
  if (!p) return null;
  /** @param {unknown} v */
  const canonico = (v) => (ehCanonico(v) ? /** @type {string} */ (v) : null);
  if (tipo === LINHA_MAQUINA) {
    const partes = [canonico(p.maquinas), canonico(p.combustivel)].filter((v) => v !== null);
    return partes.length ? somar(/** @type {string[]} */ (partes), 4) : null;
  }
  if (tipo === LINHA_PRODUTO) return canonico(p.produtos);
  if (tipo === LINHA_MAO_OBRA) return canonico(p.mao_obra);
  if (tipo === LINHA_SERVICO) return canonico(p.servicos);
  return null;
};

/**
 * O card "Resumo de custo" da atividade aberta (protótipo do proprietário), SÓ com o que o servidor deu
 * (`GET /atividades/:id/totais` e o cabeçalho): sem o valor, "—". Área executada / planejada e o % feito; custo total e
 * por hectare; o valor de cada tipo (`valorDoTipoNaAtividade`); combustível em litros (e quilos, à parte) e litros por
 * hectare (`litros_combustivel_por_ha`: litros ÷ área executada, do servidor); data de início e safra.
 * @param {{ totais?: any, atividade: any }} p
 */
export const resumoDeCustoParaExibir = ({ totais = null, atividade }) => {
  const t = ehObjeto(totais) ? totais : null;
  const executada = t && t.area_executada !== undefined ? t.area_executada : atividade?.area_executada;
  const planejada = t && t.area_planejada !== undefined ? t.area_planejada : atividade?.area_planejada;
  const execTxt = formatarDecimalLinha(executada);
  const planTxt = formatarDecimalLinha(planejada);
  const unidade = texto(t?.unidade_area) || 'ha';
  const comPlano = ehCanonico(planejada) && ehPositivo(/** @type {string} */ (planejada));
  const feito = comPlano ? `${percentualDe(ehCanonico(executada) ? /** @type {string} */ (executada) : '0', /** @type {string} */ (planejada), 4, 0)}%` : '—';
  const c = t && ehObjeto(t.combustivel) ? t.combustivel : null;
  /** @param {unknown} v */
  const positivo = (v) => (ehCanonico(v) && ehPositivo(/** @type {string} */ (v)) ? v : null);
  const combustivel = c ? [formatarQuantidadeLinha(positivo(c.quantidade_l), 'L'), formatarQuantidadeLinha(positivo(c.quantidade_kg), 'KG')].filter(Boolean).join(' · ') : '';
  const lHa = t && ehCanonico(t.litros_combustivel_por_ha)
    ? `${formatarNumero(/** @type {string} */ (t.litros_combustivel_por_ha), { locale: LOCALE_ATIVIDADE, casasMin: 0, casasMax: 2 })} L/${unidade}`
    : '';
  return {
    area: execTxt || planTxt ? `${execTxt || '—'} / ${planTxt || '—'} ${unidade}` : '—',
    feito,
    custo: t ? moeda2(t.custo_total) ?? '—' : '—',
    custoPorHa: t ? moeda2(t.custo_por_ha) ?? '—' : '—',
    maquinas: formatarMoedaAtividade(valorDoTipoNaAtividade(LINHA_MAQUINA, t)) || '—',
    produtos: formatarMoedaAtividade(valorDoTipoNaAtividade(LINHA_PRODUTO, t)) || '—',
    maoObra: formatarMoedaAtividade(valorDoTipoNaAtividade(LINHA_MAO_OBRA, t)) || '—',
    servicos: formatarMoedaAtividade(valorDoTipoNaAtividade(LINHA_SERVICO, t)) || '—',
    combustivel: combustivel || '—',
    combustivelPorHa: lHa || '—',
    data: formatarDiaAtividade(atividade?.data_inicio) || '—',
    safra: texto(atividade?.safra_ciclo) || '—',
  };
};
