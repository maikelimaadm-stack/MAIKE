/**
 * Ledger do rebanho por posição — R2E-P1/R1 (D-PROD-107).
 *
 * Numa empresa ATIVADA (`RebanhoLedgerAtivacao`), a fonte de verdade do saldo
 * operacional é o ledger: `EventoRebanho` (fato com dia operacional) +
 * `PartidaRebanho` (delta por posição) + `PesoRebanho` (série de peso).
 * `PosicaoRebanho` é a projeção. `Lote` é só o cadastro de ENTRADA: nenhum
 * manejo cria ou altera Lote numa empresa ativada.
 *
 * Este arquivo: ativação (dois modos), entrada pelo cadastro, transferência,
 * cancelamento de qualquer fato do ledger, guarda do cancelamento legado e
 * leituras. Os demais manejos estão em `rebanhoLedgerManejos.js`. As
 * primitivas (motor temporal, série de peso, identidade, travas) em
 * `rebanhoLedgerNucleo.js`.
 *
 * Ativação:
 *  - `saldo_abertura`: o saldo atual de cada lote legado vira abertura no dia
 *    do corte; fatos antes do corte são recusados (passado não reconstruído).
 *    Lote derivado legado (origem MOVIMENTAÇÃO) NÃO vira entrada: a linhagem é
 *    rastreada pela movimentação certificada que o criou até a entrada
 *    original; sem prova, fica como origem `legado:<id>` sem `lote_entrada_id`;
 *  - `entradas`: empresa sem histórico legado ativo e com cada lote no estado
 *    da própria entrada — cada cadastro vira ENTRADA na sua data de entrada e a
 *    linha do tempo inteira fica disponível para lançamentos retroativos.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirAdminTenant } from '../../shared/auth/exigirAdminTenant.js';
import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import {
  COMANDO_LEDGER,
  TIPOS_CANCELAVEIS,
  TIPOS_EVENTO,
  ativacaoDaEmpresa,
  auditarPosicoes,
  comoData,
  comoPosicaoPublica,
  criarEvento,
  criarPonteMovimentacao,
  dataOperacionalValida,
  detalheSaldo,
  diaDe,
  diaDoBanco,
  exigirDiaNoLedger,
  garantirPesoBase,
  idsCitados,
  inserirPartidas,
  invalido,
  moldeDe,
  normal,
  pesoNaData,
  pesoNum,
  pesoPonderado,
  ponto,
  posicaoDaIdentidade,
  primeirosSaldosNegativos,
  recusa,
  registrarPeso,
  registrarPesosDerivados,
  reprojetar,
  saldoNaData,
  texto,
  travarAreas,
  travarPosicoes,
  validarEReprojetar,
  verificarDependenciasTemporais,
  violacoesDePrecondicao,
} from './rebanhoLedgerNucleo.js';

export { COMANDO_LEDGER, ativacaoDaEmpresa, comoPosicaoPublica, dataOperacionalValida, diaDe } from './rebanhoLedgerNucleo.js';
export { definirFalhaInjetadaLedger } from './rebanhoLedgerNucleo.js';

export const TIPO_OPERACAO_TRANSFERENCIA = 'rebanho_ledger_transferencia';
export const TIPO_OPERACAO_ATIVACAO = 'rebanho_ledger_ativacao';
export const MODOS_ATIVACAO = Object.freeze(['saldo_abertura', 'entradas']);
export const MAX_ITENS_TRANSFERENCIA = 50;
/** Origens de Lote que não são entrada no rebanho (mesma lista de `loteOrigem.js`, sem acento/caixa). */
const ORIGENS_DERIVADAS = Object.freeze(['MOVIMENTACAO', 'REVERSAO MOVIMENTACAO', 'MUDANCA DE CATEGORIA', 'EDICAO MOVIMENTACAO']);
const ehDerivado = (lote) => ORIGENS_DERIVADAS.includes(normal(lote.origem));
const ehNascimentoLegado = (lote) => normal(lote.origem) === 'NASCIMENTO';

// ─── Ativação da empresa ───────────────────────────────────────────────────

/**
 * Linhagem de um lote legado: entrada (o próprio cadastro), derivado
 * rastreado (movimentação certificada que o criou → lote de origem,
 * recursivamente até uma entrada) ou sem prova (`legado:<id>`). Nunca por nome.
 */
const linhagemLegada = async (tx, clienteId, empresaId, lote, porId, profundidade = 0) => {
  if (!ehDerivado(lote)) {
    if (ehNascimentoLegado(lote)) return { origem: `nascimento-legado:${lote.id}`, lote_entrada_id: null, classe: 'nascimento_legado', raiz: lote };
    return { origem: lote.id, lote_entrada_id: lote.id, classe: 'entrada', raiz: lote };
  }
  if (profundidade > 20) return { origem: `legado:${lote.id}`, lote_entrada_id: null, classe: 'derivado_sem_prova', raiz: lote };
  // Movimentação certificada (efeito_servidor reservado) que CRIOU este lote.
  const [mov] = /** @type {Array<{lote_id: string|null, tipo: string|null, efeitos: any}>} */ (
    await tx.$queryRaw`
      SELECT m.dados->>'lote_id' AS lote_id, m.dados->>'tipo' AS tipo, m.dados->'efeito_servidor'->'efeitos' AS efeitos
        FROM "MovimentacaoMapa" m
       WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${empresaId}
         AND COALESCE(m.dados->>'situacao', '') <> 'cancelado'
         AND jsonb_typeof(m.dados->'efeito_servidor'->'efeitos') = 'array'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.dados->'efeito_servidor'->'efeitos') e
                      WHERE e->>'lote_id' = ${lote.id} AND (e->>'criado')::boolean IS TRUE)
       ORDER BY m."createdAt" LIMIT 1`
  );
  const origemId = mov && Array.isArray(mov.efeitos) ? mov.efeitos.find((x) => x && x.criado !== true && x.lote_id !== lote.id)?.lote_id ?? mov.lote_id : null;
  const origem = origemId && origemId !== lote.id ? porId.get(origemId) ?? (await tx.lote.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id: origemId } })) : null;
  if (!origem) return { origem: `legado:${lote.id}`, lote_entrada_id: null, classe: 'derivado_sem_prova', raiz: lote };
  const r = await linhagemLegada(tx, clienteId, empresaId, origem, porId, profundidade + 1);
  return { ...r, classe: r.classe === 'entrada' ? 'derivado_rastreado' : r.classe };
};

/**
 * Ativa o ledger numa empresa (ver modos no topo do arquivo). Nada é apagado
 * nem alterado em `Lote`; o histórico legado continua consultável.
 */
export const ativarLedger = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const operationKey = texto(entrada?.operation_id);
  const empresaId = texto(entrada?.empresa_id);
  const modo = texto(entrada?.modo) ?? 'saldo_abertura';
  const dataCorte = texto(entrada?.data_corte);
  if (!operationKey || !empresaId) throw invalido('operation_id e empresa_id são obrigatórios');
  if (!MODOS_ATIVACAO.includes(modo)) throw invalido('modo deve ser saldo_abertura ou entradas', { field: 'modo' });
  if (modo === 'saldo_abertura' && (!dataCorte || !/^\d{4}-\d{2}-\d{2}$/.test(dataCorte) || !dataOperacionalValida(dataCorte))) {
    throw invalido('data_corte deve ser AAAA-MM-DD de calendário real', { field: 'data_corte' });
  }
  if (modo === 'entradas' && dataCorte) throw invalido('no modo entradas não há data de corte: a linha do tempo começa em cada entrada', { field: 'data_corte' });
  const fingerprint = fingerprintDePayload({ empresaId, modo, dataCorte });
  const prisma = getPrismaClient();
  const r = await prisma.$transaction(async (tx) => {
    await exigirAdminTenant(contexto, tx);
    return executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO_OPERACAO_ATIVACAO,
      fingerprint,
      executar: async () => {
        // PR174-R2: trava a Empresa (o POST genérico usa FOR SHARE nela antes de ler a ativação).
        const [empresa] = /** @type {Array<{id: string}>} */ (await tx.$queryRaw`SELECT id FROM "Empresa" WHERE cliente_id = ${auth.clienteId} AND id = ${empresaId} FOR UPDATE`);
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');
        if (await ativacaoDaEmpresa(tx, auth.clienteId, empresaId)) throw recusa('REBANHO_LEDGER_JA_ATIVO', 'o ledger já está ativo nesta empresa');
        // Trava todas as áreas e lotes da empresa: nenhum manejo legado corre durante a ativação.
        const areas = await tx.areaPastagem.findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresaId }, select: { id: true } });
        const mapaAreas = await travarAreas(tx, auth.clienteId, empresaId, areas.map((a) => a.id));
        await tx.$queryRaw`SELECT id FROM "Lote" WHERE cliente_id = ${auth.clienteId} AND empresa_id = ${empresaId} ORDER BY id FOR UPDATE`;
        const todos = await tx.lote.findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresaId, excluido_em: null }, orderBy: { id: 'asc' } });
        const porId = new Map(todos.map((l) => [l.id, l]));

        const [hist] = /** @type {Array<{ativos: number, depois: number}>} */ (
          await tx.$queryRaw`
            SELECT COUNT(*) FILTER (WHERE COALESCE(m.dados->>'situacao', '') <> 'cancelado')::int AS ativos,
                   COUNT(*) FILTER (WHERE COALESCE(m.dados->>'situacao', '') <> 'cancelado'
                                      AND COALESCE(NULLIF(left(m.dados->>'data_movimentacao', 10), ''), to_char(m."createdAt", 'YYYY-MM-DD')) > ${dataCorte ?? '9999-12-31'})::int AS depois
              FROM "MovimentacaoMapa" m WHERE m.cliente_id = ${auth.clienteId} AND m.empresa_id = ${empresaId}`
        );
        const ativos = todos.filter((l) => l.status === 'Ativo' && l.quantidade_cabecas > 0);
        const semArea = ativos.filter((l) => !l.area_atual_id || !mapaAreas.has(l.area_atual_id));
        if (semArea.length) throw recusa('REBANHO_ATIVACAO_LOTE_SEM_AREA', 'há lote ativo com cabeças e sem área válida nesta empresa; corrija antes de ativar', { lote_ids: semArea.map((l) => l.id) });

        const partidasPorDia = new Map();
        const pesos = [];
        const somar = (dia, posicaoId, delta) => {
          if (!partidasPorDia.has(dia)) partidasPorDia.set(dia, new Map());
          const m = partidasPorDia.get(dia);
          m.set(posicaoId, (m.get(posicaoId) ?? 0) + delta);
        };
        let dataCorteEfetiva = dataCorte;
        const resumo = { entradas: 0, derivados_rastreados: 0, derivados_sem_prova: 0, nascimentos_legados: 0 };

        if (modo === 'saldo_abertura') {
          if (hist?.depois) throw recusa('REBANHO_ATIVACAO_CORTE_ANTERIOR_AO_HISTORICO', 'há movimentação legada ativa depois da data de corte; escolha um corte igual ou posterior', { quantidade: hist.depois });
          for (const l of ativos) {
            const lin = await linhagemLegada(tx, auth.clienteId, empresaId, l, porId);
            if (lin.classe === 'derivado_rastreado') resumo.derivados_rastreados += 1;
            else if (lin.classe === 'derivado_sem_prova') resumo.derivados_sem_prova += 1;
            else if (lin.classe === 'nascimento_legado') resumo.nascimentos_legados += 1;
            else resumo.entradas += 1;
            const raiz = lin.raiz;
            const { posicao } = await posicaoDaIdentidade(tx, auth.clienteId, empresaId, l.area_atual_id, {
              ...l,
              origem: lin.origem,
              lote_entrada_id: lin.lote_entrada_id,
              nome: lin.lote_entrada_id ? raiz.nome : l.nome,
              numero_lote: lin.lote_entrada_id ? raiz.numero_lote : l.numero_lote,
              linhagem: [{ lote_id: lin.lote_entrada_id ?? l.id, nome: raiz.nome, numero_lote: raiz.numero_lote ?? null, classe: lin.classe, lote_legado_id: l.id }],
            });
            somar(dataCorte, posicao.id, l.quantidade_cabecas);
            if (pesoNum(l.peso_medio_kg) !== null) pesos.push({ posicao, dia: dataCorte, peso: pesoNum(l.peso_medio_kg), q: l.quantidade_cabecas });
          }
        } else {
          // Reconstrução pelas ENTRADAS: só quando o passado é exatamente as entradas.
          if (hist?.ativos) throw recusa('REBANHO_ATIVACAO_ENTRADAS_COM_HISTORICO', 'há movimentação legada ativa; cancele-a (ou use o reset de dados de teste) antes de reconstruir pelas entradas', { movimentacoes_ativas: hist.ativos });
          const problemas = [];
          for (const l of todos) {
            const vivo = l.status === 'Ativo' && l.quantidade_cabecas > 0;
            if (ehDerivado(l)) {
              if (vivo) problemas.push({ lote_id: l.id, motivo: 'lote_derivado_ativo' });
              continue;
            }
            if (!vivo) continue;
            if (l.quantidade_cabecas !== l.quantidade_entrada || (l.area_atual_id ?? null) !== (l.area_entrada_id ?? l.area_atual_id ?? null) || !l.data_entrada) {
              problemas.push({ lote_id: l.id, motivo: !l.data_entrada ? 'sem_data_de_entrada' : 'estado_diferente_da_entrada' });
            }
          }
          if (problemas.length) throw recusa('REBANHO_ATIVACAO_ENTRADAS_COM_HISTORICO', 'há lote cujo estado não é a própria entrada; use saldo de abertura ou o reset de dados de teste', { lotes: problemas });
          for (const l of ativos) {
            const dia = diaDoBanco(l.data_entrada);
            const { posicao } = await posicaoDaIdentidade(tx, auth.clienteId, empresaId, l.area_entrada_id ?? l.area_atual_id, {
              ...l,
              origem: ehNascimentoLegado(l) ? `nascimento-legado:${l.id}` : l.id,
              lote_entrada_id: l.id,
              linhagem: [{ lote_id: l.id, nome: l.nome, numero_lote: l.numero_lote ?? null, classe: 'entrada' }],
            });
            somar(dia, posicao.id, l.quantidade_entrada);
            resumo.entradas += 1;
            const p = pesoNum(l.peso_entrada_kg) ?? pesoNum(l.peso_medio_kg);
            if (p !== null) pesos.push({ posicao, dia, peso: p, q: l.quantidade_entrada });
            if (!dataCorteEfetiva || dia < dataCorteEfetiva) dataCorteEfetiva = dia;
          }
          dataCorteEfetiva = dataCorteEfetiva ?? new Date().toISOString().slice(0, 10);
        }

        await tx.rebanhoLedgerAtivacao.create({ data: { cliente_id: auth.clienteId, empresa_id: empresaId, data_corte: comoData(dataCorteEfetiva), modo, ativado_por_usuario_id: auth.usuarioId } });
        const tipo = modo === 'saldo_abertura' ? TIPOS_EVENTO.ABERTURA : TIPOS_EVENTO.ENTRADA;
        const eventos = [];
        let total = 0;
        for (const [dia, partidas] of [...partidasPorDia.entries()].sort()) {
          const evento = await criarEvento(tx, {
            clienteId: auth.clienteId, empresaId, tipo, dia, usuarioId: auth.usuarioId, operationKey: `${operationKey}:${dia}`,
            dados: { origem: modo === 'saldo_abertura' ? 'saldo_atual_do_modelo_legado' : 'entradas_do_cadastro', modo, ativacao: operationKey },
          });
          await inserirPartidas(tx, { clienteId: auth.clienteId, empresaId, eventoId: evento.id, dia, partidas: [...partidas.entries()].map(([posicao_id, delta]) => ({ posicao_id, delta })) });
          for (const w of pesos.filter((x) => x.dia === dia)) {
            // Várias linhas legadas na mesma posição: peso ponderado só se todas conhecidas.
            const ja = await pesoNaData(tx, auth.clienteId, w.posicao.id, dia);
            const s = ja === undefined ? 0 : await saldoNaData(tx, auth.clienteId, w.posicao.id, dia);
            const peso = ja === undefined ? w.peso : pesoPonderado(s - w.q, ja, w.q, w.peso);
            await registrarPeso(tx, { clienteId: auth.clienteId, empresaId, eventoId: evento.id, posicaoId: w.posicao.id, dia, peso });
          }
          eventos.push(evento.id);
          total += [...partidas.values()].reduce((t, x) => t + x, 0);
        }
        const posicaoIds = [...new Set([...partidasPorDia.values()].flatMap((m) => [...m.keys()]))];
        await reprojetar(tx, auth.clienteId, posicaoIds);
        await registrarEvento(contexto, { acao: 'create', entidade: 'RebanhoLedgerAtivacao', entidadeId: empresaId, dadosNovos: { empresa_id: empresaId, modo, data_corte: dataCorteEfetiva, posicoes: posicaoIds.length, total, eventos, ...resumo } }, tx);
        return { httpStatus: 201, body: { empresa_id: empresaId, modo, data_corte: dataCorteEfetiva, posicoes: posicaoIds.length, total_cabecas: total, eventos, ...resumo } };
      },
    });
  });
  return { status: r.httpStatus, body: { ...r.body, replay: r.replay } };
};

/**
 * Ordem de travas do ledger é ÁREA → LOTE/POSIÇÃO. A exclusão do cadastro trava
 * o Lote (FOR UPDATE); numa empresa ativada ela chama isto ANTES (deadlock 40P01
 * visto em teste: transferência segura a área e pede KEY SHARE no Lote).
 */
export const travarAreasDoLoteNoLedger = async (tx, clienteId, loteId) => {
  const lote = await tx.lote.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: loteId } }, select: { empresa_id: true } });
  if (!lote || !(await ativacaoDaEmpresa(tx, clienteId, lote.empresa_id))) return;
  const ps = await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, lote_entrada_id: loteId }, select: { area_id: true } });
  await travarAreas(tx, clienteId, lote.empresa_id, ps.map((p) => p.area_id));
};

// ─── Entrada (cadastro de lote numa empresa ativada) ───────────────────────

/** Cadastro de lote = ENTRADA no ledger, na mesma transação do INSERT do Lote. */
export const registrarEntradaSeAtivo = async (tx, contexto, lote) => {
  const auth = exigirAuthContext(contexto?.auth);
  const ativacao = await ativacaoDaEmpresa(tx, auth.clienteId, lote.empresa_id);
  if (!ativacao) return null;
  const quantidade = lote.quantidade_entrada ?? lote.quantidade_cabecas;
  const areaId = lote.area_entrada_id ?? lote.area_atual_id;
  if (!areaId) throw invalido('lote precisa de área de entrada no ledger', { field: 'area_entrada_id' });
  if (!lote.data_entrada) throw invalido('lote precisa de data de entrada no ledger', { field: 'data_entrada' });
  const dia = diaDoBanco(lote.data_entrada);
  exigirDiaNoLedger(ativacao, dia);
  if (!(quantidade > 0)) return null;
  await travarAreas(tx, auth.clienteId, lote.empresa_id, [areaId]);
  const evento = await criarEvento(tx, {
    clienteId: auth.clienteId, empresaId: lote.empresa_id, tipo: TIPOS_EVENTO.ENTRADA, dia, usuarioId: auth.usuarioId, operationKey: `entrada-${lote.id}`,
    dados: { lote_id: lote.id, quantidade, area_id: areaId },
  });
  const { posicao } = await posicaoDaIdentidade(tx, auth.clienteId, lote.empresa_id, areaId, {
    ...lote,
    origem: lote.id,
    lote_entrada_id: lote.id,
    linhagem: [{ lote_id: lote.id, nome: lote.nome, numero_lote: lote.numero_lote ?? null, classe: 'entrada' }],
  });
  await inserirPartidas(tx, { clienteId: auth.clienteId, empresaId: lote.empresa_id, eventoId: evento.id, dia, partidas: [{ posicao_id: posicao.id, delta: quantidade }] });
  const peso = pesoNum(lote.peso_entrada_kg) ?? pesoNum(lote.peso_medio_kg);
  if (peso !== null) await registrarPeso(tx, { clienteId: auth.clienteId, empresaId: lote.empresa_id, eventoId: evento.id, posicaoId: posicao.id, dia, peso });
  await validarEReprojetar(tx, auth.clienteId, [posicao.id], 'REBANHO_SALDO_HISTORICO_NEGATIVO', 'a entrada deixaria saldo negativo', (n) => n);
  await registrarEvento(contexto, { acao: 'create', entidade: 'EventoRebanho', entidadeId: evento.id, dadosNovos: { tipo: evento.tipo, lote_id: lote.id, posicao_id: posicao.id, quantidade, data_operacional: dia } }, tx);
  return { evento_id: evento.id, posicao_id: posicao.id };
};

/**
 * Exclusão do cadastro numa empresa ativada: só se as posições do lote não
 * têm NENHUM fato ativo além da própria entrada/abertura. Então a entrada é
 * cancelada (partidas e pesos inativos, posições zeradas) e o chamador marca
 * o tombstone. Histórico nunca é apagado.
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
  await tx.pesoRebanho.updateMany({ where: { cliente_id: auth.clienteId, posicao_id: { in: posicoes.map((p) => p.id) }, evento_id: { in: eventoIds } }, data: { ativa: false } });
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

/**
 * Núcleo da transferência, dentro da transação/idempotência do chamador
 * (comando novo ou o `manejo-lote` legado numa empresa ativada).
 */
export const executarTransferencia = async (tx, contexto, e) => {
  const auth = exigirAuthContext(contexto?.auth);
  const ativacao = await ativacaoDaEmpresa(tx, auth.clienteId, e.empresaId);
  if (!ativacao) throw recusa('REBANHO_LEDGER_INATIVO', 'o ledger de posições não está ativo nesta empresa');
  exigirDiaNoLedger(ativacao, e.dia);
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
  const origens = await travarPosicoes(tx, auth.clienteId, e.itens.map((i) => i.posicao_id));
  for (const it of e.itens) {
    const o = origens.get(it.posicao_id);
    if (!o || o.empresa_id !== e.empresaId) throw new AppError('POSICAO_REBANHO_NOT_FOUND', 'posição não encontrada nesta empresa', { details: { posicao_id: it.posicao_id } });
    if (o.area_id === e.areaDestinoId) throw recusa('REBANHO_DESTINO_IGUAL_ORIGEM', 'a área de destino é a mesma da origem', { posicao_id: o.id });
  }
  ponto('apos_validar');

  // Destino de cada item: mesma identidade (origem + classificação) na área de destino.
  const destinos = new Map();
  for (const it of e.itens) {
    const { posicao } = await posicaoDaIdentidade(tx, auth.clienteId, e.empresaId, e.areaDestinoId, moldeDe(origens.get(it.posicao_id)));
    destinos.set(it.posicao_id, posicao.id);
  }
  const todas = await travarPosicoes(tx, auth.clienteId, [...e.itens.map((i) => i.posicao_id), ...destinos.values()]);
  const antes = new Map(todas);

  const evento = await criarEvento(tx, {
    clienteId: auth.clienteId, empresaId: e.empresaId, tipo: TIPOS_EVENTO.TRANSFERENCIA, dia: e.dia, usuarioId: auth.usuarioId, operationKey: e.operationKey,
    dados: {
      area_destino_id: destino.id,
      area_destino_nome: destino.nome,
      ...(e.observacoes ? { observacoes: e.observacoes } : {}),
      itens: e.itens.map((it) => {
        const o = todas.get(it.posicao_id);
        return {
          origem_posicao_id: o.id, destino_posicao_id: destinos.get(it.posicao_id), quantidade: it.quantidade,
          area_origem_id: o.area_id, area_origem_nome: areas.get(o.area_id)?.nome ?? null,
          lote_entrada_id: o.lote_entrada_id, nome: o.nome, categoria: o.categoria, sexo: o.sexo,
        };
      }),
    },
  });
  ponto('apos_evento');
  // Peso no destino NA DATA do fato (PR174-R2): uma observação por destino,
  // pela função única de peso derivado (a mesma que reconfere depois).
  for (const p of todas.values()) await garantirPesoBase(tx, auth.clienteId, p);
  const entradasPorDestino = new Map();
  for (const it of e.itens) {
    const d = destinos.get(it.posicao_id);
    if (!entradasPorDestino.has(d)) entradasPorDestino.set(d, []);
    entradasPorDestino.get(d).push({ q: it.quantidade, posicao_id: it.posicao_id, peso_informado: null });
  }
  await registrarPesosDerivados(tx, { clienteId: auth.clienteId, empresaId: e.empresaId, evento, dia: e.dia, destinos: entradasPorDestino });
  let n = 0;
  for (const it of e.itens) {
    await inserirPartidas(tx, {
      clienteId: auth.clienteId, empresaId: e.empresaId, eventoId: evento.id, dia: e.dia,
      partidas: [{ posicao_id: it.posicao_id, delta: -it.quantidade }, { posicao_id: destinos.get(it.posicao_id), delta: it.quantidade }],
    });
    n += 1;
    if (n === 1) ponto('apos_primeira_partida');
  }
  const envolvidas = [...todas.keys()];
  await validarEReprojetar(tx, auth.clienteId, envolvidas, 'REBANHO_SALDO_HISTORICO_NEGATIVO', 'a transferência deixaria saldo negativo numa data; nada foi gravado',
    detalheSaldo(todas, areas, new Map(e.itens.map((it) => [it.posicao_id, it.quantidade])), e.dia));
  await verificarDependenciasTemporais(tx, auth.clienteId, [...todas.keys()], e.dia, { exceto: evento.id });
  ponto('apos_segunda_posicao');

  const primeira = todas.get(e.itens[0].posicao_id);
  const total = e.itens.reduce((t, it) => t + it.quantidade, 0);
  const mov = await criarPonteMovimentacao(tx, contexto, {
    clienteId: auth.clienteId, empresaId: e.empresaId, evento, operationKey: e.operationKey, usuarioId: auth.usuarioId,
    dados: {
      tipo: 'Transferência de Área',
      lote: primeira.nome,
      lote_id: primeira.lote_entrada_id ?? primeira.id,
      lote_ids: idsCitados([...todas.values()]),
      quantidade_animais: total,
      data_movimentacao: e.data,
      area_origem_id: primeira.area_id,
      area_origem_nome: areas.get(primeira.area_id)?.nome ?? null,
      area_destino_id: destino.id,
      area_destino_nome: destino.nome,
      categoria_animal: [...new Set(e.itens.map((it) => todas.get(it.posicao_id).categoria).filter(Boolean))].join(', ') || null,
      linhas: evento.dados.itens,
      ...(e.observacoes ? { observacoes: e.observacoes } : {}),
    },
  });
  ponto('antes_auditoria');
  const depois = await auditarPosicoes(contexto, tx, auth.clienteId, envolvidas, antes);
  return {
    httpStatus: 201,
    body: {
      evento: { id: evento.id, tipo: evento.tipo, data_operacional: e.dia, registrado_em: evento.registrado_em.toISOString() },
      movimentacao: documentoComoPublico(mov),
      posicoes: [...depois.values()].map((p) => comoPosicaoPublica(p, areas.get(p.area_id)?.nome ?? null)),
      lotes: [...depois.values()].map((p) => comoPosicaoPublica(p, areas.get(p.area_id)?.nome ?? null)),
    },
  };
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
        return executarTransferencia(tx, contexto, e);
      },
    })
  );
  return { status: r.httpStatus, body: { ...r.body, replay: r.replay } };
};

// ─── Cancelamento (chamado pelo endpoint único de cancelamento) ─────────────

/** Movimento do mapa gravado pelo ledger? */
export const ehMovimentoDoLedger = (mov) => mov?.dados?.efeito_servidor?.comando === COMANDO_LEDGER;

/**
 * Numa empresa ATIVADA, movimento legado (anterior ao ledger) não é desfeito
 * pelo caminho antigo — mexeria em `Lote` e abriria duas verdades (drift
 * reproduzido no RED B). O histórico continua consultável; a correção é um
 * fato novo no ledger.
 */
export const exigirCancelamentoLegadoPermitido = async (tx, clienteId, mov) => {
  if (ehMovimentoDoLedger(mov)) return;
  if (await ativacaoDaEmpresa(tx, clienteId, mov.empresa_id)) {
    throw recusa(
      'REBANHO_LEDGER_CANCELAMENTO_LEGADO',
      'esta empresa usa o ledger de posições: movimentos anteriores à ativação ficam no histórico e não são desfeitos pelo modelo antigo; registre a correção como um novo manejo',
      { movimentacao_id: mov.id }
    );
  }
};

/**
 * Cancela o EVENTO do ledger ligado ao movimento (qualquer manejo): desativa
 * partidas e pesos, revalida a linha do tempo de todas as posições tocadas (um
 * fato posterior que dependia destas cabeças bloqueia: 409 com a data) e
 * reprojeta. Junção: as contribuições de linhagem deste evento saem da
 * composição. O original fica, marcado `cancelado`.
 */
export const cancelarMovimentoDoLedger = async (tx, contexto, mov, motivo, operationKey) => {
  const auth = exigirAuthContext(contexto?.auth);
  const eventoId = mov.dados.efeito_servidor.evento_id;
  const evento = await tx.eventoRebanho.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: String(eventoId) } } });
  if (!evento || evento.movimentacao_id !== mov.id || evento.empresa_id !== mov.empresa_id || !TIPOS_CANCELAVEIS.includes(evento.tipo)) {
    throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'o evento do ledger não confere com este movimento');
  }
  const operacao = await tx.operacaoIdempotente.findFirst({ where: { cliente_id: auth.clienteId, operation_key: evento.operation_id, status: 'committed' } });
  if (!operacao) throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'a operação que gerou o evento não foi confirmada');
  if (evento.situacao === 'cancelado') throw recusa('CANCELAMENTO_JA_REALIZADO', 'a movimentação já está cancelada');
  const partidas = await tx.partidaRebanho.findMany({ where: { cliente_id: auth.clienteId, evento_id: evento.id } });
  const pesos = await tx.pesoRebanho.findMany({ where: { cliente_id: auth.clienteId, evento_id: evento.id }, select: { posicao_id: true } });
  const ids = [...new Set([...partidas.map((p) => p.posicao_id), ...pesos.map((p) => p.posicao_id)])];
  const previas = await tx.posicaoRebanho.findMany({ where: { cliente_id: auth.clienteId, id: { in: ids } }, select: { area_id: true } });
  const areas = await travarAreas(tx, auth.clienteId, evento.empresa_id, previas.map((p) => p.area_id));
  const antes = await travarPosicoes(tx, auth.clienteId, ids);
  await tx.partidaRebanho.updateMany({ where: { cliente_id: auth.clienteId, evento_id: evento.id }, data: { ativa: false } });
  await tx.pesoRebanho.updateMany({ where: { cliente_id: auth.clienteId, evento_id: evento.id }, data: { ativa: false } });
  if (evento.tipo === TIPOS_EVENTO.JUNCAO) {
    for (const p of antes.values()) {
      const lin = Array.isArray(p.linhagem) ? p.linhagem : [];
      const restante = lin.filter((x) => x?.evento_id !== evento.id);
      if (restante.length !== lin.length) await tx.posicaoRebanho.update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: p.id } }, data: { linhagem: restante } });
    }
  }
  await validarEReprojetar(tx, auth.clienteId, ids, 'CANCELAMENTO_SALDO_HISTORICO_NEGATIVO',
    'cancelar esta movimentação deixaria saldo negativo numa data (um fato posterior usa estas cabeças); cancele o posterior antes', (neg) => {
      const p = antes.get(neg.posicao_id);
      return { data: neg.dia, area_id: p?.area_id ?? null, area_nome: areas.get(p?.area_id)?.nome ?? null, posicao_id: neg.posicao_id, nome: p?.nome ?? null, saldo_resultante: neg.saldo };
    });
  // PR174-R2: o peso de um fato posterior que dependia deste não pode ficar "órfão".
  await verificarDependenciasTemporais(tx, auth.clienteId, ids, diaDoBanco(evento.data_operacional), { exceto: evento.id });
  const agora = new Date();
  await tx.eventoRebanho.update({
    where: { cliente_id_id: { cliente_id: auth.clienteId, id: evento.id } },
    data: { situacao: 'cancelado', cancelado_em: agora, cancelado_por_usuario_id: auth.usuarioId, motivo_cancelamento: motivo },
  });
  const depois = await auditarPosicoes(contexto, tx, auth.clienteId, ids, antes);
  const efeitos = partidas.map((p) => ({ posicao_id: p.posicao_id, delta_desfeito: -p.delta, depois: depois.get(p.posicao_id)?.quantidade_cabecas ?? null }));
  return { efeitos, cancelamento: { em: agora.toISOString(), por_usuario_id: auth.usuarioId, motivo, operation_id: operationKey, modo: 'ledger', evento_tipo: evento.tipo, efeitos } };
};

// ─── Leituras ──────────────────────────────────────────────────────────────

/** Posições atuais da empresa (o mapa lê daqui quando o ledger está ativo). */
export const listarPosicoes = async (contexto, { empresa_id: empresaId, incluir_vazias: incluirVazias }) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const ativacao = await ativacaoDaEmpresa(prisma, auth.clienteId, empresaId);
  if (!ativacao) return { ativo: false, modo: null, data_corte: null, itens: [] };
  const ps = await prisma.posicaoRebanho.findMany({
    where: { cliente_id: auth.clienteId, empresa_id: empresaId, ...(incluirVazias === 'true' ? {} : { quantidade_cabecas: { gt: 0 } }) },
    include: { area: { select: { nome: true } }, loteEntrada: { select: { raca_predominante: true, sistema_produtivo: true, data_entrada: true } } },
    orderBy: [{ area_id: 'asc' }, { numero_lote: 'asc' }, { id: 'asc' }],
  });
  return { ativo: true, modo: ativacao.modo, data_corte: diaDoBanco(ativacao.data_corte), itens: ps.map((p) => comoPosicaoPublica(p)) };
};

/** Saldo e peso em uma data (fim do dia) por posição, a partir das partidas e pesos ativos. */
export const saldosNaData = async (contexto, { empresa_id: empresaId, data, area_id: areaId }) => {
  const auth = exigirAuthContext(contexto?.auth);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data ?? '')) || !dataOperacionalValida(data)) throw invalido('data deve ser AAAA-MM-DD de calendário real', { field: 'data' });
  const prisma = getPrismaClient();
  if (!(await ativacaoDaEmpresa(prisma, auth.clienteId, empresaId))) throw recusa('REBANHO_LEDGER_INATIVO', 'o ledger de posições não está ativo nesta empresa');
  const linhas = /** @type {Array<{posicao_id: string, area_id: string, area_nome: string, nome: string, categoria: string|null, sexo: string|null, lote_entrada_id: string|null, saldo: number, peso: any}>} */ (
    await prisma.$queryRaw`
      SELECT p.id AS posicao_id, p.area_id, a.nome AS area_nome, p.nome, p.categoria, p.sexo, p.lote_entrada_id,
             COALESCE((SELECT SUM(x.delta) FROM "PartidaRebanho" x WHERE x.cliente_id = p.cliente_id AND x.posicao_id = p.id AND x.ativa AND x.data_operacional <= ${data}::date), 0)::int AS saldo,
             (SELECT w.peso_medio_kg FROM "PesoRebanho" w WHERE w.cliente_id = p.cliente_id AND w.posicao_id = p.id AND w.ativa AND w.data_operacional <= ${data}::date
               ORDER BY w.data_operacional DESC, w."createdAt" DESC, w.id DESC LIMIT 1) AS peso
        FROM "PosicaoRebanho" p
        JOIN "AreaPastagem" a ON a.cliente_id = p.cliente_id AND a.id = p.area_id
       WHERE p.cliente_id = ${auth.clienteId} AND p.empresa_id = ${empresaId}
         ${areaId ? Prisma.sql`AND p.area_id = ${areaId}` : Prisma.empty}
       ORDER BY p.area_id, p.id`
  );
  const comSaldo = linhas.filter((l) => l.saldo !== 0).map((l) => ({ ...l, peso_medio_kg: pesoNum(l.peso), peso: undefined }));
  const porArea = {};
  for (const l of comSaldo) porArea[l.area_id] = { area_id: l.area_id, area_nome: l.area_nome, total: (porArea[l.area_id]?.total ?? 0) + l.saldo };
  return { data, posicoes: comSaldo, areas: Object.values(porArea), total: comSaldo.reduce((t, l) => t + l.saldo, 0) };
};

/**
 * Reconciliação read-only: projeção × partidas, fins de dia negativos, peso
 * projetado × última observação, e conservação (entradas + nascimentos −
 * mortes/abates = saldo total) e pré-condições de fatos sem delta (R3).
 */
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
  const pesosDivergentes = /** @type {Array<{posicao_id: string}>} */ (
    await prisma.$queryRaw`
      SELECT p.id AS posicao_id FROM "PosicaoRebanho" p
       WHERE p.cliente_id = ${auth.clienteId} AND p.empresa_id = ${empresaId}
         AND EXISTS (SELECT 1 FROM "PesoRebanho" w WHERE w.cliente_id = p.cliente_id AND w.posicao_id = p.id)
         AND p.peso_medio_kg IS DISTINCT FROM (SELECT w.peso_medio_kg FROM "PesoRebanho" w JOIN "EventoRebanho" ev ON ev.cliente_id = w.cliente_id AND ev.id = w.evento_id
                                                WHERE w.cliente_id = p.cliente_id AND w.posicao_id = p.id AND w.ativa
                                               ORDER BY w.data_operacional DESC, ev.registrado_em DESC, ev.id DESC, w."createdAt" DESC, w.id DESC LIMIT 1)`
  );
  const [conservacao] = /** @type {Array<{entradas: number, nascimentos: number, saidas: number, internos: number, saldo: number}>} */ (
    await prisma.$queryRaw`
      SELECT COALESCE(SUM(x.delta) FILTER (WHERE e.tipo IN ('SALDO_ABERTURA','ENTRADA')), 0)::int AS entradas,
             COALESCE(SUM(x.delta) FILTER (WHERE e.tipo = 'NASCIMENTO'), 0)::int AS nascimentos,
             COALESCE(SUM(x.delta) FILTER (WHERE e.tipo IN ('MORTE','ABATE')), 0)::int AS saidas,
             COALESCE(SUM(x.delta) FILTER (WHERE e.tipo IN ('TRANSFERENCIA','MUDANCA_CATEGORIA','JUNCAO','PESAGEM')), 0)::int AS internos,
             COALESCE(SUM(x.delta), 0)::int AS saldo
        FROM "PartidaRebanho" x JOIN "EventoRebanho" e ON e.cliente_id = x.cliente_id AND e.id = x.evento_id
       WHERE x.cliente_id = ${auth.clienteId} AND x.empresa_id = ${empresaId} AND x.ativa`
  );
  const ids = (await prisma.posicaoRebanho.findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresaId }, select: { id: true } })).map((p) => p.id);
  const negativos = await primeirosSaldosNegativos(prisma, auth.clienteId, ids);
  const precondicoesVioladas = await violacoesDePrecondicao(prisma, auth.clienteId, { empresaId, limite: 100 });
  const conserva = !!conservacao && conservacao.internos === 0 && conservacao.entradas + conservacao.nascimentos + conservacao.saidas === conservacao.saldo;
  return {
    posicoes: ids.length,
    divergentes,
    pesos_divergentes: pesosDivergentes,
    negativos: negativos.map((n) => ({ ...n, dia: diaDoBanco(n.dia) })),
    conservacao: { ...conservacao, conserva },
    // PR174-R3: fatos sem delta (pesagem/nascimento) cuja pré-condição não vale mais na data deles.
    precondicoes_violadas: precondicoesVioladas,
    integro: !divergentes.length && !negativos.length && !pesosDivergentes.length && conserva && !precondicoesVioladas.length,
  };
};
