/**
 * D-PROD-197 — "preparar o terreno" (contrato
 * `docs/engineering/MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md` §3.5): o que a
 * atividade HERDA do Tipo de Atividade ao ser aberta e as REGRAS de como ela
 * funciona.
 *
 * Módulo PURO: sem Prisma, sem I/O, sem relógio. Recebe o tipo como o
 * repository devolve (`tipoAtividadeRepository.js`, com os 3 objetos incluídos:
 * `centroCustoPadrao`, `centroResultadoPadrao`, `unidadeProducao`); a forma
 * pública (`centro_custo_padrao`, `centro_resultado_padrao`,
 * `unidade_producao`) traz os mesmos campos e também é aceita.
 *
 * Nesta fatia nenhum fluxo de produção chama `padroesParaAtividade` nem
 * `regrasDoTipo` (a Fatia 2 os usa no "Abrir atividade"). As listas congeladas
 * são a fonte única do schema das rotas e espelham o CHECK
 * `TipoAtividade_categoria_check` da migration.
 */

/** As 9 categorias do tipo (CHECK `TipoAtividade_categoria_check`), nesta ordem. */
export const CATEGORIAS_TIPO_ATIVIDADE = Object.freeze([
  'PREPARO_SOLO',
  'PLANTIO',
  'TRATO_CULTURAL',
  'APLICACAO',
  'COLHEITA',
  'PASTAGEM',
  'BENFEITORIA',
  'MANEJO_ANIMAL',
  'OUTROS',
]);

/**
 * D-PROD-257 — os 7 TIPOS FIXOS dos serviços de pasto. O "tipo fixo" é a `categoria` do tipo de atividade (que agora é
 * obrigatória). Sem mudar a tabela nem o CHECK `TipoAtividade_categoria_check` (D-PROD-72 item 3): o tipo fixo usa 7 dos 9
 * valores já aceitos pelo banco. `TRATO_CULTURAL` passa a significar Fertilização (`FERTILIZACAO` não existe no CHECK); `PASTAGEM`, Roçada e tratos;
 * `BENFEITORIA`, Manutenção; `PLANTIO`, Formação de pastagem (plantio). `COLHEITA` e `MANEJO_ANIMAL` ficam FORA (não são
 * mais aceitos em escrita; o que já está gravado continua legível e o script de dados os leva a Outros).
 */
export const TIPOS_FIXOS_ATIVIDADE = Object.freeze([
  Object.freeze({ categoria: 'PREPARO_SOLO', rotulo: 'Preparo do solo' }),
  Object.freeze({ categoria: 'PLANTIO', rotulo: 'Formação de pastagem (plantio)' }),
  Object.freeze({ categoria: 'TRATO_CULTURAL', rotulo: 'Fertilização' }),
  Object.freeze({ categoria: 'APLICACAO', rotulo: 'Aplicação' }),
  Object.freeze({ categoria: 'PASTAGEM', rotulo: 'Roçada e tratos' }),
  Object.freeze({ categoria: 'BENFEITORIA', rotulo: 'Manutenção' }),
  Object.freeze({ categoria: 'OUTROS', rotulo: 'Outros' }),
]);

/** Só os valores dos 7 tipos fixos (a lista que a escrita aceita). */
/** @type {ReadonlyArray<string>} */
export const CATEGORIAS_TIPO_FIXO = Object.freeze(TIPOS_FIXOS_ATIVIDADE.map((t) => t.categoria));

/**
 * D-PROD-257 — padrão automático das chaves de uma operação nova (a tela não as mostra mais): a área é exigida e as quatro
 * seções (máquina com implemento, produto, mão de obra, serviço) são permitidas. As três chaves que EXIGEM dado
 * (safra, máquina, produção) ficam desligadas: ligá-las obrigaria o campo em todo registro e quebraria "tudo opcional".
 */
export const FLAGS_PADRAO_OPERACAO = Object.freeze({
  'exige_area': true,
  'exige_safra': false,
  'exige_maquina': false,
  'permite_implemento': true,
  'permite_produto': true,
  'permite_servico': true,
  'permite_mao_obra': true,
  'exige_producao': false,
});

/** Nome do grupo criado sozinho quando a operação é cadastrada sem grupo (o grupo saiu da tela). */
export const NOME_GRUPO_PADRAO_OPERACAO = 'GERAL';

/** @param {unknown} nome */
const semAcentoMinusculo = (nome) =>
  String(nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * D-PROD-257 — de que tipo fixo é uma operação que já existe: a categoria gravada (9 valores, ou nenhuma) → um dos 7.
 * Puro; é a regra do script de dados e do que a tela mostra para registro antigo.
 *  - Fertilização é nova (antes era "parte de Aplicação"): operação de APLICACAO ou TRATO_CULTURAL cujo NOME é de
 *    adubação/fertilização (adub, fertiliz, esterco, ureia) vai para Fertilização;
 *  - TRATO_CULTURAL (antigo "trato" em geral) que não é adubação vira Aplicação;
 *  - os demais valores aceitos (PREPARO_SOLO, PLANTIO, APLICACAO, PASTAGEM, BENFEITORIA, OUTROS) ficam como estão;
 *  - COLHEITA e MANEJO_ANIMAL (fora do escopo de pasto), sem categoria e valor desconhecido → Outros.
 * @param {string|null|undefined} categoria @param {string|null|undefined} nome
 * @returns {{ categoria: string, motivo: string }}
 */
export const tipoFixoDaOperacaoExistente = (categoria, nome) => {
  const atual = typeof categoria === 'string' ? categoria : null;
  const ehAdubacao = /aduba|fertiliz|esterco|ureia/.test(semAcentoMinusculo(nome));
  if ((atual === 'APLICACAO' || atual === 'TRATO_CULTURAL') && ehAdubacao) {
    return { categoria: 'TRATO_CULTURAL', motivo: `${atual} com nome de adubação: Fertilização` };
  }
  if (atual === 'TRATO_CULTURAL') return { categoria: 'APLICACAO', motivo: 'trato cultural sem nome de adubação: Aplicação' };
  if (atual && CATEGORIAS_TIPO_FIXO.includes(atual)) return { categoria: atual, motivo: 'já é um tipo fixo' };
  if (atual === 'COLHEITA' || atual === 'MANEJO_ANIMAL') return { categoria: 'OUTROS', motivo: `${atual} fora do escopo de pasto: Outros` };
  return { categoria: 'OUTROS', motivo: 'sem categoria: Outros' };
};

/**
 * D-PROD-254 (emenda 1) — o tipo que representa ABASTECIMENTO: o cadastro de tipos não tem categoria própria, então vale o
 * nome (o mesmo critério do desenho do tipo na tela: "abastec" ou "combust", sem acento nem caixa). Abastecimento é feito
 * pela MÁQUINA (tanque, litros, horímetro), nunca como registro de campo de uma área.
 * @param {unknown} nomeTipo
 */
export const ehTipoAbastecimento = (nomeTipo) =>
  /abastec|combust/.test(
    String(nomeTipo ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  );

/** As 8 flags de como a atividade do tipo funciona (`BOOLEAN NOT NULL DEFAULT false`), nesta ordem. */
export const FLAGS_TIPO_ATIVIDADE = Object.freeze([
  'exige_area',
  'exige_safra',
  'exige_maquina',
  'permite_implemento',
  'permite_produto',
  'permite_servico',
  'permite_mao_obra',
  'exige_producao',
]);

/**
 * Coeficiente padrão (Decimal(14, 4)) como TEXTO: até 10 dígitos inteiros e 4
 * casas — o mesmo formato do `PADRAO_DECIMAL` do apontamento de atividade.
 */
export const PADRAO_COEFICIENTE = /^\d{1,10}(\.\d{1,4})?$/;

/** Casas do coeficiente na resposta e na herança (`toFixed(4)`, como o apontamento). */
export const CASAS_COEFICIENTE = 4;

/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Objeto do cadastro incluído no tipo: a chave do repository ou, na falta
 * dela, a da forma pública. Ausente ou não-objeto → null.
 * @param {Record<string, any>} tipo @param {string} chaveRepository @param {string} chavePublica
 * @returns {Record<string, any>|null}
 */
const incluido = (tipo, chaveRepository, chavePublica) => {
  const valor = tipo[chaveRepository] !== undefined ? tipo[chaveRepository] : tipo[chavePublica];
  return ehObjeto(valor) ? valor : null;
};

/**
 * Centro padrão herdável: existe, está ATIVO e é da MESMA empresa da
 * atividade. Sem empresa da atividade, nada é herdado.
 * @param {Record<string, any>|null} centro @param {unknown} empresaId
 * @returns {string|null}
 */
const centroHerdado = (centro, empresaId) =>
  centro &&
  typeof centro.id === 'string' &&
  centro.ativo === true &&
  typeof empresaId === 'string' &&
  empresaId !== '' &&
  centro.empresa_id === empresaId
    ? centro.id
    : null;

/**
 * Texto canônico com 4 casas a partir do texto da API (`"1.5"` → `"1.5000"`),
 * sem float.
 * @param {string} texto  já casado com PADRAO_COEFICIENTE
 */
const comQuatroCasas = (texto) => {
  const [inteiro, fracao = ''] = texto.split('.');
  return `${inteiro.replace(/^0+(?=\d)/, '')}.${fracao.padEnd(CASAS_COEFICIENTE, '0')}`;
};

/**
 * Coeficiente herdado com 4 casas (`"1.5000"`, como a API) ou null. Aceita o
 * Decimal do Prisma (repository) e o texto da forma pública; número JS não
 * entra (decimal nunca passa por float).
 * @param {unknown} valor
 * @returns {string|null}
 */
const coeficienteHerdado = (valor) => {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') return PADRAO_COEFICIENTE.test(valor) ? comQuatroCasas(valor) : null;
  if (ehObjeto(valor) && typeof valor.toFixed === 'function') {
    const texto = String(valor.toFixed(CASAS_COEFICIENTE));
    return PADRAO_COEFICIENTE.test(texto) ? texto : null;
  }
  return null;
};

/**
 * Padrões que a atividade herda do tipo na criação. O centro só vale se
 * existir, estiver ativo e for da mesma empresa da atividade; a unidade só vale
 * se ativa; senão `null`. O coeficiente vem como gravado (4 casas) ou `null`.
 * @param {unknown} tipo  como o repository devolve (com os 3 objetos incluídos)
 * @param {{ empresaId?: string|null }} [opcoes]  empresa da atividade
 * @returns {{ centro_custo_id: string|null, centro_resultado_id: string|null, unidade_producao_id: string|null, coeficiente: string|null }}
 */
export const padroesParaAtividade = (tipo, { empresaId = null } = {}) => {
  if (!ehObjeto(tipo)) return { centro_custo_id: null, centro_resultado_id: null, unidade_producao_id: null, coeficiente: null };
  const unidade = incluido(tipo, 'unidadeProducao', 'unidade_producao');
  return {
    centro_custo_id: centroHerdado(incluido(tipo, 'centroCustoPadrao', 'centro_custo_padrao'), empresaId),
    centro_resultado_id: centroHerdado(incluido(tipo, 'centroResultadoPadrao', 'centro_resultado_padrao'), empresaId),
    unidade_producao_id: unidade && typeof unidade.id === 'string' && unidade.ativo === true ? unidade.id : null,
    coeficiente: coeficienteHerdado(tipo.coeficiente_padrao),
  };
};

/**
 * Regras do tipo: objeto SÓ com as 8 flags, booleanos (o que não for `true`
 * de verdade é `false`).
 * @param {unknown} tipo
 * @returns {Record<string, boolean>}
 */
export const regrasDoTipo = (tipo) =>
  Object.fromEntries(FLAGS_TIPO_ATIVIDADE.map((flag) => [flag, ehObjeto(tipo) && tipo[flag] === true]));
