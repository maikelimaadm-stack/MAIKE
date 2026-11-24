/**
 * Lançamento de Atividades (D-PROD-200, Fatia 2) — a tela montada de verdade:
 * página, motor Base1, FormularioAtividade, ListaApontamentos,
 * FormularioApontamento, service, API, porta e `nativeHttpClient` reais. Mocks
 * só da borda: `fetch` (um backend falso que responde no formato do §10 do
 * contrato), a sessão (usuário e permissão efetiva), o fuso das empresas e as
 * listas de cadastros vizinhos (tipos, áreas e tarefas, que não são desta
 * missão). Contrato: docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md.
 *
 * Cobre:
 *  - lista com Nº, nome, tipo, área, status (selo) e área executada / planejada;
 *    filtros de status, tipo, área e período sobre o início, todos na query com
 *    o `empresa_id`; período invertido avisa e não lê;
 *  - ações por permissão × status: sem permissão o botão não aparece; concluída
 *    e cancelada não mostram editar nem lançar (na página e nos próprios
 *    componentes); reabrir só com a ação extra; sem o fuso, nada grava;
 *  - trocar de fazenda fecha a atividade e o diálogo, e nada da atividade
 *    anterior é pedido com a fazenda nova;
 *  - atividade aberta: cabeçalho só leitura com os herdados (centro de custo,
 *    centro de resultado, unidade de produção, setor da área) e os apontamentos
 *    por dia (duas passadas no mesmo dia = 1ª e 2ª);
 *  - abrir atividade: os herdados travados, o exigido pelo tipo marcado e
 *    avisado antes de enviar, corpo com `empresa_id`, decimal em texto e sem
 *    centros, unidade nem setor; editar com PATCH mínimo e a `versao`;
 *  - concluir (data), reabrir e cancelar (motivo) e duplicar, com os corpos do §10;
 *  - formulário do apontamento SEM centro, área, setor, safra, unidade e
 *    máquina; alerta fora do intervalo aparece e não bloqueia; "Repetir"
 *    preenche; cancelar pede motivo; decimais em texto;
 *  - recusas ATIVIDADE_* atravessam o transporte (CODIGOS_PRESERVADOS) e chegam
 *    com a mensagem certa; paridade dos códigos com o servidor;
 *  - porta por allowlist, igual ao corpo fechado de cada rota do servidor
 *    (lido da fonte), e service sem fazenda (nada sai);
 *  - rota, menu, ícone, manifesto e a paridade módulo × tela × ações (padrão e
 *    extras) com o servidor; tela Permissões com as quatro ações extras;
 *  - a tela de Tipos de Atividade continua usando `rotuloDoCentro` (movido para
 *    `lancamentoAtividadesRegras.js`) e diz quando há atividades vinculadas.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import * as lucide from "lucide-react";
import { API_FAKE, envelope, erroServidor, escolherOpcao, instalarBackendFake } from "./fixtures/gestaoBackendFake.js";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), ...notify }));

const sessao = vi.hoisted(() => ({
  permissao: /** @type {any} */ (null),
  clienteId: "cli-1",
  /** Fuso da emp-1 (o "hoje" da fazenda); um teste o tira. */
  fuso: /** @type {string|null} */ ("America/Cuiaba"),
}));
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
  listEmpresas: vi.fn(async () => [
    { id: "emp-1", nome: "FAZENDA BOA VISTA", fuso_horario: sessao.fuso },
    { id: "emp-2", nome: "FAZENDA SANTA RITA", fuso_horario: "America/Cuiaba" },
  ]),
}));

// Cadastros vizinhos (fora desta missão): tipos (com flags e padrões), áreas e tarefas.
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

const { default: LancamentoAtividades } = await import("@/pages/LancamentoAtividades");
const { API_ERROR_CODES, ApiError } = await import("@/apis/_core/ApiError.js");

const HOJE = "2026-11-14";
/** 11h em Cuiabá (UTC−4): o "hoje" da fazenda é 14/11/2026. */
const AGORA = new Date("2026-11-14T15:00:00.000Z");
const MODULO = "suporte-mapa";
const TELA = "op-atividades";

// ─── Permissões ─────────────────────────────────────────────────────────
const ACOES_PADRAO = { novo: true, salvar: false, editar: true, excluir: true };
const EXTRAS = { reabrir: true, lancar_apontamento: true, editar_apontamento: true, cancelar_apontamento: true };
/** @param {Record<string, boolean>} acoes */
const linhaDaTela = (acoes = {}) => ({
  modulo_id: MODULO,
  tela_id: TELA,
  visualizar: true,
  novo: false,
  salvar: false,
  editar: false,
  excluir: false,
  importar: false,
  exportar: false,
  ...acoes,
});
/** @param {Record<string, boolean>} acoes */
const permissaoCom = (acoes) => ({ user_email: "operador", is_admin: false, modulos_permitidos: [MODULO], permissoes_telas: [linhaDaTela(acoes)] });

// ─── Dados como o servidor devolve (§10) ────────────────────────────────
const usuario = (/** @type {string} */ id, /** @type {string} */ nome) => ({ id, nome });

/** A atividade ABERTA a1 ("Cigarrinha Pasto 01"), com os herdados gravados (snapshot). */
const ATV_A1 = Object.freeze({
  id: "a1",
  empresa_id: "emp-1",
  numero: "3",
  nome: "Cigarrinha Pasto 01",
  status: "ABERTA",
  versao: 4,
  tipo_atividade_id: "t1",
  tipo_atividade_nome: "APLICAÇÃO",
  grupo_atividade_id: "g1",
  grupo_atividade_nome: "PASTAGEM",
  area_id: "ar1",
  area: { id: "ar1", numero_area: "01", nome: "Pasto 01" },
  setor_id: "s1",
  setor_nome: "SETOR NORTE",
  bem_id: "b1",
  bem: { id: "b1", numero: "2", codigo_frota: "TP-02", nome: "Trator", natureza: "MAQUINA" },
  safra_ciclo: "2026/27",
  centro_custo_id: "cc1",
  centro_custo: { id: "cc1", numero: "1", nome: "Pecuária de corte" },
  centro_resultado_id: "cr1",
  centro_resultado: { id: "cr1", numero: "7", nome: "Recria 2026" },
  unidade_producao_id: "u-sc",
  unidade_producao_sigla: "SC",
  unidade_producao: { id: "u-sc", sigla: "SC", descricao: "Saco" },
  data_inicio: "2026-11-01",
  data_prevista_fim: "2026-11-10",
  data_conclusao: null,
  area_planejada: "40.0000",
  area_executada: "12.5000",
  quantidade_produzida: "30.0000",
  lancamento_tarefa_id: null,
  lancamento_tarefa: null,
  observacao: null,
  concluida_em: null,
  concluida_por: null,
  cancelada_em: null,
  cancelado_por: null,
  motivo_cancelamento: null,
  reaberta_em: null,
  reaberta_por: null,
  motivo_reabertura: null,
  criado_por: usuario("u1", "Gerente"),
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-12T15:00:00.000Z",
  // D-PROD-267: o andamento que a lista do servidor traz (situação, hectares, %, dias).
  andamento: {
    tipo_fixo: "APLICACAO", situacao: "EM_ANDAMENTO", situacao_rotulo: "Em andamento", hectares_feitos: "12.5000", hectares_area: "40.0000", percentual: "31.25",
    primeiro_dia: "2026-11-01", ultimo_dia: "2026-11-12", lancamentos: 2, areas: [],
  },
});
const ATV_A2 = Object.freeze({
  ...ATV_A1,
  id: "a2",
  numero: "2",
  nome: "Roçada Pasto 02",
  status: "CONCLUIDA",
  versao: 7,
  tipo_atividade_id: "t2",
  tipo_atividade_nome: "ROÇADA",
  area_id: "ar2",
  area: { id: "ar2", numero_area: "02", nome: "Pasto 02" },
  setor_nome: "SETOR SUL",
  data_inicio: "2026-11-03",
  data_prevista_fim: null,
  data_conclusao: "2026-11-12",
  concluida_em: "2026-11-12T20:00:00.000Z",
  concluida_por: usuario("u1", "Gerente"),
  area_planejada: null,
  area_executada: "8.0000",
  quantidade_produzida: null,
  createdAt: "2026-10-30T12:00:00.000Z",
  andamento: {
    tipo_fixo: "PASTAGEM", situacao: "CONCLUIDA", situacao_rotulo: "Concluída", hectares_feitos: "8.0000", hectares_area: null, percentual: null,
    primeiro_dia: "2026-11-03", ultimo_dia: "2026-11-12", lancamentos: 1, areas: [],
  },
});
const ATV_A3 = Object.freeze({
  ...ATV_A1,
  id: "a3",
  numero: "1",
  nome: "Cerca do curral",
  status: "CANCELADA",
  versao: 5,
  area_id: null,
  area: null,
  setor_id: null,
  setor_nome: null,
  data_inicio: "2026-10-20",
  data_prevista_fim: null,
  area_planejada: null,
  area_executada: null,
  quantidade_produzida: null,
  cancelada_em: "2026-10-25T13:00:00.000Z",
  cancelado_por: usuario("u1", "Gerente"),
  motivo_cancelamento: "aberta em duplicidade",
  createdAt: "2026-10-20T12:00:00.000Z",
  andamento: {
    tipo_fixo: "APLICACAO", situacao: "CANCELADA", situacao_rotulo: "Cancelada", hectares_feitos: null, hectares_area: null, percentual: null,
    primeiro_dia: null, ultimo_dia: null, lancamentos: 0, areas: [],
  },
});

/** Apontamento como o servidor devolve (§10). */
const apontamento = (/** @type {Record<string, any>} */ extra) => ({
  id: "ap",
  empresa_id: "emp-1",
  atividade_id: "a1",
  data_operacional: "2026-11-12",
  turno: "MANHA",
  sequencia: 1,
  operador_usuario_id: "u9",
  operador: usuario("u9", "João Vaqueiro"),
  area_executada_dia: "10.0000",
  quantidade_produzida_dia: "5.0000",
  observacao: "ok",
  origem: "WEB",
  status: "CONFIRMADO",
  versao: 1,
  cancelado_em: null,
  cancelado_por: null,
  motivo_cancelamento: null,
  criado_por: usuario("u1", "Gerente"),
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
  ...extra,
});
/** Duas passadas no mesmo dia e turno (sequência 1 e 2) e um cancelado no dia seguinte. */
const APONTAMENTOS_A1 = () => [
  apontamento({ id: "ap1" }),
  apontamento({ id: "ap2", sequencia: 2, area_executada_dia: "2.5000", quantidade_produzida_dia: "25.0000", observacao: null, createdAt: "2026-11-12T15:00:00.000Z" }),
  apontamento({
    id: "ap3",
    data_operacional: "2026-11-13",
    turno: null,
    status: "CANCELADO",
    versao: 2,
    cancelado_em: "2026-11-13T12:00:00.000Z",
    cancelado_por: usuario("u2", "Maria"),
    motivo_cancelamento: "lançado em dobro",
    createdAt: "2026-11-13T11:00:00.000Z",
  }),
];

/** Tipos de atividade como `/tipos-atividade` devolve (com as flags e os padrões incluídos). */
const TIPOS = [
  {
    id: "t1",
    nome_tipo: "APLICAÇÃO",
    grupo_atividade_id: "g1",
    grupo_atividade_nome: "PASTAGEM",
    ativo: true,
    exige_area: true,
    exige_safra: false,
    exige_maquina: true,
    exige_producao: true,
    centro_custo_padrao_id: "cc1",
    centro_custo_padrao: { id: "cc1", numero: "1", nome: "Pecuária de corte", empresa_id: "emp-1", ativo: true },
    // Padrão de OUTRA fazenda: a atividade da emp-1 abre sem centro de resultado.
    centro_resultado_padrao_id: "cr9",
    centro_resultado_padrao: { id: "cr9", numero: "9", nome: "Cria", empresa_id: "emp-2", ativo: true },
    unidade_producao_id: "u-sc",
    unidade_producao: { id: "u-sc", sigla: "SC", descricao: "Saco", ativo: true },
  },
  { id: "t2", nome_tipo: "ROÇADA", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true, categoria: "PASTAGEM" },
  { id: "t3", nome_tipo: "GRADAGEM", grupo_atividade_id: "g2", grupo_atividade_nome: "LAVOURA", ativo: false },
];
const AREAS = [
  { id: "ar1", nome: "Pasto 01", numero_area: "01", setor_id: "s1", setor_nome: "SETOR NORTE", empresa_id: "emp-1", ativo: true },
  { id: "ar2", nome: "Pasto 02", numero_area: "02", setor_id: "s2", setor_nome: "SETOR SUL", empresa_id: "emp-1", ativo: true },
];
const BENS = [{ id: "b1", numero: "2", codigo_frota: "TP-02", nome: "Trator", natureza: "MAQUINA" }];
const OPERADORES = [usuario("u9", "João Vaqueiro"), usuario("u8", "Pedro")];

// ─── Backend falso (só a borda de rede) ─────────────────────────────────
/** @type {{ chamadas: Array<{ method: string, path: string, query: Record<string, string>, body: any }> }} */
let backend;
/** @type {Map<string, any>} */
let atividades;
/** @type {Map<string, any[]>} */
let apontamentosPorAtividade;
/** Resposta injetada na PRÓXIMA escrita (não-GET). @type {{ status: number, body?: unknown } | null} */
let proxima;
/** `GET /atividades/:id/totais` (D-PROD-232: o resumo do Concluir); sem entrada, a rota falsa responde 404. @type {Map<string, any>} */
let totaisPorAtividade;

const t4 = (/** @type {number} */ n) => n.toFixed(4);
/** Totais do cabeçalho: soma dos apontamentos CONFIRMADO (nenhum com valor → null). @param {any[]} lista @param {string} campo */
const soma = (lista, campo) => {
  const valores = lista.filter((a) => a.status === "CONFIRMADO" && a[campo] != null).map((a) => Number(a[campo]));
  return valores.length ? t4(valores.reduce((x, y) => x + y, 0)) : null;
};
const recalcular = (/** @type {string} */ id) => {
  const lista = apontamentosPorAtividade.get(id) ?? [];
  const atual = atividades.get(id);
  const nova = {
    ...atual,
    versao: atual.versao + 1,
    area_executada: soma(lista, "area_executada_dia"),
    quantidade_produzida: soma(lista, "quantidade_produzida_dia"),
  };
  atividades.set(id, nova);
  return nova;
};
/** Alerta do §10: o dia fora de [data_inicio, data_prevista_fim] é aceito, com aviso. */
const alertasDe = (/** @type {any} */ atv, /** @type {string} */ dia) =>
  dia < atv.data_inicio || (atv.data_prevista_fim && dia > atv.data_prevista_fim)
    ? [{ codigo: "FORA_DO_INTERVALO", mensagem: "texto do servidor", data_inicio: atv.data_inicio, data_prevista_fim: atv.data_prevista_fim }]
    : [];
/** A sequência é do servidor: máx + 1 por (dia, turno), turno nulo conta como valor. */
const proximaSequencia = (/** @type {any[]} */ lista, /** @type {string} */ dia, /** @type {string|null} */ turno) =>
  Math.max(0, ...lista.filter((a) => a.data_operacional === dia && (a.turno ?? null) === (turno ?? null)).map((a) => a.sequencia)) + 1;
const doCorpo = (/** @type {any} */ v) => (v === undefined ? null : v);
/** O `apontamento` novo a partir do corpo (o servidor guarda os decimais com 4 casas). */
const novoApontamento = (/** @type {string} */ atividadeId, /** @type {any} */ dados, /** @type {number} */ sequencia, /** @type {string} */ id) =>
  apontamento({
    id,
    atividade_id: atividadeId,
    data_operacional: dados.data_operacional ?? HOJE,
    turno: doCorpo(dados.turno),
    sequencia,
    operador_usuario_id: doCorpo(dados.operador_usuario_id),
    operador: OPERADORES.find((o) => o.id === dados.operador_usuario_id) ?? null,
    area_executada_dia: dados.area_executada_dia != null ? t4(Number(dados.area_executada_dia)) : null,
    quantidade_produzida_dia: dados.quantidade_produzida_dia != null ? t4(Number(dados.quantidade_produzida_dia)) : null,
    observacao: doCorpo(dados.observacao),
    createdAt: AGORA.toISOString(),
  });
let proximoId = 0;

const rotear = async (/** @type {{ method: string, path: string, query: URLSearchParams, body: any }} */ { method, path, query, body }) => {
  if (proxima && method !== "GET") {
    const r = proxima;
    proxima = null;
    return r;
  }
  const partes = path.split("/").filter(Boolean);
  if (partes[0] === "atividades-opcoes" && method === "GET") {
    const itens = partes[1] === "bens" ? BENS : partes[1] === "operadores" ? OPERADORES : [];
    return { status: 200, body: { itens, has_more: false, next_cursor: null } };
  }
  // D-PROD-254: o resumo da área (o destino do registro) e o registro de campo (um POST só).
  if (partes[0] === "atividades-por-area" && method === "GET") return { status: 200, body: { area_id: partes[1], mes: "2026-11", atividades: [], custos: null } };
  if (partes[0] === "atividades" && partes[1] === "registrar" && method === "POST") {
    proximoId += 1;
    return { status: 201, body: { apontamento: { id: `apr${proximoId}`, data_operacional: body.data_operacional }, atividade: { id: `ar${proximoId}` }, alertas: [], registro: { atividade_criada: true, atividade_id: `ar${proximoId}` }, replay: false } };
  }
  if (partes[0] !== "atividades") return undefined;
  if (partes.length === 1 && method === "GET") {
    const f = (/** @type {string} */ k) => query.get(k);
    const itens = [...atividades.values()]
      .filter((a) => a.empresa_id === f("empresa_id"))
      .filter((a) => !f("status") || a.status === f("status"))
      // D-PROD-267: a Situação e o tipo fixo, como o servidor.
      .filter((a) => !f("situacao") || a.andamento?.situacao === f("situacao"))
      .filter((a) => !f("tipo_fixo") || a.andamento?.tipo_fixo === f("tipo_fixo"))
      .filter((a) => !f("tipo_atividade_id") || a.tipo_atividade_id === f("tipo_atividade_id"))
      .filter((a) => !f("area_id") || a.area_id === f("area_id"))
      .filter((a) => !f("data_de") || a.data_inicio >= /** @type {string} */ (f("data_de")))
      .filter((a) => !f("data_ate") || a.data_inicio <= /** @type {string} */ (f("data_ate")))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { status: 200, body: envelope(itens) };
  }
  if (partes.length === 1 && method === "POST") {
    proximoId += 1;
    const tipo = TIPOS.find((t) => t.id === body.tipo_atividade_id);
    // D-PROD-249: a abertura nova manda `areas[]` (a 1ª é a área do cabeçalho, como no servidor).
    const area = AREAS.find((a) => a.id === (body.area_id ?? body.areas?.[0]?.area_id)) ?? null;
    const nova = {
      ...ATV_A1,
      id: `n${proximoId}`,
      numero: String(8 + proximoId),
      nome: body.nome,
      versao: 1,
      tipo_atividade_id: tipo.id,
      tipo_atividade_nome: tipo.nome_tipo,
      area_id: area?.id ?? null,
      area: area ? { id: area.id, numero_area: area.numero_area, nome: area.nome } : null,
      setor_id: area?.setor_id ?? null,
      setor_nome: area?.setor_nome ?? null,
      bem_id: body.bem_id ?? null,
      bem: BENS.find((b) => b.id === body.bem_id) ?? null,
      safra_ciclo: body.safra_ciclo ?? null,
      centro_resultado_id: null,
      centro_resultado: null,
      data_inicio: body.data_inicio ?? HOJE,
      data_prevista_fim: body.data_prevista_fim ?? null,
      area_planejada: body.area_planejada != null ? t4(Number(body.area_planejada)) : null,
      area_executada: null,
      quantidade_produzida: null,
      createdAt: AGORA.toISOString(),
      totais: { apontamentos_confirmados: 0, apontamentos_cancelados: 0, dias_com_apontamento: 0 },
    };
    atividades.set(nova.id, nova);
    apontamentosPorAtividade.set(nova.id, []);
    return { status: 201, body: nova };
  }
  const id = partes[1];
  const atv = atividades.get(id);
  if (!atv) return erroServidor(404, "ATIVIDADE_NOT_FOUND");
  if (partes.length === 2 && method === "GET") return { status: 200, body: atv };
  if (partes.length === 2 && method === "PATCH") {
    const { versao: _versao, ...dados } = body;
    const nova = { ...atv, ...dados, versao: atv.versao + 1 };
    atividades.set(id, nova);
    return { status: 200, body: nova };
  }
  if (partes.length === 3 && method === "POST" && partes[2] !== "apontamentos") {
    const acao = partes[2];
    /** @type {Record<string, any>} */
    let mudanca = {};
    if (acao === "concluir") mudanca = { status: "CONCLUIDA", data_conclusao: body.data_conclusao ?? HOJE, concluida_em: AGORA.toISOString(), concluida_por: usuario("u1", "Gerente") };
    if (acao === "reabrir") {
      mudanca = { status: "ABERTA", data_conclusao: null, concluida_em: null, concluida_por: null, reaberta_em: AGORA.toISOString(), reaberta_por: usuario("u1", "Gerente"), motivo_reabertura: body.motivo };
    }
    if (acao === "cancelar") {
      mudanca = { status: "CANCELADA", cancelada_em: AGORA.toISOString(), cancelado_por: usuario("u1", "Gerente"), motivo_cancelamento: body.motivo };
      // O cancelamento propaga para os apontamentos confirmados (mesmo motivo, dia e usuário).
      apontamentosPorAtividade.set(
        id,
        (apontamentosPorAtividade.get(id) ?? []).map((a) =>
          a.status === "CONFIRMADO" ? { ...a, status: "CANCELADO", versao: a.versao + 1, cancelado_em: AGORA.toISOString(), cancelado_por: usuario("u1", "Gerente"), motivo_cancelamento: body.motivo } : a,
        ),
      );
    }
    if (acao === "duplicar") {
      proximoId += 1;
      const copia = { ...atv, id: `n${proximoId}`, numero: String(8 + proximoId), status: "ABERTA", versao: 1, data_inicio: HOJE, area_executada: null, quantidade_produzida: null, createdAt: AGORA.toISOString() };
      atividades.set(copia.id, copia);
      apontamentosPorAtividade.set(copia.id, []);
      return { status: 201, body: copia };
    }
    const nova = { ...atv, ...mudanca, versao: atv.versao + 1 };
    atividades.set(id, nova);
    return { status: 200, body: nova };
  }
  if (partes.length === 3 && partes[2] === "totais" && method === "GET") {
    const t = totaisPorAtividade.get(id);
    return t ? { status: 200, body: t } : undefined;
  }
  if (partes[2] !== "apontamentos") return undefined;
  const lista = apontamentosPorAtividade.get(id) ?? [];
  if (partes.length === 3 && method === "GET") return { status: 200, body: { items: lista } };
  if (partes.length === 3 && method === "POST") {
    const dia = body.data_operacional;
    proximoId += 1;
    const ap = novoApontamento(id, body, proximaSequencia(lista, dia, body.turno ?? null), `apn${proximoId}`);
    apontamentosPorAtividade.set(id, [...lista, ap]);
    return { status: 201, body: { apontamento: ap, atividade: recalcular(id), alertas: alertasDe(atv, dia) } };
  }
  const apId = partes[3];
  const ap = lista.find((a) => a.id === apId);
  if (!ap) return erroServidor(404, "ATIVIDADE_APONTAMENTO_NOT_FOUND");
  if (partes.length === 4 && method === "PATCH") {
    const { versao: _versao, ...dados } = body;
    const novo = { ...ap, ...dados, versao: ap.versao + 1 };
    apontamentosPorAtividade.set(id, lista.map((a) => (a.id === apId ? novo : a)));
    return { status: 200, body: { apontamento: novo, atividade: recalcular(id), alertas: [] } };
  }
  if (partes.length === 5 && method === "POST" && partes[4] === "cancelar") {
    const novo = { ...ap, status: "CANCELADO", versao: ap.versao + 1, cancelado_em: AGORA.toISOString(), cancelado_por: usuario("u1", "Gerente"), motivo_cancelamento: body.motivo };
    apontamentosPorAtividade.set(id, lista.map((a) => (a.id === apId ? novo : a)));
    return { status: 200, body: { apontamento: novo, atividade: recalcular(id), alertas: [] } };
  }
  if (partes.length === 5 && method === "POST" && partes[4] === "duplicar") {
    const dia = body.data_operacional ?? HOJE;
    proximoId += 1;
    const copia = { ...ap, id: `apn${proximoId}`, data_operacional: dia, sequencia: proximaSequencia(lista, dia, ap.turno), versao: 1, createdAt: AGORA.toISOString() };
    apontamentosPorAtividade.set(id, [...lista, copia]);
    return { status: 201, body: { apontamento: copia, atividade: recalcular(id), alertas: alertasDe(atv, dia) } };
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
  sessao.permissao = permissaoCom({ ...ACOES_PADRAO, ...EXTRAS });
  sessao.fuso = "America/Cuiaba";
  proxima = null;
  totaisPorAtividade = new Map();
  proximoId = 0;
  atividades = new Map([ATV_A1, ATV_A2, ATV_A3].map((a) => [a.id, { ...a }]));
  apontamentosPorAtividade = new Map([
    ["a1", APONTAMENTOS_A1()],
    ["a2", [apontamento({ id: "ap7", atividade_id: "a2", area_executada_dia: "8.0000", quantidade_produzida_dia: null })]],
    ["a3", []],
  ]);
  tiposSrv.listarTiposAtividade.mockResolvedValue(TIPOS);
  mapaSrv.listarAreasAtivas.mockImplementation(async (empresaId) => AREAS.filter((a) => a.empresa_id === empresaId));
  tarefasSrv.listarTarefasDaEmpresa.mockResolvedValue([]);
  backend = instalarBackendFake(rotear);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────
const novoCliente = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const montar = async () => {
  render(
    <QueryClientProvider client={novoCliente()}>
      <LancamentoAtividades />
    </QueryClientProvider>,
  );
};
/** Monta a tela e espera a lista da fazenda. */
const montarComLista = async () => {
  await montar();
  await screen.findByTestId("atividade-numero-a1");
};
const listagens = () => backend.chamadas.filter((c) => c.method === "GET" && c.path === "/atividades");
const escritas = () => backend.chamadas.filter((c) => c.method !== "GET");
const ultimaEscrita = () => escritas().at(-1);
/** Deixa as consultas responderem dentro do `act`. */
const assentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
/** Rótulos dos campos, na ordem do DOM (sem o asterisco do obrigatório). @param {HTMLElement} raiz */
const rotulos = (raiz) => [...raiz.querySelectorAll(".mg-field__label")].map((el) => el.textContent.replace(/\s*\*\s*$/, "").trim());
/** O campo está marcado como obrigatório (o " *" do rótulo)? @param {HTMLElement} raiz @param {string} rotulo */
const marcadoObrigatorio = (raiz, rotulo) => {
  const label = [...raiz.querySelectorAll(".mg-field__label")].find((el) => el.textContent.replace(/\s*\*\s*$/, "").trim() === rotulo);
  expect(label, `campo ${rotulo} ausente`).toBeTruthy();
  return Boolean(/** @type {HTMLElement} */ (label).querySelector(".req"));
};
const escolherNoCombo = async (/** @type {HTMLElement} */ raiz, /** @type {string} */ rotulo, /** @type {RegExp|string} */ opcao) => {
  fireEvent.click(within(raiz).getByRole("combobox", { name: rotulo }));
  fireEvent.click(await screen.findByRole("option", { name: opcao }));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
};
const escolherNoSeletor = async (/** @type {HTMLElement} */ raiz, /** @type {string} */ testId, /** @type {RegExp|string} */ nome) => {
  await waitFor(() => expect(within(raiz).getByTestId(testId)).not.toBeDisabled());
  fireEvent.click(within(raiz).getByTestId(testId));
  fireEvent.click(await screen.findByRole("option", { name: nome }));
  await waitFor(() => expect(screen.queryByTestId(`${testId}-painel`)).toBeNull());
};
/** Seleciona a linha (um clique; o duplo abre). @param {string} id */
const selecionar = (id) => fireEvent.click(/** @type {HTMLElement} */ (screen.getByTestId(`atividade-numero-${id}`).closest('[data-testid="b1-row"]')));
/** Abre a atividade (duplo clique na linha), abre a aba "Resumo da atividade" e espera o cabeçalho e os lançamentos. @param {string} id */
const abrir = async (id) => {
  fireEvent.doubleClick(screen.getByTestId(`atividade-numero-${id}`));
  await screen.findByTestId("atividade-aberta");
  fireEvent.click(screen.getByTestId("atividade-aba-resumo"));
  const cabecalho = await screen.findByTestId("atividade-cabecalho");
  await waitFor(() => expect(screen.queryByTestId("apontamentos-carregando")).toBeNull());
  return cabecalho;
};
/** Os itens do menu Mais opções (abre, lê e fecha). */
const itensDoMenu = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));
  const nomes = (await screen.findAllByRole("menuitem")).map((i) => i.textContent.trim());
  fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));
  await waitFor(() => expect(screen.queryAllByRole("menuitem")).toHaveLength(0));
  return nomes;
};
const ACOES_DA_ATIVIDADE = ["Finalizar atividade", "Reabrir atividade", "Cancelar atividade", "Duplicar atividade"];
/** Só as ações da atividade que o menu oferece. */
const acoesDoMenu = async () => (await itensDoMenu()).filter((n) => ACOES_DA_ATIVIDADE.includes(n));
const escolherNoMenu = async (/** @type {string} */ nome) => {
  fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: nome }));
};
/** Botão Editar da barra (o das linhas de lançamento não tem `title`). */
const botaoEditarDaBarra = () => screen.queryByTitle("Editar");

// ═════════════════════════════════════════════════════════════════════════
describe("LA-LISTA — lista, filtros e ações por permissão e status", () => {
  it("LA-LISTA-1 — lista da fazenda (D-PROD-267, o modelo do dono): Nº, Tipo, Operação, Área, Data, Situação e Custo; empresa_id na query", async () => {
    await montarComLista();
    const { ATIVIDADES_COLUNAS } = await import("@/pages/LancamentoAtividades");
    expect(ATIVIDADES_COLUNAS.filter((c) => c.default).map((c) => c.label)).toEqual([
      "Nº",
      "Tipo",
      "Operação",
      "Área",
      "Data",
      "Situação",
      // D-PROD-251: o custo total, com o nome do campo.
      "Custo",
    ]);
    // O que saiu do padrão continua como coluna opcional (Mais opções → colunas).
    expect(ATIVIDADES_COLUNAS.filter((c) => !c.default).map((c) => c.label)).toEqual(expect.arrayContaining(["Nome", "Área executada / planejada", "Início"]));
    // Só a empresa e a página vão na query (nenhum filtro ligado).
    expect(listagens()[0].query.empresa_id).toBe("emp-1");
    expect(Object.keys(listagens()[0].query).sort()).toEqual(["empresa_id", "limit"]);
    const linha = (/** @type {string} */ id) => /** @type {HTMLElement} */ (screen.getByTestId(`atividade-numero-${id}`).closest("tr"));
    expect(screen.getByTestId("atividade-status-a1")).toHaveTextContent(/^Em andamento/);
    expect(screen.getByTestId("atividade-status-a2")).toHaveTextContent(/^Finalizada$/);
    expect(screen.getByTestId("atividade-status-a3")).toHaveTextContent(/^Cancelada$/);
    // Tipo (o tipo fixo, em negrito), Operação (o tipo de atividade gravado), Área e Data ("01/11 –" em aberto).
    expect(within(linha("a1")).getByText("Aplicação").tagName).toBe("STRONG");
    expect(within(linha("a1")).getByText("APLICAÇÃO")).toBeTruthy();
    expect(within(linha("a1")).getByText("Pasto 01")).toBeTruthy();
    expect(within(linha("a1")).getByText("01/11 –")).toBeTruthy();
    expect(within(linha("a2")).getByText("Roçada e tratos")).toBeTruthy();
    expect(within(linha("a2")).getByText("03/11 a 12/11")).toBeTruthy();
    expect(within(linha("a3")).getByText("20/10")).toBeTruthy();
    // Em andamento: os hectares do servidor ("12,5 de 40 ha (31%) · último dia 12/11"), a barra e os dois botões.
    expect(screen.getByTestId("servico-andamento-a1")).toHaveTextContent("12,5 de 40 ha (31%) · último dia 12/11");
    expect(within(linha("a1")).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "31");
    expect(within(linha("a1")).getByRole("button", { name: "Lançamento" })).toBeTruthy();
    // D-PROD-281: no topo, "Atividades em andamento" com o card da a1 (só a em andamento) e os dois botões.
    const bloco = screen.getByTestId("atividades-em-andamento");
    expect(bloco).toHaveTextContent("Atividades em andamento (1)");
    expect(within(screen.getByTestId("em-andamento-a1")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Lançamento", "Finalizar"]);
    expect(within(linha("a1")).getByRole("button", { name: "Finalizar" })).toBeTruthy();
    for (const id of ["a2", "a3"]) {
      expect(within(linha(id)).queryByRole("button", { name: "Lançamento" })).toBeNull();
      expect(within(linha(id)).queryByRole("button", { name: "Finalizar" })).toBeNull();
    }
    // Sem subtítulo explicativo sobre a lista (emenda da D-PROD-252).
    expect(screen.queryByTestId("atividades-intro")).toBeNull();
    expect(screen.queryByText(/Trabalhos da fazenda/)).toBeNull();
    expect(screen.queryByText(/separado daqui/)).toBeNull();
  });

  it("LA-LISTA-2 — filtros de situação, tipo (ou operação), área e período (pílulas da faixa) vão na query; período invertido avisa e não lê", async () => {
    await montarComLista();
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por situação" }), "Finalizada");
    await waitFor(() => expect(listagens().at(-1).query.situacao).toBe("CONCLUIDA"));
    expect(listagens().at(-1).query.status).toBeUndefined();
    await waitFor(() => expect(screen.queryByTestId("atividade-numero-a1")).toBeNull());
    expect(screen.getByTestId("atividade-numero-a2")).toBeTruthy();
    // Volta para todas e filtra pela operação (dentro do tipo) e pela área (os cadastros da fazenda), pelas pílulas.
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por situação" }), "Todas as situações");
    expect(screen.queryByTestId("atividades-filtros")).toBeNull();
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por tipo" }), /^Roçada e tratos › ROÇADA$/i);
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", tipo_atividade_id: "t2", limit: expect.any(String) }));
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por área" }), /02 — Pasto 02/i);
    await waitFor(() => expect(listagens().at(-1).query).toMatchObject({ tipo_atividade_id: "t2", area_id: "ar2" }));
    expect(await screen.findByTestId("atividade-numero-a2")).toBeTruthy();
    // O filtro de tipo oferece também a operação inativa (marcada), para achar as atividades antigas dela.
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por tipo" }));
    expect(await screen.findByRole("option", { name: /GRADAGEM \(INATIVO\)/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por tipo" }));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));

    // Período invertido: avisa, o ✓ não aplica e nada é lido com ele.
    const antes = listagens().length;
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por início" }));
    fireEvent.change(await screen.findByTestId("atividades-filtro-inicio-de"), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByTestId("atividades-filtro-inicio-ate"), { target: { value: "2026-11-01" } });
    expect(await screen.findByTestId("atividades-filtro-inicio-invertido")).toHaveTextContent("A data final do período é anterior à inicial.");
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await assentar();
    expect(listagens().filter((c) => c.query.data_ate === "2026-11-01")).toEqual([]);
    expect(listagens().length).toBe(antes);
    fireEvent.change(screen.getByTestId("atividades-filtro-inicio-ate"), { target: { value: "2026-11-30" } });
    expect(screen.queryByTestId("atividades-filtro-inicio-invertido")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(listagens().at(-1).query).toMatchObject({ empresa_id: "emp-1", data_de: "2026-11-10", data_ate: "2026-11-30" }));
    await waitFor(() => expect(screen.queryByTestId("atividades-filtro-inicio-de")).toBeNull());
  });

  it("LA-LISTA-3 — sem fazenda real ou sem permissão de ver: aviso, nada lido e nenhum botão de gravar", async () => {
    // O `clienteId` do JWT não é fazenda (o Layout chega a gravá-lo como fallback).
    window.localStorage.setItem("empresa_selecionada_id", "cli-1");
    await montar();
    expect(await screen.findByTestId("atividades-sem-empresa")).toHaveTextContent("Selecione uma fazenda");
    await assentar();
    expect(listagens()).toEqual([]);
    // D-PROD-267: "Planejar" (o planejar de antes, "Nova atividade") e "Nova realização".
    expect(screen.queryByRole("button", { name: "Planejar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nova atividade" })).toBeNull();
    cleanup();

    window.localStorage.setItem("empresa_selecionada_id", "emp-1");
    sessao.permissao = { user_email: "operador", is_admin: false, modulos_permitidos: [MODULO], permissoes_telas: [] };
    await montar();
    expect(await screen.findByTestId("atividades-sem-permissao")).toBeTruthy();
    await assentar();
    expect(listagens()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Planejar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nova atividade" })).toBeNull();
  });

  it("LA-LISTA-4 — só ver: nenhuma ação de gravar (sem Abrir atividade, Editar, concluir, reabrir, cancelar nem duplicar)", async () => {
    sessao.permissao = permissaoCom({});
    await montarComLista();
    expect(screen.queryByRole("button", { name: "Planejar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nova atividade" })).toBeNull();
    // Sem gravar, a linha em andamento não oferece "+ Lançar dia" nem "Concluir".
    expect(within(/** @type {HTMLElement} */ (screen.getByTestId("atividade-status-a1"))).queryAllByRole("button")).toEqual([]);
    // D-PROD-281: o card de "Atividades em andamento" segue a mesma permissão (só ver = sem botões).
    expect(within(screen.getByTestId("em-andamento-a1")).queryAllByRole("button")).toEqual([]);
    selecionar("a1");
    expect(botaoEditarDaBarra()).toBeNull();
    expect(await acoesDoMenu()).toEqual([]);
  });

  it("LA-LISTA-5 — ações padrão sem as extras: aberta = concluir, cancelar e duplicar; concluída e cancelada = só duplicar (reabrir pede a extra)", async () => {
    sessao.permissao = permissaoCom(ACOES_PADRAO);
    await montarComLista();
    expect(screen.getByRole("button", { name: "Planejar" })).toBeTruthy();
    // Sem a extra de lançar: "Concluir" na linha em andamento, sem "+ Lançar dia".
    expect(within(screen.getByTestId("em-andamento-a1")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Finalizar"]);
    expect(within(/** @type {HTMLElement} */ (screen.getByTestId("atividade-status-a1"))).getAllByRole("button").map((b) => b.textContent)).toEqual(["Finalizar"]);
    selecionar("a1");
    await waitFor(() => expect(botaoEditarDaBarra()).toBeTruthy());
    expect(await acoesDoMenu()).toEqual(["Finalizar atividade", "Cancelar atividade", "Duplicar atividade"]);
    selecionar("a2");
    await waitFor(() => expect(botaoEditarDaBarra()).toBeNull());
    expect(await acoesDoMenu()).toEqual(["Duplicar atividade"]);
    selecionar("a3");
    expect(botaoEditarDaBarra()).toBeNull();
    expect(await acoesDoMenu()).toEqual(["Duplicar atividade"]);
  });

  it("LA-LISTA-6 — com a extra reabrir, a concluída oferece Reabrir; sem editar/excluir, a aberta não oferece concluir nem cancelar", async () => {
    sessao.permissao = permissaoCom({ reabrir: true });
    await montarComLista();
    selecionar("a2");
    expect(await acoesDoMenu()).toEqual(["Reabrir atividade"]);
    selecionar("a1");
    expect(await acoesDoMenu()).toEqual([]);
    expect(botaoEditarDaBarra()).toBeNull();
  });

  it("LA-LISTA-7 — sem o fuso da fazenda: aviso e nenhuma gravação (o servidor recusaria sem o \"hoje\")", async () => {
    sessao.fuso = null;
    await montarComLista();
    expect(await screen.findByTestId("atividades-sem-fuso")).toHaveTextContent("Configure o fuso horário da fazenda");
    expect(screen.queryByRole("button", { name: "Planejar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nova atividade" })).toBeNull();
    expect(within(/** @type {HTMLElement} */ (screen.getByTestId("atividade-status-a1"))).queryAllByRole("button")).toEqual([]);
    selecionar("a1");
    expect(botaoEditarDaBarra()).toBeNull();
    expect(await acoesDoMenu()).toEqual([]);
    // Aberta: os lançamentos aparecem, mas sem nenhum botão de escrita.
    await abrir("a1");
    await screen.findByTestId("apontamento-ap1");
    expect(botaoEditarDaBarra()).toBeNull();
    for (const id of ["apontamento-novo", "apontamento-ap1-editar", "apontamento-ap1-cancelar", "apontamento-ap1-repetir"]) expect(screen.queryByTestId(id), id).toBeNull();
    expect(escritas()).toEqual([]);
  });

  it("LA-LISTA-8 — trocar de fazenda fecha a atividade aberta e o diálogo, e relê a lista com a fazenda nova; o detalhe nunca vai com ela", async () => {
    atividades.set("b9", { ...ATV_A1, id: "b9", empresa_id: "emp-2", numero: "1", nome: "Atividade da Santa Rita" });
    apontamentosPorAtividade.set("b9", []);
    await montarComLista();
    await abrir("a1");
    await escolherNoMenu("Cancelar atividade");
    await screen.findByTestId("dialogo-cancelar-atividade");
    const { persistirEmpresaSelecionada } = await import("@/hooks/useEmpresaSelecionadaId");
    act(() => persistirEmpresaSelecionada("emp-2", "cli-1"));
    expect(await screen.findByTestId("atividade-numero-b9")).toBeTruthy();
    expect(screen.queryByTestId("dialogo-cancelar-atividade")).toBeNull();
    expect(screen.queryByTestId("atividade-cabecalho")).toBeNull();
    expect(screen.queryByTestId("atividade-numero-a1")).toBeNull();
    expect(listagens().at(-1).query.empresa_id).toBe("emp-2");
    // Nem o detalhe nem os lançamentos da atividade anterior são pedidos com a fazenda nova.
    const daAnterior = backend.chamadas.filter((c) => c.path.startsWith("/atividades/a1"));
    // (o totalizador da Fatia 3 também foi lido com a fazenda da atividade, nunca com a nova)
    expect(daAnterior.map((c) => c.path).sort()).toEqual(["/atividades/a1", "/atividades/a1/apontamentos", "/atividades/a1/totais"]);
    expect(daAnterior.every((c) => c.query.empresa_id === "emp-1")).toBe(true);
    expect(escritas()).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LA-ABERTA — atividade aberta: cabeçalho travado e lançamentos por dia", () => {
  it("LA-ABERTA-1 — cabeçalho só leitura com os herdados (centros e unidade do tipo, setor da área); leituras com empresa_id na query", async () => {
    await montarComLista();
    const cabecalho = await abrir("a1");
    const valor = (/** @type {string} */ rotulo) => /** @type {HTMLInputElement} */ (within(cabecalho).getByLabelText(rotulo)).value;
    expect(valor("Nome")).toBe("Cigarrinha Pasto 01");
    expect(valor("Tipo de atividade")).toBe("APLICAÇÃO");
    // D-PROD-258: o Grupo saiu das telas de atividade.
    expect(within(cabecalho).queryByLabelText("Grupo de atividade")).toBeNull();
    expect(valor("Área")).toBe("01 — Pasto 01");
    expect(valor("Setor (da área)")).toBe("SETOR NORTE");
    expect(valor("Máquina")).toBe("TP-02 — Trator");
    expect(valor("Safra")).toBe("2026/27");
    expect(valor("Centro de custo")).toBe("1 — Pecuária de corte");
    expect(valor("Centro de resultado")).toBe("7 — Recria 2026");
    expect(valor("Unidade de produção")).toBe("SC — Saco");
    // Tudo travado: nenhum campo editável, nenhum seletor.
    for (const campo of cabecalho.querySelectorAll("input, textarea")) expect(campo, campo.outerHTML).toHaveAttribute("readonly");
    expect(within(cabecalho).queryAllByRole("combobox")).toEqual([]);
    expect(cabecalho).toHaveAttribute("data-somente-leitura");
    expect(screen.getByTestId("atividade-status")).toHaveTextContent("Aberta");
    expect(screen.getByTestId("atividade-area-executada-planejada")).toHaveTextContent("12,5 / 40");
    expect(screen.getByTestId("atividade-producao")).toHaveTextContent("30 SC");
    expect(screen.getByTestId("atividade-data-inicio")).toHaveValue("2026-11-01");
    // Detalhe e lançamentos pedidos com a fazenda na query.
    expect(backend.chamadas.find((c) => c.path === "/atividades/a1")?.query).toEqual({ empresa_id: "emp-1" });
    expect(backend.chamadas.find((c) => c.path === "/atividades/a1/apontamentos")?.query).toEqual({ empresa_id: "emp-1" });
    // Editar e lançar disponíveis na aberta (com a permissão).
    expect(botaoEditarDaBarra()).toBeTruthy();
    expect(screen.getByTestId("apontamento-novo")).toBeTruthy();
  });

  it("LA-ABERTA-2 — duas passadas no mesmo dia aparecem como 1ª e 2ª; o cancelado continua visível; o dia mais recente primeiro", async () => {
    await montarComLista();
    await abrir("a1");
    const dia13 = await screen.findByTestId("apontamentos-dia-2026-11-13");
    const dia12 = screen.getByTestId("apontamentos-dia-2026-11-12");
    expect(dia13.compareDocumentPosition(dia12) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dia12).toHaveTextContent("12/11/2026 · 2 lançamentos");
    expect(screen.getByTestId("apontamento-ap1-passada")).toHaveTextContent("Manhã · 1ª passada");
    expect(screen.getByTestId("apontamento-ap2-passada")).toHaveTextContent("Manhã · 2ª passada");
    expect(screen.getByTestId("apontamento-ap1-operador")).toHaveTextContent("João Vaqueiro");
    expect(screen.getByTestId("apontamento-ap1-area")).toHaveTextContent("10 ha");
    expect(screen.getByTestId("apontamento-ap2-producao")).toHaveTextContent("25 SC");
    expect(screen.getByTestId("apontamento-ap3-passada")).toHaveTextContent("Sem turno · 1ª passada");
    expect(screen.getByTestId("apontamento-ap3")).toHaveAttribute("data-status", "CANCELADO");
    expect(screen.getByTestId("apontamento-ap3-status")).toHaveTextContent("Cancelado");
    expect(screen.getByTestId("apontamento-ap3-cancelamento")).toHaveTextContent("por Maria · motivo: lançado em dobro");
    // Só o confirmado tem botões.
    expect(screen.queryByTestId("apontamento-ap3-editar")).toBeNull();
    expect(screen.getByTestId("apontamento-ap1-editar")).toBeTruthy();
  });

  it("LA-ABERTA-3 — concluída: sem Editar, sem lançar/editar/cancelar lançamento, só leitura com aviso; reabrir não aparece sem a extra", async () => {
    sessao.permissao = permissaoCom({ ...ACOES_PADRAO, lancar_apontamento: true, editar_apontamento: true, cancelar_apontamento: true });
    await montarComLista();
    await abrir("a2");
    expect(screen.getByTestId("atividade-concluida")).toHaveTextContent("Atividade finalizada em 12/11/2026 por Gerente");
    expect(screen.getByTestId("apontamentos-aviso")).toHaveTextContent("Atividade concluída");
    await screen.findByTestId("apontamento-ap7");
    expect(botaoEditarDaBarra()).toBeNull();
    for (const id of ["apontamento-novo", "apontamento-repetir-ultimo", "apontamento-ap7-editar", "apontamento-ap7-cancelar", "apontamento-ap7-repetir"]) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
    expect(await acoesDoMenu()).toEqual(["Duplicar atividade"]);
  });

  it("LA-ABERTA-4 — cancelada: só leitura com o motivo; nenhum botão de lançamento; só duplicar", async () => {
    await montarComLista();
    await abrir("a3");
    expect(screen.getByTestId("atividade-cancelada")).toHaveTextContent("Motivo: aberta em duplicidade");
    expect(screen.getByTestId("apontamentos-aviso")).toHaveTextContent("Atividade cancelada");
    expect(botaoEditarDaBarra()).toBeNull();
    expect(screen.queryByTestId("apontamento-novo")).toBeNull();
    expect(await acoesDoMenu()).toEqual(["Duplicar atividade"]);
  });

  it("LA-ABERTA-5 — sem as ações extras do lançamento, a atividade aberta não mostra Novo, Repetir, Editar nem Cancelar", async () => {
    sessao.permissao = permissaoCom(ACOES_PADRAO);
    await montarComLista();
    await abrir("a1");
    await screen.findByTestId("apontamento-ap1");
    expect(botaoEditarDaBarra()).toBeTruthy();
    for (const id of ["apontamento-novo", "apontamento-repetir-ultimo", "apontamento-ap1-editar", "apontamento-ap1-cancelar", "apontamento-ap1-repetir"]) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
    cleanup();
    // Só a de lançar: Novo e Repetir, sem Editar nem Cancelar.
    sessao.permissao = permissaoCom({ ...ACOES_PADRAO, lancar_apontamento: true });
    await montarComLista();
    await abrir("a1");
    await screen.findByTestId("apontamento-ap1-repetir");
    expect(screen.getByTestId("apontamento-novo")).toBeTruthy();
    expect(screen.queryByTestId("apontamento-ap1-editar")).toBeNull();
    expect(screen.queryByTestId("apontamento-ap1-cancelar")).toBeNull();
  });

  it("LA-ABERTA-6 — a regra de status vale nos próprios componentes: concluída com TODAS as ações não tem botão de lançamento nem envio", async () => {
    const { definirFazendaDaTela } = await import("@/services/lancamentoAtividadesService");
    const { default: ListaApontamentos } = await import("@/components/lancamento-atividades/ListaApontamentos");
    const { default: FormularioApontamento } = await import("@/components/lancamento-atividades/FormularioApontamento");
    definirFazendaDaTela("emp-1");
    const todas = { ver: true, lancarApontamento: true, editarApontamento: true, cancelarApontamento: true };
    render(
      <QueryClientProvider client={novoCliente()}>
        <ListaApontamentos atividade={atividades.get("a2")} acoes={todas} onAtividadeAtualizada={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("apontamento-ap7");
    expect(screen.getByTestId("apontamentos-aviso")).toHaveTextContent("Atividade concluída");
    for (const id of ["apontamento-novo", "apontamento-repetir-ultimo", "apontamento-ap7-editar", "apontamento-ap7-cancelar", "apontamento-ap7-repetir"]) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
    cleanup();
    render(
      <QueryClientProvider client={novoCliente()}>
        <FormularioApontamento atividade={atividades.get("a2")} onSalvo={vi.fn()} onCancelar={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("apontamento-aviso")).toHaveTextContent("não está aberta");
    expect(screen.getByTestId("apontamento-salvar")).toBeDisabled();
    fireEvent.submit(screen.getByTestId("b1-form-apontamento"));
    await assentar();
    expect(escritas()).toEqual([]);
    definirFazendaDaTela(null);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LA-ACOES — concluir, reabrir, cancelar e duplicar (corpos do §10)", () => {
  it("LA-ACOES-1 — concluir pede a data (padrão hoje; futura não sai) e manda {empresa_id, versao, data_conclusao}", async () => {
    await montarComLista();
    await abrir("a1");
    // D-PROD-232: na atividade aberta, "Concluir" fica à vista na barra (o Mais opções não repete).
    expect(await acoesDoMenu()).toEqual(["Cancelar atividade", "Duplicar atividade"]);
    fireEvent.click(screen.getByTestId("atividade-concluir"));
    const dialogo = await screen.findByTestId("dialogo-concluir-atividade");
    const data = within(dialogo).getByTestId("dialogo-concluir-atividade-data");
    expect(data).toHaveValue(HOJE);
    expect(data).toHaveAttribute("max", HOJE);
    expect(data).toHaveAttribute("min", "2026-11-01");
    fireEvent.change(data, { target: { value: "2026-11-15" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-concluir-atividade-enviar"));
    expect(await within(dialogo).findByText("A data de conclusão não pode ser futura.")).toBeTruthy();
    expect(escritas()).toEqual([]);
    fireEvent.change(data, { target: { value: "2026-11-12" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-concluir-atividade-enviar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({ method: "POST", path: "/atividades/a1/concluir", query: {}, body: { empresa_id: "emp-1", versao: 4, data_conclusao: "2026-11-12" } });
    await waitFor(() => expect(screen.queryByTestId("dialogo-concluir-atividade")).toBeNull());
    expect(await screen.findByTestId("atividade-concluida")).toHaveTextContent("Atividade finalizada em 12/11/2026");
    expect(screen.getByTestId("atividade-status")).toHaveTextContent("Finalizada");
    // Concluída: o cabeçalho sai da edição e os lançamentos ficam só leitura.
    expect(botaoEditarDaBarra()).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("apontamento-novo")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Atividade nº 3 finalizada.");
  });

  it("LA-ACOES-2 — reabrir (com a extra) pede motivo e manda {empresa_id, versao, motivo}; a reaberta volta a aceitar edição", async () => {
    await montarComLista();
    await abrir("a2");
    await escolherNoMenu("Reabrir atividade");
    const dialogo = await screen.findByTestId("dialogo-reabrir-atividade");
    expect(within(dialogo).getByTestId("dialogo-reabrir-atividade-enviar")).toBeDisabled();
    fireEvent.change(within(dialogo).getByTestId("dialogo-reabrir-atividade-motivo"), { target: { value: "  faltou um talhão  " } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-reabrir-atividade-enviar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toMatchObject({ method: "POST", path: "/atividades/a2/reabrir", body: { empresa_id: "emp-1", versao: 7, motivo: "faltou um talhão" } });
    expect(Object.keys(ultimaEscrita().body).sort()).toEqual(["empresa_id", "motivo", "versao"]);
    // A reabertura fica no histórico: a tela NÃO mostra o aviso "Reaberta em … Motivo: …" (emenda da D-PROD-252).
    await waitFor(() => expect(botaoEditarDaBarra()).toBeTruthy());
    expect(screen.queryByTestId("atividade-reaberta")).toBeNull();
    expect(screen.queryByText(/Reaberta em/)).toBeNull();
    expect(screen.queryByText(/faltou um talhão/)).toBeNull();
    await waitFor(() => expect(screen.getByTestId("apontamento-novo")).toBeTruthy());
  });

  it("LA-ACOES-3 — cancelar pede motivo (curto não sai) e manda {empresa_id, versao, motivo}; os lançamentos confirmados aparecem cancelados", async () => {
    await montarComLista();
    await abrir("a1");
    await escolherNoMenu("Cancelar atividade");
    const dialogo = await screen.findByTestId("dialogo-cancelar-atividade");
    expect(within(dialogo).getByTestId("dialogo-cancelar-atividade-enviar")).toBeDisabled();
    // Motivo com menos de 3 caracteres úteis: o service recusa ANTES da rede.
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-atividade-motivo"), { target: { value: " ab " } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-atividade-enviar"));
    expect(await within(dialogo).findByTestId("erro-envio")).toHaveTextContent("Informe o motivo com pelo menos 3 e no máximo 500 caracteres. Nada foi alterado.");
    expect(escritas()).toEqual([]);
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-atividade-motivo"), { target: { value: "aberta por engano" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-atividade-enviar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({ method: "POST", path: "/atividades/a1/cancelar", query: {}, body: { empresa_id: "emp-1", versao: 4, motivo: "aberta por engano" } });
    expect(await screen.findByTestId("atividade-cancelada")).toHaveTextContent("Motivo: aberta por engano");
    // O cabeçalho mudou (status e versão): a lista de lançamentos é relida e mostra o cancelamento junto.
    await waitFor(() => expect(screen.getByTestId("apontamento-ap1")).toHaveAttribute("data-status", "CANCELADO"));
    expect(screen.getByTestId("apontamento-ap2")).toHaveAttribute("data-status", "CANCELADO");
    expect(screen.queryByTestId("apontamento-novo")).toBeNull();
  });

  it("LA-ACOES-4 — duplicar confirma e manda só {empresa_id}; a cópia aberta aparece", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await montarComLista();
    selecionar("a1");
    fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));
    const item = await screen.findByRole("menuitem", { name: "Duplicar atividade" });
    // A confirmação resolve num microtask depois do clique: o envio segue dentro do `act`.
    await act(async () => {
      fireEvent.click(item);
    });
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(ultimaEscrita()).toEqual({ method: "POST", path: "/atividades/a1/duplicar", query: {}, body: { empresa_id: "emp-1" } });
    const cabecalho = await screen.findByTestId("atividade-cabecalho");
    expect(within(cabecalho).getByTestId("atividade-numero")).toHaveTextContent("9");
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Atividade nº 9 aberta (cópia da nº 3).");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LA-CABECALHO — abrir e editar a atividade (FormularioAtividade)", () => {
  it("LA-CABECALHO-1 — abrir: herdados travados, exigido pelo tipo marcado e avisado antes de enviar; corpo com empresa_id, decimal em texto e sem centros, unidade nem setor", async () => {
    await montarComLista();
    // D-PROD-267: o planejar da barra se chama "Planejar". D-PROD-276: ele pergunta o que planejar (a reforma ou um
    // serviço); "Um serviço" é o planejar de antes.
    fireEvent.click(screen.getByRole("button", { name: "Planejar" }));
    fireEvent.click(await screen.findByTestId("janela-planejar-servico"));
    const form = await screen.findByTestId("b1-form-atividade");
    await waitFor(() => expect(tiposSrv.listarTiposAtividade).toHaveBeenCalled());
    // Só os tipos ativos.
    fireEvent.click(within(form).getByRole("combobox", { name: "Tipo de atividade" }));
    await screen.findAllByRole("option");
    expect(screen.queryByRole("option", { name: /GRADAGEM/i })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /^APLICAÇÃO$/i }));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));

    // Herdados do tipo e da área: travados (só leitura), nunca digitados.
    const campo = (/** @type {string} */ rotulo) => /** @type {HTMLInputElement} */ (within(form).getByLabelText(rotulo));
    for (const rotulo of ["Centro de custo", "Centro de resultado", "Unidade de produção"]) {
      expect(campo(rotulo), rotulo).toHaveAttribute("readonly");
    }
    expect(within(form).queryByLabelText("Grupo de atividade")).toBeNull();
    expect(campo("Centro de custo").value).toBe("1 — Pecuária de corte");
    expect(campo("Centro de resultado").value).toBe("Sem centro de resultado");
    expect(campo("Unidade de produção").value).toBe("SC — Saco");
    expect(screen.getByTestId("atividade-heranca")).toHaveTextContent("O centro de resultado padrão do tipo é de outra fazenda");
    // O exigido pelo tipo (exige_area, exige_maquina) fica marcado; safra não. D-PROD-238: a área é a lista "Áreas".
    expect(within(form).getByTestId("areas-abertura")).toHaveTextContent(/Áreas\s*\*/);
    // D-PROD-258: as 8 chaves (e a nota "Este tipo permite registrar") saíram da tela.
    expect(within(form).queryByTestId("atividade-tipo-registra")).toBeNull();
    expect(marcadoObrigatorio(form, "Máquina")).toBe(true);
    expect(marcadoObrigatorio(form, "Safra")).toBe(false);

    fireEvent.change(within(form).getByLabelText(/^Nome da atividade/), { target: { value: "Cigarrinha Pasto 09" } });
    fireEvent.submit(form);
    expect(await within(form).findByText("O tipo APLICAÇÃO exige ao menos uma área.")).toBeTruthy();
    expect(within(form).getByText("O tipo APLICAÇÃO exige a máquina.")).toBeTruthy();
    expect(escritas()).toEqual([]);

    // D-PROD-238: marcar a área a põe na lista abaixo (Área · Setor · Tamanho · Área planejada · ✕).
    fireEvent.click(within(form).getByTestId("areas-abertura-campo"));
    fireEvent.click(screen.getByTestId("areas-abertura-opcao-ar1"));
    expect(within(form).getByTestId("areas-abertura-linha-ar1")).toHaveTextContent("SETOR NORTE");
    await escolherNoSeletor(form, "atividade-maquina", /TP-02 — Trator/);
    expect(backend.chamadas.find((c) => c.path === "/atividades-opcoes/bens")?.query).toMatchObject({ empresa_id: "emp-1" });
    fireEvent.change(within(form).getByTestId("areas-abertura-planejada-ar1"), { target: { value: "12,5" } });
    fireEvent.submit(form);
    await waitFor(() => expect(escritas()).toHaveLength(1));
    const { method, path, body } = ultimaEscrita();
    expect({ method, path }).toEqual({ method: "POST", path: "/atividades" });
    // O opcional não informado fica AUSENTE (o servidor aplica o padrão); nada herdado vai no corpo.
    expect(body).toEqual({
      empresa_id: "emp-1",
      tipo_atividade_id: "t1",
      nome: "Cigarrinha Pasto 09",
      bem_id: "b1",
      data_inicio: HOJE,
      areas: [{ area_id: "ar1", area_planejada: "12.5" }],
    });
    expect(typeof body.areas[0].area_planejada).toBe("string");
    // A atividade aberta aparece só leitura, com o que o servidor herdou.
    const cabecalho = await screen.findByTestId("atividade-cabecalho");
    expect(within(cabecalho).getByTestId("atividade-numero")).toHaveTextContent("9");
    expect(/** @type {HTMLInputElement} */ (within(cabecalho).getByLabelText("Setor (da área)")).value).toBe("SETOR NORTE");
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Atividade nº 9 aberta.");
  });

  it("LA-CABECALHO-2 — editar (só a aberta): tipo só leitura, PATCH mínimo com a versão; limpar um opcional manda null", async () => {
    await montarComLista();
    await abrir("a1");
    fireEvent.click(/** @type {HTMLElement} */ (botaoEditarDaBarra()));
    const form = await screen.findByTestId("b1-form-atividade");
    expect(within(form).queryByRole("combobox", { name: "Tipo de atividade" })).toBeNull();
    expect(/** @type {HTMLInputElement} */ (within(form).getByLabelText("Tipo de atividade")).value).toBe("APLICAÇÃO");
    expect(/** @type {HTMLInputElement} */ (within(form).getByLabelText("Centro de custo")).value).toBe("1 — Pecuária de corte");
    expect(within(form).getByLabelText("Centro de custo")).toHaveAttribute("readonly");
    expect(within(form).getByTestId("atividade-area-planejada")).toHaveValue("40");
    fireEvent.change(within(form).getByLabelText(/^Nome da atividade/), { target: { value: "Cigarrinha Pasto 01 (norte)" } });
    fireEvent.change(within(form).getByTestId("atividade-area-planejada"), { target: { value: "" } });
    fireEvent.submit(form);
    await waitFor(() => expect(escritas()).toHaveLength(1));
    // §10: o PATCH leva os dados que mudaram e a `versao` (sem empresa_id e sem tipo).
    expect(ultimaEscrita()).toEqual({
      method: "PATCH",
      path: "/atividades/a1",
      query: {},
      body: { versao: 4, nome: "Cigarrinha Pasto 01 (norte)", area_planejada: null },
    });
    const cabecalho = await screen.findByTestId("atividade-cabecalho");
    expect(/** @type {HTMLInputElement} */ (within(cabecalho).getByLabelText("Nome")).value).toBe("Cigarrinha Pasto 01 (norte)");
  });

  it("LA-CABECALHO-3 — recusa ATIVIDADE_REFERENCIA_INVALIDA vai para o campo com a frase do motivo", async () => {
    await montarComLista();
    await abrir("a1");
    fireEvent.click(/** @type {HTMLElement} */ (botaoEditarDaBarra()));
    const form = await screen.findByTestId("b1-form-atividade");
    fireEvent.click(within(form).getByRole("tab", { name: "Onde e com o quê" }));
    await escolherNoCombo(form, "Área", /02 — Pasto 02/i);
    proxima = erroServidor(422, "ATIVIDADE_REFERENCIA_INVALIDA", { field: "area_id", reason: "inativo" });
    fireEvent.submit(form);
    expect(await within(form).findByTestId("atividade-erro")).toHaveTextContent("A área está inativa. Nada foi gravado.");
    expect(within(form).getAllByText("A área está inativa. Nada foi gravado.").length).toBeGreaterThanOrEqual(2);
    expect(ultimaEscrita()).toMatchObject({ method: "PATCH", path: "/atividades/a1", body: { versao: 4, area_id: "ar2" } });
  });

  it("LA-CABECALHO-4 — máquina recusada por natureza (implemento, benfeitoria, outro) mostra a frase própria", async () => {
    await montarComLista();
    await abrir("a1");
    fireEvent.click(/** @type {HTMLElement} */ (botaoEditarDaBarra()));
    const form = await screen.findByTestId("b1-form-atividade");
    fireEvent.click(within(form).getByRole("tab", { name: "Onde e com o quê" }));
    await escolherNoCombo(form, "Área", /02 — Pasto 02/i);
    proxima = erroServidor(422, "ATIVIDADE_REFERENCIA_INVALIDA", { field: "bem_id", reason: "natureza" });
    fireEvent.submit(form);
    expect(await within(form).findByTestId("atividade-erro")).toHaveTextContent(
      "O bem escolhido não é máquina, veículo nem equipamento: escolha uma máquina. Nada foi gravado."
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LA-LANCAMENTO — formulário do apontamento e as escritas", () => {
  it("LA-LANCAMENTO-1 — novo: só os campos do dia (sem centro, área, setor, safra, unidade nem máquina); decimais em texto e empresa_id no corpo; alerta fora do intervalo não bloqueia", async () => {
    await montarComLista();
    await abrir("a1");
    fireEvent.click(screen.getByTestId("apontamento-novo"));
    const form = await screen.findByTestId("b1-form-apontamento");
    expect(rotulos(form)).toEqual(["Data", "Turno", "Operador", "Área do dia (ha)", "Produção do dia (SC)", "Observação"]);
    expect(form.textContent).not.toMatch(/Centro|Setor|Safra|Máquina|Unidade/);
    expect(rotulos(form)).not.toContain("Área");
    // Hoje (14/11) fica fora do período da atividade (01/11 a 10/11): avisa, não bloqueia.
    expect(screen.getByTestId("apontamento-data")).toHaveValue(HOJE);
    expect(screen.getByTestId("apontamento-data")).toHaveAttribute("max", HOJE);
    expect(screen.getByTestId("apontamento-fora-do-periodo")).toHaveTextContent("de 01/11/2026 a 10/11/2026");
    await escolherNoCombo(form, "Turno", /^Manhã$/i);
    await escolherNoSeletor(form, "apontamento-operador", /João Vaqueiro/);
    expect(backend.chamadas.find((c) => c.path === "/atividades-opcoes/operadores")?.query).toMatchObject({ empresa_id: "emp-1" });
    fireEvent.change(screen.getByTestId("apontamento-area-dia"), { target: { value: "2,5" } });
    fireEvent.change(screen.getByTestId("apontamento-producao-dia"), { target: { value: "1.234,5" } });
    fireEvent.change(within(form).getByLabelText(/^Observação/), { target: { value: "talhão norte" } });
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    const { method, path, body } = ultimaEscrita();
    expect({ method, path }).toEqual({ method: "POST", path: "/atividades/a1/apontamentos" });
    expect(body).toEqual({
      empresa_id: "emp-1",
      data_operacional: HOJE,
      turno: "MANHA",
      operador_usuario_id: "u9",
      area_executada_dia: "2.5",
      quantidade_produzida_dia: "1234.5",
      observacao: "talhão norte",
    });
    expect(typeof body.area_executada_dia).toBe("string");
    expect(typeof body.quantidade_produzida_dia).toBe("string");
    // Gravou: a janela fecha, o alerta aparece e o cabeçalho recebe os totais recalculados.
    await waitFor(() => expect(screen.queryByTestId("janela-apontamento")).toBeNull());
    expect(await screen.findByTestId("apontamento-alerta")).toHaveTextContent(
      "14/11/2026: A data do apontamento está fora do período previsto da atividade (de 01/11/2026 a 10/11/2026). O apontamento foi gravado.",
    );
    await waitFor(() => expect(screen.getByTestId("atividade-area-executada-planejada")).toHaveTextContent("15 / 40"));
    expect(await screen.findByTestId("apontamento-apn1-passada")).toHaveTextContent("Manhã · 1ª passada");
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Lançamento de 14/11/2026 gravado (1ª passada).");

    // A segunda passada no mesmo dia e turno: a sequência 2 vem do servidor.
    fireEvent.click(screen.getByTestId("apontamento-novo"));
    const form2 = await screen.findByTestId("b1-form-apontamento");
    await escolherNoCombo(form2, "Turno", /^Manhã$/i);
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(2));
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", data_operacional: HOJE, turno: "MANHA" });
    expect(await screen.findByTestId("apontamento-apn2-passada")).toHaveTextContent("Manhã · 2ª passada");
    expect(screen.getByTestId("apontamentos-dia-2026-11-14")).toHaveTextContent("14/11/2026 · 2 lançamentos");
  });

  it("LA-LANCAMENTO-2 — \"Repetir\" preenche com o lançamento base e a data de hoje; sem ajuste vai o duplicar {empresa_id, data_operacional}; com ajuste, lançamento novo", async () => {
    await montarComLista();
    await abrir("a1");
    fireEvent.click(screen.getByTestId("apontamento-ap1-repetir"));
    const form = await screen.findByTestId("b1-form-apontamento");
    expect(form).toHaveAttribute("data-modo", "repetir");
    expect(screen.getByTestId("janela-apontamento")).toHaveTextContent("Os dados vêm do lançamento de 12/11/2026 (1ª passada)");
    expect(screen.getByTestId("apontamento-data")).toHaveValue(HOJE);
    expect(within(form).getByRole("combobox", { name: "Turno" })).toHaveTextContent(/Manhã/i);
    expect(within(form).getByTestId("apontamento-operador").getAttribute("aria-label")).toMatch(/João Vaqueiro/);
    expect(screen.getByTestId("apontamento-area-dia")).toHaveValue("10");
    expect(screen.getByTestId("apontamento-producao-dia")).toHaveValue("5");
    expect(/** @type {HTMLTextAreaElement} */ (within(form).getByLabelText(/^Observação/)).value).toBe("ok");
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({ method: "POST", path: "/atividades/a1/apontamentos/ap1/duplicar", query: {}, body: { empresa_id: "emp-1", data_operacional: HOJE } });
    await waitFor(() => expect(screen.queryByTestId("janela-apontamento")).toBeNull());

    // "Repetir último" com um ajuste: vai um lançamento novo com os dados ajustados.
    fireEvent.click(await screen.findByTestId("apontamento-repetir-ultimo"));
    const form2 = await screen.findByTestId("b1-form-apontamento");
    fireEvent.change(screen.getByTestId("apontamento-producao-dia"), { target: { value: "6" } });
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(2));
    expect(ultimaEscrita().path).toBe("/atividades/a1/apontamentos");
    expect(ultimaEscrita().body).toEqual({
      empresa_id: "emp-1",
      data_operacional: HOJE,
      turno: "MANHA",
      operador_usuario_id: "u9",
      area_executada_dia: "10",
      quantidade_produzida_dia: "6",
      observacao: "ok",
    });
    expect(form2).toBeTruthy();
  });

  it("LA-LANCAMENTO-3 — editar o lançamento: PATCH mínimo com a versão e o decimal em texto", async () => {
    await montarComLista();
    await abrir("a1");
    fireEvent.click(screen.getByTestId("apontamento-ap1-editar"));
    const form = await screen.findByTestId("b1-form-apontamento");
    expect(form).toHaveAttribute("data-modo", "edicao");
    expect(rotulos(form)).toEqual(["Data", "Turno", "Operador", "Área do dia (ha)", "Produção do dia (SC)", "Observação"]);
    fireEvent.change(screen.getByTestId("apontamento-producao-dia"), { target: { value: "7,5" } });
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({ method: "PATCH", path: "/atividades/a1/apontamentos/ap1", query: {}, body: { versao: 1, quantidade_produzida_dia: "7.5" } });
    await waitFor(() => expect(screen.getByTestId("apontamento-ap1-producao")).toHaveTextContent("7,5 SC"));
  });

  it("LA-LANCAMENTO-4 — cancelar o lançamento pede motivo e manda {empresa_id, versao, motivo}; ele continua na lista, cancelado", async () => {
    await montarComLista();
    await abrir("a1");
    fireEvent.click(screen.getByTestId("apontamento-ap2-cancelar"));
    const dialogo = await screen.findByTestId("dialogo-cancelar-apontamento");
    expect(dialogo).toHaveTextContent("Cancelar lançamento de 12/11/2026 (2ª passada)");
    expect(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar")).toBeDisabled();
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-apontamento-motivo"), { target: { value: "erro de digitação" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({
      method: "POST",
      path: "/atividades/a1/apontamentos/ap2/cancelar",
      query: {},
      body: { empresa_id: "emp-1", versao: 1, motivo: "erro de digitação" },
    });
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-apontamento")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("apontamento-ap2")).toHaveAttribute("data-status", "CANCELADO"));
    // Os totais do cabeçalho deixam de contar o cancelado (10 de 12,5).
    await waitFor(() => expect(screen.getByTestId("atividade-area-executada-planejada")).toHaveTextContent("10 / 40"));
  });

  it("LA-LANCAMENTO-5 — data futura não sai; recusa ATIVIDADE_DATA_INVALIDA do servidor vai para o campo com a frase do motivo", async () => {
    await montarComLista();
    await abrir("a1");
    fireEvent.click(screen.getByTestId("apontamento-novo"));
    await screen.findByTestId("b1-form-apontamento");
    fireEvent.change(screen.getByTestId("apontamento-data"), { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    expect(await screen.findByText(/não pode ser posterior a hoje na fazenda/)).toBeTruthy();
    expect(escritas()).toEqual([]);
    proxima = erroServidor(422, "ATIVIDADE_DATA_INVALIDA", { field: "data_operacional", reason: "futura", details: { hoje: HOJE } });
    fireEvent.change(screen.getByTestId("apontamento-data"), { target: { value: "2026-11-12" } });
    fireEvent.click(screen.getByTestId("apontamento-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    const frase = "A data do apontamento não pode ser futura (hoje na fazenda: 14/11/2026). Nada foi gravado.";
    expect(await screen.findByTestId("apontamento-erro")).toHaveTextContent(frase);
    expect(screen.getAllByText(frase).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("janela-apontamento")).toBeTruthy();
    expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", frase);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LA-ERRO — recusas ATIVIDADE_* com a mensagem certa (CODIGOS_PRESERVADOS)", () => {
  /** Os códigos ATIVIDADE_* do servidor (errorCodes.js), lidos da fonte. */
  const codigosDoServidor = () =>
    [...readFileSync("backend/src/shared/errors/errorCodes.js", "utf8").matchAll(/^\s+(ATIVIDADE_[A-Z_]+):\s*\{\s*\n\s*http:\s*(\d{3})/gm)].map((m) => ({
      code: m[1],
      http: Number(m[2]),
    }));

  it("LA-ERRO-1 — paridade: os 17 ATIVIDADE_* do servidor (9 da Fatia 2 + 5 das linhas, D-PROD-202, + 2 das áreas, D-PROD-249, + o serviço parado, D-PROD-267) estão no catálogo do cliente e no transporte, com mensagem própria", () => {
    const servidor = codigosDoServidor();
    expect(servidor.map((c) => c.code).sort()).toEqual(
      [
        "ATIVIDADE_APONTAMENTO_NOT_FOUND",
        "ATIVIDADE_DATA_INVALIDA",
        "ATIVIDADE_EXIGIDA_PELO_TIPO",
        "ATIVIDADE_MOTIVO_INVALIDO",
        "ATIVIDADE_NOT_FOUND",
        "ATIVIDADE_REFERENCIA_INVALIDA",
        "ATIVIDADE_STATUS_INVALIDO",
        "ATIVIDADE_VERSAO_CONFLITO",
        "ATIVIDADE_VINCULADA",
        // D-PROD-202 — linhas de produto e de máquina.
        "ATIVIDADE_LINHA_NOT_FOUND",
        "ATIVIDADE_LINHA_INVALIDA",
        "ATIVIDADE_SALTO_MEDIDOR",
        "ATIVIDADE_ESTORNO_BLOQUEADO",
        "ATIVIDADE_DATA_COM_LINHAS",
        // D-PROD-249 — várias áreas por atividade.
        "ATIVIDADE_AREA_NOT_FOUND",
        "ATIVIDADE_AREA_COM_LANCAMENTOS",
        // D-PROD-267 — serviço de vários dias: a atividade parada há mais de 30 dias.
        "ATIVIDADE_SERVICO_PARADO",
      ].sort(),
    );
    const cliente = Object.keys(API_ERROR_CODES).filter((c) => c.startsWith("ATIVIDADE_"));
    expect(cliente.sort()).toEqual(servidor.map((c) => c.code).sort());
    const transporte = readFileSync("src/apis/_core/nativeHttpClient.js", "utf8");
    const preservados = transporte.slice(transporte.indexOf("const CODIGOS_PRESERVADOS"), transporte.indexOf("const TRADUCAO_BACKEND_ONLY"));
    for (const { code } of servidor) {
      expect(preservados, `${code} fora de CODIGOS_PRESERVADOS`).toMatch(new RegExp(`\\b${code}: API_ERROR_CODES\\.${code},`));
      expect(new ApiError(code).message, code).not.toBe("Não foi possível concluir a operação.");
    }
    // O apontamento antigo saiu do catálogo e do transporte.
    expect(Object.keys(API_ERROR_CODES).filter((c) => c.startsWith("APONTAMENTO_ATIVIDADE_"))).toEqual([]);
    expect(transporte).not.toMatch(/APONTAMENTO_ATIVIDADE_/);
  });

  it("LA-ERRO-2 — o transporte real preserva cada ATIVIDADE_* (code, field/reason em details) e descarta a mensagem do servidor", async () => {
    const { nativeRequest } = await import("@/apis/_core/nativeHttpClient.js");
    for (const { code, http } of codigosDoServidor()) {
      proxima = erroServidor(http, code, { field: "area_id", reason: "inativo" });
      const erro = await nativeRequest("/atividades/a1/concluir", { method: "POST", body: { empresa_id: "emp-1", versao: 4 }, autenticado: true }, { operation: "completeAtividade", resource: "Atividade" }).catch((e) => e);
      expect(erro.code, code).toBe(code);
      expect(erro.message, code).toBe(new ApiError(code).message);
      expect(erro.message, code).not.toMatch(/texto do servidor/);
      expect(erro.details, code).toMatchObject({ field: "area_id", reason: "inativo", requestId: "req_1" });
    }
  });

  it("LA-ERRO-3 — no diálogo de concluir, ATIVIDADE_EXIGIDA_PELO_TIPO aparece com a mensagem do catálogo (não a genérica) e nada muda", async () => {
    await montarComLista();
    await abrir("a1");
    fireEvent.click(screen.getByTestId("atividade-concluir"));
    const dialogo = await screen.findByTestId("dialogo-concluir-atividade");
    proxima = erroServidor(422, "ATIVIDADE_EXIGIDA_PELO_TIPO", { field: "quantidade_produzida", reason: "exige_producao" });
    fireEvent.click(within(dialogo).getByTestId("dialogo-concluir-atividade-enviar"));
    expect(await within(dialogo).findByTestId("erro-envio")).toHaveTextContent(new ApiError("ATIVIDADE_EXIGIDA_PELO_TIPO").message);
    expect(within(dialogo).getByTestId("erro-envio")).not.toHaveTextContent("Não foi possível concluir a operação.");
    expect(ultimaEscrita()).toMatchObject({ path: "/atividades/a1/concluir", body: { empresa_id: "emp-1", versao: 4, data_conclusao: HOJE } });
    expect(screen.getByTestId("atividade-status")).toHaveTextContent("Aberta");
  });

  it("LA-ERRO-4 — ATIVIDADE_VERSAO_CONFLITO no cancelamento do lançamento: aviso do apontamento e a lista e o cabeçalho relidos", async () => {
    await montarComLista();
    await abrir("a1");
    const leiturasAntes = backend.chamadas.filter((c) => c.method === "GET" && c.path === "/atividades/a1").length;
    fireEvent.click(screen.getByTestId("apontamento-ap1-cancelar"));
    const dialogo = await screen.findByTestId("dialogo-cancelar-apontamento");
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-apontamento-motivo"), { target: { value: "lançado errado" } });
    proxima = erroServidor(409, "ATIVIDADE_VERSAO_CONFLITO", { details: { versao_atual: 2, versao_informada: 1, entidade: "apontamento" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar"));
    await waitFor(() =>
      expect(notify.notifyWarning).toHaveBeenCalledWith(
        "Atenção",
        "Este apontamento foi alterado por outra pessoa desde que você o abriu. Ele será relido: confira e tente de novo. Nada foi gravado.",
      ),
    );
    await waitFor(() => expect(backend.chamadas.filter((c) => c.method === "GET" && c.path === "/atividades/a1").length).toBeGreaterThan(leiturasAntes));
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LA-PORTA — porta por allowlist e service sem fazenda", () => {
  it("LA-PORTA-1 — os corpos levam só as chaves do contrato: nada de cliente_id, setor, centros, unidade, sequência, status ou totais", async () => {
    const { operacoesNativas, montarCaminhoListagem, montarCaminhoOpcoes } = await import("@/apis/atividades/lancamentoAtividadePort.js");
    const sujo = {
      empresa_id: "emp-1",
      tipo_atividade_id: "t1",
      nome: "X",
      area_id: "ar1",
      bem_id: "",
      observacao: "  ",
      area_planejada: "12.5",
      data_operacional: HOJE,
      turno: "MANHA",
      area_executada_dia: "2.5",
      quantidade_produzida_dia: "1",
      origem: "WEB",
      versao: 4,
      motivo: "motivo",
      data_conclusao: HOJE,
      // Fora do contrato (o servidor recusaria com 400):
      cliente_id: "outro-tenant",
      numero: "99",
      status: "CANCELADA",
      sequencia: 7,
      setor_id: "s1",
      setor_nome: "SETOR",
      centro_custo_id: "cc1",
      centro_resultado_id: "cr1",
      unidade_producao_id: "u-sc",
      unidade_producao_sigla: "SC",
      grupo_atividade_id: "g1",
      area_executada: "1",
      quantidade_produzida: "1",
      safra_ciclo_extra: "x",
    };
    const chaves = async (/** @type {() => Promise<unknown>} */ chamar) => {
      await chamar();
      return Object.keys(ultimaEscrita().body).sort();
    };
    expect(await chaves(() => operacoesNativas.create(sujo))).toEqual(["area_id", "area_planejada", "empresa_id", "nome", "tipo_atividade_id"]);
    // Edição: o vazio vira null (limpa o campo); sem empresa nem tipo.
    await operacoesNativas.update("a1", sujo);
    expect(ultimaEscrita().body).toEqual({ versao: 4, nome: "X", area_id: "ar1", bem_id: null, area_planejada: "12.5", observacao: null });
    expect(await chaves(() => operacoesNativas.concluir("a1", sujo))).toEqual(["data_conclusao", "empresa_id", "versao"]);
    expect(await chaves(() => operacoesNativas.reabrir("a1", sujo))).toEqual(["empresa_id", "motivo", "versao"]);
    expect(await chaves(() => operacoesNativas.cancelar("a1", sujo))).toEqual(["empresa_id", "motivo", "versao"]);
    expect(await chaves(() => operacoesNativas.duplicar("a1", sujo))).toEqual(["empresa_id", "nome"]);
    // Apontamento: só os campos do dia (área, safra, centros, unidade e máquina são do cabeçalho).
    expect(await chaves(() => operacoesNativas.createApontamento("a1", sujo))).toEqual([
      "area_executada_dia",
      "data_operacional",
      "empresa_id",
      "origem",
      "quantidade_produzida_dia",
      "turno",
    ]);
    // Na edição a origem não vai: ela é do lançamento e o schema do PATCH a recusa.
    expect(await chaves(() => operacoesNativas.updateApontamento("a1", "ap1", sujo))).toEqual([
      "area_executada_dia",
      "data_operacional",
      "observacao",
      "quantidade_produzida_dia",
      "turno",
      "versao",
    ]);
    expect(await chaves(() => operacoesNativas.cancelarApontamento("a1", "ap1", sujo))).toEqual(["empresa_id", "motivo", "versao"]);
    expect(await chaves(() => operacoesNativas.duplicarApontamento("a1", "ap1", sujo))).toEqual(["data_operacional", "empresa_id"]);
    // Sem DELETE físico.
    expect(operacoesNativas).not.toHaveProperty("delete");
    // Query fechada da lista e das opções.
    expect(montarCaminhoListagem({ empresa_id: "emp-1", status: "ABERTA", data_de: "2026-11-01", q: "x", cliente_id: "y", limit: 100 })).toBe(
      "/atividades?empresa_id=emp-1&status=ABERTA&data_de=2026-11-01&limit=100",
    );
    expect(montarCaminhoOpcoes("operadores", { empresa_id: "emp-1", q: "jo", natureza: "MAQUINA" })).toBe("/atividades-opcoes/operadores?empresa_id=emp-1&q=jo");
  });

  it("LA-PORTA-3 — paridade: cada allowlist da porta é exatamente o corpo fechado da rota do servidor (o PATCH sem a empresa, que lá é opcional)", async () => {
    const porta = await import("@/apis/atividades/lancamentoAtividadePort.js");
    /** Chaves de um `Object.freeze({ chave: SCHEMA, … })` da fonte. @param {string} fonte @param {string} nome */
    const chavesDoBloco = (fonte, nome) => {
      const ini = fonte.indexOf(`const ${nome} = Object.freeze({`);
      expect(ini, `${nome} ausente`).toBeGreaterThan(-1);
      return [...fonte.slice(ini, fonte.indexOf("});", ini)).matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
    };
    /** Chaves do `properties` do corpo de uma rota, com os blocos espalhados (`...CAMPOS`) expandidos. */
    const chavesDoCorpo = (/** @type {string} */ fonte, /** @type {string} */ nome, /** @type {Record<string, string[]>} */ blocos) => {
      const ini = fonte.indexOf(`const ${nome} = {`);
      expect(ini, `${nome} ausente`).toBeGreaterThan(-1);
      const props = fonte.slice(ini, fonte.indexOf("\n};", ini)).match(/properties: \{([^}]*)\}/);
      expect(props, `${nome} sem properties`).toBeTruthy();
      return /** @type {RegExpMatchArray} */ (props)[1]
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .flatMap((p) => (p.startsWith("...") ? blocos[p.slice(3)] : [p.split(":")[0].trim()]))
        .sort();
    };
    const ordenado = (/** @type {readonly string[]} */ l) => [...l].sort();
    const semEmpresa = (/** @type {string[]} */ l) => l.filter((c) => c !== "empresa_id");

    const cabecalho = readFileSync("backend/src/modules/atividades/atividadeRoutes.js", "utf8");
    const campos = { CAMPOS: chavesDoBloco(cabecalho, "CAMPOS") };
    expect(ordenado(campos.CAMPOS)).toEqual(ordenado(porta.CAMPOS_DA_ATIVIDADE));
    expect(chavesDoCorpo(cabecalho, "CRIAR", campos)).toEqual(ordenado(porta.CAMPOS_DE_ABERTURA));
    expect(semEmpresa(chavesDoCorpo(cabecalho, "ATUALIZAR", campos))).toEqual(ordenado(porta.CAMPOS_DE_EDICAO));
    expect(chavesDoCorpo(cabecalho, "CONCLUIR", campos)).toEqual(ordenado(porta.CAMPOS_DE_CONCLUSAO));
    expect(chavesDoCorpo(cabecalho, "COM_MOTIVO", campos)).toEqual(ordenado(porta.CAMPOS_DE_REABERTURA));
    expect(chavesDoCorpo(cabecalho, "COM_MOTIVO", campos)).toEqual(ordenado(porta.CAMPOS_DE_CANCELAMENTO));
    expect(chavesDoCorpo(cabecalho, "DUPLICAR", campos)).toEqual(ordenado(porta.CAMPOS_DE_DUPLICACAO));

    const apontamentos = readFileSync("backend/src/modules/atividades/atividadeApontamentoRoutes.js", "utf8");
    // D-PROD-202: o lançamento e o duplicar aceitam as linhas (`operation_id`, `produtos[]`, `maquinas[]`).
    const doDia = { CAMPOS_DO_DIA: chavesDoBloco(apontamentos, "CAMPOS_DO_DIA"), LINHAS_DO_LANCAMENTO: chavesDoBloco(apontamentos, "LINHAS_DO_LANCAMENTO") };
    expect(chavesDoCorpo(apontamentos, "LANCAR", doDia)).toEqual(ordenado(porta.CAMPOS_DE_CRIACAO_APONTAMENTO));
    expect(semEmpresa(chavesDoCorpo(apontamentos, "EDITAR", doDia))).toEqual(ordenado(porta.CAMPOS_DE_EDICAO_APONTAMENTO));
    expect(chavesDoCorpo(apontamentos, "CANCELAR", doDia)).toEqual(ordenado(porta.CAMPOS_DE_CANCELAMENTO_APONTAMENTO));
    expect(chavesDoCorpo(apontamentos, "DUPLICAR", doDia)).toEqual(ordenado(porta.CAMPOS_DE_DUPLICACAO_APONTAMENTO));

    // A query da lista que a porta monta só usa chaves que a rota aceita.
    const listar = cabecalho.slice(cabecalho.indexOf("const LISTAR = {"), cabecalho.indexOf("const DETALHE"));
    const aceitas = [...listar.matchAll(/^ {6}([a-z_]+):/gm)].map((m) => m[1]);
    const todas = { empresa_id: "e", status: "ABERTA", tipo_atividade_id: "t", area_id: "a", data_de: HOJE, data_ate: HOJE, local: "DIVISA NORTE", limit: 100, cursor: "c" };
    const usadas = [...new URLSearchParams(porta.montarCaminhoListagem(todas).split("?")[1]).keys()];
    expect(usadas.length).toBe(Object.keys(todas).length);
    for (const chave of usadas) expect(aceitas, chave).toContain(chave);
  });

  it("LA-PORTA-2 — service sem fazenda: as gravações falham ANTES da rede e as listas voltam vazias", async () => {
    const servico = await import("@/services/lancamentoAtividadesService");
    servico.definirFazendaDaTela(null);
    expect(await servico.listarAtividades()).toMatchObject({ items: [], has_more: false });
    expect(await servico.listarApontamentos("a1")).toEqual({ items: [] });
    expect(await servico.listarOpcoesBens()).toMatchObject({ itens: [] });
    expect(await servico.listarAreasDaFazenda()).toEqual([]);
    await expect(servico.criarAtividade({ nome: "X", tipo_atividade_id: "t1" })).rejects.toBeInstanceOf(ApiError);
    await expect(servico.concluirAtividade("a1", { versao: 4 })).rejects.toBeInstanceOf(ApiError);
    await expect(servico.criarApontamento("a1", { data_operacional: HOJE })).rejects.toBeInstanceOf(ApiError);
    expect(backend.chamadas).toEqual([]);
    // Com a fazenda: o motivo curto também falha antes da rede, com o código do servidor.
    servico.definirFazendaDaTela("emp-1");
    await expect(servico.cancelarAtividade("a1", { versao: 4, motivo: "ab" })).rejects.toMatchObject({
      code: API_ERROR_CODES.ATIVIDADE_MOTIVO_INVALIDO,
      details: { field: "motivo", reason: "curto" },
    });
    expect(backend.chamadas).toEqual([]);
    servico.definirFazendaDaTela(null);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LA-MENU — rota, menu, ícone, manifesto e paridade com o servidor", () => {
  it("LA-MENU-1 — página registrada, no manifesto e no menu logo abaixo de Tipos de Atividade; a antiga saiu", async () => {
    const { PAGES } = await import("@/pages.config.js");
    const { DEFAULT_MENU, findMenuItemByUrl, getMenuModules } = await import("@/lib/menuConfig");
    const { ICONE_TELA } = await import("@/components/navigation/MobileModulesView");
    expect(PAGES.LancamentoAtividades).toBe(LancamentoAtividades);
    expect(PAGES).not.toHaveProperty("ApontamentosAtividade");
    const scope = JSON.parse(readFileSync("config/mapa-manejo-scope.json", "utf8"));
    expect(scope.allowedPages).toContain("LancamentoAtividades");
    expect(scope.allowedPages).not.toContain("ApontamentosAtividade");
    const item = findMenuItemByUrl(DEFAULT_MENU, "LancamentoAtividades");
    expect(item).toMatchObject({ id: "op-atividades", title: "Lançamento de Atividades", moduleId: MODULO });
    const grupo = DEFAULT_MENU.find((m) => m.id === item.moduleId);
    const ids = grupo.submenu.map((/** @type {any} */ s) => s.id);
    expect(ids.indexOf("op-atividades")).toBe(ids.indexOf("sup-tipos-atividade") + 1);
    expect(getMenuModules(DEFAULT_MENU).flatMap((m) => m.pages.map((p) => p.id))).not.toContain("op-apontamentos-atividade");
    expect(ICONE_TELA.LancamentoAtividades).toBe(lucide.ClipboardCheck);
    expect(ICONE_TELA.LancamentoAtividades).not.toBe(ICONE_TELA.TiposAtividade);
    expect(ICONE_TELA).not.toHaveProperty("ApontamentosAtividade");
  });

  it("LA-MENU-2 — o par módulo × tela do menu é o mesmo que o servidor confere (TELAS.ATIVIDADES em autorizacaoTela.js)", async () => {
    const { MODULO_ATIVIDADES, TELA_ATIVIDADES, PAGINA_LANCAMENTO_ATIVIDADES } = await import("@/lib/lancamentoAtividadesPermissions");
    expect({ MODULO_ATIVIDADES, TELA_ATIVIDADES, PAGINA_LANCAMENTO_ATIVIDADES }).toEqual({
      MODULO_ATIVIDADES: MODULO,
      TELA_ATIVIDADES: TELA,
      PAGINA_LANCAMENTO_ATIVIDADES: "LancamentoAtividades",
    });
    const servidor = readFileSync("backend/src/shared/auth/autorizacaoTela.js", "utf8");
    expect(servidor).toMatch(new RegExp(`ATIVIDADES:\\s*Object\\.freeze\\(\\{\\s*modulo:\\s*'${MODULO_ATIVIDADES}',\\s*tela:\\s*'${TELA_ATIVIDADES}'\\s*\\}\\)`));
    // A tela antiga não é mais pedida por nenhuma guarda.
    expect(servidor).not.toMatch(/tela:\s*'op-apontamentos-atividade'/);
  });

  it("LA-MENU-3 — ações da tela espelham os guardas do servidor (criar = novo|salvar, editar = editar|salvar, cancelar = excluir; extras só pela própria chave)", async () => {
    const { acoesDaTelaAtividades } = await import("@/lib/lancamentoAtividadesPermissions");
    const NADA = { ver: false, criar: false, editar: false, cancelar: false, reabrir: false, lancarApontamento: false, editarApontamento: false, cancelarApontamento: false };
    expect(acoesDaTelaAtividades(null)).toEqual(NADA);
    expect(acoesDaTelaAtividades({ ...permissaoCom({}), modulos_permitidos: [] })).toEqual(NADA);
    expect(acoesDaTelaAtividades(permissaoCom({}))).toEqual({ ...NADA, ver: true });
    expect(acoesDaTelaAtividades(permissaoCom({ salvar: true }))).toEqual({ ...NADA, ver: true, criar: true, editar: true });
    expect(acoesDaTelaAtividades(permissaoCom({ novo: true }))).toEqual({ ...NADA, ver: true, criar: true });
    expect(acoesDaTelaAtividades(permissaoCom({ excluir: true }))).toEqual({ ...NADA, ver: true, cancelar: true });
    // As extras não vêm de salvar/editar/excluir: cada uma pela SUA chave.
    expect(acoesDaTelaAtividades(permissaoCom({ salvar: true, editar: true, excluir: true }))).toMatchObject({ reabrir: false, lancarApontamento: false, editarApontamento: false, cancelarApontamento: false });
    expect(acoesDaTelaAtividades(permissaoCom({ reabrir: true }))).toEqual({ ...NADA, ver: true, reabrir: true });
    expect(acoesDaTelaAtividades(permissaoCom({ lancar_apontamento: true }))).toEqual({ ...NADA, ver: true, lancarApontamento: true });
    // Sem visualizar, nenhuma ação vale (fail-closed).
    expect(acoesDaTelaAtividades({ ...permissaoCom(EXTRAS), permissoes_telas: [linhaDaTela({ ...EXTRAS, visualizar: false })] })).toEqual(NADA);
    expect(acoesDaTelaAtividades({ user_email: "x", is_admin: true })).toEqual({
      ver: true, criar: true, editar: true, cancelar: true, reabrir: true, lancarApontamento: true, editarApontamento: true, cancelarApontamento: true,
    });
    const guardas = readFileSync("backend/src/shared/auth/guardasRotas.js", "utf8");
    expect(guardas).toMatch(/const CADASTRO_ATIVIDADES = cadastro\(T\.ATIVIDADES\);/);
    const bloco = guardas.slice(guardas.indexOf("  atividades: {"), guardas.indexOf("  grupoAtividade:"));
    expect(bloco).toMatch(/ver: porTela\(T\.ATIVIDADES, 'visualizar'\)/);
    expect(bloco).toMatch(/criar: CADASTRO_ATIVIDADES\.criar/);
    expect(bloco).toMatch(/editar: CADASTRO_ATIVIDADES\.editar/);
    expect(bloco).toMatch(/cancelar: CADASTRO_ATIVIDADES\.excluir/);
    expect(bloco).toMatch(/reabrir: porTela\(T\.ATIVIDADES, 'reabrir'\)/);
    expect(bloco).toMatch(/atividadeApontamentos: \{[\s\S]*criar: porTela\(T\.ATIVIDADES, 'lancar_apontamento'\)[\s\S]*editar: porTela\(T\.ATIVIDADES, 'editar_apontamento'\)[\s\S]*cancelar: porTela\(T\.ATIVIDADES, 'cancelar_apontamento'\)/);
  });

  it("LA-MENU-4 — paridade das ações extras: EXTRA_ACTION_KEYS_BY_PAGE = ACOES_ATIVIDADES_EXTRAS do servidor = as chaves pedidas pelas guardas", async () => {
    const { EXTRA_ACTION_KEYS_BY_PAGE, ACTION_LABELS, createRestrictedPagePermission } = await import("@/lib/permissions");
    const { ACOES_EXTRAS_ATIVIDADES } = await import("@/lib/lancamentoAtividadesPermissions");
    const { DEFAULT_MENU, getMenuModules } = await import("@/lib/menuConfig");
    const telas = readFileSync("backend/src/shared/auth/autorizacaoTela.js", "utf8");
    const lista = telas.match(/ACOES_ATIVIDADES_EXTRAS\s*=\s*Object\.freeze\(\[([^\]]*)\]/);
    expect(lista, "ACOES_ATIVIDADES_EXTRAS ausente em autorizacaoTela.js").toBeTruthy();
    const doServidor = [.../** @type {RegExpMatchArray} */ (lista)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const doCliente = EXTRA_ACTION_KEYS_BY_PAGE[TELA];
    expect([...doCliente].sort()).toEqual([...doServidor].sort());
    expect(Object.values(ACOES_EXTRAS_ATIVIDADES).sort()).toEqual([...doServidor].sort());
    // As guardas pedem exatamente essas chaves (além das ações padrão).
    const guardas = readFileSync("backend/src/shared/auth/guardasRotas.js", "utf8");
    const pedidas = [...guardas.matchAll(/porTela\(\s*T\.ATIVIDADES\s*,\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1]);
    const extrasPedidas = [...new Set(pedidas.filter((a) => !["visualizar", "novo", "salvar", "editar", "excluir", "importar", "exportar"].includes(a)))];
    expect(extrasPedidas.sort()).toEqual([...doServidor].sort());
    for (const acao of doServidor) expect(typeof ACTION_LABELS[acao], acao).toBe("string");
    // A linha nova (restrita) nasce com as extras desligadas; nenhuma outra tela ganha essas chaves.
    const mod = getMenuModules(DEFAULT_MENU).find((m) => m.id === MODULO);
    const pagina = mod.pages.find((p) => p.id === TELA);
    const restrita = createRestrictedPagePermission(mod.id, mod.title, pagina);
    expect(doServidor.every((a) => restrita[a] === false)).toBe(true);
    for (const outra of mod.pages.filter((p) => p.id !== TELA)) {
      const linha = createRestrictedPagePermission(mod.id, mod.title, outra);
      expect(doServidor.some((a) => a in linha), outra.id).toBe(false);
    }
  });

  it("LA-MENU-5 — tela Permissões: Lançamento de Atividades com as 7 ações padrão e as 4 extras, todas desligadas", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const { default: FormularioUsuario } = await import("@/components/usuarios/FormularioUsuario");
    const { DEFAULT_MENU } = await import("@/lib/menuConfig");
    render(<FormularioUsuario onSubmit={() => {}} onCancel={() => {}} initialData={null} usuarios={[]} />);
    const titulo = DEFAULT_MENU.find((m) => m.id === MODULO).title;
    const rotuloModulo = screen.getByText(titulo, { selector: "span" });
    await act(async () => {
      within(/** @type {HTMLElement} */ (rotuloModulo.closest("label"))).getByRole("checkbox").click();
    });
    const cartao = /** @type {HTMLElement} */ (screen.getByText("Lançamento de Atividades", { selector: "p.font-semibold" }).closest(".rounded-lg"));
    const caixas = within(cartao).getAllByRole("checkbox");
    expect(caixas).toHaveLength(11);
    expect(caixas.every((c) => c.getAttribute("aria-checked") === "false")).toBe(true);
    for (const r of ["REABRIR ATIVIDADE", "LANÇAR APONTAMENTO", "EDITAR APONTAMENTO", "CANCELAR APONTAMENTO"]) expect(within(cartao).getByText(r)).toBeTruthy();
    expect(screen.queryByText("Apontamentos de Atividade")).toBeNull();
    // As extras são só desta tela.
    const tipos = /** @type {HTMLElement} */ (screen.getByText("Tipos de Atividade", { selector: "p.font-semibold" }).closest(".rounded-lg"));
    expect(within(tipos).queryByText("REABRIR ATIVIDADE")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LA-TIPOS — a tela de Tipos de Atividade continua funcionando (rotuloDoCentro movido)", () => {
  it("LA-TIPOS-1 — rotuloDoCentro segue na lib; o formulário da operação (D-PROD-258) não mostra mais centros, grupo nem chaves", async () => {
    const { rotuloDoCentro } = await import("@/lib/lancamentoAtividadesRegras");
    expect(rotuloDoCentro({ numero: "12", nome: " Pecuária de corte " })).toBe("12 — Pecuária de corte");
    expect(rotuloDoCentro({ nome: "Sem número" })).toBe("Sem número");
    expect(rotuloDoCentro(null)).toBe("");
    const { default: FormularioTipoAtividade } = await import("@/components/tipos-atividade/FormularioTipoAtividade");
    render(
      <QueryClientProvider client={novoCliente()}>
        <FormularioTipoAtividade onSubmit={() => {}} toolbarActions isEditing initialData={{ ...TIPOS[0], descricao: null, categoria: "APLICACAO" }} />
      </QueryClientProvider>,
    );
    await assentar();
    const form = screen.getByTestId("b1-form-tipo-atividade");
    expect(within(form).getByRole("combobox", { name: "Tipo" })).toHaveTextContent("Aplicação");
    for (const campo of ["Centro de custo padrão", "Centro de resultado padrão", "Grupo de atividade", "Unidade de produção"]) {
      expect(within(form).queryByRole("combobox", { name: campo })).toBeNull();
    }
    expect(tiposSrv.listarCentrosDaFazenda).not.toHaveBeenCalled();
  });

  it("LA-TIPOS-2 — excluir tipo usado por atividade: a tela diz que há atividades vinculadas", async () => {
    tiposSrv.listarGruposSimples.mockResolvedValue([{ id: "g1", nome_grupo: "Pastagem", ativo: true }]);
    tiposSrv.listarTiposAtividade.mockResolvedValue([{ id: "t1", nome_tipo: "APLICAÇÃO", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true }]);
    tiposSrv.excluirTiposAtividade.mockResolvedValue({ excluidos: [], bloqueados: [{ id: "t1", code: API_ERROR_CODES.TIPO_ATIVIDADE_DELETE_BLOCKED }] });
    const { default: TiposAtividade } = await import("@/pages/TiposAtividade");
    render(
      <QueryClientProvider client={novoCliente()}>
        <TiposAtividade />
      </QueryClientProvider>,
    );
    const celula = await screen.findByText("APLICAÇÃO");
    fireEvent.click(/** @type {HTMLElement} */ (celula.closest('[data-testid="b1-row"]')));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    const confirmar = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmar).getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(tiposSrv.excluirTiposAtividade).toHaveBeenCalledWith(["t1"]));
    await waitFor(() =>
      expect(notify.notifyError).toHaveBeenCalledWith("Atenção", "1 tipo de atividade não pôde ser excluído. Há atividades vinculadas: inative o tipo em vez de excluir."),
    );
    // O código novo do vínculo (ATIVIDADE_VINCULADA) também é entendido como vínculo com atividade.
    const { getApiErrorMessage } = await import("@/apis/_core/ApiError.js");
    expect(getApiErrorMessage(new ApiError(API_ERROR_CODES.TIPO_ATIVIDADE_DELETE_BLOCKED))).toBe(
      "Não é possível excluir o tipo de atividade: há atividades vinculadas. Inative o tipo em vez de excluir.",
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════
// D-PROD-232 — Fatia 1 do redesenho pelo protótipo do proprietário: o ⚡ por linha e o Concluir com resumo.
/** O ⚡ da linha (grade ou card). @param {string} id */
const botaoRaio = (id) => screen.getByTestId(`atividade-acoes-${id}`);
/** Abre o menu ⚡ da linha e devolve os rótulos dos itens, na ordem. @param {string} id */
const itensDoRaio = async (id) => {
  fireEvent.click(botaoRaio(id));
  const menu = await screen.findByTestId(`atividade-acoes-${id}-menu`);
  return within(menu).queryAllByRole("menuitem").map((i) => i.textContent.trim());
};
const fecharRaio = async (/** @type {string} */ id) => {
  fireEvent.keyDown(screen.getByTestId(`atividade-acoes-${id}-menu`), { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId(`atividade-acoes-${id}-menu`)).toBeNull());
};
const TIPO_T1_COM_TUDO = { ...TIPOS[0], permite_produto: true, permite_implemento: true, permite_mao_obra: true, permite_servico: true };

describe("LA-RAIO — menu ⚡ por linha e Concluir com resumo (D-PROD-232)", () => {
  it("LA-RAIO-1 — ⚡ em cada linha, com \"Ações\" no cabeçalho; o clique no ⚡ não seleciona a linha; o menu traz o cabeçalho e os grupos", async () => {
    await montarComLista();
    for (const id of ["a1", "a2", "a3"]) expect(botaoRaio(id)).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("th.th-select--acoes")).toHaveTextContent("Ações");
    const linha = /** @type {HTMLElement} */ (botaoRaio("a1").closest('[data-testid="b1-row"]'));
    expect(within(linha).getByRole("checkbox", { name: "Selecionar linha" })).toBeTruthy();

    expect(await itensDoRaio("a1")).toEqual([
      "Abrir atividade",
      "Alterar atividade",
      "Finalizar atividade",
      "Duplicar atividade",
      "Cancelar atividade",
    ]);
    expect(botaoRaio("a1")).toHaveAttribute("aria-expanded", "true");
    expect(linha).toHaveAttribute("aria-selected", "false");
    const menu = screen.getByTestId("atividade-acoes-a1-menu");
    expect(menu).toHaveTextContent("Nº 3 · Cigarrinha Pasto 01");
    expect(menu).toHaveTextContent("APLICAÇÃO · 01 — Pasto 01");
    // Os três grupos (lançar · abrir · alterar…) com divisória; o cancelar em vermelho.
    expect(within(menu).getAllByRole("group")).toHaveLength(2);
    expect(within(menu).getByRole("menuitem", { name: "Cancelar atividade" })).toHaveClass("is-danger");
    // Esc fecha e o foco volta ao ⚡.
    await fecharRaio("a1");
    expect(botaoRaio("a1")).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(botaoRaio("a1")).toHaveFocus());

    // Concluída: abrir, reabrir (com a extra) e duplicar; cancelada: abrir e duplicar. Nada de lançar.
    expect(await itensDoRaio("a2")).toEqual(["Abrir atividade", "Reabrir atividade", "Duplicar atividade"]);
    await fecharRaio("a2");
    expect(await itensDoRaio("a3")).toEqual(["Abrir atividade", "Duplicar atividade"]);
    await fecharRaio("a3");
    expect(escritas()).toEqual([]);
  });

  it("LA-RAIO-2 — o que registrar segue o tipo: produto, mão de obra e serviço; máquina sempre", async () => {
    tiposSrv.listarTiposAtividade.mockResolvedValue([TIPO_T1_COM_TUDO, ...TIPOS.slice(1)]);
    await montarComLista();
    await waitFor(() => expect(tiposSrv.listarTiposAtividade).toHaveBeenCalled());
    await assentar();
    fireEvent.doubleClick(screen.getByTestId("atividade-numero-a1"));
    await screen.findByTestId("detalhe-area");
    for (const id of ["maquinas", "implemento", "produtos", "mao-obra", "servicos"]) expect(screen.getByTestId(`escolher-${id}`)).toBeTruthy();
    cleanup();
    // A flag gravada na atividade vale sobre a da lista de tipos.
    atividades.set("a1", { ...atividades.get("a1"), permite_produto: false, permite_servico: false, permite_mao_obra: true });
    await montarComLista();
    await assentar();
    fireEvent.doubleClick(screen.getByTestId("atividade-numero-a1"));
    await screen.findByTestId("detalhe-area");
    expect(screen.getByTestId("escolher-maquinas")).toBeTruthy();
    expect(screen.getByTestId("escolher-mao-obra")).toBeTruthy();
    expect(screen.queryByTestId("escolher-produtos")).toBeNull();
    expect(screen.queryByTestId("escolher-servicos")).toBeNull();
  });

  it("LA-RAIO-3 — por permissão: só ver = só Abrir; sem a extra de lançar, nada de lançar; sem o fuso, só Abrir", async () => {
    sessao.permissao = permissaoCom({});
    await montarComLista();
    expect(await itensDoRaio("a1")).toEqual(["Abrir atividade"]);
    cleanup();

    sessao.permissao = permissaoCom(ACOES_PADRAO);
    await montarComLista();
    expect(await itensDoRaio("a1")).toEqual(["Abrir atividade", "Alterar atividade", "Finalizar atividade", "Duplicar atividade", "Cancelar atividade"]);
    cleanup();

    sessao.permissao = permissaoCom({ ...ACOES_PADRAO, ...EXTRAS });
    sessao.fuso = null;
    await montarComLista();
    expect(await itensDoRaio("a1")).toEqual(["Abrir atividade"]);
  });

  it("LA-RAIO-4 — Abrir e Alterar pelo ⚡: a atividade abre só leitura, ou já na edição do cabeçalho", async () => {
    await montarComLista();
    await itensDoRaio("a1");
    fireEvent.click(screen.getByRole("menuitem", { name: "Abrir atividade" }));
    expect(await screen.findByTestId("atividade-cabecalho")).toBeTruthy();
    cleanup();
    await montarComLista();
    await itensDoRaio("a1");
    fireEvent.click(screen.getByRole("menuitem", { name: "Alterar atividade" }));
    const form = await screen.findByTestId("b1-form-atividade");
    expect(/** @type {HTMLInputElement} */ (within(form).getByLabelText(/^Nome da atividade/)).value).toBe("Cigarrinha Pasto 01");
  });

  it("LA-RAIO-5 — + Máquina abre o formulário direto (um nível só, no dia de hoje), sem gravar nada; Cancelar fecha", async () => {
    await montarComLista();
    fireEvent.doubleClick(screen.getByTestId("atividade-numero-a1"));
    await screen.findByTestId("atividade-aberta");
    fireEvent.click(await screen.findByTestId("escolher-maquinas"));
    const janela = await screen.findByTestId("janela-tipo");
    expect(janela.querySelector(".mdl-t")).toHaveTextContent("Trabalho de máquinas");
    // Emenda 3: sem subtítulo (a área e a atividade estão no cabeçalho da tela) e o Dia na mesma grade, no grupo "Lançamento".
    expect(within(janela).queryByTestId("janela-tipo-subtitulo")).toBeNull();
    expect(janela.querySelector(".b1-janela__nota")).toBeNull();
    expect(janela).not.toHaveClass("b1-janela--tipo");
    expect(janela.querySelector("form .b1-grupo__titulo")).toHaveTextContent("Lançamento");
    expect(janela.querySelector("form")).toContainElement(within(janela).getByTestId("janela-tipo-data"));
    expect(within(janela).getByTestId("janela-tipo-data")).toHaveValue(HOJE);
    expect(within(janela).queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("detalhe-area")).toBeTruthy();
    fireEvent.click(within(janela).getByTestId("janela-tipo-cancelar"));
    await waitFor(() => expect(screen.queryByTestId("janela-tipo")).toBeNull());
    expect(escritas()).toEqual([]);
  });

  it("LA-RAIO-6 — Concluir pelo ⚡: o diálogo novo, na janela padrão do Base1, com o resumo (período, área feita, custos, combustível)", async () => {
    atividades.set("a1", { ...atividades.get("a1"), totais: { apontamentos_confirmados: 2, apontamentos_cancelados: 1, dias_com_apontamento: 1 } });
    totaisPorAtividade.set("a1", {
      area_executada: "12.5000",
      area_planejada: "40.0000",
      unidade_area: "ha",
      produtos: [],
      maquinas: [],
      mao_obra: [],
      servicos: [],
      combustivel: { quantidade_l: "43.0000", quantidade_kg: null, custo_total: "250.0000" },
      consumo_por_bem: [],
      custo_total: "4262.4700",
      custo_por_ha: "340.9976",
      custo_combustivel_por_ha: "20.0000",
    });
    await montarComLista();
    await itensDoRaio("a1");
    fireEvent.click(screen.getByRole("menuitem", { name: "Finalizar atividade" }));
    const dialogo = await screen.findByTestId("dialogo-concluir-atividade");
    expect(within(dialogo).getByRole("heading", { name: "Finalizar atividade" })).toBeTruthy();
    // A janela padrão do Base1 (680px), a mesma dos lançamentos: nada da caixa pequena do shadcn.
    expect(dialogo.querySelector(".mdlc.b1-janela")).not.toBeNull();
    expect(dialogo.querySelector(".b1-janela__rodape")).not.toBeNull();
    expect(dialogo).not.toHaveTextContent("CIGARRINHA PASTO 01");
    await waitFor(() => expect(within(dialogo).getByTestId("concluir-resumo-periodo")).toHaveTextContent("01/11 → hoje · 1 dia lançado"));
    await waitFor(() => expect(within(dialogo).getByTestId("concluir-resumo-area")).toHaveTextContent("12,5 / 40 ha (31%)"));
    expect(within(dialogo).getByTestId("concluir-resumo-custo")).toHaveTextContent("R$ 4.262,47");
    expect(within(dialogo).getByTestId("concluir-resumo-custo-ha")).toHaveTextContent("R$ 341,00");
    expect(within(dialogo).getByTestId("concluir-resumo-combustivel")).toHaveTextContent("43 L");
    expect(within(dialogo).queryByTestId("concluir-nota")).toBeNull();
    // A data (padrão hoje) e o período acompanham a escolha.
    const data = within(dialogo).getByTestId("dialogo-concluir-atividade-data");
    expect(data).toHaveValue(HOJE);
    fireEvent.change(data, { target: { value: "2026-11-12" } });
    expect(within(dialogo).getByTestId("concluir-resumo-periodo")).toHaveTextContent("01/11 → 12/11 · 1 dia lançado");
    fireEvent.click(within(dialogo).getByTestId("dialogo-concluir-atividade-enviar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita()).toEqual({ method: "POST", path: "/atividades/a1/concluir", query: {}, body: { empresa_id: "emp-1", versao: 4, data_conclusao: "2026-11-12" } });
    expect(await screen.findByTestId("atividade-concluida")).toHaveTextContent("Atividade finalizada em 12/11/2026");
  });

  it("LA-RAIO-7 — sem os totais do servidor o resumo não inventa: \"—\" nos custos e no combustível, a área do cabeçalho e a nota do erro", async () => {
    await montarComLista();
    await abrir("a1");
    fireEvent.click(screen.getByTestId("atividade-concluir"));
    const dialogo = await screen.findByTestId("dialogo-concluir-atividade");
    await waitFor(() => expect(within(dialogo).getByTestId("concluir-resumo-erro")).toBeTruthy());
    expect(within(dialogo).getByTestId("concluir-resumo-custo")).toHaveTextContent("—");
    expect(within(dialogo).getByTestId("concluir-resumo-custo-ha")).toHaveTextContent("—");
    expect(within(dialogo).getByTestId("concluir-resumo-combustivel")).toHaveTextContent("—");
    expect(within(dialogo).getByTestId("concluir-resumo-area")).toHaveTextContent("12,5 / 40 ha (31%)");
    // O detalhe do fake não traz `totais`: sem os dias, o período fica só com as datas.
    expect(within(dialogo).getByTestId("concluir-resumo-periodo")).toHaveTextContent(/^01\/11 → hoje$/);
  });

  it("LA-RAIO-8 — celular: o ⚡ fica no card e o menu abre na folha de baixo (não na janela presa ao botão)", async () => {
    vi.stubGlobal("matchMedia", (/** @type {string} */ query) => ({
      matches: query.includes("max-width: 639px") || query.includes("max-width: 767px") || query.includes("max-width: 1023px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    await montar();
    await waitFor(() => expect(screen.getAllByTestId("b1-card").length).toBe(3));
    const card = /** @type {HTMLElement} */ (botaoRaio("a1").closest('[data-testid="b1-card"]'));
    expect(card).toBeTruthy();
    fireEvent.click(botaoRaio("a1"));
    const menu = await screen.findByTestId("atividade-acoes-a1-menu");
    expect(menu.closest(".mk-sheet")).toBeTruthy();
    expect(menu.closest("[data-radix-popper-content-wrapper]")).toBeNull();
    expect(card).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Finalizar atividade" }));
    expect(await screen.findByTestId("dialogo-concluir-atividade")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("atividade-acoes-a1-menu")).toBeNull());
  });
});

// ═════════════════════════════════════════════════════════════════════════
/** Celular (≤ 639 px): a lista vira cards e os filtros abrem pelo funil da barra. */
const comoCelular = () =>
  vi.stubGlobal("matchMedia", (/** @type {string} */ query) => ({
    matches: query.includes("max-width: 639px") || query.includes("max-width: 767px") || query.includes("max-width: 1023px"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
/** Pílulas da faixa, na ordem, com o texto de cada uma. */
const pilulasDaFaixa = () => [...document.querySelectorAll('[data-testid="b1-filtros-rapidos"] .b1-fr__chips .b1-fr-chip')].map((el) => (el.textContent ?? "").trim());
/** A pílula de um filtro da tela. @param {string} id */
const pilulaDaTela = (id) => /** @type {HTMLElement} */ (document.querySelector(`[data-filtro-tela="${id}"]`));

describe("LA-FILTROS — a faixa de pílulas no lugar da caixa solta e os cards do celular (D-PROD-237)", () => {
  it("LA-FILTROS-1 — sem a caixa solta: a faixa é Ordenar · Tipo · Situação · Área · Início · + Filtro (D-PROD-267, o modelo do dono), sem \"Tipo\" duplicado", async () => {
    await montarComLista();
    expect(screen.queryByTestId("atividades-filtros")).toBeNull();
    expect(screen.queryByTestId("atividades-filtro-de")).toBeNull();
    expect(screen.queryByTestId("atividades-filtro-ate")).toBeNull();
    expect(pilulasDaFaixa()).toEqual(["Nº (mais recentes primeiro)", "Tipo", "Situação", "Área", "Início"]);
    expect(screen.getByRole("button", { name: "Adicionar ou tirar filtros" })).toBeTruthy();
    // "+ Filtro": os campos da grade, menos os que as pílulas da consulta já cobrem.
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ou tirar filtros" }));
    const campos = within(await screen.findByRole("listbox", { name: "Filtros rápidos" }))
      .getAllByRole("option")
      .map((o) => (o.textContent ?? "").trim());
    expect(campos).toEqual(expect.arrayContaining(["Nome", "Máquina", "Conclusão", "Custo", "Operação"]));
    for (const coberto of ["Situação", "Tipo", "Área", "Início"]) expect(campos).not.toContain(coberto);
    // Um campo de "+ Filtro" entra na faixa depois do Início.
    fireEvent.click(screen.getByRole("option", { name: "Máquina" }));
    await waitFor(() => expect(pilulasDaFaixa()).toEqual(["Nº (mais recentes primeiro)", "Tipo", "Situação", "Área", "Início", "Máquina"]));
  });

  it("LA-FILTROS-2 — uma pílula de \"Tipo\" salva antes (localStorage) não volta a aparecer ao lado da pílula da consulta", async () => {
    window.localStorage.setItem("colunas_lancamento_atividades_v2_filtrosRapidos", JSON.stringify(["tipo", "status", "area", "bem"]));
    await montarComLista();
    expect(pilulasDaFaixa()).toEqual(["Nº (mais recentes primeiro)", "Tipo", "Situação", "Área", "Início", "Máquina"]);
  });

  it("LA-FILTROS-3 — cada pílula manda o seu parâmetro ao servidor e mostra o valor; o ✕ da pílula tira só aquele", async () => {
    await montarComLista();
    const base = listagens().length;
    // "Abertas" (planejadas e em andamento) é o status ABERTA de antes.
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por situação" }), "Abertas (planejadas e em andamento)");
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", status: "ABERTA", limit: expect.any(String) }));
    expect(pilulaDaTela("situacao")).toHaveTextContent("SituaçãoAbertas (planejadas e em andamento)");
    // O tipo fixo vai como `tipo_fixo`; a operação dentro dele, como `tipo_atividade_id`.
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por tipo" }), /^Roçada e tratos$/);
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", status: "ABERTA", tipo_fixo: "PASTAGEM", limit: expect.any(String) }));
    expect(pilulaDaTela("tipo")).toHaveTextContent("TipoRoçada e tratos");
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por tipo" }), /^Outros › APLICAÇÃO$/);
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", status: "ABERTA", tipo_atividade_id: "t1", limit: expect.any(String) }));
    expect(pilulaDaTela("tipo")).toHaveTextContent("TipoOutros › APLICAÇÃO");
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por área" }), /01 — Pasto 01/);
    await waitFor(() =>
      expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", status: "ABERTA", tipo_atividade_id: "t1", area_id: "ar1", limit: expect.any(String) }),
    );
    expect(pilulaDaTela("area")).toHaveTextContent("Área01 — Pasto 01");
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por início" }));
    fireEvent.change(await screen.findByTestId("atividades-filtro-inicio-de"), { target: { value: "2026-10-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(listagens().at(-1).query).toMatchObject({ data_de: "2026-10-25" }));
    expect(listagens().at(-1).query.data_ate).toBeUndefined();
    expect(pilulaDaTela("inicio")).toHaveTextContent("Iníciodesde 25/10");
    expect(listagens().length).toBeGreaterThan(base);
    // ✕ do tipo: volta a "Todos os tipos" e só ele sai da query.
    fireEvent.click(screen.getByRole("button", { name: "Tirar filtro de Tipo" }));
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", status: "ABERTA", area_id: "ar1", data_de: "2026-10-25", limit: expect.any(String) }));
    expect(pilulaDaTela("tipo")).toHaveTextContent(/^Tipo$/);
    // A situação "Em andamento" vai como `situacao` (sem o status).
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por situação" }), "Em andamento");
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", situacao: "EM_ANDAMENTO", area_id: "ar1", data_de: "2026-10-25", limit: expect.any(String) }));
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por situação" }), "Abertas (planejadas e em andamento)");
    // ✕ do Início: sem datas.
    fireEvent.click(screen.getByRole("button", { name: "Tirar filtro de Início" }));
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", status: "ABERTA", area_id: "ar1", limit: expect.any(String) }));
  });

  it("LA-FILTROS-4 — Início: uma pílula com \"De\" e \"Até\", o período no rótulo (\"Início 03/11 – 14/11\"); rascunho até o ✓; ✕ da janela não aplica", async () => {
    await montarComLista();
    const pilula = screen.getByRole("combobox", { name: "Filtrar por início" });
    expect(pilulaDaTela("inicio")).toHaveTextContent(/^Início$/);
    fireEvent.click(pilula);
    const de = await screen.findByTestId("atividades-filtro-inicio-de");
    expect(de).toHaveAttribute("type", "date");
    expect(screen.getByRole("group", { name: "Início" })).toHaveTextContent("DeAté");
    // Cancelar (✕) descarta o rascunho: nada lido.
    const antes = listagens().length;
    fireEvent.change(de, { target: { value: "2026-11-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await assentar();
    expect(listagens().length).toBe(antes);
    expect(pilulaDaTela("inicio")).toHaveTextContent(/^Início$/);
    // De e até aplicados juntos, numa leitura só.
    fireEvent.click(pilula);
    fireEvent.change(await screen.findByTestId("atividades-filtro-inicio-de"), { target: { value: "2026-11-03" } });
    fireEvent.change(screen.getByTestId("atividades-filtro-inicio-ate"), { target: { value: "2026-11-14" } });
    await assentar();
    expect(listagens().length).toBe(antes);
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", data_de: "2026-11-03", data_ate: "2026-11-14", limit: expect.any(String) }));
    expect(listagens().length).toBe(antes + 1);
    expect(pilulaDaTela("inicio")).toHaveTextContent("Início03/11 – 14/11");
    // Só a a2 (início 03/11) está no período.
    await waitFor(() => expect(screen.queryByTestId("atividade-numero-a1")).toBeNull());
    expect(screen.getByTestId("atividade-numero-a2")).toBeTruthy();
    // Reabrir mostra o aplicado; "Limpar datas" esvazia o rascunho e o ✓ tira o período.
    fireEvent.click(pilula);
    expect(await screen.findByTestId("atividades-filtro-inicio-de")).toHaveValue("2026-11-03");
    fireEvent.click(screen.getByRole("button", { name: "Limpar datas" }));
    expect(screen.getByTestId("atividades-filtro-inicio-ate")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", limit: expect.any(String) }));
    expect(pilulaDaTela("inicio")).toHaveTextContent(/^Início$/);
  });

  it("LA-FILTROS-5 — \"Limpar filtros\" volta status, tipo, área e período ao padrão numa leitura sem filtros", async () => {
    await montarComLista();
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).toBeNull();
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por situação" }), "Finalizada");
    await waitFor(() => expect(listagens().at(-1).query.situacao).toBe("CONCLUIDA"));
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por tipo" }), /^Roçada e tratos › ROÇADA$/);
    await waitFor(() => expect(listagens().at(-1).query.tipo_atividade_id).toBe("t2"));
    await escolherOpcao(screen.getByRole("combobox", { name: "Filtrar por área" }), /02 — Pasto 02/);
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por início" }));
    fireEvent.change(await screen.findByTestId("atividades-filtro-inicio-ate"), { target: { value: "2026-11-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() =>
      expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", situacao: "CONCLUIDA", tipo_atividade_id: "t2", area_id: "ar2", data_ate: "2026-11-30", limit: expect.any(String) }),
    );
    expect(pilulaDaTela("inicio")).toHaveTextContent("Inícioaté 30/11");
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", limit: expect.any(String) }));
    expect(await screen.findByTestId("atividade-numero-a1")).toBeTruthy();
    expect(pilulasDaFaixa()).toEqual(["Nº (mais recentes primeiro)", "Tipo", "Situação", "Área", "Início"]);
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).toBeNull();
  });

  it("LA-FILTROS-6 — muitas áreas: a janela da pílula ganha \"Pesquisar…\" e filtra as opções", async () => {
    const muitas = Array.from({ length: 12 }, (_, i) => ({
      id: `arx${i}`,
      nome: `Piquete ${String(i + 1).padStart(2, "0")}`,
      numero_area: String(i + 10),
      setor_id: "s1",
      setor_nome: "SETOR NORTE",
      empresa_id: "emp-1",
      ativo: true,
    }));
    mapaSrv.listarAreasAtivas.mockImplementation(async (empresaId) => [...AREAS, ...muitas].filter((a) => a.empresa_id === empresaId));
    await montarComLista();
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por área" }));
    const busca = await screen.findByRole("textbox", { name: "Pesquisar área" });
    fireEvent.change(busca, { target: { value: "piquete 1" } });
    const opcoes = within(screen.getByRole("listbox", { name: "Área" })).getAllByRole("option").map((o) => (o.textContent ?? "").trim());
    expect(opcoes).toEqual(["19 — Piquete 10", "20 — Piquete 11", "21 — Piquete 12"]);
    fireEvent.click(screen.getByRole("option", { name: "20 — Piquete 11" }));
    await waitFor(() => expect(listagens().at(-1).query).toMatchObject({ area_id: "arx10" }));
    // A pílula de situação (6 opções) continua sem pesquisa.
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por situação" }));
    await screen.findByRole("listbox", { name: "Situação" });
    expect(screen.queryByRole("textbox", { name: "Pesquisar situação" })).toBeNull();
  });

  it("LA-FILTROS-7 — celular (D-PROD-267, o modelo V1): cada card é o bloco do serviço — Nº, tipo e custo, operação · área, data · situação, o andamento com os botões — com o ⚡ no topo", async () => {
    comoCelular();
    atividades.set("a1", { ...atividades.get("a1"), custo_total: "4262.4700" });
    await montar();
    await waitFor(() => expect(screen.getAllByTestId("b1-card").length).toBe(3));
    const cardDe = (/** @type {string} */ id) => /** @type {HTMLElement} */ (botaoRaio(id).closest('[data-testid="b1-card"]'));
    const c1 = cardDe("a1");
    const b1 = within(c1).getByTestId("servico-bloco-a1");
    // O bloco no lugar do selo, título e campos do motor.
    expect(within(c1).queryByTestId("b1-card-avatar")).toBeNull();
    expect(c1.querySelector(".mg-b1-card__fields")).toBeNull();
    expect(b1.querySelector(".b1-servico-bloco__num")).toHaveTextContent(/^3$/);
    expect(b1.querySelector(".b1-servico-bloco__tipo")).toHaveTextContent(/^Aplicação$/);
    expect(b1.querySelector(".b1-servico-bloco__custo")?.textContent?.replace(/\s/g, " ")).toBe("R$ 4.262,47");
    expect([...b1.querySelectorAll(".b1-servico-bloco__linha")].map((el) => el.textContent)).toEqual(["APLICAÇÃO · Pasto 01", "01/11 – · Em andamento"]);
    expect(within(b1).getByTestId("servico-andamento-a1")).toHaveTextContent("12,5 de 40 ha (31%) · último dia 12/11");
    expect(within(b1).getAllByRole("button").map((b) => b.textContent)).toEqual(["Lançamento", "Finalizar"]);
    // O ⚡ fica no topo do card (sem a caixa de marcar no celular, o CSS a esconde).
    expect(botaoRaio("a1").closest(".b1-card__select")).toBeTruthy();
    // Concluída: "03/11 a 12/11 · Finalizada · 8 ha", sem custo e sem botões.
    const b2 = within(cardDe("a2")).getByTestId("servico-bloco-a2");
    expect(b2.querySelector(".b1-servico-bloco__tipo")).toHaveTextContent(/^Roçada e tratos$/);
    expect(b2.querySelector(".b1-servico-bloco__custo")).toBeNull();
    expect([...b2.querySelectorAll(".b1-servico-bloco__linha")].map((el) => el.textContent)).toEqual(["ROÇADA · Pasto 02", "03/11 a 12/11 · Finalizada · 8 ha"]);
    expect(within(b2).queryAllByRole("button")).toEqual([]);
    const b3 = within(cardDe("a3")).getByTestId("servico-bloco-a3");
    expect([...b3.querySelectorAll(".b1-servico-bloco__linha")].map((el) => el.textContent)).toEqual(["APLICAÇÃO", "20/10 · Cancelada"]);
    // Tocar num botão do bloco não seleciona o card.
    fireEvent.click(within(b1).getByRole("button", { name: "Finalizar" }));
    expect(c1).toHaveAttribute("aria-selected", "false");
    expect(await screen.findByTestId("dialogo-concluir-servico")).toBeTruthy();
  });

  it("LA-FILTROS-8 — celular: o funil abre \"Filtros\" com as mesmas pílulas (Ordenar, Status, Tipo, Área, Início); tipo e período vão ao servidor", async () => {
    comoCelular();
    await montar();
    await waitFor(() => expect(screen.getAllByTestId("b1-card").length).toBe(3));
    expect(screen.queryByTestId("atividades-filtros")).toBeNull();
    fireEvent.click(screen.getByTestId("b1-field-filter"));
    const menu = await screen.findByRole("list", { name: "Filtros" });
    const itens = () => within(menu).getAllByRole("button").map((b) => (b.querySelector(".b1-fr-op__txt")?.textContent ?? "").trim());
    expect(itens()).toEqual(["Ordenar", "Tipo", "Situação", "Área", "Início"]);
    // Tipo: a lista de escolha única (o tipo fixo ou a operação dentro dele), direto na query.
    fireEvent.click(within(menu).getByRole("button", { name: /^Tipo/ }));
    fireEvent.click(await screen.findByRole("option", { name: /^Roçada e tratos › ROÇADA$/ }));
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", tipo_atividade_id: "t2", limit: expect.any(String) }));
    // Início: a folha com De e Até; invertido não aplica; o ✓ do topo aplica.
    fireEvent.click(screen.getByTestId("b1-field-filter"));
    fireEvent.click(within(await screen.findByRole("list", { name: "Filtros" })).getByRole("button", { name: /Início/ }));
    fireEvent.change(await screen.findByTestId("atividades-filtro-inicio-de"), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByTestId("atividades-filtro-inicio-ate"), { target: { value: "2026-11-01" } });
    expect(await screen.findByTestId("atividades-filtro-inicio-invertido")).toHaveTextContent("A data final do período é anterior à inicial.");
    const antes = listagens().length;
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await assentar();
    expect(listagens().length).toBe(antes);
    fireEvent.change(screen.getByTestId("atividades-filtro-inicio-de"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByTestId("atividades-filtro-inicio-ate"), { target: { value: "2026-11-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() =>
      expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", tipo_atividade_id: "t2", data_de: "2026-11-01", data_ate: "2026-11-05", limit: expect.any(String) }),
    );
    // O menu mostra o que está aplicado e "Limpar filtros" volta tudo.
    fireEvent.click(screen.getByTestId("b1-field-filter"));
    const menu2 = await screen.findByRole("list", { name: "Filtros" });
    expect(within(menu2).getByRole("button", { name: /Início/ })).toHaveTextContent("01/11 – 05/11");
    expect(within(menu2).getByRole("button", { name: /^Tipo/ })).toHaveTextContent("Roçada e tratos › ROÇADA");
    fireEvent.click(within(/** @type {HTMLElement} */ (menu2.closest(".mk-sheet"))).getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(listagens().at(-1).query).toEqual({ empresa_id: "emp-1", limit: expect.any(String) }));
  });

  it("LA-FILTROS-9 — computador: a grade (colunas do modelo do dono, sem cards) e a ordem padrão é \"Nº (mais recentes primeiro)\"", async () => {
    await montarComLista();
    expect(screen.queryByTestId("b1-card")).toBeNull();
    const cabecalhos = [...document.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim()).filter(Boolean);
    expect(cabecalhos.filter((c) => c !== "Ações")).toEqual(["Nº", "Tipo", "Operação", "Área", "Data", "Situação", "Custo"]);
    fireEvent.click(screen.getByRole("button", { name: "Ordenar" }));
    const ordens = within(await screen.findByRole("listbox", { name: "Ordenar" }))
      .getAllByRole("option")
      .map((o) => (o.textContent ?? "").trim());
    expect(ordens.slice(0, 4)).toEqual(["Nº (mais recentes primeiro)", "Nº (mais antigas primeiro)", "Tipo (A → Z)", "Tipo (Z → A)"]);
    expect(ordens).toEqual(expect.arrayContaining(["Custo (maior primeiro)", "Data (mais recente primeiro)"]));
  });

  it("LA-FILTROS-10 — regras puras: sigla e cor do tipo, subtítulo do card, período em palavras", async () => {
    const { siglaDoTipoAtividade, corDoTipoAtividade, PALETA_TIPO_ATIVIDADE } = await import("@/lib/lancamentoAtividadesRegras");
    const { textoDoPeriodo, filtroDaTelaAtivo } = await import("@/components/cadastro/base1/FiltrosRapidos");
    const { seloDoCardAtividade, subtituloDoCardAtividade, ATIVIDADES_CAMPOS_CARD } = await import("@/pages/LancamentoAtividades");
    expect(siglaDoTipoAtividade("ADUBAÇÃO DE COBERTURA")).toBe("ADU");
    expect(siglaDoTipoAtividade("  roçada ")).toBe("ROÇ");
    expect(siglaDoTipoAtividade("A-1 X")).toBe("A1X");
    expect(siglaDoTipoAtividade(null)).toBe("");
    expect(corDoTipoAtividade("t1")).toBe(corDoTipoAtividade("t1"));
    expect(PALETA_TIPO_ATIVIDADE).toContain(corDoTipoAtividade("qualquer"));
    expect(corDoTipoAtividade("")).toBe(PALETA_TIPO_ATIVIDADE[0]);
    expect(seloDoCardAtividade({ tipo_atividade_id: "t9", tipo_atividade_nome: "PULVERIZAÇÃO", nome: "Cigarrinha" })).toEqual({ texto: "PUL", cor: corDoTipoAtividade("t9") });
    // Sem tipo, as iniciais do nome.
    expect(seloDoCardAtividade({ nome: "Cerca" }).texto).toBe("CER");
    expect(subtituloDoCardAtividade({ numero: "7", status: "ABERTA" })).toBe("Nº 7 · Em andamento");
    expect(subtituloDoCardAtividade({ status: "CANCELADA" })).toBe("Cancelada");
    expect(ATIVIDADES_CAMPOS_CARD).toEqual(["numero", "tipo", "area", "data_inicio", "valor_total"]);
    // Ano corrente (2026, o relógio do teste) em dd/mm; outros anos com o ano.
    expect(textoDoPeriodo("2026-11-03", "2026-11-17")).toBe("03/11 – 17/11");
    expect(textoDoPeriodo("2025-12-20", "2026-01-10")).toBe("20/12/2025 – 10/01");
    expect(textoDoPeriodo("2026-11-03", "")).toBe("desde 03/11");
    expect(textoDoPeriodo("", "2026-11-17")).toBe("até 17/11");
    expect(textoDoPeriodo("", "")).toBe("");
    const noop = () => {};
    expect(filtroDaTelaAtivo({ id: "p", tipo: "periodo", rotulo: "P", nome: "P", de: "", ate: "", onChange: noop })).toBe(false);
    expect(filtroDaTelaAtivo({ id: "p", tipo: "periodo", rotulo: "P", nome: "P", de: "", ate: "2026-01-01", onChange: noop })).toBe(true);
    expect(filtroDaTelaAtivo({ id: "s", rotulo: "S", nome: "S", opcoes: [], valor: "X", padrao: "X", onChange: noop })).toBe(false);
  });

  it("LA-FILTROS-11 — motor: sem `avatar` / `subtitle` o card continua com as iniciais do título e o código; com eles, o selo e o subtítulo da tela", async () => {
    const { Base1Cards } = await import("@/components/cadastro/base1/Base1Cards");
    const comum = {
      rows: [{ id: "r1", nome: "Trator azul", codigo: "TP-1" }],
      columns: [
        { id: "nome", label: "Nome" },
        { id: "codigo", label: "Código" },
      ],
      fields: ["nome"],
      perRow: /** @type {1} */ (1),
      selected: new Set(),
      onSelectClick: vi.fn(),
      codeColId: "codigo",
      getFieldValue: (/** @type {any} */ r, /** @type {string} */ id) => r[id],
    };
    const sem = render(<Base1Cards {...comum} />);
    expect(screen.getByTestId("b1-card-avatar")).toHaveTextContent("TRA");
    expect(screen.getByTestId("b1-card-avatar").getAttribute("style")).toBeNull();
    expect(screen.queryByTestId("b1-card-sub")).toBeNull();
    expect(document.querySelector(".mg-b1-card__sub")).toHaveTextContent("Código TP-1");
    sem.unmount();
    render(<Base1Cards {...comum} avatar={() => ({ texto: "MAQ", cor: "#1d4ed8" })} subtitle={() => "Nº 1 · Ativo"} />);
    expect(screen.getByTestId("b1-card-avatar")).toHaveTextContent("MAQ");
    expect(screen.getByTestId("b1-card-avatar").style.backgroundColor).toBe("rgb(29, 78, 216)");
    expect(screen.getByTestId("b1-card-sub")).toHaveTextContent("Nº 1 · Ativo");
  });
});

describe("LA-RAIO-GRADE — a grade e os cards das outras telas não mudam (o ⚡ é opt-in)", () => {
  it("LA-RAIO-GRADE-1 — sem renderAcoesDaLinha: só a caixa de marcar, sem \"Ações\" nem ⚡; com ele: caixa + ⚡ e \"Ações\"", async () => {
    const { default: Base1Grid } = await import("@/components/cadastro/base1/Base1Grid");
    const { Base1Cards } = await import("@/components/cadastro/base1/Base1Cards");
    const linhas = [{ id: "r1", nome: "Um" }];
    const colunas = [{ key: "nome", label: "Nome" }];
    const comum = { columns: colunas, rows: linhas, selected: new Set(), onSelectClick: vi.fn(), onToggle: vi.fn(), onToggleAll: vi.fn() };
    const { unmount } = render(<Base1Grid {...comum} />);
    expect(document.querySelector("th.th-select--acoes, td.td-select--acoes, .b1-raio, .b1-selacoes")).toBeNull();
    expect(screen.queryByText("Ações")).toBeNull();
    unmount();
    render(<Base1Grid {...comum} renderAcoesDaLinha={(/** @type {any} */ r) => <button type="button" className="b1-raio" aria-label={`ações ${r.id}`} />} />);
    expect(document.querySelector("th.th-select--acoes")).toHaveTextContent("Ações");
    expect(screen.getByRole("button", { name: "ações r1" }).closest("td.td-select--acoes")).toBeTruthy();
    cleanup();

    const cartoes = { rows: linhas, columns: [{ id: "nome", label: "Nome" }], fields: ["nome"], perRow: /** @type {1} */ (1), selected: new Set(), onSelectClick: vi.fn(), getFieldValue: (/** @type {any} */ r) => r.nome };
    const sem = render(<Base1Cards {...cartoes} />);
    expect(document.querySelector(".b1-raio, .b1-selacoes")).toBeNull();
    sem.unmount();
    render(<Base1Cards {...cartoes} renderAcoesDaLinha={() => <button type="button" className="b1-raio" aria-label="ações do card" />} />);
    expect(screen.getByRole("button", { name: "ações do card" }).closest(".b1-card__select")).toBeTruthy();
  });

  it("LA-RAIO-GRADE-2 — resumoParaConcluir: sem totais, nada de custo inventado; a área que falta só com a planejada maior", async () => {
    const { resumoParaConcluir } = await import("@/lib/atividadeLinhasRegras");
    const base = { data_inicio: "2026-11-03", area_executada: "9.2000", area_planejada: "18.4000" };
    const r = resumoParaConcluir({ atividade: base, totais: null, hoje: HOJE, dataConclusao: HOJE });
    expect(r).toEqual({ periodo: "03/11 → hoje", area: "9,2 / 18,4 ha (50%)", barra: 50, falta: { faltam: "9,2", planejada: "18,4", unidade: "ha" }, custo: null, custoPorHa: null, combustivel: null });
    const cheia = resumoParaConcluir({ atividade: { ...base, area_executada: "18.4000", totais: { dias_com_apontamento: 3 } }, totais: null, hoje: HOJE });
    expect(cheia.falta).toBeNull();
    expect(cheia.periodo).toBe("03/11 → hoje · 3 dias lançados");
    expect(resumoParaConcluir({ atividade: {}, totais: null, hoje: HOJE })).toMatchObject({ periodo: null, area: null, barra: null, falta: null });
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LA-REGISTRAR — planejar × registrar trabalho de campo (D-PROD-254; D-PROD-267: \"+ Nova realização\" e \"Planejar\")", () => {
  it("LA-REGISTRAR-1 — a barra tem duas ações distintas e rotuladas: '+ Nova realização' (o botão principal, registrar) e 'Planejar' (a 'Nova atividade' de antes)", async () => {
    await montarComLista();
    const planejar = screen.getByRole("button", { name: "Planejar" });
    const registrar = screen.getByRole("button", { name: "Nova atividade" });
    expect(planejar).toHaveTextContent("Planejar");
    expect(registrar).toHaveTextContent("Nova atividade");
    // "+ Nova realização" é o botão de criar da barra (o principal); o rótulo antigo de planejar saiu.
    expect(registrar).toHaveClass("mg-act-novo");
    expect(planejar).not.toHaveClass("mg-act-novo");
    // D-PROD-281: "+ Nova atividade" é o nome novo do botão principal (o de antes, "Nova realização", saiu).
    expect(screen.queryByRole("button", { name: "Nova realização" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar serviço" })).toBeNull();
    expect(planejar).not.toBe(registrar);
    // "Planejar" abre o formulário de PLANEJAR (tipo, áreas), não o registro de campo. D-PROD-276: antes, a escolha
    // "Reforma de pastagem" ou "Um serviço"; "Um serviço" é o planejar de antes.
    fireEvent.click(planejar);
    const escolha = await screen.findByTestId("janela-planejar");
    expect(within(escolha).getByTestId("janela-planejar-reforma")).toHaveTextContent("Reforma de pastagem");
    fireEvent.click(within(escolha).getByTestId("janela-planejar-servico"));
    expect(await screen.findByTestId("b1-form-atividade")).toBeTruthy();
    expect(screen.queryByTestId("janela-registro-de-campo")).toBeNull();
    expect(screen.queryByTestId("janela-planejar")).toBeNull();
  });

  it("LA-REGISTRAR-2 — sem a ação de lançar apontamento, a Nova realização não aparece (o planejar segue)", async () => {
    sessao.permissao = permissaoCom(ACOES_PADRAO);
    await montarComLista();
    expect(screen.getByRole("button", { name: "Planejar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nova atividade" })).toBeNull();
  });

  it("LA-REGISTRAR-3 — Registrar abre o formulário compartilhado (uma janela Base1): escolhe a área e o tipo, grava com UM POST em /atividades/registrar e fecha", async () => {
    await montarComLista();
    fireEvent.click(screen.getByRole("button", { name: "Nova atividade" }));
    const janela = await screen.findByTestId("janela-registro-de-campo");
    expect(document.querySelectorAll('[data-testid="janela-registro-de-campo"]').length).toBe(1);
    expect(within(janela).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    // A área, o tipo e a operação NÃO vêm presos: a pessoa escolhe o tipo fixo (D-PROD-265: o cartão) e depois a operação
    // desse tipo (só as ativas). Escolhido o tipo, as quatro seções já estão à mostra (D-PROD-262).
    fireEvent.click(within(janela).getByRole("button", { name: "Roçada e tratos" }));
    await within(janela).findByTestId("registro-de-campo-form");
    expect(within(janela).getByTestId("registro-de-campo-titulo")).toHaveTextContent("Nova atividade de Roçada e tratos");
    for (const secao of ["Insumos", "Máquinas", "Equipe", "Serviço de terceiro (se houver)"]) expect(janela.textContent).toContain(secao);
    // D-PROD-263: as Áreas são marcadas na lista (busca + caixas); a área sem tamanho pede os hectares.
    fireEvent.click(within(janela).getByTestId("registro-areas-campo"));
    fireEvent.click(await screen.findByTestId("registro-areas-opcao-ar1"));
    fireEvent.click(within(janela).getByTestId("registro-areas-campo"));
    await waitFor(() => expect(screen.queryByTestId("registro-areas-lista")).toBeNull());
    expect(within(janela).getByTestId("registro-areas-linha-ar1")).toHaveTextContent("Pasto 01");
    fireEvent.click(within(janela).getByRole("combobox", { name: "Operação" }));
    await screen.findAllByRole("option");
    expect(screen.queryByRole("option", { name: /GRADAGEM/i })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /^ROÇADA$/i }));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    expect(await within(janela).findByTestId("registro-de-campo-destino")).toHaveTextContent("Nova atividade será criada: ROÇADA · Pasto 01 · nov/26");
    fireEvent.change(within(janela).getByTestId("registro-areas-hectares-ar1"), { target: { value: "5" } });
    const antes = escritas().length;
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(escritas().length).toBe(antes + 1));
    const w = ultimaEscrita();
    expect(w.method).toBe("POST");
    expect(w.path).toBe("/atividades/registrar");
    expect(w.body).toMatchObject({ empresa_id: "emp-1", areas: [{ area_id: "ar1", hectares: "5" }], tipo_atividade_id: "t2", data_operacional: HOJE });
    expect(w.body.area_id).toBeUndefined();
    expect(w.body.area_executada_dia).toBeUndefined();
    expect(typeof w.body.operation_id).toBe("string");
    expect(w.body.cliente_id).toBeUndefined();
    await waitFor(() => expect(screen.queryByTestId("janela-registro-de-campo")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "ROÇADA registrada em Pasto 01.");
  });

  it("LA-REGISTRAR-4 — sem o tipo não há formulário; com o tipo, sem a área e a operação, não grava e aponta os campos", async () => {
    await montarComLista();
    fireEvent.click(screen.getByRole("button", { name: "Nova atividade" }));
    const janela = await screen.findByTestId("janela-registro-de-campo");
    // D-PROD-265: sem tipo, só os cartões (nada para salvar).
    expect(within(janela).queryByTestId("registro-de-campo-form")).toBeNull();
    expect(within(janela).queryByRole("button", { name: "Salvar" })).toBeNull();
    fireEvent.click(within(janela).getByRole("button", { name: "Aplicação" }));
    await within(janela).findByTestId("registro-de-campo-form");
    expect(within(janela).getByRole("button", { name: "Salvar" })).toBeDisabled();
    const antes = escritas().length;
    fireEvent.submit(within(janela).getByTestId("registro-de-campo-form"));
    expect(await within(janela).findByText("Escolha a área.")).toBeTruthy();
    expect(within(janela).getByText("Escolha a operação.")).toBeTruthy();
    expect(escritas().length).toBe(antes);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("LA-VARIOS-DIAS — a linha do serviço: \"+ Lançar dia\" e \"Concluir\" (D-PROD-267)", () => {
  it("LA-VARIOS-DIAS-1 — \"+ Lançar dia\" abre a Nova realização do serviço já no formulário: a operação, a área e hoje (sem Trocar tipo)", async () => {
    await montarComLista();
    fireEvent.click(within(/** @type {HTMLElement} */ (screen.getByTestId("atividade-status-a1"))).getByRole("button", { name: "Lançamento" }));
    const janela = await screen.findByTestId("janela-registro-de-campo");
    // D-PROD-281: o "Novo lançamento" abre curto; "Mudar" mostra o formulário inteiro.
    expect(await within(janela).findByTestId("registro-de-campo-titulo")).toHaveTextContent(/^Novo lançamento$/);
    fireEvent.click(await within(janela).findByTestId("registro-de-campo-mudar"));
    await within(janela).findByTestId("registro-de-campo-form");
    expect(within(janela).queryByRole("button", { name: "Trocar tipo" })).toBeNull();
    expect(within(janela).getByRole("combobox", { name: /Operação/ })).toHaveTextContent("APLICAÇÃO");
    expect(within(janela).getByTestId("registro-areas-linha-ar1")).toBeTruthy();
    expect(within(janela).getByTestId("registro-areas-hectares-ar1")).toHaveValue("");
    expect(within(janela).getByTestId("registro-de-campo-data")).toHaveValue(HOJE);
    // O último dia do serviço é lido para a máquina e a equipe (os apontamentos da atividade).
    await waitFor(() => expect(backend.chamadas.some((c) => c.method === "GET" && c.path === "/atividades/a1/apontamentos")).toBe(true));
    // Nada foi gravado só por abrir.
    expect(escritas()).toEqual([]);
  });

  it("LA-VARIOS-DIAS-2 — aos 100% \"100%, falta concluir\" em negrito e só \"Concluir\"; o diálogo sugere o último dia e manda {empresa_id, versao, data_conclusao}", async () => {
    atividades.set("a1", { ...atividades.get("a1"), andamento: { ...ATV_A1.andamento, hectares_feitos: "40.0000", percentual: "100.00" } });
    await montarComLista();
    const celula = /** @type {HTMLElement} */ (screen.getByTestId("atividade-status-a1"));
    expect(within(celula).getByText("Tudo feito · falta finalizar").tagName).toBe("STRONG");
    expect(within(celula).getAllByRole("button").map((b) => b.textContent)).toEqual(["Finalizar"]);
    fireEvent.click(within(celula).getByRole("button", { name: "Finalizar" }));
    const dialogo = await screen.findByTestId("dialogo-concluir-servico");
    expect(within(dialogo).getByTestId("dialogo-concluir-servico-titulo")).toHaveTextContent("Finalizar atividade");
    expect(within(dialogo).getByTestId("dialogo-concluir-servico-nome")).toHaveTextContent("APLICAÇÃO · Pasto 01");
    expect(within(dialogo).getByTestId("dialogo-concluir-servico-dia")).toHaveValue("2026-11-12");
    expect(within(dialogo).getByTestId("dialogo-concluir-servico-hectares")).toHaveTextContent("40 de 40 ha (100%)");
    fireEvent.click(within(dialogo).getByTestId("dialogo-concluir-servico-enviar"));
    await waitFor(() => expect(ultimaEscrita()).toEqual({ method: "POST", path: "/atividades/a1/concluir", query: {}, body: { empresa_id: "emp-1", versao: 4, data_conclusao: "2026-11-12" } }));
    await waitFor(() => expect(screen.queryByTestId("dialogo-concluir-servico")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Atividade nº 3 finalizada.");
  });
});

describe("LA-E2E — ajustes do teste de ponta a ponta da Entrega 2 (D-PROD-274)", () => {
  /** A Manutenção sem área, no local (como o servidor devolve: sem área, com o local, a produção e a unidade). */
  const semArea = () => ({
    ...ATV_A1,
    id: "a9", numero: "9", nome: "REFORMA DE CERCA · DIVISA NORTE · nov/26", tipo_atividade_id: "t2", tipo_atividade_nome: "REFORMA DE CERCA",
    area_id: null, area: null, setor_id: null, setor_nome: null, areas: [], areas_count: 0, local: "DIVISA NORTE", bem_id: null, bem: null,
    area_planejada: null, area_executada: null, quantidade_produzida: "2.5000", unidade_producao_id: null, unidade_producao_sigla: "KM", unidade_producao: null,
    createdAt: "2026-11-13T12:00:00.000Z",
    andamento: { ...ATV_A1.andamento, tipo_fixo: "BENFEITORIA", hectares_feitos: null, hectares_area: null, percentual: null, ultimo_dia: "2026-11-13" },
  });

  it("LA-E2E-1 — a lista: o serviço sem área mostra o local e a quantidade (nunca \"0 ha\"); o plantio mostra o capim embaixo da operação", async () => {
    atividades.set("a9", semArea());
    atividades.set("a8", {
      ...ATV_A1, id: "a8", numero: "8", tipo_atividade_nome: "SEMEADURA DE CAPIM", createdAt: "2026-11-13T13:00:00.000Z",
      plantio: { cultura_id: "c-mom", cultura: { id: "c-mom", codigo: "007", nome: "PANICUM CV. MOMBAÇA" }, forma_plantio: null },
    });
    await montarComLista();
    expect(screen.getByTestId("servico-andamento-a9")).toHaveTextContent(/^DIVISA NORTE · 2,5 km · último dia 13\/11$/);
    expect(screen.getByTestId("atividade-status-a9").textContent).not.toMatch(/\d ha/);
    expect(screen.getByTestId("servico-capim-a8")).toHaveTextContent("capim PANICUM CV. MOMBAÇA");
    expect(screen.queryByTestId("servico-capim-a1")).toBeNull();
  });

  it("LA-E2E-2 — o Resumo da atividade sem área mostra \"Local: DIVISA NORTE\" no lugar da Área", async () => {
    atividades.set("a9", semArea());
    await montarComLista();
    const cabecalho = await abrir("a9");
    expect(rotulos(cabecalho)).toContain("Local");
    expect(rotulos(cabecalho)).not.toContain("Área");
    expect(within(cabecalho).getByTestId("atividade-local")).toHaveValue("DIVISA NORTE");
  });

  it("LA-E2E-3 — o Resumo da Aplicação mostra o \"Pasto liberado em\" que o servidor calcula na leitura; o do Plantio, o capim", async () => {
    atividades.set("a1", { ...atividades.get("a1"), pasto_liberado_em: "2026-12-03", carencia_dias: 21 });
    await montarComLista();
    const cabecalho = await abrir("a1");
    expect(within(cabecalho).getByTestId("atividade-pasto-liberado")).toHaveTextContent("03/12/2026");
    expect(within(cabecalho).getByTestId("atividade-pasto-liberado-nota")).toHaveTextContent("último dia lançado + carência do produto (21 dias)");
    expect(within(cabecalho).queryByTestId("atividade-capim")).toBeNull();
  });

  it("LA-E2E-4 — Aplicação sem carência: \"Pasto liberado em\" = \"—\"; fora da Aplicação, o campo não aparece", async () => {
    // O servidor manda as chaves nulas sem produto com carência.
    atividades.set("a1", { ...atividades.get("a1"), pasto_liberado_em: null, carencia_dias: null });
    atividades.set("a9", { ...semArea(), pasto_liberado_em: null, carencia_dias: null });
    await montarComLista();
    const cabecalho = await abrir("a1");
    await waitFor(() => expect(within(cabecalho).getByTestId("atividade-pasto-liberado")).toHaveTextContent(/^—$/));
    expect(within(cabecalho).getByTestId("atividade-pasto-liberado-nota")).toHaveTextContent("sem produto com carência no cadastro");
    cleanup();
    await montarComLista();
    const daManutencao = await abrir("a9");
    expect(within(daManutencao).queryByTestId("atividade-pasto-liberado")).toBeNull();
  });
});
