import React from "react";
import { useQuery } from "@tanstack/react-query";
import { History, LayoutGrid } from "lucide-react";
import HistoricoAbateCurral from "./HistoricoAbateCurral";
import HistoricoMovimentacoes from "../lotes/HistoricoMovimentacoes";
import { LancLoteDialogo } from "../lotes/LancamentoLoteUi";
import { ehCurral, podeMedirForragemNaArea, podeVerHistoricoDaArea } from "@/domain/mapa/cliqueArea";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { QUERY_ATIVIDADES_DA_AREA } from "@/lib/registroDeCampoRegras";
import { definirFazendaDaTela, listarTiposAtividade } from "@/services/lancamentoAtividadesService";
import JanelaRegistroDeCampo from "../lancamento-atividades/RegistroDeCampo";
import CascaDetalhe from "./detalhes-lote/CascaDetalhe";
import AbaDetalhesDaArea from "./detalhes-area/AbaDetalhesDaArea";
import AbaRegistrosDaArea from "./detalhes-area/AbaRegistrosDaArea";
import { Abas, RodapePilulas, idsDaAba } from "./detalhes-lote/blocos";

/**
 * Detalhes da área no Mapa Geral (D-PROD-94a, D-PROD-220, D-PROD-254), no desenho do Detalhes do Lote: cabeçalho com o
 * nome da área e o setor, abas, corpo que rola e rodapé de pílulas; no celular, a folha de tela cheia do diálogo.
 *
 * - Detalhes: o cartão da área, as atividades em andamento e os custos do mês (números do servidor) e, com a chave
 *   `medir_forragem` (D-PROD-219, fora da infraestrutura), o painel de Forragem — a "Medição de Forragem" continua aqui.
 * - Histórico: os REGISTROS de campo da área (Gradeação, Aplicação…), com o filtro "Todos".
 * - Curral: a aba Abate de antes (`HistoricoAbateCurral`), à parte: são fatos de natureza diferente.
 * - Rodapé: "Manejos" (com a permissão de lançar atividades) abre DIRETO o formulário "Registrar serviço" — o mesmo do
 *   Lançamento de Atividades (D-PROD-258), com a área já preenchida: a pessoa escolhe o tipo, depois a operação.
 *   "Histórico completo" (com a permissão de histórico de
 *   movimentação) continua sendo o Histórico de Movimentação de hoje, com o "Excluir movimentação" do administrador
 *   (D-PROD-110), num diálogo por cima.
 *
 * @param {{ area: any, permissions?: Record<string, any>, setorNome?: string, eventosSuplementacao?: any[] | null, areas?: Array<{ id?: string, nome?: string }>, ocupada?: boolean | null }} props
 *   `eventosSuplementacao` e `areas` seguem na assinatura por compatibilidade (o histórico completo lê o servidor).
 */
export default function DetalhesArea({ area, permissions, setorNome = "", ocupada = null }) {
  const curral = ehCurral(area);
  const historicoDaArea = podeVerHistoricoDaArea(permissions);
  const forragem = podeMedirForragemNaArea(permissions, area);
  const acoes = useAcoesTelaAtividades();
  const empresaId = useEmpresaRealSelecionadaId();
  definirFazendaDaTela(empresaId);
  const verAtividades = acoes.ver === true;
  const podeRegistrar = acoes.lancarApontamento === true;

  const [aba, setAba] = React.useState("detalhes");
  const [anim, setAnim] = React.useState(/** @type {"aba-dir" | "aba-esq" | "empurrar" | "voltar" | null} */ (null));
  const [completoAberto, setCompletoAberto] = React.useState(false);
  const [registrando, setRegistrando] = React.useState(false);

  // Os tipos reais da fazenda (o cadastro), para os quadros de Manejos e para o filtro do Histórico.
  const tiposQuery = useQuery({
    queryKey: [QUERY_ATIVIDADES_DA_AREA, "tipos"],
    queryFn: () => listarTiposAtividade(),
    enabled: verAtividades && !!area?.id,
    staleTime: 30 * 1000,
  });
  const tipos = React.useMemo(
    () => /** @type {any[]} */ (Array.isArray(tiposQuery.data) ? tiposQuery.data : []).filter((t) => t && t.ativo !== false),
    [tiposQuery.data],
  );

  if (!area?.id) return null;

  const abas = [
    { id: "detalhes", rotulo: "Detalhes" },
    ...(verAtividades ? [{ id: "historico", rotulo: "Histórico" }] : []),
    ...(curral ? [{ id: "abate", rotulo: "Abate" }] : []),
  ];
  const abaAtual = abas.some((a) => a.id === aba) ? aba : "detalhes";
  const ordem = abas.map((a) => a.id);
  /** @param {string} nova */
  const irAba = (nova) => {
    if (nova === abaAtual) return;
    setAnim(ordem.indexOf(nova) > ordem.indexOf(abaAtual) ? "aba-dir" : "aba-esq");
    setAba(nova);
  };

  const abrirManejos = () => setRegistrando(true);

  /** @type {import("./detalhes-lote/blocos").Pilula[]} */
  const pilulas = [];
  if (podeRegistrar) pilulas.push({ chave: "manejos", rotulo: "Manejos", icone: LayoutGrid, onClick: abrirManejos });
  if (historicoDaArea) {
    pilulas.push({
      chave: "completo",
      rotulo: "Histórico completo",
      icone: History,
      onClick: () => setCompletoAberto(true),
      title: area.nome ? `Histórico completo da área: ${area.nome}` : "Histórico completo da área",
    });
  }
  const rodape = pilulas.length ? <RodapePilulas itens={pilulas} rotulo="Ações da área" /> : null;

  // Histórico completo da área (movimentação de animais, com o "Excluir movimentação" do administrador), por cima.
  const completo = historicoDaArea ? (
    <LancLoteDialogo open={completoAberto} onOpenChange={setCompletoAberto} titulo="Histórico da Área" largo somenteLeitura>
      {/* Sem condição: fechado, o Radix não monta o conteúdo (nem consulta). */}
      <HistoricoMovimentacoes lotes={[]} areaId={area.id} />
    </LancLoteDialogo>
  ) : null;

  const janela = registrando ? (
    <JanelaRegistroDeCampo tipos={tipos} area={area} onFechar={() => setRegistrando(false)} />
  ) : null;

  const idBase = `area-${area.id}`;
  const ids = idsDaAba(idBase, abaAtual);
  let corpo;
  if (abaAtual === "historico") corpo = <AbaRegistrosDaArea area={area} tipos={tipos} />;
  else if (abaAtual === "abate") corpo = <HistoricoAbateCurral areaId={area.id} />;
  else corpo = <AbaDetalhesDaArea area={area} setorNome={setorNome} ocupada={ocupada} verAtividades={verAtividades} forragem={forragem} />;

  return (
    <>
      <CascaDetalhe
        titulo={area.nome || "Detalhes da Área"}
        sub={setorNome}
        chaveTela={`aba:${abaAtual}`}
        anim={anim}
        rodape={rodape}
        cabecalhoDoCorpo={abas.length > 1 ? <Abas abas={abas} ativa={abaAtual} onMudar={irAba} idBase={idBase} rotulo="Seções da área" /> : null}
        propsDoCorpo={abas.length > 1 ? { role: "tabpanel", id: ids.painel, "aria-labelledby": ids.aba } : undefined}
      >
        {corpo}
      </CascaDetalhe>
      {janela}
      {completo}
    </>
  );
}
