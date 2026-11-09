/**
 * D-PROD-157 — Patrimônio P1-01: BENS PATRIMONIAIS (por fazenda). PostgreSQL
 * real, HTTP autenticado, prova por persistência (fotografia das tabelas).
 *
 *  B1. Aceite do proprietário: um bem de cada (cerca 1.250 m; curral m² +
 *      cabeças; reservatório L; trator TP-02 horímetro + diesel S10 180 L;
 *      caminhonete flex UT-04 odômetro 80 L; implemento sem motor/tanque;
 *      gerador "sem medidor"), relidos idênticos na forma fixa do A13; estoque
 *      e financeiro intactos.
 *  B2. Medições: conversões exatas, m²→L recusado, zero/negativo/não numérico/
 *      overflow, inteiro em cabeças/quantidade (A10), limites, sync do PATCH
 *      com troca da principal (A5).
 *  B3. Tanques: flex aceito, combustível inexistente/inativo/GNV recusado,
 *      identificador, capacidade, limite de ativos (A11), troca de
 *      identificadores (A5), tanque nunca removido.
 *  B4. Medidor (A2): obrigatoriedade por natureza, transições, correção de
 *      cadastro auditada, ajuste, imutáveis depois do ajuste, regressão sem
 *      mutação parcial, empresa sem fuso.
 *  B5. Aquisição, depreciação e prévia (§6, A6, A14): prévia sem escrita,
 *      estado final do PATCH.
 *  B6. Código de frota, identificação, classificação, referências da fazenda,
 *      versão/concorrência, inativação e listagem.
 *  B7. Opções que dependem da fazenda.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  ESTOQUE_FINANCEIRO_VAZIOS, HOJE, contagemForaDoPatrimonio, contagens, corpoCaminhonete, corpoCerca, corpoCurral, corpoGerador, corpoImplemento, corpoReservatorio,
  corpoTrator, erro, fotoPatrimonio, http, montarPatrimonio, prisma,
} from './patrimonioP1Cenario.mjs';

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
const criar = (s, corpo, tok = s.token) => req('POST', '/bens-patrimoniais', tok, corpo);
const criarOk = (s, corpo, tok = s.token) => ok(criar(s, corpo, tok), 201);
const detalhe = (s, id, empresa = s.e1.id, tok = s.token) => ok(req('GET', `/bens-patrimoniais/${id}?empresa_id=${empresa}`, tok));
const patch = (s, id, corpo, tok = s.token) => req('PATCH', `/bens-patrimoniais/${id}`, tok, { empresa_id: s.e1.id, ...corpo });
const patchOk = (s, id, corpo, tok = s.token) => ok(patch(s, id, corpo, tok));
const previa = (s, corpo, tok = s.token) => req('POST', '/bens-patrimoniais-previa-depreciacao', tok, { empresa_id: s.e1.id, ...corpo });
const sem = (obj, ...chaves) => Object.fromEntries(Object.entries(obj).filter(([k]) => !chaves.includes(k)));
const semId = (lista) => lista.map((x) => sem(x, 'id'));

/** A recusa tem o `[status, code, field, reason]` esperado e não grava nada (nem auditoria). */
const recusa = async (s, pedido, esperado) => {
  const antes = await fotoPatrimonio(s.c);
  const r = await pedido;
  assert.deepEqual(erro(r), esperado, r.body);
  assert.equal(await fotoPatrimonio(s.c), antes, `${esperado[1]}: nada gravado`);
  return r;
};
/** 400 do schema/anti-coerção sem gravar nada. */
const recusa400 = async (s, pedido, rotulo) => {
  const antes = await fotoPatrimonio(s.c);
  const r = await pedido;
  assert.equal(r.statusCode, 400, `${rotulo}: ${r.body}`);
  assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED', rotulo);
  assert.equal(await fotoPatrimonio(s.c), antes, `${rotulo}: nada gravado`);
  return r;
};

/** Chaves FIXAS do detalhe (A13). */
const CHAVES_DETALHE = [
  'ano_conclusao', 'ano_fabricacao', 'ano_modelo', 'aquisicao', 'area', 'ativo', 'centro_custo', 'chassi', 'codigo_frota', 'compatibilidade', 'consumo',
  'created_date', 'depreciacao', 'empresa_id', 'especificacoes', 'familia', 'id', 'localizacao_descricao', 'marca', 'material', 'medicoes', 'medidor',
  'modelo', 'natureza', 'nome', 'numero', 'numero_serie', 'observacoes', 'placa', 'placa_uf', 'potencia_cv', 'propriedade', 'proprietario', 'renavam',
  'responsavel', 'tanques', 'tipo', 'updated_date', 'versao',
];
const AQUISICAO_VAZIA = { data_aquisicao: null, data_disponibilidade: null, valor_aquisicao: null, custo_incorporacao: null, fornecedor: null, documento_referencia: null, garantia_ate: null };
const DEPRECIACAO_VAZIA = {
  depreciavel: false, metodo: null, vida_util_meses: null, residual_modo: null, valor_residual: null, residual_percentual: null, data_inicio_depreciacao: null, previa: null,
};
const AVISO = 'Prévia gerencial simulada: não gera lançamento, título, despesa nem movimento de estoque.';
/** Prévia do caso de aceite (§6): 200000 / residual 50000 / 120 meses a partir de 2026-03. */
const PREVIA_ACEITE = {
  simulada: true, contabilizada: false, metodo: 'LINEAR', custo_base: '200000.00', valor_residual: '50000.00', valor_depreciavel: '150000.00',
  vida_util_meses: 120, quota_mensal: '1250.00', ultima_quota: '1250.00', quota_anual: '15000.00', taxa_anual_percentual: '10.0000',
  primeira_competencia: '2026-03', ultima_competencia: '2036-02', valor_contabil: null, depreciacao_acumulada: null, aviso: AVISO,
};
const perfilDe = (s, codigo) => {
  const nomes = { EXTENSAO: ['Extensão', 'EXTENSAO'], AREA: ['Área', 'AREA'], VOLUME: ['Volume', 'VOLUME'], CAPACIDADE_ANIMAL: ['Capacidade animal', 'CABECAS'], QUANTIDADE: ['Quantidade', 'QUANTIDADE'] };
  return { id: s.per[codigo], codigo, nome: nomes[codigo][0], dimensao: nomes[codigo][1], ativo: true };
};
const combustivelDe = (s, codigo, nome, ativo = true) => ({ id: s.comb[codigo], codigo, nome, unidade: 'L', ativo });

// ─────────────────────────────────────────────────────────────────────────────
describe('B1 — aceite do proprietário: um bem de cada natureza, relido', () => {
  test('cerca 1.250 m, curral m² + cabeças, reservatório L, trator TP-02, caminhonete flex UT-04, implemento e gerador sem medidor; detalhe fixo; nada em estoque/financeiro', async () => {
    const s = await montarPatrimonio(app);
    const estoqueAntes = await contagemForaDoPatrimonio(s.c);
    const cerca = await criarOk(s, corpoCerca(s));
    const curral = await criarOk(s, corpoCurral(s));
    const reservatorio = await criarOk(s, corpoReservatorio(s));
    const trator = await criarOk(s, corpoTrator(s));
    const caminhonete = await criarOk(s, corpoCaminhonete(s));
    const implemento = await criarOk(s, corpoImplemento(s));
    const gerador = await criarOk(s, corpoGerador(s));
    const todos = [cerca, curral, reservatorio, trator, caminhonete, implemento, gerador];

    // Releitura idêntica, forma fixa e número da sequência do tenant.
    for (const b of todos) {
      assert.deepEqual(Object.keys(b).sort(), CHAVES_DETALHE, b.nome);
      assert.deepEqual(await detalhe(s, b.id), b, `${b.nome}: relido idêntico`);
      assert.deepEqual([b.empresa_id, b.versao, b.ativo, b.consumo, b.propriedade], [s.e1.id, 1, true, null, 'PROPRIO'], b.nome);
      assert.deepEqual(b.aquisicao, AQUISICAO_VAZIA, b.nome);
      assert.deepEqual(b.depreciacao, DEPRECIACAO_VAZIA, b.nome);
    }
    assert.deepEqual(todos.map((b) => b.numero), ['1', '2', '3', '4', '5', '6', '7']);

    // Cerca: 1,25 km = 1.250 m.
    assert.equal(cerca.natureza, 'BENFEITORIA');
    assert.deepEqual(cerca.familia, { id: s.fam.BENFEITORIAS, codigo: 'BENFEITORIAS', nome: 'Benfeitorias e instalações', natureza: 'BENFEITORIA', ativo: true });
    assert.deepEqual(cerca.tipo, { id: s.tip.CERCA_ARAME, codigo: 'CERCA_ARAME', nome: 'Cerca de arame', ativo: true });
    assert.deepEqual(semId(cerca.medicoes), [
      { perfil: perfilDe(s, 'EXTENSAO'), rotulo: null, valor_informado: '1.2500', unidade_informada: 'km', valor_normalizado: '1250.0000', unidade_canonica: 'm', principal: true },
    ]);
    assert.deepEqual([cerca.medidor, cerca.tanques], [null, []]);
    // Curral: 0,5 ha = 5.000 m² (principal) e 200 cabeças.
    assert.deepEqual(semId(curral.medicoes), [
      { perfil: perfilDe(s, 'AREA'), rotulo: 'Área coberta', valor_informado: '0.5000', unidade_informada: 'ha', valor_normalizado: '5000.0000', unidade_canonica: 'm2', principal: true },
      { perfil: perfilDe(s, 'CAPACIDADE_ANIMAL'), rotulo: null, valor_informado: '200.0000', unidade_informada: 'cab', valor_normalizado: '200.0000', unidade_canonica: 'cab', principal: false },
    ]);
    assert.deepEqual([curral.material, curral.ano_conclusao, curral.medidor], ['Madeira de lei', 2019, null]);
    // Reservatório: 20 m³ = 20.000 L.
    assert.deepEqual(semId(reservatorio.medicoes).map((m) => [m.valor_informado, m.unidade_informada, m.valor_normalizado, m.unidade_canonica]), [['20.0000', 'm3', '20000.0000', 'L']]);
    // Trator TP-02: código de frota normalizado e diferente do número; horímetro; diesel S10 180 L.
    assert.deepEqual([trator.codigo_frota, trator.numero, trator.natureza, trator.marca, trator.modelo, trator.ano_fabricacao, trator.potencia_cv], ['TP-02', '4', 'MAQUINA', 'Valtra', 'A950', 2018, '95.0000']);
    assert.deepEqual(trator.medidor, { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1520.5000', leitura_atual: '1520.5000', data_leitura: '2027-06-01', origem: 'CADASTRO_INICIAL' });
    assert.deepEqual(semId(trator.tanques), [
      { identificador: 'Tanque principal', capacidade_litros: '180.0000', observacao: null, ativo: true, combustiveis: [combustivelDe(s, 'DIESEL_S10', 'Diesel S10')] },
    ]);
    assert.deepEqual(trator.medicoes, []);
    // Caminhonete flex UT-04: placa Mercosul normalizada, odômetro, tanque único gasolina + etanol.
    assert.deepEqual([caminhonete.natureza, caminhonete.codigo_frota, caminhonete.placa, caminhonete.placa_uf, caminhonete.renavam, caminhonete.chassi], ['VEICULO', 'UT-04', 'ABC1D23', 'SP', '12345678901', '9BWZZZ377VT004251']);
    assert.deepEqual(caminhonete.medidor, { tipo: 'ODOMETRO', unidade: 'km', leitura_inicial: '35210.0000', leitura_atual: '35210.0000', data_leitura: '2027-05-30', origem: 'CADASTRO_INICIAL' });
    assert.deepEqual(semId(caminhonete.tanques), [
      { identificador: 'Tanque', capacidade_litros: '80.0000', observacao: null, ativo: true, combustiveis: [combustivelDe(s, 'ETANOL', 'Etanol'), combustivelDe(s, 'GASOLINA', 'Gasolina')] },
    ]);
    // Implemento: sem motor, sem tanque, sem medidor.
    assert.deepEqual([implemento.natureza, implemento.medidor, implemento.tanques, implemento.medicoes, implemento.potencia_cv], ['IMPLEMENTO', null, [], [], null]);
    assert.deepEqual([implemento.numero_serie, implemento.compatibilidade], ['RC-2020-778', 'Tratores acima de 75 cv']);
    // Gerador "sem medidor": medidor declarado, sem leitura e sem consumo.
    assert.deepEqual(gerador.medidor, { tipo: 'SEM_MEDIDOR', unidade: null, leitura_inicial: null, leitura_atual: null, data_leitura: null, origem: null });
    assert.equal(gerador.consumo, null);

    // Linhas filhas gravadas e nada fora do Patrimônio.
    const p = prisma();
    assert.equal(await p.medicaoBem.count({ where: { cliente_id: s.c } }), 4);
    assert.equal(await p.tanqueBem.count({ where: { cliente_id: s.c } }), 2);
    assert.equal(await p.tanqueBemCombustivel.count({ where: { cliente_id: s.c } }), 3);
    assert.equal(await p.auditLog.count({ where: { cliente_id: s.c, entidade: 'BemPatrimonial', acao: 'create' } }), 7);
    assert.deepEqual(await contagemForaDoPatrimonio(s.c), estoqueAntes, 'nenhuma linha fora do Patrimônio (estoque/financeiro inclusive)');
    for (const m of ESTOQUE_FINANCEIRO_VAZIOS) assert.equal(estoqueAntes[m], 0, `${m}: vazio antes do cadastro`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B2 — medições físicas', () => {
  test('conversões exatas (1 km = 1000 m, 1 ha = 10000 m², 1 m³ = 1000 L) e recusas: m²→L, zero, negativo, não numérico, overflow, inteiro, repetição, principal, limite, natureza', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const benf = (tipo, medicoes, extra = {}) => ({ empresa_id: s.e1.id, nome: `Benfeitoria ${tipo}`, familia_id: s.fam.BENFEITORIAS, tipo_id: s.tip[tipo], medicoes, ...extra });
    const med = (perfil, valor, unidade, extra = {}) => ({ perfil_id: s.per[perfil], valor, unidade, ...extra });
    const norm = (b) => b.medicoes.map((m) => [m.valor_informado, m.unidade_informada, m.valor_normalizado, m.unidade_canonica]);
    assert.deepEqual(norm(await criarOk(s, benf('CERCA_ELETRICA', [med('EXTENSAO', '1', 'km')]))), [['1.0000', 'km', '1000.0000', 'm']]);
    assert.deepEqual(norm(await criarOk(s, benf('GALPAO', [med('AREA', '1', 'ha')]))), [['1.0000', 'ha', '10000.0000', 'm2']]);
    assert.deepEqual(norm(await criarOk(s, benf('BEBEDOURO_FIXO', [med('VOLUME', '1', 'm3')]))), [['1.0000', 'm3', '1000.0000', 'L']]);
    assert.deepEqual(norm(await criarOk(s, benf('GALPAO', [med('AREA', '0.0001', 'ha')]))), [['0.0001', 'ha', '1.0000', 'm2']]);
    assert.deepEqual(norm(await criarOk(s, benf('CERCA_ARAME', [med('EXTENSAO', '9999999999.9999', 'km')]))), [['9999999999.9999', 'km', '9999999999999.9000', 'm']], 'teto do informado converte sem perder casas');
    // Sem principal marcada, a primeira vira principal; a contagem inteira aceita "200.0".
    const semPrincipal = await criarOk(s, benf('CURRAL', [med('AREA', '2', 'm2'), med('CAPACIDADE_ANIMAL', '200.0', 'cab')]));
    assert.deepEqual(semPrincipal.medicoes.map((m) => [m.perfil.codigo, m.principal]), [['AREA', true], ['CAPACIDADE_ANIMAL', false]]);

    const reservatorio = (valor, unidade = 'L') => criar(s, benf('RESERVATORIO', [med('VOLUME', valor, unidade)]));
    await recusa(s, reservatorio('10', 'm2'), [422, 'MEDICAO_UNIDADE_INCOMPATIVEL', 'medicoes[0].unidade', 'unidade_incompativel']);
    await recusa(s, criar(s, benf('CERCA_ARAME', [med('EXTENSAO', '10', 'h')])), [422, 'MEDICAO_UNIDADE_INCOMPATIVEL', 'medicoes[0].unidade', 'unidade_incompativel']);
    await recusa(s, reservatorio('0'), [422, 'MEDICAO_VALOR_INVALIDO', 'medicoes[0].valor', 'nao_positivo']);
    await recusa(s, reservatorio('0.0000'), [422, 'MEDICAO_VALOR_INVALIDO', 'medicoes[0].valor', 'nao_positivo']);
    for (const valor of ['-1', 'abc', '1e3', '1,5', '99999999999', '1.12345', '']) await recusa400(s, reservatorio(valor), `valor ${JSON.stringify(valor)}`);
    const numero = await recusa400(s, criar(s, benf('RESERVATORIO', [med('VOLUME', 10, 'L')])), 'número JSON');
    assert.deepEqual([numero.json().field, numero.json().reason, numero.json().details], ['medicoes[0].valor', 'valor_deve_ser_texto', { campo: 'medicoes[0].valor' }]);
    // A10: cabeças e quantidade são contagem.
    await recusa(s, criar(s, benf('CURRAL', [med('AREA', '1', 'ha'), med('CAPACIDADE_ANIMAL', '10.5', 'cab')])), [422, 'MEDICAO_VALOR_INVALIDO', 'medicoes[1].valor', 'deve_ser_inteiro']);
    await recusa(s, criar(s, benf('GALPAO', [med('QUANTIDADE', '2.5', 'un')])), [422, 'MEDICAO_VALOR_INVALIDO', 'medicoes[0].valor', 'deve_ser_inteiro']);
    // Repetição, principal, referência e limite.
    await recusa(s, criar(s, benf('CURRAL', [med('AREA', '1', 'ha'), med('AREA', '2', 'm2')])), [422, 'MEDICAO_PERFIL_DUPLICADO', 'medicoes[1].perfil_id', 'perfil_repetido']);
    await recusa(s, criar(s, benf('CURRAL', [med('AREA', '1', 'ha', { principal: true }), med('CAPACIDADE_ANIMAL', '5', 'cab', { principal: true })])), [422, 'MEDICAO_PRINCIPAL_DUPLICADA', 'medicoes', 'principal_duplicada']);
    await recusa(s, criar(s, benf('CURRAL', [{ perfil_id: INEXISTENTE, valor: '1', unidade: 'm2' }])), [422, 'BEM_REFERENCIA_INVALIDA', 'medicoes[0].perfil_id', 'inexistente']);
    await recusa(s, criar(s, benf('CURRAL', [{ perfil_id: outro.per.AREA, valor: '1', unidade: 'm2' }])), [422, 'BEM_REFERENCIA_INVALIDA', 'medicoes[0].perfil_id', 'inexistente']);
    await recusa(s, criar(s, benf('CURRAL', Array.from({ length: 21 }, () => med('AREA', '1', 'm2')))), [422, 'MEDICAO_LIMITE_EXCEDIDO', 'medicoes', 'limite']);
    await recusa400(s, criar(s, benf('CURRAL', [{ ...med('AREA', '1', 'm2'), id: INEXISTENTE }])), 'id de medição no POST');
    await ok(req('PATCH', `/patrimonio-perfis-medicao/${s.per.QUANTIDADE}`, s.token, { versao: 1, ativo: false }));
    await recusa(s, criar(s, benf('GALPAO', [med('QUANTIDADE', '3', 'un')])), [422, 'BEM_REFERENCIA_INVALIDA', 'medicoes[0].perfil_id', 'inativo']);
    // Medição só em benfeitoria: lista vazia passa, lista com item não.
    const naoAplic = await recusa(s, criar(s, corpoTrator(s, { codigo_frota: null, medicoes: [med('AREA', '1', 'ha')] })), [422, 'BEM_CAMPO_NAO_APLICAVEL', 'medicoes', 'nao_aplicavel']);
    assert.deepEqual(naoAplic.json().details, { natureza: 'MAQUINA' });
    assert.deepEqual((await criarOk(s, corpoTrator(s, { codigo_frota: null, medicoes: [] }))).medicoes, []);
  });

  test('PATCH é sync: troca da principal (A5), atualiza a mantida, remove a ausente, cria a nova; perfil de medição gravada é imutável; perfil inativo já gravado fica', async () => {
    const s = await montarPatrimonio(app);
    const curral = await criarOk(s, corpoCurral(s));
    const outroBem = await criarOk(s, corpoCerca(s));
    const area = curral.medicoes.find((m) => m.perfil.codigo === 'AREA');
    const cab = curral.medicoes.find((m) => m.perfil.codigo === 'CAPACIDADE_ANIMAL');
    const itemArea = (extra = {}) => ({ id: area.id, perfil_id: s.per.AREA, valor: '0.5', unidade: 'ha', rotulo: 'Área coberta', ...extra });
    const itemCab = (extra = {}) => ({ id: cab.id, perfil_id: s.per.CAPACIDADE_ANIMAL, valor: '200', unidade: 'cab', ...extra });

    // A5: a nova principal vem primeiro; nenhuma colisão no unique (cliente_id, bem_id, principal).
    const troca = await patchOk(s, curral.id, { versao: 1, medicoes: [itemCab({ principal: true }), itemArea()] });
    assert.equal(troca.versao, 2);
    assert.deepEqual(troca.medicoes.map((m) => [m.id, m.principal]), [[cab.id, true], [area.id, false]]);
    const linhas = await prisma().medicaoBem.findMany({ where: { cliente_id: s.c, bem_id: curral.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(Object.fromEntries(linhas.map((l) => [l.id, l.principal])), { [area.id]: null, [cab.id]: true }, 'principal só true ou NULL');
    // Mesma lista: sem mudança efetiva.
    assert.equal((await patchOk(s, curral.id, { versao: 2, medicoes: [itemCab({ principal: true }), itemArea()] })).versao, 2);

    // Atualiza a mantida (1 ha), remove a ausente (cabeças) e cria a nova (quantidade).
    const sync = await patchOk(s, curral.id, { versao: 2, medicoes: [itemArea({ valor: '1' }), { perfil_id: s.per.QUANTIDADE, valor: '3', unidade: 'un' }] });
    assert.deepEqual(sync.medicoes.map((m) => [m.perfil.codigo, m.valor_normalizado, m.unidade_canonica, m.principal]), [['AREA', '10000.0000', 'm2', true], ['QUANTIDADE', '3.0000', 'un', false]]);
    assert.equal(sync.medicoes[0].id, area.id, 'a mantida conserva o id');
    assert.equal(await prisma().medicaoBem.count({ where: { cliente_id: s.c, id: cab.id } }), 0, 'a ausente foi removida');
    const quantidade = sync.medicoes[1];

    // Perfil de medição gravada não muda; id de outro bem não serve.
    await recusa(s, patch(s, curral.id, { versao: 3, medicoes: [itemArea({ perfil_id: s.per.VOLUME, unidade: 'L' })] }), [422, 'MEDICAO_PERFIL_DUPLICADO', 'medicoes[0].perfil_id', 'perfil_imutavel']);
    await recusa(s, patch(s, curral.id, { versao: 3, medicoes: [{ id: outroBem.medicoes[0].id, perfil_id: s.per.EXTENSAO, valor: '1', unidade: 'km' }] }), [422, 'BEM_REFERENCIA_INVALIDA', 'medicoes[0].id', 'inexistente']);

    // Perfil inativado depois de gravado: fica no bem, inclusive recriado sem id; num bem novo, não entra.
    await ok(req('PATCH', `/patrimonio-perfis-medicao/${s.per.QUANTIDADE}`, s.token, { versao: 1, ativo: false }));
    assert.equal((await patchOk(s, curral.id, { versao: 3, nome: 'Curral reformado' })).medicoes[1].perfil.ativo, false);
    const recriada = await patchOk(s, curral.id, { versao: 4, medicoes: [itemArea({ valor: '1' }), { perfil_id: s.per.QUANTIDADE, valor: '4', unidade: 'un' }] });
    assert.notEqual(recriada.medicoes[1].id, quantidade.id);
    assert.equal(recriada.medicoes[1].valor_normalizado, '4.0000');
    await recusa(s, criar(s, corpoCurral(s, { medicoes: [{ perfil_id: s.per.QUANTIDADE, valor: '1', unidade: 'un' }] })), [422, 'BEM_REFERENCIA_INVALIDA', 'medicoes[0].perfil_id', 'inativo']);

    // Lista vazia remove todas; a auditoria registra a forma (sem rótulo).
    assert.deepEqual((await patchOk(s, curral.id, { versao: 5, medicoes: [] })).medicoes, []);
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'BemPatrimonial', entidade_id: curral.id, acao: 'update' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((e) => /** @type {any} */ (e.dados_novos).campos_alterados), [['medicoes'], ['medicoes'], ['nome'], ['medicoes'], ['medicoes']]);
    const formaAntes = /** @type {any} */ (eventos[0].dados_anteriores).medicoes;
    assert.deepEqual(formaAntes.map((m) => Object.keys(m).sort()), [['id', 'perfil_id', 'principal', 'unidade_canonica', 'valor_normalizado'], ['id', 'perfil_id', 'principal', 'unidade_canonica', 'valor_normalizado']]);
    assert.ok(!JSON.stringify(eventos).includes('Área coberta'), 'rótulo fora da auditoria');
  });

  test('corrida (A5.2): remover uma unidade do perfil × gravar medição nessa unidade nunca terminam as duas', async () => {
    const s = await montarPatrimonio(app);
    for (let i = 0; i < 5; i += 1) {
      const perfil = await ok(req('POST', '/patrimonio-perfis-medicao', s.token, { codigo: `PISO_${i}`, nome: `Piso ${i}`, dimensao: 'AREA', finalidade: 'DIMENSAO', unidades_permitidas: ['m2', 'ha'] }), 201);
      const [bem, ajuste] = await Promise.all([
        criar(s, { empresa_id: s.e1.id, nome: `Galpão ${i}`, familia_id: s.fam.BENFEITORIAS, tipo_id: s.tip.GALPAO, medicoes: [{ perfil_id: perfil.id, valor: '1', unidade: 'ha' }] }),
        req('PATCH', `/patrimonio-perfis-medicao/${perfil.id}`, s.token, { versao: 1, unidades_permitidas: ['m2'] }),
      ]);
      const par = [bem.statusCode, ajuste.statusCode];
      assert.ok(
        (par[0] === 201 && par[1] === 409 && ajuste.json().code === 'PERFIL_UNIDADE_EM_USO') ||
          (par[0] === 422 && bem.json().code === 'MEDICAO_UNIDADE_INCOMPATIVEL' && par[1] === 200),
        `rodada ${i}: ${par} ${bem.body} ${ajuste.body}`
      );
      const final = await prisma().perfilMedicao.findUnique({ where: { id: perfil.id } });
      const emHa = await prisma().medicaoBem.count({ where: { cliente_id: s.c, perfil_id: perfil.id, unidade_informada: 'ha' } });
      assert.ok(final.unidades_permitidas.includes('ha') || emHa === 0, `rodada ${i}: medição em ha num perfil sem ha`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B3 — tanques e combustíveis', () => {
  test('flex aceito; combustível inexistente, de outro tenant, inativo ou GNV recusado; vazio, repetido, capacidade, identificador, natureza e limite de ativos', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    await ok(req('PATCH', `/patrimonio-combustiveis/${s.comb.DIESEL_S500}`, s.token, { versao: 1, ativo: false }));
    const tanque = (extra = {}) => ({ identificador: 'Tanque principal', capacidade_litros: '180', combustivel_ids: [s.comb.DIESEL_S10], ...extra });
    const trator = (tanques) => criar(s, corpoTrator(s, { codigo_frota: null, tanques }));
    const comb = (ids) => trator([tanque({ combustivel_ids: ids })]);

    const flex = await criarOk(s, corpoCaminhonete(s));
    assert.deepEqual(flex.tanques[0].combustiveis.map((c) => c.codigo), ['ETANOL', 'GASOLINA']);
    const r1 = await recusa(s, comb([INEXISTENTE]), [422, 'BEM_REFERENCIA_INVALIDA', 'tanques[0].combustivel_ids', 'inexistente']);
    assert.deepEqual(r1.json().details, { combustivel_id: INEXISTENTE });
    await recusa(s, comb([outro.comb.DIESEL_S10]), [422, 'BEM_REFERENCIA_INVALIDA', 'tanques[0].combustivel_ids', 'inexistente']);
    await recusa(s, comb([s.comb.DIESEL_S10, s.comb.DIESEL_S500]), [422, 'BEM_REFERENCIA_INVALIDA', 'tanques[0].combustivel_ids', 'inativo']);
    const gnv = await recusa(s, comb([s.comb.GNV]), [422, 'TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'tanques[0].combustivel_ids', 'unidade_incompativel']);
    assert.deepEqual(gnv.json().details, { combustivel_id: s.comb.GNV, unidade: 'm3' });
    await recusa(s, comb([]), [422, 'TANQUE_COMBUSTIVEL_OBRIGATORIO', 'tanques[0].combustivel_ids', 'vazio']);
    await recusa(s, comb([s.comb.DIESEL_S10, s.comb.DIESEL_S10]), [422, 'TANQUE_COMBUSTIVEL_OBRIGATORIO', 'tanques[0].combustivel_ids', 'repetido']);
    await recusa(s, trator([tanque({ capacidade_litros: '0' })]), [422, 'TANQUE_CAPACIDADE_INVALIDA', 'tanques[0].capacidade_litros', 'capacidade_invalida']);
    for (const capacidade of ['-5', '180.12345', 'cem', '99999999999']) await recusa400(s, trator([tanque({ capacidade_litros: capacidade })]), `capacidade ${capacidade}`);
    const num = await recusa400(s, trator([tanque({ capacidade_litros: 180 })]), 'capacidade número JSON');
    assert.deepEqual([num.json().reason, num.json().details], ['valor_deve_ser_texto', { campo: 'tanques[0].capacidade_litros' }]);
    await recusa(s, trator([tanque({ identificador: 'Tanque A' }), tanque({ identificador: '  tanque   a ' })]), [422, 'TANQUE_IDENTIFICADOR_DUPLICADO', 'tanques[1].identificador', 'identificador_repetido']);
    await recusa400(s, trator([tanque({ identificador: '   ' })]), 'identificador em branco');
    await recusa400(s, trator([tanque({ id: INEXISTENTE })]), 'id de tanque no POST');
    await recusa400(s, trator([tanque({ ativo: true })]), 'ativo de tanque no POST');
    await recusa(s, criar(s, corpoImplemento(s, { tanques: [tanque()] })), [422, 'BEM_CAMPO_NAO_APLICAVEL', 'tanques', 'nao_aplicavel']);
    await recusa(s, criar(s, corpoCerca(s, { tanques: [tanque()] })), [422, 'BEM_CAMPO_NAO_APLICAVEL', 'tanques', 'nao_aplicavel']);
    const onze = Array.from({ length: 11 }, (_, i) => tanque({ identificador: `T${i + 1}` }));
    await recusa(s, trator(onze), [422, 'TANQUE_LIMITE_EXCEDIDO', 'tanques', 'limite']);
    const dez = await criarOk(s, corpoTrator(s, { codigo_frota: null, tanques: onze.slice(0, 10) }));
    assert.equal(dez.tanques.length, 10);
    // Equipamento também leva tanque.
    assert.equal((await criarOk(s, corpoGerador(s, { tanques: [tanque()] }))).tanques.length, 1);
  });

  test('PATCH: tanque ausente 422, novo inativo 400, id repetido/de outro bem 422; troca de identificadores (A5); combustível inativado fica; inativo libera vaga e reserva o identificador', async () => {
    const s = await montarPatrimonio(app);
    const foraAntes = await contagemForaDoPatrimonio(s.c);
    const trator = await criarOk(s, corpoTrator(s, {
      tanques: [
        { identificador: 'Tanque principal', capacidade_litros: '180', combustivel_ids: [s.comb.DIESEL_S10] },
        { identificador: 'Tanque auxiliar', capacidade_litros: '60', combustivel_ids: [s.comb.DIESEL_S10, s.comb.DIESEL_S500], observacao: 'na traseira' },
      ],
    }));
    const outroBem = await criarOk(s, corpoCaminhonete(s));
    const [principal, auxiliar] = trator.tanques;
    const item = (t, extra = {}) => ({ id: t.id, identificador: t.identificador, capacidade_litros: t.capacidade_litros, observacao: t.observacao, combustivel_ids: t.combustiveis.map((c) => c.id), ...extra });

    const ausente = await recusa(s, patch(s, trator.id, { versao: 1, tanques: [item(principal)] }), [422, 'TANQUE_REMOCAO_NAO_PERMITIDA', 'tanques', 'tanque_ausente']);
    assert.deepEqual(ausente.json().details, { tanque_id: auxiliar.id });
    const novoInativo = await recusa400(s, patch(s, trator.id, { versao: 1, tanques: [item(principal), item(auxiliar), { identificador: 'Reserva', capacidade_litros: '20', combustivel_ids: [s.comb.DIESEL_S10], ativo: false }] }), 'tanque novo inativo');
    assert.deepEqual([novoInativo.json().field, novoInativo.json().reason], ['tanques[2].ativo', 'tanque_novo_inativo']);
    await recusa(s, patch(s, trator.id, { versao: 1, tanques: [item(principal), item(principal, { identificador: 'Outro' }), item(auxiliar)] }), [422, 'BEM_REFERENCIA_INVALIDA', 'tanques[1].id', 'repetido']);
    await recusa(s, patch(s, trator.id, { versao: 1, tanques: [item(outroBem.tanques[0]), item(principal), item(auxiliar)] }), [422, 'BEM_REFERENCIA_INVALIDA', 'tanques[0].id', 'inexistente']);

    // A5: trocar os identificadores entre dois tanques no mesmo PATCH.
    const troca = await patchOk(s, trator.id, { versao: 1, tanques: [item(principal, { identificador: 'Tanque auxiliar' }), item(auxiliar, { identificador: 'Tanque principal' })] });
    assert.equal(troca.versao, 2);
    assert.deepEqual(Object.fromEntries(troca.tanques.map((t) => [t.id, t.identificador])), { [principal.id]: 'Tanque auxiliar', [auxiliar.id]: 'Tanque principal' });

    // Combustível inativado depois de vinculado permanece; acrescentá-lo a outro tanque, não.
    await ok(req('PATCH', `/patrimonio-combustiveis/${s.comb.DIESEL_S500}`, s.token, { versao: 1, ativo: false }));
    const [p2, a2] = troca.tanques;
    const mantem = await patchOk(s, trator.id, { versao: 2, tanques: [item(p2), item(a2, { capacidade_litros: '65' })] });
    assert.deepEqual(mantem.tanques[1].combustiveis.map((c) => [c.codigo, c.ativo]), [['DIESEL_S10', true], ['DIESEL_S500', false]]);
    assert.equal(mantem.tanques[1].capacidade_litros, '65.0000');
    await recusa(s, patch(s, trator.id, { versao: 3, tanques: [item(p2, { combustivel_ids: [s.comb.DIESEL_S10, s.comb.DIESEL_S500] }), item(a2)] }), [422, 'BEM_REFERENCIA_INVALIDA', 'tanques[0].combustivel_ids', 'inativo']);

    // Inativar (com ou sem combustível) e o identificador continua reservado; o tanque nunca sai.
    const inat = await patchOk(s, trator.id, { versao: 3, tanques: [item(p2), item(a2, { ativo: false, combustivel_ids: [] })] });
    assert.deepEqual(inat.tanques.map((t) => [t.identificador, t.ativo, t.combustiveis.length]), [['Tanque auxiliar', true, 1], ['Tanque principal', false, 0]]);
    const t3 = inat.tanques;
    await recusa(s, patch(s, trator.id, { versao: 4, tanques: [item(t3[0]), item(t3[1]), { identificador: 'TANQUE PRINCIPAL', capacidade_litros: '30', combustivel_ids: [s.comb.DIESEL_S10] }] }), [422, 'TANQUE_IDENTIFICADOR_DUPLICADO', 'tanques[2].identificador', 'identificador_repetido']);
    await recusa(s, patch(s, trator.id, { versao: 4, tanques: [item(t3[0]), item(t3[1], { ativo: true })] }), [422, 'TANQUE_COMBUSTIVEL_OBRIGATORIO', 'tanques[1].combustivel_ids', 'vazio']);
    assert.equal(await prisma().tanqueBem.count({ where: { cliente_id: s.c, bem_id: trator.id } }), 2);

    // A11: o limite conta só os ATIVOS.
    const dez = await criarOk(s, corpoTrator(s, { codigo_frota: null, tanques: Array.from({ length: 10 }, (_, i) => ({ identificador: `T${i + 1}`, capacidade_litros: '10', combustivel_ids: [s.comb.DIESEL_S10] })) }));
    const todos = dez.tanques.map((t) => item(t));
    const novo = { identificador: 'T11', capacidade_litros: '10', combustivel_ids: [s.comb.DIESEL_S10] };
    await recusa(s, patch(s, dez.id, { versao: 1, tanques: [...todos, novo] }), [422, 'TANQUE_LIMITE_EXCEDIDO', 'tanques', 'limite']);
    const comInativo = await patchOk(s, dez.id, { versao: 1, tanques: [{ ...todos[0], ativo: false }, ...todos.slice(1), novo] });
    assert.deepEqual([comInativo.tanques.length, comInativo.tanques.filter((t) => t.ativo).length], [11, 10]);
    const foraDepois = await contagemForaDoPatrimonio(s.c);
    assert.deepEqual(foraDepois, foraAntes, 'nenhum efeito fora do Patrimônio (estoque/financeiro inclusive)');
    for (const m of ESTOQUE_FINANCEIRO_VAZIOS) assert.equal(foraDepois[m], 0, m);
  });

  test('A5: o temporário da troca nunca colide com um identificador digitado — `~<id de outro tanque>` é um nome comum, em qualquer ordem da lista, e não trava o PATCH seguinte', async () => {
    const s = await montarPatrimonio(app);
    const doisTanques = () => corpoTrator(s, {
      codigo_frota: null,
      tanques: [
        { identificador: 'A', capacidade_litros: '100', combustivel_ids: [s.comb.DIESEL_S10] },
        { identificador: 'B', capacidade_litros: '50', combustivel_ids: [s.comb.DIESEL_S10] },
      ],
    });
    const item = (t, extra = {}) => ({ id: t.id, identificador: t.identificador, capacidade_litros: t.capacidade_litros, observacao: t.observacao, combustivel_ids: t.combustiveis.map((c) => c.id), ...extra });
    const tanquesDe = (bem) => Object.fromEntries(bem.tanques.map((t) => [t.identificador, t]));
    const identificadores = (bem) => Object.fromEntries(bem.tanques.map((t) => [t.id, t.identificador]));
    const gravados = async (bemId) => Object.fromEntries((await prisma().tanqueBem.findMany({ where: { cliente_id: s.c, bem_id: bemId } })).map((t) => [t.id, t.identificador]));

    // No mesmo PATCH: B recebe `~<id de A>` e A recebe 'C' — com B antes de A e com A antes de B.
    for (const ordem of ['B antes de A', 'A antes de B']) {
      const bem = await criarOk(s, doisTanques());
      const { A: a, B: b } = tanquesDe(bem);
      const itens = [item(b, { identificador: `~${a.id}` }), item(a, { identificador: 'C' })];
      const r = await patchOk(s, bem.id, { versao: 1, tanques: ordem === 'B antes de A' ? itens : itens.reverse() });
      const esperado = { [a.id]: 'C', [b.id]: `~${a.id}` };
      assert.deepEqual([r.versao, identificadores(r)], [2, esperado], ordem);
      assert.deepEqual(await gravados(bem.id), esperado, `${ordem}: gravado`);
    }

    // B já gravado com `~<id de A>`: renomear só A depois (o temporário de A não pode ser o nome de B).
    const bem = await criarOk(s, doisTanques());
    const { A: a, B: b } = tanquesDe(bem);
    const v2 = await patchOk(s, bem.id, { versao: 1, tanques: [item(a), item(b, { identificador: `~${a.id}` })] });
    assert.deepEqual(identificadores(v2), { [a.id]: 'A', [b.id]: `~${a.id}` });
    const { A: a2, [`~${a.id}`]: b2 } = tanquesDe(v2);
    const v3 = await patchOk(s, bem.id, { versao: 2, tanques: [item(a2, { identificador: 'Novo A' }), item(b2)] });
    assert.deepEqual([v3.versao, identificadores(v3)], [3, { [a.id]: 'Novo A', [b.id]: `~${a.id}` }]);
    // A (primeiro da lista) recebe `~<id de B>` enquanto B, que hoje se chama `~<id de A>`, volta a 'B'.
    const { 'Novo A': a3, [`~${a.id}`]: b3 } = tanquesDe(v3);
    const v4 = await patchOk(s, bem.id, { versao: 3, tanques: [item(a3, { identificador: `~${b.id}` }), item(b3, { identificador: 'B' })] });
    assert.deepEqual(identificadores(v4), { [a.id]: `~${b.id}`, [b.id]: 'B' });
    assert.deepEqual(await gravados(bem.id), { [a.id]: `~${b.id}`, [b.id]: 'B' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B4 — medidor (A2)', () => {
  test('criação: obrigatório por natureza, leitura e data obrigatórias, data futura, sem medidor sem leitura, formato 400, empresa sem fuso 409', async () => {
    const s = await montarPatrimonio(app);
    const semFuso = await montarPatrimonio(app, { fuso: null });
    const tratorSemMedidor = sem(corpoTrator(s, { codigo_frota: null }), 'medidor');
    const comMedidor = (medidor, extra = {}) => criar(s, corpoTrator(s, { codigo_frota: null, medidor, ...extra }));

    await recusa(s, criar(s, tratorSemMedidor), [422, 'MEDIDOR_OBRIGATORIO', 'medidor', 'obrigatorio']);
    await recusa(s, comMedidor(null), [422, 'MEDIDOR_OBRIGATORIO', 'medidor', 'obrigatorio']);
    await recusa(s, criar(s, corpoCaminhonete(s, { codigo_frota: null, medidor: null })), [422, 'MEDIDOR_OBRIGATORIO', 'medidor', 'obrigatorio']);
    await recusa(s, criar(s, corpoGerador(s, { medidor: null })), [422, 'MEDIDOR_OBRIGATORIO', 'medidor', 'obrigatorio']);
    await recusa(s, criar(s, corpoCerca(s, { medidor: { tipo: 'SEM_MEDIDOR' } })), [422, 'BEM_CAMPO_NAO_APLICAVEL', 'medidor', 'nao_aplicavel']);
    await recusa(s, comMedidor({ tipo: 'HORIMETRO', data_leitura: '2027-06-01' }), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor.leitura_inicial', 'obrigatoria']);
    await recusa(s, comMedidor({ tipo: 'HORIMETRO', leitura_inicial: '10' }), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor.data_leitura', 'obrigatoria']);
    const futura = await recusa(s, comMedidor({ tipo: 'HORIMETRO', leitura_inicial: '10', data_leitura: '2027-06-16' }), [422, 'MEDIDOR_DATA_FUTURA', 'medidor.data_leitura', 'data_futura']);
    assert.deepEqual(futura.json().details, { hoje: HOJE });
    await recusa(s, comMedidor({ tipo: 'HORIMETRO', leitura_inicial: '10', data_leitura: '2027-02-30' }), [422, 'PATRIMONIO_DATA_INVALIDA', 'medidor.data_leitura', 'data_inexistente']);
    await recusa(s, comMedidor({ tipo: 'SEM_MEDIDOR', leitura_inicial: '0' }), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor.leitura_inicial', 'sem_medidor']);
    await recusa(s, comMedidor({ tipo: 'SEM_MEDIDOR', data_leitura: '2027-06-01' }), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor.data_leitura', 'sem_medidor']);
    for (const [medidor, rotulo] of [
      [{ tipo: 'HORIMETRO', leitura_inicial: '10', leitura_atual: '10', data_leitura: '2027-06-01' }, 'leitura_atual no POST'],
      [{ tipo: 'HORIMETRO', leitura_inicial: '-1', data_leitura: '2027-06-01' }, 'leitura negativa'],
      [{ tipo: 'HORIMETRO', leitura_inicial: '1.12345', data_leitura: '2027-06-01' }, '5 casas'],
      [{ tipo: 'KM', leitura_inicial: '1', data_leitura: '2027-06-01' }, 'tipo fora do domínio'],
      [{ leitura_inicial: '1', data_leitura: '2027-06-01' }, 'sem tipo'],
      [{ tipo: 'HORIMETRO', leitura_inicial: '1', data_leitura: '01/06/2027' }, 'data fora do formato'],
    ]) {
      await recusa400(s, comMedidor(medidor), rotulo);
    }
    const num = await recusa400(s, comMedidor({ tipo: 'HORIMETRO', leitura_inicial: 1520, data_leitura: '2027-06-01' }), 'leitura número JSON');
    assert.deepEqual(num.json().details, { campo: 'medidor.leitura_inicial' });

    // Bordas aceitas: leitura zero e data de hoje na fazenda.
    const hoje = await criarOk(s, corpoTrator(s, { codigo_frota: null, medidor: { tipo: 'CICLOS', leitura_inicial: '0', data_leitura: HOJE } }));
    assert.deepEqual(hoje.medidor, { tipo: 'CICLOS', unidade: 'ciclos', leitura_inicial: '0.0000', leitura_atual: '0.0000', data_leitura: HOJE, origem: 'CADASTRO_INICIAL' });
    assert.equal((await criarOk(s, corpoImplemento(s, { medidor: { tipo: 'HORIMETRO', leitura_inicial: '5', data_leitura: '2027-01-01' } }))).medidor.unidade, 'h');

    // Fazenda sem fuso: contador não tem "hoje" confiável → 409; "sem medidor" não precisa de data.
    const r = await recusa(semFuso, criar(semFuso, corpoTrator(semFuso)), [409, 'EMPRESA_FUSO_NAO_CONFIGURADO', null, null]);
    assert.deepEqual(r.json().details, { empresa_id: semFuso.e1.id });
    assert.equal((await criarOk(semFuso, corpoGerador(semFuso))).medidor.tipo, 'SEM_MEDIDOR');
  });

  test('transições num implemento: NULL ↔ SEM_MEDIDOR, contador, correção de cadastro auditada (tipo, leitura inicial, data), ajuste, imutáveis depois do ajuste, regressão sem mutação parcial', async () => {
    const s = await montarPatrimonio(app);
    const impl = await criarOk(s, corpoImplemento(s));
    const m = (medidor, versao, extra = {}) => patch(s, impl.id, { versao, medidor, ...extra });
    const correcoes = () => prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade_id: impl.id, acao: 'bem_patrimonial.corrigir_medidor' }, orderBy: { createdAt: 'asc' } });
    assert.equal(impl.medidor, null);

    assert.equal((await ok(m({ tipo: 'SEM_MEDIDOR' }, 1))).medidor.tipo, 'SEM_MEDIDOR');
    assert.equal((await ok(m(null, 2))).medidor, null);
    await recusa(s, m({ tipo: 'HORIMETRO' }, 3), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor.leitura_inicial', 'obrigatoria']);
    await recusa(s, m({ tipo: 'HORIMETRO', leitura_inicial: '100', leitura_atual: '120', data_leitura: '2027-06-01' }, 3), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor.leitura_atual', 'atual_diferente_da_inicial']);
    const contador = await ok(m({ tipo: 'HORIMETRO', leitura_inicial: '100', data_leitura: '2027-06-01' }, 3));
    assert.deepEqual([contador.versao, contador.medidor], [4, { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '100.0000', leitura_atual: '100.0000', data_leitura: '2027-06-01', origem: 'CADASTRO_INICIAL' }]);
    assert.equal((await correcoes()).length, 0, 'de NULL para contador não é correção');

    // Correção de cadastro (origem CADASTRO_INICIAL e atual = inicial): tipo, leitura inicial e só a data.
    const tipo = await ok(m({ tipo: 'CICLOS', leitura_inicial: '50', data_leitura: '2027-06-02' }, 4));
    assert.deepEqual(tipo.medidor, { tipo: 'CICLOS', unidade: 'ciclos', leitura_inicial: '50.0000', leitura_atual: '50.0000', data_leitura: '2027-06-02', origem: 'CADASTRO_INICIAL' });
    const inicial = await ok(m({ tipo: 'CICLOS', leitura_inicial: '40' }, 5));
    assert.deepEqual([inicial.medidor.leitura_inicial, inicial.medidor.leitura_atual, inicial.medidor.data_leitura], ['40.0000', '40.0000', '2027-06-02']);
    const data = await ok(m({ tipo: 'CICLOS', data_leitura: '2027-05-20' }, 6));
    assert.deepEqual([data.versao, data.medidor.data_leitura, data.medidor.origem], [7, '2027-05-20', 'CADASTRO_INICIAL']);
    const eventos = await correcoes();
    assert.equal(eventos.length, 3);
    assert.deepEqual(/** @type {any} */ (eventos[0].dados_anteriores).medidor, { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '100.0000', leitura_atual: '100.0000', data_leitura: '2027-06-01', origem: 'CADASTRO_INICIAL' });
    assert.deepEqual(/** @type {any} */ (eventos[0].dados_novos).medidor.tipo, 'CICLOS');
    assert.ok(eventos.every((e) => e.entidade === 'BemPatrimonial' && e.usuario_id === s.adm.usuario.id));
    assert.equal((await ok(m({ tipo: 'CICLOS' }, 7))).versao, 7, 'mesmo tipo, leituras omitidas: nada muda');

    // Ajuste: leitura maior com data → origem AJUSTE_CADASTRO (não é correção).
    const ajuste = await ok(m({ tipo: 'CICLOS', leitura_atual: '55', data_leitura: '2027-06-10' }, 7));
    assert.deepEqual([ajuste.versao, ajuste.medidor], [8, { tipo: 'CICLOS', unidade: 'ciclos', leitura_inicial: '40.0000', leitura_atual: '55.0000', data_leitura: '2027-06-10', origem: 'AJUSTE_CADASTRO' }]);
    assert.equal((await correcoes()).length, 3);
    const nomeAntes = (await prisma().bemPatrimonial.findUnique({ where: { id: impl.id } })).nome;
    await recusa(s, m({ tipo: 'CICLOS', leitura_atual: '60' }, 8), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor.data_leitura', 'obrigatoria']);
    const regressiva = await recusa(s, m({ tipo: 'CICLOS', leitura_atual: '54', data_leitura: '2027-06-12' }, 8, { nome: 'Nome que não pode gravar' }), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor.leitura_atual', 'leitura_regressiva']);
    assert.deepEqual(regressiva.json().details, { leitura_atual: '55.0000' });
    assert.equal((await prisma().bemPatrimonial.findUnique({ where: { id: impl.id } })).nome, nomeAntes, 'sem mutação parcial: o nome não gravou');
    await recusa(s, m({ tipo: 'CICLOS', leitura_atual: '60', data_leitura: '2027-06-09' }, 8), [422, 'MEDIDOR_DATA_REGRESSIVA', 'medidor.data_leitura', 'data_regressiva']);
    await recusa(s, m({ tipo: 'CICLOS', leitura_atual: '60', data_leitura: '2027-06-16' }, 8), [422, 'MEDIDOR_DATA_FUTURA', 'medidor.data_leitura', 'data_futura']);
    await recusa(s, m({ tipo: 'HORIMETRO', leitura_inicial: '40', data_leitura: '2027-06-10' }, 8), [409, 'MEDIDOR_TIPO_IMUTAVEL', 'medidor.tipo', 'medidor_com_ajuste']);
    await recusa(s, m(null, 8), [409, 'MEDIDOR_TIPO_IMUTAVEL', 'medidor.tipo', 'medidor_com_ajuste']);
    await recusa(s, m({ tipo: 'SEM_MEDIDOR' }, 8), [409, 'MEDIDOR_TIPO_IMUTAVEL', 'medidor.tipo', 'medidor_com_ajuste']);
    await recusa(s, m({ tipo: 'CICLOS', leitura_inicial: '41' }, 8), [409, 'MEDIDOR_LEITURA_INICIAL_IMUTAVEL', 'medidor.leitura_inicial', 'medidor_com_ajuste']);
    assert.equal((await ok(m({ tipo: 'CICLOS', leitura_atual: '55', data_leitura: '2027-06-10' }, 8))).versao, 8, 'mesma leitura e mesma data: nada muda');
    const hoje = await ok(m({ tipo: 'CICLOS', leitura_inicial: '40', leitura_atual: '70', data_leitura: HOJE }, 8));
    assert.deepEqual([hoje.versao, hoje.medidor.leitura_atual, hoje.medidor.data_leitura], [9, '70.0000', HOJE]);
    const ultimo = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, entidade_id: impl.id, acao: 'update' }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual(/** @type {any} */ (ultimo.dados_novos).campos_alterados, ['medidor']);
  });

  test('máquina: medidor null recusado no PATCH; correção para "sem medidor" enquanto não houve ajuste; depois um contador novo', async () => {
    const s = await montarPatrimonio(app);
    const trator = await criarOk(s, corpoTrator(s));
    await recusa(s, patch(s, trator.id, { versao: 1, medidor: null }), [422, 'MEDIDOR_OBRIGATORIO', 'medidor', 'obrigatorio']);
    const sem = await patchOk(s, trator.id, { versao: 1, medidor: { tipo: 'SEM_MEDIDOR' } });
    assert.deepEqual(sem.medidor, { tipo: 'SEM_MEDIDOR', unidade: null, leitura_inicial: null, leitura_atual: null, data_leitura: null, origem: null });
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, entidade_id: trator.id, acao: 'bem_patrimonial.corrigir_medidor' } }), 1);
    const novo = await patchOk(s, trator.id, { versao: 2, medidor: { tipo: 'HORIMETRO', leitura_inicial: '10', data_leitura: '2027-06-14' } });
    assert.deepEqual([novo.medidor.tipo, novo.medidor.leitura_atual, novo.medidor.origem], ['HORIMETRO', '10.0000', 'CADASTRO_INICIAL']);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, entidade_id: trator.id, acao: 'bem_patrimonial.corrigir_medidor' } }), 1, 'de SEM_MEDIDOR para contador não é correção');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B5 — aquisição, depreciação e prévia', () => {
  test('prévia §6: 200000/50000/120 → quota 1250.00 sem escrever em tabela alguma; residual > custo e vida 0 → 422; formatos 400; bordas do A14', async () => {
    const s = await montarPatrimonio(app);
    await criarOk(s, corpoTrator(s));
    const aceite = { valor_aquisicao: '200000.00', residual_modo: 'VALOR', valor_residual: '50000.00', vida_util_meses: 120, data_inicio_depreciacao: '2026-03-01' };
    // Quem só visualiza a tela também simula (é leitura).
    const soVer = await s.contaCom({ modulo_id: 'patrimonio', tela_id: 'pat-bens-patrimoniais', visualizar: true });
    const tabelasAntes = await contagens(s.c);
    const fotoAntes = await fotoPatrimonio(s.c);
    assert.deepEqual(await ok(previa(s, aceite)), PREVIA_ACEITE);
    assert.deepEqual(await ok(previa(s, aceite, soVer.token)), PREVIA_ACEITE);
    assert.equal(await contagens(s.c), tabelasAntes, 'nenhuma tabela do tenant mudou');
    assert.equal(await fotoPatrimonio(s.c), fotoAntes, 'nem auditoria');

    const p = async (corpo) => ok(previa(s, { ...aceite, ...corpo }));
    // Percentual (com custo de incorporação) e as bordas do A14.
    const pct = await p({ custo_incorporacao: '1000.50', residual_modo: 'PERCENTUAL', valor_residual: null, residual_percentual: '10' });
    assert.deepEqual([pct.custo_base, pct.valor_residual, pct.valor_depreciavel, pct.quota_mensal, pct.ultima_quota], ['201000.50', '20100.05', '180900.45', '1507.50', '1507.95']);
    const centavo = await p({ valor_aquisicao: '1.00', valor_residual: '0.00' });
    assert.deepEqual([centavo.valor_depreciavel, centavo.quota_mensal, centavo.ultima_quota, centavo.quota_anual], ['1.00', '0.00', '1.00', '0.00'], 'menos de 1 centavo por mês: a última absorve tudo');
    const curta = await p({ valor_aquisicao: '1000.00', valor_residual: '0', vida_util_meses: 6 });
    assert.deepEqual([curta.quota_mensal, curta.ultima_quota, curta.quota_anual, curta.taxa_anual_percentual, curta.ultima_competencia], ['166.66', '166.70', '1000.00', '200.0000', '2026-08'], 'quota anual limitada ao depreciável');
    const sete = await p({ valor_aquisicao: '100.00', valor_residual: '0.00', vida_util_meses: 7, data_inicio_depreciacao: '2026-12-31' });
    assert.deepEqual([sete.quota_mensal, sete.ultima_quota, sete.quota_anual, sete.taxa_anual_percentual, sete.primeira_competencia, sete.ultima_competencia], ['14.28', '14.32', '100.00', '171.4286', '2026-12', '2027-06']);
    const um = await p({ vida_util_meses: 1 });
    assert.deepEqual([um.quota_mensal, um.ultima_quota, um.quota_anual, um.ultima_competencia], ['150000.00', '150000.00', '150000.00', '2026-03']);
    assert.equal((await p({ valor_residual: '200000.00' })).valor_depreciavel, '0.00', 'residual igual ao custo é aceito');

    const recusaPrevia = async (corpo, esperado) => recusa(s, previa(s, { ...aceite, ...corpo }), esperado);
    const residual = await recusaPrevia({ valor_residual: '200000.01' }, [422, 'DEPRECIACAO_RESIDUAL_INVALIDO', 'valor_residual', 'residual_maior_que_custo']);
    assert.deepEqual(residual.json().details, { custo_base: '200000.00', valor_residual: '200000.01' });
    await recusaPrevia({ vida_util_meses: 0 }, [422, 'DEPRECIACAO_VIDA_UTIL_INVALIDA', 'vida_util_meses', 'fora_da_faixa']);
    await recusaPrevia({ vida_util_meses: 1201 }, [422, 'DEPRECIACAO_VIDA_UTIL_INVALIDA', 'vida_util_meses', 'fora_da_faixa']);
    await recusaPrevia({ residual_percentual: '10' }, [422, 'DEPRECIACAO_PARAMETROS_INVALIDOS', 'valor_residual', 'residual_em_uma_forma']);
    await recusaPrevia({ residual_modo: 'PERCENTUAL' }, [422, 'DEPRECIACAO_PARAMETROS_INVALIDOS', 'residual_percentual', 'residual_em_uma_forma']);
    await recusaPrevia({ residual_modo: 'PERCENTUAL', valor_residual: null, residual_percentual: '100.0001' }, [422, 'DEPRECIACAO_RESIDUAL_INVALIDO', 'residual_percentual', 'percentual_fora_da_faixa']);
    await recusaPrevia({ data_inicio_depreciacao: '2026-02-30' }, [422, 'PATRIMONIO_DATA_INVALIDA', 'data_inicio_depreciacao', 'data_inexistente']);
    for (const [corpo, rotulo] of [
      [{ vida_util_meses: -1 }, 'vida negativa'], [{ vida_util_meses: 1.5 }, 'vida fracionária'], [{ valor_aquisicao: '1.234' }, '3 casas'],
      [{ valor_aquisicao: '-1' }, 'negativo'], [{ residual_modo: 'MISTO' }, 'modo'], [{ data_inicio_depreciacao: '2026-3-1' }, 'data'],
      [{ cliente_id: s.c }, 'cliente_id'], [{ metodo: 'LINEAR' }, 'campo extra'],
    ]) {
      await recusa400(s, previa(s, { ...aceite, ...corpo }), rotulo);
    }
    for (const campo of ['valor_aquisicao', 'valor_residual', 'custo_incorporacao', 'residual_percentual']) {
      const r = await recusa400(s, previa(s, { ...aceite, [campo]: 10 }), `${campo} número JSON`);
      assert.deepEqual([r.json().reason, r.json().details], ['valor_deve_ser_texto', { campo }]);
    }
    const outro = await montarPatrimonio(app, { catalogo: false });
    await recusa(s, previa(s, { ...aceite, empresa_id: outro.e1.id }), [404, 'EMPRESA_NOT_FOUND', null, null]);
  });

  test('bem depreciável: parâmetros e prévia no detalhe; PATCH valida o ESTADO FINAL (A6) e depreciavel=false limpa tudo; proprietário só fora de PROPRIO', async () => {
    const s = await montarPatrimonio(app);
    const foraAntes = await contagemForaDoPatrimonio(s.c);
    const aquisicao = {
      data_aquisicao: '2026-02-10', data_disponibilidade: '2026-02-20', valor_aquisicao: '200000.00', fornecedor_parceiro_id: s.parceiro1.id,
      documento_referencia: 'NF 123', garantia_ate: '2028-02-10',
    };
    const depreciacao = { depreciavel: true, vida_util_meses: 120, residual_modo: 'VALOR', valor_residual: '50000.00', data_inicio_depreciacao: '2026-03-01' };
    const t = await criarOk(s, corpoTrator(s, { aquisicao, depreciacao }));
    assert.deepEqual(t.aquisicao, {
      data_aquisicao: '2026-02-10', data_disponibilidade: '2026-02-20', valor_aquisicao: '200000.00', custo_incorporacao: null,
      fornecedor: { id: s.parceiro1.id, nome: 'Agropecuária Parceira' }, documento_referencia: 'NF 123', garantia_ate: '2028-02-10',
    });
    assert.deepEqual(t.depreciacao, {
      depreciavel: true, metodo: 'LINEAR', vida_util_meses: 120, residual_modo: 'VALOR', valor_residual: '50000.00', residual_percentual: null,
      data_inicio_depreciacao: '2026-03-01', previa: PREVIA_ACEITE,
    });
    const id = t.id;
    const nada = (corpo, esperado) => recusa(s, patch(s, id, { versao: 1, ...corpo }), esperado);
    // Estado final inválido, sem limpeza automática.
    await nada({ propriedade: 'TERCEIRO', proprietario_parceiro_id: s.parceiro1.id }, [422, 'DEPRECIACAO_BEM_NAO_PROPRIO', 'depreciacao.depreciavel', 'bem_nao_proprio']);
    const reduzido = await nada({ aquisicao: { valor_aquisicao: '40000.00' } }, [422, 'DEPRECIACAO_RESIDUAL_INVALIDO', 'depreciacao.valor_residual', 'residual_maior_que_custo']);
    assert.deepEqual(reduzido.json().details, { custo_base: '40000.00', valor_residual: '50000.00' });
    await nada({ aquisicao: null }, [422, 'DEPRECIACAO_PARAMETROS_INVALIDOS', 'aquisicao.valor_aquisicao', 'obrigatorio']);
    await nada({ depreciacao: { ...depreciacao, data_inicio_depreciacao: null } }, [422, 'DEPRECIACAO_PARAMETROS_INVALIDOS', 'depreciacao.data_inicio_depreciacao', 'obrigatorio']);
    await nada({ depreciacao: sem(depreciacao, 'vida_util_meses') }, [422, 'DEPRECIACAO_PARAMETROS_INVALIDOS', 'depreciacao.vida_util_meses', 'obrigatorio']);
    await nada({ depreciacao: sem(depreciacao, 'residual_modo', 'valor_residual') }, [422, 'DEPRECIACAO_PARAMETROS_INVALIDOS', 'depreciacao.residual_modo', 'obrigatorio']);
    await nada({ depreciacao: { ...depreciacao, vida_util_meses: 0 } }, [422, 'DEPRECIACAO_VIDA_UTIL_INVALIDA', 'depreciacao.vida_util_meses', 'fora_da_faixa']);
    await nada({ depreciacao: { ...depreciacao, vida_util_meses: 1201 } }, [422, 'DEPRECIACAO_VIDA_UTIL_INVALIDA', 'depreciacao.vida_util_meses', 'fora_da_faixa']);
    await nada({ depreciacao: { ...depreciacao, data_inicio_depreciacao: '2026-02-15' } }, [422, 'PATRIMONIO_DATA_INVALIDA', 'depreciacao.data_inicio_depreciacao', 'antes_da_disponibilidade']);
    await nada({ depreciacao: { ...depreciacao, data_inicio_depreciacao: '2026-02-30' } }, [422, 'PATRIMONIO_DATA_INVALIDA', 'depreciacao.data_inicio_depreciacao', 'data_inexistente']);
    await nada({ depreciacao: { depreciavel: false, vida_util_meses: 120 } }, [422, 'DEPRECIACAO_PARAMETROS_INVALIDOS', 'depreciacao.vida_util_meses', 'nao_depreciavel']);
    await nada({ aquisicao: { ...aquisicao, data_disponibilidade: '2026-02-01' } }, [422, 'PATRIMONIO_DATA_INVALIDA', 'aquisicao.data_disponibilidade', 'antes_da_aquisicao']);
    await nada({ aquisicao: { ...aquisicao, data_aquisicao: '2026-02-30' } }, [422, 'PATRIMONIO_DATA_INVALIDA', 'aquisicao.data_aquisicao', 'data_inexistente']);
    await nada({ aquisicao: { ...aquisicao, fornecedor_parceiro_id: s.parceiro2.id } }, [422, 'BEM_REFERENCIA_INVALIDA', 'aquisicao.fornecedor_parceiro_id', 'inexistente']);
    for (const [corpo, rotulo] of [
      [{ depreciacao: null }, 'depreciacao null'], [{ depreciacao: { vida_util_meses: 120 } }, 'sem depreciavel'], [{ aquisicao: { valor_aquisicao: '1.234' } }, '3 casas'],
      [{ aquisicao: { valor_aquisicao: 1000 } }, 'número JSON'], [{ depreciacao: { ...depreciacao, metodo: 'SOMA_DIGITOS' } }, 'método'],
    ]) {
      await recusa400(s, patch(s, id, { versao: 1, ...corpo }), rotulo);
    }

    // Escalar presente substitui, null limpa, ausente mantém; bloco presente substitui inteiro.
    const marca = await patchOk(s, id, { versao: 1, marca: null, modelo: 'A950 R' });
    assert.deepEqual([marca.versao, marca.marca, marca.modelo, marca.aquisicao.documento_referencia], [2, null, 'A950 R', 'NF 123']);
    const bloco = await patchOk(s, id, { versao: 2, aquisicao: { valor_aquisicao: '210000.00' } });
    assert.deepEqual(bloco.aquisicao, { ...AQUISICAO_VAZIA, valor_aquisicao: '210000.00' });
    assert.equal(bloco.depreciacao.previa.custo_base, '210000.00');
    // Desligar a depreciação limpa todos os parâmetros; aí a propriedade pode mudar.
    const desligada = await patchOk(s, id, { versao: 3, depreciacao: { depreciavel: false } });
    assert.deepEqual(desligada.depreciacao, DEPRECIACAO_VAZIA);
    const linha = await prisma().bemPatrimonial.findUnique({ where: { id } });
    assert.deepEqual([linha.depreciacao_metodo, linha.vida_util_meses, linha.residual_modo, linha.valor_residual, linha.data_inicio_depreciacao], [null, null, null, null, null]);
    const terceiro = await patchOk(s, id, { versao: 4, propriedade: 'TERCEIRO', proprietario_parceiro_id: s.parceiro1.id });
    assert.deepEqual([terceiro.propriedade, terceiro.proprietario], ['TERCEIRO', { id: s.parceiro1.id, nome: 'Agropecuária Parceira' }]);
    const proprio = await recusa(s, patch(s, id, { versao: 5, propriedade: 'PROPRIO' }), [422, 'BEM_CAMPO_NAO_APLICAVEL', 'proprietario_parceiro_id', 'bem_proprio']);
    assert.deepEqual(proprio.json().details, { propriedade: 'PROPRIO' });
    assert.deepEqual((await patchOk(s, id, { versao: 5, propriedade: 'PROPRIO', proprietario_parceiro_id: null })).proprietario, null);

    // Criação: depreciável de terceiro recusado; residual por percentual guardado com 4 casas.
    await recusa(s, criar(s, corpoTrator(s, { codigo_frota: null, propriedade: 'ARRENDADO', aquisicao, depreciacao })), [422, 'DEPRECIACAO_BEM_NAO_PROPRIO', 'depreciacao.depreciavel', 'bem_nao_proprio']);
    await recusa(s, criar(s, corpoTrator(s, { codigo_frota: null, depreciacao })), [422, 'DEPRECIACAO_PARAMETROS_INVALIDOS', 'aquisicao.valor_aquisicao', 'obrigatorio']);
    const pct = await criarOk(s, corpoTrator(s, { codigo_frota: null, aquisicao, depreciacao: { depreciavel: true, vida_util_meses: 60, residual_modo: 'PERCENTUAL', residual_percentual: '12.5', data_inicio_depreciacao: '2026-03-01' } }));
    assert.deepEqual([pct.depreciacao.residual_percentual, pct.depreciacao.valor_residual, pct.depreciacao.previa.valor_residual, pct.depreciacao.previa.quota_mensal], ['12.5000', null, '25000.00', '2916.66']);
    const foraDepois = await contagemForaDoPatrimonio(s.c);
    assert.deepEqual(foraDepois, foraAntes, 'depreciação são parâmetros: nada fora do Patrimônio (financeiro inclusive)');
    for (const m of ESTOQUE_FINANCEIRO_VAZIOS) assert.equal(foraDepois[m], 0, m);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B6 — frota, identificação, classificação, referências, versão e lista', () => {
  test('código de frota: normalizado, único por fazenda (sequencial e corrida [201, 409]), livre em outra fazenda, distinto do número; formato 422', async () => {
    const s = await montarPatrimonio(app);
    // Corrida: dois POST simultâneos do TP-02 na mesma fazenda → um 201 e um 409, uma linha só.
    const [a, b] = await Promise.all([criar(s, corpoTrator(s)), criar(s, corpoTrator(s, { codigo_frota: 'TP-02' }))]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409], `${a.body} ${b.body}`);
    assert.deepEqual(erro([a, b].find((r) => r.statusCode === 409)), [409, 'BEM_CODIGO_FROTA_DUPLICADO', 'codigo_frota', 'codigo_frota_repetido']);
    assert.equal(await prisma().bemPatrimonial.count({ where: { cliente_id: s.c, codigo_frota: 'TP-02' } }), 1);
    const tp02 = [a, b].find((r) => r.statusCode === 201).json();
    assert.deepEqual([tp02.codigo_frota, tp02.numero], ['TP-02', '1'], 'a reserva do número do perdedor foi desfeita');
    // Sequencial, em outra grafia: o mesmo código normalizado.
    await recusa(s, criar(s, corpoTrator(s, { codigo_frota: ' Tp-02' })), [409, 'BEM_CODIGO_FROTA_DUPLICADO', 'codigo_frota', 'codigo_frota_repetido']);
    const naE2 = await criarOk(s, corpoTrator(s, { empresa_id: s.e2.id }));
    assert.deepEqual([naE2.codigo_frota, naE2.empresa_id], ['TP-02', s.e2.id], 'o mesmo código em outra fazenda');
    const tp03 = await criarOk(s, corpoTrator(s, { codigo_frota: 'tp   03' }));
    assert.deepEqual([tp03.codigo_frota, tp03.numero], ['TP 03', '3'], 'numeração contínua depois da corrida');
    // Código de frota igual a um NÚMERO patrimonial existente: são coisas distintas.
    const um = await criarOk(s, corpoTrator(s, { codigo_frota: '1' }));
    assert.deepEqual([um.codigo_frota, um.numero !== '1'], ['1', true]);
    assert.equal((await criarOk(s, corpoTrator(s, { codigo_frota: '  ' }))).codigo_frota, null, 'vazio vira null');
    for (const codigo of ['#1', 'TP_02', '-TP', 'TP--02', 'ABCDEFGHIJKLMNOPQ']) {
      await recusa(s, criar(s, corpoTrator(s, { codigo_frota: codigo })), [422, 'BEM_CODIGO_FROTA_INVALIDO', 'codigo_frota', 'formato']);
    }
    await recusa400(s, criar(s, corpoTrator(s, { codigo_frota: 'X'.repeat(33) })), 'acima do schema');
    // PATCH: trocar para um código em uso → 409; liberar e reaproveitar.
    await recusa(s, patch(s, um.id, { versao: 1, codigo_frota: 'tp-02' }), [409, 'BEM_CODIGO_FROTA_DUPLICADO', 'codigo_frota', 'codigo_frota_repetido']);
    assert.equal((await patchOk(s, tp02.id, { versao: 1, codigo_frota: null })).codigo_frota, null);
    assert.equal((await patchOk(s, um.id, { versao: 1, codigo_frota: 'TP-02' })).codigo_frota, 'TP-02');
  });

  test('identificação e matriz de natureza (§2): formatos 422 BEM_CAMPO_INVALIDO; campo de outra natureza 422 BEM_CAMPO_NAO_APLICAVEL; vazio passa; texto com marcação 400', async () => {
    const s = await montarPatrimonio(app);
    const veiculo = (extra) => criar(s, corpoCaminhonete(s, { codigo_frota: null, ...extra }));
    assert.equal((await ok(veiculo({ placa: 'abc-1234' }), 201)).placa, 'ABC1234');
    assert.equal((await ok(veiculo({ placa: ' abc 1d23 ' }), 201)).placa, 'ABC1D23');
    for (const [extra, esperado] of [
      [{ placa: 'AB-12' }, ['placa', 'formato']], [{ placa: 'ABCD123' }, ['placa', 'formato']], [{ placa_uf: 'XX' }, ['placa_uf', 'uf_invalida']],
      [{ renavam: '1234' }, ['renavam', 'formato']], [{ renavam: '123456789012' }, ['renavam', 'formato']], [{ chassi: '9BWZZZ377VT00425I' }, ['chassi', 'formato']],
      [{ chassi: '9BWZZZ377VT0042' }, ['chassi', 'formato']], [{ ano_fabricacao: 1899 }, ['ano_fabricacao', 'fora_da_faixa']], [{ ano_modelo: 2102 }, ['ano_modelo', 'fora_da_faixa']],
      [{ potencia_cv: '0' }, ['potencia_cv', 'nao_positivo']],
    ]) {
      await recusa(s, veiculo(extra), [422, 'BEM_CAMPO_INVALIDO', ...esperado]);
    }
    await recusa(s, criar(s, corpoCerca(s, { ano_conclusao: 1799 })), [422, 'BEM_CAMPO_INVALIDO', 'ano_conclusao', 'fora_da_faixa']);
    const pot = await recusa400(s, veiculo({ potencia_cv: 95 }), 'potência número JSON');
    assert.deepEqual(pot.json().details, { campo: 'potencia_cv' });
    for (const [corpo, campo, natureza] of [
      [corpoTrator(s, { codigo_frota: null, placa: 'ABC1234' }), 'placa', 'MAQUINA'],
      [corpoTrator(s, { codigo_frota: null, renavam: '123456789' }), 'renavam', 'MAQUINA'],
      [corpoGerador(s, { chassi: '9BWZZZ377VT004251' }), 'chassi', 'EQUIPAMENTO'],
      [corpoImplemento(s, { potencia_cv: '75' }), 'potencia_cv', 'IMPLEMENTO'],
      [corpoCerca(s, { numero_serie: 'X1' }), 'numero_serie', 'BENFEITORIA'],
      [corpoTrator(s, { codigo_frota: null, material: 'Aço' }), 'material', 'MAQUINA'],
      [corpoCaminhonete(s, { codigo_frota: null, ano_conclusao: 2020 }), 'ano_conclusao', 'VEICULO'],
      [corpoTrator(s, { codigo_frota: null, compatibilidade: 'Plantadeira' }), 'compatibilidade', 'MAQUINA'],
    ]) {
      const r = await recusa(s, criar(s, corpo), [422, 'BEM_CAMPO_NAO_APLICAVEL', campo, 'nao_aplicavel']);
      assert.deepEqual(r.json().details, { natureza }, campo);
    }
    const vazio = await criarOk(s, corpoTrator(s, { codigo_frota: null, placa: null, renavam: '', material: null, tanques: [], medicoes: [] }));
    assert.deepEqual([vazio.placa, vazio.renavam, vazio.material], [null, null, null], 'null e vazio passam e não gravam nada');
    await recusa400(s, criar(s, corpoTrator(s, { codigo_frota: null, nome: '<script>x</script>' })), 'marcação no nome');
    await recusa400(s, criar(s, corpoTrator(s, { codigo_frota: null, observacoes: 'linha\u0000nula' })), 'caractere de controle');
    await recusa400(s, criar(s, corpoTrator(s, { codigo_frota: null, nome: '   ' })), 'nome em branco');
  });

  test('classificação: família/tipo inexistente, de outro tenant, inativo, tipo de outra família; troca de família de outra natureza 409 sem apagar; mesma natureza preserva medidor e tanques; inativar/reativar', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    await recusa(s, criar(s, corpoTrator(s, { familia_id: INEXISTENTE })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    await recusa(s, criar(s, corpoTrator(s, { familia_id: outro.fam.MAQUINAS, tipo_id: outro.tip.TRATOR_PNEUS })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    await recusa(s, criar(s, corpoTrator(s, { tipo_id: INEXISTENTE })), [422, 'BEM_REFERENCIA_INVALIDA', 'tipo_id', 'inexistente']);
    await recusa(s, criar(s, corpoTrator(s, { tipo_id: s.tip.CAMINHONETE })), [422, 'BEM_TIPO_FAMILIA_INCOMPATIVEL', 'tipo_id', 'tipo_de_outra_familia']);
    await ok(req('PATCH', `/patrimonio-tipos/${s.tip.TRATOR_ESTEIRAS}`, s.token, { versao: 1, ativo: false }));
    await recusa(s, criar(s, corpoTrator(s, { tipo_id: s.tip.TRATOR_ESTEIRAS })), [422, 'BEM_REFERENCIA_INVALIDA', 'tipo_id', 'inativo']);

    const trator = await criarOk(s, corpoTrator(s));
    // Natureza nunca muda: família de outra natureza → 409, medidor e tanques intactos.
    const nat = await recusa(s, patch(s, trator.id, { versao: 1, familia_id: s.fam.VEICULOS, tipo_id: s.tip.CAMINHONETE }), [409, 'BEM_NATUREZA_IMUTAVEL', 'familia_id', 'natureza_diferente']);
    assert.deepEqual(nat.json().details, { natureza: 'MAQUINA', natureza_familia: 'VEICULO' });
    // Mesma natureza: permitido, preserva medidor e tanques.
    const pesadas = await ok(req('POST', '/patrimonio-familias', s.token, { codigo: 'MAQ_PESADAS', nome: 'Máquinas pesadas', natureza: 'MAQUINA' }), 201);
    const escav = await ok(req('POST', '/patrimonio-tipos', s.token, { familia_id: pesadas.id, codigo: 'ESCAVADEIRA', nome: 'Escavadeira' }), 201);
    await recusa(s, patch(s, trator.id, { versao: 1, familia_id: pesadas.id }), [422, 'BEM_TIPO_FAMILIA_INCOMPATIVEL', 'tipo_id', 'tipo_de_outra_familia']);
    const trocado = await patchOk(s, trator.id, { versao: 1, familia_id: pesadas.id, tipo_id: escav.id });
    assert.deepEqual([trocado.versao, trocado.natureza, trocado.familia.codigo, trocado.tipo.codigo], [2, 'MAQUINA', 'MAQ_PESADAS', 'ESCAVADEIRA']);
    assert.deepEqual([trocado.medidor, trocado.tanques], [trator.medidor, trator.tanques], 'medidor e tanques preservados');

    // Inativar mantém tudo legível; classificação inativada aparece como inativa no bem.
    const inativo = await patchOk(s, trator.id, { versao: 2, ativo: false });
    assert.deepEqual([inativo.ativo, inativo.versao], [false, 3]);
    await ok(req('PATCH', `/patrimonio-familias/${pesadas.id}`, s.token, { versao: 1, ativo: false }));
    await ok(req('PATCH', `/patrimonio-tipos/${escav.id}`, s.token, { versao: 1, ativo: false }));
    const legivel = await detalhe(s, trator.id);
    assert.deepEqual([legivel.familia.ativo, legivel.tipo.ativo, legivel.tanques.length, legivel.medidor.tipo], [false, false, 1, 'HORIMETRO']);
    // Editar outro campo sem tocar na classificação inativa é permitido.
    assert.equal((await patchOk(s, trator.id, { versao: 3, nome: 'Trator TP-02 (parado)' })).versao, 4);
    // Reativar com família ou tipo inativo → 409.
    await recusa(s, patch(s, trator.id, { versao: 4, ativo: true }), [409, 'BEM_CLASSIFICACAO_INATIVA', 'familia_id', 'classificacao_inativa']);
    await ok(req('PATCH', `/patrimonio-familias/${pesadas.id}`, s.token, { versao: 2, ativo: true }));
    await recusa(s, patch(s, trator.id, { versao: 4, ativo: true }), [409, 'BEM_CLASSIFICACAO_INATIVA', 'tipo_id', 'classificacao_inativa']);
    await ok(req('PATCH', `/patrimonio-tipos/${escav.id}`, s.token, { versao: 2, ativo: true }));
    assert.equal((await patchOk(s, trator.id, { versao: 4, ativo: true })).ativo, true);
  });

  test('referências da fazenda: parceiro, centro, área e responsável de outra fazenda/tenant ou inativos → 422; mantidas depois de inativadas; detalhe com {id, nome}', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const responsavel = await s.conta(null);
    const inativo = await s.conta(null, { ativo: false });
    const base = (extra) => criar(s, corpoTrator(s, { codigo_frota: null, propriedade: 'TERCEIRO', proprietario_parceiro_id: s.parceiro1.id, ...extra }));
    await recusa(s, base({ proprietario_parceiro_id: s.parceiro2.id }), [422, 'BEM_REFERENCIA_INVALIDA', 'proprietario_parceiro_id', 'inexistente']);
    await recusa(s, base({ proprietario_parceiro_id: outro.parceiro1.id }), [422, 'BEM_REFERENCIA_INVALIDA', 'proprietario_parceiro_id', 'inexistente']);
    await recusa(s, base({ proprietario_parceiro_id: s.parceiro1Inativo.id }), [422, 'BEM_REFERENCIA_INVALIDA', 'proprietario_parceiro_id', 'inativo']);
    await recusa(s, base({ centro_custo_id: s.centro2.id }), [422, 'BEM_REFERENCIA_INVALIDA', 'centro_custo_id', 'inexistente']);
    await recusa(s, base({ area_id: s.area2.id }), [422, 'BEM_REFERENCIA_INVALIDA', 'area_id', 'inexistente']);
    await recusa(s, base({ responsavel_usuario_id: outro.adm.usuario.id }), [422, 'BEM_REFERENCIA_INVALIDA', 'responsavel_usuario_id', 'inexistente']);
    await recusa(s, base({ responsavel_usuario_id: inativo.id }), [422, 'BEM_REFERENCIA_INVALIDA', 'responsavel_usuario_id', 'inativo']);
    await recusa(s, base({ aquisicao: { fornecedor_parceiro_id: s.parceiro1Inativo.id } }), [422, 'BEM_REFERENCIA_INVALIDA', 'aquisicao.fornecedor_parceiro_id', 'inativo']);
    await recusa(s, base({ propriedade: 'PROPRIO' }), [422, 'BEM_CAMPO_NAO_APLICAVEL', 'proprietario_parceiro_id', 'bem_proprio']);

    const b = await criarOk(s, corpoTrator(s, {
      codigo_frota: null, propriedade: 'CEDIDO', proprietario_parceiro_id: s.parceiro1.id, centro_custo_id: s.centro1.id, area_id: s.area1.id,
      responsavel_usuario_id: responsavel.id, localizacao_descricao: 'Galpão de máquinas', aquisicao: { fornecedor_parceiro_id: s.parceiro1.id },
    }));
    assert.deepEqual(
      [b.proprietario, b.centro_custo, b.area, b.responsavel, b.aquisicao.fornecedor, b.localizacao_descricao],
      [
        { id: s.parceiro1.id, nome: 'Agropecuária Parceira' }, { id: s.centro1.id, numero: s.centro1.numero, nome: 'Máquinas e frota' }, { id: s.area1.id, nome: 'Retiro' },
        { id: responsavel.id, nome: responsavel.nome }, { id: s.parceiro1.id, nome: 'Agropecuária Parceira' }, 'Galpão de máquinas',
      ]
    );
    assert.ok(!JSON.stringify(b).includes(responsavel.login), 'o login do responsável nunca sai');
    // Inativadas depois: continuam no bem; PATCH de outro campo não as reconfere.
    const p = prisma();
    await p.fornecedor.update({ where: { id: s.parceiro1.id }, data: { ativo: false } });
    await p.centroCusto.update({ where: { id: s.centro1.id }, data: { ativo: false } });
    await p.areaPastagem.update({ where: { id: s.area1.id }, data: { ativo: false } });
    await p.usuario.update({ where: { id: responsavel.id }, data: { ativo: false } });
    const mantido = await patchOk(s, b.id, { versao: 1, nome: 'Trator cedido', centro_custo_id: s.centro1.id });
    assert.deepEqual([mantido.versao, mantido.centro_custo.id, mantido.area.id, mantido.responsavel.id], [2, s.centro1.id, s.area1.id, responsavel.id]);
    // Trocar para uma referência inativa, não.
    await recusa(s, patch(s, b.id, { versao: 2, proprietario_parceiro_id: s.parceiro1Inativo.id }), [422, 'BEM_REFERENCIA_INVALIDA', 'proprietario_parceiro_id', 'inativo']);
    // Limpar com null.
    const limpo = await patchOk(s, b.id, { versao: 2, centro_custo_id: null, area_id: null, responsavel_usuario_id: null });
    assert.deepEqual([limpo.centro_custo, limpo.area, limpo.responsavel], [null, null, null]);
  });

  test('versão: errada 409 com as versões; PATCH sem mudança efetiva mantém a versão e não audita; dois PATCH simultâneos [200, 409]', async () => {
    const s = await montarPatrimonio(app);
    const t = await criarOk(s, corpoTrator(s));
    const conflito = await recusa(s, patch(s, t.id, { versao: 2, nome: 'Outro' }), [409, 'PATRIMONIO_VERSAO_CONFLITO', null, null]);
    assert.deepEqual(conflito.json().details, { versao_atual: 1, versao_informada: 2 });
    const tanques = t.tanques.map((x) => ({ id: x.id, identificador: x.identificador, capacidade_litros: '180', combustivel_ids: x.combustiveis.map((c) => c.id) }));
    const igual = await patchOk(s, t.id, { versao: 1, nome: 'Trator TP-02', codigo_frota: 'tp-02', potencia_cv: '95.0', medidor: { tipo: 'HORIMETRO' }, tanques, medicoes: [], placa: null });
    assert.deepEqual(igual, t, 'PATCH sem mudança devolve o atual, mesma versão');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, entidade_id: t.id, acao: 'update' } }), 0);
    const [a, b] = await Promise.all([patch(s, t.id, { versao: 1, nome: 'Nome A' }), patch(s, t.id, { versao: 1, nome: 'Nome B' })]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
    const perdeu = [a, b].find((r) => r.statusCode === 409);
    assert.deepEqual([perdeu.json().code, perdeu.json().details], ['PATRIMONIO_VERSAO_CONFLITO', { versao_atual: 2, versao_informada: 1 }]);
    const gravado = await prisma().bemPatrimonial.findUnique({ where: { id: t.id } });
    assert.equal(gravado.versao, 2, 'uma escrita só');
    assert.equal(gravado.nome, [a, b].find((r) => r.statusCode === 200).json().nome);
  });

  test('lista: keyset e total, filtros (situação, família, tipo, natureza), busca (nome, número, frota, placa com/sem hífen, série) literal; fazendas isoladas; schema fechado', async () => {
    const s = await montarPatrimonio(app);
    const cerca = await criarOk(s, corpoCerca(s));
    const curral = await criarOk(s, corpoCurral(s));
    const trator = await criarOk(s, corpoTrator(s));
    const camionete = await criarOk(s, corpoCaminhonete(s));
    const impl = await criarOk(s, corpoImplemento(s));
    const naE2 = await criarOk(s, corpoTrator(s, { empresa_id: s.e2.id }));
    const lista = async (qs) => ok(req('GET', `/bens-patrimoniais?empresa_id=${s.e1.id}${qs}`, s.token));
    const ids = async (qs) => (await lista(qs)).items.map((i) => i.id);

    const p1 = await lista('&limit=2');
    assert.deepEqual([p1.total, p1.limit, p1.has_more, p1.items.map((i) => i.id)], [5, 2, true, [impl.id, camionete.id]], 'createdAt desc');
    const p2 = await lista(`&limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`);
    const p3 = await lista(`&limit=2&cursor=${encodeURIComponent(p2.next_cursor)}`);
    assert.deepEqual([...p2.items, ...p3.items].map((i) => i.id), [trator.id, curral.id, cerca.id]);
    assert.deepEqual([p3.total, p3.has_more, p3.next_cursor], [5, false, null]);
    const item = p2.items[0];
    assert.deepEqual(item, {
      id: trator.id, numero: trator.numero, codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', familia: { id: s.fam.MAQUINAS, nome: 'Máquinas' },
      tipo: { id: s.tip.TRATOR_PNEUS, nome: 'Trator de pneus' }, propriedade: 'PROPRIO', medidor_tipo: 'HORIMETRO', ativo: true, versao: 1,
      created_date: trator.created_date, updated_date: trator.updated_date,
    });
    assert.deepEqual((await ids('&natureza=BENFEITORIA')).sort(), [cerca.id, curral.id].sort());
    assert.deepEqual(await ids(`&familia_id=${s.fam.VEICULOS}`), [camionete.id]);
    assert.deepEqual(await ids(`&tipo_id=${s.tip.CURRAL}`), [curral.id]);
    assert.deepEqual(await ids('&ativo=false'), []);
    await patchOk(s, impl.id, { versao: 1, ativo: false });
    assert.deepEqual(await ids('&ativo=false'), [impl.id]);
    assert.equal((await lista('&ativo=true')).total, 4);
    for (const q of ['abc-1d23', 'ABC1D23', 'abc 1d23']) assert.deepEqual(await ids(`&q=${encodeURIComponent(q)}`), [camionete.id], `placa ${q}`);
    assert.deepEqual(await ids('&q=tp-02'), [trator.id], 'frota, só desta fazenda');
    assert.deepEqual(await ids('&q=RC-2020'), [impl.id], 'número de série');
    assert.deepEqual(await ids('&q=curral'), [curral.id], 'nome');
    assert.ok((await ids(`&q=${trator.numero}`)).includes(trator.id), 'número patrimonial');
    assert.equal((await lista('&q=%25')).total, 0, 'q=% é literal');
    assert.equal((await lista('&q=_')).total, 0, 'q=_ é literal');
    const e2 = await ok(req('GET', `/bens-patrimoniais?empresa_id=${s.e2.id}`, s.token));
    assert.deepEqual(e2.items.map((i) => i.id), [naE2.id]);
    for (const qs of ['', '&limit=0', '&limit=501', '&natureza=FROTA', '&ativo=sim', '&cliente_id=x', '&cursor=lixo']) {
      const url = qs === '' ? '/bens-patrimoniais' : `/bens-patrimoniais?empresa_id=${s.e1.id}${qs}`;
      assert.equal((await req('GET', url, s.token)).statusCode, 400, url);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B7 — opções da fazenda', () => {
  test('responsáveis (usuários ativos, só {id, nome}), parceiros, centros e áreas ativos da fazenda; empresa obrigatória e do tenant; keyset e busca', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const inativo = await s.conta(null, { ativo: false });
    const ativo = await s.conta(null);
    const opcoes = (recurso, qs = '', empresa = s.e1.id, tok = s.token) => ok(req('GET', `/bens-patrimoniais-opcoes/${recurso}?empresa_id=${empresa}${qs}`, tok));

    const resp = await opcoes('responsaveis');
    assert.ok(resp.itens.every((i) => Object.keys(i).sort().join() === 'id,nome'), 'só {id, nome}');
    const idsResp = resp.itens.map((i) => i.id);
    assert.ok(idsResp.includes(ativo.id) && idsResp.includes(s.adm.usuario.id) && !idsResp.includes(inativo.id));
    assert.ok(!JSON.stringify(resp).includes(ativo.login), 'login nunca sai');
    assert.deepEqual((await opcoes('responsaveis', '', s.e2.id)).itens, resp.itens, 'responsáveis são do tenant');
    const pagina = await opcoes('responsaveis', '&limit=1');
    assert.deepEqual([pagina.itens.length, pagina.has_more], [1, true]);
    const pagina2 = await opcoes('responsaveis', `&limit=1&cursor=${encodeURIComponent(pagina.next_cursor)}`);
    assert.notEqual(pagina2.itens[0].id, pagina.itens[0].id);
    assert.deepEqual((await opcoes('responsaveis', `&q=${encodeURIComponent(ativo.nome)}`)).itens.map((i) => i.id), [ativo.id]);
    assert.deepEqual((await opcoes('responsaveis', `&q=${encodeURIComponent(ativo.login)}`)).itens, [], 'a busca não usa o login');

    assert.deepEqual((await opcoes('parceiros')).itens, [{ id: s.parceiro1.id, nome: 'Agropecuária Parceira' }], 'só ativos desta fazenda');
    assert.deepEqual((await opcoes('parceiros', '', s.e2.id)).itens, [{ id: s.parceiro2.id, nome: 'Parceiro da Fazenda 2' }]);
    assert.deepEqual((await opcoes('centros-custo')).itens, [{ id: s.centro1.id, numero: s.centro1.numero, nome: 'Máquinas e frota' }]);
    assert.deepEqual((await opcoes('areas')).itens, [{ id: s.area1.id, nome: 'Retiro' }]);
    assert.deepEqual((await opcoes('areas', '&q=sede')).itens, []);
    for (const recurso of ['responsaveis', 'parceiros', 'centros-custo', 'areas']) {
      assert.equal((await req('GET', `/bens-patrimoniais-opcoes/${recurso}`, s.token)).statusCode, 400, `${recurso} sem empresa`);
      assert.deepEqual(erro(await req('GET', `/bens-patrimoniais-opcoes/${recurso}?empresa_id=${outro.e1.id}`, s.token)).slice(0, 2), [404, 'EMPRESA_NOT_FOUND'], recurso);
      assert.equal((await req('GET', `/bens-patrimoniais-opcoes/${recurso}?empresa_id=${s.e1.id}&familia_id=${s.fam.MAQUINAS}`, s.token)).statusCode, 400, `${recurso} com familia_id`);
    }
  });
});
