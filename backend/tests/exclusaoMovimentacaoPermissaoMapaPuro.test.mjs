/**
 * D-PROD-266 — a exclusão de movimentação do lote passa a valer também para o
 * operador com a chave do Mapa Geral `excluir_movimentacoes_lote` (gravadora,
 * nasce desligada). Avaliação PURA (sem banco): a regra e o registro das guardas
 * nas duas rotas. A prova HTTP com PostgreSQL real está em
 * `exclusaoMovimentacaoPermissaoMapa.test.mjs`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ACOES_GRAVADORAS_MAPA,
  CHAVE_EXCLUIR_MOVIMENTACOES_LOTE,
  podeExcluirMovimentacaoLote,
  mapaPermite,
} from '../src/shared/auth/autorizacaoTela.js';
import { registrarMovimentacaoMapaRoutes } from '../src/modules/movimentacoesMapa/movimentacaoMapaRoutes.js';

const linhaMapa = (visualizar = true) => ({ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', visualizar });
const operador = (mapa, { tela = true, modulos = ['mapa'], isAdmin = false } = {}) => ({
  ativo: true,
  adminReal: false,
  registro: { is_admin: isAdmin, modulos_permitidos: modulos, permissoes_telas: [linhaMapa(tela)], mapa_geral_permissoes: mapa },
});

describe('D-PROD-266 — regra pura de quem exclui movimentação do lote', () => {
  test('a chave existe e é gravadora', () => {
    assert.equal(CHAVE_EXCLUIR_MOVIMENTACOES_LOTE, 'excluir_movimentacoes_lote');
    assert.ok(ACOES_GRAVADORAS_MAPA.includes('excluir_movimentacoes_lote'));
  });

  test('administrador real e is_admin passam; conta inativa não', () => {
    assert.equal(podeExcluirMovimentacaoLote({ ativo: true, adminReal: true, registro: null }), true);
    assert.equal(podeExcluirMovimentacaoLote(operador({}, { isAdmin: true, modulos: [] })), true);
    assert.equal(podeExcluirMovimentacaoLote({ ativo: false, adminReal: false, registro: null }), false);
    assert.equal(podeExcluirMovimentacaoLote({ ativo: false, adminReal: false, registro: { is_admin: true } }), false);
    assert.equal(podeExcluirMovimentacaoLote(null), false);
  });

  test('operador: só com a chave === true e a tela do Mapa Geral visível', () => {
    assert.equal(podeExcluirMovimentacaoLote(operador({ excluir_movimentacoes_lote: true })), true);
    assert.equal(podeExcluirMovimentacaoLote(operador({ mover_lotes: true, visualizar_historico_movimentacoes_lote: true })), false, 'ausente = negado');
    assert.equal(podeExcluirMovimentacaoLote(operador(null)), false, 'objeto do mapa ausente = negado');
    assert.equal(podeExcluirMovimentacaoLote(operador({ excluir_movimentacoes_lote: 'true' })), false, 'não booleano = negado');
    assert.equal(podeExcluirMovimentacaoLote(operador({ excluir_movimentacoes_lote: 1 })), false);
    assert.equal(podeExcluirMovimentacaoLote(operador({ excluir_movimentacoes_lote: true }, { tela: false })), false, 'sem a tela');
    assert.equal(podeExcluirMovimentacaoLote(operador({ excluir_movimentacoes_lote: true }, { modulos: [] })), false, 'sem o módulo');
    assert.equal(podeExcluirMovimentacaoLote({ ativo: true, adminReal: false, registro: null }), false, 'sem linha');
    assert.equal(mapaPermite(operador({ excluir_movimentacoes_lote: true }), 'excluir_movimentacoes_lote'), true);
  });
});

describe('D-PROD-266 — as duas rotas da exclusão têm guarda (preHandler)', () => {
  test('GET elegibilidade-exclusao e POST exclusao registram preHandler; o resto da exclusão não mudou de URL', async () => {
    /** @type {Record<string, any>} */
    const rotas = {};
    const registrar = (metodo) => (url, opcoes) => { rotas[`${metodo} ${url}`] = opcoes; };
    const app = { autenticar: async () => {}, get: registrar('GET'), post: registrar('POST'), patch: registrar('PATCH'), delete: registrar('DELETE') };
    await registrarMovimentacaoMapaRoutes(/** @type {any} */ (app));
    for (const chave of ['GET /movimentacoes-mapa/:id/elegibilidade-exclusao', 'POST /movimentacoes-mapa/:id/exclusao']) {
      const opcoes = rotas[chave];
      assert.ok(opcoes, `${chave} registrada`);
      assert.ok(Array.isArray(opcoes.preHandler) && opcoes.preHandler.length === 1 && typeof opcoes.preHandler[0] === 'function', `${chave} com guarda`);
      assert.deepEqual(opcoes.onRequest, [app.autenticar], `${chave} autenticada`);
    }
    // O corpo da exclusão continua só {operation_id, motivo} (nada de tenant/ator no corpo).
    const corpo = rotas['POST /movimentacoes-mapa/:id/exclusao'].schema.body;
    assert.equal(corpo.additionalProperties, false);
    assert.deepEqual(Object.keys(corpo.properties).sort(), ['motivo', 'operation_id']);
  });
});

/** Fonte sem comentários (o que vale é o código, não a explicação). */
const fonte = (rel) =>
  readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('D-PROD-266 — QUAL guarda cada ponto aplica (sem banco)', () => {
  test('as duas rotas usam a guarda da chave excluir_movimentacoes_lote (porQualquer, que já libera admin real e is_admin)', () => {
    const rotas = fonte('modules/movimentacoesMapa/movimentacaoMapaRoutes.js');
    assert.match(rotas, /const porExclusaoMovimentacaoLote = \(\) => porQualquer\(\{ mapa: CHAVE_EXCLUIR_MOVIMENTACOES_LOTE \}\);/);
    for (const rota of ["app.get('/movimentacoes-mapa/:id/elegibilidade-exclusao'", "app.post('/movimentacoes-mapa/:id/exclusao'"]) {
      const linha = rotas.split('\n').find((l) => l.includes(rota));
      assert.ok(linha, `${rota} existe`);
      assert.match(linha, /preHandler: \[porExclusaoMovimentacaoLote\(\)\]/, `${rota} com a guarda da chave`);
    }
  });

  test('o serviço reconfere DENTRO da transação e ANTES da idempotência', () => {
    const servico = fonte('modules/movimentacoesMapa/movimentacaoMapaExclusaoService.js');
    const inicio = servico.indexOf('export const excluir = async');
    assert.ok(inicio >= 0);
    const corpo = servico.slice(inicio, servico.indexOf('export const elegibilidadeExclusao', inicio));
    const transacao = corpo.indexOf('prisma.$transaction(async (tx) =>');
    const guarda = corpo.indexOf('await exigirExclusaoMovimentacaoLote(contexto, tx);');
    const idempotencia = corpo.indexOf('executarComIdempotencia(tx,');
    assert.ok(transacao >= 0 && guarda > transacao && idempotencia > guarda, 'transação → guarda → idempotência');
    assert.doesNotMatch(corpo, /exigirAdminTenant/, 'a guarda antiga (só administrador) não volta');
  });
});
