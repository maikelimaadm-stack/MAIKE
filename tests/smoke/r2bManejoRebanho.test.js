/**
 * R2B-P1 (D-PROD-101) — frontend do comando atômico do rebanho.
 *
 * Corpo do comando por formulário, envio online-only com pendência
 * idempotente (sem duplicar e sem replay de conteúdo divergente), botão de
 * cancelamento só com proveniência R2B, e histórico por qualquer participante.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { corpoNascimento, corpoPesagem, corpoMudancaCategoria, descreverLinhasDoMovimento, idsDeLotesDoMovimento } from '@/domain/lotes/manejoRebanho';
import { enviarManejoRebanho, lerPendencia, mensagemDoErro, CODIGO_OFFLINE, CODIGO_PENDENTE } from '@/services/manejoRebanhoService';
import { tipoTemCancelamento, motivoSemCancelamento, MENSAGEM_LEGADO_SEM_PROVA } from '@/domain/lotes/situacaoMovimento';
import { filtrarMovimentacoes, ESCOPO_LOTES } from '@/domain/lotes/historicoMovimentacoes';

const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const erroServidor = (code) => Object.assign(new Error(code), { code: 'API_OPERATION_FAILED', cause: { code } });

const LOTES = [
  { id: 'l1', nome: 'L1', categoria: 'Boi 25 a 36 meses', quantidade_cabecas: 50, status: 'Ativo', area_atual_id: 'A' },
  { id: 'l2', nome: 'L2', categoria: 'Boi 25 a 36 meses', quantidade_cabecas: 40, status: 'Ativo', area_atual_id: 'A' },
  { id: 'l3', nome: 'L3', categoria: 'Garrote 13 a 24 meses', quantidade_cabecas: 30, status: 'Ativo', area_atual_id: 'A' },
  { id: 'l4', nome: 'L4', categoria: 'Garrote 13 a 24 meses', quantidade_cabecas: 0, status: 'Inativo', area_atual_id: 'A' },
];

describe('R2B corpo do comando (um envio por confirmação)', () => {
  it('nascimento com 2 linhas vira UM corpo com 2 linhas; peso vazio = null', () => {
    const c = corpoNascimento({ empresaId: 'e', areaId: 'A', formData: { data_nascimento: '2026-10-30', observacoes: ' ', linhas: [
      { categoria_mae: 'Vaca + 36 meses', quantidade: 10, sexo: 'Macho', peso_medio: 30 },
      { categoria_mae: 'Vaca + 36 meses', quantidade: 8, sexo: 'Fêmea', peso_medio: null },
    ] } });
    expect(c).toEqual({ tipo: 'Nascimento', empresa_id: 'e', area_id: 'A', data_movimentacao: '2026-10-30T12:00:00.000Z', linhas: [
      { sexo: 'Macho', categoria_mae: 'Vaca + 36 meses', quantidade: 10, peso_medio_kg: 30 },
      { sexo: 'Fêmea', categoria_mae: 'Vaca + 36 meses', quantidade: 8, peso_medio_kg: null },
    ] });
  });

  it('pesagem por categoria: lotes da mesma categoria são linhas SEPARADAS; inativo fica fora', () => {
    const c = corpoPesagem({ empresaId: 'e', areaId: 'A', lotes: LOTES, formData: { modo: 'por_categoria', data_pesagem: '2026-10-30', categorias_selecionadas: ['Boi 25 a 36 meses', 'Garrote 13 a 24 meses'], pesos_por_categoria: { 'Boi 25 a 36 meses': 420, 'Garrote 13 a 24 meses': 300 } } });
    expect(c.modo_pesagem).toBe('por_categoria');
    expect(c.linhas.map((l) => [l.lote_id, l.peso_medio_kg])).toEqual([['l1', 420], ['l2', 420], ['l3', 300]]);
  });

  it('pesagem por lote: SÓ lotes com peso digitado (sem peso da categoria como substituto)', () => {
    const c = corpoPesagem({ empresaId: 'e', areaId: 'A', lotes: LOTES, formData: { modo: 'por_lote', data_pesagem: '2026-10-30', categorias_selecionadas: ['Boi 25 a 36 meses'], pesos_por_categoria: { 'Boi 25 a 36 meses': 999 }, pesos_por_lote: { l1: '415', l2: '' } } });
    expect(c.linhas).toEqual([{ lote_id: 'l1', peso_medio_kg: 415 }]);
  });

  it('pesagem todos: mesmo peso em cada lote ativo', () => {
    const c = corpoPesagem({ empresaId: 'e', areaId: 'A', lotes: LOTES, formData: { modo: 'todos', data_pesagem: '2026-10-30', categorias_selecionadas: ['Boi 25 a 36 meses', 'Garrote 13 a 24 meses'], pesos_por_categoria: { 'Boi 25 a 36 meses': 400, 'Garrote 13 a 24 meses': 400 } } });
    expect(c.modo_pesagem).toBe('todos');
    expect(c.linhas.map((l) => l.lote_id)).toEqual(['l1', 'l2', 'l3']);
  });

  it('mudança: id da categoria de manejo só quando escolhido; nada de cabeças por lote no corpo', () => {
    const c = corpoMudancaCategoria({ empresaId: 'e', areaId: 'A', formData: { data_mudanca: '2026-10-30', mudancas: [
      { categoria_atual: 'Garrote 13 a 24 meses', categoria_nova: 'Boi 25 a 36 meses', quantidade: 20, categoria_manejo_id_novo: 'cm1', peso_medio: null },
      { categoria_atual: 'Garrote 13 a 24 meses', categoria_nova: 'Touro + 36 meses', quantidade: 5 },
    ] } });
    expect(c.linhas).toEqual([
      { categoria_atual: 'Garrote 13 a 24 meses', categoria_nova: 'Boi 25 a 36 meses', quantidade: 20, categoria_manejo_id_novo: 'cm1', peso_medio_kg: null },
      { categoria_atual: 'Garrote 13 a 24 meses', categoria_nova: 'Touro + 36 meses', quantidade: 5, peso_medio_kg: null },
    ]);
  });
});

describe('R2B envio: online-only e pendência idempotente', () => {
  const corpo = { tipo: 'Pesagem', empresa_id: 'e', area_id: 'A', data_movimentacao: '2026-10-30T12:00:00.000Z', linhas: [{ lote_id: 'l1', peso_medio_kg: 410 }] };
  let storage;
  beforeEach(() => { storage = memoria(); });

  it('offline: recusa ANTES de enviar e não cria pendência', async () => {
    const enviar = vi.fn();
    await expect(enviarManejoRebanho(corpo, { escopo: 'c:u', enviar, online: () => false, storage })).rejects.toMatchObject({ code: CODIGO_OFFLINE });
    expect(enviar).not.toHaveBeenCalled();
    expect(storage.m.size).toBe(0);
  });

  it('resultado desconhecido (rede/5xx): mantém a chave; reenvio do MESMO conteúdo usa a MESMA operation_id', async () => {
    const enviar = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ replay: true });
    await expect(enviarManejoRebanho(corpo, { escopo: 'c:u', enviar, online: () => true, storage })).rejects.toThrow();
    const pend = lerPendencia('c:u', corpo, storage);
    expect(pend?.operation_id).toMatch(/^rebanho-/);
    await enviarManejoRebanho(corpo, { escopo: 'c:u', enviar, online: () => true, storage });
    expect(enviar.mock.calls[0][0].operation_id).toBe(enviar.mock.calls[1][0].operation_id);
    expect(lerPendencia('c:u', corpo, storage)).toBeNull();
  });

  it('500 do servidor também mantém a chave (pode ter havido commit? não; mas reenviar é seguro)', async () => {
    const enviar = vi.fn().mockRejectedValue(erroServidor('INTERNAL_ERROR'));
    await expect(enviarManejoRebanho(corpo, { escopo: 'c:u', enviar, online: () => true, storage })).rejects.toThrow();
    expect(lerPendencia('c:u', corpo, storage)).not.toBeNull();
  });

  it('recusa definitiva 4xx limpa a pendência e mostra mensagem estável', async () => {
    const enviar = vi.fn().mockRejectedValue(erroServidor('MANEJO_SALDO_INSUFICIENTE'));
    const erro = await enviarManejoRebanho(corpo, { escopo: 'c:u', enviar, online: () => true, storage }).catch((e) => e);
    expect(lerPendencia('c:u', corpo, storage)).toBeNull();
    expect(mensagemDoErro(erro)).toMatch(/Saldo insuficiente.*Nada foi gravado/);
  });

  it('pendência aberta + conteúdo DIFERENTE: sem confirmação não envia; com descarte consciente usa chave nova', async () => {
    const enviar = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({});
    await enviarManejoRebanho(corpo, { escopo: 'c:u', enviar, online: () => true, storage }).catch(() => {});
    const outro = { ...corpo, linhas: [{ lote_id: 'l1', peso_medio_kg: 999 }] };
    await expect(enviarManejoRebanho(outro, { escopo: 'c:u', enviar, online: () => true, storage, confirmarDescarte: () => false })).rejects.toMatchObject({ code: CODIGO_PENDENTE });
    expect(enviar).toHaveBeenCalledTimes(1);
    await enviarManejoRebanho(outro, { escopo: 'c:u', enviar, online: () => true, storage, confirmarDescarte: () => true });
    expect(enviar.mock.calls[1][0].operation_id).not.toBe(enviar.mock.calls[0][0].operation_id);
  });

  it('escopo por usuário: pendência de um usuário não vale para outro', async () => {
    const enviar = vi.fn().mockRejectedValueOnce(new TypeError('x'));
    await enviarManejoRebanho(corpo, { escopo: 'c:u1', enviar, online: () => true, storage }).catch(() => {});
    expect(lerPendencia('c:u2', corpo, storage)).toBeNull();
  });
});

describe('R2B cancelamento e histórico na tela', () => {
  const efeitos = [{ lote_id: 'l1', auditoria_id: 'a1' }, { lote_id: 'l2', auditoria_id: 'a2' }];
  it('Pesagem/Nascimento/Mudança com proveniência do comando do rebanho oferecem cancelamento', () => {
    for (const tipo of ['Pesagem', 'Nascimento', 'Mudança de Categoria']) {
      expect(tipoTemCancelamento({ tipo, lote_ids: ['l1', 'l2'], efeito_servidor: { comando: 'manejo_mapa_rebanho', efeitos } })).toBe(true);
    }
  });
  it('legado (POST+PATCH), comando trocado ou participantes incompletos: sem botão', () => {
    expect(tipoTemCancelamento({ tipo: 'Pesagem', lote_id: 'l1' })).toBe(false);
    expect(motivoSemCancelamento({ tipo: 'Pesagem', lote_id: 'l1' })).toBe(MENSAGEM_LEGADO_SEM_PROVA);
    expect(tipoTemCancelamento({ tipo: 'Pesagem', lote_ids: ['l1', 'l2'], efeito_servidor: { comando: 'manejo_mapa_lote', efeitos } })).toBe(false);
    expect(tipoTemCancelamento({ tipo: 'Pesagem', lote_ids: ['l1'], efeito_servidor: { comando: 'manejo_mapa_rebanho', efeitos } })).toBe(false);
    expect(tipoTemCancelamento({ tipo: 'Pesagem', situacao: 'cancelado', lote_ids: ['l1', 'l2'], efeito_servidor: { comando: 'manejo_mapa_rebanho', efeitos } })).toBe(false);
  });
  it('R2A intacto: Morte do comando de lote continua cancelável; Morte com comando do rebanho não', () => {
    expect(tipoTemCancelamento({ tipo: 'Morte', lote_id: 'l1', efeito_servidor: { comando: 'manejo_mapa_lote', efeitos: [efeitos[0]] } })).toBe(true);
    expect(tipoTemCancelamento({ tipo: 'Morte', lote_id: 'l1', efeito_servidor: { comando: 'manejo_mapa_rebanho', efeitos: [efeitos[0]] } })).toBe(false);
  });
  it('histórico por lote (offline) acha o movimento agregado por QUALQUER participante', () => {
    const mov = { id: 'm1', empresa_id: 'e', tipo: 'Pesagem', lote_id: 'l1', lote_ids: ['l1', 'l2', 'l3'], efeito_servidor: { efeitos: [] }, created_date: '2026-10-30' };
    expect(filtrarMovimentacoes([mov], { empresaId: 'e', escopo: ESCOPO_LOTES, lotes: [{ id: 'l3', nome: 'L3' }] }).map((m) => m.id)).toEqual(['m1']);
    expect(filtrarMovimentacoes([mov], { empresaId: 'e', escopo: ESCOPO_LOTES, lotes: [{ id: 'lx', nome: 'L1' }] })).toEqual([]);
    expect(idsDeLotesDoMovimento(mov)).toEqual(['l1', 'l2', 'l3']);
  });
  it('linhas legíveis: pesos anterior/novo/ganho, filhotes, mudança total/parcial', () => {
    expect(descreverLinhasDoMovimento({ tipo: 'Pesagem', linhas: [{ lote_nome: 'L1', quantidade_cabecas: 50, peso_anterior_kg: 400, peso_novo_kg: 420, ganho_kg: 20 }] })).toEqual(['L1 (50 cab): 400 kg → 420 kg (+20 kg)']);
    expect(descreverLinhasDoMovimento({ tipo: 'Nascimento', linhas: [{ quantidade: 10, sexo: 'Macho', categoria_mae: 'Vaca + 36 meses', categoria_filhote: 'Bezerro 0 a 12 meses', peso_medio_kg: 30, lote_criado: true }] })[0]).toMatch(/10 macho\(s\) de Vaca \+ 36 meses → Bezerro 0 a 12 meses \(30 kg\) · lote novo/);
    expect(descreverLinhasDoMovimento({ tipo: 'Mudança de Categoria', linhas: [{ quantidade: 50, categoria_atual: 'G', categoria_nova: 'B', partes: [{ modo: 'total', quantidade: 30 }, { modo: 'parcial', quantidade: 20 }] }] })[0]).toBe('50 de G → B · 30 no mesmo lote, 20 para lote novo');
  });
});
