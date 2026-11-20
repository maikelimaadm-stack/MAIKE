// @vitest-environment jsdom
/**
 * D-PROD-266 (etapa 1) — "Excluir" do evento do histórico da TAREFA no mapa.
 *
 * - Visibilidade = a guarda do servidor (`GUARDAS.tarefa = porAcessoTotal`):
 *   administrador real (`administrador_fazenda`) ou `is_admin`. Operador comum
 *   que abre a tarefa (visualizar_tarefas + Gestão de Tarefas) NÃO vê o botão
 *   (antes via e recebia 403).
 * - Só o mais recente (índice 0) fica ligado, como antes.
 * - Sem conexão: desligado, com o motivo; nada vai para a fila.
 * - Depois de excluir: o evento sai da lista na hora, o cache do mapa
 *   (`historicoTarefa`) é corrigido e relido com `force`, e a releitura do
 *   detalhe não traz o evento de volta (antes ele voltava da cópia do aparelho).
 * Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const estado = vi.hoisted(() => ({
  /** cópia do aparelho (IndexedDB) da chave `historicoTarefa` */
  aparelho: /** @type {any[]} */ ([]),
  /** o que o servidor tem */
  servidor: /** @type {any[]} */ ([]),
  usuario: /** @type {any} */ (null),
  permissao: /** @type {any} */ (null),
}));

const excluirHistorico = vi.hoisted(() => vi.fn());
const refreshMapaCacheEntry = vi.hoisted(() => vi.fn());
const updateMapaCachedData = vi.hoisted(() => vi.fn());
const toastErro = vi.hoisted(() => vi.fn());

vi.mock("@/services/tarefasMapaService", () => ({
  atualizarTarefa: vi.fn(),
  enviarAnexo: vi.fn(),
  excluirHistorico: (...a) => excluirHistorico(...a),
  listarTodosGrupos: vi.fn(async () => []),
  listarTodosTipos: vi.fn(async () => []),
  listarUsuarios: vi.fn(async () => []),
  listarPermissoes: vi.fn(async () => []),
}));
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: async () => estado.aparelho,
  refreshMapaCacheEntry: (...a) => refreshMapaCacheEntry(...a),
  updateMapaCachedData: (...a) => updateMapaCachedData(...a),
}));
vi.mock("@/services/sessionService", async (importOriginal) => ({
  ...(/** @type {any} */ (await importOriginal())),
  getCurrentUser: async () => estado.usuario,
  carregarPermissaoEfetiva: async () => estado.permissao,
}));
const confirmar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/maikeConfirmar", () => ({ confirmarExclusao: (...a) => confirmar(...a) }));
vi.mock("sonner", () => ({ toast: { error: (...a) => toastErro(...a), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/mapa/FormularioTarefaMapa", async (importOriginal) => {
  const real = /** @type {any} */ (await importOriginal());
  return { ...real, default: () => <div data-testid="formulario-tarefa" /> };
});

const { LancLoteDialogo } = await import("@/components/lotes/LancamentoLoteUi");
const { default: HistoricoTarefaPanel } = await import("@/components/mapa/HistoricoTarefaPanel");
const { default: DetalhesTarefaMapa } = await import("@/components/mapa/DetalhesTarefaMapa");
const { default: TarefaDetalhesDialog } = await import("@/components/tarefas/TarefaDetalhesDialog");
const { podeExcluirEventoDaTarefa } = await import("@/hooks/usePodeExcluirEventoTarefa");

const EMP = "emp-1";
const TAREFA = Object.freeze({
  id: "t1",
  empresa_id: EMP,
  titulo: "Consertar cerca",
  tipo: "Manutenção",
  status: "Em Andamento",
  prioridade: "Alta",
  data_inicio: "2026-11-12T12:00:00.000Z",
});
const EVENTOS = Object.freeze([
  { id: "h2", empresa_id: EMP, tarefa_id: "t1", evento: "Mudança de Status", status: "Em Andamento", descricao: "Começou a cerca.", data_evento: "2026-11-12T14:30:00.000Z" },
  { id: "h1", empresa_id: EMP, tarefa_id: "t1", evento: "Criação", status: "Pendente", descricao: "Tarefa criada pelo mapa.", data_evento: "2026-11-10T09:00:00.000Z" },
  { id: "hx", empresa_id: EMP, tarefa_id: "outra", evento: "Registro", descricao: "Outra tarefa.", data_evento: "2026-11-13T12:00:00.000Z" },
]);

const OPERADOR = { email: "operador@exemplo.test", login: "operador", administrador_fazenda: false };
const ADMIN = { email: "dono@exemplo.test", login: "dono", administrador_fazenda: true };

const definirOnline = (valor) => Object.defineProperty(window.navigator, "onLine", { value: valor, configurable: true });

beforeEach(() => {
  definirOnline(true);
  estado.aparelho = EVENTOS.map((e) => ({ ...e }));
  estado.servidor = EVENTOS.map((e) => ({ ...e }));
  estado.usuario = OPERADOR;
  estado.permissao = { is_admin: false, mapa_geral_permissoes: { visualizar_tarefas: true } };
  excluirHistorico.mockReset().mockImplementation(async (id) => {
    estado.servidor = estado.servidor.filter((e) => e.id !== id);
  });
  // Como o serviço real: sem `force`, dentro dos 60 s, devolve a cópia do
  // aparelho; com `force`, lê o servidor e grava a cópia.
  refreshMapaCacheEntry.mockReset().mockImplementation(async (_chave, _empresa, opcoes = {}) => {
    if (opcoes.force === true) {
      estado.aparelho = estado.servidor.map((e) => ({ ...e }));
      return estado.aparelho;
    }
    return estado.aparelho;
  });
  updateMapaCachedData.mockReset().mockImplementation(async (_chave, _empresa, atualizar) => {
    estado.aparelho = typeof atualizar === "function" ? atualizar(estado.aparelho) : atualizar;
    return estado.aparelho;
  });
  toastErro.mockReset();
  confirmar.mockReset().mockImplementation(async () => true);
});
afterEach(() => {
  cleanup();
  definirOnline(true);
});

const montar = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};
const noDialogo = (ui) =>
  montar(
    <LancLoteDialogo open onOpenChange={() => {}} titulo="Histórico da tarefa" lotes={[{ nome: "Consertar cerca" }]} largo somenteLeitura>
      {ui}
    </LancLoteDialogo>,
  );
const HISTORICO_T1 = () => EVENTOS.filter((e) => e.tarefa_id === "t1");
const botoesExcluir = () => /** @type {HTMLButtonElement[]} */ (screen.queryAllByRole("button", { name: "Excluir" }));

describe("regra pura (espelho de porAcessoTotal)", () => {
  it("administrador real ou is_admin; mais nada", () => {
    expect(podeExcluirEventoDaTarefa(ADMIN, null)).toBe(true);
    expect(podeExcluirEventoDaTarefa(OPERADOR, { is_admin: true })).toBe(true);
    expect(podeExcluirEventoDaTarefa(OPERADOR, { is_admin: false, mapa_geral_permissoes: { visualizar_tarefas: true, excluir_movimentacoes_lote: true } })).toBe(false);
    expect(podeExcluirEventoDaTarefa(OPERADOR, null)).toBe(false);
    expect(podeExcluirEventoDaTarefa(null, null)).toBe(false);
    // `is_admin` só vale como booleano verdadeiro.
    expect(podeExcluirEventoDaTarefa(OPERADOR, { is_admin: "true" })).toBe(false);
  });
});

describe("HistoricoTarefaPanel — visibilidade e conexão", () => {
  it("sem podeExcluir (padrão): nenhum Excluir nem o aviso de 'só o último'", async () => {
    noDialogo(<HistoricoTarefaPanel tarefaId="t1" empresaId={EMP} tarefaTitulo="Consertar cerca" historico={HISTORICO_T1()} />);
    await screen.findByText("Começou a cerca.");
    expect(botoesExcluir()).toHaveLength(0);
    expect(screen.queryByText("Somente o último histórico pode ser excluído.")).toBeNull();
  });

  it("com podeExcluir: Excluir em cada cartão, só o mais recente ligado", async () => {
    noDialogo(<HistoricoTarefaPanel tarefaId="t1" empresaId={EMP} tarefaTitulo="Consertar cerca" historico={HISTORICO_T1()} podeExcluir />);
    await screen.findByText("Começou a cerca.");
    expect(botoesExcluir().map((b) => b.disabled)).toEqual([false, true]);
    expect(botoesExcluir()[1].getAttribute("title")).toBe("Somente o último histórico pode ser excluído.");
    expect(screen.getByText("Somente o último histórico pode ser excluído.")).toBeTruthy();
  });

  it("sem conexão: desligado com o motivo; o clique não exclui (nada de fila offline)", async () => {
    definirOnline(false);
    noDialogo(<HistoricoTarefaPanel tarefaId="t1" empresaId={EMP} tarefaTitulo="Consertar cerca" historico={HISTORICO_T1()} podeExcluir />);
    await screen.findByText("Começou a cerca.");
    const [recente] = botoesExcluir();
    expect(recente.disabled).toBe(true);
    expect(recente.getAttribute("title")).toBe("Sem conexão: a exclusão só é feita com internet.");
    fireEvent.click(recente);
    expect(excluirHistorico).not.toHaveBeenCalled();
    // Voltou a rede: liga de novo.
    await act(async () => {
      definirOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(botoesExcluir()[0].disabled).toBe(false);
  });

  it("a rede cai com a confirmação aberta: não exclui nem enfileira", async () => {
    confirmar.mockImplementation(async () => {
      definirOnline(false);
      return true;
    });
    noDialogo(<HistoricoTarefaPanel tarefaId="t1" empresaId={EMP} tarefaTitulo="Consertar cerca" historico={HISTORICO_T1()} podeExcluir />);
    await screen.findByText("Começou a cerca.");
    await act(async () => {
      fireEvent.click(botoesExcluir()[0]);
    });
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith("Sem conexão: a exclusão só é feita com internet."));
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(excluirHistorico).not.toHaveBeenCalled();
    expect(updateMapaCachedData).not.toHaveBeenCalled();
    expect(screen.getByText("Começou a cerca.")).toBeTruthy();
  });
});

describe("DetalhesTarefaMapa — quem vê o Excluir no 'Ver histórico'", () => {
  const abrirHistorico = async () => {
    await screen.findByRole("list", { name: "Últimos eventos da tarefa" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ver histórico" }));
    });
    return screen.findByRole("dialog", { name: "Histórico da Tarefa (2)" });
  };
  const detalhe = () =>
    montar(
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Detalhes da tarefa" largo somenteLeitura>
        <DetalhesTarefaMapa tarefa={TAREFA} hoje="2026-11-15" />
      </LancLoteDialogo>,
    );

  it("operador com visualizar_tarefas (sem is_admin): não vê Excluir (o servidor recusaria com 403)", async () => {
    detalhe();
    const dialogo = await abrirHistorico();
    await within(dialogo).findByText("Começou a cerca.");
    // Dá tempo das consultas de sessão responderem.
    await act(async () => {});
    expect(within(dialogo).queryAllByRole("button", { name: "Excluir" })).toHaveLength(0);
  });

  it("is_admin: vê Excluir", async () => {
    estado.permissao = { is_admin: true };
    detalhe();
    const dialogo = await abrirHistorico();
    await waitFor(() => expect(within(dialogo).getAllByRole("button", { name: "Excluir" })).toHaveLength(2));
  });

  it("administrador real (pela Gestão de Tarefas, TarefaDetalhesDialog): vê Excluir", async () => {
    estado.usuario = ADMIN;
    estado.permissao = null;
    montar(<TarefaDetalhesDialog open onOpenChange={() => {}} tarefa={TAREFA} onSaved={() => {}} />);
    const dialogo = await abrirHistorico();
    await waitFor(() => expect(within(dialogo).getAllByRole("button", { name: "Excluir" })).toHaveLength(2));
  });

  it("excluir o mais recente: some na hora, cache do mapa corrigido e relido com force, e não volta na releitura", async () => {
    estado.usuario = ADMIN;
    detalhe();
    const dialogo = await abrirHistorico();
    await waitFor(() => expect(within(dialogo).getAllByRole("button", { name: "Excluir" })[0].disabled).toBe(false));
    await act(async () => {
      fireEvent.click(within(dialogo).getAllByRole("button", { name: "Excluir" })[0]);
    });
    await waitFor(() => expect(excluirHistorico).toHaveBeenCalledWith("h2"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Histórico da Tarefa (1)" })).toBeTruthy());
    expect(updateMapaCachedData).toHaveBeenCalledWith("historicoTarefa", EMP, expect.any(Function));
    expect(refreshMapaCacheEntry).toHaveBeenCalledWith("historicoTarefa", EMP, { force: true });
    expect(estado.aparelho.some((e) => e.id === "h2")).toBe(false);
    // A releitura do detalhe (invalidação) não traz o evento de volta.
    await act(async () => {});
    const atual = screen.getByRole("dialog", { name: "Histórico da Tarefa (1)" });
    expect(within(atual).queryByText("Começou a cerca.")).toBeNull();
    expect(within(atual).getByText("Tarefa criada pelo mapa.")).toBeTruthy();
    // O que sobrou é agora o mais recente: ligado.
    expect(within(atual).getAllByRole("button", { name: "Excluir" }).map((b) => b.disabled)).toEqual([false]);
    // "Últimos eventos" do detalhe também sem o excluído.
    const ultimos = screen.getByRole("list", { name: "Últimos eventos da tarefa", hidden: true });
    expect(within(ultimos).queryByText("Começou a cerca.")).toBeNull();
  });

  it("recusa do servidor: mensagem e o evento continua na lista", async () => {
    estado.usuario = ADMIN;
    excluirHistorico.mockRejectedValueOnce(new Error("Sem permissão para esta ação."));
    detalhe();
    const dialogo = await abrirHistorico();
    await waitFor(() => expect(within(dialogo).getAllByRole("button", { name: "Excluir" })[0].disabled).toBe(false));
    await act(async () => {
      fireEvent.click(within(dialogo).getAllByRole("button", { name: "Excluir" })[0]);
    });
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith("Sem permissão para esta ação."));
    expect(within(dialogo).getByText("Começou a cerca.")).toBeTruthy();
    expect(updateMapaCachedData).not.toHaveBeenCalled();
  });
});
