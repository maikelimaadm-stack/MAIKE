/**
 * Diário das atividades — o serviço aberto na observação do lançamento (src/lib/diarioServicoRegras.js), sem tela:
 * a linha do serviço vai e volta sem perder o texto que o usuário escreveu; a hora de fim e o fuso; a validação do
 * "Abrir serviço" (máquina e responsável obrigatórios, operação só sem atividade).
 */
import { describe, it, expect } from "vitest";
import {
  horaNoFuso,
  horaValida,
  lerServico,
  marcadorDoServico,
  observacaoComServico,
  servicoAberto,
  textoDaObservacao,
  validarAbrirServico,
} from "@/lib/diarioServicoRegras";

describe("serviço aberto — a linha na observação", () => {
  it("monta a linha só com o que existe (máquina, implemento e fim são opcionais)", () => {
    expect(marcadorDoServico({ inicio: "07:30", bemId: "bem-1", implementoId: "imp-1" })).toBe("[diario-servico inicio=07:30 bem=bem-1 impl=imp-1]");
    expect(marcadorDoServico({ inicio: "07:30" })).toBe("[diario-servico inicio=07:30]");
    expect(marcadorDoServico({ inicio: "07:30", bemId: "bem-1", fim: "17:05" })).toBe("[diario-servico inicio=07:30 bem=bem-1 fim=17:05]");
  });

  it("lê a linha de volta (e uma observação sem ela não é serviço)", () => {
    expect(lerServico("[diario-servico inicio=07:30 bem=bem-1 impl=imp-1 fim=17:05]\nsobrou um pedaço")).toEqual({
      inicio: "07:30",
      bemId: "bem-1",
      implementoId: "imp-1",
      fim: "17:05",
    });
    expect(lerServico("Sem linha nenhuma")).toBeNull();
    expect(lerServico(null)).toBeNull();
    // Hora de início inválida não vira serviço.
    expect(lerServico("[diario-servico inicio=25:99]")).toBeNull();
  });

  it("a hora de fim inválida é ignorada (o serviço segue aberto)", () => {
    const s = lerServico("[diario-servico inicio=07:30 fim=xx]");
    expect(s?.fim).toBeNull();
    expect(servicoAberto(s)).toBe(true);
  });

  it("aberto = tem início e não tem fim", () => {
    expect(servicoAberto({ inicio: "07:30", fim: null })).toBe(true);
    expect(servicoAberto({ inicio: "07:30", fim: "17:05" })).toBe(false);
    expect(servicoAberto(null)).toBe(false);
  });

  it("gravar o serviço preserva o texto do usuário (a linha antiga sai, a nova entra no início)", () => {
    const antes = "[diario-servico inicio=07:30 bem=bem-1]\nPasto com mato alto";
    const nova = observacaoComServico(antes, { inicio: "07:30", bemId: "bem-1", fim: "17:05" });
    expect(nova).toBe("[diario-servico inicio=07:30 bem=bem-1 fim=17:05]\nPasto com mato alto");
    expect(textoDaObservacao(nova)).toBe("Pasto com mato alto");
  });

  it("sem texto do usuário, a observação é só a linha", () => {
    expect(observacaoComServico("", { inicio: "06:45" })).toBe("[diario-servico inicio=06:45]");
    expect(observacaoComServico(null, { inicio: "06:45", bemId: "b" })).toBe("[diario-servico inicio=06:45 bem=b]");
  });
});

describe("hora", () => {
  it("hora válida é HH:MM", () => {
    expect(horaValida("07:30")).toBe(true);
    expect(horaValida("23:59")).toBe(true);
    expect(horaValida("7:30")).toBe(false);
    expect(horaValida("24:00")).toBe(false);
    expect(horaValida("")).toBe(false);
  });

  it("a hora no fuso da fazenda (não a do aparelho)", () => {
    // 2026-11-26 13:05 UTC = 10:05 em America/Cuiaba (UTC-4, sem horário de verão) e 13:05 em UTC.
    const agora = new Date("2026-11-26T13:05:00Z");
    expect(horaNoFuso("America/Cuiaba", agora)).toBe("09:05");
    expect(horaNoFuso("UTC", agora)).toBe("13:05");
  });

  it("sem fuso, usa a hora do aparelho sem quebrar", () => {
    expect(horaNoFuso(null, new Date("2026-11-26T13:05:00Z"))).toMatch(/^\d{2}:\d{2}$/);
    expect(horaNoFuso("Fuso/Inexistente", new Date("2026-11-26T13:05:00Z"))).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("Abrir serviço — validação", () => {
  it("máquina e responsável são obrigatórios; implemento não", () => {
    expect(validarAbrirServico({ bemId: "", responsavelId: "", inicio: "07:30" })).toEqual({
      bem: "Escolha a máquina.",
      responsavel: "Escolha o responsável.",
    });
    expect(validarAbrirServico({ bemId: "b", responsavelId: "u", inicio: "07:30" })).toEqual({});
  });

  it("a hora de início tem de ser HH:MM", () => {
    expect(validarAbrirServico({ bemId: "b", responsavelId: "u", inicio: "" }).inicio).toBe("Informe a hora de início (HH:MM).");
  });

  it("a operação só é pedida quando o pasto não tem atividade em andamento", () => {
    expect(validarAbrirServico({ bemId: "b", responsavelId: "u", inicio: "07:30", pedirOperacao: true })).toEqual({ tipo: "Escolha a operação." });
    expect(validarAbrirServico({ bemId: "b", responsavelId: "u", inicio: "07:30", tipoId: "t1", pedirOperacao: true })).toEqual({});
    expect(validarAbrirServico({ bemId: "b", responsavelId: "u", inicio: "07:30", pedirOperacao: false })).toEqual({});
  });
});
