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
 *   - 1 AuditLog `reset_rebanho_teste` com as contagens.
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
  return { empresa, lotes, movimentacoes, entradas, retirados, aRestaurar };
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
    await gravarBackup({
      versao: 1,
      gerado_em: agora.toISOString(),
      escopo: { cliente_id: clienteId, empresa_id: empresaId },
      lotes: p.lotes,
      movimentacoes_mapa: p.movimentacoes,
    });
    const apagadas = await tx.movimentacaoMapa.deleteMany({ where: { cliente_id: clienteId, empresa_id: empresaId, id: { in: p.movimentacoes.map((m) => m.id) } } });
    for (const l of p.aRestaurar) {
      await tx.lote.update({ where: { cliente_id_id: { cliente_id: clienteId, id: l.id } }, data: estadoDeEntrada(l) });
    }
    for (const l of p.retirados) {
      await tx.lote.update({ where: { cliente_id_id: { cliente_id: clienteId, id: l.id } }, data: { excluido_em: agora, status: 'Inativo', quantidade_cabecas: 0 } });
    }
    const resumo = {
      movimentacoes_apagadas: apagadas.count,
      lotes_restaurados: p.aRestaurar.length,
      lotes_retirados: p.retirados.length,
      lotes_de_entrada: p.entradas.length,
    };
    await tx.auditLog.create({
      data: {
        cliente_id: clienteId,
        acao: 'reset_rebanho_teste',
        entidade: 'Empresa',
        entidade_id: empresaId,
        dados_anteriores: { movimentacoes: p.movimentacoes.length, lotes: p.lotes.length },
        dados_novos: resumo,
        request_id: `reset-rebanho-${agora.getTime()}`,
      },
    });
    return resumo;
  });
};
