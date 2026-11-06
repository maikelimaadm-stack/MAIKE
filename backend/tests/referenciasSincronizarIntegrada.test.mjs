/**
 * Missão integrada (D-PROD-136) — frente M2: `POST /referencias/sincronizar`.
 *
 *  REF-01 / F4  o servidor gravava `data`/`old_data` do CORPO nos dependentes:
 *               quem tinha a tela da entidade X reescrevia nomes e ids
 *               desnormalizados de Lote, tarefa, movimentação do mapa e de
 *               estoque sem a entidade X ter mudado (probe3 Q1/Q2, probe2 P4),
 *               e re-apontava `setor_id` de área, lote e cocho por par forjado.
 *  REF-02       propagação fora de transação e sem AuditLog: falha no meio
 *               deixava escrita parcial, e nada dizia quem reescreveu o quê.
 *  REF-03       renomear setor reescrevia setores HOMÔNIMOS (o casamento era por
 *               nome): tarefas do tenant inteiro e área/lote/cocho/movimento de
 *               outro setor da mesma empresa.
 *
 * Contrato novo: o corpo só IDENTIFICA a origem (`event.entity_name` +
 * `data.id`); o servidor relê a origem no tenant do auth_context e copia os
 * valores ATUAIS dela para os dependentes casados por id (FK ou id dentro de
 * `dados`), na empresa da origem, numa transação, com evento de auditoria.
 * Re-sincronizar é idempotente.
 *
 * Prova por persistência (lê o banco depois), com controles positivos do fluxo
 * legítimo da interface (PATCH da origem e, depois, o corpo que o front manda).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

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
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (modulo, tela, a) => ({ modulo_id: modulo, tela_id: tela, ...acoes(false), visualizar: true, ...a });

/** Conta com permissão explícita (sem a concessão is_admin padrão dos helpers). */
const contaCom = async (permissao, opcoes = {}) => {
  const c = await criarTenant({ semPermissao: true, ...opcoes });
  if (permissao) {
    await prisma().permissao.create({ data: { cliente_id: c.cliente.id, user_email: c.credenciais.login, user_nome: 'Op', ...permissao } });
  }
  const { corpo } = await autenticarNoApp(app, c.credenciais);
  assert.ok(corpo.token, 'login');
  return { ...c, clienteId: c.cliente.id, token: corpo.token };
};
const soSetores = () => contaCom({ modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-setores', { editar: true })] });
const soLotes = () => contaCom({ modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-lotes', { editar: true })] });
const soTiposTarefa = () => contaCom({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linha('suporte-mapa', 'sup-tipos-tarefa', { editar: true })] });
const soGrupos = () => contaCom({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linha('suporte-mapa', 'sup-grupos-atividades', { editar: true })] });
const soProdutos = () => contaCom({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linha('suporte-mapa', 'sup-produtos', { editar: true })] });
const acessoTotal = () => contaCom({ is_admin: true });

const sincronizar = (token, entidade, data, extra = {}) =>
  req('POST', '/referencias/sincronizar', token, { event: { type: 'update', entity_name: entidade }, data, ...extra });

// ── Fixtures (direto no banco: o que se prova é o endpoint de sincronização) ──
let seq = 0;
const n = () => String((seq += 1));
const setor = (c, empresa, nome) =>
  prisma().setor.create({ data: { cliente_id: c, empresa_id: empresa, numero_setor: n(), nome, tipo: 'Próprio' } });
const area = (c, s, extra = {}) =>
  prisma().areaPastagem.create({ data: { cliente_id: c, empresa_id: s.empresa_id, setor_id: s.id, setor_nome: s.nome, numero_area: n(), nome: `AREA ${n()}`, tamanho_hectares: 10, ...extra } });
const lote = (c, empresa, nome, extra = {}) =>
  prisma().lote.create({ data: { cliente_id: c, empresa_id: empresa, numero_lote: n(), nome, quantidade_cabecas: 10, quantidade_entrada: 10, motivo_entrada: 'Compra', ...extra } });
const cocho = (c, empresa, extra = {}) =>
  prisma().pontoSuplementacao.create({ data: { cliente_id: c, empresa_id: empresa, numero_ponto: n(), nome_ponto: `COCHO ${n()}`, ...extra } });
const grupo = (c, nome) => prisma().grupoAtividade.create({ data: { cliente_id: c, nome_grupo: nome } });
const tipo = (c, g, nome) =>
  prisma().tipoTarefa.create({ data: { cliente_id: c, nome_tipo: nome, grupo_atividade_id: g.id, grupo_atividade_nome: g.nome_grupo } });
const tarefa = (c, empresa, t, extra = {}) =>
  prisma().lancamentoTarefa.create({ data: { cliente_id: c, empresa_id: empresa, titulo: `T ${n()}`, tipo: 'x', tipo_tarefa_id: t.id, tipo_tarefa_nome: t.nome_tipo, grupo_atividade_id: t.grupo_atividade_id, grupo_atividade_nome: t.grupo_atividade_nome, ...extra } });
const movMapa = (c, empresa, dados) => prisma().movimentacaoMapa.create({ data: { cliente_id: c, empresa_id: empresa, dados } });
const movPec = (c, empresa, dados) => prisma().movimentacaoPecuaria.create({ data: { cliente_id: c, empresa_id: empresa, dados } });
const produto = (c, empresa, nome, extra = {}) =>
  prisma().produto.create({ data: { cliente_id: c, empresa_id: empresa, numero_produto: n(), nome_produto: nome, ...extra } });
const movEstoque = (c, p, extra = {}) =>
  prisma().movimentacaoEstoque.create({ data: { cliente_id: c, empresa_id: p.empresa_id, numero_movimentacao: n(), tipo_movimentacao: 'Entrada', data_movimentacao: new Date('2027-06-01T12:00:00.000Z'), produto_id: p.id, produto_nome: p.nome_produto, quantidade: 1, unidade_medida: 'KG', ...extra } });

const ler = {
  setor: (id) => prisma().setor.findUnique({ where: { id } }),
  area: (id) => prisma().areaPastagem.findUnique({ where: { id } }),
  lote: (id) => prisma().lote.findUnique({ where: { id } }),
  cocho: (id) => prisma().pontoSuplementacao.findUnique({ where: { id } }),
  tipo: (id) => prisma().tipoTarefa.findUnique({ where: { id } }),
  tarefa: (id) => prisma().lancamentoTarefa.findUnique({ where: { id } }),
  movMapa: async (id) => (await prisma().movimentacaoMapa.findUnique({ where: { id } })).dados,
  movPec: async (id) => (await prisma().movimentacaoPecuaria.findUnique({ where: { id } })).dados,
  movEstoque: (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } }),
  supEvento: async (id) => (await prisma().suplementacaoEvento.findUnique({ where: { id } })).dados,
  supLote: async (id) => (await prisma().suplementacaoLote.findUnique({ where: { id } })).dados,
  manejo: async (id) => (await prisma().manejoTecnicoRebanho.findUnique({ where: { id } })).dados,
};
const eventosDePropagacao = (c) => prisma().auditLog.findMany({ where: { cliente_id: c, acao: 'propagar_referencias' }, orderBy: { createdAt: 'asc' } });

describe('REF-01 / F4 — o corpo só identifica a origem; valores vêm do banco', () => {
  test('Q1 (probe3): só "Setores editar" e Setor intacto → sincronizar não grava setor_nome livre no Lote', async () => {
    const A = await soSetores();
    const s1 = await setor(A.clienteId, 'e1', 'NORTE');
    const l = await lote(A.clienteId, 'e1', 'L1', { setor_id: s1.id, setor_nome: 'NORTE' });
    const ctl = await req('PATCH', `/lotes/${l.id}`, A.token, { nome: 'X' });
    assert.equal(ctl.statusCode, 403, `controle: Lotes não concedido: ${ctl.body}`);

    const r = await sincronizar(A.token, 'Setor', { id: s1.id, nome: 'TEXTO LIVRE' }, { old_data: { id: s1.id, nome: 'NORTE' } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().total_updated, 0, r.body);
    assert.equal((await ler.setor(s1.id)).nome, 'NORTE');
    const depois = await ler.lote(l.id);
    assert.equal(depois.setor_nome, 'NORTE', 'Lote.setor_nome segue o Setor real, não o corpo');
    assert.equal(depois.updatedAt.getTime(), l.updatedAt.getTime(), 'lote não foi tocado');
  });

  test('Q2 (probe3): só "Tipos de tarefa editar" e Tipo intacto → tarefas não mudam de grupo', async () => {
    const A = await soTiposTarefa();
    const g1 = await grupo(A.clienteId, 'SANIDADE');
    const g2 = await grupo(A.clienteId, 'CERCAS');
    const t = await tipo(A.clienteId, g1, 'VACINA');
    const tar = await tarefa(A.clienteId, 'e1', t);
    const ctl = await req('PATCH', `/lancamentos-tarefa/${tar.id}`, A.token, { titulo: 'x' });
    assert.equal(ctl.statusCode, 403, `controle: tarefas só com acesso total: ${ctl.body}`);

    const r = await sincronizar(
      A.token,
      'TipoTarefa',
      { id: t.id, nome_tipo: 'QUALQUER', grupo_atividade_id: g2.id, grupo_atividade_nome: 'CERCAS' },
      { old_data: { id: t.id, nome_tipo: 'VACINA', grupo_atividade_id: g1.id, grupo_atividade_nome: 'SANIDADE' } }
    );
    assert.equal(r.statusCode, 200, r.body);
    const d = await ler.tarefa(tar.id);
    assert.equal(d.grupo_atividade_id, g1.id, 'grupo da tarefa segue o TipoTarefa real');
    assert.equal(d.grupo_atividade_nome, 'SANIDADE');
    assert.equal(d.tipo_tarefa_nome, 'VACINA');
    const tipoReal = await ler.tipo(t.id);
    assert.equal(tipoReal.grupo_atividade_id, g1.id);
    assert.equal(tipoReal.nome_tipo, 'VACINA');
  });

  test('P4 (probe2): só "Setores editar", id de setor de OUTRA empresa no corpo → lote e movimentação do mapa intactos', async () => {
    const A = await soSetores();
    const s1 = await setor(A.clienteId, 'e1', 'NORTE');
    const s2 = await setor(A.clienteId, 'e2', 'OUTRA EMPRESA');
    const l = await lote(A.clienteId, 'e1', 'L1', { setor_id: s1.id, setor_nome: 'NORTE' });
    const mov = await movMapa(A.clienteId, 'e1', { tipo: 'Transferência de Área', setor_id: s1.id, setor_nome: 'NORTE' });
    const ctl = await req('PATCH', `/lotes/${l.id}`, A.token, { setor_id: s2.id });
    assert.equal(ctl.statusCode, 403, ctl.body);

    const r = await sincronizar(A.token, 'Setor', { id: s2.id, nome: 'TEXTO LIVRE' }, { old_data: { id: s1.id, nome: 'NORTE' } });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(await ler.lote(l.id).then((x) => ({ setor_id: x.setor_id, setor_nome: x.setor_nome })), { setor_id: s1.id, setor_nome: 'NORTE' });
    const dados = await ler.movMapa(mov.id);
    assert.equal(dados.setor_id, s1.id);
    assert.equal(dados.setor_nome, 'NORTE', 'movimentação do mapa (D-PROD-99) não é reescrita');
    assert.equal((await ler.setor(s2.id)).nome, 'OUTRA EMPRESA');
  });

  test('par forjado (old_data.id = nome antigo) não re-aponta setor_id de área, lote e cocho', async () => {
    const A = await soSetores();
    const sA = await setor(A.clienteId, 'e1', 'SETOR A');
    const sB = await setor(A.clienteId, 'e2', 'SETOR B');
    const ar = await area(A.clienteId, sA);
    const l = await lote(A.clienteId, 'e1', 'L1', { setor_id: sA.id, setor_nome: 'SETOR A' });
    const p = await cocho(A.clienteId, 'e1', { setor_id: sA.id, setor_nome: 'SETOR A' });
    const mov = await movMapa(A.clienteId, 'e1', { setor_id: sA.id, setor_nome: 'SETOR A' });

    const r = await sincronizar(A.token, 'Setor', { id: sB.id, nome: 'SETOR B' }, { old_data: { id: 'SETOR A', nome: 'SETOR A' }, changed_fields: ['nome'] });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().total_updated, 0, r.body);
    for (const [rotulo, x] of [['área', await ler.area(ar.id)], ['lote', await ler.lote(l.id)], ['cocho', await ler.cocho(p.id)]]) {
      assert.equal(x.setor_id, sA.id, `${rotulo}: setor_id intacto`);
      assert.equal(x.setor_nome, 'SETOR A', `${rotulo}: setor_nome intacto`);
    }
    assert.deepEqual(await ler.movMapa(mov.id), { setor_id: sA.id, setor_nome: 'SETOR A' });
  });

  test('só "Lotes editar", nome forjado com Lote intacto → tarefa e movimentação do mapa intactas', async () => {
    const A = await soLotes();
    const l = await lote(A.clienteId, 'e1', 'LOTE REAL');
    const g = await grupo(A.clienteId, 'G');
    const t = await tipo(A.clienteId, g, 'T');
    const tar = await tarefa(A.clienteId, 'e1', t, { lote_id: l.id, lote_nome: 'LOTE REAL' });
    const mov = await movMapa(A.clienteId, 'e1', { lote_id: l.id, lote: 'LOTE REAL' });

    const r = await sincronizar(A.token, 'Lote', { id: l.id, nome: 'FORJADO' }, { old_data: {} });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await ler.tarefa(tar.id)).lote_nome, 'LOTE REAL');
    assert.equal((await ler.movMapa(mov.id)).lote, 'LOTE REAL');
    assert.equal((await ler.lote(l.id)).nome, 'LOTE REAL');
  });

  test('só "Produtos editar", nome/código forjados com Produto intacto → movimentação de estoque intacta', async () => {
    const A = await soProdutos();
    const p = await produto(A.clienteId, 'e1', 'MILHO', { codigo_interno: 'M-1', categoria: 'GRAOS' });
    const me = await movEstoque(A.clienteId, p, { produto_codigo: 'M-1', produto_categoria: 'GRAOS' });

    const r = await sincronizar(
      A.token,
      'Produto',
      { id: p.id, nome_produto: 'FORJADO', codigo_interno: 'HACK', categoria: 'X', empresa_id: 'e1' },
      { old_data: { id: p.id, nome_produto: 'MILHO', codigo_interno: 'M-1', categoria: 'GRAOS' } }
    );
    assert.equal(r.statusCode, 200, r.body);
    const d = await ler.movEstoque(me.id);
    assert.deepEqual({ n: d.produto_nome, c: d.produto_codigo, k: d.produto_categoria }, { n: 'MILHO', c: 'M-1', k: 'GRAOS' });
  });

  test('origem inexistente no tenant (ou de outro tenant) → 404, nada gravado', async () => {
    const A = await soSetores();
    const B = await soSetores();
    const sB = await setor(B.clienteId, 'e1', 'DO OUTRO TENANT');
    const sA = await setor(A.clienteId, 'e1', 'NORTE');
    const l = await lote(A.clienteId, 'e1', 'L1', { setor_id: sA.id, setor_nome: 'NORTE' });

    const r1 = await sincronizar(A.token, 'Setor', { id: `nao-existe-${randomUUID()}`, nome: 'X' }, { old_data: { nome: 'NORTE' } });
    assert.equal(r1.statusCode, 404, r1.body);
    assert.equal(r1.json().code, 'SETOR_NOT_FOUND');
    const r2 = await sincronizar(A.token, 'Setor', { id: sB.id, nome: 'X' }, { old_data: { nome: 'NORTE' } });
    assert.equal(r2.statusCode, 404, r2.body);
    assert.equal(r2.json().code, 'SETOR_NOT_FOUND', 'id de outro tenant é "não existe", não 403');
    assert.equal((await ler.lote(l.id)).setor_nome, 'NORTE');
    assert.equal((await eventosDePropagacao(A.clienteId)).length, 0);
  });

  test('entidade sem suporte ou corpo sem id → 400 (acesso total); sem a tela → 403 continua', async () => {
    const adm = await acessoTotal();
    const l = await lote(adm.clienteId, 'e1', 'L1');
    const r1 = await sincronizar(adm.token, 'MovimentacaoMapa', { id: l.id, lote: 'X' }, { old_data: {} });
    assert.equal(r1.statusCode, 400, r1.body);
    assert.equal(r1.json().code, 'REQUEST_VALIDATION_FAILED');
    const r2 = await sincronizar(adm.token, 'Lote', { nome: 'SEM ID' }, { old_data: {} });
    assert.equal(r2.statusCode, 400, r2.body);
    assert.equal(r2.json().code, 'REQUEST_VALIDATION_FAILED');

    const A = await soSetores();
    const lA = await lote(A.clienteId, 'e1', 'L1');
    const r3 = await sincronizar(A.token, 'Lote', { id: lA.id, nome: 'HACK' }, { old_data: { nome: 'L1' } });
    assert.equal(r3.statusCode, 403, `guarda da própria entidade (R3): ${r3.body}`);
  });
});

describe('REF-03 — homônimos não são reescritos (casamento por id)', () => {
  test('renomear o setor X (UI: PATCH + sincronizar) não toca o homônimo C da mesma empresa nem Y de outra empresa', async () => {
    const A = await soSetores();
    const c = A.clienteId;
    const X = await setor(c, 'e1', 'SETOR 1');
    const C = await setor(c, 'e1', 'SETOR 1');
    const Y = await setor(c, 'e2', 'SETOR 1');
    const aX = await area(c, X);
    const aC = await area(c, C);
    const aY = await area(c, Y);
    const lX = await lote(c, 'e1', 'LX', { setor_id: X.id, setor_nome: 'SETOR 1' });
    const lC = await lote(c, 'e1', 'LC', { setor_id: C.id, setor_nome: 'SETOR 1' });
    const pX = await cocho(c, 'e1', { setor_id: X.id, setor_nome: 'SETOR 1' });
    const pC = await cocho(c, 'e1', { setor_id: C.id, setor_nome: 'SETOR 1' });
    const mX = await movMapa(c, 'e1', { setor_id: X.id, setor_nome: 'SETOR 1' });
    const mC = await movMapa(c, 'e1', { setor_id: C.id, setor_nome: 'SETOR 1' });
    const g = await grupo(c, 'G');
    const t = await tipo(c, g, 'T');
    const tX = await tarefa(c, 'e1', t, { area_id: aX.id, setor_nome: 'SETOR 1' });
    const tC = await tarefa(c, 'e1', t, { area_id: aC.id, setor_nome: 'SETOR 1' });
    const tY = await tarefa(c, 'e2', t, { area_id: aY.id, setor_nome: 'SETOR 1' });
    // Sem área não há vínculo verificável com setor algum: fica como está.
    const tSemArea = await tarefa(c, 'e1', t, { setor_nome: 'SETOR 1' });

    // `controller.editingItem` da tela (CadastroSetores.jsx): o registro antes da edição.
    const anterior = { id: X.id, nome: 'SETOR 1', empresa_id: 'e1', numero_setor: X.numero_setor };
    const patch = await req('PATCH', `/setores/${X.id}`, A.token, { nome: 'NORTE' });
    assert.equal(patch.statusCode, 200, patch.body);
    // Mesmo corpo que src/apis/setores/setoresApi.js manda depois de salvar.
    const r = await sincronizar(A.token, 'Setor', patch.json(), { old_data: anterior, changed_fields: ['nome'] });
    assert.equal(r.statusCode, 200, r.body);

    // Controle positivo: o setor renomeado propaga.
    assert.equal((await ler.area(aX.id)).setor_nome, 'NORTE');
    assert.equal((await ler.lote(lX.id)).setor_nome, 'NORTE');
    assert.equal((await ler.cocho(pX.id)).setor_nome, 'NORTE');
    assert.equal((await ler.movMapa(mX.id)).setor_nome, 'NORTE');
    assert.equal((await ler.tarefa(tX.id)).setor_nome, 'NORTE');
    // Homônimos intactos.
    for (const [rotulo, x] of [['área C', await ler.area(aC.id)], ['lote C', await ler.lote(lC.id)], ['cocho C', await ler.cocho(pC.id)]]) {
      assert.equal(x.setor_nome, 'SETOR 1', `${rotulo}: setor_nome`);
      assert.equal(x.setor_id, C.id, `${rotulo}: setor_id`);
    }
    assert.equal((await ler.area(aY.id)).setor_nome, 'SETOR 1');
    assert.deepEqual(await ler.movMapa(mC.id), { setor_id: C.id, setor_nome: 'SETOR 1' });
    assert.equal((await ler.tarefa(tC.id)).setor_nome, 'SETOR 1', 'tarefa do homônimo C (mesma empresa)');
    assert.equal((await ler.tarefa(tY.id)).setor_nome, 'SETOR 1', 'tarefa do homônimo Y (outra empresa)');
    assert.equal((await ler.tarefa(tSemArea.id)).setor_nome, 'SETOR 1', 'tarefa sem área: sem vínculo verificável');
  });
});

describe('Controle positivo, idempotência e auditoria', () => {
  test('Setor: caches defasados são corrigidos por id, na empresa e no tenant da origem; 2ª chamada não muda nada', async () => {
    const A = await soSetores();
    const B = await soSetores();
    const c = A.clienteId;
    const S = await setor(c, 'e1', 'NORTE');
    const outro = await setor(c, 'e1', 'OUTRO');
    // Estado defasado: o nome do setor mudou e os caches ficaram para trás.
    const ar = await area(c, S, { setor_nome: 'ANTIGO' });
    const l = await lote(c, 'e1', 'L1', { setor_id: S.id, setor_nome: 'ANTIGO' });
    const p = await cocho(c, 'e1', { setor_id: S.id, setor_nome: 'ANTIGO' });
    const mm = await movMapa(c, 'e1', { setor_id: S.id, setor_nome: 'ANTIGO', setor_origem_id: S.id, setor_origem_nome: 'ANTIGO', setor_destino_id: outro.id, setor_destino_nome: 'OUTRO' });
    const mp = await movPec(c, 'e1', { setor_destino_id: S.id, setor_destino_nome: 'ANTIGO', situacao: 'ativo' });
    // Mesmo id em documento de outra empresa e de outro tenant: fora do alcance.
    const mOutraEmpresa = await movMapa(c, 'e2', { setor_id: S.id, setor_nome: 'ANTIGO' });
    const mOutroTenant = await movMapa(B.clienteId, 'e1', { setor_id: S.id, setor_nome: 'ANTIGO' });

    const r = await sincronizar(A.token, 'Setor', { id: S.id });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().total_updated, 5, r.body);
    assert.deepEqual(r.json().por_tabela, { AreaPastagem: 1, PontoSuplementacao: 1, Lote: 1, MovimentacaoMapa: 1, MovimentacaoPecuaria: 1 });
    const areaDepois = await ler.area(ar.id);
    assert.equal(areaDepois.setor_nome, 'NORTE');
    // `updated_date` acompanha a escrita (clientes ordenam/sincronizam por ele), em UTC.
    assert.ok(areaDepois.updatedAt > ar.updatedAt, 'updatedAt avança na linha escrita');
    assert.ok(Math.abs(areaDepois.updatedAt.getTime() - Date.now()) < 5 * 60 * 1000, `updatedAt em UTC: ${areaDepois.updatedAt.toISOString()}`);
    assert.equal((await ler.lote(l.id)).setor_nome, 'NORTE');
    assert.equal((await ler.cocho(p.id)).setor_nome, 'NORTE');
    assert.deepEqual(await ler.movMapa(mm.id), { setor_id: S.id, setor_nome: 'NORTE', setor_origem_id: S.id, setor_origem_nome: 'NORTE', setor_destino_id: outro.id, setor_destino_nome: 'OUTRO' });
    assert.deepEqual(await ler.movPec(mp.id), { setor_destino_id: S.id, setor_destino_nome: 'NORTE', situacao: 'ativo' }, 'merge preserva as demais chaves do documento');
    assert.equal((await ler.movMapa(mOutraEmpresa.id)).setor_nome, 'ANTIGO');
    assert.equal((await ler.movMapa(mOutroTenant.id)).setor_nome, 'ANTIGO');

    const eventos = await eventosDePropagacao(c);
    assert.equal(eventos.length, 1, 'um evento-resumo no AuditLog');
    assert.equal(eventos[0].entidade, 'Setor');
    assert.equal(eventos[0].entidade_id, S.id);
    assert.equal(eventos[0].usuario_id, A.usuario.id, 'ator do auth_context');
    assert.deepEqual(eventos[0].dados_novos.por_tabela, { AreaPastagem: 1, PontoSuplementacao: 1, Lote: 1, MovimentacaoMapa: 1, MovimentacaoPecuaria: 1 });
    assert.deepEqual(eventos[0].dados_novos.ids.MovimentacaoMapa, [mm.id]);

    const antes = await Promise.all([ler.area(ar.id), ler.lote(l.id), ler.cocho(p.id)]);
    const r2 = await sincronizar(A.token, 'Setor', { id: S.id });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal(r2.json().total_updated, 0, 'idempotente');
    const depois = await Promise.all([ler.area(ar.id), ler.lote(l.id), ler.cocho(p.id)]);
    depois.forEach((x, i) => assert.equal(x.updatedAt.getTime(), antes[i].updatedAt.getTime(), '2ª chamada não toca a linha'));
    assert.equal((await eventosDePropagacao(c)).length, 1, 'sem escrita, sem evento novo');
  });

  test('Lote (UI: PATCH renomeia + sincronizar) propaga para movimentação do mapa, suplementação e tarefa; outro lote intacto', async () => {
    const A = await soLotes();
    const c = A.clienteId;
    const l = await lote(c, 'e1', 'VELHO');
    const outro = await lote(c, 'e1', 'VELHO');
    const g = await grupo(c, 'G');
    const t = await tipo(c, g, 'T');
    const tar = await tarefa(c, 'e1', t, { lote_id: l.id, lote_nome: 'VELHO' });
    const tarOutro = await tarefa(c, 'e1', t, { lote_id: outro.id, lote_nome: 'VELHO' });
    const mov = await movMapa(c, 'e1', { lote_id: l.id, lote: 'VELHO' });
    const movOutro = await movMapa(c, 'e1', { lote_id: outro.id, lote: 'VELHO' });
    const sup = await prisma().suplementacaoLote.create({ data: { cliente_id: c, empresa_id: 'e1', dados: { lote_id: l.id, lote_nome: 'VELHO' } } });

    const anterior = (await req('GET', `/lotes/${l.id}`, A.token)).json();
    const patch = await req('PATCH', `/lotes/${l.id}`, A.token, { nome: 'NOVO' });
    assert.equal(patch.statusCode, 200, patch.body);
    const r = await sincronizar(A.token, 'Lote', patch.json(), { old_data: anterior });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await ler.tarefa(tar.id)).lote_nome, 'NOVO');
    assert.equal((await ler.movMapa(mov.id)).lote, 'NOVO');
    assert.equal((await ler.supLote(sup.id)).lote_nome, 'NOVO');
    assert.equal((await ler.tarefa(tarOutro.id)).lote_nome, 'VELHO');
    assert.equal((await ler.movMapa(movOutro.id)).lote, 'VELHO');
  });

  test('TipoTarefa (UI: PATCH troca o grupo + sincronizar) leva as tarefas do tipo para o grupo novo', async () => {
    const A = await soTiposTarefa();
    const c = A.clienteId;
    const g1 = await grupo(c, 'SANIDADE');
    const g2 = await grupo(c, 'CERCAS');
    const t = await tipo(c, g1, 'VACINA');
    const outroTipo = await tipo(c, g1, 'VERMIFUGO');
    const tar = await tarefa(c, 'e1', t);
    const tarOutro = await tarefa(c, 'e2', outroTipo);

    const anterior = await ler.tipo(t.id);
    const patch = await req('PATCH', `/tipos-tarefa/${t.id}`, A.token, { grupo_atividade_id: g2.id });
    assert.equal(patch.statusCode, 200, patch.body);
    const r = await sincronizar(A.token, 'TipoTarefa', patch.json(), { old_data: { id: t.id, nome_tipo: anterior.nome_tipo, grupo_atividade_id: g1.id, grupo_atividade_nome: 'SANIDADE' } });
    assert.equal(r.statusCode, 200, r.body);
    const d = await ler.tarefa(tar.id);
    assert.deepEqual({ id: d.grupo_atividade_id, nome: d.grupo_atividade_nome }, { id: g2.id, nome: 'CERCAS' });
    assert.equal((await ler.tarefa(tarOutro.id)).grupo_atividade_id, g1.id, 'tarefa de outro tipo intacta');
  });

  test('GrupoAtividade: nome defasado em tipos e tarefas é corrigido por id; 2ª chamada não muda nada', async () => {
    const A = await soGrupos();
    const c = A.clienteId;
    const g = await grupo(c, 'SANIDADE');
    const outro = await grupo(c, 'OUTRO');
    const t = await prisma().tipoTarefa.create({ data: { cliente_id: c, nome_tipo: 'VACINA', grupo_atividade_id: g.id, grupo_atividade_nome: 'NOME VELHO' } });
    const tOutro = await prisma().tipoTarefa.create({ data: { cliente_id: c, nome_tipo: 'X', grupo_atividade_id: outro.id, grupo_atividade_nome: 'NOME VELHO' } });
    const tar = await tarefa(c, 'e1', t);
    const r = await sincronizar(A.token, 'GrupoAtividade', { id: g.id, nome_grupo: 'IGNORADO' }, { old_data: { nome_grupo: 'NOME VELHO' } });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().por_tabela, { TipoTarefa: 1, LancamentoTarefa: 1 });
    assert.equal((await ler.tipo(t.id)).grupo_atividade_nome, 'SANIDADE');
    assert.equal((await ler.tarefa(tar.id)).grupo_atividade_nome, 'SANIDADE');
    assert.equal((await ler.tipo(tOutro.id)).grupo_atividade_nome, 'NOME VELHO', 'tipo de outro grupo intacto');
    const r2 = await sincronizar(A.token, 'GrupoAtividade', { id: g.id });
    assert.equal(r2.json().total_updated, 0, 'idempotente');
  });

  test('Produto (UI: PATCH renomeia + sincronizar): estoque, eventos, cocho e manejo da MESMA empresa acompanham; código derivado preservado', async () => {
    const A = await soProdutos();
    const c = A.clienteId;
    const p = await produto(c, 'e1', 'MILHO', { codigo_barras: '789', categoria: 'GRAOS' });
    const me = await movEstoque(c, p, { produto_codigo: '789', produto_categoria: 'GRAOS' });
    const ev = await prisma().suplementacaoEvento.create({ data: { cliente_id: c, empresa_id: 'e1', dados: { produto_id: p.id, produto: 'MILHO', quantidade_kg: 10 } } });
    const coE1 = await cocho(c, 'e1', { produto_padrao: 'MILHO' });
    const coE2 = await cocho(c, 'e2', { produto_padrao: 'MILHO' });
    const mt = await prisma().manejoTecnicoRebanho.create({ data: { cliente_id: c, empresa_id: 'e1', dados: { produto: 'MILHO', dose: 2 } } });
    const mtE2 = await prisma().manejoTecnicoRebanho.create({ data: { cliente_id: c, empresa_id: 'e2', dados: { produto: 'MILHO' } } });

    const patch = await req('PATCH', `/produtos/${p.id}`, A.token, { nome_produto: 'MILHO NOVO' });
    assert.equal(patch.statusCode, 200, patch.body);
    const r = await sincronizar(A.token, 'Produto', patch.json(), { old_data: { id: p.id, nome_produto: 'MILHO', empresa_id: 'e1' } });
    assert.equal(r.statusCode, 200, r.body);

    const d = await ler.movEstoque(me.id);
    assert.deepEqual({ n: d.produto_nome, c: d.produto_codigo, k: d.produto_categoria }, { n: 'MILHO NOVO', c: '789', k: 'GRAOS' }, 'código = codigo_interno || codigo_barras, como na baixa');
    assert.deepEqual(await ler.supEvento(ev.id), { produto_id: p.id, produto: 'MILHO NOVO', quantidade_kg: 10 });
    assert.equal((await ler.cocho(coE1.id)).produto_padrao, 'MILHO NOVO');
    assert.equal((await ler.cocho(coE2.id)).produto_padrao, 'MILHO', 'cocho de outra empresa intacto');
    assert.deepEqual(await ler.manejo(mt.id), { produto: 'MILHO NOVO', dose: 2 });
    assert.deepEqual(await ler.manejo(mtE2.id), { produto: 'MILHO' });
    // Dois eventos-resumo: o do PATCH (dependentes só por nome-chave) e o da sincronização (por id).
    const resumos = (await eventosDePropagacao(c)).map((e) => JSON.stringify(e.dados_novos.por_tabela)).sort();
    assert.deepEqual(resumos, [
      JSON.stringify({ MovimentacaoEstoque: 1, SuplementacaoEvento: 1 }),
      JSON.stringify({ PontoSuplementacao: 1, ManejoTecnicoRebanho: 1 }),
    ]);
  });

  test('Produto: nome antigo ainda responde por outro produto da empresa (caixa diferente) → cocho fica como está (fail-closed)', async () => {
    const A = await soProdutos();
    const c = A.clienteId;
    const p = await produto(c, 'e1', 'MILHO');
    await produto(c, 'e1', 'Milho');
    const co = await cocho(c, 'e1', { produto_padrao: 'MILHO' });
    const patch = await req('PATCH', `/produtos/${p.id}`, A.token, { nome_produto: 'MILHO NOVO' });
    assert.equal(patch.statusCode, 200, patch.body);
    assert.equal((await ler.cocho(co.id)).produto_padrao, 'MILHO', 'o nome não identifica um produto só');
  });
});

describe('Escrita mínima', () => {
  test('Produto: só a coluna divergente muda (nome defasado), código nulo ≡ vazio fica como está', async () => {
    const A = await soProdutos();
    const p = await produto(A.clienteId, 'e1', 'SOJA');
    const me = await movEstoque(A.clienteId, p, { produto_nome: 'SOJA VELHA', produto_codigo: null, produto_categoria: null });
    const r = await sincronizar(A.token, 'Produto', { id: p.id });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().por_tabela, { MovimentacaoEstoque: 1 });
    const d = await ler.movEstoque(me.id);
    assert.deepEqual({ n: d.produto_nome, c: d.produto_codigo, k: d.produto_categoria }, { n: 'SOJA', c: null, k: null });
  });
});

describe('REF-02 — falha no meio não deixa propagação parcial', () => {
  // Falha injetada por gatilho de teste (banco descartável; não é migration):
  // só dispara para o valor-sentinela, e sai no `finally`.
  const SENTINELA = 'FALHA INJETADA M2';
  const instalarFalha = async () => {
    await prisma().$executeRawUnsafe('DROP TRIGGER IF EXISTS m2_falha_injetada ON "LancamentoTarefa"');
    await prisma().$executeRawUnsafe(
      "CREATE OR REPLACE FUNCTION m2_falha_injetada() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha injetada (teste M2)'; END $$ LANGUAGE plpgsql"
    );
    await prisma().$executeRawUnsafe(
      `CREATE TRIGGER m2_falha_injetada BEFORE UPDATE ON "LancamentoTarefa" FOR EACH ROW WHEN (NEW.lote_nome = '${SENTINELA}') EXECUTE FUNCTION m2_falha_injetada()`
    );
  };
  const removerFalha = async () => {
    await prisma().$executeRawUnsafe('DROP TRIGGER IF EXISTS m2_falha_injetada ON "LancamentoTarefa"');
    await prisma().$executeRawUnsafe('DROP FUNCTION IF EXISTS m2_falha_injetada()');
  };

  test('erro na última tabela desfaz movimentação do mapa e suplementação já propagadas; sem AuditLog', async () => {
    const A = await soLotes();
    const c = A.clienteId;
    // O lote JÁ se chama a sentinela no banco (renomeação cuja propagação ficou pendente).
    const l = await lote(c, 'e1', SENTINELA);
    const g = await grupo(c, 'G');
    const t = await tipo(c, g, 'T');
    const tar = await tarefa(c, 'e1', t, { lote_id: l.id, lote_nome: 'VELHO' });
    const mov = await movMapa(c, 'e1', { lote_id: l.id, lote: 'VELHO' });
    const sup = await prisma().suplementacaoLote.create({ data: { cliente_id: c, empresa_id: 'e1', dados: { lote_id: l.id, lote_nome: 'VELHO' } } });
    await instalarFalha();
    try {
      const r = await sincronizar(A.token, 'Lote', { id: l.id, nome: SENTINELA }, { old_data: {} });
      assert.ok(r.statusCode >= 500, `falha observável: ${r.statusCode} ${r.body}`);
    } finally {
      await removerFalha();
    }
    assert.equal((await ler.movMapa(mov.id)).lote, 'VELHO', 'movimentação do mapa revertida');
    assert.equal((await ler.supLote(sup.id)).lote_nome, 'VELHO', 'suplementação revertida');
    assert.equal((await ler.tarefa(tar.id)).lote_nome, 'VELHO');
    assert.equal((await eventosDePropagacao(c)).length, 0);

    // Sem a falha, a mesma chamada conclui tudo de uma vez.
    const r2 = await sincronizar(A.token, 'Lote', { id: l.id });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.deepEqual(r2.json().por_tabela, { MovimentacaoMapa: 1, SuplementacaoLote: 1, LancamentoTarefa: 1 });
  });
});
