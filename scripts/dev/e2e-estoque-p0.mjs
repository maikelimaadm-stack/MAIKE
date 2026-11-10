#!/usr/bin/env node
/**
 * D-PROD-161 (MAIKE-ESTOQUE-P0-01) — PROVA DE USO REAL do motor físico único.
 *
 * No padrão de `e2e-lancamentos-real.mjs`: sobe o backend Fastify REAL
 * (`backend/src/server.js`) contra um PostgreSQL LOCAL, sobe o Vite apontando
 * para ele e conduz as telas reais pelo Playwright (Chromium com WebGL por
 * SwiftShader, porque o Mapa Geral é MapLibre). Depois de cada passo confere o
 * estado NO BANCO (Prisma): lotes, movimentos, fatias, `estoque_atual`.
 *
 * Interação humana real: clique no desktop, TOQUE (`locator.tap`, contexto com
 * `hasTouch`) no celular e teclado de verdade. Sem `dispatchEvent`, sem
 * `force`, sem remover camadas e sem CSS de teste.
 *
 * Cada largura (padrão 1280, 390 e 412 px) usa um tenant próprio, semeado por
 * Prisma SEM saldo: administrador real, empresa (fuso America/Sao_Paulo),
 * fornecedor e cliente, naturezas DESPESA e RECEITA, setor, pasto com
 * polígono, lote de 40 cabeças no pasto, locais "DEPÓSITO CENTRAL" e
 * "DEPÓSITO RETIRO", produto "RAÇÃO PROTEICA P0" (Nutrição Animal, KG) com
 * `estoque_atual = 0` e nenhum lote, produto "NÚCLEO SACO P0" (SACO de 30 kg),
 * um depósito de suplementação no DEPÓSITO CENTRAL e um cocho no pasto ligado
 * a esse depósito.
 *
 * Os 8 passos, em cada largura (nenhum é pulado):
 *   1. ENTRADA: 4 compras confirmadas pela API financeira REAL — CENTRAL:
 *      L1 100 kg @2,00 (dia −20) e L2 200 kg @3,50 (dia −10); RETIRO:
 *      B1 20 kg @5,00 (dia −15) e B2 30 kg @4,00 (dia −5). Cada compra cria
 *      1 movimento de Entrada + 1 camada com o custo e a data do documento;
 *      o cache só nasce delas (0 → 350).
 *   2. SUPLEMENTAÇÃO pela tela (Mapa → cocho → Lançar, 120 kg): FIFO em 2
 *      camadas (100 @2 + 20 @3,5 = 270; unitário 2,25), `lotes_consumidos`,
 *      número definitivo, evento do cocho ligado ao movimento; cache 230.
 *   3. TRANSFERÊNCIA física pela tela (Mapa → depósito → Saída, 50 kg para o
 *      RETIRO). "Local de Destino" escolhido por toque/clique na folha (ou no
 *      painel do desktop), com prova de camada: a folha nasce DENTRO do
 *      diálogo, ninguém acima está aria-hidden, o hit-test do centro da opção
 *      cai na opção, a folha ocupa a largura e o pé da tela, Escape fecha só a
 *      folha (foco volta ao campo) e o teclado abre/fecha. A escolha chega ao
 *      CORPO HTTP do comando (capturado). No banco: par Saída/Entrada
 *      pai/filho e números n/n+1, camada de destino 50 @3,5000 com a MESMA
 *      `data_documento` e procedência da origem, `lote_destino_id` na fatia,
 *      saldos CENTRAL 130 / RETIRO 100, total e cache iguais.
 *   4. VENDA FIFO no destino pela API financeira REAL (60 kg do RETIRO): a
 *      camada transferida (data −10) entra entre B1 (−15) e B2 (−5) — fatias
 *      [B1 20 @5, T 40 @3,5] = 240 (unitário 4,0000). Com a data errada da
 *      camada transferida o resultado seria outro (ano 2001: T primeiro, 225;
 *      data de hoje: T por último, 255).
 *   5. CANCELAR a compra L1 (consumida pela suplementação) → 409
 *      ESTOQUE_JA_CONSUMIDO `lote_consumido` {lote, 100, 0}; elegibilidade
 *      aponta a suplementação; a foto do tenant fica IGUAL.
 *   6. ESCRITA DIRETA recusada: POST genérico de movimento e de lote → 409
 *      ESTOQUE_ESCRITA_DIRETA_RECUSADA; PATCH de `estoque_atual` → 422; foto,
 *      sequência e auditoria iguais.
 *   7. PRODUTO pela tela: aviso fixo na consulta, edição e "Novo"; nenhum
 *      campo de saldo; edição informativa (descrição e preço digitados tecla a
 *      tecla) sem `estoque_atual` no PATCH e sem mexer em lote/custo/cache;
 *      máscaras: o GRAVADO é o EXIBIDO (digitação e colagem), inclusive o Peso
 *      por saco do NÚCLEO, e uma compra planejada depois em SACO usa esse
 *      fator (`fator_kg`, kg = sacos × peso).
 *   8. RECONCILIAÇÃO somente leitura: cobertura completa, situação
 *      CONSISTENTE, 0 achados, nada gravado.
 *   Em toda captura: sem rolagem horizontal da página nem diálogo fora da
 *   tela. Toda resposta ≥ 400 vista pelas telas é divergência; nenhuma
 *   resposta 5xx em lugar nenhum (telas e API).
 *
 * Uso:
 *   DATABASE_URL=postgresql://…@localhost:5433/maike_p0_e2e \
 *     node scripts/dev/e2e-estoque-p0.mjs [pasta-das-capturas]
 * Variáveis opcionais: E2E_API_PORT (3981), E2E_WEB_PORT (5289),
 * E2E_LARGURAS ("1280,390,412"). O banco precisa estar migrado
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
const LARGURAS = String(process.env.E2E_LARGURAS || '1280,390,412')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 320);
fs.mkdirSync(OUT, { recursive: true });

const DATABASE_URL = exigirBancoLocal();
const SENHA = 'senha-e2e-estoque-p0-1';
const AVISO = 'Estoque é alterado em Entradas/Movimentações, não no Cadastro de Produtos';
const TOTAL_PASSOS = 8;

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
/** Evidência por largura (vai para `evidencias.json` na pasta das capturas). */
const evidencias = {};
const anotar = (rotulo, chave, valor) => {
  (evidencias[rotulo] ??= {})[chave] = valor;
  console.log(`  [${rotulo}] ${chave}: ${JSON.stringify(valor)}`);
};

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
const loteDe = (s, id) => prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s.cliente_id, id } });
/** Foto dos lotes e do cache do produto (prova de "nada mudou" no estoque). */
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
const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
/** TODAS as linhas das tabelas que uma recusa poderia tocar, do tenant (prova de "nada gravado"). */
const MODELOS_FOTO = [
  'operacaoFinanceira', 'operacaoFinanceiraItem', 'operacaoFinanceiraConsumoLote', 'tituloFinanceiro', 'operacaoIdempotente',
  'produto', 'estoqueLoteNota', 'movimentacaoEstoque', 'auditLog', 'entidadeCodigoSequencia',
];
const fotoTenant = async (s) => {
  const out = {};
  for (const m of MODELOS_FOTO) out[m] = await prisma[m].findMany({ where: { cliente_id: s.cliente_id }, orderBy: { id: 'asc' } });
  return JSON.stringify(out, replacer);
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
/** Toda resposta da API vista pelo roteiro (fora das telas): nenhuma pode ser 5xx. */
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
  const loginDono = `dono-p0-${rotulo}-${sufixo}`;
  const senhaHash = await gerarSenhaHash(SENHA);
  const s = await prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.create({ data: { codigo: `e2e-est-p0-${rotulo}-${sufixo}`, nome: `FAZENDA ESTOQUE P0 ${rotulo}` } });
    const c = cliente.id;
    await tx.usuario.create({ data: { cliente_id: c, nome: 'DONO DA FAZENDA', login: loginDono, senha_hash: senhaHash, papel_tenant: 'administrador' } });
    const empresa = await tx.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'SEDE', nome: 'FAZENDA SANTA FÉ', fuso_horario: FUSO } });
    const base = { cliente_id: c, empresa_id: empresa.id };
    const fornecedor = await tx.fornecedor.create({ data: { ...base, numero_cadastro: '1', tipo_pessoa: 'Jurídica', nome: 'NUTRIÇÃO ANIMAL CERRADO', tipos: ['fornecedor'] } });
    const comprador = await tx.fornecedor.create({ data: { ...base, numero_cadastro: '2', tipo_pessoa: 'Jurídica', nome: 'FAZENDA VIZINHA COMPRADORA', tipos: ['cliente'] } });
    const natureza = await tx.naturezaFinanceira.create({ data: { ...base, numero: '1', tipo: 'DESPESA', nome: 'SUPLEMENTOS' } });
    const receita = await tx.naturezaFinanceira.create({ data: { ...base, numero: '2', tipo: 'RECEITA', nome: 'VENDA DE INSUMOS' } });
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
    // Só para a prova das máscaras e do fator SACO→KG (passo 7): sem lote, sem cache.
    const nucleo = await tx.produto.create({
      data: {
        ...base,
        numero_produto: '2',
        nome_produto: 'NÚCLEO SACO P0',
        tipo_uso: 'Outros',
        codigo_interno: 'NS0',
        categoria: categoria.nome,
        unidade_medida: 'KG',
        unidade_principal_estoque: 'SACO',
        peso_por_saco_kg: '30.0000',
        local_estoque: localA.nome,
        preco_custo: '0.0000',
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
      comprador: { id: comprador.id },
      natureza: { id: natureza.id },
      receita: { id: receita.id },
      area: { id: area.id, nome: area.nome },
      localA: { id: localA.id, nome: localA.nome },
      localB: { id: localB.id, nome: localB.nome },
      produto: { id: produto.id, nome: produto.nome_produto },
      nucleo: { id: nucleo.id, nome: nucleo.nome_produto },
      deposito: { id: deposito.id, nome: deposito.nome_ponto },
      cocho: { id: cocho.id, nome: cocho.nome_ponto },
    };
  });
  return s;
};

/** Documento financeiro com produtos (compra PAGAR ou venda RECEBER) no formato da API real. */
const documento = (s, { direcao, kg, preco, total, dia, doc, local, produto = s.produto, unidade = 'KG' }) => ({
  empresa_id: s.empresa.id,
  direcao,
  conteudo: 'COM_PRODUTOS',
  condicao: 'PRAZO',
  parceiro_id: direcao === 'PAGAR' ? s.fornecedor.id : s.comprador.id,
  data_emissao: dia,
  data_operacional: dia,
  documento_referencia: doc,
  efeito_fisico_confirmado: true,
  itens: [{ tipo_item: 'MERCADORIA', produto_id: produto.id, local_estoque_id: local.id, unidade, quantidade: kg, valor_unitario: preco }],
  rateio_modo: 'PERCENTUAL',
  rateios: [{ natureza_id: direcao === 'PAGAR' ? s.natureza.id : s.receita.id, percentual: '100' }],
  parcelas: [{ vencimento: somarDias(hojeEm(FUSO), 30), valor: total }],
  operation_id: randomUUID(),
});
/** Cria e confirma pela API real (o motor grava movimento, lote/fatias e cache). Devolve o documento e o item gravado. */
const criarConfirmar = async (s, token, dados) => {
  const criado = await api(token, 'POST', '/operacoes-financeiras', documento(s, dados));
  exigir(criado.status === 201, `${dados.doc}: criar ${criado.status} ${JSON.stringify(criado.corpo).slice(0, 300)}`);
  const conf = await api(token, 'POST', `/operacoes-financeiras/${criado.corpo.id}/confirmar`, {
    empresa_id: s.empresa.id,
    operation_id: randomUUID(),
    versao: criado.corpo.versao,
  });
  exigir(conf.status === 200, `${dados.doc}: confirmar ${conf.status} ${JSON.stringify(conf.corpo).slice(0, 300)}`);
  const item = await prisma.operacaoFinanceiraItem.findFirst({ where: { cliente_id: s.cliente_id, operacao_id: criado.corpo.id } });
  return { op: conf.corpo, item };
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
  /** Estado entre os passos (ids das camadas, compra, suplementação, camada transferida). */
  const st = {};
  let n = 0;

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
  // Colagem real (Ctrl+V) no passo 7: área de transferência do Chromium.
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
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

  /** Toque (celular) ou clique (desktop) real, com hit-test do Playwright; na falha, captura e diz QUAL ação. */
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
  const escritasGenericas = (desde) =>
    escritas
      .slice(desde)
      .filter((e) => /\/(movimentacoes-estoque|estoque-lotes-nota|produtos)(\/[^/]+)?$/.test(e.url.split('?')[0]))
      .map((e) => `${e.metodo} ${e.url}`)
      .join(', ');

  // ── Mapa Geral (toque/clique real no marcador do MapLibre) ────────────────
  const abrirMapa = async () => {
    await page.goto(`${WEB}/MapaGeral`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.maplibregl-canvas', { timeout: 45000 });
    await page.locator(`.mg-marker[title="${s.cocho.nome}"]`).waitFor({ state: 'visible', timeout: 45000 });
    await page.locator(`.mg-marker[title="${s.deposito.nome}"]`).waitFor({ state: 'visible', timeout: 45000 });
    await page.waitForTimeout(1500);
  };
  const abrirPonto = async (nome, tituloDialogo) => {
    await toque(page.locator(`.mg-marker[title="${nome}"]`).first(), `marcador ${nome}`);
    await page.getByText(tituloDialogo, { exact: true }).first().waitFor({ state: 'visible' });
    await page.getByText(nome).filter({ visible: true }).first().waitFor();
    await page.waitForTimeout(800);
  };

  try {
    // ── 1. ENTRADA: compras confirmadas pela API financeira real ─────────────
    await passo('1 Entrada: 4 compras pela API financeira real criam camadas, custo, movimento e cache (o cadastro não credita)', async () => {
      igual(await cacheDe(s), '0.0000', `[${rotulo}] produto recém-cadastrado nasce com estoque 0`);
      igual((await lotesDoProduto(s)).length, 0, `[${rotulo}] produto recém-cadastrado não tem camada`);
      const perfil = await api(token, 'PUT', '/perfis-financeiros-empresa', { empresa_id: s.empresa.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' });
      exigir(perfil.status === 200, `[${rotulo}] perfil financeiro: ${perfil.status} ${JSON.stringify(perfil.corpo).slice(0, 200)}`);
      const compras = [
        ['L1', { kg: '100', preco: '2.00', total: '200.00', dia: somarDias(hoje, -20), doc: 'NF-P0-1', local: s.localA }, '200.0000'],
        ['L2', { kg: '200', preco: '3.50', total: '700.00', dia: somarDias(hoje, -10), doc: 'NF-P0-2', local: s.localA }, '700.0000'],
        ['B1', { kg: '20', preco: '5.00', total: '100.00', dia: somarDias(hoje, -15), doc: 'NF-P0-3', local: s.localB }, '100.0000'],
        ['B2', { kg: '30', preco: '4.00', total: '120.00', dia: somarDias(hoje, -5), doc: 'NF-P0-4', local: s.localB }, '120.0000'],
      ];
      for (const [nome, dados, valor] of compras) {
        const { op, item } = await criarConfirmar(s, token, { ...dados, direcao: 'PAGAR' });
        exigir(item?.estoque_lote_nota_id && item?.movimentacao_estoque_id, `[${rotulo}] ${dados.doc}: item sem camada ou movimento`);
        const lote = await loteDe(s, item.estoque_lote_nota_id);
        const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: item.movimentacao_estoque_id } });
        const kg = `${Number(dados.kg).toFixed(0)}.0000`;
        igual(
          [d4(lote.quantidade_entrada), d4(lote.quantidade_disponivel), d4(lote.custo_unitario), lote.status, lote.local_estoque_id === dados.local.id, diaDe(lote.data_documento)].join(':'),
          [kg, kg, `${dados.preco}00`, 'Disponivel', true, dados.dia].join(':'),
          `[${rotulo}] camada ${nome} da compra ${dados.doc}`,
        );
        igual(
          [mov.tipo_movimentacao, mov.tipo_detalhado, d4(mov.quantidade), d4(mov.valor_total), lote.movimentacao_entrada_id === mov.id].join(':'),
          ['Entrada', 'compra_financeiro', kg, valor, true].join(':'),
          `[${rotulo}] movimento de Entrada da compra ${dados.doc}`,
        );
        st[nome] = lote.id;
        if (nome === 'L1') st.compraL1 = op.id;
      }
      igual(await cacheDe(s), '350.0000', `[${rotulo}] estoque_atual depois das compras (só ENTRADA credita)`);
      igual(await somaDisponivel(s), '350.0000', `[${rotulo}] Σ camadas depois das compras (I1)`);
      igual(await somaDisponivel(s, { local_estoque_id: s.localA.id }), '300.0000', `[${rotulo}] saldo do DEPÓSITO CENTRAL`);
      igual(await somaDisponivel(s, { local_estoque_id: s.localB.id }), '50.0000', `[${rotulo}] saldo do DEPÓSITO RETIRO`);
    });

    // ── 2. Suplementação de cocho pela tela ──────────────────────────────────
    await passo('2 Suplementação: Mapa → cocho → Lançar 120 kg pela tela (FIFO em 2 camadas pelo motor)', async () => {
      exigir(st.L1 && st.L2, `[${rotulo}] sem as camadas do passo 1`);
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
      await toque(kg, 'campo kg da suplementação');
      await page.keyboard.type('120', { delay: 40 });
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
      const nomeLote = (id) => ({ [st.L1]: 'L1', [st.L2]: 'L2', [st.B1]: 'B1', [st.B2]: 'B2' })[id] ?? id;
      igual(
        JSON.stringify((mov.lotes_consumidos || []).map((f) => [nomeLote(f.lote_id), f.quantidade, f.custo_unitario])),
        JSON.stringify([['L1', '100.0000', '2.0000'], ['L2', '20.0000', '3.5000']]),
        `[${rotulo}] lotes_consumidos da suplementação`,
      );
      const l1 = await loteDe(s, st.L1);
      const l2 = await loteDe(s, st.L2);
      igual(`${d4(l1.quantidade_disponivel)}:${l1.status}|${d4(l2.quantidade_disponivel)}:${l2.status}`, '0.0000:Esgotado|180.0000:Disponivel', `[${rotulo}] camadas depois da suplementação`);
      igual(await cacheDe(s), '230.0000', `[${rotulo}] estoque_atual depois da suplementação`);
      igual(await somaDisponivel(s), '230.0000', `[${rotulo}] Σ camadas depois da suplementação (I1)`);
      igual(await prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, produto_id: s.produto.id } }), movsAntes + 1, `[${rotulo}] movimentos novos da suplementação`);
      const evento = await esperarBanco(
        async () => (await prisma.suplementacaoEvento.findMany({ where: { cliente_id: s.cliente_id } })).find((e) => e.dados?.movimentacao_estoque_id === movId) || null,
        'evento do cocho ligado ao movimento',
      );
      igual(`${evento.dados.ponto_suplementacao_id}:${evento.dados.quantidade_total_kg}`, `${s.cocho.id}:120`, `[${rotulo}] evento de suplementação`);
      igual(escritasGenericas(desde), '', `[${rotulo}] escrita genérica de estoque disparada pela tela`);
      st.suplementacao = { id: mov.id, numero: mov.numero_movimentacao };
      await page.keyboard.press('Escape').catch(() => {});
      await shot('cocho-apos-lancamento');
    });

    // ── 3. Transferência física pela tela ────────────────────────────────────
    await passo('3 Transferência: Mapa → depósito → Saída de 50 kg para o DEPÓSITO RETIRO pela tela (destino escolhido por toque/clique)', async () => {
      exigir(st.L2 && st.suplementacao, `[${rotulo}] sem o estado dos passos 1 e 2`);
      const l2Antes = await loteDe(s, st.L2);
      const totalAntes = await somaDisponivel(s);
      const cacheAntes = await cacheDe(s);
      await abrirMapa();
      await abrirPonto(s.deposito.nome, 'Depósito de Suplementação');
      await shot('deposito-detalhes');
      await toque(page.getByRole('button', { name: 'Saída', exact: true }).filter({ visible: true }).first(), 'Saída do depósito');
      const dlg = page.getByRole('dialog').filter({ hasText: 'Saída do Depósito' }).last();
      await dlg.getByRole('button', { name: 'Salvar', exact: true }).waitFor({ state: 'visible' });
      const campoLocal = dlg.locator('input[placeholder="BUSCAR LOCAL..."]').first();
      const opcaoDestino = page.getByRole('option', { name: new RegExp(s.localB.nome) }).filter({ visible: true }).first();
      const vp = page.viewportSize();
      // O diálogo continua centralizado (no celular sem transform, para a folha ocupar a tela).
      const caixa = await dlg.boundingBox();
      anotar(rotulo, 'dialogo_transferencia', { x: Math.round(caixa.x), y: Math.round(caixa.y), w: Math.round(caixa.width), h: Math.round(caixa.height), vw: vp.width, vh: vp.height });
      conferir(Math.abs(caixa.x + caixa.width / 2 - vp.width / 2) <= 2 && Math.abs(caixa.y + caixa.height / 2 - vp.height / 2) <= 2, `[${rotulo}] diálogo da transferência fora do centro: ${JSON.stringify(caixa)}`);
      /** Prova de camada da lista aberta: onde nasceu, quem está por cima do centro da opção, foco, geometria. */
      const provaCamada = () =>
        page.evaluate((nome) => {
          const o = [...document.querySelectorAll('[role="option"]')].find((x) => x.textContent.includes(nome));
          if (!o) return { existe: false };
          const r = o.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const dlgs = [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.textContent.includes('Saída do Depósito') && d.querySelector('h2'));
          const dlgT = dlgs.pop();
          const folha = o.closest('.mk-sheet');
          const fr = folha?.getBoundingClientRect();
          let pe = '';
          for (let x = o; x && !pe; x = x.parentElement) pe = x.style?.pointerEvents || '';
          return {
            existe: true,
            dentroDoDialogo: !!(dlgT && dlgT.contains(o)),
            ariaHidden: !!o.closest('[aria-hidden="true"]'),
            hitNaOpcao: !!(el && o.contains(el)),
            pointerEventsCamada: pe || 'auto',
            focoNaLista: !!(document.activeElement && (folha ?? o.closest('[role="listbox"]'))?.contains(document.activeElement)),
            folha: fr ? { l: Math.round(fr.left), r: Math.round(fr.right), b: Math.round(fr.bottom), w: Math.round(fr.width) } : null,
            vw: window.innerWidth,
            vh: window.innerHeight,
          };
        }, s.localB.nome);
      const focoNoCampo = () => campoLocal.evaluate((el) => document.activeElement === el);
      if (movel) {
        // (a) toque abre a folha; prova de camada antes de tocar na opção.
        await toque(campoLocal, 'abrir local de destino');
        await opcaoDestino.waitFor({ state: 'visible' });
        const prova = await provaCamada();
        anotar(rotulo, 'folha_local_destino', prova);
        await shot('folha-local-destino');
        exigir(prova.existe && prova.dentroDoDialogo && !prova.ariaHidden && prova.hitNaOpcao && prova.pointerEventsCamada !== 'none', `[${rotulo}] folha "Local de Destino" fora da camada de cima do diálogo: ${JSON.stringify(prova)}`);
        conferir(prova.focoNaLista, `[${rotulo}] o foco não entrou na folha ao abrir`);
        conferir(prova.folha && prova.folha.l <= 0 && prova.folha.r >= prova.vw && prova.folha.b >= prova.vh - 1, `[${rotulo}] a folha não ocupa a largura e o pé da tela (presa no cartão do diálogo?): ${JSON.stringify(prova.folha)}`);
        // (b) Escape fecha SÓ a folha; o diálogo fica e o foco volta ao campo.
        await page.keyboard.press('Escape');
        await opcaoDestino.waitFor({ state: 'hidden' });
        conferir(await dlg.isVisible(), `[${rotulo}] Escape na folha fechou o diálogo da transferência`);
        conferir(await focoNoCampo(), `[${rotulo}] o foco não voltou ao campo "Local de Destino" depois do Escape`);
        await shot('folha-escape');
        // (c) teclado: Enter no campo abre, o foco entra; Escape fecha de novo.
        await page.keyboard.press('Enter');
        await opcaoDestino.waitFor({ state: 'visible' });
        conferir((await provaCamada()).focoNaLista, `[${rotulo}] Enter abriu a folha, mas o foco não entrou nela`);
        await page.keyboard.press('Escape');
        await opcaoDestino.waitFor({ state: 'hidden' });
        conferir(await dlg.isVisible(), `[${rotulo}] o segundo Escape (teclado) fechou o diálogo`);
        // (d) toque real na opção escolhe.
        await toque(campoLocal, 'reabrir local de destino');
        await toque(opcaoDestino, 'escolher DEPÓSITO RETIRO');
      } else {
        // Desktop: painel (Radix Popover) — Escape fecha só o painel; clique escolhe.
        await toque(campoLocal, 'abrir local de destino');
        await opcaoDestino.waitFor({ state: 'visible' });
        const prova = await provaCamada();
        anotar(rotulo, 'painel_local_destino', prova);
        exigir(prova.existe && !prova.ariaHidden && prova.hitNaOpcao, `[${rotulo}] painel "Local de Destino" inacessível: ${JSON.stringify(prova)}`);
        await page.keyboard.press('Escape');
        await opcaoDestino.waitFor({ state: 'hidden' });
        conferir(await dlg.isVisible(), `[${rotulo}] Escape no painel fechou o diálogo da transferência`);
        await toque(campoLocal, 'reabrir local de destino');
        await toque(opcaoDestino, 'escolher DEPÓSITO RETIRO');
      }
      await opcaoDestino.waitFor({ state: 'hidden' });
      conferir(await dlg.isVisible(), `[${rotulo}] escolher o destino fechou o diálogo`);
      igual(await campoLocal.inputValue(), s.localB.nome, `[${rotulo}] campo "Local de Destino" depois da escolha`);
      igual((await dlg.getByText(/^Destino:/).first().innerText()).replace(/\s+/g, ' ').trim(), `Destino: ${s.localB.nome}`, `[${rotulo}] resumo do destino no formulário`);
      await shot('destino-escolhido');
      await toque(dlg.getByRole('combobox').first(), 'abrir produto da transferência');
      await toque(page.getByRole('option', { name: new RegExp(s.produto.nome) }).filter({ visible: true }).first(), 'escolher produto da transferência');
      await dlg.getByText('180,000').first().waitFor({ state: 'visible' }).catch(() => {});
      const saldoTela = await dlg.getByText(/Saldo \(kg\):/).first().innerText();
      conferir(/180/.test(saldoTela.replace(/\./g, '')), `[${rotulo}] saldo do DEPÓSITO CENTRAL na transferência não mostra 180 kg: "${saldoTela}"`);
      const qtd = dlg.locator('input[type="number"]').first();
      await toque(qtd, 'campo quantidade da transferência');
      await page.keyboard.type('50', { delay: 40 });
      await shot('transferencia-preenchida');
      const t0 = await nToasts();
      const desde = escritas.length;
      const resp = page.waitForResponse((r) => /comandos\/transferencia-locais/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
      await toque(dlg.getByRole('button', { name: 'Salvar', exact: true }), 'Salvar transferência');
      const rt = await resp;
      igual(rt.status(), 201, `[${rotulo}] comando de transferência pela tela`);
      const corpoResp = await rt.json().catch(() => ({}));
      await esperarBanco(async () => /Transferência registrada/i.test(await toastsDesde(t0)), 'toast de sucesso da transferência');
      // A escolha feita na folha/painel chegou ao CORPO HTTP do comando.
      const enviado = escritas.slice(desde).find((e) => /transferencia-locais/.test(e.url));
      exigir(enviado, `[${rotulo}] o POST do comando de transferência não foi capturado`);
      const corpoEnviado = JSON.parse(enviado.corpo || '{}');
      anotar(rotulo, 'corpo_http_transferencia', { url: enviado.url, local_origem_id: corpoEnviado.local_origem_id === s.localA.id ? 'CENTRAL' : corpoEnviado.local_origem_id, local_destino_id: corpoEnviado.local_destino_id === s.localB.id ? 'RETIRO' : corpoEnviado.local_destino_id, quantidade: corpoEnviado.quantidade, produto_id: corpoEnviado.produto_id === s.produto.id ? 'RAÇÃO' : corpoEnviado.produto_id });
      igual(`${corpoEnviado.quantidade}:${corpoEnviado.local_origem_id === s.localA.id}:${corpoEnviado.local_destino_id === s.localB.id}:${corpoEnviado.produto_id === s.produto.id}`, '50:true:true:true', `[${rotulo}] corpo HTTP do comando de transferência`);
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
      const destino = await prisma.estoqueLoteNota.findMany({ where: { cliente_id: s.cliente_id, produto_id: s.produto.id, movimentacao_entrada_id: entrada.id } });
      exigir(destino.length === 1, `[${rotulo}] esperado 1 camada criada pela Entrada da transferência, obtido ${destino.length}`);
      const T = destino[0];
      igual(
        [d4(T.quantidade_entrada), d4(T.quantidade_disponivel), d4(T.custo_unitario), T.status, T.local_estoque_id === s.localB.id, T.local_estoque_nome].join(':'),
        `50.0000:50.0000:3.5000:Disponivel:true:${s.localB.nome}`,
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
        JSON.stringify((saida.lotes_consumidos || []).map((f) => [f.lote_id === st.L2 ? 'L2' : f.lote_id, f.quantidade, f.custo_unitario, f.lote_destino_id === T.id])),
        JSON.stringify([['L2', '50.0000', '3.5000', true]]),
        `[${rotulo}] lotes_consumidos da Saída com lote_destino_id (linhagem)`,
      );
      const l2 = await loteDe(s, st.L2);
      igual(`${d4(l2.quantidade_disponivel)}:${l2.status}`, '130.0000:Disponivel', `[${rotulo}] camada de origem depois da transferência`);
      igual(await somaDisponivel(s), totalAntes, `[${rotulo}] total global conservado`);
      igual(await somaDisponivel(s, { local_estoque_id: s.localA.id }), '130.0000', `[${rotulo}] saldo do DEPÓSITO CENTRAL (origem cai 50)`);
      igual(await somaDisponivel(s, { local_estoque_id: s.localB.id }), '100.0000', `[${rotulo}] saldo do DEPÓSITO RETIRO (destino sobe 50)`);
      igual(await cacheDe(s), cacheAntes, `[${rotulo}] estoque_atual não muda na transferência`);
      igual(escritasGenericas(desde), '', `[${rotulo}] escrita genérica de estoque disparada pela tela`);
      st.T = T.id;
      await page.waitForTimeout(800);
      await shot('deposito-apos-transferencia');
    });

    // ── 4. Venda FIFO no destino (API financeira real) ───────────────────────
    await passo('4 Venda FIFO no DEPÓSITO RETIRO pela API financeira real: a camada transferida entra na ordem da data de origem', async () => {
      exigir(st.T && st.B1 && st.B2, `[${rotulo}] sem a camada transferida do passo 3`);
      const antes = await fotoEstoque(s);
      const { item } = await criarConfirmar(s, token, { direcao: 'RECEBER', kg: '60', preco: '9.00', total: '540.00', dia: hoje, doc: 'PED-P0-1', local: s.localB });
      exigir(item?.movimentacao_estoque_id, `[${rotulo}] venda sem movimento de Saída`);
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: item.movimentacao_estoque_id } });
      const nomeLote = (id) => ({ [st.B1]: 'B1', [st.B2]: 'B2', [st.T]: 'T', [st.L2]: 'L2' })[id] ?? id;
      igual(
        [mov.tipo_movimentacao, d4(mov.quantidade), d4(mov.valor_total), d4(mov.valor_unitario), mov.local_estoque_origem === s.localB.id].join(':'),
        'Saída:60.0000:240.0000:4.0000:true',
        `[${rotulo}] Saída da venda (custo FIFO do destino)`,
      );
      igual(
        JSON.stringify((mov.lotes_consumidos || []).map((f) => [nomeLote(f.lote_id), f.quantidade, f.custo_unitario])),
        JSON.stringify([['B1', '20.0000', '5.0000'], ['T', '40.0000', '3.5000']]),
        `[${rotulo}] fatias da venda em lotes_consumidos (ordem FIFO por data de documento)`,
      );
      const fatias = await prisma.operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: s.cliente_id, item_id: item.id } });
      igual(
        fatias.map((f) => `${nomeLote(f.estoque_lote_nota_id)}:${d4(f.quantidade)}@${d4(f.custo_unitario)}`).sort().join('|'),
        ['B1:20.0000@5.0000', 'T:40.0000@3.5000'].join('|'),
        `[${rotulo}] fatias FK da venda (OperacaoFinanceiraConsumoLote)`,
      );
      const [b1, b2, t] = await Promise.all([loteDe(s, st.B1), loteDe(s, st.B2), loteDe(s, st.T)]);
      igual(
        `${d4(b1.quantidade_disponivel)}:${b1.status}|${d4(t.quantidade_disponivel)}:${t.status}|${d4(b2.quantidade_disponivel)}:${b2.status}`,
        '0.0000:Esgotado|10.0000:Disponivel|30.0000:Disponivel',
        `[${rotulo}] camadas do RETIRO depois da venda`,
      );
      igual(await cacheDe(s), '170.0000', `[${rotulo}] estoque_atual depois da venda`);
      igual(await somaDisponivel(s), '170.0000', `[${rotulo}] Σ camadas depois da venda (I1)`);
      igual(await somaDisponivel(s, { local_estoque_id: s.localA.id }), '130.0000', `[${rotulo}] a venda no RETIRO não mexe no CENTRAL`);
      igual(await somaDisponivel(s, { local_estoque_id: s.localB.id }), '40.0000', `[${rotulo}] saldo do RETIRO depois da venda`);
      conferir(antes !== (await fotoEstoque(s)), `[${rotulo}] a venda não mudou o estoque`);
    });

    // ── 5. Cancelamento da compra consumida: recusado sem efeito ─────────────
    await passo('5 Cancelar a compra NF-P0-1 (camada consumida) → 409 ESTOQUE_JA_CONSUMIDO e foto igual', async () => {
      exigir(st.compraL1 && st.suplementacao, `[${rotulo}] sem a compra L1 ou a suplementação`);
      const antes = await fotoTenant(s);
      const rc = await api(token, 'POST', `/operacoes-financeiras/${st.compraL1}/cancelar`, { empresa_id: s.empresa.id, operation_id: randomUUID(), motivo: 'teste de cancelamento E2E' });
      const det = rc.corpo?.details ?? {};
      // O motivo vem em `details.reason` ou no topo do corpo (padrão de erro do backend).
      const reason = det.reason ?? rc.corpo?.reason;
      anotar(rotulo, 'cancelamento_recusado', { status: rc.status, code: rc.corpo?.code, reason, entrada: det.entrada, disponivel: det.disponivel });
      igual(`${rc.status}:${rc.corpo?.code}:${reason}`, '409:ESTOQUE_JA_CONSUMIDO:lote_consumido', `[${rotulo}] cancelamento da compra consumida`);
      igual(`${det.lote_id === st.L1}:${det.entrada}:${det.disponivel}`, 'true:100.0000:0.0000', `[${rotulo}] detalhes da recusa`);
      igual(await fotoTenant(s), antes, `[${rotulo}] o cancelamento recusado não gravou nada (financeiro, estoque, recibo, auditoria, sequência)`);
      const el = await api(token, 'GET', `/operacoes-financeiras/${st.compraL1}/elegibilidade?empresa_id=${s.empresa.id}`);
      igual(el.status, 200, `[${rotulo}] elegibilidade da compra`);
      const motivo = (el.corpo?.excluir?.motivos ?? []).find((m) => m.codigo === 'lote_consumido');
      igual(`${el.corpo?.excluir?.permitido}:${motivo?.entidade}:${motivo?.numero}`, `false:MovimentacaoEstoque:${st.suplementacao.numero}`, `[${rotulo}] elegibilidade aponta a suplementação como dependência`);
      igual(await fotoTenant(s), antes, `[${rotulo}] a elegibilidade (leitura) não gravou nada`);
    });

    // ── 6. Escrita direta recusada ───────────────────────────────────────────
    await passo('6 Escrita direta recusada: POST genérico de movimento e de lote → 409, PATCH de estoque_atual → 422, nada gravado', async () => {
      const antes = await fotoTenant(s);
      const agora = new Date().toISOString();
      const rm = await api(token, 'POST', '/movimentacoes-estoque', {
        empresa_id: s.empresa.id, tipo_movimentacao: 'Entrada', data_movimentacao: agora, produto_id: s.produto.id, quantidade: 3, unidade_medida: 'KG', local_estoque_destino: s.localB.id,
      });
      igual(`${rm.status}:${rm.corpo?.code}:${rm.corpo?.details?.entidade}:${rm.corpo?.details?.operacao}`, '409:ESTOQUE_ESCRITA_DIRETA_RECUSADA:MovimentacaoEstoque:criar', `[${rotulo}] POST /movimentacoes-estoque`);
      const rl = await api(token, 'POST', '/estoque-lotes-nota', {
        empresa_id: s.empresa.id, produto_id: s.produto.id, produto_nome: s.produto.nome, local_estoque_id: s.localB.id, local_estoque_nome: s.localB.nome,
        numero_documento: 'NF-FORJADA', data_documento: agora, custo_unitario: 2.5, quantidade_entrada: 100, quantidade_disponivel: 100, status: 'Disponivel',
      });
      igual(`${rl.status}:${rl.corpo?.code}:${rl.corpo?.details?.entidade}:${rl.corpo?.details?.operacao}`, '409:ESTOQUE_ESCRITA_DIRETA_RECUSADA:EstoqueLoteNota:criar', `[${rotulo}] POST /estoque-lotes-nota`);
      const rp = await api(token, 'PATCH', `/produtos/${s.produto.id}`, { empresa_id: s.empresa.id, estoque_atual: 999 });
      igual(`${rp.status}:${rp.corpo?.code}`, '422:PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL', `[${rotulo}] PATCH /produtos com estoque_atual`);
      anotar(rotulo, 'escrita_direta', { movimento: rm.status, lote: rl.status, cache: rp.status });
      igual(await fotoTenant(s), antes, `[${rotulo}] as escritas diretas não gravaram nada (movimento, lote, cache, sequência, auditoria)`);
    });

    // ── 7. Produto: cache derivado, aviso, máscaras ──────────────────────────
    await passo('7 Produto pela tela: aviso, sem campo de saldo, edição informativa sem mexer no estoque; máscaras gravam o exibido', async () => {
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
      // Nenhum campo de SALDO. Os rótulos com "estoque" que existem são cadastro:
      // "Estoque Mínimo", "Local de Estoque" e "Unidade principal de estoque".
      const rotulos = (await form.locator('label.mg-field__label').allInnerTexts()).map((t) => t.replace(/\s*\*\s*$/, '').trim());
      const deEstoque = rotulos.filter((t) => /estoque|saldo/i.test(t));
      const permitidos = /^(Estoque Mínimo|Local de Estoque|Unidade principal de estoque)$/i;
      conferir(deEstoque.every((t) => permitidos.test(t)), `[${rotulo}] campo de estoque/saldo no formulário: ${JSON.stringify(deEstoque)}`);
      conferir(!rotulos.some((t) => /estoque atual|saldo|^estoque$/i.test(t)), `[${rotulo}] campo "Estoque atual" no formulário: ${JSON.stringify(rotulos)}`);
      const campo = (re) => form.locator('.mg-field').filter({ has: page.locator('label.mg-field__label', { hasText: re }) }).locator('input, textarea').first();
      /** Limpa o campo mascarado como uma pessoa: cursor no fim e Backspace até "0,00". */
      const limpar = async (loc, acao) => {
        await toque(loc, acao);
        await page.keyboard.press('End');
        for (let i = 0; i < 14; i += 1) await page.keyboard.press('Backspace');
      };
      const descricao = `RAÇÃO DO COCHO, EDITADA NO E2E ${rotulo.toUpperCase()}`;
      await campo(/^Descrição/).fill(descricao);
      // I6: o preço de custo do cadastro é referência — não mexe em lote nem em custo histórico.
      const precoCusto = campo(/^Preço de Custo/);
      await limpar(precoCusto, 'Preço de Custo');
      await page.keyboard.type('99900', { delay: 40 });
      const precoExibido = await precoCusto.inputValue();
      igual(precoExibido, '999,00', `[${rotulo}] preço de custo exibido depois da digitação tecla a tecla`);
      await shot('produto-edicao');
      let desde = escritas.length;
      let respostaPatch = page.waitForResponse((r) => r.url().startsWith(`${API}`) && r.request().method() === 'PATCH' && /\/produtos\//.test(r.url()), { timeout: 20000 });
      await toque(page.getByRole('button', { name: 'Salvar', exact: true }).filter({ visible: true }).first(), 'Salvar produto');
      igual((await respostaPatch).status(), 200, `[${rotulo}] PATCH /produtos pela tela`);
      let patches = escritas.slice(desde).filter((e) => e.metodo === 'PATCH' && /\/produtos\//.test(e.url));
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
      igual(`${corpo.preco_custo}:${d4(prod.preco_custo)}`, '999:999.0000', `[${rotulo}] preço de custo enviado e gravado = exibido "${precoExibido}"`);
      igual(await fotoEstoque(s), fotoAntes, `[${rotulo}] cache, camadas (custos intactos: I6) e movimentos depois da edição informativa`);
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
      // 1280: "Cancelar" na barra; celular: "Descartar" (✕) no cabeçalho do registro.
      await toque(page.getByRole('button', { name: /^(Cancelar|Descartar)$/ }).filter({ visible: true }).first(), 'Cancelar produto novo');
      igual(escritas.slice(desdeNovo).length, 0, `[${rotulo}] abrir/cancelar o cadastro novo não escreve nada`);
      igual(await fotoEstoque(s), fotoAntes, `[${rotulo}] estoque intacto depois do cadastro novo cancelado`);

      // Máscaras do NÚCLEO (SACO): Peso por saco digitado tecla a tecla, preço colado.
      await page.goto(`${WEB}/produtos`, { waitUntil: 'domcontentloaded' });
      const linhaNucleo = page.getByText(s.nucleo.nome, { exact: true }).filter({ visible: true }).first();
      await linhaNucleo.waitFor();
      await linhaNucleo.dblclick();
      await toque(page.getByRole('button', { name: 'Editar', exact: true }).filter({ visible: true }).first(), 'Editar NÚCLEO');
      await form.locator('textarea').first().waitFor({ state: 'visible' });
      const peso = campo(/^Peso por saco/);
      const precoNucleo = campo(/^Preço de Custo/);
      igual(await peso.inputValue(), '30,00', `[${rotulo}] Peso por saco lido do banco`);
      await limpar(peso, 'Peso por saco');
      await page.keyboard.type('2500', { delay: 60 });
      const pesoExibido = await peso.inputValue();
      await limpar(precoNucleo, 'Preço de Custo do NÚCLEO');
      await page.evaluate(() => navigator.clipboard.writeText('1234'));
      await page.keyboard.press('Control+V');
      const precoColado = await precoNucleo.inputValue();
      igual(`${pesoExibido}|${precoColado}`, '25,00|12,34', `[${rotulo}] valores exibidos (digitado tecla a tecla | colado)`);
      await shot('nucleo-mascaras');
      desde = escritas.length;
      respostaPatch = page.waitForResponse((r) => r.url().startsWith(`${API}`) && r.request().method() === 'PATCH' && /\/produtos\//.test(r.url()), { timeout: 20000 });
      await toque(page.getByRole('button', { name: 'Salvar', exact: true }).filter({ visible: true }).first(), 'Salvar NÚCLEO');
      igual((await respostaPatch).status(), 200, `[${rotulo}] PATCH do NÚCLEO pela tela`);
      patches = escritas.slice(desde).filter((e) => e.metodo === 'PATCH' && /\/produtos\//.test(e.url));
      const corpoNucleo = JSON.parse(patches[0]?.corpo || '{}');
      const nucleo = await esperarBanco(
        async () => {
          const p = await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: s.nucleo.id } });
          return p && d4(p.peso_por_saco_kg) !== '30.0000' ? p : null;
        },
        'peso por saco do NÚCLEO gravado',
      );
      // Compra PLANEJADA depois (rascunho pela API real, sem efeito físico): 4 sacos.
      const plano = await api(token, 'POST', '/operacoes-financeiras', documento(s, { direcao: 'PAGAR', kg: '4', preco: '100.00', total: '400.00', dia: hoje, doc: 'NF-PLANO-SACO', local: s.localA, produto: s.nucleo, unidade: 'SACO' }));
      exigir(plano.status === 201, `[${rotulo}] compra planejada em SACO: ${plano.status} ${JSON.stringify(plano.corpo).slice(0, 200)}`);
      const itemPlano = await prisma.operacaoFinanceiraItem.findFirst({ where: { cliente_id: s.cliente_id, operacao_id: plano.corpo.id } });
      const evid = {
        exibido: { peso_por_saco_kg: pesoExibido, preco_custo: precoColado },
        enviado: { peso_por_saco_kg: corpoNucleo.peso_por_saco_kg, preco_custo: corpoNucleo.preco_custo },
        banco: { peso_por_saco_kg: d4(nucleo.peso_por_saco_kg), preco_custo: d4(nucleo.preco_custo) },
        compra_planejada: { unidade: itemPlano?.unidade, sacos: d4(itemPlano?.quantidade), fator_kg: d4(itemPlano?.fator_kg), kg: d4(itemPlano?.quantidade_estoque) },
      };
      anotar(rotulo, 'mascaras_nucleo', evid);
      igual(`${evid.enviado.peso_por_saco_kg}:${evid.banco.peso_por_saco_kg}`, '25:25.0000', `[${rotulo}] Peso por saco enviado e gravado = exibido "${pesoExibido}"`);
      igual(`${evid.enviado.preco_custo}:${evid.banco.preco_custo}`, '12.34:12.3400', `[${rotulo}] preço colado enviado e gravado = exibido "${precoColado}"`);
      igual(`${evid.compra_planejada.unidade}:${evid.compra_planejada.sacos}:${evid.compra_planejada.fator_kg}:${evid.compra_planejada.kg}`, 'SACO:4.0000:25.0000:100.0000', `[${rotulo}] fator SACO→KG da compra planejada = Peso por saco exibido`);
      igual(await prisma.estoqueLoteNota.count({ where: { cliente_id: s.cliente_id, produto_id: s.nucleo.id } }), 0, `[${rotulo}] a compra planejada (rascunho) não cria camada`);
      igual(await fotoEstoque(s), fotoAntes, `[${rotulo}] o estoque da RAÇÃO não mudou no passo 7`);
    });

    // ── 8. Reconciliação somente leitura ─────────────────────────────────────
    await passo('8 Reconciliação somente leitura: cobertura completa, situação CONSISTENTE, 0 achados e nada gravado', async () => {
      const antes = await fotoTenant(s);
      const r = await api(token, 'GET', `/estoque-fisico/reconciliacao?empresa_id=${s.empresa.id}`);
      exigir(r.status === 200, `[${rotulo}] GET /estoque-fisico/reconciliacao: ${r.status} ${JSON.stringify(r.corpo).slice(0, 300)}`);
      const cob = r.corpo?.cobertura ?? {};
      const res = r.corpo?.resumo ?? {};
      const pc = res.por_classe ?? {};
      anotar(rotulo, 'reconciliacao', { resumo: res, cobertura: cob, achados: (r.corpo?.achados ?? []).length, truncado: r.corpo?.truncado });
      // Contrato vigente do módulo (D-PROD-161): a chamada única cobre o escopo
      // inteiro. Cada campo de prova que o módulo expõe é exigido; um campo
      // ausente não vira "verde" por omissão nos obrigatórios (completa,
      // proximo_cursor, situacao).
      const provas = [
        ['completa', cob.completa, true],
        ['proximo_cursor', cob.proximo_cursor ?? null, null],
        ...('produtos_restantes' in cob ? [['produtos_restantes', cob.produtos_restantes, 0]] : []),
        ...('fim_do_escopo' in cob ? [['fim_do_escopo', cob.fim_do_escopo, true]] : []),
        ...('snapshot_unico' in cob ? [['snapshot_unico', cob.snapshot_unico, true]] : []),
        ...('conclusao_global' in cob ? [['conclusao_global', cob.conclusao_global, 'COMPROVADA']] : []),
        ...('conclusao_global_comprovada' in cob ? [['conclusao_global_comprovada', cob.conclusao_global_comprovada, true]] : []),
        ...('motivos_inconclusiva' in cob ? [['motivos_inconclusiva', JSON.stringify(cob.motivos_inconclusiva), '[]']] : []),
        ...('evidencia_exclusoes' in cob ? [['evidencia_exclusoes_parcial', cob.evidencia_exclusoes === 'parcial', false]] : []),
        ...('interrompida_por' in cob ? [['interrompida_por', cob.interrompida_por ?? null, null]] : []),
      ];
      igual(provas.map(([k, v]) => `${k}=${v}`).join(' '), provas.map(([k, , e]) => `${k}=${e}`).join(' '), `[${rotulo}] cobertura da reconciliação (escopo inteiro num snapshot, sem continuação)`);
      igual(res.situacao, 'CONSISTENTE', `[${rotulo}] situação da reconciliação`);
      igual(
        `${pc.DIVERGENCIA_REAL}:${pc.LIMITACAO_LEGADA}:${pc.DADOS_INSUFICIENTES}:${(r.corpo?.achados ?? []).length}:${r.corpo?.truncado}`,
        '0:0:0:0:false',
        `[${rotulo}] reconciliação (DIVERGENCIA_REAL:LIMITACAO_LEGADA:DADOS_INSUFICIENTES:achados:truncado) ${JSON.stringify((r.corpo?.achados ?? []).slice(0, 3))}`,
      );
      conferir(Number.isInteger(pc.OK) && pc.OK > 0, `[${rotulo}] por_classe.OK deve ser contagem (cobertura completa): ${pc.OK}`);
      igual(await fotoTenant(s), antes, `[${rotulo}] a reconciliação não grava nada (estoque, financeiro, auditoria, sequência)`);
    });
  } finally {
    await dormir(500);
    if (errosPagina.length) falhas.push(`[${rotulo}] erros de página: ${errosPagina.slice(0, 3).join(' | ')}`);
    if (respostasApi.length) {
      console.log(`  [${rotulo}] respostas ≥400 vistas pelas telas (${respostasApi.length}):\n    ${respostasApi.slice(0, 16).map((r) => r.texto).join('\n    ')}`);
      for (const r of respostasApi) falhas.push(`[${rotulo}] resposta inesperada da API vista pela tela: ${r.texto.slice(0, 220)}`);
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

// Nenhuma resposta 5xx em lugar nenhum: a API vista pelo roteiro e o log do backend.
const cincoXX = respostasRoteiro.filter((r) => / → 5\d\d$/.test(r));
for (const r of cincoXX) falhas.push(`resposta 5xx da API: ${r}`);
try {
  const logBackend = fs.readFileSync(path.join(OUT, 'backend.log'), 'utf8');
  const statusLog = [...logBackend.matchAll(/"statusCode":(\d{3})/g)].map((m) => Number(m[1]));
  const erros5xx = statusLog.filter((c) => c >= 500);
  console.log(`\nbackend.log: ${statusLog.length} respostas registradas, ${erros5xx.length} com 5xx`);
  if (erros5xx.length) falhas.push(`backend.log registrou ${erros5xx.length} resposta(s) 5xx`);
} catch {
  /* sem log */
}

// Placar: cada largura precisa dos 8 passos, todos verdes.
for (const largura of LARGURAS) {
  const meus = passos.filter((p) => p.largura === `w${largura}`);
  const verdes = meus.filter((p) => p.ok).length;
  console.log(`\n[w${largura}] ${verdes}/${TOTAL_PASSOS} passos`);
  if (meus.length !== TOTAL_PASSOS || verdes !== TOTAL_PASSOS) falhas.push(`[w${largura}] ${verdes}/${TOTAL_PASSOS} passos verdes (executados ${meus.length})`);
}
console.log(`\n${passos.map((p) => `${p.ok ? '✓' : '✗'} [${p.largura}] ${p.nome}`).join('\n')}`);
fs.writeFileSync(path.join(OUT, 'evidencias.json'), JSON.stringify({ passos, evidencias, respostas_api_roteiro: respostasRoteiro, falhas }, null, 2));
console.log(`\nCapturas, logs e evidencias.json em ${OUT}`);
if (falhas.length) {
  console.error(`\nDIVERGÊNCIAS (${falhas.length}):\n- ${falhas.join('\n- ')}`);
  codigo = 1;
} else {
  console.log('\nOK: telas reais + backend real + PostgreSQL local sem divergências.');
}
process.exit(codigo);
