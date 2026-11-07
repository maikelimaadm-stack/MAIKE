/**
 * MAIKE-SAAS-ADMIN-S01 — aba Clientes do MAIKE Admin (somente leitura).
 *
 * `fetch` é um servidor falso por rota; nenhuma rede real. Prova: lista,
 * busca, paginação, ficha com empresas/usuários, troca rápida de cliente,
 * 401 volta ao login, nenhuma ação de escrita na tela e abas antigas intactas.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

import App from '../../apps/admin/src/App.jsx';
import Clientes from '../../apps/admin/src/telas/Clientes.jsx';
import { definirCsrf } from '../../apps/admin/src/api.js';

const CATALOGO = {
  revisao: 1,
  limites: { mimes: ['image/png'], max_bytes: 1024 },
  tipos: [],
  categorias: [],
  icones: [],
  regras_misto: [],
};

const cliente = (n, extra = {}) => ({
  id: `cl${String(n).padStart(4, '0')}`,
  codigo: `fazenda-${n}`,
  nome: `Fazenda ${n}`,
  ativo: true,
  criado_em: '2026-10-01T12:00:00.000Z',
  usuarios_total: n,
  empresas_total: 1,
  ...extra,
});

const pagina = (items, extra = {}) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 25, ...extra });

/** @param {Record<string, (url: URL) => [number, any] | Promise<[number, any]>>} rotas chave "MÉTODO /caminho" (sem query) */
const servidor = (rotas) => {
  const chamadas = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const metodo = init.method || 'GET';
      const u = new URL(String(url), 'http://admin.local');
      const caminho = u.pathname.replace('/api/native', '');
      chamadas.push({ metodo, caminho, busca: u.search, headers: init.headers || {} });
      const h = rotas[`${metodo} ${caminho}`];
      const [status, resposta] = h ? await h(u) : [404, { code: 'NOT_FOUND', message: caminho }];
      return { ok: status < 400, status, text: async () => (resposta === undefined ? '' : JSON.stringify(resposta)) };
    })
  );
  return chamadas;
};

const ficha = (c) => ({
  cliente: { id: c.id, codigo: c.codigo, nome: c.nome, ativo: c.ativo, criado_em: c.criado_em, atualizado_em: '2026-10-05T12:00:00.000Z' },
  contagens: { usuarios: 2, usuarios_ativos: 1, empresas: 1 },
});

beforeEach(() => {
  cleanup();
  definirCsrf('');
});

describe('Clientes: lista, busca e paginação', () => {
  it('lista com contagens; busca e situação viram filtros; "Carregar mais" acrescenta sem repetir', async () => {
    const chamadas = servidor({
      'GET /admin-maike/clientes': (u) => {
        if (u.searchParams.get('cursor') === 'c2') return [200, pagina([cliente(3)], { total: null })];
        if (u.searchParams.get('q') === 'alfa') return [200, pagina([cliente(9, { nome: 'Fazenda Alfa', ativo: false })])];
        return [200, pagina([cliente(1), cliente(2)], { total: 3, has_more: true, next_cursor: 'c2' })];
      },
    });
    render(<Clientes />);
    const tabela = await screen.findByTestId('lista-clientes');
    expect(within(tabela).getByText('Fazenda 1')).toBeTruthy();
    expect(within(tabela).getByText('fazenda-2')).toBeTruthy();
    expect(screen.getByText('3 cliente(s)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('Fazenda 3');
    expect(screen.getAllByText(/^Fazenda \d$/).map((n) => n.textContent)).toEqual(['Fazenda 1', 'Fazenda 2', 'Fazenda 3']);
    expect(screen.getByText('3 cliente(s)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Buscar por nome ou código'), { target: { value: '  alfa ' } });
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'false' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText('Fazenda Alfa');
    const ultima = chamadas.at(-1);
    expect(ultima.busca).toBe('?q=alfa&ativo=false');
    expect(chamadas.every((c) => c.metodo === 'GET')).toBe(true);
  });

  it('lista vazia e erro recuperável', async () => {
    let falhar = true;
    servidor({
      'GET /admin-maike/clientes': () => (falhar ? [500, { code: 'INTERNAL_ERROR', message: 'falhou' }] : [200, pagina([])]),
    });
    render(<Clientes />);
    expect((await screen.findByRole('alert')).textContent).toContain('falhou');
    falhar = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Nenhum cliente cadastrado.')).toBeTruthy();
  });
});

describe('Clientes: ficha', () => {
  it('ficha mostra identidade, contagens, empresas e usuários; sem exclusão, impersonação nem campos sensíveis', async () => {
    const c = cliente(1);
    const chamadas = servidor({
      'GET /admin-maike/clientes': () => [200, pagina([c])],
      [`GET /admin-maike/clientes/${c.id}`]: () => [200, ficha(c)],
      [`GET /admin-maike/clientes/${c.id}/empresas`]: () => [200, pagina([{ id: 'e1', numero_empresa: 1, nome: 'Agro Um Ltda', apelido: 'Sede', criado_em: c.criado_em }])],
      [`GET /admin-maike/clientes/${c.id}/usuarios`]: (u) =>
        u.searchParams.get('cursor')
          ? [200, pagina([{ id: 'u2', nome: 'Peão', login: 'peao', ativo: false, criado_em: c.criado_em }], { total: null })]
          : [200, pagina([{ id: 'u1', nome: 'Dona', login: 'dona', ativo: true, criado_em: c.criado_em }], { total: 2, has_more: true, next_cursor: 'cu' })],
    });
    render(<Clientes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver ficha de Fazenda 1' }));
    const painel = await screen.findByTestId('ficha-cliente');
    await within(painel).findByText('2 (1 ativos)');
    expect(within(painel).getByText(/não se entra na conta do cliente/)).toBeTruthy();
    expect(await within(painel).findByText('Agro Um Ltda')).toBeTruthy();
    expect(await within(painel).findByText('dona')).toBeTruthy();
    expect(within(painel).getByText('Usuários (2)')).toBeTruthy();
    fireEvent.click(within(painel).getByRole('button', { name: 'Carregar mais' }));
    expect(await within(painel).findByText('peao')).toBeTruthy();
    expect(within(painel).getByText('Usuários (2)')).toBeTruthy();

    // S03: editar identificação e suspender existem; exclusão, impersonação e senha, não.
    // S04-P3: a única ação de senha permitida é "Reemitir senha temporária" (por conta,
    // com reautenticação no formulário); nada de ver/definir senha ou entrar na conta.
    const rotulos = screen.getAllByRole('button').map((b) => b.textContent);
    expect(rotulos).toContain('Editar identificação');
    expect(rotulos).toContain('Suspender cliente');
    const semReemissao = rotulos.filter((r) => r !== 'Reemitir senha temporária');
    for (const proibido of [/excluir/i, /apagar/i, /entrar como/i, /acessar conta/i, /senha/i]) {
      expect(semReemissao.some((r) => proibido.test(r))).toBe(false);
    }
    expect(document.body.textContent).not.toMatch(/senha_hash|papel_tenant|cnpj|cpf/i);
    expect(chamadas.every((x) => x.metodo === 'GET' && !('x-maike-admin-csrf' in x.headers))).toBe(true);

    fireEvent.click(within(painel).getByRole('button', { name: 'Fechar ficha' }));
    expect(screen.queryByTestId('ficha-cliente')).toBeNull();
  });

  it('troca rápida de cliente: resposta atrasada do anterior não sobrescreve a ficha atual', async () => {
    const a = cliente(1);
    const b = cliente(2);
    let soltarA;
    servidor({
      'GET /admin-maike/clientes': () => [200, pagina([a, b])],
      [`GET /admin-maike/clientes/${a.id}`]: () => new Promise((r) => (soltarA = () => r([200, ficha(a)]))),
      [`GET /admin-maike/clientes/${b.id}`]: () => [200, ficha(b)],
      [`GET /admin-maike/clientes/${a.id}/empresas`]: () => [200, pagina([])],
      [`GET /admin-maike/clientes/${a.id}/usuarios`]: () => [200, pagina([])],
      [`GET /admin-maike/clientes/${b.id}/empresas`]: () => [200, pagina([])],
      [`GET /admin-maike/clientes/${b.id}/usuarios`]: () => [200, pagina([])],
    });
    render(<Clientes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver ficha de Fazenda 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver ficha de Fazenda 2' }));
    const painel = await screen.findByTestId('ficha-cliente');
    await within(painel).findByRole('heading', { name: 'Fazenda 2' });
    soltarA();
    await new Promise((r) => setTimeout(r, 20));
    expect(within(painel).getByRole('heading', { name: 'Fazenda 2' })).toBeTruthy();
    expect(within(painel).queryByRole('heading', { name: 'Fazenda 1' })).toBeNull();
  });
});

describe('Clientes dentro do App', () => {
  it('aba nova convive com as antigas; 401 durante a consulta volta ao login', async () => {
    let sessaoValida = true;
    servidor({
      'GET /admin-maike/sessao': () => (sessaoValida ? [200, { etapa: 'ok', admin: { login: 'dono' }, csrf_token: 'csrf' }] : [401, { code: 'ADMIN_SESSAO_REQUIRED' }]),
      'GET /admin-maike/catalogo': () => [200, CATALOGO],
      'GET /admin-maike/primeiro-acesso': () => [200, { disponivel: false }],
      'GET /admin-maike/clientes': () => (sessaoValida ? [200, pagina([cliente(1)])] : [401, { code: 'ADMIN_SESSAO_REQUIRED', message: 'sessão expirada' }]),
    });
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Seções' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Ícones',
      'Tipos e categorias',
      'Regras MISTO',
      'Validação',
      'Clientes',
      'Minha conta',
    ]);
    fireEvent.click(within(nav).getByRole('button', { name: 'Clientes' }));
    expect(await screen.findByText('Fazenda 1')).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: 'Ícones' }));
    await waitFor(() => expect(screen.queryByTestId('lista-clientes')).toBeNull());

    sessaoValida = false;
    fireEvent.click(within(nav).getByRole('button', { name: 'Clientes' }));
    expect(await screen.findByLabelText('Login')).toBeTruthy();
  });
});
