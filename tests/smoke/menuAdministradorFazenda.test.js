/**
 * Menu administrativo só para o administrador da fazenda (D-PROD-77).
 *
 * Antes, o menu decidia "administrador" por `Permissao.is_admin` — e a
 * permissão mínima nativa marca `is_admin: true` para quem não tem registro, o
 * que mostrava Usuários, Permissões e Configurações Gerais a qualquer conta.
 * Agora vale só o papel relido do banco pelo servidor (`/auth/contexto`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { PAGINAS_SO_ADMINISTRADOR, DEFAULT_MENU } from '../../src/lib/menuConfig.js';
import { ehAdministrador, permissaoMinimaNativa } from '../../src/services/sessionService.js';

const codigoDe = (rel) =>
  readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('ADM — menu administrativo pelo papel do servidor', () => {
  it('ADM-01 Usuários, Permissões e Configurações Gerais são só do administrador', () => {
    const adm = DEFAULT_MENU.find((m) => m.id === 'administracao').submenu.map((p) => p.id);
    for (const id of ['adm-usuarios', 'adm-permissoes', 'adm-configuracoes']) {
      expect(adm).toContain(id);
      expect(PAGINAS_SO_ADMINISTRADOR).toContain(id);
    }
  });

  it('ADM-02 a permissão mínima (is_admin: true) NÃO torna ninguém administrador', () => {
    const minima = permissaoMinimaNativa({ login: 'vaqueiro' });
    expect(minima.is_admin).toBe(true);
    expect(ehAdministrador({ login: 'vaqueiro', administrador_fazenda: false }, minima)).toBe(false);
    expect(ehAdministrador({ login: 'maike', administrador_fazenda: true })).toBe(true);
  });

  it('ADM-03 o Layout filtra o menu e bloqueia a URL direta pelo papel', () => {
    const layout = codigoDe('src/Layout.jsx');
    expect(layout).toMatch(/const isAdminUser = React\.useMemo\(\(\) => ehAdministrador\(user\)/);
    expect(layout).toMatch(/PAGINAS_SO_ADMINISTRADOR\.includes\(pageId\) \|\| isAdminUser/);
    expect(layout).toMatch(/if \(!podeVerPagina\(item\.id, moduleId\)\) return null;/);
    expect(layout).toMatch(/if \(podeVerPagina\(currentMenuPage\.id, currentMenuPage\.moduleId\)\)/);
    expect(layout).not.toMatch(/isAdminUser[^\n]*is_admin/);
  });

  it('ADM-04 o usuário da sessão carrega administrador_fazenda vindo do /auth/contexto', () => {
    const api = codigoDe('src/apis/session/nativeSessionApi.js');
    expect(api).toMatch(/administrador_fazenda: contexto\.administrador_fazenda === true/);
  });
});
