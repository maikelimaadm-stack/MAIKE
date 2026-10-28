import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/services/arquivoService", () => ({
  enviarArquivo: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/maikeNotify", () => ({
  notifyWarning: vi.fn(),
}));

describe("FormularioEmpresa Base1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("alterna campos Física/Jurídica e bloqueia edição em readOnly", async () => {
    const { default: FormularioEmpresa } = await import("@/components/empresa/FormularioEmpresa");
    const onSubmit = vi.fn();
    render(
      <FormularioEmpresa
        initialData={{ id: "1", tipo_pessoa: "Jurídica", apelido: "A", nome: "B", numero_empresa: 1 }}
        readOnly
        toolbarActions
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
    expect(screen.queryByText(/enviar/i)).toBeNull();

    render(
      <FormularioEmpresa
        key="fisica"
        initialData={{ tipo_pessoa: "Física", apelido: "", nome: "" }}
        readOnly={false}
        toolbarActions
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByPlaceholderText("000.000.000-00")).toBeInTheDocument();
  });

  it("projeta payload ao salvar", async () => {
    const { default: FormularioEmpresa } = await import("@/components/empresa/FormularioEmpresa");
    const onSubmit = vi.fn();
    render(
      <FormularioEmpresa
        initialData={{ tipo_pessoa: "Jurídica" }}
        readOnly={false}
        toolbarActions={false}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("FAZENDA PALMITAL"), {
      target: { value: "fazenda x" },
    });
    fireEvent.change(screen.getByPlaceholderText("NOME COMPLETO"), {
      target: { value: "nome y" },
    });
    fireEvent.submit(screen.getByTestId("b1-form-empresa"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        apelido: "FAZENDA X",
        nome: "NOME Y",
        tipo_pessoa: "Jurídica",
      }),
    );
  });
});
