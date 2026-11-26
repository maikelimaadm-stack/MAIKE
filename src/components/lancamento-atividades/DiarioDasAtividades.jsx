import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Play } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import { aberturaDosApontamentos, formatarHorimetro, marcadorDaAbertura, parseHorimetroPtBr, validarAbertura } from "@/lib/aberturaServicoRegras";
import { RAIZ_CONSULTAS_ATIVIDADES, chaveApontamentos, itensDaLista, normalizarPaginaDeOpcoes } from "@/lib/atividadeApontamentoRegras";
import { medidorDaResposta, textoDaLeituraVigente } from "@/lib/atividadeLinhasRegras";
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

/** D-PROD-329 — a linha de apoio embaixo do nome do cartão (só o tipo que precisa). */
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

/**
 * D-PROD-329 — o "Diário das atividades", só a ABERTURA de um serviço (Mapa Geral → Detalhes da área → Manejos). Uma janela
 * Base1 com três passos:
 *  - `tipo` (tela 01): os 7 tipos fixos em cartões; "Continuar" leva ao passo seguinte;
 *  - `abrir` (tela 02): "Nova atividade de <Tipo>" — Máquina *, Implemento (opcional), Horímetro inicial *, Responsável *;
 *    com mais de uma operação do tipo, a Operação * vem antes (com uma só, ela é escolhida sozinha; com nenhuma, aviso);
 *  - `iniciado` (tela 03): o cabeçalho do serviço aberto (tipo, máquina, implemento, responsável, pasto e horímetro). As
 *    próximas ações (Encher implemento, Trocar pasto…) chegam nas próximas etapas.
 *
 * Abrir o serviço é um envio só: `registrarCampo` acha/abre a atividade do tipo na área e cria o apontamento do dia, com a
 * abertura na observação (`marcadorDaAbertura`, sem migration). Sem `atividade`, a janela começa no tipo; com uma atividade EM
 * ANDAMENTO do pasto, começa direto no cabeçalho (a abertura dela é lida da observação do apontamento mais recente).
 *
 * @param {{
 *   area: any,
 *   tipos?: any[],        // as operações (tipos de atividade) ativas
 *   atividade?: any | null, // a atividade em andamento do pasto, ou null
 *   onFechar: () => void,
 *   onGravou?: (resposta: any) => void,
 * }} props
 */
export default function DiarioDasAtividades({ area, tipos: todosOsTipos = [], atividade = null, onFechar, onGravou = undefined }) {
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
  const [passo, setPasso] = useState(/** @type {"tipo" | "abrir" | "iniciado"} */ (atividade ? "iniciado" : "tipo"));
  const [atividadeAtual, setAtividadeAtual] = useState(atividade);
  const operacaoDaAtividade = atividade ? tipos.find((t) => String(t.id) === String(atividade.tipo_atividade_id ?? "")) ?? null : null;
  const [tipoFixo, setTipoFixo] = useState(/** @type {string} */ (operacaoDaAtividade ? tipoFixoDaOperacao(operacaoDaAtividade) : ""));
  const operacoes = useMemo(() => operacoesDoTipoFixo(tipos, tipoFixo), [tipos, tipoFixo]);
  const pedirOperacao = operacoes.length > 1;
  const semOperacao = tipoFixo !== "" && operacoes.length === 0;
  const [operacaoEscolhidaId, setOperacaoEscolhidaId] = useState("");
  // Com uma operação só, ela é usada sem perguntar; com mais de uma, vale a escolhida.
  const operacaoId = operacoes.length === 1 ? String(operacoes[0].id) : operacaoEscolhidaId;
  const rotuloTipo = tipoFixo ? rotuloDoTipoFixo(tipoFixo) : atividade?.tipo_atividade_nome ?? atividade?.nome ?? "";

  // ─── Campos da abertura ─────────────────────────────────────────────
  const [bemId, setBemId] = useState("");
  const [implementoId, setImplementoId] = useState("");
  const [horimetro, setHorimetro] = useState("");
  // A pessoa digitou o horímetro: a leitura da máquina não sobrescreve mais (só ao trocar de máquina).
  const [horimetroMexido, setHorimetroMexido] = useState(false);
  const [responsavelId, setResponsavelId] = useState("");
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  /** A abertura que acabou de ser gravada nesta janela (o cabeçalho usa ela; sem ela, a da consulta). */
  const [aberturaSalva, setAberturaSalva] = useState(/** @type {ReturnType<typeof aberturaDosApontamentos>} */ (null));

  // ─── Opções (só no passo da abertura) ───────────────────────────────
  const bensLidos = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "abertura", "bens", empresaId],
    queryFn: () => listarOpcoesBens({}),
    enabled: Boolean(empresaId) && passo === "abrir",
    staleTime: 30 * 1000,
  });
  const implementosLidos = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "abertura", "implementos", empresaId],
    queryFn: () => listarOpcoesImplementos({}),
    enabled: Boolean(empresaId) && passo === "abrir",
    staleTime: 30 * 1000,
  });
  const operadoresLidos = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "abertura", "operadores", empresaId],
    queryFn: () => listarOpcoesOperadores({}),
    enabled: Boolean(empresaId) && passo === "abrir",
    staleTime: 30 * 1000,
  });
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
  const aberturaConsultada = useQuery({
    queryKey: chaveApontamentos(empresaId, atividadeId),
    queryFn: () => listarApontamentos(/** @type {string} */ (atividadeId)),
    enabled: Boolean(empresaId && atividadeId && passo === "iniciado" && !aberturaSalva),
    staleTime: 15 * 1000,
    select: (resposta) => aberturaDosApontamentos(itensDaLista(resposta)),
  });
  const abertura = aberturaSalva ?? (aberturaConsultada.isSuccess ? aberturaConsultada.data : null);
  const semAbertura = passo === "iniciado" && !abertura && (Boolean(aberturaSalva) || aberturaConsultada.isSuccess);

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
    setPasso("tipo");
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

  /** "Iniciar serviço": valida, grava (um envio só) e, com a atividade de volta, vai ao cabeçalho. */
  const iniciarServico = async () => {
    if (enviandoRef.current || !podeGravar || semOperacao) return;
    const novosErros = validarAbertura({ operacaoId, pedirOperacao, bemId, horimetro, responsavelId });
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
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const resposta = await registrarCampo(
        {
          area_id: String(area.id),
          tipo_atividade_id: operacaoId,
          data_operacional: hoje,
          observacao: marcadorDaAbertura(abertura),
          operador_usuario_id: responsavelId,
        },
        { escopo },
      );
      const id = resposta?.atividade?.id ?? resposta?.apontamento?.atividade_id;
      if (id == null || id === "") {
        notifyWarning("Atenção", "O servidor não devolveu o serviço. Confira o Histórico da área antes de tentar de novo.");
        onGravou?.(resposta);
        return;
      }
      const detalhe = await obterAtividade(String(id)).catch(() => null);
      setAtividadeAtual(detalhe ?? resposta?.atividade ?? { id });
      setAberturaSalva(abertura);
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
  const tituloTexto = passo === "iniciado" ? "Diário das atividades" : passo === "abrir" ? `Nova atividade de ${rotuloTipo}` : "Nova atividade";
  const subTitulo = passo === "iniciado" ? [rotuloTipo, "Hoje", diaCurto(hoje)].filter(Boolean).join(" · ") : subDaArea;
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
    </form>
  );

  /** Passo 3 (tela 03): o cabeçalho do serviço aberto. As próximas ações ficam para as próximas etapas. */
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
      {semAbertura ? <p className="b1-realizacao__ajuda">Abertura não registrada neste serviço.</p> : null}
      <p className="b1-aberto-breve" data-testid="abertura-em-breve">
        Encher implemento, Trocar pasto, Trocar implemento, Mais e Encerrar o dia chegam nas próximas etapas.
      </p>
    </div>
  );

  const semOperacaoAviso = semOperacao ? (
    <AvisoGestao testId="abertura-sem-operacao">Não há operação cadastrada para este tipo. Cadastre em Tipos de Atividade.</AvisoGestao>
  ) : null;

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
          disabled={!podeGravar || semOperacao || enviando}
          data-testid="abertura-iniciar"
        >
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {enviando ? "Iniciando…" : "Iniciar serviço"}
        </button>
      </>
    ) : (
      <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} data-testid="abertura-fechar">
        Fechar
      </button>
    );

  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!enviando}
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
        {passo === "tipo" ? cartoes : null}
        {passo === "abrir" ? (
          <>
            {semOperacaoAviso}
            {formulario}
          </>
        ) : null}
        {passo === "iniciado" ? iniciado : null}
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}
