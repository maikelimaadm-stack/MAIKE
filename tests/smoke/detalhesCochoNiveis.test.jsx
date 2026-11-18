/**
 * D-PROD-178 (MAIKE-MAPA-NIVEIS-COCHO-DEPOSITO-UX01), seção 5 — detalhe do COCHO.
 *
 * `DetalhesPontoSuplementacao` lê o nível SÓ do SSOT
 * (`src/domain/suplementacao/nivelSuplementacao.js`), com o dia civil da
 * fazenda (`useDiaCivil(Empresa.fuso_horario)`), os MESMOS eventos da fazenda e
 * a lista de pontos ativos do cache do mapa — o mesmo número do marcador.
 *
 *  DC-1. dia 1 de um ciclo de 200 kg a 50 kg/dia: 75% no medidor do ciclo (o
 *        número aparece UMA vez), "150 kg de 200 kg", taxa do %PV no
 *        lançamento, cartões do SSOT,
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
 *  DC-7. lançamento com data futura: mensagem neutra com a data;
 *  DC-8. o detalhe lê eventos e pontos da MESMA consulta do Mapa Geral
 *        (`['mapa-cache', chave, empresa, 'default']`): com o mapa já tendo a
 *        lista nova (outro cocho no mesmo pasto), o detalhe mostra o mesmo
 *        estado do marcador, mesmo que o cache local esteja velho.
 *
 * D-PROD-220: a tela está no desenho do Detalhes do Lote v12. As verificações
 * são as mesmas; mudou só onde o valor está: o cadastro e os cartões são
 * células da grade (`dt` rótulo → `dd` valor, sem os dois-pontos), as seções
 * têm o título do v12 ("Informações do cocho") e o farol do período fechado
 * diz "abaixo da faixa da formulação (±15%)", com o custo por cab/dia em R$
 * no rótulo da célula.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  await screen.findByRole('region', { name: 'Nível do cocho' });
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
    // O percentual do ciclo aparece uma vez na figura (o texto do `role="img"`)
    // e uma vez visível dentro do ícone (`.mk-dp-cocho__pct`, com `aria-hidden`).
    expect(within(medidorCiclo()).getAllByText(/75%/)).toHaveLength(1);
    expect(secao.querySelector('.mk-dp-cocho__pct')?.textContent).toBe('75%');
    expect(valorDe(secao, 'Saldo estimado do cocho')).toBe('150 kg');
    expect(valorDe(secao, 'Consumo estimado/dia')).toBe('50 kg/dia');
    expect(within(secao).queryByText(/Base do ciclo:/)).toBeNull();
    expect(within(secao).queryByText(/Dias desde o abastecimento:/)).toBeNull();
    expect(valorDe(secao, 'Duração estimada')).toBe('4 dia(s)');
    expect(valorDe(secao, 'Próxima reposição')).toBe('14/11/2026');
    expect(within(secao).queryByRole('meter')).toBeNull();

    // O MESMO número do marcador do mapa (mesmo SSOT, mesmo dia, mesmos eventos e pontos).
    const mapa = getCochoIndicator(ponto, dados.cache.eventosSuplementacao, { hoje: '2026-11-11', pontos: [ponto] });
    expect(mapa.badgeLabel).toBe('75%');
    expect(medidorCiclo().textContent).toContain(mapa.badgeLabel);

    // "Último registro" usa a taxa do SSOT.
    expect(screen.queryByText('Consumo Lote PV/dia')).toBeNull();
    // Cadastro (na aba Informações): o campo é o limite operacional; os limites de consumo dizem que são por cabeça/dia.
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Informações' })); });
    expect(valorDe(screen.getByRole('region', { name: 'Informações do cocho' }), 'Limite operacional')).toBe('-');
    expect(screen.queryByText('Capacidade')).toBeNull();
    expect(screen.getByText('Consumo mín./cab/dia').tagName).toBe('DT');
    expect(screen.getByText('Consumo máx./cab/dia').tagName).toBe('DT');
    expect(screen.queryByText('Limite mínimo')).toBeNull();
    expect(screen.queryByText('Limite máximo')).toBeNull();
    // Nada de polling de 60 s: a virada do dia vem de useDiaCivil.
    expect(setIntervalSpy.mock.calls.some(([, ms]) => ms === 60_000)).toBe(false);
  });
});

describe('DC-2 — limite operacional', () => {
  it('125% / 30 kg acima e "166,67% (80 kg acima)" na aba Informações continuam depois do consumo', async () => {
    const ponto = cocho('c1', { capacidade_cocho_kg: 120 });
    dados.cache.pontosSuplementacao = [ponto];
    dados.cache.eventosSuplementacao = [evento('e1', 'c1')];
    await renderizar(ponto);

    await waitFor(() => expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): 75%'));
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Informações' })); });
    const info = screen.getByRole('region', { name: 'Informações do cocho' });
    expect(valorDe(info, 'Limite operacional')).toBe('120 kg');
    expect(valorDe(info, 'Uso do limite')).toBe('125% (30 kg acima)');
    expect(valorDe(info, 'No lançamento')).toBe('166,67% (80 kg acima)');

    // Dois dias depois (13/11 na fazenda, sem refetch): saldo 50 kg, dentro do limite; o lançamento continua visível.
    vi.setSystemTime(new Date('2026-11-14T01:00:00.000Z'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(valorDe(screen.getByRole('region', { name: 'Informações do cocho' }), 'Uso do limite')).toBe('41,67%'));
    expect(valorDe(screen.getByRole('region', { name: 'Informações do cocho' }), 'No lançamento')).toBe('166,67% (80 kg acima)');
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
    expect(within(secao).getByText('Cadastre o %PV do produto; a estimativa volta no próximo lançamento.')).toBeTruthy();
    expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): Sem estimativa');
    expect(secao.querySelector('[data-cocho-nivel]')).toBeNull();
    expect(container.textContent).not.toMatch(/saldo/i);
    expect(within(secao).queryByText('Duração estimada')).toBeNull();
    expect(within(secao).queryByText('Próxima reposição')).toBeNull();
    // Sem taxa do SSOT, o "Último registro" não projeta nada; o lançamento continua comparado com o limite na aba Informações.
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Informações' })); });
    expect(valorDe(screen.getByRole('region', { name: 'Informações do cocho' }), 'No lançamento')).toBe('166,67% (80 kg acima)');
    expect(screen.queryByText('Consumo Lote PV/dia')).toBeNull();
    expect(screen.queryByText('Próx. reposição')).toBeNull();
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
    expect(within(secao).getByText('A estimativa volta quando só um cocho com este produto atender estes animais.')).toBeTruthy();
    expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): Sem estimativa');
    expect(container.textContent).not.toMatch(/saldo/i);
    expect(screen.queryByText('Consumo Lote PV/dia')).toBeNull();
    // O mapa diz o mesmo.
    expect(getCochoIndicator(c1, dados.cache.eventosSuplementacao, { hoje: '2026-11-11', pontos: [c1, c2] }).nivel.confiabilidade).toBe('compartilhada');
  });
});

describe('DC-5 — período fechado', () => {
  it('mostra a sobra INFORMADA no fechamento, sem estimativa de ciclo', async () => {
    const ponto = cocho('c1', { capacidade_cocho_kg: 120 });
    dados.cache.pontosSuplementacao = [ponto];
    dados.cache.eventosSuplementacao = [evento('e1', 'c1', { data_lancamento: '2026-11-03', dias_periodo: 5, sobra_kg: 30, consumo_diario_grupo_kg: 34 })];
    await renderizar(ponto);

    const secao = secaoCocho();
    await waitFor(() => expect(within(secao).getByText('Período fechado; sobra informada de 30 kg. Não há ciclo aberto.')).toBeTruthy());
    expect(medidorCiclo().getAttribute('aria-label')).toBe('Restante do ciclo (estimado): Período fechado');
    expect(valorDe(secao, 'Sobra informada')).toBe('30 kg');
    expect(within(secao).queryByText('Saldo estimado')).toBeNull();
    expect(within(secao).queryByText('Duração estimada')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Informações' })); });
    expect(valorDe(screen.getByRole('region', { name: 'Informações do cocho' }), 'Uso do limite')).toBe('25%');
    expect(within(screen.getByRole('region', { name: 'Informações do cocho' })).queryByText('No lançamento')).toBeNull();

    expect(screen.queryByRole('heading', { name: 'Último registro' })).toBeNull();

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
    expect(screen.queryByRole('heading', { name: 'Último registro' })).toBeNull();
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
    expect(screen.queryByRole('heading', { name: 'Último registro' })).toBeNull();
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

describe('DC-8 — mesma fonte de dados do mapa', () => {
  it('com a lista do mapa já atualizada (dois cochos no pasto), o detalhe mostra o mesmo estado do marcador', async () => {
    const a = cocho('c1');
    const b = cocho('c2');
    const eventos = [evento('e1', 'c1'), evento('e2', 'c2')];
    // Cache local velho: só o c1, sem o lançamento do c2.
    dados.cache.pontosSuplementacao = [a];
    dados.cache.eventosSuplementacao = [evento('e1', 'c1')];
    const { default: DetalhesPontoSuplementacao } = await import('@/components/mapa/DetalhesPontoSuplementacao');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
    // O Mapa Geral já tem a lista nova nas chaves dele.
    qc.setQueryData(['mapa-cache', 'pontosSuplementacao', EMP, 'default'], [a, b]);
    qc.setQueryData(['mapa-cache', 'eventosSuplementacao', EMP, 'default'], eventos);
    render(
      <QueryClientProvider client={qc}>
        <DetalhesPontoSuplementacao ponto={a} permissions={{}} onClose={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByRole('region', { name: 'Nível do cocho' });
    await act(async () => {});
    const marcador = getCochoIndicator(a, eventos, { hoje: '2026-11-11', pontos: [a, b] });
    expect(marcador.nivel.confiabilidade).toBe('compartilhada');
    await waitFor(() => expect(within(secaoCocho()).getAllByText(/Estimativa não confiável: 2 cochos/).length).toBeGreaterThan(0));
  });
});

describe('DC-206 — D-PROD-206: cartão "Último período fechado" no detalhe do cocho', () => {
  it('mostra o período fechado mais recente com o farol (texto), %PV e custo; sem período fechado, avisa', async () => {
    const ponto = cocho('c9');
    dados.cache.pontosSuplementacao = [ponto];
    dados.cache.eventosSuplementacao = [
      evento('e-antigo', 'c9', { data_lancamento: '2026-10-01', dias_periodo: 10, consumo_diario_grupo_kg: 50, farol_consumo: 'acima', consumo_relacao_esperado: 1.3, faixa_tolerancia_aplicada: 15, sobra_informada: true }),
      evento('e-fechado', 'c9', { data_lancamento: '2026-11-01', dias_periodo: 9, consumo_diario_grupo_kg: 40, farol_consumo: 'abaixo', consumo_relacao_esperado: 0.8, faixa_tolerancia_aplicada: 15, sobra_informada: false, custo_cab_dia: 1.2, custo_total_periodo: 1080, custo_unitario_kg: 3 }),
      evento('e-aberto', 'c9', { data_lancamento: '2026-11-10' }),
    ];
    await renderizar(ponto);
    fireEvent.click(screen.getByRole('tab', { name: 'Fechamentos' }));
    const cartao = (await screen.findAllByTestId('ultimo-periodo-fechado'))[0];
    expect(cartao.textContent).toMatch(/01\/11\/2026 · 9 dia\(s\)/);
    expect(within(cartao).getByTestId('farol-consumo').textContent).toBe('Abaixo (-20%)');
    expect(within(cartao).getByTestId('farol-consumo').getAttribute('data-farol')).toBe('abaixo');
    expect(within(cartao).getByTestId('fechamento-aproximado')).toBeTruthy();
    expect(valorDe(cartao, 'Custo por cab/dia (R$)')).toBe('1,20');
    cleanup();
    dados.cache.eventosSuplementacao = [evento('e-aberto', 'c9')];
    await renderizar(ponto);
    fireEvent.click(screen.getByRole('tab', { name: 'Fechamentos' }));
    expect(screen.getByText('Nenhum período fechado ainda.')).toBeTruthy();
  });
});
