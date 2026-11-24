/**
 * D-PROD-267 — SERVIÇO DE VÁRIOS DIAS e a SITUAÇÃO da lista (proposta aprovada:
 * docs/engineering/MAIKE-PROPOSTA-REFORMA-E-VARIOS-DIAS.md, Partes 2 e 3; maquetes V1, V2 e V3).
 *
 * Cobre: as regras puras (situação, Data, Área "+N", "12 de 40 ha (30%) · último dia 02/12", "100%, falta concluir", o
 * filtro Tipo com as operações, o último dia do Concluir, o "+ Lançar dia" e o resumo antes de salvar) e a prévia do
 * Planejamento sem a regra do mês; a célula Situação e o bloco do celular (o andamento, a barra, os botões); o diálogo
 * "Concluir" (o último dia sugerido, a regra antes da rede, o envio); e a Nova realização de verdade (service, API, porta
 * e `nativeHttpClient` reais; só o `fetch` é falso): o "+ Lançar dia" preenchido (operação, áreas em aberto sem os
 * hectares, a máquina e a pessoa do último dia, hoje), "Como fica depois de salvar?" (o padrão pelo término, a escolha da
 * pessoa e o `concluir: true` só em Concluída) e a pergunta do "serviço parado" (o reenvio com `nova_atividade`).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { API_FAKE, erroServidor, instalarBackendFake } from "./fixtures/gestaoBackendFake.js";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), ...notify }));
// D-PROD-274: quem conclui tem a permissão de editar (a do "Concluir"); um teste a tira.
const sessao = vi.hoisted(() => ({ editar: true }));
vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useAcoesTelaAtividades: () => ({ ver: true, lancarApontamento: true, editar: sessao.editar, carregando: false, login: "operador" }),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ fuso: "America/Cuiaba", fusoOk: true, semFuso: false, hoje: "2026-12-07" }),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "cli-1", user: { id: "u1" } }) }));
const confirmacao = vi.hoisted(() => ({ confirmar: vi.fn(async () => true) }));
vi.mock("@/lib/maikeConfirmar", () => confirmacao);

const regras = await import("@/lib/servicoVariosDias");
const { destinoDoRegistro } = await import("@/lib/registroDeCampoRegras");
const { SituacaoDoServico, BlocoDoServico } = await import("@/components/lancamento-atividades/ServicoNaLista");
const { default: DialogoConcluirServico } = await import("@/components/lancamento-atividades/DialogoConcluirServico");
const { default: JanelaRegistroDeCampo } = await import("@/components/lancamento-atividades/RegistroDeCampo");

const HOJE = "2026-12-07";

// ─── O serviço como a lista do servidor devolve (com o `andamento`) ─────
const AROEIRA = { id: "area-aroeira", nome: "PASTO DA AROEIRA", numero_area: "07", tamanho_hectares: 40, empresa_id: "emp-1", ativo: true };
const ACUDE = { id: "area-acude", nome: "PASTO DO AÇUDE", numero_area: "08", tamanho_hectares: 27.3, empresa_id: "emp-1", ativo: true };
const AREAS = [AROEIRA, ACUDE];
const ROCADA = { id: "t-roc", nome_tipo: "ROÇADA MECÂNICA", categoria: "PASTAGEM", ativo: true };
const OPERACOES = [ROCADA, { id: "t-cig", nome_tipo: "COMBATE À CIGARRINHA", categoria: "APLICACAO", ativo: true }, { id: "t-velha", nome_tipo: "ROÇADA MANUAL", categoria: "PASTAGEM", ativo: false }];
const andamento = (extra = {}) => ({
  tipo_fixo: "PASTAGEM", situacao: "EM_ANDAMENTO", situacao_rotulo: "Em andamento", hectares_feitos: "12.0000", hectares_area: "40.0000", percentual: "30.00",
  primeiro_dia: "2026-11-28", ultimo_dia: "2026-12-02", lancamentos: 3, areas: [], ...extra,
});
const SERVICO = Object.freeze({
  id: "at-14",
  numero: "14",
  nome: "ROÇADA MECÂNICA · PASTO DA AROEIRA · nov/26",
  status: "ABERTA",
  versao: 6,
  tipo_atividade_id: "t-roc",
  tipo_atividade_nome: "ROÇADA MECÂNICA",
  area_id: "area-aroeira",
  area: { id: "area-aroeira", numero_area: "07", nome: "PASTO DA AROEIRA" },
  data_inicio: "2026-11-28",
  data_conclusao: null,
  custo_total: "1260.0000",
  areas: [
    { id: "aa-1", area_id: "area-aroeira", status: "EM_ANDAMENTO", ordem: 1, area: { id: "area-aroeira", numero_area: "07", nome: "PASTO DA AROEIRA", tamanho_hectares: "40.0000" } },
    { id: "aa-2", area_id: "area-acude", status: "CONCLUIDA", ordem: 2, area: { id: "area-acude", numero_area: "08", nome: "PASTO DO AÇUDE", tamanho_hectares: "27.3000" } },
  ],
  andamento: andamento(),
});

describe("regras puras do serviço de vários dias", () => {
  it("situação, Tipo, Área com +N e Data: '28/11 –' em aberto, '01/11 a 10/11' concluída, o dia só quando é um dia", () => {
    expect(regras.situacaoDoServico(SERVICO)).toBe("EM_ANDAMENTO");
    expect(regras.rotuloDaSituacaoDoServico({ ...SERVICO, andamento: andamento({ situacao: "PLANEJADA" }) })).toBe("Planejada");
    // Sem o andamento (resposta antiga), o status decide; ABERTA = Em andamento, como antes.
    expect(regras.situacaoDoServico({ status: "CONCLUIDA" })).toBe("CONCLUIDA");
    expect(regras.situacaoDoServico({ status: "ABERTA" })).toBe("EM_ANDAMENTO");
    expect(regras.rotuloDoTipoDoServico(SERVICO)).toBe("Roçada e tratos");
    expect(regras.rotuloDoTipoDoServico({ tipo_atividade_id: "t-cig" }, OPERACOES)).toBe("Aplicação");
    expect(regras.textoDaAreaDoServico(SERVICO)).toBe("PASTO DA AROEIRA +1");
    expect(regras.textoDaAreaDoServico({ areas: [], area: { nome: "PASTO 01" } })).toBe("PASTO 01");
    expect(regras.textoDaDataDoServico(SERVICO)).toBe("28/11 –");
    const concluida = { ...SERVICO, status: "CONCLUIDA", data_inicio: "2026-11-01", data_conclusao: "2026-11-10", andamento: andamento({ situacao: "CONCLUIDA" }) };
    expect(regras.textoDaDataDoServico(concluida)).toBe("01/11 a 10/11");
    expect(regras.textoDaDataDoServico({ ...concluida, data_conclusao: "2026-11-01" })).toBe("01/11");
    expect(regras.textoDaDataDoServico({ ...SERVICO, andamento: andamento({ situacao: "PLANEJADA" }) })).toBe("28/11");
  });

  it("andamento: '12 de 40 ha (30%) · último dia 02/12'; o % nunca mostra 100 antes de chegar; aos 100% em andamento, falta concluir", () => {
    expect(regras.textoDoAndamento(SERVICO)).toBe("12 de 40 ha (30%) · último dia 02/12");
    expect(regras.barraDoAndamento(SERVICO)).toBe(30);
    expect(regras.percentualInteiro("99.60")).toBe(99);
    expect(regras.percentualInteiro("100.00")).toBe(100);
    expect(regras.percentualInteiro("130.00")).toBe(100);
    expect(regras.textoDosHectares("52.5000", "52.5000", "100.00")).toBe("52,5 de 52,5 ha (100%)");
    expect(regras.textoDosHectares("4.0000", null, null)).toBe("4 ha");
    expect(regras.textoDosHectares(null, "40.0000", null)).toBe("");
    const cheio = { ...SERVICO, andamento: andamento({ hectares_feitos: "40.0000", percentual: "100.00" }) };
    expect(regras.faltaConcluir(cheio)).toBe(true);
    expect(regras.faltaConcluir(SERVICO)).toBe(false);
    expect(regras.faltaConcluir({ ...cheio, status: "CONCLUIDA", andamento: andamento({ situacao: "CONCLUIDA", percentual: "100.00" }) })).toBe(false);
    // Planejada (sem dia lançado): nada de andamento.
    expect(regras.textoDoAndamento({ ...SERVICO, andamento: andamento({ situacao: "PLANEJADA", hectares_feitos: null }) })).toBe("");
  });

  it("o filtro Tipo: os 7 tipos fixos e, dentro de cada um, as operações (a inativa marcada); o valor vira tipo_fixo ou tipo_atividade_id", () => {
    const opcoes = regras.opcoesDoFiltroTipo(OPERACOES);
    expect(opcoes[0]).toEqual({ value: "", label: "Todos os tipos" });
    const rotulos = opcoes.map((o) => o.label);
    const iRocada = rotulos.indexOf("Roçada e tratos");
    expect(rotulos.slice(iRocada, iRocada + 3)).toEqual(["Roçada e tratos", "Roçada e tratos › ROÇADA MANUAL (INATIVO)", "Roçada e tratos › ROÇADA MECÂNICA"]);
    expect(rotulos.filter((r) => !r.includes("›")).slice(1)).toEqual(["Preparo do solo", "Plantio de pastagem", "Fertilização", "Aplicação", "Roçada e tratos", "Manutenção", "Outros"]);
    expect(regras.filtroDoTipo("tipo:PASTAGEM")).toEqual({ tipo_fixo: "PASTAGEM", tipo_atividade_id: null });
    expect(regras.filtroDoTipo("op:t-roc")).toEqual({ tipo_fixo: null, tipo_atividade_id: "t-roc" });
    expect(regras.filtroDoTipo("")).toEqual({ tipo_fixo: null, tipo_atividade_id: null });
    expect(regras.OPCOES_DA_SITUACAO.map((o) => o.label)).toEqual(["Todas as situações", "Planejada", "Em andamento", "Finalizada", "Cancelada"]);
  });

  it("o último dia do Concluir: obrigatório, nunca futuro, nem antes do início nem do último dia lançado", () => {
    const c = { hoje: HOJE, dataInicio: "2026-11-28", ultimoDia: "2026-12-02" };
    expect(regras.erroDoUltimoDia("", c)).toBe("Informe o último dia.");
    expect(regras.erroDoUltimoDia("2026-12-08", c)).toBe("O último dia não pode ser depois de hoje.");
    expect(regras.erroDoUltimoDia("2026-11-27", c)).toBe("O último dia não pode ser antes do início do serviço (28/11/2026).");
    expect(regras.erroDoUltimoDia("2026-12-01", c)).toBe("O último dia não pode ser antes do último dia lançado (02/12/2026).");
    expect(regras.erroDoUltimoDia("2026-12-02", c)).toBeNull();
    expect(regras.tituloDoConcluir(SERVICO)).toBe("ROÇADA MECÂNICA · PASTO DA AROEIRA +1");
  });

  it("+ Lançar dia: as áreas em aberto; as máquinas e a equipe do ÚLTIMO dia confirmado (sem leitura e sem quantidade; sem repetir); nada de insumo", () => {
    const linhaMaquina = (bem, extra = {}) => ({ bem_id: bem, bem: { id: bem, codigo_frota: bem.toUpperCase(), nome: `Máquina ${bem}` }, implemento_bem_id: "i-ro", implemento: { id: "i-ro", codigo_frota: "RO-01", nome: "Roçadeira" }, sem_medidor: false, leitura_inicial: "1237.0000", leitura_final: "1244.0000", status: "CONFIRMADO", ...extra });
    const p = regras.preenchimentoDoLancarDia({
      atividade: SERVICO,
      apontamentos: [
        { id: "ap-velho", data_operacional: "2026-11-28", status: "CONFIRMADO", createdAt: "2026-11-28T10:00:00Z", maquinas: [linhaMaquina("b-velho")], mao_obra: [] },
        {
          id: "ap-ultimo", data_operacional: "2026-11-30", data_termino: "2026-12-02", status: "CONFIRMADO", createdAt: "2026-12-02T10:00:00Z",
          maquinas: [linhaMaquina("b-tr"), linhaMaquina("b-tr"), linhaMaquina("b-cancelada", { status: "CANCELADO" })],
          mao_obra: [{ parceiro_id: "f-joao", parceiro: { id: "f-joao", nome: "JOÃO" }, origem: "FUNCIONARIO", tipo_medida: "DIARIA", quantidade: "3.0000", status: "CONFIRMADO" }],
          produtos: [{ produto_id: "p1", status: "CONFIRMADO" }],
        },
        { id: "ap-cancelado", data_operacional: "2026-12-05", status: "CANCELADO", createdAt: "2026-12-05T10:00:00Z", maquinas: [linhaMaquina("b-x")], mao_obra: [] },
      ],
    });
    expect(p.areaIds).toEqual(["area-aroeira"]);
    expect(p.ultimo?.id).toBe("ap-ultimo");
    expect(p.maquinas).toHaveLength(1);
    expect(p.maquinas[0]).toMatchObject({ bem: { id: "b-tr" }, implemento: { id: "i-ro" }, leitura_inicial: "", leitura_final: "", quantidade_uso: "" });
    expect(p.equipe).toHaveLength(1);
    // D-PROD-281: "Vai junto, igual ao último dia" — a quantidade da pessoa também vem.
    expect(p.equipe[0]).toMatchObject({ parceiro: { id: "f-joao" }, tipo_medida: "DIARIA", quantidade: "3" });
  });

  it("Como fica depois de salvar: o padrão segue o término até a pessoa escolher; o resumo numa frase", () => {
    expect(regras.situacaoDepoisDeSalvar("", null)).toBe("EM_ANDAMENTO");
    expect(regras.situacaoDepoisDeSalvar("2026-12-02", null)).toBe("CONCLUIDA");
    expect(regras.situacaoDepoisDeSalvar("2026-12-02", "EM_ANDAMENTO")).toBe("EM_ANDAMENTO");
    expect(regras.situacaoDepoisDeSalvar("", "CONCLUIDA")).toBe("CONCLUIDA");
    expect(regras.textoDoDiaDoRegistro(HOJE, "", HOJE)).toBe("hoje");
    expect(regras.textoDoDiaDoRegistro("2026-12-06", "", HOJE)).toBe("ontem");
    expect(regras.textoDoDiaDoRegistro("2026-11-30", "2026-12-02", HOJE)).toBe("de 30/11 a 02/12");
    const depois = regras.hectaresDepoisDoRegistro({ jaFeitos: "8.0000", areaTotal: "40.0000", hoje: "4.0000" });
    expect(depois).toEqual({ feitos: "12.0000", area: "40.0000" });
    const r = regras.resumoAntesDeSalvar({
      operacao: "Roçada", areas: ["Pasto da Aroeira"], quando: "hoje", hectares: "4.0000", maquinas: ["Trator MF 4275"], equipe: ["João 1 diária"],
      situacao: "EM_ANDAMENTO", feitosDepois: depois.feitos, areaTotal: depois.area,
    });
    expect(`${r.frase} ${r.vai}`).toBe("Roçada no Pasto da Aroeira, hoje, 4 ha, Trator MF 4275, João 1 diária. Vai ficar EM ANDAMENTO (12 de 40 ha).");
    expect(regras.resumoAntesDeSalvar({ operacao: "Roçada", areas: [], quando: "", hectares: null, maquinas: [], equipe: [], situacao: "CONCLUIDA", feitosDepois: null, areaTotal: null }).vai).toBe("Vai ficar FINALIZADA.");
  });

  it("Planejamento sem a regra do mês: a aberta de novembro recebe o dia de dezembro, com o andamento; parada há mais de 30 dias, avisa", () => {
    const tipo = { id: "t-roc", nome_tipo: "ROÇADA MECÂNICA" };
    const areas = [{ id: "area-aroeira", nome: "PASTO DA AROEIRA" }];
    const aberta = { atividade_id: "at-14", nome: "ROÇADA MECÂNICA · PASTO DA AROEIRA · nov/26", tipo_atividade_id: "t-roc", status: "ABERTA", area_status: "EM_ANDAMENTO", data_inicio: "2026-11-28", area_planejada: "40.0000", area_executada: "8.0000", ultimo_dia: "2026-12-02" };
    expect(destinoDoRegistro({ tipo, areas, dia: HOJE, resumos: [{ atividades: [aberta] }] })).toBe("Entra em ROÇADA MECÂNICA · PASTO DA AROEIRA · nov/26 (em andamento, 8 de 40 ha)");
    expect(destinoDoRegistro({ tipo, areas, dia: HOJE, resumos: [{ atividades: [{ ...aberta, area_status: "PLANEJADA", area_executada: "0.0000", ultimo_dia: null }] }] })).toBe(
      "Entra em ROÇADA MECÂNICA · PASTO DA AROEIRA · nov/26 (planejada, 40 ha)",
    );
    expect(destinoDoRegistro({ tipo, areas, dia: "2027-01-10", resumos: [{ atividades: [aberta] }] })).toBe(
      "Entra em ROÇADA MECÂNICA · PASTO DA AROEIRA · nov/26 (em andamento, 8 de 40 ha). Parada desde 02/12: ao salvar, vamos perguntar se é continuação",
    );
    // A concluída nessa área não recebe: uma atividade nova, com o mês do início.
    expect(destinoDoRegistro({ tipo, areas, dia: HOJE, resumos: [{ atividades: [{ ...aberta, area_status: "CONCLUIDA" }] }] })).toBe("Nova atividade será criada: ROÇADA MECÂNICA · PASTO DA AROEIRA · dez/26");
  });
});

describe("a linha do serviço (computador e celular)", () => {
  const acoes = () => ({ onLancarDia: vi.fn(), onConcluir: vi.fn() });

  it("em andamento: o andamento, a barra fina e '+ Lançar dia' e 'Concluir'; o clique nos botões não chega à linha", () => {
    const a = acoes();
    const linha = vi.fn();
    render(
      <div onClick={linha}>
        <SituacaoDoServico item={SERVICO} podeLancar podeConcluir {...a} />
      </div>,
    );
    expect(screen.getByTestId("atividade-status-at-14")).toHaveTextContent(/^Em andamento12 de 40 ha \(30%\) · último dia 02\/12/);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30");
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "30%" });
    fireEvent.click(screen.getByRole("button", { name: "Lançamento" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    expect(a.onLancarDia).toHaveBeenCalledWith(SERVICO);
    expect(a.onConcluir).toHaveBeenCalledWith(SERVICO);
    expect(linha).not.toHaveBeenCalled();
  });

  it("aos 100% sem concluir: '100%, falta concluir' em negrito, os hectares e só 'Concluir'; sem permissão, nenhum botão", () => {
    const cheio = { ...SERVICO, andamento: andamento({ hectares_feitos: "52.5000", hectares_area: "52.5000", percentual: "100.00" }) };
    const { unmount } = render(<SituacaoDoServico item={cheio} podeLancar podeConcluir {...acoes()} />);
    const falta = screen.getByTestId("servico-falta-concluir-at-14");
    expect(falta).toHaveTextContent("Tudo feito · falta finalizar (52,5 de 52,5 ha)");
    expect(within(falta).getByText("Tudo feito · falta finalizar").tagName).toBe("STRONG");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Finalizar"]);
    unmount();
    render(<SituacaoDoServico item={SERVICO} podeLancar={false} podeConcluir={false} {...acoes()} />);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.getByTestId("servico-andamento-at-14")).toBeTruthy();
  });

  it("concluída, planejada e cancelada: só a situação (sem andamento nem botões)", () => {
    for (const [situacao, rotulo] of [["CONCLUIDA", "Finalizada"], ["PLANEJADA", "Planejada"], ["CANCELADA", "Cancelada"]]) {
      const { unmount } = render(<SituacaoDoServico item={{ ...SERVICO, andamento: andamento({ situacao }) }} podeLancar podeConcluir {...acoes()} />);
      expect(screen.getByTestId("atividade-status-at-14")).toHaveTextContent(new RegExp(`^${rotulo}$`));
      expect(screen.queryAllByRole("button")).toEqual([]);
      unmount();
    }
  });

  it("o bloco do celular (V1): Nº, tipo e custo, operação · área, data · situação, o andamento e os botões", () => {
    render(<BlocoDoServico item={SERVICO} tipos={OPERACOES} comAcoes podeLancar podeConcluir {...acoes()} />);
    const bloco = screen.getByTestId("servico-bloco-at-14");
    expect(bloco.querySelector(".b1-servico-bloco__num")).toHaveTextContent("14");
    expect(bloco.querySelector(".b1-servico-bloco__tipo")).toHaveTextContent("Roçada e tratos");
    expect(bloco.querySelector(".b1-servico-bloco__custo")?.textContent?.replace(/\s/g, " ")).toBe("R$ 1.260,00");
    expect(bloco.querySelector(".b1-servico-bloco__topo")).toHaveClass("b1-servico-bloco__topo--com-acoes");
    expect([...bloco.querySelectorAll(".b1-servico-bloco__linha")].map((el) => el.textContent)).toEqual(["ROÇADA MECÂNICA · PASTO DA AROEIRA +1", "28/11 – · Em andamento"]);
    expect(within(bloco).getAllByRole("button").map((b) => b.textContent)).toEqual(["Lançamento", "Finalizar"]);
  });
});

describe("o diálogo Concluir (V3)", () => {
  it("'Concluir <operação> · <área>', o último dia lançado sugerido, '40 de 40 ha (100%)'; a regra antes da rede; envia o dia", async () => {
    const item = { ...SERVICO, andamento: andamento({ hectares_feitos: "40.0000", percentual: "100.00", ultimo_dia: "2026-12-07" }) };
    const onConcluir = vi.fn(async () => ({}));
    const onFechar = vi.fn();
    render(<DialogoConcluirServico item={item} hoje={HOJE} onFechar={onFechar} onConcluir={onConcluir} />);
    expect(screen.getByTestId("dialogo-concluir-servico-titulo")).toHaveTextContent("Finalizar atividade");
    expect(screen.getByTestId("dialogo-concluir-servico-nome")).toHaveTextContent("ROÇADA MECÂNICA · PASTO DA AROEIRA +1");
    const campo = screen.getByTestId("dialogo-concluir-servico-dia");
    expect(campo).toHaveValue("2026-12-07");
    expect(screen.getByTestId("dialogo-concluir-servico-sugerido")).toHaveTextContent("sugerido: último dia lançado");
    expect(screen.getByTestId("dialogo-concluir-servico-hectares")).toHaveTextContent("40 de 40 ha (100%)");
    // Antes do último dia lançado: o erro no campo, nada enviado.
    fireEvent.change(campo, { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByTestId("dialogo-concluir-servico-enviar"));
    expect(await screen.findByText("O último dia não pode ser antes do último dia lançado (07/12/2026).")).toBeTruthy();
    expect(onConcluir).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: "2026-12-07" } });
    fireEvent.click(screen.getByTestId("dialogo-concluir-servico-enviar"));
    await waitFor(() => expect(onConcluir).toHaveBeenCalledWith("2026-12-07"));
    fireEvent.click(screen.getByTestId("dialogo-concluir-servico-cancelar"));
    expect(onFechar).toHaveBeenCalled();
  });

  it("a recusa do servidor fica no diálogo, com a frase do catálogo (antes do último dia)", async () => {
    const { ApiError } = await import("@/apis/_core/ApiError.js");
    const onConcluir = vi.fn(async () => {
      throw new ApiError("ATIVIDADE_DATA_INVALIDA", { details: { field: "data_conclusao", reason: "antes_do_ultimo_dia", ultimo_dia: "2026-12-03" } });
    });
    render(<DialogoConcluirServico item={{ ...SERVICO, andamento: andamento({ ultimo_dia: null }) }} hoje={HOJE} onFechar={vi.fn()} onConcluir={onConcluir} />);
    // Sem último dia lançado: sugere hoje, sem a nota.
    expect(screen.getByTestId("dialogo-concluir-servico-dia")).toHaveValue(HOJE);
    expect(screen.queryByTestId("dialogo-concluir-servico-sugerido")).toBeNull();
    fireEvent.click(screen.getByTestId("dialogo-concluir-servico-enviar"));
    expect(await screen.findByTestId("dialogo-concluir-servico-erro")).toHaveTextContent("A data de conclusão não pode ser antes do último dia lançado (03/12/2026). Nada foi gravado.");
  });
});

// ─── A Nova realização de verdade, com o backend falso ──────────────────
const TRATOR = { id: "b-tr", numero: "2", codigo_frota: "TR-02", nome: "TRATOR MF 4275", natureza: "MAQUINA" };
const ROCADEIRA = { id: "i-ro", numero: "8", codigo_frota: "RO-01", nome: "ROÇADEIRA", natureza: "IMPLEMENTO" };
const MEDIDORES = /** @type {Record<string, any>} */ ({
  "b-tr": { medidor_tipo: "HORIMETRO", medidor_unidade: "h", sem_medidor: false, leitura_vigente: { leitura: "1244.0000", data: "2026-12-02", origem: "ATIVIDADE" }, salto_maximo_medidor: null },
});
const JOAO = { id: "f-joao", nome: "JOÃO", origem: "FUNCIONARIO", funcionario_tipo: "DIARISTA", funcionario_custo_hora: null, funcionario_custo_diaria: "150.0000" };
const ULTIMO_DIA = {
  id: "ap-3", atividade_id: "at-14", data_operacional: "2026-12-02", data_termino: null, status: "CONFIRMADO", createdAt: "2026-12-02T18:00:00.000Z",
  area_executada_dia: "4.0000",
  maquinas: [{ id: "lm-1", bem_id: "b-tr", bem: TRATOR, implemento_bem_id: "i-ro", implemento: ROCADEIRA, sem_medidor: false, leitura_inicial: "1237.0000", leitura_final: "1244.0000", status: "CONFIRMADO", ordem: 1 }],
  mao_obra: [{ id: "lo-1", parceiro_id: "f-joao", parceiro: { id: "f-joao", nome: "JOÃO", funcionario_tipo: "DIARISTA", funcionario_custo_diaria: "150.0000" }, origem: "FUNCIONARIO", tipo_medida: "DIARIA", quantidade: "1.0000", custo_unitario: "150.0000", status: "CONFIRMADO", ordem: 1 }],
  produtos: [],
  servicos: [],
};
const NA_AROEIRA = {
  atividade_id: "at-14", numero: "14", nome: "ROÇADA MECÂNICA · PASTO DA AROEIRA · nov/26", tipo_atividade_id: "t-roc", tipo_atividade_nome: "ROÇADA MECÂNICA",
  status: "ABERTA", area_status: "EM_ANDAMENTO", area_planejada: "40.0000", area_executada: "8.0000", data_inicio: "2026-11-28", ultimo_dia: "2026-12-02",
};

/** @type {{ chamadas: Array<{ method: string, path: string, query: Record<string, string>, body: any }> }} */
let backend;
/** As respostas dos próximos registros (na ordem); vazias, grava. @type {Array<{ status: number, body?: unknown }>} */
let proximas;

const rotear = async (/** @type {{ method: string, path: string, query: URLSearchParams, body: any }} */ { method, path, query, body }) => {
  const partes = path.split("/").filter(Boolean);
  if (path === "/areas-pastagem" && method === "GET") return { status: 200, body: AREAS };
  if (partes[0] === "atividades-opcoes" && method === "GET") {
    if (partes[1] === "medidor") return { status: 200, body: MEDIDORES[String(query.get("bem_id"))] ?? {} };
    const porRecurso = /** @type {Record<string, any[]>} */ ({ bens: [TRATOR], implementos: [ROCADEIRA], "mao-obra": [JOAO] });
    return { status: 200, body: { itens: porRecurso[partes[1]] ?? [], has_more: false, next_cursor: null } };
  }
  if (partes[0] === "atividades-por-area" && method === "GET") {
    return { status: 200, body: { area_id: partes[1], mes: "2026-12", atividades: partes[1] === "area-aroeira" ? [NA_AROEIRA] : [], custos: null } };
  }
  if (path === "/atividades/at-14/apontamentos" && method === "GET") return { status: 200, body: { items: [ULTIMO_DIA, { ...ULTIMO_DIA, id: "ap-1", data_operacional: "2026-11-28", createdAt: "2026-11-28T18:00:00.000Z", mao_obra: [] }] } };
  if (path === "/atividades/registrar" && method === "POST") {
    const r = proximas.shift();
    if (r) return r;
    return { status: 201, body: { apontamento: { id: "ap-9" }, apontamentos: [{ id: "ap-9" }], atividade: { id: "at-14" }, alertas: [], registro: { atividade_criada: false, atividade_id: "at-14" }, replay: false } };
  }
  return undefined;
};

beforeEach(async () => {
  vi.stubEnv("VITE_MAIKE_API_URL", API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem("empresa_selecionada_id", "emp-1");
  window.localStorage.setItem("empresa_selecionada_cliente_id", "cli-1");
  const { setNativeToken } = await import("@/lib/auth/nativeTokenStorage");
  setNativeToken("jwt.teste");
  confirmacao.confirmar.mockResolvedValue(true);
  proximas = [];
  sessao.editar = true;
  backend = instalarBackendFake(rotear);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** @param {Record<string, any>} [props] */
const montar = async (props = {}) => {
  const onFechar = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <JanelaRegistroDeCampo tipos={OPERACOES.filter((t) => t.ativo)} areas={AREAS} onFechar={onFechar} {...props} />
    </QueryClientProvider>,
  );
  const janela = await screen.findByTestId("janela-registro-de-campo");
  return { janela, onFechar };
};
const registros = () => backend.chamadas.filter((c) => c.method === "POST" && c.path === "/atividades/registrar");
const editorDe = (/** @type {HTMLElement} */ janela, /** @type {string} */ secao) => within(janela).getByTestId(`registro-${secao}-editor`);
/** D-PROD-281: o "Novo lançamento" abre curto; "Mudar" mostra o formulário inteiro. */
const abrirTudo = async (/** @type {HTMLElement} */ janela) => {
  await within(janela).findByTestId("registro-de-campo-curto");
  await waitFor(() => expect(within(janela).getByTestId("registro-de-campo-vai-junto")).toHaveTextContent("JOÃO"));
  fireEvent.click(within(janela).getByTestId("registro-de-campo-mudar"));
  return within(janela).findByTestId("registro-de-campo-form");
};
/**
 * O "+ Lançamento" (formulário inteiro) já com o que a pessoa digita: os hectares de hoje e o "Horímetro agora" (a
 * pessoa — JOÃO, 1 diária — vem do último dia, D-PROD-281). `finalizou`: a resposta ao "Finalizou a atividade hoje?".
 */
const preencherODia = async (/** @type {HTMLElement} */ janela, /** @type {string|null} */ finalizou = "Não, continua") => {
  if (!within(janela).queryByTestId("registro-de-campo-form")) await abrirTudo(janela);
  fireEvent.change(within(janela).getByTestId("registro-areas-hectares-area-aroeira"), { target: { value: "4" } });
  const maquina = await within(janela).findByTestId("registro-maquina-editor");
  await waitFor(() => expect(within(maquina).getByTestId("registro-maquina-horimetro-dica")).toHaveTextContent("última hora lançada: 1.244"));
  fireEvent.change(within(maquina).getByTestId("registro-maquina-leitura-final"), { target: { value: "1251" } });
  if (finalizou) fireEvent.click(within(within(janela).getByTestId("registro-de-campo-situacao")).getByRole("radio", { name: finalizou }));
};

describe("+ Lançar dia (V2): a Nova realização preenchida com o serviço", () => {
  it("abre no formulário do tipo do serviço, com a operação, a área em aberto (hectares vazios), a máquina e a pessoa do último dia, hoje e o Planejamento", async () => {
    const { janela } = await montar({ continuar: SERVICO });
    await abrirTudo(janela);
    expect(within(janela).getByTestId("registro-de-campo-titulo")).toHaveTextContent(/^Novo lançamento$/);
    expect(within(janela).getByTestId("registro-de-campo-titulo-atividade")).toHaveTextContent("ROÇADA MECÂNICA · PASTO DA AROEIRA +1");
    expect(within(janela).queryByRole("button", { name: "Trocar tipo" })).toBeNull();
    expect(within(janela).getByRole("combobox", { name: /Operação/ })).toHaveTextContent("ROÇADA MECÂNICA");
    // Só a área em aberto do serviço (o Açude já está concluído nele), com os hectares de hoje vazios.
    expect(within(janela).getByTestId("registro-areas-linha-area-aroeira")).toBeTruthy();
    expect(within(janela).queryByTestId("registro-areas-linha-area-acude")).toBeNull();
    expect(within(janela).getByTestId("registro-areas-hectares-area-aroeira")).toHaveValue("");
    // Hoje, sem término; nenhum insumo.
    expect(within(janela).getByTestId("registro-de-campo-data")).toHaveValue(HOJE);
    expect(within(janela).getByTestId("registro-de-campo-data-termino")).toHaveValue("");
    expect(within(janela).queryByTestId("registro-insumo-editor")).toBeNull();
    expect(within(janela).queryAllByTestId(/^registro-insumo-linha-\d+$/)).toEqual([]);
    // A máquina e o implemento do último dia; a inicial é a leitura de agora (= a final do último dia), com a nota.
    const maquina = await within(janela).findByTestId("registro-maquina-editor");
    expect(within(maquina).getByTestId("registro-maquina-bem").getAttribute("aria-label")).toMatch(/TR-02/);
    expect(within(maquina).getByTestId("registro-maquina-implemento").getAttribute("aria-label")).toMatch(/RO-01/);
    await waitFor(() => expect(within(maquina).getByTestId("registro-maquina-horimetro-dica")).toHaveTextContent("última hora lançada: 1.244"));
    expect(within(maquina).getByTestId("registro-maquina-leitura-final")).toHaveValue("");
    expect(within(janela).getByTestId("registro-de-campo-nota-inicial")).toHaveTextContent("inicial = final do último dia");
    // D-PROD-281: a pessoa do último dia vai junto, com a medida e a quantidade dele (na tabela; muda-se lá).
    expect(within(janela).queryByTestId("registro-pessoa-editor")).toBeNull();
    expect(within(janela).getByTestId("registro-de-campo-form")).toHaveTextContent("JOÃO");
    // Onde entra: a atividade aberta de novembro, com o andamento.
    expect(await within(janela).findByTestId("registro-de-campo-destino")).toHaveTextContent("Entra em ROÇADA MECÂNICA · PASTO DA AROEIRA · nov/26 (em andamento, 8 de 40 ha)");
  });

  it("Finalizou a atividade hoje? nada marcado (sem escolha, nada sai); 'Não, continua', o resumo numa frase e o corpo SEM concluir; a máquina e a pessoa vão no corpo", async () => {
    const { janela } = await montar({ continuar: SERVICO });
    await preencherODia(janela, null);
    const situacao = within(janela).getByTestId("registro-de-campo-situacao");
    expect(within(situacao).getByRole("radio", { name: "Não, continua" })).toHaveAttribute("aria-checked", "false");
    expect(within(situacao).getByRole("radio", { name: "Sim, finalizei" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    expect(await within(janela).findByTestId("registro-de-campo-situacao-erro")).toHaveTextContent("Escolha se finalizou a atividade hoje.");
    expect(registros()).toHaveLength(0);
    fireEvent.click(within(situacao).getByRole("radio", { name: "Não, continua" }));
    expect(within(situacao).getByRole("radio", { name: "Não, continua" })).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(within(janela).getByTestId("registro-de-campo-resumo")).toHaveTextContent(
        "ROÇADA MECÂNICA no PASTO DA AROEIRA, hoje, 4 ha, TR-02 — TRATOR MF 4275, JOÃO 1 diária. Vai ficar EM ANDAMENTO (16 de 40 ha).",
      ),
    );
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(registros()).toHaveLength(1));
    const corpo = registros()[0].body;
    expect(corpo).toMatchObject({
      tipo_atividade_id: "t-roc",
      data_operacional: HOJE,
      areas: [{ area_id: "area-aroeira", hectares: "4" }],
      maquinas: [{ bem_id: "b-tr", implemento_bem_id: "i-ro", sem_medidor: false, leitura_inicial: "1244", leitura_final: "1251" }],
      mao_obra: [{ parceiro_id: "f-joao", tipo_medida: "DIARIA", quantidade: "1" }],
    });
    expect(corpo).not.toHaveProperty("concluir");
    expect(corpo).not.toHaveProperty("nova_atividade");
    expect(corpo).not.toHaveProperty("produtos");
  });

  it("com término e 'Sim, finalizei' manda concluir: true; o 'Salvar e novo' não aparece no Novo lançamento", async () => {
    const { janela } = await montar({ continuar: SERVICO });
    await abrirTudo(janela);
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data"), { target: { value: "2026-12-05" } });
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data-termino"), { target: { value: HOJE } });
    await preencherODia(janela, "Sim, finalizei");
    const situacao = within(janela).getByTestId("registro-de-campo-situacao");
    expect(within(situacao).getByRole("radio", { name: "Sim, finalizei" })).toHaveAttribute("aria-checked", "true");
    expect(within(janela).getByTestId("registro-de-campo-resumo")).toHaveTextContent("de 05/12 a 07/12");
    expect(within(janela).getByTestId("registro-de-campo-resumo")).toHaveTextContent("Vai ficar FINALIZADA (16 de 40 ha).");
    expect(within(janela).queryByRole("button", { name: "Salvar e novo" })).toBeNull();
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body).toMatchObject({ data_operacional: "2026-12-05", data_termino: HOJE, concluir: true });
  });
});

describe("serviço parado: a pergunta e o reenvio com a decisão", () => {
  const parado = () =>
    erroServidor(409, "ATIVIDADE_SERVICO_PARADO", {
      details: { atividade_id: "at-14", atividade_nome: "ROÇADA MECÂNICA · PASTO DA AROEIRA · nov/26", ultimo_dia: "2026-12-02", area_id: "area-aroeira", dias_parado: 36, limite_dias: 30 },
    });

  it("409 vira 'Este serviço está parado desde 02/12. É continuação?'; 'Continuar este serviço' reenvia com nova_atividade false", async () => {
    proximas.push(parado());
    const { janela, onFechar } = await montar({ continuar: SERVICO });
    await preencherODia(janela);
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    const pergunta = await within(janela).findByTestId("registro-de-campo-parado");
    expect(pergunta).toHaveTextContent("Este serviço está parado desde 02/12. É continuação?");
    expect(pergunta).toHaveTextContent("ROÇADA MECÂNICA · PASTO DA AROEIRA · nov/26");
    expect(notify.notifyWarning).not.toHaveBeenCalled();
    expect(registros()).toHaveLength(1);
    expect(registros()[0].body).not.toHaveProperty("nova_atividade");
    fireEvent.click(within(pergunta).getByRole("button", { name: "Continuar este serviço" }));
    await waitFor(() => expect(registros()).toHaveLength(2));
    expect(registros()[1].body).toMatchObject({ nova_atividade: false, areas: [{ area_id: "area-aroeira", hectares: "4" }] });
    await waitFor(() => expect(onFechar).toHaveBeenCalled());
  });

  it("'É um serviço novo' reenvia com nova_atividade true; mexer no formulário tira a pergunta", async () => {
    proximas.push(parado(), parado());
    const { janela } = await montar({ continuar: SERVICO });
    await preencherODia(janela);
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await within(janela).findByTestId("registro-de-campo-parado");
    // A pessoa mexe nos hectares: a pergunta sai (o envio novo pergunta de novo).
    fireEvent.change(within(janela).getByTestId("registro-areas-hectares-area-aroeira"), { target: { value: "5" } });
    await waitFor(() => expect(within(janela).queryByTestId("registro-de-campo-parado")).toBeNull());
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    const pergunta = await within(janela).findByTestId("registro-de-campo-parado");
    fireEvent.click(within(pergunta).getByRole("button", { name: "É um serviço novo" }));
    await waitFor(() => expect(registros()).toHaveLength(3));
    expect(registros()[2].body).toMatchObject({ nova_atividade: true, areas: [{ area_id: "area-aroeira", hectares: "5" }] });
  });
});

// ─── D-PROD-274: ajustes do teste de ponta a ponta ────────────────────────────
describe("ajustes do teste de ponta a ponta (D-PROD-274): o capim, o serviço sem área e quem conclui", () => {
  /** A Manutenção sem área, como a lista do servidor devolve (o servidor antigo mandava hectares_feitos "0.0000"). */
  const CERCA = Object.freeze({
    id: "at-21", numero: "21", nome: "REFORMA DE CERCA · DIVISA NORTE · nov/26", status: "ABERTA", versao: 3,
    tipo_atividade_id: "t-cerca", tipo_atividade_nome: "REFORMA DE CERCA", area_id: null, area: null, areas: [], local: "DIVISA NORTE",
    quantidade_produzida: "2.5000", unidade_producao_sigla: "KM", data_inicio: "2026-11-19", data_conclusao: null, custo_total: null,
    andamento: andamento({ tipo_fixo: "BENFEITORIA", hectares_feitos: "0.0000", hectares_area: null, percentual: null, ultimo_dia: "2026-11-20", lancamentos: 2 }),
  });
  /** Dois plantios abertos na mesma área (o mesmo nome; só o capim os distingue). */
  const plantio = (id, nome) => ({
    ...SERVICO, id, numero: id.slice(3), nome: "SEMEADURA DE CAPIM · PASTO DA AROEIRA · nov/26", tipo_atividade_id: "t-sem", tipo_atividade_nome: "SEMEADURA DE CAPIM",
    areas: [SERVICO.areas[0]], plantio: { cultura_id: `c-${id}`, cultura: { id: `c-${id}`, nome }, forma_plantio: null }, andamento: andamento({ tipo_fixo: "PLANTIO" }),
  });
  const MOMBACA = plantio("at-31", "PANICUM CV. MOMBAÇA");
  const MARANDU = plantio("at-32", "BRACHIARIA BRIZANTHA CV. MARANDU");

  it("regras: o capim do serviço; sem área, o local e a quantidade feita com a unidade — nunca '0 ha'", () => {
    expect([regras.capimDoServico(MOMBACA), regras.capimDoServico(SERVICO)]).toEqual(["PANICUM CV. MOMBAÇA", ""]);
    expect(regras.textoDoCapim("PANICUM CV. MOMBAÇA")).toBe("capim PANICUM CV. MOMBAÇA");
    expect(regras.textoDoCapim("")).toBe("");
    expect(regras.tituloDoConcluir(MOMBACA)).toBe("SEMEADURA DE CAPIM · PASTO DA AROEIRA · capim PANICUM CV. MOMBAÇA");
    expect(regras.tituloDoConcluir(MARANDU)).toBe("SEMEADURA DE CAPIM · PASTO DA AROEIRA · capim BRACHIARIA BRIZANTHA CV. MARANDU");
    expect([regras.servicoSemArea(CERCA), regras.servicoSemArea(SERVICO), regras.servicoSemArea({ areas: [], local: null })]).toEqual([true, false, false]);
    expect(regras.quantidadeFeitaDoServico(CERCA)).toBe("2,5 km");
    expect(regras.quantidadeFeitaDoServico({ ...CERCA, quantidade_produzida: "4.0000", unidade_producao_sigla: "UN" })).toBe("4 unidades");
    expect(regras.quantidadeFeitaDoServico({ ...CERCA, quantidade_produzida: null })).toBe("");
    expect(regras.quantidadeFeitaDoServico({ ...CERCA, quantidade_produzida: "0.0000" })).toBe("");
    expect(regras.textoDoAndamento(CERCA)).toBe("DIVISA NORTE · 2,5 km · último dia 20/11");
    expect(regras.textoDoAndamento({ ...CERCA, quantidade_produzida: null, andamento: { ...CERCA.andamento, hectares_feitos: null } })).toBe("DIVISA NORTE · último dia 20/11");
    const concluida = { ...CERCA, status: "CONCLUIDA", data_conclusao: "2026-11-20", andamento: { ...CERCA.andamento, situacao: "CONCLUIDA" } };
    expect(regras.hectaresDaConcluida(concluida)).toBe("2,5 km");
    expect(regras.hectaresDaConcluida({ ...concluida, quantidade_produzida: null })).toBe("");
    expect(regras.feitoNoConcluir(CERCA)).toBe("2,5 km");
    expect(regras.feitoNoConcluir({ ...CERCA, quantidade_produzida: null })).toBe("");
    expect(regras.feitoNoConcluir(SERVICO)).toBe("12 de 40 ha (30%)");
  });

  it("a lista: a Situação do serviço sem área mostra o local e a quantidade; o card do celular diz o capim e, concluído sem área, a quantidade (nunca '0 ha')", () => {
    const a = { onLancarDia: vi.fn(), onConcluir: vi.fn() };
    const { unmount } = render(<SituacaoDoServico item={CERCA} podeLancar podeConcluir {...a} />);
    expect(screen.getByTestId("servico-andamento-at-21")).toHaveTextContent(/^DIVISA NORTE · 2,5 km · último dia 20\/11$/);
    expect(screen.getByTestId("atividade-status-at-21").textContent).not.toMatch(/\bha\b/);
    unmount();
    const r1 = render(<BlocoDoServico item={MOMBACA} tipos={OPERACOES} comAcoes podeLancar podeConcluir {...a} />);
    expect(r1.container.querySelector(".b1-servico-bloco__linha")?.textContent).toBe("SEMEADURA DE CAPIM · PASTO DA AROEIRA · capim PANICUM CV. MOMBAÇA");
    r1.unmount();
    const concluida = { ...CERCA, status: "CONCLUIDA", data_conclusao: "2026-11-20", andamento: { ...CERCA.andamento, situacao: "CONCLUIDA" } };
    const r2 = render(<BlocoDoServico item={concluida} tipos={OPERACOES} comAcoes podeLancar podeConcluir {...a} />);
    expect([...r2.container.querySelectorAll(".b1-servico-bloco__linha")].map((el) => el.textContent)).toEqual(["REFORMA DE CERCA · DIVISA NORTE", "19/11 a 20/11 · Finalizada · 2,5 km"]);
  });

  it("a célula Operação (computador) traz o capim embaixo; sem plantio, só a operação", async () => {
    const { OperacaoDoServico } = await import("@/components/lancamento-atividades/ServicoNaLista");
    const { unmount } = render(<OperacaoDoServico item={MARANDU} />);
    expect(screen.getByTestId("servico-capim-at-32")).toHaveTextContent("capim BRACHIARIA BRIZANTHA CV. MARANDU");
    unmount();
    const r = render(<OperacaoDoServico item={SERVICO} />);
    expect(r.container.textContent).toBe("ROÇADA MECÂNICA");
    expect(screen.queryByTestId("servico-capim-at-14")).toBeNull();
  });

  it("o diálogo Concluir: o título com o capim; sem área, o local no título e a quantidade no lugar dos hectares", () => {
    const { unmount } = render(<DialogoConcluirServico item={MOMBACA} hoje={HOJE} onFechar={vi.fn()} onConcluir={vi.fn()} />);
    expect(screen.getByTestId("dialogo-concluir-servico-nome")).toHaveTextContent("SEMEADURA DE CAPIM · PASTO DA AROEIRA · capim PANICUM CV. MOMBAÇA");
    unmount();
    render(<DialogoConcluirServico item={CERCA} hoje={HOJE} onFechar={vi.fn()} onConcluir={vi.fn()} />);
    expect(screen.getByTestId("dialogo-concluir-servico-nome")).toHaveTextContent("REFORMA DE CERCA · DIVISA NORTE");
    expect(screen.getByTestId("dialogo-concluir-servico-hectares")).toHaveTextContent(/^2,5 km$/);
  });

  it("sem a permissão de editar: 'Sim, finalizei' fica desligado (\"Só quem pode editar finaliza.\"), o término não a marca e o corpo vai SEM concluir", async () => {
    sessao.editar = false;
    const { janela } = await montar({ continuar: SERVICO });
    await abrirTudo(janela);
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data"), { target: { value: "2026-12-05" } });
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data-termino"), { target: { value: HOJE } });
    await preencherODia(janela);
    const situacao = within(janela).getByTestId("registro-de-campo-situacao");
    const concluida = within(situacao).getByRole("radio", { name: "Sim, finalizei" });
    expect(concluida).toBeDisabled();
    expect(concluida).toHaveAttribute("aria-checked", "false");
    expect(within(situacao).getByRole("radio", { name: "Não, continua" })).toHaveAttribute("aria-checked", "true");
    expect(within(janela).getByTestId("registro-de-campo-situacao-sem-permissao")).toHaveTextContent("Só quem pode editar finaliza.");
    fireEvent.click(concluida);
    expect(concluida).toHaveAttribute("aria-checked", "false");
    expect(within(janela).getByTestId("registro-de-campo-resumo")).toHaveTextContent("Vai ficar EM ANDAMENTO");
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body).toMatchObject({ data_operacional: "2026-12-05", data_termino: HOJE });
    expect(registros()[0].body).not.toHaveProperty("concluir");
  });

  it("com a permissão de editar, 'Sim, finalizei' é oferecido e a nota não aparece", async () => {
    const { janela } = await montar({ continuar: SERVICO });
    await within(janela).findByTestId("registro-de-campo-curto");
    expect(within(within(janela).getByTestId("registro-de-campo-situacao")).getByRole("radio", { name: "Sim, finalizei" })).not.toBeDisabled();
    expect(within(janela).queryByTestId("registro-de-campo-situacao-sem-permissao")).toBeNull();
  });
});

// ─── D-PROD-281 (MAIKE-ENTREGA-A): o "Novo lançamento" curto, o horímetro e o bloco "Atividades em andamento" ─────
describe("D-PROD-281 — o Novo lançamento curto", () => {
  const curto = async () => {
    const { janela, onFechar } = await montar({ continuar: SERVICO });
    const form = await within(janela).findByTestId("registro-de-campo-curto");
    await waitFor(() => expect(within(form).getByTestId("registro-de-campo-vai-junto")).toHaveTextContent("JOÃO · 1 diária"));
    return { janela, form, onFechar };
  };
  const escolher = (/** @type {HTMLElement} */ janela, /** @type {string} */ nome) =>
    fireEvent.click(within(within(janela).getByTestId("registro-de-campo-situacao")).getByRole("radio", { name: nome }));

  it("regras: 'Já feito 12 de 40 ha · falta 28'; a dica dos hectares de hoje; o card '12 de 40 ha · falta 28 · último dia ontem'", () => {
    expect(regras.textoJaFeito(SERVICO)).toBe("Já feito 12 de 40 ha · falta 28");
    expect(regras.dicaDosHectaresDeHoje(SERVICO, null)).toBe("pode deixar em branco e informar quando finalizar");
    expect(regras.dicaDosHectaresDeHoje(SERVICO, "4.0000")).toBe("Com isso fica 16 de 40 ha");
    expect(regras.textoDoCardEmAndamento({ ...SERVICO, andamento: andamento({ ultimo_dia: "2026-12-06" }) }, HOJE)).toEqual({ forte: "12 de 40 ha", resto: "falta 28 · último dia ontem" });
    const cerca = { ...SERVICO, area_id: null, area: null, areas: [], local: "DIVISA NORTE", quantidade_produzida: "1.2000", unidade_producao_sigla: "KM", andamento: andamento({ hectares_feitos: null, hectares_area: null, percentual: null }) };
    expect(regras.textoJaFeito(cerca)).toBe("Já feito 1,2 km");
    expect(regras.textoDoCardEmAndamento(cerca, HOJE)).toEqual({ forte: "1,2 km", resto: "DIVISA NORTE · último dia 02/12" });
    expect(regras.atividadesEmAndamento([SERVICO, { ...SERVICO, id: "x", andamento: andamento({ situacao: "CONCLUIDA" }) }]).map((a) => a.id)).toEqual(["at-14"]);
  });

  it("de cima para baixo: o contexto, 'Quantos hectares fez hoje?' (opcional), o Dia, o horímetro, 'Vai junto', 'Mudar', 'Finalizou a atividade hoje?' sem nada marcado", async () => {
    const { janela, form } = await curto();
    expect(within(janela).getByTestId("registro-de-campo-titulo")).toHaveTextContent(/^Novo lançamento$/);
    expect(within(form).getByTestId("registro-de-campo-ja-feito")).toHaveTextContent("Já feito 12 de 40 ha · falta 28");
    const hectares = within(form).getByTestId("registro-de-campo-hectares-hoje");
    expect(hectares).toHaveValue("");
    expect(within(form).getByTestId("registro-de-campo-hectares-dica")).toHaveTextContent("pode deixar em branco e informar quando finalizar");
    fireEvent.change(hectares, { target: { value: "4" } });
    expect(within(form).getByTestId("registro-de-campo-hectares-dica")).toHaveTextContent("Com isso fica 16 de 40 ha");
    expect(within(form).getByTestId("registro-de-campo-data")).toHaveValue(HOJE);
    expect(within(form).getByTestId("registro-de-campo-vai-junto")).toHaveTextContent("TR-02");
    expect(within(form).getByTestId("registro-maquina-curto-nome")).toHaveTextContent("TR-02");
    for (const r of within(form).getAllByRole("radio")) expect(r).toHaveAttribute("aria-checked", "false");
    // O formulário inteiro (Operação, Planejamento, Salvar e novo) não aparece.
    expect(within(janela).queryByTestId("registro-de-campo-form")).toBeNull();
    expect(within(janela).queryByRole("button", { name: "Salvar e novo" })).toBeNull();
  });

  it("sem escolher 'Finalizou a atividade hoje?' nada sai; com 'Não, continua', vai: os hectares, o horímetro (inicial = última leitura) e a pessoa do último dia", async () => {
    const { janela, form, onFechar } = await curto();
    fireEvent.change(within(form).getByTestId("registro-de-campo-hectares-hoje"), { target: { value: "4" } });
    await waitFor(() => expect(within(form).getByTestId("registro-maquina-horimetro-dica")).toHaveTextContent("última hora lançada: 1.244"));
    fireEvent.change(within(form).getByTestId("registro-maquina-leitura-final"), { target: { value: "1252" } });
    expect(within(form).getByTestId("registro-maquina-horimetro-dica")).toHaveTextContent("última hora lançada: 1.244 · hoje dá 8 horas");
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    expect(await within(form).findByTestId("registro-de-campo-situacao-erro")).toHaveTextContent("Escolha se finalizou a atividade hoje.");
    expect(registros()).toHaveLength(0);
    escolher(janela, "Não, continua");
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body).toMatchObject({
      areas: [{ area_id: "area-aroeira", hectares: "4" }],
      maquinas: [{ bem_id: "b-tr", sem_medidor: false, leitura_inicial: "1244", leitura_final: "1252" }],
      mao_obra: [{ parceiro_id: "f-joao", tipo_medida: "DIARIA", quantidade: "1" }],
    });
    expect(registros()[0].body).not.toHaveProperty("concluir");
    await waitFor(() => expect(onFechar).toHaveBeenCalled());
  });

  it("hectares em branco: vai com area_id e sem hectares; 'Sim, finalizei' manda concluir: true", async () => {
    const { janela, form } = await curto();
    await waitFor(() => expect(within(form).getByTestId("registro-maquina-horimetro-dica")).toHaveTextContent("1.244"));
    fireEvent.change(within(form).getByTestId("registro-maquina-leitura-final"), { target: { value: "1250" } });
    escolher(janela, "Sim, finalizei");
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(registros()).toHaveLength(1));
    const corpo = registros()[0].body;
    expect(corpo).toMatchObject({ area_id: "area-aroeira", concluir: true });
    expect(corpo).not.toHaveProperty("areas");
    expect(corpo).not.toHaveProperty("area_executada_dia");
  });

  it("horímetro quebrado: 'Horas corridas de trabalho' (o sem_medidor de sempre); 'Voltar a usar o horímetro' volta", async () => {
    const { janela, form } = await curto();
    await waitFor(() => expect(within(form).getByTestId("registro-maquina-horimetro-quebrado-link")).toBeTruthy());
    expect(within(form).getByText("Horímetro agora")).toBeTruthy();
    fireEvent.click(within(form).getByTestId("registro-maquina-horimetro-quebrado-link"));
    expect(within(form).getByTestId("registro-maquina-horimetro-quebrado")).toHaveTextContent("horímetro quebrado");
    expect(within(form).getByText("Horas corridas de trabalho")).toBeTruthy();
    expect(within(form).queryByTestId("registro-maquina-leitura-final")).toBeNull();
    fireEvent.click(within(form).getByTestId("registro-maquina-voltar-horimetro"));
    expect(within(form).getByTestId("registro-maquina-leitura-final")).toBeTruthy();
    fireEvent.click(within(form).getByTestId("registro-maquina-horimetro-quebrado-link"));
    fireEvent.change(within(form).getByTestId("registro-maquina-quantidade-uso"), { target: { value: "8" } });
    escolher(janela, "Não, continua");
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.maquinas).toEqual([expect.objectContaining({ bem_id: "b-tr", sem_medidor: true, quantidade_uso: "8" })]);
  });

  it("'Mudar' mostra o formulário inteiro (as tabelas e os editores), sem perder o que foi digitado", async () => {
    const { janela, form } = await curto();
    fireEvent.change(within(form).getByTestId("registro-de-campo-hectares-hoje"), { target: { value: "3" } });
    escolher(janela, "Não, continua");
    fireEvent.click(within(form).getByTestId("registro-de-campo-mudar"));
    const inteiro = await within(janela).findByTestId("registro-de-campo-form");
    expect(within(inteiro).getByTestId("registro-areas-hectares-area-aroeira")).toHaveValue("3");
    expect(within(inteiro).getByTestId("registro-maquina-editor")).toBeTruthy();
    expect(within(inteiro).getByTestId("registro-incluir-insumo")).toBeTruthy();
    expect(within(within(inteiro).getByTestId("registro-de-campo-situacao")).getByRole("radio", { name: "Não, continua" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("D-PROD-281 — o bloco 'Atividades em andamento'", () => {
  it("um card por atividade em andamento, com '+ Lançamento' e 'Finalizar' pelas permissões da linha", async () => {
    const { default: AtividadesEmAndamento } = await import("@/components/lancamento-atividades/AtividadesEmAndamento");
    const onLancar = vi.fn();
    const onFinalizar = vi.fn();
    const finalizada = { ...SERVICO, id: "at-15", andamento: andamento({ situacao: "CONCLUIDA" }) };
    const plantio = { ...SERVICO, id: "at-31", tipo_atividade_nome: "SEMEADURA DE CAPIM", areas: [SERVICO.areas[0]], plantio: { cultura: { nome: "MOMBAÇA" } }, andamento: andamento({ ultimo_dia: "2026-12-06" }) };
    const { unmount } = render(
      <AtividadesEmAndamento itens={[SERVICO, finalizada, plantio]} hoje={HOJE} podeLancar={() => true} podeFinalizar={(i) => i.id === "at-14"} onLancar={onLancar} onFinalizar={onFinalizar} />,
    );
    const bloco = screen.getByTestId("atividades-em-andamento");
    expect(bloco).toHaveTextContent("Atividades em andamento (2)");
    expect(screen.queryByTestId("em-andamento-at-15")).toBeNull();
    const card = screen.getByTestId("em-andamento-at-31");
    expect(card).toHaveTextContent("SEMEADURA DE CAPIM");
    expect(card).toHaveTextContent("PASTO DA AROEIRA · capim MOMBAÇA");
    expect(screen.getByTestId("em-andamento-texto-at-31")).toHaveTextContent("12 de 40 ha · falta 28 · último dia ontem");
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["Lançamento"]);
    expect(within(screen.getByTestId("em-andamento-at-14")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Lançamento", "Finalizar"]);
    fireEvent.click(screen.getByTestId("em-andamento-lancar-at-14"));
    fireEvent.click(screen.getByTestId("em-andamento-finalizar-at-14"));
    expect(onLancar).toHaveBeenCalledWith(SERVICO);
    expect(onFinalizar).toHaveBeenCalledWith(SERVICO);
    unmount();
    // Sem permissão: os cards sem botões; sem nenhuma em andamento, nada.
    const r = render(<AtividadesEmAndamento itens={[SERVICO]} hoje={HOJE} podeLancar={() => false} podeFinalizar={() => false} onLancar={onLancar} onFinalizar={onFinalizar} />);
    expect(within(screen.getByTestId("em-andamento-at-14")).queryAllByRole("button")).toEqual([]);
    r.unmount();
    const vazio = render(<AtividadesEmAndamento itens={[finalizada]} hoje={HOJE} podeLancar={() => true} podeFinalizar={() => true} onLancar={onLancar} onFinalizar={onFinalizar} />);
    expect(vazio.container.textContent).toBe("");
  });
});
