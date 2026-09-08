/**
 * Porta única para o Prisma.
 *
 * Ninguém instancia `PrismaClient` fora daqui. O cliente é criado sob demanda e
 * reaproveitado — abrir uma conexão por módulo esgota o pool do PostgreSQL, que
 * é o defeito clássico dessa camada.
 */

import { PrismaClient } from '@prisma/client';

import { env } from '../config/env.js';

/** @type {PrismaClient | null} */
let clientePrisma = null;

/** @returns {PrismaClient} */
export const getPrismaClient = () => {
  if (clientePrisma) return clientePrisma;

  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL ausente: o backend não sobe sem banco configurado.');
  }

  clientePrisma = new PrismaClient({
    datasources: { db: { url: env.databaseUrl } },
    log: env.nodeEnv === 'development' ? ['error', 'warn'] : ['error'],
  });

  return clientePrisma;
};

export const closePrismaClient = async () => {
  if (!clientePrisma) return;
  const cliente = clientePrisma;
  clientePrisma = null;
  await cliente.$disconnect();
};
