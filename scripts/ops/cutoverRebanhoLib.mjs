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

/**
 * PR174-R7 — inventário SOMENTE LEITURA do schema, disponível ANTES das
 * migrations (só pg_catalog/information_schema; nunca toca tabela R2E).
 * Sem o schema R2E completo o diagnóstico/cutover devolve
 * CUTOVER_SCHEMA_PENDENTE com o que falta — nunca "empresa ativa", nunca escrita.
 */
export const OBJETOS_R2E = Object.freeze({
  tabelas: ['RebanhoLedgerAtivacao', 'PosicaoRebanho', 'EventoRebanho', 'PartidaRebanho', 'PesoRebanho'],
  colunas: [['RebanhoLedgerAtivacao', 'modo'], ['LancamentoTarefa', 'posicao_id']],
});
export const inventarioSchema = async (db) => {
  const tabelas = await db.$queryRaw`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY(${OBJETOS_R2E.tabelas}::text[])`;
  const colunas = await db.$queryRaw`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY(${OBJETOS_R2E.colunas.map((x) => x[0])}::text[])`;
  const tem = new Set(tabelas.map((r) => r.t));
  const temCol = new Set(colunas.map((r) => `${r.t}.${r.c}`));
  const ausentes = [
    ...OBJETOS_R2E.tabelas.filter((t) => !tem.has(t)),
    ...OBJETOS_R2E.colunas.map(([t, c]) => `${t}.${c}`).filter((x) => !temCol.has(x)),
  ];
  return { schema_r2e_pronto: ausentes.length === 0, ausentes };
};
export const exigirSchemaR2E = async (db) => {
  const inv = await inventarioSchema(db);
  if (!inv.schema_r2e_pronto) throw new CutoverRecusado('CUTOVER_SCHEMA_PENDENTE', 'o banco ainda não tem o schema do ledger (aplique as migrations EXPAND antes); nada foi lido nem gravado', { ausentes: inv.ausentes });
  return inv;
};

/** Somente leitura: estado de UMA empresa para o cutover. */
export const diagnosticarEmpresa = async (prisma, { clienteId, empresaId }) => {
  if (!clienteId || !empresaId) throw new CutoverRecusado('ESCOPO_OBRIGATORIO', 'cliente_id e empresa_id são obrigatórios');
  await exigirSchemaR2E(prisma);
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
      await exigirSchemaR2E(tx);
      // Uma transação, uma ordem de travas: nada de manejo/cadastro atravessa o corte.
      // Estado, vínculos e confirmação são REVALIDADOS aqui, nunca herdados do diagnóstico anterior.
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

/**
 * PR174-R6/R7 — barreira contra drift: o cutover só roda quando o backend em
 * PRODUÇÃO do projeto MAIKE JÁ é o código novo e publicado da main atual.
 *
 * `validarOrigemProducao`: o operador configura o origin de produção esperado
 * (MAIKE_PRODUCAO_ORIGIN, não-secreto); a URL informada tem de ser EXATAMENTE
 * esse origin (https, sem credenciais, sem caminho/query/fragmento, nunca
 * localhost nem preview `*-git-*` / `*.vercel.app` diferente do configurado).
 *
 * `conferirBackendNovo` (pura) exige, do health lido SEM seguir redirect:
 *  - HTTP 200 sem redirect; status ok;
 *  - capacidade `rebanho-ledger-cutover-r6`;
 *  - implantacao.ambiente = production, repositório = maikelimaadm-stack/MAIKE,
 *    domínio de produção = host do origin configurado;
 *  - release = SHA aprovado = HEAD ATUAL da main REMOTA (git ls-remote, não a
 *    origin/main local, que pode estar defasada).
 */
export const REPOSITORIO_ESPERADO = 'maikelimaadm-stack/MAIKE';
const HOST_LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$)/i;

export const validarOrigemProducao = ({ informada, configurada }) => {
  const parse = (u) => {
    try {
      return new URL(u);
    } catch {
      return null;
    }
  };
  const c = parse(configurada ?? '');
  if (!c) return { ok: false, motivo: 'ORIGEM_PRODUCAO_NAO_CONFIGURADA' };
  if (c.protocol !== 'https:' || c.username || c.password || (c.pathname !== '/' && c.pathname !== '') || c.search || c.hash || HOST_LOCAL.test(c.hostname) || /-git-/.test(c.hostname)) {
    return { ok: false, motivo: 'ORIGEM_PRODUCAO_INVALIDA' };
  }
  const u = parse(informada ?? '');
  if (!u) return { ok: false, motivo: 'URL_INVALIDA' };
  if (u.protocol !== 'https:') return { ok: false, motivo: 'URL_NAO_HTTPS' };
  if (u.username || u.password) return { ok: false, motivo: 'URL_COM_CREDENCIAIS' };
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return { ok: false, motivo: 'URL_COM_CAMINHO' };
  if (HOST_LOCAL.test(u.hostname)) return { ok: false, motivo: 'URL_LOCAL' };
  if (u.origin !== c.origin) return { ok: false, motivo: /-git-|vercel\.app$/.test(u.hostname) ? 'URL_DE_PREVIEW' : 'URL_FORA_DA_PRODUCAO' };
  return { ok: true, motivo: null, origin: c.origin, host: c.hostname.toLowerCase() };
};

export const conferirBackendNovo = ({ health, httpStatus = 200, redirecionou = false, releaseSha, mainRemota, hostProducao }) => {
  if (!/^[0-9a-f]{40}$/.test(releaseSha ?? '')) return { ok: false, motivo: 'RELEASE_SHA_INVALIDO' };
  if (!/^[0-9a-f]{40}$/.test(mainRemota ?? '')) return { ok: false, motivo: 'MAIN_REMOTA_INDISPONIVEL' };
  if (releaseSha !== mainRemota) return { ok: false, motivo: 'RELEASE_NAO_E_MAIN_ATUAL' };
  if (redirecionou || (httpStatus >= 300 && httpStatus < 400)) return { ok: false, motivo: 'HEALTH_REDIRECIONADO' };
  if (httpStatus !== 200) return { ok: false, motivo: 'HEALTH_INDISPONIVEL' };
  if (!Array.isArray(health?.capacidades) || !health.capacidades.includes('rebanho-ledger-cutover-r6')) return { ok: false, motivo: 'BACKEND_ANTIGO_EM_PRODUCAO' };
  const imp = health.implantacao ?? {};
  if (imp.ambiente !== 'production') return { ok: false, motivo: 'IMPLANTACAO_NAO_E_PRODUCAO' };
  if (imp.repositorio !== REPOSITORIO_ESPERADO) return { ok: false, motivo: 'REPOSITORIO_DIVERGENTE' };
  if (!hostProducao || imp.dominio_producao !== hostProducao) return { ok: false, motivo: 'DOMINIO_PRODUCAO_DIVERGENTE' };
  if (health.release !== releaseSha) return { ok: false, motivo: 'BACKEND_EM_OUTRO_SHA' };
  if (health.status !== 'ok') return { ok: false, motivo: 'BACKEND_DEGRADADO' };
  return { ok: true, motivo: null };
};

export { planejarReset };
