/**
 * Mensagens em português dos erros de Patrimônio e Frota (D-PROD-157).
 *
 * D-PROD-162: saíram os textos de perfis de medição, medições, combustíveis,
 * vínculo combustível × produto e fator kg/L (o servidor não manda mais esses
 * códigos; um que chegue cai no texto genérico). Entram os Produtos aceitos
 * pelo tanque, o Produto no tanque do Patrimônio e a unidade de estoque.
 *
 * D-PROD-169: o tanque aceita Produto em L, KG ou SACO; a família saiu da tela
 * ("Tipo de bem" = natureza; o tipo é cadastro do usuário, que pode ser
 * excluído quando nenhum bem o usa — `PATRIMONIO_TIPO_EM_USO`).
 *
 * Mesmo transporte de Gestão: o `nativeHttpClient` só preserva códigos
 * catalogados; os códigos de patrimônio chegam no corpo do servidor guardado em
 * `erro.cause`. Lemos SÓ `code`, `field`, `reason` e `details` (via
 * `lerErroGestao`) — a `message` do servidor nunca é exibida.
 */

import { getApiErrorMessage } from '@/apis/_core/ApiError';
import { lerErroGestao, mensagemRecalculoDaExclusao } from '@/lib/gestaoErros';
import { MAX_PRODUTOS_POR_TANQUE, ROTULO_NATUREZA, ROTULO_UNIDADE_ESTOQUE } from '@/lib/patrimonioDominio';
import { formatarNumero } from '@/lib/dinheiroDecimal';
import { formatarDia } from '@/lib/diaCivil';

const NADA = 'Nada foi gravado.';

/** Rótulo dos campos que o servidor aponta em `field`/`details.field`. */
const ROTULO_CAMPO = /** @type {Record<string, string>} */ ({
  codigo: 'Código',
  nome: 'Nome',
  natureza: 'Tipo de bem',
  descricao: 'Descrição',
  ordem: 'Ordem',
  vida_util_meses_padrao: 'Vida útil padrão',
  vida_util_meses_sugerida: 'Vida útil sugerida',
  // D-PROD-169: a família não aparece na tela; um erro nela é um erro do tipo escolhido.
  familia_id: 'Tipo',
  tipo_id: 'Tipo',
  unidade: 'Unidade',
  empresa_id: 'Empresa',
  codigo_frota: 'Código de frota',
  propriedade: 'Propriedade',
  proprietario_parceiro_id: 'Proprietário',
  responsavel_usuario_id: 'Responsável',
  centro_custo_id: 'Centro de custo',
  area_id: 'Área',
  localizacao_descricao: 'Localização',
  marca: 'Marca',
  modelo: 'Modelo',
  ano_fabricacao: 'Ano de fabricação',
  ano_modelo: 'Ano do modelo',
  numero_serie: 'Número de série',
  chassi: 'Chassi',
  placa: 'Placa',
  placa_uf: 'UF da placa',
  renavam: 'Renavam',
  potencia_cv: 'Potência (cv)',
  custo_uso_unitario: 'Custo por hora/km',
  salto_maximo_medidor: 'Teto de salto do medidor',
  material: 'Material',
  ano_conclusao: 'Ano de conclusão',
  compatibilidade: 'Compatibilidade',
  especificacoes: 'Especificações',
  observacoes: 'Observações',
  medidor: 'Medidor',
  tanques: 'Tanques',
  produto_ids: 'Produtos aceitos',
  aquisicao: 'Aquisição',
  data_aquisicao: 'Data de aquisição',
  data_disponibilidade: 'Data de disponibilidade',
  valor_aquisicao: 'Valor de aquisição',
  custo_incorporacao: 'Custo de incorporação',
  fornecedor_parceiro_id: 'Fornecedor',
  documento_referencia: 'Documento de referência',
  garantia_ate: 'Garantia até',
  depreciacao: 'Depreciação',
  vida_util_meses: 'Vida útil',
  valor_residual: 'Valor residual',
  residual_percentual: 'Residual (%)',
  data_inicio_depreciacao: 'Início da depreciação',
  data_leitura: 'Data da leitura',
  leitura_inicial: 'Leitura inicial',
  leitura_atual: 'Leitura atual',
  produto_id: 'Produto',
  // D-PROD-159 / D-PROD-162 — Abastecimentos (quantidade na unidade do Produto).
  quantidade: 'Quantidade',
  medidor_leitura: 'Leitura do medidor',
  tanque_id: 'Tanque',
  bem_id: 'Bem',
  local_estoque_id: 'Local de estoque',
  data_operacional: 'Data do abastecimento',
  referencia_externa: 'Referência externa',
  motivo: 'Motivo',
});

/** "tanques[2].produto_ids" / "tanques.1.capacidade_litros" → rótulo do último campo conhecido. @param {string|null} campo */
const rotuloDoCampo = (campo) => {
  if (!campo) return null;
  const partes = String(campo).split(/[.[\]]+/).filter((p) => p && !/^\d+$/.test(p));
  for (let i = partes.length - 1; i >= 0; i -= 1) {
    const rotulo = ROTULO_CAMPO[partes[i]];
    if (rotulo) return rotulo;
  }
  return String(campo);
};

/**
 * " (linha 2)" a partir do índice (0-based) que o servidor põe no `field` dos
 * filhos: `tanques[1].produto_ids`, `tanques[0].capacidade_litros`.
 * @param {string|null} campo
 */
const naLinha = (campo) => {
  const m = /\[(\d+)\]|\.(\d+)(?:\.|$)/.exec(String(campo ?? ''));
  return m ? ` (linha ${Number(m[1] ?? m[2]) + 1})` : '';
};

const CAMPO_INVALIDO = /** @type {Record<string, string>} */ ({
  placa: 'Placa inválida: use o formato ABC-1234 ou o Mercosul ABC1D23.',
  placa_uf: 'UF da placa inválida: escolha uma das 27 siglas.',
  renavam: 'Renavam inválido: informe de 9 a 11 dígitos.',
  chassi: 'Chassi inválido: são 17 letras e números (sem I, O e Q).',
  ano_fabricacao: 'Ano de fabricação inválido (de 1900 a 2100).',
  ano_modelo: 'Ano do modelo inválido (de 1900 a 2101).',
  ano_conclusao: 'Ano de conclusão inválido (de 1800 a 2100).',
});

/** Unidade de estoque como o usuário lê ("L", "kg"); outra (legada) vai como veio. @param {unknown} u */
const unidadeDeEstoque = (u) => (typeof u === 'string' && u ? /** @type {Record<string, string>} */ (ROTULO_UNIDADE_ESTOQUE)[u] ?? u : null);

/**
 * `TANQUE_PRODUTO_INVALIDO` por `reason` (D-PROD-162). `linha` = " (linha N)"
 * do tanque; `details.unidade`/`details.maximo` quando o servidor os manda.
 * @param {string|null} reason @param {string} linha @param {Record<string, any>} details
 */
const tanqueProdutoInvalido = (reason, linha, details) => {
  const doTanque = `Um Produto aceito do tanque${linha}`;
  switch (reason) {
    case 'outra_empresa':
      return `${doTanque} é de outra fazenda: só Produtos desta fazenda podem ser aceitos.`;
    case 'inativo':
      return `${doTanque} está inativo: só Produtos ativos podem ser acrescentados.`;
    case 'unidade_incompativel': {
      const unidade = typeof details.unidade === 'string' && details.unidade ? details.unidade : null;
      return `${doTanque} tem estoque ${unidade ? `em ${unidade}` : 'fora de L, KG e SACO'}: o tanque aceita Produto em litros (L), quilos (KG) ou sacos (SACO).`;
    }
    case 'repetido':
      return `O mesmo Produto aparece mais de uma vez nos Produtos aceitos do tanque${linha}.`;
    case 'limite': {
      const maximo = Number.isInteger(details.maximo) ? details.maximo : MAX_PRODUTOS_POR_TANQUE;
      return `Um tanque aceita no máximo ${maximo} Produtos ativos${linha}.`;
    }
    default:
      return `${doTanque} não existe nesta fazenda (ou não está mais disponível). Retire-o e escolha outro.`;
  }
};

/** "bem 7, tanque Principal; bem 9, tanque Reserva" (até 3) de `details.tanques`. @param {unknown} tanques */
const tanquesDoProduto = (tanques) => {
  const lista = Array.isArray(tanques) ? tanques.filter((t) => t && typeof t === 'object') : [];
  const textos = lista.slice(0, 3).map((t) => {
    const partes = [];
    if (t.bem_numero !== undefined && t.bem_numero !== null && String(t.bem_numero)) partes.push(`bem ${t.bem_numero}`);
    if (typeof t.identificador === 'string' && t.identificador) partes.push(`tanque ${t.identificador}`);
    return partes.join(', ');
  }).filter(Boolean);
  if (!textos.length) return '';
  const resto = lista.length - 3;
  return ` (${textos.join('; ')}${resto > 0 ? ` e mais ${resto}` : ''})`;
};

/** Por que a unidade de estoque do Produto não muda (`PRODUTO_UNIDADE_EM_USO`, P-10). */
const UNIDADE_EM_USO = /** @type {Record<string, string>} */ ({
  estoque: 'estoque',
  lotes: 'lotes',
  movimentos: 'movimentos de estoque',
  lancamentos: 'itens em lançamentos',
});

/**
 * Mensagem para o usuário a partir do erro de uma chamada de Patrimônio.
 * @param {unknown} erro
 * @param {string} fallback
 */
export const mensagemErroPatrimonio = (erro, fallback) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  const campo = rotuloDoCampo(field);
  switch (code) {
    case 'ACAO_NAO_PERMITIDA':
      // `adminOuIsAdmin()` (ex.: catálogo padrão) nega com `details.exige`: não é ação que se libera na tela.
      if (Array.isArray(details.exige) && details.exige.includes('administrador_ou_is_admin')) return 'Só o administrador da fazenda pode fazer isso.';
      return 'Você não tem permissão para esta ação nesta tela. Peça ao administrador para liberar.';
    case 'TENANT_ADMIN_REQUIRED':
      return 'Só o administrador da fazenda pode fazer isso.';
    case 'EMPRESA_NOT_FOUND':
      return 'Empresa não encontrada. Selecione a empresa novamente.';
    case 'EMPRESA_FUSO_NAO_CONFIGURADO':
      return `Configure o fuso horário da fazenda em Empresa antes de informar a leitura do medidor. ${NADA}`;
    case 'PATRIMONIO_VERSAO_CONFLITO':
      return `Este registro foi alterado por outra pessoa enquanto você editava. Reabra o registro para ver a versão atual e refaça a alteração. ${NADA}`;
    case 'FAMILIA_PATRIMONIAL_NAO_ENCONTRADA':
      return 'Família patrimonial não encontrada. A lista será atualizada.';
    case 'TIPO_PATRIMONIAL_NAO_ENCONTRADO':
      return 'Tipo patrimonial não encontrado. A lista será atualizada.';
    case 'BEM_PATRIMONIAL_NAO_ENCONTRADO':
      return 'Bem patrimonial não encontrado nesta empresa. A lista será atualizada.';
    case 'PATRIMONIO_CODIGO_DUPLICADO':
      // P-05: sem código no POST, o servidor o gera do nome; esgotados os sufixos, 409.
      return `Já existe um cadastro com este código. Use outro nome (o código é gerado a partir dele) ou outro código. ${NADA}`;
    case 'PATRIMONIO_NOME_DUPLICADO':
      return `Já existe um tipo com este nome neste tipo de bem. Use outro nome. ${NADA}`;
    // D-PROD-169: exclusão de tipo só sem bem nenhum (ativo ou inativo) usando o tipo.
    case 'PATRIMONIO_TIPO_EM_USO': {
      const bens = Number.isInteger(details.bens) ? details.bens : null;
      return bens !== null
        ? `Este tipo está em uso por ${bens} bem(ns). Troque o tipo desses bens antes de excluir.`
        : 'Este tipo está em uso por bens. Troque o tipo desses bens antes de excluir.';
    }
    case 'PATRIMONIO_FAMILIA_PADRAO_INDISPONIVEL': {
      const natureza = /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[String(details.natureza ?? '')];
      return `O cadastro padrão ${natureza ? `do tipo de bem ${natureza}` : 'deste tipo de bem'} está inativo ou foi alterado: não há onde guardar o tipo. Peça ao administrador para corrigir. ${NADA}`;
    }
    case 'BEM_TIPO_NATUREZA_INCOMPATIVEL': {
      const doBem = /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[String(details.natureza ?? '')];
      const doTipo = /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[String(details.natureza_tipo ?? '')];
      return `O tipo escolhido é ${doTipo ? `de ${doTipo}` : 'de outro tipo de bem'}: escolha um tipo ${doBem ? `de ${doBem}` : 'do tipo de bem do bem'}. ${NADA}`;
    }
    case 'BEM_REFERENCIA_INVALIDA':
      if (reason === 'inativo') return `${campo ? `"${campo}"` : 'O item escolhido'} está inativo: escolha um ativo. ${NADA}`;
      return `${campo ? `A escolha em "${campo}"` : 'Uma das escolhas'} não é válida (não existe mais, é de outra empresa ou está inativa). Escolha outra. ${NADA}`;
    case 'BEM_TIPO_FAMILIA_INCOMPATIVEL':
      return `O tipo escolhido não combina com o tipo de bem. Escolha outro tipo. ${NADA}`;
    case 'BEM_NATUREZA_IMUTAVEL':
      return `O tipo de bem não muda depois de gravado: escolha um tipo do mesmo tipo de bem. ${NADA}`;
    case 'BEM_CAMPO_NAO_APLICAVEL': {
      const natureza = /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[String(details.natureza ?? '')];
      return `${campo ? `"${campo}"` : 'Um dos campos'} não se aplica ${natureza ? `ao tipo de bem ${natureza}` : 'a este tipo de bem'}. ${NADA}`;
    }
    case 'BEM_CAMPO_INVALIDO':
      return `${CAMPO_INVALIDO[String(field ?? '')] ?? `Valor inválido em "${campo ?? 'campo'}".`} ${NADA}`;
    case 'BEM_CODIGO_FROTA_DUPLICADO':
      return `Já existe um bem com este código de frota nesta empresa. ${NADA}`;
    case 'BEM_CODIGO_FROTA_INVALIDO':
      return `Código de frota inválido: use letras e números, separados por espaço ou hífen (ex.: TP-02). ${NADA}`;
    case 'BEM_CLASSIFICACAO_INATIVA':
      return `Para reativar o bem, o tipo dele precisa estar ativo. Reative o tipo em “⋯ › Gerenciar tipos” antes. ${NADA}`;
    case 'MEDIDOR_OBRIGATORIO':
      return `Máquinas, veículos e equipamentos precisam de medidor (escolha "Sem medidor" se não houver). ${NADA}`;
    case 'MEDIDOR_TIPO_IMUTAVEL':
      return `O tipo do medidor não pode mais ser trocado: já houve ajuste de leitura. A troca de painel será uma operação própria. ${NADA}`;
    case 'MEDIDOR_LEITURA_INICIAL_IMUTAVEL':
      return `A leitura inicial não pode mais ser alterada depois de um ajuste de leitura. ${NADA}`;
    case 'MEDIDOR_LEITURA_REGRESSIVA':
      return `A nova leitura do medidor é menor que a atual: a leitura não pode voltar. ${NADA}`;
    case 'MEDIDOR_DATA_REGRESSIVA':
      return `A data da leitura é anterior à da última leitura registrada. ${NADA}`;
    case 'MEDIDOR_DATA_FUTURA':
      return `A data da leitura não pode ser futura. ${NADA}`;
    case 'MEDIDOR_LEITURA_INVALIDA':
      if (reason === 'atual_diferente_da_inicial') {
        return `Na correção do cadastro do medidor a leitura atual é a própria leitura inicial: corrija a leitura inicial agora e registre a nova leitura depois. ${NADA}`;
      }
      if (reason === 'obrigatoria') return `Informe a leitura e a data da leitura do medidor. ${NADA}`;
      if (reason === 'sem_medidor') return `"Sem medidor" não tem leitura nem data. ${NADA}`;
      return `Leitura do medidor inválida: informe um número maior ou igual a zero. ${NADA}`;
    case 'TANQUE_IDENTIFICADOR_DUPLICADO':
      return `Há tanques com o mesmo identificador neste bem (tanques inativos também reservam o identificador). ${NADA}`;
    case 'TANQUE_CAPACIDADE_INVALIDA':
      return `Capacidade do tanque inválida${naLinha(field)}: informe os litros, maior que zero. ${NADA}`;
    case 'TANQUE_PRODUTO_INVALIDO':
      // D-PROD-162: o servidor aponta `tanques[i].produto_ids` em `field`/`details.field`.
      return `${tanqueProdutoInvalido(reason, naLinha(field ?? (typeof details.field === 'string' ? details.field : null)), details)} ${NADA}`;
    case 'TANQUE_REMOCAO_NAO_PERMITIDA':
      return `Tanque já gravado não pode ser retirado: inative o tanque. ${NADA}`;
    case 'TANQUE_LIMITE_EXCEDIDO':
      return `Um bem pode ter no máximo 10 tanques ativos. ${NADA}`;
    case 'DEPRECIACAO_BEM_NAO_PROPRIO':
      return `Só bens próprios podem ser depreciados: ajuste a propriedade ou desligue a depreciação. ${NADA}`;
    case 'DEPRECIACAO_VIDA_UTIL_INVALIDA':
      return `Vida útil inválida: informe de 1 a 1200 meses (até 100 anos). ${NADA}`;
    case 'DEPRECIACAO_RESIDUAL_INVALIDO':
      return `O valor residual não pode ser maior que o custo do bem (aquisição + incorporação). ${NADA}`;
    case 'DEPRECIACAO_PARAMETROS_INVALIDOS':
      return `Depreciação incompleta ou incoerente: com a depreciação ligada, informe valor de aquisição, vida útil, início e o residual (por valor ou por percentual); desligada, não informe parâmetros. ${NADA}`;
    case 'PATRIMONIO_DATA_INVALIDA':
      return `Data inválida${campo ? ` em "${campo}"` : ''}: confira o dia e a ordem (disponibilidade não antes da aquisição; início da depreciação não antes da disponibilidade). ${NADA}`;
    // ─── Produto aceito por tanque do Patrimônio (D-PROD-162) ───
    case 'PRODUTO_EM_TANQUE_PATRIMONIO':
      return `Este Produto é aceito em tanque de bem do Patrimônio${tanquesDoProduto(details.tanques)}: ele não muda de fazenda. Tire-o dos Produtos aceitos do tanque em Bens Patrimoniais antes. ${NADA}`;
    case 'PRODUTO_UNIDADE_EM_USO': {
      const porque = reason ?? (typeof details.reason === 'string' ? details.reason : null);
      if (porque === 'aceito_em_tanque') {
        return `Este Produto é aceito em tanque de bem do Patrimônio: a unidade de estoque só pode ser L, KG ou SACO enquanto ele estiver aceito. Tire-o dos Produtos aceitos do tanque antes. ${NADA}`;
      }
      const tem = UNIDADE_EM_USO[porque ?? ''] ?? 'estoque, lotes ou movimentos';
      const de = typeof details.de === 'string' && details.de ? details.de : null;
      const para = typeof details.para === 'string' && details.para ? details.para : null;
      const troca = de && para ? ` (${de} → ${para})` : '';
      const sugestao = de === 'L' && para && para !== 'L'
        ? (para === 'SACO' ? 'Cadastre um Produto novo em sacos (SACO).' : `Cadastre um Produto novo em quilos (${para}).`)
        : 'Cadastre um Produto novo em litros, ex.: “Diesel S10 (L)”.';
      return `Este Produto já tem ${tem}: a unidade de estoque não muda${troca}. ${sugestao} ${NADA}`;
    }
    case 'REQUEST_VALIDATION_FAILED':
      if (reason === 'valor_deve_ser_texto') {
        const onde = rotuloDoCampo(typeof details.campo === 'string' ? details.campo : null);
        return `Valor em formato inválido${onde ? ` em "${onde}"` : ''}. Revise e tente novamente. ${NADA}`;
      }
      return campo ? `Dados inválidos no campo "${campo}". Revise e tente novamente.` : 'Dados inválidos. Revise o formulário e tente novamente.';
    default:
      return getApiErrorMessage(erro, fallback);
  }
};

// ─── Abastecimentos (D-PROD-159) ─────────────────────────────────────────

/** Número canônico do servidor ("1550.5000") no formato do Brasil, sem float. @param {unknown} v @param {number} [casasMax] */
const numeroBr = (v, casasMax = 4) => (typeof v === 'string' && v ? formatarNumero(v, { locale: 'pt-BR', casasMin: 0, casasMax }) : '?');
/** @param {unknown} v */
const diaBr = (v) => (typeof v === 'string' && v ? formatarDia(v, 'pt-BR') : '?');

/** Por que o estorno exato não é seguro agora (`ABASTECIMENTO_CANCELAMENTO_BLOQUEADO`). */
const MOTIVO_CANCELAMENTO_BLOQUEADO = /** @type {Record<string, string>} */ ({
  produto_mudou_de_fazenda: 'o produto mudou de fazenda',
  movimento_inexistente: 'o movimento de estoque do abastecimento não existe mais',
  movimento_estornado: 'o movimento de estoque já foi estornado',
  fatias_inconsistentes: 'os lotes consumidos não conferem com a quantidade baixada',
  lote_indisponivel_para_devolucao: 'um lote de origem foi estornado ou removido',
  devolucao_excede_entrada: 'a devolução passaria da entrada do lote de origem',
  estoque_excede_limite: 'o estoque do produto passaria do limite',
  // D-PROD-162 (achado D7): só a troca que envolve L bloqueia o estorno exato.
  unidade_mudou: 'a unidade de estoque do Produto mudou desde o abastecimento',
});

/**
 * Mensagem dos erros de Abastecimentos (comandos e leituras). Fecha com "Nada
 * foi gravado." onde o servidor garante que nada mudou; o resto cai em
 * `mensagemErroPatrimonio`.
 * @param {unknown} erro
 * @param {string} fallback
 */
export const mensagemErroAbastecimento = (erro, fallback) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  // D-PROD-273 (fatia 4): recusas do recálculo do que veio depois (cancelamento com movimento posterior).
  const recalculo = mensagemRecalculoDaExclusao(code, reason, details);
  if (recalculo) return recalculo;
  switch (code) {
    case 'ABASTECIMENTO_NAO_ENCONTRADO':
      return 'Abastecimento não encontrado nesta fazenda. A lista será atualizada.';
    case 'ABASTECIMENTO_STATUS_INVALIDO':
      return 'Este abastecimento já foi cancelado. Nada foi alterado.';
    case 'ABASTECIMENTO_BEM_INELEGIVEL':
      if (reason === 'natureza_sem_tanque') return `Este bem não tem tanque de combustível. ${NADA}`;
      return `O bem está inativo: reative-o antes de abastecer. ${NADA}`;
    case 'ABASTECIMENTO_TANQUE_INVALIDO':
      if (reason === 'tanque_inativo') return `O tanque está inativo. ${NADA}`;
      return `O tanque não pertence mais a este bem. ${NADA}`;
    // D-PROD-162/163: o Produto vem dos Produtos aceitos do tanque; baixa exata na unidade de estoque dele (L; kg para KG e SACO).
    case 'ABASTECIMENTO_PRODUTO_INVALIDO':
      if (reason === 'outra_empresa') return `O Produto é de outra fazenda. ${NADA}`;
      if (reason === 'inativo') return `O Produto está inativo. ${NADA}`;
      return `O Produto não existe nesta fazenda. ${NADA}`;
    case 'ABASTECIMENTO_PRODUTO_NAO_ACEITO':
      return `O tanque escolhido não aceita este Produto. Marque o Produto nos Produtos aceitos do tanque em Bens Patrimoniais. ${NADA}`;
    case 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL': {
      const unidade = typeof details.unidade === 'string' && details.unidade ? details.unidade : null;
      return `O estoque deste Produto ${unidade ? `está em ${unidade}, não` : 'não está'} em litros (L), quilos (KG) nem sacos (SACO): ele não pode ser abastecido. ${NADA}`;
    }
    case 'ABASTECIMENTO_LOCAL_INVALIDO':
      return `O local de estoque não existe mais ou está inativo. ${NADA}`;
    case 'ABASTECIMENTO_EXCEDE_CAPACIDADE':
      // Só conferida para Produto em L (a capacidade do tanque é em litros).
      return `A quantidade em litros passa da capacidade nominal do tanque (${numeroBr(details.capacidade_litros)} L). ${NADA}`;
    case 'ABASTECIMENTO_DATA_FUTURA':
      return `A data é posterior a hoje na fazenda (${diaBr(details.hoje)}): só abastecimento já feito entra. ${NADA}`;
    case 'OPERACAO_VALORES_INVALIDOS':
      if (reason === 'quantidade_nao_positiva') return `Informe uma quantidade maior que zero. ${NADA}`;
      return `Quantidade ou custo acima do limite do estoque. ${NADA}`;
    case 'ESTOQUE_SALDO_INSUFICIENTE': {
      if (reason === 'estoque_atual_insuficiente') return `O estoque atual do Produto é menor que o pedido. ${NADA}`;
      // A unidade vem do servidor (prévia); sem ela (baixa do motor), só o número.
      const unidade = unidadeDeEstoque(details.unidade);
      const em = unidade ? ` ${unidade}` : '';
      return `Saldo insuficiente deste Produto neste local: disponível ${numeroBr(details.disponivel)}${em}, pedido ${numeroBr(details.solicitado)}${em}. ${NADA}`;
    }
    case 'MEDIDOR_LEITURA_INVALIDA':
      if (reason === 'sem_medidor') return `Este bem não tem medidor: não informe leitura. ${NADA}`;
      if (reason === 'obrigatoria') return `Informe a leitura do medidor. ${NADA}`;
      return mensagemErroPatrimonio(erro, fallback);
    case 'MEDIDOR_LEITURA_REGRESSIVA':
      return `A leitura é menor que a registrada em ${diaBr(details.data_referencia)} (${numeroBr(details.leitura_referencia)}). ${NADA}`;
    case 'MEDIDOR_LEITURA_ACIMA_POSTERIOR':
      return `A leitura é maior que a registrada depois, em ${diaBr(details.data_posterior)} (${numeroBr(details.leitura_posterior)}). ${NADA}`;
    case 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO': {
      const motivo = MOTIVO_CANCELAMENTO_BLOQUEADO[reason ?? ''] ?? 'o estoque de origem mudou';
      return `O estorno exato não é seguro agora (${motivo}). Nada foi alterado.`;
    }
    case 'IDEMPOTENCY_CONFLICT':
      return `Este envio usa uma chave já usada por outro conteúdo. Recarregue e envie de novo. ${NADA}`;
    case 'IDEMPOTENCY_IN_PROGRESS':
      return 'O mesmo envio ainda está sendo processado. Aguarde e consulte.';
    case 'CONCURRENCY_CONFLICT':
      return 'Outra operação mexeu no mesmo estoque ao mesmo tempo. Repita o mesmo envio (é seguro: não duplica).';
    case 'PATRIMONIO_VERSAO_CONFLITO':
      return 'O abastecimento mudou desde que você o abriu. Recarregue.';
    case 'PRODUTO_NOT_FOUND':
      return 'Produto não encontrado nesta fazenda. Escolha outro.';
    case 'REQUEST_VALIDATION_FAILED':
      if (field === 'motivo' && reason === 'motivo_curto') return 'Informe um motivo com pelo menos 3 caracteres. Nada foi alterado.';
      if (field === 'motivo') return 'Informe o motivo do cancelamento. Nada foi alterado.';
      if (field === 'data_ate' && reason === 'periodo_invertido') return 'A data final do período é anterior à inicial.';
      return mensagemErroPatrimonio(erro, fallback);
    default:
      return mensagemErroPatrimonio(erro, fallback);
  }
};

/**
 * Mensagem de um BLOQUEIO da prévia (`{code, field, reason, details}`): o mesmo
 * texto do erro, sem o "Nada foi gravado." (a prévia não tenta gravar).
 * @param {{ code?: string, field?: string, reason?: string, details?: Record<string, any> } | null | undefined} bloqueio
 */
export const mensagemDoBloqueioAbastecimento = (bloqueio) =>
  mensagemErroAbastecimento(
    { cause: { code: bloqueio?.code, field: bloqueio?.field, reason: bloqueio?.reason, details: bloqueio?.details ?? {} } },
    'Há uma pendência que impede a confirmação.',
  ).replace(/\s*Nada foi (?:gravado|alterado)\.\s*$/, '');

const NAO_ENCONTRADOS = Object.freeze([
  'FAMILIA_PATRIMONIAL_NAO_ENCONTRADA',
  'TIPO_PATRIMONIAL_NAO_ENCONTRADO',
  'BEM_PATRIMONIAL_NAO_ENCONTRADO',
  'ABASTECIMENTO_NAO_ENCONTRADO',
]);

/** O registro aberto não existe mais (ou é de outro escopo): a tela relê a lista. @param {unknown} erro */
export const ehNaoEncontradoPatrimonio = (erro) => NAO_ENCONTRADOS.includes(lerErroGestao(erro).code ?? '');

/** Conflito de versão: outra pessoa gravou antes; a tela relê o registro. @param {unknown} erro */
export const ehConflitoDeVersaoPatrimonio = (erro) => lerErroGestao(erro).code === 'PATRIMONIO_VERSAO_CONFLITO';
