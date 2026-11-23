/**
 * D-PROD-169 (MAIKE-PATRIMONIO-SIMPLIFICA-02) — "Tipo de bem" + "Tipo" no
 * cadastro de Bens (família some da tela) e Produtos aceitos em QUALQUER
 * unidade. PostgreSQL real, HTTP autenticado, prova por persistência.
 *
 *  C1. Catálogo GARANTIDO (sem botão): a primeira leitura de tipos cria as 6
 *      famílias padrão (inclusive OUTROS/OUTRO) e os tipos padrão SÓ das
 *      famílias criadas naquela chamada; 2ª leitura não cria nada; tipo padrão
 *      excluído não volta; família padrão já existente não ganha tipos; nome
 *      de família ocupado por família manual → nome alternativo; tipo padrão
 *      com nome já usado no mesmo tipo de bem → pulado; corrida cria uma vez.
 *  C2. Tipos por natureza: GET com `natureza`, `bens_em_uso`; POST por
 *      natureza (família padrão resolvida pelo servidor) e por `familia_id`
 *      (compatibilidade, conferido); nome único no tipo de bem; família padrão
 *      inativa → 422 PATRIMONIO_FAMILIA_PADRAO_INDISPONIVEL; opções do
 *      formulário por natureza (só ativos).
 *  C3. DELETE /patrimonio-tipos/:id?versao=N: livre → 204 (auditado); em uso
 *      por bem ativo ou inativo → 409 PATRIMONIO_TIPO_EM_USO { bens }; versão
 *      velha → 409; 404 cruzado; permissão = Bens editar|salvar; corrida com o
 *      cadastro do bem nunca deixa bem órfão.
 *  C4. Bem sem `familia_id`: a família vem do tipo; natureza divergente → 422
 *      BEM_TIPO_NATUREZA_INCOMPATIVEL; tipo de família manual antiga continua
 *      utilizável; PATCH troca o tipo (e a família) sem `familia_id`.
 *  C5. Rotas de família saíram (POST/PATCH e também a leitura e as opções →
 *      404, nenhuma tela as lia); opções de área também (Área saiu do Bem).
 *  C6. Produto SACO aceito no tanque e abastecido em kg: baixa EXATA, sem
 *      conferir capacidade; L continua conferindo; unidade fora de L/KG/SACO
 *      continua recusada; KG ↔ SACO de Produto aceito em tanque é permitido.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  TELAS, corpoCaminhonete, corpoCerca, corpoErro, corpoTrator, erro, http, linha, montarPatrimonio, prisma, produto, produtoKG, produtoL, tanqueCom,
} from './patrimonioP1Cenario.mjs';
import { acoesAbastecimento, corpoAbastecimento, corpoPrevia, montarAbastecimento, opId } from './patrimonioP1AbastecimentoCenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
  A = acoesAbastecimento(app);
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
const CODIGOS_FAMILIAS = ['BENFEITORIAS', 'EQUIPAMENTOS', 'IMPLEMENTOS', 'MAQUINAS', 'OUTROS', 'VEICULOS'];
const p4 = (v) => (v === null || v === undefined ? null : v.toFixed(4));
const familias = (c) => prisma().familiaPatrimonial.findMany({ where: { cliente_id: c }, orderBy: { codigo: 'asc' } });
const listarTipos = async (tok, q = '') => (await ok(req('GET', `/patrimonio-tipos?limit=100${q}`, tok))).items;
const excluirTipo = (tok, id, versao) => req('DELETE', `/patrimonio-tipos/${id}${versao === undefined ? '' : `?versao=${versao}`}`, tok);
const criarBem = (s, corpo, tok = s.token) => req('POST', '/bens-patrimoniais', tok, corpo);
const semFamilia = (corpo) => {
  const c = { ...corpo };
  delete c.familia_id;
  return c;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('C1 — catálogo padrão garantido automaticamente (sem botão)', () => {
  test('tenant vazio: a 1ª leitura de tipos cria 6 famílias (com OUTROS) e 13 tipos, auditados; a 2ª não cria nada; outro tenant independente', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const b = await montarPatrimonio(app, { catalogo: false });
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: s.c } }), 0);

    const itens = await listarTipos(s.token);
    assert.equal(itens.length, 13);
    const fams = await familias(s.c);
    assert.deepEqual(fams.map((f) => [f.codigo, f.natureza, f.ativo]), [
      ['BENFEITORIAS', 'BENFEITORIA', true], ['EQUIPAMENTOS', 'EQUIPAMENTO', true], ['IMPLEMENTOS', 'IMPLEMENTO', true], ['MAQUINAS', 'MAQUINA', true],
      ['OUTROS', 'OUTRO', true], ['VEICULOS', 'VEICULO', true],
    ]);
    const outros = fams.find((f) => f.codigo === 'OUTROS');
    assert.deepEqual([outros.nome, outros.vida_util_meses_padrao, outros.ordem], ['Outros', 120, 6]);
    const auditoria = async () =>
      (await prisma().auditLog.groupBy({ by: ['entidade'], where: { cliente_id: s.c, acao: 'create' }, _count: true })).map((g) => [g.entidade, g._count]).sort();
    assert.deepEqual(await auditoria(), [['FamiliaPatrimonial', 6], ['TipoPatrimonial', 13]], 'um evento por item criado');

    // 2ª leitura (e as outras portas de garantia): nada novo.
    await listarTipos(s.token, '&natureza=MAQUINA');
    await ok(req('GET', '/bens-patrimoniais-opcoes/tipos?natureza=VEICULO', s.token));
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: s.c } }), 6);
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: s.c } }), 13);
    assert.deepEqual(await auditoria(), [['FamiliaPatrimonial', 6], ['TipoPatrimonial', 13]]);

    // Isolado por tenant: B continua vazio até a sua primeira leitura.
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: b.c } }), 0);
    assert.equal((await ok(req('GET', '/bens-patrimoniais-opcoes/tipos', b.token))).itens.length, 13);
    assert.deepEqual((await familias(b.c)).map((f) => f.codigo), CODIGOS_FAMILIAS);
  });

  test('tipo padrão excluído NÃO volta; família padrão já existente não ganha tipos; só as famílias criadas na chamada recebem os tipos padrão', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    // Família MAQUINAS já existe (sem tipos): a garantia não cria TRATOR_* nela.
    await prisma().familiaPatrimonial.create({ data: { cliente_id: s.c, codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA' } });
    const itens = await listarTipos(s.token);
    assert.deepEqual(itens.map((i) => i.codigo).sort(), [
      'BALANCA', 'BEBEDOURO_FIXO', 'CAMINHAO', 'CAMINHONETE', 'CERCA_ARAME', 'CERCA_ELETRICA', 'CURRAL', 'GALPAO', 'GERADOR', 'RESERVATORIO', 'ROCADEIRA',
    ]);
    assert.deepEqual((await familias(s.c)).map((f) => f.codigo), CODIGOS_FAMILIAS);

    // Exclui um tipo padrão: não volta em nenhuma porta de garantia.
    const curral = itens.find((i) => i.codigo === 'CURRAL');
    assert.equal((await excluirTipo(s.token, curral.id, curral.versao)).statusCode, 204);
    await listarTipos(s.token);
    await ok(req('GET', '/bens-patrimoniais-opcoes/tipos?natureza=BENFEITORIA', s.token));
    await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'OUTRO', nome: 'Diversos' }), 201);
    await ok(criarBem(s, semFamilia(corpoCerca(s, { tipo_id: itens.find((i) => i.codigo === 'CERCA_ARAME').id, natureza: 'BENFEITORIA' }))), 201);
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: s.c, codigo: 'CURRAL' } }), 0, 'o tipo padrão excluído não volta');
  });

  test('nome de família ocupado por família manual → a padrão nasce com nome alternativo; tipo padrão com nome já usado no tipo de bem é pulado; código ocupado por outra natureza fica intacto', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const p = prisma();
    // Produção: família criada à mão (código TESTE) — aqui com o MESMO nome da padrão e um tipo com nome de tipo padrão.
    const teste = await p.familiaPatrimonial.create({ data: { cliente_id: s.c, codigo: 'TESTE', nome: 'Máquinas', natureza: 'MAQUINA' } });
    const meuTrator = await p.tipoPatrimonial.create({ data: { cliente_id: s.c, familia_id: teste.id, codigo: 'MEU_TRATOR', nome: 'trator de pneus' } });
    // Código padrão VEICULOS ocupado por família de outra natureza: não é alterado nem usado.
    const veiculosErrado = await p.familiaPatrimonial.create({ data: { cliente_id: s.c, codigo: 'VEICULOS', nome: 'Veículos?', natureza: 'OUTRO' } });

    const itens = await listarTipos(s.token);
    const maquinas = await p.familiaPatrimonial.findFirst({ where: { cliente_id: s.c, codigo: 'MAQUINAS' } });
    assert.deepEqual([maquinas.nome, maquinas.natureza, maquinas.ativo], ['Máquinas (padrão)', 'MAQUINA', true]);
    const codigos = itens.map((i) => i.codigo).sort();
    assert.ok(!codigos.includes('TRATOR_PNEUS'), 'nome já usado no tipo de bem MAQUINA: pulado');
    assert.ok(codigos.includes('TRATOR_ESTEIRAS') && codigos.includes('MEU_TRATOR'));
    assert.ok(!codigos.includes('CAMINHONETE') && !codigos.includes('CAMINHAO'), 'família VEICULOS não foi criada (código ocupado): sem tipos padrão dela');
    assert.deepEqual(await p.familiaPatrimonial.findUnique({ where: { id: veiculosErrado.id } }), veiculosErrado, 'família em conflito intacta');
    assert.deepEqual(await p.tipoPatrimonial.findUnique({ where: { id: meuTrator.id } }), meuTrator);

    // Tipos da família manual continuam visíveis e utilizáveis sob a natureza dela.
    const daMaquina = await listarTipos(s.token, '&natureza=MAQUINA');
    assert.deepEqual(daMaquina.map((i) => i.codigo).sort(), ['MEU_TRATOR', 'TRATOR_ESTEIRAS']);
    // Sem família padrão utilizável para VEICULO: tipo novo → 422 claro, nada gravado.
    const semPadrao = await req('POST', '/patrimonio-tipos', s.token, { natureza: 'VEICULO', nome: 'Moto' });
    assert.deepEqual(erro(semPadrao), [422, 'PATRIMONIO_FAMILIA_PADRAO_INDISPONIVEL', 'natureza', 'familia_padrao_indisponivel']);
    assert.match(semPadrao.json().message, /Veículo/);
    assert.equal(await p.tipoPatrimonial.count({ where: { cliente_id: s.c, nome: 'Moto' } }), 0);
  });

  test('corrida: leituras simultâneas num tenant vazio criam o catálogo UMA vez', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const rs = await Promise.all([
      req('GET', '/patrimonio-tipos', s.token), req('GET', '/bens-patrimoniais-opcoes/tipos', s.token), req('GET', '/patrimonio-tipos?natureza=OUTRO', s.token),
    ]);
    assert.deepEqual(rs.map((r) => r.statusCode), [200, 200, 200], rs.map((r) => r.body).join(' '));
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: s.c } }), 6);
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: s.c } }), 13);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, acao: 'create' } }), 19);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C2 — tipos por "Tipo de bem" (natureza)', () => {
  test('GET com natureza e bens_em_uso; POST por natureza vai para a família padrão; compatibilidade com familia_id conferida; nome único no tipo de bem; opções do formulário só ativas', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const t = s.token;
    const trator = await ok(criarBem(s, corpoTrator(s)), 201);
    await ok(criarBem(s, corpoTrator(s, { nome: 'Trator 2', codigo_frota: null, tanques: [] })), 201);

    const maquinas = await listarTipos(t, '&natureza=MAQUINA');
    assert.deepEqual(maquinas.map((i) => [i.codigo, i.natureza, i.familia_id, i.bens_em_uso]).sort(), [
      ['TRATOR_ESTEIRAS', 'MAQUINA', s.fam.MAQUINAS, 0], ['TRATOR_PNEUS', 'MAQUINA', s.fam.MAQUINAS, 2],
    ]);
    const item = maquinas.find((i) => i.codigo === 'TRATOR_PNEUS');
    assert.deepEqual(Object.keys(item).sort(), [
      'ativo', 'bens_em_uso', 'capacidade', 'capacidade_unidade', 'codigo', 'created_date', 'descricao', 'familia', 'familia_id', 'forma_produto', 'id', 'natureza', 'nome', 'salto_maximo_medidor', 'updated_date', 'usa_produto', 'versao', 'vida_util_meses_sugerida',
    ]);
    assert.equal(trator.tipo.id, item.id);
    assert.equal((await listarTipos(t, '&natureza=OUTRO')).length, 0, 'OUTROS sem tipos padrão');
    assert.equal((await req('GET', '/patrimonio-tipos?natureza=FROTA', t)).statusCode, 400);

    // POST por natureza: a família padrão é resolvida pelo servidor.
    const escav = await ok(req('POST', '/patrimonio-tipos', t, { natureza: 'MAQUINA', nome: 'Escavadeira', descricao: null, vida_util_meses_sugerida: 96 }), 201);
    assert.deepEqual([escav.codigo, escav.natureza, escav.familia_id, escav.bens_em_uso, escav.vida_util_meses_sugerida], ['ESCAVADEIRA', 'MAQUINA', s.fam.MAQUINAS, 0, 96]);
    const diversos = await ok(req('POST', '/patrimonio-tipos', t, { natureza: 'OUTRO', nome: 'Diversos' }), 201);
    const outrosId = (await prisma().familiaPatrimonial.findFirst({ where: { cliente_id: s.c, codigo: 'OUTROS' } })).id;
    assert.equal(diversos.familia_id, outrosId);
    // Compatibilidade: familia_id do tenant e da MESMA natureza.
    assert.equal((await ok(req('POST', '/patrimonio-tipos', t, { familia_id: s.fam.MAQUINAS, natureza: 'MAQUINA', nome: 'Retroescavadeira' }), 201)).familia_id, s.fam.MAQUINAS);
    assert.equal((await ok(req('POST', '/patrimonio-tipos', t, { familia_id: s.fam.MAQUINAS, nome: 'Motoniveladora' }), 201)).natureza, 'MAQUINA');
    assert.deepEqual(erro(await req('POST', '/patrimonio-tipos', t, { familia_id: s.fam.VEICULOS, natureza: 'MAQUINA', nome: 'Errado' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'natureza_diferente']);
    assert.deepEqual(erro(await req('POST', '/patrimonio-tipos', t, { familia_id: outro.fam.MAQUINAS, nome: 'Alheio' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    assert.deepEqual(erro(await req('POST', '/patrimonio-tipos', t, { nome: 'Sem tipo de bem' })), [400, 'REQUEST_VALIDATION_FAILED', 'natureza', 'obrigatorio']);
    for (const corpo of [{ natureza: 'FROTA', nome: 'x' }, { natureza: 'MAQUINA' }, { natureza: 'MAQUINA', nome: 'x', cliente_id: s.c }, { natureza: 'MAQUINA', nome: 'x', perfis: [] }]) {
      assert.equal((await req('POST', '/patrimonio-tipos', t, corpo)).statusCode, 400, JSON.stringify(corpo));
    }

    // Nome único DENTRO do tipo de bem (todas as famílias da natureza), sem diferenciar maiúsculas.
    const manual = await prisma().familiaPatrimonial.create({ data: { cliente_id: s.c, codigo: 'TESTE', nome: 'Teste', natureza: 'MAQUINA' } });
    const doTeste = await prisma().tipoPatrimonial.create({ data: { cliente_id: s.c, familia_id: manual.id, codigo: 'PA_CARREGADEIRA', nome: 'Pá carregadeira' } });
    assert.deepEqual(erro(await req('POST', '/patrimonio-tipos', t, { natureza: 'MAQUINA', nome: 'PÁ CARREGADEIRA' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    assert.deepEqual(erro(await req('POST', '/patrimonio-tipos', t, { natureza: 'MAQUINA', nome: 'trator de pneus' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    assert.equal((await req('POST', '/patrimonio-tipos', t, { natureza: 'VEICULO', nome: 'Trator de pneus' })).statusCode, 201, 'o mesmo nome em outro tipo de bem');
    // Renomear (PATCH com versão): o nome também é único no tipo de bem.
    assert.deepEqual(erro(await req('PATCH', `/patrimonio-tipos/${escav.id}`, t, { versao: 1, nome: 'pá carregadeira' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    const renomeado = await ok(req('PATCH', `/patrimonio-tipos/${escav.id}`, t, { versao: 1, nome: 'Escavadeira hidráulica' }));
    assert.deepEqual([renomeado.nome, renomeado.versao, renomeado.natureza], ['Escavadeira hidráulica', 2, 'MAQUINA']);
    assert.deepEqual(erro(await req('PATCH', `/patrimonio-tipos/${escav.id}`, t, { versao: 1, nome: 'Outro nome' })).slice(0, 2), [409, 'PATRIMONIO_VERSAO_CONFLITO']);
    assert.equal((await req('PATCH', `/patrimonio-tipos/${escav.id}`, t, { versao: 2, natureza: 'VEICULO' })).statusCode, 400, 'natureza do tipo é imutável');

    // Opções do formulário: só ATIVOS da natureza (inclui tipo de família manual), forma fixa.
    await ok(req('PATCH', `/patrimonio-tipos/${doTeste.id}`, t, { versao: 1, ativo: false }));
    const opcoes = await ok(req('GET', '/bens-patrimoniais-opcoes/tipos?natureza=MAQUINA&limit=100', t));
    assert.deepEqual(opcoes.itens.map((i) => i.nome), ['Escavadeira hidráulica', 'Motoniveladora', 'Retroescavadeira', 'Trator de esteiras', 'Trator de pneus']);
    assert.deepEqual(opcoes.itens[0], { id: escav.id, codigo: 'ESCAVADEIRA', nome: 'Escavadeira hidráulica', familia_id: s.fam.MAQUINAS, natureza: 'MAQUINA' });
    await prisma().tipoPatrimonial.update({ where: { id: doTeste.id }, data: { ativo: true } });
    await prisma().familiaPatrimonial.update({ where: { id: manual.id }, data: { ativo: false } });
    assert.ok(!(await ok(req('GET', '/bens-patrimoniais-opcoes/tipos?natureza=MAQUINA&limit=100', t))).itens.some((i) => i.id === doTeste.id), 'família inativa: tipo fora das opções');
    assert.equal((await req('GET', '/bens-patrimoniais-opcoes/tipos?natureza=XYZ', t)).statusCode, 400);
  });

  test('família padrão INATIVA (dado antigo) não é alterada: tipo novo daquela natureza → 422 claro; as outras naturezas seguem', async () => {
    const s = await montarPatrimonio(app);
    await prisma().familiaPatrimonial.update({ where: { id: s.fam.IMPLEMENTOS }, data: { ativo: false } });
    const r = await req('POST', '/patrimonio-tipos', s.token, { natureza: 'IMPLEMENTO', nome: 'Grade aradora' });
    assert.deepEqual(erro(r), [422, 'PATRIMONIO_FAMILIA_PADRAO_INDISPONIVEL', 'natureza', 'familia_padrao_indisponivel']);
    assert.deepEqual(r.json().details.natureza, 'IMPLEMENTO');
    assert.equal((await prisma().familiaPatrimonial.findUnique({ where: { id: s.fam.IMPLEMENTOS } })).ativo, false, 'a garantia não reativa');
    assert.equal((await req('POST', '/patrimonio-tipos', s.token, { natureza: 'EQUIPAMENTO', nome: 'Compressor' })).statusCode, 201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C3 — excluir tipo (DELETE /patrimonio-tipos/:id?versao=N)', () => {
  test('livre → 204, auditado, some de verdade; em uso por bem ativo ou inativo → 409 PATRIMONIO_TIPO_EM_USO { bens }; versão velha 409; 404 cruzado; validação 400', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const t = s.token;
    const livre = await ok(req('POST', '/patrimonio-tipos', t, { natureza: 'OUTRO', nome: 'Sem uso' }), 201);
    assert.deepEqual(erro(await excluirTipo(t, livre.id, 2)).slice(0, 2), [409, 'PATRIMONIO_VERSAO_CONFLITO']);
    assert.equal((await excluirTipo(t, livre.id)).statusCode, 400, 'versão obrigatória');
    assert.equal((await excluirTipo(t, livre.id, 0)).statusCode, 400);
    assert.equal((await req('DELETE', `/patrimonio-tipos/${livre.id}?versao=1&cliente_id=${s.c}`, t)).statusCode, 400);
    const alheio = await excluirTipo(outro.token, livre.id, 1);
    const inexistente = await excluirTipo(outro.token, INEXISTENTE, 1);
    assert.deepEqual(erro(alheio).slice(0, 2), [404, 'TIPO_PATRIMONIAL_NAO_ENCONTRADO']);
    assert.deepEqual(corpoErro(alheio), corpoErro(inexistente), '404 sem oráculo');
    const r = await excluirTipo(t, livre.id, 1);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal(r.body, '');
    assert.equal(await prisma().tipoPatrimonial.count({ where: { id: livre.id } }), 0);
    assert.equal((await req('GET', `/patrimonio-tipos/${livre.id}`, t)).statusCode, 404);
    const ev = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, entidade: 'TipoPatrimonial', entidade_id: livre.id, acao: 'delete' } });
    assert.ok(ev, 'exclusão auditada');
    assert.equal(ev.usuario_id, s.adm.usuario.id);
    assert.deepEqual(Object.keys(/** @type {any} */ (ev.dados_anteriores)).sort(), ['ativo', 'codigo', 'familia_id', 'id', 'versao']);
    assert.ok(!JSON.stringify([ev.dados_anteriores, ev.dados_novos]).includes('Sem uso'), 'auditoria sem texto livre');
    assert.equal((await excluirTipo(t, livre.id, 1)).statusCode, 404, 'a 2ª exclusão não acha');

    // Em uso: bem ativo na fazenda 1 e bem INATIVO na fazenda 2.
    const emUso = await ok(req('POST', '/patrimonio-tipos', t, { natureza: 'BENFEITORIA', nome: 'Mangueira' }), 201);
    const b1 = await ok(criarBem(s, semFamilia(corpoCerca(s, { tipo_id: emUso.id }))), 201);
    const b2 = await ok(criarBem(s, semFamilia(corpoCerca(s, { empresa_id: s.e2.id, tipo_id: emUso.id }))), 201);
    await ok(req('PATCH', `/bens-patrimoniais/${b2.id}`, t, { empresa_id: s.e2.id, versao: b2.versao, ativo: false }));
    const recusa = await excluirTipo(t, emUso.id, 1);
    assert.deepEqual(erro(recusa), [409, 'PATRIMONIO_TIPO_EM_USO', 'id', 'tipo_em_uso']);
    assert.equal(recusa.json().message, 'Este tipo está em uso por 2 bem(ns). Troque o tipo desses bens antes de excluir.');
    assert.equal(recusa.json().details.bens, 2);
    assert.equal(await prisma().tipoPatrimonial.count({ where: { id: emUso.id } }), 1, 'nada apagado');
    assert.equal((await listarTipos(t, '&natureza=BENFEITORIA')).find((i) => i.id === emUso.id).bens_em_uso, 2);
    // Trocado o tipo dos dois bens, a exclusão passa.
    await ok(req('PATCH', `/bens-patrimoniais/${b1.id}`, t, { empresa_id: s.e1.id, versao: b1.versao, tipo_id: s.tip.CERCA_ARAME }));
    const b2Atual = await prisma().bemPatrimonial.findUnique({ where: { id: b2.id } });
    await ok(req('PATCH', `/bens-patrimoniais/${b2.id}`, t, { empresa_id: s.e2.id, versao: b2Atual.versao, tipo_id: s.tip.CERCA_ARAME }));
    assert.equal((await excluirTipo(t, emUso.id, 1)).statusCode, 204);
    assert.equal((await excluirTipo(t, s.tip.CERCA_ARAME, 1)).json().details.bens, 2);
  });

  test('permissão: excluir = Bens editar|salvar (a de renomear); novo/visualizar/inativar sozinhos → 403; sem sessão 401', async () => {
    const s = await montarPatrimonio(app);
    const bens = TELAS.bens;
    const soVer = await s.contaCom(linha(bens, { visualizar: true }));
    const soNovo = await s.contaCom(linha(bens, { visualizar: true, novo: true }));
    const soInativar = await s.contaCom(linha(bens, { visualizar: true, inativar: true, excluir: true }));
    const soEditar = await s.contaCom(linha(bens, { visualizar: true, editar: true }));
    const soSalvar = await s.contaCom(linha(bens, { visualizar: true, salvar: true }));
    const [a, b] = [
      await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'OUTRO', nome: 'Apagar A' }), 201),
      await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'OUTRO', nome: 'Apagar B' }), 201),
    ];
    for (const conta of [soVer, soNovo, soInativar]) assert.deepEqual(erro(await excluirTipo(conta.token, a.id, 1)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.equal((await excluirTipo(null, a.id, 1)).statusCode, 401);
    assert.equal(await prisma().tipoPatrimonial.count({ where: { id: { in: [a.id, b.id] } } }), 2, 'nada apagado pelas recusas');
    assert.equal((await excluirTipo(soEditar.token, a.id, 1)).statusCode, 204);
    assert.equal((await excluirTipo(soSalvar.token, b.id, 1)).statusCode, 204);
  });

  test('corrida: excluir o tipo enquanto um bem é cadastrado com ele → nunca bem órfão (204 + 422, ou 201 + 409)', async () => {
    const s = await montarPatrimonio(app);
    for (let i = 0; i < 4; i += 1) {
      const tipo = await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'BENFEITORIA', nome: `Corrida ${i}` }), 201);
      const [d, c] = await Promise.all([excluirTipo(s.token, tipo.id, 1), criarBem(s, semFamilia(corpoCerca(s, { nome: `Cerca ${i}`, tipo_id: tipo.id })))]);
      const par = [d.statusCode, c.statusCode];
      assert.ok(
        (par[0] === 204 && par[1] === 422 && c.json().code === 'BEM_REFERENCIA_INVALIDA') || (par[0] === 409 && par[1] === 201 && d.json().code === 'PATRIMONIO_TIPO_EM_USO'),
        `${par} ${d.body} ${c.body}`,
      );
      const bens = await prisma().bemPatrimonial.count({ where: { tipo_id: tipo.id } });
      const existe = await prisma().tipoPatrimonial.count({ where: { id: tipo.id } });
      assert.deepEqual([bens, existe], par[0] === 204 ? [0, 0] : [1, 1]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C4 — bem sem familia_id (a família vem do tipo)', () => {
  test('POST com natureza + tipo_id (ou só tipo_id) deriva a família; natureza divergente 422; tipo de família manual utilizável; familia_id (compatibilidade) tem de bater', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    const trator = await ok(criarBem(s, semFamilia(corpoTrator(s, { natureza: 'MAQUINA' }))), 201);
    assert.deepEqual([trator.natureza, trator.familia.id, trator.tipo.id], ['MAQUINA', s.fam.MAQUINAS, s.tip.TRATOR_PNEUS]);
    const gravado = await p.bemPatrimonial.findUnique({ where: { id: trator.id } });
    assert.deepEqual([gravado.familia_id, gravado.tipo_id, gravado.natureza], [s.fam.MAQUINAS, s.tip.TRATOR_PNEUS, 'MAQUINA']);
    const soTipo = await ok(criarBem(s, semFamilia(corpoCerca(s))), 201);
    assert.deepEqual([soTipo.natureza, soTipo.familia.id], ['BENFEITORIA', s.fam.BENFEITORIAS], 'sem natureza: a do tipo');

    // Natureza divergente do tipo → 422 claro; nada gravado.
    const antes = await p.bemPatrimonial.count({ where: { cliente_id: s.c } });
    const divergente = await criarBem(s, semFamilia(corpoTrator(s, { natureza: 'VEICULO', codigo_frota: null })));
    assert.deepEqual(erro(divergente), [422, 'BEM_TIPO_NATUREZA_INCOMPATIVEL', 'tipo_id', 'natureza_diferente']);
    assert.match(divergente.json().message, /Máquina/);
    assert.match(divergente.json().message, /Veículo/);
    assert.deepEqual(erro(await criarBem(s, semFamilia(corpoTrator(s, { natureza: 'MAQUINA', tipo_id: INEXISTENTE })))), [422, 'BEM_REFERENCIA_INVALIDA', 'tipo_id', 'inexistente']);
    assert.equal((await criarBem(s, semFamilia(corpoTrator(s, { natureza: 'FROTA' })))).statusCode, 400);
    assert.equal((await criarBem(s, semFamilia(corpoTrator(s, { tipo_id: undefined })))).statusCode, 400, 'tipo_id obrigatório');
    // familia_id (compatibilidade) que não bate com o tipo.
    assert.deepEqual(erro(await criarBem(s, corpoTrator(s, { familia_id: s.fam.EQUIPAMENTOS, codigo_frota: null }))).slice(0, 2), [422, 'BEM_TIPO_FAMILIA_INCOMPATIVEL']);
    assert.equal(await p.bemPatrimonial.count({ where: { cliente_id: s.c } }), antes, 'nada gravado');

    // Tipo de família manual antiga: utilizável sob a natureza dela.
    const teste = await p.familiaPatrimonial.create({ data: { cliente_id: s.c, codigo: 'TESTE', nome: 'Teste', natureza: 'MAQUINA' } });
    const escav = await p.tipoPatrimonial.create({ data: { cliente_id: s.c, familia_id: teste.id, codigo: 'ESCAVADEIRA', nome: 'Escavadeira' } });
    const doTeste = await ok(criarBem(s, semFamilia(corpoTrator(s, { natureza: 'MAQUINA', tipo_id: escav.id, codigo_frota: 'ESC-1' }))), 201);
    assert.equal(doTeste.familia.id, teste.id);

    // PATCH: troca o tipo sem familia_id → a família acompanha; natureza imutável.
    const trocado = await ok(req('PATCH', `/bens-patrimoniais/${trator.id}`, s.token, { empresa_id: s.e1.id, versao: 1, tipo_id: escav.id }));
    assert.deepEqual([trocado.tipo.id, trocado.familia.id, trocado.versao], [escav.id, teste.id, 2]);
    assert.equal((await p.bemPatrimonial.findUnique({ where: { id: trator.id } })).familia_id, teste.id);
    assert.deepEqual(erro(await req('PATCH', `/bens-patrimoniais/${trator.id}`, s.token, { empresa_id: s.e1.id, versao: 2, tipo_id: s.tip.CAMINHONETE })), [422, 'BEM_TIPO_NATUREZA_INCOMPATIVEL', 'tipo_id', 'natureza_diferente']);
    assert.deepEqual(erro(await req('PATCH', `/bens-patrimoniais/${trator.id}`, s.token, { empresa_id: s.e1.id, versao: 2, natureza: 'VEICULO' })), [409, 'BEM_NATUREZA_IMUTAVEL', 'natureza', 'natureza_diferente']);
    const mesma = await ok(req('PATCH', `/bens-patrimoniais/${trator.id}`, s.token, { empresa_id: s.e1.id, versao: 2, natureza: 'MAQUINA', tipo_id: s.tip.TRATOR_ESTEIRAS }));
    assert.deepEqual([mesma.tipo.id, mesma.familia.id, mesma.versao], [s.tip.TRATOR_ESTEIRAS, s.fam.MAQUINAS, 3]);

    // Área e localização: a tela não envia; o servidor continua aceitando e preserva o valor gravado.
    const comArea = await ok(criarBem(s, semFamilia(corpoCerca(s, { nome: 'Cerca com área', area_id: s.area1.id, localizacao_descricao: 'Perto do curral' }))), 201);
    const semCampos = await ok(req('PATCH', `/bens-patrimoniais/${comArea.id}`, s.token, { empresa_id: s.e1.id, versao: 1, nome: 'Cerca renomeada' }));
    assert.deepEqual([semCampos.area?.id, semCampos.localizacao_descricao], [s.area1.id, 'Perto do curral']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C5 — cadastro de família saiu', () => {
  test('nenhuma rota de família (leitura, opções e escrita → 404, com e sem sessão) nem de opções de área; nada gravado', async () => {
    const s = await montarPatrimonio(app);
    const antes = await familias(s.c);
    for (const [metodo, url, corpo] of [
      ['GET', '/patrimonio-familias', undefined],
      ['GET', `/patrimonio-familias/${s.fam.MAQUINAS}`, undefined],
      ['GET', '/bens-patrimoniais-opcoes/familias', undefined],
      ['GET', `/bens-patrimoniais-opcoes/areas?empresa_id=${s.e1.id}`, undefined],
      ['POST', '/patrimonio-familias', { nome: 'Nova', natureza: 'OUTRO' }],
      ['PATCH', `/patrimonio-familias/${s.fam.MAQUINAS}`, { versao: 1, nome: 'Renomeada' }],
      ['PATCH', `/patrimonio-familias/${s.fam.MAQUINAS}`, { versao: 1, ativo: false }],
      ['DELETE', `/patrimonio-familias/${s.fam.MAQUINAS}`, undefined],
    ]) {
      assert.equal((await req(metodo, url, s.token, corpo)).statusCode, 404, `${metodo} ${url}`);
      assert.equal((await req(metodo, url, null, corpo)).statusCode, 404, `${metodo} ${url} sem sessão`);
    }
    assert.deepEqual(await familias(s.c), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C6 — Produtos aceitos em qualquer unidade (SACO abastece em kg)', () => {
  test('SACO aceito no tanque e listado nas opções; abastecimento em kg baixa EXATAMENTE a quantidade, sem conferir capacidade; cancelar devolve; L ainda confere capacidade', async () => {
    const s = await montarAbastecimento(app);
    const p = prisma();
    // Mais 200 kg no Produto em SACO (lote "legado" já criado: 100 kg a 3,00).
    await s.lote(s.e1, s.emSaco, s.local, { quantidade: '200.0000', custo: '3.5000', dia: '2027-06-02' });
    const listaOpcoes = await ok(req('GET', `/bens-patrimoniais-opcoes/produtos?empresa_id=${s.e1.id}&unidade=SACO`, s.token));
    assert.deepEqual(listaOpcoes.itens.map((i) => [i.id, i.unidade_principal_estoque]), [[s.emSaco.id, 'SACO']]);
    assert.ok((await ok(req('GET', `/bens-patrimoniais-opcoes/produtos?empresa_id=${s.e1.id}`, s.token))).itens.some((i) => i.id === s.emSaco.id));

    // Tanque do trator (180 L) passa a aceitar o Produto em SACO.
    const patch = await s.patchAceites(s.trator, [[s.diesel.id, s.dieselKg.id, s.emSaco.id]]);
    assert.equal(patch.statusCode, 200, patch.body);
    assert.ok(patch.json().tanques[0].produtos.some((x) => x.produto_id === s.emSaco.id && x.unidade_principal_estoque === 'SACO'));

    // Opções do abastecimento: elegível, com a unidade do abastecimento = KG.
    const tanques = await ok(A.opcoes(s.operador.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${s.trator.id}`));
    const doSaco = tanques.itens[0].produtos.find((x) => x.id === s.emSaco.id);
    assert.deepEqual([doSaco.elegivel, doSaco.motivo, doSaco.unidade_principal_estoque, doSaco.unidade_abastecimento], [true, null, 'SACO', 'KG']);
    const doBem = await ok(A.produtosDoBem(s.operador.token, s.e1.id, s.trator.id));
    const itemSaco = doBem.itens.find((x) => x.id === s.emSaco.id);
    assert.deepEqual([itemSaco.pronto, itemSaco.produto.unidade_principal_estoque, itemSaco.produto.unidade_abastecimento], [true, 'SACO', 'KG']);
    assert.equal(doBem.resumo.total, 3);
    const locais = await ok(A.opcoes(s.operador.token, 'locais', `empresa_id=${s.e1.id}&produto_id=${s.emSaco.id}`));
    assert.deepEqual(locais.itens.map((l) => [l.local_estoque_id, l.disponivel, l.unidade, l.unidade_principal_estoque]), [[s.local.id, '300.0000', 'KG', 'SACO']]);

    // Prévia: 250 kg > 180 (capacidade em litros) → sem bloqueio; unidade KG; sem conferir capacidade.
    const corpoSaco = { produto_id: s.emSaco.id, quantidade: '250', medidor_leitura: '1600' };
    const previa = await ok(A.previa(s.operador.token, corpoPrevia(s, corpoSaco)));
    assert.deepEqual(previa.bloqueios, []);
    assert.deepEqual([previa.plano.unidade, previa.plano.confere_capacidade, previa.plano.quantidade, previa.plano.estoque.unidade, previa.plano.produto.unidade_abastecimento], ['KG', false, '250.0000', 'KG', 'KG']);
    assert.deepEqual(previa.plano.fifo.fatias.map((f) => f.quantidade), ['100.0000', '150.0000']);

    const estoqueAntes = (await p.produto.findUnique({ where: { id: s.emSaco.id } })).estoque_atual;
    const feito = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, corpoSaco));
    assert.deepEqual([feito.quantidade, feito.unidade, feito.produto.unidade_principal_estoque], ['250.0000', 'KG', 'SACO']);
    const linhaAb = await p.abastecimentoBem.findUnique({ where: { id: feito.id } });
    const mov = await p.movimentacaoEstoque.findUnique({ where: { id: linhaAb.movimentacao_estoque_id } });
    assert.deepEqual([p4(linhaAb.quantidade), linhaAb.unidade, p4(mov.quantidade), mov.unidade_medida], ['250.0000', 'KG', '250.0000', 'KG']);
    const estoqueDepois = (await p.produto.findUnique({ where: { id: s.emSaco.id } })).estoque_atual;
    assert.equal(p4(estoqueAntes.minus(estoqueDepois)), '250.0000', 'baixa EXATA da quantidade digitada (kg)');
    const lotes = await p.estoqueLoteNota.findMany({ where: { produto_id: s.emSaco.id }, orderBy: { data_documento: 'asc' } });
    assert.deepEqual(lotes.map((l) => p4(l.quantidade_disponivel)), ['0.0000', '50.0000']);

    // Cancelar: estorno exato (unidade efetiva kg = kg).
    const cancel = await A.cancelar(s.contaCancelar.token, feito.id, { empresa_id: s.e1.id, versao: feito.versao, motivo: 'lançado errado', operation_id: opId() });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.equal(p4((await p.produto.findUnique({ where: { id: s.emSaco.id } })).estoque_atual), p4(estoqueAntes));

    // L continua conferindo a capacidade (180 L).
    const excede = await A.previa(s.operador.token, corpoPrevia(s, { quantidade: '181', medidor_leitura: '1600' }));
    assert.equal(excede.statusCode, 200, excede.body);
    assert.equal(excede.json().bloqueios[0].code, 'ABASTECIMENTO_EXCEDE_CAPACIDADE', 'L: capacidade conferida (antes do saldo)');
    assert.equal(excede.json().plano.confere_capacidade, true);
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade: '181', medidor_leitura: '1600' }))).slice(0, 2), [422, 'ABASTECIMENTO_EXCEDE_CAPACIDADE']);
  });

  test('unidade fora de L/KG/SACO continua recusada (tanque, opções e abastecimento); KG ↔ SACO de Produto aceito em tanque é permitido; L com histórico continua travado', async () => {
    const s = await montarPatrimonio(app);
    const un = await produto(s, 'UN', { nome: 'Peça avulsa' });
    const graxa = await produtoKG(s, { nome: 'Graxa' });
    const diesel = await produtoL(s, { nome: 'Diesel' });
    const recusa = await criarBem(s, corpoTrator(s, { tanques: [tanqueCom([un.id])] }));
    assert.deepEqual(erro(recusa), [422, 'TANQUE_PRODUTO_INVALIDO', 'tanques[0].produto_ids', 'unidade_incompativel']);
    assert.match(recusa.json().message, /litros \(L\), quilos \(KG\) ou sacos \(SACO\)/);
    assert.equal((await req('GET', `/bens-patrimoniais-opcoes/produtos?empresa_id=${s.e1.id}&unidade=UN`, s.token)).statusCode, 400);
    const opcoes = await ok(req('GET', `/bens-patrimoniais-opcoes/produtos?empresa_id=${s.e1.id}`, s.token));
    assert.ok(!opcoes.itens.some((i) => i.id === un.id));

    await ok(criarBem(s, corpoTrator(s, { tanques: [tanqueCom([graxa.id, diesel.id])] })), 201);
    // KG → SACO com aceite que vale: mesma unidade efetiva (kg) → 200; e de volta.
    const paraSaco = await req('PATCH', `/produtos/${graxa.id}`, s.token, { unidade_principal_estoque: 'SACO', peso_por_saco_kg: 20 });
    assert.equal(paraSaco.statusCode, 200, paraSaco.body);
    assert.equal((await req('PATCH', `/produtos/${graxa.id}`, s.token, { unidade_principal_estoque: 'KG' })).statusCode, 200);
    // MAIKE-ESTOQUE-P1-02 (M3): unidade nova fora de KG/SACO/L é recusada antes da regra do tanque (antes: 409 aceito_em_tanque).
    const paraUn = await req('PATCH', `/produtos/${graxa.id}`, s.token, { unidade_principal_estoque: 'UN' });
    assert.deepEqual(erro(paraUn), [400, 'REQUEST_VALIDATION_FAILED', 'unidade_principal_estoque', 'unidade_invalida']);
    // L → SACO sem histórico: a regra de L (só sem histórico) continua; o aceite não trava.
    assert.equal((await req('PATCH', `/produtos/${diesel.id}`, s.token, { unidade_principal_estoque: 'SACO', peso_por_saco_kg: 25 })).statusCode, 200);
    const cam = await ok(criarBem(s, corpoCaminhonete(s, { tanques: [tanqueCom([diesel.id], { identificador: 'Tanque', capacidade_litros: '80' })] })), 201);
    assert.equal(cam.tanques[0].produtos[0].unidade_principal_estoque, 'SACO');
  });
});
