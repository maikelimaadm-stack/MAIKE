/**
 * D-PROD-219 — Medição de Forragem do pasto.
 *
 *  - formulário: régua com leituras pt-BR → prévia da média e da situação pelas
 *    alturas da cultura; amostra de corte → matéria verde, MS% e massa seca e o total
 *    no pasto; no olho → só a situação; envia só o que o servidor aceita e grava no
 *    cache do mapa;
 *  - porta: o POST leva só os campos aceitos (derivados e cliente_id ficam de fora);
 *  - detalhe da área: com `medir_forragem` aparece o painel Forragem com o botão, a
 *    última medição e as últimas, com excluir; sem a chave, nada; o clique no pasto
 *    abre o detalhe com a chave mesmo sem a permissão de histórico.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { corpoDaMedicao } from '@/apis/medicoes-forragem/medicaoForragemNativePort';
import { acaoDoCliqueNaArea, podeMedirForragemNaArea } from '@/domain/mapa/cliqueArea';

const EMP = 'emp-1';
const dados = vi.hoisted(() => ({ cache: {}, culturas: [] }));
const servico = vi.hoisted(() => ({ registrar: vi.fn(), excluir: vi.fn() }));
const avisos = vi.hoisted(() => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), confirmar: vi.fn() }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: 'c-1', user: { id: 'u-1' } }) }));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: vi.fn(async (chave) => dados.cache[chave] || []),
  getMapaCacheSnapshot: vi.fn(async () => ({ items: [], atualizadoEm: null })),
  refreshMapaCacheEntry: vi.fn(async (chave) => dados.cache[chave] || []),
  updateMapaCachedData: vi.fn(async (chave, _e, fn) => {
    dados.cache[chave] = fn(dados.cache[chave] || []);
    return dados.cache[chave];
  }),
}));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => [{ id: 'emp-1', fuso_horario: 'America/Sao_Paulo' }]) }));
vi.mock('@/services/culturaCadastroService', () => ({ listarCulturas: vi.fn(async () => dados.culturas) }));
vi.mock('@/services/medicaoForragemService', () => ({
  registrarMedicaoForragem: (...a) => servico.registrar(...a),
  excluirMedicaoForragem: (...a) => servico.excluir(...a),
}));
vi.mock('@/services/loteManejoService', () => ({ listarHistoricoMovimentacoesPagina: vi.fn(async () => ({ items: [], next_cursor: null, has_more: false, total: 0, limit: 100 })) }));
vi.mock('@/lib/maikeNotify', () => ({
  notifyWarning: (...a) => avisos.warning(...a),
  notifySuccess: (...a) => avisos.success(...a),
  notifyError: (...a) => avisos.error(...a),
  notifyInfo: vi.fn(),
}));
vi.mock('@/lib/maikeConfirmar', () => ({ confirmarExclusao: (...a) => avisos.confirmar(...a), confirmar: vi.fn(), avisar: vi.fn() }));

const { default: FormularioMedicaoForragem } = await import('@/components/pastagem/FormularioMedicaoForragem');
const { default: DetalhesArea } = await import('@/components/mapa/DetalhesArea');

const MARANDU = { id: 'cu-1', codigo: '001', nome: 'BRACHIARIA BRIZANTHA CV. MARANDU', altura_entrada_cm: 25, altura_saida_cm: 15 };
const PASTO = { id: 'area-12', empresa_id: EMP, nome: 'PASTO 12', tamanho_hectares: 8, tipo_cultura: 'Pastagem', cultura_id: 'cu-1' };
const HOJE = '2027-06-15';

const renderizar = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  // D-PROD-289: nos Detalhes da área, a Forragem tem aba própria.
  const aba = screen.queryByRole('tab', { name: 'Forragem' });
  if (aba) fireEvent.click(aba);
  return r;
};

beforeEach(() => {
  dados.cache = {};
  dados.culturas = [MARANDU];
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  servico.registrar.mockImplementation(async (corpo) => ({ id: 'mf-1', ...corpo, altura_media_cm: 24, situacao: 'DESCANSO', data_medicao: corpo.data_medicao }));
  servico.excluir.mockResolvedValue(undefined);
  avisos.confirmar.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('D-PROD-219 — formulário da medição', () => {
  it('régua + amostra: prévia da média/situação e da matéria verde/seca; envia leituras e a amostra, sem derivados', async () => {
    const onSaved = vi.fn();
    renderizar(<FormularioMedicaoForragem area={PASTO} cultura={MARANDU} hoje={HOJE} onCancel={() => {}} onSaved={onSaved} />);
    expect(screen.getByTestId('medicao-cabecalho').textContent).toContain('001 · BRACHIARIA BRIZANTHA CV. MARANDU');
    expect(screen.getByRole('radio', { name: 'Régua' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByTestId('medicao-leituras'), { target: { value: '22 26 24 20 28 25 23 27 24 21' } });
    expect(screen.getByTestId('medicao-media').textContent).toMatch(/Média 24,0 cm.*10 leituras.*Descanso.*a partir de 25,0 cm/);
    fireEvent.change(screen.getByTestId('medicao-quadro'), { target: { value: '0,25' } });
    fireEvent.change(screen.getByTestId('medicao-peso-verde'), { target: { value: '450' } });
    fireEvent.change(screen.getByTestId('medicao-peso-seco'), { target: { value: '112,5' } });
    const amostra = screen.getByTestId('medicao-amostra').textContent;
    expect(amostra).toContain('18.000');
    expect(amostra).toContain('25,0');
    expect(amostra).toContain('4.500');
    expect(amostra).toContain('36,0 t de matéria seca');
    expect(screen.queryByTestId('medicao-ms-pct'), 'com peso seco, a % digitada some').toBeNull();
    await act(async () => {
      fireEvent.submit(screen.getByTestId('form-medicao-forragem'));
    });
    expect(servico.registrar).toHaveBeenCalledTimes(1);
    const corpo = servico.registrar.mock.calls[0][0];
    expect(corpo).toMatchObject({ empresa_id: EMP, area_id: 'area-12', data_medicao: HOJE, metodo: 'REGUA', leituras_cm: [22, 26, 24, 20, 28, 25, 23, 27, 24, 21], quadro_m2: '0,25', peso_verde_g: '450', peso_seco_g: '112,5' });
    expect(corpo.materia_seca_pct).toBeUndefined();
    expect(corpo.situacao).toBeUndefined();
    expect(dados.cache.medicoesForragem.map((m) => m.id)).toEqual(['mf-1']);
    expect(onSaved).toHaveBeenCalled();
  });

  it('celular: cada leitura entra pelo "+" (ou Enter/sair do campo), vira um item removível e conta na média; a digitada sem "+" também vai', async () => {
    renderizar(<FormularioMedicaoForragem area={PASTO} cultura={MARANDU} hoje={HOJE} onCancel={() => {}} />);
    const campo = screen.getByTestId('medicao-leituras');
    for (const v of ['22', '26', '24,5']) {
      fireEvent.change(campo, { target: { value: v } });
      fireEvent.click(screen.getByTestId('medicao-adicionar-leitura'));
    }
    expect(campo.value).toBe('');
    expect(screen.getByTestId('medicao-lista-leituras').textContent).toContain('24,5');
    fireEvent.change(campo, { target: { value: '30' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(screen.getByTestId('medicao-media').textContent).toMatch(/Média 25,6 cm.*4 leituras/);
    fireEvent.click(screen.getByLabelText('Remover a leitura 30,0 cm'));
    expect(screen.getByTestId('medicao-media').textContent).toMatch(/3 leituras/);
    fireEvent.change(campo, { target: { value: '20' } });
    fireEvent.blur(campo);
    expect(screen.getByTestId('medicao-media').textContent).toMatch(/4 leituras/);
    fireEvent.change(campo, { target: { value: '21' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('form-medicao-forragem'));
    });
    expect(servico.registrar.mock.calls[0][0].leituras_cm).toEqual([22, 26, 24.5, 20, 21]);
  });

  it('régua: PRONTO e PASSOU pelos limites; sem cultura, só a média; leituras vazias avisam e não enviam', async () => {
    renderizar(<FormularioMedicaoForragem area={PASTO} cultura={MARANDU} hoje={HOJE} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId('medicao-leituras'), { target: { value: '30' } });
    expect(screen.getByTestId('medicao-media').textContent).toContain('Pronto');
    fireEvent.change(screen.getByTestId('medicao-leituras'), { target: { value: '30,1' } });
    expect(screen.getByTestId('medicao-media').textContent).toContain('Passou do ponto');
    fireEvent.change(screen.getByTestId('medicao-leituras'), { target: { value: '' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('form-medicao-forragem'));
    });
    expect(servico.registrar).not.toHaveBeenCalled();
    expect(avisos.warning).toHaveBeenCalled();
    cleanup();
    renderizar(<FormularioMedicaoForragem area={{ ...PASTO, cultura_id: null }} cultura={null} hoje={HOJE} onCancel={() => {}} />);
    expect(screen.getByTestId('medicao-cabecalho').textContent).toContain('sem cultura');
    fireEvent.change(screen.getByTestId('medicao-leituras'), { target: { value: '20 22' } });
    expect(screen.getByTestId('medicao-media').textContent).toContain('só a média');
  });

  it('D-PROD-223: com alturas próprias do pasto, o cabeçalho diz "(do pasto)" e a prévia usa as do pasto', () => {
    renderizar(<FormularioMedicaoForragem area={{ ...PASTO, altura_entrada_cm: 20, altura_saida_cm: 12 }} cultura={MARANDU} hoje={HOJE} onCancel={() => {}} />);
    expect(screen.getByTestId('medicao-alturas').textContent).toBe(' — entrada 20,0 cm · saída 12,0 cm (do pasto)');
    fireEvent.change(screen.getByTestId('medicao-leituras'), { target: { value: '22' } });
    expect(screen.getByTestId('medicao-media').textContent).toContain('Pronto');
    cleanup();
    renderizar(<FormularioMedicaoForragem area={PASTO} cultura={MARANDU} hoje={HOJE} onCancel={() => {}} />);
    expect(screen.getByTestId('medicao-alturas').textContent).toBe(' — entrada 25,0 cm · saída 15,0 cm');
  });

  it('MS% do laboratório sem peso seco; no olho envia só a situação', async () => {
    renderizar(<FormularioMedicaoForragem area={PASTO} cultura={MARANDU} hoje={HOJE} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId('medicao-leituras'), { target: { value: '24' } });
    fireEvent.change(screen.getByTestId('medicao-quadro'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('medicao-peso-verde'), { target: { value: '1200' } });
    fireEvent.change(screen.getByTestId('medicao-ms-pct'), { target: { value: '22,5' } });
    expect(screen.getByTestId('medicao-amostra').textContent).toContain('2.700');
    await act(async () => {
      fireEvent.submit(screen.getByTestId('form-medicao-forragem'));
    });
    expect(servico.registrar.mock.calls[0][0]).toMatchObject({ materia_seca_pct: '22,5', peso_seco_g: undefined });
    cleanup();
    servico.registrar.mockClear();
    renderizar(<FormularioMedicaoForragem area={PASTO} cultura={MARANDU} hoje={HOJE} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'No olho' }));
    expect(screen.queryByTestId('medicao-leituras')).toBeNull();
    await act(async () => {
      fireEvent.submit(screen.getByTestId('form-medicao-forragem'));
    });
    expect(servico.registrar, 'sem situação não envia').not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Pronto' }));
    expect(screen.getByTestId('medicao-olho').textContent).toContain('Pronto');
    await act(async () => {
      fireEvent.submit(screen.getByTestId('form-medicao-forragem'));
    });
    const corpo = servico.registrar.mock.calls[0][0];
    expect(corpo).toMatchObject({ metodo: 'OLHO', situacao: 'PRONTO' });
    expect(corpo.leituras_cm).toBeUndefined();
    expect(corpo.quadro_m2).toBeUndefined();
  });

  it('porta: o POST leva só os campos aceitos pelo servidor', () => {
    expect(corpoDaMedicao({ empresa_id: 'e', area_id: 'a', data_medicao: HOJE, metodo: 'OLHO', situacao: 'PRONTO', altura_media_cm: 9, massa_seca_kg_ha: 1, cliente_id: 'x', created_date: 'y', _isOffline: true }))
      .toEqual({ empresa_id: 'e', area_id: 'a', data_medicao: HOJE, metodo: 'OLHO', situacao: 'PRONTO' });
  });
});

describe('D-PROD-219 — botão no pasto (detalhe da área)', () => {
  it('a chave medir_forragem abre o detalhe do pasto mesmo sem o histórico; infraestrutura não', () => {
    const so = { visualizar_historico_movimentacoes_lote: false, medir_forragem: true };
    expect(acaoDoCliqueNaArea({ area: PASTO, selecionandoLocalTarefa: false, toqueLongoAcabouDeDisparar: false, permissoes: so })).toBe('abrir-detalhes');
    expect(podeMedirForragemNaArea(so, { ...PASTO, tipo_cultura: 'Infraestrutura' })).toBe(false);
    expect(podeMedirForragemNaArea({ medir_forragem: undefined }, PASTO), 'gravadora: ausente não libera').toBe(false);
  });

  it('com a chave: painel Forragem com o botão, a última medição e excluir; sem a chave, nada', async () => {
    dados.cache.medicoesForragem = [
      { id: 'm1', empresa_id: EMP, area_id: 'area-12', data_medicao: '2027-06-10', metodo: 'REGUA', altura_media_cm: 24, situacao: 'DESCANSO', massa_seca_kg_ha: 4500, registrado_por_nome: 'MAIKE' },
      { id: 'm2', empresa_id: EMP, area_id: 'area-12', data_medicao: '2027-06-14', metodo: 'OLHO', situacao: 'PRONTO' },
      { id: 'm3', empresa_id: EMP, area_id: 'outra', data_medicao: '2027-06-15', metodo: 'OLHO', situacao: 'RAPADO' },
    ];
    renderizar(<DetalhesArea area={PASTO} permissions={{ visualizar_historico_movimentacoes_lote: false, medir_forragem: true }} />);
    expect(await screen.findByTestId('painel-forragem')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Medição de Forragem' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('ultima-medicao').textContent).toContain('No olho · Pronto'));
    expect(screen.getAllByRole('button', { name: /Excluir a medição/ })).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Excluir a medição de 10/06/2027' }));
    });
    expect(servico.excluir).toHaveBeenCalledWith('m1');
    expect(dados.cache.medicoesForragem.map((m) => m.id)).toEqual(['m2', 'm3']);
    cleanup();
    const { container } = renderizar(<DetalhesArea area={PASTO} permissions={{ visualizar_historico_movimentacoes_lote: false }} />);
    // D-PROD-254: o painel abre para quem vê a área (só o cartão); sem a chave, nada de Forragem.
    expect(container.textContent).toContain('PASTO 12');
    expect(container.textContent).not.toContain('Medição de Forragem');
  });

  it('D-PROD-221 no desenho v12 (D-PROD-220): o farol do pasto é a 1ª linha do cartão — cor, rótulo, há quantos dias e vencida', async () => {
    // Só o relógio: o "hoje" da fazenda (useDiaCivil, America/Sao_Paulo) vira 15/06/2027.
    vi.useFakeTimers({ now: new Date('2027-06-15T15:00:00Z'), toFake: ['Date'] });
    try {
      const linhaDoFarol = async () => {
        const farol = await screen.findByTestId('farol-forragem');
        const cartao = /** @type {HTMLElement} */ (screen.getByTestId('painel-forragem').querySelector('.mk-dp-cartao'));
        // Antes da última medição, dentro do mesmo cartão (linha do v12, não o selo do desenho antigo).
        expect(cartao.firstElementChild).toBe(farol);
        expect(farol.classList.contains('mk-dp-linha')).toBe(true);
        return {
          rotulo: farol.querySelector('.mk-dp-linha__rot')?.textContent,
          valor: farol.querySelector('.mk-dp-linha__val')?.textContent,
          cor: /** @type {HTMLElement | null} */ (farol.querySelector('.mk-dp-bolinha'))?.style.background,
        };
      };
      dados.cache.medicoesForragem = [
        { id: 'm1', empresa_id: EMP, area_id: 'area-12', data_medicao: '2027-06-10', metodo: 'REGUA', altura_media_cm: 24, situacao: 'DESCANSO' },
        { id: 'm2', empresa_id: EMP, area_id: 'area-12', data_medicao: '2027-06-14', metodo: 'REGUA', altura_media_cm: 30, situacao: 'PRONTO' },
      ];
      renderizar(<DetalhesArea area={PASTO} permissions={{ visualizar_historico_movimentacoes_lote: false, medir_forragem: true }} />);
      await waitFor(async () => expect((await linhaDoFarol()).valor).toBe('há 1 dia'));
      expect(await linhaDoFarol()).toEqual({ rotulo: 'Pronto', valor: 'há 1 dia', cor: 'rgb(22, 163, 74)' });
      cleanup();

      // Mais de 15 dias: "Sem medição recente", cinza, e o aviso de vencida.
      dados.cache.medicoesForragem = [{ id: 'm9', empresa_id: EMP, area_id: 'area-12', data_medicao: '2027-05-01', metodo: 'OLHO', situacao: 'PRONTO' }];
      renderizar(<DetalhesArea area={PASTO} permissions={{ visualizar_historico_movimentacoes_lote: false, medir_forragem: true }} />);
      await waitFor(async () => expect((await linhaDoFarol()).rotulo).toBe('Sem medição recente'));
      expect(await linhaDoFarol()).toEqual({ rotulo: 'Sem medição recente', valor: 'há 45 dias · vencida (mais de 15 dias)', cor: 'rgb(148, 163, 184)' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('D-PROD-223 — farol estimado no painel do pasto', () => {
  const PERM = { visualizar_historico_movimentacoes_lote: false, medir_forragem: true };
  // O dia civil da fazenda vem do relógio: fixa só o Date (os timers do waitFor seguem reais).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${HOJE}T15:00:00.000Z`) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sem medição recente: "Pronto (estimado) · lote saiu há 32 dias · descanso da cultura 30 dias"', async () => {
    dados.culturas = [{ ...MARANDU, dias_descanso: 30 }];
    dados.cache.medicoesForragem = [{ id: 'velha', empresa_id: EMP, area_id: 'area-12', data_medicao: '2027-05-01', metodo: 'OLHO', situacao: 'RAPADO' }];
    dados.cache.descansoPastos = [{ area_id: 'area-12', ocupada: false, ultima_saida: '2027-05-14' }];
    renderizar(<DetalhesArea area={PASTO} permissions={PERM} />);
    await waitFor(() => expect(screen.getByTestId('farol-forragem').textContent).toContain('Pronto (estimado)'));
    expect(screen.getByTestId('farol-forragem-estimado').textContent).toBe('lote saiu há 32 dias · descanso da cultura 30 dias');
    expect(screen.queryByTestId('forragem-em-pastejo')).toBeNull();
  });

  it('medição válida vence a estimativa; pasto ocupado mostra "Em pastejo" sem estimativa', async () => {
    dados.culturas = [{ ...MARANDU, dias_descanso: 30 }];
    dados.cache.medicoesForragem = [{ id: 'nova', empresa_id: EMP, area_id: 'area-12', data_medicao: '2027-06-14', metodo: 'REGUA', altura_media_cm: 10, situacao: 'RAPADO' }];
    dados.cache.descansoPastos = [{ area_id: 'area-12', ocupada: true, ultima_saida: null }];
    renderizar(<DetalhesArea area={PASTO} permissions={PERM} />);
    await waitFor(() => expect(screen.getByTestId('forragem-em-pastejo').textContent).toContain('Em pastejo'));
    expect(screen.getByTestId('farol-forragem').textContent).toContain('Rapado');
    expect(screen.getByTestId('farol-forragem').textContent).not.toContain('estimado');
  });

  it('pasto com parâmetros próprios: a estimativa usa os dias do pasto e o painel diz de onde vem cada parâmetro', async () => {
    dados.culturas = [{ ...MARANDU, dias_descanso: 30 }];
    dados.cache.descansoPastos = [{ area_id: 'area-12', ocupada: false, ultima_saida: '2027-05-14' }];
    renderizar(<DetalhesArea area={{ ...PASTO, altura_saida_cm: 12, dias_descanso: 40 }} permissions={PERM} />);
    await waitFor(() => expect(screen.getByTestId('farol-forragem').textContent).toContain('Descanso (estimado)'));
    expect(screen.getByTestId('farol-forragem-estimado').textContent).toBe('lote saiu há 32 dias · descanso do pasto 40 dias');
    expect(screen.getByTestId('parametros-do-pasto').textContent).toBe('entrada 25 cm (da cultura) · saída 12 cm (do pasto) · descanso 40 dias (do pasto)');
  });

  it('cultura sem dias de descanso: nada é estimado', async () => {
    dados.cache.descansoPastos = [{ area_id: 'area-12', ocupada: false, ultima_saida: '2027-05-14' }];
    renderizar(<DetalhesArea area={PASTO} permissions={PERM} />);
    expect(await screen.findByTestId('painel-forragem')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Nenhuma medição registrada.')).toBeTruthy());
    expect(screen.queryByTestId('farol-forragem')).toBeNull();
  });
});
