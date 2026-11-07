/**
 * MAIKE-SAAS-ADMIN-S04-P3 PR01 — reemissão de senha temporária na ficha do cliente (jsdom).
 *
 * Transporte REAL do MAIKE Admin (`apps/admin/src/api.js`) até um `fetch` falso
 * por rota. Prova:
 *  - o botão só aparece para conta ativa de cliente ativo;
 *  - o aviso cita sessões encerradas e lançamentos offline;
 *  - o envio exige confirmação, justificativa e reautenticação, e vai com CSRF
 *    e o If-Match da conta;
 *  - a senha aparece UMA vez e nunca em storage, URL, aviso ou console;
 *  - 401 deixa corrigir; 409/428 e resultado incerto (5xx/rede) relêem a lista
 *    SEM repetir o POST;
 *  - os campos sensíveis são limpos.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

import Clientes from '../../apps/admin/src/telas/Clientes.jsx';
import { definirCsrf } from '../../apps/admin/src/api.js';

const NOVA = 'Qw3e-Rt4y-Up5a-Sd6f';
const SENHA_ADMIN = 'senha-do-proprietario-1';
const REV1 = `"u1-${'a'.repeat(43)}"`;
const REV2 = `"u1-${'b'.repeat(43)}"`;
const pagina = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 25 });
const cliente = (extra = {}) => ({ id: 'cl0001', codigo: 'fazenda-um', nome: 'Fazenda Um', ativo: true, criado_em: '2026-11-01T12:00:00.000Z', usuarios_total: 2, empresas_total: 0, ...extra });
const usuario = (extra = {}) => ({ id: 'us0001', nome: 'Ana Gestora', login: 'ana.lab', ativo: true, criado_em: '2026-11-01T12:00:00.000Z', revisao: REV1, reemissao_disponivel: true, ...extra });
const ficha = (c) => ({
  cliente: { id: c.id, codigo: c.codigo, nome: c.nome, ativo: c.ativo, criado_em: c.criado_em, atualizado_em: c.criado_em },
  contagens: { usuarios: 2, usuarios_ativos: 1, empresas: 0 },
});

const servidor = (rotas) => {
  const chamadas = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const metodo = init.method || 'GET';
      const u = new URL(String(url), 'http://admin.local');
      const caminho = u.pathname.replace('/api/native', '');
      const corpo = init.body ? JSON.parse(init.body) : undefined;
      chamadas.push({ metodo, caminho, corpo, headers: init.headers || {}, url: String(url) });
      const h = rotas[`${metodo} ${caminho}`];
      if (h === 'rede') throw new TypeError('Failed to fetch');
      const [status, resposta, cab = {}] = h ? await h(corpo, u) : [404, { code: 'NOT_FOUND', message: caminho }];
      return {
        ok: status < 400,
        status,
        headers: { get: (n) => cab[n.toLowerCase()] ?? null },
        text: async () => (resposta === undefined ? '' : JSON.stringify(resposta)),
      };
    })
  );
  return chamadas;
};

const URL_REEMITIR = '/admin-maike/clientes/cl0001/usuarios/us0001/reemitir-senha';
const base = (c, usuarios) => ({
  'GET /admin-maike/clientes': () => [200, pagina([c])],
  'GET /admin-maike/clientes/cl0001': () => [200, ficha(c), { etag: `"r1-${'c'.repeat(43)}"` }],
  'GET /admin-maike/clientes/cl0001/empresas': () => [200, pagina([])],
  'GET /admin-maike/clientes/cl0001/usuarios': () => [200, pagina(usuarios())],
});

const abrirFicha = async () => {
  render(<Clientes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ver ficha de Fazenda Um' }));
  return screen.findByTestId('ficha-cliente');
};

const abrirReemissao = async () => {
  const painel = await abrirFicha();
  fireEvent.click(await within(painel).findByRole('button', { name: 'Reemitir senha temporária de ana.lab' }));
  return within(painel).findByTestId('reemitir-senha');
};

const preencherEEnviar = (form, { codigo = '123456' } = {}) => {
  fireEvent.click(within(form).getByRole('checkbox'));
  fireEvent.change(within(form).getByLabelText(/Justificativa/), { target: { value: 'administradora perdeu a senha inicial' } });
  fireEvent.change(within(form).getByLabelText(/Sua senha atual/), { target: { value: SENHA_ADMIN } });
  fireEvent.change(within(form).getByLabelText(/Código do autenticador/), { target: { value: codigo } });
  fireEvent.click(within(form).getByRole('button', { name: 'Reemitir senha' }));
};

beforeEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  definirCsrf('csrf-da-sessao');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('S04-P3 reemissão — interface', () => {
  it('RU-00 gate de ativação: sem `reemissao_disponivel === true` vindo do SERVIDOR a ação não é oferecida (nem com localStorage/URL)', async () => {
    window.localStorage.setItem('ADMIN_REEMISSAO_SENHA_HABILITADA', 'true');
    window.history.replaceState(null, '', '/?reemissao=true');
    const chamadas = servidor(
      base(cliente(), () => [
        usuario({ reemissao_disponivel: false }),
        usuario({ id: 'us0002', login: 'sem.campo', nome: 'Sem Campo', reemissao_disponivel: undefined }),
      ])
    );
    const painel = await abrirFicha();
    await within(painel).findByText('sem.campo');
    expect(within(painel).queryByRole('button', { name: /Reemitir senha temporária/ })).toBeNull();
    expect(within(painel).queryByTestId('reemitir-senha')).toBeNull();
    expect(chamadas.some((c) => c.caminho.endsWith('/reemitir-senha'))).toBe(false);
    window.history.replaceState(null, '', '/');
  });

  it('RU-00b gate desligado no servidor enquanto o formulário estava aberto: 503 do gate = resultado CERTO (nada mudou), sem aviso de senha invalidada e sem repetir', async () => {
    const chamadas = servidor({
      ...base(cliente(), () => [usuario()]),
      [`POST ${URL_REEMITIR}`]: () => [503, { code: 'ADMIN_REEMISSAO_SENHA_DESABILITADA', message: 'x' }],
    });
    const form = await abrirReemissao();
    preencherEEnviar(form);
    expect(await screen.findByText(/está desligada neste ambiente\. Nada foi alterado/)).toBeTruthy();
    expect(screen.queryByText(/pode já ter sido invalidada/)).toBeNull();
    expect(chamadas.filter((c) => c.caminho === URL_REEMITIR).length).toBe(1);
  });

  it('RU-01 botão só para conta ativa de cliente ativo; aviso cita sessões e offline; envio bloqueado até confirmar tudo', async () => {
    servidor(base(cliente(), () => [usuario(), usuario({ id: 'us0002', login: 'jose.inativo', nome: 'José', ativo: false })]));
    const form = await abrirReemissao();
    expect(screen.queryByRole('button', { name: 'Reemitir senha temporária de jose.inativo' })).toBeNull();
    expect(within(form).getByText(/TODAS as sessões abertas desta conta são encerradas/)).toBeTruthy();
    expect(within(form).getByText(/sem internet e ainda não sincronizados/)).toBeTruthy();
    expect(within(form).getAllByText(/ana\.lab/).length).toBeGreaterThan(0);
    const enviar = within(form).getByRole('button', { name: 'Reemitir senha' });
    expect(enviar.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText(/Justificativa/), { target: { value: 'administradora perdeu a senha inicial' } });
    fireEvent.change(within(form).getByLabelText(/Sua senha atual/), { target: { value: SENHA_ADMIN } });
    fireEvent.change(within(form).getByLabelText(/Código do autenticador/), { target: { value: '123456' } });
    expect(enviar.disabled).toBe(true);
    fireEvent.click(within(form).getByRole('checkbox'));
    expect(enviar.disabled).toBe(false);
  });

  it('RU-02 cliente suspenso: nenhuma conta oferece reemissão', async () => {
    servidor(base(cliente({ ativo: false }), () => [usuario()]));
    const painel = await abrirFicha();
    await within(painel).findByText('ana.lab');
    expect(within(painel).queryByRole('button', { name: /Reemitir senha temporária/ })).toBeNull();
  });

  it('RU-03 sucesso: UM POST com CSRF e If-Match da conta; senha UMA vez; nada em storage/URL/aviso/console; fechar descarta', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const log = vi.spyOn(console, 'log');
    let revAtual = REV1;
    const chamadas = servidor({
      ...base(cliente(), () => [usuario({ revisao: revAtual })]),
      [`POST ${URL_REEMITIR}`]: () => {
        revAtual = REV2;
        return [200, { senha_temporaria: NOVA, usuario: { id: 'us0001', nome: 'Ana Gestora', login: 'ana.lab' }, troca_senha_obrigatoria: true, sessoes_revogadas: true }];
      },
    });
    const form = await abrirReemissao();
    preencherEEnviar(form);
    const painel = await screen.findByTestId('senha-reemitida');
    expect(within(painel).getByTestId('senha-temporaria-reemitida').textContent).toBe(NOVA);
    expect(within(painel).getByText(/única vez/)).toBeTruthy();
    const posts = chamadas.filter((c) => c.metodo === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].headers['x-maike-admin-csrf']).toBe('csrf-da-sessao');
    expect(posts[0].headers['if-match']).toBe(REV1);
    expect(posts[0].corpo).toEqual({ justificativa: 'administradora perdeu a senha inicial', senha_admin_atual: SENHA_ADMIN, codigo_mfa: '123456' });
    for (const segredo of [NOVA, SENHA_ADMIN]) {
      expect(setItem.mock.calls.flat().join(' ')).not.toContain(segredo);
      expect(chamadas.some((c) => c.url.includes(segredo))).toBe(false);
      expect(log.mock.calls.flat().join(' ')).not.toContain(segredo);
      expect(document.title).not.toContain(segredo);
    }
    expect(screen.queryAllByRole('status').map((n) => n.textContent).join(' ')).not.toContain(NOVA);
    expect(document.body.innerHTML).not.toContain(SENHA_ADMIN);
    // A lista foi relida (revisão nova) antes de qualquer nova operação.
    await waitFor(() => expect(chamadas.filter((c) => c.caminho === '/admin-maike/clientes/cl0001/usuarios').length).toBeGreaterThanOrEqual(2));

    fireEvent.click(within(painel).getByRole('button', { name: /Já entreguei/ }));
    await waitFor(() => expect(screen.queryByTestId('senha-reemitida')).toBeNull());
    expect(document.body.textContent).not.toContain(NOVA);
    setItem.mockRestore();
    log.mockRestore();
  });

  it('RU-04 401 (senha ou código errado): continua no formulário com aviso; campos sensíveis limpos; dá para corrigir', async () => {
    let n = 0;
    const chamadas = servidor({
      ...base(cliente(), () => [usuario()]),
      [`POST ${URL_REEMITIR}`]: () => {
        n += 1;
        return n === 1
          ? [401, { code: 'ADMIN_CREDENCIAIS_INVALIDAS', message: 'senha atual ou código inválido' }]
          : [200, { senha_temporaria: NOVA, usuario: { id: 'us0001', nome: 'Ana Gestora', login: 'ana.lab' }, troca_senha_obrigatoria: true, sessoes_revogadas: true }];
      },
    });
    const form = await abrirReemissao();
    preencherEEnviar(form, { codigo: '000000' });
    expect(await within(form).findByText(/Login, senha ou código inválido/)).toBeTruthy();
    expect(within(form).getByLabelText(/Sua senha atual/).value).toBe('');
    expect(within(form).getByLabelText(/Código do autenticador/).value).toBe('');
    expect(within(form).getByLabelText(/Justificativa/).value).not.toBe('');
    fireEvent.change(within(form).getByLabelText(/Sua senha atual/), { target: { value: SENHA_ADMIN } });
    fireEvent.change(within(form).getByLabelText(/Código do autenticador/), { target: { value: '654321' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Reemitir senha' }));
    await screen.findByTestId('senha-reemitida');
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(2);
  });

  it.each([
    ['409 conta alterada', [409, { code: 'ADMIN_USUARIO_EDICAO_CONCORRENTE', message: 'x' }], /A conta foi alterada depois que a lista foi lida/],
    ['428 revisão ausente', [428, { code: 'ADMIN_REVISAO_REQUERIDA', message: 'x' }], /confirmar a versão da ficha/],
    ['500', [500, { code: 'INTERNAL_ERROR', message: 'x' }], /A senha anterior pode já ter sido invalidada/],
    ['503 gateway', [503, undefined], /A senha anterior pode já ter sido invalidada/],
    ['rede', 'rede', /A senha anterior pode já ter sido invalidada/],
  ])('RU-05 %s: fecha o formulário, relê a lista, UM único POST e nenhuma senha na tela', async (_n, resposta, texto) => {
    const chamadas = servidor({
      ...base(cliente(), () => [usuario()]),
      [`POST ${URL_REEMITIR}`]: resposta === 'rede' ? 'rede' : () => resposta,
    });
    const form = await abrirReemissao();
    preencherEEnviar(form);
    const painel = screen.getByTestId('ficha-cliente');
    expect(await within(painel).findByText(texto)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('reemitir-senha')).toBeNull());
    await waitFor(() => expect(chamadas.filter((c) => c.caminho === '/admin-maike/clientes/cl0001/usuarios').length).toBeGreaterThanOrEqual(2));
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(1);
    expect(screen.queryByTestId('senha-reemitida')).toBeNull();
    expect(document.body.innerHTML).not.toContain(SENHA_ADMIN);
  });

  it('RU-06 clique duplo envia uma vez (botão ocupado)', async () => {
    let soltar;
    const chamadas = servidor({
      ...base(cliente(), () => [usuario()]),
      [`POST ${URL_REEMITIR}`]: () =>
        new Promise((r) => {
          soltar = () => r([200, { senha_temporaria: NOVA, usuario: { id: 'us0001', nome: 'Ana Gestora', login: 'ana.lab' }, troca_senha_obrigatoria: true, sessoes_revogadas: true }]);
        }),
    });
    const form = await abrirReemissao();
    preencherEEnviar(form);
    fireEvent.click(within(form).getByRole('button', { name: /Aguarde|Reemitir senha/ }));
    await waitFor(() => expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(1));
    soltar();
    await screen.findByTestId('senha-reemitida');
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(1);
  });
});
