/**
 * D-PROD-139 — "Editar Informação" da POSIÇÃO do rebanho no Mapa Geral.
 *
 * PATCH /rebanho/posicoes/:id/informacoes grava só nome e identificação
 * (identificador_nome/sigla/cor) da posição. Não toca saldo, área, peso,
 * classificação, identidade, linhagem, eventos, partidas, pesos nem o cadastro
 * de entrada (Lote). PostgreSQL real, HTTP autenticado, prova por persistência.
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
  const p = prisma();
  await p.pesoRebanho.deleteMany({});
  await p.lancamentoTarefa.updateMany({ where: { posicao_id: { not: null } }, data: { posicao_id: null } });
  await p.partidaRebanho.deleteMany({});
  await p.eventoRebanho.deleteMany({});
  await p.posicaoRebanho.deleteMany({});
  await p.rebanhoLedgerAtivacao.deleteMany({});
  await limparBanco();
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const BOI = 'Boi 25 a 36 meses';
const VACA = 'Vaca';
const CORTE = '2026-10-01';
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const VER_MAPA = [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', ...acoes(false), visualizar: true }];

const conta = async (clienteId, senhaHash, permissao) => {
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: clienteId, nome: 'Op', login, senha_hash: senhaHash, papel_tenant: 'usuario' } });
  if (permissao) await prisma().permissao.create({ data: { cliente_id: clienteId, user_email: login, user_nome: 'Op', ...permissao } });
  return login;
};

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const senhaHash = (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash;
  const senha = adm.credenciais.senha;
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const login = async (l) => (await autenticarNoApp(app, { login: l, senha })).corpo.token;
  const tokRenomear = await login(await conta(adm.cliente.id, senhaHash, { modulos_permitidos: ['mapa'], permissoes_telas: VER_MAPA, mapa_geral_permissoes: { renomear_lotes: true } }));
  const tokSemRenomear = await login(await conta(adm.cliente.id, senhaHash, { modulos_permitidos: ['mapa'], permissoes_telas: VER_MAPA, mapa_geral_permissoes: { renomear_lotes: false, mover_lotes: true } }));
  const tokIsAdmin = await login(await conta(adm.cliente.id, senhaHash, { is_admin: true }));
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, fuso_horario: 'America/Sao_Paulo', apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const c = { cliente: adm.cliente, tok, tokRenomear, tokSemRenomear, tokIsAdmin, empresa, outraEmpresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
  const r = await req('POST', '/rebanho/ativacao', tok, { operation_id: opId(), empresa_id: empresa.id, data_corte: CORTE });
  assert.equal(r.statusCode, 201, r.body);
  return c;
};
const entrada = async (c, { nome, qtd = 50, area = c.A, categoria = BOI, sexo = 'Macho', extra = {} }) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: c.setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: '2026-10-25', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 400, identificador_nome: 'ORIGINAL', identificador_sigla: 'OR', identificador_cor: '#2c303e', ...extra,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const posicoes = async (c) => (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}`, c.tok)).json().itens;
const posicaoDe = async (c, loteId, area = c.A) => (await posicoes(c)).find((x) => x.lote_entrada_id === loteId && x.area_atual_id === area.id);
const editar = (c, posicaoId, corpo, token = c.tokRenomear) => req('PATCH', `/rebanho/posicoes/${posicaoId}/informacoes`, token, { empresa_id: c.empresa.id, ...corpo });

/** Tudo o que este comando NÃO pode mudar: ledger, cadastro e auditoria de outras entidades. */
const fotografiaLedger = async (c) => {
  const p = prisma();
  const where = { cliente_id: c.cliente.id };
  return JSON.stringify({
    posicoes: (await p.posicaoRebanho.findMany({ where, orderBy: { id: 'asc' } })).map((x) => ({ ...x, updatedAt: x.updatedAt.toISOString(), createdAt: x.createdAt.toISOString() })),
    lotes: (await p.lote.findMany({ where, orderBy: { id: 'asc' } })).map((x) => ({ ...x, updatedAt: x.updatedAt.toISOString(), createdAt: x.createdAt.toISOString() })),
    eventos: await p.eventoRebanho.count({ where }),
    partidas: await p.partidaRebanho.count({ where }),
    pesos: await p.pesoRebanho.count({ where }),
    movMapa: await p.movimentacaoMapa.count({ where }),
    audit: await p.auditLog.count({ where }),
  });
};
const exigirNada = async (c, acao, status, codigo) => {
  const antes = await fotografiaLedger(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.equal(await fotografiaLedger(c), antes, 'nada pode ser gravado');
  return r;
};

describe('Editar Informação da posição — grava só o descritivo da posição alvo', () => {
  test('posição A editada; posição B, cadastro de entrada e ledger intactos; AuditLog do comando', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const lb = await entrada(c, { nome: 'LOTE B', categoria: VACA, sexo: 'Fêmea' });
    const pa = await posicaoDe(c, la.id);
    const pb = await posicaoDe(c, lb.id);
    const p = prisma();
    const loteAntes = await p.lote.findUnique({ where: { id: la.id } });
    const contagemAntes = { ev: await p.eventoRebanho.count(), pt: await p.partidaRebanho.count(), ps: await p.pesoRebanho.count(), mov: await p.movimentacaoMapa.count() };
    const bAntes = await p.posicaoRebanho.findUnique({ where: { id: pb.id } });

    const r = await editar(c, pa.id, { nome: '  GRUPO A NOVO  ', identificador_nome: 'Brinco azul', identificador_sigla: 'BA', identificador_cor: '#0d67ad' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().alterados.sort(), ['identificador_cor', 'identificador_nome', 'identificador_sigla', 'nome']);
    assert.equal(r.json().posicao.nome, 'GRUPO A NOVO');
    assert.equal(r.json().posicao.area_atual_nome, 'PASTO A');

    const aDepois = await p.posicaoRebanho.findUnique({ where: { id: pa.id } });
    assert.equal(aDepois.nome, 'GRUPO A NOVO');
    assert.equal(aDepois.identificador_nome, 'BRINCO AZUL', 'identificador em maiúsculas, como o Cadastro de Lotes');
    assert.equal(aDepois.identificador_sigla, 'BA');
    assert.equal(aDepois.identificador_cor, '#0d67ad');
    assert.equal(aDepois.quantidade_cabecas, 50);
    assert.equal(aDepois.area_id, c.A.id);
    assert.equal(aDepois.chave_identidade, (await p.posicaoRebanho.findUnique({ where: { id: pa.id } })).chave_identidade);
    const bDepois = await p.posicaoRebanho.findUnique({ where: { id: pb.id } });
    assert.deepEqual({ ...bDepois, updatedAt: null }, { ...bAntes, updatedAt: null }, 'posição B intacta');
    assert.equal(bDepois.updatedAt.getTime(), bAntes.updatedAt.getTime());
    const loteDepois = await p.lote.findUnique({ where: { id: la.id } });
    assert.equal(loteDepois.nome, 'LOTE A', 'cadastro de entrada intacto');
    assert.equal(loteDepois.identificador_nome, 'ORIGINAL');
    assert.equal(loteDepois.updatedAt.getTime(), loteAntes.updatedAt.getTime());
    assert.deepEqual({ ev: await p.eventoRebanho.count(), pt: await p.partidaRebanho.count(), ps: await p.pesoRebanho.count(), mov: await p.movimentacaoMapa.count() }, contagemAntes, 'nenhum fato do ledger nem movimentação');

    const audit = await p.auditLog.findMany({ where: { cliente_id: c.cliente.id, entidade: 'PosicaoRebanho', entidade_id: pa.id, acao: 'update' } });
    const doComando = audit.filter((a) => a.dados_novos?.comando === 'editar_informacao_posicao');
    assert.equal(doComando.length, 1);
    assert.equal(doComando[0].dados_anteriores.nome, 'LOTE A');
    assert.equal(doComando[0].dados_novos.nome, 'GRUPO A NOVO');
    // antes e depois com as mesmas relações: o AuditLog não inventa mudança de área/entrada
    assert.equal(doComando[0].dados_anteriores.area_atual_nome, 'PASTO A');
    assert.equal(doComando[0].dados_anteriores.data_entrada, doComando[0].dados_novos.data_entrada);
    assert.ok(doComando[0].usuario_id, 'ator do auth_context');

    // novo GET devolve o valor gravado (o mapa relê daqui)
    assert.equal((await posicaoDe(c, la.id)).nome, 'GRUPO A NOVO');
  });

  test('identificação vazia vira null; mesmos valores = 200 sem gravar nem auditar', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const pa = await posicaoDe(c, la.id);
    const r1 = await editar(c, pa.id, { identificador_nome: '   ', identificador_sigla: null });
    assert.equal(r1.statusCode, 200, r1.body);
    const d = await prisma().posicaoRebanho.findUnique({ where: { id: pa.id } });
    assert.equal(d.identificador_nome, null);
    assert.equal(d.identificador_sigla, null);
    const r2 = await exigirNada(c, () => editar(c, pa.id, { nome: 'LOTE A', identificador_cor: '#2c303e' }), 200);
    assert.deepEqual(r2.json().alterados, []);
  });

  test('nomes repetidos: renomear A com o nome de B não funde nem toca B', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const lb = await entrada(c, { nome: 'LOTE B' });
    const pa = await posicaoDe(c, la.id);
    const pb = await posicaoDe(c, lb.id);
    const antes = await prisma().posicaoRebanho.count({ where: { cliente_id: c.cliente.id } });
    const r = await editar(c, pa.id, { nome: 'LOTE B' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(await prisma().posicaoRebanho.count({ where: { cliente_id: c.cliente.id } }), antes);
    const b = await prisma().posicaoRebanho.findUnique({ where: { id: pb.id } });
    assert.equal(b.nome, 'LOTE B');
    assert.equal(b.quantidade_cabecas, 50);
    assert.equal((await prisma().posicaoRebanho.findUnique({ where: { id: pa.id } })).quantidade_cabecas, 50);
  });

  test('múltiplas categorias da mesma entrada (após Mudança de Categoria): só a posição alvo muda', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A', categoria: 'Garrote 13 a 24 meses' });
    const pa = await posicaoDe(c, la.id);
    const mc = await req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Mudança de Categoria', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas: [{ categoria_atual: 'Garrote 13 a 24 meses', categoria_nova: BOI, quantidade: 20 }] });
    assert.ok([200, 201].includes(mc.statusCode), mc.body);
    const daEntrada = (await posicoes(c)).filter((x) => x.lote_entrada_id === la.id && x.area_atual_id === c.A.id);
    assert.equal(daEntrada.length, 2, 'duas posições da mesma entrada');
    const outra = daEntrada.find((x) => x.id !== pa.id);
    const r = await editar(c, outra.id, { nome: 'BOIS DO LOTE A' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await prisma().posicaoRebanho.findUnique({ where: { id: pa.id } })).nome, 'LOTE A');
    assert.equal((await prisma().posicaoRebanho.findUnique({ where: { id: outra.id } })).nome, 'BOIS DO LOTE A');
  });

  test('posições reunidas (Junção): editar a principal não muda linhagem, saldo nem as origens', async () => {
    const c = await cenario();
    const l1 = await entrada(c, { nome: 'LOTE 1', qtd: 30 });
    const l2 = await entrada(c, { nome: 'LOTE 2', qtd: 20 });
    const p1 = await posicaoDe(c, l1.id);
    const p2 = await posicaoDe(c, l2.id);
    const j = await req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: p1.id, lote_origem_ids: [p2.id], data_movimentacao: '2026-11-02' });
    assert.ok([200, 201].includes(j.statusCode), j.body);
    const antes = await prisma().posicaoRebanho.findUnique({ where: { id: p1.id } });
    assert.equal(antes.quantidade_cabecas, 50);
    const r = await editar(c, p1.id, { nome: 'LOTE REUNIDO' });
    assert.equal(r.statusCode, 200, r.body);
    const depois = await prisma().posicaoRebanho.findUnique({ where: { id: p1.id } });
    assert.equal(depois.nome, 'LOTE REUNIDO');
    assert.equal(depois.quantidade_cabecas, 50);
    assert.deepEqual(depois.linhagem, antes.linhagem);
    assert.equal(depois.chave_identidade, antes.chave_identidade);
  });

  test('depois de editar, transferir e pesar continuam funcionando; o destino novo leva o nome editado', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A', qtd: 40 });
    const pa = await posicaoDe(c, la.id);
    assert.equal((await editar(c, pa.id, { nome: 'GRUPO EDITADO', identificador_sigla: 'GE' })).statusCode, 200);
    const t = await req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-11-03T12:00:00.000Z', itens: [{ posicao_id: pa.id, quantidade: 15 }] });
    assert.equal(t.statusCode, 201, t.body);
    const destino = await posicaoDe(c, la.id, c.B);
    assert.equal(destino.quantidade_cabecas, 15);
    assert.equal(destino.nome, 'GRUPO EDITADO');
    assert.equal(destino.identificador_sigla, 'GE');
    assert.equal((await posicaoDe(c, la.id)).quantidade_cabecas, 25);
    const peso = await req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-04', linhas: [{ lote_id: pa.id, peso_medio_kg: 450 }] });
    assert.ok([200, 201].includes(peso.statusCode), peso.body);
    assert.equal((await posicaoDe(c, la.id)).nome, 'GRUPO EDITADO');
  });

  test('interação documentada: renomear no Cadastro de Lotes ainda propaga às posições da entrada', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const pa = await posicaoDe(c, la.id);
    assert.equal((await editar(c, pa.id, { nome: 'NOME DO MAPA' })).statusCode, 200);
    const r = await req('PATCH', `/lotes/${la.id}`, c.tok, { nome: 'NOME DO CADASTRO' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await prisma().posicaoRebanho.findUnique({ where: { id: pa.id } })).nome, 'NOME DO CADASTRO');
  });
});

describe('Editar Informação da posição — corpo fechado, autorização, isolamento', () => {
  const PROIBIDOS = {
    quantidade_cabecas: 999,
    area_id: 'qualquer',
    peso_medio_kg: 1,
    categoria: VACA,
    sexo: 'Fêmea',
    categoria_manejo_id: 'x',
    categoria_manejo_nome: 'x',
    chave_identidade: '["x"]',
    lote_entrada_id: 'x',
    linhagem: [],
    numero_lote: '99',
    id: 'x',
    cliente_id: 'x',
    cliente: { update: { ativo: false } },
    empresa: { connect: { id: 'x' } },
    is_admin: true,
  };
  for (const [campo, valor] of Object.entries(PROIBIDOS)) {
    test(`campo proibido \`${campo}\` → 400, nada gravado`, async () => {
      const c = await cenario();
      const la = await entrada(c, { nome: 'LOTE A' });
      const pa = await posicaoDe(c, la.id);
      await exigirNada(c, () => editar(c, pa.id, { nome: 'X', [campo]: valor }), 400, 'REQUEST_VALIDATION_FAILED');
    });
  }

  test('caractere de controle (NUL, TAB) ou surrogate isolado → 400 (não 500), nada gravado', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const pa = await posicaoDe(c, la.id);
    for (const corpo of [{ nome: 'A\u0000B' }, { identificador_cor: '\u0000' }, { identificador_nome: '\uD800' }, { identificador_sigla: 'A\tB' }]) {
      await exigirNada(c, () => editar(c, pa.id, corpo), 400, 'REQUEST_VALIDATION_FAILED');
    }
  });

  test('tamanho conta caracteres (como a coluna): 20 emojis cabem na sigla de 32', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const pa = await posicaoDe(c, la.id);
    const sigla = '🐂'.repeat(20);
    const r = await editar(c, pa.id, { identificador_sigla: sigla });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await prisma().posicaoRebanho.findUnique({ where: { id: pa.id } })).identificador_sigla, sigla);
    await exigirNada(c, () => editar(c, pa.id, { identificador_sigla: '🐂'.repeat(33) }), 400);
  });

  test('nome vazio ou só espaços → 400; corpo só com empresa → 400', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const pa = await posicaoDe(c, la.id);
    await exigirNada(c, () => editar(c, pa.id, { nome: '   ' }), 400);
    await exigirNada(c, () => editar(c, pa.id, { nome: '' }), 400);
    await exigirNada(c, () => editar(c, pa.id, {}), 400);
  });

  test('sem renomear_lotes → 403 ACAO_NAO_PERMITIDA, zero mutações; is_admin e admin real passam', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const pa = await posicaoDe(c, la.id);
    await exigirNada(c, () => editar(c, pa.id, { nome: 'X' }, c.tokSemRenomear), 403, 'ACAO_NAO_PERMITIDA');
    assert.equal((await editar(c, pa.id, { nome: 'PELO IS_ADMIN' }, c.tokIsAdmin)).statusCode, 200);
    assert.equal((await editar(c, pa.id, { nome: 'PELO ADMIN REAL' }, c.tok)).statusCode, 200);
    assert.equal((await prisma().posicaoRebanho.findUnique({ where: { id: pa.id } })).nome, 'PELO ADMIN REAL');
  });

  test('outro tenant → 404 (mesma resposta), nada gravado nos dois tenants', async () => {
    const c = await cenario();
    const outro = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const pa = await posicaoDe(c, la.id);
    const antesOutro = await fotografiaLedger(outro);
    // token do outro tenant (com permissão) mirando a posição do primeiro, com a empresa do outro e com a do primeiro
    await exigirNada(c, () => req('PATCH', `/rebanho/posicoes/${pa.id}/informacoes`, outro.tok, { empresa_id: outro.empresa.id, nome: 'INVASOR' }), 404, 'POSICAO_REBANHO_NOT_FOUND');
    const r = await req('PATCH', `/rebanho/posicoes/${pa.id}/informacoes`, outro.tok, { empresa_id: c.empresa.id, nome: 'INVASOR' });
    assert.ok([404, 409].includes(r.statusCode), r.body);
    assert.equal(await fotografiaLedger(outro), antesOutro);
    assert.equal((await prisma().posicaoRebanho.findUnique({ where: { id: pa.id } })).nome, 'LOTE A');
  });

  test('outra empresa do mesmo tenant: empresa sem ledger → 409; com ledger mas posição de outra empresa → 404', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const pa = await posicaoDe(c, la.id);
    await exigirNada(c, () => req('PATCH', `/rebanho/posicoes/${pa.id}/informacoes`, c.tokRenomear, { empresa_id: c.outraEmpresa.id, nome: 'X' }), 409, 'REBANHO_LEDGER_INATIVO');
    const r = await req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.outraEmpresa.id, data_corte: CORTE });
    assert.equal(r.statusCode, 201, r.body);
    await exigirNada(c, () => req('PATCH', `/rebanho/posicoes/${pa.id}/informacoes`, c.tokRenomear, { empresa_id: c.outraEmpresa.id, nome: 'X' }), 404, 'POSICAO_REBANHO_NOT_FOUND');
    await exigirNada(c, () => editar(c, 'nao-existe', { nome: 'X' }), 404, 'POSICAO_REBANHO_NOT_FOUND');
  });

  test('posição com zero cabeças → 409 POSICAO_REBANHO_VAZIA, nada gravado', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A', qtd: 10 });
    const pa = await posicaoDe(c, la.id);
    const t = await req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-11-03T12:00:00.000Z', itens: [{ posicao_id: pa.id, quantidade: 10 }] });
    assert.equal(t.statusCode, 201, t.body);
    assert.equal((await prisma().posicaoRebanho.findUnique({ where: { id: pa.id } })).quantidade_cabecas, 0);
    await exigirNada(c, () => editar(c, pa.id, { nome: 'X' }), 409, 'POSICAO_REBANHO_VAZIA');
  });

  test('sem token → 401', async () => {
    const c = await cenario();
    const la = await entrada(c, { nome: 'LOTE A' });
    const pa = await posicaoDe(c, la.id);
    await exigirNada(c, () => req('PATCH', `/rebanho/posicoes/${pa.id}/informacoes`, null, { empresa_id: c.empresa.id, nome: 'X' }), 401);
  });
});
