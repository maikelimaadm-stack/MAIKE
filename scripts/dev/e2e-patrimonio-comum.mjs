/**
 * D-PROD-162 — infraestrutura comum dos ensaios ponta a ponta REAIS de
 * Patrimônio e Frota (`e2e-patrimonio-simplifica-real.mjs` e
 * `e2e-abastecimentos-real.mjs`): sobe o backend Fastify REAL
 * (`backend/src/server.js`) contra um PostgreSQL LOCAL e o Vite apontando para
 * ele, abre o Chromium já instalado no ambiente (nada é instalado) e dá aos
 * roteiros: atores (contexto + página com a sessão do usuário), capturas com a
 * conferência de rolagem horizontal, asserções que acumulam divergências,
 * espera por CONDIÇÃO no banco e a chamada direta à API real.
 *
 * Toda resposta ≥ 400 da API real observada por uma tela entra como
 * divergência, salvo as que o roteiro declara esperadas (`esperarRecusa`).
 * SÓ roda contra PostgreSQL local (`exigirBancoLocal`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { exigirBancoLocal } from './e2e-lancamentos-seed.mjs';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Chromium do Playwright já instalado no ambiente (global ou do projeto). */
export const carregarChromium = async () => {
  try {
    return (await import('playwright')).chromium;
  } catch {
    try {
      return createRequire(import.meta.url)('playwright').chromium;
    } catch {
      return null;
    }
  }
};

export class Divergencia extends Error {}

/** Decimal do Prisma → texto com 4 casas (sem float). */
export const dec = (v) => (v == null ? null : String(v.toFixed ? v.toFixed(4) : v));

/**
 * @param {{ nome: string, out: string, apiPort: number, webPort: number }} cfg
 */
export const criarEnsaio = (cfg) => {
  const DATABASE_URL = exigirBancoLocal();
  const API = `http://127.0.0.1:${cfg.apiPort}`;
  const WEB = `http://127.0.0.1:${cfg.webPort}`;
  const OUT = cfg.out;
  fs.mkdirSync(OUT, { recursive: true });

  // ─── Asserções ────────────────────────────────────────────────────────────
  /** @type {string[]} */
  const falhas = [];
  /** @type {string[]} */
  const passos = [];
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

  // ─── Processos ────────────────────────────────────────────────────────────
  const processos = [];
  const envLimpo = () => {
    const e = { ...process.env };
    for (const k of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'VERCEL_ENV', 'MAIKE_TESTE_AGORA']) delete e[k];
    return e;
  };
  const subir = (nome, comando, args, env) => {
    const log = fs.openSync(path.join(OUT, `${nome}.log`), 'w');
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
        if (filho.exitCode !== null) throw new Error(`${n} saiu com código ${filho.exitCode} (veja ${path.join(OUT, `${n}.log`)})`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`${nome} não respondeu em ${ms} ms (${url})`);
  };
  const subirServicos = async () => {
    const env = envLimpo();
    subir('backend', process.execPath, ['backend/src/server.js'], {
      ...env,
      NODE_ENV: 'development',
      PORT: String(cfg.apiPort),
      HOST: '127.0.0.1',
      DATABASE_URL,
      AUTH_SECRET: process.env.E2E_AUTH_SECRET || 'ci-only-ephemeral-signing-key',
      FRONTEND_ORIGINS: `${WEB},http://localhost:${cfg.webPort}`,
    });
    subir('vite', process.execPath, [path.join(RAIZ, 'node_modules/vite/bin/vite.js'), '--port', String(cfg.webPort), '--strictPort', '--host', '127.0.0.1'], { ...env, VITE_MAIKE_API_URL: API });
    await esperarHttp(`${API}/health`, 'backend');
    await esperarHttp(`${WEB}/`, 'vite');
  };
  /** Chromium em pt-BR: o campo de dia NATIVO segue o idioma do processo do navegador (LANG). */
  const abrirNavegador = (chromium) => chromium.launch({ env: { ...envLimpo(), LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } });

  // ─── Sessão e API direta ──────────────────────────────────────────────────
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
  /** `api` já autenticada e com o prefixo `/api/native` (a forma que a semente usa). @param {string} token */
  const apiDo = (token) => (metodo, caminho, corpo) => api(token, metodo, `/api/native${caminho}`, corpo);

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

  // ─── Atores ───────────────────────────────────────────────────────────────
  /**
   * Abre um ator (contexto + página) com a sessão e a empresa já escolhidas.
   * @param {any} browser
   * @param {{ largura: number, rotulo: string, ator: string, token: string, empresaId: string, clienteId: string, prefixo: string }} o
   * @param {{ errosPagina: string[], respostasApi: Array<{ ator: string, texto: string, metodo: string, caminho: string, status: number }>, contador: { n: number } }} registro
   */
  const abrirAtor = async (browser, o, registro) => {
    const movel = o.largura < 640;
    const ctx = await browser.newContext({
      viewport: { width: o.largura, height: movel ? 844 : 860 },
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
      { t: o.token, e: o.empresaId, c: o.clienteId },
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => registro.errosPagina.push(`${o.ator}: ${String(e).slice(0, 300)}`));
    page.on('response', async (r) => {
      const u = r.url();
      if (!u.startsWith(API) || r.status() < 400) return;
      const caminho = u.replace(API, '');
      const item = { ator: o.ator, metodo: r.request().method(), caminho, status: r.status(), texto: `${r.request().method()} ${caminho} → ${r.status()}` };
      registro.respostasApi.push(item);
      try {
        item.texto += ` ${(await r.text()).slice(0, 400)}`;
      } catch {
        /* sem corpo */
      }
    });
    page.setDefaultTimeout(20000);
    let fechado = false;
    const shot = async (etapa) => {
      registro.contador.n += 1;
      await page.waitForTimeout(250); // só para a captura assentar animações; nenhuma prova depende disso
      const arquivo = `${o.prefixo}-${o.rotulo}-${o.ator === 'dono' ? '' : `${o.ator}-`}${String(registro.contador.n).padStart(2, '0')}-${etapa}.png`;
      await page.screenshot({ path: path.join(OUT, arquivo), fullPage: false });
      // A PÁGINA não rola na horizontal (em toda captura e em toda largura).
      const rol = await page.evaluate(() => {
        const e = document.scrollingElement || document.documentElement;
        return { sw: e.scrollWidth, cw: e.clientWidth, dsw: document.documentElement.scrollWidth };
      });
      conferir(rol.dsw <= o.largura, `${arquivo}: rolagem horizontal (${rol.dsw} > ${o.largura})`);
      conferir(rol.sw <= rol.cw + 1, `${arquivo}: rolagem horizontal da página (scrollingElement.scrollWidth ${rol.sw} > clientWidth ${rol.cw} + 1)`);
      return arquivo;
    };
    const visivel = (loc) => loc.filter({ visible: true }).first();
    const clicar = async (loc) => {
      const el = visivel(loc);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click();
    };
    const preencher = async (alvo, valor) => {
      const el = visivel(typeof alvo === 'string' ? page.getByTestId(alvo) : alvo);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.fill(valor);
      await el.blur();
    };
    /** `SeletorPaginadoGestao`: abre o painel e escolhe a opção pelo nome. */
    const escolher = async (raiz, testId, nome) => {
      await clicar(raiz.getByTestId(testId));
      const painel = page.getByTestId(`${testId}-painel`);
      await painel.getByRole('option', { name: nome }).first().waitFor({ state: 'visible' });
      await painel.getByRole('option', { name: nome }).first().click();
      await painel.waitFor({ state: 'detached' }).catch(() => {});
    };
    /** `CampoSelect`/`B1Select` (combobox): abre e escolhe a opção. */
    const escolherNoCombo = async (combo, nome) => {
      await clicar(combo);
      await visivel(page.getByRole('option', { name: nome, exact: typeof nome === 'string' })).click();
    };
    const fechar = async () => {
      if (fechado) return;
      fechado = true;
      await ctx.close().catch(() => {});
    };
    return { ator: o.ator, largura: o.largura, movel, page, ctx, shot, visivel, clicar, preencher, escolher, escolherNoCombo, fechar, aberto: () => !fechado };
  };

  /**
   * Passo do roteiro: marca ✓/✗, captura a tela dos atores abertos em falha e
   * repassa a exceção (o roteiro da largura para no 1º erro que não é divergência).
   * @param {string} rotulo @param {string} nome @param {() => Promise<void>} fn @param {Array<{ aberto: () => boolean, shot: (e: string) => Promise<string> }>} atores
   */
  const passo = async (rotulo, nome, fn, atores) => {
    const antes = falhas.length;
    const t0 = Date.now();
    console.log(`[${rotulo}] ${nome}`);
    try {
      await fn();
    } catch (erro) {
      if (!(erro instanceof Divergencia)) falhas.push(`[${rotulo}] ${nome}: ${String(erro?.message || erro).split('\n')[0].slice(0, 300)}`);
      for (const at of atores) if (at.aberto()) await at.shot(`falha-${nome.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
      passos.push(`[${rotulo}] ✗ ${nome} (${Date.now() - t0} ms)`);
      throw erro;
    }
    passos.push(`[${rotulo}] ${falhas.length === antes ? '✓' : '✗'} ${nome} (${Date.now() - t0} ms)`);
  };

  /**
   * Fecha a largura: erros de página e respostas ≥ 400 inesperadas viram divergência.
   * @param {string} rotulo
   * @param {{ errosPagina: string[], respostasApi: Array<{ ator: string, texto: string, metodo: string, caminho: string, status: number }> }} registro
   * @param {Array<(r: { metodo: string, caminho: string, status: number, ator: string }) => boolean>} esperadas
   */
  const fecharLargura = (rotulo, registro, esperadas = []) => {
    if (registro.errosPagina.length) falhas.push(`[${rotulo}] erros de página: ${registro.errosPagina.slice(0, 3).join(' | ')}`);
    const inesperadas = registro.respostasApi.filter((r) => !esperadas.some((f) => f(r)));
    const aceitas = registro.respostasApi.length - inesperadas.length;
    if (aceitas) console.log(`  [${rotulo}] ${aceitas} resposta(s) ≥400 esperada(s) pelo roteiro`);
    if (inesperadas.length) console.log(`  [${rotulo}] respostas ≥400 da API vistas pelas telas (${inesperadas.length}):\n    ${inesperadas.slice(0, 16).map((r) => `${r.ator}: ${r.texto}`).join('\n    ')}`);
    for (const r of inesperadas) falhas.push(`[${rotulo}] resposta inesperada da API (${r.ator}): ${r.texto.slice(0, 220)}`);
  };

  /** Imprime o resumo e devolve o código de saída. @param {string} ok */
  const concluir = (ok) => {
    console.log(`\n${passos.join('\n')}`);
    console.log(`\nCapturas e logs em ${OUT}`);
    if (falhas.length) {
      console.error(`\nDIVERGÊNCIAS (${falhas.length}):\n- ${falhas.join('\n- ')}`);
      return 1;
    }
    console.log(`\n${ok}`);
    return 0;
  };

  return {
    DATABASE_URL,
    API,
    WEB,
    OUT,
    falhas,
    passos,
    conferir,
    exigir,
    igual,
    subirServicos,
    encerrarProcessos,
    abrirNavegador,
    login,
    api,
    apiDo,
    esperarBanco,
    abrirAtor,
    passo,
    fecharLargura,
    concluir,
  };
};
