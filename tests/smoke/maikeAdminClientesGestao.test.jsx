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
