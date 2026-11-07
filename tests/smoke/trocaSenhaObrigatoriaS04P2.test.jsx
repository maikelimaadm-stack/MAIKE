/**
 * MAIKE-SAAS-ADMIN-S04-P2 — tela de troca obrigatória da senha temporária.
 *
 * Cadeia REAL até o fetch: `NativeLoginForm` → `entrarComSessaoNativa` →
 * `nativeSessionApi` → `nativeRequest`. Só o `fetch` é falso. Prova: a senha
 * temporária não cria sessão nem grava token; a troca manda só as duas senhas
 * com o token restrito em memória; sucesso exige novo login; 403/400 deixam
 * corrigir; 401/409/500/rede voltam ao login SEM repetir; nenhum segredo fica
 * em storage ou no DOM.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const API = 'https://backend.exemplo.invalido';
const TEMPORARIA = 'Ab3d-Ef4g-Hj5k-Mn6p';
const NOVA = 'Minha-Senha-Nova-9';
const RESTRITO = 'eyJhbGciOiJIUzI1NiJ9.eyJlc2NvcG8iOiJ0cm9jYV9zZW5oYV9pbmljaWFsIn0.assinatura';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const resposta = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
});

/** fetch falso: login devolve a etapa de troca; a troca responde conforme `troca`. */
const fetchComTroca = (troca) =>
  vi.fn(async (url) => {
    const caminho = new URL(String(url)).pathname;
    if (caminho.endsWith('/auth/login')) {
      return resposta(200, { troca_senha_obrigatoria: true, token_troca_senha: RESTRITO, expira_em_segundos: 600 });
    }
    if (caminho.endsWith('/auth/troca-senha-inicial')) {
      if (troca === 'rede') throw new TypeError('Failed to fetch');
      return resposta(troca.status, troca.corpo);
    }
    return resposta(500, { code: 'INTERNAL_ERROR' });
  });

const chamadasPara = (fetch, final) => fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith(final));

const montar = async (fetch) => {
  vi.stubGlobal('fetch', fetch);
  const { default: NativeLoginForm } = await import('@/components/auth/NativeLoginForm');
  const { entrarComSessaoNativa } = await import('@/services/sessionService');
  const onAutenticado = vi.fn();
  render(<NativeLoginForm entrar={entrarComSessaoNativa} onAutenticado={onAutenticado} />);
  fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'maria.esperanca' } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: TEMPORARIA } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  await screen.findByRole('heading', { name: 'Troca obrigatória de senha' });
  return { onAutenticado };
};

const preencherTroca = ({ atual = TEMPORARIA, nova = NOVA, confirmacao = nova } = {}) => {
  fireEvent.change(screen.getByLabelText('Senha temporária'), { target: { value: atual } });
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: nova } });
  fireEvent.change(screen.getByLabelText('Confirme a nova senha'), { target: { value: confirmacao } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
};

const semSegredos = () => {
  const tudo = JSON.stringify({ s: { ...window.sessionStorage }, l: { ...window.localStorage } });
  for (const segredo of [TEMPORARIA, NOVA, RESTRITO]) expect(tudo).not.toContain(segredo);
  for (const campo of document.querySelectorAll('input')) {
    expect([TEMPORARIA, NOVA]).not.toContain(campo.value);
  }
};

describe('S04-P2 — login com senha temporária', () => {
  it('TS-01 abre a troca obrigatória: sem sessão, sem token gravado, sem /auth/contexto e sem onAutenticado', async () => {
    const fetch = fetchComTroca({ status: 200, corpo: {} });
    const { onAutenticado } = await montar(fetch);
    expect(onAutenticado).not.toHaveBeenCalled();
    expect(chamadasPara(fetch, '/auth/contexto')).toHaveLength(0);
    const { hasNativeToken } = await import('@/lib/auth/nativeTokenStorage');
    expect(hasNativeToken()).toBe(false);
    semSegredos();
    expect(screen.getByLabelText('Nova senha').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText('Senha temporária').getAttribute('autocomplete')).toBe('current-password');
  });

  it('TS-02 validação local: confirmação diferente, curta, igual à temporária ou ao usuário → mensagem e NENHUM envio', async () => {
    const fetch = fetchComTroca({ status: 200, corpo: {} });
    await montar(fetch);
    for (const [dados, texto] of [
      [{ confirmacao: 'Outra-Coisa-123' }, 'A confirmação não é igual à nova senha.'],
      [{ nova: 'curta' }, 'A nova senha precisa ter pelo menos 8 caracteres.'],
      [{ nova: TEMPORARIA }, 'A nova senha precisa ser diferente da senha temporária.'],
      [{ nova: 'MARIA.ESPERANCA' }, 'A nova senha não pode ser igual ao usuário.'],
    ]) {
      preencherTroca(dados);
      expect(await screen.findByText(texto)).toBeTruthy();
    }
    expect(chamadasPara(fetch, '/auth/troca-senha-inicial')).toHaveLength(0);
  });
});

describe('S04-P2 — envio da troca', () => {
  it('TS-03 sucesso: um POST com o token restrito e só as duas senhas; volta ao login pedindo a senha nova; etapa descartada', async () => {
    const fetch = fetchComTroca({ status: 200, corpo: { senha_alterada: true, novo_login_obrigatorio: true } });
    const { onAutenticado } = await montar(fetch);
    preencherTroca();
    expect(await screen.findByText('Senha alterada. Entre com o seu usuário e a nova senha.')).toBeTruthy();
    const chamadas = chamadasPara(fetch, '/auth/troca-senha-inicial');
    expect(chamadas).toHaveLength(1);
    const [, init] = chamadas[0];
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${RESTRITO}`);
    expect(JSON.parse(init.body)).toEqual({ senha_atual: TEMPORARIA, nova_senha: NOVA });
    expect(screen.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeTruthy();
    expect(screen.getByLabelText('Senha').value).toBe('');
    expect(onAutenticado).not.toHaveBeenCalled();
    semSegredos();
    const { concluirTrocaSenhaInicial } = await import('@/services/sessionService');
    await expect(concluirTrocaSenhaInicial({ senhaAtual: 'x', novaSenha: 'y' })).rejects.toMatchObject({ code: 'TENANT_CONTEXT_REQUIRED' });
    expect(chamadasPara(fetch, '/auth/troca-senha-inicial')).toHaveLength(1);
  });

  it('TS-04 senha temporária errada (403): continua na troca, campos limpos, e dá para corrigir e enviar de novo', async () => {
    const fetch = fetchComTroca({ status: 403, corpo: { code: 'USUARIO_SENHA_ATUAL_INVALIDA', message: 'x' } });
    await montar(fetch);
    preencherTroca({ atual: 'errada-123' });
    expect(await screen.findByText('A senha temporária não confere. Confira e tente de novo.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Troca obrigatória de senha' })).toBeTruthy();
    semSegredos();
    preencherTroca();
    await waitFor(() => expect(chamadasPara(fetch, '/auth/troca-senha-inicial')).toHaveLength(2));
  });

  it.each([
    ['500 INTERNAL_ERROR', { status: 500, corpo: { code: 'INTERNAL_ERROR', message: 'falhou' } }],
    ['503', { status: 503, corpo: '' }],
    ['rede', 'rede'],
  ])('TS-05 %s: "não foi possível confirmar", volta ao login, UMA tentativa e etapa descartada', async (_n, troca) => {
    const fetch = fetchComTroca(troca);
    await montar(fetch);
    preencherTroca();
    expect(await screen.findByText(/Não foi possível confirmar a troca de senha/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeTruthy();
    expect(chamadasPara(fetch, '/auth/troca-senha-inicial')).toHaveLength(1);
    semSegredos();
    const { concluirTrocaSenhaInicial } = await import('@/services/sessionService');
    await expect(concluirTrocaSenhaInicial({ senhaAtual: 'x', novaSenha: 'y' })).rejects.toMatchObject({ code: 'TENANT_CONTEXT_REQUIRED' });
    expect(chamadasPara(fetch, '/auth/troca-senha-inicial')).toHaveLength(1);
  });

  it.each([
    ['401 etapa expirada', { status: 401, corpo: { code: 'TENANT_CONTEXT_REQUIRED' } }, 'A etapa de troca de senha expirou. Entre novamente com a senha temporária.'],
    ['409 já trocada', { status: 409, corpo: { code: 'CONCURRENCY_CONFLICT' } }, 'A senha temporária já foi trocada. Entre com a nova senha.'],
  ])('TS-06 %s: volta ao login com a orientação certa', async (_n, troca, texto) => {
    const fetch = fetchComTroca(troca);
    await montar(fetch);
    preencherTroca();
    expect(await screen.findByText(texto)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeTruthy();
    semSegredos();
  });

  it('TS-07 "Voltar ao login" descarta a etapa sem chamar o servidor', async () => {
    const fetch = fetchComTroca({ status: 200, corpo: {} });
    await montar(fetch);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao login' }));
    expect(screen.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeTruthy();
    const { concluirTrocaSenhaInicial } = await import('@/services/sessionService');
    await expect(concluirTrocaSenhaInicial({ senhaAtual: 'x', novaSenha: 'y' })).rejects.toMatchObject({ code: 'TENANT_CONTEXT_REQUIRED' });
    expect(chamadasPara(fetch, '/auth/troca-senha-inicial')).toHaveLength(0);
  });
});

describe('S04-P2 — login normal intacto', () => {
  it('TS-08 conta comum: login com token segue para /auth/contexto e onAutenticado, sem tela de troca', async () => {
    const fetch = vi.fn(async (url) => {
      const caminho = new URL(String(url)).pathname;
      if (caminho.endsWith('/auth/login')) return resposta(200, { token: 'tok.normal.x', usuario: { id: 'u1', login: 'joao', nome: 'João' }, cliente_id: 'c1' });
      if (caminho.endsWith('/auth/contexto')) return resposta(200, { cliente_id: 'c1', usuario_id: 'u1', login: 'joao' });
      return resposta(500, {});
    });
    vi.stubGlobal('fetch', fetch);
    const { default: NativeLoginForm } = await import('@/components/auth/NativeLoginForm');
    const { entrarComSessaoNativa } = await import('@/services/sessionService');
    const onAutenticado = vi.fn();
    render(<NativeLoginForm entrar={entrarComSessaoNativa} onAutenticado={onAutenticado} />);
    fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'joao' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-comum-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(onAutenticado).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: 'Troca obrigatória de senha' })).toBeNull();
    expect(chamadasPara(fetch, '/auth/contexto')).toHaveLength(1);
  });
});
