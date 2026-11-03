// PR174-R3 E2E (+ morte retroativa de todas as matrizes antes do nascimento → 409 com diálogo aberto)
// PR174-R2 E2E (fecha R1 + transferência dia 20 e depois dia 18, 409 causal de peso no cancelamento pela UI)
// PR174-R1 E2E (Chromium, Web responsivo): empresa no ledger — TODOS os manejos pela UI sobre POSIÇÕES:
// transferência, morte, abate retroativo, mudança de categoria, pesagem, junção, nascimento, recusa temporal,
// histórico + cancelamento, offline sem envio, Cadastro (Lote) intacto e verificação de integridade do ledger.
const { chromium } = require('playwright');
const W = Number(process.argv[2]), H = Number(process.argv[3]), BASE = process.argv[4];
const [AREA_A, AREA_B, AREA_C] = process.argv.slice(5, 8);
const OUT = '/tmp/claude-0/r2e/r3';
const API = 'http://127.0.0.1:3334';
const E = 'cmvznzb4400047d3vl57ajnf6';
const BOI = 'Boi 25 a 36 meses', TOURO = 'Touro + 36 meses', VACA = 'Vaca + 36 meses';
const res = [];
const ok = (nome, cond, extra = '') => res.push(`${cond ? 'PASS' : 'FAIL'} ${BASE} ${nome}${extra ? ' — ' + String(extra).slice(0, 240) : ''}`);
const lista = (x) => (Array.isArray(x) ? x : x?.items || []);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const { token } = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'demo.operador', senha: 'senha-demo-local-123' }) })).json();
  const call = async (m, u, b) => (await fetch(`${API}${u}`, { method: m, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();
  const areas = lista(await call('GET', '/areas-pastagem?limit=500'));
  const A = areas.find((a) => a.nome === AREA_A), B = areas.find((a) => a.nome === AREA_B), C = areas.find((a) => a.nome === AREA_C);
  const posicoes = async () => (await call('GET', `/rebanho/posicoes?empresa_id=${E}`)).itens;
  const total = async (area) => (await posicoes()).filter((p) => p.area_atual_id === area.id).reduce((t, p) => t + p.quantidade_cabecas, 0);
  const entradaApi = (nome, qtd, area, categoria, sexo, peso) =>
    call('POST', '/lotes', { empresa_id: E, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: area.setor_id, area_entrada_id: area.id, area_atual_id: area.id, data_entrada: '2026-12-16', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: peso });
  // Quantidades aleatórias: o total de cada área no mapa precisa ser único para o clique.
  const a1 = rnd(301, 480), a2 = rnd(121, 200), v = rnd(61, 99);
  const L1 = await entradaApi(`R1A ${BASE}`, a1, A, BOI, 'Macho', 400);
  const L2 = await entradaApi(`R1B ${BASE}`, a2, A, BOI, 'Macho', 380);
  const V1 = await entradaApi(`R1V ${BASE}`, v, C, VACA, 'Fêmea', 450);
  const q1 = rnd(31, 60), m1 = rnd(3, 9), ab = rnd(11, 19), mc = rnd(21, 29), n = rnd(5, 12);

  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const mobile = W < 800;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  global.__page = page;
  const erros = []; page.on('pageerror', (e) => erros.push(e.message.slice(0, 160)));
  const reqs = [];
  page.on('request', (r) => { if (!['GET', 'OPTIONS', 'HEAD'].includes(r.method())) reqs.push({ m: r.method(), u: new URL(r.url()).pathname.replace(/^\/(api\/)?native/, ''), b: r.postData() || '' }); });
  const tocar = async (loc) => { if (mobile) await loc.tap({ force: true }); else await loc.click({ force: true }); };
  const tocarEstavel = async (loc) => { if (mobile) await loc.tap(); else await loc.click(); };
  const semOverflow = async (rotulo) => {
    const m = await page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].pop(); const r = d ? d.getBoundingClientRect() : { left: 0, right: 0 }; return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, l: r.left, r: r.right, vw: window.innerWidth }; });
    ok(`${rotulo}: sem overflow horizontal`, m.sw <= m.cw + 1 && m.l >= -1 && m.r <= m.vw + 1, JSON.stringify(m));
  };
  const escritas = (desde, re) => reqs.slice(desde).filter((r) => r.m === 'POST' && re.test(r.u));
  const proibidas = (desde) => reqs.slice(desde).filter((r) => /comandos\/manejo-lote/.test(r.u) || (['POST', 'PATCH'].includes(r.m) && /^\/lotes/.test(r.u)) || (r.m === 'POST' && r.u === '/movimentacoes-mapa'));
  await ctx.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(() => {
      for (const t of document.querySelectorAll('[data-sonner-toast]')) {
        const txt = t.innerText;
        if (txt && !window.__toasts.includes(txt)) window.__toasts.push(txt);
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  let toastsLidos = 0;
  const toasts = async () => {
    const todos = await page.evaluate(() => window.__toasts || []);
    const novos = todos.slice(toastsLidos);
    toastsLidos = todos.length;
    return novos.join(' | ');
  };

  await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill('demo.operador');
  await page.locator('input[type=password]').fill('senha-demo-local-123');
  await page.keyboard.press('Enter');
  await page.waitForURL(/mapageral/i, { timeout: 20000 });

  const abrirArea = async (area) => {
    const t = await total(area);
    await page.goto('http://127.0.0.1:5180/MapaGeral', { waitUntil: 'networkidle' });
    toastsLidos = 0;
    await page.waitForTimeout(6000);
    // O total pode coincidir com o de outra área: abre cada ocorrência até o diálogo mostrar ESTA área.
    const alvos = page.getByText(String(t), { exact: true });
    const nAlvos = await alvos.count();
    for (let i = 0; i < nAlvos; i += 1) {
      await alvos.nth(i).dispatchEvent('click');
      await page.getByText('Detalhes do Lote').first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(800);
      if ((await page.getByRole('dialog').last().innerText()).includes(area.nome)) return;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }
    throw new Error(`área ${area.nome} (total ${t}) não encontrada no mapa`);
  };
  const evento = async (nome, menu = 'Eventos') => {
    const gatilho = page.getByRole('button', { name: menu }).first();
    await gatilho.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    const item = page.getByRole('menuitem', { name: nome, exact: true });
    await tocar(gatilho);
    if (!(await item.waitFor({ timeout: 3000 }).then(() => true, () => false))) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
      await tocar(page.getByRole('button', { name: menu }).first());
    }
    await tocarEstavel(item);
  };
  const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const opcao = async (combo, texto) => {
    await tocar(combo);
    const op = page.getByRole('option', { name: new RegExp(`(^|\\b)${escapar(texto)}$`, 'i') }).first();
    await op.scrollIntoViewIfNeeded().catch(() => {});
    const tocou = await (mobile ? op.tap({ timeout: 4000 }) : op.click({ timeout: 4000 })).then(() => true, () => false);
    if (!tocou) {
      // Lista longa no celular: foca a opção (Radix) e confirma com Enter.
      await op.evaluate((el) => el.focus());
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(300);
  };
  /** Abre o formulário de um manejo, adiciona uma linha e devolve o diálogo. */
  const formulario = async (nomeEvento, botaoEnviar, data) => {
    await evento(nomeEvento);
    const dlg = page.getByRole('dialog').last();
    await dlg.getByRole('button', { name: botaoEnviar }).waitFor({ timeout: 15000 });
    await dlg.locator('input[type=date]').first().fill(data);
    const add = dlg.getByRole('button', { name: /Adicionar Categoria/ });
    if (await add.count()) await tocar(add.first());
    await page.waitForTimeout(400);
    return dlg;
  };
  const enviar = async (dlg, botao) => {
    await tocar(dlg.getByRole('button', { name: botao }));
    await page.waitForTimeout(4500);
  };
  const doLote = async (lote) => (await posicoes()).filter((p) => p.lote_entrada_id === lote.id);

  // ── 1. Transferência parcial (BOI) A → B no dia 20 ─────────────────────
  await abrirArea(A);
  let desde = reqs.length;
  await evento('Mover');
  let dlg = page.getByRole('dialog').last();
  await dlg.getByRole('button', { name: /Confirmar Movimentação/ }).waitFor({ timeout: 15000 });
  await dlg.locator('input[type=date]').first().fill('2026-12-20');
  await tocar(dlg.locator('label[for="nao"]'));
  await dlg.locator('input[type=number]').first().fill(String(q1));
  await opcao(dlg.getByRole('combobox').nth(2), B.setor_nome);
  await opcao(dlg.getByRole('combobox').nth(3), AREA_B);
  await semOverflow('transferência');
  await tocar(dlg.getByRole('button', { name: /Confirmar Movimentação/ }));
  await page.waitForTimeout(4500);
  ok('transferência: 1 POST do ledger, nada legado', escritas(desde, /\/rebanho\/comandos\/transferencia/).length === 1 && proibidas(desde).length === 0, `${escritas(desde, /transferencia/).length}`);
  ok(`transferência: A=${a1 + a2 - q1} B=${q1}`, (await total(A)) === a1 + a2 - q1 && (await total(B)) === q1, `${await total(A)}/${await total(B)}`);
  await page.screenshot({ path: `${OUT}/${BASE}-01-transferencia.png` });

  // ── 1b. Transferência RETROATIVA no dia 18 (lançada depois da do dia 20) ──
  const q1b = rnd(5, 9);
  await abrirArea(A);
  desde = reqs.length;
  await evento('Mover');
  dlg = page.getByRole('dialog').last();
  await dlg.getByRole('button', { name: /Confirmar Movimentação/ }).waitFor({ timeout: 15000 });
  await dlg.locator('input[type=date]').first().fill('2026-12-18');
  await tocar(dlg.locator('label[for="nao"]'));
  await dlg.locator('input[type=number]').first().fill(String(q1b));
  await opcao(dlg.getByRole('combobox').nth(2), B.setor_nome);
  await opcao(dlg.getByRole('combobox').nth(3), AREA_B);
  await tocar(dlg.getByRole('button', { name: /Confirmar Movimentação/ }));
  await page.waitForTimeout(4500);
  ok(`retroativa dia 18 depois do dia 20: aceita (mesmo peso), A=${a1 + a2 - q1 - q1b} B=${q1 + q1b}`, escritas(desde, /\/rebanho\/comandos\/transferencia/).length === 1 && (await total(A)) === a1 + a2 - q1 - q1b && (await total(B)) === q1 + q1b, `${await total(A)}/${await total(B)} ${await toasts()}`);

  // ── 2. Morte (BOI) no dia 21 ─────────────────────────────────────────
  await abrirArea(A);
  desde = reqs.length;
  dlg = await formulario('Morte', /Registrar Mortes/, '2026-12-21');
  await dlg.locator('input[type=number]').first().fill(String(m1));
  await opcao(dlg.getByRole('combobox').nth(1), 'Doença');
  await semOverflow('morte');
  await enviar(dlg, /Registrar Mortes/);
  let t = await toasts();
  ok('morte: 1 POST baixa-rebanho, nada legado, toast de sucesso', escritas(desde, /comandos\/baixa-rebanho/).length === 1 && proibidas(desde).length === 0 && /Morte registrad/.test(t), t);
  ok(`morte: A=${a1 + a2 - q1 - q1b - m1}`, (await total(A)) === a1 + a2 - q1 - q1b - m1, `${await total(A)}`);
  await page.screenshot({ path: `${OUT}/${BASE}-02-morte.png` });

  // ── 3. Abate RETROATIVO (dia 17, antes da transferência) ───────────────
  await abrirArea(A);
  desde = reqs.length;
  dlg = await formulario('Abate', /Registrar Abates/, '2026-12-17');
  await dlg.locator('input[type=number]').first().fill(String(ab));
  await opcao(dlg.getByRole('combobox').nth(1), 'Consumo Próprio');
  await semOverflow('abate');
  await enviar(dlg, /Registrar Abates/);
  t = await toasts();
  ok('abate retroativo: 1 POST, aceito', escritas(desde, /comandos\/baixa-rebanho/).length === 1 && proibidas(desde).length === 0 && /Abate registrad/.test(t), t);
  ok(`abate: A=${a1 + a2 - q1 - q1b - m1 - ab}`, (await total(A)) === a1 + a2 - q1 - q1b - m1 - ab, `${await total(A)}`);
  const corpoAbate = JSON.parse(escritas(desde, /baixa-rebanho/)[0]?.b || '{}');
  ok('abate: corpo com a data retroativa e sem saldo/tenant', /2026-12-17/.test(corpoAbate.data_movimentacao) && !('cliente_id' in corpoAbate), JSON.stringify(corpoAbate).slice(0, 160));

  // ── 4. Mudança de categoria BOI → TOURO (dia 22) ───────────────────────
  await abrirArea(A);
  desde = reqs.length;
  dlg = await formulario('Mudar Categoria', /Confirmar Mudanças/, '2026-12-22');
  await dlg.locator('input[type=number]').first().fill(String(mc));
  await opcao(dlg.getByRole('combobox').nth(1), TOURO);
  await semOverflow('mudança de categoria');
  await enviar(dlg, /Confirmar Mudanças/);
  t = await toasts();
  const touros = (await posicoes()).filter((p) => p.area_atual_id === A.id && p.categoria === TOURO);
  ok(`mudança: 1 POST manejo-rebanho; ${mc} TOURO na mesma linhagem; total de A igual`, escritas(desde, /comandos\/manejo-rebanho/).length === 1 && proibidas(desde).length === 0 && touros.reduce((s, p) => s + p.quantidade_cabecas, 0) === mc && touros.every((p) => [L1.id, L2.id].includes(p.lote_entrada_id)) && (await total(A)) === a1 + a2 - q1 - q1b - m1 - ab, t);
  await page.screenshot({ path: `${OUT}/${BASE}-03-mudanca.png` });

  // ── 5. Pesagem (todos com o mesmo peso, dia 23) ────────────────────────
  await abrirArea(A);
  desde = reqs.length;
  await evento('Pesar');
  dlg = page.getByRole('dialog').last();
  await dlg.getByRole('button', { name: /Registrar Pesagens/ }).waitFor({ timeout: 15000 });
  await dlg.locator('input[type=date]').first().fill('2026-12-23');
  await tocar(dlg.getByRole('button', { name: /Todos \(Mesmo Peso\)/ }));
  await page.waitForTimeout(300);
  await dlg.locator('input[type=number]').first().fill('432.5');
  await semOverflow('pesagem');
  await enviar(dlg, /Registrar Pesagens/);
  t = await toasts();
  const pesadas = (await posicoes()).filter((p) => p.area_atual_id === A.id && p.quantidade_cabecas > 0);
  ok('pesagem: 1 POST; peso 432,5 nas posições de A (série de peso no ledger)', escritas(desde, /comandos\/manejo-rebanho/).length === 1 && proibidas(desde).length === 0 && pesadas.length > 0 && pesadas.every((p) => Number(p.peso_medio_kg) === 432.5), `${t} ${pesadas.map((p) => p.peso_medio_kg).join(',')}`);

  // ── 6. Junção das duas posições BOI (dia 24) ───────────────────────────
  await abrirArea(A);
  desde = reqs.length;
  await evento('Juntar Lotes');
  dlg = page.getByRole('dialog').last();
  await dlg.getByText(/Selecione o lote que receberá|Selecione a categoria/).first().waitFor({ timeout: 15000 });
  const catBoi = dlg.getByRole('button', { name: new RegExp(`^${escapar(BOI.toUpperCase())}`) });
  if (await catBoi.count()) await tocar(catBoi.first());
  await page.waitForTimeout(400);
  await tocar(dlg.getByRole('button', { name: new RegExp(`R1A ${BASE}`) }).first());
  await dlg.getByRole('button', { name: /Confirmar Junção/ }).waitFor({ timeout: 10000 });
  await dlg.locator('input[type=date]').first().fill('2026-12-24');
  await semOverflow('junção');
  await tocar(dlg.getByRole('button', { name: /Confirmar Junção/ }));
  await page.waitForTimeout(4500);
  t = await toasts();
  const bois = (await posicoes()).filter((p) => p.area_atual_id === A.id && p.categoria === BOI && p.quantidade_cabecas > 0);
  ok('junção: 1 POST juncao-lotes; uma posição BOI em A com a linhagem das duas entradas', escritas(desde, /comandos\/juncao-lotes/).length === 1 && proibidas(desde).length === 0 && bois.length === 1 && JSON.stringify(bois[0].linhagem).includes(L2.id), `${t} ${bois.length}`);
  ok('junção: total de A conservado', (await total(A)) === a1 + a2 - q1 - q1b - m1 - ab, `${await total(A)}`);
  await page.screenshot({ path: `${OUT}/${BASE}-04-juncao.png` });

  // ── 7. Nascimento em C (mães VACA) ─────────────────────────────────────
  await abrirArea(C);
  desde = reqs.length;
  dlg = await formulario('Nascimento', /Registrar Nascimentos/, '2026-12-21');
  await dlg.locator('input[type=number]').first().fill(String(n));
  await opcao(dlg.getByRole('combobox').nth(1), 'Macho');
  await semOverflow('nascimento');
  await enviar(dlg, /Registrar Nascimentos/);
  t = await toasts();
  const nascidos = (await posicoes()).filter((p) => p.area_atual_id === C.id && p.origem === 'nascimento');
  ok(`nascimento: 1 POST; posição NASCIDOS com ${n} cab, sem entrada (não é compra)`, escritas(desde, /comandos\/manejo-rebanho/).length === 1 && proibidas(desde).length === 0 && nascidos.reduce((s, p) => s + p.quantidade_cabecas, 0) === n && nascidos.every((p) => p.lote_entrada_id === null), t);
  ok(`nascimento: C=${v + n}`, (await total(C)) === v + n, `${await total(C)}`);
  await page.screenshot({ path: `${OUT}/${BASE}-05-nascimento.png` });

  // ── 7b. R3: morte retroativa de TODAS as matrizes (dia 20) antes do nascimento (dia 21) → recusa, diálogo aberto ─
  const antesC = await total(C);
  await abrirArea(C);
  desde = reqs.length;
  dlg = await formulario('Morte', /Registrar Mortes/, '2026-12-20');
  await opcao(dlg.getByRole('combobox').nth(0), VACA);
  await dlg.locator('input[type=number]').first().fill(String(v));
  await opcao(dlg.getByRole('combobox').nth(1), 'Doença');
  await enviar(dlg, /Registrar Mortes/);
  t = await toasts();
  ok('R3: morte retroativa das matrizes do nascimento → recusa com a data do nascimento, nada gravado', /nascimento do dia 21\/12\/2026 ficaria sem as matrizes/.test(t) && (await total(C)) === antesC && escritas(desde, /baixa-rebanho/).length === 1, t);
  ok('R3: diálogo continua aberto após o 409', await dlg.getByRole('button', { name: /Registrar Mortes/ }).isVisible());
  await page.screenshot({ path: `${OUT}/${BASE}-10-recusa-matrizes.png` });
  await page.keyboard.press('Escape').catch(() => {});

  // ── 8. Morte retroativa em B no dia 19 (B só recebe gado no dia 20) → recusa, nada muda ─
  const antesB = await total(B);
  await abrirArea(B);
  desde = reqs.length;
  dlg = await formulario('Morte', /Registrar Mortes/, '2026-12-17');
  await dlg.locator('input[type=number]').first().fill('1');
  await opcao(dlg.getByRole('combobox').nth(1), 'Doença');
  await enviar(dlg, /Registrar Mortes/);
  t = await toasts();
  ok('morte em B antes de o gado chegar: recusa clara, nada gravado', /Nada foi|nada foi/.test(t) && (await total(B)) === antesB && escritas(desde, /baixa-rebanho/).length === 1, t);
  ok('recusa: diálogo continua aberto', await dlg.getByRole('button', { name: /Registrar Mortes/ }).isVisible());
  await page.screenshot({ path: `${OUT}/${BASE}-06-recusa-retroativa.png` });
  await page.keyboard.press('Escape').catch(() => {});

  // ── 9. Histórico em A + cancelamento da Morte pela UI ──────────────────
  await abrirArea(A);
  await evento('Histórico de Movimentação', 'Históricos');
  const hist = page.getByRole('dialog').last();
  await hist.getByText('Morte', { exact: true }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const histTexto = await hist.innerText();
  ok('histórico de A lista transferência (2), morte, abate, mudança, pesagem e junção', ['Transferência de Área', 'Morte', 'Abate', 'Mudança de Categoria', 'Pesagem', 'Junção de Lotes'].every((x) => histTexto.includes(x)), histTexto.slice(0, 200));
  await page.screenshot({ path: `${OUT}/${BASE}-07-historico.png` });
  const cartao = page.locator('div.rounded-lg, div.rounded-xl, li').filter({ hasText: 'Morte' }).filter({ hasText: '21/12/2026' }).filter({ has: page.getByRole('button', { name: 'Cancelar movimentação' }) }).last();
  await tocar(cartao.getByRole('button', { name: 'Cancelar movimentação' }));
  const dc = page.getByRole('dialog').last();
  await dc.locator('textarea').waitFor({ timeout: 15000 });
  await dc.locator('textarea').fill('Morte lançada por engano (teste E2E R1)');
  await semOverflow('cancelamento');
  await tocar(dc.getByRole('button', { name: 'Confirmar cancelamento' }));
  await page.waitForTimeout(4000);
  ok(`cancelamento da morte pela UI → A=${a1 + a2 - q1 - q1b - ab}`, (await total(A)) === a1 + a2 - q1 - q1b - ab, `${await total(A)}`);

  // ── 9b. Cancelar a PESAGEM (23/12) que alimentou a junção (24/12) → 409 causal na tela, nada muda ─
  const antesCausal = JSON.stringify((await posicoes()).filter((p) => p.area_atual_id === A.id).map((p) => [p.id, p.quantidade_cabecas, p.peso_medio_kg]));
  await abrirArea(A);
  await evento('Histórico de Movimentação', 'Históricos');
  const hist2 = page.getByRole('dialog').last();
  await hist2.getByText('Pesagem', { exact: true }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const cartaoPes = page.locator('div.rounded-lg, div.rounded-xl, li').filter({ hasText: 'Pesagem' }).filter({ hasText: '23/12/2026' }).filter({ has: page.getByRole('button', { name: 'Cancelar movimentação' }) }).last();
  const antesReqCausal = reqs.length;
  await tocar(cartaoPes.getByRole('button', { name: 'Cancelar movimentação' }));
  const dcp = page.getByRole('dialog').last();
  await dcp.getByText(/calculou o peso/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const textoCausal = await dcp.innerText().catch(() => '');
  ok('pré-checagem: sem campo de motivo nem POST de cancelamento', (await dcp.locator('textarea').count()) === 0 && escritas(antesReqCausal, /cancelamento/).length === 0);
  const depoisCausal = JSON.stringify((await posicoes()).filter((p) => p.area_atual_id === A.id).map((p) => [p.id, p.quantidade_cabecas, p.peso_medio_kg]));
  ok('cancelar pesagem com junção posterior dependente: recusa causal explícita (dia 24/12), nada muda', /24\/12\/2026/.test(textoCausal) && /calculou o peso/.test(textoCausal) && antesCausal === depoisCausal, textoCausal.slice(0, 220));
  await page.screenshot({ path: `${OUT}/${BASE}-09-recusa-causal-peso.png` });
  await page.keyboard.press('Escape').catch(() => {});

  // ── 10. Offline: manejo indisponível, sem requisição ───────────────────
  await abrirArea(C);
  dlg = await formulario('Nascimento', /Registrar Nascimentos/, '2026-12-22');
  await dlg.locator('input[type=number]').first().fill('2');
  await opcao(dlg.getByRole('combobox').nth(1), 'Fêmea');
  await toasts();
  const antesOff = reqs.length;
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await enviar(dlg, /Registrar Nascimentos/);
  const tOff = await toasts();
  ok('offline: indisponibilidade explícita, sem requisição de escrita', /Sem conexão/.test(tOff) && reqs.length === antesOff, tOff.slice(0, 160));
  await page.screenshot({ path: `${OUT}/${BASE}-08-offline.png` });
  await ctx.setOffline(false);

  // ── 11. Cadastro intacto + integridade do ledger ───────────────────────
  for (const [l, q, area] of [[L1, a1, A], [L2, a2, A], [V1, v, C]]) {
    const c = await call('GET', `/lotes/${l.id}`);
    ok(`Cadastro ${l.nome}: Lote = entrada (${q} cab, área de entrada), nenhuma escrita de saldo`, c.quantidade_cabecas === q && c.quantidade_entrada === q && c.area_atual_id === area.id && c.status === 'Ativo', JSON.stringify([c.quantidade_cabecas, c.status]));
  }
  const ver = await call('GET', `/rebanho/verificacao?empresa_id=${E}`);
  ok('verificação do ledger: íntegro e conservação fecha', ver.integro === true && ver.conservacao?.conserva === true, JSON.stringify(ver).slice(0, 200));
  ok('sem erro de página', erros.length === 0, erros.join(' ; '));
  await browser.close();
  console.log(res.join('\n'));
  const falhas = res.filter((r) => r.startsWith('FAIL')).length;
  console.log(`RESUMO ${BASE}: ${res.length - falhas}/${res.length} PASS`);
  process.exit(falhas ? 1 : 0);
})().catch(async (e) => { try { await global.__page.screenshot({ path: `${OUT}/${BASE}-ERRO.png` }); } catch {} console.log(res.join('\n')); console.error('ERRO', e.message.split('\n').slice(0, 6).join(' | ')); process.exit(2); });
