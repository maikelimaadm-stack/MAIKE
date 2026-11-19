/**
 * Listas dentro da `B1Janela` no celular (< 640 px): a folha de baixo nasce DENTRO da janela.
 *
 * 1) Ações em lote das áreas — "Definir setor".
 *
 * O `B1Select` do setor abre uma folha de baixo (`MobileSheet`). Sem o alvo das folhas
 * (`MobileSheetPortalCtx`), a folha nascia no `document.body`, fora da `B1Janela` (Radix
 * Dialog modal): a janela ficava por cima e engolia o toque — as opções não podiam ser
 * escolhidas. A janela agora entrega o alvo (`fora`) e, com a folha aberta, um pedido de
 * fechar fecha só a folha (`aoPedirFechar`).
 *
 *  AL1. a folha do setor nasce DENTRO do diálogo, fora de `aria-hidden` e sem
 *       `pointer-events: none` herdado;
 *  AL2. tocar na opção escolhe o setor: a folha fecha e o diálogo continua aberto;
 *  AL3. Escape com a folha aberta fecha só a folha (o diálogo continua aberto).
 *
 * 2) `DialogoAcao` em modo `janelaBase1` (ex.: "Adicionar área" / "Iniciar área" da atividade,
 *    `DialogoAreaDaAtividade`): o `CampoSelect` do `conteudo` tinha o mesmo defeito.
 *
 *  DA1. a folha nasce dentro da janela, com toque; tocar na opção escolhe;
 *  DA2. Escape com a folha aberta fecha só a folha.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/mapaService", () => ({
  atualizarArea: vi.fn(async () => ({})),
  renumerarAreas: vi.fn(async () => ({})),
}));

const { default: AcoesEmLoteAreas } = await import("@/components/mapa/cadastro/AcoesEmLoteAreas");
const { DialogoAcao } = await import("@/components/financeiroGestao/DialogosLancamento");
const { CampoSelect } = await import("@/components/gestao/GestaoFormParts");

const SETORES = [
  { id: "s1", nome: "RETIRO NORTE" },
  { id: "s2", nome: "RETIRO SUL" },
];
const AREAS = [{ id: "a1", nome: "PASTO 1", coordenadas: { coords: [] } }];

/** @type {any} */
let matchMediaOriginal;
beforeEach(() => {
  matchMediaOriginal = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: /max-width:\s*639px/.test(q),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
});
afterEach(() => {
  cleanup();
  window.matchMedia = matchMediaOriginal;
});

/** Toque real: pointerdown, pointerup e click em tarefas separadas. @param {Element} el */
const tocar = async (el) => {
  await act(async () => {
    fireEvent.pointerDown(el);
  });
  await act(async () => {
    fireEvent.pointerUp(el);
  });
  await act(async () => {
    fireEvent.click(el);
  });
};
/** A camada mais próxima com `pointer-events` explícito não pode desligar o toque. @param {Element|null} el */
const peHerdado = (el) => {
  for (let n = /** @type {any} */ (el); n; n = n.parentElement) {
    if (n.style?.pointerEvents) return n.style.pointerEvents;
  }
  return "";
};

const montar = () => {
  const onFechar = vi.fn();
  render(<AcoesEmLoteAreas acao="setor" areas={AREAS} setores={SETORES} onFechar={onFechar} onAplicado={() => {}} />);
  return { onFechar, dialogo: screen.getByTestId("areas-acao-em-lote") };
};

describe("AcoesEmLoteAreas — folha do setor no celular", () => {
  it("AL1/AL2: a folha nasce dentro do diálogo, com toque; tocar na opção escolhe o setor", async () => {
    const { onFechar, dialogo } = montar();
    await tocar(within(dialogo).getByRole("combobox", { name: "Setor" }));
    const opcao = await screen.findByRole("option", { name: "RETIRO SUL", hidden: true });
    const folha = opcao.closest(".mk-sheet-root");
    expect(folha).toBeTruthy();
    expect(dialogo.contains(folha)).toBe(true);
    expect(opcao.closest('[aria-hidden="true"]')).toBeNull();
    expect(peHerdado(opcao)).not.toBe("none");

    await tocar(opcao);
    await waitFor(() => expect(document.querySelector(".mk-sheet-root")).toBeNull());
    expect(within(dialogo).getByRole("combobox", { name: "Setor" })).toHaveTextContent("RETIRO SUL");
    expect(onFechar).not.toHaveBeenCalled();
    expect(dialogo.isConnected).toBe(true);
  });

  it("AL3: Escape com a folha aberta fecha só a folha; o diálogo continua aberto", async () => {
    const { onFechar, dialogo } = montar();
    await tocar(within(dialogo).getByRole("combobox", { name: "Setor" }));
    await screen.findByRole("option", { name: "RETIRO NORTE", hidden: true });
    await act(async () => {
      fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("option", { name: "RETIRO NORTE", hidden: true })).toBeNull());
    expect(onFechar).not.toHaveBeenCalled();
    expect(screen.getByTestId("areas-acao-em-lote")).toBeTruthy();
  });
});

/** O `DialogoAcao` em janela Base1 com uma lista no conteúdo (o formato do `DialogoAreaDaAtividade`). */
function DialogoComLista({ onFechar }) {
  const [areaId, setAreaId] = React.useState("");
  return (
    <DialogoAcao
      aberto
      titulo="Adicionar área"
      descricao=""
      janelaBase1
      rotuloBotao="Adicionar área"
      testId="dialogo-area-adicionar"
      comMotivo={false}
      perigo={false}
      contexto={{ locale: "pt-BR", moeda: "BRL", casas: 2 }}
      onFechar={onFechar}
      onEnviar={async () => ({})}
      conteudo={
        <CampoSelect
          label="Área"
          value={areaId}
          onChange={setAreaId}
          options={[
            { value: "a1", label: "PASTO 1" },
            { value: "a2", label: "PASTO 2" },
          ]}
          required
          span={6}
        />
      }
    />
  );
}

describe("DialogoAcao (janela Base1) — lista do conteúdo no celular", () => {
  const montarDialogo = () => {
    const onFechar = vi.fn();
    render(<DialogoComLista onFechar={onFechar} />);
    return { onFechar, dialogo: screen.getByTestId("dialogo-area-adicionar") };
  };

  it("DA1: a folha nasce dentro da janela, com toque; tocar na opção escolhe", async () => {
    const { onFechar, dialogo } = montarDialogo();
    await tocar(within(dialogo).getByRole("combobox", { name: /Área/ }));
    const opcao = await screen.findByRole("option", { name: "PASTO 2", hidden: true });
    const folha = opcao.closest(".mk-sheet-root");
    expect(folha).toBeTruthy();
    expect(dialogo.contains(folha)).toBe(true);
    expect(opcao.closest('[aria-hidden="true"]')).toBeNull();
    expect(peHerdado(opcao)).not.toBe("none");

    await tocar(opcao);
    await waitFor(() => expect(document.querySelector(".mk-sheet-root")).toBeNull());
    expect(within(dialogo).getByRole("combobox", { name: /Área/ })).toHaveTextContent("PASTO 2");
    expect(onFechar).not.toHaveBeenCalled();
  });

  it("DA2: Escape com a folha aberta fecha só a folha", async () => {
    const { onFechar, dialogo } = montarDialogo();
    await tocar(within(dialogo).getByRole("combobox", { name: /Área/ }));
    await screen.findByRole("option", { name: "PASTO 1", hidden: true });
    await act(async () => {
      fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("option", { name: "PASTO 1", hidden: true })).toBeNull());
    expect(onFechar).not.toHaveBeenCalled();
    expect(screen.getByTestId("dialogo-area-adicionar")).toBeTruthy();
  });
});
