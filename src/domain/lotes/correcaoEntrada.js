/**
 * R1 — Correção da ENTRADA ORIGINAL pelo Cadastro de Lotes (funções puras).
 *
 * A correção não é PATCH genérico: vai pelo comando
 * `POST /lotes/:id/correcao-entrada`, que reescreve o mesmo fato no servidor
 * (lote, evento, partida, peso e posição). O navegador só calcula O QUE mudou
 * em relação à entrada lida; a elegibilidade é sempre do servidor.
 */

export const ESTADOS_CORRECAO = Object.freeze({
  CONSULTANDO: 'consultando',
  ELEGIVEL: 'elegivel',
  BLOQUEADO: 'bloqueado',
  ERRO: 'erro',
});

const MENSAGENS = Object.freeze({
  lote_excluido: 'o lote foi excluído do cadastro',
  lote_gerado_por_manejo: 'o lote foi gerado por manejo no mapa (não é uma entrada)',
  movimentacao_ativa: 'há movimentação do mapa deste lote',
  movimentacao_cancelada: 'há movimentação deste lote no histórico (mesmo cancelada, ela documenta a entrada)',
  movimentacao_da_posicao: 'há movimentação registrada para o grupo deste lote',
  estado_divergente_da_entrada: 'o lote já não está como foi lançado na entrada',
  alteracao_sem_comprovacao: 'há alteração de saldo, área ou categoria registrada depois da entrada',
  vinculo_legado_por_nome: 'há registro antigo vinculado pelo nome do lote',
  suplementacao_lote: 'há suplementação lançada para o lote',
  manejos_tecnicos: 'há manejo técnico lançado para o lote',
  eventos_sanitarios: 'há evento sanitário lançado para o lote',
  aplicacoes_medicamento: 'há aplicação de medicamento lançada para o lote',
  movimentacoes_pecuarias: 'há movimentação pecuária lançada para o lote',
  lancamentos_tarefa: 'há tarefa lançada para o lote',
  evento_posterior: 'há manejo do rebanho (transferência, pesagem, morte…) depois da entrada',
  posicoes_derivadas: 'o lote já foi dividido em mais de um grupo no rebanho',
  entrada_por_ativacao_agregada: 'a entrada veio da ativação do controle do rebanho, que reúne vários lotes num só registro; corrigir só este lote não é seguro',
  entrada_sem_posicao_no_ledger: 'a entrada não tem grupo correspondente no rebanho',
  entrada_ambigua_no_ledger: 'a entrada não tem um registro único no rebanho',
  entrada_cancelada: 'a entrada deste lote foi cancelada no rebanho',
  identidade_em_conflito: 'já existe outro grupo com a mesma identidade nessa área',
});

/** Texto para o motivo estável do servidor (nunca o texto do erro cru). */
export const mensagemDoMotivoCorrecao = (motivo) => MENSAGENS[motivo] ?? 'existe registro dependente da entrada';

const vazio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const texto = (v) => (vazio(v) ? null : String(v).trim());
const numero = (v) => {
  if (vazio(v)) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const dia = (v) => (vazio(v) ? null : String(v).slice(0, 10));

/**
 * R3: quantidade de animais DIGITADA — inteiro positivo completo, sem sufixo,
 * sem fração. Nunca trunca nem arredonda: "100.5", "100abc", "0", "" → NaN.
 * @param {unknown} v
 * @returns {number} inteiro > 0, ou NaN se inválido
 */
export const inteiroPositivoDigitado = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : NaN;
  const t = String(v ?? '').trim();
  if (!/^\d+$/.test(t)) return NaN;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : NaN;
};

/**
 * R3: peso DIGITADO — vazio = null (política: sem peso); número decimal com
 * ponto ou vírgula; qualquer sufixo/lixo ("300abc", "1.2.3") → NaN (inválido,
 * nunca vira null em silêncio).
 * @param {unknown} v
 * @returns {number|null} número ≥ 0, null (vazio) ou NaN (inválido)
 */
export const pesoDigitado = (v) => {
  if (vazio(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : NaN;
  const t = String(v).trim();
  if (!/^\d+([.,]\d+)?$/.test(t)) return NaN;
  return Number(t.replace(',', '.'));
};

/**
 * Campos numéricos da entrada inválidos no formulário (para marcar o campo e
 * NÃO salvar). Quantidade só é exigida quando editável.
 * @param {Record<string, any>} form
 * @param {{ quantidadeEditavel?: boolean }} [opcoes]
 * @returns {string[]}
 */
export const errosNumericosDaEntrada = (form, { quantidadeEditavel = true } = {}) => {
  const erros = [];
  if (quantidadeEditavel && Number.isNaN(inteiroPositivoDigitado(form?.quantidade_cabecas))) erros.push('quantidade_cabecas');
  if (Number.isNaN(pesoDigitado(form?.peso_medio_kg))) erros.push('peso_medio_kg');
  return erros;
};

/**
 * O que a correção muda, comparando o formulário com a ENTRADA lida.
 * Só campos que de fato mudaram (vazio no formulário = sem valor).
 * @param {Record<string, any>} lote registro lido do servidor
 * @param {Record<string, any>} form valores do formulário
 * @returns {Record<string, unknown>} campos para `campos` do comando
 */
export const camposDaCorrecaoDeEntrada = (lote, form) => {
  /** @type {Record<string, unknown>} */
  const campos = {};
  const qtdAntes = Number(lote?.quantidade_entrada ?? lote?.quantidade_cabecas);
  // R3: nunca trunca/arredonda número digitado — inválido é erro, não "o que der".
  const qtd = inteiroPositivoDigitado(form?.quantidade_cabecas);
  if (Number.isNaN(qtd)) throw new TypeError('quantidade da entrada inválida: informe um número inteiro positivo');
  if (qtd !== qtdAntes) campos.quantidade = qtd;

  const pesoAntes = numero(lote?.peso_entrada_kg ?? lote?.peso_medio_kg);
  const peso = pesoDigitado(form?.peso_medio_kg);
  if (Number.isNaN(peso)) throw new TypeError('peso de entrada inválido');
  const pesoFinal = peso !== null && peso > 0 ? peso : null;
  if (pesoFinal !== pesoAntes) campos.peso_entrada_kg = pesoFinal;

  if (dia(form?.data_entrada) !== dia(lote?.data_entrada)) campos.data_entrada = dia(form?.data_entrada);

  const pares = [
    ['categoria', lote?.categoria_entrada ?? lote?.categoria, form?.categoria],
    ['categoria_manejo_id', lote?.categoria_manejo_entrada_id ?? lote?.categoria_manejo_id, form?.categoria_manejo_id],
    ['sexo', lote?.sexo, form?.sexo],
    ['setor_id', lote?.setor_id, form?.setor_id],
    ['area_entrada_id', lote?.area_entrada_id, form?.area_entrada_id],
  ];
  for (const [campo, antes, depois] of pares) {
    if (texto(antes) !== texto(depois)) campos[campo] = texto(depois);
  }
  return campos;
};

/** Campos que a edição do cadastro NUNCA manda pelo PATCH genérico (vão pela correção). */
export const CAMPOS_FORA_DO_PATCH = Object.freeze([
  'quantidade_cabecas', 'quantidade_entrada', 'area_atual_id', 'area_atual_nome', 'setor_id', 'setor_nome',
  'area_entrada_id', 'area_entrada_nome', 'categoria', 'categoria_manejo_id', 'categoria_manejo_nome', 'sexo',
  'peso_medio_kg', 'categoria_entrada', 'categoria_manejo_entrada_id', 'categoria_manejo_entrada_nome',
  'peso_entrada_kg', 'data_entrada',
]);

const comparavel = (v) => {
  if (vazio(v)) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'number') return String(v);
  return String(v).trim();
};

/**
 * PATCH de edição só com o que mudou (o servidor recusa, no ledger, a simples
 * PRESENÇA de campo operacional como `status`, mesmo com o valor igual).
 * @param {Record<string, any>} anterior
 * @param {Record<string, any>} dados
 */
export const somenteCamposAlterados = (anterior, dados) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const [campo, valor] of Object.entries(dados ?? {})) {
    if (CAMPOS_FORA_DO_PATCH.includes(campo)) continue;
    if (comparavel(valor) !== comparavel(anterior?.[campo])) saida[campo] = valor;
  }
  return saida;
};

/**
 * R1-R2: campos ADMINISTRATIVOS do lançamento da entrada (mesma lista do
 * servidor) e o tipo usado para comparar sem diferença espúria
 * ("" = null; "0"/0 em campo numérico vazio do formulário não conta).
 */
export const CAMPOS_ADMINISTRATIVOS_DA_ENTRADA = Object.freeze({
  nome: 'texto', identificador_nome: 'texto', identificador_sigla: 'texto', identificador_cor: 'texto',
  raca_predominante: 'texto', sistema_produtivo: 'texto', idade_media_meses: 'inteiro', observacoes: 'texto',
  motivo_entrada: 'texto', motivo_ajuste: 'texto', motivo_outros: 'texto', origem: 'texto', fornecedor_id: 'texto',
  fornecedor_nome: 'texto', nota_fiscal: 'texto', chave_nfe: 'texto', numero_gta: 'texto', cidade_origem: 'texto',
  estado_origem: 'texto', valor_total_compra: 'numero', valor_por_cabeca: 'numero', valor_frete: 'numero',
  campos_personalizados: 'json',
});

const canonico = (tipo, v) => {
  if (tipo === 'json') return v && typeof v === 'object' ? JSON.stringify(v) : '{}';
  if (tipo === 'inteiro') { const n = numero(v); return n === null ? null : Math.trunc(n); }
  if (tipo === 'numero') return numero(v);
  return texto(v);
};

/**
 * Administrativos que mudaram. `dados` é o que o formulário montou para salvar;
 * campos numéricos vêm do valor CRU do formulário (`form`), para que um campo
 * vazio não vire 0 e pareça alterado.
 * @param {Record<string, any>} lote @param {Record<string, any>} dados @param {Record<string, any>} [form]
 */
export const camposAdministrativosAlterados = (lote, dados, form = {}) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const [campo, tipo] of Object.entries(CAMPOS_ADMINISTRATIVOS_DA_ENTRADA)) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    // Numérico: sempre o valor CRU do formulário (ausente/vazio = sem valor), nunca o 0 de preenchimento.
    const bruto = tipo === 'numero' || tipo === 'inteiro' ? form?.[campo] : dados[campo];
    const novo = canonico(tipo, bruto);
    if (JSON.stringify(novo) !== JSON.stringify(canonico(tipo, lote?.[campo]))) {
      saida[campo] = tipo === 'json' ? (bruto && typeof bruto === 'object' ? bruto : {}) : novo;
    }
  }
  return saida;
};
