import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowLeftRight, ChevronRight, FileText, FlaskConical, Fuel, Loader2, Play, Square, Truck, User, Wrench } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import CargaDeInsumo from "@/components/lancamento-atividades/CargaDeInsumo";
import AtividadeComFrentes, { CartaoDaAtividade, diaCurto, tituloDaFrente } from "@/components/lancamento-atividades/AtividadeComFrentes";
import { PainelEncerrarAtividade, PainelEncerrarFrente } from "@/components/lancamento-atividades/EncerramentoDeFrentes";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import {
  apontamentosDaFrente,
  chaveDaFrente,
  ehCampoDesconhecido,
  formatarHorimetro,
  frentesDosApontamentos,
  lancamentosDoDia,
  lerTodasAsPaginas,
  marcadorDaAbertura,
  marcadorDoEncerramento,
  parseHorimetroPtBr,
  validarAbertura,
  validarEncerramento,
} from "@/lib/aberturaServicoRegras";
import { RAIZ_CONSULTAS_ATIVIDADES, chaveApontamentos, itensDaLista, normalizarPaginaDeOpcoes } from "@/lib/atividadeApontamentoRegras";
import { capinsDoCadastro } from "@/lib/camposPorTipo";
import { medidorDaResposta, textoDaLeituraVigente } from "@/lib/atividadeLinhasRegras";
import { areasDaAtividade } from "@/lib/atividadeAreasRegras";
import { tiposRegistraveisNaArea } from "@/lib/atividadeFluxoCampo";
import { iconeDoTipoAtividade } from "@/lib/iconesTipoAtividade";
import { mensagemDeErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { TIPOS_FIXOS_ATIVIDADE, operacoesDoTipoFixo, rotuloDoTipoFixo, tipoFixoDaOperacao } from "@/lib/tiposFixosAtividade";
import {
  concluirAtividade,
  criarApontamento,
  definirFazendaDaTela,
  listarApontamentos,
  listarOpcoesBens,
  listarOpcoesImplementos,
  listarOpcoesOperadores,
  obterAtividade,
  obterMedidorDoBem,
  registrarCampo,
} from "@/services/lancamentoAtividadesService";
import { listarCulturas } from "@/services/culturaCadastroService";

/** D-PROD-341 (frentes): a mensagem da trava de duplicidade (mesma máquina + implemento já aberta no pasto). */
const MSG_FRENTE_DUPLICADA = "Esta máquina com este implemento já tem serviço aberto neste pasto. Toque nele na lista para continuar.";
/** D-PROD-346: a mesma máquina com o mesmo implemento já encerrou o serviço nesta atividade (aberta OU encerrada, bloqueia). */
const MSG_FRENTE_ENCERRADA = "Esta máquina com este implemento já encerrou o serviço nesta atividade.";
/** D-PROD-341 (P1 da revisão do Codex): continuar a atividade sem abertura com mais de uma do mesmo tipo no pasto. */
const MSG_TIPO_AMBIGUO = "Há mais de uma atividade deste tipo aberta neste pasto, e o servidor não deixa escolher qual recebe a abertura. Conclua uma delas e tente de novo.";

/** D-PROD-332 — a linha de apoio embaixo do nome do cartão (só o tipo que precisa). */
const SUB_DO_TIPO = Object.freeze({ PREPARO_SOLO: "Gradeação, calagem" });

/** Tira o erro de um campo (sem ele, o objeto volta igual). @param {Record<string, string>} e @param {string} campo */
const semCampo = (e, campo) => {
  if (!(campo in e)) return e;
  const { [campo]: _, ...resto } = e;
  return resto;
};

/** @param {unknown} v a área (hectares) formatada com duas casas; sem valor, "". */
const hectaresDaArea = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
};

/**
 * D-PROD-332 (tela 05) — as 7 opções do serviço aberto, na ordem da maquete. A `chave` é o final do `data-testid`
 * (`servico-opcao-<chave>`). O Insumo abre a carga (D-PROD-334, na mesma janela); as outras 6 abrem o painel "Em breve".
 */
const OPCOES_DO_SERVICO = Object.freeze([
  { chave: "insumo", titulo: "Insumo", sub: "Produto ou mistura no implemento, por carga", Icone: FlaskConical },
  { chave: "maquina", titulo: "Máquina", sub: "Trocar implemento, problema ou parada, corrigir horímetro", Icone: Truck },
  { chave: "abastecimento", titulo: "Abastecimento", sub: "Diesel, litros e horímetro", Icone: Fuel },
  { chave: "trocar-pasto", titulo: "Trocar pasto", sub: "Horímetro de saída e de chegada", Icone: ArrowLeftRight },
  { chave: "mao-de-obra", titulo: "Mão de obra", sub: "Quem ajudou e as horas", Icone: User },
  { chave: "servico-terceiro", titulo: "Serviço de terceiro", sub: "Conserto, frete, aplicação contratada", Icone: Wrench },
  { chave: "outros-custos", titulo: "Outros custos", sub: "Qualquer outro gasto deste serviço", Icone: FileText },
]);

/** O ícone de cada linha de "Lançado hoje" (o tipo da linha, como `lancamentosDoDia` devolve). */
const ICONE_DO_LANCAMENTO = Object.freeze({ insumo: FlaskConical, maquina: Truck, mao_obra: User, servico: Wrench });

/**
 * Campo de escolha Base1 com a opção vazia visível quando pedida (o `CampoSelect` esconde a vazia; aqui o "— Sem implemento —"
 * precisa aparecer). Cabeçalho e ajuda como os demais campos da janela.
 * @param {{ label: string, value: string, onChange: (v: string) => void, options: Array<{ value: string, label: string }>, required?: boolean, error?: string, opcaoVazia?: string, testId: string, readOnly?: boolean }} props
 */
function CampoEscolha({ label, value, onChange, options, required = false, error = undefined, opcaoVazia = undefined, testId, readOnly = false }) {
  return (
    <B1Field label={label} required={required} span={12} hasValue={Boolean(value)} locked={readOnly} disabled={readOnly} error={error}>
      <B1Select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
        className={B1_FIELD_CTL_CLS}
        pesquisa="sempre"
        data-testid={testId}
      >
        {opcaoVazia !== undefined ? <option value="">{opcaoVazia}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </B1Select>
    </B1Field>
  );
}

/**
 * D-PROD-332 — o "Diário das atividades" (Mapa Geral → Detalhes da área → Manejos). D-PROD-346: UMA atividade por área e
 * tipo; dentro dela, as FRENTES (máquina + implemento). Passos:
 *  - `escolher` (Em andamento neste pasto, só com atividades abertas): UM cartão por ATIVIDADE (máquinas em campo e início)
 *    e "Nova atividade";
 *  - `atividade` (tela b, D-PROD-346): a atividade — o cabeçalho (Pasto, Início, Máquinas), UM cartão por FRENTE (máquina +
 *    implemento; "Hoje" = lançamentos do dia; a encerrada mostra o horímetro final e não toca), "Adicionar máquina" e
 *    "Encerrar atividade" (painel com o horímetro final de cada frente aberta: grava um encerramento por frente e conclui a
 *    atividade). Sem frente, o aviso. A entrada com `atividade` na prop cai aqui;
 *  - `tipo` (tela 01): os 7 tipos fixos em cartões; "Continuar" leva ao passo seguinte (com lista, o Voltar volta a ela);
 *  - `abrir` (tela 02): "Nova atividade de <Tipo>" — Máquina *, Implemento (opcional), Horímetro inicial *, Responsável *
 *    (e, no Plantio de pastagem, Capim *); com mais de uma operação do tipo, a Operação * vem antes. "Adicionar máquina" (a
 *    partir de `atividade`) abre o mesmo formulário com o tipo e a operação da atividade já escolhidos: Cancelar e Voltar
 *    voltam a `atividade`;
 *  - `iniciado` (tela 05): o serviço de UMA frente — o cabeçalho, as 7 opções (cada uma abre um painel "Em breve"; o Insumo
 *    abre a carga), "Lançado hoje" (só desta frente) e "Encerrar serviço" (painel com o horímetro final; grava o encerramento
 *    da frente). Voltar (seta) leva a `atividade`.
 *
 * Gravação (um envio por ação, sem migration): abrir é `registrarCampo` (acha/abre a atividade do tipo na área e grava o
 * apontamento do dia com a abertura na observação, `marcadorDaAbertura`); encerrar uma frente é um `criarApontamento` do dia
 * com a linha `marcadorDoEncerramento`; encerrar a atividade grava uma linha dessas por frente aberta e depois conclui
 * (`concluirAtividade`). As frentes saem dos apontamentos da atividade (`frentesDosApontamentos`).
 *
 * @param {{
 *   area: any,
 *   tipos?: any[],        // as operações (tipos de atividade) ativas
 *   atividade?: any | null, // a atividade do pasto a abrir no passo `atividade`, ou null
 *   atividadesAbertas?: any[], // D-PROD-341: as atividades do pasto que não estão concluídas (o resumo da área)
 *   lerAtividade?: (atividadeId: string) => Promise<any>, // D-PROD-341: lê a atividade inteira ao tocar numa linha
 *   onFechar: () => void,
 *   onGravou?: (resposta: any) => void,
 * }} props
 */
export default function DiarioDasAtividades({
  area,
  tipos: todosOsTipos = [],
  atividade = null,
  atividadesAbertas = [],
  lerAtividade = obterAtividade,
  onFechar,
  onGravou = undefined,
}) {
  const queryClient = useQueryClient();
  const tipos = useMemo(() => tiposRegistraveisNaArea(todosOsTipos), [todosOsTipos]);
  const empresaId = useEmpresaRealSelecionadaId();
  // O service injeta a fazenda (como na Nova realização; no mapa é aqui).
  definirFazendaDaTela(empresaId);
  const acoes = useAcoesTelaAtividades();
  const { fuso, fusoOk, hoje } = useFusoDaFazenda(empresaId);
  const { clienteId } = useAuth();
  const celular = useCelular();
  const escopo = `${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`;

  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));

  // ─── Passo e tipo ───────────────────────────────────────────────────
  const [passo, setPasso] = useState(/** @type {"escolher" | "atividade" | "tipo" | "abrir" | "iniciado"} */ (atividade ? "atividade" : atividadesAbertas.length ? "escolher" : "tipo"));
  const [atividadeAtual, setAtividadeAtual] = useState(atividade);
  const operacaoDaAtividade = atividadeAtual ? tipos.find((t) => String(t.id) === String(atividadeAtual.tipo_atividade_id ?? "")) ?? null : null;
  /** D-PROD-341: a atividade tocada no passo `escolher` está sendo lida (a linha fica travada). */
  const [abrindoAtividade, setAbrindoAtividade] = useState(/** @type {string | null} */ (null));
  const [tipoFixo, setTipoFixo] = useState(/** @type {string} */ (operacaoDaAtividade ? tipoFixoDaOperacao(operacaoDaAtividade) : ""));
  const operacoes = useMemo(() => operacoesDoTipoFixo(tipos, tipoFixo), [tipos, tipoFixo]);
  const pedirOperacao = operacoes.length > 1;
  const semOperacao = tipoFixo !== "" && operacoes.length === 0;
  const [operacaoEscolhidaId, setOperacaoEscolhidaId] = useState("");
  /** D-PROD-346: o formulário foi aberto por "Adicionar máquina" (a atividade `atividadeAtual` é o destino). */
  const [adicionandoA, setAdicionandoA] = useState(false);
  // Na "Adicionar máquina" a operação é a da atividade (sem campo). Fora dela, com uma operação só, ela é usada sem
  // perguntar; com mais de uma, vale a escolhida.
  const operacaoId = adicionandoA && atividadeAtual?.tipo_atividade_id != null
    ? String(atividadeAtual.tipo_atividade_id)
    : operacoes.length === 1 ? String(operacoes[0].id) : operacaoEscolhidaId;
  /** O tipo FIXO do formulário (a categoria, como "Preparo do solo"): o título "Nova atividade de …" do caminho novo. */
  const rotuloDoTipo = tipoFixo ? rotuloDoTipoFixo(tipoFixo) : "";
  /** D-PROD-346: o rótulo da atividade aberta é o NOME DO TIPO dela (como "Gradeação"); sem ele, o tipo fixo. */
  const rotuloTipo = atividadeAtual?.tipo_atividade_nome || rotuloDoTipo || atividadeAtual?.nome || "";
  /** D-PROD-346: o nome da atividade (o tipo, como "Gradeação"), para o título e os textos do passo `atividade`. */
  const nomeDaAtividade = atividadeAtual?.tipo_atividade_nome || atividadeAtual?.nome || rotuloTipo;
  /** A Operação aparece só no caminho novo (tipo → abrir) e quando há mais de uma do tipo. */
  const pedirOperacaoNoForm = pedirOperacao && !adicionandoA;

  // ─── Campos da abertura ─────────────────────────────────────────────
  const [bemId, setBemId] = useState("");
  const [implementoId, setImplementoId] = useState("");
  const [horimetro, setHorimetro] = useState("");
  // A pessoa digitou o horímetro: a leitura da máquina não sobrescreve mais (só ao trocar de máquina).
  const [horimetroMexido, setHorimetroMexido] = useState(false);
  const [responsavelId, setResponsavelId] = useState("");
  /** D-PROD-332 (emenda): o capim do Plantio de pastagem (só esse tipo; some ao trocar de tipo). */
  const [culturaId, setCulturaId] = useState("");
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  /** D-PROD-341: o nome do serviço que já está aberto no pasto sem abertura (a linha de ajuda do formulário; "" = não é o caso). */
  const [nomeServicoExistente, setNomeServicoExistente] = useState("");
  /** D-PROD-341 (frentes): a frente (máquina + implemento) do serviço aberto; `null` = nenhuma escolhida. */
  const [frenteChave, setFrenteChave] = useState(/** @type {string | null} */ (null));
  /** D-PROD-346: o painel "Encerrar serviço" do passo `iniciado` (e o seu horímetro final). */
  const [encerrandoFrente, setEncerrandoFrente] = useState(false);
  const [horimetroFinal, setHorimetroFinal] = useState("");
  const [errosFinal, setErrosFinal] = useState(/** @type {{ horimetroFinal?: string }} */ ({}));
  /** D-PROD-346: o painel "Encerrar atividade" do passo `atividade` (o horímetro final de cada frente aberta). */
  const [encerrandoAtividade, setEncerrandoAtividade] = useState(false);
  const [horimetrosFim, setHorimetrosFim] = useState(/** @type {Record<string, string>} */ ({}));
  const [errosFim, setErrosFim] = useState(/** @type {Record<string, string>} */ ({}));

  // ─── Opções (só no passo da abertura) ───────────────────────────────
  // D-PROD-332 (emenda): as opções vêm TODAS as páginas (`lerTodasAsPaginas`), não só a 1ª de 50.
  const bensLidos = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "abertura", "bens", empresaId],
    queryFn: () => lerTodasAsPaginas(listarOpcoesBens),
    enabled: Boolean(empresaId) && passo === "abrir",
    staleTime: 30 * 1000,
  });
  const implementosLidos = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "abertura", "implementos", empresaId],
    queryFn: () => lerTodasAsPaginas(listarOpcoesImplementos),
    enabled: Boolean(empresaId) && passo === "abrir",
    staleTime: 30 * 1000,
  });
  const operadoresLidos = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "abertura", "operadores", empresaId],
    queryFn: () => lerTodasAsPaginas(listarOpcoesOperadores),
    enabled: Boolean(empresaId) && passo === "abrir",
    staleTime: 30 * 1000,
  });
  // D-PROD-332 (emenda): o capim do Plantio de pastagem (as culturas ATIVAS de pastagem/capineira, como no registro de campo).
  const culturasLidas = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "culturas", empresaId],
    queryFn: () => listarCulturas(String(empresaId)),
    enabled: Boolean(empresaId) && passo === "abrir" && tipoFixo === "PLANTIO",
    staleTime: 60 * 1000,
  });
  const capins = useMemo(() => capinsDoCadastro(Array.isArray(culturasLidas.data) ? culturasLidas.data : []), [culturasLidas.data]);
  const bens = useMemo(() => normalizarPaginaDeOpcoes(bensLidos.data).itens, [bensLidos.data]);
  const implementos = useMemo(() => normalizarPaginaDeOpcoes(implementosLidos.data).itens, [implementosLidos.data]);
  const operadores = useMemo(() => normalizarPaginaDeOpcoes(operadoresLidos.data).itens, [operadoresLidos.data]);

  // O horímetro da máquina escolhida: a última leitura até hoje (`obterMedidorDoBem`).
  const medidorLido = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "abertura", "medidor", empresaId, bemId, hoje],
    queryFn: () => obterMedidorDoBem(bemId, hoje || null),
    enabled: Boolean(empresaId && bemId && hoje && passo === "abrir"),
    staleTime: 15 * 1000,
  });
  const medidor = medidorLido.isSuccess ? medidorDaResposta(medidorLido.data) : null;
  const leituraDaMaquina = medidor?.vigente?.leitura ?? null;
  // Ao trocar de máquina (ou chegar a leitura), o horímetro vem preenchido — salvo se a pessoa já digitou nele.
  useEffect(() => {
    if (horimetroMexido || !leituraDaMaquina) return;
    setHorimetro(formatarHorimetro(leituraDaMaquina));
  }, [bemId, leituraDaMaquina, horimetroMexido]);

  // ─── A atividade e as frentes (passos `atividade` e `iniciado`) ─────
  const atividadeId = atividadeAtual?.id != null ? String(atividadeAtual.id) : null;
  // Os apontamentos da atividade (as frentes, o cabeçalho e "Lançado hoje" leem daqui; a lista já traz as linhas).
  const apontamentosLidos = useQuery({
    queryKey: chaveApontamentos(empresaId, atividadeId),
    queryFn: () => listarApontamentos(/** @type {string} */ (atividadeId)),
    enabled: Boolean(empresaId && atividadeId && (passo === "atividade" || passo === "iniciado")),
    staleTime: 15 * 1000,
  });
  const apontamentosDaAtividade = useMemo(() => itensDaLista(apontamentosLidos.data), [apontamentosLidos.data]);
  /** D-PROD-346: as frentes da atividade (uma por máquina + implemento), por início. Sem leitura, `[]`. */
  const frentes = useMemo(() => (apontamentosLidos.isSuccess ? frentesDosApontamentos(apontamentosDaAtividade) : []), [apontamentosLidos.isSuccess, apontamentosDaAtividade]);
  const frentesAbertas = useMemo(() => frentes.filter((f) => !f.encerrada), [frentes]);
  const frenteAtual = useMemo(() => (frenteChave ? (frentes.find((f) => f.chave === frenteChave) ?? null) : null), [frenteChave, frentes]);
  /** Os apontamentos DESTE serviço: os da frente escolhida (sem frente, a atividade inteira). "Lançado hoje" e carga leem daqui. */
  const apontamentosDoServico = useMemo(
    () => (frenteChave ? apontamentosDaFrente(apontamentosDaAtividade, frenteChave) : apontamentosDaAtividade),
    [frenteChave, apontamentosDaAtividade],
  );
  /** Os lançamentos de hoje do serviço (CONFIRMADO, por linha, sem R$), na ordem do horário. */
  const lancadosHoje = useMemo(() => lancamentosDoDia(apontamentosDoServico, hoje, fuso), [apontamentosDoServico, hoje, fuso]);
  /** A abertura da frente tocada (o serviço aberto). */
  const abertura = frenteAtual?.abertura ?? null;
  /** A frente tocada ainda não está na leitura (ou a leitura ainda não chegou): "Carregando…", sem cabeçalho nem menu. */
  const lendoFrente = passo === "iniciado" && !frenteAtual;
  /** O painel "Em breve" da tela 05: o título da opção tocada; null = o serviço aberto. */
  const [emBreve, setEmBreve] = useState(/** @type {string | null} */ (null));
  /** D-PROD-334: a "Carga de insumo" (opção Insumo) na mesma janela; o botão do rodapé fica no lugar que ela indica. */
  const [insumoAberto, setInsumoAberto] = useState(false);
  /** A carga está sendo enviada: voltar e fechar ficam travados até a resposta. */
  const [cargaEnviando, setCargaEnviando] = useState(false);
  const [alvoRodapeCarga, setAlvoRodapeCarga] = useState(/** @type {HTMLElement | null} */ (null));
  /** A área (pasto) da atividade: o `atividade_area_id` do apontamento novo, quando a atividade tem áreas. */
  const atividadeAreaId = useMemo(() => {
    const achada = areasDaAtividade(atividadeAtual).find((a) => String(a?.area?.id ?? a?.area_id ?? "") === String(area?.id ?? ""));
    return achada ? String(achada.id) : null;
  }, [atividadeAtual, area]);

  // ─── Permissão e fuso (como na Nova realização) ─────────────────────
  const podeGravar = acoes?.lancarApontamento === true && Boolean(empresaId) && Boolean(fuso) && fusoOk;
  const avisoStatus = !acoes?.carregando && acoes?.lancarApontamento !== true
    ? "Sem permissão para registrar atividades."
    : empresaId && !fuso
      ? "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de registrar: o servidor recusa sem ele."
      : null;

  // ─── Ações ──────────────────────────────────────────────────────────
  /** Zera os painéis do passo (encerrar frente, encerrar atividade e "Em breve"). */
  const zerarPaineis = () => {
    setEmBreve(null);
    setEncerrandoFrente(false);
    setEncerrandoAtividade(false);
    setErrosFinal({});
    setErrosFim({});
  };
  /** @param {string} valor */
  const escolherTipo = (valor) => {
    if (valor !== tipoFixo) {
      setOperacaoEscolhidaId("");
      setCulturaId("");
      setErros({});
    }
    setTipoFixo(valor);
  };
  const continuarDoTipo = () => {
    if (!tipoFixo) return;
    setErros({});
    setPasso("abrir");
  };
  /** D-PROD-346: sai do "Adicionar máquina" e volta à atividade (sem fechar a janela). */
  const voltarDaAdicao = () => {
    setErros({});
    setAdicionandoA(false);
    setNomeServicoExistente("");
    setPasso("atividade");
  };
  const voltarAoTipo = () => {
    if (enviando) return;
    if (adicionandoA) {
      voltarDaAdicao();
      return;
    }
    setErros({});
    setNomeServicoExistente("");
    setPasso("tipo");
  };
  /** Cancelar do formulário: na "Adicionar máquina" volta à atividade; no resto, fecha. */
  const cancelarAbertura = () => {
    if (adicionandoA) {
      voltarDaAdicao();
      return;
    }
    onFechar();
  };
  // ─── D-PROD-341: o passo "escolher" (Em andamento neste pasto) ──────
  const temAbertas = atividadesAbertas.length > 0;
  /** Os ids das operações que o tipo escolhido cobre (a escolhida, se já há uma). */
  const idsDaOperacao = operacaoId ? [operacaoId] : operacoes.map((o) => String(o.id));
  /** A atividade aberta do pasto deste tipo: a linha de ajuda "Já existe …" (o servidor reaproveita essa atividade). */
  const abertaDoTipo = tipoFixo ? atividadesAbertas.find((a) => idsDaOperacao.includes(String(a.tipo_atividade_id ?? ""))) ?? null : null;
  /** D-PROD-341 (frentes): as atividades abertas do tipo no pasto, quando o formulário vai abrir uma frente (não na continuação). */
  const abertasDoTipo = passo === "abrir" && !nomeServicoExistente && tipoFixo ? atividadesAbertas.filter((a) => idsDaOperacao.includes(String(a.tipo_atividade_id ?? ""))) : [];
  /** As frentes já abertas nessas atividades (mesmas consultas da lista: cache compartilhado). Sem atividade do tipo, nenhuma. */
  const consultasDoTipo = useQueries({
    queries: abertasDoTipo.map((a) => ({
      queryKey: chaveApontamentos(empresaId, String(a.atividade_id)),
      queryFn: () => listarApontamentos(String(a.atividade_id)),
      enabled: Boolean(empresaId),
      staleTime: 15 * 1000,
    })),
  });
  // Frentes ABERTAS e ENCERRADAS do tipo: a mesma máquina com o mesmo implemento não entra de novo (D-PROD-346).
  const frentesDoTipo = consultasDoTipo.flatMap((q) => frentesDosApontamentos(itensDaLista(q.data)));
  /** A máquina + implemento do formulário (a chave da frente que ele abriria); "" sem máquina. */
  const chaveDoFormulario = bemId ? chaveDaFrente({ bemId, implementoId }) : "";
  /** A frente do formulário que já existe no pasto (a aberta tem prioridade sobre a encerrada); null = nenhuma. */
  const frenteNoTipo = chaveDoFormulario
    ? (frentesDoTipo.find((f) => f.chave === chaveDoFormulario && !f.encerrada) ?? frentesDoTipo.find((f) => f.chave === chaveDoFormulario) ?? null)
    : null;
  /** Esta máquina com este implemento já tem frente (aberta ou encerrada) no pasto, pelos dados carregados: não envia. */
  const duplicada = frenteNoTipo !== null;
  /** O formulário é para UMA atividade já escolhida (continuação sem abertura, ou "Adicionar máquina"). */
  const deUmaAtividade = Boolean(nomeServicoExistente) || adicionandoA;
  /** Continuar a atividade SEM abertura com mais de uma do mesmo tipo no pasto: o servidor entra na mais recente (P1). */
  const idDaAtividadeAtual = atividadeAtual?.id != null ? String(atividadeAtual.id) : null;
  const doMesmoTipo = deUmaAtividade && operacaoId ? atividadesAbertas.filter((a) => String(a.tipo_atividade_id ?? "") === operacaoId).length : 0;
  // A escolhida conta mesmo que não esteja na lista do pasto.
  const escolhidaFora = Boolean(deUmaAtividade && operacaoId && idDaAtividadeAtual && !atividadesAbertas.some((a) => String(a.atividade_id) === idDaAtividadeAtual));
  const ambiguo = doMesmoTipo + (escolhidaFora ? 1 : 0) > 1;
  /** O motivo de não enviar agora (a trava), ou "" quando pode. Mostrado como ajuda e no envio. */
  const motivoTrava = ambiguo ? MSG_TIPO_AMBIGUO : duplicada ? (frenteNoTipo?.encerrada ? MSG_FRENTE_ENCERRADA : MSG_FRENTE_DUPLICADA) : "";
  /** Nova atividade (passo `escolher`): o tipo, do zero. */
  const novaAtividade = () => {
    if (enviando || abrindoAtividade !== null) return;
    setErros({});
    setAdicionandoA(false);
    setNomeServicoExistente("");
    setPasso("tipo");
  };
  /** Do tipo, o Voltar leva à lista (só quando houve lista). */
  const voltarDoTipo = () => {
    if (enviando) return;
    setErros({});
    setPasso("escolher");
  };
  /**
   * D-PROD-346: tocar numa atividade da lista lê a atividade inteira e vai ao passo `atividade` (as frentes dela). Falha na
   * leitura: aviso, e fica na lista.
   * @param {any} linha
   */
  const tocarAtividadeAberta = async (linha) => {
    if (abrindoAtividade !== null) return;
    setAbrindoAtividade(String(linha.atividade_id));
    try {
      const detalhe = await lerAtividade(String(linha.atividade_id));
      const operacao = tipos.find((t) => String(t.id) === String(detalhe?.tipo_atividade_id ?? "")) ?? null;
      setAtividadeAtual(detalhe);
      setTipoFixo(operacao ? tipoFixoDaOperacao(operacao) : "");
      setOperacaoEscolhidaId("");
      setFrenteChave(null);
      setNomeServicoExistente("");
      setAdicionandoA(false);
      setErros({});
      zerarPaineis();
      setPasso("atividade");
    } catch (erro) {
      notifyWarning("Não foi possível abrir o serviço", mensagemDeErroAtividade(erro, "Confira a conexão e tente de novo."));
    } finally {
      setAbrindoAtividade(null);
    }
  };
  /** D-PROD-346: a frente tocada (aberta) no passo `atividade` abre o serviço dela (`iniciado`). */
  const abrirFrente = (chave) => {
    if (enviando) return;
    setFrenteChave(chave);
    zerarPaineis();
    setPasso("iniciado");
  };
  /** D-PROD-346: "Adicionar máquina" — o formulário de abertura com o tipo e a operação da atividade já escolhidos. */
  const adicionarMaquina = () => {
    if (enviando) return;
    setBemId("");
    setImplementoId("");
    setHorimetro("");
    setHorimetroMexido(false);
    setResponsavelId("");
    setCulturaId("");
    setErros({});
    // A operação é a da atividade (o `tipo_atividade_id` dela): o POST leva esse id, e o campo Operação não aparece.
    setOperacaoEscolhidaId(atividadeAtual?.tipo_atividade_id != null ? String(atividadeAtual.tipo_atividade_id) : "");
    // Sem frente nenhuma (o serviço do fluxo antigo), a linha de ajuda diz que o serviço já está aberto sem abertura.
    setNomeServicoExistente(frentes.length === 0 ? String(operacaoDaAtividade?.nome_tipo ?? nomeDaAtividade) : "");
    setAdicionandoA(true);
    setPasso("abrir");
  };
  /** D-PROD-346: "Voltar" da atividade: a lista (quando houve), ou fecha. Com o painel de encerramento aberto, só fecha o painel. */
  const voltarDaAtividade = () => {
    if (enviando) return;
    if (encerrandoAtividade) {
      setEncerrandoAtividade(false);
      return;
    }
    if (listaDoPasto.length > 0) {
      setPasso("escolher");
      return;
    }
    onFechar();
  };
  /** D-PROD-346: "Voltar" do serviço da frente: volta à atividade (com as frentes). */
  const voltarDoServico = () => {
    if (enviando) return;
    zerarPaineis();
    setFrenteChave(null);
    setPasso("atividade");
  };

  /** Máquina escolhida: a leitura dela entra no horímetro (a pessoa pode mexer). @param {string} valor */
  const escolherMaquina = (valor) => {
    setBemId(valor);
    setHorimetro("");
    setHorimetroMexido(false);
    setErros((e) => semCampo(e, "bemId"));
  };
  /** Digitado no horímetro: a leitura da máquina não sobrescreve mais. @param {string} valor */
  const digitarHorimetro = (valor) => {
    setHorimetro(valor);
    setHorimetroMexido(true);
    setErros((e) => semCampo(e, "horimetro"));
  };

  /**
   * D-PROD-332 (emenda) — envia a abertura com `bem_id`. FALLBACK: um servidor que ainda não aceita `bem_id` (o backend desta
   * emenda não foi publicado) recusa o campo desconhecido; aí tenta UMA vez sem ele (o resto do corpo é o mesmo; a máquina
   * continua na observação). A recusa limpa a pendência do envio, então a 2ª tentativa tem chave nova. Outro erro segue como
   * estava. Fica aqui (não no `registrarCampo` compartilhado).
   * @param {Record<string, unknown>} corpo @param {string} bem
   */
  const enviarAbertura = async (corpo, bem) => {
    try {
      return await registrarCampo({ ...corpo, bem_id: bem }, { escopo });
    } catch (erro) {
      if (!ehCampoDesconhecido(erro, "bem_id")) throw erro;
      return registrarCampo(corpo, { escopo });
    }
  };

  /** "Iniciar serviço": valida, grava (um envio só) e, com a atividade de volta, vai às frentes (passo `atividade`). */
  const iniciarServico = async () => {
    if (enviandoRef.current || !podeGravar || semOperacao) return;
    // D-PROD-341 (frentes e P1): a trava é o motivo real de não enviar, então vem antes da validação dos campos.
    if (motivoTrava) {
      notifyWarning("Não foi possível iniciar o serviço", motivoTrava);
      return;
    }
    const plantio = tipoFixo === "PLANTIO";
    const novosErros = validarAbertura({ operacaoId, pedirOperacao: pedirOperacaoNoForm, bemId, horimetro, responsavelId, pedirCapim: plantio, culturaId });
    setErros(novosErros);
    if (Object.keys(novosErros).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    const novaAbertura = {
      bemId,
      implementoId,
      horimetro: parseHorimetroPtBr(horimetro) ?? "",
      responsavelId,
      bemNome: bens.find((b) => String(b.id) === bemId)?.nome ?? "",
      implementoNome: implementos.find((i) => String(i.id) === implementoId)?.nome ?? "",
      responsavelNome: operadores.find((o) => String(o.id) === responsavelId)?.nome ?? operadores.find((o) => String(o.id) === responsavelId)?.rotulo ?? "",
    };
    // D-PROD-341 (frentes): sem os dados carregados (a trava acima é pelos carregados), confere pela leitura das atividades
    // abertas do tipo antes do envio (o cache serve quando há). Nada é enviado nesse caso.
    if (abertasDoTipo.length) {
      const chave = chaveDaFrente(novaAbertura);
      try {
        for (const a of abertasDoTipo) {
          const idDaAberta = String(a.atividade_id);
          const lista = await queryClient.fetchQuery({ queryKey: chaveApontamentos(empresaId, idDaAberta), queryFn: () => listarApontamentos(idDaAberta), staleTime: 15 * 1000 });
          const frentesDaAberta = frentesDosApontamentos(itensDaLista(lista));
          if (frentesDaAberta.some((f) => f.chave === chave)) {
            const encerrada = frentesDaAberta.find((f) => f.chave === chave)?.encerrada === true;
            notifyWarning("Não foi possível iniciar o serviço", encerrada ? MSG_FRENTE_ENCERRADA : MSG_FRENTE_DUPLICADA);
            return;
          }
        }
      } catch (erro) {
        notifyWarning("Não foi possível iniciar o serviço", mensagemDeErroAtividade(erro, "Não foi possível conferir os serviços abertos deste pasto. Confira a conexão e tente de novo."));
        return;
      }
    }
    enviandoRef.current = true;
    setEnviando(true);
    try {
      // A máquina vai em `bem_id` (o `bem_id` da atividade; NÃO é uma linha de uso, então `maquinas` não é enviado) e na
      // observação (a leitura do cabeçalho). O capim vai em `plantio` só no Plantio de pastagem (só `cultura_id`).
      const corpo = {
        area_id: String(area.id),
        tipo_atividade_id: operacaoId,
        data_operacional: hoje,
        observacao: marcadorDaAbertura(novaAbertura),
        operador_usuario_id: responsavelId,
        ...(plantio ? { plantio: { cultura_id: culturaId } } : {}),
      };
      const resposta = await enviarAbertura(corpo, bemId);
      const id = resposta?.atividade?.id ?? resposta?.apontamento?.atividade_id;
      if (id == null || id === "") {
        notifyWarning("Atenção", "O servidor não devolveu o serviço. Confira o Histórico da área antes de tentar de novo.");
        onGravou?.(resposta);
        return;
      }
      const detalhe = await obterAtividade(String(id)).catch(() => null);
      // O apontamento recém-criado entra nas frentes quando a consulta for feita (a atividade do passo `atividade`).
      await queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, String(id)) });
      setAtividadeAtual(detalhe ?? resposta?.atividade ?? { id });
      setFrenteChave(null);
      setAdicionandoA(false);
      setNomeServicoExistente("");
      onGravou?.(resposta);
      notifySuccess("Sucesso", "Serviço iniciado.");
      setPasso("atividade");
    } catch (erro) {
      notifyWarning("Não foi possível iniciar o serviço", mensagemDeErroAtividade(erro, "Confira e tente de novo."));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  // ─── D-PROD-346: encerrar uma frente e a atividade ──────────────────
  /**
   * Um apontamento do dia que encerra UMA frente: a linha `[encerramento-servico …]` na observação, com o horímetro final
   * canônico e o responsável da frente como operador. Com várias áreas na atividade, a área do pasto (como a carga).
   * @param {any} abertura a abertura da frente @param {string} textoFinal o horímetro final digitado (pt-BR)
   */
  const gravarEncerramento = (abertura, textoFinal) =>
    criarApontamento(String(atividadeId), {
      data_operacional: hoje,
      ...(atividadeAreaId && areasDaAtividade(atividadeAtual).length > 1 ? { atividade_area_id: atividadeAreaId } : {}),
      observacao: marcadorDoEncerramento({
        bemId: abertura.bemId,
        implementoId: abertura.implementoId,
        horimetro: parseHorimetroPtBr(textoFinal),
        bemNome: abertura.bemNome,
        implementoNome: abertura.implementoNome,
      }),
      operador_usuario_id: abertura.responsavelId,
    });

  const abrirEncerrarFrente = () => {
    setEmBreve(null);
    setHorimetroFinal("");
    setErrosFinal({});
    setEncerrandoFrente(true);
  };
  /** "Encerrar serviço" (a frente tocada): valida o horímetro final, grava o encerramento da frente e volta às frentes. */
  const encerrarFrente = async () => {
    if (enviandoRef.current || !podeGravar || !abertura || !frenteAtual || frenteAtual.encerrada || !atividadeId) return;
    const erros = validarEncerramento({ horimetroFinal, horimetroInicial: abertura.horimetro });
    setErrosFinal(erros);
    if (erros.horimetroFinal) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const resposta = await gravarEncerramento(abertura, horimetroFinal);
      await queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, atividadeId) });
      onGravou?.(resposta);
      notifySuccess("Sucesso", "Serviço encerrado.");
      setEncerrandoFrente(false);
      setHorimetroFinal("");
      setFrenteChave(null);
      setPasso("atividade");
    } catch (erro) {
      notifyWarning("Não foi possível encerrar o serviço", mensagemDeErroAtividade(erro, "Confira e tente de novo."));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const abrirEncerrarAtividade = () => {
    if (enviando || apontamentosLidos.isPending) return;
    setHorimetrosFim({});
    setErrosFim({});
    setEncerrandoAtividade(true);
  };
  /**
   * "Encerrar atividade": lê as frentes de novo (as já encerradas saem), valida o horímetro final de cada aberta e grava um
   * encerramento por frente, em sequência (para no primeiro erro, dizendo qual máquina). Depois lê a atividade (a `versao`)
   * e a conclui. Se as máquinas já foram encerradas e a conclusão falha, avisa e deixa tentar de novo.
   */
  const encerrarAtividade = async () => {
    if (enviandoRef.current || !podeGravar || !atividadeId) return;
    const id = atividadeId;
    enviandoRef.current = true;
    setEnviando(true);
    let encerrouAlguma = false;
    try {
      const lista = await queryClient.fetchQuery({ queryKey: chaveApontamentos(empresaId, id), queryFn: () => listarApontamentos(id), staleTime: 0 });
      const abertas = frentesDosApontamentos(itensDaLista(lista)).filter((f) => !f.encerrada);
      /** @type {Record<string, string>} */
      const novosErros = {};
      for (const f of abertas) {
        const e = validarEncerramento({ horimetroFinal: horimetrosFim[f.chave], horimetroInicial: f.abertura.horimetro });
        if (e.horimetroFinal) novosErros[f.chave] = e.horimetroFinal;
      }
      setErrosFim(novosErros);
      if (Object.keys(novosErros).length) {
        notifyWarning("Atenção", "Revise os campos destacados.");
        return;
      }
      for (const f of abertas) {
        try {
          await gravarEncerramento(f.abertura, horimetrosFim[f.chave]);
          encerrouAlguma = true;
        } catch (erro) {
          await queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, id) });
          const antes = encerrouAlguma ? " As anteriores já foram encerradas; tente de novo." : "";
          notifyWarning("Não foi possível encerrar a atividade", `A máquina ${tituloDaFrente(f.abertura)} não foi encerrada.${antes} ${mensagemDeErroAtividade(erro, "Confira e tente de novo.")}`);
          return;
        }
      }
      let resposta;
      try {
        const detalhe = /** @type {any} */ (await obterAtividade(id));
        resposta = await concluirAtividade(id, { versao: detalhe?.versao, data_conclusao: hoje });
      } catch (erro) {
        if (!encerrouAlguma) throw erro;
        await queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, id) });
        notifyWarning("Não foi possível encerrar a atividade", "As máquinas foram encerradas, mas não foi possível encerrar a atividade. Tente de novo.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, id) });
      onGravou?.(resposta);
      notifySuccess("Sucesso", "Atividade encerrada.");
      onFechar();
    } catch (erro) {
      notifyWarning("Não foi possível encerrar a atividade", mensagemDeErroAtividade(erro, "Confira a conexão e tente de novo."));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  // ─── Títulos ────────────────────────────────────────────────────────
  const hectares = hectaresDaArea(area?.tamanho_hectares);
  const subDaArea = [area?.nome, hectares ? `${hectares} ha` : ""].filter(Boolean).join(" · ");
  const carga = passo === "iniciado" && insumoAberto;
  const tituloTexto = carga
    ? "Insumo"
    : passo === "iniciado"
      ? "Diário das atividades"
      : passo === "atividade"
        ? nomeDaAtividade || "Atividade"
        : passo === "abrir"
          ? adicionandoA
            ? "Adicionar máquina"
            : `Nova atividade de ${rotuloDoTipo}`
          : passo === "escolher"
            ? "Em andamento neste pasto"
            : "Nova atividade";
  const subTitulo = carga
    ? [rotuloTipo, abertura?.implementoNome].filter(Boolean).join(" · ")
    : passo === "iniciado"
      ? [rotuloTipo, "Hoje", diaCurto(hoje)].filter(Boolean).join(" · ")
      : passo === "abrir" && adicionandoA
        ? [nomeDaAtividade, subDaArea].filter(Boolean).join(" · ")
        : subDaArea;
  const titulo = (
    <span className="b1-realizacao__titulo" data-testid="diario-atividades-titulo">
      <span className="b1-realizacao__titulo-nome">{tituloTexto}</span>
      {subTitulo ? <span className="b1-realizacao__titulo-sub">{subTitulo}</span> : null}
    </span>
  );
  const voltar =
    passo === "abrir" ? (
      <button type="button" className="tb-btn tb-btn-icon tb-btn-sm b1-realizacao__voltar" aria-label="Voltar" title="Voltar" onClick={voltarAoTipo} disabled={enviando} data-testid="abertura-voltar">
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>
    ) : passo === "tipo" && temAbertas ? (
      <button type="button" className="tb-btn tb-btn-icon tb-btn-sm b1-realizacao__voltar" aria-label="Voltar" title="Voltar" onClick={voltarDoTipo} disabled={enviando} data-testid="diario-voltar-lista">
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>
    ) : carga ? (
      <button
        type="button"
        className="tb-btn tb-btn-icon tb-btn-sm b1-realizacao__voltar"
        aria-label="Voltar ao serviço"
        title="Voltar ao serviço"
        onClick={() => setInsumoAberto(false)}
        disabled={cargaEnviando}
        data-testid="carga-voltar"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>
    ) : passo === "atividade" ? (
      <button type="button" className="tb-btn tb-btn-icon tb-btn-sm b1-realizacao__voltar" aria-label="Voltar" title="Voltar" onClick={voltarDaAtividade} disabled={enviando} data-testid="atividade-voltar">
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>
    ) : passo === "iniciado" ? (
      <button type="button" className="tb-btn tb-btn-icon tb-btn-sm b1-realizacao__voltar" aria-label="Voltar à atividade" title="Voltar à atividade" onClick={voltarDoServico} disabled={enviando} data-testid="servico-voltar-atividade">
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>
    ) : null;

  // ─── Corpo ──────────────────────────────────────────────────────────
  /** Passo 1 (tela 01): os 7 tipos fixos em cartões, como a Nova realização. */
  const cartoes = (
    <div className="b1-realizacao__passo" data-testid="diario-atividades-tipos">
      <p className="b1-realizacao__ajuda">Escolha o tipo de serviço.</p>
      <ul className="b1-realizacao__cartoes" aria-label="Tipos de serviço">
        {TIPOS_FIXOS_ATIVIDADE.map((t) => {
          const IconeDoCartao = iconeDoTipoAtividade({ nome_tipo: t.label, categoria: t.value });
          const sub = SUB_DO_TIPO[/** @type {keyof typeof SUB_DO_TIPO} */ (t.value)];
          return (
            <li key={t.value} className="min-w-0">
              <button
                type="button"
                className="b1-realizacao__cartao"
                aria-pressed={t.value === tipoFixo}
                onClick={() => escolherTipo(t.value)}
                data-testid={`abertura-tipo-${t.value}`}
              >
                <span className="b1-realizacao__cartao-icone" aria-hidden>
                  <IconeDoCartao size={22} strokeWidth={1.75} />
                </span>
                <span className="b1-realizacao__cartao-nome">{t.label}</span>
                {sub ? <span className="cartao-sub">{sub}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  /** Passo 2 (tela 02): a abertura, na ordem Operação (se houver mais de uma), Máquina, Implemento, Horímetro, Responsável. */
  const formulario = (
    <form
      className="grid grid-cols-12 gap-3 b1-form-embutido b1-realizacao__abertura"
      data-densidade={DENSIDADE_BASE1}
      noValidate
      data-testid="abertura-form"
      onSubmit={(e) => {
        e.preventDefault();
        void iniciarServico();
      }}
    >
      {pedirOperacaoNoForm ? (
        <CampoEscolha
          label="Operação"
          required
          value={operacaoEscolhidaId}
          onChange={(v) => {
            setOperacaoEscolhidaId(v);
            setErros((e) => semCampo(e, "operacaoId"));
          }}
          options={operacoes.map((o) => ({ value: String(o.id), label: o.nome_tipo }))}
          error={erros.operacaoId}
          readOnly={enviando}
          testId="abertura-operacao"
        />
      ) : null}
      <CampoEscolha
        label="Máquina"
        required
        value={bemId}
        onChange={escolherMaquina}
        options={bens.map((b) => ({ value: String(b.id), label: b.nome }))}
        error={erros.bemId}
        readOnly={enviando}
        testId="abertura-maquina"
      />
      <CampoEscolha
        label="Implemento"
        value={implementoId}
        onChange={(v) => setImplementoId(v)}
        options={implementos.map((i) => ({ value: String(i.id), label: i.nome }))}
        opcaoVazia="— Sem implemento —"
        readOnly={enviando}
        testId="abertura-implemento"
      />
      <CampoTexto
        label="Horímetro inicial"
        required
        value={horimetro}
        onChange={digitarHorimetro}
        error={erros.horimetro}
        span={12}
        inputMode="decimal"
        keepCase
        readOnly={enviando}
        dica={bemId && medidorLido.isSuccess ? textoDaLeituraVigente(medidor) : undefined}
        testId="abertura-horimetro"
      />
      <CampoEscolha
        label="Responsável"
        required
        value={responsavelId}
        onChange={(v) => {
          setResponsavelId(v);
          setErros((e) => semCampo(e, "responsavelId"));
        }}
        options={operadores.map((o) => ({ value: String(o.id), label: o.nome ?? o.rotulo ?? "" }))}
        error={erros.responsavelId}
        readOnly={enviando}
        testId="abertura-responsavel"
      />
      {tipoFixo === "PLANTIO" ? (
        <CampoEscolha
          label="Capim"
          required
          value={culturaId}
          onChange={(v) => {
            setCulturaId(v);
            setErros((e) => semCampo(e, "culturaId"));
          }}
          options={capins.map((c) => ({ value: String(c.id), label: String(c.nome ?? "") }))}
          opcaoVazia={capins.length ? "Escolha o capim" : culturasLidas.isLoading ? "Lendo o cadastro…" : "Nenhum capim no cadastro"}
          error={erros.culturaId}
          readOnly={enviando}
          testId="abertura-capim"
        />
      ) : null}
    </form>
  );

  /** Passo 3 (tela 05): o serviço de UMA frente — o cabeçalho, as 7 opções, "Lançado hoje" e o "Encerrar serviço". */
  const iniciado = (
    <div className="b1-realizacao__passo" data-testid="abertura-iniciado">
      <section className="b1-aberto-topo" aria-label="Serviço aberto">
        <div className="b1-aberto-topo__l1">
          <strong>{rotuloTipo || "Serviço"}</strong>
          <span className={frenteAtual?.encerrada ? "b1-aberto-chip b1-aberto-chip--neutro" : "b1-aberto-chip"}>{frenteAtual?.encerrada ? "● Encerrado" : "● Aberto"}</span>
        </div>
        <div className="b1-aberto-grid">
          <div>
            <i className="b1-aberto-grid__rotulo">Máquina</i>
            {abertura?.bemNome || "—"}
          </div>
          <div>
            <i className="b1-aberto-grid__rotulo">Implemento</i>
            {abertura?.implementoNome || "—"}
          </div>
          <div>
            <i className="b1-aberto-grid__rotulo">Responsável</i>
            {abertura?.responsavelNome || "—"}
          </div>
          <div>
            <i className="b1-aberto-grid__rotulo">Pasto</i>
            {area?.nome || "—"}
          </div>
        </div>
        <div className="b1-aberto-horimetro" data-testid="abertura-horimetro-inicial">
          Horímetro inicial {abertura ? formatarHorimetro(abertura.horimetro) || "—" : "—"}
        </div>
      </section>
      {encerrandoFrente && abertura ? (
        <PainelEncerrarFrente
          abertura={abertura}
          horimetroFinal={horimetroFinal}
          erro={errosFinal.horimetroFinal}
          readOnly={enviando}
          onChange={(v) => {
            setHorimetroFinal(v);
            setErrosFinal({});
          }}
        />
      ) : emBreve !== null ? (
        <section className="b1-aberto-painel" aria-label={emBreve} data-testid="servico-em-breve">
          <strong className="b1-aberto-painel__titulo">{emBreve}</strong>
          <p className="b1-aberto-breve">Em breve: esta parte ainda vai ser feita.</p>
        </section>
      ) : (
        <>
          <div className="b1-aberto-opcoes" role="list" aria-label="O que fazer no serviço">
            {OPCOES_DO_SERVICO.map((o) => {
              const Icone = o.Icone;
              return (
                <div key={o.chave} role="listitem" className={o.chave === "outros-custos" ? "b1-aberto-opcao--inteira" : undefined}>
                  <button type="button" className="b1-aberto-opcao" onClick={() => (o.chave === "insumo" ? setInsumoAberto(true) : setEmBreve(o.titulo))} data-testid={`servico-opcao-${o.chave}`}>
                    <span className="b1-aberto-opcao__icone" aria-hidden>
                      <Icone size={18} strokeWidth={1.75} />
                    </span>
                    <span className="b1-aberto-opcao__texto">
                      <strong className="b1-aberto-opcao__titulo">{o.titulo}</strong>
                      <span className="b1-aberto-opcao__sub">{o.sub}</span>
                    </span>
                    <ChevronRight className="b1-aberto-opcao__seta" size={18} aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
          <h3 className="b1-aberto-secao">Lançado hoje</h3>
          {lancadosHoje.length ? (
            <ul className="b1-aberto-lancados" aria-label="Lançado hoje">
              {lancadosHoje.map((l) => {
                const Icone = ICONE_DO_LANCAMENTO[/** @type {keyof typeof ICONE_DO_LANCAMENTO} */ (l.tipo)];
                return (
                  <li key={l.chave} className="b1-aberto-lancado" data-testid="servico-lancado-item">
                    <span className="b1-aberto-lancado__hora">{l.hora}</span>
                    <span className="b1-aberto-lancado__icone" aria-hidden>
                      <Icone size={16} strokeWidth={1.75} />
                    </span>
                    <span className="b1-aberto-lancado__texto">
                      <strong>{l.titulo}</strong>
                      {l.sub ? <span className="b1-aberto-lancado__sub">{l.sub}</span> : null}
                    </span>
                    <span className="b1-aberto-lancado__qtd">{l.quantidade}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="b1-aberto-vazio" data-testid="servico-nada-lancado">
              Nada lançado ainda
            </p>
          )}
        </>
      )}
    </div>
  );

  const semOperacaoAviso = semOperacao ? (
    <AvisoGestao testId="abertura-sem-operacao">Não há operação cadastrada para este tipo. Cadastre em Tipos de Atividade.</AvisoGestao>
  ) : null;
  /** D-PROD-341: o tipo já tem uma atividade aberta no pasto. Só aviso: o servidor reaproveita essa atividade. */
  const avisoJaExiste =
    abertaDoTipo && !nomeServicoExistente ? (
      <p className="b1-realizacao__ajuda" data-testid="abertura-ja-existe">
        {`Já existe ${abertaDoTipo.nome || abertaDoTipo.tipo_atividade_nome} aberta neste pasto: este serviço entra nela como mais uma frente (outra máquina ou implemento).`}
      </p>
    ) : null;
  /**
   * D-PROD-341 (passo `escolher`): as atividades abertas do pasto. D-PROD-346: UM cartão por atividade (as máquinas em campo
   * vêm das frentes de cada uma, lidas uma vez por atividade; o cache é o mesmo da abertura).
   */
  // A atividade recebida entra na lista se o pasto ainda não a listou (a lista nunca sai vazia por isso).
  const listaDoPasto = useMemo(
    () =>
      !atividade || atividadesAbertas.some((a) => String(a.atividade_id) === String(atividade.id))
        ? atividadesAbertas
        : [
            { atividade_id: String(atividade.id), nome: atividade.nome, tipo_atividade_id: atividade.tipo_atividade_id, tipo_atividade_nome: atividade.tipo_atividade_nome, data_inicio: atividade.data_inicio },
            ...atividadesAbertas,
          ],
    [atividade, atividadesAbertas],
  );
  const consultasDasAtividades = useQueries({
    queries: listaDoPasto.map((a) => ({
      queryKey: chaveApontamentos(empresaId, String(a.atividade_id)),
      queryFn: () => listarApontamentos(String(a.atividade_id)),
      enabled: Boolean(empresaId) && passo === "escolher",
      staleTime: 15 * 1000,
    })),
  });
  /** As frentes de cada atividade da lista (`null` = ainda lendo). */
  const frentesPorAtividade = new Map(
    listaDoPasto.map((a, i) => [String(a.atividade_id), consultasDasAtividades[i]?.isSuccess ? frentesDosApontamentos(itensDaLista(consultasDasAtividades[i].data)) : null]),
  );
  const listaEmAndamento = (
    <div className="b1-realizacao__passo" data-testid="diario-atividades-escolher">
      <p className="b1-realizacao__ajuda">Toque num serviço para continuar, ou comece uma nova atividade.</p>
      <div className="b1-aberto-opcoes b1-aberto-opcoes--lista" role="list" aria-label="Atividades em andamento neste pasto">
        {listaDoPasto.map((a) => (
          <CartaoDaAtividade key={a.atividade_id} atividade={a} frentes={frentesPorAtividade.get(String(a.atividade_id)) ?? null} ocupado={abrindoAtividade !== null} onTocar={tocarAtividadeAberta} />
        ))}
      </div>
    </div>
  );

  /** D-PROD-346 (passo `atividade`): a atividade com as frentes; o encerramento entra no lugar da lista quando aberto. */
  const painelDaAtividade = encerrandoAtividade ? (
    <PainelEncerrarAtividade
      nome={nomeDaAtividade}
      abertas={frentesAbertas}
      lendo={apontamentosLidos.isPending}
      erroLeitura={apontamentosLidos.isError}
      onTentarLeitura={() => void apontamentosLidos.refetch()}
      valores={horimetrosFim}
      erros={errosFim}
      readOnly={enviando}
      onChange={(chave, valor) => {
        setHorimetrosFim((m) => ({ ...m, [chave]: valor }));
        setErrosFim((e) => semCampo(e, chave));
      }}
    />
  ) : null;
  /** D-PROD-346: "Encerrar atividade" só confirma com as frentes LIDAS (sem leitura, não há horímetro a conferir). */
  const frentesLidas = apontamentosLidos.isSuccess;

  const rodape =
    passo === "tipo" ? (
      <>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} data-testid="abertura-cancelar">
          Cancelar
        </button>
        <button type="button" className={BOTAO_PRIMARIO} onClick={continuarDoTipo} disabled={!tipoFixo} data-testid="abertura-continuar">
          Continuar
        </button>
      </>
    ) : passo === "abrir" ? (
      <>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={cancelarAbertura} disabled={enviando} data-testid="abertura-cancelar">
          Cancelar
        </button>
        <button
          type="button"
          className={BOTAO_PRIMARIO}
          onClick={() => void iniciarServico()}
          disabled={!podeGravar || semOperacao || enviando || motivoTrava !== ""}
          data-testid="abertura-iniciar"
        >
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {enviando ? "Iniciando…" : "Iniciar serviço"}
        </button>
      </>
    ) : passo === "escolher" ? (
      <button type="button" className={`${BOTAO_PRIMARIO} b1-aberto-rodape-unico`} onClick={novaAtividade} disabled={abrindoAtividade !== null} data-testid="diario-nova-atividade">
        Nova atividade
      </button>
    ) : passo === "atividade" ? (
      encerrandoAtividade ? (
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setEncerrandoAtividade(false)} disabled={enviando} data-testid="atividade-encerrar-cancelar">
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => void encerrarAtividade()} disabled={!podeGravar || enviando || !frentesLidas} data-testid="atividade-encerrar-confirmar">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {enviando ? "Encerrando…" : "Encerrar atividade"}
          </button>
        </>
      ) : (
        <button type="button" className={`${BOTAO_SECUNDARIO} b1-aberto-rodape-unico`} onClick={abrirEncerrarAtividade} disabled={enviando || apontamentosLidos.isPending} data-testid="atividade-encerrar">
          <Square className="h-4 w-4" aria-hidden />
          Encerrar atividade
        </button>
      )
    ) : carga ? (
      // D-PROD-334: o "Salvar carga" é desenhado pela própria CargaDeInsumo, neste lugar (portal).
      <div ref={setAlvoRodapeCarga} className="contents" />
    ) : lendoFrente ? null : encerrandoFrente ? (
      <>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setEncerrandoFrente(false)} disabled={enviando} data-testid="servico-encerrar-voltar">
          Voltar ao serviço
        </button>
        <button type="button" className={BOTAO_PRIMARIO} onClick={() => void encerrarFrente()} disabled={!podeGravar || enviando} data-testid="servico-encerrar-confirmar">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {enviando ? "Encerrando…" : "Encerrar serviço"}
        </button>
      </>
    ) : emBreve !== null ? (
      <button type="button" className={`${BOTAO_SECUNDARIO} b1-aberto-rodape-unico`} onClick={() => setEmBreve(null)} data-testid="servico-voltar">
        Voltar ao serviço
      </button>
    ) : frenteAtual?.encerrada ? null : (
      <button type="button" className={`${BOTAO_SECUNDARIO} b1-aberto-rodape-unico`} onClick={abrirEncerrarFrente} disabled={enviando} data-testid="servico-encerrar">
        <Square className="h-4 w-4" aria-hidden />
        Encerrar serviço
      </button>
    );

  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!enviando && !cargaEnviando}
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo={titulo}
      antesDoTitulo={voltar}
      testId="diario-atividades"
      className={`b1-realizacao b1-aberto-janela${celular ? " b1-janela--tela-cheia" : ""}`}
      contentProps={{ "data-permissao-explicita": "", "data-celular": celular ? "" : undefined, "data-passo": passo, className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
      fora={<div ref={setAlvoFolha} className="contents" />}
      rodape={rodape}
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        {passo !== "iniciado" && avisoStatus ? <AvisoGestao testId="diario-atividades-aviso">{avisoStatus}</AvisoGestao> : null}
        {passo === "escolher" ? listaEmAndamento : null}
        {passo === "tipo" ? (
          <>
            {cartoes}
            {avisoJaExiste}
          </>
        ) : null}
        {passo === "abrir" ? (
          <>
            {semOperacaoAviso}
            {nomeServicoExistente ? (
              <p className="b1-realizacao__ajuda" data-testid="abertura-servico-existente">
                {`Este pasto já tem o serviço ${nomeServicoExistente} em andamento, sem abertura. Preencha para iniciar.`}
              </p>
            ) : null}
            {adicionandoA ? null : avisoJaExiste}
            {motivoTrava ? (
              <p className="b1-realizacao__ajuda" data-testid="abertura-trava">
                {motivoTrava}
              </p>
            ) : null}
            {formulario}
          </>
        ) : null}
        {passo === "atividade" ? (
          <AtividadeComFrentes
            atividade={atividadeAtual}
            nome={nomeDaAtividade}
            pasto={area?.nome ?? ""}
            frentes={frentes}
            apontamentos={apontamentosDaAtividade}
            lendo={apontamentosLidos.isLoading}
            erro={apontamentosLidos.isError}
            hoje={hoje}
            fuso={fuso}
            ocupado={enviando}
            painel={painelDaAtividade}
            onAbrirFrente={abrirFrente}
            onAdicionar={adicionarMaquina}
          />
        ) : null}
        {passo === "iniciado" && lendoFrente ? (
          <div className="b1-realizacao__passo" data-testid="abertura-carregando">
            {apontamentosLidos.isError ? (
              <AvisoGestao testId="servico-erro-leitura">Não foi possível ler este serviço.</AvisoGestao>
            ) : (
              <p role="status" className="b1-realizacao__ajuda">
                Carregando…
              </p>
            )}
          </div>
        ) : null}
        {passo === "iniciado" && !lendoFrente && carga ? (
          <CargaDeInsumo
            atividadeId={String(atividadeId)}
            atividadeAreaId={atividadeAreaId}
            filtrarPorArea={areasDaAtividade(atividadeAtual).length > 1}
            onEnviando={setCargaEnviando}
            apontamentos={apontamentosDoServico}
            observacaoDoApontamento={abertura ? marcadorDaAbertura(abertura) : null}
            hoje={hoje}
            implementoNome={abertura?.implementoNome ?? ""}
            podeGravar={podeGravar}
            escopo={escopo}
            alvoRodape={alvoRodapeCarga}
            onSalvo={(resposta) => {
              onGravou?.(resposta);
              setInsumoAberto(false);
            }}
          />
        ) : null}
        {passo === "iniciado" && !lendoFrente && !carga ? iniciado : null}
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}
