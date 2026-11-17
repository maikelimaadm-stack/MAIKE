import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import React, { useId, useMemo, useState } from "react";
import { History, Loader2, LogOut, Truck } from "lucide-react";
import { listarTodosLotesNota, listarTodosProdutos, listarTodasMovimentacoes } from "@/services/estoqueMapaService";
import { listarPontosSuplementacaoAtivos, listarAreasAtivas } from "@/services/mapaService";
import { getMapaCachedData, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { listEmpresas } from "@/services/empresaService";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { urlIconeCocho } from "@/assets/icones/cocho-descoberto";
import FormularioTransferenciaDeposito from "./FormularioTransferenciaDeposito";
import HistoricoDepositoSuplementacao, { movimentacoesDoHistoricoDeposito } from "../suplementacao/HistoricoDepositoSuplementacao";
import DepositoNivel from "./DepositoNivel";
import CascaDetalhe from "./detalhes-lote/CascaDetalhe";
import LinhaDoTempo from "./detalhes-lote/LinhaDoTempo";
import { Cartao, Celula, Grade, Item, Linha, ListaItens, RodapePilulas, TituloBloco, Vazio } from "./detalhes-lote/blocos";
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

/** Cartões da linha do tempo do detalhe; o histórico completo abre pela pílula "Histórico". */
const LIMITE_LINHA_DO_TEMPO = 5;

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
 * deste depósito), informações do cadastro e a linha do tempo com as últimas
 * movimentações. Rodapé: Entrada · Saída · Histórico, com as permissões de hoje.
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
  const [showHistorico, setShowHistorico] = useState(false);
  const [transferDirection, setTransferDirection] = useState("entrada");
  const idTituloSaldo = useId();
  const idGrupoLitros = useId();
  const idTituloInfo = useId();

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
      const all = await listarTodasMovimentacoes();
      return all.filter((item) => item.empresa_id === empresaSelecionadaId && (item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id));
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

  // Pastos atendidos: cada cocho que puxa deste depósito, com o subícone do cocho
  // (nível do SSOT, D-PROD-178; o desenho dos detalhes, D-PROD-223) e a bolinha do
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
          farol: { hex: farol.hex, texto: descreverFarol(farol) },
          ponto: cocho,
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true, sensitivity: "base" }));
  }, [cochosVinculados, areas, eventos, leituras, hoje, pontosSuplementacao]);

  // Sem "Ver histórico de cocho / depósito" a pessoa vê só o último registro,
  // como antes do v12 (o histórico ficava atrás do botão).
  const podeHistorico = permissions.visualizar_historico_cocho !== false;

  // Linha do tempo: o começo do histórico completo (mesmo filtro e ordem), sem o
  // movimento rotulado `L`, como o "último registro" do SSOT (D-PROD-162).
  const diasDoHistorico = useMemo(() => {
    const produtosPorId = new Map(produtos.map((produto) => [produto.id, produto]));
    const cochosPorId = new Map(pontosSuplementacao.map((ponto) => [ponto.id, ponto]));
    const ultimas = movimentacoesDoHistoricoDeposito(movimentacoes, { empresaId: empresaSelecionadaId, localEstoqueId: deposito.local_estoque_id })
      .filter((item) => item.unidade_medida !== "L")
      .slice(0, podeHistorico ? LIMITE_LINHA_DO_TEMPO : 1);
    return agruparPorDia(ultimas.map((mov) => cartaoDaMovimentacao(mov, { localEstoqueId: deposito.local_estoque_id, produtosPorId, cochosPorId })));
  }, [movimentacoes, produtos, pontosSuplementacao, empresaSelecionadaId, deposito.local_estoque_id, podeHistorico]);

  const handleSaved = () => {
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["saldo-deposito", "cochos-vinculados-deposito", "movimentacoes-deposito-detalhe", "mapa-pontos-supl", "mapa-pontos", "pontos", "pontos-suplementacao"].includes(query.queryKey[0]) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  /** @param {"entrada" | "saida"} direcao */
  const abrirTransferencia = (direcao) => {
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
  if (podeHistorico) pilulas.push({ rotulo: "Histórico", icone: History, onClick: () => setShowHistorico(true) });

  // Os produtos entram: sem eles a unidade dos lotes não é conhecida e o litro cairia no kg no primeiro quadro.
  const loadingInicial = loadingSaldo || loadingProdutos || loadingCochos || loadingAreas;
  const semSaldo = saldosAgrupados.emKg.length === 0 && saldosAgrupados.emLitros.length === 0;
  const abrirCocho = typeof onAbrirCocho === "function" ? onAbrirCocho : null;

  return (
    <>
      <CascaDetalhe
        className="mk-dp-deposito"
        titulo={deposito.nome_ponto || "Depósito"}
        sub={subtitulo || deposito.local_estoque_nome || "Depósito"}
        anim={anim}
        rodape={pilulas.length > 0 ? <RodapePilulas itens={pilulas} /> : null}
      >
        {loadingInicial ? (
          <Vazio icone={Loader2} className="mk-dp-deposito__carregando" role="status">
            Carregando detalhes do depósito...
          </Vazio>
        ) : (
          <>
            <DepositoNivel nivel={nivel} saldoSacos={totalSaldoSacos} />

            <TituloBloco id={idTituloSaldo}>Saldo por produto</TituloBloco>
            {semSaldo ? (
              // Seção vazia dentro do detalhe: a linha fraca do v12 (`v11-row--fraco`).
              <Cartao>
                <Linha className="mk-dp-deposito__linha--fraca" rotulo="Sem saldo disponível neste depósito." />
              </Cartao>
            ) : (
              <Cartao role="group" aria-labelledby={idTituloSaldo}>
                {saldosAgrupados.emKg.map((item) => (
                  <LinhaSaldoProduto key={item.produto_id} item={item} />
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
              </Cartao>
            )}

            <TituloBloco>Pastos atendidos</TituloBloco>
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
                    bolinha={c.farol.hex}
                    chevron={Boolean(abrirCocho)}
                    title={c.farol.texto}
                    onClick={abrirCocho ? () => abrirCocho(c.ponto) : undefined}
                  />
                ))}
              </ListaItens>
            )}

            <TituloBloco id={idTituloInfo}>Informações do depósito</TituloBloco>
            <Cartao role="group" aria-labelledby={idTituloInfo}>
              <Grade>
                <Celula rotulo="Número" valor={deposito.numero_ponto || VAZIO} />
                <Celula rotulo="Sigla" valor={deposito.sigla || VAZIO} />
                <Celula rotulo="Tipo" valor={deposito.tipo || VAZIO} />
                <Celula rotulo="Local de estoque" valor={deposito.local_estoque_nome || VAZIO} />
                <Celula rotulo="Produto padrão" valor={deposito.produto_padrao || VAZIO} />
                <Celula rotulo="Limite operacional" valor={nivel.limiteOperacionalKg != null ? formatarKgNivel(nivel.limiteOperacionalKg) : VAZIO} />
                <Celula rotulo="Estoque mínimo" valor={nivel.estoqueMinimoKg != null ? formatarKgNivel(nivel.estoqueMinimoKg) : VAZIO} />
              </Grade>
              <Linha rotulo="Cochos vinculados" valor={cochos.map((c) => c.nome).join(", ") || VAZIO} quebra />
              <Linha rotulo="Observações" valor={deposito.observacoes || VAZIO} quebra />
            </Cartao>

            <TituloBloco>{podeHistorico ? "Histórico do depósito" : "Último registro"}</TituloBloco>
            {diasDoHistorico.length > 0 ? (
              <LinhaDoTempo dias={diasDoHistorico} rotulo={podeHistorico ? "Histórico do depósito" : "Último registro"} />
            ) : loadingMovimentacoes ? (
              // A consulta traz todas as movimentações: enquanto chega, não afirma "nenhum registro".
              <div role="status" className="mk-dp-hist__estado">
                Carregando histórico...
              </div>
            ) : erroMovimentacoes ? (
              <div role="alert" className="mk-dp-hist__estado">
                Não foi possível carregar o histórico.
              </div>
            ) : (
              <Vazio icone={History}>Nenhum registro ainda.</Vazio>
            )}
          </>
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
        onOpenChange={setShowTransferencia}
        titulo={transferDirection === "entrada" ? "Entrada no Depósito" : "Saída do Depósito"}
        lotes={[{ nome: deposito.nome_ponto }]}
        largo
      >
        <FormularioTransferenciaDeposito deposito={deposito} initialDirection={transferDirection} onSuccess={() => {setShowTransferencia(false);handleSaved();}} onCancel={() => setShowTransferencia(false)} />
      </LancLoteDialogo>

      <LancLoteDialogo open={showHistorico} onOpenChange={setShowHistorico} titulo="Histórico do Depósito" lotes={deposito.nome_ponto ? [{ nome: deposito.nome_ponto }] : undefined} largo somenteLeitura>
        <HistoricoDepositoSuplementacao deposito={deposito} />
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
 * @param {{ item: SaldoProduto }} props
 */
function LinhaSaldoProduto({ item }) {
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
  return <Linha data-unidade-confirmada={String(item.unidadeConfirmada)} rotulo={item.produto_nome} sub={sub} valor={valor} />;
}

/**
 * @typedef {{
 *   chave: string,
 *   dia: string | null,
 *   Icone: import("lucide-react").LucideIcon,
 *   titulo: string,
 *   linhas: Array<{ rotulo: string, valor: string }>,
 * }} CartaoDoDeposito
 */

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
 * @param {{ localEstoqueId: string | null | undefined, produtosPorId: Map<any, any>, cochosPorId: Map<any, any> }} ctx
 * @returns {CartaoDoDeposito}
 */
function cartaoDaMovimentacao(mov, { localEstoqueId, produtosPorId, cochosPorId }) {
  const entrada = ehEntradaNoDeposito(mov, localEstoqueId);
  const pesoPorSaco = Number(produtosPorId.get(mov?.produto_id)?.peso_por_saco_kg || 0);
  const linhas = [
    entrada ? { rotulo: "Origem", valor: mov?.local_origem || VAZIO } : { rotulo: "Destino", valor: destinoDaSaida(mov, cochosPorId) },
    { rotulo: "Produto", valor: mov?.produto_nome || VAZIO },
    { rotulo: "Quantidade (kg)", valor: fmtNumero(mov?.quantidade ?? 0, 2) },
    { rotulo: "Sacos", valor: pesoPorSaco > 0 ? fmtNumero(kgParaSacos(mov?.quantidade, pesoPorSaco), 2) : VAZIO },
  ];
  const observacoes = typeof mov?.observacoes === "string" ? mov.observacoes.trim() : "";
  if (observacoes) linhas.push({ rotulo: "Observações", valor: observacoes });
  return {
    chave: `mov-${mov?.id ?? "sem-id"}`,
    dia: diaDaMovimentacao(mov),
    Icone: entrada ? Truck : LogOut,
    titulo: entrada ? "Entrada no depósito" : "Saída do depósito",
    linhas,
  };
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
