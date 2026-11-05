/**
 * R1 — Correção atômica da ENTRADA ORIGINAL do Cadastro de Lotes.
 *
 * O Cadastro de Lotes é a entrada no rebanho. Corrigir quantidade, peso de
 * entrada, data, categoria, categoria de manejo, sexo, setor ou área de entrada
 * só é permitido enquanto NADA dependente existe depois da entrada. A correção
 * não é uma nova entrada nem uma movimentação: reescreve, numa transação, o
 * mesmo fato (Lote + EventoRebanho ENTRADA + PartidaRebanho + PesoRebanho +
 * PosicaoRebanho), preservando ids, com auditoria antes/depois e motivo.
 *
 * Elegibilidade, decidida no BANCO com o lote travado (nunca pelo navegador):
 *  - lote não excluído, origem de ENTRADA (não gerado por manejo);
 *  - nenhum registro de outro módulo (suplementação, sanidade, medicamento,
 *    manejo técnico, movimentação pecuária, tarefa), nem legado por nome;
 *  - nenhuma movimentação do mapa que o cite — ATIVA ou CANCELADA (a cancelada
 *    carrega a referência e o histórico; corrigir por baixo dela mudaria o que
 *    ela documenta);
 *  - lote no retrato exato da entrada e toda auditoria explicada (ida e volta
 *    de saldo não passa: "saldo igual ao da entrada" não prova ausência de manejo);
 *  - no ledger: exatamente UMA posição da linhagem, cujas partidas e pesos —
 *    ativos OU inativos — são todos do evento ENTRADA próprio deste lote, e
 *    nenhuma tarefa ou movimentação cita a posição.
 *
 * Fail-closed explícito (recusa com motivo, sem suporte parcial):
 *  - entrada que veio da ATIVAÇÃO (evento agregado do modo `entradas`, ou
 *    SALDO_ABERTURA do modo `saldo_abertura`): o evento cobre vários lotes;
 *    reescrever a data/quantidade dele como se fosse de um lote só não é seguro;
 *  - mais de uma posição da linhagem (lote já dividido/derivado).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError, loteNotFound, setorNotFound, areaNotFound } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { buscarLote, atualizarLotePorId } from './loteRepository.js';
import { camposDe } from './loteService.js';
import { origemDerivadaDeManejo } from './loteOrigem.js';
import { noEstadoDeEntrada, movimentosQueCitam, temLegadoPorNome, outraFonteVinculada, auditoriaExplicada } from './loteExclusaoService.js';
import { TIPOS_EVENTO, ativacaoDaEmpresa, travarAreas, dataOperacionalValida, comoData, diaDoBanco, peso4, pesoNum, ponto } from '../rebanhoLedger/rebanhoLedgerNucleo.js';
import { corrigirEntradaNoLedger } from '../rebanhoLedger/rebanhoLedgerCorrecaoEntrada.js';

export const TIPO_OPERACAO_CORRECAO_ENTRADA = 'correcao_entrada_lote';
/** Campos da ENTRADA que mexem no ledger (fato, partida, peso, posição). */
export const CAMPOS_OPERACIONAIS_DA_ENTRADA = Object.freeze([
  'quantidade', 'peso_entrada_kg', 'data_entrada', 'categoria', 'categoria_manejo_id', 'sexo', 'setor_id', 'area_entrada_id',
]);
/**
 * R1-R2: campos ADMINISTRATIVOS do lançamento da entrada, já existentes no
 * modelo e no formulário — gravados no MESMO comando e na MESMA transação.
 * Nunca: saldo/posição calculados, status, área atual, tenant, usuário, número.
 */
export const CAMPOS_ADMINISTRATIVOS_DA_ENTRADA = Object.freeze([
  'nome', 'identificador_nome', 'identificador_sigla', 'identificador_cor', 'raca_predominante', 'sistema_produtivo',
  'idade_media_meses', 'observacoes', 'motivo_entrada', 'motivo_ajuste', 'motivo_outros', 'origem', 'fornecedor_id',
  'fornecedor_nome', 'nota_fiscal', 'chave_nfe', 'numero_gta', 'cidade_origem', 'estado_origem', 'valor_total_compra',
  'valor_por_cabeca', 'valor_frete', 'campos_personalizados',
]);
export const CAMPOS_CORRIGIVEIS = Object.freeze([...CAMPOS_OPERACIONAIS_DA_ENTRADA, ...CAMPOS_ADMINISTRATIVOS_DA_ENTRADA]);
/** Exibição do cadastro que acompanha a posição PRÓPRIA da entrada (mesma regra do PATCH). */
const CAMPOS_DE_EXIBICAO_DA_POSICAO = Object.freeze(['nome', 'identificador_nome', 'identificador_sigla', 'identificador_cor']);
const SEXOS = ['Macho', 'Fêmea', 'Misto'];

const bloqueio = (motivo, detalhes = {}) => ({ elegivel: false, motivo, detalhes });

const invalido = (mensagem, details = {}) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details });

/** Evento é da ATIVAÇÃO (agregado/abertura), não a entrada própria do lote. */
/** @param {any} ev */
const eventoDaAtivacao = (ev) => ev.tipo === TIPOS_EVENTO.ABERTURA || (ev.tipo === TIPOS_EVENTO.ENTRADA && !ev.dados?.lote_id);

/**
 * Dependências da entrada no ledger. Devolve bloqueio ou o retrato do fato.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
const avaliarNoLedger = async (tx, clienteId, lote) => {
  const posicoes = await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, lote_entrada_id: lote.id } });
  if (posicoes.length === 0) return { bloqueio: bloqueio('entrada_sem_posicao_no_ledger') };
  if (posicoes.length > 1) return { bloqueio: bloqueio('posicoes_derivadas', { posicoes: posicoes.length }) };
  const [posicao] = posicoes;
  const partidas = await tx.partidaRebanho.findMany({ where: { cliente_id: clienteId, posicao_id: posicao.id }, include: { evento: true } });
  const pesos = await tx.pesoRebanho.findMany({ where: { cliente_id: clienteId, posicao_id: posicao.id }, include: { evento: true } });
  const eventos = new Map([...partidas, ...pesos].map((x) => [x.evento.id, x.evento]));
  for (const ev of eventos.values()) {
    if (eventoDaAtivacao(ev)) return { bloqueio: bloqueio('entrada_por_ativacao_agregada', { evento_id: ev.id, tipo: ev.tipo }) };
  }
  /** @type {any[]} */
  const listaEventos = [...eventos.values()];
  const proprios = listaEventos.filter((ev) => ev.tipo === TIPOS_EVENTO.ENTRADA && ev.dados?.lote_id === lote.id);
  const alheio = listaEventos.find((ev) => !(ev.tipo === TIPOS_EVENTO.ENTRADA && ev.dados?.lote_id === lote.id));
  if (alheio) return { bloqueio: bloqueio('evento_posterior', { evento_id: alheio.id, tipo: alheio.tipo, situacao: alheio.situacao }) };
  if (proprios.length !== 1) return { bloqueio: bloqueio('entrada_ambigua_no_ledger', { eventos: proprios.length }) };
  const [evento] = proprios;
  if (evento.situacao !== 'ativo') return { bloqueio: bloqueio('entrada_cancelada', { evento_id: evento.id }) };
  // O evento da entrada só pode ter a partida desta posição.
  const partidasDoEvento = await tx.partidaRebanho.count({ where: { cliente_id: clienteId, evento_id: evento.id } });
  if (partidasDoEvento !== 1 || partidas.length !== 1 || !partidas[0].ativa) {
    return { bloqueio: bloqueio('entrada_ambigua_no_ledger', { partidas: partidasDoEvento }) };
  }
  const tarefas = await tx.lancamentoTarefa.count({ where: { cliente_id: clienteId, posicao_id: posicao.id } });
  if (tarefas) return { bloqueio: bloqueio('lancamentos_tarefa', { posicao_id: posicao.id }) };
  const movsDaPosicao = await movimentosQueCitam(tx, clienteId, posicao.id);
  if (movsDaPosicao.length) return { bloqueio: bloqueio('movimentacao_da_posicao', { movimentacao_id: movsDaPosicao[0].id }) };
  return { fato: { posicao, evento, partida: partidas[0], pesos } };
};

/**
 * Elegibilidade da correção da entrada. Chamar dentro da transação, com o lote
 * relido (a correção chama com o lote travado; a consulta só lê).
 * @returns {Promise<{elegivel: boolean, motivo: string|null, detalhes: Record<string, unknown>, ledger?: boolean, ativacao?: any, fato?: any}>}
 */
export const avaliarCorrecaoEntrada = async (tx, clienteId, lote) => {
  if (lote.excluido_em) return bloqueio('lote_excluido');
  if (origemDerivadaDeManejo(lote.origem)) return bloqueio('lote_gerado_por_manejo');
  const outra = await outraFonteVinculada(tx, clienteId, lote.id);
  if (outra) return bloqueio(outra);
  const legado = await temLegadoPorNome(tx, clienteId, lote);
  if (legado) return bloqueio('vinculo_legado_por_nome', { fonte: legado });
  const movimentos = await movimentosQueCitam(tx, clienteId, lote.id);
  if (movimentos.length) {
    const ativo = movimentos.find((m) => m.situacao !== 'cancelado');
    return ativo ? bloqueio('movimentacao_ativa', { movimentacao_id: ativo.id }) : bloqueio('movimentacao_cancelada', { movimentacao_id: movimentos[0].id });
  }
  if (!noEstadoDeEntrada(lote)) return bloqueio('estado_divergente_da_entrada');
  const auditoria = await auditoriaExplicada(tx, clienteId, lote.id, new Set());
  if (!auditoria.ok) return bloqueio('alteracao_sem_comprovacao', { auditoria_id: auditoria.auditoria_id });
  const ativacao = await ativacaoDaEmpresa(tx, clienteId, lote.empresa_id);
  if (!ativacao) return { elegivel: true, motivo: null, detalhes: {}, ledger: false };
  const r = await avaliarNoLedger(tx, clienteId, lote);
  if (r.bloqueio) return r.bloqueio;
  return { elegivel: true, motivo: null, detalhes: { modo_ativacao: ativacao.modo }, ledger: true, ativacao, fato: r.fato };
};

/** Consulta de elegibilidade (só leitura; nunca autoriza sozinha). */
export const elegibilidadeCorrecaoEntrada = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  return getPrismaClient().$transaction(async (tx) => {
    const lote = await buscarLote(auth.clienteId, id, tx);
    if (!lote) throw loteNotFound();
    const r = await avaliarCorrecaoEntrada(tx, auth.clienteId, lote);
    return {
      lote_id: id,
      elegivel: r.elegivel,
      motivo: r.motivo,
      detalhes: r.detalhes,
      campos: r.elegivel ? CAMPOS_CORRIGIVEIS : [],
      updated_date: lote.updatedAt instanceof Date ? lote.updatedAt.toISOString() : lote.updatedAt,
    };
  });
};

const textoOuNulo = (v) => (typeof v === 'string' ? v.trim() || null : v === null ? null : undefined);

/** Valida e normaliza o corpo. Nunca aceita tenant, usuário ou saldo calculado. */
export const lerCorrecaoEntrada = (corpo) => {
  const operationKey = typeof corpo?.operation_id === 'string' ? corpo.operation_id.trim() : '';
  if (!operationKey) throw invalido('operation_id é obrigatório', { field: 'operation_id' });
  const motivo = typeof corpo?.motivo === 'string' ? corpo.motivo.trim() : '';
  if (!motivo) throw invalido('motivo da correção é obrigatório', { field: 'motivo' });
  const esperado = corpo?.estado_esperado?.updated_date;
  if (typeof esperado !== 'string' || !esperado) throw invalido('estado_esperado.updated_date é obrigatório', { field: 'estado_esperado.updated_date' });
  const c = corpo?.campos;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw invalido('campos é obrigatório', { field: 'campos' });
  /** @type {Record<string, any>} */
  const campos = {};
  if ('quantidade' in c) {
    if (!Number.isInteger(c.quantidade) || c.quantidade <= 0) throw invalido('quantidade deve ser inteiro positivo', { field: 'campos.quantidade' });
    campos.quantidade = c.quantidade;
  }
  if ('peso_entrada_kg' in c) {
    if (c.peso_entrada_kg !== null && !(typeof c.peso_entrada_kg === 'number' && Number.isFinite(c.peso_entrada_kg) && c.peso_entrada_kg > 0)) {
      throw invalido('peso_entrada_kg deve ser número positivo ou null', { field: 'campos.peso_entrada_kg' });
    }
    campos.peso_entrada_kg = c.peso_entrada_kg === null ? null : peso4(c.peso_entrada_kg);
  }
  if ('data_entrada' in c) {
    if (typeof c.data_entrada !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.data_entrada) || !dataOperacionalValida(c.data_entrada)) {
      throw invalido('data_entrada deve ser AAAA-MM-DD de calendário real', { field: 'campos.data_entrada' });
    }
    campos.data_entrada = c.data_entrada;
  }
  for (const k of ['categoria', 'categoria_manejo_id', 'setor_id', 'area_entrada_id']) {
    if (k in c) {
      const v = textoOuNulo(c[k]);
      if (v === undefined) throw invalido(`${k} deve ser texto ou null`, { field: `campos.${k}` });
      campos[k] = v;
    }
  }
  if ('sexo' in c) {
    if (c.sexo !== null && !SEXOS.includes(c.sexo)) throw invalido('sexo inválido', { field: 'campos.sexo' });
    campos.sexo = c.sexo;
  }
  const desconhecidos = Object.keys(c).filter((k) => !CAMPOS_CORRIGIVEIS.includes(k));
  if (desconhecidos.length) throw invalido('campo não corrigível por este comando', { campos: desconhecidos });
  // Administrativos: mesma normalização do cadastro (texto aparado, número, inteiro).
  const brutosAdm = Object.fromEntries(Object.entries(c).filter(([k]) => CAMPOS_ADMINISTRATIVOS_DA_ENTRADA.includes(k)));
  const administrativos = camposDe(brutosAdm);
  if ('nome' in brutosAdm && !administrativos.nome) throw invalido('nome não pode ficar vazio', { field: 'campos.nome' });
  if ('motivo_entrada' in brutosAdm && !administrativos.motivo_entrada) throw invalido('motivo_entrada não pode ficar vazio', { field: 'campos.motivo_entrada' });
  if ('origem' in administrativos && origemDerivadaDeManejo(administrativos.origem)) {
    throw invalido('a origem da entrada não pode virar origem de manejo', { field: 'campos.origem', reason: 'classe_de_origem_imutavel' });
  }
  if (!Object.keys(campos).length && !Object.keys(administrativos).length) throw invalido('nenhum campo para corrigir', { field: 'campos' });
  return { operationKey, motivo, esperado, campos, administrativos };
};

const isoDe = (d) => (d instanceof Date ? d.toISOString() : String(d));

/**
 * Corrige a entrada original. Uma transação: trava (área → lote → posição),
 * relê, compare-and-swap, reavalia a elegibilidade e reescreve o MESMO fato.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {(lote: any) => any} comoLotePublico
 */
export const corrigirEntradaLote = async (contexto, id, corpo, comoLotePublico) => {
  const auth = exigirAuthContext(contexto?.auth);
  const e = lerCorrecaoEntrada(corpo);
  const fingerprint = fingerprintDePayload({ id, campos: e.campos, administrativos: e.administrativos, motivo: e.motivo, esperado: e.esperado });
  const r = await getPrismaClient().$transaction(async (tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey: e.operationKey,
      tipoOperacao: TIPO_OPERACAO_CORRECAO_ENTRADA,
      fingerprint,
      executar: () => executarCorrecao(tx, contexto, id, e, comoLotePublico),
    })
  );
  return { status: r.httpStatus, body: { ...r.body, replay: r.replay === true } };
};

const executarCorrecao = async (tx, contexto, id, e, comoLotePublico) => {
  const auth = exigirAuthContext(contexto?.auth);
  const clienteId = auth.clienteId;
  // Leitura sem trava só para saber empresa e áreas; trava na ordem área → lote → posição.
  const previa = await buscarLote(clienteId, id, tx);
  if (!previa) throw loteNotFound();
  const ativacaoPrevia = await ativacaoDaEmpresa(tx, clienteId, previa.empresa_id);
  if (ativacaoPrevia) {
    const posicoesPrevias = await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, lote_entrada_id: id }, select: { area_id: true } });
    await travarAreas(tx, clienteId, previa.empresa_id, [previa.area_entrada_id, previa.area_atual_id, e.campos.area_entrada_id, ...posicoesPrevias.map((p) => p.area_id)]);
  }
  await tx.$queryRaw`SELECT id FROM "Lote" WHERE cliente_id = ${clienteId} AND id = ${id} FOR NO KEY UPDATE`;
  const lote = await buscarLote(clienteId, id, tx);
  if (!lote || lote.excluido_em) throw loteNotFound();
  if (isoDe(lote.updatedAt) !== e.esperado) {
    throw new AppError('LOTE_ESTADO_CONFLITO', 'o lote mudou desde a leitura; recarregue e refaça', {
      details: { campos: ['updated_date'], atual: { updated_date: isoDe(lote.updatedAt) } },
    });
  }
  const avaliacao = await avaliarCorrecaoEntrada(tx, clienteId, lote);
  if (!avaliacao.elegivel) {
    throw new AppError('LOTE_CORRECAO_ENTRADA_BLOQUEADA', 'a entrada não pode ser corrigida: existe registro dependente', {
      details: { id, motivo: avaliacao.motivo, ...avaliacao.detalhes },
    });
  }

  // Valores finais (o que não veio fica como está).
  const c = e.campos;
  const novo = {
    quantidade: c.quantidade ?? lote.quantidade_entrada,
    peso: 'peso_entrada_kg' in c ? c.peso_entrada_kg : pesoNum(lote.peso_entrada_kg),
    dia: c.data_entrada ?? (lote.data_entrada ? diaDoBanco(lote.data_entrada) : null),
    categoria: 'categoria' in c ? c.categoria : lote.categoria_entrada ?? lote.categoria ?? null,
    categoriaManejoId: 'categoria_manejo_id' in c ? c.categoria_manejo_id : lote.categoria_manejo_entrada_id ?? lote.categoria_manejo_id ?? null,
    sexo: 'sexo' in c ? c.sexo : lote.sexo ?? null,
    setorId: 'setor_id' in c ? c.setor_id : lote.setor_id ?? null,
    areaId: 'area_entrada_id' in c ? c.area_entrada_id : lote.area_entrada_id ?? null,
  };

  // Referências: mesmo tenant e mesma empresa do lote.
  let categoriaManejoNome = null;
  if (novo.categoriaManejoId) {
    const cm = await tx.categoriaManejo.findFirst({ where: { cliente_id: clienteId, id: novo.categoriaManejoId, empresa_id: lote.empresa_id }, select: { nome: true } });
    if (!cm) throw invalido('categoria de manejo não encontrada nesta empresa', { field: 'campos.categoria_manejo_id' });
    categoriaManejoNome = cm.nome;
  }
  let setor = null;
  if (novo.setorId) {
    setor = await tx.setor.findFirst({ where: { cliente_id: clienteId, id: novo.setorId, empresa_id: lote.empresa_id }, select: { id: true, nome: true } });
    if (!setor) throw setorNotFound();
  }
  let area = null;
  if (novo.areaId) {
    area = await tx.areaPastagem.findFirst({ where: { cliente_id: clienteId, id: novo.areaId, empresa_id: lote.empresa_id }, select: { id: true, nome: true, setor_id: true, ativo: true } });
    if (!area) throw areaNotFound();
    // Compatibilidade setor × área só quando um dos dois está sendo corrigido (não reprova cadastro antigo por outro campo).
    if (setor && area.setor_id !== setor.id && ('setor_id' in c || 'area_entrada_id' in c)) throw invalido('a área de entrada não pertence ao setor informado', { field: 'campos.area_entrada_id', reason: 'area_fora_do_setor' });
  }

  const anteriorPublico = comoLotePublico(lote);
  /** @type {Record<string, unknown>} */
  const resposta = { lote_id: id };

  const mexeNoLedger = CAMPOS_OPERACIONAIS_DA_ENTRADA.some((k) => k in c);
  if (avaliacao.ledger && mexeNoLedger) {
    if (!novo.areaId) throw invalido('no ledger a entrada precisa de área', { field: 'campos.area_entrada_id' });
    if (!novo.dia) throw invalido('no ledger a entrada precisa de data', { field: 'campos.data_entrada' });
    if (area && area.ativo === false && novo.areaId !== lote.area_entrada_id) throw new AppError('REBANHO_AREA_INATIVA', 'área de entrada inativa');
    // A reescrita do fato (posição, partida, peso, evento, projeção) é do MOTOR do ledger.
    const r = await corrigirEntradaNoLedger(tx, contexto, {
      clienteId, empresaId: lote.empresa_id, loteId: id, ativacao: avaliacao.ativacao, fato: avaliacao.fato,
      novo, categoriaManejoNome, operationKey: e.operationKey, motivo: e.motivo,
    });
    resposta.evento_id = r.evento_id;
    resposta.posicao_id = r.posicao_id;
  }

  ponto('correcao_entrada:antes_do_lote');
  // Snapshot da entrada: entrada e "atual" iguais (o lote está no retrato da entrada),
  // mais os administrativos — um único UPDATE do Lote.
  const atualizado = await atualizarLotePorId(tx, clienteId, id, {
    ...e.administrativos,
    quantidade_entrada: novo.quantidade,
    quantidade_cabecas: novo.quantidade,
    peso_entrada_kg: novo.peso,
    peso_medio_kg: novo.peso,
    data_entrada: novo.dia ? comoData(novo.dia) : null,
    categoria: novo.categoria,
    categoria_entrada: novo.categoria,
    categoria_manejo_id: novo.categoriaManejoId,
    categoria_manejo_nome: categoriaManejoNome,
    categoria_manejo_entrada_id: novo.categoriaManejoId,
    categoria_manejo_entrada_nome: categoriaManejoNome,
    sexo: novo.sexo,
    setor_id: setor?.id ?? null,
    setor_nome: setor?.nome ?? null,
    area_entrada_id: area?.id ?? null,
    area_entrada_nome: area?.nome ?? null,
    area_atual_id: area?.id ?? null,
    area_atual_nome: area?.nome ?? null,
  });
  if (avaliacao.ledger) {
    // Nome/identificação do cadastro acompanham a posição PRÓPRIA desta entrada (elegível = exatamente uma).
    const exibicao = Object.fromEntries(CAMPOS_DE_EXIBICAO_DA_POSICAO.filter((k) => k in e.administrativos).map((k) => [k, e.administrativos[k]]));
    if (Object.keys(exibicao).length) {
      await tx.posicaoRebanho.updateMany({ where: { cliente_id: clienteId, lote_entrada_id: id }, data: exibicao });
    }
  }
  ponto('correcao_entrada:apos_lote');
  const publico = comoLotePublico(atualizado);
  await registrarEvento(contexto, {
    acao: 'correcao_entrada',
    entidade: 'Lote',
    entidadeId: id,
    dadosAnteriores: anteriorPublico,
    dadosNovos: { ...publico, motivo_correcao: e.motivo, operation_id: e.operationKey, ...(resposta.evento_id ? { evento_id: resposta.evento_id } : {}) },
  }, tx);
  ponto('correcao_entrada:apos_auditoria');
  return { httpStatus: 200, body: { ...resposta, lote: publico } };
};

