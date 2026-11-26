/**
 * D-PROD-328 — fila única: fotos, tarefas do armazenamento antigo, o registro "confirmando" e a tela.
 *
 * FU-06 foto recusada pelo servidor: conta a tentativa e o motivo; depois de 3, para de tentar sozinha (precisa de
 *       atenção); "Tentar de novo" envia de novo; "Excluir" tira as fotos do aparelho
 * FU-07 tarefa do armazenamento antigo sem como saber qual tarefa altera: precisa de atenção, com o motivo; excluir tira
 * FU-08 registro do motor "confirmando" (tentou, sem resposta): agora pode sair, com o aviso
 * FU-09 tela: todo item tem "Ver detalhes" (o que aconteceu e o conteúdo), "Excluir" (com confirmação) e
 *       "Tentar de novo"
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const API = 'https://backend.exemplo.invalido';
const respostaJson = (status, corpo) => ({ ok: status >= 200 && status < 300, status, text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)) });

/** Servidor que recusa o upload (400) — a foto nunca sobe. */
const servidorQueRecusa = () => {
  const s = { uploads: 0 };
  s.fetch = vi.fn(async (url, init = {}) => {
    const caminho = String(url).replace(`${API}/api/native`, '').split('?')[0];
    if ((init.method || 'GET') === 'POST' && caminho === '/arquivos/upload') {
      s.uploads += 1;
      return respostaJson(400, { code: 'ATTACHMENT_INVALID', message: 'arquivo excede limite para upload nativo' });
    }
    return respostaJson(200, []);
  });
  return s;
};

const carregar = async () => {
  (await import('@/lib/auth/nativeTokenStorage')).setNativeToken('jwt.sintetico', { lembrar: true });
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_1');
  const idb = await import('@/components/offline/IndexedDBManager');
  for (const f of await idb.getAllPendingTarefaImages()) await idb.deleteTarefaImageOffline(f._imgId);
  for (const t of await idb.getPendingTarefas()) await idb.deletePendingTarefa(t._offlineId);
  return {
    idb,
    fotos: await import('@/services/fotosDeTarefaAguardandoService'),
    servico: await import('@/services/sincronizacaoService'),
  };
};
const foto = (nome = 'cerca.jpg') => ({ name: nome, type: 'image/jpeg', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock('@/hooks/useFilaDeEnvio');
  vi.doUnmock('@/services/sincronizacaoService');
  vi.doUnmock('@/lib/maikeConfirmar');
});

describe('D-PROD-328 — fila única (fotos, tarefas antigas, motor)', () => {
  it('FU-06 foto recusada: conta, para depois de 3, tenta de novo e exclui', async () => {
    const srv = servidorQueRecusa();
    vi.stubGlobal('fetch', srv.fetch);
    const { fotos, servico } = await carregar();
    await fotos.guardarFotosDaTarefa('t-1', [foto()]);
    for (let i = 0; i < 3; i += 1) expect(await fotos.enviarFotosDeTarefasGuardadas()).toMatchObject({ falharam: 1 });
    expect(srv.uploads).toBe(3);
    await fotos.enviarFotosDeTarefasGuardadas();
    expect(srv.uploads, 'parou de tentar sozinha').toBe(3);

    let [item] = (await servico.lerFilaDeEnvio()).itens.filter((i) => i.origem === 'foto');
    expect(item).toMatchObject({ id: 'foto:t-1', estado: 'atencao', tentativas: 3, rotulo: 'Foto de tarefa', podeTentar: true });
    expect(item.motivo).toMatch(/Arquivo inválido/);

    await servico.tentarEnviarDeNovo(item.id);
    expect(srv.uploads, '"Tentar de novo" envia já').toBe(4);
    [item] = (await servico.lerFilaDeEnvio()).itens.filter((i) => i.origem === 'foto');
    expect(item.tentativas).toBe(1);

    await servico.descartarRegistroNaoEnviado(item.id);
    expect((await servico.lerFilaDeEnvio()).itens.filter((i) => i.origem === 'foto')).toEqual([]);
    expect(await fotos.fotosAguardandoDaTarefa('t-1')).toBe(0);
  });

  it('FU-07 tarefa antiga sem saber qual alterar: atenção com o motivo; excluir tira', async () => {
    vi.stubGlobal('fetch', servidorQueRecusa().fetch);
    const { idb, servico } = await carregar();
    await idb.saveTarefaOffline('update', { titulo: 'Cerca da divisa' });
    const [item] = (await servico.lerFilaDeEnvio()).itens.filter((i) => i.origem === 'tarefa-antiga');
    expect(item).toMatchObject({ estado: 'atencao', rotulo: 'Alteração da tarefa: Cerca da divisa' });
    expect(item.motivo).toMatch(/qual tarefa/);
    expect(await servico.descartarRegistroNaoEnviado(item.id)).toBe(true);
    expect(await idb.getPendingTarefas()).toEqual([]);
  });

  it('FU-08 o registro "confirmando" do motor pode sair (com o aviso)', async () => {
    const motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
    const { criarFilaEmMemoria } = await import('@/lib/offline/sincronizacao/filaDeEnvio');
    const erros = await import('@/apis/_core/ApiError');
    const fila = criarFilaEmMemoria();
    motor.configurarMotorDeSincronizacao({ porta: fila, agora: () => Date.parse('2026-11-25T12:00:00Z'), online: () => true });
    motor.definirSessaoDaFila({ cliente_id: 'cli_A', usuario_id: 'usr_1' });
    try {
      motor.registrarTipoDeEnvio({
        tipo: 'cocho.leitura', versao: 1, offline: true,
        enviar: async () => { throw new erros.ApiError(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' }); },
      });
      await motor.enviarOuGuardar('cocho.leitura', { escore: 1 }, { operationId: 'op-c', rotulo: 'Leitura do cocho C1' });
      expect(await motor.situacaoNaFila('op-c')).toBe('confirmando');
      expect(await motor.descartarDaFila('op-c'), 'sem a decisão da pessoa, fica').toBe(false);
      const servico = await import('@/services/sincronizacaoService');
      const [item] = (await servico.lerFilaDeEnvio()).itens.filter((i) => i.origem === 'motor');
      expect(item).toMatchObject({ estado: 'confirmando', podeTentar: true });
      expect(item.avisoAoExcluir).toMatch(/pode já ter chegado/);
      expect(await servico.descartarRegistroNaoEnviado('op-c')).toBe(true);
      expect(await motor.situacaoNaFila('op-c')).toBeNull();
    } finally {
      motor.definirSessaoDaFila(null);
    }
  });
});

describe('D-PROD-328 — a tela da fila', () => {
  it('FU-09 Ver detalhes, Excluir (confirmando) e Tentar de novo em todo item', async () => {
    const acoes = { tentar: vi.fn(async () => undefined), excluir: vi.fn(async () => true) };
    const confirmar = vi.fn(async () => true);
    const recarregar = vi.fn();
    const item = (extra) => ({
      origem: 'cadastro', tipo: 'cadastro', criado_em: '2026-11-26T10:00:00.000Z', tentativas: 0, ultimaTentativaEm: null,
      podeTentar: true, avisoAoExcluir: null, detalhes: [], confirmando: false, progresso: {}, ultimo_erro: null, motivo: null, ...extra,
    });
    const itens = [
      item({ id: 'foto:t-1', origem: 'foto', rotulo: 'Foto de tarefa', estado: 'atencao', tentativas: 3, ultimaTentativaEm: '2026-11-26T11:00:00.000Z', motivo: 'arquivo excede limite', avisoAoExcluir: 'As fotos saem do celular e não vão para a tarefa.', detalhes: [{ rotulo: 'Fotos', valor: '1' }] }),
      item({ id: 'op-1', origem: 'motor', rotulo: 'Leitura do cocho C1', estado: 'confirmando' }),
      item({ id: 'cadastro:2', rotulo: 'Exclusão de bebedouro: B9', estado: 'atencao', podeTentar: false, motivo: 'Esta exclusão só pode ser feita com internet, na própria tela.' }),
    ];
    vi.doMock('@/hooks/useFilaDeEnvio', () => ({ useFilaDeEnvio: () => ({ aguardando: 1, atencao: 2, enviando: false, itens, outrosAguardando: 0, carregado: true, recarregar }) }));
    vi.doMock('@/services/sincronizacaoService', () => ({
      enviarAgora: vi.fn(),
      tentarEnviarDeNovo: (...a) => acoes.tentar(...a),
      descartarRegistroNaoEnviado: (...a) => acoes.excluir(...a),
      dependentesDoRegistro: vi.fn(async () => []),
    }));
    vi.doMock('@/lib/maikeConfirmar', () => ({ confirmar: (...a) => confirmar(...a) }));
    const { default: FilaDeEnvio } = await import('@/components/offline/FilaDeEnvio');
    render(<FilaDeEnvio />);

    const linhas = within(screen.getByRole('list', { name: 'Fila de envio' })).getAllByRole('listitem');
    expect(linhas).toHaveLength(3);
    for (const l of linhas) {
      expect(within(l).getByRole('button', { name: 'Ver detalhes' })).toBeTruthy();
      expect(within(l).getByRole('button', { name: 'Excluir' })).toBeTruthy();
    }
    expect(within(linhas[1]).getByText(/esperando a confirmação/)).toBeTruthy();
    expect(within(linhas[2]).queryByRole('button', { name: 'Tentar de novo' }), 'retido: só excluir').toBeNull();

    fireEvent.click(within(linhas[0]).getByRole('button', { name: 'Ver detalhes' }));
    const detalhes = within(linhas[0]).getByLabelText('Detalhes de Foto de tarefa');
    expect(detalhes.textContent).toContain('Tentativas com erro3');
    expect(detalhes.textContent).toContain('O que aconteceuarquivo excede limite');
    expect(detalhes.textContent).toContain('Fotos1');

    await act(async () => { fireEvent.click(within(linhas[0]).getByRole('button', { name: 'Tentar de novo' })); });
    expect(acoes.tentar).toHaveBeenCalledWith('foto:t-1');
    await act(async () => { fireEvent.click(within(linhas[0]).getByRole('button', { name: 'Excluir' })); });
    expect(confirmar.mock.calls[0][0].descricao).toContain('As fotos saem do celular');
    expect(acoes.excluir).toHaveBeenCalledWith('foto:t-1');
    expect(recarregar).toHaveBeenCalled();
  });
});
