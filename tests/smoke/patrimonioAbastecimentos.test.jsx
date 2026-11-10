/**
 * D-PROD-159 — tela Abastecimentos montada de verdade (página, motor Base1,
 * service, API, porta e nativeHttpClient reais) sobre o backend falso
 * `abastecimentosFakeCore` (códigos/field/reason reais do contrato §6, decimais
 * como texto, idempotência por `operation_id`). Mocks só da borda: sessão e o
 * refresh do cache do Mapa.
 *
 *  FE1 estados: sem empresa (nada lido), carregando, sem `ver`, sem fuso, vazio, erro;
 *  FE2 lista: filtros com a query EXATA de A1, "Carregar mais" (cursor), detalhe;
 *  FE3 formulário (UX-02, D-PROD-160): máquina → PRODUTO (o tipo vem da opção
 *      do servidor; nenhuma etapa de combustível) → local; flex; trocar o bem
 *      limpa os dependentes; leitura só em contador; texto pt-BR;
 *  FE4 revisão (prévia sem comando): resumo humano + KG; fator, FIFO e custo
 *      "estimativa" em "Detalhes do estoque"; fator ausente; mudar campo
 *      invalida a revisão;
 *  FE5 confirmação: corpo EXATO de A4, duplo clique = 1 POST, 504 → incerto e
 *      repetir com o MESMO operation_id, "Consultar" por operation_id,
 *      IDEMPOTENCY_CONFLICT, replay, invalidação de estoque/Mapa/bem;
 *  permissões negadas por padrão; totais sem float.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { erroServidor, escolherOpcao } from './fixtures/gestaoBackendFake.js';
import { semearAbastecimento } from './fixtures/abastecimentosFakeCore.js';
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

const TODAS = { novo: true, salvar: true, cancelar: true, configurar_conversao: true };
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
    bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1',
    data_operacional: '2026-06-10', quantidade_litros: '10', medidor_leitura: '1530.5', tanque_cheio: false, ...extra,
  });

describe('FE1 — estados da tela', () => {
  it('sem empresa real: aviso e nada é lido (nem Novo nem Fatores)', async () => {
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

  it('sem a linha pat-abastecimentos (negado por padrão): sem lista, sem Novo, sem Fatores', async () => {
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

  it('abre o DETALHE com empresa_id: litros, fator snapshot, KG, custo FIFO, lotes, movimento e leitura', async () => {
    await semearTrator({ quantidade_litros: '80', medidor_leitura: '1550.5', tanque_cheio: true });
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-1'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(chamadasDe(amb.backend, 'GET', '/patrimonio-abastecimentos/ab-1')[0].query).toEqual({ empresa_id: 'emp-1' });
    expect(within(consulta).getByTestId('consulta-litros')).toHaveTextContent('80,0000 L');
    expect(within(consulta).getByTestId('consulta-fator')).toHaveTextContent('0,840000 kg/L (versão 1)');
    expect(within(consulta).getByTestId('consulta-kg')).toHaveTextContent('67,2000 kg');
    expect(within(consulta).getByTestId('consulta-custo').textContent).toMatch(/R\$\s354,60 \(R\$\s5,2768\/kg\)/);
    expect(within(within(consulta).getByTestId('consulta-fatias')).getAllByRole('row')).toHaveLength(3);
    expect(within(consulta).getByTestId('consulta-movimento')).toHaveTextContent(/Saída de estoque nº 41/);
    expect(within(consulta).getByTestId('consulta-leitura')).toHaveTextContent('1.550,5 h');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('Dados insuficientes');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('não há abastecimento anterior com tanque cheio neste tanque');
    // Sem a ação `cancelar`: o botão não existe.
    expect(within(consulta).queryByTestId('abastecimento-cancelar')).toBeNull();
  });

  it('totais da lista sem float: 0,1 L + 0,2 L = 0,3000 L (e o KG exato)', async () => {
    await semearTrator({ quantidade_litros: '0.1', medidor_leitura: '1525.0' });
    await semearTrator({ quantidade_litros: '0.2', medidor_leitura: '1526.0' });
    await montar();
    expect(await screen.findByTestId('abastecimento-totais')).toHaveTextContent('Confirmados na lista: 2 · 0,3000 L · 0,2520 kg');
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe('FE3 — formulário', () => {
  it('máquina → Produto (único: já marcado) → local automático; sem etapa de combustível; trocar o bem limpa os dependentes', async () => {
    await montar();
    const form = await abrirNovo();
    // Sem máquina não há escolha de Produto.
    expect(within(form).queryByTestId('abastecimento-produto')).toBeNull();
    await preencherTrator(form, { tanqueCheio: false });
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
      ['Gasolina comum (sem fator kg/L)', 'false'],
    ]);
    expect(within(form).queryByTestId('abastecimento-local-auto')).toBeNull();
    expect(within(form).getByTestId('abastecimento-leitura')).toHaveValue('');
    expect(within(form).getByText('Odômetro (km)')).toBeTruthy();
    await escolherProduto(form, 'Etanol hidratado');
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Sai do estoque: Posto da fazenda'));
    expect(chamadasDe(amb.backend, 'GET', '/patrimonio-abastecimentos-opcoes/produtos-do-bem').at(-1).query).toEqual({ empresa_id: 'emp-1', bem_id: 'b2', limit: '100' });
    // As leituras antigas (tanque → combustível → produtos do tipo) não são mais usadas pelo formulário.
    for (const rota of ['tanques', 'tipos', 'produtos']) expect(chamadasDe(amb.backend, 'GET', `/patrimonio-abastecimentos-opcoes/${rota}`)).toEqual([]);
  });

  it('bem sem medidor não pede leitura e o corpo leva medidor_leitura null; litros em texto pt-BR (0,1 → "0.1")', async () => {
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Gerador/);
    await esperarProdutoMarcado(form, 'Diesel S10 granel');
    expect(within(form).queryByTestId('abastecimento-leitura')).toBeNull();
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    digitar(form, 'abastecimento-litros', '0,1');
    await pedirPrevia(form);
    expect(previas()[0].body).toEqual({
      empresa_id: 'emp-1', bem_id: 'b3', tanque_id: 'tq3', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1',
      data_operacional: amb.estado.hoje, quantidade_litros: '0.1', medidor_leitura: null, tanque_cheio: false, observacao: null, referencia_externa: null,
    });
  });

  it('validação local antes da revisão: obrigatórios, leitura do contador, litros acima da capacidade — nada é enviado', async () => {
    await montar();
    const form = await abrirNovo();
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Escolha a máquina ou veículo.')).toBeTruthy();
    await preencherTrator(form, { litros: '180,0001', leitura: null });
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Os litros passam da capacidade nominal do tanque.')).toBeTruthy();
    expect(within(form).getByText('Informe a leitura do medidor.')).toBeTruthy();
    expect((await screen.findAllByText('Revise os campos destacados.')).length).toBeGreaterThan(0);
    expect(previas()).toEqual([]);
  });
});

describe('FE4 — revisão (prévia)', () => {
  it('revisão SEM comando: resumo humano e baixa em KG; fator, FIFO e custo "estimativa" em Detalhes do estoque; mudar campo invalida', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    expect(confirmacoes()).toEqual([]);
    expect(previas()).toHaveLength(1);
    expect(within(dialogo).getByRole('heading', { name: 'Revisar abastecimento' })).toBeTruthy();
    expect(within(dialogo).getByTestId('previa-resumo')).toHaveTextContent('TP-02 — Trator TP-02 · Diesel S10 granel · 80 L. Baixa de 67,2000 kg do estoque em Tanque diesel sede.');
    expect(within(dialogo).getByTestId('previa-kg')).toHaveTextContent('67,2000 kg');
    const detalhes = abrirDetalhesDoEstoque(dialogo);
    expect(within(detalhes).getByTestId('previa-fator')).toHaveTextContent('0,840000 kg/L (versão 1)');
    expect(within(detalhes).getByTestId('previa-custo')).toHaveTextContent(/R\$\s354,60/);
    expect(within(detalhes).getByTestId('previa-custo')).toHaveTextContent('estimativa; o custo final é calculado na confirmação');
    const linhas = within(within(detalhes).getByTestId('previa-fatias')).getAllByRole('row');
    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringContaining('Lote de'),
      expect.stringMatching(/01\/06\/2026.*50,0000.*5,20.*260,00/),
      expect.stringMatching(/03\/06\/2026.*17,2000.*5,50.*94,60/),
    ]);
    expect(within(dialogo).getByTestId('abastecimento-confirmar')).toHaveTextContent('Confirmar abastecimento');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-previa-abastecimento')).toBeNull());
    expect(within(form).getByTestId('abastecimento-reabrir-previa')).toHaveTextContent('Voltar à revisão');
    digitar(form, 'abastecimento-litros', '81');
    expect(await within(form).findByTestId('abastecimento-previa-invalidada')).toHaveTextContent('Os dados mudaram desde a revisão: revise de novo antes de confirmar.');
    expect(within(form).queryByTestId('abastecimento-reabrir-previa')).toBeNull();
  });

  it('bloqueio de quantidade (0 kg arredondado; acima do teto do estoque): a revisão não mostra o KG como baixa', async () => {
    amb.estado.conversoes.find((c) => c.id === 'f1').kg_por_litro = '0.400000';
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form, { litros: '0,0001', tanqueCheio: false });
    const dialogo = await pedirPrevia(form);
    expect(within(dialogo).getByTestId('previa-bloqueios').querySelector('[data-codigo="OPERACAO_VALORES_INVALIDOS"]')).toBeTruthy();
    expect(within(dialogo).getByTestId('previa-resumo')).toHaveTextContent('Nada foi gravado: confira abaixo o que impede a confirmação.');
    expect(within(dialogo).getByTestId('previa-resumo')).not.toHaveTextContent(/Baixa de/);
    expect(within(dialogo).getByTestId('previa-kg')).toHaveTextContent(/^—$/);
    expect(within(abrirDetalhesDoEstoque(dialogo)).getByTestId('previa-fator')).toHaveTextContent('0,400000 kg/L');
    expect(within(dialogo).queryByTestId('abastecimento-confirmar')).toBeNull();
  });

  it('fator ausente: bloqueio legível, sem Confirmar; "Configurar fator kg/L" só com configurar_conversao', async () => {
    const preencherFlexGasolina = async (form) => {
      await escolherNoSeletor(form, 'abastecimento-bem', /Caminhonete flex/);
      await escolherProduto(form, 'Gasolina comum (sem fator kg/L)');
      expect(within(form).getByTestId('abastecimento-sem-fator')).toHaveTextContent('Configure o fator kg/L deste Produto nesta fazenda antes de abastecer.');
      await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Posto da fazenda'));
      digitar(form, 'abastecimento-litros', '30');
      digitar(form, 'abastecimento-leitura', '35300');
    };
    await montar();
    let form = await abrirNovo();
    await preencherFlexGasolina(form);
    expect(within(form).queryByTestId('abastecimento-form-configurar-fator')).toBeNull();
    expect(within(form).getByTestId('abastecimento-sem-fator')).toHaveTextContent('Peça a quem configura o fator kg/L.');
    let dialogo = await pedirPrevia(form);
    expect(within(dialogo).getByTestId('previa-bloqueios')).toHaveTextContent('Não há fator kg/L configurado para este Produto nesta fazenda. Configure o fator antes de confirmar.');
    expect(within(dialogo).getByTestId('previa-bloqueios')).not.toHaveTextContent('Nada foi gravado');
    expect(within(dialogo).queryByTestId('abastecimento-confirmar')).toBeNull();
    expect(within(dialogo).queryByTestId('abastecimento-configurar-fator')).toBeNull();
    cleanup();

    sessao.permissao = permissaoCom(TODAS);
    await montar();
    form = await abrirNovo();
    await preencherFlexGasolina(form);
    dialogo = await pedirPrevia(form);
    fireEvent.click(within(dialogo).getByTestId('abastecimento-configurar-fator'));
    const conversoes = await screen.findByTestId('conversoes-combustivel');
    expect(within(conversoes).getByTestId('conversao-tipo')).toHaveTextContent('Gasolina');
    expect(within(conversoes).getByTestId('conversao-produto')).toHaveTextContent('Gasolina comum');
    expect(within(conversoes).getByTestId('conversao-vigente')).toHaveTextContent('Este par não tem fator vigente: salvar cria uma nova versão.');
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
      empresa_id: 'emp-1', bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1',
      data_operacional: amb.estado.hoje, quantidade_litros: '80', medidor_leitura: '1550.5', tanque_cheio: true, observacao: null, referencia_externa: null,
      conversao_id: 'f1', conversao_versao: 1, operation_id: expect.stringMatching(/^lanc-[A-Za-z0-9_.:-]{8,123}$/),
    });
    expect(await screen.findByText('Abastecimento nº 1 confirmado: 67,2000 kg baixados do estoque.')).toBeTruthy();
    expect(screen.getByTestId('consulta-kg')).toHaveTextContent('67,2000 kg');
    expect(refreshMapaCacheEntry).toHaveBeenCalledWith('estoqueLotes', 'emp-1', { force: true });
    expect(refreshMapaCacheEntry).toHaveBeenCalledWith('movimentacaoEstoque', 'emp-1', { force: true });
    expect(eventos).toEqual([{ cacheKeys: ['estoqueLotes'] }]);
    // Detalhe do bem (leitura do medidor) e consultas de estoque das telas antigas invalidados.
    expect(qc.getQueryState(['bens-patrimoniais', 'detalhe', 'emp-1', 'b1']).isInvalidated).toBe(true);
    expect(qc.getQueryState(['saldo-deposito', 'emp-1']).isInvalidated).toBe(true);
    expect(window.localStorage.getItem(CHAVE_PENDENTE)).toBeNull();
    // Estoque baixado exatamente pelos lotes (FIFO).
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['0.0000', '82.8000']);
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
    expect(await screen.findByText('Abastecimento nº 1 confirmado: 67,2000 kg baixados do estoque. (envio repetido: nada foi duplicado)')).toBeTruthy();
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
    expect(await screen.findByText('Abastecimento nº 1 confirmado: 67,2000 kg baixados do estoque. (envio repetido: nada foi duplicado)')).toBeTruthy();
    expect(confirmacoes()).toHaveLength(2);
    expect(confirmacoes()[1].body.operation_id).toBe(chave);
    expect(amb.estado.abastecimentos).toHaveLength(1);
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['0.0000', '82.8000']);
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
    expect(await screen.findByText('Abastecimento nº 1 confirmado: 67,2000 kg baixados do estoque. (envio repetido: nada foi duplicado)')).toBeTruthy();
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
    expect(await screen.findByText(/Abastecimento nº 1 confirmado: 67,2000 kg baixados do estoque\./)).toBeTruthy();
    const chaves = confirmacoes().map((c) => c.body.operation_id);
    expect(chaves).toHaveLength(3);
    expect(new Set(chaves).size).toBe(1);
    expect(amb.estado.abastecimentos).toHaveLength(1);
  });

  it('IDEMPOTENCY_CONFLICT com mensagem própria; fator encerrado entre prévia e confirmação → 422 legível', async () => {
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
    amb.estado.conversoes.find((c) => c.id === 'f1').ativo = false;
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    await waitFor(() =>
      expect(within(dialogo).getByTestId('erro-envio')).toHaveTextContent(
        'Não há fator kg/L configurado para este Produto nesta fazenda. Configure o fator antes de confirmar. Nada foi gravado.',
      ),
    );
    expect(amb.estado.abastecimentos).toEqual([]);
  });
});

describe('Consumo do bem', () => {
  it('horímetro TP-02: 3º abastecimento 5 L/h; 1º e 2º com "dados insuficientes"; painel com metodologia', async () => {
    amb.estado.lotes.find((l) => l.id === 'lote-B').disponivel = '500.0000';
    await semearTrator({ data_operacional: '2026-06-05', medidor_leitura: '1530.5', quantidade_litros: '100', tanque_cheio: true });
    await semearTrator({ data_operacional: '2026-06-08', medidor_leitura: '1540.5', quantidade_litros: '40', tanque_cheio: false });
    await semearTrator({ data_operacional: '2026-06-10', medidor_leitura: '1550.5', quantidade_litros: '60', tanque_cheio: true });
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-3'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('Consumo: 5 L/h');
    fireEvent.click(within(consulta).getByTestId('abastecimento-ver-consumo-bem'));
    const painel = await screen.findByTestId('painel-consumo-bem');
    const linhas = await within(painel).findAllByRole('row');
    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringContaining('Tanque'),
      expect.stringMatching(/10\/06\/2026.*20 h.*100,0000 L.*5 L\/h/),
      expect.stringMatching(/05\/06\/2026.*dados insuficientes/),
    ]);
    expect(within(painel).getByTestId('consumo-metodologia')).toHaveTextContent('Método do tanque cheio');
  });

  it('bem sem medidor: consumo não se aplica', async () => {
    await semearAbastecimento(amb.estado, { bem_id: 'b3', tanque_id: 'tq3', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1', data_operacional: '2026-06-10', quantidade_litros: '10', tanque_cheio: true });
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-1'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('abastecimento-consumo')).toHaveTextContent('Consumo não se aplica');
    fireEvent.click(within(consulta).getByTestId('abastecimento-ver-consumo-bem'));
    expect(await screen.findByTestId('consumo-nao-aplica')).toHaveTextContent('Consumo não se aplica a este medidor.');
  });
});
