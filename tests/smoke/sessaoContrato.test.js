/**
 * Contrato estável de sessão (P1.4-R1).
 *
 * A P1.4 fechou a contagem da fronteira mas deixou o **formato de erro** do
 * provider atravessar: `sessionApi` devolvia o erro cru de propósito,
 * `AuthContext` lia `status`, `data.extra_data.reason` e `message`, e
 * `sessionService` procurava o status em quatro lugares diferentes de `cause`.
 * Trocar o provider exigiria mexer nos três.
 *
 * Aqui o provider é mockado **só na fronteira** — que é o único lugar
 * autorizado a conhecer o formato dele — e o que se verifica é o contrato que
 * sai: `{ok, value}` / `{ok, reason}` e o veredito de autenticação.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionProvider = {
  capacidades: vi.fn(() => ({ logout: true, redirectToLogin: true, updateMe: false })),
  me: vi.fn(),
  listUsuarios: vi.fn(),
  listPermissoes: vi.fn(),
  updateUsuario: vi.fn(),
  createPermissao: vi.fn(),
  updatePermissao: vi.fn(),
  deletePermissao: vi.fn(),
  logout: vi.fn(),
  redirectToLogin: vi.fn(),
  fetchPublicSettings: vi.fn(),
};

vi.mock('@/apis/_providers/base44Provider', () => ({ sessionProvider }));

const api = await import('@/apis/session');

/** Erro no formato que a Base44 produz — só este arquivo precisa conhecê-lo. */
const erroDoProvider = ({ status, reason }) =>
  Object.assign(new Error('Failed to load app public settings'), {
    status,
    data: reason ? { extra_data: { reason } } : null,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SE1–SE4 — configurações públicas com resultado discriminado', () => {
  it('SE1 — sucesso devolve { ok: true, value }', async () => {
    sessionProvider.fetchPublicSettings.mockResolvedValue({ id: 'app', public_settings: { x: 1 } });
    expect(await api.getAppPublicSettings()).toEqual({
      ok: true,
      value: { id: 'app', public_settings: { x: 1 } },
    });
  });

  it('SE2 — 403 + auth_required vira razão estável', async () => {
    sessionProvider.fetchPublicSettings.mockRejectedValue(erroDoProvider({ status: 403, reason: 'auth_required' }));
    expect(await api.getAppPublicSettings()).toEqual({ ok: false, reason: 'auth_required' });
  });

  it('SE3 — 403 + user_not_registered vira razão estável', async () => {
    sessionProvider.fetchPublicSettings.mockRejectedValue(
      erroDoProvider({ status: 403, reason: 'user_not_registered' })
    );
    expect(await api.getAppPublicSettings()).toEqual({ ok: false, reason: 'user_not_registered' });
  });

  it('SE4 — qualquer outra falha vira unknown, sem vazar o erro', async () => {
    const casos = [
      erroDoProvider({ status: 500 }),
      erroDoProvider({ status: 403, reason: 'motivo_que_o_produto_nao_conhece' }),
      erroDoProvider({ status: 401, reason: 'auth_required' }), // razão certa, status errado
      new Error('rede caiu'),
    ];

    for (const erro of casos) {
      sessionProvider.fetchPublicSettings.mockRejectedValue(erro);
      const resultado = await api.getAppPublicSettings();
      expect(resultado).toEqual({ ok: false, reason: 'unknown' });
      // Nada do erro cru atravessa: as únicas chaves são as do contrato, e o
      // lado inválido da união vem explicitamente `undefined` — é isso que faz
      // o `checkJs` estreitar `resultado.value` depois de testar `resultado.ok`.
      expect(Object.keys(resultado).sort()).toEqual(['ok', 'reason', 'value']);
      expect(resultado.value).toBeUndefined();
    }
  });
});

describe('SE5–SE8 — veredito de autenticação', () => {
  it('SE5 — me() com sucesso autentica', async () => {
    sessionProvider.me.mockResolvedValue({ email: 'a@b.c' });
    expect(await api.verificarSessao()).toEqual({
      autenticado: true,
      usuario: { email: 'a@b.c' },
      precisaAutenticar: false,
    });
  });

  it('SE6 — 401 pede autenticação', async () => {
    sessionProvider.me.mockRejectedValue(erroDoProvider({ status: 401 }));
    expect(await api.verificarSessao()).toEqual({ autenticado: false, usuario: null, precisaAutenticar: true });
  });

  it('SE7 — 403 pede autenticação', async () => {
    sessionProvider.me.mockRejectedValue(erroDoProvider({ status: 403 }));
    expect(await api.verificarSessao()).toEqual({ autenticado: false, usuario: null, precisaAutenticar: true });
  });

  it('SE8 — falha de rede não autentica e não pede login', async () => {
    sessionProvider.me.mockRejectedValue(new Error('ECONNRESET'));
    expect(await api.verificarSessao()).toEqual({ autenticado: false, usuario: null, precisaAutenticar: false });
  });

  it('SE8b — status em `statusCode` ou `response.status` também é reconhecido', async () => {
    sessionProvider.me.mockRejectedValue(Object.assign(new Error('x'), { statusCode: 401 }));
    expect((await api.verificarSessao()).precisaAutenticar).toBe(true);

    sessionProvider.me.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 403 } }));
    expect((await api.verificarSessao()).precisaAutenticar).toBe(true);
  });
});

describe('SE10 — o formato cru do provider não sai da API', () => {
  const lerFonte = async (rel) => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(process.cwd(), rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  };

  it('SE10a — sessionService não inspeciona status, cause nem response', async () => {
    const fonte = await lerFonte('src/services/sessionService.js');
    for (const proibido of ['.status', '.statusCode', '.response', 'cause', 'extra_data', 'statusDaFalha']) {
      expect(fonte, proibido).not.toContain(proibido);
    }
  });

  it('SE10b — nenhuma outra camada lê o formato de erro do provider', async () => {
    const { readdirSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raiz = process.cwd();

    const arquivosDe = (dir) =>
      existsSync(join(raiz, dir))
        ? readdirSync(join(raiz, dir))
            .filter((f) => f.endsWith('.js') || f.endsWith('.jsx'))
            .map((f) => `${dir}/${f}`)
        : [];

    const camadas = ['src/services', 'src/pages', 'src/lib'];
    const infratores = [];
    for (const rel of camadas.flatMap(arquivosDe)) {
      const fonte = await lerFonte(rel);
      if (/extra_data|\.statusCode\b|erro\?\.status\b|error\.status\b/.test(fonte)) infratores.push(rel);
    }
    expect(infratores).toEqual([]);
  });

  it('SE10c — só a API de sessão conhece o formato', async () => {
    const fonte = await lerFonte('src/apis/session/sessionApi.js');
    expect(fonte).toContain('extra_data');
    expect(fonte).toContain('statusCode');
    // E não anuncia mais que repassa erro cru.
    expect(fonte).not.toContain('erro cru');
  });
});

describe('SE11 — o catálogo de códigos P1.4 não tem órfão', () => {
  /**
   * Código catalogado sem consumidor é promessa sem contrato.
   *
   * A P1.4 afirmou "12 códigos novos, todos com consumidor e teste real", mas
   * `PRODUTO_PARTIAL_IMPORT` só aparecia na declaração, na mensagem e na
   * documentação — a importação sempre devolveu `{importados, falhas, total}` e
   * nunca lançou. Foi removido; este teste impede que volte a acontecer.
   *
   * A declaração, o catálogo de mensagens, os testes e a documentação **não**
   * contam como consumidor.
   */
  const CODIGOS_P14 = [
    'PRODUTO_NAME_CONFLICT',
    'PRODUTO_DELETE_BLOCKED',
    'MARCA_NAME_CONFLICT',
    'UNIDADE_MEDIDA_DELETE_BLOCKED',
    'LOCAL_ESTOQUE_DELETE_BLOCKED',
    'LOCAL_ESTOQUE_PARTIAL_OPERATION',
    'GRUPO_ATIVIDADE_DELETE_BLOCKED',
    'TIPO_TAREFA_DELETE_BLOCKED',
    'PERMISSAO_SELF_DELETE_BLOCKED',
    'SUPLEMENTACAO_PARTIAL_OPERATION',
    'OFFLINE_ENTITY_UNSUPPORTED',
  ];

  const arquivosDeSrc = async () => {
    const { readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readdirSync(join(process.cwd(), 'src'), { recursive: true })
      .filter((f) => typeof f === 'string' && (f.endsWith('.js') || f.endsWith('.jsx')))
      .map((f) => `src/${f}`.replace(/\\/g, '/'))
      .filter((rel) => rel !== 'src/apis/_core/ApiError.js');
  };

  it('cada código P1.4 tem pelo menos um consumidor real em src/', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const arquivos = await arquivosDeSrc();

    const consumidores = Object.fromEntries(CODIGOS_P14.map((codigo) => [codigo, []]));
    for (const rel of arquivos) {
      const fonte = readFileSync(join(process.cwd(), rel), 'utf8');
      for (const codigo of CODIGOS_P14) {
        if (fonte.includes(`API_ERROR_CODES.${codigo}`)) consumidores[codigo].push(rel);
      }
    }

    const orfaos = CODIGOS_P14.filter((codigo) => consumidores[codigo].length === 0);
    expect(orfaos, `códigos catalogados sem consumidor em src/: ${orfaos.join(', ')}`).toEqual([]);
  });

  it('o catálogo não contém PRODUTO_PARTIAL_IMPORT', async () => {
    const { API_ERROR_CODES } = await import('@/apis/_core/ApiError');
    expect(Object.keys(API_ERROR_CODES)).not.toContain('PRODUTO_PARTIAL_IMPORT');
  });

  it('são 11 códigos da P1.4, não 12', () => {
    expect(CODIGOS_P14).toHaveLength(11);
  });
});

describe('SE12 — o Button não usa supressão de tipo', () => {
  it('sem @type any, sem ts-ignore, sem ts-nocheck', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fonte = readFileSync(join(process.cwd(), 'src/components/ui/button.jsx'), 'utf8');

    expect(fonte).not.toMatch(/@type\s*\{\s*any\s*\}/);
    expect(fonte).not.toMatch(/@type\s*\{\s*unknown\s*\}/);
    expect(fonte).not.toContain('@ts-ignore');
    expect(fonte).not.toContain('@ts-nocheck');
    expect(fonte).not.toContain('@ts-expect-error');

    // E declara o contrato de verdade.
    expect(fonte).toContain('ComponentPropsWithoutRef');
    expect(fonte).toContain('VariantProps');
    expect(fonte).toContain('HTMLButtonElement');
    expect(fonte).toContain('asChild');
  });
});
