/**
 * D-PROD-159, revisto pela D-PROD-162 — FE6: cancelamento do abastecimento
 * (estorno exato) na tela real sobre o backend falso. Exige a ação `cancelar`,
 * motivo (3..500) e ciência; avisa quando a leitura operacional do medidor
 * muda; a quantidade devolvida aparece na unidade GRAVADA no abastecimento (L
 * ou kg); corpo EXATO de A5 com `operation_id`; resultado incerto repete a
 * MESMA chave; recusas legíveis (inclusive `unidade_mudou`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { erroServidor } from './fixtures/gestaoBackendFake.js';
import { acrescentarProduto, semearAbastecimento } from './fixtures/abastecimentosFakeCore.js';
import { montar, permissaoCom, prepararAmbiente } from './fixtures/abastecimentosTela.jsx';

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

let amb;

beforeEach(async () => {
  sessao.permissao = permissaoCom({ novo: true, cancelar: true });
  amb = await prepararAmbiente(vi);
  // Abastecimento confirmado do trator com leitura 1550,5 h (a leitura operacional vigente).
  await semearAbastecimento(amb.estado, {
    bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1',
    data_operacional: '2026-06-10', quantidade: '80', medidor_leitura: '1550.5', tanque_cheio: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const cancelamentos = () => amb.backend.chamadas.filter((c) => c.method === 'POST' && c.path === '/patrimonio-abastecimentos/ab-1/cancelar');
const CHAVE_PENDENTE = 'maike_lancamento_pendente:abastecimento:cli-1:operador:cancelar:emp-1:ab-1';

const abrirDialogo = async () => {
  await montar();
  fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-1'));
  const consulta = await screen.findByTestId('abastecimento-consulta');
  fireEvent.click(within(consulta).getByTestId('abastecimento-cancelar'));
  return screen.findByTestId('dialogo-cancelamento-abastecimento');
};

const preencher = (dialogo, motivo = 'Lançado em duplicidade') => {
  fireEvent.change(within(dialogo).getByTestId('cancelamento-motivo'), { target: { value: motivo } });
  fireEvent.click(within(dialogo).getByTestId('cancelamento-ciente'));
};

describe('FE6 — cancelamento', () => {
  it('sem a ação cancelar (só novo) não há botão de cancelar', async () => {
    sessao.permissao = permissaoCom({ novo: true, salvar: true, editar: true, excluir: true });
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-1'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).queryByTestId('abastecimento-cancelar')).toBeNull();
  });

  it('motivo de 3 a 500 e ciência obrigatórios; aviso de mudança da leitura; corpo EXATO de A5; estorno aos lotes', async () => {
    const dialogo = await abrirDialogo();
    expect(within(dialogo).getByTestId('cancelamento-aviso-medidor')).toHaveTextContent(
      'A leitura operacional do medidor passará de 1.550,5 h (10/06/2026) para a leitura do cadastro, 1.520,5 h (01/06/2026).',
    );
    expect(dialogo).toHaveTextContent('O cancelamento estorna a baixa: o estoque volta aos lotes de origem (80,0000 L de Diesel S10 granel); se houve outros movimentos do produto no depósito depois, o custo médio deles é recalculado.');
    const enviar = within(dialogo).getByTestId('cancelamento-enviar');
    expect(enviar).toBeDisabled();
    fireEvent.change(within(dialogo).getByTestId('cancelamento-motivo'), { target: { value: 'ab' } });
    fireEvent.click(within(dialogo).getByTestId('cancelamento-ciente'));
    expect(within(dialogo).getByText('Informe pelo menos 3 caracteres.')).toBeTruthy();
    expect(enviar).toBeDisabled();
    fireEvent.change(within(dialogo).getByTestId('cancelamento-motivo'), { target: { value: '  Lançado em duplicidade  ' } });
    expect(enviar).not.toBeDisabled();
    await act(async () => fireEvent.click(enviar));
    expect(await screen.findByText('Abastecimento nº 1 cancelado: 80,0000 L devolvidos aos lotes de origem.')).toBeTruthy();
    expect(cancelamentos()).toHaveLength(1);
    expect(cancelamentos()[0].body).toEqual({ empresa_id: 'emp-1', versao: 1, motivo: 'Lançado em duplicidade', operation_id: expect.stringMatching(/^lanc-[A-Za-z0-9_.:-]{8,123}$/) });
    await waitFor(() => expect(screen.queryByTestId('dialogo-cancelamento-abastecimento')).toBeNull());
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('abastecimento-consulta-situacao')).toHaveTextContent('Cancelado');
    expect(within(consulta).getByTestId('consulta-estorno')).toHaveTextContent(/Estorno nº 42 · Entrada/);
    expect(within(consulta).getByTestId('consulta-cancelamento')).toHaveTextContent('Motivo: Lançado em duplicidade');
    expect(within(consulta).queryByTestId('abastecimento-cancelar')).toBeNull();
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['50.0000', '100.0000']);
    expect(window.localStorage.getItem(CHAVE_PENDENTE)).toBeNull();
  });

  it('sem resposta: resultado incerto; repetir usa a MESMA chave (replay); "Consultar" vê o CANCELADO e fecha', async () => {
    amb.estado.proxima = 'gravar-e-perder';
    let dialogo = await abrirDialogo();
    preencher(dialogo);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('cancelamento-enviar')));
    expect(await within(dialogo).findByTestId('resultado-incerto')).toBeTruthy();
    expect(screen.queryByText(/cancelado:/)).toBeNull();
    const chave = cancelamentos()[0].body.operation_id;
    expect(JSON.parse(window.localStorage.getItem(CHAVE_PENDENTE)).operation_id).toBe(chave);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-repetir-envio')));
    expect(await screen.findByText('Abastecimento nº 1 cancelado: 80,0000 L devolvidos aos lotes de origem. (envio repetido: nada foi duplicado)')).toBeTruthy();
    expect(cancelamentos()[1].body.operation_id).toBe(chave);
    cleanup();

    // "Consultar": o detalhe relido mostra CANCELADO → a pendência sai e o diálogo fecha.
    amb = await prepararAmbiente(vi);
    await semearAbastecimento(amb.estado, {
      bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1',
      data_operacional: '2026-06-10', quantidade: '80', medidor_leitura: '1550.5', tanque_cheio: true,
    });
    amb.estado.proxima = 'gravar-e-perder';
    dialogo = await abrirDialogo();
    preencher(dialogo);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('cancelamento-enviar')));
    await within(dialogo).findByTestId('resultado-incerto');
    await act(async () => fireEvent.click(within(dialogo).getByTestId('botao-consultar-resultado')));
    await waitFor(() => expect(screen.queryByTestId('dialogo-cancelamento-abastecimento')).toBeNull());
    expect(await screen.findByTestId('consulta-cancelamento')).toBeTruthy();
    expect(window.localStorage.getItem(CHAVE_PENDENTE)).toBeNull();
    expect(cancelamentos()).toHaveLength(1);
  });

  it('409 ABASTECIMENTO_CANCELAMENTO_BLOQUEADO e 409 já cancelado: mensagens legíveis, nada alterado', async () => {
    amb.estado.proxima = erroServidor(409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', { field: 'abastecimento', reason: 'lote_indisponivel_para_devolucao', details: { lote_id: 'lote-A' } });
    const dialogo = await abrirDialogo();
    preencher(dialogo);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('cancelamento-enviar')));
    expect(await within(dialogo).findByTestId('erro-envio')).toHaveTextContent('O estorno exato não é seguro agora (um lote de origem foi estornado ou removido). Nada foi alterado.');
    expect(window.localStorage.getItem(CHAVE_PENDENTE)).toBeNull();
    amb.estado.proxima = erroServidor(409, 'ABASTECIMENTO_STATUS_INVALIDO', { field: 'status', reason: 'status_invalido', details: { status: 'CANCELADO', esperado: 'CONFIRMADO' } });
    await act(async () => fireEvent.click(within(dialogo).getByTestId('cancelamento-enviar')));
    await waitFor(() => expect(within(dialogo).getByTestId('erro-envio')).toHaveTextContent('Este abastecimento já foi cancelado. Nada foi alterado.'));
    expect(amb.estado.abastecimentos[0].status).toBe('CONFIRMADO');
  });

  it('Produto em KG: o diálogo e o aviso falam em kg; o estorno devolve os mesmos quilos aos lotes', async () => {
    acrescentarProduto(amb.estado, 'p6', 'Diesel pesado (kg)', { unidade: 'KG', lote: '500.0000', tanques: [['b1', 'tq1']] });
    await semearAbastecimento(amb.estado, {
      bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p6', local_estoque_id: 'l1', data_operacional: '2026-06-11', quantidade: '250', medidor_leitura: '1560', tanque_cheio: false,
    });
    expect(amb.estado.lotes.find((l) => l.id === 'lote-p6').disponivel).toBe('250.0000');
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-2'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('consulta-quantidade')).toHaveTextContent('250,0000 kg');
    fireEvent.click(within(consulta).getByTestId('abastecimento-cancelar'));
    const dialogo = await screen.findByTestId('dialogo-cancelamento-abastecimento');
    expect(dialogo).toHaveTextContent('(250,0000 kg de Diesel pesado (kg))');
    preencher(dialogo);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('cancelamento-enviar')));
    expect(await screen.findByText('Abastecimento nº 2 cancelado: 250,0000 kg devolvidos aos lotes de origem.')).toBeTruthy();
    expect(amb.estado.lotes.find((l) => l.id === 'lote-p6').disponivel).toBe('500.0000');
    expect(amb.estado.produtos.find((p) => p.id === 'p6').estoque_atual).toBe('500.0000');
  });

  it('409 unidade_mudou (a unidade do Produto saiu de L depois do abastecimento): mensagem legível, nada alterado', async () => {
    amb.estado.produtos.find((p) => p.id === 'p1').unidade_principal_estoque = 'KG';
    const dialogo = await abrirDialogo();
    preencher(dialogo);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('cancelamento-enviar')));
    expect(await within(dialogo).findByTestId('erro-envio')).toHaveTextContent(
      'O estorno exato não é seguro agora (a unidade de estoque do Produto mudou desde o abastecimento). Nada foi alterado.',
    );
    expect(amb.estado.abastecimentos[0].status).toBe('CONFIRMADO');
    expect(amb.estado.lotes.filter((l) => l.produto === 'p1').map((l) => l.disponivel)).toEqual(['0.0000', '70.0000']);
  });
});

describe('FE6 — cancelamento do posto externo (D-PROD-211)', () => {
  it('posto externo: o diálogo diz que nada volta ao estoque; corpo de A5 de sempre; só o status muda (sem estorno)', async () => {
    await semearAbastecimento(amb.estado, {
      bem_id: 'b2', tanque_id: 'tq2', produto_id: 'p2', origem: 'EXTERNO', custo_total: '300',
      data_operacional: '2026-06-11', quantidade: '50', medidor_leitura: '35300', tanque_cheio: false,
    });
    const lotes = amb.estado.lotes.map((l) => l.disponivel);
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('abastecimento-bem-ab-2'));
    const consulta = await screen.findByTestId('abastecimento-consulta');
    expect(within(consulta).getByTestId('consulta-origem')).toHaveTextContent('Posto externo');
    fireEvent.click(within(consulta).getByTestId('abastecimento-cancelar'));
    const dialogo = await screen.findByTestId('dialogo-cancelamento-abastecimento');
    expect(dialogo).toHaveTextContent('não houve baixa do estoque, então nada volta ao estoque');
    expect(dialogo).not.toHaveTextContent('o estoque volta exatamente aos lotes de origem');
    preencher(dialogo, 'Nota lançada no carro errado');
    await act(async () => fireEvent.click(within(dialogo).getByTestId('cancelamento-enviar')));
    expect(await screen.findByText('Abastecimento nº 2 cancelado: deixa de contar no consumo e nos custos.')).toBeTruthy();
    const chamada = amb.backend.chamadas.filter((c) => c.method === 'POST' && c.path === '/patrimonio-abastecimentos/ab-2/cancelar').at(-1);
    expect(chamada.body).toEqual({ empresa_id: 'emp-1', versao: 1, motivo: 'Nota lançada no carro errado', operation_id: expect.any(String) });
    const depois = await screen.findByTestId('abastecimento-consulta');
    await waitFor(() => expect(within(depois).getByTestId('abastecimento-consulta-situacao')).toHaveTextContent('Cancelado'));
    expect(within(depois).queryByTestId('consulta-estorno')).toBeNull();
    expect(amb.estado.lotes.map((l) => l.disponivel)).toEqual(lotes);
  });
});
