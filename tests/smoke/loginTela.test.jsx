/**
 * Tela de entrada (D-PROD-135): sem o aviso de "código de cliente", validação
 * no envio, "Manter conectado" repassado ao login e usuário lembrado.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NativeLoginForm from '@/components/auth/NativeLoginForm';

beforeEach(() => {
  window.localStorage.clear();
});

describe('NativeLoginForm — tela nova', () => {
  it('LOG-01 não mostra mais o aviso de código de cliente', () => {
    render(<NativeLoginForm entrar={vi.fn()} onAutenticado={vi.fn()} />);
    expect(screen.queryByText(/código de cliente/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Manter conectado' })).toBeTruthy();
  });

  it('LOG-02 enviar vazio avisa no campo e não chama o login', () => {
    const entrar = vi.fn();
    render(<NativeLoginForm entrar={entrar} onAutenticado={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByText('Informe o usuário.')).toBeTruthy();
    expect(entrar).not.toHaveBeenCalled();
  });

  it('LOG-03 "Manter conectado" vai para o login e lembra o usuário na próxima vez', async () => {
    const entrar = vi.fn().mockResolvedValue({});
    const { unmount } = render(<NativeLoginForm entrar={entrar} onAutenticado={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: ' joao ' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 's3nh4' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Manter conectado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(entrar).toHaveBeenCalledWith({ login: 'joao', senha: 's3nh4', lembrar: true }));
    // A senha nunca é guardada pelo sistema.
    expect(JSON.stringify(window.localStorage)).not.toContain('s3nh4');
    unmount();

    render(<NativeLoginForm entrar={entrar} onAutenticado={vi.fn()} />);
    expect(screen.getByLabelText('Usuário').value).toBe('joao');
    expect(screen.getByRole('switch', { name: 'Manter conectado' }).getAttribute('aria-checked')).toBe('true');
  });

  it('LOG-04 sem "Manter conectado" nada fica lembrado', async () => {
    const entrar = vi.fn().mockResolvedValue({});
    render(<NativeLoginForm entrar={entrar} onAutenticado={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'joao' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 's3nh4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(entrar).toHaveBeenCalledWith({ login: 'joao', senha: 's3nh4', lembrar: false }));
    expect(window.localStorage.getItem('maike_login_preferencias')).toBeNull();
  });

  it('LOG-06 tocar no texto "Manter conectado" também liga a chave', () => {
    render(<NativeLoginForm entrar={vi.fn()} onAutenticado={vi.fn()} />);
    fireEvent.click(screen.getByText('Não use em computador compartilhado.'));
    expect(screen.getByRole('switch', { name: 'Manter conectado' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('switch', { name: 'Manter conectado' }));
    expect(screen.getByRole('switch', { name: 'Manter conectado' }).getAttribute('aria-checked')).toBe('false');
  });

  it('LOG-05 o olho mostra e esconde a senha', () => {
    render(<NativeLoginForm entrar={vi.fn()} onAutenticado={vi.fn()} />);
    const senha = screen.getByLabelText('Senha');
    expect(senha.getAttribute('type')).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(senha.getAttribute('type')).toBe('text');
  });
});
