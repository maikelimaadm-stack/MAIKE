import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import React, { useId, useMemo, useRef, useState } from "react";
import { History, Loader2, LogOut, Truck } from "lucide-react";
import { listarTodosLotesNota, listarTodosProdutos, listarTodasMovimentacoes } from "@/services/estoqueMapaService";
import { listarPontosSuplementacaoAtivos, listarAreasAtivas } from "@/services/mapaService";
import { getMapaCachedData, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { listEmpresas } from "@/services/empresaService";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { urlIconeCocho } from "@/assets/icones/cocho-descoberto";
import FormularioTransferenciaDeposito from "./FormularioTransferenciaDeposito";
import TransferenciasAguardandoDeposito from "./deposito/TransferenciasAguardandoDeposito";
import { movimentacoesDoHistoricoDeposito } from "../suplementacao/HistoricoDepositoSuplementacao";
import CancelarTransferenciaDeposito from "./deposito/CancelarTransferenciaDeposito";
import { usePodeCancelarLancamentosEstoque } from "./deposito/usePodeCancelarLancamentosEstoque";
import DepositoNivel from "./DepositoNivel";
import CascaDetalhe from "./detalhes-lote/CascaDetalhe";
import FiltroHistorico from "./detalhes-lote/FiltroHistorico";
import { Abas, Cartao, Celula, Grade, Item, Linha, ListaItens, RodapePilulas, SecaoDetalhe, Vazio, idsDaAba } from "./detalhes-lote/blocos";
import LinhaDoTempoDeposito from "./deposito/LinhaDoTempoDeposito";
import { VAZIO, fmtNumero, rotuloDoDia } from "./detalhes-lote/historicoDoPasto";
import { formatDecimal } from "../suplementacao/formatters";
import { kgParaSacos } from "../suplementacao/unidadeConversaoUtils";
import { getDepositoIndicator } from "./pontoStatusUtils";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";
import { calcularNivelCocho, formatarKgNivel } from "@/domain/suplementacao/nivelSuplementacao";
import { descreverFarol, farolDoCocho } from "@/domain/suplementacao/leituraCocho";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { useDiaCivil } from "@/hooks/useDiaCivil";
import "@/styles/mk-dp-deposito.css";
import "@/styles/mk-dp-historico.css";
import "@/styles/mk-dp-deposito-v13.css";

const FILTROS_DEPOSITO = [
  { valor: "todos", rotulo: "Todos os registros" },
  { valor: "entradas", rotulo: "Entradas" },
  { valor: "saidas", rotulo: "Saídas" },
  { valor: "suplementacao", rotulo: "Suplementação" },
];


/**
 * Leitura do cache local do mapa (rápida), com atualização em segundo plano.
 * Usa a MESMA chave do React Query do Mapa Geral e do detalhe do cocho
 * (`['mapa-cache', chave, empresa, 'default']`): o farol e o nível de cada
 * cocho vinculado saem dos mesmos arrays do marcador e recebem as mesmas
 * invalidações (`leiturasAtualizadas`, `atualizar-mapa`).
 * @param {string} chave capacidade do `mapaCacheService`
 * @param {string|null} empresaId
 * @param {number} staleTime
 */
function useCacheDoMapa(chave, empresaId, staleTime) {
  const queryClient = useQueryClient();
  const queryKey = ["mapa-cache", chave, empresaId, "default"];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const cached = await getMapaCachedData(chave, empresaId);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry(chave, empresaId).then((fresh) => {
            if (fresh?.length) queryClient.setQueryData(queryKey, fresh);
          }).catch(() => {});
          return cached;
        }
        return (await refreshMapaCacheEntry(chave, empresaId)) || [];
      }
      return cached || [];
    },
    enabled: !!empresaId,
    staleTime,
  });
}

/**
 * Detalhe do DEPÓSITO de suplementação aberto pelo Mapa Geral, no desenho do
 * Detalhes do Lote v12 (D-PROD-220, tela `telaDeposito`): a `CascaDetalhe`
 * publica o nome do depósito e o subtítulo (área · setor do mapa; sem ele, o
 * local de estoque) no cabeçalho do diálogo, e o corpo segue a ordem do v12 —
 * nível do depósito, saldo por produto, pastos atendidos (os cochos que puxam
 * deste depósito) e informações do cadastro. D-PROD-228: movimentações só
 * aparecem no Histórico, aberto pelo rodapé, com as permissões existentes.
 *
 * Os dados e as regras não mudaram: o nível é só o SSOT (D-PROD-178,
 * `getDepositoIndicator`); produto em litros fica fora do kg (D-PROD-162,
 * P-11); a transferência e o histórico completo são os mesmos componentes,
 * em diálogos por cima (D-PROD-161 para as folhas do celular). D-PROD-222:
 * Entrada e Saída abrem como os lançamentos de manejo (`LancLoteDialogo`).
 *
 * @param {{
 *   deposito: any,
 *   onClose?: () => void,
 *   permissions?: { movimentar_depositos?: boolean, visualizar_historico_cocho?: boolean } & Record<string, any>,
 *   subtitulo?: string,
 *   onAbrirCocho?: ((cocho: any) => void) | null,
 *   anim?: "voltar" | null,
 * }} props
 *   `subtitulo`: o local do depósito no mapa ("Sede · Sede"). `onAbrirCocho`:
 *   com ele, cada cocho dos pastos atendidos abre (a tela empilhada é de quem
 *   chama); sem ele, os itens só informam. `anim`: a volta do cocho empilhado
 *   anima como o ‹ Voltar do Detalhes do Lote.
 */
export default function DetalhesDepositoSuplementacao({ deposito, onClose, permissions = {}, subtitulo = "", onAbrirCocho = null, anim = null }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const [showTransferencia, setShowTransferencia] = useState(false);
  const [transferDirection, setTransferDirection] = useState("entrada");
  // D-PROD-297: a transferência que ainda não subiu, aberta para correção.
  const [edicaoTransferencia, setEdicaoTransferencia] = useState(/** @type {any} */ (null));
  const [abaAtiva, setAbaAtiva] = useState(/** @type {"detalhes" | "informacoes" | "historico"} */ ("detalhes"));
  const [animAba, setAnimAba] = useState(/** @type {"aba-dir" | "aba-esq" | null} */ (null));
  const [filtroHistorico, setFiltroHistorico] = useState("todos");
  const idBaseAbas = `deposito-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const idTituloSaldo = useId();
  const idGrupoLitros = useId();
  const idTituloInfo = useId();
  // D-PROD-268: "Excluir transferência" só para quem passa em `podeCancelarLancamentosEstoque`.
  const { pode: podeCancelarTransferencia, escopo: escopoDoUsuario } = usePodeCancelarLancamentosEstoque();
  const handleSavedRef = useRef(/** @type {() => void} */ (() => {}));

  const { data: lotesNota = [], isLoading: loadingSaldo } = useQuery({
    queryKey: ["saldo-deposito", deposito.id],
    queryFn: async () => {
      const all = await listarTodosLotesNota();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.local_estoque_id === deposito.local_estoque_id && lote.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id,
    staleTime: 60 * 1000
  });

  const { data: produtos = [], isLoading: loadingProdutos } = useQuery({
    queryKey: ["produtos-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarTodosProdutos();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000
  });

  const { data: pontosSuplementacao = [], isLoading: loadingCochos } = useQuery({
    queryKey: ["cochos-vinculados-deposito", deposito.id],
    queryFn: async () => {
      return listarPontosSuplementacaoAtivos(empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 60 * 1000
  });

  const { data: areas = [], isLoading: loadingAreas } = useQuery({
    queryKey: ["areas-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      return listarAreasAtivas(empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000
  });

  const { data: movimentacoes = [], isLoading: loadingMovimentacoes, isError: erroMovimentacoes } = useQuery({
    queryKey: ["movimentacoes-deposito-detalhe", deposito.id],
    queryFn: async () => {
      const doLocal = (lista) =>
        (Array.isArray(lista) ? lista : []).filter(
          (item) =>
            item.empresa_id === empresaSelecionadaId &&
            (item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id),
        );
      const cached = await getMapaCachedData("movimentacaoEstoque", empresaSelecionadaId);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry("movimentacaoEstoque", empresaSelecionadaId)
            .then((fresh) => {
              if (fresh?.length) queryClient.setQueryData(["movimentacoes-deposito-detalhe", deposito.id], doLocal(fresh));
            })
            .catch(() => {});
          return doLocal(cached);
        }
        const fresh = await refreshMapaCacheEntry("movimentacaoEstoque", empresaSelecionadaId);
        if (fresh?.length) return doLocal(fresh);
      } else if (cached?.length) {
        return doLocal(cached);
      }
      const all = await listarTodasMovimentacoes();
      return doLocal(all);
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id
  });

  // Dia civil da FAZENDA (o mesmo resumo de empresas do Layout e do Mapa Geral): o
  // farol e o nível de cada cocho vinculado contam dias como o marcador do mapa.
  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listEmpresas(),
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const fuso = useMemo(() => {
    const empresa = (Array.isArray(empresas) ? empresas : []).find((e) => String(e?.id) === String(empresaSelecionadaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresas, empresaSelecionadaId]);
  const hoje = useDiaCivil(fuso);
  // D-PROD-205: leituras de cocho (o farol) e eventos (o nível do ícone), do mesmo cache do mapa.
  const { data: leituras = [] } = useCacheDoMapa("leiturasCocho", empresaSelecionadaId, 60 * 1000);
  const { data: eventos = [] } = useCacheDoMapa("eventosSuplementacao", empresaSelecionadaId, 60 * 1000);

  const cochosVinculados = useMemo(() => {
    return pontosSuplementacao.filter((ponto) => normalizeText(ponto.categoria_ponto || "COCHO") === "COCHO" && ponto.deposito_origem_id === deposito.id);
  }, [pontosSuplementacao, deposito.id]);

  // D-PROD-162 (P-11): Produto com estoque em LITROS aparece no saldo por produto com "L", sem sacos,
  // numa lista à parte, e fica fora dos indicadores em kg (saldo, necessidade, % e linha do tempo).
  // Mesmos lotes do nível (D-PROD-178): só quantidade disponível > 0; a soma das linhas em kg é o
  // "Saldo atual kg". Lote de produto fora do cadastro continua em kg, marcado "unidade não confirmada".
  const saldosAgrupados = useMemo(() => {
    const mapa = new Map();
    lotesNota.forEach((lote) => {
      const quantidade = Number(lote.quantidade_disponivel) || 0;
      if (quantidade <= 0) return;
      const produto = produtos.find((item) => item.id === lote.produto_id);
      const emLitros = produto?.unidade_principal_estoque === "L";
      const pesoPorSaco = emLitros ? 0 : Number(produto?.peso_por_saco_kg || 0);
      const current = mapa.get(lote.produto_id) || {
        produto_id: lote.produto_id,
        produto_nome: produto?.nome_produto || lote.produto_nome || "Produto sem nome",
        saldo: 0,
        saldoSacos: 0,
        unidadeConfirmada: Boolean(produto),
        ...(emLitros ? { emLitros: true } : {})
      };
      current.saldo += quantidade;
      current.saldoSacos += pesoPorSaco > 0 ? kgParaSacos(quantidade, pesoPorSaco) : 0;
      mapa.set(lote.produto_id, current);
    });
    const ordenados = Array.from(mapa.values()).sort((a, b) => a.produto_nome.localeCompare(b.produto_nome, "pt-BR"));
    return { emKg: ordenados.filter((item) => !item.emLitros), emLitros: ordenados.filter((item) => item.emLitros) };
  }, [lotesNota, produtos]);

  // Só o SSOT (D-PROD-178): o nível não depende de cochos nem de lotes de gado.
  const indicador = useMemo(() => {
    return getDepositoIndicator(deposito, [], [], lotesNota, movimentacoes, produtos);
  }, [deposito, lotesNota, movimentacoes, produtos]);

  // Nível do SSOT (D-PROD-178): o mesmo número do marcador do mapa.
  const nivel = indicador.nivel;
  const totalSaldoSacos = useMemo(() => saldosAgrupados.emKg.reduce((total, item) => total + (item.saldoSacos || 0), 0), [saldosAgrupados]);
  const totalNecessidadeSacos = useMemo(() => {
    const kg = Number(nivel.necessidadeReposicaoKg) || 0;
    if (kg <= 0) return 0;
    const prodPadrao = produtos.find(
      (p) => p.unidade_principal_estoque !== "L" && normalizeText(p.nome_produto || "") === normalizeText(deposito.produto_padrao || ""),
    );
    const pesoPadrao = Number(prodPadrao?.peso_por_saco_kg || 0);
    if (pesoPadrao > 0) return kgParaSacos(kg, pesoPadrao);
    if (totalSaldoSacos > 0 && nivel.saldoKg > 0) return kgParaSacos(kg, nivel.saldoKg / totalSaldoSacos);
    const prodKg = produtos.find((p) => p.unidade_principal_estoque !== "L" && Number(p.peso_por_saco_kg) > 0);
    const pesoKg = Number(prodKg?.peso_por_saco_kg || 0);
    return pesoKg > 0 ? kgParaSacos(kg, pesoKg) : 0;
  }, [nivel.necessidadeReposicaoKg, nivel.saldoKg, totalSaldoSacos, produtos, deposito.produto_padrao]);

  // Pastos atendidos: cada cocho que puxa deste depósito, com o subícone do cocho
  // (nível do SSOT, D-PROD-178; o desenho dos detalhes, D-PROD-225) e a bolinha do
  // farol da última leitura (D-PROD-205).
  const cochos = useMemo(() => {
    const nomesPorId = new Map(areas.map((area) => [area.id, area.nome]));
    return cochosVinculados
      .map((cocho) => {
        // Pastos atendidos: a mesma regra de hoje (ids → nomes das áreas ativas; senão os nomes gravados).
        const areaIds = Array.isArray(cocho.area_vinculada_ids) && cocho.area_vinculada_ids.length > 0
          ? cocho.area_vinculada_ids
          : cocho.area_vinculada_id ? [cocho.area_vinculada_id] : [];
        const nomesResolvidos = areaIds.map((id) => nomesPorId.get(id)).filter(Boolean);
        const pastosAtendidos = nomesResolvidos.length > 0
          ? nomesResolvidos.join(", ")
          : Array.isArray(cocho.area_vinculada_nomes) && cocho.area_vinculada_nomes.length > 0
            ? cocho.area_vinculada_nomes.join(", ")
            : cocho.area_vinculada_nome || "Sem pasto vinculado";
        const nivelCocho = calcularNivelCocho({ ponto: cocho, eventos, hoje, pontos: pontosSuplementacao });
        const farol = farolDoCocho({ leituras, pontoId: cocho.id, hoje });
        return {
          id: cocho.id,
          nome: String(cocho.nome_ponto || "Cocho"),
          meta: [pastosAtendidos, cocho.produto_padrao].filter(Boolean).join(" · "),
          fracao: nivelCocho.fracaoParaSvg,
          nivelTexto: /%$/.test(String(nivelCocho.rotuloCurto)) ? `nível ${nivelCocho.rotuloCurto}` : String(nivelCocho.rotuloCurto || ""),
          farol: { hex: farol.hex, cor: farol.cor, curto: rotuloCurtoDoFarol(farol.rotulo), texto: descreverFarol(farol) },
          ponto: cocho,
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true, sensitivity: "base" }));
  }, [cochosVinculados, areas, eventos, leituras, hoje, pontosSuplementacao]);

  // D-PROD-228: histórico somente com a mesma permissão de antes.
  const podeHistorico = permissions.visualizar_historico_cocho !== false;

  const abas = useMemo(
    () => [
      { id: "detalhes", rotulo: "Detalhes" },
      { id: "informacoes", rotulo: "Informações" },
      ...(podeHistorico ? [{ id: "historico", rotulo: "Histórico" }] : []),
    ],
    [podeHistorico],
  );
  const aba = abas.some((a) => a.id === abaAtiva) ? abaAtiva : "detalhes";
  const idsAba = idsDaAba(idBaseAbas, aba);

  /** @param {string} nova */
  const irAba = (nova) => {
    if (nova === aba) return;
    const ordem = ["detalhes", "informacoes", "historico"];
    setAnimAba(ordem.indexOf(nova) > ordem.indexOf(aba) ? "aba-dir" : "aba-esq");
    setAbaAtiva(/** @type {"detalhes" | "informacoes" | "historico"} */ (nova));
  };

  const diasDoHistorico = useMemo(() => {
    const produtosPorId = new Map(produtos.map((produto) => [produto.id, produto]));
    const cochosPorId = new Map(pontosSuplementacao.map((ponto) => [ponto.id, ponto]));
    const lista = movimentacoesDoHistoricoDeposito(movimentacoes, {
      empresaId: empresaSelecionadaId,
      localEstoqueId: deposito.local_estoque_id,
    }).filter((mov) => {
      if (filtroHistorico === "entradas") return ehEntradaNoDeposito(mov, deposito.local_estoque_id);
      if (filtroHistorico === "saidas") return !ehEntradaNoDeposito(mov, deposito.local_estoque_id) && mov?.tipo_detalhado !== "suplementacao";
      if (filtroHistorico === "suplementacao") return mov?.tipo_detalhado === "suplementacao";
      return true;
    });
    return agruparPorDia(
      lista.map((mov) =>
        cartaoDaMovimentacao(mov, {
          localEstoqueId: deposito.local_estoque_id,
          produtosPorId,
          cochosPorId,
          acaoDeCancelar: podeCancelarTransferencia
            ? (mov) => (
                <CancelarTransferenciaDeposito
                  key={`cancelar-${mov.id}`}
                  movimento={mov}
                  empresaId={empresaSelecionadaId}
                  escopo={escopoDoUsuario}
                  onCancelado={() => handleSavedRef.current()}
                />
              )
            : null,
        }),
      ),
    );
  }, [movimentacoes, produtos, pontosSuplementacao, empresaSelecionadaId, deposito.local_estoque_id, filtroHistorico, podeCancelarTransferencia, escopoDoUsuario]);

  const handleSaved = () => {
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["saldo-deposito", "cochos-vinculados-deposito", "movimentacoes-deposito-detalhe", "mapa-pontos-supl", "mapa-pontos", "pontos", "pontos-suplementacao"].includes(query.queryKey[0]) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };
  handleSavedRef.current = handleSaved;

  /** @param {"entrada" | "saida"} direcao */
  const abrirTransferencia = (direcao) => {
    setEdicaoTransferencia(null);
    setTransferDirection(direcao);
    setShowTransferencia(true);
  };

  // Mesmas permissões dos botões de hoje: sem a permissão, a pílula não aparece.
  /** @type {import("./detalhes-lote/blocos").Pilula[]} */
  const pilulas = [];
  if (permissions.movimentar_depositos !== false) {
    pilulas.push({ rotulo: "Entrada", icone: Truck, onClick: () => abrirTransferencia("entrada") });
    pilulas.push({ rotulo: "Saída", icone: LogOut, onClick: () => abrirTransferencia("saida") });
  }

  // Os produtos entram: sem eles a unidade dos lotes não é conhecida e o litro cairia no kg no primeiro quadro.
  const loadingInicial = loadingSaldo || loadingProdutos || loadingCochos || loadingAreas;
  const semSaldo = saldosAgrupados.emKg.length === 0 && saldosAgrupados.emLitros.length === 0;
  const totalKg = saldosAgrupados.emKg.reduce((t, item) => t + (Number(item.saldo) || 0), 0);
  // Nota do estoque mínimo (v13): só quando o mínimo está configurado e o saldo não está abaixo dele.
  const notaMinimo = nivel.estoqueMinimoKg != null && !nivel.abaixoMinimo;
  const abrirCocho = typeof onAbrirCocho === "function" ? onAbrirCocho : null;

  return (
    <>
      <CascaDetalhe
        className="mk-dp-deposito mk-dp--suplementacao-organizada"
        titulo={deposito.nome_ponto || "Depósito"}
        sub={subtitulo || deposito.local_estoque_nome || "Depósito"}
        chaveTela={`aba:${aba}`}
        anim={animAba || anim}
        cabecalhoDoCorpo={
          <Abas
            abas={abas}
            ativa={aba}
            onMudar={irAba}
            idBase={idBaseAbas}
            rotulo="Seções do depósito"
          />
        }
        propsDoCorpo={{ role: "tabpanel", id: idsAba.painel, "aria-labelledby": idsAba.aba }}
        rodape={pilulas.length > 0 ? <RodapePilulas itens={pilulas} /> : null}
      >
        {loadingInicial ? (
          <Vazio icone={Loader2} className="mk-dp-deposito__carregando" role="status">
            Carregando detalhes do depósito...
          </Vazio>
        ) : aba === "detalhes" ? (
          <>
            <DepositoNivel nivel={nivel} saldoSacos={totalSaldoSacos} necessidadeSacos={totalNecessidadeSacos} />

            <TransferenciasAguardandoDeposito
              deposito={deposito}
              produtos={produtos}
              onEditar={(item) => {
                setEdicaoTransferencia(item);
                setTransferDirection(item.direcao);
                setShowTransferencia(true);
              }}
            />

            <SecaoDetalhe id={idTituloSaldo} titulo="Saldo por produto" className="mk-dp-deposito__saldo">
              <Cartao role="group" aria-labelledby={idTituloSaldo}>
                {semSaldo ? (
                  // Seção vazia dentro do detalhe: a linha fraca do v12 (`v11-row--fraco`).
                  <Linha className="mk-dp-deposito__linha--fraca" rotulo="Sem saldo disponível neste depósito." />
                ) : (
                  <>
                    {saldosAgrupados.emKg.map((item) => (
                      <LinhaSaldoProduto key={item.produto_id} item={item} totalKg={totalKg} />
                    ))}
                    {saldosAgrupados.emLitros.length > 0 ? (
                      <div role="group" aria-labelledby={idGrupoLitros} className="mk-dp-deposito__litros">
                        <p id={idGrupoLitros} className="mk-dp-deposito__litros-tit">
                          Em litros (fora do saldo em kg)
                        </p>
                        {saldosAgrupados.emLitros.map((item) => (
                          <LinhaSaldoProduto key={item.produto_id} item={item} />
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </Cartao>
              {notaMinimo ? <p className="mk-dp-dep13__nota">Abaixo do mínimo o mapa avisa para repor.</p> : null}
            </SecaoDetalhe>
          </>
        ) : aba === "informacoes" ? (
          <>
            <SecaoDetalhe
              titulo={cochos.length > 0 ? `Pastos atendidos · ${cochos.length} ${cochos.length === 1 ? "cocho" : "cochos"}` : "Pastos atendidos"}
              className="mk-dp-deposito__pastos"
            >
              {cochos.length === 0 ? (
                <Cartao>
                  <Linha className="mk-dp-deposito__linha--fraca" rotulo="Nenhum cocho vinculado a este depósito." />
                </Cartao>
              ) : (
                <ListaItens rotulo="Pastos atendidos">
                  {cochos.map((c) => (
                    <Item
                      key={c.id}
                      imagem={urlIconeCocho(c.fracao)}
                      titulo={c.nome}
                      meta={
                        <>
                          {c.meta}
                          {/* A bolinha é só cor: o farol vai em texto ao leitor de tela. */}
                          <span className="mk-dp-deposito__oculto">{` · ${c.farol.texto}`}</span>
                        </>
                      }
                      chip={
                        <span className="mk-dp-chip mk-dp-dep13__leitura" data-cor={c.farol.cor} aria-hidden="true">
                          <span className="mk-dp-bolinha" style={{ background: c.farol.hex }} />
                          {c.farol.curto}
                        </span>
                      }
                      sub={
                        <span className="mk-dp-dep13__nivel-cocho" aria-hidden="true">
                          <span className="mk-dp-dep13__nivel-barra">
                            <span style={{ width: `${Math.round(Math.max(0, Math.min(1, Number(c.fracao) || 0)) * 100)}%` }} />
                          </span>
                          <span className="mk-dp-dep13__nivel-txt">{c.nivelTexto}</span>
                        </span>
                      }
                      chevron={Boolean(abrirCocho)}
                      title={c.farol.texto}
                      onClick={abrirCocho ? () => abrirCocho(c.ponto) : undefined}
                    />
                  ))}
                </ListaItens>
              )}
            </SecaoDetalhe>

            <SecaoDetalhe id={idTituloInfo} titulo="Informações do depósito">
              <Cartao role="group" aria-labelledby={idTituloInfo}>
                <Grade>
                  <Celula rotulo="Número" valor={deposito.numero_ponto || VAZIO} />
                  <Celula rotulo="Sigla" valor={deposito.sigla || VAZIO} />
                  <Celula rotulo="Tipo" valor={deposito.tipo || VAZIO} />
                  <Celula rotulo="Local de estoque" valor={deposito.local_estoque_nome || VAZIO} />
                  <Celula rotulo="Produto padrão" valor={deposito.produto_padrao || VAZIO} />
                </Grade>
                <Linha rotulo="Observações" valor={deposito.observacoes || VAZIO} quebra />
              </Cartao>
            </SecaoDetalhe>
          </>
        ) : (
          <div className="mk-dp-hist">
            <FiltroHistorico opcoes={FILTROS_DEPOSITO} valor={filtroHistorico} onMudar={setFiltroHistorico} />
            {loadingMovimentacoes && movimentacoes.length === 0 ? (
              <div role="status" className="mk-dp-hist__estado">
                Carregando histórico...
              </div>
            ) : erroMovimentacoes && movimentacoes.length === 0 ? (
              <div role="alert" className="mk-dp-hist__estado">
                Não foi possível carregar o histórico.
              </div>
            ) : diasDoHistorico.length > 0 ? (
              <LinhaDoTempoDeposito dias={diasDoHistorico} rotulo="Histórico do depósito" />
            ) : (
              <Vazio icone={History}>
                {filtroHistorico === "todos" ? "Nenhum registro ainda." : "Nenhum registro deste tipo neste depósito."}
              </Vazio>
            )}
          </div>
        )}
      </CascaDetalhe>

      {/*
        D-PROD-222: Entrada e Saída abrem como os lançamentos de manejo — o
        `LancLoteDialogo` com o título da ação e o depósito no subtítulo; popup
        no desktop, tela cheia no celular, ✕/✓ no cabeçalho (o ✓ envia o
        formulário). D-PROD-161: ele abre POR CIMA do "Depósito de
        Suplementação" (outro LancLoteDialogo) e entrega aos filhos o PRÓPRIO
        alvo das folhas do celular: a folha "Local" nasce DENTRO deste diálogo
        (camada de cima: foco, toque e leitor de tela), não no de baixo
        (aria-hidden, sem toque). Em tela cheia ele não tem transform, mas o
        vidro (backdrop-filter e a borda de 1 px do .mk-ll-dlg) o torna o bloco
        de contenção da folha (position: fixed): ela ocupa o diálogo, que ocupa
        a tela menos essa borda. Com a folha aberta, o Esc fecha só a folha — a
        regra é do LancLoteDialogo, para todos os lançamentos.
      */}
      <LancLoteDialogo
        open={showTransferencia}
        onOpenChange={(aberto) => {
          setShowTransferencia(aberto);
          if (!aberto) setEdicaoTransferencia(null);
        }}
        titulo={`${edicaoTransferencia ? "Editar " : ""}${transferDirection === "entrada" ? "Entrada no Depósito" : "Saída do Depósito"}`}
        lotes={[{ nome: deposito.nome_ponto }]}
        largo
      >
        <FormularioTransferenciaDeposito
          key={edicaoTransferencia?.operationId ?? `novo-${transferDirection}`}
          deposito={deposito}
          initialDirection={transferDirection}
          edicao={edicaoTransferencia}
          onSuccess={() => {
            setShowTransferencia(false);
            setEdicaoTransferencia(null);
            handleSaved();
            queryClient.invalidateQueries({ queryKey: ["transferencias-aguardando", deposito.local_estoque_id] });
          }}
          onCancel={() => {
            setShowTransferencia(false);
            setEdicaoTransferencia(null);
          }}
        />
      </LancLoteDialogo>
    </>
  );
}

/**
 * @typedef {{ produto_id: string, produto_nome: string, saldo: number, saldoSacos: number, unidadeConfirmada: boolean, emLitros?: boolean }} SaldoProduto
 */

/**
 * Linha do "Saldo por produto" (v12): produto, sacos embaixo e o saldo à
 * direita; em LITROS, "—" nos sacos e o volume em L (D-PROD-162, P-11).
 * Produto fora do cadastro: unidade não confirmada (o saldo continua em kg,
 * como no nível).
 * @param {{ item: SaldoProduto, totalKg?: number }} props
 */
function LinhaSaldoProduto({ item, totalKg = 0 }) {
  const sub = item.emLitros ? (
    VAZIO
  ) : (
    <>
      {`${formatDecimal(item.saldoSacos || 0)} sacos`}
      {!item.unidadeConfirmada ? (
        <>
          {" · "}
          <span className="mk-dp-deposito__alerta">unidade não confirmada</span>
        </>
      ) : null}
    </>
  );
  const valor = item.emLitros ? (
    <span data-testid={`saldo-litros-${item.produto_id}`}>{`${formatDecimal(item.saldo)} L`}</span>
  ) : (
    formatarKgNivel(item.saldo)
  );
  // v13: em kg, a barra da participação do produto no saldo (só desenho; o número está na linha).
  const participacao = !item.emLitros && totalKg > 0 ? Math.max(0, Math.min(100, (item.saldo / totalKg) * 100)) : null;
  return (
    <div className="mk-dp-dep13__produto" data-unidade-confirmada={String(item.unidadeConfirmada)}>
      <Linha rotulo={item.produto_nome} sub={sub} valor={valor} />
      {participacao != null ? (
        <span className="mk-dp-dep13__part" aria-hidden="true" data-participacao={participacao.toFixed(1)}>
          <span style={{ width: `${participacao.toFixed(1)}%` }} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * @typedef {{
 *   chave: string,
 *   dia: string | null,
 *   Icone: import("lucide-react").LucideIcon,
 *   titulo: string,
 *   linhas: Array<{ rotulo: string, valor: string }>,
 *   acoes?: React.ReactNode,
 *   curto: { tom: "entrada" | "saida", quantidade: string, sacos: string | null, resumo: string, rotuloQuantidade: string, resto: Array<{ rotulo: string, valor: string }> },
 * }} CartaoDoDeposito
 */

/**
 * Texto curto da etiqueta da leitura: "Cocho adequado" → "Adequado"; o resto como vem.
 * @param {string} rotulo
 */
function rotuloCurtoDoFarol(rotulo) {
  const t = String(rotulo || "").replace(/^Cocho\s+/i, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/**
 * Dia literal da movimentação ('AAAA-MM-DD'), a mesma data que o histórico
 * completo mostra (a parte antes do "T"); sem data válida → null.
 * @param {any} mov
 */
function diaDaMovimentacao(mov) {
  const dia = String(mov?.data_movimentacao ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null;
}

/**
 * Entrada ou saída DESTE depósito: pelo tipo gravado; sem tipo conhecido, pelo
 * lado do local (destino = entrada).
 * @param {any} mov
 * @param {string | null | undefined} localEstoqueId
 */
function ehEntradaNoDeposito(mov, localEstoqueId) {
  const tipo = normalizeText(mov?.tipo_movimentacao || "");
  if (tipo.startsWith("ENTRADA")) return true;
  if (tipo.startsWith("SAIDA")) return false;
  return mov?.local_estoque_destino === localEstoqueId && mov?.local_estoque_origem !== localEstoqueId;
}

/**
 * Destino de uma saída: a suplementação — com o cocho do lançamento
 * (`ponto_suplementacao_id`, enquanto o ponto está ativo) ou, sem ele, o pasto
 * gravado na baixa — ou o local de destino da transferência.
 * @param {any} mov
 * @param {Map<any, any>} cochosPorId
 */
function destinoDaSaida(mov, cochosPorId) {
  if (mov?.tipo_detalhado === "suplementacao") {
    const cocho = mov.ponto_suplementacao_id != null ? cochosPorId.get(mov.ponto_suplementacao_id) : null;
    const para = cocho?.nome_ponto || mov.area_vinculada_nome || "";
    return para ? `Suplementação · ${para}` : "Suplementação";
  }
  return mov?.local_destino || VAZIO;
}

/**
 * Cartão da linha do tempo (v12): "Entrada no depósito" (caminhão) ou "Saída
 * do depósito"; origem ou destino, produto, quantidade, sacos (pelo peso do
 * saco do produto) e as observações, quando há.
 * @param {any} mov
 *
 * D-PROD-268: a perna ATIVA de uma transferência entre depósitos (a Saída na origem, a
 * Entrada no destino) leva a ação "Excluir transferência" no pé do cartão, só com
 * `acaoDeCancelar` (a permissão). No mapa só há exclusão: o registro excluído ('Estornada')
 * e os movimentos de estorno do servidor nem chegam aqui (`movimentacoesDoHistoricoDeposito`),
 * então nenhum cartão leva chip "Cancelado".
 * @param {{ localEstoqueId: string | null | undefined, produtosPorId: Map<any, any>, cochosPorId: Map<any, any>, acaoDeCancelar?: ((mov: any) => React.ReactNode) | null }} ctx
 * @returns {CartaoDoDeposito}
 */
function cartaoDaMovimentacao(mov, { localEstoqueId, produtosPorId, cochosPorId, acaoDeCancelar = null }) {
  const entrada = ehEntradaNoDeposito(mov, localEstoqueId);
  const emLitros = mov?.unidade_medida === "L";
  const pesoPorSaco = emLitros ? 0 : Number(produtosPorId.get(mov?.produto_id)?.peso_por_saco_kg || 0);
  const linhas = [
    entrada ? { rotulo: "Origem", valor: mov?.local_origem || VAZIO } : { rotulo: "Destino", valor: destinoDaSaida(mov, cochosPorId) },
    { rotulo: "Produto", valor: mov?.produto_nome || VAZIO },
    { rotulo: emLitros ? "Quantidade (L)" : "Quantidade (kg)", valor: fmtNumero(mov?.quantidade ?? 0, 2) },
    { rotulo: "Sacos", valor: pesoPorSaco > 0 ? fmtNumero(kgParaSacos(mov?.quantidade, pesoPorSaco), 2) : VAZIO },
  ];
  const observacoes = typeof mov?.observacoes === "string" ? mov.observacoes.trim() : "";
  if (observacoes) linhas.push({ rotulo: "Observações", valor: observacoes });
  // v13 (cartão curto): a quantidade com sinal à direita (verde na entrada, vermelho na saída),
  // os sacos embaixo dela, e na linha de baixo do título o produto com a origem/destino.
  const unidade = emLitros ? "L" : "kg";
  const qtdTexto = `${entrada ? "+" : "−"}${fmtNumero(mov?.quantidade ?? 0, 2).replace(/,00$/, "")} ${unidade}`;
  const sacos = pesoPorSaco > 0 ? `${fmtNumero(kgParaSacos(mov?.quantidade, pesoPorSaco), 2)} sacos` : null;
  const lugar = entrada ? (mov?.local_origem ? `de ${mov.local_origem}` : "") : destinoDaSaida(mov, cochosPorId);
  const resumo = [mov?.produto_nome || "", lugar && lugar !== VAZIO ? lugar : ""].filter(Boolean).join(" · ") || VAZIO;
  return {
    chave: `mov-${mov?.id ?? "sem-id"}`,
    dia: diaDaMovimentacao(mov),
    Icone: entrada ? Truck : LogOut,
    titulo: entrada ? "Entrada no depósito" : "Saída do depósito",
    linhas,
    curto: {
      tom: entrada ? "entrada" : "saida",
      quantidade: qtdTexto,
      sacos,
      resumo,
      rotuloQuantidade: `${entrada ? "Entraram" : "Saíram"} ${fmtNumero(mov?.quantidade ?? 0, 2)} ${unidade}${sacos ? `, ${sacos}` : ""}`,
      resto: observacoes ? [{ rotulo: "Observações", valor: observacoes }] : [],
    },
    ...(acaoDeCancelar && transferenciaCancelavelAqui(mov, localEstoqueId) ? { acoes: acaoDeCancelar(mov) } : {}),
  };
}

/**
 * D-PROD-268 — a perna da transferência que ESTE depósito mostra (Saída `transferencia_enviada`
 * na origem, Entrada `transferencia_recebida` no destino), ainda 'Ativa' e nascida pelo comando
 * do depósito. Quem decide se a exclusão é possível é o servidor (ensaio e comando); a
 * ordem do cache nunca decide "o último".
 * @param {any} mov
 * @param {string | null | undefined} localEstoqueId
 */
function transferenciaCancelavelAqui(mov, localEstoqueId) {
  if (!mov || !localEstoqueId || mov.status !== "Ativa" || mov.origem_sistema !== "deposito") return false;
  if (mov.tipo_detalhado === "transferencia_enviada") return mov.local_estoque_origem === localEstoqueId;
  if (mov.tipo_detalhado === "transferencia_recebida") return mov.local_estoque_destino === localEstoqueId;
  return false;
}

/**
 * Agrupa os cartões por dia na ordem em que chegam (a do histórico): dias
 * seguidos iguais viram um grupo; a chave leva a posição, porque a ordem é a do
 * registro e o mesmo dia pode voltar depois.
 * @param {CartaoDoDeposito[]} cartoes
 */
function agruparPorDia(cartoes) {
  /** @type {Array<{ chave: string, dia: string | null, rotulo: string, cartoes: CartaoDoDeposito[] }>} */
  const dias = [];
  cartoes.forEach((cartao) => {
    let grupo = dias[dias.length - 1];
    if (!grupo || grupo.dia !== cartao.dia) {
      grupo = { chave: `${cartao.dia ?? "sem-data"}-${dias.length}`, dia: cartao.dia, rotulo: rotuloDoDia(cartao.dia), cartoes: [] };
      dias.push(grupo);
    }
    grupo.cartoes.push(cartao);
  });
  return dias;
}
