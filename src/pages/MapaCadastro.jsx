import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import FormularioArea, { FORMULARIO_AREA_ID } from "../components/mapa/FormularioArea";
import FormularioPonto, { FORMULARIO_PONTO_ID } from "../components/mapa/FormularioPonto";
import FormularioLinha, { FORMULARIO_LINHA_ID } from "../components/mapa/FormularioLinha";
import MapaDesenho from "../components/mapa/MapaDesenho";
import ImportarAreasDialog from "../components/mapa/importacaoAreas/ImportarAreasDialog";
import SelecaoAreasMapa from "../components/mapa/SelecaoAreasMapa";
import ModalCadastroLotePontos from "../components/mapa/ModalCadastroLotePontos";
import TelaCadastroMapa from "../components/mapa/cadastro/TelaCadastroMapa";
import AcoesEmLoteAreas from "../components/mapa/cadastro/AcoesEmLoteAreas";
import {
  COLUNAS_AREAS,
  COLUNAS_LINHAS,
  COLUNAS_PONTOS,
  celulaDaArea,
  celulaDaLinha,
  celulaDoPonto,
  comparadorNumerico,
  pontosComDetalhes,
  valorDaArea,
  valorDaLinha,
  valorDoPonto,
} from "../components/mapa/cadastro/colunasCadastroMapa";
import * as mapaService from "@/services/mapaService";
import { invalidarCachesDoMapa } from "../components/mapa/invalidarCachesMapa";
import { getApiErrorMessage, hasApiErrorCode, API_ERROR_CODES } from "@/apis/_core/ApiError";

const TITULO = "Cadastro de Áreas, Pontos e Linhas";

const ABAS = [
  { id: "areas", label: "Áreas" },
  { id: "pontos", label: "Pontos" },
  { id: "linhas", label: "Linhas" },
];

/** Abas do cadastro, no desenho das abas do motor (D-PROD-174). */
function AbasCadastroMapa({ ativa, onTrocar }) {
  return (
    <div className="b1-panel-tabs-root b1-abas-fora mk-cadastro-mapa__abas">
      <div className="b1-panel-tabs-rail">
        <div className="b1-panel-tabs-strip" role="tablist" aria-label="Tipo de cadastro">
          {ABAS.map((aba) => (
            <button
              key={aba.id}
              type="button"
              role="tab"
              aria-selected={ativa === aba.id}
              tabIndex={ativa === aba.id ? 0 : -1}
              onClick={() => onTrocar(aba.id)}
              className={cn("b1-panel-tab relative", ativa === aba.id && "is-active")}
            >
              {aba.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Vértices gravados ([lat, lng] ou {lat, lng}) no formato que os formulários de área e linha recebem. */
const verticesDoItem = (item) => item?.coordenadas?.coords?.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));

/**
 * Cadastro de Áreas, Pontos e Linhas no motor Base1 (D-PROD-174). Cada aba é uma tela do motor (barra, faixa de
 * filtros, grade/cards, registro). A geometria nasce e muda no mapa: "+ Novo" desenha (ou marca o ponto), e
 * "Editar no mapa" fica no registro. "Mais opções" traz GPS, seleção no mapa, importação, cadastro em lote e,
 * para áreas, as ações em lote (setor, cor, códigos).
 */
export default function MapaCadastro() {
  const [modo, setModo] = useState("listagem");
  const [abaAtiva, setAbaAtiva] = useState("areas");
  const [tipoDesenho, setTipoDesenho] = useState(null);
  const [usarGPS, setUsarGPS] = useState(false);
  const [itemEditando, setItemEditando] = useState(null);
  const [showImportarAreas, setShowImportarAreas] = useState(false);
  const [showSelecaoMapa, setShowSelecaoMapa] = useState(false);
  const [showCadastroLotePontos, setShowCadastroLotePontos] = useState(false);
  const [acaoEmLote, setAcaoEmLote] = useState(/** @type {{ acao: 'setor'|'cor'|'renumerar', areas: any[] } | null} */ (null));

  const queryClient = useQueryClient();
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const empresaAnteriorRef = useRef(empresaSelecionadaId);

  useEffect(() => {
    const anterior = empresaAnteriorRef.current;
    empresaAnteriorRef.current = empresaSelecionadaId;
    if (!anterior || !empresaSelecionadaId || anterior === empresaSelecionadaId) return;
    setModo("listagem");
    setItemEditando(null);
    setAcaoEmLote(null);
  }, [empresaSelecionadaId]);

  const { data: setores = [] } = useQuery({
    queryKey: ["setores-cadastro-mapa", empresaSelecionadaId],
    queryFn: () => mapaService.listarSetoresAtivos(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  // ── Exclusões e gravações: o cadastro e o Mapa Geral ('mapa-cache') ─────
  // O Mapa Geral é outra rota (desmontado aqui): sem invalidar 'mapa-cache' ele
  // voltava mostrando a área/ponto/linha de antes por até 5 minutos.
  const invalidarAreas = useCallback(() => {
    invalidarCachesDoMapa(queryClient, ["areas"]);
    return queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "areas" });
  }, [queryClient]);
  const invalidarLinhas = useCallback(() => {
    invalidarCachesDoMapa(queryClient, ["linhas"]);
    return queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "linhas" });
  }, [queryClient]);

  const excluirAreas = useCallback(
    async (ids) => {
      for (const id of ids) {
        try {
          await mapaService.excluirArea(id, empresaSelecionadaId);
          toast.success("Área excluída!");
        } catch (error) {
          // Decisão por código estável, nunca por substring da mensagem.
          if (hasApiErrorCode(error, API_ERROR_CODES.MAPA_DELETE_BLOCKED)) toast.error(getApiErrorMessage(error));
          else toast.error(getApiErrorMessage(error, "Erro ao excluir área"));
        }
      }
      invalidarAreas();
    },
    [empresaSelecionadaId, invalidarAreas],
  );

  const invalidarPontos = useCallback(() => {
    invalidarCachesDoMapa(queryClient, ["pontos", "pontos-suplementacao", "pontos-supl", "mapa-pontos", "mapa-pontos-supl"]);
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) && ["pontos", "pontos-suplementacao", "pontos-supl", "mapa-pontos", "mapa-pontos-supl"].includes(q.queryKey[0]),
    });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  }, [queryClient]);

  const excluirPontos = useCallback(
    async (ids, itens) => {
      for (const id of ids) {
        try {
          await mapaService.excluirPontoComCascata(id, empresaSelecionadaId, itens.find((item) => String(item.id) === String(id)) || null);
          toast.success("Ponto excluído!");
        } catch (error) {
          toast.error(getApiErrorMessage(error, "Erro ao excluir ponto"));
        }
      }
      invalidarPontos();
    },
    [empresaSelecionadaId, invalidarPontos],
  );

  const excluirLinhas = useCallback(
    async (ids) => {
      for (const id of ids) {
        try {
          await mapaService.excluirLinha(id);
          toast.success("Linha excluída!");
        } catch (error) {
          toast.error(getApiErrorMessage(error, "Erro ao excluir linha"));
        }
      }
      invalidarLinhas();
    },
    [invalidarLinhas],
  );

  // ── Mapa: desenhar, marcar e editar a geometria ────────────────────────
  const handleNovoItem = (tipo, gps = false) => {
    setTipoDesenho(tipo);
    setUsarGPS(gps);
    setItemEditando(null);
    setModo("mapa");
  };

  const handleEditarNoMapa = (item, tipo) => {
    setItemEditando(item);
    setTipoDesenho(tipo);
    setModo("mapa");
  };

  const voltarParaLista = () => {
    setModo("listagem");
    setTipoDesenho(null);
    setUsarGPS(false);
    setItemEditando(null);
  };

  const carregarAreas = useCallback(() => mapaService.listarAreasAtivas(empresaSelecionadaId), [empresaSelecionadaId]);
  const carregarLinhas = useCallback(() => mapaService.listarLinhasAtivas(empresaSelecionadaId), [empresaSelecionadaId]);
  const carregarPontos = useCallback(async () => {
    const [pontos, suplementacao, bebedouros] = await Promise.all([
      mapaService.listarPontosAtivos(empresaSelecionadaId),
      mapaService.listarPontosSuplementacaoDaEmpresa(empresaSelecionadaId),
      mapaService.listarBebedourosAtivos(empresaSelecionadaId),
    ]);
    return pontosComDetalhes(
      pontos,
      suplementacao.filter((p) => p.empresa_id === empresaSelecionadaId && p.status === "Ativo"),
      bebedouros.filter((b) => b.empresa_id === empresaSelecionadaId && b.ativo !== false),
    );
  }, [empresaSelecionadaId]);

  const abas = <AbasCadastroMapa ativa={abaAtiva} onTrocar={setAbaAtiva} />;
  const comparaArea = useMemo(() => comparadorNumerico(valorDaArea), []);
  const comparaPonto = useMemo(() => comparadorNumerico(valorDoPonto), []);
  const comparaLinha = useMemo(() => comparadorNumerico(valorDaLinha), []);

  if (modo === "mapa") {
    return <MapaDesenho tipoDesenho={tipoDesenho} usarGPS={usarGPS} itemEditando={itemEditando} onSalvar={voltarParaLista} onCancelar={voltarParaLista} />;
  }

  return (
    <>
      {abaAtiva === "areas" ? (
        <TelaCadastroMapa
          key="areas"
          titulo={TITULO}
          abas={abas}
          queryKey={["areas", empresaSelecionadaId, "cadastro"]}
          carregar={carregarAreas}
          habilitado={!!empresaSelecionadaId}
          colunas={COLUNAS_AREAS}
          valor={valorDaArea}
          celula={celulaDaArea}
          comparar={comparaArea}
          chaveColunas="colunas_cadastro_areas_b1"
          buscaPlaceholder="Buscar áreas…"
          vazio="Nenhuma área encontrada"
          arquivoCsv="areas.csv"
          rotuloDoItem={(item) => item.nome || "Área"}
          codigoDoItem={(item) => item.numero_area || item.sigla || undefined}
          textoDeBusca={(item) => [item.nome, item.sigla, item.numero_area, item.setor_nome, item.tipo_cultura, item.tipo_pastagem].filter(Boolean).join(" ")}
          formId={FORMULARIO_AREA_ID}
          formulario={({ item, readOnly, onSalvo, onSalvandoChange, chave }) => (
            <FormularioArea
              key={chave}
              layout="registro"
              item={item}
              coordenadas={verticesDoItem(item)}
              readOnly={readOnly}
              onSave={(...args) => {
                onSalvo(...args);
                invalidarAreas();
              }}
              onCancel={() => {}}
              onSalvandoChange={onSalvandoChange}
            />
          )}
          onNovo={() => handleNovoItem("area", false)}
          acoes={({ selecionados, registro }) => [
            { key: "editar-no-mapa", label: "Editar no mapa", hidden: !registro, onSelect: () => handleEditarNoMapa(registro, "area") },
            { key: "gps", label: "Nova área por GPS", hidden: Boolean(registro), onSelect: () => handleNovoItem("area", true) },
            { key: "selecionar-no-mapa", label: "Selecionar no mapa", hidden: Boolean(registro), onSelect: () => setShowSelecaoMapa(true) },
            { key: "importar", label: "Importar áreas", hidden: Boolean(registro), onSelect: () => setShowImportarAreas(true) },
            { key: "definir-setor", label: "Definir setor", hidden: Boolean(registro), disabled: !selecionados.length, onSelect: () => setAcaoEmLote({ acao: "setor", areas: selecionados }) },
            { key: "definir-cor", label: "Definir cor", hidden: Boolean(registro), disabled: !selecionados.length, onSelect: () => setAcaoEmLote({ acao: "cor", areas: selecionados }) },
            { key: "reatribuir-codigos", label: "Reatribuir códigos", hidden: Boolean(registro), disabled: !selecionados.length, onSelect: () => setAcaoEmLote({ acao: "renumerar", areas: selecionados }) },
          ]}
          excluir={excluirAreas}
          dialogoExcluir={{
            title: "Confirmar exclusão",
            descriptionOne: "Tem certeza que deseja excluir esta área? Esta ação não pode ser desfeita.",
            descriptionMany: (n) => `Tem certeza que deseja excluir ${n} áreas? Esta ação não pode ser desfeita.`,
          }}
        />
      ) : null}

      {abaAtiva === "pontos" ? (
        <TelaCadastroMapa
          key="pontos"
          titulo={TITULO}
          abas={abas}
          queryKey={["pontos", empresaSelecionadaId, "cadastro"]}
          carregar={carregarPontos}
          habilitado={!!empresaSelecionadaId}
          colunas={COLUNAS_PONTOS}
          valor={valorDoPonto}
          celula={celulaDoPonto}
          comparar={comparaPonto}
          chaveColunas="colunas_cadastro_pontos_b1"
          buscaPlaceholder="Buscar pontos…"
          vazio="Nenhum ponto encontrado"
          arquivoCsv="pontos.csv"
          rotuloDoItem={(item) => valorDoPonto(item, "nome") || "Ponto"}
          codigoDoItem={(item) => valorDoPonto(item, "codigo") || valorDoPonto(item, "sigla") || undefined}
          textoDeBusca={(item) => ["codigo", "nome", "sigla", "tipo", "categoria", "setor", "areas"].map((c) => valorDoPonto(item, c)).filter(Boolean).join(" ")}
          formId={FORMULARIO_PONTO_ID}
          formulario={({ item, readOnly, onSalvo, onSalvandoChange, chave }) => (
            <FormularioPonto
              key={chave}
              layout="registro"
              item={item}
              coordenadas={item.coordenadas}
              readOnly={readOnly}
              onSave={() => {
                onSalvo();
                invalidarPontos();
              }}
              onCancel={() => {}}
              onSalvandoChange={onSalvandoChange}
            />
          )}
          onNovo={() => handleNovoItem("ponto", false)}
          rotuloNovo="Novo"
          acoes={({ registro }) => [
            { key: "editar-no-mapa", label: "Editar posição no mapa", hidden: !registro, onSelect: () => handleEditarNoMapa(registro, "ponto") },
            { key: "gps", label: "Novo ponto por GPS", hidden: Boolean(registro), onSelect: () => handleNovoItem("ponto", true) },
            { key: "cadastrar-em-lote", label: "Cadastrar em lote", hidden: Boolean(registro), onSelect: () => setShowCadastroLotePontos(true) },
          ]}
          excluir={excluirPontos}
          dialogoExcluir={{
            title: "Confirmar exclusão",
            descriptionOne: "Tem certeza que deseja excluir este ponto? Esta ação não pode ser desfeita.",
            descriptionMany: (n) => `Tem certeza que deseja excluir ${n} pontos? Esta ação não pode ser desfeita.`,
          }}
        />
      ) : null}

      {abaAtiva === "linhas" ? (
        <TelaCadastroMapa
          key="linhas"
          titulo={TITULO}
          abas={abas}
          queryKey={["linhas", empresaSelecionadaId, "cadastro"]}
          carregar={carregarLinhas}
          habilitado={!!empresaSelecionadaId}
          colunas={COLUNAS_LINHAS}
          valor={valorDaLinha}
          celula={celulaDaLinha}
          comparar={comparaLinha}
          chaveColunas="colunas_cadastro_linhas_b1"
          buscaPlaceholder="Buscar linhas…"
          vazio="Nenhuma linha encontrada"
          arquivoCsv="linhas.csv"
          rotuloDoItem={(item) => item.nome || "Linha"}
          codigoDoItem={(item) => item.numero_linha || item.sigla || undefined}
          textoDeBusca={(item) => [item.nome, item.sigla, item.numero_linha, item.tipo, item.observacoes].filter(Boolean).join(" ")}
          formId={FORMULARIO_LINHA_ID}
          formulario={({ item, readOnly, onSalvo, onSalvandoChange, chave }) => (
            <FormularioLinha
              key={chave}
              layout="registro"
              item={item}
              coordenadas={verticesDoItem(item)}
              readOnly={readOnly}
              onSave={(...args) => {
                onSalvo(...args);
                invalidarLinhas();
              }}
              onCancel={() => {}}
              onSalvandoChange={onSalvandoChange}
            />
          )}
          onNovo={() => handleNovoItem("linha", false)}
          acoes={({ registro }) => [
            { key: "editar-no-mapa", label: "Editar traçado no mapa", hidden: !registro, onSelect: () => handleEditarNoMapa(registro, "linha") },
            { key: "gps", label: "Nova linha por GPS", hidden: Boolean(registro), onSelect: () => handleNovoItem("linha", true) },
          ]}
          excluir={excluirLinhas}
          dialogoExcluir={{
            title: "Confirmar exclusão",
            descriptionOne: "Tem certeza que deseja excluir esta linha? Esta ação não pode ser desfeita.",
            descriptionMany: (n) => `Tem certeza que deseja excluir ${n} linhas? Esta ação não pode ser desfeita.`,
          }}
        />
      ) : null}

      <AcoesEmLoteAreas
        acao={acaoEmLote?.acao ?? null}
        areas={acaoEmLote?.areas ?? []}
        setores={setores}
        onFechar={() => setAcaoEmLote(null)}
        onAplicado={() => {
          setAcaoEmLote(null);
          invalidarAreas();
        }}
      />

      {showImportarAreas && (
        <ImportarAreasDialog
          open={showImportarAreas}
          onOpenChange={(aberto) => {
            setShowImportarAreas(aberto);
            if (!aberto) invalidarAreas();
          }}
        />
      )}
      <ModalCadastroLotePontos
        open={showCadastroLotePontos}
        onOpenChange={(aberto) => {
          setShowCadastroLotePontos(aberto);
          if (!aberto) invalidarPontos();
        }}
      />

      {showSelecaoMapa && (
        <SelecaoAreasMapa
          onClose={() => {
            setShowSelecaoMapa(false);
            invalidarAreas();
          }}
        />
      )}
    </>
  );
}
