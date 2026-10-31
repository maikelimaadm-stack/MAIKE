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
  classificarFalhaDeGravacao,
  conferirNoServidor,
  gravarImportacao,
  itemDeEnvio,
  novaChaveDeImportacao,
  respostaDeGravacaoValida,
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
} from "@/domain/areas/regrasCadastroArea";
import { API_ERROR_CODES, getApiErrorMessage, hasApiErrorCode } from "@/apis/_core/ApiError";
import PreviaImportacaoMapa from "./PreviaImportacaoMapa";
import LinhaImportacao, { ROTULOS, SEM_PENDENCIAS, pendenciasDaLinha } from "./LinhaImportacao";
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
const CODIGOS_DUPLICIDADE = new Set(["AREA_DUPLICADA", "AREA_DUPLICADA_NO_ARQUIVO", "NOME_DUPLICADO_NO_SETOR", "NOME_DUPLICADO_NO_ARQUIVO"]);

const arredondar2 = (n) => Math.round(n * 100) / 100;
const formatarBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const selectClass =
  "h-7 w-full min-w-[110px] rounded border border-slate-300 bg-white px-1 text-xs focus:border-emerald-500 focus:outline-none";

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

/**
 * @param {{ open: boolean, onOpenChange: (aberto: boolean) => void, maxPorLote?: number }} props
 * `maxPorLote` só existe para teste da continuação em lotes com arquivo pequeno;
 * o padrão é o limite do servidor (100), que continua valendo de qualquer forma.
 */
export default function ImportarAreasDialog({ open, onOpenChange, maxPorLote = MAX_AREAS_POR_IMPORTACAO }) {
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
  // Pedido de gravação congelado (chave + empresa + itens exatos). Existe de
  // "gravando" até uma resposta conclusiva; em "desconhecido" é o único que
  // pode ser reenviado — com a mesma chave e o mesmo conteúdo (D-PROD-90 R1).
  const [pendente, setPendente] = useState(
    /** @type {null | {id: string, empresaId: string, itens: any[], assinatura: string}} */ (null)
  );
  // Linhas já gravadas em lotes anteriores deste arquivo: ref → área criada.
  const [gravadas, setGravadas] = useState(() => /** @type {Map<string, any>} */ (new Map()));
  const [lotes, setLotes] = useState(/** @type {{numero: number, gravadas: number, replay: boolean}[]} */ ([]));
  const [confirmarSaida, setConfirmarSaida] = useState(
    /** @type {null | {tipo: 'desconhecido' | 'parcial', acao: 'fechar' | 'reiniciar'}} */ (null)
  );

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
    setPendente(null);
    setGravadas(new Map());
    setLotes([]);
    setConfirmarSaida(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const restantesImportaveis = linhas.filter((l) => !gravadas.has(l.ref)).length;
  const operacaoEmAberto = estado === "gravando" || estado === "desconhecido";

  /** Fecha sem perguntar. Só chamado quando não há nada em aberto ou após confirmação explícita. */
  const sair = () => {
    if (estado === "desconhecido" || lotes.length > 0) {
      // Pode haver áreas novas (lotes gravados, ou o pedido de resultado desconhecido).
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "areas" });
    }
    reiniciar();
    onOpenChange(false);
  };

  /** Esc, clique fora, X e Cancelar passam por aqui. */
  const fechar = (aberto) => {
    if (aberto) return;
    if (estado === "gravando") return;
    if (estado === "desconhecido") {
      setConfirmarSaida({ tipo: "desconhecido", acao: "fechar" });
      return;
    }
    if (lotes.length > 0 && restantesImportaveis > 0) {
      setConfirmarSaida({ tipo: "parcial", acao: "fechar" });
      return;
    }
    sair();
  };

  /** Trocar de arquivo também não pode descartar uma operação em aberto. */
  const reiniciarSeguro = () => {
    if (operacaoEmAberto) return;
    if (lotes.length > 0 && restantesImportaveis > 0) {
      setConfirmarSaida({ tipo: "parcial", acao: "reiniciar" });
      return;
    }
    reiniciar();
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
    setSelecionadas(new Set(novas.slice(0, maxPorLote).map((l) => l.ref)));
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
    for (const l of linhas) mapa[l.ref] = gravadas.has(l.ref) ? [] : pendenciasDaLinha(l, setoresPorId);
    return mapa;
  }, [linhas, setoresPorId, gravadas]);

  const linhasSelecionadas = useMemo(() => linhas.filter((l) => selecionadas.has(l.ref)), [linhas, selecionadas]);
  const itensDaSelecao = useMemo(() => linhasSelecionadas.map(itemDeEnvio), [linhasSelecionadas]);
  const assinaturaAtual = useMemo(
    () => assinaturaDoEnvio(empresaDoArquivo, itensDaSelecao),
    [empresaDoArquivo, itensDaSelecao]
  );
  const conferenciaAtual = conferencia && conferencia.assinatura === assinaturaAtual ? conferencia : null;

  const pendenciasServidor = (ref) => conferenciaAtual?.porRef?.[ref]?.pendencias ?? [];

  // Estado mais recente para callbacks estáveis (as linhas são memorizadas).
  const atualRef = useRef({ operacaoEmAberto: false, gravadas: new Map() });
  atualRef.current = { operacaoEmAberto, gravadas };

  const alterarLinha = useCallback((ref, campo, valor) => {
    const atual = atualRef.current;
    if (atual.operacaoEmAberto || atual.gravadas.has(ref)) return;
    const personalizar = true;
    setLinhas((prev) =>
      prev.map((l) => {
        if (l.ref !== ref) return l;
        const nova = { ...l, [campo]: valor, editados: personalizar ? { ...l.editados, [campo]: true } : l.editados };
        if (campo === "nome") nova.nomeOrigem = "usuario";
        if (campo === "tipo_cultura" && valor === "Infraestrutura") nova.area_pastejada = "";
        return nova;
      })
    );
  }, []);

  const alternarSelecao = useCallback((ref) => {
    const atual = atualRef.current;
    if (atual.operacaoEmAberto || atual.gravadas.has(ref)) return;
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }, []);

  const selecionarTodas = (marcar) => {
    if (operacaoEmAberto) return;
    setSelecionadas(marcar ? new Set(linhas.filter((l) => !gravadas.has(l.ref)).map((l) => l.ref)) : new Set());
  };

  const selecionarSoValidas = () => {
    if (operacaoEmAberto) return;
    setSelecionadas(
      new Set(
        linhas
          .filter((l) => !gravadas.has(l.ref))
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
    if (operacaoEmAberto) return;
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
    if (operacaoEmAberto) return;
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
    const abertas = linhas.filter((l) => !gravadas.has(l.ref));
    const duplicados = abertas.filter((l) => pendenciasServidor(l.ref).some((p) => CODIGOS_DUPLICIDADE.has(p.codigo))).length;
    return {
      identificados: leitura?.contagem?.elementos ?? 0,
      areas: linhas.length,
      gravadas: gravadas.size,
      validas: abertas.filter((l) => com(l.ref) === 0).length,
      pendentes: abertas.filter((l) => com(l.ref) > 0).length,
      invalidos: leitura?.contagem?.invalidos ?? 0,
      ignorados: leitura?.contagem?.ignorados ?? 0,
      duplicados,
    };
  }, [linhas, pendenciasLocais, conferenciaAtual, leitura, gravadas]);

  // ── Bloqueios da gravação ────────────────────────────────────────────────
  const pendentesNaSelecao = linhasSelecionadas.filter((l) => (pendenciasLocais[l.ref] ?? []).length > 0).length;
  const reprovadosNoServidor = conferenciaAtual
    ? linhasSelecionadas.filter((l) => pendenciasServidor(l.ref).length > 0).length
    : 0;
  const bloqueios = [];
  if (!online) bloqueios.push("Sem conexão: a importação precisa do servidor. O rascunho fica nesta tela enquanto ela estiver aberta.");
  if (empresaMudou) bloqueios.push("A empresa selecionada mudou depois que o arquivo foi lido. Recomece a importação.");
  if (selecionadas.size === 0) bloqueios.push("Selecione ao menos uma área.");
  if (selecionadas.size > maxPorLote) {
    bloqueios.push(`Selecione no máximo ${maxPorLote} áreas por importação (há ${selecionadas.size}). Importe o restante em seguida.`);
  }
  if (pendentesNaSelecao > 0) bloqueios.push(`${pendentesNaSelecao} área(s) selecionada(s) com pendência. Corrija ou desmarque.`);
  if (!conferenciaAtual && pendentesNaSelecao === 0 && selecionadas.size > 0) {
    bloqueios.push("Confira a seleção no servidor antes de importar.");
  }
  if (reprovadosNoServidor > 0) bloqueios.push(`${reprovadosNoServidor} área(s) reprovada(s) na conferência do servidor.`);
  const podeConferir =
    online && !empresaMudou && selecionadas.size > 0 && selecionadas.size <= maxPorLote && pendentesNaSelecao === 0 && estado === "livre";
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

  const concluirSucesso = async (r, pedido) => {
    const porRef = new Map((r.importadas ?? []).map((a) => [a.ref, a]));
    const numeroDoLote = lotes.length + 1;
    setGravadas((prev) => {
      const next = new Map(prev);
      for (const item of pedido.itens) next.set(item.ref, { ...porRef.get(item.ref), lote: numeroDoLote });
      return next;
    });
    setLotes((prev) => [...prev, { numero: numeroDoLote, gravadas: pedido.itens.length, replay: Boolean(r.replay) }]);
    setResultado({ ...r, lote: numeroDoLote });
    setSelecionadas(new Set());
    setConferencia(null);
    setOperacao(null);
    setPendente(null);
    setMensagem(null);
    setEtapa("resultado");
    setEstado("livre");
    // Uma vez por lote confirmado — inclusive quando a confirmação veio por replay.
    queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "areas" });
    try {
      await refreshMapaCacheEntry("areas", pedido.empresaId, { force: true });
    } catch {
      /* o Mapa Geral recarrega ao abrir */
    }
    window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["areas"] } }));
  };

  const MENSAGEM_DESCONHECIDO =
    "Resultado desconhecido: não houve resposta confirmando a gravação. As áreas deste lote podem já ter sido criadas. Use “Verificar e concluir”: o reenvio usa a mesma chave e o mesmo conteúdo — se já foi gravado, o servidor devolve o resultado sem duplicar.";

  /** Envia (ou reenvia) exatamente o pedido congelado. */
  const executarGravacao = async (pedido, eraDesconhecido) => {
    setEstado("gravando");
    setMensagem(null);
    let resposta;
    try {
      resposta = await gravarImportacao(pedido.id, pedido.empresaId, pedido.itens);
    } catch (erro) {
      const tipo = classificarFalhaDeGravacao(erro);
      if (tipo === "recusada") {
        // O servidor avaliou o pedido com esta chave e recusou antes de gravar.
        if (hasApiErrorCode(erro, API_ERROR_CODES.AREA_IMPORT_VALIDATION_FAILED)) {
          const itens = /** @type {any} */ (erro)?.details?.itens ?? [];
          setConferencia({ assinatura: pedido.assinatura, porRef: Object.fromEntries(itens.map((i) => [i.ref, i])) });
        }
        if (hasApiErrorCode(erro, API_ERROR_CODES.IDEMPOTENCY_CONFLICT)) setOperacao(null);
        setPendente(null);
        setEstado("livre");
        setMensagem({
          tipo: "erro",
          texto: `Nenhuma área deste lote foi gravada: o servidor recusou o lote antes de gravar. ${getApiErrorMessage(erro, "")}`.trim(),
        });
        return;
      }
      if (tipo === "nao_processada" && !eraDesconhecido) {
        setPendente(null);
        setEstado("livre");
        setMensagem({ tipo: "erro", texto: `${getApiErrorMessage(erro, "Sessão inválida.")} O lote não foi enviado.` });
        return;
      }
      setEstado("desconhecido");
      setMensagem({
        tipo: "aviso",
        texto:
          tipo === "nao_processada"
            ? "A sessão expirou antes de confirmar. Entre de novo e use “Verificar e concluir”. As áreas deste lote podem já ter sido criadas."
            : MENSAGEM_DESCONHECIDO,
      });
      return;
    }
    if (!respostaDeGravacaoValida(resposta, pedido.itens)) {
      setEstado("desconhecido");
      setMensagem({ tipo: "aviso", texto: MENSAGEM_DESCONHECIDO });
      return;
    }
    await concluirSucesso(resposta, pedido);
  };

  const enviarImportacao = async () => {
    setConfirmando(false);
    if (!podeImportar) return;
    // A chave só muda quando o conteúdo muda: o mesmo conteúdo reaproveita a
    // chave (o servidor devolve o que já gravou); conteúdo novo, chave nova.
    const op = operacao && operacao.assinatura === assinaturaAtual ? operacao : { id: novaChaveDeImportacao(), assinatura: assinaturaAtual };
    setOperacao(op);
    const pedido = { id: op.id, empresaId: /** @type {string} */ (empresaDoArquivo), itens: itensDaSelecao, assinatura: assinaturaAtual };
    setPendente(pedido);
    await executarGravacao(pedido, false);
  };

  const verificarEConcluir = async () => {
    if (estado !== "desconhecido" || !pendente || !online) return;
    await executarGravacao(pendente, true);
  };

  /** Próxima rodada do mesmo arquivo: até 100 linhas ainda não gravadas. */
  const continuarComRestantes = () => {
    const abertas = linhas.filter((l) => !gravadas.has(l.ref));
    setSelecionadas(new Set(abertas.slice(0, maxPorLote).map((l) => l.ref)));
    setConferencia(null);
    setOperacao(null);
    setMensagem(null);
    setResultado(null);
    setEtapa("conferencia");
    // Setores podem ter mudado entre os lotes: relê antes da próxima conferência.
    queryClient.invalidateQueries({ queryKey: ["setores-importacao-areas", empresaDoArquivo] });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const naoImportaveis = (leitura?.itens ?? []).filter((i) => i.situacao !== "area");
  const linhasNoMapa = useMemo(
    () => linhas.map((l) => ({ ref: l.ref, nome: l.nome, cor: l.cor, vertices: l.vertices, selecionada: selecionadas.has(l.ref) })),
    [linhas, selecionadas]
  );
  const travado = operacaoEmAberto || empresaMudou;

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
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={reiniciarSeguro}>
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
                  <AlertTriangle className="h-4 w-4" />
                  {estado === "desconhecido"
                    ? "A empresa selecionada mudou, mas a verificação pendente continua na empresa do arquivo. Conclua a verificação antes de recomeçar."
                    : "A empresa selecionada mudou. Esta conferência não vale mais e a gravação está bloqueada."}
                  {!operacaoEmAberto && (
                    <Button type="button" size="sm" variant="outline" className="h-6 text-xs" onClick={reiniciarSeguro}>
                      Recomeçar
                    </Button>
                  )}
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
                  ["Gravadas", contadores.gravadas, "bg-emerald-200 text-emerald-900"],
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
                    {linhas.map((l) => (
                      <LinhaImportacao
                        key={l.ref}
                        l={l}
                        setores={setores}
                        setoresPorId={setoresPorId}
                        pendServidor={conferenciaAtual?.porRef?.[l.ref]?.pendencias ?? SEM_PENDENCIAS}
                        conferida={Boolean(conferenciaAtual?.porRef?.[l.ref]?.ok)}
                        selecionada={selecionadas.has(l.ref)}
                        bloqueada={travado || gravadas.has(l.ref)}
                        gravada={gravadas.get(l.ref)}
                        emFoco={foco === l.ref}
                        onAlterar={alterarLinha}
                        onAlternar={alternarSelecao}
                        onFocar={setFoco}
                      />
                    ))}
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

              <div data-testid="importacao-acoes" className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t bg-white pt-2">
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={estado === "gravando"} onClick={() => fechar(false)}>
                  Cancelar
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={estado !== "livre"} onClick={reiniciarSeguro}>
                  <RotateCcw className="mr-1 h-3 w-3" /> Outro arquivo
                </Button>
                {estado === "desconhecido" ? (
                  <Button type="button" size="sm" className="h-8 bg-amber-600 text-xs hover:bg-amber-700" disabled={!online} onClick={verificarEConcluir}>
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
              <div role="status" className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Lote {resultado.lote}: {resultado.gravadas} área(s) gravada(s) de uma vez.
                  {resultado.replay ? " A gravação já tinha sido concluída antes; nada foi duplicado." : ""}
                </span>
              </div>
              <div data-testid="importacao-acumulado" className="rounded border border-slate-200 p-2 text-slate-700">
                <div>
                  Arquivo: <strong>{leitura?.contagem?.elementos ?? 0}</strong> elemento(s) · áreas importáveis: <strong>{linhas.length}</strong>
                </div>
                <div>
                  Já gravadas: <strong data-testid="acumulado-gravadas">{gravadas.size}</strong> em {lotes.length} lote(s) ·
                  restantes: <strong data-testid="acumulado-restantes">{restantesImportaveis}</strong> · inválidos:{" "}
                  {leitura?.contagem?.invalidos ?? 0} · ignorados (ponto/linha): {leitura?.contagem?.ignorados ?? 0}
                </div>
                <div className="text-[11px] text-slate-500">
                  Cada confirmação grava até {maxPorLote} áreas e é tudo-ou-nada só dentro dela. Lotes já gravados não são
                  desfeitos por uma confirmação seguinte.
                </div>
              </div>
              <div className="max-h-[40vh] overflow-auto rounded border border-slate-200">
                <table className="w-full min-w-[420px] text-xs">
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
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={reiniciarSeguro}>
                  Importar outro arquivo
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => fechar(false)}>
                  Ver áreas cadastradas
                </Button>
                {restantesImportaveis > 0 && (
                  <Button type="button" size="sm" className="h-8 bg-emerald-600 text-xs hover:bg-emerald-700" onClick={continuarComRestantes}>
                    Continuar com áreas restantes ({restantesImportaveis})
                  </Button>
                )}
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
      <AlertDialog open={confirmarSaida !== null} onOpenChange={(v) => !v && setConfirmarSaida(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmarSaida?.tipo === "desconhecido" ? "O resultado ainda é desconhecido" : "Há áreas que ainda não foram importadas"}
            </AlertDialogTitle>
            <AlertDialogDescription data-testid="importacao-confirmar-saida">
              {confirmarSaida?.tipo === "desconhecido"
                ? "O resultado ainda é desconhecido; áreas podem já ter sido criadas. Se sair agora, a verificação com a mesma chave se perde e esta tela não poderá confirmar o que aconteceu — confira a lista de áreas antes de importar de novo."
                : `${gravadas.size} área(s) de lotes anteriores já foram gravadas e continuam gravadas. ${restantesImportaveis} área(s) restantes ainda não foram gravadas e as edições delas serão perdidas.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{confirmarSaida?.tipo === "desconhecido" ? "Continuar verificando" : "Voltar"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                const acao = confirmarSaida?.acao;
                setConfirmarSaida(null);
                if (acao === "reiniciar") {
                  queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "areas" });
                  reiniciar();
                } else sair();
              }}
            >
              {confirmarSaida?.tipo === "desconhecido" ? "Sair sem confirmar" : "Sair mesmo assim"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
