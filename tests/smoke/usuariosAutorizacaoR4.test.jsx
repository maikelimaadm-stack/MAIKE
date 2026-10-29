/**
 * PR145-R4 (D-PROD-71) — UI de Usuários com a autoridade server-owned.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import FormularioContaAcesso from '@/components/usuarios/FormularioContaAcesso';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const CONTA = { id: 'u1', nome: 'Peão', login: 'peao', ativo: true };
const preencherNovaSenha = () =>
  fireEvent.change(screen.getByPlaceholderText('Deixe em branco para manter'), { target: { value: 'nova-senha-123' } });

describe('Usuários — senha e autorização (R4)', () => {
  it('na PRÓPRIA conta, trocar a senha pede e envia a senha atual', () => {
    const onSubmit = vi.fn();
    render(<FormularioContaAcesso initialData={CONTA} ehPropriaConta onSubmit={onSubmit} onCancel={() => {}} />);
    preencherNovaSenha();
    const atual = screen.getByPlaceholderText('Necessária para trocar a sua senha');
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar conta' }).closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(atual, { target: { value: 'senha-antiga-1' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar conta' }).closest('form'));
    expect(onSubmit).toHaveBeenCalledWith({ nome: 'Peão', ativo: true, nova_senha: 'nova-senha-123', senha_atual: 'senha-antiga-1' });
  });

  it('na conta de OUTRO usuário (administrador), não pede senha atual', () => {
    const onSubmit = vi.fn();
    render(<FormularioContaAcesso initialData={CONTA} onSubmit={onSubmit} onCancel={() => {}} />);
    preencherNovaSenha();
    expect(screen.queryByPlaceholderText('Necessária para trocar a sua senha')).toBeNull();
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar conta' }).closest('form'));
    expect(onSubmit.mock.calls[0][0]).toEqual({ nome: 'Peão', ativo: true, nova_senha: 'nova-senha-123' });
  });

  it('403 do servidor vira mensagem clara para quem não é administrador da fazenda', () => {
    expect(new ApiError(API_ERROR_CODES.TENANT_ADMIN_REQUIRED).message).toMatch(/Somente o administrador da fazenda/);
    expect(new ApiError(API_ERROR_CODES.USUARIO_SENHA_ATUAL_INVALIDA).message).toMatch(/senha atual/);
  });
});
