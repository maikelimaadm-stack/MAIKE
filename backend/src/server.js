#!/usr/bin/env node
/**
 * Ponto de entrada do processo.
 *
 * Falha dura por configuração ausente: sem `DATABASE_URL` ou `AUTH_SECRET` o
 * processo não sobe. Subir degradado e descobrir depois que a sessão está sendo
 * assinada com um segredo padrão é pior do que não subir.
 */

import { env, exigirConfiguracaoCompleta } from './config/env.js';
import { construirApp } from './app.js';
import { closePrismaClient } from './database/prismaClient.js';

const iniciar = async () => {
  exigirConfiguracaoCompleta();

  const app = await construirApp();

  const encerrar = async (sinal) => {
    app.log.info(`recebido ${sinal}, encerrando`);
    await app.close();
    await closePrismaClient();
    process.exit(0);
  };

  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('SIGINT', () => void encerrar('SIGINT'));

  await app.listen({ port: env.port, host: env.host });
};

iniciar().catch((erro) => {
  console.error(`[backend] falha ao iniciar: ${erro.message}`);
  process.exit(1);
});
