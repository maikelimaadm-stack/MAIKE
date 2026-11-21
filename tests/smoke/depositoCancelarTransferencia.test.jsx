// @vitest-environment jsdom
/**
 * D-PROD-267 — frente DEPÓSITO: "Cancelar transferência" no Histórico do depósito.
 *
 *  CT-1. a perna 'Ativa' da transferência (enviada na origem, recebida no destino) mostra a ação SÓ
 *        para quem passa em `podeCancelarLancamentosEstoque`; o cartão 'Estornada' mostra "Cancelado"
 *        e nenhuma ação; os movimentos `estorno_transferencia_*` não aparecem no histórico.
 *  CT-2. offline: botão desligado com "Requer conexão", sem nenhuma chamada.
 *  CT-3. ensaio recusado: a mensagem por `reason` (movimento posterior no depósito, estoque usado).
 *  CT-4. sucesso: motivo + operation_id, refresh com force de `movimentacaoEstoque` e `estoqueLotes`,
 *        invalidação das consultas do depósito e `onCancelado`; `replay` conta como sucesso.
 *  CT-5. erro de rede: resultado desconhecido, reenvio e reabertura com a MESMA operation_id e o MESMO motivo.
 *  CT-6. recusa definitiva no POST: mensagem, pendência limpa e chave nova na próxima tentativa.
 *  CT-7. a porta antiga continua fechada: o componente novo não usa a política de estorno do navegador.
 *  CT-8. formulário de Entrada/Saída: a MESMA operation_id no reenvio depois de falha de rede; nova depois do sucesso.
 *  CT-9. revisão do diálogo: ensaio "já cancelada"/404 recarrega ao fechar (e o 404 tem mensagem própria); falha de
 *        rede no ensaio oferece "Conferir de novo"; 403 num reenvio desconhecido não é conclusivo (pendência fica);
 *        o motivo tem ajuda ligada por aria-describedby e aria-invalid; depois do sucesso o foco vai ao cartão.
 *  CT-10. revisão do formulário: pendência de outra abertura vale só na janela (vencida → chave nova); `replay` não é
 *        "registrada" (aviso, sem onSuccess, chave nova depois); IDEMPOTENCY_CONFLICT guarda a chave; pendência com
 *        saldo que já não cobre avisa "pode já ter sido registrada" sem enviar.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const h = vi.hoisted(() => ({
  usuario: null,
  permissao: null,
  movimentacoes: [],
  cancelar: vi.fn(),
  consultar: vi.fn(),
  refresh: vi.fn(async () => []),
  registrar: vi.fn(),
}));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/sessionService', () => ({
  getCurrentUser: vi.fn(async () => h.usuario),
  carregarPermissaoEfetiva: vi.fn(async () => h.permissao),
}));
vi.mock('@/services/estoqueMapaService', () => ({
  listarTodosLotesNota: vi.fn(async () => []),
  listarTodosProdutos: vi.fn(async () => []),
  listarTodasMovimentacoes: vi.fn(async () => h.movimentacoes),
  listarTodosLocais: vi.fn(async () => [{ id: 'loc-b', nome: 'Barracão', ativo: true }]),
}));
vi.mock('@/services/mapaService', () => ({
  listarPontosSuplementacaoAtivos: vi.fn(async () => []),
  listarAreasAtivas: vi.fn(async () => []),
  listarIconesPorTipoEntidade: vi.fn(async () => []),
}));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: vi.fn(async (chave) => (chave === 'movimentacaoEstoque' ? h.movimentacoes : [])),
  refreshMapaCacheEntry: (...a) => h.refresh(...a),
}));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => []) }));
vi.mock('@/services/suplementacaoEstoqueService', () => ({
  cancelarTransferenciaEntreDepositos: (...a) => h.cancelar(...a),
  consultarCancelamentoTransferencia: (...a) => h.consultar(...a),
  registrarTransferenciaEntreLocais: (...a) => h.registrar(...a),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const { default: DetalhesDepositoSuplementacao } = await import('@/components/mapa/DetalhesDepositoSuplementacao');
const { default: CancelarTransferenciaDeposito, mensagemDaRecusaTransferencia } = await import('@/components/mapa/deposito/CancelarTransferenciaDeposito');
const { movimentacoesDoHistoricoDeposito } = await import('@/components/suplementacao/HistoricoDepositoSuplementacao');
const { default: FormularioTransferenciaDeposito, JANELA_REENVIO_MS, TEXTO_TRANSFERENCIA_JA_REGISTRADA, TEXTO_TRANSFERENCIA_TALVEZ_REGISTRADA } = await import('@/components/mapa/FormularioTransferenciaDeposito');
const { TEXTO_PERMISSAO_REVOGADA_REENVIO } = await import('@/components/mapa/deposito/CancelarTransferenciaDeposito');
const { toast } = await import('sonner');

const EMP = 'emp-1';
const LOCAL = 'loc-sede';
const DEPOSITO = { id: 'd1', empresa_id: EMP, nome_ponto: 'Depósito Sede', categoria_ponto: 'DEPOSITO', status: 'Ativo', local_estoque_id: LOCAL, local_estoque_nome: 'Galpão Sede' };
const OPERADOR = { id: 'u-op', cliente_id: 'cli-1', login: 'operador', administrador_fazenda: false };
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const permissaoDoMapa = (mapa) => ({ modulos_permitidos: ['mapa'], permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', ...acoes(false), visualizar: true }], mapa_geral_permissoes: mapa });

const em = (dia) => ({ data_movimentacao: `${dia}T12:00:00.000Z`, created_date: `${dia}T12:00:00.000Z` });
const base = { empresa_id: EMP, produto_id: 'p-sal', produto_nome: 'SAL MINERAL', unidade_medida: 'KG', origem_sistema: 'deposito', quantidade: 100, valor_total: '250' };
const ENVIADA = { ...base, ...em('2026-11-10'), id: 'mv-s', numero_movimentacao: '41', tipo_movimentacao: 'Saída', tipo_detalhado: 'transferencia_enviada', status: 'Ativa', local_estoque_origem: LOCAL, local_origem: 'Galpão Sede', local_estoque_destino: 'loc-b', local_destino: 'Barracão' };
const RECEBIDA = { ...base, ...em('2026-11-09'), id: 'mv-r', numero_movimentacao: '38', tipo_movimentacao: 'Entrada', tipo_detalhado: 'transferencia_recebida', status: 'Ativa', local_estoque_origem: 'loc-b', local_origem: 'Barracão', local_estoque_destino: LOCAL, local_destino: 'Galpão Sede' };
const CANCELADA = { ...base, ...em('2026-11-08'), id: 'mv-c', numero_movimentacao: '30', tipo_movimentacao: 'Saída', tipo_detalhado: 'transferencia_enviada', status: 'Estornada', local_estoque_origem: LOCAL, local_estoque_destino: 'loc-b', local_destino: 'Barracão' };
const ESTORNOS = [
  { ...base, ...em('2026-11-11'), id: 'mv-ed', tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_transferencia_recebida', status: 'Ativa', local_estoque_origem: LOCAL },
  { ...base, ...em('2026-11-11'), id: 'mv-eo', tipo_movimentacao: 'Entrada', tipo_detalhado: 'estorno_transferencia_enviada', status: 'Ativa', local_estoque_destino: LOCAL },
];

const ELEGIVEL = { elegivel: true, pode_cancelar: true, codigo: null, motivo: null, detalhes: null, efeitos: { quantidade: '100.0000', unidade: 'KG', valor_total: '250.00', origem: { id: LOCAL, nome: 'Galpão Sede' }, destino: { id: 'loc-b', nome: 'Barracão' } } };
const erroDoServidor = (code, details = {}) => new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y', details, cause: { code, details, reason: details.reason } });
const erroDeRede = () => new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });

const tocar = async (el) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const cliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const montarDetalhes = async () => {
  const qc = cliente();
  render(
    <QueryClientProvider client={qc}>
      <DetalhesDepositoSuplementacao deposito={DEPOSITO} onClose={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByRole('region', { name: 'Nível do depósito' });
  await tocar(screen.getByRole('tab', { name: 'Histórico' }));
  await screen.findByRole('list', { name: 'Histórico do depósito' });
  return qc;
};
const cartoes = () => Array.from(document.querySelectorAll('.mk-dp-tl__card'));

const montarAcao = (props = {}) => {
  const qc = cliente();
  const onCancelado = vi.fn();
  const invalidar = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <CancelarTransferenciaDeposito movimento={ENVIADA} empresaId={EMP} escopo="cli-1:u-op" onCancelado={onCancelado} {...props} />
    </QueryClientProvider>,
  );
  return { qc, onCancelado, invalidar };
};
const abrirDialogo = async () => {
  await tocar(screen.getByRole('button', { name: 'Cancelar transferência' }));
  return screen.findByRole('dialog');
};
const escreverMotivo = (dialogo, texto) => fireEvent.change(within(dialogo).getByLabelText('Motivo do cancelamento'), { target: { value: texto } });
const botaoConfirmar = (dialogo) => within(dialogo).getAllByRole('button').find((b) => /^(Cancelar transferência|Tentar de novo|Cancelando\.\.\.)$/.test(b.textContent));

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  h.usuario = OPERADOR;
  h.permissao = permissaoDoMapa({ cancelar_lancamentos_estoque: true });
  h.movimentacoes = [ENVIADA, RECEBIDA, CANCELADA, ...ESTORNOS];
  h.cancelar.mockReset();
  h.consultar.mockReset();
  h.consultar.mockResolvedValue(ELEGIVEL);
  h.refresh.mockClear();
  h.registrar.mockReset();
});
afterEach(() => cleanup());

describe('CT-1 — o cartão no histórico do depósito', () => {
  it('com a chave: "Cancelar transferência" nas pernas Ativas deste depósito; Estornada com "Cancelado" e sem ação; estornos fora', async () => {
    await montarDetalhes();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Cancelar transferência' })).toHaveLength(2));
    const lista = cartoes();
    expect(lista).toHaveLength(3);
    const cancelado = lista.find((c) => c.classList.contains('is-cancelado'));
    expect(cancelado).toBeTruthy();
    expect(within(cancelado).getByText('Cancelado')).toBeTruthy();
    expect(within(cancelado).queryByRole('button', { name: 'Cancelar transferência' })).toBeNull();
    expect(h.consultar).not.toHaveBeenCalled();
  });

  it('sem a chave (ou só movimentar_depositos): nenhuma ação; admin real e is_admin: ação', async () => {
    h.permissao = permissaoDoMapa({ movimentar_depositos: true });
    await montarDetalhes();
    await waitFor(() => expect(cartoes()).toHaveLength(3));
    expect(screen.queryByRole('button', { name: 'Cancelar transferência' })).toBeNull();
    cleanup();
    h.permissao = permissaoDoMapa({ cancelar_lancamentos_estoque: 'true' });
    await montarDetalhes();
    await waitFor(() => expect(cartoes()).toHaveLength(3));
    expect(screen.queryByRole('button', { name: 'Cancelar transferência' })).toBeNull();
    cleanup();
    h.usuario = { ...OPERADOR, administrador_fazenda: true };
    h.permissao = null;
    await montarDetalhes();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Cancelar transferência' })).toHaveLength(2));
    cleanup();
    h.usuario = OPERADOR;
    h.permissao = { is_admin: true };
    await montarDetalhes();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Cancelar transferência' })).toHaveLength(2));
  });

  it('movimentacoesDoHistoricoDeposito tira os estorno_transferencia_* e mantém a original Estornada', () => {
    const ids = movimentacoesDoHistoricoDeposito(h.movimentacoes, { empresaId: EMP, localEstoqueId: LOCAL }).map((m) => m.id);
    expect(ids).toEqual(['mv-s', 'mv-r', 'mv-c']);
  });
});

describe('CT-2 — só online', () => {
  it('offline: botão desligado com o motivo; nenhuma chamada', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    montarAcao();
    const botao = screen.getByRole('button', { name: 'Cancelar transferência' });
    expect(botao.disabled).toBe(true);
    expect(screen.getByText(/Requer conexão/)).toBeTruthy();
    await tocar(botao);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.consultar).not.toHaveBeenCalled();
    expect(h.cancelar).not.toHaveBeenCalled();
  });
});

describe('CT-3 — ensaio recusado pelo servidor', () => {
  it('movimento posterior: a mensagem com o lado e o número; nenhum envio', async () => {
    h.consultar.mockResolvedValue({ elegivel: false, codigo: 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', detalhes: { reason: 'movimento_posterior', lado: 'destino', movimento_numero: '57' }, efeitos: null });
    montarAcao();
    const dialogo = await abrirDialogo();
    const alerta = await within(dialogo).findByTestId('recusa-elegibilidade-transferencia');
    expect(alerta.textContent).toBe('O produto já teve outro movimento no depósito de destino (nº 57) depois desta transferência. Para corrigir, lance uma transferência de volta. Nada foi alterado.');
    expect(within(dialogo).queryByLabelText('Motivo do cancelamento')).toBeNull();
    expect(h.consultar).toHaveBeenCalledWith(expect.objectContaining({ movimentacaoId: 'mv-s', empresaId: EMP }));
    expect(h.cancelar).not.toHaveBeenCalled();
  });

  it('mensagens por reason', () => {
    const m = (reason, extra = {}) => mensagemDaRecusaTransferencia('TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', { reason, ...extra });
    expect(m('camada_consumida')).toBe('O estoque recebido já foi usado; não é possível cancelar. Nada foi alterado.');
    expect(m('saldo_local_divergente')).toBe(m('camada_consumida'));
    expect(m('fatias_ausentes')).toBe('Transferência antiga, sem rastreio de lotes; não pode ser cancelada. Nada foi alterado.');
    expect(m('par_incoerente')).toBe(m('fatias_ausentes'));
    expect(m('original_ja_estornado')).toBe('Esta transferência já foi cancelada.');
    expect(m('movimento_posterior', { lado: 'origem' })).toMatch(/^O produto já teve outro movimento no depósito de origem depois/);
    expect(mensagemDaRecusaTransferencia('ESTOQUE_LOCAL_INVALIDO', { reason: 'local_inativo' })).toMatch(/^O depósito de origem está inativo/);
    expect(mensagemDaRecusaTransferencia('ACAO_NAO_PERMITIDA')).toBe('Você não tem permissão para cancelar transferências entre depósitos.');
  });
});

describe('CT-4 — sucesso', () => {
  it('envia motivo + operation_id, relê o cache com force, invalida as consultas e chama onCancelado; o botão some', async () => {
    h.cancelar.mockResolvedValue({ committed: true, replay: false });
    const { onCancelado, invalidar } = montarAcao();
    const dialogo = await abrirDialogo();
    await within(dialogo).findByLabelText('Motivo do cancelamento');
    expect(within(dialogo).getByText('Galpão Sede: +100 kg (volta ao depósito de origem)')).toBeTruthy();
    expect(botaoConfirmar(dialogo).disabled).toBe(true);
    escreverMotivo(dialogo, '  lançada no depósito errado  ');
    await tocar(botaoConfirmar(dialogo));
    expect(h.cancelar).toHaveBeenCalledTimes(1);
    const args = h.cancelar.mock.calls[0][0];
    expect(args).toEqual({ movimentacaoId: 'mv-s', empresaId: EMP, motivo: 'lançada no depósito errado', operationId: expect.stringMatching(/^cancelar-transf-/) });
    await waitFor(() => expect(onCancelado).toHaveBeenCalledTimes(1));
    expect(h.refresh).toHaveBeenCalledWith('movimentacaoEstoque', EMP, { force: true });
    expect(h.refresh).toHaveBeenCalledWith('estoqueLotes', EMP, { force: true });
    const prefixos = invalidar.mock.calls.map(([f]) => f);
    expect(prefixos.length).toBeGreaterThan(0);
    const consulta = (k) => ({ queryKey: [k] });
    for (const k of ['saldo-deposito', 'movimentacoes-deposito-detalhe', 'historico-deposito', 'estoque-lotes-transferencia', 'cochos-vinculados-deposito']) {
      expect(prefixos.some((f) => f.predicate?.(consulta(k))), k).toBe(true);
    }
    expect(screen.queryByRole('button', { name: 'Cancelar transferência' })).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('replay:true conta como sucesso', async () => {
    h.cancelar.mockResolvedValue({ committed: true, replay: true });
    const { onCancelado } = montarAcao();
    const dialogo = await abrirDialogo();
    await within(dialogo).findByLabelText('Motivo do cancelamento');
    escreverMotivo(dialogo, 'duplicada');
    await tocar(botaoConfirmar(dialogo));
    await waitFor(() => expect(onCancelado).toHaveBeenCalledTimes(1));
  });
});

describe('CT-5 — resultado desconhecido', () => {
  it('erro de rede: aviso; reenvio e reabertura usam a MESMA operation_id e o MESMO motivo', async () => {
    h.cancelar.mockRejectedValueOnce(erroDeRede()).mockRejectedValueOnce(erroDeRede()).mockResolvedValueOnce({ committed: true, replay: true });
    const { onCancelado } = montarAcao();
    let dialogo = await abrirDialogo();
    await within(dialogo).findByLabelText('Motivo do cancelamento');
    escreverMotivo(dialogo, 'lançada em dobro');
    await tocar(botaoConfirmar(dialogo));
    expect(await within(dialogo).findByText(/Sem confirmação do servidor/)).toBeTruthy();
    const chave = h.cancelar.mock.calls[0][0].operationId;
    await tocar(botaoConfirmar(dialogo));
    expect(h.cancelar.mock.calls[1][0]).toEqual(h.cancelar.mock.calls[0][0]);
    // fecha e reabre: a pendência gravada volta com a mesma chave e o mesmo motivo
    await tocar(within(dialogo).getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/Cancelamento anterior sem confirmação/)).toBeTruthy();
    dialogo = await abrirDialogo();
    expect(within(dialogo).getByLabelText('Motivo do cancelamento').value).toBe('lançada em dobro');
    await tocar(botaoConfirmar(dialogo));
    expect(h.cancelar.mock.calls[2][0]).toEqual({ movimentacaoId: 'mv-s', empresaId: EMP, motivo: 'lançada em dobro', operationId: chave });
    await waitFor(() => expect(onCancelado).toHaveBeenCalledTimes(1));
  });
});

describe('CT-6 — recusa definitiva no POST', () => {
  it('mensagem do reason, pendência limpa e chave nova no próximo envio', async () => {
    h.cancelar.mockRejectedValueOnce(erroDoServidor('TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', { reason: 'camada_consumida' })).mockResolvedValueOnce({ committed: true });
    montarAcao();
    const dialogo = await abrirDialogo();
    await within(dialogo).findByLabelText('Motivo do cancelamento');
    escreverMotivo(dialogo, 'motivo qualquer');
    await tocar(botaoConfirmar(dialogo));
    expect(await within(dialogo).findByText('O estoque recebido já foi usado; não é possível cancelar. Nada foi alterado.')).toBeTruthy();
    expect(localStorage.length).toBe(0);
    await waitFor(() => expect(botaoConfirmar(dialogo).disabled).toBe(false));
    await tocar(botaoConfirmar(dialogo));
    expect(h.cancelar).toHaveBeenCalledTimes(2);
    expect(h.cancelar.mock.calls[1][0].operationId).not.toBe(h.cancelar.mock.calls[0][0].operationId);
  });

  it('já cancelada (original_ja_estornado): trata como concluída e recarrega', async () => {
    h.cancelar.mockRejectedValueOnce(erroDoServidor('TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', { reason: 'original_ja_estornado' }));
    const { onCancelado } = montarAcao();
    const dialogo = await abrirDialogo();
    await within(dialogo).findByLabelText('Motivo do cancelamento');
    escreverMotivo(dialogo, 'motivo qualquer');
    await tocar(botaoConfirmar(dialogo));
    await waitFor(() => expect(onCancelado).toHaveBeenCalledTimes(1));
    expect(h.refresh).toHaveBeenCalledWith('movimentacaoEstoque', EMP, { force: true });
  });
});

describe('CT-7 — a porta antiga continua fechada', () => {
  it('o componente, o hook e o serviço novos não usam a política de estorno nem a reversão do navegador', () => {
    for (const arquivo of ['src/components/mapa/deposito/CancelarTransferenciaDeposito.jsx', 'src/components/mapa/deposito/usePodeCancelarLancamentosEstoque.js', 'src/services/suplementacaoEstoqueService.js', 'src/components/mapa/DetalhesDepositoSuplementacao.jsx']) {
      const fonte = readFileSync(resolve(process.cwd(), arquivo), 'utf8');
      expect(fonte.includes('politicaEstorno'), arquivo).toBe(false);
      expect(/excluirTransferencia/.test(fonte), arquivo).toBe(false);
    }
  });
});

describe('CT-8 — formulário de Entrada/Saída: operation_id persistida por envio', () => {
  const PRODUTO = { id: 'p-sal', empresa_id: EMP, nome_produto: 'SAL MINERAL', tipo_uso: 'Nutrição Animal', unidade_medida: 'KG', unidade_principal_estoque: 'KG' };
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });
  it('reenvio depois de falha de rede usa a MESMA chave; depois do sucesso, chave nova', async () => {
    window.matchMedia = /** @type {any} */ ((q) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    const estoque = await import('@/services/estoqueMapaService');
    vi.mocked(estoque.listarTodosProdutos).mockResolvedValue([PRODUTO]);
    vi.mocked(estoque.listarTodosLotesNota).mockResolvedValue([{ id: 'l1', empresa_id: EMP, produto_id: 'p-sal', produto_nome: 'SAL MINERAL', local_estoque_id: LOCAL, local_estoque_nome: 'Galpão Sede', quantidade_disponivel: 500, status: 'Disponivel' }]);
    h.registrar.mockRejectedValueOnce(erroDeRede()).mockResolvedValueOnce({ committed: true }).mockResolvedValueOnce({ committed: true });
    const qc = cliente();
    render(
      <QueryClientProvider client={qc}>
        <FormularioTransferenciaDeposito deposito={DEPOSITO} initialDirection="saida" onSuccess={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    const form = await screen.findByTestId('form-transferencia-deposito');
    const tocarCampo = async (el) => {
      await act(async () => {
        el.focus();
      });
      await tocar(el);
    };
    await tocarCampo(screen.getByLabelText(/^Local de Destino/));
    await tocar(await screen.findByRole('option', { name: 'Barracão' }));
    await waitFor(async () => {
      await tocarCampo(screen.getByRole('combobox', { name: /^Produto de Suplementação/ }));
      expect(screen.getByRole('option', { name: 'SAL MINERAL (KG)' })).toBeTruthy();
    });
    await tocar(screen.getByRole('option', { name: 'SAL MINERAL (KG)' }));
    fireEvent.change(screen.getByLabelText(/^Quantidade \(kg\)/), { target: { value: '10' } });
    const enviar = async () => {
      await act(async () => {
        fireEvent.submit(form);
      });
    };
    await enviar();
    await enviar();
    expect(h.registrar).toHaveBeenCalledTimes(2);
    const [primeira, segunda] = h.registrar.mock.calls.map(([a]) => a.operationId);
    expect(primeira).toMatch(/^transf-/);
    expect(segunda).toBe(primeira);
    await enviar();
    expect(h.registrar).toHaveBeenCalledTimes(3);
    expect(h.registrar.mock.calls[2][0].operationId).not.toBe(primeira);
  });
});

const fecharComEsc = async () => {
  await act(async () => {
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};

describe('CT-9 — revisão do diálogo de cancelamento', () => {
  it('ensaio "já cancelada": mostra a mensagem e, ao fechar, relê (force) e chama onCancelado', async () => {
    h.consultar.mockResolvedValue({ elegivel: false, codigo: 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', detalhes: { reason: 'original_ja_estornado' }, efeitos: null });
    const { onCancelado } = montarAcao();
    const dialogo = await abrirDialogo();
    expect((await within(dialogo).findByTestId('recusa-elegibilidade-transferencia')).textContent).toBe('Esta transferência já foi cancelada.');
    expect(h.refresh).not.toHaveBeenCalled();
    await fecharComEsc();
    await waitFor(() => expect(onCancelado).toHaveBeenCalledTimes(1));
    expect(h.refresh).toHaveBeenCalledWith('movimentacaoEstoque', EMP, { force: true });
    expect(h.cancelar).not.toHaveBeenCalled();
  });

  it('ensaio 404: "não encontrada" (não o erro genérico) e recarrega ao fechar', async () => {
    h.consultar.mockRejectedValue(erroDoServidor('MOVIMENTACAO_ESTOQUE_NOT_FOUND'));
    const { onCancelado } = montarAcao();
    const dialogo = await abrirDialogo();
    expect((await within(dialogo).findByTestId('recusa-elegibilidade-transferencia')).textContent).toBe('Transferência não encontrada nesta fazenda. Nada foi alterado.');
    expect(within(dialogo).queryByText(/Não foi possível conferir/)).toBeNull();
    await fecharComEsc();
    await waitFor(() => expect(onCancelado).toHaveBeenCalledTimes(1));
  });

  it('falha de rede no ensaio: "Conferir de novo" refaz o GET sem fechar', async () => {
    h.consultar.mockRejectedValueOnce(erroDeRede()).mockResolvedValueOnce(ELEGIVEL);
    const { onCancelado } = montarAcao();
    const dialogo = await abrirDialogo();
    await within(dialogo).findByText('Não foi possível conferir agora.');
    await tocar(within(dialogo).getByRole('button', { name: 'Conferir de novo' }));
    await within(dialogo).findByLabelText('Motivo do cancelamento');
    expect(h.consultar).toHaveBeenCalledTimes(2);
    await fecharComEsc();
    expect(onCancelado).not.toHaveBeenCalled();
  });

  it('403 num reenvio de resultado desconhecido: não conclusivo, a pendência (mesma chave) fica; relê ao fechar', async () => {
    h.cancelar.mockRejectedValueOnce(erroDeRede()).mockRejectedValueOnce(erroDoServidor('ACAO_NAO_PERMITIDA'));
    const { onCancelado } = montarAcao();
    const dialogo = await abrirDialogo();
    await within(dialogo).findByLabelText('Motivo do cancelamento');
    escreverMotivo(dialogo, 'lançada em dobro');
    await tocar(botaoConfirmar(dialogo));
    await within(dialogo).findByText(/Sem confirmação do servidor/);
    const chave = h.cancelar.mock.calls[0][0].operationId;
    await tocar(botaoConfirmar(dialogo));
    expect(await within(dialogo).findByText(TEXTO_PERMISSAO_REVOGADA_REENVIO)).toBeTruthy();
    expect(within(dialogo).queryByText('Você não tem permissão para cancelar transferências entre depósitos.')).toBeNull();
    const guardado = JSON.parse(localStorage.getItem(`maike_cancelar_transferencia_pendente:cli-1:u-op:${ENVIADA.id}`));
    expect(guardado).toEqual(expect.objectContaining({ operation_id: chave, motivo: 'lançada em dobro' }));
    expect(h.cancelar.mock.calls[1][0].operationId).toBe(chave);
    await tocar(within(dialogo).getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(onCancelado).toHaveBeenCalledTimes(1));
    expect(h.refresh).toHaveBeenCalledWith('movimentacaoEstoque', EMP, { force: true });
  });

  it('acessibilidade: ajuda do motivo por aria-describedby, aria-invalid com < 3; foco no cartão depois do sucesso', async () => {
    h.cancelar.mockResolvedValue({ committed: true, replay: false });
    const qc = cliente();
    render(
      <QueryClientProvider client={qc}>
        <ul>
          <li data-testid="cartao">
            <CancelarTransferenciaDeposito movimento={ENVIADA} empresaId={EMP} escopo="cli-1:u-op" />
          </li>
        </ul>
      </QueryClientProvider>,
    );
    const dialogo = await abrirDialogo();
    const campo = await within(dialogo).findByLabelText('Motivo do cancelamento');
    const ajuda = document.getElementById(campo.getAttribute('aria-describedby'));
    expect(ajuda?.textContent).toBe('Obrigatório: de 3 a 500 caracteres.');
    escreverMotivo(dialogo, 'ok');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(botaoConfirmar(dialogo).disabled).toBe(true);
    escreverMotivo(dialogo, 'lançada errado');
    expect(campo.getAttribute('aria-invalid')).toBeNull();
    await tocar(botaoConfirmar(dialogo));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const cartao = screen.getByTestId('cartao');
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    expect(within(cartao).getByRole('status').textContent).toBe('Transferência cancelada.');
  });
});

describe('CT-10 — revisão do formulário de Entrada/Saída', () => {
  const PRODUTO = { id: 'p-sal', empresa_id: EMP, nome_produto: 'SAL MINERAL', tipo_uso: 'Nutrição Animal', unidade_medida: 'KG', unidade_principal_estoque: 'KG' };
  const lote = (kg) => ({ id: 'l1', empresa_id: EMP, produto_id: 'p-sal', produto_nome: 'SAL MINERAL', local_estoque_id: LOCAL, local_estoque_nome: 'Galpão Sede', quantidade_disponivel: kg, status: 'Disponivel' });
  const original = window.matchMedia;
  let onSuccess;
  beforeEach(async () => {
    window.matchMedia = /** @type {any} */ ((q) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    const estoque = await import('@/services/estoqueMapaService');
    vi.mocked(estoque.listarTodosProdutos).mockResolvedValue([PRODUTO]);
    vi.mocked(estoque.listarTodosLotesNota).mockResolvedValue([lote(500)]);
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.warning).mockClear();
    onSuccess = vi.fn();
  });
  afterEach(() => {
    window.matchMedia = original;
    vi.restoreAllMocks();
  });
  const tocarCampo = async (el) => {
    await act(async () => {
      el.focus();
    });
    await tocar(el);
  };
  /** Monta o formulário de Saída e preenche Barracão · SAL MINERAL · `kg`. Devolve `enviar`. */
  const montarEPreencher = async (kg = '10') => {
    render(
      <QueryClientProvider client={cliente()}>
        <FormularioTransferenciaDeposito deposito={DEPOSITO} initialDirection="saida" onSuccess={onSuccess} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    const form = await screen.findByTestId('form-transferencia-deposito');
    await tocarCampo(screen.getByLabelText(/^Local de Destino/));
    await tocar(await screen.findByRole('option', { name: 'Barracão' }));
    await waitFor(async () => {
      await tocarCampo(screen.getByRole('combobox', { name: /^Produto de Suplementação/ }));
      expect(screen.getByRole('option', { name: 'SAL MINERAL (KG)' })).toBeTruthy();
    });
    await tocar(screen.getByRole('option', { name: 'SAL MINERAL (KG)' }));
    fireEvent.change(screen.getByLabelText(/^Quantidade \(kg\)/), { target: { value: kg } });
    return async () => {
      await act(async () => {
        fireEvent.submit(form);
      });
    };
  };
  const chaves = () => h.registrar.mock.calls.map(([a]) => a.operationId);

  it('pendência de outra abertura: mesma chave; replay não é "registrada" (aviso, sem onSuccess) e o próximo envio é outra operação', async () => {
    h.registrar.mockRejectedValueOnce(erroDeRede()).mockResolvedValueOnce({ committed: true, replay: true }).mockResolvedValueOnce({ committed: true, replay: false });
    let enviar = await montarEPreencher();
    await enviar();
    cleanup();
    enviar = await montarEPreencher();
    await enviar();
    expect(chaves()[1]).toBe(chaves()[0]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(TEXTO_TRANSFERENCIA_JA_REGISTRADA);
    expect(screen.getByTestId('transferencia-aviso-envio-anterior').textContent).toBe(TEXTO_TRANSFERENCIA_JA_REGISTRADA);
    expect(h.refresh).toHaveBeenCalledWith('movimentacaoEstoque', EMP, { force: true });
    await enviar();
    expect(chaves()[2]).not.toBe(chaves()[0]);
    expect(toast.success).toHaveBeenCalledWith('Transferência registrada.');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('pendência vencida (> janela): a transferência igual lançada mais tarde nasce com chave nova', async () => {
    h.registrar.mockRejectedValueOnce(erroDeRede()).mockResolvedValueOnce({ committed: true, replay: false });
    let enviar = await montarEPreencher();
    await enviar();
    cleanup();
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + JANELA_REENVIO_MS + 1000);
    enviar = await montarEPreencher();
    await enviar();
    expect(chaves()).toHaveLength(2);
    expect(chaves()[1]).not.toBe(chaves()[0]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('IDEMPOTENCY_CONFLICT (rateio mudou depois do 1º envio): a chave FICA e o reenvio repete a mesma operação', async () => {
    h.registrar.mockRejectedValueOnce(erroDeRede()).mockRejectedValueOnce(erroDoServidor('IDEMPOTENCY_CONFLICT')).mockRejectedValueOnce(erroDoServidor('IDEMPOTENCY_CONFLICT'));
    let enviar = await montarEPreencher();
    await enviar();
    cleanup();
    enviar = await montarEPreencher();
    await enviar();
    expect(await screen.findByTestId('transferencia-aviso-envio-anterior')).toBeTruthy();
    expect(screen.getByTestId('transferencia-aviso-envio-anterior').textContent).toBe(TEXTO_TRANSFERENCIA_TALVEZ_REGISTRADA);
    await enviar();
    expect(chaves()).toHaveLength(3);
    expect(new Set(chaves()).size).toBe(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(Object.keys(localStorage).some((k) => k.startsWith('maike_transferencia_deposito_envio:'))).toBe(true);
  });

  it('pendência do mesmo conteúdo e saldo que já não cobre: "pode já ter sido registrada", sem enviar', async () => {
    h.registrar.mockRejectedValueOnce(erroDeRede());
    let enviar = await montarEPreencher();
    await enviar();
    cleanup();
    const estoque = await import('@/services/estoqueMapaService');
    vi.mocked(estoque.listarTodosLotesNota).mockResolvedValue([lote(5)]);
    enviar = await montarEPreencher();
    await enviar();
    expect(h.registrar).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(TEXTO_TRANSFERENCIA_TALVEZ_REGISTRADA);
  });
});
