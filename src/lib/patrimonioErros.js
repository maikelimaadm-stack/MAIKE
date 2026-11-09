/**
 * Mensagens em português dos erros de Patrimônio e Frota (D-PROD-156).
 *
 * Mesmo transporte de Gestão: o `nativeHttpClient` só preserva códigos
 * catalogados; os códigos de patrimônio chegam no corpo do servidor guardado em
 * `erro.cause`. Lemos SÓ `code`, `field`, `reason` e `details` (via
 * `lerErroGestao`) — a `message` do servidor nunca é exibida.
 */

import { getApiErrorMessage } from '@/apis/_core/ApiError';
import { lerErroGestao } from '@/lib/gestaoErros';
import { ROTULO_NATUREZA } from '@/lib/patrimonioDominio';

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

/** " (linha 2)" a partir de `details.indice` (0-based). @param {Record<string, any>} details */
const naLinha = (details) => (Number.isInteger(details.indice) ? ` (linha ${details.indice + 1})` : '');

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
      const unidade = typeof details.unidade === 'string' ? ` (${details.unidade})` : '';
      return `Não é possível retirar uma unidade${unidade} que já é usada em medições de bens. ${NADA}`;
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
      return `A unidade da medição${naLinha(details)} não é permitida para o perfil escolhido. ${NADA}`;
    case 'MEDICAO_PERFIL_DUPLICADO':
      if (reason === 'perfil_imutavel') return `O perfil de uma medição já gravada não muda: retire a medição e crie outra. ${NADA}`;
      return `O mesmo perfil de medição aparece mais de uma vez no bem. ${NADA}`;
    case 'MEDICAO_PRINCIPAL_DUPLICADA':
      return `Só uma medição pode ser a principal. ${NADA}`;
    case 'MEDICAO_VALOR_INVALIDO':
      if (reason === 'deve_ser_inteiro') return `Para quantidade e cabeças, informe um número inteiro${naLinha(details)}. ${NADA}`;
      return `Valor da medição inválido${naLinha(details)}: informe um número maior que zero, com até 4 casas decimais. ${NADA}`;
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
      return `Leitura do medidor inválida: informe um número maior ou igual a zero. ${NADA}`;
    case 'TANQUE_IDENTIFICADOR_DUPLICADO':
      return `Há tanques com o mesmo identificador neste bem (tanques inativos também reservam o identificador). ${NADA}`;
    case 'TANQUE_CAPACIDADE_INVALIDA':
      return `Capacidade do tanque inválida${naLinha(details)}: informe os litros, maior que zero. ${NADA}`;
    case 'TANQUE_COMBUSTIVEL_OBRIGATORIO':
      return `Cada tanque precisa de pelo menos um combustível, sem repetição${naLinha(details)}. ${NADA}`;
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

const NAO_ENCONTRADOS = Object.freeze([
  'FAMILIA_PATRIMONIAL_NAO_ENCONTRADA',
  'TIPO_PATRIMONIAL_NAO_ENCONTRADO',
  'PERFIL_MEDICAO_NAO_ENCONTRADO',
  'COMBUSTIVEL_NAO_ENCONTRADO',
  'BEM_PATRIMONIAL_NAO_ENCONTRADO',
]);

/** O registro aberto não existe mais (ou é de outro escopo): a tela relê a lista. @param {unknown} erro */
export const ehNaoEncontradoPatrimonio = (erro) => NAO_ENCONTRADOS.includes(lerErroGestao(erro).code ?? '');

/** Conflito de versão: outra pessoa gravou antes; a tela relê o registro. @param {unknown} erro */
export const ehConflitoDeVersaoPatrimonio = (erro) => lerErroGestao(erro).code === 'PATRIMONIO_VERSAO_CONFLITO';
