// @vitest-environment jsdom
/**
 * D-PROD-220 — detalhe do COCHO no desenho do Detalhes do Lote v12 (tela
 * `telaCocho`). Os dados e as regras são os de hoje (D-PROD-178, D-PROD-205,
 * D-PROD-206, D-PROD-210, D-PROD-212 — ver detalhesCochoNiveis e leituraCocho);
 * aqui, a apresentação:
 *
 *  CV-1. casca v12: `.mk-dp` filha direta do `.mk-ll` do diálogo; título = nome
 *        do cocho; sub = `subtitulo`, ou as áreas vinculadas sem ele. Markup novo
 *        só com classes do v12.
 *  CV-2. seções na ordem do v12 (nível, leitura, último período fechado, total
 *        fornecido) + "Último registro" do MAIKE antes de "Informações do cocho".
 *  CV-3. nível: a figura é o subícone do cocho (CochoNivel: o desenho dos
 *        detalhes, sem a bolinha do mapa, nas cores de `COCHO_APARENCIA.subicone`,
 *        D-PROD-225) e continua o `role="img"` acessível; o percentual aparece UMA vez, grande, no
 *        valor; o rótulo e o valor visíveis não são lidos de novo. Neutro: o
 *        estado no lugar do número.
 *  CV-4. rodapé Lançar · Leitura · Histórico pelas permissões de hoje (sem a
 *        permissão a pílula não aparece; sem nenhuma, sem rodapé); as pílulas
 *        abrem os diálogos de hoje.
 *  CV-5. leitura: farol na primeira linha; "Últimas leituras" com data,
 *        ESCORE · ACESSO · ESTRUTURA, observação embaixo e "Excluir" (com
 *        permissão); avisos da última leitura abaixo do cartão.
 *  CV-6. último período fechado: a grade do v12 (produto, lançamento, real ×
 *        esperado com a cor e o texto do farol, custo por cab/dia em R$) e o
 *        resto do resumo de hoje; base g/cab/dia; sobra antiga e peso médio.
 *  CV-7. último registro: os MESMOS rótulos e valores do cartão do Histórico
 *        (`CardMetricaEvento`) e as observações; informações do cocho na grade.
 *  CV-8. depósito › cocho: o despachante repassa `subtitulo` e `onAbrirCocho`
 *        ao depósito (este só com a permissão do marcador,
 *        `visualizar_detalhes_cochos`); o cocho abre empilhado (‹ Voltar no
 *        cabeçalho, o Esc volta ao depósito sem fechar o diálogo).
 *  CV-9. carregando dentro da casca, sem rodapé.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LancLoteDialogo } from '@/components/lotes/LancamentoLoteUi';
import { COR_FAROL } from '@/domain/suplementacao/leituraCocho';
import { COCHO_APARENCIA, COCHO_DESCOBERTO_FORMA } from '@/assets/icones/cocho-descoberto';

const EMP = 'emp-1';
const dados = vi.hoisted(() => ({ cache: {}, produtos: [], empresas: [], pendente: false }));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: vi.fn(async (chave) => (dados.pendente ? new Promise(() => {}) : dados.cache[chave] || [])),
  refreshMapaCacheEntry: vi.fn(async (chave) => (dados.pendente ? new Promise(() => {}) : dados.cache[chave] || [])),
  updateMapaCachedData: vi.fn(),
}));
vi.mock('@/services/estoqueMapaService', () => ({ listarTodosProdutos: vi.fn(async () => dados.produtos) }));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => dados.empresas) }));
// Os formulários e o histórico completo são os de hoje; aqui só se confere que abrem.
// O título do Lançar é do LancLoteDialogo (D-PROD-222): o formulário de mentira não traz título próprio.
vi.mock('@/components/suplementacao/FormularioLancamentoSuplementacao', () => ({ default: ({ ponto }) => <p>{`Formulário de lançamento: ${ponto?.nome_ponto}`}</p> }));
vi.mock('@/components/suplementacao/FormularioLeituraCocho', () => ({ default: ({ ponto }) => <p>{`Formulário de leitura: ${ponto?.nome_ponto}`}</p> }));
vi.mock('@/components/suplementacao/HistoricoSuplementacaoPonto', () => ({ default: ({ pontoNome }) => <p>{`Histórico completo: ${pontoNome}`}</p> }));
// Depósito: a casca de verdade e um toque que abre o cocho de "Pastos atendidos".
vi.mock('@/components/mapa/DetalhesDepositoSuplementacao', async () => {
  const { default: CascaDetalhe } = await import('@/components/mapa/detalhes-lote/CascaDetalhe');
  return {
    default: ({ deposito, subtitulo, onAbrirCocho, anim }) => (
      <CascaDetalhe titulo={deposito.nome_ponto} sub={subtitulo || 'Depósito'} anim={anim}>
        <button type="button" onClick={() => onAbrirCocho?.({ ...COCHO_DO_DEPOSITO })}>Abrir COCHO 02</button>
      </CascaDetalhe>
    ),
  };
});

const COCHO_DO_DEPOSITO = { id: 'c2', empresa_id: 'emp-1', nome_ponto: 'COCHO 02', categoria_ponto: 'COCHO', status: 'Ativo', area_vinculada_ids: ['a2'] };

const cocho = (extra = {}) => ({
  id: 'c1', empresa_id: EMP, nome_ponto: 'COCHO 07', categoria_ponto: 'COCHO', status: 'Ativo',
  area_vinculada_id: 'a1', area_vinculada_ids: ['a1'], capacidade_cocho_kg: 300, numero_ponto: 'CC-07', sigla: 'C07',
  tipo: 'Cocho coberto', deposito_origem_nome: 'Depósito Retiro', produto_padrao: 'SAL MINERAL 80', metragem_cocho_m: 12,
  consumo_ideal_por_cabeca_kg: 0.075, limite_minimo_consumo: 0.06, limite_maximo_consumo: 0.11, dias_alerta_reposicao: 3,
  alerta_sem_lancamento_dias: 15, observacoes: 'Cocho perto da porteira.', ...extra,
});
const evento = (id, extra = {}) => ({
  id, empresa_id: EMP, ponto_suplementacao_id: 'c1', produto: 'SAL MINERAL 80', produto_id: 'p-sal',
  data_lancamento: '2026-11-10', quantidade_total_kg: 200, sobra_kg: 0, dias_periodo: null,
  consumo_esperado_pv_kg: 50, total_cabecas_afetadas: 100, peso_medio_lotes_kg: 400, created_date: '2026-11-10T12:00:00.000Z', ...extra,
});
const fechado = (extra = {}) => evento('e-fechado', {
  data_lancamento: '2026-10-27', dias_periodo: 13, sobra_kg: 10, consumo_diario_grupo_kg: 30, farol_consumo: 'dentro',
  consumo_relacao_esperado: 0.99, faixa_tolerancia_aplicada: 20, sobra_informada: true, consumo_g_cab_dia: 75,
  consumo_real_pv_percentual: 0.034, consumo_esperado_pv_percentual: 0.035, custo_cab_dia: 0.21, custo_total_periodo: 273,
  custo_unitario_kg: 0.7, created_date: '2026-10-27T12:00:00.000Z', ...extra,
});
const leitura = (id, data_leitura, escore, extra = {}) => ({
  id, empresa_id: EMP, ponto_suplementacao_id: 'c1', data_leitura, escore, acesso: 'BOM', estrutura: 'BOA',
  created_date: `${data_leitura}T12:00:00.000Z`, registrado_por_nome: 'JOÃO', ...extra,
});

/** Largura da tela para os `matchMedia` (desktop 1280, tablet 820, celular 390). */
const largura = (w) => {
  window.matchMedia = /** @type {any} */ ((q) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || w >= Number(min[1])) && (!max || w <= Number(max[1]));
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  });
};
const matchMediaOriginal = window.matchMedia;

beforeEach(() => {
  // 15:00 UTC de 12/11 = 12:00 em São Paulo: o dia da fazenda é 12/11 (dia 2 do ciclo de 10/11).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T15:00:00.000Z'));
  largura(1280);
  dados.pendente = false;
  dados.produtos = [{ id: 'p-sal', empresa_id: EMP, nome_produto: 'SAL MINERAL 80', peso_por_saco_kg: 25 }];
  dados.empresas = [{ id: EMP, nome: 'FAZENDA', fuso_horario: 'America/Sao_Paulo' }];
  dados.cache = {
    areas: [{ id: 'a1', empresa_id: EMP, nome: 'PASTO 07' }, { id: 'a2', empresa_id: EMP, nome: 'PASTO 02' }],
    pontosSuplementacao: [cocho()],
    eventosSuplementacao: [fechado(), evento('e-aberto')],
    leiturasCocho: [],
  };
});

afterEach(() => {
  cleanup();
  window.matchMedia = matchMediaOriginal;
  vi.useRealTimers();
});

/** Monta como o Mapa Geral: no `LancLoteDialogo` largo, só leitura, popup a partir do tablet. */
const noDialogo = async (ponto, { permissions = {}, subtitulo, subtituloDoPonto } = {}) => {
  const { default: DetalhesPontoSuplementacao } = await import('@/components/mapa/DetalhesPontoSuplementacao');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let fechou = 0;
  const r = render(
    <QueryClientProvider client={qc}>
      <LancLoteDialogo open onOpenChange={(aberto) => { if (!aberto) fechou += 1; }} titulo="Ponto de Suplementação" largo somenteLeitura popupDesde="tablet">
        <DetalhesPontoSuplementacao ponto={ponto} permissions={permissions} subtitulo={subtitulo} subtituloDoPonto={subtituloDoPonto} onClose={() => {}} />
      </LancLoteDialogo>
    </QueryClientProvider>,
  );
  return { ...r, fechou: () => fechou };
};
const carregado = async () => {
  await screen.findByRole('region', { name: 'Nível do cocho' });
  await act(async () => {});
};
const tituloDoDialogo = () => document.querySelector('.mk-ll-dlg__titulo')?.textContent;
const subDoDialogo = () => document.querySelector('.mk-ll-dlg__lotes')?.textContent ?? null;
const raiz = () => /** @type {HTMLElement} */ (document.querySelector('.mk-ll > .mk-dp'));
const valorDe = (el, rotulo) => within(el).getByText(rotulo).nextElementSibling?.textContent;
const pilulas = () => [...raiz().querySelectorAll('.mk-dp__rodape .mk-dp-pilula')].map((b) => b.textContent);
const secaoNivel = () => screen.getByRole('region', { name: 'Nível do cocho' });
const secaoLeitura = () => screen.getByRole('region', { name: 'Leitura do cocho' });

describe('CV-1 — casca v12', () => {
  it('raiz .mk-dp filha direta do .mk-ll; título = cocho; sub = subtitulo, ou as áreas vinculadas', async () => {
    await noDialogo(cocho(), { subtitulo: 'Pasto 07 · Retiro' });
    await carregado();
    expect(raiz()).toBeTruthy();
    expect(raiz().getAttribute('data-modo')).toBe('desktop');
    expect(raiz().querySelector(':scope > .mk-dp__corpo--cards')).toBeTruthy();
    expect(tituloDoDialogo()).toBe('COCHO 07');
    expect(subDoDialogo()).toBe('Pasto 07 · Retiro');
    // Fora da raiz v12 não sobra nada do desenho antigo.
    expect(document.querySelector('.mk-map-details')).toBeNull();
    cleanup();

    await noDialogo(cocho());
    await carregado();
    expect(tituloDoDialogo()).toBe('COCHO 07');
    expect(subDoDialogo()).toBe('PASTO 07');
  });

  it('markup novo só com classes do v12 (o CochoNivel e o ícone do desvio são componentes de hoje)', async () => {
    dados.cache.eventosSuplementacao = [evento('e-fechado-ultimo', { dias_periodo: 5, consumo_diario_grupo_kg: 30, sobra_kg: 10 })];
    await noDialogo(cocho());
    await carregado();
    const corpo = /** @type {HTMLElement} */ (raiz().querySelector('.mk-dp__corpo'));
    expect(corpo.querySelectorAll('[class]').length).toBeGreaterThan(25);
    expect(corpo.querySelector('[data-testid="ultimo-periodo-fechado"]')).toBeNull(); // o ícone do desvio (período fechado) está lá
    const foraDoV12 = [...corpo.querySelectorAll('[class]')]
      .filter((el) => !el.closest('[role="img"]') && !(el.tagName.toLowerCase() === 'svg' && el.closest('.mk-dp-cel__val')) && !el.closest('svg.lucide'))
      .flatMap((el) => String(el.getAttribute('class')).split(/\s+/).filter(Boolean))
      .filter((c) => !c.startsWith('mk-dp') && !c.startsWith('lucide'));
    expect(foraDoV12).toEqual([]);
  });
});

describe('CV-2 — abas e seções na ordem do v12', () => {
  it('abas Detalhes · Fechamentos · Informações · Histórico; na aba Detalhes, nível e leitura', async () => {
    await noDialogo(cocho());
    await carregado();
    const abas = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(abas).toEqual(['Detalhes', 'Fechamentos', 'Informações', 'Histórico']);
    const titulos = [...raiz().querySelectorAll('h3')].map((h) => h.textContent);
    expect(titulos).toEqual(['Nível do cocho', 'Estimativas de consumo', 'Leitura do cocho']);
    // O título do nível existe só para o leitor de tela (o v12 não mostra título acima do nível).
    expect(secaoNivel().querySelector('h3')?.className).toBe('mk-dp-cocho__oculto');
  });
});

describe('CV-3 — bloco do nível', () => {
  it('subícone do cocho (sem a bolinha do mapa) como figura acessível; percentual dentro do ícone; neutro com o estado', async () => {
    await noDialogo(cocho());
    await carregado();
    // Dia 2 de 200 kg a 50 kg/dia: 100 kg (50%).
    const img = await within(secaoNivel()).findByRole('img', { name: 'Restante do ciclo (estimado): 50%' });
    // O subícone dos detalhes (D-PROD-225): um só desenho, o do cocho, sem a moldura redonda do marcador,
    // nas cores e na espessura configuradas para o subícone.
    const desenhos = img.querySelectorAll('svg');
    expect(desenhos).toHaveLength(1);
    expect(desenhos[0].getAttribute('viewBox')).toBe(COCHO_DESCOBERTO_FORMA.viewBox);
    expect(img.querySelector('image')).toBeNull();
    const contorno = /** @type {Element} */ ([...desenhos[0].querySelectorAll('path[fill="none"]')].at(-1));
    expect(contorno.getAttribute('stroke')).toBe(COCHO_APARENCIA.subicone.cor);
    expect(contorno.getAttribute('stroke-width')).toBe(String(COCHO_APARENCIA.subicone.espessura));
    expect(img.querySelector('[data-cocho-nivel]')?.getAttribute('data-cocho-nivel')).toBe('50');
    expect(img.querySelector('[data-cocho-nivel]')?.getAttribute('fill')).toBe(COCHO_APARENCIA.subicone.sal);
    expect(img.closest('.mk-dp-nivel__fig')).toBeTruthy();
    const valor = /** @type {HTMLElement} */ (secaoNivel().querySelector('.mk-dp-cocho__pct'));
    expect(valor.textContent).toBe('50%');
    // O percentual visível fica fora da árvore acessível (o `role="img"` já anuncia o valor).
    expect(valor.getAttribute('aria-hidden')).toBe('true');
    expect(within(secaoNivel()).queryByText(/Base do ciclo:/)).toBeNull();
    expect(within(secaoNivel()).queryByText(/%PV no lançamento/)).toBeNull();
    // Cartão de nível: saldo estimado do cocho (com sacos) e consumo estimado/dia (com sacos/dia);
    // cartão de estimativas de consumo: duração estimada e próxima reposição.
    expect(valorDe(secaoNivel(), 'Saldo estimado do cocho')).toBe('100 kg');
    expect(within(secaoNivel()).getByText('4,00 sacos')).toBeTruthy();
    expect(valorDe(secaoNivel(), 'Consumo estimado/dia')).toBe('50 kg/dia');
    expect(within(secaoNivel()).getByText('2,00 sacos/dia')).toBeTruthy();
    expect(valorDe(secaoNivel(), 'Duração estimada')).toBe('4 dia(s)');
    expect(valorDe(secaoNivel(), 'Próxima reposição')).toBe('14/11/2026');
    const [tituloOculto, nivelEl, cartaoEl, ...outros] = [...secaoNivel().children];
    expect(secaoNivel().classList.contains('mk-dp-cocho__regiao')).toBe(true);
    expect(outros).toHaveLength(0);
    expect(tituloOculto.classList.contains('mk-dp-cocho__oculto')).toBe(true);
    expect(nivelEl.classList.contains('mk-dp-cocho__nivel')).toBe(true);
    expect(cartaoEl.classList.contains('mk-dp-cocho__cartao-nivel')).toBe(true);
    const celulas = [...cartaoEl.querySelectorAll('.mk-dp-grade > .mk-dp-cel > dt')].map((dt) => dt.textContent);
    expect(celulas).toEqual(['Duração estimada', 'Próxima reposição']);
    cleanup();

    dados.cache.eventosSuplementacao = [];
    await noDialogo(cocho());
    await carregado();
    expect(within(secaoNivel()).getByRole('img').getAttribute('aria-label')).toBe('Restante do ciclo (estimado): Sem lançamento');
    expect(secaoNivel().querySelector('.mk-dp-nivel')?.classList.contains('mk-dp-cocho__nivel--neutro')).toBe(true);
    expect(secaoNivel().querySelector('.mk-dp-cocho__pct')?.textContent).toBe('Sem lançamento');
    expect(within(secaoNivel()).getByText('Nenhum lançamento registrado neste cocho.')).toBeTruthy();
  });
});

describe('CV-4 — rodapé de pílulas', () => {
  it('Lançar · Leitura pelas permissões de hoje; sem nenhuma, sem rodapé', async () => {
    await noDialogo(cocho());
    await carregado();
    expect(pilulas()).toEqual(['Lançar', 'Leitura']);
    expect(raiz().querySelectorAll('.mk-dp__rodape .mk-dp-pilula svg')).toHaveLength(2);
    cleanup();

    await noDialogo(cocho(), { permissions: { lancar_suplementacao: false } });
    await carregado();
    expect(pilulas()).toEqual([]);
    cleanup();

    await noDialogo(cocho(), { permissions: { visualizar_historico_cocho: false } });
    await carregado();
    expect(pilulas()).toEqual(['Lançar', 'Leitura']);
    cleanup();

    await noDialogo(cocho(), { permissions: { lancar_suplementacao: false, visualizar_historico_cocho: false } });
    await carregado();
    expect(pilulas()).toEqual([]);
    expect(raiz().querySelector('.mk-dp__rodape')?.childElementCount).toBe(0);
  });

  it('as pílulas abrem o lançamento e a leitura de hoje; aba Histórico mostra o histórico completo', async () => {
    await noDialogo(cocho());
    await carregado();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Lançar' })); });
    expect(await screen.findByText('Formulário de lançamento: COCHO 07')).toBeTruthy();
    // D-PROD-222: como o lançamento de manejo — LancLoteDialogo largo, título = a ação, subtítulo = o cocho.
    const lancar = screen.getByRole('dialog', { name: 'Lançar Suplementação', description: 'COCHO 07' });
    expect(lancar.className).toContain('mk-ll-dlg--largo');
    expect(within(lancar).getByText('Formulário de lançamento: COCHO 07')).toBeTruthy();
    cleanup();

    await noDialogo(cocho());
    await carregado();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Leitura' })); });
    expect(await screen.findByText('Formulário de leitura: COCHO 07')).toBeTruthy();
    // D-PROD-222: como os demais lançamentos — o cocho no subtítulo do diálogo.
    expect(screen.getByRole('dialog', { name: 'Leitura de Cocho', description: 'COCHO 07' })).toBeTruthy();
    cleanup();

    await noDialogo(cocho());
    await carregado();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Histórico' })); });
    expect(screen.getByRole('button', { name: 'Mostrar: Todos os registros' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Lançamentos do cocho' })).toBeTruthy();
  });
});

describe('CV-5 — leitura do cocho', () => {
  it('farol na primeira linha; últimas leituras com escore · acesso · estrutura, observação e Excluir; avisos abaixo', async () => {
    dados.cache.leiturasCocho = [
      leitura('l-1', '2026-11-09', 'CHEIO'),
      leitura('l-2', '2026-11-12', 'ADEQUADO', { acesso: 'RUIM', estrutura: 'REPARO', observacoes: 'Lama na entrada.' }),
    ];
    await noDialogo(cocho());
    await carregado();
    const secao = secaoLeitura();
    const farol = within(secao).getByTestId('farol-cocho');
    expect(farol.getAttribute('data-cor')).toBe('verde');
    const linhaFarol = /** @type {HTMLElement} */ (farol.closest('.mk-dp-linha'));
    expect(linhaFarol.querySelector('.mk-dp-linha__sub')?.textContent).toBe('Escore adequado · acesso ruim · estrutura precisa de reparo');
    expect(linhaFarol.querySelector('.mk-dp-linha__val')?.textContent).toBe('12/11/2026 · JOÃO');
    expect(/** @type {HTMLElement} */ (linhaFarol.querySelector('.mk-dp-bolinha')).style.background).toBeTruthy();

    expect(within(secao).queryByRole('list')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Histórico' })); });
    const itens = within(screen.getByRole('list', { name: 'Últimas leituras' })).getAllByRole('listitem');
    expect(itens).toHaveLength(2);
    expect(within(itens[0]).getByText('12/11/2026')).toBeTruthy();
    expect(within(itens[0]).getByText('ADEQUADO · RUIM · REPARO')).toBeTruthy();
    expect(within(itens[0]).getByText('Lama na entrada.').className).toBe('mk-dp-cocho__obs-leitura');
    expect(within(itens[0]).getByRole('button', { name: 'Excluir a leitura de 12/11/2026' }).className).toContain('mk-dp-acao--perigo');
    expect(within(itens[1]).getByText('CHEIO · BOM · BOA')).toBeTruthy();
    // A bolinha de cada leitura é a cor do escore (CHEIO = azul).
    expect(/** @type {HTMLElement} */ (itens[1].querySelector('.mk-dp-bolinha')).style.background).toBe('rgb(37, 99, 235)');
    expect(COR_FAROL.azul).toBe('#2563eb');
    // Sem faixas de aviso repetidas abaixo do cartão (a informação já aparece na linha do farol).
    expect(within(secao).queryAllByTestId('aviso-leitura-cocho')).toHaveLength(0);
  });

  it('sem leitura: "Sem leitura recente" cinza e "Nenhuma leitura registrada."; sem permissão, sem Excluir', async () => {
    await noDialogo(cocho());
    await carregado();
    expect(within(secaoLeitura()).getByTestId('farol-cocho').getAttribute('data-cor')).toBe('cinza');
    expect(within(secaoLeitura()).getByText('Nenhuma leitura registrada.').className).toBe('mk-dp-linha__sub');
    expect(within(secaoLeitura()).queryByRole('list')).toBeNull();
    cleanup();

    dados.cache.leiturasCocho = [leitura('l-2', '2026-11-12', 'VAZIO')];
    await noDialogo(cocho(), { permissions: { lancar_suplementacao: false } });
    await carregado();
    await waitFor(() => expect(within(secaoLeitura()).getByTestId('farol-cocho').getAttribute('data-cor')).toBe('vermelho'));
    expect(within(secaoLeitura()).queryByRole('button', { name: /Excluir/ })).toBeNull();
  });
});

describe('CV-6 — último período fechado', () => {
  it('grade do v12 com o farol (cor e texto) e o resto do resumo de hoje', async () => {
    dados.cache.eventosSuplementacao = [
      fechado({ sobra_informada: false, peso_medio_periodo_kg: 217, peso_medio_periodo_aproximado: true, peso_medio_periodo_motivo: 'sem_lotes', sobra_herdada_kg: 20, custo_sobra_herdada_kg: 0.6, custo_sobra_aproximado: true }),
      evento('e-aberto'),
    ];
    await noDialogo(cocho());
    await carregado();
    expect(screen.queryByTestId('ultimo-periodo-fechado')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Fechamentos' })); });
    const cartao = screen.getByTestId('ultimo-periodo-fechado');
    expect(cartao.className).toContain('mk-dp-cartao');
    const rotulos = [...cartao.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(rotulos).toEqual([
      'Produto',
      'Lançamento',
      'Consumo real',
      'Consumo esperado',
      'Desvio',
      'Peso médio do período',
      'Custo por cab/dia (R$)',
      'Custo do período',
      'Sobra antiga primeiro',
    ]);
    expect(valorDe(cartao, 'Produto')).toBe('SAL MINERAL 80');
    expect(valorDe(cartao, 'Lançamento')).toBe('27/10/2026 · 13 dia(s)');
    expect(valorDe(cartao, 'Consumo real')).toBe('75 g');
    expect(valorDe(cartao, 'Consumo esperado')).toBe('500 g');
    const farol = within(cartao).getByTestId('farol-consumo');
    expect(farol.textContent).toBe('Dentro (-1%)');
    expect(farol.getAttribute('data-farol')).toBe('dentro');
    const bolinha = /** @type {HTMLElement} */ (within(cartao).getByText('Desvio').parentElement?.querySelector('.mk-dp-bolinha'));
    expect(bolinha.style.background).toBe('rgb(22, 163, 74)');
    expect(valorDe(cartao, 'Custo por cab/dia (R$)')).toBe('0,21');
    expect(within(cartao).getByTestId('peso-medio-periodo').textContent).toBe('Peso médio do período217 kgaproximado: sem os lotes do período');
    expect(valorDe(cartao, 'Custo do período')).toMatch(/^R\$\s273,00 · R\$\s0,70\/kg$/);
    expect(within(cartao).getByTestId('custo-sobra-herdada').textContent).toMatch(/^Sobra antiga primeiro20,00 kg a R\$\s0,60\/kgcusto da sobra aproximado$/);
    expect(within(cartao).getByTestId('fechamento-aproximado').textContent).toBe('Aproximado — sobra não informada');
  });

  it('base g/cab/dia (D-PROD-210): consumo real e esperado em g/kg; sem período: "Nenhum período fechado ainda."', async () => {
    dados.cache.eventosSuplementacao = [
      fechado({ base_consumo: 'G_CAB_DIA', base_consumo_aplicada: 'G_CAB_DIA', consumo_esperado_g_cab_dia: 80, consumo_esperado_pv_percentual: null, farol_consumo: 'abaixo', consumo_relacao_esperado: 0.94, faixa_tolerancia_aplicada: 15, custo_cab_dia: null, custo_total_periodo: null }),
      evento('e-aberto'),
    ];
    await noDialogo(cocho());
    await carregado();
    expect(screen.queryByTestId('ultimo-periodo-fechado')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Fechamentos' })); });
    const cartao = screen.getByTestId('ultimo-periodo-fechado');
    expect(valorDe(cartao, 'Consumo real')).toBe('75 g');
    expect(valorDe(cartao, 'Consumo esperado')).toBe('80 g');
    expect(within(cartao).getByTestId('farol-consumo').textContent).toBe('Abaixo (-6%)');
    expect(valorDe(cartao, 'Custo por cab/dia (R$)')).toBe('Sem custo');
    expect(valorDe(cartao, 'Custo do período')).toBe('Sem custo');
    expect(within(cartao).queryByText(/%PV/)).toBeNull();
    cleanup();

    dados.cache.eventosSuplementacao = [evento('e-aberto')];
    await noDialogo(cocho());
    await carregado();
    expect(screen.queryByTestId('ultimo-periodo-fechado')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Fechamentos' })); });
    expect(screen.queryByTestId('ultimo-periodo-fechado')).toBeNull();
    expect(screen.getByText('Nenhum período fechado ainda.').closest('.mk-dp-vazio')).toBeTruthy();
  });
});

describe('CV-7 — cadastro na aba Informações e total fornecido na aba Histórico', () => {
  it('cadastro na aba Informações; total fornecido na aba Histórico', async () => {
    await noDialogo(cocho());
    await carregado();
    expect(screen.queryByRole('heading', { name: 'Último registro' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Total fornecido por produto' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Informações' })); });
    const info = screen.getByRole('region', { name: 'Informações do cocho' });
    expect(valorDe(info, 'Áreas vinculadas')).toBe('PASTO 07');
    expect(valorDe(info, 'Metragem')).toBe('12,00 m');
    expect(within(info).getByText('Cocho perto da porteira.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Histórico' })); });
    expect(screen.getByRole('button', { name: 'Mostrar: Todos os registros' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Lançamentos do cocho' })).toBeTruthy();
    const total = screen.getByRole('region', { name: 'Total fornecido por produto' });
    expect(total.textContent).toContain('16,00 sacos · 400 kg');
  });
});

describe('CV-8 — depósito › cocho (tela empilhada)', () => {
  it('repassa subtitulo e onAbrirCocho ao depósito; o cocho abre com ‹ Voltar e o Esc volta ao depósito', async () => {
    const deposito = { id: 'd1', empresa_id: EMP, nome_ponto: 'DEPÓSITO SEDE', categoria_ponto: 'DEPOSITO', status: 'Ativo' };
    const { fechou } = await noDialogo(deposito, { subtitulo: 'Sede · Sede' });
    expect(tituloDoDialogo()).toBe('DEPÓSITO SEDE');
    expect(subDoDialogo()).toBe('Sede · Sede');
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abrir COCHO 02' })); });
    await screen.findByRole('region', { name: 'Nível do cocho' });
    await act(async () => {});
    // O cocho empilhado: o nome dele, as áreas dele (não o local do depósito) e o ‹ Voltar no cabeçalho.
    expect(tituloDoDialogo()).toBe('COCHO 02');
    expect(subDoDialogo()).toBe('PASTO 02');
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeTruthy();
    expect(raiz().querySelector('.mk-dp__corpo')?.className).toContain('mk-dp-anim--empurrar');

    // Esc: volta ao depósito, sem fechar o diálogo.
    await act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', code: 'Escape' }); });
    await waitFor(() => expect(tituloDoDialogo()).toBe('DEPÓSITO SEDE'));
    expect(fechou()).toBe(0);
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();

    // A volta anima como o ‹ Voltar do Detalhes do Lote.
    expect(raiz().querySelector('.mk-dp__corpo')?.className).toContain('mk-dp-anim--voltar');

    // ‹ Voltar também volta.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abrir COCHO 02' })); });
    await screen.findByRole('region', { name: 'Nível do cocho' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voltar' })); });
    await waitFor(() => expect(tituloDoDialogo()).toBe('DEPÓSITO SEDE'));
    expect(raiz().querySelector('.mk-dp__corpo')?.className).toContain('mk-dp-anim--voltar');
  });

  it('com subtituloDoPonto (o Mapa Geral), o cocho empilhado ganha "áreas · setor" como se fosse aberto pelo mapa', async () => {
    const deposito = { id: 'd1', empresa_id: EMP, nome_ponto: 'DEPÓSITO SEDE', categoria_ponto: 'DEPOSITO', status: 'Ativo' };
    const vistos = [];
    await noDialogo(deposito, {
      subtitulo: 'Sede',
      subtituloDoPonto: (p) => {
        vistos.push(p?.id);
        return p?.id === 'c2' ? 'PASTO 02 · Sede' : '';
      },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abrir COCHO 02' })); });
    await screen.findByRole('region', { name: 'Nível do cocho' });
    await act(async () => {});
    expect(tituloDoDialogo()).toBe('COCHO 02');
    expect(subDoDialogo()).toBe('PASTO 02 · Sede');
    expect(vistos).toContain('c2');
  });

  it('sem "Abrir detalhes de cocho / depósito" (a permissão do marcador), o depósito não abre o cocho', async () => {
    const deposito = { id: 'd1', empresa_id: EMP, nome_ponto: 'DEPÓSITO SEDE', categoria_ponto: 'DEPOSITO', status: 'Ativo' };
    await noDialogo(deposito, { permissions: { visualizar_detalhes_cochos: false } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abrir COCHO 02' })); });
    expect(tituloDoDialogo()).toBe('DEPÓSITO SEDE');
    expect(screen.queryByText('Informações do cocho')).toBeNull();
  });
});

describe('CV-9 — carregando', () => {
  it('dentro da casca, com o aviso de carregamento e sem rodapé', async () => {
    dados.pendente = true;
    await noDialogo(cocho());
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('Carregando detalhes do cocho...');
    expect(status.closest('.mk-ll > .mk-dp')).toBeTruthy();
    expect(raiz().querySelector('.mk-dp__rodape')?.childElementCount).toBe(0);
    expect(tituloDoDialogo()).toBe('COCHO 07');
  });
});

it('Fechamentos lista todos os períodos fechados do ponto, mais novo primeiro; não mostra o ciclo aberto', async () => {
  dados.cache.eventosSuplementacao = [
    fechado({ id: 'f1', data_lancamento: '2026-10-01' }),
    fechado({ id: 'f2', data_lancamento: '2026-10-27' }),
    evento('aberto'),
    fechado({ id: 'outro', ponto_suplementacao_id: 'outro-cocho' }),
  ];
  await noDialogo(cocho());
  await carregado();
  expect(screen.queryByTestId('ultimo-periodo-fechado')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Fechamentos' })); });
  const lista = screen.getByRole('list', { name: 'Fechamentos do cocho' });
  const itens = within(lista).getAllByRole('listitem');
  expect(itens).toHaveLength(2);
  expect(itens[0].textContent).toContain('27/10/2026');
  expect(itens[1].textContent).toContain('01/10/2026');
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Detalhes' })); });
  await waitFor(() => expect(screen.queryByRole('list', { name: 'Fechamentos do cocho' })).toBeNull());
  expect(screen.getByRole('tab', { name: 'Fechamentos' })).toBeTruthy();
});
