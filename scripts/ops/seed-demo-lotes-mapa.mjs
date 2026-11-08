#!/usr/bin/env node
/**
 * Seed local de lotes + áreas para o Mapa Geral e Cadastro de Lotes.
 *
 * Idempotente por chaves estáveis (apelido da fazenda, nomes de setor/área/lote).
 * Usa a API nativa (não Prisma direto) para o ledger abrir PosicaoRebanho.
 *
 * Uso (dev):
 *   DEMO_LOGIN=demo DEMO_SENHA=demo node scripts/ops/seed-demo-lotes-mapa.mjs
 *
 * Variáveis:
 *   MAIKE_API_URL   default http://127.0.0.1:3333
 *   DEMO_LOGIN / DEMO_SENHA
 *   DEMO_EMPRESA_APELIDO  default DEMO
 */

const API = (process.env.MAIKE_API_URL || 'http://127.0.0.1:3333').replace(/\/$/, '');
const LOGIN = process.env.DEMO_LOGIN || 'demo';
const SENHA = process.env.DEMO_SENHA || 'demo';
const APELIDO = process.env.DEMO_EMPRESA_APELIDO || 'DEMO';

const falhar = (m) => {
  console.error(`ops:seed-demo-lotes-mapa — FALHOU\n\n  ${m}\n`);
  process.exit(1);
};

const req = async (method, path, { token, body } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { raw: texto };
  }
  return { status: r.status, json };
};

/** Polígono pequeno perto de Cuiabá (lat, lng), deslocado em graus. */
const poly = (dx, dy = 0, cor = '#22c55e') => ({
  coords: [
    [-15.62 + dy, -56.12 + dx],
    [-15.62 + dy, -56.11 + dx],
    [-15.61 + dy, -56.11 + dx],
    [-15.61 + dy, -56.12 + dx],
  ],
  cor,
});

const AREAS = [
  { nome: 'Pasto Boiadeiro', ha: 42, dx: 0, dy: 0, cor: '#22c55e', tipo_pastagem: 'Braquiária' },
  { nome: 'Pasto Capivara', ha: 38, dx: 0.015, dy: 0, cor: '#16a34a', tipo_pastagem: 'Mombaça' },
  { nome: 'Pasto Lagoa', ha: 55, dx: 0.03, dy: 0, cor: '#15803d', tipo_pastagem: 'Braquiária' },
  { nome: 'Pasto Cedro', ha: 28, dx: 0, dy: 0.012, cor: '#4ade80', tipo_pastagem: 'Colonião' },
  { nome: 'Pasto Figueira', ha: 33, dx: 0.015, dy: 0.012, cor: '#86efac', tipo_pastagem: 'Mombaça' },
  { nome: 'Retiro Sul', ha: 20, dx: 0.03, dy: 0.012, cor: '#a3e635', tipo_pastagem: 'Braquiária' },
];

const LOTES = [
  { nome: 'LOTE NELOR 01', cabecas: 120, area: 'Pasto Boiadeiro', categoria: 'Boi 25 a 36 meses', sexo: 'Macho', peso: 420, cor: '#2563eb' },
  { nome: 'LOTE NELOR 02', cabecas: 95, area: 'Pasto Boiadeiro', categoria: 'Garrote 13 a 24 meses', sexo: 'Macho', peso: 310, cor: '#1d4ed8' },
  { nome: 'LOTE ANGUS 01', cabecas: 80, area: 'Pasto Capivara', categoria: 'Boi 25 a 36 meses', sexo: 'Macho', peso: 450, cor: '#7c3aed' },
  { nome: 'LOTE MATRIZ A', cabecas: 140, area: 'Pasto Capivara', categoria: 'Vaca adulta', sexo: 'Fêmea', peso: 380, cor: '#db2777' },
  { nome: 'LOTE MATRIZ B', cabecas: 110, area: 'Pasto Lagoa', categoria: 'Vaca adulta', sexo: 'Fêmea', peso: 390, cor: '#e11d48' },
  { nome: 'LOTE BEZERROS', cabecas: 75, area: 'Pasto Lagoa', categoria: 'Bezerro até 12 meses', sexo: 'Misto', peso: 180, cor: '#ea580c' },
  { nome: 'LOTE RECRIA 01', cabecas: 130, area: 'Pasto Cedro', categoria: 'Garrote 13 a 24 meses', sexo: 'Macho', peso: 280, cor: '#ca8a04' },
  { nome: 'LOTE RECRIA 02', cabecas: 100, area: 'Pasto Figueira', categoria: 'Novilha 13 a 24 meses', sexo: 'Fêmea', peso: 260, cor: '#65a30d' },
  { nome: 'LOTE ENGORDA', cabecas: 160, area: 'Pasto Figueira', categoria: 'Boi 25 a 36 meses', sexo: 'Macho', peso: 480, cor: '#0891b2' },
  { nome: 'LOTE MISTO SUL', cabecas: 60, area: 'Retiro Sul', categoria: 'Misto', sexo: 'Misto', peso: 320, cor: '#0f766e' },
  { nome: 'LOTE DESMAMA', cabecas: 90, area: 'Retiro Sul', categoria: 'Bezerro até 12 meses', sexo: 'Misto', peso: 160, cor: '#4f46e5' },
  { nome: 'LOTE TOUROS', cabecas: 18, area: 'Pasto Cedro', categoria: 'Touro', sexo: 'Macho', peso: 620, cor: '#334155' },
];

const principal = async () => {
  if (process.env.NODE_ENV === 'production') {
    falhar('recusado em NODE_ENV=production — use só em ambiente local/dev.');
  }

  const login = await req('POST', '/auth/login', { body: { login: LOGIN, senha: SENHA } });
  if (login.status !== 200 || !login.json?.token) {
    falhar(`login falhou (${login.status}): ${JSON.stringify(login.json)}`);
  }
  const token = login.json.token;
  const criados = [];
  const ignorados = [];

  const empresas = await req('GET', '/empresas', { token });
  if (empresas.status !== 200) falhar(`listar empresas: ${empresas.status}`);
  let empresa = (empresas.json || []).find((e) => String(e.apelido).toUpperCase() === APELIDO.toUpperCase());
  if (!empresa) {
    const r = await req('POST', '/empresas', {
      token,
      body: {
        apelido: APELIDO,
        nome: 'Fazenda Demo',
        tipo_pessoa: 'Jurídica',
        fuso_horario: 'America/Cuiaba',
        cidade: 'Cuiabá',
        estado: 'MT',
      },
    });
    if (r.status !== 201 && r.status !== 200) falhar(`criar empresa: ${r.status} ${JSON.stringify(r.json)}`);
    empresa = r.json;
    criados.push(`Empresa ${empresa.apelido}`);
  } else {
    ignorados.push(`Empresa ${empresa.apelido}`);
  }

  const setores = await req('GET', `/setores?empresa_id=${encodeURIComponent(empresa.id)}`, { token });
  if (setores.status !== 200) falhar(`listar setores: ${setores.status} ${JSON.stringify(setores.json)}`);
  const listaSetores = Array.isArray(setores.json) ? setores.json : setores.json?.itens || setores.json?.data || [];
  let setor = listaSetores.find((s) => s.nome === 'Setor Norte');
  if (!setor) {
    const r = await req('POST', '/setores', {
      token,
      body: { empresa_id: empresa.id, nome: 'Setor Norte', tipo: 'Próprio', sigla: 'SN' },
    });
    if (r.status !== 201 && r.status !== 200) falhar(`criar setor: ${r.status} ${JSON.stringify(r.json)}`);
    setor = r.json;
    criados.push(`Setor ${setor.nome}`);
  } else {
    ignorados.push(`Setor ${setor.nome}`);
  }

  const areasResp = await req('GET', `/areas-pastagem?empresa_id=${encodeURIComponent(empresa.id)}`, { token });
  if (areasResp.status !== 200) falhar(`listar áreas: ${areasResp.status} ${JSON.stringify(areasResp.json)}`);
  const listaAreas = Array.isArray(areasResp.json) ? areasResp.json : areasResp.json?.itens || areasResp.json?.data || [];
  const porNome = new Map(listaAreas.map((a) => [a.nome, a]));

  for (const a of AREAS) {
    if (porNome.has(a.nome)) {
      ignorados.push(`Área ${a.nome}`);
      continue;
    }
    const r = await req('POST', '/areas-pastagem', {
      token,
      body: {
        empresa_id: empresa.id,
        setor_id: setor.id,
        nome: a.nome,
        tamanho_hectares: a.ha,
        tipo_cultura: 'Pastagem',
        tipo_pastagem: a.tipo_pastagem,
        aproveitamento_classificacao: 'Média',
        cor: a.cor,
        coordenadas: poly(a.dx, a.dy, a.cor),
        ativo: true,
      },
    });
    if (r.status !== 201 && r.status !== 200) falhar(`criar área ${a.nome}: ${r.status} ${JSON.stringify(r.json)}`);
    porNome.set(a.nome, r.json);
    criados.push(`Área ${a.nome}`);
  }

  const lotesResp = await req('GET', `/lotes?empresa_id=${encodeURIComponent(empresa.id)}`, { token });
  if (lotesResp.status !== 200) falhar(`listar lotes: ${lotesResp.status} ${JSON.stringify(lotesResp.json)}`);
  const listaLotes = Array.isArray(lotesResp.json) ? lotesResp.json : lotesResp.json?.itens || lotesResp.json?.data || [];
  const lotePorNome = new Set(listaLotes.map((l) => l.nome));

  const hoje = new Date();
  const dataEntrada = new Date(hoje.getFullYear(), hoje.getMonth(), Math.max(1, hoje.getDate() - 10))
    .toISOString()
    .slice(0, 10);

  for (const l of LOTES) {
    if (lotePorNome.has(l.nome)) {
      ignorados.push(`Lote ${l.nome}`);
      continue;
    }
    const area = porNome.get(l.area);
    if (!area) falhar(`área '${l.area}' não encontrada para o lote ${l.nome}`);
    const r = await req('POST', '/lotes', {
      token,
      body: {
        empresa_id: empresa.id,
        nome: l.nome,
        quantidade_cabecas: l.cabecas,
        motivo_entrada: 'Compra',
        status: 'Ativo',
        setor_id: setor.id,
        area_entrada_id: area.id,
        area_atual_id: area.id,
        data_entrada: dataEntrada,
        categoria: l.categoria,
        sexo: l.sexo,
        peso_medio_kg: l.peso,
        identificador_nome: l.nome.replace(/^LOTE\s+/, ''),
        identificador_sigla: l.nome.split(/\s+/).slice(-1)[0].slice(0, 4),
        identificador_cor: l.cor,
      },
    });
    if (r.status !== 201 && r.status !== 200) falhar(`criar lote ${l.nome}: ${r.status} ${JSON.stringify(r.json)}`);
    criados.push(`Lote ${l.nome} (${l.cabecas} cab → ${l.area})`);
  }

  const pos = await req('GET', `/rebanho/posicoes?empresa_id=${encodeURIComponent(empresa.id)}`, { token });
  const nPos = Array.isArray(pos.json) ? pos.json.length : pos.json?.itens?.length ?? '?';

  console.log('ops:seed-demo-lotes-mapa — concluído\n');
  console.log(`  API: ${API}`);
  console.log(`  Login: ${LOGIN}`);
  console.log(`  Empresa: ${empresa.nome} (${empresa.id})`);
  console.log(`  Posições no mapa: ${nPos}\n`);
  if (criados.length) {
    console.log('  Criados:');
    for (const c of criados) console.log(`    + ${c}`);
  }
  if (ignorados.length) {
    console.log('  Já existiam:');
    for (const i of ignorados) console.log(`    · ${i}`);
  }
};

await principal().catch((e) => falhar(e instanceof Error ? e.message : String(e)));
