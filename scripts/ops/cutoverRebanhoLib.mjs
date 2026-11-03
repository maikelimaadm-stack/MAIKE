/**
 * PR174-R5 (D-PROD-107) — CUTOVER de uma empresa para o controle por posições.
 *
 * Depois do cutover o mapa opera SÓ no ledger (Lote = entrada). Antes dele os
 * comandos do mapa recusam 409 REBANHO_CUTOVER_PENDENTE (o modelo antigo de
 * saldo em Lote não é mais executado). Empresa NOVA já nasce ativada.
 *
 * Estratégias (sempre por cliente_id + empresa_id exatos; nunca o tenant todo):
 *  - `entradas`: a linha do tempo é reconstruída pelas entradas. Só passa se o
 *    passado da empresa for exatamente o cadastro (sem movimento legado ativo,
 *    lotes no estado de entrada); senão a própria ativação RECUSA.
 *  - `reset_e_entradas`: reset AUTORIZADO dos lançamentos operacionais da
 *    empresa (scripts/ops/resetRebanhoEmpresaTesteLib.mjs: backup antes,
 *    confirmação pelo nome, recusa com vínculos) e então `entradas`.
 *  - `saldo_abertura`: preserva o histórico legado; posições abertas com o
 *    saldo atual na data de corte (≥ último movimento legado ativo).
 * Usuários, senhas, permissões, cliente, empresa, áreas e catálogos NUNCA são
 * tocados.
 *
 * PR174-R6 — ATÔMICO: reset (quando houver) e ativação rodam numa ÚNICA
 * transação PostgreSQL (um COMMIT ou um ROLLBACK). Falha na ativação depois do
 * reset desfaz o reset também. O arquivo de backup pode sobrar nesse caso: ele
 * é a cópia do PRÉ-estado (que é exatamente o estado do banco após o rollback).
 * Travas na ordem da ativação: Empresa → AreaPastagem → Lote → MovimentacaoMapa.
 * Repetir um cutover concluído é no-op (JA_ATIVA): sem backup, sem escrita.
 */
import { executarResetNaTransacao, planejarReset, travarEmpresaParaCorte } from './resetRebanhoEmpresaTesteLib.mjs';

export const ESTRATEGIAS = Object.freeze(['entradas', 'reset_e_entradas', 'saldo_abertura']);

export class CutoverRecusado extends Error {
  constructor(codigo, mensagem, detalhes = {}) {
    super(mensagem);
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

const ORIGENS_DERIVADAS = ['MOVIMENTACAO', 'REVERSAO MOVIMENTACAO', 'MUDANCA DE CATEGORIA', 'EDICAO MOVIMENTACAO'];
const normal = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/** Somente leitura: estado de UMA empresa para o cutover. */
export const diagnosticarEmpresa = async (prisma, { clienteId, empresaId }) => {
  if (!clienteId || !empresaId) throw new CutoverRecusado('ESCOPO_OBRIGATORIO', 'cliente_id e empresa_id são obrigatórios');
  const empresa = await prisma.empresa.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: empresaId } }, select: { id: true, nome: true } });
  if (!empresa) throw new CutoverRecusado('EMPRESA_FORA_DO_ESCOPO', 'empresa não encontrada neste cliente');
  const ativacao = await prisma.rebanhoLedgerAtivacao.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId }, select: { modo: true } });
  const lotes = await prisma.lote.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, excluido_em: null }, select: { quantidade_cabecas: true, quantidade_entrada: true, status: true, origem: true, area_atual_id: true, area_entrada_id: true, data_entrada: true } });
  const derivados = lotes.filter((l) => ORIGENS_DERIVADAS.includes(normal(l.origem)));
  const entradas = lotes.filter((l) => !ORIGENS_DERIVADAS.includes(normal(l.origem)));
  const foraDaEntrada = entradas.filter((l) => l.status === 'Ativo' && (l.quantidade_cabecas !== l.quantidade_entrada || (l.area_entrada_id && l.area_atual_id !== l.area_entrada_id) || !l.data_entrada));
  const movimentos = await prisma.movimentacaoMapa.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId }, select: { dados: true } });
  const movimentosAtivos = movimentos.filter((m) => m?.dados?.situacao !== 'cancelado').length;
  const aptoEntradas = !ativacao && movimentosAtivos === 0 && foraDaEntrada.length === 0 && !derivados.some((l) => l.status === 'Ativo' && l.quantidade_cabecas > 0);
  return {
    empresa_nome: empresa.nome,
    ativa: !!ativacao,
    modo: ativacao?.modo ?? null,
    lotes_de_entrada: entradas.length,
    lotes_derivados_legados: derivados.length,
    entradas_fora_do_estado_de_entrada: foraDaEntrada.length,
    movimentacoes_ativas: movimentosAtivos,
    apto_para_entradas: aptoEntradas,
    recomendacao: ativacao ? 'ja_ativa' : aptoEntradas ? 'entradas' : 'reset_e_entradas (autorizado) ou saldo_abertura',
  };
};

/**
 * Executa o cutover. `ativarEmpresaNaTransacao` é injetado (o núcleo da
 * ativação do backend), assim o script usa exatamente a mesma regra da API.
 * `usuarioId` = administrador do próprio cliente que assina a ativação.
 */
export const executarCutover = async (prisma, { clienteId, empresaId, estrategia, dataCorte = null, usuarioId, confirmarEmpresaNome, gravarBackup, ativarEmpresaNaTransacao, timeoutMs = 120_000 }) => {
  if (!clienteId || !empresaId) throw new CutoverRecusado('ESCOPO_OBRIGATORIO', 'cliente_id e empresa_id são obrigatórios');
  if (!ESTRATEGIAS.includes(estrategia)) throw new CutoverRecusado('ESTRATEGIA_INVALIDA', `estratégia deve ser ${ESTRATEGIAS.join(', ')}`);
  if (typeof ativarEmpresaNaTransacao !== 'function') throw new CutoverRecusado('ATIVACAO_OBRIGATORIA', 'o núcleo da ativação é obrigatório');
  if (estrategia === 'reset_e_entradas' && typeof gravarBackup !== 'function') throw new CutoverRecusado('BACKUP_OBRIGATORIO', 'reset_e_entradas exige backup');
  try {
    return await prisma.$transaction(async (tx) => {
      // Uma transação, uma ordem de travas: nada de manejo/cadastro atravessa o corte.
      await travarEmpresaParaCorte(tx, clienteId, empresaId);
      const antes = await diagnosticarEmpresa(tx, { clienteId, empresaId });
      if (antes.ativa) return { resultado: 'JA_ATIVA', modo: antes.modo };
      if (confirmarEmpresaNome !== antes.empresa_nome) throw new CutoverRecusado('CONFIRMACAO_DIVERGENTE', 'o nome de confirmação não confere com a empresa');
      const admin = await tx.usuario.findFirst({ where: { cliente_id: clienteId, id: usuarioId ?? '', ativo: true, papel_tenant: 'administrador' }, select: { id: true } });
      if (!admin) throw new CutoverRecusado('ADMINISTRADOR_OBRIGATORIO', 'informe um administrador ativo deste cliente para assinar a ativação');
      const reset = estrategia === 'reset_e_entradas'
        ? await executarResetNaTransacao(tx, { clienteId, empresaId, confirmarEmpresaNome, gravarBackup })
        : null;
      const contexto = { auth: { clienteId, usuarioId: admin.id }, requestId: `cutover-${Date.now()}` };
      const modo = estrategia === 'saldo_abertura' ? 'saldo_abertura' : 'entradas';
      const ativacao = await ativarEmpresaNaTransacao(tx, contexto, { empresaId, modo, dataCorte: modo === 'saldo_abertura' ? dataCorte : null });
      return { resultado: 'ATIVADA', estrategia, reset, ativacao: ativacao.body };
    }, { timeout: timeoutMs });
  } catch (e) {
    if (e instanceof CutoverRecusado) throw e;
    // ResetRecusado / AppError da ativação / erro técnico: tudo foi desfeito pelo ROLLBACK.
    throw new CutoverRecusado(e?.codigo ?? e?.code ?? 'ATIVACAO_RECUSADA', e?.message ?? 'cutover recusado', { ...(e?.detalhes ?? e?.details ?? {}), desfeito: true });
  }
};

export { planejarReset };
