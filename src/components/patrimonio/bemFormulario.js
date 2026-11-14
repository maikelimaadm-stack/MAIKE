/**
 * Estado do formulário do Bem Patrimonial (D-PROD-157, simplificado pela
 * D-PROD-162: sem medições físicas; e pela D-PROD-169: o bem escolhe o "Tipo
 * de bem" — a natureza — e o Tipo, sem família, Área nem Localização; cada
 * tanque aceita Produtos do estoque da fazenda em L, KG ou SACO) — funções
 * PURAS, sem React: do detalhe do servidor (A13) para o estado da tela (textos
 * localizados), validação local e do estado para a forma do corpo que o
 * `bemPatrimonialService` envia (POST completo ou PATCH mínimo).
 *
 * Números digitados são TEXTO em pt-BR ("1.250,5") e só viram decimal
 * canônico ("1250.5") na conversão, com `lerNumeroLocal` (sem float). Campos
 * que a natureza não admite (matriz §2) nunca vão preenchidos: a conversão os
 * zera, mesmo que a pessoa tenha digitado antes de trocar o Tipo de bem.
 */

import { comparar, lerNumeroLocal, paraTextoDeEdicao, somar } from '@/lib/dinheiroDecimal';
import { MAX_PRODUTOS_POR_TANQUE, UNIDADES_ESTOQUE_TANQUE, campoAplicavel, capacidadesDaNatureza, ehMedidorContador, ehNatureza } from '@/lib/patrimonioDominio';
import { lerInteiro, textoDoInteiro } from '@/components/patrimonio/PatrimonioFormParts';

export const LOCALE_BEM = 'pt-BR';

/** Limites dos campos decimais (mesmos patterns do servidor, A1). */
export const LIMITES_BEM = Object.freeze({
  DINHEIRO: Object.freeze({ casas: 2, inteiros: 14 }),
  MEDIDA: Object.freeze({ casas: 4, inteiros: 10 }),
  CONTAGEM: Object.freeze({ casas: 0, inteiros: 10 }),
  PERCENTUAL: Object.freeze({ casas: 4, inteiros: 3 }),
});

export const LIMITE_TANQUES_ATIVOS = 10;

/**
 * D-PROD-201: tipos de bem que entram como máquina no Lançamento de Atividades
 * e por isso têm "Custo por hora/km" (snapshot na linha de máquina).
 */
export const NATUREZAS_COM_CUSTO_DE_USO = Object.freeze(['MAQUINA', 'VEICULO', 'EQUIPAMENTO']);
/** @param {unknown} natureza */
export const usaCustoDeUso = (natureza) => typeof natureza === 'string' && NATUREZAS_COM_CUSTO_DE_USO.includes(natureza);
/** Produtos aceitos ativos por tanque (P-02). */
export const LIMITE_PRODUTOS_POR_TANQUE = MAX_PRODUTOS_POR_TANQUE;

/** Prefixo das consultas de opções do patrimônio (o cadastro rápido e o "Gerenciar tipos" invalidam por ele). */
export const CHAVE_OPCOES_PATRIMONIO = Object.freeze(['lancamentos-financeiros-gestao', 'opcoes', 'patrimonio']);

export const ABAS_BEM = Object.freeze({
  IDENTIFICACAO: 'identificacao',
  OPERACAO: 'operacao',
  AQUISICAO: 'aquisicao',
});

const PADRAO_CODIGO_FROTA = /^[A-Z0-9]+([ -][A-Z0-9]+)*$/;
const PADRAO_PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const PADRAO_CHASSI = /^[A-HJ-NPR-Z0-9]{17}$/;
const PADRAO_RENAVAM = /^\d{9,11}$/;

/**
 * @typedef {{ id: string, rotulo: string }} Referencia
 * @typedef {{ id: string, rotulo: string, unidade: string|null, ativo: boolean }} ProdutoDoTanque Produto aceito (`ativo` = situação do PRODUTO)
 * @typedef {{ chave: string, id: string|null, identificador: string, capacidade: string, observacao: string, ativo: boolean, produtos: ProdutoDoTanque[] }} TanqueForm
 * @typedef {{ tipo: string, leitura_inicial: string, leitura_atual: string, data_leitura: string }} MedidorForm
 * @typedef {{ data_aquisicao: string, data_disponibilidade: string, valor_aquisicao: string, custo_incorporacao: string, fornecedor: Referencia|null, documento_referencia: string, garantia_ate: string }} AquisicaoForm
 * @typedef {{ depreciavel: boolean, vida: string, vidaUnidade: 'MESES'|'ANOS', residual_modo: 'VALOR'|'PERCENTUAL', valor_residual: string, residual_percentual: string, data_inicio_depreciacao: string }} DepreciacaoForm
 * @typedef {{
 *   nome: string, codigo_frota: string,
 *   natureza: string, tipo: Referencia|null,
 *   propriedade: string, proprietario: Referencia|null, responsavel: Referencia|null, centro_custo: Referencia|null,
 *   marca: string, modelo: string, ano_fabricacao: string, ano_modelo: string,
 *   numero_serie: string, chassi: string, placa: string, placa_uf: string, renavam: string, potencia_cv: string, custo_uso_unitario: string,
 *   material: string, ano_conclusao: string, compatibilidade: string, especificacoes: string, observacoes: string,
 *   medidor: MedidorForm, tanques: TanqueForm[], aquisicao: AquisicaoForm, depreciacao: DepreciacaoForm,
 * }} EstadoBem
 * @typedef {{ editando: boolean, medidorOriginal: any, hoje: string, medidorOperacional?: { leitura: string, data: string, abastecimento_id?: string|null, origem?: string, linha_maquina_id?: string } | null }} ContextoBem
 */

let sequencia = 0;
/** Chave estável de linha nova (tanque). @param {string} prefixo */
export const novaChave = (prefixo) => {
  sequencia += 1;
  return `${prefixo}-novo-${sequencia}`;
};

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/** Decimal canônico do servidor → texto de edição em pt-BR. @param {unknown} v @param {number} [casasMin] */
export const textoDecimal = (v, casasMin = 0) => (typeof v === 'string' && v.trim() ? paraTextoDeEdicao(v, LOCALE_BEM, { casasMin, casasMax: 4 }) : '');

/**
 * Texto digitado → decimal canônico. Vazio = `null` (válido).
 * @param {unknown} valor @param {{ casas: number, inteiros: number }} limites
 * @returns {{ ok: true, valor: string|null } | { ok: false, motivo: string }}
 */
export const lerDecimal = (valor, limites) => {
  if (!texto(valor).trim()) return { ok: true, valor: null };
  const r = lerNumeroLocal(valor, LOCALE_BEM, limites);
  return r.ok ? { ok: true, valor: /** @type {string} */ (r.valor) } : { ok: false, motivo: r.motivo ?? 'formato' };
};

/** @param {unknown} t */
export const normalizarCodigoFrota = (t) => texto(t).trim().toUpperCase().replace(/\s+/g, ' ');
/** "abc-1d23" → "ABC1D23" (mesma normalização do servidor). @param {unknown} t */
export const normalizarPlaca = (t) => texto(t).trim().toUpperCase().replace(/[\s-]/g, '');

/** @param {any} o @param {unknown} [rotulo] @returns {Referencia|null} */
const referencia = (o, rotulo = o?.nome) => (o && typeof o === 'object' && o.id ? { id: String(o.id), rotulo: texto(rotulo) } : null);

/** "12 · Manutenção" para centro de custo. @param {any} c */
export const rotuloDoCentro = (c) => (c?.numero != null && c.numero !== '' ? `${c.numero} · ${texto(c.nome)}` : texto(c?.nome));

/**
 * Produto aceito pelo tanque a partir do detalhe (`tanques[i].produtos[j]`:
 * `{produto_id, nome, codigo_interno, unidade_principal_estoque, produto_ativo}`)
 * ou de uma opção do seletor (`{id, nome, codigo_interno, unidade_principal_estoque}`).
 * @param {any} p @returns {ProdutoDoTanque|null}
 */
export const produtoDoTanque = (p) => {
  const id = p?.produto_id ?? p?.id;
  if (typeof id !== 'string' || !id) return null;
  const unidade = typeof p.unidade_principal_estoque === 'string' && p.unidade_principal_estoque ? p.unidade_principal_estoque : null;
  return { id, rotulo: texto(p.nome), unidade, ativo: p.produto_ativo !== false && p.ativo !== false };
};

/** O Produto aceito ainda serve para abastecer pela tela (ativo e em L, KG ou SACO)? @param {ProdutoDoTanque} p */
export const produtoUtilizavel = (p) => p.ativo && typeof p.unidade === 'string' && UNIDADES_ESTOQUE_TANQUE.includes(p.unidade);

/**
 * Estado inicial a partir do DETALHE (A13). Sem detalhe = bem novo. Ao
 * duplicar, sai sem o que identifica o bem físico (código de frota, série,
 * chassi, placa, renavam), sem leituras do medidor, sem ids de tanques e só
 * com os tanques ativos. O inativo é legível no registro, mas não é escolhido
 * para um bem novo: a cópia sai sem o tipo inativo (ou de família inativa) e
 * só com os Produtos aceitos que ainda servem (ativos, em L, KG ou SACO) — o
 * servidor recusaria os outros num bem novo. O Tipo de bem (natureza) vem do
 * detalhe (ou da família dele, nos detalhes antigos).
 * @param {any} detalhe @param {{ duplicar?: boolean }} [opcoes]
 * @returns {EstadoBem}
 */
export const estadoInicialDoBem = (detalhe, { duplicar = false } = {}) => {
  const d = detalhe && typeof detalhe === 'object' ? detalhe : {};
  /** Na cópia, referência inativa não vem marcada. @param {any} ref */
  const usavel = (ref) => !duplicar || ref?.ativo !== false;
  const natureza = ehNatureza(d.natureza) ? d.natureza : ehNatureza(d.familia?.natureza) ? d.familia.natureza : '';
  const medidor = d.medidor && typeof d.medidor === 'object' ? d.medidor : null;
  const aq = d.aquisicao && typeof d.aquisicao === 'object' ? d.aquisicao : {};
  const dp = d.depreciacao && typeof d.depreciacao === 'object' ? d.depreciacao : {};
  const meses = Number.isInteger(dp.vida_util_meses) ? dp.vida_util_meses : null;
  const emAnos = meses === null || meses % 12 === 0;
  const identidade = (/** @type {string} */ campo) => (duplicar ? '' : texto(d[campo]));
  return {
    nome: texto(d.nome),
    codigo_frota: identidade('codigo_frota'),
    natureza,
    tipo: duplicar && (!usavel(d.tipo) || !usavel(d.familia)) ? null : referencia(d.tipo),
    propriedade: texto(d.propriedade) || 'PROPRIO',
    proprietario: referencia(d.proprietario),
    responsavel: referencia(d.responsavel),
    centro_custo: d.centro_custo?.id ? { id: String(d.centro_custo.id), rotulo: rotuloDoCentro(d.centro_custo) } : null,
    marca: texto(d.marca),
    modelo: texto(d.modelo),
    ano_fabricacao: textoDoInteiro(d.ano_fabricacao),
    ano_modelo: textoDoInteiro(d.ano_modelo),
    numero_serie: identidade('numero_serie'),
    chassi: identidade('chassi'),
    placa: identidade('placa'),
    placa_uf: duplicar ? '' : texto(d.placa_uf),
    renavam: identidade('renavam'),
    potencia_cv: textoDecimal(d.potencia_cv),
    custo_uso_unitario: textoDecimal(d.custo_uso_unitario),
    material: texto(d.material),
    ano_conclusao: textoDoInteiro(d.ano_conclusao),
    compatibilidade: texto(d.compatibilidade),
    especificacoes: texto(d.especificacoes),
    observacoes: texto(d.observacoes),
    medidor: {
      tipo: texto(medidor?.tipo),
      leitura_inicial: duplicar ? '' : textoDecimal(medidor?.leitura_inicial),
      leitura_atual: duplicar ? '' : textoDecimal(medidor?.leitura_atual),
      data_leitura: duplicar ? '' : texto(medidor?.data_leitura),
    },
    tanques: (Array.isArray(d.tanques) ? d.tanques : [])
      .filter((t) => t && typeof t === 'object' && (!duplicar || t.ativo !== false))
      .map((t, i) => {
        const produtos = /** @type {ProdutoDoTanque[]} */ ((Array.isArray(t.produtos) ? t.produtos : []).map(produtoDoTanque).filter(Boolean));
        return {
          chave: t.id && !duplicar ? `tanque-${t.id}` : `tanque-copia-${i}`,
          id: duplicar ? null : (t.id ?? null),
          identificador: texto(t.identificador),
          capacidade: textoDecimal(t.capacidade_litros),
          observacao: texto(t.observacao),
          ativo: duplicar ? true : t.ativo !== false,
          produtos: duplicar ? produtos.filter(produtoUtilizavel) : produtos,
        };
      }),
    aquisicao: {
      data_aquisicao: texto(aq.data_aquisicao),
      data_disponibilidade: texto(aq.data_disponibilidade),
      valor_aquisicao: textoDecimal(aq.valor_aquisicao, 2),
      custo_incorporacao: textoDecimal(aq.custo_incorporacao, 2),
      fornecedor: referencia(aq.fornecedor),
      documento_referencia: duplicar ? '' : texto(aq.documento_referencia),
      garantia_ate: texto(aq.garantia_ate),
    },
    depreciacao: {
      depreciavel: dp.depreciavel === true,
      vida: meses === null ? '' : String(emAnos ? meses / 12 : meses),
      vidaUnidade: emAnos ? 'ANOS' : 'MESES',
      residual_modo: dp.residual_modo === 'PERCENTUAL' ? 'PERCENTUAL' : 'VALOR',
      valor_residual: textoDecimal(dp.valor_residual, 2),
      residual_percentual: textoDecimal(dp.residual_percentual),
      data_inicio_depreciacao: texto(dp.data_inicio_depreciacao),
    },
  };
};

/** O bem tinha um contador gravado (edição)? @param {ContextoBem} ctx */
const tinhaContador = (ctx) => ctx.editando && ehMedidorContador(ctx.medidorOriginal?.tipo);

/**
 * Correção de cadastro do medidor (A2): enquanto a origem é o cadastro inicial
 * e não houve ajuste (atual = inicial), o tipo e a leitura inicial ainda mudam.
 * D-PROD-159 (X2): com leitura registrada por ABASTECIMENTO confirmado
 * (`medidor_operacional` do detalhe), o tipo e a leitura inicial ficam fixos.
 * @param {any} medidorOriginal
 * @param {any} [medidorOperacional]
 */
export const medidorCorrigivel = (medidorOriginal, medidorOperacional = null) => {
  if (medidorOperacional != null) return false;
  if (!medidorOriginal || !ehMedidorContador(medidorOriginal.tipo)) return true;
  if (medidorOriginal.origem !== 'CADASTRO_INICIAL') return false;
  const ini = medidorOriginal.leitura_inicial;
  const atual = medidorOriginal.leitura_atual;
  if (typeof ini !== 'string' || typeof atual !== 'string') return false;
  return comparar(ini, atual) === 0;
};

/** O formulário mostra (e envia) a leitura atual? Só na edição de um contador já gravado. @param {EstadoBem} e @param {ContextoBem} ctx */
export const mostraLeituraAtual = (e, ctx) => tinhaContador(ctx) && ehMedidorContador(e.medidor.tipo);

/**
 * Vida útil digitada → meses (anos × 12).
 * @param {DepreciacaoForm} dp @returns {{ ok: true, meses: number|null } | { ok: false }}
 */
export const vidaEmMeses = (dp) => {
  const anos = dp.vidaUnidade === 'ANOS';
  const r = lerInteiro(dp.vida, anos ? { min: 1, max: 100 } : { min: 1, max: 1200 });
  if (!r.ok) return { ok: false };
  return { ok: true, meses: r.valor === null ? null : anos ? r.valor * 12 : r.valor };
};

/** Aba onde fica o campo de uma chave de erro. @param {string} chave */
export const abaDoCampo = (chave) => {
  if (chave.startsWith('medidor') || chave.startsWith('tanques') || chave === 'custo_uso_unitario') return ABAS_BEM.OPERACAO;
  if (chave.startsWith('aquisicao') || chave.startsWith('depreciacao')) return ABAS_BEM.AQUISICAO;
  return ABAS_BEM.IDENTIFICACAO;
};

/** @param {string} a @param {string} b — dias AAAA-MM-DD comparam como texto. */
const diaAntes = (a, b) => Boolean(a && b && a < b);

/**
 * Parâmetros da depreciação (validação comum ao salvar e à prévia).
 * @param {EstadoBem} e @param {Record<string, string>} erros
 * @returns {{ valor_aquisicao: string|null, custo_incorporacao: string|null, vida_util_meses: number|null, valor_residual: string|null, residual_percentual: string|null }}
 */
const validarParametrosDepreciacao = (e, erros) => {
  const dp = e.depreciacao;
  const aq = lerDecimal(e.aquisicao.valor_aquisicao, LIMITES_BEM.DINHEIRO);
  const inc = lerDecimal(e.aquisicao.custo_incorporacao, LIMITES_BEM.DINHEIRO);
  if (!aq.ok) erros['aquisicao.valor_aquisicao'] = 'Valor em reais, até 2 casas decimais';
  else if (aq.valor === null) erros['aquisicao.valor_aquisicao'] = 'Informe o valor de aquisição para depreciar';
  if (!inc.ok) erros['aquisicao.custo_incorporacao'] = 'Valor em reais, até 2 casas decimais';
  const vida = vidaEmMeses(dp);
  if (!vida.ok || vida.meses === null) erros['depreciacao.vida'] = dp.vidaUnidade === 'ANOS' ? 'Anos: número inteiro de 1 a 100' : 'Meses: número inteiro de 1 a 1200';
  if (!dp.data_inicio_depreciacao) erros['depreciacao.data_inicio_depreciacao'] = 'Informe o início da depreciação';
  else {
    const base = e.aquisicao.data_disponibilidade || e.aquisicao.data_aquisicao;
    if (diaAntes(dp.data_inicio_depreciacao, base)) erros['depreciacao.data_inicio_depreciacao'] = 'O início não pode ser antes da disponibilidade (ou da aquisição)';
  }
  const custoBase = aq.ok && aq.valor !== null ? somar([aq.valor, inc.ok ? inc.valor : null], 2) : null;
  /** @type {string|null} */
  let valorResidual = null;
  /** @type {string|null} */
  let percentual = null;
  if (dp.residual_modo === 'VALOR') {
    const r = lerDecimal(dp.valor_residual, LIMITES_BEM.DINHEIRO);
    if (!r.ok || r.valor === null) erros['depreciacao.valor_residual'] = 'Informe o valor residual (pode ser zero)';
    else if (custoBase !== null && comparar(r.valor, custoBase) > 0) erros['depreciacao.valor_residual'] = 'O residual não pode passar do custo (aquisição + incorporação)';
    else valorResidual = r.valor;
  } else {
    const r = lerDecimal(dp.residual_percentual, LIMITES_BEM.PERCENTUAL);
    if (!r.ok || r.valor === null) erros['depreciacao.residual_percentual'] = 'Informe o percentual residual (pode ser zero)';
    else if (comparar(r.valor, '100') > 0) erros['depreciacao.residual_percentual'] = 'Percentual de 0 a 100';
    else percentual = r.valor;
  }
  return {
    valor_aquisicao: aq.ok ? aq.valor : null,
    custo_incorporacao: inc.ok ? inc.valor : null,
    vida_util_meses: vida.ok ? vida.meses : null,
    valor_residual: valorResidual,
    residual_percentual: percentual,
  };
};

/**
 * Validação local antes de enviar (o servidor continua sendo a fonte). Chaves
 * de erro: campo (`nome`), bloco (`medidor.tipo`) ou linha (`tanques.0.capacidade`).
 * @param {EstadoBem} e @param {ContextoBem} ctx
 * @returns {Record<string, string>}
 */
export const validarBem = (e, ctx) => {
  /** @type {Record<string, string>} */
  const erros = {};
  const natureza = e.natureza || null;
  const cap = capacidadesDaNatureza(natureza);
  const aplica = (/** @type {string} */ campo) => campoAplicavel(natureza, campo);

  if (!e.nome.trim()) erros.nome = 'Obrigatório';
  if (!ehNatureza(natureza)) erros.natureza = 'Escolha o tipo de bem';
  if (!e.tipo?.id) erros.tipo = 'Escolha o tipo';
  const codigo = normalizarCodigoFrota(e.codigo_frota);
  if (codigo && (codigo.length > 16 || !PADRAO_CODIGO_FROTA.test(codigo))) erros.codigo_frota = 'Letras e números, separados por espaço ou hífen (ex.: TP-02)';

  const anos = /** @type {Array<[keyof EstadoBem, number, number]>} */ ([
    ['ano_fabricacao', 1900, 2100],
    ['ano_modelo', 1900, 2101],
  ]);
  if (aplica('ano_conclusao')) anos.push(['ano_conclusao', 1800, 2100]);
  for (const [campo, min, max] of anos) {
    if (!lerInteiro(/** @type {string} */ (e[campo]), { min, max }).ok) erros[campo] = `Ano de ${min} a ${max}`;
  }
  if (aplica('placa') && e.placa.trim() && !PADRAO_PLACA.test(normalizarPlaca(e.placa))) erros.placa = 'Use ABC-1234 ou o Mercosul ABC1D23';
  if (aplica('renavam') && e.renavam.trim() && !PADRAO_RENAVAM.test(e.renavam.trim())) erros.renavam = 'De 9 a 11 dígitos';
  if (aplica('chassi') && e.chassi.trim() && !PADRAO_CHASSI.test(e.chassi.trim().toUpperCase())) erros.chassi = '17 letras e números (sem I, O e Q)';
  if (aplica('potencia_cv')) {
    const pot = lerDecimal(e.potencia_cv, LIMITES_BEM.MEDIDA);
    if (!pot.ok || (pot.valor !== null && comparar(pot.valor, '0') <= 0)) erros.potencia_cv = 'Número maior que zero, até 4 casas decimais';
  }
  if (usaCustoDeUso(natureza) && !lerDecimal(e.custo_uso_unitario, LIMITES_BEM.MEDIDA).ok) erros.custo_uso_unitario = 'Zero ou mais, até 4 casas decimais';

  if (cap && cap.medidor !== 'PROIBIDO') {
    const tipo = e.medidor.tipo;
    if (!tipo && cap.medidor === 'OBRIGATORIO') erros['medidor.tipo'] = 'Escolha o medidor (ou "Sem medidor")';
    if (ehMedidorContador(tipo)) {
      const ini = lerDecimal(e.medidor.leitura_inicial, LIMITES_BEM.MEDIDA);
      if (!ini.ok || ini.valor === null) erros['medidor.leitura_inicial'] = 'Informe a leitura inicial (zero ou mais, até 4 casas)';
      if (!e.medidor.data_leitura) erros['medidor.data_leitura'] = 'Informe a data da leitura';
      else if (diaAntes(ctx.hoje, e.medidor.data_leitura)) erros['medidor.data_leitura'] = 'A data da leitura não pode ser futura';
      if (mostraLeituraAtual(e, ctx)) {
        const atual = lerDecimal(e.medidor.leitura_atual, LIMITES_BEM.MEDIDA);
        const original = ctx.medidorOriginal;
        // Correção de cadastro pendente (A2): tipo trocado ou leitura inicial mudada num
        // medidor ainda corrigível. Aí a atual é a própria inicial (o ajuste vem depois).
        const inicial = ini.ok ? ini.valor : null;
        const operacional = ctx.medidorOperacional ?? null;
        const corrigindo =
          inicial !== null && medidorCorrigivel(original, operacional) && (e.medidor.tipo !== original.tipo || comparar(inicial, original.leitura_inicial) !== 0);
        // O abastecimento nunca grava o cadastro (D4): o piso operacional só vale para um
        // ajuste de verdade (leitura ou data mudadas), como no servidor; editar outro campo passa.
        const ajustando =
          e.medidor.data_leitura !== original.data_leitura || (atual.ok && atual.valor !== null && comparar(atual.valor, original.leitura_atual) !== 0);
        if (!atual.ok || atual.valor === null) erros['medidor.leitura_atual'] = 'Informe a leitura atual (até 4 casas)';
        else if (ini.ok && ini.valor !== null && comparar(atual.valor, ini.valor) < 0) erros['medidor.leitura_atual'] = 'A leitura atual não pode ser menor que a inicial';
        else if (operacional && typeof operacional.leitura === 'string' && ajustando && comparar(atual.valor, operacional.leitura) < 0) {
          erros['medidor.leitura_atual'] = 'A leitura atual não pode ser menor que a registrada pelo último abastecimento';
        }
        else if (corrigindo && inicial !== null && comparar(atual.valor, inicial) !== 0) {
          erros['medidor.leitura_atual'] = 'Na correção do cadastro a leitura atual é a própria leitura inicial: salve a correção e registre a nova leitura depois';
        }
      }
    }
  }

  if (cap?.tanques) {
    const vistos = new Map();
    e.tanques.forEach((t, i) => {
      const ident = t.identificador.trim().replace(/\s+/g, ' ');
      if (!ident) erros[`tanques.${i}.identificador`] = 'Obrigatório';
      else {
        const chave = ident.toLocaleLowerCase('pt-BR');
        if (vistos.has(chave)) erros[`tanques.${i}.identificador`] = 'Outro tanque deste bem já usa este identificador';
        vistos.set(chave, i);
      }
      // P-01: o tanque pode ficar sem Produto aceito (a tela avisa); o teto é por tanque (P-02).
      const ids = t.produtos.map((p) => p.id);
      if (new Set(ids).size !== ids.length) erros[`tanques.${i}.produtos`] = 'O mesmo Produto aparece mais de uma vez';
      else if (ids.length > LIMITE_PRODUTOS_POR_TANQUE) erros[`tanques.${i}.produtos`] = `No máximo ${LIMITE_PRODUTOS_POR_TANQUE} Produtos aceitos por tanque`;
      if (!t.ativo) return;
      const capacidade = lerDecimal(t.capacidade, LIMITES_BEM.MEDIDA);
      if (!capacidade.ok || capacidade.valor === null || comparar(capacidade.valor, '0') <= 0) erros[`tanques.${i}.capacidade`] = 'Litros, maior que zero, até 4 casas decimais';
    });
    if (e.tanques.filter((t) => t.ativo).length > LIMITE_TANQUES_ATIVOS) erros.tanques = `No máximo ${LIMITE_TANQUES_ATIVOS} tanques ativos`;
  }

  const aq = e.aquisicao;
  if (!lerDecimal(aq.valor_aquisicao, LIMITES_BEM.DINHEIRO).ok) erros['aquisicao.valor_aquisicao'] = 'Valor em reais, até 2 casas decimais';
  if (!lerDecimal(aq.custo_incorporacao, LIMITES_BEM.DINHEIRO).ok) erros['aquisicao.custo_incorporacao'] = 'Valor em reais, até 2 casas decimais';
  if (diaAntes(aq.data_disponibilidade, aq.data_aquisicao)) erros['aquisicao.data_disponibilidade'] = 'Não pode ser antes da aquisição';

  if (e.depreciacao.depreciavel) {
    if (e.propriedade !== 'PROPRIO') erros['depreciacao.depreciavel'] = 'Só bens próprios são depreciados: ajuste a propriedade ou desligue a depreciação';
    validarParametrosDepreciacao(e, erros);
  }
  return erros;
};

/**
 * Parâmetros da prévia (§6) a partir do estado, com os erros dos campos que faltam.
 * @param {EstadoBem} e
 * @returns {{ erros: Record<string, string>, parametros: { valor_aquisicao: string, custo_incorporacao: string|null, residual_modo: string,
 *   valor_residual: string|null, residual_percentual: string|null, vida_util_meses: number, data_inicio_depreciacao: string } | null }}
 */
export const parametrosDaPrevia = (e) => {
  /** @type {Record<string, string>} */
  const erros = {};
  const p = validarParametrosDepreciacao(e, erros);
  if (Object.keys(erros).length || p.valor_aquisicao === null || p.vida_util_meses === null) return { erros, parametros: null };
  return {
    erros,
    parametros: {
      valor_aquisicao: p.valor_aquisicao,
      custo_incorporacao: p.custo_incorporacao,
      residual_modo: e.depreciacao.residual_modo,
      valor_residual: p.valor_residual,
      residual_percentual: p.residual_percentual,
      vida_util_meses: p.vida_util_meses,
      data_inicio_depreciacao: e.depreciacao.data_inicio_depreciacao,
    },
  };
};

/** @param {string} t */
const ouNulo = (t) => (t.trim() ? t.trim() : null);

/**
 * Estado (já validado) → forma do corpo (`formaDeEdicaoDoBem`). Campos e blocos
 * que a natureza não admite saem vazios. D-PROD-169: `natureza` + `tipo_id`
 * (sem `familia_id`, `area_id` nem `localizacao_descricao`); a `natureza` só
 * vai no POST (o service não a manda no PATCH).
 * @param {EstadoBem} e @param {ContextoBem} ctx
 * @returns {Record<string, any>}
 */
export const formaDoEstado = (e, ctx) => {
  const natureza = e.natureza || null;
  const cap = capacidadesDaNatureza(natureza);
  /** @template T @param {string} campo @param {T} valor @returns {T|null} */
  const seAplica = (campo, valor) => (campoAplicavel(natureza, campo) ? valor : null);
  const inteiro = (/** @type {string} */ t) => {
    const r = lerInteiro(t, { min: 0, max: 9999 });
    return r.ok ? r.valor : null;
  };
  const decimal = (/** @type {string} */ t, /** @type {{ casas: number, inteiros: number }} */ limites) => {
    const r = lerDecimal(t, limites);
    return r.ok ? r.valor : null;
  };

  const tipoMedidor = cap && cap.medidor !== 'PROIBIDO' ? e.medidor.tipo : '';
  /** @type {Record<string, any>|null} */
  let medidor = null;
  if (tipoMedidor === 'SEM_MEDIDOR') medidor = { tipo: 'SEM_MEDIDOR' };
  else if (ehMedidorContador(tipoMedidor)) {
    medidor = {
      tipo: tipoMedidor,
      leitura_inicial: decimal(e.medidor.leitura_inicial, LIMITES_BEM.MEDIDA),
      leitura_atual: mostraLeituraAtual(e, ctx) ? decimal(e.medidor.leitura_atual, LIMITES_BEM.MEDIDA) : null,
      data_leitura: e.medidor.data_leitura || null,
    };
  }

  const dp = e.depreciacao;
  const vida = vidaEmMeses(dp);
  const placa = normalizarPlaca(e.placa);
  return {
    nome: e.nome.trim(),
    natureza,
    tipo_id: e.tipo?.id ?? null,
    codigo_frota: normalizarCodigoFrota(e.codigo_frota) || null,
    propriedade: e.propriedade || 'PROPRIO',
    proprietario_parceiro_id: e.propriedade !== 'PROPRIO' ? (e.proprietario?.id ?? null) : null,
    responsavel_usuario_id: e.responsavel?.id ?? null,
    centro_custo_id: e.centro_custo?.id ?? null,
    marca: ouNulo(e.marca),
    modelo: ouNulo(e.modelo),
    ano_fabricacao: inteiro(e.ano_fabricacao),
    ano_modelo: inteiro(e.ano_modelo),
    numero_serie: seAplica('numero_serie', ouNulo(e.numero_serie)),
    chassi: seAplica('chassi', ouNulo(e.chassi.toUpperCase())),
    placa: seAplica('placa', placa || null),
    placa_uf: seAplica('placa_uf', e.placa_uf || null),
    renavam: seAplica('renavam', ouNulo(e.renavam)),
    potencia_cv: seAplica('potencia_cv', decimal(e.potencia_cv, LIMITES_BEM.MEDIDA)),
    custo_uso_unitario: usaCustoDeUso(natureza) ? decimal(e.custo_uso_unitario, LIMITES_BEM.MEDIDA) : null,
    material: seAplica('material', ouNulo(e.material)),
    ano_conclusao: seAplica('ano_conclusao', inteiro(e.ano_conclusao)),
    compatibilidade: seAplica('compatibilidade', ouNulo(e.compatibilidade)),
    especificacoes: ouNulo(e.especificacoes),
    observacoes: ouNulo(e.observacoes),
    medidor,
    tanques: cap?.tanques
      ? e.tanques.map((t) => ({
          id: t.id ?? undefined,
          identificador: t.identificador.trim().replace(/\s+/g, ' '),
          capacidade_litros: decimal(t.capacidade, LIMITES_BEM.MEDIDA),
          produto_ids: t.produtos.map((p) => p.id),
          observacao: ouNulo(t.observacao),
          ativo: t.ativo,
        }))
      : [],
    aquisicao: {
      data_aquisicao: e.aquisicao.data_aquisicao || null,
      data_disponibilidade: e.aquisicao.data_disponibilidade || null,
      valor_aquisicao: decimal(e.aquisicao.valor_aquisicao, LIMITES_BEM.DINHEIRO),
      custo_incorporacao: decimal(e.aquisicao.custo_incorporacao, LIMITES_BEM.DINHEIRO),
      fornecedor_parceiro_id: e.aquisicao.fornecedor?.id ?? null,
      documento_referencia: ouNulo(e.aquisicao.documento_referencia),
      garantia_ate: e.aquisicao.garantia_ate || null,
    },
    depreciacao: dp.depreciavel
      ? {
          depreciavel: true,
          metodo: 'LINEAR',
          vida_util_meses: vida.ok ? vida.meses : null,
          residual_modo: dp.residual_modo,
          valor_residual: dp.residual_modo === 'VALOR' ? decimal(dp.valor_residual, LIMITES_BEM.DINHEIRO) : null,
          residual_percentual: dp.residual_modo === 'PERCENTUAL' ? decimal(dp.residual_percentual, LIMITES_BEM.PERCENTUAL) : null,
          data_inicio_depreciacao: dp.data_inicio_depreciacao || null,
        }
      : { depreciavel: false },
  };
};
