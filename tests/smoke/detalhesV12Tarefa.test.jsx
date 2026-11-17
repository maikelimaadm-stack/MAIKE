// @vitest-environment jsdom
/**
 * D-PROD-220 — detalhe da TAREFA aberto pelo mapa no desenho do Detalhes do
 * Lote v12 (`telaTarefa`): raiz `.mk-dp` filha do `.mk-ll` do diálogo, título
 * (a tarefa) e sub "Detalhes da tarefa" publicados no cabeçalho, seções na
 * ordem do v12 (cartão › Informações › Descrição › [Fotos] › Últimos eventos),
 * rodapé Editar · Registrar evento · Concluir. Concluir abre o MESMO "Registrar
 * evento" já em "Concluída" e grava pela mesma mutação; sem tipo permitido as
 * pílulas ficam desligadas. Os "Últimos eventos" buscam o histórico já na
 * primeira abertura (antes o `initialData: []` com `staleTime` não buscava).
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const atualizarTarefa = vi.fn();
const getMapaCachedData = vi.fn();
const refreshMapaCacheEntry = vi.fn();

vi.mock("@/services/tarefasMapaService", () => ({
  atualizarTarefa: (...a) => atualizarTarefa(...a),
  enviarAnexo: vi.fn(),
  excluirHistorico: vi.fn(),
  listarTodosGrupos: vi.fn(async () => []),
  listarTodosTipos: vi.fn(async () => []),
  listarUsuarios: vi.fn(async () => []),
  listarPermissoes: vi.fn(async () => []),
}));
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: (...a) => getMapaCachedData(...a),
  refreshMapaCacheEntry: (...a) => refreshMapaCacheEntry(...a),
}));
// O formulário de edição é o de hoje (não é desta peça): aqui um dublê que
// devolve os dados pelo mesmo `onSubmit`; o `normalizeTaskPriority` é o real.
vi.mock("@/components/mapa/FormularioTarefaMapa", async (importOriginal) => {
  const real = /** @type {any} */ (await importOriginal());
  return {
    ...real,
    default: ({ tarefa, onSubmit, onCancel }) => (
      <div data-testid="formulario-tarefa">
        <span>{tarefa?.titulo}</span>
        <button type="button" onClick={() => onSubmit({ ...tarefa, observacoes: "Levar alicate." })}>
          Salvar formulário
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar formulário
        </button>
      </div>
    ),
  };
});

import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import DetalhesTarefaMapa from "@/components/mapa/DetalhesTarefaMapa";
import TarefaDetalhesDialog from "@/components/tarefas/TarefaDetalhesDialog";

/** Largura da tela para os `matchMedia` (desktop 1280, tablet 820, celular 390). */
const largura = (w) => {
  window.matchMedia = /** @type {any} */ ((q) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || w >= Number(min[1])) && (!max || w <= Number(max[1]));
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  });
};
const original = window.matchMedia;

/** Tarefa do v12 ("Consertar cerca", em andamento) com o que o MAIKE tem a mais. */
const TAREFA = Object.freeze({
  id: "t1",
  empresa_id: "emp-1",
  titulo: "Consertar cerca",
  tipo: "Manutenção",
  tipo_tarefa_nome: "Manutenção de cerca",
  grupo_atividade_nome: "Cercas",
  status: "Em Andamento",
  prioridade: "Alta",
  area_nome: "Pasto 04",
  setor_nome: "Norte",
  solicitante: "Maike",
  responsavel_geral: "Maike",
  responsavel: "João",
  data_pedido: "2026-11-10",
  data_prevista: "2026-11-18",
  data_inicio: "2026-11-12T12:00:00.000Z",
  data_conclusao: null,
  descricao: "Três lances arrebentados na divisa 04/05.",
  observacoes: "Levar arame liso e grampos.",
  observacoes_conclusao: "",
  coordenadas: { lat: -15.0021014, lng: -59.9547631 },
});

const EVENTOS = [
  { id: "ht-1", empresa_id: "emp-1", tarefa_id: "t1", evento: "Registro", descricao: "Tarefa criada pelo mapa.", data_evento: "2026-11-10T12:00:00.000Z" },
  { id: "ht-x", empresa_id: "emp-1", tarefa_id: "outra", evento: "Registro", descricao: "Outra tarefa.", data_evento: "2026-11-13T12:00:00.000Z" },
  { id: "ht-2", empresa_id: "emp-1", tarefa_id: "t1", evento: "Mudança de Status", descricao: "Pendente → Em andamento", data_evento: "2026-11-12T12:00:00.000Z" },
];

let qc;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  // Sem cópia no aparelho: o histórico vem da atualização do cache (sem atualização solta depois).
  getMapaCachedData.mockResolvedValue([]);
  refreshMapaCacheEntry.mockResolvedValue(EVENTOS);
  atualizarTarefa.mockImplementation(async (id, dados) => ({ ...TAREFA, ...dados, id }));
});
afterEach(() => {
  cleanup();
  window.matchMedia = original;
});

/** Monta como o MapaGeral monta: diálogo largo, só leitura, popup a partir do tablet. */
const noDialogo = (props = {}) =>
  render(
    <QueryClientProvider client={qc}>
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Detalhes da tarefa" largo somenteLeitura popupDesde="tablet">
        <DetalhesTarefaMapa tarefa={TAREFA} hoje="2026-11-15" {...props} />
      </LancLoteDialogo>
    </QueryClientProvider>,
  );

const titulosDasSecoes = () => [...document.querySelectorAll(".mk-dp__corpo .mk-dp-titulo__h")].map((h) => h.textContent);
/** `dd` do valor de uma célula da grade pelo rótulo (`dt`). */
const valorDaCelula = (rotulo) => {
  const dt = [...document.querySelectorAll(".mk-dp-cel__rot")].find((d) => d.textContent === rotulo);
  return dt ? /** @type {HTMLElement} */ (dt.nextElementSibling) : null;
};
const pilula = (nome) => /** @type {HTMLButtonElement} */ (within(screen.getByRole("group", { name: "Ações da tarefa" })).getByRole("button", { name: nome }));
const esperarEventos = () => screen.findByRole("list", { name: "Últimos eventos da tarefa" });

describe("Detalhe da tarefa v12 no diálogo", () => {
  it("raiz .mk-dp filha do .mk-ll; título e sub no cabeçalho; seções na ordem do v12", async () => {
    largura(1280);
    noDialogo();
    const raiz = document.querySelector(".mk-ll > .mk-dp");
    expect(raiz).toBeTruthy();
    expect(raiz?.getAttribute("data-modo")).toBe("desktop");
    expect(document.querySelector(".mk-ll-dlg__titulo")?.textContent).toBe("Consertar cerca");
    expect(document.querySelector(".mk-ll-dlg__lotes")?.textContent).toBe("Detalhes da tarefa");
    // Sem o cabeçalho antigo ("Tarefa: X") nem as classes da D-PROD-118 dentro do corpo.
    expect(document.querySelector(".mk-dp-cab")).toBeNull();
    expect(document.querySelector("[class*='mk-tar__']")).toBeNull();
    expect(screen.queryByText(/^Tarefa: /)).toBeNull();
    await esperarEventos();
    expect(titulosDasSecoes()).toEqual(["Informações da tarefa", "Descrição", "Últimos eventos"]);
  });

  it("cartão da tarefa: ícone, título, tipo base · local e o chip do status com a classe do v12", async () => {
    largura(820);
    const { unmount } = noDialogo();
    const cartao = /** @type {HTMLElement} */ (document.querySelector(".mk-dp__corpo > .mk-dp-cartao"));
    expect(cartao.querySelector("svg.mk-dp-cartao__ic.lucide-clipboard-list")).toBeTruthy();
    expect(cartao.querySelector(".mk-dp-cartao__titulo")?.textContent).toBe("Consertar cerca");
    expect(cartao.querySelector(".mk-dp-cartao__sub")?.textContent).toBe("Manutenção · Pasto 04");
    const chip = cartao.querySelector(".mk-dp-chip");
    expect(chip?.textContent).toBe("Em Andamento");
    expect(chip?.className).toContain("mk-dp-tarefa__status--andamento");
    await esperarEventos();
    unmount();
    // Sem tipo base, o tipo de tarefa; status das outras cores.
    for (const [status, classe] of [["Pendente", "pendente"], ["Concluída", "concluida"], ["Cancelada", "cancelada"]]) {
      const r = noDialogo({ tarefa: { ...TAREFA, tipo: "", status } });
      expect(document.querySelector(".mk-dp-cartao__sub")?.textContent).toBe("Manutenção de cerca · Pasto 04");
      expect(document.querySelector(".mk-dp-cartao .mk-dp-chip")?.className).toContain(`mk-dp-tarefa__status--${classe}`);
      await esperarEventos();
      r.unmount();
    }
  });

  it("datas de dia no fuso do Brasil: o dia gravado, sem voltar um dia (D-PROD-220)", async () => {
    // Antes, new Date("2026-11-10") virava 09/11 em fusos a oeste de UTC.
    vi.stubEnv("TZ", "America/Cuiaba");
    largura(1280);
    noDialogo();
    expect(valorDaCelula("Data do pedido")?.textContent).toBe("10/11/2026");
    expect(valorDaCelula("Prazo")?.textContent).toBe("18/11/2026");
    expect(valorDaCelula("Data de início")?.textContent).toBe("12/11/2026");
  });

  it("Informações da tarefa: a grade do v12 com os mesmos dados de hoje e o que o MAIKE tem a mais", async () => {
    largura(1280);
    noDialogo();
    const prioridade = valorDaCelula("Prioridade");
    expect(prioridade?.textContent).toBe("ALTA");
    expect(/** @type {HTMLElement} */ (prioridade?.querySelector(".mk-dp-bolinha")).style.background).toBe("rgb(245, 158, 11)");
    expect(valorDaCelula("Tipo de tarefa")?.textContent).toBe("Manutenção de cerca");
    expect(valorDaCelula("Grupo")?.textContent).toBe("Cercas");
    expect(valorDaCelula("Área/Local")?.textContent).toBe("Pasto 04 · Norte");
    expect(valorDaCelula("Solicitante / Responsável")?.textContent).toBe("Maike / João");
    expect(valorDaCelula("Data do pedido")?.textContent).toBe("10/11/2026");
    expect(valorDaCelula("Prazo")?.textContent).toBe("18/11/2026");
    expect(valorDaCelula("Prazo")?.style.color).toBe("");
    expect(valorDaCelula("Data de início")?.textContent).toBe("12/11/2026");
    expect(valorDaCelula("Data de conclusão")?.textContent).toBe("—");
    expect(valorDaCelula("Tipo base")?.textContent).toBe("Manutenção");
    expect(valorDaCelula("Coordenadas")?.textContent).toBe("-15.002101, -59.954763");
    // Ordem do v12; os dois a mais no fim.
    expect([...document.querySelectorAll(".mk-dp-cel__rot")].map((d) => d.textContent)).toEqual([
      "Prioridade",
      "Tipo de tarefa",
      "Grupo",
      "Área/Local",
      "Solicitante / Responsável",
      "Data do pedido",
      "Prazo",
      "Data de início",
      "Data de conclusão",
      "Tipo base",
      "Coordenadas",
    ]);
    await esperarEventos();
  });

  it("prazo vencido em vermelho (com o aviso para o leitor de tela) só com a tarefa em aberto", async () => {
    largura(1280);
    const { unmount } = noDialogo({ hoje: "2026-11-19" });
    expect(valorDaCelula("Prazo")?.style.color).toBe("rgb(185, 28, 28)");
    expect(valorDaCelula("Prazo")?.textContent).toBe("18/11/2026 (vencido)");
    await esperarEventos();
    unmount();
    // Vence hoje: ainda não é atraso.
    const r2 = noDialogo({ hoje: "2026-11-18" });
    expect(valorDaCelula("Prazo")?.style.color).toBe("");
    await esperarEventos();
    r2.unmount();
    noDialogo({ hoje: "2026-11-19", tarefa: { ...TAREFA, status: "Concluída", data_conclusao: "2026-11-19" } });
    expect(valorDaCelula("Prazo")?.style.color).toBe("");
    expect(valorDaCelula("Prazo")?.textContent).toBe("18/11/2026");
    expect(valorDaCelula("Data de conclusão")?.textContent).toBe("19/11/2026");
    await esperarEventos();
  });

  it("sem `hoje`, o prazo usa o dia do aparelho", async () => {
    largura(1280);
    noDialogo({ hoje: null, tarefa: { ...TAREFA, data_prevista: "2000-01-01" } });
    expect(valorDaCelula("Prazo")?.style.color).toBe("rgb(185, 28, 28)");
    await esperarEventos();
  });

  it("sem os dados a mais: Tipo base e Coordenadas saem; nomes de reserva e '—'", async () => {
    largura(390);
    noDialogo({
      tarefa: { ...TAREFA, tipo_tarefa_nome: "", solicitante: "", responsavel_geral: "Ana", responsavel: "", area_nome: "", lote_nome: "L-2026-008", setor_nome: "", coordenadas: null, prioridade: "Média", grupo_atividade_nome: "" },
    });
    expect(document.querySelector(".mk-dp")?.getAttribute("data-modo")).toBe("celular");
    expect(valorDaCelula("Tipo de tarefa")?.textContent).toBe("Manutenção");
    expect(valorDaCelula("Tipo base")).toBeNull();
    expect(valorDaCelula("Coordenadas")).toBeNull();
    expect(valorDaCelula("Solicitante / Responsável")?.textContent).toBe("Ana / —");
    expect(valorDaCelula("Área/Local")?.textContent).toBe("L-2026-008");
    expect(valorDaCelula("Grupo")?.textContent).toBe("—");
    expect(valorDaCelula("Prioridade")?.textContent).toBe("MÉDIA");
    expect(document.querySelector(".mk-dp-cartao__sub")?.textContent).toBe("Manutenção · L-2026-008");
    await esperarEventos();
  });

  it("Descrição: a descrição, Observações e Obs. conclusão (só quando houver)", async () => {
    largura(1280);
    const { unmount } = noDialogo();
    const textos = /** @type {HTMLElement} */ (document.querySelector(".mk-dp-tarefa__textos"));
    const linhas = [...textos.querySelectorAll(".mk-dp-linha")].map((l) => [l.querySelector(".mk-dp-linha__rot")?.textContent, l.querySelector(".mk-dp-linha__val")?.textContent ?? null]);
    expect(linhas).toEqual([
      ["Três lances arrebentados na divisa 04/05.", null],
      ["Observações", "Levar arame liso e grampos."],
    ]);
    await esperarEventos();
    unmount();
    noDialogo({ tarefa: { ...TAREFA, descricao: "", observacoes: "", observacoes_conclusao: "Feito com arame novo." } });
    const outras = [...document.querySelectorAll(".mk-dp-tarefa__textos .mk-dp-linha")].map((l) => [l.querySelector(".mk-dp-linha__rot")?.textContent, l.querySelector(".mk-dp-linha__val")?.textContent ?? null]);
    expect(outras).toEqual([
      ["Sem descrição.", null],
      ["Observações", "—"],
      ["Obs. conclusão", "Feito com arame novo."],
    ]);
    expect(document.querySelector(".mk-dp-tarefa__descricao")?.className).toContain("mk-dp-tarefa__fraco");
    await esperarEventos();
  });

  it("Fotos: título e a galeria de hoje só com foto (fotos + anexos legados), antes dos Últimos eventos", async () => {
    largura(1280);
    noDialogo({ tarefa: { ...TAREFA, fotos: ["/f1.jpg"], anexos_urls: ["/f2.jpg"] } });
    await esperarEventos();
    expect(titulosDasSecoes()).toEqual(["Informações da tarefa", "Descrição", "Fotos", "Últimos eventos"]);
    const fotos = /** @type {HTMLElement} */ (document.querySelector(".mk-dp-tarefa__fotos"));
    expect(within(fotos).getByAltText("Foto 1").getAttribute("src")).toBe("/f1.jpg");
    expect(within(fotos).getByAltText("Foto 2").getAttribute("src")).toBe("/f2.jpg");
  });
});

describe("Últimos eventos", () => {
  it("busca o histórico na primeira abertura: linha do tempo por dia, só desta tarefa, o mais recente primeiro", async () => {
    largura(1280);
    noDialogo();
    const lista = await esperarEventos();
    expect(getMapaCachedData).toHaveBeenCalledWith("historicoTarefa", "emp-1");
    expect([...lista.querySelectorAll(".mk-dp-tl__dia")].map((d) => d.textContent)).toEqual(["12 NOV. 2026", "10 NOV. 2026"]);
    const cartoes = [...lista.querySelectorAll(".mk-dp-tl__card")];
    expect(cartoes.map((c) => c.querySelector(".mk-dp-tl__titulo")?.textContent)).toEqual(["Mudança de Status", "Registro"]);
    expect(cartoes[0].querySelector("svg.lucide-repeat")).toBeTruthy();
    expect(cartoes[1].querySelector("svg.lucide-file-text")).toBeTruthy();
    expect([...cartoes[0].querySelectorAll(".mk-dp-tl__row")].map((r) => [r.querySelector("dt")?.textContent, r.querySelector("dd")?.textContent])).toEqual([
      ["Detalhe", "Pendente → Em andamento"],
    ]);
    expect(screen.queryByText("Outra tarefa.")).toBeNull();
  });

  it("mostra os 5 mais recentes (mesmo dia num grupo só) e o ícone de cada evento", async () => {
    largura(1280);
    const ev = (id, evento, dia, hora = "12") => ({ id, tarefa_id: "t1", evento, descricao: `${evento} ${id}`, data_evento: `${dia}T${hora}:00:00.000Z` });
    refreshMapaCacheEntry.mockResolvedValue([
      ev("e1", "Criação", "2026-11-01"),
      ev("e2", "Edição", "2026-11-02"),
      ev("e3", "Mudança de Local", "2026-11-03"),
      ev("e4", "Comentário", "2026-11-04", "10"),
      ev("e5", "Cancelamento", "2026-11-04", "14"),
      ev("e6", "Conclusão", "2026-11-05"),
      ev("e7", "Outro nome", "2026-11-06"),
    ]);
    noDialogo();
    const lista = await esperarEventos();
    expect([...lista.querySelectorAll(".mk-dp-tl__dia")].map((d) => d.textContent)).toEqual(["06 NOV. 2026", "05 NOV. 2026", "04 NOV. 2026", "03 NOV. 2026"]);
    const cartoes = [...lista.querySelectorAll(".mk-dp-tl__card")];
    expect(cartoes.map((c) => c.querySelector(".mk-dp-tl__titulo")?.textContent)).toEqual(["Outro nome", "Conclusão", "Cancelamento", "Comentário", "Mudança de Local"]);
    expect(cartoes.map((c) => c.querySelector("svg.mk-dp-tl__ic")?.getAttribute("class")?.match(/lucide-([a-z-]+)/)?.[1])).toEqual([
      "history",
      "check",
      "circle-x",
      "message-square",
      "map-pin",
    ]);
  });

  it("ícone de cada evento que o servidor grava", async () => {
    largura(1280);
    const nomes = ["Criação", "Edição", "Mudança de Local", "Mudança de Status", "Registro", "Conclusão", "Cancelamento", "Comentário"];
    const esperado = ["plus", "square-pen", "map-pin", "repeat", "file-text", "check", "circle-x", "message-square"];
    /** @type {string[]} */
    const vistos = [];
    // Dois grupos de 4 (o corpo mostra até 5), do mais antigo ao mais novo na lista.
    for (const grupo of [nomes.slice(0, 4), nomes.slice(4)]) {
      qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      refreshMapaCacheEntry.mockResolvedValue(grupo.map((evento, i) => ({ id: `i${i}`, tarefa_id: "t1", evento, descricao: evento, data_evento: `2026-11-0${9 - i}T12:00:00.000Z` })));
      const { unmount } = noDialogo();
      const lista = await esperarEventos();
      for (const c of lista.querySelectorAll(".mk-dp-tl__card")) vistos.push(c.querySelector("svg.mk-dp-tl__ic")?.getAttribute("class")?.match(/lucide-([a-z-]+)/)?.[1] ?? "");
      unmount();
    }
    expect(vistos).toEqual(esperado);
  });

  it("carregando e vazio", async () => {
    largura(1280);
    refreshMapaCacheEntry.mockReturnValue(new Promise(() => {}));
    const { unmount } = noDialogo();
    expect((await screen.findByRole("status")).textContent).toBe("Carregando histórico...");
    unmount();
    // Cliente novo: no anterior a busca ficou pendurada (é o "carregando" acima).
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    refreshMapaCacheEntry.mockResolvedValue([]);
    noDialogo();
    expect(await screen.findByText("Nenhum evento registrado.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Últimos eventos da tarefa" })).toBeNull();
  });

  it("erro sem cópia no aparelho: o aviso do histórico, sem a linha do tempo", async () => {
    largura(1280);
    getMapaCachedData.mockResolvedValue([]);
    refreshMapaCacheEntry.mockRejectedValue(new Error("falha de rede"));
    noDialogo();
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("Não foi possível carregar o histórico.");
    expect(screen.queryByRole("list", { name: "Últimos eventos da tarefa" })).toBeNull();
  });

  it("'Ver histórico' abre o Histórico da tarefa de hoje com o histórico inteiro", async () => {
    largura(1280);
    noDialogo();
    await esperarEventos();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ver histórico" }));
    });
    const dialogo = await screen.findByRole("dialog", { name: "Histórico da Tarefa (2)" });
    expect(within(dialogo).getByText("Tarefa criada pelo mapa.")).toBeTruthy();
    expect(within(dialogo).getByText("Pendente → Em andamento")).toBeTruthy();
  });
});

describe("Rodapé: Editar · Registrar evento · Concluir", () => {
  it("as três pílulas; em andamento todas ligadas e 'Registrar evento' abre em Registro", async () => {
    largura(1280);
    noDialogo();
    await esperarEventos();
    const grupo = screen.getByRole("group", { name: "Ações da tarefa" });
    expect(within(grupo).getAllByRole("button").map((b) => b.textContent)).toEqual(["Editar", "Registrar evento", "Concluir"]);
    expect(grupo.querySelector("svg.lucide-square-pen")).toBeTruthy();
    expect(grupo.querySelector("svg.lucide-message-square-plus")).toBeTruthy();
    expect(grupo.querySelector("svg.lucide-check")).toBeTruthy();
    for (const nome of ["Editar", "Registrar evento", "Concluir"]) expect(pilula(nome).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(pilula("Registrar evento"));
    });
    const dialogo = await screen.findByRole("dialog", { name: "Registrar evento" });
    expect(within(dialogo).getByRole("radio", { name: "Registro" }).getAttribute("aria-checked")).toBe("true");
    expect(within(dialogo).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Registro", "Cancelada", "Concluída"]);
  });

  it("pendente sem início: o evento padrão é 'Em andamento'; Concluir ligado", async () => {
    largura(1280);
    noDialogo({ tarefa: { ...TAREFA, status: "Pendente", data_inicio: null } });
    await esperarEventos();
    expect(pilula("Concluir").disabled).toBe(false);
    await act(async () => {
      fireEvent.click(pilula("Registrar evento"));
    });
    const dialogo = await screen.findByRole("dialog", { name: "Registrar evento" });
    expect(within(dialogo).getByRole("radio", { name: "Em andamento" }).getAttribute("aria-checked")).toBe("true");
  });

  it("concluída ou cancelada: Concluir e Registrar evento desligados (nenhum tipo permitido); Editar ligado", async () => {
    largura(1280);
    for (const status of ["Concluída", "Cancelada"]) {
      const { unmount } = noDialogo({ tarefa: { ...TAREFA, status } });
      await esperarEventos();
      expect(pilula("Concluir").disabled).toBe(true);
      expect(pilula("Registrar evento").disabled).toBe(true);
      expect(pilula("Editar").disabled).toBe(false);
      expect(pilula("Concluir").title).toBe(status === "Concluída" ? "A tarefa já está concluída." : "A tarefa está cancelada.");
      unmount();
    }
  });

  it("Concluir abre o MESMO 'Registrar evento' já em Concluída e grava pela mesma mutação (Conclusão)", async () => {
    largura(1280);
    const onSaved = vi.fn();
    noDialogo({ onSaved });
    await esperarEventos();
    await act(async () => {
      fireEvent.click(pilula("Concluir"));
    });
    const dialogo = await screen.findByRole("dialog", { name: "Registrar evento" });
    expect(within(dialogo).getByRole("radio", { name: "Concluída" }).getAttribute("aria-checked")).toBe("true");
    expect(atualizarTarefa).not.toHaveBeenCalled();
    fireEvent.change(within(dialogo).getByPlaceholderText("Ex: foi fazer o serviço e quebrou o trator"), { target: { value: "Cerca refeita." } });
    // Depois de salvar, o histórico é invalidado e relido: já com a conclusão.
    refreshMapaCacheEntry.mockResolvedValue([
      { id: "ht-3", tarefa_id: "t1", evento: "Conclusão", descricao: "Cerca refeita.", data_evento: "2026-11-15T12:00:00.000Z" },
      ...EVENTOS,
    ]);
    await act(async () => {
      fireEvent.submit(/** @type {HTMLFormElement} */ (dialogo.querySelector("form")));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(atualizarTarefa).toHaveBeenCalledTimes(1);
    const [id, dados] = atualizarTarefa.mock.calls[0];
    expect(id).toBe("t1");
    expect(dados).toMatchObject({
      status: "Concluída",
      observacoes_conclusao: "Cerca refeita.",
      historico_evento: "Conclusão",
      historico_descricao: "Cerca refeita.",
    });
    expect(dados.data_conclusao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A tela já mostra a tarefa concluída: chip, pílulas e o evento novo na linha do tempo.
    await waitFor(() => expect(document.querySelector(".mk-dp-cartao .mk-dp-chip")?.textContent).toBe("Concluída"));
    expect(document.querySelector(".mk-dp-cartao .mk-dp-chip")?.className).toContain("mk-dp-tarefa__status--concluida");
    expect(pilula("Concluir").disabled).toBe(true);
    await waitFor(() => expect(screen.getByRole("list", { name: "Últimos eventos da tarefa" }).querySelector(".mk-dp-tl__titulo")?.textContent).toBe("Conclusão"));
    expect(screen.queryByRole("dialog", { name: "Registrar evento" })).toBeNull();
  });

  it("Editar abre o 'Editar tarefa' com o formulário de hoje e salva como Edição", async () => {
    largura(1280);
    const onSaved = vi.fn();
    noDialogo({ onSaved });
    await esperarEventos();
    await act(async () => {
      fireEvent.click(pilula("Editar"));
    });
    const dialogo = await screen.findByRole("dialog", { name: "Editar tarefa" });
    expect(within(dialogo).getByTestId("formulario-tarefa").textContent).toContain("Consertar cerca");
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar formulário" }));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(atualizarTarefa.mock.calls[0][1]).toMatchObject({ observacoes: "Levar alicate.", prioridade: "Alta", historico_evento: "Edição" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar tarefa" })).toBeNull());
    // A releitura do histórico (invalidado) termina dentro do teste.
    await waitFor(() => expect(refreshMapaCacheEntry).toHaveBeenCalledTimes(2));
    await esperarEventos();
  });
});

describe("Outras aberturas e CSS", () => {
  it("pela Gestão de Tarefas (TarefaDetalhesDialog): o mesmo detalhe v12 no diálogo padrão", async () => {
    largura(1280);
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <TarefaDetalhesDialog open onOpenChange={() => {}} tarefa={TAREFA} onSaved={onSaved} />
      </QueryClientProvider>,
    );
    expect(document.querySelector(".mk-ll-dlg.is-desktop > .mk-ll > .mk-dp")).toBeTruthy();
    expect(document.querySelector(".mk-ll-dlg__titulo")?.textContent).toBe("Consertar cerca");
    expect(document.querySelector(".mk-ll-dlg__lotes")?.textContent).toBe("Detalhes da tarefa");
    expect(within(screen.getByRole("group", { name: "Ações da tarefa" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Editar", "Registrar evento", "Concluir"]);
    await esperarEventos();
  });

  it("fora do diálogo, a casca desenha o cabeçalho próprio (título e sub)", async () => {
    largura(390);
    render(
      <QueryClientProvider client={qc}>
        <DetalhesTarefaMapa tarefa={TAREFA} hoje="2026-11-15" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Consertar cerca" })).toBeTruthy();
    expect(document.querySelector(".mk-dp-cab__sub")?.textContent).toBe("Detalhes da tarefa");
    await esperarEventos();
  });

  it("o chip do status tem as cores do v12 no CSS da peça, sob .mk-dp", () => {
    const css = readFileSync("src/styles/mk-dp-tarefa.css", "utf8");
    const cores = {
      pendente: ["#fef3c7", "#92400e"],
      andamento: ["#dbeafe", "#1d4ed8"],
      concluida: ["#dcfce7", "#166534"],
      cancelada: ["#f3f4f6", "#6b7280"],
    };
    for (const [nome, [fundo, texto]] of Object.entries(cores)) {
      const regra = new RegExp(`\\.mk-dp \\.mk-dp-chip\\.mk-dp-tarefa__status--${nome} \\{\\s*background: ${fundo};\\s*color: ${texto};\\s*\\}`);
      expect(css, nome).toMatch(regra);
    }
    // Nada fora da raiz `.mk-dp`.
    const seletores = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/^[^\s{}][^{}]*(?=\{)/gm) || [];
    expect(seletores.length).toBeGreaterThan(0);
    // Vírgula fora de parênteses separa seletores (a de dentro do `:is(…)` não).
    for (const s of seletores) for (const parte of s.split(/,(?![^(]*\))/)) expect(parte.trim().startsWith(".mk-dp "), parte).toBe(true);
  });
});
