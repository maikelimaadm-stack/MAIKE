#!/usr/bin/env node
/**
 * Atribui ou revoga o papel de ADMINISTRADOR DA FAZENDA (tenant) —
 * PR145-R4, D-PROD-71.
 *
 * Único caminho de elevação: script operacional, restrito a quem tem acesso ao
 * banco. NÃO existe endpoint HTTP que grave `Usuario.papel_tenant`.
 *
 * - Individual e explícito: um usuário por vez, identificado por código do
 *   cliente + login. Nunca promove "o primeiro usuário" nem em lote.
 * - Mostra o plano (tenant, usuário, papel atual → novo) e exige a confirmação
 *   digitada `CONFIRMAR`.
 * - Reversível: `--papel usuario` revoga.
 * - Auditado: grava `AuditLog` (evento de sistema, ator nulo) na MESMA transação.
 * - Recusa NODE_ENV=production sem PAPEL_TENANT_ALLOW_PRODUCTION=sim (exige
 *   aprovação separada do proprietário — runbook).
 * - Não imprime senha, hash nem DATABASE_URL.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/auth/papel-tenant.mjs --cliente <codigo> --login <login> --papel administrador
 *   DATABASE_URL=... node scripts/auth/papel-tenant.mjs --cliente <codigo> --login <login> --papel usuario
 * Teste automatizado (sem TTY): PAPEL_TENANT_STDIN=sim e a confirmação no stdin.
 */

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const sair = (msg, codigo = 1) => {
  console.error(`papel-tenant: ${msg}`);
  process.exit(codigo);
};
const args = process.argv.slice(2);
const valor = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? (args[i + 1] ?? '').trim() : '';
};

if (process.env.NODE_ENV === 'production' && process.env.PAPEL_TENANT_ALLOW_PRODUCTION !== 'sim') {
  sair('recusado em NODE_ENV=production (exige PAPEL_TENANT_ALLOW_PRODUCTION=sim e aprovação separada)');
}
if (!process.stdin.isTTY && process.env.PAPEL_TENANT_STDIN !== 'sim') sair('execute num terminal interativo');

const codigoCliente = valor('--cliente');
const login = valor('--login').toLowerCase();
const papel = valor('--papel');
if (!codigoCliente || !login || !['administrador', 'usuario'].includes(papel)) {
  sair('uso: --cliente <codigo> --login <login> --papel administrador|usuario');
}

const { env } = await import('../../backend/src/config/env.js');
if (!env.databaseUrl) sair('DATABASE_URL ausente');
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const prisma = getPrismaClient();

try {
  const cliente = await prisma.cliente.findUnique({ where: { codigo: codigoCliente } });
  if (!cliente) sair('cliente não encontrado para o código informado');
  const usuario = await prisma.usuario.findFirst({
    where: { cliente_id: cliente.id, login },
    select: { id: true, nome: true, login: true, ativo: true, papel_tenant: true },
  });
  if (!usuario) sair('usuário não encontrado neste cliente');
  if (papel === 'administrador' && !usuario.ativo) sair('usuário desativado não pode ser promovido');
  if (usuario.papel_tenant === papel) {
    console.log(`nada a fazer: ${usuario.login} já é "${papel}" em ${cliente.codigo}`);
    process.exit(0);
  }

  console.log(`Fazenda: ${cliente.nome} (${cliente.codigo})`);
  console.log(`Usuário: ${usuario.nome} <${usuario.login}>`);
  console.log(`Papel:   ${usuario.papel_tenant} → ${papel}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  process.stdout.write('Digite CONFIRMAR para aplicar: ');
  const { value } = await rl[Symbol.asyncIterator]().next();
  rl.close();
  if (String(value ?? '').trim() !== 'CONFIRMAR') sair('confirmação não digitada; nada foi alterado');

  const requestId = `ops-papel-tenant-${randomUUID()}`;
  await prisma.$transaction(async (tx) => {
    const r = await tx.usuario.updateMany({
      where: { id: usuario.id, cliente_id: cliente.id, papel_tenant: usuario.papel_tenant },
      data: { papel_tenant: papel },
    });
    if (r.count !== 1) throw new Error('o papel mudou durante a operação; nada foi alterado');
    await tx.auditLog.create({
      data: {
        cliente_id: cliente.id,
        usuario_id: null,
        acao: 'papel_tenant',
        entidade: 'Usuario',
        entidade_id: usuario.id,
        dados_anteriores: { papel_tenant: usuario.papel_tenant },
        dados_novos: { papel_tenant: papel, via: 'scripts/auth/papel-tenant.mjs' },
        request_id: requestId,
      },
    });
  });
  console.log(`aplicado: ${usuario.login} agora é "${papel}" (auditoria ${requestId})`);
  console.log('Vale na próxima ação privilegiada (o servidor relê o papel no banco); não precisa novo login.');
} catch (erro) {
  sair(/** @type {any} */ (erro)?.message ?? 'falha');
} finally {
  await closePrismaClient();
}
