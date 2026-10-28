#!/usr/bin/env node
/**
 * Bootstrap manual do primeiro operador de produto MAIKE (D-PROD-57).
 *
 * Não roda em produção por padrão. Exige IDs exatos e confirmação explícita.
 * Nunca imprime senha, hash nem DATABASE_URL.
 */

import { config as carregarDotenv } from 'dotenv';

carregarDotenv();

const texto = (nome) => {
  const v = process.env[nome];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

if (process.env.NODE_ENV === 'production' && texto('BOOTSTRAP_OPERADOR_ALLOW_PRODUCTION') !== 'sim') {
  console.error(
    'bootstrap-operador-produto: recusado em NODE_ENV=production (use BOOTSTRAP_OPERADOR_ALLOW_PRODUCTION=sim se intencional)'
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error('bootstrap-operador-produto: DATABASE_URL ausente');
  process.exit(1);
}

const clienteId = texto('BOOTSTRAP_OPERADOR_CLIENTE_ID');
const usuarioId = texto('BOOTSTRAP_OPERADOR_USUARIO_ID');
const confirmar = texto('BOOTSTRAP_OPERADOR_CONFIRM');

if (!clienteId || !usuarioId || confirmar !== 'sim') {
  console.error(
    'Uso: BOOTSTRAP_OPERADOR_CLIENTE_ID=... BOOTSTRAP_OPERADOR_USUARIO_ID=... BOOTSTRAP_OPERADOR_CONFIRM=sim node scripts/catalogo/bootstrap-operador-produto.mjs'
  );
  process.exit(1);
}

const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');

const prisma = getPrismaClient();

try {
  const usuario = await prisma.usuario.findFirst({
    where: { cliente_id: clienteId, id: usuarioId },
  });
  if (!usuario) {
    console.error('Usuário não encontrado para o par cliente_id + usuario_id informado.');
    process.exit(1);
  }

  const existente = await prisma.operadorProdutoMaike.findUnique({
    where: { cliente_id_usuario_id: { cliente_id: clienteId, usuario_id: usuarioId } },
  });
  if (existente) {
    console.error('Operador já registrado — abortando sem sobrescrever.');
    process.exit(1);
  }

  await prisma.operadorProdutoMaike.create({
    data: { cliente_id: clienteId, usuario_id: usuarioId, papel: 'editor', ativo: true },
  });

  console.log('Operador de produto registrado com sucesso.');
} finally {
  await closePrismaClient();
}
