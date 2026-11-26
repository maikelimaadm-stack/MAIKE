/**
 * D-PROD-329 — regras puras da abertura de serviço (marcador na observação, horímetro pt-BR, validação).
 */
import { describe, it, expect } from "vitest";
import {
  aberturaDosApontamentos,
  formatarHorimetro,
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
