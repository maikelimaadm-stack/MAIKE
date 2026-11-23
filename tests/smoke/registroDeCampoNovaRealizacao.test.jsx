/**
 * D-PROD-265 — "Nova realização" (maquete "Nova realização de <Tipo>"): a janela abre nos CARTÕES dos 7 tipos fixos (ícone +
 * nome, botões); o cartão leva ao formulário "Nova realização de <Tipo>" com "Trocar tipo" ao lado do título (áreas,
 * datas e linhas ficam; só a operação sai); o corpo sem o select de Tipo, nas seções Área · Operação · Datas · Insumos ·
 * Máquinas · Equipe · Serviço de terceiro · Planejamento · Informações complementares; a Data de término é opcional, só
 * vai no corpo preenchida e é recusada no cliente antes do início; do mapa, a área vem presa; o botão da tela de
 * Atividades se chama "Nova realização".
 *
 * A janela montada de verdade (`JanelaRegistroDeCampo`, service, API, porta e `nativeHttpClient` reais); mocks só da borda:
 * `fetch` (um backend falso no formato do contrato), a sessão da tela, o aviso e a confirmação do envio pendente.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { API_FAKE, instalarBackendFake } from "./fixtures/gestaoBackendFake.js";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), ...notify }));
vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useAcoesTelaAtividades: () => ({ ver: true, lancarApontamento: true, carregando: false, login: "operador" }),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ fuso: "America/Cuiaba", fusoOk: true, semFuso: false, hoje: "2026-11-18" }),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "cli-1", user: { id: "u1" } }) }));
const confirmacao = vi.hoisted(() => ({ confirmar: vi.fn(async () => true) }));
vi.mock("@/lib/maikeConfirmar", () => confirmacao);

const { default: JanelaRegistroDeCampo } = await import("@/components/lancamento-atividades/RegistroDeCampo");
const regras = await import("@/lib/registroDeCampoRegras");
const { linhasDoRegistro } = await import("@/domain/mapa/registrosDaArea");

const OPERACOES = [
  { id: "t-cig", nome_tipo: "Combate à cigarrinha", categoria: "APLICACAO", ativo: true },
  { id: "t-herb", nome_tipo: "Herbicida", categoria: "APLICACAO", ativo: true },
  { id: "t-roc", nome_tipo: "Roçada", categoria: "PASTAGEM", ativo: true },
];
const AROEIRA = { id: "area-aroeira", nome: "PASTO DA AROEIRA", tamanho_hectares: 38, empresa_id: "emp-1", ativo: true };
const ACUDE = { id: "area-acude", nome: "PASTO DO AÇUDE", tamanho_hectares: 27.3, empresa_id: "emp-1", ativo: true };
const AREAS = [AROEIRA, ACUDE];
const PRODUTOS = [{ id: "p1", nome: "Tiametoxam", unidade: "L", unidade_principal_estoque: "L" }];
const LOCAIS = { p1: [{ local_estoque_id: "l1", local_nome: "Depósito", disponivel: "60.0000", unidade: "L" }] };
const TIPOS_NA_ORDEM = ["Preparo do solo", "Plantio de pastagem", "Fertilização", "Aplicação", "Roçada e tratos", "Manutenção", "Outros"];
// D-PROD-267: "Como fica depois de salvar?" fecha o formulário, logo antes do rodapé.
const SECOES_NA_ORDEM = ["Área", "Operação", "Datas", "Insumos", "Máquinas", "Equipe", "Serviço de terceiro (se houver)", "Planejamento", "Informações complementares", "Como fica depois de salvar?"];

/** @type {{ chamadas: Array<{ method: string, path: string, query: Record<string, string>, body: any }> }} */
let backend;

const rotear = async (/** @type {{ method: string, path: string, query: URLSearchParams, body: any }} */ { method, path, query, body }) => {
  const partes = path.split("/").filter(Boolean);
  if (path === "/areas-pastagem" && method === "GET") return { status: 200, body: AREAS };
  if (partes[0] === "atividades-opcoes" && method === "GET") {
    if (partes[1] === "locais") return { status: 200, body: { itens: LOCAIS[/** @type {"p1"} */ (String(query.get("produto_id")))] ?? [] } };
    return { status: 200, body: { itens: partes[1] === "produtos" ? PRODUTOS : [], has_more: false, next_cursor: null } };
  }
  if (partes[0] === "atividades-por-area" && method === "GET") return { status: 200, body: { area_id: partes[1], mes: "2026-11", atividades: [], custos: null } };
  if (path === "/atividades/registrar" && method === "POST") {
    const apontamentos = (body.areas ?? [{ area_id: body.area_id }]).map((/** @type {any} */ _a, /** @type {number} */ i) => ({ id: `ap-${i + 1}`, data_operacional: body.data_operacional, data_termino: body.data_termino ?? null }));
    return { status: 201, body: { apontamento: apontamentos[0], apontamentos, atividade: { id: "at-9" }, alertas: [], registro: { atividade_criada: true, atividade_id: "at-9" }, replay: false } };
  }
  return undefined;
};

beforeEach(async () => {
  vi.stubEnv("VITE_MAIKE_API_URL", API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem("empresa_selecionada_id", "emp-1");
  window.localStorage.setItem("empresa_selecionada_cliente_id", "cli-1");
  const { setNativeToken } = await import("@/lib/auth/nativeTokenStorage");
  setNativeToken("jwt.teste");
  confirmacao.confirmar.mockResolvedValue(true);
  backend = instalarBackendFake(rotear);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────
/** @param {Record<string, any>} [props] */
const montar = async (props = {}) => {
  const onFechar = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <JanelaRegistroDeCampo tipos={OPERACOES} areas={AREAS} onFechar={onFechar} {...props} />
    </QueryClientProvider>,
  );
  const janela = await screen.findByTestId("janela-registro-de-campo");
  return { janela, onFechar };
};
const registros = () => backend.chamadas.filter((c) => c.method === "POST" && c.path === "/atividades/registrar");
const titulo = (/** @type {HTMLElement} */ janela) => within(janela).getByTestId("registro-de-campo-titulo").textContent.replace(/\s+/g, " ").trim();
/** Clica no cartão do tipo e espera o formulário. */
const escolherTipo = async (/** @type {HTMLElement} */ janela, /** @type {string} */ nome) => {
  fireEvent.click(within(janela).getByRole("button", { name: nome }));
  await within(janela).findByTestId("registro-de-campo-form");
};
const escolherOperacao = async (/** @type {HTMLElement} */ janela, /** @type {string} */ nome) => {
  fireEvent.click(within(janela).getByRole("combobox", { name: /Operação/ }));
  fireEvent.click(await screen.findByRole("option", { name: nome }));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
};
const marcarAreas = async (/** @type {HTMLElement} */ janela, /** @type {string[]} */ ids) => {
  fireEvent.click(within(janela).getByTestId("registro-areas-campo"));
  for (const id of ids) fireEvent.click(await screen.findByTestId(`registro-areas-opcao-${id}`));
  fireEvent.click(within(janela).getByTestId("registro-areas-campo"));
  await waitFor(() => expect(screen.queryByTestId("registro-areas-lista")).toBeNull());
};
const incluirInsumo = async (/** @type {HTMLElement} */ janela, /** @type {string} */ quantidade) => {
  fireEvent.click(within(janela).getByTestId("registro-incluir-insumo"));
  const editor = within(janela).getByTestId("registro-insumo-editor");
  await waitFor(() => expect(within(editor).getByTestId("registro-produto-produto")).not.toBeDisabled());
  fireEvent.click(within(editor).getByTestId("registro-produto-produto"));
  fireEvent.click(await screen.findByRole("option", { name: /Tiametoxam/ }));
  await waitFor(() => expect(within(editor).getByRole("combobox", { name: /Local do estoque/ })).toHaveTextContent("Depósito"));
  fireEvent.change(within(editor).getByTestId("registro-produto-quantidade"), { target: { value: quantidade } });
  fireEvent.click(within(editor).getByTestId("registro-insumo-editor-incluir"));
  await waitFor(() => expect(within(janela).queryByTestId("registro-insumo-editor")).toBeNull());
};
/** Os títulos das seções do formulário, na ordem da tela. @param {HTMLElement} janela */
const secoes = (janela) => [...within(janela).getByTestId("registro-de-campo-form").querySelectorAll(".b1-grupo__titulo")].map((n) => n.textContent.trim());

describe("Nova realização — passo 1: os 7 tipos em cartões (D-PROD-265)", () => {
  it("abre em \"Nova realização\" com os 7 tipos fixos em cartões (botões com ícone e nome, na ordem), sem formulário e só Cancelar", async () => {
    const { janela, onFechar } = await montar();
    expect(titulo(janela)).toBe("Nova realização");
    const lista = within(janela).getByRole("list", { name: "Tipos de serviço" });
    const cartoes = within(lista).getAllByRole("button");
    expect(cartoes.map((b) => b.textContent.trim())).toEqual(TIPOS_NA_ORDEM);
    for (const c of cartoes) {
      expect(c.getAttribute("type")).toBe("button");
      expect(c.querySelector("svg")).toBeTruthy();
    }
    expect(within(janela).queryByTestId("registro-de-campo-form")).toBeNull();
    expect(within(janela).queryByRole("button", { name: "Salvar" })).toBeNull();
    expect(within(janela).queryByRole("button", { name: "Salvar e novo" })).toBeNull();
    fireEvent.click(within(janela).getByRole("button", { name: "Cancelar" }));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it("o cartão leva ao formulário \"Nova realização de <Tipo>\", sem o select de Tipo e com as seções na ordem da maquete", async () => {
    const { janela } = await montar();
    await escolherTipo(janela, "Aplicação");
    expect(titulo(janela)).toBe("Nova realização de Aplicação");
    expect(within(janela).queryByRole("combobox", { name: /^Tipo/ })).toBeNull();
    expect(within(janela).getByRole("button", { name: "Trocar tipo" })).toBeTruthy();
    expect(secoes(janela)).toEqual(SECOES_NA_ORDEM);
    // A operação: só as do tipo escolhido.
    fireEvent.click(within(janela).getByRole("combobox", { name: /Operação/ }));
    const nomes = (await screen.findAllByRole("option")).map((o) => o.textContent.trim());
    expect(nomes).toEqual(["Combate à cigarrinha", "Herbicida"]);
    fireEvent.click(within(janela).getByRole("combobox", { name: /Operação/ }));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    // Datas: Data de início (hoje na fazenda) e Data de término (vazia, opcional); o Operador e a Observação no fim.
    expect(within(janela).getByTestId("registro-de-campo-data").value).toBe("2026-11-18");
    expect(within(janela).getByTestId("registro-de-campo-data-termino").value).toBe("");
    const rotulos = [...janela.querySelectorAll(".mg-field__label")].map((el) => el.textContent.trim());
    expect(rotulos.some((r) => /^Data de início\s*\*$/.test(r))).toBe(true);
    expect(rotulos.some((r) => /^Data de término$/.test(r))).toBe(true);
    // Planejamento só leitura: sem botão "Escolher planejamento".
    expect(within(janela).queryByRole("button", { name: /planejamento/i })).toBeNull();
    expect(within(janela).getByTestId("registro-de-campo-destino-vazio")).toBeTruthy();
  });

  it("teclado: o cartão é um botão com foco e o Enter (clique do botão) escolhe o tipo", async () => {
    const { janela } = await montar();
    const cartao = within(janela).getByRole("button", { name: "Roçada e tratos" });
    cartao.focus();
    expect(document.activeElement).toBe(cartao);
    // Num <button>, o Enter do teclado vira o clique: o mesmo caminho.
    fireEvent.keyDown(cartao, { key: "Enter" });
    fireEvent.click(cartao);
    await within(janela).findByTestId("registro-de-campo-form");
    expect(titulo(janela)).toBe("Nova realização de Roçada e tratos");
  });
});

describe("Nova realização — Trocar tipo e envio (D-PROD-265)", () => {
  it("Trocar tipo volta aos cartões; o novo tipo guarda áreas, datas e linhas e limpa só a operação", async () => {
    const { janela } = await montar();
    await escolherTipo(janela, "Aplicação");
    await marcarAreas(janela, ["area-aroeira", "area-acude"]);
    await escolherOperacao(janela, "Combate à cigarrinha");
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data"), { target: { value: "2026-11-10" } });
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data-termino"), { target: { value: "2026-11-12" } });
    await incluirInsumo(janela, "10");
    expect(within(janela).getAllByTestId(/^registro-insumo-linha-\d+$/).length).toBe(1);

    fireEvent.click(within(janela).getByRole("button", { name: "Trocar tipo" }));
    expect(titulo(janela)).toBe("Nova realização");
    expect(within(janela).queryByTestId("registro-de-campo-form")).toBeNull();
    // O tipo atual aparece marcado nos cartões.
    expect(within(janela).getByRole("button", { name: "Aplicação" }).getAttribute("aria-pressed")).toBe("true");
    await escolherTipo(janela, "Roçada e tratos");
    expect(titulo(janela)).toBe("Nova realização de Roçada e tratos");
    // Áreas, datas e linhas ficaram; a operação saiu.
    expect(within(janela).getByTestId("registro-areas-linha-area-aroeira")).toBeTruthy();
    expect(within(janela).getByTestId("registro-areas-linha-area-acude")).toBeTruthy();
    expect(within(janela).getByTestId("registro-de-campo-data").value).toBe("2026-11-10");
    expect(within(janela).getByTestId("registro-de-campo-data-termino").value).toBe("2026-11-12");
    expect(within(janela).getAllByTestId(/^registro-insumo-linha-\d+$/).length).toBe(1);
    expect(within(janela).getByRole("combobox", { name: /Operação/ }).textContent).not.toContain("Combate à cigarrinha");
    expect(within(janela).getByRole("button", { name: "Salvar" })).toBeDisabled();
    // Voltar ao MESMO tipo não perde a operação.
    await escolherOperacao(janela, "Roçada");
    fireEvent.click(within(janela).getByRole("button", { name: "Trocar tipo" }));
    await escolherTipo(janela, "Roçada e tratos");
    expect(within(janela).getByRole("combobox", { name: /Operação/ }).textContent).toContain("Roçada");
  });

  it("Data de término: só vai no corpo preenchida; antes do início é recusada no cliente (nada sai); igual ou depois vai", async () => {
    const { janela } = await montar();
    await escolherTipo(janela, "Aplicação");
    await marcarAreas(janela, ["area-aroeira"]);
    await escolherOperacao(janela, "Herbicida");
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data"), { target: { value: "2026-11-10" } });
    // Antes do início: a mensagem aparece no campo e Salvar não envia.
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data-termino"), { target: { value: "2026-11-09" } });
    expect(await within(janela).findByText("A data de término não pode ser antes da data de início.")).toBeTruthy();
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar e novo" }));
    await waitFor(() => expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", "Revise os campos destacados."));
    expect(registros()).toHaveLength(0);
    // Mexer na Data de início para antes do término tira o erro.
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data"), { target: { value: "2026-11-08" } });
    await waitFor(() => expect(within(janela).queryByText("A data de término não pode ser antes da data de início.")).toBeNull());
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar e novo" }));
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body).toMatchObject({ data_operacional: "2026-11-08", data_termino: "2026-11-09", tipo_atividade_id: "t-herb", areas: [{ area_id: "area-aroeira", hectares: "38" }] });
    // "Salvar e novo": o tipo fica (o título também); o término sai.
    await waitFor(() => expect(within(janela).getByTestId("registro-de-campo-data-termino").value).toBe(""));
    expect(titulo(janela)).toBe("Nova realização de Aplicação");
    // Sem término: o corpo NÃO leva a chave (o recibo de antes do deploy continua casando).
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(registros()).toHaveLength(2));
    expect("data_termino" in registros()[1].body).toBe(false);
  });

  it("do mapa (área presa): abre nos cartões; escolhido o tipo, a área vem marcada e não sai", async () => {
    const { janela } = await montar({ area: AROEIRA, areas: [] });
    expect(titulo(janela)).toBe("Nova realização");
    await escolherTipo(janela, "Fertilização");
    expect(titulo(janela)).toBe("Nova realização de Fertilização");
    expect(within(janela).getByTestId("registro-areas-linha-area-aroeira")).toHaveTextContent("PASTO DA AROEIRA");
    expect(within(janela).queryByTestId("registro-areas-tirar-area-aroeira")).toBeNull();
    // Trocar o tipo não solta a área.
    fireEvent.click(within(janela).getByRole("button", { name: "Trocar tipo" }));
    await escolherTipo(janela, "Aplicação");
    expect(within(janela).getByTestId("registro-areas-linha-area-aroeira")).toBeTruthy();
    expect(within(janela).queryByTestId("registro-areas-tirar-area-aroeira")).toBeNull();
  });

  it("com a operação presa, abre direto no formulário do tipo dela, sem Trocar tipo", async () => {
    const { janela } = await montar({ tipo: OPERACOES[0] });
    expect(titulo(janela)).toBe("Nova realização de Aplicação");
    expect(within(janela).queryByRole("button", { name: "Trocar tipo" })).toBeNull();
    expect(within(janela).queryByTestId("registro-de-campo-tipos")).toBeNull();
  });
});

describe("Nova realização — período e entrada (D-PROD-265)", () => {
  it("o período do serviço: \"10/11 a 12/11\" só com término depois do início; vai para o histórico da área", () => {
    expect(regras.periodoDoServico("2026-11-10", "2026-11-12")).toBe("10/11 a 12/11");
    expect(regras.periodoDoServico("2026-11-10", "2026-11-10")).toBe("");
    expect(regras.periodoDoServico("2026-11-10", null)).toBe("");
    expect(regras.periodoDoServico("2026-11-10", "x")).toBe("");
    expect(linhasDoRegistro({ data_operacional: "2026-11-10", data_termino: "2026-11-12", observacao: "ok" })).toEqual([
      { rotulo: "Período", valor: "10/11 a 12/11" },
      { rotulo: "Observação", valor: "ok" },
    ]);
    expect(regras.erroDaDataDeTermino("2026-11-10", "", "2026-11-18")).toBeNull();
    expect(regras.erroDaDataDeTermino("2026-11-10", "2026-11-09", "2026-11-18")).toBe("A data de término não pode ser antes da data de início.");
    expect(regras.erroDaDataDeTermino("2026-11-10", "2026-11-19", "2026-11-18")).toBe("A data de término não pode ser depois de hoje na fazenda.");
    expect(regras.erroDaDataDeTermino("2026-11-10", "2026-11-10", "2026-11-18")).toBeNull();
  });

  it("o botão da tela de Atividades se chama \"Nova realização\" (rótulo e aria-label) e o mapa segue com \"Manejos\"", () => {
    const pagina = readFileSync("src/pages/LancamentoAtividades.jsx", "utf8");
    // D-PROD-267: é o botão de criar da barra ("+ Nova realização", o principal), ao lado de "Planejar".
    expect(pagina).toContain('createLabel="Nova realização"');
    expect(pagina).toContain('createText="Nova realização"');
    expect(pagina).toContain("onCreate={() => setRegistrando(true)}");
    expect(pagina).toContain('aria-label="Planejar"');
    expect(pagina).not.toContain('aria-label="Registrar serviço"');
    const mapa = readFileSync("src/components/mapa/DetalhesArea.jsx", "utf8");
    expect(mapa).toContain('rotulo: "Manejos"');
  });
});
