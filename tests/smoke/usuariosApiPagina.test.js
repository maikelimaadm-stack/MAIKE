/**
 * SCALE-01 R2 — `listUsuariosPage` preserva o contrato de `total`.
 *
 * Backend: número na 1ª página, `null` nas seguintes. O normalizador
 * compartilhado do motor Base1 converteria `null` em 0; a API de usuários
 * mantém o `null` (sem alterar o motor) e o motor continua lendo o total da
 * página 0.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const paginaNativa = vi.fn();

vi.mock("@/apis/usuarios/usuarioNativePort.js", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, listUsuariosPaginaNativo: (...a) => paginaNativa(...a) };
});

const { listUsuariosPage } = await import("@/apis/usuarios/usuariosApi.js");

const item = { id: "u1", login: "op", nome: "Op", ativo: true };

beforeEach(() => paginaNativa.mockReset());

describe("listUsuariosPage — total", () => {
  it("1ª página: total numérico, inclusive 0 real", async () => {
    paginaNativa.mockResolvedValue({ items: [item], next_cursor: "c", has_more: true, total: 250, limit: 100 });
    expect((await listUsuariosPage({ limit: 100 })).total).toBe(250);
    paginaNativa.mockResolvedValue({ items: [], next_cursor: null, has_more: false, total: 0, limit: 100 });
    expect((await listUsuariosPage({ limit: 100 })).total).toBe(0);
  });

  it("página seguinte: total null preservado (não vira 0)", async () => {
    paginaNativa.mockResolvedValue({ items: [item], next_cursor: null, has_more: false, total: null, limit: 100 });
    const p = await listUsuariosPage({ limit: 100, cursor: "c" });
    expect(p.total).toBeNull();
    expect(p.items[0]).toMatchObject({ id: "u1", login: "op", email: "op" });
  });

  it("repassa limit, cursor, q e ativo para a porta", async () => {
    paginaNativa.mockResolvedValue({ items: [], next_cursor: null, has_more: false, total: 0, limit: 50 });
    await listUsuariosPage({ limit: 50, cursor: "abc", q: "joa", ativo: false });
    expect(paginaNativa).toHaveBeenCalledWith({ limit: 50, cursor: "abc", q: "joa", ativo: false });
  });
});
