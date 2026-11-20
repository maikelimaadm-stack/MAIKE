/**
 * D-PROD-253 — tradução do P2002 SEM o alvo, como em PRODUÇÃO. PostgreSQL real.
 *
 * Em produção o runtime (`maike_vercel`) não é dono das tabelas e elas têm RLS
 * (sem FORCE, política só para ele): o PostgreSQL omite o DETAIL da violação de
 * unique e o Prisma 6.19 devolve o P2002 com `meta.target` nulo. Antes desta
 * decisão, todo tradutor que casava o alvo com o nome da coluna falhava ali e
 * o erro caía no 409 `CONCURRENCY_CONFLICT` genérico, que o cliente repete com
 * a mesma chave para sempre. `comPapelNaoDono` (`papelNaoDono.mjs`) reproduz o
 * arranjo de produção. Prova:
 *  - U0 a pré-condição: sob o papel, o P2002 vem sem alvo (só com `modelName`)
 *    e nem o SQL bruto diz a constraint; como dono, o alvo existe;
 *  - U1–U3 o mapa genérico do `emTransacao`: sem o alvo, a conferência da
 *    chave DEPOIS do rollback dá o erro de negócio, com nada gravado; com o
 *    alvo, o trecho decide e a conferência nem roda (o comportamento de antes);
 *    chave livre, conferência que falha, `soPeloAlvo` e mapa vazio seguem o
 *    caminho genérico de antes;
 *  - A1–A2 o abastecimento (molde do IT4g da D-PROD-193): a `operation_id` de
 *    um abastecimento gravado, sem o recibo, dá 409 IDEMPOTENCY_CONFLICT pela
 *    pré-conferência e, na corrida em que a chave é ocupada DEPOIS dela, pela
 *    conferência depois do rollback; nada gravado, reenvio auditado;
 *  - E1 a empresa: corrida pelo mesmo nome → 201 + 409 EMPRESA_NAME_CONFLICT;
 *  - M1 o MAIKE Admin: corrida pelo mesmo código (criar e editar) → código
 *    duplicado (antes, sem o alvo, era "login duplicado"); pelo mesmo login →
 *    login duplicado; o model desconhecido segue o caminho genérico;
 *  - L1–L3 o Lançamento de Atividades (módulo `atividades`): a chave de uma
 *    linha de mão de obra, de serviço ou de máquina já gravada, sem o recibo,
 *    dá 409 IDEMPOTENCY_CONFLICT (antes, sem o alvo, 409 CONCURRENCY_CONFLICT,
 *    que o cliente repete para sempre); a chave de um lançamento do dia com
 *    linhas de mão de obra (as derivadas `:o`) e a de uma linha de produto
 *    também, e a mesma área de novo dá 422 `ja_na_atividade`; nada gravado.
 *    Nos três, a chave é conferida no início da escrita e, sem o alvo, de novo
 *    depois do rollback: tirar só a pré-conferência mantém o teste verde, e
 *    tirar as duas o deixa vermelho com o 409 CONCURRENCY_CONFLICT;
 *  - L4 o registro de várias áreas (D-PROD-263): corrida em que a chave
 *    derivada da 2ª área (`<chave>:a2:o1`) é ocupada depois da pré-conferência
 *    → 409 IDEMPOTENCY_CONFLICT pela conferência de TODAS as bases (conferir só
 *    a chave do corpo dá o 409 CONCURRENCY_CONFLICT); nada gravado;
 *  - C1 as culturas: na corrida pelo mesmo código, com o alvo, o código (como
 *    antes); sem ele, o 409 genérico, nunca "nome" por palpite (antes, todo
 *    P2002 sem alvo virava `CULTURA_NAME_CONFLICT`), e o reenvio cai na
 *    pré-conferência sob a trava da fazenda, com o código certo;
 *  - S1 o inventário fechado: um só leitor do alvo, nem o `meta` inteiro do
 *    erro é lido fora dele, os tradutores que o usam e as entradas
 *    `soPeloAlvo`, cada uma sob trava.
 *
 * As corridas são DETERMINÍSTICAS, no padrão de
 * `patrimonioP1AbastecimentosConcorrencia.test.mjs`: um "portão" (gatilho
 * BEFORE temporário que espera um advisory lock segurado pelo TESTE) para o
 * comando no ponto exato, e quem espera quem é lido em `pg_locks`, nunca
 * inferido por relógio.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp, criarAdminComSessao } from './helpers.mjs';
import { comPapelNaoDono, papelDaTransacao } from './papelNaoDono.mjs';
import { acoesAbastecimento, corpoAbastecimento, fotoAbastecimento, montarAbastecimento, prisma } from './patrimonioP1AbastecimentoCenario.mjs';
import { montarLinhasCusto } from './atividadeLinhaCustoCenario.mjs';
import { traduzirUnique } from '../src/modules/adminMaike/adminClientesGestaoService.js';
import { TIPO_CONFIRMAR } from '../src/modules/patrimonio/abastecimentoPlano.js';
import { AppError } from '../src/shared/errors/AppError.js';
import { normalizarErro } from '../src/shared/errors/errorHandler.js';
import { TRANSACAO_CURTA, emTransacao, soPeloAlvo } from '../src/shared/prisma/transacaoConcorrente.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let A;
/** Pool PRÓPRIO do teste (portão, observação de `pg_locks` e escrita "por fora"): roda como o dono, fora de `comPapelNaoDono`. @type {PrismaClient} */
let aux;

before(async () => {
  app = await criarApp();
  await app.ready();
  A = acoesAbastecimento(app);
  aux = new PrismaClient();
});
after(async () => {
  await aux?.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${PORTAO}()`);
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

// ─── portão e observação de travas ──────────────────────────────────────────

const PORTAO = 'p2002_sem_alvo_portao';
/** Gatilho BEFORE `evento` em `tabela` que, quando `condicao`, espera o advisory lock (195, 1) do teste. */
const instalarPortao = async (tabela, condicao, evento = 'INSERT') => {
  await aux.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(195, 1); RETURN NEW; END $f$`);
  await aux.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
  await aux.$executeRawUnsafe(`CREATE TRIGGER ${PORTAO} BEFORE ${evento} ON "${tabela}" FOR EACH ROW WHEN (${condicao}) EXECUTE FUNCTION ${PORTAO}()`);
};
const removerPortao = (tabela) => aux.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
/** Portão fechado (lock exclusivo numa transação do TESTE) enquanto `fn` roda; abre no commit. @template T @param {() => Promise<T>} fn */
const comPortaoFechado = (fn) =>
  aux.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(195, 1)`;
    return fn();
  }, { maxWait: 10000, timeout: 60000 });
/** pids parados no portão. @returns {Promise<number[]>} */
const paradosNoPortao = async () =>
  /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 195 AND objid = 1 AND objsubid = 2 AND NOT granted`).map((r) => r.pid);
/** @param {number} pid @returns {Promise<number[]>} quem espera uma trava segura por `pid` */
const bloqueadosPor = async (pid) =>
  /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`).map((r) => r.pid);
/** Espera uma CONDIÇÃO observável (nunca um tempo fixo); estoura com rótulo. @template T @param {() => Promise<T>} cond @param {string} rotulo */
const esperar = async (cond, rotulo, ms = 15000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 15));
  }
};
/** Pedido em voo com o estado observável. @param {Promise<any>} pedido */
const acompanhar = (pedido) => {
  /** @type {{ feito: boolean, r: any, p: Promise<any> }} */
  const a = { feito: false, r: null, p: Promise.resolve() };
  a.p = Promise.resolve(pedido).then((r) => {
    Object.assign(a, { feito: true, r });
    return r;
  });
  return a;
};
const corpoDe = (r) => {
  try {
    return r.json();
  } catch {
    return null;
  }
};
const resumo = (r) => `${r.statusCode} ${corpoDe(r)?.code ?? ''} ${r.body}`;

/**
 * Os `pedidos` param TODOS no portão (`tabela`/`condicao`), com o que fizeram
 * antes ainda sem commit; `enquanto(pids)` roda com eles parados; o portão
 * abre e as respostas voltam. Com `segundoEsperaOPrimeiro`, só o 1º para no
 * portão e o 2º TEM de ficar esperando uma trava do 1º (`pg_blocking_pids`).
 * @param {{ tabela: string, condicao: string, evento?: string }} portao
 * @param {Array<() => Promise<any>>} pedidos
 * @param {{ enquanto?: (pids: number[]) => Promise<void>, segundoEsperaOPrimeiro?: boolean }} [opcoes]
 */
const comPedidosNoPortao = async (portao, pedidos, { enquanto = async () => {}, segundoEsperaOPrimeiro = false } = {}) => {
  await instalarPortao(portao.tabela, portao.condicao, portao.evento);
  /** @type {Array<ReturnType<typeof acompanhar>>} */
  const emVoo = [];
  try {
    await comPortaoFechado(async () => {
      for (const [i, pedido] of pedidos.entries()) {
        const a = acompanhar(pedido());
        emVoo.push(a);
        if (segundoEsperaOPrimeiro && i === 1) {
          const [primeiro] = await paradosNoPortao();
          await esperar(async () => a.feito || (await bloqueadosPor(primeiro)).length > 0, 'o 2º esperando uma trava do 1º');
          assert.equal(a.feito, false, `o 2º não pode passar pelo 1º: ${a.feito ? resumo(a.r) : ''}`);
          continue;
        }
        await esperar(async () => emVoo.some((x) => x.feito) || (await paradosNoPortao()).length === i + 1, `pedido ${i + 1} parado no portão`);
        const pronto = emVoo.find((x) => x.feito);
        assert.equal(pronto, undefined, `todo pedido tinha de parar no portão: ${pronto ? resumo(pronto.r) : ''}`);
      }
      await enquanto(await paradosNoPortao());
    });
  } finally {
    await Promise.allSettled(emVoo.map((a) => a.p));
    await removerPortao(portao.tabela);
  }
  return Promise.all(emVoo.map((a) => a.p));
};

// ─── leituras ───────────────────────────────────────────────────────────────

const fotoClientes = async () => JSON.stringify(await prisma().cliente.findMany({ orderBy: { id: 'asc' }, select: { id: true, codigo: true, nome: true } }));
/** O erro que `fn` rejeita (ou null). @param {() => Promise<unknown>} fn */
const rejeicao = (fn) => fn().then(() => null, (e) => e);
const erroDeNegocio = (code) => () => new AppError(code, `teste: ${code}`);

// ═══ Pré-condição ═══════════════════════════════════════════════════════════

describe('D-PROD-253 — pré-condição: como em produção, o P2002 não diz a unique', () => {
  test('U0: como DONO o P2002 traz o alvo; sob o papel NÃO dono (RLS + política permissiva) vem com `target` nulo e só o `modelName`; nem o SQL bruto (P2010) diz a constraint', async () => {
    const { cliente } = await criarTenant();
    const duplicar = (/** @type {any} */ tx) => tx.cliente.create({ data: { codigo: cliente.codigo, nome: 'Outro com o mesmo código' } });
    const comoDono = await rejeicao(() => prisma().$transaction(duplicar));
    assert.deepEqual([comoDono?.code, comoDono?.meta?.target, comoDono?.meta?.modelName], ['P2002', ['codigo'], 'Cliente'], String(comoDono));
    const dono = await papelDaTransacao();
    await comPapelNaoDono(async (papel) => {
      assert.equal(await papelDaTransacao(), papel, 'as transações do app rodam como o papel');
      const sob = await rejeicao(() => prisma().$transaction(duplicar));
      assert.deepEqual([sob?.code, sob?.meta?.target ?? null, sob?.meta?.modelName], ['P2002', null, 'Cliente'], String(sob));
      assert.match(String(sob.message), /Unique constraint failed on the \(not available\)/);
      const bruto = await rejeicao(() => prisma().$transaction((tx) =>
        tx.$executeRaw`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES (${randomUUID()}, ${cliente.codigo}, 'Bruto', now())`));
      assert.deepEqual([bruto?.code, bruto?.meta?.code], ['P2010', '23505'], String(bruto));
      assert.doesNotMatch(`${bruto.message} ${JSON.stringify(bruto.meta)}`, /Cliente_codigo_key|codigo/, 'nem o SQL bruto diz a constraint ou a coluna');
    }, { exigirRls: ['Cliente', 'Usuario', 'Empresa', 'AbastecimentoBem'] });
    assert.equal(await papelDaTransacao(), dono, 'fora do helper, o app volta ao dono');
  });
});

// ═══ O mapa genérico do emTransacao ═════════════════════════════════════════

describe('D-PROD-253 — o mapa genérico do emTransacao', () => {
  /**
   * Mapa com a unique `codigo` do Cliente cuja conferência conta as chamadas e
   * anota o papel e o que vê. @param {string} codigoOcupado @param {string} codigoNovo
   */
  const mapaComConferencia = (codigoOcupado, codigoNovo) => {
    const visto = { chamadas: 0, papel: null, novoVisivel: null };
    const unicos = {
      codigo: {
        erro: erroDeNegocio('ADMIN_CLIENTE_CODIGO_DUPLICADO'),
        conferir: async (/** @type {any} */ tx) => {
          visto.chamadas += 1;
          visto.papel = /** @type {any[]} */ (await tx.$queryRaw`SELECT current_user AS u`)[0].u;
          visto.novoVisivel = await tx.cliente.count({ where: { codigo: codigoNovo } });
          return tx.cliente.findUnique({ where: { codigo: codigoOcupado }, select: { id: true } });
        },
      },
    };
    return { unicos, visto };
  };
  /** Transação que grava um Cliente novo e DEPOIS viola a unique do código. */
  const gravarEDuplicar = (codigoNovo, codigoOcupado) => async (/** @type {any} */ tx) => {
    await tx.cliente.create({ data: { codigo: codigoNovo, nome: 'Escrita antes da unique' } });
    await tx.cliente.create({ data: { codigo: codigoOcupado, nome: 'Duplicado' } });
  };

  test('U1: sob o papel, o P2002 sem alvo vira o erro de negócio pela CONFERÊNCIA da chave, que roda depois do rollback (não vê a escrita desfeita) e também como o papel; nada gravado', async () => {
    const { cliente } = await criarTenant();
    const novo = `u1-${randomUUID().slice(0, 8)}`;
    const { unicos, visto } = mapaComConferencia(cliente.codigo, novo);
    await comPapelNaoDono(async (papel) => {
      const antes = await fotoClientes();
      const erro = await rejeicao(() => emTransacao(TRANSACAO_CURTA, gravarEDuplicar(novo, cliente.codigo), unicos));
      assert.ok(erro instanceof AppError, String(erro));
      assert.deepEqual([erro.code, erro.status], ['ADMIN_CLIENTE_CODIGO_DUPLICADO', 409]);
      assert.deepEqual(visto, { chamadas: 1, papel, novoVisivel: 0 }, 'uma conferência, como o papel, depois do rollback');
      assert.equal(await fotoClientes(), antes, 'nada gravado: nem a escrita de antes da unique');
    }, { exigirRls: ['Cliente'] });
  });

  test('U2: como DONO (com o alvo) o trecho do alvo decide e a conferência nem roda; trecho que não está no alvo segue o caminho de antes (P2002 cru → 409 CONCURRENCY_CONFLICT)', async () => {
    const { cliente } = await criarTenant();
    const novo = `u2-${randomUUID().slice(0, 8)}`;
    const { unicos, visto } = mapaComConferencia(cliente.codigo, novo);
    const antes = await fotoClientes();
    const erro = await rejeicao(() => emTransacao(TRANSACAO_CURTA, gravarEDuplicar(novo, cliente.codigo), unicos));
    assert.deepEqual([erro?.code, visto.chamadas], ['ADMIN_CLIENTE_CODIGO_DUPLICADO', 0], String(erro));
    const outroTrecho = mapaComConferencia(cliente.codigo, novo);
    const cru = await rejeicao(() => emTransacao(TRANSACAO_CURTA, gravarEDuplicar(novo, cliente.codigo), { login: outroTrecho.unicos.codigo }));
    assert.deepEqual([cru?.code, outroTrecho.visto.chamadas], ['P2002', 0], 'com o alvo, nada de conferência');
    assert.deepEqual([normalizarErro(cru).code, normalizarErro(cru).status], ['CONCURRENCY_CONFLICT', 409]);
    const peloAlvo = await rejeicao(() => emTransacao(TRANSACAO_CURTA, gravarEDuplicar(novo, cliente.codigo), {
      codigo: soPeloAlvo(erroDeNegocio('ADMIN_CLIENTE_CODIGO_DUPLICADO'), 'teste'),
    }));
    assert.equal(peloAlvo?.code, 'ADMIN_CLIENTE_CODIGO_DUPLICADO', '`soPeloAlvo` vale pelo alvo, como antes');
    assert.equal(await fotoClientes(), antes, 'nada gravado');
  });

  test('U3: sob o papel, chave LIVRE, conferência que FALHA, `soPeloAlvo` e mapa vazio seguem o caminho genérico de antes (P2002 cru → 409 CONCURRENCY_CONFLICT), sem mascarar o erro; nada gravado', async () => {
    const { cliente } = await criarTenant();
    const novo = `u3-${randomUUID().slice(0, 8)}`;
    await comPapelNaoDono(async () => {
      const antes = await fotoClientes();
      let falhas = 0;
      const casos = [
        ['chave livre (a P2002 é de outra unique)', { codigo: mapaComConferencia(`livre-${randomUUID().slice(0, 8)}`, novo).unicos.codigo }],
        ['conferência que falha', { codigo: { erro: erroDeNegocio('ADMIN_CLIENTE_CODIGO_DUPLICADO'), conferir: async () => { falhas += 1; throw new Error('conferência fora do ar'); } } }],
        ['soPeloAlvo (só pelo alvo, que não veio)', { codigo: soPeloAlvo(erroDeNegocio('ADMIN_CLIENTE_CODIGO_DUPLICADO'), 'teste') }],
        ['mapa vazio', {}],
      ];
      for (const [rotulo, unicos] of casos) {
        const erro = await rejeicao(() => emTransacao(TRANSACAO_CURTA, gravarEDuplicar(novo, cliente.codigo), /** @type {any} */ (unicos)));
        assert.deepEqual([erro?.code, erro?.meta?.target ?? null], ['P2002', null], `${rotulo}: o P2002 de antes, cru (${erro})`);
        assert.deepEqual([normalizarErro(erro).code, normalizarErro(erro).status], ['CONCURRENCY_CONFLICT', 409], `${rotulo}: o handler responde como antes`);
        assert.equal(await fotoClientes(), antes, `${rotulo}: nada gravado`);
      }
      assert.equal(falhas, 1, 'a conferência que falha foi tentada uma vez');
    }, { exigirRls: ['Cliente'] });
  });
});

// ═══ Abastecimento (molde do IT4g) ══════════════════════════════════════════

describe('D-PROD-253 — abastecimento: a chave sem recibo, como em produção', () => {
  const REENVIO = 'abastecimento_bem.reenvio_conflitante';
  /** Fotografia do tenant SEM a auditoria (o reenvio conflitante é auditado à parte, best-effort). @param {{ c: string }} s */
  const semAuditoria = async (s) => JSON.stringify({ ...JSON.parse(await fotoAbastecimento(s.c)), auditLog: null });
  /** @param {{ c: string }} s */
  const reenvios = (s) => prisma().auditLog.count({ where: { cliente_id: s.c, acao: REENVIO } });
  /** @param {{ c: string }} s @param {string} operationId */
  const apagarRecibo = async (s, operationId) =>
    (await prisma().operacaoIdempotente.deleteMany({ where: { cliente_id: s.c, operation_key: operationId, tipo_operacao: TIPO_CONFIRMAR } })).count;
  /** Abastecimento do gerador (sem medidor), para a chave ocupada "por fora". @param {any} s */
  const corpoDoGerador = (s) => corpoAbastecimento(s, { bem_id: s.gerador.id, tanque_id: s.gerador.tanques[0].id, medidor_leitura: null, quantidade: '10' });

  test('A1: sob o papel, o abastecimento inteiro roda (controle); a unique (cliente_id, operation_id) não diz o alvo; sem o recibo, a mesma chave dá 409 IDEMPOTENCY_CONFLICT pela pré-conferência (outro corpo, o MESMO corpo e acima do saldo), auditado e sem efeito', async () => {
    const s = await montarAbastecimento(app);
    await comPapelNaoDono(async () => {
      const corpo = corpoAbastecimento(s);
      const d = await A.confirmarOk(s.operador.token, corpo);
      assert.equal(d.replay, false);
      const outro = await A.confirmarOk(s.operador.token, corpoDoGerador(s));
      // Pré-condição (o defeito de produção): violada sob o papel, a unique (cliente_id, operation_id) não diz o alvo.
      const duplicada = await rejeicao(() => prisma().$transaction((tx) =>
        tx.abastecimentoBem.update({ where: { cliente_id_id: { cliente_id: s.c, id: outro.id } }, data: { operation_id: corpo.operation_id } })));
      assert.deepEqual([duplicada?.code, duplicada?.meta?.target ?? null, duplicada?.meta?.modelName], ['P2002', null, 'AbastecimentoBem'], String(duplicada));
      // O caso: o recibo some (apagado, expurgado ou de outro tipo) e a mesma chave volta.
      assert.equal(await apagarRecibo(s, corpo.operation_id), 1);
      for (const [i, [rotulo, reenvio]] of [
        ['outra quantidade', { ...corpo, quantidade: '1' }],
        ['o MESMO corpo: sem recibo não há replay', corpo],
        ['acima do saldo: a chave vem antes do motor', { ...corpo, quantidade: '999' }],
      ].entries()) {
        const antes = await semAuditoria(s);
        const r = await A.confirmar(s.operador.token, reenvio);
        assert.deepEqual([r.statusCode, corpoDe(r)?.code, corpoDe(r)?.details?.operation_id], [409, 'IDEMPOTENCY_CONFLICT', corpo.operation_id], `${rotulo}: ${r.body}`);
        assert.equal(await semAuditoria(s), antes, `${rotulo}: nada gravado (abastecimento, fatia, movimento, lote, estoque, recibo, sequência)`);
        assert.equal(await reenvios(s), i + 1, `${rotulo}: o reenvio é auditado`);
      }
      const det = await A.ok(A.detalhe(s.operador.token, d.id, s.e1.id));
      assert.deepEqual([det.status, det.quantidade], ['CONFIRMADO', '80.0000'], 'o abastecimento gravado não mudou');
    }, { exigirRls: ['AbastecimentoBem', 'OperacaoIdempotente', 'MovimentacaoEstoque'] });
  });

  test('A2: corrida — a chave é ocupada DEPOIS da pré-conferência (o pedido parado no movimento): sob o papel, o P2002 sem alvo vira 409 IDEMPOTENCY_CONFLICT pela conferência depois do rollback; nada gravado; auditado', async () => {
    const s = await montarAbastecimento(app);
    await comPapelNaoDono(async () => {
      const ocupante = await A.confirmarOk(s.operador.token, corpoDoGerador(s));
      const corpo = corpoAbastecimento(s);
      let antes = '';
      const [r] = await comPedidosNoPortao(
        { tabela: 'MovimentacaoEstoque', condicao: `NEW.cliente_id = '${s.c}' AND NEW.origem_sistema = 'abastecimento_patrimonio'` },
        [() => A.confirmar(s.operador.token, corpo)],
        {
          enquanto: async () => {
            // Parado no portão: a pré-conferência já passou (a chave estava livre). A chave é ocupada AGORA, por fora, e commita.
            assert.equal(await prisma().abastecimentoBem.count({ where: { cliente_id: s.c, operation_id: corpo.operation_id } }), 0);
            await aux.abastecimentoBem.update({ where: { cliente_id_id: { cliente_id: s.c, id: ocupante.id } }, data: { operation_id: corpo.operation_id } });
            antes = await semAuditoria(s);
          },
        },
      );
      assert.deepEqual([r.statusCode, corpoDe(r)?.code, corpoDe(r)?.details?.operation_id], [409, 'IDEMPOTENCY_CONFLICT', corpo.operation_id], r.body);
      assert.equal(await semAuditoria(s), antes, 'nada gravado: nem movimento, nem lote, nem estoque, nem recibo, nem abastecimento, nem sequência');
      assert.equal(await reenvios(s), 1, 'o reenvio conflitante é auditado');
    }, { exigirRls: ['AbastecimentoBem'] });
  });
});

// ═══ Empresa ════════════════════════════════════════════════════════════════

describe('D-PROD-253 — empresa: o nome em corrida, como em produção', () => {
  test('E1: duas empresas com o mesmo nome em corrida (a 2ª passa a pré-conferência antes do commit da 1ª e espera a numeração dela): sob o papel → 201 + 409 EMPRESA_NAME_CONFLICT, nunca CONCURRENCY_CONFLICT; uma empresa só, numeração sem buraco', async () => {
    const t = await criarTenant();
    const { corpo: sessao } = await autenticarNoApp(app, t.credenciais);
    const criar = () => app.inject({
      method: 'POST', url: '/empresas', headers: { authorization: `Bearer ${sessao.token}` }, payload: { apelido: 'FC', nome: 'FAZENDA CORRIDA', tipo_pessoa: 'Jurídica' },
    });
    await comPapelNaoDono(async () => {
      const [r1, r2] = await comPedidosNoPortao({ tabela: 'Empresa', condicao: `NEW.cliente_id = '${t.cliente.id}'` }, [criar, criar], { segundoEsperaOPrimeiro: true });
      assert.deepEqual([r1.statusCode, r2.statusCode], [201, 409], `${resumo(r1)} | ${resumo(r2)}`);
      assert.equal(corpoDe(r2)?.code, 'EMPRESA_NAME_CONFLICT', resumo(r2));
    }, { exigirRls: ['Empresa', 'EntidadeCodigoSequencia'] });
    const empresas = await prisma().empresa.findMany({ where: { cliente_id: t.cliente.id }, select: { nome: true, numero_empresa: true } });
    assert.deepEqual(empresas, [{ nome: 'FAZENDA CORRIDA', numero_empresa: 1 }]);
    const seq = await prisma().entidadeCodigoSequencia.findFirst({ where: { cliente_id: t.cliente.id, entidade: 'Empresa' }, select: { proximo_valor: true } });
    assert.equal(Number(seq?.proximo_valor), 2, 'a reserva do perdedor voltou com o rollback');
  });
});

// ═══ MAIKE Admin ════════════════════════════════════════════════════════════

describe('D-PROD-253 — MAIKE Admin: código e login em corrida, como em produção', () => {
  const novo = (codigo, login) => ({ nome: `Fazenda ${codigo}`, codigo, administrador: { nome: 'Gestora', login } });

  test('M1: sob o papel, a corrida pelo MESMO código (criar e editar) dá 409 ADMIN_CLIENTE_CODIGO_DUPLICADO (antes, sem o alvo, "login duplicado") e pelo MESMO login dá 409 ADMIN_LOGIN_DUPLICADO; sem órfão', async () => {
    const a = await criarTenant({ codigo: 'fazenda-um' });
    const b = await criarTenant({ codigo: 'fazenda-dois' });
    const { headers } = await criarAdminComSessao(app);
    const enviar = (method, url, payload, extra = {}) => app.inject({ method, url, headers: { ...headers, ...extra }, payload });
    const editarCodigo = async (cliente, codigo) => {
      const etag = (await enviar('GET', `/admin-maike/clientes/${cliente.id}`)).headers.etag;
      return () => enviar('PATCH', `/admin-maike/clientes/${cliente.id}`, { codigo }, { 'if-match': etag });
    };
    /** As duas respostas, ordenadas por status, com o código do erro. @param {any[]} rs */
    const desfecho = (rs) => rs.map((r) => [r.statusCode, r.statusCode >= 400 ? corpoDe(r)?.code : null]).sort((x, y) => x[0] - y[0]);
    await comPapelNaoDono(async () => {
      const criarMesmoCodigo = await comPedidosNoPortao({ tabela: 'Cliente', condicao: `NEW.codigo = 'corrida-a'` }, [
        () => enviar('POST', '/admin-maike/clientes', novo('corrida-a', 'login.a')),
        () => enviar('POST', '/admin-maike/clientes', novo('corrida-a', 'login.b')),
      ]);
      assert.deepEqual(desfecho(criarMesmoCodigo), [[201, null], [409, 'ADMIN_CLIENTE_CODIGO_DUPLICADO']], criarMesmoCodigo.map(resumo).join(' | '));

      const criarMesmoLogin = await comPedidosNoPortao({ tabela: 'Usuario', condicao: `NEW.login = 'mesmo.login'` }, [
        () => enviar('POST', '/admin-maike/clientes', novo('corrida-b', 'mesmo.login')),
        () => enviar('POST', '/admin-maike/clientes', novo('corrida-c', 'mesmo.login')),
      ]);
      assert.deepEqual(desfecho(criarMesmoLogin), [[201, null], [409, 'ADMIN_LOGIN_DUPLICADO']], criarMesmoLogin.map(resumo).join(' | '));

      const pedidos = [await editarCodigo(a.cliente, 'codigo-cobicado'), await editarCodigo(b.cliente, 'codigo-cobicado')];
      const editarMesmoCodigo = await comPedidosNoPortao({ tabela: 'Cliente', condicao: `NEW.codigo = 'codigo-cobicado'`, evento: 'UPDATE' }, pedidos);
      assert.deepEqual(desfecho(editarMesmoCodigo), [[200, null], [409, 'ADMIN_CLIENTE_CODIGO_DUPLICADO']], editarMesmoCodigo.map(resumo).join(' | '));
    }, { exigirRls: ['Cliente', 'Usuario'] });
    const contar = (codigos) => prisma().cliente.count({ where: { codigo: { in: codigos } } });
    assert.deepEqual([await contar(['corrida-a']), await contar(['corrida-b', 'corrida-c']), await contar(['codigo-cobicado'])], [1, 1, 1], 'um cliente por corrida, sem órfão do perdedor');
    assert.equal(await prisma().usuario.count({ where: { login: 'mesmo.login' } }), 1);
    assert.deepEqual(await prisma().cliente.findMany({ where: { usuarios: { none: {} } }, select: { codigo: true } }), [], 'nenhum cliente sem administrador');
  });

  test('M2: o tradutor sem o alvo usa o model que falhou: Cliente → código, Usuario → login, outro model → o erro segue (409 genérico), nunca "login" por palpite; com o alvo, nada muda', () => {
    const p2002 = (meta) => Object.assign(new Error('P2002'), { code: 'P2002', meta });
    const codigo = (e) => /** @type {any} */ (e)?.code;
    assert.equal(codigo(traduzirUnique(p2002({ modelName: 'Cliente', target: null }))), 'ADMIN_CLIENTE_CODIGO_DUPLICADO');
    assert.equal(codigo(traduzirUnique(p2002({ modelName: 'Usuario', target: null }))), 'ADMIN_LOGIN_DUPLICADO');
    const outro = p2002({ modelName: 'EventoSegurancaAdminMaike', target: null });
    assert.equal(traduzirUnique(outro), outro, 'model sem unique de negócio aqui: o próprio erro');
    assert.equal(normalizarErro(outro).code, 'CONCURRENCY_CONFLICT');
    assert.equal(codigo(traduzirUnique(p2002({ target: null }))), 'P2002', 'sem alvo e sem model: o próprio erro');
    // Com o alvo, como antes (mesmo com um model que diria outra coisa).
    assert.equal(codigo(traduzirUnique(p2002({ modelName: 'Usuario', target: ['codigo'] }))), 'ADMIN_CLIENTE_CODIGO_DUPLICADO');
    assert.equal(codigo(traduzirUnique(p2002({ modelName: 'Cliente', target: ['lower(login::text)'] }))), 'ADMIN_LOGIN_DUPLICADO');
    assert.equal(codigo(traduzirUnique({ code: 'P2034' })), 'ADMIN_CLIENTE_EDICAO_CONCORRENTE');
  });
});

// ═══ Lançamento de Atividades ═══════════════════════════════════════════════

describe('D-PROD-253 — Lançamento de Atividades: a chave sem recibo, como em produção', () => {
  /** Linhas, apontamentos e recibos do tenant (a auditoria do reenvio é contada à parte). @param {string} c */
  const fotoAtividade = async (c) => {
    const p = prisma();
    const linhas = async (/** @type {any} */ m) => m.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } });
    return JSON.stringify({
      ap: await linhas(p.atividadeApontamento),
      maquina: await linhas(p.atividadeApontamentoMaquina),
      maoObra: await linhas(p.atividadeApontamentoMaoObra),
      servico: await linhas(p.atividadeApontamentoServico),
      produto: await linhas(p.atividadeApontamentoProduto),
      recibos: await linhas(p.operacaoIdempotente),
    }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  };
  /** @param {string} c @param {string} acao */
  const reenvios = (c, acao) => prisma().auditLog.count({ where: { cliente_id: c, acao } });
  /** @param {string} c @param {string} operationId */
  const apagarRecibos = async (c, operationId) => (await prisma().operacaoIdempotente.deleteMany({ where: { cliente_id: c, operation_key: operationId } })).count;

  test('L1: sob o papel, a chave de uma linha de mão de obra, de serviço ou de máquina JÁ gravada, sem o recibo, dá 409 IDEMPOTENCY_CONFLICT ao lançar e ao editar, auditado e sem efeito', async () => {
    const s = await montarLinhasCusto(app);
    const M = s.acoesDaLinha('mao-obra');
    const S = s.acoesDaLinha('servicos');
    const versaoDe = (/** @type {string} */ apId) => s.versaoDe(apId);
    const maquina = (/** @type {any} */ ap, linhaId = null) => `/atividades/${s.atividade.id}/apontamentos/${ap.id}/maquinas${linhaId ? `/${linhaId}` : ''}`;
    await comPapelNaoDono(async () => {
      const ap = await s.apontar();
      const corpoMo = { parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' };
      const opMo = `mo-${randomUUID()}`;
      const mo = await M.lancarOk(ap, corpoMo, { operation_id: opMo });
      const corpoSv = { servico_id: s.gradagem.id, quantidade: '2', valor_unitario: '150' };
      const opSv = `sv-${randomUUID()}`;
      const sv = await S.lancarOk(ap, corpoSv, { operation_id: opSv });
      const opMq = `mq-${randomUUID()}`;
      const rMq = await s.H.req('POST', maquina(ap), s.token, { empresa_id: s.e1.id, versao: await versaoDe(ap.id), operation_id: opMq, bem_id: s.gerador.id, quantidade_uso: '2' });
      assert.equal(rMq.statusCode, 201, rMq.body);
      const mq = rMq.json();
      // O caso: o recibo some (apagado, expurgado ou de outro tipo) e a mesma chave volta.
      for (const op of [opMo, opSv, opMq]) assert.ok((await apagarRecibos(s.c, op)) >= 1);
      const casos = [
        ['mão de obra: lançar de novo', () => M.lancar(ap, corpoMo, { operation_id: opMo }), 'atividade_mao_obra.reenvio_conflitante'],
        ['mão de obra: editar com a chave da linha', () => M.editar(ap, mo.mao_obra.id, { quantidade: '7' }, { operation_id: opMo }), 'atividade_mao_obra.reenvio_conflitante'],
        ['serviço: lançar de novo', () => S.lancar(ap, corpoSv, { operation_id: opSv }), 'atividade_servico.reenvio_conflitante'],
        ['serviço: editar com a chave da linha', () => S.editar(ap, sv.servico.id, { quantidade: '3' }, { operation_id: opSv }), 'atividade_servico.reenvio_conflitante'],
        ['máquina: lançar de novo', async () => s.H.req('POST', maquina(ap), s.token, { empresa_id: s.e1.id, versao: await versaoDe(ap.id), operation_id: opMq, bem_id: s.gerador.id, quantidade_uso: '2' }), 'atividade_maquina.reenvio_conflitante'],
        ['máquina: editar com a chave da linha', async () => s.H.req('PATCH', maquina(ap, mq.maquina.id), s.token, { empresa_id: s.e1.id, versao: await versaoDe(ap.id), operation_id: opMq, quantidade_uso: '3' }), 'atividade_maquina.reenvio_conflitante'],
      ];
      for (const [rotulo, pedir, acao] of casos) {
        const antes = await fotoAtividade(s.c);
        const auditados = await reenvios(s.c, acao);
        const r = await pedir();
        assert.deepEqual([r.statusCode, corpoDe(r)?.code], [409, 'IDEMPOTENCY_CONFLICT'], `${rotulo}: ${r.body}`);
        assert.equal(await fotoAtividade(s.c), antes, `${rotulo}: nada gravado (linhas, apontamento, versão, recibos)`);
        assert.equal(await reenvios(s.c, acao), auditados + 1, `${rotulo}: o reenvio é auditado`);
      }
    }, { exigirRls: ['AtividadeApontamentoMaoObra', 'AtividadeApontamentoServico', 'AtividadeApontamentoMaquina'] });
  });

  test('L2: sob o papel, o lançamento do dia com chave e linhas de mão de obra: sem o recibo, a mesma chave dá 409 IDEMPOTENCY_CONFLICT (a chave derivada `:o` da linha gravada é conferida antes de tudo), sem efeito', async () => {
    const s = await montarLinhasCusto(app);
    await comPapelNaoDono(async () => {
      const op = `lanc-${randomUUID()}`;
      const linha = { parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' };
      const primeiro = await s.lancarAp({ operation_id: op, mao_obra: [linha] });
      assert.equal(primeiro.statusCode, 201, primeiro.body);
      assert.deepEqual((await prisma().atividadeApontamentoMaoObra.findMany({ where: { cliente_id: s.c } })).map((l) => l.operation_id), [`${op}:o1`]);
      assert.ok((await apagarRecibos(s.c, op)) >= 1);
      for (const [rotulo, corpo] of [
        ['outro corpo', { operation_id: op, mao_obra: [{ ...linha, quantidade: '9' }] }],
        ['o MESMO corpo: sem recibo não há replay', { operation_id: op, mao_obra: [linha] }],
      ]) {
        const antes = await fotoAtividade(s.c);
        const r = await s.lancarAp(corpo);
        assert.deepEqual([r.statusCode, corpoDe(r)?.code], [409, 'IDEMPOTENCY_CONFLICT'], `${rotulo}: ${r.body}`);
        assert.equal(await fotoAtividade(s.c), antes, `${rotulo}: nada gravado (nem o apontamento)`);
      }
    }, { exigirRls: ['AtividadeApontamento', 'AtividadeApontamentoMaoObra'] });
  });

  test('L3: sob o papel, a chave de uma linha de PRODUTO já gravada, sem o recibo, dá 409 IDEMPOTENCY_CONFLICT e a MESMA área de novo na atividade dá 422 `ja_na_atividade`; nada gravado', async () => {
    const s = await montarLinhasCusto(app);
    const pasto = await prisma().areaPastagem.create({
      data: {
        cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome,
        numero_area: `AR-${randomUUID().slice(0, 6)}`, nome: 'PASTO P2002', tamanho_hectares: '12',
      },
    });
    await comPapelNaoDono(async () => {
      const ap = await s.apontar();
      const produtos = `${s.baseAp(s.atividade)}/${ap.id}/produtos`;
      const op = `pr-${randomUUID()}`;
      const corpoPr = async () => ({ empresa_id: s.e1.id, versao: await s.versaoDe(ap.id), operation_id: op, produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '3' });
      const primeiro = await s.H.req('POST', produtos, s.token, await corpoPr());
      assert.equal(primeiro.statusCode, 201, primeiro.body);
      assert.ok((await apagarRecibos(s.c, op)) >= 1);
      let antes = await fotoAtividade(s.c);
      const r = await s.H.req('POST', produtos, s.token, await corpoPr());
      assert.deepEqual([r.statusCode, corpoDe(r)?.code, corpoDe(r)?.details?.operation_id], [409, 'IDEMPOTENCY_CONFLICT', op], `produto: ${r.body}`);
      assert.equal(await fotoAtividade(s.c), antes, 'produto: nada gravado');

      const areas = `/atividades/${s.atividade.id}/areas`;
      const ok = await s.H.req('POST', areas, s.token, { empresa_id: s.e1.id, area_id: pasto.id });
      assert.equal(ok.statusCode, 201, ok.body);
      antes = JSON.stringify(await prisma().atividadeArea.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      const repetida = await s.H.req('POST', areas, s.token, { empresa_id: s.e1.id, area_id: pasto.id });
      const e = corpoDe(repetida);
      assert.deepEqual([repetida.statusCode, e?.code, e?.field, e?.reason], [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'ja_na_atividade'], `área: ${repetida.body}`);
      assert.equal(JSON.stringify(await prisma().atividadeArea.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), antes, 'área: nada gravado');
    }, { exigirRls: ['AtividadeApontamentoProduto', 'AtividadeArea'] });
  });

  test('L4: corrida no registro de VÁRIAS áreas (D-PROD-263) — a chave derivada da 2ª área (`<chave>:a2:o1`) é ocupada DEPOIS da pré-conferência: sob o papel, o P2002 sem alvo vira 409 IDEMPOTENCY_CONFLICT pela conferência de TODAS as bases depois do rollback; nada gravado; auditado', async () => {
    const s = await montarLinhasCusto(app);
    const p = prisma();
    /** @param {string} nome */
    const pasto = (nome) => p.areaPastagem.create({
      data: {
        cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome,
        numero_area: `AR-${randomUUID().slice(0, 6)}`, nome, tamanho_hectares: '10',
      },
    });
    const aroeira = await pasto('PASTO DA AROEIRA');
    const acude = await pasto('PASTO DO AÇUDE');
    const linha = { parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '6' };
    /** Tudo o que o registro grava: as linhas e os recibos, as atividades e as áreas delas. @param {string} c */
    const fotoRegistro = async (c) => JSON.stringify({
      linhas: JSON.parse(await fotoAtividade(c)),
      atividades: await p.atividade.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
      areas: await p.atividadeArea.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    await comPapelNaoDono(async () => {
      // A linha que vai ocupar a chave "por fora": de outro lançamento, já gravado.
      const ocupante = await s.lancarAp({ operation_id: `oc-${randomUUID()}`, mao_obra: [linha] });
      assert.equal(ocupante.statusCode, 201, ocupante.body);
      const [{ id: linhaOcupante }] = await p.atividadeApontamentoMaoObra.findMany({ where: { cliente_id: s.c }, select: { id: true } });
      const op = `reg-${randomUUID()}`;
      let antes = '';
      const [r] = await comPedidosNoPortao(
        { tabela: 'AtividadeApontamentoMaoObra', condicao: `NEW.cliente_id = '${s.c}' AND NEW.operation_id = '${op}:o1'` },
        [() => s.H.req('POST', '/atividades/registrar', s.token, {
          empresa_id: s.e1.id, tipo_atividade_id: s.tipo.id, data_operacional: '2027-06-10', operation_id: op,
          areas: [{ area_id: aroeira.id, hectares: '2' }, { area_id: acude.id, hectares: '1' }], mao_obra: [linha],
        })],
        {
          enquanto: async () => {
            // Parado no portão da 1ª área: a pré-conferência (as chaves de TODAS as áreas) já passou. A chave da 2ª área
            // é ocupada AGORA, por fora, e commita; a conferência só com a chave do corpo não a veria.
            assert.equal(await p.atividadeApontamentoMaoObra.count({ where: { cliente_id: s.c, operation_id: { startsWith: op } } }), 0);
            assert.equal((await aux.atividadeApontamentoMaoObra.updateMany({ where: { cliente_id: s.c, id: linhaOcupante }, data: { operation_id: `${op}:a2:o1` } })).count, 1);
            antes = await fotoRegistro(s.c);
          },
        },
      );
      assert.deepEqual([r.statusCode, corpoDe(r)?.code, corpoDe(r)?.details?.operation_id], [409, 'IDEMPOTENCY_CONFLICT', op], r.body);
      assert.equal(await fotoRegistro(s.c), antes, 'nada gravado: nem atividade, nem área, nem apontamento, nem linha, nem recibo');
      assert.equal(await reenvios(s.c, 'atividade.reenvio_conflitante'), 1, 'o reenvio conflitante é auditado');
    }, { exigirRls: ['AtividadeApontamento', 'AtividadeApontamentoMaoObra'] });
  });
});

// ═══ Culturas ═══════════════════════════════════════════════════════════════

describe('D-PROD-253 — culturas: o código em corrida, como em produção', () => {
  /** Tenant administrador com uma fazenda e uma cultura já gravada (a que ocupa o código "por fora"). */
  const cenarioCulturas = async () => {
    const adm = await criarTenant({ papelTenant: 'administrador' });
    const c = adm.cliente.id;
    const e1 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}` } });
    const { corpo } = await autenticarNoApp(app, adm.credenciais);
    assert.ok(corpo.token, 'login');
    const criar = (/** @type {Record<string, unknown>} */ payload) =>
      app.inject({ method: 'POST', url: '/culturas', headers: { authorization: `Bearer ${corpo.token}` }, payload: { empresa_id: e1.id, tipo: 'PASTAGEM', ...payload } });
    const r = await criar({ codigo: '100', nome: 'OCUPANTE' });
    assert.equal(r.statusCode, 201, r.body);
    return { c, criar, ocupante: r.json() };
  };
  /** @param {string} c */
  const fotoCulturas = async (c) =>
    JSON.stringify(await prisma().cultura.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  /**
   * O pedido para no portão do INSERT (a pré-conferência, sob a trava da fazenda, já passou: o código estava livre);
   * o código é ocupado por fora (UPDATE da outra cultura, fora da trava) e commita; o portão abre.
   * @param {Awaited<ReturnType<typeof cenarioCulturas>>} s @param {string} codigo @param {string} nome
   */
  const corridaPeloCodigo = async (s, codigo, nome) => {
    let antes = '';
    const [r] = await comPedidosNoPortao(
      { tabela: 'CADCULTURAS', condicao: `NEW.cliente_id = '${s.c}' AND NEW.nome = '${nome}'` },
      [() => s.criar({ codigo, nome })],
      {
        enquanto: async () => {
          await aux.cultura.update({ where: { id: s.ocupante.id }, data: { codigo } });
          antes = await fotoCulturas(s.c);
        },
      },
    );
    return { r, antes };
  };

  test('C1: corrida pelo mesmo código: como DONO (com o alvo) → 409 CULTURA_CODIGO_CONFLICT, como antes; sob o papel (sem o alvo) → o 409 genérico, nunca "nome" por palpite, e o reenvio → CULTURA_CODIGO_CONFLICT pela pré-conferência; nada gravado', async () => {
    const s = await cenarioCulturas();
    const dono = await corridaPeloCodigo(s, '200', 'CORRIDA DO DONO');
    assert.deepEqual([dono.r.statusCode, corpoDe(dono.r)?.code], [409, 'CULTURA_CODIGO_CONFLICT'], dono.r.body);
    assert.equal(await fotoCulturas(s.c), dono.antes, 'como dono: nada gravado');
    await comPapelNaoDono(async () => {
      const papel = await corridaPeloCodigo(s, '300', 'CORRIDA DO PAPEL');
      // Antes: `CULTURA_NAME_CONFLICT` (o tradutor procurava "codigo" no `meta` e, sem o alvo, caía no nome).
      assert.deepEqual([papel.r.statusCode, corpoDe(papel.r)?.code], [409, 'CONCURRENCY_CONFLICT'], papel.r.body);
      assert.equal(await fotoCulturas(s.c), papel.antes, 'sob o papel: nada gravado');
      const reenvio = await s.criar({ codigo: '300', nome: 'CORRIDA DO PAPEL' });
      assert.deepEqual([reenvio.statusCode, corpoDe(reenvio)?.code], [409, 'CULTURA_CODIGO_CONFLICT'], reenvio.body);
      assert.equal(await fotoCulturas(s.c), papel.antes, 'o reenvio: nada gravado');
    }, { exigirRls: ['CADCULTURAS'] });
  });
});

// ═══ Inventário fechado ═════════════════════════════════════════════════════

describe('D-PROD-253 — inventário fechado dos tradutores de P2002', () => {
  const RAIZ = new URL('../src/', import.meta.url).pathname;
  /** @param {string} d @returns {string[]} */
  const arquivos = (d) => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? arquivos(p) : (/\.m?js$/.test(n) ? [p] : []);
  });
  const fontes = arquivos(RAIZ).map((p) => ({ arquivo: p.slice(RAIZ.length), texto: readFileSync(p, 'utf8') }));
  const DEFINICAO = 'shared/prisma/transacaoConcorrente.js';
  /** @param {RegExp} re @returns {Record<string, number>} arquivo → ocorrências (fora da definição) */
  const ocorrencias = (re) => Object.fromEntries(fontes
    .filter((f) => f.arquivo !== DEFINICAO)
    .map((f) => [f.arquivo, (f.texto.match(re) ?? []).length])
    .filter(([, n]) => n > 0)
    .sort(([x], [y]) => String(x).localeCompare(String(y))));

  test('S1: o alvo do P2002 só é lido em `alvoDaUnique` (nem o `meta` inteiro do erro é lido fora dele); os tradutores que o usam são os inventariados (cada um com o caminho sem alvo provado acima); `soPeloAlvo` só nas entradas conferidas sob trava', () => {
    assert.deepEqual(ocorrencias(/\.target\b|\[['"`]target['"`]\]|\btarget\s*[,}]/g), {}, 'ninguém lê `meta.target` fora de `alvoDaUnique` (nem por desestruturação)');
    // O `meta` do erro do Prisma só se lê POR CAMPO e fora do alvo: `constraint`/`field_name` (P2003: a FK, que o RLS
    // não esconde), `modelName`, `code`/`message` (P2010). O `meta` inteiro (`JSON.stringify(e.meta)`, `{ meta } = e`)
    // leva o alvo junto e escapa de `alvoDaUnique`: foi assim que o tradutor das culturas chutava "nome" sem o alvo.
    assert.deepEqual(ocorrencias(/\.meta\b(?!\??\.(?:constraint|field_name|modelName|code|message)\b)|\[['"`]meta['"`]\]|\{[^{}]*\bmeta\b[^{}]*\}\s*=(?![=>])/g), {}, 'ninguém lê o `meta` inteiro do erro');
    assert.equal((fontes.find((f) => f.arquivo === DEFINICAO)?.texto.match(/\.target\b/g) ?? []).length, 1, 'um único leitor: alvoDaUnique');
    assert.deepEqual(ocorrencias(/\balvoDaUnique\(/g), {
      'modules/adminMaike/adminClientesGestaoService.js': 1, // sem alvo: o model (M1, M2)
      'modules/culturas/culturaService.js': 1, // sem alvo: o caminho genérico; a pré-conferência sob travarFazenda (C1)
      'modules/empresas/empresaUniqueViolation.js': 1, // sem alvo: a conferência (E1 e empresaUniqueViolation.test.mjs)
      'modules/patrimonio/patrimonioComum.js': 1, // sem alvo: a pré-conferência sob travarEscopo/travarCatalogo
    });
    assert.deepEqual(ocorrencias(/\bsoPeloAlvo\(/g), {
      // ordem das linhas e sequência do apontamento: nascem sob o FOR UPDATE da atividade, erro transitório
      'modules/atividades/atividadeApontamentoMaquinaService.js': 1,
      'modules/atividades/atividadeApontamentoProdutoService.js': 1,
      'modules/atividades/atividadeApontamentoService.js': 1,
      'modules/atividades/atividadeLinhaCustoComum.js': 1,
      'modules/financeiro/operacaoFinanceiraService.js': 1, // documento: sob a trava chaveDocumento (confirmar e retificar)
    });
  });
});
