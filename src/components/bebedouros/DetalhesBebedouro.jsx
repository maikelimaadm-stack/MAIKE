import React, { useCallback, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Droplet, History, Plus } from "lucide-react";
import { listarIconesPorTipoEntidade, listarPontosDaEmpresa } from "@/services/mapaService";
import { listarTodosLotes } from "@/services/loteManejoService";
import { useBebedouroHistorico } from "@/hooks/useBebedouroHistorico";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import CascaDetalhe from "@/components/mapa/detalhes-lote/CascaDetalhe";
import LinhaDoTempo from "@/components/mapa/detalhes-lote/LinhaDoTempo";
import { Aviso, Cartao, Celula, Chip, Grade, Linha, RodapePilulas, TituloBloco, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { VAZIO } from "@/components/mapa/detalhes-lote/historicoDoPasto";
import BebedouroTimeline from "./BebedouroTimeline";
import { diasDoHistorico, fmtMoeda, temTexto, textoOuVazio } from "./cartoesDoBebedouro";
import FormularioLancamentoBebedouro from "./FormularioLancamentoBebedouro";
import { ordenarHistoricoBebedouroPorData, resumoHistoricoBebedouro } from "./historicoBebedouroPorData";
import "@/styles/mk-dp-bebedouro.css";

/*
 * Detalhe do bebedouro no desenho do Detalhes do Lote v12 (D-PROD-220, tela
 * `telaBebedouro` do v12), dentro da `CascaDetalhe` — título = nome, sub
 * "Bebedouro"; no diálogo do Mapa Geral eles vão para o cabeçalho do diálogo:
 *
 *   cartão (ícone, nome, tipo · capacidade, status) → aviso de ponto sem
 *   cadastro → Resumo operacional → Último registro → Informações do
 *   bebedouro → Histórico do bebedouro (os últimos lançamentos)
 *   rodapé: Lançar · Histórico
 *
 * Só a apresentação mudou: consultas, permissões (D-PROD-137), cálculo das
 * próximas datas pela data do lançamento (`resumoHistoricoBebedouro`) e o ponto
 * de referência são os de antes.
 *
 * D-PROD-221: "Lançar" e "Histórico" abrem como os manejos do lote, num
 * `LancLoteDialogo` POR CIMA do detalhe (popup no desktop, tela cheia no
 * celular), com o bebedouro no subtítulo — o detalhe fica por baixo, sem telas
 * empilhadas:
 *   - Lançar: "Lançamento no Bebedouro", o MESMO formulário no desenho do manejo
 *     (`FormularioLancamentoBebedouro`); o ✕ fecha, o ✓ envia;
 *   - Histórico (e o "Ver tudo" do resumo): largo e só de leitura, o histórico
 *     completo nos cartões do manejo (`BebedouroTimeline`), com o "Excluir" do
 *     último lançado no sistema.
 * Na tela Bebedouros (fora do mapa) é igual: os diálogos abrem por cima da página.
 *
 * Histórico carregando ou com erro (sem cópia): o detalhe diz isso, em vez de
 * "Nenhum lançamento ainda." e custo R$ 0,00; o diálogo do Histórico também.
 *
 * Ícone do cartão: o subícone configurado do bebedouro (o mesmo do mapa,
 * mostrado aqui antes do v12); sem ícone configurado, a gota do v12.
 */

const LIMITE_DO_RESUMO = 5;
/** @type {any[]} */
const SEM_HISTORICO = [];
const SEM_CADASTRO = "Ponto sem cadastro de bebedouro: cadastre-o no Mapa Cadastro para registrar lançamentos.";

const formatDateBR = (value) => value ? new Date(`${String(value).split("T")[0]}T00:00:00`).toLocaleDateString("pt-BR") : "";
const addDaysToDate = (value, days) => {
  if (!value || !days) return VAZIO;
  const date = new Date(`${String(value).split("T")[0]}T00:00:00`);
  date.setDate(date.getDate() + Number(days));
  return date.toLocaleDateString("pt-BR");
};
const getPeriodDays = (periodicidade, personalizado) => {
  if (periodicidade === "Personalizado") return Number(personalizado || 0);
  if (periodicidade === "Semanal") return 7;
  if (periodicidade === "Quinzenal") return 15;
  if (periodicidade === "Mensal") return 30;
  return 0;
};
const normalizeText = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

/** Status do cadastro (BEBEDOURO_STATUS) → tom do chip: Ativo em dia, manutenção em atenção, o resto neutro. */
const TOM_DO_STATUS = /** @type {Record<string, "ok" | "atencao">} */ ({ Ativo: "ok", "Em manutenção": "atencao" });

/**
 * D-PROD-137 (BEB-01/BEB-03/BEB-04): "Lançar" e "Excluir" seguem a regra do
 * servidor, calculada por quem monta o componente (`src/lib/bebedouroPermissions.js`)
 * — padrão `false`, o lado seguro: quem esquecer de passar não oferece ação
 * que o servidor recusaria. Esses botões ficam fora da heurística de texto do
 * Layout (`data-permissao-explicita`), que não sabe que o servidor aceita
 * "novo" OU "salvar". Ponto BEBEDOURO sem cadastro não lança: o histórico
 * ficaria órfão (sem `bebedouro_id`), e o servidor recusa.
 *
 * Na tela Bebedouros (quem passa `onRecordToolbarChange`) a página já tem o
 * próprio cabeçalho: a casca fica sem o cabeçalho próprio (`semCabecalho`). A
 * barra do registro fica vazia — o resumo nunca sai da tela, e os diálogos de
 * Lançar e Histórico fecham pelo próprio ✕ —, e `onSubFlowChange(true)` trava a
 * navegação entre registros enquanto um deles está aberto.
 *
 * @param {object} props
 * @param {object} props.bebedouro
 * @param {boolean} [props.podeLancar] a permissão efetiva cobre o POST do histórico
 * @param {boolean} [props.podeExcluir] a permissão efetiva cobre o DELETE do histórico
 * @param {(locked: boolean) => void} [props.onSubFlowChange] true enquanto o lançamento ou o histórico está aberto por cima
 * @param {(toolbar: import('react').ReactNode) => void} [props.onRecordToolbarChange]
 * @param {boolean} [props.semCabecalho] fora do diálogo, sem o cabeçalho da casca (padrão: quando há `onRecordToolbarChange`)
 */
export default function DetalhesBebedouro({
  bebedouro,
  podeLancar = false,
  podeExcluir = false,
  onSubFlowChange,
  onRecordToolbarChange,
  semCabecalho = typeof onRecordToolbarChange === "function",
}) {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  // Diálogo aberto por cima do detalhe (D-PROD-221): o lançamento ou o histórico completo.
  const [aberto, setAberto] = useState(/** @type {null | "lancamento" | "historico"} */ (null));
  const registroReal = Boolean(bebedouro?.id && !String(bebedouro.id).startsWith("ponto-"));
  const lancamentoDisponivel = podeLancar === true && registroReal;
  const idBase = useId();
  const ids = { resumo: `${idBase}-resumo`, ultimo: `${idBase}-ultimo`, info: `${idBase}-info`, historico: `${idBase}-historico` };

  const abrir = useCallback((/** @type {"lancamento" | "historico"} */ qual) => setAberto(qual), []);
  const fechar = useCallback(() => setAberto(null), []);

  React.useEffect(() => {
    onSubFlowChange?.(aberto !== null);
  }, [aberto, onSubFlowChange]);

  // A barra do registro (tela Bebedouros) fica vazia: nada sai da tela para precisar de "Voltar".
  React.useEffect(() => {
    onRecordToolbarChange?.(null);
  }, [onRecordToolbarChange]);

  React.useEffect(() => {
    setAberto(null);
  }, [bebedouro?.id]);

  // Permissão revogada (revalidada no foco/minuto) com o formulário aberto: o diálogo fecha.
  React.useEffect(() => {
    if (aberto === "lancamento" && !lancamentoDisponivel) setAberto(null);
  }, [aberto, lancamentoDisponivel]);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones-bebedouro-detalhe", empresaId],
    queryFn: async () => {
      const icones = await listarIconesPorTipoEntidade("Ponto");
      return icones.filter((item) => item.ativo !== false);
    },
    enabled: !!empresaId,
    staleTime: 10 * 60 * 1000
  });
  const { data: lotes = [] } = useQuery({
    queryKey: ["lotes-bebedouro-detalhe", empresaId],
    queryFn: async () => {
      const all = await listarTodosLotes();
      return all.filter((lote) => lote.empresa_id === empresaId && lote.status === "Ativo");
    },
    enabled: !!empresaId,
    staleTime: 60 * 1000
  });
  const { data: pontosReferencia = [] } = useQuery({
    queryKey: ["pontos-referencia-bebedouro-detalhe", empresaId],
    queryFn: async () => {
      const pontos = await listarPontosDaEmpresa(empresaId);
      return pontos.filter((ponto) => ponto.ativo !== false);
    },
    enabled: !!empresaId,
    staleTime: 60 * 1000
  });
  const consultaHistorico = useBebedouroHistorico(empresaId, registroReal ? bebedouro?.id : null);
  const historico = Array.isArray(consultaHistorico.data) ? consultaHistorico.data : SEM_HISTORICO;
  // O hook preenche `[]` enquanto busca (placeholder): isso não é "nenhum lançamento".
  const carregandoHistorico = registroReal && Boolean(consultaHistorico.isPlaceholderData);
  const erroHistorico = registroReal && Boolean(consultaHistorico.isError) && historico.length === 0;
  const historicoIndisponivel = carregandoHistorico || erroHistorico;
  // Resumo pela data do lançamento, não pela ordem de criação (lançamento retroativo).
  const { ultimoLancamento, ultimaLimpeza: ultimoLancamentoLimpeza, ultimaInspecao } = useMemo(() => resumoHistoricoBebedouro(historico), [historico]);
  // A linha do tempo do resumo usa a mesma ordem; a completa (Histórico) fica na do servidor (o "Excluir" vale para o mais recente por criação).
  const historicoPorData = useMemo(() => ordenarHistoricoBebedouroPorData(historico), [historico]);
  const diasDoResumo = useMemo(() => diasDoHistorico(historicoPorData.slice(0, LIMITE_DO_RESUMO)), [historicoPorData]);
  const custoTotal = historico.reduce((sum, item) => sum + Number(item.custo || 0), 0);
  const iconePonto = useMemo(() => {
    const tipoBebedouro = normalizeText(bebedouro?.tipo || "");
    const nomeBebedouro = normalizeText(bebedouro?.nome || "");
    return iconesConfig.find((item) => {
      const categoriaIcone = normalizeText(item.categoria || "");
      if (categoriaIcone === "BEBEDOURO") return true;
      if (categoriaIcone && tipoBebedouro.includes(categoriaIcone)) return true;
      if (categoriaIcone && nomeBebedouro.includes(categoriaIcone)) return true;
      return false;
    });
  }, [iconesConfig, bebedouro?.tipo, bebedouro?.nome]);
  const subIconePonto = bebedouro?.sub_icone_url || bebedouro?.icone_url || iconePonto?.sub_icone_url || iconePonto?.icone_url || "";
  const pontoReferencia = pontosReferencia.find((ponto) => {
    const codigo = normalizeText(bebedouro?.codigo_interno);
    const nome = normalizeText(bebedouro?.nome);
    return ponto.id === bebedouro?.ponto_referencia_id ||
      (nome && normalizeText(ponto.nome) === nome) ||
      (codigo && normalizeText(ponto.sigla) === codigo) ||
      (codigo && normalizeText(ponto.numero_ponto) === codigo);
  });
  const numeroBebedouro = pontoReferencia?.numero_ponto || bebedouro?.numero_ponto || bebedouro?.codigo_interno || "";
  const areaIdsBebedouro = Array.isArray(bebedouro.area_vinculada_ids) && bebedouro.area_vinculada_ids.length ? bebedouro.area_vinculada_ids : bebedouro.pasto_id ? [bebedouro.pasto_id] : [];
  const nomesPastos = Array.isArray(bebedouro.area_vinculada_nomes) && bebedouro.area_vinculada_nomes.length ? bebedouro.area_vinculada_nomes : bebedouro.pasto_nome ? [bebedouro.pasto_nome] : [];
  const lotesAtendidos = lotes.filter((lote) => areaIdsBebedouro.includes(lote.area_atual_id));
  const totalAnimaisAgua = lotesAtendidos.reduce((total, lote) => total + Number(lote.quantidade_cabecas || 0), 0);
  const diasLimpeza = getPeriodDays(bebedouro.periodicidade_limpeza, bebedouro.dias_limpeza_personalizado);
  const diasInspecao = getPeriodDays(bebedouro.periodicidade_inspecao, bebedouro.dias_inspecao_personalizado);
  const proximaLimpeza = addDaysToDate(ultimoLancamentoLimpeza?.data_lancamento, diasLimpeza);
  const proximaInspecao = addDaysToDate(ultimaInspecao?.data_lancamento || ultimaInspecao?.data_avaliacao, diasInspecao);

  const nome = String(bebedouro?.nome ?? "").trim();
  const capacidade = bebedouro.capacidade_litros ? `${Number(bebedouro.capacidade_litros).toLocaleString("pt-BR")} L` : "";
  const status = temTexto(bebedouro.status) ? String(bebedouro.status) : "";
  const rotinaLimpeza = bebedouro.dias_limpeza_personalizado ? `${bebedouro.dias_limpeza_personalizado} dia(s)` : bebedouro.periodicidade_limpeza;
  const rotinaInspecao = bebedouro.dias_inspecao_personalizado ? `${bebedouro.dias_inspecao_personalizado} dia(s)` : bebedouro.periodicidade_inspecao;

  // Formulário aberto e a permissão (ou o cadastro) sumiu: o diálogo já fecha neste desenho; o efeito acima acerta o estado.
  const lancamentoAberto = aberto === "lancamento" && lancamentoDisponivel;
  const historicoAberto = aberto === "historico";
  // O bebedouro no subtítulo dos diálogos, como os lotes nos manejos do lote.
  const doBebedouro = [{ nome }];

  /** @type {Array<{ chave: string, rotulo: string, icone: import("lucide-react").LucideIcon, onClick: () => void, title: string }>} */
  const pilulas = [];
  if (lancamentoDisponivel) {
    pilulas.push({ chave: "lancar", rotulo: "Lançar", icone: Plus, onClick: () => abrir("lancamento"), title: nome ? `Lançamento no bebedouro: ${nome}` : "Lançamento no bebedouro" });
  }
  pilulas.push({ chave: "historico", rotulo: "Histórico", icone: History, onClick: () => abrir("historico"), title: nome ? `Histórico do bebedouro: ${nome}` : "Histórico do bebedouro" });

  const ultimoValor = ultimoLancamento
    ? [formatDateBR(ultimoLancamento.data_lancamento), ultimoLancamento.hora_lancamento, ultimoLancamento.responsavel].filter(temTexto).join(" · ")
    : "";

  return (
    <>
      <CascaDetalhe
        titulo={nome || "Bebedouro"}
        sub={nome ? "Bebedouro" : ""}
        semCabecalho={semCabecalho}
        className="mk-dp-bebedouro"
        rodape={
          <div className="mk-dp-bebedouro__rodape" data-permissao-explicita="">
            <RodapePilulas itens={pilulas} rotulo="Ações do bebedouro" />
          </div>
        }
      >
        <Cartao
          icone={subIconePonto ? undefined : Droplet}
          imagem={subIconePonto || undefined}
          titulo={nome || "Bebedouro"}
          sub={[bebedouro.tipo, capacidade].filter(temTexto).join(" · ") || undefined}
          chip={status ? <Chip tom={TOM_DO_STATUS[status] || "neutro"}>{status}</Chip> : null}
        />
        {!registroReal ? <Aviso role="note">{SEM_CADASTRO}</Aviso> : null}

        <TituloBloco id={ids.resumo}>Resumo operacional</TituloBloco>
        <Cartao role="group" aria-labelledby={ids.resumo}>
          <Grade>
            <Celula rotulo="Animais consumindo água" valor={totalAnimaisAgua ? `${totalAnimaisAgua.toLocaleString("pt-BR")} cab` : VAZIO} />
            <Celula rotulo="Próxima limpeza" valor={proximaLimpeza} />
            <Celula rotulo="Próxima inspeção" valor={proximaInspecao} />
            <Celula rotulo="Custo acumulado" valor={historicoIndisponivel ? VAZIO : fmtMoeda(custoTotal)} />
          </Grade>
        </Cartao>

        <TituloBloco id={ids.ultimo}>Último registro</TituloBloco>
        <Cartao role="group" aria-labelledby={ids.ultimo}>
          {ultimoLancamento ? (
            <Linha
              rotulo={ultimoLancamento.tipo_lancamento || "Lançamento"}
              sub={temTexto(ultimoLancamento.descricao) ? ultimoLancamento.descricao : undefined}
              valor={ultimoValor}
            />
          ) : (
            <Linha
              rotulo={carregandoHistorico ? "Carregando..." : erroHistorico ? "Não foi possível carregar o histórico." : "Nenhum lançamento ainda."}
              className="mk-dp-bebedouro__fraco"
            />
          )}
        </Cartao>

        <TituloBloco id={ids.info}>Informações do bebedouro</TituloBloco>
        <Cartao role="group" aria-labelledby={ids.info}>
          <Grade>
            <Celula rotulo="Número" valor={textoOuVazio(numeroBebedouro)} />
            <Celula rotulo="Tipo" valor={textoOuVazio(bebedouro.tipo)} />
            <Celula rotulo="Status" valor={textoOuVazio(status)} />
            <Celula rotulo="Capacidade" valor={textoOuVazio(capacidade)} />
            <Celula rotulo="Origem da água" valor={textoOuVazio(bebedouro.origem_agua)} />
            <Celula rotulo="Pastos atendidos" valor={textoOuVazio(nomesPastos.join(", "))} />
            <Celula rotulo="Rotina limpeza" valor={textoOuVazio(rotinaLimpeza)} />
            <Celula rotulo="Rotina inspeção" valor={textoOuVazio(rotinaInspecao)} />
          </Grade>
          <Linha rotulo="Observações" valor={textoOuVazio(bebedouro.observacoes)} quebra />
        </Cartao>

        <TituloBloco
          id={ids.historico}
          link={historico.length > LIMITE_DO_RESUMO ? "Ver tudo" : undefined}
          onLink={() => abrir("historico")}
        >
          Histórico do bebedouro
        </TituloBloco>
        {carregandoHistorico ? (
          <div role="status" className="mk-dp-hist__estado">
            Carregando histórico...
          </div>
        ) : erroHistorico ? (
          <div role="alert" className="mk-dp-hist__estado">
            Não foi possível carregar o histórico.
          </div>
        ) : diasDoResumo.length ? (
          <LinhaDoTempo dias={diasDoResumo} rotulo="Registros do bebedouro" />
        ) : (
          <Vazio icone={History}>Nenhum registro.</Vazio>
        )}
      </CascaDetalhe>

      <LancLoteDialogo open={lancamentoAberto} onOpenChange={(v) => { if (!v) fechar(); }} titulo="Lançamento no Bebedouro" lotes={doBebedouro}>
        {lancamentoAberto ? <FormularioLancamentoBebedouro bebedouro={bebedouro} onCancel={fechar} onSaved={fechar} /> : null}
      </LancLoteDialogo>

      <LancLoteDialogo open={historicoAberto} onOpenChange={(v) => { if (!v) fechar(); }} titulo="Histórico do Bebedouro" lotes={doBebedouro} largo somenteLeitura>
        <BebedouroTimeline
          historico={historico}
          podeExcluir={podeExcluir === true}
          carregando={carregandoHistorico}
          erro={erroHistorico}
          bebedouroNome={nome}
        />
      </LancLoteDialogo>
    </>
  );
}
