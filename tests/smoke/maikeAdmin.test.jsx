/**
 * PR145-R3 (D-PROD-70) — app MAIKE Admin (apps/admin), isolado da SPA.
 *
 * `fetch` é substituído por um servidor falso por rota; nenhuma rede real.
 * Imagens são bytes sintéticos.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

import App from '../../apps/admin/src/App.jsx';
import Icones from '../../apps/admin/src/telas/Icones.jsx';
import RegrasMisto from '../../apps/admin/src/telas/RegrasMisto.jsx';
import Validacao from '../../apps/admin/src/telas/Validacao.jsx';
import Conta from '../../apps/admin/src/telas/Conta.jsx';
import { definirCsrf, ehConflitoRevisao, ehDuplicidade, mensagemDeErro } from '../../apps/admin/src/api.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const DADOS = {
  revisao: 4,
  limites: { mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], max_bytes: 512 * 1024 },
  tipos: [{ id: 't-lote', codigo: 'lote', nome: 'Lote', ordem: 0, ativo: true }],
  categorias: [
    { id: 'c-bez', tipo_id: 't-lote', codigo: 'bezerro', nome: 'Bezerro', ordem: 0, ativo: true },
    { id: 'c-gar', tipo_id: 't-lote', codigo: 'garrote', nome: 'Garrote', ordem: 1, ativo: true },
  ],
  icones: [
    {
      id: 'i-bez-0001',
      tipo_id: 't-lote',
      categoria_id: 'c-bez',
      estado: 'publicado',
      ativo: true,
      revisao: 2,
      cor_fallback: null,
      asset_principal: { id: 'a1', mime: 'image/png', bytes: 68, largura: 8, altura: 8, estado: 'publicado', revisao: 1, public_url: 'https://cdn.exemplo/v1/a1.png' },
      asset_subicone: null,
    },
  ],
  regras_misto: [],
};

/** @param {Record<string, (corpo: any, init: any) => [number, any]>} rotas chave "MÉTODO /caminho" */
const servidor = (rotas) => {
  const chamadas = [];
  const fn = vi.fn(async (url, init = {}) => {
    const metodo = init.method || 'GET';
    const caminho = String(url).replace('/api/native', '');
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ metodo, caminho, corpo, headers: init.headers || {}, credentials: init.credentials });
    const h = rotas[`${metodo} ${caminho}`];
    const [status, resposta] = h ? h(corpo, init) : [404, { code: 'NOT_FOUND', message: caminho }];
    return { ok: status < 400, status, text: async () => (resposta === undefined ? '' : JSON.stringify(resposta)) };
  });
  vi.stubGlobal('fetch', fn);
  return chamadas;
};

const escolherArquivo = (rotulo, arquivo) => fireEvent.change(screen.getByLabelText(new RegExp(rotulo)), { target: { files: [arquivo] } });

beforeEach(() => {
  cleanup();
  definirCsrf('');
});

describe('Acesso: login → inscrição obrigatória do MFA → catálogo', () => {
  it('fluxo completo sem token no navegador; CSRF só em memória e nas mutações', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const chamadas = servidor({
      'GET /admin-maike/sessao': () => [401, { code: 'ADMIN_SESSAO_REQUIRED' }],
      'POST /admin-maike/auth/login': () => [200, { etapa: 'inscrever_mfa', admin: { login: 'dono' }, csrf_token: 'csrf-pre' }],
      'POST /admin-maike/mfa/inscricao': () => [200, { segredo: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/x' }],
      'POST /admin-maike/mfa/confirmar': () => [200, { etapa: 'ok', admin: { login: 'dono', mfa_ativo: true }, csrf_token: 'csrf-ok', codigos_recuperacao: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] }],
      'GET /admin-maike/catalogo': () => [200, DADOS],
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Login'), { target: { value: 'dono' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-forte-do-dono-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar chave do autenticador' }));
    expect((await screen.findByTestId('segredo-totp')).textContent).toBe('JBSW Y3DP EHPK 3PXP');
    fireEvent.change(screen.getByLabelText(/Código de 6 dígitos/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }));
    expect((await screen.findByTestId('codigos-recuperacao')).textContent).toContain('AAAAA-BBBBB');
    fireEvent.click(screen.getByRole('button', { name: /Já guardei/ }));
    expect(await screen.findByRole('heading', { name: 'Ícones oficiais' })).toBeInTheDocument();

    const mut = chamadas.filter((c) => c.metodo !== 'GET');
    expect(mut.map((c) => c.headers['x-maike-admin-csrf'])).toEqual(['', 'csrf-pre', 'csrf-pre']);
    expect(chamadas.every((c) => c.credentials === 'same-origin')).toBe(true);
    expect(chamadas.find((c) => c.metodo === 'GET').headers['x-maike-admin-csrf']).toBeUndefined();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('login com segundo fator já ativo pede o código; erro é genérico e legível', async () => {
    servidor({
      'GET /admin-maike/sessao': () => [401, { code: 'ADMIN_SESSAO_REQUIRED' }],
      'POST /admin-maike/auth/login': () => [200, { etapa: 'mfa', admin: { login: 'dono' }, csrf_token: 'c' }],
      'POST /admin-maike/auth/mfa': () => [401, { code: 'ADMIN_CREDENCIAIS_INVALIDAS', message: 'código inválido' }],
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Login'), { target: { value: 'dono' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'x'.repeat(12) } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.change(await screen.findByLabelText('Código do autenticador'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/inválido/);
    fireEvent.click(screen.getByRole('button', { name: /código de recuperação/ }));
    expect(screen.getByLabelText('Código de recuperação')).toBeInTheDocument();
  });
});

describe('Ícones: principal + subícone, troca com id estável', () => {
  const executar = (fn) => fn();

  it('cria com dois assets distintos (bytes intactos), CAS em cada escrita e publica', async () => {
    let revisao = 4;
    let assets = 0;
    const chamadas = servidor({
      'GET /admin-maike/catalogo/revisao': () => [200, { revisao }],
      'POST /catalogo-global/admin/assets': () => {
        revisao += 1;
        assets += 1;
        return [201, { id: `asset-${assets}` }];
      },
      'POST /catalogo-global/admin/icones': () => [201, { id: 'i-novo' }],
      'POST /catalogo-global/admin/icones/i-novo/publicar': () => [200, { id: 'i-novo' }],
    });
    render(<Icones dados={{ ...DADOS, icones: [] }} executar={executar} />);
    fireEvent.change(screen.getByLabelText('Categoria visual'), { target: { value: 'c-gar' } });
    escolherArquivo('^Imagem principal', new File([PNG], 'garrote.png', { type: 'image/png' }));
    escolherArquivo('^Subícone', new File([PNG.slice(0, 9)], 'sub.png', { type: 'image/png' }));
    await screen.findByAltText('Prévia: Subícone');
    fireEvent.click(screen.getByRole('button', { name: 'Criar ícone' }));
    await waitFor(() => expect(chamadas.some((c) => c.caminho.endsWith('/publicar'))).toBe(true));
    const enviados = chamadas.filter((c) => c.caminho === '/catalogo-global/admin/assets');
    expect(enviados).toHaveLength(2);
    expect(Buffer.from(enviados[0].corpo.conteudo_base64, 'base64')).toEqual(Buffer.from(PNG));
    expect(enviados.map((c) => c.corpo.revisao_esperada)).toEqual([4, 5]);
    const icone = chamadas.find((c) => c.caminho === '/catalogo-global/admin/icones');
    expect(icone.corpo).toMatchObject({ tipo_id: 't-lote', categoria_id: 'c-gar', asset_principal_id: 'asset-1', asset_subicone_id: 'asset-2', revisao_esperada: 6 });
  });

  it('arquivo acima do limite ou SVG: orientação e nenhuma chamada', async () => {
    const chamadas = servidor({});
    render(<Icones dados={{ ...DADOS, limites: { ...DADOS.limites, max_bytes: 4 } }} executar={executar} />);
    escolherArquivo('^Imagem principal', new File([PNG], 'grande.png', { type: 'image/png' }));
    expect(await screen.findByText(/acima do limite de 0 KB\. Exporte o ícone em tamanho menor/)).toBeInTheDocument();
    escolherArquivo('^Imagem principal', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
    expect(await screen.findByText(/SVG não é aceito/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar ícone' })).toBeDisabled();
    expect(chamadas).toHaveLength(0);
  });

  it('trocar imagem envia novo asset e PATCH no MESMO id do ícone', async () => {
    const chamadas = servidor({
      'GET /admin-maike/catalogo/revisao': () => [200, { revisao: 4 }],
      'POST /catalogo-global/admin/assets': () => [201, { id: 'asset-novo' }],
      'PATCH /catalogo-global/admin/icones/i-bez-0001': () => [200, { id: 'i-bez-0001' }],
    });
    render(<Icones dados={DADOS} executar={executar} />);
    const cartao = screen.getByTestId('cartao-icone');
    expect(cartao.querySelector('img').getAttribute('src')).toBe('https://cdn.exemplo/v1/a1.png');
    fireEvent.change(screen.getByLabelText('Nova imagem principal'), { target: { files: [new File([PNG], 'n.png', { type: 'image/png' })] } });
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(true));
    expect(chamadas.find((c) => c.metodo === 'PATCH').corpo).toEqual({ asset_principal_id: 'asset-novo', revisao_esperada: 4 });
  });
});

describe('Regras MISTO e validação', () => {
  it('MISTO: aviso de que não é o sexo do lote nem muda o mapa; cria com ≥ 2 categorias', async () => {
    const chamadas = servidor({
      'GET /admin-maike/catalogo/validacao': () => [200, { ok: true, erros: [], avisos: [] }],
      'GET /admin-maike/catalogo/revisao': () => [200, { revisao: 4 }],
      'POST /catalogo-global/admin/regras-misto': () => [201, { id: 'r1' }],
    });
    render(<RegrasMisto dados={DADOS} executar={(fn) => fn()} />);
    expect(screen.getByText(/Não é o sexo “Misto” do lote e, por enquanto, não altera o mapa atual/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Nova regra'));
    const botao = screen.getByRole('button', { name: 'Criar regra (rascunho)' });
    fireEvent.click(screen.getByRole('checkbox', { name: /Bezerro/ }));
    expect(botao).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Garrote/ }));
    fireEvent.change(screen.getByLabelText(/Ícone resultado/), { target: { value: 'i-bez-0001' } });
    fireEvent.click(botao);
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'POST')).toBe(true));
    expect(chamadas.find((c) => c.metodo === 'POST').corpo).toEqual({
      tipo_id: 't-lote',
      categoria_ids: ['c-bez', 'c-gar'],
      icone_id: 'i-bez-0001',
      prioridade: 0,
      revisao_esperada: 4,
    });
  });

  it('validação mostra erros e a prévia do que os clientes verão', async () => {
    servidor({
      'GET /admin-maike/catalogo/validacao': () => [
        200,
        { ok: false, erros: [{ codigo: 'MISTO_DUPLICADA', mensagem: 'regras MISTO duplicadas para A + B', ids: [] }], avisos: [] },
      ],
    });
    render(<Validacao dados={DADOS} />);
    expect(await screen.findByText(/regras MISTO duplicadas/)).toBeInTheDocument();
    expect(screen.getByTestId('resultado-validacao').getAttribute('data-ok')).toBe('false');
    expect(screen.getByAltText('Publicado: Bezerro').getAttribute('src')).toBe('https://cdn.exemplo/v1/a1.png');
  });
});

describe('Conta e mensagens', () => {
  it('trocar senha exige senha atual + código e encerra a sessão', async () => {
    const chamadas = servidor({
      'GET /admin-maike/conta/sessoes': () => [200, []],
      'POST /admin-maike/conta/senha': () => [200, { sessoes_revogadas: true }],
    });
    const encerrada = vi.fn();
    render(<Conta admin={{ login: 'dono', mfa_ativo: true }} onSessaoEncerrada={encerrada} avisar={vi.fn()} />);
    const form = screen.getByRole('form', { name: 'Trocar senha' });
    const campo = (r) => form.querySelector(`#senha-${r}`);
    fireEvent.change(campo('senha-atual'), { target: { value: 'atual-atual-1' } });
    fireEvent.change(campo('codigo'), { target: { value: '123456' } });
    fireEvent.change(campo('nova'), { target: { value: 'nova-senha-123' } });
    fireEvent.change(campo('confirmar'), { target: { value: 'nova-senha-123' } });
    fireEvent.submit(form);
    await waitFor(() => expect(encerrada).toHaveBeenCalled());
    expect(chamadas.find((c) => c.metodo === 'POST').corpo).toEqual({ senha_atual: 'atual-atual-1', codigo_mfa: '123456', nova_senha: 'nova-senha-123' });
  });

  it('409 de revisão vs duplicidade têm mensagens distintas', () => {
    const conflito = { code: 'CONCURRENCY_CONFLICT', message: 'revisão desatualizada' };
    const dup = { code: 'CONCURRENCY_CONFLICT', message: 'registro já existe' };
    expect(ehConflitoRevisao(conflito)).toBe(true);
    expect(ehDuplicidade(dup)).toBe(true);
    expect(mensagemDeErro(conflito)).toMatch(/alterado em outra sessão/);
    expect(mensagemDeErro(dup)).toMatch(/Já existe/);
  });
});
