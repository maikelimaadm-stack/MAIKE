#!/usr/bin/env node
/**
 * D-PROD-161 (MAIKE-ESTOQUE-P0-01) — PROVA DE USO REAL do motor físico único.
 *
 * No padrão de `e2e-lancamentos-real.mjs`: sobe o backend Fastify REAL
 * (`backend/src/server.js`) contra um PostgreSQL LOCAL, sobe o Vite apontando
 * para ele e conduz as telas reais pelo Playwright (Chromium com WebGL por
 * SwiftShader, porque o Mapa Geral é MapLibre). Depois de cada passo confere o
 * estado NO BANCO (Prisma): lotes, movimentos, `estoque_atual`, evento.
 *
 * Cada largura (1280 e 390 px) usa um tenant próprio, semeado aqui:
 *   - por Prisma: tenant, administrador real, empresa (fuso America/Sao_Paulo),
 *     fornecedor, natureza, setor, pasto com polígono, lote de 40 cabeças no
 *     pasto, locais "DEPÓSITO CENTRAL" e "DEPÓSITO RETIRO", produto
 *     "RAÇÃO PROTEICA P0" (Nutrição Animal, KG) com `estoque_atual = 0` e
 *     nenhum lote, um depósito de suplementação no DEPÓSITO CENTRAL e um cocho
 *     no pasto ligado a esse depósito;
 *   - pela API REAL (motor): perfil financeiro e DUAS compras confirmadas no
 *     DEPÓSITO CENTRAL — 100 kg × 2,00 (dia −20, NF-P0-1) e 200 kg × 3,50
 *     (dia −10, NF-P0-2). O saldo só nasce de ENTRADA (o cadastro não credita).
 *
 * Roteiro, em cada largura:
 *   1. Produtos: o formulário (consulta, edição e "Novo") mostra o aviso
 *      "Estoque é alterado em Entradas/Movimentações, não no Cadastro de
 *      Produtos" e não tem campo de saldo; a edição informativa (descrição e
 *      preço de custo) grava pelo PATCH real SEM
 *      `estoque_atual` no corpo; no banco o cache, os lotes (custo 2,0000 e
 *      3,5000 intactos: I6) e os movimentos ficam iguais.
 *   2. Mapa Geral → cocho → "Lançar": suplementação de 120 kg pela tela. No
 *      banco: 1 Saída `suplementacao` de 120,0000 kg, FIFO em 2 camadas
 *      (100 @2,0000 + 20 @3,5000 = 270,0000; unitário 2,2500), `lotes_consumidos`
 *      e `modo_saida_fifo` gravados, unidade KG, número definitivo, nome do
 *      local vindo do banco, camada 1 'Esgotado', camada 2 com 180,0000,
 *      `estoque_atual` 180,0000; o evento do cocho aponta para o movimento.
 *   3. Mapa Geral → depósito → "Saída": transferência de 50 kg para o DEPÓSITO
 *      RETIRO pela tela. No banco: par Saída/Entrada com pai/filho e números
 *      n/n+1; camada 2 com 130,0000; camada nova no destino com 50,0000 @3,5000,
 *      a MESMA `data_documento` e a MESMA procedência da camada de origem e
 *      `movimentacao_entrada_id` = Entrada; `lotes_consumidos` da Saída com
 *      `lote_destino_id`; total global conservado (180,0000) e `estoque_atual`
 *      igual (a transferência não mexe no cache).
 *   Em toda captura: sem rolagem horizontal da página nem diálogo fora da tela.
 *   Toda resposta ≥ 400 da API real vista pelas telas é divergência.
 *
 * Uso:
 *   DATABASE_URL=postgresql://…@localhost:5433/maike_p0_e2e \
 *     node scripts/dev/e2e-estoque-p0.mjs [pasta-das-capturas]
 * Variáveis opcionais: E2E_API_PORT (3981), E2E_WEB_PORT (5289),
 * E2E_LARGURAS ("1280,390"). O banco precisa estar migrado
 * (`npm run prisma:deploy` com a mesma DATABASE_URL). Recusa banco que não seja
 * local. Encerra backend e Vite ao sair. Sai ≠ 0 em QUALQUER divergência.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { exigirBancoLocal } from './e2e-lancamentos-seed.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_PORT = Number(process.env.E2E_API_PORT || 3981);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5289);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maike-e2e-estoque-p0'));
const LARGURAS = String(process.env.E2E_LARGURAS || '1280,390')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 320);
fs.mkdirSync(OUT, { recursive: true });

const DATABASE_URL = exigirBancoLocal();
const SENHA = 'senha-e2e-estoque-p0-1';
const AVISO = 'Estoque é alterado em Entradas/Movimentações, não no Cadastro de Produtos';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    chromium = null;
  }
}
if (!chromium) {
  console.error('playwright não encontrado: instale-o no ambiente para rodar o ensaio.');
  process.exit(2);
}

// ─── Processos (backend real + Vite) ────────────────────────────────────────
const processos = [];
const envLimpo = () => {
  const e = { ...process.env };
  for (const k of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'VERCEL_ENV']) delete e[k];
  return e;
};
const subir = (nome, comando, args, env, cwd = RAIZ) => {
  const log = fs.openSync(path.join(OUT, `${nome}.log`), 'w');
  const filho = spawn(comando, args, { cwd, env, stdio: ['ignore', log, log], detached: true });
  processos.push({ nome, filho });
  return filho;
};
const encerrarProcessos = async () => {
  for (const { filho } of processos.splice(0)) {
    if (filho.exitCode !== null || filho.signalCode !== null) continue;
    try {
      process.kill(-filho.pid, 'SIGTERM');
    } catch {
      /* já saiu */
    }
    const saiu = await Promise.race([new Promise((r) => filho.once('exit', () => r(true))), new Promise((r) => setTimeout(() => r(false), 5000))]);
    if (!saiu) {
      try {
        process.kill(-filho.pid, 'SIGKILL');
      } catch {
        /* já saiu */
      }
    }
  }
};
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    void encerrarProcessos().finally(() => process.exit(130));
  });
}
const esperarHttp = async (url, nome, ms = 90000) => {
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* ainda subindo */
    }
    for (const { nome: n, filho } of processos) {
      if (filho.exitCode !== null) throw new Error(`${n} saiu com código ${filho.exitCode} (veja ${path.join(OUT, `${n}.log`)})`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${nome} não respondeu em ${ms} ms (${url})`);
};

// ─── Asserções ──────────────────────────────────────────────────────────────
const falhas = [];
const passos = [];
class Divergencia extends Error {}
const conferir = (cond, msg) => {
  if (!cond) {
    falhas.push(msg);
    console.error(`  ✗ ${msg}`);
    return false;
  }
  return true;
};
const exigir = (cond, msg) => {
  if (!conferir(cond, msg)) throw new Divergencia(msg);
};
const igual = (real, esperado, msg) => conferir(String(real) === String(esperado), `${msg}: esperado ${esperado}, obtido ${real}`);
/** Decimal do Prisma (ou string) → texto com 4 casas, sem float. */
const d4 = (v) => (v == null ? null : typeof v === 'object' && typeof v.toFixed === 'function' ? v.toFixed(4) : String(v));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Dias ───────────────────────────────────────────────────────────────────
const FUSO = 'America/Sao_Paulo';
const hojeEm = (fuso) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const somarDias = (d, n) => {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const diaDe = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10));

// ─── Banco ──────────────────────────────────────────────────────────────────
process.env.DATABASE_URL = DATABASE_URL;
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const prisma = getPrismaClient();
const { gerarSenhaHash } = await import('../../backend/src/modules/auth/authService.js');

const esperarBanco = async (fn, descricao, ms = 20000) => {
  const ate = Date.now() + ms;
  let ultimo;
  while (Date.now() < ate) {
    ultimo = await fn();
    if (ultimo) return ultimo;
    await dormir(300);
  }
  return exigir(false, `banco não chegou ao estado esperado em ${ms} ms: ${descricao}`);
};
const lotesDoProduto = (s) =>
  prisma.estoqueLoteNota.findMany({
    where: { cliente_id: s.cliente_id, produto_id: s.produto.id },
    orderBy: [{ data_documento: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
/** Foto dos lotes e do cache do produto (prova de "nada mudou"). */
const fotoEstoque = async (s) => {
  const lotes = await lotesDoProduto(s);
  const p = await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.produto.id }, select: { estoque_atual: true } });
  const movs = await prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, produto_id: s.produto.id } });
  return JSON.stringify({
    cache: d4(p.estoque_atual),
    movs,
    lotes: lotes.map((l) => [l.id, d4(l.quantidade_entrada), d4(l.quantidade_disponivel), d4(l.custo_unitario), l.status, l.local_estoque_id, diaDe(l.data_documento)]),
  });
};
const somaDisponivel = async (s, extra = {}) => {
  const r = await prisma.estoqueLoteNota.aggregate({
    _sum: { quantidade_disponivel: true },
    where: { cliente_id: s.cliente_id, produto_id: s.produto.id, status: 'Disponivel', ...extra },
  });
  return r._sum.quantidade_disponivel ? r._sum.quantidade_disponivel.toFixed(4) : '0.0000';
};
const cacheDe = async (s) => d4((await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.produto.id } })).estoque_atual);

// ─── Sessão / API real ──────────────────────────────────────────────────────
const login = async (cred) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred) });
  const corpo = await r.json();
  if (r.status !== 200 || !corpo.token) throw new Error(`login falhou (${r.status}): ${JSON.stringify(corpo).slice(0, 200)}`);
  return corpo.token;
};
const api = async (token, metodo, caminho, corpo) => {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}), Origin: WEB },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* sem corpo */
  }
  return { status: r.status, corpo: json };
};

// ─── Semente ────────────────────────────────────────────────────────────────
/** Pasto quadrado em volta do centro padrão do mapa (lat −15,0067; lng −59,9533). */
const POLIGONO = [
  [-15.0047, -59.9553],
  [-15.0047, -59.9513],
  [-15.0087, -59.9513],
  [-15.0087, -59.9553],
];
const semear = async (rotulo) => {
  const sufixo = randomUUID().slice(0, 8);
  const loginDono = `dono-p0-${rotulo}-${sufixo}`;
  const senhaHash = await gerarSenhaHash(SENHA);
  const s = await prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.create({ data: { codigo: `e2e-est-p0-${rotulo}-${sufixo}`, nome: `FAZENDA ESTOQUE P0 ${rotulo}` } });
    const c = cliente.id;
    await tx.usuario.create({ data: { cliente_id: c, nome: 'DONO DA FAZENDA', login: loginDono, senha_hash: senhaHash, papel_tenant: 'administrador' } });
    const empresa = await tx.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'SEDE', nome: 'FAZENDA SANTA FÉ', fuso_horario: FUSO } });
    const base = { cliente_id: c, empresa_id: empresa.id };
    const fornecedor = await tx.fornecedor.create({ data: { ...base, numero_cadastro: '1', tipo_pessoa: 'Jurídica', nome: 'NUTRIÇÃO ANIMAL CERRADO', tipos: ['fornecedor'] } });
    const natureza = await tx.naturezaFinanceira.create({ data: { ...base, numero: '1', tipo: 'DESPESA', nome: 'SUPLEMENTOS' } });
    const setor = await tx.setor.create({ data: { ...base, numero_setor: '1', nome: 'RETIRO NORTE', tipo: 'Próprio' } });
    const area = await tx.areaPastagem.create({
      data: {
        ...base,
        setor_id: setor.id,
        setor_nome: setor.nome,
        numero_area: '1',
        nome: 'PASTO DO COCHO',
        tamanho_hectares: '18.0000',
        coordenadas: { coords: POLIGONO, cor: '#16a34a' },
      },
    });
    await tx.lote.create({
      data: {
        ...base,
        numero_lote: '1',
        nome: 'BOIS DE RECRIA P0',
        quantidade_cabecas: 40,
        quantidade_entrada: 40,
        categoria: 'Boi 13 a 24 meses',
        sexo: 'Macho',
        peso_medio_kg: '320.0000',
        setor_id: setor.id,
        setor_nome: setor.nome,
        area_entrada_id: area.id,
        area_entrada_nome: area.nome,
        area_atual_id: area.id,
        area_atual_nome: area.nome,
        data_entrada: new Date(`${somarDias(hojeEm(FUSO), -60)}T00:00:00.000Z`),
        motivo_entrada: 'Compra',
        status: 'Ativo',
      },
    });
    const localA = await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '1', nome: 'DEPÓSITO CENTRAL' } });
    const localB = await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '2', nome: 'DEPÓSITO RETIRO' } });
    // Cadastros que o formulário de Produto exige (categoria, unidade e local por nome).
    const categoria = await tx.categoria.create({ data: { cliente_id: c, numero_categoria: '1', nome: 'SUPLEMENTOS' } });
    await tx.unidadeMedida.create({ data: { cliente_id: c, numero_unidade: '1', sigla: 'KG', descricao: 'QUILOGRAMA' } });
    const produto = await tx.produto.create({
      data: {
        ...base,
        numero_produto: '1',
        nome_produto: 'RAÇÃO PROTEICA P0',
        tipo_uso: 'Nutrição Animal',
        codigo_interno: 'RP0',
        categoria: categoria.nome,
        unidade_medida: 'KG',
        unidade_principal_estoque: 'KG',
        local_estoque: localA.nome,
        preco_custo: '2.0000',
      },
    });
    const deposito = await tx.pontoSuplementacao.create({
      data: {
        ...base,
        numero_ponto: '1',
        nome_ponto: 'DEPÓSITO DA SEDE P0',
        sigla: 'DSP',
        categoria_ponto: 'DEPOSITO',
        tipo: 'Depósito',
        local_estoque_id: localA.id,
        local_estoque_nome: localA.nome,
        coordenadas: { lat: -15.0082, lng: -59.9521 },
        status: 'Ativo',
      },
    });
    const cocho = await tx.pontoSuplementacao.create({
      data: {
        ...base,
        numero_ponto: '2',
        nome_ponto: 'COCHO DO PASTO P0',
        sigla: 'CP0',
        categoria_ponto: 'COCHO',
        tipo: 'Cocho coberto',
        produto_padrao: produto.nome_produto,
        capacidade_cocho_kg: '500.0000',
        area_vinculada_id: area.id,
        area_vinculada_nome: area.nome,
        area_vinculada_ids: [area.id],
        area_vinculada_nomes: [area.nome],
        deposito_origem_id: deposito.id,
        deposito_origem_nome: deposito.nome_ponto,
        consumo_ideal_por_cabeca_kg: '0.5000',
        coordenadas: { lat: -15.0052, lng: -59.9545 },
        status: 'Ativo',
      },
    });
    return {
      cliente_id: c,
      credenciais: { login: loginDono, senha: SENHA },
      empresa: { id: empresa.id, nome: empresa.nome },
      fornecedor: { id: fornecedor.id, nome: fornecedor.nome },
      natureza: { id: natureza.id },
      area: { id: area.id, nome: area.nome },
      localA: { id: localA.id, nome: localA.nome },
      localB: { id: localB.id, nome: localB.nome },
      produto: { id: produto.id, nome: produto.nome_produto },
      deposito: { id: deposito.id, nome: deposito.nome_ponto },
      cocho: { id: cocho.id, nome: cocho.nome_ponto },
    };
  });
  return s;
};

/** Compra confirmada pela API real (o motor cria movimento + lote + cache). */
const comprar = async (s, token, { kg, preco, total, dia, doc }) => {
  const corpo = {
    empresa_id: s.empresa.id,
    direcao: 'PAGAR',
    conteudo: 'COM_PRODUTOS',
    condicao: 'PRAZO',
    parceiro_id: s.fornecedor.id,
    data_emissao: dia,
    data_operacional: dia,
    documento_referencia: doc,
    efeito_fisico_confirmado: true,
    itens: [{ tipo_item: 'MERCADORIA', produto_id: s.produto.id, local_estoque_id: s.localA.id, unidade: 'KG', quantidade: kg, valor_unitario: preco }],
    rateio_modo: 'PERCENTUAL',
    rateios: [{ natureza_id: s.natureza.id, percentual: '100' }],
    parcelas: [{ vencimento: somarDias(hojeEm(FUSO), 30), valor: total }],
    operation_id: randomUUID(),
  };
  const criado = await api(token, 'POST', '/operacoes-financeiras', corpo);
  exigir(criado.status === 201, `compra ${doc}: criar ${criado.status} ${JSON.stringify(criado.corpo).slice(0, 300)}`);
  const conf = await api(token, 'POST', `/operacoes-financeiras/${criado.corpo.id}/confirmar`, {
    empresa_id: s.empresa.id,
    operation_id: randomUUID(),
    versao: criado.corpo.versao,
  });
  exigir(conf.status === 200, `compra ${doc}: confirmar ${conf.status} ${JSON.stringify(conf.corpo).slice(0, 300)}`);
  return conf.corpo;
};

// ─── Roteiro por largura ────────────────────────────────────────────────────
const executarLargura = async (browser, largura) => {
  const rotulo = `w${largura}`;
  const movel = largura < 640;
  const s = await semear(rotulo);
  const token = await login(s.credenciais);
  const hoje = hojeEm(FUSO);
  const errosPagina = [];
  const respostasApi = [];
  const escritas = [];
  let n = 0;

  const passo = async (nome, fn) => {
    const antes = falhas.length;
    console.log(`\n[${rotulo}] ${nome}`);
    try {
      await fn();
    } catch (erro) {
      if (!(erro instanceof Divergencia)) falhas.push(`[${rotulo}] ${nome}: interrompido — ${String(erro?.message || erro).split('\n')[0]}`);
    }
    passos.push(`${falhas.length === antes ? '✓' : '✗'} [${rotulo}] ${nome}`);
    return falhas.length === antes;
  };

  // Estado inicial: cadastro sem saldo (o cadastro não credita).
  igual(await cacheDe(s), '0.0000', `[${rotulo}] produto recém-cadastrado nasce com estoque 0`);
  // Perfil financeiro + duas compras pela API real (o saldo nasce de ENTRADA).
  {
    const perfil = await api(token, 'PUT', '/perfis-financeiros-empresa', { empresa_id: s.empresa.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' });
    exigir(perfil.status === 200, `[${rotulo}] perfil financeiro: ${perfil.status} ${JSON.stringify(perfil.corpo).slice(0, 200)}`);
    await comprar(s, token, { kg: '100', preco: '2.00', total: '200.00', dia: somarDias(hoje, -20), doc: 'NF-P0-1' });
    await comprar(s, token, { kg: '200', preco: '3.50', total: '700.00', dia: somarDias(hoje, -10), doc: 'NF-P0-2' });
  }
  const [L1, L2] = await lotesDoProduto(s);
  exigir(L1 && L2, `[${rotulo}] as duas compras não criaram 2 lotes`);
  igual(
    [L1, L2].map((l) => `${d4(l.quantidade_disponivel)}@${d4(l.custo_unitario)}:${l.status}:${l.local_estoque_id === s.localA.id}`).join('|'),
    '100.0000@2.0000:Disponivel:true|200.0000@3.5000:Disponivel:true',
    `[${rotulo}] camadas das compras no DEPÓSITO CENTRAL`,
  );
  igual(await cacheDe(s), '300.0000', `[${rotulo}] estoque_atual depois das compras`);

  const ctx = await browser.newContext({
    viewport: { width: largura, height: movel ? 844 : 860 },
    deviceScaleFactor: 1,
    isMobile: movel,
    hasTouch: movel,
    locale: 'pt-BR',
    timezoneId: FUSO,
  });
  await ctx.addInitScript(
    ({ t, e, c }) => {
      try {
        if (!window.sessionStorage.getItem('maike_native_access_token')) window.sessionStorage.setItem('maike_native_access_token', t);
        if (!window.localStorage.getItem('empresa_selecionada_id')) {
          window.localStorage.setItem('empresa_selecionada_id', e);
          window.localStorage.setItem('empresa_selecionada_cliente_id', c);
        }
      } catch {
        /* sem storage */
      }
      window.__toasts = [];
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('[data-sonner-toast]')) {
          const txt = el.innerText;
          if (txt && !window.__toasts.includes(txt)) window.__toasts.push(txt);
        }
      }).observe(document, { childList: true, subtree: true, characterData: true });
    },
    { t: token, e: s.empresa.id, c: s.cliente_id },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errosPagina.push(String(e).slice(0, 300)));
  page.on('request', (r) => {
    if (r.url().startsWith(API) && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
      escritas.push({ metodo: r.method(), url: r.url().replace(API, ''), corpo: r.postData() || '' });
    }
  });
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.startsWith(API) || r.status() < 400) return;
    const item = { texto: `${r.request().method()} ${u.replace(API, '')} → ${r.status()}` };
    respostasApi.push(item);
    try {
      item.texto += ` ${(await r.text()).slice(0, 300)}`;
    } catch {
      /* sem corpo */
    }
  });
  page.setDefaultTimeout(20000);

  /** Toque (390) ou clique (1280) real, com hit-test; na falha, captura e diz QUAL ação. */
  const toque = async (loc, acao) => {
    try {
      await loc.waitFor({ state: 'visible', timeout: 15000 });
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      if (movel) await loc.tap({ timeout: 10000 });
      else await loc.click({ timeout: 10000 });
    } catch (erro) {
      await page.screenshot({ path: path.join(OUT, `falha-${rotulo}-${acao.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
      const diag = await page
        .evaluate(() => ({
          opcoes: [...document.querySelectorAll('[role="option"]')].map((o) => {
            const r = o.getBoundingClientRect();
            const oculto = o.closest('[aria-hidden="true"]');
            return `${o.textContent.trim().slice(0, 30)}@${Math.round(r.top)}x${Math.round(r.width)}${oculto ? ':aria-hidden' : ''}`;
          }),
          folhas: [...document.querySelectorAll('.mgs__lista, [role="listbox"]')].length,
          // O que está de fato por cima do centro da 1ª opção (hit-test do toque).
          porCima: (() => {
            const o = document.querySelector('[role="option"]');
            if (!o) return null;
            const r = o.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            const z = (x) => (x ? getComputedStyle(x).zIndex : null);
            const folha = o.closest('.mk-sheet, [class*="sheet"]');
            const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
            return { el: el ? `${el.tagName}.${String(el.className).slice(0, 40)}` : null, dentroDaOpcao: !!(el && o.contains(el)), zFolha: z(folha), zDialogo: z(dlg) };
          })(),
          dialogos: [...document.querySelectorAll('[role="dialog"]')].map((d) => (d.getAttribute('aria-label') || d.textContent || '').trim().slice(0, 30)),
        }))
        .catch(() => null);
      console.log(`  [${rotulo}] diagnóstico de "${acao}": ${JSON.stringify(diag)}`);
      throw new Error(`ação "${acao}" não executada: ${String(erro?.message || erro).split('\n')[0]}`);
    }
    await page.waitForTimeout(250);
  };
  const shot = async (etapa) => {
    n += 1;
    await page.waitForTimeout(400);
    const arquivo = `e2e-${rotulo}-${String(n).padStart(2, '0')}-${etapa}.png`;
    await page.screenshot({ path: path.join(OUT, arquivo), fullPage: false });
    const m = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 0).pop();
      const r = d ? d.getBoundingClientRect() : null;
      return { sw: document.documentElement.scrollWidth, vw: window.innerWidth, l: r ? r.left : 0, r: r ? r.right : 0 };
    });
    conferir(m.sw <= largura, `[${rotulo}] ${arquivo}: rolagem horizontal da página (${m.sw} > ${largura})`);
    conferir(m.l >= -1 && m.r <= m.vw + 1, `[${rotulo}] ${arquivo}: diálogo fora da tela (${Math.round(m.l)}..${Math.round(m.r)} de ${m.vw})`);
    return arquivo;
  };
  const toastsDesde = async (i) => (await page.evaluate(() => window.__toasts || [])).slice(i).join(' | ');
  const nToasts = async () => (await page.evaluate(() => (window.__toasts || []).length));

  try {
    // ── 1. Produtos ──────────────────────────────────────────────────────────
    await passo('1 Produtos: aviso visível, edição informativa sem campo de estoque, saldo intacto', async () => {
      const fotoAntes = await fotoEstoque(s);
      await page.goto(`${WEB}/produtos`, { waitUntil: 'domcontentloaded' });
      const linha = page.getByText(s.produto.nome, { exact: true }).filter({ visible: true }).first();
      await linha.waitFor();
      await shot('produtos-lista');
      await linha.dblclick();
      const aviso = page.getByTestId('aviso-estoque-cadastro');
      await aviso.waitFor({ state: 'visible' });
      igual((await aviso.innerText()).trim(), AVISO, `[${rotulo}] texto do aviso na consulta`);
      igual(await aviso.getAttribute('role'), 'note', `[${rotulo}] papel do aviso`);
      await shot('produto-consulta-aviso');
      await toque(page.getByRole('button', { name: 'Editar', exact: true }).filter({ visible: true }).first(), 'Editar produto');
      const form = page.getByTestId('b1-form-produto');
      await form.locator('textarea').first().waitFor({ state: 'visible' });
      exigir(await aviso.isVisible(), `[${rotulo}] aviso não visível na edição`);
      // Nenhum campo de SALDO no formulário. Os rótulos com "estoque" que podem
      // existir são cadastro, não quantidade: "Estoque Mínimo", "Local de Estoque"
      // e "Unidade principal de estoque".
      const rotulos = (await form.locator('label.mg-field__label').allInnerTexts()).map((t) => t.replace(/\s*\*\s*$/, '').trim());
      const deEstoque = rotulos.filter((t) => /estoque|saldo/i.test(t));
      const permitidos = /^(Estoque Mínimo|Local de Estoque|Unidade principal de estoque)$/i;
      conferir(deEstoque.every((t) => permitidos.test(t)), `[${rotulo}] campo de estoque/saldo no formulário: ${JSON.stringify(deEstoque)}`);
      conferir(!rotulos.some((t) => /estoque atual|saldo|^estoque$/i.test(t)), `[${rotulo}] campo "Estoque atual" no formulário: ${JSON.stringify(rotulos)}`);
      console.log(`  [${rotulo}] rótulos com "estoque" no formulário: ${JSON.stringify(deEstoque)}`);
      const campo = (re) => form.locator('.mg-field').filter({ has: page.locator('label.mg-field__label', { hasText: re }) }).locator('input, textarea').first();
      const descricao = `RAÇÃO DO COCHO, EDITADA NO E2E ${rotulo.toUpperCase()}`;
      await campo(/^Descrição/).fill(descricao);
      // I6: o preço de custo do cadastro é referência — não mexe em lote nem em
      // custo histórico. ACHADO PRÉ-EXISTENTE (fora da P0, também em main): a
      // máscara de moeda do formulário MOSTRA "999,00" mas guarda o texto cru e
      // grava outro número (ver pendências do relatório). Por isso aqui só se
      // prova que o preço MUDOU e que o estoque não mudou; o valor gravado é
      // registrado no log como evidência, sem virar asserção do defeito.
      await campo(/^Preço de Custo/).fill('99900');
      await page.waitForTimeout(300);
      const precoExibido = await campo(/^Preço de Custo/).inputValue();
      await shot('produto-edicao');
      const desde = escritas.length;
      const respostaPatch = page.waitForResponse((r) => r.url().startsWith(`${API}`) && r.request().method() === 'PATCH' && /\/produtos\//.test(r.url()), { timeout: 20000 });
      await toque(page.getByRole('button', { name: 'Salvar', exact: true }).filter({ visible: true }).first(), 'Salvar produto');
      const rp = await respostaPatch;
      igual(rp.status(), 200, `[${rotulo}] PATCH /produtos pela tela`);
      const patches = escritas.slice(desde).filter((e) => e.metodo === 'PATCH' && /\/produtos\//.test(e.url));
      exigir(patches.length === 1, `[${rotulo}] esperado 1 PATCH de produto, obtido ${patches.length}`);
      const corpo = JSON.parse(patches[0].corpo || '{}');
      conferir(!('estoque_atual' in corpo), `[${rotulo}] a tela mandou estoque_atual no PATCH: ${patches[0].corpo.slice(0, 200)}`);
      const prod = await esperarBanco(
        async () => {
          const p = await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.produto.id } });
          return p && p.descricao === descricao ? p : null;
        },
        'descrição do produto gravada',
      );
      conferir(d4(prod.preco_custo) !== '2.0000', `[${rotulo}] preço de custo não mudou (${d4(prod.preco_custo)})`);
      console.log(`  [${rotulo}] preço de custo: tela "${precoExibido}", gravado ${d4(prod.preco_custo)} (máscara pré-existente; ver relatório)`);
      igual(await fotoEstoque(s), fotoAntes, `[${rotulo}] cache, lotes e movimentos depois da edição informativa`);
      await shot('produto-salvo');
      // Cadastro novo: o mesmo aviso, sem campo de estoque (só abre; nada é gravado).
      const desdeNovo = escritas.length;
      await page.goto(`${WEB}/produtos`, { waitUntil: 'domcontentloaded' });
      await page.getByText(s.produto.nome, { exact: true }).filter({ visible: true }).first().waitFor();
      await toque(page.getByRole('button', { name: 'Novo', exact: true }).filter({ visible: true }).first(), 'Novo produto');
      await aviso.waitFor({ state: 'visible' });
      const rotulosNovo = (await form.locator('label.mg-field__label').allInnerTexts()).map((t) => t.replace(/\s*\*\s*$/, '').trim());
      conferir(!rotulosNovo.some((t) => /estoque atual|saldo|^estoque$/i.test(t)), `[${rotulo}] campo "Estoque atual" no cadastro novo: ${JSON.stringify(rotulosNovo)}`);
      await shot('produto-novo-aviso');
      // 1280: "Cancelar" na barra; 390: "Descartar" (✕) no cabeçalho do registro.
      await toque(page.getByRole('button', { name: /^(Cancelar|Descartar)$/ }).filter({ visible: true }).first(), 'Cancelar produto novo');
      igual(escritas.slice(desdeNovo).length, 0, `[${rotulo}] abrir/cancelar o cadastro novo não escreve nada`);
      igual(await fotoEstoque(s), fotoAntes, `[${rotulo}] estoque intacto depois do cadastro novo cancelado`);
    });

    // ── Mapa Geral ───────────────────────────────────────────────────────────
    const abrirMapa = async () => {
      await page.goto(`${WEB}/MapaGeral`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.maplibregl-canvas', { timeout: 45000 });
      await page.locator(`.mg-marker[title="${s.cocho.nome}"]`).waitFor({ state: 'attached', timeout: 45000 });
      await page.locator(`.mg-marker[title="${s.deposito.nome}"]`).waitFor({ state: 'attached', timeout: 45000 });
      await page.waitForTimeout(1500);
    };
    const abrirPonto = async (nome, tituloDialogo) => {
      await page.locator(`.mg-marker[title="${nome}"]`).first().dispatchEvent('click');
      await page.getByText(tituloDialogo, { exact: true }).first().waitFor({ state: 'visible' });
      await page.getByText(nome).filter({ visible: true }).first().waitFor();
      await page.waitForTimeout(800);
    };

    // ── 2. Suplementação de cocho ────────────────────────────────────────────
    await passo('2 Mapa → cocho → lançamento de suplementação de 120 kg (FIFO em 2 camadas pelo motor)', async () => {
      const movsAntes = await prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, produto_id: s.produto.id } });
      await abrirMapa();
      await shot('mapa');
      await abrirPonto(s.cocho.nome, 'Ponto de Suplementação');
      await shot('cocho-detalhes');
      await toque(page.getByRole('button', { name: 'Lançar', exact: true }).filter({ visible: true }).first(), 'Lançar no cocho');
      const dlg = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Salvar novo ciclo' }) }).last();
      await dlg.waitFor({ state: 'visible' });
      // O produto é escolhido sozinho (único com saldo no depósito do cocho).
      await dlg.getByText(s.produto.nome).first().waitFor({ state: 'visible' });
      const kg = dlg.locator('input[placeholder="0,00"]').first();
      await kg.fill('120');
      await page.waitForTimeout(400);
      await shot('cocho-lancamento-preenchido');
      const t0 = await nToasts();
      const desde = escritas.length;
      const respSaida = page.waitForResponse((r) => /comandos\/saida-suplementacao/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
      await toque(dlg.getByRole('button', { name: 'Salvar novo ciclo' }), 'Salvar novo ciclo');
      // Duração fora da faixa do cocho → a tela pede confirmação explícita.
      const confirmarDuracao = page.getByRole('button', { name: 'Salvar mesmo assim' });
      if (await confirmarDuracao.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) await toque(confirmarDuracao, 'Salvar mesmo assim');
      const rs = await respSaida;
      igual(rs.status(), 201, `[${rotulo}] comando de suplementação pela tela`);
      const corpoResp = await rs.json().catch(() => ({}));
      const movId = corpoResp?.movimentacao?.id;
      exigir(movId, `[${rotulo}] resposta do comando sem movimentacao.id`);
      await esperarBanco(async () => /registrada com sucesso/i.test(await toastsDesde(t0)), 'toast de sucesso da suplementação');
      const corpoEnviado = JSON.parse(escritas.slice(desde).find((e) => /saida-suplementacao/.test(e.url))?.corpo || '{}');
      igual(corpoEnviado.quantidade, 120, `[${rotulo}] kg enviados pela tela`);
      igual(corpoEnviado.local_origem_id, s.localA.id, `[${rotulo}] local de origem enviado pela tela`);
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: movId } });
      igual(
        [mov.tipo_movimentacao, mov.tipo_detalhado, mov.origem_sistema, d4(mov.quantidade), d4(mov.valor_total), d4(mov.valor_unitario), mov.unidade_medida, mov.modo_saida_fifo, mov.status].join(':'),
        'Saída:suplementacao:suplementacao:120.0000:270.0000:2.2500:KG:FIFO:Ativa',
        `[${rotulo}] movimento da suplementação`,
      );
      conferir(/^\d+$/.test(String(mov.numero_movimentacao)), `[${rotulo}] número do movimento não é definitivo: ${mov.numero_movimentacao}`);
      igual(`${mov.local_estoque_origem}:${mov.local_origem}`, `${s.localA.id}:${s.localA.nome}`, `[${rotulo}] local do movimento (do banco)`);
      igual(`${mov.ponto_suplementacao_id}:${mov.deposito_id}`, `${s.cocho.id}:${s.deposito.id}`, `[${rotulo}] cocho e depósito do movimento`);
      igual(diaDe(mov.data_movimentacao), hoje, `[${rotulo}] dia do movimento`);
      igual(
        JSON.stringify((mov.lotes_consumidos || []).map((f) => [f.lote_id === L1.id ? 'L1' : f.lote_id === L2.id ? 'L2' : f.lote_id, f.quantidade, f.custo_unitario])),
        JSON.stringify([['L1', '100.0000', '2.0000'], ['L2', '20.0000', '3.5000']]),
        `[${rotulo}] lotes_consumidos da suplementação`,
      );
      igual(
        (corpoResp.rateio || []).map((r) => `${r.lote_id === L1.id ? 'L1' : 'L2'}:${r.quantidade_consumida}:${r.custo_unitario}:${r.numero_documento}`).join('|'),
        `L1:100:2:${L1.numero_documento || 'S/N'}|L2:20:3.5:${L2.numero_documento || 'S/N'}`,
        `[${rotulo}] rateio devolvido à tela`,
      );
      const [l1, l2] = await lotesDoProduto(s);
      igual(`${d4(l1.quantidade_disponivel)}:${l1.status}|${d4(l2.quantidade_disponivel)}:${l2.status}`, '0.0000:Esgotado|180.0000:Disponivel', `[${rotulo}] camadas depois da suplementação`);
      igual(await cacheDe(s), '180.0000', `[${rotulo}] estoque_atual depois da suplementação`);
      igual(await somaDisponivel(s), '180.0000', `[${rotulo}] Σ lotes depois da suplementação (I1)`);
      igual(await prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, produto_id: s.produto.id } }), movsAntes + 1, `[${rotulo}] movimentos novos da suplementação`);
      const evento = await esperarBanco(
        async () => (await prisma.suplementacaoEvento.findMany({ where: { cliente_id: s.cliente_id } })).find((e) => e.dados?.movimentacao_estoque_id === movId) || null,
        'evento do cocho ligado ao movimento',
      );
      igual(`${evento.dados.ponto_suplementacao_id}:${evento.dados.quantidade_total_kg}`, `${s.cocho.id}:120`, `[${rotulo}] evento de suplementação`);
      const genericas = escritas.slice(desde).filter((e) => /\/(movimentacoes-estoque|estoque-lotes-nota|produtos)(\/[^/]+)?$/.test(e.url.split('?')[0]));
      igual(genericas.map((e) => `${e.metodo} ${e.url}`).join(', '), '', `[${rotulo}] escrita genérica de estoque disparada pela tela`);
      await page.keyboard.press('Escape').catch(() => {});
      await shot('cocho-apos-lancamento');
    });

    // ── 3. Transferência entre depósitos ─────────────────────────────────────
    await passo('3 Mapa → depósito → saída de 50 kg para o DEPÓSITO RETIRO (camada com data e procedência da origem)', async () => {
      const [, l2Antes] = await lotesDoProduto(s);
      const totalAntes = await somaDisponivel(s);
      const cacheAntes = await cacheDe(s);
      await abrirMapa();
      await abrirPonto(s.deposito.nome, 'Depósito de Suplementação');
      await shot('deposito-detalhes');
      await toque(page.getByRole('button', { name: 'Saída', exact: true }).filter({ visible: true }).first(), 'Saída do depósito');
      const dlg = page.getByRole('dialog').filter({ hasText: 'Saída do Depósito' }).last();
      await dlg.getByRole('button', { name: 'Salvar', exact: true }).waitFor({ state: 'visible' });
      await toque(dlg.locator('input[placeholder="BUSCAR LOCAL..."]').first(), 'abrir local de destino');
      // Bloqueio conhecido no celular (PRÉ-EXISTENTE: AutocompleteGenerico,
      // MobileSheet e o diálogo do depósito não mudaram na P0): a folha
      // "Local de Destino" abre ATRÁS do diálogo modal — fica aria-hidden e o
      // hit-test do centro da opção cai no diálogo. Registra o bloqueio exato.
      const opcaoDestino = page.getByRole('option', { name: new RegExp(s.localB.nome) }).filter({ visible: true }).first();
      if (!(await opcaoDestino.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false))) {
        const prova = await page.evaluate((nome) => {
          const o = [...document.querySelectorAll('[role="option"]')].find((x) => x.textContent.includes(nome));
          if (!o) return { existe: false };
          const r = o.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { existe: true, ariaHidden: !!o.closest('[aria-hidden="true"]'), coberta: !(el && o.contains(el)), porCima: el ? `${el.tagName}${el.closest('[role="dialog"]') ? ' dentro do diálogo modal' : ''}` : null };
        }, s.localB.nome);
        await shot('bloqueio-local-destino');
        exigir(
          false,
          `[${rotulo}] BLOQUEIO (pré-existente, fora da P0): a folha "Local de Destino" da Saída do Depósito abre atrás do diálogo modal — ${JSON.stringify(prova)}; a transferência pelo toque não é alcançável nesta largura`,
        );
      }
      await toque(page.getByRole('option', { name: new RegExp(s.localB.nome) }).filter({ visible: true }).first(), 'escolher DEPÓSITO RETIRO');
      await toque(dlg.getByRole('combobox').first(), 'abrir produto da transferência');
      await toque(page.getByRole('option', { name: new RegExp(s.produto.nome) }).filter({ visible: true }).first(), 'escolher produto da transferência');
      await dlg.getByText('180,000').first().waitFor({ state: 'visible' }).catch(() => {});
      const saldoTela = await dlg.getByText(/Saldo \(kg\):/).first().innerText();
      conferir(/180/.test(saldoTela.replace(/\./g, '')), `[${rotulo}] saldo do DEPÓSITO CENTRAL na transferência não mostra 180 kg: "${saldoTela}"`);
      await dlg.locator('input[type="number"]').first().fill('50');
      await shot('transferencia-preenchida');
      const t0 = await nToasts();
      const desde = escritas.length;
      const resp = page.waitForResponse((r) => /comandos\/transferencia-locais/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
      await toque(dlg.getByRole('button', { name: 'Salvar', exact: true }), 'Salvar transferência');
      const rt = await resp;
      igual(rt.status(), 201, `[${rotulo}] comando de transferência pela tela`);
      const corpoResp = await rt.json().catch(() => ({}));
      await esperarBanco(async () => /Transferência registrada/i.test(await toastsDesde(t0)), 'toast de sucesso da transferência');
      const corpoEnviado = JSON.parse(escritas.slice(desde).find((e) => /transferencia-locais/.test(e.url))?.corpo || '{}');
      igual(`${corpoEnviado.quantidade}:${corpoEnviado.local_origem_id === s.localA.id}:${corpoEnviado.local_destino_id === s.localB.id}`, '50:true:true', `[${rotulo}] corpo enviado pela tela`);
      const saida = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: corpoResp?.movimentacao_saida?.id ?? '-' } });
      const entrada = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: corpoResp?.movimentacao_entrada?.id ?? '-' } });
      exigir(saida && entrada, `[${rotulo}] par de movimentos da transferência não gravado`);
      igual(
        [saida.tipo_movimentacao, saida.tipo_detalhado, saida.origem_sistema, d4(saida.quantidade), d4(saida.valor_total), d4(saida.valor_unitario), saida.unidade_medida, saida.modo_saida_fifo].join(':'),
        'Saída:transferencia_enviada:deposito:50.0000:175.0000:3.5000:KG:FIFO',
        `[${rotulo}] Saída da transferência`,
      );
      igual(
        [entrada.tipo_movimentacao, entrada.tipo_detalhado, d4(entrada.quantidade), entrada.movimento_pai_id === saida.id, saida.movimento_filho_id === entrada.id].join(':'),
        'Entrada:transferencia_recebida:50.0000:true:true',
        `[${rotulo}] Entrada da transferência e ligação pai/filho`,
      );
      igual(corpoResp.movimentacao_saida?.movimento_filho_id, entrada.id, `[${rotulo}] movimento_filho_id na resposta`);
      igual(`${saida.local_estoque_origem}:${saida.local_origem}:${saida.local_estoque_destino}:${saida.local_destino}`, `${s.localA.id}:${s.localA.nome}:${s.localB.id}:${s.localB.nome}`, `[${rotulo}] locais do par (do banco)`);
      conferir(/^\d+$/.test(saida.numero_movimentacao) && Number(entrada.numero_movimentacao) === Number(saida.numero_movimentacao) + 1, `[${rotulo}] números do par: ${saida.numero_movimentacao}/${entrada.numero_movimentacao}`);
      const lotes = await lotesDoProduto(s);
      const destino = lotes.filter((l) => l.local_estoque_id === s.localB.id);
      exigir(destino.length === 1, `[${rotulo}] esperado 1 camada no DEPÓSITO RETIRO, obtido ${destino.length}`);
      const T = destino[0];
      igual(
        [d4(T.quantidade_entrada), d4(T.quantidade_disponivel), d4(T.custo_unitario), T.status, T.local_estoque_nome, T.movimentacao_entrada_id === entrada.id].join(':'),
        `50.0000:50.0000:3.5000:Disponivel:${s.localB.nome}:true`,
        `[${rotulo}] camada criada no destino`,
      );
      igual(diaDe(T.data_documento), diaDe(l2Antes.data_documento), `[${rotulo}] data_documento da camada de destino = da camada de origem`);
      conferir(diaDe(T.data_documento) > '2002-01-01', `[${rotulo}] data da camada de destino com o bug de 2001: ${diaDe(T.data_documento)}`);
      igual(
        [T.numero_documento, T.serie_documento, T.fornecedor_id, T.fornecedor_nome].map((v) => v ?? 'null').join('|'),
        [l2Antes.numero_documento, l2Antes.serie_documento, l2Antes.fornecedor_id, l2Antes.fornecedor_nome].map((v) => v ?? 'null').join('|'),
        `[${rotulo}] procedência copiada da camada de origem`,
      );
      igual(
        JSON.stringify((saida.lotes_consumidos || []).map((f) => [f.lote_id === L2.id ? 'L2' : f.lote_id, f.quantidade, f.custo_unitario, f.lote_destino_id === T.id])),
        JSON.stringify([['L2', '50.0000', '3.5000', true]]),
        `[${rotulo}] lotes_consumidos da Saída com lote_destino_id`,
      );
      const l2 = lotes.find((l) => l.id === L2.id);
      igual(`${d4(l2.quantidade_disponivel)}:${l2.status}`, '130.0000:Disponivel', `[${rotulo}] camada de origem depois da transferência`);
      igual(await somaDisponivel(s), totalAntes, `[${rotulo}] total global conservado`);
      igual(await somaDisponivel(s, { local_estoque_id: s.localA.id }), '130.0000', `[${rotulo}] saldo do DEPÓSITO CENTRAL`);
      igual(await somaDisponivel(s, { local_estoque_id: s.localB.id }), '50.0000', `[${rotulo}] saldo do DEPÓSITO RETIRO`);
      igual(await cacheDe(s), cacheAntes, `[${rotulo}] estoque_atual não muda na transferência`);
      const genericas = escritas.slice(desde).filter((e) => /\/(movimentacoes-estoque|estoque-lotes-nota|produtos)(\/[^/]+)?$/.test(e.url.split('?')[0]));
      igual(genericas.map((e) => `${e.metodo} ${e.url}`).join(', '), '', `[${rotulo}] escrita genérica de estoque disparada pela tela`);
      await page.waitForTimeout(800);
      await shot('deposito-apos-transferencia');
    });
  } finally {
    await dormir(500);
    if (errosPagina.length) falhas.push(`[${rotulo}] erros de página: ${errosPagina.slice(0, 3).join(' | ')}`);
    if (respostasApi.length) {
      console.log(`  [${rotulo}] respostas ≥400 da API (${respostasApi.length}):\n    ${respostasApi.slice(0, 16).map((r) => r.texto).join('\n    ')}`);
      for (const r of respostasApi) falhas.push(`[${rotulo}] resposta inesperada da API: ${r.texto.slice(0, 220)}`);
    }
    await ctx.close();
  }
};

// ─── Principal ──────────────────────────────────────────────────────────────
let codigo = 0;
try {
  const env = envLimpo();
  subir('backend', process.execPath, ['backend/src/server.js'], {
    ...env,
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
    DATABASE_URL,
    AUTH_SECRET: process.env.E2E_AUTH_SECRET || 'ci-only-ephemeral-signing-key',
    FRONTEND_ORIGINS: `${WEB},http://localhost:${WEB_PORT}`,
  });
  subir('vite', process.execPath, [path.join(RAIZ, 'node_modules/vite/bin/vite.js'), '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], {
    ...env,
    VITE_MAIKE_API_URL: API,
  });
  await esperarHttp(`${API}/health`, 'backend');
  await esperarHttp(`${WEB}/`, 'vite');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const largura of LARGURAS) await executarLargura(browser, largura);
  } finally {
    await browser.close();
  }
} catch (erro) {
  falhas.push(`ensaio interrompido: ${String(erro?.message || erro).split('\n')[0]}`);
} finally {
  await encerrarProcessos();
  await closePrismaClient();
}

console.log(`\n${passos.join('\n')}`);
console.log(`\nCapturas e logs em ${OUT}`);
if (falhas.length) {
  console.error(`\nDIVERGÊNCIAS (${falhas.length}):\n- ${falhas.join('\n- ')}`);
  codigo = 1;
} else {
  console.log('\nOK: telas reais + backend real + PostgreSQL local sem divergências.');
}
process.exit(codigo);
