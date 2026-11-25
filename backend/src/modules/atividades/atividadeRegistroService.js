/**
 * D-PROD-254 — REGISTRO DE CAMPO: `POST /atividades/registrar`.
 *
 * Quem está na área (Detalhes da área no mapa ou a tela Atividades) registra o trabalho feito ("Gradeação, trator TP-02,
 * 6,5 h, 7 ha") sem planejar antes. Numa transação só:
 *
 *  1. empresa do tenant, "hoje" no fuso da fazenda, dia não futuro, área do mapa (da fazenda, ativa) e tipo (ativo);
 *  2. trava consultiva por (cliente, empresa, tipo, área, mês do dia) — `pg_advisory_xact_lock` ANTES da busca: dois
 *     registros paralelos da mesma área/tipo/mês se enfileiram e o segundo encontra a atividade criada pelo primeiro;
 *  3. ENTRA na atividade ABERTA do mesmo tipo, da mesma fazenda, com `data_inicio` no MESMO mês do dia do registro
 *     ([1º do mês, 1º do mês seguinte), calculado da string do dia) que contenha a área com status PLANEJADA ou
 *     EM_ANDAMENTO (área CONCLUIDA não casa: abre outra). Havendo mais de uma, entra na de `updatedAt` mais recente
 *     (desempate: `id` maior). Sem nenhuma, CRIA `<Tipo> · <Área> · <mmm/aa>` (`abrirNa`, a regra de abertura de sempre:
 *     área já EM_ANDAMENTO desde o dia do registro, planejada = tamanho da área; tipo que exige máquina usa a primeira
 *     máquina das linhas; safra vem do corpo);
 *  4. área PLANEJADA da atividade existente é iniciada (mesmo efeito de "Iniciar área");
 *  5. o apontamento + linhas são gravados pela MESMA função do `POST …/apontamentos` (`lancarNaTransacao`).
 *
 * D-PROD-263 — VÁRIAS ÁREAS num registro só (`areas: [{ area_id, hectares }]`, 1..20, no lugar de `area_id`; um dos
 * dois, nunca os dois). Os hectares de cada área são o `area_executada_dia` do apontamento dela (o `area_executada_dia`
 * do corpo não vem). Com UMA área, é exatamente o `area_id` de antes com aqueles hectares (mesma busca, mesmo nome, mesmo
 * fingerprint). Com várias:
 *  - a trava do passo 2 é tomada para CADA área, em ordem de `area_id` (sem deadlock entre registros com áreas em comum);
 *  - a busca do passo 3 tenta as áreas na ordem do corpo: a primeira que casa dá a atividade. As áreas que faltam nela
 *    entram (`adicionarAreaNaTransacao`) e, com as PLANEJADAS, são iniciadas no dia (`iniciarAreaNaTransacao`). Área
 *    CONCLUIDA nessa atividade é recusada (409 da regra do lançamento), nunca reaberta sozinha. Sem nenhuma, CRIA uma
 *    atividade com TODAS as áreas (`abrirNa` com `areas[]`, cada uma iniciada no dia), `<Tipo> · <Área 1> +N · <mmm/aa>`
 *    (N = as outras áreas);
 *  - UMA atividade e UM apontamento por área (operador, observação e turno em todos), com as linhas repartidas pelos
 *    hectares (`atividadeRegistroRateio.js`): o cliente manda os totais, o servidor corta. Cada parte passa pelas regras
 *    de sempre da linha (estoque pelo motor, medidor, custos);
 *  - a recusa de uma área diz qual (`details.area_id`, `details.area_indice`) e a linha na posição do CORPO.
 *
 * D-PROD-265 — `data_termino` opcional (Nova realização: Data de início = `data_operacional`, Data de término): o último
 * dia do serviço, o MESMO em todas as áreas. Nunca antes do início (400 `data_termino`/`periodo_invertido`; o CHECK do banco
 * também recusa) nem no futuro da fazenda (422 `ATIVIDADE_DATA_INVALIDA` `futura`, como o dia). Só esta rota a recebe.
 *
 * D-PROD-267 — SERVIÇO DE VÁRIOS DIAS ("abre uma vez e vai somando os dias"):
 *  - SEM a regra do mês: o passo 3 acha a atividade ABERTA da operação (`tipo_atividade_id`) que contém a área PLANEJADA
 *    ou EM_ANDAMENTO, em qualquer mês (a roçada de 28/11 a 07/12 é UMA atividade). O nome da atividade nova continua com o
 *    mês do início. A trava do passo 2 perde o mês: uma por (cliente, empresa, operação, área), em ordem de `area_id`;
 *  - "PARADO": se o último dia lançado nela, nas áreas do registro (o maior `data_operacional`/`data_termino` CONFIRMADO),
 *    é de mais de `DIAS_PARADO_MAXIMO` (30) dias antes do dia do registro, o servidor não junta sozinho: sem decisão no
 *    corpo → 409 `ATIVIDADE_SERVICO_PARADO` (`details`: atividade_id, atividade_nome, ultimo_dia, area_id, dias_parado,
 *    limite_dias), nada gravado, NEM o recibo (o reenvio com a decisão usa a mesma `operation_id`). `nova_atividade: false`
 *    = continuar nela; `true` = é um serviço novo: as áreas do registro em andamento nela são concluídas, cada uma no
 *    último dia lançado nela (e a atividade, se todas as áreas ficam concluídas), e uma atividade NOVA é criada. A decisão
 *    só vale quando a atividade achada está parada (sem estar parada, o registro continua nela);
 *  - `concluir: true` ("Como fica depois de salvar? Concluída"): depois de gravar o(s) dia(s), as áreas DESTE registro
 *    concluem na atividade em `data_termino ?? data_operacional` (a regra de "Concluir área": nunca antes do início nem
 *    do último dia lançado nela) e, com todas as áreas concluídas, a atividade também (`concluirAtividadeSeAreasConcluidas`).
 *    Sem ele (ou `false`), nada conclui: nem aos 100%.
 *  Os dois campos exigem também a permissão de editar a atividade (a de concluir), além da de lançar (guarda da rota).
 *
 * Idempotência: `operation_id` obrigatório (recibo `atividade_registrar_v1`; reenvio igual → 200 `replay: true`;
 * corpo diferente → 409). D-PROD-265: sem `data_termino`, o fingerprint é byte a byte o de antes (nenhuma chave nova), e o
 * reenvio pendente de antes do deploy ainda casa; com ela, ela entra no fingerprint. Com várias áreas, o apontamento da área i (0-based) grava as linhas com a chave
 * `<operation_id>` (i = 0) ou `<operation_id>:a<i+1>`, que deriva as das linhas como sempre (`:p1`, `:o1`, `:s1`).
 * Permissão = a de lançar apontamento (`atividadeApontamentos.criar`). Tenant só do auth_context.
 * D-PROD-267: `concluir` e `nova_atividade` entram no fingerprint só quando vêm (sem eles, byte a byte o de antes).
 *
 * D-PROD-274 (MAIKE-ENTREGA2) — os campos de cada TIPO FIXO (a `categoria` da operação):
 *  - PLANTIO ("Plantio de pastagem"): `plantio: { cultura_id, forma_plantio?, semente_incrustada?, cobertura?,
 *    consorcio_cultura_id? }` é OBRIGATÓRIO (o capim, do Cadastro de Culturas da MESMA fazenda e ativo; 422 se não). A busca
 *    do passo 3 só acha a atividade de plantio com o MESMO capim: capim diferente abre outra. Ao criar, grava a
 *    `AtividadePlantio` (1 para 1); ao continuar, só completa o que estava vazio (nunca sobrescreve). Fora do PLANTIO, 400;
 *  - SAFRA automática: sem `safra_ciclo` no corpo, a atividade NOVA de Plantio, de Fertilização (TRATO_CULTURAL) ou de
 *    operação com `exige_safra` recebe o ano agrícola do dia, de 1º de julho a 30 de junho (`safraDoDia`: 28/11/2026 e
 *    15/01/2027 → "2026/27"). É calculada DEPOIS do fingerprint (que segue com `safra_ciclo: null`);
 *  - APLICACAO: `numero_receituario` opcional (texto curto, no apontamento de cada área); fora da Aplicação, 400;
 *  - BENFEITORIA e OUTROS (Manutenção e Outros): a ÁREA É OPCIONAL. Sem `area_id`/`areas`, `local` é obrigatório (texto,
 *    em MAIÚSCULAS); a atividade é buscada pelo MESMO local (aberta, da operação, sem área) e a trava é por local; com
 *    área, `local` → 400. `unidade_producao_sigla` (KM | M | UN, opcional) é a unidade da quantidade feita
 *    (`quantidade_produzida_dia`) quando a operação não tem unidade de produção; diferente da do serviço → 422;
 *  - a linha de insumo aceita `vc_percentual` (o VC da semente, 0 < VC ≤ 100, até 2 casas, sem CHECK no banco);
 *  - a resposta traz `registro.pasto_liberado_em` (o fim — término ou dia — mais a maior carência dos produtos lançados,
 *    do cadastro do produto) e `registro.carencia_dias`; nada é gravado (calculado na leitura).
 * Os campos novos entram no fingerprint SÓ quando vêm: sem eles, byte a byte o de antes (`v: 1`/`v: 2`). O registro sem
 * área usa `v: 3`. Com várias áreas, a quantidade feita é repartida pelos hectares, como as linhas.
 *
 * D-PROD-276 (MAIKE-ENTREGA3) — "FAZ PARTE DE" a reforma: `planejamento_id` opcional (id ou null). Com ele, a reforma tem de
 * ser da MESMA fazenda, ABERTA e ter TODAS as áreas do registro (senão 422 `ATIVIDADE_REFERENCIA_INVALIDA`, `field`
 * `planejamento_id`: `inexistente` | `fechado` | `area_fora`), conferida ANTES das áreas e travada `FOR SHARE`. A atividade
 * NOVA nasce ligada a ela; a que CONTINUA só é ligada se ainda não tinha reforma (nunca troca uma ligação diferente: a
 * resposta diz `planejamento_ligacao` = `criada` | `completada` | `ja_ligada` | `mantida_outra`). Sem área (Manutenção e
 * Outros com o local) não liga: 400 `sem_area`. Entra no fingerprint só quando vem (sem ele, byte a byte o de antes).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError, atividadeDataInvalida, atividadeReferenciaInvalida, atividadeServicoParado } from '../../shared/errors/AppError.js';
import { fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import {
  PADRAO_DECIMAL,
  STATUS_ATIVIDADE,
  carregarAtividadeDetalhe,
  comoData,
  decimalDoCorpo,
  diaDe,
  diaDoCorpo,
  exigirDiaNaoFuturo,
  idOuNulo,
  pastoLiberadoEm,
  temCampo,
  tempoDaFazenda,
  travarAtividade,
} from './atividadeComum.js';
import {
  VAZIO,
  camposDoCorpo,
  canonico,
  comReciboOpcional,
  exigirData,
  lancarNaTransacao,
  linhasDoCorpo,
  linhasNovasDoFingerprint,
  origemDoCorpo,
} from './atividadeApontamentoService.js';
import {
  STATUS_AREA,
  adicionarAreaNaTransacao,
  concluirAreaNaTransacao,
  concluirAtividadeSeAreasConcluidas,
  exigirAreaDoMapa,
  iniciarAreaNaTransacao,
  ultimoDiaDaAtividade,
  ultimosDiasDasAreas,
} from './atividadeAreaService.js';
import { buscarAreaDaAtividade } from './atividadeAreaRepository.js';
import { camposDaLinha as camposDaLinhaMaquina, leituraVigenteDoBem } from './atividadeApontamentoMaquinaService.js';
import { travarBens } from './atividadeApontamentoMaquinaRepository.js';
import { partesPorHectares, trechosDoMedidor } from './atividadeRegistroRateio.js';
import { CATEGORIAS_TIPO_FIXO, ehTipoAbastecimento } from '../tiposAtividade/tipoAtividadePadroes.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { lerTipoAtividade } from './atividadeRepository.js';
import { NOME_MAXIMO, abrirNa } from './atividadeService.js';
import { exigirPlanejamentoDoRegistro } from './planejamentoService.js';

export const TIPO_OPERACAO_REGISTRAR = 'atividade_registrar_v1';

/** D-PROD-263 — teto de áreas num registro (o schema da rota confere o mesmo). */
export const AREAS_NO_REGISTRO_MAXIMO = 20;

/**
 * D-PROD-267 — a trava "serviço parado": último dia lançado na atividade achada (nas áreas do registro) mais de N dias
 * antes do dia do registro → o servidor pergunta (409 `ATIVIDADE_SERVICO_PARADO`) em vez de juntar sozinho.
 */
export const DIAS_PARADO_MAXIMO = 30;

/** Dias corridos de `de` até `ate` (`AAAA-MM-DD`; negativo se `ate` vem antes). @param {string} de @param {string} ate */
export const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);

const MESES = Object.freeze(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);

/** `2026-11-17` → `nov/26`. @param {string} dia */
export const mesAbreviado = (dia) => `${MESES[Number(dia.slice(5, 7)) - 1]}/${dia.slice(2, 4)}`;

/**
 * `<Tipo> · <Área> · <mmm/aa>` (D-PROD-263: com outras áreas, `<Tipo> · <Área 1> +N · <mmm/aa>`), sempre dentro de
 * `NOME_MAXIMO`: passando, a ÁREA é truncada primeiro (o `+N` fica); se o tipo sozinho já não couber (o tipo aceita até
 * 255 caracteres e o nome da atividade até `NOME_MAXIMO`), o tipo também é truncado.
 * @param {string} tipo @param {string} area @param {string} dia @param {number} [outras]  quantas áreas além da 1ª
 */
export const nomeDoRegistro = (tipo, area, dia, outras = 0) => {
  const sep = ' · ';
  const pos = `${outras > 0 ? ` +${outras}` : ''}${sep}${mesAbreviado(dia)}`;
  const AREA_MINIMA = 1;
  const tetoTipo = NOME_MAXIMO - pos.length - sep.length - AREA_MINIMA;
  const t = tipo.length > tetoTipo ? tipo.slice(0, tetoTipo).trimEnd() : tipo;
  const sobra = NOME_MAXIMO - t.length - sep.length - pos.length;
  const a = area.length > sobra ? area.slice(0, Math.max(sobra, AREA_MINIMA)).trimEnd() : area;
  return `${t}${sep}${a}${pos}`.slice(0, NOME_MAXIMO);
};

/**
 * Primeiro dia do mês do dia e do mês seguinte (strings → `Date` UTC de coluna `@db.Date`). D-PROD-267: o registro não
 * usa mais o mês; fica para os custos do mês do resumo da área (`atividadePorAreaService.js`).
 * @param {string} dia
 */
export const limitesDoMes = (dia) => {
  const ano = Number(dia.slice(0, 4));
  const mes = Number(dia.slice(5, 7));
  const prox = mes === 12 ? `${ano + 1}-01-01` : `${String(ano).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-01`;
  return { de: comoData(`${dia.slice(0, 7)}-01`), ate: comoData(prox) };
};

/**
 * D-PROD-263 — `areas[]` do registro: 1..20 itens `{ area_id, hectares }`, a mesma área nunca duas vezes (422 `duplicada`,
 * no índice da repetição, como na abertura da atividade), hectares em texto decimal (400 `formato`, as regras de
 * `area_executada_dia`) e maiores que zero (400 `nao_positivo`).
 * @param {unknown} v
 * @returns {Array<{ area_id: string, hectares: string }>}
 */
export const areasDoRegistro = (v) => {
  if (!Array.isArray(v) || v.length === 0) throw invalido('areas deve ter ao menos uma área', { field: 'areas', reason: 'obrigatorio' });
  if (v.length > AREAS_NO_REGISTRO_MAXIMO) throw invalido(`areas aceita no máximo ${AREAS_NO_REGISTRO_MAXIMO} áreas`, { field: 'areas', reason: 'longo' });
  const vistas = new Set();
  return v.map((item, i) => {
    const areaId = idOuNulo(item?.area_id, `areas[${i}].area_id`);
    if (!areaId) throw invalido(`areas[${i}].area_id é obrigatório`, { field: `areas[${i}].area_id`, reason: 'obrigatorio' });
    if (vistas.has(areaId)) throw atividadeReferenciaInvalida(`areas[${i}].area_id`, 'duplicada');
    vistas.add(areaId);
    const campo = `areas[${i}].hectares`;
    const hectares = decimalDoCorpo(item?.hectares, campo);
    if (hectares === null || hectares === undefined) throw invalido(`${campo} é obrigatório`, { field: campo, reason: 'obrigatorio' });
    if (!dec(hectares).gt(0)) throw invalido(`${campo} deve ser maior que zero`, { field: campo, reason: 'nao_positivo' });
    return { area_id: areaId, hectares };
  });
};

// ─── os campos de cada tipo (D-PROD-274, MAIKE-ENTREGA2) ─────────────────────

/** As formas de plantio (CHECK `AtividadePlantio_forma_plantio_check`). */
export const FORMAS_PLANTIO = Object.freeze(['A_LANCO', 'EM_LINHA', 'AEREA', 'MUDA']);

/** Os tipos fixos em que a área é OPCIONAL no registro (sem área, o `local` é obrigatório): Manutenção e Outros. */
export const TIPOS_SEM_AREA = Object.freeze(['BENFEITORIA', 'OUTROS']);

/** Os tipos fixos que recebem a SAFRA automática (além das operações com `exige_safra`): Plantio e Fertilização. */
export const TIPOS_COM_SAFRA = Object.freeze(['PLANTIO', 'TRATO_CULTURAL']);

/** As unidades da quantidade feita quando a operação não tem unidade de produção: km, m e unidades. */
export const UNIDADES_FEITAS = Object.freeze(['KM', 'M', 'UN']);

/** Tamanhos (colunas sem CHECK: a API confere). */
export const LOCAL_MAXIMO = 120;
export const RECEITUARIO_MAXIMO = 40;

/** O tipo fixo de uma categoria: um dos 7 (o que não for, Outros). @param {unknown} categoria */
export const tipoFixoDaCategoria = (categoria) => (typeof categoria === 'string' && CATEGORIAS_TIPO_FIXO.includes(categoria) ? categoria : 'OUTROS');

/**
 * O ANO AGRÍCOLA do dia, de 1º de julho a 30 de junho (o do Plano Safra), no formato "AAAA/AA": 28/11/2026 e 15/01/2027 →
 * "2026/27"; 30/06/2027 → "2026/27"; 01/07/2027 → "2027/28".
 * @param {string} dia  `AAAA-MM-DD`
 */
export const safraDoDia = (dia) => {
  const ano = Number(dia.slice(0, 4));
  const inicio = Number(dia.slice(5, 7)) >= 7 ? ano : ano - 1;
  return `${inicio}/${String(inicio + 1).slice(-2)}`;
};

/**
 * "Pasto liberado em": o fim do serviço (término ou dia) mais a MAIOR carência (dias) entre os produtos aplicados. Sem
 * nenhuma carência cadastrada, null (o sistema não inventa prazo). A regra mora em `atividadeComum.js` (o detalhe da
 * atividade calcula o mesmo na leitura); daqui ela segue exportada como antes.
 */
export { pastoLiberadoEm };

/**
 * O LOCAL do serviço sem área (Manutenção e Outros): texto aparado, espaços juntados, em MAIÚSCULAS, até 120 caracteres
 * (caractere de controle ou marcação → 400). Vazio ou null = sem local.
 * @param {unknown} v @returns {string|null}
 */
export const localDoCorpo = (v) => {
  const texto = textoDoCorpo(v, 'local', { maiusculas: true });
  if (!texto) return null;
  const local = texto.replace(/\s+/g, ' ');
  if ([...local].length > LOCAL_MAXIMO) throw invalido(`local deve ter no máximo ${LOCAL_MAXIMO} caracteres`, { field: 'local', reason: 'longo' });
  return local;
};

/**
 * O nº do receituário agronômico (Aplicação): texto aparado, até 40 caracteres, como foi digitado. Vazio ou null = sem.
 * @param {unknown} v @returns {string|null}
 */
export const receituarioDoCorpo = (v) => {
  const texto = textoDoCorpo(v, 'numero_receituario');
  if (!texto) return null;
  if ([...texto].length > RECEITUARIO_MAXIMO) {
    throw invalido(`numero_receituario deve ter no máximo ${RECEITUARIO_MAXIMO} caracteres`, { field: 'numero_receituario', reason: 'longo' });
  }
  return texto;
};

/**
 * A unidade da quantidade feita: uma de `UNIDADES_FEITAS` (o schema da rota já recusou outra); null = sem.
 * @param {unknown} v @returns {string|null}
 */
export const unidadeFeitaDoCorpo = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !UNIDADES_FEITAS.includes(v)) {
    throw invalido(`unidade_producao_sigla deve ser ${UNIDADES_FEITAS.join(', ')} ou nula`, { field: 'unidade_producao_sigla', reason: 'formato' });
  }
  return v;
};

/**
 * @typedef {{ cultura_id: string, forma_plantio?: string|null, semente_incrustada?: boolean|null, cobertura?: boolean|null,
 *   consorcio_cultura_id?: string|null }} PlantioDoCorpo
 */

/**
 * Os dados do PLANTIO do corpo: o capim (`cultura_id`, obrigatório) e o que é opcional; só as chaves que VIERAM (a forma do
 * fingerprint não depende do que o cliente omitiu). O consórcio nunca é o próprio capim (400 `igual_ao_capim`).
 * @param {unknown} v @returns {PlantioDoCorpo}
 */
export const plantioDoCorpo = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalido('plantio deve ser um objeto', { field: 'plantio', reason: 'formato' });
  const c = /** @type {Record<string, unknown>} */ (v);
  const culturaId = idOuNulo(c.cultura_id, 'plantio.cultura_id');
  if (!culturaId) throw invalido('plantio.cultura_id é obrigatório: escolha o capim plantado', { field: 'plantio.cultura_id', reason: 'obrigatorio' });
  /** @type {PlantioDoCorpo} */
  const p = { cultura_id: culturaId };
  if (c.forma_plantio !== undefined) {
    if (c.forma_plantio !== null && (typeof c.forma_plantio !== 'string' || !FORMAS_PLANTIO.includes(c.forma_plantio))) {
      throw invalido(`plantio.forma_plantio deve ser ${FORMAS_PLANTIO.join(', ')} ou nula`, { field: 'plantio.forma_plantio', reason: 'formato' });
    }
    p.forma_plantio = /** @type {string|null} */ (c.forma_plantio);
  }
  for (const chave of /** @type {const} */ (['semente_incrustada', 'cobertura'])) {
    if (c[chave] === undefined) continue;
    if (c[chave] !== null && typeof c[chave] !== 'boolean') throw invalido(`plantio.${chave} deve ser true, false ou nulo`, { field: `plantio.${chave}`, reason: 'formato' });
    p[chave] = /** @type {boolean|null} */ (c[chave]);
  }
  if (c.consorcio_cultura_id !== undefined) {
    const consorcio = idOuNulo(c.consorcio_cultura_id, 'plantio.consorcio_cultura_id');
    if (consorcio && consorcio === culturaId) {
      throw invalido('plantio.consorcio_cultura_id não pode ser o próprio capim plantado', { field: 'plantio.consorcio_cultura_id', reason: 'igual_ao_capim' });
    }
    p.consorcio_cultura_id = consorcio ?? null;
  }
  return p;
};

/**
 * Uma cultura do plantio (o capim ou o consórcio): do Cadastro de Culturas DESTA fazenda (outra fazenda ou outro tenant =
 * `inexistente`, sem oráculo) e ativa. A FK composta (cliente, fazenda, cultura) é a última barreira.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id @param {string} campo
 */
const exigirCulturaDoPlantio = async (tx, clienteId, empresaId, id, campo) => {
  const c = await tx.cultura.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, select: { id: true, ativo: true } });
  if (!c) throw atividadeReferenciaInvalida(campo, 'inexistente');
  if (!c.ativo) throw atividadeReferenciaInvalida(campo, 'inativo');
};

/** As colunas opcionais do plantio, na ordem do formulário. */
const OPCIONAIS_DO_PLANTIO = Object.freeze(/** @type {const} */ (['forma_plantio', 'semente_incrustada', 'cobertura', 'consorcio_cultura_id']));

/**
 * Grava os dados do plantio de uma atividade de Plantio de pastagem: ao CRIAR a atividade, a linha nova (1 para 1); ao
 * CONTINUAR, completa só o que estava vazio (nunca sobrescreve o que já foi gravado), auditado. Devolve o que mudou.
 * @param {any} tx @param {any} contexto
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, plantio: PlantioDoCorpo, nova: boolean }} p
 */
const gravarPlantio = async (tx, contexto, { clienteId, empresaId, atividadeId, plantio, nova }) => {
  if (nova) {
    const linha = await tx.atividadePlantio.create({
      data: {
        cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, cultura_id: plantio.cultura_id,
        ...Object.fromEntries(OPCIONAIS_DO_PLANTIO.map((k) => [k, plantio[k] ?? null])),
      },
    });
    await registrarEvento(contexto, { acao: 'atividade.plantio', entidade: 'AtividadePlantio', entidadeId: linha.id, dadosNovos: { atividade_id: atividadeId, cultura_id: linha.cultura_id, ...Object.fromEntries(OPCIONAIS_DO_PLANTIO.map((k) => [k, linha[k] ?? null])) } }, tx);
    return [];
  }
  const atual = await tx.atividadePlantio.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId } });
  if (!atual) return [];
  /** @type {Record<string, unknown>} */
  const completar = {};
  for (const k of OPCIONAIS_DO_PLANTIO) {
    if ((atual[k] === null || atual[k] === undefined) && plantio[k] !== undefined && plantio[k] !== null) completar[k] = plantio[k];
  }
  if (!Object.keys(completar).length) return [];
  await tx.atividadePlantio.update({ where: { id: atual.id }, data: completar });
  await registrarEvento(
    contexto,
    { acao: 'atividade.plantio', entidade: 'AtividadePlantio', entidadeId: atual.id, dadosAnteriores: Object.fromEntries(Object.keys(completar).map((k) => [k, null])), dadosNovos: { ...completar, completado_pelo_registro: true } },
    tx
  );
  return Object.keys(completar);
};

/**
 * A unidade da quantidade feita na atividade (`unidade_producao_sigla`): vazia, recebe a do registro (auditado, sem
 * mexer na `versao`: é dado do lançamento, como os totais); igual (sem caixa), nada; diferente → 422.
 * @param {any} tx @param {any} contexto @param {{ clienteId: string, empresaId: string, atividadeId: string, sigla: string }} p
 */
const exigirUnidadeDaAtividade = async (tx, contexto, { clienteId, empresaId, atividadeId, sigla }) => {
  const a = await tx.atividade.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId }, select: { unidade_producao_sigla: true } });
  const atual = a?.unidade_producao_sigla ?? null;
  if (atual && atual.toUpperCase() !== sigla.toUpperCase()) {
    throw atividadeReferenciaInvalida('unidade_producao_sigla', 'diferente_da_atividade', { details: { unidade_da_atividade: atual, unidade_informada: sigla } });
  }
  if (atual) return;
  await tx.atividade.updateMany({ where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId }, data: { unidade_producao_sigla: sigla } });
  await registrarEvento(contexto, { acao: 'atividade.unidade_producao', entidade: 'Atividade', entidadeId: atividadeId, dadosAnteriores: { unidade_producao_sigla: null }, dadosNovos: { unidade_producao_sigla: sigla, origem_registro_de_campo: true } }, tx);
};

/**
 * Conclui a atividade SEM ÁREA (Manutenção e Outros com o local) no `dia`, na transação de quem chama e SOB a trava dela:
 * nunca antes do início nem do último dia lançado (422, como na área); tipo que exige produção sem produção somada > 0 fica
 * ABERTA (como na conclusão automática). Auditado. Devolve se concluiu.
 * @param {any} tx @param {any} contexto
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, dia: string, tempo: { agora: Date }, automatica: boolean }} p
 */
const concluirAtividadeSemArea = async (tx, contexto, { clienteId, empresaId, atividadeId, dia, tempo, automatica }) => {
  const auth = exigirAuthContext(contexto?.auth);
  const a = await tx.atividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId },
    select: { id: true, status: true, versao: true, data_inicio: true, tipo_atividade_id: true },
  });
  if (!a || a.status !== STATUS_ATIVIDADE.ABERTA) return false;
  const inicio = diaDe(a.data_inicio) ?? null;
  if (inicio && dia < inicio) throw atividadeDataInvalida('data_conclusao', 'antes_do_inicio', { data: dia, data_inicio: inicio });
  const ultimo = await ultimoDiaDaAtividade(tx, { clienteId, empresaId, atividadeId });
  if (ultimo && dia < ultimo) throw atividadeDataInvalida('data_conclusao', 'antes_do_ultimo_dia', { data: dia, ultimo_dia: ultimo });
  const tipo = await lerTipoAtividade(tx, clienteId, a.tipo_atividade_id);
  if (tipo?.exige_producao) {
    const soma = await tx.atividadeApontamento.aggregate({
      where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, status: 'CONFIRMADO' },
      _sum: { quantidade_produzida_dia: true },
    });
    const producao = soma._sum.quantidade_produzida_dia;
    if (producao === null || !dec(producao).gt(0)) return false;
  }
  const r = await tx.atividade.updateMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId, status: STATUS_ATIVIDADE.ABERTA, versao: a.versao },
    data: { status: STATUS_ATIVIDADE.CONCLUIDA, data_conclusao: comoData(dia), concluida_em: tempo.agora, concluida_por_usuario_id: auth.usuarioId ?? null, versao: { increment: 1 } },
  });
  if (r.count !== 1) return false;
  await registrarEvento(
    contexto,
    {
      acao: 'atividade.concluir', entidade: 'Atividade', entidadeId: atividadeId,
      dadosAnteriores: { id: atividadeId, status: STATUS_ATIVIDADE.ABERTA, versao: a.versao },
      dadosNovos: { id: atividadeId, status: STATUS_ATIVIDADE.CONCLUIDA, data_conclusao: dia, versao: a.versao + 1, sem_area: true, ...(automatica ? { conclusao_automatica: true, motivo: 'servico_novo' } : { origem_registro_de_campo: true }) },
    },
    tx
  );
  return true;
};

/**
 * D-PROD-276 — liga a atividade que CONTINUA (sem reforma) à reforma do "Faz parte de", auditado, sem mexer na `versao`
 * (é dado do lançamento, como a unidade da quantidade feita). Chame SOB a trava da atividade.
 * @param {any} tx @param {any} contexto @param {{ clienteId: string, empresaId: string, atividadeId: string, planejamentoId: string }} p
 */
const ligarAoPlanejamento = async (tx, contexto, { clienteId, empresaId, atividadeId, planejamentoId }) => {
  await tx.atividade.updateMany({ where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId, planejamento_id: null }, data: { planejamento_id: planejamentoId } });
  await registrarEvento(
    contexto,
    { acao: 'atividade.planejamento', entidade: 'Atividade', entidadeId: atividadeId, dadosAnteriores: { planejamento_id: null }, dadosNovos: { planejamento_id: planejamentoId, origem_registro_de_campo: true } },
    tx
  );
};

/** A chave das linhas do apontamento da área `i` (0-based): a do corpo na 1ª; `<chave>:a<i+1>` nas outras. @param {string} chave @param {number} i */
export const chaveDaArea = (chave, i) => (i === 0 ? chave : `${chave}:a${i + 1}`);

// ─── o rateio das linhas (D-PROD-263) ───────────────────────────────────────

/**
 * @typedef {{ produtos: any[], maquinas: any[], maoObra: any[], servicos: any[] }} LinhasDaArea
 * @typedef {{ produtos: number[], maquinas: number[], mao_obra: number[], servicos: number[] }} IndicesDaArea
 *   a posição, no CORPO, de cada linha da área (a recusa da área aponta a linha que o cliente enviou)
 */

/** Uma parte de linha para a área: a linha e a posição dela no corpo. @typedef {{ indice: number, linha: any }} Parte */

/**
 * Reparte uma lista de linhas cuja medida é UM campo de quantidade (insumo `quantidade`, mão de obra e serviço
 * `quantidade`): cada área leva a sua parte; sem quantidade legível (a regra da linha recusa), a linha vai inteira para
 * a 1ª área.
 * @param {any[]} linhas @param {string} campo @param {string[]} hectares
 * @returns {Parte[][]} por área
 */
const repartirPorQuantidade = (linhas, campo, hectares) => {
  /** @type {Parte[][]} */
  const porArea = hectares.map(() => []);
  linhas.forEach((linha, indice) => {
    const q = linha?.[campo];
    if (typeof q !== 'string' || !PADRAO_DECIMAL.test(q)) {
      porArea[0].push({ indice, linha });
      return;
    }
    partesPorHectares(q, hectares).forEach((parte, a) => {
      if (parte !== null) porArea[a].push({ indice, linha: { ...linha, [campo]: parte } });
    });
  });
  return porArea;
};

/**
 * D-PROD-310 — os insumos por área. Linha digitada numa unidade de conversão (`unidade_lancamento`): com mais de uma
 * área, reparte-se a quantidade DIGITADA (`quantidade_lancamento`) e cada parte é convertida pelo servidor (a
 * `quantidade` de estoque do corpo, se veio, valia para o total e sai das partes). O resto, como sempre.
 * @param {any[]} linhas @param {string[]} hectares
 * @returns {Parte[][]} por área
 */
const repartirInsumos = (linhas, hectares) => {
  if (hectares.length <= 1 || !linhas.some((l) => l?.unidade_lancamento)) return repartirPorQuantidade(linhas, 'quantidade', hectares);
  /** @type {Parte[][]} */
  const porArea = hectares.map(() => []);
  linhas.forEach((linha, indice) => {
    const convertida = Boolean(linha?.unidade_lancamento);
    const campo = convertida ? 'quantidade_lancamento' : 'quantidade';
    const q = linha?.[campo];
    if (typeof q !== 'string' || !PADRAO_DECIMAL.test(q)) {
      porArea[0].push({ indice, linha });
      return;
    }
    partesPorHectares(q, hectares).forEach((parte, a) => {
      if (parte === null) return;
      const nova = { ...linha, [campo]: parte };
      if (convertida) delete nova.quantidade;
      porArea[a].push({ indice, linha: nova });
    });
  });
  return porArea;
};

/**
 * As máquinas por área. Sem medidor (`quantidade_uso`): o uso é repartido. Com medidor (`leitura_final`): o intervalo
 * vira trechos seguidos, na ordem das áreas, e as linhas do MESMO bem são uma série só (`trechosDoMedidor`); a inicial que
 * o corpo não trouxe é a vigente na data (`leituraVigenteDoBem`, sob a trava do bem) ou a final da linha anterior do
 * mesmo bem. Linha que a regra vai recusar (sem uso nem leitura, as duas coisas, inicial desconhecida, final abaixo da
 * inicial) vai inteira para a 1ª área: a recusa é a de sempre. Trava os bens (em ordem de id) depois da atividade.
 * @param {any} tx @param {{ clienteId: string, empresaId: string, dia: string, maquinas: any[], hectares: string[] }} p
 * @returns {Promise<Parte[][]>}
 */
const repartirMaquinas = async (tx, { clienteId, empresaId, dia, maquinas, hectares }) => {
  /** @type {Parte[][]} */
  const porArea = hectares.map(() => []);
  if (!maquinas.length) return porArea;
  await travarBens(tx, clienteId, empresaId, maquinas.map((l) => l?.bem_id).filter((id) => typeof id === 'string'));
  const estados = maquinas.map((l) => camposDaLinhaMaquina(l));
  /** @type {Map<string, number[]>} as linhas com medidor de cada bem, na ordem do corpo */
  const comMedidor = new Map();
  estados.forEach((e, indice) => {
    const temUso = e.quantidade_uso !== null && e.quantidade_uso !== undefined;
    const temInicial = e.leitura_inicial !== null && e.leitura_inicial !== undefined;
    const temFinal = e.leitura_final !== null && e.leitura_final !== undefined;
    if (temUso && !temInicial && !temFinal) {
      partesPorHectares(/** @type {string} */ (e.quantidade_uso), hectares).forEach((parte, a) => {
        if (parte !== null) porArea[a].push({ indice, linha: { ...maquinas[indice], quantidade_uso: parte } });
      });
    } else if (temFinal && !temUso && e.sem_medidor !== true && typeof e.bem_id === 'string') {
      comMedidor.set(e.bem_id, [...(comMedidor.get(e.bem_id) ?? []), indice]);
    } else {
      porArea[0].push({ indice, linha: maquinas[indice] });
    }
  });
  for (const [bemId, indices] of comMedidor) {
    /** @type {Array<{ indice: number, inicial: string, final: string }>} */
    const serie = [];
    /** @type {string|null} */
    let finalAnterior = null;
    let valida = true;
    for (const indice of indices) {
      const e = estados[indice];
      const inicial = e.leitura_inicial ?? finalAnterior ?? (await leituraVigenteDoBem(tx, { clienteId, empresaId, bemId, dia }));
      const final = /** @type {string} */ (e.leitura_final);
      if (inicial === null || dec(final).lt(dec(inicial))) {
        valida = false;
        break;
      }
      serie.push({ indice, inicial, final });
      finalAnterior = final;
    }
    if (!valida) {
      for (const indice of indices) porArea[0].push({ indice, linha: maquinas[indice] });
      continue;
    }
    trechosDoMedidor(serie, hectares).forEach((trechos, a) => {
      for (const t of trechos) porArea[a].push({ indice: t.indice, linha: { ...maquinas[t.indice], leitura_inicial: t.inicial, leitura_final: t.final } });
    });
  }
  return porArea;
};

/**
 * As linhas de cada área e a posição de cada uma no corpo.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, dia: string, linhas: import('./atividadeApontamentoService.js').LinhasDoLancamento, hectares: string[] }} p
 * @returns {Promise<Array<{ linhas: LinhasDaArea, indices: IndicesDaArea }>>}
 */
const repartirLinhas = async (tx, { clienteId, empresaId, dia, linhas, hectares }) => {
  const produtos = repartirInsumos(linhas.produtos, hectares);
  const maoObra = repartirPorQuantidade(linhas.maoObra, 'quantidade', hectares);
  const servicos = repartirPorQuantidade(linhas.servicos, 'quantidade', hectares);
  const maquinas = await repartirMaquinas(tx, { clienteId, empresaId, dia, maquinas: linhas.maquinas, hectares });
  /** @param {Parte[]} partes */
  const naOrdem = (partes) => [...partes].sort((x, y) => x.indice - y.indice);
  return hectares.map((_, a) => {
    const p = naOrdem(produtos[a]);
    const m = naOrdem(maquinas[a]);
    const o = naOrdem(maoObra[a]);
    const s = naOrdem(servicos[a]);
    return {
      linhas: { produtos: p.map((x) => x.linha), maquinas: m.map((x) => x.linha), maoObra: o.map((x) => x.linha), servicos: s.map((x) => x.linha) },
      indices: { produtos: p.map((x) => x.indice), maquinas: m.map((x) => x.indice), mao_obra: o.map((x) => x.indice), servicos: s.map((x) => x.indice) },
    };
  });
};

/** A coleção de cada `details.entidade` das recusas de linha (sem entidade, `linha_indice` é de máquina). */
const COLECAO_DA_ENTIDADE = Object.freeze(/** @type {Record<string, keyof IndicesDaArea>} */ ({ linha_maquina: 'maquinas', linha_mao_obra: 'mao_obra', linha_servico: 'servicos' }));

/**
 * Roda um passo de UMA área do registro de várias áreas: a recusa ganha `details.area_id` e `details.area_indice` (a
 * posição em `areas[]`) e, se aponta uma linha, a posição dela no CORPO (`indice` do produto, `linha_indice` dos outros),
 * não na lista da área. Com uma área só (`ativo` falso), nada muda.
 * @template T
 * @param {{ ativo: boolean, indice: number, areaId: string, indices?: IndicesDaArea }} area @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
const naArea = async ({ ativo, indice, areaId, indices }, fn) => {
  if (!ativo) return fn();
  try {
    return await fn();
  } catch (erro) {
    if (!(erro instanceof AppError)) throw erro;
    const d = /** @type {Record<string, any>} */ (erro.details ?? {});
    /** @type {Record<string, unknown>} */
    const extra = { area_id: areaId, area_indice: indice };
    if (indices) {
      if (Number.isInteger(d.indice) && (d.colecao === 'produtos' || d.entidade === 'linha_produto')) extra.indice = indices.produtos[d.indice] ?? d.indice;
      if (Number.isInteger(d.linha_indice)) extra.linha_indice = indices[COLECAO_DA_ENTIDADE[d.entidade] ?? 'maquinas']?.[d.linha_indice] ?? d.linha_indice;
    }
    throw new AppError(erro.code, erro.message, { cause: erro, details: { ...d, ...extra } });
  }
};

// ─── a busca ────────────────────────────────────────────────────────────────

/**
 * A atividade ABERTA do tipo (a operação), da fazenda, que contém a área PLANEJADA ou EM_ANDAMENTO, em qualquer mês
 * (D-PROD-267: sem a regra do mês); havendo mais de uma, a de `updatedAt` mais recente (desempate: `id` maior).
 * D-PROD-274: `culturaId` (o capim, no Plantio de pastagem) restringe às atividades de plantio com o MESMO capim.
 * @param {any} tx @param {{ clienteId: string, empresaId: string, tipoId: string, areaId: string, culturaId?: string|null }} p
 */
const buscarAtividadeAberta = (tx, { clienteId, empresaId, tipoId, areaId, culturaId = null }) =>
  tx.atividade.findFirst({
    where: {
      cliente_id: clienteId, empresa_id: empresaId, tipo_atividade_id: tipoId, status: STATUS_ATIVIDADE.ABERTA,
      areas: { some: { area_id: areaId, status: { in: [STATUS_AREA.PLANEJADA, STATUS_AREA.EM_ANDAMENTO] } } },
      // D-PROD-274: no Plantio de pastagem, o MESMO capim (capim diferente abre outra atividade).
      ...(culturaId ? { plantio: { is: { cultura_id: culturaId } } } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    // D-PROD-276: a reforma de que ela já faz parte (continuar nunca troca uma ligação diferente).
    select: { id: true, nome: true, data_inicio: true, planejamento_id: true },
  });

/**
 * D-PROD-274 — a atividade ABERTA da operação SEM área no MESMO local (Manutenção e Outros); havendo mais de uma, a de
 * `updatedAt` mais recente (desempate: `id` maior).
 * @param {any} tx @param {{ clienteId: string, empresaId: string, tipoId: string, local: string }} p
 */
const buscarAtividadeAbertaNoLocal = (tx, { clienteId, empresaId, tipoId, local }) =>
  tx.atividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, tipo_atividade_id: tipoId, status: STATUS_ATIVIDADE.ABERTA, local, areas: { none: {} } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, nome: true, data_inicio: true },
  });

/**
 * D-PROD-267 — a atividade achada está PARADA para este registro? O último dia lançado nela nas áreas do registro que ela
 * já tem (o mais recente entre elas) mais de `DIAS_PARADO_MAXIMO` dias antes do dia. Sem nenhum dia lançado nessas áreas
 * (atividade planejada, área recém-incluída): não está. Chame SOB a trava da atividade.
 * @param {any} tx @param {{ clienteId: string, empresaId: string, atividadeId: string, areaIds: string[], dia: string }} p
 */
const situacaoDoParado = async (tx, { clienteId, empresaId, atividadeId, areaIds, dia }) => {
  const linhas = /** @type {Array<{ id: string, area_id: string, status: string }>} */ (
    await tx.atividadeArea.findMany({
      where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, area_id: { in: areaIds } },
      select: { id: true, area_id: true, status: true },
    })
  );
  const ultimos = await ultimosDiasDasAreas(tx, { clienteId, empresaId, atividadeId, atividadeAreaIds: linhas.map((l) => l.id) });
  /** @type {{ ultimo: string, area_id: string } | null} */
  let maisRecente = null;
  for (const l of linhas) {
    const u = ultimos.get(l.id);
    if (u && (!maisRecente || u > maisRecente.ultimo)) maisRecente = { ultimo: u, area_id: l.area_id };
  }
  const dias = maisRecente ? diasEntre(maisRecente.ultimo, dia) : 0;
  return { parado: maisRecente !== null && dias > DIAS_PARADO_MAXIMO, maisRecente, dias, linhas, ultimos };
};

// ─── o registro ─────────────────────────────────────────────────────────────

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, any>} corpo
 */
export const registrarCampo = async (contexto, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const comAreas = temCampo(corpo, 'areas') && corpo.areas !== undefined;
  const comAreaId = temCampo(corpo, 'area_id') && corpo.area_id !== undefined && corpo.area_id !== null;
  if (comAreas && comAreaId) {
    throw invalido('envie a área em area_id ou as áreas em areas[], nunca os dois', { field: 'areas', reason: 'areas_e_area_id' });
  }
  if (comAreas && temCampo(corpo, 'area_executada_dia')) {
    throw invalido('com areas[], os hectares vão em cada área (areas[i].hectares), não em area_executada_dia', { field: 'area_executada_dia', reason: 'com_areas' });
  }
  const tipoId = idOuNulo(corpo.tipo_atividade_id, 'tipo_atividade_id');
  // D-PROD-274: sem área, a decisão (Manutenção e Outros com o local; os outros tipos → área obrigatória) é do tipo, lido
  // na transação. Aqui só o que não depende dele.
  const semArea = !comAreas && !idOuNulo(corpo.area_id, 'area_id');
  if (!tipoId) throw invalido('tipo_atividade_id é obrigatório', { field: 'tipo_atividade_id', reason: 'obrigatorio' });
  const safra = corpo.safra_ciclo === undefined || corpo.safra_ciclo === null ? null : String(corpo.safra_ciclo).trim() || null;
  /** @type {import('./atividadeApontamentoService.js').EstadoDoDia} */
  const estado = { ...VAZIO, ...camposDoCorpo(corpo) };
  // D-PROD-274: os campos de cada tipo (só os que vieram; a regra de cada um depende do tipo, conferida na transação).
  const local = localDoCorpo(corpo.local);
  const receituario = receituarioDoCorpo(corpo.numero_receituario);
  const unidadeFeita = unidadeFeitaDoCorpo(corpo.unidade_producao_sigla);
  const plantio = corpo.plantio === undefined || corpo.plantio === null ? null : plantioDoCorpo(corpo.plantio);
  if (local && !semArea) throw invalido('local só vale sem área: com área, o lugar do serviço é a própria área', { field: 'local', reason: 'com_area' });
  // D-PROD-276: a reforma de que a realização faz parte (só com área).
  const planejamentoId = idOuNulo(corpo.planejamento_id, 'planejamento_id') ?? null;
  if (planejamentoId && semArea) {
    throw invalido('planejamento_id só vale com área: o serviço sem área (com o local) não faz parte de reforma', { field: 'planejamento_id', reason: 'sem_area' });
  }
  if (semArea && estado.area_executada_dia !== null && estado.area_executada_dia !== undefined) {
    throw invalido('sem área não há hectares feitos: informe a quantidade feita', { field: 'area_executada_dia', reason: 'sem_area' });
  }
  // As áreas do registro (na ordem do corpo). Uma área só é o caso de sempre: os hectares dela são o `area_executada_dia`.
  // D-PROD-274: sem área (Manutenção e Outros), nenhuma.
  const alvos = semArea ? [] : comAreas ? areasDoRegistro(corpo.areas) : [{ area_id: /** @type {string} */ (idOuNulo(corpo.area_id, 'area_id')), hectares: estado.area_executada_dia }];
  if (comAreas && alvos.length === 1) estado.area_executada_dia = alvos[0].hectares;
  const varias = alvos.length > 1;
  /** @param {number} i */
  const campoDaArea = (i) => (comAreas ? `areas[${i}].area_id` : 'area_id');
  exigirData(estado);
  const dia = /** @type {string} */ (estado.data_operacional);
  // D-PROD-265: o término (opcional) do serviço; nunca antes do início.
  const termino = diaDoCorpo(corpo.data_termino, 'data_termino') ?? null;
  if (termino && termino < dia) {
    throw invalido('data_termino não pode ser anterior a data_operacional', { field: 'data_termino', reason: 'periodo_invertido', data_operacional: dia, data_termino: termino });
  }
  /** Só com término a chave entra no fingerprint: sem ele, o fingerprint é o de antes da D-PROD-265, byte a byte. */
  const comTermino = termino ? { data_termino: termino } : {};
  // D-PROD-267: as decisões do "Como fica depois de salvar?" e do "parado" (booleanos opcionais; a rota confere o tipo).
  const concluir = corpo.concluir === true;
  /** @type {boolean|undefined} */
  const novaAtividade = typeof corpo.nova_atividade === 'boolean' ? corpo.nova_atividade : undefined;
  /** Só as que vieram entram no fingerprint: sem elas, o de antes, byte a byte. */
  const comDecisoes = {
    ...(typeof corpo.concluir === 'boolean' ? { concluir: corpo.concluir } : {}),
    ...(novaAtividade !== undefined ? { nova_atividade: novaAtividade } : {}),
  };
  /** D-PROD-274: os campos de cada tipo, só os que vieram (sem eles, o fingerprint de antes, byte a byte). */
  const comCamposDoTipo = {
    ...(plantio ? { plantio: canonico(plantio) } : {}),
    ...(receituario ? { numero_receituario: receituario } : {}),
    ...(unidadeFeita ? { unidade_producao_sigla: unidadeFeita } : {}),
    // D-PROD-276: a reforma ("Faz parte de"), só quando vem.
    ...(planejamentoId ? { planejamento_id: planejamentoId } : {}),
  };
  const origem = origemDoCorpo(corpo.origem);
  const linhas = linhasDoCorpo(corpo);
  if (!linhas.operationId) throw invalido('operation_id é obrigatório', { field: 'operation_id', reason: 'obrigatorio' });
  const chave = linhas.operationId;
  const linhasDoFingerprint = { produtos: linhas.produtos, maquinas: canonico(linhas.maquinas), ...linhasNovasDoFingerprint(linhas) };

  return comReciboOpcional(contexto, {
    operationId: chave,
    tipoOperacao: TIPO_OPERACAO_REGISTRAR,
    bases: semArea ? [chave] : alvos.map((_, i) => chaveDaArea(chave, i)),
    // Uma área: o fingerprint de sempre (o `areas` de um item é o mesmo registro do `area_id`). Várias: v2, com as áreas.
    // D-PROD-274: sem área (Manutenção e Outros), v3, com o local.
    fingerprint: () =>
      fingerprintDePayload(
        semArea
          ? { v: 3, empresa_id: corpo.empresa_id, local, tipo_atividade_id: tipoId, safra_ciclo: safra, estado, ...comTermino, ...comDecisoes, ...comCamposDoTipo, origem, ...linhasDoFingerprint }
          : varias
            ? { v: 2, empresa_id: corpo.empresa_id, areas: alvos, tipo_atividade_id: tipoId, safra_ciclo: safra, estado, ...comTermino, ...comDecisoes, ...comCamposDoTipo, origem, ...linhasDoFingerprint }
            : { v: 1, empresa_id: corpo.empresa_id, area_id: alvos[0].area_id, tipo_atividade_id: tipoId, safra_ciclo: safra, estado, ...comTermino, ...comDecisoes, ...comCamposDoTipo, origem, ...linhasDoFingerprint }
      ),
    executar: async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      exigirDiaNaoFuturo(tempo, dia, 'data_operacional');
      if (termino) exigirDiaNaoFuturo(tempo, termino, 'data_termino');
      // D-PROD-276: a reforma do "Faz parte de" (da fazenda, aberta e com todas as áreas do registro), ANTES das áreas.
      if (planejamentoId) await exigirPlanejamentoDoRegistro(tx, { clienteId: cli, empresaId, planejamentoId, areaIds: alvos.map((a) => a.area_id) });
      /** @param {number} i @param {IndicesDaArea} [indices] */
      const area = (i, indices) => ({ ativo: varias, indice: i, areaId: alvos[i].area_id, indices });
      const mapas = [];
      for (const [i, a] of alvos.entries()) mapas.push(await naArea(area(i), () => exigirAreaDoMapa(tx, cli, empresaId, a.area_id, campoDaArea(i))));
      const nomes = new Map(
        (await tx.areaPastagem.findMany({ where: { cliente_id: cli, id: { in: alvos.map((a) => a.area_id) } }, select: { id: true, nome: true } })).map(
          (/** @type {{ id: string, nome: string }} */ r) => [r.id, r.nome]
        )
      );
      const tipo = await lerTipoAtividade(tx, cli, tipoId);
      if (!tipo) throw atividadeReferenciaInvalida('tipo_atividade_id', 'inexistente');
      if (!tipo.ativo) throw atividadeReferenciaInvalida('tipo_atividade_id', 'inativo');
      // Emenda 1: abastecimento é da máquina (tanque, litros, horímetro), não um registro genérico por área.
      if (ehTipoAbastecimento(tipo.nome_tipo)) throw atividadeReferenciaInvalida('tipo_atividade_id', 'abastecimento');

      // D-PROD-274: os campos de cada tipo fixo.
      const tipoFixo = tipoFixoDaCategoria(tipo.categoria);
      if (semArea) {
        if (!TIPOS_SEM_AREA.includes(tipoFixo)) throw invalido('area_id ou areas é obrigatório', { field: 'area_id', reason: 'obrigatorio' });
        if (!local) throw invalido('sem área, informe o local do serviço (ex.: "DIVISA NORTE")', { field: 'local', reason: 'obrigatorio' });
      }
      if (plantio && tipoFixo !== 'PLANTIO') throw invalido('plantio só vale no Plantio de pastagem', { field: 'plantio', reason: 'tipo_sem_plantio' });
      if (!plantio && tipoFixo === 'PLANTIO') throw invalido('plantio.cultura_id é obrigatório: escolha o capim plantado', { field: 'plantio.cultura_id', reason: 'obrigatorio' });
      if (receituario && tipoFixo !== 'APLICACAO') throw invalido('numero_receituario só vale na Aplicação', { field: 'numero_receituario', reason: 'tipo_sem_receituario' });
      if (plantio) {
        await exigirCulturaDoPlantio(tx, cli, empresaId, plantio.cultura_id, 'plantio.cultura_id');
        if (plantio.consorcio_cultura_id) await exigirCulturaDoPlantio(tx, cli, empresaId, plantio.consorcio_cultura_id, 'plantio.consorcio_cultura_id');
      }

      // A corrida: quem chega depois espera aqui e então ENXERGA a atividade criada pelo primeiro. Uma trava por área,
      // em ordem de id: dois registros com áreas em comum se enfileiram, sem deadlock. D-PROD-267: sem o mês na chave
      // (a atividade aberta vale em qualquer mês). D-PROD-274: sem área, uma trava pelo local.
      const travas = semArea ? [`local:${local}`] : alvos.map((a) => a.area_id).sort();
      for (const alvoDaTrava of travas) {
        const trava = `atividade-registro:${cli}:${empresaId}:${tipoId}:${alvoDaTrava}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${trava}, 0))`;
      }

      let achada = null;
      if (semArea) achada = await buscarAtividadeAbertaNoLocal(tx, { clienteId: cli, empresaId, tipoId, local: /** @type {string} */ (local) });
      for (const a of alvos) {
        achada = await buscarAtividadeAberta(tx, { clienteId: cli, empresaId, tipoId, areaId: a.area_id, culturaId: plantio?.cultura_id ?? null });
        if (achada) break;
      }

      // D-PROD-267: a atividade achada PARADA (último dia há mais de 30 dias) não recebe o registro sem uma decisão.
      /** @type {null | { atividade_id: string, atividade_nome: string, ultimo_dia: string, areas_concluidas: number, atividade_concluida: boolean }} */
      let anterior = null;
      if (achada) {
        if (!(await travarAtividade(tx, cli, empresaId, achada.id))) throw atividadeReferenciaInvalida('tipo_atividade_id', 'inexistente');
        if (semArea) {
          // D-PROD-274: sem área, o "parado" olha o último dia lançado na atividade toda.
          const ultimo = await ultimoDiaDaAtividade(tx, { clienteId: cli, empresaId, atividadeId: achada.id });
          const dias = ultimo ? diasEntre(ultimo, dia) : 0;
          if (ultimo && dias > DIAS_PARADO_MAXIMO) {
            if (novaAtividade === undefined) {
              throw atividadeServicoParado({ atividade_id: achada.id, atividade_nome: achada.nome, ultimo_dia: ultimo, area_id: null, local, dias_parado: dias, limite_dias: DIAS_PARADO_MAXIMO });
            }
            if (novaAtividade === true) {
              const inicio = diaDe(achada.data_inicio) ?? null;
              const fim = inicio && inicio > ultimo ? inicio : ultimo;
              const fechou = await concluirAtividadeSemArea(tx, contexto, { clienteId: cli, empresaId, atividadeId: achada.id, dia: fim, tempo, automatica: true });
              anterior = { atividade_id: achada.id, atividade_nome: achada.nome, ultimo_dia: ultimo, areas_concluidas: 0, atividade_concluida: fechou };
              achada = null;
            }
          }
        } else {
          const p = await situacaoDoParado(tx, { clienteId: cli, empresaId, atividadeId: achada.id, areaIds: alvos.map((a) => a.area_id), dia });
          if (p.parado && p.maisRecente) {
            if (novaAtividade === undefined) {
              throw atividadeServicoParado({
                atividade_id: achada.id, atividade_nome: achada.nome, ultimo_dia: p.maisRecente.ultimo, area_id: p.maisRecente.area_id, dias_parado: p.dias, limite_dias: DIAS_PARADO_MAXIMO,
              });
            }
            if (novaAtividade === true) {
              // "É um serviço novo": as áreas do registro em andamento na antiga concluem no último dia lançado em cada uma.
              let concluidas = 0;
              for (const l of p.linhas) {
                const ultimo = p.ultimos.get(l.id);
                if (l.status !== STATUS_AREA.EM_ANDAMENTO || !ultimo) continue;
                const linha = await buscarAreaDaAtividade(tx, cli, empresaId, achada.id, l.id);
                // O lançamento antes do início da área (o dia anterior ao início da atividade) não a conclui antes de começar.
                const inicioDaArea = diaDe(linha?.data_inicio) ?? null;
                const fim = inicioDaArea && inicioDaArea > ultimo ? inicioDaArea : ultimo;
                await concluirAreaNaTransacao(tx, contexto, { clienteId: cli, empresaId, atividadeId: achada.id, area: linha, dia: fim });
                concluidas += 1;
              }
              const fechou = await concluirAtividadeSeAreasConcluidas(tx, contexto, { clienteId: cli, empresaId, atividadeId: achada.id, tempo });
              anterior = { atividade_id: achada.id, atividade_nome: achada.nome, ultimo_dia: p.maisRecente.ultimo, areas_concluidas: concluidas, atividade_concluida: fechou };
              achada = null;
            }
          }
        }
      }

      let atividadeId;
      let atividadeNome;
      let criada = false;
      /** O que o registro fez com cada área da atividade, na ordem do corpo. */
      const situacao = alvos.map(() => ({ atividade_area_id: /** @type {string|null} */ (null), adicionada: false, iniciada: false }));
      /** D-PROD-274: os dados do plantio que o registro completou na atividade que continuou. */
      let plantioCompletado = /** @type {string[]} */ ([]);
      /** D-PROD-276: a reforma da atividade depois do registro e o que o registro fez com a ligação. */
      let planejamentoDaAtividade = /** @type {string|null} */ (null);
      let planejamentoLigacao = /** @type {null|'criada'|'completada'|'ja_ligada'|'mantida_outra'} */ (null);
      if (achada) {
        atividadeId = achada.id;
        atividadeNome = achada.nome;
        const inicioDaAtividade = diaDe(achada.data_inicio);
        for (const [i, a] of alvos.entries()) {
          await naArea(area(i), async () => {
            let linha = await tx.atividadeArea.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, area_id: a.area_id } });
            if (!linha) {
              linha = await adicionarAreaNaTransacao(tx, contexto, { clienteId: cli, empresaId, atividadeId, areaId: a.area_id, campo: campoDaArea(i) });
              situacao[i].adicionada = true;
            }
            if (linha.status === STATUS_AREA.PLANEJADA) {
              await iniciarAreaNaTransacao(tx, contexto, { clienteId: cli, empresaId, atividadeId, area: linha, dia, inicioDaAtividade });
              situacao[i].iniciada = true;
            }
            situacao[i].atividade_area_id = linha.id;
          });
        }
        if (plantio) plantioCompletado = await gravarPlantio(tx, contexto, { clienteId: cli, empresaId, atividadeId, plantio, nova: false });
        if (unidadeFeita) await exigirUnidadeDaAtividade(tx, contexto, { clienteId: cli, empresaId, atividadeId, sigla: unidadeFeita });
        // D-PROD-276: continuar só LIGA a atividade que ainda não tinha reforma; uma ligação diferente nunca é trocada.
        planejamentoDaAtividade = achada.planejamento_id ?? null;
        if (planejamentoId) {
          if (!planejamentoDaAtividade) {
            await ligarAoPlanejamento(tx, contexto, { clienteId: cli, empresaId, atividadeId, planejamentoId });
            planejamentoDaAtividade = planejamentoId;
            planejamentoLigacao = 'completada';
          } else planejamentoLigacao = planejamentoDaAtividade === planejamentoId ? 'ja_ligada' : 'mantida_outra';
        }
      } else {
        criada = true;
        const bemDaPrimeiraMaquina = Array.isArray(corpo.maquinas) && corpo.maquinas[0]?.bem_id ? String(corpo.maquinas[0].bem_id) : null;
        // D-PROD-274: a SAFRA automática (o ano agrícola do dia) quando o corpo não a traz — Plantio, Fertilização e as
        // operações com `exige_safra`. Calculada aqui, DEPOIS do fingerprint (que segue com o `safra_ciclo` do corpo).
        const safraDaAtividade = safra ?? (TIPOS_COM_SAFRA.includes(tipoFixo) || tipo.exige_safra ? safraDoDia(dia) : null);
        const comum = { data_inicio: dia, safra_ciclo: safraDaAtividade, bem_id: bemDaPrimeiraMaquina };
        const nome = semArea ? nomeDoRegistro(tipo.nome_tipo, /** @type {string} */ (local), dia) : nomeDoRegistro(tipo.nome_tipo, nomes.get(alvos[0].area_id) ?? '', dia, alvos.length - 1);
        const aberta = await abrirNa(tx, contexto, {
          clienteId: cli,
          empresaId,
          tempo,
          tipoAtividadeId: tipoId,
          // Uma área: a abertura de sempre (EM_ANDAMENTO desde o dia). Várias: `areas[]` (todas "a iniciar", planejada =
          // o tamanho), iniciadas logo abaixo no dia do registro (= o início da atividade). D-PROD-274: sem área, o local.
          // D-PROD-276: a atividade NOVA nasce na reforma do "Faz parte de" (só com área).
          estado: semArea
            ? { ...comum, nome, local }
            : varias
              ? { ...comum, nome, planejamento_id: planejamentoId, areas: alvos.map((a) => ({ area_id: a.area_id, area_planejada: undefined })) }
              : { ...comum, nome, planejamento_id: planejamentoId, area_id: alvos[0].area_id, area_planejada: mapas[0].tamanho },
          acao: 'atividade.abrir',
          auditoriaExtra: {
            origem_registro_de_campo: true,
            ...(safra === null && safraDaAtividade ? { safra_automatica: true } : {}),
            ...(planejamentoId ? { planejamento_id: planejamentoId } : {}),
          },
          dispensarArea: semArea,
          unidadeSemCadastro: unidadeFeita,
        });
        atividadeId = aberta.id;
        atividadeNome = aberta.nome;
        if (planejamentoId) {
          planejamentoDaAtividade = planejamentoId;
          planejamentoLigacao = 'criada';
        }
        for (const [i, a] of alvos.entries()) {
          const linha = await tx.atividadeArea.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, area_id: a.area_id } });
          if (linha?.status === STATUS_AREA.PLANEJADA) await iniciarAreaNaTransacao(tx, contexto, { clienteId: cli, empresaId, atividadeId, area: linha, dia, inicioDaAtividade: dia });
          situacao[i].atividade_area_id = linha?.id ?? null;
        }
        if (plantio) await gravarPlantio(tx, contexto, { clienteId: cli, empresaId, atividadeId, plantio, nova: true });
        // A operação COM unidade de produção: a quantidade feita tem de vir nela.
        if (unidadeFeita) await exigirUnidadeDaAtividade(tx, contexto, { clienteId: cli, empresaId, atividadeId, sigla: unidadeFeita });
      }

      // As linhas de cada área: as do corpo (uma área ou nenhuma) ou as partes pelos hectares (várias).
      const planos = varias
        ? await repartirLinhas(tx, { clienteId: cli, empresaId, dia, linhas, hectares: alvos.map((a) => /** @type {string} */ (a.hectares)) })
        : [{ linhas, indices: undefined }];
      // D-PROD-274: com várias áreas, a quantidade feita também é repartida pelos hectares (antes ia inteira a cada área).
      const producaoPorArea = varias && estado.quantidade_produzida_dia
        ? partesPorHectares(estado.quantidade_produzida_dia, alvos.map((a) => /** @type {string} */ (a.hectares)))
        : null;
      /** D-PROD-274: o nº do receituário vai em cada apontamento (sem ele, nenhuma chave nova: a gravação de sempre). */
      const comReceituario = receituario ? { numero_receituario: receituario } : {};
      const respostas = [];
      if (semArea) {
        respostas.push(await lancarNaTransacao(tx, contexto, { clienteId: cli, empresaId, tempo, atividadeId, estado: { ...estado, atividade_area_id: null, ...comTermino, ...comReceituario }, origem, linhas }));
      }
      for (const [i, a] of alvos.entries()) {
        const plano = planos[i];
        const linhasDaArea = varias ? { ...plano.linhas, operationId: chaveDaArea(chave, i) } : linhas;
        // D-PROD-265: o mesmo término em todas as áreas (sem ele, nenhuma chave nova: a gravação de sempre).
        const estadoDaArea = {
          ...estado,
          area_executada_dia: varias ? a.hectares : estado.area_executada_dia,
          ...(producaoPorArea ? { quantidade_produzida_dia: producaoPorArea[i] } : {}),
          atividade_area_id: situacao[i].atividade_area_id,
          ...comTermino,
          ...comReceituario,
        };
        respostas.push(
          await naArea(area(i, plano.indices), () =>
            lancarNaTransacao(tx, contexto, { clienteId: cli, empresaId, tempo, atividadeId, estado: estadoDaArea, origem, linhas: /** @type {any} */ (linhasDaArea) })
          )
        );
      }
      // D-PROD-267: "Concluída" — as áreas deste registro concluem no término (ou no dia) e, com todas concluídas, a atividade.
      let areasConcluidas = 0;
      let atividadeConcluida = false;
      if (concluir) {
        const fim = termino ?? dia;
        if (semArea) {
          atividadeConcluida = await concluirAtividadeSemArea(tx, contexto, { clienteId: cli, empresaId, atividadeId: /** @type {string} */ (atividadeId), dia: fim, tempo, automatica: false });
        } else {
          for (const [i] of alvos.entries()) {
            await naArea(area(i), async () => {
              const linha = await buscarAreaDaAtividade(tx, cli, empresaId, /** @type {string} */ (atividadeId), /** @type {string} */ (situacao[i].atividade_area_id));
              await concluirAreaNaTransacao(tx, contexto, { clienteId: cli, empresaId, atividadeId: /** @type {string} */ (atividadeId), area: linha, dia: fim });
            });
            areasConcluidas += 1;
          }
          atividadeConcluida = await concluirAtividadeSeAreasConcluidas(tx, contexto, { clienteId: cli, empresaId, atividadeId: /** @type {string} */ (atividadeId), tempo });
        }
      }
      // D-PROD-274: "Pasto liberado em" — o fim do serviço mais a maior carência dos produtos lançados (lida, nunca gravada).
      const produtoIds = [...new Set(linhas.produtos.map((l) => l.produto_id))];
      const carencias = produtoIds.length
        ? (await tx.produto.findMany({ where: { cliente_id: cli, id: { in: produtoIds } }, select: { carencia_dias: true } })).map((/** @type {{ carencia_dias: number|null }} */ r) => r.carencia_dias)
        : [];
      const liberado = pastoLiberadoEm(termino ?? dia, carencias);
      const [primeira] = respostas;
      const ultima = respostas[respostas.length - 1];
      return {
        // A forma de sempre (o apontamento da 1ª área, a atividade depois de tudo) e, D-PROD-263, um apontamento por área.
        ...primeira,
        atividade: concluir || plantioCompletado.length ? await carregarAtividadeDetalhe(tx, cli, empresaId, /** @type {string} */ (atividadeId)) : ultima.atividade,
        apontamentos: respostas.map((r) => r.apontamento),
        registro: {
          // D-PROD-267: o que o "Concluída" fez e, no "é um serviço novo", o que aconteceu com a atividade parada.
          areas_concluidas: areasConcluidas,
          atividade_concluida: atividadeConcluida,
          atividade_anterior: anterior,
          atividade_criada: criada,
          atividade_id: atividadeId,
          atividade_nome: atividadeNome,
          atividade_area_id: situacao[0]?.atividade_area_id ?? null,
          area_iniciada: situacao[0]?.iniciada ?? false,
          areas: alvos.map((a, i) => ({
            area_id: a.area_id,
            atividade_area_id: situacao[i].atividade_area_id,
            apontamento_id: /** @type {any} */ (respostas[i].apontamento)?.id ?? null,
            hectares: respostas[i].apontamento?.area_executada_dia ?? null,
            area_adicionada: situacao[i].adicionada,
            area_iniciada: situacao[i].iniciada,
          })),
          // D-PROD-274: o local (sem área), o que foi completado no plantio e o "pasto liberado em".
          local: semArea ? local : null,
          plantio_completado: plantioCompletado,
          pasto_liberado_em: liberado.pasto_liberado_em,
          carencia_dias: liberado.carencia_dias,
          // D-PROD-276: a reforma da atividade depois do registro e o que o "Faz parte de" fez.
          planejamento_id: planejamentoDaAtividade,
          planejamento_ligacao: planejamentoLigacao,
        },
      };
    },
  });
};
