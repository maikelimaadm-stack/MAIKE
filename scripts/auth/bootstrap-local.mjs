#!/usr/bin/env node
/**
 * Bootstrap operacional local do primeiro Cliente + Usuario (P4.0).
 *
 * ─── Por que isto existe ───────────────────────────────────────────────────
 *
 * A P3 ensinou o backend a autenticar, mas não criou nenhuma forma de existir
 * um usuário. Sem isso a P4.0 seria inverificável: haveria login nativo e
 * ninguém para entrar.
 *
 * ─── Por que é um script, e não um endpoint ────────────────────────────────
 *
 * Endpoint de bootstrap é uma porta permanente de criação de conta com
 * privilégio, que costuma nascer "temporária" e sobreviver a todas as fases
 * seguintes. Gestão de usuários é da P6, com CRUD, permissão e auditoria.
 * Este script é o mínimo operacional para tornar a P4.0 utilizável, e ele **não
 * é CRUD**: não lista, não altera, não remove e não redefine senha.
 *
 * ─── Proteções ─────────────────────────────────────────────────────────────
 *
 *  - recusa rodar com `NODE_ENV=production`;
 *  - exige todas as variáveis, sem padrão para nenhuma — não existe usuário
 *    `admin` nem senha `admin` esperando alguém esquecer de trocar;
 *  - falha se o cliente ou o usuário já existir, em vez de sobrescrever. Um
 *    bootstrap que reescreve senha silenciosamente é um mecanismo de tomada de
 *    conta com nome amigável;
 *  - não imprime senha, hash, `DATABASE_URL` nem id — a saída diz o que foi
 *    criado, não o que vale como credencial;
 *  - não fornece `id`: quem produz é o `@default(cuid())` do Prisma, como manda
 *    o contrato e verifica `P3-TEN-RUNTIME-IDENTITY`.
 */

import { PrismaClient } from '@prisma/client';

import { env, ehProducao } from '../../backend/src/config/env.js';
import { gerarSenhaHash } from '../../backend/src/modules/auth/authService.js';

const VARIAVEIS = Object.freeze([
  'BOOTSTRAP_CLIENTE_CODIGO',
  'BOOTSTRAP_CLIENTE_NOME',
  'BOOTSTRAP_USUARIO_LOGIN',
  'BOOTSTRAP_USUARIO_NOME',
  'BOOTSTRAP_USUARIO_SENHA',
]);

const falhar = (mensagem) => {
  console.error(`auth:bootstrap:local — FALHOU\n\n  ${mensagem}\n`);
  process.exit(1);
};

const texto = (nome) => {
  const valor = process.env[nome];
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
};

/**
 * Cria o par Cliente + Usuario.
 *
 * Exportada para que o teste exercite a **regra**, não uma reimplementação
 * dela. Recebe o client por parâmetro: o teste usa o banco descartável dele, e
 * não há segunda conexão escondida aqui dentro.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{clienteCodigo: string, clienteNome: string, login: string, nome: string, senha: string}} entrada
 * @returns {Promise<{clienteCriado: boolean, usuarioCriado: boolean}>}
 */
export const criarClienteEUsuario = async (prisma, entrada) => {
  const existente = await prisma.cliente.findUnique({ where: { codigo: entrada.clienteCodigo } });

  // Cliente já existente não é erro por si: o segundo usuário do mesmo cliente
  // é caso legítimo. O que não pode é sobrescrever o que está lá.
  const cliente =
    existente ??
    (await prisma.cliente.create({
      // Sem `id`: o @default(cuid()) do Prisma é quem produz a identidade.
      data: { codigo: entrada.clienteCodigo, nome: entrada.clienteNome, ativo: true },
    }));

  const usuarioExistente = await prisma.usuario.findUnique({
    where: { cliente_id_login: { cliente_id: cliente.id, login: entrada.login } },
  });

  if (usuarioExistente) {
    throw new Error(
      `o usuário '${entrada.login}' já existe neste cliente. ` +
        'Este script não redefine senha nem sobrescreve conta — use outro login.'
    );
  }

  await prisma.usuario.create({
    data: {
      cliente_id: cliente.id,
      login: entrada.login,
      nome: entrada.nome,
      senha_hash: await gerarSenhaHash(entrada.senha),
      ativo: true,
    },
  });

  return { clienteCriado: existente === null, usuarioCriado: true };
};

const principal = async () => {
  if (ehProducao()) {
    falhar(
      'NODE_ENV=production. Este bootstrap é uma ferramenta local de desenvolvimento.\n' +
        '  Onboarding de produção pertence à fase de gestão de usuários (P6).'
    );
  }

  if (!env.databaseUrl) falhar('DATABASE_URL ausente. Veja .env.example.');

  const ausentes = VARIAVEIS.filter((nome) => texto(nome) === null);
  if (ausentes.length) {
    falhar(
      `variáveis obrigatórias ausentes: ${ausentes.join(', ')}.\n` +
        '  Nenhuma tem valor padrão — usuário e senha padrão são a origem de metade\n' +
        '  dos incidentes de acesso. Defina todas explicitamente.'
    );
  }

  const prisma = new PrismaClient();
  try {
    const resultado = await criarClienteEUsuario(prisma, {
      clienteCodigo: String(texto('BOOTSTRAP_CLIENTE_CODIGO')),
      clienteNome: String(texto('BOOTSTRAP_CLIENTE_NOME')),
      login: String(texto('BOOTSTRAP_USUARIO_LOGIN')),
      nome: String(texto('BOOTSTRAP_USUARIO_NOME')),
      senha: String(texto('BOOTSTRAP_USUARIO_SENHA')),
    });

    // Diz o que aconteceu, nunca a credencial. Nem senha, nem hash, nem id,
    // nem a URL do banco — saída de terminal vai parar em log e em captura de
    // tela com muito mais frequência do que se imagina.
    console.log('auth:bootstrap:local — OK');
    console.log(`  cliente '${texto('BOOTSTRAP_CLIENTE_CODIGO')}': ${resultado.clienteCriado ? 'criado' : 'já existia'}`);
    console.log(`  usuário '${texto('BOOTSTRAP_USUARIO_LOGIN')}': criado`);
    console.log('  a senha não é exibida. Use a que você definiu em BOOTSTRAP_USUARIO_SENHA.');
  } catch (erro) {
    falhar(erro instanceof Error ? erro.message : 'erro desconhecido no bootstrap');
  } finally {
    await prisma.$disconnect();
  }
};

// Só executa quando chamado como script. Importado pelo teste, apenas expõe
// `criarClienteEUsuario` — sem isso o teste dispararia o processo inteiro.
if (process.argv[1] && process.argv[1].endsWith('bootstrap-local.mjs')) {
  await principal();
}
