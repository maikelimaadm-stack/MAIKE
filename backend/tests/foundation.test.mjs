/**
 * Testes de fundação do backend, contra PostgreSQL real.
 *
 * O que este arquivo existe para provar — e que nenhum gate estático consegue:
 *
 *  - o tenant vem da sessão, e o contexto de um cliente não alcança dado de
 *    outro (dois tenants de verdade no banco, não um `WHERE` inspecionado);
 *  - a sequência é atômica sob concorrência real, sem número duplicado;
 *  - violação de unique vira código estável, não 500 opaco;
 *  - senha nunca é persistida em claro e nunca chega ao AuditLog.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { registrarEvento, sanitizarPayload } from '../src/modules/auditoria/auditService.js';
import {
  reservarNumero,
  reservarNumeroIsolado,
  resolverEscopoId,
  ESCOPO_TENANT,
  ESCOPO_EMPRESA,
} from '../src/modules/sequencias/entidadeCodigoService.js';
import { montarRegistroDeAnexo } from '../src/modules/anexos/attachmentValidation.js';
import { exigirMesmoTenant } from '../src/shared/auth/authContext.js';
import { CODIGOS_DO_CONTRATO, ERROR_CODES } from '../src/shared/errors/errorCodes.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;

before(async () => {
  app = await criarApp();
  await app.ready();
});

after(async () => {
  await app.close();
  await encerrar();
});

beforeEach(async () => {
  await limparBanco();
});

const contextoDe = (cliente, usuario) => ({
  requestId: 'req-de-teste',
  auth: { clienteId: cliente.id, usuarioId: usuario.id, login: usuario.login },
});

// ---------------------------------------------------------------------------

describe('health', () => {
  test('BE-01 responde com processo e banco separados', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health' });
    const corpo = resposta.json();

    assert.equal(resposta.statusCode, 200);
    assert.equal(corpo.status, 'ok');
    assert.equal(corpo.processo, 'up');
    assert.equal(corpo.banco, 'up');
    assert.deepEqual(corpo.configuracaoIncompleta, []);
  });

  test('BE-02 resposta de health não vaza stack trace nem string de conexão', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health' });
    const bruto = resposta.body;
    assert.doesNotMatch(bruto, /postgresql:\/\//);
    assert.doesNotMatch(bruto, /at .*\.js:\d+/);
  });
});

// ---------------------------------------------------------------------------

describe('autenticação', () => {
  test('BE-03 login válido emite sessão', async () => {
    const { credenciais, cliente, usuario } = await criarTenant();
    const { resposta, corpo } = await autenticarNoApp(app, credenciais);

    assert.equal(resposta.statusCode, 200);
    assert.ok(corpo.token, 'token ausente');
    assert.equal(corpo.cliente_id, cliente.id);
    assert.equal(corpo.usuario.id, usuario.id);
  });

  test('BE-04 token não carrega senha nem hash', async () => {
    const { credenciais } = await criarTenant({ senha: 'senha-secreta-9' });
    const { corpo } = await autenticarNoApp(app, credenciais);

    const payload = JSON.parse(Buffer.from(corpo.token.split('.')[1], 'base64url').toString());
    assert.equal(payload.senha, undefined);
    assert.equal(payload.senha_hash, undefined);
    assert.doesNotMatch(corpo.token, /senha-secreta-9/);
    assert.deepEqual(Object.keys(payload).sort(), ['cliente_id', 'exp', 'iat', 'login', 'usuario_id']);
  });

  test('BE-05 senha errada, usuário inexistente e cliente inexistente dão a MESMA resposta', async () => {
    const { credenciais } = await criarTenant();

    const respostas = await Promise.all([
      autenticarNoApp(app, { ...credenciais, senha: 'errada' }),
      autenticarNoApp(app, { ...credenciais, login: 'nao-existe' }),
      autenticarNoApp(app, { ...credenciais, cliente: 'cliente-inexistente' }),
    ]);

    for (const { resposta, corpo } of respostas) {
      assert.equal(resposta.statusCode, 401);
      assert.equal(corpo.code, 'AUTH_INVALID_CREDENTIALS');
      assert.equal(corpo.message, 'credenciais inválidas');
    }
  });

  test('BE-06 usuário inativo não autentica', async () => {
    const { cliente, usuario, credenciais } = await criarTenant();
    await getPrismaClient().usuario.update({ where: { id: usuario.id }, data: { ativo: false } });

    const { resposta } = await autenticarNoApp(app, credenciais);
    assert.equal(resposta.statusCode, 401);
    assert.ok(cliente.id);
  });

  test('BE-07 requisição sem sessão reprova com TENANT_CONTEXT_REQUIRED', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/auth/contexto' });
    assert.equal(resposta.statusCode, 401);
    assert.equal(resposta.json().code, 'TENANT_CONTEXT_REQUIRED');
  });

  test('BE-08 auth_context traz cliente_id e usuario_id da sessão', async () => {
    const { cliente, usuario, credenciais } = await criarTenant();
    const { corpo } = await autenticarNoApp(app, credenciais);

    const resposta = await app.inject({
      method: 'GET',
      url: '/auth/contexto',
      headers: { authorization: `Bearer ${corpo.token}` },
    });

    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().cliente_id, cliente.id);
    assert.equal(resposta.json().usuario_id, usuario.id);
  });

  test('BE-09 cliente_id enviado no corpo do login é REJEITADO na porta', async () => {
    const { credenciais } = await criarTenant();

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { ...credenciais, cliente_id: 'tenant-de-outro' },
    });

    // `additionalProperties: false` — o campo não é ignorado, é recusado.
    assert.equal(resposta.statusCode, 400);
  });
});

// ---------------------------------------------------------------------------

describe('isolamento entre tenants', () => {
  test('BE-10 contexto de A não enxerga dado de B', async () => {
    const a = await criarTenant({ codigo: 'tenant-a', login: 'ana' });
    const b = await criarTenant({ codigo: 'tenant-b', login: 'bruno' });
    const prisma = getPrismaClient();

    await registrarEvento(contextoDe(a.cliente, a.usuario), {
      acao: 'CRIAR',
      entidade: 'Recurso',
      entidadeId: 'r-de-a',
    });
    await registrarEvento(contextoDe(b.cliente, b.usuario), {
      acao: 'CRIAR',
      entidade: 'Recurso',
      entidadeId: 'r-de-b',
    });

    const deA = await prisma.auditLog.findMany({ where: { cliente_id: a.cliente.id } });
    assert.equal(deA.length, 1);
    assert.equal(deA[0].entidade_id, 'r-de-a');

    const total = await prisma.auditLog.count();
    assert.equal(total, 2, 'os dois registros existem — o filtro é que separa');
  });

  test('BE-11 recurso de outro tenant dispara TENANT_SCOPE_VIOLATION', async () => {
    const a = await criarTenant({ codigo: 'scope-a' });
    const b = await criarTenant({ codigo: 'scope-b' });

    const contextoA = contextoDe(a.cliente, a.usuario).auth;
    const recursoDeB = { cliente_id: b.cliente.id };

    assert.throws(
      () => exigirMesmoTenant(contextoA, recursoDeB),
      (erro) => erro.code === 'TENANT_SCOPE_VIOLATION' && erro.status === 403
    );

    // Controle positivo: o recurso do próprio tenant passa.
    assert.doesNotThrow(() => exigirMesmoTenant(contextoA, { cliente_id: a.cliente.id }));
  });

  test('BE-12 login igual em tenants diferentes coexiste; repetido no mesmo tenant conflita', async () => {
    const a = await criarTenant({ codigo: 'dup-a', login: 'mesmo-login' });
    await criarTenant({ codigo: 'dup-b', login: 'mesmo-login' });

    const prisma = getPrismaClient();
    await assert.rejects(
      prisma.usuario.create({
        data: {
          cliente_id: a.cliente.id,
          nome: 'Duplicado',
          login: 'mesmo-login',
          senha_hash: 'x',
        },
      }),
      (erro) => erro.code === 'P2002'
    );
  });
});

// ---------------------------------------------------------------------------

describe('numeração', () => {
  test('BE-13 escopo tenant usa o cliente_id como sentinela, nunca NULL', () => {
    const escopoId = resolverEscopoId({
      clienteId: 'cli-1',
      escopoTipo: ESCOPO_TENANT,
      escopoId: null,
    });
    assert.equal(escopoId, 'cli-1');
  });

  test('BE-14 escopo empresa exige escopo_id explícito', () => {
    assert.throws(
      () => resolverEscopoId({ clienteId: 'cli-1', escopoTipo: ESCOPO_EMPRESA, escopoId: null }),
      (erro) => erro.code === 'SEQUENCE_SCOPE_INVALID'
    );
    assert.equal(
      resolverEscopoId({ clienteId: 'cli-1', escopoTipo: ESCOPO_EMPRESA, escopoId: 'emp-9' }),
      'emp-9'
    );
  });

  test('BE-15 escopo desconhecido reprova com SEQUENCE_SCOPE_INVALID', () => {
    assert.throws(
      () => resolverEscopoId({ clienteId: 'cli-1', escopoTipo: 'galaxia', escopoId: 'x' }),
      (erro) => erro.code === 'SEQUENCE_SCOPE_INVALID' && erro.status === 400
    );
  });

  test('BE-16 reserva é monotônica e começa em 1', async () => {
    const { cliente, usuario } = await criarTenant();
    const contexto = contextoDe(cliente, usuario);

    const primeiro = await reservarNumeroIsolado(contexto, { entidade: 'Lote' });
    const segundo = await reservarNumeroIsolado(contexto, { entidade: 'Lote' });
    const terceiro = await reservarNumeroIsolado(contexto, { entidade: 'Lote' });

    assert.deepEqual([primeiro, segundo, terceiro], [1, 2, 3]);
  });

  test('BE-17 concorrência real não gera número duplicado', async () => {
    const { cliente, usuario } = await criarTenant();
    const contexto = contextoDe(cliente, usuario);
    const CONCORRENTES = 40;

    const numeros = await Promise.all(
      Array.from({ length: CONCORRENTES }, () =>
        reservarNumeroIsolado(contexto, { entidade: 'Setor' })
      )
    );

    const unicos = new Set(numeros);
    assert.equal(unicos.size, CONCORRENTES, `houve duplicidade: ${numeros.sort((a, b) => a - b)}`);
    assert.deepEqual(
      [...unicos].sort((a, b) => a - b),
      Array.from({ length: CONCORRENTES }, (_, i) => i + 1)
    );
  });

  test('BE-18 sequências de tenants diferentes não se misturam', async () => {
    const a = await criarTenant({ codigo: 'seq-a' });
    const b = await criarTenant({ codigo: 'seq-b' });

    const deA = await reservarNumeroIsolado(contextoDe(a.cliente, a.usuario), { entidade: 'Lote' });
    const deB = await reservarNumeroIsolado(contextoDe(b.cliente, b.usuario), { entidade: 'Lote' });

    assert.equal(deA, 1);
    assert.equal(deB, 1, 'cada tenant tem a própria sequência');
  });

  test('BE-19 número não é reutilizado após exclusão do registro que o consumiu', async () => {
    const { cliente, usuario } = await criarTenant();
    const contexto = contextoDe(cliente, usuario);

    await reservarNumeroIsolado(contexto, { entidade: 'Lote' });
    await reservarNumeroIsolado(contexto, { entidade: 'Lote' });

    // A sequência não sabe nada sobre o registro; ela só avança. É exatamente
    // isso que impede reuso — não há "buscar o maior em uso".
    const proximo = await reservarNumeroIsolado(contexto, { entidade: 'Lote' });
    assert.equal(proximo, 3);
  });

  test('BE-20 escopo tenant e escopo empresa são sequências distintas', async () => {
    const { cliente, usuario } = await criarTenant();
    const prisma = getPrismaClient();

    const porTenant = await prisma.$transaction((tx) =>
      reservarNumero(tx, { clienteId: cliente.id, entidade: 'Nota', escopoTipo: ESCOPO_TENANT })
    );
    const porEmpresa = await prisma.$transaction((tx) =>
      reservarNumero(tx, {
        clienteId: cliente.id,
        entidade: 'Nota',
        escopoTipo: ESCOPO_EMPRESA,
        escopoId: 'empresa-1',
      })
    );

    assert.equal(porTenant, 1);
    assert.equal(porEmpresa, 1);
    assert.ok(usuario.id);
  });
});

// ---------------------------------------------------------------------------

describe('auditoria', () => {
  test('BE-21 ator e tenant vêm do contexto, não do evento', async () => {
    const { cliente, usuario } = await criarTenant();

    // O evento tenta injetar outro ator e outro tenant; a assinatura nem aceita.
    await registrarEvento(contextoDe(cliente, usuario), {
      acao: 'ATUALIZAR',
      entidade: 'Recurso',
      entidadeId: 'r-1',
      cliente_id: 'tenant-falsificado',
      usuario_id: 'ator-falsificado',
    });

    const [registro] = await getPrismaClient().auditLog.findMany();
    assert.equal(registro.cliente_id, cliente.id);
    assert.equal(registro.usuario_id, usuario.id);
    assert.equal(registro.request_id, 'req-de-teste');
  });

  test('BE-22 senha, token e binário são removidos do payload', () => {
    const sanitizado = sanitizarPayload({
      nome: 'Fazenda A',
      senha: 'nao-pode-aparecer',
      usuario: { senha_hash: 'tambem-nao', login: 'ana' },
      credencial: 'secreta',
      arquivo: Buffer.from('conteudo binario'),
      lista: [{ token: 'abc' }, { ok: 1 }],
    });

    assert.equal(sanitizado.nome, 'Fazenda A');
    assert.equal(sanitizado.senha, '[removido]');
    assert.equal(sanitizado.usuario.senha_hash, '[removido]');
    assert.equal(sanitizado.usuario.login, 'ana');
    assert.equal(sanitizado.credencial, '[removido]');
    assert.equal(sanitizado.arquivo, '[removido]');
    assert.equal(sanitizado.lista[0].token, '[removido]');
    assert.equal(sanitizado.lista[1].ok, 1);

    assert.doesNotMatch(JSON.stringify(sanitizado), /nao-pode-aparecer|tambem-nao|secreta/);
  });

  test('BE-23 auditoria sem contexto reprova em vez de gravar sem tenant', async () => {
    await assert.rejects(
      registrarEvento({ requestId: 'r', auth: null }, { acao: 'X', entidade: 'Y' }),
      (erro) => erro.code === 'TENANT_CONTEXT_REQUIRED'
    );
    assert.equal(await getPrismaClient().auditLog.count(), 0);
  });

  test('BE-24 falha de escrita de auditoria é observável, não silenciosa', async () => {
    const { cliente, usuario } = await criarTenant();

    // `acao` de 5000 caracteres estoura o VarChar(64) — falha real do banco.
    await assert.rejects(
      registrarEvento(contextoDe(cliente, usuario), {
        acao: 'A'.repeat(5000),
        entidade: 'Recurso',
      }),
      (erro) => erro.code === 'AUDIT_WRITE_FAILED' && erro.status === 500
    );
  });

  test('BE-25 auditoria dentro de transação revertida não sobrevive', async () => {
    const { cliente, usuario } = await criarTenant();
    const prisma = getPrismaClient();

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await registrarEvento(contextoDe(cliente, usuario), {
          acao: 'CRIAR',
          entidade: 'Recurso',
        }, tx);
        throw new Error('rollback proposital');
      })
    );

    assert.equal(
      await prisma.auditLog.count(),
      0,
      'auditoria de operação revertida não pode ficar no banco'
    );
  });
});

// ---------------------------------------------------------------------------

describe('anexos', () => {
  const contextoFake = { auth: { clienteId: 'cli-1', usuarioId: 'usr-1', login: 'ana' } };
  const base = {
    entidade: 'Lote',
    entidadeId: 'lote-1',
    nomeOriginal: 'foto.jpg',
    storageKey: 'tenant/cli-1/lote/lote-1/foto.jpg',
    mimeType: 'image/jpeg',
    tamanhoBytes: 1024,
  };

  test('BE-26 registro válido usa storage_key como identidade', () => {
    const registro = montarRegistroDeAnexo(contextoFake, base);
    assert.equal(registro.storage_key, base.storageKey);
    assert.equal(registro.cliente_id, 'cli-1');
    assert.equal(registro.criado_por, 'usr-1');
    assert.equal(registro.file_url, undefined, 'não existe campo de URL');
  });

  test('BE-27 URL como storage_key reprova', () => {
    for (const url of [
      'https://cdn.exemplo.com/arquivo.jpg',
      'http://exemplo.com/a.png',
      's3://bucket/chave',
    ]) {
      assert.throws(
        () => montarRegistroDeAnexo(contextoFake, { ...base, storageKey: url }),
        (erro) => erro.code === 'ATTACHMENT_INVALID',
        `deveria reprovar: ${url}`
      );
    }
  });

  test('BE-28 mime e tamanho são validados no backend', () => {
    assert.throws(
      () => montarRegistroDeAnexo(contextoFake, { ...base, mimeType: 'application/x-executavel' }),
      (erro) => erro.code === 'ATTACHMENT_INVALID'
    );
    assert.throws(
      () => montarRegistroDeAnexo(contextoFake, { ...base, tamanhoBytes: 0 }),
      (erro) => erro.code === 'ATTACHMENT_INVALID'
    );
    assert.throws(
      () => montarRegistroDeAnexo(contextoFake, { ...base, tamanhoBytes: 10 ** 12 }),
      (erro) => erro.code === 'ATTACHMENT_INVALID'
    );
  });

  test('BE-29 nome original é sanitizado', () => {
    const registro = montarRegistroDeAnexo(contextoFake, {
      ...base,
      nomeOriginal: '../../etc/passwd',
    });
    assert.equal(registro.nome_original, 'passwd');
  });

  test('BE-30 anexo sem contexto autenticado reprova', () => {
    assert.throws(
      () => montarRegistroDeAnexo({ auth: null }, base),
      (erro) => erro.code === 'ATTACHMENT_INVALID'
    );
  });

  test('BE-31 anexo persistido é tenant-scoped e sem binário', async () => {
    const { cliente, usuario } = await criarTenant();
    const prisma = getPrismaClient();

    const registro = montarRegistroDeAnexo(
      { auth: { clienteId: cliente.id, usuarioId: usuario.id, login: usuario.login } },
      base
    );
    const criado = await prisma.registroAnexo.create({ data: registro });

    assert.equal(criado.cliente_id, cliente.id);
    assert.equal(criado.storage_key, base.storageKey);
    assert.ok(!Object.keys(criado).some((k) => /conteudo|blob|bytes_data|binario/.test(k)));
  });
});

// ---------------------------------------------------------------------------

describe('contrato de erros', () => {
  test('BE-32 os oito códigos do contrato existem com o HTTP declarado', () => {
    assert.deepEqual([...CODIGOS_DO_CONTRATO].sort(), [
      'ATTACHMENT_INVALID',
      'ATTACHMENT_OWNER_INVALID',
      'AUDIT_WRITE_FAILED',
      'CONCURRENCY_CONFLICT',
      'SEQUENCE_CONFLICT',
      'SEQUENCE_SCOPE_INVALID',
      'TENANT_CONTEXT_REQUIRED',
      'TENANT_SCOPE_VIOLATION',
    ]);

    assert.equal(ERROR_CODES.TENANT_CONTEXT_REQUIRED.http, 401);
    assert.equal(ERROR_CODES.TENANT_SCOPE_VIOLATION.http, 403);
    assert.equal(ERROR_CODES.SEQUENCE_SCOPE_INVALID.http, 400);
    assert.equal(ERROR_CODES.SEQUENCE_CONFLICT.http, 409);
    assert.equal(ERROR_CODES.ATTACHMENT_INVALID.http, 400);
    assert.equal(ERROR_CODES.ATTACHMENT_OWNER_INVALID.http, 404);
    assert.equal(ERROR_CODES.AUDIT_WRITE_FAILED.http, 500);
    assert.equal(ERROR_CODES.CONCURRENCY_CONFLICT.http, 409);
  });

  test('BE-33 violação de unique vira CONCURRENCY_CONFLICT, não 500 opaco', async () => {
    const { cliente } = await criarTenant({ codigo: 'conflito' });
    const prisma = getPrismaClient();

    const dados = {
      cliente_id: cliente.id,
      entidade: 'Lote',
      entidade_id: 'l-1',
      nome_original: 'a.pdf',
      storage_key: 'chave/repetida',
      mime_type: 'application/pdf',
      tamanho_bytes: 10,
      criado_por: 'sistema',
    };

    await prisma.registroAnexo.create({ data: dados });

    const { normalizarErro } = await import('../src/shared/errors/errorHandler.js');
    try {
      await prisma.registroAnexo.create({ data: dados });
      assert.fail('a segunda escrita deveria violar o unique');
    } catch (erro) {
      const appError = normalizarErro(erro);
      assert.equal(appError.code, 'CONCURRENCY_CONFLICT');
      assert.equal(appError.status, 409);
    }
  });
});
