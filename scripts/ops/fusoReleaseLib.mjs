/**
 * PR190-R2 (D-PROD-122) — portão de release do fuso da fazenda.
 *
 * Duas peças, ambas SEM depender do runtime novo (a rota PUT e a tela nova só
 * existem depois do deploy; não servem para preparar o banco ANTES dele):
 *
 *  1. `diagnosticarProntidaoFuso` — SOMENTE LEITURA (só pg_catalog /
 *     information_schema enquanto a coluna não existe; nunca seleciona a coluna
 *     antes de provar que ela existe):
 *       SCHEMA_READY: migration 20261104200000_empresa_fuso_horario aplicada,
 *                     concluída, não revertida, checksum = manifesto; coluna
 *                     Empresa.fuso_horario varchar(64) anulável.
 *       DATA_READY:   toda empresa ATIVADA no ledger tem fuso IANA válido
 *                     (explícito; nenhum padrão, nenhuma inferência).
 *
 *  2. `planejarFusos` / `aplicarPlanoFusos` — configuração ONE-SHOT por um
 *     PLANO explícito {cliente_id, empresa_id, fuso_horario, motivo?} e um
 *     administrador ativo DE CADA cliente que assina a auditoria. Regras:
 *       - fuso IANA validado e canonizado; offset/UF/cidade nunca;
 *       - empresa tem de ser do cliente informado; plano sem duplicatas;
 *       - fuso igual = sem mudança (idempotente); vazio → configura;
 *         diferente → só com motivo (troca auditada, nunca silenciosa);
 *       - TUDO numa transação: Empresa travada FOR UPDATE (ordem cliente,id),
 *         revalidação dentro da trava, UPDATE + AuditLog por mudança; qualquer
 *         recusa → ROLLBACK total (nada parcial);
 *       - exige SCHEMA_READY antes de qualquer leitura da coluna.
 * Nada aqui decide alvo remoto: o CLI confere system_identifier, backup e
 * confirmação antes de abrir escrita.
 */

import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { sep } from 'node:path';

import { normalizarFusoIana } from '../../backend/src/modules/rebanhoLedger/rebanhoLedgerTempo.js';
import { MIGRATIONS_APROVADAS } from '../deploy/premergeMigrateLib.mjs';
import { compararIdentidades, conferirAlvos, executorPrisma, lerIdentidade } from '../deploy/alvoBancoLib.mjs';

export const MIGRATION_FUSO = '20261104200000_empresa_fuso_horario';
export const CHECKSUM_MIGRATION_FUSO = MIGRATIONS_APROVADAS[MIGRATION_FUSO];
export const FRASE_CONFIRMACAO = 'APLICAR_FUSOS_DAS_FAZENDAS';

export class FusoReleaseRecusado extends Error {
  constructor(codigo, mensagem, detalhes = {}) {
    super(mensagem);
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** PR190-R3: identificador estável e curto para saídas (nunca o id cru). */
export const hashId = (v) => (v === null || v === undefined ? null : `h:${createHash('sha256').update(String(v)).digest('hex').slice(0, 12)}`);

/** Hosts tratados como banco local descartável (literalmente; nunca por resolução de DNS). */
export const HOSTS_LOCAIS = Object.freeze(['localhost', '127.0.0.1', '::1']);
export const hostEhLocal = (url) => {
  try {
    return HOSTS_LOCAIS.includes(new URL(url).hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
};

/**
 * PR190-R3: o plano de produção vive FORA do repositório — conferido pelo
 * caminho REAL (symlinks resolvidos). Arquivo inexistente/ilegível = não comprovado.
 */
export const planoForaDoRepositorio = (caminho, raizRepo) => {
  try {
    const real = realpathSync(caminho);
    const raiz = realpathSync(raizRepo);
    return real !== raiz && !real.startsWith(`${raiz}${sep}`);
  } catch {
    return false;
  }
};

/**
 * PR190-R3 — prova do alvo para release (fail-closed).
 *  - LOCAL_TESTE: runtime (e migration, se dada) em host local literal.
 *  - Qualquer outro caso exige, na MESMA execução: URL do runtime, URL da
 *    migration, SID esperado e o atestado de quem obteve o SID no banco
 *    autorizado; as duas conexões são lidas e têm de ser o MESMO banco (cluster,
 *    OID do banco lógico e histórico de migrations — alvoBancoLib.compararAlvos).
 *    Um SID igual ao informado pelo próprio operador NÃO é prova sozinho.
 * Nunca devolve URL, host, usuário ou SID.
 * @returns {Promise<{ok: boolean, local: boolean, TARGET: string, motivos: string[], falhas: string[]}>}
 */
export const avaliarAlvoRelease = async ({ urlRuntime, urlMigracao, esperadoSid, atestado, executar = executorPrisma }) => {
  const local = !!urlRuntime && hostEhLocal(urlRuntime) && (!urlMigracao || hostEhLocal(urlMigracao));
  if (local) return { ok: true, local: true, TARGET: 'LOCAL_TESTE', motivos: [], falhas: [] };
  const motivos = [];
  if (!urlRuntime) motivos.push('RUNTIME_URL_AUSENTE');
  if (!urlMigracao) motivos.push('MIGRATION_DATABASE_URL_AUSENTE');
  if (!/^\d{6,25}$/.test(String(esperadoSid ?? ''))) motivos.push('SID_ESPERADO_AUSENTE');
  if (!texto(atestado)) motivos.push('ATESTADO_AUSENTE');
  if (motivos.length) return { ok: false, local: false, TARGET: 'TARGET_UNVERIFIED', motivos, falhas: [] };
  const v = await conferirAlvos({ esperadoSid: String(esperadoSid), urlRuntime, urlMigracao, executar });
  if (!v.ok) return { ok: false, local: false, TARGET: 'TARGET_UNVERIFIED', motivos: ['ALVOS_NAO_CONFEREM'], falhas: v.falhas };
  return { ok: true, local: false, TARGET: 'ALVOS_CONFEREM_SID_ATESTADO', motivos: [], falhas: [] };
};

/** Schema da release (somente leitura; funciona ANTES da migration). */
export const diagnosticarSchemaFuso = async (db, { checksumEsperado = CHECKSUM_MIGRATION_FUSO } = {}) => {
  const motivos = [];
  const [hist] = /** @type {Array<{existe: boolean}>} */ (await db.$queryRaw`SELECT to_regclass('_prisma_migrations') IS NOT NULL AS existe`);
  if (!hist?.existe) {
    motivos.push('HISTORICO_DE_MIGRATIONS_AUSENTE');
  } else {
    const linhas = /** @type {Array<{checksum: string, concluida: boolean, revertida: boolean}>} */ (await db.$queryRaw`
      SELECT checksum, finished_at IS NOT NULL AS concluida, rolled_back_at IS NOT NULL AS revertida
        FROM "_prisma_migrations" WHERE migration_name = ${MIGRATION_FUSO}`);
    if (!linhas.length) motivos.push('MIGRATION_NAO_APLICADA');
    else if (linhas.length > 1) motivos.push('MIGRATION_DUPLICADA');
    else {
      const [m] = linhas;
      if (!m.concluida) motivos.push('MIGRATION_INCOMPLETA');
      if (m.revertida) motivos.push('MIGRATION_REVERTIDA');
      if (m.checksum !== checksumEsperado) motivos.push('MIGRATION_CHECKSUM_DIVERGENTE');
    }
  }
  const [col] = /** @type {Array<{tipo: string, tamanho: number|null, anulavel: string}>} */ (await db.$queryRaw`
    SELECT data_type AS tipo, character_maximum_length AS tamanho, is_nullable AS anulavel
      FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'Empresa' AND column_name = 'fuso_horario'`);
  if (!col) motivos.push('COLUNA_AUSENTE');
  else if (col.tipo !== 'character varying' || Number(col.tamanho) !== 64 || col.anulavel !== 'YES') motivos.push('COLUNA_DIVERGENTE');
  return { pronto: motivos.length === 0, coluna_existe: !!col, motivos };
};

/** Prontidão completa (somente leitura). */
export const diagnosticarProntidaoFuso = async (db, opcoes = {}) => {
  const schema = await diagnosticarSchemaFuso(db, opcoes);
  let dados = { pronto: false, ativadas: null, pendentes: null, motivos: ['SCHEMA_NAO_PRONTO'] };
  if (schema.coluna_existe) {
    const ativadas = /** @type {Array<{cliente_id: string, empresa_id: string, fuso_horario: string|null}>} */ (await db.$queryRaw`
      SELECT a.cliente_id, a.empresa_id, e.fuso_horario
        FROM "RebanhoLedgerAtivacao" a
        JOIN "Empresa" e ON e.cliente_id = a.cliente_id AND e.id = a.empresa_id
       ORDER BY a.cliente_id, a.empresa_id`);
    const pendentes = ativadas
      .filter((a) => !normalizarFusoIana(a.fuso_horario))
      .map((a) => ({ cliente_id: a.cliente_id, empresa_id: a.empresa_id, motivo: a.fuso_horario ? 'FUSO_INVALIDO' : 'FUSO_AUSENTE' }));
    dados = { pronto: pendentes.length === 0 && schema.pronto, ativadas: ativadas.length, pendentes, motivos: pendentes.length ? ['EMPRESA_ATIVADA_SEM_FUSO'] : [] };
  }
  const estado = schema.pronto && dados.pronto ? 'READY' : 'BLOCKED';
  return { estado, SCHEMA_READY: schema.pronto, DATA_READY: dados.pronto, schema, dados };
};

/** Valida a forma do plano (puro). */
export const lerPlano = (plano) => {
  const itens = Array.isArray(plano?.empresas) ? plano.empresas : null;
  const admins = plano?.administradores && typeof plano.administradores === 'object' && !Array.isArray(plano.administradores) ? plano.administradores : null;
  if (!itens || !itens.length) throw new FusoReleaseRecusado('PLANO_INVALIDO', 'o plano precisa de "empresas": [{cliente_id, empresa_id, fuso_horario, motivo?}]');
  if (!admins) throw new FusoReleaseRecusado('PLANO_INVALIDO', 'o plano precisa de "administradores": {"<cliente_id>": "<usuario_id do administrador que assina>"}');
  const vistos = new Set();
  const normalizados = itens.map((it, i) => {
    const clienteId = texto(it?.cliente_id);
    const empresaId = texto(it?.empresa_id);
    if (!clienteId || !empresaId) throw new FusoReleaseRecusado('PLANO_INVALIDO', `item ${i}: cliente_id e empresa_id são obrigatórios`);
    const chave = `${clienteId}/${empresaId}`;
    if (vistos.has(chave)) throw new FusoReleaseRecusado('PLANO_DUPLICADO', `item ${i}: empresa repetida no plano`);
    vistos.add(chave);
    const fuso = normalizarFusoIana(it?.fuso_horario);
    if (!fuso) throw new FusoReleaseRecusado('FUSO_INVALIDO', `item ${i}: fuso_horario não é um nome IANA válido`, { item: i });
    const motivo = texto(it?.motivo);
    if (motivo && motivo.length > 500) throw new FusoReleaseRecusado('PLANO_INVALIDO', `item ${i}: motivo com mais de 500 caracteres`);
    const adminId = texto(admins[clienteId]);
    if (!adminId) throw new FusoReleaseRecusado('ADMINISTRADOR_OBRIGATORIO', `item ${i}: falta o administrador que assina pelo cliente do item`);
    return { clienteId, empresaId, fuso, motivo, adminId, indice: i };
  });
  return normalizados;
};

/** Decide cada item contra o estado lido (puro). */
const decidir = (item, empresa, admin) => {
  if (!empresa) return { recusa: ['EMPRESA_FORA_DO_ESCOPO', 'empresa não encontrada neste cliente'] };
  if (!admin) return { recusa: ['ADMINISTRADOR_OBRIGATORIO', 'o usuário que assina não é administrador ativo deste cliente'] };
  const atual = empresa.fuso_horario ?? null;
  if (atual === item.fuso) return { acao: 'sem_mudanca', atual };
  if (atual && !item.motivo) return { recusa: ['TROCA_SEM_MOTIVO', 'trocar um fuso já configurado exige motivo'] };
  return { acao: atual ? 'trocar' : 'configurar', atual };
};

const lerEstado = async (db, itens, { travar }) => {
  const resultado = [];
  for (const it of itens) {
    const [empresa] = travar
      ? await db.$queryRaw`SELECT id, fuso_horario FROM "Empresa" WHERE cliente_id = ${it.clienteId} AND id = ${it.empresaId} FOR UPDATE`
      : await db.$queryRaw`SELECT id, fuso_horario FROM "Empresa" WHERE cliente_id = ${it.clienteId} AND id = ${it.empresaId}`;
    const [admin] = await db.$queryRaw`SELECT id FROM "Usuario" WHERE cliente_id = ${it.clienteId} AND id = ${it.adminId} AND ativo = true AND papel_tenant = 'administrador'`;
    resultado.push({ it, empresa: empresa ?? null, admin: admin ?? null });
  }
  return resultado;
};

const exigirSchema = async (db) => {
  const schema = await diagnosticarSchemaFuso(db);
  if (!schema.pronto) throw new FusoReleaseRecusado('SCHEMA_NAO_PRONTO', 'aplique e confira a migration do fuso antes (premerge-migrate); nada foi lido nem gravado', { motivos: schema.motivos });
};

// PR190-R3: relatório e detalhes de erro SEM ids crus (hash estável); os ids reais
// ficam só dentro da transação (UPDATE/AuditLog).
/**
 * PR190-R4 — alvo da ESCRITA de fusos. Em alvo não local, as TRÊS conexões —
 * a que escreve (FUSO_DATABASE_URL), a do runtime (precedência do env.js) e a da
 * migration — são lidas e têm de ser o MESMO banco lógico (SID = esperado,
 * current_database, OID e histórico), com atestado. SID isolado prova só o
 * cluster: dois bancos lógicos do mesmo cluster têm o mesmo SID.
 * Devolve a identidade aprovada para ser reconferida DENTRO da transação.
 * @returns {Promise<{ok: boolean, local: boolean, motivos: string[], falhas: string[], identidade: any}>}
 */
export const avaliarAlvoEscritaFuso = async ({ urlFuso, urlRuntime, urlMigracao, esperadoSid, atestado, executar = executorPrisma }) => {
  const local = !!urlFuso && hostEhLocal(urlFuso) && (!urlRuntime || hostEhLocal(urlRuntime)) && (!urlMigracao || hostEhLocal(urlMigracao));
  if (local) return { ok: true, local: true, motivos: [], falhas: [], identidade: null };
  const motivos = [];
  if (!urlFuso) motivos.push('FUSO_DATABASE_URL_AUSENTE');
  if (!urlRuntime) motivos.push('RUNTIME_URL_AUSENTE');
  if (!urlMigracao) motivos.push('MIGRATION_DATABASE_URL_AUSENTE');
  if (!/^\d{6,25}$/.test(String(esperadoSid ?? ''))) motivos.push('SID_ESPERADO_AUSENTE');
  if (!texto(atestado)) motivos.push('ATESTADO_AUSENTE');
  if (motivos.length) return { ok: false, local: false, motivos, falhas: [], identidade: null };
  const identidades = [
    ['fuso', await lerIdentidade(urlFuso, executar)],
    ['runtime', await lerIdentidade(urlRuntime, executar)],
    ['migration', await lerIdentidade(urlMigracao, executar)],
  ];
  const v = compararIdentidades({ esperadoSid: String(esperadoSid), identidades });
  if (!v.ok) return { ok: false, local: false, motivos: ['ALVOS_NAO_CONFEREM'], falhas: v.falhas, identidade: null };
  return { ok: true, local: false, motivos: [], falhas: [], identidade: identidades[0][1] };
};

/**
 * PR190-R4 — TOCTOU: a conexão que vai ler/escrever (a mesma sessão da
 * transação) é conferida contra a identidade aprovada ANTES de qualquer
 * leitura de negócio. Outro banco, histórico alterado no meio ou identidade
 * ilegível → TARGET_UNVERIFIED (a transação desfaz tudo).
 */
const exigirIdentidade = async (db, esperada) => {
  if (!esperada) return;
  const atual = await lerIdentidade('conexao-da-transacao', (_url, sql) => db.$queryRawUnsafe(sql));
  const v = compararIdentidades({ esperadoSid: esperada.sid, identidades: [['aprovada', esperada], ['transacao', atual]] });
  if (!v.ok) throw new FusoReleaseRecusado('TARGET_UNVERIFIED', 'a conexão de escrita não é o banco lógico aprovado (ou mudou desde a verificação); nada foi gravado', { falhas: v.falhas });
};

const comoRelatorio = (decisoes) => ({
  itens: decisoes.map(({ it, d }) => ({
    indice: it.indice, cliente: hashId(it.clienteId), empresa: hashId(it.empresaId), fuso_novo: it.fuso, fuso_atual: d.atual ?? null,
    acao: d.acao ?? 'recusado', ...(d.recusa ? { codigo: d.recusa[0], motivo: d.recusa[1] } : {}),
  })),
  mudancas: decisoes.filter(({ d }) => d.acao === 'configurar' || d.acao === 'trocar').length,
  recusas: decisoes.filter(({ d }) => d.recusa).length,
});

/** Simulação (somente leitura). */
export const planejarFusos = async (db, plano, { identidadeEsperada = null } = {}) => {
  const itens = lerPlano(plano);
  await exigirIdentidade(db, identidadeEsperada);
  await exigirSchema(db);
  const estado = await lerEstado(db, itens, { travar: false });
  return comoRelatorio(estado.map(({ it, empresa, admin }) => ({ it, d: decidir(it, empresa, admin) })));
};

/**
 * Aplica o plano numa ÚNICA transação; qualquer recusa → ROLLBACK total.
 * @param {any} prisma
 * @param {any} plano
 * @param {{referenciaBackup?: string|null, requestId?: string, timeoutMs?: number, identidadeEsperada?: any}} [opcoes]
 */
export const aplicarPlanoFusos = async (prisma, plano, { referenciaBackup = null, requestId = `fuso-release:${randomUUID()}`, timeoutMs = 60_000, identidadeEsperada = null } = {}) => {
  const itens = lerPlano(plano).sort((a, b) => a.clienteId.localeCompare(b.clienteId) || a.empresaId.localeCompare(b.empresaId));
  return prisma.$transaction(async (tx) => {
    await exigirIdentidade(tx, identidadeEsperada);
    await exigirSchema(tx);
    const estado = await lerEstado(tx, itens, { travar: true });
    const decisoes = estado.map(({ it, empresa, admin }) => ({ it, d: decidir(it, empresa, admin) }));
    const recusada = decisoes.find(({ d }) => d.recusa);
    if (recusada) {
      throw new FusoReleaseRecusado(recusada.d.recusa[0], `${recusada.d.recusa[1]} (item ${recusada.it.indice}); nada foi gravado`, comoRelatorio(decisoes));
    }
    for (const { it, d } of decisoes) {
      if (d.acao === 'sem_mudanca') continue;
      await tx.$executeRaw`UPDATE "Empresa" SET fuso_horario = ${it.fuso}, "updatedAt" = now() WHERE cliente_id = ${it.clienteId} AND id = ${it.empresaId}`;
      await tx.auditLog.create({
        data: {
          cliente_id: it.clienteId,
          usuario_id: it.adminId,
          acao: 'update',
          entidade: 'Empresa',
          entidade_id: it.empresaId,
          dados_anteriores: { fuso_horario: d.atual ?? null },
          dados_novos: { fuso_horario: it.fuso, motivo: it.motivo ?? null, operacao: 'configurar_fuso_horario_release', referencia_backup: referenciaBackup },
          request_id: requestId.slice(0, 64),
        },
      });
    }
    return { ...comoRelatorio(decisoes), request_id: requestId.slice(0, 64) };
  }, { timeout: timeoutMs });
};

/**
 * Barreiras do CLI (puro): alvo remoto exige system_identifier esperado; aplicar
 * em alvo remoto exige referência de backup e a frase de confirmação.
 * @returns {{ok: true} | {ok: false, codigo: string, motivo: string}}
 */
export const validarBarreirasCli = ({ local, esperadoSid, aplicar, confirmacao, referenciaBackup, atestado = null }) => {
  if (!local && !/^\d{6,25}$/.test(String(esperadoSid ?? ''))) return { ok: false, codigo: 'ALVO_SEM_IDENTIFICADOR', motivo: 'alvo remoto exige FUSO_EXPECTED_SYSTEM_IDENTIFIER' };
  if (aplicar && confirmacao !== FRASE_CONFIRMACAO) return { ok: false, codigo: 'CONFIRMACAO_AUSENTE', motivo: `--aplicar exige --confirmar ${FRASE_CONFIRMACAO}` };
  if (aplicar && !local && !texto(referenciaBackup)) return { ok: false, codigo: 'BACKUP_NAO_COMPROVADO', motivo: 'alvo remoto exige --referencia-backup (backup restaurável conferido ANTES)' };
  if (aplicar && !local && !texto(atestado)) return { ok: false, codigo: 'ATESTADO_AUSENTE', motivo: 'alvo remoto exige RELEASE_ALVO_ATESTADO (quem obteve o system_identifier no banco autorizado, como e quando)' };
  return { ok: true };
};
