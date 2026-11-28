/**
 * D-PROD-259 — "Novo movimento" do Estoque montado de verdade (página, motor Base1, service, API, porta e
 * nativeHttpClient reais sobre um backend falso). Mocks só da borda: sessão e permissão.
 *
 *  - só as abas Saldo e Movimentos (a aba Entradas saiu); "Novo movimento" em Movimentos, só com a ação `entrada`;
 *  - UMA janela em que se escolhe o tipo (Entrada ou Transferência); o motivo vem do cadastro (gerenciado na mesma
 *    janela, sem popup sobre popup); a Entrada tem cabeçalho e vários produtos; valor unitário ↔ total;
 *  - o corpo vai com decimais como TEXTO, `motivo_id`, fornecedor, centros, lote e validade; o saldo de implantação
 *    não leva fornecedor nem documento; reenvio do mesmo conteúdo reaproveita a `operation_id`;
 *  - a Transferência chama o comando de transferência; o detalhe de um movimento de entrada abre a entrada (excluir).
 *
 * D-PROD-264 — Saída manual:
 *  - o tipo Saída só com a ação `saida` (Entrada e Transferência só com `entrada`); só com `saida`, a janela abre na Saída;
 *  - motivos do cadastro de SAÍDA (só ativos no seletor; "Motivos…" gerencia na mesma janela); várias linhas;
 *  - o corpo vai com a quantidade como TEXTO, sem valor/custo, e `operation_id`; saldo insuficiente diz a linha;
 *  - no celular a folha nasce dentro da janela; o movimento de saída manual abre o detalhe da saída (excluir; 409).
 *
 * D-PROD-272 — Ajuste de inventário:
 *  - o tipo Ajuste só com a ação `ajuste`; digita-se o saldo CONTADO e a tela mostra o saldo atual e a diferença;
 *  - o corpo vai sem data, com `quantidade_contada` como TEXTO e o custo SÓ na sobra de um depósito sem saldo;
 *  - `custo_obrigatorio_sem_saldo` diz a linha; o movimento de ajuste abre o detalhe do ajuste (excluir; 409); celular.
 * D-PROD-271 — edição completa da Entrada e da Saída manual:
 *  - "Editar" no detalhe (só com a ação e a situação CONFIRMADA) abre a janela "Novo movimento" em modo edição, com o
 *    tipo fixo, o título "Editar entrada/saída nº N" e os campos preenchidos com a versão vigente;
 *  - o PATCH de substituição leva o corpo da criação + versão, motivo da edição e operation_id (`ent-ed-`/`sai-ed-`),
 *    reaproveitada no reenvio; o 409 de "mexeu depois" vira mensagem clara; "Editar observação" segue igual.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';
import { rotearEstoque } from './fixtures/estoqueConsultaFake.js';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1' }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(() => Promise.resolve(sessao.permissao)),
}));

const permissaoCom = (extras = {}) => ({
  user_email: 'operador',
  modulos_permitidos: ['suporte-mapa'],
  permissoes_telas: [{ modulo_id: 'suporte-mapa', tela_id: 'sup-estoque', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...extras }],
});

const MOTIVOS = [
  { id: 'mot-compra', nome: 'Compra', natureza: 'ENTRADA', ativo: true, padrao: false },
  { id: 'mot-doacao', nome: 'Doação', natureza: 'ENTRADA', ativo: true, padrao: false },
  { id: 'mot-impl', nome: 'Saldo de implantação', natureza: 'SALDO_IMPLANTACAO', ativo: true, padrao: true },
];
const ITEM = {
  id: 'i1', ordem: 1, produto_id: 'p-ureia', produto_nome: 'Ureia', local_estoque_id: 'l-galpao', local_estoque_nome: 'Galpão insumos', unidade: 'KG', quantidade: '1500.0000',
  fator_kg: '1.0000', quantidade_estoque: '1500.0000', unidade_estoque: 'KG', custo_unitario: '3.4000', custo_kg: '3.4000', valor_total: '5100.0000', custo_zero: false,
  lote_fabricante: 'L-77', data_validade: '2027-03-31', estoque_lote_nota_id: 'c1', movimentacao_estoque_id: 'm1', movimentacao_estorno_id: null, revisao_inicio: 1, revisao_fim: null,
};
const ENTRADA = {
  id: 'e1', empresa_id: 'emp-1', numero: '7', status: 'CONFIRMADA', versao: 1, revisao: 1, motivo: 'ENTRADA', motivo_id: 'mot-compra', motivo_nome: 'Compra', data_entrada: '2026-11-10',
  fornecedor_id: 'f1', fornecedor_nome: 'Agro Sul', documento_numero: 'NF 77', centro_custo_id: null, centro_custo_nome: null, centro_resultado_id: 'cr1', centro_resultado_nome: 'Pecuária',
  observacao: 'compra avulsa', excluida_em: null, criada_em: '2026-11-10T12:00:00.000Z', itens: [ITEM], itens_historico: [],
  eventos: [{ id: 'v1', tipo: 'CONFIRMACAO', modo: null, motivo: 'Entrada manual: Compra', criado_em: '2026-11-10T12:00:00.000Z' }],
};

const MOTIVOS_SAIDA = [
  { id: 'ms-perda', nome: 'Perda', ativo: true },
  { id: 'ms-consumo', nome: 'Consumo interno', ativo: true },
  { id: 'ms-doacao', nome: 'Doação', ativo: true },
  { id: 'ms-vencimento', nome: 'Vencimento', ativo: false },
];
const SAIDA = {
  id: 's1', empresa_id: 'emp-1', numero: '3', status: 'CONFIRMADA', versao: 1, motivo_id: 'ms-perda', motivo_nome: 'Perda', data_saida: '2026-11-12',
  centro_custo_id: null, centro_custo_nome: null, centro_resultado_id: 'cr1', centro_resultado_nome: 'Pecuária', observacao: 'sacos rasgados', valor_total: '170.0000',
  excluida_em: null, criada_em: '2026-11-12T12:00:00.000Z',
  itens: [{
    id: 'si1', ordem: 1, produto_id: 'p-ureia', produto_nome: 'Ureia', produto_codigo: null, local_estoque_id: 'l-galpao', local_estoque_nome: 'Galpão insumos', unidade: 'KG',
    quantidade: '50.0000', fator_kg: '1.0000', quantidade_estoque: '50.0000', unidade_estoque: 'KG', custo_unitario: '3.4000', valor_total: '170.0000',
    movimentacao_estoque_id: 'ms1', movimentacao_estorno_id: null,
  }],
  eventos: [{ id: 'sv1', tipo: 'CONFIRMACAO', versao_anterior: null, versao_nova: 1, motivo: 'Saída manual: Perda', usuario_id: 'u1', criado_em: '2026-11-12T12:00:00.000Z' }],
};
/** O movimento do Kardex lançado pela saída `s1` (origem `saida_estoque`, `lancamento_origem_id` = id da saída). */
const MOV_SAIDA = {
  id: 'ms1', numero: '106', data: '2026-11-12', tipo: 'Saída', tipo_detalhado: 'saida_manual', origem_sistema: 'saida_estoque', status: 'Ativa', estorno: false,
  produto_id: 'p-ureia', produto_nome: 'Ureia', produto_codigo: null, quantidade: '50.0000', unidade: 'KG', valor_unitario: '3.4000', valor_total: '170.0000',
  local_origem_id: 'l-galpao', local_origem: 'Galpão insumos', local_destino_id: null, local_destino: null, saldo_antes: '1550.0000', saldo_depois: '1500.0000',
  movimento_pai_id: null, movimento_filho_id: null, lancamento_origem_id: 's1',
};
/** D-PROD-382: o movimento do Kardex lançado pela entrada `e1` (origem `entrada_estoque`, `lancamento_origem_id` = id da entrada). */
const MOV_ENTRADA = {
  id: 'me1', numero: '108', data: '2026-11-10', tipo: 'Entrada', tipo_detalhado: 'compra_manual', origem_sistema: 'entrada_estoque', status: 'Ativa', estorno: false,
  produto_id: 'p-ureia', produto_nome: 'Ureia', produto_codigo: null, quantidade: '1500.0000', unidade: 'KG', valor_unitario: '3.4000', valor_total: '5100.0000',
  local_origem_id: null, local_origem: null, local_destino_id: 'l-galpao', local_destino: 'Galpão insumos', saldo_antes: '0.0000', saldo_depois: '1500.0000',
  movimento_pai_id: null, movimento_filho_id: null, lancamento_origem_id: 'e1',
};

/** Saldo e custo médio de cada produto × depósito (rota do ajuste). Sal mineral no Tanque não tem saldo (sem custo médio). */
const SALDOS_AJUSTE = {
  'p-ureia|l-galpao': { saldo: '100.0000', custo_medio: '3.0000' },
  'p-sal|l-galpao': { saldo: '50.0000', custo_medio: '2.0000' },
  'p-sal|l-tanque': { saldo: '0.0000', custo_medio: null },
  'p-ureia|l-tanque': { saldo: '0.0000', custo_medio: null },
};
const AJUSTE = {
  id: 'aj1', empresa_id: 'emp-1', numero: '5', status: 'CONFIRMADA', versao: 1, data_ajuste: '2026-11-14', centro_custo_id: null, centro_custo_nome: null,
  centro_resultado_id: 'cr1', centro_resultado_nome: 'Pecuária', observacao: 'contagem de novembro', valor_sobras: '0.0000', valor_faltas: '30.0000',
  excluida_em: null, criada_em: '2026-11-14T12:00:00.000Z',
  itens: [{
    id: 'ai1', ordem: 1, produto_id: 'p-ureia', produto_nome: 'Ureia', produto_codigo: null, local_estoque_id: 'l-galpao', local_estoque_nome: 'Galpão insumos', unidade: 'KG',
    quantidade_contada: '90.0000', fator_kg: '1.0000', contado_estoque: '90.0000', saldo_anterior: '100.0000', diferenca: '-10.0000', unidade_estoque: 'KG', tipo: 'FALTA',
    custo_unitario: '3.0000', custo_informado: false, valor_total: '30.0000', movimentacao_estoque_id: 'ma1', movimentacao_estorno_id: null,
  }],
  eventos: [{ id: 'av1', tipo: 'CONFIRMACAO', versao_anterior: null, versao_nova: 1, motivo: 'Ajuste de inventário', usuario_id: 'u1', criado_em: '2026-11-14T12:00:00.000Z' }],
};
const MOV_AJUSTE = {
  id: 'ma1', numero: '107', data: '2026-11-14', tipo: 'Saída', tipo_detalhado: 'ajuste_falta', origem_sistema: 'ajuste_estoque', status: 'Ativa', estorno: false,
  produto_id: 'p-ureia', produto_nome: 'Ureia', produto_codigo: null, quantidade: '10.0000', unidade: 'KG', valor_unitario: '3.0000', valor_total: '30.0000',
  local_origem_id: 'l-galpao', local_origem: 'Galpão insumos', local_destino_id: null, local_destino: null, saldo_antes: '100.0000', saldo_depois: '90.0000',
  movimento_pai_id: null, movimento_filho_id: null, lancamento_origem_id: 'aj1',
};

/** Backend falso: o do Estoque + as rotas das Entradas, das Saídas, dos Ajustes, dos motivos e da transferência (estado em memória). */
const criarRoteador = () => {
  const estado = {
    ajustes: [AJUSTE], falhaDoAjuste: /** @type {null|{status:number, body:any}} */ (null), falhaDaExclusaoAjuste: /** @type {null|{status:number, body:any}} */ (null),
    entradas: [ENTRADA], motivos: [...MOTIVOS], falhaDoPost: /** @type {null|{status:number, body:any}} */ (null),
    saidas: [SAIDA], motivosSaida: MOTIVOS_SAIDA.map((m) => ({ ...m })), falhaDaSaida: /** @type {null|{status:number, body:any}} */ (null),
    falhaDaExclusaoSaida: /** @type {null|{status:number, body:any}} */ (null),
    falhaDaEdicaoEntrada: /** @type {null|{status:number, body:any}} */ (null),
    falhaDaEdicaoSaida: /** @type {null|{status:number, body:any}} */ (null),
  };
  const opcoes = (itens) => ({ status: 200, body: { itens, has_more: false, next_cursor: null } });
  const rotear = async (req) => {
    const { method, path, query, body } = req;
    if (path === '/estoque/motivos-entrada' && method === 'GET') {
      const ativos = query.get('ativos') === 'true';
      return { status: 200, body: { items: estado.motivos.filter((m) => !ativos || m.ativo) } };
    }
    if (path === '/estoque/motivos-entrada' && method === 'POST') {
      const m = { id: `mot-${estado.motivos.length + 1}`, nome: body.nome, natureza: 'ENTRADA', ativo: true, padrao: false };
      estado.motivos.push(m);
      return { status: 201, body: m };
    }
    // D-PROD-264 — motivos de saída e saídas.
    if (path === '/estoque/motivos-saida' && method === 'GET') {
      const ativos = query.get('ativos') === 'true';
      return { status: 200, body: { items: estado.motivosSaida.filter((m) => !ativos || m.ativo) } };
    }
    if (path === '/estoque/motivos-saida' && method === 'POST') {
      const m = { id: `ms-${estado.motivosSaida.length + 1}`, nome: body.nome, ativo: true };
      estado.motivosSaida.push(m);
      return { status: 201, body: m };
    }
    const ms = /^\/estoque\/motivos-saida\/([^/]+)$/.exec(path);
    if (ms && method === 'PATCH') {
      estado.motivosSaida = estado.motivosSaida.map((m) => (m.id === ms[1] ? { ...m, ...body } : m));
      return { status: 200, body: estado.motivosSaida.find((m) => m.id === ms[1]) };
    }
    if (path === '/estoque/saidas' && method === 'POST') {
      if (estado.falhaDaSaida) return estado.falhaDaSaida;
      const criada = { ...SAIDA, id: 's2', numero: '4', motivo_id: body.motivo_id };
      estado.saidas = [criada, ...estado.saidas];
      return { status: 201, body: criada };
    }
    const sd = /^\/estoque\/saidas\/([^/]+)(\/excluir)?$/.exec(path);
    if (sd && !sd[2] && method === 'GET') return { status: 200, body: estado.saidas.find((x) => x.id === sd[1]) };
    if (sd && !sd[2] && method === 'PATCH') {
      if (estado.falhaDaEdicaoSaida) return estado.falhaDaEdicaoSaida;
      const atual = estado.saidas.find((x) => x.id === sd[1]);
      // D-PROD-271: com `itens` é a substituição (as linhas novas; o evento leva o modo).
      const editada = body.itens
        ? {
          ...atual, versao: atual.versao + 1, motivo_id: body.motivo_id, data_saida: body.data_saida, observacao: body.observacao,
          itens: body.itens.map((i, k) => ({ ...atual.itens[0], id: `si-n${k + 1}`, ordem: k + 1, quantidade: `${i.quantidade}.0000`, quantidade_estoque: `${i.quantidade}.0000` })),
          eventos: [...atual.eventos, { id: 'sv-ed', tipo: 'EDICAO', modo: 'SUBSTITUICAO', motivo: body.motivo_edicao, criado_em: '2026-11-13T12:00:00.000Z' }],
        }
        : { ...atual, observacao: body.observacao, versao: atual.versao + 1 };
      estado.saidas = estado.saidas.map((x) => (x.id === atual.id ? editada : x));
      return { status: 200, body: editada };
    }
    if (sd && sd[2] && method === 'POST') {
      if (estado.falhaDaExclusaoSaida) return estado.falhaDaExclusaoSaida;
      const atual = estado.saidas.find((x) => x.id === sd[1]);
      const excluida = { ...atual, status: 'EXCLUIDA', versao: atual.versao + 1, eventos: [...atual.eventos, { id: 'sv2', tipo: 'EXCLUSAO', motivo: body.motivo, criado_em: '2026-11-13T12:00:00.000Z' }] };
      estado.saidas = estado.saidas.map((x) => (x.id === atual.id ? excluida : x));
      return { status: 200, body: excluida };
    }
    if (path === '/estoque/movimentos' && method === 'GET') {
      const base = await rotearEstoque(req);
      return { ...base, body: { ...base.body, items: [MOV_AJUSTE, MOV_SAIDA, MOV_ENTRADA, ...base.body.items] } };
    }
    // D-PROD-272 — ajustes de inventário.
    if (path === '/estoque/ajustes/saldo' && method === 'GET') {
      const chave = `${query.get('produto_id')}|${query.get('local_estoque_id')}`;
      const s = SALDOS_AJUSTE[chave] ?? { saldo: '0.0000', custo_medio: null };
      return { status: 200, body: { produto_id: query.get('produto_id'), local_estoque_id: query.get('local_estoque_id'), unidade_estoque: 'KG', ...s } };
    }
    if (path === '/estoque/ajustes' && method === 'POST') {
      if (estado.falhaDoAjuste) return estado.falhaDoAjuste;
      const criado = { ...AJUSTE, id: 'aj2', numero: '6' };
      estado.ajustes = [criado, ...estado.ajustes];
      return { status: 201, body: criado };
    }
    const aj = /^\/estoque\/ajustes\/([^/]+)(\/excluir)?$/.exec(path);
    if (aj && !aj[2] && method === 'GET') return { status: 200, body: estado.ajustes.find((x) => x.id === aj[1]) };
    if (aj && !aj[2] && method === 'PATCH') {
      const atual = estado.ajustes.find((x) => x.id === aj[1]);
      const editado = { ...atual, observacao: body.observacao, versao: atual.versao + 1 };
      estado.ajustes = estado.ajustes.map((x) => (x.id === atual.id ? editado : x));
      return { status: 200, body: editado };
    }
    if (aj && aj[2] && method === 'POST') {
      if (estado.falhaDaExclusaoAjuste) return estado.falhaDaExclusaoAjuste;
      const atual = estado.ajustes.find((x) => x.id === aj[1]);
      const excluido = { ...atual, status: 'EXCLUIDA', versao: atual.versao + 1, eventos: [...atual.eventos, { id: 'av2', tipo: 'EXCLUSAO', motivo: body.motivo, criado_em: '2026-11-15T12:00:00.000Z' }] };
      estado.ajustes = estado.ajustes.map((x) => (x.id === atual.id ? excluido : x));
      return { status: 200, body: excluido };
    }
    if (path === '/estoque/movimentos/ma1' && method === 'GET') {
      return {
        status: 200,
        body: {
          ...MOV_AJUSTE, custo_medio_antes: '3.0000', custo_medio_depois: '3.0000', motivo: 'Ajuste de inventário: falta', observacoes: null, responsavel: 'operador', fornecedor_nome: null,
          tipo_documento: null, numero_documento: null, data_documento: null, vinculos: { area: null, lote: null, maquina: null, centro_custo: null, safra: null },
          documento: { tipo: 'AJUSTE_ESTOQUE', id: 'aj1', numero: '5', rotulo: 'Ajuste de inventário nº 5', pagina: null },
          camadas_consumidas: [], pai: null, filho: null, criado_em: '2026-11-14T12:00:00.000Z',
        },
      };
    }
    if (path === '/estoque/movimentos/ms1' && method === 'GET') {
      return {
        status: 200,
        body: {
          ...MOV_SAIDA, custo_medio_antes: '3.4000', custo_medio_depois: '3.4000', motivo: 'Saída manual: Perda', observacoes: 'sacos rasgados', responsavel: 'operador', fornecedor_nome: null,
          tipo_documento: null, numero_documento: null, data_documento: null, vinculos: { area: null, lote: null, maquina: null, centro_custo: null, safra: null },
          documento: null, lancamento_origem_id: 's1', camadas_consumidas: [], pai: null, filho: null, criado_em: '2026-11-12T12:00:00.000Z',
        },
      };
    }
    if (path === '/estoque/entradas/opcoes/produtos') return opcoes([{ id: 'p-ureia', nome: 'Ureia', codigo: null, unidade_estoque: 'KG', peso_por_saco_kg: null }, { id: 'p-sal', nome: 'Sal mineral', codigo: null, unidade_estoque: 'KG', peso_por_saco_kg: '25.0000' }]);
    if (path === '/estoque/entradas/opcoes/locais') return opcoes([{ id: 'l-galpao', nome: 'Galpão insumos' }, { id: 'l-tanque', nome: 'Tanque diesel sede' }]);
    if (path === '/estoque/entradas/opcoes/fornecedores') return opcoes([{ id: 'f1', nome: 'Agro Sul', numero: '1', papeis: ['fornecedor'] }]);
    if (path === '/estoque/entradas/opcoes/centros-custo') return opcoes([{ id: 'cc1', nome: 'Confinamento', numero: '1' }]);
    if (path === '/estoque/entradas/opcoes/centros-resultado') return opcoes([{ id: 'cr1', nome: 'Pecuária', numero: '1' }]);
    if (path === '/estoque/movimentos/m1' && method === 'GET') {
      const base = await rotearEstoque(req);
      return { ...base, body: { ...base.body, tipo_detalhado: 'entrada_manual', documento: { tipo: 'ENTRADA_ESTOQUE', id: 'e1', numero: '7', rotulo: 'Entrada nº 7 — Compra', pagina: null } } };
    }
    const m = /^\/estoque\/entradas\/([^/]+)(\/excluir)?$/.exec(path);
    if (m && method === 'GET') return { status: 200, body: estado.entradas.find((e) => e.id === m[1]) };
    // D-PROD-271: PATCH da entrada — METADADOS (só observação) ou SUBSTITUICAO (com `itens`).
    if (m && !m[2] && method === 'PATCH') {
      if (estado.falhaDaEdicaoEntrada) return estado.falhaDaEdicaoEntrada;
      const e = estado.entradas.find((x) => x.id === m[1]);
      const editada = body.itens
        ? {
          ...e, versao: e.versao + 1, revisao: e.revisao + 1, motivo_id: body.motivo_id, data_entrada: body.data_entrada, documento_numero: body.documento_numero, observacao: body.observacao,
          itens: body.itens.map((i, k) => ({ ...ITEM, id: `i-n${k + 1}`, ordem: k + 1, quantidade: `${i.quantidade}.0000`, quantidade_estoque: `${i.quantidade}.0000`, revisao_inicio: e.revisao + 1 })),
          itens_historico: e.itens.map((i) => ({ ...i, revisao_fim: e.revisao })),
          eventos: [...e.eventos, { id: 'v-ed', tipo: 'EDICAO', modo: 'SUBSTITUICAO', motivo: body.motivo_edicao, criado_em: '2026-11-13T12:00:00.000Z' }],
        }
        : { ...e, versao: e.versao + 1, revisao: e.revisao + 1, observacao: body.observacao, eventos: [...e.eventos, { id: 'v-obs', tipo: 'EDICAO', modo: 'METADADOS', motivo: body.motivo_edicao, criado_em: '2026-11-13T12:00:00.000Z' }] };
      estado.entradas = estado.entradas.map((x) => (x.id === e.id ? editada : x));
      return { status: 200, body: { ...editada, replay: false } };
    }
    if (path === '/estoque/entradas' && method === 'POST') {
      if (estado.falhaDoPost) return estado.falhaDoPost;
      const criada = { ...ENTRADA, id: 'e2', numero: '8', motivo_id: body.motivo_id };
      estado.entradas = [criada, ...estado.entradas];
      return { status: 201, body: { ...criada, replay: false } };
    }
    if (m && m[2] && method === 'POST') {
      const e = estado.entradas.find((x) => x.id === m[1]);
      const excluida = { ...e, status: 'EXCLUIDA', versao: e.versao + 1, itens: [], itens_historico: e.itens };
      estado.entradas = estado.entradas.map((x) => (x.id === e.id ? excluida : x));
      return { status: 200, body: { ...excluida, replay: false } };
    }
    if (path === '/movimentacoes-estoque/comandos/transferencia-locais' && method === 'POST') return { status: 201, body: { committed: true, operation_id: body.operation_id, replay: false } };
    return rotearEstoque(req);
  };
  return { estado, rotear };
};

/** @type {{ chamadas: any[] }} */
let backend;
let roteador = criarRoteador();
const matchMediaOriginal = window.matchMedia;
const celular = (ligado) => {
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: ligado && /max-width:\s*639px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  window.localStorage.setItem('empresa_selecionada_cliente_id', 'cli-1');
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom({ entrada: true });
  roteador = criarRoteador();
  backend = instalarBackendFake(roteador.rotear);
  celular(false);
});

afterEach(() => {
  cleanup();
  window.matchMedia = matchMediaOriginal;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const montar = async () => {
  const { default: Pagina } = await import('@/pages/Estoque.jsx');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Toaster />
        <Pagina />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const abrirMovimentos = async () => {
  await montar();
  fireEvent.click(await screen.findByTestId('estoque-aba-movimentos'));
  await screen.findByText('Diesel S10', {}, { timeout: 3000 }).catch(() => null);
};
const abrirNovoMovimento = async () => {
  await abrirMovimentos();
  fireEvent.click(await screen.findByRole('button', { name: /Novo movimento/ }));
  return screen.findByTestId('tela-novo-movimento-estoque');
};
const posts = (caminho) => backend.chamadas.filter((c) => c.method === 'POST' && c.path === caminho);
const digitar = (el, valor) => fireEvent.change(el, { target: { value: valor } });
/** Seletor paginado (lista de opções do servidor). */
const escolher = async (janela, testId, rotulo) => {
  await act(async () => fireEvent.click(within(janela).getByTestId(testId)));
  const opcao = await screen.findByRole('option', { name: new RegExp(rotulo, 'i') });
  await act(async () => fireEvent.click(opcao));
};
/** Seletor Base1 de opções fixas (o do motivo). */
const escolherNoSelect = async (rotulo, nome) => {
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    await act(async () => fireEvent.click(screen.getByLabelText(rotulo)));
    const opcao = screen.queryAllByRole('option').find((o) => o.textContent.trim().toLowerCase() === nome.toLowerCase());
    if (opcao) {
      await act(async () => fireEvent.click(opcao));
      return;
    }
  }
  throw new Error(`opção ${nome} não apareceu em ${rotulo}`);
};

describe('D-PROD-259 — abas e botão', () => {
  it('só Saldo e Movimentos: a aba Entradas saiu', async () => {
    await montar();
    expect(await screen.findByTestId('estoque-aba-saldo')).toBeTruthy();
    expect(screen.getByTestId('estoque-aba-movimentos')).toBeTruthy();
    expect(screen.queryByTestId('estoque-aba-entradas')).toBeNull();
  });

  it('sem a ação `entrada` não há "Novo movimento"', async () => {
    sessao.permissao = permissaoCom({});
    await abrirMovimentos();
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === '/estoque/movimentos')).toBe(true));
    expect(screen.queryByRole('button', { name: /Novo movimento/ })).toBeNull();
  });

  it('com a ação: "Novo movimento" abre UMA janela com o tipo de movimento (Entrada ou Transferência); no celular ocupa a tela', async () => {
    celular(true);
    const janela = await abrirNovoMovimento();
    // D-PROD-285: tela cheia Base1 (registro da CadastroBase1Screen), não janela; no celular os produtos viram cartões.
    expect(janela.closest('.b1-janela')).toBeNull();
    expect(janela.querySelector('ul[data-testid$="-tabela"]')).not.toBeNull();
    expect(within(janela).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Entrada', 'Transferência']);
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });
});

describe('D-PROD-285 — tela cheia Base1', () => {
  it('"Novo movimento" troca a lista pela tela do registro (título, ✕/✓ na barra); o ✕ volta para a lista sem gravar', async () => {
    const tela = await abrirNovoMovimento();
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(screen.getByText('Novo movimento de estoque')).toBeTruthy();
    expect(screen.queryByTestId('estoque-aba-movimentos')).toBeNull();
    expect(within(tela).getByTestId('entrada-tabela').tagName).toBe('TABLE');
    const salvar = screen.getByRole('button', { name: 'Salvar' });
    expect(salvar.getAttribute('form')).toBe('formulario-novo-movimento-estoque');
    // O ✕ da barra (o mesmo de todo registro Base1), não o "Cancelar" do pé da tela.
    const fechar = screen.getAllByRole('button', { name: 'Cancelar' }).find((b) => b.classList.contains('mg-act-cancelar'));
    expect(fechar).toBeTruthy();
    fireEvent.click(/** @type {HTMLElement} */ (fechar));
    await waitFor(() => expect(screen.queryByTestId('tela-novo-movimento-estoque')).toBeNull());
    expect(await screen.findByTestId('estoque-aba-movimentos')).toBeTruthy();
    expect(backend.chamadas.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('no celular (390px) os produtos viram cartões com os campos rotulados e o ✕', async () => {
    celular(true);
    const tela = await abrirNovoMovimento();
    fireEvent.click(within(tela).getByTestId('entrada-adicionar-produto'));
    const cartao = within(tela).getByTestId('entrada-linha-1');
    expect(cartao.tagName).toBe('LI');
    expect(within(cartao).getByText('Produto 2')).toBeTruthy();
    expect(within(cartao).getByTestId('entrada-linha-1-remover')).toBeTruthy();
    expect(within(tela).queryByRole('table')).toBeNull();
  });
});

describe('D-PROD-259 — Entrada', () => {
  it('D-PROD-285: os produtos ficam na tabela das Áreas (linha por produto, ✕ no fim, total no rodapé)', async () => {
    const janela = await abrirNovoMovimento();
    fireEvent.click(within(janela).getByTestId('entrada-adicionar-produto'));
    for (const i of [0, 1]) {
      // D-PROD-285: cada produto é uma linha da tabela no desenho das Áreas (b1-tipo-tabela), com os campos nas células.
      const linha = within(janela).getByTestId(`entrada-linha-${i}`);
      expect(linha.tagName).toBe('TR');
      expect(linha.closest('table')?.className).toContain('b1-tipo-tabela');
      expect(within(linha).getByTestId(`entrada-linha-${i}-produto`)).toBeTruthy();
      expect(within(linha).getByTestId(`entrada-linha-${i}-remover`)).toBeTruthy();
    }
    expect(within(janela).getByTestId('entrada-tabela-total').textContent).toContain('Total · 2 produtos');
    fireEvent.click(within(janela).getByTestId('entrada-linha-1-remover'));
    expect(within(janela).queryByTestId('entrada-linha-1')).toBeNull();
    expect(within(janela).queryByTestId('entrada-linha-0-remover')).toBeNull();
  });

  it('no celular a folha de uma lista nasce DENTRO da janela (senão a janela modal cobre a folha e as opções não recebem o toque)', async () => {
    celular(true);
    const janela = await abrirNovoMovimento();
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-linha-0-produto')));
    const folha = await waitFor(() => {
      const f = document.querySelector('.mk-sheet-root');
      expect(f).not.toBeNull();
      return /** @type {HTMLElement} */ (f);
    });
    expect(folha).toBeTruthy();
  });

  it('enviar vazio mostra o que falta e NÃO chama o servidor', async () => {
    const janela = await abrirNovoMovimento();
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    expect(await within(janela).findByText('Escolha o motivo da entrada.')).toBeTruthy();
    expect(within(janela).getByText('Escolha o produto.')).toBeTruthy();
    expect(within(janela).getByText('Escolha o depósito.')).toBeTruthy();
    expect(within(janela).getByText('Informe a quantidade.')).toBeTruthy();
    expect(posts('/estoque/entradas')).toHaveLength(0);
  });

  it('Compra com fornecedor, documento, centros e 2 produtos: o total se calcula e o corpo vai com motivo_id, lote, validade e decimais como TEXTO', async () => {
    const janela = await abrirNovoMovimento();
    await escolherNoSelect('Motivo', 'Compra');
    await escolher(janela, 'entrada-fornecedor', 'Agro Sul');
    digitar(within(janela).getByLabelText(/^Documento/), 'NF 55');
    await escolher(janela, 'entrada-centro-resultado', 'Pecuária');
    await escolher(janela, 'entrada-centro-custo', 'Confinamento');
    await escolher(janela, 'entrada-linha-0-produto', 'Ureia');
    await escolher(janela, 'entrada-linha-0-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('entrada-linha-0-quantidade'), '100');
    digitar(within(janela).getByTestId('entrada-linha-0-custo'), '3,5');
    expect(within(janela).getByTestId('entrada-linha-0-total').value).toBe('350');
    digitar(within(janela).getByLabelText('Lote', { selector: 'input' }), 'L-2026');
    digitar(within(janela).getByTestId('entrada-linha-0-validade'), '2027-03-31');
    fireEvent.click(within(janela).getByTestId('entrada-adicionar-produto'));
    await escolher(janela, 'entrada-linha-1-produto', 'Sal mineral');
    await escolher(janela, 'entrada-linha-1-deposito', 'Tanque diesel sede');
    digitar(within(janela).getByTestId('entrada-linha-1-quantidade'), '10');
    digitar(within(janela).getByTestId('entrada-linha-1-total'), '25');
    expect(within(janela).getByTestId('entrada-linha-1-custo').value).toBe('2,5');
    expect(within(janela).getByTestId('entrada-valor-total').textContent).toMatch(/375,00/);
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/entradas')).toHaveLength(1));
    const corpo = posts('/estoque/entradas')[0].body;
    expect(corpo).toMatchObject({
      empresa_id: 'emp-1', motivo_id: 'mot-compra', fornecedor_id: 'f1', documento_numero: 'NF 55', centro_custo_id: 'cc1', centro_resultado_id: 'cr1', observacao: null,
      itens: [
        { produto_id: 'p-ureia', local_estoque_id: 'l-galpao', unidade: 'KG', quantidade: '100', custo_unitario: '3.5', lote_fabricante: 'L-2026', data_validade: '2027-03-31' },
        { produto_id: 'p-sal', local_estoque_id: 'l-tanque', unidade: 'KG', quantidade: '10', custo_unitario: '2.5', lote_fabricante: null, data_validade: null },
      ],
    });
    expect(corpo.operation_id).toMatch(/^ent-/);
    expect(corpo).not.toHaveProperty('motivo');
    expect(corpo).not.toHaveProperty('justificativa');
    expect(corpo).not.toHaveProperty('cliente_id');
    expect(await screen.findByTestId('janela-entrada-estoque')).toBeTruthy();
  });

  it('Saldo de implantação esconde fornecedor e documento e não os envia', async () => {
    const janela = await abrirNovoMovimento();
    await escolherNoSelect('Motivo', 'Saldo de implantação');
    expect(within(janela).getByTestId('entrada-aviso-implantacao')).toBeTruthy();
    expect(within(janela).queryByTestId('entrada-fornecedor')).toBeNull();
    expect(within(janela).queryByLabelText(/^Documento/)).toBeNull();
    await escolher(janela, 'entrada-linha-0-produto', 'Ureia');
    await escolher(janela, 'entrada-linha-0-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('entrada-linha-0-quantidade'), '50');
    fireEvent.click(within(janela).getByTestId('entrada-linha-0-sem-custo'));
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/entradas')).toHaveLength(1));
    expect(posts('/estoque/entradas')[0].body).toMatchObject({ motivo_id: 'mot-impl', fornecedor_id: null, documento_numero: null, itens: [{ custo_unitario: '0', custo_zero: true }] });
  });

  it('erro do servidor aparece na janela; reenviar o MESMO conteúdo reaproveita a operation_id', async () => {
    roteador.estado.falhaDoPost = { status: 422, body: { code: 'ENTRADA_ESTOQUE_INVALIDA', message: 'x', field: 'fornecedor_id', reason: 'fornecedor_inativo', request_id: 'x' } };
    const janela = await abrirNovoMovimento();
    await escolherNoSelect('Motivo', 'Compra');
    await escolher(janela, 'entrada-linha-0-produto', 'Ureia');
    await escolher(janela, 'entrada-linha-0-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('entrada-linha-0-quantidade'), '10');
    digitar(within(janela).getByTestId('entrada-linha-0-custo'), '3');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    expect((await within(janela).findByTestId('movimento-erro')).textContent).toContain('fornecedor está inativo');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/entradas')).toHaveLength(2));
    const [a, b] = posts('/estoque/entradas');
    expect(a.body.operation_id).toBe(b.body.operation_id);
  });

  it('"Motivos…" gerencia o cadastro DENTRO da mesma janela: incluir um motivo e voltar para a entrada', async () => {
    const janela = await abrirNovoMovimento();
    fireEvent.click(within(janela).getByTestId('entrada-gerenciar-motivos'));
    const motivos = await within(janela).findByTestId('motivos-entrada');
    expect(await within(motivos).findByText('Saldo de implantação')).toBeTruthy();
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    digitar(within(motivos).getByLabelText('Novo motivo'), 'Devolução');
    await act(async () => fireEvent.click(within(motivos).getByTestId('motivo-incluir')));
    await waitFor(() => expect(posts('/estoque/motivos-entrada')).toHaveLength(1));
    expect(posts('/estoque/motivos-entrada')[0].body).toEqual({ nome: 'Devolução' });
    fireEvent.click(within(janela).getByTestId('motivos-voltar'));
    expect(await within(janela).findByTestId('formulario-novo-movimento')).toBeTruthy();
  });
});

describe('D-PROD-259 — Transferência', () => {
  it('mesmo depósito na origem e no destino é recusado na tela; certo, chama o comando de transferência com a quantidade', async () => {
    const janela = await abrirNovoMovimento();
    fireEvent.click(within(janela).getByRole('radio', { name: 'Transferência' }));
    await escolher(janela, 'transferencia-produto', 'Ureia');
    await escolher(janela, 'transferencia-origem', 'Galpão insumos');
    await escolher(janela, 'transferencia-destino', 'Galpão insumos');
    digitar(within(janela).getByTestId('transferencia-quantidade'), '30,5');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    expect(await within(janela).findByText('O destino tem de ser outro depósito.')).toBeTruthy();
    expect(posts('/movimentacoes-estoque/comandos/transferencia-locais')).toHaveLength(0);
    await escolher(janela, 'transferencia-destino', 'Tanque diesel sede');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/movimentacoes-estoque/comandos/transferencia-locais')).toHaveLength(1));
    const corpo = posts('/movimentacoes-estoque/comandos/transferencia-locais')[0].body;
    expect(corpo).toMatchObject({ empresa_id: 'emp-1', produto_id: 'p-ureia', local_origem_id: 'l-galpao', local_destino_id: 'l-tanque', quantidade: 30.5 });
    // D-PROD-310: sem unidade de conversão, o corpo de sempre.
    expect(corpo).not.toHaveProperty('unidade_lancamento');
    expect(corpo.operation_id).toMatch(/^trf-/);
    await waitFor(() => expect(screen.queryByTestId('tela-novo-movimento-estoque')).toBeNull());
  });
});

describe('D-PROD-310 — Transferência numa unidade de conversão', () => {
  it('o produto em sacos mostra a Unidade ao lado da quantidade; 2 Sacos = "= 50 kg" e o comando leva a unidade, a digitada e o kg; sem conversão, nada novo', async () => {
    const janela = await abrirNovoMovimento();
    fireEvent.click(within(janela).getByRole('radio', { name: 'Transferência' }));
    await escolher(janela, 'transferencia-produto', 'Ureia');
    expect(within(janela).queryByLabelText('Unidade')).toBeNull();
    await escolher(janela, 'transferencia-produto', 'Sal mineral');
    await escolherNoSelect('Unidade', 'Sacos');
    await escolher(janela, 'transferencia-origem', 'Galpão insumos');
    await escolher(janela, 'transferencia-destino', 'Tanque diesel sede');
    digitar(within(janela).getByTestId('transferencia-quantidade'), '2');
    expect(within(janela).getByTestId('transferencia-conversao').textContent).toContain('= 50 kg');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/movimentacoes-estoque/comandos/transferencia-locais')).toHaveLength(1));
    expect(posts('/movimentacoes-estoque/comandos/transferencia-locais')[0].body).toMatchObject({ produto_id: 'p-sal', quantidade: 50, unidade_lancamento: 'SACO', quantidade_lancamento: '2' });
  });
});

describe('D-PROD-259 — do movimento para a entrada', () => {
  it('o detalhe do movimento de entrada leva à entrada (fecha um, abre o outro) e lá se exclui com motivo, versão e operation_id', async () => {
    await abrirMovimentos();
    fireEvent.doubleClick((await screen.findByText('101')).closest('tr'));
    const mov = await screen.findByTestId('movimento-abrir-entrada');
    fireEvent.click(mov);
    const janela = await screen.findByTestId('janela-entrada-estoque');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(await within(janela).findByTestId('entrada-detalhe-fornecedor')).toHaveProperty('textContent', 'Agro Sul');
    expect(within(janela).getByTestId('entrada-detalhe-lote').textContent).toBe('L-77');
    fireEvent.click(within(janela).getByTestId('entrada-excluir'));
    digitar(within(janela).getByTestId('entrada-exclusao-motivo'), 'lançada por engano');
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-confirmar-exclusao')));
    await waitFor(() => expect(posts('/estoque/entradas/e1/excluir')).toHaveLength(1));
    expect(posts('/estoque/entradas/e1/excluir')[0].body).toMatchObject({ empresa_id: 'emp-1', versao: 1, motivo: 'lançada por engano' });
    expect(await within(janela).findByTestId('entrada-detalhe-situacao')).toHaveProperty('textContent', 'Excluída');
  });
});

describe('D-PROD-264 — Saída: permissões e tipo', () => {
  it('só com a ação `saida`: "Novo movimento" aparece e a janela abre direto na Saída (sem Entrada nem Transferência)', async () => {
    sessao.permissao = permissaoCom({ saida: true });
    const janela = await abrirNovoMovimento();
    expect(within(janela).queryAllByRole('radio')).toHaveLength(0);
    expect(within(janela).getByTestId('saida-data')).toBeTruthy();
    expect(within(janela).queryByTestId('entrada-data')).toBeNull();
    expect(within(janela).getByTestId('movimento-lancar').textContent).toContain('Lançar saída');
    // Os motivos de ENTRADA não são lidos sem a ação `entrada`.
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === '/estoque/motivos-saida')).toBe(true));
    expect(backend.chamadas.some((c) => c.path === '/estoque/motivos-entrada')).toBe(false);
  });

  it('com `entrada` e `saida` o tipo oferece Entrada, Saída e Transferência', async () => {
    sessao.permissao = permissaoCom({ entrada: true, saida: true });
    const janela = await abrirNovoMovimento();
    expect(within(janela).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Entrada', 'Saída', 'Transferência']);
  });

  it('só com `entrada` a Saída não aparece', async () => {
    const janela = await abrirNovoMovimento();
    expect(within(janela).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Entrada', 'Transferência']);
  });
});

describe('D-PROD-264 — Saída: formulário', () => {
  const abrirSaida = async () => {
    sessao.permissao = permissaoCom({ entrada: true, saida: true });
    const janela = await abrirNovoMovimento();
    fireEvent.click(within(janela).getByRole('radio', { name: 'Saída' }));
    await within(janela).findByTestId('saida-data');
    return janela;
  };

  it('D-PROD-285: os produtos da saída ficam na tabela das Áreas e não têm campo de valor', async () => {
    const janela = await abrirSaida();
    fireEvent.click(within(janela).getByTestId('saida-adicionar-produto'));
    for (const i of [0, 1]) {
      // D-PROD-285: cada produto é uma linha da tabela no desenho das Áreas (b1-tipo-tabela), com os campos nas células.
      const linha = within(janela).getByTestId(`saida-linha-${i}`);
      expect(linha.tagName).toBe('TR');
      expect(linha.closest('table')?.className).toContain('b1-tipo-tabela');
      expect(within(linha).getByTestId(`saida-linha-${i}-produto`)).toBeTruthy();
      expect(within(linha).getByTestId(`saida-linha-${i}-remover`)).toBeTruthy();
    }
    expect(within(janela).getByTestId('saida-tabela-total').textContent).toContain('Total · 2 produtos');
    fireEvent.click(within(janela).getByTestId('saida-linha-1-remover'));
    expect(within(janela).queryByTestId('saida-linha-1')).toBeNull();
    expect(within(janela).queryByTestId('saida-linha-0-remover')).toBeNull();
    expect(within(janela).queryByText(/Valor unitário/)).toBeNull();
    expect(within(janela).queryByTestId('saida-linha-0-custo')).toBeNull();
    expect(within(janela).getByTestId('saida-aviso-custo').textContent).toMatch(/custo médio/);
  });

  it('enviar vazio mostra o que falta e NÃO chama o servidor', async () => {
    const janela = await abrirSaida();
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    expect(await within(janela).findByText('Escolha o motivo da saída.')).toBeTruthy();
    expect(within(janela).getByText('Escolha o produto.')).toBeTruthy();
    expect(within(janela).getByText('Informe a quantidade.')).toBeTruthy();
    expect(posts('/estoque/saidas')).toHaveLength(0);
  });

  it('o seletor de motivo traz só os motivos de SAÍDA ativos; 2 produtos; o corpo vai com quantidade como TEXTO, sem custo e com operation_id', async () => {
    const janela = await abrirSaida();
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === '/estoque/motivos-saida' && c.query.ativos === 'true')).toBe(true));
    await act(async () => fireEvent.click(screen.getByLabelText('Motivo')));
    await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
    const nomes = screen.queryAllByRole('option').map((o) => o.textContent.trim());
    expect(nomes).toEqual(expect.arrayContaining(['Perda', 'Consumo interno', 'Doação']));
    expect(nomes).not.toContain('Vencimento');
    expect(nomes).not.toContain('Compra');
    await act(async () => fireEvent.click(screen.queryAllByRole('option').find((o) => o.textContent.trim() === 'Perda')));
    await escolher(janela, 'saida-centro-resultado', 'Pecuária');
    await escolher(janela, 'saida-centro-custo', 'Confinamento');
    digitar(within(janela).getByTestId('saida-observacao'), 'sacos rasgados');
    await escolher(janela, 'saida-linha-0-produto', 'Ureia');
    await escolher(janela, 'saida-linha-0-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('saida-linha-0-quantidade'), '12,5');
    fireEvent.click(within(janela).getByTestId('saida-adicionar-produto'));
    await escolher(janela, 'saida-linha-1-produto', 'Sal mineral');
    await escolher(janela, 'saida-linha-1-deposito', 'Tanque diesel sede');
    digitar(within(janela).getByTestId('saida-linha-1-quantidade'), '3');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/saidas')).toHaveLength(1));
    const corpo = posts('/estoque/saidas')[0].body;
    expect(corpo).toEqual({
      empresa_id: 'emp-1', operation_id: corpo.operation_id, motivo_id: 'ms-perda', data_saida: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      centro_custo_id: 'cc1', centro_resultado_id: 'cr1', observacao: 'sacos rasgados',
      itens: [
        { produto_id: 'p-ureia', local_estoque_id: 'l-galpao', unidade: 'KG', quantidade: '12.5' },
        { produto_id: 'p-sal', local_estoque_id: 'l-tanque', unidade: 'KG', quantidade: '3' },
      ],
    });
    expect(corpo.operation_id).toMatch(/^sai-/);
    expect(typeof corpo.itens[0].quantidade).toBe('string');
    // Lançada: a janela fecha e abre o detalhe da saída criada.
    const detalhe = await screen.findByTestId('janela-saida-estoque');
    expect(screen.queryByTestId('tela-novo-movimento-estoque')).toBeNull();
    expect(await within(detalhe).findByTestId('saida-detalhe-motivo')).toHaveProperty('textContent', 'Perda');
  });

  it('saldo insuficiente diz a linha e o disponível; reenviar o MESMO conteúdo reaproveita a operation_id', async () => {
    roteador.estado.falhaDaSaida = {
      status: 422,
      body: { code: 'ESTOQUE_SALDO_INSUFICIENTE', message: 'texto do servidor', field: 'itens', reason: 'saldo_lote_insuficiente', details: { indice: 1, disponivel: '40.0000', solicitado: '60.0000', produto_id: 'p-sal', local_estoque_id: 'l-galpao' }, request_id: 'r' },
    };
    const janela = await abrirSaida();
    await escolherNoSelect('Motivo', 'Consumo interno');
    await escolher(janela, 'saida-linha-0-produto', 'Ureia');
    await escolher(janela, 'saida-linha-0-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('saida-linha-0-quantidade'), '10');
    fireEvent.click(within(janela).getByTestId('saida-adicionar-produto'));
    await escolher(janela, 'saida-linha-1-produto', 'Sal mineral');
    await escolher(janela, 'saida-linha-1-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('saida-linha-1-quantidade'), '60');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    const erro = (await within(janela).findByTestId('movimento-erro')).textContent;
    expect(erro).toContain('linha 2');
    expect(erro).toContain('Sal mineral em Galpão insumos');
    expect(erro).toMatch(/disponível 40 kg/);
    expect(erro).toMatch(/pedido 60 kg/);
    expect(erro).not.toContain('texto do servidor');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/saidas')).toHaveLength(2));
    const [a, b] = posts('/estoque/saidas');
    expect(a.body.operation_id).toBe(b.body.operation_id);
  });

  it('"Motivos…" da saída gerencia o cadastro de motivos de SAÍDA na mesma janela: incluir, desativar e voltar', async () => {
    const janela = await abrirSaida();
    fireEvent.click(within(janela).getByTestId('saida-gerenciar-motivos'));
    const motivos = await within(janela).findByTestId('motivos-saida');
    expect(await within(motivos).findByText('Consumo interno')).toBeTruthy();
    expect(within(motivos).getByText('Vencimento')).toBeTruthy();
    expect(within(motivos).queryByText('Saldo de implantação')).toBeNull();
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    digitar(within(motivos).getByLabelText('Novo motivo'), 'Furto');
    await act(async () => fireEvent.click(within(motivos).getByTestId('motivo-incluir')));
    await waitFor(() => expect(posts('/estoque/motivos-saida')).toHaveLength(1));
    expect(posts('/estoque/motivos-saida')[0].body).toEqual({ nome: 'Furto' });
    expect(posts('/estoque/motivos-entrada')).toHaveLength(0);
    await act(async () => fireEvent.click(within(motivos).getByTestId('motivo-ms-perda-ativo')));
    await waitFor(() => expect(backend.chamadas.filter((c) => c.method === 'PATCH' && c.path === '/estoque/motivos-saida/ms-perda')).toHaveLength(1));
    expect(backend.chamadas.find((c) => c.method === 'PATCH' && c.path === '/estoque/motivos-saida/ms-perda').body).toEqual({ ativo: false });
    fireEvent.click(within(janela).getByTestId('motivos-voltar'));
    expect(await within(janela).findByTestId('saida-data')).toBeTruthy();
  });

  it('no celular a folha da lista de produto da saída nasce DENTRO da janela', async () => {
    celular(true);
    const janela = await abrirSaida();
    // D-PROD-285: tela cheia Base1 (registro da CadastroBase1Screen), não janela; no celular os produtos viram cartões.
    expect(janela.closest('.b1-janela')).toBeNull();
    expect(janela.querySelector('ul[data-testid$="-tabela"]')).not.toBeNull();
    await act(async () => fireEvent.click(within(janela).getByTestId('saida-linha-0-produto')));
    const folha = await waitFor(() => {
      const f = document.querySelector('.mk-sheet-root');
      expect(f).not.toBeNull();
      return /** @type {HTMLElement} */ (f);
    });
    expect(folha).toBeTruthy();
  });
});

describe('D-PROD-264 — do movimento para a saída', () => {
  const abrirDetalheDaSaida = async () => {
    await abrirMovimentos();
    fireEvent.doubleClick((await screen.findByText('106')).closest('tr'));
    fireEvent.click(await screen.findByTestId('movimento-abrir-saida'));
    const janela = await screen.findByTestId('janela-saida-estoque');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    return janela;
  };

  it('o movimento de saída manual abre a saída (número, motivo, centros, linhas com valor, histórico) e lá se exclui com motivo, versão e operation_id', async () => {
    sessao.permissao = permissaoCom({ saida: true });
    const janela = await abrirDetalheDaSaida();
    expect(await within(janela).findByTestId('saida-detalhe-motivo')).toHaveProperty('textContent', 'Perda');
    expect(within(janela).getByText('Saída nº 3')).toBeTruthy();
    expect(within(janela).getByTestId('saida-detalhe-centro-resultado').textContent).toBe('Pecuária');
    expect(within(janela).getByTestId('saida-detalhe-observacao').textContent).toBe('sacos rasgados');
    expect(within(janela).getByTestId('saida-detalhe-item').textContent).toMatch(/50 kg de Galpão insumos/);
    expect(within(janela).getByTestId('saida-detalhe-valor').textContent).toMatch(/170,00/);
    expect(within(janela).getByTestId('saida-grupo-hist-rico').textContent).toContain('Saída manual: Perda');
    fireEvent.click(within(janela).getByTestId('saida-excluir'));
    digitar(within(janela).getByTestId('saida-exclusao-motivo'), 'lançada em dobro');
    await act(async () => fireEvent.click(within(janela).getByTestId('saida-confirmar-exclusao')));
    await waitFor(() => expect(posts('/estoque/saidas/s1/excluir')).toHaveLength(1));
    const corpo = posts('/estoque/saidas/s1/excluir')[0].body;
    expect(corpo).toMatchObject({ empresa_id: 'emp-1', versao: 1, motivo: 'lançada em dobro' });
    expect(corpo.operation_id).toMatch(/^sai-exc-/);
    expect(await within(janela).findByTestId('saida-detalhe-situacao')).toHaveProperty('textContent', 'Excluída');
    expect(within(janela).queryByTestId('saida-excluir')).toBeNull();
  });

  it('a exclusão recusada por movimento posterior (409) diz que não dá para excluir e manda lançar uma entrada', async () => {
    sessao.permissao = permissaoCom({ saida: true });
    roteador.estado.falhaDaExclusaoSaida = {
      status: 409,
      body: { code: 'SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR', message: 'texto do servidor', field: 'itens', reason: 'movimento_posterior', request_id: 'r' },
    };
    const janela = await abrirDetalheDaSaida();
    await within(janela).findByTestId('saida-detalhe-motivo');
    fireEvent.click(within(janela).getByTestId('saida-excluir'));
    digitar(within(janela).getByTestId('saida-exclusao-motivo'), 'lançada em dobro');
    await act(async () => fireEvent.click(within(janela).getByTestId('saida-confirmar-exclusao')));
    const erro = (await within(janela).findByTestId('saida-acao-erro')).textContent;
    expect(erro).toContain('outro movimento neste depósito');
    expect(erro).toContain('lance uma entrada');
    expect(erro).not.toContain('texto do servidor');
    expect(within(janela).getByTestId('saida-detalhe-situacao').textContent).toBe('Confirmada');
  });

  it('"Editar observação" manda só a observação, com a versão e o motivo da edição', async () => {
    sessao.permissao = permissaoCom({ saida: true });
    const janela = await abrirDetalheDaSaida();
    await within(janela).findByTestId('saida-detalhe-motivo');
    fireEvent.click(within(janela).getByTestId('saida-editar'));
    digitar(within(janela).getByTestId('saida-edicao-observacao'), 'sacos rasgados na chuva');
    digitar(within(janela).getByTestId('saida-edicao-motivo'), 'detalhe');
    await act(async () => fireEvent.click(within(janela).getByTestId('saida-salvar-edicao')));
    const patch = await waitFor(() => {
      const c = backend.chamadas.find((x) => x.method === 'PATCH' && x.path === '/estoque/saidas/s1');
      expect(c).toBeTruthy();
      return c;
    });
    expect(patch.body).toEqual({ empresa_id: 'emp-1', versao: 1, motivo_edicao: 'detalhe', observacao: 'sacos rasgados na chuva' });
    expect(await within(janela).findByText('sacos rasgados na chuva')).toBeTruthy();
  });

  it('sem a ação `saida` o detalhe da saída abre só para ver (sem Editar nem Excluir)', async () => {
    const janela = await abrirDetalheDaSaida();
    await within(janela).findByTestId('saida-detalhe-motivo');
    expect(within(janela).queryByTestId('saida-excluir')).toBeNull();
    expect(within(janela).queryByTestId('saida-editar')).toBeNull();
  });

  it('o documento SAIDA_ESTOQUE do detalhe do movimento também leva à saída', async () => {
    const { saidaDoMovimento } = await import('@/lib/estoqueSaidasRegras');
    expect(saidaDoMovimento({ documento: { tipo: 'SAIDA_ESTOQUE', id: 's9', numero: '9', rotulo: 'Saída nº 9 — Perda' } })).toEqual({ id: 's9', numero: '9', rotulo: 'Saída nº 9 — Perda' });
    expect(saidaDoMovimento({ origem_sistema: 'saida_estoque', lancamento_origem_id: 's1', documento: null })).toMatchObject({ id: 's1' });
    expect(saidaDoMovimento({ origem_sistema: 'entrada_estoque', lancamento_origem_id: 'e1' })).toBeNull();
  });
});

describe('D-PROD-272 — Ajuste: permissões e tipo', () => {
  it('com `entrada`, `saida` e `ajuste` o tipo oferece Entrada, Saída, Ajuste e Transferência', async () => {
    sessao.permissao = permissaoCom({ entrada: true, saida: true, ajuste: true });
    const janela = await abrirNovoMovimento();
    expect(within(janela).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Entrada', 'Saída', 'Ajuste', 'Transferência']);
  });

  it('só com `ajuste`: "Novo movimento" aparece e a janela abre direto no Ajuste, com a data fixa de hoje', async () => {
    sessao.permissao = permissaoCom({ ajuste: true });
    const janela = await abrirNovoMovimento();
    expect(within(janela).queryAllByRole('radio')).toHaveLength(0);
    expect(within(janela).getByTestId('ajuste-data').textContent).toMatch(/^Hoje \(\d{2}\/\d{2}\/\d{4}\)$/);
    expect(within(janela).queryByTestId('entrada-data')).toBeNull();
    expect(within(janela).getByTestId('movimento-lancar').textContent).toContain('Lançar ajuste');
    expect(backend.chamadas.some((c) => c.path === '/estoque/motivos-entrada' || c.path === '/estoque/motivos-saida')).toBe(false);
  });

  it('sem `ajuste` o Ajuste não aparece', async () => {
    sessao.permissao = permissaoCom({ entrada: true, saida: true });
    const janela = await abrirNovoMovimento();
    expect(within(janela).getAllByRole('radio').map((r) => r.textContent)).not.toContain('Ajuste');
  });
});

describe('D-PROD-272 — Ajuste: formulário', () => {
  const abrirAjuste = async () => {
    sessao.permissao = permissaoCom({ ajuste: true });
    const janela = await abrirNovoMovimento();
    await within(janela).findByTestId('ajuste-data');
    return janela;
  };

  it('D-PROD-285: os produtos do ajuste ficam na tabela das Áreas', async () => {
    const janela = await abrirAjuste();
    fireEvent.click(within(janela).getByTestId('ajuste-adicionar-produto'));
    for (const i of [0, 1]) {
      // D-PROD-285: cada produto é uma linha da tabela no desenho das Áreas (b1-tipo-tabela), com os campos nas células.
      const linha = within(janela).getByTestId(`ajuste-linha-${i}`);
      expect(linha.tagName).toBe('TR');
      expect(linha.closest('table')?.className).toContain('b1-tipo-tabela');
      expect(within(linha).getByTestId(`ajuste-linha-${i}-produto`)).toBeTruthy();
      expect(within(linha).getByTestId(`ajuste-linha-${i}-remover`)).toBeTruthy();
    }
    expect(within(janela).getByTestId('ajuste-tabela-total').textContent).toContain('Total · 2 produtos');
    fireEvent.click(within(janela).getByTestId('ajuste-linha-1-remover'));
    expect(within(janela).queryByTestId('ajuste-linha-1')).toBeNull();
    expect(within(janela).queryByTestId('ajuste-linha-0-remover')).toBeNull();
  });

  it('mostra o saldo atual e a diferença (falta, sobra, sem diferença) ao digitar o contado', async () => {
    const janela = await abrirAjuste();
    await escolher(janela, 'ajuste-linha-0-produto', 'Ureia');
    await escolher(janela, 'ajuste-linha-0-deposito', 'Galpão insumos');
    await waitFor(() => expect(within(janela).getByTestId('ajuste-linha-0-saldo').textContent).toBe('100 kg'));
    expect(backend.chamadas.find((c) => c.path === '/estoque/ajustes/saldo').query).toEqual({ empresa_id: 'emp-1', produto_id: 'p-ureia', local_estoque_id: 'l-galpao' });
    const dif = () => within(janela).getByTestId('ajuste-linha-0-diferenca');
    digitar(within(janela).getByTestId('ajuste-linha-0-contado'), '90');
    expect(dif().textContent).toBe('− 10 kg · Falta');
    expect(dif().getAttribute('data-tipo')).toBe('FALTA');
    digitar(within(janela).getByTestId('ajuste-linha-0-contado'), '112,5');
    expect(dif().textContent).toBe('+ 12,5 kg · Sobra');
    digitar(within(janela).getByTestId('ajuste-linha-0-contado'), '100');
    expect(dif().textContent).toBe('0 kg · Sem diferença');
    // Com custo médio, nunca se pede custo.
    digitar(within(janela).getByTestId('ajuste-linha-0-contado'), '150');
    expect(within(janela).queryByTestId('ajuste-linha-0-custo')).toBeNull();
  });

  it('corpo exato: sem data, contado como TEXTO, custo só na sobra de um depósito sem saldo (obrigatório na tela)', async () => {
    const janela = await abrirAjuste();
    await escolher(janela, 'ajuste-centro-resultado', 'Pecuária');
    digitar(within(janela).getByTestId('ajuste-observacao'), 'contagem de novembro');
    await escolher(janela, 'ajuste-linha-0-produto', 'Ureia');
    await escolher(janela, 'ajuste-linha-0-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('ajuste-linha-0-contado'), '90');
    fireEvent.click(within(janela).getByTestId('ajuste-adicionar-produto'));
    await escolher(janela, 'ajuste-linha-1-produto', 'Sal mineral');
    await escolher(janela, 'ajuste-linha-1-deposito', 'Tanque diesel sede');
    await waitFor(() => expect(within(janela).getByTestId('ajuste-linha-1-saldo').textContent).toBe('0 kg'));
    digitar(within(janela).getByTestId('ajuste-linha-1-contado'), '20');
    expect(await within(janela).findByTestId('ajuste-linha-1-custo')).toBeTruthy();
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    expect(await within(janela).findByText('Este depósito não tem saldo: informe o custo da sobra.')).toBeTruthy();
    expect(posts('/estoque/ajustes')).toHaveLength(0);
    digitar(within(janela).getByTestId('ajuste-linha-1-custo'), '2,5');
    fireEvent.click(within(janela).getByTestId('ajuste-adicionar-produto'));
    await escolher(janela, 'ajuste-linha-2-produto', 'Sal mineral');
    await escolher(janela, 'ajuste-linha-2-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('ajuste-linha-2-contado'), '0');
    await waitFor(() => expect(within(janela).getByTestId('ajuste-linha-2-diferenca').textContent).toBe('− 50 kg · Falta'));
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/ajustes')).toHaveLength(1));
    const corpo = posts('/estoque/ajustes')[0].body;
    expect(corpo).toEqual({
      empresa_id: 'emp-1', operation_id: corpo.operation_id, centro_custo_id: null, centro_resultado_id: 'cr1', observacao: 'contagem de novembro',
      itens: [
        { produto_id: 'p-ureia', local_estoque_id: 'l-galpao', unidade: 'KG', quantidade_contada: '90', custo_unitario: null },
        { produto_id: 'p-sal', local_estoque_id: 'l-tanque', unidade: 'KG', quantidade_contada: '20', custo_unitario: '2.5' },
        { produto_id: 'p-sal', local_estoque_id: 'l-galpao', unidade: 'KG', quantidade_contada: '0', custo_unitario: null },
      ],
    });
    expect(corpo).not.toHaveProperty('data_ajuste');
    expect(corpo.operation_id).toMatch(/^aju-/);
    const detalhe = await screen.findByTestId('janela-ajuste-estoque');
    expect(screen.queryByTestId('tela-novo-movimento-estoque')).toBeNull();
    expect(await within(detalhe).findByTestId('ajuste-detalhe-situacao')).toHaveProperty('textContent', 'Confirmado');
  });

  it('`custo_obrigatorio_sem_saldo` do servidor (o saldo mudou) diz a linha e o produto; reenviar reaproveita a operation_id', async () => {
    roteador.estado.falhaDoAjuste = {
      status: 422,
      body: { code: 'AJUSTE_ESTOQUE_INVALIDO', message: 'texto do servidor', field: 'custo_unitario', reason: 'custo_obrigatorio_sem_saldo', details: { indice: 1 }, request_id: 'r' },
    };
    const janela = await abrirAjuste();
    await escolher(janela, 'ajuste-linha-0-produto', 'Ureia');
    await escolher(janela, 'ajuste-linha-0-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('ajuste-linha-0-contado'), '100');
    fireEvent.click(within(janela).getByTestId('ajuste-adicionar-produto'));
    await escolher(janela, 'ajuste-linha-1-produto', 'Sal mineral');
    await escolher(janela, 'ajuste-linha-1-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('ajuste-linha-1-contado'), '60');
    await waitFor(() => expect(within(janela).getByTestId('ajuste-linha-1-diferenca').textContent).toMatch(/Sobra/));
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    const erro = (await within(janela).findByTestId('movimento-erro')).textContent;
    expect(erro).toContain('Este depósito não tem saldo de Sal mineral; informe o custo da sobra (linha 2)');
    expect(erro).not.toContain('texto do servidor');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/ajustes')).toHaveLength(2));
    const [a, b] = posts('/estoque/ajustes');
    expect(a.body.operation_id).toBe(b.body.operation_id);
  });

  it('no celular a folha da lista de produto do ajuste nasce DENTRO da janela', async () => {
    celular(true);
    const janela = await abrirAjuste();
    // D-PROD-285: tela cheia Base1 (registro da CadastroBase1Screen), não janela; no celular os produtos viram cartões.
    expect(janela.closest('.b1-janela')).toBeNull();
    expect(janela.querySelector('ul[data-testid$="-tabela"]')).not.toBeNull();
    await act(async () => fireEvent.click(within(janela).getByTestId('ajuste-linha-0-produto')));
    const folha = await waitFor(() => {
      const f = document.querySelector('.mk-sheet-root');
      expect(f).not.toBeNull();
      return /** @type {HTMLElement} */ (f);
    });
    expect(folha).toBeTruthy();
  });
});

describe('D-PROD-272 — do movimento para o ajuste', () => {
  const abrirDetalheDoAjuste = async () => {
    await abrirMovimentos();
    fireEvent.doubleClick((await screen.findByText('107')).closest('tr'));
    const link = await screen.findByTestId('movimento-abrir-ajuste');
    expect(link.textContent).toBe('Ajuste de inventário nº 5');
    fireEvent.click(link);
    const janela = await screen.findByTestId('janela-ajuste-estoque');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await within(janela).findByTestId('ajuste-detalhe-situacao');
    return janela;
  };

  it('o movimento de ajuste abre o ajuste (linhas, totais, histórico) e lá se exclui com motivo, versão e operation_id', async () => {
    sessao.permissao = permissaoCom({ ajuste: true });
    const janela = await abrirDetalheDoAjuste();
    expect(within(janela).getByText('Ajuste de inventário nº 5')).toBeTruthy();
    expect(within(janela).getByTestId('ajuste-detalhe-item-0-saldo').textContent).toBe('100 kg');
    expect(within(janela).getByTestId('ajuste-detalhe-item-0-contado').textContent).toBe('90 kg');
    expect(within(janela).getByTestId('ajuste-detalhe-item-0-diferenca').textContent).toBe('− 10 kg · Falta');
    expect(within(janela).getByTestId('ajuste-detalhe-item-0-valor').textContent).toMatch(/30,00/);
    expect(within(janela).getByTestId('ajuste-detalhe-valor-faltas').textContent).toMatch(/30,00/);
    expect(within(janela).getByTestId('ajuste-detalhe-observacao').textContent).toBe('contagem de novembro');
    expect(within(janela).getByTestId('ajuste-grupo-historico').textContent).toContain('Lançado');
    fireEvent.click(within(janela).getByTestId('ajuste-excluir'));
    digitar(within(janela).getByTestId('ajuste-exclusao-motivo'), 'contagem errada');
    await act(async () => fireEvent.click(within(janela).getByTestId('ajuste-confirmar-exclusao')));
    await waitFor(() => expect(posts('/estoque/ajustes/aj1/excluir')).toHaveLength(1));
    const corpo = posts('/estoque/ajustes/aj1/excluir')[0].body;
    expect(corpo).toEqual({ empresa_id: 'emp-1', versao: 1, motivo: 'contagem errada', operation_id: corpo.operation_id });
    expect(corpo.operation_id).toMatch(/^aju-exc-/);
    expect(await within(janela).findByText('Excluído')).toBeTruthy();
    expect(within(janela).queryByTestId('ajuste-excluir')).toBeNull();
  });

  it('a exclusão recusada por movimento posterior (409) diz que não dá e manda fazer uma nova contagem', async () => {
    sessao.permissao = permissaoCom({ ajuste: true });
    roteador.estado.falhaDaExclusaoAjuste = {
      status: 409,
      body: { code: 'AJUSTE_ESTOQUE_MOVIMENTO_POSTERIOR', message: 'texto do servidor', field: 'itens', reason: 'movimento_posterior', request_id: 'r' },
    };
    const janela = await abrirDetalheDoAjuste();
    fireEvent.click(within(janela).getByTestId('ajuste-excluir'));
    digitar(within(janela).getByTestId('ajuste-exclusao-motivo'), 'contagem errada');
    await act(async () => fireEvent.click(within(janela).getByTestId('ajuste-confirmar-exclusao')));
    const erro = (await within(janela).findByTestId('ajuste-acao-erro')).textContent;
    expect(erro).toContain('outro movimento no depósito depois dele');
    expect(erro).toContain('nova contagem');
    expect(erro).not.toContain('texto do servidor');
    expect(within(janela).getByTestId('ajuste-detalhe-situacao').textContent).toBe('Confirmado');
  });

  it('"Editar observação" manda só a observação, com a versão e o motivo da edição', async () => {
    sessao.permissao = permissaoCom({ ajuste: true });
    const janela = await abrirDetalheDoAjuste();
    fireEvent.click(within(janela).getByTestId('ajuste-editar'));
    digitar(within(janela).getByTestId('ajuste-edicao-observacao'), 'recontado');
    digitar(within(janela).getByTestId('ajuste-edicao-motivo'), 'detalhe');
    await act(async () => fireEvent.click(within(janela).getByTestId('ajuste-salvar-edicao')));
    const patch = await waitFor(() => {
      const c = backend.chamadas.find((x) => x.method === 'PATCH' && x.path === '/estoque/ajustes/aj1');
      expect(c).toBeTruthy();
      return c;
    });
    expect(patch.body).toEqual({ empresa_id: 'emp-1', versao: 1, motivo_edicao: 'detalhe', observacao: 'recontado' });
  });

  it('sem a ação `ajuste` o detalhe do ajuste abre só para ver', async () => {
    const janela = await abrirDetalheDoAjuste();
    expect(within(janela).queryByTestId('ajuste-excluir')).toBeNull();
    expect(within(janela).queryByTestId('ajuste-editar')).toBeNull();
  });
});

describe('D-PROD-271 — edição completa da entrada', () => {
  const patches = (caminho) => backend.chamadas.filter((c) => c.method === 'PATCH' && c.path === caminho);
  const abrirDetalheDaEntrada = async () => {
    await abrirMovimentos();
    fireEvent.doubleClick((await screen.findByText('101')).closest('tr'));
    fireEvent.click(await screen.findByTestId('movimento-abrir-entrada'));
    const janela = await screen.findByTestId('janela-entrada-estoque');
    await within(janela).findByTestId('entrada-detalhe-fornecedor');
    return janela;
  };
  const abrirEdicao = async () => {
    const detalhe = await abrirDetalheDaEntrada();
    fireEvent.click(within(detalhe).getByTestId('entrada-editar-completo'));
    return screen.findByTestId('tela-novo-movimento-estoque');
  };

  it('"Editar" abre a janela do movimento em modo edição: tipo fixo, título com o número e todos os campos com a versão vigente', async () => {
    const janela = await abrirEdicao();
    expect(screen.getByText('Editar entrada nº 7')).toBeTruthy();
    expect(screen.queryByTestId('janela-entrada-estoque')).toBeNull();
    expect(within(janela).queryAllByRole('radio')).toHaveLength(0);
    expect(within(janela).getByTestId('entrada-data').value).toBe('2026-11-10');
    expect(within(janela).getByLabelText(/^Documento/).value).toBe('NF 77');
    expect(within(janela).getByTestId('entrada-observacao').value).toBe('compra avulsa');
    expect(within(janela).getByTestId('entrada-fornecedor').textContent).toContain('Agro Sul');
    expect(within(janela).getByTestId('entrada-centro-resultado').textContent).toContain('Pecuária');
    expect(within(janela).getByTestId('entrada-linha-0-produto').textContent).toContain('Ureia');
    expect(within(janela).getByTestId('entrada-linha-0-deposito').textContent).toContain('Galpão insumos');
    expect(within(janela).getByTestId('entrada-linha-0-quantidade').value).toBe('1500');
    expect(within(janela).getByTestId('entrada-linha-0-custo').value).toBe('3,4');
    expect(within(janela).getByTestId('entrada-linha-0-total').value).toBe('5100');
    expect(within(janela).getByLabelText('Lote', { selector: 'input' }).value).toBe('L-77');
    expect(within(janela).getByTestId('entrada-linha-0-validade').value).toBe('2027-03-31');
    expect(within(janela).getByTestId('movimento-motivo-edicao').value).toBe('');
    expect(within(janela).getByTestId('movimento-lancar').textContent).toBe('Salvar edição');
  });

  it('sem o motivo da edição não envia; com ele, o PATCH leva o corpo da criação + versão, motivo e operation_id ent-ed-; o detalhe volta com a versão nova', async () => {
    const janela = await abrirEdicao();
    digitar(within(janela).getByTestId('entrada-linha-0-quantidade'), '1200');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    expect(await within(janela).findByText(/Informe o motivo da edição/)).toBeTruthy();
    expect(patches('/estoque/entradas/e1')).toHaveLength(0);
    digitar(within(janela).getByTestId('movimento-motivo-edicao'), 'contagem errada');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(patches('/estoque/entradas/e1')).toHaveLength(1));
    const corpo = patches('/estoque/entradas/e1')[0].body;
    expect(corpo).toEqual({
      empresa_id: 'emp-1', operation_id: corpo.operation_id, versao: 1, motivo_edicao: 'contagem errada',
      motivo_id: 'mot-compra', data_entrada: '2026-11-10', fornecedor_id: 'f1', documento_numero: 'NF 77', centro_custo_id: null, centro_resultado_id: 'cr1', observacao: 'compra avulsa',
      itens: [{ produto_id: 'p-ureia', local_estoque_id: 'l-galpao', unidade: 'KG', quantidade: '1200', custo_unitario: '3.4', lote_fabricante: 'L-77', data_validade: '2027-03-31' }],
    });
    expect(corpo.operation_id).toMatch(/^ent-ed-/);
    const detalhe = await screen.findByTestId('janela-entrada-estoque');
    expect(screen.queryByTestId('tela-novo-movimento-estoque')).toBeNull();
    expect((await within(detalhe).findByTestId('entrada-detalhe-item')).textContent).toMatch(/1\.200 kg em Galpão insumos/);
    expect(within(detalhe).getByTestId('entrada-grupo-hist-rico').textContent).toContain('Editado (lançamentos refeitos)');
    const versoes = within(detalhe).getByTestId('entrada-versoes-anteriores');
    expect(versoes.tagName).toBe('DETAILS');
    expect(versoes.hasAttribute('open')).toBe(false);
    expect(versoes.textContent).toContain('Versões anteriores (1)');
    expect(within(versoes).getByTestId('entrada-versao-1').textContent).toMatch(/1\.500 kg em Galpão insumos/);
  });

  it('409 de "mexeu depois" diz o produto e o depósito, sem o texto do servidor; o reenvio reaproveita a operation_id', async () => {
    roteador.estado.falhaDaEdicaoEntrada = {
      status: 409,
      body: { code: 'ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS', message: 'texto do servidor', field: 'itens', reason: 'camada_consumida', details: { item_ordem: 1, lote_id: 'c1' }, request_id: 'r' },
    };
    const janela = await abrirEdicao();
    digitar(within(janela).getByTestId('entrada-linha-0-quantidade'), '900');
    digitar(within(janela).getByTestId('movimento-motivo-edicao'), 'contagem errada');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    const erro = (await within(janela).findByTestId('movimento-erro')).textContent;
    expect(erro).toContain('Não dá para editar: o estoque de Ureia no depósito Galpão insumos já foi usado depois desta entrada');
    expect(erro).toContain('Nada foi alterado.');
    expect(erro).not.toContain('texto do servidor');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(patches('/estoque/entradas/e1')).toHaveLength(2));
    const [a, b] = patches('/estoque/entradas/e1');
    expect(a.body.operation_id).toMatch(/^ent-ed-/);
    expect(a.body.operation_id).toBe(b.body.operation_id);
  });

  it('cancelar a edição volta ao detalhe sem gravar', async () => {
    const janela = await abrirEdicao();
    fireEvent.click(within(janela).getByTestId('movimento-cancelar'));
    expect(await screen.findByTestId('janela-entrada-estoque')).toBeTruthy();
    expect(patches('/estoque/entradas/e1')).toHaveLength(0);
  });

  it('"Editar observação" segue mandando só a observação (METADADOS)', async () => {
    const detalhe = await abrirDetalheDaEntrada();
    fireEvent.click(within(detalhe).getByTestId('entrada-editar'));
    digitar(within(detalhe).getByTestId('entrada-edicao-observacao'), 'compra avulsa de outubro');
    digitar(within(detalhe).getByTestId('entrada-edicao-motivo'), 'detalhe');
    await act(async () => fireEvent.click(within(detalhe).getByTestId('entrada-salvar-edicao')));
    await waitFor(() => expect(patches('/estoque/entradas/e1')).toHaveLength(1));
    expect(patches('/estoque/entradas/e1')[0].body).toEqual({ empresa_id: 'emp-1', versao: 1, motivo_edicao: 'detalhe', observacao: 'compra avulsa de outubro' });
    expect(await within(detalhe).findByText('compra avulsa de outubro')).toBeTruthy();
    expect(within(detalhe).getByTestId('entrada-grupo-hist-rico').textContent).toContain('Editada');
    expect(within(detalhe).getByTestId('entrada-grupo-hist-rico').textContent).not.toContain('lançamentos refeitos');
  });

  it('sem a ação `entrada` o detalhe não tem "Editar"', async () => {
    sessao.permissao = permissaoCom({});
    const detalhe = await abrirDetalheDaEntrada();
    expect(within(detalhe).queryByTestId('entrada-editar-completo')).toBeNull();
    expect(within(detalhe).queryByTestId('entrada-editar')).toBeNull();
  });
});

describe('D-PROD-271 — edição completa da saída', () => {
  const patches = () => backend.chamadas.filter((c) => c.method === 'PATCH' && c.path === '/estoque/saidas/s1');
  const abrirEdicao = async () => {
    await abrirMovimentos();
    fireEvent.doubleClick((await screen.findByText('106')).closest('tr'));
    fireEvent.click(await screen.findByTestId('movimento-abrir-saida'));
    const detalhe = await screen.findByTestId('janela-saida-estoque');
    await within(detalhe).findByTestId('saida-detalhe-motivo');
    fireEvent.click(within(detalhe).getByTestId('saida-editar-completo'));
    return screen.findByTestId('tela-novo-movimento-estoque');
  };

  it('"Editar" abre a Saída preenchida, com tipo fixo; o PATCH leva o corpo da criação + versão, motivo e operation_id sai-ed-; o detalhe volta com a versão nova', async () => {
    sessao.permissao = permissaoCom({ entrada: true, saida: true });
    const janela = await abrirEdicao();
    expect(screen.getByText('Editar saída nº 3')).toBeTruthy();
    expect(within(janela).queryAllByRole('radio')).toHaveLength(0);
    expect(within(janela).queryByTestId('entrada-data')).toBeNull();
    expect(within(janela).getByTestId('saida-data').value).toBe('2026-11-12');
    expect(within(janela).getByTestId('saida-observacao').value).toBe('sacos rasgados');
    expect(within(janela).getByTestId('saida-centro-resultado').textContent).toContain('Pecuária');
    expect(within(janela).getByTestId('saida-linha-0-produto').textContent).toContain('Ureia');
    expect(within(janela).getByTestId('saida-linha-0-deposito').textContent).toContain('Galpão insumos');
    expect(within(janela).getByTestId('saida-linha-0-quantidade').value).toBe('50');
    digitar(within(janela).getByTestId('saida-linha-0-quantidade'), '40');
    digitar(within(janela).getByTestId('movimento-motivo-edicao'), 'pesagem refeita');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(patches()).toHaveLength(1));
    const corpo = patches()[0].body;
    expect(corpo).toEqual({
      empresa_id: 'emp-1', operation_id: corpo.operation_id, versao: 1, motivo_edicao: 'pesagem refeita',
      motivo_id: 'ms-perda', data_saida: '2026-11-12', centro_custo_id: null, centro_resultado_id: 'cr1', observacao: 'sacos rasgados',
      itens: [{ produto_id: 'p-ureia', local_estoque_id: 'l-galpao', unidade: 'KG', quantidade: '40' }],
    });
    expect(corpo.operation_id).toMatch(/^sai-ed-/);
    const detalhe = await screen.findByTestId('janela-saida-estoque');
    expect((await within(detalhe).findByTestId('saida-detalhe-item')).textContent).toMatch(/40 kg de Galpão insumos/);
    expect(within(detalhe).getByTestId('saida-grupo-hist-rico').textContent).toContain('Editado (lançamentos refeitos)');
  });

  it('409 de movimento posterior diz o produto, o depósito e o número do movimento; o reenvio reaproveita a operation_id', async () => {
    sessao.permissao = permissaoCom({ saida: true });
    roteador.estado.falhaDaEdicaoSaida = {
      status: 409,
      body: {
        code: 'SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR', message: 'texto do servidor', field: 'itens', reason: 'movimento_posterior',
        details: { item_ordem: 1, produto_id: 'p-ureia', local_estoque_id: 'l-galpao', movimento_numero: '120' }, request_id: 'r',
      },
    };
    const janela = await abrirEdicao();
    digitar(within(janela).getByTestId('saida-linha-0-quantidade'), '45');
    digitar(within(janela).getByTestId('movimento-motivo-edicao'), 'pesagem refeita');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    const erro = (await within(janela).findByTestId('movimento-erro')).textContent;
    expect(erro).toContain('Não dá para editar: o produto Ureia teve outro movimento no depósito Galpão insumos depois desta saída (movimento nº 120).');
    expect(erro).toContain('Nada foi alterado.');
    expect(erro).not.toContain('texto do servidor');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(patches()).toHaveLength(2));
    const [a, b] = patches();
    expect(a.body.operation_id).toMatch(/^sai-ed-/);
    expect(a.body.operation_id).toBe(b.body.operation_id);
  });

  it('sem a ação `saida` o detalhe da saída não tem "Editar"', async () => {
    await abrirMovimentos();
    fireEvent.doubleClick((await screen.findByText('106')).closest('tr'));
    fireEvent.click(await screen.findByTestId('movimento-abrir-saida'));
    const detalhe = await screen.findByTestId('janela-saida-estoque');
    await within(detalhe).findByTestId('saida-detalhe-motivo');
    expect(within(detalhe).queryByTestId('saida-editar-completo')).toBeNull();
  });
});

describe('D-PROD-382 — Editar, Duplicar e Excluir no ⚡ da linha de Movimentos', () => {
  const abrirAcoes = async (numero, produto = 'Ureia') => {
    fireEvent.click(await screen.findByRole('button', { name: `Ações do movimento nº ${numero}` }));
    return screen.findByRole('menu');
  };
  const itensDoMenu = (menu) => within(menu).getAllByRole('menuitem').map((i) => i.textContent.trim());

  it('entrada do estoque: o ⚡ tem Ver detalhes, Editar, Duplicar e Excluir; movimento de outra origem só tem Ver detalhes', async () => {
    await abrirMovimentos();
    expect(itensDoMenu(await abrirAcoes('108'))).toEqual(['Ver detalhes', 'Editar', 'Duplicar', 'Excluir']);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    cleanup();
    await abrirMovimentos();
    expect(itensDoMenu(await abrirAcoes('101'))).toEqual(['Ver detalhes']);
  });

  it('"Editar" vai direto para a tela de edição da entrada, com os campos da versão vigente', async () => {
    await abrirMovimentos();
    fireEvent.click(within(await abrirAcoes('108')).getByRole('menuitem', { name: 'Editar' }));
    const tela = await screen.findByTestId('tela-novo-movimento-estoque');
    expect(screen.getByText('Editar entrada nº 7')).toBeTruthy();
    expect(within(tela).getByTestId('entrada-linha-0-quantidade').value).toBe('1500');
    expect(within(tela).getByTestId('movimento-lancar').textContent).toBe('Salvar edição');
    expect(screen.queryByTestId('janela-entrada-estoque')).toBeNull();
  });

  it('"Duplicar" abre um movimento NOVO com os dados da entrada, a data de hoje e sem o número do documento; lançar faz POST (não PATCH)', async () => {
    await abrirMovimentos();
    fireEvent.click(within(await abrirAcoes('108')).getByRole('menuitem', { name: 'Duplicar' }));
    const tela = await screen.findByTestId('tela-novo-movimento-estoque');
    expect(screen.getAllByText('Novo movimento (cópia da entrada nº 7)').length).toBeGreaterThan(0);
    expect(within(tela).getByTestId('entrada-data').value).not.toBe('2026-11-10');
    expect(within(tela).getByLabelText(/^Documento/).value).toBe('');
    expect(within(tela).getByTestId('entrada-linha-0-produto').textContent).toContain('Ureia');
    expect(within(tela).getByTestId('entrada-linha-0-quantidade').value).toBe('1500');
    expect(within(tela).getByTestId('entrada-linha-0-custo').value).toBe('3,4');
    expect(within(tela).queryByTestId('movimento-motivo-edicao')).toBeNull();
    expect(within(tela).getByTestId('movimento-lancar').textContent).toBe('Lançar entrada');
    await act(async () => fireEvent.click(within(tela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/entradas')).toHaveLength(1));
    const corpo = posts('/estoque/entradas')[0].body;
    expect(corpo).toMatchObject({ empresa_id: 'emp-1', motivo_id: 'mot-compra' });
    expect(corpo.itens[0]).toMatchObject({ produto_id: 'p-ureia', local_estoque_id: 'l-galpao', quantidade: '1500' });
    expect(corpo.versao).toBeUndefined();
    expect(backend.chamadas.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('"Excluir" abre a entrada já pedindo o motivo e exclui com versão e operation_id', async () => {
    await abrirMovimentos();
    fireEvent.click(within(await abrirAcoes('108')).getByRole('menuitem', { name: 'Excluir' }));
    const janela = await screen.findByTestId('janela-entrada-estoque');
    digitar(await within(janela).findByTestId('entrada-exclusao-motivo'), 'lançada por engano');
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-confirmar-exclusao')));
    await waitFor(() => expect(posts('/estoque/entradas/e1/excluir')).toHaveLength(1));
    expect(posts('/estoque/entradas/e1/excluir')[0].body).toMatchObject({ empresa_id: 'emp-1', versao: 1, motivo: 'lançada por engano' });
    expect(await within(janela).findByTestId('entrada-detalhe-situacao')).toHaveProperty('textContent', 'Excluída');
  });

  it('"Duplicar" também está no detalhe da entrada', async () => {
    await abrirMovimentos();
    fireEvent.doubleClick((await screen.findByText('101')).closest('tr'));
    fireEvent.click(await screen.findByTestId('movimento-abrir-entrada'));
    const janela = await screen.findByTestId('janela-entrada-estoque');
    fireEvent.click(await within(janela).findByTestId('entrada-duplicar'));
    expect((await screen.findAllByText('Novo movimento (cópia da entrada nº 7)')).length).toBeGreaterThan(0);
  });

  it('saída manual: Editar, Duplicar e Excluir com a ação `saida`; Duplicar lança uma saída nova', async () => {
    sessao.permissao = permissaoCom({ saida: true });
    await abrirMovimentos();
    expect(itensDoMenu(await abrirAcoes('106'))).toEqual(['Ver detalhes', 'Editar', 'Duplicar', 'Excluir']);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Duplicar' }));
    const tela = await screen.findByTestId('tela-novo-movimento-estoque');
    expect(screen.getAllByText('Novo movimento (cópia da saída nº 3)').length).toBeGreaterThan(0);
    expect(within(tela).getByTestId('movimento-lancar').textContent).toBe('Lançar saída');
  });

  it('"Excluir" da saída abre a saída já pedindo o motivo', async () => {
    sessao.permissao = permissaoCom({ saida: true });
    await abrirMovimentos();
    fireEvent.click(within(await abrirAcoes('106')).getByRole('menuitem', { name: 'Excluir' }));
    const janela = await screen.findByTestId('janela-saida-estoque');
    expect(await within(janela).findByTestId('saida-exclusao-motivo')).toBeTruthy();
  });

  it('ajuste: só Excluir (sem edição); abre o ajuste já pedindo o motivo', async () => {
    sessao.permissao = permissaoCom({ ajuste: true });
    await abrirMovimentos();
    expect(itensDoMenu(await abrirAcoes('107'))).toEqual(['Ver detalhes', 'Excluir']);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Excluir' }));
    const janela = await screen.findByTestId('janela-ajuste-estoque');
    expect(await within(janela).findByTestId('ajuste-exclusao-motivo')).toBeTruthy();
  });

  it('sem a ação da tela, o ⚡ só tem Ver detalhes (a entrada sem `entrada`, a saída sem `saida`)', async () => {
    sessao.permissao = permissaoCom({ ajuste: true });
    await abrirMovimentos();
    expect(itensDoMenu(await abrirAcoes('108'))).toEqual(['Ver detalhes']);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(itensDoMenu(await abrirAcoes('106'))).toEqual(['Ver detalhes']);
  });
});
