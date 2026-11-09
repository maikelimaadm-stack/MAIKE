#!/usr/bin/env node
/**
 * D-PROD-154 — PROVA DE USO REAL ponta a ponta da Central Única de Lançamentos.
 *
 * Diferente de `visual-lancamentos-financeiros.mjs` (backend FALSO), este
 * roteiro sobe o backend Fastify REAL (`backend/src/server.js`) contra um
 * PostgreSQL LOCAL, sobe o Vite apontando para ele e conduz a tela pelo
 * Playwright. Depois de cada passo confere o estado NO BANCO (Prisma):
 * títulos, liquidações, estornos, lotes, movimentos e `estoque_atual`.
 *
 * Roteiro (em 1280 e 390 px; cada largura num tenant próprio semeado por
 * `e2e-lancamentos-seed.mjs`):
 *   1. onboarding do perfil financeiro (BR/BRL/pt-BR, padrões explicados);
 *   2. PAGAR sem produtos, a prazo, 500,00, rateio 300/200 → confirmar;
 *   3. RECEBER sem produtos, parcelado 900,00 em 3 × 300,00 → confirmar;
 *   4. PAGAR com produtos: 100 SACO (30 kg) de RAÇÃO × 80,00 no DEPÓSITO 01;
 *   5. RECEBER com produtos: 5 kg de SAL MINERAL, saída FIFO em 2 lotes;
 *   6. baixa parcial (200,00) e estorno da baixa;
 *   7. cancelar documento COM baixa → recusa amigável, nada muda;
 *   8. venda sem saldo (50 kg) → bloqueio na prévia/erro, nada muda;
 *   9. cancelar documento SEM baixa (a venda) → lotes devolvidos;
 *  10. editar rascunho (PUT) e confirmar com a resposta perdida (replay);
 *  11. salvar e descartar rascunho; 12. lista com filtros;
 *  13. a MESMA baixa (valor, dia e forma) registrada duas vezes de propósito
 *      na mesma parcela → as duas gravadas, chaves diferentes;
 *  14. baixa com a resposta perdida → "Consultar" → 2ª baixa igual gravada
 *      como NOVA (revisão rodada 2: DINHEIRO-2);
 *  15. baixa com a resposta perdida e o diálogo fechado: "Manter" não envia
 *      nada e segue incerto; repetir reaproveita a chave (replay); "Enviar
 *      como novo" grava outra (FRONTEND-2/FRONTEND-4);
 *  16. trocar a moeda do perfil com lançamentos → 409
 *      PERFIL_FINANCEIRO_MOEDA_EM_USO amigável, nada gravado;
 *  17. compra da P3 a prazo no DEPÓSITO 02 consumida pelo estoque ANTIGO — o
 *      comando de suplementação, chamado pela API REAL com o corpo que o
 *      formulário do Mapa manda (a tela do Mapa exige geografia, pontos e
 *      rebanho que esta semente não monta) → saldos exatos no banco e na tela
 *      da P3; cancelar a compra → 409 ESTOQUE_JA_CONSUMIDO, nada muda;
 *  18. usuário só com `visualizar`: vê lista e documentos, nenhum botão de
 *      ação; o servidor também recusa (403) pela API real;
 *  19. usuário com `visualizar` + `confirmar` (sem salvar/editar): confirma o
 *      rascunho salvo pelo dono, sem PUT, sem criar, sem baixar/cancelar;
 *  20. troca de empresa na tela (duas empresas do mesmo tenant): perfil,
 *      lista e Novo da empresa nova aparecem; nada da outra vaza, nem o GET
 *      do documento aberto com a empresa nova (revisão rodada 2: FRONTEND-1).
 *  Toda resposta ≥ 400 da API real observada pelas telas é divergência, salvo
 *  as recusas PROVOCADAS (7, 16, 17), que também TÊM de acontecer.
 *
 * Uso:
 *   DATABASE_URL=postgresql://maike_ci:maike_ci@localhost:5432/maike_p3_e2e \
 *     node scripts/dev/e2e-lancamentos-real.mjs [pasta-das-capturas]
 * Variáveis opcionais: E2E_API_PORT (3901), E2E_WEB_PORT (5199),
 * E2E_LARGURAS ("1280,390"), E2E_PASSOS (ex.: "1-4,20": só esses passos — os
 * pulados aparecem como "–"; quem escolhe garante os pré-requisitos) e
 * E2E_WEB_RAIZ (outra árvore com a MESMA tela, ex.: uma cópia com os arquivos
 * do front de um commit anterior, para provar que o roteiro pega o defeito
 * — o backend continua o desta árvore). O banco precisa estar migrado
 * (`npm run prisma:deploy` com a mesma DATABASE_URL). Recusa banco que não
 * seja local. Encerra backend e Vite ao sair (sucesso, falha ou sinal).
 * Sai com código ≠ 0 em QUALQUER divergência de tela ou de banco.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { exigirBancoLocal, semearTenantE2E } from './e2e-lancamentos-seed.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_PORT = Number(process.env.E2E_API_PORT || 3901);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5199);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maike-e2e-lancamentos'));
const LARGURAS = String(process.env.E2E_LARGURAS || '1280,390')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 320);
fs.mkdirSync(OUT, { recursive: true });
const PASSOS = process.env.E2E_PASSOS
  ? new Set(
      String(process.env.E2E_PASSOS)
        .split(',')
        .flatMap((p) => {
          const [a, b] = p.split('-').map((x) => Number(x.trim()));
          return Number.isInteger(a) ? Array.from({ length: (Number.isInteger(b) ? b : a) - a + 1 }, (_, k) => a + k) : [];
        }),
    )
  : null;
const WEB_RAIZ = path.resolve(process.env.E2E_WEB_RAIZ || RAIZ);

const DATABASE_URL = exigirBancoLocal();

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
const dec = (v) => (v == null ? null : String(v.toFixed ? v.toFixed(4) : v));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Dias ───────────────────────────────────────────────────────────────────
const hojeEm = (fuso) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const somarDias = (d, n) => {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const diaDe = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// ─── Banco ──────────────────────────────────────────────────────────────────
process.env.DATABASE_URL = DATABASE_URL;
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const prisma = getPrismaClient();

const ultimaOperacao = (s) =>
  prisma.operacaoFinanceira.findFirst({ where: { cliente_id: s.cliente_id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
const operacaoCompleta = (s, id) =>
  prisma.operacaoFinanceira.findFirst({
    where: { cliente_id: s.cliente_id, id },
    include: { itens: { orderBy: { ordem: 'asc' } }, rateios: { orderBy: { ordem: 'asc' } }, titulos: { orderBy: { numero_parcela: 'asc' } } },
  });
const esperarBanco = async (fn, descricao, ms = 20000) => {
  const ate = Date.now() + ms;
  let ultimo;
  while (Date.now() < ate) {
    ultimo = await fn();
    if (ultimo) return ultimo;
    await new Promise((r) => setTimeout(r, 300));
  }
  return exigir(false, `banco não chegou ao estado esperado em ${ms} ms: ${descricao}`);
};
/** Foto do estoque do tenant: movimentos, lotes e estoque_atual. */
const fotoEstoque = async (s) => {
  const w = { where: { cliente_id: s.cliente_id } };
  const produtos = await prisma.produto.findMany({ ...w, select: { id: true, estoque_atual: true }, orderBy: { id: 'asc' } });
  const lotes = await prisma.estoqueLoteNota.findMany({ ...w, select: { id: true, quantidade_disponivel: true, status: true }, orderBy: { id: 'asc' } });
  const movimentos = await prisma.movimentacaoEstoque.findMany({ ...w, select: { id: true, status: true }, orderBy: { id: 'asc' } });
  return JSON.stringify({ produtos, lotes, movimentos });
};
const fotoFinanceiro = async (s) => {
  const w = { where: { cliente_id: s.cliente_id } };
  const ops = await prisma.operacaoFinanceira.findMany({ ...w, select: { id: true, status: true, versao: true }, orderBy: { id: 'asc' } });
  const titulos = await prisma.tituloFinanceiro.findMany({ ...w, select: { id: true, status: true, valor_liquidado: true }, orderBy: { id: 'asc' } });
  const liq = await prisma.liquidacaoFinanceira.count(w);
  const est = await prisma.liquidacaoFinanceiraEstorno.count(w);
  return JSON.stringify({ ops, titulos, liq, est });
};

// ─── Sessão ─────────────────────────────────────────────────────────────────
const login = async (cred) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred) });
  const corpo = await r.json();
  if (r.status !== 200 || !corpo.token) throw new Error(`login falhou (${r.status}): ${JSON.stringify(corpo).slice(0, 200)}`);
  return corpo.token;
};
/** Chamada DIRETA à API real (fora da tela), com o token de quem pede. */
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

// ─── Roteiro por largura ────────────────────────────────────────────────────
const executarLargura = async (browser, largura) => {
  const rotulo = String(largura);
  const movel = largura < 640;
  const s = await semearTenantE2E({ rotulo: `w${rotulo}` });
  const token = await login(s.credenciais);
  const hoje = hojeEm(s.empresa.fuso);
  const errosPagina = [];
  const respostasApi = [];
  // Recusas PROVOCADAS: cada uma é permitida e também EXIGIDA (tem de acontecer).
  const recusasEsperadas = [];
  const esperarRecusa = (re, descricao) => recusasEsperadas.push({ re, descricao, vista: 0 });
  const atores = [];
  let n = 0;

  /**
   * Uma sessão real no navegador (contexto próprio: token, storage e empresa
   * selecionada isolados) com os auxiliares de tela. `ator` só rotula capturas
   * e mensagens.
   */
  const abrirAtor = async (ator, tokenAtor) => {
    const ctx = await browser.newContext({
      viewport: { width: largura, height: movel ? 844 : 860 },
      deviceScaleFactor: 1,
      isMobile: movel,
      hasTouch: movel,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });
    // Só na PRIMEIRA carga: depois quem manda é a tela (troca de empresa,
    // renovação do token) — regravar a cada navegação desfaria a troca.
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
      { t: tokenAtor, e: s.empresa.id, c: s.cliente_id },
    );
    const page = await ctx.newPage();
    const requisicoes = [];
    page.on('pageerror', (e) => errosPagina.push(`${ator}: ${String(e).slice(0, 300)}`));
    page.on('request', (r) => {
      if (r.url().startsWith(API)) requisicoes.push({ metodo: r.method(), url: r.url().replace(API, '') });
    });
    page.on('response', async (r) => {
      const u = r.url();
      if (!u.startsWith(API)) return;
      const st = r.status();
      if (st < 400) return;
      const item = { ator, texto: `${r.request().method()} ${u.replace(API, '')} → ${st}` };
      respostasApi.push(item);
      try {
        item.texto += ` ${(await r.text()).slice(0, 400)}`;
      } catch {
        /* sem corpo */
      }
    });
    page.setDefaultTimeout(15000);

    const prefixo = ator === 'dono' ? '' : `${ator}-`;
    let fechado = false;
    const shot = async (etapa) => {
      n += 1;
      await page.waitForTimeout(300);
      const arquivo = `e2e-${rotulo}-${prefixo}${String(n).padStart(2, '0')}-${etapa}.png`;
      await page.screenshot({ path: path.join(OUT, arquivo), fullPage: false });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      conferir(sw <= largura, `${arquivo}: rolagem horizontal (${sw} > ${largura})`);
      return arquivo;
    };
    const visivel = (loc) => loc.filter({ visible: true }).first();
    const clicar = async (loc) => {
      const el = visivel(loc);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click();
      await page.waitForTimeout(250);
    };
    const preencher = async (testId, valor) => {
      const el = visivel(page.getByTestId(testId));
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.fill(valor);
      await page.waitForTimeout(120);
    };
    const escolher = async (testId, nome) => {
      await clicar(page.getByTestId(testId));
      const painel = page.getByTestId(`${testId}-painel`);
      await painel.getByRole('option', { name: nome }).first().waitFor({ state: 'visible' });
      await painel.getByRole('option', { name: nome }).first().click();
      await page.waitForTimeout(250);
    };
    const radio = (grupo, nome) => clicar(page.getByTestId(grupo).getByRole('radio', { name: nome, exact: true }));
    const irParaLista = async () => {
      await page.goto(`${WEB}/lancamentosfinanceiros`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(500);
    };
    const novo = async () => {
      await irParaLista();
      await clicar(page.getByRole('button', { name: 'Novo', exact: true }));
      await visivel(page.getByTestId('escolha-direcao')).waitFor();
    };
    /** Abre pela lista (duplo clique) e espera o elemento que prova a abertura. */
    const abrirNaLista = async (op, testIdEsperado) => {
      await irParaLista();
      let alvo = page.getByTestId(`lancamento-numero-${op.id}`);
      if (!(await alvo.count())) alvo = page.getByText(String(op.numero), { exact: true });
      const el = visivel(alvo);
      await el.waitFor();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.dblclick();
      await visivel(page.getByTestId(testIdEsperado)).waitFor();
      await page.waitForTimeout(300);
    };
    const abrirDocumento = (op) => abrirNaLista(op, op.status === 'RASCUNHO' ? 'botao-confirmar-lancamento' : 'consulta-lancamento');
    /** Confirma pelo fluxo da tela (salva rascunho → prévia → diálogo → confirmar). */
    const confirmarPelaTela = async (etapa) => {
      await clicar(page.getByTestId('botao-confirmar-lancamento'));
      const dialogo = page.getByTestId('dialogo-confirmacao');
      await dialogo.waitFor({ state: 'visible' });
      await page.getByTestId('resumo-confirmacao').waitFor({ state: 'visible' });
      await shot(`${etapa}-previa`);
      const resumo = await page.getByTestId('resumo-confirmacao').innerText();
      const bloqueios = (await page.getByTestId('previa-bloqueios').count()) ? await page.getByTestId('previa-bloqueios').innerText() : '';
      return { resumo, bloqueios, dialogo };
    };
    const confirmarDefinitivo = async (etapa) => {
      await clicar(page.getByTestId('botao-confirmar-definitivo'));
      await visivel(page.getByTestId('consulta-lancamento')).waitFor({ timeout: 30000 });
      await page.waitForTimeout(400);
      await shot(`${etapa}-confirmado`);
    };
    /**
     * Ids dos lançamentos na lista (só os visíveis, ou todos os do DOM), na
     * tabela (`lancamento-numero-<id>`) E nos cards do celular (o código do card
     * é o `numero`, único por tenant: traduzido para o id pelo banco).
     */
    const idsNaTela = async (soVisiveis = true) => {
      const ops = await prisma.operacaoFinanceira.findMany({ where: { cliente_id: s.cliente_id }, select: { id: true, numero: true } });
      const porNumero = Object.fromEntries(ops.map((o) => [String(o.numero), o.id]));
      return page.evaluate(
        ({ mapa, sv }) => {
          const vis = (e) => !sv || e.getClientRects().length > 0;
          const ids = [...document.querySelectorAll('[data-testid^="lancamento-numero-"]')]
            .filter(vis)
            .map((e) => String(e.getAttribute('data-testid')).replace('lancamento-numero-', ''));
          for (const card of document.querySelectorAll('[data-testid="b1-card"]')) {
            if (!vis(card)) continue;
            const codigo = card.querySelector('.mg-b1-card__sub')?.textContent?.trim() ?? '';
            if (codigo) ids.push(mapa[codigo] ?? `numero-desconhecido:${codigo}`);
          }
          return [...new Set(ids)];
        },
        { mapa: porNumero, sv: soVisiveis },
      );
    };
    /** Espera os `esperados` na lista e exige que nenhum `proibido` esteja no DOM. */
    const esperarLista = async (esperados, proibidos, descricao, ms = 20000) => {
      const ate = Date.now() + ms;
      let vistos = [];
      while (Date.now() < ate) {
        vistos = await idsNaTela(true);
        if (esperados.every((id) => vistos.includes(id))) break;
        await page.waitForTimeout(300);
      }
      const faltam = esperados.filter((id) => !vistos.includes(id));
      conferir(!faltam.length, `[${rotulo}] ${descricao}: ${faltam.length} de ${esperados.length} lançamento(s) esperado(s) não apareceram em ${ms} ms (visíveis: ${vistos.length})`);
      const vazados = (await idsNaTela(false)).filter((id) => proibidos.includes(id));
      conferir(!vazados.length, `[${rotulo}] ${descricao}: ${vazados.length} lançamento(s) da OUTRA empresa na tela`);
      return vistos;
    };
    /** Troca de empresa pelo seletor do topo (desktop) ou pela folha do celular. */
    const trocarEmpresa = async (de, para) => {
      if (movel) {
        await clicar(page.getByRole('button', { name: 'Trocar empresa', exact: true }));
        const item = page.locator('.mk-co__item').filter({ hasText: para.apelido });
        await visivel(item).waitFor();
        await visivel(item).click();
      } else {
        await clicar(page.getByRole('combobox').filter({ hasText: de.apelido }));
        await page.getByRole('option', { name: para.apelido, exact: true }).first().click();
      }
      await page.waitForTimeout(600);
      const selecionada = await page.evaluate(() => window.localStorage.getItem('empresa_selecionada_id'));
      exigir(selecionada === para.id, `[${rotulo}] a troca para ${para.apelido} não foi gravada (selecionada: ${selecionada})`);
    };
    /** Abre "Registrar pagamento/recebimento" da parcela, preenche e envia. */
    const registrarBaixa = async (parcela, valor, metodo) => {
      await clicar(page.getByTestId(`botao-liquidar-${parcela}`));
      const dlg = page.getByTestId('dialogo-liquidacao');
      await dlg.waitFor({ state: 'visible' });
      await preencher('liquidacao-valor', valor);
      await clicar(page.getByRole('dialog').getByRole('radio', { name: metodo, exact: true }));
      await clicar(page.getByTestId('botao-registrar-liquidacao'));
      return dlg;
    };
    const fechar = async () => {
      if (fechado) return;
      fechado = true;
      await ctx.close().catch(() => {});
    };
    const a = {
      ator,
      page,
      requisicoes,
      shot,
      visivel,
      clicar,
      preencher,
      escolher,
      radio,
      irParaLista,
      novo,
      abrirNaLista,
      abrirDocumento,
      confirmarPelaTela,
      confirmarDefinitivo,
      idsNaTela,
      esperarLista,
      trocarEmpresa,
      registrarBaixa,
      fechar,
      aberto: () => !fechado,
    };
    atores.push(a);
    return a;
  };

  const passo = async (nome, fn) => {
    const numero = Number(/^(\d+)/.exec(nome)?.[1]);
    if (PASSOS && !PASSOS.has(numero)) {
      passos.push(`[${rotulo}] – ${nome} (pulado: E2E_PASSOS)`);
      return;
    }
    const antes = falhas.length;
    const t0 = Date.now();
    console.log(`[${rotulo}] ${nome}`);
    try {
      await fn();
    } catch (erro) {
      if (!(erro instanceof Divergencia)) falhas.push(`[${rotulo}] ${nome}: ${String(erro?.message || erro).split('\n')[0].slice(0, 300)}`);
      for (const a of atores) if (a.aberto()) await a.shot(`falha-${nome.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
      passos.push(`[${rotulo}] ✗ ${nome} (${Date.now() - t0} ms)`);
      throw erro;
    }
    passos.push(`[${rotulo}] ${falhas.length === antes ? '✓' : '✗'} ${nome} (${Date.now() - t0} ms)`);
  };

  const dono = await abrirAtor('dono', token);
  const { page, shot, visivel, clicar, preencher, escolher, radio, irParaLista, novo, abrirDocumento, confirmarPelaTela, confirmarDefinitivo } = dono;

  const docs = {};
  try {
    // 1. Onboarding do perfil financeiro.
    await passo('1 onboarding do perfil BR/BRL/pt-BR', async () => {
      await irParaLista();
      const painel = visivel(page.getByTestId('perfil-financeiro-painel'));
      await painel.waitFor();
      const texto = await painel.innerText();
      conferir(/BRL|Real/i.test(texto) && /pt-BR|Brasil/i.test(texto), `[${rotulo}] painel do perfil não explica os padrões BR/BRL/pt-BR: ${texto.slice(0, 200)}`);
      await shot('01-onboarding');
      await clicar(page.getByTestId('botao-confirmar-perfil'));
      const perfil = await esperarBanco(() => prisma.perfilFinanceiroEmpresa.findFirst({ where: { cliente_id: s.cliente_id, empresa_id: s.empresa.id } }), 'perfil criado');
      igual(perfil.pais, 'BR', `[${rotulo}] perfil.pais`);
      igual(perfil.moeda, 'BRL', `[${rotulo}] perfil.moeda`);
      igual(perfil.locale, 'pt-BR', `[${rotulo}] perfil.locale`);
      await page.waitForTimeout(600);
      await shot('02-lista-vazia');
    });

    // 2. PAGAR sem produtos, a prazo, 500 com rateio 300/200.
    await passo('2 PAGAR sem produtos PRAZO 500 rateio 300/200', async () => {
      const estoqueAntes = await fotoEstoque(s);
      await novo();
      await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
      await radio('escolha-condicao', 'A prazo');
      await preencher('prazo-vencimento', somarDias(hoje, 30));
      await visivel(page.getByLabel('Nº do documento')).fill('nf-100');
      await preencher('valor-bruto', '500,00');
      await escolher('seletor-natureza-0', /INSUMOS/);
      await escolher('seletor-centro-custo-0', /REBANHO DE CRIA/);
      await escolher('seletor-centro-resultado-0', /PECUÁRIA DE CORTE/);
      await clicar(page.getByRole('button', { name: /Linha de rateio/ }));
      await escolher('seletor-natureza-1', /FRETE/);
      await preencher('rateio-0-valor', '300,00');
      await preencher('rateio-1-valor', '200,00');
      const dif = await visivel(page.getByTestId('rateio-diferenca')).innerText();
      conferir(!/falta|sobra/i.test(dif), `[${rotulo}] rateio 300+200 ainda acusa diferença: ${dif}`);
      await shot('03-pagar-sem-produtos');
      const { resumo, bloqueios } = await confirmarPelaTela('04-pagar');
      conferir(/1 parcela/i.test(resumo) && /500,00/.test(resumo), `[${rotulo}] resumo da confirmação inesperado: ${resumo.slice(0, 200)}`);
      conferir(!bloqueios.trim(), `[${rotulo}] prévia com bloqueio inesperado: ${bloqueios.slice(0, 200)}`);
      await confirmarDefinitivo('05-pagar');
      const op = await esperarBanco(async () => {
        const u = await ultimaOperacao(s);
        return u && u.status === 'CONFIRMADO' ? u : null;
      }, 'PAGAR 500 confirmado');
      const d = await operacaoCompleta(s, op.id);
      igual(d.direcao, 'PAGAR', `[${rotulo}] direção`);
      igual(d.conteudo, 'SEM_PRODUTOS', `[${rotulo}] conteúdo`);
      igual(d.condicao, 'PRAZO', `[${rotulo}] condição`);
      igual(dec(d.valor_total), '500.0000', `[${rotulo}] valor_total`);
      igual(d.documento_referencia, 'NF-100', `[${rotulo}] documento_referencia`);
      igual(d.documento_chave_ativa, 'NF-100', `[${rotulo}] documento_chave_ativa`);
      igual(d.rateios.map((r) => `${r.natureza_nome}:${dec(r.valor)}:${r.percentual}`).join('|'), 'INSUMOS:300.0000:null|FRETE:200.0000:null', `[${rotulo}] rateios`);
      igual(d.rateios[0].centro_custo_id, s.centros.custo, `[${rotulo}] centro de custo da linha 1`);
      igual(d.rateios[0].centro_resultado_id, s.centros.resultado, `[${rotulo}] centro de resultado da linha 1`);
      igual(d.titulos.map((t) => `${t.status}:${dec(t.valor)}:${diaDe(t.vencimento)}`).join('|'), `ABERTO:500.0000:${somarDias(hoje, 30)}`, `[${rotulo}] títulos`);
      igual(await fotoEstoque(s), estoqueAntes, `[${rotulo}] estoque mudou num lançamento sem produtos`);
      docs.pagar = d;
    });

    // 3. RECEBER sem produtos, parcelado 900 em 3 × 300.
    await passo('3 RECEBER sem produtos PARCELADO 900 em 3x300', async () => {
      await novo();
      await radio('escolha-direcao', 'A receber');
      await escolher('seletor-parceiro', /FRIGORÍFICO CENTRAL/);
      await radio('escolha-condicao', 'Parcelado');
      await preencher('valor-bruto', '900,00');
      await escolher('seletor-natureza-0', /VENDA DE INSUMOS/);
      await clicar(page.getByRole('radio', { name: 'Por percentual', exact: true }));
      await clicar(page.getByRole('button', { name: /Linha de rateio/ }));
      await escolher('seletor-natureza-1', /SERVIÇOS PRESTADOS/);
      await preencher('rateio-0-percentual', '60');
      await preencher('rateio-1-percentual', '40');
      const difRateio = await visivel(page.getByTestId('rateio-diferenca')).innerText();
      conferir(!/falta|sobra/i.test(difRateio), `[${rotulo}] rateio 60%+40% acusa diferença: ${difRateio}`);
      const gerador = page.getByTestId('gerador-parcelas');
      await visivel(gerador.getByLabel(/Nº de parcelas/)).fill('3');
      await clicar(gerador.getByRole('button', { name: 'Gerar parcelas' }));
      await page.getByTestId('parcela-2-valor').first().waitFor();
      const dif = await visivel(page.getByTestId('parcelas-diferenca')).innerText();
      conferir(!/falta|sobra/i.test(dif), `[${rotulo}] parcelas 3×300 acusam diferença: ${dif}`);
      await shot('06-receber-parcelado');
      const { resumo, bloqueios } = await confirmarPelaTela('07-receber-parcelado');
      conferir(/3 parcelas/i.test(resumo) && /900,00/.test(resumo), `[${rotulo}] resumo do parcelado inesperado: ${resumo.slice(0, 200)}`);
      conferir(!bloqueios.trim(), `[${rotulo}] prévia do parcelado com bloqueio: ${bloqueios.slice(0, 200)}`);
      await confirmarDefinitivo('08-receber-parcelado');
      const op = await esperarBanco(async () => {
        const u = await ultimaOperacao(s);
        return u && u.direcao === 'RECEBER' && u.status === 'CONFIRMADO' ? u : null;
      }, 'RECEBER parcelado confirmado');
      const d = await operacaoCompleta(s, op.id);
      igual(dec(d.valor_total), '900.0000', `[${rotulo}] parcelado valor_total`);
      igual(
        d.titulos.map((t) => `${t.numero_parcela}/${t.total_parcelas}:${t.status}:${dec(t.valor)}:${diaDe(t.vencimento)}`).join('|'),
        [1, 2, 3].map((k) => `${k}/3:ABERTO:300.0000:${somarDias(hoje, 30 * k)}`).join('|'),
        `[${rotulo}] títulos do parcelado`,
      );
      igual(
        d.rateios.map((r) => `${r.natureza_nome}:${r.natureza_tipo}:${dec(r.valor)}:${r.percentual?.toFixed(6)}`).join('|'),
        'VENDA DE INSUMOS:RECEITA:540.0000:60.000000|SERVIÇOS PRESTADOS:RECEITA:360.0000:40.000000',
        `[${rotulo}] rateio PERCENTUAL do parcelado`,
      );
      igual(d.rateio_modo, 'PERCENTUAL', `[${rotulo}] rateio_modo do parcelado`);
      docs.receberParcelado = d;
    });

    // 4. PAGAR com produtos: 100 SACO × 80 no DEPÓSITO 01.
    await passo('4 PAGAR com produtos 100 SACO x 80 no DEPOSITO 01', async () => {
      const racaoAntes = await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.produtos.racao.id } });
      await novo();
      await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
      await radio('escolha-conteudo', 'Com produtos');
      await escolher('seletor-produto-0', /RAÇÃO/);
      await escolher('seletor-local-0', /DEPÓSITO 01/);
      const unidade = visivel(page.getByRole('combobox', { name: 'Unidade do item 1' }));
      await unidade.click();
      await page.getByRole('option', { name: 'SACO', exact: true }).first().click();
      await page.waitForTimeout(200);
      await preencher('item-0-quantidade', '100');
      await preencher('item-0-valor-unitario', '80,00');
      await preencher('data-operacional', hoje);
      await clicar(page.getByTestId('declaracao-efeito-fisico'));
      const kgTexto = (await page.getByTestId('item-0-kg').count()) ? await visivel(page.getByTestId('item-0-kg')).innerText() : '';
      conferir(/3\.000|3000/.test(kgTexto), `[${rotulo}] conversão SACO→kg não mostrada (esperado 3.000 kg): "${kgTexto}"`);
      await escolher('seletor-natureza-0', /INSUMOS/);
      await shot('09-compra-saco');
      const { resumo, bloqueios } = await confirmarPelaTela('10-compra');
      conferir(/8\.000,00/.test(resumo), `[${rotulo}] resumo da compra sem o total 8.000,00: ${resumo.slice(0, 200)}`);
      conferir(!bloqueios.trim(), `[${rotulo}] prévia da compra com bloqueio: ${bloqueios.slice(0, 200)}`);
      // À vista: baixa no ato (pagamento registrado na confirmação, mesma transação).
      await clicar(page.getByTestId('baixa-no-ato'));
      await clicar(page.getByRole('dialog').getByRole('radio', { name: 'Pix', exact: true }));
      await shot('10b-compra-baixa-no-ato');
      await confirmarDefinitivo('11-compra');
      const op = await esperarBanco(async () => {
        const u = await ultimaOperacao(s);
        return u && u.conteudo === 'COM_PRODUTOS' && u.status === 'CONFIRMADO' ? u : null;
      }, 'compra confirmada');
      const d = await operacaoCompleta(s, op.id);
      const it = d.itens[0];
      igual(`${it.unidade}:${dec(it.quantidade)}:${dec(it.fator_kg)}:${dec(it.quantidade_estoque)}:${it.valor_unitario.toFixed(6)}:${dec(it.valor_total)}`, 'SACO:100.0000:30.0000:3000.0000:80.000000:8000.0000', `[${rotulo}] item da compra`);
      igual(diaDe(d.data_operacional), hoje, `[${rotulo}] data_operacional da compra`);
      const lote = await prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s.cliente_id, id: it.estoque_lote_nota_id } });
      exigir(lote, `[${rotulo}] lote da compra não gravado`);
      igual(`${dec(lote.quantidade_entrada)}:${dec(lote.quantidade_disponivel)}:${dec(lote.custo_unitario)}:${lote.status}:${lote.local_estoque_id}`, `3000.0000:3000.0000:2.6667:Disponivel:${s.local.id}`, `[${rotulo}] lote da compra`);
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: it.movimentacao_estoque_id } });
      exigir(mov, `[${rotulo}] movimento da compra não gravado`);
      igual(`${mov.tipo_movimentacao}:${mov.tipo_detalhado}:${dec(mov.quantidade)}:${dec(mov.valor_total)}:${dec(mov.valor_unitario)}:${mov.lancamento_origem_id}:${mov.local_estoque_destino}`, `Entrada:compra_financeiro:3000.0000:8000.0000:2.6667:${d.id}:${s.local.id}`, `[${rotulo}] movimento da compra`);
      igual(lote.movimentacao_entrada_id, mov.id, `[${rotulo}] lote ↔ movimento`);
      const racao = await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.produtos.racao.id } });
      igual(dec(racao.estoque_atual), (Number(racaoAntes.estoque_atual) + 3000).toFixed(4), `[${rotulo}] estoque_atual da RAÇÃO`);
      igual(d.titulos.map((t) => `${t.status}:${dec(t.valor)}:${dec(t.valor_liquidado)}:${diaDe(t.vencimento)}`).join('|'), `QUITADO:8000.0000:8000.0000:${hoje}`, `[${rotulo}] título da compra à vista com baixa no ato`);
      const liqAto = await prisma.liquidacaoFinanceira.findMany({ where: { cliente_id: s.cliente_id, titulo_id: d.titulos[0].id } });
      igual(liqAto.map((l) => `${dec(l.valor)}:${l.metodo}:${diaDe(l.data)}`).join('|'), `8000.0000:PIX:${hoje}`, `[${rotulo}] liquidação da baixa no ato`);
      docs.compra = d;
    });

    // 5. RECEBER com produtos: 5 kg de SAL MINERAL, FIFO.
    await passo('5 RECEBER com produtos 5 kg FIFO', async () => {
      await novo();
      await radio('escolha-direcao', 'A receber');
      await escolher('seletor-parceiro', /FRIGORÍFICO CENTRAL/);
      await radio('escolha-conteudo', 'Com produtos');
      await escolher('seletor-produto-0', /SAL MINERAL/);
      const saldos = page.getByTestId('saldos-item-0');
      await visivel(saldos.getByRole('button', { name: /DEPÓSITO 01/ })).waitFor();
      const textoSaldo = await visivel(saldos).innerText();
      conferir(/13/.test(textoSaldo), `[${rotulo}] saldo do DEPÓSITO 01 não mostra 13 kg: ${textoSaldo.slice(0, 160)}`);
      await clicar(saldos.getByRole('button', { name: /DEPÓSITO 01/ }));
      await preencher('item-0-quantidade', '5');
      await preencher('item-0-valor-unitario', '20,00');
      await preencher('data-operacional', hoje);
      await clicar(page.getByTestId('declaracao-efeito-fisico'));
      await escolher('seletor-natureza-0', /VENDA DE INSUMOS/);
      await shot('12-venda-fifo');
      const { resumo, bloqueios } = await confirmarPelaTela('13-venda');
      conferir(/100,00/.test(resumo), `[${rotulo}] resumo da venda sem 100,00: ${resumo.slice(0, 200)}`);
      conferir(!bloqueios.trim(), `[${rotulo}] prévia da venda com bloqueio: ${bloqueios.slice(0, 200)}`);
      await confirmarDefinitivo('14-venda');
      const op = await esperarBanco(async () => {
        const u = await ultimaOperacao(s);
        return u && u.direcao === 'RECEBER' && u.conteudo === 'COM_PRODUTOS' && u.status === 'CONFIRMADO' ? u : null;
      }, 'venda confirmada');
      const d = await operacaoCompleta(s, op.id);
      const it = d.itens[0];
      const consumos = await prisma.operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: s.cliente_id, item_id: it.id }, orderBy: { custo_unitario: 'asc' } });
      const [l1, l2] = s.lotes_sal;
      igual(consumos.map((c) => `${c.estoque_lote_nota_id === l1.id ? 'L1' : c.estoque_lote_nota_id === l2.id ? 'L2' : c.estoque_lote_nota_id}:${dec(c.quantidade)}:${dec(c.custo_unitario)}`).join('|'), 'L1:3.0000:10.0000|L2:2.0000:12.0000', `[${rotulo}] fatias FIFO`);
      const lotes = await prisma.estoqueLoteNota.findMany({ where: { cliente_id: s.cliente_id, id: { in: [l1.id, l2.id] } }, orderBy: { custo_unitario: 'asc' } });
      igual(lotes.map((l) => `${dec(l.quantidade_disponivel)}:${l.status}`).join('|'), '0.0000:Esgotado|8.0000:Disponivel', `[${rotulo}] lotes após a venda`);
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: it.movimentacao_estoque_id } });
      exigir(mov, `[${rotulo}] movimento da venda não gravado`);
      igual(`${mov.tipo_movimentacao}:${mov.tipo_detalhado}:${dec(mov.quantidade)}:${dec(mov.valor_total)}:${dec(mov.valor_unitario)}:${mov.local_estoque_origem}`, `Saída:venda_financeiro:5.0000:54.0000:10.8000:${s.local.id}`, `[${rotulo}] movimento da venda (custo FIFO, nunca preço de venda)`);
      const sal = await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.produtos.sal.id } });
      igual(dec(sal.estoque_atual), '8.0000', `[${rotulo}] estoque_atual do SAL após a venda`);
      igual(d.titulos.map((t) => `${t.status}:${dec(t.valor)}`).join('|'), 'ABERTO:100.0000', `[${rotulo}] título da venda`);
      docs.venda = d;
    });

    // 6. Baixa parcial (200) e estorno da baixa no PAGAR 500.
    await passo('6 baixa parcial 200 e estorno', async () => {
      await abrirDocumento(docs.pagar);
      await clicar(page.getByTestId('botao-liquidar-1'));
      const dlg = page.getByTestId('dialogo-liquidacao');
      await dlg.waitFor({ state: 'visible' });
      await preencher('liquidacao-valor', '200,00');
      await clicar(page.getByRole('dialog').getByRole('radio', { name: 'Pix', exact: true }));
      await shot('15-dialogo-baixa');
      await clicar(page.getByTestId('botao-registrar-liquidacao'));
      const tit = await esperarBanco(async () => {
        const t = await prisma.tituloFinanceiro.findFirst({ where: { cliente_id: s.cliente_id, operacao_id: docs.pagar.id } });
        return t && t.status === 'PARCIAL' ? t : null;
      }, 'título PARCIAL após a baixa');
      igual(dec(tit.valor_liquidado), '200.0000', `[${rotulo}] valor_liquidado após a baixa`);
      const liq = await prisma.liquidacaoFinanceira.findFirst({ where: { cliente_id: s.cliente_id, titulo_id: tit.id } });
      igual(`${dec(liq.valor)}:${liq.metodo}:${diaDe(liq.data)}`, `200.0000:PIX:${hoje}`, `[${rotulo}] liquidação`);
      await dlg.waitFor({ state: 'hidden' }).catch(() => {});
      await page.waitForTimeout(500);
      const saldoTxt = await visivel(page.getByTestId('titulo-1-saldo')).innerText();
      conferir(/300,00/.test(saldoTxt), `[${rotulo}] saldo da parcela na tela não é 300,00: ${saldoTxt}`);
      await shot('16-baixa-parcial');
      await clicar(page.getByTestId(`botao-estornar-${liq.id}`));
      await page.getByTestId('dialogo-estorno').waitFor({ state: 'visible' });
      await preencher('dialogo-estorno-motivo', 'Baixa lançada no título errado');
      await shot('17-dialogo-estorno');
      await clicar(page.getByTestId('dialogo-estorno-enviar'));
      const tit2 = await esperarBanco(async () => {
        const t = await prisma.tituloFinanceiro.findFirst({ where: { cliente_id: s.cliente_id, id: tit.id } });
        return t && t.status === 'ABERTO' ? t : null;
      }, 'título ABERTO após o estorno');
      igual(dec(tit2.valor_liquidado), '0.0000', `[${rotulo}] valor_liquidado após o estorno`);
      const est = await prisma.liquidacaoFinanceiraEstorno.findFirst({ where: { cliente_id: s.cliente_id, liquidacao_id: liq.id } });
      exigir(est, `[${rotulo}] estorno não gravado`);
      igual(diaDe(est.data), hoje, `[${rotulo}] data do estorno (hoje da fazenda)`);
      await page.waitForTimeout(600);
      const liqTxt = await visivel(page.getByTestId(`liquidacao-${liq.id}`)).innerText();
      conferir(/estornad/i.test(liqTxt), `[${rotulo}] baixa estornada não aparece marcada: ${liqTxt.slice(0, 160)}`);
      // O detalhe real traz o estorno como linha própria (id do estorno): tem de
      // aparecer como ESTORNO, sem "Estornar baixa" (que levaria a 404).
      const linhaEstorno = visivel(page.getByTestId(`liquidacao-${est.id}`));
      const estTxt = (await linhaEstorno.count()) ? await linhaEstorno.innerText() : '';
      conferir(/Estorno/.test(estTxt) && /título errado/.test(estTxt), `[${rotulo}] linha do estorno não aparece como estorno com o motivo: "${estTxt.slice(0, 160)}"`);
      igual(await page.getByTestId(`botao-estornar-${est.id}`).count(), 0, `[${rotulo}] botão "Estornar baixa" na linha do próprio estorno`);
      const tituloCancelar = await visivel(page.getByTestId('botao-cancelar-lancamento')).getAttribute('title');
      igual(tituloCancelar, null, `[${rotulo}] cancelar acusa baixa ativa depois do estorno`);
      await shot('18-estornada');
    });

    // 7. Cancelar documento COM baixa → recusa amigável.
    await passo('7 cancelar documento com baixa (recusa)', async () => {
      esperarRecusa(/^POST \/api\/native\/operacoes-financeiras\/[^/]+\/cancelar → 409 \{"code":"OPERACAO_COM_LIQUIDACOES"/, 'passo 7: cancelar com baixa → 409 OPERACAO_COM_LIQUIDACOES');
      await abrirDocumento(docs.receberParcelado);
      await clicar(page.getByTestId('botao-liquidar-1'));
      await page.getByTestId('dialogo-liquidacao').waitFor({ state: 'visible' });
      await preencher('liquidacao-valor', '100,00');
      await clicar(page.getByRole('dialog').getByRole('radio', { name: 'Dinheiro', exact: true }));
      await clicar(page.getByTestId('botao-registrar-liquidacao'));
      await esperarBanco(async () => {
        const t = await prisma.tituloFinanceiro.findFirst({ where: { cliente_id: s.cliente_id, operacao_id: docs.receberParcelado.id, numero_parcela: 1 } });
        return t && t.status === 'PARCIAL' ? t : null;
      }, 'parcela 1 PARCIAL');
      await page.getByTestId('dialogo-liquidacao').waitFor({ state: 'hidden' }).catch(() => {});
      await page.waitForTimeout(500);
      const antes = await fotoFinanceiro(s);
      await clicar(page.getByTestId('botao-cancelar-lancamento'));
      await page.getByTestId('dialogo-cancelamento').waitFor({ state: 'visible' });
      await preencher('dialogo-cancelamento-motivo', 'Lançado em duplicidade');
      await clicar(page.getByTestId('dialogo-cancelamento-enviar'));
      const msg = page.getByText(/Estorne as baixas antes de cancelar/).first();
      await msg.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      conferir(await msg.isVisible(), `[${rotulo}] mensagem amigável de OPERACAO_COM_LIQUIDACOES não apareceu`);
      await shot('19-cancelar-com-baixa-recusado');
      igual(await fotoFinanceiro(s), antes, `[${rotulo}] cancelamento recusado alterou o financeiro`);
      const op = await prisma.operacaoFinanceira.findFirst({ where: { cliente_id: s.cliente_id, id: docs.receberParcelado.id } });
      igual(op.status, 'CONFIRMADO', `[${rotulo}] documento com baixa continua CONFIRMADO`);
      await page.keyboard.press('Escape').catch(() => {});
    });

    // 8. Venda sem saldo → bloqueio, nada muda.
    await passo('8 venda sem saldo (50 kg) sem efeito', async () => {
      const estoqueAntes = await fotoEstoque(s);
      await novo();
      await radio('escolha-direcao', 'A receber');
      await escolher('seletor-parceiro', /FRIGORÍFICO CENTRAL/);
      await radio('escolha-conteudo', 'Com produtos');
      await escolher('seletor-produto-0', /SAL MINERAL/);
      await escolher('seletor-local-0', /DEPÓSITO 01/);
      await preencher('item-0-quantidade', '50');
      await preencher('item-0-valor-unitario', '20,00');
      await preencher('data-operacional', hoje);
      await clicar(page.getByTestId('declaracao-efeito-fisico'));
      await escolher('seletor-natureza-0', /VENDA DE INSUMOS/);
      const { bloqueios } = await confirmarPelaTela('20-venda-sem-saldo');
      conferir(/insuficiente/i.test(bloqueios), `[${rotulo}] prévia não mostrou saldo insuficiente: "${bloqueios.slice(0, 200)}"`);
      const botao = page.getByTestId('botao-confirmar-definitivo');
      if ((await botao.count()) && (await botao.first().isEnabled())) {
        await botao.first().click();
        await page.waitForTimeout(1500);
        const erro = page.getByText(/insuficiente/i).first();
        conferir(await erro.isVisible(), `[${rotulo}] confirmação sem saldo não mostrou erro`);
      }
      await shot('21-venda-sem-saldo-erro');
      igual(await fotoEstoque(s), estoqueAntes, `[${rotulo}] venda sem saldo alterou o estoque`);
      const op = await ultimaOperacao(s);
      igual(op.status, 'RASCUNHO', `[${rotulo}] venda sem saldo ficou como rascunho`);
      const tit = await prisma.tituloFinanceiro.findMany({ where: { cliente_id: s.cliente_id, operacao_id: op.id } });
      igual(tit.map((t) => t.status).join('|'), 'PREVISTO', `[${rotulo}] parcela do rascunho continua PREVISTA`);
      docs.vendaSemSaldo = op;
      await page.keyboard.press('Escape').catch(() => {});
    });

    // 9. Cancelar documento SEM baixa (a venda FIFO) → lotes devolvidos.
    await passo('9 cancelar documento sem baixa (venda FIFO)', async () => {
      await abrirDocumento(docs.venda);
      await clicar(page.getByTestId('botao-cancelar-lancamento'));
      await page.getByTestId('dialogo-cancelamento').waitFor({ state: 'visible' });
      await preencher('dialogo-cancelamento-motivo', 'Venda desfeita pelo cliente');
      await clicar(page.getByTestId('dialogo-cancelamento-enviar'));
      const op = await esperarBanco(async () => {
        const o = await operacaoCompleta(s, docs.venda.id);
        return o && o.status === 'CANCELADO' ? o : null;
      }, 'venda CANCELADA');
      igual(op.titulos.map((t) => t.status).join('|'), 'CANCELADO', `[${rotulo}] títulos da venda cancelada`);
      igual(op.documento_chave_ativa, null, `[${rotulo}] chave documental liberada no cancelamento`);
      const [l1, l2] = s.lotes_sal;
      const lotes = await prisma.estoqueLoteNota.findMany({ where: { cliente_id: s.cliente_id, id: { in: [l1.id, l2.id] } }, orderBy: { custo_unitario: 'asc' } });
      igual(lotes.map((l) => `${dec(l.quantidade_disponivel)}:${l.status}`).join('|'), '3.0000:Disponivel|10.0000:Disponivel', `[${rotulo}] lotes devolvidos ao cancelar a venda`);
      const it = op.itens[0];
      exigir(it.movimentacao_estorno_id, `[${rotulo}] item sem movimentacao_estorno_id`);
      const original = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: it.movimentacao_estoque_id } });
      const estorno = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: it.movimentacao_estorno_id } });
      igual(`${original.status}:${original.movimento_filho_id === estorno.id}`, 'Estornada:true', `[${rotulo}] movimento original estornado e ligado`);
      igual(`${estorno.tipo_movimentacao}:${estorno.tipo_detalhado}:${dec(estorno.quantidade)}:${estorno.movimento_pai_id === original.id}:${diaDe(estorno.data_movimentacao)}`, `Entrada:estorno_venda:5.0000:true:${hoje}`, `[${rotulo}] movimento de estorno da venda`);
      const sal = await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.produtos.sal.id } });
      igual(dec(sal.estoque_atual), '13.0000', `[${rotulo}] estoque_atual do SAL após cancelar a venda`);
      await page.waitForTimeout(600);
      await visivel(page.getByTestId('aviso-cancelado')).waitFor().catch(() => conferir(false, `[${rotulo}] aviso de cancelado não apareceu na consulta`));
      await shot('22-venda-cancelada');
    });

    // 10. Editar o rascunho sem saldo (PUT) e confirmar com a RESPOSTA PERDIDA:
    //     a tela mostra "resultado incerto" e o "Repetir o mesmo envio" reusa o
    //     operation_id — o servidor devolve o replay e nada é duplicado.
    await passo('10 editar rascunho (PUT) e confirmar com resposta perdida', async () => {
      await abrirDocumento(docs.vendaSemSaldo);
      await clicar(page.getByRole('button', { name: 'Editar', exact: true }));
      await preencher('item-0-quantidade', '4');
      await page.waitForTimeout(200);
      const enviados = [];
      await page.route(
        (u) => u.pathname.endsWith(`/operacoes-financeiras/${docs.vendaSemSaldo.id}/confirmar`),
        async (route) => {
          const req = route.request();
          if (req.method() !== 'POST') return route.continue();
          enviados.push(JSON.parse(req.postData() || '{}').operation_id);
          if (enviados.length === 1) {
            await route.fetch(); // chega ao servidor e é processada…
            return route.abort('failed'); // …mas a resposta se perde no caminho
          }
          return route.continue();
        },
      );
      const { bloqueios } = await confirmarPelaTela('24-edicao-previa');
      conferir(!bloqueios.trim(), `[${rotulo}] prévia da venda editada com bloqueio: ${bloqueios.slice(0, 200)}`);
      await clicar(page.getByTestId('botao-confirmar-definitivo'));
      await visivel(page.getByTestId('resultado-incerto')).waitFor();
      await shot('25-resultado-incerto');
      await clicar(page.getByTestId('botao-confirmar-definitivo'));
      await visivel(page.getByTestId('consulta-lancamento')).waitFor({ timeout: 30000 });
      const aviso = page.getByText(/nada foi duplicado/i).first();
      await aviso.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      conferir(await aviso.isVisible(), `[${rotulo}] replay não foi comunicado ("nada foi duplicado")`);
      await shot('26-replay-confirmado');
      await page.unroute((u) => u.pathname.endsWith(`/operacoes-financeiras/${docs.vendaSemSaldo.id}/confirmar`));
      igual(enviados.length, 2, `[${rotulo}] envios de confirmação`);
      conferir(enviados[0] && enviados[0] === enviados[1], `[${rotulo}] repetição não reusou o operation_id (${enviados.join(' ≠ ')})`);
      const d = await operacaoCompleta(s, docs.vendaSemSaldo.id);
      igual(`${d.status}:${dec(d.valor_total)}:${dec(d.itens[0].quantidade)}`, 'CONFIRMADO:80.0000:4.0000', `[${rotulo}] rascunho editado e confirmado`);
      conferir(d.versao >= 2, `[${rotulo}] PUT do rascunho não incrementou a versão (versao=${d.versao})`);
      const movimentos = await prisma.movimentacaoEstoque.findMany({ where: { cliente_id: s.cliente_id, lancamento_origem_id: d.id } });
      igual(movimentos.length, 1, `[${rotulo}] movimentos da confirmação repetida (sem duplicar)`);
      const consumos = await prisma.operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: s.cliente_id, item_id: d.itens[0].id }, orderBy: { custo_unitario: 'asc' } });
      const [l1, l2] = s.lotes_sal;
      igual(consumos.map((c) => `${c.estoque_lote_nota_id === l1.id ? 'L1' : 'L2'}:${dec(c.quantidade)}`).join('|'), 'L1:3.0000|L2:1.0000', `[${rotulo}] FIFO após devolução dos lotes`);
      const lotes = await prisma.estoqueLoteNota.findMany({ where: { cliente_id: s.cliente_id, id: { in: [l1.id, l2.id] } }, orderBy: { custo_unitario: 'asc' } });
      igual(lotes.map((l) => `${dec(l.quantidade_disponivel)}:${l.status}`).join('|'), '0.0000:Esgotado|9.0000:Disponivel', `[${rotulo}] lotes após a venda editada`);
      const sal = await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.produtos.sal.id } });
      igual(dec(sal.estoque_atual), '9.0000', `[${rotulo}] estoque_atual do SAL após a venda editada`);
    });

    // 11. Rascunho salvo pelo "Salvar" e descartado (DELETE com versão).
    await passo('11 salvar e descartar rascunho', async () => {
      const antes = await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } });
      await novo();
      await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
      await preencher('valor-bruto', '50,00');
      await escolher('seletor-natureza-0', /FRETE/);
      await clicar(page.getByRole('button', { name: 'Salvar', exact: true }));
      const rascunho = await esperarBanco(async () => {
        const u = await ultimaOperacao(s);
        return u && u.status === 'RASCUNHO' && dec(u.valor_total) === '50.0000' ? u : null;
      }, 'rascunho salvo');
      await visivel(page.getByTestId('botao-descartar-rascunho')).waitFor();
      await clicar(page.getByTestId('botao-descartar-rascunho'));
      await page.getByTestId('dialogo-descarte').waitFor({ state: 'visible' });
      await clicar(page.getByTestId('dialogo-descarte-enviar'));
      await esperarBanco(async () => !(await prisma.operacaoFinanceira.findFirst({ where: { cliente_id: s.cliente_id, id: rascunho.id } })), 'rascunho apagado');
      igual(await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }), antes, `[${rotulo}] contagem de documentos após descartar`);
      igual(await prisma.tituloFinanceiro.count({ where: { cliente_id: s.cliente_id, operacao_id: rascunho.id } }), 0, `[${rotulo}] parcelas do rascunho descartado`);
      await shot('27-rascunho-descartado');
    });

    await passo('12 lista final com filtros', async () => {
      await irParaLista();
      await shot('28-lista-final');
      const filtrar = async (nome, opcao) => {
        await clicar(page.getByRole('combobox', { name: nome }));
        await page.getByRole('option', { name: opcao, exact: true }).first().click();
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(700);
      };
      await filtrar('Filtrar por direção', 'A pagar');
      await filtrar('Filtrar por situação', 'Confirmados');
      const esperado = await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id, direcao: 'PAGAR', status: 'CONFIRMADO' } });
      const rodape = await visivel(page.getByText(/Listados:\s*\d+/)).innerText();
      conferir(new RegExp(`Listados:\\s*${esperado}\\b`).test(rodape), `[${rotulo}] filtro A pagar + Confirmados: esperado ${esperado}, rodapé "${rodape}"`);
      await shot('29-lista-filtrada');
    });

    const tituloDa = (op, parcela) => prisma.tituloFinanceiro.findFirst({ where: { cliente_id: s.cliente_id, operacao_id: op.id, numero_parcela: parcela } });
    const baixasDo = (tituloId) =>
      prisma.liquidacaoFinanceira.findMany({ where: { cliente_id: s.cliente_id, titulo_id: tituloId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const liquidacoesUrl = (tituloId) => (u) => u.pathname.endsWith(`/titulos-financeiros/${tituloId}/liquidacoes`);
    const chaveDe = (req) => {
      try {
        return JSON.parse(req.postData() || '{}').operation_id ?? null;
      } catch {
        return null;
      }
    };
    /** Rota que deixa o envio chegar ao servidor e PERDE a resposta nos envios `perder` (1-based). */
    const perderRespostas = async (alvo, perder, chaves) => {
      await page.route(alvo, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.continue();
        chaves.push(chaveDe(req));
        if (perder.includes(chaves.length)) {
          await route.fetch(); // chega ao servidor e é gravado…
          return route.abort('failed'); // …mas a resposta se perde no caminho
        }
        return route.continue();
      });
    };

    // 13. A MESMA baixa duas vezes de propósito: dois fatos, duas chaves.
    await passo('13 mesma baixa 2x de proposito na parcela (as duas gravadas)', async () => {
      const tit = await tituloDa(docs.receberParcelado, 2);
      await abrirDocumento(docs.receberParcelado);
      const chaves = [];
      const ouvir = (req) => {
        if (req.method() === 'POST' && liquidacoesUrl(tit.id)(new URL(req.url()))) chaves.push(chaveDe(req));
      };
      page.on('request', ouvir);
      try {
        for (let k = 1; k <= 2; k += 1) {
          const dlg = await dono.registrarBaixa(2, '100,00', 'Dinheiro');
          await esperarBanco(async () => (await baixasDo(tit.id)).length === k, `${k}ª baixa de 100,00 gravada`);
          await dlg.waitFor({ state: 'hidden' }).catch(() => {});
          await page.waitForTimeout(300);
          igual(await page.getByText(/nada foi duplicado/i).count(), 0, `[${rotulo}] ${k}ª baixa igual tratada como "envio repetido"`);
          igual(await page.getByRole('alertdialog').count(), 0, `[${rotulo}] ${k}ª baixa igual (sem envio pendente) abriu pergunta`);
          await page.waitForTimeout(400);
        }
      } finally {
        page.off('request', ouvir);
      }
      const baixas = await baixasDo(tit.id);
      igual(baixas.map((l) => `${dec(l.valor)}:${l.metodo}:${diaDe(l.data)}`).join('|'), `100.0000:DINHEIRO:${hoje}|100.0000:DINHEIRO:${hoje}`, `[${rotulo}] as duas baixas iguais`);
      igual(await prisma.liquidacaoFinanceiraEstorno.count({ where: { cliente_id: s.cliente_id, liquidacao_id: { in: baixas.map((l) => l.id) } } }), 0, `[${rotulo}] estornos nas baixas iguais`);
      const t = await tituloDa(docs.receberParcelado, 2);
      igual(`${t.status}:${dec(t.valor_liquidado)}`, 'PARCIAL:200.0000', `[${rotulo}] parcela 2 depois das duas baixas`);
      igual(chaves.length, 2, `[${rotulo}] envios das duas baixas`);
      conferir(chaves[0] && chaves[1] && chaves[0] !== chaves[1], `[${rotulo}] as duas baixas saíram com a MESMA chave (${chaves.join(' = ')})`);
      const saldoTxt = await visivel(page.getByTestId('titulo-2-saldo')).innerText();
      conferir(/100,00/.test(saldoTxt), `[${rotulo}] saldo da parcela 2 na tela não é 100,00: ${saldoTxt}`);
      await shot('30-baixa-repetida-de-proposito');
    });

    // 14. Resposta perdida → Consultar → a 2ª baixa igual é um fato NOVO (DINHEIRO-2).
    await passo('14 baixa sem resposta, Consultar e 2a baixa igual gravada (DINHEIRO-2)', async () => {
      const tit = await tituloDa(docs.receberParcelado, 3);
      const chaves = [];
      const alvo = liquidacoesUrl(tit.id);
      await perderRespostas(alvo, [1], chaves);
      try {
        await abrirDocumento(docs.receberParcelado);
        await dono.registrarBaixa(3, '150,00', 'Pix');
        await visivel(page.getByTestId('resultado-incerto')).waitFor();
        await esperarBanco(async () => (await baixasDo(tit.id)).length === 1, '1ª baixa (resposta perdida) gravada no servidor');
        await shot('31-baixa-resultado-incerto');
        await clicar(page.getByTestId('botao-consultar-resultado'));
        await page.getByTestId('dialogo-liquidacao').waitFor({ state: 'hidden' });
        await page.waitForTimeout(500);
        const saldo1 = await visivel(page.getByTestId('titulo-3-saldo')).innerText();
        conferir(/150,00/.test(saldo1), `[${rotulo}] Consultar não mostrou o saldo 150,00 da parcela 3: ${saldo1}`);
        await dono.registrarBaixa(3, '150,00', 'Pix');
        // Sem pergunta: o Consultar mostrou o efeito e resolveu a pendência.
        let estado = null;
        const ate = Date.now() + 15000;
        while (Date.now() < ate && !estado) {
          if (await page.getByRole('alertdialog').count()) estado = 'perguntou';
          else if ((await tituloDa(docs.receberParcelado, 3)).status === 'QUITADO') estado = 'gravou';
          else await dormir(300);
        }
        if (estado !== 'gravou') {
          const agora = await tituloDa(docs.receberParcelado, 3);
          const replay = (await page.getByText(/nada foi duplicado/i).count()) > 0;
          exigir(false, `[${rotulo}] 2ª baixa igual depois do Consultar não foi gravada como nova (resultado: ${estado ?? 'nada em 15 s'}; banco: ${(await baixasDo(tit.id)).length} baixa(s), ${agora.status} ${dec(agora.valor_liquidado)}; aviso de envio repetido: ${replay ? 'sim' : 'não'}) — DINHEIRO-2`);
        }
        await page.getByTestId('dialogo-liquidacao').waitFor({ state: 'hidden' }).catch(() => {});
        await page.waitForTimeout(300);
        igual(await page.getByText(/nada foi duplicado/i).count(), 0, `[${rotulo}] 2ª baixa (fato novo) mostrada como "envio repetido"`);
        await shot('32-segunda-baixa-gravada');
      } finally {
        await page.unroute(alvo);
      }
      const baixas = await baixasDo(tit.id);
      igual(baixas.map((l) => `${dec(l.valor)}:${l.metodo}:${diaDe(l.data)}`).join('|'), `150.0000:PIX:${hoje}|150.0000:PIX:${hoje}`, `[${rotulo}] baixas da parcela 3`);
      const t = await tituloDa(docs.receberParcelado, 3);
      igual(`${t.status}:${dec(t.valor_liquidado)}`, 'QUITADO:300.0000', `[${rotulo}] parcela 3 quitada pelas duas baixas`);
      igual(chaves.length, 2, `[${rotulo}] envios da parcela 3`);
      conferir(chaves[0] && chaves[1] && chaves[0] !== chaves[1], `[${rotulo}] a 2ª baixa reaproveitou a chave da 1ª (${chaves.join(' = ')})`);
    });

    // 15. Resposta perdida, diálogo fechado e reaberto: Manter / repetir / Enviar como novo.
    await passo('15 baixa sem resposta e dialogo reaberto: Manter, repetir, Enviar como novo', async () => {
      const tit = await tituloDa(docs.pagar, 1);
      const idsAntes = new Set((await baixasDo(tit.id)).map((l) => l.id));
      const novas = async () => (await baixasDo(tit.id)).filter((l) => !idsAntes.has(l.id));
      const chaves = [];
      const alvo = liquidacoesUrl(tit.id);
      const fecharDialogo = async () => {
        await clicar(page.getByTestId('dialogo-liquidacao').getByRole('button', { name: 'Voltar', exact: true }));
        await page.getByTestId('dialogo-liquidacao').waitFor({ state: 'hidden' });
      };
      const pergunta = page.getByRole('alertdialog');
      const esperarPergunta = async () => {
        const apareceu = await pergunta.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
        if (apareceu) return;
        const replay = (await page.getByText(/nada foi duplicado/i).count()) > 0;
        exigir(false, `[${rotulo}] envio NOVO de conteúdo igual com envio pendente não perguntou "mesmo envio ou novo?" (envios até aqui: ${chaves.length}, chave repetida: ${chaves.length > 1 && chaves.at(-1) === chaves[0] ? 'sim' : 'não'}, aviso de envio repetido: ${replay ? 'sim' : 'não'}) — FRONTEND-2`);
      };
      await perderRespostas(alvo, [1, 3], chaves);
      try {
        await abrirDocumento(docs.pagar);
        // envio 1 (chave K1): gravado, resposta perdida; o usuário fecha sem consultar
        await dono.registrarBaixa(1, '100,00', 'Pix');
        await visivel(page.getByTestId('resultado-incerto')).waitFor();
        await esperarBanco(async () => (await novas()).length === 1, 'envio 1 gravado');
        await fecharDialogo();
        // diálogo novo, MESMO conteúdo → pergunta; "Manter" não envia nada
        await dono.registrarBaixa(1, '100,00', 'Pix');
        await esperarPergunta();
        conferir(/IGUAL a este/i.test(await pergunta.innerText()), `[${rotulo}] pergunta do envio igual sem o texto esperado`);
        await shot('33-pergunta-envio-igual');
        await clicar(pergunta.getByRole('button', { name: 'Manter', exact: true }));
        await page.waitForTimeout(700);
        igual(chaves.length, 1, `[${rotulo}] "Manter" enviou algo`);
        conferir(await page.getByTestId('resultado-incerto').isVisible(), `[${rotulo}] depois de "Manter" o diálogo saiu do resultado incerto (FRONTEND-4)`);
        conferir(await page.getByTestId('botao-consultar-resultado').isVisible(), `[${rotulo}] depois de "Manter" sumiu o "Consultar" (FRONTEND-4)`);
        igual(await page.getByTestId('erro-envio').count(), 0, `[${rotulo}] "Manter" virou erro "Nada foi gravado" (FRONTEND-4)`);
        await shot('34-manter-segue-incerto');
        // repetir AQUELE envio (mesma chave) → replay, nada duplicado
        await clicar(page.getByTestId('botao-registrar-liquidacao'));
        const aviso = page.getByText(/nada foi duplicado/i).first();
        await aviso.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        conferir(await aviso.isVisible(), `[${rotulo}] repetição do envio sem resposta não comunicou o replay`);
        igual(chaves.length, 2, `[${rotulo}] envios até a repetição`);
        igual(chaves[1], chaves[0], `[${rotulo}] a repetição não reaproveitou a chave`);
        igual((await novas()).length, 1, `[${rotulo}] a repetição gravou outra baixa`);
        await page.getByTestId('dialogo-liquidacao').waitFor({ state: 'hidden' }).catch(() => {});
        await page.waitForTimeout(5000); // o aviso do replay sai antes da próxima conferência
        // envio 3 (chave K2): pagamento NOVO igual, de novo sem resposta
        await dono.registrarBaixa(1, '100,00', 'Pix');
        await visivel(page.getByTestId('resultado-incerto')).waitFor();
        await esperarBanco(async () => (await novas()).length === 2, 'envio 3 gravado');
        await fecharDialogo();
        // diálogo novo, mesmo conteúdo → pergunta; "Enviar como novo" grava outra (K3)
        await dono.registrarBaixa(1, '100,00', 'Pix');
        await esperarPergunta();
        await clicar(pergunta.getByRole('button', { name: 'Enviar como novo', exact: true }));
        await esperarBanco(async () => (await novas()).length === 3, '"Enviar como novo" gravado');
        await page.getByTestId('dialogo-liquidacao').waitFor({ state: 'hidden' }).catch(() => {});
        await page.waitForTimeout(300);
        igual(await page.getByText(/nada foi duplicado/i).count(), 0, `[${rotulo}] "Enviar como novo" mostrado como envio repetido`);
        await shot('35-enviar-como-novo');
      } finally {
        await page.unroute(alvo);
      }
      igual(chaves.length, 4, `[${rotulo}] envios do passo 15`);
      conferir(new Set([chaves[0], chaves[2], chaves[3]]).size === 3, `[${rotulo}] chaves K1/K2/K3 não são distintas: ${chaves.join(', ')}`);
      const baixas = await novas();
      igual(baixas.map((l) => `${dec(l.valor)}:${l.metodo}:${diaDe(l.data)}`).join('|'), Array(3).fill(`100.0000:PIX:${hoje}`).join('|'), `[${rotulo}] baixas novas do passo 15`);
      const t = await tituloDa(docs.pagar, 1);
      igual(`${t.status}:${dec(t.valor_liquidado)}`, 'PARCIAL:300.0000', `[${rotulo}] título do PAGAR 500 depois do passo 15`);
    });

    // 16. Trocar a moeda do perfil com lançamentos → recusa amigável, nada gravado.
    await passo('16 trocar moeda do perfil com lancamentos (409 MOEDA_EM_USO)', async () => {
      esperarRecusa(/^PUT \/api\/native\/perfis-financeiros-empresa → 409 \{"code":"PERFIL_FINANCEIRO_MOEDA_EM_USO".*"reason":"operacoes_existentes"/, 'passo 16: troca de moeda → 409 PERFIL_FINANCEIRO_MOEDA_EM_USO');
      const ondePerfil = { where: { cliente_id: s.cliente_id, empresa_id: s.empresa.id } };
      const antes = await prisma.perfilFinanceiroEmpresa.findFirst(ondePerfil);
      const auditoria = () => prisma.auditLog.count({ where: { cliente_id: s.cliente_id, acao: { startsWith: 'perfil_financeiro' } } });
      const auditAntes = await auditoria();
      await irParaLista();
      await clicar(page.getByRole('button', { name: 'Mais opções', exact: true }));
      await clicar(page.getByText('Perfil financeiro da empresa', { exact: true }));
      const painel = visivel(page.getByTestId('perfil-financeiro-edicao'));
      await painel.waitFor();
      conferir(/moeda fica fixa depois do primeiro lançamento/i.test(await painel.innerText()), `[${rotulo}] painel do perfil não avisa que a moeda fica fixa`);
      await clicar(page.getByRole('combobox', { name: 'Moeda' }));
      await page.getByRole('option', { name: /^USD/ }).first().click();
      await page.waitForTimeout(250);
      await shot('36-perfil-moeda-usd');
      await clicar(page.getByTestId('botao-confirmar-perfil'));
      const msg = page.getByText(/A moeda não pode ser trocada: esta empresa já tem lançamentos\. País e formato podem mudar\. Nada foi gravado\./).first();
      await msg.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      conferir(await msg.isVisible(), `[${rotulo}] mensagem amigável de PERFIL_FINANCEIRO_MOEDA_EM_USO não apareceu`);
      await shot('37-perfil-moeda-recusada');
      const depois = await prisma.perfilFinanceiroEmpresa.findFirst(ondePerfil);
      igual(`${depois.pais}:${depois.moeda}:${depois.locale}:${depois.updatedAt.toISOString()}`, `${antes.pais}:${antes.moeda}:${antes.locale}:${antes.updatedAt.toISOString()}`, `[${rotulo}] perfil depois da recusa`);
      igual(await auditoria(), auditAntes, `[${rotulo}] auditoria do perfil depois da recusa`);
      conferir(await painel.isVisible(), `[${rotulo}] painel do perfil fechou depois da recusa (o usuário perde o contexto)`);
      await clicar(page.getByTestId('perfil-financeiro-edicao').getByRole('button', { name: 'Fechar', exact: true }));
    });

    // 17. Compra da P3 consumida pelo estoque ANTIGO (comando de suplementação, API real).
    await passo('17 compra P3 consumida pelo estoque antigo (API real) e cancelamento recusado', async () => {
      const racao = () => prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.produtos.racao.id } });
      // 17a. compra A PRAZO de 10 SACO × 80,00 no DEPÓSITO 02, pela tela
      await novo();
      await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
      await radio('escolha-conteudo', 'Com produtos');
      await radio('escolha-condicao', 'A prazo');
      await preencher('prazo-vencimento', somarDias(hoje, 30));
      await escolher('seletor-produto-0', /RAÇÃO/);
      await escolher('seletor-local-0', /DEPÓSITO 02/);
      const unidade = visivel(page.getByRole('combobox', { name: 'Unidade do item 1' }));
      await unidade.click();
      await page.getByRole('option', { name: 'SACO', exact: true }).first().click();
      await page.waitForTimeout(200);
      await preencher('item-0-quantidade', '10');
      await preencher('item-0-valor-unitario', '80,00');
      await preencher('data-operacional', hoje);
      await clicar(page.getByTestId('declaracao-efeito-fisico'));
      await escolher('seletor-natureza-0', /INSUMOS/);
      const { resumo, bloqueios } = await confirmarPelaTela('38-compra-prazo-dep02');
      conferir(/800,00/.test(resumo), `[${rotulo}] resumo da compra a prazo sem 800,00: ${resumo.slice(0, 200)}`);
      conferir(!bloqueios.trim(), `[${rotulo}] prévia da compra a prazo com bloqueio: ${bloqueios.slice(0, 200)}`);
      await confirmarDefinitivo('39-compra-prazo-dep02');
      const op = await esperarBanco(async () => {
        const u = await ultimaOperacao(s);
        return u && u.conteudo === 'COM_PRODUTOS' && u.status === 'CONFIRMADO' && dec(u.valor_total) === '800.0000' ? u : null;
      }, 'compra a prazo confirmada');
      const d = await operacaoCompleta(s, op.id);
      const it = d.itens[0];
      const loteDe = () => prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s.cliente_id, id: it.estoque_lote_nota_id } });
      const lote = await loteDe();
      exigir(lote, `[${rotulo}] lote da compra a prazo não gravado`);
      igual(`${dec(lote.quantidade_entrada)}:${dec(lote.quantidade_disponivel)}:${dec(lote.custo_unitario)}:${lote.status}:${lote.local_estoque_id}`, `300.0000:300.0000:2.6667:Disponivel:${s.local2.id}`, `[${rotulo}] lote da compra a prazo`);
      igual(d.titulos.map((t) => `${t.status}:${dec(t.valor)}:${dec(t.valor_liquidado)}:${diaDe(t.vencimento)}`).join('|'), `ABERTO:800.0000:0.0000:${somarDias(hoje, 30)}`, `[${rotulo}] título da compra a prazo`);
      // 17b. estoque ANTIGO: o formulário do Mapa lê os lotes pela rota antiga
      // (`GET /estoque-lotes-nota`) para validar o FIFO e depois chama o comando
      // de suplementação com a quantidade em kg — o mesmo corpo, pela API real.
      const loteNaRotaAntiga = async () => {
        const r = await api(token, 'GET', `/api/native/estoque-lotes-nota?empresa_id=${s.empresa.id}&produto_id=${s.produtos.racao.id}&local_estoque_id=${s.local2.id}`);
        exigir(r.status === 200, `[${rotulo}] rota antiga de lotes: ${r.status}`);
        const lista = Array.isArray(r.corpo) ? r.corpo : (r.corpo?.items ?? r.corpo?.data ?? []);
        return lista.filter((l) => l.produto_id === s.produtos.racao.id).map((l) => `${l.id === lote.id ? 'LOTE_P3' : l.id}:${Number(l.quantidade_disponivel)}:${Number(l.custo_unitario)}:${l.status}`).join('|');
      };
      igual(await loteNaRotaAntiga(), 'LOTE_P3:300:2.6667:Disponivel', `[${rotulo}] lote da P3 visto pela rota antiga (antes do consumo)`);
      const antes = await racao();
      const movsAntes = await prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, produto_id: s.produtos.racao.id } });
      const resp = await api(token, 'POST', '/api/native/movimentacoes-estoque/comandos/saida-suplementacao', {
        operation_id: randomUUID(),
        empresa_id: s.empresa.id,
        produto_id: s.produtos.racao.id,
        local_origem_id: s.local2.id,
        local_origem_nome: s.local2.nome,
        quantidade: 60,
        area_id: null,
        area_nome: null,
        deposito_id: null,
        ponto_suplementacao_id: null,
        data_movimentacao: hoje,
        observacoes: 'Suplementação do cocho (ensaio E2E pelo comando antigo)',
      });
      exigir(resp.status === 201 && resp.corpo?.committed === true, `[${rotulo}] comando antigo de suplementação: ${resp.status} ${JSON.stringify(resp.corpo).slice(0, 240)}`);
      igual(
        (resp.corpo.rateio || []).map((r) => `${r.lote_id === lote.id ? 'LOTE_P3' : r.lote_id}:${r.quantidade_consumida}:${r.custo_unitario}`).join('|'),
        'LOTE_P3:60:2.6667',
        `[${rotulo}] FIFO do comando antigo sobre o lote da P3`,
      );
      const loteDepois = await loteDe();
      igual(await loteNaRotaAntiga(), 'LOTE_P3:240:2.6667:Disponivel', `[${rotulo}] lote da P3 visto pela rota antiga (depois do consumo)`);
      igual(`${dec(loteDepois.quantidade_entrada)}:${dec(loteDepois.quantidade_disponivel)}:${loteDepois.status}`, '300.0000:240.0000:Disponivel', `[${rotulo}] lote da P3 depois do consumo antigo`);
      const depois = await racao();
      igual(dec(depois.estoque_atual), (Number(antes.estoque_atual) - 60).toFixed(4), `[${rotulo}] estoque_atual da RAÇÃO depois do consumo antigo`);
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: resp.corpo.movimentacao.id } });
      igual(
        `${mov.tipo_movimentacao}:${mov.tipo_detalhado}:${dec(mov.quantidade)}:${dec(mov.valor_unitario)}:${dec(mov.valor_total)}:${mov.local_estoque_origem}:${mov.status}:${diaDe(mov.data_movimentacao)}`,
        `Saída:suplementacao:60.0000:2.6667:160.0020:${s.local2.id}:Ativa:${hoje}`,
        `[${rotulo}] movimento do comando antigo (custo do lote da P3)`,
      );
      igual(await prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, produto_id: s.produtos.racao.id } }), movsAntes + 1, `[${rotulo}] movimentos da RAÇÃO depois do consumo antigo`);
      // 17c. a tela da P3 lê o saldo novo do DEPÓSITO 02
      await novo();
      await radio('escolha-direcao', 'A receber');
      await escolher('seletor-parceiro', /FRIGORÍFICO CENTRAL/);
      await radio('escolha-conteudo', 'Com produtos');
      await escolher('seletor-produto-0', /RAÇÃO/);
      const saldos = page.getByTestId('saldos-item-0');
      const botao02 = visivel(saldos.getByRole('button', { name: /DEPÓSITO 02/ }));
      await botao02.waitFor();
      const texto02 = await botao02.innerText();
      conferir(/\b240\b/.test(texto02.replace(/\./g, '')), `[${rotulo}] saldo do DEPÓSITO 02 na tela da P3 não mostra 240 kg: "${texto02}"`);
      console.log(`  [${rotulo}] saldo do DEPÓSITO 02 na tela: "${texto02.replace(/\s+/g, ' ')}"`);
      await shot('40-saldo-apos-estoque-antigo');
      // 17d. cancelar a compra consumida pelo estoque antigo → recusa amigável
      esperarRecusa(/^POST \/api\/native\/operacoes-financeiras\/[^/]+\/cancelar → 409 \{"code":"ESTOQUE_JA_CONSUMIDO"/, 'passo 17: cancelar compra consumida → 409 ESTOQUE_JA_CONSUMIDO');
      const fe = await fotoEstoque(s);
      const ff = await fotoFinanceiro(s);
      await abrirDocumento(d);
      await clicar(page.getByTestId('botao-cancelar-lancamento'));
      await page.getByTestId('dialogo-cancelamento').waitFor({ state: 'visible' });
      await preencher('dialogo-cancelamento-motivo', 'Compra lançada no depósito errado');
      await clicar(page.getByTestId('dialogo-cancelamento-enviar'));
      const recusa = page.getByText(/já foi usada no estoque/).first();
      await recusa.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      conferir(await recusa.isVisible(), `[${rotulo}] mensagem amigável de ESTOQUE_JA_CONSUMIDO não apareceu`);
      const textoRecusa = (await recusa.isVisible()) ? await recusa.innerText() : '';
      conferir(/300/.test(textoRecusa) && /240/.test(textoRecusa), `[${rotulo}] recusa não mostra entrada 300 e disponível 240: "${textoRecusa.slice(0, 200)}"`);
      await shot('41-cancelar-compra-consumida-recusado');
      igual(await fotoEstoque(s), fe, `[${rotulo}] recusa do cancelamento alterou o estoque`);
      igual(await fotoFinanceiro(s), ff, `[${rotulo}] recusa do cancelamento alterou o financeiro`);
      igual((await prisma.operacaoFinanceira.findFirst({ where: { cliente_id: s.cliente_id, id: d.id } })).status, 'CONFIRMADO', `[${rotulo}] compra consumida continua CONFIRMADA`);
      await page.keyboard.press('Escape').catch(() => {});
    });

    // 18/19. Perfis restritos: rascunho salvo pelo dono para eles.
    let rascunhoRestrito = null;
    await passo('18 usuario so com visualizar: ve tudo, nenhum botao de acao; servidor recusa', async () => {
      await novo();
      await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
      await preencher('valor-bruto', '75,00');
      await escolher('seletor-natureza-0', /FRETE/);
      await clicar(page.getByRole('button', { name: 'Salvar', exact: true }));
      rascunhoRestrito = await esperarBanco(async () => {
        const u = await ultimaOperacao(s);
        return u && u.status === 'RASCUNHO' && dec(u.valor_total) === '75.0000' ? u : null;
      }, 'rascunho do dono para os perfis restritos');
      const tokenVis = await login(s.usuarios.vis.credenciais);
      const vis = await abrirAtor('vis', tokenVis);
      try {
        await vis.irParaLista();
        await vis.esperarLista([docs.pagar.id, rascunhoRestrito.id], [], 'lista do usuário só-consulta');
        igual(await vis.page.getByRole('button', { name: 'Novo', exact: true }).count(), 0, `[${rotulo}] só-consulta vê o botão Novo`);
        await vis.shot('42-so-consulta-lista');
        await vis.abrirNaLista(docs.pagar, 'consulta-lancamento');
        for (const sel of ['[data-testid^="botao-liquidar-"]', '[data-testid^="botao-estornar-"]', '[data-testid="botao-cancelar-lancamento"]']) {
          igual(await vis.page.locator(sel).count(), 0, `[${rotulo}] só-consulta vê ${sel} no documento confirmado`);
        }
        await vis.shot('43-so-consulta-documento');
        await vis.abrirNaLista(rascunhoRestrito, 'escolha-direcao');
        igual(await vis.page.getByTestId('botao-confirmar-lancamento').count(), 0, `[${rotulo}] só-consulta vê Confirmar no rascunho`);
        igual(await vis.page.getByRole('button', { name: 'Editar', exact: true }).count(), 0, `[${rotulo}] só-consulta vê Editar no rascunho`);
        igual(await vis.page.getByTestId('botao-descartar-rascunho').count(), 0, `[${rotulo}] só-consulta vê Descartar no rascunho`);
        await vis.shot('44-so-consulta-rascunho');
        // O servidor também recusa (API real, token do só-consulta), sem efeito.
        const ff = await fotoFinanceiro(s);
        const tit = await tituloDa(docs.pagar, 1);
        const r1 = await api(tokenVis, 'POST', `/api/native/titulos-financeiros/${tit.id}/liquidacoes`, { empresa_id: s.empresa.id, operation_id: randomUUID(), valor: '10.00', data: hoje, metodo: 'PIX' });
        igual(`${r1.status}:${r1.corpo?.code}`, '403:ACAO_NAO_PERMITIDA', `[${rotulo}] baixa direta do só-consulta`);
        const r2 = await api(tokenVis, 'POST', `/api/native/operacoes-financeiras/${rascunhoRestrito.id}/confirmar`, { empresa_id: s.empresa.id, operation_id: randomUUID(), versao: rascunhoRestrito.versao });
        igual(`${r2.status}:${r2.corpo?.code}`, '403:ACAO_NAO_PERMITIDA', `[${rotulo}] confirmação direta do só-consulta`);
        igual(await fotoFinanceiro(s), ff, `[${rotulo}] recusas do só-consulta alteraram o financeiro`);
        const gravacoes = vis.requisicoes.filter((r) => r.metodo !== 'GET' && /operacoes-financeiras|titulos-financeiros|liquidacoes|perfis-financeiros/.test(r.url));
        igual(gravacoes.length, 0, `[${rotulo}] a tela do só-consulta tentou gravar: ${gravacoes.map((r) => `${r.metodo} ${r.url}`).join(', ')}`);
      } finally {
        await vis.fechar();
      }
    });

    await passo('19 usuario com visualizar+confirmar: confirma rascunho salvo, sem PUT', async () => {
      const tokenConf = await login(s.usuarios.conf.credenciais);
      const conf = await abrirAtor('conf', tokenConf);
      try {
        await conf.irParaLista();
        igual(await conf.page.getByRole('button', { name: 'Novo', exact: true }).count(), 0, `[${rotulo}] perfil confirmar vê o botão Novo`);
        await conf.abrirNaLista(rascunhoRestrito, 'botao-confirmar-lancamento');
        igual(await conf.page.getByRole('button', { name: 'Editar', exact: true }).count(), 0, `[${rotulo}] perfil confirmar vê Editar`);
        igual(await conf.page.getByTestId('botao-descartar-rascunho').count(), 0, `[${rotulo}] perfil confirmar vê Descartar`);
        const { resumo, bloqueios } = await conf.confirmarPelaTela('45-confirmar-restrito');
        conferir(/75,00/.test(resumo), `[${rotulo}] resumo do perfil confirmar sem 75,00: ${resumo.slice(0, 200)}`);
        conferir(!bloqueios.trim(), `[${rotulo}] prévia do perfil confirmar com bloqueio: ${bloqueios.slice(0, 200)}`);
        await conf.confirmarDefinitivo('46-confirmar-restrito');
        const d = await esperarBanco(async () => {
          const o = await operacaoCompleta(s, rascunhoRestrito.id);
          return o && o.status === 'CONFIRMADO' ? o : null;
        }, 'rascunho confirmado pelo perfil restrito');
        igual(`${d.criado_por_usuario_id === s.usuario_id}:${d.confirmado_por_usuario_id === s.usuarios.conf.id}`, 'true:true', `[${rotulo}] autoria (criado pelo dono, confirmado pelo restrito)`);
        igual(d.titulos.map((t) => `${t.status}:${dec(t.valor)}`).join('|'), 'ABERTO:75.0000', `[${rotulo}] título do rascunho confirmado`);
        const indevidas = conf.requisicoes.filter((r) => /operacoes-financeiras/.test(r.url) && (r.metodo === 'PUT' || r.metodo === 'DELETE' || (r.metodo === 'POST' && /\/operacoes-financeiras(\?|$)/.test(r.url))));
        igual(indevidas.length, 0, `[${rotulo}] perfil confirmar gravou o rascunho: ${indevidas.map((r) => `${r.metodo} ${r.url}`).join(', ')}`);
        for (const sel of ['[data-testid^="botao-liquidar-"]', '[data-testid="botao-cancelar-lancamento"]']) {
          igual(await conf.page.locator(sel).count(), 0, `[${rotulo}] perfil confirmar vê ${sel} depois de confirmar`);
        }
      } finally {
        await conf.fechar();
      }
    });

    // 20. Troca de empresa na tela (FRONTEND-1).
    await passo('20 troca de empresa: perfil, lista e Novo da nova; nada da outra vaza', async () => {
      const opsA = (await prisma.operacaoFinanceira.findMany({ where: { cliente_id: s.cliente_id, empresa_id: s.empresa.id }, select: { id: true } })).map((o) => o.id);
      const nomesA = ['AGROPECUÁRIA BOA VISTA', 'FRIGORÍFICO CENTRAL'];
      const nomeB = s.parceiros2.fornecedor.nome;
      const detalhes = [];
      const ouvir = (req) => {
        const u = new URL(req.url());
        const m = u.pathname.match(/\/operacoes-financeiras\/([A-Za-z0-9_-]+)$/);
        if (req.method() === 'GET' && m) detalhes.push({ id: m[1], empresa: u.searchParams.get('empresa_id') });
      };
      const semNomesDeA = async (onde) => {
        const texto = await page.locator('main').first().innerText().catch(async () => page.locator('body').innerText());
        const vistos = nomesA.filter((nm) => texto.includes(nm));
        conferir(!vistos.length, `[${rotulo}] ${onde}: parceiro(s) da outra empresa na tela: ${vistos.join(', ')}`);
      };
      page.on('request', ouvir);
      try {
        // A com documento aberto → B (sem perfil)
        await abrirDocumento(docs.pagar);
        await dono.trocarEmpresa(s.empresa, s.empresa2);
        const painelB = visivel(page.getByTestId('perfil-financeiro-painel'));
        await painelB.waitFor({ timeout: 20000 }).catch(() => {});
        exigir(await painelB.isVisible(), `[${rotulo}] empresa nova sem perfil: o painel de configuração não apareceu depois da troca`);
        conferir(/Configurar perfil financeiro da empresa/i.test(await painelB.innerText()), `[${rotulo}] painel da empresa nova não é o de configuração`);
        igual((await dono.idsNaTela(false)).filter((id) => opsA.includes(id)).length, 0, `[${rotulo}] lançamentos de A na tela de B`);
        await semNomesDeA('B sem perfil');
        await shot('47-troca-para-B-sem-perfil');
        await clicar(page.getByTestId('botao-confirmar-perfil'));
        const perfilB = await esperarBanco(() => prisma.perfilFinanceiroEmpresa.findFirst({ where: { cliente_id: s.cliente_id, empresa_id: s.empresa2.id } }), 'perfil da empresa B');
        igual(`${perfilB.pais}:${perfilB.moeda}:${perfilB.locale}`, 'BR:BRL:pt-BR', `[${rotulo}] perfil da empresa B`);
        // Novo de B: os seletores só oferecem cadastros de B
        const botaoNovo = visivel(page.getByRole('button', { name: 'Novo', exact: true }));
        await botaoNovo.waitFor({ timeout: 20000 }).catch(() => {});
        exigir(await botaoNovo.isVisible(), `[${rotulo}] botão Novo não apareceu na empresa B depois do perfil`);
        await clicar(page.getByRole('button', { name: 'Novo', exact: true }));
        await visivel(page.getByTestId('escolha-direcao')).waitFor();
        await clicar(page.getByTestId('seletor-parceiro'));
        const painelParceiro = page.getByTestId('seletor-parceiro-painel');
        await painelParceiro.getByRole('option', { name: new RegExp(nomeB) }).first().waitFor({ state: 'visible' });
        const parceirosB = await painelParceiro.getByRole('option').allInnerTexts();
        conferir(!parceirosB.some((o) => nomesA.some((nm) => o.includes(nm))), `[${rotulo}] seletor de parceiro de B oferece parceiro de A: ${parceirosB.join(' | ')}`);
        await painelParceiro.getByRole('option', { name: new RegExp(nomeB) }).first().click();
        await page.waitForTimeout(250);
        await preencher('valor-bruto', '120,00');
        await clicar(page.getByTestId('seletor-natureza-0'));
        const painelNatureza = page.getByTestId('seletor-natureza-0-painel');
        await painelNatureza.getByRole('option', { name: /MANUTENÇÃO DO RETIRO/ }).first().waitFor({ state: 'visible' });
        const naturezasB = await painelNatureza.getByRole('option').allInnerTexts();
        conferir(!naturezasB.some((o) => /INSUMOS|FRETE|CUSTEIO/.test(o)), `[${rotulo}] seletor de natureza de B oferece natureza de A: ${naturezasB.join(' | ')}`);
        await painelNatureza.getByRole('option', { name: /MANUTENÇÃO DO RETIRO/ }).first().click();
        await page.waitForTimeout(250);
        await clicar(page.getByRole('button', { name: 'Salvar', exact: true }));
        const docB = await esperarBanco(
          () => prisma.operacaoFinanceira.findFirst({ where: { cliente_id: s.cliente_id, empresa_id: s.empresa2.id, status: 'RASCUNHO' } }),
          'rascunho da empresa B',
        );
        igual(`${docB.parceiro_id}:${dec(docB.valor_total)}`, `${s.parceiros2.fornecedor.id}:120.0000`, `[${rotulo}] rascunho de B`);
        await irParaLista();
        await dono.esperarLista([docB.id], opsA, 'lista de B');
        await semNomesDeA('lista de B');
        await shot('48-lista-B');
        // B → A: lista e Novo de A, sem o rascunho de B, sem painel de perfil
        await dono.trocarEmpresa(s.empresa2, s.empresa);
        await dono.esperarLista([docs.pagar, docs.receberParcelado, docs.compra, rascunhoRestrito].filter(Boolean).map((d) => d.id), [docB.id], 'lista de A depois da troca');
        await visivel(page.getByRole('button', { name: 'Novo', exact: true })).waitFor({ timeout: 10000 }).catch(() => {});
        conferir(await visivel(page.getByRole('button', { name: 'Novo', exact: true })).isVisible(), `[${rotulo}] botão Novo sumiu na volta para A`);
        igual(await page.getByTestId('perfil-financeiro-painel').count(), 0, `[${rotulo}] painel de perfil em A (que tem perfil)`);
        const rodape = await visivel(page.getByText(/Listados:\s*\d+/)).innerText();
        conferir(new RegExp(`Listados:\\s*${opsA.length}\\b`).test(rodape), `[${rotulo}] lista de A depois da troca: esperado ${opsA.length}, rodapé "${rodape}"`);
        conferir(!(await page.locator('main').first().innerText()).includes(nomeB), `[${rotulo}] parceiro de B na lista de A`);
        await shot('49-volta-para-A');
        // A com documento aberto → B: a lista de B aparece e o documento de A não é pedido com B
        await abrirDocumento(docs.pagar);
        await dono.trocarEmpresa(s.empresa, s.empresa2);
        await dono.esperarLista([docB.id], opsA, 'lista de B depois da troca com documento aberto');
        await visivel(page.getByRole('button', { name: 'Novo', exact: true })).waitFor({ timeout: 10000 }).catch(() => {});
        conferir(await visivel(page.getByRole('button', { name: 'Novo', exact: true })).isVisible(), `[${rotulo}] botão Novo não apareceu em B depois da troca com documento aberto`);
        igual(await page.getByTestId('perfil-financeiro-painel').count(), 0, `[${rotulo}] painel de perfil em B (que agora tem perfil)`);
        await semNomesDeA('B depois da troca com documento aberto');
        await shot('50-B-depois-da-troca-com-documento');
        const vazados = detalhes.filter((x) => x.empresa === s.empresa2.id && opsA.includes(x.id));
        igual(vazados.length, 0, `[${rotulo}] GET do documento de A com empresa_id de B`);
        await dono.trocarEmpresa(s.empresa2, s.empresa);
        await dono.esperarLista([docs.pagar.id], [docB.id], 'lista de A no fim');
        igual(await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id, empresa_id: s.empresa.id } }), opsA.length, `[${rotulo}] lançamentos de A mudaram com a troca`);
      } finally {
        page.off('request', ouvir);
      }
    });
  } catch (erro) {
    if (!(erro instanceof Divergencia)) console.error(`  [${rotulo}] interrompido: ${String(erro?.message || erro).split('\n')[0]}`);
  } finally {
    await dormir(500); // corpos das últimas respostas ainda em leitura
    if (errosPagina.length) falhas.push(`[${rotulo}] erros de página: ${errosPagina.slice(0, 3).join(' | ')}`);
    if (respostasApi.length) console.log(`  [${rotulo}] respostas ≥400 da API (${respostasApi.length}):\n    ${respostasApi.slice(0, 16).map((r) => `${r.ator}: ${r.texto}`).join('\n    ')}`);
    // Só as recusas PROVOCADAS são esperadas (e exigidas); qualquer outra
    // resposta ≥ 400 da API real é divergência, mesmo que a tela "pareça" certa.
    for (const r of respostasApi) {
      const esperada = recusasEsperadas.find((e) => e.re.test(r.texto));
      if (esperada) esperada.vista += 1;
      else falhas.push(`[${rotulo}] resposta inesperada da API (${r.ator}): ${r.texto.slice(0, 220)}`);
    }
    for (const e of recusasEsperadas) if (!e.vista) falhas.push(`[${rotulo}] recusa provocada não aconteceu: ${e.descricao}`);
    for (const a of atores) await a.fechar();
  }
  return respostasApi;
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
  subir(
    'vite',
    process.execPath,
    [path.join(RAIZ, 'node_modules/vite/bin/vite.js'), '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'],
    { ...env, VITE_MAIKE_API_URL: API },
    WEB_RAIZ,
  );
  if (WEB_RAIZ !== RAIZ) console.log(`Tela servida de ${WEB_RAIZ} (E2E_WEB_RAIZ); backend desta árvore.`);
  await esperarHttp(`${API}/health`, 'backend');
  await esperarHttp(`${WEB}/`, 'vite');
  const browser = await chromium.launch();
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
  console.log(`\nOK: tela real + backend real + PostgreSQL local sem divergências${PASSOS ? ` (PARCIAL: só os passos de E2E_PASSOS=${process.env.E2E_PASSOS})` : ''}.`);
}
process.exit(codigo);
