import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MobileShellProvider, usePublishMobileShell } from "@/lib/mobileShellContext";
import B1MobileSaveBar from "@/components/cadastro/base1/B1MobileSaveBar";

afterEach(cleanup);
function Publicar({ record }) { usePublishMobileShell(record); return null; }
const montar = (record, enviar = () => {}) => render(<MobileShellProvider><Publicar record={record} /><form id="form-teste" onSubmit={(e) => { e.preventDefault(); enviar(); }} /><B1MobileSaveBar /></MobileShellProvider>);
it("envia o formulário publicado pelo cadastro, sem substituir a ação do motor", () => {
  const enviar = vi.fn();
  montar({ editing: true, formId: "form-teste", permissaoExplicita: true }, enviar);
  const salvar = screen.getByRole("button", { name: "Salvar" });
  expect(salvar).toHaveAttribute("data-permissao-explicita");
  fireEvent.click(salvar);
  expect(enviar).toHaveBeenCalledOnce();
});
it("bloqueia um novo envio enquanto o cadastro está salvando", () => {
  const enviar = vi.fn();
  montar({ editing: true, formId: "form-teste", saving: true }, enviar);
  const salvar = screen.getByRole("button", { name: "Salvando…" });
  expect(salvar).toBeDisabled();
  fireEvent.click(salvar);
  expect(enviar).not.toHaveBeenCalled();
});
it.each([null, { editing: false, formId: "form-teste" }, { editing: true }])("não oferece salvar sem cadastro editável: %j", (record) => {
  montar(record);
  expect(screen.queryByRole("button")).toBeNull();
});
