/**
 * Mensagens em português dos erros de Patrimônio e Frota (D-PROD-157).
 *
 * Mesmo transporte de Gestão: o `nativeHttpClient` só preserva códigos
 * catalogados; os códigos de patrimônio chegam no corpo do servidor guardado em
 * `erro.cause`. Lemos SÓ `code`, `field`, `reason` e `details` (via
 * `lerErroGestao`) — a `message` do servidor nunca é exibida.
 */

import { getApiErrorMessage } from '@/apis/_core/ApiError';
import { lerErroGestao } from '@/lib/gestaoErros';
import { ROTULO_NATUREZA, rotuloDaUnidade } from '@/lib/patrimonioDominio';
import { formatarNumero } from '@/lib/dinheiroDecimal';
import { formatarDia } from '@/lib/diaCivil';

const NADA = 'Nada foi gravado.';

/** Rótulo dos campos que o servidor aponta em `field`/`details.field`. */
const ROTULO_CAMPO = /** @type {Record<string, string>} */ ({
  codigo: 'Código',
  nome: 'Nome',
  natureza: 'Natureza',
  descricao: 'Descrição',
  ordem: 'Ordem',
  vida_util_meses_padrao: 'Vida útil padrão',
  vida_util_meses_sugerida: 'Vida útil sugerida',
  familia_id: 'Família',
  tipo_id: 'Tipo',
  perfil_id: 'Perfil de medição',
  perfis: 'Perfis sugeridos',
  dimensao: 'Dimensão',
  finalidade: 'Finalidade',
  unidades_permitidas: 'Unidades permitidas',
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
  material: 'Material',
  ano_conclusao: 'Ano de conclusão',
  compatibilidade: 'Compatibilidade',
  especificacoes: 'Especificações',
  observacoes: 'Observações',
  medidor: 'Medidor',
  medicoes: 'Medições',
  tanques: 'Tanques',
  combustivel_ids: 'Combustíveis do tanque',
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
  tipo_combustivel_id: 'Combustível',
  // D-PROD-159 — Abastecimentos.
  quantidade_litros: 'Quantidade (L)',
  medidor_leitura: 'Leitura do medidor',
  tanque_id: 'Tanque',
  bem_id: 'Bem',
  local_estoque_id: 'Local de estoque',
  data_operacional: 'Data do abastecimento',
  kg_por_litro: 'Fator kg/L',
  referencia_externa: 'Referência externa',
  conversao_id: 'Fator kg/L',
  motivo: 'Motivo',
});

/** "medicoes[2].valor" / "tanques.1.capacidade_litros" → rótulo do último campo conhecido. @param {string|null} campo */
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
 * filhos: `medicoes[1].valor`, `tanques[0].capacidade_litros`.
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

const PERFIS_INVALIDOS = /** @type {Record<string, string>} */ ({
  duplicado: 'O mesmo perfil de medição foi escolhido mais de uma vez.',
  principal_duplicado: 'Só um perfil pode ser o principal.',
  limite: 'Um tipo pode ter no máximo 10 perfis sugeridos.',
  inativo: 'Há perfil de medição inativo na escolha: só perfis ativos podem ser adicionados.',
  inexistente: 'Há perfil de medição que não existe mais. Atualize a escolha.',
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
    case 'PERFIL_MEDICAO_NAO_ENCONTRADO':
      return 'Perfil de medição não encontrado. A lista será atualizada.';
    case 'COMBUSTIVEL_NAO_ENCONTRADO':
      return 'Combustível não encontrado. A lista será atualizada.';
    case 'BEM_PATRIMONIAL_NAO_ENCONTRADO':
      return 'Bem patrimonial não encontrado nesta empresa. A lista será atualizada.';
    case 'PATRIMONIO_CODIGO_DUPLICADO':
      return `Já existe um cadastro com este código. Use outro código. ${NADA}`;
    case 'PATRIMONIO_NOME_DUPLICADO':
      return `Já existe um cadastro com este nome (no tipo, dentro da mesma família). Use outro nome. ${NADA}`;
    case 'TIPO_PERFIS_NAO_APLICAVEIS':
      return `Perfis de medição só podem ser sugeridos para tipos de uma família de Benfeitorias. ${NADA}`;
    case 'TIPO_PERFIS_INVALIDOS':
      return `${PERFIS_INVALIDOS[reason ?? ''] ?? 'Perfis sugeridos inválidos.'} ${NADA}`;
    case 'PERFIL_UNIDADE_EM_USO': {
      // O servidor manda a LISTA das unidades em uso (`details.unidades`).
      const unidades = Array.isArray(details.unidades) ? details.unidades.filter((u) => typeof u === 'string').map(rotuloDaUnidade) : [];
      const quais = unidades.length ? ` (${unidades.join(', ')})` : '';
      return `Não é possível retirar ${unidades.length > 1 ? 'unidades' : 'uma unidade'}${quais} já usada${unidades.length > 1 ? 's' : ''} em medições de bens. ${NADA}`;
    }
    case 'PERFIL_UNIDADES_INVALIDAS':
      return `Unidades permitidas inválidas: escolha unidades da mesma dimensão, sempre com a unidade padrão. ${NADA}`;
    case 'BEM_REFERENCIA_INVALIDA':
      if (reason === 'inativo') return `${campo ? `"${campo}"` : 'O item escolhido'} está inativo: escolha um ativo. ${NADA}`;
      return `${campo ? `A escolha em "${campo}"` : 'Uma das escolhas'} não é válida (não existe mais, é de outra empresa ou está inativa). Escolha outra. ${NADA}`;
    case 'BEM_TIPO_FAMILIA_INCOMPATIVEL':
      return `O tipo escolhido não pertence à família escolhida. ${NADA}`;
    case 'BEM_NATUREZA_IMUTAVEL':
      return `A natureza do bem não muda: escolha uma família da mesma natureza. ${NADA}`;
    case 'BEM_CAMPO_NAO_APLICAVEL': {
      const natureza = /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[String(details.natureza ?? '')];
      return `${campo ? `"${campo}"` : 'Um dos campos'} não se aplica a ${natureza ? `bens de natureza ${natureza}` : 'esta natureza de bem'}. ${NADA}`;
    }
    case 'BEM_CAMPO_INVALIDO':
      return `${CAMPO_INVALIDO[String(field ?? '')] ?? `Valor inválido em "${campo ?? 'campo'}".`} ${NADA}`;
    case 'BEM_CODIGO_FROTA_DUPLICADO':
      return `Já existe um bem com este código de frota nesta empresa. ${NADA}`;
    case 'BEM_CODIGO_FROTA_INVALIDO':
      return `Código de frota inválido: use letras e números, separados por espaço ou hífen (ex.: TP-02). ${NADA}`;
    case 'BEM_CLASSIFICACAO_INATIVA':
      return `Para reativar o bem, a família e o tipo dele precisam estar ativos. Reative-os antes. ${NADA}`;
    case 'MEDICAO_UNIDADE_INCOMPATIVEL':
      return `A unidade da medição${naLinha(field)} não é permitida para o perfil escolhido. ${NADA}`;
    case 'MEDICAO_PERFIL_DUPLICADO':
      if (reason === 'perfil_imutavel') return `O perfil de uma medição já gravada não muda: retire a medição e crie outra. ${NADA}`;
      return `O mesmo perfil de medição aparece mais de uma vez no bem. ${NADA}`;
    case 'MEDICAO_PRINCIPAL_DUPLICADA':
      return `Só uma medição pode ser a principal. ${NADA}`;
    case 'MEDICAO_VALOR_INVALIDO':
      if (reason === 'deve_ser_inteiro') return `Para quantidade e cabeças, informe um número inteiro${naLinha(field)}. ${NADA}`;
      return `Valor da medição inválido${naLinha(field)}: informe um número maior que zero, com até 4 casas decimais. ${NADA}`;
    case 'MEDICAO_LIMITE_EXCEDIDO':
      return `Um bem pode ter no máximo 20 medições. ${NADA}`;
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
    case 'TANQUE_COMBUSTIVEL_OBRIGATORIO':
      return `Cada tanque precisa de pelo menos um combustível, sem repetição${naLinha(field)}. ${NADA}`;
    case 'TANQUE_COMBUSTIVEL_INCOMPATIVEL':
      return `Tanque só aceita combustíveis medidos em litros (combustível em m³, como o GNV, não vai em tanque). ${NADA}`;
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
    // ─── Combustível × Produto por empresa (R2) ───
    case 'COMBUSTIVEL_PRODUTO_INVALIDO':
      if (field === 'tipo_combustivel_id' || reason === 'tipo_inativo') return `O combustível está inativo (ou não existe mais): reative-o antes de vincular produtos. ${NADA}`;
      if (reason === 'outra_empresa') return `O produto escolhido é de outra fazenda: só produtos desta fazenda podem ser vinculados. ${NADA}`;
      if (reason === 'inativo') return `O produto escolhido está inativo: só produtos ativos podem ser vinculados. ${NADA}`;
      return `O produto escolhido não existe nesta fazenda (ou não está mais disponível). Atualize a lista e escolha outro. ${NADA}`;
    case 'COMBUSTIVEL_PRODUTO_DUPLICADO':
      if (reason === 'inativo_reative') return `Este produto já foi vinculado a este combustível nesta fazenda e o vínculo está inativo: reative-o na lista. ${NADA}`;
      return `Este produto já está vinculado a este combustível nesta fazenda. ${NADA}`;
    case 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO':
      return `Este produto já está vinculado a outro combustível nesta fazenda: um produto só pode ter um combustível ativo. Inative aquele vínculo antes. ${NADA}`;
    case 'COMBUSTIVEL_PRODUTO_NAO_ENCONTRADO':
      return 'Vínculo de produto não encontrado nesta fazenda. A lista será atualizada.';
    case 'PRODUTO_VINCULADO_COMBUSTIVEL':
      return `Este produto está vinculado a um combustível do Patrimônio nesta fazenda: ele não pode mudar de fazenda. Inative o vínculo na tela Combustíveis antes. ${NADA}`;
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
  switch (code) {
    case 'ABASTECIMENTO_NAO_ENCONTRADO':
      return 'Abastecimento não encontrado nesta fazenda. A lista será atualizada.';
    case 'CONVERSAO_COMBUSTIVEL_NAO_ENCONTRADA':
      return 'Fator kg/L não encontrado nesta fazenda. A lista será atualizada.';
    case 'ABASTECIMENTO_STATUS_INVALIDO':
      return 'Este abastecimento já foi cancelado. Nada foi alterado.';
    case 'ABASTECIMENTO_BEM_INELEGIVEL':
      if (reason === 'natureza_sem_tanque') return `Este bem não tem tanque de combustível. ${NADA}`;
      return `O bem está inativo: reative-o antes de abastecer. ${NADA}`;
    case 'ABASTECIMENTO_TANQUE_INVALIDO':
      if (reason === 'tanque_inativo') return `O tanque está inativo. ${NADA}`;
      return `O tanque não pertence mais a este bem. ${NADA}`;
    case 'COMBUSTIVEL_PRODUTO_INVALIDO':
      if (field === 'tipo_combustivel_id' || reason === 'tipo_inexistente' || reason === 'tipo_inativo') return `O combustível está inativo ou não existe mais. ${NADA}`;
      if (reason === 'outra_empresa') return `O produto é de outra fazenda. ${NADA}`;
      if (reason === 'inativo') return `O produto está inativo. ${NADA}`;
      if (reason === 'sem_vinculo_ativo') return `O Produto não está mais associado ao combustível deste bem (cadastro de Combustíveis). Escolha o Produto de novo. ${NADA}`;
      return `O produto não existe nesta fazenda. ${NADA}`;
    case 'TANQUE_COMBUSTIVEL_INCOMPATIVEL':
      return `Este tanque não aceita este combustível (o tanque só recebe combustível em litros e dos tipos cadastrados nele). ${NADA}`;
    case 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL':
      return `O estoque deste produto não está em KG: a baixa não é feita. Ajuste a unidade de estoque do produto. ${NADA}`;
    case 'ABASTECIMENTO_CONVERSAO_AUSENTE':
      return `Não há fator kg/L configurado para este Produto nesta fazenda. Configure o fator antes de confirmar. ${NADA}`;
    case 'ABASTECIMENTO_CONVERSAO_ALTERADA':
      return `O fator kg/L mudou desde a revisão. Revise de novo antes de confirmar. ${NADA}`;
    case 'ABASTECIMENTO_CONVERSAO_INVALIDA':
      if (field === 'declara_estoque_em_kg' || reason === 'declaracao_obrigatoria') return `Marque a declaração de que o estoque está em KG. ${NADA}`;
      return `Fator inválido: informe um número maior que zero e até 10, com até 6 casas. ${NADA}`;
    case 'ABASTECIMENTO_LOCAL_INVALIDO':
      return `O local de estoque não existe mais ou está inativo. ${NADA}`;
    case 'ABASTECIMENTO_EXCEDE_CAPACIDADE':
      return `Os litros passam da capacidade nominal do tanque (${numeroBr(details.capacidade_litros)} L). ${NADA}`;
    case 'ABASTECIMENTO_DATA_FUTURA':
      return `A data é posterior a hoje na fazenda (${diaBr(details.hoje)}): só abastecimento já feito entra. ${NADA}`;
    case 'OPERACAO_VALORES_INVALIDOS':
      if (reason === 'quantidade_nao_positiva') return `Informe litros maiores que zero. ${NADA}`;
      if (reason === 'quantidade_estoque_zero') return `Os litros convertidos dão 0 kg (4 casas): aumente a quantidade ou revise o fator. ${NADA}`;
      return `Quantidade ou custo acima do limite do estoque. ${NADA}`;
    case 'ESTOQUE_SALDO_INSUFICIENTE':
      if (reason === 'estoque_atual_insuficiente') return `O estoque atual do produto é menor que o pedido. ${NADA}`;
      return `Saldo insuficiente deste produto neste local: disponível ${numeroBr(details.disponivel)} kg, pedido ${numeroBr(details.solicitado)} kg. ${NADA}`;
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
 * Erros da tela de fatores kg/L: o conflito de versão é do FATOR (outra pessoa
 * alterou ou encerrou depois da leitura da lista), não de um abastecimento; o
 * resto segue as mensagens do abastecimento.
 * @param {unknown} erro
 * @param {string} fallback
 */
export const mensagemErroConversao = (erro, fallback) =>
  lerErroGestao(erro).code === 'PATRIMONIO_VERSAO_CONFLITO'
    ? 'O fator mudou desde que a lista foi lida (outra pessoa alterou ou encerrou). A lista foi relida; nada foi alterado.'
    : mensagemErroAbastecimento(erro, fallback);

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
  'PERFIL_MEDICAO_NAO_ENCONTRADO',
  'COMBUSTIVEL_NAO_ENCONTRADO',
  'BEM_PATRIMONIAL_NAO_ENCONTRADO',
  'ABASTECIMENTO_NAO_ENCONTRADO',
  'CONVERSAO_COMBUSTIVEL_NAO_ENCONTRADA',
]);

/** O registro aberto não existe mais (ou é de outro escopo): a tela relê a lista. @param {unknown} erro */
export const ehNaoEncontradoPatrimonio = (erro) => NAO_ENCONTRADOS.includes(lerErroGestao(erro).code ?? '');

/** Conflito de versão: outra pessoa gravou antes; a tela relê o registro. @param {unknown} erro */
export const ehConflitoDeVersaoPatrimonio = (erro) => lerErroGestao(erro).code === 'PATRIMONIO_VERSAO_CONFLITO';
