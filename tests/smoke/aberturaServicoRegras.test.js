/**
 * D-PROD-332 — regras puras da abertura de serviço (marcador na observação, horímetro pt-BR, validação).
 */
import { describe, it, expect, vi } from "vitest";
import {
  aberturaDosApontamentos,
  apontamentosDaFrente,
  chaveDaFrente,
  frentesDosApontamentos,
  ehCampoDesconhecido,
  lerTodasAsPaginas,
  formatarHorimetro,
  lancamentosDoDia,
  lerAbertura,
  marcadorDaAbertura,
  observacaoComAbertura,
  parseHorimetroPtBr,
  textoDaObservacao,
  validarAbertura,
} from "@/lib/aberturaServicoRegras";

const ABERTURA = {
  bemId: "bem-7",
  implementoId: "imp-2",
  horimetro: "1245.0",
  responsavelId: "usr-3",
  bemNome: "Trator 12",
  implementoNome: "Pulverizador 2.000 L",
  responsavelNome: "João Pereira",
};

describe("marcadorDaAbertura / lerAbertura", () => {
  it("grava a linha com os campos na ordem e os nomes codificados (sem espaço dentro de um valor)", () => {
    const linha = marcadorDaAbertura(ABERTURA);
    expect(linha).toBe(
      "[abertura-servico bem=bem-7 impl=imp-2 hor=1245.0 resp=usr-3 bemn=Trator%2012 impln=Pulverizador%202.000%20L respn=Jo%C3%A3o%20Pereira]",
    );
  });

  it("omite os campos vazios (implemento opcional)", () => {
    const linha = marcadorDaAbertura({ ...ABERTURA, implementoId: "", implementoNome: "" });
    expect(linha).not.toMatch(/impl/);
    expect(linha).toMatch(/^\[abertura-servico bem=bem-7 hor=1245\.0 resp=usr-3/);
  });

  it("lê de volta os ids, o horímetro canônico e os nomes decodificados", () => {
    expect(lerAbertura(marcadorDaAbertura(ABERTURA))).toEqual(ABERTURA);
  });

  it("lê a abertura sem implemento (nomes vazios)", () => {
    const lida = lerAbertura(marcadorDaAbertura({ ...ABERTURA, implementoId: null, implementoNome: null }));
    expect(lida).toEqual({ ...ABERTURA, implementoId: "", implementoNome: "" });
  });

  it("devolve null sem linha, com horímetro inválido, sem máquina ou sem responsável", () => {
    expect(lerAbertura("")).toBeNull();
    expect(lerAbertura(null)).toBeNull();
    expect(lerAbertura("Chuva forte à tarde.")).toBeNull();
    expect(lerAbertura("[abertura-servico bem=b1 hor=1.245,0 resp=u1]")).toBeNull();
    expect(lerAbertura("[abertura-servico bem=b1 hor=12 resp=]")).toBeNull();
    expect(lerAbertura("[abertura-servico hor=12.0 resp=u1]")).toBeNull();
  });

  it("só a primeira linha conta: uma linha de abertura no meio do texto não vale", () => {
    expect(lerAbertura(`Obs\n${marcadorDaAbertura(ABERTURA)}`)).toBeNull();
  });
});

describe("textoDaObservacao / observacaoComAbertura", () => {
  it("tira só a linha de abertura e preserva o texto da pessoa", () => {
    const obs = `${marcadorDaAbertura(ABERTURA)}\nVento forte no fim do dia`;
    expect(textoDaObservacao(obs)).toBe("Vento forte no fim do dia");
    expect(textoDaObservacao("Só texto")).toBe("Só texto");
  });

  it("monta a observação com a abertura na 1ª linha e mantém o texto existente", () => {
    const atual = "Anotação antiga do dia";
    const nova = observacaoComAbertura(atual, ABERTURA);
    expect(nova.split("\n")[0]).toBe(marcadorDaAbertura(ABERTURA));
    expect(textoDaObservacao(nova)).toBe("Anotação antiga do dia");
    expect(lerAbertura(nova)).toEqual(ABERTURA);
  });

  it("troca a linha de abertura existente sem duplicar", () => {
    const antiga = observacaoComAbertura("texto", { ...ABERTURA, horimetro: "10.0" });
    const nova = observacaoComAbertura(antiga, ABERTURA);
    expect(nova.match(/\[abertura-servico/g)).toHaveLength(1);
    expect(lerAbertura(nova)?.horimetro).toBe("1245.0");
    expect(textoDaObservacao(nova)).toBe("texto");
  });

  it("sem texto da pessoa, a observação é só a linha", () => {
    expect(observacaoComAbertura("", ABERTURA)).toBe(marcadorDaAbertura(ABERTURA));
  });
});

describe("horímetro pt-BR", () => {
  it('"1.245,0" vira "1245.0" e volta para "1.245,0"', () => {
    expect(parseHorimetroPtBr("1.245,0")).toBe("1245.0");
    expect(formatarHorimetro("1245.0")).toBe("1.245,0");
  });

  it("aceita decimal com mais casas e sem separador de milhar", () => {
    expect(parseHorimetroPtBr("980,25")).toBe("980.25");
    expect(parseHorimetroPtBr("7")).toBe("7.0");
    expect(formatarHorimetro("0.5")).toBe("0,5");
  });

  it("recusa vazio, negativo, texto e formato de milhar errado", () => {
    expect(parseHorimetroPtBr("")).toBeNull();
    expect(parseHorimetroPtBr("-3")).toBeNull();
    expect(parseHorimetroPtBr("abc")).toBeNull();
    expect(parseHorimetroPtBr("1.24,0")).toBeNull();
  });

  it("formatarHorimetro sem valor canônico devolve vazio", () => {
    expect(formatarHorimetro(null)).toBe("");
    expect(formatarHorimetro("12,5")).toBe("");
  });
});

describe("validarAbertura", () => {
  const ok = { operacaoId: "op-1", pedirOperacao: true, bemId: "bem-7", horimetro: "1.245,0", responsavelId: "usr-3" };

  it("sem erros quando tudo está preenchido", () => {
    expect(validarAbertura(ok)).toEqual({});
  });

  it("o implemento é opcional", () => {
    expect(validarAbertura({ ...ok, implementoId: "" })).toEqual({});
  });

  it("aponta cada campo obrigatório com a frase da tela", () => {
    expect(validarAbertura({ bemId: "", horimetro: "", responsavelId: "" })).toEqual({
      bemId: "Escolha a máquina.",
      horimetro: "Informe o horímetro inicial.",
      responsavelId: "Escolha o responsável.",
    });
  });

  it("horímetro inválido é erro do horímetro", () => {
    expect(validarAbertura({ ...ok, horimetro: "-1" }).horimetro).toBe("Informe o horímetro inicial.");
  });

  it("a operação só é exigida quando há mais de uma", () => {
    expect(validarAbertura({ ...ok, operacaoId: "", pedirOperacao: true }).operacaoId).toBe("Escolha a operação.");
    expect(validarAbertura({ ...ok, operacaoId: "", pedirOperacao: false })).toEqual({});
  });

  it("D-PROD-332 (emenda): o capim é exigido só com pedirCapim; sem o capim, a frase da tela", () => {
    expect(validarAbertura({ ...ok, pedirCapim: true, culturaId: "" }).culturaId).toBe("Escolha o capim.");
    expect(validarAbertura({ ...ok, pedirCapim: true, culturaId: undefined })).toEqual({ culturaId: "Escolha o capim." });
  });

  it("D-PROD-332 (emenda): com o capim, ou com pedirCapim false/omitido, não há erro de capim", () => {
    expect(validarAbertura({ ...ok, pedirCapim: true, culturaId: "cul-1" })).toEqual({});
    expect(validarAbertura({ ...ok, pedirCapim: false, culturaId: "" })).toEqual({});
    expect(validarAbertura({ ...ok, culturaId: "" })).toEqual({});
  });
});

describe("aberturaDosApontamentos", () => {
  it("acha a abertura mais recente, ignora cancelados e observações sem linha", () => {
    const antiga = marcadorDaAbertura({ ...ABERTURA, horimetro: "1000.0" });
    const recente = marcadorDaAbertura(ABERTURA);
    const itens = [
      { data_operacional: "2026-11-24", observacao: antiga, status: "CONFIRMADO" },
      { data_operacional: "2026-11-26", observacao: recente, status: "CONFIRMADO" },
      { data_operacional: "2026-11-27", observacao: marcadorDaAbertura({ ...ABERTURA, horimetro: "9.0" }), status: "CANCELADO" },
      { data_operacional: "2026-11-25", observacao: "sem linha", status: "CONFIRMADO" },
    ];
    expect(aberturaDosApontamentos(itens)?.horimetro).toBe("1245.0");
  });

  it("sem nenhuma abertura, null", () => {
    expect(aberturaDosApontamentos([{ data_operacional: "2026-11-26", observacao: "x" }])).toBeNull();
    expect(aberturaDosApontamentos(undefined)).toBeNull();
  });
});

describe("lancamentosDoDia — \"Lançado hoje\" do serviço aberto (D-PROD-332, tela 05)", () => {
  const HOJE = "2026-11-26";
  const FUSO = "America/Sao_Paulo";
  // 07:45 de São Paulo (UTC-3) = 10:45Z.
  const produto = (id, extra = {}) => ({ id, status: "CONFIRMADO", produto: { nome: "Glifosato" }, quantidade: "1000.0000", unidade: "L", createdAt: "2026-11-26T10:45:00.000Z", ...extra });
  const apontamento = (extra = {}) => ({ id: "ap-1", data_operacional: HOJE, status: "CONFIRMADO", createdAt: "2026-11-26T10:00:00.000Z", produtos: [], maquinas: [], mao_obra: [], servicos: [], ...extra });

  it("sem apontamentos ou sem nada de hoje, a lista é vazia", () => {
    expect(lancamentosDoDia([], HOJE, FUSO)).toEqual([]);
    expect(lancamentosDoDia(undefined, HOJE, FUSO)).toEqual([]);
    expect(lancamentosDoDia([apontamento({ data_operacional: "2026-11-25", produtos: [produto("pl-1")] })], HOJE, FUSO)).toEqual([]);
  });

  it("uma linha por linha CONFIRMADA: insumo com a carga, a hora no fuso da fazenda e a quantidade em pt-BR", () => {
    const [linha] = lancamentosDoDia([apontamento({ produtos: [produto("pl-1", { jato: 1 })] })], HOJE, FUSO);
    expect(linha).toMatchObject({ tipo: "insumo", hora: "07:45", titulo: "Insumo · Carga 1", sub: "Glifosato", quantidade: "1.000 L" });
  });

  it("a unidade do insumo sai como o cadastro rotula (KG vira kg; SACO, kg)", () => {
    const [linha] = lancamentosDoDia([apontamento({ produtos: [produto("pl-2", { jato: 2, quantidade: "24.0000", unidade: "KG" })] })], HOJE, FUSO);
    expect(linha).toMatchObject({ titulo: "Insumo · Carga 2", quantidade: "24 kg" });
  });

  it("ordena pela hora e cobre máquina, mão de obra (com a medida) e serviço de terceiro", () => {
    const linhas = lancamentosDoDia(
      [
        apontamento({
          produtos: [produto("pl-1")],
          maquinas: [{ id: "ml-1", status: "CONFIRMADO", bem: { nome: "Trator 12" }, quantidade_uso: "3.5000", medidor_unidade: "h", createdAt: "2026-11-26T13:00:00.000Z" }],
          mao_obra: [{ id: "mo-1", status: "CONFIRMADO", parceiro: { nome: "Pedro" }, tipo_medida: "HORA", quantidade: "8.0000", createdAt: "2026-11-26T12:20:00.000Z" }],
          servicos: [{ id: "sv-1", status: "CONFIRMADO", servico: { nome: "Frete" }, quantidade: "2.0000", unidade: "viagem", createdAt: "2026-11-26T14:00:00.000Z" }],
        }),
      ],
      HOJE,
      FUSO,
    );
    expect(linhas.map((l) => [l.hora, l.tipo, l.titulo, l.sub, l.quantidade])).toEqual([
      ["07:45", "insumo", "Insumo", "Glifosato", "1.000 L"],
      ["09:20", "mao_obra", "Mão de obra", "Pedro", "8 h"],
      ["10:00", "maquina", "Máquina", "Trator 12", "3,5 h"],
      ["11:00", "servico", "Serviço de terceiro", "Frete", "2 viagem"],
    ]);
  });

  it("ignora linhas CANCELADAS e apontamentos CANCELADOS, e nunca traz valor em R$", () => {
    const linhas = lancamentosDoDia(
      [
        apontamento({ produtos: [produto("pl-1", { status: "CANCELADO", custo_total: "99.0000" }), produto("pl-2", { custo_total: "250.0000" })] }),
        apontamento({ id: "ap-2", status: "CANCELADO", produtos: [produto("pl-3")] }),
      ],
      HOJE,
      FUSO,
    );
    expect(linhas).toHaveLength(1);
    expect(JSON.stringify(linhas.map(({ instante, ...r }) => r))).not.toMatch(/R\$|custo|250|99/);
  });

  it("a hora cai no apontamento quando a linha não tem createdAt; sem nenhum instante, a hora fica vazia e a linha vai para o fim", () => {
    const linhas = lancamentosDoDia(
      [
        apontamento({ createdAt: "2026-11-26T12:30:00.000Z", produtos: [{ id: "pl-1", status: "CONFIRMADO", produto: { nome: "A" }, quantidade: "1.0000", unidade: "L" }] }),
        apontamento({ id: "ap-2", createdAt: null, produtos: [{ id: "pl-2", status: "CONFIRMADO", produto: { nome: "B" }, quantidade: "2.0000", unidade: "KG" }] }),
      ],
      HOJE,
      FUSO,
    );
    expect(linhas[0]).toMatchObject({ hora: "09:30", sub: "A", quantidade: "1 L" });
    expect(linhas[1]).toMatchObject({ hora: "", sub: "B", quantidade: "2 kg" });
  });
});


describe("lerTodasAsPaginas (D-PROD-332 emenda)", () => {
  it("junta duas páginas: a 1ª chamada é listar({}) e a 2ª passa o cursor", async () => {
    const listar = vi.fn(async (opts) =>
      opts.cursor === "c2"
        ? { itens: [{ id: "bem-2", nome: "Trator 08" }], has_more: false, next_cursor: null }
        : { itens: [{ id: "bem-1", nome: "Trator 12" }], has_more: true, next_cursor: "c2" },
    );
    const r = await lerTodasAsPaginas(listar);
    expect(r).toEqual({ itens: [{ id: "bem-1", nome: "Trator 12" }, { id: "bem-2", nome: "Trator 08" }], has_more: false, next_cursor: null });
    expect(listar.mock.calls).toEqual([[{}], [{ cursor: "c2" }]]);
  });

  it("para quando has_more é falso (uma página só, sem 2ª chamada)", async () => {
    const listar = vi.fn(async () => ({ itens: [{ id: "a" }], has_more: false, next_cursor: "ignorado" }));
    const r = await lerTodasAsPaginas(listar);
    expect(r.itens).toEqual([{ id: "a" }]);
    expect(listar).toHaveBeenCalledTimes(1);
  });

  it("para quando has_more é verdadeiro mas não há next_cursor (sem laço infinito)", async () => {
    const listar = vi.fn(async () => ({ itens: [{ id: "a" }], has_more: true, next_cursor: null }));
    await lerTodasAsPaginas(listar);
    expect(listar).toHaveBeenCalledTimes(1);
  });

  it("para no limite de páginas", async () => {
    const listar = vi.fn(async () => ({ itens: [{ id: "x" }], has_more: true, next_cursor: "sempre" }));
    const r = await lerTodasAsPaginas(listar, 3);
    expect(listar).toHaveBeenCalledTimes(3);
    expect(r.itens).toHaveLength(3);
  });
});

describe("ehCampoDesconhecido (D-PROD-332 emenda)", () => {
  // O ApiError guarda o contexto do servidor em `details` (e `cause`), que é o que o lerErroGestao lê.
  const recusa = (field, reason = "unknown_field") => ({ name: "ApiError", code: "REQUEST_VALIDATION_FAILED", details: { field, reason } });

  it("reconhece o campo desconhecido pedido", () => {
    expect(ehCampoDesconhecido(recusa("bem_id"), "bem_id")).toBe(true);
  });

  it("lê também o campo na causa (cause.field / cause.reason)", () => {
    const erro = { code: "REQUEST_VALIDATION_FAILED", cause: { field: "bem_id", reason: "unknown_field" } };
    expect(ehCampoDesconhecido(erro, "bem_id")).toBe(true);
  });

  it("reconhece o formato real do ApiError (código público API_INVALID_ARGUMENT e causa com o código do servidor)", () => {
    const erro = { name: "ApiError", code: "API_INVALID_ARGUMENT", cause: { code: "REQUEST_VALIDATION_FAILED", field: "bem_id", reason: "unknown_field", message: "requisição inválida" } };
    expect(ehCampoDesconhecido(erro, "bem_id")).toBe(true);
    expect(ehCampoDesconhecido(erro, "outro")).toBe(false);
  });

  it("não é o campo pedido, outra razão ou outro código: false", () => {
    expect(ehCampoDesconhecido(recusa("outro_campo"), "bem_id")).toBe(false);
    expect(ehCampoDesconhecido(recusa("bem_id", "required"), "bem_id")).toBe(false);
    expect(ehCampoDesconhecido({ code: "ATIVIDADE_REFERENCIA_INVALIDA", details: { field: "bem_id", reason: "unknown_field" } }, "bem_id")).toBe(false);
    expect(ehCampoDesconhecido(null, "bem_id")).toBe(false);
    expect(ehCampoDesconhecido(new Error("rede"), "bem_id")).toBe(false);
  });
});

// ─── Frentes: uma abertura por máquina + implemento (D-PROD-335, emenda) ─────

describe("frentes: uma abertura por máquina + implemento (D-PROD-335)", () => {
  const obs = (bemId, bemNome, implementoId = "", implementoNome = "", horimetro = "1000.0") =>
    marcadorDaAbertura({ bemId, bemNome, implementoId, implementoNome, horimetro, responsavelId: "usr-3", responsavelNome: "João Pereira" });
  /** Três máquinas na MESMA atividade, em dias diferentes; a Trator 12 tem duas leituras (a do dia 20 é a mais recente). */
  const ITENS = [
    { id: "a1", data_operacional: "2026-11-02", status: "CONFIRMADO", observacao: obs("bem-7", "Trator 12", "imp-2", "Pulverizador", "1000.0") },
    { id: "a2", data_operacional: "2026-11-20", status: "CONFIRMADO", observacao: obs("bem-7", "Trator 12", "imp-2", "Pulverizador", "1200.0") },
    { id: "b1", data_operacional: "2026-11-10", status: "CONFIRMADO", observacao: obs("bem-8", "Trator 08", "", "", "900.0") },
    { id: "c1", data_operacional: "2026-11-15", status: "CONFIRMADO", observacao: obs("bem-9", "Trator 09", "imp-2", "Pulverizador", "50.0") },
    { id: "c2", data_operacional: "2026-11-26", status: "CONFIRMADO", observacao: "Só texto, sem abertura" },
    { id: "x1", data_operacional: "2026-11-01", status: "CANCELADO", observacao: obs("bem-10", "Trator 10", "", "", "5.0") },
  ];

  it("chaveDaFrente: máquina|implemento; implemento vazio vale como chave própria", () => {
    expect(chaveDaFrente({ bemId: "bem-7", implementoId: "imp-2" })).toBe("bem-7|imp-2");
    expect(chaveDaFrente({ bemId: "bem-7", implementoId: "" })).toBe("bem-7|");
    expect(chaveDaFrente({ bemId: "bem-7" })).toBe("bem-7|");
    expect(chaveDaFrente({ bemId: "bem-7", implementoId: "imp-2" })).not.toBe(chaveDaFrente({ bemId: "bem-7", implementoId: "" }));
  });

  it("frentesDosApontamentos: uma frente por chave, com a leitura mais recente e o início (menor dia), por início", () => {
    const frentes = frentesDosApontamentos(ITENS);
    // Trator 12 (início 02/11), Trator 09 (15/11), Trator 08 (10/11): ordenadas por início → 02/11, 10/11, 15/11.
    expect(frentes.map((f) => f.chave)).toEqual(["bem-7|imp-2", "bem-8|", "bem-9|imp-2"]);
    const trator12 = frentes[0];
    expect(trator12.inicio).toBe("2026-11-02");
    expect(trator12.abertura.horimetro).toBe("1200.0");
    expect(frentes[1].inicio).toBe("2026-11-10");
    expect(frentes[2].abertura.bemNome).toBe("Trator 09");
  });

  it("frentesDosApontamentos: ignora cancelados e apontamentos sem abertura; sem nenhuma, []", () => {
    expect(frentesDosApontamentos(ITENS).some((f) => f.chave === "bem-10|")).toBe(false);
    expect(frentesDosApontamentos([{ id: "t", data_operacional: "2026-11-26", status: "CONFIRMADO", observacao: "Só texto" }])).toEqual([]);
    expect(frentesDosApontamentos(null)).toEqual([]);
  });

  it("apontamentosDaFrente: só os apontamentos (não cancelados) com a chave dela, nos dias diferentes", () => {
    const da12 = apontamentosDaFrente(ITENS, "bem-7|imp-2").map((a) => a.id);
    expect(da12).toEqual(["a1", "a2"]);
    expect(apontamentosDaFrente(ITENS, "bem-8|").map((a) => a.id)).toEqual(["b1"]);
    // Mesma máquina com outro implemento (ou sem) é outra frente.
    expect(apontamentosDaFrente(ITENS, "bem-7|")).toEqual([]);
    expect(apontamentosDaFrente(ITENS, "bem-10|")).toEqual([]);
    expect(apontamentosDaFrente(ITENS, null)).toEqual([]);
  });

  it("aberturaDosApontamentos continua igual (usado por quem não filtra por frente)", () => {
    expect(aberturaDosApontamentos(ITENS)?.bemId).toBe("bem-7");
  });
});
