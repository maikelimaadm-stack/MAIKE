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
    const ledger = fonte.slice(fonte.indexOf('      if (modoLedger) {'), fonte.indexOf('    onSuccess: async'));
    expect(ledger).toMatch(/enviarTransferenciaLedger\(\{ operation_id: chaveTransferenciaLedger\.current, \.\.\.corpo \}/);
    expect(ledger).not.toMatch(/validarOrdemTemporal|atualizarLote|criarMovimentacao|criarLote|registrarManejoLote/);
    expect(ledger).toMatch(/return resposta\?\.movimentacao/);
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger).not.toMatch(/MENSAGENS_MANEJO_REBANHO\.REBANHO_CUTOVER_PENDENTE/);
    expect(fonte).not.toMatch(/seMigrado|ainda não foi migrada/);
    // Contrato do dono: no ledger toda operação abre; sem ledger, abrirManejo recusa (cutover pendente).
    for (const abrir of ['setShowAbate', 'setShowMorte', 'setShowNascimento', 'setShowMudancaCategoria', 'setShowPesagem', 'setShowMovimentacao']) {
      // D-PROD-119: os manejos viraram quadros (`onClick: () => abrirManejo(...)`); a regra é a mesma.
      expect(fonte).toMatch(new RegExp(`onClick(?:=\\{|: )\\(\\) => abrirManejo\\(${abrir}\\)`));
    }
    const abrirManejo = fonte.slice(fonte.indexOf('  const abrirManejo = (abrir) => {'), fonte.indexOf('  // Listener para abrir movimentação via drag-and-drop'));
    expect(abrirManejo).toMatch(/if \(!modoLedger\) \{\s*recusarManejoSemLedger\(\);\s*return;\s*\}\s*abrir\(true\);/);
  });
  it('PR174-R1 sobras no ledger: passo SEPARADO depois do comando; falha vira aviso explícito (sem falso sucesso)', () => {
    const fonte = readFileSync('src/components/mapa/DetalhesLote.jsx', 'utf8');
    const ledger = fonte.slice(fonte.indexOf('      if (modoLedger) {'), fonte.indexOf('    onSuccess: async'));
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
    const trecho = fonte.slice(fonte.indexOf('  const handleMovimentacao = async'), fonte.indexOf('    recusarManejoSemLedger();\n  };', fonte.indexOf('  const handleMovimentacao = async')));
    expect(trecho).toMatch(/if \(transferenciaEmAndamento\.current\) return;/);
    expect(trecho).toMatch(/await movimentacaoMutation\.mutateAsync\(formData\)/);
    expect(trecho).not.toMatch(/movimentacaoMutation\.mutate\(formData\)/);
    expect(trecho).toMatch(/if \(modoLedger\) \{/);
    expect(fonte).not.toMatch(/movimentacaoMutation\.mutate\(/);
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

describe('PR174-R2 mensagens das recusas novas (nada de falso sucesso)', () => {
  it('peso causal: manejo e cancelamento mostram a data do registro dependente e os pesos', async () => {
    const erro = Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'REBANHO_PESO_DEPENDENCIA_CAUSAL' }, details: { data: '2026-11-02', peso_registrado_kg: 500, peso_recalculado_kg: 400 } });
    expect(mensagemDaTransferenciaLedger(erro)).toBe('O registro do dia 02/11/2026 calculou o peso com o valor que este manejo mudaria. Cancele-o antes. Nada foi gravado.');
    const { mensagemDeRecusa, MENSAGENS_RECUSA } = await import('@/components/lotes/ExcluirMovimentacao');
    expect(mensagemDeRecusa('REBANHO_PESO_DEPENDENCIA_CAUSAL', { data: '2026-11-02', peso_registrado_kg: 500, peso_recalculado_kg: 400 })).toMatch(/dia 02\/11\/2026 .*500 kg.*400 kg.*Nada foi alterado/);
    expect(mensagemDeRecusa('CANCELAMENTO_SALDO_HISTORICO_NEGATIVO', { data: '2026-11-04', area_nome: 'PASTO B' })).toMatch(/PASTO B no dia 04\/11\/2026/);
    for (const c of ['CANCELAMENTO_SALDO_HISTORICO_NEGATIVO', 'REBANHO_PESO_DEPENDENCIA_CAUSAL', 'EXCLUSAO_MOVIMENTO_LEGADO', 'EXCLUSAO_MOVIMENTO_CANCELADO', 'EXCLUSAO_REFERENCIA_DOCUMENTAL']) expect(MENSAGENS_RECUSA[c]).toMatch(/Nada foi alterado/);
  });
  it('POST genérico recusado e replay desfeito têm mensagem própria', () => {
    for (const code of ['REBANHO_LEDGER_SOMENTE_POR_COMANDO', 'IDEMPOTENCY_EFEITO_DESFEITO']) {
      const erro = Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code } });
      expect(mensagemDaTransferenciaLedger(erro)).toMatch(/Nada foi gravado/);
    }
  });
});

describe('PR174-R3 recusa de fato sem saldo (pesagem/nascimento posterior)', () => {
  it('manejo e cancelamento mostram tipo e data do fato dependente; recusa é definitiva', async () => {
    const pes = Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'REBANHO_DEPENDENCIA_FATO_SEM_SALDO' }, details: { tipo: 'PESAGEM', data: '2026-11-05' } });
    expect(mensagemDaTransferenciaLedger(pes)).toBe('A pesagem do dia 05/11/2026 ficaria numa posição sem cabeças. Cancele-a antes. Nada foi gravado.');
    const nas = Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'REBANHO_DEPENDENCIA_FATO_SEM_SALDO' }, details: { tipo: 'NASCIMENTO', data: '2026-11-05' } });
    expect(mensagemDaTransferenciaLedger(nas)).toMatch(/nascimento do dia 05\/11\/2026 ficaria sem as matrizes/);
    const { mensagemDeRecusa, MENSAGENS_RECUSA } = await import('@/components/lotes/ExcluirMovimentacao');
    expect(MENSAGENS_RECUSA.REBANHO_DEPENDENCIA_FATO_SEM_SALDO).toMatch(/Nada foi alterado/);
    expect(mensagemDeRecusa('REBANHO_DEPENDENCIA_FATO_SEM_SALDO', { tipo: 'PESAGEM', data: '2026-11-05' })).toMatch(/pesagem do dia 05\/11\/2026/);
  });
});

describe('PR174-R4 cadastro só de entradas (frontend)', () => {
  it('DetalhesLote não fabrica lote nem grava efeito em Lote; sem ledger recusa com REBANHO_CUTOVER_PENDENTE', () => {
    const fonte = readFileSync('src/components/mapa/DetalhesLote.jsx', 'utf8');
    expect(fonte).not.toMatch(/criarLote\(|atualizarLote|criarMovimentacao|registrarManejoLote/);
    expect(fonte).toMatch(/MENSAGENS_MANEJO_REBANHO\.REBANHO_CUTOVER_PENDENTE/);
    const mutacao = fonte.slice(fonte.indexOf('    mutationFn: async (formData) => {'), fonte.indexOf('      let areasConhecidas = areas;'));
    expect(mutacao).toMatch(/if \(!modoLedger\) \{\s*throw Object\.assign\(new Error\('cutover-pendente'\), \{ mensagemTela: MENSAGENS_MANEJO_REBANHO\.REBANHO_CUTOVER_PENDENTE \}\);/);
    const servico = readFileSync('src/services/loteManejoService.js', 'utf8');
    expect(servico).not.toMatch(/export const (criarLote|registrarManejoLote)\b/);
    const erro = Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'LOTE_CADASTRO_SOMENTE_ENTRADAS' } });
    expect(mensagemDaTransferenciaLedger(erro)).toMatch(/cadastro de lotes guarda só entradas.*Nada foi gravado/);
  });
  it('Cadastro de Lotes lista só entradas (filtra os derivados legados)', () => {
    const fonte = readFileSync('src/pages/CadastroLotes.jsx', 'utf8');
    expect(fonte).toMatch(/todos\.filter\(ehEntradaNoRebanho\)/);
  });
});
