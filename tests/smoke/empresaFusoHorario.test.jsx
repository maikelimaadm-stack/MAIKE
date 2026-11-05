/**
 * D-PROD-124 (S1/H1) — fuso horário da fazenda no cadastro de Empresa.
 *
 * - Criação: o fuso escolhido vai no POST; edição: o PATCH NUNCA leva o campo
 *   (o servidor o recusa) — a troca é pela rota administrativa própria.
 * - Trocar um fuso já configurado exige motivo antes de chamar o servidor.
 * - A API usa PUT /empresas/:id/fuso-horario (online, sem fila offline).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

vi.mock("@/services/arquivoService", () => ({ enviarArquivo: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/maikeNotify", () => ({ notifyWarning: vi.fn() }));

const nativeRequest = vi.fn(async () => ({ id: "e1", fuso_horario: "America/Cuiaba" }));
vi.mock("@/apis/_core/nativeHttpClient.js", () => ({ nativeRequest: (...a) => nativeRequest(...a) }));

const abrirContato = () => fireEvent.click(screen.getByRole("tab", { name: /Contato e endereço/ }));
const escolherFuso = (rotulo) => {
  const campo = screen.getByRole("combobox", { name: /Fuso horário da fazenda/ });
  fireEvent.click(campo);
  const lista = /** @type {HTMLElement} */ (document.querySelector('[role="listbox"]'));
  fireEvent.click(within(lista).getByRole("option", { name: rotulo }));
};

describe("D-PROD-124 — fuso horário da Empresa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch { /* sem storage */ }
  });

  it("payload: fuso só na criação; o PATCH nunca leva fuso_horario", async () => {
    const { projetarPayloadEmpresa } = await import("@/services/empresaWritePayload");
    const base = { apelido: "A", nome: "B", tipo_pessoa: "Jurídica", fuso_horario: "America/Cuiaba" };
    expect(projetarPayloadEmpresa(base, { criacao: true }).fuso_horario).toBe("America/Cuiaba");
    expect("fuso_horario" in projetarPayloadEmpresa(base)).toBe(false);
    expect("fuso_horario" in projetarPayloadEmpresa({ ...base, fuso_horario: "" }, { criacao: true })).toBe(false);
  });

  it("nova empresa: o fuso escolhido vai no envio do formulário", async () => {
    const { default: FormularioEmpresa } = await import("@/components/empresa/FormularioEmpresa");
    const onSubmit = vi.fn();
    render(<FormularioEmpresa initialData={{ tipo_pessoa: "Jurídica" }} readOnly={false} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("FAZENDA PALMITAL"), { target: { value: "faz" } });
    fireEvent.change(screen.getByPlaceholderText("NOME COMPLETO"), { target: { value: "fazenda" } });
    abrirContato();
    escolherFuso("UTC−4 · Cuiabá (MT)");
    fireEvent.submit(screen.getByTestId("b1-form-empresa"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].fuso_horario).toBe("America/Cuiaba");
    expect(screen.queryByText("Salvar fuso")).toBeNull();
  });

  it("empresa existente sem fuso: 'Salvar fuso' envia só o fuso (sem motivo) e o submit geral não o leva", async () => {
    const { default: FormularioEmpresa } = await import("@/components/empresa/FormularioEmpresa");
    const onSubmit = vi.fn();
    const onSalvarFuso = vi.fn(async () => {});
    render(<FormularioEmpresa initialData={{ id: "e1", numero_empresa: 1, apelido: "A", nome: "B", tipo_pessoa: "Jurídica", fuso_horario: null }} readOnly={false} toolbarActions onSubmit={onSubmit} onSalvarFuso={onSalvarFuso} />);
    abrirContato();
    expect(screen.getByRole("button", { name: "Salvar fuso" })).toBeDisabled();
    escolherFuso("UTC−5 · Rio Branco (AC)");
    fireEvent.click(screen.getByRole("button", { name: "Salvar fuso" }));
    await waitFor(() => expect(onSalvarFuso).toHaveBeenCalledWith({ fuso_horario: "America/Rio_Branco" }));
    fireEvent.submit(screen.getByTestId("b1-form-empresa"));
    expect("fuso_horario" in onSubmit.mock.calls[0][0]).toBe(false);
  });

  it("troca de fuso já configurado exige motivo antes de chamar o servidor", async () => {
    const { notifyWarning } = await import("@/lib/maikeNotify");
    const { default: FormularioEmpresa } = await import("@/components/empresa/FormularioEmpresa");
    const onSalvarFuso = vi.fn(async () => {});
    render(<FormularioEmpresa initialData={{ id: "e1", numero_empresa: 1, apelido: "A", nome: "B", tipo_pessoa: "Jurídica", fuso_horario: "America/Sao_Paulo" }} readOnly={false} toolbarActions onSubmit={vi.fn()} onSalvarFuso={onSalvarFuso} />);
    abrirContato();
    escolherFuso("UTC−4 · Cuiabá (MT)");
    fireEvent.click(screen.getByRole("button", { name: "Salvar fuso" }));
    expect(onSalvarFuso).not.toHaveBeenCalled();
    expect(notifyWarning).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo da troca do fuso"), { target: { value: "fazenda fica em MT" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar fuso" }));
    await waitFor(() => expect(onSalvarFuso).toHaveBeenCalledWith({ fuso_horario: "America/Cuiaba", motivo: "fazenda fica em MT" }));
  });

  it("somente leitura: sem ação de salvar fuso", async () => {
    const { default: FormularioEmpresa } = await import("@/components/empresa/FormularioEmpresa");
    render(<FormularioEmpresa initialData={{ id: "e1", numero_empresa: 1, apelido: "A", nome: "B", tipo_pessoa: "Jurídica", fuso_horario: "America/Sao_Paulo" }} readOnly toolbarActions onSubmit={vi.fn()} onSalvarFuso={vi.fn()} />);
    abrirContato();
    expect(screen.queryByRole("button", { name: "Salvar fuso" })).toBeNull();
  });

  it("API: PUT /empresas/:id/fuso-horario com fuso e motivo (sem fila offline)", async () => {
    const { configurarFusoHorarioEmpresa } = await import("@/apis/empresa");
    await configurarFusoHorarioEmpresa("e 1", { fuso_horario: " America/Cuiaba ", motivo: " troca " });
    const chamada = nativeRequest.mock.calls.find((c) => String(c[0]).includes("fuso-horario"));
    expect(chamada[0]).toBe("/empresas/e%201/fuso-horario");
    expect(chamada[1]).toMatchObject({ method: "PUT", body: { fuso_horario: "America/Cuiaba", motivo: "troca" }, autenticado: true });
  });
});
