#!/usr/bin/env node
/**
 * D-PROD-160 (MAIKE-PATRIMONIO-UX-02) — E2E-2: o ACEITE HUMANO da missão em
 * navegador real. Tela real + backend Fastify REAL (`backend/src/server.js`) +
 * Vite + PostgreSQL LOCAL; conduz a tela pelo Playwright (Chromium já
 * instalado; nada é instalado) e confere o BANCO (Prisma) depois de cada passo.
 * Molde: `e2e-abastecimentos-real.mjs` (E2E-1, D-PROD-159) — não importado.
 *
 * "A pessoa cadastra Diesel S10 e escolhe ali o(s) Produto(s) da fazenda; no
 *  bem seleciona Diesel S10 como combustível permitido; ao abastecer vê e
 *  escolhe só o Produto, informa litros e medidor, revisa e confirma. A troca
 *  do Produto associado ocorre no cadastro de Combustíveis e vale no próximo
 *  abastecimento, sem tocar na máquina e sem reescrever os anteriores."
 *
 * Roteiro (em 1280, 820 e 390 px; cada largura num tenant próprio semeado por
 * `e2e-abastecimentos-ux02-seed.mjs`; "hoje" = dia real no fuso da fazenda):
 *   1. Combustíveis PELA TELA: "Novo" → código DIESEL_S10, nome "Diesel S10",
 *      e na seção "Produtos associados nesta fazenda" (Fazenda: SANTA LUZIA)
 *      o Produto "Diesel" (o seletor só lista Produtos da fazenda) → Salvar →
 *      "Combustível criado com 1 produto(s) associado(s) nesta fazenda". Banco:
 *      1 TipoCombustivel e 1 TipoCombustivelProduto ativo na fazenda certa.
 *      Troca de fazenda (seletor do topo / folha do celular) → RETIRO: a seção
 *      não mostra a associação da SEDE; associar "Diesel Retiro" ali; voltar à
 *      SEDE: só "Diesel" (nada do RETIRO). Banco: 1 vínculo por fazenda.
 *   2. Bens pela API REAL (catálogo padrão; Trator 01 com tanque que permite
 *      Diesel S10; Caminhonete 01 só com Gasolina) e o fator kg/L de Diesel S10 ×
 *      Diesel PELA TELA ("Fatores kg/L" → Novo fator 0,84 + declaração).
 *   3. Novo abastecimento: Trator 01 → Produto "Diesel" já marcado (único,
 *      `has_more` false; sem etapa de combustível) → "Sai do estoque" automático
 *      → 80 L → horímetro 1.550,5 → "Completou o tanque?" Sim → "Revisar
 *      abastecimento" (resumo humano; "Detalhes do estoque" recolhido; a revisão
 *      não grava) → Confirmar. Banco: produto Diesel, kg = HALF_UP(80 × 0,84; 4),
 *      2 fatias FIFO nos lotes do Diesel; bem e tanques intocados.
 *   4. Troca A → B PELA TELA de Combustíveis: "Inativar associação" Diesel S10 →
 *      Diesel e "Associar produtos" → "Diesel S10 Estoque Novo" ao MESMO Diesel
 *      S10, sem editar o Trator 01 (banco: bem, tanques e TanqueBemCombustivel
 *      idênticos). Novo abastecimento: oferece SÓ o Produto novo, com "Configure
 *      o fator kg/L…" (separado de "Associe um Produto…"); a revisão bloqueia
 *      (sem "Confirmar", nada gravado). "Configurar fator kg/L" no formulário →
 *      0,83 → revisar → confirmar. Banco: Produto novo, kg = HALF_UP(L × 0,83; 4),
 *      fatias só nos lotes do Produto novo; o fator do Diesel não foi reciclado.
 *   5. Histórico: a consulta de A ainda mostra "Diesel", 67,2000 kg, 0,840000,
 *      R$ 354,60 e 2 fatias (a linha de A no banco é idêntica à de antes da
 *      troca). Cancelar A (motivo + ciência) → lotes do Diesel exatamente de
 *      volta; o Produto novo intocado (lotes, estoque, abastecimento B).
 *   6. Caminhonete 01 (só Gasolina, sem Produto associado) → "Associe um
 *      Produto ao combustível no cadastro de Combustíveis." e "Combustível sem
 *      Produto: Gasolina."; nada a escolher.
 *   7. (390) Teclado: reativar a associação do Diesel (2 Produtos no mesmo
 *      combustível) e fazer o Novo abastecimento SÓ com Tab/Shift+Tab/Espaço/
 *      Enter até a revisão; foco visível nos botões de Produto; nada gravado.
 *  Em TODA captura: sem rolagem horizontal da página (scrollWidth ≤ clientWidth + 1).
 *  Toda resposta ≥ 400 da API real observada pelas telas é divergência.
 *
 * Uso:
 *   DATABASE_URL=postgresql://postgres@localhost:5433/maike_ux02_e2e2?host=/tmp \
 *     node scripts/dev/e2e-abastecimentos-ux02-real.mjs [pasta-das-capturas]
 * Variáveis opcionais: E2E_API_PORT (3912), E2E_WEB_PORT (5212),
 * E2E_LARGURAS ("1280,820,390"). O banco precisa estar migrado
 * (`npm run deploy:migrate` com a mesma URL). Recusa banco que não seja local.
 * Encerra backend e Vite ao sair. Sai com código ≠ 0 em QUALQUER divergência.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { PRODUTOS_UX02, exigirBancoLocal, semearBancoUx02, semearBensUx02 } from './e2e-abastecimentos-ux02-seed.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_PORT = Number(process.env.E2E_API_PORT || 3912);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5212);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maike-e2e-abastecimentos-ux02'));
const LARGURAS = String(process.env.E2E_LARGURAS || '1280,820,390')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 320);
fs.mkdirSync(OUT, { recursive: true });

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
  console.error('playwright não encontrado: o ensaio usa o Playwright já instalado no ambiente (nada é instalado).');
  process.exit(2);
}

// ─── Processos (backend real + Vite) ────────────────────────────────────────
const processos = [];
const envLimpo = () => {
  const e = { ...process.env };
  for (const k of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'VERCEL_ENV', 'MAIKE_TESTE_AGORA']) delete e[k];
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
/** Decimal do Prisma → texto com 4 casas (sem float). */
const dec = (v) => (v == null ? null : String(v.toFixed ? v.toFixed(4) : v));
const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

// ─── Banco ──────────────────────────────────────────────────────────────────
process.env.DATABASE_URL = DATABASE_URL;
const { Prisma } = await import('@prisma/client');
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const prisma = getPrismaClient();
/** kg = HALF_UP(litros × fator, 4), só Decimal. */
const kgEsperado = (litros, fator) => new Prisma.Decimal(litros).times(new Prisma.Decimal(fator)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);

/**
 * Espera uma CONDIÇÃO no banco (nunca um tempo fixo como prova).
 * @template T @param {() => Promise<T|null|undefined|false>} fn @param {string} descricao @param {number} [ms]
 */
const esperarBanco = async (fn, descricao, ms = 20000) => {
  const ate = Date.now() + ms;
  let ultimo;
  while (Date.now() < ate) {
    ultimo = await fn();
    if (ultimo) return ultimo;
    await new Promise((r) => setTimeout(r, 250));
  }
  return exigir(false, `banco não chegou ao estado esperado em ${ms} ms: ${descricao}`);
};
/** Foto das linhas que o abastecimento pode tocar (prova de "nada gravado"). */
const fotoBanco = async (s) => {
  const w = { where: { cliente_id: s.cliente_id }, orderBy: { id: 'asc' } };
  return json({
    abastecimentos: await prisma.abastecimentoBem.findMany(w),
    fatias: await prisma.abastecimentoBemConsumoLote.findMany(w),
    fatores: await prisma.conversaoCombustivelProduto.findMany(w),
    vinculos: await prisma.tipoCombustivelProduto.findMany(w),
    movimentos: await prisma.movimentacaoEstoque.findMany({ ...w, select: { id: true, status: true, quantidade: true } }),
    lotes: await prisma.estoqueLoteNota.findMany({ ...w, select: { id: true, quantidade_disponivel: true, status: true } }),
    produtos: await prisma.produto.findMany({ ...w, select: { id: true, estoque_atual: true, empresa_id: true, ativo: true } }),
    bens: await prisma.bemPatrimonial.findMany(w),
    financeiro: await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }),
  });
};
/** O bem, os tanques e os combustíveis permitidos exatamente como o cadastro deixou. */
const fotoBem = async (s, bemId) => {
  const bem = await prisma.bemPatrimonial.findFirst({ where: { cliente_id: s.cliente_id, id: bemId } });
  const tanques = await prisma.tanqueBem.findMany({ where: { cliente_id: s.cliente_id, bem_id: bemId }, orderBy: { id: 'asc' } });
  const permitidos = await prisma.tanqueBemCombustivel.findMany({ where: { cliente_id: s.cliente_id, tanque_id: { in: tanques.map((t) => t.id) } }, orderBy: { id: 'asc' } });
  return json({ bem, tanques, permitidos });
};
const lotesDe = async (s, produtoId) =>
  (await prisma.estoqueLoteNota.findMany({ where: { cliente_id: s.cliente_id, produto_id: produtoId }, orderBy: [{ data_documento: 'asc' }, { id: 'asc' }] }))
    .map((l) => `${dec(l.quantidade_disponivel)}:${l.status}`)
    .join('|');
const estoqueDe = async (s, produtoId) => dec((await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: produtoId } })).estoque_atual);
const vinculosAtivos = (s) =>
  prisma.tipoCombustivelProduto.findMany({ where: { cliente_id: s.cliente_id, ativo: true }, orderBy: [{ empresa_id: 'asc' }, { produto_id: 'asc' }] });
/** Linha completa do abastecimento + fatias + movimento (histórico imutável). */
const fotoAbastecimento = async (s, id) => {
  const ab = await prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, id } });
  const fatias = await prisma.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: s.cliente_id, abastecimento_id: id }, orderBy: { ordem: 'asc' } });
  const mov = ab ? await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estoque_id } }) : null;
  return json({ ab, fatias, mov });
};

// ─── Sessão e API direta ────────────────────────────────────────────────────
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
  let corpoJson = null;
  try {
    corpoJson = await r.json();
  } catch {
    /* sem corpo */
  }
  return { status: r.status, corpo: corpoJson };
};

// ─── Roteiro por largura ────────────────────────────────────────────────────
const executarLargura = async (browser, largura) => {
  const rotulo = String(largura);
  const movel = largura < 640;
  const s = await semearBancoUx02({ rotulo: `w${rotulo}` });
  const token = await login(s.credenciais);
  const A = s.produtos.A;
  const B = s.produtos.B;
  const R = s.produtos.R;
  const E1 = s.empresas.E1;
  const E2 = s.empresas.E2;
  const errosPagina = [];
  const respostasApi = [];
  const reg = /** @type {Record<string, any>} */ ({});
  let n = 0;

  const ctx = await browser.newContext({
    viewport: { width: largura, height: movel ? 844 : 860 },
    deviceScaleFactor: 1,
    isMobile: movel,
    hasTouch: movel,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
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
    { t: token, e: E1.id, c: s.cliente_id },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errosPagina.push(String(e).slice(0, 300)));
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.startsWith(API) || r.status() < 400) return;
    const item = { texto: `${r.request().method()} ${u.replace(API, '')} → ${r.status()}` };
    respostasApi.push(item);
    try {
      item.texto += ` ${(await r.text()).slice(0, 400)}`;
    } catch {
      /* sem corpo */
    }
  });
  page.setDefaultTimeout(20000);

  /** Captura + prova de "sem rolagem horizontal da página". */
  const shot = async (etapa) => {
    n += 1;
    await page.waitForTimeout(250); // só para a captura assentar animações; nenhuma prova depende disso
    const arquivo = `ux02-${rotulo}-${String(n).padStart(2, '0')}-${etapa}.png`;
    await page.screenshot({ path: path.join(OUT, arquivo), fullPage: false });
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    conferir(m.sw <= m.cw + 1, `[${rotulo}] ${arquivo}: rolagem horizontal da página (scrollWidth ${m.sw} > clientWidth ${m.cw} + 1)`);
    return arquivo;
  };
  const visivel = (loc) => loc.filter({ visible: true }).first();
  const clicar = async (loc) => {
    const el = visivel(loc);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click();
  };
  const preencher = async (testId, valor) => {
    const el = visivel(page.getByTestId(testId));
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.fill(valor);
    await el.blur();
  };
  /** `SeletorPaginadoGestao`: abre o painel e escolhe a opção pelo título EXATO (= rótulo da opção). */
  const escolherTitulo = async (raiz, testId, titulo) => {
    await clicar(raiz.getByTestId(testId));
    const painel = visivel(page.getByTestId(`${testId}-painel`));
    const opcao = painel.locator(`[role="option"][title="${titulo.replace(/"/g, '\\"')}"]`).first();
    await opcao.waitFor({ state: 'visible' });
    await opcao.click();
    await painel.waitFor({ state: 'detached' }).catch(() => {});
  };
  /** Abre o painel do seletor e devolve os títulos das opções (o painel fica aberto). */
  const titulosDoSeletor = async (raiz, testId, esperado) => {
    await clicar(raiz.getByTestId(testId));
    const painel = visivel(page.getByTestId(`${testId}-painel`));
    await painel.locator(`[role="option"][title="${esperado.replace(/"/g, '\\"')}"]`).first().waitFor({ state: 'visible' });
    return painel.locator('[role="option"]').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
  };
  const ir = async (rota) => {
    await page.goto(`${WEB}${rota}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
  };
  const textoDe = async (loc) => (await visivel(loc).textContent())?.replace(/\s+/g, ' ').trim() ?? '';
  const aviso = (re) => visivel(page.getByText(re));
  const esperarAviso = async (re, msg, ms = 10000) => conferir(await aviso(re).waitFor({ timeout: ms }).then(() => true, () => false), msg);

  /**
   * Fecha os avisos (toasts) abertos pelo "×" deles, como a pessoa faria: no
   * tablet o aviso do canto superior direito cobre o "Trocar empresa" do topo.
   */
  const fecharAvisos = async () => {
    const botoes = page.locator('.mg-toast-host').getByRole('button', { name: 'Fechar', exact: true }).filter({ visible: true });
    for (let i = 0; i < 8 && (await botoes.count()); i += 1) {
      await botoes.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
  };

  /** Troca de fazenda PELA TELA: seletor do topo (≥ 1024 px) ou "Trocar empresa" (folha). */
  const trocarFazenda = async (de, para) => {
    await fecharAvisos();
    if (largura >= 1024) {
      await clicar(page.getByRole('combobox').filter({ hasText: de.apelido }));
      await page.getByRole('option', { name: para.apelido, exact: true }).first().click();
    } else {
      await clicar(page.getByRole('button', { name: 'Trocar empresa', exact: true }));
      const item = page.locator('.mk-co__item').filter({ hasText: para.apelido });
      await visivel(item).waitFor();
      await visivel(item).click();
    }
    await page.waitForFunction((id) => window.localStorage.getItem('empresa_selecionada_id') === id, para.id, { timeout: 8000 }).catch(() => {});
    const selecionada = await page.evaluate(() => window.localStorage.getItem('empresa_selecionada_id'));
    exigir(selecionada === para.id, `[${rotulo}] a troca para ${para.apelido} não foi gravada (selecionada: ${selecionada})`);
  };

  /** Abre o combustível na lista de Combustíveis (tabela: nome; celular: card). */
  const abrirCombustivel = async (tipoId) => {
    await ir('/combustiveis');
    await page.waitForFunction(
      (id) =>
        [...document.querySelectorAll(`[data-testid="combustivel-nome-${id}"]`)].some((e) => e.getClientRects().length > 0) ||
        [...document.querySelectorAll('[data-testid="b1-card"]')].some((e) => /DIESEL_S10/.test(e.textContent || '') && e.getClientRects().length > 0),
      tipoId,
    );
    let alvo = page.getByTestId(`combustivel-nome-${tipoId}`);
    if (!(await visivel(alvo).isVisible().catch(() => false))) alvo = page.getByTestId('b1-card').filter({ hasText: 'DIESEL_S10' });
    const el = visivel(alvo);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.dblclick();
    await visivel(page.getByTestId('combustivel-produtos')).waitFor();
  };
  /** Linhas (nome do Produto em texto) de um grupo da seção do registro. */
  const nomesDoGrupo = async (testId) => {
    const grupo = page.getByTestId(testId).filter({ visible: true });
    if (!(await grupo.count())) return [];
    return grupo.first().locator('li span.font-medium').evaluateAll((els) => els.map((e) => (e.textContent || '').trim()));
  };
  /** Espera a seção do registro terminar de ler as associações (grupos renderizados). */
  const esperarSecaoLida = async () => {
    const secao = visivel(page.getByTestId('combustivel-produtos'));
    await secao.getByText(/^Associados \(\d+\)$/).first().waitFor();
    return secao;
  };

  /** Abre o abastecimento pela lista (tabela: célula da máquina; celular: card com os litros). */
  const abrirAbastecimentoNaLista = async (registro) => {
    await ir('/abastecimentos');
    await page.waitForFunction(
      ({ id, litros }) =>
        [...document.querySelectorAll(`[data-testid="abastecimento-bem-${id}"]`)].some((e) => e.getClientRects().length > 0) ||
        [...document.querySelectorAll('[data-testid="b1-card"]')].some((e) => e.textContent?.includes(litros) && e.getClientRects().length > 0),
      { id: registro.id, litros: registro.litros },
    );
    let alvo = page.getByTestId(`abastecimento-bem-${registro.id}`);
    if (!(await visivel(alvo).isVisible().catch(() => false))) alvo = page.getByTestId('b1-card').filter({ hasText: registro.litros });
    const el = visivel(alvo);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.dblclick();
    await visivel(page.getByTestId('abastecimento-consulta')).waitFor();
  };
  /** Novo abastecimento até o bem escolhido (o Produto ainda não). */
  const novoAbastecimento = async (tituloBem) => {
    await ir('/abastecimentos');
    await clicar(page.getByRole('button', { name: 'Novo abastecimento' }));
    const form = visivel(page.getByTestId('abastecimento-form'));
    await form.waitFor();
    await escolherTitulo(form, 'abastecimento-bem', tituloBem);
    return form;
  };
  /** Espera o radio de Produto marcado com o rótulo EXATO (textContent). */
  const esperarProdutoMarcado = (rotuloRadio) =>
    page.waitForFunction(
      (r) =>
        [...document.querySelectorAll('[data-testid="abastecimento-produto"] [role="radio"][aria-checked="true"]')].some(
          (el) => el.textContent?.trim() === r && el.getClientRects().length > 0,
        ),
      rotuloRadio,
    );
  const radiosDeProduto = async () =>
    page
      .locator('[data-testid="abastecimento-produto"] [role="radio"]')
      .filter({ visible: true })
      .evaluateAll((els) => els.map((e) => `${(e.textContent || '').trim()}${e.getAttribute('aria-checked') === 'true' ? ' [x]' : ''}`));
  const pedirRevisao = async () => {
    await clicar(page.getByTestId('abastecimento-previa'));
    const dlg = visivel(page.getByTestId('dialogo-previa-abastecimento'));
    await dlg.waitFor();
    await visivel(page.getByTestId('previa-kg')).waitFor();
    return dlg;
  };
  const fecharRevisao = async () => {
    const dlg = visivel(page.getByTestId('dialogo-previa-abastecimento'));
    await clicar(dlg.getByRole('button', { name: 'Voltar', exact: true }));
    await page.getByTestId('dialogo-previa-abastecimento').filter({ visible: true }).first().waitFor({ state: 'hidden' }).catch(() => {});
  };
  const abrirDetalhesDoEstoque = async () => {
    const botao = visivel(page.getByTestId('previa-detalhes-estoque'));
    igual(await botao.getAttribute('aria-expanded'), 'false', `[${rotulo}] "Detalhes do estoque" não começa recolhido`);
    igual(await page.getByTestId('previa-fator').filter({ visible: true }).count(), 0, `[${rotulo}] fator visível com "Detalhes do estoque" recolhido`);
    await botao.click();
    await visivel(page.getByTestId('previa-fator')).waitFor();
  };

  const passo = async (nome, fn) => {
    const antes = falhas.length;
    const t0 = Date.now();
    console.log(`[${rotulo}] ${nome}`);
    try {
      await fn();
    } catch (erro) {
      if (!(erro instanceof Divergencia)) falhas.push(`[${rotulo}] ${nome}: ${String(erro?.message || erro).split('\n')[0].slice(0, 300)}`);
      await shot(`falha-${nome.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
      passos.push(`[${rotulo}] ✗ ${nome} (${Date.now() - t0} ms)`);
      throw erro;
    }
    passos.push(`[${rotulo}] ${falhas.length === antes ? '✓' : '✗'} ${nome} (${Date.now() - t0} ms)`);
  };

  try {
    // ── 1. Combustíveis: criar "Diesel S10" já escolhendo o Produto da fazenda ──
    await passo('1 Combustíveis: criar Diesel S10 com o Produto Diesel da fazenda', async () => {
      await ir('/combustiveis');
      await visivel(page.getByText('Nenhum combustível encontrado')).waitFor().catch(() => {});
      igual(await prisma.tipoCombustivel.count({ where: { cliente_id: s.cliente_id } }), 0, `[${rotulo}] combustíveis antes da criação`);
      await shot('combustiveis-lista-vazia');
      await clicar(page.getByRole('button', { name: 'Novo', exact: true }));
      const form = visivel(page.locator('#formulario-combustivel-base1'));
      await form.waitFor();
      await visivel(form.getByLabel(/^Código/)).fill('DIESEL_S10');
      await visivel(form.getByLabel(/^Nome/)).fill('Diesel S10');
      const secao = visivel(page.getByTestId('combustivel-novo-produtos'));
      await secao.waitFor();
      igual(await textoDe(page.getByTestId('combustivel-novo-fazenda')), `Fazenda: ${E1.nome}`, `[${rotulo}] seção da criação: fazenda`);
      const titulos = await titulosDoSeletor(secao, 'combustivel-novo-produto-seletor', A.nome);
      igual([...titulos].sort().join(' | '), [A.nome, B.nome].sort().join(' | '), `[${rotulo}] seletor da criação: Produtos oferecidos (só os da fazenda SEDE)`);
      conferir(!titulos.includes(R.nome), `[${rotulo}] seletor da criação oferece Produto da outra fazenda (${R.nome})`);
      await visivel(page.getByTestId('combustivel-novo-produto-seletor-painel').locator(`[role="option"][title="${A.nome}"]`)).click();
      await visivel(page.getByTestId(`combustivel-novo-pendente-${A.id}`)).waitFor();
      igual(await textoDe(page.getByTestId('combustivel-novo-pendentes')), A.nome, `[${rotulo}] lista "A associar"`);
      await shot('combustivel-novo-com-produto');
      const antes = await fotoBanco(s);
      await clicar(page.getByRole('button', { name: 'Salvar', exact: true }));
      await esperarAviso(/Combustível criado com 1 produto\(s\) associado\(s\) nesta fazenda/, `[${rotulo}] aviso "Combustível criado com 1 produto(s) associado(s) nesta fazenda" ausente`, 15000);
      igual(await page.getByText(/não foram associados/).filter({ visible: true }).count(), 0, `[${rotulo}] criação com aviso de falha de associação`);
      const tipo = await esperarBanco(() => prisma.tipoCombustivel.findFirst({ where: { cliente_id: s.cliente_id, codigo: 'DIESEL_S10' } }), 'combustível DIESEL_S10 gravado');
      igual(`${tipo.codigo}:${tipo.nome}:${tipo.unidade}:${tipo.ativo}`, 'DIESEL_S10:Diesel S10:L:true', `[${rotulo}] TipoCombustivel no banco`);
      igual(await prisma.tipoCombustivel.count({ where: { cliente_id: s.cliente_id } }), 1, `[${rotulo}] TipoCombustivel no tenant`);
      const vinc = await esperarBanco(async () => {
        const v = await vinculosAtivos(s);
        return v.length ? v : null;
      }, 'vínculo Diesel S10 → Diesel gravado');
      igual(vinc.length, 1, `[${rotulo}] TipoCombustivelProduto ativos`);
      igual(`${vinc[0].empresa_id === E1.id}:${vinc[0].tipo_combustivel_id === tipo.id}:${vinc[0].produto_id === A.id}:${vinc[0].ativo}`, 'true:true:true:true', `[${rotulo}] vínculo na fazenda certa (SEDE, Diesel S10 → Diesel)`);
      igual(await prisma.tipoCombustivelProduto.count({ where: { cliente_id: s.cliente_id } }), 1, `[${rotulo}] TipoCombustivelProduto no tenant (ativos e inativos)`);
      conferir(antes !== (await fotoBanco(s)), `[${rotulo}] a criação não mudou o banco`);
      reg.tipo = { id: tipo.id, nome: tipo.nome };
      reg.vinculoA = vinc[0];
      // Registro criado aberto: a seção da fazenda SEDE mostra o Produto real.
      const secaoReg = await esperarSecaoLida();
      igual(await textoDe(page.getByTestId('combustivel-produtos-fazenda')), `Fazenda: ${E1.nome}`, `[${rotulo}] registro: fazenda da seção`);
      igual((await nomesDoGrupo('combustivel-produtos-associados')).join(' | '), A.nome, `[${rotulo}] registro (SEDE): Associados`);
      conferir(/Associado/.test(await textoDe(secaoReg.getByTestId(`combustivel-produto-situacao-${reg.vinculoA.id}`))), `[${rotulo}] registro (SEDE): situação da associação`);
      await shot('combustivel-criado-sede');
    });

    await passo('1b troca de fazenda: a associação da outra fazenda não aparece', async () => {
      await trocarFazenda(E1, E2);
      // A seção é da fazenda ATUAL: nada da SEDE pode aparecer.
      let secao = page.getByTestId('combustivel-produtos').filter({ visible: true });
      if (!(await secao.count())) await abrirCombustivel(reg.tipo.id);
      await page.waitForFunction((nome) => [...document.querySelectorAll('[data-testid="combustivel-produtos-fazenda"]')].some((e) => e.textContent?.includes(nome)), E2.nome);
      secao = await esperarSecaoLida();
      igual(await textoDe(page.getByTestId('combustivel-produtos-fazenda')), `Fazenda: ${E2.nome}`, `[${rotulo}] RETIRO: fazenda da seção`);
      igual((await nomesDoGrupo('combustivel-produtos-associados')).join(' | '), '', `[${rotulo}] RETIRO: Associados (a da SEDE apareceu?)`);
      igual(await page.getByTestId(`combustivel-produto-${reg.vinculoA.id}`).count(), 0, `[${rotulo}] RETIRO: a associação da SEDE está na tela`);
      conferir((await textoDe(secao)).includes('Nenhum produto associado nesta fazenda.'), `[${rotulo}] RETIRO: texto de nenhuma associação`);
      await shot('combustivel-retiro-vazio');
      // Associa o Produto do RETIRO pelo registro (o seletor só lista os do RETIRO).
      await clicar(secao.getByRole('button', { name: 'Associar produtos' }));
      const painelAssoc = visivel(page.getByTestId('combustivel-produto-vincular'));
      await painelAssoc.waitFor();
      const titulos = await titulosDoSeletor(painelAssoc, 'combustivel-produto-seletor', R.nome);
      igual(titulos.join(' | '), R.nome, `[${rotulo}] RETIRO: seletor só com Produtos do RETIRO`);
      await visivel(page.getByTestId('combustivel-produto-seletor-painel').locator(`[role="option"][title="${R.nome}"]`)).click();
      await visivel(page.getByTestId(`combustivel-produto-pendente-${R.id}`)).waitFor();
      await clicar(painelAssoc.getByRole('button', { name: 'Associar 1 produto(s)' }));
      await esperarAviso(/^Produto associado$/, `[${rotulo}] RETIRO: aviso "Produto associado" ausente`);
      const vR = await esperarBanco(() => prisma.tipoCombustivelProduto.findFirst({ where: { cliente_id: s.cliente_id, empresa_id: E2.id, produto_id: R.id, ativo: true } }), 'vínculo do RETIRO');
      igual(vR.tipo_combustivel_id, reg.tipo.id, `[${rotulo}] RETIRO: vínculo no MESMO combustível`);
      const ativos = await vinculosAtivos(s);
      igual(ativos.map((v) => `${v.empresa_id === E1.id ? 'SEDE' : v.empresa_id === E2.id ? 'RETIRO' : '?'}:${v.produto_id === A.id ? 'A' : v.produto_id === R.id ? 'R' : '?'}`).sort().join('|'), 'RETIRO:R|SEDE:A', `[${rotulo}] vínculos ativos por fazenda`);
      await page.waitForFunction((nome) => [...document.querySelectorAll('[data-testid="combustivel-produtos-associados"] li')].some((e) => e.textContent?.includes(nome)), R.nome);
      igual((await nomesDoGrupo('combustivel-produtos-associados')).join(' | '), R.nome, `[${rotulo}] RETIRO: Associados depois de associar`);
      await shot('combustivel-retiro-associado');
      // De volta à SEDE: só o Diesel (nada do RETIRO).
      await trocarFazenda(E2, E1);
      secao = page.getByTestId('combustivel-produtos').filter({ visible: true });
      if (!(await secao.count())) await abrirCombustivel(reg.tipo.id);
      await page.waitForFunction((nome) => [...document.querySelectorAll('[data-testid="combustivel-produtos-fazenda"]')].some((e) => e.textContent?.includes(nome)), E1.nome);
      await esperarSecaoLida();
      await page.waitForFunction((nome) => [...document.querySelectorAll('[data-testid="combustivel-produtos-associados"] li')].some((e) => e.textContent?.includes(nome)), A.nome);
      igual((await nomesDoGrupo('combustivel-produtos-associados')).join(' | '), A.nome, `[${rotulo}] SEDE de novo: Associados (o do RETIRO apareceu?)`);
      igual(await page.getByTestId(`combustivel-produto-${vR.id}`).count(), 0, `[${rotulo}] SEDE de novo: a associação do RETIRO está na tela`);
      await shot('combustivel-sede-de-novo');
    });

    // ── 2. Bem (API real) + fator kg/L pela tela ──
    await passo('2 Trator 01 com Diesel S10 permitido + fator kg/L Diesel S10 × Diesel pela tela', async () => {
      const bens = await semearBensUx02(s, (m, c, b) => api(token, m, `/api/native${c}`, b));
      Object.assign(s, bens);
      igual(s.combustiveis.DIESEL_S10, reg.tipo.id, `[${rotulo}] o catálogo padrão recriou o Diesel S10 em vez de reaproveitar o da tela`);
      igual(await prisma.tipoCombustivel.count({ where: { cliente_id: s.cliente_id, nome: 'Diesel S10' } }), 1, `[${rotulo}] Diesel S10 duplicado no tenant`);
      const tanques = await prisma.tanqueBem.findMany({ where: { cliente_id: s.cliente_id, bem_id: s.trator.id } });
      const permitidos = await prisma.tanqueBemCombustivel.findMany({ where: { cliente_id: s.cliente_id, tanque_id: { in: tanques.map((t) => t.id) } } });
      igual(`${tanques.length}:${permitidos.map((p) => p.combustivel_id === reg.tipo.id).join(',')}`, '1:true', `[${rotulo}] tanque do Trator 01 permite Diesel S10`);
      reg.fotoTrator = await fotoBem(s, s.trator.id);
      // Fator kg/L pela tela.
      await ir('/abastecimentos');
      await visivel(page.getByTestId('abastecimento-lista-vazia')).waitFor();
      await shot('abastecimentos-lista-vazia');
      await clicar(page.getByTestId('abastecimento-fatores'));
      const dlg = visivel(page.getByTestId('conversoes-combustivel'));
      await dlg.waitFor();
      await clicar(page.getByTestId('conversao-nova'));
      await visivel(page.getByTestId('conversao-form')).waitFor();
      await escolherTitulo(dlg, 'conversao-tipo', 'Diesel S10');
      const titulos = await titulosDoSeletor(dlg, 'conversao-produto', A.nome);
      igual(titulos.join(' | '), A.nome, `[${rotulo}] fatores: Produtos do Diesel S10 na SEDE`);
      await visivel(page.getByTestId('conversao-produto-painel').locator(`[role="option"][title="${A.nome}"]`)).click();
      await visivel(page.getByText('Este par não tem fator vigente: salvar cria uma nova versão.')).waitFor();
      await preencher('conversao-fator', '0,84');
      await visivel(page.getByTestId('conversao-declaracao')).check();
      await shot('fator-diesel-form');
      await clicar(page.getByTestId('conversao-salvar'));
      const fator = await esperarBanco(
        () => prisma.conversaoCombustivelProduto.findFirst({ where: { cliente_id: s.cliente_id, produto_id: A.id, ativo: true } }),
        'fator vigente Diesel S10 × Diesel',
      );
      igual(
        `${fator.kg_por_litro.toFixed(6)}:${fator.sequencia}:${fator.versao}:${fator.declara_estoque_em_kg}:${fator.tipo_combustivel_id === reg.tipo.id}:${fator.empresa_id === E1.id}`,
        '0.840000:1:1:true:true:true',
        `[${rotulo}] fator no banco`,
      );
      igual(await prisma.conversaoCombustivelProduto.count({ where: { cliente_id: s.cliente_id } }), 1, `[${rotulo}] fatores no banco`);
      await visivel(page.getByTestId(`conversao-${fator.id}`)).waitFor();
      await page.getByTestId('conversao-form').filter({ visible: true }).first().waitFor({ state: 'hidden' }).catch(() => {});
      await clicar(dlg.getByRole('button', { name: 'Fechar', exact: true }));
      await dlg.waitFor({ state: 'hidden' });
      reg.fatorA = fator;
    });

    // ── 3. Novo abastecimento escolhendo só o Produto ──
    await passo('3 Novo abastecimento: Trator 01 → Produto Diesel já marcado → revisar → confirmar', async () => {
      const form = await novoAbastecimento('TR-01 — Trator 01');
      await esperarProdutoMarcado(A.nome);
      igual((await radiosDeProduto()).join(' | '), `${A.nome} [x]`, `[${rotulo}] Produtos oferecidos para o Trator 01`);
      igual(await page.getByTestId('abastecimento-combustivel').count(), 0, `[${rotulo}] o formulário tem a etapa "Combustível"`);
      igual(await form.getByRole('radio', { name: 'Diesel S10', exact: true }).count(), 0, `[${rotulo}] o tipo "Diesel S10" aparece como escolha`);
      igual(await form.getByText('Diesel S10', { exact: true }).count(), 0, `[${rotulo}] o nome do tipo "Diesel S10" aparece no formulário`);
      await visivel(page.getByTestId('abastecimento-local-auto').filter({ hasText: `Sai do estoque: ${A.local.nome}` })).waitFor();
      igual(await page.getByTestId('abastecimento-tanque').count(), 0, `[${rotulo}] pergunta de tanque com 1 tanque só`);
      igual(await visivel(page.getByTestId('abastecimento-data')).inputValue(), s.hoje, `[${rotulo}] data padrão (hoje na fazenda)`);
      await preencher('abastecimento-litros', '80');
      await preencher('abastecimento-leitura', '1.550,5');
      const sim = visivel(page.getByTestId('abastecimento-tanque-cheio').getByRole('radio', { name: 'Sim' }));
      await sim.click();
      igual(await sim.getAttribute('aria-checked'), 'true', `[${rotulo}] "Completou o tanque?" Sim`);
      await shot('form-diesel');
      const antes = await fotoBanco(s);
      await pedirRevisao();
      const resumo = await textoDe(page.getByTestId('previa-resumo'));
      conferir(resumo.includes('Trator 01') && resumo.includes(A.nome) && resumo.includes('80 L') && resumo.includes('67,2000 kg') && resumo.includes(A.local.nome), `[${rotulo}] revisão: resumo humano "${resumo}"`);
      conferir(!resumo.includes('Diesel S10'), `[${rotulo}] revisão: o tipo aparece no resumo humano "${resumo}"`);
      igual(await textoDe(page.getByTestId('previa-produto')), A.nome, `[${rotulo}] revisão: Produto`);
      igual(await textoDe(page.getByTestId('previa-kg')), '67,2000 kg', `[${rotulo}] revisão: Baixa no estoque`);
      igual(await page.getByTestId('previa-fatias').filter({ visible: true }).count(), 0, `[${rotulo}] revisão: FIFO fora de "Detalhes do estoque"`);
      await shot('revisao-diesel');
      await abrirDetalhesDoEstoque();
      conferir((await textoDe(page.getByTestId('previa-fator'))).includes('0,840000') && (await textoDe(page.getByTestId('previa-fator'))).includes('versão 1'), `[${rotulo}] detalhes: fator`);
      igual(await textoDe(page.getByTestId('previa-tipo')), 'Diesel S10', `[${rotulo}] detalhes: tipo de combustível`);
      conferir((await textoDe(page.getByTestId('previa-custo'))).includes('354,60'), `[${rotulo}] detalhes: custo estimado`);
      const linhas = await visivel(page.getByTestId('previa-fatias')).locator('tbody tr').allInnerTexts();
      conferir(linhas.length === 2 && linhas[0].includes('50,0000') && linhas[1].includes('17,2000'), `[${rotulo}] detalhes: fatias ${linhas.join(' / ')}`);
      igual(await page.getByTestId('previa-bloqueios').count(), 0, `[${rotulo}] revisão com bloqueio`);
      igual(await fotoBanco(s), antes, `[${rotulo}] a revisão gravou algo`);
      await shot('revisao-diesel-detalhes');
      await clicar(page.getByTestId('abastecimento-confirmar'));
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
      await esperarAviso(/confirmado: 67,2000 kg baixados do estoque\./, `[${rotulo}] aviso de confirmação ausente`);
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO', produto_id: A.id } }), 'abastecimento A confirmado');
      igual(
        `${ab.produto_id === A.id}:${ab.tipo_combustivel_id === reg.tipo.id}:${ab.tanque_id === s.trator.tanque_id}:${ab.local_estoque_id === A.local.id}:${ab.conversao_id === reg.fatorA.id}:${dec(ab.quantidade_litros)}:${ab.kg_por_litro.toFixed(6)}:${dec(ab.quantidade_kg)}:${dec(ab.custo_total)}:${dec(ab.medidor_leitura)}:${ab.tanque_cheio}`,
        `true:true:true:true:true:80.0000:0.840000:${kgEsperado('80', '0.84')}:354.6000:1550.5000:true`,
        `[${rotulo}] abastecimento A no banco`,
      );
      const fatias = await prisma.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: s.cliente_id, abastecimento_id: ab.id }, orderBy: { ordem: 'asc' } });
      igual(
        fatias.map((f) => `${f.estoque_lote_nota_id === A.lotes[f.ordem - 1]?.id}:${dec(f.quantidade)}:${dec(f.custo_unitario)}`).join('|'),
        'true:50.0000:5.2000|true:17.2000:5.5000',
        `[${rotulo}] fatias FIFO de A (lotes do Diesel)`,
      );
      igual(await lotesDe(s, A.id), '0.0000:Esgotado|82.8000:Disponivel', `[${rotulo}] lotes do Diesel após A`);
      igual(await estoqueDe(s, A.id), '82.8000', `[${rotulo}] estoque do Diesel após A`);
      igual(await lotesDe(s, B.id), '200.0000:Disponivel', `[${rotulo}] lotes do Produto novo após A (intocados)`);
      igual(await fotoBem(s, s.trator.id), reg.fotoTrator, `[${rotulo}] o abastecimento alterou o Trator 01/tanques`);
      igual(await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }), 0, `[${rotulo}] lançamento financeiro criado`);
      reg.A = { id: ab.id, litros: '80,0000 L' };
      reg.fotoA = await fotoAbastecimento(s, ab.id);
      conferir((await textoDe(page.getByTestId('consulta-produto'))).includes(A.nome), `[${rotulo}] consulta de A: Produto`);
      await shot('confirmado-diesel');
    });

    // ── 4. Troca A → B no cadastro de Combustíveis (sem editar o bem) ──
    await passo('4 troca A→B em Combustíveis: inativar Diesel, associar Diesel S10 Estoque Novo', async () => {
      await abrirCombustivel(reg.tipo.id);
      const secao = await esperarSecaoLida();
      await page.waitForFunction((nome) => [...document.querySelectorAll('[data-testid="combustivel-produtos-associados"] li')].some((e) => e.textContent?.includes(nome)), A.nome);
      const linhaA = visivel(page.getByTestId(`combustivel-produto-${reg.vinculoA.id}`));
      await clicar(linhaA.getByRole('button', { name: 'Inativar associação' }));
      const confirma = visivel(page.getByRole('alertdialog'));
      await confirma.waitFor();
      const textoConfirma = await textoDe(confirma);
      conferir(
        textoConfirma.includes(`Inativar a associação de "${A.nome}" com Diesel S10?`) && textoConfirma.includes('Abastecimentos já lançados não mudam e nada é apagado.'),
        `[${rotulo}] confirmação de inativar: "${textoConfirma}"`,
      );
      await shot('combustivel-confirma-inativar');
      await clicar(confirma.getByRole('button', { name: 'Inativar', exact: true }));
      await esperarAviso(/^Associação inativada$/, `[${rotulo}] aviso "Associação inativada" ausente`);
      const vA = await esperarBanco(() => prisma.tipoCombustivelProduto.findFirst({ where: { cliente_id: s.cliente_id, id: reg.vinculoA.id, ativo: false } }), 'vínculo A inativado');
      igual(`${vA.versao}:${vA.produto_id === A.id}`, '2:true', `[${rotulo}] vínculo A inativado (versão)`);
      await page.waitForFunction((id) => document.querySelector(`[data-testid="combustivel-produtos-inativos"] [data-testid="combustivel-produto-${id}"]`), reg.vinculoA.id);
      // Associa o Produto novo ao MESMO combustível.
      await clicar(secao.getByRole('button', { name: 'Associar produtos' }));
      const painelAssoc = visivel(page.getByTestId('combustivel-produto-vincular'));
      await painelAssoc.waitFor();
      await escolherTitulo(painelAssoc, 'combustivel-produto-seletor', B.nome);
      await visivel(page.getByTestId(`combustivel-produto-pendente-${B.id}`)).waitFor();
      await shot('combustivel-associar-novo');
      await clicar(painelAssoc.getByRole('button', { name: 'Associar 1 produto(s)' }));
      await esperarAviso(/^Produto associado$/, `[${rotulo}] aviso "Produto associado" (B) ausente`);
      const vB = await esperarBanco(() => prisma.tipoCombustivelProduto.findFirst({ where: { cliente_id: s.cliente_id, produto_id: B.id, ativo: true } }), 'vínculo B ativo');
      igual(`${vB.tipo_combustivel_id === reg.tipo.id}:${vB.empresa_id === E1.id}`, 'true:true', `[${rotulo}] vínculo B no MESMO combustível e na SEDE`);
      reg.vinculoB = vB;
      await page.waitForFunction((nome) => [...document.querySelectorAll('[data-testid="combustivel-produtos-associados"] li')].some((e) => e.textContent?.includes(nome)), B.nome);
      igual((await nomesDoGrupo('combustivel-produtos-associados')).join(' | '), B.nome, `[${rotulo}] registro: Associados após a troca`);
      igual((await nomesDoGrupo('combustivel-produtos-inativos')).join(' | '), A.nome, `[${rotulo}] registro: Inativos após a troca`);
      conferir(/Associação inativa/.test(await textoDe(page.getByTestId(`combustivel-produto-situacao-${reg.vinculoA.id}`))), `[${rotulo}] registro: situação da associação A`);
      await shot('combustivel-apos-troca');
      igual(await fotoBem(s, s.trator.id), reg.fotoTrator, `[${rotulo}] a troca de associação editou o Trator 01/tanques/combustíveis permitidos`);
      igual(await fotoAbastecimento(s, reg.A.id), reg.fotoA, `[${rotulo}] a troca de associação reescreveu o abastecimento A`);
      igual(await prisma.conversaoCombustivelProduto.count({ where: { cliente_id: s.cliente_id } }), 1, `[${rotulo}] a troca criou/copiou fator`);
    });

    await passo('4b novo abastecimento oferece o Produto novo; sem fator não confirma; configurar fator; confirmar B', async () => {
      const form = await novoAbastecimento('TR-01 — Trator 01');
      await esperarProdutoMarcado(`${B.nome} (sem fator kg/L)`);
      igual((await radiosDeProduto()).join(' | '), `${B.nome} (sem fator kg/L) [x]`, `[${rotulo}] Produtos oferecidos após a troca (só o novo)`);
      igual(await form.getByRole('radio', { name: A.nome, exact: true }).count(), 0, `[${rotulo}] o Produto antigo ainda é oferecido`);
      const semFator = visivel(page.getByTestId('abastecimento-sem-fator'));
      await semFator.waitFor();
      conferir((await textoDe(semFator)).includes('Configure o fator kg/L deste Produto nesta fazenda antes de abastecer.'), `[${rotulo}] aviso de fator: "${await textoDe(semFator)}"`);
      igual(await page.getByTestId('abastecimento-sem-produto').filter({ visible: true }).count(), 0, `[${rotulo}] aviso "Associe um Produto…" junto do aviso de fator`);
      await visivel(page.getByTestId('abastecimento-local-auto').filter({ hasText: `Sai do estoque: ${B.local.nome}` })).waitFor();
      await preencher('abastecimento-litros', '41,3333');
      await preencher('abastecimento-leitura', '1.560');
      await shot('form-novo-sem-fator');
      const antes = await fotoBanco(s);
      await pedirRevisao();
      const bloqueios = visivel(page.getByTestId('previa-bloqueios'));
      await bloqueios.waitFor();
      igual(
        (await bloqueios.locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-codigo')))).join(','),
        'ABASTECIMENTO_CONVERSAO_AUSENTE',
        `[${rotulo}] revisão sem fator: bloqueios`,
      );
      igual(await page.getByTestId('abastecimento-confirmar').filter({ visible: true }).count(), 0, `[${rotulo}] revisão sem fator oferece "Confirmar"`);
      igual(await fotoBanco(s), antes, `[${rotulo}] a revisão sem fator gravou algo`);
      await shot('revisao-novo-sem-fator');
      await fecharRevisao();
      // Configurar o fator do Produto novo pelo próprio formulário.
      await clicar(page.getByTestId('abastecimento-form-configurar-fator'));
      const dlg = visivel(page.getByTestId('conversoes-combustivel'));
      await dlg.waitFor();
      await visivel(page.getByTestId('conversao-form')).waitFor();
      conferir((await textoDe(page.getByTestId('conversao-tipo'))).includes('Diesel S10'), `[${rotulo}] fator do formulário: combustível pré-escolhido`);
      conferir((await textoDe(page.getByTestId('conversao-produto'))).includes(B.nome), `[${rotulo}] fator do formulário: Produto novo pré-escolhido`);
      igual(await textoDe(page.getByTestId('conversao-vigente')), 'Este par não tem fator vigente: salvar cria uma nova versão.', `[${rotulo}] o fator do Diesel foi oferecido ao Produto novo`);
      await preencher('conversao-fator', '0,83');
      await visivel(page.getByTestId('conversao-declaracao')).check();
      await shot('fator-novo-form');
      await clicar(page.getByTestId('conversao-salvar'));
      const fatorB = await esperarBanco(() => prisma.conversaoCombustivelProduto.findFirst({ where: { cliente_id: s.cliente_id, produto_id: B.id, ativo: true } }), 'fator do Produto novo');
      igual(`${fatorB.kg_por_litro.toFixed(6)}:${fatorB.sequencia}:${fatorB.tipo_combustivel_id === reg.tipo.id}`, '0.830000:1:true', `[${rotulo}] fator do Produto novo no banco`);
      const fatorAAgora = await prisma.conversaoCombustivelProduto.findFirst({ where: { cliente_id: s.cliente_id, id: reg.fatorA.id } });
      igual(json(fatorAAgora), json(reg.fatorA), `[${rotulo}] o fator do Diesel mudou com a configuração do Produto novo`);
      // A tela termina de gravar (a linha nova aparece e o formulário do fator fecha) antes de "Fechar".
      await visivel(page.getByTestId(`conversao-${fatorB.id}`)).waitFor();
      await page.getByTestId('conversao-form').filter({ visible: true }).first().waitFor({ state: 'hidden' }).catch(() => {});
      await esperarAviso(/Fator 0,830000 kg\/L vigente \(versão 1\)\./, `[${rotulo}] aviso "Fator … vigente" do Produto novo ausente`);
      await clicar(dlg.getByRole('button', { name: 'Fechar', exact: true }));
      await dlg.waitFor({ state: 'hidden' });
      await esperarProdutoMarcado(B.nome);
      igual(await page.getByTestId('abastecimento-sem-fator').filter({ visible: true }).count(), 0, `[${rotulo}] aviso de fator continua depois de configurar`);
      await pedirRevisao();
      igual(await page.getByTestId('previa-bloqueios').count(), 0, `[${rotulo}] revisão B com bloqueio`);
      const kgB = kgEsperado('41.3333', '0.83');
      igual(await textoDe(page.getByTestId('previa-produto')), B.nome, `[${rotulo}] revisão B: Produto`);
      igual(await textoDe(page.getByTestId('previa-kg')), `${kgB.replace('.', ',')} kg`, `[${rotulo}] revisão B: Baixa no estoque`);
      await abrirDetalhesDoEstoque();
      conferir((await textoDe(page.getByTestId('previa-fator'))).includes('0,830000'), `[${rotulo}] revisão B: fator ${await textoDe(page.getByTestId('previa-fator'))}`);
      await shot('revisao-novo');
      await clicar(page.getByTestId('abastecimento-confirmar'));
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO', produto_id: B.id } }), 'abastecimento B confirmado');
      igual(
        `${ab.produto_id === B.id}:${ab.tipo_combustivel_id === reg.tipo.id}:${ab.conversao_id === fatorB.id}:${dec(ab.quantidade_litros)}:${ab.kg_por_litro.toFixed(6)}:${dec(ab.quantidade_kg)}:${dec(ab.medidor_leitura)}:${ab.tanque_cheio}`,
        `true:true:true:41.3333:0.830000:${kgB}:1560.0000:false`,
        `[${rotulo}] abastecimento B no banco`,
      );
      const fatias = await prisma.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: s.cliente_id, abastecimento_id: ab.id }, orderBy: { ordem: 'asc' } });
      igual(fatias.map((f) => `${f.estoque_lote_nota_id === B.lotes[0].id}:${dec(f.quantidade)}:${dec(f.custo_unitario)}`).join('|'), `true:${kgB}:6.1000`, `[${rotulo}] fatias de B (só lotes do Produto novo)`);
      const restoB = new Prisma.Decimal('200').minus(new Prisma.Decimal(kgB)).toFixed(4);
      igual(await lotesDe(s, B.id), `${restoB}:Disponivel`, `[${rotulo}] lotes do Produto novo após B`);
      igual(await estoqueDe(s, B.id), restoB, `[${rotulo}] estoque do Produto novo após B`);
      igual(await lotesDe(s, A.id), '0.0000:Esgotado|82.8000:Disponivel', `[${rotulo}] lotes do Diesel mudaram com B`);
      igual(await fotoAbastecimento(s, reg.A.id), reg.fotoA, `[${rotulo}] o abastecimento B reescreveu o A`);
      igual(await fotoBem(s, s.trator.id), reg.fotoTrator, `[${rotulo}] o abastecimento B alterou o Trator 01/tanques`);
      reg.B = { id: ab.id, litros: '41,3333 L', restoB };
      reg.fotoB = await fotoAbastecimento(s, ab.id);
      await shot('confirmado-novo');
    });

    // ── 5. Histórico de A intacto; cancelar A devolve os lotes do Diesel ──
    await passo('5 histórico A intacto + cancelar A devolve os lotes do Diesel', async () => {
      await abrirAbastecimentoNaLista(reg.A);
      igual(await textoDe(page.getByTestId('consulta-produto')), `${A.nome} (KG)`, `[${rotulo}] consulta de A: Produto (deve ser o da época)`);
      conferir((await textoDe(page.getByTestId('consulta-kg'))).includes('67,2000'), `[${rotulo}] consulta de A: KG`);
      conferir((await textoDe(page.getByTestId('consulta-fator'))).includes('0,840000'), `[${rotulo}] consulta de A: fator`);
      conferir((await textoDe(page.getByTestId('consulta-custo'))).includes('354,60'), `[${rotulo}] consulta de A: custo`);
      conferir((await textoDe(page.getByTestId('consulta-tipo'))).includes('Diesel S10'), `[${rotulo}] consulta de A: tipo (classificação)`);
      igual(await visivel(page.getByTestId('consulta-fatias')).locator('tbody tr').count(), 2, `[${rotulo}] consulta de A: fatias`);
      igual(await fotoAbastecimento(s, reg.A.id), reg.fotoA, `[${rotulo}] linha de A no banco mudou desde antes da troca`);
      await shot('consulta-a-apos-troca');
      await clicar(page.getByTestId('abastecimento-cancelar'));
      const dlg = visivel(page.getByTestId('dialogo-cancelamento-abastecimento'));
      await dlg.waitFor();
      conferir((await textoDe(dlg)).includes(A.nome), `[${rotulo}] cancelamento: o diálogo não fala do Produto de A`);
      const enviar = visivel(page.getByTestId('cancelamento-enviar'));
      conferir(await enviar.isDisabled(), `[${rotulo}] cancelar habilitado sem motivo/ciência`);
      await visivel(page.getByTestId('cancelamento-motivo')).fill('Lançado com o Produto antigo por engano');
      conferir(await enviar.isDisabled(), `[${rotulo}] cancelar habilitado sem ciência`);
      await visivel(page.getByTestId('cancelamento-ciente')).check();
      await shot('cancelamento-a');
      const vinculosAntes = json(await prisma.tipoCombustivelProduto.findMany({ where: { cliente_id: s.cliente_id }, orderBy: { id: 'asc' } }));
      await enviar.click();
      const ok = await aviso(/cancelado: 67,2000 kg devolvidos aos lotes de origem\./).waitFor({ timeout: 15000 }).then(() => true, () => false);
      if (!ok) {
        const erroTela = await page.getByTestId('erro-envio').filter({ visible: true }).first().textContent().catch(() => null);
        conferir(false, `[${rotulo}] cancelamento de A não concluiu; erro na tela: ${erroTela ?? '(nenhum erro explícito)'}`);
        igual(await prisma.abastecimentoBem.count({ where: { cliente_id: s.cliente_id, produto_id: B.id } }), 1, `[${rotulo}] cancelamento bloqueado trocou algo para B`);
        throw new Divergencia('cancelamento de A não concluiu');
      }
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, id: reg.A.id, status: 'CANCELADO' } }), 'A cancelado');
      igual(`${ab.versao}:${ab.produto_id === A.id}:${ab.conversao_id === reg.fatorA.id}:${dec(ab.quantidade_kg)}`, '2:true:true:67.2000', `[${rotulo}] A cancelado mantém Produto/fator/kg da época`);
      const est = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estorno_id } });
      igual(`${est?.tipo_movimentacao}:${est?.tipo_detalhado}:${est?.produto_id === A.id}:${dec(est?.quantidade)}:${dec(est?.valor_total)}`, 'Entrada:estorno_abastecimento:true:67.2000:354.6000', `[${rotulo}] estorno de A (no Diesel)`);
      igual(await lotesDe(s, A.id), '50.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes do Diesel após cancelar A`);
      igual(await estoqueDe(s, A.id), '150.0000', `[${rotulo}] estoque do Diesel após cancelar A`);
      igual(await lotesDe(s, B.id), `${reg.B.restoB}:Disponivel`, `[${rotulo}] lotes do Produto novo mexidos pelo cancelamento de A`);
      igual(await estoqueDe(s, B.id), reg.B.restoB, `[${rotulo}] estoque do Produto novo mexido pelo cancelamento de A`);
      igual(await fotoAbastecimento(s, reg.B.id), reg.fotoB, `[${rotulo}] o cancelamento de A mexeu no abastecimento B`);
      igual(json(await prisma.tipoCombustivelProduto.findMany({ where: { cliente_id: s.cliente_id }, orderBy: { id: 'asc' } })), vinculosAntes, `[${rotulo}] o cancelamento mexeu nos vínculos`);
      igual(await fotoBem(s, s.trator.id), reg.fotoTrator, `[${rotulo}] o cancelamento alterou o Trator 01/tanques`);
      await visivel(page.getByTestId('consulta-estorno')).waitFor();
      igual(await textoDe(page.getByTestId('abastecimento-consulta-situacao')), 'Cancelado', `[${rotulo}] consulta de A: situação após cancelar`);
      igual(await textoDe(page.getByTestId('consulta-produto')), `${A.nome} (KG)`, `[${rotulo}] consulta de A cancelado: Produto`);
      await shot('a-cancelado');
      // Lista: Produto de cada abastecimento é o da época.
      await ir('/abastecimentos');
      await page.waitForFunction(
        ({ a, b }) =>
          [a, b].every((id) => [...document.querySelectorAll(`[data-testid="abastecimento-bem-${id}"]`)].some((e) => e.getClientRects().length > 0)) ||
          [...document.querySelectorAll('[data-testid="b1-card"]')].filter((e) => e.getClientRects().length > 0).length >= 2,
        { a: reg.A.id, b: reg.B.id },
      );
      const cabecalhos = (await page.getByRole('columnheader').filter({ visible: true }).allTextContents()).map((t) => t.trim()).filter(Boolean);
      if (cabecalhos.length) igual(cabecalhos.join(' | '), 'Data | Máquina/Veículo | Produto | Litros | Medidor | Situação', `[${rotulo}] colunas padrão da lista`);
      const textoLista = await textoDe(page.locator('main'));
      conferir(textoLista.includes(A.nome) && textoLista.includes(B.nome), `[${rotulo}] lista sem os dois Produtos da época`);
      await shot('lista-a-e-b');
    });

    // ── 6. Combustível sem Produto associado ──
    await passo('6 bem só com combustível sem Produto → "Associe um Produto ao combustível…"', async () => {
      const antes = await fotoBanco(s);
      await novoAbastecimento('CM-01 — Caminhonete 01');
      const semProduto = visivel(page.getByTestId('abastecimento-sem-produto'));
      await semProduto.waitFor();
      const t = await textoDe(semProduto);
      conferir(t.includes('Associe um Produto ao combustível no cadastro de Combustíveis.'), `[${rotulo}] sem Produto: texto "${t}"`);
      conferir(t.includes('Combustível sem Produto: Gasolina.'), `[${rotulo}] sem Produto: combustível citado "${t}"`);
      igual(await visivel(page.getByTestId('abastecimento-abrir-combustiveis')).getAttribute('href'), '/combustiveis', `[${rotulo}] sem Produto: link "Abrir Combustíveis"`);
      igual((await radiosDeProduto()).length, 0, `[${rotulo}] sem Produto: há Produto para escolher`);
      igual(await page.getByTestId('abastecimento-sem-fator').filter({ visible: true }).count(), 0, `[${rotulo}] sem Produto: aviso de fator junto`);
      igual(await page.getByTestId('abastecimento-local-auto').filter({ visible: true }).count(), 0, `[${rotulo}] sem Produto: local escolhido`);
      await shot('sem-produto-gasolina');
      igual(await fotoBanco(s), antes, `[${rotulo}] o formulário sem Produto gravou algo`);
    });

    // ── 7. Teclado (390): 2 Produtos no mesmo combustível, sem clique ──
    if (largura === 390) {
      await passo('7 teclado: 2 Produtos (reativar Diesel) e Novo abastecimento só com teclado até a revisão', async () => {
        await abrirCombustivel(reg.tipo.id);
        await esperarSecaoLida();
        await page.waitForFunction((id) => document.querySelector(`[data-testid="combustivel-produtos-inativos"] [data-testid="combustivel-produto-${id}"]`), reg.vinculoA.id);
        await clicar(page.getByTestId(`combustivel-produto-${reg.vinculoA.id}`).getByRole('button', { name: 'Reativar associação' }));
        const confirma = visivel(page.getByRole('alertdialog'));
        await confirma.waitFor();
        await clicar(confirma.getByRole('button', { name: 'Reativar', exact: true }));
        await esperarAviso(/^Associação reativada$/, `[${rotulo}] aviso "Associação reativada" ausente`);
        await esperarBanco(() => prisma.tipoCombustivelProduto.findFirst({ where: { cliente_id: s.cliente_id, id: reg.vinculoA.id, ativo: true } }), 'vínculo A reativado');
        igual((await vinculosAtivos(s)).filter((v) => v.empresa_id === E1.id && v.tipo_combustivel_id === reg.tipo.id).length, 2, `[${rotulo}] Diesel S10 com 2 Produtos ativos na SEDE`);
        igual(await fotoBem(s, s.trator.id), reg.fotoTrator, `[${rotulo}] a reativação editou o Trator 01`);
        await ir('/abastecimentos');
        await visivel(page.getByRole('button', { name: 'Novo abastecimento' })).waitFor();
        const antes = await fotoBanco(s);
        const usadas = [];
        /** Tab (ou Shift+Tab) até o foco cumprir a condição — nunca clique. */
        const tabAte = async (descricao, cond, arg, { shift = false, max = 80 } = {}) => {
          for (let i = 0; i < max; i += 1) {
            if (await page.evaluate(cond, arg)) return;
            await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
            usadas.push(shift ? 'Shift+Tab' : 'Tab');
          }
          const ativo = await page.evaluate(() => {
            const a = document.activeElement;
            return a ? `${a.tagName}#${a.id}[${a.getAttribute('data-testid') ?? ''}] "${(a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 60)}"` : 'nenhum';
          });
          exigir(false, `[${rotulo}] teclado: não cheguei a ${descricao} em ${max} ${shift ? 'Shift+Tab' : 'Tab'} (foco em ${ativo})`);
        };
        const tecla = async (k) => {
          await page.keyboard.press(k);
          usadas.push(k);
        };
        await page.evaluate(() => /** @type {any} */ (document.activeElement)?.blur?.());
        await tabAte('"Novo abastecimento"', () => document.activeElement?.getAttribute('aria-label') === 'Novo abastecimento' || document.activeElement?.textContent?.trim() === 'Novo abastecimento');
        await tecla('Enter');
        await visivel(page.getByTestId('abastecimento-form')).waitFor();
        await tabAte('o seletor de máquina', () => document.activeElement?.getAttribute('data-testid') === 'abastecimento-bem');
        await tecla('Enter');
        await visivel(page.getByTestId('abastecimento-bem-painel')).locator('[role="option"][title="TR-01 — Trator 01"]').waitFor();
        await tabAte('a opção TR-01', () => document.activeElement?.getAttribute('title') === 'TR-01 — Trator 01');
        await tecla('Enter');
        await page.getByTestId('abastecimento-bem-painel').waitFor({ state: 'detached' }).catch(() => {});
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="abastecimento-produto"] [role="radio"]').length === 2);
        igual((await radiosDeProduto()).sort().join(' | '), [A.nome, B.nome].sort().join(' | '), `[${rotulo}] teclado: 2 Produtos, nenhum pré-marcado`);
        await tabAte('o botão do Produto Diesel', (nome) => document.activeElement?.getAttribute('role') === 'radio' && document.activeElement?.textContent?.trim() === nome && Boolean(document.activeElement.closest('[data-testid="abastecimento-produto"]')), A.nome);
        const foco = await page.evaluate(() => {
          const el = /** @type {HTMLElement} */ (document.activeElement);
          const cs = getComputedStyle(el);
          return { focusVisible: el.matches(':focus-visible'), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow };
        });
        const anelVisivel = foco.focusVisible && ((foco.outlineStyle !== 'none' && parseFloat(foco.outlineWidth) > 0) || (foco.boxShadow && foco.boxShadow !== 'none'));
        conferir(anelVisivel, `[${rotulo}] teclado: foco NÃO visível no botão de Produto (${JSON.stringify(foco)})`);
        await shot('teclado-foco-produto');
        // Shift+Tab volta ao seletor de máquina e Tab retorna ao Produto (ordem de foco coerente).
        await tabAte('o seletor de máquina (Shift+Tab)', () => document.activeElement?.getAttribute('data-testid') === 'abastecimento-bem', undefined, { shift: true, max: 10 });
        await tabAte('o botão do Produto Diesel (de novo)', (nome) => document.activeElement?.getAttribute('role') === 'radio' && document.activeElement?.textContent?.trim() === nome, A.nome, { max: 10 });
        await tecla('Space');
        await esperarProdutoMarcado(A.nome);
        await visivel(page.getByTestId('abastecimento-local-auto').filter({ hasText: `Sai do estoque: ${A.local.nome}` })).waitFor();
        await tabAte('o campo de litros', () => document.activeElement?.closest('[data-testid="abastecimento-litros"]') != null || document.activeElement?.getAttribute('data-testid') === 'abastecimento-litros');
        await page.keyboard.type('10');
        usadas.push('digitar 10');
        await tabAte('o campo de leitura', () => document.activeElement?.closest('[data-testid="abastecimento-leitura"]') != null || document.activeElement?.getAttribute('data-testid') === 'abastecimento-leitura');
        await page.keyboard.type('1570');
        usadas.push('digitar 1570');
        await tabAte('"Completou o tanque?" Sim', () => document.activeElement?.getAttribute('role') === 'radio' && document.activeElement?.textContent?.trim() === 'Sim' && Boolean(document.activeElement.closest('[data-testid="abastecimento-tanque-cheio"]')));
        await tecla('Space');
        igual(await visivel(page.getByTestId('abastecimento-tanque-cheio').getByRole('radio', { name: 'Sim' })).getAttribute('aria-checked'), 'true', `[${rotulo}] teclado: "Completou o tanque?" Sim`);
        await tabAte('"Revisar abastecimento"', () => document.activeElement?.getAttribute('data-testid') === 'abastecimento-previa');
        await shot('teclado-form');
        await tecla('Enter');
        await visivel(page.getByTestId('dialogo-previa-abastecimento')).waitFor();
        await visivel(page.getByTestId('previa-kg')).waitFor();
        igual(await textoDe(page.getByTestId('previa-produto')), A.nome, `[${rotulo}] teclado: revisão Produto`);
        igual(await textoDe(page.getByTestId('previa-kg')), `${kgEsperado('10', '0.84').replace('.', ',')} kg`, `[${rotulo}] teclado: revisão Baixa no estoque`);
        igual(await textoDe(page.getByTestId('previa-litros')), '10 L', `[${rotulo}] teclado: revisão Litros`);
        await shot('teclado-revisao');
        igual(await fotoBanco(s), antes, `[${rotulo}] teclado: a revisão gravou algo`);
        console.log(`  [${rotulo}] teclas usadas: ${usadas.length} (${[...new Set(usadas)].join(', ')})`);
        await tecla('Escape');
      });
    }
  } catch (erro) {
    if (!(erro instanceof Divergencia)) console.error(`  [${rotulo}] interrompido: ${String(erro?.message || erro).split('\n')[0]}`);
  } finally {
    await new Promise((r) => setTimeout(r, 400)); // corpos das últimas respostas ainda em leitura
    if (errosPagina.length) falhas.push(`[${rotulo}] erros de página: ${errosPagina.slice(0, 3).join(' | ')}`);
    if (respostasApi.length) console.log(`  [${rotulo}] respostas ≥400 da API vistas pela tela (${respostasApi.length}):\n    ${respostasApi.slice(0, 16).map((r) => r.texto).join('\n    ')}`);
    for (const r of respostasApi) falhas.push(`[${rotulo}] resposta inesperada da API: ${r.texto.slice(0, 260)}`);
    await ctx.close().catch(() => {});
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
  subir('vite', process.execPath, [path.join(RAIZ, 'node_modules/vite/bin/vite.js'), '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], { ...env, VITE_MAIKE_API_URL: API });
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
console.log(`Produtos do ensaio: A="${PRODUTOS_UX02.A.nome}", B="${PRODUTOS_UX02.B.nome}", RETIRO="${PRODUTOS_UX02.R.nome}"`);
if (falhas.length) {
  console.error(`\nDIVERGÊNCIAS (${falhas.length}):\n- ${falhas.join('\n- ')}`);
  codigo = 1;
} else {
  console.log('\nOK: E2E-2 (aceite humano UX-02) — tela real + backend real + PostgreSQL local sem divergências.');
}
process.exit(codigo);
