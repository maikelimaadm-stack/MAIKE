/**
 * O banco como em PRODUÇÃO para os testes de backend (D-PROD-253; nasceu no
 * IT4g da D-PROD-193, cujo teste saiu com o apontamento antigo na D-PROD-200).
 * Não é arquivo de teste (sem `.test.`).
 *
 * Em produção o runtime roda como `maike_vercel`: NÃO é dono das tabelas (o
 * dono é `postgres`), não tem BYPASSRLS, e as tabelas têm RLS ligado (sem
 * FORCE) com a política `maike_backend_all` (`FOR ALL … USING (true) WITH
 * CHECK (true)`) só para ele (`P8-SUPABASE-PUBLIC-GRANTS-RLS-REPORT.md`).
 * Nesse arranjo o PostgreSQL omite o DETAIL da violação de unique e o Prisma
 * 6.19 devolve o P2002 com `meta.target` nulo. Os testes rodam como o dono
 * das tabelas, onde o alvo existe: sem este helper o defeito não aparece.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../src/database/prismaClient.js';

/**
 * Prefixo das políticas do teste. Cada chamada usa um nome próprio (o sufixo do
 * papel): uma limpeza que falhe não faz a chamada seguinte cair no
 * `CREATE POLICY` com "already exists".
 */
const PREFIXO_DA_POLITICA = 'teste_backend_all';

/**
 * Roda `fn` com TODA transação interativa do app (`getPrismaClient().$transaction`)
 * como em PRODUÇÃO: um papel que NÃO é dono das tabelas, sem BYPASSRLS, com o
 * RLS que as migrations ligam em todas elas e uma política permissiva
 * `FOR ALL … USING (true) WITH CHECK (true)` (a `maike_backend_all` do
 * `maike_vercel`). O primeiro comando de cada transação vira `SET LOCAL ROLE`
 * (vale só até o fim dela). Papel e políticas com nome único, criados e
 * apagados aqui: as políticas saem uma a uma e o `DROP OWNED BY`, depois, leva
 * só os grants deste banco. Consultas fora de `$transaction` e outros
 * PrismaClient (portões, observação de travas) seguem como o dono.
 * @template T
 * @param {(papel: string) => Promise<T>} fn
 * @param {{ exigirRls?: string[] }} [opcoes] tabelas que TÊM de estar com RLS ligado (sem FORCE)
 * @returns {Promise<T>}
 */
export const comPapelNaoDono = async (fn, { exigirRls = [] } = {}) => {
  const p = /** @type {any} */ (getPrismaClient());
  const sufixo = randomUUID().replaceAll('-', '').slice(0, 12);
  const papel = `maike_teste_rls_${sufixo}`;
  const politica = `${PREFIXO_DA_POLITICA}_${sufixo}`;
  const original = p.$transaction;
  await p.$executeRawUnsafe(`CREATE ROLE ${papel} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  try {
    await p.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${papel}`);
    await p.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${papel}`);
    await p.$executeRawUnsafe(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${papel}`);
    const comRls = /** @type {Array<{ tabela: string }>} */ (await p.$queryRaw`SELECT c.relname AS tabela FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity ORDER BY 1`);
    for (const tabela of exigirRls) {
      assert.ok(comRls.some((t) => t.tabela === tabela), `a tabela ${tabela} tem RLS ligado (sem FORCE), como em produção`);
    }
    for (const { tabela } of comRls) await p.$executeRawUnsafe(`CREATE POLICY ${politica} ON public."${tabela}" FOR ALL TO ${papel} USING (true) WITH CHECK (true)`);
    p.$transaction = (/** @type {any} */ arg, /** @type {any} */ opcoes) =>
      typeof arg === 'function'
        ? original.call(p, async (/** @type {any} */ tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE ${papel}`);
            return arg(tx);
          }, opcoes)
        : original.call(p, arg, opcoes);
    return await fn(papel);
  } finally {
    p.$transaction = original;
    // As políticas saem uma a uma, cada uma na sua transação, e só depois vem o `DROP OWNED BY`. Sozinho, ele
    // tira numa transação só os grants (atualiza a linha de cada tabela no pg_class) e as políticas (ACCESS
    // EXCLUSIVE em cada tabela). Um VACUUM (o autovacuum) que termine uma dessas tabelas no meio espera essa
    // transação para gravar as estatísticas na linha da tabela no pg_class, segurando a trava que o DROP OWNED
    // pede em seguida: deadlock (40P01), visto na CI. Sem as políticas, o DROP OWNED só tira os grants, sem
    // pedir trava de tabela, e o ciclo não fecha.
    const politicas = /** @type {Array<{ tabela: string }>} */ (await p.$queryRaw`SELECT tablename::text AS tabela FROM pg_policies
      WHERE schemaname = 'public' AND policyname = ${politica} ORDER BY 1`);
    for (const { tabela } of politicas) await p.$executeRawUnsafe(`DROP POLICY IF EXISTS ${politica} ON public."${tabela}"`);
    await p.$executeRawUnsafe(`DROP OWNED BY ${papel}`);
    await p.$executeRawUnsafe(`DROP ROLE ${papel}`);
  }
};

/** O papel da sessão numa transação interativa do app (o dono, ou o papel dentro de `comPapelNaoDono`). */
export const papelDaTransacao = async () =>
  /** @type {any[]} */ (await getPrismaClient().$transaction((tx) => tx.$queryRaw`SELECT current_user AS u`))[0].u;
