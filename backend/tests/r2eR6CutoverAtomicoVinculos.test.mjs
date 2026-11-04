/**
 * PR174-R6 (D-PROD-107) — cutover ATÔMICO (reset + ativação num único COMMIT),
 * backup com manifesto conferido, no-op idempotente, disputa real com duas
 * conexões, e vínculos CAUSAIS (por id) no cancelamento do ledger.
 * PostgreSQL real + HTTP autenticado.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { ativarEmpresaNaTransacao } from '../src/modules/rebanhoLedger/rebanhoLedgerService.js';
import { executarCutover } from '../../scripts/ops/cutoverRebanhoLib.mjs';
import { conferirBackup, manifestoDoBackup } from '../../scripts/ops/resetRebanhoEmpresaTesteLib.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();
before(async () => {
  app = await criarApp();
  await app.ready();
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const BOI = 'Boi 25 a 36 meses';

const cenario = async (nomeEmpresa = 'Fazenda') => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: nomeEmpresa } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, usuario: adm.usuario, tok, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
};
const entrada = async (c, { nome = 'LOTE', qtd = 500, data = '2026-10-01' } = {}) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria: BOI, sexo: 'Macho', setor_id: c.setor.id, area_entrada_id: c.A.id, area_atual_id: c.A.id,
    data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 400,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
/** Movimento legado pré-existente (base antiga), escrito direto no banco. */
const legadoTransferido = async (c, l, qtd) => {
  await prisma().lote.update({ where: { id: l.id }, data: { quantidade_cabecas: l.quantidade_cabecas - qtd } });
  return prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: qtd, data_movimentacao: '2026-10-28' } } });
};
const adminDe = async (c) => (await prisma().usuario.findFirst({ where: { cliente_id: c.cliente.id, papel_tenant: 'administrador' } })).id;
/** Fotografia de TUDO que o cutover poderia tocar (contagens + conteúdo dos Lotes). */
const foto = async (c) => {
  const w = { cliente_id: c.cliente.id };
  const p = prisma();
  return {
    lotes: (await p.lote.findMany({ where: w, orderBy: { id: 'asc' } })).map((l) => [l.id, l.quantidade_cabecas, l.status, l.area_atual_id, l.excluido_em?.toISOString() ?? null]),
    movs: await p.movimentacaoMapa.count({ where: w }),
    ativacoes: await p.rebanhoLedgerAtivacao.count({ where: w }),
    posicoes: await p.posicaoRebanho.count({ where: w }),
    eventos: await p.eventoRebanho.count({ where: w }),
    partidas: await p.partidaRebanho.count({ where: w }),
    audits: await p.auditLog.count({ where: w }),
    ops: (await p.operacaoIdempotente.findMany({ where: w, orderBy: { id: 'asc' } })).map((o) => [o.id, o.status]),
  };
};
const acessos = async (c) => ({
  usuarios: await prisma().usuario.findMany({ where: { cliente_id: c.cliente.id }, select: { id: true, login: true, senha_hash: true, papel_tenant: true, ativo: true }, orderBy: { id: 'asc' } }),
  permissoes: await prisma().permissao.count({ where: { cliente_id: c.cliente.id } }),
  empresas: await prisma().empresa.findMany({ where: { cliente_id: c.cliente.id }, select: { id: true, nome: true }, orderBy: { id: 'asc' } }),
  areas: await prisma().areaPastagem.count({ where: { cliente_id: c.cliente.id } }),
});
const cutover = (c, extra = {}) => adminDe(c).then((usuarioId) => executarCutover(prisma(), {
  clienteId: c.cliente.id, empresaId: c.empresa.id, estrategia: 'reset_e_entradas', usuarioId, confirmarEmpresaNome: c.empresa.nome,
  ativarEmpresaNaTransacao, gravarBackup: () => true, ...extra,
}));

describe('R6-A — cutover atômico', () => {
  test('A1: falha DENTRO da ativação depois do reset → ROLLBACK total (0 exclusões, Lotes idênticos, sem ativação); o backup é a cópia do pré-estado', async () => {
    const c = await cenario();
    const l = await entrada(c);
    await legadoTransferido(c, l, 200);
    const antes = await foto(c);
    let backup = null;
    let resetVisto = null;
    await assert.rejects(
      cutover(c, {
        gravarBackup: (b) => { backup = b; return true; },
        ativarEmpresaNaTransacao: async (tx, ctx, o) => {
          resetVisto = await tx.movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }); // 0 dentro da transação
          await ativarEmpresaNaTransacao(tx, ctx, o);
          throw new Error('falha injetada depois da ativação');
        },
      }),
      (e) => e.codigo === 'ATIVACAO_RECUSADA' && e.detalhes.desfeito === true,
    );
    assert.equal(resetVisto, 0, 'o reset rodou dentro da mesma transação');
    assert.deepEqual(await foto(c), antes, 'nada persistiu: reset e ativação foram desfeitos juntos');
    assert.equal(antes.movs, 1);
    assert.ok(conferirBackup(JSON.parse(JSON.stringify(backup))), 'backup íntegro (manifesto confere)');
    assert.equal(backup.manifesto.contagens.movimentacoes_mapa, 1);
  });

  test('A2: sucesso → reset + ativação num COMMIT; acesso/senhas/permissões/empresa/áreas preservados; outro tenant e outra empresa intocados; reexecução = no-op sem backup', async () => {
    const c = await cenario();
    const outro = await cenario('Outra');
    const l = await entrada(c);
    await legadoTransferido(c, l, 200);
    const lo = await entrada(outro);
    await legadoTransferido(outro, lo, 50);
    const outraEmpresa = await prisma().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 2, fuso_horario: 'America/Sao_Paulo', apelido: 'F2', nome: 'Fazenda 2' } });
    const acessoAntes = await acessos(c);
    const outroAntes = await foto(outro);
    let backups = 0;
    const r = await cutover(c, { gravarBackup: () => { backups += 1; return true; } });
    assert.equal(r.resultado, 'ATIVADA');
    assert.equal(r.reset.movimentacoes_apagadas, 1);
    const depois = await foto(c);
    assert.deepEqual([depois.movs, depois.ativacoes], [0, 1]);
    const posA = await prisma().posicaoRebanho.findFirst({ where: { cliente_id: c.cliente.id, area_id: c.A.id } });
    assert.equal(posA.quantidade_cabecas, 500, 'a linha do tempo começa na entrada original');
    assert.equal((await prisma().lote.findUnique({ where: { id: l.id } })).quantidade_cabecas, 500, 'cadastro de entrada restaurado');
    assert.deepEqual(await acessos(c), acessoAntes);
    assert.deepEqual(await foto(outro), outroAntes, 'outro tenant intocado');
    assert.equal(await prisma().rebanhoLedgerAtivacao.count({ where: { cliente_id: c.cliente.id, empresa_id: outraEmpresa.id } }), 0, 'outra empresa intocada');
    assert.equal((await autenticarNoApp(app, { login: acessoAntes.usuarios[0].login, senha: 'senha-de-teste-1' })).status ?? 200, 200);

    // Reexecução: no-op verificável — sem backup novo, sem apagar operações novas.
    const m = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, lote_id: posA.id, quantidade_animais: 5, data_movimentacao: '2026-10-30' });
    assert.equal(m.statusCode, 201, m.body);
    const antesNoop = await foto(c);
    const r2 = await cutover(c, { gravarBackup: () => { backups += 1; return true; } });
    assert.equal(r2.resultado, 'JA_ATIVA');
    assert.equal(backups, 1, 'nenhum backup duplicado');
    assert.deepEqual(await foto(c), antesNoop, 'operação nova preservada');
  });

  test('A3: backup falha ou não confere → aborta ANTES do DELETE; nada muda', async () => {
    const c = await cenario();
    const l = await entrada(c);
    await legadoTransferido(c, l, 100);
    const antes = await foto(c);
    await assert.rejects(cutover(c, { gravarBackup: () => { throw new Error('disco cheio'); } }), (e) => e.detalhes.desfeito === true);
    assert.deepEqual(await foto(c), antes);
    await assert.rejects(cutover(c, { gravarBackup: () => false }), (e) => e.codigo === 'BACKUP_NAO_CONFERIDO');
    assert.deepEqual(await foto(c), antes);
    await assert.rejects(cutover(c, { gravarBackup: undefined }), (e) => e.codigo === 'BACKUP_OBRIGATORIO');
    assert.deepEqual(await foto(c), antes);
  });

  test('A4: vínculo de outro módulo citando o movimento a apagar → RESET_VINCULOS_PENDENTES, nada muda (nem ativação)', async () => {
    const c = await cenario();
    const l = await entrada(c);
    const m = await legadoTransferido(c, l, 100);
    await prisma().suplementacaoLote.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { movimentacao_id: m.id, kg: 10 } } });
    const antes = await foto(c);
    await assert.rejects(cutover(c), (e) => e.codigo === 'RESET_VINCULOS_PENDENTES');
    assert.deepEqual(await foto(c), antes);
  });

  test('A5: escopo/confirmação/administrador/estratégia validados antes de qualquer escrita', async () => {
    const c = await cenario();
    const l = await entrada(c);
    await legadoTransferido(c, l, 100);
    const antes = await foto(c);
    await assert.rejects(cutover(c, { confirmarEmpresaNome: 'Outra' }), (e) => e.codigo === 'CONFIRMACAO_DIVERGENTE');
    await assert.rejects(cutover(c, { usuarioId: 'x' }), (e) => e.codigo === 'ADMINISTRADOR_OBRIGATORIO');
    await assert.rejects(cutover(c, { estrategia: 'tudo' }), (e) => e.codigo === 'ESTRATEGIA_INVALIDA');
    await assert.rejects(executarCutover(prisma(), { clienteId: c.cliente.id, estrategia: 'entradas', ativarEmpresaNaTransacao }), (e) => e.codigo === 'ESCOPO_OBRIGATORIO');
    const outro = await cenario();
    await assert.rejects(executarCutover(prisma(), { clienteId: outro.cliente.id, empresaId: c.empresa.id, estrategia: 'entradas', usuarioId: await adminDe(outro), confirmarEmpresaNome: 'Fazenda', ativarEmpresaNaTransacao }), (e) => e.codigo === 'EMPRESA_FORA_DO_ESCOPO');
    assert.deepEqual(await foto(c), antes);
  });

  test('A6: disputa REAL (duas conexões): cadastro de lote e PATCH concorrentes esperam o corte; depois, o lote novo tem posição e o PATCH de saldo é recusado — sem drift', async () => {
    const c = await cenario();
    const l = await entrada(c);
    await legadoTransferido(c, l, 100);
    let sinal;
    const dentro = new Promise((r) => { sinal = r; });
    let liberar;
    const liberado = new Promise((r) => { liberar = r; });
    const corte = cutover(c, {
      ativarEmpresaNaTransacao: async (tx, ctx, o) => {
        const r = await ativarEmpresaNaTransacao(tx, ctx, o);
        sinal();
        await liberado;
        return r;
      },
    });
    await dentro;
    let novoPronto = false;
    let patchPronto = false;
    const novo = entrada(c, { nome: 'NOVO', qtd: 30 }).then((x) => { novoPronto = true; return x; });
    const patch = req('PATCH', `/lotes/${l.id}`, c.tok, { quantidade_cabecas: 1 }).then((x) => { patchPronto = true; return x; });
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual([novoPronto, patchPronto], [false, false], 'escritores concorrentes esperam o COMMIT do corte');
    liberar();
    const r = await corte;
    assert.equal(r.resultado, 'ATIVADA');
    const ln = await novo;
    const rp = await patch;
    assert.equal(rp.statusCode, 409, rp.body);
    assert.equal(rp.json().code, 'REBANHO_LEDGER_SALDO_SOMENTE_POR_EVENTO');
    const posNovo = await prisma().posicaoRebanho.findFirst({ where: { cliente_id: c.cliente.id, lote_entrada_id: ln.id } });
    assert.equal(posNovo?.quantidade_cabecas, 30, 'lote criado durante o corte entrou no ledger');
    const v = (await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).json();
    assert.equal(v.integro, true, JSON.stringify(v));
  });

  test('A7: manifesto detecta backup adulterado', () => {
    const conteudo = { versao: 3, lotes: [{ id: 'a' }], movimentacoes_mapa: [], operacoes_idempotentes: [] };
    const ok = { ...conteudo, manifesto: manifestoDoBackup(conteudo) };
    assert.equal(conferirBackup(ok), true);
    assert.equal(conferirBackup({ ...ok, lotes: [] }), false);
    assert.equal(conferirBackup(conteudo), false);
  });
});

describe('R6-D — vínculos causais no cancelamento do ledger', () => {
  const ativa = async () => {
    const c = await cenario();
    c.lote = await entrada(c);
    const a = await req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, modo: 'entradas' });
    assert.equal(a.statusCode, 201, a.body);
    c.posA = await prisma().posicaoRebanho.findFirst({ where: { cliente_id: c.cliente.id, area_id: c.A.id } });
    const t = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: c.posA.id, quantidade_animais: 100, area_destino_id: c.B.id, data_movimentacao: '2026-10-10' });
    assert.equal(t.statusCode, 201, t.body);
    c.transf = t.json().movimentacao;
    c.posB = await prisma().posicaoRebanho.findFirst({ where: { cliente_id: c.cliente.id, area_id: c.B.id } });
    return c;
  };
  const cancelar = (c, id) => req('POST', `/movimentacoes-mapa/${id}/cancelamento`, c.tok, { operation_id: opId(), motivo: 'lançado por engano' });
  const saldos = async (c) => (await prisma().posicaoRebanho.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } })).map((p) => [p.id, p.quantidade_cabecas]);

  test('D1: documento de outro módulo cita (por id) a posição CRIADA pela transferência → 409 com tipo/id; saldo intacto; elegibilidade igual; removido o documento, cancela', async () => {
    const c = await ativa();
    const doc = await prisma().suplementacaoLote.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_id: c.posB.id, data: '2026-10-15', kg: 20 } } });
    const antes = await saldos(c);
    const r = await cancelar(c, c.transf.id);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'REBANHO_CANCELAMENTO_VINCULO_POSTERIOR');
    assert.deepEqual(r.json().details.bloqueadores.map((b) => [b.tipo, b.id, b.data]), [['SuplementacaoLote', doc.id, '2026-10-15']]);
    assert.deepEqual(await saldos(c), antes, 'saldo intacto');
    const e = (await req('GET', `/movimentacoes-mapa/${c.transf.id}/elegibilidade-cancelamento`, c.tok)).json();
    assert.deepEqual([e.elegivel, e.codigo], [false, 'REBANHO_CANCELAMENTO_VINCULO_POSTERIOR']);
    await prisma().suplementacaoLote.delete({ where: { id: doc.id } });
    assert.equal((await cancelar(c, c.transf.id)).statusCode, 200);
  });

  test('D2: documento que cita o PRÓPRIO movimento bloqueia; documento sem vínculo real (posição que já existia, outro id) NÃO bloqueia', async () => {
    const c = await ativa();
    const sem = await prisma().eventoSanitario.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_id: c.posA.id, lote: 'PASTO B', data: '2026-10-20' } } });
    const com = await prisma().manejoTecnicoRebanho.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { movimentacao_id: c.transf.id } } });
    const r = await cancelar(c, c.transf.id);
    assert.equal(r.statusCode, 409, r.body);
    assert.deepEqual(r.json().details.bloqueadores.map((b) => b.id), [com.id], 'só o vínculo causal bloqueia (não o da posição pré-existente nem o nome)');
    await prisma().manejoTecnicoRebanho.delete({ where: { id: com.id } });
    assert.equal((await cancelar(c, c.transf.id)).statusCode, 200);
    assert.ok(await prisma().eventoSanitario.findUnique({ where: { id: sem.id } }), 'documento sem vínculo não é tocado');
  });

  test('D3: fato posterior do ledger na posição criada (pesagem/morte) bloqueia; cancelar o posterior e depois o anterior → sucesso; cadastro de entrada imutável', async () => {
    const c = await ativa();
    const p = await req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, {
      operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.B.id, data_movimentacao: '2026-10-12', linhas: [{ lote_id: c.posB.id, peso_medio_kg: 431.5 }],
    });
    assert.equal(p.statusCode, 201, p.body);
    const antes = await saldos(c);
    const r = await cancelar(c, c.transf.id);
    assert.equal(r.statusCode, 409, r.body);
    assert.deepEqual(await saldos(c), antes);
    assert.equal((await cancelar(c, p.json().movimentacao.id)).statusCode, 200);
    assert.equal((await cancelar(c, c.transf.id)).statusCode, 200);
    const l = await prisma().lote.findUnique({ where: { id: c.lote.id } });
    assert.deepEqual([l.quantidade_cabecas, l.quantidade_entrada, l.area_atual_id], [500, 500, c.A.id], 'manejo nunca altera o cadastro de entrada');
  });
});

describe('R7-A — inventário antes do schema R2E (somente leitura, fail-closed)', () => {
  const SCHEMA = 'r7_sem_r2e';
  const comSchema = (url, s) => `${url}${url.includes('?') ? '&' : '?'}schema=${s}`;
  test('R7A1: banco SEM schema R2E → inventário lista o que falta, diagnóstico/cutover recusam CUTOVER_SCHEMA_PENDENTE sem escrever; CLI --inventario funciona e o diagnóstico sai 3', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const { inventarioSchema, diagnosticarEmpresa } = await import('../../scripts/ops/cutoverRebanhoLib.mjs');
    const { spawnSync } = await import('node:child_process');
    const p = prisma();
    await p.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await p.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    for (const t of ['Empresa', 'Lote', 'MovimentacaoMapa', 'LancamentoTarefa']) await p.$executeRawUnsafe(`CREATE TABLE ${SCHEMA}."${t}" (LIKE public."${t}" INCLUDING ALL)`);
    await p.$executeRawUnsafe(`ALTER TABLE ${SCHEMA}."LancamentoTarefa" DROP COLUMN "posicao_id"`);
    await p.$executeRawUnsafe(`INSERT INTO ${SCHEMA}."Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES ('emp-r7', 'cli-r7', 1, 'F', 'Fazenda R7', now())`);
    const url = comSchema(process.env.DATABASE_URL, SCHEMA);
    const antigo = new PrismaClient({ datasources: { db: { url } } });
    try {
      const inv = await inventarioSchema(antigo);
      assert.deepEqual(inv, { schema_r2e_pronto: false, ausentes: ['RebanhoLedgerAtivacao', 'PosicaoRebanho', 'EventoRebanho', 'PartidaRebanho', 'PesoRebanho', 'RebanhoLedgerAtivacao.modo', 'LancamentoTarefa.posicao_id'] });
      await assert.rejects(diagnosticarEmpresa(antigo, { clienteId: 'cli-r7', empresaId: 'emp-r7' }), (e) => e.codigo === 'CUTOVER_SCHEMA_PENDENTE' && e.detalhes.ausentes.length === 7);
      await assert.rejects(executarCutover(antigo, { clienteId: 'cli-r7', empresaId: 'emp-r7', estrategia: 'entradas', usuarioId: 'x', confirmarEmpresaNome: 'Fazenda R7', ativarEmpresaNaTransacao }), (e) => e.codigo === 'CUTOVER_SCHEMA_PENDENTE');
      const env = { ...process.env, CUTOVER_DATABASE_URL: url };
      const cli = (...a) => spawnSync('node', [fileURLToPath(new URL('../../scripts/ops/cutover-rebanho.mjs', import.meta.url)), '--cliente-id', 'cli-r7', ...a], { encoding: 'utf8', env });
      const i = cli('--inventario');
      assert.equal(i.status, 0, i.stderr);
      const saida = JSON.parse(i.stdout);
      assert.deepEqual([saida.modo, saida.resultado, saida.empresas.map((e) => e.nome)], ['INVENTARIO', 'CUTOVER_SCHEMA_PENDENTE', ['Fazenda R7']]);
      const d = cli('--empresa-id', 'emp-r7');
      assert.equal(d.status, 3);
      assert.match(d.stderr, /CUTOVER_SCHEMA_PENDENTE/);
      assert.doesNotMatch(i.stdout + i.stderr + d.stdout + d.stderr, /postgres(ql)?:\/\//);
      assert.equal((await antigo.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}."Empresa"`))[0].n, 1, 'nada escrito');
    } finally {
      await antigo.$disconnect();
      await p.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    }
  });

  test('R7A2: banco COM schema R2E → inventário pronto e diagnóstico real da empresa', async () => {
    const { inventarioSchema, diagnosticarEmpresa } = await import('../../scripts/ops/cutoverRebanhoLib.mjs');
    assert.deepEqual(await inventarioSchema(prisma()), { schema_r2e_pronto: true, ausentes: [] });
    const c = await cenario();
    await entrada(c);
    const d = await diagnosticarEmpresa(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id });
    assert.deepEqual([d.ativa, d.lotes_de_entrada, d.recomendacao], [false, 1, 'entradas']);
  });

  test('R7D1: backup operacional não contém credenciais (senha_hash, login, URL)', async () => {
    const c = await cenario();
    const l = await entrada(c);
    await legadoTransferido(c, l, 50);
    let backup;
    await cutover(c, { gravarBackup: (b) => { backup = b; return true; } });
    const txt = JSON.stringify(backup);
    assert.doesNotMatch(txt, /senha_hash|senha|postgres(ql)?:\/\//i);
    assert.deepEqual(Object.keys(backup).sort(), ['escopo', 'gerado_em', 'lotes', 'manifesto', 'movimentacoes_mapa', 'operacoes_idempotentes', 'versao']);
  });
});
