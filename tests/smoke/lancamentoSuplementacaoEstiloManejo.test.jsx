// @vitest-environment jsdom
/**
 * D-PROD-222 — o "Lançar" do cocho no MESMO desenho do lançamento de manejo do
 * lote (Registrar Pesagem, Morte, Mover…). Montado pelo rodapé do cocho no pasto
 * (`AcoesCochoPasto`) com o `FormularioLancamentoSuplementacao` REAL; só a rede é
 * de mentira. As regras (D-PROD-137, 201, 203, 206, 210) continuam provadas em
 * suplementacaoLancamentoBase, sobraHerdadaSemFalsoSucesso e companhia; aqui:
 *
 *  LM-1. abre num `LancLoteDialogo` largo: título = a ação, subtítulo = o cocho;
 *        popup no desktop com ✕/✓ no cabeçalho; nada do desenho antigo (cartão
 *        com faixa de título, botões no pé, Select com <select> escondido);
 *  LM-2. no celular, tela cheia: ✕ à esquerda, título no meio, ✓ à direita;
 *  LM-3. cada campo é um `LancField` (rótulo dentro da caixa, * no obrigatório,
 *        o rótulo aponta para o controle);
 *  LM-4. o ✓ do cabeçalho envia: a mesma baixa e o mesmo evento de antes; salvo,
 *        fecha e faz o refresh de hoje (consultas do cocho e `atualizar-mapa`);
 *  LM-5. salvando: ✓ girando com "Registrando...", ✕ desabilitado, o Esc da
 *        tela cheia não fecha, campos travados e o passo no topo;
 *  LM-6. produto em sacos: a unidade é um `LancLoteSegmento`; os sacos viram kg
 *        na gravação como antes;
 *  LM-7. avisos e informações em `LancLoteAviso`, no tom de cada um;
 *  LM-8. consumo por lote: um `LancLoteItem` por lote, atrás do Ver/Ocultar;
 *  LM-9. sobra herdada: o diálogo de confirmação abre por cima, aproveitar a sobra
 *        preenche o campo e o foco volta ao lançamento.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toast = vi.hoisted(() => Object.assign(() => {}, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal()), toast }));

const PRODUTO = { id: "prod-1", empresa_id: "emp-1", nome_produto: "SAL MINERAL", tipo_uso: "Nutrição Animal", unidade_principal_estoque: "KG" };
const FORMULACAO = { id: "f-1", nome: "SAL MINERAL 80", tipo: "PRONTO", produto_id: "prod-1", produto_nome: "SAL MINERAL", produto_ativo: true, percentual_pv_padrao: 0.1, consumo_objetivo_g_cab_dia: null, regras: [] };
const DEPOSITO = { id: "dep-1", empresa_id: "emp-1", nome_ponto: "DEPÓSITO", categoria_ponto: "DEPOSITO", local_estoque_id: "loc-1", local_estoque_nome: "ARMAZÉM" };
const PONTO = { id: "p1", empresa_id: "emp-1", nome_ponto: "COCHO 1", categoria_ponto: "COCHO", area_vinculada_ids: ["area-a"], deposito_origem_id: "dep-1", produto_padrao: "SAL MINERAL" };
const SALDO = { id: "ln-1", empresa_id: "emp-1", produto_id: "prod-1", local_estoque_id: "loc-1", quantidade_disponivel: 5000, status: "Disponivel", data_documento: "2026-01-05" };

const estado = vi.hoisted(() => ({
  ponto: /** @type {any} */ (null),
  rebanho: /** @type {any[]} */ ([]),
  formulacoes: /** @type {any[]} */ ([]),
  produtos: /** @type {any[]} */ ([]),
  lotesNota: /** @type {any[]} */ ([]),
  ultimoEvento: /** @type {any} */ (null),
}));
const saida = vi.hoisted(() => vi.fn());
const lancar = vi.hoisted(() => vi.fn());
const fechar = vi.hoisted(() => vi.fn());

vi.mock("@/services/suplementacaoService", async (importOriginal) => ({
  ...(await importOriginal()),
  carregarPontoAtualizado: vi.fn(async () => estado.ponto),
  listarPontosDaEmpresa: vi.fn(async () => [estado.ponto, DEPOSITO]),
  listarAreasDaEmpresa: vi.fn(async () => [{ id: "area-a", nome: "PASTO A", ativo: true }]),
  listarRebanhoParaSuplementacao: vi.fn(async () => estado.rebanho),
  listarProdutosDaEmpresa: vi.fn(async () => estado.produtos),
  listarFormulacoesParaLancamento: vi.fn(async () => estado.formulacoes),
  listarLotesNotaDaEmpresa: vi.fn(async () => estado.lotesNota),
  listarMovimentacoesPecuariasDaEmpresa: vi.fn(async () => []),
  listarEventosDoPonto: vi.fn(async () => []),
  ultimoEventoDoPonto: vi.fn(async () => estado.ultimoEvento),
  registrarLancamento: lancar,
  fecharPeriodoSuplementacao: fechar,
}));
vi.mock("@/services/suplementacaoEstoqueService", async (importOriginal) => ({ ...(await importOriginal()), registrarSaidaSuplementacao: saida }));
vi.mock("@/services/mapaCacheService", async (importOriginal) => ({
  ...(await importOriginal()),
  getMapaCachedData: vi.fn(async () => []),
  updateMapaCachedData: vi.fn(async () => {}),
  refreshMapaCacheEntry: vi.fn(async () => {}),
}));
vi.mock("@/services/empresaService", async (importOriginal) => ({ ...(await importOriginal()), listEmpresas: vi.fn(async () => [{ id: "emp-1", fuso_horario: "America/Cuiaba" }]) }));
vi.mock("@/services/sessionService", async (importOriginal) => ({ ...(await importOriginal()), getCurrentUser: vi.fn(async () => ({ id: "u-1" })) }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));

const posicao = (id, nome, cab, extra = {}) => ({ id, posicao_id: id, __posicao: true, nome, quantidade_cabecas: cab, area_atual_id: "area-a", status: "Ativo", categoria: "Boi 25 a 36 meses", ...extra });

/** Largura da tela para os `matchMedia` (desktop 1280, celular 390). */
const largura = (w) => {
  window.matchMedia = /** @type {any} */ ((q) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || w >= Number(min[1])) && (!max || w <= Number(max[1]));
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  });
};
const matchMediaOriginal = window.matchMedia;
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

/** O rodapé do cocho no pasto, como a aba Suplementação monta. */
const montar = async () => {
  const { default: AcoesCochoPasto } = await import("@/components/mapa/detalhes-lote/AcoesCochoPasto");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <AcoesCochoPasto ponto={estado.ponto} nivel={null} hoje="2026-11-15" podeLancar podeHistorico={false} />
    </QueryClientProvider>,
  );
  return { invalidar };
};
/** Toca em "Lançar" e espera o formulário com o rebanho carregado. */
const abrirLancar = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Lançar" })); });
  const dialogo = await screen.findByRole("dialog", { name: "Lançar Suplementação" });
  await assentar();
  await waitFor(() => expect(within(dialogo).getByText(/cabeças/)).toBeTruthy());
  return dialogo;
};
const campoKg = (dialogo) => /** @type {HTMLInputElement} */ (within(dialogo).getByPlaceholderText("0,00"));
const rotulo = (dialogo, texto) => /** @type {HTMLLabelElement} */ (within(dialogo).getByText(texto, { selector: "label.mg-field__label" }));

const eventosMapa = [];
const ouvirMapa = (e) => eventosMapa.push(e);

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem("empresa_selecionada_id", "emp-1");
  for (const f of Object.values(toast)) if (typeof f === "function" && "mockReset" in f) f.mockReset();
  saida.mockReset();
  lancar.mockReset();
  fechar.mockReset();
  estado.ponto = PONTO;
  estado.rebanho = [posicao("pa", "LOTE A", 30, { peso_medio_kg: 400 }), posicao("pb", "LOTE B", 20, { peso_medio_kg: 380 })];
  estado.formulacoes = [FORMULACAO];
  estado.produtos = [PRODUTO];
  estado.lotesNota = [SALDO];
  estado.ultimoEvento = null;
  saida.mockImplementation(async () => ({ movimentacao: { id: "mov-1" } }));
  lancar.mockImplementation(async ({ evento }) => ({ id: "ev-novo", ...evento }));
  fechar.mockImplementation(async () => ({}));
  eventosMapa.length = 0;
  window.addEventListener("atualizar-mapa", ouvirMapa);
});
afterEach(() => {
  window.removeEventListener("atualizar-mapa", ouvirMapa);
  cleanup();
  window.matchMedia = matchMediaOriginal;
});

describe("D-PROD-222 — Lançar do cocho no desenho do lançamento de manejo", () => {
  it("LM-1 — LancLoteDialogo largo: título = a ação, subtítulo = o cocho; popup com ✕/✓ no cabeçalho e nada do desenho antigo", async () => {
    largura(1280);
    await montar();
    const dialogo = await abrirLancar();
    expect(screen.getByRole("dialog", { name: "Lançar Suplementação", description: "COCHO 1" })).toBe(dialogo);
    expect(dialogo.querySelector(".mk-ll-dlg__titulo")?.textContent).toBe("Lançar Suplementação");
    expect(dialogo.querySelector(".mk-ll-dlg__lotes")?.textContent).toBe("COCHO 1");
    for (const classe of ["mk-ll-dlg", "mk-ll-dlg--largo", "is-desktop"]) expect(dialogo.classList.contains(classe)).toBe(true);

    // A ação mora no cabeçalho: ✕ e ✓, como no "Registrar Pesagem".
    const acoes = /** @type {HTMLElement} */ (dialogo.querySelector(".mk-ll-dlg__head .mk-ll-dlg__acoes"));
    expect(within(acoes).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Cancelar", "Salvar novo ciclo"]);
    const form = within(dialogo).getByTestId("form-lancamento-suplementacao");
    expect(form.tagName).toBe("FORM");
    expect(form.classList.contains("mk-ll")).toBe(true);
    const ok = within(acoes).getByRole("button", { name: "Salvar novo ciclo" });
    expect(ok.getAttribute("type")).toBe("submit");
    expect(ok.getAttribute("form")).toBe(form.id);

    // Nada do desenho antigo: cartão com a faixa "Lançar Suplementação - …", botões no pé, Select com <select> escondido.
    expect(within(dialogo).queryByText(/Lançar Suplementação - /)).toBeNull();
    expect(dialogo.querySelector(".mk-ll__rodape, [data-mk-map-action], .mk-launch-action, .rounded-lg.border-emerald-200")).toBeNull();
    expect(within(form).queryByText(/^(Cancelar|Salvar novo ciclo)$/)).toBeNull();
    expect(within(form).queryAllByRole("button", { name: /Cancelar|Salvar/ })).toHaveLength(0);
    expect(dialogo.querySelector("select")).toBeNull();
    expect(dialogo.querySelectorAll("label:not(.mg-field__label)")).toHaveLength(0);
  });

  it("LM-2 — celular: tela cheia com ✕ à esquerda, título e o cocho no meio, ✓ à direita", async () => {
    largura(390);
    await montar();
    const dialogo = await abrirLancar();
    expect(dialogo.classList.contains("is-tela")).toBe(true);
    const [esquerda, meio, direita] = [.../** @type {HTMLElement} */ (dialogo.querySelector(".mk-ll-dlg__head")).children];
    expect(esquerda.getAttribute("aria-label")).toBe("Cancelar");
    expect(meio.querySelector(".mk-ll-dlg__titulo")?.textContent).toBe("Lançar Suplementação");
    expect(meio.querySelector(".mk-ll-dlg__lotes")?.textContent).toBe("COCHO 1");
    expect(direita.classList.contains("mk-ll-dlg__redondo--salvar")).toBe(true);
    expect(direita.getAttribute("aria-label")).toBe("Salvar novo ciclo");
  });

  it("LM-3 — cada campo é um LancField: rótulo dentro da caixa, * no obrigatório, rótulo ligado ao controle", async () => {
    largura(1280);
    await montar();
    const dialogo = await abrirLancar();
    const campos = [
      ["Data do abastecimento", true, 'input[type="date"]'],
      ["Data fim consumo anterior", false, 'input[type="date"]'],
      ["Formulação", true, 'button[role="combobox"]'],
      ["Quantidade total fornecida (kg)", true, 'input[inputmode="decimal"]'],
      ["Sobra no cocho (kg)", false, 'input[inputmode="decimal"]'],
      ["Observações", false, "textarea"],
    ];
    for (const [texto, obrigatorio, seletor] of campos) {
      const r = rotulo(dialogo, texto);
      const caixa = r.closest(".mk-lanc .mg-field");
      expect(caixa, texto).toBeTruthy();
      expect(Boolean(r.querySelector(".req")), texto).toBe(obrigatorio);
      const controle = document.getElementById(r.htmlFor);
      expect(controle?.matches(seletor), texto).toBe(true);
      expect(caixa?.contains(controle), texto).toBe(true);
    }
    // A formulação única já vem escolhida (D-PROD-203) e aparece dentro do campo.
    expect(document.getElementById(rotulo(dialogo, "Formulação").htmlFor)?.textContent).toMatch(/SAL MINERAL 80 • Produto pronto \(0,100% PV\)/);
  });

  it("LM-4 — o ✓ do cabeçalho envia: a mesma baixa e o mesmo evento; salvo, fecha e faz o refresh de hoje", async () => {
    largura(1280);
    const { invalidar } = await montar();
    const dialogo = await abrirLancar();
    const ok = within(dialogo).getByRole("button", { name: "Salvar novo ciclo" });
    expect(/** @type {HTMLButtonElement} */ (ok).disabled).toBe(true); // sem quantidade
    await act(async () => { fireEvent.change(campoKg(dialogo), { target: { value: "200" } }); });
    expect(/** @type {HTMLButtonElement} */ (ok).disabled).toBe(false);

    await act(async () => { fireEvent.click(ok); });
    await assentar();
    expect(saida).toHaveBeenCalledTimes(1);
    expect(saida.mock.calls[0][0]).toMatchObject({ quantidade: 200, localOrigemId: "loc-1", depositoId: "dep-1", pontoSuplementacaoId: "p1" });
    expect(lancar).toHaveBeenCalledTimes(1);
    const { evento, lotes, operationId } = lancar.mock.calls[0][0];
    // Uma operação por lançamento (D-PROD-201): a baixa e o evento com o mesmo id e a mesma data.
    expect(operationId).toBe(saida.mock.calls[0][0].operationId);
    expect(saida.mock.calls[0][0].dataMovimentacao).toBe(evento.data_lancamento);
    expect(evento).toMatchObject({
      ponto_suplementacao_id: "p1",
      quantidade_total_kg: 200,
      unidade_lancamento: "KG",
      formulacao_id: "f-1",
      movimentacao_estoque_id: "mov-1",
      total_cabecas_afetadas: 50,
    });
    expect(lotes.map((l) => l.lote_id)).toEqual(["pa", "pb"]);
    expect(toast.success).toHaveBeenCalledWith("Suplementação registrada com sucesso.");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Lançar Suplementação" })).toBeNull(), { timeout: 3000 });
    // O formulário avisa o mapa e, ao sair, o rodapé faz o refresh do detalhe do cocho (D-PROD-218).
    expect(eventosMapa).toHaveLength(2);
    expect(invalidar.mock.calls.some(([o]) => o?.predicate?.({ queryKey: ["pontos-suplementacao", "emp-1"] }))).toBe(true);
  });

  it("LM-5 — salvando: ✓ girando, ✕ desabilitado, o Esc da tela cheia não fecha, campos travados e o passo no topo", async () => {
    largura(390);
    /** @type {() => void} */
    let liberar = () => {};
    lancar.mockImplementation(({ evento }) => new Promise((r) => { liberar = () => r({ id: "ev-novo", ...evento }); }));
    await montar();
    const dialogo = await abrirLancar();
    await act(async () => { fireEvent.change(campoKg(dialogo), { target: { value: "200" } }); });
    await act(async () => { fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar novo ciclo" })); });
    await waitFor(() => expect(lancar).toHaveBeenCalledTimes(1));

    const ok = within(dialogo).getByRole("button", { name: "Registrando..." });
    expect(/** @type {HTMLButtonElement} */ (ok).disabled).toBe(true);
    expect(ok.getAttribute("aria-busy")).toBe("true");
    expect(/** @type {HTMLButtonElement} */ (within(dialogo).getByRole("button", { name: "Cancelar" })).disabled).toBe(true);
    expect(within(dialogo).getByRole("status").textContent).toMatch(/Salvando\.\.\. Criando evento de suplementação\.\.\./);
    expect(within(dialogo).getByRole("progressbar", { name: "Progresso do salvamento" })).toBeTruthy();
    // O passo fica no topo do formulário (antes dos campos).
    const form = within(dialogo).getByTestId("form-lancamento-suplementacao");
    expect(form.firstElementChild?.contains(within(dialogo).getByTestId("suplementacao-progresso"))).toBe(true);
    // Campos travados, como o diálogo de progresso que cobria a tela.
    expect(campoKg(dialogo).matches(":disabled")).toBe(true);
    expect(campoKg(dialogo).closest(".mg-field")?.classList.contains("mg-field--locked")).toBe(true);

    // Esc na tela cheia fecharia (é o ✕): salvando, não fecha.
    await act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: "Escape", code: "Escape" }); });
    expect(screen.getByRole("dialog", { name: "Lançar Suplementação" })).toBe(dialogo);

    await act(async () => { liberar(); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Lançar Suplementação" })).toBeNull(), { timeout: 3000 });
    expect(toast.success).toHaveBeenCalledWith("Suplementação registrada com sucesso.");
  });

  it("LM-5b — sem salvar, o Esc da tela cheia fecha pelo mesmo caminho do ✕ (onCancel + refresh)", async () => {
    largura(390);
    const { invalidar } = await montar();
    const dialogo = await abrirLancar();
    expect(dialogo).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: "Escape", code: "Escape" }); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Lançar Suplementação" })).toBeNull());
    expect(lancar).not.toHaveBeenCalled();
    expect(eventosMapa).toHaveLength(1);
    expect(invalidar.mock.calls.some(([o]) => o?.predicate?.({ queryKey: ["mapa-eventos-supl"] }))).toBe(true);
  });

  it("LM-6 — produto em sacos: unidade num LancLoteSegmento; os sacos viram kg na gravação como antes", async () => {
    largura(1280);
    estado.produtos = [{ ...PRODUTO, unidade_principal_estoque: "SACO", peso_por_saco_kg: 25 }];
    await montar();
    const dialogo = await abrirLancar();
    const grupo = within(dialogo).getByRole("radiogroup", { name: "Unidade de lançamento" });
    const [kg, sacos] = within(grupo).getAllByRole("radio");
    expect([kg.textContent, sacos.textContent]).toEqual(["Quilogramas (KG)", "Sacos (25 kg/saco)"]);
    expect(kg.getAttribute("aria-checked")).toBe("true");
    await act(async () => { fireEvent.click(sacos); });
    expect(sacos.getAttribute("aria-checked")).toBe("true");

    const campoSacos = document.getElementById(rotulo(dialogo, "Quantidade de sacos").htmlFor);
    await act(async () => { fireEvent.change(/** @type {HTMLInputElement} */ (campoSacos), { target: { value: "8" } }); });
    const equivalente = within(dialogo).getByTestId("suplementacao-equivalente-kg");
    expect(equivalente.textContent).toBe("200,00 kg");
    expect(rotulo(dialogo, "Equivalente em kg").closest(".mg-field")?.contains(equivalente)).toBe(true);
    // Saldo em kg e em sacos, com a baixa automática.
    expect(within(dialogo).getByTestId("suplementacao-saldo-deposito").textContent).toMatch(/Saldo depósito: 5\.000,00 KG.*Sacos: 200,0 sacos.*Baixa automática: Ativa/);

    await act(async () => { fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar novo ciclo" })); });
    await assentar();
    expect(saida.mock.calls[0][0].quantidade).toBe(200);
    expect(lancar.mock.calls[0][0].evento).toMatchObject({ quantidade_total_kg: 200, quantidade_sacos: 8, unidade_lancamento: "SACO", peso_por_saco_kg: 25 });
  });

  it("LM-7 — avisos e informações em LancLoteAviso, no tom de cada um", async () => {
    largura(1280);
    estado.rebanho = [posicao("pa", "LOTE A", 30, { peso_medio_kg: 400 }), posicao("pb", "LOTE B", 20, { peso_medio_kg: null })];
    estado.lotesNota = [];
    await montar();
    let dialogo = await abrirLancar();
    const tom = (id) => /** @type {HTMLElement} */ (within(dialogo).getByTestId(id)).className;
    expect(tom("suplementacao-resumo-cocho")).toBe("mk-ll__aviso mk-ll__aviso--neutro");
    const resumo = within(dialogo).getByTestId("suplementacao-resumo-cocho").textContent;
    for (const trecho of ["Áreas: PASTO A", "Depósito: DEPÓSITO", "Lotes: 2 lote(s) - 50 cabeças", "Peso médio: 400,0 kg", "Peso para o consumo: último peso"]) expect(resumo).toContain(trecho);
    expect(tom("suplementacao-sem-peso")).toBe("mk-ll__aviso mk-ll__aviso--ambar");
    expect(within(dialogo).getByTestId("suplementacao-sem-peso").textContent).toMatch(/20 cabeça\(s\) sem peso \(LOTE B\)/);
    // Formulação padrão do cocho sem saldo no depósito: o aviso vermelho de sempre.
    expect(tom("suplementacao-sem-saldo")).toBe("mk-ll__aviso mk-ll__aviso--vermelho");
    expect(within(dialogo).getByTestId("suplementacao-sem-saldo").textContent).toBe("Produto sem saldo disponível neste depósito/local de estoque.");
    expect(within(dialogo).queryByTestId("suplementacao-sem-deposito")).toBeNull();
    cleanup();

    // Sem depósito e sem formulação ativa.
    estado.ponto = { ...PONTO, deposito_origem_id: null };
    estado.formulacoes = [];
    await montar();
    dialogo = await abrirLancar();
    expect(tom("suplementacao-sem-deposito")).toBe("mk-ll__aviso mk-ll__aviso--neutro");
    expect(within(dialogo).getByTestId("suplementacao-sem-deposito").textContent).toBe("Este cocho ainda não tem depósito vinculado. Lançamento sem baixa automática.");
    const semFormulacao = within(dialogo).getByRole("alert");
    expect(semFormulacao).toBe(within(dialogo).getByTestId("suplementacao-sem-formulacao"));
    expect(semFormulacao.className).toBe("mk-ll__aviso mk-ll__aviso--ambar");
    expect(semFormulacao.querySelector("a")?.getAttribute("href")).toMatch(/Formulacoes/i);
    // Sem formulação: o campo fica travado e o ✓ também.
    expect(/** @type {HTMLButtonElement} */ (document.getElementById(rotulo(dialogo, "Formulação").htmlFor)).disabled).toBe(true);
    await act(async () => { fireEvent.change(campoKg(dialogo), { target: { value: "200" } }); });
    expect(/** @type {HTMLButtonElement} */ (within(dialogo).getByRole("button", { name: "Salvar novo ciclo" })).disabled).toBe(true);
  });

  it("LM-8 — consumo por lote: um LancLoteItem por lote, atrás do Ver/Ocultar", async () => {
    largura(1280);
    await montar();
    const dialogo = await abrirLancar();
    expect(within(dialogo).queryByRole("button", { name: /Consumo por Lote/ })).toBeNull(); // sem quantidade, sem consumo
    await act(async () => { fireEvent.change(campoKg(dialogo), { target: { value: "200" } }); });
    const botao = within(dialogo).getByRole("button", { name: /Consumo por Lote \(novo lançamento\)/ });
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(botao.textContent).toMatch(/Ver$/);
    expect(dialogo.querySelectorAll(".mk-ll__item")).toHaveLength(0);
    await act(async () => { fireEvent.click(botao); });
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(botao.textContent).toMatch(/Ocultar$/);
    const itens = [...dialogo.querySelectorAll(".mk-ll__itens .mk-ll__item")];
    expect(itens.map((i) => i.querySelector(".mk-ll__item-titulo")?.textContent)).toEqual(["LOTE A", "LOTE B"]);
    expect(itens[0].querySelector(".mk-ll__item-sub")?.textContent).toBe("Área: PASTO A · 60,0%");
    const valores = [...itens[0].querySelectorAll("dt")].map((dt) => `${dt.textContent}=${dt.nextElementSibling?.textContent}`);
    expect(valores.slice(0, 3)).toEqual(["Cabeças=30", "Peso médio=400 kg", "Qtd. lote=120,00 kg"]);
  });

  it("LM-9 — sobra herdada: a confirmação abre por cima; aproveitar preenche a sobra e o foco volta ao lançamento", async () => {
    largura(1280);
    estado.ultimoEvento = { id: "ev-0", data_lancamento: "2026-10-20", quantidade_total_kg: 100, sobra_kg: 30, dias_periodo: 5 };
    await montar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Lançar" })); });
    const confirmacao = await screen.findByRole("dialog", { name: "Sobra do ciclo anterior" });
    await act(async () => { fireEvent.click(within(confirmacao).getByRole("button", { name: /Usar essa sobra no novo ciclo/ })); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sobra do ciclo anterior" })).toBeNull());

    const dialogo = await screen.findByRole("dialog", { name: "Lançar Suplementação" });
    expect(/** @type {HTMLInputElement} */ (within(dialogo).getByLabelText("Sobra no cocho (kg)")).value).toBe("30.00");
    expect(within(dialogo).getByText(/Herdada do ciclo anterior/).closest("label.mg-field__label")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
    // O foco volta ao lançamento (o diálogo da sobra, sem gatilho, o deixava no <body>): no ✕, como ao abrir.
    await waitFor(() => expect(dialogo.contains(document.activeElement)).toBe(true));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Cancelar");
  });
});
