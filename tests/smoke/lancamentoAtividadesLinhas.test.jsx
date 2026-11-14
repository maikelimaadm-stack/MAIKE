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
 *  - paridade das allowlists das linhas com os schemas fechados do servidor.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import { API_FAKE, envelope, erroServidor, instalarBackendFake } from "./fixtures/gestaoBackendFake.js";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), ...notify }));

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: "cli-1" }));
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
];
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
  let custo = 0;
  let area = 0;
  for (const a of aps) {
    area += Number(a.area_executada_dia ?? 0);
    for (const l of a.produtos.filter((/** @type {any} */ x) => x.status === "CONFIRMADO")) {
      const t = prods.get(l.produto_id) ?? { produto_id: l.produto_id, nome: l.produto.nome, unidade: l.unidade, q: 0, c: 0 };
      t.q += Number(l.quantidade);
      t.c += Number(l.custo_total);
      prods.set(l.produto_id, t);
      custo += Number(l.custo_total);
    }
    for (const l of a.maquinas.filter((/** @type {any} */ x) => x.status === "CONFIRMADO")) {
      const t = maqs.get(l.bem_id) ?? { bem_id: l.bem_id, nome: l.bem.nome, medidor_unidade: l.medidor_unidade, u: 0, c: 0 };
      t.u += Number(l.quantidade_uso);
      t.c += Number(l.custo_total ?? 0);
      maqs.set(l.bem_id, t);
      custo += Number(l.custo_total ?? 0);
    }
  }
  return {
    area_executada: area ? t4(area) : null,
    area_planejada: atv.area_planejada,
    unidade_area: "ha",
    produtos: [...prods.values()].map((t) => ({ produto_id: t.produto_id, nome: t.nome, unidade: t.unidade, quantidade: t4(t.q), custo_total: t4(t.c) })),
    maquinas: [...maqs.values()].map((t) => ({ bem_id: t.bem_id, nome: t.nome, medidor_unidade: t.medidor_unidade, quantidade_uso: t4(t.u), custo_total: t4(t.c) })),
    custo_total: custo ? t4(custo) : null,
    custo_por_ha: custo && area ? t4(custo / area) : null,
  };
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
  const partes = path.split("/").filter(Boolean);
  if (partes[0] === "atividades-opcoes" && method === "GET") {
    const recurso = partes[1];
    if (recurso === "medidor") return { status: 200, body: MEDIDORES[String(query.get("bem_id"))] ?? {} };
    if (recurso === "locais") return { status: 200, body: { itens: LOCAIS[String(query.get("produto_id"))] ?? [] } };
    const itens = recurso === "bens" ? [TRATOR, CAMINHAO] : recurso === "implementos" ? [GRADE] : recurso === "produtos" ? PRODUTOS : [];
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
      apontamentosPorAtividade.set(id, [...lista, ap]);
      return { status: 201, body: { apontamento: ap, atividade: atv, alertas: [] } };
    });
  }
  const apId = partes[3];
  const ap = lista.find((a) => a.id === apId);
  if (!ap) return erroServidor(404, "ATIVIDADE_APONTAMENTO_NOT_FOUND");
  if (partes.length === 4 && method === "GET") return { status: 200, body: ap };
  const tipo = partes[4];
  if (tipo !== "produtos" && tipo !== "maquinas") return undefined;
  const salvar = (/** @type {any} */ novo) => {
    apontamentosPorAtividade.set(id, (apontamentosPorAtividade.get(id) ?? []).map((a) => (a.id === apId ? novo : a)));
    return novo;
  };
  // O reenvio igual (mesma operation_id) devolve o gravado ANTES do CAS; o envio novo com versão velha → 409.
  const conflito = () => (body?.versao !== ap.versao ? erroServidor(409, "ATIVIDADE_VERSAO_CONFLITO", { details: { entidade: "apontamento" } }) : null);
  const nova = tipo === "produtos" ? novaLinhaProduto : novaLinhaMaquina;
  if (partes.length === 5 && method === "POST") {
    return comIdempotencia(body.operation_id, () => {
      const c = conflito();
      if (c) return c;
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
      const substituta = nova({ ...linha, ...dados }, ap);
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
  ]);
  tiposSrv.listarTiposAtividade.mockResolvedValue(TIPOS);
  confirmacao.confirmar.mockResolvedValue(true);
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
    expect(await within(janela).findByTestId("linha-produto-disponivel")).toHaveTextContent("Disponível neste local: 30 L");
    fireEvent.change(within(janela).getByTestId("linha-produto-quantidade"), { target: { value: "25" } });
    // Dose/ha = 25 / 10 (área do dia), só leitura.
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
    await waitFor(() => expect(screen.getByTestId("totalizador-produto-p1")).toHaveTextContent("50 L · R$ 250,00"));
  });

  it("LL-PRODUTO-2 — saldo insuficiente: aviso com disponível × pedido antes de enviar e a recusa do servidor com a mensagem do motor", async () => {
    await montar();
    await abrir("a1", "ap1");
    fireEvent.click(screen.getByTestId("apontamento-ap1-adicionar-produto"));
    const janela = await screen.findByTestId("janela-linha-produto");
    await escolherNoSeletor(janela, "linha-produto-produto", /Glifosato/);
    await within(janela).findByTestId("linha-produto-disponivel");
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
    await within(janela).findByTestId("linha-produto-disponivel");
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
    await within(janela).findByTestId("linha-produto-disponivel");
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
    expect(await within(janela).findByTestId("linha-maquina-medidor")).toHaveTextContent("Horímetro (h)");
    expect(backend.chamadas.find((c) => c.path === "/atividades-opcoes/medidor")?.query).toEqual({ empresa_id: "emp-1", bem_id: "b1", data: "2026-11-12" });
    expect(within(janela).getByTestId("linha-maquina-leitura-vigente")).toHaveTextContent("Última leitura: 1.550 h em 12/11/2026 (lançamento de atividade).");
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
    await waitFor(() => expect(screen.getByTestId("totalizador-maquina-b1-h")).toHaveTextContent("16 h · R$ 800,00"));
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
    await within(janela).findByTestId("linha-maquina-medidor");
    fireEvent.click(within(janela).getByRole("radio", { name: /Sem medidor/ }));
    expect(within(janela).queryByTestId("linha-maquina-leitura-final")).toBeNull();
    expect(within(janela).getByText("Uso (h)")).toBeTruthy();
    fireEvent.change(within(janela).getByTestId("linha-maquina-quantidade-uso"), { target: { value: "6" } });
    expect(within(janela).getByTestId("linha-maquina-uso")).toHaveTextContent("6 h");
    fireEvent.click(within(janela).getByTestId("janela-linha-maquina-salvar"));
    await waitFor(() => expect(escritas()).toHaveLength(1));
    expect(ultimaEscrita().body).toEqual({ empresa_id: "emp-1", versao: 3, operation_id: expect.stringMatching(/^lanc-/), bem_id: "b1", sem_medidor: true, quantidade_uso: "6" });
    await waitFor(() => expect(screen.queryByTestId("janela-linha-maquina")).toBeNull());
    expect(await screen.findByTestId("linha-maquina-ml-n1-leituras")).toHaveTextContent("sem medidor");

    // Caminhão sem medidor que conta: só o uso, sem a escolha.
    fireEvent.click(screen.getByTestId("apontamento-ap1-adicionar-maquina"));
    janela = await screen.findByTestId("janela-linha-maquina");
    await escolherNoSeletor(janela, "linha-maquina-bem", /Caminhão/);
    expect(await within(janela).findByTestId("linha-maquina-sem-medidor-no-bem")).toBeTruthy();
    expect(within(janela).getByTestId("linha-maquina-medidor")).toHaveTextContent("Sem medidor");
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
    expect(within(totais).getByTestId("totalizador-produto-p1")).toHaveTextContent("25 L · R$ 125,00");
    expect(within(totais).queryByTestId("totalizador-produto-p2")).toBeNull();
    expect(within(totais).getByTestId("totalizador-maquina-b1-h")).toHaveTextContent("8 h · R$ 400,00");
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
