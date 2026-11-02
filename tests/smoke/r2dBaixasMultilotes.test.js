/**
 * R2D-P1 (D-PROD-105) — frontend da baixa multi-lote (Morte/Abate).
 *
 * Uma confirmação = UM corpo (todas as categorias), online-only, pendência
 * idempotente; DetalhesLote sem laço de comandos por lote nem POST+PATCH
 * legado; histórico legível; cancelamento oferecido só com proveniência.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { corpoBaixa, descreverLinhasDoMovimento } from '@/domain/lotes/manejoRebanho';
import { enviarBaixaRebanho, mensagemDoErro, CODIGO_OFFLINE } from '@/services/manejoRebanhoService';
import { tipoTemCancelamento, motivoSemCancelamento, MENSAGEM_LEGADO_SEM_PROVA } from '@/domain/lotes/situacaoMovimento';

const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const erroServidor = (code) => Object.assign(new Error(code), { code: 'API_OPERATION_FAILED', cause: { code } });
const BOI = 'Boi 25 a 36 meses';

describe('R2D corpo da baixa (um envio por confirmação)', () => {
  it('morte com duas categorias → UM corpo com duas linhas; seleção de lotes ordenada e sem repetição', () => {
    expect(corpoBaixa({ tipo: 'Morte', empresaId: 'e', areaId: 'A', data: '2026-10-30', observacoes: ' obs ', loteIds: ['l2', 'l1', 'l2'], linhas: [
      { categoria: BOI, quantidade: '60', causa_morte: 'Doença' },
      { categoria: 'Vaca + 36 meses', quantidade: 2, causa_morte: 'Predador' },
    ] })).toEqual({
      tipo: 'Morte', empresa_id: 'e', area_id: 'A', data_movimentacao: '2026-10-30T12:00:00.000Z', observacoes: 'obs', lotes_selecionados: ['l1', 'l2'],
      linhas: [{ categoria: BOI, quantidade: 60, causa_morte: 'Doença' }, { categoria: 'Vaca + 36 meses', quantidade: 2, causa_morte: 'Predador' }],
    });
  });
  it('abate: pesos são TOTAIS da linha; vazio some (não vira zero); destino sem nome some', () => {
    const c = corpoBaixa({ tipo: 'Abate', empresaId: 'e', areaId: 'A', data: '2026-10-30', linhas: [
      { categoria: BOI, quantidade: 3, peso_vivo_total: 1500, peso_carcaca_total: null, destino: 'Frigorífico', destino_nome: ' FRIGO ' },
      { categoria: BOI, quantidade: 1, peso_vivo_total: '', destino: '' },
    ] });
    expect(c.linhas).toEqual([
      { categoria: BOI, quantidade: 3, peso_vivo_total_kg: 1500, destino: 'Frigorífico', destino_nome: 'FRIGO' },
      { categoria: BOI, quantidade: 1 },
    ]);
    expect(c.lotes_selecionados).toBeUndefined();
  });
});

describe('R2D envio (online-only, idempotente, 1 POST)', () => {
  const corpo = { tipo: 'Morte', empresa_id: 'e', area_id: 'A', data_movimentacao: '2026-10-30T12:00:00.000Z', linhas: [{ categoria: BOI, quantidade: 60, causa_morte: 'Doença' }] };
  it('offline: recusa ANTES de qualquer requisição e sem fila', async () => {
    const enviar = vi.fn();
    const storage = memoria();
    await expect(enviarBaixaRebanho(corpo, { escopo: 'c:u', enviar, online: () => false, storage })).rejects.toMatchObject({ code: CODIGO_OFFLINE });
    expect(enviar).not.toHaveBeenCalled();
    expect([...storage.m.keys()]).toEqual([]);
  });
  it('resultado desconhecido: reenvio do MESMO conteúdo reaproveita a chave; recusa definitiva limpa a pendência', async () => {
    const storage = memoria();
    const enviar = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ replay: true });
    await expect(enviarBaixaRebanho(corpo, { escopo: 'c:u', enviar, online: () => true, storage })).rejects.toThrow();
    expect([...storage.m.keys()]).toEqual(['maike_manejo_rebanho_pendente:c:u:Morte:e:A']);
    await enviarBaixaRebanho(corpo, { escopo: 'c:u', enviar, online: () => true, storage });
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(enviar.mock.calls[0][0].operation_id).toBe(enviar.mock.calls[1][0].operation_id);
    expect([...storage.m.keys()]).toEqual([]);
    const recusa = vi.fn().mockRejectedValue(erroServidor('BAIXA_SALDO_INSUFICIENTE'));
    await expect(enviarBaixaRebanho(corpo, { escopo: 'c:u', enviar: recusa, online: () => true, storage })).rejects.toThrow();
    expect([...storage.m.keys()]).toEqual([]);
  });
  it('mensagens claras para as recusas da baixa', () => {
    expect(mensagemDoErro(erroServidor('BAIXA_SALDO_INSUFICIENTE'))).toMatch(/Nada foi baixado/);
    expect(mensagemDoErro(erroServidor('BAIXA_DATA_RETROATIVA'))).toMatch(/registro posterior/);
    expect(mensagemDoErro(erroServidor('BAIXA_CLASSIFICACAO_DIVERGENTE'))).toMatch(/sexo incompatível/);
    expect(mensagemDoErro(new TypeError('Failed to fetch'))).toMatch(/Resultado desconhecido/);
  });
});

describe('R2D DetalhesLote e formulários', () => {
  const fonte = readFileSync('src/components/mapa/DetalhesLote.jsx', 'utf8');
  const trecho = (de, ate) => fonte.slice(fonte.indexOf(de), fonte.indexOf(ate, fonte.indexOf(de)));
  it('Morte/Abate: um comando por confirmação; nada de laço de registrarManejoLote, criarMovimentacao ou atualizarLote', () => {
    const baixa = trecho('const executarBaixa', 'const handleNascimento');
    expect(baixa).toMatch(/enviarBaixaRebanho/);
    expect(baixa).not.toMatch(/registrarManejoLote|criarMovimentacao|atualizarLote|for \(/);
    expect(fonte).toMatch(/const handleMorte = \(formData\) => executarBaixa\('Morte'/);
    expect(fonte).toMatch(/const handleAbate = \(formData\) => executarBaixa\('Abate'/);
    expect(baixa).toMatch(/baixaEmAndamento\.current\) return/);
  });
  it('formulários enviam UMA vez com todas as linhas (sem forEach de onSubmit) e desabilitam o botão enquanto envia', () => {
    for (const arq of ['src/components/lotes/FormularioMorte.jsx', 'src/components/lotes/FormularioAbate.jsx']) {
      const f = readFileSync(arq, 'utf8');
      expect(f).not.toMatch(/forEach\([^)]*=>\s*\{\s*onSubmit/);
      expect(f).toMatch(/linhas: /);
      expect(f).toMatch(/disabled=\{enviando\}/);
    }
  });
});

describe('R2D histórico e cancelamento no navegador', () => {
  const efeitos = [{ lote_id: 'l1', auditoria_id: 'a1' }, { lote_id: 'l2', auditoria_id: 'a2' }];
  it('baixa agregada certificada oferece cancelamento; sem todos os participantes em lote_ids, não', () => {
    expect(tipoTemCancelamento({ tipo: 'Morte', lote_id: 'l1', lote_ids: ['l1', 'l2'], efeito_servidor: { comando: 'manejo_mapa_baixa_rebanho', efeitos } })).toBe(true);
    expect(tipoTemCancelamento({ tipo: 'Abate', lote_id: 'l1', lote_ids: ['l1'], efeito_servidor: { comando: 'manejo_mapa_baixa_rebanho', efeitos } })).toBe(false);
    expect(tipoTemCancelamento({ tipo: 'Morte', lote_id: 'l1', efeito_servidor: { comando: 'manejo_mapa_lote', efeitos: [efeitos[0]] } })).toBe(true);
    expect(motivoSemCancelamento({ tipo: 'Morte', lote_id: 'l1' })).toBe(MENSAGEM_LEGADO_SEM_PROVA);
  });
  it('linhas legíveis: distribuição real por lote e metadados da linha', () => {
    expect(descreverLinhasDoMovimento({ tipo: 'Morte', linhas: [{ categoria: BOI, quantidade: 60, causa_morte: 'Predador', distribuicao: [{ nome: 'L40', quantidade: 40 }, { nome: 'L30', quantidade: 20 }] }] }))
      .toEqual([`60 de ${BOI} → L40 40 cab, L30 20 cab · causa: Predador`]);
    expect(descreverLinhasDoMovimento({ tipo: 'Abate', linhas: [{ categoria: BOI, quantidade: 3, peso_vivo_total_kg: 1500, destino: 'Frigorífico', destino_nome: 'FRIGO', distribuicao: [{ nome: 'L40', quantidade: 3 }] }] }))
      .toEqual([`3 de ${BOI} → L40 3 cab · peso vivo total 1500 kg · destino: Frigorífico (FRIGO)`]);
    expect(descreverLinhasDoMovimento({ tipo: 'Morte', lote: 'L1', quantidade_animais: 2 })).toEqual([]);
  });
});
