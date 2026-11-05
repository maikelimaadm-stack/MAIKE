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
import { exigirDiaNaoFuturo, hojeDaEmpresa } from './rebanhoLedgerTempo.js';
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
const exigirDiaDepoisDoCorte = (ativacao, dia) => {
  if (ativacao.modo === 'entradas') return;
  if (dia < diaDoBanco(ativacao.data_corte)) {
    throw recusa('REBANHO_ANTES_DO_CORTE', 'a data é anterior ao início do ledger nesta empresa (o histórico anterior ao corte não foi reconstruído)', {
      data: dia,
      data_corte: diaDoBanco(ativacao.data_corte),
    });
  }
};

/**
 * Guarda temporal ÚNICA de todo fato novo do ledger (D-PROD-122): o dia está
 * dentro do ledger (não antes do corte) e não é posterior a hoje no fuso da
 * fazenda. Roda dentro da transação, depois da idempotência (replay não chega
 * aqui) e antes de qualquer escrita. Sem fuso → EMPRESA_FUSO_NAO_CONFIGURADO.
 * @returns {Promise<{hoje: string, fuso: string}>}
 */
export const exigirDiaNoLedger = async (tx, clienteId, ativacao, dia) => {
  exigirDiaDepoisDoCorte(ativacao, dia);
  const referencia = await hojeDaEmpresa(tx, clienteId, ativacao.empresa_id);
  exigirDiaNaoFuturo(referencia, dia);
  return referencia;
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
  // PR174-R4: proveniência da ENTRADA (só leitura, do cadastro de origem). O estado
  // atual é da posição; estes campos descrevem de onde o grupo veio.
  raca_predominante: p.loteEntrada?.raca_predominante ?? null,
  sistema_produtivo: p.loteEntrada?.sistema_produtivo ?? null,
  data_entrada: p.loteEntrada?.data_entrada ? diaDoBanco(p.loteEntrada.data_entrada) : null,
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
  const [o] = /** @type {Array<{peso: unknown}>} */ (await tx.$queryRaw`
    SELECT w.peso_medio_kg AS peso
      FROM "PesoRebanho" w JOIN "EventoRebanho" ev ON ev.cliente_id = w.cliente_id AND ev.id = w.evento_id
     WHERE w.cliente_id = ${clienteId} AND w.posicao_id = ${posicaoId} AND w.ativa AND w.data_operacional <= ${comoData(dia)}::date
     ORDER BY w.data_operacional DESC, ev.registrado_em DESC, ev.id DESC, w."createdAt" DESC, w.id DESC
     LIMIT 1`);
  return o ? pesoNum(o.peso) : undefined;
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
             THEN (SELECT w.peso_medio_kg FROM "PesoRebanho" w JOIN "EventoRebanho" ev ON ev.cliente_id = w.cliente_id AND ev.id = w.evento_id
                    WHERE w.cliente_id = p.cliente_id AND w.posicao_id = p.id AND w.ativa
                    ORDER BY w.data_operacional DESC, ev.registrado_em DESC, ev.id DESC, w."createdAt" DESC, w.id DESC LIMIT 1)
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

/**
 * PR174-R2: `registrado_em` é o relógio do BANCO no momento da criação
 * (clock_timestamp, depois das travas), não o início da transação. Fatos que
 * disputam as mesmas posições ficam em ordem de registro real — é o
 * desempate de "mesmo dia" do motor de peso causal.
 */
export const criarEvento = async (tx, { clienteId, empresaId, tipo, dia, usuarioId, operationKey, dados }) => {
  const [{ agora }] = /** @type {Array<{agora: Date}>} */ (await tx.$queryRaw`SELECT clock_timestamp() AS agora`);
  return tx.eventoRebanho.create({
    data: { cliente_id: clienteId, empresa_id: empresaId, tipo, data_operacional: comoData(dia), registrado_em: agora, registrado_por_usuario_id: usuarioId ?? null, operation_id: operationKey, dados },
  });
};

// ─── Peso causal (PR174-R2) ────────────────────────────────────────────────
//
// Ordem dos fatos: (data_operacional, registrado_em, id do evento). "Antes de
// F" = data anterior, ou mesma data e registrado antes de F. Um fato lançado
// depois no MESMO dia é posterior (desempate documentado na D-PROD-107).
//
// Peso derivado (transferência, junção, mudança de categoria, nascimento) é
// UMA função pura das entradas do fato: média ponderada do destino antes de F
// com cada entrada (peso da origem antes de F, ou peso informado). Peso
// desconhecido contamina (null, nunca zero). A mesma função grava e reconfere:
// toda mudança retroativa/cancelamento reconfere os fatos derivados
// posteriores que tocam as posições afetadas; se o peso deles mudaria,
// 409 REBANHO_PESO_DEPENDENCIA_CAUSAL (desfazer na ordem inversa).

const TIPOS_PESO_DERIVADO = Object.freeze(['TRANSFERENCIA', 'JUNCAO', 'MUDANCA_CATEGORIA', 'NASCIMENTO']);

/** Peso ativo de uma posição imediatamente antes do fato `ref` (undefined = sem observação). */
export const pesoAntesDoEvento = async (tx, clienteId, posicaoId, dia, ref) => {
  const [l] = /** @type {Array<{peso: unknown}>} */ (await tx.$queryRaw`
    SELECT w.peso_medio_kg AS peso
      FROM "PesoRebanho" w JOIN "EventoRebanho" ev ON ev.cliente_id = w.cliente_id AND ev.id = w.evento_id
     WHERE w.cliente_id = ${clienteId} AND w.posicao_id = ${posicaoId} AND w.ativa AND w.evento_id <> ${ref.id}
       AND (w.data_operacional < ${comoData(dia)}::date
            OR (w.data_operacional = ${comoData(dia)}::date AND (ev.registrado_em, ev.id) < (SELECT r.registrado_em, r.id FROM "EventoRebanho" r WHERE r.cliente_id = ${clienteId} AND r.id = ${ref.id})))
     ORDER BY w.data_operacional DESC, ev.registrado_em DESC, ev.id DESC, w."createdAt" DESC, w.id DESC
     LIMIT 1`);
  return l ? pesoNum(l.peso) : undefined;
};

/** Saldo de uma posição imediatamente antes do fato `ref`. */
export const saldoAntesDoEvento = async (tx, clienteId, posicaoId, dia, ref) => {
  const [l] = /** @type {Array<{s: number}>} */ (await tx.$queryRaw`
    SELECT COALESCE(SUM(x.delta), 0)::int AS s
      FROM "PartidaRebanho" x JOIN "EventoRebanho" ev ON ev.cliente_id = x.cliente_id AND ev.id = x.evento_id
     WHERE x.cliente_id = ${clienteId} AND x.posicao_id = ${posicaoId} AND x.ativa AND x.evento_id <> ${ref.id}
       AND (x.data_operacional < ${comoData(dia)}::date
            OR (x.data_operacional = ${comoData(dia)}::date AND (ev.registrado_em, ev.id) < (SELECT r.registrado_em, r.id FROM "EventoRebanho" r WHERE r.cliente_id = ${clienteId} AND r.id = ${ref.id})))`);
  return l?.s ?? 0;
};

/** Média ponderada de [(cabeças, peso)]; qualquer peso desconhecido com cabeças → null. */
export const combinarPesos = (pares) => {
  const validos = pares.filter(([q]) => q > 0);
  if (!validos.length) return null;
  if (validos.some(([, w]) => w === null || w === undefined)) return null;
  const total = validos.reduce((t, [q]) => t + q, 0);
  return peso4(validos.reduce((t, [q, w]) => t + q * w, 0) / total);
};

/**
 * @typedef {{ q: number, posicao_id: string|null, peso_informado: number|null }} EntradaDePeso
 * @param {{id: string, registrado_em: Date}} ref fato que grava o peso
 * @param {EntradaDePeso[]} entradas
 */
export const pesoDerivado = async (tx, clienteId, ref, destinoId, dia, entradas) => {
  const s = await saldoAntesDoEvento(tx, clienteId, destinoId, dia, ref);
  const pares = [];
  if (s > 0) pares.push([s, (await pesoAntesDoEvento(tx, clienteId, destinoId, dia, ref)) ?? null]);
  for (const e of entradas) {
    const w = e.posicao_id ? (await pesoAntesDoEvento(tx, clienteId, e.posicao_id, dia, ref)) ?? null : e.peso_informado ?? null;
    pares.push([e.q, w]);
  }
  return combinarPesos(pares);
};

/**
 * Grava UMA observação por destino e guarda no evento o descritor
 * (`dados.pesos_derivados`) que permite reconferir o cálculo depois.
 * @param {any} tx
 * @param {{clienteId: string, empresaId: string, evento: any, dia: string, destinos: Map<string, EntradaDePeso[]>}} opcoes
 * @returns {Promise<Map<string, number|null>>}
 */
export const registrarPesosDerivados = async (tx, { clienteId, empresaId, evento, dia, destinos }) => {
  const resultado = new Map();
  const descritor = [];
  for (const [destinoId, entradas] of [...destinos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const peso = await pesoDerivado(tx, clienteId, evento, destinoId, dia, entradas);
    const medido = entradas.every((e) => !e.posicao_id && e.peso_informado !== null && e.peso_informado !== undefined);
    await registrarPeso(tx, { clienteId, empresaId, eventoId: evento.id, posicaoId: destinoId, dia, peso, medido });
    resultado.set(destinoId, peso);
    descritor.push({ destino_posicao_id: destinoId, entradas: entradas.map((e) => ({ q: e.q, posicao_id: e.posicao_id ?? null, peso_informado: e.peso_informado ?? null })) });
  }
  const dados = evento.dados && typeof evento.dados === 'object' ? evento.dados : {};
  await tx.eventoRebanho.update({ where: { cliente_id_id: { cliente_id: clienteId, id: evento.id } }, data: { dados: { ...dados, pesos_derivados: descritor } } });
  evento.dados = { ...dados, pesos_derivados: descritor };
  return resultado;
};

/**
 * Reconfere os pesos derivados de fatos ATIVOS, de `diaMin` em diante, que
 * tocam `posicaoIds`. Divergência → 409 com o primeiro fato afetado (ordem
 * causal) e os dois pesos. A transação do chamador desfaz tudo.
 */
export const verificarCausalidadeDePeso = async (tx, clienteId, posicaoIds, diaMin, { exceto = null } = {}) => {
  const ids = [...new Set(posicaoIds)];
  if (!ids.length) return;
  const candidatos = /** @type {Array<{id: string, tipo: string, data_operacional: Date, registrado_em: Date, dados: any}>} */ (await tx.$queryRaw`
    SELECT ev.id, ev.tipo, ev.data_operacional, ev.registrado_em, ev.dados
      FROM "EventoRebanho" ev
     WHERE ev.cliente_id = ${clienteId} AND ev.situacao = 'ativo' AND ev.tipo = ANY(${TIPOS_PESO_DERIVADO}::text[])
       AND ev.data_operacional >= ${comoData(diaMin)}::date AND ev.id <> ${exceto ?? ''}
       AND ev.dados ? 'pesos_derivados'
       AND EXISTS (SELECT 1 FROM "PartidaRebanho" x WHERE x.cliente_id = ev.cliente_id AND x.evento_id = ev.id AND x.ativa AND x.posicao_id = ANY(${ids}::text[]))
     ORDER BY ev.data_operacional, ev.registrado_em, ev.id`);
  for (const ev of candidatos) {
    const dia = diaDoBanco(ev.data_operacional);
    for (const d of ev.dados.pesos_derivados ?? []) {
      const esperado = await pesoDerivado(tx, clienteId, ev, d.destino_posicao_id, dia, d.entradas ?? []);
      const obs = await tx.pesoRebanho.findFirst({ where: { cliente_id: clienteId, evento_id: ev.id, posicao_id: d.destino_posicao_id, ativa: true }, orderBy: { id: 'desc' } });
      const registrado = obs ? pesoNum(obs.peso_medio_kg) : null;
      if ((registrado ?? null) !== (esperado ?? null)) {
        throw recusa('REBANHO_PESO_DEPENDENCIA_CAUSAL', 'um fato posterior calculou o peso com o valor que esta mudança alteraria; desfaça os fatos dependentes na ordem inversa antes (nada foi gravado)', {
          evento_id: ev.id, tipo: ev.tipo, data: dia, posicao_id: d.destino_posicao_id, peso_registrado_kg: registrado, peso_recalculado_kg: esperado,
        });
      }
    }
  }
};

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

// ─── Pré-condições de fatos SEM delta (PR174-R3) ───────────────────────────
//
// Pesagem e nascimento não movem cabeças, então a regra de saldo ≥ 0 não os
// protege. Cada um tem uma pré-condição estrutural, avaliada "no fato" (antes
// dele na ordem (data, registrado_em, id) — a mesma ordem do peso causal):
//  - PESAGEM: cada posição pesada (PesoRebanho do evento) tinha cabeças.
//  - NASCIMENTO: em cada linha, ALGUMA das posições maternas certificadas na
//    criação (`maes_posicao_ids` gravados pelo servidor) tinha cabeças.
// Vínculo por id estrutural, nunca por nome; evento cancelado não conta.

/**
 * Lista violações (sem alterar nada). Filtro por `posicaoIds` (guarda dos
 * comandos) ou por `empresaId` (verificação).
 * @param {any} tx
 * @param {string} clienteId
 * @param {{posicaoIds?: string[]|null, empresaId?: string|null, diaMin?: string|null, exceto?: string|null, limite?: number}} [filtro]
 */
export const violacoesDePrecondicao = async (tx, clienteId, { posicaoIds = null, empresaId = null, diaMin = null, exceto = null, limite = 50 } = {}) => {
  const ids = posicaoIds ? [...new Set(posicaoIds)] : null;
  if (ids && !ids.length) return [];
  const desde = comoData(diaMin ?? '0001-01-01');
  const violacoes = [];
  const pesagens = /** @type {Array<{id: string, tipo: string, data_operacional: Date, registrado_em: Date, posicao_id: string, area_id: string}>} */ (await tx.$queryRaw`
    SELECT DISTINCT ev.id, ev.tipo, ev.data_operacional, ev.registrado_em, w.posicao_id, p.area_id
      FROM "EventoRebanho" ev
      JOIN "PesoRebanho" w ON w.cliente_id = ev.cliente_id AND w.evento_id = ev.id AND w.ativa
      JOIN "PosicaoRebanho" p ON p.cliente_id = w.cliente_id AND p.id = w.posicao_id
     WHERE ev.cliente_id = ${clienteId} AND ev.tipo = 'PESAGEM' AND ev.situacao = 'ativo' AND ev.id <> ${exceto ?? ''}
       AND ev.data_operacional >= ${desde}::date
       AND (${empresaId}::text IS NULL OR ev.empresa_id = ${empresaId})
       AND (${ids}::text[] IS NULL OR w.posicao_id = ANY(${ids}::text[]))
     ORDER BY ev.data_operacional, ev.registrado_em, ev.id`);
  for (const ev of pesagens) {
    const dia = diaDoBanco(ev.data_operacional);
    const s = await saldoAntesDoEvento(tx, clienteId, ev.posicao_id, dia, ev);
    if (s <= 0) violacoes.push({ evento_id: ev.id, tipo: 'PESAGEM', data: dia, posicao_id: ev.posicao_id, area_id: ev.area_id, saldo_no_fato: s });
    if (violacoes.length >= limite) return violacoes;
  }
  const nascimentos = /** @type {Array<{id: string, tipo: string, data_operacional: Date, registrado_em: Date, linhas: any}>} */ (await tx.$queryRaw`
    SELECT ev.id, ev.tipo, ev.data_operacional, ev.registrado_em, m.dados->'linhas' AS linhas
      FROM "EventoRebanho" ev
      JOIN "MovimentacaoMapa" m ON m.cliente_id = ev.cliente_id AND m.id = ev.movimentacao_id
     WHERE ev.cliente_id = ${clienteId} AND ev.tipo = 'NASCIMENTO' AND ev.situacao = 'ativo' AND ev.id <> ${exceto ?? ''}
       AND ev.data_operacional >= ${desde}::date
       AND (${empresaId}::text IS NULL OR ev.empresa_id = ${empresaId})
       AND (${ids}::text[] IS NULL OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(m.dados->'linhas', '[]'::jsonb)) l
                      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(l->'maes_posicao_ids', '[]'::jsonb)) x
              WHERE x = ANY(${ids}::text[])))
     ORDER BY ev.data_operacional, ev.registrado_em, ev.id`);
  for (const ev of nascimentos) {
    const dia = diaDoBanco(ev.data_operacional);
    for (const linha of Array.isArray(ev.linhas) ? ev.linhas : []) {
      const maes = Array.isArray(linha?.maes_posicao_ids) ? linha.maes_posicao_ids.filter((x) => typeof x === 'string') : [];
      if (!maes.length) continue;
      if (ids && !maes.some((m) => ids.includes(m))) continue;
      let total = 0;
      for (const m of maes) total += Math.max(0, await saldoAntesDoEvento(tx, clienteId, m, dia, ev));
      if (total <= 0) {
        const area = await tx.posicaoRebanho.findFirst({ where: { cliente_id: clienteId, id: maes[0] }, select: { area_id: true } });
        violacoes.push({ evento_id: ev.id, tipo: 'NASCIMENTO', data: dia, posicao_ids: maes, area_id: area?.area_id ?? null, categoria_mae: linha.categoria_mae ?? null, saldo_no_fato: 0 });
        if (violacoes.length >= limite) return violacoes;
      }
    }
  }
  return violacoes;
};

/**
 * Guarda temporal ÚNICA dos comandos (PR174-R2 + R3), na mesma transação e
 * depois das travas: peso causal dos fatos derivados + pré-condições dos fatos
 * sem delta. Primeira violação → 409 estável (a transação desfaz tudo).
 */
export const verificarDependenciasTemporais = async (tx, clienteId, posicaoIds, diaMin, { exceto = null } = {}) => {
  await verificarCausalidadeDePeso(tx, clienteId, posicaoIds, diaMin, { exceto });
  const [v] = await violacoesDePrecondicao(tx, clienteId, { posicaoIds, diaMin, exceto, limite: 1 });
  if (v) {
    throw recusa('REBANHO_DEPENDENCIA_FATO_SEM_SALDO', v.tipo === 'PESAGEM'
      ? 'uma pesagem posterior ficaria numa posição sem cabeças na data dela; cancele-a antes (nada foi gravado)'
      : 'um nascimento posterior ficaria sem as matrizes certificadas na data dele; cancele-o antes (nada foi gravado)', v);
  }
};
