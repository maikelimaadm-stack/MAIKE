import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCheck, ChevronLeft, ChevronRight, FlaskConical, Loader2, Pencil, Ban, Plus, ReceiptText, Tractor, User, X } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao, CampoSelect } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import FormularioApontamento from "@/components/lancamento-atividades/FormularioApontamento";
import {
  DialogoCancelarLinha,
  JanelaLinhaMaoObra,
  JanelaLinhaMaquina,
  JanelaLinhaProduto,
  JanelaLinhaServico,
} from "@/components/lancamento-atividades/JanelasDaLinha";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { somarDias } from "@/lib/diaCivil";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import {
  LIMITES_DECIMAL_ATIVIDADE,
  LOCALE_ATIVIDADE,
  STATUS_ABERTA,
  STATUS_CANCELADA,
  STATUS_CANCELADO,
  STATUS_CONCLUIDA,
  acoesDaAtividade,
  formatarDiaAtividade,
  mensagemDeErroAtividade,
  mensagemDoAlertaAtividade,
  rotuloDaArea,
  rotuloDoUsuario,
} from "@/lib/lancamentoAtividadesRegras";
import {
  CAMPO_DO_FORMULARIO_APONTAMENTO,
  campoDoFormulario,
  chaveApontamentos,
  confirmadosDoDia,
  corpoDoApontamento,
  foraDoPeriodo,
  formularioApontamentoVazio,
  itensDaLista,
  rotuloDaPassada,
  textoDoPeriodo,
  validarFormularioApontamento,
} from "@/lib/atividadeApontamentoRegras";
import {
  CAMPO_DO_VALOR_DA_LINHA,
  LINHA_MAO_OBRA,
  LINHA_MAQUINA,
  LINHA_PRODUTO,
  LINHA_SERVICO,
  ROTULO_MEDIDA,
  chaveTotais,
  comMarcaDeTerceiro,
  doseHa,
  formatarCustoLinha,
  formatarDecimalLinha,
  formatarDose,
  formatarQuantidadeLinha,
  formatarQuantidadeMaoObra,
  formatarQuantidadeServico,
  formatarUso,
  linhasDoTipo,
  rotuloDaMaoObraDaLinha,
  rotuloDaMaquinaDaLinha,
  rotuloDoImplementoDaLinha,
  rotuloDoLancamentoNoDia,
  rotuloDoLocalDaLinha,
  rotuloDoParceiroDaLinha,
  rotuloDoProdutoDaLinha,
  rotuloDoServicoDaLinha,
  statusDaLinha,
  totalDasLinhas,
} from "@/lib/atividadeLinhasRegras";
import { listarApontamentos } from "@/services/lancamentoAtividadesService";

/**
 * Os quatro lançamentos por tipo (D-PROD-232 / D-PROD-233, protótipo do proprietário), cada um com a linha que ele
 * grava no dia: Trabalho de máquinas = linhas de máquina, Aplicação de insumos = linhas de produto, Mão de obra =
 * linhas de mão de obra, Custos extras = linhas de serviço. `flag`: o que o TIPO da atividade precisa permitir
 * (máquina não depende de flag). `aba`: o nome da aba da lista.
 * @type {ReadonlyArray<{ tipo: string, rotulo: string, aba: string, flag: 'permiteProduto'|'permiteMaoObra'|'permiteServico'|null, Icone: any }>}
 */
export const LANCAMENTOS_POR_TIPO = Object.freeze([
  { tipo: LINHA_MAQUINA, rotulo: "Trabalho de máquinas", aba: "Trabalhos de máquinas", flag: null, Icone: Tractor },
  { tipo: LINHA_PRODUTO, rotulo: "Aplicação de insumos", aba: "Insumos aplicados", flag: "permiteProduto", Icone: FlaskConical },
  { tipo: LINHA_MAO_OBRA, rotulo: "Mão de obra", aba: "Lançamentos de mão de obra", flag: "permiteMaoObra", Icone: User },
  { tipo: LINHA_SERVICO, rotulo: "Custos extras", aba: "Custos extras", flag: "permiteServico", Icone: ReceiptText },
]);

/** @param {string} tipo */
export const lancamentoDoTipo = (tipo) => LANCAMENTOS_POR_TIPO.find((l) => l.tipo === tipo) ?? null;

/** Texto auxiliar (o tom das notas dos formulários do motor). */
const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

/**
 * Colunas da lista de cada tipo: só o que a linha gravada TEM (nada inventado). `operador` é o do dia (o operador é do
 * lançamento, não da linha).
 * @typedef {{ id: string, rotulo: string, numero?: boolean, valor: (l: any, ap: any) => string }} ColunaDoTipo
 * @type {Record<string, ColunaDoTipo[]>}
 */
const COLUNAS = {
  [LINHA_MAQUINA]: [
    { id: "maquina", rotulo: "Máquina", valor: (l) => rotuloDaMaquinaDaLinha(l) || "Máquina" },
    { id: "implemento", rotulo: "Implemento", valor: (l) => rotuloDoImplementoDaLinha(l) || "—" },
    { id: "operador", rotulo: "Operador", valor: (_l, ap) => rotuloDoUsuario(ap?.operador) || "—" },
    { id: "inicial", rotulo: "Inicial", numero: true, valor: (l) => (l.sem_medidor === true ? "—" : formatarDecimalLinha(l.leitura_inicial) || "—") },
    { id: "final", rotulo: "Final", numero: true, valor: (l) => (l.sem_medidor === true ? "—" : formatarDecimalLinha(l.leitura_final) || "—") },
    { id: "trabalhado", rotulo: "Trabalhado", numero: true, valor: (l) => formatarUso(l.quantidade_uso, l.medidor_tipo, l.medidor_unidade) || "—" },
    { id: "valor", rotulo: "Valor total", numero: true, valor: (l) => formatarCustoLinha(l.custo_total) || "—" },
  ],
  [LINHA_PRODUTO]: [
    { id: "insumo", rotulo: "Insumo", valor: (l) => rotuloDoProdutoDaLinha(l) || "Produto" },
    { id: "local", rotulo: "Almoxarifado", valor: (l) => rotuloDoLocalDaLinha(l) || "—" },
    {
      id: "dose",
      rotulo: "Qtd/ha",
      numero: true,
      valor: (l, ap) => {
        const dose = l.dose_ha ?? doseHa(l.quantidade, ap?.area_executada_dia);
        return dose ? formatarDose(dose, l.unidade) : "—";
      },
    },
    { id: "quantidade", rotulo: "Quantidade total", numero: true, valor: (l) => formatarQuantidadeLinha(l.quantidade, l.unidade) || "—" },
    { id: "unitario", rotulo: "Valor unitário", numero: true, valor: (l) => formatarCustoLinha(l.custo_unitario) || "—" },
    { id: "valor", rotulo: "Valor total", numero: true, valor: (l) => formatarCustoLinha(l.custo_total) || "—" },
  ],
  [LINHA_MAO_OBRA]: [
    { id: "funcionario", rotulo: "Funcionário", valor: (l) => comMarcaDeTerceiro(rotuloDaMaoObraDaLinha(l) || "Funcionário ou terceiro", l) },
    { id: "tipo", rotulo: "Tipo", valor: (l) => ROTULO_MEDIDA[String(l.tipo_medida ?? "")] ?? "—" },
    { id: "quantidade", rotulo: "Quantidade", numero: true, valor: (l) => formatarQuantidadeMaoObra(l.quantidade, l.tipo_medida) || "—" },
    { id: "unitario", rotulo: "Valor unitário", numero: true, valor: (l) => formatarCustoLinha(l.custo_unitario) || "—" },
    { id: "valor", rotulo: "Valor total", numero: true, valor: (l) => formatarCustoLinha(l.custo_total) || "—" },
  ],
  [LINHA_SERVICO]: [
    { id: "servico", rotulo: "Serviço", valor: (l) => rotuloDoServicoDaLinha(l) || "Serviço" },
    { id: "parceiro", rotulo: "Parceiro", valor: (l) => rotuloDoParceiroDaLinha(l) || "—" },
    { id: "documento", rotulo: "Documento", valor: (l) => (typeof l.documento_referencia === "string" && l.documento_referencia.trim()) || "—" },
    { id: "quantidade", rotulo: "Quantidade", numero: true, valor: (l) => formatarQuantidadeServico(l.quantidade, l.unidade) || "—" },
    { id: "unitario", rotulo: "Valor unitário", numero: true, valor: (l) => formatarCustoLinha(l.valor_unitario) || "—" },
    { id: "valor", rotulo: "Valor total", numero: true, valor: (l) => formatarCustoLinha(l.valor_total) || "—" },
  ],
};

/** O nome da linha no menu ⚡ dela. @param {string} tipo @param {any} l */
const nomeDaLinha = (tipo, l) => COLUNAS[tipo]?.[0]?.valor(l, null) ?? "Linha";

// ─── Aba "Dados": o formulário da linha (o MESMO das janelas de linha) com Voltar / Salvar / Salvar e fechar ─

/** O rodapé da janela (alvo dos botões da aba Dados) e o "fechar depois de salvar". */
const ContextoDados = createContext(
  /** @type {{ alvoRodape: HTMLElement | null, marcarFechar: (fechar: boolean) => void }} */ ({ alvoRodape: null, marcarFechar: () => {} }),
);

/**
 * A casca da aba "Dados" (D-PROD-233): o formulário da janela de linha (`JanelasDaLinha`: os campos, a validação, o
 * saldo, o medidor, os custos e o `operation_id` são os MESMOS) embutido na aba, e os botões no rodapé da janela por
 * tipo — Voltar (volta para a lista), Salvar (grava e fica num formulário vazio para o próximo item) e Salvar e fechar.
 * @param {import("@/components/lancamento-atividades/JanelasDaLinha").PropsDaCasca} props
 */
function CascaDaAbaDados({ testId, enviando, incerto, podeEnviar, formId, onFechar, onEnviar, children }) {
  const { alvoRodape, marcarFechar } = useContext(ContextoDados);
  /** @param {boolean} fechar */
  const enviar = (fechar) => {
    marcarFechar(fechar);
    onEnviar();
  };
  const botoes = (
    <>
      <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando} data-testid="janela-tipo-voltar">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar
      </button>
      <button type="button" className={BOTAO_PRIMARIO} onClick={() => enviar(false)} disabled={enviando || !podeEnviar} data-testid="janela-tipo-salvar">
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
        {enviando ? "Salvando…" : incerto ? "Repetir o mesmo envio" : "Salvar"}
      </button>
      <button type="button" className={BOTAO_PRIMARIO} onClick={() => enviar(true)} disabled={enviando || !podeEnviar} data-testid="janela-tipo-salvar-fechar">
        <CheckCheck className="h-4 w-4" aria-hidden />
        Salvar e fechar
      </button>
    </>
  );
  return (
    <>
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          enviar(false);
        }}
        className="b1 mg-b1-form-grid b1-form-embutido"
        data-densidade={DENSIDADE_BASE1}
        noValidate
        data-testid={`${testId}-form`}
      >
        {children}
      </form>
      {alvoRodape ? createPortal(botoes, alvoRodape) : null}
    </>
  );
}

/**
 * Janela de UM tipo de lançamento (D-PROD-233, fatia 2 do redesenho pelo protótipo do proprietário), aberta pelo ⚡ da
 * linha da lista: "Trabalho de máquinas", "Aplicação de insumos", "Mão de obra" ou "Custos extras".
 *
 * Cabeçalho: ícone + o tipo; a linha "Atividade Nº 7 · TIPO · Talhão: ÁREA · Lançamento de DD/MM/AAAA · N ha"; e o
 * DIA do lançamento — hoje (no fuso da fazenda) por padrão, ‹ › para o dia anterior / seguinte (nunca depois de hoje).
 * Regra do dia (aprovada pelo proprietário, "pode ser"): ninguém "cria o dia". Sem lançamento CONFIRMADO na data, o
 * primeiro item salvo cria o lançamento do dia no MESMO envio (`criarApontamento` com a linha dentro — uma transação,
 * `operation_id` persistente), com a área do dia do cabeçalho (opcional, como no servidor); com UM, os itens entram nele
 * (as rotas de linha de sempre); com mais de um (turnos / passadas), um seletor pergunta qual (padrão: o mais recente).
 * A área do dia de um lançamento que existe aparece e muda pelo "Alterar" (o formulário do dia de sempre).
 *
 * Aba 1 "<Tipo> (n)": as linhas CONFIRMADAS daquele tipo no dia escolhido, com as colunas do protótipo que a linha
 * gravada tem, a linha de total (valor) e o ⚡ de cada linha (Editar e Cancelar: as janelas e o diálogo de sempre). As
 * canceladas ficam atrás de "Mostrar canceladas", riscadas, como nos blocos do lançamento. "Inserir" vai para a aba
 * "Dados": o formulário da linha (o MESMO de `JanelasDaLinha`) com Voltar / Salvar / Salvar e fechar. Depois de cada
 * escrita, a lista, os lançamentos e os totais da atividade se relêem (as mesmas chaves da tela).
 *
 * Só leitura: atividade concluída ou cancelada, sem a ação de lançar (Inserir), editar ou cancelar lançamento, sem o
 * fuso da fazenda, ou o tipo que não permite mais aquela linha. No celular, a janela ocupa a tela.
 *
 * @param {{
 *   atividade: any,
 *   tipo: string,
 *   acoes: Record<string, any>,
 *   flags: { permiteProduto: boolean, permiteImplemento: boolean, permiteMaoObra: boolean, permiteServico: boolean },
 *   escopo: string,
 *   onFechar: () => void,
 *   onAtividadeAtualizada?: (atividade: any | null) => void,
 *   abaInicial?: 'lista'|'dados',
 * }} props `acoes`: as da tela (`useAcoesTelaAtividades`); `onAtividadeAtualizada`: depois de toda escrita (o cabeçalho com
 *   os totais recalculados, quando o servidor o devolve) — a tela relê a lista e o totalizador. `abaInicial`: a aba em
 *   que a janela abre (D-PROD-234: "Inserir" / "+ Lançar" da atividade aberta abrem nos Dados; sem poder lançar, a lista).
 */
export default function JanelaLancamentoPorTipo({ atividade, tipo, acoes, flags, escopo, onFechar, onAtividadeAtualizada = undefined, abaInicial = "lista" }) {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const { fuso, hoje } = useFusoDaFazenda(empresaId);
  const celular = useCelular();
  const doTipo = lancamentoDoTipo(tipo) ?? LANCAMENTOS_POR_TIPO[0];
  const atividadeId = atividade?.id ? String(atividade.id) : null;
  const chave = chaveApontamentos(empresaId, atividadeId);

  // ─── Permissões e status ─────────────────────────────────────────────
  const ac = acoesDaAtividade(atividade, acoes);
  const aberta = atividade?.status === STATUS_ABERTA;
  const gravavel = Boolean(empresaId) && Boolean(fuso) && aberta;
  const tipoPermitido = !doTipo.flag || flags?.[doTipo.flag] === true;
  const podeLancar = gravavel && ac.lancarApontamento && tipoPermitido;
  const podeEditar = gravavel && ac.editarApontamento;
  const podeCancelar = gravavel && ac.cancelarApontamento;

  // ─── O dia ───────────────────────────────────────────────────────────
  const [dia, setDia] = useState(hoje || "");
  // O "hoje" da fazenda pode chegar depois (o fuso lido agora): o dia acompanha até a pessoa mudar.
  const diaMexido = useRef(false);
  useEffect(() => {
    if (!diaMexido.current && hoje) setDia(hoje);
  }, [hoje]);
  const [escolhidoId, setEscolhidoId] = useState(/** @type {string|null} */ (null));
  const [areaNova, setAreaNova] = useState("");
  const [errosDia, setErrosDia] = useState(/** @type {Record<string, string>} */ ({}));

  const consulta = useQuery({
    queryKey: chave,
    queryFn: () => listarApontamentos(/** @type {string} */ (atividadeId)),
    enabled: Boolean(empresaId && atividadeId && acoes?.ver),
    staleTime: 15 * 1000,
  });
  const itens = useMemo(() => itensDaLista(consulta.data), [consulta.data]);
  const doDia = useMemo(() => confirmadosDoDia(itens, dia), [itens, dia]);
  const apontamento = doDia.find((a) => String(a.id) === escolhidoId) ?? doDia[0] ?? null;

  /** @param {string} novo */
  const irParaDia = (novo) => {
    if (!novo) return;
    diaMexido.current = true;
    setDia(novo);
    setEscolhidoId(null);
    setErrosDia({});
  };
  const podeAvancar = Boolean(dia) && Boolean(hoje) && dia < hoje;

  // ─── Abas, janelas e diálogos ────────────────────────────────────────
  const [aba, setAba] = useState(/** @type {'lista'|'dados'} */ (abaInicial === "dados" && podeLancar ? "dados" : "lista"));
  const [chaveDados, setChaveDados] = useState(0);
  const [editandoLinha, setEditandoLinha] = useState(/** @type {{ linha: any, apontamento: any, chave: number } | null} */ (null));
  const [cancelando, setCancelando] = useState(/** @type {{ tipo: any, linha: any, apontamento: any } | null} */ (null));
  const [editandoDia, setEditandoDia] = useState(/** @type {any} */ (null));
  const [mostrarCanceladas, setMostrarCanceladas] = useState(false);
  const [alvoRodape, setAlvoRodape] = useState(/** @type {HTMLElement | null} */ (null));
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));
  const fecharDepois = useRef(false);
  const contextoDados = useMemo(
    () => ({
      alvoRodape,
      marcarFechar: (/** @type {boolean} */ fechar) => {
        fecharDepois.current = fechar;
      },
    }),
    [alvoRodape],
  );
  // Sem poder inserir, a aba Dados não abre.
  useEffect(() => {
    if (!podeLancar && aba === "dados") setAba("lista");
  }, [podeLancar, aba]);

  // ─── Escritas ────────────────────────────────────────────────────────
  /** O lançamento devolvido entra na lista já (a `versao` nova vale para o próximo item); a releitura confirma. @param {any} ap */
  const mesclarNaLista = (ap) => {
    if (!ap || typeof ap !== "object" || ap.id == null) return;
    queryClient.setQueryData(chave, (/** @type {unknown} */ antigo) => {
      if (antigo === undefined) return antigo;
      const lista = itensDaLista(antigo);
      const existe = lista.some((x) => String(x?.id) === String(ap.id));
      const nova = existe ? lista.map((x) => (String(x?.id) === String(ap.id) ? ap : x)) : [...lista, ap];
      return Array.isArray(antigo) ? nova : { .../** @type {Record<string, any>} */ (antigo && typeof antigo === "object" ? antigo : {}), items: nova };
    });
  };

  /** Releitura: lançamentos (a lista daqui e a da atividade aberta), totais e a lista de atividades. */
  const releer = () => {
    queryClient.invalidateQueries({ queryKey: chave });
    queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
    onAtividadeAtualizada?.(null);
  };

  /**
   * Escrita concluída (item novo, editado, cancelado, o dia alterado): lista, totais e avisos.
   * @param {{ apontamento: any, atividade: any, alertas: any[] }} r @param {string} texto @param {boolean} [criouDia]
   */
  const aplicarEscrita = (r, texto, criouDia = false) => {
    mesclarNaLista(r.apontamento);
    queryClient.invalidateQueries({ queryKey: chave });
    queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
    onAtividadeAtualizada?.(r.atividade && String(r.atividade.id) === atividadeId ? r.atividade : null);
    if (r.apontamento?.id != null) setEscolhidoId(String(r.apontamento.id));
    const diaGravado = formatarDiaAtividade(r.apontamento?.data_operacional);
    notifySuccess("Sucesso", criouDia ? `${texto} O lançamento de ${diaGravado || "hoje"} foi criado com ele.` : texto);
    const alertas = Array.isArray(r.alertas) ? r.alertas : [];
    if (alertas.length) notifyWarning("Atenção", `${diaGravado ? `${diaGravado}: ` : ""}${mensagemDoAlertaAtividade(alertas[0])}`);
  };

  // ─── O dia que ainda não existe: nasce com o primeiro item ────────────
  const formDoDia = { ...formularioApontamentoVazio(dia), area_executada_dia: areaNova };
  const errosDoDiaAgora = validarFormularioApontamento(formDoDia, { hoje });
  const areaPrevia = errosDoDiaAgora.area_executada_dia ? null : corpoDoApontamento(formDoDia).area_executada_dia;
  const idsAntes = useMemo(() => new Set(itens.map((a) => String(a?.id))), [itens]);
  /** @type {import("@/components/lancamento-atividades/JanelasDaLinha").NovoDia | null} */
  const novoDia = apontamento
    ? null
    : {
        idsAntes,
        corpo: () => {
          const v = validarFormularioApontamento(formDoDia, { hoje });
          setErrosDia(v);
          if (Object.keys(v).length) {
            notifyWarning("Atenção", v.data_operacional ?? v.area_executada_dia ?? "Revise o dia do lançamento.");
            return null;
          }
          // Só o que foi informado: a data e, se houver, a área do dia (o resto do dia fica para o formulário do dia).
          return Object.fromEntries(Object.entries(corpoDoApontamento(formDoDia)).filter(([, v2]) => v2 !== null && v2 !== ""));
        },
        aoRecusar: (erro) => {
          const campo = campoDoFormulario(erro, CAMPO_DO_FORMULARIO_APONTAMENTO);
          if (campo === "data_operacional" || campo === "area_executada_dia") setErrosDia((e) => ({ ...e, [campo]: mensagemDeErroAtividade(erro, "Revise o dia do lançamento.") }));
        },
      };
  // O destino do formulário: o dia que existe ou o que vai nascer com o item (a data e a área do cabeçalho).
  const destino = apontamento ?? { id: null, data_operacional: dia, area_executada_dia: areaPrevia, versao: null, status: null };

  /** A linha da aba Dados foi gravada: Salvar fica num formulário vazio; Salvar e fechar fecha a janela. */
  const aoSalvarItem = (/** @type {any} */ r, /** @type {string} */ texto) => {
    const criouDia = !apontamento;
    aplicarEscrita(r, texto, criouDia);
    if (criouDia) setAreaNova("");
    if (fecharDepois.current) {
      onFechar();
      return;
    }
    setChaveDados((k) => k + 1);
  };

  // ─── Lista do tipo no dia ────────────────────────────────────────────
  const todas = apontamento ? linhasDoTipo(apontamento, tipo) : [];
  const confirmadas = todas.filter((l) => statusDaLinha(l) !== STATUS_CANCELADO);
  const canceladas = todas.filter((l) => statusDaLinha(l) === STATUS_CANCELADO);
  const visiveis = mostrarCanceladas ? todas : confirmadas;
  const total = totalDasLinhas(todas, tipo);
  const colunas = COLUNAS[tipo] ?? COLUNAS[LINHA_MAQUINA];
  const linhasEditaveis = apontamento && (podeEditar || podeCancelar);

  /** O ⚡ de uma linha: Editar e Cancelar (o que a permissão deixa). @param {any} l */
  const acoesDaLinha = (l) => {
    if (!linhasEditaveis || statusDaLinha(l) === STATUS_CANCELADO) return null;
    const id = String(l.id);
    const grupos = [
      podeEditar
        ? [{ key: "editar", label: "Editar", icon: <Pencil size={16} strokeWidth={1.75} />, onSelect: () => setEditandoLinha({ linha: l, apontamento, chave: Date.now() }) }]
        : [],
      podeCancelar
        ? [{ key: "cancelar", label: "Cancelar", icon: <Ban size={16} strokeWidth={1.75} />, danger: true, onSelect: () => setCancelando({ tipo, linha: l, apontamento }) }]
        : [],
    ];
    return <B1MenuAcoesDaLinha rotulo={`Ações de ${nomeDaLinha(tipo, l)}`} titulo={nomeDaLinha(tipo, l)} grupos={grupos} testId={`linha-tipo-acoes-${id}`} />;
  };

  // ─── Cabeçalho ───────────────────────────────────────────────────────
  const areaDoDia = apontamento ? formatarDecimalLinha(apontamento.area_executada_dia) : "";
  const subtitulo = [
    atividade?.numero != null ? `Atividade Nº ${atividade.numero}` : "Atividade",
    String(atividade?.tipo_atividade_nome ?? ""),
    rotuloDaArea(atividade?.area) ? `Talhão: ${rotuloDaArea(atividade.area)}` : "",
    dia ? `Lançamento de ${formatarDiaAtividade(dia)}` : "",
    areaDoDia ? `${areaDoDia} ha` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const fora = Boolean(dia) && podeLancar && foraDoPeriodo(dia, atividade);
  const periodo = textoDoPeriodo(atividade?.data_inicio, atividade?.data_prevista_fim);

  let avisoStatus = null;
  if (atividade?.status === STATUS_CONCLUIDA) avisoStatus = "Atividade concluída: os lançamentos ficam só para consulta. Para lançar ou corrigir, reabra a atividade.";
  else if (atividade?.status === STATUS_CANCELADA) avisoStatus = "Atividade cancelada: os lançamentos foram cancelados junto e ficam no histórico.";
  else if (aberta && !fuso && empresaId) avisoStatus = "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de lançar: o servidor recusa sem ele.";
  else if (aberta && !tipoPermitido) avisoStatus = `O tipo desta atividade não permite mais ${doTipo.rotulo.toLowerCase()}: o que já foi lançado fica para consulta.`;

  const cabecalho = (
    <div className="b1-tipo-cab" data-testid="janela-tipo-dia">
      <div className="b1 mg-b1-form-grid" data-densidade={DENSIDADE_BASE1}>
        <div className="b1-tipo-cab__dia col-span-12 sm:col-span-5">
          <button
            type="button"
            className="tb-btn tb-btn-icon"
            aria-label="Dia anterior"
            title="Dia anterior"
            onClick={() => irParaDia(somarDias(dia, -1))}
            disabled={!dia}
            data-testid="janela-tipo-dia-anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <CampoDia
              label="Dia do lançamento"
              value={dia}
              onChange={(v) => {
                if (v && hoje && v > hoje) return;
                irParaDia(v);
              }}
              max={hoje || undefined}
              span={12}
              error={errosDia.data_operacional}
              testId="janela-tipo-data"
            />
          </div>
          <button
            type="button"
            className="tb-btn tb-btn-icon"
            aria-label="Dia seguinte"
            title="Dia seguinte"
            onClick={() => irParaDia(somarDias(dia, 1))}
            disabled={!podeAvancar}
            data-testid="janela-tipo-dia-seguinte"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {doDia.length > 1 ? (
          <CampoSelect
            label="Lançamento do dia"
            value={apontamento ? String(apontamento.id) : ""}
            onChange={(v) => setEscolhidoId(v || null)}
            options={doDia.map((a) => ({ value: String(a.id), label: rotuloDoLancamentoNoDia(a) }))}
            span={4}
          />
        ) : null}
        {apontamento ? (
          <div className="b1-tipo-cab__area col-span-12 sm:col-span-3">
            <div className="min-w-0 flex-1">
              <ValorCalculado label="Área do dia (ha)" valor={areaDoDia || "—"} span={12} testId="janela-tipo-area-dia" />
            </div>
            {podeEditar ? (
              <button type="button" className="tb-btn tb-btn-icon" aria-label="Alterar o lançamento do dia" title="Alterar o lançamento do dia" onClick={() => setEditandoDia(apontamento)} data-testid="janela-tipo-alterar-dia">
                <Pencil className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : podeLancar ? (
          <CampoNumero
            label="Área do dia (ha)"
            value={areaNova}
            onChange={(v) => {
              setAreaNova(v);
              setErrosDia((e) => (e.area_executada_dia ? { ...e, area_executada_dia: "" } : e));
            }}
            locale={LOCALE_ATIVIDADE}
            limites={LIMITES_DECIMAL_ATIVIDADE}
            span={3}
            error={errosDia.area_executada_dia || null}
            testId="janela-tipo-area-nova"
          />
        ) : null}
      </div>
      {consulta.isSuccess && !apontamento ? (
        <p className={NOTA} data-testid="janela-tipo-dia-novo">
          {podeLancar
            ? `Nenhum lançamento em ${formatarDiaAtividade(dia) || "este dia"}: o primeiro item salvo cria o lançamento do dia${areaNova.trim() ? ", com esta área" : " (a área do dia é opcional)"}.`
            : `Nenhum lançamento em ${formatarDiaAtividade(dia) || "este dia"}.`}
        </p>
      ) : null}
      {apontamento && doDia.length > 1 ? (
        <p className={NOTA} data-testid="janela-tipo-varios">
          {doDia.length} lançamentos neste dia: os itens entram no escolhido ({rotuloDaPassada(apontamento.sequencia) || "o mais recente"}).
        </p>
      ) : null}
      {fora ? (
        <AvisoGestao testId="janela-tipo-fora-do-periodo">
          Esta data fica fora do período da atividade{periodo ? ` (${periodo})` : ""}. O lançamento é aceito, com aviso.
        </AvisoGestao>
      ) : null}
    </div>
  );

  // ─── Aba 1: a lista ──────────────────────────────────────────────────
  const listaDoTipo = (
    <div className="min-w-0" data-testid="janela-tipo-lista">
      {podeLancar ? (
        <div className="mb-2">
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => setAba("dados")} data-testid="janela-tipo-inserir">
            <Plus className="h-4 w-4" aria-hidden /> Inserir
          </button>
        </div>
      ) : null}
      {consulta.isLoading ? (
        <p role="status" className={NOTA} data-testid="janela-tipo-carregando">
          Carregando os lançamentos…
        </p>
      ) : consulta.isError ? (
        <AvisoGestao testId="janela-tipo-erro">
          {mensagemDeErroAtividade(consulta.error, "Não foi possível carregar os lançamentos. Verifique a conexão e tente de novo.")}{" "}
          <button type="button" className="underline" onClick={() => consulta.refetch()}>
            Tentar novamente
          </button>
        </AvisoGestao>
      ) : !visiveis.length ? (
        <AvisoGestao tone="blue" testId="janela-tipo-vazio">
          {podeLancar ? "Nenhum registro neste lançamento. Clique em Inserir." : "Nenhum registro neste lançamento."}
        </AvisoGestao>
      ) : (
        <div className="b1-tipo-tabela__rolagem">
          <table className="b1-tipo-tabela" data-testid="janela-tipo-tabela">
            <thead>
              <tr>
                <th scope="col" className="b1-tipo-tabela__acoes">
                  Ações
                </th>
                {colunas.map((c) => (
                  <th key={c.id} scope="col" className={c.numero ? "is-numero" : undefined}>
                    {c.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const id = String(l.id);
                const cancelada = statusDaLinha(l) === STATUS_CANCELADO;
                return (
                  <tr key={id} className={cancelada ? "is-cancelada" : undefined} data-testid={`linha-tipo-${id}`} data-status={statusDaLinha(l)}>
                    <td className="b1-tipo-tabela__acoes">{acoesDaLinha(l)}</td>
                    {colunas.map((c, i) => (
                      <td key={c.id} className={[c.numero ? "is-numero" : "", i === 0 ? "is-nome" : ""].filter(Boolean).join(" ") || undefined} data-testid={`linha-tipo-${id}-${c.id}`}>
                        {c.valor(l, apontamento)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr data-testid="janela-tipo-total">
                <td />
                <td colSpan={colunas.length - 1}>Total</td>
                <td className="is-numero" data-testid="janela-tipo-total-valor">
                  {formatarCustoLinha(total) || "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {canceladas.length ? (
        <label className="b1-tipo-canceladas">
          <input type="checkbox" checked={mostrarCanceladas} onChange={(e) => setMostrarCanceladas(e.target.checked)} data-testid="janela-tipo-mostrar-canceladas" />
          Mostrar canceladas ({canceladas.length})
        </label>
      ) : null}
      {CAMPO_DO_VALOR_DA_LINHA[tipo] && total === null && confirmadas.length ? (
        <p className={`${NOTA} mt-1`}>O valor aparece quando o servidor o calcula (custo do cadastro, lotes do estoque ou valor digitado).</p>
      ) : null}
    </div>
  );

  // ─── Aba "Dados": o formulário da linha ──────────────────────────────
  const propsDoFormulario = {
    key: `${chaveDados}:${dia}:${apontamento?.id ?? "novo"}`,
    atividade,
    apontamento: destino,
    escopo,
    novoDia,
    Casca: CascaDaAbaDados,
    onSalvo: aoSalvarItem,
    onCancelar: () => setAba("lista"),
    // Sem resposta (ou o servidor disse que algo mudou): relê. Com o dia ainda nascendo, a lista não é relida aqui —
    // o "Consultar" / "Repetir o mesmo envio" do formulário resolvem sem trocar o formulário de baixo da pessoa.
    onMudou: () => {
      if (apontamento) releer();
      else queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
    },
  };
  let formularioDados = null;
  if (aba === "dados" && podeLancar && dia) {
    const { key, ...p } = propsDoFormulario;
    if (tipo === LINHA_PRODUTO) formularioDados = <JanelaLinhaProduto key={key} {...p} />;
    else if (tipo === LINHA_MAO_OBRA) formularioDados = <JanelaLinhaMaoObra key={key} {...p} />;
    else if (tipo === LINHA_SERVICO) formularioDados = <JanelaLinhaServico key={key} {...p} />;
    else formularioDados = <JanelaLinhaMaquina key={key} {...p} permiteImplemento={flags?.permiteImplemento === true} />;
  }

  // ─── Editar (a janela de linha de sempre, por cima) ──────────────────
  let janelaEdicao = null;
  if (editandoLinha) {
    const p = {
      atividade,
      apontamento: editandoLinha.apontamento,
      linha: editandoLinha.linha,
      escopo,
      onSalvo: (/** @type {any} */ r, /** @type {string} */ texto) => {
        setEditandoLinha(null);
        aplicarEscrita(r, texto);
      },
      onCancelar: () => setEditandoLinha(null),
      onMudou: releer,
    };
    if (tipo === LINHA_PRODUTO) janelaEdicao = <JanelaLinhaProduto key={editandoLinha.chave} {...p} />;
    else if (tipo === LINHA_MAO_OBRA) janelaEdicao = <JanelaLinhaMaoObra key={editandoLinha.chave} {...p} />;
    else if (tipo === LINHA_SERVICO) janelaEdicao = <JanelaLinhaServico key={editandoLinha.chave} {...p} />;
    else janelaEdicao = <JanelaLinhaMaquina key={editandoLinha.chave} {...p} permiteImplemento={flags?.permiteImplemento === true} />;
  }

  const contagem = confirmadas.length;
  const abas = [
    { id: "lista", rotulo: `${doTipo.aba} (${contagem})`, desabilitada: false },
    { id: "dados", rotulo: "Dados", desabilitada: !podeLancar },
  ];

  const ocupado = aba === "dados";
  const titulo = (
    <span className="b1-tipo-titulo">
      <span className="b1-tipo-titulo__icone" aria-hidden>
        <doTipo.Icone size={16} strokeWidth={1.75} />
      </span>
      {doTipo.rotulo}
    </span>
  );

  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      // Uma folha do celular aberta dentro da janela (seletor, ⚡) fecha primeiro.
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo={titulo}
      descricao={subtitulo}
      descricaoProps={{ "data-testid": "janela-tipo-subtitulo" }}
      testId="janela-tipo"
      className={`b1-janela--tipo${celular ? " b1-janela--tela-cheia" : ""}`}
      // Os botões daqui seguem as ações da tela (lançar/editar/cancelar apontamento): a heurística de texto do Layout não vale.
      contentProps={{ "data-permissao-explicita": "", "data-tipo": tipo, "data-celular": celular ? "" : undefined, className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
      fora={<div ref={setAlvoFolha} className="contents" />}
      rodape={
        ocupado ? (
          <div ref={setAlvoRodape} className="contents" data-testid="janela-tipo-rodape-dados" />
        ) : (
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} data-testid="janela-tipo-fechar">
            <X className="h-4 w-4" aria-hidden />
            Fechar
          </button>
        )
      }
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        {avisoStatus ? <AvisoGestao testId="janela-tipo-aviso">{avisoStatus}</AvisoGestao> : null}
        {cabecalho}
        <div role="tablist" aria-label={doTipo.rotulo} className="b1-tipo-abas">
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              id={`janela-tipo-aba-${a.id}`}
              aria-selected={aba === a.id}
              aria-controls={`janela-tipo-painel-${a.id}`}
              disabled={a.desabilitada}
              className={`b1-panel-tab${aba === a.id ? " is-active" : ""}`}
              onClick={() => setAba(/** @type {'lista'|'dados'} */ (a.id))}
              data-testid={`janela-tipo-aba-${a.id}`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`janela-tipo-painel-${aba}`} aria-labelledby={`janela-tipo-aba-${aba}`} className="b1-tipo-painel min-w-0">
          {aba === "lista" ? (
            listaDoTipo
          ) : (
            <ContextoDados.Provider value={contextoDados}>
              {formularioDados ?? <p className={NOTA}>Escolha o dia do lançamento.</p>}
            </ContextoDados.Provider>
          )}
        </div>
      </MobileSheetPortalCtx.Provider>

      {janelaEdicao}
      {cancelando ? (
        <DialogoCancelarLinha
          key={`cancelar-linha-${cancelando.linha.id}`}
          atividade={atividade}
          cancelando={cancelando}
          escopo={escopo}
          onCancelada={(r, texto) => {
            setCancelando(null);
            aplicarEscrita(r, texto);
          }}
          onFechar={() => setCancelando(null)}
          onMudou={releer}
        />
      ) : null}
      {editandoDia ? (
        <FormularioApontamento
          key={`dia-${editandoDia.id}-${editandoDia.versao}`}
          atividade={atividade}
          apontamento={editandoDia}
          permiteProduto={flags?.permiteProduto === true}
          permiteImplemento={flags?.permiteImplemento === true}
          permiteMaoObra={flags?.permiteMaoObra === true}
          permiteServico={flags?.permiteServico === true}
          escopo={escopo}
          onSalvo={(r) => {
            setEditandoDia(null);
            aplicarEscrita(r, `Lançamento de ${formatarDiaAtividade(r.apontamento?.data_operacional)} atualizado.`);
          }}
          onCancelar={() => setEditandoDia(null)}
          onMudou={releer}
        />
      ) : null}
    </B1Janela>
  );
}
