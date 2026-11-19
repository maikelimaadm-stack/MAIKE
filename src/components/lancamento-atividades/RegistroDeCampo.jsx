import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, Loader2 } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import {
  AvisoEnvioDaLinha,
  CamposDaLinhaMaoObra,
  CamposDaLinhaMaquina,
  CamposDaLinhaProduto,
  CamposDaLinhaServico,
  SecoesDoFormularioContext,
  useEnvioDaLinha,
  useMedidorDaLinha,
  useSaldoDoProduto,
} from "@/components/lancamento-atividades/JanelasDaLinha";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import { tiposRegistraveisNaArea } from "@/lib/atividadeFluxoCampo";
import { iconeDoTipoAtividade } from "@/lib/iconesTipoAtividade";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { LIMITES_DECIMAL_ATIVIDADE, LOCALE_ATIVIDADE, MAX_OBSERVACAO_ATIVIDADE, STATUS_ABERTA, mensagemDoAlertaAtividade, rotuloDoUsuario } from "@/lib/lancamentoAtividadesRegras";
import { RAIZ_CONSULTAS_ATIVIDADES, corpoDoApontamento, formularioApontamentoVazio, normalizarPaginaDeOpcoes, validarFormularioApontamento } from "@/lib/atividadeApontamentoRegras";
import {
  campoDaLinhaRecusada,
  corpoDaLinhaMaoObra,
  corpoDaLinhaMaquina,
  corpoDaLinhaProduto,
  corpoDaLinhaServico,
  formularioMaoObraVazio,
  formularioMaquinaVazio,
  formularioProdutoVazio,
  formularioServicoVazio,
  mensagemDeErroLinha,
  passaDoTeto,
  usoDaLinha,
  validarLinhaMaoObra,
  validarLinhaMaquina,
  validarLinhaProduto,
  validarLinhaServico,
} from "@/lib/atividadeLinhasRegras";
import { QUERY_ATIVIDADES_DA_AREA, rotuloDoMesCurto } from "@/lib/registroDeCampoRegras";
import { STATUS_AREA } from "@/lib/atividadeAreasRegras";
import { definirFazendaDaTela, listarOpcoesOperadores, obterResumoDaArea, registrarCampo } from "@/services/lancamentoAtividadesService";
import { CODIGO_ENVIO_PENDENTE, codigoDoServidor, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

/**
 * D-PROD-254 — o formulário ÚNICO de registrar trabalho de campo, o mesmo nos detalhes da área (Mapa Geral: área presa)
 * e no "Registrar" do Lançamento de Atividades (a pessoa escolhe a área e o tipo). Uma janela Base1 de um nível só
 * (680px no desktop; `b1-janela--tela-cheia` no celular), em grupos (`SecaoForm` + `mg-b1-form-grid`).
 *
 * Os campos vêm das flags do TIPO de atividade e são os MESMOS dos formulários de linha (`JanelasDaLinha`: máquina com
 * implemento e medidor, produto com saldo e dose/ha, mão de obra, serviço): nenhuma regra de negócio é copiada. Máquina
 * aparece quando o tipo exige máquina ou permite implemento; produto, mão de obra e serviço, pelas flags `permite_*`.
 * Hectares feitos, operador e observação são do dia.
 *
 * Um envio só (`POST /atividades/registrar`, via `registrarCampo`): o servidor acha a atividade ABERTA do tipo que já tem a
 * área no mês — ou abre uma — e grava o registro do dia com as linhas numa transação. O cliente nunca encadeia chamadas.
 *
 * @param {{
 *   tipo?: any | null,
 *   tipos?: any[],
 *   area?: any | null,
 *   areas?: any[],
 *   onFechar: () => void,
 *   onGravou?: (resposta: any) => void,
 * }} props `tipo` / `area` presos (detalhes da área); sem eles, a pessoa escolhe entre `tipos` / `areas`.
 */
export default function JanelaRegistroDeCampo({ tipo: tipoPreso = null, tipos: todosOsTipos = [], area: areaPreso = null, areas = [], onFechar, onGravou = undefined }) {
  const queryClient = useQueryClient();
  // Abastecimento é da máquina (emenda 1): nunca é tipo de registro de campo.
  const tipos = useMemo(() => tiposRegistraveisNaArea(todosOsTipos), [todosOsTipos]);
  const empresaId = useEmpresaRealSelecionadaId();
  // O service injeta a fazenda (a tela de Atividades faz o mesmo; no mapa é aqui).
  definirFazendaDaTela(empresaId);
  const acoes = useAcoesTelaAtividades();
  const { fuso, hoje } = useFusoDaFazenda(empresaId);
  const { clienteId } = useAuth();
  const celular = useCelular();
  const escopo = `${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`;

  // ─── Tipo e área (presos ou escolhidos) ──────────────────────────────
  const [tipoEscolhido, setTipoEscolhido] = useState("");
  const [areaEscolhida, setAreaEscolhida] = useState("");
  const tipo = tipoPreso ?? tipos.find((t) => String(t.id) === tipoEscolhido) ?? null;
  const area = areaPreso ?? areas.find((a) => String(a.id) === areaEscolhida) ?? null;
  const flags = {
    exigeMaquina: tipo?.exige_maquina === true,
    exigeSafra: tipo?.exige_safra === true,
    permiteImplemento: tipo?.permite_implemento === true,
    permiteProduto: tipo?.permite_produto === true,
    permiteMaoObra: tipo?.permite_mao_obra === true,
    permiteServico: tipo?.permite_servico === true,
  };
  const comMaquina = flags.exigeMaquina || flags.permiteImplemento;

  // ─── O dia: hoje na fazenda por padrão, nunca depois ──────────────────
  const [dia, setDia] = useState(hoje || "");
  const diaMexido = useRef(false);
  useEffect(() => {
    if (!diaMexido.current && hoje) setDia(hoje);
  }, [hoje]);

  // ─── Formulários das linhas e do dia ──────────────────────────────────
  const [formMaquina, setFormMaquina] = useState(() => formularioMaquinaVazio());
  const [formProduto, setFormProduto] = useState(() => formularioProdutoVazio());
  const [formMaoObra, setFormMaoObra] = useState(() => formularioMaoObraVazio());
  const [formServico, setFormServico] = useState(() => formularioServicoVazio());
  const [hectares, setHectares] = useState("");
  const [operador, setOperador] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [observacao, setObservacao] = useState("");
  const [safra, setSafra] = useState("");
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [saltoPedido, setSaltoPedido] = useState(false);
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));
  const fecharDepois = useRef(true);
  const [chaveForm, setChaveForm] = useState(0);

  const medidorDaLinha = useMedidorDaLinha(empresaId, formMaquina, setFormMaquina, dia || null, false);
  const { medidor } = medidorDaLinha;
  const saldo = useSaldoDoProduto(empresaId, formProduto, setFormProduto, null);
  const uso = medidor ? usoDaLinha(formMaquina, medidor) : null;
  const pedeJustificativa = saltoPedido || passaDoTeto(uso, medidor?.teto ?? null);

  /** @param {(f: (a: any) => any) => void} set */
  const mudarLinha = (set) => (/** @type {Record<string, any>} */ mudanca, /** @type {string[]} */ campos) => {
    set((f) => ({ ...f, ...mudanca }));
    limparErros(campos);
    if (campos.includes("bem")) setSaltoPedido(false);
    esquecerUltimo();
    setEstado((e) => (e.fase === "erro" ? { fase: "pronto" } : e));
  };
  /** @param {string[]} campos */
  const limparErros = (campos) => setErros((e) => (campos.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !campos.includes(k))) : e));

  // ─── Onde o registro entra (só leitura: quem decide é o servidor) ─────
  const resumo = useQuery({
    queryKey: [QUERY_ATIVIDADES_DA_AREA, "resumo", empresaId, area?.id ?? null],
    queryFn: () => obterResumoDaArea(String(area.id)),
    enabled: Boolean(empresaId && area?.id && acoes?.ver),
    staleTime: 15 * 1000,
  });
  const destino = useMemo(() => {
    if (!tipo?.id || !area?.id || !dia || !resumo.isSuccess) return null;
    const mes = dia.slice(0, 7);
    const abertas = (resumo.data?.atividades ?? []).filter(
      (a) => String(a.tipo_atividade_id) === String(tipo.id) && a.status === STATUS_ABERTA && a.area_status !== STATUS_AREA.CONCLUIDA && String(a.data_inicio ?? "").slice(0, 7) === mes,
    );
    if (abertas.length === 1) return `Entra em ${abertas[0].nome}`;
    if (abertas.length > 1) return `Entra em uma das atividades de ${tipo.nome_tipo} abertas nesta área`;
    return `Nova atividade será criada: ${tipo.nome_tipo} · ${area.nome} · ${rotuloDoMesCurto(dia)}`;
  }, [tipo, area, dia, resumo.isSuccess, resumo.data]);

  // ─── Envio ───────────────────────────────────────────────────────────
  const { estado, setEstado, disparar, esquecerUltimo } = useEnvioDaLinha(
    (/** @type {Record<string, any>} */ corpo, /** @type {{ retentativa: boolean }} */ o) => registrarCampo(corpo, { escopo, retentativa: o.retentativa }),
    (e) => mensagemDeErroLinha(e, "Não foi possível registrar. Nada foi gravado.", { medidorUnidade: medidor?.unidade ?? null }),
  );
  const enviando = estado.fase === "enviando";

  const temMaquina = comMaquina && Boolean(formMaquina.bem?.id);
  const temProduto = flags.permiteProduto && Boolean(formProduto.produto?.id);
  const temMaoObra = flags.permiteMaoObra && Boolean(formMaoObra.parceiro?.id);
  const temServico = flags.permiteServico && Boolean(formServico.servico?.id);

  /** Valida tudo e devolve o corpo do envio (ou null, com os erros nos campos). */
  const montarCorpo = () => {
    /** @type {Record<string, string>} */
    const e = {};
    if (!tipo?.id) e.tipo = "Escolha o tipo de atividade.";
    if (!area?.id) e.area = "Escolha a área.";
    const doDia = { ...formularioApontamentoVazio(dia), operador, area_executada_dia: hectares, observacao };
    const vDia = validarFormularioApontamento(doDia, { hoje });
    Object.assign(e, vDia);
    if (flags.exigeSafra && !safra.trim()) e.safra = "Informe a safra / ciclo (o tipo exige).";
    if (flags.exigeMaquina && !temMaquina) e.bem = "Escolha a máquina.";
    if (temMaquina) {
      if (!medidor) e.bem = "Aguarde a leitura do medidor da máquina.";
      else Object.assign(e, validarLinhaMaquina(formMaquina, { medidor, permiteImplemento: flags.permiteImplemento, pedeJustificativa }));
    }
    if (temProduto) {
      const v = validarLinhaProduto(formProduto, { disponivel: saldo.disponivel });
      Object.assign(e, v.erros);
    }
    if (temMaoObra) Object.assign(e, validarLinhaMaoObra(formMaoObra));
    if (temServico) Object.assign(e, validarLinhaServico(formServico));
    setErros(e);
    if (Object.keys(e).length) return null;
    const apontamento = Object.fromEntries(
      Object.entries(corpoDoApontamento(doDia)).filter(([k, v]) => k !== "atividade_area_id" && k !== "turno" && v !== null && v !== ""),
    );
    return {
      ...apontamento,
      area_id: String(area.id),
      tipo_atividade_id: String(tipo.id),
      ...(flags.exigeSafra ? { safra_ciclo: safra.trim() } : {}),
      ...(temMaquina && medidor ? { maquinas: [corpoDaLinhaMaquina(formMaquina, medidor, { comJustificativa: pedeJustificativa })] } : {}),
      ...(temProduto ? { produtos: [corpoDaLinhaProduto(formProduto)] } : {}),
      ...(temMaoObra ? { mao_obra: [corpoDaLinhaMaoObra(formMaoObra)] } : {}),
      ...(temServico ? { servicos: [corpoDaLinhaServico(formServico)] } : {}),
    };
  };

  const limparFormulario = () => {
    setFormMaquina(formularioMaquinaVazio());
    setFormProduto(formularioProdutoVazio());
    setFormMaoObra(formularioMaoObraVazio());
    setFormServico(formularioServicoVazio());
    setHectares("");
    setOperador(null);
    setObservacao("");
    setSaltoPedido(false);
    setErros({});
    setChaveForm((k) => k + 1);
  };

  const salvar = async (/** @type {boolean} */ fechar) => {
    if (enviando) return;
    fecharDepois.current = fechar;
    const corpo = montarCorpo();
    if (!corpo) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    const r = await disparar(corpo);
    if (!r) return;
    if (r.ok) {
      const resposta = r.resposta;
      queryClient.invalidateQueries({ queryKey: [RAIZ_CONSULTAS_ATIVIDADES] });
      queryClient.invalidateQueries({ queryKey: [QUERY_ATIVIDADES_DA_AREA] });
      notifySuccess("Sucesso", `${tipo.nome_tipo} registrada em ${area.nome}.`);
      const alerta = Array.isArray(resposta?.alertas) ? resposta.alertas[0] : null;
      if (alerta) notifyWarning("Atenção", mensagemDoAlertaAtividade(alerta));
      onGravou?.(resposta);
      if (fecharDepois.current) onFechar();
      else limparFormulario();
      return;
    }
    const erro = r.erro;
    const campo = campoDaLinhaRecusada(erro);
    const mensagem = mensagemDeErroLinha(erro, "Não foi possível registrar. Nada foi gravado.", { medidorUnidade: medidor?.unidade ?? null });
    if (campo) setErros((e) => ({ ...e, [campo]: mensagem }));
    if (codigoDoServidor(erro) === "ESTOQUE_SALDO_INSUFICIENTE") saldo.consulta.refetch();
    if (!ehResultadoIncerto(erro) && /** @type {any} */ (erro)?.code !== CODIGO_ENVIO_PENDENTE) notifyWarning("Atenção", mensagem);
  };

  /** "Consultar" depois de um envio sem resposta: o Histórico da área mostra se o registro entrou. */
  const consultar = () => {
    queryClient.invalidateQueries({ queryKey: [RAIZ_CONSULTAS_ATIVIDADES] });
    queryClient.invalidateQueries({ queryKey: [QUERY_ATIVIDADES_DA_AREA] });
    setEstado((e) => ({ ...e, consulta: "Confira o Histórico da área: se o registro não aparecer, repita o mesmo envio — ele não será duplicado." }));
  };

  // ─── Corpo ───────────────────────────────────────────────────────────
  const Icone = iconeDoTipoAtividade(tipo);
  const titulo = tipo ? (
    <span className="b1-tipo-titulo">
      <span className="b1-tipo-titulo__icone" aria-hidden>
        <Icone size={16} strokeWidth={1.75} />
      </span>
      {tipo.nome_tipo}
    </span>
  ) : (
    "Registrar serviço"
  );
  const podeGravar = acoes?.lancarApontamento === true && Boolean(empresaId) && Boolean(fuso);
  const avisoStatus = !acoes?.carregando && acoes?.lancarApontamento !== true
    ? "Sem permissão para registrar atividades."
    : empresaId && !fuso
      ? "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de registrar: o servidor recusa sem ele."
      : null;
  const rotuloArea = (/** @type {any} */ a) => [a?.nome, a?.tamanho_hectares ? `${Number(a.tamanho_hectares).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha` : ""].filter(Boolean).join(" · ");

  const form = (
    <form
      key={chaveForm}
      id="formulario-registro-de-campo"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar(true);
      }}
      className="b1 mg-b1-form-grid b1-form-embutido"
      data-densidade={DENSIDADE_BASE1}
      noValidate
      data-testid="registro-de-campo-form"
    >
      <SecoesDoFormularioContext.Provider value={{ topo: null }}>
        <SecaoForm titulo="Registro" />
        {areaPreso ? (
          <CampoTexto label="Área" value={rotuloArea(areaPreso)} onChange={() => {}} readOnly span={12} />
        ) : (
          <CampoSelect
            label="Área"
            value={areaEscolhida}
            onChange={(v) => {
              setAreaEscolhida(v);
              esquecerUltimo();
              limparErros(["area"]);
            }}
            options={areas.map((a) => ({ value: String(a.id), label: rotuloArea(a) }))}
            placeholder="Escolha a área"
            required
            span={12}
            error={erros.area}
          />
        )}
        {tipoPreso ? null : (
          <CampoSelect
            label="Tipo de atividade"
            value={tipoEscolhido}
            onChange={(v) => {
              setTipoEscolhido(v);
              esquecerUltimo();
              limparErros(["tipo"]);
            }}
            options={tipos.map((t) => ({ value: String(t.id), label: t.nome_tipo }))}
            placeholder="Escolha o tipo"
            required
            span={12}
            error={erros.tipo}
          />
        )}
        <CampoDia
          label="Data"
          value={dia}
          onChange={(v) => {
            if (!v || (hoje && v > hoje)) return;
            diaMexido.current = true;
            setDia(v);
            esquecerUltimo();
            limparErros(["data_operacional"]);
          }}
          max={hoje || undefined}
          required
          span={6}
          error={erros.data_operacional}
          testId="registro-de-campo-data"
        />
        {flags.exigeSafra ? (
          <CampoTexto label="Safra / ciclo" value={safra} onChange={(v) => { setSafra(v); esquecerUltimo(); limparErros(["safra"]); }} required span={6} maxLength={32} keepCase error={erros.safra} />
        ) : null}
        {destino ? (
          <p className="col-span-12 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="registro-de-campo-destino">
            {destino}
          </p>
        ) : null}

        {tipo && comMaquina ? (
          <CamposDaLinhaMaquina
            form={formMaquina}
            mudar={mudarLinha(setFormMaquina)}
            erros={erros}
            medidorDaLinha={medidorDaLinha}
            permiteImplemento={flags.permiteImplemento}
            pedeJustificativa={pedeJustificativa}
            bloqueado={enviando}
            prefixo="registro-maquina"
            comObservacao={false}
            tituloGrupo="Máquina"
          />
        ) : null}
        {tipo && flags.permiteProduto ? (
          <CamposDaLinhaProduto
            form={formProduto}
            mudar={mudarLinha(setFormProduto)}
            erros={erros}
            aviso={validarLinhaProduto(formProduto, { disponivel: saldo.disponivel }).aviso}
            saldo={saldo}
            atividadeId=""
            areaDoDia={hectaresDaDose(hectares, area)}
            bloqueado={enviando}
            prefixo="registro-produto"
            comObservacao={false}
            tituloGrupo="Produtos"
          />
        ) : null}
        {tipo && flags.permiteMaoObra ? (
          <CamposDaLinhaMaoObra form={formMaoObra} mudar={mudarLinha(setFormMaoObra)} erros={erros} bloqueado={enviando} prefixo="registro-mao-obra" comObservacao={false} tituloGrupo="Mão de obra" />
        ) : null}
        {tipo && flags.permiteServico ? (
          <CamposDaLinhaServico form={formServico} mudar={mudarLinha(setFormServico)} erros={erros} bloqueado={enviando} prefixo="registro-servico" comObservacao={false} tituloGrupo="Serviço" />
        ) : null}

        {tipo ? (
          <>
            <SecaoForm titulo="Resultado" />
            <CampoNumero
              label="Hectares feitos"
              value={hectares}
              onChange={(v) => {
                setHectares(v);
                esquecerUltimo();
                limparErros(["area_executada_dia"]);
              }}
              locale={LOCALE_ATIVIDADE}
              limites={LIMITES_DECIMAL_ATIVIDADE}
              readOnly={enviando}
              span={6}
              error={erros.area_executada_dia}
              testId="registro-de-campo-hectares"
            />
            <SeletorPaginadoGestao
              rotulo="Operador"
              testId="registro-de-campo-operador"
              chave={[RAIZ_CONSULTAS_ATIVIDADES, "operadores", empresaId]}
              buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesOperadores({ q, cursor, limit }))}
              value={operador}
              onChange={(o) => {
                setOperador(o ? { id: String(o.id), rotulo: rotuloDoUsuario(o) || String(o.id) } : null);
                esquecerUltimo();
              }}
              rotuloDaOpcao={rotuloDoUsuario}
              readOnly={enviando}
              permitirLimpar
              span={6}
              maiusculas={false}
            />
            <CampoTextoLongo label="Observação" value={observacao} onChange={(v) => { setObservacao(v); esquecerUltimo(); }} readOnly={enviando} maxLength={MAX_OBSERVACAO_ATIVIDADE} />
          </>
        ) : null}
        <div className="col-span-12 min-w-0">
          <AvisoEnvioDaLinha estado={estado} produto={false} lancado="o registro PODE ter sido gravado" onRepetir={() => void salvar(true)} onConsultar={consultar} />
        </div>
      </SecoesDoFormularioContext.Provider>
    </form>
  );

  const podeEnviar = podeGravar && Boolean(tipo?.id) && Boolean(area?.id) && !enviando;
  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!enviando}
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo={titulo}
      testId="janela-registro-de-campo"
      className={celular ? "b1-janela--tela-cheia" : ""}
      contentProps={{ "data-permissao-explicita": "", "data-celular": celular ? "" : undefined, className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
      fora={<div ref={setAlvoFolha} className="contents" />}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando} data-testid="registro-de-campo-cancelar">
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => void salvar(true)} disabled={!podeEnviar} data-testid="registro-de-campo-salvar">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {enviando ? "Salvando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : "Salvar"}
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => void salvar(false)} disabled={!podeEnviar} data-testid="registro-de-campo-salvar-novo">
            <CheckCheck className="h-4 w-4" aria-hidden />
            Salvar e novo
          </button>
        </>
      }
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        {avisoStatus ? <AvisoGestao testId="registro-de-campo-aviso">{avisoStatus}</AvisoGestao> : null}
        {form}
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}

/** Hectares da dose/ha: os feitos digitados (se válidos) ou o tamanho da área. @param {string} feitos @param {any} area */
function hectaresDaDose(feitos, area) {
  const t = String(feitos ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (t && Number.isFinite(Number(t)) && Number(t) > 0) return Number(t).toFixed(4);
  const tam = Number(area?.tamanho_hectares);
  return Number.isFinite(tam) && tam > 0 ? tam.toFixed(4) : null;
}
