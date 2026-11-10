/**
 * D-PROD-160 (Patrimônio UX-02) — Novo abastecimento orientado por PRODUTO, na
 * tela real (página, motor Base1, service, API, porta e nativeHttpClient reais)
 * sobre o backend falso, cuja rota A16 `produtos-do-bem` segue a semântica do
 * serviço real (contrato UX-02 §2.3). O operador escolhe a máquina e o PRODUTO
 * (nome real do estoque); o tipo de combustível vem da opção do servidor e
 * NUNCA é etapa do formulário. O corpo de A3/A4 é o MESMO de antes.
 *
 *  UX-A01 fluxo TP-02 sem etapa Combustível; corpos A3/A4 exatos
 *  UX-A02 auto-seleção só com has_more=false (página parcial → seletor, nada escolhido)
 *  UX-A03 2..6 Produtos → botões; >6 → seletor com busca; ids da opção no corpo
 *  UX-A04 multi-tanque → "Qual tanque será abastecido?" obrigatório
 *  UX-A05 flex com Produto sem fator → aviso; "Configurar fator kg/L" só com a ação
 *  UX-A06 nenhum Produto: cada motivo; vínculo e fator em mensagens separadas
 *  UX-A07 sem saldo · UX-A08 vários locais
 *  UX-A09 resposta atrasada do bem anterior não auto-escolhe no bem novo
 *  UX-A10 A→B: 422 sem_vinculo_ativo na confirmação → relê → escolhe B
 *  UX-A11 revisão: resumo humano, "Detalhes do estoque" recolhido; mudar invalida
 *  UX-A12 lista: colunas padrão exatas, sem "Combustível"; celular (cards)
 *  UX-A13 teclado/acessibilidade e 390 px sem largura fixa
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { escolherOpcao, rotulosDasOpcoes } from './fixtures/gestaoBackendFake.js';
import { semearAbastecimento } from './fixtures/abastecimentosFakeCore.js';
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

const TODAS = { novo: true, salvar: true, cancelar: true, configurar_conversao: true };

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

/** Mais um Produto do estoque da fazenda associado (vínculo ativo) a um combustível. */
const novoProduto = (id, nome, tipo, { fator = null, lote = '100.0000', local = 'l1', ...extra } = {}) => {
  amb.estado.produtos.push({ id, nome, codigo_interno: id.toUpperCase(), unidade_principal_estoque: 'KG', tipo, estoque_atual: lote, ...extra });
  if (lote) amb.estado.lotes.push({ id: `lote-${id}`, produto: id, local, dia: '2026-06-04', disponivel: lote, custo: '5.0000' });
  if (fator) amb.estado.conversoes.push({ id: `f-${id}`, tipo, produto: id, sequencia: 1, kg_por_litro: fator, ativo: true, versao: 1, encerrado_em: null, criado_por: { id: 'u1', login: 'gerente' } });
};

const CORPO_TP02 = (hoje) => ({
  empresa_id: 'emp-1', bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1',
  data_operacional: hoje, quantidade_litros: '80', medidor_leitura: '1550.5', tanque_cheio: true, observacao: null, referencia_externa: null,
});

describe('UX-A01 — fluxo TP-02: máquina → Produto → litros → medidor → revisar → confirmar', () => {
  it('sem etapa Combustível: o único Produto já vem marcado; corpos A3/A4 EXATOS de antes', async () => {
    await montar();
    const form = await abrirNovo();
    // Data pré-preenchida com o "hoje" da fazenda.
    expect(within(form).getByTestId('abastecimento-data')).toHaveValue(amb.estado.hoje);
    await preencherTrator(form);
    const grupo = within(form).getByTestId('abastecimento-produto');
    expect(grupo.getAttribute('aria-label')).toBe('Produto');
    expect(radios(grupo)).toEqual([['Diesel S10 granel', 'true']]);
    // "Diesel S10" (o tipo) não é rótulo, radio nem etapa.
    expect(within(form).queryByRole('radio', { name: 'Diesel S10' })).toBeNull();
    expect(within(form).queryByText('Diesel S10', { exact: true })).toBeNull();
    expect(within(form).queryByRole('radiogroup', { name: /combust/i })).toBeNull();
    expect(within(form).queryByTestId('abastecimento-tanque')).toBeNull();
    const dialogo = await pedirPrevia(form);
    expect(previas()[0].body).toEqual(CORPO_TP02(amb.estado.hoje));
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    expect(await screen.findByTestId('abastecimento-consulta')).toBeTruthy();
    expect(confirmacoes()).toHaveLength(1);
    expect(confirmacoes()[0].body).toEqual({ ...CORPO_TP02(amb.estado.hoje), conversao_id: 'f1', conversao_versao: 1, operation_id: expect.stringMatching(/^lanc-/) });
    expect(screen.getByTestId('consulta-produto')).toHaveTextContent('Diesel S10 granel');
    expect(screen.getByTestId('consulta-tipo')).toHaveTextContent('Diesel S10');
    expect(screen.getByText('Tipo de combustível (classificação)')).toBeTruthy();
  });
});

describe('UX-A02 — auto-seleção só com a resposta COMPLETA', () => {
  it('página parcial (has_more): seletor paginado, NADA escolhido, nenhum saldo lido; escolher pelo seletor aplica a opção', async () => {
    novoProduto('p5', 'Diesel S10 posto', 'c1', { fator: '0.830000' });
    amb.estado.paginaProdutosDoBem = 1;
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    const seletor = await within(form).findByTestId('abastecimento-produto');
    expect(seletor.tagName).toBe('BUTTON');
    expect(seletor).toHaveTextContent('— Escolha o Produto —');
    expect(within(form).queryAllByRole('radio', { name: /Diesel/ })).toEqual([]);
    await esperar();
    expect(locaisLidos()).toEqual([]);
    expect(produtosDoBem()[0].query).toEqual({ empresa_id: 'emp-1', bem_id: 'b1', limit: '100' });
    fireEvent.click(seletor);
    const primeira = await within(form).findByRole('option', { name: /Diesel S10 granel/ });
    expect(within(form).queryByRole('option', { name: /Diesel S10 posto/ })).toBeNull();
    fireEvent.click(primeira);
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    expect(within(form).getByTestId('abastecimento-produto')).toHaveTextContent('Diesel S10 granel');
  });

  it('resposta completa com 2 Produtos: botões, nenhum marcado (nunca escolhe sozinho)', async () => {
    novoProduto('p5', 'Diesel S10 posto', 'c1', { fator: '0.830000' });
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

describe('UX-A03 — vários Produtos do mesmo combustível', () => {
  it('2..6 → botões com o NOME real; o corpo leva tipo/produto/tanque da opção do servidor', async () => {
    novoProduto('p5', 'Diesel S10 posto', 'c1', { fator: '0.830000' });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await escolherProduto(form, 'Diesel S10 posto');
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    digitar(form, 'abastecimento-litros', '40');
    digitar(form, 'abastecimento-leitura', '1.560');
    const dialogo = await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p5', local_estoque_id: 'l1', quantidade_litros: '40' });
    expect(within(abrirDetalhesDoEstoque(dialogo)).getByTestId('previa-fator')).toHaveTextContent('0,830000 kg/L');
    // O fator do granel NÃO aparece no posto: 40 × 0,83 = 33,2 kg.
    expect(within(dialogo).getByTestId('previa-kg')).toHaveTextContent('33,2000 kg');
  });

  it('mais de 6 Produtos completos → seletor paginado com busca (rótulo = nome do Produto; "sem fator kg/L" no detalhe)', async () => {
    for (let i = 1; i <= 6; i += 1) novoProduto(`px${i}`, `Diesel extra ${i}`, 'c1', { fator: i === 3 ? null : '0.840000' });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    const seletor = await within(form).findByTestId('abastecimento-produto');
    await waitFor(() => expect(seletor.tagName).toBe('BUTTON'));
    expect(within(form).queryByRole('radiogroup', { name: 'Produto' })).toBeNull();
    fireEvent.click(seletor);
    const opcoes = await within(form).findAllByRole('option');
    expect(opcoes).toHaveLength(7);
    expect(opcoes.find((o) => /Diesel extra 3/.test(o.textContent))).toHaveTextContent('Diesel extra 3sem fator kg/L');
    fireEvent.change(within(form).getByRole('searchbox', { name: 'Buscar produto' }), { target: { value: 'extra 5' } });
    await waitFor(() => expect(produtosDoBem().at(-1).query).toEqual({ empresa_id: 'emp-1', bem_id: 'b1', q: 'extra 5', limit: '50' }));
    fireEvent.click(await within(form).findByRole('option', { name: /Diesel extra 5/ }));
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Tanque diesel sede'));
    expect(within(form).getByTestId('abastecimento-produto')).toHaveTextContent('Diesel extra 5');
  });
});

describe('UX-A04 — multi-tanque', () => {
  it('Produto aceito em 2 tanques ativos → "Qual tanque será abastecido?" obrigatório; o inativo não aparece; capacidade do escolhido', async () => {
    amb.estado.tanques.b1.push(
      { id: 'tqB', identificador: 'Tanque reserva', capacidade_litros: '60.0000', combustiveis: ['c1'] },
      { id: 'tqC', identificador: 'Tanque antigo', capacidade_litros: '90.0000', combustiveis: ['c1'], ativo: false },
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
    digitar(form, 'abastecimento-litros', '70');
    digitar(form, 'abastecimento-leitura', '1.560');
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Escolha qual tanque será abastecido.')).toBeTruthy();
    fireEvent.click(within(tanques).getByRole('radio', { name: 'Tanque reserva (60 L)' }));
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Os litros passam da capacidade nominal do tanque.')).toBeTruthy();
    expect(previas()).toEqual([]);
    digitar(form, 'abastecimento-litros', '50');
    const dialogo = await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ tanque_id: 'tqB', tipo_combustivel_id: 'c1', produto_id: 'p1' });
    expect(within(abrirDetalhesDoEstoque(dialogo)).getByTestId('previa-tanque')).toHaveTextContent('Tanque reserva (60 L)');
  });

  it('flex + dois tanques de combustíveis diferentes: cada Produto só no tanque que aceita o seu tipo (sem perguntar)', async () => {
    amb.estado.tanques.b2.push({ id: 'tq2b', identificador: 'Tanque diesel', capacidade_litros: '100.0000', combustiveis: ['c1'] });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Caminhonete flex/);
    const grupo = await within(form).findByTestId('abastecimento-produto');
    expect(radios(grupo).map(([t]) => t)).toEqual(['Diesel S10 granel', 'Etanol hidratado', 'Gasolina comum (sem fator kg/L)']);
    await escolherProduto(form, 'Diesel S10 granel');
    expect(within(form).queryByTestId('abastecimento-tanque')).toBeNull();
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toBeTruthy());
    digitar(form, 'abastecimento-litros', '10');
    digitar(form, 'abastecimento-leitura', '35300');
    await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ tanque_id: 'tq2b', tipo_combustivel_id: 'c1', produto_id: 'p1' });
  });
});

describe('UX-A05 — Produto sem fator kg/L (flex: Gasolina)', () => {
  it('aviso de fator separado do de associação; "Configurar fator kg/L" só com configurar_conversao; salvar o fator libera a revisão', async () => {
    sessao.permissao = permissaoCom({ novo: true, configurar_conversao: true });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Caminhonete flex/);
    await escolherProduto(form, 'Gasolina comum (sem fator kg/L)');
    const aviso = within(form).getByTestId('abastecimento-sem-fator');
    expect(aviso).toHaveTextContent('Configure o fator kg/L deste Produto nesta fazenda antes de abastecer.');
    expect(aviso).not.toHaveTextContent(/Associe|Combustíveis/);
    expect(within(form).queryByTestId('abastecimento-sem-produto')).toBeNull();
    fireEvent.click(within(form).getByTestId('abastecimento-form-configurar-fator'));
    const painel = await screen.findByTestId('conversoes-combustivel');
    expect(within(painel).getByTestId('conversao-tipo')).toHaveTextContent('Gasolina');
    expect(within(painel).getByTestId('conversao-produto')).toHaveTextContent('Gasolina comum');
    const campo = within(painel).getByTestId('conversao-fator');
    fireEvent.change(campo, { target: { value: '0,745' } });
    fireEvent.blur(campo);
    fireEvent.click(within(painel).getByTestId('conversao-declaracao'));
    await act(async () => fireEvent.click(within(painel).getByTestId('conversao-salvar')));
    await waitFor(() => expect(chamadasDe(amb.backend, 'POST', '/patrimonio-conversoes-combustivel')).toHaveLength(1));
    expect(chamadasDe(amb.backend, 'POST', '/patrimonio-conversoes-combustivel')[0].body).toEqual({
      empresa_id: 'emp-1', tipo_combustivel_id: 'c2', produto_id: 'p2', kg_por_litro: '0.745', declara_estoque_em_kg: true, conversao_vigente_id: null,
    });
    fireEvent.click(within(painel).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByTestId('conversoes-combustivel')).toBeNull());
    await waitFor(() => expect(within(form).queryByTestId('abastecimento-sem-fator')).toBeNull());
    await esperarProdutoMarcado(form, 'Gasolina comum');
    await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Posto da fazenda'));
    digitar(form, 'abastecimento-litros', '30');
    digitar(form, 'abastecimento-leitura', '35300');
    const dialogo = await pedirPrevia(form);
    expect(within(dialogo).queryByTestId('previa-bloqueios')).toBeNull();
    expect(within(abrirDetalhesDoEstoque(dialogo)).getByTestId('previa-fator')).toHaveTextContent('0,745000 kg/L (versão 1)');
    expect(within(dialogo).getByTestId('abastecimento-confirmar')).toBeTruthy();
  });

  it('sem configurar_conversao: sem botão, "Peça a quem configura o fator kg/L."', async () => {
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Caminhonete flex/);
    await escolherProduto(form, 'Gasolina comum (sem fator kg/L)');
    expect(within(form).getByTestId('abastecimento-sem-fator')).toHaveTextContent('Peça a quem configura o fator kg/L.');
    expect(within(form).queryByTestId('abastecimento-form-configurar-fator')).toBeNull();
  });
});

describe('UX-A06 — nenhum Produto para o bem (cada motivo do servidor)', () => {
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

  it('nenhum_produto_associado: orienta associar no cadastro de Combustíveis; sem link sem a permissão; nada sobre fator', async () => {
    amb.estado.produtos.find((p) => p.id === 'p1').vinculo_ativo = false;
    const aviso = await avisoDoTrator();
    expect(aviso).toHaveTextContent(
      'Nenhum Produto desta fazenda está associado aos combustíveis deste bem. Associe um Produto ao combustível no cadastro de Combustíveis. Combustível sem Produto: Diesel S10. Peça a quem cuida do cadastro de Combustíveis.',
    );
    expect(aviso).not.toHaveTextContent(/fator/i);
    expect(within(aviso).queryByRole('link')).toBeNull();
  });

  it('nenhum_produto_associado com permissão de criar em Combustíveis: link "Abrir Combustíveis"', async () => {
    amb.estado.produtos.find((p) => p.id === 'p1').vinculo_ativo = false;
    sessao.permissao = { ...permissaoCom({ novo: true }), permissoes_telas: [...permissaoCom({ novo: true }).permissoes_telas, { tela_id: 'pat-combustiveis', visualizar: true, novo: true }] };
    const aviso = await avisoDoTrator();
    expect(within(aviso).getByRole('link', { name: 'Abrir Combustíveis' }).getAttribute('href')).toBe('/combustiveis');
    expect(aviso).not.toHaveTextContent('Peça a quem cuida');
  });

  it('produto_unidade_nao_kg', async () => {
    amb.estado.produtos.find((p) => p.id === 'p1').unidade_principal_estoque = 'L';
    expect(await avisoDoTrator()).toHaveTextContent(
      'O Produto associado tem estoque em outra unidade (não KG): o abastecimento só baixa estoque em KG. Ajuste a unidade de estoque do Produto.',
    );
  });

  it('tanque_sem_combustivel (combustível inativo)', async () => {
    amb.estado.tipos.find((t) => t.id === 'c1').ativo = false;
    expect(await avisoDoTrator()).toHaveTextContent(
      'Os tanques deste bem não têm combustível permitido ativo em litros. Ajuste os combustíveis permitidos no cadastro do bem.',
    );
  });

  it('sem_tanque_ativo (tanque inativado depois da lista de bens)', async () => {
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
    digitar(form, 'abastecimento-litros', '10');
    digitar(form, 'abastecimento-leitura', '1.560');
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    await esperar();
    expect(previas()).toEqual([]);
  });

  it('vários locais com saldo: "De qual local do estoque?" (só o nome, sem kg nem lotes), obrigatório', async () => {
    amb.estado.lotes.push({ id: 'lote-P', produto: 'p1', local: 'l2', dia: '2026-06-05', disponivel: '40.0000', custo: '5.0000' });
    await montar();
    const form = await abrirNovo();
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await esperarProdutoMarcado(form, 'Diesel S10 granel');
    const local = await within(form).findByRole('combobox', { name: 'De qual local do estoque?' });
    const nomes = await rotulosDasOpcoes(local);
    expect(nomes).toEqual(['— Escolha o local —', 'Tanque diesel sede', 'Posto da fazenda']);
    expect(nomes.join(' ')).not.toMatch(/kg|lote|dispon/i);
    expect(within(form).queryByTestId('abastecimento-local-auto')).toBeNull();
    digitar(form, 'abastecimento-litros', '20');
    digitar(form, 'abastecimento-leitura', '1.560');
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    expect(await within(form).findByText('Escolha de qual local do estoque sai o combustível.')).toBeTruthy();
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
      ['Gasolina comum (sem fator kg/L)', 'false'],
    ]);
    expect(locaisLidos()).toEqual([]);
    // Escolhe no flex e volta ao trator: o Produto do flex sai; o do trator (único) é marcado.
    await escolherProduto(form, 'Etanol hidratado');
    await waitFor(() => expect(locaisLidos()).toHaveLength(1));
    await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
    await esperarProdutoMarcado(form, 'Diesel S10 granel');
    expect(within(form).queryByRole('radio', { name: 'Etanol hidratado' })).toBeNull();
    digitar(form, 'abastecimento-litros', '10');
    digitar(form, 'abastecimento-leitura', '1.560');
    await pedirPrevia(form);
    expect(previas()[0].body).toMatchObject({ bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1' });
  });
});

describe('UX-A10 — associação trocada A → B no cadastro de Combustíveis (sem editar o bem)', () => {
  it('confirmação com A recusada (422 sem_vinculo_ativo) → a tela relê, avisa e o operador escolhe B; nada de A é trocado em silêncio', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    // Entre a revisão e a confirmação: o vínculo de A sai e B entra no MESMO Diesel S10.
    const tanquesAntes = JSON.stringify(amb.estado.tanques);
    amb.estado.produtos.find((p) => p.id === 'p1').vinculo_ativo = false;
    novoProduto('p4', 'Diesel S10 estoque novo', 'c1', { fator: '0.830000' });
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
    expect(previas().at(-1).body).toMatchObject({ tipo_combustivel_id: 'c1', produto_id: 'p4', tanque_id: 'tq1', quantidade_litros: '80' });
    expect(within(dialogoB).getByTestId('previa-kg')).toHaveTextContent('66,4000 kg');
    await act(async () => fireEvent.click(within(dialogoB).getByTestId('abastecimento-confirmar')));
    expect(await screen.findByTestId('abastecimento-consulta')).toBeTruthy();
    expect(confirmacoes().at(-1).body).toMatchObject({ produto_id: 'p4', conversao_id: 'f-p4', conversao_versao: 1 });
    expect(amb.estado.abastecimentos.map((a) => a.produto_id)).toEqual(['p4']);
    // Lotes de A intactos; o bem e seus tanques não foram tocados.
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['50.0000', '100.0000']);
    expect(JSON.stringify(amb.estado.tanques)).toBe(tanquesAntes);
  });

  it('histórico: o abastecimento feito com A continua A (Produto, fator) depois da troca para B', async () => {
    await semearAbastecimento(amb.estado, {
      bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1', data_operacional: '2026-06-10', quantidade_litros: '80', medidor_leitura: '1550.5',
    });
    amb.estado.produtos.find((p) => p.id === 'p1').vinculo_ativo = false;
    novoProduto('p4', 'Diesel S10 estoque novo', 'c1', { fator: '0.830000' });
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-1'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('consulta-produto')).toHaveTextContent('Diesel S10 granel');
    expect(within(consulta).getByTestId('consulta-fator')).toHaveTextContent('0,840000 kg/L (versão 1)');
    expect(within(consulta).getByTestId('consulta-kg')).toHaveTextContent('67,2000 kg');
  });
});

describe('UX-A11 — revisão', () => {
  it('resumo humano; "Detalhes do estoque" recolhido (tipo, tanque, fator, custo, saldo, FIFO); mudar "Completou o tanque?" invalida', async () => {
    await montar();
    const form = await abrirNovo();
    await preencherTrator(form);
    const dialogo = await pedirPrevia(form);
    const dados = within(dialogo).getByTestId('previa-dados');
    expect([...dados.querySelectorAll('dt')].map((d) => d.textContent)).toEqual([
      'Máquina/Veículo', 'Produto', 'Litros', 'Leitura do medidor', 'Completou o tanque', 'Data', 'Sai do estoque', 'Baixa no estoque',
    ]);
    expect(within(dialogo).getByTestId('previa-produto')).toHaveTextContent('Diesel S10 granel');
    expect(within(dialogo).getByTestId('previa-litros')).toHaveTextContent('80 L');
    expect(within(dialogo).getByTestId('previa-leitura')).toHaveTextContent('1.550,5 h');
    expect(within(dialogo).getByTestId('previa-tanque-cheio')).toHaveTextContent('Sim');
    expect(within(dialogo).getByTestId('previa-local')).toHaveTextContent('Tanque diesel sede');
    // Recolhido: nada técnico renderizado.
    const botao = within(dialogo).getByTestId('previa-detalhes-estoque');
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    for (const id of ['previa-tipo', 'previa-tanque', 'previa-fator', 'previa-custo', 'previa-fatias']) expect(within(dialogo).queryByTestId(id)).toBeNull();
    expect(within(dialogo).queryByText('Diesel S10', { exact: true })).toBeNull();
    const detalhes = abrirDetalhesDoEstoque(dialogo);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(within(detalhes).getByTestId('previa-tipo')).toHaveTextContent('Diesel S10');
    expect(within(detalhes).getByTestId('previa-tanque')).toHaveTextContent('Tanque principal (180 L)');
    expect(within(detalhes).getByTestId('previa-fator')).toHaveTextContent('0,840000 kg/L (versão 1)');
    expect(within(detalhes).getByTestId('previa-saldo')).toHaveTextContent('150,0000 kg');
    expect(within(within(detalhes).getByTestId('previa-fatias')).getAllByRole('row')).toHaveLength(3);
    fireEvent.click(botao);
    expect(within(dialogo).queryByTestId('previa-fator')).toBeNull();
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
      bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1', quantidade_litros: '10', ...extra,
    });

  it('colunas padrão Data | Máquina/Veículo | Produto | Litros | Medidor | Situação (sem "Combustível"); mais recente primeiro', async () => {
    // Preferência antiga (v1, com a coluna Combustível) não ressuscita a coluna.
    window.localStorage.setItem('colunas_abastecimentos_v1', JSON.stringify({ order: ['tipo_combustivel'], visible: { tipo_combustivel: true } }));
    await semear({ data_operacional: '2026-06-05', medidor_leitura: '1525.0' });
    await semear({ data_operacional: '2026-06-10', medidor_leitura: '1535.0' });
    await semear({ data_operacional: '2026-06-08', medidor_leitura: '1530.0' });
    await montar();
    await screen.findByTestId('abastecimento-bem-ab-1');
    const cabecalhos = screen.getAllByRole('columnheader').map((c) => c.textContent.trim()).filter(Boolean);
    expect(cabecalhos).toEqual(['Data', 'Máquina/Veículo', 'Produto', 'Litros', 'Medidor', 'Situação']);
    expect(cabecalhos).not.toContain('Combustível');
    const linhas = screen.getAllByRole('row').slice(1);
    expect(linhas[0]).toHaveTextContent(/10\/06\/2026.*TP-02 — Trator TP-02.*Diesel S10 granel.*10,0000 L.*1.535 h.*Confirmado/);
    expect(linhas.map((l) => (l.textContent.match(/\d{2}\/06\/2026/) ?? [''])[0])).toEqual(['10/06/2026', '08/06/2026', '05/06/2026']);
    expect(screen.queryByText('Diesel S10', { exact: true })).toBeNull();
  });

  it('celular (390 px): cards com máquina + Produto + litros + data, sem tabela', async () => {
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
});

describe('UX-A13 — teclado, acessibilidade e 390 px', () => {
  it('escolhas são botões nativos com role=radio/aria-checked; recolhíveis com aria-expanded; sem largura fixa que force rolagem', async () => {
    novoProduto('p5', 'Diesel S10 posto', 'c1', { fator: '0.830000' });
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
    // 390 px: nada de largura mínima fixa, nowrap ou rolagem horizontal no formulário.
    for (const el of [form, ...form.querySelectorAll('*')]) {
      const cls = String(el.getAttribute('class') ?? '');
      expect(cls, cls).not.toMatch(/(^|\s)(whitespace-nowrap|overflow-x-auto|w-screen)(\s|$)|min-w-\[|(^|\s)w-\[\d{3,}px\]/);
    }
    digitar(form, 'abastecimento-litros', '10');
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
