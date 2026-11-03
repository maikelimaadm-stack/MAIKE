/**
 * Utilidades dos testes de backend.
 *
 * Os testes rodam contra um PostgreSQL **real**. Não há mock de Prisma: o que
 * precisa ser provado aqui — isolamento entre tenants, atomicidade da sequência
 * sob concorrência, violação de unique virando código estável — só existe de
 * verdade no banco. Um mock provaria que o mock funciona.
 */

import { randomUUID } from 'node:crypto';

import { construirApp } from '../src/app.js';
import { getPrismaClient, closePrismaClient } from '../src/database/prismaClient.js';
import { gerarSenhaHash } from '../src/modules/auth/authService.js';
import { criarProprietarioInicial } from '../src/modules/adminMaike/adminService.js';
import { zerarLimitadorAdmin } from '../src/modules/adminMaike/adminSessao.js';
import { codigoTotp, passoTotpAtual } from '../src/modules/adminMaike/adminCrypto.js';
import { fingerprintDePayload } from '../src/shared/idempotency/operacaoIdempotenteService.js';

/** Ordem de limpeza respeita as foreign keys (tudo é Restrict). */
const ORDEM_DE_LIMPEZA = [
  'auditoriaCatalogoGlobal',
  // D-PROD-70 — identidade do produto (sem tenant).
  'eventoSegurancaAdminMaike',
  'codigoRecuperacaoAdminMaike',
  'sessaoAdminMaike',
  'adminPrincipalMaike',
  'catalogoRegraMistoCategoria',
  'catalogoRegraMisto',
  'catalogoIcone',
  'catalogoAsset',
  'catalogoCategoriaVisual',
  'catalogoTipoEntidade',
  'operadorProdutoMaike',
  'catalogoMeta',
  // R2E-P1 (D-PROD-107) — ledger do rebanho: partidas → eventos → posições → ativação, antes de Lote/Área/Empresa.
  // Tarefa cita posição do ledger (R2E-R1): sai antes das posições.
  'historicoLancamentoTarefa',
  'lancamentoTarefa',
  'pesoRebanho',
  'partidaRebanho',
  'eventoRebanho',
  'posicaoRebanho',
  'rebanhoLedgerAtivacao',
  'auditLog',
  'registroAnexo',
  // P5.5 — documentos JSON tenant-scoped (Restrict → Cliente).
  'bebedouroAlerta',
  'bebedouroSanidade',
  'bebedouroHistorico',
  'aplicacaoMedicamento',
  'eventoSanitario',
  'manejoTecnicoRebanho',
  'suplementacaoLote',
  'suplementacaoEvento',
  'movimentacaoPecuaria',
  'movimentacaoMapa',
  // P4.3 — geografia referencia Cliente com Restrict; limpar antes da raiz.
  'pontoReferencia',
  'linhaGeografica',
  'configuracaoIcone',
  // `areaPastagem` antes de `setor`: a FK composta é Restrict, e apagar setor
  // com área ainda pendurada falha — que é exatamente o que ela existe para
  // fazer (P4.2).
  'movimentacaoEstoque',
  'estoqueLoteNota',
  'pontoSuplementacao',
  'bebedouro',
  'fornecedor',
  'categoriaManejo',
  'permissao',
  'empresa',
  'produto',
  'localEstoque',
  'categoria',
  'lote',
  'areaPastagem',
  'marca',
  'unidadeMedida',
  // P5.0 — TipoTarefa referencia GrupoAtividade (FK composta, Restrict).
  'tipoTarefa',
  'grupoAtividade',
  'setor',
  'operacaoIdempotente',
  'entidadeCodigoSequencia',
  'usuario',
  'cliente',
];

export const limparBanco = async () => {
  const prisma = getPrismaClient();
  zerarLimitadorAdmin();
  for (let pass = 0; pass < 8; pass += 1) {
    const removidas = await prisma.categoria.deleteMany({
      where: { categoria_pai_id: { not: null } },
    });
    if (removidas.count === 0) break;
  }
  // CategoriaManejo (tenant) referencia CatalogoCategoriaVisual (global), que é
  // limpo antes dela na ordem abaixo: solta o vínculo opcional primeiro.
  await prisma.categoriaManejo.updateMany({
    where: { catalogo_categoria_visual_id: { not: null } },
    data: { catalogo_categoria_visual_id: null },
  });
  for (const model of ORDEM_DE_LIMPEZA) {
    await prisma[model].deleteMany({});
  }
};

export const encerrar = async () => {
  await closePrismaClient();
};

/**
 * Cria um tenant com um usuário, prontos para autenticar.
 *
 * `papelTenant: 'administrador'` é a fixture DE BANCO do administrador da
 * fazenda (PR145-R4) — o mesmo efeito do script operacional; nenhuma rota HTTP
 * concede esse papel. Padrão: usuário comum.
 * @param {{codigo?: string, login?: string, senha?: string, papelTenant?: 'usuario'|'administrador'}} [opcoes]
 */
export const criarTenant = async (opcoes = {}) => {
  const prisma = getPrismaClient();
  const codigo = opcoes.codigo || `t-${randomUUID().slice(0, 8)}`;
  // Login único global entre ativos (D-PROD-35): default por tenant evita colisão
  // acidental quando o teste não passa `login` explícito.
  const login = opcoes.login ?? `operador-${codigo}`;
  const senha = opcoes.senha || 'senha-de-teste-1';

  const cliente = await prisma.cliente.create({
    data: { codigo, nome: `Tenant ${codigo}` },
  });

  const usuario = await prisma.usuario.create({
    data: {
      cliente_id: cliente.id,
      nome: 'Operador de Teste',
      login,
      senha_hash: await gerarSenhaHash(senha),
      papel_tenant: opcoes.papelTenant ?? 'usuario',
    },
  });

  return { cliente, usuario, credenciais: { login, senha } };
};

/** Monta o app sem abrir porta. */
export const criarApp = async () => construirApp({ logger: false });

/**
 * Autentica e devolve o token.
 * @param {import('fastify').FastifyInstance} app
 * @param {{login: string, senha: string}} credenciais
 */
export const autenticarNoApp = async (app, credenciais) => {
  const resposta = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: credenciais,
  });
  return { resposta, corpo: resposta.json() };
};

// ─── MAIKE Admin (D-PROD-70) ───────────────────────────────────────────────

/** Origin do app admin aceita fora de produção (ver `originsAdminPermitidas`). */
export const ORIGEM_ADMIN = 'http://localhost:5174';

/** @param {import('light-my-request').Response} resposta @returns {string|null} `nome=valor` do cookie admin */
export const cookieAdminDe = (resposta) => {
  const bruto = resposta.headers['set-cookie'];
  const lista = Array.isArray(bruto) ? bruto : bruto ? [String(bruto)] : [];
  const c = lista.find((x) => x.startsWith('maike_admin='));
  return c ? c.split(';')[0] : null;
};

/**
 * Cria o proprietário, faz login, inscreve o TOTP e devolve uma sessão
 * VERIFICADA pronta para as rotas admin. `proximoCodigo()` gera um TOTP ainda
 * não usado (passo seguinte), para reautenticações.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {{ login?: string, senha?: string }} [opcoes]
 */
export const criarAdminComSessao = async (app, opcoes = {}) => {
  const login = opcoes.login ?? 'dono.maike';
  const senha = opcoes.senha ?? 'senha-forte-do-dono-1';
  const admin = await criarProprietarioInicial({ login, senha });
  const base = { origin: ORIGEM_ADMIN };
  const r1 = await app.inject({ method: 'POST', url: '/admin-maike/auth/login', headers: base, payload: { login, senha } });
  if (r1.statusCode !== 200) throw new Error(`login admin falhou: ${r1.statusCode} ${r1.body}`);
  const pre = { ...base, cookie: cookieAdminDe(r1), 'x-maike-admin-csrf': r1.json().csrf_token };
  const insc = await app.inject({ method: 'POST', url: '/admin-maike/mfa/inscricao', headers: pre, payload: {} });
  const segredo = insc.json().segredo;
  let passo = passoTotpAtual();
  const r2 = await app.inject({
    method: 'POST',
    url: '/admin-maike/mfa/confirmar',
    headers: pre,
    payload: { codigo: codigoTotp(segredo, passo) },
  });
  if (r2.statusCode !== 200) throw new Error(`MFA admin falhou: ${r2.statusCode} ${r2.body}`);
  const headers = { ...base, cookie: cookieAdminDe(r2), 'x-maike-admin-csrf': r2.json().csrf_token };
  // Simula "próxima janela de 30 s": libera o passo atual e devolve o código dele.
  const proximoCodigo = async () => {
    passo = passoTotpAtual();
    await getPrismaClient().adminPrincipalMaike.update({
      where: { id: admin.id },
      data: { mfa_ultimo_passo: passo - 2 },
    });
    return codigoTotp(segredo, passo);
  };
  return { admin, login, senha, segredo, headers, codigosRecuperacao: r2.json().codigos_recuperacao, proximoCodigo };
};

/**
 * PR174-R4/R5 (D-PROD-107): o manejo não fabrica mais lote derivado e os
 * comandos do mapa só operam o ledger (empresa sem cutover → 409). Testes que
 * precisam do DADO LEGADO que a antiga transferência parcial "com lote novo"
 * deixava no banco o escrevem DIRETO no banco (simula uma base pré-cutover):
 *  1. o destino é cadastrado como entrada VAZIA (0 cabeças) na área e depois
 *     reescrito como derivado (origem MOVIMENTAÇÃO, quantidade = transferida);
 *  2. a origem é debitada (saldo, Inativo se zerar);
 *  3. um MovimentacaoMapa com `efeito_servidor` do comando antigo
 *     (`manejo_mapa_lote`, modo `parcial_novo_lote`, efeito do destino
 *     `criado: true`) e a operação idempotente confirmada apontando para ele —
 *     a linhagem da ativação e o reset de teste a reconhecem como antes.
 * Devolve `{ movimentacao, lotes, derivadoId, corpo }` (corpo = o pedido
 * que o comando antigo teria recebido, para provas de replay).
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {{ token: string, empresaId: string, setorId: string, origem: any, quantidade: number, areaDestinoId: string, data: string, corpoExtra?: Record<string, unknown> }} p
 */
export const transferenciaComDerivadoLegado = async (app, { token, empresaId, setorId, origem, quantidade, areaDestinoId, data, corpoExtra = {} }) => {
  const headers = { authorization: `Bearer ${token}` };
  const dia = String(data).slice(0, 10);
  const destino = await app.inject({
    method: 'POST', url: '/lotes', headers,
    payload: {
      empresa_id: empresaId, nome: origem.nome, quantidade_cabecas: 0, categoria: origem.categoria, ...(origem.sexo ? { sexo: origem.sexo } : {}),
      setor_id: setorId, area_entrada_id: areaDestinoId, area_atual_id: areaDestinoId, data_entrada: dia, motivo_entrada: 'Compra', status: 'Ativo',
    },
  });
  if (destino.statusCode !== 201) throw new Error(`fixture derivado legado: cadastro do destino ${destino.statusCode} ${destino.body}`);
  const derivadoId = destino.json().id;
  const corpo = {
    operation_id: `op-${randomUUID()}`, tipo: 'Transferência de Área', empresa_id: empresaId, lote_id: origem.id, quantidade_animais: quantidade,
    area_destino_id: areaDestinoId, lote_destino_id: derivadoId, data_movimentacao: data, ...corpoExtra,
  };
  const p = getPrismaClient();
  const o = await p.lote.findFirst({ where: { id: origem.id } });
  if (!o || o.quantidade_cabecas < quantidade) throw new Error('fixture derivado legado: origem sem saldo');
  const area = await p.areaPastagem.findFirst({ where: { cliente_id: o.cliente_id, id: areaDestinoId } });
  const saldo = o.quantidade_cabecas - quantidade;
  const estado = (l) => ({
    quantidade_cabecas: l.quantidade_cabecas, status: l.status, area_atual_id: l.area_atual_id ?? null,
    categoria: l.categoria ?? null, categoria_manejo_id: l.categoria_manejo_id ?? null, empresa_id: l.empresa_id ?? null,
  });
  const origemDepois = await p.lote.update({
    where: { cliente_id_id: { cliente_id: o.cliente_id, id: o.id } },
    data: { quantidade_cabecas: saldo, status: saldo > 0 ? o.status : 'Inativo' },
  });
  const derivado = await p.lote.update({
    where: { cliente_id_id: { cliente_id: o.cliente_id, id: derivadoId } },
    data: {
      quantidade_cabecas: quantidade, quantidade_entrada: quantidade, origem: 'MOVIMENTAÇÃO', motivo_entrada: 'Outros', motivo_outros: 'Movimentação parcial',
      data_entrada: new Date(data), area_atual_nome: area?.nome ?? null, area_entrada_nome: area?.nome ?? null,
    },
  });
  const mov = await p.movimentacaoMapa.create({
    data: {
      cliente_id: o.cliente_id, empresa_id: empresaId,
      dados: {
        tipo: 'Transferência de Área', lote: o.nome, lote_id: o.id, quantidade_animais: quantidade, data_movimentacao: data,
        area_origem_id: o.area_atual_id, area_origem_nome: o.area_atual_nome ?? null, area_destino_id: areaDestinoId, area_destino_nome: area?.nome ?? null,
        modo_transferencia: 'parcial_novo_lote', lote_destino_id: derivadoId, categoria_animal: o.categoria ?? null,
        efeito_servidor: {
          comando: 'manejo_mapa_lote', operation_id: corpo.operation_id, registrado_em: new Date().toISOString(), modo: 'parcial_novo_lote',
          efeitos: [
            { lote_id: o.id, criado: false, auditoria_id: 'legado', antes: estado(o), depois: estado(origemDepois) },
            { lote_id: derivadoId, criado: true, auditoria_id: 'legado', antes: { ...estado(derivado), quantidade_cabecas: 0, status: 'Inativo' }, depois: estado(derivado) },
          ],
        },
      },
    },
  });
  const movimentacao = { ...mov.dados, id: mov.id, empresa_id: mov.empresa_id };
  const resposta = { movimentacao, lotes: [{ id: o.id }, { id: derivadoId }] };
  // Mesmo fingerprint que o comando antigo gravava (forma normalizada do pedido).
  const txt = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const fingerprint = fingerprintDePayload({
    tipo: corpo.tipo, empresaId, loteId: o.id, quantidade, dataMovimentacao: txt(corpo.data_movimentacao), areaDestinoId, loteDestinoId: derivadoId,
    observacoes: typeof corpo.observacoes === 'string' ? corpo.observacoes : null, categoriaAnimal: txt(corpo.categoria_animal), usuarioResponsavel: txt(corpo.usuario_responsavel),
  });
  await p.operacaoIdempotente.create({
    data: { cliente_id: o.cliente_id, operation_key: corpo.operation_id, tipo_operacao: 'manejo_mapa_lote', fingerprint, status: 'committed', http_status: 201, response_json: resposta },
  });
  return { ...resposta, derivadoId, corpo };
};

/**
 * PR174-R5: grava DIRETO no banco um movimento LEGADO certificado (o que os
 * comandos anteriores ao ledger deixavam): MovimentacaoMapa com
 * `efeito_servidor` do comando antigo e a operação idempotente confirmada
 * apontando para ele. Simula base pré-cutover; nunca passa pelos comandos.
 * @param {{ clienteId: string, empresaId: string, comando: string, tipoOperacao?: string, operationKey?: string, fingerprint?: string, dados: Record<string, any>, efeitos?: Array<Record<string, any>>, situacao?: string }} p
 */
export const gravarMovimentoLegado = async ({ clienteId, empresaId, comando, tipoOperacao = comando, operationKey = `op-${randomUUID()}`, fingerprint = 'legado', dados, efeitos = [], situacao }) => {
  const p = getPrismaClient();
  const mov = await p.movimentacaoMapa.create({
    data: {
      cliente_id: clienteId, empresa_id: empresaId,
      dados: {
        ...dados,
        ...(situacao ? { situacao } : {}),
        efeito_servidor: { comando, operation_id: operationKey, registrado_em: new Date().toISOString(), efeitos },
      },
    },
  });
  const movimentacao = { ...mov.dados, id: mov.id, empresa_id: mov.empresa_id };
  await p.operacaoIdempotente.create({
    data: { cliente_id: clienteId, operation_key: operationKey, tipo_operacao: tipoOperacao, fingerprint, status: 'committed', http_status: 201, response_json: { movimentacao } },
  });
  return { movimentacao, operationKey };
};

/**
 * Morte/Abate LEGADA (comando de baixa anterior ao ledger) gravada direto no
 * banco: debita o lote e grava o movimento certificado.
 * @param {{ lote: any, quantidade: number, data?: string, tipo?: string }} p
 */
export const baixaLegada = async ({ lote, quantidade, data = '2026-10-29', tipo = 'Morte' }) => {
  const p = getPrismaClient();
  const o = await p.lote.findFirst({ where: { id: lote.id } });
  const saldo = o.quantidade_cabecas - quantidade;
  const depois = await p.lote.update({ where: { cliente_id_id: { cliente_id: o.cliente_id, id: o.id } }, data: { quantidade_cabecas: saldo, status: saldo > 0 ? o.status : 'Inativo' } });
  const estado = (l) => ({ quantidade_cabecas: l.quantidade_cabecas, status: l.status, area_atual_id: l.area_atual_id ?? null, categoria: l.categoria ?? null, categoria_manejo_id: l.categoria_manejo_id ?? null, empresa_id: l.empresa_id ?? null });
  return gravarMovimentoLegado({
    clienteId: o.cliente_id, empresaId: o.empresa_id, comando: 'manejo_mapa_baixa_rebanho',
    dados: { tipo, lote: o.nome, lote_id: o.id, lote_ids: [o.id], quantidade_animais: quantidade, data_movimentacao: data, area_origem_id: o.area_atual_id, categoria_animal: o.categoria ?? null },
    efeitos: [{ lote_id: o.id, criado: false, auditoria_id: 'legado', antes: estado(o), depois: estado(depois) }],
  });
};
