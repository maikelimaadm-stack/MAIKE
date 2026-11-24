// @vitest-environment jsdom
/**
 * MAIKE-ICONES-LOTE-CODIGO (D-PROD-191) — subícone do lote nos detalhes e nos
 * formulários de manejo.
 *
 * O subícone vem do CÓDIGO (motor `@/assets/icones/lotes`) pela chave SEXO + FAIXA DE
 * IDADE da Categoria de Manejo — nunca do upload (`ConfiguracaoIcone` de Lote:
 * `icone_url` / `sub_icone_url`, um segundo upload que podia divergir do principal).
 * Regra do proprietário: o subícone NUNCA usa misto nem a cor de misto. Cada lote e
 * cada categoria aparece com o animal DELE, na cor do sexo DELE, mesmo quando o pasto
 * mistura sexos (o marcador do mapa é que vira misto).
 *
 * Tudo REAL (catálogo, peças, abas do Detalhes v12, formulários, DetalhesLote); mocks só
 * na borda (cache do mapa, serviços de rede, sessão, toast). As abas do v12 (D-PROD-218)
 * rodam na casca de teste (tests/smoke/fixtures/pastoV12.jsx); o último bloco usa o
 * DetalhesLote real com a casca real (PainelPasto).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

// ── Borda: cache do mapa, serviços de rede (o de ícones devolve um upload de Lote, que
// nunca pode aparecer), sessão, toast e os blocos do DetalhesLote fora do assunto ──────
const vazio = vi.hoisted(() => (nome) => async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("div", { "data-testid": `vazio-${nome}` }) };
});
/** Ícone de Lote por UPLOAD, com sub-ícone: nada disto pode aparecer na tela. */
const UPLOAD = vi.hoisted(() => ({
  id: "ic-1", tipo_entidade: "Lote", categoria: "NOVILHA 13 A 24 MESES", ativo: true,
  icone_url: "https://upload.invalid/icone-lote.png", sub_icone_url: "https://upload.invalid/sub-icone-lote.png",
}));
const dados = vi.hoisted(() => ({ areas: [], lotes: [], movimentacoes: [], categoriasManejo: [] }));
const cache = vi.hoisted(() => ({
  getMapaCachedData: vi.fn(async (chave) => dados[chave] ?? []),
  refreshMapaCacheEntry: vi.fn(async (chave) => dados[chave] ?? []),
}));
const icones = vi.hoisted(() => ({
  listarIconesDaEmpresa: vi.fn(async () => [UPLOAD]),
  listarIconesPorTipoEntidade: vi.fn(async () => [UPLOAD]),
  listarTodosPontosSuplementacao: vi.fn(async () => []),
}));

vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/mapaService", () => icones);
vi.mock("@/services/loteManejoService", () => ({ listarProdutosDaEmpresa: vi.fn(async () => []), criarEventoSuplementacao: vi.fn(), registrarSuplementacaoEmLote: vi.fn(), listarTodosLotes: vi.fn(async () => []), listarEventosSuplementacao: vi.fn(async () => []) }));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ id: "u-1", cliente_id: "c-1" }) }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/components/lotes/ExcluirMovimentacao", () => ({ escopoDoUsuario: () => "c-1:u-1" }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock("@/components/lotes/HistoricoMovimentacoes", vazio("historico"));
vi.mock("@/components/suplementacao/HistoricoSuplementacaoLote", vazio("historico-supl"));

const { ANIMAIS_SVG, COR_FEMEA, COR_MACHO } = await import("@/assets/icones/lotes/animais");
const { COR_MISTO, MISTOS_SVG } = await import("@/assets/icones/lotes/mistos");
const { resolverFiguraDoPasto, urlSubiconeLote } = await import("@/assets/icones/lotes");
const { FAIXAS_IDADE_CATEGORIA_MANEJO, categoriaOficialDaCategoriaManejo } = await import("@/domain/lotes/categoriaOficialDerivada");
const { montarModeloDetalhes } = await import("@/components/mapa/detalhes-lote/catalogo");
const { IconeCategoria } = await import("@/components/mapa/detalhes-lote/pecas");
const { CascaDeTeste } = await import("./fixtures/pastoV12.jsx");
const { esquecerEstadoLotes } = await import("@/components/mapa/detalhes-lote/useEstadoLotes");
const { default: FormularioMorte } = await import("@/components/lotes/FormularioMorte");
const { default: FormularioPesagem } = await import("@/components/lotes/FormularioPesagem");
const { default: DetalhesLote } = await import("@/components/mapa/DetalhesLote");

// ── As 10 combinações sexo + faixa ──────────────────────────────────────────

/** Sufixo do nome do arquivo do proprietário por faixa (D-PROD-186). */
const SUFIXO = { "0 a 8 meses": "0-8", "9 a 12 meses": "9-12", "13 a 24 meses": "13-24", "25 a 36 meses": "25-36", "Maior que 36 meses": "37-mais" };
const COMBINACOES = ["FEMEA", "MACHO"].flatMap((sexo) =>
  FAIXAS_IDADE_CATEGORIA_MANEJO.map((f) => ({
    sexo,
    faixa: f.rotulo,
    figura: `${sexo === "FEMEA" ? "femea" : "macho"}-${SUFIXO[f.rotulo]}`,
    cor: sexo === "FEMEA" ? COR_FEMEA : COR_MACHO,
  }))
);
const combo = (figura) => /** @type {(typeof COMBINACOES)[number]} */ (COMBINACOES.find((c) => c.figura === figura));

/** Categoria de Manejo da combinação (faixa fixa do cadastro; nome livre). */
const categoriaDe = (c) => {
  const f = /** @type {any} */ (FAIXAS_IDADE_CATEGORIA_MANEJO.find((x) => x.rotulo === c.faixa));
  return {
    id: `cm-${c.figura}`, empresa_id: "emp-1", nome: `MANEJO ${c.figura.toUpperCase()}`, ativo: true,
    sexo: c.sexo === "FEMEA" ? "Fêmea" : "Macho", idade_minima_meses: f.idade_minima_meses, idade_maxima_meses: f.idade_maxima_meses,
  };
};
const CATEGORIAS = COMBINACOES.map(categoriaDe);

const AREA = { id: "a1", nome: "PASTO A", tamanho_hectares: 50, tipo_pastagem: "Brachiaria", tipo_cultura: "Pastagem" };
const HOJE = new Date(2026, 10, 13);

let seq = 0;
/** Posição do rebanho (ledger) da combinação, com a categoria oficial derivada gravada. */
const posicao = (figura, cab = 10, extra = {}) => {
  const c = combo(figura);
  seq += 1;
  return {
    id: `p${seq}`, posicao_id: `p${seq}`, __posicao: true, nome: `LOTE ${seq}`,
    categoria: categoriaOficialDaCategoriaManejo(categoriaDe(c)), sexo: c.sexo === "FEMEA" ? "Fêmea" : "Macho",
    categoria_manejo_id: `cm-${figura}`, categoria_manejo_nome: `MANEJO ${figura.toUpperCase()}`,
    quantidade_cabecas: cab, peso_medio_kg: 300, area_atual_id: "a1", status: "Ativo", data_entrada: "2026-06-01", empresa_id: "emp-1",
    ...extra,
  };
};

const modeloDe = (lotes, extra = {}) => montarModeloDetalhes({ area: AREA, lotes, lotesDaArea: [], movimentacoes: [], categoriasManejo: CATEGORIAS, hoje: HOJE, ...extra });

// ── Leitura do SVG do subícone ──────────────────────────────────────────────

const PREFIXO = "data:image/svg+xml;base64,";
/** @param {string|null} url */
const svgDaUrl = (url) => {
  expect(String(url).startsWith(PREFIXO), String(url).slice(0, 48)).toBe(true);
  return atob(String(url).slice(PREFIXO.length));
};
/** Os `d` dos caminhos, na ordem. @param {string} svg */
const caminhos = (svg) => [...svg.matchAll(/<path\b[^>]*?\sd="([^"]*)"/g)].map((m) => m[1]);
const figurasDosMistos = Object.keys(MISTOS_SVG);

/**
 * O subícone é o animal `figura` SOZINHO, na cor do sexo dele: os mesmos caminhos do
 * arquivo do proprietário, nenhum desenho de misto, nenhuma cor de misto.
 * @param {string|null} url @param {string} figura
 */
const conferirSubicone = (url, figura) => {
  const svg = svgDaUrl(url);
  const { cor } = combo(figura);
  expect(svg).toContain(`data-figura="${figura}"`);
  expect(caminhos(svg), figura).toEqual(caminhos(ANIMAIS_SVG[figura]));
  for (const m of figurasDosMistos) expect(caminhos(svg), `${figura} não é ${m}`).not.toEqual(caminhos(MISTOS_SVG[m]));
  expect([...svg.matchAll(/\bfill="([^"]+)"/g)].map((x) => x[1]), figura).toEqual([cor]);
  expect(svg.toLowerCase()).not.toContain(COR_MISTO.toLowerCase());
  expect(svg.toLowerCase()).not.toContain("#ff0000");
  expect(svg).not.toMatch(/data-icone-lote|misto/);
};

/** Figura (data-figura) de uma imagem de subícone. @param {Element} img */
const figuraDaImg = (img) => /data-figura="([^"]+)"/.exec(svgDaUrl(img.getAttribute("src")))?.[1] ?? null;
/** Quadrados tracejados (subícone sem figura). @param {ParentNode} raiz */
const tracejados = (raiz) => [...raiz.querySelectorAll("span")].filter((s) => /dashed/.test(/** @type {HTMLElement} */ (s).style.border));

const clicar = (el) => act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 0)); });
const aba = (nome) => clicar(screen.getByRole("tab", { name: new RegExp(`^${nome}`) }));
const comCliente = (ui) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  seq = 0;
  esquecerEstadoLotes();
  Object.assign(dados, { areas: [], lotes: [], movimentacoes: [], categoriasManejo: [] });
  window.localStorage.clear();
  window.localStorage.setItem("empresa_selecionada_id", "emp-1");
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: /min-width: 1024px/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  for (const fn of Object.values(icones)) fn.mockClear();
  cache.getMapaCachedData.mockClear();
  cache.refreshMapaCacheEntry.mockClear();
});
afterEach(() => cleanup());

// ── Catálogo + peça ─────────────────────────────────────────────────────────

describe("subícone do lote: as 10 combinações sexo + faixa", () => {
  it("cada combinação vira a figura certa no lote e na categoria da área", () => {
    expect(COMBINACOES).toHaveLength(10);
    for (const c of COMBINACOES) {
      const modelo = modeloDe([posicao(c.figura, 12)]);
      expect(modelo.lotes[0].subicone, c.figura).toBe(c.figura);
      expect(modelo.area.categorias.map((k) => k.subicone), c.figura).toEqual([c.figura]);
    }
  });

  it("IconeCategoria desenha o svg da figura, na cor do sexo, montado no tamanho em que aparece", () => {
    for (const c of COMBINACOES) {
      // 22: formulários; 30: categorias da aba Detalhes; 34: itens do Resumo; 44: cartão do lote.
      for (const tamanho of [22, 30, 34, 44]) {
        const { container, unmount } = render(<IconeCategoria figura={c.figura} tamanho={tamanho} alt={c.figura} />);
        const img = /** @type {HTMLImageElement} */ (container.querySelector("img"));
        expect(img, c.figura).toBeTruthy();
        expect(img.getAttribute("src")).toBe(urlSubiconeLote(c.figura, tamanho));
        expect(img.style.width).toBe(`${tamanho}px`);
        conferirSubicone(img.getAttribute("src"), c.figura);
        expect(tracejados(container)).toHaveLength(0);
        unmount();
      }
    }
    // Fêmea e macho nunca dividem cor, e nenhum dos dois é a cor de misto.
    expect(new Set([COR_FEMEA, COR_MACHO, COR_MISTO].map((x) => x.toLowerCase())).size).toBe(3);
  });
});

describe("pasto que mistura sexos: o mapa é misto; os detalhes, nunca", () => {
  const PASTO = () => [
    posicao("macho-37-mais", 40), posicao("femea-37-mais", 35), posicao("macho-0-8", 30), posicao("femea-0-8", 25),
    posicao("macho-9-12", 8), posicao("femea-9-12", 7), posicao("macho-13-24", 6), posicao("femea-13-24", 5),
    posicao("macho-25-36", 4), posicao("femea-25-36", 3),
  ];

  it("o marcador do mapa deste pasto é um misto vermelho (o cenário é mesmo misto)", () => {
    const icone = resolverFiguraDoPasto(PASTO(), CATEGORIAS);
    expect(icone.nivel).toBe(3);
    expect(icone.cor).toBe(COR_MISTO);
    expect(figurasDosMistos).toContain(icone.misto);
  });

  it("VM do lote e composição da área: cada um com o animal dele, nunca um misto", () => {
    const posicoes = PASTO();
    const modelo = modeloDe(posicoes);
    expect(modelo.lotes.map((l) => l.subicone)).toEqual(posicoes.map((p) => p.categoria_manejo_id.slice(3)));
    // A composição agrupa pela categoria oficial: 8 grupos, cada um com o animal do SEU sexo.
    const porNome = Object.fromEntries(modelo.area.categorias.map((k) => [k.nome, k.subicone]));
    expect(porNome).toEqual({
      "BEZERRA 0 A 12 MESES": "femea-0-8",
      "BEZERRO 0 A 12 MESES": "macho-0-8",
      "GARROTE 13 A 24 MESES": "macho-13-24",
      "NOVILHA 13 A 24 MESES": "femea-13-24",
      "BOI 25 A 36 MESES": "macho-25-36",
      "VACA 25 A 36 MESES": "femea-25-36",
      "TOURO + 36 MESES": "macho-37-mais",
      "VACA + 36 MESES": "femea-37-mais",
    });
    for (const f of [...modelo.lotes.map((l) => l.subicone), ...Object.values(porNome)]) expect(figurasDosMistos).not.toContain(f);
  });

  it("na tela (Detalhes sem subícones desde o v13, Lotes › Resumo 30 px, Lotes › Lote 36 px — densidade compacta, D-PROD-224): só animais, na cor do sexo; nada vermelho", async () => {
    const posicoes = PASTO();
    const esperado = posicoes.map((p) => p.categoria_manejo_id.slice(3));
    const modelo = modeloDe(posicoes);
    render(<CascaDeTeste modelo={modelo} modo="celular" abaInicial="detalhes" areaId="a1" />);

    /** Todas as imagens do painel visível, conferidas uma a uma. @param {number} tamanho */
    const imagens = (tamanho) => {
      const imgs = [...screen.getByRole("tabpanel").querySelectorAll("img")];
      for (const img of imgs) {
        const figura = /** @type {string} */ (figuraDaImg(img));
        expect(img.getAttribute("src"), figura).toBe(urlSubiconeLote(figura, tamanho));
        conferirSubicone(img.getAttribute("src"), figura);
      }
      return imgs.map(figuraDaImg);
    };

    // Detalhes (v13): o bloco Categorias saiu da aba — nenhum subícone aqui; a composição fica em Lotes.
    expect(imagens(26)).toEqual([]);
    // Lotes › Resumo (o celular abre no Resumo): um item por lote, por nome.
    await aba("Lotes");
    expect(imagens(30).sort()).toEqual([...esperado].sort());
    // Lotes › Lote: o cartão do lote.
    await clicar(screen.getByRole("button", { name: "Lote", exact: true }));
    const [umLote] = imagens(36);
    expect(esperado).toContain(umLote);
  });
});

describe("grupo com faixas diferentes do mesmo sexo: a de mais cabeças", () => {
  it("a composição da área mostra a faixa com mais cabeças; cada lote continua com a dele", () => {
    const novos = [posicao("macho-0-8", 10), posicao("macho-9-12", 30)];
    let modelo = modeloDe(novos);
    expect(modelo.area.categorias.map((k) => [k.nome, k.subicone])).toEqual([["BEZERRO 0 A 12 MESES", "macho-9-12"]]);
    expect(modelo.lotes.map((l) => l.subicone)).toEqual(["macho-0-8", "macho-9-12"]);

    modelo = modeloDe([posicao("macho-0-8", 30), posicao("macho-9-12", 10)]);
    expect(modelo.area.categorias[0].subicone).toBe("macho-0-8");

    // Empate: a faixa mais velha.
    modelo = modeloDe([posicao("femea-0-8", 20), posicao("femea-9-12", 20)]);
    expect(modelo.area.categorias[0].subicone).toBe("femea-9-12");

    // A conta é por cabeças, não por número de lotes.
    modelo = modeloDe([posicao("femea-0-8", 5), posicao("femea-0-8", 5), posicao("femea-0-8", 5), posicao("femea-9-12", 16)]);
    expect(modelo.area.categorias.map((k) => [k.nome, k.subicone])).toEqual([["BEZERRA 0 A 12 MESES", "femea-9-12"]]);
  });
});

describe("posição sem sexo ou sem faixa: sem ícone (quadrado tracejado)", () => {
  const semFigura = () => [
    { ...posicao("macho-37-mais"), categoria: "BOI MAGRO", sexo: null, categoria_manejo_id: null },
    { ...posicao("macho-37-mais"), categoria: "BOI MAGRO", sexo: "Macho", categoria_manejo_id: null },
    { ...posicao("macho-37-mais"), categoria: "LOTE MISTO", sexo: "Misto", categoria_manejo_id: null },
    { ...posicao("macho-37-mais"), categoria: "RECRIA", sexo: null, categoria_manejo_id: "cm-sem-idade" },
  ];
  const SEM_IDADE = { id: "cm-sem-idade", nome: "RECRIA", sexo: "Macho", idade_minima_meses: null, idade_maxima_meses: null, ativo: true };

  it("o modelo não inventa figura", () => {
    const modelo = modeloDe(semFigura(), { categoriasManejo: [...CATEGORIAS, SEM_IDADE] });
    expect(modelo.lotes.map((l) => l.subicone)).toEqual([null, null, null, null]);
    expect(modelo.area.categorias.map((k) => k.subicone)).toEqual([null, null, null]);
  });

  it("a tela mostra o quadrado tracejado, sem imagem", () => {
    const modelo = modeloDe(semFigura(), { categoriasManejo: [...CATEGORIAS, SEM_IDADE] });
    // Lotes › Resumo (celular): os 4 lotes sem figura.
    const { container } = render(<CascaDeTeste modelo={modelo} modo="celular" areaId="a1" />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(tracejados(screen.getByRole("tabpanel"))).toHaveLength(4);
    for (const figura of [null, undefined, "", "misto1", "boi-gordo"]) {
      const { container: c, unmount } = render(<IconeCategoria figura={figura} tamanho={22} alt="sem" />);
      expect(c.querySelector("img"), String(figura)).toBe(null);
      expect(tracejados(c), String(figura)).toHaveLength(1);
      unmount();
    }
  });
});

describe("o modelo não lê ConfiguracaoIcone", () => {
  it("ícones de Lote por upload (com sub_icone_url) não mudam nada", () => {
    const lotes = () => [posicao("femea-13-24", 20), { ...posicao("macho-37-mais", 5), categoria: "NOVILHA 13 A 24 MESES", sexo: null, categoria_manejo_id: null }];
    seq = 0;
    const sem = modeloDe(lotes());
    seq = 0;
    const com = modeloDe(lotes(), { iconesConfig: [UPLOAD, { ...UPLOAD, id: "ic-2", categoria: "BOI MAGRO" }] });
    expect(JSON.stringify(com)).toBe(JSON.stringify(sem));
    expect(JSON.stringify(com)).not.toContain("upload.invalid");
    expect("iconeUrl" in com.lotes[0]).toBe(false);
    expect("iconeUrl" in com.area.categorias[0]).toBe(false);
    // O texto oficial basta para o 2º lote; o upload da mesma categoria é ignorado.
    expect(com.lotes.map((l) => l.subicone)).toEqual(["femea-13-24", "femea-13-24"]);
  });

  it("detalhes e formulários de manejo não falam mais com o upload de ícone de Lote (fonte, sem comentários)", () => {
    const codigo = (rel) => readFileSync(rel, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const arquivos = [
      "src/components/mapa/detalhes-lote/catalogo.js",
      "src/components/mapa/detalhes-lote/pecas.jsx",
      "src/components/mapa/DetalhesLote.jsx",
      ...["Pesagem", "Morte", "Abate", "MudancaCategoria", "MovimentacaoLote", "Nascimento"].map((f) => `src/components/lotes/Formulario${f}.jsx`),
    ];
    for (const rel of arquivos) {
      const fonte = codigo(rel);
      expect(fonte, rel).not.toMatch(/sub_icone_url|icone_url|tipo_entidade|iconesConfig|listarIconesDaEmpresa|listarIconesPorTipoEntidade|configuracao-icones/);
    }
  });
});

// ── Formulários de manejo ───────────────────────────────────────────────────

/** Imagem do cabeçalho do item que contém `texto`. @param {string} texto */
const imgDoItem = (texto) => /** @type {HTMLElement} */ (screen.getByText(texto).closest("section")).querySelector("img");

describe("formulários de manejo: subícone do código", () => {
  it("Morte: a linha mostra o animal da categoria escolhida e troca junto com a escolha", async () => {
    const lotes = [posicao("femea-13-24", 20), posicao("macho-37-mais", 5)];
    render(comCliente(<FormularioMorte lote={lotes} categoriasManejo={CATEGORIAS} onSubmit={vi.fn()} onCancel={vi.fn()} />));
    await clicar(screen.getByRole("button", { name: /Adicionar Categoria/ }));

    // 1ª categoria (ordem alfabética): Novilha 13 a 24 meses → fêmea 13–24, amarela.
    let img = imgDoItem("Categoria 1");
    expect(img?.getAttribute("src")).toBe(urlSubiconeLote("femea-13-24", 22));
    conferirSubicone(img?.getAttribute("src") ?? null, "femea-13-24");

    // Escolhe Touro + 36 meses → macho 37+, azul.
    const item = within(/** @type {HTMLElement} */ (screen.getByText("Categoria 1").closest("section")));
    await clicar(item.getAllByRole("combobox")[0]);
    await clicar(screen.getByRole("option", { name: /Touro \+ 36 meses/ }));
    img = imgDoItem("Categoria 1");
    expect(img?.getAttribute("src")).toBe(urlSubiconeLote("macho-37-mais", 22));
    conferirSubicone(img?.getAttribute("src") ?? null, "macho-37-mais");
    expect(icones.listarIconesDaEmpresa).not.toHaveBeenCalled();
  });

  it("Morte: a categoria das posições manda (9–12 pela Categoria de Manejo); sem ela, o texto oficial (0–12 → 0–8)", async () => {
    const comManejo = render(comCliente(<FormularioMorte lote={[posicao("macho-9-12", 10)]} categoriasManejo={CATEGORIAS} onSubmit={vi.fn()} onCancel={vi.fn()} />));
    await clicar(screen.getByRole("button", { name: /Adicionar Categoria/ }));
    conferirSubicone(imgDoItem("Categoria 1")?.getAttribute("src") ?? null, "macho-9-12");
    comManejo.unmount();

    const soTexto = { ...posicao("macho-9-12", 10), categoria_manejo_id: null, sexo: null };
    render(comCliente(<FormularioMorte lote={[soTexto]} categoriasManejo={[]} onSubmit={vi.fn()} onCancel={vi.fn()} />));
    await clicar(screen.getByRole("button", { name: /Adicionar Categoria/ }));
    expect(soTexto.categoria).toBe("Bezerro 0 a 12 meses");
    conferirSubicone(imgDoItem("Categoria 1")?.getAttribute("src") ?? null, "macho-0-8");
  });

  it("Morte: categoria sem sexo nem faixa conhecidos fica sem ícone (nada de upload)", async () => {
    render(comCliente(<FormularioMorte lote={[{ ...posicao("macho-37-mais"), categoria: "NOVILHA ESPECIAL", sexo: null, categoria_manejo_id: null }]} categoriasManejo={CATEGORIAS} onSubmit={vi.fn()} onCancel={vi.fn()} />));
    await clicar(screen.getByRole("button", { name: /Adicionar Categoria/ }));
    expect(imgDoItem("Categoria 1")).toBe(null);
  });

  it("Pesagem › Por Lote: cada linha é uma posição, com o animal DELA (mesma categoria oficial, faixas diferentes)", async () => {
    const lotes = [posicao("femea-0-8", 10), posicao("femea-9-12", 10)];
    render(comCliente(<FormularioPesagem lote={lotes} categoriasManejo={CATEGORIAS} onSubmit={vi.fn()} onCancel={vi.fn()} />));
    await clicar(screen.getByRole("radio", { name: "Por Lote" }));
    for (const [nome, figura] of [["LOTE 1", "femea-0-8"], ["LOTE 2", "femea-9-12"]]) {
      const img = imgDoItem(nome);
      expect(img?.getAttribute("src"), nome).toBe(urlSubiconeLote(figura, 22));
      conferirSubicone(img?.getAttribute("src") ?? null, figura);
    }
  });
});

// ── DetalhesLote: categorias do cache do mapa → modelo e formulários ─────────

describe("DetalhesLote: as categorias de manejo vêm do cache do mapa", () => {
  // DetalhesLote REAL com a casca v12 real (PainelPasto): roda depois da integração das peças
  // do Detalhes v12 (D-PROD-218). No celular a aba Lotes abre no Resumo (subícone 30 px, D-PROD-224).
  it("lê 'categoriasManejo' do cache, mostra o subícone do código e o passa ao formulário de Morte", async () => {
    window.matchMedia = /** @type {any} */ ((q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
    // 9–12 só sai da Categoria de Manejo: pelo texto oficial ("Bezerra 0 a 12 meses") seria 0–8.
    const posicoes = [posicao("femea-9-12", 20), posicao("macho-25-36", 5)];
    dados.areas = [AREA];
    dados.lotes = posicoes;
    dados.categoriasManejo = CATEGORIAS;
    render(comCliente(<DetalhesLote lotes={posicoes} onClose={() => {}} permissions={{}} />));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    expect(cache.getMapaCachedData).toHaveBeenCalledWith("categoriasManejo", "emp-1");
    const itens = [...screen.getByRole("tabpanel").querySelectorAll("img")];
    expect(itens.map((img) => img.getAttribute("src"))).toEqual([urlSubiconeLote("femea-9-12", 30), urlSubiconeLote("macho-25-36", 30)]);

    // Rodapé "Manejos" → tela "Manejos e históricos" → "Morte".
    await clicar(screen.getByRole("button", { name: "Manejos", exact: true }));
    await clicar(screen.getByRole("button", { name: "Morte" }));
    await clicar(screen.getByRole("button", { name: /Adicionar Categoria/ }));
    // 1ª categoria: Bezerra 0 a 12 meses — a figura veio das categorias que o DetalhesLote passou.
    conferirSubicone(imgDoItem("Categoria 1")?.getAttribute("src") ?? null, "femea-9-12");

    // Ninguém consultou o ícone de Lote por upload, e ele não aparece em lugar nenhum.
    expect(icones.listarIconesDaEmpresa).not.toHaveBeenCalled();
    expect(icones.listarIconesPorTipoEntidade).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("upload.invalid");
  });
});
