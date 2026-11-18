#!/usr/bin/env node
/**
 * D-PROD-178 (MAIKE-MAPA-NIVEIS-COCHO-DEPOSITO-UX01) — verificação no
 * navegador dos níveis de COCHO e DEPÓSITO no Mapa Geral REAL.
 *
 * No padrão de `e2e-estoque-p0.mjs`: sobe o backend Fastify REAL
 * (`backend/src/server.js`) contra um PostgreSQL LOCAL, sobe o Vite apontando
 * para ele e abre o Mapa Geral no Chromium (WebGL por SwiftShader, porque o
 * mapa é MapLibre). Clique no desktop e TOQUE no celular, sem `force`.
 *
 * Cada largura (padrão 1280, 390 e 412 px) usa um tenant próprio:
 *  - empresa com fuso America/Sao_Paulo, pasto com polígono, lote de 100
 *    cabeças de 250 kg no pasto;
 *  - produto "SAL PROTEINADO NÍVEIS" (KG, 0,2 %PV);
 *  - depósito de suplementação no "DEPÓSITO CENTRAL" com limite operacional
 *    300 kg e estoque mínimo 100 kg; 600 kg entram por COMPRA confirmada na
 *    API financeira REAL (o motor cria a camada; nada escrito direto);
 *  - cocho no pasto, limite operacional 120 kg, ligado ao depósito;
 *  - lançamento de ONTEM (dia civil em São Paulo) gravado pela API REAL
 *    (`POST /suplementacao-eventos`): 200 kg fornecidos, sobra 0, ciclo
 *    aberto, `consumo_esperado_pv_kg` = 50 (100 cab × 250 kg × 0,2 %).
 *
 * Esperado (SSOT `src/domain/suplementacao/nivelSuplementacao.js`):
 *  - COCHO: ícone do marcador em 75% (= `urlIconeCocho(0.75, true)`), título
 *    "… — Restante estimado: 150 kg de 200 kg (75%). Uso do limite
 *    operacional: 125% de 120 kg (30 kg acima).", sem selo; no detalhe
 *    "75%" uma vez (sob o ícone) e "150 kg de 200 kg", medidor do limite com
 *    125% e "150 kg de 120 kg · 30 kg acima do limite" (aria-valuetext "125%
 *    do limite operacional: 150 kg de 120 kg, 30 kg acima"), "No lançamento:
 *    166,67% (80 kg acima)", cartões 150 kg / 4 dia(s) / próxima reposição =
 *    ontem + 4;
 *  - DEPÓSITO: ícone cheio (`data-deposito-nivel="100"`), selo "!", título
 *    "… — Saldo de 600 kg: 200% do limite operacional de 300 kg (300 kg
 *    acima).", no detalhe medidor com 200% e "600 kg de 300 kg · 300 kg acima
 *    do limite" (aria-valuetext "200% do limite operacional: 600 kg de 300
 *    kg, 300 kg acima"),
 *    "Mínimo 100 kg · 500 kg acima do mínimo", saldo 600,00 kg.
 *  - VIRADA DO DIA (relógio do navegador controlado pelo Playwright, fuso da
 *    fazenda): às 23:59:30 de São Paulo o cocho mostra 75%; à meia-noite o
 *    timer do `useDiaCivil` vira o dia e o MESMO marcador passa a 50%
 *    ("100 kg de 200 kg", 83,33% do limite) sem recarregar nem buscar de novo
 *    os lançamentos; o detalhe mostra 50% e a linha "No lançamento: 166,67%
 *    (80 kg acima)" continua visível depois do consumo.
 *  O relógio do navegador começa às 12:00 (São Paulo) do dia da semente: o
 *  roteiro não depende da hora em que roda (nem de rodar perto da meia-noite).
 *  Em cada largura: sem rolagem horizontal da página nem da seção de nível,
 *  nenhuma escrita disparada pelas telas (ver o nível é só leitura), nenhuma
 *  resposta ≥ 400 vista pelas telas, nenhum erro de página.
 *
 * Uso:
 *   DATABASE_URL=postgresql://postgres@localhost:5433/maike_mapa_e2e?host=/tmp \
 *     node scripts/dev/e2e-mapa-niveis.mjs [pasta-das-capturas]
 * Variáveis opcionais: E2E_API_PORT (3991), E2E_WEB_PORT (5291),
 * E2E_LARGURAS ("1280,390,412"). O banco precisa estar migrado
 * (`npm run prisma:deploy` com a mesma DATABASE_URL). Recusa banco que não seja
 * local. Encerra backend e Vite ao sair. Sai ≠ 0 em QUALQUER divergência.
 * Capturas em PNG com deviceScaleFactor 1.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { exigirBancoLocal } from './e2e-lancamentos-seed.mjs';
import { urlIconeCocho } from '../../src/assets/icones/cocho-descoberto.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_PORT = Number(process.env.E2E_API_PORT || 3991);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5291);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maike-e2e-mapa-niveis'));
// Logs do backend/Vite e capturas de falha ficam FORA da pasta de evidências.
const LOGS = path.resolve(process.env.E2E_LOGS || path.join(os.tmpdir(), 'maike-e2e-mapa-niveis-logs'));
const LARGURAS = String(process.env.E2E_LARGURAS || '1280,390,412')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 320);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(LOGS, { recursive: true });

const DATABASE_URL = exigirBancoLocal();
const SENHA = 'senha-e2e-mapa-niveis-1';
const TOTAL_PASSOS = 4;

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
  // Vazias, não apagadas: o dotenv do backend só preenche chaves ausentes.
  for (const k of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) e[k] = '';
  for (const k of ['VERCEL', 'VERCEL_ENV']) delete e[k];
  return e;
};
const subir = (nome, comando, args, env) => {
  const log = fs.openSync(path.join(LOGS, `${nome}.log`), 'w');
  const filho = spawn(comando, args, { cwd: RAIZ, env, stdio: ['ignore', log, log], detached: true });
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
      if (filho.exitCode !== null) throw new Error(`${n} saiu com código ${filho.exitCode} (veja ${path.join(LOGS, `${n}.log`)})`);
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
const igual = (real, esperado, msg) => {
  const ok = conferir(String(real) === String(esperado), `${msg}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(real)}`);
  if (ok) console.log(`  ✓ ${msg}: ${JSON.stringify(real)}`);
  return ok;
};
/** Evidência por largura (vai para `evidencias.json`). */
const evidencias = {};
const anotar = (rotulo, chave, valor) => {
  (evidencias[rotulo] ??= {})[chave] = valor;
};

// ─── Dias (civil em São Paulo) ──────────────────────────────────────────────
const FUSO = 'America/Sao_Paulo';
const hojeEm = (fuso) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const somarDias = (d, n) => {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const formatarDia = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** Instante "AAAA-MM-DD hh:mm:ss" em São Paulo (UTC−3, sem horário de verão desde 2019). */
const instanteSP = (dia, hora) => new Date(`${dia}T${hora}-03:00`);

// ─── Banco ──────────────────────────────────────────────────────────────────
process.env.DATABASE_URL = DATABASE_URL;
{
  // Confere a URL que o backend resolveu de fato (depois do dotenv).
  const { env: envBackend } = await import('../../backend/src/config/env.js');
  if (envBackend.databaseUrl !== DATABASE_URL) {
    console.error('O backend resolveu outro banco que não a DATABASE_URL local conferida; o ensaio não roda.');
    process.exit(2);
  }
}
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const prisma = getPrismaClient();
const { gerarSenhaHash } = await import('../../backend/src/modules/auth/authService.js');

// ─── API real ───────────────────────────────────────────────────────────────
const respostasRoteiro = [];
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
  respostasRoteiro.push(`${metodo} ${caminho.split('?')[0]} → ${r.status}`);
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
  const loginDono = `dono-niveis-${rotulo}-${sufixo}`;
  const senhaHash = await gerarSenhaHash(SENHA);
  return prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.create({ data: { codigo: `e2e-niveis-${rotulo}-${sufixo}`, nome: `FAZENDA NÍVEIS ${rotulo}` } });
    const c = cliente.id;
    await tx.usuario.create({ data: { cliente_id: c, nome: 'DONO DA FAZENDA', login: loginDono, senha_hash: senhaHash, papel_tenant: 'administrador' } });
    const empresa = await tx.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'SEDE', nome: 'FAZENDA BOA VISTA', fuso_horario: FUSO } });
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
        nome: 'BOIS DE RECRIA NÍVEIS',
        quantidade_cabecas: 100,
        quantidade_entrada: 100,
        categoria: 'Boi 13 a 24 meses',
        sexo: 'Macho',
        peso_medio_kg: '250.0000',
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
    const local = await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '1', nome: 'DEPÓSITO CENTRAL' } });
    const categoria = await tx.categoria.create({ data: { cliente_id: c, numero_categoria: '1', nome: 'SUPLEMENTOS' } });
    await tx.unidadeMedida.create({ data: { cliente_id: c, numero_unidade: '1', sigla: 'KG', descricao: 'QUILOGRAMA' } });
    const produto = await tx.produto.create({
      data: {
        ...base,
        numero_produto: '1',
        nome_produto: 'SAL PROTEINADO NÍVEIS',
        tipo_uso: 'Nutrição Animal',
        codigo_interno: 'SPN',
        categoria: categoria.nome,
        unidade_medida: 'KG',
        unidade_principal_estoque: 'KG',
        local_estoque: local.nome,
        preco_custo: '2.0000',
        percentual_consumo_pv: '0.2000',
      },
    });
    const deposito = await tx.pontoSuplementacao.create({
      data: {
        ...base,
        numero_ponto: '1',
        nome_ponto: 'DEPÓSITO DA SEDE NÍVEIS',
        sigla: 'DSN',
        categoria_ponto: 'DEPOSITO',
        tipo: 'Depósito',
        local_estoque_id: local.id,
        local_estoque_nome: local.nome,
        capacidade_cocho_kg: '300.0000',
        estoque_minimo_kg: '100.0000',
        coordenadas: { lat: -15.0082, lng: -59.9521 },
        status: 'Ativo',
      },
    });
    const cocho = await tx.pontoSuplementacao.create({
      data: {
        ...base,
        numero_ponto: '2',
        nome_ponto: 'COCHO DO PASTO NÍVEIS',
        sigla: 'CPN',
        categoria_ponto: 'COCHO',
        tipo: 'Cocho coberto',
        produto_padrao: produto.nome_produto,
        capacidade_cocho_kg: '120.0000',
        area_vinculada_id: area.id,
        area_vinculada_nome: area.nome,
        area_vinculada_ids: [area.id],
        area_vinculada_nomes: [area.nome],
        deposito_origem_id: deposito.id,
        deposito_origem_nome: deposito.nome_ponto,
        coordenadas: { lat: -15.0052, lng: -59.9545 },
        status: 'Ativo',
      },
    });
    return {
      cliente_id: c,
      credenciais: { login: loginDono, senha: SENHA },
      empresa: { id: empresa.id },
      fornecedor: { id: fornecedor.id },
      natureza: { id: natureza.id },
      area: { id: area.id, nome: area.nome },
      local: { id: local.id, nome: local.nome },
      produto: { id: produto.id, nome: produto.nome_produto },
      deposito: { id: deposito.id, nome: deposito.nome_ponto },
      cocho: { id: cocho.id, nome: cocho.nome_ponto },
    };
  });
};

/** 600 kg no DEPÓSITO CENTRAL por compra confirmada na API financeira real. */
const comprarEstoque = async (s, token) => {
  const hoje = hojeEm(FUSO);
  const perfil = await api(token, 'PUT', '/perfis-financeiros-empresa', { empresa_id: s.empresa.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' });
  exigir(perfil.status === 200, `perfil financeiro: ${perfil.status} ${JSON.stringify(perfil.corpo).slice(0, 200)}`);
  const dia = somarDias(hoje, -3);
  const criado = await api(token, 'POST', '/operacoes-financeiras', {
    empresa_id: s.empresa.id,
    direcao: 'PAGAR',
    conteudo: 'COM_PRODUTOS',
    condicao: 'PRAZO',
    parceiro_id: s.fornecedor.id,
    data_emissao: dia,
    data_operacional: dia,
    documento_referencia: 'NF-NIVEIS-1',
    efeito_fisico_confirmado: true,
    itens: [{ tipo_item: 'MERCADORIA', produto_id: s.produto.id, local_estoque_id: s.local.id, unidade: 'KG', quantidade: '600', valor_unitario: '2.00' }],
    rateio_modo: 'PERCENTUAL',
    rateios: [{ natureza_id: s.natureza.id, percentual: '100' }],
    parcelas: [{ vencimento: somarDias(hoje, 30), valor: '1200.00' }],
    operation_id: randomUUID(),
  });
  exigir(criado.status === 201, `compra: criar ${criado.status} ${JSON.stringify(criado.corpo).slice(0, 300)}`);
  const conf = await api(token, 'POST', `/operacoes-financeiras/${criado.corpo.id}/confirmar`, {
    empresa_id: s.empresa.id,
    operation_id: randomUUID(),
    versao: criado.corpo.versao,
  });
  exigir(conf.status === 200, `compra: confirmar ${conf.status} ${JSON.stringify(conf.corpo).slice(0, 300)}`);
  const soma = await prisma.estoqueLoteNota.aggregate({
    _sum: { quantidade_disponivel: true },
    where: { cliente_id: s.cliente_id, local_estoque_id: s.local.id, status: 'Disponivel' },
  });
  return soma._sum.quantidade_disponivel?.toFixed(4) ?? '0.0000';
};

/** Lançamento da véspera de `hoje` (São Paulo), ciclo aberto, gravado pela API real. */
const lancarOntem = async (s, token, hoje) => {
  const ontem = somarDias(hoje, -1);
  const r = await api(token, 'POST', '/suplementacao-eventos', {
    empresa_id: s.empresa.id,
    ponto_suplementacao_id: s.cocho.id,
    ponto_suplementacao_nome: s.cocho.nome,
    deposito_id: s.deposito.id,
    data_lancamento: ontem,
    produto: s.produto.nome,
    produto_id: s.produto.id,
    quantidade_total_kg: 200,
    sobra_kg: 0,
    dias_periodo: null,
    consumo_esperado_pv_kg: 50,
    total_cabecas_afetadas: 100,
    peso_medio_lotes_kg: 250,
    area_id: s.area.id,
    area_ids: [s.area.id],
  });
  exigir(r.status === 201 || r.status === 200, `lançamento do cocho: ${r.status} ${JSON.stringify(r.corpo).slice(0, 300)}`);
  return ontem;
};

// ─── Roteiro por largura ────────────────────────────────────────────────────
const executarLargura = async (browser, largura) => {
  const rotulo = `w${largura}`;
  const movel = largura < 640;
  const s = await semear(rotulo);
  const token = await login(s.credenciais);
  const saldoBanco = await comprarEstoque(s, token);
  igual(saldoBanco, '600.0000', `[${rotulo}] saldo do DEPÓSITO CENTRAL no banco (compra pela API real)`);
  const hoje = hojeEm(FUSO);
  const ontem = await lancarOntem(s, token, hoje);
  anotar(rotulo, 'dias', { hoje, ontem });
  const errosPagina = [];
  const respostasApi = [];
  const escritas = [];

  const passo = async (nome, fn) => {
    const antes = falhas.length;
    console.log(`\n[${rotulo}] ${nome}`);
    try {
      await fn();
    } catch (erro) {
      if (!(erro instanceof Divergencia)) falhas.push(`[${rotulo}] ${nome}: interrompido — ${String(erro?.message || erro).split('\n')[0]}`);
    }
    const ok = falhas.length === antes;
    passos.push({ largura: rotulo, nome, ok });
    return ok;
  };

  const ctx = await browser.newContext({
    viewport: { width: largura, height: movel ? (largura >= 400 ? 915 : 844) : 860 },
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
    },
    { t: token, e: s.empresa.id, c: s.cliente_id },
  );
  const page = await ctx.newPage();
  // Relógio do navegador sob controle: começa às 12:00 de `hoje` em São Paulo e
  // corre normalmente (o roteiro não depende da hora real em que roda).
  await page.clock.install({ time: instanteSP(hoje, '12:00:00') });
  const leiturasEventos = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url().startsWith(API) && /\/suplementacao-eventos(\?|$)/.test(r.url().replace(API, ''))) leiturasEventos.push(Date.now());
  });
  page.on('pageerror', (e) => errosPagina.push(String(e).slice(0, 300)));
  page.on('request', (r) => {
    if (r.url().startsWith(API) && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) escritas.push(`${r.method()} ${r.url().replace(API, '')}`);
  });
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.startsWith(API) || r.status() < 400) return;
    const item = { texto: `${r.request().method()} ${u.replace(API, '')} → ${r.status()}` };
    respostasApi.push(item);
    try {
      item.texto += ` ${(await r.text()).slice(0, 200)}`;
    } catch {
      /* sem corpo */
    }
  });
  page.setDefaultTimeout(20000);

  const toque = async (loc, acao) => {
    try {
      await loc.waitFor({ state: 'visible', timeout: 15000 });
      if (movel) await loc.tap({ timeout: 10000 });
      else await loc.click({ timeout: 10000 });
    } catch (erro) {
      await page.screenshot({ path: path.join(LOGS, `falha-${rotulo}-${acao.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
      throw new Error(`ação "${acao}" não executada: ${String(erro?.message || erro).split('\n')[0]}`);
    }
    await page.waitForTimeout(250);
  };
  /** Captura PNG (deviceScaleFactor 1) + prova de que não há rolagem horizontal. */
  const shot = async (nome, regiao) => {
    await page.waitForTimeout(400);
    const arquivo = `mapa-niveis-${rotulo}-${nome}.png`;
    await page.screenshot({ path: path.join(OUT, arquivo), fullPage: false });
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, vw: window.innerWidth }));
    conferir(m.sw <= largura && m.bw <= largura, `[${rotulo}] ${arquivo}: rolagem horizontal da página (${m.sw}/${m.bw} > ${largura})`);
    if (regiao) {
      const r = await regiao.evaluate((el) => {
        const caixa = el.getBoundingClientRect();
        /** Algum filho da região passa da borda direita dela (texto cortado/estourado)? */
        let estouro = 0;
        for (const filho of el.querySelectorAll('*')) {
          const f = filho.getBoundingClientRect();
          if (f.width > 0 && f.right > caixa.right + 1) estouro = Math.max(estouro, Math.round(f.right - caixa.right));
        }
        return { l: Math.round(caixa.left), r: Math.round(caixa.right), sw: el.scrollWidth, cw: el.clientWidth, vw: window.innerWidth, estouro };
      });
      anotar(rotulo, `${nome}_regiao`, r);
      conferir(r.l >= 0 && r.r <= r.vw && r.sw <= r.cw + 1 && r.estouro === 0, `[${rotulo}] ${arquivo}: seção de nível fora da tela ou com rolagem/estouro horizontal ${JSON.stringify(r)}`);
    }
    return arquivo;
  };

  const marcador = (nome) => page.locator(`.mg-marker[title^="${nome}"]`).first();
  const abrirMapa = async () => {
    await page.goto(`${WEB}/MapaGeral`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.maplibregl-canvas', { timeout: 45000 });
    await marcador(s.cocho.nome).waitFor({ state: 'visible', timeout: 45000 });
    await marcador(s.deposito.nome).waitFor({ state: 'visible', timeout: 45000 });
    await page.waitForTimeout(1500);
  };
  /** Fecha pelo ✕ "Fechar" (no desktop o diálogo não fecha por Esc nem clique fora, D-PROD-125). */
  const fecharDialogo = async () => {
    await toque(page.getByRole('button', { name: 'Fechar', exact: true }).filter({ visible: true }).last(), 'Fechar diálogo');
    await page.getByRole('dialog').filter({ visible: true }).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
  };
  const lerMarcadorCocho = () =>
    marcador(s.cocho.nome).evaluate((el) => ({
      title: el.getAttribute('title'),
      aria: el.getAttribute('aria-label'),
      src: el.querySelector('img')?.getAttribute('src') || '',
      selo: el.querySelector('.mg-supl-selo')?.getAttribute('data-selo') ?? null,
    }));

  try {
    // ── 1. Marcadores no mapa ────────────────────────────────────────────────
    await passo('1 Mapa: ícone, título e selo dos marcadores vêm do SSOT (cocho 75%, depósito cheio com "!")', async () => {
      await abrirMapa();
      const cocho = await lerMarcadorCocho();
      const deposito = await marcador(s.deposito.nome).evaluate((el) => {
        const src = el.querySelector('img')?.getAttribute('src') || '';
        const svg = decodeURIComponent(src.split(',')[1] || '');
        const m = svg.match(/data-deposito-nivel="(\d+)"/);
        const selo = el.querySelector('.mg-supl-selo');
        return {
          title: el.getAttribute('title'),
          aria: el.getAttribute('aria-label'),
          nivelIcone: m ? m[1] : null,
          selo: selo?.getAttribute('data-selo') ?? null,
          seloTexto: selo?.textContent ?? null,
          seloAriaHidden: selo?.getAttribute('aria-hidden') ?? null,
        };
      });
      anotar(rotulo, 'marcador_cocho', { title: cocho.title, selo: cocho.selo });
      anotar(rotulo, 'marcador_deposito', deposito);
      const tituloCocho = `${s.cocho.nome} — Restante estimado: 150 kg de 200 kg (75%). Uso do limite operacional: 125% de 120 kg (30 kg acima).`;
      igual(cocho.title, tituloCocho, `[${rotulo}] title do marcador do cocho`);
      igual(cocho.aria, tituloCocho, `[${rotulo}] aria-label do marcador do cocho`);
      igual(cocho.src === urlIconeCocho(0.75, true), true, `[${rotulo}] ícone do cocho = urlIconeCocho(0,75) (75%)`);
      igual(cocho.src === urlIconeCocho(1, true), false, `[${rotulo}] ícone do cocho não está cheio`);
      igual(cocho.selo, null, `[${rotulo}] cocho com estimativa não tem selo`);
      const tituloDeposito = `${s.deposito.nome} — Saldo de 600 kg: 200% do limite operacional de 300 kg (300 kg acima).`;
      igual(deposito.title, tituloDeposito, `[${rotulo}] title do marcador do depósito`);
      igual(deposito.aria, tituloDeposito, `[${rotulo}] aria-label do marcador do depósito`);
      igual(deposito.nivelIcone, '100', `[${rotulo}] ícone do depósito cheio (data-deposito-nivel)`);
      igual(`${deposito.selo}:${deposito.seloTexto}:${deposito.seloAriaHidden}`, 'excesso:!:true', `[${rotulo}] selo "!" do depósito acima do limite`);
      await shot('01-mapa');
    });

    // ── 2. Detalhe do cocho ─────────────────────────────────────────────────
    await passo('2 Detalhe do cocho: 75% e 150 kg de 200 kg, limite 125% (30 kg acima), no lançamento 166,67% (80 kg acima)', async () => {
      await toque(marcador(s.cocho.nome), `marcador ${s.cocho.nome}`);
      // D-PROD-220: o título do diálogo é o nome do cocho (casca v12).
      await page.getByRole('dialog', { name: s.cocho.nome, exact: true }).first().waitFor({ state: 'visible' });
      const regiao = page.getByRole('region', { name: 'Nível do cocho' }).filter({ visible: true }).first();
      await regiao.waitFor({ state: 'visible', timeout: 30000 });
      await regiao.scrollIntoViewIfNeeded();
      const restante = regiao.getByRole('img', { name: /^Restante do ciclo \(estimado\):/ });
      igual(await restante.getAttribute('aria-label'), 'Restante do ciclo (estimado): 75%', `[${rotulo}] medidor do ciclo (aria-label)`);
      igual(await regiao.getByText('150 kg de 200 kg', { exact: true }).count(), 1, `[${rotulo}] texto "150 kg de 200 kg"`);
      // D-PROD-220: o percentual do ciclo aparece uma vez, grande, no bloco do nível.
      igual((await regiao.locator('.mk-dp-nivel__val').first().textContent())?.trim(), '75%', `[${rotulo}] o percentual do ciclo no bloco do nível`);
      igual(await regiao.getByText('Consumo estimado: 50 kg/dia (%PV no lançamento)', { exact: true }).count(), 1, `[${rotulo}] taxa do %PV no lançamento`);
      igual(await regiao.getByText('Dias desde o lançamento: 1 · Restam 3 dia(s)', { exact: true }).count(), 1, `[${rotulo}] dias decorridos e restantes`);
      const medidor = regiao.getByRole('meter', { name: 'Uso do limite operacional' });
      igual(await medidor.getAttribute('aria-valuenow'), '125', `[${rotulo}] medidor do limite (aria-valuenow bruto)`);
      igual(await medidor.getAttribute('aria-valuetext'), '125% do limite operacional: 150 kg de 120 kg, 30 kg acima', `[${rotulo}] medidor do limite (aria-valuetext)`);
      igual(await medidor.getAttribute('aria-describedby'), null, `[${rotulo}] medidor do limite sem aria-describedby repetido`);
      igual(await medidor.getAttribute('data-variante'), 'excesso', `[${rotulo}] medidor do limite em excesso`);
      igual(await regiao.getByText('125%', { exact: true }).count(), 1, `[${rotulo}] 125% visível fora da barra`);
      igual(await regiao.getByText('150 kg de 120 kg · 30 kg acima do limite', { exact: true }).count(), 1, `[${rotulo}] 30 kg acima do limite`);
      igual(await regiao.getByText('No lançamento: 166,67% (80 kg acima)', { exact: true }).count(), 1, `[${rotulo}] linha "No lançamento" 166,67% (80 kg acima)`);
      const largBarra = await regiao.locator('[data-medidor-preenchimento]').first().evaluate((el) => el.style.width);
      igual(largBarra, '100%', `[${rotulo}] preenchimento da barra limitado a 100%`);
      const cartao = async (rot) => (await regiao.getByText(rot, { exact: true }).locator('xpath=following-sibling::dd[1]').textContent())?.trim();
      igual(await cartao('Saldo estimado'), '150 kg', `[${rotulo}] cartão Saldo estimado`);
      igual(await cartao('Duração estimada'), '4 dia(s)', `[${rotulo}] cartão Duração estimada`);
      igual(await cartao('Próxima reposição'), formatarDia(somarDias(ontem, 4)), `[${rotulo}] cartão Próxima reposição`);
      anotar(rotulo, 'detalhe_cocho', { ontem, proxima: formatarDia(somarDias(ontem, 4)) });
      await shot('02-detalhe-cocho', regiao);
      await fecharDialogo();
    });

    // ── 3. Detalhe do depósito ──────────────────────────────────────────────
    await passo('3 Detalhe do depósito: 200% (300 kg acima), ícone cheio, mínimo 100 kg com 500 kg acima, saldo 600 kg', async () => {
      await marcador(s.deposito.nome).waitFor({ state: 'visible' });
      await toque(marcador(s.deposito.nome), `marcador ${s.deposito.nome}`);
      // D-PROD-220: o título do diálogo é o nome do depósito (casca v12).
      await page.getByRole('dialog', { name: s.deposito.nome, exact: true }).first().waitFor({ state: 'visible' });
      const regiao = page.getByRole('region', { name: 'Nível do depósito' }).filter({ visible: true }).first();
      await regiao.waitFor({ state: 'visible', timeout: 30000 });
      await regiao.scrollIntoViewIfNeeded();
      const medidor = regiao.getByRole('meter', { name: 'Ocupação do limite operacional' });
      igual(await medidor.getAttribute('aria-valuenow'), '200', `[${rotulo}] medidor do depósito (aria-valuenow bruto)`);
      igual(await medidor.getAttribute('aria-valuetext'), '200% do limite operacional: 600 kg de 300 kg, 300 kg acima', `[${rotulo}] medidor do depósito (aria-valuetext)`);
      igual(await medidor.getAttribute('aria-describedby'), null, `[${rotulo}] medidor do depósito sem aria-describedby repetido`);
      // D-PROD-220: o percentual aparece no bloco do nível e na célula do medidor.
      igual(await regiao.getByText('200%', { exact: true }).count(), 2, `[${rotulo}] 200% visível fora do ícone (nível e medidor)`);
      igual(await regiao.getByText('600 kg de 300 kg · 300 kg acima do limite', { exact: true }).count(), 1, `[${rotulo}] 600 kg de 300 kg · 300 kg acima do limite`);
      const nivelIcone = await regiao.locator('img[data-deposito-icone]').evaluate((img) => {
        const svg = decodeURIComponent(img.getAttribute('src').split(',')[1] || '');
        return svg.match(/data-deposito-nivel="(\d+)"/)?.[1] ?? null;
      });
      igual(nivelIcone, '100', `[${rotulo}] ícone do depósito no detalhe cheio`);
      const minimo = regiao.getByRole('group', { name: 'Estoque mínimo' });
      igual(await minimo.getByText('Mínimo 100 kg · 500 kg acima do mínimo', { exact: true }).count(), 1, `[${rotulo}] estoque mínimo como limiar`);
      igual(await minimo.getAttribute('data-estado-minimo'), 'acima', `[${rotulo}] estado do mínimo`);
      const cartao = async (rot) => (await regiao.getByText(rot, { exact: true }).locator('xpath=following-sibling::dd[1]').textContent())?.trim();
      igual(await cartao('Saldo atual kg'), '600 kg', `[${rotulo}] cartão Saldo atual kg`);
      igual(await cartao('Necessidade reposição kg'), '0 kg', `[${rotulo}] cartão Necessidade reposição kg`);
      await shot('03-detalhe-deposito', regiao);
      await fecharDialogo();
    });

    // ── 4. Virada do dia no fuso da fazenda, sem recarregar ─────────────────
    await passo('4 Virada do dia (São Paulo): o MESMO marcador vai de 75% a 50% à meia-noite, sem refetch; detalhe 50% e "No lançamento" continua', async () => {
      const amanha = somarDias(hoje, 1);
      await page.clock.pauseAt(instanteSP(hoje, '23:59:30'));
      const antes = await lerMarcadorCocho();
      igual(antes.src === urlIconeCocho(0.75, true), true, `[${rotulo}] 23:59:30 em SP: cocho ainda em 75%`);
      const elAntes = await marcador(s.cocho.nome).elementHandle();
      const leiturasAntes = leiturasEventos.length;
      await page.clock.runFor('01:00');
      const tituloDepois = `${s.cocho.nome} — Restante estimado: 100 kg de 200 kg (50%). Uso do limite operacional: 83,33% de 120 kg.`;
      await page.waitForFunction(
        ({ nome, titulo }) => [...document.querySelectorAll('.mg-marker')].some((el) => el.getAttribute('title') === titulo && el.getAttribute('title').startsWith(nome)),
        { nome: s.cocho.nome, titulo: tituloDepois },
        { timeout: 15000 },
      ).catch(() => {});
      const depois = await lerMarcadorCocho();
      igual(depois.title, tituloDepois, `[${rotulo}] 00:00:30 em SP: title do marcador do cocho depois da virada`);
      igual(depois.aria, tituloDepois, `[${rotulo}] aria-label depois da virada`);
      igual(depois.src === urlIconeCocho(0.5, true), true, `[${rotulo}] ícone do cocho = urlIconeCocho(0,5) depois da virada`);
      const mesmoElemento = await marcador(s.cocho.nome).evaluate((el, antigo) => el === antigo, elAntes);
      igual(mesmoElemento, true, `[${rotulo}] o MESMO elemento de marcador foi atualizado (sem recriar)`);
      igual(leiturasEventos.length - leiturasAntes, 0, `[${rotulo}] leituras de /suplementacao-eventos na virada (sem refetch)`);
      anotar(rotulo, 'virada', { de: hoje, para: amanha, titulo: depois.title, leituras_eventos: leiturasEventos.length - leiturasAntes });
      await shot('04-mapa-apos-virada');
      await page.clock.resume();
      await toque(marcador(s.cocho.nome), `marcador ${s.cocho.nome} depois da virada`);
      // D-PROD-220: o título do diálogo é o nome do cocho (casca v12).
      await page.getByRole('dialog', { name: s.cocho.nome, exact: true }).first().waitFor({ state: 'visible' });
      const regiao = page.getByRole('region', { name: 'Nível do cocho' }).filter({ visible: true }).first();
      await regiao.waitFor({ state: 'visible', timeout: 30000 });
      await regiao.scrollIntoViewIfNeeded();
      igual(await regiao.getByRole('img', { name: /^Restante do ciclo \(estimado\):/ }).getAttribute('aria-label'), 'Restante do ciclo (estimado): 50%', `[${rotulo}] detalhe depois da virada: ciclo 50%`);
      igual(await regiao.getByText('100 kg de 200 kg', { exact: true }).count(), 1, `[${rotulo}] detalhe: "100 kg de 200 kg"`);
      igual(await regiao.getByText(/50%/).count(), 1, `[${rotulo}] detalhe: o percentual do ciclo aparece uma vez`);
      igual(await regiao.getByText('Dias desde o lançamento: 2 · Restam 2 dia(s)', { exact: true }).count(), 1, `[${rotulo}] detalhe: 2 dias decorridos, restam 2`);
      const medidor = regiao.getByRole('meter', { name: 'Uso do limite operacional' });
      igual(await medidor.getAttribute('aria-valuenow'), '83.33', `[${rotulo}] detalhe: limite 83,33% (aria-valuenow)`);
      igual(await medidor.getAttribute('data-variante'), 'normal', `[${rotulo}] detalhe: medidor do limite volta ao normal`);
      igual(await regiao.getByText('100 kg de 120 kg · dentro do limite', { exact: true }).count(), 1, `[${rotulo}] detalhe: dentro do limite`);
      igual(await regiao.getByText('No lançamento: 166,67% (80 kg acima)', { exact: true }).count(), 1, `[${rotulo}] detalhe: "No lançamento" continua depois do consumo`);
      await shot('05-detalhe-cocho-apos-virada', regiao);
      await fecharDialogo();
    });
  } finally {
    anotar(rotulo, 'escritas_das_telas', escritas);
    conferir(escritas.length === 0, `[${rotulo}] as telas dispararam escrita(s) só por exibir o nível: ${escritas.join(', ')}`);
    if (errosPagina.length) for (const e of errosPagina) falhas.push(`[${rotulo}] erro de página: ${e}`);
    for (const r of respostasApi) falhas.push(`[${rotulo}] resposta inesperada da API vista pela tela: ${r.texto.slice(0, 220)}`);
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

const cincoXX = respostasRoteiro.filter((r) => / → 5\d\d$/.test(r));
for (const r of cincoXX) falhas.push(`resposta 5xx da API: ${r}`);
try {
  const logBackend = fs.readFileSync(path.join(LOGS, 'backend.log'), 'utf8');
  const statusLog = [...logBackend.matchAll(/"statusCode":(\d{3})/g)].map((m) => Number(m[1]));
  const erros5xx = statusLog.filter((c) => c >= 500);
  console.log(`\nbackend.log: ${statusLog.length} respostas registradas, ${erros5xx.length} com 5xx`);
  if (erros5xx.length) falhas.push(`backend.log registrou ${erros5xx.length} resposta(s) 5xx`);
} catch {
  /* sem log */
}

for (const largura of LARGURAS) {
  const meus = passos.filter((p) => p.largura === `w${largura}`);
  const verdes = meus.filter((p) => p.ok).length;
  console.log(`\n[w${largura}] ${verdes}/${TOTAL_PASSOS} passos`);
  if (meus.length !== TOTAL_PASSOS || verdes !== TOTAL_PASSOS) falhas.push(`[w${largura}] ${verdes}/${TOTAL_PASSOS} passos verdes (executados ${meus.length})`);
}
console.log(`\n${passos.map((p) => `${p.ok ? '✓' : '✗'} [${p.largura}] ${p.nome}`).join('\n')}`);
fs.writeFileSync(path.join(OUT, 'evidencias.json'), JSON.stringify({ passos, evidencias, respostas_api_roteiro: respostasRoteiro, falhas }, null, 2));
console.log(`\nCapturas e evidencias.json em ${OUT}; logs em ${LOGS}`);
if (falhas.length) {
  console.error(`\nDIVERGÊNCIAS (${falhas.length}):\n- ${falhas.join('\n- ')}`);
  codigo = 1;
} else {
  console.log('\nOK: Mapa Geral real + backend real + PostgreSQL local sem divergências.');
}
process.exit(codigo);
