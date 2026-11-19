/**
 * D-PROD-195 — a Categoria de Manejo tem Curva de Ganho OBRIGATÓRIA e da MESMA
 * fazenda (CADCATEGORIA.curva_ganho_id → CADCURVAGANHO).
 *
 * No front este arquivo prova:
 *  (a) o 6º campo "Curva de ganho": obrigatório, select com pesquisa, opções =
 *      curvas ATIVAS da fazenda + a gravada (mesmo inativa, com "(INATIVA)");
 *      somente leitura mostra o nome; dica quando a fazenda não tem curva;
 *  (b) porta, API e service: rota própria de opções
 *      (`/categorias-manejo-opcoes/curvas-ganho?empresa_id=`) e `curva_ganho_id`
 *      sempre no POST e no PATCH;
 *  (c) o hook de opções usa a fazenda REAL e não consulta sem ela;
 *  (d) a grade tem a coluna "Curva de ganho" (padrão visível, CSV) e a chave de
 *      preferências mudou para `_v2`: a preferência salva antes (formato real,
 *      `{version:1, columns:{visible:[...]}}`) não esconde a coluna nova;
 *  (e) o cadastro rápido do lote lista as curvas só com a folha aberta e envia
 *      a curva escolhida.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, fireEvent, cleanup, waitFor, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({
  ...(await importOriginal()),
  notifyWarning: (...a) => notify.notifyWarning(...a),
  notifyError: (...a) => notify.notifyError(...a),
  notifySuccess: (...a) => notify.notifySuccess(...a),
}));

const nativeRequest = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/apis/_core/nativeHttpClient.js", () => ({ nativeRequest: (...a) => nativeRequest(...a) }));

const sessao = vi.hoisted(() => ({ empresaReal: /** @type {string|null} */ ("emp-1") }));
vi.mock("@/hooks/useGestaoSessao", () => ({ useEmpresaRealSelecionadaId: () => sessao.empresaReal }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));

const CURVAS = Object.freeze([
  { id: "cg-2", nome: "SECA PROTEINADO", ativo: true },
  { id: "cg-1", nome: "CURVA PADRÃO", ativo: true },
  { id: "cg-9", nome: "ANTIGA", ativo: false },
  { id: "cg-8", nome: "BACKUP", ativo: false },
]);

const wrap = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

/** O campo está marcado como inválido (borda + "Obrigatório")? */
const invalido = (rotulo) => screen.getByLabelText(rotulo).closest(".mg-field").classList.contains("is-invalid");

/** Abre o select e devolve os rótulos das opções do painel. */
const opcoesDoSelect = async (rotulo) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(rotulo));
  });
  const opcoes = await screen.findAllByRole("option");
  return opcoes.map((o) => o.textContent.trim());
};

/** Escolhe `nome` no select `rotulo` (reabre se o painel anterior ainda estiver fechando). */
const escolher = async (rotulo, nome) => {
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    if (!screen.queryByRole("option", { name: nome })) {
      await act(async () => {
        fireEvent.click(screen.getByLabelText(rotulo));
      });
    }
    const opcao = await screen.findByRole("option", { name: nome }, { timeout: 400 }).catch(() => null);
    if (opcao) {
      await act(async () => {
        fireEvent.click(opcao);
      });
      return;
    }
  }
  throw new Error(`opção ${nome} não apareceu em ${rotulo}`);
};

/** Registro completo (faixa da lista) com a curva gravada `curva`. */
const registro = (curva, extra = {}) => ({
  id: "cm1",
  nome: "BOI",
  sexo: "Macho",
  idade_minima_meses: 25,
  idade_maxima_meses: 36,
  curva_ganho_id: curva.id,
  curva_ganho_nome: curva.nome,
  ...extra,
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  nativeRequest.mockImplementation(async () => []);
  sessao.empresaReal = "emp-1";
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("(a) campo Curva de ganho no formulário", () => {
  it("CMC-1 — opções: só as curvas ATIVAS, em ordem de nome, com pesquisa; inativa não gravada fica fora", async () => {
    const { default: Form, opcoesCurvaGanho } = await import("@/components/categorias-manejo/FormularioCategoriaManejo");
    expect(opcoesCurvaGanho(CURVAS, null).map((o) => o.label)).toEqual(["CURVA PADRÃO", "SECA PROTEINADO"]);
    wrap(<Form onSubmit={vi.fn()} onCancel={() => {}} curvasGanho={CURVAS} />);
    expect(await opcoesDoSelect(/^Curva de ganho/)).toEqual(["CURVA PADRÃO", "SECA PROTEINADO"]);
    // `pesquisa="sempre"`: há pesquisa mesmo com duas opções — desde o PR #339 ela fica
    // dentro do próprio campo aberto (não mais numa caixa "Pesquisar…" no painel).
    expect(screen.getByRole("textbox", { name: /^Pesquisar Curva de ganho/ })).toBeTruthy();
  });

  it("CMC-2 — a curva gravada que foi inativada continua escolhível, com \"(INATIVA)\"; salvar sem trocar a mantém", async () => {
    const { default: Form, buildFormInitialFromRecord, opcoesCurvaGanho } = await import(
      "@/components/categorias-manejo/FormularioCategoriaManejo"
    );
    const { normalizarCategoriaManejo } = await import("@/services/categoriaManejoService");
    expect(opcoesCurvaGanho(CURVAS, { id: "cg-9", nome: "ANTIGA" }).map((o) => o.label)).toEqual([
      "ANTIGA (INATIVA)",
      "CURVA PADRÃO",
      "SECA PROTEINADO",
    ]);
    // Lista ainda não carregou (ou falhou): a gravada aparece pelo nome do registro.
    expect(opcoesCurvaGanho([], { id: "cg-9", nome: "ANTIGA" })).toEqual([{ value: "cg-9", label: "ANTIGA" }]);
    // Gravada ativa não duplica.
    expect(opcoesCurvaGanho(CURVAS, { id: "cg-1", nome: "CURVA PADRÃO" })).toHaveLength(2);

    const onSubmit = vi.fn();
    wrap(
      <Form
        initialData={buildFormInitialFromRecord(registro({ id: "cg-9", nome: "ANTIGA" }))}
        isEditing
        onSubmit={onSubmit}
        onCancel={() => {}}
        curvasGanho={CURVAS}
      />,
    );
    expect(screen.getByLabelText(/^Curva de ganho/).textContent).toBe("ANTIGA (INATIVA)");
    expect(await opcoesDoSelect(/^Curva de ganho/)).toEqual(["ANTIGA (INATIVA)", "CURVA PADRÃO", "SECA PROTEINADO"]);
    expect(screen.queryByRole("option", { name: "BACKUP (INATIVA)" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/^Curva de ganho/));
    });
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(normalizarCategoriaManejo(onSubmit.mock.calls[0][0], { empresaId: "emp-1", edicao: true })).toMatchObject({
      curva_ganho_id: "cg-9",
    });

    // Trocar envia a nova.
    await escolher(/^Curva de ganho/, "SECA PROTEINADO");
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(normalizarCategoriaManejo(onSubmit.mock.calls[1][0], { empresaId: "emp-1", edicao: true })).toMatchObject({
      curva_ganho_id: "cg-2",
    });
  });

  it("CMC-3 — obrigatória: sem curva não envia e o campo fica inválido; escolhendo, envia `curva_ganho_id`", async () => {
    const { default: Form } = await import("@/components/categorias-manejo/FormularioCategoriaManejo");
    const onSubmit = vi.fn();
    wrap(
      <Form
        initialData={{ ...registro({ id: "", nome: "" }), id: undefined, curva_ganho_id: "", faixa_idade_alterada: true }}
        onSubmit={onSubmit}
        onCancel={() => {}}
        curvasGanho={CURVAS}
      />,
    );
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", "Preencha os campos obrigatórios.");
    expect(invalido(/^Curva de ganho/)).toBe(true);
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    await escolher(/^Curva de ganho/, "CURVA PADRÃO");
    expect(invalido(/^Curva de ganho/)).toBe(false);
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ curva_ganho_id: "cg-1" });
  });

  it("CMC-4 — somente leitura mostra o nome da curva (`curva_ganho_nome`), sem dica", async () => {
    const { default: Form, buildFormInitialFromRecord, DICA_SEM_CURVA } = await import(
      "@/components/categorias-manejo/FormularioCategoriaManejo"
    );
    wrap(
      <Form
        initialData={buildFormInitialFromRecord(registro({ id: "cg-7", nome: "RECRIA ÁGUAS" }))}
        readOnly
        onSubmit={vi.fn()}
        onCancel={() => {}}
        curvasGanho={[]}
      />,
    );
    expect(screen.getByLabelText(/^Curva de ganho/).value).toBe("RECRIA ÁGUAS");
    expect(screen.queryByText(DICA_SEM_CURVA)).toBeNull();
  });

  it("CMC-5 — dicas: fazenda sem curva ativa → \"Cadastre uma curva em Manejo → Curvas de Ganho\"; sem fazenda; carregando; erro", async () => {
    const { default: Form, DICA_SEM_CURVA, DICA_SEM_FAZENDA } = await import(
      "@/components/categorias-manejo/FormularioCategoriaManejo"
    );
    expect(DICA_SEM_CURVA).toBe("Cadastre uma curva em Manejo → Curvas de Ganho");
    const props = { onSubmit: vi.fn(), onCancel: () => {} };
    const { rerender } = wrap(<Form {...props} curvasGanho={[]} />);
    expect(screen.getByText(DICA_SEM_CURVA)).toBeTruthy();
    const qc = new QueryClient();
    const com = (extra) => (
      <QueryClientProvider client={qc}>
        <Form {...props} {...extra} />
      </QueryClientProvider>
    );
    rerender(com({ curvasGanho: [{ id: "x", nome: "INATIVA", ativo: false }] }));
    expect(screen.getByText(DICA_SEM_CURVA)).toBeTruthy();
    rerender(com({ curvasGanho: [], semFazenda: true }));
    expect(screen.getByText(DICA_SEM_FAZENDA)).toBeTruthy();
    expect(screen.queryByText(DICA_SEM_CURVA)).toBeNull();
    rerender(com({ curvasGanho: [], carregandoCurvas: true }));
    expect(screen.getByText("Carregando curvas de ganho…")).toBeTruthy();
    rerender(com({ curvasGanho: [], erroCurvas: true }));
    expect(screen.getByText("Não foi possível carregar as curvas de ganho.")).toBeTruthy();
    rerender(com({ curvasGanho: CURVAS }));
    expect(screen.queryByText(DICA_SEM_CURVA)).toBeNull();
  });
});

describe("(b) porta, API e service", () => {
  it("CMC-6 — opções vêm de `/categorias-manejo-opcoes/curvas-ganho?empresa_id=` (online, autenticado); sem fazenda não chama", async () => {
    const { listOpcoesCurvasGanhoCategoriaManejo } = await import("@/apis/categorias-manejo");
    nativeRequest.mockResolvedValueOnce(CURVAS);
    expect(await listOpcoesCurvasGanhoCategoriaManejo("emp 1")).toEqual(CURVAS);
    const [url, opcoes] = nativeRequest.mock.calls[0];
    expect(url).toBe("/categorias-manejo-opcoes/curvas-ganho?empresa_id=emp+1");
    expect(opcoes).toMatchObject({ autenticado: true });
    expect(opcoes.method).toBeUndefined();
    // Resposta que não é lista vira [].
    nativeRequest.mockResolvedValueOnce({ items: [] });
    expect(await listOpcoesCurvasGanhoCategoriaManejo("emp-1")).toEqual([]);
    nativeRequest.mockClear();
    await expect(listOpcoesCurvasGanhoCategoriaManejo("")).rejects.toMatchObject({ code: "API_INVALID_ARGUMENT" });
    expect(nativeRequest).not.toHaveBeenCalled();
  });

  it("CMC-7 — criar e atualizar levam `curva_ganho_id` no corpo (PATCH sem mexer na faixa também); o nome não vai", async () => {
    const { criarCategoriaManejo, atualizarCategoriaManejo } = await import("@/services/categoriaManejoService");
    const form = { ...registro({ id: "cg-1", nome: "CURVA PADRÃO" }), id: undefined, especie: "Bovinos", sigla: "" };
    await criarCategoriaManejo(form, { empresaId: "emp-1" });
    await atualizarCategoriaManejo("cm1", { ...form, faixa_idade_alterada: false }, { empresaId: "emp-1" });
    const [post, patch] = nativeRequest.mock.calls.map((c) => c[1]);
    expect(post).toMatchObject({ method: "POST", body: { curva_ganho_id: "cg-1", idade_minima_meses: 25 } });
    expect(patch).toMatchObject({ method: "PATCH", body: { curva_ganho_id: "cg-1" } });
    expect(patch.body).not.toHaveProperty("idade_minima_meses");
    for (const corpo of [post.body, patch.body]) expect(corpo).not.toHaveProperty("curva_ganho_nome");
  });
});

describe("(c) hook de opções com a fazenda REAL", () => {
  const comQuery = ({ children }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it("CMC-8 — com fazenda lista as curvas dela; sem fazenda (fallback do tenant) não consulta", async () => {
    const { useOpcoesCurvaGanhoCategoria } = await import("@/hooks/useOpcoesCurvaGanhoCategoria");
    nativeRequest.mockResolvedValue(CURVAS);
    const { result } = renderHook(() => useOpcoesCurvaGanhoCategoria(), { wrapper: comQuery });
    await waitFor(() => expect(result.current.curvas).toEqual(CURVAS));
    expect(result.current).toMatchObject({ empresaId: "emp-1", carregando: false, erro: false });
    expect(nativeRequest.mock.calls[0][0]).toBe("/categorias-manejo-opcoes/curvas-ganho?empresa_id=emp-1");

    nativeRequest.mockClear();
    sessao.empresaReal = null;
    const sem = renderHook(() => useOpcoesCurvaGanhoCategoria(), { wrapper: comQuery });
    expect(sem.result.current).toMatchObject({ empresaId: null, curvas: [], carregando: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(nativeRequest).not.toHaveBeenCalled();
  });
});

describe("(d) grade: coluna Curva de ganho e chave _v2", () => {
  it("CMC-9 — coluna visível por padrão com o nome da curva (grade e CSV); chave das preferências é `_v2`", async () => {
    const { CATEGORIAS_MANEJO_COLUNAS, CATEGORIAS_MANEJO_STORAGE_KEY, getCategoriaManejoFieldValue } = await import(
      "@/components/categorias-manejo/TabelaCategoriasManejo"
    );
    expect(CATEGORIAS_MANEJO_STORAGE_KEY).toBe("colunas_largura_categorias_manejo_v3");
    const coluna = CATEGORIAS_MANEJO_COLUNAS.find((c) => c.id === "curva_ganho");
    expect(coluna).toMatchObject({ label: "Curva de ganho", default: true });
    expect(getCategoriaManejoFieldValue({ curva_ganho_nome: "CURVA PADRÃO" }, "curva_ganho")).toBe("CURVA PADRÃO");
    expect(getCategoriaManejoFieldValue({ curva_ganho_id: "cg-1" }, "curva_ganho")).toBe("");
  });

  it("CMC-10 — a página usa a chave `_v2`: preferência salva antes (só Nome/Sigla/Sexo/Faixa) não esconde a coluna nova", async () => {
    // Formato real gravado pela grade (persistCadastroBase1ColumnPrefs) na tela anterior.
    localStorage.setItem(
      "colunas_largura_categorias_manejo_prefs",
      JSON.stringify({
        version: 1,
        columns: {
          widths: { nome: 180, sigla: 100, sexo: 100, idade: 140 },
          order: ["nome", "sigla", "sexo", "idade", "especie"],
          visible: ["nome", "sigla", "sexo", "idade"],
          frozen: 0,
          autoFit: [],
        },
      }),
    );
    nativeRequest.mockImplementation(async (url) =>
      String(url).startsWith("/categorias-manejo-opcoes")
        ? CURVAS
        : [{ id: "cm1", empresa_id: "emp-1", ...registro({ id: "cg-1", nome: "CURVA PADRÃO" }), nome: "BOI MAGRO" }],
    );
    const { default: CategoriasManejo } = await import("@/pages/CategoriasManejo");
    wrap(<CategoriasManejo />);
    await waitFor(() => expect(screen.getByText("BOI MAGRO")).toBeTruthy());
    expect(screen.getAllByText("Curva de ganho").length).toBeGreaterThan(0);
    expect(screen.getByText("CURVA PADRÃO")).toBeTruthy();

    // Novo: o formulário traz o campo com as curvas ativas da fazenda.
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    const form = await screen.findByTestId("b1-form-categoria-manejo");
    expect(within(form).getByLabelText(/^Curva de ganho/)).toBeTruthy();
    await waitFor(() =>
      expect(nativeRequest.mock.calls.some(([url]) => url === "/categorias-manejo-opcoes/curvas-ganho?empresa_id=emp-1")).toBe(true),
    );
    expect(await opcoesDoSelect(/^Curva de ganho/)).toEqual(["CURVA PADRÃO", "SECA PROTEINADO"]);
  });
});

describe("(e) cadastro rápido do lote", () => {
  it("CMC-11 — fechado não lê curvas; aberto lista as da fazenda e cria com a curva escolhida", async () => {
    const { default: CadastroRapido } = await import("@/components/categorias-manejo/CadastroRapidoCategoriaManejo");
    nativeRequest.mockImplementation(async (url, opts) => {
      if (String(url).startsWith("/categorias-manejo-opcoes")) return CURVAS;
      if (opts?.method === "POST") return { id: "cm-novo", ...opts.body };
      return [];
    });
    const onCreated = vi.fn();
    const props = { onClose: vi.fn(), empresaId: "emp-1", nomeInicial: "garrote", onCreated };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <CadastroRapido open={false} {...props} />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(nativeRequest).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={qc}>
        <CadastroRapido open {...props} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(nativeRequest).toHaveBeenCalledWith(
      "/categorias-manejo-opcoes/curvas-ganho?empresa_id=emp-1",
      expect.anything(),
      expect.anything(),
    ));
    await escolher(/^Sexo/, "Macho");
    await escolher(/^Faixa de idade/, "13 a 24 meses");
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    // Sem curva: não cria.
    expect(nativeRequest.mock.calls.some(([, o]) => o?.method === "POST")).toBe(false);
    expect(invalido(/^Curva de ganho/)).toBe(true);

    await escolher(/^Curva de ganho/, "SECA PROTEINADO");
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const post = nativeRequest.mock.calls.find(([, o]) => o?.method === "POST");
    expect(post[0]).toBe("/categorias-manejo");
    expect(post[1].body).toMatchObject({ empresa_id: "emp-1", nome: "GARROTE", curva_ganho_id: "cg-2" });
  });
});
