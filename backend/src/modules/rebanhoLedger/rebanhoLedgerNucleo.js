/**
 * Núcleo do ledger do rebanho por posição — R2E-P1/R1 (D-PROD-107).
 *
 * Primitivas compartilhadas pelo serviço (ativação, entrada, transferência,
 * cancelamento, leituras) e pelos manejos (morte/abate, nascimento, pesagem,
 * mudança de categoria, junção). Sem import de nenhum comando do mapa (evita
 * ciclo: os comandos legados delegam para cá).
 *
 * Regras:
 *  - quantidade: saldo de cada posição no FIM de cada dia ≥ 0 em toda a linha
 *    do tempo (eventos do mesmo dia valem juntos);
 *  - peso: série `PesoRebanho` por posição; o peso numa data é a última
 *    observação ATIVA até aquele dia (desconhecido = NULL, nunca zero);
 *    `PosicaoRebanho.peso_medio_kg` é a projeção da última observação;
 *  - identidade: origem (entrada, nascimento ou legado sem prova) + categoria +
 *    sexo + categoria de manejo, por área. Nunca o nome;
 *  - travas: área (ordem de id) → posição (ordem de id).
 */

import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { registrarEvento } from '../auditoria/auditService.js';

export const COMANDO_LEDGER = 'rebanho_ledger';
export const TIPOS_EVENTO = Object.freeze({
  ABERTURA: 'SALDO_ABERTURA',
  ENTRADA: 'ENTRADA',
  TRANSFERENCIA: 'TRANSFERENCIA',
  MORTE: 'MORTE',
  ABATE: 'ABATE',
  NASCIMENTO: 'NASCIMENTO',
  PESAGEM: 'PESAGEM',
  MUDANCA_CATEGORIA: 'MUDANCA_CATEGORIA',
  JUNCAO: 'JUNCAO',
});
/** Fatos que o cancelamento do mapa desfaz (entrada/abertura só pela exclusão do cadastro). */
export const TIPOS_CANCELAVEIS = Object.freeze([
  TIPOS_EVENTO.TRANSFERENCIA,
  TIPOS_EVENTO.MORTE,
  TIPOS_EVENTO.ABATE,
  TIPOS_EVENTO.NASCIMENTO,
  TIPOS_EVENTO.PESAGEM,
  TIPOS_EVENTO.MUDANCA_CATEGORIA,
  TIPOS_EVENTO.JUNCAO,
]);

export const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
export const normal = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
export const invalido = (mensagem, details = {}) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details });
export const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });
export const diaDe = (valor) => String(valor).slice(0, 10);
export const comoData = (dia) => new Date(`${dia}T00:00:00.000Z`);
export const diaDoBanco = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
export const pesoNum = (v) => (v === null || v === undefined ? null : Number(v));
export const peso4 = (v) => (v === null || v === undefined ? null : Number(Number(v).toFixed(4)));

/**
 * Mesma regra de `dataOperacionalValida` dos comandos do mapa (cópia local
 * para não criar ciclo de import com eles).
 */
export const dataOperacionalValida = (valor) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(valor || '');
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia && !Number.isNaN(new Date(valor).getTime());
};

// ─── Ganchos de teste (só NODE_ENV=test): prova de rollback por passo ─────
const ganchos = { falharEm: null };
export const definirFalhaInjetadaLedger = (passo) => {
  if (process.env.NODE_ENV !== 'test') throw new Error('gancho de teste fora de NODE_ENV=test');
  ganchos.falharEm = passo;
};
export const ponto = (passo) => {
  if (ganchos.falharEm === passo) throw new Error(`falha injetada: ${passo}`);
};

// ─── Ativação ──────────────────────────────────────────────────────────────

/** Ativação da empresa (ou null = modelo legado). */
export const ativacaoDaEmpresa = (tx, clienteId, empresaId) =>
  tx.rebanhoLedgerAtivacao.findUnique({ where: { cliente_id_empresa_id: { cliente_id: clienteId, empresa_id: empresaId } } });

/** Fato com data anterior ao corte só é recusado no modo de saldo de abertura (passado não reconstruído). */
export const exigirDiaNoLedger = (ativacao, dia) => {
  if (ativacao.modo === 'entradas') return;
  if (dia < diaDoBanco(ativacao.data_corte)) {
    throw recusa('REBANHO_ANTES_DO_CORTE', 'a data é anterior ao início do ledger nesta empresa (o histórico anterior ao corte não foi reconstruído)', {
      data: dia,
      data_corte: diaDoBanco(ativacao.data_corte),
    });
  }
};

// ─── Identidade e posição ──────────────────────────────────────────────────

/**
 * Identidade da posição. `origem` = id da entrada (cadastro) ou marcador de
 * origem sem cadastro ('nascimento', 'legado:<id>'). Nunca o nome.
 */
export const chaveIdentidade = ({ origem, lote_entrada_id, categoria, sexo, categoria_manejo_id }) =>
  JSON.stringify([origem ?? lote_entrada_id ?? null, normal(categoria) || null, normal(sexo) || null, categoria_manejo_id ?? null]);

/** Origem gravada na chave de uma posição existente. */
export const origemDaPosicao = (p) => {
  try {
    const [origem] = JSON.parse(p.chave_identidade);
    return origem ?? p.lote_entrada_id ?? null;
  } catch {
    return p.lote_entrada_id ?? null;
  }
};

/** Forma pública com os nomes de campo do Lote (o mapa e os formulários a leem sem adaptação). */
export const comoPosicaoPublica = (p, areaNome = null) => ({
  id: p.id,
  posicao_id: p.id,
  __posicao: true,
  empresa_id: p.empresa_id,
  lote_entrada_id: p.lote_entrada_id ?? null,
  origem: origemDaPosicao(p),
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

export const travarAreas = async (tx, clienteId, empresaId, areaIds) => {
  const ids = [...new Set(areaIds.filter(Boolean))].sort();
  if (!ids.length) return new Map();
  await tx.$queryRaw`SELECT id FROM "AreaPastagem" WHERE cliente_id = ${clienteId} AND id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  const areas = await tx.areaPastagem.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, id: { in: ids } }, select: { id: true, nome: true, ativo: true } });
  return new Map(areas.map((a) => [a.id, a]));
};

export const travarPosicoes = async (tx, clienteId, ids) => {
  const ordenados = [...new Set(ids.filter(Boolean))].sort();
  if (!ordenados.length) return new Map();
  await tx.$queryRaw`SELECT id FROM "PosicaoRebanho" WHERE cliente_id = ${clienteId} AND id = ANY(${ordenados}::text[]) ORDER BY id FOR UPDATE`;
  const ps = await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, id: { in: ordenados } } });
  return new Map(ps.map((p) => [p.id, p]));
};

/**
 * Posição da identidade na área (cria vazia se não existir). Exige a área
 * travada pelo chamador. `molde` traz origem, classificação e exibição.
 */
export const posicaoDaIdentidade = async (tx, clienteId, empresaId, areaId, molde) => {
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
      peso_medio_kg: null,
      quantidade_cabecas: 0,
      identificador_nome: molde.identificador_nome ?? null,
      identificador_sigla: molde.identificador_sigla ?? null,
      identificador_cor: molde.identificador_cor ?? null,
    },
  });
  return { posicao: criada, criada: true };
};

/** Molde de uma posição a partir de outra (mesma origem/linhagem), com sobrescritas de classificação. */
export const moldeDe = (p, sobrescritas = {}) => ({
  origem: origemDaPosicao(p),
  lote_entrada_id: p.lote_entrada_id ?? null,
  linhagem: p.linhagem ?? [],
  nome: p.nome,
  numero_lote: p.numero_lote ?? null,
  categoria: p.categoria,
  categoria_manejo_id: p.categoria_manejo_id ?? null,
  categoria_manejo_nome: p.categoria_manejo_nome ?? null,
  sexo: p.sexo,
  identificador_nome: p.identificador_nome ?? null,
  identificador_sigla: p.identificador_sigla ?? null,
  identificador_cor: p.identificador_cor ?? null,
  ...sobrescritas,
});

// ─── Motor temporal (quantidade) ───────────────────────────────────────────

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

/** Saldo de uma posição no fim de um dia (partidas ativas), opcionalmente sem um evento. */
export const saldoNaData = async (tx, clienteId, posicaoId, dia, semEventoId = null) => {
  const [l] = /** @type {Array<{s: number}>} */ (
    await tx.$queryRaw`
      SELECT COALESCE(SUM(delta), 0)::int AS s FROM "PartidaRebanho"
       WHERE cliente_id = ${clienteId} AND posicao_id = ${posicaoId} AND ativa AND data_operacional <= ${dia}::date
         AND (${semEventoId}::text IS NULL OR evento_id <> ${semEventoId})`
  );
  return l?.s ?? 0;
};

// ─── Série de peso ─────────────────────────────────────────────────────────

/**
 * Peso da posição no fim de um dia: última observação ATIVA até o dia
 * (desempate: a gravada por último). `undefined` = nenhuma observação.
 */
export const pesoNaData = async (tx, clienteId, posicaoId, dia) => {
  const o = await tx.pesoRebanho.findFirst({
    where: { cliente_id: clienteId, posicao_id: posicaoId, ativa: true, data_operacional: { lte: comoData(dia) } },
    orderBy: [{ data_operacional: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });
  return o ? pesoNum(o.peso_medio_kg) : undefined;
};

/**
 * Posições anteriores ao R1 podem ter peso só na coluna (sem série): antes da
 * primeira observação nova, grava esse peso como observação-base no dia da
 * primeira partida, ligada ao evento dela. Assim cancelar a observação nova
 * devolve o peso anterior em vez de apagá-lo.
 */
export const garantirPesoBase = async (tx, clienteId, p) => {
  if (pesoNum(p.peso_medio_kg) === null) return;
  const existe = await tx.pesoRebanho.count({ where: { cliente_id: clienteId, posicao_id: p.id } });
  if (existe) return;
  const primeira = await tx.partidaRebanho.findFirst({ where: { cliente_id: clienteId, posicao_id: p.id }, orderBy: [{ data_operacional: 'asc' }, { createdAt: 'asc' }] });
  if (!primeira) return;
  await tx.pesoRebanho.create({
    data: { cliente_id: clienteId, empresa_id: p.empresa_id, evento_id: primeira.evento_id, posicao_id: p.id, data_operacional: primeira.data_operacional, peso_medio_kg: pesoNum(p.peso_medio_kg), medido: false },
  });
};

/** Peso resultante de somar `q` cabeças com peso `pe` a `s` cabeças com peso `pd` (desconhecido contamina). */
export const pesoPonderado = (s, pd, q, pe) => {
  if (s <= 0) return pe ?? null;
  if (pd === null || pd === undefined || pe === null || pe === undefined) return null;
  return peso4((pd * s + pe * q) / (s + q));
};

export const registrarPeso = (tx, { clienteId, empresaId, eventoId, posicaoId, dia, peso, medido = false }) =>
  tx.pesoRebanho.create({
    data: { cliente_id: clienteId, empresa_id: empresaId, evento_id: eventoId, posicao_id: posicaoId, data_operacional: comoData(dia), peso_medio_kg: peso4(peso), medido },
  });

// ─── Projeção ──────────────────────────────────────────────────────────────

/** Projeção = soma das partidas ativas + última observação de peso (idempotente; corrige qualquer desvio). */
export const reprojetar = async (tx, clienteId, posicaoIds) => {
  const ids = [...new Set(posicaoIds)].sort();
  if (!ids.length) return;
  await tx.$executeRaw`
    UPDATE "PosicaoRebanho" p
       SET quantidade_cabecas = COALESCE((SELECT SUM(x.delta) FROM "PartidaRebanho" x WHERE x.cliente_id = p.cliente_id AND x.posicao_id = p.id AND x.ativa), 0),
           peso_medio_kg = CASE
             WHEN EXISTS (SELECT 1 FROM "PesoRebanho" w WHERE w.cliente_id = p.cliente_id AND w.posicao_id = p.id)
             THEN (SELECT w.peso_medio_kg FROM "PesoRebanho" w WHERE w.cliente_id = p.cliente_id AND w.posicao_id = p.id AND w.ativa
                    ORDER BY w.data_operacional DESC, w."createdAt" DESC, w.id DESC LIMIT 1)
             ELSE p.peso_medio_kg END,
           "updatedAt" = now()
     WHERE p.cliente_id = ${clienteId} AND p.id = ANY(${ids}::text[])`;
};

/**
 * Valida a linha do tempo das posições e reprojeta. Primeiro fim de dia
 * negativo → 409 estável (a transação do chamador desfaz tudo).
 * @param {(neg: {posicao_id: string, dia: string, saldo: number}) => Record<string, unknown>} detalhar
 */
export const validarEReprojetar = async (tx, clienteId, posicaoIds, codigo, mensagem, detalhar) => {
  const negativos = await primeirosSaldosNegativos(tx, clienteId, posicaoIds);
  if (negativos.length) {
    const primeiro = [...negativos].sort((a, b) => diaDoBanco(a.dia).localeCompare(diaDoBanco(b.dia)))[0];
    throw recusa(codigo, mensagem, detalhar({ posicao_id: primeiro.posicao_id, dia: diaDoBanco(primeiro.dia), saldo: primeiro.saldo }));
  }
  await reprojetar(tx, clienteId, posicaoIds);
};

// ─── Evento, partidas, auditoria, ponte de histórico ───────────────────────

export const criarEvento = (tx, { clienteId, empresaId, tipo, dia, usuarioId, operationKey, dados }) =>
  tx.eventoRebanho.create({
    data: { cliente_id: clienteId, empresa_id: empresaId, tipo, data_operacional: comoData(dia), registrado_por_usuario_id: usuarioId ?? null, operation_id: operationKey, dados },
  });

export const inserirPartidas = (tx, { clienteId, empresaId, eventoId, dia, partidas }) =>
  partidas.length
    ? tx.partidaRebanho.createMany({
        data: partidas.map((p) => ({ cliente_id: clienteId, empresa_id: empresaId, evento_id: eventoId, posicao_id: p.posicao_id, data_operacional: comoData(dia), delta: p.delta })),
      })
    : Promise.resolve();

export const auditarPosicoes = async (contexto, tx, clienteId, ids, antes) => {
  const depois = await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, id: { in: [...new Set(ids)] } } });
  for (const p of depois) {
    const a = antes.get(p.id);
    await registrarEvento(contexto, { acao: a ? 'update' : 'create', entidade: 'PosicaoRebanho', entidadeId: p.id, dadosAnteriores: a ? comoPosicaoPublica(a) : undefined, dadosNovos: comoPosicaoPublica(p) }, tx);
  }
  return new Map(depois.map((p) => [p.id, p]));
};

/** Ids citáveis no histórico: posições + entradas de origem (o histórico acha por qualquer um). */
export const idsCitados = (posicoes) => [...new Set(posicoes.flatMap((p) => [p.id, p.lote_entrada_id].filter(Boolean)))];

/**
 * Ponte com o histórico existente (`MovimentacaoMapa`): o fato aparece por
 * cadastro de origem, por posição e por área; `efeito_servidor` reservado
 * aponta para o evento (o cancelamento confere evento + operação).
 */
export const criarPonteMovimentacao = async (tx, contexto, { clienteId, empresaId, evento, operationKey, usuarioId, dados }) => {
  const mov = await tx.movimentacaoMapa.create({
    data: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      dados: {
        ...dados,
        efeito_servidor: { comando: COMANDO_LEDGER, evento_id: evento.id, operation_id: operationKey, registrado_em: evento.registrado_em.toISOString(), registrado_por_usuario_id: usuarioId ?? null },
      },
    },
  });
  await tx.eventoRebanho.update({ where: { cliente_id_id: { cliente_id: clienteId, id: evento.id } }, data: { movimentacao_id: mov.id } });
  await registrarEvento(contexto, { acao: 'create', entidade: 'EventoRebanho', entidadeId: evento.id, dadosNovos: { tipo: evento.tipo, data_operacional: diaDoBanco(evento.data_operacional), movimentacao_id: mov.id } }, tx);
  await registrarEvento(contexto, { acao: 'create', entidade: 'MovimentacaoMapa', entidadeId: mov.id, dadosNovos: documentoComoPublico(mov) }, tx);
  return mov;
};

/** Detalhe padrão do 409 de saldo histórico: data, área, posição, disponível e pedido. */
export const detalheSaldo = (posicoes, areas, pedidos, dia) => (neg) => {
  const p = posicoes.get(neg.posicao_id);
  const pedido = pedidos.get(neg.posicao_id) ?? null;
  return {
    data: neg.dia,
    area_id: p?.area_id ?? null,
    area_nome: areas.get(p?.area_id)?.nome ?? null,
    posicao_id: neg.posicao_id,
    lote_entrada_id: p?.lote_entrada_id ?? null,
    nome: p?.nome ?? null,
    disponivel: pedido !== null && neg.dia >= dia ? neg.saldo + pedido : null,
    pedido,
    saldo_resultante: neg.saldo,
  };
};
