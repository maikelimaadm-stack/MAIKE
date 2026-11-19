#!/usr/bin/env node
/**
 * D-PROD-257 — atualização de DADOS dos tipos de atividade existentes para os "tipos fixos" (Fase 1).
 *
 * PREPARADO PARA REVISÃO. Não é migration do Prisma de propósito: uma migration roda sozinha no deploy (barreira de
 * migrations) e a lista abaixo precisa ser conferida pelo proprietário antes. Nenhuma coluna é criada, alterada ou apagada.
 *
 * O que faz, para cada TipoAtividade (de todos os clientes, ou de um só com `--cliente`):
 *  1. `categoria` → um dos 7 tipos fixos (`tipoFixoDaOperacaoExistente`): operação de Aplicação ou Trato cultural com nome
 *     de adubação vai para Fertilização; Trato cultural sem nome de adubação vira Aplicação; os demais valores aceitos ficam;
 *     COLHEITA, MANEJO_ANIMAL e sem categoria viram Outros;
 *  2. as 8 chaves → o padrão da operação (`FLAGS_PADRAO_OPERACAO`): exige_area e as quatro permissões LIGADAS; as três
 *     chaves que EXIGEM dado (safra, máquina, produção) DESLIGADAS — ligadas, obrigariam o campo em todo registro.
 *
 * NÃO mexe em: grupo, centros, unidade, coeficiente, nome, ativo, atividades e lançamentos já feitos.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/ops/tipos-fixos-atividade-dados.mjs                       # DRY-RUN (padrão): só lista
 *   DATABASE_URL=... TIPOS_FIXOS_CONFIRM=sim node scripts/ops/tipos-fixos-atividade-dados.mjs \
 *       --aplicar --backup /caminho/antes.json [--cliente <id>]                             # grava
 *
 * Gravar exige `--aplicar`, `TIPOS_FIXOS_CONFIRM=sim` e `--backup` (um JSON com o valor ANTERIOR de cada linha alterada,
 * para voltar atrás). Roda numa transação só: tudo ou nada. Idempotente: a 2ª rodada não acha nada a mudar.
 * Não imprime DATABASE_URL.
 */

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { FLAGS_PADRAO_OPERACAO, FLAGS_TIPO_ATIVIDADE, tipoFixoDaOperacaoExistente } from '../../backend/src/modules/tiposAtividade/tipoAtividadePadroes.js';

const SELECAO = Object.freeze({ id: true, cliente_id: true, nome_tipo: true, categoria: true, ...Object.fromEntries(FLAGS_TIPO_ATIVIDADE.map((f) => [f, true])) });

/**
 * O que mudaria em cada tipo (puro: só lê). Tipos que já estão certos não entram.
 * @param {Array<Record<string, any>>} tipos
 */
export const planejarMudancas = (tipos) => {
  const mudancas = [];
  for (const t of tipos) {
    const { categoria, motivo } = tipoFixoDaOperacaoExistente(t.categoria, t.nome_tipo);
    /** @type {Record<string, any>} */
    const depois = { categoria, ...FLAGS_PADRAO_OPERACAO };
    /** @type {Record<string, any>} */
    const antes = { categoria: t.categoria ?? null, ...Object.fromEntries(FLAGS_TIPO_ATIVIDADE.map((f) => [f, t[f] === true])) };
    const campos = Object.keys(depois).filter((c) => antes[c] !== depois[c]);
    if (!campos.length) continue;
    mudancas.push({
      cliente_id: t.cliente_id,
      id: t.id,
      nome_tipo: t.nome_tipo,
      motivo,
      campos,
      antes: Object.fromEntries(campos.map((c) => [c, antes[c]])),
      depois: Object.fromEntries(campos.map((c) => [c, depois[c]])),
    });
  }
  return mudancas;
};

/**
 * @param {any} prisma  PrismaClient (o teste passa o do banco descartável)
 * @param {{ aplicar?: boolean, clienteId?: string|null }} [opcoes]
 */
export const executar = async (prisma, { aplicar = false, clienteId = null } = {}) => {
  const tipos = await prisma.tipoAtividade.findMany({
    where: clienteId ? { cliente_id: clienteId } : {},
    orderBy: [{ cliente_id: 'asc' }, { nome_tipo: 'asc' }],
    select: SELECAO,
  });
  const mudancas = planejarMudancas(tipos);
  if (aplicar) {
    await prisma.$transaction(async (tx) => {
      for (const m of mudancas) {
        const r = await tx.tipoAtividade.updateMany({ where: { cliente_id: m.cliente_id, id: m.id }, data: m.depois });
        if (r.count !== 1) throw new Error(`tipo ${m.id} não foi atualizado (count=${r.count}); nada foi gravado`);
      }
    });
  }
  return { total: tipos.length, mudancas, aplicado: aplicar };
};

const falhar = (mensagem) => {
  console.error(`tipos-fixos-atividade-dados — FALHOU\n\n  ${mensagem}\n`);
  process.exit(1);
};

const principal = async () => {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const valorDe = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const backup = valorDe('--backup');
  const clienteId = valorDe('--cliente');
  if (!process.env.DATABASE_URL) falhar('DATABASE_URL ausente.');
  if (aplicar && process.env.TIPOS_FIXOS_CONFIRM !== 'sim') falhar('Para gravar, defina TIPOS_FIXOS_CONFIRM=sim (depois de conferir a lista do dry-run).');
  if (aplicar && !backup) falhar('Para gravar, informe --backup <arquivo.json> (guarda o valor anterior de cada linha).');

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const r = await executar(prisma, { aplicar: false, clienteId });
    console.log(`${aplicar ? 'GRAVAR' : 'DRY-RUN'} — ${r.total} tipo(s) de atividade lidos; ${r.mudancas.length} mudariam.\n`);
    for (const m of r.mudancas) {
      console.log(`- [${m.cliente_id}] ${m.nome_tipo} (${m.id}) — ${m.motivo}`);
      for (const c of m.campos) console.log(`    ${c}: ${JSON.stringify(m.antes[c])} -> ${JSON.stringify(m.depois[c])}`);
    }
    if (!aplicar) {
      console.log('\nNada foi gravado. Confira a lista; para gravar: TIPOS_FIXOS_CONFIRM=sim ... --aplicar --backup <arquivo.json>');
      return;
    }
    writeFileSync(backup, JSON.stringify(r.mudancas.map(({ cliente_id, id, nome_tipo, antes }) => ({ cliente_id, id, nome_tipo, antes })), null, 2));
    const g = await executar(prisma, { aplicar: true, clienteId });
    console.log(`\nGravado: ${g.mudancas.length} tipo(s) atualizados. Backup do valor anterior: ${backup}`);
  } finally {
    await prisma.$disconnect();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => falhar(e instanceof Error ? e.message : String(e)));
}
