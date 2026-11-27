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
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import {
  aberturaDosApontamentos,
  apontamentosDaFrente,
  chaveDaFrente,
  ehCampoDesconhecido,
  formatarHorimetro,
  frentesDosApontamentos,
  lancamentosDoDia,
  lerTodasAsPaginas,
  marcadorDaAbertura,
  parseHorimetroPtBr,
  validarAbertura,
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

/** D-PROD-339 (frentes): a mensagem da trava de duplicidade (mesma máquina + implemento já aberta no pasto). */
const MSG_FRENTE_DUPLICADA = "Esta máquina com este implemento já tem serviço aberto neste pasto. Toque nele na lista para continuar.";
/** D-PROD-339 (P1 da revisão do Codex): continuar a atividade sem abertura com mais de uma do mesmo tipo no pasto. */
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

/** "26/11" a partir do dia ISO (AAAA-MM-DD); sem dia, "". @param {string} iso */
const diaCurto = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

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

/** O título de um cartão de frente: a máquina, com " + " e o implemento quando há um. @param {any} abertura */
const tituloDaFrente = (abertura) => {
  const bem = abertura?.bemNome || "Máquina";
  return abertura?.implementoNome ? `${bem} + ${abertura.implementoNome}` : bem;
};

/**
 * D-PROD-339 (passo `escolher`) — uma atividade aberta do pasto vira UM CARTÃO POR FRENTE (cada máquina + implemento, com o
 * responsável e o início), ou UM cartão "Sem abertura" quando nenhuma frente tem abertura gravada (o serviço do fluxo antigo).
 * As frentes saem dos apontamentos da própria atividade (uma consulta por atividade; "…" enquanto lê). Se a leitura falhar,
 * sai o cartão "Sem abertura" sem etiqueta e segue tocável. Devolve os itens da lista (`role="listitem"`).
 * @param {{ atividade: any, empresaId: string | null | undefined, ocupado: boolean, onTocar: (atividade: any, chave: string | null) => void }} props
 */
function CartoesDaAtividadeAberta({ atividade, empresaId, ocupado, onTocar }) {
  const id = String(atividade.atividade_id);
  const apontamentos = useQuery({
    queryKey: chaveApontamentos(empresaId, id),
    queryFn: () => listarApontamentos(id),
    enabled: Boolean(empresaId && id),
    staleTime: 15 * 1000,
  });
  const frentes = useMemo(() => (apontamentos.isSuccess ? frentesDosApontamentos(itensDaLista(apontamentos.data)) : []), [apontamentos.isSuccess, apontamentos.data]);
  const nome = atividade.nome || atividade.tipo_atividade_nome || "Atividade";
  const Icone = iconeDoTipoAtividade({ nome_tipo: atividade.tipo_atividade_nome ?? atividade.nome });
  const inicioDaAtividade = diaCurto(atividade.data_inicio);

  if (frentes.length === 0) {
    const etiqueta = apontamentos.isSuccess ? "Sem abertura" : apontamentos.isError ? "" : "…";
    return (
      <div role="listitem">
        <button type="button" className="b1-aberto-opcao" onClick={() => onTocar(atividade, null)} disabled={ocupado} data-testid={`diario-atividade-aberta-${id}`}>
          <span className="b1-aberto-opcao__icone" aria-hidden>
            <Icone size={18} strokeWidth={1.75} />
          </span>
          <span className="b1-aberto-opcao__texto">
            <strong className="b1-aberto-opcao__titulo">{nome}</strong>
            {inicioDaAtividade ? <span className="b1-aberto-opcao__sub">{`Início ${inicioDaAtividade}`}</span> : null}
          </span>
          {etiqueta ? (
            <span className="b1-aberto-chip b1-aberto-chip--neutro" data-testid={`diario-atividade-aberta-etiqueta-${id}`}>
              {etiqueta}
            </span>
          ) : null}
        </button>
      </div>
    );
  }
  return (
    <>
      {frentes.map((f) => {
        const inicio = diaCurto(f.inicio);
        const responsavel = f.abertura.responsavelNome || "—";
        return (
          <div role="listitem" key={f.chave}>
            <button
              type="button"
              className="b1-aberto-opcao"
              onClick={() => onTocar(atividade, f.chave)}
              disabled={ocupado}
              data-testid={`diario-frente-${id}-${encodeURIComponent(f.chave)}`}
            >
              <span className="b1-aberto-opcao__icone" aria-hidden>
                <Icone size={18} strokeWidth={1.75} />
              </span>
              <span className="b1-aberto-opcao__texto">
                <strong className="b1-aberto-opcao__titulo">{tituloDaFrente(f.abertura)}</strong>
                <span className="b1-aberto-opcao__sub">{[`Responsável: ${responsavel}`, inicio ? `Início ${inicio}` : ""].filter(Boolean).join(" · ")}</span>
                <span className="b1-aberto-opcao__sub">{nome}</span>
              </span>
              <span className="b1-aberto-chip" data-testid={`diario-frente-etiqueta-${id}-${encodeURIComponent(f.chave)}`}>
                Em andamento
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}

/**
 * D-PROD-332 — o "Diário das atividades", só a ABERTURA de um serviço (Mapa Geral → Detalhes da área → Manejos). Uma janela
 * Base1 com três passos:
 *  - `escolher` (D-PROD-339, só com atividades abertas no pasto): "Em andamento neste pasto", um cartão por FRENTE (máquina +
 *    implemento de cada serviço aberto; sem frente, um cartão "Sem abertura") e "Nova atividade";
 *  - `tipo` (tela 01): os 7 tipos fixos em cartões; "Continuar" leva ao passo seguinte (com lista, o Voltar volta a ela);
 *  - `abrir` (tela 02): "Nova atividade de <Tipo>" — Máquina *, Implemento (opcional), Horímetro inicial *, Responsável *
 *    (e, no Plantio de pastagem, Capim *, depois do Responsável);
 *    com mais de uma operação do tipo, a Operação * vem antes (com uma só, ela é escolhida sozinha; com nenhuma, aviso);
 *  - `iniciado` (tela 05): o serviço aberto — o cabeçalho (tipo, máquina, implemento, responsável, pasto e horímetro),
 *    as 7 opções (cada uma abre um painel "Em breve") e "Lançado hoje" (as linhas de hoje, lidas dos apontamentos).
 *    D-PROD-339 (frentes): o serviço é UMA frente da atividade (os apontamentos com a mesma chave máquina|implemento); a
 *    carga e o "Lançado hoje" usam só os dela.
 *
 * Abrir o serviço é um envio só: `registrarCampo` acha/abre a atividade do tipo na área e cria o apontamento do dia, com a
 * abertura na observação (`marcadorDaAbertura`, sem migration). Sem `atividade`, a janela começa no tipo; com uma atividade EM
 * ANDAMENTO do pasto, lê a abertura dela (da observação do apontamento mais recente) enquanto mostra "Carregando…": com abertura,
 * começa no cabeçalho; SEM abertura (o serviço do fluxo antigo, D-PROD-339), vai ao passo `abrir` com o tipo e a operação dela
 * já escolhidos (o servidor reaproveita a atividade aberta). Se a leitura falhar, começa no cabeçalho como antes.
 *
 * @param {{
 *   area: any,
 *   tipos?: any[],        // as operações (tipos de atividade) ativas
 *   atividade?: any | null, // a atividade em andamento do pasto, ou null
 *   atividadesAbertas?: any[], // D-PROD-339: as atividades do pasto que não estão concluídas (o resumo da área)
 *   lerAtividade?: (atividadeId: string) => Promise<any>, // D-PROD-339: lê a atividade inteira ao tocar numa linha
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
  const [passo, setPasso] = useState(/** @type {"escolher" | "tipo" | "abrir" | "iniciado"} */ (atividade ? "iniciado" : atividadesAbertas.length ? "escolher" : "tipo"));
  const [atividadeAtual, setAtividadeAtual] = useState(atividade);
  const operacaoDaAtividade = atividadeAtual ? tipos.find((t) => String(t.id) === String(atividadeAtual.tipo_atividade_id ?? "")) ?? null : null;
  /** D-PROD-339: a atividade tocada no passo `escolher` está sendo lida (a linha fica travada). */
  const [abrindoAtividade, setAbrindoAtividade] = useState(/** @type {string | null} */ (null));
  const [tipoFixo, setTipoFixo] = useState(/** @type {string} */ (operacaoDaAtividade ? tipoFixoDaOperacao(operacaoDaAtividade) : ""));
  const operacoes = useMemo(() => operacoesDoTipoFixo(tipos, tipoFixo), [tipos, tipoFixo]);
  const pedirOperacao = operacoes.length > 1;
  const semOperacao = tipoFixo !== "" && operacoes.length === 0;
  const [operacaoEscolhidaId, setOperacaoEscolhidaId] = useState("");
  // Com uma operação só, ela é usada sem perguntar; com mais de uma, vale a escolhida.
  const operacaoId = operacoes.length === 1 ? String(operacoes[0].id) : operacaoEscolhidaId;
  const rotuloTipo = tipoFixo ? rotuloDoTipoFixo(tipoFixo) : atividadeAtual?.tipo_atividade_nome ?? atividadeAtual?.nome ?? "";

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
  /** A abertura que acabou de ser gravada nesta janela (o cabeçalho usa ela; sem ela, a da consulta). */
  const [aberturaSalva, setAberturaSalva] = useState(/** @type {ReturnType<typeof aberturaDosApontamentos>} */ (null));
  /** D-PROD-339: o nome do serviço que já está aberto no pasto sem abertura (a linha de ajuda do formulário; "" = não é o caso). */
  const [nomeServicoExistente, setNomeServicoExistente] = useState("");
  /** D-PROD-339 (frentes): a frente (máquina + implemento) do serviço aberto; `null` = ainda não escolhida (lista ou leitura). */
  const [frenteChave, setFrenteChave] = useState(/** @type {string | null} */ (null));

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

  // ─── Cabeçalho do serviço aberto (passo "iniciado") ─────────────────
  const atividadeId = atividadeAtual?.id != null ? String(atividadeAtual.id) : null;
  // Os apontamentos da atividade (o cabeçalho e "Lançado hoje" leem daqui; a lista já traz as linhas).
  const apontamentosLidos = useQuery({
    queryKey: chaveApontamentos(empresaId, atividadeId),
    queryFn: () => listarApontamentos(/** @type {string} */ (atividadeId)),
    enabled: Boolean(empresaId && atividadeId && passo === "iniciado"),
    staleTime: 15 * 1000,
  });
  const apontamentosDaAtividade = useMemo(() => itensDaLista(apontamentosLidos.data), [apontamentosLidos.data]);
  /** D-PROD-339 (frentes): as frentes da atividade (uma por máquina + implemento), por início. */
  const frentes = useMemo(() => (apontamentosLidos.isSuccess ? frentesDosApontamentos(apontamentosDaAtividade) : []), [apontamentosLidos.isSuccess, apontamentosDaAtividade]);
  const frenteAtual = useMemo(() => (frenteChave ? (frentes.find((f) => f.chave === frenteChave) ?? null) : null), [frenteChave, frentes]);
  /** A abertura mais recente da atividade (sem frente escolhida, só para o início da leitura). */
  const aberturaLida = useMemo(() => (apontamentosLidos.isSuccess ? aberturaDosApontamentos(apontamentosDaAtividade) : null), [apontamentosLidos.isSuccess, apontamentosDaAtividade]);
  /** Os apontamentos DESTE serviço: os da frente escolhida (sem frente, a atividade inteira). Cabeçalho, "Lançado hoje" e carga leem daqui. */
  const apontamentosDoServico = useMemo(
    () => (frenteChave ? apontamentosDaFrente(apontamentosDaAtividade, frenteChave) : apontamentosDaAtividade),
    [frenteChave, apontamentosDaAtividade],
  );
  /** Os lançamentos de hoje do serviço (CONFIRMADO, por linha, sem R$), na ordem do horário. */
  const lancadosHoje = useMemo(() => lancamentosDoDia(apontamentosDoServico, hoje, fuso), [apontamentosDoServico, hoje, fuso]);
  // Com frente escolhida, a abertura DELA (a que acabou de ser gravada, se for a mesma); sem frente, a que acabou de ser gravada, ou a da consulta.
  const abertura = frenteChave ? (frenteAtual?.abertura ?? aberturaSalva) : (aberturaSalva ?? aberturaLida);
  // D-PROD-339 + frentes: o serviço aberto sem frente escolhida decide pela leitura. Uma frente → ela; mais de uma → a lista
  // ("escolher"); nenhuma → serviço SEM abertura gravada (o fluxo antigo): o formulário de abertura, com o tipo e a operação
  // dele já escolhidos (o servidor acha a atividade aberta do mesmo tipo e área e grava a abertura nela). Sem operação
  // conhecida, o passo do tipo. Com a leitura falhando, nada muda (o cabeçalho, como antes).
  useEffect(() => {
    if (passo !== "iniciado" || aberturaSalva || frenteChave || !apontamentosLidos.isSuccess) return;
    if (frentes.length > 1) {
      setPasso("escolher");
      return;
    }
    if (frentes.length === 1) {
      setFrenteChave(frentes[0].chave);
      return;
    }
    if (!operacaoDaAtividade) {
      setPasso("tipo");
      return;
    }
    setOperacaoEscolhidaId(String(operacaoDaAtividade.id));
    setNomeServicoExistente(String(operacaoDaAtividade.nome_tipo ?? rotuloTipo));
    setErros({});
    setPasso("abrir");
  }, [passo, aberturaSalva, frenteChave, apontamentosLidos.isSuccess, frentes, operacaoDaAtividade, rotuloTipo]);
  /** Enquanto a frente do serviço aberto é lida (ou a leitura terminou e o passo ainda vai mudar): "Carregando…", sem o cabeçalho nem o menu. */
  const aguardandoAbertura = passo === "iniciado" && !aberturaSalva && (apontamentosLidos.isLoading || (apontamentosLidos.isSuccess && !frenteChave));
  /** O painel "Em breve" da tela 05: o título da opção tocada (ou "Encerrar serviço"); null = o serviço aberto. */
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
  const voltarAoTipo = () => {
    if (enviando) return;
    setErros({});
    setNomeServicoExistente("");
    setPasso("tipo");
  };
  // ─── D-PROD-339: o passo "escolher" (Em andamento neste pasto) ──────
  const temAbertas = atividadesAbertas.length > 0;
  /** Os ids das operações que o tipo escolhido cobre (a escolhida, se já há uma). */
  const idsDaOperacao = operacaoId ? [operacaoId] : operacoes.map((o) => String(o.id));
  /** A atividade aberta do pasto deste tipo: a linha de ajuda "Já existe …" (o servidor reaproveita essa atividade). */
  const abertaDoTipo = tipoFixo ? atividadesAbertas.find((a) => idsDaOperacao.includes(String(a.tipo_atividade_id ?? ""))) ?? null : null;
  /** D-PROD-339 (frentes): as atividades abertas do tipo no pasto, quando o formulário vai abrir uma frente (não na continuação). */
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
  const chavesDoTipo = new Set(consultasDoTipo.flatMap((q) => frentesDosApontamentos(itensDaLista(q.data)).map((f) => f.chave)));
  /** A máquina + implemento do formulário (a chave da frente que ele abriria); "" sem máquina. */
  const chaveDoFormulario = bemId ? chaveDaFrente({ bemId, implementoId }) : "";
  /** Esta máquina com este implemento já tem frente aberta no pasto (pelos dados carregados): não envia. */
  const duplicada = chaveDoFormulario !== "" && chavesDoTipo.has(chaveDoFormulario);
  /** Continuar a atividade SEM abertura com mais de uma do mesmo tipo no pasto: o servidor entra na mais recente (P1). */
  const idDaAtividadeAtual = atividadeAtual?.id != null ? String(atividadeAtual.id) : null;
  const doMesmoTipo = nomeServicoExistente && operacaoId ? atividadesAbertas.filter((a) => String(a.tipo_atividade_id ?? "") === operacaoId).length : 0;
  // A escolhida conta mesmo que não esteja na lista do pasto.
  const escolhidaFora = Boolean(nomeServicoExistente && operacaoId && idDaAtividadeAtual && !atividadesAbertas.some((a) => String(a.atividade_id) === idDaAtividadeAtual));
  const ambiguo = doMesmoTipo + (escolhidaFora ? 1 : 0) > 1;
  /** O motivo de não enviar agora (a trava), ou "" quando pode. Mostrado como ajuda e no envio. */
  const motivoTrava = ambiguo ? MSG_TIPO_AMBIGUO : duplicada ? MSG_FRENTE_DUPLICADA : "";
  const novaAtividade = () => {
    if (enviando || abrindoAtividade !== null) return;
    setErros({});
    setPasso("tipo");
  };
  /** Do tipo, o Voltar leva à lista (só quando houve lista). */
  const voltarDoTipo = () => {
    if (enviando) return;
    setErros({});
    setPasso("escolher");
  };
  /**
   * Tocar num cartão da lista: lê a atividade inteira. Um cartão de FRENTE (`chave`) abre só aquela frente ("iniciado" com a
   * frente escolhida). O cartão "Sem abertura" (`chave` nula) segue o efeito do D-PROD-339: o formulário de abertura com o tipo
   * e a operação dela. Falha na leitura: aviso, e fica na lista.
   * @param {any} linha
   * @param {string | null} chave a frente tocada (null = o serviço sem abertura)
   */
  const tocarAtividadeAberta = async (linha, chave = null) => {
    if (abrindoAtividade !== null) return;
    setAbrindoAtividade(String(linha.atividade_id));
    try {
      const detalhe = await lerAtividade(String(linha.atividade_id));
      const operacao = tipos.find((t) => String(t.id) === String(detalhe?.tipo_atividade_id ?? "")) ?? null;
      setAtividadeAtual(detalhe);
      setTipoFixo(operacao ? tipoFixoDaOperacao(operacao) : "");
      setOperacaoEscolhidaId("");
      setAberturaSalva(null);
      setFrenteChave(chave);
      setNomeServicoExistente("");
      setErros({});
      setEmBreve(null);
      setPasso("iniciado");
    } catch (erro) {
      notifyWarning("Não foi possível abrir o serviço", mensagemDeErroAtividade(erro, "Confira a conexão e tente de novo."));
    } finally {
      setAbrindoAtividade(null);
    }
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

  /** "Iniciar serviço": valida, grava (um envio só) e, com a atividade de volta, vai ao cabeçalho. */
  const iniciarServico = async () => {
    if (enviandoRef.current || !podeGravar || semOperacao) return;
    // D-PROD-339 (frentes e P1): a trava é o motivo real de não enviar, então vem antes da validação dos campos.
    if (motivoTrava) {
      notifyWarning("Não foi possível iniciar o serviço", motivoTrava);
      return;
    }
    const plantio = tipoFixo === "PLANTIO";
    const novosErros = validarAbertura({ operacaoId, pedirOperacao, bemId, horimetro, responsavelId, pedirCapim: plantio, culturaId });
    setErros(novosErros);
    if (Object.keys(novosErros).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    const abertura = {
      bemId,
      implementoId,
      horimetro: parseHorimetroPtBr(horimetro) ?? "",
      responsavelId,
      bemNome: bens.find((b) => String(b.id) === bemId)?.nome ?? "",
      implementoNome: implementos.find((i) => String(i.id) === implementoId)?.nome ?? "",
      responsavelNome: operadores.find((o) => String(o.id) === responsavelId)?.nome ?? operadores.find((o) => String(o.id) === responsavelId)?.rotulo ?? "",
    };
    // D-PROD-339 (frentes): sem os dados carregados (a trava acima é pelos carregados), confere pela leitura das atividades
    // abertas do tipo antes do envio (o cache serve quando há). Nada é enviado nesse caso.
    if (abertasDoTipo.length) {
      const chave = chaveDaFrente(abertura);
      try {
        for (const a of abertasDoTipo) {
          const idDaAberta = String(a.atividade_id);
          const lista = await queryClient.fetchQuery({ queryKey: chaveApontamentos(empresaId, idDaAberta), queryFn: () => listarApontamentos(idDaAberta), staleTime: 15 * 1000 });
          if (frentesDosApontamentos(itensDaLista(lista)).some((f) => f.chave === chave)) {
            notifyWarning("Não foi possível iniciar o serviço", MSG_FRENTE_DUPLICADA);
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
        observacao: marcadorDaAbertura(abertura),
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
      // O apontamento recém-criado entra na lista ("Lançado hoje") quando a consulta for feita.
      void queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, String(id)) });
      setAtividadeAtual(detalhe ?? resposta?.atividade ?? { id });
      setAberturaSalva(abertura);
      setFrenteChave(chaveDaFrente(abertura));
      onGravou?.(resposta);
      notifySuccess("Sucesso", "Serviço iniciado.");
      setPasso("iniciado");
    } catch (erro) {
      notifyWarning("Não foi possível iniciar o serviço", mensagemDeErroAtividade(erro, "Confira e tente de novo."));
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
      : passo === "abrir"
        ? `Nova atividade de ${rotuloTipo}`
        : passo === "escolher"
          ? "Em andamento neste pasto"
          : "Nova atividade";
  const subTitulo = carga
    ? [rotuloTipo, abertura?.implementoNome].filter(Boolean).join(" · ")
    : passo === "iniciado" ? [rotuloTipo, "Hoje", diaCurto(hoje)].filter(Boolean).join(" · ") : subDaArea;
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
      {pedirOperacao ? (
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

  /** Passo 3 (tela 05): o serviço aberto — o cabeçalho, as 7 opções, "Lançado hoje" e o "Encerrar serviço". */
  const iniciado = (
    <div className="b1-realizacao__passo" data-testid="abertura-iniciado">
      <section className="b1-aberto-topo" aria-label="Serviço aberto">
        <div className="b1-aberto-topo__l1">
          <strong>{rotuloTipo || "Serviço"}</strong>
          <span className="b1-aberto-chip">● Aberto</span>
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
      {emBreve !== null ? (
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
  /** D-PROD-339: o tipo já tem uma atividade aberta no pasto. Só aviso: o servidor reaproveita essa atividade. */
  const avisoJaExiste =
    abertaDoTipo && !nomeServicoExistente ? (
      <p className="b1-realizacao__ajuda" data-testid="abertura-ja-existe">
        {`Já existe ${abertaDoTipo.nome || abertaDoTipo.tipo_atividade_nome} aberta neste pasto: este serviço entra nela como mais uma frente (outra máquina ou implemento).`}
      </p>
    ) : null;
  /** D-PROD-339 (passo `escolher`): as atividades abertas do pasto; tocar numa leva ao serviço ou à abertura dele. */
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
  const listaEmAndamento = (
    <div className="b1-realizacao__passo" data-testid="diario-atividades-escolher">
      <p className="b1-realizacao__ajuda">Toque num serviço para continuar, ou comece uma nova atividade.</p>
      <div className="b1-aberto-opcoes b1-aberto-opcoes--lista" role="list" aria-label="Atividades em andamento neste pasto">
        {listaDoPasto.map((a) => (
          <CartoesDaAtividadeAberta key={a.atividade_id} atividade={a} empresaId={empresaId} ocupado={abrindoAtividade !== null} onTocar={tocarAtividadeAberta} />
        ))}
      </div>
    </div>
  );

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
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando} data-testid="abertura-cancelar">
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
    ) : carga ? (
      // D-PROD-334: o "Salvar carga" é desenhado pela própria CargaDeInsumo, neste lugar (portal).
      <div ref={setAlvoRodapeCarga} className="contents" />
    ) : emBreve !== null ? (
      <button type="button" className={`${BOTAO_SECUNDARIO} b1-aberto-rodape-unico`} onClick={() => setEmBreve(null)} data-testid="servico-voltar">
        Voltar ao serviço
      </button>
    ) : (
      <button type="button" className={`${BOTAO_SECUNDARIO} b1-aberto-rodape-unico`} onClick={() => setEmBreve("Encerrar serviço")} data-testid="servico-encerrar">
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
      rodape={aguardandoAbertura ? null : rodape}
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
            {avisoJaExiste}
            {motivoTrava ? (
              <p className="b1-realizacao__ajuda" data-testid="abertura-trava">
                {motivoTrava}
              </p>
            ) : null}
            {formulario}
          </>
        ) : null}
        {passo === "iniciado" && aguardandoAbertura ? (
          <div className="b1-realizacao__passo" data-testid="abertura-carregando">
            <p role="status" className="b1-realizacao__ajuda">
              Carregando…
            </p>
          </div>
        ) : null}
        {passo === "iniciado" && !aguardandoAbertura && carga ? (
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
        {passo === "iniciado" && !aguardandoAbertura && !carga ? iniciado : null}
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}
