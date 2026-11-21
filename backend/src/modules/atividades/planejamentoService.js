/**
 * MAIKE-ENTREGA3 (D-PROD-275) — a REFORMA DE PASTAGEM como agrupador (`Planejamento` + `PlanejamentoArea`), na tela
 * `op-atividades`. É a "safra" do Aegro, só que para um pasto: o "Planejar" cria a reforma com 4 campos e cada realização
 * da área entra nela pelo registro de campo (`Atividade.planejamento_id`, "Faz parte de"). Nenhum custo é gravado aqui:
 * o total, o R$/ha e o custo por tipo são calculados na LEITURA, com os MESMOS números da lista
 * (`custosTotaisDasAtividades`: as linhas confirmadas dos lançamentos confirmados e os abastecimentos confirmados).
 *
 *  - `GET  /planejamentos?empresa_id[&status][&area_id]` — as reformas da fazenda (abertas primeiro; depois o início mais
 *    recente), cada uma com as áreas (hectares e o capim de hoje da área) e o capim que vai ficar;
 *  - `GET  /planejamentos/:id?empresa_id` — a reforma e o `custo`: custo total, R$/ha (custo ÷ hectares da reforma),
 *    custo por tipo fixo e os serviços em ordem de data com a situação de cada um (as canceladas aparecem, mas não somam);
 *  - `POST /planejamentos` — cria: `tipo` (REFORMA | FORMACAO | OUTRO), `areas: [{ area_id, hectares? }]` (1..20, da
 *    fazenda e ativas; sem hectares, o tamanho da área), `cultura_alvo_id` (opcional: o capim que vai ficar, do Cadastro de
 *    Culturas da fazenda e ativo) e `data_inicio` (o início previsto; pode ser futuro). O nome e a safra são do servidor:
 *    "Reforma · PASTO DA AROEIRA · 2026/27" (a safra é o ano agrícola do início, `safraDoDia`). 201;
 *  - `POST /planejamentos/:id/concluir` — `versao` (CAS), `data_conclusao` (opcional; padrão hoje na fazenda; nunca no
 *    futuro nem antes do início) e `trocar_capim` (opcional): com `true`, o capim de cada área da reforma que ainda não é o
 *    capim que vai ficar passa a ser ele pelo caminho de sempre da área (`atualizarNaTransacao` do `PATCH
 *    /areas-pastagem/:id`, com a auditoria `update` da área), na MESMA transação da conclusão;
 *  - `POST /planejamentos/:id/cancelar` — `versao` (CAS); só a reforma aberta; nada é apagado (as realizações continuam
 *    ligadas a ela e com os seus custos).
 *
 * Tenant só do auth_context; a fazenda vem do corpo (escrita) ou da query (leitura) e é conferida no tenant. Reforma de
 * outra fazenda ou de outro tenant = `PLANEJAMENTO_NOT_FOUND` (sem oráculo). Toda escrita é auditada.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  atividadeDataInvalida,
  atividadeReferenciaInvalida,
  atividadeStatusInvalido,
  atividadeVersaoConflito,
  planejamentoNotFound,
} from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { atualizarNaTransacao as atualizarAreaNaTransacao } from '../areas/areaPastagemService.js';
import { arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido } from '../gestao/gestaoComum.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import { CATEGORIAS_TIPO_FIXO, TIPOS_FIXOS_ATIVIDADE } from '../tiposAtividade/tipoAtividadePadroes.js';
import {
  STATUS_ATIVIDADE,
  TRANSACAO_LEITURA,
  comoData,
  decimalDoCorpo,
  diaDe,
  diaDoCorpo,
  exigirDiaNaoFuturo,
  idOuNulo,
  iso,
  t4,
  tempoDaFazenda,
} from './atividadeComum.js';
import { exigirAreaDoMapa } from './atividadeAreaService.js';
import { andamentoDasAtividades, categoriasDosTipos, custosTotaisDasAtividades } from './atividadeRepository.js';
import { safraDoDia, tipoFixoDaCategoria } from './atividadeRegistroService.js';
import { NOME_MAXIMO } from './atividadeService.js';

/** Os tipos do planejamento (CHECK `Planejamento_tipo_check`). */
export const TIPOS_PLANEJAMENTO = Object.freeze(['REFORMA', 'FORMACAO', 'OUTRO']);

/** O ciclo do planejamento (CHECK `Planejamento_status_check`). */
export const STATUS_PLANEJAMENTO = Object.freeze({ ABERTO: 'ABERTO', CONCLUIDO: 'CONCLUIDO', CANCELADO: 'CANCELADO' });

/** Entidade da sequência do tenant (`reservarNumero`) e da auditoria. */
export const ENTIDADE_PLANEJAMENTO = 'Planejamento';

/** Teto de áreas numa reforma (o schema da rota confere o mesmo). */
export const AREAS_NO_PLANEJAMENTO_MAXIMO = 20;

/** Teto da lista (uma fazenda tem poucas reformas por ano). */
export const LIMITE_PLANEJAMENTOS = 200;

/** O começo do nome sugerido, por tipo. */
export const PREFIXO_DO_TIPO = Object.freeze(/** @type {Record<string, string>} */ ({ REFORMA: 'Reforma', FORMACAO: 'Formação', OUTRO: 'Planejamento' }));

/**
 * O nome sugerido: `<Reforma|Formação|Planejamento> · <Área 1>[ +N] · <safra>` ("Reforma · PASTO DA AROEIRA · 2026/27"),
 * sempre dentro de `NOME_MAXIMO`: passando, a ÁREA é truncada (o `+N` e a safra ficam).
 * @param {string} tipo @param {string[]} areas os nomes, na ordem do corpo @param {string} dia o início previsto
 */
export const nomeDoPlanejamento = (tipo, areas, dia) => {
  const sep = ' · ';
  const prefixo = PREFIXO_DO_TIPO[tipo] ?? PREFIXO_DO_TIPO.OUTRO;
  const pos = `${areas.length > 1 ? ` +${areas.length - 1}` : ''}${sep}${safraDoDia(dia)}`;
  const sobra = NOME_MAXIMO - prefixo.length - sep.length - pos.length;
  const primeira = String(areas[0] ?? '').trim();
  const area = primeira.length > sobra ? primeira.slice(0, Math.max(sobra, 1)).trimEnd() : primeira;
  return `${prefixo}${sep}${area}${pos}`.slice(0, NOME_MAXIMO);
};

/**
 * As colunas que a leitura usa (a reforma, as áreas com o capim de hoje e o capim que vai ficar).
 * @type {import('@prisma/client').Prisma.PlanejamentoSelect}
 */
const SELECAO = {
  id: true, empresa_id: true, numero: true, nome: true, tipo: true, safra_ciclo: true, cultura_alvo_id: true, data_inicio: true,
  status: true, data_conclusao: true, versao: true, createdAt: true, updatedAt: true,
  culturaAlvo: { select: { id: true, codigo: true, nome: true, especie: true, cultivar: true } },
  areas: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      area_id: true, hectares: true,
      area: { select: { id: true, nome: true, tamanho_hectares: true, cultura_id: true, cultura: { select: { id: true, nome: true } } } },
    },
  },
};

/** @param {any} c */
const culturaPublica = (c) => (c ? { id: c.id, codigo: c.codigo ?? null, nome: c.nome, especie: c.especie ?? null, cultivar: c.cultivar ?? null } : null);

/**
 * A forma pública da reforma: as colunas, o capim que vai ficar e as áreas (com os hectares na reforma, o tamanho e o capim
 * de HOJE da área — a tela compara os dois: "recuperação: mesmo capim" ou "renovação: troca de capim").
 * @param {any} p
 */
export const comoPlanejamentoPublico = (p) => {
  const areas = (p.areas ?? []).map((/** @type {any} */ a) => ({
    area_id: a.area_id,
    nome: a.area?.nome ?? null,
    hectares: t4(a.hectares),
    tamanho_hectares: t4(a.area?.tamanho_hectares ?? null),
    cultura_id: a.area?.cultura_id ?? null,
    cultura: a.area?.cultura ? { id: a.area.cultura.id, nome: a.area.cultura.nome } : null,
  }));
  const hectares = areas.reduce((/** @type {any} */ t, /** @type {any} */ a) => t.plus(dec(a.hectares)), dec(0));
  return {
    id: p.id,
    empresa_id: p.empresa_id,
    numero: p.numero,
    nome: p.nome,
    tipo: p.tipo,
    safra_ciclo: p.safra_ciclo ?? null,
    cultura_alvo_id: p.cultura_alvo_id ?? null,
    cultura_alvo: culturaPublica(p.culturaAlvo),
    data_inicio: diaDe(p.data_inicio),
    status: p.status,
    data_conclusao: diaDe(p.data_conclusao),
    versao: p.versao,
    hectares: t4(hectares),
    areas,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
};

/** Auditoria: só as colunas (o nome é texto do servidor, não livre). @param {any} p */
const paraAuditoria = (p) => ({
  id: p.id, empresa_id: p.empresa_id, numero: p.numero, nome: p.nome, tipo: p.tipo, safra_ciclo: p.safra_ciclo ?? null,
  cultura_alvo_id: p.cultura_alvo_id ?? null, data_inicio: diaDe(p.data_inicio), status: p.status, data_conclusao: diaDe(p.data_conclusao),
  versao: p.versao, areas: (p.areas ?? []).map((/** @type {any} */ a) => ({ area_id: a.area_id, hectares: t4(a.hectares) })),
});

/**
 * A reforma da fazenda (outra fazenda ou outro tenant = 404, sem oráculo).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id
 */
const lerPlanejamento = async (tx, clienteId, empresaId, id) => {
  const p = await tx.planejamento.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, select: SELECAO });
  if (!p) throw planejamentoNotFound();
  return p;
};

/**
 * A situação do serviço na lista (a mesma regra da D-PROD-267): concluída, cancelada, em andamento (com dia lançado) ou
 * planejada (sem nenhum).
 * @param {string} status @param {number} lancamentos
 */
const situacaoDoServico = (status, lancamentos) =>
  status === STATUS_ATIVIDADE.CONCLUIDA ? 'CONCLUIDA' : status === STATUS_ATIVIDADE.CANCELADA ? 'CANCELADA' : lancamentos > 0 ? 'EM_ANDAMENTO' : 'PLANEJADA';

/**
 * O CUSTO da reforma, calculado na leitura (nada é gravado): as realizações ligadas a ela (`Atividade.planejamento_id`), com
 * o `custo_total` de cada uma pelo MESMO cálculo da lista (`custosTotaisDasAtividades`), a situação e o primeiro e o último
 * dia lançados (`andamentoDasAtividades`) e o tipo fixo ATUAL da operação. As CANCELADAS aparecem na lista dos serviços
 * mas não somam. `custo_por_ha` = custo total ÷ hectares da reforma (4 casas; nulo sem custo ou sem hectares).
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {{ id: string, hectares: string|null }} planejamento
 */
const custoDoPlanejamento = async (db, clienteId, empresaId, planejamento) => {
  const atividades = /** @type {any[]} */ (
    await db.atividade.findMany({
      where: { cliente_id: clienteId, empresa_id: empresaId, planejamento_id: planejamento.id },
      orderBy: [{ data_inicio: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, numero: true, nome: true, status: true, tipo_atividade_id: true, tipo_atividade_nome: true, data_inicio: true, data_conclusao: true },
    })
  );
  const ids = atividades.map((a) => String(a.id));
  const custos = ids.length ? /** @type {any[]} */ (await custosTotaisDasAtividades(db, clienteId, empresaId, ids)) : [];
  const andamento = ids.length ? /** @type {any[]} */ (await andamentoDasAtividades(db, clienteId, empresaId, ids)) : [];
  const categorias = new Map(
    ids.length ? (await categoriasDosTipos(db, clienteId, [...new Set(atividades.map((a) => String(a.tipo_atividade_id)))])).map((t) => [t.id, t.categoria]) : []
  );
  const custoDe = new Map(custos.map((c) => [c.atividade_id, c.custo_total === null || c.custo_total === undefined ? null : String(c.custo_total)]));
  /** @type {Map<string, Record<string, any>>} */
  const porTipo = new Map();
  let total = /** @type {any} */ (null);
  const servicos = atividades.map((a) => {
    const linhas = andamento.filter((l) => l.atividade_id === a.id);
    const lancamentos = linhas.reduce((t, l) => t + Number(l.lancamentos ?? 0), 0);
    /** @type {string|null} */
    let primeiro = null;
    /** @type {string|null} */
    let ultimo = null;
    for (const l of linhas) {
      const p = diaDe(l.primeiro) ?? null;
      const u = diaDe(l.ultimo) ?? null;
      if (p && (!primeiro || p < primeiro)) primeiro = p;
      if (u && (!ultimo || u > ultimo)) ultimo = u;
    }
    const tipoFixo = tipoFixoDaCategoria(categorias.get(a.tipo_atividade_id));
    const custo = custoDe.get(a.id) ?? null;
    const conta = a.status !== STATUS_ATIVIDADE.CANCELADA;
    if (conta && custo !== null) {
      total = (total ?? dec(0)).plus(dec(custo));
      const atual = porTipo.get(tipoFixo) ?? { tipo_fixo: tipoFixo, custo: dec(0), servicos: 0 };
      atual.custo = atual.custo.plus(dec(custo));
      porTipo.set(tipoFixo, atual);
    }
    if (conta) {
      const atual = porTipo.get(tipoFixo) ?? { tipo_fixo: tipoFixo, custo: dec(0), servicos: 0 };
      atual.servicos += 1;
      porTipo.set(tipoFixo, atual);
    }
    return {
      atividade_id: a.id,
      numero: a.numero,
      nome: a.nome,
      tipo_atividade_id: a.tipo_atividade_id,
      tipo_atividade_nome: a.tipo_atividade_nome,
      tipo_fixo: tipoFixo,
      status: a.status,
      situacao: situacaoDoServico(a.status, lancamentos),
      data_inicio: diaDe(a.data_inicio),
      primeiro_dia: primeiro,
      ultimo_dia: ultimo,
      data_conclusao: diaDe(a.data_conclusao),
      custo_total: custo === null ? null : t4(custo),
      conta_no_custo: conta,
    };
  });
  // Os serviços em ordem de data (o primeiro dia lançado; sem lançamento, o início da atividade).
  servicos.sort((x, y) => {
    const dx = x.primeiro_dia ?? x.data_inicio ?? '';
    const dy = y.primeiro_dia ?? y.data_inicio ?? '';
    return dx === dy ? String(x.atividade_id).localeCompare(String(y.atividade_id)) : dx < dy ? -1 : 1;
  });
  const hectares = planejamento.hectares === null ? null : dec(planejamento.hectares);
  const rotulo = new Map(TIPOS_FIXOS_ATIVIDADE.map((t) => [t.categoria, t.rotulo]));
  return {
    custo_total: total === null ? null : t4(total),
    hectares: hectares === null ? null : t4(hectares),
    custo_por_ha: total !== null && hectares !== null && hectares.gt(0) ? t4(arredondar(total.dividedBy(hectares), 4)) : null,
    por_tipo: [...porTipo.values()]
      .sort((x, y) => CATEGORIAS_TIPO_FIXO.indexOf(x.tipo_fixo) - CATEGORIAS_TIPO_FIXO.indexOf(y.tipo_fixo))
      .map((t) => ({ tipo_fixo: t.tipo_fixo, rotulo: rotulo.get(t.tipo_fixo) ?? 'Outros', custo_total: t4(t.custo), servicos: t.servicos })),
    servicos,
  };
};

/** @param {any} db @param {string} clienteId @param {string} empresaId @param {any} registro */
const detalheDe = async (db, clienteId, empresaId, registro) => {
  const publico = comoPlanejamentoPublico(registro);
  return { ...publico, custo: await custoDoPlanejamento(db, clienteId, empresaId, publico) };
};

// ─── leitura ────────────────────────────────────────────────────────────────

/**
 * As reformas da fazenda (até `LIMITE_PLANEJAMENTOS`): as ABERTAS primeiro, depois o início mais recente. `status` e
 * `area_id` filtram. `{ items }`.
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const listar = async (contexto, query = {}) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const db = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(db, cli, query.empresa_id);
  const linhas = /** @type {any[]} */ (
    await db.planejamento.findMany({
      where: {
        cliente_id: cli, empresa_id: empresaId,
        ...(typeof query.status === 'string' && query.status ? { status: query.status } : {}),
        ...(typeof query.area_id === 'string' && query.area_id ? { areas: { some: { area_id: query.area_id } } } : {}),
      },
      // 'ABERTO' < 'CANCELADO' < 'CONCLUIDO': as abertas primeiro.
      orderBy: [{ status: 'asc' }, { data_inicio: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: LIMITE_PLANEJAMENTOS,
      select: SELECAO,
    })
  );
  return { items: linhas.map(comoPlanejamentoPublico) };
};

/**
 * A reforma com o custo (total, R$/ha, por tipo e os serviços), numa leitura consistente.
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {string} id @param {Record<string, any>} [query]
 */
export const obter = async (contexto, id, query = {}) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  return emTransacao(TRANSACAO_LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    return detalheDe(tx, cli, empresaId, await lerPlanejamento(tx, cli, empresaId, id));
  });
};

// ─── escrita ────────────────────────────────────────────────────────────────

/**
 * As áreas do corpo: 1..20 `{ area_id, hectares? }`, a mesma área nunca duas vezes (422 `duplicada`), hectares em texto
 * decimal maior que zero (400 `formato` / `nao_positivo`); sem hectares, o tamanho da área.
 * @param {unknown} v @returns {Array<{ area_id: string, hectares: string|undefined }>}
 */
const areasDoCorpo = (v) => {
  if (!Array.isArray(v) || v.length === 0) throw invalido('areas deve ter ao menos uma área', { field: 'areas', reason: 'obrigatorio' });
  if (v.length > AREAS_NO_PLANEJAMENTO_MAXIMO) throw invalido(`areas aceita no máximo ${AREAS_NO_PLANEJAMENTO_MAXIMO} áreas`, { field: 'areas', reason: 'longo' });
  const vistas = new Set();
  return v.map((item, i) => {
    const areaId = idOuNulo(item?.area_id, `areas[${i}].area_id`);
    if (!areaId) throw invalido(`areas[${i}].area_id é obrigatório`, { field: `areas[${i}].area_id`, reason: 'obrigatorio' });
    if (vistas.has(areaId)) throw atividadeReferenciaInvalida(`areas[${i}].area_id`, 'duplicada');
    vistas.add(areaId);
    const campo = `areas[${i}].hectares`;
    const hectares = decimalDoCorpo(item?.hectares, campo) ?? undefined;
    if (hectares !== undefined && !dec(hectares).gt(0)) throw invalido(`${campo} deve ser maior que zero`, { field: campo, reason: 'nao_positivo' });
    return { area_id: areaId, hectares };
  });
};

/**
 * O capim que vai ficar: do Cadastro de Culturas DESTA fazenda (outra fazenda ou outro tenant = `inexistente`) e ativo.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id
 */
const exigirCulturaAlvo = async (tx, clienteId, empresaId, id) => {
  const c = await tx.cultura.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, select: { id: true, ativo: true } });
  if (!c) throw atividadeReferenciaInvalida('cultura_alvo_id', 'inexistente');
  if (!c.ativo) throw atividadeReferenciaInvalida('cultura_alvo_id', 'inativo');
};

/**
 * CRIAR a reforma (`POST /planejamentos`, 201). O nome e a safra são do servidor; o número é da sequência do tenant.
 * @param {{ requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} corpo
 */
export const criar = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const tipo = typeof corpo.tipo === 'string' ? corpo.tipo : '';
  if (!TIPOS_PLANEJAMENTO.includes(tipo)) throw invalido(`tipo deve ser ${TIPOS_PLANEJAMENTO.join(', ')}`, { field: 'tipo', reason: 'formato' });
  const areas = areasDoCorpo(corpo.areas);
  const culturaAlvoId = idOuNulo(corpo.cultura_alvo_id, 'cultura_alvo_id') ?? null;
  const dataInicio = diaDoCorpo(corpo.data_inicio, 'data_inicio');
  if (!dataInicio) throw invalido('data_inicio é obrigatório: informe o início previsto', { field: 'data_inicio', reason: 'obrigatorio' });

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE (e o fuso configurado, como em toda escrita da tela)
      const mapas = [];
      for (const [i, a] of areas.entries()) mapas.push(await exigirAreaDoMapa(tx, cli, empresaId, a.area_id, `areas[${i}].area_id`));
      if (culturaAlvoId) await exigirCulturaAlvo(tx, cli, empresaId, culturaAlvoId);
      const nomes = new Map(
        (await tx.areaPastagem.findMany({ where: { cliente_id: cli, id: { in: areas.map((a) => a.area_id) } }, select: { id: true, nome: true } })).map(
          (/** @type {{ id: string, nome: string }} */ r) => [r.id, r.nome]
        )
      );
      const numero = String(await reservarNumero(tx, { clienteId: cli, entidade: ENTIDADE_PLANEJAMENTO, escopoTipo: ESCOPO_TENANT }));
      const criado = await tx.planejamento.create({
        data: {
          cliente_id: cli,
          empresa_id: empresaId,
          numero,
          nome: nomeDoPlanejamento(tipo, areas.map((a) => nomes.get(a.area_id) ?? ''), dataInicio),
          tipo,
          safra_ciclo: safraDoDia(dataInicio),
          cultura_alvo_id: culturaAlvoId,
          data_inicio: comoData(dataInicio),
          status: STATUS_PLANEJAMENTO.ABERTO,
          criado_por_usuario_id: auth.usuarioId ?? null,
          versao: 1,
        },
        select: { id: true },
      });
      for (const [i, a] of areas.entries()) {
        await tx.planejamentoArea.create({
          data: { cliente_id: cli, empresa_id: empresaId, planejamento_id: criado.id, area_id: a.area_id, hectares: a.hectares ?? mapas[i].tamanho },
        });
      }
      const registro = await lerPlanejamento(tx, cli, empresaId, criado.id);
      await registrarEvento(contexto, { acao: 'planejamento.criar', entidade: ENTIDADE_PLANEJAMENTO, entidadeId: criado.id, dadosNovos: paraAuditoria(registro) }, tx);
      return detalheDe(tx, cli, empresaId, registro);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * Trava a reforma (`FOR UPDATE`) e confere o status e a versão. Outra fazenda ou outro tenant = 404.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id @param {unknown} versao @param {string} acao
 */
const travarParaMudar = async (tx, clienteId, empresaId, id, versao, acao) => {
  const linhas = /** @type {any[]} */ (
    await tx.$queryRaw`SELECT id FROM "Planejamento" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`
  );
  if (linhas.length !== 1) throw planejamentoNotFound();
  const anterior = await lerPlanejamento(tx, clienteId, empresaId, id);
  if (anterior.status !== STATUS_PLANEJAMENTO.ABERTO) throw atividadeStatusInvalido({ status: anterior.status, acao, entidade: 'planejamento' });
  if (anterior.versao !== versao) throw atividadeVersaoConflito(anterior.versao, versao, { entidade: 'planejamento' });
  return anterior;
};

/**
 * CONCLUIR a reforma (`POST /planejamentos/:id/concluir`). Com `trocar_capim: true`, as áreas da reforma que ainda não têm
 * o capim que vai ficar passam a tê-lo (o caminho de sempre da área, auditado), na MESMA transação.
 * @param {{ requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {string} id @param {Record<string, any>} corpo
 */
export const concluir = async (contexto, id, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const dataInformada = diaDoCorpo(corpo.data_conclusao, 'data_conclusao') ?? null;
  const trocarCapim = corpo.trocar_capim === true;
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      const anterior = await travarParaMudar(tx, cli, empresaId, id, corpo.versao, 'concluir_planejamento');
      const dia = dataInformada ?? tempo.hoje;
      exigirDiaNaoFuturo(tempo, dia, 'data_conclusao');
      const inicio = diaDe(anterior.data_inicio);
      if (inicio && dia < inicio) throw atividadeDataInvalida('data_conclusao', 'antes_do_inicio', { data: dia, data_inicio: inicio });
      /** @type {string[]} */
      const capimTrocado = [];
      if (trocarCapim) {
        if (!anterior.cultura_alvo_id) throw atividadeReferenciaInvalida('trocar_capim', 'sem_capim');
        for (const a of anterior.areas) {
          if ((a.area?.cultura_id ?? null) === anterior.cultura_alvo_id) continue;
          await atualizarAreaNaTransacao(contexto, tx, a.area_id, { cultura_id: anterior.cultura_alvo_id });
          capimTrocado.push(a.area_id);
        }
      }
      const r = await tx.planejamento.updateMany({
        where: { cliente_id: cli, empresa_id: empresaId, id, status: STATUS_PLANEJAMENTO.ABERTO, versao: anterior.versao },
        data: { status: STATUS_PLANEJAMENTO.CONCLUIDO, data_conclusao: comoData(dia), versao: { increment: 1 } },
      });
      if (r.count !== 1) throw atividadeVersaoConflito(anterior.versao, corpo.versao, { entidade: 'planejamento' });
      const registro = await lerPlanejamento(tx, cli, empresaId, id);
      await registrarEvento(
        contexto,
        {
          acao: 'planejamento.concluir', entidade: ENTIDADE_PLANEJAMENTO, entidadeId: id,
          dadosAnteriores: paraAuditoria(anterior),
          dadosNovos: { ...paraAuditoria(registro), trocar_capim: trocarCapim, capim_trocado_nas_areas: capimTrocado },
        },
        tx
      );
      return { ...(await detalheDe(tx, cli, empresaId, registro)), capim_trocado_nas_areas: capimTrocado };
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * CANCELAR a reforma (`POST /planejamentos/:id/cancelar`): só a aberta; nada é apagado (as realizações continuam ligadas
 * a ela, com os seus custos; ela só deixa de receber realização nova).
 * @param {{ requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {string} id @param {Record<string, any>} corpo
 */
export const cancelar = async (contexto, id, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      await tempoDaFazenda(tx, cli, empresaId);
      const anterior = await travarParaMudar(tx, cli, empresaId, id, corpo.versao, 'cancelar_planejamento');
      const r = await tx.planejamento.updateMany({
        where: { cliente_id: cli, empresa_id: empresaId, id, status: STATUS_PLANEJAMENTO.ABERTO, versao: anterior.versao },
        data: { status: STATUS_PLANEJAMENTO.CANCELADO, versao: { increment: 1 } },
      });
      if (r.count !== 1) throw atividadeVersaoConflito(anterior.versao, corpo.versao, { entidade: 'planejamento' });
      const registro = await lerPlanejamento(tx, cli, empresaId, id);
      await registrarEvento(
        contexto,
        { acao: 'planejamento.cancelar', entidade: ENTIDADE_PLANEJAMENTO, entidadeId: id, dadosAnteriores: paraAuditoria(anterior), dadosNovos: paraAuditoria(registro) },
        tx
      );
      return detalheDe(tx, cli, empresaId, registro);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

// ─── o registro de campo ("Faz parte de") ───────────────────────────────────

/**
 * D-PROD-275 — a reforma do registro de campo (`planejamento_id` do `POST /atividades/registrar`), na transação dele e
 * ANTES das áreas: travada `FOR SHARE` (a conclusão, que a trava `FOR UPDATE`, espera o registro terminar), da MESMA
 * fazenda (outra fazenda ou outro tenant = `inexistente`), ABERTA (`fechado`) e com TODAS as áreas do registro
 * (`area_fora`, com `details.area_id`). Tudo 422 `ATIVIDADE_REFERENCIA_INVALIDA` (`field` `planejamento_id`).
 * @param {any} tx @param {{ clienteId: string, empresaId: string, planejamentoId: string, areaIds: string[] }} p
 */
export const exigirPlanejamentoDoRegistro = async (tx, { clienteId, empresaId, planejamentoId, areaIds }) => {
  const linhas = /** @type {Array<{ empresa_id: string, status: string }>} */ (
    await tx.$queryRaw`SELECT empresa_id, status FROM "Planejamento" WHERE cliente_id = ${clienteId} AND id = ${planejamentoId} FOR SHARE`
  );
  const p = linhas[0];
  if (!p || p.empresa_id !== empresaId) throw atividadeReferenciaInvalida('planejamento_id', 'inexistente');
  if (p.status !== STATUS_PLANEJAMENTO.ABERTO) throw atividadeReferenciaInvalida('planejamento_id', 'fechado', { details: { status: p.status } });
  const daReforma = new Set(
    (await tx.planejamentoArea.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, planejamento_id: planejamentoId }, select: { area_id: true } })).map(
      (/** @type {{ area_id: string }} */ a) => a.area_id
    )
  );
  const fora = areaIds.find((id) => !daReforma.has(id));
  if (fora) throw atividadeReferenciaInvalida('planejamento_id', 'area_fora', { details: { area_id: fora } });
};

/**
 * D-PROD-275 — as reformas ABERTAS que contêm a área (o "Faz parte de" e o "Em reforma desde"), para o resumo da área:
 * as mais antigas primeiro (a reforma em curso), com todas as áreas de cada uma (o registro de várias áreas só oferece a
 * reforma que tem todas).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} areaId
 */
export const planejamentosAbertosDaArea = async (tx, clienteId, empresaId, areaId) => {
  const linhas = /** @type {any[]} */ (
    await tx.planejamento.findMany({
      where: { cliente_id: clienteId, empresa_id: empresaId, status: STATUS_PLANEJAMENTO.ABERTO, areas: { some: { area_id: areaId } } },
      orderBy: [{ data_inicio: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 20,
      select: {
        id: true, numero: true, nome: true, tipo: true, data_inicio: true, cultura_alvo_id: true,
        culturaAlvo: { select: { id: true, nome: true } },
        areas: { select: { area_id: true, hectares: true } },
      },
    })
  );
  return linhas.map((p) => ({
    id: p.id,
    numero: p.numero,
    nome: p.nome,
    tipo: p.tipo,
    data_inicio: diaDe(p.data_inicio),
    cultura_alvo_id: p.cultura_alvo_id ?? null,
    cultura_alvo: p.culturaAlvo ? { id: p.culturaAlvo.id, nome: p.culturaAlvo.nome } : null,
    area_ids: p.areas.map((/** @type {any} */ a) => a.area_id),
    hectares_na_area: t4(p.areas.find((/** @type {any} */ a) => a.area_id === areaId)?.hectares ?? null),
  }));
};
