/**
 * Lançamento de Atividades — Fatia 3 (D-PROD-202): as linhas que geram custo,
 * produto e máquina, dentro de cada apontamento, o totalizador da atividade e
 * o "Repetir último lançamento" com as linhas. A tela montada de verdade
 * (página, ListaApontamentos, LinhasDoApontamento, janelas, service, API,
 * porta e `nativeHttpClient` reais); mocks só da borda: `fetch` (um backend
 * falso no formato do contrato docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md
 * §4), a sessão, o fuso das empresas e os cadastros vizinhos (tipos, áreas).
 *
 * Cobre:
 *  - os blocos "Produtos" e "Máquinas" com as linhas (a cancelada visível e
 *    marcada); sem `permite_produto` o bloco Produtos some; implemento só com
 *    `permite_implemento`;
 *  - ações por permissão (lançar/editar/cancelar apontamento) e status
 *    (atividade ABERTA, apontamento CONFIRMADO);
 *  - janela de produto: favoritos, local com saldo, quantidade com a unidade
 *    do produto (nunca digitada), dose/ha calculada, saldo insuficiente
 *    (aviso local e recusa do servidor com disponível × pedido), editar e
 *    cancelar (motivo) com `versao` e `operation_id`;
 *  - janela de máquina: máquina do cabeçalho como padrão, medidor do bem (só
 *    leitura), leitura inicial sugerida, final obrigatória, uso calculado,
 *    "sem medidor" e o salto (ATIVIDADE_SALTO_MEDIDOR → justificativa → reenvio);
 *  - retentativa idempotente: sem resposta, "Repetir o mesmo envio" leva a
 *    MESMA `operation_id` e o mesmo corpo (uma linha só no servidor);
 *  - totalizador: área, total por produto, uso por máquina, custo e custo/ha,
 *    relido depois de cada escrita;
 *  - "Repetir último lançamento": as linhas da base preenchidas (leitura
 *    sugerida de novo) e UM POST com `produtos[]` e `maquinas[]`;
 *  - paridade das allowlists das linhas com os schemas fechados do servidor;
 *  - Fatia 4 (docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md §3 a §7):
 *    os blocos "Mão de obra" e "Serviços" só com `permite_mao_obra` /
 *    `permite_servico`; adicionar, editar e cancelar; custo da hora/diária
 *    vindo do cadastro × custo da tarefa digitado; serviço com o valor de
 *    referência pré-preenchido e o parceiro opcional (só prestadores);
 *    totalizador e "Repetir" com as linhas novas; allowlists da porta;
 *  - D-PROD-208: a mão de obra é de um PARCEIRO — funcionário (papel do
 *    parceiro, custos do cadastro dele) ou terceiro (prestador de serviço, custo
 *    unitário sempre digitado e obrigatório); seletor `/atividades-opcoes/mao-obra`;
 *    corpo com `parceiro_id`; totalizador marca o terceiro;
 *  - Fatia 5 (docs/engineering/MAIKE-ATIVIDADE-ABASTECIMENTO-CONTRATO.md §3, D-PROD-211): o bloco "Abastecimentos" de
 *    cada lançamento (só com a tela Abastecimentos), lista pelo filtro `apontamento_id`, "Novo abastecimento" abre o
 *    MESMO formulário ligado ao lançamento (atividade e lançamento só leitura, data do lançamento, corpo com
 *    `apontamento_id` e sem `atividade_id`), cancelamento pelo diálogo de sempre e o totalizador com o combustível,
 *    o custo de combustível/ha e o consumo por bem. As rotas de abastecimento usam o backend falso da tela
 *    Abastecimentos (`abastecimentosFakeCore`).
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import { API_FAKE, envelope, erroServidor, instalarBackendFake } from "./fixtures/gestaoBackendFake.js";
import { criarEstadoAbastecimentos, rotearAbastecimentos, semearAbastecimento } from "./fixtures/abastecimentosFakeCore.js";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), ...notify }));

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: "cli-1" }));
vi.mock("@/components/lancamento-atividades/AtividadeAberta", async (importOriginal) => {
  const real = await importOriginal();
  const { comDiasLegados } = await import("./helpers/diasLegadoNoTeste.jsx");
  return { ...real, default: comDiasLegados(real.default) };
});
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: "u1" } }) }));
vi.mock("@/services/sessionService", async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: "operador", cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(async () => sessao.permissao),
}));
vi.mock("@/services/empresaService", async (importOriginal) => ({
  ...(await importOriginal()),
  listEmpresas: vi.fn(async () => [{ id: "emp-1", nome: "FAZENDA BOA VISTA", fuso_horario: "America/Cuiaba" }]),
}));
const tiposSrv = vi.hoisted(() => ({
  listarGruposSimples: vi.fn(async () => []),
  listarTiposAtividade: vi.fn(async () => []),
  criarTipoAtividade: vi.fn(),
  atualizarTipoAtividade: vi.fn(),
  excluirTiposAtividade: vi.fn(),
  listarCentrosDaFazenda: vi.fn(async () => []),
  listarUnidadesDeMedida: vi.fn(async () => []),
}));
vi.mock("@/services/tipoAtividadeCadastroService", () => tiposSrv);
const mapaSrv = vi.hoisted(() => ({ listarAreasAtivas: vi.fn(async () => []) }));
vi.mock("@/services/mapaService", async (importOriginal) => ({ ...(await importOriginal()), ...mapaSrv }));
const tarefasSrv = vi.hoisted(() => ({ listarTarefasDaEmpresa: vi.fn(async () => []) }));
vi.mock("@/services/tarefasMapaService", async (importOriginal) => ({ ...(await importOriginal()), ...tarefasSrv }));
// "Envio igual sem resposta?": a pergunta do mecanismo de pendência é respondida pelo teste.
const confirmacao = vi.hoisted(() => ({ confirmar: vi.fn(async () => true) }));
vi.mock("@/lib/maikeConfirmar", () => confirmacao);

const { default: LancamentoAtividades } = await import("@/pages/LancamentoAtividades");

const HOJE = "2026-11-14";
const AGORA = new Date("2026-11-14T15:00:00.000Z");
const MODULO = "suporte-mapa";
const TELA = "op-atividades";
const TODAS = { visualizar: true, novo: true, editar: true, excluir: true, reabrir: true, lancar_apontamento: true, editar_apontamento: true, cancelar_apontamento: true };
/** @param {Record<string, boolean>} acoes */
const permissaoCom = (acoes) => ({
  user_email: "operador",
  is_admin: false,
  modulos_permitidos: [MODULO],
  permissoes_telas: [{ modulo_id: MODULO, tela_id: TELA, visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes }],
});

// ─── Cadastros ──────────────────────────────────────────────────────────
const TIPOS = [
  { id: "t1", nome_tipo: "APLICAÇÃO", grupo_atividade_id: "g1", ativo: true, exige_maquina: true, permite_produto: true, permite_implemento: true },
  { id: "t2", nome_tipo: "ROÇADA", grupo_atividade_id: "g1", ativo: true, permite_produto: false, permite_implemento: false },
  { id: "t3", nome_tipo: "COLHEITA MANUAL", grupo_atividade_id: "g1", ativo: true, permite_produto: false, permite_implemento: false, permite_mao_obra: true, permite_servico: true },
];
// Fatia 4 / D-PROD-208: a mão de obra (parceiros funcionário ou terceiro), o serviço e o parceiro prestador (as opções da tela).
const MAO_OBRA = [
  { id: "f1", nome: "José Silva", origem: "FUNCIONARIO", funcionario_tipo: "MENSALISTA", funcionario_custo_hora: "20.0000", funcionario_custo_diaria: "160.0000" },
  { id: "f2", nome: "Ana Souza", origem: "FUNCIONARIO", funcionario_tipo: "TERCEIRIZADO", funcionario_custo_hora: null, funcionario_custo_diaria: null },
  { id: "f3", nome: "Pedro Lima", origem: "FUNCIONARIO", funcionario_tipo: "DIARISTA", funcionario_custo_hora: null, funcionario_custo_diaria: "150.0000" },
  { id: "pp2", nome: "Empreiteira Rocha", origem: "TERCEIRO", funcionario_tipo: null, funcionario_custo_hora: null, funcionario_custo_diaria: null },
];
/** O resumo `parceiro` da linha, como o servidor devolve. @param {string} id */
const resumoParceiro = (id) => {
  const o = MAO_OBRA.find((x) => x.id === id);
  return {
    id,
    nome: o?.nome,
    // A origem com que o parceiro entraria AGORA numa linha nova (o "Repetir" parte dela).
    origem_atual: o?.origem ?? null,
    funcionario_tipo: o?.funcionario_tipo ?? null,
    funcionario_cargo: o?.origem === "FUNCIONARIO" ? "TRATORISTA" : null,
    funcionario_custo_hora: o?.funcionario_custo_hora ?? null,
    funcionario_custo_diaria: o?.funcionario_custo_diaria ?? null,
  };
};
const SERVICOS = [
  { id: "s1", numero: "1", nome: "Frete", unidade: "KM", valor_referencia: "5.0000" },
  { id: "s2", numero: "2", nome: "Roçada terceirizada", unidade: "HA", valor_referencia: null },
];
const PARCEIROS = [{ id: "pp1", nome: "Transportes Silva" }];
const TRATOR = { id: "b1", numero: "2", codigo_frota: "TP-02", nome: "Trator", natureza: "MAQUINA" };
const CAMINHAO = { id: "b2", numero: "5", codigo_frota: "CM-01", nome: "Caminhão", natureza: "VEICULO" };
const GRADE = { id: "i1", numero: "9", codigo_frota: "GR-01", nome: "Grade", natureza: "IMPLEMENTO" };
const PRODUTOS = [
  { id: "p1", nome: "Glifosato", unidade: "L", unidade_principal_estoque: "L", favorito: true },
  { id: "p2", nome: "Ureia", unidade: "KG", unidade_principal_estoque: "SACO", favorito: false },
];
const LOCAIS = /** @type {Record<string, any[]>} */ ({
  p1: [{ local_estoque_id: "l1", local_nome: "Galpão", disponivel: "30.0000", unidade: "L", unidade_principal_estoque: "L" }],
  p2: [
    { local_estoque_id: "l1", local_nome: "Galpão", disponivel: "500.0000", unidade: "KG", unidade_principal_estoque: "SACO" },
    { local_estoque_id: "l2", local_nome: "Silo", disponivel: "80.0000", unidade: "KG", unidade_principal_estoque: "SACO" },
  ],
});
/** Medidor de cada bem (`/atividades-opcoes/medidor`), como o servidor devolve. */
let MEDIDORES = /** @type {Record<string, any>} */ ({});
const medidoresPadrao = () => ({
  b1: {
    bem: TRATOR,
    data: HOJE,
    medidor_tipo: "HORIMETRO",
    medidor_unidade: "h",
    sem_medidor: false,
    leitura_vigente: { leitura: "1550.0000", data: "2026-11-12", origem: "ATIVIDADE" },
    leitura_sugerida: "1550.0000",
    salto_maximo_medidor: null,
    custo_uso_unitario: "50.0000",
  },
  b2: { bem: CAMINHAO, data: HOJE, medidor_tipo: "SEM_MEDIDOR", medidor_unidade: null, sem_medidor: true, leitura_vigente: null, salto_maximo_medidor: null, custo_uso_unitario: null },
});

const usuario = (/** @type {string} */ id, /** @type {string} */ nome) => ({ id, nome });
const ATV = Object.freeze({
  id: "a1",
  empresa_id: "emp-1",
  numero: "3",
  nome: "Cigarrinha Pasto 01",
  status: "ABERTA",
  versao: 4,
  tipo_atividade_id: "t1",
  tipo_atividade_nome: "APLICAÇÃO",
  grupo_atividade_nome: "PASTAGEM",
  area_id: "ar1",
  area: { id: "ar1", numero_area: "01", nome: "Pasto 01" },
  bem_id: "b1",
  bem: TRATOR,
  data_inicio: "2026-11-01",
  data_prevista_fim: "2026-11-30",
  area_planejada: "40.0000",
  area_executada: "10.0000",
  quantidade_produzida: null,
  createdAt: "2026-11-01T12:00:00.000Z",
});

const linhaProduto = (/** @type {Record<string, any>} */ extra) => ({
  id: "pl1",
  ordem: 1,
  status: "CONFIRMADO",
  produto_id: "p1",
  produto: { id: "p1", nome: "Glifosato" },
  local_estoque_id: "l1",
  local_estoque: { id: "l1", nome: "Galpão" },
  quantidade: "25.0000",
  unidade: "L",
  dose_ha: "2.5000",
  custo_unitario: "5.0000",
  custo_total: "125.0000",
  observacao: null,
  cancelado_em: null,
  cancelado_por: null,
  motivo_cancelamento: null,
  cancelamento_origem: null,
  createdAt: "2026-11-12T10:00:00.000Z",
  ...extra,
});
const linhaMaquina = (/** @type {Record<string, any>} */ extra) => ({
  id: "ml1",
  ordem: 1,
  status: "CONFIRMADO",
  bem_id: "b1",
  bem: TRATOR,
  implemento_bem_id: null,
  implemento: null,
  medidor_tipo: "HORIMETRO",
  medidor_unidade: "h",
  sem_medidor: false,
  leitura_inicial: "1542.0000",
  leitura_final: "1550.0000",
  quantidade_uso: "8.0000",
  justificativa_salto: null,
  custo_unitario_uso: "50.0000",
  custo_total: "400.0000",
  observacao: null,
  cancelado_em: null,
  cancelado_por: null,
  motivo_cancelamento: null,
  cancelamento_origem: null,
  createdAt: "2026-11-12T10:00:00.000Z",
  ...extra,
});
const linhaMaoObra = (/** @type {Record<string, any>} */ extra) => ({
  id: "mo1",
  ordem: 1,
  status: "CONFIRMADO",
  parceiro_id: "f1",
  origem: "FUNCIONARIO",
  parceiro: resumoParceiro("f1"),
  tipo_medida: "HORA",
  quantidade: "8.0000",
  custo_unitario: "20.0000",
  custo_total: "160.0000",
  observacao: null,
  cancelado_em: null,
  cancelado_por: null,
  motivo_cancelamento: null,
  cancelamento_origem: null,
  createdAt: "2026-11-12T10:00:00.000Z",
  ...extra,
});
const linhaServico = (/** @type {Record<string, any>} */ extra) => ({
  id: "sv1",
  ordem: 1,
  status: "CONFIRMADO",
  servico_id: "s1",
  servico: { id: "s1", numero: "1", nome: "Frete" },
  fornecedor_parceiro_id: "pp1",
  fornecedor_parceiro: { id: "pp1", nome: "Transportes Silva" },
  quantidade: "10.0000",
  unidade: "KM",
  valor_unitario: "5.0000",
  valor_total: "50.0000",
  documento_referencia: "NF 77",
  observacao: null,
  cancelado_em: null,
  cancelado_por: null,
  motivo_cancelamento: null,
  cancelamento_origem: null,
  createdAt: "2026-11-12T10:00:00.000Z",
  ...extra,
});
const apontamento = (/** @type {Record<string, any>} */ extra) => ({
  id: "ap1",
  empresa_id: "emp-1",
  atividade_id: "a1",
  data_operacional: "2026-11-12",
  turno: "MANHA",
  sequencia: 1,
  operador_usuario_id: null,
  operador: null,
  area_executada_dia: "10.0000",
  quantidade_produzida_dia: null,
  observacao: null,
  origem: "WEB",
  status: "CONFIRMADO",
  versao: 3,
  cancelado_em: null,
  cancelado_por: null,
  motivo_cancelamento: null,
  createdAt: "2026-11-12T10:00:00.000Z",
  produtos: [],
  maquinas: [],
  mao_obra: [],
  servicos: [],
  ...extra,
});

// ─── Backend falso ──────────────────────────────────────────────────────
/** @type {{ chamadas: Array<{ method: string, path: string, query: Record<string, string>, body: any }> }} */
let backend;
/** @type {Map<string, any>} */
let atividades;
/** @type {Map<string, any[]>} */
let apontamentosPorAtividade;
/** Resposta injetada na PRÓXIMA escrita. @type {{ status: number, body?: unknown } | null} */
let proxima;
/** A próxima escrita GRAVA e a resposta se perde na rede (resultado incerto). */
let perderResposta = false;
/** operation_id → resposta gravada (replay do servidor). @type {Map<string, any>} */
let gravados;
let proximoId = 0;
/** Fatia 5: o backend falso dos abastecimentos (rotas `/patrimonio-abastecimentos*`). @type {ReturnType<typeof criarEstadoAbastecimentos>} */
let abast;
/** Fatia 5: campos do combustível acrescentados à resposta dos totais. @type {Record<string, any> | null} */
let totaisExtra = null;

const t4 = (/** @type {number} */ n) => n.toFixed(4);
const CUSTO_PRODUTO = 5;
const CUSTO_HORA = 50;
const novaLinhaProduto = (/** @type {any} */ b, /** @type {any} */ ap) => {
  proximoId += 1;
  const produto = PRODUTOS.find((p) => p.id === b.produto_id);
  const local = (LOCAIS[b.produto_id] ?? []).find((l) => l.local_estoque_id === b.local_estoque_id);
  const q = Number(b.quantidade);
  return linhaProduto({
    id: `pl-n${proximoId}`,
    ordem: (ap.produtos?.length ?? 0) + 1,
    produto_id: b.produto_id,
    produto: { id: b.produto_id, nome: produto?.nome },
    local_estoque_id: b.local_estoque_id,
    local_estoque: { id: b.local_estoque_id, nome: local?.local_nome },
    quantidade: t4(q),
    unidade: produto?.unidade,
    dose_ha: ap.area_executada_dia ? t4(q / Number(ap.area_executada_dia)) : null,
    custo_total: t4(q * CUSTO_PRODUTO),
    observacao: b.observacao ?? null,
    createdAt: AGORA.toISOString(),
  });
};
const novaLinhaMaquina = (/** @type {any} */ b, /** @type {any} */ ap) => {
  proximoId += 1;
  const bem = [TRATOR, CAMINHAO].find((x) => x.id === b.bem_id);
  const med = MEDIDORES[b.bem_id];
  const uso = b.sem_medidor ? Number(b.quantidade_uso) : Number(b.leitura_final) - Number(b.leitura_inicial);
  return linhaMaquina({
    id: `ml-n${proximoId}`,
    ordem: (ap.maquinas?.length ?? 0) + 1,
    bem_id: b.bem_id,
    bem,
    implemento_bem_id: b.implemento_bem_id ?? null,
    implemento: b.implemento_bem_id ? GRADE : null,
    medidor_tipo: med?.medidor_tipo ?? "SEM_MEDIDOR",
    medidor_unidade: med?.medidor_unidade ?? null,
    sem_medidor: b.sem_medidor === true,
    leitura_inicial: b.sem_medidor ? null : t4(Number(b.leitura_inicial)),
    leitura_final: b.sem_medidor ? null : t4(Number(b.leitura_final)),
    quantidade_uso: t4(uso),
    justificativa_salto: b.justificativa_salto ?? null,
    custo_total: med?.custo_uso_unitario ? t4(uso * CUSTO_HORA) : null,
    createdAt: AGORA.toISOString(),
  });
};
const novaLinhaMaoObra = (/** @type {any} */ b, /** @type {any} */ ap, /** @type {any} */ anterior = null) => {
  proximoId += 1;
  const f = MAO_OBRA.find((x) => x.id === b.parceiro_id);
  const terceiro = f?.origem === "TERCEIRO";
  const q = Number(b.quantidade);
  // Funcionário, hora e diária: o custo do cadastro (snapshot) — na edição sem trocar parceiro nem medida, o snapshot
  // gravado fica; tarefa e terceiro: o do corpo.
  const mantem = anterior && anterior.parceiro_id === b.parceiro_id && anterior.tipo_medida === b.tipo_medida;
  const cu =
    terceiro || b.tipo_medida === "TAREFA"
      ? b.custo_unitario
      : mantem
        ? anterior.custo_unitario
        : b.tipo_medida === "DIARIA"
          ? f?.funcionario_custo_diaria
          : f?.funcionario_custo_hora;
  return linhaMaoObra({
    id: `mo-n${proximoId}`,
    ordem: (ap.mao_obra?.length ?? 0) + 1,
    parceiro_id: b.parceiro_id,
    origem: terceiro ? "TERCEIRO" : "FUNCIONARIO",
    parceiro: resumoParceiro(b.parceiro_id),
    tipo_medida: b.tipo_medida,
    quantidade: t4(q),
    custo_unitario: cu != null ? t4(Number(cu)) : null,
    custo_total: cu != null ? t4(q * Number(cu)) : null,
    observacao: b.observacao ?? null,
    createdAt: AGORA.toISOString(),
  });
};
const novaLinhaServico = (/** @type {any} */ b, /** @type {any} */ ap) => {
  proximoId += 1;
  const sv = SERVICOS.find((x) => x.id === b.servico_id);
  const parceiro = PARCEIROS.find((x) => x.id === b.fornecedor_parceiro_id) ?? null;
  const q = Number(b.quantidade);
  return linhaServico({
    id: `sv-n${proximoId}`,
    ordem: (ap.servicos?.length ?? 0) + 1,
    servico_id: b.servico_id,
    servico: { id: b.servico_id, numero: sv?.numero, nome: sv?.nome },
    fornecedor_parceiro_id: parceiro?.id ?? null,
    fornecedor_parceiro: parceiro,
    quantidade: t4(q),
    unidade: sv?.unidade,
    valor_unitario: t4(Number(b.valor_unitario)),
    valor_total: t4(q * Number(b.valor_unitario)),
    documento_referencia: b.documento_referencia ?? null,
    observacao: b.observacao ?? null,
    createdAt: AGORA.toISOString(),
  });
};
const cancelada = (/** @type {any} */ l, /** @type {string} */ origem, /** @type {string|null} */ motivo) => ({
  ...l,
  status: "CANCELADO",
  cancelado_em: AGORA.toISOString(),
  cancelado_por: usuario("u1", "Gerente"),
  motivo_cancelamento: motivo,
  cancelamento_origem: origem,
});
/** Totais do contrato §4: só linhas CONFIRMADO de apontamentos CONFIRMADO. @param {string} id */
const totaisDe = (id) => {
  const atv = atividades.get(id);
  const aps = (apontamentosPorAtividade.get(id) ?? []).filter((a) => a.status === "CONFIRMADO");
  /** @type {Map<string, any>} */
  const prods = new Map();
  /** @type {Map<string, any>} */
  const maqs = new Map();
  /** @type {Map<string, any>} */
  const mos = new Map();
  /** @type {Map<string, any>} */
  const svs = new Map();
  let custo = 0;
  let area = 0;
  /** D-PROD-234: as parcelas do custo por tipo (null sem nenhuma linha com custo daquele tipo). @type {Record<string, number|null>} */
  const porTipo = { maquinas: null, produtos: null, mao_obra: null, servicos: null };
  const somaTipo = (/** @type {string} */ k, /** @type {unknown} */ v) => {
    if (v == null) return;
    porTipo[k] = (porTipo[k] ?? 0) + Number(v);
  };
  for (const a of aps) {
    area += Number(a.area_executada_dia ?? 0);
    for (const l of a.produtos.filter((/** @type {any} */ x) => x.status === "CONFIRMADO")) {
      const t = prods.get(l.produto_id) ?? { produto_id: l.produto_id, nome: l.produto.nome, unidade: l.unidade, q: 0, c: 0 };
      t.q += Number(l.quantidade);
      t.c += Number(l.custo_total);
      prods.set(l.produto_id, t);
      custo += Number(l.custo_total);
      somaTipo("produtos", l.custo_total);
    }
    for (const l of a.maquinas.filter((/** @type {any} */ x) => x.status === "CONFIRMADO")) {
      const t = maqs.get(l.bem_id) ?? { bem_id: l.bem_id, nome: l.bem.nome, medidor_unidade: l.medidor_unidade, u: 0, c: 0 };
      t.u += Number(l.quantidade_uso);
      t.c += Number(l.custo_total ?? 0);
      maqs.set(l.bem_id, t);
      custo += Number(l.custo_total ?? 0);
      somaTipo("maquinas", l.custo_total);
    }
    for (const l of (a.mao_obra ?? []).filter((/** @type {any} */ x) => x.status === "CONFIRMADO")) {
      const k = `${l.parceiro_id}-${l.origem}-${l.tipo_medida}`;
      const t = mos.get(k) ?? { parceiro_id: l.parceiro_id, nome: l.parceiro.nome, origem: l.origem, tipo_medida: l.tipo_medida, q: 0, c: 0 };
      t.q += Number(l.quantidade);
      t.c += Number(l.custo_total ?? 0);
      mos.set(k, t);
      custo += Number(l.custo_total ?? 0);
      somaTipo("mao_obra", l.custo_total);
    }
    for (const l of (a.servicos ?? []).filter((/** @type {any} */ x) => x.status === "CONFIRMADO")) {
      const k = `${l.servico_id}-${l.unidade}`;
      const t = svs.get(k) ?? { servico_id: l.servico_id, nome: l.servico.nome, unidade: l.unidade, q: 0, c: 0 };
      t.q += Number(l.quantidade);
      t.c += Number(l.valor_total);
      svs.set(k, t);
      custo += Number(l.valor_total);
      somaTipo("servicos", l.valor_total);
    }
  }
  return {
    area_executada: area ? t4(area) : null,
    area_planejada: atv.area_planejada,
    unidade_area: "ha",
    produtos: [...prods.values()].map((t) => ({ produto_id: t.produto_id, nome: t.nome, unidade: t.unidade, quantidade: t4(t.q), custo_total: t4(t.c) })),
    maquinas: [...maqs.values()].map((t) => ({ bem_id: t.bem_id, nome: t.nome, medidor_unidade: t.medidor_unidade, quantidade_uso: t4(t.u), custo_total: t4(t.c) })),
    mao_obra: [...mos.values()].map((t) => ({ parceiro_id: t.parceiro_id, nome: t.nome, origem: t.origem, tipo_medida: t.tipo_medida, quantidade: t4(t.q), custo_total: t4(t.c) })),
    servicos: [...svs.values()].map((t) => ({ servico_id: t.servico_id, nome: t.nome, unidade: t.unidade, quantidade: t4(t.q), custo_total: t4(t.c) })),
    custo_total: custo ? t4(custo) : null,
    custo_por_ha: custo && area ? t4(custo / area) : null,
    custo_por_tipo: { ...Object.fromEntries(Object.entries(porTipo).map(([k, v]) => [k, v == null ? null : t4(v)])), combustivel: null },
    litros_combustivel_por_ha: null,
    ...(totaisExtra ?? {}),
  };
};

/**
 * As recusas da mão de obra no servidor (D-PROD-208): parceiro fora da lista (uniforme, sem dizer o porquê), terceiro
 * sem custo digitado, custo enviado na hora/diária do funcionário. @param {any} enviado @param {any} efetivo
 */
const recusaDaMaoObra = (enviado, efetivo) => {
  const recusa = (/** @type {string} */ field, /** @type {string} */ reason) =>
    erroServidor(422, "ATIVIDADE_LINHA_INVALIDA", { field, reason, details: { entidade: "linha_mao_obra", field, reason } });
  const p = MAO_OBRA.find((x) => x.id === efetivo.parceiro_id);
  if (!p) return recusa("parceiro_id", "parceiro_invalido");
  const digitado = p.origem === "TERCEIRO" || efetivo.tipo_medida === "TAREFA";
  if (digitado && (efetivo.custo_unitario == null || efetivo.custo_unitario === "")) return recusa("custo_unitario", "obrigatorio");
  if (!digitado && Object.prototype.hasOwnProperty.call(enviado, "custo_unitario")) return recusa("custo_unitario", "nao_aceito");
  return null;
};

/** Grava (com replay pela operation_id) e, se pedido, perde a resposta depois de gravar. @param {string|undefined} op @param {() => any} gravar */
const comIdempotencia = (op, gravar) => {
  if (op && gravados.has(op)) return { status: 200, body: { ...gravados.get(op), replay: true } };
  const r = gravar();
  if (op && r.status < 300) gravados.set(op, r.body);
  if (perderResposta) {
    perderResposta = false;
    throw new TypeError("Failed to fetch");
  }
  return r;
};

const rotear = async (/** @type {{ method: string, path: string, query: URLSearchParams, body: any }} */ { method, path, query, body }) => {
  if (proxima && method !== "GET") {
    const r = proxima;
    proxima = null;
    return r;
  }
  if (path.startsWith("/patrimonio-abastecimentos")) return rotearAbastecimentos(abast, { method, path, query, body });
  const partes = path.split("/").filter(Boolean);
  if (partes[0] === "atividades-opcoes" && method === "GET") {
    const recurso = partes[1];
    if (recurso === "medidor") return { status: 200, body: MEDIDORES[String(query.get("bem_id"))] ?? {} };
    if (recurso === "locais") return { status: 200, body: { itens: LOCAIS[String(query.get("produto_id"))] ?? [] } };
    const porRecurso = /** @type {Record<string, any[]>} */ ({
      bens: [TRATOR, CAMINHAO],
      implementos: [GRADE],
      produtos: PRODUTOS,
      "mao-obra": MAO_OBRA,
      servicos: SERVICOS,
      "parceiros-servico": PARCEIROS,
    });
    const itens = porRecurso[recurso] ?? [];
    return { status: 200, body: { itens, has_more: false, next_cursor: null } };
  }
  if (partes[0] !== "atividades") return undefined;
  if (partes.length === 1 && method === "GET") {
    return { status: 200, body: envelope([...atividades.values()].filter((a) => a.empresa_id === query.get("empresa_id"))) };
  }
  const id = partes[1];
  const atv = atividades.get(id);
  if (!atv) return erroServidor(404, "ATIVIDADE_NOT_FOUND");
  if (partes.length === 2 && method === "GET") return { status: 200, body: atv };
  if (partes.length === 3 && partes[2] === "totais" && method === "GET") return { status: 200, body: totaisDe(id) };
  if (partes[2] !== "apontamentos") return undefined;
  const lista = apontamentosPorAtividade.get(id) ?? [];
  if (partes.length === 3 && method === "GET") return { status: 200, body: { items: lista } };
  if (partes.length === 3 && method === "POST") {
    return comIdempotencia(body.operation_id, () => {
      proximoId += 1;
      const ap = apontamento({
        id: `apn${proximoId}`,
        data_operacional: body.data_operacional,
        turno: body.turno ?? null,
        sequencia: 2,
        area_executada_dia: body.area_executada_dia != null ? t4(Number(body.area_executada_dia)) : null,
        versao: 1,
        createdAt: AGORA.toISOString(),
      });
      ap.produtos = (body.produtos ?? []).map((/** @type {any} */ p) => novaLinhaProduto(p, ap));
      ap.maquinas = (body.maquinas ?? []).map((/** @type {any} */ m) => novaLinhaMaquina(m, ap));
      ap.mao_obra = (body.mao_obra ?? []).map((/** @type {any} */ o) => novaLinhaMaoObra(o, ap));
      ap.servicos = (body.servicos ?? []).map((/** @type {any} */ v) => novaLinhaServico(v, ap));
      apontamentosPorAtividade.set(id, [...lista, ap]);
      return { status: 201, body: { apontamento: ap, atividade: atv, alertas: [] } };
    });
  }
  const apId = partes[3];
  const ap = lista.find((a) => a.id === apId);
  if (!ap) return erroServidor(404, "ATIVIDADE_APONTAMENTO_NOT_FOUND");
  if (partes.length === 4 && method === "GET") return { status: 200, body: ap };
  const segmento = partes[4];
  const COLECOES = /** @type {Record<string, string>} */ ({ produtos: "produtos", maquinas: "maquinas", "mao-obra": "mao_obra", servicos: "servicos" });
  const tipo = COLECOES[segmento];
  if (!tipo) return undefined;
  const salvar = (/** @type {any} */ novo) => {
    apontamentosPorAtividade.set(id, (apontamentosPorAtividade.get(id) ?? []).map((a) => (a.id === apId ? novo : a)));
    return novo;
  };
  // O reenvio igual (mesma operation_id) devolve o gravado ANTES do CAS; o envio novo com versão velha → 409.
  const conflito = () => (body?.versao !== ap.versao ? erroServidor(409, "ATIVIDADE_VERSAO_CONFLITO", { details: { entidade: "apontamento" } }) : null);
  const nova = /** @type {Record<string, (b: any, ap: any) => any>} */ ({ produtos: novaLinhaProduto, maquinas: novaLinhaMaquina, mao_obra: novaLinhaMaoObra, servicos: novaLinhaServico })[tipo];
  if (partes.length === 5 && method === "POST") {
    return comIdempotencia(body.operation_id, () => {
      const c = conflito();
      if (c) return c;
      const r = tipo === "mao_obra" ? recusaDaMaoObra(body, body) : null;
      if (r) return r;
      const linha = nova(body, ap);
      const novo = salvar({ ...ap, versao: ap.versao + 1, [tipo]: [...ap[tipo], linha] });
      return { status: 201, body: { linha, apontamento: novo, atividade: atv } };
    });
  }
  const linhaId = partes[5];
  const linha = ap[tipo].find((/** @type {any} */ l) => l.id === linhaId);
  if (!linha) return erroServidor(404, "ATIVIDADE_LINHA_NOT_FOUND");
  if (partes.length === 6 && method === "PATCH") {
    return comIdempotencia(body.operation_id, () => {
      const c = conflito();
      if (c) return c;
      const { empresa_id: _e, versao: _v, operation_id: _o, ...dados } = body;
      const r = tipo === "mao_obra" ? recusaDaMaoObra(dados, { ...linha, ...dados }) : null;
      if (r) return r;
      const substituta = nova({ ...linha, ...dados }, ap, linha);
      const novo = salvar({ ...ap, versao: ap.versao + 1, [tipo]: [...ap[tipo].map((/** @type {any} */ l) => (l.id === linhaId ? cancelada(l, "EDICAO", null) : l)), substituta] });
      return { status: 200, body: { linha: substituta, linha_anterior_id: linhaId, apontamento: novo, atividade: atv } };
    });
  }
  if (partes.length === 7 && partes[6] === "cancelar" && method === "POST") {
    return comIdempotencia(body.operation_id, () => {
      const c = conflito();
      if (c) return c;
      const novo = salvar({ ...ap, versao: ap.versao + 1, [tipo]: ap[tipo].map((/** @type {any} */ l) => (l.id === linhaId ? cancelada(l, "LINHA", body.motivo) : l)) });
      return { status: 200, body: { linha: novo[tipo].find((/** @type {any} */ l) => l.id === linhaId), apontamento: novo, atividade: atv } };
    });
  }
  return undefined;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  vi.stubEnv("VITE_MAIKE_API_URL", API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem("empresa_selecionada_id", "emp-1");
  window.localStorage.setItem("empresa_selecionada_cliente_id", "cli-1");
  const { setNativeToken } = await import("@/lib/auth/nativeTokenStorage");
  setNativeToken("jwt.teste");
  sessao.permissao = permissaoCom(TODAS);
  proxima = null;
  perderResposta = false;
  gravados = new Map();
  proximoId = 0;
  MEDIDORES = medidoresPadrao();
  atividades = new Map([
    ["a1", { ...ATV }],
    ["a2", { ...ATV, id: "a2", numero: "2", nome: "Roçada Pasto 02", tipo_atividade_id: "t2", tipo_atividade_nome: "ROÇADA", createdAt: "2026-10-30T12:00:00.000Z" }],
    ["a3", { ...ATV, id: "a3", numero: "1", nome: "Aplicação concluída", status: "CONCLUIDA", data_conclusao: "2026-11-13", createdAt: "2026-10-20T12:00:00.000Z" }],
    ["a4", { ...ATV, id: "a4", numero: "4", nome: "Colheita Talhão 04", tipo_atividade_id: "t3", tipo_atividade_nome: "COLHEITA MANUAL", createdAt: "2026-10-29T12:00:00.000Z" }],
  ]);
  apontamentosPorAtividade = new Map([
    [
      "a1",
      [
        apontamento({
          produtos: [linhaProduto({}), linhaProduto({ id: "pl2", ordem: 2, produto_id: "p2", produto: { id: "p2", nome: "Ureia" }, quantidade: "40.0000", unidade: "KG", status: "CANCELADO", cancelado_em: "2026-11-12T12:00:00.000Z", cancelado_por: usuario("u2", "Maria"), motivo_cancelamento: "produto errado", cancelamento_origem: "LINHA" })],
          maquinas: [linhaMaquina({})],
        }),
        apontamento({ id: "ap0", data_operacional: "2026-11-11", status: "CANCELADO", versao: 2, createdAt: "2026-11-11T10:00:00.000Z", produtos: [], maquinas: [] }),
      ],
    ],
    ["a2", [apontamento({ id: "ap9", atividade_id: "a2" })]],
    ["a3", [apontamento({ id: "ap5", atividade_id: "a3", produtos: [linhaProduto({ id: "pl5" })], maquinas: [linhaMaquina({ id: "ml5" })] })]],
    [
      "a4",
      [
        apontamento({
          id: "ap7",
          atividade_id: "a4",
          mao_obra: [
            linhaMaoObra({}),
            linhaMaoObra({ id: "mo2", ordem: 2, parceiro_id: "f2", parceiro: { id: "f2", nome: "Ana Souza" }, tipo_medida: "TAREFA", quantidade: "3.0000", custo_unitario: "30.0000", custo_total: "90.0000", status: "CANCELADO", cancelado_em: "2026-11-12T12:00:00.000Z", cancelado_por: usuario("u2", "Maria"), motivo_cancelamento: "lançada em dobro", cancelamento_origem: "LINHA" }),
          ],
          servicos: [linhaServico({})],
        }),
      ],
    ],
  ]);
  tiposSrv.listarTiposAtividade.mockResolvedValue(TIPOS);
  confirmacao.confirmar.mockResolvedValue(true);
  totaisExtra = null;
  abast = criarEstadoAbastecimentos();
  abast.apontamentos.ap1 = {
    data_operacional: "2026-11-12",
    turno: "MANHA",
    sequencia: 1,
    atividade: { id: "a1", numero: "3", nome: "Cigarrinha Pasto 01" },
    centro_custo: { id: "cc-pasto", nome: "Pastagem" },
  };
  backend = instalarBackendFake(rotear);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────
const montar = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LancamentoAtividades />
    </QueryClientProvider>,
  );
  await screen.findByTestId("atividade-numero-a1");
};
/** Abre a atividade e espera os lançamentos (e o tipo, que decide os blocos). @param {string} id @param {string} apId */
const abrir = async (id, apId) => {
  fireEvent.doubleClick(screen.getByTestId(`atividade-numero-${id}`));
  await screen.findByTestId("atividade-cabecalho");
  await screen.findByTestId(`apontamento-${apId}-linhas`);
};
const escritas = () => backend.chamadas.filter((c) => c.method !== "GET");
const ultimaEscrita = () => escritas().at(-1);
const leiturasDosTotais = (/** @type {string} */ id) => backend.chamadas.filter((c) => c.method === "GET" && c.path === `/atividades/${id}/totais`).length;
const escolherNoSeletor = async (/** @type {HTMLElement} */ raiz, /** @type {string} */ testId, /** @type {RegExp|string} */ nome) => {
  await waitFor(() => expect(within(raiz).getByTestId(testId)).not.toBeDisabled());
  fireEvent.click(within(raiz).getByTestId(testId));
  fireEvent.click(await screen.findByRole("option", { name: nome }));
  await waitFor(() => expect(screen.queryByTestId(`${testId}-painel`)).toBeNull());
};
const assentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

// ═════════════════════════════════════════════════════════════════════════
describe("LL-BLOCOS — Produtos e Máquinas dentro do apontamento", () => {
  it("LL-BLOCOS-1 — as linhas aparecem por tipo; a cancelada continua visível e marcada; ações de lançar/editar/cancelar", async () => {
    await montar();
    await abrir("a1", "ap1");
    const produtos = screen.getByTestId("apontamento-ap1-produtos");
    expect(within(produtos).getByTestId("linha-produto-pl1-nome")).toHaveTextContent("Glifosato");
    expect(within(produtos).getByTestId("linha-produto-pl1-quantidade")).toHaveTextContent("25 L");
    expect(within(produtos).getByTestId("linha-produto-pl1-dose")).toHaveTextContent("dose 2,5 L/ha");
    expect(within(produtos).getByTestId("linha-produto-pl1-custo")).toHaveTextContent("R$ 125,00");
    // Cancelada: na lista, riscada, com o motivo, e sem ações.
    expect(screen.getByTestId("linha-produto-pl2")).toHaveAttribute("data-status", "CANCELADO");
    expect(screen.getByTestId("linha-produto-pl2-nome")).toHaveClass("line-through");
    expect(screen.getByTestId("linha-produto-pl2-cancelamento")).toHaveTextContent("por Maria · motivo: produto errado");
    expect(screen.queryByTestId("linha-produto-pl2-editar")).toBeNull();
    expect(screen.queryByTestId("linha-produto-pl2-cancelar")).toBeNull();
    // Máquina: leituras, uso e custo.
    expect(screen.getByTestId("linha-maquina-ml1-nome")).toHaveTextContent("TP-02 — Trator");
    expect(screen.getByTestId("linha-maquina-ml1-leituras")).toHaveTextContent("leitura 1.542 → 1.550 h");
    expect(screen.getByTestId("linha-maquina-ml1-uso")).toHaveTextContent("uso 8 h");
    for (const t of ["apontamento-ap1-adicionar-produto", "apontamento-ap1-adicionar-maquina", "linha-produto-pl1-editar", "linha-produto-pl1-cancelar", "linha-maquina-ml1-editar", "linha-maquina-ml1-cancelar"]) {
      expect(screen.getByTestId(t), t).toBeTruthy();
    }
    // O apontamento CANCELADO não aceita linha nova.
    expect(screen.getByTestId("apontamento-ap0-linhas")).toBeTruthy();
    expect(screen.queryByTestId("apontamento-ap0-adicionar-produto")).toBeNull();
    expect(screen.queryByTestId("apontamento-ap0-adicionar-maquina")).toBeNull();
  });

  it("LL-BLOCOS-2 — sem permite_produto no tipo o bloco Produtos some (e não há Adicionar produto); Máquinas fica", async () => {
    await montar();
    await abrir("a2", "ap9");
    expect(screen.queryByTestId("apontamento-ap9-produtos")).toBeNull();
    expect(screen.queryByTestId("apontamento-ap9-adicionar-produto")).toBeNull();
    expect(screen.getByTestId("apontamento-ap9-maquinas")).toHaveTextContent("Nenhuma máquina neste lançamento.");
    // Sem permite_implemento: a janela da máquina não pede implemento.
    fireEvent.click(screen.getByTestId("apontamento-ap9-adicionar-maquina"));
    const janela = await screen.findByTestId("janela-linha-maquina");
    expect(within(janela).queryByTestId("linha-maquina-implemento")).toBeNull();
  });

  it("LL-BLOCOS-3 — permissão: cada ação pela sua chave; só ver = nenhum botão; atividade concluída = nada de escrita", async () => {
    sessao.permissao = permissaoCom({ visualizar: true, editar_apontamento: true });
    await montar();
    await abrir("a1", "ap1");
    expect(screen.getByTestId("linha-produto-pl1-editar")).toBeTruthy();
    expect(screen.queryByTestId("linha-produto-pl1-cancelar")).toBeNull();
    expect(screen.queryByTestId("apontamento-ap1-adicionar-produto")).toBeNull();
    expect(screen.queryByTestId("apontamento-ap1-adicionar-maquina")).toBeNull();
    cleanup();

    sessao.permissao = permissaoCom({ visualizar: true, cancelar_apontamento: true });
    await montar();
    await abrir("a1", "ap1");
    expect(screen.getByTestId("linha-maquina-ml1-cancelar")).toBeTruthy();
    expect(screen.queryByTestId("linha-maquina-ml1-editar")).toBeNull();
    cleanup();

    sessao.permissao = permissaoCom({ visualizar: true });
    await montar();
    await abrir("a1", "ap1");
    expect(screen.getByTestId("linha-produto-pl1")).toBeTruthy();
    expect(screen.getByTestId("apontamento-ap1-linhas").querySelectorAll("button")).toHaveLength(0);
    cleanup();

    sessao.permissao = permissaoCom(TODAS);
    await montar();
    await abrir("a3", "ap5");
    expect(screen.getByTestId("linha-produto-pl5")).toBeTruthy();
    expect(screen.getByTestId("apontamento-ap5-linhas").querySelectorAll("button")).toHaveLength(0);
    expect(escritas()).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LL-PRODUTO — janela da linha de produto", () => {
  it("LL-PRODUTO-1 — favoritos, local com saldo, unidade do produto, dose/ha; corpo com versao e operation_id; lista e totalizador relidos", async () => {
    await montar();
    await abrir("a1", "ap1");
    const totaisAntes = leiturasDosTotais("a1");
    fireEvent.click(screen.getByTestId("apontamento-ap1-adicionar-produto"));
    const janela = await screen.findByTestId("janela-linha-produto");
    // Favorito no topo, com a marca; a unidade aparece na opção.
    fireEvent.click(within(janela).getByTestId("linha-produto-produto"));
    const opcoes = await screen.findAllByRole("option");
    expect(opcoes[0]).toHaveTextContent(/Glifosato/);
    expect(opcoes[0]).toHaveTextContent(/já usado nesta atividade/);
    fireEvent.click(opcoes[1]);
    // Ureia é SACO: a quantidade é em kg (do produto, nunca digitada) e há dois locais com saldo.
    expect(await within(janela).findByText("Quantidade (kg)")).toBeTruthy();
    expect(await within(janela).findByRole("combobox", { name: "Local do estoque" })).toBeTruthy();
    // Troca para o favorito (L, um local só: escolhido sozinho, com o disponível).
    await escolherNoSeletor(janela, "linha-produto-produto", /Glifosato/);
    expect(within(janela).getByText("Quantidade (L)")).toBeTruthy();
    // Emenda 3: o disponível está no próprio rótulo do local (sem a linha "Disponível neste local" repetida).
    await waitFor(() => expect(within(janela).getByRole("combobox", { name: "Local do estoque" })).toHaveTextContent("disponível 30"));
    expect(within(janela).queryByTestId("linha-produto-disponivel")).toBeNull();
    fireEvent.change(within(janela).getByTestId("linha-produto-quantidade"), { target: { value: "25" } });
    // Dose/ha = 25 / 10 (a Feita da atividade; sem ela, a planejada), só leitura.
    expect(within(janela).getByTestId("linha-produto-dose")).toHaveTextContent("2,5 L/ha");
    fireEvent.click(within(janela).getByTestId("janela-linha-produto-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    const { method, path, body } = ultimaEscrita();
    expect({ method, path }).toEqual({ method: "POST", path: "/atividades/a1/apontamentos/ap1/produtos" });
    expect(body).toEqual({ empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), produto_id: "p1", local_estoque_id: "l1", quantidade: "25" });
    expect(typeof body.quantidade).toBe("string");
    await waitFor(() => expect(screen.queryByTestId("janela-linha-produto")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Produto Glifosato lançado: a quantidade saiu do estoque.");
    expect(await screen.findByTestId("linha-produto-pl-n1")).toHaveTextContent("Glifosato");
    // O totalizador foi relido (e agora soma 50 L).
    await waitFor(() => expect(leiturasDosTotais("a1")).toBeGreaterThan(totaisAntes));
    await waitFor(() => {
      expect(screen.getByTestId("totalizador-produto-p1")).toHaveTextContent("50 L");
      expect(screen.getByTestId("totalizador-produto-p1-custo")).toHaveTextContent("R$ 250,00");
    });
  });

  it("LL-PRODUTO-2 — saldo insuficiente: aviso com disponível × pedido antes de enviar e a recusa do servidor com a mensagem do motor", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("apontamento-ap1-adicionar-produto"));
    const janela = await screen.findByTestId("janela-linha-produto");
    await escolherNoSeletor(janela, "linha-produto-produto", /Glifosato/);
    await within(janela).findByRole("combobox", { name: "Local do estoque" });
    fireEvent.change(within(janela).getByTestId("linha-produto-quantidade"), { target: { value: "50" } });
    expect(within(janela).getByTestId("linha-produto-saldo-insuficiente")).toHaveTextContent("Saldo insuficiente neste local: disponível 30 L, pedido 50 L.");
    proxima = erroServidor(422, "ESTOQUE_SALDO_INSUFICIENTE", { details: { disponivel: "30.0000", solicitado: "50.0000" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-produto-salvar"));
    const frase = "Saldo insuficiente deste produto no local escolhido: disponível 30 L, pedido 50 L. Nada foi gravado.";
    expect(await within(janela).findByTestId("erro-envio")).toHaveTextContent(frase);
    expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", frase);
    expect(screen.getByTestId("janela-linha-produto")).toBeTruthy();
  });

  it("LL-PRODUTO-3 — sem resposta do servidor: resultado incerto; \"Repetir o mesmo envio\" leva a MESMA operation_id e o mesmo corpo (uma linha só)", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("apontamento-ap1-adicionar-produto"));
    const janela = await screen.findByTestId("janela-linha-produto");
    await escolherNoSeletor(janela, "linha-produto-produto", /Glifosato/);
    await within(janela).findByRole("combobox", { name: "Local do estoque" });
    fireEvent.change(within(janela).getByTestId("linha-produto-quantidade"), { target: { value: "5" } });
    perderResposta = true;
    fireEvent.click(within(janela).getByTestId("janela-linha-produto-salvar"));
    expect(await within(janela).findByTestId("resultado-incerto")).toHaveTextContent("Resultado incerto");
    expect(within(janela).getByTestId("janela-linha-produto-salvar")).toHaveTextContent("Repetir o mesmo envio");
    await assentar();
    fireEvent.click(within(janela).getByTestId("botao-repetir-envio"));
    await waitFor(() => expect(screen.queryByTestId("janela-linha-produto")).toBeNull());
    const envios = escritas().filter((c) => c.path === "/atividades/a1/apontamentos/ap1/produtos");
    expect(envios).toHaveLength(2);
    expect(envios[1].body).toEqual(envios[0].body);
    expect(envios[1].body.operation_id).toBe(envios[0].body.operation_id);
    // O servidor devolveu o gravado: uma linha nova só.
    const ap = apontamentosPorAtividade.get("a1")?.find((a) => a.id === "ap1");
    expect(ap.produtos.filter((/** @type {any} */ l) => l.quantidade === "5.0000")).toHaveLength(1);
    expect(confirmacao.confirmar).not.toHaveBeenCalled();
  });

  it("LL-PRODUTO-4 — editar: PATCH só com o que mudou, a versao do apontamento e operation_id; a anterior fica cancelada (edição)", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("linha-produto-pl1-editar"));
    const janela = await screen.findByTestId("janela-linha-produto");
    expect(within(janela).getByTestId("linha-produto-quantidade")).toHaveValue("25");
    await within(janela).findByRole("combobox", { name: "Local do estoque" });
    fireEvent.change(within(janela).getByTestId("linha-produto-quantidade"), { target: { value: "20" } });
    // Na edição, o que a própria linha baixou volta antes: 30 + 25 disponível, 20 não avisa.
    expect(within(janela).queryByTestId("linha-produto-saldo-insuficiente")).toBeNull();
    fireEvent.click(within(janela).getByTestId("janela-linha-produto-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({
      method: "PATCH",
      path: "/atividades/a1/apontamentos/ap1/produtos/pl1",
      query: {},
      body: { empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), quantidade: "20" },
    });
    await waitFor(() => expect(screen.getByTestId("linha-produto-pl1")).toHaveAttribute("data-status", "CANCELADO"));
    expect(screen.getByTestId("linha-produto-pl1-cancelamento")).toHaveTextContent("Substituída pela edição");
    expect(await screen.findByTestId("linha-produto-pl-n1-quantidade")).toHaveTextContent("20 L");
  });

  it("LL-PRODUTO-5 — cancelar pede motivo e manda {empresa_id, versao, operation_id, motivo}; estorno bloqueado mostra o porquê", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("linha-produto-pl1-cancelar"));
    let dialogo = await screen.findByTestId("dialogo-cancelar-linha");
    expect(dialogo).toHaveTextContent("A quantidade volta exatamente aos lotes de onde saiu");
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-linha-motivo"), { target: { value: "dose errada" } });
    proxima = erroServidor(409, "ATIVIDADE_ESTORNO_BLOQUEADO", { field: "linha", reason: "devolucao_excede_entrada" });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-linha-enviar"));
    await waitFor(() =>
      expect(notify.notifyWarning).toHaveBeenCalledWith(
        "Atenção",
        "O estorno exato do produto não é seguro agora: a devolução passaria da entrada de um lote de onde o produto saiu (ele já foi consumido). Nada foi alterado.",
      ),
    );
    expect(screen.getByTestId("linha-produto-pl1")).toHaveAttribute("data-status", "CONFIRMADO");
    // De novo, agora aceito.
    dialogo = screen.getByTestId("dialogo-cancelar-linha");
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-linha-enviar"));
    await waitFor(() => expect(ultimaEscrita().path).toBe("/atividades/a1/apontamentos/ap1/produtos/pl1/cancelar"));
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), motivo: "dose errada" });
    await waitFor(() => expect(screen.getByTestId("linha-produto-pl1")).toHaveAttribute("data-status", "CANCELADO"));
    expect(screen.getByTestId("linha-produto-pl1-cancelamento")).toHaveTextContent("motivo: dose errada");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LL-MAQUINA — janela da linha de máquina", () => {
  it("LL-MAQUINA-1 — máquina do cabeçalho como padrão, medidor do bem, leitura inicial sugerida, final obrigatória e uso calculado", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("apontamento-ap1-adicionar-maquina"));
    const janela = await screen.findByTestId("janela-linha-maquina");
    expect(within(janela).getByTestId("linha-maquina-bem").getAttribute("aria-label")).toMatch(/TP-02 — Trator/);
    // O tipo permite implemento: o campo aparece.
    expect(within(janela).getByTestId("linha-maquina-implemento")).toBeTruthy();
    // O tipo do medidor aparece na unidade dos campos (sem o campo "Medidor" nem a nota da leitura vigente).
    expect(await within(janela).findByTestId("linha-maquina-leitura-inicial")).toBeTruthy();
    expect(within(janela).getByText(/Leitura inicial \(h\)/)).toBeTruthy();
    expect(within(janela).queryByTestId("linha-maquina-medidor")).toBeNull();
    expect(backend.chamadas.find((c) => c.path === "/atividades-opcoes/medidor")?.query).toEqual({ empresa_id: "emp-1", bem_id: "b1", data: "2026-11-12" });
    expect(within(janela).queryByTestId("linha-maquina-leitura-vigente")).toBeNull();
    await waitFor(() => expect(within(janela).getByTestId("linha-maquina-leitura-inicial")).toHaveValue("1.550"));
    // Final obrigatória: nada sai sem ela.
    fireEvent.click(within(janela).getByTestId("janela-linha-maquina-salvar"));
    expect(await within(janela).findByText("Informe a leitura final.")).toBeTruthy();
    expect(escritas()).toEqual([]);
    fireEvent.change(within(janela).getByTestId("linha-maquina-leitura-final"), { target: { value: "1540" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-maquina-salvar"));
    expect(await within(janela).findByText(/o medidor não anda para trás/)).toBeTruthy();
    expect(escritas()).toEqual([]);
    fireEvent.change(within(janela).getByTestId("linha-maquina-leitura-final"), { target: { value: "1.558" } });
    expect(within(janela).getByTestId("linha-maquina-uso")).toHaveTextContent("8 h");
    await escolherNoSeletor(janela, "linha-maquina-implemento", /Grade/);
    fireEvent.click(within(janela).getByTestId("janela-linha-maquina-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({
      method: "POST",
      path: "/atividades/a1/apontamentos/ap1/maquinas",
      query: {},
      body: {
        empresa_id: "emp-1",
        versao: 3,
        operation_id: expect.stringMatching(/^lanc-/),
        bem_id: "b1",
        implemento_bem_id: "i1",
        sem_medidor: false,
        leitura_inicial: "1550",
        leitura_final: "1558",
      },
    });
    await waitFor(() => expect(screen.queryByTestId("janela-linha-maquina")).toBeNull());
    expect(await screen.findByTestId("linha-maquina-ml-n1-nome")).toHaveTextContent("TP-02 — Trator + GR-01 — Grade");
    await waitFor(() => {
      expect(screen.getByTestId("totalizador-maquina-b1-h")).toHaveTextContent("16 h");
      expect(screen.getByTestId("totalizador-maquina-b1-h-custo")).toHaveTextContent("R$ 800,00");
    });
  });

  it("LL-MAQUINA-2 — salto do medidor: ATIVIDADE_SALTO_MEDIDOR mostra a justificativa e o reenvio a leva", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("apontamento-ap1-adicionar-maquina"));
    const janela = await screen.findByTestId("janela-linha-maquina");
    await waitFor(() => expect(within(janela).getByTestId("linha-maquina-leitura-inicial")).toHaveValue("1.550"));
    fireEvent.change(within(janela).getByTestId("linha-maquina-leitura-final"), { target: { value: "1850" } });
    expect(within(janela).queryByLabelText(/Justificativa do salto/)).toBeNull();
    proxima = erroServidor(422, "ATIVIDADE_SALTO_MEDIDOR", {
      field: "justificativa_salto",
      reason: "salto_acima_do_teto",
      details: { entidade: "linha_maquina", quantidade_uso: "300.0000", salto_maximo: "24.0000", medidor_unidade: "h" },
    });
    fireEvent.click(within(janela).getByTestId("janela-linha-maquina-salvar"));
    const frase = "O uso da máquina (300 h) passa do teto de salto do medidor (24 h). Informe a justificativa (3 a 500 caracteres) e envie de novo. Nada foi gravado.";
    expect(await within(janela).findByTestId("erro-envio")).toHaveTextContent(frase);
    const campo = await within(janela).findByLabelText(/Justificativa do salto/);
    expect(within(janela).getByTestId("linha-maquina-salto")).toHaveTextContent("passa do teto de salto do medidor");
    // Sem justificativa não sai de novo.
    fireEvent.click(within(janela).getByTestId("janela-linha-maquina-salvar"));
    expect(await within(janela).findByText(/Informe a justificativa do salto/)).toBeTruthy();
    expect(escritas()).toHaveLength(1);
    fireEvent.change(campo, { target: { value: "trator ficou o fim de semana na lavoura" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-maquina-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(2));
    const [primeiro, segundo] = escritas();
    expect(segundo.body).toMatchObject({ bem_id: "b1", leitura_inicial: "1550", leitura_final: "1850", justificativa_salto: "trator ficou o fim de semana na lavoura" });
    expect(primeiro.body).not.toHaveProperty("justificativa_salto");
    // A recusa foi definitiva: o envio com a justificativa é outro (chave nova).
    expect(segundo.body.operation_id).not.toBe(primeiro.body.operation_id);
    await waitFor(() => expect(screen.queryByTestId("janela-linha-maquina")).toBeNull());
  });

  it("LL-MAQUINA-3 — teto conhecido: passou, a justificativa já aparece antes de enviar", async () => {
    MEDIDORES.b1 = { ...MEDIDORES.b1, salto_maximo_medidor: "24.0000" };
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("apontamento-ap1-adicionar-maquina"));
    const janela = await screen.findByTestId("janela-linha-maquina");
    await waitFor(() => expect(within(janela).getByTestId("linha-maquina-leitura-inicial")).toHaveValue("1.550"));
    fireEvent.change(within(janela).getByTestId("linha-maquina-leitura-final"), { target: { value: "1600" } });
    expect(within(janela).getByTestId("linha-maquina-salto")).toHaveTextContent("O uso (50 h) passa do teto de salto do medidor (24 h)");
    expect(within(janela).getByLabelText(/Justificativa do salto/)).toBeTruthy();
  });

  it("LL-MAQUINA-4 — \"sem medidor\": o uso direto, sem leituras; o bem sem medidor só tem esse caminho", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("apontamento-ap1-adicionar-maquina"));
    let janela = await screen.findByTestId("janela-linha-maquina");
    await within(janela).findByTestId("linha-maquina-modo-medidor");
    fireEvent.click(within(janela).getByRole("radio", { name: /Sem medidor/ }));
    expect(within(janela).queryByTestId("linha-maquina-leitura-final")).toBeNull();
    expect(within(janela).getByText("Uso (h)")).toBeTruthy();
    fireEvent.change(within(janela).getByTestId("linha-maquina-quantidade-uso"), { target: { value: "6" } });
    // Em "sem medidor" o uso é o próprio campo digitado (não há o campo calculado repetido).
    expect(within(janela).queryByTestId("linha-maquina-uso")).toBeNull();
    fireEvent.click(within(janela).getByTestId("janela-linha-maquina-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), bem_id: "b1", sem_medidor: true, quantidade_uso: "6" });
    await waitFor(() => expect(screen.queryByTestId("janela-linha-maquina")).toBeNull());
    expect(await screen.findByTestId("linha-maquina-ml-n1-leituras")).toHaveTextContent("sem medidor");

    // Caminhão sem medidor que conta: só o uso, sem a escolha.
    fireEvent.click(screen.getByTestId("apontamento-ap1-adicionar-maquina"));
    janela = await screen.findByTestId("janela-linha-maquina");
    await escolherNoSeletor(janela, "linha-maquina-bem", /Caminhão/);
    expect(await within(janela).findByTestId("linha-maquina-quantidade-uso")).toBeTruthy();
    expect(within(janela).queryByTestId("linha-maquina-sem-medidor-no-bem")).toBeNull();
    expect(within(janela).queryByRole("radio", { name: /Sem medidor/ })).toBeNull();
    fireEvent.change(within(janela).getByTestId("linha-maquina-quantidade-uso"), { target: { value: "120" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-maquina-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(2));
    expect(ultimaEscrita().body).toMatchObject({ bem_id: "b2", sem_medidor: true, quantidade_uso: "120" });
    expect(ultimaEscrita().body).not.toHaveProperty("leitura_final");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LL-TOTAIS — totalizador fixo no topo da atividade", () => {
  it("LL-TOTAIS-1 — área executada / planejada, total por produto, horas por máquina, custo e custo/ha (só linhas confirmadas)", async () => {
    await montar();
    await abrir("a1", "ap1");
    const totais = await screen.findByTestId("totalizador-atividade");
    expect(backend.chamadas.find((c) => c.path === "/atividades/a1/totais")?.query).toEqual({ empresa_id: "emp-1" });
    await waitFor(() => expect(within(totais).getByTestId("totalizador-custo")).toHaveTextContent("R$ 525,00"));
    expect(within(totais).getByTestId("totalizador-area")).toHaveTextContent("10 / 40 ha");
    // A Ureia cancelada não conta.
    expect(within(totais).getByTestId("totalizador-produto-p1")).toHaveTextContent("25 L");
    expect(within(totais).getByTestId("totalizador-produto-p1-custo")).toHaveTextContent("R$ 125,00");
    expect(within(totais).queryByTestId("totalizador-produto-p2")).toBeNull();
    expect(within(totais).getByTestId("totalizador-maquina-b1-h")).toHaveTextContent("8 h");
    expect(within(totais).getByTestId("totalizador-maquina-b1-h-custo")).toHaveTextContent("R$ 400,00");
    expect(within(totais).getByTestId("totalizador-custo-ha")).toHaveTextContent("R$ 52,50/ha");
    // O totalizador vem antes do cabeçalho.
    const cabecalho = screen.getByTestId("atividade-cabecalho");
    expect(totais.compareDocumentPosition(cabecalho) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LL-REPETIR — \"Repetir último lançamento\" com as linhas", () => {
  it("LL-REPETIR-1 — traz produtos e máquinas da base (leitura sugerida de novo), o operador ajusta e vai UM POST com produtos[] e maquinas[]", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("apontamento-repetir-ultimo"));
    const form = await screen.findByTestId("b1-form-apontamento");
    expect(form).toHaveAttribute("data-modo", "repetir");
    // Só as linhas CONFIRMADAS da base: o Glifosato (a Ureia cancelada não vem) e o Trator.
    expect(within(form).getByTestId("repetir-produto-0")).toBeTruthy();
    expect(within(form).queryByTestId("repetir-produto-1")).toBeNull();
    expect(within(form).getByTestId("repetir-produto-0-produto").getAttribute("aria-label")).toMatch(/Glifosato/);
    expect(within(form).getByTestId("repetir-produto-0-quantidade")).toHaveValue("25");
    expect(within(form).getByText("Quantidade (L)")).toBeTruthy();
    expect(within(form).getByTestId("repetir-maquina-0-bem").getAttribute("aria-label")).toMatch(/TP-02 — Trator/);
    // A leitura NÃO é copiada da base: a inicial vem da leitura vigente (na data de hoje) e a final fica em branco.
    await waitFor(() => expect(within(form).getByTestId("repetir-maquina-0-leitura-inicial")).toHaveValue("1.550"));
    expect(within(form).getByTestId("repetir-maquina-0-leitura-final")).toHaveValue("");
    expect(backend.chamadas.filter((c) => c.path === "/atividades-opcoes/medidor").at(-1)?.query).toMatchObject({ bem_id: "b1", data: HOJE });
    // Sem a leitura final, nada sai.
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    expect(await within(form).findByText("Informe a leitura final.")).toBeTruthy();
    expect(escritas()).toEqual([]);
    // O operador ajusta a quantidade (dose recalculada pela área do dia) e informa a leitura final.
    await within(form).findByTestId("repetir-produto-0-disponivel");
    fireEvent.change(within(form).getByTestId("repetir-produto-0-quantidade"), { target: { value: "20" } });
    expect(within(form).getByTestId("repetir-produto-0-dose")).toHaveTextContent("2 L/ha");
    fireEvent.change(within(form).getByTestId("repetir-maquina-0-leitura-final"), { target: { value: "1557,5" } });
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    const { method, path, body } = ultimaEscrita();
    expect({ method, path }).toEqual({ method: "POST", path: "/atividades/a1/apontamentos" });
    expect(body).toEqual({
      empresa_id: "emp-1",
      data_operacional: HOJE,
      turno: "MANHA",
      area_executada_dia: "10",
      operation_id: expect.stringMatching(/^lanc-/),
      produtos: [{ produto_id: "p1", local_estoque_id: "l1", quantidade: "20" }],
      maquinas: [{ bem_id: "b1", sem_medidor: false, leitura_inicial: "1550", leitura_final: "1557.5" }],
    });
    await waitFor(() => expect(screen.queryByTestId("janela-apontamento")).toBeNull());
    expect(await screen.findByTestId("linha-maquina-ml-n3-uso")).toHaveTextContent("uso 7,5 h");
  });

  it("LL-REPETIR-2 — \"Retirar\" tira a linha do envio; sem linhas, volta a ser o lançamento só do dia", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("apontamento-repetir-ultimo"));
    const form = await screen.findByTestId("b1-form-apontamento");
    fireEvent.click(within(form).getByTestId("repetir-produto-0-retirar"));
    fireEvent.click(within(form).getByTestId("repetir-maquina-0-retirar"));
    expect(within(form).queryByTestId("repetir-produto-0")).toBeNull();
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    // A base tinha linhas: vai o lançamento novo (o duplicar não copia linhas), sem chave nem linhas.
    expect(ultimaEscrita()).toMatchObject({ path: "/atividades/a1/apontamentos", body: { empresa_id: "emp-1", data_operacional: HOJE, turno: "MANHA", area_executada_dia: "10" } });
    expect(ultimaEscrita().body).not.toHaveProperty("produtos");
    expect(ultimaEscrita().body).not.toHaveProperty("operation_id");
  });

  it("LL-REPETIR-3 — salto numa máquina do lançamento (linha_indice) pede a justificativa NELA; sem resposta, o reenvio usa a MESMA operation_id", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("apontamento-repetir-ultimo"));
    const form = await screen.findByTestId("b1-form-apontamento");
    await waitFor(() => expect(within(form).getByTestId("repetir-maquina-0-leitura-inicial")).toHaveValue("1.550"));
    await within(form).findByTestId("repetir-produto-0-disponivel");
    fireEvent.change(within(form).getByTestId("repetir-maquina-0-leitura-final"), { target: { value: "1900" } });
    proxima = erroServidor(422, "ATIVIDADE_SALTO_MEDIDOR", {
      field: "justificativa_salto",
      reason: "salto_acima_do_teto",
      details: { entidade: "linha_maquina", linha_indice: 0, quantidade_uso: "350.0000", salto_maximo: "24.0000", medidor_unidade: "h" },
    });
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(await within(form).findByTestId("repetir-maquina-0-salto")).toBeTruthy();
    expect(await screen.findByTestId("apontamento-erro")).toHaveTextContent("O uso da máquina (350 h) passa do teto de salto do medidor (24 h).");
    fireEvent.change(within(form).getByLabelText(/Justificativa do salto/), { target: { value: "medidor trocado" } });
    // Agora a resposta se perde depois de gravar: resultado incerto, e o reenvio é o MESMO (sem lançar duas vezes).
    perderResposta = true;
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(2));
    expect(await screen.findByTestId("apontamento-erro")).toHaveTextContent("Repetir o mesmo envio");
    expect(screen.getByTestId("apontamento-salvar")).toHaveTextContent("Repetir o mesmo envio");
    await assentar();
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(screen.queryByTestId("janela-apontamento")).toBeNull());
    const [, segundo, terceiro] = escritas();
    expect(segundo.body.maquinas[0]).toMatchObject({ leitura_final: "1900", justificativa_salto: "medidor trocado" });
    expect(terceiro.body).toEqual(segundo.body);
    expect(terceiro.body.operation_id).toBe(segundo.body.operation_id);
    expect(apontamentosPorAtividade.get("a1")?.filter((a) => a.data_operacional === HOJE)).toHaveLength(1);
    expect(confirmacao.confirmar).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LL-PORTA — allowlists das linhas = schemas fechados do servidor", () => {
  it("LL-PORTA-1 — produto, máquina e cancelamento: as chaves da porta são as do corpo de cada rota", async () => {
    const porta = await import("@/apis/atividades/lancamentoAtividadePort.js");
    const ordenado = (/** @type {readonly string[]} */ l) => [...l].sort();
    const produto = readFileSync("backend/src/modules/atividades/atividadeApontamentoProdutoRoutes.js", "utf8");
    const item = produto.slice(produto.indexOf("export const ESQUEMA_ITEM_PRODUTO"), produto.indexOf("const LANCAR"));
    const camposItem = [.../** @type {RegExpMatchArray} */ (item.match(/properties: \{([^}]*)\}/))[1].matchAll(/([a-z_]+):/g)].map((m) => m[1]);
    expect(ordenado(camposItem)).toEqual(ordenado(porta.CAMPOS_DA_LINHA_PRODUTO));
    const maquina = readFileSync("backend/src/modules/atividades/atividadeApontamentoMaquinaRoutes.js", "utf8");
    const bloco = maquina.slice(maquina.indexOf("export const CAMPOS_DA_LINHA_MAQUINA"), maquina.indexOf("});", maquina.indexOf("export const CAMPOS_DA_LINHA_MAQUINA")));
    const camposMaquina = [...bloco.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
    expect(ordenado(camposMaquina)).toEqual(ordenado(porta.CAMPOS_DA_LINHA_MAQUINA));
    // Envelope: empresa, versão do apontamento e operation_id em toda escrita de linha; o cancelamento leva o motivo.
    for (const fonte of [produto, maquina]) {
      expect(fonte).toMatch(/required: \['empresa_id', 'versao', 'operation_id'/);
    }
    expect(ordenado(porta.CAMPOS_DE_CANCELAMENTO_LINHA)).toEqual(["empresa_id", "motivo", "operation_id", "versao"]);
    expect(ordenado(porta.CAMPOS_DE_CRIACAO_LINHA_PRODUTO)).toEqual(ordenado(["empresa_id", "versao", "operation_id", ...porta.CAMPOS_DA_LINHA_PRODUTO]));
    expect(ordenado(porta.CAMPOS_DE_CRIACAO_LINHA_MAQUINA)).toEqual(ordenado(["empresa_id", "versao", "operation_id", ...porta.CAMPOS_DA_LINHA_MAQUINA]));
    // Nada do servidor vai no corpo: unidade, custo, dose, tipo/unidade do medidor, status.
    const sujo = {
      empresa_id: "emp-1",
      versao: 3,
      operation_id: "lanc-12345678",
      produto_id: "p1",
      local_estoque_id: "l1",
      quantidade: "2",
      unidade: "L",
      dose_ha: "1",
      custo_total: "9",
      medidor_tipo: "HORIMETRO",
      status: "CANCELADO",
      cliente_id: "x",
    };
    await porta.operacoesNativas.criarLinha("produtos", "a1", "ap1", sujo).catch(() => null);
    expect(Object.keys(ultimaEscrita().body).sort()).toEqual(["empresa_id", "local_estoque_id", "operation_id", "produto_id", "quantidade", "versao"]);
    // O lançamento com linhas filtra cada item pela allowlist da linha.
    await porta.operacoesNativas.createApontamento("a1", { empresa_id: "emp-1", data_operacional: HOJE, operation_id: "lanc-12345678", produtos: [{ ...sujo }], maquinas: [{ bem_id: "b1", sem_medidor: true, quantidade_uso: "2", medidor_unidade: "h", justificativa_salto: null }] }).catch(() => null);
    expect(ultimaEscrita().body).toEqual({
      empresa_id: "emp-1",
      data_operacional: HOJE,
      operation_id: "lanc-12345678",
      produtos: [{ produto_id: "p1", local_estoque_id: "l1", quantidade: "2" }],
      maquinas: [{ bem_id: "b1", sem_medidor: true, quantidade_uso: "2" }],
    });
    // A query dos seletores novos é fechada.
    expect(porta.montarCaminhoOpcoes("produtos", { empresa_id: "emp-1", atividade_id: "a1", q: "gli", produto_id: "x" })).toBe("/atividades-opcoes/produtos?empresa_id=emp-1&atividade_id=a1&q=gli");
    expect(porta.montarCaminhoOpcoes("locais", { empresa_id: "emp-1", produto_id: "p1", q: "x" })).toBe("/atividades-opcoes/locais?empresa_id=emp-1&produto_id=p1");
    expect(porta.montarCaminhoOpcoes("medidor", { empresa_id: "emp-1", bem_id: "b1", data: HOJE, q: "x" })).toBe(`/atividades-opcoes/medidor?empresa_id=emp-1&bem_id=b1&data=${HOJE}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Fatia 4 — mão de obra e serviço (MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md §3 a §7)
// ═════════════════════════════════════════════════════════════════════════
describe("LL-BLOCOS — Mão de obra e Serviços dentro do apontamento (Fatia 4)", () => {
  it("LL-BLOCOS-4 — sem permite_mao_obra / permite_servico os blocos somem; com as flags aparecem com as linhas (a cancelada marcada) e os botões", async () => {
    await montar();
    await abrir("a1", "ap1");
    for (const t of ["apontamento-ap1-mao-obra", "apontamento-ap1-servicos", "apontamento-ap1-adicionar-mao-obra", "apontamento-ap1-adicionar-servico"]) {
      expect(screen.queryByTestId(t), t).toBeNull();
    }
    cleanup();

    await montar();
    await abrir("a4", "ap7");
    // O tipo da a4 não permite produto: o bloco some; mão de obra e serviços aparecem.
    expect(screen.queryByTestId("apontamento-ap7-produtos")).toBeNull();
    const mo = screen.getByTestId("apontamento-ap7-mao-obra");
    expect(within(mo).getByTestId("linha-mao-obra-mo1-nome")).toHaveTextContent("José Silva");
    expect(within(mo).getByTestId("linha-mao-obra-mo1-quantidade")).toHaveTextContent("Hora · 8 h");
    expect(within(mo).getByTestId("linha-mao-obra-mo1-unitario")).toHaveTextContent("R$ 20,00 cada");
    expect(within(mo).getByTestId("linha-mao-obra-mo1-custo")).toHaveTextContent("custo R$ 160,00");
    expect(screen.getByTestId("linha-mao-obra-mo2")).toHaveAttribute("data-status", "CANCELADO");
    expect(screen.getByTestId("linha-mao-obra-mo2-nome")).toHaveClass("line-through");
    expect(screen.getByTestId("linha-mao-obra-mo2-cancelamento")).toHaveTextContent("por Maria · motivo: lançada em dobro");
    expect(screen.queryByTestId("linha-mao-obra-mo2-editar")).toBeNull();
    const sv = screen.getByTestId("apontamento-ap7-servicos");
    expect(within(sv).getByTestId("linha-servico-sv1-nome")).toHaveTextContent("Frete");
    expect(within(sv).getByTestId("linha-servico-sv1-quantidade")).toHaveTextContent("10 KM");
    expect(within(sv).getByTestId("linha-servico-sv1-parceiro")).toHaveTextContent("por Transportes Silva");
    expect(within(sv).getByTestId("linha-servico-sv1-valor")).toHaveTextContent("valor R$ 50,00");
    for (const t of ["apontamento-ap7-adicionar-mao-obra", "apontamento-ap7-adicionar-servico", "linha-mao-obra-mo1-editar", "linha-mao-obra-mo1-cancelar", "linha-servico-sv1-editar", "linha-servico-sv1-cancelar"]) {
      expect(screen.getByTestId(t), t).toBeTruthy();
    }
    cleanup();

    // Linha antiga num tipo sem a flag: continua listada, mas sem "Adicionar".
    apontamentosPorAtividade.set("a2", [apontamento({ id: "ap9", atividade_id: "a2", mao_obra: [linhaMaoObra({ id: "mo9" })] })]);
    await montar();
    await abrir("a2", "ap9");
    expect(screen.getByTestId("linha-mao-obra-mo9")).toBeTruthy();
    expect(screen.queryByTestId("apontamento-ap9-adicionar-mao-obra")).toBeNull();
    expect(screen.queryByTestId("apontamento-ap9-servicos")).toBeNull();
  });
});

describe("LL-MAO-OBRA — janela da linha de mão de obra", () => {
  it("LL-MAO-OBRA-1 — hora: medida sugerida pelo tipo (mensalista), custo da hora do cadastro (só leitura), total; o corpo NÃO leva custo", async () => {
    await montar();
    await abrir("a4", "ap7");
    const totaisAntes = leiturasDosTotais("a4");
    fireEvent.click(screen.getByTestId("apontamento-ap7-adicionar-mao-obra"));
    const janela = await screen.findByTestId("janela-linha-mao-obra");
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /José Silva/);
    expect(backend.chamadas.find((c) => c.path === "/atividades-opcoes/mao-obra")?.query).toMatchObject({ empresa_id: "emp-1" });
    expect(within(janela).getByRole("radio", { name: "Hora" })).toHaveAttribute("aria-checked", "true");
    expect(within(janela).getByText("Quantidade (h)")).toBeTruthy();
    // Hora: o custo é o do cadastro e não é campo digitável.
    expect(within(janela).getByTestId("linha-mao-obra-custo-unitario")).toHaveTextContent("R$ 20,00");
    expect(within(janela).getByTestId("linha-mao-obra-custo-unitario").tagName).not.toBe("INPUT");
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-quantidade"), { target: { value: "8" } });
    expect(within(janela).getByTestId("linha-mao-obra-total")).toHaveTextContent("R$ 160,00");
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({
      method: "POST",
      path: "/atividades/a4/apontamentos/ap7/mao-obra",
      query: {},
      body: { empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), parceiro_id: "f1", tipo_medida: "HORA", quantidade: "8" },
    });
    await waitFor(() => expect(screen.queryByTestId("janela-linha-mao-obra")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Mão de obra de José Silva lançada.");
    expect(await screen.findByTestId("linha-mao-obra-mo-n1-custo")).toHaveTextContent("custo R$ 160,00");
    await waitFor(() => expect(leiturasDosTotais("a4")).toBeGreaterThan(totaisAntes));
    await waitFor(() => {
      expect(screen.getByTestId("totalizador-mao-obra-f1-FUNCIONARIO-HORA")).toHaveTextContent("16 h");
      expect(screen.getByTestId("totalizador-mao-obra-f1-FUNCIONARIO-HORA-custo")).toHaveTextContent("R$ 320,00");
    });
  });

  it("LL-MAO-OBRA-2 — tarefa: custo digitado e obrigatório, vai no corpo; diarista sugere diária; terceirizado sugere hora (D-PROD-209); sem custo no cadastro avisa", async () => {
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("apontamento-ap7-adicionar-mao-obra"));
    const janela = await screen.findByTestId("janela-linha-mao-obra");
    // Diarista: diária sugerida, com o custo da diária do cadastro.
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /Pedro Lima/);
    expect(within(janela).getByRole("radio", { name: "Diária" })).toHaveAttribute("aria-checked", "true");
    expect(within(janela).getByTestId("linha-mao-obra-custo-unitario")).toHaveTextContent("R$ 150,00");
    // Pedro não tem custo de hora: trocando para hora, a linha entra sem custo (aviso, não bloqueio).
    fireEvent.click(within(janela).getByRole("radio", { name: "Hora" }));
    expect(within(janela).getByTestId("linha-mao-obra-custo-unitario")).toHaveTextContent("Sem custo no cadastro");
    expect(within(janela).getByTestId("linha-mao-obra-sem-custo")).toHaveTextContent("a linha entra sem custo");
    // Terceirizada (D-PROD-209): hora sugerida, sem custo no cadastro; escolhida a tarefa, o custo passa a ser digitado.
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /Ana Souza/);
    expect(within(janela).getByRole("radio", { name: "Hora" })).toHaveAttribute("aria-checked", "true");
    expect(within(janela).getByTestId("linha-mao-obra-custo-unitario")).toHaveTextContent("Sem custo no cadastro");
    fireEvent.click(within(janela).getByRole("radio", { name: "Tarefa" }));
    expect(within(janela).getByRole("radio", { name: "Tarefa" })).toHaveAttribute("aria-checked", "true");
    expect(within(janela).getByText("Quantidade (tarefa(s))")).toBeTruthy();
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-quantidade"), { target: { value: "4" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    expect(await within(janela).findByText("Informe o custo da tarefa.")).toBeTruthy();
    expect(escritas()).toEqual([]);
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-custo-unitario"), { target: { value: "12,5" } });
    expect(within(janela).getByTestId("linha-mao-obra-total")).toHaveTextContent("R$ 50,00");
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita().body).toEqual({
      empresa_id: "emp-1",
      versao: 3,
      operation_id: expect.stringMatching(/^lanc-/),
      parceiro_id: "f2",
      tipo_medida: "TAREFA",
      quantidade: "4",
      custo_unitario: "12.5",
    });
    expect(typeof ultimaEscrita().body.custo_unitario).toBe("string");
    expect(await screen.findByTestId("linha-mao-obra-mo-n1-quantidade")).toHaveTextContent("Tarefa · 4 tarefa(s)");
  });

  it("LL-MAO-OBRA-3 — editar: PATCH só com o que mudou; trocar para tarefa leva o custo digitado; a anterior fica substituída", async () => {
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("linha-mao-obra-mo1-editar"));
    let janela = await screen.findByTestId("janela-linha-mao-obra");
    expect(within(janela).getByTestId("linha-mao-obra-quantidade")).toHaveValue("8");
    // O custo da hora mostrado na edição: o do cadastro (aqui, o snapshot da linha).
    expect(within(janela).getByTestId("linha-mao-obra-custo-unitario")).toHaveTextContent("R$ 20,00");
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-quantidade"), { target: { value: "6" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({
      method: "PATCH",
      path: "/atividades/a4/apontamentos/ap7/mao-obra/mo1",
      query: {},
      body: { empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), quantidade: "6" },
    });
    await waitFor(() => expect(screen.getByTestId("linha-mao-obra-mo1")).toHaveAttribute("data-status", "CANCELADO"));
    expect(screen.getByTestId("linha-mao-obra-mo1-cancelamento")).toHaveTextContent("Substituída pela edição");
    expect(await screen.findByTestId("linha-mao-obra-mo-n1-quantidade")).toHaveTextContent("Hora · 6 h");

    // A nova linha: a medida muda para tarefa com o custo digitado (mesma quantidade).
    fireEvent.click(screen.getByTestId("linha-mao-obra-mo-n1-editar"));
    janela = await screen.findByTestId("janela-linha-mao-obra");
    fireEvent.click(within(janela).getByRole("radio", { name: "Tarefa" }));
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-custo-unitario"), { target: { value: "25" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(2));
    expect(ultimaEscrita().path).toBe("/atividades/a4/apontamentos/ap7/mao-obra/mo-n1");
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", versao: 4, operation_id: expect.stringMatching(/^lanc-/), tipo_medida: "TAREFA", custo_unitario: "25" });
  });

  it("LL-MAO-OBRA-5 — editar: a prévia mostra o custo GRAVADO enquanto funcionário e medida são os mesmos; trocar a medida ou o funcionário mostra o cadastro; o Repetir usa o cadastro", async () => {
    // O snapshot da linha (R$ 18) difere do cadastro atual do José (R$ 20/h, R$ 160/diária).
    const ap7 = apontamentosPorAtividade.get("a4")[0];
    ap7.mao_obra[0] = linhaMaoObra({ custo_unitario: "18.0000", custo_total: "144.0000" });
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("linha-mao-obra-mo1-editar"));
    const janela = await screen.findByTestId("janela-linha-mao-obra");
    const custo = () => within(janela).getByTestId("linha-mao-obra-custo-unitario");
    const total = () => within(janela).getByTestId("linha-mao-obra-total");
    expect(custo()).toHaveTextContent("R$ 18,00");
    expect(janela).toHaveTextContent("Custo da hora (gravado na linha)");
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-quantidade"), { target: { value: "10" } });
    expect(total()).toHaveTextContent("R$ 180,00");
    // Trocar a medida: o cadastro de agora.
    fireEvent.click(within(janela).getByRole("radio", { name: "Diária" }));
    expect(custo()).toHaveTextContent("R$ 160,00");
    expect(janela).toHaveTextContent("Custo da diária (do cadastro)");
    expect(total()).toHaveTextContent("R$ 1.600,00");
    // Voltar à medida gravada: o gravado de novo.
    fireEvent.click(within(janela).getByRole("radio", { name: "Hora" }));
    expect(custo()).toHaveTextContent("R$ 18,00");
    // Trocar o funcionário: o cadastro do novo (o diarista Pedro sugere diária, R$ 150).
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /Pedro Lima/);
    expect(custo()).toHaveTextContent("R$ 150,00");
    fireEvent.click(within(janela).getByRole("radio", { name: "Hora" }));
    expect(custo()).toHaveTextContent("Sem custo no cadastro");
    // De volta ao José (mensalista → hora): o gravado.
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /José Silva/);
    expect(custo()).toHaveTextContent("R$ 18,00");
    expect(total()).toHaveTextContent("R$ 180,00");
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), quantidade: "10" });
    // O servidor manteve o snapshot: a linha nova mostra o mesmo custo que a prévia.
    expect(await screen.findByTestId("linha-mao-obra-mo-n1-unitario")).toHaveTextContent("R$ 18,00 cada");
    expect(screen.getByTestId("linha-mao-obra-mo-n1-custo")).toHaveTextContent("custo R$ 180,00");

    // "Repetir" é linha NOVA: o servidor grava o cadastro de agora, e a prévia mostra ele (R$ 20), não o snapshot.
    fireEvent.click(screen.getByTestId("apontamento-repetir-ultimo"));
    const form = await screen.findByTestId("b1-form-apontamento");
    expect(within(form).getByTestId("repetir-mao-obra-0-custo-unitario")).toHaveTextContent("R$ 20,00");
    expect(within(form).getByTestId("repetir-mao-obra-0-total")).toHaveTextContent("R$ 200,00");
  });

  it("LL-MAO-OBRA-6 — o servidor responde sem_alteracao: a janela trata como \"Sem alterações\" (fecha, sem aviso de erro)", async () => {
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("linha-mao-obra-mo1-editar"));
    const janela = await screen.findByTestId("janela-linha-mao-obra");
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-quantidade"), { target: { value: "6" } });
    proxima = erroServidor(422, "ATIVIDADE_LINHA_INVALIDA", { field: "corpo", reason: "sem_alteracao", details: { entidade: "linha_mao_obra", field: "corpo", reason: "sem_alteracao" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    await waitFor(() => expect(notify.notifyInfo).toHaveBeenCalledWith("Sem alterações", "Nada foi alterado."));
    await waitFor(() => expect(screen.queryByTestId("janela-linha-mao-obra")).toBeNull());
    expect(notify.notifyWarning).not.toHaveBeenCalled();
    expect(screen.getByTestId("linha-mao-obra-mo1")).toHaveAttribute("data-status", "CONFIRMADO");
  });

  it("LL-MAO-OBRA-4 — cancelar pede motivo e manda {empresa_id, versao, operation_id, motivo}; flag desligada no servidor mostra a frase", async () => {
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("linha-mao-obra-mo1-cancelar"));
    const dialogo = await screen.findByTestId("dialogo-cancelar-linha");
    expect(dialogo).toHaveTextContent("Cancelar a mão de obra de José Silva");
    expect(dialogo).toHaveTextContent("O custo desta mão de obra deixa de contar na atividade.");
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-linha-motivo"), { target: { value: "lançada errada" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-linha-enviar"));
    await waitFor(() => expect(ultimaEscrita()?.path).toBe("/atividades/a4/apontamentos/ap7/mao-obra/mo1/cancelar"));
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), motivo: "lançada errada" });
    await waitFor(() => expect(screen.getByTestId("linha-mao-obra-mo1")).toHaveAttribute("data-status", "CANCELADO"));
    expect(screen.getByTestId("linha-mao-obra-mo1-cancelamento")).toHaveTextContent("motivo: lançada errada");

    // O tipo mudou no servidor (sem permite_mao_obra): a recusa diz o porquê.
    fireEvent.click(screen.getByTestId("apontamento-ap7-adicionar-mao-obra"));
    const janela = await screen.findByTestId("janela-linha-mao-obra");
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /José Silva/);
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-quantidade"), { target: { value: "2" } });
    proxima = erroServidor(422, "ATIVIDADE_EXIGIDA_PELO_TIPO", { field: "mao_obra", reason: "permite_mao_obra" });
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    expect(await within(janela).findByTestId("erro-envio")).toHaveTextContent("O tipo desta atividade não permite mão de obra. Nada foi gravado.");
  });
});

describe("LL-MAO-OBRA-TERCEIRO — funcionário ou terceiro (D-PROD-208)", () => {
  it("LL-MAO-OBRA-7 — terceiro: sem sugestão de medida (hora), custo unitário sempre digitado e obrigatório, vai no corpo com o parceiro_id; totalizador e linha marcam \"(terceiro)\"", async () => {
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("apontamento-ap7-adicionar-mao-obra"));
    const janela = await screen.findByTestId("janela-linha-mao-obra");
    expect(within(janela).getByText("Funcionário ou terceiro")).toBeTruthy();
    // O diarista sugere diária; o terceiro escolhido depois volta para hora (sem sugestão).
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /Pedro Lima/);
    expect(within(janela).getByRole("radio", { name: "Diária" })).toHaveAttribute("aria-checked", "true");
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /Empreiteira Rocha/);
    expect(backend.chamadas.find((c) => c.path === "/atividades-opcoes/mao-obra")?.query).toMatchObject({ empresa_id: "emp-1" });
    expect(within(janela).getByRole("radio", { name: "Hora" })).toHaveAttribute("aria-checked", "true");
    expect(within(janela).queryByTestId("linha-mao-obra-terceiro")).toBeNull();
    // Mesmo na hora o custo é campo digitável (nada vem de cadastro) e é obrigatório.
    expect(within(janela).getByTestId("linha-mao-obra-custo-unitario").tagName).toBe("INPUT");
    expect(within(janela).queryByTestId("linha-mao-obra-sem-custo")).toBeNull();
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-quantidade"), { target: { value: "8" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    expect(await within(janela).findByText("Informe o custo unitário: para terceiro ele é sempre digitado.")).toBeTruthy();
    expect(escritas()).toEqual([]);
    // Na diária também digitado (o rótulo segue a medida).
    fireEvent.click(within(janela).getByRole("radio", { name: "Diária" }));
    expect(within(janela).getByText("Custo da diária (R$)")).toBeTruthy();
    fireEvent.click(within(janela).getByRole("radio", { name: "Hora" }));
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-custo-unitario"), { target: { value: "30" } });
    expect(within(janela).getByTestId("linha-mao-obra-total")).toHaveTextContent("R$ 240,00");
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({
      method: "POST",
      path: "/atividades/a4/apontamentos/ap7/mao-obra",
      query: {},
      body: { empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), parceiro_id: "pp2", tipo_medida: "HORA", quantidade: "8", custo_unitario: "30" },
    });
    await waitFor(() => expect(screen.queryByTestId("janela-linha-mao-obra")).toBeNull());
    expect(await screen.findByTestId("linha-mao-obra-mo-n1-nome")).toHaveTextContent("Empreiteira Rocha (terceiro)");
    expect(screen.getByTestId("linha-mao-obra-mo-n1-custo")).toHaveTextContent("custo R$ 240,00");
    const totais = screen.getByTestId("totalizador-atividade");
    await waitFor(() => {
      expect(within(totais).getByTestId("totalizador-mao-obra-pp2-TERCEIRO-HORA")).toHaveTextContent("8 h");
      expect(within(totais).getByTestId("totalizador-mao-obra-pp2-TERCEIRO-HORA-custo")).toHaveTextContent("R$ 240,00");
    });
    expect(within(totais).getByText("Empreiteira Rocha (terceiro)")).toBeTruthy();
    // O funcionário continua sem a marca.
    expect(within(totais).getByText("José Silva")).toBeTruthy();
    await waitFor(() => expect(within(totais).getByTestId("totalizador-custo")).toHaveTextContent("R$ 450,00"));
  });

  it("LL-MAO-OBRA-8 — recusa do parceiro (parceiro_invalido): mensagem uniforme no campo; editar trocando funcionário por terceiro leva parceiro_id e o custo digitado", async () => {
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("apontamento-ap7-adicionar-mao-obra"));
    const janela = await screen.findByTestId("janela-linha-mao-obra");
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /José Silva/);
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-quantidade"), { target: { value: "2" } });
    proxima = erroServidor(422, "ATIVIDADE_LINHA_INVALIDA", { field: "parceiro_id", reason: "parceiro_invalido", details: { entidade: "linha_mao_obra", field: "parceiro_id", reason: "parceiro_invalido" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    const frase = "O funcionário ou terceiro escolhido não pode ser usado: ele precisa ser um parceiro ativo desta fazenda com o papel funcionário ou prestador de serviço. Nada foi gravado.";
    expect(await within(janela).findByTestId("erro-envio")).toHaveTextContent(frase);
    expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", frase);
    // A frase também fica no campo do parceiro (o seletor), sem revelar o porquê.
    expect(within(janela).getAllByText(frase).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-voltar"));
    await waitFor(() => expect(screen.queryByTestId("janela-linha-mao-obra")).toBeNull());

    // Editar a mo1 (José, hora): trocar pelo terceiro pede o custo e o PATCH leva parceiro_id + custo_unitario.
    fireEvent.click(screen.getByTestId("linha-mao-obra-mo1-editar"));
    const edicao = await screen.findByTestId("janela-linha-mao-obra");
    expect(within(edicao).getByTestId("linha-mao-obra-parceiro").getAttribute("aria-label")).toMatch(/José Silva/);
    await escolherNoSeletor(edicao, "linha-mao-obra-parceiro", /Empreiteira Rocha/);
    fireEvent.click(within(edicao).getByTestId("janela-linha-mao-obra-salvar"));
    expect(await within(edicao).findByText("Informe o custo unitário: para terceiro ele é sempre digitado.")).toBeTruthy();
    // Mesmo custo do snapshot do José (R$ 20): vai assim mesmo, porque o parceiro mudou.
    fireEvent.change(within(edicao).getByTestId("linha-mao-obra-custo-unitario"), { target: { value: "20" } });
    fireEvent.click(within(edicao).getByTestId("janela-linha-mao-obra-salvar"));
    await waitFor(() => expect(ultimaEscrita().path).toBe("/atividades/a4/apontamentos/ap7/mao-obra/mo1"));
    expect(ultimaEscrita()).toMatchObject({ method: "PATCH" });
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), parceiro_id: "pp2", custo_unitario: "20" });
    await waitFor(() => expect(screen.getByTestId("linha-mao-obra-mo1")).toHaveAttribute("data-status", "CANCELADO"));
    expect(await screen.findByTestId("linha-mao-obra-mo-n1-nome")).toHaveTextContent("Empreiteira Rocha (terceiro)");
  });

  it("LL-REPETIR-6 — \"Repetir\" com funcionário e terceiro: o terceiro volta com o custo digitado (editável) e o POST leva parceiro_id de cada um", async () => {
    const ap7 = apontamentosPorAtividade.get("a4")[0];
    ap7.mao_obra.push(linhaMaoObra({ id: "mo3", ordem: 3, parceiro_id: "pp2", origem: "TERCEIRO", parceiro: resumoParceiro("pp2"), tipo_medida: "DIARIA", quantidade: "2.0000", custo_unitario: "120.0000", custo_total: "240.0000" }));
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("apontamento-repetir-ultimo"));
    const form = await screen.findByTestId("b1-form-apontamento");
    expect(within(form).getByTestId("repetir-mao-obra-0-parceiro").getAttribute("aria-label")).toMatch(/José Silva/);
    expect(within(form).getByTestId("repetir-mao-obra-1-parceiro").getAttribute("aria-label")).toMatch(/Empreiteira Rocha/);
    expect(within(form).getByTestId("repetir-mao-obra-1-terceiro")).toBeTruthy();
    expect(within(form).getByTestId("repetir-mao-obra-1-custo-unitario")).toHaveValue("120");
    expect(within(form).getByTestId("repetir-mao-obra-1-total")).toHaveTextContent("R$ 240,00");
    fireEvent.change(within(form).getByTestId("repetir-mao-obra-1-custo-unitario"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    expect(await within(form).findByText("Informe o custo unitário: para terceiro ele é sempre digitado.")).toBeTruthy();
    expect(escritas()).toEqual([]);
    fireEvent.change(within(form).getByTestId("repetir-mao-obra-1-custo-unitario"), { target: { value: "130" } });
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita().body.mao_obra).toEqual([
      { parceiro_id: "f1", tipo_medida: "HORA", quantidade: "8" },
      { parceiro_id: "pp2", tipo_medida: "DIARIA", quantidade: "2", custo_unitario: "130" },
    ]);
  });
});

describe("LL-MAO-OBRA-ORIGEM — origem gravada × origem atual do parceiro (D-PROD-208)", () => {
  it("LL-REPETIR-7 — o \"Repetir\" parte da origem ATUAL: quem virou terceiro pede o custo digitado; quem perdeu o papel volta vazio para escolher", async () => {
    const ap7 = apontamentosPorAtividade.get("a4")[0];
    // A Rocha entrou como funcionária (hora, custo do cadastro) e hoje é só prestadora (terceiro).
    ap7.mao_obra.push(linhaMaoObra({ id: "mo3", ordem: 3, parceiro_id: "pp2", origem: "FUNCIONARIO", parceiro: resumoParceiro("pp2"), tipo_medida: "HORA", quantidade: "5.0000", custo_unitario: "22.0000", custo_total: "110.0000" }));
    // O Zé Antigo perdeu o papel (ou foi inativado): `origem_atual` nula.
    ap7.mao_obra.push(linhaMaoObra({ id: "mo4", ordem: 4, parceiro_id: "x9", origem: "FUNCIONARIO", parceiro: { ...resumoParceiro("x9"), nome: "Zé Antigo", origem_atual: null }, tipo_medida: "DIARIA", quantidade: "1.0000", custo_unitario: "100.0000", custo_total: "100.0000" }));
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("apontamento-repetir-ultimo"));
    const form = await screen.findByTestId("b1-form-apontamento");
    expect(within(form).getByTestId("repetir-mao-obra-1-parceiro").getAttribute("aria-label")).toMatch(/Empreiteira Rocha/);
    expect(within(form).getByTestId("repetir-mao-obra-1-terceiro")).toBeTruthy();
    expect(within(form).getByTestId("repetir-mao-obra-1-custo-unitario")).toHaveValue("");
    expect(within(form).getByTestId("repetir-mao-obra-2-parceiro").getAttribute("aria-label")).not.toMatch(/Zé Antigo/);
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    expect(await within(form).findByText("Informe o custo unitário: para terceiro ele é sempre digitado.")).toBeTruthy();
    expect(await within(form).findByText("Escolha o funcionário ou terceiro.")).toBeTruthy();
    expect(escritas()).toEqual([]);
    fireEvent.change(within(form).getByTestId("repetir-mao-obra-1-custo-unitario"), { target: { value: "35" } });
    await escolherNoSeletor(form, "repetir-mao-obra-2-parceiro", /Pedro Lima/);
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita().body.mao_obra).toEqual([
      { parceiro_id: "f1", tipo_medida: "HORA", quantidade: "8" },
      { parceiro_id: "pp2", tipo_medida: "HORA", quantidade: "5", custo_unitario: "35" },
      { parceiro_id: "f3", tipo_medida: "DIARIA", quantidade: "1" },
    ]);
  });

  it("LL-MAO-OBRA-9 — editar: trocar de parceiro e voltar ao GRAVADO restaura a origem, a medida e o custo gravados (não os da opção)", async () => {
    const ap7 = apontamentosPorAtividade.get("a4")[0];
    ap7.mao_obra[0] = linhaMaoObra({ parceiro_id: "pp2", origem: "FUNCIONARIO", parceiro: resumoParceiro("pp2"), tipo_medida: "HORA", quantidade: "8.0000", custo_unitario: "22.0000", custo_total: "176.0000" });
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("linha-mao-obra-mo1-editar"));
    const janela = await screen.findByTestId("janela-linha-mao-obra");
    const custo = () => within(janela).getByTestId("linha-mao-obra-custo-unitario");
    expect(custo()).toHaveTextContent("R$ 22,00");
    expect(janela).toHaveTextContent("Custo da hora (gravado na linha)");
    // Para a Ana (terceirizada, D-PROD-209: hora sugerida, sem custo no cadastro); escolhida a tarefa, custo digitado.
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /Ana Souza/);
    expect(within(janela).getByRole("radio", { name: "Hora" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(janela).getByRole("radio", { name: "Tarefa" }));
    expect(custo().tagName).toBe("INPUT");
    // De volta à Rocha pelo seletor (a opção diz TERCEIRO): a linha mantém a origem gravada (funcionário), a hora e o custo gravado.
    await escolherNoSeletor(janela, "linha-mao-obra-parceiro", /Empreiteira Rocha/);
    expect(within(janela).getByRole("radio", { name: "Hora" })).toHaveAttribute("aria-checked", "true");
    expect(custo().tagName).not.toBe("INPUT");
    expect(custo()).toHaveTextContent("R$ 22,00");
    expect(within(janela).queryByTestId("linha-mao-obra-terceiro")).toBeNull();
    fireEvent.change(within(janela).getByTestId("linha-mao-obra-quantidade"), { target: { value: "10" } });
    expect(within(janela).getByTestId("linha-mao-obra-total")).toHaveTextContent("R$ 220,00");
    fireEvent.click(within(janela).getByTestId("janela-linha-mao-obra-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), quantidade: "10" });
  });

  it("LL-TOTAIS-4 — o mesmo parceiro como funcionário e como terceiro são duas linhas do totalizador (a chave leva a origem)", async () => {
    const ap7 = apontamentosPorAtividade.get("a4")[0];
    ap7.mao_obra.push(linhaMaoObra({ id: "mo5", ordem: 3, parceiro_id: "pp2", origem: "FUNCIONARIO", parceiro: resumoParceiro("pp2"), tipo_medida: "HORA", quantidade: "1.0000", custo_unitario: "10.0000", custo_total: "10.0000" }));
    ap7.mao_obra.push(linhaMaoObra({ id: "mo6", ordem: 4, parceiro_id: "pp2", origem: "TERCEIRO", parceiro: resumoParceiro("pp2"), tipo_medida: "HORA", quantidade: "2.0000", custo_unitario: "30.0000", custo_total: "60.0000" }));
    await montar();
    await abrir("a4", "ap7");
    const totais = await screen.findByTestId("totalizador-atividade");
    await waitFor(() => {
      expect(within(totais).getByTestId("totalizador-mao-obra-pp2-FUNCIONARIO-HORA")).toHaveTextContent("1 h");
      expect(within(totais).getByTestId("totalizador-mao-obra-pp2-FUNCIONARIO-HORA-custo")).toHaveTextContent("R$ 10,00");
    });
    expect(within(totais).getByTestId("totalizador-mao-obra-pp2-TERCEIRO-HORA")).toHaveTextContent("2 h");
    expect(within(totais).getByTestId("totalizador-mao-obra-pp2-TERCEIRO-HORA-custo")).toHaveTextContent("R$ 60,00");
    expect(within(totais).getByText("Empreiteira Rocha")).toBeTruthy();
    expect(within(totais).getByText("Empreiteira Rocha (terceiro)")).toBeTruthy();
  });
});

describe("LL-SERVICO — janela da linha de serviço", () => {
  it("LL-SERVICO-1 — valor unitário pré-preenchido com o de referência, quantidade na unidade do serviço, total, documento; sem parceiro o corpo não o leva", async () => {
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("apontamento-ap7-adicionar-servico"));
    const janela = await screen.findByTestId("janela-linha-servico");
    // Serviço sem valor de referência: o valor fica em branco e é obrigatório.
    await escolherNoSeletor(janela, "linha-servico-servico", /Roçada terceirizada/);
    expect(within(janela).getByTestId("linha-servico-valor-unitario")).toHaveValue("");
    expect(within(janela).getByText("Quantidade (HA)")).toBeTruthy();
    fireEvent.change(within(janela).getByTestId("linha-servico-quantidade"), { target: { value: "2" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-servico-salvar"));
    expect(await within(janela).findByText("Informe o valor unitário.")).toBeTruthy();
    expect(escritas()).toEqual([]);
    // Frete: o valor de referência (R$ 5) entra no campo; a unidade é a do serviço.
    await escolherNoSeletor(janela, "linha-servico-servico", /Frete/);
    expect(within(janela).getByTestId("linha-servico-valor-unitario")).toHaveValue("5");
    expect(within(janela).getByText("Quantidade (KM)")).toBeTruthy();
    fireEvent.change(within(janela).getByTestId("linha-servico-quantidade"), { target: { value: "10" } });
    expect(within(janela).getByTestId("linha-servico-total")).toHaveTextContent("R$ 50,00");
    fireEvent.change(within(janela).getByLabelText(/Documento/), { target: { value: "NF 123" } });
    fireEvent.click(within(janela).getByTestId("janela-linha-servico-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({
      method: "POST",
      path: "/atividades/a4/apontamentos/ap7/servicos",
      query: {},
      body: { empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), servico_id: "s1", quantidade: "10", valor_unitario: "5", documento_referencia: "NF 123" },
    });
    await waitFor(() => expect(screen.queryByTestId("janela-linha-servico")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Serviço Frete lançado.");
    expect(await screen.findByTestId("linha-servico-sv-n1-valor")).toHaveTextContent("valor R$ 50,00");
    expect(screen.queryByTestId("linha-servico-sv-n1-parceiro")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("totalizador-servico-s1-KM")).toHaveTextContent("20 KM");
      expect(screen.getByTestId("totalizador-servico-s1-KM-custo")).toHaveTextContent("R$ 100,00");
    });
  });

  it("LL-SERVICO-2 — parceiro opcional (só prestadores): recusa uniforme do servidor; com parceiro vai o id; editar limpando o parceiro manda null", async () => {
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("apontamento-ap7-adicionar-servico"));
    const janela = await screen.findByTestId("janela-linha-servico");
    await escolherNoSeletor(janela, "linha-servico-servico", /Frete/);
    await escolherNoSeletor(janela, "linha-servico-parceiro", /Transportes Silva/);
    expect(backend.chamadas.find((c) => c.path === "/atividades-opcoes/parceiros-servico")?.query).toMatchObject({ empresa_id: "emp-1" });
    fireEvent.change(within(janela).getByTestId("linha-servico-quantidade"), { target: { value: "3" } });
    proxima = erroServidor(422, "ATIVIDADE_LINHA_INVALIDA", { field: "fornecedor_parceiro_id", reason: "parceiro_recusado" });
    fireEvent.click(within(janela).getByTestId("janela-linha-servico-salvar"));
    const frase = "O parceiro escolhido não pode ser usado: ele precisa ser um prestador de serviço ativo desta fazenda. Nada foi gravado.";
    expect(await within(janela).findByTestId("erro-envio")).toHaveTextContent(frase);
    expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", frase);
    expect(escritas()[0].body).toMatchObject({ servico_id: "s1", fornecedor_parceiro_id: "pp1", quantidade: "3", valor_unitario: "5" });
    fireEvent.click(within(janela).getByTestId("janela-linha-servico-salvar"));
    await waitFor(() => expect(screen.queryByTestId("janela-linha-servico")).toBeNull());
    expect(await screen.findByTestId("linha-servico-sv-n1-parceiro")).toHaveTextContent("por Transportes Silva");

    // Editar a sv1: tirar o parceiro manda `fornecedor_parceiro_id: null` (e só ele).
    fireEvent.click(screen.getByTestId("linha-servico-sv1-editar"));
    const edicao = await screen.findByTestId("janela-linha-servico");
    expect(within(edicao).getByLabelText(/Documento/)).toHaveValue("NF 77");
    fireEvent.click(within(edicao).getByRole("button", { name: "Limpar" }));
    fireEvent.click(within(edicao).getByTestId("janela-linha-servico-salvar"));
    await waitFor(() => expect(ultimaEscrita().path).toBe("/atividades/a4/apontamentos/ap7/servicos/sv1"));
    expect(ultimaEscrita()).toMatchObject({ method: "PATCH", body: { empresa_id: "emp-1", versao: 4, fornecedor_parceiro_id: null } });
    expect(Object.keys(ultimaEscrita().body).sort()).toEqual(["empresa_id", "fornecedor_parceiro_id", "operation_id", "versao"]);
  });

  it("LL-SERVICO-3 — cancelar o serviço com motivo; deixa de contar no totalizador", async () => {
    await montar();
    await abrir("a4", "ap7");
    await waitFor(() => {
      expect(screen.getByTestId("totalizador-servico-s1-KM")).toHaveTextContent("10 KM");
      expect(screen.getByTestId("totalizador-servico-s1-KM-custo")).toHaveTextContent("R$ 50,00");
    });
    fireEvent.click(screen.getByTestId("linha-servico-sv1-cancelar"));
    const dialogo = await screen.findByTestId("dialogo-cancelar-linha");
    expect(dialogo).toHaveTextContent("O valor deste serviço deixa de contar na atividade.");
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-linha-motivo"), { target: { value: "serviço não feito" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-linha-enviar"));
    await waitFor(() => expect(ultimaEscrita()?.path).toBe("/atividades/a4/apontamentos/ap7/servicos/sv1/cancelar"));
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), motivo: "serviço não feito" });
    await waitFor(() => expect(screen.getByTestId("linha-servico-sv1")).toHaveAttribute("data-status", "CANCELADO"));
    await waitFor(() => expect(screen.queryByTestId("totalizador-servico-s1-KM")).toBeNull());
  });
});

describe("LL-TOTAIS — totalizador com mão de obra e serviços (Fatia 4)", () => {
  it("LL-TOTAIS-2 — mão de obra por funcionário e medida, serviço por serviço; custo e custo/ha somam as quatro linhas", async () => {
    await montar();
    await abrir("a4", "ap7");
    const totais = await screen.findByTestId("totalizador-atividade");
    await waitFor(() => expect(within(totais).getByTestId("totalizador-custo")).toHaveTextContent("R$ 210,00"));
    expect(within(totais).getByText("José Silva")).toBeTruthy();
    expect(within(totais).getByTestId("totalizador-mao-obra-f1-FUNCIONARIO-HORA")).toHaveTextContent("8 h");
    expect(within(totais).getByTestId("totalizador-mao-obra-f1-FUNCIONARIO-HORA-custo")).toHaveTextContent("R$ 160,00");
    // A tarefa cancelada da Ana não conta.
    expect(within(totais).queryByTestId("totalizador-mao-obra-f2-FUNCIONARIO-TAREFA")).toBeNull();
    expect(within(totais).getByText("Frete")).toBeTruthy();
    expect(within(totais).getByTestId("totalizador-servico-s1-KM")).toHaveTextContent("10 KM");
    expect(within(totais).getByTestId("totalizador-servico-s1-KM-custo")).toHaveTextContent("R$ 50,00");
    expect(within(totais).getByTestId("totalizador-custo-ha")).toHaveTextContent("R$ 21,00/ha");
  });
});

describe("LL-TOTAIS — o serviço agrupa por serviço E unidade", () => {
  it("LL-TOTAIS-3 — o mesmo serviço em duas unidades (o snapshot da linha) são duas linhas do totalizador, cada uma com a sua chave", async () => {
    const ap7 = apontamentosPorAtividade.get("a4")[0];
    ap7.servicos.push(linhaServico({ id: "sv2", ordem: 2, unidade: "H", quantidade: "2.0000", valor_unitario: "30.0000", valor_total: "60.0000", documento_referencia: null }));
    await montar();
    await abrir("a4", "ap7");
    const totais = await screen.findByTestId("totalizador-atividade");
    await waitFor(() => {
      expect(within(totais).getByTestId("totalizador-servico-s1-KM")).toHaveTextContent("10 KM");
      expect(within(totais).getByTestId("totalizador-servico-s1-KM-custo")).toHaveTextContent("R$ 50,00");
    });
    expect(within(totais).getByTestId("totalizador-servico-s1-H")).toHaveTextContent("2 H");
    expect(within(totais).getByTestId("totalizador-servico-s1-H-custo")).toHaveTextContent("R$ 60,00");
    expect(within(totais).getAllByText("Frete")).toHaveLength(2);
  });
});

describe("LL-REPETIR — \"Repetir último lançamento\" com mão de obra e serviços (Fatia 4)", () => {
  it("LL-REPETIR-4 — traz a mão de obra e os serviços confirmados (sem o documento), o operador ajusta e vai UM POST com mao_obra[] e servicos[]", async () => {
    await montar();
    await abrir("a4", "ap7");
    fireEvent.click(screen.getByTestId("apontamento-repetir-ultimo"));
    const form = await screen.findByTestId("b1-form-apontamento");
    expect(within(form).getByTestId("repetir-mao-obra-0")).toBeTruthy();
    expect(within(form).queryByTestId("repetir-mao-obra-1")).toBeNull();
    expect(within(form).getByTestId("repetir-mao-obra-0-parceiro").getAttribute("aria-label")).toMatch(/José Silva/);
    expect(within(form).getByTestId("repetir-mao-obra-0-quantidade")).toHaveValue("8");
    expect(within(form).getByTestId("repetir-mao-obra-0-custo-unitario")).toHaveTextContent("R$ 20,00");
    const servico = within(form).getByTestId("repetir-servico-0");
    expect(within(servico).getByTestId("repetir-servico-0-servico").getAttribute("aria-label")).toMatch(/Frete/);
    expect(within(servico).getByTestId("repetir-servico-0-parceiro").getAttribute("aria-label")).toMatch(/Transportes Silva/);
    expect(within(servico).getByTestId("repetir-servico-0-valor-unitario")).toHaveValue("5");
    expect(within(servico).getByLabelText(/Documento/)).toHaveValue("");
    fireEvent.change(within(form).getByTestId("repetir-mao-obra-0-quantidade"), { target: { value: "9" } });
    expect(within(form).getByTestId("repetir-mao-obra-0-total")).toHaveTextContent("R$ 180,00");
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    const { method, path, body } = ultimaEscrita();
    expect({ method, path }).toEqual({ method: "POST", path: "/atividades/a4/apontamentos" });
    expect(body).toEqual({
      empresa_id: "emp-1",
      data_operacional: HOJE,
      turno: "MANHA",
      area_executada_dia: "10",
      operation_id: expect.stringMatching(/^lanc-/),
      mao_obra: [{ parceiro_id: "f1", tipo_medida: "HORA", quantidade: "9" }],
      servicos: [{ servico_id: "s1", fornecedor_parceiro_id: "pp1", quantidade: "10", valor_unitario: "5" }],
    });
    await waitFor(() => expect(screen.queryByTestId("janela-apontamento")).toBeNull());
    expect(await screen.findByTestId("linha-mao-obra-mo-n2-quantidade")).toHaveTextContent("Hora · 9 h");
  });

  it("LL-REPETIR-5 — a base com mão de obra num tipo sem permite_mao_obra: aviso e as linhas não vão", async () => {
    apontamentosPorAtividade.set("a2", [apontamento({ id: "ap9", atividade_id: "a2", mao_obra: [linhaMaoObra({ id: "mo9" })] })]);
    await montar();
    await abrir("a2", "ap9");
    fireEvent.click(screen.getByTestId("apontamento-repetir-ultimo"));
    const form = await screen.findByTestId("b1-form-apontamento");
    expect(within(form).getByTestId("repetir-mao-obra-fora-do-tipo")).toHaveTextContent("não permite mão de obra");
    expect(within(form).queryByTestId("repetir-mao-obra-0")).toBeNull();
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita().body).not.toHaveProperty("mao_obra");
    expect(ultimaEscrita().body).not.toHaveProperty("operation_id");
  });
});

describe("LL-PORTA — allowlists da mão de obra e do serviço (Fatia 4)", () => {
  it("LL-PORTA-2 — campos do contrato §3/§4/§6; nada do servidor vai no corpo; rotas e seletores novos", async () => {
    const porta = await import("@/apis/atividades/lancamentoAtividadePort.js");
    const ordenado = (/** @type {readonly string[]} */ l) => [...l].sort();
    expect(ordenado(porta.CAMPOS_DA_LINHA_MAO_OBRA)).toEqual(["custo_unitario", "observacao", "parceiro_id", "quantidade", "tipo_medida"]);
    expect(ordenado(porta.CAMPOS_DA_LINHA_SERVICO)).toEqual(["documento_referencia", "fornecedor_parceiro_id", "observacao", "quantidade", "servico_id", "valor_unitario"]);
    // Paridade com os schemas fechados do servidor (os mesmos campos no lançamento, na edição e em `mao_obra[]`/`servicos[]`).
    for (const [arquivo, constante, campos] of /** @type {Array<[string, string, readonly string[]]>} */ ([
      ["backend/src/modules/atividades/atividadeApontamentoMaoObraRoutes.js", "export const CAMPOS_DA_LINHA_MAO_OBRA", porta.CAMPOS_DA_LINHA_MAO_OBRA],
      ["backend/src/modules/atividades/atividadeApontamentoServicoRoutes.js", "export const CAMPOS_DA_LINHA_SERVICO", porta.CAMPOS_DA_LINHA_SERVICO],
    ])) {
      const fonte = readFileSync(arquivo, "utf8");
      const inicio = fonte.indexOf(constante);
      expect(inicio, arquivo).toBeGreaterThan(-1);
      const bloco = fonte.slice(inicio, fonte.indexOf("});", inicio));
      expect(ordenado([...bloco.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1])), arquivo).toEqual(ordenado(campos));
      expect(fonte).toMatch(/required: \['empresa_id', 'versao', 'operation_id'/);
    }
    for (const l of [porta.CAMPOS_DE_CRIACAO_LINHA_MAO_OBRA, porta.CAMPOS_DE_EDICAO_LINHA_MAO_OBRA]) {
      expect(ordenado(l)).toEqual(ordenado(["empresa_id", "versao", "operation_id", ...porta.CAMPOS_DA_LINHA_MAO_OBRA]));
    }
    for (const l of [porta.CAMPOS_DE_CRIACAO_LINHA_SERVICO, porta.CAMPOS_DE_EDICAO_LINHA_SERVICO]) {
      expect(ordenado(l)).toEqual(ordenado(["empresa_id", "versao", "operation_id", ...porta.CAMPOS_DA_LINHA_SERVICO]));
    }
    expect(porta.CAMPOS_DE_CRIACAO_APONTAMENTO).toEqual(expect.arrayContaining(["mao_obra", "servicos"]));
    expect(porta.CAMPOS_DE_DUPLICACAO_APONTAMENTO).toEqual(expect.arrayContaining(["mao_obra", "servicos"]));
    expect(porta.RECURSOS_OPCOES_ATIVIDADE).toEqual(expect.arrayContaining(["mao-obra", "servicos", "parceiros-servico"]));
    expect(porta.RECURSOS_OPCOES_ATIVIDADE).not.toContain("funcionarios");
    const { TIPOS_LINHA_ATIVIDADE } = await import("@/apis/atividades");
    expect(TIPOS_LINHA_ATIVIDADE).toEqual(["produtos", "maquinas", "mao-obra", "servicos"]);

    // Custo total, status, nome e cliente nunca vão; a rota da mão de obra é `…/mao-obra`.
    const sujoMo = { empresa_id: "emp-1", versao: 3, operation_id: "lanc-12345678", parceiro_id: "f1", tipo_medida: "HORA", quantidade: "2", custo_total: "9", status: "CANCELADO", origem: "TERCEIRO", funcionario_id: "f1", parceiro: { nome: "x" }, cliente_id: "x" };
    await porta.operacoesNativas.criarLinha("mao-obra", "a4", "ap7", sujoMo).catch(() => null);
    expect(ultimaEscrita().path).toBe("/atividades/a4/apontamentos/ap7/mao-obra");
    expect(Object.keys(ultimaEscrita().body).sort()).toEqual(["empresa_id", "operation_id", "parceiro_id", "quantidade", "tipo_medida", "versao"]);
    const sujoSv = { servico_id: "s1", quantidade: "2", valor_unitario: "5", unidade: "KM", valor_total: "10", fornecedor_parceiro_id: null, documento_referencia: "" };
    await porta.operacoesNativas.createApontamento("a4", { empresa_id: "emp-1", data_operacional: HOJE, operation_id: "lanc-12345678", mao_obra: [{ ...sujoMo }], servicos: [sujoSv] }).catch(() => null);
    expect(ultimaEscrita().body).toEqual({
      empresa_id: "emp-1",
      data_operacional: HOJE,
      operation_id: "lanc-12345678",
      mao_obra: [{ parceiro_id: "f1", tipo_medida: "HORA", quantidade: "2" }],
      servicos: [{ servico_id: "s1", quantidade: "2", valor_unitario: "5" }],
    });
    expect(porta.montarCaminhoOpcoes("mao-obra", { empresa_id: "emp-1", q: "jo", produto_id: "x", limit: 20, cursor: "c1" })).toBe("/atividades-opcoes/mao-obra?empresa_id=emp-1&q=jo&limit=20&cursor=c1");
    expect(porta.montarCaminhoOpcoes("parceiros-servico", { empresa_id: "emp-1", q: "sil" })).toBe("/atividades-opcoes/parceiros-servico?empresa_id=emp-1&q=sil");

    // Regras puras: a sugestão da medida e o custo de cada medida.
    const regras = await import("@/lib/atividadeLinhasRegras");
    // D-PROD-209: TERCEIRIZADO sugere hora; TAREFEIRO saiu da lista (desconhecido → hora, como qualquer outro).
    expect(["MENSALISTA", "DIARISTA", "TERCEIRIZADO", "TAREFEIRO", "X"].map(regras.medidaSugerida)).toEqual(["HORA", "DIARIA", "HORA", "HORA", "HORA"]);
    const jose = regras.maoObraEscolhida(MAO_OBRA[0]);
    expect(jose).toEqual({ id: "f1", rotulo: "José Silva", origem: "FUNCIONARIO", tipo: "MENSALISTA", custo_hora: "20.0000", custo_diaria: "160.0000" });
    expect(regras.custoDaLinhaMaoObra({ parceiro: jose, tipo_medida: "DIARIA", quantidade: "1,5", custo_unitario: "999", observacao: "" })).toEqual({ unitario: "160.0000", total: "240.0000" });
    expect(regras.corpoDaLinhaMaoObra({ parceiro: jose, tipo_medida: "DIARIA", quantidade: "1,5", custo_unitario: "999", observacao: "" })).not.toHaveProperty("custo_unitario");
    // Terceiro: sem sugestão de medida (hora), sem custo de cadastro; o custo é sempre digitado e vai no corpo.
    const rocha = regras.maoObraEscolhida({ ...MAO_OBRA[3], funcionario_custo_hora: "99.0000" });
    expect(rocha).toMatchObject({ id: "pp2", origem: "TERCEIRO", tipo: null, custo_hora: null, custo_diaria: null });
    expect(regras.medidaSugeridaDaMaoObra(rocha)).toBe("HORA");
    expect(regras.custoDaLinhaMaoObra({ parceiro: rocha, tipo_medida: "DIARIA", quantidade: "2", custo_unitario: "100", observacao: "" })).toEqual({ unitario: "100", total: "200.0000" });
    expect(regras.corpoDaLinhaMaoObra({ parceiro: rocha, tipo_medida: "HORA", quantidade: "2", custo_unitario: "30", observacao: "" })).toEqual({ parceiro_id: "pp2", tipo_medida: "HORA", quantidade: "2", custo_unitario: "30", observacao: null });
    expect(regras.validarLinhaMaoObra({ parceiro: rocha, tipo_medida: "HORA", quantidade: "2", custo_unitario: "", observacao: "" })).toEqual({ custo_unitario: "Informe o custo unitário: para terceiro ele é sempre digitado." });
    // A recusa uniforme do parceiro aponta o campo e não diz o porquê.
    const recusado = { code: "ATIVIDADE_LINHA_INVALIDA", field: "parceiro_id", reason: "parceiro_invalido", details: { field: "parceiro_id", reason: "parceiro_invalido" } };
    expect(regras.campoDaLinhaRecusada(recusado)).toBe("parceiro");
    expect(regras.mensagemDeErroLinha(recusado, "x")).toMatch(/^O funcionário ou terceiro escolhido não pode ser usado/);
    // A recusa de uma linha embutida aponta a coleção pela entidade do servidor (`linha_indice` + `entidade`).
    const recusa = (/** @type {Record<string, unknown>} */ details) => ({ code: "ATIVIDADE_LINHA_INVALIDA", details });
    expect(regras.linhaEmbutidaRecusada(recusa({ entidade: "linha_mao_obra", linha_indice: 1 }))).toEqual({ colecao: "mao_obra", indice: 1 });
    expect(regras.linhaEmbutidaRecusada(recusa({ entidade: "linha_servico", linha_indice: 0 }))).toEqual({ colecao: "servicos", indice: 0 });
    expect(regras.linhaEmbutidaRecusada(recusa({ entidade: "linha_maquina", linha_indice: 2 }))).toEqual({ colecao: "maquinas", indice: 2 });
    expect(regras.linhaEmbutidaRecusada(recusa({ linha_indice: 0 }))).toEqual({ colecao: "maquinas", indice: 0 });
    expect(regras.linhaEmbutidaRecusada(recusa({ colecao: "produtos", indice: 3 }))).toEqual({ colecao: "produtos", indice: 3 });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Fatia 5 (D-PROD-211): abastecimento ligado ao lançamento da atividade
describe("LL-ABASTECIMENTO — bloco Abastecimentos dentro do lançamento (Fatia 5)", () => {
  const TELA_ABASTECIMENTO = "pat-abastecimentos";
  /** A permissão das atividades (todas) + a da tela Abastecimentos com `acoes`. @param {Record<string, boolean>} acoes */
  const comAbastecimento = (acoes) => {
    const base = permissaoCom(TODAS);
    return {
      ...base,
      modulos_permitidos: [...base.modulos_permitidos, "patrimonio"],
      permissoes_telas: [
        ...base.permissoes_telas,
        { modulo_id: "patrimonio", tela_id: TELA_ABASTECIMENTO, visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes },
      ],
    };
  };
  const listasDoLancamento = () => backend.chamadas.filter((c) => c.method === "GET" && c.path === "/patrimonio-abastecimentos" && c.query.apontamento_id === "ap1");
  /** Um abastecimento do posto externo já ligado ao ap1 e outro sem vínculo (não aparece no bloco). */
  const semear = async () => {
    await semearAbastecimento(abast, {
      bem_id: "b1", tanque_id: "tq1", produto_id: "p1", origem: "EXTERNO", custo_total: "400", apontamento_id: "ap1",
      data_operacional: "2026-11-12", quantidade: "80", medidor_leitura: "1550.5", tanque_cheio: true,
    });
    await semearAbastecimento(abast, { bem_id: "b2", tanque_id: "tq2", produto_id: "p2", local_estoque_id: "l2", data_operacional: "2026-11-12", quantidade: "20", medidor_leitura: "35300" });
  };

  it("LL-ABAST-1 — sem a tela Abastecimentos o bloco não aparece; só ver = lista sem Novo nem Cancelar", async () => {
    await semear();
    await montar();
    await abrir("a1", "ap1");
    await assentar();
    expect(screen.queryByTestId("apontamento-ap1-abastecimentos")).toBeNull();
    expect(listasDoLancamento()).toHaveLength(0);
    cleanup();

    sessao.permissao = comAbastecimento({});
    await montar();
    await abrir("a1", "ap1");
    const bloco = await screen.findByTestId("apontamento-ap1-abastecimentos");
    expect(await within(bloco).findByTestId("linha-abastecimento-ab-1")).toBeTruthy();
    expect(within(bloco).queryByTestId("apontamento-ap1-novo-abastecimento")).toBeNull();
    expect(within(bloco).queryByTestId("linha-abastecimento-ab-1-cancelar")).toBeNull();
  });

  it("LL-ABAST-2 — lista só os abastecimentos do lançamento (filtro apontamento_id): nº, máquina, produto, quantidade, origem e custo", async () => {
    await semear();
    sessao.permissao = comAbastecimento({ novo: true, cancelar: true });
    await montar();
    await abrir("a1", "ap1");
    const bloco = await screen.findByTestId("apontamento-ap1-abastecimentos");
    const linha = await within(bloco).findByTestId("linha-abastecimento-ab-1");
    expect(listasDoLancamento().at(-1)?.query).toMatchObject({ empresa_id: "emp-1", apontamento_id: "ap1" });
    expect(within(linha).getByTestId("linha-abastecimento-ab-1-nome")).toHaveTextContent("Nº 1 · TP-02 — Trator TP-02");
    expect(within(linha).getByTestId("linha-abastecimento-ab-1-quantidade")).toHaveTextContent("80 L");
    expect(within(linha).getByTestId("linha-abastecimento-ab-1-origem")).toHaveTextContent("Posto externo");
    expect(within(linha).getByTestId("linha-abastecimento-ab-1-custo")).toHaveTextContent("R$ 400,00");
    expect(within(bloco).queryByTestId("linha-abastecimento-ab-2")).toBeNull();
    // O lançamento CANCELADO (ap0) não aceita abastecimento novo.
    expect(within(bloco).getByTestId("apontamento-ap1-novo-abastecimento")).toBeTruthy();
    expect(screen.queryByTestId("apontamento-ap0-novo-abastecimento")).toBeNull();
  });

  it("LL-ABAST-3 — Novo abastecimento: o formulário de sempre, ligado ao lançamento (atividade e lançamento só leitura, data do lançamento); corpo com apontamento_id e sem atividade_id; relê lista, lançamentos e totais", async () => {
    sessao.permissao = comAbastecimento({ novo: true });
    await montar();
    await abrir("a1", "ap1");
    const bloco = await screen.findByTestId("apontamento-ap1-abastecimentos");
    await within(bloco).findByText("Nenhum abastecimento neste lançamento.");
    fireEvent.click(within(bloco).getByTestId("apontamento-ap1-novo-abastecimento"));
    const janela = await screen.findByTestId("janela-abastecimento-lancamento");
    const form = within(janela).getByTestId("abastecimento-form");
    expect(within(form).getByTestId("abastecimento-vinculo-atividade")).toHaveTextContent("Nº 3 — Cigarrinha Pasto 01");
    expect(within(form).getByTestId("abastecimento-vinculo-lancamento")).toHaveTextContent("12/11/2026 · Manhã · 1ª passada");
    // Só leitura: são saídas, não campos.
    expect(within(form).getByTestId("abastecimento-vinculo-atividade").tagName).toBe("OUTPUT");
    expect(within(form).getByTestId("abastecimento-data")).toHaveValue("2026-11-12");
    // Nem tipo de medidor nem centro de custo são perguntados.
    expect(within(form).queryByText(/Centro de custo/i)).toBeNull();
    await escolherNoSeletor(form, "abastecimento-bem", /Trator TP-02/);
    await waitFor(() => expect(within(form).getByTestId("abastecimento-local-auto")).toHaveTextContent("Sai do estoque: Tanque diesel sede"));
    fireEvent.change(within(form).getByTestId("abastecimento-quantidade"), { target: { value: "60" } });
    fireEvent.change(within(form).getByTestId("abastecimento-leitura"), { target: { value: "1.600" } });
    await act(async () => {
      fireEvent.click(within(form).getByTestId("abastecimento-previa"));
    });
    const previa = await screen.findByTestId("dialogo-previa-abastecimento");
    const corpoPrevia = backend.chamadas.filter((c) => c.method === "POST" && c.path === "/patrimonio-abastecimentos-previa").at(-1)?.body;
    expect(corpoPrevia).toMatchObject({ apontamento_id: "ap1", bem_id: "b1", local_estoque_id: "l1", data_operacional: "2026-11-12", quantidade: "60", medidor_leitura: "1600" });
    expect(corpoPrevia).not.toHaveProperty("atividade_id");
    expect(corpoPrevia).not.toHaveProperty("origem");
    const totaisAntes = leiturasDosTotais("a1");
    const lancamentosAntes = backend.chamadas.filter((c) => c.method === "GET" && c.path === "/atividades/a1/apontamentos").length;
    await act(async () => {
      fireEvent.click(within(previa).getByTestId("abastecimento-confirmar"));
    });
    await waitFor(() => expect(screen.queryByTestId("janela-abastecimento-lancamento")).toBeNull());
    const confirmado = backend.chamadas.filter((c) => c.method === "POST" && c.path === "/patrimonio-abastecimentos").at(-1)?.body;
    expect(confirmado).toMatchObject({ apontamento_id: "ap1", operation_id: expect.any(String) });
    expect(confirmado).not.toHaveProperty("atividade_id");
    expect(notify.notifySuccess).toHaveBeenCalledWith("Abastecimento confirmado", expect.stringContaining("baixados do estoque"));
    expect(await within(bloco).findByTestId("linha-abastecimento-ab-1")).toBeTruthy();
    await waitFor(() => expect(leiturasDosTotais("a1")).toBeGreaterThan(totaisAntes));
    expect(backend.chamadas.filter((c) => c.method === "GET" && c.path === "/atividades/a1/apontamentos").length).toBeGreaterThan(lancamentosAntes);
    // O registro gravado traz o vínculo e o centro de custo da atividade (snapshot do servidor).
    expect(abast.abastecimentos[0]).toMatchObject({ atividade: { id: "a1" }, apontamento: { id: "ap1" }, centro_custo: { nome: "Pastagem" } });
  });

  it("LL-ABAST-AREA-1 — Abastecer pela MÁQUINA (emenda 1 da D-PROD-254: o ⚡ da linha da máquina): um nível só, a máquina já escolhida, sem Atividade/Lançamento travados; a revisão fica DENTRO da mesma janela, com Cancelar e Confirmar abastecimento", async () => {
    sessao.permissao = comAbastecimento({ novo: true });
    await montar();
    await naArea("a1");
    // Abastecimento NÃO é botão "+" da área: é uma ação da linha da máquina.
    expect(screen.queryByTestId("escolher-abastecimento")).toBeNull();
    fireEvent.click(screen.getByTestId("linha-acoes-ml1"));
    fireEvent.click(within(await screen.findByTestId("linha-acoes-ml1-menu")).getByRole("menuitem", { name: "Abastecer" }));
    const janela = await screen.findByTestId("janela-abastecimento-area");
    expect(janela.querySelector(".mdl-t")).toHaveTextContent(/^Abastecimento$/);
    const form = within(janela).getByTestId("abastecimento-form");
    // Sem os campos travados que só repetiam o contexto.
    expect(within(janela).queryByTestId("abastecimento-vinculo-atividade")).toBeNull();
    expect(within(janela).queryByTestId("abastecimento-vinculo-lancamento")).toBeNull();
    // O formulário não repete os botões: eles estão no rodapé da janela (Cancelar e Revisar).
    expect(within(form).queryByTestId("abastecimento-previa")).toBeNull();
    expect(within(janela).getByTestId("janela-abastecimento-cancelar")).toBeTruthy();
    // A máquina da linha já vem escolhida (e o horímetro, porque o medidor dela é horímetro).
    expect(within(form).getByTestId("abastecimento-bem")).toHaveTextContent("TP-02");
    await waitFor(() => expect(within(form).getByTestId("abastecimento-local-auto")).toHaveTextContent("Sai do estoque: Tanque diesel sede"));
    fireEvent.change(within(form).getByTestId("abastecimento-quantidade"), { target: { value: "60" } });
    fireEvent.change(within(form).getByTestId("abastecimento-leitura"), { target: { value: "1.600" } });
    await act(async () => {
      fireEvent.click(within(janela).getByTestId("abastecimento-previa"));
    });
    // A revisão aparece na MESMA janela: nenhum diálogo por cima.
    const revisao = await within(janela).findByTestId("abastecimento-revisao");
    expect(within(revisao).getByRole("heading", { name: "Confira antes de confirmar" })).toBeTruthy();
    expect(within(revisao).getByTestId("previa-bem")).toHaveTextContent("TP-02");
    expect(screen.queryByTestId("dialogo-previa-abastecimento")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(janela).getByTestId("janela-abastecimento-cancelar")).toBeTruthy();
    // "Corrigir os dados" volta ao formulário sem perder o que foi digitado.
    fireEvent.click(within(revisao).getByTestId("abastecimento-corrigir"));
    expect(screen.queryByTestId("abastecimento-revisao")).toBeNull();
    expect(within(janela).getByTestId("abastecimento-quantidade")).toHaveValue("60");
    fireEvent.click(within(janela).getByTestId("abastecimento-reabrir-previa"));
    await within(janela).findByTestId("abastecimento-revisao");
    await act(async () => {
      fireEvent.click(within(janela).getByTestId("abastecimento-confirmar"));
    });
    // O aviso é o toast do app: nada de banner "Foi anotado em…" na tela.
    await waitFor(() => expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", expect.stringMatching(/^Abastecimento de .+ registrado\.$/)));
    expect(screen.queryByTestId("registro-confirmado")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Foi anotado em/);
    expect(screen.queryByTestId("janela-abastecimento-area")).toBeNull();
    expect(backend.chamadas.filter((c) => c.method === "POST" && c.path === "/patrimonio-abastecimentos").at(-1)?.body).toMatchObject({ apontamento_id: "ap1", operation_id: expect.any(String) });
  });

  it("LL-ABAST-AREA-2 — sem a permissão de novo abastecimento, o \"Abastecer\" não aparece no ⚡ da máquina nem \"Salvar e abastecer\" na janela", async () => {
    sessao.permissao = comAbastecimento({ novo: false });
    await montar();
    await naArea("a1");
    fireEvent.click(screen.getByTestId("linha-acoes-ml1"));
    expect(within(await screen.findByTestId("linha-acoes-ml1-menu")).getAllByRole("menuitem").map((i) => i.textContent.trim())).toEqual(["Editar", "Cancelar"]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const janela = await abrirJanela("a1", "maquinas");
    expect(within(janela).queryByTestId("janela-tipo-salvar-abastecer")).toBeNull();
  });

  it("LL-ABAST-AREA-3 — \"Salvar e abastecer\" na janela da máquina: grava as horas e a MESMA janela vira o abastecimento dessa máquina, ligado ao lançamento do dia", async () => {
    sessao.permissao = comAbastecimento({ novo: true });
    // O lançamento do dia que a máquina cria (apn1) existe no servidor de abastecimentos.
    abast.apontamentos.apn1 = { data_operacional: HOJE, turno: null, sequencia: 1, atividade: { id: "a1", numero: "3", nome: "Cigarrinha Pasto 01" }, centro_custo: { id: "cc-pasto", nome: "Pastagem" } };
    await montar();
    const janela = await abrirJanela("a1", "maquinas");
    const rodape = within(janela).getByTestId("janela-tipo-rodape-dados");
    expect([...rodape.querySelectorAll("button")].map((b) => b.textContent.trim())).toEqual(["Cancelar", "Salvar", "Salvar e novo", "Salvar e abastecer"]);
    await preencherMaquina(janela, "1558");
    fireEvent.click(within(janela).getByTestId("janela-tipo-salvar-abastecer"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toMatchObject({ method: "POST", path: "/atividades/a1/apontamentos" });
    // Um nível só: a janela da máquina deu lugar à do abastecimento (nada de janela sobre janela).
    const abastecimento = await screen.findByTestId("janela-abastecimento-area");
    expect(screen.queryByTestId("janela-tipo")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const form = within(abastecimento).getByTestId("abastecimento-form");
    expect(within(form).getByTestId("abastecimento-bem")).toHaveTextContent("TP-02");
    await waitFor(() => expect(within(form).getByTestId("abastecimento-local-auto")).toHaveTextContent("Sai do estoque: Tanque diesel sede"));
    fireEvent.change(within(form).getByTestId("abastecimento-quantidade"), { target: { value: "60" } });
    fireEvent.change(within(form).getByTestId("abastecimento-leitura"), { target: { value: "1.600" } });
    await act(async () => {
      fireEvent.click(within(abastecimento).getByTestId("abastecimento-previa"));
    });
    await within(abastecimento).findByTestId("abastecimento-revisao");
    await act(async () => {
      fireEvent.click(within(abastecimento).getByTestId("abastecimento-confirmar"));
    });
    await waitFor(() => expect(screen.queryByTestId("janela-abastecimento-area")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", expect.stringMatching(/^Abastecimento de .+ registrado\.$/));
    // O abastecimento vai preso ao lançamento do dia que a máquina acabou de criar.
    expect(backend.chamadas.filter((c) => c.method === "POST" && c.path === "/patrimonio-abastecimentos").at(-1)?.body).toMatchObject({ apontamento_id: "apn1", bem_id: "b1", operation_id: expect.any(String) });
  });

  it("LL-ABAST-4 — posto externo pelo lançamento: sem local, com o valor da nota; o corpo leva origem, custo_total e apontamento_id", async () => {
    sessao.permissao = comAbastecimento({ novo: true });
    await montar();
    await abrir("a1", "ap1");
    const bloco = await screen.findByTestId("apontamento-ap1-abastecimentos");
    fireEvent.click(await within(bloco).findByTestId("apontamento-ap1-novo-abastecimento"));
    const form = within(await screen.findByTestId("janela-abastecimento-lancamento")).getByTestId("abastecimento-form");
    await escolherNoSeletor(form, "abastecimento-bem", /Trator TP-02/);
    fireEvent.click(within(within(form).getByTestId("abastecimento-origem")).getByRole("radio", { name: "Posto externo" }));
    await waitFor(() => expect(within(form).queryByTestId("abastecimento-local-auto")).toBeNull());
    fireEvent.change(within(form).getByTestId("abastecimento-quantidade"), { target: { value: "50" } });
    fireEvent.change(within(form).getByTestId("abastecimento-leitura"), { target: { value: "1.600" } });
    fireEvent.change(within(form).getByTestId("abastecimento-custo-total"), { target: { value: "310,50" } });
    await act(async () => {
      fireEvent.click(within(form).getByTestId("abastecimento-previa"));
    });
    const previa = await screen.findByTestId("dialogo-previa-abastecimento");
    expect(within(previa).getByTestId("previa-origem")).toHaveTextContent("Posto externo");
    await act(async () => {
      fireEvent.click(within(previa).getByTestId("abastecimento-confirmar"));
    });
    await waitFor(() => expect(screen.queryByTestId("janela-abastecimento-lancamento")).toBeNull());
    const confirmado = backend.chamadas.filter((c) => c.method === "POST" && c.path === "/patrimonio-abastecimentos").at(-1)?.body;
    expect(confirmado).toMatchObject({ origem: "EXTERNO", custo_total: "310.5", apontamento_id: "ap1" });
    expect(confirmado).not.toHaveProperty("local_estoque_id");
    expect(await within(bloco).findByTestId("linha-abastecimento-ab-1-origem")).toHaveTextContent("Posto externo");
  });

  it("LL-ABAST-5 — Cancelar pelo bloco usa o diálogo de cancelamento de sempre (motivo e ciência) e a linha fica Cancelada", async () => {
    await semear();
    sessao.permissao = comAbastecimento({ cancelar: true });
    await montar();
    await abrir("a1", "ap1");
    const bloco = await screen.findByTestId("apontamento-ap1-abastecimentos");
    // Sem `novo`, não há Novo abastecimento.
    expect(within(bloco).queryByTestId("apontamento-ap1-novo-abastecimento")).toBeNull();
    fireEvent.click(await within(bloco).findByTestId("linha-abastecimento-ab-1-cancelar"));
    const dialogo = await screen.findByTestId("dialogo-cancelamento-abastecimento");
    expect(dialogo).toHaveTextContent("nada volta ao estoque");
    fireEvent.change(within(dialogo).getByTestId("cancelamento-motivo"), { target: { value: "Nota em dobro" } });
    fireEvent.click(within(dialogo).getByTestId("cancelamento-ciente"));
    const totaisAntes = leiturasDosTotais("a1");
    await act(async () => {
      fireEvent.click(within(dialogo).getByTestId("cancelamento-enviar"));
    });
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelamento-abastecimento")).toBeNull());
    expect(backend.chamadas.filter((c) => c.method === "POST" && c.path === "/patrimonio-abastecimentos/ab-1/cancelar").at(-1)?.body).toMatchObject({ versao: 1, motivo: "Nota em dobro" });
    await waitFor(() => expect(within(bloco).getByTestId("linha-abastecimento-ab-1")).toHaveAttribute("data-status", "CANCELADO"));
    expect(within(bloco).queryByTestId("linha-abastecimento-ab-1-cancelar")).toBeNull();
    await waitFor(() => expect(leiturasDosTotais("a1")).toBeGreaterThan(totaisAntes));
  });

  it("LL-ABAST-6 — atividade concluída: o bloco fica só para consulta (nem Novo nem Cancelar)", async () => {
    abast.apontamentos.ap5 = { data_operacional: "2026-11-12", turno: "MANHA", sequencia: 1, atividade: { id: "a3", numero: "1", nome: "Aplicação concluída" } };
    await semearAbastecimento(abast, { bem_id: "b1", tanque_id: "tq1", produto_id: "p1", local_estoque_id: "l1", apontamento_id: "ap5", data_operacional: "2026-11-12", quantidade: "10", medidor_leitura: "1530" });
    sessao.permissao = comAbastecimento({ novo: true, cancelar: true });
    await montar();
    await abrir("a3", "ap5");
    const bloco = await screen.findByTestId("apontamento-ap5-abastecimentos");
    expect(await within(bloco).findByTestId("linha-abastecimento-ab-1")).toBeTruthy();
    expect(within(bloco).queryByTestId("apontamento-ap5-novo-abastecimento")).toBeNull();
    expect(within(bloco).queryByTestId("linha-abastecimento-ab-1-cancelar")).toBeNull();
  });
});

describe("LL-TOTAIS — totalizador com o combustível (Fatia 5)", () => {
  it("LL-TOTAIS-5 — combustível em L e kg à parte e em R$, custo de combustível/ha e o consumo por bem (sem uso ou misturado: sem valor)", async () => {
    totaisExtra = {
      combustivel: { quantidade_l: "120.0000", quantidade_kg: "35.5000", custo_total: "780.0000" },
      custo_combustivel_por_ha: "78.0000",
      consumo_por_bem: [
        { bem: TRATOR, medidor_tipo: "HORIMETRO", uso: "8.0000", quantidade: "120.0000", unidade: "L", metrica: "L_POR_HORA", unidade_metrica: "L/h", valor: "15.0000" },
        { bem: CAMINHAO, medidor_tipo: "ODOMETRO", uso: null, quantidade: "35.5000", unidade: "KG", metrica: "KM_POR_KG", unidade_metrica: "km/kg", valor: null },
        // L e kg no mesmo bem (o servidor zera unidade, quantidade e valor; manda as parcelas).
        { bem: GRADE, medidor_tipo: "HORIMETRO", uso: "4.0000", quantidade: null, unidade: null, quantidade_l: "10.0000", quantidade_kg: "5.0000", metrica: null, unidade_metrica: null, valor: null },
      ],
    };
    await montar();
    await abrir("a1", "ap1");
    const totais = await screen.findByTestId("totalizador-atividade");
    await waitFor(() => expect(within(totais).getByTestId("totalizador-combustivel")).toHaveTextContent("120 L · 35,5 kg · R$ 780,00"));
    expect(within(totais).getByTestId("totalizador-combustivel-ha")).toHaveTextContent("R$ 78,00/ha");
    expect(within(totais).getByTestId("totalizador-consumo-b1-L")).toHaveTextContent("15 L/h · 120 L em 8 h");
    expect(within(totais).getByTestId("totalizador-consumo-b2-KG")).toHaveTextContent("35,5 kg sem uso nas máquinas");
    expect(within(totais).getByTestId("totalizador-consumo-i1")).toHaveTextContent("10 L e 5 kg (litros e quilos não se somam) em 4 h");
    expect(within(totais).getByText("Consumo — TP-02 — Trator")).toBeTruthy();
  });

  it("LL-TOTAIS-6 — servidor sem combustível nos totais: nenhum campo de combustível aparece", async () => {
    await montar();
    await abrir("a1", "ap1");
    const totais = await screen.findByTestId("totalizador-atividade");
    await waitFor(() => expect(within(totais).getByTestId("totalizador-custo")).toHaveTextContent("R$ 525,00"));
    expect(within(totais).queryByTestId("totalizador-combustivel")).toBeNull();
    expect(within(totais).queryByTestId("totalizador-combustivel-ha")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// D-PROD-252 — o lançamento novo abre direto num formulário (um nível de janela) a partir dos botões "+" da tela da área
/** Abre a atividade (a de uma área só cai direto na tela da área) e espera a tabela dos lançamentos. @param {string} id */
const naArea = async (id) => {
  if (!screen.queryByTestId("atividade-aberta")) {
    fireEvent.doubleClick(screen.getByTestId(`atividade-numero-${id}`));
    await screen.findByTestId("atividade-aberta");
  }
  await screen.findByTestId("detalhe-area");
  await waitFor(() => expect(screen.queryByText("Lendo…")).toBeNull());
};
/** O botão "+" do tipo abre a janela do formulário. @param {string} id @param {string} botao */
const abrirJanela = async (id, botao) => {
  await naArea(id);
  fireEvent.click(await screen.findByTestId(`escolher-${botao}`));
  const janela = await screen.findByTestId("janela-tipo");
  await waitFor(() => expect(within(janela).queryByTestId("janela-tipo-carregando")).toBeNull());
  await waitFor(() => expect(janela.querySelector("form")).toBeTruthy());
  return janela;
};
/** Ids das linhas da tabela dos lançamentos da área. */
const linhasDaArea = () =>
  [...screen.getByTestId("area-lancamentos-tabela").querySelectorAll('tbody tr [data-testid$="-tipo"][data-testid^="lancamento-"]')].map((el) => el.getAttribute("data-testid")?.replace(/^lancamento-/, "").replace(/-tipo$/, ""));
/** A linha (tr da grade Base1) de um lançamento da área. */
const linhaDoLancamento = (/** @type {string} */ id) => /** @type {HTMLElement} */ (screen.getByTestId(`lancamento-${id}-tipo`).closest("tr"));
/** Os cabeçalhos da grade Base1, sem a caixa de seleção. */
const cabecalhosDaGrade = (/** @type {HTMLElement} */ tabela) => [...tabela.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim()).filter(Boolean);
/** Preenche a máquina (o trator do cabeçalho vem escolhido): espera a leitura inicial sugerida e digita a final. @param {HTMLElement} janela @param {string} final */
const preencherMaquina = async (janela, final) => {
  await waitFor(() => expect(within(janela).getByTestId("linha-maquina-leitura-inicial")).toHaveValue("1.550"));
  fireEvent.change(within(janela).getByTestId("linha-maquina-leitura-final"), { target: { value: final } });
};

describe("LL-JANELA-TIPO — o lançamento novo direto, um nível só (D-PROD-252)", () => {
  it("LL-JANELA-TIPO-1 — + Máquina abre o formulário: título e \"Área · Atividade\", Dia (hoje) e os campos; sem abas, sem dia com setas, sem Área do dia; o primeiro item cria o dia; Salvar e novo deixa o formulário vazio; Salvar fecha", async () => {
    await montar();
    const janela = await abrirJanela("a1", "maquinas");
    expect(janela.querySelector(".mdl-t")).toHaveTextContent("Trabalho de máquinas");
    // Emenda 3: sem subtítulo (a área e a atividade estão no cabeçalho da tela) e o Dia na mesma grade, no grupo "Lançamento".
    expect(within(janela).queryByTestId("janela-tipo-subtitulo")).toBeNull();
    expect(janela.querySelector(".b1-janela__nota")).toBeNull();
    expect(janela).not.toHaveClass("b1-janela--tipo");
    expect(janela.querySelector("form .b1-grupo__titulo")).toHaveTextContent("Lançamento");
    expect(janela.querySelector("form")).toContainElement(within(janela).getByTestId("janela-tipo-data"));
    expect(within(janela).getByTestId("janela-tipo-data")).toHaveValue(HOJE);
    // Um nível só: nada das abas, das setas do dia, da Área do dia, do lançamento do dia nem de outro diálogo.
    for (const t of ["janela-tipo-aba-lista", "janela-tipo-aba-dados", "janela-tipo-dia-anterior", "janela-tipo-dia-seguinte", "janela-tipo-area-nova", "janela-tipo-area-dia", "janela-tipo-inserir", "janela-tipo-dia-novo"]) {
      expect(within(janela).queryByTestId(t)).toBeNull();
    }
    expect(within(janela).queryByRole("tablist")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const rodape = within(janela).getByTestId("janela-tipo-rodape-dados");
    expect([...rodape.querySelectorAll("button")].map((b) => b.textContent.trim())).toEqual(["Cancelar", "Salvar", "Salvar e novo"]);
    await preencherMaquina(janela, "1558");
    expect(backend.chamadas.find((c) => c.path === "/atividades-opcoes/medidor")?.query).toMatchObject({ bem_id: "b1", data: HOJE });
    expect(within(janela).getByTestId("linha-maquina-uso")).toHaveTextContent("8 h");
    fireEvent.click(within(janela).getByTestId("janela-tipo-salvar-novo"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({
      method: "POST",
      path: "/atividades/a1/apontamentos",
      query: {},
      body: {
        empresa_id: "emp-1",
        data_operacional: HOJE,
        maquinas: [{ bem_id: "b1", sem_medidor: false, leitura_inicial: "1550", leitura_final: "1558" }],
        operation_id: expect.stringMatching(/^lanc-/),
      },
    });
    expect(ultimaEscrita().body).not.toHaveProperty("area_executada_dia");
    await waitFor(() => expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Máquina TP-02 — Trator lançada (8 h)."));
    // Salvar e novo: a janela continua, com o formulário vazio para o próximo item.
    await waitFor(() => expect(within(janela).getByTestId("linha-maquina-leitura-final")).toHaveValue(""));
    // A linha já aparece na tabela da área, atrás da janela (o lançamento novo é o apn1; a linha dele, ml-n2).
    await waitFor(() => expect(linhasDaArea()).toContain("ml-n2"));
    expect(within(linhaDoLancamento("ml-n2")).getByTestId("lancamento-ml-n2-quantidade")).toHaveTextContent("8 h");
    // O segundo item do dia vai pela rota da linha, no lançamento criado (com a versão nova).
    await waitFor(() => expect(within(janela).getByTestId("linha-maquina-leitura-inicial")).toHaveValue("1.550"));
    fireEvent.change(within(janela).getByTestId("linha-maquina-leitura-final"), { target: { value: "1560" } });
    fireEvent.click(within(janela).getByTestId("janela-tipo-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(2));
    expect(ultimaEscrita()).toMatchObject({ method: "POST", path: "/atividades/a1/apontamentos/apn1/maquinas", body: { versao: 1, bem_id: "b1", leitura_final: "1560" } });
    // Salvar: a janela fecha.
    await waitFor(() => expect(screen.queryByTestId("janela-tipo")).toBeNull());
  });

  it("LL-JANELA-TIPO-2 — o Dia do formulário: um dia com UM lançamento recebe o item pela rota da linha (versão do dia); a data futura não passa; Cancelar fecha sem gravar", async () => {
    await montar();
    const janela = await abrirJanela("a1", "maquinas");
    // O dia 11 só tem um lançamento CANCELADO: conta como sem lançamento (o item cria o dia).
    const dia = within(janela).getByTestId("janela-tipo-data");
    fireEvent.change(dia, { target: { value: "2026-11-15" } });
    expect(dia).toHaveValue(HOJE);
    fireEvent.change(dia, { target: { value: "2026-11-12" } });
    expect(dia).toHaveValue("2026-11-12");
    await preencherMaquina(janela, "1555");
    fireEvent.click(within(janela).getByTestId("janela-tipo-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({
      method: "POST",
      path: "/atividades/a1/apontamentos/ap1/maquinas",
      query: {},
      body: { empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), bem_id: "b1", sem_medidor: false, leitura_inicial: "1550", leitura_final: "1555" },
    });
    await waitFor(() => expect(screen.queryByTestId("janela-tipo")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Máquina TP-02 — Trator lançada (5 h).");
    // Cancelar fecha sem gravar nada.
    const outra = await abrirJanela("a1", "maquinas");
    fireEvent.click(within(outra).getByTestId("janela-tipo-cancelar"));
    await waitFor(() => expect(screen.queryByTestId("janela-tipo")).toBeNull());
    expect(escritas()).toHaveLength(1);
  });

  it("LL-JANELA-TIPO-3 — dia com mais de um lançamento (passadas): o item entra no mais recente, sem seletor", async () => {
    apontamentosPorAtividade.set("a1", [
      ...(apontamentosPorAtividade.get("a1") ?? []),
      apontamento({ id: "ap2", turno: "TARDE", sequencia: 2, versao: 5, createdAt: "2026-11-12T18:00:00.000Z", maquinas: [] }),
    ]);
    await montar();
    const janela = await abrirJanela("a1", "maquinas");
    fireEvent.change(within(janela).getByTestId("janela-tipo-data"), { target: { value: "2026-11-12" } });
    expect(within(janela).queryByRole("combobox", { name: "Lançamento do dia" })).toBeNull();
    await preencherMaquina(janela, "1556");
    fireEvent.click(within(janela).getByTestId("janela-tipo-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita().path).toBe("/atividades/a1/apontamentos/ap2/maquinas");
  });

  it("LL-JANELA-TIPO-4 — a tabela da área é UMA só: Ações · Tipo · Dia · Item · Quantidade · Valor, uma linha por lançamento (a cancelada não aparece), o implemento no texto da máquina e o total no rodapé", async () => {
    apontamentosPorAtividade.set("a1", [
      apontamento({
        produtos: [linhaProduto({})],
        maquinas: [linhaMaquina({ implemento_bem_id: "i1", implemento: GRADE })],
        mao_obra: [linhaMaoObra({})],
        servicos: [linhaServico({})],
      }),
    ]);
    await montar();
    await naArea("a1");
    const tabela = screen.getByTestId("area-lancamentos-tabela");
    expect(tabela.querySelector("table.mg-grid")).toBeTruthy();
    expect(tabela.closest(".b1-aba-cartao")).toBeNull();
    expect(cabecalhosDaGrade(tabela)).toEqual(["Ações", "Tipo", "Dia", "Item", "Quantidade", "Valor"]);
    expect(linhasDaArea()).toEqual(["ml1", "pl1", "mo1", "sv1"]);
    const celula = (/** @type {string} */ id, /** @type {string} */ c) => within(tabela).getByTestId(`lancamento-${id}-${c}`);
    expect(celula("ml1", "tipo")).toHaveTextContent("Máquina");
    expect(celula("ml1", "dia")).toHaveTextContent("12/11/2026");
    expect(celula("ml1", "item")).toHaveTextContent("TP-02 — Trator com GR-01 — Grade");
    expect(celula("ml1", "quantidade")).toHaveTextContent("8 h");
    expect(celula("ml1", "valor")).toHaveTextContent("R$ 400,00");
    expect(celula("pl1", "tipo")).toHaveTextContent("Insumo");
    expect(celula("pl1", "item")).toHaveTextContent("Glifosato");
    expect(celula("pl1", "quantidade")).toHaveTextContent("25 L");
    expect(celula("pl1", "valor")).toHaveTextContent("R$ 125,00");
    expect(celula("mo1", "item")).toHaveTextContent("José Silva");
    expect(celula("mo1", "valor")).toHaveTextContent("R$ 160,00");
    expect(celula("sv1", "item")).toHaveTextContent("Frete");
    expect(celula("sv1", "valor")).toHaveTextContent("R$ 50,00");
    // Nada de grupo "Implementos" nem de cartões de custo: o implemento é texto da linha da máquina.
    expect(screen.queryByTestId("grupo-implemento")).toBeNull();
    expect(screen.queryByTestId("fluxo-resumo")).toBeNull();
    // O total do rodapé é o do servidor (o mesmo do cabeçalho da área).
    await waitFor(() => expect(within(tabela).getByTestId("area-lancamentos-total-valor")).toHaveTextContent("R$ 735,00"));
    // Um total só: o do rodapé; o cabeçalho da área não repete hectares nem custo.
    expect(screen.queryByTestId("detalhe-area-resumo")).toBeNull();
    expect(screen.getByTestId("detalhe-area-atividade")).toHaveTextContent("Cigarrinha Pasto 01");
    // Os botões "+" do tipo, numa fileira só, e nada de "O que você quer registrar?".
    const botoes = within(screen.getByTestId("escolher-registro")).getAllByRole("button").map((b) => b.textContent.trim());
    expect(botoes).toEqual(["Máquina", "Implemento", "Produto"]);
    expect(screen.queryByText("O que você quer registrar?")).toBeNull();
    expect(screen.queryByTestId("ajustar-dia")).toBeNull();
  });

  it("LL-JANELA-TIPO-5 — o ⚡ da linha: Editar abre a janela de edição de sempre (PATCH com a versão) e Cancelar, o diálogo de sempre (motivo); a tabela se relê", async () => {
    await montar();
    await naArea("a1");
    fireEvent.click(screen.getByTestId("linha-acoes-ml1"));
    let menu = await screen.findByTestId("linha-acoes-ml1-menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent.trim())).toEqual(["Editar", "Cancelar"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Editar" }));
    const edicao = await screen.findByTestId("janela-linha-maquina");
    expect(edicao).toHaveTextContent("Editar máquina TP-02 — Trator");
    fireEvent.change(await within(edicao).findByTestId("linha-maquina-leitura-final"), { target: { value: "1552" } });
    fireEvent.click(within(edicao).getByTestId("janela-linha-maquina-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toMatchObject({ method: "PATCH", path: "/atividades/a1/apontamentos/ap1/maquinas/ml1", body: { versao: 3, leitura_final: "1552" } });
    await waitFor(() => expect(screen.queryByTestId("janela-linha-maquina")).toBeNull());
    // A tabela se relê: a substituta no lugar da editada.
    await waitFor(() => expect(linhasDaArea()).toContain("ml-n1"));
    expect(linhasDaArea()).not.toContain("ml1");
    fireEvent.click(screen.getByTestId("linha-acoes-ml-n1"));
    menu = await screen.findByTestId("linha-acoes-ml-n1-menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Cancelar" }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-linha");
    expect(dialogo).toHaveTextContent("A leitura desta linha deixa de contar como leitura atual do bem.");
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-linha-motivo"), { target: { value: "lançada no dia errado" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-linha-enviar"));
    await waitFor(() => expect(ultimaEscrita().path).toBe("/atividades/a1/apontamentos/ap1/maquinas/ml-n1/cancelar"));
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", versao: 4, operation_id: expect.stringMatching(/^lanc-/), motivo: "lançada no dia errado" });
    await waitFor(() => expect(linhasDaArea()).not.toContain("ml-n1"));
  });

  it("LL-JANELA-TIPO-6 — sem resposta ao criar o dia: \"Repetir o mesmo envio\" reenvia o MESMO corpo com a MESMA chave e o dia não é criado duas vezes", async () => {
    await montar();
    const janela = await abrirJanela("a1", "maquinas");
    await preencherMaquina(janela, "1558");
    perderResposta = true;
    fireEvent.click(within(janela).getByTestId("janela-tipo-salvar"));
    expect(await within(janela).findByTestId("resultado-incerto")).toBeTruthy();
    expect(within(janela).getByTestId("janela-tipo-salvar")).toHaveTextContent("Repetir o mesmo envio");
    fireEvent.click(within(janela).getByTestId("janela-tipo-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(2));
    const [primeiro, segundo] = escritas();
    expect(segundo.body).toEqual(primeiro.body);
    expect((apontamentosPorAtividade.get("a1") ?? []).filter((a) => a.data_operacional === HOJE)).toHaveLength(1);
  });

  it("LL-JANELA-TIPO-7 — mão de obra e custo extra: cada botão abre o seu formulário; o custo extra novo cria o dia com `servicos[]`", async () => {
    await montar();
    await naArea("a4");
    const botoes = within(screen.getByTestId("escolher-registro")).getAllByRole("button").map((b) => b.textContent.trim());
    expect(botoes).toEqual(["Máquina", "Mão de obra", "Serviço"]);
    // A tabela da área traz a mão de obra e o serviço do dia 12.
    expect(linhasDaArea()).toEqual(["mo1", "mo2", "sv1"].filter((id) => linhasDaArea().includes(id)));
    expect(within(linhaDoLancamento("mo1")).getByTestId("lancamento-mo1-item")).toHaveTextContent("José Silva");
    fireEvent.click(screen.getByTestId("escolher-mao-obra"));
    let janela = await screen.findByTestId("janela-tipo");
    expect(janela.querySelector(".mdl-t")).toHaveTextContent("Mão de obra");
    await waitFor(() => expect(janela.querySelector("form")).toBeTruthy());
    fireEvent.click(within(janela).getByTestId("janela-tipo-cancelar"));
    await waitFor(() => expect(screen.queryByTestId("janela-tipo")).toBeNull());

    fireEvent.click(screen.getByTestId("escolher-servicos"));
    janela = await screen.findByTestId("janela-tipo");
    expect(janela.querySelector(".mdl-t")).toHaveTextContent("Custos extras");
    await waitFor(() => expect(janela.querySelector("form")).toBeTruthy());
    await escolherNoSeletor(janela, "linha-servico-servico", /Frete/);
    fireEvent.change(within(janela).getByTestId("linha-servico-quantidade"), { target: { value: "12" } });
    fireEvent.click(within(janela).getByTestId("janela-tipo-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toMatchObject({
      method: "POST",
      path: "/atividades/a4/apontamentos",
      body: { data_operacional: HOJE, servicos: [{ servico_id: "s1", quantidade: "12", valor_unitario: "5" }], operation_id: expect.stringMatching(/^lanc-/) },
    });
    expect(ultimaEscrita().body).not.toHaveProperty("area_executada_dia");
    await waitFor(() => expect(screen.queryByTestId("janela-tipo")).toBeNull());
  });

  it("LL-JANELA-TIPO-8 — só leitura: atividade concluída ou sem a ação de lançar não mostra os botões \"+\" nem o ⚡ das linhas; a janela direta só avisa e fecha", async () => {
    await montar();
    await naArea("a3");
    expect(screen.queryByTestId("escolher-registro")).toBeNull();
    expect(screen.queryByTestId("linha-acoes-pl5")).toBeNull();
    expect(linhasDaArea()).toEqual(["ml5", "pl5"]);
    cleanup();

    sessao.permissao = permissaoCom({ visualizar: true });
    await montar();
    await naArea("a1");
    expect(screen.queryByTestId("escolher-registro")).toBeNull();
    expect(screen.queryByTestId("linha-acoes-ml1")).toBeNull();
    expect(escritas()).toEqual([]);
    cleanup();

    const { default: JanelaLancamentoPorTipo } = await import("@/components/lancamento-atividades/JanelaLancamentoPorTipo");
    const { definirFazendaDaTela } = await import("@/services/lancamentoAtividadesService");
    definirFazendaDaTela("emp-1");
    const flags = { permiteProduto: true, permiteImplemento: true, permiteMaoObra: false, permiteServico: false };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <JanelaLancamentoPorTipo atividade={atividades.get("a3")} tipo="produtos" acoes={{ ver: true, editar: true, lancarApontamento: true, login: "operador" }} flags={flags} escopo="cli-1:operador" onFechar={() => {}} />
      </QueryClientProvider>,
    );
    const janela = await screen.findByTestId("janela-tipo");
    expect(within(janela).getByTestId("janela-tipo-aviso")).toHaveTextContent("Atividade concluída");
    expect(janela.querySelector("form")).toBeNull();
    expect(within(janela).getByTestId("janela-tipo-fechar")).toBeTruthy();
  });

  it("LL-JANELA-TIPO-9 — celular: o lançamento NÃO abre como caixa flutuante — a janela ocupa a tela (b1-janela--tela-cheia, o padrão dos outros lançamentos), a tabela segue tabela com o Valor na frente", async () => {
    vi.stubGlobal("matchMedia", (/** @type {string} */ query) => ({
      matches: query.includes("max-width: 639px") || query.includes("max-width: 767px") || query.includes("max-width: 1023px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <LancamentoAtividades />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("b1-card").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("atividade-acoes-a1"));
    const menu = await screen.findByTestId("atividade-acoes-a1-menu");
    expect(menu.closest(".mk-sheet")).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Abrir atividade" }));
    await screen.findByTestId("atividade-aberta");
    await screen.findByTestId("detalhe-area");
    // No celular a tabela da área continua tabela (rola na horizontal), com o Valor logo depois do Tipo.
    const tabela = screen.getByTestId("area-lancamentos-tabela");
    expect(tabela.querySelector(".mg-grid-wrap")).toBeTruthy();
    expect(cabecalhosDaGrade(tabela)).toEqual(["Ações", "Tipo", "Valor", "Quantidade", "Item", "Dia"]);
    expect(document.querySelector(".b1-tipo-card")).toBeNull();
    fireEvent.click(await screen.findByTestId("escolher-maquinas"));
    const janela = await screen.findByTestId("janela-tipo");
    expect(janela).toHaveAttribute("data-celular");
    expect(janela).toHaveClass("b1-janela__camada--tela-cheia");
    expect(janela.querySelector(".mdlc.b1-janela")).toHaveClass("b1-janela--tela-cheia");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // O ⚡ da linha também abre a edição em tela cheia (a janela de linha de sempre).
    fireEvent.click(within(janela).getByTestId("janela-tipo-cancelar"));
    await waitFor(() => expect(screen.queryByTestId("janela-tipo")).toBeNull());
    fireEvent.click(screen.getByTestId("linha-acoes-ml1"));
    fireEvent.click(within(await screen.findByTestId("linha-acoes-ml1-menu")).getByRole("menuitem", { name: "Editar" }));
    const edicao = await screen.findByTestId("janela-linha-maquina");
    expect(edicao).toHaveClass("b1-janela__camada--tela-cheia");
    expect(edicao.querySelector(".mdlc.b1-janela")).toHaveClass("b1-janela--tela-cheia");
    vi.unstubAllGlobals();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LL-ABERTA — atividade aberta no desenho do protótipo (D-PROD-234)", () => {
  /** Abre a atividade pela grade e espera a tela da área (a de uma área só cai direto nela) com os totais lidos. @param {string} id */
  const abrirAberta = async (id) => {
    fireEvent.doubleClick(screen.getByTestId(`atividade-numero-${id}`));
    await screen.findByTestId("atividade-aberta");
    await screen.findByTestId("detalhe-area");
    await waitFor(() => expect(screen.getByTestId("area-lancamentos-total-valor")).not.toHaveTextContent("…"));
  };

  it("LL-ABERTA-1 — três abas (Lançamentos, Resumo das áreas, Resumo da atividade); sem \"Mais detalhes\", sem o card Resumo de custo nem a tabela por tipo", async () => {
    await montar();
    await abrirAberta("a1");
    // A atividade sem áreas abre direto na tela da área e não tem para onde voltar: as abas ficam (só somem com uma área aberta numa atividade com áreas, no atividadeAreas.test).
    expect([...screen.getAllByRole("tab")].map((t) => t.textContent.trim())).toEqual(["Lançamentos", "Resumo das áreas", "Resumo da atividade"]);
    expect(screen.getByTestId("atividade-aba-lancamentos")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("atividade-painel-lancamentos")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("atividade-painel-areas")).toHaveAttribute("hidden");
    expect(screen.getByTestId("atividade-painel-resumo")).toHaveAttribute("hidden");
    for (const t of ["atividade-mais-detalhes-toggle", "atividade-resumo-custo", "atividade-tipos", "atividade-lancamentos-tipos", "tipo-maquinas-acoes", "ajustar-dia"]) {
      expect(screen.queryByTestId(t)).toBeNull();
    }
    // O cabeçalho da área: só a área e a atividade (sem repetir hectares e custo, que ficam na tabela).
    expect(screen.getByTestId("detalhe-area-nome")).toHaveTextContent("01 — Pasto 01");
    expect(screen.queryByTestId("detalhe-area-resumo")).toBeNull();
    // Uma tabela só, com o total do servidor.
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByTestId("area-lancamentos-total-valor")).toHaveTextContent("R$ 525,00");
  });

  it("LL-ABERTA-2 — abastecimento é uma linha da tabela (dia, máquina, litros, valor) e o diesel entra no total e no cabeçalho do servidor", async () => {
    await semearAbastecimento(abast, {
      bem_id: "b1", tanque_id: "tq1", produto_id: "p1", origem: "EXTERNO", custo_total: "200", apontamento_id: "ap1",
      data_operacional: "2026-11-12", quantidade: "40", medidor_leitura: "1550.5", tanque_cheio: true,
    });
    const base = permissaoCom(TODAS);
    sessao.permissao = {
      ...base,
      modulos_permitidos: [...base.modulos_permitidos, "patrimonio"],
      permissoes_telas: [...base.permissoes_telas, { modulo_id: "patrimonio", tela_id: "pat-abastecimentos", visualizar: true, novo: true, salvar: false, editar: false, excluir: false, importar: false, exportar: false }],
    };
    totaisExtra = {
      custo_total: "725.0000",
      custo_por_ha: "72.5000",
      custo_por_tipo: { maquinas: "400.0000", produtos: "125.0000", mao_obra: null, servicos: null, combustivel: "200.0000" },
    };
    await montar();
    await abrirAberta("a1");
    const linha = await waitFor(() => linhaDoLancamento("abastecimento-ab-1"));
    expect(within(linha).getByTestId("lancamento-abastecimento-ab-1-tipo")).toHaveTextContent("Abastecimento");
    expect(within(linha).getByTestId("lancamento-abastecimento-ab-1-dia")).toHaveTextContent("12/11/2026");
    expect(within(linha).getByTestId("lancamento-abastecimento-ab-1-item")).toHaveTextContent("TP-02");
    expect(within(linha).getByTestId("lancamento-abastecimento-ab-1-quantidade")).toHaveTextContent("40 L");
    expect(within(linha).getByTestId("lancamento-abastecimento-ab-1-valor")).toHaveTextContent("R$ 200,00");
    expect(screen.getByTestId("area-lancamentos-total-valor")).toHaveTextContent("R$ 725,00");
    // O abastecimento não tem ⚡ aqui (cancela-se na tela Abastecimentos).
    expect(screen.queryByTestId("linha-acoes-abastecimento-ab-1")).toBeNull();
  });

  it("LL-ABERTA-3 — o tipo da atividade decide os botões \"+\": APLICAÇÃO tem máquina, implemento e produto; COLHEITA MANUAL, máquina, mão de obra e serviço", async () => {
    await montar();
    await abrirAberta("a1");
    const botoes = () => within(screen.getByTestId("escolher-registro")).getAllByRole("button").map((b) => b.textContent.trim());
    expect(botoes()).toEqual(["Máquina", "Implemento", "Produto"]);
    // COLHEITA MANUAL (t3): pela navegação do registro.
    fireEvent.click(screen.getByRole("button", { name: "Próximo registro" }));
    await waitFor(() => expect(screen.queryByTestId("escolher-produtos")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Primeiro registro" }));
    await waitFor(() => expect(screen.getByTestId("escolher-mao-obra")).toBeTruthy());
    expect(botoes()).toEqual(["Máquina", "Mão de obra", "Serviço"]);
  });

  it("LL-ABERTA-4 — o botão \"+ Implemento\" abre o mesmo formulário da máquina (o implemento se escolhe junto) e nada é gravado só por abrir", async () => {
    await montar();
    await abrirAberta("a1");
    fireEvent.click(screen.getByTestId("escolher-implemento"));
    const janela = await screen.findByTestId("janela-tipo");
    expect(janela).toHaveAttribute("data-tipo", "maquinas");
    await waitFor(() => expect(janela.querySelector("form")).toBeTruthy());
    expect(within(janela).getByTestId("linha-maquina-implemento")).toBeTruthy();
    fireEvent.click(within(janela).getByTestId("janela-tipo-cancelar"));
    await waitFor(() => expect(screen.queryByTestId("janela-tipo")).toBeNull());
    expect(escritas()).toHaveLength(0);
  });

  it("LL-ABERTA-5 — só leitura (concluída): sem os botões \"+\"; a tabela continua à vista", async () => {
    await montar();
    await abrirAberta("a3");
    expect(screen.queryByTestId("escolher-registro")).toBeNull();
    expect(linhasDaArea()).toEqual(["ml5", "pl5"]);
    expect(screen.getByTestId("atividade-concluida")).toBeTruthy();
  });

  it("LL-ABERTA-6 — a atividade não mostra \"dias\" (emenda da D-PROD-252): sem \"Dias lançados\", \"Ajustar um dia\" nem \"Área do dia\" em nenhuma das três abas; cada linha lançada tem a data dela", async () => {
    await montar();
    await abrirAberta("a1");
    const aberta = within(screen.getByTestId("atividade-aberta"));
    for (const aba of ["atividade-aba-lancamentos", "atividade-aba-areas", "atividade-aba-resumo"]) {
      fireEvent.click(screen.getByTestId(aba));
      expect(screen.queryByTestId("atividade-dias")).toBeNull();
      expect(screen.queryByTestId("atividade-dias-toggle")).toBeNull();
      expect(aberta.queryByText(/Dias lançados/i)).toBeNull();
      expect(aberta.queryByText(/Ajustar um dia/i)).toBeNull();
      expect(aberta.queryByText(/Área do dia/i)).toBeNull();
    }
    fireEvent.click(screen.getByTestId("atividade-aba-lancamentos"));
    expect(within(screen.getByTestId("area-lancamentos-tabela")).getByTestId("lancamento-ml1-dia")).toHaveTextContent("12/11/2026");
  });

  it("LL-ABERTA-7 — Resumo da atividade: totais com o detalhe por item e os dados da atividade, só leitura", async () => {
    await montar();
    await abrirAberta("a4");
    fireEvent.click(screen.getByTestId("atividade-aba-resumo"));
    const painel = screen.getByTestId("atividade-painel-resumo");
    expect(painel).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("atividade-painel-lancamentos")).toHaveAttribute("hidden");
    const totais = within(painel).getByTestId("totalizador-atividade");
    expect(totais).not.toHaveClass("sticky");
    // Emenda 2: um detalhe só (sem cartões empilhados) e os itens numa tabela Base1 (Tipo, Item, Quantidade, Custo).
    expect(painel.querySelector(".b1-aba-cartao")).toBeNull();
    const itens = within(totais).getByTestId("totalizador-itens");
    expect(itens.querySelector("table.mg-grid")).toBeTruthy();
    expect(cabecalhosDaGrade(itens)).toEqual(["Tipo", "Item", "Quantidade", "Custo"]);
    await waitFor(() => {
      expect(within(totais).getByTestId("totalizador-mao-obra-f1-FUNCIONARIO-HORA")).toHaveTextContent("8 h");
      expect(within(totais).getByTestId("totalizador-mao-obra-f1-FUNCIONARIO-HORA-custo")).toHaveTextContent("R$ 160,00");
    });
    expect(within(totais).getByText("Frete")).toBeTruthy();
    const cab = within(painel).getByTestId("atividade-cabecalho");
    expect(cab).toHaveAttribute("data-somente-leitura");
    expect(within(cab).getByDisplayValue("Colheita Talhão 04")).toBeTruthy();
    // ← → trocam de aba pelo teclado (a ordem: Lançamentos, Resumo das áreas, Resumo da atividade).
    fireEvent.keyDown(screen.getByTestId("atividade-aba-resumo"), { key: "ArrowLeft" });
    expect(screen.getByTestId("atividade-aba-areas")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByTestId("atividade-aba-areas"), { key: "ArrowLeft" });
    expect(screen.getByTestId("atividade-aba-lancamentos")).toHaveAttribute("aria-selected", "true");
  });

  it("LL-ABERTA-8 — navegação ‹‹ ‹ n/N › ›› na linha das abas, na ordem da lista (Nº, maior primeiro)", async () => {
    await montar();
    await abrirAberta("a1");
    const nav = within(screen.getByTestId("atividade-aberta")).getByTestId("cadastro-record-nav");
    expect(nav).toHaveTextContent("2/4");
    fireEvent.click(within(nav).getByRole("button", { name: "Próximo registro" }));
    await waitFor(() => expect(backend.chamadas.some((c) => c.method === "GET" && c.path === "/atividades/a2")).toBe(true));
    await waitFor(() => expect(within(screen.getByTestId("atividade-aberta")).getByTestId("cadastro-record-nav")).toHaveTextContent("3/4"));
    fireEvent.click(screen.getByRole("button", { name: "Último registro" }));
    await waitFor(() => expect(within(screen.getByTestId("atividade-aberta")).getByTestId("cadastro-record-nav")).toHaveTextContent("4/4"));
    await waitFor(() => expect(screen.getByTestId("atividade-concluida")).toBeTruthy());
  });

  it("LL-ABERTA-9 — a lista traz a coluna Valor total e o ⚡ mostra o R$ total no cabeçalho (o custo_total da lista)", async () => {
    atividades.set("a1", { ...atividades.get("a1"), custo_total: "525.0000" });
    atividades.set("a2", { ...atividades.get("a2"), custo_total: null });
    const { ATIVIDADES_COLUNAS, valorDoCampoAtividade, compararAtividadesParaOrdenar } = await import("@/pages/LancamentoAtividades");
    expect(ATIVIDADES_COLUNAS.find((c) => c.id === "valor_total")).toMatchObject({ label: "Custo", default: true, align: "right" });
    expect(valorDoCampoAtividade({ custo_total: "1234.5000" }, "valor_total")).toMatch(/^R\$\s1\.234,50$/);
    expect(valorDoCampoAtividade({ custo_total: null }, "valor_total")).toBe("");
    expect(compararAtividadesParaOrdenar({ custo_total: "9.0000" }, { custo_total: "10.0000" }, "valor_total")).toBeLessThan(0);
    await montar();
    const linha = /** @type {HTMLElement} */ (screen.getByTestId("atividade-numero-a1").closest("tr"));
    expect(within(linha).getByText(/R\$\s525,00/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("atividade-acoes-a1"));
    expect(await screen.findByTestId("atividade-acoes-a1-menu")).toHaveTextContent("APLICAÇÃO · 01 — Pasto 01 · R$ 525,00");
    fireEvent.keyDown(screen.getByTestId("atividade-acoes-a1-menu"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("atividade-acoes-a2"));
    expect(await screen.findByTestId("atividade-acoes-a2-menu")).not.toHaveTextContent("R$");
  });

  it("LL-ABERTA-10 — celular: a cabeça com ✕, nome, status, \"Nº · área\" e Concluir; a tabela da área segue tabela; Concluir abre o resumo; ✕ volta à lista", async () => {
    vi.stubGlobal("matchMedia", (/** @type {string} */ query) => ({
      matches: query.includes("max-width: 639px") || query.includes("max-width: 767px") || query.includes("max-width: 1023px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <LancamentoAtividades />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("b1-card").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("atividade-acoes-a1"));
    fireEvent.click(within(await screen.findByTestId("atividade-acoes-a1-menu")).getByRole("menuitem", { name: "Abrir atividade" }));
    const cabeca = await screen.findByTestId("atividade-cabeca-celular");
    expect(cabeca).toHaveTextContent("Cigarrinha Pasto 01");
    expect(within(cabeca).getByTestId("atividade-cabeca-status")).toHaveTextContent("Em andamento");
    expect(cabeca).toHaveTextContent("Nº 3 · 10 / 40 ha");
    // O Concluir sai da barra e fica na cabeça (no canto de cima).
    expect(screen.queryByTestId("atividade-concluir")).toBeNull();
    // A tabela da área segue tabela (sem cartões) e a navegação fica no rodapé da casca, não nas abas.
    expect((await screen.findByTestId("area-lancamentos-tabela")).querySelector("table.mg-grid")).toBeTruthy();
    expect(document.querySelector(".b1-tipo-card")).toBeNull();
    expect(within(screen.getByTestId("atividade-aberta")).queryByTestId("cadastro-record-nav")).toBeNull();
    fireEvent.click(within(cabeca).getByTestId("atividade-concluir-celular"));
    expect(await screen.findByTestId("dialogo-concluir-atividade")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("dialogo-concluir-atividade")).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.queryByTestId("dialogo-concluir-atividade")).toBeNull());
    fireEvent.click(within(cabeca).getByTestId("atividade-fechar-celular"));
    await waitFor(() => expect(screen.queryByTestId("atividade-aberta")).toBeNull());
    vi.unstubAllGlobals();
  });

  it("LL-ABERTA-11 — regras puras: resumo do tipo, valor do tipo e o resumo de custo sem totais (\"—\", nada inventado)", async () => {
    const LR = await import("@/lib/atividadeLinhasRegras");
    const m = (/** @type {any} */ x) => ({ status: "CONFIRMADO", ...x });
    expect(LR.resumoDoTipoNaAtividade("maquinas", [m({ quantidade_uso: "5.0000", medidor_tipo: "HORIMETRO", medidor_unidade: "h" }), m({ quantidade_uso: "120.0000", medidor_tipo: "ODOMETRO", medidor_unidade: "km" })], { combustivel: { quantidade_l: "43.0000" } })).toBe("5 h · 120 km · 43 L");
    expect(LR.resumoDoTipoNaAtividade("produtos", [m({ produto: { nome: "NPK" } }), m({ produto: { nome: "Ureia" } }), m({ produto: { nome: "NPK" } })])).toBe("NPK (+1)");
    expect(LR.resumoDoTipoNaAtividade("mao-obra", [m({ parceiro_id: "f1", tipo_medida: "HORA", quantidade: "5.0000" }), m({ parceiro_id: "f2", tipo_medida: "HORA", quantidade: "3.0000" }), m({ parceiro_id: "f2", tipo_medida: "DIARIA", quantidade: "1.0000" })])).toBe("2 pessoas · 8 h · 1 diária(s)");
    expect(LR.resumoDoTipoNaAtividade("servicos", [m({}), m({})])).toBe("2 itens");
    expect(LR.resumoDoTipoNaAtividade("servicos", [])).toBe("");
    // A linha cancelada e o lançamento cancelado ficam fora.
    const aps = [
      { status: "CONFIRMADO", produtos: [m({ id: "x" }), { id: "y", status: "CANCELADO" }], maquinas: [], mao_obra: [], servicos: [] },
      { status: "CANCELADO", produtos: [m({ id: "z" })], maquinas: [], mao_obra: [], servicos: [] },
    ];
    expect(LR.linhasConfirmadasDaAtividade(aps, "produtos").map((l) => l.id)).toEqual(["x"]);
    const t = { custo_por_tipo: { maquinas: null, produtos: "10.0000", mao_obra: null, servicos: null, combustivel: "5.5000" } };
    expect(LR.valorDoTipoNaAtividade("maquinas", t)).toBe("5.5000");
    expect(LR.valorDoTipoNaAtividade("mao-obra", t)).toBeNull();
    expect(LR.valorDoTipoNaAtividade("produtos", null)).toBeNull();
    const semTotais = LR.resumoDeCustoParaExibir({ totais: null, atividade: { area_executada: null, area_planejada: null } });
    expect([semTotais.area, semTotais.feito, semTotais.custo, semTotais.maquinas, semTotais.combustivel, semTotais.combustivelPorHa, semTotais.data, semTotais.safra]).toEqual(["—", "—", "—", "—", "—", "—", "—", "—"]);
  });
});
