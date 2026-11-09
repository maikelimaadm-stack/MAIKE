#!/usr/bin/env node
/**
 * D-PROD-155 — PROVA DE USO REAL ponta a ponta da Central Única de Lançamentos.
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
 *  Rodada 4 (D-PROD-155, custo de aquisição líquido; esperados lidos dos
 *  vetores compartilhados `tests/smoke/fixtures/rateioCabecalhoVetores.json`):
 *  21. compra pela tela de 100 SACO × 80,00 com desconto de 500,00 no
 *      DEPÓSITO 03, a prazo, com a resposta da confirmação perdida e repetida
 *      (replay): título 7.500, lote 2,5000/kg, movimento 7.500, item com
 *      desconto rateado 500 e líquido 7.500 no banco; prévia e detalhe com o
 *      rateio (tela e API = vetor);
 *  22. venda FIFO de 300 kg consumindo o lote descontado a 2,5000/kg (desconto
 *      da venda só informativo) e cancelamento que devolve o lote;
 *  23. cancelamento da compra descontada: lote Estornado, estoque volta,
 *      estorno 7.500 / 2,5000;
 *  24. compra com 2 mercadorias + 1 serviço, desconto e acréscimo: Σ líquido =
 *      total, custo de cada lote e diferença de arredondamento na tela;
 *  25. custo_kg_nao_representavel: o formulário aponta a linha sem enviar; a
 *      API recusa o corpo do vetor (422, details do vetor); rascunho cujo peso
 *      do saco muda no cadastro: a prévia do servidor bloqueia e a confirmação
 *      recusa — nada gravado;
 *  26. empresa B e OUTRO tenant: nada vaza (tela e API); a mesma chave reenviada
 *      é replay sem segundo efeito; a mesma chave em outro tenant é outra
 *      operação;
 *  27. vínculo único no banco: cada título com um só documento, cada
 *      movimento/lote da P3 com um só item; o banco recusa ligar um movimento a
 *      dois itens.
 *  P3-02 (D-PROD-156, rateio gerencial POR ITEM):
 *  28. compra PARCELADA pela tela com 2 mercadorias + 1 serviço, desconto e
 *      acréscimo, rateio POR ITEM (troca de escopo com os diálogos nos dois
 *      sentidos, "usar a classificação geral", "começar em branco", "aplicar a
 *      todos", 1 item em 2 centros, diferença de 1 centavo bloqueando o
 *      Confirmar): prévia e detalhe com a classificação de cada item e o
 *      consolidado; no banco 1 título por parcela, 1 movimento e 1 lote por
 *      mercadoria com o custo líquido, linhas por item exatas e Σ = total;
 *  29. o modo GERAL não mudou (escopo explícito em todo documento, nenhuma
 *      linha por item, consolidado = rateio geral) e a API real recusa um corpo
 *      POR ITEM com soma errada apontando o item (422, nada gravado).
 *  Toda resposta ≥ 400 da API real observada pelas telas é divergência, salvo
 *  as recusas PROVOCADAS (7, 16, 17 e, se a tela deixar confirmar, 25), que
 *  também TÊM de acontecer.
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

// ─── Rodada 4: vetores compartilhados e aritmética exata ────────────────────
const VETORES = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tests/smoke/fixtures/rateioCabecalhoVetores.json'), 'utf8')).casos;
const vetor = (id) => {
  const c = VETORES.find((x) => x.id === id);
  if (!c) throw new Error(`vetor ${id} ausente em tests/smoke/fixtures/rateioCabecalhoVetores.json`);
  return c;
};
const CAMPOS_RATEIO = ['ordem', 'valor_total', 'valor_desconto_rateado', 'valor_acrescimo_rateado', 'valor_liquido', 'quantidade_estoque', 'custo_kg', 'residuo_custo'];
const linhaRateio = (i) => CAMPOS_RATEIO.map((k) => `${k}=${i?.[k] ?? null}`).join(',');
/** Decimal canônico → inteiro na escala (BigInt), sem float. */
const escalar = (v, casas) => {
  const t = String(v);
  const [i, f = ''] = t.replace('-', '').split('.');
  const n = BigInt(`${i}${f.padEnd(casas, '0').slice(0, casas)}`);
  return t.startsWith('-') ? -n : n;
};
const deEscala = (n, casas) => {
  const t = (n < 0n ? -n : n).toString().padStart(casas + 1, '0');
  return `${n < 0n ? '-' : ''}${t.slice(0, -casas)}.${t.slice(-casas)}`;
};
const dec4 = (v) => deEscala(escalar(v, 4), 4);
const somar4 = (a, b) => deEscala(escalar(a, 4) + escalar(b, 4), 4);
/** Como a tela pt-BR mostra um decimal canônico (sem "R$" nem espaços): mínimo 2 casas, até `max`. */
const br = (v, max = 2) => {
  const t = String(v);
  const [i, f0 = ''] = t.replace('-', '').split('.');
  let f = f0.slice(0, max).padEnd(2, '0');
  while (f.length > 2 && f.endsWith('0')) f = f.slice(0, -1);
  return `${t.startsWith('-') ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${f}`;
};
const limpo = (t) => String(t ?? '').replace(/R\$|\s/g, '');

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

    // ─── Rodada 4 (D-PROD-155): custo de aquisição líquido ─────────────────
    // Desconto e acréscimo do cabeçalho rateados por item (maiores restos); o
    // lote e o movimento de entrada da compra levam o LÍQUIDO. Os valores
    // esperados vêm dos MESMOS vetores do teste PG e do backend falso
    // (`tests/smoke/fixtures/rateioCabecalhoVetores.json`).
    const textoDe = async (testId) => {
      const loc = page.getByTestId(testId);
      return (await loc.count()) ? limpo(await loc.first().innerText()) : null;
    };
    const textoBruto = async (testId) => {
      const loc = page.getByTestId(testId);
      return (await loc.count()) ? loc.first().innerText() : '';
    };
    const mostrar = async (testId, etapa) => {
      const el = visivel(page.getByTestId(testId));
      const ok = await el.waitFor({ timeout: 10000 }).then(
        () => true,
        () => false,
      );
      conferir(ok, `[${rotulo}] ${etapa}: o bloco "${testId}" não apareceu na tela`);
      if (ok) await el.scrollIntoViewIfNeeded().catch(() => {});
      await shot(etapa);
    };
    /** Cada item na tela (prévia: `previa-rateio`; detalhe: `consulta`) igual ao esperado. */
    const conferirRateioNaTela = async (prefixo, itensEsperados, onde) => {
      for (const e of itensEsperados) {
        const p = `${prefixo}-item-${e.ordem}`;
        const visto = [
          await textoDe(`${p}-subtotal`),
          await textoDe(`${p}-desconto`),
          await textoDe(`${p}-acrescimo`),
          await textoDe(`${p}-liquido`),
          await textoDe(`${p}-custo-kg`),
          await textoDe(`${p}-residuo`),
        ];
        const esperado = [
          br(e.valor_total),
          br(e.valor_desconto_rateado),
          br(e.valor_acrescimo_rateado),
          br(e.valor_liquido),
          e.custo_kg == null ? null : `${br(e.custo_kg, 4)}/kg`,
          e.residuo_custo == null ? null : br(e.residuo_custo, 8),
        ];
        igual(visto.join(' | '), esperado.join(' | '), `[${rotulo}] ${onde}: item ${e.ordem} na tela (subtotal | desconto | acréscimo | líquido | custo/kg | diferença)`);
      }
    };
    const conferirTotaisNaTela = async (testId, caso, onde) => {
      const visto = [await textoDe(`${testId}-subtotal`), await textoDe(`${testId}-desconto`), await textoDe(`${testId}-acrescimo`), await textoDe(`${testId}-liquido`)];
      igual(visto.join(' | '), [br(caso.esperado.valor_bruto), br(caso.valor_desconto), br(caso.valor_acrescimo), br(caso.esperado.valor_total)].join(' | '), `[${rotulo}] ${onde}: totais do rateio na tela`);
      const t = await textoBruto(testId);
      conferir(/confere com o total do documento/.test(t) && !/NÃO confere/.test(t), `[${rotulo}] ${onde}: Σ líquido não confere com o total na tela: "${t.slice(0, 200)}"`);
    };
    /** Nenhum elemento do bloco sai da largura da tela nem rola sozinho (390 px). */
    const dentroDaTela = async (prefixoTestId, onde) => {
      const fora = await page.evaluate((pref) => {
        const w = document.documentElement.clientWidth;
        return [...document.querySelectorAll(`[data-testid^="${pref}"]`)]
          .filter((e) => e.getClientRects().length > 0)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { tid: e.getAttribute('data-testid'), l: Math.round(r.left), r: Math.round(r.right), sw: e.scrollWidth, cw: e.clientWidth };
          })
          .filter((x) => x.l < -1 || x.r > w + 1 || x.sw > x.cw + 1);
      }, prefixoTestId);
      conferir(!fora.length, `[${rotulo}] ${onde}: ${fora.length} elemento(s) "${prefixoTestId}*" fora da largura ou com rolagem própria: ${JSON.stringify(fora.slice(0, 3))}`);
    };
    const detalheApi = (tk, id, empresaId) => api(tk, 'GET', `/api/native/operacoes-financeiras/${id}?empresa_id=${empresaId}`);
    const previaApi = (tk, id, empresaId) => api(tk, 'POST', `/api/native/operacoes-financeiras/${id}/previa`, { empresa_id: empresaId });
    const listaApi = async (tk, empresaId) => {
      const r = await api(tk, 'GET', `/api/native/operacoes-financeiras?empresa_id=${empresaId}`);
      return { status: r.status, ids: (r.corpo?.items ?? []).map((o) => o.id) };
    };
    const produtoAgora = (id) => prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id } });
    const unidadeSaco = async (indice) => {
      await visivel(page.getByRole('combobox', { name: `Unidade do item ${indice + 1}` })).click();
      await page.getByRole('option', { name: 'SACO', exact: true }).first().click();
      await page.waitForTimeout(200);
    };
    const cancelarPelaTela = async (motivo) => {
      await clicar(page.getByTestId('botao-cancelar-lancamento'));
      await page.getByTestId('dialogo-cancelamento').waitFor({ state: 'visible' });
      await preencher('dialogo-cancelamento-motivo', motivo);
      await clicar(page.getByTestId('dialogo-cancelamento-enviar'));
    };

    // 21. (a) Compra pela TELA: 100 SACO × 80,00 com desconto de 500,00, a prazo,
    //     no DEPÓSITO 03; a confirmação perde a resposta e o "repetir" reusa a
    //     chave (replay). Título 7.500, lote 2,5000/kg e movimento 7.500 no banco.
    await passo('21 R4 compra pela tela 100 SACO x 80 desconto 500: titulo 7.500, lote 2,5000/kg, movimento 7.500', async () => {
      const caso = vetor('brl_compra_desconto_saco');
      const racaoAntes = await produtoAgora(s.produtos.racao.id);
      const vencimento = somarDias(hoje, 30);
      const criados = [];
      const confirmacoes = [];
      const ouvirCriacao = (req) => {
        if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/native/operacoes-financeiras') criados.push(JSON.parse(req.postData() || '{}'));
      };
      const rotaConfirmar = (u) => /\/operacoes-financeiras\/[^/]+\/confirmar$/.test(u.pathname);
      page.on('request', ouvirCriacao);
      let d;
      try {
        await novo();
        await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
        await radio('escolha-conteudo', 'Com produtos');
        await radio('escolha-condicao', 'A prazo');
        await preencher('prazo-vencimento', vencimento);
        await escolher('seletor-produto-0', /RAÇÃO/);
        await escolher('seletor-local-0', /DEPÓSITO 03/);
        await unidadeSaco(0);
        await preencher('item-0-quantidade', '100');
        await preencher('item-0-valor-unitario', '80,00');
        await preencher('valor-desconto', '500,00');
        await preencher('data-operacional', hoje);
        await clicar(page.getByTestId('declaracao-efeito-fisico'));
        await escolher('seletor-natureza-0', /INSUMOS/);
        const total = limpo(await visivel(page.getByTestId('total-lancamento')).innerText());
        conferir(total.includes(br(caso.esperado.valor_total)), `[${rotulo}] total do formulário com desconto: "${total}"`);
        await shot('r4-compra-desconto-form');
        await page.route(rotaConfirmar, async (route) => {
          const req = route.request();
          if (req.method() !== 'POST') return route.continue();
          confirmacoes.push(JSON.parse(req.postData() || '{}'));
          if (confirmacoes.length === 1) {
            await route.fetch(); // chega ao servidor e é processada…
            return route.abort('failed'); // …mas a resposta se perde no caminho
          }
          return route.continue();
        });
        const { resumo, bloqueios } = await confirmarPelaTela('r4-compra-desconto');
        conferir(limpo(resumo).includes(br(caso.esperado.valor_total)) && /1 parcela/i.test(resumo), `[${rotulo}] resumo da compra com desconto: ${resumo.slice(0, 200)}`);
        conferir(!bloqueios.trim(), `[${rotulo}] prévia da compra com desconto com bloqueio: ${bloqueios.slice(0, 200)}`);
        await mostrar('previa-rateio', 'r4-compra-desconto-previa-rateio');
        await conferirRateioNaTela('previa-rateio', caso.esperado.itens, 'prévia da compra com desconto');
        await conferirTotaisNaTela('previa-rateio-totais', caso, 'prévia da compra com desconto');
        const avisos = await textoBruto('previa-avisos');
        conferir(/o custo do lote é o valor líquido da mercadoria/.test(avisos), `[${rotulo}] prévia sem o aviso do rateio: "${avisos.slice(0, 300)}"`);
        conferir(!/Diferença de arredondamento/.test(avisos), `[${rotulo}] prévia com aviso de diferença sem diferença: "${avisos.slice(0, 300)}"`);
        if (movel) await dentroDaTela('previa-rateio', 'prévia da compra com desconto');
        const rasc = await ultimaOperacao(s);
        exigir(rasc?.status === 'RASCUNHO', `[${rotulo}] rascunho da compra com desconto não está no banco`);
        const pv = await previaApi(token, rasc.id, s.empresa.id);
        igual(`${pv.status}:${(pv.corpo?.bloqueios ?? []).length}`, '200:0', `[${rotulo}] prévia da API`);
        igual((pv.corpo?.plano?.itens ?? []).map(linhaRateio).join(' | '), caso.esperado.itens.map(linhaRateio).join(' | '), `[${rotulo}] prévia da API = vetor ${caso.id}`);
        igual((pv.corpo?.plano?.avisos ?? []).map((a) => a.codigo).join(','), caso.esperado.avisos.join(','), `[${rotulo}] avisos da prévia da API = vetor ${caso.id}`);
        const entrada = pv.corpo?.plano?.efeitos_estoque?.entradas?.[0];
        igual(`${entrada?.kg}:${entrada?.custo_kg}`, '3000.0000:2.5000', `[${rotulo}] prévia da entrada no estoque: custo líquido`);
        await clicar(page.getByTestId('botao-confirmar-definitivo'));
        await visivel(page.getByTestId('resultado-incerto')).waitFor();
        await shot('r4-compra-desconto-incerto');
        await clicar(page.getByTestId('botao-confirmar-definitivo'));
        await visivel(page.getByTestId('consulta-lancamento')).waitFor({ timeout: 30000 });
        const aviso = page.getByText(/nada foi duplicado/i).first();
        await aviso.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        conferir(await aviso.isVisible(), `[${rotulo}] replay da compra com desconto não foi comunicado ("nada foi duplicado")`);
        d = await operacaoCompleta(s, rasc.id);
      } finally {
        page.off('request', ouvirCriacao);
        await page.unroute(rotaConfirmar).catch(() => {});
      }
      igual(criados.length, 1, `[${rotulo}] POST de criação da compra com desconto`);
      igual(confirmacoes.length, 2, `[${rotulo}] envios de confirmação da compra com desconto`);
      conferir(confirmacoes[0]?.operation_id && confirmacoes[0].operation_id === confirmacoes[1]?.operation_id, `[${rotulo}] repetição não reusou o operation_id (${confirmacoes.map((c) => c.operation_id).join(' ≠ ')})`);
      igual(`${d.status}:${dec(d.valor_bruto)}:${dec(d.valor_desconto)}:${dec(d.valor_acrescimo)}:${dec(d.valor_total)}`, 'CONFIRMADO:8000.0000:500.0000:0.0000:7500.0000', `[${rotulo}] cabeçalho da compra com desconto`);
      igual(d.itens.length, 1, `[${rotulo}] itens da compra com desconto`);
      const it = d.itens[0];
      igual(
        `${it.unidade}:${dec(it.quantidade_estoque)}:${dec(it.valor_total)}:${dec(it.valor_desconto_rateado)}:${dec(it.valor_acrescimo_rateado)}:${dec(it.valor_liquido)}`,
        'SACO:3000.0000:8000.0000:500.0000:0.0000:7500.0000',
        `[${rotulo}] item gravado com o rateio (banco)`,
      );
      igual(d.titulos.map((t) => `${t.status}:${dec(t.valor)}:${dec(t.valor_liquidado)}:${diaDe(t.vencimento)}`).join('|'), `ABERTO:7500.0000:0.0000:${vencimento}`, `[${rotulo}] título da compra com desconto`);
      const lote = await prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s.cliente_id, id: it.estoque_lote_nota_id } });
      exigir(lote, `[${rotulo}] lote da compra com desconto não gravado`);
      igual(`${dec(lote.quantidade_entrada)}:${dec(lote.quantidade_disponivel)}:${dec(lote.custo_unitario)}:${lote.status}:${lote.local_estoque_id}`, `3000.0000:3000.0000:2.5000:Disponivel:${s.local3.id}`, `[${rotulo}] lote da compra com desconto (custo líquido)`);
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: it.movimentacao_estoque_id } });
      exigir(mov, `[${rotulo}] movimento da compra com desconto não gravado`);
      igual(
        `${mov.tipo_movimentacao}:${mov.tipo_detalhado}:${dec(mov.quantidade)}:${dec(mov.valor_total)}:${dec(mov.valor_unitario)}:${mov.lancamento_origem_id}:${mov.local_estoque_destino}`,
        `Entrada:compra_financeiro:3000.0000:7500.0000:2.5000:${d.id}:${s.local3.id}`,
        `[${rotulo}] movimento da compra com desconto (valor líquido)`,
      );
      igual(lote.movimentacao_entrada_id, mov.id, `[${rotulo}] lote ↔ movimento da compra com desconto`);
      igual(await prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, lancamento_origem_id: d.id } }), 1, `[${rotulo}] movimentos da compra com desconto (replay sem duplicar)`);
      igual(await prisma.estoqueLoteNota.count({ where: { cliente_id: s.cliente_id, movimentacao_entrada_id: mov.id } }), 1, `[${rotulo}] lotes da compra com desconto (replay sem duplicar)`);
      igual(dec((await produtoAgora(s.produtos.racao.id)).estoque_atual), somar4(dec(racaoAntes.estoque_atual), '3000.0000'), `[${rotulo}] estoque_atual da RAÇÃO após a compra com desconto`);
      await mostrar('consulta-item-1', 'r4-compra-desconto-detalhe');
      await conferirRateioNaTela('consulta', caso.esperado.itens, 'detalhe da compra com desconto');
      await conferirTotaisNaTela('consulta-rateio-totais', caso, 'detalhe da compra com desconto');
      if (movel) await dentroDaTela('consulta-item-', 'detalhe da compra com desconto');
      const det = await detalheApi(token, d.id, s.empresa.id);
      igual(det.status, 200, `[${rotulo}] detalhe da API da compra com desconto`);
      igual((det.corpo?.itens ?? []).map(linhaRateio).join(' | '), caso.esperado.itens.map(linhaRateio).join(' | '), `[${rotulo}] detalhe da API = vetor ${caso.id} (custo do lote gravado)`);
      docs.compraDesc = { ...d, racaoAntes: dec(racaoAntes.estoque_atual), corpoCriar: criados[0], corpoConfirmar: confirmacoes[0] };
    });

    // 22. (d) Venda FIFO de 300 kg da RAÇÃO no DEPÓSITO 03: consome o lote
    //     descontado a 2,5000/kg; o desconto da venda é só informativo (receita
    //     líquida). Cancelar a venda devolve o lote (pré-requisito do passo 23).
    await passo('22 R4 venda FIFO consome o lote descontado a 2,5000/kg; desconto da venda informativo; cancelar devolve', async () => {
      exigir(docs.compraDesc, `[${rotulo}] o passo 22 exige a compra com desconto do passo 21`);
      const loteId = docs.compraDesc.itens[0].estoque_lote_nota_id;
      const racaoAntes = await produtoAgora(s.produtos.racao.id);
      const esperadoItens = [
        { ordem: 1, valor_total: '1200.00', valor_desconto_rateado: '100.00', valor_acrescimo_rateado: '0.00', valor_liquido: '1100.00', quantidade_estoque: '300.0000', custo_kg: null, residuo_custo: null },
      ];
      await novo();
      await radio('escolha-direcao', 'A receber');
      await escolher('seletor-parceiro', /FRIGORÍFICO CENTRAL/);
      await radio('escolha-conteudo', 'Com produtos');
      await escolher('seletor-produto-0', /RAÇÃO/);
      const saldos = page.getByTestId('saldos-item-0');
      await visivel(saldos.getByRole('button', { name: /DEPÓSITO 03/ })).waitFor();
      const textoSaldo = await visivel(saldos).innerText();
      conferir(/DEPÓSITO 03: 3\.000 kg/i.test(textoSaldo), `[${rotulo}] saldo do DEPÓSITO 03 não mostra 3.000 kg: ${textoSaldo.slice(0, 200)}`);
      await clicar(saldos.getByRole('button', { name: /DEPÓSITO 03/ }));
      await preencher('item-0-quantidade', '300');
      await preencher('item-0-valor-unitario', '4,00');
      await preencher('valor-desconto', '100,00');
      await preencher('data-operacional', hoje);
      await clicar(page.getByTestId('declaracao-efeito-fisico'));
      await escolher('seletor-natureza-0', /VENDA DE INSUMOS/);
      const { resumo, bloqueios } = await confirmarPelaTela('r4-venda-lote-descontado');
      conferir(limpo(resumo).includes('1.100,00'), `[${rotulo}] resumo da venda sem 1.100,00: ${resumo.slice(0, 200)}`);
      conferir(!bloqueios.trim(), `[${rotulo}] prévia da venda com bloqueio: ${bloqueios.slice(0, 200)}`);
      await mostrar('previa-rateio', 'r4-venda-previa-rateio');
      await conferirRateioNaTela('previa-rateio', esperadoItens, 'prévia da venda');
      const avisos = await textoBruto('previa-avisos');
      conferir(/custo FIFO dos lotes/.test(avisos), `[${rotulo}] prévia da venda sem o aviso de receita líquida/custo FIFO: "${avisos.slice(0, 300)}"`);
      const rasc = await ultimaOperacao(s);
      const pv = await previaApi(token, rasc.id, s.empresa.id);
      igual((pv.corpo?.plano?.itens ?? []).map(linhaRateio).join(' | '), esperadoItens.map(linhaRateio).join(' | '), `[${rotulo}] prévia da API da venda`);
      igual((pv.corpo?.plano?.avisos ?? []).map((a) => a.codigo).join(','), 'desconto_acrescimo_rateados', `[${rotulo}] avisos da prévia da API da venda`);
      const saida = pv.corpo?.plano?.efeitos_estoque?.saidas?.[0];
      igual(
        `${saida?.kg}:${saida?.custo_total}:${(saida?.fatias ?? []).map((f) => `${f.lote_id === loteId ? 'LOTE-DESCONTADO' : f.lote_id}/${f.quantidade}/${f.custo_unitario}`).join(',')}`,
        '300.0000:750.0000:LOTE-DESCONTADO/300.0000/2.5000',
        `[${rotulo}] prévia da saída: custo FIFO do lote descontado`,
      );
      await confirmarDefinitivo('r4-venda-lote-descontado');
      const op = await esperarBanco(async () => {
        const o = await operacaoCompleta(s, rasc.id);
        return o && o.status === 'CONFIRMADO' ? o : null;
      }, 'venda do lote descontado confirmada');
      const it = op.itens[0];
      igual(`${dec(it.quantidade_estoque)}:${dec(it.valor_total)}:${dec(it.valor_desconto_rateado)}:${dec(it.valor_acrescimo_rateado)}:${dec(it.valor_liquido)}`, '300.0000:1200.0000:100.0000:0.0000:1100.0000', `[${rotulo}] item da venda (receita líquida)`);
      const consumos = await prisma.operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: s.cliente_id, item_id: it.id } });
      igual(consumos.map((c) => `${c.estoque_lote_nota_id === loteId ? 'LOTE-DESCONTADO' : c.estoque_lote_nota_id}:${dec(c.quantidade)}:${dec(c.custo_unitario)}`).join('|'), 'LOTE-DESCONTADO:300.0000:2.5000', `[${rotulo}] fatia FIFO da venda`);
      const lote = await prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s.cliente_id, id: loteId } });
      igual(`${dec(lote.quantidade_disponivel)}:${lote.status}`, '2700.0000:Disponivel', `[${rotulo}] lote descontado após a venda`);
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: it.movimentacao_estoque_id } });
      igual(`${mov.tipo_movimentacao}:${mov.tipo_detalhado}:${dec(mov.quantidade)}:${dec(mov.valor_total)}:${dec(mov.valor_unitario)}:${mov.local_estoque_origem}`, `Saída:venda_financeiro:300.0000:750.0000:2.5000:${s.local3.id}`, `[${rotulo}] movimento da venda (custo FIFO líquido, nunca o preço)`);
      igual(dec((await produtoAgora(s.produtos.racao.id)).estoque_atual), somar4(dec(racaoAntes.estoque_atual), '-300.0000'), `[${rotulo}] estoque_atual da RAÇÃO após a venda`);
      igual(op.titulos.map((t) => `${t.status}:${dec(t.valor)}`).join('|'), 'ABERTO:1100.0000', `[${rotulo}] título da venda com desconto`);
      await conferirRateioNaTela('consulta', esperadoItens, 'detalhe da venda');
      await cancelarPelaTela('Venda desfeita: lote descontado devolvido');
      const canc = await esperarBanco(async () => {
        const o = await operacaoCompleta(s, op.id);
        return o && o.status === 'CANCELADO' ? o : null;
      }, 'venda do lote descontado CANCELADA');
      const lote2 = await prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s.cliente_id, id: loteId } });
      igual(`${dec(lote2.quantidade_disponivel)}:${lote2.status}`, '3000.0000:Disponivel', `[${rotulo}] lote descontado devolvido ao cancelar a venda`);
      const est = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: canc.itens[0].movimentacao_estorno_id } });
      exigir(est, `[${rotulo}] estorno da venda não gravado`);
      igual(`${est.tipo_movimentacao}:${est.tipo_detalhado}:${dec(est.quantidade)}:${dec(est.valor_total)}:${dec(est.valor_unitario)}:${est.movimento_pai_id === mov.id}`, 'Entrada:estorno_venda:300.0000:750.0000:2.5000:true', `[${rotulo}] estorno da venda pelo custo FIFO líquido`);
      igual(dec((await produtoAgora(s.produtos.racao.id)).estoque_atual), dec(racaoAntes.estoque_atual), `[${rotulo}] estoque_atual da RAÇÃO após cancelar a venda`);
      await shot('r4-venda-cancelada');
      docs.vendaDesc = canc;
    });

    // 23. (e) Cancelar a compra com desconto: lote Estornado, estoque volta e o
    //     estorno sai pelo MESMO valor líquido (7.500 / 2,5000).
    await passo('23 R4 cancelar a compra descontada: lote Estornado, estoque volta, estorno pelo liquido', async () => {
      exigir(docs.compraDesc, `[${rotulo}] o passo 23 exige a compra com desconto do passo 21`);
      const caso = vetor('brl_compra_desconto_saco');
      const it0 = docs.compraDesc.itens[0];
      await abrirDocumento(docs.compraDesc);
      await cancelarPelaTela('Compra devolvida ao fornecedor');
      const op = await esperarBanco(async () => {
        const o = await operacaoCompleta(s, docs.compraDesc.id);
        return o && o.status === 'CANCELADO' ? o : null;
      }, 'compra com desconto CANCELADA');
      igual(op.titulos.map((t) => `${t.status}:${dec(t.valor)}`).join('|'), 'CANCELADO:7500.0000', `[${rotulo}] título da compra com desconto cancelada`);
      const it = op.itens[0];
      igual(`${dec(it.valor_desconto_rateado)}:${dec(it.valor_liquido)}`, '500.0000:7500.0000', `[${rotulo}] rateio gravado continua no item cancelado`);
      const lote = await prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s.cliente_id, id: it0.estoque_lote_nota_id } });
      igual(`${dec(lote.quantidade_entrada)}:${dec(lote.quantidade_disponivel)}:${dec(lote.custo_unitario)}:${lote.status}`, '3000.0000:0.0000:2.5000:Estornado', `[${rotulo}] lote da compra cancelada`);
      exigir(it.movimentacao_estorno_id, `[${rotulo}] item da compra cancelada sem movimentacao_estorno_id`);
      const original = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: it.movimentacao_estoque_id } });
      const estorno = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: it.movimentacao_estorno_id } });
      igual(`${original.status}:${original.movimento_filho_id === estorno.id}`, 'Estornada:true', `[${rotulo}] movimento da compra estornado e ligado`);
      igual(
        `${estorno.tipo_movimentacao}:${estorno.tipo_detalhado}:${dec(estorno.quantidade)}:${dec(estorno.valor_total)}:${dec(estorno.valor_unitario)}:${estorno.movimento_pai_id === original.id}:${estorno.local_estoque_origem}`,
        `Saída:estorno_compra:3000.0000:7500.0000:2.5000:true:${s.local3.id}`,
        `[${rotulo}] estorno da compra pelo valor líquido`,
      );
      igual(dec((await produtoAgora(s.produtos.racao.id)).estoque_atual), docs.compraDesc.racaoAntes, `[${rotulo}] estoque_atual da RAÇÃO volta ao de antes da compra com desconto`);
      await page.waitForTimeout(600);
      await visivel(page.getByTestId('aviso-cancelado')).waitFor().catch(() => conferir(false, `[${rotulo}] aviso de cancelado não apareceu na compra com desconto`));
      await mostrar('consulta-item-1', 'r4-compra-desconto-cancelada');
      await conferirRateioNaTela('consulta', caso.esperado.itens, 'detalhe da compra cancelada');
      const det = await detalheApi(token, op.id, s.empresa.id);
      igual((det.corpo?.itens ?? []).map(linhaRateio).join(' | '), caso.esperado.itens.map(linhaRateio).join(' | '), `[${rotulo}] detalhe da API da compra cancelada = vetor ${caso.id}`);
      docs.compraDesc.status = 'CANCELADO';
    });

    // 24. (b) Compra com 2 mercadorias + 1 serviço, desconto e acréscimo juntos
    //     (vetor brl_mercadoria_servico_desconto_acrescimo): Σ líquido = total,
    //     custo de cada lote e diferença de arredondamento mostrada.
    await passo('24 R4 compra 2 mercadorias + 1 servico com desconto e acrescimo: soma do liquido = total, custo de cada lote, diferenca na tela', async () => {
      const caso = vetor('brl_mercadoria_servico_desconto_acrescimo');
      const [e1, , e3] = caso.esperado.itens;
      const [v1, v2, v3] = caso.itens;
      const salAntes = await produtoAgora(s.produtos.sal.id);
      const racaoAntes = await produtoAgora(s.produtos.racao.id);
      const vencimento = somarDias(hoje, 30);
      await novo();
      await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
      await radio('escolha-conteudo', 'Com produtos');
      await radio('escolha-condicao', 'A prazo');
      await preencher('prazo-vencimento', vencimento);
      await escolher('seletor-produto-0', /SAL MINERAL/);
      await escolher('seletor-local-0', /DEPÓSITO 03/);
      await preencher('item-0-quantidade', v1.quantidade);
      await preencher('item-0-valor-unitario', v1.valor_unitario.replace('.', ','));
      await clicar(page.getByRole('button', { name: 'Serviço', exact: true }));
      await visivel(page.getByTestId('item-1').getByLabel('Descrição do serviço')).fill(v2.descricao);
      await preencher('item-1-quantidade', v2.quantidade);
      await preencher('item-1-valor-unitario', v2.valor_unitario.replace('.', ','));
      await clicar(page.getByRole('button', { name: 'Mercadoria', exact: true }));
      await escolher('seletor-produto-2', /RAÇÃO/);
      await escolher('seletor-local-2', /DEPÓSITO 03/);
      await unidadeSaco(2);
      await preencher('item-2-quantidade', v3.quantidade);
      await preencher('item-2-valor-unitario', `${v3.valor_unitario},00`);
      await preencher('valor-desconto', caso.valor_desconto.replace('.', ','));
      await preencher('valor-acrescimo', caso.valor_acrescimo.replace('.', ','));
      await preencher('data-operacional', hoje);
      await clicar(page.getByTestId('declaracao-efeito-fisico'));
      await escolher('seletor-natureza-0', /INSUMOS/);
      const total = limpo(await visivel(page.getByTestId('total-lancamento')).innerText());
      conferir(total.includes(br(caso.esperado.valor_total)), `[${rotulo}] total do formulário (2 mercadorias + serviço): "${total}"`);
      await shot('r4-mercadorias-servico-form');
      const { resumo, bloqueios } = await confirmarPelaTela('r4-mercadorias-servico');
      conferir(limpo(resumo).includes(br(caso.esperado.valor_total)), `[${rotulo}] resumo sem ${caso.esperado.valor_total}: ${resumo.slice(0, 200)}`);
      conferir(!bloqueios.trim(), `[${rotulo}] prévia (2 mercadorias + serviço) com bloqueio: ${bloqueios.slice(0, 200)}`);
      await mostrar('previa-rateio', 'r4-mercadorias-servico-previa-rateio');
      await conferirRateioNaTela('previa-rateio', caso.esperado.itens, 'prévia (2 mercadorias + serviço)');
      await mostrar('previa-rateio-totais', 'r4-mercadorias-servico-previa-totais');
      await conferirTotaisNaTela('previa-rateio-totais', caso, 'prévia (2 mercadorias + serviço)');
      conferir(await page.getByTestId('previa-rateio-nota-residuo').count(), `[${rotulo}] prévia sem a nota da diferença de arredondamento`);
      const avisos = await textoBruto('previa-avisos');
      conferir(
        /o custo do lote é o valor líquido da mercadoria/.test(avisos) && limpo(avisos).includes(`${br(caso.esperado.residuo_total, 8)}nototal`),
        `[${rotulo}] avisos da prévia sem o rateio ou sem a diferença total ${caso.esperado.residuo_total}: "${avisos.slice(0, 400)}"`,
      );
      if (movel) await dentroDaTela('previa-rateio', 'prévia (2 mercadorias + serviço)');
      const rasc = await ultimaOperacao(s);
      const pv = await previaApi(token, rasc.id, s.empresa.id);
      igual((pv.corpo?.plano?.itens ?? []).map(linhaRateio).join(' | '), caso.esperado.itens.map(linhaRateio).join(' | '), `[${rotulo}] prévia da API = vetor ${caso.id}`);
      igual((pv.corpo?.plano?.avisos ?? []).map((a) => a.codigo).join(','), caso.esperado.avisos.join(','), `[${rotulo}] avisos da prévia da API = vetor ${caso.id}`);
      igual((pv.corpo?.plano?.avisos ?? []).find((a) => a.codigo === 'residuo_custo_estoque')?.residuo_total, caso.esperado.residuo_total, `[${rotulo}] resíduo total da prévia da API`);
      await confirmarDefinitivo('r4-mercadorias-servico');
      const d = await esperarBanco(async () => {
        const o = await operacaoCompleta(s, rasc.id);
        return o && o.status === 'CONFIRMADO' ? o : null;
      }, 'compra 2 mercadorias + serviço confirmada');
      igual(`${dec(d.valor_bruto)}:${dec(d.valor_desconto)}:${dec(d.valor_acrescimo)}:${dec(d.valor_total)}`, '105.0000:1.0000:0.5000:104.5000', `[${rotulo}] cabeçalho (2 mercadorias + serviço)`);
      igual(
        d.itens.map((i) => `${i.ordem}:${i.tipo_item}:${dec(i.valor_total)}:${dec(i.valor_desconto_rateado)}:${dec(i.valor_acrescimo_rateado)}:${dec(i.valor_liquido)}`).join('|'),
        caso.esperado.itens.map((e, k) => `${e.ordem}:${caso.itens[k].tipo_item}:${dec4(e.valor_total)}:${dec4(e.valor_desconto_rateado)}:${dec4(e.valor_acrescimo_rateado)}:${dec4(e.valor_liquido)}`).join('|'),
        `[${rotulo}] itens gravados (banco) = vetor ${caso.id}`,
      );
      const somaLiquido = deEscala(d.itens.reduce((acc, i) => acc + escalar(dec(i.valor_liquido), 4), 0n), 4);
      igual(somaLiquido, dec(d.valor_total), `[${rotulo}] Σ valor_liquido dos itens = valor_total do documento (banco, exato)`);
      igual(d.titulos.map((t) => `${t.status}:${dec(t.valor)}:${diaDe(t.vencimento)}`).join('|'), `ABERTO:104.5000:${vencimento}`, `[${rotulo}] título (2 mercadorias + serviço)`);
      const servico = d.itens[1];
      igual(`${servico.estoque_lote_nota_id}:${servico.movimentacao_estoque_id}:${servico.quantidade_estoque}`, 'null:null:null', `[${rotulo}] serviço sem lote, movimento nem kg`);
      for (const [k, e] of [[0, e1], [2, e3]]) {
        const i = d.itens[k];
        const lote = await prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s.cliente_id, id: i.estoque_lote_nota_id } });
        const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: i.movimentacao_estoque_id } });
        exigir(lote && mov, `[${rotulo}] item ${e.ordem} sem lote ou movimento`);
        igual(`${dec(lote.quantidade_entrada)}:${dec(lote.custo_unitario)}:${lote.status}:${lote.local_estoque_id}`, `${e.quantidade_estoque}:${e.custo_kg}:Disponivel:${s.local3.id}`, `[${rotulo}] lote do item ${e.ordem} (custo líquido)`);
        igual(`${mov.tipo_detalhado}:${dec(mov.quantidade)}:${dec(mov.valor_total)}:${dec(mov.valor_unitario)}:${lote.movimentacao_entrada_id === mov.id}`, `compra_financeiro:${e.quantidade_estoque}:${dec4(e.valor_liquido)}:${e.custo_kg}:true`, `[${rotulo}] movimento do item ${e.ordem} (valor líquido exato)`);
        const residuo = deEscala(escalar(dec(i.valor_liquido), 8) - escalar(dec(i.quantidade_estoque), 4) * escalar(dec(lote.custo_unitario), 4), 8);
        igual(residuo, e.residuo_custo, `[${rotulo}] resíduo do item ${e.ordem} = líquido − kg × custo do lote (banco)`);
      }
      igual(dec((await produtoAgora(s.produtos.sal.id)).estoque_atual), somar4(dec(salAntes.estoque_atual), e1.quantidade_estoque), `[${rotulo}] estoque_atual do SAL`);
      igual(dec((await produtoAgora(s.produtos.racao.id)).estoque_atual), somar4(dec(racaoAntes.estoque_atual), e3.quantidade_estoque), `[${rotulo}] estoque_atual da RAÇÃO`);
      await mostrar('consulta-item-1', 'r4-mercadorias-servico-detalhe');
      await conferirRateioNaTela('consulta', caso.esperado.itens, 'detalhe (2 mercadorias + serviço)');
      await mostrar('consulta-rateio-totais', 'r4-mercadorias-servico-detalhe-totais');
      await conferirTotaisNaTela('consulta-rateio-totais', caso, 'detalhe (2 mercadorias + serviço)');
      if (movel) await dentroDaTela('consulta-item-', 'detalhe (2 mercadorias + serviço)');
      const det = await detalheApi(token, d.id, s.empresa.id);
      igual((det.corpo?.itens ?? []).map(linhaRateio).join(' | '), caso.esperado.itens.map(linhaRateio).join(' | '), `[${rotulo}] detalhe da API = vetor ${caso.id}`);
      docs.compraMista = d;
    });

    // 25. (c) custo_kg_nao_representavel: (a) o formulário aponta a linha e não
    //     envia nada; (b) a API real recusa o MESMO corpo do vetor com 422 e os
    //     details do vetor; (c) rascunho válido cujo peso do saco muda no
    //     cadastro: a prévia DO SERVIDOR bloqueia e a confirmação recusa. Nada gravado.
    await passo('25 R4 custo_kg_nao_representavel: formulario aponta a linha, API recusa 422, previa do servidor bloqueia; nada gravado', async () => {
      const caso = vetor('brl_residuo_fora_do_limite');
      const e = caso.esperado.erro;
      const v = caso.itens[0];
      const detalhesComo = (det) => JSON.stringify(Object.fromEntries(Object.keys(e.details).map((k) => [k, det?.[k] ?? null])));
      const estoqueInicio = await fotoEstoque(s);
      const financeiroInicio = await fotoFinanceiro(s);
      // 25a. formulário
      const escritas = () => dono.requisicoes.filter((r) => r.metodo !== 'GET' && /\/operacoes-financeiras/.test(r.url)).length;
      await novo();
      await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
      await radio('escolha-conteudo', 'Com produtos');
      await escolher('seletor-produto-0', /SAL MINERAL/);
      await escolher('seletor-local-0', /DEPÓSITO 03/);
      await preencher('item-0-quantidade', v.quantidade);
      await preencher('item-0-valor-unitario', v.valor_unitario.replace('.', ','));
      await preencher('data-operacional', hoje);
      await clicar(page.getByTestId('declaracao-efeito-fisico'));
      await escolher('seletor-natureza-0', /INSUMOS/);
      const antes = escritas();
      await clicar(page.getByRole('button', { name: 'Salvar', exact: true }));
      const erroLinha = visivel(page.getByTestId('item-0-liquido-erro'));
      await erroLinha.waitFor({ timeout: 10000 }).catch(() => {});
      const txt = (await erroLinha.isVisible()) ? await erroLinha.innerText() : '';
      conferir(
        /não cabe nas 4 casas/.test(txt) && /3\.000 kg/.test(txt) && limpo(txt).includes(br(e.details.custo_kg, 4)) && limpo(txt).includes(br(e.details.residuo_custo, 8)),
        `[${rotulo}] formulário não apontou o custo não representável na linha 1: "${txt.slice(0, 300)}"`,
      );
      await erroLinha.scrollIntoViewIfNeeded().catch(() => {});
      await shot('r4-custo-nao-representavel-form');
      await clicar(page.getByTestId('botao-confirmar-lancamento'));
      await page.waitForTimeout(800);
      igual(await page.getByTestId('dialogo-confirmacao').filter({ visible: true }).count(), 0, `[${rotulo}] diálogo de confirmação abriu com a linha recusada`);
      igual(escritas() - antes, 0, `[${rotulo}] escritas enviadas com a linha recusada`);
      igual(await fotoFinanceiro(s), financeiroInicio, `[${rotulo}] formulário recusado alterou o financeiro`);
      // 25b. API real, mesmo corpo do vetor
      const corpo = {
        empresa_id: s.empresa.id,
        operation_id: randomUUID(),
        direcao: 'PAGAR',
        conteudo: 'COM_PRODUTOS',
        condicao: 'PRAZO',
        parceiro_id: s.parceiros.fornecedor.id,
        data_emissao: hoje,
        data_operacional: hoje,
        efeito_fisico_confirmado: true,
        valor_desconto: caso.valor_desconto,
        valor_acrescimo: caso.valor_acrescimo,
        itens: [{ tipo_item: 'MERCADORIA', produto_id: s.produtos.sal.id, local_estoque_id: s.local3.id, unidade: v.unidade, quantidade: v.quantidade, valor_unitario: v.valor_unitario }],
        rateio_modo: 'PERCENTUAL',
        rateios: [{ natureza_id: s.naturezas.insumos, percentual: '100' }],
        parcelas: [{ vencimento: somarDias(hoje, 30), valor: caso.esperado.valor_total }],
      };
      const r = await api(token, 'POST', '/api/native/operacoes-financeiras', corpo);
      igual(`${r.status}:${r.corpo?.code}:${r.corpo?.field}:${r.corpo?.reason}`, `${e.status}:${e.code}:${e.field}:${e.reason}`, `[${rotulo}] API real recusa o corpo do vetor ${caso.id}`);
      igual(detalhesComo(r.corpo?.details), JSON.stringify(e.details), `[${rotulo}] details do 422 = vetor ${caso.id}`);
      igual(await fotoFinanceiro(s), financeiroInicio, `[${rotulo}] 422 da API alterou o financeiro`);
      igual(await fotoEstoque(s), estoqueInicio, `[${rotulo}] 422 da API alterou o estoque`);
      // 25c. rascunho válido (1 SACO de 30 kg × 1,00: custo 0,0333, diferença 0,001)
      await novo();
      await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
      await radio('escolha-conteudo', 'Com produtos');
      await escolher('seletor-produto-0', /NÚCLEO PROTEICO/);
      await escolher('seletor-local-0', /DEPÓSITO 03/);
      await unidadeSaco(0);
      await preencher('item-0-quantidade', '1');
      await preencher('item-0-valor-unitario', '1,00');
      await preencher('data-operacional', hoje);
      await clicar(page.getByTestId('declaracao-efeito-fisico'));
      await escolher('seletor-natureza-0', /INSUMOS/);
      await clicar(page.getByRole('button', { name: 'Salvar', exact: true }));
      const rasc = await esperarBanco(async () => {
        const u = await ultimaOperacao(s);
        return u && u.status === 'RASCUNHO' && dec(u.valor_total) === '1.0000' ? u : null;
      }, 'rascunho do NÚCLEO PROTEICO');
      const itRasc = (await operacaoCompleta(s, rasc.id)).itens[0];
      igual(`${dec(itRasc.fator_kg)}:${dec(itRasc.quantidade_estoque)}:${dec(itRasc.valor_liquido)}`, '30.0000:30.0000:1.0000', `[${rotulo}] rascunho do NÚCLEO PROTEICO`);
      const nucleo = await produtoAgora(s.produtos.nucleo.id);
      // Outra pessoa muda o peso do saco no cadastro do produto (fora desta tela):
      // 1 SACO passa a 3.000 kg e o MESMO 1,00 dá 0,0003/kg com 0,10 de diferença.
      await prisma.produto.updateMany({ where: { cliente_id: s.cliente_id, id: s.produtos.nucleo.id }, data: { peso_por_saco_kg: '3000' } });
      try {
        const estoqueRasc = await fotoEstoque(s);
        const financeiroRasc = await fotoFinanceiro(s);
        await abrirDocumento(rasc);
        const { bloqueios } = await confirmarPelaTela('r4-custo-nao-representavel-servidor');
        conferir(
          /não cabe nas 4 casas/.test(bloqueios) && /3\.000 kg/.test(bloqueios) && limpo(bloqueios).includes(br(e.details.custo_kg, 4)) && limpo(bloqueios).includes(br(e.details.residuo_custo, 8)),
          `[${rotulo}] prévia do servidor não mostrou o custo não representável: "${bloqueios.slice(0, 300)}"`,
        );
        const pv = await previaApi(token, rasc.id, s.empresa.id);
        const bl = (pv.corpo?.bloqueios ?? []).find((b) => b.reason === 'custo_kg_nao_representavel');
        exigir(bl, `[${rotulo}] prévia da API sem o bloqueio custo_kg_nao_representavel: ${JSON.stringify(pv.corpo?.bloqueios ?? []).slice(0, 300)}`);
        igual(`${bl.code}:${bl.field}`, `${e.code}:${e.field}`, `[${rotulo}] bloqueio da prévia da API`);
        igual(detalhesComo(bl.details), JSON.stringify(e.details), `[${rotulo}] details do bloqueio da prévia = vetor ${caso.id} (mesmos números do 25b)`);
        const botao = page.getByTestId('botao-confirmar-definitivo');
        if ((await botao.count()) && (await botao.first().isEnabled())) {
          esperarRecusa(/^POST \/api\/native\/operacoes-financeiras\/[^/]+\/confirmar → 422 .*custo_kg_nao_representavel/, 'passo 25: confirmar com custo não representável → 422');
          await botao.first().click();
          await page.waitForTimeout(1500);
          const msg = page.getByRole('dialog').getByText(/não cabe nas 4 casas/).first();
          conferir(await msg.isVisible().catch(() => false), `[${rotulo}] 422 da confirmação sem a mensagem do custo não representável`);
        }
        await shot('r4-custo-nao-representavel-servidor-recusa');
        const rc = await api(token, 'POST', `/api/native/operacoes-financeiras/${rasc.id}/confirmar`, { empresa_id: s.empresa.id, operation_id: randomUUID(), versao: rasc.versao });
        igual(`${rc.status}:${rc.corpo?.code}:${rc.corpo?.reason}`, `422:${e.code}:${e.reason}`, `[${rotulo}] confirmação pela API com custo não representável`);
        igual(await fotoEstoque(s), estoqueRasc, `[${rotulo}] recusa do servidor alterou o estoque`);
        igual(await fotoFinanceiro(s), financeiroRasc, `[${rotulo}] recusa do servidor alterou o financeiro`);
        const depois = await operacaoCompleta(s, rasc.id);
        igual(`${depois.status}:${depois.itens[0].estoque_lote_nota_id}:${depois.itens[0].movimentacao_estoque_id}:${depois.titulos.map((t) => t.status).join('|')}`, 'RASCUNHO:null:null:PREVISTO', `[${rotulo}] rascunho recusado continua rascunho, sem lote nem movimento`);
        await page.keyboard.press('Escape').catch(() => {});
      } finally {
        await prisma.produto.updateMany({ where: { cliente_id: s.cliente_id, id: s.produtos.nucleo.id }, data: { peso_por_saco_kg: nucleo.peso_por_saco_kg } });
      }
      igual(await fotoEstoque(s), estoqueInicio, `[${rotulo}] passo 25 alterou o estoque`);
    });

    // 26. (f) Duas empresas do mesmo tenant e OUTRO tenant: o lançamento de um
    //     não aparece no outro (tela e API real); reenvio com a mesma chave =
    //     replay, sem segundo efeito (banco). A mesma chave em outro tenant é
    //     outra operação (a chave é do tenant), não replay da primeira.
    await passo('26 R4 duas empresas e outro tenant: nada vaza; mesma chave = replay sem segundo efeito', async () => {
      exigir(docs.compraDesc?.corpoCriar?.operation_id && docs.compraDesc?.corpoConfirmar?.operation_id, `[${rotulo}] o passo 26 exige as chaves da compra com desconto do passo 21`);
      const caso = vetor('brl_compra_desconto_saco');
      const idA = docs.compraDesc.id;
      const fotoA = async () => `${await fotoFinanceiro(s)}|${await fotoEstoque(s)}`;
      // 26a. reenvio no MESMO tenant (a compra já foi confirmada e cancelada)
      const antes = await fotoA();
      const rc1 = await api(token, 'POST', '/api/native/operacoes-financeiras', docs.compraDesc.corpoCriar);
      igual(`${rc1.status}:${rc1.corpo?.replay}:${rc1.corpo?.id}`, `200:true:${idA}`, `[${rotulo}] reenvio da criação com a mesma chave`);
      const rc2 = await api(token, 'POST', `/api/native/operacoes-financeiras/${idA}/confirmar`, docs.compraDesc.corpoConfirmar);
      igual(`${rc2.status}:${rc2.corpo?.replay}:${rc2.corpo?.id}`, `200:true:${idA}`, `[${rotulo}] reenvio da confirmação com a mesma chave`);
      igual(await fotoA(), antes, `[${rotulo}] reenvio com a mesma chave teve efeito no banco`);
      igual((await prisma.operacaoFinanceira.findFirst({ where: { cliente_id: s.cliente_id, id: idA } })).status, 'CANCELADO', `[${rotulo}] replay da confirmação reconfirmou a compra cancelada`);
      // 26b. empresa B do mesmo tenant
      const rB = await detalheApi(token, idA, s.empresa2.id);
      conferir([403, 404].includes(rB.status) && !JSON.stringify(rB.corpo ?? {}).includes('7500'), `[${rotulo}] detalhe da compra de A pedido com a empresa B: ${rB.status} ${JSON.stringify(rB.corpo ?? {}).slice(0, 160)}`);
      const listaB = await listaApi(token, s.empresa2.id);
      conferir(listaB.status === 200 && !listaB.ids.includes(idA), `[${rotulo}] lista da API da empresa B (${listaB.status}) contém a compra de A`);
      // 26c. OUTRO tenant, com a MESMA chave de criação e de confirmação de A
      const s2 = await semearTenantE2E({ rotulo: `w${rotulo}x` });
      docs.outroTenant = s2;
      const token2 = await login(s2.credenciais);
      const perfil2 = await api(token2, 'PUT', '/api/native/perfis-financeiros-empresa', { empresa_id: s2.empresa.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' });
      exigir(perfil2.status < 300, `[${rotulo}] perfil do outro tenant: ${perfil2.status} ${JSON.stringify(perfil2.corpo ?? {}).slice(0, 200)}`);
      const corpo2 = {
        empresa_id: s2.empresa.id,
        operation_id: docs.compraDesc.corpoCriar.operation_id,
        direcao: 'PAGAR',
        conteudo: 'COM_PRODUTOS',
        condicao: 'PRAZO',
        parceiro_id: s2.parceiros.fornecedor.id,
        data_emissao: hoje,
        data_operacional: hoje,
        efeito_fisico_confirmado: true,
        valor_desconto: caso.valor_desconto,
        valor_acrescimo: caso.valor_acrescimo,
        itens: [{ tipo_item: 'MERCADORIA', produto_id: s2.produtos.racao.id, local_estoque_id: s2.local3.id, unidade: 'SACO', quantidade: '100', valor_unitario: '80' }],
        rateio_modo: 'PERCENTUAL',
        rateios: [{ natureza_id: s2.naturezas.insumos, percentual: '100' }],
        parcelas: [{ vencimento: somarDias(hoje, 30), valor: caso.esperado.valor_total }],
      };
      const c1 = await api(token2, 'POST', '/api/native/operacoes-financeiras', corpo2);
      exigir(c1.status === 201 && c1.corpo?.replay === false && c1.corpo?.id && c1.corpo.id !== idA, `[${rotulo}] mesma chave em outro tenant não criou outro documento: ${c1.status} replay=${c1.corpo?.replay} id=${c1.corpo?.id}`);
      const id2 = c1.corpo.id;
      const c2 = await api(token2, 'POST', '/api/native/operacoes-financeiras', corpo2);
      igual(`${c2.status}:${c2.corpo?.replay}:${c2.corpo?.id}`, `200:true:${id2}`, `[${rotulo}] reenvio da criação no outro tenant`);
      igual(await prisma.operacaoFinanceira.count({ where: { cliente_id: s2.cliente_id } }), 1, `[${rotulo}] documentos do outro tenant depois do reenvio`);
      const conf2 = { empresa_id: s2.empresa.id, operation_id: docs.compraDesc.corpoConfirmar.operation_id, versao: c1.corpo.versao };
      const k1 = await api(token2, 'POST', `/api/native/operacoes-financeiras/${id2}/confirmar`, conf2);
      igual(`${k1.status}:${k1.corpo?.replay}:${k1.corpo?.status}`, '200:false:CONFIRMADO', `[${rotulo}] confirmação no outro tenant (mesma chave de A)`);
      const foto2 = async () => `${await fotoFinanceiro(s2)}|${await fotoEstoque(s2)}`;
      const antes2 = await foto2();
      const k2 = await api(token2, 'POST', `/api/native/operacoes-financeiras/${id2}/confirmar`, conf2);
      igual(`${k2.status}:${k2.corpo?.replay}`, '200:true', `[${rotulo}] reenvio da confirmação no outro tenant`);
      igual(await foto2(), antes2, `[${rotulo}] reenvio da confirmação no outro tenant teve efeito`);
      const d2 = await prisma.operacaoFinanceira.findFirst({
        where: { cliente_id: s2.cliente_id, id: id2 },
        include: { itens: true, titulos: true },
      });
      const it2 = d2.itens[0];
      const lote2 = await prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s2.cliente_id, id: it2.estoque_lote_nota_id } });
      igual(
        `${d2.status}:${dec(d2.valor_total)}:${dec(it2.valor_desconto_rateado)}:${dec(it2.valor_liquido)}:${dec(lote2?.custo_unitario)}:${d2.titulos.map((t) => `${t.status}/${dec(t.valor)}`).join('|')}`,
        'CONFIRMADO:7500.0000:500.0000:7500.0000:2.5000:ABERTO/7500.0000',
        `[${rotulo}] compra com desconto do outro tenant (banco)`,
      );
      igual(await prisma.movimentacaoEstoque.count({ where: { cliente_id: s2.cliente_id, lancamento_origem_id: id2 } }), 1, `[${rotulo}] movimentos do outro tenant (sem segundo efeito)`);
      igual((k1.corpo?.itens ?? []).map(linhaRateio).join(' | '), caso.esperado.itens.map(linhaRateio).join(' | '), `[${rotulo}] detalhe da confirmação no outro tenant = vetor ${caso.id}`);
      // isolamento pela API real
      for (const [tk, id, emp, desc] of [
        [token2, idA, s.empresa.id, 'outro tenant pede a compra de A com a empresa de A'],
        [token2, idA, s2.empresa.id, 'outro tenant pede a compra de A com a própria empresa'],
        [token, id2, s.empresa.id, 'A pede a compra do outro tenant com a própria empresa'],
        [token, id2, s2.empresa.id, 'A pede a compra do outro tenant com a empresa dele'],
      ]) {
        const x = await detalheApi(tk, id, emp);
        conferir([403, 404].includes(x.status) && !JSON.stringify(x.corpo ?? {}).includes('7500'), `[${rotulo}] ${desc}: ${x.status} ${JSON.stringify(x.corpo ?? {}).slice(0, 160)}`);
      }
      const listaA = await listaApi(token, s.empresa.id);
      conferir(listaA.status === 200 && listaA.ids.includes(idA) && !listaA.ids.includes(id2), `[${rotulo}] lista da API de A: ${listaA.status}, tem A=${listaA.ids.includes(idA)}, tem o outro tenant=${listaA.ids.includes(id2)}`);
      const lista2 = await listaApi(token2, s2.empresa.id);
      conferir(lista2.status === 200 && lista2.ids.includes(id2) && !lista2.ids.includes(idA), `[${rotulo}] lista da API do outro tenant: ${lista2.status}, tem o dele=${lista2.ids.includes(id2)}, tem A=${lista2.ids.includes(idA)}`);
      igual(await fotoA(), antes, `[${rotulo}] o outro tenant mexeu no banco de A`);
      // na tela: B não mostra a compra de A; A não mostra a do outro tenant
      const idsB = (await prisma.operacaoFinanceira.findMany({ where: { cliente_id: s.cliente_id, empresa_id: s.empresa2.id }, select: { id: true } })).map((o) => o.id);
      await irParaLista();
      await dono.trocarEmpresa(s.empresa, s.empresa2);
      await page.waitForTimeout(1500);
      await dono.esperarLista(idsB, [idA, id2], 'lista de B (rodada 4)');
      await shot('r4-lista-empresa-B');
      await dono.trocarEmpresa(s.empresa2, s.empresa);
      await dono.esperarLista([idA], [id2, ...idsB], 'lista de A (rodada 4)');
      await shot('r4-lista-empresa-A');
    });

    // 27. (g) Vínculo único (banco): cada título liga a um só documento e cada
    //     movimento/lote da P3 a um só item, em A e no outro tenant; o banco
    //     recusa ligar um movimento a um segundo item.
    await passo('27 R4 vinculo unico: cada titulo e cada movimento ligado a um so documento/item (banco)', async () => {
      const repetidos = (xs) => [...new Set(xs.filter((x, k) => xs.indexOf(x) !== k))];
      const tenants = [s, docs.outroTenant].filter(Boolean);
      for (const t of tenants) {
        const cli = t.cliente_id;
        const nome = t === s ? 'A' : 'outro tenant';
        const ops = await prisma.operacaoFinanceira.findMany({ where: { cliente_id: cli }, select: { id: true, empresa_id: true, direcao: true } });
        const opPorId = new Map(ops.map((o) => [o.id, o]));
        const titulos = await prisma.tituloFinanceiro.findMany({ where: { cliente_id: cli }, select: { id: true, operacao_id: true, empresa_id: true, numero_parcela: true } });
        igual(titulos.filter((x) => !x.operacao_id || opPorId.get(x.operacao_id)?.empresa_id !== x.empresa_id).length, 0, `[${rotulo}] ${nome}: títulos sem documento (ou de outra empresa)`);
        igual(repetidos(titulos.map((x) => `${x.operacao_id}#${x.numero_parcela}`)).length, 0, `[${rotulo}] ${nome}: parcela repetida no mesmo documento`);
        const itens = await prisma.operacaoFinanceiraItem.findMany({
          where: { cliente_id: cli },
          select: { id: true, operacao_id: true, tipo_item: true, movimentacao_estoque_id: true, movimentacao_estorno_id: true, estoque_lote_nota_id: true },
        });
        igual(itens.filter((i) => !opPorId.has(i.operacao_id)).length, 0, `[${rotulo}] ${nome}: item sem documento`);
        const refsMov = itens.flatMap((i) => [i.movimentacao_estoque_id, i.movimentacao_estorno_id].filter(Boolean));
        igual(repetidos(refsMov).length, 0, `[${rotulo}] ${nome}: movimento ligado a mais de um item`);
        igual(repetidos(itens.map((i) => i.estoque_lote_nota_id).filter(Boolean)).length, 0, `[${rotulo}] ${nome}: lote ligado a mais de um item`);
        igual(itens.filter((i) => i.tipo_item === 'SERVICO' && (i.movimentacao_estoque_id || i.movimentacao_estorno_id || i.estoque_lote_nota_id)).length, 0, `[${rotulo}] ${nome}: serviço com movimento ou lote`);
        const movs = await prisma.movimentacaoEstoque.findMany({
          where: { cliente_id: cli, tipo_detalhado: { in: ['compra_financeiro', 'venda_financeiro', 'estorno_compra', 'estorno_venda'] } },
          select: { id: true, lancamento_origem_id: true, movimento_pai_id: true },
        });
        const itemDoMov = new Map();
        for (const i of itens) for (const m of [i.movimentacao_estoque_id, i.movimentacao_estorno_id]) if (m) itemDoMov.set(m, i);
        const orfaos = movs.filter((m) => itemDoMov.get(m.id)?.operacao_id !== m.lancamento_origem_id);
        igual(orfaos.length, 0, `[${rotulo}] ${nome}: movimento da P3 sem item (ou de outro documento): ${orfaos.slice(0, 3).map((m) => m.id).join(', ')}`);
        const movPorId = new Map(movs.map((m) => [m.id, m]));
        igual(refsMov.filter((m) => !movPorId.has(m)).length, 0, `[${rotulo}] ${nome}: item apontando para movimento inexistente`);
        igual(itens.filter((i) => i.movimentacao_estorno_id && movPorId.get(i.movimentacao_estorno_id)?.movimento_pai_id !== i.movimentacao_estoque_id).length, 0, `[${rotulo}] ${nome}: estorno que não é filho do movimento do próprio item`);
        const lotes = await prisma.estoqueLoteNota.findMany({ where: { cliente_id: cli, id: { in: itens.map((i) => i.estoque_lote_nota_id).filter(Boolean) } }, select: { id: true, movimentacao_entrada_id: true } });
        igual(lotes.filter((l) => itens.find((i) => i.estoque_lote_nota_id === l.id)?.movimentacao_estoque_id !== l.movimentacao_entrada_id).length, 0, `[${rotulo}] ${nome}: lote cuja entrada não é o movimento do item`);
        const consumos = await prisma.operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: cli }, select: { item_id: true, estoque_lote_nota_id: true } });
        const itemPorId = new Map(itens.map((i) => [i.id, i]));
        igual(consumos.filter((c) => opPorId.get(itemPorId.get(c.item_id)?.operacao_id)?.direcao !== 'RECEBER').length, 0, `[${rotulo}] ${nome}: fatia FIFO fora de uma venda`);
        igual(repetidos(consumos.map((c) => `${c.item_id}#${c.estoque_lote_nota_id}`)).length, 0, `[${rotulo}] ${nome}: fatia FIFO repetida`);
        console.log(`  [${rotulo}] vínculo único (${nome}): ${ops.length} documentos, ${titulos.length} títulos, ${itens.length} itens, ${movs.length} movimentos da P3, ${lotes.length} lotes, ${consumos.length} fatias`);
      }
      // O banco garante: índices únicos por tenant e título sempre com documento.
      const indices = await prisma.$queryRawUnsafe(
        `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexname = ANY($1::text[]) ORDER BY 1`,
        ['OperacaoFinanceiraItem_cliente_id_movimentacao_estoque_id_key', 'OperacaoFinanceiraItem_cliente_id_movimentacao_estorno_id_key', 'OperacaoFinanceiraItem_cliente_id_estoque_lote_nota_id_key', 'TituloFinanceiro_cliente_id_operacao_id_numero_parcela_key'],
      );
      igual(indices.length, 4, `[${rotulo}] índices únicos do vínculo (${indices.map((x) => x.indexname).join(', ')})`);
      const nulo = await prisma.$queryRawUnsafe(`SELECT is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'TituloFinanceiro' AND column_name = 'operacao_id'`);
      igual(nulo[0]?.is_nullable, 'NO', `[${rotulo}] TituloFinanceiro.operacao_id aceita nulo`);
      const comMov = (await prisma.operacaoFinanceiraItem.findMany({ where: { cliente_id: s.cliente_id, movimentacao_estoque_id: { not: null } }, orderBy: { id: 'asc' }, select: { id: true, movimentacao_estoque_id: true } })).slice(0, 2);
      if (comMov.length === 2) {
        let recusa = null;
        try {
          await prisma.operacaoFinanceiraItem.updateMany({ where: { cliente_id: s.cliente_id, id: comMov[1].id }, data: { movimentacao_estoque_id: comMov[0].movimentacao_estoque_id } });
        } catch (erro) {
          recusa = erro?.code ?? String(erro?.message ?? erro).slice(0, 80);
        }
        conferir(recusa, `[${rotulo}] o banco aceitou ligar um movimento a dois itens`);
        console.log(`  [${rotulo}] tentativa de ligar um movimento a dois itens recusada pelo banco: ${recusa}`);
        const intacto = await prisma.operacaoFinanceiraItem.findFirst({ where: { cliente_id: s.cliente_id, id: comMov[1].id }, select: { movimentacao_estoque_id: true } });
        igual(intacto.movimentacao_estoque_id, comMov[1].movimentacao_estoque_id, `[${rotulo}] item mudou depois da tentativa recusada`);
      } else {
        conferir(false, `[${rotulo}] menos de dois itens com movimento para provar a recusa do banco`);
      }
    });

    // ─── P3-02 (D-PROD-156): rateio gerencial POR ITEM ─────────────────────
    // Compra COM produtos, PARCELADA em 2, com 2 mercadorias (KG) + 1 serviço,
    // desconto 10,00 e acréscimo 3,33 rateados por item (maiores restos):
    //   SAL MINERAL 200 kg × 2,50 = 500,00 → desc 3,22 acr 1,08 líq 497,86 (2,4893/kg)
    //   serviço VACINAÇÃO 1 × 150,00      → desc 0,97 acr 0,32 líq 149,35
    //   RAÇÃO 400 kg × 2,25 = 900,00      → desc 5,81 acr 1,93 líq 896,12 (2,2403/kg)
    //   total 1.543,33 = Σ líquidos; parcelas 771,66 + 771,67. Os restos são
    //   todos distintos: a ordem dos itens não muda o rateio de cada um.
    // Classificação por item (modo VALOR): SAL INSUMOS/CRIA (100%); VACINAÇÃO
    // SANIDADE/CRIA (100%); RAÇÃO em DOIS centros: INSUMOS/CRIA 500,00 +
    // INSUMOS/RECRIA 396,12. Digitado na ordem SAL, VACINAÇÃO, RAÇÃO; no
    // rascunho reaberto a RAÇÃO SOBE para o item 2 (PUT): as linhas vão junto.
    // Consolidado (1ª aparição, ordem FINAL): INSUMOS/CRIA 997,86 (64,656295%),
    // INSUMOS/RECRIA 396,12 (25,666578%), SANIDADE/CRIA 149,35 (9,677127%);
    // Σ = 1.543,33. Conferido à mão (maiores restos) e com
    // src/lib/rateioCabecalho.js, src/lib/rateioPorItem.js e o plano do backend.
    const P302_ITENS = {
      sal: { tipo: 'MERCADORIA', nome: 'SAL MINERAL', subtotal: '500.00', desconto: '3.22', acrescimo: '1.08', liquido: '497.86', kg: '200.0000', custo: '2.4893',
        // [natureza, centro de custo, valor, % do líquido do item (informativo no VALOR)]
        linhas: [['insumos', 'custo', '497.86', '100.000000']] },
      vac: { tipo: 'SERVICO', nome: 'VACINAÇÃO', subtotal: '150.00', desconto: '0.97', acrescimo: '0.32', liquido: '149.35', kg: null, custo: null,
        linhas: [['sanidade', 'custo', '149.35', '100.000000']] },
      racao: { tipo: 'MERCADORIA', nome: 'RAÇÃO', subtotal: '900.00', desconto: '5.81', acrescimo: '1.93', liquido: '896.12', kg: '400.0000', custo: '2.2403',
        linhas: [['insumos', 'custo', '500.00', '55.796099'], ['insumos', 'custo2', '396.12', '44.203901']] },
    };
    const P302 = {
      total: '1543.33',
      inicial: [P302_ITENS.sal, P302_ITENS.vac, P302_ITENS.racao],
      final: [P302_ITENS.sal, P302_ITENS.racao, P302_ITENS.vac],
      consolidadoInicial: [
        ['insumos', 'custo', '997.86', '64.656295'],
        ['sanidade', 'custo', '149.35', '9.677127'],
        ['insumos', 'custo2', '396.12', '25.666578'],
      ],
      consolidado: [
        ['insumos', 'custo', '997.86', '64.656295'],
        ['insumos', 'custo2', '396.12', '25.666578'],
        ['sanidade', 'custo', '149.35', '9.677127'],
      ],
      parcelas: ['771.66', '771.67'],
    };
    const NOME_NAT = { insumos: 'INSUMOS', sanidade: 'SANIDADE' };
    const NOME_CC = { custo: 'REBANHO DE CRIA', custo2: 'REBANHO DE RECRIA' };
    /** Linhas por item gravadas, item a item (ordem do item, depois a da linha). */
    const linhasPorItemNoBanco = async (operacaoId) =>
      (
        await prisma.operacaoFinanceiraItem.findMany({
          where: { cliente_id: s.cliente_id, operacao_id: operacaoId },
          orderBy: { ordem: 'asc' },
          include: { rateios: { orderBy: { ordem: 'asc' } } },
        })
      ).map((i) => i.rateios);
    const confirmarAviso = async (botao) => {
      const aviso = page.getByRole('alertdialog');
      await aviso.waitFor({ state: 'visible' });
      const texto = await aviso.innerText();
      await clicar(aviso.getByRole('button', { name: botao, exact: true }));
      await aviso.waitFor({ state: 'hidden' }).catch(() => {});
      return texto;
    };

    // 28. Compra POR ITEM feita PELA TELA: troca de escopo com os diálogos nos
    //     dois sentidos, "usar a classificação geral", "começar em branco",
    //     "aplicar a todos", 1 item em 2 centros, diferença ao centavo
    //     bloqueando o Confirmar, prévia com a classificação e o consolidado,
    //     confirmação; no banco: 1 título por parcela, 1 movimento por item
    //     físico, lote com o custo líquido, linhas por item exatas e Σ = total.
    await passo('28 P3-02 compra POR ITEM pela tela (3 itens, mercadoria + servico, desconto e acrescimo, 1 item em 2 centros): escopo com dialogos, previa, confirmacao e banco exato', async () => {
      const salAntes = await produtoAgora(s.produtos.sal.id);
      const racaoAntes = await produtoAgora(s.produtos.racao.id);
      const estoqueAntes = await fotoEstoque(s);
      const criados = [];
      const substituidos = [];
      const ouvirCriacao = (req) => {
        const caminho = new URL(req.url()).pathname;
        if (req.method() === 'POST' && caminho === '/api/native/operacoes-financeiras') criados.push(JSON.parse(req.postData() || '{}'));
        if (req.method() === 'PUT' && /^\/api\/native\/operacoes-financeiras\/[^/]+$/.test(caminho)) substituidos.push(JSON.parse(req.postData() || '{}'));
      };
      page.on('request', ouvirCriacao);
      let rasc;
      try {
        await novo();
        // Sem produtos não existe o seletor de escopo (só o rateio geral).
        igual(await page.getByTestId('escolha-escopo-rateio').count(), 0, `[${rotulo}] seletor "Rateio: Geral | Por item" visível SEM produtos`);
        await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
        await radio('escolha-conteudo', 'Com produtos');
        await radio('escolha-condicao', 'Parcelado');
        await escolher('seletor-produto-0', /SAL MINERAL/);
        await escolher('seletor-local-0', /DEPÓSITO 03/);
        await preencher('item-0-quantidade', '200');
        await preencher('item-0-valor-unitario', '2,50');
        await clicar(page.getByRole('button', { name: 'Serviço', exact: true }));
        await visivel(page.getByTestId('item-1').getByLabel('Descrição do serviço')).fill('VACINAÇÃO');
        await preencher('item-1-quantidade', '1');
        await preencher('item-1-valor-unitario', '150,00');
        await clicar(page.getByRole('button', { name: 'Mercadoria', exact: true }));
        await escolher('seletor-produto-2', /RAÇÃO/);
        await escolher('seletor-local-2', /DEPÓSITO 03/);
        await preencher('item-2-quantidade', '400');
        await preencher('item-2-valor-unitario', '2,25');
        await preencher('valor-desconto', '10,00');
        await preencher('valor-acrescimo', '3,33');
        await preencher('data-operacional', hoje);
        await clicar(page.getByTestId('declaracao-efeito-fisico'));
        // Rateio GERAL primeiro (o padrão): uma linha, INSUMOS.
        await visivel(page.getByTestId('escolha-escopo-rateio')).waitFor();
        conferir(
          await visivel(page.getByTestId('escolha-escopo-rateio').getByRole('radio', { name: 'Geral', exact: true })).isChecked(),
          `[${rotulo}] o escopo padrão do rateio não é "Geral"`,
        );
        await escolher('seletor-natureza-0', /INSUMOS/);
        const total = limpo(await visivel(page.getByTestId('total-lancamento')).innerText());
        conferir(total.includes(br(P302.total)), `[${rotulo}] total do formulário POR ITEM: "${total}"`);

        // (a) GERAL → POR ITEM: o diálogo pergunta; "Continuar no rateio geral" não muda nada.
        await radio('escolha-escopo-rateio', 'Por item');
        const dlgEscopo = page.getByTestId('dialogo-escopo-por-item');
        await dlgEscopo.waitFor({ state: 'visible' });
        conferir(await page.getByTestId('escopo-por-item-proporcional').isEnabled(), `[${rotulo}] "Usar a classificação geral" desabilitado com o geral completo`);
        await shot('p302-dialogo-escopo');
        if (movel) await dentroDaTela('dialogo-escopo-por-item', 'diálogo do escopo');
        await clicar(page.getByTestId('escopo-por-item-cancelar'));
        await dlgEscopo.waitFor({ state: 'hidden' });
        igual(await page.getByTestId('rateio-item-0').count(), 0, `[${rotulo}] "Continuar no rateio geral" abriu o rateio por item`);
        conferir(await visivel(page.getByTestId('seletor-natureza-0')).isVisible(), `[${rotulo}] o rateio geral sumiu depois de "Continuar no rateio geral"`);

        // (b) "Usar a classificação geral": cada item com INSUMOS, 100% do SEU líquido.
        await radio('escolha-escopo-rateio', 'Por item');
        await dlgEscopo.waitFor({ state: 'visible' });
        await clicar(page.getByTestId('escopo-por-item-proporcional'));
        await dlgEscopo.waitFor({ state: 'hidden' });
        for (const [k, it] of P302.inicial.entries()) {
          await visivel(page.getByTestId(`rateio-item-${k}`)).waitFor();
          const cab = limpo(await visivel(page.getByTestId(`rateio-item-${k}-cabecalho`)).innerText());
          conferir(cab.toUpperCase().includes(`ITEM${k + 1}`) && cab.includes(br(it.liquido)), `[${rotulo}] cabeçalho do item ${k + 1} sem "Item ${k + 1}" ou o líquido ${it.liquido}: "${cab}"`);
          const nat = await visivel(page.getByTestId(`seletor-natureza-item-${k}-0`)).innerText();
          conferir(/INSUMOS/.test(nat), `[${rotulo}] item ${k + 1} não herdou INSUMOS do geral: "${nat}"`);
          const auto = limpo(await visivel(page.getByTestId(`rateio-item-${k}-linha-0-valor-auto`)).innerText());
          conferir(auto.includes(br(it.liquido)), `[${rotulo}] linha única do item ${k + 1} sem o líquido automático: "${auto}"`);
        }
        await shot('p302-por-item-proporcional');

        // (c) POR ITEM → GERAL com dados: pede confirmação; "Descartar e voltar" traz o geral INTACTO.
        await radio('escolha-escopo-rateio', 'Geral');
        const aviso1 = await confirmarAviso('Descartar e voltar');
        conferir(/classificações por item serão descartadas/i.test(aviso1), `[${rotulo}] a volta ao geral não avisou que descarta: "${aviso1.slice(0, 200)}"`);
        igual(await page.getByTestId('rateio-item-0').count(), 0, `[${rotulo}] blocos por item continuam depois de voltar ao geral`);
        const natGeral = await visivel(page.getByTestId('seletor-natureza-0')).innerText();
        conferir(/INSUMOS/.test(natGeral), `[${rotulo}] o rateio geral não voltou intacto: "${natGeral}"`);

        // (d) De novo POR ITEM, agora "Começar em branco": cada item com 1 linha vazia e o Confirmar bloqueado.
        await radio('escolha-escopo-rateio', 'Por item');
        await dlgEscopo.waitFor({ state: 'visible' });
        await clicar(page.getByTestId('escopo-por-item-branco'));
        await dlgEscopo.waitFor({ state: 'hidden' });
        for (const k of [0, 1, 2]) {
          const nat = await visivel(page.getByTestId(`seletor-natureza-item-${k}-0`)).innerText();
          conferir(!/INSUMOS|SANIDADE|FRETE/.test(nat), `[${rotulo}] "Começar em branco" deixou natureza no item ${k + 1}: "${nat}"`);
        }
        conferir(await page.getByTestId('botao-confirmar-lancamento').isDisabled(), `[${rotulo}] Confirmar habilitado com itens sem classificação`);
        const bloqueado = await visivel(page.getByTestId('confirmar-bloqueado-rateio-item')).innerText();
        conferir(/Item 1, linha 1 do rateio/.test(bloqueado), `[${rotulo}] o aviso do Confirmar não aponta o item e a linha: "${bloqueado}"`);

        // (e) "Aplicar classificação a todos os itens": INSUMOS + REBANHO DE CRIA, 100% em cada item.
        await clicar(page.getByTestId('abrir-aplicar-todos'));
        await escolher('seletor-natureza-todos', /INSUMOS/);
        await escolher('seletor-centro-custo-todos', /REBANHO DE CRIA/);
        await shot('p302-aplicar-todos');
        await clicar(page.getByTestId('aplicar-classificacao-todos'));
        for (const k of [0, 1, 2]) {
          const cc = await visivel(page.getByTestId(`seletor-centro-custo-item-${k}-0`)).innerText();
          conferir(/REBANHO DE CRIA/.test(cc), `[${rotulo}] "aplicar a todos" não chegou ao item ${k + 1}: "${cc}"`);
        }
        // Item 2 (serviço): SANIDADE. Item 3: dois centros, com 1 centavo a menos primeiro.
        await escolher('seletor-natureza-item-1-0', /SANIDADE/);
        await clicar(page.getByTestId('rateio-item-2-adicionar'));
        await preencher('rateio-item-2-linha-0-valor', '500,00');
        await escolher('seletor-natureza-item-2-1', /INSUMOS/);
        await escolher('seletor-centro-custo-item-2-1', /REBANHO DE RECRIA/);
        await preencher('rateio-item-2-linha-1-valor', '396,11');
        const difItem = await visivel(page.getByTestId('rateio-item-2-diferenca')).innerText();
        conferir(/falta/i.test(difItem) && limpo(difItem).includes('0,01'), `[${rotulo}] diferença de 1 centavo do item 3 não aparece: "${difItem}"`);
        const difTotal = await visivel(page.getByTestId('rateio-itens-diferenca-total')).innerText();
        conferir(/falta/i.test(difTotal) && limpo(difTotal).includes('0,01'), `[${rotulo}] diferença total de 1 centavo não aparece: "${difTotal}"`);
        conferir(await page.getByTestId('botao-confirmar-lancamento').isDisabled(), `[${rotulo}] Confirmar habilitado com o item 3 sem fechar`);
        const bloqueado3 = await visivel(page.getByTestId('confirmar-bloqueado-rateio-item')).innerText();
        conferir(/Item 3/.test(bloqueado3), `[${rotulo}] o aviso do Confirmar não aponta o item 3: "${bloqueado3}"`);
        await shot('p302-diferenca-centavo');
        if (movel) await dentroDaTela('rateio-item-', 'rateio por item (formulário)');
        await preencher('rateio-item-2-linha-1-valor', '396,12');
        const difOk = await visivel(page.getByTestId('rateio-itens-diferenca-total')).innerText();
        conferir(/Fechado/.test(difOk), `[${rotulo}] o total do rateio por item não fechou: "${difOk}"`);
        conferir(await page.getByTestId('botao-confirmar-lancamento').isEnabled(), `[${rotulo}] Confirmar continua desabilitado com tudo fechado`);
        igual(await page.getByTestId('confirmar-bloqueado-rateio-item').count(), 0, `[${rotulo}] aviso de bloqueio continua com tudo fechado`);

        // (f) Recolher e expandir o bloco do item 1 (as linhas continuam no estado).
        await clicar(page.getByTestId('rateio-item-0-cabecalho'));
        igual(await page.getByTestId('rateio-item-0-linha-0').count(), 0, `[${rotulo}] o bloco do item 1 não recolheu`);
        await clicar(page.getByTestId('rateio-item-0-cabecalho'));
        await visivel(page.getByTestId('rateio-item-0-linha-0')).waitFor();

        // (g) POR ITEM → GERAL com dados, e "Cancelar": nada muda.
        await radio('escolha-escopo-rateio', 'Geral');
        await confirmarAviso('Cancelar');
        conferir(await visivel(page.getByTestId('escolha-escopo-rateio').getByRole('radio', { name: 'Por item', exact: true })).isChecked(), `[${rotulo}] "Cancelar" saiu do rateio por item`);
        const linha31 = limpo(await visivel(page.getByTestId('seletor-centro-custo-item-2-1')).innerText());
        conferir(/REBANHODERECRIA/.test(linha31), `[${rotulo}] "Cancelar" perdeu a linha 2 do item 3: "${linha31}"`);

        // Parcelado em 2 (gerador: 30 e 60 dias).
        const gerador = page.getByTestId('gerador-parcelas');
        await visivel(gerador.getByLabel(/Nº de parcelas/)).fill('2');
        await clicar(gerador.getByRole('button', { name: 'Gerar parcelas' }));
        await page.getByTestId('parcela-1-valor').first().waitFor();
        const difParc = await visivel(page.getByTestId('parcelas-diferenca')).innerText();
        conferir(!/falta|sobra/i.test(difParc), `[${rotulo}] parcelas 771,66 + 771,67 acusam diferença: ${difParc}`);
        await shot('p302-por-item-form');

        // Prévia (o Confirmar salva o rascunho com POST e pede a prévia ao servidor).
        const linhasDaApi = (itens) => (itens ?? []).map((i) => (i.rateios ?? []).map((r) => `${r.natureza_id}:${r.centro_custo_id}:${r.valor}:${r.percentual}`).join(',')).join(' | ');
        const linhasEsperadas = (ordem) => ordem.map((it) => it.linhas.map(([n, cc, v, p]) => `${s.naturezas[n]}:${s.centros[cc]}:${v}:${p}`).join(',')).join(' | ');
        const consolidadoDaApi = (lista) => (lista ?? []).map((g) => `${g.natureza_nome}:${g.centro_custo_nome}:${g.valor}:${g.percentual}`).join(' | ');
        const consolidadoEsperado = (lista) => lista.map(([n, cc, v, p]) => `${NOME_NAT[n]}:${NOME_CC[cc]}:${v}:${p}`).join(' | ');
        const previa1 = await confirmarPelaTela('p302-por-item');
        conferir(limpo(previa1.resumo).includes(br(P302.total)) && /2 parcelas/i.test(previa1.resumo), `[${rotulo}] resumo da compra POR ITEM: ${previa1.resumo.slice(0, 200)}`);
        conferir(!previa1.bloqueios.trim(), `[${rotulo}] prévia da compra POR ITEM com bloqueio: ${previa1.bloqueios.slice(0, 200)}`);
        await mostrar('previa-rateio-item-3-classificacao', 'p302-previa-classificacao');
        const cls3 = limpo(await textoBruto('previa-rateio-item-3-classificacao'));
        conferir(
          cls3.includes('REBANHODECRIA') && cls3.includes('REBANHODERECRIA') && cls3.includes(br('500.00')) && cls3.includes(br('396.12')),
          `[${rotulo}] prévia sem os dois centros do item 3 (RAÇÃO): "${cls3.slice(0, 300)}"`,
        );
        await mostrar('previa-rateio-consolidado', 'p302-previa-consolidado');
        const consPrevia = await textoBruto('previa-rateio-consolidado');
        conferir(/confere com o total do documento/.test(consPrevia) && !/NÃO confere/.test(consPrevia), `[${rotulo}] prévia: consolidado não confere: "${consPrevia.slice(0, 300)}"`);
        if (movel) {
          await dentroDaTela('previa-rateio', 'prévia POR ITEM');
          await dentroDaTela('dialogo-confirmacao', 'diálogo de confirmação POR ITEM');
        }
        rasc = await ultimaOperacao(s);
        exigir(rasc?.status === 'RASCUNHO' && rasc.rateio_escopo === 'POR_ITEM', `[${rotulo}] rascunho POR ITEM não está no banco (escopo ${rasc?.rateio_escopo})`);
        const pv = await previaApi(token, rasc.id, s.empresa.id);
        igual(`${pv.status}:${(pv.corpo?.bloqueios ?? []).length}:${pv.corpo?.plano?.rateio_escopo}:${(pv.corpo?.plano?.rateios ?? []).length}`, '200:0:POR_ITEM:0', `[${rotulo}] prévia da API (escopo, rateio geral vazio)`);
        igual(linhasDaApi(pv.corpo?.plano?.itens), linhasEsperadas(P302.inicial), `[${rotulo}] prévia da API: linhas por item (ordem digitada)`);
        igual(consolidadoDaApi(pv.corpo?.plano?.rateio_consolidado), consolidadoEsperado(P302.consolidadoInicial), `[${rotulo}] prévia da API: consolidado (ordem digitada)`);

        // "Voltar": o formulário passa a mostrar o RASCUNHO como o servidor o devolveu
        // (detalhe → formulário): escopo, linhas e centros de cada item intactos.
        await clicar(page.getByTestId('dialogo-confirmacao').getByRole('button', { name: 'Voltar', exact: true }));
        await page.getByTestId('dialogo-confirmacao').waitFor({ state: 'hidden' });
        await visivel(page.getByTestId('rateio-item-2')).waitFor();
        conferir(
          await visivel(page.getByTestId('escolha-escopo-rateio').getByRole('radio', { name: 'Por item', exact: true })).isChecked(),
          `[${rotulo}] rascunho reaberto não está no rateio por item`,
        );
        for (const [k, it] of P302.inicial.entries()) {
          for (const [j, [n, cc]] of it.linhas.entries()) {
            const nat = limpo(await visivel(page.getByTestId(`seletor-natureza-item-${k}-${j}`)).innerText());
            const ccTxt = limpo(await visivel(page.getByTestId(`seletor-centro-custo-item-${k}-${j}`)).innerText());
            // "REBANHODECRIA" não é parte de "REBANHODERECRIA": `includes` distingue os dois centros.
            conferir(nat.includes(NOME_NAT[n]) && ccTxt.includes(NOME_CC[cc].replace(/\s/g, '')), `[${rotulo}] rascunho reaberto: item ${k + 1} linha ${j + 1} = "${nat}" / "${ccTxt}"`);
          }
        }
        await shot('p302-rascunho-reaberto');

        // Editar e SUBIR a RAÇÃO (item 3 → item 2): as linhas vão junto (estado na chave do item).
        await clicar(page.getByRole('button', { name: 'Editar', exact: true }));
        await clicar(page.getByRole('button', { name: 'Mover item 3 para cima', exact: true }));
        for (const [k, it] of P302.final.entries()) {
          const cab = limpo(await visivel(page.getByTestId(`rateio-item-${k}-cabecalho`)).innerText()).toUpperCase();
          conferir(cab.includes(`ITEM${k + 1}·${it.nome.replace(/\s/g, '')}`) && cab.includes(br(it.liquido)), `[${rotulo}] depois de subir a RAÇÃO, cabeçalho do item ${k + 1}: "${cab}"`);
          const nLinhas = await page.evaluate((kk) => [...document.querySelectorAll('[data-testid]')].filter((e) => new RegExp(`^rateio-item-${kk}-linha-\\d+$`).test(e.getAttribute('data-testid') ?? '')).length, k);
          igual(nLinhas, it.linhas.length, `[${rotulo}] depois de subir a RAÇÃO, linhas do item ${k + 1}`);
        }
        const ccRecria = limpo(await visivel(page.getByTestId('seletor-centro-custo-item-1-1')).innerText());
        conferir(ccRecria.includes('REBANHODERECRIA'), `[${rotulo}] a linha 2 da RAÇÃO não acompanhou o item: "${ccRecria}"`);
        conferir(await page.getByTestId('botao-confirmar-lancamento').isEnabled(), `[${rotulo}] Confirmar desabilitado depois de reordenar (tudo continua fechado)`);
        await shot('p302-racao-subiu');

        // Confirmar de novo: o formulário mudou → PUT do rascunho → prévia na ordem nova.
        const previa2 = await confirmarPelaTela('p302-por-item-reordenado');
        conferir(!previa2.bloqueios.trim(), `[${rotulo}] prévia do rascunho reordenado com bloqueio: ${previa2.bloqueios.slice(0, 200)}`);
        const cls2 = limpo(await textoBruto('previa-rateio-item-2-classificacao'));
        conferir(cls2.includes('REBANHODERECRIA') && cls2.includes(br('396.12')), `[${rotulo}] prévia reordenada: a RAÇÃO (item 2) sem os dois centros: "${cls2.slice(0, 300)}"`);
        const pv2 = await previaApi(token, rasc.id, s.empresa.id);
        igual(`${pv2.status}:${(pv2.corpo?.bloqueios ?? []).length}`, '200:0', `[${rotulo}] prévia da API do rascunho reordenado`);
        igual(linhasDaApi(pv2.corpo?.plano?.itens), linhasEsperadas(P302.final), `[${rotulo}] prévia da API: linhas por item (ordem nova)`);
        igual(consolidadoDaApi(pv2.corpo?.plano?.rateio_consolidado), consolidadoEsperado(P302.consolidado), `[${rotulo}] prévia da API: consolidado (ordem nova)`);
        await confirmarDefinitivo('p302-por-item');
      } finally {
        page.off('request', ouvirCriacao);
      }

      // Os corpos que a TELA mandou: escopo explícito, geral vazio, linhas aninhadas
      // no SEU item (POST na ordem digitada; PUT com a RAÇÃO no item 2).
      igual(`${criados.length}:${substituidos.length}`, '1:1', `[${rotulo}] POST de criação e PUT do rascunho reordenado`);
      const linhasDoCorpo = (c) =>
        (c?.itens ?? []).map((i) => `${i.produto_id ?? i.descricao}=${(i.rateios ?? []).map((r) => `${r.natureza_id}:${r.centro_custo_id ?? null}:${r.centro_resultado_id ?? null}:${r.valor}`).join(',')}`).join(' | ');
      const corpoEsperado = (ordem) =>
        ordem
          .map((it) => `${it === P302_ITENS.sal ? s.produtos.sal.id : it === P302_ITENS.racao ? s.produtos.racao.id : 'VACINAÇÃO'}=${it.linhas.map(([n, cc, v]) => `${s.naturezas[n]}:${s.centros[cc]}:null:${v}`).join(',')}`)
          .join(' | ');
      for (const [nome, c, ordem] of [['POST', criados[0], P302.inicial], ['PUT', substituidos[0], P302.final]]) {
        igual(`${c?.rateio_escopo}:${c?.rateio_modo}:${JSON.stringify(c?.rateios)}`, 'POR_ITEM:VALOR:[]', `[${rotulo}] ${nome} da tela: escopo, modo e rateio geral`);
        igual(linhasDoCorpo(c), corpoEsperado(ordem), `[${rotulo}] ${nome} da tela: linhas de cada item (valor na escala da moeda)`);
      }

      const d = await esperarBanco(async () => {
        const o = await operacaoCompleta(s, rasc.id);
        return o && o.status === 'CONFIRMADO' ? o : null;
      }, 'compra POR ITEM confirmada');
      igual(
        `${d.rateio_escopo}:${d.rateio_modo}:${d.condicao}:${dec(d.valor_bruto)}:${dec(d.valor_desconto)}:${dec(d.valor_acrescimo)}:${dec(d.valor_total)}`,
        'POR_ITEM:VALOR:PARCELADO:1550.0000:10.0000:3.3300:1543.3300',
        `[${rotulo}] cabeçalho da compra POR ITEM`,
      );
      igual(d.rateios.length, 0, `[${rotulo}] compra POR ITEM com linha no rateio GERAL (os modos são exclusivos)`);
      igual(
        d.itens.map((i) => `${i.ordem}:${i.tipo_item}:${i.unidade}:${dec(i.valor_total)}:${dec(i.valor_desconto_rateado)}:${dec(i.valor_acrescimo_rateado)}:${dec(i.valor_liquido)}`).join('|'),
        P302.final.map((e, k) => `${k + 1}:${e.tipo}:${e.tipo === 'SERVICO' ? 'UN' : 'KG'}:${dec4(e.subtotal)}:${dec4(e.desconto)}:${dec4(e.acrescimo)}:${dec4(e.liquido)}`).join('|'),
        `[${rotulo}] itens gravados (banco)`,
      );
      // 1 título por parcela, Σ = total.
      igual(
        d.titulos.map((t) => `${t.numero_parcela}/${t.total_parcelas}:${t.status}:${dec(t.valor)}:${diaDe(t.vencimento)}`).join('|'),
        P302.parcelas.map((v, k) => `${k + 1}/2:ABERTO:${dec4(v)}:${somarDias(hoje, 30 * (k + 1))}`).join('|'),
        `[${rotulo}] títulos da compra POR ITEM (1 por parcela)`,
      );
      igual(await prisma.tituloFinanceiro.count({ where: { cliente_id: s.cliente_id, operacao_id: d.id } }), 2, `[${rotulo}] títulos da compra POR ITEM no banco`);
      igual(deEscala(d.titulos.reduce((t, x) => t + escalar(dec(x.valor), 4), 0n), 4), dec(d.valor_total), `[${rotulo}] Σ títulos = total`);
      // 1 movimento (e 1 lote) por item físico, com o custo LÍQUIDO; o serviço não mexe no estoque.
      igual(await prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, lancamento_origem_id: d.id } }), 2, `[${rotulo}] movimentos da compra POR ITEM (1 por mercadoria)`);
      const servico = d.itens[2];
      igual(`${servico.tipo_item}:${servico.estoque_lote_nota_id}:${servico.movimentacao_estoque_id}:${servico.quantidade_estoque}`, 'SERVICO:null:null:null', `[${rotulo}] serviço sem lote, movimento nem kg`);
      for (const k of [0, 1]) {
        const e = { ...P302.final[k], ordem: k + 1 };
        const i = d.itens[k];
        const lote = await prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s.cliente_id, id: i.estoque_lote_nota_id } });
        const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: i.movimentacao_estoque_id } });
        exigir(lote && mov, `[${rotulo}] item ${e.ordem} sem lote ou movimento`);
        igual(`${dec(lote.quantidade_entrada)}:${dec(lote.custo_unitario)}:${lote.status}:${lote.local_estoque_id}`, `${e.kg}:${e.custo}:Disponivel:${s.local3.id}`, `[${rotulo}] lote do item ${e.ordem} (custo líquido)`);
        igual(`${mov.tipo_detalhado}:${dec(mov.quantidade)}:${dec(mov.valor_total)}:${dec(mov.valor_unitario)}:${lote.movimentacao_entrada_id === mov.id}`, `compra_financeiro:${e.kg}:${dec4(e.liquido)}:${e.custo}:true`, `[${rotulo}] movimento do item ${e.ordem} (valor líquido exato)`);
        igual(deEscala(escalar(e.kg, 4) * escalar(e.custo, 4), 8), deEscala(escalar(e.liquido, 8), 8), `[${rotulo}] custo do lote do item ${e.ordem} × kg = líquido (sem resíduo)`);
        igual(await prisma.estoqueLoteNota.count({ where: { cliente_id: s.cliente_id, movimentacao_entrada_id: mov.id } }), 1, `[${rotulo}] lotes do movimento do item ${e.ordem}`);
      }
      igual(dec((await produtoAgora(s.produtos.sal.id)).estoque_atual), somar4(dec(salAntes.estoque_atual), '200.0000'), `[${rotulo}] estoque_atual do SAL depois da compra POR ITEM`);
      igual(dec((await produtoAgora(s.produtos.racao.id)).estoque_atual), somar4(dec(racaoAntes.estoque_atual), '400.0000'), `[${rotulo}] estoque_atual da RAÇÃO depois da compra POR ITEM`);
      conferir((await fotoEstoque(s)) !== estoqueAntes, `[${rotulo}] a compra POR ITEM não mexeu no estoque`);
      // Linhas por item EXATAS (retrato dos nomes, tipo e direção), Σ = total, nenhuma a mais.
      const porItem = await linhasPorItemNoBanco(d.id);
      igual(
        porItem.map((ls) => ls.map((r) => `${r.ordem}:${r.natureza_id}:${r.natureza_nome}:${r.natureza_tipo}:${r.centro_custo_id}:${r.centro_custo_nome}:${r.centro_resultado_id}:${dec(r.valor)}:${r.percentual}`).join(',')).join(' | '),
        P302.final
          .map((it) => it.linhas.map(([n, cc, v], j) => `${j + 1}:${s.naturezas[n]}:${NOME_NAT[n]}:DESPESA:${s.centros[cc]}:${NOME_CC[cc]}:null:${dec4(v)}:null`).join(','))
          .join(' | '),
        `[${rotulo}] linhas por item gravadas (banco)`,
      );
      const todasLinhas = porItem.flat();
      igual(deEscala(todasLinhas.reduce((t, r) => t + escalar(dec(r.valor), 4), 0n), 4), dec(d.valor_total), `[${rotulo}] Σ das linhas por item = valor_total (banco, exato)`);
      porItem.forEach((ls, k) => igual(deEscala(ls.reduce((t, r) => t + escalar(dec(r.valor), 4), 0n), 4), dec(d.itens[k].valor_liquido), `[${rotulo}] Σ das linhas do item ${k + 1} = líquido do item (banco)`));
      igual(
        todasLinhas.filter((r) => r.operacao_id !== d.id || r.empresa_id !== d.empresa_id || r.operacao_direcao !== 'PAGAR' || !d.itens.some((i) => i.id === r.item_id)).length,
        0,
        `[${rotulo}] linha por item fora do documento, da empresa ou da direção`,
      );
      igual(await prisma.operacaoFinanceiraItemRateio.count({ where: { cliente_id: s.cliente_id, operacao_id: d.id } }), 4, `[${rotulo}] total de linhas por item do documento`);

      // Detalhe (tela): classificação de cada item e o resumo consolidado (Σ = total).
      await mostrar('consulta-item-2-classificacao', 'p302-detalhe-item-2');
      for (const [k, it] of P302.final.entries()) {
        for (const [j, [n, cc, v]] of it.linhas.entries()) {
          const t = limpo(await textoBruto(`consulta-item-${k + 1}-classificacao-linha-${j + 1}`));
          conferir(
            t.includes(NOME_NAT[n]) && t.includes(NOME_CC[cc].replace(/\s/g, '')) && t.includes(br(v)),
            `[${rotulo}] detalhe: item ${k + 1} linha ${j + 1} na tela sem ${NOME_NAT[n]}/${NOME_CC[cc]}/${v}: "${t.slice(0, 200)}"`,
          );
        }
      }
      await mostrar('consulta-rateio-consolidado', 'p302-detalhe-consolidado');
      for (const [k, [n, cc, v]] of P302.consolidado.entries()) {
        const t = limpo(await textoBruto(`consulta-rateio-consolidado-linha-${k + 1}`));
        conferir(t.includes(NOME_NAT[n]) && t.includes(NOME_CC[cc].replace(/\s/g, '')) && t.includes(br(v)), `[${rotulo}] detalhe: consolidado ${k + 1} na tela: "${t.slice(0, 200)}"`);
      }
      igual(await page.locator('[data-testid^="consulta-rateio-consolidado-linha-"][data-testid$="-valor"]').count(), 3, `[${rotulo}] detalhe: linhas do consolidado na tela`);
      const conf = await textoBruto('consulta-rateio-consolidado-conferencia');
      conferir(/confere com o total do documento/.test(conf) && !/NÃO confere/.test(conf), `[${rotulo}] detalhe: consolidado não confere: "${conf}"`);
      if (movel) {
        await dentroDaTela('consulta-item-', 'detalhe POR ITEM (itens)');
        await dentroDaTela('consulta-rateio-consolidado', 'detalhe POR ITEM (consolidado)');
      }
      // Detalhe e lista (API).
      const det = await detalheApi(token, d.id, s.empresa.id);
      igual(`${det.status}:${det.corpo?.rateio_escopo}:${(det.corpo?.rateios ?? []).length}`, '200:POR_ITEM:0', `[${rotulo}] detalhe da API: escopo e rateio geral vazio`);
      igual(
        (det.corpo?.itens ?? []).map((i) => (i.rateios ?? []).map((r) => `${r.ordem}:${r.natureza_nome}:${r.natureza_tipo}:${r.centro_custo_nome}:${r.valor}:${r.percentual}`).join(',')).join(' | '),
        P302.final.map((it) => it.linhas.map(([n, cc, v, p], j) => `${j + 1}:${NOME_NAT[n]}:DESPESA:${NOME_CC[cc]}:${v}:${p}`).join(',')).join(' | '),
        `[${rotulo}] detalhe da API: linhas por item (percentual sobre o líquido do item)`,
      );
      igual(
        (det.corpo?.rateio_consolidado ?? []).map((g) => `${g.natureza_id}:${g.natureza_nome}:${g.centro_custo_id}:${g.centro_custo_nome}:${g.centro_resultado_id}:${g.valor}:${g.percentual}`).join(' | '),
        P302.consolidado.map(([n, cc, v, p]) => `${s.naturezas[n]}:${NOME_NAT[n]}:${s.centros[cc]}:${NOME_CC[cc]}:null:${v}:${p}`).join(' | '),
        `[${rotulo}] detalhe da API: consolidado (Σ = total, 1ª aparição)`,
      );
      const lista = await api(token, 'GET', `/api/native/operacoes-financeiras?empresa_id=${s.empresa.id}`);
      igual(lista.corpo?.items?.find((o) => o.id === d.id)?.rateio_escopo, 'POR_ITEM', `[${rotulo}] lista da API: rateio_escopo da compra POR ITEM`);
      docs.compraPorItem = d;
    });

    // 29. O modo GERAL não mudou: todo documento gravado pela tela tem o escopo
    //     EXPLÍCITO (nunca NULL), nenhuma linha por item, e o consolidado do
    //     detalhe é o próprio rateio geral; a API real recusa um corpo POR ITEM
    //     com soma errada apontando o item (422, nada gravado).
    await passo('29 P3-02 modo GERAL intacto (escopo explicito, consolidado = rateio geral) e recusa POR ITEM da API com item exato', async () => {
      const ops = await prisma.operacaoFinanceira.findMany({ where: { cliente_id: s.cliente_id }, select: { id: true, rateio_escopo: true, conteudo: true } });
      igual(ops.filter((o) => o.rateio_escopo === null).length, 0, `[${rotulo}] documento gravado com rateio_escopo NULL`);
      const porItemIds = ops.filter((o) => o.rateio_escopo === 'POR_ITEM').map((o) => o.id);
      igual(porItemIds.join(','), docs.compraPorItem ? docs.compraPorItem.id : '', `[${rotulo}] documentos POR_ITEM do tenant (só a compra do passo 28)`);
      const linhasFora = await prisma.operacaoFinanceiraItemRateio.count({ where: { cliente_id: s.cliente_id, operacao_id: { notIn: porItemIds } } });
      igual(linhasFora, 0, `[${rotulo}] linhas por item em documento GERAL`);
      const geral = docs.compraMista;
      exigir(geral, `[${rotulo}] o passo 29 usa a compra GERAL do passo 24`);
      const det = await detalheApi(token, geral.id, s.empresa.id);
      igual(`${det.status}:${det.corpo?.rateio_escopo}`, '200:GERAL', `[${rotulo}] detalhe GERAL: escopo`);
      igual((det.corpo?.itens ?? []).map((i) => JSON.stringify(i.rateios)).join(','), (det.corpo?.itens ?? []).map(() => '[]').join(','), `[${rotulo}] detalhe GERAL: itens[].rateios sempre presente e vazio`);
      const chaveGrupo = (g) => ['natureza_id', 'natureza_nome', 'centro_custo_id', 'centro_custo_nome', 'centro_resultado_id', 'centro_resultado_nome', 'valor', 'percentual'].map((k) => `${k}=${g?.[k] ?? null}`).join(',');
      igual(
        (det.corpo?.rateio_consolidado ?? []).map(chaveGrupo).join(' | '),
        (det.corpo?.rateios ?? []).map(chaveGrupo).join(' | '),
        `[${rotulo}] detalhe GERAL: consolidado = as linhas do rateio geral`,
      );
      conferir((det.corpo?.rateio_consolidado ?? []).length > 0, `[${rotulo}] detalhe GERAL sem consolidado`);
      // Recusa da API real (fora da tela): soma do item 2 com 1 centavo a mais.
      const antes = await fotoFinanceiro(s);
      const linha = (nat, valor) => ({ natureza_id: nat, centro_custo_id: s.centros.custo, valor });
      const r = await api(token, 'POST', '/api/native/operacoes-financeiras', {
        empresa_id: s.empresa.id, direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: s.parceiros.fornecedor.id, data_emissao: hoje,
        rateio_escopo: 'POR_ITEM', rateio_modo: 'VALOR', rateios: [], operation_id: `p302-recusa-${randomUUID()}`,
        itens: [
          { tipo_item: 'SERVICO', unidade: 'UN', quantidade: '1', valor_unitario: '100.00', descricao: 'SERVICO A', rateios: [linha(s.naturezas.insumos, '100.00')] },
          { tipo_item: 'SERVICO', unidade: 'UN', quantidade: '1', valor_unitario: '50.00', descricao: 'SERVICO B', rateios: [linha(s.naturezas.insumos, '30.00'), linha(s.naturezas.sanidade, '20.01')] },
        ],
        parcelas: [{ vencimento: somarDias(hoje, 30), valor: '150.00' }],
      });
      const det2 = r.corpo?.details ?? {};
      igual(
        `${r.status}:${r.corpo?.code}:${r.corpo?.reason}:${det2.colecao}:${det2.indice}:${det2.subcolecao}:${'subindice' in det2}:${det2.modo}:${det2.esperado}:${det2.informado}:${det2.diferenca}`,
        '422:OPERACAO_RATEIO_INVALIDO:soma_diferente:itens:1:rateios:false:VALOR:50.00:50.01:-0.01',
        `[${rotulo}] API: soma do item 2 errada → 422 com o item exato`,
      );
      igual(await fotoFinanceiro(s), antes, `[${rotulo}] a recusa POR ITEM gravou algo`);
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
