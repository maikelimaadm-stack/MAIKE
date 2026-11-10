#!/usr/bin/env node
/**
 * D-PROD-159 — PROVA DE USO REAL ponta a ponta da tela Abastecimentos
 * (Patrimônio e Frota P1-02). Molde: `e2e-lancamentos-real.mjs` (Central).
 *
 * Sobe o backend Fastify REAL (`backend/src/server.js`) contra um PostgreSQL
 * LOCAL, sobe o Vite apontando para ele e conduz a tela pelo Playwright
 * (Chromium já instalado no ambiente; nada é instalado). Depois de cada passo
 * confere o estado NO BANCO (Prisma): fator, abastecimento, fatias, movimento,
 * lotes, `Produto.estoque_atual` e o bem (intocado).
 *
 * UX-02 (D-PROD-160): o formulário é Máquina/Veículo → PRODUTO (o único Produto
 * do bem já vem marcado; o tipo de combustível vem da opção do servidor e não
 * é etapa da tela) → local automático → litros → medidor → "Completou o
 * tanque?" → "Revisar abastecimento" (resumo humano; fator, custo e FIFO em
 * "Detalhes do estoque", recolhido). A lista padrão não tem Nº nem Combustível:
 * o registro é achado pela máquina (tabela) ou pelos litros (card no celular).
 *
 * Roteiro (em 1280, 820 e 390 px; cada largura num tenant próprio semeado por
 * `e2e-abastecimentos-seed.mjs`; "hoje" = dia real no fuso da fazenda):
 *   1. tela vazia ("Nenhum abastecimento…");
 *   2. configurar o fator kg/L PELA TELA ("Fatores kg/L" → Novo fator: Diesel
 *      S10 × DIESEL S10 GRANEL, "0,84", declaração) → 1 fator vigente no banco;
 *   3. Novo abastecimento: máquina TP-02 → Produto DIESEL S10 GRANEL já
 *      marcado (sem etapa de combustível) → "Sai do estoque: TANQUE DIESEL
 *      SEDE" → 80 L → horímetro 1.550,5 → "Completou o tanque?" Sim →
 *      "Revisar abastecimento": 67,2000 kg; em "Detalhes do estoque" o fator
 *      0,840000 versão 1, FIFO em 2 lotes e custo estimado R$ 354,60 (vetor
 *      `fifo`); a revisão NÃO grava nada;
 *   4. Confirmar → no banco: 1 abastecimento CONFIRMADO, 1 Saída
 *      `abastecimento_patrimonio` (lancamento_origem_id = id), 2 fatias,
 *      lotes 0 / 82,8 kg, `estoque_atual` 82,8; o bem não muda (versão e
 *      medidor do cadastro); nenhum lançamento financeiro;
 *   5. histórico: a lista mostra o abastecimento e a consulta mostra KG,
 *      fator, custo FIFO, fatias e o movimento;
 *   6. cancelar (motivo + ciência; aviso da leitura operacional) → no banco:
 *      CANCELADO versão 2, Entrada `estorno_abastecimento`, lotes de volta a
 *      50 / 100 kg, `estoque_atual` 150, bem intocado;
 *   7. resposta PERDIDA (rota interceptada: o pedido chega ao servidor e a
 *      resposta some) → "Resultado incerto" → "Repetir o mesmo envio" = a
 *      MESMA `operation_id`, replay ("nada foi duplicado") e UMA baixa só;
 *  7b. envio que NÃO chega (rota abortada antes do servidor) → "Consultar" diz
 *      "não foi gravado" → "Repetir" com a resposta perdida → "Consultar" acha
 *      pela `operation_id` (filtro C6 da lista) e abre; UMA baixa só;
 *   8. usuário só com `visualizar`: vê a lista e a consulta, nenhum botão de
 *      ação (Novo, Cancelar, Novo fator); a API real recusa 403 os comandos
 *      e nada muda no banco.
 *  Toda resposta ≥ 400 da API real observada pelas telas é divergência.
 *  Em TODA captura (lista, formulário, revisão…): a página não rola na
 *  horizontal (`scrollingElement.scrollWidth <= clientWidth + 1`). Lista
 *  (passos 5 e 8): tabela com as colunas exatas Data | Máquina/Veículo |
 *  Produto | Litros | Medidor | Situação (sem "Combustível"); no celular,
 *  cards com a máquina/veículo no título + Produto, Litros e Data, e a
 *  Situação no card (contrato §1.4: no passo 8 o cancelado mostra "Cancelado"
 *  e os outros "Confirmado", na linha e no card). Na tabela, nenhum rótulo
 *  de cabeçalho cortado nem célula de Data/Litros/Medidor/Situação (elemento
 *  com scrollWidth <= clientWidth + 1) — exceção única: em < 1024 px o rótulo
 *  "Máquina/Veículo" pode sair com reticências (a coluna cede largura ao
 *  Produto; a célula já identifica a máquina) —, coluna Produto com >= 128 px
 *  renderizados e a grade sem rolagem horizontal. Formulário: nenhum
 *  rótulo/campo/etapa "Combustível" nem o tipo "Diesel S10".
 *
 * Uso:
 *   DATABASE_URL=postgresql://postgres@localhost:5433/maike_e2e?host=/tmp \
 *     node scripts/dev/e2e-abastecimentos-real.mjs [pasta-das-capturas]
 * Variáveis opcionais: E2E_API_PORT (3911), E2E_WEB_PORT (5211),
 * E2E_LARGURAS ("1280,820,390"). O banco precisa estar migrado
 * (`npm run deploy:migrate` com a mesma URL). Recusa banco que não seja local.
 * Capturas com deviceScaleFactor 1. Encerra backend e Vite ao sair. Sai com
 * código ≠ 0 em QUALQUER divergência de tela ou de banco.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { exigirBancoLocal, semearAbastecimentoE2E } from './e2e-abastecimentos-seed.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_PORT = Number(process.env.E2E_API_PORT || 3911);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5211);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maike-e2e-abastecimentos'));
const LARGURAS = String(process.env.E2E_LARGURAS || '1280,820,390')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 320);
fs.mkdirSync(OUT, { recursive: true });

const DATABASE_URL = exigirBancoLocal();
const VETORES = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tests/smoke/fixtures/abastecimentoVetores.json'), 'utf8'));
const FIFO = VETORES.fifo;

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

// ─── Banco ──────────────────────────────────────────────────────────────────
process.env.DATABASE_URL = DATABASE_URL;
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const prisma = getPrismaClient();

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
/** Foto das linhas que o abastecimento pode tocar (prova de "nada gravado" e de "bem intocado"). */
const fotoBanco = async (s) => {
  const w = { where: { cliente_id: s.cliente_id }, orderBy: { id: 'asc' } };
  const out = {
    abastecimentos: await prisma.abastecimentoBem.findMany(w),
    fatias: await prisma.abastecimentoBemConsumoLote.findMany(w),
    fatores: await prisma.conversaoCombustivelProduto.findMany(w),
    movimentos: await prisma.movimentacaoEstoque.findMany({ ...w, select: { id: true, status: true, quantidade: true } }),
    lotes: await prisma.estoqueLoteNota.findMany({ ...w, select: { id: true, quantidade_disponivel: true, status: true } }),
    produtos: await prisma.produto.findMany({ ...w, select: { id: true, estoque_atual: true } }),
    bens: await prisma.bemPatrimonial.findMany(w),
    financeiro: await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }),
  };
  return JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
};
const lotesDiesel = async (s) =>
  (await prisma.estoqueLoteNota.findMany({ where: { cliente_id: s.cliente_id, produto_id: s.produto.id }, orderBy: { data_documento: 'asc' } }))
    .map((l) => `${dec(l.quantidade_disponivel)}:${l.status}`)
    .join('|');
const estoqueAtual = async (s) => dec((await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.produto.id } })).estoque_atual);
/** O bem como o cadastro o deixou (o abastecimento NUNCA grava coluna do bem). */
const bemCru = async (s) => {
  const b = await prisma.bemPatrimonial.findFirst({ where: { cliente_id: s.cliente_id, id: s.trator.id } });
  return `${b.versao}:${b.medidor_tipo}:${dec(b.medidor_leitura_atual)}:${b.medidor_origem}:${String(b.medidor_data_leitura?.toISOString?.() ?? b.medidor_data_leitura)}:${b.updatedAt?.toISOString?.() ?? ''}`;
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
  const s = await semearAbastecimentoE2E({ rotulo: `w${rotulo}`, api, login });
  const token = await login(s.credenciais);
  const tokenVis = await login(s.usuarios.vis.credenciais);
  const errosPagina = [];
  const respostasApi = [];
  const atores = [];
  let n = 0;

  const abrirAtor = async (ator, tokenAtor) => {
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
      if (!u.startsWith(API) || r.status() < 400) return;
      const item = { ator, texto: `${r.request().method()} ${u.replace(API, '')} → ${r.status()}` };
      respostasApi.push(item);
      try {
        item.texto += ` ${(await r.text()).slice(0, 400)}`;
      } catch {
        /* sem corpo */
      }
    });
    page.setDefaultTimeout(20000);
    const prefixo = ator === 'dono' ? '' : `${ator}-`;
    let fechado = false;
    const shot = async (etapa) => {
      n += 1;
      await page.waitForTimeout(250); // só para a captura assentar animações; nenhuma prova depende disso
      const arquivo = `abast-${rotulo}-${prefixo}${String(n).padStart(2, '0')}-${etapa}.png`;
      await page.screenshot({ path: path.join(OUT, arquivo), fullPage: false });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      conferir(sw <= largura, `${arquivo}: rolagem horizontal (${sw} > ${largura})`);
      // UX-02: a PÁGINA não rola na horizontal (lista, formulário e revisão em todas as larguras).
      const rol = await page.evaluate(() => {
        const e = document.scrollingElement || document.documentElement;
        return { sw: e.scrollWidth, cw: e.clientWidth };
      });
      conferir(rol.sw <= rol.cw + 1, `${arquivo}: rolagem horizontal da página (scrollingElement.scrollWidth ${rol.sw} > clientWidth ${rol.cw} + 1)`);
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
    /** `SeletorPaginadoGestao`: abre o painel e escolhe a opção pelo nome. */
    const escolher = async (raiz, testId, nome) => {
      await clicar(raiz.getByTestId(testId));
      const painel = page.getByTestId(`${testId}-painel`);
      await painel.getByRole('option', { name: nome }).first().waitFor({ state: 'visible' });
      await painel.getByRole('option', { name: nome }).first().click();
      await painel.waitFor({ state: 'detached' }).catch(() => {});
    };
    const irParaLista = async () => {
      await page.goto(`${WEB}/abastecimentos`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
    };
    const esperarNaLista = (registro) =>
      page.waitForFunction(
        ({ id, litros }) =>
          [...document.querySelectorAll(`[data-testid="abastecimento-bem-${id}"]`)].some((e) => e.getClientRects().length > 0) ||
          [...document.querySelectorAll('[data-testid="b1-card"]')].some((e) => e.textContent?.includes(litros) && e.getClientRects().length > 0),
        { id: registro.id, litros: registro.litros },
      );
    /**
     * UX-02: confere a LISTA padrão com o registro (e captura). Tabela (≥ 640
     * px; obrigatória em ≥ 1024): colunas exatas Data | Máquina/Veículo |
     * Produto | Litros | Medidor | Situação, sem "Combustível", e a linha com a
     * máquina, o Produto, os litros e a data. Celular (< 640): cards com a
     * máquina/veículo no título + Produto, Litros e Data (sem tabela).
     */
    const conferirLista = async (registro, etapa, outros = []) => {
      await irParaLista();
      await esperarNaLista(registro);
      for (const o of outros) await esperarNaLista(o);
      const [ano, mes, dia] = String(s.hoje).split('-');
      const dataBr = `${dia}/${mes}/${ano}`;
      const cabecalhos = (await page.getByRole('columnheader').filter({ visible: true }).allTextContents()).map((t) => t.trim()).filter(Boolean);
      if (largura >= 1024) conferir(cabecalhos.length > 0, `[${rotulo}] ${ator}: lista sem tabela em ${largura} px`);
      if (movel) conferir(cabecalhos.length === 0, `[${rotulo}] ${ator}: lista em tabela no celular (${cabecalhos.join(' | ')})`);
      if (cabecalhos.length) {
        igual(cabecalhos.join(' | '), 'Data | Máquina/Veículo | Produto | Litros | Medidor | Situação', `[${rotulo}] ${ator}: colunas padrão da lista`);
        conferir(!cabecalhos.some((c) => /combust/i.test(c)), `[${rotulo}] ${ator}: coluna de combustível na lista (${cabecalhos.join(' | ')})`);
        // Tablet e desktop (UX-02, linha 67): as 6 colunas padrão cabem na área
        // visível da grade, sem rolar a tabela por dentro para ver a Situação.
        const encaixe = await page.getByRole('columnheader', { name: 'Situação' }).first().evaluate((th) => {
          let el = th.parentElement;
          while (el && el !== document.body) {
            const ox = getComputedStyle(el).overflowX;
            if (ox === 'auto' || ox === 'scroll') break;
            el = el.parentElement;
          }
          const caixa = (el && el !== document.body ? el : document.documentElement).getBoundingClientRect();
          return { direita: Math.round(th.getBoundingClientRect().right), limite: Math.round(caixa.right), sw: el?.scrollWidth ?? 0, cw: el?.clientWidth ?? 0 };
        });
        conferir(
          encaixe.direita <= encaixe.limite + 1,
          `[${rotulo}] ${ator}: coluna Situação fora da área visível da grade em ${largura} px (borda ${encaixe.direita} > ${encaixe.limite})`,
        );
        // Rodada 2 (L2): a grade (contêiner com overflow-x da tabela) não rola na
        // horizontal — as 6 colunas padrão cabem sem arrastar a tabela.
        conferir(encaixe.sw <= encaixe.cw + 1, `[${rotulo}] ${ator}: a grade rola na horizontal em ${largura} px (scrollWidth ${encaixe.sw} > clientWidth ${encaixe.cw} + 1)`);
        // Revisão final UX-02 (L2): em 820 px "Medidor" e "Máquina/Veículo" saíam com
        // reticências e Litros cortava a partir de 100 L. `allTextContents` (acima)
        // devolve o texto inteiro mesmo cortado, então mede o ELEMENTO do rótulo
        // (scrollWidth <= clientWidth + 1). Também as células de Data, Litros,
        // Medidor e Situação (Máquina e Produto cortam de propósito, com `title`).
        const cortes = await visivel(page.locator('table.mg-grid')).evaluate((tabela) => {
          const ths = [...tabela.querySelectorAll('thead th')];
          const rotuloDe = (th) => th.querySelector('button span') || th.querySelector('button');
          const out = [];
          const cabecalhosCortados = [];
          const indice = {};
          ths.forEach((th, i) => {
            const el = rotuloDe(th);
            const t = el?.textContent.trim();
            if (!t) return;
            indice[t] = i;
            if (el.scrollWidth > el.clientWidth + 1) cabecalhosCortados.push({ t, sw: el.scrollWidth, cw: el.clientWidth });
          });
          for (const tr of tabela.querySelectorAll('tbody tr')) {
            for (const nome of ['Data', 'Litros', 'Medidor', 'Situação']) {
              const td = indice[nome] === undefined ? null : tr.children[indice[nome]];
              if (td && td.scrollWidth > td.clientWidth + 1) out.push(`${nome} "${td.textContent.trim()}" (${td.scrollWidth} > ${td.clientWidth})`);
            }
          }
          const thProduto = indice.Produto === undefined ? null : ths[indice.Produto];
          return { out, cabecalhosCortados, rotulos: Object.keys(indice), larguraProduto: thProduto ? Math.round(thProduto.getBoundingClientRect().width * 10) / 10 : 0 };
        });
        igual(cortes.rotulos.join(' | '), 'Data | Máquina/Veículo | Produto | Litros | Medidor | Situação', `[${rotulo}] ${ator}: rótulos medidos na grade`);
        // Rodada 2 (L2, decisão do orquestrador): no tablet (< 1024 px) o PRODUTO
        // vale mais que o rótulo inteiro "Máquina/Veículo" — vários Produtos do
        // mesmo combustível só se distinguem pela última palavra ("Diesel S10
        // granel" × "Diesel S10 posto") e não há hover para o `title`, enquanto a
        // célula da máquina já a identifica ("TP-02 — …"). Por isso, em < 1024 px,
        // SÓ o rótulo "Máquina/Veículo" pode sair com reticências; em >= 1024 px,
        // nenhum. Qualquer outro rótulo cortado é divergência.
        const rotuloPodeCortar = (t) => largura < 1024 && t === 'Máquina/Veículo';
        const cabecalhosRuins = cortes.cabecalhosCortados.filter((c) => !rotuloPodeCortar(c.t)).map((c) => `cabeçalho "${c.t}" (${c.sw} > ${c.cw})`);
        const aceitos = cortes.cabecalhosCortados.filter((c) => rotuloPodeCortar(c.t));
        if (aceitos.length) console.log(`  [${rotulo}] ${ator}: ${largura} px — rótulo "Máquina/Veículo" com reticências (${aceitos[0].sw} > ${aceitos[0].cw}), exceção aceita no tablet`);
        conferir(cabecalhosRuins.length === 0 && cortes.out.length === 0, `[${rotulo}] ${ator}: texto cortado na lista em ${largura} px: ${[...cabecalhosRuins, ...cortes.out].join('; ')}`);
        // O seed usa "DIESEL S10 GRANEL" (127 px em maiúsculas, mais largo que os
        // nomes comuns), então em vez de exigir a célula inteira confere a
        // LARGURA renderizada da coluna: >= 128 px deixa ~109 px de texto, onde
        // cabem "Gasolina comum", "Diesel S10 granel" e "Diesel S10 posto".
        conferir(cortes.larguraProduto >= 128, `[${rotulo}] ${ator}: coluna Produto com ${cortes.larguraProduto} px (< 128) em ${largura} px — o nome do Produto perde a palavra que o distingue`);
        for (const r of [registro, ...outros]) {
          const linha = visivel(page.locator('tr').filter({ has: page.getByTestId(`abastecimento-bem-${r.id}`) }));
          const txt = (await linha.innerText()).replace(/\s+/g, ' ');
          conferir(
            txt.includes('TP-02') && txt.includes('DIESEL S10 GRANEL') && txt.includes(r.litros) && txt.includes(dataBr),
            `[${rotulo}] ${ator}: linha da lista sem máquina/Produto/litros/data (${txt})`,
          );
          if (r.situacao) igual((await visivel(page.getByTestId(`abastecimento-situacao-${r.id}`)).innerText()).trim(), r.situacao, `[${rotulo}] ${ator}: linha ${r.litros} — Situação`);
        }
      }
      if (movel) {
        for (const r of [registro, ...outros]) {
          const card = visivel(page.getByTestId('b1-card').filter({ hasText: r.litros }));
          const titulo = (await card.locator('.mg-b1-card__title').innerText().catch(() => '')).trim();
          conferir(titulo.includes('TP-02') && titulo.includes('Trator TP-02'), `[${rotulo}] ${ator}: título do card sem a máquina/veículo (${titulo})`);
          const rotulos = (await card.locator('.mg-b1-card__label').allInnerTexts()).map((t) => t.trim().replace(/:$/, ''));
          const valores = (await card.locator('.mg-b1-card__value').allInnerTexts()).map((t) => t.trim());
          const campos = Object.fromEntries(rotulos.map((rr, i) => [rr, valores[i]]));
          igual(campos.Produto, 'DIESEL S10 GRANEL', `[${rotulo}] ${ator}: card ${r.litros} — Produto`);
          igual(campos.Litros, r.litros, `[${rotulo}] ${ator}: card ${r.litros} — Litros`);
          igual(campos.Data, dataBr, `[${rotulo}] ${ator}: card ${r.litros} — Data`);
          conferir(!rotulos.some((rr) => /combust/i.test(rr)), `[${rotulo}] ${ator}: card com combustível (${rotulos.join(', ')})`);
          // Contrato §1.4: a Situação aparece no card (Cancelado ≠ Confirmado sem abrir o registro).
          if (r.situacao) {
            const sub = (await card.locator('.mg-b1-card__sub').innerText().catch(() => '')).trim();
            const situacaoNosCampos = campos['Situação'];
            conferir(sub === r.situacao || situacaoNosCampos === r.situacao, `[${rotulo}] ${ator}: card ${r.litros} sem a Situação "${r.situacao}" (subtítulo "${sub}", campos ${rotulos.join(', ')})`);
          }
        }
      }
      await shot(etapa);
    };
    /**
     * Abre o abastecimento pela lista: na tabela pela célula da máquina (o Nº
     * é coluna opcional desde a UX-02); no celular pelo card com os litros dele.
     */
    const abrirNaLista = async (registro) => {
      await irParaLista();
      let alvo = page.getByTestId(`abastecimento-bem-${registro.id}`);
      await page.waitForFunction(
        ({ id, litros }) =>
          [...document.querySelectorAll(`[data-testid="abastecimento-bem-${id}"]`)].some((e) => e.getClientRects().length > 0) ||
          [...document.querySelectorAll('[data-testid="b1-card"]')].some((e) => e.textContent?.includes(litros) && e.getClientRects().length > 0),
        { id: registro.id, litros: registro.litros },
      );
      if (!(await visivel(alvo).isVisible().catch(() => false))) {
        alvo = page.getByTestId('b1-card').filter({ hasText: registro.litros });
      }
      const el = visivel(alvo);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.dblclick();
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor();
    };
    const fechar = async () => {
      if (fechado) return;
      fechado = true;
      await ctx.close().catch(() => {});
    };
    const a = { ator, page, requisicoes, shot, visivel, clicar, preencher, escolher, irParaLista, conferirLista, abrirNaLista, fechar, aberto: () => !fechado };
    atores.push(a);
    return a;
  };

  const passo = async (nome, fn) => {
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

  const dono = await abrirAtor('dono', token);
  const { page, shot, visivel, clicar, preencher, escolher, irParaLista, conferirLista, abrirNaLista } = dono;
  const bemAntes = await bemCru(s);
  const reg = {};

  /**
   * Preenche o formulário do TP-02 como o usuário (UX-02): máquina → o único
   * Produto já vem marcado (sem etapa de combustível) → local automático →
   * litros/leitura em texto pt-BR → "Completou o tanque?" Sim.
   */
  const preencherTrator = async (litros, leitura) => {
    await clicar(page.getByRole('button', { name: 'Novo abastecimento' }));
    const form = visivel(page.getByTestId('abastecimento-form'));
    await form.waitFor();
    await escolher(form, 'abastecimento-bem', /TP-02/);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-testid="abastecimento-produto"] [role="radio"][aria-checked="true"]')].some((r) => r.textContent?.trim() === 'DIESEL S10 GRANEL' && r.getClientRects().length > 0),
    );
    await visivel(page.getByTestId('abastecimento-local-auto').filter({ hasText: 'Sai do estoque: TANQUE DIESEL SEDE' })).waitFor();
    igual(await page.getByTestId('abastecimento-combustivel').count(), 0, `[${rotulo}] o formulário ainda tem a etapa "Combustível"`);
    igual(await form.getByRole('radio', { name: 'Diesel S10', exact: true }).count(), 0, `[${rotulo}] o tipo "Diesel S10" aparece como escolha no formulário`);
    // UX-02: nenhuma ETAPA "Combustível" (rótulo, legenda ou campo) no formulário; o tipo não é exibido.
    igual(await form.getByText(/^\s*(Tipo de )?[Cc]ombust[íi]vel\s*\*?\s*$/).filter({ visible: true }).count(), 0, `[${rotulo}] o formulário tem rótulo/etapa "Combustível"`);
    igual(await form.getByLabel(/^\s*(Tipo de )?[Cc]ombust[íi]vel\s*\*?\s*$/).count(), 0, `[${rotulo}] o formulário tem campo "Combustível"`);
    igual(await form.getByText('Diesel S10', { exact: true }).filter({ visible: true }).count(), 0, `[${rotulo}] o formulário mostra o tipo "Diesel S10"`);
    const rotulosForm = (await form.locator('label, legend, [role="radiogroup"]').filter({ visible: true }).allInnerTexts()).map((t) => t.split('\n')[0].trim()).filter(Boolean);
    conferir(!rotulosForm.some((t) => /^combust[íi]vel\b/i.test(t)), `[${rotulo}] etapa de combustível no formulário (${rotulosForm.join(' / ')})`);
    igual(await visivel(page.getByTestId('abastecimento-data')).inputValue(), s.hoje, `[${rotulo}] data padrão do formulário (hoje no fuso da fazenda)`);
    await preencher('abastecimento-litros', litros);
    await preencher('abastecimento-leitura', leitura);
    const sim = visivel(page.getByTestId('abastecimento-tanque-cheio').getByRole('radio', { name: 'Sim' }));
    if ((await sim.getAttribute('aria-checked')) !== 'true') await sim.click();
    return form;
  };
  /** "Revisar abastecimento" → revisão do servidor (sem escrita). */
  const pedirPrevia = async () => {
    await clicar(page.getByTestId('abastecimento-previa'));
    const dlg = visivel(page.getByTestId('dialogo-previa-abastecimento'));
    await dlg.waitFor();
    await visivel(page.getByTestId('previa-kg')).waitFor();
    return dlg;
  };
  /** Abre "Detalhes do estoque" da revisão (recolhido por padrão). */
  const abrirDetalhesDoEstoque = async () => {
    const botao = visivel(page.getByTestId('previa-detalhes-estoque'));
    igual(await botao.getAttribute('aria-expanded'), 'false', `[${rotulo}] "Detalhes do estoque" não começa recolhido`);
    await botao.click();
    await visivel(page.getByTestId('previa-fator')).waitFor();
  };

  try {
    await passo('1 tela vazia', async () => {
      await irParaLista();
      await visivel(page.getByTestId('abastecimento-lista-vazia')).waitFor();
      exigir(await visivel(page.getByRole('button', { name: 'Novo abastecimento' })).isVisible(), `[${rotulo}] dono sem o botão "Novo abastecimento"`);
      await shot('lista-vazia');
    });

    await passo('2 configurar o fator kg/L pela tela', async () => {
      await clicar(page.getByTestId('abastecimento-fatores'));
      const dlg = visivel(page.getByTestId('conversoes-combustivel'));
      await dlg.waitFor();
      await clicar(page.getByTestId('conversao-nova'));
      await visivel(page.getByTestId('conversao-form')).waitFor();
      await escolher(dlg, 'conversao-tipo', /Diesel S10/);
      await escolher(dlg, 'conversao-produto', /DIESEL S10 GRANEL/);
      await visivel(page.getByText('Este par não tem fator vigente: salvar cria uma nova versão.')).waitFor();
      await preencher('conversao-fator', '0,84');
      await visivel(page.getByTestId('conversao-declaracao')).check();
      await shot('fator-form');
      await clicar(page.getByTestId('conversao-salvar'));
      const fator = await esperarBanco(
        () => prisma.conversaoCombustivelProduto.findFirst({ where: { cliente_id: s.cliente_id, produto_id: s.produto.id, ativo: true } }),
        'fator vigente gravado',
      );
      igual(`${fator.kg_por_litro.toFixed(6)}:${fator.sequencia}:${fator.versao}:${fator.declara_estoque_em_kg}:${fator.tipo_combustivel_id === s.combustivel.id}`, '0.840000:1:1:true:true', `[${rotulo}] fator no banco`);
      igual(await prisma.conversaoCombustivelProduto.count({ where: { cliente_id: s.cliente_id } }), 1, `[${rotulo}] fatores no banco`);
      await visivel(page.getByTestId(`conversao-${fator.id}`)).waitFor();
      await shot('fator-salvo');
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'hidden' });
      reg.fator = fator;
    });

    await passo('3 formulário → revisão (sem escrita)', async () => {
      await irParaLista();
      await preencherTrator('80', '1.550,5');
      await shot('formulario');
      const antes = await fotoBanco(s);
      await pedirPrevia();
      const resumo = await visivel(page.getByTestId('previa-resumo')).innerText();
      conferir(resumo.includes('DIESEL S10 GRANEL') && resumo.includes('80 L') && resumo.includes('67,2000 kg'), `[${rotulo}] revisão: resumo ${resumo}`);
      igual(await page.getByTestId('previa-fator').filter({ visible: true }).count(), 0, `[${rotulo}] revisão: fator fora de "Detalhes do estoque"`);
      await shot('previa');
      await abrirDetalhesDoEstoque();
      const kg = await visivel(page.getByTestId('previa-kg')).innerText();
      const fator = await visivel(page.getByTestId('previa-fator')).innerText();
      const custo = await visivel(page.getByTestId('previa-custo')).innerText();
      conferir(kg.includes('67,2000'), `[${rotulo}] prévia: KG ${kg}`);
      conferir(fator.includes('0,840000') && fator.includes('versão 1'), `[${rotulo}] prévia: fator ${fator}`);
      conferir(custo.includes('354,60') && /estimativa/i.test(custo), `[${rotulo}] prévia: custo ${custo}`);
      const linhas = await visivel(page.getByTestId('previa-fatias')).locator('tbody tr').allInnerTexts();
      igual(linhas.length, FIFO.fatias.length, `[${rotulo}] prévia: lotes FIFO`);
      conferir(linhas[0]?.includes('50,0000') && linhas[1]?.includes('17,2000'), `[${rotulo}] prévia: fatias ${linhas.join(' / ')}`);
      igual(await page.getByTestId('previa-bloqueios').count(), 0, `[${rotulo}] prévia com bloqueio`);
      igual(await fotoBanco(s), antes, `[${rotulo}] a prévia gravou algo`);
      await shot('previa-detalhes');
    });

    await passo('4 confirmar → baixa FIFO exata no banco', async () => {
      await clicar(page.getByTestId('abastecimento-confirmar'));
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
      const toast = visivel(page.getByText(/confirmado: 67,2000 kg baixados do estoque\./));
      conferir(await toast.waitFor({ timeout: 8000 }).then(() => true, () => false), `[${rotulo}] aviso de confirmação ausente`);
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO' } }), 'abastecimento confirmado');
      igual(
        `${dec(ab.quantidade_litros)}:${ab.kg_por_litro.toFixed(6)}:${dec(ab.quantidade_kg)}:${dec(ab.custo_total)}:${dec(ab.custo_unitario_kg)}:${dec(ab.medidor_leitura)}:${ab.tanque_cheio}:${ab.conversao_id === reg.fator.id}`,
        `80.0000:0.840000:${FIFO.kg}:${FIFO.custo_total}:${FIFO.custo_unitario_kg}:1550.5000:true:true`,
        `[${rotulo}] abastecimento no banco`,
      );
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estoque_id } });
      igual(`${mov.tipo_movimentacao}:${mov.origem_sistema}:${mov.lancamento_origem_id === ab.id}:${dec(mov.quantidade)}:${dec(mov.valor_total)}:${mov.status}`, `Saída:abastecimento_patrimonio:true:${FIFO.kg}:${FIFO.custo_total}:Ativa`, `[${rotulo}] movimento de saída`);
      const fatias = await prisma.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: s.cliente_id, abastecimento_id: ab.id }, orderBy: { ordem: 'asc' } });
      igual(
        fatias.map((f) => `${f.estoque_lote_nota_id === s.lotes[f.ordem - 1]?.id}:${dec(f.quantidade)}:${dec(f.custo_unitario)}:${dec(f.quantidade.times(f.custo_unitario).toDecimalPlaces(4))}`).join('|'),
        FIFO.fatias.map((f) => `true:${f.quantidade_kg}:${f.custo_unitario}:${f.valor}`).join('|'),
        `[${rotulo}] fatias FIFO`,
      );
      igual(await lotesDiesel(s), '0.0000:Esgotado|82.8000:Disponivel', `[${rotulo}] lotes após a baixa`);
      igual(await estoqueAtual(s), '82.8000', `[${rotulo}] estoque_atual após a baixa`);
      igual(await bemCru(s), bemAntes, `[${rotulo}] o abastecimento alterou o bem`);
      igual(await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }), 0, `[${rotulo}] lançamento financeiro criado`);
      reg.primeiro = { id: ab.id, numero: ab.numero, litros: '80,0000 L', situacao: 'Confirmado' };
      await shot('confirmado');
    });

    await passo('5 histórico: lista e consulta', async () => {
      await conferirLista(reg.primeiro, 'lista');
      await abrirNaLista(reg.primeiro);
      const kg = await visivel(page.getByTestId('consulta-kg')).innerText();
      const fator = await visivel(page.getByTestId('consulta-fator')).innerText();
      const custo = await visivel(page.getByTestId('consulta-custo')).innerText();
      conferir(kg.includes('67,2000'), `[${rotulo}] consulta: KG ${kg}`);
      conferir(fator.includes('0,840000'), `[${rotulo}] consulta: fator ${fator}`);
      conferir(custo.includes('354,60'), `[${rotulo}] consulta: custo ${custo}`);
      igual(await visivel(page.getByTestId('consulta-fatias')).locator('tbody tr').count(), 2, `[${rotulo}] consulta: fatias`);
      conferir(/Saída|abastecimento/i.test(await visivel(page.getByTestId('consulta-movimento')).innerText()), `[${rotulo}] consulta: movimento ausente`);
      igual(await visivel(page.getByTestId('abastecimento-consulta-situacao')).innerText(), 'Confirmado', `[${rotulo}] consulta: situação`);
      conferir((await visivel(page.getByTestId('consulta-produto')).innerText()).includes('DIESEL S10 GRANEL'), `[${rotulo}] consulta: Produto`);
      conferir((await visivel(page.getByTestId('consulta-tipo')).innerText()).includes('Diesel S10'), `[${rotulo}] consulta: tipo de combustível (classificação)`);
      await shot('consulta');
    });

    await passo('6 cancelar → devolução exata aos lotes', async () => {
      await clicar(page.getByTestId('abastecimento-cancelar'));
      const dlg = visivel(page.getByTestId('dialogo-cancelamento-abastecimento'));
      await dlg.waitFor();
      const aviso = visivel(page.getByTestId('cancelamento-aviso-medidor'));
      conferir(await aviso.isVisible().catch(() => false), `[${rotulo}] cancelamento sem o aviso da leitura operacional`);
      conferir(/1\.550,5/.test(await aviso.innerText().catch(() => '')), `[${rotulo}] aviso do medidor sem a leitura 1.550,5`);
      const enviar = visivel(page.getByTestId('cancelamento-enviar'));
      conferir(await enviar.isDisabled(), `[${rotulo}] cancelar habilitado sem motivo/ciência`);
      await visivel(page.getByTestId('cancelamento-motivo')).fill('Lançado no bem errado');
      await visivel(page.getByTestId('cancelamento-ciente')).check();
      await shot('cancelamento');
      await enviar.click();
      const toast = visivel(page.getByText(/cancelado: 67,2000 kg devolvidos aos lotes de origem\./));
      conferir(await toast.waitFor({ timeout: 15000 }).then(() => true, () => false), `[${rotulo}] aviso de cancelamento ausente`);
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, id: reg.primeiro.id, status: 'CANCELADO' } }), 'abastecimento cancelado');
      igual(`${ab.versao}:${ab.motivo_cancelamento}`, '2:Lançado no bem errado', `[${rotulo}] cancelamento no banco`);
      const est = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estorno_id } });
      igual(`${est?.tipo_movimentacao}:${est?.tipo_detalhado}:${dec(est?.quantidade)}:${dec(est?.valor_total)}`, `Entrada:estorno_abastecimento:${FIFO.kg}:${FIFO.custo_total}`, `[${rotulo}] movimento de estorno`);
      igual(await lotesDiesel(s), '50.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes após o cancelamento`);
      igual(await estoqueAtual(s), '150.0000', `[${rotulo}] estoque_atual após o cancelamento`);
      igual(await bemCru(s), bemAntes, `[${rotulo}] o cancelamento alterou o bem`);
      await visivel(page.getByTestId('consulta-estorno')).waitFor();
      igual(await visivel(page.getByTestId('abastecimento-consulta-situacao')).innerText(), 'Cancelado', `[${rotulo}] consulta: situação após cancelar`);
      igual(await page.getByTestId('abastecimento-cancelar').filter({ visible: true }).count(), 0, `[${rotulo}] botão cancelar num abastecimento cancelado`);
      await shot('cancelado');
    });

    await passo('7 resposta perdida + "Repetir o mesmo envio" = 1 baixa', async () => {
      await irParaLista();
      await preencherTrator('30', '1.560');
      await pedirPrevia();
      conferir((await visivel(page.getByTestId('previa-kg')).innerText()).includes('25,2000'), `[${rotulo}] prévia de 30 L sem 25,2000 kg`);
      const enviados = [];
      const rota = (u) => u.pathname === '/api/native/patrimonio-abastecimentos';
      await page.route(rota, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.continue();
        enviados.push(JSON.parse(req.postData() || '{}').operation_id);
        if (enviados.length === 1) {
          await route.fetch(); // chega ao servidor e é processada…
          return route.abort('failed'); // …mas a resposta se perde no caminho
        }
        return route.continue();
      });
      try {
        await clicar(page.getByTestId('abastecimento-confirmar'));
        await visivel(page.getByTestId('resultado-incerto')).waitFor({ timeout: 30000 });
        // a 1ª confirmação FOI gravada pelo servidor (a tela não sabe): condição no banco
        await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, operation_id: enviados[0] } }), 'abastecimento gravado pela 1ª tentativa');
        conferir(!(await page.getByTestId('abastecimento-consulta').filter({ visible: true }).count()), `[${rotulo}] resultado incerto tratado como sucesso`);
        await shot('resultado-incerto');
        await clicar(page.getByTestId('botao-repetir-envio'));
        await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
        const toast = visivel(page.getByText(/confirmado: 25,2000 kg baixados do estoque\. \(envio repetido: nada foi duplicado\)/));
        conferir(await toast.waitFor({ timeout: 8000 }).then(() => true, () => false), `[${rotulo}] replay não foi comunicado ("nada foi duplicado")`);
        await shot('replay');
      } finally {
        await page.unroute(rota).catch(() => {});
      }
      igual(enviados.length, 2, `[${rotulo}] envios da confirmação`);
      conferir(enviados[0] && enviados[0] === enviados[1], `[${rotulo}] a repetição não reusou o operation_id (${enviados.join(' ≠ ')})`);
      igual(await prisma.abastecimentoBem.count({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO' } }), 1, `[${rotulo}] abastecimentos confirmados após o replay`);
      igual(
        await prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, origem_sistema: 'abastecimento_patrimonio', tipo_movimentacao: 'Saída', status: 'Ativa' } }),
        1,
        `[${rotulo}] saídas ativas de abastecimento após o replay`,
      );
      const daRepeticao = await prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, operation_id: enviados[0] } });
      igual(
        await prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, lancamento_origem_id: daRepeticao?.id ?? '-', tipo_movimentacao: 'Saída' } }),
        1,
        `[${rotulo}] saídas do abastecimento repetido`,
      );
      igual(await lotesDiesel(s), '24.8000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes após a confirmação repetida (UMA baixa)`);
      igual(await estoqueAtual(s), '124.8000', `[${rotulo}] estoque_atual após a confirmação repetida`);
      const ab = await prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO' } });
      reg.segundo = { id: ab.id, numero: ab.numero, versao: ab.versao, litros: '30,0000 L', situacao: 'Confirmado' };
    });

    await passo('7b envio que não chegou + "Consultar" (não gravado) → repetir com resposta perdida + "Consultar" (achado pela operation_id)', async () => {
      await irParaLista();
      await preencherTrator('10', '1.570');
      await pedirPrevia();
      const enviados = [];
      const rota = (u) => u.pathname === '/api/native/patrimonio-abastecimentos';
      await page.route(rota, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.continue();
        enviados.push(JSON.parse(req.postData() || '{}').operation_id);
        if (enviados.length === 1) return route.abort('failed'); // 1º: nem chega ao servidor
        if (enviados.length === 2) {
          await route.fetch(); // 2º: chega e é gravado…
          return route.abort('failed'); // …mas a resposta se perde
        }
        return route.continue();
      });
      try {
        await clicar(page.getByTestId('abastecimento-confirmar'));
        await visivel(page.getByTestId('resultado-incerto')).waitFor({ timeout: 30000 });
        await clicar(page.getByTestId('botao-consultar-resultado'));
        const nao = visivel(page.getByTestId('consulta-resultado'));
        await nao.waitFor();
        igual(await nao.innerText(), 'O envio não foi gravado. Você pode repetir o mesmo envio.', `[${rotulo}] "Consultar" do envio que não chegou`);
        igual(await prisma.abastecimentoBem.count({ where: { cliente_id: s.cliente_id, operation_id: enviados[0] } }), 0, `[${rotulo}] envio que não chegou foi gravado`);
        await shot('consultar-nao-gravado');
        await clicar(page.getByTestId('botao-repetir-envio'));
        await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, operation_id: enviados[0] } }), 'abastecimento gravado pela repetição');
        await page.waitForFunction(() => {
          const el = document.querySelector('[data-testid="resultado-incerto"]');
          return el && !document.querySelector('[data-testid="consulta-resultado"]');
        });
        await clicar(page.getByTestId('botao-consultar-resultado'));
        await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
        const toast = visivel(page.getByText(/confirmado: 8,4000 kg baixados do estoque\./));
        conferir(await toast.waitFor({ timeout: 8000 }).then(() => true, () => false), `[${rotulo}] "Consultar" achou o gravado mas não avisou`);
        conferir((await visivel(page.getByTestId('consulta-kg')).innerText()).includes('8,4000'), `[${rotulo}] consulta do abastecimento achado pela chave`);
        await shot('consultar-achado');
      } finally {
        await page.unroute(rota).catch(() => {});
      }
      igual(enviados.length, 2, `[${rotulo}] envios (o "Consultar" não reenvia)`);
      conferir(enviados[0] && enviados[0] === enviados[1], `[${rotulo}] a repetição não reusou o operation_id (${enviados.join(' ≠ ')})`);
      igual(await prisma.abastecimentoBem.count({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO' } }), 2, `[${rotulo}] abastecimentos confirmados após o "Consultar"`);
      igual(await lotesDiesel(s), '16.4000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes após o "Consultar" (UMA baixa de 8,4 kg)`);
      igual(await estoqueAtual(s), '116.4000', `[${rotulo}] estoque_atual após o "Consultar"`);
      igual(await bemCru(s), bemAntes, `[${rotulo}] os abastecimentos alteraram o bem`);
      const terceiro = await prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, operation_id: enviados[0] } });
      reg.terceiro = { id: terceiro.id, numero: terceiro.numero, litros: '10,0000 L', situacao: 'Confirmado' };
    });

    await passo('8 usuário só visualizar: sem botões na tela e 403 na API', async () => {
      const vis = await abrirAtor('vis', tokenVis);
      // Lista padrão (UX-02): Data | Máquina/Veículo | Produto | Litros | Medidor | Situação — sem "Combustível"; cards no celular.
      // Situação na linha e no card: o 80 L cancelado no passo 6 ≠ os confirmados (contrato §1.4).
      await vis.conferirLista(reg.segundo, 'lista', [{ ...reg.primeiro, situacao: 'Cancelado' }, reg.terceiro]);
      igual(await vis.page.getByRole('button', { name: 'Novo abastecimento' }).filter({ visible: true }).count(), 0, `[${rotulo}] só-visualizar vê "Novo abastecimento"`);
      await vis.abrirNaLista(reg.segundo);
      igual(await vis.page.getByTestId('abastecimento-cancelar').filter({ visible: true }).count(), 0, `[${rotulo}] só-visualizar vê "Cancelar"`);
      await vis.shot('consulta');
      await vis.clicar(vis.page.getByTestId('abastecimento-fatores'));
      await vis.visivel(vis.page.getByTestId('conversoes-combustivel')).waitFor();
      await vis.visivel(vis.page.getByTestId(`conversao-${reg.fator.id}`)).waitFor();
      igual(await vis.page.getByTestId('conversao-nova').filter({ visible: true }).count(), 0, `[${rotulo}] só-visualizar vê "Novo fator"`);
      igual(await vis.page.locator('[data-testid^="conversao-alterar-"], [data-testid^="conversao-encerrar-"]').filter({ visible: true }).count(), 0, `[${rotulo}] só-visualizar vê Alterar/Encerrar fator`);
      await vis.shot('fatores');
      // O servidor também recusa (403), sem mexer em nada.
      const antes = await fotoBanco(s);
      const corpoBase = {
        empresa_id: s.empresa.id, bem_id: s.trator.id, tanque_id: s.trator.tanque_id, tipo_combustivel_id: s.combustivel.id, produto_id: s.produto.id,
        local_estoque_id: s.local.id, data_operacional: s.hoje, quantidade_litros: '10', medidor_leitura: '1570', tanque_cheio: false, observacao: null, referencia_externa: null,
      };
      const recusas = {
        previa: await api(tokenVis, 'POST', '/api/native/patrimonio-abastecimentos-previa', corpoBase),
        confirmar: await api(tokenVis, 'POST', '/api/native/patrimonio-abastecimentos', { ...corpoBase, operation_id: `lanc-e2e-vis-${Date.now()}`, conversao_id: reg.fator.id, conversao_versao: 1 }),
        cancelar: await api(tokenVis, 'POST', `/api/native/patrimonio-abastecimentos/${reg.segundo.id}/cancelar`, { empresa_id: s.empresa.id, versao: reg.segundo.versao, motivo: 'tentativa sem permissão', operation_id: `lanc-e2e-vis-c-${Date.now()}` }),
        fator: await api(tokenVis, 'POST', '/api/native/patrimonio-conversoes-combustivel', {
          empresa_id: s.empresa.id, tipo_combustivel_id: s.combustivel.id, produto_id: s.produto.id, kg_por_litro: '0.85', declara_estoque_em_kg: true, conversao_vigente_id: reg.fator.id,
        }),
        locais: await api(tokenVis, 'GET', `/api/native/patrimonio-abastecimentos-opcoes/locais?empresa_id=${s.empresa.id}&produto_id=${s.produto.id}`),
      };
      for (const [k, r] of Object.entries(recusas)) igual(`${r.status}:${r.corpo?.code}`, '403:ACAO_NAO_PERMITIDA', `[${rotulo}] API só-visualizar: ${k}`);
      const leitura = await api(tokenVis, 'GET', `/api/native/patrimonio-abastecimentos/${reg.segundo.id}?empresa_id=${s.empresa.id}`);
      igual(`${leitura.status}:${leitura.corpo?.quantidade_kg}`, '200:25.2000', `[${rotulo}] API só-visualizar: detalhe`);
      igual(await fotoBanco(s), antes, `[${rotulo}] as recusas 403 mexeram no banco`);
      await vis.fechar();
    });
  } catch (erro) {
    if (!(erro instanceof Divergencia)) console.error(`  [${rotulo}] interrompido: ${String(erro?.message || erro).split('\n')[0]}`);
  } finally {
    await new Promise((r) => setTimeout(r, 400)); // corpos das últimas respostas ainda em leitura
    if (errosPagina.length) falhas.push(`[${rotulo}] erros de página: ${errosPagina.slice(0, 3).join(' | ')}`);
    if (respostasApi.length) console.log(`  [${rotulo}] respostas ≥400 da API vistas pelas telas (${respostasApi.length}):\n    ${respostasApi.slice(0, 16).map((r) => `${r.ator}: ${r.texto}`).join('\n    ')}`);
    for (const r of respostasApi) falhas.push(`[${rotulo}] resposta inesperada da API (${r.ator}): ${r.texto.slice(0, 220)}`);
    for (const at of atores) await at.fechar();
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
  // Chromium em pt-BR: o campo de dia NATIVO segue o idioma do processo do navegador (LANG), não o `locale` do contexto.
  const browser = await chromium.launch({ env: { ...envLimpo(), LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } });
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
  console.log('\nOK: tela real + backend real + PostgreSQL local sem divergências.');
}
process.exit(codigo);
