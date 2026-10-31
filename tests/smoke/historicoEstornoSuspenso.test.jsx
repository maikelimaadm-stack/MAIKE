/**
 * Cancelamentos com reversão não atômica SUSPENSOS na interface
 * (MAIKE-MAPA-HISTORICO-MOVIMENTACOES-R1.1, D-PROD-94a). Dados sintéticos.
 *
 * T01: histórico do cocho visível, nenhum "Excluir", aviso, ZERO chamadas ao
 *      serviço de reversão mesmo clicando em tudo.
 * T02: histórico do depósito idem, ZERO chamadas a excluirTransferenciaDeposito.
 * T03: a política não toca no lançamento normal do cocho nem na transferência
 *      entre depósitos.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  CANCELAMENTO_COCHO_HABILITADO,
  CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO,
  MENSAGEM_ESTORNO_SUSPENSO,
} from "@/domain/estornos/politicaEstorno";

const reversao = vi.hoisted(() => ({
  excluirEventoSuplementacaoComReversao: vi.fn(),
  excluirTransferenciaDeposito: vi.fn(),
}));
const cache = vi.hoisted(() => ({ dados: {} }));

vi.mock("@/services/suplementacaoHistoricoService", () => reversao);
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ email: "operador@exemplo.test" }) }));
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: async (chave) => cache.dados[chave] || [],
  refreshMapaCacheEntry: async (chave) => cache.dados[chave] || [],
  updateMapaCachedData: vi.fn(),
}));

const { default: HistoricoSuplementacaoPonto } = await import("@/components/suplementacao/HistoricoSuplementacaoPonto");
const { default: HistoricoDepositoSuplementacao } = await import("@/components/suplementacao/HistoricoDepositoSuplementacao");

const EMP = "emp-1";

const renderizar = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const clicarEmTodosOsBotoes = (raiz) => {
  for (const botao of within(raiz).queryAllByRole("button")) fireEvent.click(botao);
};

beforeEach(() => {
  localStorage.setItem("empresa_selecionada_id", EMP);
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  cache.dados = {
    eventosSuplementacao: [
      { id: "ev-2", empresa_id: EMP, ponto_suplementacao_id: "cocho-1", produto: "SAL MINERAL", data_lancamento: "2026-10-31", created_date: "2026-10-31T10:00:00.000Z", total_cabecas_afetadas: 100, area_id: "area-A" },
      { id: "ev-1", empresa_id: EMP, ponto_suplementacao_id: "cocho-1", produto: "SAL MINERAL", data_lancamento: "2026-10-30", created_date: "2026-10-30T10:00:00.000Z", total_cabecas_afetadas: 100, area_id: "area-A", dias_periodo: 1 },
    ],
    movimentacoes: [],
    movimentacaoEstoque: [
      { id: "me-1", empresa_id: EMP, tipo_detalhado: "transferencia_enviada", origem_sistema: "deposito", local_estoque_origem: "local-1", local_estoque_destino: "local-2", local_origem: "DEPÓSITO 1", local_destino: "DEPÓSITO 2", produto_nome: "SAL MINERAL", quantidade: 500, data_movimentacao: "2026-10-31T12:00:00.000Z", created_date: "2026-10-31T12:00:00.000Z" },
      { id: "me-0", empresa_id: EMP, tipo_detalhado: "suplementacao", local_estoque_origem: "local-1", produto_nome: "SAL MINERAL", quantidade: 50, data_movimentacao: "2026-10-30T12:00:00.000Z", created_date: "2026-10-30T12:00:00.000Z" },
    ],
  };
});

afterEach(() => cleanup());

describe("política fail-closed", () => {
  it("as duas flags estão desligadas e a mensagem é a combinada", () => {
    expect(CANCELAMENTO_COCHO_HABILITADO).toBe(false);
    expect(CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO).toBe(false);
    expect(MENSAGEM_ESTORNO_SUSPENSO).toBe("Cancelamentos temporariamente indisponíveis até a implementação de estorno seguro.");
  });
});

describe("T01 — histórico do cocho", () => {
  it("lista os lançamentos, mostra o aviso, não tem 'Excluir' e não chama a reversão", async () => {
    const { container } = renderizar(<HistoricoSuplementacaoPonto pontoId="cocho-1" pontoNome="COCHO 1" ponto={{ id: "cocho-1" }} />);
    expect(await screen.findByText("Histórico do Cocho (2)")).toBeTruthy();
    expect(screen.getAllByText("SAL MINERAL")).toHaveLength(2);
    expect(screen.getByRole("note").textContent).toBe(MENSAGEM_ESTORNO_SUSPENSO);
    expect(screen.queryByRole("button", { name: /Excluir/i })).toBeNull();
    expect(screen.queryByText(/Somente o último lançamento pode ser excluído/)).toBeNull();
    clicarEmTodosOsBotoes(container);
    expect(reversao.excluirEventoSuplementacaoComReversao).toHaveBeenCalledTimes(0);
  });

  it("guarda do handler: o arquivo recusa antes de qualquer chamada (inspeção do fonte)", () => {
    const fonte = readFileSync(resolve(process.cwd(), "src/components/suplementacao/HistoricoSuplementacaoPonto.jsx"), "utf8");
    const corpo = fonte.slice(fonte.indexOf("const handleDelete"));
    const guarda = corpo.indexOf("if (!CANCELAMENTO_COCHO_HABILITADO) return");
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(corpo.indexOf("excluirEventoSuplementacaoComReversao("));
    expect(guarda).toBeLessThan(corpo.indexOf("confirm("));
  });
});

describe("T02 — histórico do depósito", () => {
  it("lista as movimentações, mostra o aviso, não tem 'Excluir' e não chama excluirTransferenciaDeposito", async () => {
    const { container } = renderizar(<HistoricoDepositoSuplementacao deposito={{ id: "dep-1", local_estoque_id: "local-1" }} />);
    expect(await screen.findByText("Histórico do Depósito (2)")).toBeTruthy();
    expect(screen.getByText("Saída (transferência)")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe(MENSAGEM_ESTORNO_SUSPENSO);
    expect(screen.queryByRole("button", { name: /Excluir/i })).toBeNull();
    expect(screen.queryByText(/só pode ser excluída/)).toBeNull();
    expect(screen.getByText(/Lançamento de nutrição: consulta apenas/)).toBeTruthy();
    clicarEmTodosOsBotoes(container);
    expect(reversao.excluirTransferenciaDeposito).toHaveBeenCalledTimes(0);
  });

  it("guarda do handler antes de confirm e da reversão (inspeção do fonte)", () => {
    const fonte = readFileSync(resolve(process.cwd(), "src/components/suplementacao/HistoricoDepositoSuplementacao.jsx"), "utf8");
    const corpo = fonte.slice(fonte.indexOf("const handleDelete"));
    const guarda = corpo.indexOf("if (!CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO) return");
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(corpo.indexOf("excluirTransferenciaDeposito("));
    expect(guarda).toBeLessThan(corpo.indexOf("confirm("));
  });
});

describe("T03 — fluxos normais não são afetados", () => {
  it("só os dois históricos conhecem a política; lançamento e transferência não", () => {
    const usos = execSync("grep -rl \"politicaEstorno\" src", { cwd: process.cwd() }).toString().trim().split("\n").sort();
    expect(usos).toEqual([
      "src/components/suplementacao/HistoricoDepositoSuplementacao.jsx",
      "src/components/suplementacao/HistoricoSuplementacaoPonto.jsx",
    ]);
  });

  it("os únicos consumidores das rotinas de reversão são os dois históricos suspensos", () => {
    const usos = execSync(
      "grep -rlE \"excluirEventoSuplementacaoComReversao|excluirTransferenciaDeposito\" src --include=*.js --include=*.jsx",
      { cwd: process.cwd() }
    ).toString().trim().split("\n").sort();
    expect(usos).toEqual([
      "src/components/suplementacao/HistoricoDepositoSuplementacao.jsx",
      "src/components/suplementacao/HistoricoSuplementacaoPonto.jsx",
      "src/services/suplementacaoHistoricoService.js",
    ]);
  });
});
