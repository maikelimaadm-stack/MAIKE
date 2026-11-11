/**
 * D-PROD-159, simplificada pela D-PROD-162 — tela Abastecimentos montada de
 * verdade (página, motor Base1, service, API, porta e nativeHttpClient reais)
 * sobre o backend falso `abastecimentosFakeCore` (códigos/field/reason reais,
 * decimais como texto, idempotência por `operation_id`). Mocks só da borda:
 * sessão e o refresh do cache do Mapa.
 *
 *  FE1 estados: sem empresa (nada lido), carregando, sem `ver`, sem fuso, vazio,
 *      erro; nenhum botão de "Fatores kg/L";
 *  FE2 lista: filtros com a query EXATA de A1, "Carregar mais" (cursor),
 *      detalhe (quantidade + unidade, custo por L), totais por unidade;
 *  FE3 formulário: máquina → PRODUTO (dos Produtos aceitos do tanque) → local;
 *      flex; trocar o bem limpa os dependentes; leitura só em contador; texto
 *      pt-BR; "Quantidade abastecida (L)";
 *  FE4 revisão (prévia sem comando): resumo humano + baixa EXATA em L; FIFO e
 *      custo "estimativa" em "Detalhes do estoque"; valor acima do teto e
 *      saldo insuficiente com a unidade; mudar campo invalida a revisão;
 *  FE5 confirmação: corpo EXATO de A4 (sem fator nem tipo), duplo clique = 1
 *      POST, 504 → incerto e repetir com o MESMO operation_id, "Consultar" por
 *      operation_id, IDEMPOTENCY_CONFLICT, replay, invalidação de estoque/Mapa/bem;
 *  consumo L/h, kg/h e "unidades misturadas"; permissões negadas por padrão.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { erroServidor, escolherOpcao } from './fixtures/gestaoBackendFake.js';
import { acrescentarProduto, semearAbastecimento } from './fixtures/abastecimentosFakeCore.js';
import { abrirDetalhesDoEstoque, abrirNovo, chamadasDe, digitar, escolherNoSeletor, escolherProduto, esperarProdutoMarcado, montar, pedirPrevia, permissaoCom, preencherTrator, prepararAmbiente } from './fixtures/abastecimentosTela.jsx';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1', pendente: false }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(() => (sessao.pendente ? new Promise(() => {}) : Promise.resolve(sessao.permissao))),
}));
vi.mock('@/services/mapaCacheService', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshMapaCacheEntry: vi.fn(async () => []),
}));

const CHAVE_PENDENTE = 'maike_lancamento_pendente:abastecimento:cli-1:operador:criar:emp-1:novo';

let amb;

beforeEach(async () => {
  sessao.permissao = permissaoCom({ novo: true });
  sessao.pendente = false;
  amb = await prepararAmbiente(vi);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const listagens = () => chamadasDe(amb.backend, 'GET', '/patrimonio-abastecimentos');
const confirmacoes = () => chamadasDe(amb.backend, 'POST', '/patrimonio-abastecimentos');
const previas = () => chamadasDe(amb.backend, 'POST', '/patrimonio-abastecimentos-previa');
const esperar = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const semearTrator = (extra = {}) =>
  semearAbastecimento(amb.estado, {
    bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1',
    data_operacional: '2026-06-10', quantidade: '10', medidor_leitura: '1530.5', tanque_cheio: false, ...extra,
  });
/** Produto em KG aceito pelo tanque do trator (500 kg no local l1). */
const aceitarKgNoTrator = () => acrescentarProduto(amb.estado, 'p6', 'Diesel pesado (kg)', { unidade: 'KG', lote: '500.0000', custo: '4.0000', tanques: [['b1', 'tq1']] });

describe('FE1 — estados da tela', () => {
  it('sem empresa real: aviso e nada é lido (nem Novo; o botão "Fatores kg/L" não existe mais)', async () => {
    window.localStorage.setItem('empresa_selecionada_id', 'cli-1');
    await montar();
    expect(await screen.findByTestId('abastecimento-sem-empresa')).toHaveTextContent('Selecione uma fazenda para ver e lançar abastecimentos.');
    await esperar();
    expect(amb.backend.chamadas.filter((c) => c.path.startsWith('/patrimonio-'))).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Novo abastecimento' })).toBeNull();
    expect(screen.queryByTestId('abastecimento-fatores')).toBeNull();
  });

  it('permissão ainda carregando: aviso próprio e nenhuma listagem', async () => {
    sessao.pendente = true;
    await montar();
    expect(await screen.findByTestId('abastecimento-carregando')).toBeTruthy();
    await esperar();
    expect(listagens()).toEqual([]);
  });

  it('sem a linha pat-abastecimentos (negado por padrão): sem lista, sem Novo', async () => {
    sessao.permissao = { user_email: 'operador', modulos_permitidos: ['patrimonio'], permissoes_telas: [{ tela_id: 'pat-bens-patrimoniais', visualizar: true, novo: true, salvar: true, editar: true, inativar: true }] };
    await montar();
    expect(await screen.findByTestId('abastecimento-sem-permissao')).toHaveTextContent('Você não tem permissão para ver os abastecimentos desta fazenda.');
    await esperar();
    expect(listagens()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Novo abastecimento' })).toBeNull();
    expect(screen.queryByTestId('abastecimento-fatores')).toBeNull();
  });

  it('só visualizar: lista, mas sem Novo', async () => {
    sessao.permissao = permissaoCom({});
    await semearTrator();
    await montar();
    expect(await screen.findByTestId('abastecimento-bem-ab-1')).toHaveTextContent('TP-02 — Trator TP-02');
    expect(screen.queryByRole('button', { name: 'Novo abastecimento' })).toBeNull();
  });

  it('fazenda sem fuso: aviso e Novo indisponível', async () => {
    amb.estado.fuso = null;
    await montar();
    expect(await screen.findByTestId('abastecimento-sem-fuso')).toHaveTextContent('Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de lançar abastecimentos.');
    expect(screen.queryByRole('button', { name: 'Novo abastecimento' })).toBeNull();
  });

  it('lista vazia com aviso; erro de lista com "Tentar novamente" que relê', async () => {
    await montar();
    expect(await screen.findByTestId('abastecimento-lista-vazia')).toHaveTextContent('Nenhum abastecimento encontrado com estes filtros.');
    cleanup();
    amb.falhar = (req) => (req.method === 'GET' && req.path === '/patrimonio-abastecimentos' ? erroServidor(500, 'INTERNAL_ERROR') : null);
    await montar();
    const tentar = await screen.findByRole('button', { name: 'Tentar novamente' });
    amb.falhar = null;
    await semearTrator();
    fireEvent.click(tentar);
    expect(await screen.findByTestId('abastecimento-bem-ab-1')).toBeTruthy();
  });
});

describe('FE2 — lista, filtros e detalhe', () => {
  it('filtros mandam a query EXATA de A1 e "Carregar mais" segue o cursor', async () => {
    await semearTrator({ data_operacional: '2026-06-05', medidor_leitura: '1525.0' });
    await semearTrator({ data_operacional: '2026-06-08', medidor_leitura: '1530.0' });
    await semearTrator({ data_operacional: '2026-06-10', medidor_leitura: '1535.0' });
    amb.estado.paginaLista = 2;
    await montar();
    await screen.findByTestId('abastecimento-bem-ab-3');
    expect(screen.queryByTestId('abastecimento-bem-ab-1')).toBeNull();
    expect(listagens()[0].query).toEqual({ empresa_id: 'emp-1', limit: expect.any(String) });
    const [carregarMais] = await screen.findAllByLabelText('Carregar mais registros');
    await act(async () => fireEvent.click(carregarMais));
    expect(await screen.findByTestId('abastecimento-bem-ab-1')).toBeTruthy();
    expect(listagens().at(-1).query.cursor).toBe('2');

    amb.estado.paginaLista = null;
    const filtros = screen.getByTestId('abastecimento-filtros');
    await escolherNoSeletor(filtros, 'abastecimento-filtro-bem', /Trator TP-02/);
    fireEvent.change(within(filtros).getByTestId('abastecimento-filtro-de'), { target: { value: '2026-06-06' } });
    fireEvent.change(within(filtros).getByTestId('abastecimento-filtro-ate'), { target: { value: '2026-06-30' } });
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação' }), 'Confirmados');
    await waitFor(() =>
      expect(listagens().at(-1).query).toEqual({ empresa_id: 'emp-1', bem_id: 'b1', status: 'CONFIRMADO', data_de: '2026-06-06', data_ate: '2026-06-30', limit: expect.any(String) }),
    );
    await waitFor(() => expect(screen.queryByTestId('abastecimento-bem-ab-1')).toBeNull());
    expect(screen.getByTestId('abastecimento-bem-ab-2')).toBeTruthy();
    // Período invertido: a tela avisa e não pede a lista ao servidor.
    const antes = listagens().length;
    fireEvent.change(within(screen.getByTestId('abastecimento-filtros')).getByTestId('abastecimento-filtro-de'), { target: { value: '2026-07-10' } });
    expect(await screen.findByTestId('abastecimento-periodo-invertido')).toBeTruthy();
    await esperar();
    expect(listagens().length).toBe(antes);
  });

  it('abre o DETALHE com empresa_id: quantidade + unidade, custo FIFO por L, lotes, movimento e leitura; sem tipo nem fator', async () => {
    await semearTrator({ quantidade: '80', medidor_leitura: '1550.5', tanque_cheio: true });
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-1'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(chamadasDe(amb.backend, 'GET', '/patrimonio-abastecimentos/ab-1')[0].query).toEqual({ empresa_id: 'emp-1' });
    expect(within(consulta).getByTestId('consulta-quantidade')).toHaveTextContent('80,0000 L');
    // 50 L × 5,20 + 30 L × 5,50 = 425,00 → 5,3125 por litro.
    expect(within(consulta).getByTestId('consulta-custo').textContent).toMatch(/R\$\s425,00 \(R\$\s5,3125\/L\)/);
    const fatias = within(consulta).getByTestId('consulta-fatias');
    expect(within(fatias).getAllByRole('row')).toHaveLength(3);
    expect(within(fatias).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Ordem', 'Lote de', 'Quantidade (L)', 'Custo/L', 'Valor']);
    expect(within(consulta).getByTestId('consulta-movimento')).toHaveTextContent(/Saída de estoque nº 41/);
    expect(within(consulta).getByTestId('consulta-movimento').textContent).toMatch(/80,0000 L × R\$\s5,3125\/L = R\$\s425,00/);
    for (const id of ['consulta-tipo', 'consulta-fator', 'consulta-kg', 'consulta-litros']) expect(within(consulta).queryByTestId(id)).toBeNull();
    expect(consulta).not.toHaveTextContent(/kg\/L|Tipo de combustível|Fator/);
    expect(within(consulta).getByTestId('consulta-leitura')).toHaveTextContent('1.550,5 h');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('Dados insuficientes');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('não há abastecimento anterior com tanque cheio neste tanque');
    // Sem a ação `cancelar`: o botão não existe.
    expect(within(consulta).queryByTestId('abastecimento-cancelar')).toBeNull();
  });

  it('totais da lista sem float e POR UNIDADE: 0,1 L + 0,2 L = 0,3000 L; os quilos à parte (nunca se somam com litros)', async () => {
    aceitarKgNoTrator();
    await semearTrator({ quantidade: '0.1', medidor_leitura: '1525.0' });
    await semearTrator({ quantidade: '0.2', medidor_leitura: '1526.0' });
    await semearTrator({ produto_id: 'p6', quantidade: '45.5', medidor_leitura: '1527.0' });
    await montar();
    expect(await screen.findByTestId('abastecimento-totais')).toHaveTextContent('Confirmados na lista: 3 · 0,3000 L · 45,5000 kg');
    // A coluna Quantidade mostra o número com a unidade de CADA abastecimento.
    expect(screen.getByTestId('abastecimento-bem-ab-3').closest('tr')).toHaveTextContent('45,5000 kg');
    expect(screen.getByTestId('abastecimento-bem-ab-1').closest('tr')).toHaveTextContent('0,1000 L');
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe('FE3 — formulário', () => {
  it('máquina → Produto (único aceito: já marcado) → local automático; sem etapa de combustível; trocar o bem limpa os dependentes', async () => {
    await montar();
    const form = await abrirNovo();
    // Sem máquina não há escolha de Produto; sem Produto a quantidade não tem unidade.
    expect(within(form).queryByTestId('abastecimento-produto')).toBeNull();
    expect(within(form).getByText('Quantidade abastecida')).toBeTruthy();
    await preencherTrator(form, { tanqueCheio: false });
    // A unidade do Produto (L) no rótulo; Produto em L não tem a dica de quilos.
    expect(within(form).getByText('Quantidade abastecida (L)')).toBeTruthy();
    expect(within(form).queryByTestId('abastecimento-dica-kg')).toBeNull();
    expect(within(form).getByTestId('abastecimento-ultima-leitura')).toHaveTextContent('Última leitura: 1.520,5 h em 01/06/2026 (cadastro do bem)');
    // O tipo de combustível NUNCA é etapa nem rótulo do formulário.
    expect(within(form).queryByTestId('abastecimento-combustivel')).toBeNull();
    expect(within(form).queryByRole('radio', { name: 'Diesel S10' })).toBeNull();
    expect(within(form).queryByText('Diesel S10', { exact: true })).toBeNull();
    expect(within(form).queryByText(/^Combustível$/)).toBeNull();
    // Local único: sem lotes, KG nem FIFO na etapa principal.
    expect(within(form).getByTestId('abastecimento-local-auto')).not.toHaveTextContent(/kg|lote/i);
    expect(chamadasDe(amb.backend, 'GET', '/patrimonio-abastecimentos-opcoes/produtos-do-bem')[0].query).toEqual({ empresa_id: 'emp-1', bem_id: 'b1', limit: '100' });
    // Troca para o flex: Produto/local/leitura somem; os dois Produtos do flex, nenhum marcado.
    await escolherNoSeletor(form, 'abastecimento-bem', /Caminhonete flex/);
    const grupo = await within(form).findByTestId('abastecimento-produto');
    expect(within(grupo).getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['Etanol hidratado', 'false'],
      ['Gasolina comum', 'false'],
    ]);
    expect(within(form).queryByTestId('abastecimento-local-auto')).toBeNull();
    expect(within(form).getByTestId('abastecimento-leitura')).toHaveValue('');
    expect(within(form).getByText('Odômetro (km)')).toBeTruthy();
    await escolherProduto(form, 'Etanol hidratado');
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Sai do estoque: Posto da fazenda'));
    expect(chamadasDe(amb.backend, 'GET', '/patrimonio-abastecimentos-opcoes/produtos-do-bem').at(-1).query).toEqual({ empresa_id: 'emp-1', bem_id: 'b2', limit: '100' });
    // As leituras antigas (tanque → combustível → produtos do tipo) e os fatores não são usados pelo formulário.
    for (const rota of ['tanques', 'tipos', 'produtos']) expect(chamadasDe(amb.backend, 'GET', `/patrimonio-abastecimentos-opcoes/${rota}`)).toEqual([]);
    expect(amb.backend.chamadas.filter((c) => c.path.startsWith('/patrimonio-conversoes'))).toEqual([]);
  });

  it('bem sem medidor não pede leitura e o corpo leva medidor_leitura null; quantidade em texto pt-BR (0,1 → "0.1")', async () => {
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Gerador/);
    await esperarProdutoMarcado(form, 'Diesel S10 granel');
    expect(within(form).queryByTestId('abastecimento-leitura')).toBeNull();
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    digitar(form, 'abastecimento-quantidade', '0,1');
    await pedirPrevia(form);
    expect(previas()[0].body).toEqual({
      empresa_id: 'emp-1', bem_id: 'b3', tanque_id: 'tq3', produto_id: 'p1', local_estoque_id: 'l1',
      data_operacional: amb.estado.hoje, quantidade: '0.1', medidor_leitura: null, tanque_cheio: false, observacao: null, referencia_externa: null,
    });
  });

  it('validação local antes da revisão: obrigatórios, leitura do contador, litros acima da capacidade (Produto em L) — nada é enviado', async () => {
    await montar();
    const form = await abrirNovo();
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Escolha a máquina ou veículo.')).toBeTruthy();
    expect(within(form).getByText('Informe a quantidade abastecida.')).toBeTruthy();
    await preencherTrator(form, { quantidade: '180,0001', leitura: null });
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Os litros passam da capacidade nominal do tanque.')).toBeTruthy();
    expect(within(form).getByText('Informe a leitura do medidor.')).toBeTruthy();
    expect((await screen.findAllByText('Revise os campos destacados.')).length).toBeGreaterThan(0);
    expect(previas()).toEqual([]);
  });
});

describe('FE4 — revisão (prévia)', () => {
  it('revisão SEM comando: resumo humano e baixa EXATA em L; FIFO e custo "estimativa" em Detalhes do estoque; mudar campo invalida', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    expect(confirmacoes()).toEqual([]);
    expect(previas()).toHaveLength(1);
    expect(within(dialogo).getByRole('heading', { name: 'Revisar abastecimento' })).toBeTruthy();
    expect(within(dialogo).getByTestId('previa-resumo')).toHaveTextContent('TP-02 — Trator TP-02 · Diesel S10 granel · 80 L. Baixa de 80,0000 L do estoque em Tanque diesel sede.');
    expect(within(dialogo).getByTestId('previa-baixa')).toHaveTextContent('80,0000 L');
    expect(within(dialogo).queryByTestId('previa-dica-kg')).toBeNull();
    const detalhes = abrirDetalhesDoEstoque(dialogo);
    expect(within(detalhes).getByTestId('previa-capacidade')).toHaveTextContent('conferida (Produto em litros)');
    expect(within(detalhes).getByTestId('previa-custo')).toHaveTextContent(/R\$\s425,00 \(R\$\s5,3125\/L\)/);
    expect(within(detalhes).getByTestId('previa-custo')).toHaveTextContent('estimativa; o custo final é calculado na confirmação');
    expect(within(detalhes).getByTestId('previa-saldo')).toHaveTextContent('150,0000 L');
    const linhas = within(within(detalhes).getByTestId('previa-fatias')).getAllByRole('row');
    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringMatching(/Lote de.*Quantidade \(L\).*Custo\/L.*Valor/),
      expect.stringMatching(/01\/06\/2026.*50,0000.*5,20.*260,00/),
      expect.stringMatching(/03\/06\/2026.*30,0000.*5,50.*165,00/),
    ]);
    expect(dialogo).not.toHaveTextContent(/kg\/L|Fator|Tipo de combustível/);
    expect(within(dialogo).getByTestId('abastecimento-confirmar')).toHaveTextContent('Confirmar abastecimento');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-previa-abastecimento')).toBeNull());
    expect(within(form).getByTestId('abastecimento-reabrir-previa')).toHaveTextContent('Voltar à revisão');
    digitar(form, 'abastecimento-quantidade', '81');
    expect(await within(form).findByTestId('abastecimento-previa-invalidada')).toHaveTextContent('Os dados mudaram desde a revisão: revise de novo antes de confirmar.');
    expect(within(form).queryByTestId('abastecimento-reabrir-previa')).toBeNull();
  });

  it('valor acima do teto do estoque (bloqueio de quantidade do servidor): a revisão não mostra a quantidade como baixa', async () => {
    amb.estado.lotes.find((l) => l.id === 'lote-A').custo = '9999999999.0000';
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form, { quantidade: '2', tanqueCheio: false });
    const dialogo = await pedirPrevia(form);
    expect(within(dialogo).getByTestId('previa-bloqueios').querySelector('[data-codigo="OPERACAO_VALORES_INVALIDOS"]')).toBeTruthy();
    expect(within(dialogo).getByTestId('previa-resumo')).toHaveTextContent('Nada foi gravado: confira abaixo o que impede a confirmação.');
    expect(within(dialogo).getByTestId('previa-resumo')).not.toHaveTextContent(/Baixa de/);
    expect(within(dialogo).getByTestId('previa-baixa')).toHaveTextContent(/^—$/);
    // O que foi digitado continua à vista, na unidade do Produto.
    expect(within(dialogo).getByTestId('previa-quantidade')).toHaveTextContent('2 L');
    expect(within(dialogo).queryByTestId('abastecimento-confirmar')).toBeNull();
  });

  it('saldo insuficiente: bloqueio legível na unidade do Produto (L), sem Confirmar; a baixa pedida continua visível', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form, { quantidade: '160', tanqueCheio: false });
    const dialogo = await pedirPrevia(form);
    const bloqueios = within(dialogo).getByTestId('previa-bloqueios');
    expect(bloqueios).toHaveTextContent('Saldo insuficiente deste Produto neste local: disponível 150 L, pedido 160 L.');
    expect(bloqueios).not.toHaveTextContent('Nada foi gravado');
    expect(within(dialogo).getByTestId('previa-baixa')).toHaveTextContent('160,0000 L');
    expect(within(dialogo).queryByTestId('abastecimento-confirmar')).toBeNull();
  });
});

describe('FE5 — confirmação idempotente', () => {
  it('corpo EXATO de A4; duplo clique = 1 POST; toast; abre a consulta; invalida estoque, Mapa e bem', async () => {
    const { refreshMapaCacheEntry } = await import('@/services/mapaCacheService');
    const eventos = [];
    const ouvir = (ev) => eventos.push(ev.detail);
    window.addEventListener('atualizar-mapa', ouvir);
    let soltar;
    amb.estado.atraso = new Promise((r) => {
      soltar = r;
    });
    const qc = await montar();
    qc.setQueryData(['bens-patrimoniais', 'detalhe', 'emp-1', 'b1'], { id: 'b1', versao: 4 });
    qc.setQueryData(['saldo-deposito', 'emp-1'], []);
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    const botao = within(dialogo).getByTestId('abastecimento-confirmar');
    await act(async () => {
      fireEvent.click(botao);
      fireEvent.click(botao);
    });
    expect(botao).toBeDisabled();
    expect(botao).toHaveTextContent('Confirmando…');
    await act(async () => {
      soltar();
      amb.estado.atraso = null;
    });
    expect(await screen.findByTestId('abastecimento-consulta')).toBeTruthy();
    expect(confirmacoes()).toHaveLength(1);
    expect(confirmacoes()[0].body).toEqual({
      empresa_id: 'emp-1', bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1',
      data_operacional: amb.estado.hoje, quantidade: '80', medidor_leitura: '1550.5', tanque_cheio: true, observacao: null, referencia_externa: null,
      operation_id: expect.stringMatching(/^lanc-[A-Za-z0-9_.:-]{8,123}$/),
    });
    expect(await screen.findByText('Abastecimento nº 1 confirmado: 80,0000 L baixados do estoque.')).toBeTruthy();
    expect(screen.getByTestId('consulta-quantidade')).toHaveTextContent('80,0000 L');
    expect(refreshMapaCacheEntry).toHaveBeenCalledWith('estoqueLotes', 'emp-1', { force: true });
    expect(refreshMapaCacheEntry).toHaveBeenCalledWith('movimentacaoEstoque', 'emp-1', { force: true });
    expect(eventos).toEqual([{ cacheKeys: ['estoqueLotes'] }]);
    // Detalhe do bem (leitura do medidor) e consultas de estoque das telas antigas invalidados.
    expect(qc.getQueryState(['bens-patrimoniais', 'detalhe', 'emp-1', 'b1']).isInvalidated).toBe(true);
    expect(qc.getQueryState(['saldo-deposito', 'emp-1']).isInvalidated).toBe(true);
    expect(window.localStorage.getItem(CHAVE_PENDENTE)).toBeNull();
    // Estoque baixado EXATAMENTE em 80 L pelos lotes (FIFO: 50 do A + 30 do B), sem conversão.
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['0.0000', '70.0000']);
    expect(amb.estado.produtos.find((p) => p.id === 'p1').estoque_atual).toBe('70.0000');
    window.removeEventListener('atualizar-mapa', ouvir);
  });

  it('504 = resultado incerto (nunca sucesso); "Repetir o mesmo envio" reaproveita o operation_id e vira replay', async () => {
    amb.estado.proxima = 'gravar-e-perder';
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    expect(await within(dialogo).findByTestId('resultado-incerto')).toHaveTextContent('Resultado incerto');
    expect(screen.queryByText(/confirmado:/)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(CHAVE_PENDENTE)).operation_id).toBe(confirmacoes()[0].body.operation_id);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-repetir-envio')));
    expect(await screen.findByText('Abastecimento nº 1 confirmado: 80,0000 L baixados do estoque. (envio repetido: nada foi duplicado)')).toBeTruthy();
    expect(confirmacoes()).toHaveLength(2);
    expect(confirmacoes()[1].body.operation_id).toBe(confirmacoes()[0].body.operation_id);
    expect(amb.estado.abastecimentos).toHaveLength(1);
  });

  it('"Consultar" depois do incerto procura pelo operation_id: achou → abre; não achou → pode repetir', async () => {
    amb.estado.proxima = { status: 504, body: { message: 'gateway timeout' } };
    await montar();
    let form = await abrirNovo();
    await preencherTrator(form);
    let dialogo = await pedirPrevia(form);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    await within(dialogo).findByTestId('resultado-incerto');
    const chave = confirmacoes()[0].body.operation_id;
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-consultar-resultado')));
    expect(await within(dialogo).findByTestId('consulta-resultado')).toHaveTextContent('O envio não foi gravado. Você pode repetir o mesmo envio.');
    expect(listagens().at(-1).query).toMatchObject({ empresa_id: 'emp-1', operation_id: chave });
    // A pendência continua: o próximo envio repete a MESMA chave e grava.
    amb.estado.proxima = 'gravar-e-perder';
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-repetir-envio')));
    await within(dialogo).findByTestId('resultado-incerto');
    expect(confirmacoes()[1].body.operation_id).toBe(chave);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-consultar-resultado')));
    expect(await screen.findByTestId('abastecimento-consulta')).toBeTruthy();
    expect(window.localStorage.getItem(CHAVE_PENDENTE)).toBeNull();
    expect(confirmacoes()).toHaveLength(2);
  });

  it('FE-02: "Consultar" acha o envio mas o detalhe falha → a pendência FICA e repetir manda a MESMA chave (replay; o estoque não é baixado duas vezes)', async () => {
    amb.estado.proxima = 'gravar-e-perder';
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    await within(dialogo).findByTestId('resultado-incerto');
    const chave = confirmacoes()[0].body.operation_id;
    let falhou = false;
    amb.falhar = (req) => {
      if (!falhou && req.method === 'GET' && /^\/patrimonio-abastecimentos\/ab-/.test(req.path)) {
        falhou = true;
        return erroServidor(503, 'PROVIDER_UNAVAILABLE');
      }
      return null;
    };
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-consultar-resultado')));
    const consulta = await within(dialogo).findByTestId('consulta-resultado');
    expect(falhou).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(CHAVE_PENDENTE) ?? 'null')?.operation_id).toBe(chave);
    expect(consulta).toHaveTextContent(
      'O abastecimento nº 1 foi gravado, mas não foi possível abri-lo agora. Consulte de novo ou abra pela lista; repetir o mesmo envio não grava outro.',
    );
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-repetir-envio')));
    expect(await screen.findByText('Abastecimento nº 1 confirmado: 80,0000 L baixados do estoque. (envio repetido: nada foi duplicado)')).toBeTruthy();
    expect(confirmacoes()).toHaveLength(2);
    expect(confirmacoes()[1].body.operation_id).toBe(chave);
    expect(amb.estado.abastecimentos).toHaveLength(1);
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['0.0000', '70.0000']);
    expect(window.localStorage.getItem(CHAVE_PENDENTE)).toBeNull();
  });

  it('FE-03: sem localStorage gravável (cota cheia) a chave do envio sem resposta fica em memória e repetir manda a MESMA chave (nada duplicado)', async () => {
    const gravar = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
      if (String(k).startsWith('maike_lancamento_pendente')) throw new DOMException('cheio', 'QuotaExceededError');
      return gravar.call(this, k, v);
    });
    amb.estado.proxima = 'gravar-e-perder';
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    await within(dialogo).findByTestId('resultado-incerto');
    expect(window.localStorage.getItem(CHAVE_PENDENTE)).toBeNull();
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-repetir-envio')));
    expect(await screen.findByText('Abastecimento nº 1 confirmado: 80,0000 L baixados do estoque. (envio repetido: nada foi duplicado)')).toBeTruthy();
    expect(confirmacoes()).toHaveLength(2);
    expect(confirmacoes()[1].body.operation_id).toBe(confirmacoes()[0].body.operation_id);
    expect(amb.estado.abastecimentos).toHaveLength(1);
  });

  it('FE-06: o mesmo envio ainda em processamento (409 IDEMPOTENCY_IN_PROGRESS) continua incerto: Consultar e "Repetir o mesmo envio" à vista, mesma chave', async () => {
    let n = 0;
    amb.falhar = (req) => {
      if (req.method !== 'POST' || req.path !== '/patrimonio-abastecimentos') return null;
      n += 1;
      if (n === 1) return { status: 504, body: { message: 'gateway timeout' } };
      if (n === 2) return erroServidor(409, 'IDEMPOTENCY_IN_PROGRESS', { details: { operation_id: req.body?.operation_id } });
      return null;
    };
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    await within(dialogo).findByTestId('resultado-incerto');
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-repetir-envio')));
    expect(await within(dialogo).findByTestId('consulta-resultado')).toHaveTextContent('O mesmo envio ainda está sendo processado. Aguarde e consulte.');
    expect(within(dialogo).getByTestId('resultado-incerto')).toBeTruthy();
    expect(within(dialogo).queryByTestId('erro-envio')).toBeNull();
    expect(within(dialogo).getByTestId('botao-consultar-resultado')).toBeTruthy();
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-repetir-envio')));
    expect(await screen.findByText(/Abastecimento nº 1 confirmado: 80,0000 L baixados do estoque\./)).toBeTruthy();
    const chaves = confirmacoes().map((c) => c.body.operation_id);
    expect(chaves).toHaveLength(3);
    expect(new Set(chaves).size).toBe(1);
    expect(amb.estado.abastecimentos).toHaveLength(1);
  });

  it('IDEMPOTENCY_CONFLICT com mensagem própria; 422 ABASTECIMENTO_PRODUTO_NAO_ACEITO aponta para os Produtos aceitos em Bens', async () => {
    amb.estado.proxima = erroServidor(409, 'IDEMPOTENCY_CONFLICT', { details: { operation_id: 'x', tipo_operacao: 'confirmar_abastecimento_bem' } });
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    expect(await within(dialogo).findByTestId('erro-envio')).toHaveTextContent(
      'Este envio usa uma chave já usada por outro conteúdo. Recarregue e envie de novo. Nada foi gravado.',
    );
    // Recusa definitiva libera a pendência.
    expect(window.localStorage.getItem(CHAVE_PENDENTE)).toBeNull();
    // Resposta forçada (o estado do fake não muda: as opções relidas continuam as mesmas e a revisão segue aberta).
    amb.estado.proxima = erroServidor(422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', { field: 'produto_id', reason: 'nao_aceito_pelo_tanque', details: { field: 'produto_id', reason: 'nao_aceito_pelo_tanque' } });
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    await waitFor(() =>
      expect(within(dialogo).getByTestId('erro-envio')).toHaveTextContent(
        'O tanque escolhido não aceita este Produto. Marque o Produto nos Produtos aceitos do tanque em Bens Patrimoniais. Nada foi gravado.',
      ),
    );
    expect(amb.estado.abastecimentos).toEqual([]);
  });
});

describe('Consumo do bem (D-PROD-162, P-03: métrica pela unidade do Produto)', () => {
  it('horímetro TP-02 em L: 3º abastecimento 5 L/h; 1º e 2º com "dados insuficientes"; painel com metodologia', async () => {
    amb.estado.lotes.find((l) => l.id === 'lote-B').disponivel = '500.0000';
    amb.estado.produtos.find((p) => p.id === 'p1').estoque_atual = '550.0000';
    await semearTrator({ data_operacional: '2026-06-05', medidor_leitura: '1530.5', quantidade: '100', tanque_cheio: true });
    await semearTrator({ data_operacional: '2026-06-08', medidor_leitura: '1540.5', quantidade: '40', tanque_cheio: false });
    await semearTrator({ data_operacional: '2026-06-10', medidor_leitura: '1550.5', quantidade: '60', tanque_cheio: true });
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-3'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('Consumo: 5 L/h');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('100,0000 L em 20 h desde o tanque cheio anterior.');
    fireEvent.click(within(consulta).getByTestId('abastecimento-ver-consumo-bem'));
    const painel = await screen.findByTestId('painel-consumo-bem');
    const linhas = await within(painel).findAllByRole('row');
    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringMatching(/Tanque.*Quantidade/),
      expect.stringMatching(/10\/06\/2026.*20 h.*100,0000 L.*5 L\/h/),
      expect.stringMatching(/05\/06\/2026.*dados insuficientes/),
    ]);
    expect(within(painel).getByTestId('consumo-metodologia')).toHaveTextContent('Método do tanque cheio');
  });

  it('Produto em KG: kg/h no horímetro; intervalo com L e kg misturados → "dados insuficientes" (nunca soma litro com quilo)', async () => {
    aceitarKgNoTrator();
    await semearTrator({ produto_id: 'p6', data_operacional: '2026-06-05', medidor_leitura: '1530.5', quantidade: '100', tanque_cheio: true });
    await semearTrator({ produto_id: 'p6', data_operacional: '2026-06-10', medidor_leitura: '1550.5', quantidade: '60', tanque_cheio: true });
    await semearTrator({ data_operacional: '2026-06-11', medidor_leitura: '1555.5', quantidade: '10', tanque_cheio: false });
    await semearTrator({ produto_id: 'p6', data_operacional: '2026-06-12', medidor_leitura: '1560.5', quantidade: '20', tanque_cheio: true });
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-2'));
    let consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('consulta-quantidade')).toHaveTextContent('60,0000 kg');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('Consumo: 3 kg/h');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('60,0000 kg em 20 h desde o tanque cheio anterior.');
    fireEvent.click(within(consulta).getByTestId('abastecimento-ver-consumo-bem'));
    const painel = await screen.findByTestId('painel-consumo-bem');
    const linhas = await within(painel).findAllByRole('row');
    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringMatching(/Tanque.*Quantidade/),
      expect.stringMatching(/12\/06\/2026.*10 h.*dados insuficientes/),
      expect.stringMatching(/10\/06\/2026.*20 h.*60,0000 kg.*3 kg\/h/),
      expect.stringMatching(/05\/06\/2026.*dados insuficientes/),
    ]);
    fireEvent.click(within(painel).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByTestId('painel-consumo-bem')).toBeNull());
    cleanup();
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-4'));
    consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('Dados insuficientes');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('o intervalo tem abastecimentos em litros e em quilos, que não se somam');
  });

  it('bem sem medidor: consumo não se aplica', async () => {
    await semearAbastecimento(amb.estado, { bem_id: 'b3', tanque_id: 'tq3', produto_id: 'p1', local_estoque_id: 'l1', data_operacional: '2026-06-10', quantidade: '10', tanque_cheio: true });
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-1'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('Consumo não se aplica');
    fireEvent.click(within(consulta).getByTestId('abastecimento-ver-consumo-bem'));
    expect(await screen.findByTestId('consumo-nao-aplica')).toHaveTextContent('Consumo não se aplica a este medidor.');
  });
});
