/**
 * D-PROD-332 — regras puras da abertura de serviço (marcador na observação, horímetro pt-BR, validação).
 */
import { describe, it, expect, vi } from "vitest";
import {
  aberturaDosApontamentos,
  apontamentosDaFrente,
  chaveDaFrente,
  frentesDosApontamentos,
  horasDaFrenteNoDia,
  textoDasHorasHoje,
  ehCampoDesconhecido,
  lerEncerramento,
  lerTodasAsPaginas,
  formatarHorimetro,
  lancamentosDoDia,
  lerAbertura,
  marcadorDaAbertura,
  marcadorDoEncerramento,
  observacaoComAbertura,
  observacaoComEncerramento,
  parseHorimetroPtBr,
  resumoDasFrentes,
  textoDaObservacao,
  textoDasMaquinasEmCampo,
  validarAbertura,
  validarEncerramento,
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

// ─── Frentes: uma abertura por máquina + implemento (D-PROD-341, emenda) ─────

describe("frentes: uma abertura por máquina + implemento (D-PROD-341)", () => {
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

// ─── Encerramento de uma frente (D-PROD-348) ─────

describe("marcadorDoEncerramento / lerEncerramento (D-PROD-348)", () => {
  const ENC = { bemId: "bem-7", implementoId: "imp-2", horimetro: "1290.5", bemNome: "Trator 12", implementoNome: "Pulverizador 2.000 L" };

  it("grava a linha com os campos na ordem, sem responsável, e os nomes codificados", () => {
    expect(marcadorDoEncerramento(ENC)).toBe(
      "[encerramento-servico bem=bem-7 impl=imp-2 hor=1290.5 bemn=Trator%2012 impln=Pulverizador%202.000%20L]",
    );
  });

  it("omite os campos vazios (implemento opcional)", () => {
    const linha = marcadorDoEncerramento({ ...ENC, implementoId: "", implementoNome: "" });
    expect(linha).toBe("[encerramento-servico bem=bem-7 hor=1290.5 bemn=Trator%2012]");
    expect(lerEncerramento(linha)).toEqual({ bemId: "bem-7", implementoId: "", horimetro: "1290.5", bemNome: "Trator 12", implementoNome: "" });
  });

  it("ida e volta com acentos e espaços no nome da máquina e do implemento", () => {
    const comAcento = { ...ENC, bemNome: "Trator Ç/Ã — nº 12", implementoNome: "Plantadeira [dupla] = 3 linhas" };
    expect(lerEncerramento(marcadorDoEncerramento(comAcento))).toEqual({
      bemId: "bem-7",
      implementoId: "imp-2",
      horimetro: "1290.5",
      bemNome: "Trator Ç/Ã — nº 12",
      implementoNome: "Plantadeira [dupla] = 3 linhas",
    });
  });

  it("lê a linha só com a máquina (sem implemento) e o horímetro inteiro com .0", () => {
    const lida = lerEncerramento(`[encerramento-servico bem=bem-8 hor=900.0]\nFim do dia`);
    expect(lida).toEqual({ bemId: "bem-8", implementoId: "", horimetro: "900.0", bemNome: "", implementoNome: "" });
  });

  it("tag inválida: sem máquina, sem horímetro, horímetro não canônico ou com texto antes: null", () => {
    expect(lerEncerramento("")).toBeNull();
    expect(lerEncerramento(null)).toBeNull();
    expect(lerEncerramento("Encerrou cedo")).toBeNull();
    expect(lerEncerramento("[encerramento-servico hor=1290.5]")).toBeNull();
    expect(lerEncerramento("[encerramento-servico bem=bem-7]")).toBeNull();
    expect(lerEncerramento("[encerramento-servico bem=bem-7 hor=1.290,5]")).toBeNull();
    expect(lerEncerramento("[encerramento-servico bem=bem-7 hor=]")).toBeNull();
    expect(lerEncerramento("Obs\n[encerramento-servico bem=bem-7 hor=1290.5]")).toBeNull();
  });

  it("encerramento e abertura nunca se leem uma como a outra", () => {
    const abertura = marcadorDaAbertura({ bemId: "bem-7", horimetro: "1245.0", responsavelId: "usr-3" });
    const encerramento = marcadorDoEncerramento({ bemId: "bem-7", horimetro: "1290.5" });
    expect(lerEncerramento(abertura)).toBeNull();
    expect(lerAbertura(encerramento)).toBeNull();
    expect(lerEncerramento(encerramento)?.horimetro).toBe("1290.5");
    expect(lerAbertura(abertura)?.horimetro).toBe("1245.0");
  });

  it("textoDaObservacao tira a linha de encerramento e preserva o texto da pessoa", () => {
    const obs = `${marcadorDoEncerramento({ bemId: "bem-7", horimetro: "1290.5" })}\nChuva à tarde`;
    expect(textoDaObservacao(obs)).toBe("Chuva à tarde");
    expect(textoDaObservacao(marcadorDoEncerramento({ bemId: "bem-7", horimetro: "1.0" }))).toBe("");
  });

  it("observacaoComEncerramento põe a linha na 1ª posição, mantém o texto e troca a linha existente sem duplicar", () => {
    const nova = observacaoComEncerramento("Texto antigo", { bemId: "bem-7", horimetro: "1290.5" });
    expect(nova.split("\n")[0]).toBe(marcadorDoEncerramento({ bemId: "bem-7", horimetro: "1290.5" }));
    expect(textoDaObservacao(nova)).toBe("Texto antigo");
    const trocada = observacaoComEncerramento(nova, { bemId: "bem-7", horimetro: "1300.0" });
    expect(trocada.match(/\[encerramento-servico/g)).toHaveLength(1);
    expect(lerEncerramento(trocada)?.horimetro).toBe("1300.0");
    expect(observacaoComEncerramento("", { bemId: "bem-7", horimetro: "1.0" })).toBe("[encerramento-servico bem=bem-7 hor=1.0]");
  });
});

describe("validarEncerramento (D-PROD-348)", () => {
  it("horímetro final vazio ou inválido: \"Informe o horímetro final.\"", () => {
    expect(validarEncerramento({ horimetroFinal: "", horimetroInicial: "1245.0" })).toEqual({ horimetroFinal: "Informe o horímetro final." });
    expect(validarEncerramento({ horimetroFinal: "-3", horimetroInicial: "1245.0" })).toEqual({ horimetroFinal: "Informe o horímetro final." });
    expect(validarEncerramento({ horimetroFinal: "abc", horimetroInicial: "1245.0" })).toEqual({ horimetroFinal: "Informe o horímetro final." });
    expect(validarEncerramento({})).toEqual({ horimetroFinal: "Informe o horímetro final." });
  });

  it("menor que o inicial: a mensagem traz o inicial em pt-BR", () => {
    expect(validarEncerramento({ horimetroFinal: "1.200,0", horimetroInicial: "1245.0" })).toEqual({
      horimetroFinal: "O horímetro final não pode ser menor que o inicial (1.245,0).",
    });
  });

  it("compara como número: 1.300 é maior que 1.245,5 (não é comparação de texto)", () => {
    expect(validarEncerramento({ horimetroFinal: "1.300", horimetroInicial: "1245.5" })).toEqual({});
    expect(validarEncerramento({ horimetroFinal: "999,9", horimetroInicial: "1245.5" }).horimetroFinal).toMatch(/menor que o inicial \(1\.245,5\)/);
  });

  it("igual ao inicial é válido; maior também; inicial de casas diferentes compara certo", () => {
    expect(validarEncerramento({ horimetroFinal: "1.245,0", horimetroInicial: "1245.0" })).toEqual({});
    expect(validarEncerramento({ horimetroFinal: "1245,0001", horimetroInicial: "1245.0" })).toEqual({});
    expect(validarEncerramento({ horimetroFinal: "1245,5", horimetroInicial: "1245.50" })).toEqual({});
    expect(validarEncerramento({ horimetroFinal: "1245,4", horimetroInicial: "1245.50" }).horimetroFinal).toMatch(/menor/);
  });

  it("sem horímetro inicial canônico, a comparação é pulada (só o final é validado)", () => {
    expect(validarEncerramento({ horimetroFinal: "10", horimetroInicial: "" })).toEqual({});
    expect(validarEncerramento({ horimetroFinal: "10", horimetroInicial: "1.245,0" })).toEqual({});
  });
});

describe("resumoDasFrentes / textoDasMaquinasEmCampo (D-PROD-348)", () => {
  it("conta abertas, encerradas e o total", () => {
    expect(resumoDasFrentes([{ encerrada: false }, { encerrada: true }, { encerrada: false }])).toEqual({ abertas: 2, encerradas: 1, total: 3 });
    expect(resumoDasFrentes([])).toEqual({ abertas: 0, encerradas: 0, total: 0 });
    expect(resumoDasFrentes(undefined)).toEqual({ abertas: 0, encerradas: 0, total: 0 });
  });

  it("o texto do cabeçalho: sem máquina, 1 máquina e N máquinas", () => {
    expect(textoDasMaquinasEmCampo(0)).toBe("Sem máquina em campo");
    expect(textoDasMaquinasEmCampo(1)).toBe("1 máquina em campo");
    expect(textoDasMaquinasEmCampo(3)).toBe("3 máquinas em campo");
    expect(textoDasMaquinasEmCampo(-2)).toBe("Sem máquina em campo");
  });
});

describe("frentes com encerramento (D-PROD-348)", () => {
  const abre = (dia, bemId, bemNome, implementoId = "", horimetro = "1000.0", id = `ab-${dia}-${bemId}`) => ({
    id,
    data_operacional: dia,
    status: "CONFIRMADO",
    observacao: marcadorDaAbertura({ bemId, bemNome, implementoId, implementoNome: implementoId ? "Pulverizador" : "", horimetro, responsavelId: "usr-3", responsavelNome: "João" }),
  });
  const encerra = (dia, bemId, horimetro, implementoId = "", status = "CONFIRMADO", id = `en-${dia}-${bemId}`) => ({
    id,
    data_operacional: dia,
    status,
    observacao: marcadorDoEncerramento({ bemId, implementoId, horimetro, bemNome: "", implementoNome: "" }),
  });

  it("2 frentes: uma encerra e a outra segue aberta; a encerrada traz o horímetro final e o dia", () => {
    const itens = [
      abre("2026-11-02", "bem-7", "Trator 12", "imp-2", "1000.0", "a1"),
      abre("2026-11-03", "bem-8", "Trator 08", "", "900.0", "b1"),
      encerra("2026-11-05", "bem-7", "1080.5", "imp-2", "CONFIRMADO", "e1"),
    ];
    const frentes = frentesDosApontamentos(itens);
    expect(frentes.map((f) => [f.chave, f.encerrada, f.horimetroFinal, f.fim, f.inicio])).toEqual([
      ["bem-7|imp-2", true, "1080.5", "2026-11-05", "2026-11-02"],
      ["bem-8|", false, "", "", "2026-11-03"],
    ]);
    expect(resumoDasFrentes(frentes)).toEqual({ abertas: 1, encerradas: 1, total: 2 });
  });

  it("encerramento sem abertura com a mesma chave é ignorado (não cria frente)", () => {
    const frentes = frentesDosApontamentos([encerra("2026-11-05", "bem-9", "50.0", "imp-2")]);
    expect(frentes).toEqual([]);
  });

  it("encerramento de OUTRA chave não fecha a frente; a mesma máquina com outro implemento é outra frente", () => {
    const itens = [
      abre("2026-11-02", "bem-7", "Trator 12", "imp-2", "1000.0"),
      encerra("2026-11-05", "bem-7", "1100.0", ""),
    ];
    const frentes = frentesDosApontamentos(itens);
    expect(frentes).toHaveLength(1);
    expect(frentes[0]).toMatchObject({ chave: "bem-7|imp-2", encerrada: false, horimetroFinal: "", fim: "" });
  });

  it("apontamento de encerramento CANCELADO não conta (a frente segue aberta)", () => {
    const itens = [abre("2026-11-02", "bem-7", "Trator 12", "imp-2"), encerra("2026-11-05", "bem-7", "1080.0", "imp-2", "CANCELADO")];
    expect(frentesDosApontamentos(itens)[0]).toMatchObject({ encerrada: false, horimetroFinal: "", fim: "" });
  });

  it("encerramento ANTERIOR ao início da frente não fecha (o dia tem que ser o da abertura ou depois)", () => {
    const itens = [abre("2026-11-10", "bem-7", "Trator 12", "imp-2"), encerra("2026-11-05", "bem-7", "1080.0", "imp-2")];
    expect(frentesDosApontamentos(itens)[0]).toMatchObject({ encerrada: false });
  });

  it("encerramento no MESMO dia da abertura fecha a frente", () => {
    const itens = [abre("2026-11-02", "bem-7", "Trator 12", "imp-2"), encerra("2026-11-02", "bem-7", "1010.0", "imp-2")];
    expect(frentesDosApontamentos(itens)[0]).toMatchObject({ encerrada: true, horimetroFinal: "1010.0", fim: "2026-11-02" });
  });

  it("frente reaberta depois de um encerramento: o encerramento antigo não fecha a nova abertura", () => {
    const itens = [
      abre("2026-11-02", "bem-7", "Trator 12", "imp-2", "1000.0", "a1"),
      encerra("2026-11-05", "bem-7", "1080.0", "imp-2"),
      abre("2026-11-20", "bem-7", "Trator 12", "imp-2", "1100.0", "a2"),
    ];
    const frente = frentesDosApontamentos(itens)[0];
    expect(frente).toMatchObject({ chave: "bem-7|imp-2", inicio: "2026-11-02", encerrada: false, horimetroFinal: "", fim: "" });
    expect(frente.abertura.horimetro).toBe("1100.0");
  });

  it("frente reaberta e encerrada de novo: vale o encerramento do ciclo atual", () => {
    const itens = [
      abre("2026-11-02", "bem-7", "Trator 12", "imp-2", "1000.0", "a1"),
      encerra("2026-11-05", "bem-7", "1080.0", "imp-2"),
      abre("2026-11-20", "bem-7", "Trator 12", "imp-2", "1100.0", "a2"),
      encerra("2026-11-22", "bem-7", "1150.0", "imp-2"),
    ];
    expect(frentesDosApontamentos(itens)[0]).toMatchObject({ encerrada: true, horimetroFinal: "1150.0", fim: "2026-11-22" });
  });

  it("apontamentosDaFrente não traz o encerramento (ele não é abertura)", () => {
    const itens = [abre("2026-11-02", "bem-7", "Trator 12", "imp-2", "1000.0", "a1"), encerra("2026-11-05", "bem-7", "1080.0", "imp-2", "CONFIRMADO", "e1")];
    expect(apontamentosDaFrente(itens, "bem-7|imp-2").map((a) => a.id)).toEqual(["a1"]);
  });

  it("aberturaDosApontamentos continua ignorando o encerramento", () => {
    const itens = [abre("2026-11-02", "bem-7", "Trator 12", "imp-2", "1000.0", "a1"), encerra("2026-11-09", "bem-7", "1080.0", "imp-2")];
    expect(aberturaDosApontamentos(itens)?.horimetro).toBe("1000.0");
  });
});

// ─── D-PROD-348 (item 1): as horas da frente no dia ─────

describe("horasDaFrenteNoDia / textoDasHorasHoje (o \"Hoje\" do cartão da frente)", () => {
  const DIA = "2026-11-26";
  const ONTEM = "2026-11-25";
  const CHAVE = "bem-7|";
  /** A abertura da frente (Trator 12, sem implemento), com horímetro inicial 1000,0. */
  const ABRE = marcadorDaAbertura({ bemId: "bem-7", bemNome: "Trator 12", horimetro: "1000.0", responsavelId: "usr-3", responsavelNome: "João" });
  /** Um apontamento com a observação e as linhas dadas (status CONFIRMADO por padrão). */
  const apontamento = (id, dia, observacao, { produtos = [], maquinas = [], status = "CONFIRMADO" } = {}) => ({ id, data_operacional: dia, status, createdAt: `${dia}T09:00:00.000Z`, observacao, produtos, maquinas, mao_obra: [], servicos: [] });
  /** Uma linha de produto (carga) com o horímetro da carga na observação. */
  const carga = (id, horimetro = null) => ({ id, status: "CONFIRMADO", produto: { nome: "Glifosato" }, quantidade: "10.0000", unidade: "L", jato: 1, observacao: horimetro ? `[carga hor=${horimetro}]` : null, createdAt: `${DIA}T10:00:00.000Z` });
  /** Uma linha de máquina com leitura inicial e final (canônicas). */
  const maquina = (id, inicial, final, status = "CONFIRMADO") => ({ id, status, bem: { nome: "Trator 12" }, leitura_inicial: inicial, leitura_final: final, createdAt: `${DIA}T08:00:00.000Z` });

  it("zero: sem nenhum lançamento CONFIRMADO da frente no dia → null (Nada hoje)", () => {
    expect(horasDaFrenteNoDia([apontamento("a", ONTEM, ABRE)], CHAVE, DIA, "1000.0")).toBeNull();
    expect(horasDaFrenteNoDia([], CHAVE, DIA, "1000.0")).toBeNull();
  });

  it("uma leitura: a carga de hoje lê 1100,0 com abertura em 1000,0 → 100 h", () => {
    const itens = [apontamento("a", DIA, ABRE, { produtos: [carga("l1", "1100.0")] })];
    expect(horasDaFrenteNoDia(itens, CHAVE, DIA, "1000.0")).toBe("100.0000");
  });

  it("várias leituras de máquina: soma (final − inicial) de cada linha confirmada do dia", () => {
    const itens = [
      apontamento("a", DIA, ABRE, { maquinas: [maquina("m1", "1000.0", "1040.5")] }),
      apontamento("b", DIA, ABRE, { maquinas: [maquina("m2", "1040.5", "1052.25")] }),
    ];
    expect(horasDaFrenteNoDia(itens, CHAVE, DIA, "1000.0")).toBe("52.2500");
  });

  it("várias cargas no dia: o MAIOR horímetro lido hoje menos a base (a abertura)", () => {
    const itens = [
      apontamento("a", DIA, ABRE, { produtos: [carga("l1", "1030.0")] }),
      apontamento("b", DIA, ABRE, { produtos: [carga("l2", "1045.5")] }),
    ];
    expect(horasDaFrenteNoDia(itens, CHAVE, DIA, "1000.0")).toBe("45.5000");
  });

  it("a base é o último horímetro lido ANTES de hoje (não a abertura), quando houver", () => {
    const itens = [
      apontamento("a", ONTEM, ABRE, { produtos: [carga("l0", "1050.0")] }),
      apontamento("b", DIA, ABRE, { produtos: [carga("l1", "1100.0")] }),
    ];
    expect(horasDaFrenteNoDia(itens, CHAVE, DIA, "1000.0")).toBe("50.0000");
  });

  it("horímetro que não anda: lido hoje igual à base → 0 (com lançamento no dia)", () => {
    const itens = [apontamento("a", DIA, ABRE, { produtos: [carga("l1", "1000.0")] })];
    expect(horasDaFrenteNoDia(itens, CHAVE, DIA, "1000.0")).toBe("0.0000");
    expect(textoDasHorasHoje(horasDaFrenteNoDia(itens, CHAVE, DIA, "1000.0"))).toBe("0 h");
  });

  it("linha de máquina em que o medidor anda para trás não entra na soma", () => {
    const itens = [apontamento("a", DIA, ABRE, { maquinas: [maquina("m1", "1040.0", "1030.0"), maquina("m2", "1030.0", "1035.0")] })];
    expect(horasDaFrenteNoDia(itens, CHAVE, DIA, "1000.0")).toBe("5.0000");
  });

  it("dado ausente: lançamento de hoje sem horímetro nenhum e sem leitura de máquina → null", () => {
    const itens = [apontamento("a", DIA, ABRE, { produtos: [carga("l1")] })];
    expect(horasDaFrenteNoDia(itens, CHAVE, DIA, "1000.0")).toBeNull();
  });

  it("dado ausente: sem base (nem leitura anterior nem abertura canônica) → null", () => {
    const itens = [apontamento("a", DIA, ABRE, { produtos: [carga("l1", "1100.0")] })];
    expect(horasDaFrenteNoDia(itens, CHAVE, DIA, "1.245,0")).toBeNull();
  });

  it("ignora apontamentos cancelados e linhas que não estão CONFIRMADAS, e outras frentes", () => {
    const itens = [
      apontamento("x", DIA, ABRE, { produtos: [carga("l1", "1900.0")], status: "CANCELADO" }),
      apontamento("y", DIA, ABRE, { produtos: [{ ...carga("l2", "1800.0"), status: "PENDENTE" }] }),
      apontamento("z", DIA, marcadorDaAbertura({ bemId: "bem-8", horimetro: "500.0", responsavelId: "usr-3" }), { produtos: [carga("l3", "700.0")] }),
      apontamento("w", DIA, ABRE, { produtos: [carga("l4", "1020.0")] }),
    ];
    expect(horasDaFrenteNoDia(itens, CHAVE, DIA, "1000.0")).toBe("20.0000");
  });

  it("textoDasHorasHoje: horas em pt-BR com até 2 casas; sem horas, \"Nada hoje\"", () => {
    expect(textoDasHorasHoje("4.5000")).toBe("4,5 h");
    expect(textoDasHorasHoje("100.0000")).toBe("100 h");
    expect(textoDasHorasHoje("0.0000")).toBe("0 h");
    expect(textoDasHorasHoje(null)).toBe("Nada hoje");
    expect(textoDasHorasHoje(undefined)).toBe("Nada hoje");
  });
});
