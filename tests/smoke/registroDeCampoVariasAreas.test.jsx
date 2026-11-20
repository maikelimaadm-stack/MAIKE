/**
 * D-PROD-263 — "Registrar serviço" de VÁRIAS áreas (fase 3, maquete "Nova realização"): o campo "Áreas" (busca + caixas,
 * "N áreas selecionadas") e a tabela Área · Tamanho (ha) · % · Hectares (ha) · ✕ com a linha de Total; % e hectares
 * andam juntos; o corpo leva `areas: [{ area_id, hectares }]` (sem `area_id` nem `area_executada_dia`) e as linhas com os
 * TOTAIS (o servidor reparte); a dose/ha usa os hectares TOTAIS; a recusa de uma área diz qual, na linha certa; aberta do
 * mapa (área presa), a área vem marcada e não sai, e outras podem entrar.
 *
 * A janela montada de verdade (`JanelaRegistroDeCampo`, service, API, porta e `nativeHttpClient` reais); mocks só da borda:
 * `fetch` (um backend falso no formato do contrato), a sessão da tela, o aviso e a confirmação do envio pendente.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { API_FAKE, erroServidor, instalarBackendFake } from "./fixtures/gestaoBackendFake.js";

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

const HOJE = "2026-11-18";
const OPERACAO = { id: "t-cig", nome_tipo: "Combate à cigarrinha", categoria: "APLICACAO", ativo: true };
const AROEIRA = { id: "area-aroeira", nome: "PASTO DA AROEIRA", tamanho_hectares: 38, empresa_id: "emp-1", ativo: true };
const ACUDE = { id: "area-acude", nome: "PASTO DO AÇUDE", tamanho_hectares: 27.3, empresa_id: "emp-1", ativo: true };
const CORREGO = { id: "area-corrego", nome: "PASTO DO CÓRREGO", tamanho_hectares: 52.5, empresa_id: "emp-1", ativo: true };
const SEM_TAMANHO = { id: "area-x", nome: "RESERVA", tamanho_hectares: null, empresa_id: "emp-1", ativo: true };
const AREAS = [AROEIRA, ACUDE, CORREGO, SEM_TAMANHO];
const PRODUTOS = [
  { id: "p1", nome: "Tiametoxam", unidade: "L", unidade_principal_estoque: "L" },
  { id: "p2", nome: "Espalhante", unidade: "L", unidade_principal_estoque: "L" },
];
const LOCAIS = /** @type {Record<string, any[]>} */ ({
  p1: [{ local_estoque_id: "l1", local_nome: "Depósito", disponivel: "60.0000", unidade: "L" }],
  p2: [{ local_estoque_id: "l1", local_nome: "Depósito", disponivel: "25.0000", unidade: "L" }],
});

/** @type {{ chamadas: Array<{ method: string, path: string, query: Record<string, string>, body: any }> }} */
let backend;
/** @type {{ status: number, body?: unknown } | null} */
let proxima;
/** Atividades abertas por área (o resumo da área). @type {Record<string, any[]>} */
let abertas;

const rotear = async (/** @type {{ method: string, path: string, query: URLSearchParams, body: any }} */ { method, path, query, body }) => {
  const partes = path.split("/").filter(Boolean);
  if (path === "/areas-pastagem" && method === "GET") return { status: 200, body: AREAS };
  if (partes[0] === "atividades-opcoes" && method === "GET") {
    if (partes[1] === "locais") return { status: 200, body: { itens: LOCAIS[String(query.get("produto_id"))] ?? [] } };
    return { status: 200, body: { itens: partes[1] === "produtos" ? PRODUTOS : [], has_more: false, next_cursor: null } };
  }
  if (partes[0] === "atividades-por-area" && method === "GET") return { status: 200, body: { area_id: partes[1], mes: "2026-11", atividades: abertas[partes[1]] ?? [], custos: null } };
  if (path === "/atividades/registrar" && method === "POST") {
    if (proxima) {
      const r = proxima;
      proxima = null;
      return r;
    }
    const apontamentos = (body.areas ?? [{ area_id: body.area_id }]).map((/** @type {any} */ a, /** @type {number} */ i) => ({ id: `ap-${i + 1}`, data_operacional: body.data_operacional }));
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
  proxima = null;
  abertas = {};
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
      <JanelaRegistroDeCampo tipo={OPERACAO} areas={AREAS} onFechar={onFechar} {...props} />
    </QueryClientProvider>,
  );
  const janela = await screen.findByTestId("janela-registro-de-campo");
  return { janela, onFechar };
};
const registros = () => backend.chamadas.filter((c) => c.method === "POST" && c.path === "/atividades/registrar");
/** Abre a lista das áreas, marca as dadas (pelo id) e fecha. @param {HTMLElement} janela @param {string[]} ids */
const marcarAreas = async (janela, ids) => {
  fireEvent.click(within(janela).getByTestId("registro-areas-campo"));
  for (const id of ids) fireEvent.click(await screen.findByTestId(`registro-areas-opcao-${id}`));
  fireEvent.click(within(janela).getByTestId("registro-areas-campo"));
  await waitFor(() => expect(screen.queryByTestId("registro-areas-lista")).toBeNull());
};
/** Os textos das células de uma linha (o valor dos campos no lugar do texto). @param {HTMLElement} linha */
const celulas = (linha) =>
  [...linha.querySelectorAll("td")].map((td) => {
    const input = td.querySelector("input");
    return input ? input.value : td.textContent.replace(/\s+/g, " ").trim();
  });
const escolherNoSeletor = async (/** @type {HTMLElement} */ raiz, /** @type {string} */ testId, /** @type {RegExp|string} */ nome) => {
  await waitFor(() => expect(within(raiz).getByTestId(testId)).not.toBeDisabled());
  fireEvent.click(within(raiz).getByTestId(testId));
  fireEvent.click(await screen.findByRole("option", { name: nome }));
  await waitFor(() => expect(screen.queryByTestId(`${testId}-painel`)).toBeNull());
};
const incluirInsumo = async (/** @type {HTMLElement} */ janela, /** @type {RegExp} */ produto, /** @type {string} */ quantidade) => {
  fireEvent.click(within(janela).getByTestId("registro-incluir-insumo"));
  const editor = within(janela).getByTestId("registro-insumo-editor");
  await escolherNoSeletor(editor, "registro-produto-produto", produto);
  await waitFor(() => expect(within(editor).getByRole("combobox", { name: /Local do estoque/ })).toHaveTextContent("Depósito"));
  fireEvent.change(within(editor).getByTestId("registro-produto-quantidade"), { target: { value: quantidade } });
  fireEvent.click(within(editor).getByTestId("registro-insumo-editor-incluir"));
  await waitFor(() => expect(within(janela).queryByTestId("registro-insumo-editor")).toBeNull());
};
const salvar = (/** @type {HTMLElement} */ janela) => fireEvent.click(within(janela).getByTestId("registro-de-campo-salvar"));

// ═════════════════════════════════════════════════════════════════════════
describe("RA-CAMPO — o campo Áreas e a tabela", () => {
  it("RA-CAMPO-1 — marcar 2 áreas: \"2 áreas selecionadas\", a tabela Área · Tamanho · % · Hectares · ✕ (100% do tamanho) e o Total", async () => {
    const { janela } = await montar();
    expect(within(janela).getByTestId("registro-areas-campo")).toHaveTextContent("Selecione as áreas…");
    expect(within(janela).queryByTestId("registro-areas-escolhidas")).toBeNull();
    // O Salvar só habilita com área.
    expect(within(janela).getByTestId("registro-de-campo-salvar")).toBeDisabled();
    await marcarAreas(janela, [AROEIRA.id, ACUDE.id]);
    expect(within(janela).getByTestId("registro-areas-campo")).toHaveTextContent("2 áreas selecionadas");
    const tabela = within(janela).getByTestId("registro-areas-escolhidas");
    expect([...tabela.querySelectorAll("thead th")].map((th) => th.textContent.trim())).toEqual(["Área", "Tamanho (ha)", "%", "Hectares (ha)", "Tirar"]);
    expect(celulas(within(janela).getByTestId(`registro-areas-linha-${AROEIRA.id}`)).slice(0, 4)).toEqual(["PASTO DA AROEIRA", "38 ha", "100", "38"]);
    expect(celulas(within(janela).getByTestId(`registro-areas-linha-${ACUDE.id}`)).slice(0, 4)).toEqual(["PASTO DO AÇUDE", "27,3 ha", "100", "27,3"]);
    expect(celulas(within(janela).getByTestId("registro-areas-total"))).toEqual(["Total · 2 áreas", "65,3 ha", "", "65,3 ha", ""]);
    expect(within(janela).getByTestId("registro-de-campo-salvar")).not.toBeDisabled();
    // ✕ tira a área; a lista desmarca também.
    fireEvent.click(within(janela).getByTestId(`registro-areas-tirar-${AROEIRA.id}`));
    expect(within(janela).queryByTestId(`registro-areas-linha-${AROEIRA.id}`)).toBeNull();
    expect(within(janela).getByTestId("registro-areas-campo")).toHaveTextContent("PASTO DO AÇUDE");
  });

  it("RA-CAMPO-2 — % e hectares andam juntos: 60% de 27,3 ha = 16,38 ha; 13,65 ha = 50%; o Total acompanha", async () => {
    const { janela } = await montar();
    await marcarAreas(janela, [AROEIRA.id, ACUDE.id]);
    fireEvent.change(within(janela).getByTestId(`registro-areas-percentual-${ACUDE.id}`), { target: { value: "60" } });
    expect(within(janela).getByTestId(`registro-areas-hectares-${ACUDE.id}`)).toHaveValue("16,38");
    expect(celulas(within(janela).getByTestId("registro-areas-total"))[3]).toBe("54,38 ha");
    fireEvent.change(within(janela).getByTestId(`registro-areas-hectares-${ACUDE.id}`), { target: { value: "13,65" } });
    expect(within(janela).getByTestId(`registro-areas-percentual-${ACUDE.id}`)).toHaveValue("50");
    fireEvent.change(within(janela).getByTestId(`registro-areas-percentual-${AROEIRA.id}`), { target: { value: "33,33" } });
    expect(within(janela).getByTestId(`registro-areas-hectares-${AROEIRA.id}`)).toHaveValue("12,6654");
    // Área sem tamanho: o % não se aplica e os hectares são digitados.
    await marcarAreas(janela, [SEM_TAMANHO.id]);
    expect(within(janela).getByTestId(`registro-areas-percentual-${SEM_TAMANHO.id}`)).toBeDisabled();
    expect(within(janela).getByTestId(`registro-areas-hectares-${SEM_TAMANHO.id}`)).toHaveValue("");
  });

  it("RA-CAMPO-3 — sem área, ou com hectares inválidos, não grava e aponta: \"Escolha a área.\" e o erro na linha da área", async () => {
    const { janela } = await montar();
    fireEvent.submit(within(janela).getByTestId("registro-de-campo-form"));
    expect(await within(janela).findByText("Escolha a área.")).toBeTruthy();
    await marcarAreas(janela, [AROEIRA.id, SEM_TAMANHO.id]);
    fireEvent.change(within(janela).getByTestId(`registro-areas-hectares-${AROEIRA.id}`), { target: { value: "0" } });
    salvar(janela);
    expect(await within(janela).findByTestId(`registro-areas-linha-${AROEIRA.id}-erro`)).toHaveTextContent("Os hectares têm de ser maiores que zero.");
    expect(within(janela).getByTestId(`registro-areas-linha-${SEM_TAMANHO.id}-erro`)).toHaveTextContent("Informe os hectares feitos nesta área.");
    expect(registros()).toHaveLength(0);
  });
});

describe("RA-ENVIO — o corpo e as linhas", () => {
  it("RA-ENVIO-1 — UM POST com `areas` na ordem da tabela (hectares de cada área) e as linhas com os TOTAIS; a dose/ha usa os hectares totais", async () => {
    const { janela, onFechar } = await montar();
    await marcarAreas(janela, [AROEIRA.id, ACUDE.id]);
    fireEvent.change(within(janela).getByTestId(`registro-areas-percentual-${ACUDE.id}`), { target: { value: "60" } });
    await incluirInsumo(janela, /Tiametoxam/, "13,6");
    // 13,6 L ÷ 54,38 ha (o total) = 0,2501 L/ha; o Total do insumo é o que sai do estoque, inteiro.
    const insumo = [...within(janela).getByTestId("registro-insumo-linha-1").querySelectorAll("td")].slice(0, 4).map((td) => td.textContent.trim());
    expect(insumo).toEqual(["Tiametoxam", "Depósito", "0,2501 L/ha", "13,6 L"]);
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body).toEqual({
      empresa_id: "emp-1",
      areas: [
        { area_id: AROEIRA.id, hectares: "38" },
        { area_id: ACUDE.id, hectares: "16.38" },
      ],
      tipo_atividade_id: "t-cig",
      data_operacional: HOJE,
      operation_id: expect.any(String),
      produtos: [{ produto_id: "p1", local_estoque_id: "l1", quantidade: "13.6" }],
    });
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Combate à cigarrinha registrada em 2 áreas.");
  });

  it("RA-ENVIO-2 — o destino conta com as várias áreas: entra na aberta da 1ª que casa e diz quem entra nela; sem nenhuma, o nome \"+N\"", async () => {
    const { janela } = await montar();
    await marcarAreas(janela, [AROEIRA.id, ACUDE.id, CORREGO.id]);
    expect(await within(janela).findByTestId("registro-de-campo-destino")).toHaveTextContent("Nova atividade será criada: Combate à cigarrinha · PASTO DA AROEIRA +2 · nov/26");
    cleanup();
    abertas = {
      [ACUDE.id]: [{ atividade_id: "at-7", nome: "Combate à cigarrinha · PASTO DO AÇUDE · nov/26", tipo_atividade_id: "t-cig", status: "ABERTA", area_status: "EM_ANDAMENTO", data_inicio: "2026-11-03" }],
      [CORREGO.id]: [{ atividade_id: "at-7", nome: "Combate à cigarrinha · PASTO DO AÇUDE · nov/26", tipo_atividade_id: "t-cig", status: "ABERTA", area_status: "PLANEJADA", data_inicio: "2026-11-03" }],
    };
    const outra = await montar();
    await marcarAreas(outra.janela, [AROEIRA.id, ACUDE.id, CORREGO.id]);
    expect(await within(outra.janela).findByTestId("registro-de-campo-destino")).toHaveTextContent(
      "Entra em Combate à cigarrinha · PASTO DO AÇUDE · nov/26; PASTO DA AROEIRA entra nela",
    );
  });
});

describe("RA-RECUSA — a recusa de uma área", () => {
  it("RA-RECUSA-1 — `area_indice` + `indice` do produto: a mensagem nomeia a área, na linha certa do insumo (o editor abre nela)", async () => {
    const { janela } = await montar();
    await marcarAreas(janela, [AROEIRA.id, ACUDE.id]);
    await incluirInsumo(janela, /Tiametoxam/, "10");
    await incluirInsumo(janela, /Espalhante/, "2,7");
    // O formato do servidor: `details` com a posição do insumo NO CORPO e a área (D-PROD-263).
    proxima = erroServidor(422, "ESTOQUE_SALDO_INSUFICIENTE", {
      field: "quantidade",
      reason: "lote_insuficiente",
      details: { colecao: "produtos", indice: 1, unidade: "L", disponivel: "0.5000", solicitado: "1.1000", area_id: ACUDE.id, area_indice: 1 },
    });
    salvar(janela);
    const erro = await within(janela).findByTestId("registro-insumo-linha-2-erro");
    expect(erro).toHaveTextContent(/^Na área PASTO DO AÇUDE: Saldo insuficiente deste produto no local escolhido: disponível 0,5 L, pedido 1,1 L\. Nada foi gravado\.$/);
    expect(within(janela).queryByTestId("registro-insumo-linha-1-erro")).toBeNull();
    expect(within(janela).getByTestId("registro-insumo-editor")).toBeTruthy();
    expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", expect.stringMatching(/^Na área PASTO DO AÇUDE: /));
  });

  it("RA-RECUSA-2 — recusa da área sem linha (área concluída na atividade): a mensagem fica embaixo da área, na tabela das áreas", async () => {
    const { janela } = await montar();
    await marcarAreas(janela, [AROEIRA.id, ACUDE.id]);
    proxima = erroServidor(409, "ATIVIDADE_STATUS_INVALIDO", { details: { status: "CONCLUIDA", acao: "lancar_na_area", entidade: "area", area_id: ACUDE.id, area_indice: 1 } });
    salvar(janela);
    const erro = await within(janela).findByTestId(`registro-areas-linha-${ACUDE.id}-erro`);
    expect(erro).toHaveTextContent("Na área PASTO DO AÇUDE: Esta área já está concluída na atividade");
    expect(within(janela).queryByTestId(`registro-areas-linha-${AROEIRA.id}-erro`)).toBeNull();
    // Mexer nas áreas tira o aviso.
    fireEvent.change(within(janela).getByTestId(`registro-areas-hectares-${ACUDE.id}`), { target: { value: "10" } });
    expect(within(janela).queryByTestId(`registro-areas-linha-${ACUDE.id}-erro`)).toBeNull();
  });
});

describe("RA-MAPA — aberta dos Detalhes da área (área presa)", () => {
  it("RA-MAPA-1 — a área presa vem marcada (100%), não sai (sem ✕, caixa travada) e outras entram pela lista lida da fazenda", async () => {
    const { janela } = await montar({ area: AROEIRA, areas: undefined });
    expect(within(janela).getByTestId("registro-areas-campo")).toHaveTextContent("PASTO DA AROEIRA");
    expect(celulas(within(janela).getByTestId(`registro-areas-linha-${AROEIRA.id}`)).slice(0, 4)).toEqual(["PASTO DA AROEIRA", "38 ha", "100", "38"]);
    expect(within(janela).queryByTestId(`registro-areas-tirar-${AROEIRA.id}`)).toBeNull();
    fireEvent.click(within(janela).getByTestId("registro-areas-campo"));
    expect(await screen.findByTestId(`registro-areas-opcao-${AROEIRA.id}`)).toBeDisabled();
    fireEvent.click(await screen.findByTestId(`registro-areas-opcao-${ACUDE.id}`));
    fireEvent.click(within(janela).getByTestId("registro-areas-campo"));
    await waitFor(() => expect(screen.queryByTestId("registro-areas-lista")).toBeNull());
    expect(within(janela).getByTestId("registro-areas-campo")).toHaveTextContent("2 áreas selecionadas");
    expect(backend.chamadas.some((c) => c.method === "GET" && c.path === "/areas-pastagem")).toBe(true);
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.areas).toEqual([
      { area_id: AROEIRA.id, hectares: "38" },
      { area_id: ACUDE.id, hectares: "27.3" },
    ]);
  });
});

describe("RA-REGRAS — as regras puras das áreas do registro", () => {
  it("RA-REGRAS-1 — marcar (100%), travada não sai, teto de 20; % ↔ hectares; corpo; totais; área da recusa", () => {
    let linhas = regras.alternarAreaNoRegistro([], AROEIRA);
    linhas = regras.alternarAreaNoRegistro(linhas, ACUDE);
    expect(linhas).toEqual([
      { area_id: AROEIRA.id, percentual: "100", hectares: "38" },
      { area_id: ACUDE.id, percentual: "100", hectares: "27,3" },
    ]);
    expect(regras.alternarAreaNoRegistro(linhas, AROEIRA, { travadas: new Set([AROEIRA.id]) })).toBe(linhas);
    expect(regras.alternarAreaNoRegistro(linhas, AROEIRA).map((l) => l.area_id)).toEqual([ACUDE.id]);
    const vinte = Array.from({ length: 20 }, (_, i) => ({ area_id: `a${i}`, percentual: "", hectares: "1" }));
    expect(regras.alternarAreaNoRegistro(vinte, CORREGO)).toBe(vinte);
    expect(regras.AREAS_NO_REGISTRO_MAXIMO).toBe(20);
    expect(regras.comPercentualDigitado(linhas[1], "60", ACUDE)).toEqual({ area_id: ACUDE.id, percentual: "60", hectares: "16,38" });
    expect(regras.comHectaresDigitados(linhas[1], "13,65", ACUDE)).toEqual({ area_id: ACUDE.id, percentual: "50", hectares: "13,65" });
    expect(regras.comHectaresDigitados(linhas[1], "", ACUDE)).toEqual({ area_id: ACUDE.id, percentual: "", hectares: "" });
    expect(regras.comPercentualDigitado(linhas[1], "abc", ACUDE)).toEqual({ area_id: ACUDE.id, percentual: "abc", hectares: "27,3" });
    expect(regras.errosDasAreasDoRegistro([{ area_id: "x", percentual: "abc", hectares: "1" }])).toEqual({ "pct:x": "O % está em formato inválido: use 60 ou 33,33." });
    expect(regras.corpoDasAreasDoRegistro([{ area_id: "x", percentual: "", hectares: "1.234,5" }])).toEqual([{ area_id: "x", hectares: "1234.5" }]);
    expect(regras.totaisDasAreasDoRegistro(linhas, AREAS)).toEqual({ tamanho: "65.3000", hectares: "65.3000" });
    expect(regras.areaDaRecusa({ details: { area_indice: 1, area_id: ACUDE.id } }, [{ area_id: AROEIRA.id }, { area_id: ACUDE.id }])).toEqual({ indice: 1, area_id: ACUDE.id });
    expect(regras.areaDaRecusa({ details: { area_indice: 1, area_id: "outra" } }, [{ area_id: AROEIRA.id }, { area_id: ACUDE.id }])).toBeNull();
    expect(regras.areaDaRecusa({ details: {} }, [{ area_id: AROEIRA.id }])).toBeNull();
    expect(regras.nomeDaAtividadeNova("Roçada", "P1", HOJE, 2)).toBe("Roçada · P1 +2 · nov/26");
    expect(regras.nomeDaAtividadeNova("Roçada", "P1", HOJE)).toBe("Roçada · P1 · nov/26");
  });

  it("RA-REGRAS-2 — o teto de áreas da tela é o do servidor (20)", () => {
    const fonte = readFileSync("backend/src/modules/atividades/atividadeRegistroService.js", "utf8");
    const doServidor = Number(/export const AREAS_NO_REGISTRO_MAXIMO = (\d+);/.exec(fonte)?.[1]);
    expect(doServidor).toBe(20);
    expect(regras.AREAS_NO_REGISTRO_MAXIMO).toBe(doServidor);
  });
});
