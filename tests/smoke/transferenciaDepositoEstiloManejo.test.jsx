// @vitest-environment jsdom
/**
 * D-PROD-221 — "Entrada" e "Saída" do detalhe do depósito no MESMO desenho do
 * lançamento de manejo do lote (`src/components/lotes/LancamentoLoteUi.jsx`),
 * com as regras de hoje (só a apresentação mudou):
 *
 *  TM-1. abre num `LancLoteDialogo` largo: título = a ação ("Entrada no
 *        Depósito" / "Saída do Depósito"), subtítulo = o depósito; no desktop,
 *        popup com ✕ e ✓ no cabeçalho; sem cartão interno, título repetido nem
 *        botões "Cancelar"/"Salvar" no pé.
 *  TM-2. no celular, tela cheia: ✕ à esquerda, título e depósito no meio, ✓ à
 *        direita.
 *  TM-3. o corpo é o `LancLoteForm` (filho direto do diálogo, com o id do ✓);
 *        cada campo num `LancField` (rótulo DENTRO da caixa e ligado ao
 *        controle, * só nos obrigatórios), controles com `LL_CTL`, Produto e
 *        Unidade no campo de escolha do manejo (`B1Select`); data e local lado
 *        a lado, o produto na linha toda, unidade e quantidade lado a lado
 *        (`LancLoteGrade`).
 *  TM-4. Origem · Destino · Saldo num `LancLoteAviso` neutro, com os números
 *        e os textos de antes (kg com 3 casas, sacas com 2).
 *  TM-5. o ✓ do cabeçalho envia o formulário: as mesmas validações e
 *        mensagens, sem chamar o servidor quando recusa.
 *  TM-6. o ✓ grava como antes (sacas → kg pelo peso do saco; origem e destino
 *        pela direção; observação padrão), atualiza o cache do mapa com
 *        `force`, invalida as consultas, avisa, fecha o diálogo e o detalhe
 *        do depósito relê o saldo (`atualizar-mapa`).
 *  TM-7. o ✕ do cabeçalho cancela sem gravar.
 *  TM-8. no celular as listas são folhas DENTRO do diálogo e o Esc com uma
 *        folha aberta fecha só a folha (D-PROD-161, também a do Produto).
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const EMP = 'emp-tm';
const LOCAL_SEDE = { id: 'loc-sede', nome: 'GALPÃO SEDE', numero_local: '1', ativo: true };
const LOCAL_CENTRAL = { id: 'loc-central', nome: 'GALPÃO CENTRAL', numero_local: '2', ativo: true };
const LOCAL_RETIRO = { id: 'loc-retiro', nome: 'DEPÓSITO RETIRO', numero_local: '3', ativo: true };
const SAL = { id: 'p-sal', empresa_id: EMP, nome_produto: 'SAL MINERAL 80', tipo_uso: 'Nutrição Animal', unidade_medida: 'KG', unidade_principal_estoque: 'KG' };
/** Produto em sacos de 30 kg: a unidade "Sacas" e o saldo em sacas aparecem. */
const PROT = { id: 'p-prot', empresa_id: EMP, nome_produto: 'PROTEINADO 40', tipo_uso: 'Nutrição Animal', unidade_medida: 'KG', unidade_principal_estoque: 'SACO', peso_por_saco_kg: 30 };
const DEPOSITO = { id: 'dep-1', empresa_id: EMP, nome_ponto: 'DEPÓSITO DA SEDE', categoria_ponto: 'DEPOSITO', local_estoque_id: LOCAL_SEDE.id, local_estoque_nome: LOCAL_SEDE.nome };
const LOTES = [
  { id: 'l-sal', empresa_id: EMP, produto_id: SAL.id, produto_nome: SAL.nome_produto, local_estoque_id: LOCAL_SEDE.id, local_estoque_nome: LOCAL_SEDE.nome, quantidade_disponivel: 1400, status: 'Disponivel' },
  { id: 'l-prot', empresa_id: EMP, produto_id: PROT.id, produto_nome: PROT.nome_produto, local_estoque_id: LOCAL_CENTRAL.id, local_estoque_nome: LOCAL_CENTRAL.nome, quantidade_disponivel: 900, status: 'Disponivel' },
];
/** 12:00 UTC de 16/11 = 09:00 em São Paulo: o dia da fazenda é 16/11. */
const AGORA = new Date('2026-11-16T12:00:00.000Z');
const HOJE = '2026-11-16';

const h = vi.hoisted(() => ({
  registrar: vi.fn(),
  refresh: vi.fn(),
  toast: /** @type {any} */ (null),
}));

vi.mock('sonner', () => {
  const toast = Object.assign(() => {}, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() });
  h.toast = toast;
  return { toast, Toaster: () => null };
});
vi.mock('@/services/estoqueMapaService', () => ({
  listarTodosLotesNota: vi.fn(async () => LOTES),
  listarTodosProdutos: vi.fn(async () => [SAL, PROT]),
  listarTodasMovimentacoes: vi.fn(async () => []),
  listarTodosLocais: vi.fn(async () => [LOCAL_SEDE, LOCAL_CENTRAL, LOCAL_RETIRO]),
}));
vi.mock('@/services/mapaService', () => ({
  listarPontosSuplementacaoAtivos: vi.fn(async () => []),
  listarAreasAtivas: vi.fn(async () => []),
  listarIconesPorTipoEntidade: vi.fn(async () => []),
}));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: vi.fn(async () => []),
  refreshMapaCacheEntry: (...a) => h.refresh(...a),
}));
vi.mock('@/services/sessionService', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/services/suplementacaoEstoqueService', () => ({ registrarTransferenciaEntreLocais: (...a) => h.registrar(...a) }));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => [{ id: EMP, nome: 'FAZENDA TM', fuso_horario: 'America/Sao_Paulo' }]) }));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => EMP }));

const { LancLoteDialogo, LL_CTL } = await import('@/components/lotes/LancamentoLoteUi');
const { default: DetalhesDepositoSuplementacao } = await import('@/components/mapa/DetalhesDepositoSuplementacao');

const original = window.matchMedia;
/** Largura da tela (as media queries do diálogo, das listas e do celular). */
const largura = (px) => {
  window.matchMedia = /** @type {any} */ ((q) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || px >= Number(min[1])) && (!max || px <= Number(max[1]));
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  });
};
const TITULO = { Entrada: 'Entrada no Depósito', 'Saída': 'Saída do Depósito' };
const ACAO = { Entrada: 'Registrar Entrada', 'Saída': 'Registrar Saída' };

beforeAll(() => {
  // Select do Radix no jsdom.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  h.registrar.mockReset();
  h.registrar.mockImplementation(async () => ({ committed: true }));
  h.refresh.mockReset();
  h.refresh.mockImplementation(async () => []);
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = original;
});

/**
 * Mesma composição do Mapa Geral: o "Depósito de Suplementação" (LancLoteDialogo,
 * popup a partir do tablet) com o detalhe; a pílula abre a transferência por cima.
 * @param {'Entrada' | 'Saída'} rotulo
 * @param {number} px largura da tela
 */
const montar = async (rotulo, px) => {
  largura(px);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Depósito de Suplementação" largo somenteLeitura popupDesde="tablet">
        <DetalhesDepositoSuplementacao deposito={DEPOSITO} permissions={{}} subtitulo="Sede" onClose={() => {}} />
      </LancLoteDialogo>
    </QueryClientProvider>,
  );
  const pilula = await screen.findByRole('button', { name: rotulo });
  await act(async () => {
    fireEvent.click(pilula);
  });
  const dialogo = await screen.findByRole('dialog', { name: TITULO[rotulo] });
  const form = /** @type {HTMLFormElement} */ (within(dialogo).getByTestId('form-transferencia-deposito'));
  // Os locais e os produtos chegaram (a lista de locais e o resumo dependem deles).
  await waitFor(() => expect(within(form).getByTestId('transferencia-resumo').textContent).toContain(`${rotulo === 'Entrada' ? 'Destino' : 'Origem'}: ${LOCAL_SEDE.nome}`));
  return { dialogo, form, invalidar };
};

const clicar = async (el) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
/** Toque num campo como no navegador: o pressionar foca o controle antes do clique (o jsdom não foca no `click`). */
const tocarCampo = async (el) => {
  await act(async () => {
    el.focus();
  });
  await clicar(el);
};
/** O ✓ do cabeçalho (popup: PillBtn; tela cheia: o botão redondo verde). */
const confirmar = (dialogo, rotulo) => within(/** @type {HTMLElement} */ (dialogo.querySelector('.mk-ll-dlg__head'))).getByRole('button', { name: ACAO[rotulo] });
const campo = (dialogo, rotulo) => within(dialogo).getByLabelText(rotulo);
/** Escolhe o local (painel no desktop, folha no celular): o campo abre a lista e a opção escolhe. */
const escolherLocal = async (dialogo, rotuloCampo, nome) => {
  await tocarCampo(campo(dialogo, rotuloCampo));
  await clicar(await screen.findByRole('option', { name: nome }));
};
/**
 * Campo de escolha do manejo (B1Select) pelo rótulo do LancField: painel no desktop, folha no celular.
 * `conferir` recebe a opção antes do toque (ex.: onde a lista nasceu).
 */
const escolherNoSelect = async (dialogo, rotuloCampo, opcao, conferir = (/** @type {HTMLElement} */ _o) => {}) => {
  await tocarCampo(within(dialogo).getByRole('combobox', { name: rotuloCampo }));
  const alvo = await screen.findByRole('option', { name: opcao });
  conferir(alvo);
  await clicar(alvo);
};

describe('TM-1/TM-2 — abertura no desenho do manejo', () => {
  it.each([['Entrada'], ['Saída']])('desktop (%s): popup largo, título = a ação, subtítulo = o depósito, ✕ e ✓ no cabeçalho; sem cartão nem botões no pé', async (rotulo) => {
    const { dialogo, form } = await montar(rotulo, 1280);
    expect(dialogo.classList.contains('mk-ll-dlg')).toBe(true);
    expect(dialogo.classList.contains('is-desktop')).toBe(true);
    expect(dialogo.classList.contains('mk-ll-dlg--largo')).toBe(true);
    expect(dialogo.querySelector('.mk-ll-dlg__titulo')?.textContent).toBe(TITULO[rotulo]);
    expect(dialogo.querySelector('.mk-ll-dlg__lotes')?.textContent).toBe(DEPOSITO.nome_ponto);
    // ✕ e ✓ no cabeçalho (como "Registrar Pesagem"); o ✓ envia o formulário deste diálogo.
    const acoes = /** @type {HTMLElement} */ (dialogo.querySelector('.mk-ll-dlg__head .mk-ll-dlg__acoes'));
    const botoes = within(acoes).getAllByRole('button');
    expect(botoes.map((b) => b.getAttribute('aria-label'))).toEqual(['Cancelar', ACAO[rotulo]]);
    expect(botoes[1].getAttribute('type')).toBe('submit');
    expect(form.id).toMatch(/^mk-ll-/);
    expect(botoes[1].getAttribute('form')).toBe(form.id);
    expect(botoes[1].hasAttribute('disabled')).toBe(false);
    // Sem cartão interno, título repetido, rodapé nem os botões antigos.
    expect(within(dialogo).getAllByText(TITULO[rotulo])).toHaveLength(1);
    expect(dialogo.querySelector('.bg-card')).toBeNull();
    expect(dialogo.querySelector('.mk-ll__rodape')).toBeNull();
    expect(within(form).queryAllByRole('button', { name: /^(Salvar|Salvando\.\.\.|Cancelar)$/ })).toHaveLength(0);
  });

  it.each([['Entrada'], ['Saída']])('celular (%s): tela cheia com ✕ à esquerda, título e depósito no meio, ✓ à direita', async (rotulo) => {
    const { dialogo, form } = await montar(rotulo, 390);
    expect(dialogo.classList.contains('is-tela')).toBe(true);
    expect(dialogo.classList.contains('is-desktop')).toBe(false);
    const cabeca = /** @type {HTMLElement} */ (dialogo.querySelector('.mk-ll-dlg__head'));
    const filhos = Array.from(cabeca.children);
    expect(filhos).toHaveLength(3);
    expect(filhos[0].getAttribute('aria-label')).toBe('Cancelar');
    expect(filhos[1].classList.contains('mk-ll-dlg__txt')).toBe(true);
    expect(filhos[1].querySelector('.mk-ll-dlg__titulo')?.textContent).toBe(TITULO[rotulo]);
    expect(filhos[1].querySelector('.mk-ll-dlg__lotes')?.textContent).toBe(DEPOSITO.nome_ponto);
    expect(filhos[2].getAttribute('aria-label')).toBe(ACAO[rotulo]);
    expect(filhos[2].classList.contains('mk-ll-dlg__redondo--salvar')).toBe(true);
    expect(filhos[2].getAttribute('form')).toBe(form.id);
    expect(dialogo.querySelector('.mk-ll__rodape')).toBeNull();
  });
});

describe('TM-3 — corpo: LancLoteForm com os campos em LancField', () => {
  it('Entrada: rótulos dentro da caixa (ligados ao controle), * nos obrigatórios, LL_CTL e a grade do manejo', async () => {
    const { dialogo, form } = await montar('Entrada', 1280);
    expect(form.parentElement).toBe(dialogo);
    expect(form.classList.contains('mk-ll')).toBe(true);
    const caixas = Array.from(form.querySelectorAll('.mk-lanc > .mg-field'));
    expect(caixas.map((c) => c.querySelector('.mg-field__label')?.textContent)).toEqual([
      'Data da movimentação *', 'Local de Origem *', 'Produto de Suplementação *', 'Unidade', 'Quantidade (kg) *', 'Observações',
    ]);
    // O * é o do LancField (`required`), só nos obrigatórios.
    expect(caixas.map((c) => Boolean(c.querySelector('.mg-field__label .req')))).toEqual([true, true, true, false, true, false]);
    // Cada rótulo está DENTRO da caixa do controle e o nomeia (htmlFor → id do controle).
    const controles = [
      campo(dialogo, /^Data da movimentação/),
      campo(dialogo, /^Local de Origem/),
      within(dialogo).getByRole('combobox', { name: /^Produto de Suplementação/ }),
      within(dialogo).getByRole('combobox', { name: /^Unidade/ }),
      campo(dialogo, /^Quantidade \(kg\)/),
      campo(dialogo, /^Observações/),
    ];
    controles.forEach((controle, i) => {
      expect(caixas[i].querySelector('.mg-field__control')?.contains(controle)).toBe(true);
      // Mesma classe dos controles do manejo (LL_CTL): sem borda nem sombra próprias, dentro da caixa.
      for (const classe of LL_CTL.split(' ')) expect(controle.classList.contains(classe)).toBe(true);
    });
    expect(/** @type {HTMLInputElement} */ (controles[0]).type).toBe('date');
    expect(controles[4].getAttribute('placeholder')).toBe('0,00');
    // Produto e Unidade: o campo de escolha do manejo (B1Select), como Categoria e Causa na Morte e na Pesagem.
    expect(controles[2].classList.contains('b1-select-btn')).toBe(true);
    expect(controles[3].classList.contains('b1-select-btn')).toBe(true);
    // Sem produto escolhido a Unidade fica travada em KG (só produto em sacos a libera), como antes.
    expect(controles[3].hasAttribute('disabled')).toBe(true);
    expect(controles[3].textContent).toBe('KG');
    // Data e local lado a lado; o produto na linha toda; unidade e quantidade lado a lado.
    const grade = /** @type {HTMLElement} */ (form.querySelector('.mk-ll__grade'));
    expect(Array.from(grade.children).map((c) => c.classList.contains('mk-ll__cheio'))).toEqual([false, false, true, false, false]);
    expect(grade.contains(controles[5])).toBe(false);
  });

  it('Saída: o campo do local é "Local de Destino"; a quantidade em sacas troca o rótulo', async () => {
    const { dialogo, form } = await montar('Saída', 1280);
    expect(form.querySelector('.mk-lanc .mg-field__label')?.textContent).toBe('Data da movimentação *');
    expect(campo(dialogo, /^Local de Destino/)).toBeTruthy();
    expect(within(dialogo).queryByLabelText(/^Local de Origem/)).toBeNull();
    cleanup();
    // Entrada do proteinado (sacos de 30 kg): Sacas na unidade e o rótulo da quantidade em sacas.
    const entrada = await montar('Entrada', 1280);
    await escolherLocal(entrada.dialogo, /^Local de Origem/, LOCAL_CENTRAL.nome);
    await escolherNoSelect(entrada.dialogo, /^Produto de Suplementação/, 'PROTEINADO 40 (KG)');
    await escolherNoSelect(entrada.dialogo, /^Unidade/, 'Sacas (30 kg/saco)');
    expect(campo(entrada.dialogo, /^Quantidade \(sacas\)/)).toBeTruthy();
  });
});

describe('TM-4 — Origem · Destino · Saldo num LancLoteAviso neutro', () => {
  it('Entrada do proteinado: origem = o local escolhido, destino = o depósito, saldo em kg (3 casas) e em sacas (2 casas)', async () => {
    const { dialogo, form } = await montar('Entrada', 1280);
    const resumo = within(form).getByTestId('transferencia-resumo');
    expect(resumo.className).toBe('mk-ll__aviso mk-ll__aviso--neutro');
    expect(resumo.textContent).toBe(`Origem: - · Destino: ${LOCAL_SEDE.nome} · Saldo (kg): 0,000`);
    await escolherLocal(dialogo, /^Local de Origem/, LOCAL_CENTRAL.nome);
    await escolherNoSelect(dialogo, /^Produto de Suplementação/, 'PROTEINADO 40 (KG)');
    expect(resumo.textContent).toBe(`Origem: ${LOCAL_CENTRAL.nome} · Destino: ${LOCAL_SEDE.nome} · Saldo (kg): 900,000 · Saldo (sacas): 30,00`);
    // Cada item "Rótulo: valor" fica junto (a linha quebra entre os itens), com o valor em negrito.
    const itens = Array.from(resumo.querySelectorAll(':scope > span:not([aria-hidden])'));
    expect(itens.map((s) => s.querySelector('b')?.textContent)).toEqual([LOCAL_CENTRAL.nome, LOCAL_SEDE.nome, '900,000', '30,00']);
    // O resumo fica depois da grade e antes das observações, como antes.
    const blocos = Array.from(form.children);
    expect(blocos.indexOf(resumo)).toBe(blocos.indexOf(/** @type {Element} */ (form.querySelector('.mk-ll__grade'))) + 1);
  });

  it('Saída do sal: origem = o depósito, destino = o local escolhido, sem a linha de sacas', async () => {
    const { dialogo, form } = await montar('Saída', 1280);
    await escolherLocal(dialogo, /^Local de Destino/, LOCAL_RETIRO.nome);
    await escolherNoSelect(dialogo, /^Produto de Suplementação/, 'SAL MINERAL 80 (KG)');
    expect(within(form).getByTestId('transferencia-resumo').textContent).toBe(`Origem: ${LOCAL_SEDE.nome} · Destino: ${LOCAL_RETIRO.nome} · Saldo (kg): 1.400,000`);
  });
});

describe('TM-5 — o ✓ do cabeçalho envia, com as validações e mensagens de hoje', () => {
  it('local, data, produto, quantidade e saldo: cada recusa com a sua mensagem e sem chamar o servidor', async () => {
    const { dialogo } = await montar('Saída', 1280);
    const ok = () => confirmar(dialogo, 'Saída');
    const recusa = async (mensagem) => {
      h.toast.error.mockClear();
      await clicar(ok());
      expect(h.toast.error).toHaveBeenCalledTimes(1);
      expect(h.toast.error).toHaveBeenCalledWith(mensagem);
    };
    await recusa('Selecione o local.');
    await escolherLocal(dialogo, /^Local de Destino/, LOCAL_RETIRO.nome);
    const data = /** @type {HTMLInputElement} */ (campo(dialogo, /^Data da movimentação/));
    expect(data.value).toBe(HOJE);
    expect(data.getAttribute('max')).toBe(HOJE);
    fireEvent.change(data, { target: { value: '' } });
    await recusa('Informe a data da movimentação.');
    fireEvent.change(data, { target: { value: HOJE } });
    await recusa('Selecione um produto.');
    await escolherNoSelect(dialogo, /^Produto de Suplementação/, 'SAL MINERAL 80 (KG)');
    await recusa('Informe uma quantidade válida.');
    fireEvent.change(campo(dialogo, /^Quantidade \(kg\)/), { target: { value: '1401' } });
    await recusa('Quantidade maior que o saldo disponível.');
    expect(h.registrar).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: TITULO['Saída'] })).toBe(dialogo);
  });
});

describe('TM-6 — o ✓ grava como antes', () => {
  it('celular, Entrada em sacas: 2 sacas = 60 kg do Galpão Central para o depósito; cache com force, invalidações, aviso e o diálogo fecha', async () => {
    const atualizarMapa = vi.fn();
    window.addEventListener('atualizar-mapa', atualizarMapa);
    try {
      const { dialogo, invalidar } = await montar('Entrada', 390);
      await escolherLocal(dialogo, /^Local de Origem/, LOCAL_CENTRAL.nome);
      // No celular as listas de Produto e Unidade também são folhas DENTRO deste diálogo (D-PROD-161).
      const naFolhaDoDialogo = (opcao) => {
        expect(opcao.closest('.mk-sheet')).toBeTruthy();
        expect(opcao.closest('.mk-ll-dlg')).toBe(dialogo);
      };
      await escolherNoSelect(dialogo, /^Produto de Suplementação/, 'PROTEINADO 40 (KG)', naFolhaDoDialogo);
      await escolherNoSelect(dialogo, /^Unidade/, 'Sacas (30 kg/saco)', naFolhaDoDialogo);
      fireEvent.change(campo(dialogo, /^Quantidade \(sacas\)/), { target: { value: '2' } });
      await clicar(confirmar(dialogo, 'Entrada'));
      await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Transferência registrada.'));
      expect(h.toast.error).not.toHaveBeenCalled();
      expect(h.registrar).toHaveBeenCalledTimes(1);
      const envio = h.registrar.mock.calls[0][0];
      expect(envio).toMatchObject({
        empresaId: EMP,
        produto: PROT,
        quantidade: 60,
        localOrigemId: LOCAL_CENTRAL.id,
        localOrigemNome: LOCAL_CENTRAL.nome,
        localDestinoId: LOCAL_SEDE.id,
        localDestinoNome: LOCAL_SEDE.nome,
        observacoes: `Entrada pelo depósito ${DEPOSITO.nome_ponto}`,
        dataMovimentacao: HOJE,
      });
      expect(envio.lotesNota.map((l) => l.id)).toEqual(['l-sal', 'l-prot']);
      expect(h.refresh).toHaveBeenCalledWith('movimentacaoEstoque', EMP, { force: true });
      expect(h.refresh).toHaveBeenCalledWith('estoqueLotes', EMP, { force: true });
      // As invalidações do formulário (histórico e movimentações do depósito) e as do detalhe (saldo e pontos).
      const chaves = ['estoque-lotes-transferencia', 'historico-deposito', 'movimentacoes-deposito-detalhe', 'saldo-deposito', 'cochos-vinculados-deposito', 'mapa-pontos-supl'];
      const invalidadas = chaves.filter((k) => invalidar.mock.calls.some(([filtro]) => filtro?.predicate?.({ queryKey: [k] })));
      expect(invalidadas).toEqual(chaves);
      expect(atualizarMapa).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: TITULO.Entrada })).toBeNull());
    } finally {
      window.removeEventListener('atualizar-mapa', atualizarMapa);
    }
  });

  it('desktop, Saída em kg com observação: o depósito manda para o Depósito Retiro', async () => {
    const { dialogo } = await montar('Saída', 1280);
    await escolherLocal(dialogo, /^Local de Destino/, LOCAL_RETIRO.nome);
    await escolherNoSelect(dialogo, /^Produto de Suplementação/, 'SAL MINERAL 80 (KG)');
    fireEvent.change(campo(dialogo, /^Quantidade \(kg\)/), { target: { value: '25' } });
    fireEvent.change(campo(dialogo, /^Observações/), { target: { value: 'NF 123' } });
    await clicar(confirmar(dialogo, 'Saída'));
    await waitFor(() => expect(h.registrar).toHaveBeenCalledTimes(1));
    expect(h.registrar.mock.calls[0][0]).toMatchObject({
      produto: SAL,
      quantidade: 25,
      localOrigemId: LOCAL_SEDE.id,
      localOrigemNome: LOCAL_SEDE.nome,
      localDestinoId: LOCAL_RETIRO.id,
      localDestinoNome: LOCAL_RETIRO.nome,
      observacoes: 'NF 123',
      dataMovimentacao: HOJE,
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITULO['Saída'] })).toBeNull());
  });

  it('o servidor recusa: a mensagem de erro de hoje (a do catálogo ou a padrão) e o diálogo continua aberto', async () => {
    const { ApiError, API_ERROR_CODES, getApiErrorMessage } = await import('@/apis/_core/ApiError');
    const doCatalogo = new ApiError(API_ERROR_CODES.OPERATION_FAILED);
    for (const [erro, mensagem] of [
      [doCatalogo, getApiErrorMessage(doCatalogo, 'Erro ao registrar a transferência.')],
      [new Error('falha crua da rede'), 'Erro ao registrar a transferência.'],
    ]) {
      h.registrar.mockReset();
      h.registrar.mockImplementation(async () => {
        throw erro;
      });
      h.toast.error.mockClear();
      const { dialogo } = await montar('Saída', 1280);
      await escolherLocal(dialogo, /^Local de Destino/, LOCAL_RETIRO.nome);
      await escolherNoSelect(dialogo, /^Produto de Suplementação/, 'SAL MINERAL 80 (KG)');
      fireEvent.change(campo(dialogo, /^Quantidade \(kg\)/), { target: { value: '25' } });
      await clicar(confirmar(dialogo, 'Saída'));
      await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
      expect(h.toast.error).toHaveBeenCalledWith(mensagem);
      expect(h.toast.success).not.toHaveBeenCalled();
      expect(h.refresh).not.toHaveBeenCalledWith('movimentacaoEstoque', EMP, { force: true });
      expect(screen.getByRole('dialog', { name: TITULO['Saída'] })).toBe(dialogo);
      // Depois da recusa o ✓ volta a ficar ativo.
      await waitFor(() => expect(confirmar(dialogo, 'Saída').hasAttribute('disabled')).toBe(false));
      cleanup();
    }
  });
});

describe('TM-8 — celular: Esc com a folha do Produto aberta fecha só a folha (D-PROD-161, como a do Local)', () => {
  it('o primeiro Esc fecha a folha e mantém o diálogo; o segundo fecha o diálogo sem gravar', async () => {
    const { dialogo } = await montar('Saída', 390);
    await tocarCampo(within(dialogo).getByRole('combobox', { name: /^Produto de Suplementação/ }));
    const opcao = await screen.findByRole('option', { name: 'SAL MINERAL 80 (KG)' });
    expect(opcao.closest('.mk-ll-dlg')).toBe(dialogo);
    await act(async () => {
      fireEvent.keyDown(opcao, { key: 'Escape' });
    });
    expect(screen.queryByRole('option', { name: 'SAL MINERAL 80 (KG)' })).toBeNull();
    expect(screen.getByRole('dialog', { name: TITULO['Saída'] })).toBe(dialogo);
    await act(async () => {
      fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITULO['Saída'] })).toBeNull());
    expect(h.registrar).not.toHaveBeenCalled();
  });
});

describe('TM-7 — o ✕ do cabeçalho cancela', () => {
  it.each([[1280], [390]])('largura %ipx: fecha a transferência sem gravar; o detalhe do depósito continua', async (px) => {
    const { dialogo } = await montar('Entrada', px);
    await clicar(within(/** @type {HTMLElement} */ (dialogo.querySelector('.mk-ll-dlg__head'))).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITULO.Entrada })).toBeNull());
    expect(h.registrar).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Entrada' })).toBeTruthy();
  });
});
