/**
 * D-PROD-178 (MAIKE-MAPA-NIVEIS-COCHO-DEPOSITO-UX01), seção 5 — detalhe do COCHO.
 *
 * `DetalhesPontoSuplementacao` lê o nível SÓ do SSOT
 * (`src/domain/suplementacao/nivelSuplementacao.js`), com o dia civil da
 * fazenda (`useDiaCivil(Empresa.fuso_horario)`), os MESMOS eventos da fazenda e
 * a lista de pontos ativos do cache do mapa — o mesmo número do marcador.
 *
 *  DC-1. dia 1 de um ciclo de 200 kg a 50 kg/dia: 75% no medidor do ciclo,
 *        "150 kg de 200 kg · 75%", taxa do %PV no lançamento, cartões do SSOT,
 *        o mesmo rótulo do `getCochoIndicator` do mapa; o dia é o da FAZENDA
 *        (São Paulo), não o do navegador (UTC); sem `setInterval` de 60 s;
 *  DC-2. limite operacional de 120 kg: medidor "125%" / 30 kg acima e a linha
 *        "No lançamento: 166,67% (80 kg acima)", que continua depois do
 *        consumo (virada do dia pelo `focus`, sem refetch);
 *  DC-3. sem %PV no lançamento: "Estimativa de consumo indisponível" e nada é
 *        chamado de saldo (a base não é saldo);
 *  DC-4. dois cochos com o mesmo produto nos mesmos animais: estimativa não
 *        confiável, sem saldo;
 *  DC-5. período fechado: sobra INFORMADA, sem estimativa de ciclo;
 *  DC-6. sem lançamento: mensagem neutra no lugar do nível;
 *  DC-7. lançamento com data futura: mensagem neutra com a data.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getCochoIndicator } from '@/components/mapa/pontoStatusUtils';

const EMP = 'emp-1';
const SP = 'America/Sao_Paulo';

const dados = vi.hoisted(() => ({ cache: {}, produtos: [], empresas: [] }));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: vi.fn(async (chave) => dados.cache[chave] || []),
  refreshMapaCacheEntry: vi.fn(async (chave) => dados.cache[chave] || []),
  updateMapaCachedData: vi.fn(),
}));
vi.mock('@/services/estoqueMapaService', () => ({ listarTodosProdutos: vi.fn(async () => dados.produtos) }));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => dados.empresas) }));
vi.mock('@/components/suplementacao/FormularioLancamentoSuplementacao', () => ({ default: () => null }));
vi.mock('@/components/suplementacao/HistoricoSuplementacaoPonto', () => ({ default: () => null }));
vi.mock('@/components/mapa/DetalhesDepositoSuplementacao', () => ({ default: () => null }));

const cocho = (id, extra = {}) => ({
  id, empresa_id: EMP, nome_ponto: `COCHO ${id}`, categoria_ponto: 'COCHO', status: 'Ativo',
  area_vinculada_id: 'a1', area_vinculada_ids: ['a1'], capacidade_cocho_kg: null, ...extra,
});
const evento = (id, pontoId, extra = {}) => ({
  id, empresa_id: EMP, ponto_suplementacao_id: pontoId, produto: 'SAL MINERAL', produto_id: 'p-sal',
  data_lancamento: '2026-11-10', quantidade_total_kg: 200, sobra_kg: 0, dias_periodo: null,
  consumo_esperado_pv_kg: 50, total_cabecas_afetadas: 100, created_date: '2026-11-10T12:00:00.000Z', ...extra,
});

/** Texto do valor de um cartão (irmão seguinte do rótulo). */
const valorDe = (raiz, rotulo) => within(raiz).getByText(rotulo).nextElementSibling?.textContent;
const secaoCocho = () => screen.getByRole('region', { name: 'Nível do cocho' });
const medidorCiclo = () => within(secaoCocho()).getByRole('img', { name: /^Restante do ciclo \(estimado\):/ });

let setIntervalSpy;

beforeEach(() => {
  // 01:00 UTC de 12/11 = 22:00 de 11/11 em São Paulo: o dia da FAZENDA é 11/11
  // (no navegador, em UTC, já é 12/11).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T01:00:00.000Z'));
  setIntervalSpy = vi.spyOn(window, 'setInterval');
  dados.produtos = [];
  dados.empresas = [{ id: EMP, nome: 'FAZENDA', fuso_horario: SP }];
  dados.cache = { areas: [{ id: 'a1', empresa_id: EMP, nome: 'PASTO 1' }], pontosSuplementacao: [], eventosSuplementacao: [] };
});

afterEach(() => {
  cleanup();
  setIntervalSpy.mockRestore();
  vi.useRealTimers();
});

const renderizar = async (ponto) => {
  const { default: DetalhesPontoSuplementacao } = await import('@/components/mapa/DetalhesPontoSuplementacao');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <DetalhesPontoSuplementacao ponto={ponto} permissions={{}} onClose={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByText('Informações do Cocho');
  // O fuso vem do resumo de empresas (a mesma consulta `['empresas']` do Layout);
  // as asserções de dia usam `waitFor` até ele chegar.
  await act(async () => {});
  return r;
};

describe('DC-1 — ciclo aberto no dia 1', () => {
  it('75%, kg do ciclo, taxa do %PV no lançamento, cartões do SSOT e o mesmo rótulo do mapa', async () => {
    const ponto = cocho('c1');
    dados.cache.pontosSuplementacao = [ponto];
    // Lançado em 10/11: dia 1 em São Paulo (75%); em UTC seria o dia 2 (50%).
    dados.cache.eventosSuplementacao = [evento('e1', 'c1')];
    await renderizar(ponto);

    await waitFor(() => expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): 75%'));
    const secao = secaoCocho();
    expect(within(secao).getByText('150 kg de 200 kg · 75%')).toBeTruthy();
    expect(within(secao).getByText('Consumo estimado: 50 kg/dia (%PV no lançamento)')).toBeTruthy();
    expect(within(secao).getByText('Dias desde o lançamento: 1 · Restam 3 dia(s)')).toBeTruthy();
    expect(valorDe(secao, 'Saldo estimado')).toBe('150 kg');
    expect(valorDe(secao, 'Duração estimada')).toBe('4 dia(s)');
    expect(valorDe(secao, 'Próxima reposição')).toBe('14/11/2026');
    // Sem limite configurado: medidor neutro com a mensagem.
    expect(within(secao).getByText('Limite operacional não configurado.')).toBeTruthy();
    expect(within(secao).queryByRole('meter')).toBeNull();

    // O MESMO número do marcador do mapa (mesmo SSOT, mesmo dia, mesmos eventos e pontos).
    const mapa = getCochoIndicator(ponto, dados.cache.eventosSuplementacao, { hoje: '2026-11-11', pontos: [ponto] });
    expect(mapa.badgeLabel).toBe('75%');
    expect(medidorCiclo().textContent).toContain(mapa.badgeLabel);

    // "Último registro" usa a taxa do SSOT.
    expect(screen.getByText('Consumo Lote PV/dia').nextElementSibling?.textContent).toBe('50,00 kg');
    // Cadastro: o campo é o limite operacional.
    expect(screen.getByText('Limite operacional:')).toBeTruthy();
    expect(screen.queryByText('Capacidade:')).toBeNull();
    // Nada de polling de 60 s: a virada do dia vem de useDiaCivil.
    expect(setIntervalSpy.mock.calls.some(([, ms]) => ms === 60_000)).toBe(false);
  });
});

describe('DC-2 — limite operacional', () => {
  it('125% / 30 kg acima; "No lançamento: 166,67% (80 kg acima)" continua depois do consumo', async () => {
    const ponto = cocho('c1', { capacidade_cocho_kg: 120 });
    dados.cache.pontosSuplementacao = [ponto];
    dados.cache.eventosSuplementacao = [evento('e1', 'c1')];
    await renderizar(ponto);

    await waitFor(() => expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): 75%'));
    const secao = secaoCocho();
    const medidor = within(secao).getByRole('meter', { name: 'Uso do limite operacional' });
    expect(medidor.getAttribute('aria-valuenow')).toBe('125');
    expect(medidor.getAttribute('aria-valuetext')).toContain('30 kg acima do limite');
    expect(within(secao).getByText('125%')).toBeTruthy();
    expect(within(secao).getByText('150 kg de 120 kg · 30 kg acima do limite')).toBeTruthy();
    expect(within(secao).getByText('No lançamento: 166,67% (80 kg acima)')).toBeTruthy();
    expect(within(secao).getByText(/O limite é o valor configurado hoje/)).toBeTruthy();
    expect(screen.getByText('Limite operacional:').nextElementSibling?.textContent).toBe('120,00 kg');

    // Dois dias depois (13/11 na fazenda, sem refetch): saldo 50 kg, dentro do limite; o lançamento continua visível.
    vi.setSystemTime(new Date('2026-11-14T01:00:00.000Z'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): 25%'));
    const depois = within(secaoCocho()).getByRole('meter', { name: 'Uso do limite operacional' });
    expect(depois.getAttribute('aria-valuenow')).toBe('41.67');
    expect(within(secaoCocho()).getByText('50 kg de 120 kg · dentro do limite')).toBeTruthy();
    expect(within(secaoCocho()).getByText('No lançamento: 166,67% (80 kg acima)')).toBeTruthy();
  });
});

describe('DC-3 — sem taxa no lançamento', () => {
  it('"Estimativa de consumo indisponível" e a base do ciclo não é chamada de saldo', async () => {
    const ponto = cocho('c1', { capacidade_cocho_kg: 120 });
    dados.cache.pontosSuplementacao = [ponto];
    dados.cache.eventosSuplementacao = [evento('e1', 'c1', { consumo_esperado_pv_kg: null })];
    const { container } = await renderizar(ponto);

    const secao = secaoCocho();
    await waitFor(() => expect(within(secao).getByText('Estimativa de consumo indisponível: o produto não tinha %PV no lançamento.')).toBeTruthy());
    expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): Sem estimativa');
    expect(secao.querySelector('[data-cocho-nivel]')).toBeNull();
    expect(container.textContent).not.toMatch(/saldo/i);
    expect(within(secao).queryByText('Duração estimada')).toBeNull();
    expect(within(secao).queryByText('Próxima reposição')).toBeNull();
    // Medidor do limite neutro; o lançamento continua comparado com o limite.
    expect(within(secao).queryByRole('meter')).toBeNull();
    expect(within(secao).getByText('No lançamento: 166,67% (80 kg acima)')).toBeTruthy();
    // Sem taxa do SSOT, o "Último registro" não projeta nada.
    expect(screen.getByText('Consumo Lote PV/dia').nextElementSibling?.textContent).toBe('-');
    expect(screen.getByText('Próx. reposição').nextElementSibling?.textContent).toBe('-');
  });
});

describe('DC-4 — cochos compartilhando os mesmos animais', () => {
  it('mesmo produto nas mesmas áreas: estimativa não confiável, sem saldo e sem projeção', async () => {
    const c1 = cocho('c1');
    const c2 = cocho('c2');
    dados.cache.pontosSuplementacao = [c1, c2];
    dados.cache.eventosSuplementacao = [
      evento('e1', 'c1'),
      evento('e2', 'c2', { data_lancamento: '2026-11-09' }),
    ];
    const { container } = await renderizar(c1);

    const secao = secaoCocho();
    await waitFor(() => expect(within(secao).getByText('Estimativa não confiável: 2 cochos com o mesmo produto atendem os mesmos animais e o consumo não é rateado entre eles.')).toBeTruthy());
    expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): Sem estimativa');
    expect(container.textContent).not.toMatch(/saldo/i);
    expect(screen.getByText('Consumo Lote PV/dia').nextElementSibling?.textContent).toBe('-');
    // O mapa diz o mesmo.
    expect(getCochoIndicator(c1, dados.cache.eventosSuplementacao, { hoje: '2026-11-11', pontos: [c1, c2] }).nivel.confiabilidade).toBe('compartilhada');
  });
});

describe('DC-5 — período fechado', () => {
  it('mostra a sobra INFORMADA no fechamento, sem estimativa de ciclo', async () => {
    const ponto = cocho('c1', { capacidade_cocho_kg: 120 });
    dados.cache.pontosSuplementacao = [ponto];
    dados.cache.eventosSuplementacao = [evento('e1', 'c1', { data_lancamento: '2026-11-03', dias_periodo: 5, sobra_kg: 30 })];
    await renderizar(ponto);

    const secao = secaoCocho();
    await waitFor(() => expect(within(secao).getByText('Período fechado; sobra informada de 30 kg. Não há ciclo aberto.')).toBeTruthy());
    expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): Período fechado');
    expect(valorDe(secao, 'Sobra informada')).toBe('30 kg');
    expect(within(secao).queryByText('Saldo estimado')).toBeNull();
    expect(within(secao).queryByText('Duração estimada')).toBeNull();
    const medidor = within(secao).getByRole('meter', { name: 'Uso do limite operacional' });
    expect(medidor.getAttribute('aria-valuenow')).toBe('25');
    expect(within(secao).queryByText(/^No lançamento:/)).toBeNull();
  });
});

describe('DC-6 — sem lançamento', () => {
  it('nível neutro com a mensagem, sem número inventado', async () => {
    const ponto = cocho('c1', { capacidade_cocho_kg: 120 });
    dados.cache.pontosSuplementacao = [ponto];
    await renderizar(ponto);

    const secao = secaoCocho();
    expect(within(secao).getByText('Nenhum lançamento registrado neste cocho.')).toBeTruthy();
    expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): Sem lançamento');
    expect(secao.querySelector('[data-cocho-nivel]')).toBeNull();
    expect(within(secao).queryByRole('meter')).toBeNull();
    expect(within(secao).queryByText(/\d+%/)).toBeNull();
    expect(screen.getByText('Nenhum lançamento ainda.')).toBeTruthy();
  });
});

describe('DC-7 — lançamento com data futura', () => {
  it('neutro, com a data em que a estimativa começa', async () => {
    const ponto = cocho('c1');
    dados.cache.pontosSuplementacao = [ponto];
    // 12/11 já é hoje em UTC, mas ainda é amanhã na fazenda.
    dados.cache.eventosSuplementacao = [evento('e1', 'c1', { data_lancamento: '2026-11-12' })];
    await renderizar(ponto);

    const secao = secaoCocho();
    await waitFor(() => expect(within(secao).getByText('Lançamento com data futura (12/11/2026); a estimativa começa nessa data.')).toBeTruthy());
    expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): Lançamento futuro');
    expect(secao.querySelector('[data-cocho-nivel]')).toBeNull();
    expect(screen.getByText(/^Data:/).textContent).toBe('Data: 12/11/2026');
  });
});

describe('CochoNivel neutro', () => {
  it('sem estimativa: mesmo SVG sem preenchimento e o rótulo do estado no lugar de "0%"', async () => {
    const { default: CochoNivel } = await import('@/components/mapa/CochoNivel');
    const { container, rerender } = render(<CochoNivel percent={0.8} neutro rotuloNeutro="Período fechado" label="Restante do ciclo (estimado)" />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toBe('Restante do ciclo (estimado): Período fechado');
    expect(img.hasAttribute('data-cocho-neutro')).toBe(true);
    expect(container.querySelector('[data-cocho-nivel]')).toBeNull();
    expect(screen.getByText('Período fechado')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
    const formaNeutra = container.querySelector('svg').innerHTML;
    // Fora do neutro, o mesmo componente desenha o nível como antes.
    rerender(<CochoNivel percent={0.8} label="Restante do ciclo (estimado)" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Restante do ciclo (estimado): 80%');
    expect(container.querySelector('[data-cocho-nivel]')?.getAttribute('data-cocho-nivel')).toBe('80');
    expect(screen.getByRole('img').hasAttribute('data-cocho-neutro')).toBe(false);
    // Mesmo desenho do corpo e dos pés (só o preenchimento muda).
    rerender(<CochoNivel percent={0} label="Restante do ciclo (estimado)" />);
    expect(container.querySelector('svg').innerHTML.replace(/cocho-[^")]+/g, '')).toBe(formaNeutra.replace(/cocho-[^")]+/g, ''));
  });
});
