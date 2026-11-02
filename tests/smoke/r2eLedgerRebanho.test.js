/**
 * R2E-P1 (D-PROD-107) — frontend do ledger de posições: corpo da transferência
 * (uma confirmação = um POST, sem lote derivado), envio online-only com
 * pendência idempotente, mensagem do veredito temporal do servidor, mapa
 * lendo posições quando a empresa está ativada e DetalhesLote sem validação
 * temporal do navegador nem PATCH/POST legado no modo ledger.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { corpoTransferenciaLedger, ehPosicaoDoLedger } from '@/domain/lotes/manejoRebanho';
import { enviarTransferenciaLedger, mensagemDaTransferenciaLedger, CODIGO_OFFLINE } from '@/services/manejoRebanhoService';

const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const BOI = 'Boi 25 a 36 meses';
const P = (id, numero, qtd, categoria = BOI) => ({ id, __posicao: true, numero_lote: numero, quantidade_cabecas: qtd, categoria, area_atual_id: 'A' });

describe('R2E corpo da transferência no ledger', () => {
  it('por categoria: distribui pela ordem estável (número do lote, id); data vira o dia escrito ao meio-dia UTC', () => {
    const { corpo, faltando } = corpoTransferenciaLedger({
      empresaId: 'e', areaDestinoId: 'B', data: '2026-11-01',
      posicoes: [P('p10', '10', 30), P('p2', '2', 20), P('v1', '1', 5, 'Vaca + 36 meses')],
      formData: { mover_todos: 'nao', movimentacoes: [{ categoria: 'BOI 25 A 36 MESES', quantidade: 35 }] },
    });
    expect(faltando).toEqual([]);
    expect(corpo).toEqual({ empresa_id: 'e', area_destino_id: 'B', data_movimentacao: '2026-11-01T12:00:00.000Z', itens: [{ posicao_id: 'p2', quantidade: 20 }, { posicao_id: 'p10', quantidade: 15 }] });
  });
  it('mover todos leva cada posição inteira; pedido acima do disponível acusa a falta (sem enviar)', () => {
    expect(corpoTransferenciaLedger({ empresaId: 'e', areaDestinoId: 'B', data: '2026-11-02', posicoes: [P('a', '1', 10), P('b', '2', 0)], formData: { mover_todos: 'sim' } }).corpo.itens).toEqual([{ posicao_id: 'a', quantidade: 10 }]);
    const r = corpoTransferenciaLedger({ empresaId: 'e', areaDestinoId: 'B', data: '2026-11-02', posicoes: [P('a', '1', 10)], formData: { movimentacoes: [{ categoria: BOI, quantidade: 12 }] } });
    expect(r.faltando).toEqual([{ categoria: BOI, faltam: 2 }]);
  });
  it('só posição marcada pelo servidor conta como posição (Lote de cadastro não)', () => {
    expect(ehPosicaoDoLedger({ id: 'x', __posicao: true })).toBe(true);
    expect(ehPosicaoDoLedger({ id: 'x', quantidade_cabecas: 5 })).toBe(false);
  });
});

describe('R2E envio e mensagens', () => {
  const corpo = { empresa_id: 'e', area_destino_id: 'B', data_movimentacao: '2026-11-01T12:00:00.000Z', itens: [{ posicao_id: 'p', quantidade: 1 }] };
  it('offline: recusa ANTES de requisição e sem fila; online: corpo enviado sem campos locais', async () => {
    const enviar = vi.fn().mockResolvedValue({ movimentacao: { id: 'm' } });
    const storage = memoria();
    await expect(enviarTransferenciaLedger(corpo, { escopo: 'c:u', enviar, online: () => false, storage })).rejects.toMatchObject({ code: CODIGO_OFFLINE });
    expect(enviar).not.toHaveBeenCalled();
    await enviarTransferenciaLedger(corpo, { escopo: 'c:u', enviar, online: () => true, storage });
    const enviado = enviar.mock.calls[0][0];
    expect(Object.keys(enviado).sort()).toEqual(['area_destino_id', 'data_movimentacao', 'empresa_id', 'itens', 'operation_id']);
    expect([...storage.m.keys()]).toEqual([]);
  });
  it('resultado desconhecido reaproveita a chave no reenvio do mesmo conteúdo', async () => {
    const storage = memoria();
    const enviar = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ replay: true });
    await expect(enviarTransferenciaLedger(corpo, { escopo: 'c:u', enviar, online: () => true, storage })).rejects.toThrow();
    await enviarTransferenciaLedger(corpo, { escopo: 'c:u', enviar, online: () => true, storage });
    expect(enviar.mock.calls[0][0].operation_id).toBe(enviar.mock.calls[1][0].operation_id);
  });
  it('veredito temporal do servidor vira mensagem com data, área, disponível e pedido', () => {
    const erro = Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'REBANHO_SALDO_HISTORICO_NEGATIVO', details: { data: '2026-11-01', area_nome: 'PASTO A', disponivel: 400, pedido: 450 } } });
    expect(mensagemDaTransferenciaLedger(erro)).toBe('Saldo insuficiente em PASTO A no dia 01/11/2026. Disponível na data: 400 cab; pedido: 450 cab. Nada foi gravado.');
  });
});

describe('R2E mapa e DetalhesLote no modo ledger', () => {
  it('o loader "lotes" do mapa usa as posições quando o ledger está ativo e não cai para Lote em erro', () => {
    const fonte = readFileSync('src/services/mapaCacheService.js', 'utf8');
    const trecho = fonte.slice(fonte.indexOf('  lotes: async'), fonte.indexOf('  icones:'));
    expect(trecho).toMatch(/listarPosicoesRebanhoServidor\(empresaId\)/);
    expect(trecho).toMatch(/if \(ledger\?\.ativo\) return ledger\.itens;/);
    expect(trecho).not.toMatch(/catch/);
  });
  it('transferência no ledger: um comando, sem validarOrdemTemporal, sem PATCH/POST/criarLote; PR174-R1: todas as operações abrem (sem seMigrado)', () => {
    const fonte = readFileSync('src/components/mapa/DetalhesLote.jsx', 'utf8');
    const ledger = fonte.slice(fonte.indexOf('      if (modoLedger) {'), fonte.indexOf('      const movimentacoesCriadas = [];'));
    expect(ledger).toMatch(/enviarTransferenciaLedger\(\{ operation_id: chaveTransferenciaLedger\.current, \.\.\.corpo \}/);
    expect(ledger).not.toMatch(/validarOrdemTemporal|atualizarLote|criarMovimentacao|criarLote|registrarManejoLote/);
    expect(ledger).toMatch(/return resposta\?\.movimentacao/);
    expect(fonte).not.toMatch(/seMigrado|ainda não foi migrada/);
    for (const abrir of ['setShowAbate', 'setShowMorte', 'setShowNascimento', 'setShowMudancaCategoria', 'setShowPesagem']) {
      expect(fonte).toMatch(new RegExp(`onClick=\\{\\(\\) => ${abrir}\\(true\\)\\}`));
    }
  });
  it('PR174-R1 sobras no ledger: passo SEPARADO depois do comando; falha vira aviso explícito (sem falso sucesso)', () => {
    const fonte = readFileSync('src/components/mapa/DetalhesLote.jsx', 'utf8');
    const ledger = fonte.slice(fonte.indexOf('      if (modoLedger) {'), fonte.indexOf('      const movimentacoesCriadas = [];'));
    const iCmd = ledger.indexOf('await enviarTransferenciaLedger(');
    const iSobras = ledger.indexOf('await registrarSobrasNoDestino(posicoesAtuais)');
    expect(iCmd).toBeGreaterThan(-1);
    expect(iSobras).toBeGreaterThan(iCmd);
    expect(ledger).not.toMatch(/ainda não está disponível no controle por posições/);
    expect(ledger).toMatch(/avisoSobrasLedger\.current = `Transferência registrada, mas as sobras do cocho NÃO foram registradas/);
    expect(fonte).toMatch(/toast\.warning\(avisoSobrasLedger\.current\)/);
  });
});

describe('R2E duplo toque na transferência do ledger (achado do E2E)', () => {
  it('handleMovimentacao no ledger tem trava síncrona e espera a mutação (o botão não reabilita no meio)', () => {
    const fonte = readFileSync('src/components/mapa/DetalhesLote.jsx', 'utf8');
    const trecho = fonte.slice(fonte.indexOf('  const handleMovimentacao = async'), fonte.indexOf('  setMovimentacaoPendente(formData);'));
    expect(trecho).toMatch(/if \(transferenciaEmAndamento\.current\) return;/);
    expect(trecho).toMatch(/await movimentacaoMutation\.mutateAsync\(formData\)/);
    expect(trecho).not.toMatch(/movimentacaoMutation\.mutate\(formData\)/);
  });
});

describe('R2E histórico: movimento do ledger é certificado (achado do E2E)', () => {
  it('transferência do ledger oferece cancelamento; sem evento_id não', async () => {
    const { tipoTemCancelamento, motivoSemCancelamento } = await import('@/domain/lotes/situacaoMovimento');
    const mov = { tipo: 'Transferência de Área', lote_id: 'l', efeito_servidor: { comando: 'rebanho_ledger', evento_id: 'ev1' } };
    expect(tipoTemCancelamento(mov)).toBe(true);
    expect(motivoSemCancelamento(mov)).toBe(null);
    expect(tipoTemCancelamento({ ...mov, efeito_servidor: { comando: 'rebanho_ledger' } })).toBe(false);
  });
  it('PR174-R1: todo manejo do ledger (morte, abate, nascimento, pesagem, mudança, junção) é certificado', async () => {
    const { tipoTemCancelamento, ehMovimentoDoLedger } = await import('@/domain/lotes/situacaoMovimento');
    for (const tipo of ['Morte', 'Abate', 'Nascimento', 'Pesagem', 'Mudança de Categoria', 'Junção de Lotes']) {
      const mov = { tipo, lote_id: 'l', lote_ids: ['p', 'l'], efeito_servidor: { comando: 'rebanho_ledger', evento_id: 'ev1' } };
      expect(ehMovimentoDoLedger(mov)).toBe(true);
      expect(tipoTemCancelamento(mov)).toBe(true);
    }
    expect(ehMovimentoDoLedger({ tipo: 'Entrada', efeito_servidor: { comando: 'rebanho_ledger', evento_id: 'e' } })).toBe(false);
  });
  it('mensagem lê os details mesclados pelo cliente nativo (erro.details)', () => {
    const erro = Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'REBANHO_SALDO_HISTORICO_NEGATIVO' }, details: { data: '2026-12-19', area_nome: 'PASTO B', disponivel: 67, pedido: 72 } });
    expect(mensagemDaTransferenciaLedger(erro)).toBe('Saldo insuficiente em PASTO B no dia 19/12/2026. Disponível na data: 67 cab; pedido: 72 cab. Nada foi gravado.');
  });
});
