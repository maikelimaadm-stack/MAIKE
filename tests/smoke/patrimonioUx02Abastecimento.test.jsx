/**
 * D-PROD-160 (Patrimônio UX-02), revista pela D-PROD-162 (SIMPLIFICA-01) —
 * Novo abastecimento orientado por PRODUTO, na tela real (página, motor Base1,
 * service, API, porta e nativeHttpClient reais) sobre o backend falso, cuja
 * rota A16 `produtos-do-bem` segue a semântica do serviço real: os "Produtos
 * aceitos" (ativos) dos tanques ativos do bem, Produto ativo, da fazenda, em L
 * ou KG. O operador escolhe a máquina e o PRODUTO (nome real do estoque); não
 * há tipo de combustível nem fator kg/L. A baixa é EXATAMENTE a quantidade
 * digitada, na unidade do Produto.
 *
 *  UX-A01 fluxo TP-02 sem etapa Combustível; corpos A3/A4 exatos (sem tipo/fator)
 *  UX-A02 auto-seleção só com has_more=false (página parcial → seletor, nada escolhido)
 *  UX-A03 2..6 Produtos → botões; >6 → seletor com busca e selo de unidade; ids da opção no corpo
 *  UX-A04 multi-tanque → "Qual tanque será abastecido?"; D2 com 2 tanques (A aceita Diesel, B aceita Arla): o tanque segue o Produto
 *  UX-A05 Produto em KG (achado D8): rótulo "(kg)", dica fixa no formulário e na revisão, capacidade não conferida
 *  UX-A06 nenhum Produto: cada motivo do servidor, apontando para Bens Patrimoniais
 *  UX-A07 sem saldo · UX-A08 vários locais
 *  UX-A09 resposta atrasada do bem anterior não auto-escolhe no bem novo
 *  UX-A10 troca do aceite A → B no tanque: 422 na confirmação → relê → escolhe B; o histórico fica com A
 *  UX-A11 revisão: resumo humano, "Detalhes do estoque" recolhido; mudar invalida
 *  UX-A12 lista: colunas padrão exatas (Quantidade com a unidade), preferência antiga não volta; celular (cards)
 *  UX-A13 teclado/acessibilidade e 390 px sem largura fixa
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { escolherOpcao, rotulosDasOpcoes } from './fixtures/gestaoBackendFake.js';
import { acrescentarProduto, rotearAbastecimentos, semearAbastecimento } from './fixtures/abastecimentosFakeCore.js';
import {
  abrirDetalhesDoEstoque,
  abrirNovo,
  chamadasDe,
  digitar,
  escolherNoSeletor,
  escolherProduto,
  esperarProdutoMarcado,
  montar,
  pedirPrevia,
  permissaoCom,
  preencherTrator,
  prepararAmbiente,
  responderTanqueCheio,
} from './fixtures/abastecimentosTela.jsx';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1' }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(async () => sessao.permissao),
}));
vi.mock('@/services/mapaCacheService', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshMapaCacheEntry: vi.fn(async () => []),
}));

const DICA_KG = 'Este Produto é controlado em quilos: digite kg, não os litros da bomba.';
const DICA_SACO = 'Este Produto é em sacos, com estoque em quilos: digite kg (não sacos nem os litros da bomba).';

let amb;
let matchMediaOriginal;

beforeEach(async () => {
  sessao.permissao = permissaoCom({ novo: true });
  matchMediaOriginal = window.matchMedia;
  amb = await prepararAmbiente(vi);
});

afterEach(() => {
  cleanup();
  window.matchMedia = matchMediaOriginal;
  window.innerWidth = 1024;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const previas = () => chamadasDe(amb.backend, 'POST', '/patrimonio-abastecimentos-previa');
const confirmacoes = () => chamadasDe(amb.backend, 'POST', '/patrimonio-abastecimentos');
const produtosDoBem = () => chamadasDe(amb.backend, 'GET', '/patrimonio-abastecimentos-opcoes/produtos-do-bem');
const locaisLidos = () => chamadasDe(amb.backend, 'GET', '/patrimonio-abastecimentos-opcoes/locais');
const esperar = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const radios = (raiz) => within(raiz).getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked')]);

/** Mais um Produto do estoque da fazenda, aceito (ativo) pelo tanque principal do trator. */
const novoProdutoNoTrator = (id, nome, extra = {}) => acrescentarProduto(amb.estado, id, nome, { tanques: [['b1', 'tq1']], ...extra });
/** O tanque principal do trator passa a aceitar SÓ estes Produtos (o PATCH do bem no cadastro de Bens). */
const aceitesDoTrator = (ids) => {
  amb.estado.tanques.b1[0].produtos = [...ids];
};

const CORPO_TP02 = (hoje) => ({
  empresa_id: 'emp-1', bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1',
  data_operacional: hoje, quantidade: '80', medidor_leitura: '1550.5', tanque_cheio: true, observacao: null, referencia_externa: null,
});

describe('UX-A01 — fluxo TP-02: máquina → Produto → quantidade → medidor → revisar → confirmar', () => {
  it('sem etapa Combustível: o único Produto aceito já vem marcado; corpos A3/A4 EXATOS, sem tipo nem fator', async () => {
    await montar();
    const form = await abrirNovo();
    // Data pré-preenchida com o "hoje" da fazenda.
    expect(within(form).getByTestId('abastecimento-data')).toHaveValue(amb.estado.hoje);
    await preencherTrator(form);
    const grupo = within(form).getByTestId('abastecimento-produto');
    expect(grupo.getAttribute('aria-label')).toBe('Produto');
    expect(radios(grupo)).toEqual([['Diesel S10 granel', 'true']]);
    expect(within(form).queryByRole('radiogroup', { name: /combust/i })).toBeNull();
    expect(within(form).queryByTestId('abastecimento-tanque')).toBeNull();
    expect(form).not.toHaveTextContent(/fator|kg\/L/i);
    const dialogo = await pedirPrevia(form);
    expect(previas()[0].body).toEqual(CORPO_TP02(amb.estado.hoje));
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    expect(await screen.findByTestId('abastecimento-consulta')).toBeTruthy();
    expect(confirmacoes()).toHaveLength(1);
    expect(confirmacoes()[0].body).toEqual({ ...CORPO_TP02(amb.estado.hoje), operation_id: expect.stringMatching(/^lanc-/) });
    expect(screen.getByTestId('consulta-produto')).toHaveTextContent('Diesel S10 granel');
    expect(screen.getByTestId('consulta-quantidade')).toHaveTextContent('80,0000 L');
    expect(screen.queryByTestId('consulta-tipo')).toBeNull();
    expect(screen.queryByText('Tipo de combustível (classificação)')).toBeNull();
  });
});

describe('UX-A02 — auto-seleção só com a resposta COMPLETA', () => {
  it('página parcial (has_more): seletor paginado, NADA escolhido, nenhum saldo lido; escolher pelo seletor aplica a opção', async () => {
    novoProdutoNoTrator('p5', 'Diesel S10 posto');
    amb.estado.paginaProdutosDoBem = 1;
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    const seletor = await within(form).findByTestId('abastecimento-produto');
    expect(seletor.tagName).toBe('BUTTON');
    expect(seletor).toHaveAttribute('data-placeholder'); // vazio: D-PROD-172
    expect(within(form).queryAllByRole('radio', { name: /Diesel/ })).toEqual([]);
    await esperar();
    expect(locaisLidos()).toEqual([]);
    expect(produtosDoBem()[0].query).toEqual({ empresa_id: 'emp-1', bem_id: 'b1', limit: '100' });
    fireEvent.click(seletor);
    const primeira = await screen.findByRole('option', { name: /Diesel S10 granel/ });
    expect(screen.queryByRole('option', { name: /Diesel S10 posto/ })).toBeNull();
    fireEvent.click(primeira);
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    expect(within(form).getByTestId('abastecimento-produto')).toHaveTextContent('Diesel S10 granel');
  });

  it('resposta completa com 2 Produtos: botões, nenhum marcado (nunca escolhe sozinho)', async () => {
    novoProdutoNoTrator('p5', 'Diesel S10 posto');
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    const grupo = await within(form).findByTestId('abastecimento-produto');
    expect(radios(grupo)).toEqual([
      ['Diesel S10 granel', 'false'],
      ['Diesel S10 posto', 'false'],
    ]);
    await esperar();
    expect(locaisLidos()).toEqual([]);
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Escolha o Produto.')).toBeTruthy();
    expect(previas()).toEqual([]);
  });
});

describe('UX-A03 — vários Produtos aceitos pelo tanque', () => {
  it('2..6 → botões com o NOME real; o corpo leva produto/tanque da opção do servidor; a baixa é o número digitado', async () => {
    novoProdutoNoTrator('p5', 'Diesel S10 posto');
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await escolherProduto(form, 'Diesel S10 posto');
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    digitar(form, 'abastecimento-quantidade', '40');
    digitar(form, 'abastecimento-leitura', '1.560');
    const dialogo = await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p5', local_estoque_id: 'l1', quantidade: '40' });
    expect(within(dialogo).getByTestId('previa-baixa')).toHaveTextContent('40,0000 L');
  });

  it('mais de 6 Produtos completos → seletor paginado com busca (rótulo = nome do Produto; a unidade L/kg no detalhe)', async () => {
    for (let i = 1; i <= 6; i += 1) novoProdutoNoTrator(`px${i}`, `Diesel extra ${i}`, { unidade: i === 3 ? 'KG' : 'L' });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    const seletor = await within(form).findByTestId('abastecimento-produto');
    await waitFor(() => expect(seletor.tagName).toBe('BUTTON'));
    expect(within(form).queryByRole('radiogroup', { name: 'Produto' })).toBeNull();
    fireEvent.click(seletor);
    const opcoes = await screen.findAllByRole('option');
    expect(opcoes).toHaveLength(7);
    expect(opcoes.find((o) => /Diesel extra 3/.test(o.textContent))).toHaveTextContent('Diesel extra 3kg');
    expect(opcoes.find((o) => /Diesel extra 2/.test(o.textContent))).toHaveTextContent('Diesel extra 2L');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar produto' }), { target: { value: 'extra 5' } });
    await waitFor(() => expect(produtosDoBem().at(-1).query).toEqual({ empresa_id: 'emp-1', bem_id: 'b1', q: 'extra 5', limit: '50' }));
    fireEvent.click(await screen.findByRole('option', { name: /Diesel extra 5/ }));
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    expect(within(form).getByTestId('abastecimento-produto')).toHaveTextContent('Diesel extra 5');
  });
});

describe('UX-A04 — multi-tanque', () => {
  it('Produto aceito em 2 tanques ativos → "Qual tanque será abastecido?" obrigatório; o inativo não aparece; capacidade do escolhido', async () => {
    amb.estado.tanques.b1.push(
      { id: 'tqB', identificador: 'Tanque reserva', capacidade_litros: '60.0000', produtos: ['p1'] },
      { id: 'tqC', identificador: 'Tanque antigo', capacidade_litros: '90.0000', produtos: ['p1'], ativo: false },
    );
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await esperarProdutoMarcado(form, 'Diesel S10 granel');
    const tanques = await within(form).findByTestId('abastecimento-tanque');
    expect(tanques.getAttribute('aria-label')).toBe('Qual tanque será abastecido?');
    expect(radios(tanques)).toEqual([
      ['Tanque principal (180 L)', 'false'],
      ['Tanque reserva (60 L)', 'false'],
    ]);
    digitar(form, 'abastecimento-quantidade', '70');
    digitar(form, 'abastecimento-leitura', '1.560');
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Escolha qual tanque será abastecido.')).toBeTruthy();
    fireEvent.click(within(tanques).getByRole('radio', { name: 'Tanque reserva (60 L)' }));
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Os litros passam da capacidade nominal do tanque.')).toBeTruthy();
    expect(previas()).toEqual([]);
    digitar(form, 'abastecimento-quantidade', '50');
    const dialogo = await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ tanque_id: 'tqB', produto_id: 'p1' });
    expect(within(abrirDetalhesDoEstoque(dialogo)).getByTestId('previa-tanque')).toHaveTextContent('Tanque reserva (60 L)');
  });

  it('D2 com 2 tanques (achado D12): A aceita o Diesel e B aceita o Arla → cada Produto só no seu tanque, sem perguntar; a capacidade é a do tanque do Produto', async () => {
    amb.estado.tanques.b1.push({ id: 'tqB', identificador: 'Tanque do Arla', capacidade_litros: '40.0000', produtos: [] });
    acrescentarProduto(amb.estado, 'p7', 'Arla 32', { tanques: [['b1', 'tqB']] });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    const grupo = await within(form).findByTestId('abastecimento-produto');
    expect(radios(grupo)).toEqual([
      ['Arla 32', 'false'],
      ['Diesel S10 granel', 'false'],
    ]);
    // Diesel: só o tanque A o aceita → sem pergunta de tanque.
    await escolherProduto(form, 'Diesel S10 granel');
    expect(within(form).queryByTestId('abastecimento-tanque')).toBeNull();
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    digitar(form, 'abastecimento-quantidade', '50');
    digitar(form, 'abastecimento-leitura', '1.560');
    await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ produto_id: 'p1', tanque_id: 'tq1' });
    fireEvent.click(within(screen.getByTestId('dialogo-previa-abastecimento')).getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-previa-abastecimento')).toBeNull());
    // Arla: o tanque segue o Produto (B, 40 L): 50 L passam da capacidade dele.
    await escolherProduto(form, 'Arla 32');
    expect(within(form).queryByTestId('abastecimento-tanque')).toBeNull();
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Os litros passam da capacidade nominal do tanque.')).toBeTruthy();
    expect(previas()).toHaveLength(1);
    digitar(form, 'abastecimento-quantidade', '30');
    const dialogo = await pedirPrevia(form);
    expect(previas().at(-1).body).toMatchObject({ produto_id: 'p7', tanque_id: 'tqB', quantidade: '30' });
    expect(within(abrirDetalhesDoEstoque(dialogo)).getByTestId('previa-tanque')).toHaveTextContent('Tanque do Arla (40 L)');
  });
});

describe('UX-A05 — Produto em KG (achado D8)', () => {
  it('rótulo "(kg)" e dica fixa sob a quantidade e na revisão; 250 kg num tanque de 180 L passa (a capacidade é só para L); baixa e toast em kg', async () => {
    novoProdutoNoTrator('p6', 'Diesel pesado (kg)', { unidade: 'KG', lote: '500.0000', custo: '4.0000' });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await escolherProduto(form, 'Diesel pesado (kg)');
    expect(within(form).getByText('Quantidade abastecida (kg)')).toBeTruthy();
    expect(within(form).getByTestId('abastecimento-dica-kg')).toHaveTextContent(DICA_KG);
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    digitar(form, 'abastecimento-quantidade', '250');
    digitar(form, 'abastecimento-leitura', '1.560');
    const dialogo = await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ produto_id: 'p6', tanque_id: 'tq1', quantidade: '250' });
    expect(within(dialogo).queryByTestId('previa-bloqueios')).toBeNull();
    expect(within(dialogo).getByTestId('previa-dica-kg')).toHaveTextContent(DICA_KG);
    expect(within(dialogo).getByTestId('previa-resumo')).toHaveTextContent('TP-02 — Trator TP-02 · Diesel pesado (kg) · 250 kg. Baixa de 250,0000 kg do estoque em Tanque diesel sede.');
    expect(within(dialogo).getByTestId('previa-baixa')).toHaveTextContent('250,0000 kg');
    const detalhes = abrirDetalhesDoEstoque(dialogo);
    expect(within(detalhes).getByTestId('previa-capacidade')).toHaveTextContent('não conferida (Produto em quilos: a capacidade é em litros)');
    expect(within(detalhes).getByTestId('previa-custo')).toHaveTextContent(/R\$\s1\.000,00 \(R\$\s4,00\/kg\)/);
    expect(within(detalhes).getByTestId('previa-saldo')).toHaveTextContent('500,0000 kg');
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    expect(await screen.findByText('Abastecimento nº 1 confirmado: 250,0000 kg baixados do estoque.')).toBeTruthy();
    expect(screen.getByTestId('consulta-quantidade')).toHaveTextContent('250,0000 kg');
    expect(amb.estado.lotes.find((l) => l.id === 'lote-p6').disponivel).toBe('250.0000');
    // Os lotes do Diesel em L não foram tocados (nenhuma conversão entre Produtos/unidades).
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['50.0000', '100.0000']);
  });

  it('D-PROD-169: Produto em SACO abastece em kg — rótulo "(kg)", dica de saco, baixa e registro em kg, capacidade não conferida', async () => {
    novoProdutoNoTrator('p8', 'Sal mineral (saco)', { unidade: 'SACO', lote: '300.0000', custo: '2.0000' });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await escolherProduto(form, 'Sal mineral (saco)');
    expect(within(form).getByText('Quantidade abastecida (kg)')).toBeTruthy();
    expect(within(form).getByTestId('abastecimento-dica-kg')).toHaveTextContent(DICA_SACO);
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    digitar(form, 'abastecimento-quantidade', '200');
    digitar(form, 'abastecimento-leitura', '1.560');
    const dialogo = await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ produto_id: 'p8', tanque_id: 'tq1', quantidade: '200' });
    expect(within(dialogo).queryByTestId('previa-bloqueios')).toBeNull();
    expect(within(dialogo).getByTestId('previa-dica-kg')).toHaveTextContent(DICA_SACO);
    expect(within(dialogo).getByTestId('previa-baixa')).toHaveTextContent('200,0000 kg');
    const detalhes = abrirDetalhesDoEstoque(dialogo);
    expect(within(detalhes).getByTestId('previa-capacidade')).toHaveTextContent('não conferida (Produto em quilos: a capacidade é em litros)');
    expect(within(detalhes).getByTestId('previa-saldo')).toHaveTextContent('300,0000 kg');
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    expect(await screen.findByText('Abastecimento nº 1 confirmado: 200,0000 kg baixados do estoque.')).toBeTruthy();
    expect(screen.getByTestId('consulta-quantidade')).toHaveTextContent('200,0000 kg');
    // A baixa é EXATAMENTE a quantidade digitada (kg), e o abastecimento grava `KG` (SACO → KG).
    expect(amb.estado.lotes.find((l) => l.id === 'lote-p8').disponivel).toBe('100.0000');
    expect(amb.estado.abastecimentos[0].unidade).toBe('KG');
  });

  it('trocar de Produto em KG para Produto em L tira a dica e volta o rótulo "(L)"; a capacidade volta a valer', async () => {
    novoProdutoNoTrator('p6', 'Diesel pesado (kg)', { unidade: 'KG', lote: '500.0000' });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await escolherProduto(form, 'Diesel pesado (kg)');
    expect(within(form).getByTestId('abastecimento-dica-kg')).toBeTruthy();
    digitar(form, 'abastecimento-quantidade', '250');
    await escolherProduto(form, 'Diesel S10 granel');
    expect(within(form).queryByTestId('abastecimento-dica-kg')).toBeNull();
    expect(within(form).getByText('Quantidade abastecida (L)')).toBeTruthy();
    digitar(form, 'abastecimento-leitura', '1.560');
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Os litros passam da capacidade nominal do tanque.')).toBeTruthy();
    expect(previas()).toEqual([]);
  });

  it('a ação antiga configurar_conversao não dá nada: sem "Fatores kg/L", sem aviso de fator, nenhuma rota de fator chamada', async () => {
    sessao.permissao = permissaoCom({ novo: true, configurar_conversao: true });
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    expect(screen.queryByTestId('abastecimento-fatores')).toBeNull();
    expect(screen.queryByText(/Fatores kg\/L|Configurar fator/)).toBeNull();
    expect(within(form).queryByTestId('abastecimento-sem-fator')).toBeNull();
    await pedirPrevia(form);
    expect(amb.backend.chamadas.filter((c) => c.path.startsWith('/patrimonio-conversoes'))).toEqual([]);
  });
});

describe('UX-A06 — nenhum Produto para o bem (cada motivo do servidor, resolvido em Bens Patrimoniais)', () => {
  /** Monta, escolhe o trator e devolve o aviso. */
  const avisoDoTrator = async () => {
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    const aviso = await within(form).findByTestId('abastecimento-sem-produto');
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Escolha o Produto.')).toBeTruthy();
    expect(within(form).queryByTestId('abastecimento-produto')).toBeNull();
    expect(previas()).toEqual([]);
    expect(locaisLidos()).toEqual([]);
    return aviso;
  };

  it('tanque_sem_produto: orienta marcar os Produtos aceitos em Bens; sem link sem a permissão de ver Bens; nada sobre combustível ou fator', async () => {
    aceitesDoTrator([]);
    const aviso = await avisoDoTrator();
    expect(aviso).toHaveTextContent(
      'Os tanques deste bem não têm Produto aceito. Marque os Produtos aceitos em Bens Patrimoniais › Operação › Tanques. Peça a quem cuida do cadastro de Bens Patrimoniais.',
    );
    expect(aviso).not.toHaveTextContent(/fator|Combustíveis/i);
    expect(within(aviso).queryByRole('link')).toBeNull();
  });

  it('tanque_sem_produto com permissão de ver Bens: link "Abrir Bens Patrimoniais"', async () => {
    aceitesDoTrator([]);
    sessao.permissao = { ...permissaoCom({ novo: true }), permissoes_telas: [...permissaoCom({ novo: true }).permissoes_telas, { tela_id: 'pat-bens-patrimoniais', visualizar: true }] };
    const aviso = await avisoDoTrator();
    expect(within(aviso).getByRole('link', { name: 'Abrir Bens Patrimoniais' }).getAttribute('href')).toBe('/benspatrimoniais');
    expect(aviso).not.toHaveTextContent('Peça a quem cuida');
  });

  it('produto_unidade_incompativel (o Produto aceito está numa unidade fora de L/KG/SACO — D-PROD-169: SACO serve)', async () => {
    amb.estado.produtos.find((p) => p.id === 'p1').unidade_principal_estoque = 'UN';
    expect(await avisoDoTrator()).toHaveTextContent(
      'O Produto aceito não tem estoque em litros (L), quilos (KG) nem sacos (SACO): o abastecimento não é possível. Aceite no tanque outro Produto em Bens Patrimoniais › Operação › Tanques.',
    );
  });

  it('produto_inativo_ou_outra_fazenda (inativo; de outra fazenda)', async () => {
    amb.estado.produtos.find((p) => p.id === 'p1').ativo = false;
    expect(await avisoDoTrator()).toHaveTextContent(
      'Os Produtos aceitos pelos tanques deste bem estão inativos ou são de outra fazenda. Ajuste os Produtos aceitos em Bens Patrimoniais › Operação › Tanques.',
    );
    cleanup();
    amb.estado.produtos.find((p) => p.id === 'p1').ativo = true;
    amb.estado.produtos.find((p) => p.id === 'p1').empresa = 'emp-2';
    expect(await avisoDoTrator()).toHaveTextContent('Os Produtos aceitos pelos tanques deste bem estão inativos ou são de outra fazenda.');
  });

  it('sem_tanque_ativo (tanque inativado depois da lista de bens)', async () => {
    amb.falhar = (req) =>
      req.method === 'GET' && req.path === '/patrimonio-abastecimentos-opcoes/bens'
        ? { status: 200, body: { itens: [{ id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', ativo: true, medidor: amb.estado.bens[0].medidor }], has_more: false, next_cursor: null } }
        : null;
    amb.estado.tanques.b1[0].ativo = false;
    expect(await avisoDoTrator()).toHaveTextContent('Este bem não tem tanque ativo. Cadastre ou reative um tanque no cadastro do bem.');
  });

  it('bem_inativo (bem inativado depois de escolhido)', async () => {
    const trator = amb.estado.bens.find((b) => b.id === 'b1');
    amb.falhar = (req) =>
      req.method === 'GET' && req.path === '/patrimonio-abastecimentos-opcoes/bens'
        ? { status: 200, body: { itens: [{ id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', ativo: true, medidor: trator.medidor }], has_more: false, next_cursor: null } }
        : null;
    trator.ativo = false;
    expect(await avisoDoTrator()).toHaveTextContent('Este bem está inativo: reative-o no cadastro de Bens para abastecer.');
  });

  it('erro de leitura dos Produtos: aviso com "Tentar novamente" que relê', async () => {
    let falhas = 1;
    amb.falhar = (req) => (req.path === '/patrimonio-abastecimentos-opcoes/produtos-do-bem' && falhas-- > 0 ? { status: 503, body: { code: 'PROVIDER_UNAVAILABLE', message: 'x', request_id: 'r' } } : null);
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    const erro = await within(form).findByTestId('abastecimento-produtos-erro');
    fireEvent.click(within(erro).getByRole('button', { name: 'Tentar novamente' }));
    await esperarProdutoMarcado(form, 'Diesel S10 granel');
  });
});

describe('UX-A07/A08 — local do estoque', () => {
  it('sem saldo do Produto: aviso e nada é enviado', async () => {
    for (const l of amb.estado.lotes.filter((x) => x.produto === 'p1')) l.disponivel = '0.0000';
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await esperarProdutoMarcado(form, 'Diesel S10 granel');
    expect(await within(form).findByTestId('abastecimento-sem-saldo')).toHaveTextContent('Sem saldo deste Produto nesta fazenda.');
    digitar(form, 'abastecimento-quantidade', '10');
    digitar(form, 'abastecimento-leitura', '1.560');
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    await esperar();
    expect(previas()).toEqual([]);
  });

  it('vários locais com saldo: "De qual local do estoque?" (só o nome, sem quantidade nem lotes), obrigatório', async () => {
    amb.estado.lotes.push({ id: 'lote-P', produto: 'p1', local: 'l2', dia: '2026-06-05', disponivel: '40.0000', custo: '5.0000' });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await esperarProdutoMarcado(form, 'Diesel S10 granel');
    const local = await within(form).findByRole('combobox', { name: 'De qual local do estoque?' });
    const nomes = await rotulosDasOpcoes(local);
    // D-PROD-172: sem a opção vazia na lista (campo de escolha do motor).
    expect(nomes).toEqual(['Tanque diesel sede', 'Posto da fazenda']);
    expect(nomes.join(' ')).not.toMatch(/\bkg\b|\bL\b|lote|dispon/i);
    expect(within(form).queryByTestId('abastecimento-local-auto')).toBeNull();
    digitar(form, 'abastecimento-quantidade', '20');
    digitar(form, 'abastecimento-leitura', '1.560');
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Escolha de qual local do estoque sai o Produto.')).toBeTruthy();
    expect(previas()).toEqual([]);
    await escolherOpcao(local, 'Posto da fazenda');
    await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ produto_id: 'p1', local_estoque_id: 'l2' });
  });
});

describe('UX-A09 — resposta atrasada', () => {
  it('a resposta do bem ANTERIOR, chegando depois, não escolhe Produto no bem novo; trocar de bem limpa os dependentes', async () => {
    let soltar;
    const segura = new Promise((r) => {
      soltar = r;
    });
    amb.estado.atrasoProdutosDoBem = (bemId) => (bemId === 'b1' ? segura : null);
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    expect(await within(form).findByTestId('abastecimento-produtos-carregando')).toHaveTextContent('Carregando os Produtos deste bem…');
    await escolherNoSeletor(form, 'abastecimento-bem', /Caminhonete flex/);
    const grupo = await within(form).findByTestId('abastecimento-produto');
    await act(async () => {
      soltar();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(radios(grupo)).toEqual([
      ['Etanol hidratado', 'false'],
      ['Gasolina comum', 'false'],
    ]);
    expect(locaisLidos()).toEqual([]);
    // Escolhe no flex e volta ao trator: o Produto do flex sai; o do trator (único) é marcado.
    await escolherProduto(form, 'Etanol hidratado');
    await waitFor(() => expect(locaisLidos()).toHaveLength(1));
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await esperarProdutoMarcado(form, 'Diesel S10 granel');
    expect(within(form).queryByRole('radio', { name: 'Etanol hidratado' })).toBeNull();
    digitar(form, 'abastecimento-quantidade', '10');
    digitar(form, 'abastecimento-leitura', '1.560');
    await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1' });
  });
});

describe('UX-A10 — Produtos aceitos trocados A → B no tanque (cadastro de Bens)', () => {
  it('confirmação com A recusada (422 ABASTECIMENTO_PRODUTO_NAO_ACEITO) → a tela relê, avisa e o operador escolhe B; nada de A é trocado em silêncio', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    // Entre a revisão e a confirmação: o tanque deixa de aceitar A e passa a aceitar B.
    acrescentarProduto(amb.estado, 'p4', 'Diesel S10 estoque novo');
    aceitesDoTrator(['p4']);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    expect(confirmacoes()).toHaveLength(1);
    expect(confirmacoes()[0].body.produto_id).toBe('p1');
    expect(amb.estado.abastecimentos).toEqual([]);
    expect(await within(form).findByTestId('abastecimento-produto-indisponivel')).toHaveTextContent('O Produto escolhido deixou de estar disponível para este bem. Escolha de novo.');
    await waitFor(() => expect(screen.queryByTestId('dialogo-previa-abastecimento')).toBeNull());
    expect(radios(within(form).getByTestId('abastecimento-produto'))).toEqual([['Diesel S10 estoque novo', 'false']]);
    await escolherProduto(form, 'Diesel S10 estoque novo');
    expect(within(form).queryByTestId('abastecimento-produto-indisponivel')).toBeNull();
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    const dialogoB = await pedirPrevia(form);
    expect(previas().at(-1).body).toMatchObject({ produto_id: 'p4', tanque_id: 'tq1', quantidade: '80' });
    expect(within(dialogoB).getByTestId('previa-baixa')).toHaveTextContent('80,0000 L');
    await act(async () => fireEvent.click(within(dialogoB).getByTestId('abastecimento-confirmar')));
    expect(await screen.findByTestId('abastecimento-consulta')).toBeTruthy();
    expect(confirmacoes().at(-1).body).toMatchObject({ produto_id: 'p4' });
    expect(confirmacoes().at(-1).body).not.toHaveProperty('conversao_id');
    expect(amb.estado.abastecimentos.map((a) => a.produto_id)).toEqual(['p4']);
    // Lotes de A intactos.
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['50.0000', '100.0000']);
  });

  it('histórico: o abastecimento feito com A continua A (Produto, quantidade, unidade) depois da troca para B', async () => {
    await semearAbastecimento(amb.estado, {
      bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1', data_operacional: '2026-06-10', quantidade: '80', medidor_leitura: '1550.5',
    });
    acrescentarProduto(amb.estado, 'p4', 'Diesel S10 estoque novo');
    aceitesDoTrator(['p4']);
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-1'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('consulta-produto')).toHaveTextContent('Diesel S10 granel');
    expect(within(consulta).getByTestId('consulta-quantidade')).toHaveTextContent('80,0000 L');
  });
});

describe('UX-A11 — revisão', () => {
  it('resumo humano; "Detalhes do estoque" recolhido (tanque, capacidade, custo, saldo, FIFO); mudar "Completou o tanque?" invalida', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    const dados = within(dialogo).getByTestId('previa-dados');
    expect([...dados.querySelectorAll('dt')].map((d) => d.textContent)).toEqual([
      'Máquina/Veículo', 'Produto', 'Quantidade', 'Leitura do medidor', 'Completou o tanque', 'Data', 'Sai do estoque', 'Baixa do estoque',
    ]);
    expect(within(dialogo).getByTestId('previa-produto')).toHaveTextContent('Diesel S10 granel');
    expect(within(dialogo).getByTestId('previa-quantidade')).toHaveTextContent('80 L');
    expect(within(dialogo).getByTestId('previa-leitura')).toHaveTextContent('1.550,5 h');
    expect(within(dialogo).getByTestId('previa-tanque-cheio')).toHaveTextContent('Sim');
    expect(within(dialogo).getByTestId('previa-local')).toHaveTextContent('Tanque diesel sede');
    expect(within(dialogo).getByTestId('previa-baixa')).toHaveTextContent('80,0000 L');
    // Recolhido: nada técnico renderizado.
    const botao = within(dialogo).getByTestId('previa-detalhes-estoque');
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    for (const id of ['previa-tanque', 'previa-capacidade', 'previa-custo', 'previa-saldo', 'previa-fatias']) expect(within(dialogo).queryByTestId(id)).toBeNull();
    const detalhes = abrirDetalhesDoEstoque(dialogo);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(within(detalhes).getByTestId('previa-tanque')).toHaveTextContent('Tanque principal (180 L)');
    expect(within(detalhes).getByTestId('previa-saldo')).toHaveTextContent('150,0000 L');
    expect(within(within(detalhes).getByTestId('previa-fatias')).getAllByRole('row')).toHaveLength(3);
    // Sem tipo de combustível nem fator, nem recolhidos.
    for (const id of ['previa-tipo', 'previa-fator']) expect(within(dialogo).queryByTestId(id)).toBeNull();
    fireEvent.click(botao);
    expect(within(dialogo).queryByTestId('previa-saldo')).toBeNull();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-previa-abastecimento')).toBeNull());
    responderTanqueCheio(form, false);
    expect(await within(form).findByTestId('abastecimento-previa-invalidada')).toHaveTextContent('Os dados mudaram desde a revisão');
    // A revisão nova manda o tanque_cheio novo; o operation_id do envio é estável na repetição (FE5).
    await pedirPrevia(form);
    expect(previas().at(-1).body.tanque_cheio).toBe(false);
  });

  it('envio incerto: "Repetir o mesmo envio" conserva o operation_id (sem dupla baixa)', async () => {
    amb.estado.proxima = 'gravar-e-perder';
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    await within(dialogo).findByTestId('resultado-incerto');
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-repetir-envio')));
    expect(await screen.findByTestId('abastecimento-consulta')).toBeTruthy();
    expect(confirmacoes()).toHaveLength(2);
    expect(confirmacoes()[1].body).toEqual(confirmacoes()[0].body);
    expect(amb.estado.abastecimentos).toHaveLength(1);
  });
});

describe('UX-A12 — lista', () => {
  const semear = (extra) =>
    semearAbastecimento(amb.estado, {
      bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1', quantidade: '10', ...extra,
    });

  it('colunas padrão Data | Máquina/Veículo | Produto | Quantidade | Medidor | Situação (sem "Litros"/"KG"); mais recente primeiro', async () => {
    // Preferências antigas (v1 com Combustível; v2 com Litros e KG) não ressuscitam colunas que saíram.
    window.localStorage.setItem('colunas_abastecimentos_v1', JSON.stringify({ order: ['tipo_combustivel'], visible: { tipo_combustivel: true } }));
    window.localStorage.setItem('colunas_abastecimentos_v2', JSON.stringify({ order: ['quantidade_kg', 'quantidade_litros'], visible: { quantidade_kg: true, quantidade_litros: true } }));
    await semear({ data_operacional: '2026-06-05', medidor_leitura: '1525.0' });
    await semear({ data_operacional: '2026-06-10', medidor_leitura: '1535.0' });
    await semear({ data_operacional: '2026-06-08', medidor_leitura: '1530.0' });
    await montar();
    await screen.findByTestId('abastecimento-bem-ab-1');
    const cabecalhos = screen.getAllByRole('columnheader').map((c) => c.textContent.trim()).filter(Boolean);
    expect(cabecalhos).toEqual(['Data', 'Máquina/Veículo', 'Produto', 'Quantidade', 'Medidor', 'Situação']);
    for (const antigo of ['Combustível', 'Litros', 'KG']) expect(cabecalhos).not.toContain(antigo);
    const linhas = screen.getAllByRole('row').slice(1);
    expect(linhas.find((l) => l.textContent.includes('10/06/2026'))).toHaveTextContent(/10\/06\/2026.*TP-02 — Trator TP-02.*Diesel S10 granel.*10,0000 L.*1.535 h.*Confirmado/);
    // Ordem padrão = Nº desc, a do servidor (createdAt desc): o último lançado primeiro (L1; ver patrimonioUx02ListaOrdem).
    expect(linhas.map((l) => (l.textContent.match(/\d{2}\/06\/2026/) ?? [''])[0])).toEqual(['08/06/2026', '10/06/2026', '05/06/2026']);
  });

  it('celular (390 px): cards com máquina + Produto + quantidade + data, sem tabela', async () => {
    window.matchMedia = vi.fn().mockImplementation((q) => ({ matches: /max-width:\s*639px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    window.innerWidth = 390;
    await semear({ data_operacional: '2026-06-10', medidor_leitura: '1535.0' });
    await montar();
    const [card] = await screen.findAllByTestId('b1-card');
    expect(card).toHaveTextContent('TP-02 — Trator TP-02');
    expect(card).toHaveTextContent('Diesel S10 granel');
    expect(card).toHaveTextContent('10,0000 L');
    expect(card).toHaveTextContent('10/06/2026');
    expect(card).not.toHaveTextContent(/Combustível|kg/);
    expect(screen.queryByRole('columnheader')).toBeNull();
  });

  it('celular (390 px): o card mostra a Situação (Cancelado ≠ Confirmado sem abrir o registro) — contrato §1.4', async () => {
    window.matchMedia = vi.fn().mockImplementation((q) => ({ matches: /max-width:\s*639px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    window.innerWidth = 390;
    const antigo = await semear({ data_operacional: '2026-06-08', medidor_leitura: '1530.0' });
    await semear({ data_operacional: '2026-06-10', medidor_leitura: '1535.0' });
    amb.estado.abastecimentos.find((a) => a.id === antigo.id).status = 'CANCELADO';
    await montar();
    await waitFor(() => expect(screen.getAllByTestId('b1-card')).toHaveLength(2));
    const cardDo = (dia) => screen.getAllByTestId('b1-card').find((c) => c.textContent.includes(dia));
    expect(cardDo('10/06/2026')).toHaveTextContent('Confirmado');
    expect(cardDo('10/06/2026')).not.toHaveTextContent('Cancelado');
    expect(cardDo('08/06/2026')).toHaveTextContent('Cancelado');
    expect(cardDo('08/06/2026')).not.toHaveTextContent('Confirmado');
    // Continua: máquina no título + Produto · Quantidade · Data.
    for (const c of screen.getAllByTestId('b1-card')) {
      expect(c.querySelector('.mg-b1-card__title')).toHaveTextContent('TP-02 — Trator TP-02');
      expect(c).toHaveTextContent('Diesel S10 granel');
      expect(c).toHaveTextContent('10,0000 L');
    }
  });
});

describe('UX-A13 — teclado, acessibilidade e 390 px', () => {
  it('escolhas são botões nativos com role=radio/aria-checked; recolhíveis com aria-expanded; sem largura fixa que force rolagem', async () => {
    novoProdutoNoTrator('p5', 'Diesel S10 posto');
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    const grupo = await within(form).findByTestId('abastecimento-produto');
    expect(grupo.getAttribute('role')).toBe('radiogroup');
    for (const r of within(grupo).getAllByRole('radio')) {
      expect(r.tagName).toBe('BUTTON');
      expect(r.getAttribute('type')).toBe('button');
      expect(['true', 'false']).toContain(r.getAttribute('aria-checked'));
    }
    const posto = within(grupo).getByRole('radio', { name: 'Diesel S10 posto' });
    posto.focus();
    expect(document.activeElement).toBe(posto);
    fireEvent.click(posto);
    await esperarProdutoMarcado(form, 'Diesel S10 posto');
    const mais = within(form).getByTestId('abastecimento-mais-detalhes');
    expect(mais.tagName).toBe('BUTTON');
    expect(mais.getAttribute('aria-expanded')).toBe('false');
    expect(within(form).queryByText('Observação')).toBeNull();
    fireEvent.click(mais);
    expect(mais.getAttribute('aria-expanded')).toBe('true');
    expect(within(form).getByText('Observação')).toBeTruthy();
    expect(within(form).getByText('Referência externa')).toBeTruthy();
    const tanqueCheio = within(form).getByTestId('abastecimento-tanque-cheio');
    expect(radios(tanqueCheio)).toEqual([['Sim', 'false'], ['Não', 'true']]);
    // O campo de quantidade tem nome acessível com a unidade do Produto.
    expect(within(form).getByLabelText(/^Quantidade abastecida \(L\)/)).toBe(within(form).getByTestId('abastecimento-quantidade'));
    // 390 px: nada de largura mínima fixa, nowrap ou rolagem horizontal no formulário.
    for (const el of [form, ...form.querySelectorAll('*')]) {
      const cls = String(el.getAttribute('class') ?? '');
      expect(cls, cls).not.toMatch(/(^|\s)(whitespace-nowrap|overflow-x-auto|w-screen)(\s|$)|min-w-\[|(^|\s)w-\[\d{3,}px\]/);
    }
    digitar(form, 'abastecimento-quantidade', '10');
    digitar(form, 'abastecimento-leitura', '1.560');
    const dialogo = await pedirPrevia(form);
    const detalhes = within(dialogo).getByTestId('previa-detalhes-estoque');
    expect(detalhes.tagName).toBe('BUTTON');
    expect(detalhes.getAttribute('aria-expanded')).toBe('false');
    for (const el of [...within(dialogo).getByTestId('previa-dados').querySelectorAll('*')]) {
      const cls = String(el.getAttribute('class') ?? '');
      expect(cls, cls).not.toMatch(/(^|\s)(whitespace-nowrap|w-screen)(\s|$)|min-w-\[|(^|\s)w-\[\d{3,}px\]/);
    }
  });

  it('"Mais detalhes" abre sozinho quando um campo dele tem erro; fechar só esconde (o conteúdo vai no corpo)', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const mais = within(form).getByTestId('abastecimento-mais-detalhes');
    fireEvent.click(mais);
    const obs = within(form).getByText('Observação').closest('.mg-field')?.querySelector('textarea') ?? within(form).getAllByRole('textbox').find((t) => t.tagName === 'TEXTAREA');
    fireEvent.change(obs, { target: { value: 'x'.repeat(501) } });
    fireEvent.click(mais);
    expect(mais.getAttribute('aria-expanded')).toBe('false');
    expect(within(form).queryByText('Observação')).toBeNull();
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('No máximo 500 caracteres.')).toBeTruthy();
    expect(within(form).getByTestId('abastecimento-mais-detalhes').getAttribute('aria-expanded')).toBe('true');
    expect(previas()).toEqual([]);
    fireEvent.change(within(form).getAllByRole('textbox').find((t) => t.tagName === 'TEXTAREA'), { target: { value: 'completou na sede' } });
    fireEvent.click(within(form).getByTestId('abastecimento-mais-detalhes'));
    expect(within(form).queryByText('Observação')).toBeNull();
    await pedirPrevia(form);
    expect(previas()[0].body.observacao).toBe('completou na sede');
  });
});

describe('UX-02 revisão final (revista pela D-PROD-162) — formulário', () => {
  /** Guarda o corpo de cada resposta da prévia (`rotear(req)` decide a resposta; `null` = fake normal). */
  const registrarPrevias = (rotear = (req) => rotearAbastecimentos(amb.estado, req)) => {
    const respostas = [];
    amb.falhar = (req) => {
      if (req.method !== 'POST' || req.path !== '/patrimonio-abastecimentos-previa') return null;
      return Promise.resolve(rotear(req)).then((r) => {
        respostas.push(r.body);
        return r;
      });
    };
    return respostas;
  };
  const codigosDe = (resposta) => (resposta?.bloqueios ?? []).map((b) => `${b.code}:${b.reason}`);

  it('F1: aceite trocado A→B ANTES de "Revisar": o bloqueio da revisão (200, nao_aceito_pelo_tanque) relê os Produtos do bem; A sai com aviso, B é oferecido e nada de A é confirmado', async () => {
    const respostas = registrarPrevias();
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    expect(produtosDoBem()).toHaveLength(1);
    // Antes de revisar: o tanque deixa de aceitar A e passa a aceitar B (cadastro de Bens).
    acrescentarProduto(amb.estado, 'p4', 'Diesel S10 estoque novo');
    aceitesDoTrator(['p4']);
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    await waitFor(() => expect(respostas).toHaveLength(1));
    expect(previas()[0].body.produto_id).toBe('p1');
    expect(codigosDe(respostas[0])).toEqual(['ABASTECIMENTO_PRODUTO_NAO_ACEITO:nao_aceito_pelo_tanque']);
    // A revisão responde 200 COM o bloqueio: a tela relê os Produtos do bem e a reconciliação tira A.
    expect(await within(form).findByTestId('abastecimento-produto-indisponivel')).toHaveTextContent('O Produto escolhido deixou de estar disponível para este bem. Escolha de novo.');
    expect(produtosDoBem().length).toBeGreaterThan(1);
    await waitFor(() => expect(screen.queryByTestId('dialogo-previa-abastecimento')).toBeNull());
    // Mesmo resultado do caminho do 422 (UX-A10): B oferecido, nada trocado em silêncio.
    expect(radios(within(form).getByTestId('abastecimento-produto'))).toEqual([['Diesel S10 estoque novo', 'false']]);
    expect(confirmacoes()).toEqual([]);
    await escolherProduto(form, 'Diesel S10 estoque novo');
    expect(within(form).queryByTestId('abastecimento-produto-indisponivel')).toBeNull();
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    const dialogoB = await pedirPrevia(form);
    expect(previas().at(-1).body).toMatchObject({ produto_id: 'p4', tanque_id: 'tq1', quantidade: '80' });
    expect(within(dialogoB).getByTestId('previa-baixa')).toHaveTextContent('80,0000 L');
    await act(async () => fireEvent.click(within(dialogoB).getByTestId('abastecimento-confirmar')));
    expect(await screen.findByTestId('abastecimento-consulta')).toBeTruthy();
    expect(confirmacoes()).toHaveLength(1);
    expect(confirmacoes()[0].body).toMatchObject({ produto_id: 'p4' });
    expect(amb.estado.abastecimentos.map((a) => a.produto_id)).toEqual(['p4']);
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['50.0000', '100.0000']);
  });

  it('F1: tanque inativado ANTES de "Revisar" (200, ABASTECIMENTO_TANQUE_INVALIDO) também relê: a opção velha sai e o motivo aparece', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    amb.estado.tanques.b1[0].ativo = false;
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    await waitFor(() => expect(previas()).toHaveLength(1));
    expect(await within(form).findByTestId('abastecimento-produto-indisponivel')).toBeTruthy();
    expect(within(form).getByTestId('abastecimento-sem-produto')).toHaveTextContent('Este bem não tem tanque ativo. Cadastre ou reative um tanque no cadastro do bem.');
    expect(within(form).queryByRole('radio', { name: 'Diesel S10 granel' })).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('dialogo-previa-abastecimento')).toBeNull());
    expect(confirmacoes()).toEqual([]);
  });

  it('F2: escolher de novo a MESMA máquina não desmarca o único Produto nem limpa local e leitura; Revisar segue com o corpo de antes', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await esperar(50);
    expect(radios(within(form).getByTestId('abastecimento-produto'))).toEqual([['Diesel S10 granel', 'true']]);
    expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Sai do estoque: Tanque diesel sede');
    await pedirPrevia(form);
    expect(previas()).toHaveLength(1);
    expect(previas()[0].body).toEqual(CORPO_TP02(amb.estado.hoje));
  });

  it('F1: o tanque passa a aceitar só a Gasolina ANTES de "Revisar" (200, nao_aceito_pelo_tanque) relê uma vez: A sai com aviso e o Produto velho não é revisado de novo nem confirmado', async () => {
    const respostas = registrarPrevias();
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    expect(produtosDoBem()).toHaveLength(1);
    aceitesDoTrator(['p2']);
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    await waitFor(() => expect(respostas).toHaveLength(1));
    expect(previas()[0].body).toMatchObject({ produto_id: 'p1', tanque_id: 'tq1' });
    expect(codigosDe(respostas[0])).toEqual(['ABASTECIMENTO_PRODUTO_NAO_ACEITO:nao_aceito_pelo_tanque']);
    expect(await within(form).findByTestId('abastecimento-produto-indisponivel')).toHaveTextContent('O Produto escolhido deixou de estar disponível para este bem. Escolha de novo.');
    await waitFor(() => expect(screen.queryByTestId('dialogo-previa-abastecimento')).toBeNull());
    expect(within(form).queryByRole('radio', { name: 'Diesel S10 granel' })).toBeNull();
    // O servidor só oferece o que o tanque aceita agora (a Gasolina): a escolha que SAIU não é trocada em
    // silêncio por outra — nem pela opção única —, o operador escolhe de novo.
    expect(radios(within(form).getByTestId('abastecimento-produto'))).toEqual([['Gasolina comum', 'false']]);
    // Uma releitura só: sem laço, nada mais é lido nem revisado sozinho.
    expect(produtosDoBem()).toHaveLength(2);
    await esperar(200);
    expect(produtosDoBem()).toHaveLength(2);
    expect(previas()).toHaveLength(1);
    expect(confirmacoes()).toEqual([]);
    expect(amb.estado.abastecimentos).toEqual([]);
  });

  it('F1: o tanque deixa de aceitar o Diesel DEPOIS de "Revisar" (422 ABASTECIMENTO_PRODUTO_NAO_ACEITO na confirmação) relê do mesmo jeito; nada é gravado', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    expect(produtosDoBem()).toHaveLength(1);
    aceitesDoTrator([]);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    expect(confirmacoes()).toHaveLength(1);
    expect(confirmacoes()[0].body).toMatchObject({ produto_id: 'p1', tanque_id: 'tq1' });
    expect(await within(form).findByTestId('abastecimento-produto-indisponivel')).toHaveTextContent('O Produto escolhido deixou de estar disponível para este bem. Escolha de novo.');
    await waitFor(() => expect(screen.queryByTestId('dialogo-previa-abastecimento')).toBeNull());
    expect(within(form).getByTestId('abastecimento-sem-produto')).toHaveTextContent('Os tanques deste bem não têm Produto aceito.');
    expect(produtosDoBem()).toHaveLength(2);
    await esperar(200);
    expect(produtosDoBem()).toHaveLength(2);
    expect(confirmacoes()).toHaveLength(1);
    expect(amb.estado.abastecimentos).toEqual([]);
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['50.0000', '100.0000']);
  });

  it('a unidade do Produto muda de L para KG ANTES de "Revisar" (sem bloqueio): a revisão mostra kg e a dica, e o formulário relê a opção (rótulo "(kg)")', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    expect(produtosDoBem()).toHaveLength(1);
    amb.estado.produtos.find((p) => p.id === 'p1').unidade_principal_estoque = 'KG';
    const dialogo = await pedirPrevia(form);
    expect(within(dialogo).queryByTestId('previa-bloqueios')).toBeNull();
    expect(within(dialogo).getByTestId('previa-baixa')).toHaveTextContent('80,0000 kg');
    expect(within(dialogo).getByTestId('previa-dica-kg')).toBeTruthy();
    await waitFor(() => expect(produtosDoBem()).toHaveLength(2));
    await waitFor(() => expect(within(form).getByText('Quantidade abastecida (kg)')).toBeTruthy());
    expect(within(form).getByTestId('abastecimento-dica-kg')).toBeTruthy();
    // A unidade não faz parte do que a revisão viu (o número e o Produto são os mesmos): ela continua válida.
    expect(within(form).queryByTestId('abastecimento-previa-invalidada')).toBeNull();
  });

  it('F1: o estoque do Produto sai de L/KG/SACO ANTES de "Revisar" (200, ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL) relê uma vez: A sai e aparece o motivo do servidor; nada é confirmado', async () => {
    const respostas = registrarPrevias();
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    expect(produtosDoBem()).toHaveLength(1);
    // Antes de revisar: a unidade de estoque do Produto passa a uma fora de L/KG/SACO (legada).
    amb.estado.produtos.find((p) => p.id === 'p1').unidade_principal_estoque = 'UN';
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    await waitFor(() => expect(respostas).toHaveLength(1));
    expect(previas()[0].body).toMatchObject({ produto_id: 'p1', tanque_id: 'tq1' });
    expect(codigosDe(respostas[0])).toEqual(['ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL:unidade_nao_aceita']);
    expect(await within(form).findByTestId('abastecimento-produto-indisponivel')).toHaveTextContent('O Produto escolhido deixou de estar disponível para este bem. Escolha de novo.');
    await waitFor(() => expect(screen.queryByTestId('dialogo-previa-abastecimento')).toBeNull());
    expect(within(form).getByTestId('abastecimento-sem-produto')).toHaveTextContent('O Produto aceito não tem estoque em litros (L), quilos (KG) nem sacos (SACO): o abastecimento não é possível.');
    expect(within(form).queryByRole('radio', { name: 'Diesel S10 granel' })).toBeNull();
    expect(produtosDoBem()).toHaveLength(2);
    await esperar(200);
    expect(produtosDoBem()).toHaveLength(2);
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    await esperar(50);
    expect(previas()).toHaveLength(1);
    expect(produtosDoBem()).toHaveLength(2);
    expect(confirmacoes()).toEqual([]);
    expect(amb.estado.abastecimentos).toEqual([]);
  });
});
