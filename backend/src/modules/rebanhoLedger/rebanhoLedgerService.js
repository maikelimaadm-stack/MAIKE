/**
 * Ledger do rebanho por posição — R2E-P1 (D-PROD-107).
 *
 * Numa empresa ATIVADA (`RebanhoLedgerAtivacao`), a fonte de verdade do saldo
 * operacional é o ledger: `EventoRebanho` (fato com dia operacional) +
 * `PartidaRebanho` (delta por posição). `PosicaoRebanho.quantidade_cabecas` é
 * a projeção (soma das partidas ativas), recalculada a cada escrita. `Lote`
 * vira só o cadastro de ENTRADA: nenhuma movimentação cria ou altera Lote.
 *
 * Retroatividade (regra de disponibilidade por DIA):
 *  - `data_operacional` é o dia do fato; `registrado_em` é quando foi digitado;
 *  - o saldo de cada posição no FIM de cada dia precisa ser >= 0, em TODA a
 *    linha do tempo (não só hoje). Eventos do mesmo dia valem juntos: não há
 *    "meia-noite × meio-dia" nem ordem de digitação;
 *  - lançar um fato no passado é aceito se nenhum fim de dia, do fato em
 *    diante, ficar negativo; senão 409 com data, área, disponível e pedido —
 *    e nada é gravado (a transação inteira volta);
 *  - consulta por janela no banco, sem teto de registros.
 *
 * Travas: áreas envolvidas (ordem de id) → posições (ordem de id). Posição
 * nova só nasce com a área de destino travada, então não há corrida na
 * identidade.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirAdminTenant } from '../../shared/auth/exigirAdminTenant.js';
import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';

export const COMANDO_LEDGER = 'rebanho_ledger';
export const TIPO_OPERACAO_TRANSFERENCIA = 'rebanho_ledger_transferencia';
export const TIPO_OPERACAO_ATIVACAO = 'rebanho_ledger_ativacao';
export const TIPO_OPERACAO_CANCELAMENTO_LEDGER = 'cancelamento_movimentacao_mapa';
export const TIPOS_EVENTO = Object.freeze({ ABERTURA: 'SALDO_ABERTURA', ENTRADA: 'ENTRADA', TRANSFERENCIA: 'TRANSFERENCIA' });
export const MAX_ITENS_TRANSFERENCIA = 50;

/**
 * Mesma regra de `dataOperacionalValida` dos comandos do mapa (cópia local
 * para não criar ciclo de import com eles, que importam este módulo).
 */
export const dataOperacionalValida = (valor) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(valor || '');
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia && !Number.isNaN(new Date(valor).getTime());
};

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const normal = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const invalido = (mensagem, details = {}) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details });
const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });
export const diaDe = (valor) => String(valor).slice(0, 10);
const comoData = (dia) => new Date(`${dia}T00:00:00.000Z`);
const diaDoBanco = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const pesoNum = (v) => (v === null || v === undefined ? null : Number(v));

// ─── Ganchos de teste (só NODE_ENV=test): prova de rollback por passo ─────
const ganchos = { falharEm: null };
export const definirFalhaInjetadaLedger = (passo) => {
  if (process.env.NODE_ENV !== 'test') throw new Error('gancho de teste fora de NODE_ENV=test');
  ganchos.falharEm = passo;
};
const ponto = (passo) => {
  if (ganchos.falharEm === passo) throw new Error(`falha injetada: ${passo}`);
};

// ─── Ativação ──────────────────────────────────────────────────────────────

/** Ativação da empresa (ou null = modelo legado). */
export const ativacaoDaEmpresa = (tx, clienteId, empresaId) =>
  tx.rebanhoLedgerAtivacao.findUnique({ where: { cliente_id_empresa_id: { cliente_id: clienteId, empresa_id: empresaId } } });

/**
 * Comandos que ainda escrevem saldo em `Lote` recusam empresa ativada (fail
 * closed): duas fontes de verdade nunca. Chamado dentro da transação deles.
 */
export const exigirModoLegado = async (tx, clienteId, empresaId, operacao) => {
  if (!empresaId) return;
  if (await ativacaoDaEmpresa(tx, clienteId, empresaId)) {
    throw recusa(
      'REBANHO_LEDGER_OPERACAO_NAO_MIGRADA',
      'esta empresa usa o ledger de posições; esta operação ainda não foi migrada para ele e foi recusada sem gravar nada',
      { operacao }
    );
  }
};

// ─── Identidade e posição ──────────────────────────────────────────────────

/** Identidade da posição: linhagem de entrada + classificação. Nunca o nome. */
export const chaveIdentidade = ({ lote_entrada_id, categoria, sexo, categoria_manejo_id }) =>
  JSON.stringify([lote_entrada_id ?? null, normal(categoria) || null, normal(sexo) || null, categoria_manejo_id ?? null]);

/** Forma pública com os nomes de campo do Lote (o mapa e os formulários a leem sem adaptação). */
export const comoPosicaoPublica = (p, areaNome = null) => ({
  id: p.id,
  posicao_id: p.id,
  __posicao: true,
  empresa_id: p.empresa_id,
  lote_entrada_id: p.lote_entrada_id ?? null,
  linhagem: p.linhagem ?? [],
  nome: p.nome,
  numero_lote: p.numero_lote ?? null,
  quantidade_cabecas: p.quantidade_cabecas,
  area_atual_id: p.area_id,
  area_atual_nome: areaNome ?? p.area?.nome ?? null,
  categoria: p.categoria ?? null,
  categoria_manejo_id: p.categoria_manejo_id ?? null,
  categoria_manejo_nome: p.categoria_manejo_nome ?? null,
  sexo: p.sexo ?? null,
  peso_medio_kg: pesoNum(p.peso_medio_kg),
  status: p.quantidade_cabecas > 0 ? 'Ativo' : 'Inativo',
  identificador_nome: p.identificador_nome ?? null,
  identificador_sigla: p.identificador_sigla ?? null,
  identificador_cor: p.identificador_cor ?? null,
  updated_date: p.updatedAt,
  created_date: p.createdAt,
});

const travarAreas = async (tx, clienteId, empresaId, areaIds) => {
  const ids = [...new Set(areaIds.filter(Boolean))].sort();
  if (!ids.length) return new Map();
  await tx.$queryRaw`SELECT id FROM "AreaPastagem" WHERE cliente_id = ${clienteId} AND id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  const areas = await tx.areaPastagem.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, id: { in: ids } }, select: { id: true, nome: true, ativo: true } });
  return new Map(areas.map((a) => [a.id, a]));
};

const travarPosicoes = async (tx, clienteId, ids) => {
  const ordenados = [...new Set(ids.filter(Boolean))].sort();
  if (!ordenados.length) return new Map();
  await tx.$queryRaw`SELECT id FROM "PosicaoRebanho" WHERE cliente_id = ${clienteId} AND id = ANY(${ordenados}::text[]) ORDER BY id FOR UPDATE`;
  const ps = await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, id: { in: ordenados } } });
  return new Map(ps.map((p) => [p.id, p]));
};

/** Posição da identidade na área (cria vazia se não existir). Exige a área travada pelo chamador. */
const posicaoDaIdentidade = async (tx, clienteId, empresaId, areaId, molde) => {
  const chave = chaveIdentidade(molde);
  const existente = await tx.posicaoRebanho.findUnique({
    where: { cliente_id_empresa_id_area_id_chave_identidade: { cliente_id: clienteId, empresa_id: empresaId, area_id: areaId, chave_identidade: chave } },
  });
  if (existente) return { posicao: existente, criada: false };
  const criada = await tx.posicaoRebanho.create({
    data: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      area_id: areaId,
      chave_identidade: chave,
      lote_entrada_id: molde.lote_entrada_id ?? null,
      linhagem: molde.linhagem ?? [],
      nome: molde.nome,
      numero_lote: molde.numero_lote ?? null,
      categoria: molde.categoria ?? null,
      categoria_manejo_id: molde.categoria_manejo_id ?? null,
      categoria_manejo_nome: molde.categoria_manejo_nome ?? null,
      sexo: molde.sexo ?? null,
      peso_medio_kg: molde.peso_medio_kg ?? null,
      quantidade_cabecas: 0,
      identificador_nome: molde.identificador_nome ?? null,
      identificador_sigla: molde.identificador_sigla ?? null,
      identificador_cor: molde.identificador_cor ?? null,
    },
  });
  return { posicao: criada, criada: true };
};

// ─── Motor temporal ────────────────────────────────────────────────────────

/** Primeiro fim de dia negativo de cada posição (só partidas ativas; sem teto). */
export const primeirosSaldosNegativos = async (tx, clienteId, posicaoIds) => {
  const ids = [...new Set(posicaoIds)];
  if (!ids.length) return [];
  return /** @type {Array<{posicao_id: string, dia: Date, saldo: number}>} */ (
    await tx.$queryRaw`
      WITH por_dia AS (
        SELECT posicao_id, data_operacional AS dia, SUM(delta)::int AS s
          FROM "PartidaRebanho"
         WHERE cliente_id = ${clienteId} AND posicao_id = ANY(${ids}::text[]) AND ativa
         GROUP BY posicao_id, data_operacional
      ), acumulado AS (
        SELECT posicao_id, dia, (SUM(s) OVER (PARTITION BY posicao_id ORDER BY dia))::int AS saldo FROM por_dia
      )
      SELECT DISTINCT ON (posicao_id) posicao_id, dia, saldo FROM acumulado WHERE saldo < 0 ORDER BY posicao_id, dia`
  );
};

/** Projeção = soma das partidas ativas (idempotente; corrige qualquer desvio). */
const reprojetar = async (tx, clienteId, posicaoIds) => {
  const ids = [...new Set(posicaoIds)].sort();
  if (!ids.length) return;
  await tx.$executeRaw`
    UPDATE "PosicaoRebanho" p
       SET quantidade_cabecas = COALESCE((SELECT SUM(x.delta) FROM "PartidaRebanho" x WHERE x.cliente_id = p.cliente_id AND x.posicao_id = p.id AND x.ativa), 0),
           "updatedAt" = now()
     WHERE p.cliente_id = ${clienteId} AND p.id = ANY(${ids}::text[])`;
};

/**
 * Valida a linha do tempo das posições e reprojeta. Primeiro fim de dia
 * negativo → 409 estável (a transação do chamador desfaz tudo).
 * @param {(neg: {posicao_id: string, dia: string, saldo: number}) => Record<string, unknown>} detalhar
 */
const validarEReprojetar = async (tx, clienteId, posicaoIds, codigo, mensagem, detalhar) => {
  const negativos = await primeirosSaldosNegativos(tx, clienteId, posicaoIds);
  if (negativos.length) {
    const primeiro = [...negativos].sort((a, b) => diaDoBanco(a.dia).localeCompare(diaDoBanco(b.dia)))[0];
    throw recusa(codigo, mensagem, detalhar({ posicao_id: primeiro.posicao_id, dia: diaDoBanco(primeiro.dia), saldo: primeiro.saldo }));
  }
  await reprojetar(tx, clienteId, posicaoIds);
};

const criarEvento = (tx, { clienteId, empresaId, tipo, dia, usuarioId, operationKey, dados }) =>
  tx.eventoRebanho.create({
    data: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      tipo,
      data_operacional: comoData(dia),
      registrado_por_usuario_id: usuarioId ?? null,
      operation_id: operationKey,
      dados,
    },
  });

const inserirPartidas = (tx, { clienteId, empresaId, eventoId, dia, partidas }) =>
  tx.partidaRebanho.createMany({
    data: partidas.map((p) => ({ cliente_id: clienteId, empresa_id: empresaId, evento_id: eventoId, posicao_id: p.posicao_id, data_operacional: comoData(dia), delta: p.delta })),
  });

const auditarPosicoes = async (contexto, tx, clienteId, ids, antes) => {
  const depois = await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, id: { in: [...new Set(ids)] } } });
  for (const p of depois) {
    const a = antes.get(p.id);
    await registrarEvento(contexto, { acao: a ? 'update' : 'create', entidade: 'PosicaoRebanho', entidadeId: p.id, dadosAnteriores: a ? comoPosicaoPublica(a) : undefined, dadosNovos: comoPosicaoPublica(p) }, tx);
  }
  return new Map(depois.map((p) => [p.id, p]));
};

// ─── Ativação da empresa (saldo de abertura, sem destruir nada) ─────────────

/**
 * Ativa o ledger numa empresa. Cada lote ATIVO com saldo e área vira uma
 * posição com partida de SALDO_ABERTURA no dia do corte. Nada é apagado nem
 * alterado em `Lote`; o histórico legado continua consultável. Fatos com data
 * anterior ao corte são recusados depois (o ledger não conhece o passado).
 */
export const ativarLedger = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const operationKey = texto(entrada?.operation_id);
  const empresaId = texto(entrada?.empresa_id);
  const dataCorte = texto(entrada?.data_corte);
  if (!operationKey || !empresaId || !dataCorte) throw invalido('operation_id, empresa_id e data_corte são obrigatórios');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataCorte) || !dataOperacionalValida(dataCorte)) throw invalido('data_corte deve ser AAAA-MM-DD de calendário real', { field: 'data_corte' });
  const fingerprint = fingerprintDePayload({ empresaId, dataCorte });
  const prisma = getPrismaClient();
  const r = await prisma.$transaction(async (tx) => {
    await exigirAdminTenant(contexto, tx);
    return executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO_OPERACAO_ATIVACAO,
      fingerprint,
      executar: async () => {
        const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: empresaId } }, select: { id: true } });
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');
        if (await ativacaoDaEmpresa(tx, auth.clienteId, empresaId)) throw recusa('REBANHO_LEDGER_JA_ATIVO', 'o ledger já está ativo nesta empresa');
        // Trava todas as áreas e lotes da empresa: nenhum manejo legado corre durante a abertura.
        const areas = await tx.areaPastagem.findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresaId }, select: { id: true } });
        const mapaAreas = await travarAreas(tx, auth.clienteId, empresaId, areas.map((a) => a.id));
        await tx.$queryRaw`SELECT id FROM "Lote" WHERE cliente_id = ${auth.clienteId} AND empresa_id = ${empresaId} ORDER BY id FOR UPDATE`;
        const posteriores = /** @type {Array<{n: number}>} */ (
          await tx.$queryRaw`
            SELECT COUNT(*)::int AS n FROM "MovimentacaoMapa" m
             WHERE m.cliente_id = ${auth.clienteId} AND m.empresa_id = ${empresaId}
               AND COALESCE(m.dados->>'situacao', '') <> 'cancelado'
               AND COALESCE(NULLIF(left(m.dados->>'data_movimentacao', 10), ''), to_char(m."createdAt", 'YYYY-MM-DD')) > ${dataCorte}`
        );
        if (posteriores[0]?.n) {
          throw recusa('REBANHO_ATIVACAO_CORTE_ANTERIOR_AO_HISTORICO', 'há movimentação legada ativa depois da data de corte; escolha um corte igual ou posterior', { quantidade: posteriores[0].n });
        }
        const lotes = await tx.lote.findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresaId, excluido_em: null, status: 'Ativo', quantidade_cabecas: { gt: 0 } }, orderBy: { id: 'asc' } });
        const semArea = lotes.filter((l) => !l.area_atual_id || !mapaAreas.has(l.area_atual_id));
        if (semArea.length) throw recusa('REBANHO_ATIVACAO_LOTE_SEM_AREA', 'há lote ativo com cabeças e sem área válida nesta empresa; corrija antes de ativar', { lote_ids: semArea.map((l) => l.id) });

        await tx.rebanhoLedgerAtivacao.create({ data: { cliente_id: auth.clienteId, empresa_id: empresaId, data_corte: comoData(dataCorte), ativado_por_usuario_id: auth.usuarioId } });
        const evento = await criarEvento(tx, {
          clienteId: auth.clienteId, empresaId, tipo: TIPOS_EVENTO.ABERTURA, dia: dataCorte, usuarioId: auth.usuarioId, operationKey,
          dados: { origem: 'saldo_atual_do_modelo_legado', lotes: lotes.length },
        });
        const partidas = [];
        for (const l of lotes) {
          const derivado = normal(l.origem) === 'MOVIMENTACAO';
          const { posicao } = await posicaoDaIdentidade(tx, auth.clienteId, empresaId, l.area_atual_id, {
            ...l, lote_entrada_id: l.id, linhagem: [{ lote_id: l.id, nome: l.nome, numero_lote: l.numero_lote ?? null, classe: derivado ? 'derivado_legado' : 'entrada' }],
          });
          partidas.push({ posicao_id: posicao.id, delta: l.quantidade_cabecas });
        }
        if (partidas.length) await inserirPartidas(tx, { clienteId: auth.clienteId, empresaId, eventoId: evento.id, dia: dataCorte, partidas });
        await reprojetar(tx, auth.clienteId, partidas.map((p) => p.posicao_id));
        const total = partidas.reduce((t, p) => t + p.delta, 0);
        await registrarEvento(contexto, { acao: 'create', entidade: 'EventoRebanho', entidadeId: evento.id, dadosNovos: { tipo: evento.tipo, empresa_id: empresaId, data_corte: dataCorte, posicoes: partidas.length, total } }, tx);
        return { httpStatus: 201, body: { empresa_id: empresaId, data_corte: dataCorte, posicoes: partidas.length, total_cabecas: total, evento_id: evento.id } };
      },
    });
  });
  return { status: r.httpStatus, body: { ...r.body, replay: r.replay } };
};

/**
 * Ordem de travas do ledger é ÁREA → LOTE/POSIÇÃO. A exclusão do cadastro trava
 * o Lote (FOR UPDATE); numa empresa ativada ela chama isto ANTES, para não
 * cruzar com uma transferência que segura a área e pede KEY SHARE no Lote ao
 * criar a posição de destino (deadlock 40P01 visto em teste).
 */
export const travarAreasDoLoteNoLedger = async (tx, clienteId, loteId) => {
  const lote = await tx.lote.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: loteId } }, select: { empresa_id: true } });
  if (!lote || !(await ativacaoDaEmpresa(tx, clienteId, lote.empresa_id))) return;
  const ps = await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, lote_entrada_id: loteId }, select: { area_id: true } });
  await travarAreas(tx, clienteId, lote.empresa_id, ps.map((p) => p.area_id));
};

// ─── Entrada (cadastro de lote numa empresa ativada) ───────────────────────

/**
 * Cadastro de lote = ENTRADA no ledger, na mesma transação do INSERT do Lote.
 * O Lote guarda só o fato da entrada; o saldo nasce numa posição.
 */
export const registrarEntradaSeAtivo = async (tx, contexto, lote) => {
  const auth = exigirAuthContext(contexto?.auth);
  const ativacao = await ativacaoDaEmpresa(tx, auth.clienteId, lote.empresa_id);
  if (!ativacao) return null;
  const quantidade = lote.quantidade_entrada ?? lote.quantidade_cabecas;
  const areaId = lote.area_entrada_id ?? lote.area_atual_id;
  if (!areaId) throw invalido('lote precisa de área de entrada no ledger', { field: 'area_entrada_id' });
  if (!lote.data_entrada) throw invalido('lote precisa de data de entrada no ledger', { field: 'data_entrada' });
  const dia = diaDoBanco(lote.data_entrada);
  if (dia < diaDoBanco(ativacao.data_corte)) {
    throw recusa('REBANHO_ANTES_DO_CORTE', 'a data é anterior ao início do ledger nesta empresa', { data: dia, data_corte: diaDoBanco(ativacao.data_corte) });
  }
  if (!(quantidade > 0)) return null;
  await travarAreas(tx, auth.clienteId, lote.empresa_id, [areaId]);
  const evento = await criarEvento(tx, {
    clienteId: auth.clienteId, empresaId: lote.empresa_id, tipo: TIPOS_EVENTO.ENTRADA, dia, usuarioId: auth.usuarioId, operationKey: `entrada-${lote.id}`,
    dados: { lote_id: lote.id, quantidade, area_id: areaId },
  });
  const { posicao } = await posicaoDaIdentidade(tx, auth.clienteId, lote.empresa_id, areaId, {
    ...lote, lote_entrada_id: lote.id, linhagem: [{ lote_id: lote.id, nome: lote.nome, numero_lote: lote.numero_lote ?? null, classe: 'entrada' }],
  });
  await inserirPartidas(tx, { clienteId: auth.clienteId, empresaId: lote.empresa_id, eventoId: evento.id, dia, partidas: [{ posicao_id: posicao.id, delta: quantidade }] });
  await reprojetar(tx, auth.clienteId, [posicao.id]);
  await registrarEvento(contexto, { acao: 'create', entidade: 'EventoRebanho', entidadeId: evento.id, dadosNovos: { tipo: evento.tipo, lote_id: lote.id, posicao_id: posicao.id, quantidade, data_operacional: dia } }, tx);
  return { evento_id: evento.id, posicao_id: posicao.id };
};

/**
 * Exclusão do cadastro numa empresa ativada: só se as posições do lote não
 * têm NENHUM fato ativo além da própria entrada/abertura. Então a entrada é
 * cancelada (partidas inativas, posições zeradas) e o chamador marca o
 * tombstone. Histórico nunca é apagado.
 */
export const cancelarEntradaParaExclusao = async (tx, contexto, lote) => {
  const auth = exigirAuthContext(contexto?.auth);
  if (!(await ativacaoDaEmpresa(tx, auth.clienteId, lote.empresa_id))) return { ativo: false };
  const posicoes = await tx.posicaoRebanho.findMany({ where: { cliente_id: auth.clienteId, lote_entrada_id: lote.id }, select: { id: true, area_id: true } });
  await travarAreas(tx, auth.clienteId, lote.empresa_id, posicoes.map((p) => p.area_id));
  await travarPosicoes(tx, auth.clienteId, posicoes.map((p) => p.id));
  const partidas = await tx.partidaRebanho.findMany({ where: { cliente_id: auth.clienteId, posicao_id: { in: posicoes.map((p) => p.id) }, ativa: true }, include: { evento: true } });
  const alheias = partidas.filter((p) => ![TIPOS_EVENTO.ENTRADA, TIPOS_EVENTO.ABERTURA].includes(p.evento.tipo) || (p.evento.tipo === TIPOS_EVENTO.ENTRADA && p.evento.dados?.lote_id !== lote.id));
  if (alheias.length) {
    throw new AppError('LOTE_DELETE_BLOCKED', 'o lote tem movimentação ativa no ledger; cancele-a antes', { details: { id: lote.id, motivo: 'movimentacao_ativa', vinculo: 'movimentacoes_mapa' } });
  }
  const eventoIds = [...new Set(partidas.map((p) => p.evento_id))];
  await tx.partidaRebanho.updateMany({ where: { cliente_id: auth.clienteId, id: { in: partidas.map((p) => p.id) } }, data: { ativa: false } });
  await reprojetar(tx, auth.clienteId, posicoes.map((p) => p.id));
  for (const id of eventoIds) {
    const ev = partidas.find((p) => p.evento_id === id).evento;
    if (ev.tipo === TIPOS_EVENTO.ENTRADA) {
      await tx.eventoRebanho.update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id } }, data: { situacao: 'cancelado', cancelado_em: new Date(), cancelado_por_usuario_id: auth.usuarioId, motivo_cancelamento: 'exclusão do lote no cadastro' } });
    }
  }
  return { ativo: true, posicoes: posicoes.length };
};

// ─── Transferência (multi-posição, retroativa) ─────────────────────────────

export const lerEntradaTransferencia = (entrada) => {
  const operationKey = texto(entrada?.operation_id);
  const empresaId = texto(entrada?.empresa_id);
  const areaDestinoId = texto(entrada?.area_destino_id);
  const data = texto(entrada?.data_movimentacao);
  if (!operationKey || !empresaId || !areaDestinoId || !data) throw invalido('operation_id, empresa_id, area_destino_id, data_movimentacao e itens são obrigatórios');
  if (!dataOperacionalValida(data)) throw invalido('data_movimentacao inválida', { field: 'data_movimentacao' });
  const brutos = entrada?.itens;
  if (!Array.isArray(brutos) || brutos.length < 1 || brutos.length > MAX_ITENS_TRANSFERENCIA) throw invalido(`itens deve ter de 1 a ${MAX_ITENS_TRANSFERENCIA} posições`, { field: 'itens' });
  const itens = brutos.map((it, i) => {
    const posicaoId = texto(it?.posicao_id);
    if (!posicaoId) throw invalido('posicao_id obrigatório', { field: `itens[${i}].posicao_id` });
    if (!Number.isInteger(it?.quantidade) || it.quantidade <= 0) throw invalido('quantidade deve ser inteiro positivo', { field: `itens[${i}].quantidade` });
    return { posicao_id: posicaoId, quantidade: it.quantidade };
  });
  if (new Set(itens.map((i) => i.posicao_id)).size !== itens.length) throw invalido('posição repetida em itens', { field: 'itens' });
  const observacoes = typeof entrada?.observacoes === 'string' ? entrada.observacoes.trim() || null : null;
  return { operationKey, empresaId, areaDestinoId, data, dia: diaDe(data), itens, observacoes };
};

export const transferir = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const e = lerEntradaTransferencia(entrada);
  const fingerprint = fingerprintDePayload({ comando: COMANDO_LEDGER, ...e, operationKey: undefined });
  const prisma = getPrismaClient();
  const r = await prisma.$transaction(async (tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey: e.operationKey,
      tipoOperacao: TIPO_OPERACAO_TRANSFERENCIA,
      fingerprint,
      executar: async () => {
        const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: e.empresaId } }, select: { id: true } });
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');
        const ativacao = await ativacaoDaEmpresa(tx, auth.clienteId, e.empresaId);
        if (!ativacao) throw recusa('REBANHO_LEDGER_INATIVO', 'o ledger de posições não está ativo nesta empresa');
        if (e.dia < diaDoBanco(ativacao.data_corte)) {
          throw recusa('REBANHO_ANTES_DO_CORTE', 'a data é anterior ao início do ledger nesta empresa', { data: e.dia, data_corte: diaDoBanco(ativacao.data_corte) });
        }
        // Leitura sem trava só para saber as áreas; a trava vem em seguida, na ordem área → posição.
        const previas = await tx.posicaoRebanho.findMany({ where: { cliente_id: auth.clienteId, id: { in: e.itens.map((i) => i.posicao_id) } }, select: { id: true, area_id: true, empresa_id: true } });
        const porIdPrevia = new Map(previas.map((p) => [p.id, p]));
        for (const it of e.itens) {
          const p = porIdPrevia.get(it.posicao_id);
          if (!p || p.empresa_id !== e.empresaId) throw new AppError('POSICAO_REBANHO_NOT_FOUND', 'posição não encontrada nesta empresa', { details: { posicao_id: it.posicao_id } });
        }
        const areas = await travarAreas(tx, auth.clienteId, e.empresaId, [e.areaDestinoId, ...previas.map((p) => p.area_id)]);
        const destino = areas.get(e.areaDestinoId);
        if (!destino) throw new AppError('AREA_NOT_FOUND', 'área de destino não encontrada nesta empresa');
        if (destino.ativo === false) throw recusa('REBANHO_AREA_INATIVA', 'área de destino inativa');
        let origens = await travarPosicoes(tx, auth.clienteId, e.itens.map((i) => i.posicao_id));
        for (const it of e.itens) {
          const o = origens.get(it.posicao_id);
          if (!o || o.empresa_id !== e.empresaId) throw new AppError('POSICAO_REBANHO_NOT_FOUND', 'posição não encontrada nesta empresa', { details: { posicao_id: it.posicao_id } });
          if (o.area_id === e.areaDestinoId) throw recusa('REBANHO_DESTINO_IGUAL_ORIGEM', 'a área de destino é a mesma da origem', { posicao_id: o.id });
        }
        ponto('apos_validar');

        // Destino de cada item: mesma identidade (linhagem + classificação) na área de destino.
        const destinos = new Map();
        for (const it of e.itens) {
          const o = origens.get(it.posicao_id);
          const { posicao } = await posicaoDaIdentidade(tx, auth.clienteId, e.empresaId, e.areaDestinoId, o);
          destinos.set(it.posicao_id, posicao.id);
        }
        const todas = await travarPosicoes(tx, auth.clienteId, [...e.itens.map((i) => i.posicao_id), ...destinos.values()]);
        const antes = new Map(todas);
        origens = todas;

        const evento = await criarEvento(tx, {
          clienteId: auth.clienteId, empresaId: e.empresaId, tipo: TIPOS_EVENTO.TRANSFERENCIA, dia: e.dia, usuarioId: auth.usuarioId, operationKey: e.operationKey,
          dados: {
            area_destino_id: destino.id,
            area_destino_nome: destino.nome,
            ...(e.observacoes ? { observacoes: e.observacoes } : {}),
            itens: e.itens.map((it) => {
              const o = origens.get(it.posicao_id);
              return {
                origem_posicao_id: o.id, destino_posicao_id: destinos.get(it.posicao_id), quantidade: it.quantidade,
                area_origem_id: o.area_id, area_origem_nome: areas.get(o.area_id)?.nome ?? null,
                lote_entrada_id: o.lote_entrada_id, nome: o.nome, categoria: o.categoria, sexo: o.sexo,
              };
            }),
          },
        });
        ponto('apos_evento');
        let n = 0;
        for (const it of e.itens) {
          await inserirPartidas(tx, {
            clienteId: auth.clienteId, empresaId: e.empresaId, eventoId: evento.id, dia: e.dia,
            partidas: [{ posicao_id: it.posicao_id, delta: -it.quantidade }, { posicao_id: destinos.get(it.posicao_id), delta: it.quantidade }],
          });
          n += 1;
          if (n === 1) ponto('apos_primeira_partida');
        }
        // Peso: atributo atual da posição (não historiado). Destino novo herda o
        // da origem; destino com cabeças só recebe média ponderada se os dois
        // pesos forem conhecidos — senão fica sem peso (desconhecido não é zero).
        for (const it of e.itens) {
          const o = origens.get(it.posicao_id);
          const d = origens.get(destinos.get(it.posicao_id));
          const pd = pesoNum(d.peso_medio_kg);
          const po = pesoNum(o.peso_medio_kg);
          let peso = null;
          if (d.quantidade_cabecas === 0) peso = po;
          else if (pd !== null && po !== null) peso = Number(((pd * d.quantidade_cabecas + po * it.quantidade) / (d.quantidade_cabecas + it.quantidade)).toFixed(4));
          if ((peso ?? null) !== (pd ?? null)) await tx.posicaoRebanho.update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: d.id } }, data: { peso_medio_kg: peso } });
        }
        const envolvidas = [...todas.keys()];
        await validarEReprojetar(tx, auth.clienteId, envolvidas, 'REBANHO_SALDO_HISTORICO_NEGATIVO',
          'a transferência deixaria saldo negativo numa data; nada foi gravado', (neg) => {
            const p = todas.get(neg.posicao_id);
            const it = e.itens.find((i) => i.posicao_id === neg.posicao_id);
            return {
              data: neg.dia, area_id: p?.area_id ?? null, area_nome: areas.get(p?.area_id)?.nome ?? null, posicao_id: neg.posicao_id,
              lote_entrada_id: p?.lote_entrada_id ?? null, nome: p?.nome ?? null,
              disponivel: it && neg.dia >= e.dia ? neg.saldo + it.quantidade : null, pedido: it?.quantidade ?? null, saldo_resultante: neg.saldo,
            };
          });
        ponto('apos_segunda_posicao');

        // Ponte com o histórico existente (MovimentacaoMapa): o fato continua
        // visível por cadastro de origem, por posição e por área.
        const loteIds = [...new Set(e.itens.flatMap((it) => {
          const o = origens.get(it.posicao_id);
          return [o.lote_entrada_id, o.id, destinos.get(it.posicao_id)].filter(Boolean);
        }))];
        const primeira = origens.get(e.itens[0].posicao_id);
        const total = e.itens.reduce((t, it) => t + it.quantidade, 0);
        const mov = await tx.movimentacaoMapa.create({
          data: {
            cliente_id: auth.clienteId,
            empresa_id: e.empresaId,
            dados: {
              tipo: 'Transferência de Área',
              lote: primeira.nome,
              lote_id: primeira.lote_entrada_id ?? primeira.id,
              lote_ids: loteIds,
              quantidade_animais: total,
              data_movimentacao: e.data,
              area_origem_id: primeira.area_id,
              area_origem_nome: areas.get(primeira.area_id)?.nome ?? null,
              area_destino_id: destino.id,
              area_destino_nome: destino.nome,
              categoria_animal: [...new Set(e.itens.map((it) => origens.get(it.posicao_id).categoria).filter(Boolean))].join(', ') || null,
              linhas: evento.dados.itens,
              ...(e.observacoes ? { observacoes: e.observacoes } : {}),
              efeito_servidor: {
                comando: COMANDO_LEDGER, evento_id: evento.id, operation_id: e.operationKey,
                registrado_em: evento.registrado_em.toISOString(), registrado_por_usuario_id: auth.usuarioId,
              },
            },
          },
        });
        await tx.eventoRebanho.update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: evento.id } }, data: { movimentacao_id: mov.id } });
        ponto('antes_auditoria');
        const depois = await auditarPosicoes(contexto, tx, auth.clienteId, envolvidas, antes);
        await registrarEvento(contexto, { acao: 'create', entidade: 'EventoRebanho', entidadeId: evento.id, dadosNovos: { tipo: evento.tipo, data_operacional: e.dia, movimentacao_id: mov.id, total } }, tx);
        await registrarEvento(contexto, { acao: 'create', entidade: 'MovimentacaoMapa', entidadeId: mov.id, dadosNovos: documentoComoPublico(mov) }, tx);
        return {
          httpStatus: 201,
          body: {
            evento: { id: evento.id, tipo: evento.tipo, data_operacional: e.dia, registrado_em: evento.registrado_em.toISOString() },
            movimentacao: documentoComoPublico(mov),
            posicoes: [...depois.values()].map((p) => comoPosicaoPublica(p, areas.get(p.area_id)?.nome ?? null)),
          },
        };
      },
    })
  );
  return { status: r.httpStatus, body: { ...r.body, replay: r.replay } };
};

// ─── Cancelamento (chamado pelo endpoint único de cancelamento) ─────────────

/** Movimento do mapa gravado pelo ledger? */
export const ehMovimentoDoLedger = (mov) => mov?.dados?.efeito_servidor?.comando === COMANDO_LEDGER;

/**
 * Cancela o EVENTO do ledger ligado ao movimento: desativa as partidas,
 * revalida a linha do tempo de todas as posições tocadas (um fato futuro que
 * dependia destas cabeças bloqueia: 409 com a data) e reprojeta. O original
 * fica, marcado `cancelado`, com quem/quando/motivo. Chamado dentro da
 * transação e da idempotência do cancelamento.
 */
export const cancelarMovimentoDoLedger = async (tx, contexto, mov, motivo, operationKey) => {
  const auth = exigirAuthContext(contexto?.auth);
  const eventoId = mov.dados.efeito_servidor.evento_id;
  const evento = await tx.eventoRebanho.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: String(eventoId) } } });
  if (!evento || evento.movimentacao_id !== mov.id || evento.empresa_id !== mov.empresa_id || evento.tipo !== TIPOS_EVENTO.TRANSFERENCIA) {
    throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'o evento do ledger não confere com este movimento');
  }
  if (evento.situacao === 'cancelado') throw recusa('CANCELAMENTO_JA_REALIZADO', 'a movimentação já está cancelada');
  const partidas = await tx.partidaRebanho.findMany({ where: { cliente_id: auth.clienteId, evento_id: evento.id } });
  const ids = [...new Set(partidas.map((p) => p.posicao_id))];
  const previas = await tx.posicaoRebanho.findMany({ where: { cliente_id: auth.clienteId, id: { in: ids } }, select: { area_id: true } });
  const areas = await travarAreas(tx, auth.clienteId, evento.empresa_id, previas.map((p) => p.area_id));
  const antes = await travarPosicoes(tx, auth.clienteId, ids);
  await tx.partidaRebanho.updateMany({ where: { cliente_id: auth.clienteId, evento_id: evento.id }, data: { ativa: false } });
  await validarEReprojetar(tx, auth.clienteId, ids, 'CANCELAMENTO_SALDO_HISTORICO_NEGATIVO',
    'cancelar esta movimentação deixaria saldo negativo numa data (um fato posterior usa estas cabeças); cancele o posterior antes', (neg) => {
      const p = antes.get(neg.posicao_id);
      return { data: neg.dia, area_id: p?.area_id ?? null, area_nome: areas.get(p?.area_id)?.nome ?? null, posicao_id: neg.posicao_id, nome: p?.nome ?? null, saldo_resultante: neg.saldo };
    });
  const agora = new Date();
  await tx.eventoRebanho.update({
    where: { cliente_id_id: { cliente_id: auth.clienteId, id: evento.id } },
    data: { situacao: 'cancelado', cancelado_em: agora, cancelado_por_usuario_id: auth.usuarioId, motivo_cancelamento: motivo },
  });
  const depois = await auditarPosicoes(contexto, tx, auth.clienteId, ids, antes);
  const efeitos = partidas.map((p) => ({ posicao_id: p.posicao_id, delta_desfeito: -p.delta, depois: depois.get(p.posicao_id)?.quantidade_cabecas ?? null }));
  return { efeitos, cancelamento: { em: agora.toISOString(), por_usuario_id: auth.usuarioId, motivo, operation_id: operationKey, modo: 'ledger', efeitos } };
};

// ─── Leituras ──────────────────────────────────────────────────────────────

/** Posições atuais da empresa (o mapa lê daqui quando o ledger está ativo). */
export const listarPosicoes = async (contexto, { empresa_id: empresaId, incluir_vazias: incluirVazias }) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const ativacao = await ativacaoDaEmpresa(prisma, auth.clienteId, empresaId);
  if (!ativacao) return { ativo: false, data_corte: null, itens: [] };
  const ps = await prisma.posicaoRebanho.findMany({
    where: { cliente_id: auth.clienteId, empresa_id: empresaId, ...(incluirVazias === 'true' ? {} : { quantidade_cabecas: { gt: 0 } }) },
    include: { area: { select: { nome: true } } },
    orderBy: [{ area_id: 'asc' }, { numero_lote: 'asc' }, { id: 'asc' }],
  });
  return { ativo: true, data_corte: diaDoBanco(ativacao.data_corte), itens: ps.map((p) => comoPosicaoPublica(p)) };
};

/** Saldo em uma data (fim do dia) por posição, a partir das partidas ativas. */
export const saldosNaData = async (contexto, { empresa_id: empresaId, data, area_id: areaId }) => {
  const auth = exigirAuthContext(contexto?.auth);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data ?? '')) || !dataOperacionalValida(data)) throw invalido('data deve ser AAAA-MM-DD de calendário real', { field: 'data' });
  const prisma = getPrismaClient();
  if (!(await ativacaoDaEmpresa(prisma, auth.clienteId, empresaId))) throw recusa('REBANHO_LEDGER_INATIVO', 'o ledger de posições não está ativo nesta empresa');
  const linhas = /** @type {Array<{posicao_id: string, area_id: string, area_nome: string, nome: string, categoria: string|null, sexo: string|null, lote_entrada_id: string|null, saldo: number}>} */ (
    await prisma.$queryRaw`
      SELECT p.id AS posicao_id, p.area_id, a.nome AS area_nome, p.nome, p.categoria, p.sexo, p.lote_entrada_id,
             COALESCE(SUM(x.delta) FILTER (WHERE x.ativa AND x.data_operacional <= ${data}::date), 0)::int AS saldo
        FROM "PosicaoRebanho" p
        JOIN "AreaPastagem" a ON a.cliente_id = p.cliente_id AND a.id = p.area_id
        LEFT JOIN "PartidaRebanho" x ON x.cliente_id = p.cliente_id AND x.posicao_id = p.id
       WHERE p.cliente_id = ${auth.clienteId} AND p.empresa_id = ${empresaId}
         ${areaId ? Prisma.sql`AND p.area_id = ${areaId}` : Prisma.empty}
       GROUP BY p.id, a.nome
       ORDER BY p.area_id, p.id`
  );
  const comSaldo = linhas.filter((l) => l.saldo !== 0);
  const porArea = {};
  for (const l of comSaldo) porArea[l.area_id] = { area_id: l.area_id, area_nome: l.area_nome, total: (porArea[l.area_id]?.total ?? 0) + l.saldo };
  return { data, posicoes: comSaldo, areas: Object.values(porArea), total: comSaldo.reduce((t, l) => t + l.saldo, 0) };
};

/** Reconciliação read-only: projeção × soma das partidas e fins de dia negativos. */
export const verificarLedger = async (contexto, { empresa_id: empresaId }) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const divergentes = /** @type {Array<{posicao_id: string, projecao: number, ledger: number}>} */ (
    await prisma.$queryRaw`
      SELECT p.id AS posicao_id, p.quantidade_cabecas AS projecao, COALESCE(SUM(x.delta) FILTER (WHERE x.ativa), 0)::int AS ledger
        FROM "PosicaoRebanho" p LEFT JOIN "PartidaRebanho" x ON x.cliente_id = p.cliente_id AND x.posicao_id = p.id
       WHERE p.cliente_id = ${auth.clienteId} AND p.empresa_id = ${empresaId}
       GROUP BY p.id HAVING p.quantidade_cabecas <> COALESCE(SUM(x.delta) FILTER (WHERE x.ativa), 0)`
  );
  const ids = (await prisma.posicaoRebanho.findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresaId }, select: { id: true } })).map((p) => p.id);
  const negativos = await primeirosSaldosNegativos(prisma, auth.clienteId, ids);
  return { posicoes: ids.length, divergentes, negativos: negativos.map((n) => ({ ...n, dia: diaDoBanco(n.dia) })), integro: !divergentes.length && !negativos.length };
};
