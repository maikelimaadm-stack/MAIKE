import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, AlertTriangle, CheckCircle2, XCircle, MinusCircle, RotateCcw } from "lucide-react";
import * as BotaoUi from "@/components/ui/button";
import * as CampoUi from "@/components/ui/input";
import * as TextoUi from "@/components/ui/textarea";
import * as DialogoUi from "@/components/ui/dialog";
import * as AlertaUi from "@/components/ui/alert-dialog";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { listarSetoresAtivos } from "@/services/mapaService";
import { refreshMapaCacheEntry } from "@/services/mapaCacheService";
import {
  MAX_AREAS_POR_IMPORTACAO,
  assinaturaDoEnvio,
  conferirNoServidor,
  gravarImportacao,
  itemDeEnvio,
  novaChaveDeImportacao,
} from "@/services/areaImportacaoService";
import { LIMITES_ARQUIVO, lerArquivoDeAreas } from "@/lib/geografia/importacaoAreas";
import { formatHectaresPt } from "@/lib/geografia";
import {
  APROVEITAMENTO,
  COR_PADRAO_IMPORTACAO,
  CORES_DISPONIVEIS,
  TIPOS_CULTURAS,
  TIPOS_INFRAESTRUTURA,
  TIPOS_USO,
  pendenciasDaArea,
} from "@/domain/areas/regrasCadastroArea";
import { API_ERROR_CODES, getApiErrorMessage, hasApiErrorCode } from "@/apis/_core/ApiError";
import PreviaImportacaoMapa from "./PreviaImportacaoMapa";
import SeletorImportacao from "./SeletorImportacao";

// Componentes shadcn (forwardRef sem tipos de props no checkJs legado): o
// alias `any` evita dívida nova no gate:types sem mexer nos componentes base.
/** @type {Record<string, any>} */
const ui = { ...BotaoUi, ...CampoUi, ...TextoUi, ...DialogoUi, ...AlertaUi };
const {
  Button,
  Input,
  Textarea,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} = ui;

/**
 * Importação de áreas por arquivo KML/GeoJSON (D-PROD-90).
 *
 * Três etapas, nesta ordem e sem atalho:
 *   1. Arquivo   — lê no navegador; nenhum POST.
 *   2. Conferir  — prévia no mapa + tabela editável + conferência no servidor
 *                  (que também não grava).
 *   3. Confirmar — só o clique final grava, tudo ou nada, até 100 áreas.
 *
 * A empresa é a selecionada no MAIKE quando o arquivo foi lido. Se ela mudar
 * com o assistente aberto, a conferência deixa de valer e a gravação trava.
 */

const CAMPOS_EM_MASSA = ["setor_id", "tipo_cultura", "tipo_pastagem", "tipo_infraestrutura", "aproveitamento", "cor", "area_pastejada"];
const ROTULOS = {
  nome: "Nome",
  setor_id: "Setor",
  tipo_cultura: "Tipo de uso",
  tipo_pastagem: "Tipo de cultura",
  tipo_infraestrutura: "Tipo de infraestrutura",
  area_pastejada: "Área pastejada/arável",
  aproveitamento: "Aproveitamento",
  cor: "Cor",
  coords: "Contorno",
  sigla: "Sigla",
  aproveitamento_classificacao: "Aproveitamento",
};
const CODIGOS_DUPLICIDADE = new Set(["AREA_DUPLICADA", "AREA_DUPLICADA_NO_ARQUIVO", "NOME_DUPLICADO_NO_SETOR", "NOME_DUPLICADO_NO_ARQUIVO"]);

const arredondar2 = (n) => Math.round(n * 100) / 100;
const formatarBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const selectClass =
  "h-7 w-full min-w-[110px] rounded border border-slate-300 bg-white px-1 text-xs focus:border-emerald-500 focus:outline-none";
const invalidoClass = "border-red-500 bg-red-50";

/** Linha editável a partir do item lido do arquivo. */
const linhaDoItem = (item) => ({
  ref: item.ref,
  origem: item.origem,
  tipoGeometria: item.tipoGeometria,
  avisos: item.avisos ?? [],
  vertices: item.vertices,
  hectares: item.hectares,
  nome: item.nomeNoArquivo || "",
  nomeOrigem: item.nomeNoArquivo ? "arquivo" : "vazio",
  sigla: item.siglaNoArquivo || "",
  setor_id: "",
  tipo_cultura: "",
  tipo_pastagem: "",
  tipo_infraestrutura: "",
  area_pastejada: "",
  aproveitamento: "Média",
  cor: COR_PADRAO_IMPORTACAO,
  editados: {},
});

const usoDoNavegadorOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

export default function ImportarAreasDialog({ open, onOpenChange }) {
  const empresaAtual = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  const [etapa, setEtapa] = useState(/** @type {'arquivo'|'conferencia'|'resultado'} */ ("arquivo"));
  const [erroArquivo, setErroArquivo] = useState("");
  const [arquivo, setArquivo] = useState(/** @type {null | {nome: string, tamanho: number, formato: string}} */ (null));
  const [leitura, setLeitura] = useState(/** @type {any} */ (null));
  const [empresaDoArquivo, setEmpresaDoArquivo] = useState(/** @type {string | null} */ (null));
  const [linhas, setLinhas] = useState(/** @type {ReturnType<typeof linhaDoItem>[]} */ ([]));
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [foco, setFoco] = useState(/** @type {string | null} */ (null));
  const [textoColado, setTextoColado] = useState("");
  const [mostrarColar, setMostrarColar] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [massa, setMassa] = useState(/** @type {Record<string, string>} */ ({}));
  const [prefixoNome, setPrefixoNome] = useState("ÁREA");
  const [conflitoMassa, setConflitoMassa] = useState(/** @type {null | {campos: string[], qtd: number}} */ (null));
  const [conferencia, setConferencia] = useState(/** @type {null | {assinatura: string, porRef: Record<string, any>}} */ (null));
  const [operacao, setOperacao] = useState(/** @type {null | {id: string, assinatura: string}} */ (null));
  const [estado, setEstado] = useState(/** @type {'livre'|'conferindo'|'gravando'|'desconhecido'} */ ("livre"));
  const [mensagem, setMensagem] = useState(/** @type {null | {tipo: 'erro'|'aviso'|'ok', texto: string}} */ (null));
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState(/** @type {any} */ (null));
  const [online, setOnline] = useState(usoDoNavegadorOnline);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const empresaMudou = Boolean(empresaDoArquivo) && empresaDoArquivo !== empresaAtual;

  const { data: setores = [] } = useQuery({
    queryKey: ["setores-importacao-areas", empresaDoArquivo],
    queryFn: async () => {
      const lista = await listarSetoresAtivos(empresaDoArquivo);
      return lista.filter((s) => s.empresa_id === empresaDoArquivo && s.ativo !== false);
    },
    enabled: open && Boolean(empresaDoArquivo),
  });
  const setoresPorId = useMemo(() => new Map(setores.map((s) => [s.id, s])), [setores]);

  const reiniciar = useCallback(() => {
    setEtapa("arquivo");
    setErroArquivo("");
    setArquivo(null);
    setLeitura(null);
    setEmpresaDoArquivo(null);
    setLinhas([]);
    setSelecionadas(new Set());
    setFoco(null);
    setTextoColado("");
    setMostrarColar(false);
    setMassa({});
    setConflitoMassa(null);
    setConferencia(null);
    setOperacao(null);
    setEstado("livre");
    setMensagem(null);
    setConfirmando(false);
    setResultado(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const fechar = (aberto) => {
    if (aberto) return;
    if (estado === "gravando") return;
    reiniciar();
    onOpenChange(false);
  };

  // ── Etapa 1: leitura ──────────────────────────────────────────────────────
  const processarTexto = (nomeArquivo, texto, tamanho) => {
    setErroArquivo("");
    const lido = lerArquivoDeAreas({ nomeArquivo, texto, tamanhoBytes: tamanho });
    if ("erro" in lido) {
      setErroArquivo(lido.erro);
      return;
    }
    if (lido.contagem.areas === 0) {
      setErroArquivo(
        `Nenhum polígono importável: ${lido.contagem.ignorados} ponto(s)/linha(s) ignorado(s) e ${lido.contagem.invalidos} elemento(s) inválido(s). ` +
          (lido.itens.find((i) => i.situacao === "invalido")?.motivo ?? "")
      );
      return;
    }
    const novas = lido.itens.filter((i) => i.situacao === "area").map(linhaDoItem);
    setArquivo({ nome: nomeArquivo || "Texto colado", tamanho, formato: lido.formato === "kml" ? "KML" : "GeoJSON" });
    setLeitura(lido);
    setEmpresaDoArquivo(empresaAtual);
    setLinhas(novas);
    setSelecionadas(new Set(novas.slice(0, MAX_AREAS_POR_IMPORTACAO).map((l) => l.ref)));
    setFoco(null);
    setConferencia(null);
    setOperacao(null);
  };

  const lerArquivo = async (file) => {
    if (!file) return;
    if (file.size > LIMITES_ARQUIVO.maxBytes) {
      setErroArquivo(`Arquivo de ${formatarBytes(file.size)}: o máximo é ${formatarBytes(LIMITES_ARQUIVO.maxBytes)}. Divida o arquivo.`);
      return;
    }
    try {
      processarTexto(file.name, await file.text(), file.size);
    } catch {
      setErroArquivo("Não foi possível ler o arquivo.");
    }
  };

  // ── Etapa 2: edição e validação local ────────────────────────────────────
  const pendenciasLocais = useMemo(() => {
    /** @type {Record<string, {campo: string, mensagem: string}[]>} */
    const mapa = {};
    for (const l of linhas) {
      const pend = pendenciasDaArea({
        nome: l.nome,
        setor_id: l.setor_id,
        tipo_cultura: l.tipo_cultura,
        tipo_pastagem: l.tipo_cultura === "Infraestrutura" ? l.tipo_infraestrutura : l.tipo_pastagem,
        area_pastejada: l.area_pastejada,
        total_ha: arredondar2(l.hectares),
      });
      if (l.setor_id && !setoresPorId.has(l.setor_id)) {
        pend.push({ campo: "setor_id", mensagem: "Setor não está entre os setores ativos desta empresa." });
      }
      if (String(l.sigla ?? "").trim().length > 10) pend.push({ campo: "sigla", mensagem: "Sigla com mais de 10 caracteres." });
      mapa[l.ref] = pend;
    }
    return mapa;
  }, [linhas, setoresPorId]);

  const linhasSelecionadas = useMemo(() => linhas.filter((l) => selecionadas.has(l.ref)), [linhas, selecionadas]);
  const itensDaSelecao = useMemo(() => linhasSelecionadas.map(itemDeEnvio), [linhasSelecionadas]);
  const assinaturaAtual = useMemo(
    () => assinaturaDoEnvio(empresaDoArquivo, itensDaSelecao),
    [empresaDoArquivo, itensDaSelecao]
  );
  const conferenciaAtual = conferencia && conferencia.assinatura === assinaturaAtual ? conferencia : null;

  const pendenciasServidor = (ref) => conferenciaAtual?.porRef?.[ref]?.pendencias ?? [];

  const alterarLinha = (ref, campo, valor, { personalizar = true } = {}) => {
    if (estado === "desconhecido" || estado === "gravando") return;
    setLinhas((prev) =>
      prev.map((l) => {
        if (l.ref !== ref) return l;
        const nova = { ...l, [campo]: valor, editados: personalizar ? { ...l.editados, [campo]: true } : l.editados };
        if (campo === "nome") nova.nomeOrigem = "usuario";
        if (campo === "tipo_cultura" && valor === "Infraestrutura") nova.area_pastejada = "";
        return nova;
      })
    );
  };

  const alternarSelecao = (ref) => {
    if (estado === "desconhecido" || estado === "gravando") return;
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  const selecionarTodas = (marcar) => {
    if (estado === "desconhecido" || estado === "gravando") return;
    setSelecionadas(marcar ? new Set(linhas.map((l) => l.ref)) : new Set());
  };

  const selecionarSoValidas = () => {
    if (estado === "desconhecido" || estado === "gravando") return;
    setSelecionadas(
      new Set(
        linhas
          .filter((l) => (pendenciasLocais[l.ref] ?? []).length === 0 && pendenciasServidor(l.ref).length === 0)
          .map((l) => l.ref)
      )
    );
  };

  const camposEmMassaPreenchidos = () => CAMPOS_EM_MASSA.filter((c) => massa[c] !== undefined && massa[c] !== "");

  const aplicarEmMassa = (sobrescrever) => {
    const campos = camposEmMassaPreenchidos();
    setLinhas((prev) =>
      prev.map((l) => {
        if (!selecionadas.has(l.ref)) return l;
        const nova = { ...l };
        for (const campo of campos) {
          if (!sobrescrever && l.editados[campo]) continue;
          if (campo === "area_pastejada") {
            if (nova.tipo_cultura === "Infraestrutura") continue;
            nova.area_pastejada = massa.area_pastejada === "__total__"
              ? formatHectaresPt(arredondar2(l.hectares))
              : massa.area_pastejada;
          } else {
            nova[campo] = massa[campo];
            if (campo === "tipo_cultura" && massa[campo] === "Infraestrutura") nova.area_pastejada = "";
          }
          if (sobrescrever && nova.editados[campo]) {
            nova.editados = { ...nova.editados };
            delete nova.editados[campo];
          }
        }
        return nova;
      })
    );
    setConflitoMassa(null);
  };

  const pedirAplicacaoEmMassa = () => {
    if (estado === "desconhecido" || estado === "gravando") return;
    const campos = camposEmMassaPreenchidos();
    if (campos.length === 0 || selecionadas.size === 0) return;
    const personalizadas = linhas.filter((l) => selecionadas.has(l.ref) && campos.some((c) => l.editados[c])).length;
    if (personalizadas > 0) {
      setConflitoMassa({ campos, qtd: personalizadas });
      return;
    }
    aplicarEmMassa(true);
  };

  const numerarNomesVazios = () => {
    if (estado === "desconhecido" || estado === "gravando") return;
    const prefixo = prefixoNome.trim().toUpperCase();
    if (!prefixo) return;
    let n = 0;
    setLinhas((prev) =>
      prev.map((l) => {
        if (!selecionadas.has(l.ref) || l.nome.trim()) return l;
        n += 1;
        return { ...l, nome: `${prefixo} ${n}`, nomeOrigem: "sugerido" };
      })
    );
  };

  // ── Contadores ───────────────────────────────────────────────────────────
  const contadores = useMemo(() => {
    const com = (ref) => (pendenciasLocais[ref] ?? []).length + pendenciasServidor(ref).length;
    const duplicados = linhas.filter((l) => pendenciasServidor(l.ref).some((p) => CODIGOS_DUPLICIDADE.has(p.codigo))).length;
    return {
      identificados: leitura?.contagem?.elementos ?? 0,
      areas: linhas.length,
      validas: linhas.filter((l) => com(l.ref) === 0).length,
      pendentes: linhas.filter((l) => com(l.ref) > 0).length,
      invalidos: leitura?.contagem?.invalidos ?? 0,
      ignorados: leitura?.contagem?.ignorados ?? 0,
      duplicados,
    };
  }, [linhas, pendenciasLocais, conferenciaAtual, leitura]);

  // ── Bloqueios da gravação ────────────────────────────────────────────────
  const pendentesNaSelecao = linhasSelecionadas.filter((l) => (pendenciasLocais[l.ref] ?? []).length > 0).length;
  const reprovadosNoServidor = conferenciaAtual
    ? linhasSelecionadas.filter((l) => pendenciasServidor(l.ref).length > 0).length
    : 0;
  const bloqueios = [];
  if (!online) bloqueios.push("Sem conexão: a importação precisa do servidor. O rascunho fica nesta tela enquanto ela estiver aberta.");
  if (empresaMudou) bloqueios.push("A empresa selecionada mudou depois que o arquivo foi lido. Recomece a importação.");
  if (selecionadas.size === 0) bloqueios.push("Selecione ao menos uma área.");
  if (selecionadas.size > MAX_AREAS_POR_IMPORTACAO) {
    bloqueios.push(`Selecione no máximo ${MAX_AREAS_POR_IMPORTACAO} áreas por importação (há ${selecionadas.size}). Importe o restante em seguida.`);
  }
  if (pendentesNaSelecao > 0) bloqueios.push(`${pendentesNaSelecao} área(s) selecionada(s) com pendência. Corrija ou desmarque.`);
  if (!conferenciaAtual && pendentesNaSelecao === 0 && selecionadas.size > 0) {
    bloqueios.push("Confira a seleção no servidor antes de importar.");
  }
  if (reprovadosNoServidor > 0) bloqueios.push(`${reprovadosNoServidor} área(s) reprovada(s) na conferência do servidor.`);
  const podeConferir =
    online && !empresaMudou && selecionadas.size > 0 && selecionadas.size <= MAX_AREAS_POR_IMPORTACAO && pendentesNaSelecao === 0 && estado === "livre";
  const podeImportar = bloqueios.length === 0 && estado === "livre";

  // ── Servidor ─────────────────────────────────────────────────────────────
  const conferirSelecao = async () => {
    if (!podeConferir) return;
    setEstado("conferindo");
    setMensagem(null);
    const assinatura = assinaturaAtual;
    try {
      const r = /** @type {any} */ (await conferirNoServidor(empresaDoArquivo, itensDaSelecao));
      const porRef = Object.fromEntries((r?.itens ?? []).map((i) => [i.ref, i]));
      setConferencia({ assinatura, porRef });
      const reprovadas = (r?.itens ?? []).filter((i) => !i.ok).length;
      setMensagem(
        reprovadas > 0
          ? { tipo: "aviso", texto: `${reprovadas} área(s) com pendência no servidor. Nada foi gravado.` }
          : { tipo: "ok", texto: `${r?.validas ?? itensDaSelecao.length} área(s) prontas para importar. Nada foi gravado ainda.` }
      );
    } catch (erro) {
      setMensagem({ tipo: "erro", texto: getApiErrorMessage(erro, "Não foi possível conferir no servidor.") });
    } finally {
      setEstado("livre");
    }
  };

  const concluirSucesso = async (r) => {
    setResultado(r);
    setEtapa("resultado");
    setEstado("livre");
    queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "areas" });
    try {
      await refreshMapaCacheEntry("areas", empresaDoArquivo, { force: true });
    } catch {
      /* o Mapa Geral recarrega ao abrir */
    }
    window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["areas"] } }));
  };

  const enviarImportacao = async () => {
    setConfirmando(false);
    if (!(podeImportar || estado === "desconhecido")) return;
    // A chave só muda quando o conteúdo muda: reenviar o mesmo pedido reaproveita
    // a chave e o servidor devolve o resultado gravado, sem duplicar.
    const op = operacao && operacao.assinatura === assinaturaAtual ? operacao : { id: novaChaveDeImportacao(), assinatura: assinaturaAtual };
    setOperacao(op);
    setEstado("gravando");
    setMensagem(null);
    try {
      const r = await gravarImportacao(op.id, empresaDoArquivo, itensDaSelecao);
      await concluirSucesso(r);
    } catch (erro) {
      if (hasApiErrorCode(erro, API_ERROR_CODES.AREA_IMPORT_VALIDATION_FAILED)) {
        const itens = /** @type {any} */ (erro)?.details?.itens ?? [];
        setConferencia({ assinatura: op.assinatura, porRef: Object.fromEntries(itens.map((i) => [i.ref, i])) });
        setMensagem({ tipo: "erro", texto: "Nenhuma área foi gravada: há pendências apontadas pelo servidor (veja as linhas em vermelho)." });
        setEstado("livre");
        return;
      }
      if (
        hasApiErrorCode(erro, API_ERROR_CODES.PROVIDER_UNAVAILABLE) ||
        hasApiErrorCode(erro, API_ERROR_CODES.IDEMPOTENCY_IN_PROGRESS)
      ) {
        setEstado("desconhecido");
        setMensagem({
          tipo: "aviso",
          texto:
            "Resultado desconhecido: a conexão falhou durante a gravação. Use “Verificar e concluir” — o reenvio usa a mesma chave e, se já foi gravado, o servidor devolve o resultado sem duplicar.",
        });
        return;
      }
      setMensagem({ tipo: "erro", texto: `${getApiErrorMessage(erro, "Não foi possível importar.")} Nenhuma área foi gravada.` });
      setEstado("livre");
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const naoImportaveis = (leitura?.itens ?? []).filter((i) => i.situacao !== "area");
  const linhasNoMapa = useMemo(
    () => linhas.map((l) => ({ ref: l.ref, nome: l.nome, cor: l.cor, vertices: l.vertices, selecionada: selecionadas.has(l.ref) })),
    [linhas, selecionadas]
  );
  const travado = estado === "gravando" || estado === "desconhecido" || empresaMudou;

  const celulaInvalida = (ref, campo) =>
    (pendenciasLocais[ref] ?? []).some((p) => p.campo === campo) || pendenciasServidor(ref).some((p) => p.campo === campo);

  return (
    <>
      <Dialog open={open} onOpenChange={fechar}>
        <DialogContent className="w-[calc(100vw-16px)] max-w-6xl max-h-[94vh] overflow-y-auto overflow-x-hidden p-3 sm:p-4 [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Upload className="h-4 w-4 text-emerald-600" /> Importar áreas (KML ou GeoJSON)
            </DialogTitle>
            <DialogDescription className="text-xs">
              {etapa === "arquivo" && "Etapa 1 de 3 — escolha o arquivo. Nada é gravado nesta etapa."}
              {etapa === "conferencia" && "Etapa 2 de 3 — confira e complete os dados. Só o botão final grava."}
              {etapa === "resultado" && "Etapa 3 de 3 — resultado da importação."}
            </DialogDescription>
          </DialogHeader>

          {etapa === "arquivo" && (
            <div className="min-w-0 space-y-3">
              <div
                data-testid="importacao-dropzone"
                onDragOver={(e) => {
                  e.preventDefault();
                  setArrastando(true);
                }}
                onDragLeave={() => setArrastando(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setArrastando(false);
                  lerArquivo(e.dataTransfer?.files?.[0]);
                }}
                className={`flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed p-6 text-center ${
                  arrastando ? "border-emerald-500 bg-emerald-50" : "border-slate-300 bg-slate-50"
                }`}
              >
                <FileText className="h-8 w-8 text-slate-400" />
                <p className="text-xs text-slate-700">Arraste o arquivo aqui ou</p>
                <Button type="button" size="sm" className="h-8 text-xs" onClick={() => inputRef.current?.click()}>
                  Escolher arquivo
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".kml,.geojson,.json"
                  className="hidden"
                  data-testid="importacao-input-arquivo"
                  onChange={(e) => lerArquivo(e.target.files?.[0])}
                />
                <p className="text-[11px] text-slate-500">
                  Aceita .kml (Google Earth), .geojson e .json com GeoJSON. Até {formatarBytes(LIMITES_ARQUIVO.maxBytes)} e{" "}
                  {LIMITES_ARQUIVO.maxElementos} elementos. Só polígonos viram áreas; pontos e linhas são ignorados.
                </p>
              </div>

              <button type="button" className="text-xs text-emerald-700 underline" onClick={() => setMostrarColar((v) => !v)}>
                {mostrarColar ? "Esconder" : "Ou colar o conteúdo do arquivo"}
              </button>
              {mostrarColar && (
                <div className="space-y-2">
                  <Textarea
                    value={textoColado}
                    onChange={(e) => setTextoColado(e.target.value)}
                    placeholder="Cole aqui um KML (<kml>…) ou um GeoJSON ({ &quot;type&quot;: &quot;FeatureCollection&quot; …})"
                    className="h-32 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={!textoColado.trim()}
                    onClick={() => processarTexto(null, textoColado, new Blob([textoColado]).size)}
                  >
                    Ler texto colado
                  </Button>
                </div>
              )}

              {erroArquivo && (
                <div role="alert" className="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {erroArquivo}
                </div>
              )}

              {arquivo && leitura && (
                <div data-testid="importacao-resumo-arquivo" className="rounded border border-slate-200 p-2 text-xs">
                  <div className="font-semibold text-slate-800">{arquivo.nome}</div>
                  <div className="text-slate-600">
                    {arquivo.formato} · {formatarBytes(arquivo.tamanho)} · {leitura.contagem.elementos} elemento(s):{" "}
                    {leitura.contagem.areas} área(s), {leitura.contagem.ignorados} ignorado(s) (ponto/linha),{" "}
                    {leitura.contagem.invalidos} inválido(s)
                  </div>
                  {leitura.avisosDoArquivo.map((a) => (
                    <div key={a} className="text-amber-700">{a}</div>
                  ))}
                  <div className="mt-2 flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={reiniciar}>
                      Trocar arquivo
                    </Button>
                    <Button type="button" size="sm" className="h-7 bg-emerald-600 text-xs hover:bg-emerald-700" onClick={() => setEtapa("conferencia")}>
                      Conferir áreas
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {etapa === "conferencia" && (
            <div className="min-w-0 space-y-2">
              {empresaMudou && (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
                  <AlertTriangle className="h-4 w-4" /> A empresa selecionada mudou. Esta conferência não vale mais e a gravação está bloqueada.
                  <Button type="button" size="sm" variant="outline" className="h-6 text-xs" onClick={reiniciar}>
                    Recomeçar
                  </Button>
                </div>
              )}
              {!online && (
                <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  Sem conexão. Você pode continuar ajustando a tabela; conferir e importar voltam quando a conexão voltar.
                </div>
              )}

              <div data-testid="importacao-contadores" className="flex min-w-0 flex-wrap gap-1 text-[11px]">
                {[
                  ["Identificados", contadores.identificados, "bg-slate-100 text-slate-700"],
                  ["Áreas", contadores.areas, "bg-slate-100 text-slate-700"],
                  ["Válidas", contadores.validas, "bg-emerald-100 text-emerald-800"],
                  ["Pendentes", contadores.pendentes, "bg-amber-100 text-amber-800"],
                  ["Possíveis duplicadas", contadores.duplicados, "bg-orange-100 text-orange-800"],
                  ["Inválidos", contadores.invalidos, "bg-red-100 text-red-800"],
                  ["Ignorados (ponto/linha)", contadores.ignorados, "bg-slate-100 text-slate-600"],
                  ["Selecionadas", selecionadas.size, "bg-blue-100 text-blue-800"],
                ].map(([rotulo, valor, cls]) => (
                  <span key={rotulo} className={`rounded px-2 py-0.5 ${cls}`}>
                    {rotulo}: <strong data-testid={`contador-${rotulo}`}>{valor}</strong>
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0 h-[200px] sm:h-[260px] lg:h-auto lg:min-h-[260px] lg:order-2">
                  {open && <PreviaImportacaoMapa linhas={linhasNoMapa} foco={foco} onFocar={setFoco} />}
                </div>

                <div className="min-w-0 rounded border border-slate-200 p-2 lg:order-1" data-testid="importacao-massa">
                  <div className="mb-1 text-xs font-semibold text-slate-700">
                    Preencher em massa nas {selecionadas.size} área(s) selecionada(s)
                  </div>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                    <label className="text-[11px] text-slate-600">
                      Setor
                      <SeletorImportacao aria-label="Setor em massa" className={selectClass} value={massa.setor_id ?? ""} onChange={(e) => setMassa((m) => ({ ...m, setor_id: e.target.value }))}>
                        <option value="">—</option>
                        {setores.map((s) => (
                          <option key={s.id} value={s.id}>{s.nome}</option>
                        ))}
                      </SeletorImportacao>
                    </label>
                    <label className="text-[11px] text-slate-600">
                      Tipo de uso
                      <SeletorImportacao aria-label="Tipo de uso em massa" className={selectClass} value={massa.tipo_cultura ?? ""} onChange={(e) => setMassa((m) => ({ ...m, tipo_cultura: e.target.value }))}>
                        <option value="">—</option>
                        {TIPOS_USO.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </SeletorImportacao>
                    </label>
                    <label className="text-[11px] text-slate-600">
                      Tipo de cultura
                      <SeletorImportacao aria-label="Tipo de cultura em massa" className={selectClass} value={massa.tipo_pastagem ?? ""} onChange={(e) => setMassa((m) => ({ ...m, tipo_pastagem: e.target.value }))}>
                        <option value="">—</option>
                        {TIPOS_CULTURAS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </SeletorImportacao>
                    </label>
                    <label className="text-[11px] text-slate-600">
                      Infraestrutura
                      <SeletorImportacao aria-label="Infraestrutura em massa" className={selectClass} value={massa.tipo_infraestrutura ?? ""} onChange={(e) => setMassa((m) => ({ ...m, tipo_infraestrutura: e.target.value }))}>
                        <option value="">—</option>
                        {TIPOS_INFRAESTRUTURA.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </SeletorImportacao>
                    </label>
                    <label className="text-[11px] text-slate-600">
                      Aproveitamento
                      <SeletorImportacao aria-label="Aproveitamento em massa" className={selectClass} value={massa.aproveitamento ?? ""} onChange={(e) => setMassa((m) => ({ ...m, aproveitamento: e.target.value }))}>
                        <option value="">—</option>
                        {APROVEITAMENTO.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </SeletorImportacao>
                    </label>
                    <label className="text-[11px] text-slate-600">
                      Cor
                      <SeletorImportacao aria-label="Cor em massa" className={selectClass} value={massa.cor ?? ""} onChange={(e) => setMassa((m) => ({ ...m, cor: e.target.value }))}>
                        <option value="">—</option>
                        {CORES_DISPONIVEIS.map((c) => (
                          <option key={c.cor} value={c.cor}>{c.nome}</option>
                        ))}
                      </SeletorImportacao>
                    </label>
                    <label className="col-span-2 text-[11px] text-slate-600">
                      Área pastejada/arável (ha)
                      <div className="flex gap-1">
                        <SeletorImportacao
                          aria-label="Modo da área pastejada em massa"
                          className={selectClass}
                          value={massa.area_pastejada === "__total__" ? "__total__" : massa.area_pastejada ? "__valor__" : ""}
                          onChange={(e) =>
                            setMassa((m) => ({ ...m, area_pastejada: e.target.value === "__total__" ? "__total__" : e.target.value === "__valor__" ? "0" : "" }))
                          }
                        >
                          <option value="">—</option>
                          <option value="__total__">Igual à área total de cada uma</option>
                          <option value="__valor__">Valor fixo</option>
                        </SeletorImportacao>
                        {massa.area_pastejada && massa.area_pastejada !== "__total__" && (
                          <Input
                            aria-label="Valor da área pastejada em massa"
                            className="h-7 w-24 text-xs"
                            value={massa.area_pastejada}
                            onChange={(e) => setMassa((m) => ({ ...m, area_pastejada: e.target.value }))}
                          />
                        )}
                      </div>
                    </label>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Button type="button" size="sm" className="h-7 text-xs" disabled={travado || selecionadas.size === 0 || camposEmMassaPreenchidos().length === 0} onClick={pedirAplicacaoEmMassa}>
                      Aplicar à seleção
                    </Button>
                    <span className="mx-1 text-[11px] text-slate-500">Nomes vazios:</span>
                    <Input aria-label="Prefixo para nomes vazios" className="h-7 w-24 text-xs uppercase" value={prefixoNome} onChange={(e) => setPrefixoNome(e.target.value)} />
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={travado} onClick={numerarNomesVazios}>
                      Numerar
                    </Button>
                  </div>
                  {conflitoMassa && (
                    <div role="alert" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                      {conflitoMassa.qtd} área(s) selecionada(s) já têm valor próprio em{" "}
                      {conflitoMassa.campos.map((c) => ROTULOS[c]).join(", ")}.
                      <div className="mt-1 flex gap-1">
                        <Button type="button" size="sm" className="h-6 text-xs" onClick={() => aplicarEmMassa(true)}>Sobrescrever</Button>
                        <Button type="button" size="sm" variant="outline" className="h-6 text-xs" onClick={() => aplicarEmMassa(false)}>Manter valores próprios</Button>
                        <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setConflitoMassa(null)}>Cancelar</Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1 text-xs">
                <Button type="button" size="sm" variant="outline" className="h-6 text-xs" disabled={travado} onClick={() => selecionarTodas(true)}>Marcar todas</Button>
                <Button type="button" size="sm" variant="outline" className="h-6 text-xs" disabled={travado} onClick={() => selecionarTodas(false)}>Desmarcar todas</Button>
                <Button type="button" size="sm" variant="outline" className="h-6 text-xs" disabled={travado} onClick={selecionarSoValidas}>Só as sem pendência</Button>
              </div>

              <div className="max-h-[42vh] min-w-0 overflow-auto rounded border border-slate-200">
                <table className="w-full min-w-[960px] text-xs" data-testid="importacao-tabela">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[11px] text-slate-600">
                    <tr>
                      <th className="p-1"><span className="sr-only">Selecionar</span></th>
                      <th className="p-1">Origem</th>
                      <th className="p-1">Nome *</th>
                      <th className="p-1">Setor *</th>
                      <th className="p-1">Tipo de uso *</th>
                      <th className="p-1">Área total (ha)</th>
                      <th className="p-1">Pastejada/arável (ha)</th>
                      <th className="p-1">Cultura / Infraestrutura</th>
                      <th className="p-1">Aproveit.</th>
                      <th className="p-1">Cor</th>
                      <th className="p-1">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const pend = [...(pendenciasLocais[l.ref] ?? []), ...pendenciasServidor(l.ref)];
                      const infra = l.tipo_cultura === "Infraestrutura";
                      return (
                        <React.Fragment key={l.ref}>
                        <tr
                          data-testid={`linha-${l.ref}`}
                          className={`border-t border-slate-100 align-top ${foco === l.ref ? "bg-orange-50" : ""}`}
                          onClick={() => setFoco(l.ref)}
                        >
                          <td className="p-1">
                            <input type="checkbox" aria-label={`Selecionar ${l.origem}`} checked={selecionadas.has(l.ref)} disabled={travado} onChange={() => alternarSelecao(l.ref)} />
                          </td>
                          <td className="whitespace-nowrap p-1 text-slate-500">{l.origem}</td>
                          <td className="p-1">
                            <Input
                              aria-label={`Nome ${l.origem}`}
                              value={l.nome}
                              disabled={travado}
                              onChange={(e) => alterarLinha(l.ref, "nome", e.target.value)}
                              className={`h-7 min-w-[140px] text-xs uppercase ${celulaInvalida(l.ref, "nome") ? invalidoClass : ""}`}
                            />
                            {l.nomeOrigem === "sugerido" && <div className="text-[10px] text-amber-700">Nome sugerido — confira</div>}
                          </td>
                          <td className="p-1">
                            <SeletorImportacao aria-label={`Setor ${l.origem}`} disabled={travado} className={`${selectClass} ${celulaInvalida(l.ref, "setor_id") ? invalidoClass : ""}`} value={l.setor_id} onChange={(e) => alterarLinha(l.ref, "setor_id", e.target.value)}>
                              <option value="">Selecione</option>
                              {setores.map((s) => (
                                <option key={s.id} value={s.id}>{s.nome}</option>
                              ))}
                            </SeletorImportacao>
                          </td>
                          <td className="p-1">
                            <SeletorImportacao aria-label={`Tipo de uso ${l.origem}`} disabled={travado} className={`${selectClass} ${celulaInvalida(l.ref, "tipo_cultura") ? invalidoClass : ""}`} value={l.tipo_cultura} onChange={(e) => alterarLinha(l.ref, "tipo_cultura", e.target.value)}>
                              <option value="">Selecione</option>
                              {TIPOS_USO.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </SeletorImportacao>
                          </td>
                          <td className="whitespace-nowrap p-1 text-right tabular-nums" data-testid={`hectares-${l.ref}`}>
                            {formatHectaresPt(l.hectares)}
                            {infra && <div className="text-[10px] text-slate-500">grava 0 ha (infraestrutura)</div>}
                          </td>
                          <td className="p-1">
                            {infra ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <Input
                                aria-label={`Área pastejada ${l.origem}`}
                                value={l.area_pastejada}
                                disabled={travado}
                                placeholder={l.tipo_cultura === "Reserva" || l.tipo_cultura === "APP" ? "0 se não houver" : "ha"}
                                onChange={(e) => alterarLinha(l.ref, "area_pastejada", e.target.value)}
                                className={`h-7 w-24 text-xs ${celulaInvalida(l.ref, "area_pastejada") ? invalidoClass : ""}`}
                              />
                            )}
                          </td>
                          <td className="p-1">
                            {infra ? (
                              <SeletorImportacao aria-label={`Infraestrutura ${l.origem}`} disabled={travado} className={`${selectClass} ${celulaInvalida(l.ref, "tipo_infraestrutura") || celulaInvalida(l.ref, "tipo_pastagem") ? invalidoClass : ""}`} value={l.tipo_infraestrutura} onChange={(e) => alterarLinha(l.ref, "tipo_infraestrutura", e.target.value)}>
                                <option value="">Selecione</option>
                                {TIPOS_INFRAESTRUTURA.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </SeletorImportacao>
                            ) : (
                              <SeletorImportacao aria-label={`Tipo de cultura ${l.origem}`} disabled={travado} className={`${selectClass} ${celulaInvalida(l.ref, "tipo_pastagem") ? invalidoClass : ""}`} value={l.tipo_pastagem} onChange={(e) => alterarLinha(l.ref, "tipo_pastagem", e.target.value)}>
                                <option value="">{l.tipo_cultura === "Reserva" || l.tipo_cultura === "APP" ? "Opcional" : "Selecione"}</option>
                                {TIPOS_CULTURAS.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </SeletorImportacao>
                            )}
                          </td>
                          <td className="p-1">
                            <SeletorImportacao aria-label={`Aproveitamento ${l.origem}`} disabled={travado} className={selectClass} value={l.aproveitamento} onChange={(e) => alterarLinha(l.ref, "aproveitamento", e.target.value)}>
                              {APROVEITAMENTO.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </SeletorImportacao>
                          </td>
                          <td className="p-1">
                            <div className="flex items-center gap-1">
                              <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-slate-300" style={{ backgroundColor: l.cor }} />
                              <SeletorImportacao aria-label={`Cor ${l.origem}`} disabled={travado} className={selectClass} value={l.cor} onChange={(e) => alterarLinha(l.ref, "cor", e.target.value)}>
                                {CORES_DISPONIVEIS.map((c) => (
                                  <option key={c.cor} value={c.cor}>{c.nome}</option>
                                ))}
                              </SeletorImportacao>
                            </div>
                          </td>
                          <td className="whitespace-nowrap p-1" data-testid={`estado-${l.ref}`}>
                            {pend.length === 0 ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" /> {conferenciaAtual?.porRef?.[l.ref]?.ok ? "Conferida" : "Sem pendência"}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-700">
                                <XCircle className="h-3 w-3" /> {pend.length} pendência(s)
                              </span>
                            )}
                          </td>
                        </tr>
                        {(pend.length > 0 || l.avisos.length > 0) && (
                          <tr className={foco === l.ref ? "bg-orange-50" : ""}>
                            <td />
                            <td colSpan={10} className="px-1 pb-1" data-testid={`situacao-${l.ref}`}>
                              {pend.length > 0 && (
                                <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-red-700">
                                  {pend.map((p, i) => (
                                    <li key={`${p.campo}-${i}`}>
                                      <strong>{ROTULOS[p.campo] ?? p.campo}:</strong> {p.mensagem}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {l.avisos.map((a) => (
                                <div key={a} className="text-[10px] text-amber-700">{a}</div>
                              ))}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {naoImportaveis.length > 0 && (
                <details className="rounded border border-slate-200 p-2 text-xs" data-testid="importacao-nao-importaveis">
                  <summary className="cursor-pointer text-slate-700">
                    {naoImportaveis.length} elemento(s) não importável(is) — ver motivo
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {naoImportaveis.map((i) => (
                      <li key={i.ref} className={i.situacao === "ignorado" ? "text-slate-500" : "text-red-700"}>
                        <MinusCircle className="mr-1 inline h-3 w-3" />
                        {i.origem}
                        {i.nomeNoArquivo ? ` (${i.nomeNoArquivo})` : ""}: {i.motivo}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {mensagem && (
                <div
                  role="status"
                  data-testid="importacao-mensagem"
                  className={`rounded border p-2 text-xs ${
                    mensagem.tipo === "erro"
                      ? "border-red-300 bg-red-50 text-red-800"
                      : mensagem.tipo === "aviso"
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-emerald-300 bg-emerald-50 text-emerald-800"
                  }`}
                >
                  {mensagem.texto}
                </div>
              )}

              {bloqueios.length > 0 && estado !== "desconhecido" && (
                <ul data-testid="importacao-bloqueios" className="list-inside list-disc text-[11px] text-slate-600">
                  {bloqueios.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}

              <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t bg-white pt-2">
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={estado === "gravando"} onClick={() => fechar(false)}>
                  Cancelar
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={estado !== "livre"} onClick={reiniciar}>
                  <RotateCcw className="mr-1 h-3 w-3" /> Outro arquivo
                </Button>
                {estado === "desconhecido" ? (
                  <Button type="button" size="sm" className="h-8 bg-amber-600 text-xs hover:bg-amber-700" disabled={!online || empresaMudou} onClick={enviarImportacao}>
                    Verificar e concluir
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={!podeConferir} onClick={conferirSelecao}>
                      {estado === "conferindo" ? "Conferindo…" : `Conferir seleção (${selecionadas.size})`}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 bg-emerald-600 text-xs hover:bg-emerald-700"
                      disabled={!podeImportar}
                      title={bloqueios[0] ?? ""}
                      onClick={() => setConfirmando(true)}
                    >
                      {estado === "gravando" ? "Gravando…" : `Importar ${selecionadas.size} área(s)`}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {etapa === "resultado" && resultado && (
            <div className="min-w-0 space-y-2 text-xs" data-testid="importacao-resultado">
              <div className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-emerald-800">
                <CheckCircle2 className="h-4 w-4" /> {resultado.gravadas} área(s) gravada(s) de uma vez.
                {resultado.replay ? " (a gravação já tinha sido concluída; nada foi duplicado)" : ""}
              </div>
              <div className="text-slate-600">
                Não importados: {linhas.length - resultado.gravadas} área(s) não selecionada(s), {leitura?.contagem?.ignorados ?? 0} ponto(s)/linha(s) ignorado(s),{" "}
                {leitura?.contagem?.invalidos ?? 0} elemento(s) inválido(s).
              </div>
              <div className="max-h-[40vh] overflow-auto rounded border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-left text-[11px] text-slate-600">
                    <tr>
                      <th className="p-1">Nº</th>
                      <th className="p-1">Nome</th>
                      <th className="p-1">Setor</th>
                      <th className="p-1 text-right">Área (ha)</th>
                      <th className="p-1">Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(resultado.importadas ?? []).map((a) => (
                      <tr key={a.id} className="border-t border-slate-100">
                        <td className="p-1">{a.numero_area}</td>
                        <td className="p-1">{a.nome}</td>
                        <td className="p-1">{a.setor_nome}</td>
                        <td className="p-1 text-right tabular-nums">{formatHectaresPt(Number(a.tamanho_hectares))}</td>
                        <td className="p-1 text-slate-500">{linhas.find((l) => l.ref === a.ref)?.origem ?? a.ref}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t pt-2">
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={reiniciar}>
                  Importar outro arquivo
                </Button>
                <Button type="button" size="sm" className="h-8 bg-emerald-600 text-xs hover:bg-emerald-700" onClick={() => fechar(false)}>
                  Ver áreas cadastradas
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gravar {selecionadas.size} área(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              A gravação é tudo ou nada: ou as {selecionadas.size} áreas selecionadas são criadas, ou nenhuma é. Áreas não
              selecionadas, pontos e linhas do arquivo não são gravados. Nenhuma área existente é alterada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction className="bg-emerald-600 hover:bg-emerald-700" onClick={enviarImportacao}>
              Gravar áreas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
