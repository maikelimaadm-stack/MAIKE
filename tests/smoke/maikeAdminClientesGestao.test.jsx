/**
 * MAIKE-SAAS-ADMIN-S03 — gestão de clientes na aba Clientes (jsdom).
 *
 * `fetch` é um servidor falso por rota. Prova: cadastro com sugestão de código
 * e CSRF; senha temporária aparece UMA vez, nunca em storage/URL/aviso e some
 * ao fechar; erro recuperável mantém o formulário; clique duplo não duplica;
 * edição e suspensão com justificativa obrigatória atualizam a lista.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

import Clientes, { sugerirCodigo } from '../../apps/admin/src/telas/Clientes.jsx';
import { definirCsrf } from '../../apps/admin/src/api.js';

const SENHA = 'Ab3d-Ef4g-Hj5k-Mn6p';
const pagina = (items, extra = {}) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 25, ...extra });
const cli = (extra = {}) => ({ id: 'cl0001', codigo: 'fazenda-um', nome: 'Fazenda Um', ativo: true, criado_em: '2026-11-01T12:00:00.000Z', usuarios_total: 1, empresas_total: 0, ...extra });

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
      const [status, resposta] = h ? await h(corpo) : [404, { code: 'NOT_FOUND', message: caminho }];
      return { ok: status < 400, status, text: async () => (resposta === undefined ? '' : JSON.stringify(resposta)) };
    })
  );
  return chamadas;
};

const ficha = (c) => ({
  cliente: { id: c.id, codigo: c.codigo, nome: c.nome, ativo: c.ativo, criado_em: c.criado_em, atualizado_em: c.criado_em },
  contagens: { usuarios: 1, usuarios_ativos: 1, empresas: 0 },
});
const filhos = (id) => ({
  [`GET /admin-maike/clientes/${id}/usuarios`]: () => [200, pagina([])],
  [`GET /admin-maike/clientes/${id}/empresas`]: () => [200, pagina([])],
});

beforeEach(() => {
  cleanup();
  definirCsrf('csrf-da-sessao');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('cadastro', () => {
  it('sugere código, envia com CSRF, mostra a senha UMA vez e nada vai para storage, URL ou aviso', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    let lista = [];
    const criado = cli({ id: 'cl0002', codigo: 'fazenda-sao-joao', nome: 'Fazenda São João' });
    const chamadas = servidor({
      'GET /admin-maike/clientes': () => [200, pagina(lista)],
      'POST /admin-maike/clientes': () => {
        lista = [criado];
        return [201, { cliente: criado, administrador: { id: 'u1', nome: 'Ana', login: 'ana.sj' }, senha_temporaria: SENHA }];
      },
      'GET /admin-maike/clientes/cl0002': () => [200, ficha(criado)],
      ...filhos('cl0002'),
    });
    render(<Clientes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar cliente' }));
    fireEvent.change(screen.getByLabelText('Nome do cliente'), { target: { value: 'Fazenda São João' } });
    expect(screen.getByLabelText(/^Código/).value).toBe('fazenda-sao-joao');
    fireEvent.change(screen.getByLabelText('Nome do administrador'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText(/^Login do administrador/), { target: { value: 'ana.sj' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente e administrador' }));

    const painel = await screen.findByTestId('senha-unica');
    expect(within(painel).getByTestId('senha-temporaria').textContent).toBe(SENHA);
    expect(within(painel).getByText(/única vez/)).toBeTruthy();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post.corpo).toEqual({ nome: 'Fazenda São João', codigo: 'fazenda-sao-joao', administrador: { nome: 'Ana', login: 'ana.sj' } });
    expect(post.headers['x-maike-admin-csrf']).toBe('csrf-da-sessao');
    // A senha só existe no painel: nem em storage, nem em URL de chamada, nem em aviso.
    expect(setItem.mock.calls.flat().join(' ')).not.toContain(SENHA);
    expect(chamadas.some((c) => c.url.includes(SENHA))).toBe(false);
    expect(screen.queryAllByRole('status').map((n) => n.textContent).join(' ')).not.toContain(SENHA);

    fireEvent.click(within(painel).getByRole('button', { name: /Já entreguei/ }));
    await waitFor(() => expect(screen.queryByTestId('senha-unica')).toBeNull());
    expect(document.body.textContent).not.toContain(SENHA);
    // A lista recarrega e a ficha do novo cliente abre.
    expect(await screen.findByTestId('ficha-cliente')).toBeTruthy();
    expect(within(screen.getByTestId('lista-clientes')).getByText('Fazenda São João')).toBeTruthy();
    setItem.mockRestore();
  });

  it('erro recuperável mantém o que foi digitado; clique duplo não envia duas vezes', async () => {
    let soltar;
    let tentativas = 0;
    servidor({
      'GET /admin-maike/clientes': () => [200, pagina([])],
      'POST /admin-maike/clientes': () => {
        tentativas += 1;
        return new Promise((r) => {
          soltar = () => r([409, { code: 'ADMIN_LOGIN_DUPLICADO', message: 'login em uso' }]);
        });
      },
    });
    render(<Clientes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar cliente' }));
    fireEvent.change(screen.getByLabelText('Nome do cliente'), { target: { value: 'Agro Dois' } });
    fireEvent.change(screen.getByLabelText('Nome do administrador'), { target: { value: 'Bia' } });
    fireEvent.change(screen.getByLabelText(/^Login do administrador/), { target: { value: 'bia' } });
    const botao = screen.getByRole('button', { name: 'Cadastrar cliente e administrador' });
    fireEvent.click(botao);
    fireEvent.click(botao);
    await waitFor(() => expect(tentativas).toBe(1));
    soltar();
    expect((await screen.findByRole('alert')).textContent).toMatch(/login já é usado/);
    expect(screen.getByLabelText('Nome do cliente').value).toBe('Agro Dois');
    expect(screen.getByLabelText(/^Login do administrador/).value).toBe('bia');
    expect(screen.queryByTestId('senha-unica')).toBeNull();
  });

  it('rede cai depois do envio: aviso de resultado incerto, sem reenvio automático, verificação só por leitura', async () => {
    const criado = cli({ id: 'cl0003', codigo: 'agro-tres', nome: 'Agro Três' });
    let gravado = false;
    let posts = 0;
    const chamadas = servidor({
      'GET /admin-maike/clientes': () => [200, pagina(gravado ? [criado] : [])],
      'GET /admin-maike/clientes/cl0003': () => [200, ficha(criado)],
      ...filhos('cl0003'),
    });
    const base = globalThis.fetch;
    // O servidor GRAVA e a conexão cai antes da resposta: fetch rejeita.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init = {}) => {
        if ((init.method || 'GET') === 'POST') {
          posts += 1;
          gravado = true;
          throw new TypeError('Failed to fetch');
        }
        return base(url, init);
      })
    );
    render(<Clientes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar cliente' }));
    fireEvent.change(screen.getByLabelText('Nome do cliente'), { target: { value: 'Agro Três' } });
    fireEvent.change(screen.getByLabelText('Nome do administrador'), { target: { value: 'Caio' } });
    fireEvent.change(screen.getByLabelText(/^Login do administrador/), { target: { value: 'caio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente e administrador' }));

    const aviso = await screen.findByTestId('cadastro-incerto');
    expect(aviso.textContent).toMatch(/pode ter sido concluído/);
    expect(aviso.textContent).toMatch(/Não envie de novo/);
    expect(screen.queryByRole('button', { name: 'Cadastrar cliente e administrador' })).toBeNull();
    expect(screen.getByLabelText('Nome do cliente').value).toBe('Agro Três');
    // Enter no formulário também não reenvia.
    fireEvent.submit(screen.getByLabelText('Nome do cliente').closest('form'));
    await new Promise((r) => setTimeout(r, 20));
    expect(posts).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Verificar se o cliente foi criado' }));
    await waitFor(() => expect(screen.getByTestId('cadastro-incerto').textContent).toMatch(/foi criado/));
    const texto = screen.getByTestId('cadastro-incerto').textContent;
    expect(texto).toMatch(/não pode ser mostrada de novo/);
    expect(texto).not.toMatch(/recuperar a senha|nova senha foi/i);
    expect(posts).toBe(1);
    expect(chamadas.filter((c) => c.metodo === 'GET' && c.caminho === '/admin-maike/clientes').at(-1).url).toContain('q=agro-tres');
    expect(screen.queryByTestId('senha-unica')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ficha do cliente' }));
    expect(await screen.findByTestId('ficha-cliente')).toBeTruthy();
  });

  it('rede cai e a verificação não encontra o código: libera o reenvio com o que foi digitado', async () => {
    servidor({ 'GET /admin-maike/clientes': () => [200, pagina([])] });
    const base = globalThis.fetch;
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init = {}) => {
        if ((init.method || 'GET') === 'POST') {
          posts += 1;
          throw new TypeError('Failed to fetch');
        }
        return base(url, init);
      })
    );
    render(<Clientes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar cliente' }));
    fireEvent.change(screen.getByLabelText('Nome do cliente'), { target: { value: 'Agro Quatro' } });
    fireEvent.change(screen.getByLabelText('Nome do administrador'), { target: { value: 'Davi' } });
    fireEvent.change(screen.getByLabelText(/^Login do administrador/), { target: { value: 'davi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente e administrador' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar se o cliente foi criado' }));
    expect(await screen.findByText(/o cadastro não foi concluído/)).toBeTruthy();
    expect(screen.getByLabelText(/^Login do administrador/).value).toBe('davi');
    expect(screen.getByRole('button', { name: 'Cadastrar cliente e administrador' })).toBeTruthy();
    expect(posts).toBe(1);
  });

  it('sugerirCodigo remove acentos e símbolos', () => {
    expect(sugerirCodigo('  Fazenda São João! ')).toBe('fazenda-sao-joao');
    expect(sugerirCodigo('Agro & Cia. Ltda')).toBe('agro-cia-ltda');
  });
});

describe('edição e situação', () => {
  it('edita só o que mudou e mostra código duplicado de forma recuperável', async () => {
    let atual = cli();
    let tentativa = 0;
    const chamadas = servidor({
      'GET /admin-maike/clientes': () => [200, pagina([atual])],
      'GET /admin-maike/clientes/cl0001': () => [200, ficha(atual)],
      ...filhos('cl0001'),
      'PATCH /admin-maike/clientes/cl0001': (corpo) => {
        tentativa += 1;
        if (tentativa === 1) return [409, { code: 'ADMIN_CLIENTE_CODIGO_DUPLICADO', message: 'dup' }];
        atual = { ...atual, ...corpo };
        return [200, { cliente: atual }];
      },
    });
    render(<Clientes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver ficha de Fazenda Um' }));
    const painel = await screen.findByTestId('ficha-cliente');
    fireEvent.click(await within(painel).findByRole('button', { name: 'Editar identificação' }));
    fireEvent.change(within(painel).getByLabelText(/^Código/), { target: { value: 'outro-codigo' } });
    fireEvent.click(within(painel).getByRole('button', { name: 'Salvar identificação' }));
    expect((await within(painel).findByRole('alert')).textContent).toMatch(/Já existe um cliente com esse código/);
    expect(chamadas.find((c) => c.metodo === 'PATCH').corpo).toEqual({ codigo: 'outro-codigo' });
    fireEvent.change(within(painel).getByLabelText('Nome do cliente'), { target: { value: 'Fazenda Um Nova' } });
    fireEvent.change(within(painel).getByLabelText(/^Código/), { target: { value: 'fazenda-um-nova' } });
    fireEvent.click(within(painel).getByRole('button', { name: 'Salvar identificação' }));
    expect(await within(painel).findByText('Identificação atualizada.')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId('lista-clientes')).getByText('Fazenda Um Nova')).toBeTruthy());
  });

  it('edição concorrente (409): mensagem de recarregar, edição preservada, nada de sucesso', async () => {
    const atual = cli();
    servidor({
      'GET /admin-maike/clientes': () => [200, pagina([atual])],
      'GET /admin-maike/clientes/cl0001': () => [200, ficha(atual)],
      ...filhos('cl0001'),
      'PATCH /admin-maike/clientes/cl0001': () => [409, { code: 'ADMIN_CLIENTE_EDICAO_CONCORRENTE', message: 'concorrente' }],
    });
    render(<Clientes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver ficha de Fazenda Um' }));
    const painel = await screen.findByTestId('ficha-cliente');
    fireEvent.click(await within(painel).findByRole('button', { name: 'Editar identificação' }));
    fireEvent.change(within(painel).getByLabelText('Nome do cliente'), { target: { value: 'Nome Não Salvo' } });
    fireEvent.click(within(painel).getByRole('button', { name: 'Salvar identificação' }));
    expect((await within(painel).findByRole('alert')).textContent).toMatch(/alterado em outra sessão e nada foi salvo/);
    expect(within(painel).getByLabelText('Nome do cliente').value).toBe('Nome Não Salvo');
    expect(within(painel).queryByText('Identificação atualizada.')).toBeNull();
  });

  it('suspensão exige justificativa, explica o efeito e reflete na ficha e na lista; reativação volta', async () => {
    let atual = cli();
    const chamadas = servidor({
      'GET /admin-maike/clientes': () => [200, pagina([atual])],
      'GET /admin-maike/clientes/cl0001': () => [200, ficha(atual)],
      ...filhos('cl0001'),
      'POST /admin-maike/clientes/cl0001/situacao': (corpo) => {
        atual = { ...atual, ativo: corpo.ativo };
        return [200, { cliente: atual }];
      },
    });
    render(<Clientes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver ficha de Fazenda Um' }));
    const painel = await screen.findByTestId('ficha-cliente');
    fireEvent.click(await within(painel).findByRole('button', { name: 'Suspender cliente' }));
    expect(within(painel).getByText(/sessões abertas param na hora/)).toBeTruthy();
    // Semântica real (GES-15): bloqueio enquanto suspenso, não revogação.
    expect(within(painel).getByText(/não encerra as sessões/)).toBeTruthy();
    const confirmar = within(painel).getByRole('button', { name: 'Confirmar suspensão' });
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(within(painel).getByLabelText(/Justificativa/), { target: { value: 'curta' } });
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(within(painel).getByLabelText(/Justificativa/), { target: { value: 'pedido do cliente por e-mail' } });
    fireEvent.click(within(painel).getByRole('button', { name: 'Confirmar suspensão' }));
    expect(await within(painel).findByText('Cliente suspenso.')).toBeTruthy();
    expect(chamadas.find((c) => c.metodo === 'POST').corpo).toEqual({ ativo: false, justificativa: 'pedido do cliente por e-mail' });
    expect(await within(painel).findByRole('button', { name: 'Reativar cliente' })).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId('lista-clientes')).getByText('Inativo')).toBeTruthy());

    fireEvent.click(within(painel).getByRole('button', { name: 'Reativar cliente' }));
    fireEvent.change(within(painel).getByLabelText(/Justificativa/), { target: { value: 'pagamento regularizado' } });
    fireEvent.click(within(painel).getByRole('button', { name: 'Confirmar reativação' }));
    expect(await within(painel).findByText('Cliente reativado.')).toBeTruthy();
  });
});
