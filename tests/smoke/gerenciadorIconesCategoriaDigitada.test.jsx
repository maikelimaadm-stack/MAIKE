/**
 * D-PROD-192 — a categoria digitada no cadastro de ícone não é apagada.
 *
 * No diálogo "Cadastrar Novo Ícone" (Configurações), a categoria tem um Select (Radix) com
 * as sugestões do tipo e, logo abaixo, o campo "OU DIGITE UMA NOVA CATEGORIA", os dois
 * ligados ao mesmo `formData.categoria`. O Select do Radix 2.x guarda um `<select>` nativo
 * oculto (`SelectBubbleInput`): quando o valor controlado muda, ele grava esse valor no
 * `<select>` e dispara `change`. Texto que não é uma das opções ("MEU PONTO", ou "COCHO" em
 * vez de "Cocho") não existe no `<select>`, que então responde "" — e o `onValueChange` do
 * Select gravava `categoria: ""`, apagando o que acabou de ser digitado.
 *
 * A digitação é simulada tecla a tecla (o projeto não tem `user-event`), como o usuário faz:
 * cada tecla é uma mudança de estado e um novo `change` do `<select>` oculto.
 * Só os services são substituídos.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const icones = {
  listar: vi.fn(),
  criar: vi.fn(),
  atualizar: vi.fn(),
  desativar: vi.fn(),
};

vi.mock("@/services/configuracaoIconeService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarIconesAtivos: (...a) => icones.listar(...a),
  criarIcone: (...a) => icones.criar(...a),
  atualizarIcone: (...a) => icones.atualizar(...a),
  desativarIcone: (...a) => icones.desativar(...a),
}));
vi.mock("@/services/arquivoService", () => ({ enviarArquivo: vi.fn(async () => "https://arquivos.exemplo/icone.png") }));

const CAMPO_TEXTO = "OU DIGITE UMA NOVA CATEGORIA";
const PLACEHOLDER_SELECT = "Selecione a categoria";
/** Ícone já salvo com categoria própria (fora das sugestões). */
const MEU_PONTO = { id: "i-meu-ponto", tipo_entidade: "Ponto", categoria: "MEU PONTO", cor_padrao: "#10b981", ativo: true };

/** @type {QueryClient} */
let qc;
const montar = async (lista) => {
  icones.listar.mockResolvedValue(lista);
  const { default: GerenciadorIcones } = await import("@/components/configuracoes/GerenciadorIcones");
  const { ICONES_QUERY_KEY } = await import("@/services/configuracaoIconeService");
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <GerenciadorIcones />
    </QueryClientProvider>,
  );
  // A lista do servidor chegou (initialData é [] até lá).
  await waitFor(() => expect(qc.getQueryData(ICONES_QUERY_KEY)).toHaveLength(lista.length));
};

/** Abre o Select (Radix) e escolhe a opção pelo texto. */
const escolher = async (trigger, opcao) => {
  await act(async () => {
    fireEvent.click(trigger);
  });
  const lista = /** @type {HTMLElement} */ (document.querySelector('[role="listbox"]'));
  await act(async () => {
    fireEvent.click(within(lista).getByRole("option", { name: opcao }));
  });
};

/** Abre "Novo Ícone", escolhe o tipo e devolve o diálogo, o Select e o campo de texto da categoria. */
const novoIconeDoTipo = async (tipo) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Novo Ícone/ }));
  });
  const dialogo = within(screen.getByRole("dialog"));
  await escolher(dialogo.getByRole("combobox"), tipo);
  const [, seletorCategoria] = dialogo.getAllByRole("combobox");
  return { dialogo, seletorCategoria, campo: /** @type {HTMLInputElement} */ (dialogo.getByPlaceholderText(CAMPO_TEXTO)) };
};

/** Digita tecla a tecla, a partir do que já está no campo, e confere que nada se perde no caminho. */
const digitar = async (campo, texto) => {
  const inicio = campo.value;
  for (let i = 1; i <= texto.length; i += 1) {
    const esperado = inicio + texto.slice(0, i);
    await act(async () => {
      fireEvent.change(campo, { target: { value: esperado } });
    });
    expect(campo.value, `depois de digitar "${esperado}"`).toBe(esperado);
  }
};

const salvar = async (dialogo) => {
  await act(async () => {
    fireEvent.click(dialogo.getByRole("button", { name: "Salvar" }));
  });
};

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  cleanup();
  Object.values(icones).forEach((f) => f.mockReset());
  icones.criar.mockResolvedValue({ id: "novo" });
  icones.atualizar.mockResolvedValue({ id: MEU_PONTO.id });
});
afterEach(() => cleanup());

describe("D-PROD-192 — categoria digitada no cadastro de ícone", () => {
  it("Urgente permite escolher e salvar o novo modelo SVG sem trocar o subícone", async () => {
    await montar([]);
    const { dialogo, seletorCategoria } = await novoIconeDoTipo("Prioridade de Tarefa");
    await escolher(seletorCategoria, "Urgente");
    const botoes = dialogo.getAllByRole("button", { name: "Usar modelo de tarefa SVG" });
    expect(botoes).toHaveLength(1);
    fireEvent.click(botoes[0]);
    await waitFor(() => expect(dialogo.getByAltText("Preview")).toHaveAttribute("src", "https://arquivos.exemplo/icone.png"));
    await salvar(dialogo);
    await waitFor(() => expect(icones.criar).toHaveBeenCalledTimes(1));
    expect(icones.criar.mock.calls[0][0]).toMatchObject({ tipo_entidade: "Prioridade Tarefa", categoria: "URGENTE", icone_url: "https://arquivos.exemplo/icone.png", sub_icone_url: "" });
  });

  it("CAT-01 digitar 'MEU PONTO': o valor fica no campo e é salvo em maiúsculas", async () => {
    await montar([]);
    const { dialogo, seletorCategoria, campo } = await novoIconeDoTipo("Ponto de Referência");

    await digitar(campo, "MEU PONTO");
    expect(campo).toHaveValue("MEU PONTO");
    // Nenhuma sugestão bate: o Select fica sem escolha, com o texto dele de sempre.
    expect(seletorCategoria).toHaveAttribute("data-placeholder");
    expect(seletorCategoria).toHaveTextContent(PLACEHOLDER_SELECT);

    await salvar(dialogo);
    await waitFor(() => expect(icones.criar).toHaveBeenCalledTimes(1));
    expect(icones.criar.mock.calls[0][0]).toMatchObject({ tipo_entidade: "Ponto", categoria: "MEU PONTO" });
  });

  it("CAT-02 texto em minúsculas fica como foi digitado e é salvo em maiúsculas", async () => {
    await montar([]);
    const { dialogo, campo } = await novoIconeDoTipo("Linha/Estrada");

    await digitar(campo, "meu ponto");
    expect(campo).toHaveValue("meu ponto");

    await salvar(dialogo);
    await waitFor(() => expect(icones.criar).toHaveBeenCalledTimes(1));
    expect(icones.criar.mock.calls[0][0]).toMatchObject({ tipo_entidade: "Linha", categoria: "MEU PONTO" });
  });

  it("CAT-03 'COCHO' (a sugestão 'Cocho' em outra grafia) fica, mostra a sugestão no Select e o modelo de cocho", async () => {
    await montar([]);
    const { dialogo, seletorCategoria, campo } = await novoIconeDoTipo("Ponto de Referência");

    await digitar(campo, "COCHO");
    expect(campo).toHaveValue("COCHO");
    // O Select acompanha a sugestão equivalente; o campo guarda a grafia digitada.
    expect(seletorCategoria).not.toHaveAttribute("data-placeholder");
    expect(seletorCategoria).toHaveTextContent("Cocho");
    // O botão do modelo de cocho continua aparecendo (principal e sub ícone).
    expect(dialogo.getAllByRole("button", { name: "Usar modelo de cocho SVG" })).toHaveLength(2);
    expect(document.querySelectorAll('[role="dialog"] input[type="file"]')).toHaveLength(2);

    await salvar(dialogo);
    await waitFor(() => expect(icones.criar).toHaveBeenCalledTimes(1));
    expect(icones.criar.mock.calls[0][0]).toMatchObject({ tipo_entidade: "Ponto", categoria: "COCHO" });
  });

  it("CAT-04 o Select continua escolhendo a sugestão por cima do texto digitado, e o texto volta a ser editável", async () => {
    await montar([]);
    const { dialogo, seletorCategoria, campo } = await novoIconeDoTipo("Ponto de Referência");

    await digitar(campo, "MEU PONTO");
    await escolher(seletorCategoria, "Bebedouro");
    expect(campo).toHaveValue("Bebedouro");
    expect(seletorCategoria).toHaveTextContent("Bebedouro");

    // Sair da sugestão digitando: o texto fica e o Select volta a ficar sem escolha.
    await digitar(campo, " NOVO");
    expect(campo).toHaveValue("Bebedouro NOVO");
    expect(seletorCategoria).toHaveTextContent(PLACEHOLDER_SELECT);

    await salvar(dialogo);
    await waitFor(() => expect(icones.criar).toHaveBeenCalledTimes(1));
    expect(icones.criar.mock.calls[0][0]).toMatchObject({ tipo_entidade: "Ponto", categoria: "BEBEDOURO NOVO" });
  });

  it("CAT-05 editar um ícone com categoria própria: o texto alterado fica e é salvo", async () => {
    await montar([MEU_PONTO]);
    const cartao = /** @type {HTMLElement} */ (screen.getByText("MEU PONTO").closest("div.border"));
    const [editar] = within(cartao).getAllByRole("button");
    await act(async () => {
      fireEvent.click(editar);
    });
    const dialogo = within(screen.getByRole("dialog"));
    expect(dialogo.getByText("Editar Ícone")).toBeInTheDocument();
    const campo = /** @type {HTMLInputElement} */ (dialogo.getByPlaceholderText(CAMPO_TEXTO));
    expect(campo).toHaveValue("MEU PONTO");

    await digitar(campo, " 2");
    expect(campo).toHaveValue("MEU PONTO 2");

    await salvar(dialogo);
    await waitFor(() => expect(icones.atualizar).toHaveBeenCalledTimes(1));
    const [id, dados] = icones.atualizar.mock.calls[0];
    expect(id).toBe(MEU_PONTO.id);
    expect(dados).toMatchObject({ tipo_entidade: "Ponto", categoria: "MEU PONTO 2" });
    expect(icones.criar).not.toHaveBeenCalled();
  });
});
