// @vitest-environment jsdom
/**
 * D-PROD-121 — Notificações e confirmações no padrão do sistema:
 * - `toast.*` do sonner chamado direto sai no cartão do sistema (não texto solto);
 * - confirmações pelo diálogo do sistema (`confirmar`), nunca `window.confirm`;
 * - avisos de validação pelo cartão (`notifyWarning`), nunca `alert`;
 * - "Não é possível excluir" no mesmo diálogo, com "Entendi".
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import MaikeAvisosHost from "@/components/common/MaikeAvisosHost";
import { confirmar, confirmarExclusao, avisar } from "@/lib/maikeConfirmar";
import { emitDeleteDialog } from "@/lib/deleteDialogBus";
import { instalarToastsDoSistema } from "@/lib/maikeNotify";

afterEach(cleanup);

const arquivos = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(jsx?|tsx?)$/.test(n) ? [p] : [];
  });

describe("sem confirm/alert do navegador (D-PROD-121)", () => {
  it("nenhum window.confirm, confirm() ou alert() em src/ (fora do fallback do maikeConfirmar)", () => {
    const ruins = arquivos("src")
      .filter((p) => !p.endsWith("maikeConfirmar.js") && !p.includes(join("components", "ui")))
      .filter((p) => /(^|[^.\w])(confirm|alert)\(|window\.(confirm|alert)\(/m.test(readFileSync(p, "utf8")));
    expect(ruins).toEqual([]);
  });

  it("App monta o host de avisos e os toasts do sistema são instalados antes do interceptor", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/<MaikeAvisosHost \/>/);
    const main = readFileSync("src/main.jsx", "utf8");
    expect(main.indexOf("installToastsDoSistema")).toBeGreaterThan(-1);
    expect(main.indexOf("installToastsDoSistema")).toBeLessThan(main.indexOf("installDeleteDialogInterceptor"));
  });
});

describe("confirmar() no diálogo do sistema", () => {
  it("confirmar exclusão resolve true em Excluir e false em Cancelar", async () => {
    render(<MaikeAvisosHost />);
    let r1;
    act(() => {
      r1 = confirmarExclusao("Excluir este lançamento do bebedouro?");
    });
    expect(await screen.findByText("Excluir este lançamento do bebedouro?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    await expect(r1).resolves.toBe(true);

    let r2;
    act(() => {
      r2 = confirmar({ titulo: "Duração", descricao: "Salvar mesmo assim?", textoConfirmar: "Salvar mesmo assim" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await expect(r2).resolves.toBe(false);
  });

  it("avisar e bloqueio de exclusão: um botão só, Entendi", async () => {
    render(<MaikeAvisosHost />);
    act(() => emitDeleteDialog("Existem registros vinculados a este setor."));
    expect((await screen.findAllByText("Não é possível excluir")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
    expect(screen.queryByText("Existem registros vinculados a este setor.")).toBeNull();

    let r;
    act(() => {
      r = avisar("Atenção", "Sem conexão");
    });
    fireEvent.click(await screen.findByRole("button", { name: "Entendi" }));
    await expect(r).resolves.toBeUndefined();
  });

  it("sem host montado, cai no window.confirm", async () => {
    const original = window.confirm;
    window.confirm = vi.fn(() => true);
    await expect(confirmar({ descricao: "Ok?" })).resolves.toBe(true);
    expect(window.confirm).toHaveBeenCalledWith("Ok?");
    window.confirm = original;
  });
});

describe("toast.* direto usa o cartão do sistema", () => {
  it("success/error/warning/info/message viram toast.custom com MaikeToastCard", () => {
    const custom = vi.fn();
    const falso = /** @type {any} */ ({ custom, success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() });
    instalarToastsDoSistema(falso);
    falso.success("Lote salvo");
    falso.error(new Error("Falhou"));
    falso.warning("Atenção", { description: "Preencha a área", duration: 9000 });
    expect(custom).toHaveBeenCalledTimes(3);
    expect(custom.mock.calls[2][1]).toMatchObject({ duration: 9000, unstyled: true, className: "mg-toast-host" });
  });
});
