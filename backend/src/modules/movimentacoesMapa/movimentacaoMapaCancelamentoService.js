/**
 * Cancelamento de movimentação do mapa — R2A (D-PROD-99).
 *
 * Uma transação PostgreSQL faz tudo ou nada:
 *   1. administrador ativo do tenant (`exigirAdminTenant`, relido do banco);
 *   2. idempotência por (cliente, operation_id, tipo) + fingerprint;
 *   3. trava do movimento (`FOR UPDATE`) e dos lotes afetados em ordem de id;
 *   4. elegibilidade: tipo certificado, PROVENIÊNCIA causal (o movimento nasceu
 *      do comando atômico de manejo — `efeito_servidor` reservado + operação
 *      idempotente confirmada apontando para ele; R2A-R1), estado atual coerente
 *      e nenhuma dependência posterior (consulta completa no banco, sem teto);
 *   5. aplica o delta nos lotes, marca o movimento como `situacao: 'cancelado'`
 *      (o original não é apagado nem tem a data mudada) e audita.
 *
 * Tudo vem do servidor: o corpo só traz `operation_id` e `motivo`. Na dúvida,
 * recusa com código estável — ambiguidade é proteção, não convite a heurística.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirAdminTenant, atorDoTenant, ehAdminTenantAtivo } from '../../shared/auth/exigirAdminTenant.js';
import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { buscarNomesDeAreas } from './movimentacaoMapaRepository.js';
import { movimentoCitaLotes } from './movimentacaoVinculoLote.js';
import { CAMPOS_IDENTIFICACAO_LOTE, CAMPOS_MATERIAIS_LOTE, COMANDO_MANEJO, TIPO_OPERACAO_MANEJO, estadoDe, identificacaoDe } from './manejoMapaComandoService.js';
import { comoLotePublico } from '../lotes/loteService.js';
import {
  COMANDO_REBANHO,
  TIPO_OPERACAO_REBANHO,
  TIPOS_DO_COMANDO_REBANHO,
  divergenciasRebanho,
  estadoRebanhoDe,
  pesoNormal,
} from './manejoRebanhoComandoService.js';

export const TIPO_OPERACAO_CANCELAMENTO = 'cancelamento_movimentacao_mapa';
export const SITUACAO_CANCELADO = 'cancelado';

/** Tipos com cancelamento certificado: R2A (D-PROD-99) + R2B-P1 (D-PROD-101). */
export const TIPOS_CANCELAVEIS_R2A = Object.freeze(['Morte', 'Abate', 'Transferência de Área']);
export const TIPOS_CANCELAVEIS = Object.freeze([...TIPOS_CANCELAVEIS_R2A, ...TIPOS_DO_COMANDO_REBANHO]);

/** Comandos com proveniência certificada (efeito + operação idempotente). */
export const COMANDOS_CERTIFICADOS = Object.freeze([COMANDO_MANEJO, COMANDO_REBANHO]);

/** Modos de transferência gravados pelo `DetalhesLote` a partir da R2A. */
export const MODOS_TRANSFERENCIA = Object.freeze([
  'total_no_lugar',
  'total_unificado',
  'parcial_unificado',
  'parcial_novo_lote',
]);


const erroNaoEncontrado = () => new AppError('MOVIMENTACAOMAPA_NOT_FOUND', 'MovimentacaoMapa não encontrado');
const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const data10 = (v) => (typeof v === 'string' ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : '');

// ─── Leitura com trava ─────────────────────────────────────────────────────

const buscarMovimento = async (tx, clienteId, id, travar) => {
  if (travar) {
    await tx.$queryRaw`SELECT id FROM "MovimentacaoMapa" WHERE cliente_id = ${clienteId} AND id = ${id} FOR UPDATE`;
  }
  return tx.movimentacaoMapa.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } });
};

const buscarLotes = async (tx, clienteId, ids, travar) => {
  const ordenados = [...new Set(ids)].sort();
  if (travar && ordenados.length) {
    await tx.$queryRaw`SELECT id FROM "Lote" WHERE cliente_id = ${clienteId} AND id = ANY(${ordenados}::text[]) ORDER BY id FOR UPDATE`;
  }
  const lotes = await tx.lote.findMany({ where: { cliente_id: clienteId, id: { in: ordenados } } });
  return new Map(lotes.map((l) => [l.id, l]));
};

// ─── Proveniência causal (R2A-R1, D-PROD-99a) ──────────────────────────────

/**
 * O efeito só é provado quando o movimento nasceu do comando atômico de manejo:
 * `efeito_servidor` é campo reservado (POST/bulk/PATCH genéricos recusam) e a
 * operação idempotente que o gerou precisa existir, confirmada, apontando
 * para ESTE movimento. Coincidência de tempo, valor, nome, área ou AuditLog
 * não prova nada — registro sem isso é recusado (fail-closed).
 */
const exigirProveniencia = async (tx, clienteId, mov) => {
  const efeito = mov.dados?.efeito_servidor;
  const valido =
    efeito &&
    typeof efeito === 'object' &&
    efeito.comando === COMANDO_MANEJO &&
    typeof efeito.operation_id === 'string' &&
    Array.isArray(efeito.efeitos) &&
    efeito.efeitos.length > 0 &&
    efeito.efeitos.every(
      (x) =>
        x &&
        typeof x.lote_id === 'string' &&
        typeof x.auditoria_id === 'string' &&
        snapshotCompleto(x.antes) &&
        snapshotCompleto(x.depois)
    );
  if (!valido) {
    throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'registro sem comprovação individual de efeito (anterior ao comando atômico)');
  }
  const operacao = await tx.operacaoIdempotente.findUnique({
    where: {
      cliente_id_operation_key_tipo_operacao: { cliente_id: clienteId, operation_key: efeito.operation_id, tipo_operacao: TIPO_OPERACAO_MANEJO },
    },
  });
  const resposta = /** @type {any} */ (operacao?.response_json);
  if (!operacao || operacao.status !== 'committed' || resposta?.movimentacao?.id !== mov.id) {
    throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'operação que gerou o efeito não confere com este movimento');
  }
  return efeito;
};

// ─── Estado causal (R2A-R2, D-PROD-99b) ────────────────────────────────────

/** Snapshot com TODOS os campos materiais (registro da R2A-R1 sem eles: não comprovado). */
const snapshotCompleto = (x) =>
  !!x && typeof x === 'object' && CAMPOS_MATERIAIS_LOTE.every((k) => Object.prototype.hasOwnProperty.call(x, k));

/** Igualdade estrita dos campos materiais; `undefined` nunca casa (fail-closed). */
const divergencias = (a, b) =>
  CAMPOS_MATERIAIS_LOTE.filter((k) => {
    const va = a?.[k];
    const vb = b?.[k];
    if (va === undefined || vb === undefined) return true;
    return (va ?? null) !== (vb ?? null);
  });

/**
 * O AuditLog que o próprio comando gravou (id dentro de `efeito_servidor`,
 * campo reservado) tem de existir, ser do mesmo tenant e lote, e registrar
 * exatamente o pós-estado do efeito. É a âncora no tempo para "depois".
 */
const exigirAuditoriaOriginal = async (tx, clienteId, efeitos) => {
  const ids = efeitos.map((x) => x.auditoria_id);
  const linhas = await tx.auditLog.findMany({
    where: { cliente_id: clienteId, id: { in: ids }, entidade: 'Lote' },
    select: { id: true, entidade_id: true, acao: true, dados_novos: true, createdAt: true },
  });
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const ancoras = new Map();
  for (const x of efeitos) {
    const linha = porId.get(x.auditoria_id);
    if (!linha || linha.entidade_id !== x.lote_id || divergencias(linha.dados_novos, x.depois).length) {
      throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'a auditoria original do efeito não confere', { lote_id: x.lote_id });
    }
    ancoras.set(x.lote_id, linha);
  }
  return ancoras;
};

/** Linha de auditoria que mexe em campo material (create/delete/qualquer outra ação também). */
const ehMaterial = (linha) =>
  linha.acao !== 'update' ||
  !linha.dados_anteriores ||
  !linha.dados_novos ||
  divergencias(linha.dados_anteriores, linha.dados_novos).length > 0;

/** Linha que mexe na identificação (ou que não permite saber): conta como edição posterior. */
const mexeNaIdentificacao = (linha) => {
  if (linha.acao !== 'update' || !linha.dados_anteriores || !linha.dados_novos) return true;
  return CAMPOS_IDENTIFICACAO_LOTE.some((k) => {
    const a = linha.dados_anteriores[k];
    const n = linha.dados_novos[k];
    if (a === undefined || n === undefined) return true;
    return (a ?? null) !== (n ?? null);
  });
};

/** Snapshot de identificação completo (os três campos presentes). */
const identificacaoCompleta = (x) =>
  !!x && typeof x === 'object' && CAMPOS_IDENTIFICACAO_LOTE.every((k) => Object.prototype.hasOwnProperty.call(x, k));
const mesmaIdentificacao = (a, b) => CAMPOS_IDENTIFICACAO_LOTE.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));

/** Modos em que o comando sobrescreve a identificação do destino. */
const MODOS_UNIFICADOS = Object.freeze(['parcial_unificado', 'total_unificado']);

/**
 * Toda alteração MATERIAL nos lotes participantes depois da auditoria original
 * precisa ser explicada por um manejo comprovado posterior JÁ CANCELADO (o
 * efeito dele e a reversão dele, ambos com `auditoria_id` gravado pelo
 * servidor em campos reservados). Qualquer outra — PATCH direto, ida e volta,
 * fluxo legado — torna a reversão não comprovável. Edição sem campo material
 * (peso, nome, identificador) não conta.
 *
 * Mesmo milissegundo da âncora: só o `create` do próprio lote é anterior por
 * construção; o resto conta como posterior (fail-closed).
 */
const exigirSemAlteracaoPosterior = async (tx, clienteId, mov, efeitos, ancoras) => {
  const proprios = new Set(efeitos.map((x) => x.auditoria_id));
  const loteIds = efeitos.map((x) => x.lote_id);
  const desde = new Date(Math.min(...[...ancoras.values()].map((a) => a.createdAt.getTime())));
  const linhas = await tx.auditLog.findMany({
    where: { cliente_id: clienteId, entidade: 'Lote', entidade_id: { in: loteIds }, createdAt: { gte: desde } },
    select: { id: true, entidade_id: true, acao: true, dados_anteriores: true, dados_novos: true, createdAt: true },
  });
  const suspeitas = linhas.filter((l) => {
    if (proprios.has(l.id)) return false;
    const ancora = ancoras.get(l.entidade_id);
    const t = l.createdAt.getTime();
    const a = ancora.createdAt.getTime();
    if (t < a) return false;
    if (t === a && l.acao === 'create') return false;
    return ehMaterial(l) || mexeNaIdentificacao(l);
  });
  /** Lotes cuja identificação foi editada depois, fora de manejo comprovado já cancelado (R2A-R3). */
  const identificacaoEditada = new Set();
  if (!suspeitas.length) return identificacaoEditada;

  const ids = suspeitas.map((l) => l.id);
  const explicadas = /** @type {Array<{aid: string, fonte: string, mov_id: string, situacao: string|null}>} */ (
    await tx.$queryRaw`
      SELECT e.val->>'auditoria_id' AS aid, 'efeito' AS fonte, m.id AS mov_id, m.dados->>'situacao' AS situacao
        FROM "MovimentacaoMapa" m
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(m.dados->'efeito_servidor'->'efeitos') = 'array' THEN m.dados->'efeito_servidor'->'efeitos' ELSE '[]'::jsonb END
        ) AS e(val)
       WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${mov.empresa_id} AND m.id <> ${mov.id}
         AND m.dados->'efeito_servidor'->>'comando' = ANY(${[...COMANDOS_CERTIFICADOS]}::text[])
         AND e.val->>'auditoria_id' = ANY(${ids}::text[])
      UNION ALL
      SELECT e.val->>'auditoria_id' AS aid, 'cancelamento' AS fonte, m.id AS mov_id, m.dados->>'situacao' AS situacao
        FROM "MovimentacaoMapa" m
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(m.dados->'cancelamento'->'efeitos') = 'array' THEN m.dados->'cancelamento'->'efeitos' ELSE '[]'::jsonb END
        ) AS e(val)
       WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${mov.empresa_id} AND m.id <> ${mov.id}
         AND m.dados->>'situacao' = ${SITUACAO_CANCELADO}
         AND e.val->>'auditoria_id' = ANY(${ids}::text[])`
  );
  const porAid = new Map(explicadas.map((x) => [x.aid, x]));
  for (const l of suspeitas) {
    const x = porAid.get(l.id);
    if (x && x.fonte === 'efeito' && x.situacao !== SITUACAO_CANCELADO) {
      throw recusa('CANCELAMENTO_DEPENDENCIA_POSTERIOR', 'há movimento posterior ativo sobre o lote', { lote_id: l.entidade_id, movimentacao_id: x.mov_id });
    }
    if (!x && ehMaterial(l)) {
      throw recusa(
        'CANCELAMENTO_ALTERACAO_POSTERIOR',
        'o lote teve alteração material depois deste movimento, fora de um manejo comprovado; a reversão não é comprovável',
        { lote_id: l.entidade_id }
      );
    }
    if (!x) identificacaoEditada.add(l.entidade_id);
  }
  return identificacaoEditada;
};

// ─── Dependências posteriores (banco, sem teto) ────────────────────────────

/** Fontes JSON com vínculo de lote: tabela fixa (constante, não entrada) e campos de data. */
const FONTES_DE_LOTE = Object.freeze([
  { tabela: 'MovimentacaoPecuaria', datas: ['data_movimentacao', 'data_evento'] },
  { tabela: 'SuplementacaoLote', datas: ['data_lancamento'] },
  { tabela: 'AplicacaoMedicamento', datas: ['data_aplicacao'] },
  { tabela: 'EventoSanitario', datas: ['data_evento'] },
  { tabela: 'ManejoTecnicoRebanho', datas: ['data_evento'] },
]);

const posteriorA = (alias, campos, mov) => {
  const dataMov = data10(mov.dados?.data_movimentacao) || data10(mov.createdAt);
  const datas = campos.map((c) => Prisma.sql`left(COALESCE(${Prisma.raw(alias)}.dados->>${c}, ''), 10) > ${dataMov}`);
  return Prisma.sql`(${Prisma.raw(alias)}."createdAt" > ${mov.createdAt} OR ${Prisma.join(datas, ' OR ')})`;
};

/**
 * Conta registros posteriores ligados aos lotes (por ID; nome só para registro
 * legado SEM id) e, em transferência, às áreas. Conservador por desenho: na
 * dúvida conta. Movimentos cancelados não contam.
 */
const dependenciasPosteriores = async (tx, clienteId, mov, { loteIds, nomes, areaIds }) => {
  const encontrados = [];
  const lotes = [...new Set(loteIds)];
  const nomesUp = [...new Set(nomes.filter(Boolean).map((n) => n.trim().toUpperCase()))];

  const porArea = areaIds.length
    ? Prisma.sql`OR m.dados->>'area_origem_id' = ANY(${areaIds}::text[]) OR m.dados->>'area_destino_id' = ANY(${areaIds}::text[]) OR m.dados->>'area_id' = ANY(${areaIds}::text[])`
    : Prisma.empty;
  const [mapa] = /** @type {Array<{n: number}>} */ (
    await tx.$queryRaw`
      SELECT COUNT(*)::int AS n FROM "MovimentacaoMapa" m
      WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${mov.empresa_id} AND m.id <> ${mov.id}
        AND COALESCE(m.dados->>'situacao', '') <> ${SITUACAO_CANCELADO}
        AND (
          ${movimentoCitaLotes('m', lotes)}
          OR EXISTS (SELECT 1 FROM unnest(${lotes}::text[]) AS l(id) WHERE position(l.id IN COALESCE(m.dados->>'observacoes', '')) > 0)
          OR (COALESCE(m.dados->>'lote_id', '') = '' AND upper(btrim(COALESCE(m.dados->>'lote', ''))) = ANY(${nomesUp}::text[]))
          ${porArea}
        )
        AND ${posteriorA('m', ['data_movimentacao'], mov)}`
  );
  if (mapa?.n) encontrados.push({ fonte: 'MovimentacaoMapa', quantidade: mapa.n });

  for (const fonte of FONTES_DE_LOTE) {
    const [linha] = /** @type {Array<{n: number}>} */ (
      await tx.$queryRaw`
        SELECT COUNT(*)::int AS n FROM ${Prisma.raw(`"${fonte.tabela}"`)} d
        WHERE d.cliente_id = ${clienteId} AND d.empresa_id = ${mov.empresa_id}
          AND (
            d.dados->>'lote_id' = ANY(${lotes}::text[])
            OR (COALESCE(d.dados->>'lote_id', '') = ''
                AND upper(btrim(COALESCE(d.dados->>'lote', d.dados->>'lote_nome', d.dados->>'nome_lote', ''))) = ANY(${nomesUp}::text[]))
          )
          AND ${posteriorA('d', fonte.datas, mov)}`
    );
    if (linha?.n) encontrados.push({ fonte: fonte.tabela, quantidade: linha.n });
  }

  const tarefas = await tx.lancamentoTarefa.count({
    where: { cliente_id: clienteId, empresa_id: mov.empresa_id, lote_id: { in: lotes }, createdAt: { gt: mov.createdAt } },
  });
  if (tarefas) encontrados.push({ fonte: 'LancamentoTarefa', quantidade: tarefas });

  return encontrados;
};

// ─── Plano do cancelamento (sem efeito) ────────────────────────────────────

/**
 * Analisa o movimento e devolve o plano de efeitos, ou lança recusa estável.
 * Com `travar`, segura o movimento e os lotes até o fim da transação.
 */
export const planejarCancelamento = async (tx, clienteId, id, { travar }) => {
  const mov = await buscarMovimento(tx, clienteId, id, travar);
  if (!mov) throw erroNaoEncontrado();
  const d = /** @type {Record<string, any>} */ (mov.dados || {});

  if (d.situacao === SITUACAO_CANCELADO) {
    throw recusa('CANCELAMENTO_JA_REALIZADO', 'a movimentação já está cancelada');
  }
  if (TIPOS_DO_COMANDO_REBANHO.includes(d.tipo)) return planejarCancelamentoRebanho(tx, clienteId, mov, { travar });
  if (!TIPOS_CANCELAVEIS_R2A.includes(d.tipo) || texto(d.motivo)) {
    throw recusa('CANCELAMENTO_TIPO_NAO_SUPORTADO', 'cancelamento ainda não disponível para este tipo', { tipo: d.tipo ?? null, motivo: d.motivo ?? null });
  }
  if (!texto(d.lote_id)) {
    throw recusa('CANCELAMENTO_VINCULO_AMBIGUO', 'movimento sem identificador de lote (registro legado por nome)');
  }

  const efeito = await exigirProveniencia(tx, clienteId, mov);
  const ehTransferencia = d.tipo === 'Transferência de Área';
  const ids = efeito.efeitos.map((x) => x.lote_id);
  // Travas antes de QUALQUER conferência: movimento (acima) e lotes em ordem de id.
  const lotes = await buscarLotes(tx, clienteId, ids, travar);
  for (const registro of efeito.efeitos) {
    const lote = lotes.get(registro.lote_id);
    if (!lote || lote.empresa_id !== mov.empresa_id) {
      throw recusa('CANCELAMENTO_VINCULO_AMBIGUO', 'lote do efeito não encontrado nesta empresa', { lote_id: registro.lote_id });
    }
  }
  const ancoras = await exigirAuditoriaOriginal(tx, clienteId, efeito.efeitos);

  // 1) Registros posteriores em outras fontes (dependência clássica).
  const dependencias = await dependenciasPosteriores(tx, clienteId, mov, {
    loteIds: ids,
    nomes: [d.lote, ...ids.map((i) => lotes.get(i)?.nome)],
    areaIds: ehTransferencia ? [texto(d.area_origem_id), texto(d.area_destino_id)].filter(Boolean) : [],
  });
  if (dependencias.length) {
    throw recusa('CANCELAMENTO_DEPENDENCIA_POSTERIOR', 'há registro posterior ligado ao lote ou à área', { dependencias });
  }
  // 2) Alteração material posterior nos lotes (PATCH direto, ida e volta…).
  const identificacaoEditada = await exigirSemAlteracaoPosterior(tx, clienteId, mov, efeito.efeitos, ancoras);

  // 3) Estado atual == pós-estado gravado, campo a campo, em TODOS os participantes.
  /** @type {Array<{lote_id: string, antes: Record<string, any>, depois: Record<string, any>, auditoria_id?: string, identificacao: string}>} */
  const efeitos = [];
  for (const registro of efeito.efeitos) {
    const lote = lotes.get(registro.lote_id);
    const campos = divergencias(estadoDe(lote), registro.depois);
    if (campos.length) {
      throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o estado atual do lote não é o que o movimento deixou', { lote_id: lote.id, campos });
    }
    if (divergencias({ ...registro.antes, quantidade_cabecas: 0, status: '', area_atual_id: '' }, { ...registro.depois, quantidade_cabecas: 0, status: '', area_atual_id: '' }).length) {
      // O comando só muda saldo, situação e área; classificação diferente entre antes/depois não é deste fluxo.
      throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'efeito com mudança de classificação não suportada', { lote_id: lote.id });
    }
    const alvo = registro.antes;
    if (!Number.isInteger(alvo.quantidade_cabecas) || alvo.quantidade_cabecas < 0) {
      throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'pré-estado inválido no efeito', { lote_id: lote.id });
    }
    /** @type {Record<string, any>} */
    const depois = { quantidade_cabecas: alvo.quantidade_cabecas, status: alvo.status };
    const antes = { quantidade_cabecas: lote.quantidade_cabecas, status: lote.status };
    if ((alvo.area_atual_id ?? null) !== (lote.area_atual_id ?? null) && alvo.area_atual_id) {
      const nomes = await buscarNomesDeAreas(tx, clienteId, mov.empresa_id, [alvo.area_atual_id]);
      if (!nomes.get(alvo.area_atual_id)) {
        throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'a área de origem não existe mais nesta empresa', { lote_id: lote.id });
      }
      depois.area_atual_id = alvo.area_atual_id;
      depois.area_atual_nome = nomes.get(alvo.area_atual_id);
      Object.assign(antes, { area_atual_id: lote.area_atual_id, area_atual_nome: lote.area_atual_nome });
    }
    // Identificação (R2A-R3, D-PROD-99c): a unificação sobrescreve a do destino.
    // Devolve o valor anterior só com prova de que ninguém mexeu depois:
    // nenhuma linha de auditoria posterior não explicada tocou a identificação
    // E o valor atual é exatamente o que o comando aplicou. Havendo edição
    // (inclusive ida e volta) ou valor que não confere, a edição do usuário é
    // PRESERVADA — o cancelamento não destrói dado legítimo.
    let identificacao = 'inalterada';
    const ident = registro.identificacao;
    if (!ident) {
      if (MODOS_UNIFICADOS.includes(efeito.modo)) {
        throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'unificação sem snapshot de identificação do destino', { lote_id: lote.id });
      }
    } else {
      if (!identificacaoCompleta(ident.antes) || !identificacaoCompleta(ident.depois)) {
        throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'snapshot de identificação incompleto', { lote_id: lote.id });
      }
      if (!mesmaIdentificacao(ident.antes, ident.depois) && !registro.criado) {
        if (identificacaoEditada.has(lote.id) || !mesmaIdentificacao(identificacaoDe(lote), ident.depois)) {
          identificacao = 'preservada_edicao_posterior';
        } else {
          identificacao = 'restaurada';
          Object.assign(antes, identificacaoDe(lote));
          for (const k of CAMPOS_IDENTIFICACAO_LOTE) depois[k] = ident.antes[k] ?? null;
        }
      }
    }
    efeitos.push({ lote_id: lote.id, antes, depois, identificacao });
  }

  // Conservação: transferência não cria nem some com cabeças.
  if (ehTransferencia) {
    const soma = (k) => efeitos.reduce((t, x) => t + x[k].quantidade_cabecas, 0);
    if (soma('antes') !== soma('depois')) {
      throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o cancelamento não conservaria as cabeças');
    }
  }
  return { mov, tipo: d.tipo, modo: efeito.modo ?? null, quantidade: Number(d.quantidade_animais), efeitos };
};

// ─── R2B-P1: Nascimento, Pesagem, Mudança de Categoria (D-PROD-101) ────────

/** Proveniência R2B: efeito reservado + operação idempotente confirmada apontando para ESTE movimento. */
const exigirProvenienciaRebanho = async (tx, clienteId, mov) => {
  const d = /** @type {Record<string, any>} */ (mov.dados || {});
  const efeito = d.efeito_servidor;
  const completo = (x) => !!x && typeof x === 'object' && !divergenciasRebanho(x, x).length;
  const valido =
    efeito &&
    typeof efeito === 'object' &&
    efeito.comando === COMANDO_REBANHO &&
    typeof efeito.operation_id === 'string' &&
    Array.isArray(efeito.efeitos) &&
    efeito.efeitos.length > 0 &&
    efeito.efeitos.every((x) => x && typeof x.lote_id === 'string' && typeof x.auditoria_id === 'string' && completo(x.antes) && completo(x.depois)) &&
    Array.isArray(d.lote_ids) &&
    d.lote_ids.length === efeito.efeitos.length &&
    efeito.efeitos.every((x, i) => d.lote_ids[i] === x.lote_id) &&
    new Set(d.lote_ids).size === d.lote_ids.length;
  if (!valido) {
    throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'registro sem comprovação individual de efeito (anterior ao comando atômico)');
  }
  const operacao = await tx.operacaoIdempotente.findUnique({
    where: {
      cliente_id_operation_key_tipo_operacao: { cliente_id: clienteId, operation_key: efeito.operation_id, tipo_operacao: TIPO_OPERACAO_REBANHO },
    },
  });
  const resposta = /** @type {any} */ (operacao?.response_json);
  if (!operacao || operacao.status !== 'committed' || resposta?.movimentacao?.id !== mov.id) {
    throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'operação que gerou o efeito não confere com este movimento');
  }
  return efeito;
};

/** Âncora: a linha de AuditLog gravada pelo comando registra exatamente o pós-estado (todos os campos R2B). */
const exigirAuditoriaRebanho = async (tx, clienteId, efeitos) => {
  const linhas = await tx.auditLog.findMany({
    where: { cliente_id: clienteId, id: { in: efeitos.map((x) => x.auditoria_id) }, entidade: 'Lote' },
    select: { id: true, entidade_id: true, acao: true, dados_novos: true, createdAt: true },
  });
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const ancoras = new Map();
  for (const x of efeitos) {
    const linha = porId.get(x.auditoria_id);
    const acaoEsperada = x.criado ? 'create' : 'update';
    if (!linha || linha.entidade_id !== x.lote_id || linha.acao !== acaoEsperada || divergenciasRebanho(linha.dados_novos, x.depois).length) {
      throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'a auditoria original do efeito não confere', { lote_id: x.lote_id });
    }
    ancoras.set(x.lote_id, linha);
  }
  return ancoras;
};

/**
 * Toda alteração posterior de saldo, situação, área, classificação, sexo ou
 * PESO num participante precisa ser explicada por manejo comprovado JÁ
 * cancelado. PATCH direto (inclusive ida e volta) ou manejo posterior ativo
 * bloqueiam: o cancelamento é da mais nova para a mais antiga.
 */
const exigirSemAlteracaoPosteriorRebanho = async (tx, clienteId, mov, efeitos, ancoras) => {
  const proprios = new Set(efeitos.map((x) => x.auditoria_id));
  const desde = new Date(Math.min(...[...ancoras.values()].map((a) => a.createdAt.getTime())));
  const linhas = await tx.auditLog.findMany({
    where: { cliente_id: clienteId, entidade: 'Lote', entidade_id: { in: efeitos.map((x) => x.lote_id) }, createdAt: { gte: desde } },
    select: { id: true, entidade_id: true, acao: true, dados_anteriores: true, dados_novos: true, createdAt: true },
  });
  const suspeitas = linhas.filter((l) => {
    if (proprios.has(l.id)) return false;
    const a = ancoras.get(l.entidade_id).createdAt.getTime();
    const t = l.createdAt.getTime();
    if (t < a) return false;
    if (t === a && l.acao === 'create') return false;
    return l.acao !== 'update' || !l.dados_anteriores || !l.dados_novos || divergenciasRebanho(l.dados_anteriores, l.dados_novos).length > 0;
  });
  if (!suspeitas.length) return;
  const ids = suspeitas.map((l) => l.id);
  const explicadas = /** @type {Array<{aid: string, fonte: string, mov_id: string, situacao: string|null}>} */ (
    await tx.$queryRaw`
      SELECT e.val->>'auditoria_id' AS aid, 'efeito' AS fonte, m.id AS mov_id, m.dados->>'situacao' AS situacao
        FROM "MovimentacaoMapa" m
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(m.dados->'efeito_servidor'->'efeitos') = 'array' THEN m.dados->'efeito_servidor'->'efeitos' ELSE '[]'::jsonb END
        ) AS e(val)
       WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${mov.empresa_id} AND m.id <> ${mov.id}
         AND m.dados->'efeito_servidor'->>'comando' = ANY(${[...COMANDOS_CERTIFICADOS]}::text[])
         AND e.val->>'auditoria_id' = ANY(${ids}::text[])
      UNION ALL
      SELECT e.val->>'auditoria_id' AS aid, 'cancelamento' AS fonte, m.id AS mov_id, m.dados->>'situacao' AS situacao
        FROM "MovimentacaoMapa" m
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(m.dados->'cancelamento'->'efeitos') = 'array' THEN m.dados->'cancelamento'->'efeitos' ELSE '[]'::jsonb END
        ) AS e(val)
       WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${mov.empresa_id} AND m.id <> ${mov.id}
         AND m.dados->>'situacao' = ${SITUACAO_CANCELADO}
         AND e.val->>'auditoria_id' = ANY(${ids}::text[])`
  );
  const porAid = new Map(explicadas.map((x) => [x.aid, x]));
  for (const l of suspeitas) {
    const x = porAid.get(l.id);
    if (x && x.fonte === 'efeito' && x.situacao !== SITUACAO_CANCELADO) {
      throw recusa('CANCELAMENTO_DEPENDENCIA_POSTERIOR', 'há movimento posterior ativo sobre o lote', { lote_id: l.entidade_id, movimentacao_id: x.mov_id });
    }
    if (!x) {
      throw recusa(
        'CANCELAMENTO_ALTERACAO_POSTERIOR',
        'o lote teve alteração de saldo, classificação ou peso depois deste movimento, fora de um manejo comprovado; a reversão não é comprovável',
        { lote_id: l.entidade_id }
      );
    }
  }
};

/** Campos que o cancelamento R2B grava (área e empresa nunca mudam neste comando). */
const CAMPOS_REVERSAO_REBANHO = Object.freeze(['quantidade_cabecas', 'status', 'categoria', 'categoria_manejo_id', 'categoria_manejo_nome', 'sexo', 'peso_medio_kg']);

const planejarCancelamentoRebanho = async (tx, clienteId, mov, { travar }) => {
  const d = /** @type {Record<string, any>} */ (mov.dados || {});
  if (texto(d.motivo)) {
    throw recusa('CANCELAMENTO_TIPO_NAO_SUPORTADO', 'cancelamento ainda não disponível para este tipo', { tipo: d.tipo ?? null, motivo: d.motivo ?? null });
  }
  const efeito = await exigirProvenienciaRebanho(tx, clienteId, mov);
  const ids = efeito.efeitos.map((x) => x.lote_id);
  const lotes = await buscarLotes(tx, clienteId, ids, travar);
  for (const x of efeito.efeitos) {
    const lote = lotes.get(x.lote_id);
    if (!lote || lote.empresa_id !== mov.empresa_id) {
      throw recusa('CANCELAMENTO_VINCULO_AMBIGUO', 'lote do efeito não encontrado nesta empresa', { lote_id: x.lote_id });
    }
    // O comando R2B nunca muda área nem empresa: efeito que diga o contrário não é deste fluxo.
    if ((x.antes.area_atual_id ?? null) !== (x.depois.area_atual_id ?? null) || (x.antes.empresa_id ?? null) !== (x.depois.empresa_id ?? null)) {
      throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'efeito com mudança de área ou empresa não suportada', { lote_id: x.lote_id });
    }
    if (!Number.isInteger(x.antes.quantidade_cabecas) || x.antes.quantidade_cabecas < 0) {
      throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'pré-estado inválido no efeito', { lote_id: x.lote_id });
    }
  }
  const ancoras = await exigirAuditoriaRebanho(tx, clienteId, efeito.efeitos);

  const dependencias = await dependenciasPosteriores(tx, clienteId, mov, {
    loteIds: ids,
    nomes: ids.map((i) => lotes.get(i)?.nome),
    areaIds: [],
  });
  if (dependencias.length) {
    throw recusa('CANCELAMENTO_DEPENDENCIA_POSTERIOR', 'há registro posterior ligado a um lote deste manejo', { dependencias });
  }
  await exigirSemAlteracaoPosteriorRebanho(tx, clienteId, mov, efeito.efeitos, ancoras);

  /** @type {Array<{lote_id: string, lote_nome: string, criado: boolean, antes: Record<string, any>, depois: Record<string, any>, auditoria_id?: string}>} */
  const efeitos = [];
  for (const x of efeito.efeitos) {
    const lote = lotes.get(x.lote_id);
    const campos = divergenciasRebanho(estadoRebanhoDe(lote), x.depois);
    if (campos.length) {
      throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o estado atual do lote não é o que o movimento deixou', { lote_id: lote.id, campos });
    }
    const atual = estadoRebanhoDe(lote);
    /** @type {Record<string, any>} */ const antes = {};
    /** @type {Record<string, any>} */ const depois = {};
    for (const k of CAMPOS_REVERSAO_REBANHO) {
      antes[k] = atual[k];
      depois[k] = k === 'peso_medio_kg' ? pesoNormal(x.antes[k]) : x.antes[k] ?? null;
    }
    efeitos.push({ lote_id: lote.id, lote_nome: lote.nome, criado: !!x.criado, antes, depois });
  }
  return { mov, tipo: d.tipo, modo: null, quantidade: Number(d.quantidade_animais), efeitos };
};

// ─── Comando ───────────────────────────────────────────────────────────────

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {string} id
 * @param {{operation_id: string, motivo: string}} entrada
 */
export const cancelar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const operationKey = texto(entrada?.operation_id);
  const motivo = texto(entrada?.motivo);
  if (!operationKey || !motivo) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'operation_id e motivo são obrigatórios');
  }
  const fingerprint = fingerprintDePayload({ movimentacao_id: id, motivo });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) => {
    const ator = await exigirAdminTenant(contexto, tx);
    return executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO_OPERACAO_CANCELAMENTO,
      fingerprint,
      executar: async () => {
        const plano = await planejarCancelamento(tx, auth.clienteId, id, { travar: true });
        for (const efeito of plano.efeitos) {
          const anterior = await tx.lote.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: efeito.lote_id } } });
          const atualizado = await tx.lote.update({
            where: { cliente_id_id: { cliente_id: auth.clienteId, id: efeito.lote_id } },
            data: efeito.depois,
          });
          // Snapshot completo + id gravado no cancelamento (campo reservado):
          // é o que explica esta alteração para cancelamentos anteriores (R2A-R2).
          const auditoria = await registrarEvento(
            contexto,
            {
              acao: 'update',
              entidade: 'Lote',
              entidadeId: efeito.lote_id,
              dadosAnteriores: { ...comoLotePublico(anterior), origem: 'cancelamento_movimentacao' },
              dadosNovos: { ...comoLotePublico(atualizado), movimentacao_cancelada_id: id },
            },
            tx
          );
          efeito.auditoria_id = auditoria.id;
        }
        const cancelamento = {
          em: new Date().toISOString(),
          por_usuario_id: auth.usuarioId,
          por_login: ator?.login ?? auth.login ?? null,
          motivo,
          operation_id: operationKey,
          modo: plano.modo,
          efeitos: plano.efeitos,
        };
        const movAtualizado = await tx.movimentacaoMapa.update({
          where: { cliente_id_id: { cliente_id: auth.clienteId, id } },
          data: { dados: { ...plano.mov.dados, situacao: SITUACAO_CANCELADO, cancelamento } },
        });
        await registrarEvento(
          contexto,
          {
            acao: 'cancelamento',
            entidade: 'MovimentacaoMapa',
            entidadeId: id,
            dadosAnteriores: documentoComoPublico(plano.mov),
            dadosNovos: documentoComoPublico(movAtualizado),
          },
          tx
        );
        return { httpStatus: 200, body: { movimentacao: documentoComoPublico(movAtualizado), efeitos: plano.efeitos } };
      },
    });
  });
  return { status: resultado.httpStatus, body: { ...resultado.body, replay: resultado.replay } };
};

/**
 * Elegibilidade — só informativa: o POST revalida tudo dentro da transação.
 * Outro tenant: 404. Recusa vira `{elegivel: false, codigo, motivo}`.
 */
export const elegibilidade = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const ator = await atorDoTenant(contexto, tx);
    const podeCancelar = ehAdminTenantAtivo(ator);
    try {
      const plano = await planejarCancelamento(tx, auth.clienteId, id, { travar: false });
      return { elegivel: true, codigo: null, motivo: null, tipo: plano.tipo, modo: plano.modo, efeitos: plano.efeitos, requer_administrador: true, pode_cancelar: podeCancelar };
    } catch (erro) {
      if (erro instanceof AppError && erro.code !== 'MOVIMENTACAOMAPA_NOT_FOUND') {
        return { elegivel: false, codigo: erro.code, motivo: erro.message, detalhes: erro.details ?? null, requer_administrador: true, pode_cancelar: podeCancelar };
      }
      throw erro;
    }
  });
};
