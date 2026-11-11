import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaAbastecimentos, { ABASTECIMENTOS_CAMPOS_CARD, ABASTECIMENTOS_COLUNAS, ABASTECIMENTOS_STORAGE_KEY, valorDoCampoAbastecimento } from "@/components/patrimonio/TabelaAbastecimentos";
import FormularioAbastecimento, { FORMULARIO_ABASTECIMENTO_ID, chaveProdutosDoBem } from "@/components/patrimonio/FormularioAbastecimento";
import ConsultaAbastecimento from "@/components/patrimonio/ConsultaAbastecimento";
import PainelConsumoBem from "@/components/patrimonio/PainelConsumoBem";
import { DialogoCancelarAbastecimento, DialogoPreviaAbastecimento } from "@/components/patrimonio/DialogosAbastecimento";
import { FiltroOpcoes } from "@/components/patrimonio/PatrimonioFormParts";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaAbastecimento, useEmpresaRealSelecionadaId } from "@/hooks/usePatrimonioSessao";
import { useAuth } from "@/lib/AuthContext";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { hojeNoFuso } from "@/lib/diaCivil";
import { lerErroGestao } from "@/lib/gestaoErros";
import { ehNaoEncontradoPatrimonio, mensagemErroAbastecimento } from "@/lib/patrimonioErros";
import {
  assinaturaDoFormulario,
  formatarQuantidade,
  formularioVazio,
  rotuloDoBem,
  tanqueDoFormulario,
  totaisConfirmados,
  unidadeDoFormulario,
  validarFormulario,
} from "@/lib/abastecimentoRegras";
import { listEmpresas } from "@/services/empresaService";
import { refreshMapaCacheEntry } from "@/services/mapaCacheService";
import {
  ACAO_CANCELAR,
  ACAO_CONFIRMAR,
  ALVO_NOVO_ABASTECIMENTO,
  cancelarAbastecimento,
  confirmarAbastecimento,
  detalharAbastecimento,
  limparPendenciaDoAbastecimento,
  listarAbastecimentosPagina,
  listarOpcoesAbastecimento,
  pendenciaDoAbastecimento,
  previaDoAbastecimento,
} from "@/services/abastecimentoService";

const QUERY_RAIZ = "patrimonio-abastecimentos";
/** Opções dos seletores da tela (SeletorPaginadoGestao põe este prefixo). */
const CHAVE_OPCOES_ABASTECIMENTO = ["lancamentos-financeiros-gestao", "opcoes", "patrimonio", "abastecimento"];

const OPCOES_SITUACAO = [
  { value: "TODOS", label: "Todas as situações" },
  { value: "CONFIRMADO", label: "Confirmados" },
  { value: "CANCELADO", label: "Cancelados" },
];

/**
 * Consultas que as telas antigas de estoque invalidam depois de gravar (cópia
 * local do predicado da Central de Lançamentos) e, do cache do Mapa, a de lotes.
 * @param {unknown} chave
 */
const ehConsultaDeEstoque = (chave) =>
  Array.isArray(chave) &&
  ([
    "estoque-lotes-transferencia",
    "saldo-deposito",
    "lotes-nota-suplementacao",
    "produtos",
    "movimentacoes",
    "historico-deposito",
    "movimentacoes-deposito-detalhe",
    "mapa-estoque-lotes",
  ].includes(chave[0]) ||
    (chave[0] === "mapa-cache" && chave[1] === "estoqueLotes"));

/** Códigos que mudam a verdade da tela: relê tanques, saldos e opções. */
const RELER_NOS_ERROS = new Set([
  "ESTOQUE_SALDO_INSUFICIENTE",
  "ABASTECIMENTO_TANQUE_INVALIDO",
  "ABASTECIMENTO_LOCAL_INVALIDO",
  "ABASTECIMENTO_BEM_INELEGIVEL",
  // D-PROD-162: o tanque deixou de aceitar o Produto (aceite retirado em Bens), o Produto ficou inativo
  // ou foi para outra fazenda, ou a unidade dele saiu de L/KG: a opção do formulário ficou velha;
  // relida, a reconciliação tira o Produto que saiu.
  "ABASTECIMENTO_PRODUTO_NAO_ACEITO",
  "ABASTECIMENTO_PRODUTO_INVALIDO",
  "ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL",
  "ABASTECIMENTO_STATUS_INVALIDO",
  "PATRIMONIO_VERSAO_CONFLITO",
  "ABASTECIMENTO_NAO_ENCONTRADO",
  "ABASTECIMENTO_CANCELAMENTO_BLOQUEADO",
  "MEDIDOR_LEITURA_REGRESSIVA",
  "MEDIDOR_LEITURA_ACIMA_POSTERIOR",
]);

/**
 * Abastecimentos (Patrimônio e Frota P1-02, D-PROD-159; simplificados pela
 * D-PROD-162) — da EMPRESA selecionada.
 *
 * Lista keyset com filtros (bem, produto, situação, período) e busca no
 * servidor (nº, referência); coluna Quantidade = número + unidade do Produto.
 * Novo abastecimento: máquina → PRODUTO (dos "Produtos aceitos" dos tanques do
 * bem) → tanque (se > 1) → local → quantidade na unidade do Produto (L ou kg) →
 * medidor → "Completou o tanque?" → REVISÃO = prévia no servidor (sem escrita:
 * baixa EXATA na unidade do Produto, lotes FIFO, custo estimado, medidor,
 * bloqueios) → confirmação com `operation_id` persistente (duplo clique = 1
 * envio; sem resposta = resultado incerto, nunca sucesso; repetir reaproveita a
 * chave). O registro gravado é só CONSULTA: quantidade e unidade, custo FIFO
 * final, lotes, movimento e estorno, leitura, consumo; o cancelamento (ação
 * própria `cancelar`) estorna exatamente aos lotes de origem. Sem fator kg/L e
 * sem tipo de combustível (D-PROD-162).
 *
 * Salvaguardas de Gestão: sem empresa real nada é lido; trocar de empresa
 * fecha registro e diálogos e descarta respostas atrasadas.
 */
export default function AbastecimentosTela() {
  const queryClient = useQueryClient();
  const { clienteId } = useAuth();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaAbastecimento();
  const escopo = `${clienteId || "sem-tenant"}:${acoes.login || "sem-login"}`;

  const [bemFiltro, setBemFiltro] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [produtoFiltro, setProdutoFiltro] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [statusFiltro, setStatusFiltro] = useState("TODOS");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const periodoInvertido = Boolean(dataDe && dataAte && dataDe > dataAte);

  // Fuso da FAZENDA (o "hoje" do abastecimento): mesmo resumo de empresas do Layout.
  const empresasQuery = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listEmpresas(),
    enabled: Boolean(empresaId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const fuso = useMemo(() => {
    const empresa = (Array.isArray(empresasQuery.data) ? empresasQuery.data : []).find((e) => String(e?.id) === String(empresaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresasQuery.data, empresaId]);
  const fusoOk = Boolean(fuso);
  const semFuso = Boolean(empresaId) && empresasQuery.isSuccess && !fuso;
  const hoje = hojeNoFuso(fuso);

  const [form, setFormEstado] = useState(() => formularioVazio(hoje));
  const setForm = useCallback((/** @type {(f: any) => any} */ atualizar) => setFormEstado(atualizar), []);
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const limparErro = useCallback((/** @type {string} */ campo) => setErros((e) => (e[campo] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== campo)) : e)), []);
  const [previa, setPrevia] = useState(/** @type {{ seq: number, assinatura: string, form: any, resposta: { plano: any, bloqueios: any[] }, empresaId: string } | null} */ (null));
  const seqPrevia = useRef(0);
  const [previaAberta, setPreviaAberta] = useState(false);
  const [previando, setPreviando] = useState(false);
  const previandoRef = useRef(false);
  const [cancelando, setCancelando] = useState(/** @type {any} */ (null));
  const [consumoBem, setConsumoBem] = useState(/** @type {any} */ (null));

  const listEnabled = Boolean(empresaId) && acoes.ver && !periodoInvertido;

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarAbastecimentosPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
        bemId: bemFiltro?.id ?? null,
        produtoId: produtoFiltro?.id ?? null,
        status: statusFiltro !== "TODOS" ? statusFiltro : null,
        dataDe: dataDe || null,
        dataAte: dataAte || null,
      }),
    [empresaId, bemFiltro, produtoFiltro, statusFiltro, dataDe, dataAte],
  );

  const controller = useCadastroBase1Controller({
    storageKey: ABASTECIMENTOS_STORAGE_KEY,
    columnIds: ABASTECIMENTOS_CAMPOS_CARD,
    listEnabled,
    queryKey: [QUERY_RAIZ, "page", empresaId, bemFiltro?.id ?? null, produtoFiltro?.id ?? null, statusFiltro, dataDe, dataAte],
    fetchPage,
    duplicateLabelField: "numero",
    searchPlaceholder: "Buscar nº ou referência…",
    exportFileName: "abastecimentos.csv",
    exportColumns: ABASTECIMENTOS_COLUNAS,
    getExportFieldValue: valorDoCampoAbastecimento,
    getRecordTitle: (item) => (item?.id ? `Abastecimento nº ${item.numero ?? ""}` : "Novo abastecimento"),
    getRecordCode: (item) => (item?.id && item?.numero != null ? String(item.numero) : undefined),
    getSearchHaystack: (a) => [a.numero, a.referencia_externa, rotuloDoBem(a.bem), a.produto?.nome].filter((v) => v != null).join(" "),
    mapSearchSuggestion: (a) => ({ id: String(a.id), label: `Nº ${a.numero ?? ""} — ${rotuloDoBem(a.bem)}`, secondary: a.referencia_externa || undefined }),
    matchRowId: (a, id) => String(a.id) === String(id),
    getRowId: (a) => String(a.id),
    findRowById: (rows, id) => rows.find((a) => String(a.id) === String(id)),
    // O formulário não "salva": o ✓ e o botão "Revisar abastecimento" pedem a prévia.
    onSubmitRecord: () => {},
    // Abastecimento não se apaga: cancela com estorno (ação própria).
    onRequestDeleteMutation: () => {},
  });

  // Troca de empresa: nada da empresa anterior continua na tela.
  const empresaAnterior = useRef(empresaId);
  const trocandoEmpresa = empresaAnterior.current !== empresaId;
  const { closeForm } = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
    setPrevia(null);
    setPreviaAberta(false);
    setCancelando(null);
    setConsumoBem(null);
    setBemFiltro(null);
    setProdutoFiltro(null);
    setErros({});
  }, [empresaId, closeForm]);
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {string|null} emp */
  const daEmpresaAtual = (emp) => Boolean(emp) && emp === empresaAtual.current;

  // Registro aberto: a lista traz o RESUMO; a consulta usa o DETALHE.
  const registroLista = controller.editingItem;
  const idAberto = controller.showForm && registroLista?.id ? String(registroLista.id) : null;
  const detalheQuery = useQuery({
    queryKey: [QUERY_RAIZ, "detalhe", empresaId, idAberto],
    queryFn: () => detalharAbastecimento(empresaId, /** @type {string} */ (idAberto)),
    enabled: Boolean(empresaId && idAberto && acoes.ver && !trocandoEmpresa),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const detalhe = /** @type {any} */ (detalheQuery.data ?? null);
  useEffect(() => {
    if (!detalheQuery.error) return;
    if (ehNaoEncontradoPatrimonio(detalheQuery.error)) {
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "page"] });
      closeForm();
    }
    notifyWarning("Atenção", mensagemErroAbastecimento(detalheQuery.error, "Não foi possível abrir o abastecimento."));
  }, [detalheQuery.error]);

  /** Novo abastecimento: formulário em branco no "hoje" da fazenda. */
  const abrirNovo = () => {
    setFormEstado(formularioVazio(hoje));
    setErros({});
    setPrevia(null);
    controller.openNew();
  };

  /** Mostra o detalhe devolvido pelo servidor (somente leitura). @param {any} registro @param {string} emp */
  const abrirRegistro = (registro, emp) => {
    if (!registro || typeof registro !== "object" || !registro.id) return;
    queryClient.setQueryData([QUERY_RAIZ, "detalhe", emp, String(registro.id)], registro);
    if (!daEmpresaAtual(emp)) return;
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.setShowForm(true);
    controller.recordHelpers.bumpFormEpoch();
    controller.recordHelpers.chrome.onSelectionChange([String(registro.id)]);
  };

  /**
   * Baixa (ou devolução) física de estoque: lista e detalhes desta tela, detalhe
   * do bem (leitura do medidor), consultas de estoque, refresh FORÇADO do cache
   * do Mapa e o evento "atualizar-mapa".
   * @param {any} registro @param {string} emp
   */
  const avisarEstoqueAlterado = (registro, emp) => {
    queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
    queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_ABASTECIMENTO });
    const bemId = registro?.bem?.id;
    if (bemId) queryClient.invalidateQueries({ queryKey: ["bens-patrimoniais", "detalhe", emp, String(bemId)] });
    queryClient.invalidateQueries({ predicate: (q) => ehConsultaDeEstoque(q.queryKey) });
    Promise.all([refreshMapaCacheEntry("estoqueLotes", emp, { force: true }), refreshMapaCacheEntry("movimentacaoEstoque", emp, { force: true })]).catch(() => {});
    window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["estoqueLotes"] } }));
  };

  /** @param {any} registro @param {string} emp @param {'confirmar'|'cancelar'} tipo */
  const concluirComando = (registro, emp, tipo) => {
    avisarEstoqueAlterado(registro, emp);
    const repetido = registro?.replay === true ? " (envio repetido: nada foi duplicado)" : "";
    // A quantidade na unidade GRAVADA no abastecimento (L ou kg), nunca "kg" fixo.
    const quantidade = formatarQuantidade(registro?.quantidade, registro?.unidade);
    if (tipo === "confirmar") notifySuccess("Abastecimento confirmado", `Abastecimento nº ${registro?.numero ?? ""} confirmado: ${quantidade} baixados do estoque.${repetido}`);
    else notifySuccess("Abastecimento cancelado", `Abastecimento nº ${registro?.numero ?? ""} cancelado: ${quantidade} devolvidos aos lotes de origem.${repetido}`);
    if (!daEmpresaAtual(emp)) return;
    if (tipo === "confirmar") {
      setPreviaAberta(false);
      setPrevia(null);
    } else setCancelando(null);
    abrirRegistro(registro, emp);
  };

  /** Recusa que muda a verdade da tela: relê o que depende dela. @param {unknown} erro @param {string} emp */
  const reagirAoErro = (erro, emp) => {
    const { code } = lerErroGestao(erro);
    if (!code || !RELER_NOS_ERROS.has(code)) return;
    queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
    queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_ABASTECIMENTO });
    if (code === "ABASTECIMENTO_NAO_ENCONTRADO" && daEmpresaAtual(emp)) {
      setCancelando(null);
      closeForm();
    }
  };

  // ─── Prévia e confirmação ────────────────────────────────────────────
  const situacaoPrevia = !previa ? "nenhuma" : previa.assinatura === assinaturaDoFormulario(form) ? "valida" : "invalidada";

  const pedirPrevia = async () => {
    if (!empresaId || !acoes.criar || previandoRef.current) return;
    // Capacidade (litros) do tanque escolhido entre os que aceitam o Produto (opção do servidor): só vale para Produto em L.
    const v = validarFormulario(form, { hoje, capacidadeLitros: tanqueDoFormulario(form)?.capacidade_litros ?? null, unidade: unidadeDoFormulario(form) });
    setErros(v.erros);
    if (Object.keys(v.erros).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    previandoRef.current = true;
    setPreviando(true);
    const emp = empresaId;
    const snapshot = form;
    const assinatura = assinaturaDoFormulario(form);
    try {
      const resposta = await previaDoAbastecimento(emp, snapshot);
      if (!daEmpresaAtual(emp)) return;
      seqPrevia.current += 1;
      setPrevia({ seq: seqPrevia.current, assinatura, form: snapshot, resposta, empresaId: emp });
      // Bloqueio que muda a verdade da tela (aceite retirado, Produto inativo, tanque inativo…) relê como a
      // recusa da confirmação: a reconciliação do formulário tira a escolha que saiu e oferece a nova.
      const unidadeServidor = resposta.plano?.produto?.unidade_principal_estoque ?? null;
      if ((Array.isArray(resposta.bloqueios) ? resposta.bloqueios : []).some((b) => RELER_NOS_ERROS.has(String(b?.code ?? "")))) {
        queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
        queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_ABASTECIMENTO });
      } else if (unidadeServidor && unidadeServidor !== (snapshot.produto?.unidade_principal_estoque ?? null)) {
        // Sem bloqueio, mas a unidade do Produto que o servidor leu agora difere da opção do formulário (L ↔ KG):
        // relê só as opções do bem (a reconciliação reaplica a opção nova; a revisão já mostra a unidade do servidor).
        queryClient.invalidateQueries({ queryKey: chaveProdutosDoBem(emp, snapshot.bem?.id ? String(snapshot.bem.id) : null) });
      }
      setPreviaAberta(true);
    } catch (erro) {
      reagirAoErro(erro, emp);
      notifyWarning("Atenção", mensagemErroAbastecimento(erro, "Não foi possível calcular a revisão. Nada foi gravado."));
    } finally {
      previandoRef.current = false;
      setPreviando(false);
    }
  };

  /** @param {unknown} _arg @param {{ retentativa: boolean }} opcoes */
  const confirmarDaPrevia = async (_arg, { retentativa }) => {
    const p = previa;
    if (!p) return;
    const emp = p.empresaId;
    try {
      const registro = await confirmarAbastecimento(emp, p.form, p.resposta.plano, { escopo, retentativa });
      concluirComando(registro, emp, "confirmar");
    } catch (erro) {
      reagirAoErro(erro, emp);
      throw erro;
    }
  };

  /** "Consultar" depois do resultado incerto: procura o abastecimento pela chave pendente. */
  const consultarConfirmacao = async () => {
    const emp = previa?.empresaId ?? empresaId;
    if (!emp) return "Selecione a fazenda.";
    const pendencia = pendenciaDoAbastecimento(escopo, ACAO_CONFIRMAR, emp, ALVO_NOVO_ABASTECIMENTO);
    if (!pendencia) return "Não há envio pendente deste abastecimento: confira a lista.";
    try {
      const pagina = await listarAbastecimentosPagina(emp, { operationId: pendencia.operation_id, limit: 1 });
      const achado = pagina.items?.[0];
      if (!achado?.id) return "O envio não foi gravado. Você pode repetir o mesmo envio.";
      // A pendência só sai DEPOIS do detalhe: se ele falhar, repetir manda a MESMA chave (replay), nunca um 2º abastecimento.
      let registro;
      try {
        registro = await detalharAbastecimento(emp, String(achado.id));
      } catch {
        const numero = achado.numero ? ` nº ${achado.numero}` : "";
        return `O abastecimento${numero} foi gravado, mas não foi possível abri-lo agora. Consulte de novo ou abra pela lista; repetir o mesmo envio não grava outro.`;
      }
      limparPendenciaDoAbastecimento(escopo, ACAO_CONFIRMAR, emp, ALVO_NOVO_ABASTECIMENTO);
      concluirComando(registro, emp, "confirmar");
      return null;
    } catch (erro) {
      return mensagemErroAbastecimento(erro, "Não foi possível consultar agora. Tente de novo.");
    }
  };

  // ─── Cancelamento ───────────────────────────────────────────────────
  /** @param {string} motivo @param {{ retentativa: boolean }} opcoes */
  const enviarCancelamento = async (motivo, { retentativa }) => {
    const registro = cancelando;
    const emp = empresaId;
    if (!registro || !emp) return;
    try {
      const r = await cancelarAbastecimento(emp, registro, { motivo, escopo, retentativa });
      concluirComando(r, emp, "cancelar");
    } catch (erro) {
      reagirAoErro(erro, emp);
      throw erro;
    }
  };

  const consultarCancelamento = async () => {
    const registro = cancelando;
    const emp = empresaId;
    if (!registro || !emp) return null;
    try {
      const atual = /** @type {any} */ (await detalharAbastecimento(emp, String(registro.id)));
      if (atual?.status !== "CANCELADO") return "O cancelamento não foi gravado. Você pode repetir o mesmo envio.";
      limparPendenciaDoAbastecimento(escopo, ACAO_CANCELAR, emp, String(registro.id));
      concluirComando(atual, emp, "cancelar");
      return null;
    } catch (erro) {
      return mensagemErroAbastecimento(erro, "Não foi possível consultar agora. Tente de novo.");
    }
  };

  // ─── Avisos e filtros ───────────────────────────────────────────────
  const listErrorMessage = useMemo(
    () => mensagemErroAbastecimento(controller.listaQueryError, "Não foi possível carregar os abastecimentos. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  let aviso = null;
  if (!empresaId) {
    aviso = <AvisoGestao testId="abastecimento-sem-empresa">Selecione uma fazenda para ver e lançar abastecimentos.</AvisoGestao>;
  } else if (acoes.carregando) {
    aviso = (
      <AvisoGestao tone="blue" testId="abastecimento-carregando">
        Carregando permissões…
      </AvisoGestao>
    );
  } else if (!acoes.ver) {
    aviso = <AvisoGestao testId="abastecimento-sem-permissao">Você não tem permissão para ver os abastecimentos desta fazenda.</AvisoGestao>;
  }

  const filtros =
    empresaId && acoes.ver && !controller.showForm ? (
      <div className="cadastro-b1 mg-card mb-2 p-2" data-testid="abastecimento-filtros">
        <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2">
          <SeletorPaginadoGestao
            rotulo="Bem"
            testId="abastecimento-filtro-bem"
            chave={["patrimonio", "abastecimento", "bens-filtro", empresaId]}
            buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("bens", empresaId, { q, cursor, limit, uso: "filtro" })}
            value={bemFiltro}
            onChange={(o) => setBemFiltro(o ? { id: String(o.id), rotulo: rotuloDoBem(o) } : null)}
            rotuloDaOpcao={rotuloDoBem}
            permitirLimpar
            textoVazio="Todos os bens"
            span={3}
            maiusculas={false}
          />
          <SeletorPaginadoGestao
            rotulo="Produto"
            testId="abastecimento-filtro-produto"
            chave={["patrimonio", "abastecimento", "produtos-filtro", empresaId]}
            buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("produtos-filtro", empresaId, { q, cursor, limit })}
            value={produtoFiltro}
            onChange={(o) => setProdutoFiltro(o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null)}
            permitirLimpar
            textoVazio="Todos os produtos"
            span={3}
            maiusculas={false}
          />
          <CampoDia label="De" value={dataDe} onChange={setDataDe} span={3} testId="abastecimento-filtro-de" />
          <CampoDia label="Até" value={dataAte} onChange={setDataAte} span={3} testId="abastecimento-filtro-ate" />
        </div>
        {periodoInvertido ? (
          <p role="alert" className="mt-1 text-[12px] text-red-700" data-testid="abastecimento-periodo-invertido">
            A data final do período é anterior à inicial.
          </p>
        ) : null}
      </div>
    ) : null;

  const listaVazia = listEnabled && !controller.showForm && !controller.isLoading && !controller.listaErro && controller.visibleRows.length === 0;
  const totais = !controller.showForm && controller.visibleRows.length ? totaisConfirmados(controller.visibleRows) : null;

  const banner = (
    <>
      {aviso}
      {semFuso && acoes.ver ? (
        <AvisoGestao testId="abastecimento-sem-fuso">
          Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de lançar abastecimentos.
        </AvisoGestao>
      ) : null}
      {filtros}
      {listaVazia ? <AvisoGestao testId="abastecimento-lista-vazia">Nenhum abastecimento encontrado com estes filtros.</AvisoGestao> : null}
      {totais && totais.quantidade ? (
        <p className="mb-2 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="abastecimento-totais">
          Confirmados na lista: {totais.quantidade}
          {totais.totais.map((t) => ` · ${formatarQuantidade(t.total, t.unidade)}`).join("")}
        </p>
      ) : null}
    </>
  );

  // ─── Conteúdo do registro ───────────────────────────────────────────
  let conteudoRegistro = null;
  if (controller.showForm) {
    if (idAberto) {
      conteudoRegistro = detalhe ? (
        <ConsultaAbastecimento
          key={`${idAberto}-${detalhe.versao ?? 0}-${controller.formEpoch}`}
          detalhe={detalhe}
          fuso={fuso}
          podeCancelar={acoes.cancelar}
          onCancelar={() => setCancelando(detalhe)}
          onVerConsumo={() => setConsumoBem(detalhe.bem ?? null)}
        />
      ) : (
        <p className="p-3 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="abastecimento-detalhe-carregando" role="status">
          {detalheQuery.isError ? "Não foi possível abrir o abastecimento." : "Carregando abastecimento…"}
        </p>
      );
    } else if (empresaId && acoes.criar) {
      conteudoRegistro = (
        <FormularioAbastecimento
          key={`novo-${controller.formEpoch}`}
          empresaId={empresaId}
          form={form}
          setForm={setForm}
          hoje={hoje}
          erros={erros}
          limparErro={limparErro}
          previando={previando}
          situacaoPrevia={situacaoPrevia}
          onPrevia={pedirPrevia}
          onReabrirPrevia={() => setPreviaAberta(true)}
        />
      );
    }
  }

  const registroAtual = idAberto ? (detalhe ?? registroLista) : null;

  return (
    // Os botões seguem a regra EXATA do servidor (novo|salvar, cancelar):
    // a heurística de texto do Layout não se aplica ("Confirmar
    // abastecimento" não exige `salvar`).
    <div data-permissao-explicita="" className="contents">
      <CadastroBase1Screen
        permissaoExplicita
        workspaceTitle="Abastecimentos"
        searchPlaceholder="Buscar nº ou referência…"
        createLabel="Novo abastecimento"
        formId={idAberto ? undefined : FORMULARIO_ABASTECIMENTO_ID}
        columnsForCardsToolbar={ABASTECIMENTOS_COLUNAS}
        controller={{ ...controller, saving: previando, openNew: abrirNovo }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.numero != null ? String(registroAtual.numero) : undefined}
        listBanner={banner}
        showCreate={Boolean(empresaId) && acoes.criar && fusoOk}
        showEdit={false}
        showDuplicate={false}
        showDelete={false}
        extraToolbar={
          empresaId && acoes.ver ? <FiltroOpcoes rotulo="Filtrar por situação" value={statusFiltro} onChange={setStatusFiltro} opcoes={OPCOES_SITUACAO} /> : null
        }
        deleteDialog={{
          title: "Cancelar abastecimento",
          confirmText: "Cancelar",
          descriptionOne: "Abastecimento não se exclui: use Cancelar abastecimento.",
          descriptionMany: () => "Abastecimento não se exclui: use Cancelar abastecimento.",
        }}
        recordForm={conteudoRegistro}
        listSlot={
          <TabelaAbastecimentos
            rows={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            emptyText={empresaId ? "Nenhum abastecimento encontrado com estes filtros." : "Selecione uma fazenda"}
            showConfigColunas={controller.showConfigColunas}
            setShowConfigColunas={controller.setShowConfigColunas}
            matchesSearch={controller.matchesSearch}
            resetFiltersKey={controller.chrome.resetFiltersKey}
            onSelectionChange={controller.chrome.onSelectionChange}
            onFiltersActiveChange={controller.chrome.setFiltersActive}
            viewMode={controller.chrome.viewMode === "cards" ? "cards" : "table"}
            cardFields={controller.cardsPrefs.cardFields}
            cardsPerRow={controller.cardsPrefs.cardsPerRow}
            configureColumnsAnchorRef={controller.configureColumnsAnchorRef}
          />
        }
      />

      {previa ? (
        <DialogoPreviaAbastecimento
          key={`previa-${previa.seq}`}
          aberto={previaAberta && situacaoPrevia === "valida"}
          previa={previa.resposta}
          podeConfirmar={acoes.criar}
          onFechar={() => setPreviaAberta(false)}
          onConfirmar={confirmarDaPrevia}
          onConsultar={consultarConfirmacao}
        />
      ) : null}

      {cancelando ? (
        <DialogoCancelarAbastecimento
          key={`cancelar-${cancelando.id}-${cancelando.versao}`}
          aberto
          registro={cancelando}
          onFechar={() => setCancelando(null)}
          onEnviar={enviarCancelamento}
          onConsultar={consultarCancelamento}
        />
      ) : null}

      <PainelConsumoBem aberto={Boolean(consumoBem)} empresaId={empresaId} bem={consumoBem} onFechar={() => setConsumoBem(null)} />
    </div>
  );
}
