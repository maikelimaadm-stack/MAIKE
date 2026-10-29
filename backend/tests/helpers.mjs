/**
 * Utilidades dos testes de backend.
 *
 * Os testes rodam contra um PostgreSQL **real**. Não há mock de Prisma: o que
 * precisa ser provado aqui — isolamento entre tenants, atomicidade da sequência
 * sob concorrência, violação de unique virando código estável — só existe de
 * verdade no banco. Um mock provaria que o mock funciona.
 */

import { randomUUID } from 'node:crypto';

import { construirApp } from '../src/app.js';
import { getPrismaClient, closePrismaClient } from '../src/database/prismaClient.js';
import { gerarSenhaHash } from '../src/modules/auth/authService.js';
import { criarProprietarioInicial } from '../src/modules/adminMaike/adminService.js';
import { zerarLimitadorAdmin } from '../src/modules/adminMaike/adminSessao.js';
import { codigoTotp, passoTotpAtual } from '../src/modules/adminMaike/adminCrypto.js';

/** Ordem de limpeza respeita as foreign keys (tudo é Restrict). */
const ORDEM_DE_LIMPEZA = [
  'auditoriaCatalogoGlobal',
  // D-PROD-70 — identidade do produto (sem tenant).
  'eventoSegurancaAdminMaike',
  'codigoRecuperacaoAdminMaike',
  'sessaoAdminMaike',
  'adminPrincipalMaike',
  'catalogoRegraMistoCategoria',
  'catalogoRegraMisto',
  'catalogoIcone',
  'catalogoAsset',
  'catalogoCategoriaVisual',
  'catalogoTipoEntidade',
  'operadorProdutoMaike',
  'catalogoMeta',
  'auditLog',
  'registroAnexo',
  // P5.5 — documentos JSON tenant-scoped (Restrict → Cliente).
  'bebedouroAlerta',
  'bebedouroSanidade',
  'bebedouroHistorico',
  'aplicacaoMedicamento',
  'eventoSanitario',
  'manejoTecnicoRebanho',
  'suplementacaoLote',
  'suplementacaoEvento',
  'movimentacaoPecuaria',
  'movimentacaoMapa',
  // P4.3 — geografia referencia Cliente com Restrict; limpar antes da raiz.
  'pontoReferencia',
  'linhaGeografica',
  'configuracaoIcone',
  // `areaPastagem` antes de `setor`: a FK composta é Restrict, e apagar setor
  // com área ainda pendurada falha — que é exatamente o que ela existe para
  // fazer (P4.2).
  'movimentacaoEstoque',
  'estoqueLoteNota',
  'pontoSuplementacao',
  'bebedouro',
  'fornecedor',
  'categoriaManejo',
  'permissao',
  'empresa',
  'produto',
  'localEstoque',
  'categoria',
  'historicoLancamentoTarefa',
  'lancamentoTarefa',
  'lote',
  'areaPastagem',
  'marca',
  'unidadeMedida',
  // P5.0 — TipoTarefa referencia GrupoAtividade (FK composta, Restrict).
  'tipoTarefa',
  'grupoAtividade',
  'setor',
  'operacaoIdempotente',
  'entidadeCodigoSequencia',
  'usuario',
  'cliente',
];

export const limparBanco = async () => {
  const prisma = getPrismaClient();
  zerarLimitadorAdmin();
  for (let pass = 0; pass < 8; pass += 1) {
    const removidas = await prisma.categoria.deleteMany({
      where: { categoria_pai_id: { not: null } },
    });
    if (removidas.count === 0) break;
  }
  // CategoriaManejo (tenant) referencia CatalogoCategoriaVisual (global), que é
  // limpo antes dela na ordem abaixo: solta o vínculo opcional primeiro.
  await prisma.categoriaManejo.updateMany({
    where: { catalogo_categoria_visual_id: { not: null } },
    data: { catalogo_categoria_visual_id: null },
  });
  for (const model of ORDEM_DE_LIMPEZA) {
    await prisma[model].deleteMany({});
  }
};

export const encerrar = async () => {
  await closePrismaClient();
};

/**
 * Cria um tenant com um usuário, prontos para autenticar.
 * @param {{codigo?: string, login?: string, senha?: string}} [opcoes]
 */
export const criarTenant = async (opcoes = {}) => {
  const prisma = getPrismaClient();
  const codigo = opcoes.codigo || `t-${randomUUID().slice(0, 8)}`;
  // Login único global entre ativos (D-PROD-35): default por tenant evita colisão
  // acidental quando o teste não passa `login` explícito.
  const login = opcoes.login ?? `operador-${codigo}`;
  const senha = opcoes.senha || 'senha-de-teste-1';

  const cliente = await prisma.cliente.create({
    data: { codigo, nome: `Tenant ${codigo}` },
  });

  const usuario = await prisma.usuario.create({
    data: {
      cliente_id: cliente.id,
      nome: 'Operador de Teste',
      login,
      senha_hash: await gerarSenhaHash(senha),
    },
  });

  return { cliente, usuario, credenciais: { login, senha } };
};

/** Monta o app sem abrir porta. */
export const criarApp = async () => construirApp({ logger: false });

/**
 * Autentica e devolve o token.
 * @param {import('fastify').FastifyInstance} app
 * @param {{login: string, senha: string}} credenciais
 */
export const autenticarNoApp = async (app, credenciais) => {
  const resposta = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: credenciais,
  });
  return { resposta, corpo: resposta.json() };
};

// ─── MAIKE Admin (D-PROD-70) ───────────────────────────────────────────────

/** Origin do app admin aceita fora de produção (ver `originsAdminPermitidas`). */
export const ORIGEM_ADMIN = 'http://localhost:5174';

/** @param {import('light-my-request').Response} resposta @returns {string|null} `nome=valor` do cookie admin */
export const cookieAdminDe = (resposta) => {
  const bruto = resposta.headers['set-cookie'];
  const lista = Array.isArray(bruto) ? bruto : bruto ? [String(bruto)] : [];
  const c = lista.find((x) => x.startsWith('maike_admin='));
  return c ? c.split(';')[0] : null;
};

/**
 * Cria o proprietário, faz login, inscreve o TOTP e devolve uma sessão
 * VERIFICADA pronta para as rotas admin. `proximoCodigo()` gera um TOTP ainda
 * não usado (passo seguinte), para reautenticações.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {{ login?: string, senha?: string }} [opcoes]
 */
export const criarAdminComSessao = async (app, opcoes = {}) => {
  const login = opcoes.login ?? 'dono.maike';
  const senha = opcoes.senha ?? 'senha-forte-do-dono-1';
  const admin = await criarProprietarioInicial({ login, senha });
  const base = { origin: ORIGEM_ADMIN };
  const r1 = await app.inject({ method: 'POST', url: '/admin-maike/auth/login', headers: base, payload: { login, senha } });
  if (r1.statusCode !== 200) throw new Error(`login admin falhou: ${r1.statusCode} ${r1.body}`);
  const pre = { ...base, cookie: cookieAdminDe(r1), 'x-maike-admin-csrf': r1.json().csrf_token };
  const insc = await app.inject({ method: 'POST', url: '/admin-maike/mfa/inscricao', headers: pre, payload: {} });
  const segredo = insc.json().segredo;
  let passo = passoTotpAtual();
  const r2 = await app.inject({
    method: 'POST',
    url: '/admin-maike/mfa/confirmar',
    headers: pre,
    payload: { codigo: codigoTotp(segredo, passo) },
  });
  if (r2.statusCode !== 200) throw new Error(`MFA admin falhou: ${r2.statusCode} ${r2.body}`);
  const headers = { ...base, cookie: cookieAdminDe(r2), 'x-maike-admin-csrf': r2.json().csrf_token };
  // Simula "próxima janela de 30 s": libera o passo atual e devolve o código dele.
  const proximoCodigo = async () => {
    passo = passoTotpAtual();
    await getPrismaClient().adminPrincipalMaike.update({
      where: { id: admin.id },
      data: { mfa_ultimo_passo: passo - 2 },
    });
    return codigoTotp(segredo, passo);
  };
  return { admin, login, senha, segredo, headers, codigosRecuperacao: r2.json().codigos_recuperacao, proximoCodigo };
};
