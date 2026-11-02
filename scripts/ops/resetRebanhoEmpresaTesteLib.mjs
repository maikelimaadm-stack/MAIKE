/**
 * PR174-R1 (D-PROD-107) — reset CONTROLADO do rebanho de UMA empresa de TESTE,
 * antes da ativação do ledger em modo `entradas`.
 *
 * Para que serve: a reconstrução pelas entradas (`modo: 'entradas'`) exige que o
 * passado da empresa seja exatamente o cadastro de entrada. Numa empresa de
 * teste com manejos legados (e lotes derivados criados por eles), este reset
 * devolve o rebanho ao estado de entrada para a linha do tempo começar nas
 * entradas reais.
 *
 * Escopo FECHADO (cliente_id + empresa_id, os dois obrigatórios):
 *   - MovimentacaoMapa da empresa: APAGADOS (com backup JSON antes).
 *   - Lote de entrada (origem não derivada, não nascimento legado, não excluído):
 *     volta ao estado de entrada (cabeças = quantidade_entrada, área de entrada,
 *     categoria/categoria de manejo/peso de entrada, status Ativo).
 *   - Lote derivado (criado por manejo legado) e nascimento legado: EXCLUSÃO
 *     LÓGICA (excluido_em + Inativo + 0 cab), a linha fica para a auditoria e
 *     as FKs de documentos continuam válidas.
 *   - OperacaoIdempotente cuja resposta cita um movimento apagado: marcada
 *     `desfeito` (nunca mais responde replay; 409 IDEMPOTENCY_EFEITO_DESFEITO).
 *     A busca é pelo id (cuid, único) do movimento apagado dentro do tenant,
 *     nunca por "tudo do cliente".
 *   - Documento de outra fonte (suplementação, sanidade, manejo técnico,
 *     movimentação pecuária, bebedouro, tarefa e histórico, anexo, movimento de
 *     outra empresa) que cite movimento apagado ou lote retirado: o reset
 *     RECUSA (RESET_VINCULOS_PENDENTES) e lista os vínculos — não apaga nem
 *     reescreve documento adjacente.
 *   - Reexecução sem nada a fazer: no-op (sem backup, sem auditoria nova).
 *   - 1 AuditLog `reset_rebanho_teste` com as contagens e os ids apagados e
 *     as chaves invalidadas. O AuditLog anterior é imutável (não é tocado).
 * Nunca toca: outras empresas, outros clientes, Cliente, Empresa, Usuario,
 * Permissao, AreaPastagem, auth, catálogo global, `_prisma_migrations`, schema.
 * Sem TRUNCATE, sem DDL. Recusa se o ledger já estiver ativo na empresa.
 * Tudo numa transação: qualquer erro desfaz tudo.
 */

const ORIGENS_DERIVADAS = Object.freeze(['MOVIMENTACAO', 'REVERSAO MOVIMENTACAO', 'MUDANCA DE CATEGORIA', 'EDICAO MOVIMENTACAO']);
const normal = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
const ehDerivado = (l) => ORIGENS_DERIVADAS.includes(normal(l.origem));
const ehNascimentoLegado = (l) => normal(l.origem) === 'NASCIMENTO';

export class ResetRecusado extends Error {
  constructor(codigo, mensagem, detalhes = {}) {
    super(mensagem);
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/** Estado de entrada de um lote de entrada (o que o reset grava). */
export const estadoDeEntrada = (l) => ({
  quantidade_cabecas: l.quantidade_entrada,
  area_atual_id: l.area_entrada_id ?? l.area_atual_id,
  area_atual_nome: l.area_entrada_id ? l.area_entrada_nome : l.area_atual_nome,
  categoria: l.categoria_entrada ?? l.categoria,
  categoria_manejo_id: l.categoria_manejo_entrada_id ?? l.categoria_manejo_id,
  categoria_manejo_nome: l.categoria_manejo_entrada_id ? l.categoria_manejo_entrada_nome : l.categoria_manejo_nome,
  peso_medio_kg: l.peso_entrada_kg ?? l.peso_medio_kg,
  status: 'Ativo',
});

/**
 * Tabelas do tenant que podem citar um lote ou movimento em texto/JSON.
 * Busca por id exato entre aspas (cuid único), escopo `cliente_id`.
 */
const FONTES_DE_VINCULO = Object.freeze([
  'MovimentacaoPecuaria', 'SuplementacaoEvento', 'SuplementacaoLote', 'AplicacaoMedicamento', 'EventoSanitario',
  'ManejoTecnicoRebanho', 'BebedouroHistorico', 'BebedouroSanidade', 'BebedouroAlerta', 'LancamentoTarefa', 'HistoricoLancamentoTarefa',
]);

/** Vínculos de outras fontes para os ids que o reset removeria/retiraria. */
export const vinculosPendentes = async (tx, clienteId, empresaId, ids) => {
  if (!ids.length) return [];
  const achados = [];
  for (const tabela of FONTES_DE_VINCULO) {
    const linhas = await tx.$queryRawUnsafe(
      `SELECT t.id FROM "${tabela}" t WHERE t.cliente_id = $1 AND EXISTS (SELECT 1 FROM unnest($2::text[]) i WHERE strpos(row_to_json(t)::text, '"' || i || '"') > 0) ORDER BY t.id LIMIT 50`,
      clienteId, ids,
    );
    for (const l of linhas) achados.push({ tabela, id: l.id });
  }
  const anexos = await tx.registroAnexo.findMany({ where: { cliente_id: clienteId, entidade_id: { in: ids } }, select: { id: true }, take: 50 });
  for (const a of anexos) achados.push({ tabela: 'RegistroAnexo', id: a.id });
  const deOutraEmpresa = await tx.$queryRaw`
    SELECT m.id FROM "MovimentacaoMapa" m
     WHERE m.cliente_id = ${clienteId} AND m.empresa_id <> ${empresaId}
       AND EXISTS (SELECT 1 FROM unnest(${ids}::text[]) i WHERE strpos(m.dados::text, '"' || i || '"') > 0)
     ORDER BY m.id LIMIT 50`;
  for (const m of deOutraEmpresa) achados.push({ tabela: 'MovimentacaoMapa(outra empresa)', id: m.id });
  return achados;
};

/** Reservas idempotentes cuja resposta cita um movimento que o reset apagaria. */
const operacoesDosMovimentos = async (tx, clienteId, movimentoIds) => {
  if (!movimentoIds.length) return [];
  return tx.$queryRaw`
    SELECT o.id, o.operation_key, o.tipo_operacao, o.status, o.http_status, o.response_json, o.fingerprint
      FROM "OperacaoIdempotente" o
     WHERE o.cliente_id = ${clienteId} AND o.status = 'committed'
       AND EXISTS (SELECT 1 FROM unnest(${movimentoIds}::text[]) i WHERE strpos(o.response_json::text, '"' || i || '"') > 0)
     ORDER BY o.id
     FOR UPDATE`;
};

const carregar = async (tx, clienteId, empresaId) => {
  const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: empresaId } }, select: { id: true, nome: true } });
  if (!empresa) throw new ResetRecusado('EMPRESA_FORA_DO_ESCOPO', 'empresa não encontrada neste cliente');
  const ativacao = await tx.rebanhoLedgerAtivacao.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId }, select: { id: true } });
  if (ativacao) throw new ResetRecusado('LEDGER_JA_ATIVO', 'o ledger já está ativo nesta empresa; o reset é só para ANTES da ativação');
  const lotes = await tx.lote.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, excluido_em: null }, orderBy: { id: 'asc' } });
  const movimentacoes = await tx.movimentacaoMapa.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId }, orderBy: { id: 'asc' } });
  const entradas = lotes.filter((l) => !ehDerivado(l) && !ehNascimentoLegado(l));
  const retirados = lotes.filter((l) => ehDerivado(l) || ehNascimentoLegado(l));
  const semEntrada = entradas.filter((l) => !l.data_entrada || !(l.quantidade_entrada > 0) || !(l.area_entrada_id ?? l.area_atual_id));
  if (semEntrada.length) {
    throw new ResetRecusado('LOTE_SEM_DADOS_DE_ENTRADA', 'há lote de entrada sem data, quantidade ou área de entrada; corrija o cadastro antes', { lote_ids: semEntrada.map((l) => l.id) });
  }
  const aRestaurar = entradas.filter((l) => {
    const e = estadoDeEntrada(l);
    return Object.entries(e).some(([k, v]) => String(l[k] ?? '') !== String(v ?? ''));
  });
  const idsAfetados = [...movimentacoes.map((m) => m.id), ...retirados.map((l) => l.id)];
  const vinculos = await vinculosPendentes(tx, clienteId, empresaId, idsAfetados);
  const operacoes = await operacoesDosMovimentos(tx, clienteId, movimentacoes.map((m) => m.id));
  return { empresa, lotes, movimentacoes, entradas, retirados, aRestaurar, vinculos, operacoes };
};

/** Somente leitura: o que o reset faria. */
export const planejarReset = async (prisma, { clienteId, empresaId }) => {
  if (!clienteId || !empresaId) throw new ResetRecusado('ESCOPO_OBRIGATORIO', 'cliente_id e empresa_id são obrigatórios');
  const p = await carregar(prisma, clienteId, empresaId);
  return {
    empresa_nome: p.empresa.nome,
    movimentacoes_a_apagar: p.movimentacoes.length,
    lotes_de_entrada: p.entradas.length,
    lotes_a_restaurar: p.aRestaurar.length,
    lotes_derivados_ou_nascidos_a_retirar: p.retirados.length,
    operacoes_a_invalidar: p.operacoes.length,
    vinculos_pendentes: p.vinculos.length,
  };
};

/**
 * Executa o reset numa transação. `confirmarEmpresaNome` tem de ser o nome
 * exato da empresa (segunda trava humana). `gravarBackup(obj)` recebe TUDO o
 * que será alterado ANTES da alteração; se falhar, nada é alterado.
 */
export const executarReset = async (prisma, { clienteId, empresaId, confirmarEmpresaNome, gravarBackup, agora = new Date() }) => {
  if (!clienteId || !empresaId) throw new ResetRecusado('ESCOPO_OBRIGATORIO', 'cliente_id e empresa_id são obrigatórios');
  if (typeof gravarBackup !== 'function') throw new ResetRecusado('BACKUP_OBRIGATORIO', 'o backup é obrigatório');
  return prisma.$transaction(async (tx) => {
    // Trava as linhas da empresa contra manejo concorrente durante o reset.
    await tx.$queryRaw`SELECT id FROM "Lote" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "MovimentacaoMapa" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} ORDER BY id FOR UPDATE`;
    const p = await carregar(tx, clienteId, empresaId);
    if (confirmarEmpresaNome !== p.empresa.nome) throw new ResetRecusado('CONFIRMACAO_DIVERGENTE', 'o nome de confirmação não confere com a empresa');
    if (p.vinculos.length) {
      throw new ResetRecusado('RESET_VINCULOS_PENDENTES', 'há documentos de outras fontes citando movimento ou lote que o reset removeria; trate-os antes (nada foi alterado)', { vinculos: p.vinculos });
    }
    if (!p.movimentacoes.length && !p.aRestaurar.length && !p.retirados.length && !p.operacoes.length) {
      return { sem_alteracoes: true, movimentacoes_apagadas: 0, lotes_restaurados: 0, lotes_retirados: 0, operacoes_invalidadas: 0, lotes_de_entrada: p.entradas.length };
    }
    await gravarBackup({
      versao: 2,
      gerado_em: agora.toISOString(),
      escopo: { cliente_id: clienteId, empresa_id: empresaId },
      lotes: p.lotes,
      movimentacoes_mapa: p.movimentacoes,
      operacoes_idempotentes: p.operacoes,
    });
    const apagadas = await tx.movimentacaoMapa.deleteMany({ where: { cliente_id: clienteId, empresa_id: empresaId, id: { in: p.movimentacoes.map((m) => m.id) } } });
    for (const l of p.aRestaurar) {
      await tx.lote.update({ where: { cliente_id_id: { cliente_id: clienteId, id: l.id } }, data: estadoDeEntrada(l) });
    }
    for (const l of p.retirados) {
      await tx.lote.update({ where: { cliente_id_id: { cliente_id: clienteId, id: l.id } }, data: { excluido_em: agora, status: 'Inativo', quantidade_cabecas: 0 } });
    }
    if (p.operacoes.length) {
      await tx.operacaoIdempotente.updateMany({ where: { cliente_id: clienteId, id: { in: p.operacoes.map((o) => o.id) }, status: 'committed' }, data: { status: 'desfeito' } });
    }
    const resumo = {
      movimentacoes_apagadas: apagadas.count,
      lotes_restaurados: p.aRestaurar.length,
      lotes_retirados: p.retirados.length,
      operacoes_invalidadas: p.operacoes.length,
      lotes_de_entrada: p.entradas.length,
    };
    await tx.auditLog.create({
      data: {
        cliente_id: clienteId,
        acao: 'reset_rebanho_teste',
        entidade: 'Empresa',
        entidade_id: empresaId,
        dados_anteriores: { movimentacoes: p.movimentacoes.length, lotes: p.lotes.length },
        dados_novos: {
          ...resumo,
          movimentacao_ids: p.movimentacoes.map((m) => m.id),
          lotes_retirados_ids: p.retirados.map((l) => l.id),
          lotes_restaurados_ids: p.aRestaurar.map((l) => l.id),
          operacoes_invalidadas: p.operacoes.map((o) => ({ operation_key: o.operation_key, tipo_operacao: o.tipo_operacao })),
        },
        request_id: `reset-rebanho-${agora.getTime()}`,
      },
    });
    return resumo;
  });
};
