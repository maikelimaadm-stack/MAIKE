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
 * Idempotência: `operation_id` obrigatório (recibo `atividade_registrar_v1`; reenvio igual → 200 `replay: true`;
 * corpo diferente → 409). D-PROD-265: sem `data_termino`, o fingerprint é byte a byte o de antes (nenhuma chave nova), e o
 * reenvio pendente de antes do deploy ainda casa; com ela, ela entra no fingerprint. Com várias áreas, o apontamento da área i (0-based) grava as linhas com a chave
 * `<operation_id>` (i = 0) ou `<operation_id>:a<i+1>`, que deriva as das linhas como sempre (`:p1`, `:o1`, `:s1`).
 * Permissão = a de lançar apontamento (`atividadeApontamentos.criar`). Tenant só do auth_context.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError, atividadeReferenciaInvalida } from '../../shared/errors/AppError.js';
import { fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido } from '../gestao/gestaoComum.js';
import { PADRAO_DECIMAL, STATUS_ATIVIDADE, comoData, decimalDoCorpo, diaDe, diaDoCorpo, exigirDiaNaoFuturo, idOuNulo, temCampo, tempoDaFazenda, travarAtividade } from './atividadeComum.js';
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
import { STATUS_AREA, adicionarAreaNaTransacao, exigirAreaDoMapa, iniciarAreaNaTransacao } from './atividadeAreaService.js';
import { camposDaLinha as camposDaLinhaMaquina, leituraVigenteDoBem } from './atividadeApontamentoMaquinaService.js';
import { travarBens } from './atividadeApontamentoMaquinaRepository.js';
import { partesPorHectares, trechosDoMedidor } from './atividadeRegistroRateio.js';
import { ehTipoAbastecimento } from '../tiposAtividade/tipoAtividadePadroes.js';
import { lerTipoAtividade } from './atividadeRepository.js';
import { NOME_MAXIMO, abrirNa } from './atividadeService.js';

export const TIPO_OPERACAO_REGISTRAR = 'atividade_registrar_v1';

/** D-PROD-263 — teto de áreas num registro (o schema da rota confere o mesmo). */
export const AREAS_NO_REGISTRO_MAXIMO = 20;

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

/** Primeiro dia do mês do dia e do mês seguinte (strings → `Date` UTC de coluna `@db.Date`). @param {string} dia */
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
  const produtos = repartirPorQuantidade(linhas.produtos, 'quantidade', hectares);
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
 * A atividade ABERTA do tipo, da fazenda, com `data_inicio` no mês, que contém a área PLANEJADA ou EM_ANDAMENTO; havendo
 * mais de uma, a de `updatedAt` mais recente (desempate: `id` maior).
 * @param {any} tx @param {{ clienteId: string, empresaId: string, tipoId: string, areaId: string, dia: string }} p
 */
const buscarAtividadeAberta = (tx, { clienteId, empresaId, tipoId, areaId, dia }) => {
  const { de, ate } = limitesDoMes(dia);
  return tx.atividade.findFirst({
    where: {
      cliente_id: clienteId, empresa_id: empresaId, tipo_atividade_id: tipoId, status: STATUS_ATIVIDADE.ABERTA,
      data_inicio: { gte: de, lt: ate },
      areas: { some: { area_id: areaId, status: { in: [STATUS_AREA.PLANEJADA, STATUS_AREA.EM_ANDAMENTO] } } },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, nome: true, data_inicio: true },
  });
};

// ─── o registro ─────────────────────────────────────────────────────────────

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, any>} corpo
 */
export const registrarCampo = async (contexto, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const comAreas = temCampo(corpo, 'areas') && corpo.areas !== undefined;
  const comAreaId = temCampo(corpo, 'area_id') && corpo.area_id !== undefined;
  if (comAreas && comAreaId) {
    throw invalido('envie a área em area_id ou as áreas em areas[], nunca os dois', { field: 'areas', reason: 'areas_e_area_id' });
  }
  if (comAreas && temCampo(corpo, 'area_executada_dia')) {
    throw invalido('com areas[], os hectares vão em cada área (areas[i].hectares), não em area_executada_dia', { field: 'area_executada_dia', reason: 'com_areas' });
  }
  const tipoId = idOuNulo(corpo.tipo_atividade_id, 'tipo_atividade_id');
  if (!comAreas && !idOuNulo(corpo.area_id, 'area_id')) throw invalido('area_id ou areas é obrigatório', { field: 'area_id', reason: 'obrigatorio' });
  if (!tipoId) throw invalido('tipo_atividade_id é obrigatório', { field: 'tipo_atividade_id', reason: 'obrigatorio' });
  const safra = corpo.safra_ciclo === undefined || corpo.safra_ciclo === null ? null : String(corpo.safra_ciclo).trim() || null;
  /** @type {import('./atividadeApontamentoService.js').EstadoDoDia} */
  const estado = { ...VAZIO, ...camposDoCorpo(corpo) };
  // As áreas do registro (na ordem do corpo). Uma área só é o caso de sempre: os hectares dela são o `area_executada_dia`.
  const alvos = comAreas ? areasDoRegistro(corpo.areas) : [{ area_id: /** @type {string} */ (idOuNulo(corpo.area_id, 'area_id')), hectares: estado.area_executada_dia }];
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
  const origem = origemDoCorpo(corpo.origem);
  const linhas = linhasDoCorpo(corpo);
  if (!linhas.operationId) throw invalido('operation_id é obrigatório', { field: 'operation_id', reason: 'obrigatorio' });
  const chave = linhas.operationId;
  const linhasDoFingerprint = { produtos: linhas.produtos, maquinas: canonico(linhas.maquinas), ...linhasNovasDoFingerprint(linhas) };

  return comReciboOpcional(contexto, {
    operationId: chave,
    tipoOperacao: TIPO_OPERACAO_REGISTRAR,
    bases: alvos.map((_, i) => chaveDaArea(chave, i)),
    // Uma área: o fingerprint de sempre (o `areas` de um item é o mesmo registro do `area_id`). Várias: v2, com as áreas.
    fingerprint: () =>
      fingerprintDePayload(
        varias
          ? { v: 2, empresa_id: corpo.empresa_id, areas: alvos, tipo_atividade_id: tipoId, safra_ciclo: safra, estado, ...comTermino, origem, ...linhasDoFingerprint }
          : { v: 1, empresa_id: corpo.empresa_id, area_id: alvos[0].area_id, tipo_atividade_id: tipoId, safra_ciclo: safra, estado, ...comTermino, origem, ...linhasDoFingerprint }
      ),
    executar: async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      exigirDiaNaoFuturo(tempo, dia, 'data_operacional');
      if (termino) exigirDiaNaoFuturo(tempo, termino, 'data_termino');
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

      // A corrida: quem chega depois espera aqui e então ENXERGA a atividade criada pelo primeiro. Uma trava por área,
      // em ordem de id: dois registros com áreas em comum se enfileiram, sem deadlock.
      for (const areaId of alvos.map((a) => a.area_id).sort()) {
        const trava = `atividade-registro:${cli}:${empresaId}:${tipoId}:${areaId}:${dia.slice(0, 7)}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${trava}, 0))`;
      }

      let achada = null;
      for (const a of alvos) {
        achada = await buscarAtividadeAberta(tx, { clienteId: cli, empresaId, tipoId, areaId: a.area_id, dia });
        if (achada) break;
      }

      let atividadeId;
      let atividadeNome;
      let criada = false;
      /** O que o registro fez com cada área da atividade, na ordem do corpo. */
      const situacao = alvos.map(() => ({ atividade_area_id: /** @type {string|null} */ (null), adicionada: false, iniciada: false }));
      if (achada) {
        atividadeId = achada.id;
        atividadeNome = achada.nome;
        if (!(await travarAtividade(tx, cli, empresaId, atividadeId))) throw atividadeReferenciaInvalida('tipo_atividade_id', 'inexistente');
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
      } else {
        criada = true;
        const bemDaPrimeiraMaquina = Array.isArray(corpo.maquinas) && corpo.maquinas[0]?.bem_id ? String(corpo.maquinas[0].bem_id) : null;
        const comum = { data_inicio: dia, safra_ciclo: safra, bem_id: bemDaPrimeiraMaquina };
        const nome = nomeDoRegistro(tipo.nome_tipo, nomes.get(alvos[0].area_id) ?? '', dia, alvos.length - 1);
        const aberta = await abrirNa(tx, contexto, {
          clienteId: cli,
          empresaId,
          tempo,
          tipoAtividadeId: tipoId,
          // Uma área: a abertura de sempre (EM_ANDAMENTO desde o dia). Várias: `areas[]` (todas "a iniciar", planejada =
          // o tamanho), iniciadas logo abaixo no dia do registro (= o início da atividade).
          estado: varias
            ? { ...comum, nome, areas: alvos.map((a) => ({ area_id: a.area_id, area_planejada: undefined })) }
            : { ...comum, nome, area_id: alvos[0].area_id, area_planejada: mapas[0].tamanho },
          acao: 'atividade.abrir',
          auditoriaExtra: { origem_registro_de_campo: true },
        });
        atividadeId = aberta.id;
        atividadeNome = aberta.nome;
        for (const [i, a] of alvos.entries()) {
          const linha = await tx.atividadeArea.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, area_id: a.area_id } });
          if (linha?.status === STATUS_AREA.PLANEJADA) await iniciarAreaNaTransacao(tx, contexto, { clienteId: cli, empresaId, atividadeId, area: linha, dia, inicioDaAtividade: dia });
          situacao[i].atividade_area_id = linha?.id ?? null;
        }
      }

      // As linhas de cada área: as do corpo (uma área) ou as partes pelos hectares (várias).
      const planos = varias
        ? await repartirLinhas(tx, { clienteId: cli, empresaId, dia, linhas, hectares: alvos.map((a) => /** @type {string} */ (a.hectares)) })
        : [{ linhas, indices: undefined }];
      const respostas = [];
      for (const [i, a] of alvos.entries()) {
        const plano = planos[i];
        const linhasDaArea = varias ? { ...plano.linhas, operationId: chaveDaArea(chave, i) } : linhas;
        // D-PROD-265: o mesmo término em todas as áreas (sem ele, nenhuma chave nova: a gravação de sempre).
        const estadoDaArea = { ...estado, area_executada_dia: varias ? a.hectares : estado.area_executada_dia, atividade_area_id: situacao[i].atividade_area_id, ...comTermino };
        respostas.push(
          await naArea(area(i, plano.indices), () =>
            lancarNaTransacao(tx, contexto, { clienteId: cli, empresaId, tempo, atividadeId, estado: estadoDaArea, origem, linhas: /** @type {any} */ (linhasDaArea) })
          )
        );
      }
      const [primeira] = respostas;
      const ultima = respostas[respostas.length - 1];
      return {
        // A forma de sempre (o apontamento da 1ª área, a atividade depois de tudo) e, D-PROD-263, um apontamento por área.
        ...primeira,
        atividade: ultima.atividade,
        apontamentos: respostas.map((r) => r.apontamento),
        registro: {
          atividade_criada: criada,
          atividade_id: atividadeId,
          atividade_nome: atividadeNome,
          atividade_area_id: situacao[0].atividade_area_id,
          area_iniciada: situacao[0].iniciada,
          areas: alvos.map((a, i) => ({
            area_id: a.area_id,
            atividade_area_id: situacao[i].atividade_area_id,
            apontamento_id: /** @type {any} */ (respostas[i].apontamento)?.id ?? null,
            hectares: respostas[i].apontamento?.area_executada_dia ?? null,
            area_adicionada: situacao[i].adicionada,
            area_iniciada: situacao[i].iniciada,
          })),
        },
      };
    },
  });
};
