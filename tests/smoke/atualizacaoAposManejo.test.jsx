// @vitest-environment jsdom
/**
 * D-PROD-250 — depois de qualquer gravação no rebanho as telas mostram o saldo
 * novo na hora. Achado do dono (2026-11-18): transferiu KM-06 → KM-17 e
 * KM-06 → KM - P. 01, pesou, mudou categoria, juntou; o banco estava certo, mas
 * o Detalhes do pasto P. 01 mostrou números antigos por minutos.
 *
 * Causas cobertas aqui:
 * 1. Os manejos só pediam `lotes`/`movimentacoes`; `areas` (ocupação e saldo da
 *    área, derivados do rebanho) e as consultas próprias do Detalhes
 *    (`mapa-lotes`, `mapa-areas`, com staleTime 60 s / 5 min) ficavam velhas.
 * 2. A leitura forçada se juntava a uma leitura comum que tinha saído ANTES da
 *    gravação (devolvia o dado velho e travava a cópia velha por 60 s).
 * 3. Outra aba aberta não sabia da gravação.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

describe("aposEscritaNoRebanho: relê do servidor e só então invalida tudo o que vem do rebanho", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("@/services/mapaCacheService"));

  const carregar = async (refresh) => {
    vi.doMock("@/services/mapaCacheService", () => ({ refreshMapaCacheEntry: refresh }));
    return import("@/components/mapa/invalidarCachesMapa");
  };

  it("força lotes, areas, movimentações e descanso ANTES de invalidar; invalida Mapa, Detalhes, histórico e Cadastro de Lotes", async () => {
    const ordem = [];
    const refresh = vi.fn(async (chave, empresa, opcoes) => {
      ordem.push(`refresh:${chave}:${empresa}:${opcoes?.force === true}`);
      return [];
    });
    const { aposEscritaNoRebanho, CHAVES_DO_MAPA_DO_REBANHO } = await carregar(refresh);
    const client = new QueryClient();
    const chaves = [
      ["mapa-cache", "lotes", "emp-1", "default"],
      ["mapa-cache", "areas", "emp-1", "default"],
      ["mapa-lotes", "emp-1"],
      ["mapa-areas", "emp-1"],
      ["detalhes-lote-movimentacoes", "emp-1"],
      ["lotes-cadastro", "emp-1"],
      ["historico-movimentacoes", "x"],
      ["areas"],
    ];
    for (const k of chaves) client.setQueryData(k, [{ velho: true }]);
    client.setQueryData(["produtos", "emp-1"], [{ nada: true }]);
    const original = client.invalidateQueries.bind(client);
    client.invalidateQueries = vi.fn(async (f) => {
      ordem.push("invalidar");
      return original(f);
    });
    const eventos = [];
    const ouvir = (e) => eventos.push(e.detail);
    window.addEventListener("atualizar-mapa", ouvir);

    await aposEscritaNoRebanho(client, "emp-1");
    window.removeEventListener("atualizar-mapa", ouvir);

    expect(CHAVES_DO_MAPA_DO_REBANHO).toEqual(expect.arrayContaining(["lotes", "areas", "movimentacoes", "movimentacoesHistorico", "descansoPastos"]));
    for (const chave of CHAVES_DO_MAPA_DO_REBANHO) expect(ordem).toContain(`refresh:${chave}:emp-1:true`);
    // nenhuma consulta é invalidada antes de o IndexedDB estar novo
    expect(ordem.indexOf("invalidar")).toBeGreaterThan(Math.max(...CHAVES_DO_MAPA_DO_REBANHO.map((c) => ordem.indexOf(`refresh:${c}:emp-1:true`))));
    for (const k of chaves) expect(client.getQueryState(k)?.isInvalidated, k.join("/")).toBe(true);
    expect(client.getQueryState(["produtos", "emp-1"])?.isInvalidated).toBe(false);
    expect(eventos).toEqual([{ cacheKeys: [...CHAVES_DO_MAPA_DO_REBANHO], jaBuscado: true }]);
  });

  it("leitura do servidor que falha deixa a chave marcada: o Mapa Geral força de novo na próxima leitura", async () => {
    const refresh = vi.fn(async (chave) => {
      if (chave === "areas") throw new Error("rede");
      return [];
    });
    const { aposEscritaNoRebanho, mapaPrecisaBuscarNoServidor } = await carregar(refresh);
    await aposEscritaNoRebanho(new QueryClient(), "emp-1");
    expect(mapaPrecisaBuscarNoServidor("areas")).toBe(true);
    expect(mapaPrecisaBuscarNoServidor("lotes")).toBe(false);
  });

  it("outra aba: avisa pelo BroadcastChannel e a aba que recebe atualiza sem reenviar", async () => {
    const canais = [];
    class Canal {
      constructor(nome) {
        this.nome = nome;
        this.ouvintes = [];
        this.enviadas = [];
        canais.push(this);
      }
      postMessage(m) {
        this.enviadas.push(m);
      }
      addEventListener(_t, fn) {
        this.ouvintes.push(fn);
      }
      removeEventListener(_t, fn) {
        this.ouvintes = this.ouvintes.filter((f) => f !== fn);
      }
    }
    vi.stubGlobal("BroadcastChannel", Canal);
    try {
      const refresh = vi.fn(async () => []);
      const { aposEscritaNoRebanho, escutarRebanhoEntreAbas } = await carregar(refresh);
      await aposEscritaNoRebanho(new QueryClient(), "emp-1");
      expect(canais[0].nome).toBe("maike-rebanho");
      expect(canais[0].enviadas).toEqual([{ tipo: "rebanho-alterado", empresaId: "emp-1" }]);

      const outraAba = new QueryClient();
      outraAba.setQueryData(["mapa-lotes", "emp-1"], []);
      const desligar = escutarRebanhoEntreAbas(outraAba);
      refresh.mockClear();
      canais[0].enviadas = [];
      canais[0].ouvintes.forEach((fn) => fn({ data: { tipo: "rebanho-alterado", empresaId: "emp-1" } }));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(refresh).toHaveBeenCalledWith("lotes", "emp-1", { force: true });
      expect(outraAba.getQueryState(["mapa-lotes", "emp-1"])?.isInvalidated).toBe(true);
      expect(canais[0].enviadas).toEqual([]); // não volta a avisar (sem eco entre abas)
      desligar();
      expect(canais[0].ouvintes).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("todo manejo do rebanho passa pelo aposEscritaNoRebanho", () => {
  const fonte = (p) => readFileSync(p, "utf8");

  it("DetalhesLote: mover, morte/abate, nascimento/pesagem/mudança de categoria, junção, editar posição e renomear", () => {
    const s = fonte("src/components/mapa/DetalhesLote.jsx");
    expect(s.match(/aposEscritaNoRebanho\(queryClient, empresaSelecionadaId\)/g)?.length).toBeGreaterThanOrEqual(6);
    // nenhum caminho de manejo avisa só um pedaço do mapa
    expect(s).not.toMatch(/dispatchEvent\(new CustomEvent\('atualizar-mapa'/);
    // as consultas próprias do Detalhes não seguram o saldo por 1–5 min
    expect(s).not.toMatch(/queryKey: \['mapa-areas'[\s\S]{0,900}staleTime: 5 \* 60 \* 1000/);
  });

  it("exclusão de movimento e Cadastro de Lotes (entrada, correção, exclusão)", () => {
    expect(fonte("src/components/lotes/ExcluirMovimentacao.jsx")).toMatch(/await aposEscritaNoRebanho\(queryClient, movimento\.empresa_id\)/);
    expect(fonte("src/pages/CadastroLotes.jsx")).toMatch(/await aposEscritaNoRebanho\(queryClient, empresaSelecionadaId\)/);
  });

  it("a raiz do app escuta as outras abas", () => {
    expect(fonte("src/App.jsx")).toMatch(/escutarRebanhoEntreAbas\(queryClientInstance\)/);
  });
});
