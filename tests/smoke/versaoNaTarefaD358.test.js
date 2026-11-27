/**
 * D-PROD-358 — a tela da tarefa manda a versão que a pessoa viu (o servidor já conferia, D-PROD-344).
 *
 *  VT-01 `versaoVista`: a versão do servidor vai; a cópia montada sem internet (`_isOffline`) não manda versão
 *  VT-02 a tela da tarefa e a lista mandam a versão, e a foto que sobe com a tela aberta atualiza a versão da tela
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('D-PROD-358 — versão na tarefa', () => {
  it('VT-01 só a versão do servidor vai', async () => {
    const { versaoVista } = await import('@/lib/offline/versaoVista');
    expect(versaoVista({ updated_date: '2026-11-27T10:00:00.000Z' })).toEqual({ versao_esperada: '2026-11-27T10:00:00.000Z' });
    expect(versaoVista({ updated_date: '2026-11-27T10:00:00.000Z', _isOffline: true })).toEqual({});
    expect(versaoVista({})).toEqual({});
    expect(versaoVista(null)).toEqual({});
  });

  it('VT-02 a tela e a lista mandam a versão e acompanham a foto que subiu', () => {
    const detalhes = readFileSync('src/components/mapa/DetalhesTarefaMapa.jsx', 'utf8');
    expect((detalhes.match(/\.\.\.versaoVista\(currentTarefa\)/g) ?? []).length).toBe(2);
    expect(detalhes).toMatch(/updated_date: nova\.updated_date/);
    const lista = readFileSync('src/components/mapa/TarefasMapaPanel.jsx', 'utf8');
    expect(lista).toMatch(/\.\.\.versaoVista\(previous\)/);
    expect(lista).toMatch(/EVENTO_TAREFA_COM_FOTOS_ENVIADAS, aoEnviar/);
  });
});
