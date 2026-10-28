/**
 * Split Usuários / Permissões — PR #125 (MotorBase1 + autorização adm-permissoes).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  canAccessPage,
  canPerformAction,
  getPagePermission,
  resolvePermissionPageId,
} from "@/lib/permissions";
import { DEFAULT_MENU, findMenuItemByUrl } from "@/lib/menuConfig";
import scope from "../../config/mapa-manejo-scope.json";

const listarContasMock = vi.fn();
const criarContaMock = vi.fn();
const listarUsuariosMock = vi.fn();
const listarPermissoesMock = vi.fn();

vi.mock("@/services/usuarioAdminService", () => ({
  listarContasAcesso: (...a) => listarContasMock(...a),
  criarContaAcesso: (...a) => criarContaMock(...a),
  atualizarContaAcesso: vi.fn(),
  validarPatchContaAcesso: vi.fn(),
}));

vi.mock("@/services/sessionService", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    getCurrentUser: vi.fn(async () => ({ email: "admin@test.com", login: "admin" })),
    listarUsuarios: (...a) => listarUsuariosMock(...a),
    listarPermissoes: (...a) => listarPermissoesMock(...a),
    salvarPermissao: vi.fn(),
    removerPermissao: vi.fn(),
    permissaoDoUsuario: orig.permissaoDoUsuario,
  };
});

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ clienteId: "c1", user: { id: "u1" } }),
}));

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("MENU-SCOPE — split Usuários / Permissões", () => {
  it("menu tem adm-usuarios e adm-permissoes com URLs distintas", () => {
    const adm = DEFAULT_MENU.find((m) => m.id === "administracao");
    const ids = adm.submenu.map((s) => s.id);
    expect(ids).toContain("adm-usuarios");
    expect(ids).toContain("adm-permissoes");
    const usuarios = adm.submenu.find((s) => s.id === "adm-usuarios");
    expect(usuarios.title).toBe("Usuários");
    expect(usuarios.url).toBe("Usuarios");
    const perm = adm.submenu.find((s) => s.id === "adm-permissoes");
    expect(perm.url).toBe("Permissoes");
    expect(scope.allowedPages).toContain("Permissoes");
  });

  it("Usuarios.jsx usa MotorBase1; Permissoes.jsx não mistura contas", () => {
    const usuariosSrc = readFileSync("src/pages/Usuarios.jsx", "utf8");
    expect(usuariosSrc).toMatch(/CadastroBase1Screen/);
    expect(usuariosSrc).toMatch(/useCadastroBase1FullListController/);
    expect(usuariosSrc).not.toMatch(/listarPermissoes/);
    expect(usuariosSrc).not.toMatch(/FormularioUsuario/);
    expect(usuariosSrc).toMatch(/showDelete=\{false\}/);

    const permSrc = readFileSync("src/pages/Permissoes.jsx", "utf8");
    expect(permSrc).toMatch(/FormularioUsuario/);
    expect(permSrc).not.toMatch(/listarContasAcesso/);
    expect(permSrc).not.toMatch(/FormularioContaAcesso/);
  });
});

describe("AUTH-REDTEAM — adm-permissoes herda adm-usuarios", () => {
  const restricted = {
    is_admin: false,
    modulos_permitidos: ["administracao"],
    permissoes_telas: [
      {
        tela_id: "adm-usuarios",
        modulo_id: "administracao",
        visualizar: false,
        novo: false,
        salvar: false,
        editar: false,
        excluir: false,
        importar: false,
        exportar: false,
      },
    ],
  };

  it("resolvePermissionPageId mapeia adm-permissoes → adm-usuarios", () => {
    expect(resolvePermissionPageId("adm-permissoes")).toBe("adm-usuarios");
    expect(resolvePermissionPageId("adm-usuarios")).toBe("adm-usuarios");
  });

  it("bloqueio explícito em adm-usuarios bloqueia Permissões também", () => {
    expect(canAccessPage(restricted, "adm-usuarios", "administracao")).toBe(false);
    expect(canAccessPage(restricted, "adm-permissoes", "administracao")).toBe(false);
    expect(canPerformAction(restricted, "adm-permissoes", "administracao", "editar")).toBe(false);
  });

  it("liberação em adm-usuarios libera Permissões (retrocompat)", () => {
    const allowed = {
      ...restricted,
      permissoes_telas: [{ ...restricted.permissoes_telas[0], visualizar: true, editar: true }],
    };
    expect(canAccessPage(allowed, "adm-permissoes", "administracao")).toBe(true);
    expect(getPagePermission(allowed, "adm-permissoes")?.tela_id).toBe("adm-usuarios");
  });

  it("usuário sem linha de tela continua fail-open (documentado)", () => {
    const failOpen = {
      is_admin: false,
      modulos_permitidos: ["administracao"],
      permissoes_telas: [],
    };
    expect(canAccessPage(failOpen, "adm-permissoes", "administracao")).toBe(true);
  });
});

describe("DOM — /usuarios contas nativas", () => {
  beforeEach(() => {
    listarContasMock.mockReset();
    listarContasMock.mockResolvedValue([
      { id: "1", login: "op1", nome: "Operador", ativo: true },
    ]);
  });

  it("lista contas e botão Novo", async () => {
    const { default: Usuarios } = await import("@/pages/Usuarios");
    wrap(<Usuarios />);
    await waitFor(() => expect(listarContasMock).toHaveBeenCalled());
    expect(await screen.findByText("Operador")).toBeTruthy();
    expect(screen.getByRole("button", { name: /novo/i })).toBeTruthy();
    expect(screen.queryByText(/permissoes de menu/i)).toBeFalsy();
  });
});

describe("DOM — /permissoes matriz", () => {
  beforeEach(() => {
    listarUsuariosMock.mockResolvedValue([
      { id: "u1", email: "user@test.com", full_name: "User Test" },
    ]);
    listarPermissoesMock.mockResolvedValue([]);
  });

  it("lista destinatários por email (sem campo senha)", async () => {
    const { default: Permissoes } = await import("@/pages/Permissoes");
    wrap(<Permissoes />);
    await waitFor(() => expect(listarUsuariosMock).toHaveBeenCalled());
    expect(await screen.findByText(/user@test.com/i)).toBeTruthy();
    expect(screen.queryByLabelText(/senha/i)).toBeFalsy();
  });
});

describe("Congelados — Mapa intacto", () => {
  it("diff não inclui paths de mapa (inspeção estática desta missão)", () => {
    const permSrc = readFileSync("src/pages/Permissoes.jsx", "utf8");
    expect(permSrc).not.toMatch(/mapaGeralPermissions/);
    expect(findMenuItemByUrl(DEFAULT_MENU, "Permissoes")?.id).toBe("adm-permissoes");
  });
});
