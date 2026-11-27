/**
 * D-PROD-345 — Fase 3 da sincronização: pontos de referência, linhas e tarefas baixam só o que mudou.
 * O servidor: backend/tests/mudancasCadastrosD345.test.mjs.
 *
 *  MI-01 as portas registram as três listas como incrementais, com a rota de mudanças
 *  MI-02 a ordem da junção é a da listagem do servidor (pontos e linhas: criação crescente; tarefas: alteração
 *        decrescente)
 */
import { describe, it, expect } from 'vitest';

describe('D-PROD-345 — listas que baixam só o que mudou', () => {
  it('MI-01 pontos de referência, linhas e tarefas são incrementais', async () => {
    await import('@/apis/mapaGeografia/mapaGeografiaNativePort');
    await import('@/apis/tarefas/lancamentoTarefaNativePort');
    const { incrementalDe } = await import('@/lib/offline/sincronizacaoIncremental');
    expect(incrementalDe('/pontos-referencia')?.mudancas).toBe('/pontos-referencia/mudancas');
    expect(incrementalDe('/linhas-geograficas')?.mudancas).toBe('/linhas-geograficas/mudancas');
    expect(incrementalDe('/lancamentos-tarefa')?.mudancas).toBe('/lancamentos-tarefa/mudancas');
  });

  it('MI-02 a ordem é a da listagem do servidor', async () => {
    const { ordemPorCriacaoCrescente, ordemPorAtualizacao } = await import('@/lib/offline/sincronizacaoIncremental');
    const pontos = [
      { id: 'b', created_date: '2026-11-02T00:00:00Z' },
      { id: 'a', created_date: '2026-11-01T00:00:00Z' },
      { id: 'c', created_date: '2026-11-02T00:00:00Z' },
    ];
    expect([...pontos].sort(ordemPorCriacaoCrescente).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    const tarefas = [
      { id: 't1', updated_date: '2026-11-01T00:00:00Z' },
      { id: 't2', updated_date: '2026-11-03T00:00:00Z' },
      { id: 't3', updated_date: '2026-11-02T00:00:00Z' },
    ];
    expect([...tarefas].sort(ordemPorAtualizacao).map((t) => t.id)).toEqual(['t2', 't3', 't1']);
  });
});
