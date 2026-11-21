/**
 * PR145-G4-R2 (D-PROD-74) — scripts do SQL Editor (01 precheck, 02 reset +
 * bootstrap, 03 postcheck) executados de verdade com `psql` contra PostgreSQL.
 *
 * `psql -c` envia o arquivo inteiro numa só consulta (uma transação implícita),
 * como o SQL Editor do Supabase; `psql -f` executa instrução por instrução,
 * para provar a falha fechada nesse modo. O teste troca SÓ os valores dos
 * parâmetros (identificador e nome do banco local, nº de clientes, impressão);
 * o resto é o arquivo versionado, byte a byte.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarTenant, criarApp, autenticarNoApp, limparBanco, encerrar } from './helpers.mjs';

const DIR = fileURLToPath(new URL('../../scripts/ops/sql-editor/', import.meta.url));
const ler = (f) => readFileSync(join(DIR, f), 'utf8');
const PRE = ler('01-precheck-somente-leitura.sql');
const RESET = ler('02-reset-e-bootstrap-maike-POS-25-MIGRATIONS.sql');
const POS = ler('03-postcheck-somente-leitura.sql');
const URL_PSQL = (() => {
  const u = new URL(process.env.DATABASE_URL);
  u.search = '';
  return u.toString();
})();
const prisma = () => getPrismaClient();
let SID;
let BANCO;
let TMP;

const psql = (sql, modo = 'c') => {
  const args = [URL_PSQL, '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1'];
  if (modo === 'c') return spawnSync('psql', [...args, '-c', sql], { encoding: 'utf8' });
  const f = join(TMP, `s-${Date.now()}.sql`);
  writeFileSync(f, sql);
  return spawnSync('psql', [...args, '-f', f], { encoding: 'utf8' });
};
/** Troca só os valores esperados do alvo (o banco local não é o de produção). */
const precheck = () =>
  PRE.replace("'7692130048193495360'::text AS sid", `'${SID}'::text AS sid`).replace("'postgres'::text AS banco", `'${BANCO}'::text AS banco`);
const linhasDe = (r) =>
  Object.fromEntries(
    r.stdout.trim().split('\n').filter(Boolean).map((l) => {
      const [item, valor, esperado, status] = l.split('|');
      return [item.trim(), { valor, esperado, status }];
    })
  );
const impressaoAtual = () => {
  const r = psql(precheck());
  assert.equal(r.status, 0, r.stderr);
  return linhasDe(r)['impressao_inventario (copie para o 02 depois das migrations)'].valor;
};
const reset = ({ impressao, clientes = 1, sid = SID, banco = BANCO } = {}) =>
  RESET.replace("SET LOCAL maike_op.sid = '7692130048193495360';", `SET LOCAL maike_op.sid = '${sid}';`)
    .replace("SET LOCAL maike_op.banco = 'postgres';", `SET LOCAL maike_op.banco = '${banco}';`)
    .replace("SET LOCAL maike_op.clientes = '1';", `SET LOCAL maike_op.clientes = '${clientes}';`)
    .replace("SET LOCAL maike_op.impressao = 'COLE_AQUI_A_IMPRESSAO';", `SET LOCAL maike_op.impressao = '${impressao ?? 'COLE_AQUI_A_IMPRESSAO'}';`);
/** O resultado da ÚLTIMA instrução (é o que o SQL Editor mostra). */
const resultado = (r) => {
  const ultima = r.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
  const [status, login, senha, apagadas, obs] = ultima.split('|');
  return { status, login, senha: senha || null, apagadas: Number(apagadas), obs };
};
const contar = async () => {
  const p = prisma();
  const tab = await p.$queryRawUnsafe(
    `SELECT (SELECT count(*) FROM "Cliente")::int c, (SELECT count(*) FROM "Usuario")::int u, (SELECT count(*) FROM "Lote")::int l,
            (SELECT count(*) FROM "AuditLog")::int a, (SELECT count(*) FROM "Categoria")::int cat, (SELECT count(*) FROM "MovimentacaoMapa")::int mm,
            (SELECT count(*) FROM "CatalogoTipoEntidade")::int glob, (SELECT count(*) FROM "_prisma_migrations")::int mig`
  );
  return tab[0];
};

/** Dados de teste no formato de produção (FK composta de AuditLog, auto-referência, cascata). */
const semear = async ({ clientes = 1 } = {}) => {
  const p = prisma();
  const criados = [];
  for (let i = 0; i < clientes; i += 1) {
    const t = await criarTenant({ semPermissao: true, login: i === 0 ? 'legado.admin' : undefined });
    const c = t.cliente.id;
    await p.permissao.create({ data: { cliente_id: c, user_email: t.usuario.login, is_admin: true } });
    const emp = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'E', nome: 'EMPRESA' } });
    const setor = await p.setor.create({ data: { cliente_id: c, empresa_id: emp.id, numero_setor: '1', nome: 'S' } });
    // D-PROD-216: a área ligada a uma cultura (FK RESTRICT) prova a ordem AreaPastagem → CADCULTURAS → Empresa.
    const culturaDaArea = await p.cultura.create({ data: { cliente_id: c, empresa_id: emp.id, codigo: '001', tipo: 'PASTAGEM', nome: 'MARANDU' } });
    const area = await p.areaPastagem.create({ data: { cliente_id: c, empresa_id: emp.id, setor_id: setor.id, setor_nome: 'S', numero_area: '1', nome: 'A', tamanho_hectares: 1, cultura_id: culturaDaArea.id } });
    const lote = await p.lote.create({ data: { cliente_id: c, empresa_id: emp.id, numero_lote: '1', nome: 'L', quantidade_cabecas: 5, quantidade_entrada: 5, motivo_entrada: 'Compra' } });
    const pai = await p.categoria.create({ data: { cliente_id: c, numero_categoria: '1', nome: 'PAI' } });
    await p.categoria.create({ data: { cliente_id: c, numero_categoria: '2', nome: 'FILHA', categoria_pai_id: pai.id } });
    const g = await p.grupoAtividade.create({ data: { cliente_id: c, nome_grupo: 'G' } });
    const tt = await p.tipoTarefa.create({ data: { cliente_id: c, nome_tipo: 'T', grupo_atividade_id: g.id, grupo_atividade_nome: 'G' } });
    const tarefa = await p.lancamentoTarefa.create({ data: { cliente_id: c, empresa_id: emp.id, titulo: 'X', tipo: 'Tarefa', tipo_tarefa_id: tt.id, tipo_tarefa_nome: 'T', lote_id: lote.id } });
    await p.historicoLancamentoTarefa.create({ data: { cliente_id: c, empresa_id: emp.id, tarefa_id: tarefa.id, evento: 'criada', data_evento: new Date() } });
    // D-PROD-200: uma atividade (cabeçalho) com um apontamento do dia (FKs RESTRICT do apontamento para a atividade, o
    // usuário e a empresa; da atividade para tarefa, tipo, grupo, área, setor, centros, unidade, usuário, empresa e
    // cliente): o 02 só os apaga se o apontamento vier antes da atividade e a atividade ANTES de todas as mães.
    // D-PROD-197: o tipo de atividade aponta para um centro de custo, um centro de resultado e uma unidade como padrões
    // (FKs RESTRICT): o 02 só o apaga se ele vier DEPOIS da atividade e ANTES dessas três mães.
    const centroCusto = await p.centroCusto.create({ data: { cliente_id: c, empresa_id: emp.id, numero: '1', nome: 'CUSTEIO' } });
    const centroResultado = await p.centroResultado.create({ data: { cliente_id: c, empresa_id: emp.id, numero: '1', nome: 'PECUÁRIA' } });
    const unidade = await p.unidadeMedida.create({ data: { cliente_id: c, numero_unidade: '1', sigla: 'HA', descricao: 'Hectare' } });
    const ta = await p.tipoAtividade.create({ data: {
      cliente_id: c, nome_tipo: 'TA', grupo_atividade_id: g.id, grupo_atividade_nome: 'G',
      centro_custo_padrao_id: centroCusto.id, centro_resultado_padrao_id: centroResultado.id, unidade_producao_id: unidade.id, exige_area: true,
    } });
    const atividade = await p.atividade.create({ data: {
      cliente_id: c, empresa_id: emp.id, numero: '1', nome: 'CIGARRINHA PASTO 01', tipo_atividade_id: ta.id, tipo_atividade_nome: 'TA',
      grupo_atividade_id: g.id, grupo_atividade_nome: 'G', area_id: area.id, setor_id: setor.id, setor_nome: 'S',
      centro_custo_id: centroCusto.id, centro_resultado_id: centroResultado.id, unidade_producao_id: unidade.id, unidade_producao_sigla: 'HA',
      data_inicio: new Date('2026-11-01T00:00:00Z'), lancamento_tarefa_id: tarefa.id, criado_por_usuario_id: t.usuario.id,
    } });
    const apontamento = await p.atividadeApontamento.create({ data: {
      cliente_id: c, empresa_id: emp.id, atividade_id: atividade.id, data_operacional: new Date('2026-11-01T00:00:00Z'), sequencia: 1,
      operador_usuario_id: t.usuario.id, criado_por_usuario_id: t.usuario.id,
    } });
    // Estoque (produto, local, lote e uma saída) entra direto aqui, só como semente: o 02 só apaga tudo se o lote e o
    // movimento vierem antes do produto e do local na ordem de exclusão.
    const produto = await p.produto.create({ data: { cliente_id: c, empresa_id: emp.id, numero_produto: '1', nome_produto: 'HERBICIDA', unidade_principal_estoque: 'L', estoque_atual: '8' } });
    const local = await p.localEstoque.create({ data: { cliente_id: c, numero_local: '1', nome: 'GALPÃO' } });
    const loteEstoque = await p.estoqueLoteNota.create({ data: {
      cliente_id: c, empresa_id: emp.id, produto_id: produto.id, local_estoque_id: local.id, custo_unitario: '5', quantidade_entrada: '10', quantidade_disponivel: '8',
    } });
    const saida = await p.movimentacaoEstoque.create({ data: {
      cliente_id: c, empresa_id: emp.id, numero_movimentacao: '1', tipo_movimentacao: 'Saída', data_movimentacao: new Date('2026-11-01T12:00:00Z'),
      produto_id: produto.id, quantidade: '2', unidade_medida: 'L', valor_unitario: '5', valor_total: '10',
    } });
    // D-PROD-202 (Fatia 3): uma linha de produto com a sua fatia FIFO (FK RESTRICT da linha para o apontamento, o
    // produto, o local, o movimento e o usuário; da fatia para a linha e o lote) e uma linha de máquina (FK RESTRICT para
    // o apontamento, o bem e o usuário), com o custo de uso no bem e o teto do salto no tipo: o 02 só apaga tudo se a
    // fatia, a linha de produto e a de máquina vierem ANTES do apontamento e de todas essas mães na ordem de exclusão.
    const familia = await p.familiaPatrimonial.create({ data: { cliente_id: c, codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA' } });
    const tipoBem = await p.tipoPatrimonial.create({ data: { cliente_id: c, familia_id: familia.id, codigo: 'TRATOR', nome: 'Trator', salto_maximo_medidor: '24' } });
    const bem = await p.bemPatrimonial.create({ data: {
      cliente_id: c, empresa_id: emp.id, numero: '1', nome: 'TRATOR 01', natureza: 'MAQUINA', familia_id: familia.id, tipo_id: tipoBem.id,
      medidor_tipo: 'SEM_MEDIDOR', custo_uso_unitario: '150',
    } });
    const linhaProduto = await p.atividadeApontamentoProduto.create({ data: {
      cliente_id: c, empresa_id: emp.id, apontamento_id: apontamento.id, ordem: 1, status: 'CONFIRMADO', produto_id: produto.id,
      local_estoque_id: local.id, quantidade: '2', unidade: 'L', custo_unitario: '5', custo_total: '10', operation_id: `sqled-produto-${i}`,
      movimentacao_estoque_id: saida.id, criado_por_usuario_id: t.usuario.id,
    } });
    await p.atividadeApontamentoProdutoConsumoLote.create({ data: {
      cliente_id: c, empresa_id: emp.id, linha_id: linhaProduto.id, estoque_lote_nota_id: loteEstoque.id, ordem: 1, quantidade: '2', custo_unitario: '5',
    } });
    await p.atividadeApontamentoMaquina.create({ data: {
      cliente_id: c, empresa_id: emp.id, apontamento_id: apontamento.id, ordem: 1, status: 'CONFIRMADO', bem_id: bem.id,
      medidor_tipo: 'SEM_MEDIDOR', sem_medidor: true, quantidade_uso: '3', custo_unitario_uso: '150', custo_total: '450',
      operation_id: `sqled-maquina-${i}`, criado_por_usuario_id: t.usuario.id,
    } });
    // D-PROD-207 (Fatia 4): um serviço (com a unidade e o centro de custo como padrão), um parceiro prestador e as duas
    // linhas novas (FK RESTRICT da mão de obra para o apontamento, o parceiro e o usuário; do serviço para o apontamento,
    // o serviço, o parceiro e o usuário): o 02 só apaga tudo se as duas linhas vierem ANTES do apontamento, do serviço e
    // do parceiro, e o serviço ANTES da empresa, da unidade e do centro de custo, na ordem de exclusão. D-PROD-208: o
    // funcionário é PAPEL do parceiro (a tabela Funcionario saiu): a mão de obra aponta para um parceiro com o papel.
    const funcionario = await p.fornecedor.create({ data: {
      cliente_id: c, empresa_id: emp.id, numero_cadastro: '2', tipo_pessoa: 'Física', nome: 'JOÃO', tipos: ['funcionario'],
      funcionario_tipo: 'DIARISTA', funcionario_custo_diaria: '120',
    } });
    const servico = await p.servico.create({ data: {
      cliente_id: c, empresa_id: emp.id, numero: '1', nome: 'PULVERIZAÇÃO AÉREA', unidade_medida_id: unidade.id,
      centro_custo_padrao_id: centroCusto.id, valor_referencia: '80',
    } });
    const prestador = await p.fornecedor.create({ data: {
      cliente_id: c, empresa_id: emp.id, numero_cadastro: '1', tipo_pessoa: 'Jurídica', nome: 'AVIAÇÃO AGRÍCOLA', tipos: ['prestador_servico'],
    } });
    await p.atividadeApontamentoMaoObra.create({ data: {
      cliente_id: c, empresa_id: emp.id, apontamento_id: apontamento.id, ordem: 1, status: 'CONFIRMADO', parceiro_id: funcionario.id, origem: 'FUNCIONARIO',
      tipo_medida: 'DIARIA', quantidade: '1', custo_unitario: '120', custo_total: '120', operation_id: `sqled-mao-obra-${i}`,
      criado_por_usuario_id: t.usuario.id,
    } });
    await p.atividadeApontamentoServico.create({ data: {
      cliente_id: c, empresa_id: emp.id, apontamento_id: apontamento.id, ordem: 1, status: 'CONFIRMADO', servico_id: servico.id,
      fornecedor_parceiro_id: prestador.id, quantidade: '10', unidade: 'HA', valor_unitario: '80', valor_total: '800',
      operation_id: `sqled-servico-${i}`, criado_por_usuario_id: t.usuario.id,
    } });
    for (let k = 0; k < 3; k += 1) await p.movimentacaoMapa.create({ data: { cliente_id: c, empresa_id: emp.id } });
    for (let k = 0; k < 5; k += 1) await p.auditLog.create({ data: { cliente_id: c, usuario_id: t.usuario.id, acao: 'criar', entidade: 'Lote', entidade_id: lote.id, request_id: 'req-teste' } });
    criados.push(t);
  }
  return criados;
};

before(async () => {
  TMP = mkdtempSync(join(tmpdir(), 'maike-sqled-'));
  const p = prisma();
  // Como no Supabase: pgcrypto no schema "extensions".
  await p.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS extensions');
  await p.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions');
  const [r] = await p.$queryRawUnsafe(`SELECT system_identifier::text AS sid, current_database() AS banco FROM pg_control_system()`);
  SID = r.sid;
  BANCO = r.banco;
});
after(async () => {
  rmSync(TMP, { recursive: true, force: true });
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
  await prisma().catalogoTipoEntidade.deleteMany({ where: { codigo: 'lote-teste-sqled' } });
});

describe('SQL Editor — 01 precheck', () => {
  test('SE-01 só leitura, veredito e impressão estável; mudança de distribuição muda a impressão', async () => {
    const [t] = await semear();
    const antes = await contar();
    const r = psql(precheck());
    assert.equal(r.status, 0, r.stderr);
    const l = linhasDe(r);
    assert.equal(l['alvo: system_identifier'].status, 'OK');
    // Todas as do repositório (25 até a PR #145; a D-PROD-79 acrescentou mais).
    assert.ok(Number(l['migrations concluídas'].valor) >= 25);
    assert.equal(l['migrations concluídas'].status, 'OK');
    assert.equal(l['tabelas em public'].valor, '108', '53 + 5 do ledger R2E-P1/R1 (D-PROD-107) + 3 de Gestão P1 (D-PROD-146) + 1 de Gestão P2 (D-PROD-153) + 8 de Gestão P3-01 (D-PROD-155) + 1 de Gestão P3-02 (D-PROD-156) + 1 de Gestão P3-03 (D-PROD-158) + 10 de Patrimônio P1-01 (D-PROD-157) + 3 de Patrimônio P1-02 (D-PROD-159) − 13 + 7 do Patrimônio simplificado (D-PROD-162) + 1 TipoAtividade (D-PROD-182) + 1 CADESTACOES (D-PROD-188) + 1 CADCURVAGANHO (D-PROD-189) + 1 ApontamentoAtividade (D-PROD-190) + 2 de itens do apontamento (D-PROD-193) − 3 do apontamento antigo + 2 da atividade em dois níveis (D-PROD-200) + 3 das linhas de produto e de máquina (D-PROD-202) + 3 das Formulações (D-PROD-203) + 1 LEITURACOCHO (D-PROD-205) + 4 da mão de obra e do serviço (D-PROD-207) − Funcionario (D-PROD-208) + CADCULTURAS (D-PROD-215) + MEDICAOFORRAGEM (D-PROD-219) + AtividadeArea (D-PROD-249) + 3 das Entradas do Estoque (D-PROD-257) + MotivoEntradaEstoque (D-PROD-259) + 4 da saída manual do Estoque (D-PROD-264) + 3 do ajuste de inventário (D-PROD-268)');
    assert.match(l.VEREDITO.valor, /PRONTO PARA O 02/);
    assert.deepEqual(await contar(), antes, 'precheck não altera nada');
    const i1 = impressaoAtual();
    assert.equal(impressaoAtual(), i1, 'estável');
    // mesmo total, outra distribuição → outra impressão
    const p = prisma();
    await p.movimentacaoMapa.deleteMany({ where: { id: (await p.movimentacaoMapa.findFirst()).id } });
    await p.permissao.create({ data: { cliente_id: t.cliente.id, user_email: 'troca@x', is_admin: false } });
    assert.notEqual(impressaoAtual(), i1);
    // produção (valores reais) num banco que não é ela → PARAR
    assert.match(linhasDe(psql(PRE)).VEREDITO.valor, /PARAR: banco errado/);
  });
});

describe('SQL Editor — 02 reset + bootstrap (falha fechada)', () => {
  test('SE-02 parâmetro não preenchido, banco errado ou nº de clientes divergente: nada muda', async () => {
    await semear({ clientes: 2 });
    const antes = await contar();
    const imp = impressaoAtual();
    const casos = [
      [reset({}), /cole no parâmetro a impressao_inventario/],
      [reset({ impressao: imp, sid: '1234567' }), /NÃO é o banco esperado/],
      [reset({ impressao: imp, banco: 'outro_banco' }), /NÃO é o banco esperado/],
      [reset({ impressao: imp, clientes: 1 }), /2 cliente\(s\) no banco; o parâmetro autoriza 1/],
    ];
    for (const [sql, re] of casos) {
      const r = psql(sql);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, re);
      assert.match(r.stderr, /Nada foi alterado/);
    }
    assert.deepEqual(await contar(), antes);
  });

  test('SE-03 executado instrução por instrução (não numa transação): para ANTES de alterar', async () => {
    await semear();
    const antes = await contar();
    const r = psql(reset({ impressao: impressaoAtual() }), 'f');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /rode o arquivo INTEIRO de uma vez|parâmetros ausentes/);
    assert.deepEqual(await contar(), antes);
  });

  test('SE-04 schema 18/25 (migration não concluída), tabela intrusa ou view em public: recusa', async () => {
    await semear();
    const antes = await contar();
    const p = prisma();
    const imp = impressaoAtual();
    const ultima = '20261029400000_usuario_papel_tenant';
    await p.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET finished_at = NULL WHERE migration_name = $1`, ultima);
    try {
      const r = psql(reset({ impressao: imp }));
      assert.match(r.stderr, /precisa das 25 migrations/);
    } finally {
      await p.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET finished_at = now() WHERE migration_name = $1`, ultima);
    }
    await p.$executeRawUnsafe('CREATE TABLE public."TabelaIntrusa" (id int)');
    try {
      assert.match(psql(reset({ impressao: imp })).stderr, /fora do schema conhecido: TabelaIntrusa/);
    } finally {
      await p.$executeRawUnsafe('DROP TABLE public."TabelaIntrusa"');
    }
    await p.$executeRawUnsafe('CREATE VIEW public."VisaoIntrusa" AS SELECT 1 AS x');
    try {
      assert.match(psql(reset({ impressao: imp })).stderr, /view\/partição\/tabela estrangeira/);
    } finally {
      await p.$executeRawUnsafe('DROP VIEW public."VisaoIntrusa"');
    }
    assert.deepEqual(await contar(), antes);
  });

  test('SE-05 mudança entre o precheck e a execução (mesmo total): recusa', async () => {
    const [t] = await semear();
    const antes = await contar();
    const imp = impressaoAtual();
    const p = prisma();
    await p.movimentacaoMapa.deleteMany({ where: { id: (await p.movimentacaoMapa.findFirst()).id } });
    await p.permissao.create({ data: { cliente_id: t.cliente.id, user_email: 'concorrente@x', is_admin: false } });
    const r = psql(reset({ impressao: imp }));
    assert.match(r.stderr, /o inventário mudou desde o 01/);
    assert.equal((await contar()).c, antes.c);
  });

  test('SE-06 linha em tabela preservada que pode referenciar o tenant: recusa; preservada sem vínculo: intacta', async () => {
    const [t] = await semear();
    const p = prisma();
    await p.operadorProdutoMaike.create({ data: { cliente_id: t.cliente.id, usuario_id: t.usuario.id } });
    const r = psql(reset({ impressao: impressaoAtual() }));
    assert.match(r.stderr, /tabela preservada OperadorProdutoMaike tem linhas/);
    assert.equal(await p.cliente.count(), 1);
    await p.operadorProdutoMaike.deleteMany();
  });

  test('SE-07 falha no meio (depois dos DELETEs): tudo desfeito', async () => {
    await semear();
    const antes = await contar();
    const p = prisma();
    const imp = impressaoAtual();
    await p.$executeRawUnsafe(`ALTER TABLE "Usuario" ADD CONSTRAINT "teste_bloqueia_maike" CHECK (login <> 'maike') NOT VALID`);
    let r;
    try {
      r = psql(reset({ impressao: imp }));
    } finally {
      await p.$executeRawUnsafe(`ALTER TABLE "Usuario" DROP CONSTRAINT "teste_bloqueia_maike"`);
    }
    assert.notEqual(r.status, 0);
    assert.deepEqual(await contar(), antes);
  });

  test('SE-07b (D-PROD-197) na ordem antiga (TipoAtividade junto de TipoTarefa, depois dos centros e da UnidadeMedida) a conferência da árvore real de FKs recusa antes de apagar', async () => {
    await semear();
    const antes = await contar();
    const blocoNovo = "    -- D-PROD-197: o tipo de atividade sai logo depois da atividade (a única tabela que o referencia, D-PROD-200) e ANTES dos\n"
      + "    -- centros de custo e de resultado e da UnidadeMedida, que ele referencia como padrão (FKs RESTRICT).\n"
      + "    'TipoAtividade',\n";
    assert.equal(RESET.split(blocoNovo).length, 2, 'o 02 tem a posição nova do TipoAtividade');
    assert.equal(RESET.split("'TipoTarefa','AreaPastagem','CADCULTURAS','GrupoAtividade','Setor','Empresa'").length, 2);
    // A conferência da ordem (passo 5) vem antes da impressão (passo 7): a recusa é pela árvore de FKs.
    const ordemAntiga = reset({ impressao: impressaoAtual() })
      .replace(blocoNovo, '')
      .replace("'TipoTarefa','AreaPastagem','CADCULTURAS','GrupoAtividade','Setor','Empresa'", "'TipoTarefa','TipoAtividade','AreaPastagem','CADCULTURAS','GrupoAtividade','Setor','Empresa'");
    const r = psql(ordemAntiga);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ordem de FK inválida \(TipoAtividade → (CentroCusto|CentroResultado|UnidadeMedida)\)/);
    assert.match(r.stderr, /Nada foi alterado/);
    assert.deepEqual(await contar(), antes);
  });

  test('SE-07c (D-PROD-200) com a atividade antes do apontamento do dia (ou depois do tipo de atividade) a conferência da árvore real de FKs recusa antes de apagar', async () => {
    await semear();
    const antes = await contar();
    const LINHA_FILHO = "    'AtividadeApontamento',\n";
    const LINHA_PAI = "    'Atividade',\n";
    assert.equal(RESET.split(LINHA_FILHO).length, 2, 'o 02 tem o apontamento do dia');
    assert.equal(RESET.split(LINHA_PAI).length, 2, 'o 02 tem a atividade');
    assert.ok(RESET.indexOf(LINHA_FILHO) < RESET.indexOf(LINHA_PAI) && RESET.indexOf(LINHA_PAI) < RESET.indexOf("    'TipoAtividade',\n"), 'apontamento → atividade → tipo');
    // A conferência da ordem (passo 5) vem antes da impressão (passo 7): a recusa é pela árvore de FKs.
    for (const [ordemErrada, re] of [
      [reset({ impressao: impressaoAtual() }).replace(LINHA_FILHO, '').replace(LINHA_PAI, `${LINHA_PAI}${LINHA_FILHO}`), /ordem de FK inválida \(AtividadeApontamento → Atividade\)/],
      [reset({ impressao: impressaoAtual() }).replace(LINHA_PAI, '').replace("'TipoTarefa','AreaPastagem','CADCULTURAS','GrupoAtividade','Setor','Empresa'", "'TipoTarefa','Atividade','AreaPastagem','CADCULTURAS','GrupoAtividade','Setor','Empresa'"), /ordem de FK inválida \(Atividade → [A-Za-z]+\)/],
    ]) {
      const r = psql(ordemErrada);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, re);
      assert.match(r.stderr, /Nada foi alterado/);
    }
    assert.deepEqual(await contar(), antes);
  });

  test('SE-07d (D-PROD-202) com as linhas do apontamento fora de ordem (a fatia depois da linha de produto, ou uma linha depois do apontamento do dia) a conferência da árvore real de FKs recusa antes de apagar', async () => {
    await semear();
    const antes = await contar();
    const LINHAS = "    'AtividadeApontamentoProdutoConsumoLote','AtividadeApontamentoProduto','AtividadeApontamentoMaquina',\n";
    const FILHO = "    'AtividadeApontamento',\n";
    assert.equal(RESET.split(LINHAS).length, 2, 'o 02 tem as 3 linhas do apontamento');
    assert.ok(RESET.indexOf(LINHAS) < RESET.indexOf(FILHO), 'linhas → apontamento do dia');
    for (const [ordemErrada, re] of [
      [reset({ impressao: impressaoAtual() }).replace(LINHAS, "    'AtividadeApontamentoProduto','AtividadeApontamentoProdutoConsumoLote','AtividadeApontamentoMaquina',\n"), /ordem de FK inválida \(AtividadeApontamentoProdutoConsumoLote → AtividadeApontamentoProduto\)/],
      [reset({ impressao: impressaoAtual() }).replace(LINHAS, "    'AtividadeApontamentoProdutoConsumoLote','AtividadeApontamentoProduto',\n").replace(FILHO, `${FILHO}    'AtividadeApontamentoMaquina',\n`), /ordem de FK inválida \(AtividadeApontamentoMaquina → AtividadeApontamento\)/],
    ]) {
      const r = psql(ordemErrada);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, re);
      assert.match(r.stderr, /Nada foi alterado/);
    }
    assert.deepEqual(await contar(), antes);
  });

  test('SE-07e (D-PROD-207/D-PROD-208) com a mão de obra e o serviço fora de ordem (o serviço antes da linha de serviço, a linha de mão de obra depois do apontamento do dia, ou o serviço depois da empresa, do centro de custo e da UnidadeMedida) a conferência da árvore real de FKs recusa antes de apagar', async () => {
    await semear();
    const antes = await contar();
    const NOVAS = "    'AtividadeApontamentoMaoObra','AtividadeApontamentoServico','Servico',\n";
    const FILHO = "    'AtividadeApontamento',\n";
    const UNIDADE = "'UnidadeMedida',";
    assert.equal(RESET.split(NOVAS).length, 2, 'o 02 tem as 3 tabelas da mão de obra e do serviço (D-PROD-208: a Funcionario saiu)');
    assert.ok(!RESET.includes("'Funcionario'") && !RESET.includes('"Funcionario"'), 'D-PROD-208: a Funcionario não está nem na lista nem no LOCK');
    assert.ok(RESET.indexOf(NOVAS) < RESET.indexOf(FILHO), 'mão de obra e serviço → apontamento do dia');
    assert.ok(RESET.indexOf(NOVAS) < RESET.indexOf(UNIDADE), 'serviço → unidade');
    for (const [ordemErrada, re] of [
      [reset({ impressao: impressaoAtual() }).replace(NOVAS, "    'Servico','AtividadeApontamentoMaoObra','AtividadeApontamentoServico',\n"), /ordem de FK inválida \(AtividadeApontamentoServico → Servico\)/],
      [reset({ impressao: impressaoAtual() }).replace(NOVAS, "    'AtividadeApontamentoServico','Servico',\n").replace(FILHO, `${FILHO}    'AtividadeApontamentoMaoObra',\n`), /ordem de FK inválida \(AtividadeApontamentoMaoObra → AtividadeApontamento\)/],
      [reset({ impressao: impressaoAtual() }).replace(NOVAS, "    'AtividadeApontamentoMaoObra','AtividadeApontamentoServico',\n").replace(UNIDADE, `${UNIDADE}'Servico',`), /ordem de FK inválida \(Servico → (Empresa|UnidadeMedida|CentroCusto)\)/],
    ]) {
      const r = psql(ordemErrada);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, re);
      assert.match(r.stderr, /Nada foi alterado/);
    }
    assert.deepEqual(await contar(), antes);
  });

  test('SE-07f (D-PROD-216) a área ligada à cultura: com a CADCULTURAS antes da AreaPastagem, ou a Empresa antes da CADCULTURAS, a conferência da árvore real de FKs recusa antes de apagar', async () => {
    await semear();
    const antes = await contar();
    const FIM = "'TipoTarefa','AreaPastagem','CADCULTURAS','GrupoAtividade','Setor','Empresa'";
    assert.equal(RESET.split(FIM).length, 2, 'a Área sai antes da cultura, e a cultura antes da Empresa (no fim)');
    for (const [ordemErrada, re] of [
      [reset({ impressao: impressaoAtual() }).replace(FIM, "'TipoTarefa','CADCULTURAS','AreaPastagem','GrupoAtividade','Setor','Empresa'"), /ordem de FK inválida \(AreaPastagem → CADCULTURAS\)/],
      [reset({ impressao: impressaoAtual() }).replace(FIM, "'TipoTarefa','AreaPastagem','Empresa','CADCULTURAS','GrupoAtividade','Setor'"), /ordem de FK inválida \(CADCULTURAS → Empresa\)/],
    ]) {
      const r = psql(ordemErrada);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, re);
      assert.match(r.stderr, /Nada foi alterado/);
    }
    assert.deepEqual(await contar(), antes);
  });

  test('SE-08 login "maike" já existe (fora do escopo) ou conta maike com papel errado: ANOMALIA, nada apagado', async () => {
    const [t] = await semear();
    const p = prisma();
    await p.usuario.create({ data: { cliente_id: t.cliente.id, nome: 'X', login: 'maike', senha_hash: 'x' } });
    const antes = await contar();
    assert.match(psql(reset({ impressao: impressaoAtual() })).stderr, /ANOMALIA/);
    assert.deepEqual(await contar(), antes);
  });
});

describe('SQL Editor — 02 sucesso + 03 postcheck + API real', () => {
  test('SE-09 apaga só o teste, cria maike administradora, senha só uma vez (bcryptjs), preservados intactos', async () => {
    const [t] = await semear();
    const p = prisma();
    await p.catalogoTipoEntidade.create({ data: { codigo: 'lote-teste-sqled', nome: 'Lote' } });
    const app = await criarApp();
    const tokenAntigo = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    const antes = await contar();
    const rls = await p.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE relrowsecurity)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND relkind='r'`);

    const r = psql(reset({ impressao: impressaoAtual() }));
    assert.equal(r.status, 0, r.stderr);
    const res = resultado(r);
    assert.equal(res.status, 'CONCLUIDO');
    assert.equal(res.login, 'maike');
    assert.match(res.senha, /^[A-Za-z0-9_-]{24}$/);
    assert.ok(res.apagadas > 0);

    const conta = await p.usuario.findFirst({ include: { cliente: true } });
    assert.deepEqual(
      [conta.login, conta.nome, conta.ativo, conta.papel_tenant, conta.cliente.codigo, conta.cliente.nome, conta.cliente.ativo],
      ['maike', 'Maike', true, 'administrador', 'maike', 'MAIKE', true]
    );
    assert.match(conta.senha_hash, /^\$2a\$10\$/);
    assert.equal(await bcrypt.compare(res.senha, conta.senha_hash), true, 'hash do pgcrypto compatível com bcryptjs');
    const depois = await contar();
    assert.deepEqual(depois, { c: 1, u: 1, l: 0, a: 2, cat: 0, mm: 0, glob: antes.glob, mig: antes.mig });
    // D-PROD-200: a semente tinha 1 atividade com 1 apontamento do dia; o 02 apagou na ordem certa (apontamento → atividade →
    // tipo, tarefa, área, setor, centros e unidade), e o estoque (lote e movimento → produto e local).
    // D-PROD-202: e as linhas do apontamento antes dele (fatia → linha de produto → linha de máquina → apontamento), e o bem.
    // D-PROD-207: e a mão de obra e o serviço antes de tudo (linhas → serviço → apontamento), e os parceiros (D-PROD-208:
    // o funcionário é um deles).
    assert.deepEqual(
      [await p.atividadeApontamentoMaoObra.count(), await p.atividadeApontamentoServico.count(), await p.servico.count(),
        await p.fornecedor.count(), await p.atividadeApontamentoProdutoConsumoLote.count(), await p.atividadeApontamentoProduto.count(), await p.atividadeApontamentoMaquina.count(),
        await p.atividadeApontamento.count(), await p.atividade.count(), await p.estoqueLoteNota.count(), await p.movimentacaoEstoque.count(), await p.produto.count(),
        await p.localEstoque.count(), await p.bemPatrimonial.count(), await p.tipoPatrimonial.count(), await p.familiaPatrimonial.count()],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    );
    // D-PROD-197: o tipo com os 3 padrões saiu antes do centro de custo, do centro de resultado e da unidade (FKs RESTRICT).
    assert.deepEqual(
      [await p.tipoAtividade.count(), await p.centroCusto.count(), await p.centroResultado.count(), await p.unidadeMedida.count()],
      [0, 0, 0, 0]
    );
    const auditoria = await p.auditLog.findMany({ orderBy: { acao: 'asc' } });
    assert.deepEqual(auditoria.map((a) => a.acao), ['ops_inicializacao', 'papel_tenant']);
    const texto = JSON.stringify(auditoria);
    assert.equal(texto.includes(res.senha) || texto.includes(conta.senha_hash), false, 'auditoria sem senha nem hash');
    assert.equal(await p.permissao.count(), 0, 'sem Permissao.is_admin artificial');
    assert.deepEqual(
      await p.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE relrowsecurity)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND relkind='r'`),
      rls
    );

    // 03 postcheck
    const pos = linhasDe(psql(POS));
    assert.match(pos.VEREDITO.valor, /^INICIALIZADO/);
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.notEqual(v.status, 'PARAR', item);

    // API real do MAIKE (backend desta PR)
    const get = (url, tok) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tok}` } });
    assert.equal((await get('/lotes', tokenAntigo)).statusCode, 401, 'JWT da conta apagada');
    const login = await autenticarNoApp(app, { login: 'maike', senha: res.senha });
    assert.equal(login.resposta.statusCode, 200);
    const tok = login.corpo.token;
    assert.equal((await get('/lotes', tok)).statusCode, 200);
    const us = await get('/usuarios', tok);
    assert.equal(us.statusCode, 200);
    const criar = await app.inject({ method: 'POST', url: '/usuarios', headers: { authorization: `Bearer ${tok}` }, payload: { nome: 'Vaqueiro', login: 'sqled.vaqueiro', senha: 'Vaqueiro-SqlEd-2026' } });
    assert.equal(criar.statusCode, 201, 'administrador da fazenda cria conta');
    const tokComum = (await autenticarNoApp(app, { login: 'sqled.vaqueiro', senha: 'Vaqueiro-SqlEd-2026' })).corpo.token;
    const comumCria = await app.inject({ method: 'POST', url: '/usuarios', headers: { authorization: `Bearer ${tokComum}` }, payload: { nome: 'Y', login: 'sqled.y', senha: 'Y-SqlEd-2026-abc' } });
    assert.equal(comumCria.statusCode, 403, 'usuário comum não cria');
    await p.usuario.update({ where: { login: undefined, id: (await p.usuario.findFirst({ where: { login: 'sqled.vaqueiro' } })).id }, data: { ativo: false } });
    assert.equal((await get('/lotes', tokComum)).statusCode, 401, 'conta desativada');
    await p.cliente.update({ where: { id: conta.cliente_id }, data: { ativo: false } });
    assert.equal((await get('/lotes', tok)).statusCode, 401, 'cliente desativado');
    await app.close();
  });

  test('SE-10 reexecução: JA_INICIALIZADO, sem senha, sem alterar; com dado extra: ANOMALIA sem apagar', async () => {
    await semear();
    const r1 = resultado(psql(reset({ impressao: impressaoAtual() })));
    assert.equal(r1.status, 'CONCLUIDO');
    const p = prisma();
    const conta = await p.usuario.findFirst();
    assert.match(linhasDe(psql(precheck())).VEREDITO.valor, /^INICIALIZADO/);
    const r2 = psql(reset({ impressao: impressaoAtual() }));
    assert.equal(r2.status, 0, r2.stderr);
    const res2 = resultado(r2);
    assert.equal(res2.status, 'JA_INICIALIZADO');
    assert.equal(res2.senha, null, 'senha nunca é mostrada de novo');
    const depois = await p.usuario.findFirst();
    assert.deepEqual([depois.id, depois.senha_hash], [conta.id, conta.senha_hash]);
    await p.empresa.create({ data: { cliente_id: conta.cliente_id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'REAL', nome: 'REAL' } });
    assert.match(psql(reset({ impressao: impressaoAtual() })).stderr, /ANOMALIA/);
    assert.equal(await p.empresa.count(), 1);
    assert.equal(await p.usuario.count(), 1);
  });
});
