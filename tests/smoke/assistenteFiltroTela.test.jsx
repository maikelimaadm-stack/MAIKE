/**
 * D-PROD-230 — o Assistente aplica filtros nas telas (Mapa Geral e Cadastro de Lotes).
 *
 * Contrato: o servidor devolve uma ação `{ tela, filtros }` já validada; o balão mostra
 * o botão ("Aplicar no Mapa" / "Ver lotes filtrados") ou aplica sozinho quando o usuário
 * pediu explicitamente; a tela lê `?af=` da URL, valida de novo, aplica sobre o que já
 * mostra e tira o parâmetro da barra de endereço.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  CHAVES_POR_TELA,
  casarNomes,
  lerFiltroDaUrl,
  searchSemFiltro,
  urlDoFiltro,
  validarFiltroTela,
  avisarFiltroDoAssistente,
} from '@/domain/assistente/filtroTela';
import { useFiltroDoAssistente } from '@/hooks/useFiltroDoAssistente';
import { casaNoFiltroColuna } from '@/components/cadastro/base1/cadastroColunaFiltroLogic';
import { FILTROS_POR_TELA } from '../../backend/src/modules/assistente/assistenteAcoes.js';

const perguntar = vi.fn();
vi.mock('@/services/assistenteService', () => ({ perguntarAssistenteAoVivo: (d, o) => perguntar(d, o) }));

const gradeProps = vi.fn();
vi.mock('@/components/cadastro/base1/CadastroBase1Grade', () => ({
  default: (props) => {
    gradeProps(props);
    return <div data-testid="grade">grade</div>;
  },
}));

beforeEach(() => {
  perguntar.mockReset();
  gradeProps.mockReset();
  window.history.replaceState(null, '', '/');
});
afterEach(() => cleanup());

describe('contrato do filtro de tela', () => {
  it('cliente e servidor aceitam as MESMAS telas e chaves', () => {
    expect(Object.keys(CHAVES_POR_TELA).sort()).toEqual(Object.keys(FILTROS_POR_TELA).sort());
    for (const tela of Object.keys(CHAVES_POR_TELA)) {
      expect(Object.keys(CHAVES_POR_TELA[tela]).sort(), tela).toEqual(Object.keys(FILTROS_POR_TELA[tela].properties).sort());
    }
    expect(CHAVES_POR_TELA.MapaGeral.colorir_por).toEqual(FILTROS_POR_TELA.MapaGeral.properties.colorir_por.enum);
  });

  it('URL ida e volta; chave desconhecida e valor inválido são ignorados', () => {
    const url = urlDoFiltro({ tela: 'CadastroLotes', filtros: { sexos: ['Macho'], peso_min: 350, cliente_id: 'x' } });
    expect(url.startsWith('/cadastrolotes?af=')).toBe(true);
    const search = url.slice(url.indexOf('?'));
    expect(lerFiltroDaUrl(search, 'CadastroLotes')).toEqual({ sexos: ['Macho'], peso_min: 350 });
    expect(validarFiltroTela('MapaGeral', { tipos_cultura: ['Pastagem', 'Lua'], colorir_por: 'arco-iris', peso_max: -1, setores: 'KM' })).toEqual({ tipos_cultura: ['Pastagem'] });
    expect(lerFiltroDaUrl('?af=%7Bquebrado', 'MapaGeral')).toEqual({});
    expect(lerFiltroDaUrl('?outra=1', 'MapaGeral')).toBeNull();
    expect(searchSemFiltro('?af=1&x=2')).toBe('?x=2');
  });

  it('nomes casam sem acento e sem caixa; o que não casa é avisado', () => {
    const setores = [{ id: 's1', nome: 'Setor Água' }, { id: 's2', nome: 'KM' }];
    expect(casarNomes(['setor agua', 'km', 'Lua'], setores, (s) => s.nome, (s) => s.id)).toEqual({ valores: ['s1', 's2'], faltando: ['Lua'] });
  });

  it('filtro numérico da grade lê o peso formatado ("327,5 kg")', () => {
    expect(casaNoFiltroColuna({ op: 'maie', v1: '327,5', v2: '', valores: null }, 'num', '327,5 kg')).toBe(true);
    expect(casaNoFiltroColuna({ op: 'entre', v1: '300', v2: '320', valores: null }, 'num', '327,5 kg')).toBe(false);
  });
});

describe('useFiltroDoAssistente', () => {
  const Sonda = ({ aoPedido }) => {
    const { pedido } = useFiltroDoAssistente('CadastroLotes');
    aoPedido(pedido);
    return null;
  };

  it('lê o pedido ao abrir, tira da URL e pega um novo com a tela aberta', async () => {
    window.history.replaceState(null, '', `/cadastrolotes?af=${encodeURIComponent(JSON.stringify({ status: 'Ativo' }))}&aba=1`);
    const pedidos = [];
    render(<Sonda aoPedido={(p) => pedidos.push(p)} />);
    expect(pedidos.at(-1)?.filtros).toEqual({ status: 'Ativo' });
    expect(window.location.search).toBe('?aba=1');

    window.history.pushState(null, '', `/cadastrolotes?af=${encodeURIComponent(JSON.stringify({ sexos: ['Fêmea'] }))}`);
    await act(async () => avisarFiltroDoAssistente());
    expect(pedidos.at(-1)?.filtros).toEqual({ sexos: ['Fêmea'] });
    expect(window.location.search).toBe('');
  });
});

describe('balão do assistente', () => {
  const ACAO = { tipo: 'filtro_tela', tela: 'CadastroLotes', nome_tela: 'Lotes', filtros: { categorias_manejo: ['Garrote'], peso_min: 350 }, resumo: 'Categoria de manejo: Garrote · Peso ≥ 350 kg', aplicar_agora: false };

  const perguntarPeloCampo = (texto) => {
    fireEvent.change(screen.getByTestId('assistente-campo'), { target: { value: texto } });
    fireEvent.click(screen.getByTestId('assistente-enviar'));
  };

  it('mostra o botão, aplica no clique e oferece limpar', async () => {
    const { default: AssistenteFlutuante } = await import('@/components/assistente/AssistenteFlutuante');
    perguntar.mockResolvedValueOnce({ resposta: 'São 3 lotes.', acoes: [ACAO, { tipo: 'outra', tela: 'Usuarios' }] });
    const navegar = vi.fn();
    render(<AssistenteFlutuante empresaId="emp-1" navegar={navegar} />);
    fireEvent.click(screen.getByTestId('assistente-botao'));
    perguntarPeloCampo('quais garrotes passam de 350 kg?');
    const botao = await screen.findByTestId('assistente-aplicar-filtro');
    expect(screen.getAllByTestId('assistente-aplicar-filtro')).toHaveLength(1);
    expect(botao.textContent).toContain('Ver lotes filtrados');
    expect(navegar).not.toHaveBeenCalled();

    fireEvent.click(botao);
    expect(navegar).toHaveBeenCalledTimes(1);
    const url = navegar.mock.calls[0][0];
    expect(url.startsWith('/cadastrolotes?af=')).toBe(true);
    expect(lerFiltroDaUrl(url.slice(url.indexOf('?')), 'CadastroLotes')).toEqual(ACAO.filtros);
    expect(screen.getByTestId('assistente-filtro-aplicado').textContent).toContain('Peso ≥ 350 kg');

    fireEvent.click(screen.getByTestId('assistente-filtro-limpar'));
    const limpar = navegar.mock.calls[1][0];
    expect(lerFiltroDaUrl(limpar.slice(limpar.indexOf('?')), 'CadastroLotes')).toEqual({});
  });

  it('pedido explícito (aplicar_agora) aplica sozinho', async () => {
    const { default: AssistenteFlutuante } = await import('@/components/assistente/AssistenteFlutuante');
    perguntar.mockResolvedValueOnce({ resposta: 'Pronto.', acoes: [{ ...ACAO, tela: 'MapaGeral', nome_tela: 'Mapa Geral', filtros: { colorir_por: 'forragem' }, aplicar_agora: true }] });
    const navegar = vi.fn();
    render(<AssistenteFlutuante empresaId="emp-1" navegar={navegar} />);
    fireEvent.click(screen.getByTestId('assistente-botao'));
    perguntarPeloCampo('aplica o farol de forragem no mapa');
    await waitFor(() => expect(navegar).toHaveBeenCalledTimes(1));
    expect(navegar.mock.calls[0][0].startsWith('/mapageral?af=')).toBe(true);
    expect(screen.getByTestId('assistente-filtro-aplicado').textContent).toContain('Mapa Geral');
  });
});

describe('lista de lotes', () => {
  const LOTES = [
    { id: 'a', nome: 'A', categoria_manejo_entrada_nome: 'Garrote 13 a 24 meses', sexo: 'Macho', peso_entrada_kg: 360, quantidade_entrada: 50, status: 'Ativo' },
    { id: 'b', nome: 'B', categoria_manejo_entrada_nome: 'Bezerra', sexo: 'Fêmea', peso_entrada_kg: 180, quantidade_entrada: 20, status: 'Ativo' },
  ];

  it('vira filtros de cabeçalho da grade (substitui os atuais) e avisa o que não casou', async () => {
    const { default: TabelaLotes } = await import('@/components/lotes/TabelaLotes');
    const aplicado = vi.fn();
    const filtroExterno = { id: 1, filtros: { categorias_manejo: ['garrote 13 a 24 MESES', 'Novilha'], peso_min: 350, peso_max: 400.5, status: 'Ativo' } };
    render(<TabelaLotes lotes={LOTES} filtroExterno={filtroExterno} onFiltroExternoAplicado={aplicado} />);
    await waitFor(() => expect(aplicado).toHaveBeenCalledWith({ faltando: ['Novilha'], vazio: false }));
    const ultimo = gradeProps.mock.calls.at(-1)[0];
    const f = ultimo.filtrosExternos.filtros;
    expect([...f.categoria_manejo.valores]).toEqual(['Garrote 13 a 24 meses']);
    expect(f.peso).toEqual({ op: 'entre', v1: '350', v2: '400,5', valores: null });
    expect([...f.status.valores]).toEqual(['Ativo']);
    // Colunas numéricas: o filtro da grade compara número, não texto.
    const colunas = ultimo.columns;
    expect(colunas.find((c) => c.id === 'peso').filterKind).toBe('num');
    expect(colunas.find((c) => c.id === 'cabecas').filterKind).toBe('num');
  });

  it('enquanto a lista carrega não aplica; o mesmo pedido não reaplica', async () => {
    const { default: TabelaLotes } = await import('@/components/lotes/TabelaLotes');
    const aplicado = vi.fn();
    const filtroExterno = { id: 7, filtros: {} };
    const { rerender } = render(<TabelaLotes lotes={[]} isLoading filtroExterno={filtroExterno} onFiltroExternoAplicado={aplicado} />);
    expect(aplicado).not.toHaveBeenCalled();
    rerender(<TabelaLotes lotes={LOTES} filtroExterno={filtroExterno} onFiltroExternoAplicado={aplicado} />);
    await waitFor(() => expect(aplicado).toHaveBeenCalledWith({ faltando: [], vazio: true }));
    rerender(<TabelaLotes lotes={[...LOTES]} filtroExterno={filtroExterno} onFiltroExternoAplicado={aplicado} />);
    expect(aplicado).toHaveBeenCalledTimes(1);
    expect(gradeProps.mock.calls.at(-1)[0].filtrosExternos).toEqual({ chave: 7, filtros: {} });
  });
});
