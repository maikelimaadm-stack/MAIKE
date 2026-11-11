/**
 * D-PROD-162 — MAIKE-PATRIMONIO-SIMPLIFICA-01: PERMISSÕES depois da
 * simplificação. PostgreSQL real, HTTP autenticado.
 *
 *  P1. Famílias e tipos vivem no cadastro de Bens: ver = Bens visualizar;
 *      criar = Bens novo|salvar|editar; renomear = Bens editar|salvar;
 *      inativar/reativar = Bens `inativar`. Opções de catálogo = Bens visualizar.
 *  P2. Linhas ANTIGAS (`pat-familias-patrimoniais`, `pat-tipos-patrimoniais`,
 *      `pat-perfis-medicao`, `pat-combustiveis` com tudo ligado, e
 *      `configurar_conversao` na de Abastecimentos) ficam inertes: 403 em toda
 *      rota de família/tipo/opções; nada concedido.
 *  P3. `GET /bens-patrimoniais-opcoes/produtos` exige Bens novo|salvar|editar
 *      (só visualizar → 403).
 *  P4. Rotas removidas respondem 404 (P-09), com e sem sessão; catálogo padrão
 *      só administrador/`is_admin` (P-06); outro tenant → 404 sem oráculo.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { TELAS, TELAS_ANTIGAS, corpoErro, erro, fotoPatrimonio, http, linha, montarPatrimonio, prisma, produtoL, tudo } from './patrimonioP1Cenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const req = (...a) => H.req(...a);
const ok = (...a) => H.ok(...a);
const INEXISTENTE = 'cl0inexistente000000000000';
const BENS = TELAS.bens;
const versaoDa = async (delegado, id) => (await /** @type {any} */ (prisma())[delegado].findUnique({ where: { id } })).versao;

// ─────────────────────────────────────────────────────────────────────────────
describe('P1 — famílias e tipos pelas ações de Bens', () => {
  test('Bens novo cria família e tipo; Bens editar cria e renomeia; salvar renomeia; ativo exige inativar; ver = visualizar; nada sem a ação', async () => {
    const s = await montarPatrimonio(app);
    const soVer = await s.contaCom(linha(BENS, { visualizar: true }));
    const soNovo = await s.contaCom(linha(BENS, { visualizar: true, novo: true }));
    const soSalvar = await s.contaCom(linha(BENS, { visualizar: true, salvar: true }));
    const soEditar = await s.contaCom(linha(BENS, { visualizar: true, editar: true }));
    const soInativar = await s.contaCom(linha(BENS, { visualizar: true, inativar: true }));
    const editarInativar = await s.contaCom(linha(BENS, { visualizar: true, editar: true, inativar: true }));
    const semVisualizar = await s.contaCom(linha(BENS, { novo: true, salvar: true, editar: true, inativar: true }));

    // Ver: listas, detalhes e opções de catálogo.
    const leituras = ['/patrimonio-familias', `/patrimonio-familias/${s.fam.MAQUINAS}`, '/patrimonio-tipos', `/patrimonio-tipos/${s.tip.TRATOR_PNEUS}`, '/bens-patrimoniais-opcoes/familias', '/bens-patrimoniais-opcoes/tipos'];
    for (const url of leituras) {
      assert.equal((await req('GET', url, soVer.token)).statusCode, 200, `visualizar ${url}`);
      assert.deepEqual(erro(await req('GET', url, semVisualizar.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA'], `sem visualizar ${url}`);
      assert.equal((await req('GET', url, null)).statusCode, 401, `sem sessão ${url}`);
    }

    // Criar ("+ Nova família" / "+ Novo tipo"): novo, salvar ou editar de Bens; só ver ou só inativar não.
    const antes = await fotoPatrimonio(s.c);
    for (const conta of [soVer, soInativar]) {
      assert.deepEqual(erro(await req('POST', '/patrimonio-familias', conta.token, { nome: 'Negada', natureza: 'OUTRO' })).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
      assert.deepEqual(erro(await req('POST', '/patrimonio-tipos', conta.token, { familia_id: s.fam.MAQUINAS, nome: 'Negado' })).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    }
    assert.equal(await fotoPatrimonio(s.c), antes, 'nenhuma recusa gravou');
    const porNovo = await ok(req('POST', '/patrimonio-familias', soNovo.token, { nome: 'Pelo novo', natureza: 'OUTRO' }), 201);
    const porSalvar = await ok(req('POST', '/patrimonio-familias', soSalvar.token, { nome: 'Pelo salvar', natureza: 'OUTRO' }), 201);
    const porEditar = await ok(req('POST', '/patrimonio-familias', soEditar.token, { nome: 'Pelo editar', natureza: 'OUTRO' }), 201);
    assert.deepEqual([porNovo.codigo, porSalvar.codigo, porEditar.codigo], ['PELO_NOVO', 'PELO_SALVAR', 'PELO_EDITAR']);
    const tipoNovo = await ok(req('POST', '/patrimonio-tipos', soNovo.token, { familia_id: porNovo.id, nome: 'Tipo do novo' }), 201);
    const tipoEditar = await ok(req('POST', '/patrimonio-tipos', soEditar.token, { familia_id: porEditar.id, nome: 'Tipo do editar' }), 201);

    // Renomear: editar ou salvar; novo sozinho não.
    assert.equal((await req('PATCH', `/patrimonio-familias/${porNovo.id}`, soNovo.token, { versao: 1, nome: 'Renomeada' })).statusCode, 403, 'novo não renomeia');
    assert.equal((await req('PATCH', `/patrimonio-tipos/${tipoNovo.id}`, soNovo.token, { versao: 1, nome: 'Renomeado' })).statusCode, 403);
    assert.equal((await ok(req('PATCH', `/patrimonio-familias/${porEditar.id}`, soEditar.token, { versao: 1, nome: 'Renomeada pelo editar' }))).versao, 2);
    assert.equal((await ok(req('PATCH', `/patrimonio-tipos/${tipoEditar.id}`, soEditar.token, { versao: 1, nome: 'Renomeado pelo editar' }))).versao, 2);
    assert.equal((await ok(req('PATCH', `/patrimonio-familias/${porSalvar.id}`, soSalvar.token, { versao: 1, descricao: 'pelo salvar' }))).versao, 2);

    // Inativar/reativar: a ação extra `inativar` de Bens.
    assert.equal((await req('PATCH', `/patrimonio-familias/${porEditar.id}`, soEditar.token, { versao: 2, ativo: false })).statusCode, 403, 'editar não inativa');
    assert.equal((await req('PATCH', `/patrimonio-tipos/${tipoEditar.id}`, soEditar.token, { versao: 2, ativo: false })).statusCode, 403);
    assert.equal((await req('PATCH', `/patrimonio-familias/${porEditar.id}`, soInativar.token, { versao: 2, nome: 'X', ativo: false })).statusCode, 403, 'inativar sozinho não renomeia');
    assert.equal(await versaoDa('familiaPatrimonial', porEditar.id), 2, 'nada gravado pelas recusas');
    assert.equal((await ok(req('PATCH', `/patrimonio-familias/${porEditar.id}`, soInativar.token, { versao: 2, ativo: false }))).ativo, false);
    assert.equal((await ok(req('PATCH', `/patrimonio-tipos/${tipoEditar.id}`, soInativar.token, { versao: 2, ativo: false }))).ativo, false);
    const ambos = await ok(req('PATCH', `/patrimonio-familias/${porEditar.id}`, editarInativar.token, { versao: 3, nome: 'Reativada', ativo: true }));
    assert.deepEqual([ambos.nome, ambos.ativo, ambos.versao], ['Reativada', true, 4]);
    // Administrador real e is_admin passam.
    const isAdmin = await s.conta({ is_admin: true });
    assert.equal((await req('POST', '/patrimonio-familias', isAdmin.token, { nome: 'Pelo is_admin', natureza: 'OUTRO' })).statusCode, 201);
    assert.equal((await req('POST', '/patrimonio-tipos', s.token, { familia_id: s.fam.MAQUINAS, nome: 'Pelo administrador' })).statusCode, 201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P2 — linhas antigas de permissão ficam inertes', () => {
  test('só as telas removidas (tudo ligado) e configurar_conversao: 403 em família/tipo/opções/bens/abastecimentos; nada gravado', async () => {
    const s = await montarPatrimonio(app);
    const antigas = await s.contaCom(
      ...Object.values(TELAS_ANTIGAS).map(tudo),
      linha(TELAS.abastecimentos, { configurar_conversao: true }),
    );
    const soConversao = await s.contaCom(linha(TELAS.abastecimentos, { visualizar: true, configurar_conversao: true }));
    const antes = await fotoPatrimonio(s.c);
    const rotas = [
      ['GET', '/patrimonio-familias'], ['GET', `/patrimonio-familias/${s.fam.MAQUINAS}`], ['POST', '/patrimonio-familias', { nome: 'Antiga', natureza: 'OUTRO' }],
      ['PATCH', `/patrimonio-familias/${s.fam.MAQUINAS}`, { versao: 1, nome: 'Antiga' }], ['PATCH', `/patrimonio-familias/${s.fam.MAQUINAS}`, { versao: 1, ativo: false }],
      ['GET', '/patrimonio-tipos'], ['GET', `/patrimonio-tipos/${s.tip.TRATOR_PNEUS}`], ['POST', '/patrimonio-tipos', { familia_id: s.fam.MAQUINAS, nome: 'Antigo' }],
      ['PATCH', `/patrimonio-tipos/${s.tip.TRATOR_PNEUS}`, { versao: 1, nome: 'Antigo' }],
      ['GET', '/bens-patrimoniais-opcoes/familias'], ['GET', '/bens-patrimoniais-opcoes/tipos'], ['GET', `/bens-patrimoniais-opcoes/produtos?empresa_id=${s.e1.id}`],
      ['GET', `/bens-patrimoniais?empresa_id=${s.e1.id}`], ['POST', '/patrimonio-catalogo-padrao', {}],
      ['GET', `/patrimonio-abastecimentos?empresa_id=${s.e1.id}`],
    ];
    for (const [metodo, url, corpo] of rotas) {
      const r = await req(metodo, url, antigas.token, corpo);
      assert.equal(r.statusCode, 403, `telas antigas ${metodo} ${url}: ${r.body}`);
    }
    // configurar_conversao com visualizar de Abastecimentos: só lê; nada de escrita nem de Bens.
    assert.equal((await req('GET', `/patrimonio-abastecimentos?empresa_id=${s.e1.id}`, soConversao.token)).statusCode, 200);
    // Corpos VÁLIDOS no schema (a validação vem antes da guarda): a recusa é da guarda.
    const previa = {
      empresa_id: s.e1.id, bem_id: INEXISTENTE, tanque_id: INEXISTENTE, produto_id: INEXISTENTE, local_estoque_id: INEXISTENTE, data_operacional: '2027-06-10', quantidade: '10',
    };
    for (const [metodo, url, corpo] of [
      ['POST', '/patrimonio-abastecimentos-previa', previa], ['POST', '/patrimonio-abastecimentos', { ...previa, tanque_cheio: false, operation_id: 'op-conversao-0001' }],
      ['POST', '/patrimonio-familias', { nome: 'Conversão', natureza: 'OUTRO' }], ['GET', '/patrimonio-familias'],
      ['POST', `/patrimonio-abastecimentos/${INEXISTENTE}/cancelar`, { empresa_id: s.e1.id, versao: 1, motivo: 'tentativa', operation_id: 'op-conversao-0002' }],
    ]) {
      assert.equal((await req(metodo, url, soConversao.token, corpo)).statusCode, 403, `configurar_conversao ${metodo} ${url}`);
    }
    assert.equal(await fotoPatrimonio(s.c), antes, 'nada concedido, nada gravado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P3 — opções de Produtos do tanque', () => {
  test('só Bens visualizar → 403; novo, salvar ou editar → 200; outro módulo não basta', async () => {
    const s = await montarPatrimonio(app);
    await produtoL(s, { nome: 'Diesel S10' });
    const url = `/bens-patrimoniais-opcoes/produtos?empresa_id=${s.e1.id}`;
    const soVer = await s.contaCom(linha(BENS, { visualizar: true, inativar: true, excluir: true, exportar: true }));
    assert.deepEqual(erro(await req('GET', url, soVer.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    for (const acao of ['novo', 'salvar', 'editar']) {
      const conta = await s.contaCom(linha(BENS, { visualizar: true, [acao]: true }));
      const r = await ok(req('GET', url, conta.token));
      assert.deepEqual(r.itens.map((i) => i.nome), ['Diesel S10'], acao);
    }
    const doAbastecimento = await s.contaCom(tudo(TELAS.abastecimentos));
    assert.equal((await req('GET', url, doAbastecimento.token)).statusCode, 403, 'a tela de abastecimentos não lista produtos para tanque');
    assert.equal((await req('GET', url, null)).statusCode, 401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P4 — rotas removidas, catálogo padrão e outro tenant', () => {
  test('as rotas de perfis, combustíveis, vínculos, elegíveis, opções antigas e fator kg/L respondem 404 (com e sem sessão)', async () => {
    const s = await montarPatrimonio(app);
    const id = INEXISTENTE;
    const removidas = [
      ['GET', '/patrimonio-perfis-medicao'], ['POST', '/patrimonio-perfis-medicao', {}], ['GET', `/patrimonio-perfis-medicao/${id}`], ['PATCH', `/patrimonio-perfis-medicao/${id}`, { versao: 1 }],
      ['GET', '/patrimonio-combustiveis'], ['POST', '/patrimonio-combustiveis', {}], ['GET', `/patrimonio-combustiveis/${id}`], ['PATCH', `/patrimonio-combustiveis/${id}`, { versao: 1 }],
      ['GET', `/patrimonio-combustiveis/${id}/produtos?empresa_id=${s.e1.id}`], ['POST', `/patrimonio-combustiveis/${id}/produtos`, {}],
      ['PATCH', `/patrimonio-combustivel-produtos/${id}`, { versao: 1 }], ['GET', `/patrimonio-combustiveis-opcoes/produtos?empresa_id=${s.e1.id}`],
      ['GET', `/bens-patrimoniais/${id}/produtos-elegiveis?empresa_id=${s.e1.id}`],
      ['GET', '/bens-patrimoniais-opcoes/perfis-medicao'], ['GET', '/bens-patrimoniais-opcoes/combustiveis'],
      ['GET', `/patrimonio-abastecimentos-opcoes/tipos?empresa_id=${s.e1.id}`], ['GET', `/patrimonio-abastecimentos-opcoes/produtos?empresa_id=${s.e1.id}`],
      ['GET', `/patrimonio-conversoes-combustivel?empresa_id=${s.e1.id}`], ['POST', '/patrimonio-conversoes-combustivel', {}],
      ['POST', `/patrimonio-conversoes-combustivel/${id}/encerrar`, {}],
    ];
    for (const [metodo, url, corpo] of removidas) {
      assert.equal((await req(metodo, url, s.token, corpo)).statusCode, 404, `admin ${metodo} ${url}`);
      assert.equal((await req(metodo, url, null, corpo)).statusCode, 404, `sem sessão ${metodo} ${url}`);
    }
  });

  test('catálogo padrão: só administrador real ou is_admin (P-06), mesmo com Bens tudo; família/tipo de outro tenant → 404 sem oráculo e nada alterado', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const bensTudo = await s.contaCom(tudo(BENS), tudo(TELAS.abastecimentos));
    assert.deepEqual(erro(await req('POST', '/patrimonio-catalogo-padrao', bensTudo.token, {})).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: s.c } }), 0);
    const isAdmin = await s.conta({ is_admin: true });
    assert.equal((await req('POST', '/patrimonio-catalogo-padrao', isAdmin.token, {})).statusCode, 200);

    const outro = await montarPatrimonio(app);
    const fam = await prisma().familiaPatrimonial.findFirst({ where: { cliente_id: s.c, codigo: 'MAQUINAS' } });
    const tipo = await prisma().tipoPatrimonial.findFirst({ where: { cliente_id: s.c, codigo: 'TRATOR_PNEUS' } });
    const antes = await fotoPatrimonio([s.c, outro.c]);
    for (const [base, alvo, codigo] of [['/patrimonio-familias', fam.id, 'FAMILIA_PATRIMONIAL_NAO_ENCONTRADA'], ['/patrimonio-tipos', tipo.id, 'TIPO_PATRIMONIAL_NAO_ENCONTRADO']]) {
      const alheio = await req('GET', `${base}/${alvo}`, outro.token);
      assert.deepEqual(erro(alheio).slice(0, 2), [404, codigo], base);
      assert.deepEqual(corpoErro(alheio), corpoErro(await req('GET', `${base}/${INEXISTENTE}`, outro.token)), `${base}: sem oráculo`);
      const patch = await req('PATCH', `${base}/${alvo}`, outro.token, { versao: 1, nome: 'Invasão' });
      assert.deepEqual(erro(patch).slice(0, 2), [404, codigo]);
      assert.deepEqual(corpoErro(patch), corpoErro(await req('PATCH', `${base}/${INEXISTENTE}`, outro.token, { versao: 1, nome: 'Invasão' })));
    }
    // Tipo em família alheia: 422 inexistente (o mesmo de uma família que não existe).
    const tipoAlheio = await req('POST', '/patrimonio-tipos', outro.token, { familia_id: fam.id, nome: 'Invasor' });
    assert.deepEqual(erro(tipoAlheio), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    assert.deepEqual(corpoErro(tipoAlheio), corpoErro(await req('POST', '/patrimonio-tipos', outro.token, { familia_id: INEXISTENTE, nome: 'Invasor' })));
    assert.equal(await fotoPatrimonio([s.c, outro.c]), antes, 'nada alterado');
  });
});
