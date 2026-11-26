/**
 * D-PROD-326 — filtros e camadas por aba do Mapa Geral (Lotes · Pontos · Tarefas): cada aba com as suas coisas.
 *
 * ABA-01 `painelDoFoco`: camadas e grupos de filtro de cada aba (o mesmo objeto a cada chamada)
 * ABA-02 `filtrarTarefasDoMapa`: situação, prioridade, responsável (e "sem responsável") e "só atrasadas"
 * ABA-03 `responsaveisDasTarefas`: em ordem, sem repetir, "Sem responsável" no fim
 * ABA-04 preferências: os filtros de tarefa são salvos e voltam (lista ou texto antigo)
 * ABA-05 painel na aba Tarefas: só os filtros de tarefa (com o setor); o "limpar" não mexe nos filtros de lote
 * ABA-06 painel sem aba (uso solto): tudo, como antes
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { painelDoFoco } from '@/lib/mapaFoco';
import { filtrarTarefasDoMapa, responsaveisDasTarefas, SEM_RESPONSAVEL } from '@/domain/mapa/mapaGeralDerivados';
import { normalizarFiltrosMapa, PADRAO_FILTROS_MAPA, CAMPOS_DO_PAINEL_FILTROS } from '@/lib/mapaGeralFiltrosStorage';
import MapaFiltrosAvancados from '@/components/mapa/MapaFiltrosAvancados';
import { MapaFiltrosHeaderRightCtx } from '@/components/mapa/MapaFiltrosPainel';

afterEach(() => cleanup());

describe('D-PROD-326 — filtros e camadas por aba', () => {
  it('ABA-01 cada aba com as suas camadas e os seus filtros', () => {
    expect(painelDoFoco('lotes')).toMatchObject({ filtrosDeArea: 'todos', filtrosDeLote: true, filtrosDeTarefa: false });
    expect(painelDoFoco('lotes').camadas).toEqual(['areas', 'nomes', 'hectares', 'pontos', 'linhas', 'lotes', 'alertas', 'localizacao']);
    expect(painelDoFoco('pastos')).toMatchObject({ filtrosDeArea: 'todos', filtrosDeLote: false, filtrosDeTarefa: false });
    expect(painelDoFoco('pastos').camadas).toEqual(['areas', 'nomes', 'hectares', 'pontos', 'linhas', 'cochos', 'depositos', 'localizacao']);
    expect(painelDoFoco('tarefas')).toMatchObject({ filtrosDeArea: 'setor', filtrosDeLote: false, filtrosDeTarefa: true });
    expect(painelDoFoco('tarefas').camadas).toEqual(['areas', 'nomes', 'linhas', 'pontos', 'localizacao']);
    for (const foco of ['lotes', 'pastos', 'tarefas']) {
      expect(painelDoFoco(foco).camadas, foco).not.toContain('tarefas');
    }
    expect(painelDoFoco('outro')).toBe(painelDoFoco('lotes'));
    expect(Object.isFrozen(painelDoFoco('tarefas'))).toBe(true);
  });

  it('ABA-02 filtros de tarefa', () => {
    const hoje = '2026-11-26';
    const T = [
      { id: 'a', status: 'Pendente', prioridade: 'Alta', responsavel: 'JOÃO', data_prevista: '2026-11-20' },
      { id: 'b', status: 'Em Andamento', prioridade: 'media', responsavel: 'MARIA', data_prevista: '2026-11-26' },
      { id: 'c', status: 'Pendente', prioridade: 'Baixa', responsavel: '', data_prevista: null },
    ];
    const ids = (f) => filtrarTarefasDoMapa(T, { hoje, ...f }).map((t) => t.id);
    expect(filtrarTarefasDoMapa(T, { filtroTarefaStatus: 'todos', filtroTarefaPrioridade: 'todas', filtroTarefaResponsavel: 'todos', filtroTarefaPrazo: 'todos' })).toBe(T);
    expect(ids({ filtroTarefaStatus: ['Em Andamento'] })).toEqual(['b']);
    expect(ids({ filtroTarefaPrioridade: ['Média'] }), 'a prioridade é normalizada').toEqual(['b']);
    expect(ids({ filtroTarefaResponsavel: ['JOÃO', SEM_RESPONSAVEL] })).toEqual(['a', 'c']);
    expect(ids({ filtroTarefaPrazo: ['atrasadas'] }), 'vencer hoje ainda não é atraso').toEqual(['a']);
    expect(ids({ filtroTarefaPrazo: 'atrasadas', filtroTarefaPrioridade: ['Baixa'] })).toEqual([]);
  });

  it('ABA-03 responsáveis das tarefas', () => {
    expect(responsaveisDasTarefas([{ responsavel: 'MARIA' }, { responsavel: ' JOÃO ' }, { responsavel: 'MARIA' }, {}])).toEqual([
      { valor: 'JOÃO', rotulo: 'JOÃO' },
      { valor: 'MARIA', rotulo: 'MARIA' },
      { valor: SEM_RESPONSAVEL, rotulo: 'Sem responsável' },
    ]);
    expect(responsaveisDasTarefas([])).toEqual([]);
  });

  it('ABA-04 preferências dos filtros de tarefa', () => {
    expect(PADRAO_FILTROS_MAPA).toMatchObject({ filtroTarefaStatus: 'todos', filtroTarefaPrioridade: 'todas', filtroTarefaResponsavel: 'todos', filtroTarefaPrazo: 'todos' });
    for (const k of ['filtroTarefaStatus', 'filtroTarefaPrioridade', 'filtroTarefaResponsavel', 'filtroTarefaPrazo']) expect(CAMPOS_DO_PAINEL_FILTROS, k).toContain(k);
    const st = normalizarFiltrosMapa({ filtroTarefaStatus: ['Pendente', 'Pendente', 'todos'], filtroTarefaPrioridade: 'Alta', filtroTarefaResponsavel: [], filtroTarefaPrazo: 7 });
    expect(st.filtroTarefaStatus).toEqual(['Pendente']);
    expect(st.filtroTarefaPrioridade).toBe('Alta');
    expect(st.filtroTarefaResponsavel).toBe('todos');
    expect(st.filtroTarefaPrazo).toBe('todos');
  });

  const montarPainel = (props) => {
    const setters = new Proxy({}, { get: (alvo, k) => (alvo[k] ||= vi.fn()) });
    let acao = null;
    render(
      <MapaFiltrosHeaderRightCtx.Provider value={(a) => { acao = a; }}>
        <MapaFiltrosAvancados
          showAreas showNomesAreas showHectaresAreas showPontos showLinhas showLotes showTarefas showCochos showDepositos showAlertas showUserLocation
          filtroCategoria={['BOI']} setFiltroCategoria={setters.setFiltroCategoria}
          filtroIdentificador="todos" setFiltroIdentificador={setters.setFiltroIdentificador}
          filtroStatus="todos" setFiltroStatus={setters.setFiltroStatus}
          filtroSistema="todos" setFiltroSistema={setters.setFiltroSistema}
          filtroAlertaTipo="todos" setFiltroAlertaTipo={setters.setFiltroAlertaTipo}
          filtroPesoMin={null} setFiltroPesoMin={setters.setFiltroPesoMin}
          filtroPesoMax={null} setFiltroPesoMax={setters.setFiltroPesoMax}
          filtroSetor="todos" setFiltroSetor={setters.setFiltroSetor}
          filtroTipoCultura="todas" setFiltroTipoCultura={setters.setFiltroTipoCultura}
          filtroTipoPastagem="todas" setFiltroTipoPastagem={setters.setFiltroTipoPastagem}
          setores={[{ id: 's1', nome: 'SETOR 1' }]}
          mostrarCores={false}
          {...props}
        />
      </MapaFiltrosHeaderRightCtx.Provider>
    );
    return { setters, acao: () => acao };
  };

  it('ABA-05 aba Tarefas: só os filtros de tarefa; o "limpar" não mexe no filtro de lote', () => {
    const setStatus = vi.fn();
    const { setters, acao } = montarPainel({ foco: 'tarefas', filtroTarefaStatus: ['Pendente'], setFiltroTarefaStatus: setStatus, responsaveisTarefa: [{ valor: 'JOÃO', rotulo: 'JOÃO' }] });
    expect(screen.getByText('Filtros de Tarefas')).toBeTruthy();
    for (const campo of ['Setor', 'Situação', 'Prioridade', 'Responsável', 'Prazo']) expect(screen.getByRole('combobox', { name: campo }), campo).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Tipo de Cultura' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Categoria' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Lotes' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Cochos' })).toBeNull();

    // O filtro de lote ligado (BOI) não conta aqui; o de tarefa conta e o "limpar" só limpa os da aba.
    render(acao());
    const limpar = screen.getByRole('button', { name: 'Limpar filtros' });
    expect(limpar.hasAttribute('disabled')).toBe(false);
    fireEvent.click(limpar);
    expect(setStatus).toHaveBeenCalledWith('todos');
    expect(setters.setFiltroSetor).toHaveBeenCalledWith('todos');
    expect(setters.setFiltroCategoria).not.toHaveBeenCalled();
    expect(setters.setFiltroTipoCultura).not.toHaveBeenCalled();
  });

  it('ABA-05b aba Pontos: só o filtro de lote ligado não acende o "limpar"', () => {
    const { acao } = montarPainel({ foco: 'pastos' });
    expect(screen.queryByText('Filtros de Categorias de Manejo')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Cochos' })).toBeTruthy();
    render(acao());
    expect(screen.getByRole('button', { name: 'Limpar filtros' }).hasAttribute('disabled')).toBe(true);
  });

  it('ABA-06 sem aba: tudo, como antes', () => {
    montarPainel({});
    expect(screen.getByText('Filtros de Áreas')).toBeTruthy();
    expect(screen.getByText('Filtros de Categorias de Manejo')).toBeTruthy();
    expect(screen.queryByText('Filtros de Tarefas')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Tarefas' })).toBeTruthy();
  });
});
