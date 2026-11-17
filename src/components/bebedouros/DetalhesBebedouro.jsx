import React, { useCallback, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ClipboardList,
  Droplet,
  Droplets,
  Eye,
  FlaskConical,
  History,
  Plus,
  Sparkles,
  TestTube,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { listarIconesPorTipoEntidade, listarPontosDaEmpresa } from "@/services/mapaService";
import { listarTodosLotes } from "@/services/loteManejoService";
import { useBebedouroHistorico } from "@/hooks/useBebedouroHistorico";
import { PillBtn } from "@/components/cadastro/base1/Base1Ui";
import CascaDetalhe from "@/components/mapa/detalhes-lote/CascaDetalhe";
import LinhaDoTempo from "@/components/mapa/detalhes-lote/LinhaDoTempo";
import { Aviso, Cartao, Celula, Chip, Grade, Linha, RodapePilulas, TituloBloco, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { VAZIO, rotuloDoDia } from "@/components/mapa/detalhes-lote/historicoDoPasto";
import BebedouroTimeline from "./BebedouroTimeline";
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
 * de referência são os de antes. "Lançar" e "Histórico" abrem como telas
 * empilhadas na mesma janela (‹ Voltar; no diálogo o Esc volta), com o MESMO
 * formulário e a MESMA linha do tempo de hoje (o "Excluir" do mais recente
 * continua lá).
 *
 * Ícone do cartão: o subícone configurado do bebedouro (o mesmo do mapa,
 * mostrado aqui antes do v12); sem ícone configurado, a gota do v12.
 */

const LIMITE_DO_RESUMO = 5;
const SEM_CADASTRO = "Ponto sem cadastro de bebedouro: cadastre-o no Mapa Cadastro para registrar lançamentos.";

const formatDecimal = (value, digits = 2) => Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
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

/** @param {unknown} valor */
const temTexto = (valor) => valor != null && String(valor).trim() !== "";

/**
 * Texto do cadastro, ou "—". O ponto sem cadastro chega com "-" em campos
 * vazios (montado pelo MapaGeral): também vira "—".
 * @param {unknown} valor
 */
const textoOuVazio = (valor) => (temTexto(valor) && String(valor).trim() !== "-" ? String(valor) : VAZIO);

/** @param {unknown} valor */
const numeroValido = (valor) => temTexto(valor) && Number.isFinite(Number(valor));

/** @param {unknown} valor */
const fmtMoeda = (valor) => `R$ ${formatDecimal(valor)}`;

/**
 * Quantidade ou escore como foram gravados: número em pt-BR (até 2 casas);
 * texto (registro antigo) como está.
 * @param {unknown} valor
 */
const fmtNumeroLivre = (valor) =>
  numeroValido(valor) ? Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : String(valor).trim();

/** Status do cadastro (BEBEDOURO_STATUS) → tom do chip: Ativo em dia, manutenção em atenção, o resto neutro. */
const TOM_DO_STATUS = /** @type {Record<string, "ok" | "atencao">} */ ({ Ativo: "ok", "Em manutenção": "atencao" });

/**
 * Ícone da linha do tempo por tipo de lançamento (BEBEDOURO_HISTORICO_TIPOS).
 * Limpeza e Inspeção são os do v12; os demais seguem o assunto do tipo.
 * @type {Record<string, import("lucide-react").LucideIcon>}
 */
const ICONE_DO_TIPO = {
  Limpeza: Sparkles,
  "Inspeção": Eye,
  "Tratamento da água": FlaskConical,
  "Aplicação de produto": FlaskConical,
  "Análise da água": TestTube,
  "Contaminação": TriangleAlert,
  "Manutenção": Wrench,
  Vazamento: Droplets,
  "Troca de boia": Wrench,
  "Troca de encanamento": Wrench,
  Abastecimento: Droplet,
};

/**
 * Linhas do cartão de um lançamento: a descrição sempre (o cartão nunca fica
 * vazio); o resto só quando o lançamento tem o dado. O status só aparece fora
 * do normal (Pendente, Emergencial). "Registrado por" é o `responsavel`, que o
 * lançamento grava com o usuário da sessão.
 * @param {any} item
 * @returns {Array<{ rotulo: string, valor: string }>}
 */
function linhasDoLancamento(item) {
  const linhas = [{ rotulo: "Descrição", valor: textoOuVazio(item?.descricao) }];
  if (temTexto(item?.responsavel)) linhas.push({ rotulo: "Registrado por", valor: String(item.responsavel) });
  if (temTexto(item?.status) && item.status !== "Concluído") linhas.push({ rotulo: "Status", valor: String(item.status) });
  if (numeroValido(item?.custo)) linhas.push({ rotulo: "Custo", valor: fmtMoeda(item.custo) });
  if (temTexto(item?.produto_utilizado)) linhas.push({ rotulo: "Produto", valor: String(item.produto_utilizado) });
  if (temTexto(item?.quantidade_utilizada)) linhas.push({ rotulo: "Quantidade", valor: fmtNumeroLivre(item.quantidade_utilizada) });
  if (temTexto(item?.qualidade_agua)) linhas.push({ rotulo: "Qualidade da água", valor: String(item.qualidade_agua) });
  if (temTexto(item?.escore_agua)) linhas.push({ rotulo: "Escore da água", valor: fmtNumeroLivre(item.escore_agua) });
  return linhas;
}

/**
 * Dias da linha do tempo do resumo: os lançamentos já na ordem da data do
 * lançamento (a mesma do "Último registro"), agrupados por dia ("10 NOV.
 * 2026"); sem data, no fim ("DATA NÃO INFORMADA").
 * @param {any[]} porData
 */
function diasDoHistorico(porData) {
  /** @type {Array<{ chave: string, rotulo: string, cartoes: Array<{ chave: string, Icone: import("lucide-react").LucideIcon, titulo: string, linhas: Array<{ rotulo: string, valor: string }> }> }>} */
  const dias = [];
  porData.forEach((item, i) => {
    const dia = String(item?.data_lancamento || "").split("T")[0];
    const chave = dia || "sem-data";
    let grupo = dias[dias.length - 1];
    if (!grupo || grupo.chave !== chave) {
      grupo = { chave, rotulo: rotuloDoDia(dia), cartoes: [] };
      dias.push(grupo);
    }
    grupo.cartoes.push({
      chave: String(item?.id ?? `lancamento-${i}`),
      Icone: ICONE_DO_TIPO[item?.tipo_lancamento] || ClipboardList,
      titulo: item?.tipo_lancamento || "Lançamento",
      linhas: linhasDoLancamento(item),
    });
  });
  return dias;
}

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
 * próprio cabeçalho e o "Voltar ao resumo" da barra do registro: a casca fica
 * sem o cabeçalho próprio (`semCabecalho`).
 *
 * @param {object} props
 * @param {object} props.bebedouro
 * @param {boolean} [props.podeLancar] a permissão efetiva cobre o POST do histórico
 * @param {boolean} [props.podeExcluir] a permissão efetiva cobre o DELETE do histórico
 * @param {(locked: boolean) => void} [props.onSubFlowChange] true enquanto lançamento/histórico ocupa a tela
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
  const [subView, setSubView] = useState(/** @type {'main'|'lancamento'|'historico'} */ ("main"));
  // Animação da troca de tela (corpo com nova chave): empurrar ao abrir, voltar ao sair.
  const [anim, setAnim] = useState(/** @type {"empurrar" | "voltar" | null} */ (null));
  const registroReal = Boolean(bebedouro?.id && !String(bebedouro.id).startsWith("ponto-"));
  const lancamentoDisponivel = podeLancar === true && registroReal;
  const idBase = useId();
  const ids = { resumo: `${idBase}-resumo`, ultimo: `${idBase}-ultimo`, info: `${idBase}-info`, historico: `${idBase}-historico` };

  const abrir = useCallback((/** @type {'lancamento'|'historico'} */ tela) => {
    setAnim("empurrar");
    setSubView(tela);
  }, []);
  const voltarAoResumo = useCallback(() => {
    setAnim("voltar");
    setSubView("main");
  }, []);

  React.useEffect(() => {
    onSubFlowChange?.(subView !== "main");
  }, [subView, onSubFlowChange]);

  React.useEffect(() => {
    if (subView === "lancamento" || subView === "historico") {
      onRecordToolbarChange?.(
        <PillBtn tone="gray" type="button" onClick={voltarAoResumo}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Voltar ao resumo
        </PillBtn>,
      );
      return;
    }
    onRecordToolbarChange?.(null);
  }, [subView, onRecordToolbarChange, voltarAoResumo]);

  React.useEffect(() => {
    setAnim(null);
    setSubView("main");
  }, [bebedouro?.id]);

  // Permissão revogada (revalidada no foco/minuto) com o formulário aberto: volta ao resumo.
  React.useEffect(() => {
    if (subView === "lancamento" && !lancamentoDisponivel) voltarAoResumo();
  }, [subView, lancamentoDisponivel, voltarAoResumo]);

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
  const { data: historico = [] } = useBebedouroHistorico(empresaId, registroReal ? bebedouro?.id : null);
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

  // Formulário aberto e a permissão (ou o cadastro) sumiu: o resumo já volta neste desenho; o efeito acima acerta o estado.
  const tela = subView === "lancamento" && !lancamentoDisponivel ? "main" : subView;
  const animTela = tela === subView ? anim : "voltar";

  // Os campos do formulário (`LancField`) leem "tem valor" do DOM a cada render, e o
  // Select do Radix só escreve o valor escolhido depois da montagem: sem um novo
  // render, Tipo, Status e Qualidade abriam com o rótulo por cima do valor (na tela
  // Bebedouros quem re-renderiza é a barra do registro). Um render a mais ao abrir.
  const [, releitura] = React.useReducer((/** @type {number} */ n) => n + 1, 0);
  React.useEffect(() => {
    if (tela === "lancamento") releitura();
  }, [tela]);

  if (tela === "lancamento") {
    return (
      <CascaDetalhe
        titulo="Lançamento no Bebedouro"
        sub={nome}
        onVoltar={voltarAoResumo}
        chaveTela="lancamento"
        anim={animTela}
        semCabecalho={semCabecalho}
        className="mk-dp-bebedouro"
      >
        <Cartao className="mk-dp-bebedouro__form">
          {/* O formulário é do Base1: botões, tokens e caixas dele vivem sob `.cadastro-b1` (como na tela Bebedouros). */}
          <div className="cadastro-b1">
            <FormularioLancamentoBebedouro bebedouro={bebedouro} onCancel={voltarAoResumo} onSaved={voltarAoResumo} />
          </div>
        </Cartao>
      </CascaDetalhe>
    );
  }

  if (tela === "historico") {
    return (
      <CascaDetalhe
        titulo="Histórico do bebedouro"
        sub={nome}
        onVoltar={voltarAoResumo}
        chaveTela="historico"
        anim={animTela}
        semCabecalho={semCabecalho}
        className="mk-dp-bebedouro"
      >
        <BebedouroTimeline historico={historico} podeExcluir={podeExcluir === true} />
      </CascaDetalhe>
    );
  }

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
    <CascaDetalhe
      titulo={nome || "Bebedouro"}
      sub={nome ? "Bebedouro" : ""}
      chaveTela="principal"
      anim={animTela}
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
          <Celula rotulo="Custo acumulado" valor={fmtMoeda(custoTotal)} />
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
          <Linha rotulo="Nenhum lançamento ainda." className="mk-dp-bebedouro__fraco" />
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
      {diasDoResumo.length ? (
        <LinhaDoTempo dias={diasDoResumo} rotulo="Registros do bebedouro" />
      ) : (
        <Vazio icone={History}>Nenhum registro.</Vazio>
      )}
    </CascaDetalhe>
  );
}
