import "@/styles/mapa-cadastro-formularios.css";
/* global google */
import React, { useEffect, useId, useMemo, useState } from "react";
import {
  listarIconesPorTipoEntidade,
  listarTodosPontosSuplementacao,
  listarPontosAtivos,
  listarTodosBebedouros,
  criarPonto,
  atualizarPonto,
  criarPontoSuplementacao,
  atualizarPontoSuplementacao,
  verificarRemocaoSuplementacao,
  removerPontoSuplementacao,
  desfazerCriacaoDePonto,
} from "@/services/mapaService";
import {
  listarTodosProdutos,
  listarTodosLocais,
  criarLocal,
  atualizarLocal,
  buscarLotesNotaPorCriterio,
  atualizarLoteNota,
  listarMovimentacoesRecentes,
  atualizarMovimentacao,
} from "@/services/estoqueMapaService";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/cadastro/base1/SelectDoMotor";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { Check, X } from "lucide-react";
import CapturaGPSPonto from "./CapturaGPSPonto";
import SelecaoAreasMapa from "./SelecaoAreasMapa";
import SelecaoDepositoMapa from "./SelecaoDepositoMapa";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";
import useSetorAreas from "@/hooks/useSetorAreas";
import { atualizarBebedouro, criarBebedouro } from "@/services/bebedouroDataService";
import { BEBEDOURO_ORIGENS_AGUA, BEBEDOURO_TIPOS } from "@/services/bebedouroService";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import LancField from "@/components/cadastro/base1/LancField";
import {
  resolverSuplementacaoDoPonto,
  bebedourosDoPonto,
  categoriaDoRegistroSuplementacao,
  categoriaSuplementacaoDoTipo,
  tipoEhBebedouro,
} from "@/domain/mapa/ligacaoPontoReferencia";
import { montarPayloadBebedouro, montarPayloadSuplementacao } from "@/domain/mapa/payloadsPontoMapa";
import { invalidarCachesDoMapa } from "./invalidarCachesMapa";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

/**
 * D-PROD-178: `capacidade_cocho_kg` (cocho e depósito) é o LIMITE OPERACIONAL —
 * o máximo recomendado pelo proprietário, que pode ser menor que a capacidade
 * física (esta não é armazenada). Mesmo campo e mesmo payload; mudam só os
 * nomes na tela. `estoque_minimo_kg` (depósito) é o gatilho de reposição.
 */
const AJUDA_LIMITE_OPERACIONAL = "Máximo recomendado que você define (pode ser menor que a capacidade física, por exemplo no período chuvoso). Usado para mostrar a ocupação e o excesso.";
const AJUDA_ESTOQUE_MINIMO = "Abaixo deste saldo o mapa avisa para repor.";
// O mínimo é o gatilho de reposição e o limite é o máximo recomendado: um
// mínimo maior ou igual ao limite faz o depósito pedir reposição e acusar
// excesso ao mesmo tempo. É só um AVISO (não bloqueia o salvar): a regra de
// cadastro não muda nesta missão e pontos antigos continuam editáveis.
const MSG_LIGACAO_PENDENTE = "A ligação deste ponto com o cocho/depósito ainda está carregando. Aguarde um instante e salve de novo (se continuar, recarregue a página). Nada foi alterado.";
const MSG_LIGACAO_AMBIGUA = "Há mais de um cocho/depósito com o mesmo nome deste ponto nesta fazenda e não foi possível saber qual é o dele. Nada foi alterado.";
const MSG_TROCA_COM_HISTORICO = "Não é possível trocar o tipo deste ponto: o cocho/depósito dele tem histórico (leituras, lançamentos ou estoque). Nada foi alterado.";
const AVISO_MINIMO_ACIMA_DO_LIMITE = "Atenção: o estoque mínimo está igual ou acima do limite operacional; o mapa vai pedir reposição e acusar excesso ao mesmo tempo.";
/**
 * O `Input` do shadcn é um forwardRef em JS, sem tipos de props: aqui ele é
 * tipado com os atributos do `<input>` (é o que ele repassa) para os campos com
 * texto de ajuda ligado por `aria-describedby`.
 */
const InputComAjuda = /** @type {React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>} */ (/** @type {unknown} */ (Input));


function ProdutoSuplementacaoSelect({ value, onChange }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-suplementacao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarTodosProdutos();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId && produto.tipo_uso === "Nutrição Animal");
    },
    enabled: !!empresaSelecionadaId
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
        <SelectValue placeholder="Selecione o produto" />
      </SelectTrigger>
      <SelectContent>
        {produtos.map((produto) =>
        <SelectItem key={produto.id} value={produto.nome_produto} className="text-xs">
            {produto.nome_produto}
          </SelectItem>
        )}
      </SelectContent>
    </Select>);

}

const createEmptyForm = () => ({
  nome: "",
  sigla: "",
  tipo: "",
  configuracao_icone_id: "",
  observacoes: "",
  produto_padrao: "",
  capacidade_cocho_kg: "",
  setor_id: "",
  area_vinculada_id: "",
  area_vinculada_ids: [],
  deposito_origem_id: "",
  metragem_cocho_m: "",
  cobertura_cocho: "",
  consumo_ideal_por_cabeca_kg: "",
  limite_minimo_consumo: "",
  limite_maximo_consumo: "",
  dias_alerta_reposicao: "3",
  estoque_minimo_kg: "",
  alerta_sem_lancamento_dias: "10",
  tipo_bebedouro: "Bebedouro australiano",
  capacidade_agua_litros: "",
  origem_agua: "Poço",
  dias_limpeza_personalizado: "30",
  dias_inspecao_personalizado: "7"
});

export const FORMULARIO_PONTO_ID = "formulario-ponto-b1";

/**
 * Detalhes do ponto. `layout="registro"` (D-PROD-174): o registro do Cadastro de Pontos — sem cabeçalho e
 * sem botões próprios (quem salva é a barra do motor, pelo form `formId`), campos travados em `readOnly`.
 */
export default function FormularioPonto({
  coordenadas,
  onSave = (gravada) => void gravada,
  onCancel = () => {},
  usarGPS = false,
  item = null,
  onBatchUpdate = null,
  suggestedDepositoId = null,
  layout = "painel",
  formId = FORMULARIO_PONTO_ID,
  readOnly = false,
  onSalvandoChange = null,
}) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const registro = layout === "registro";
  const [areaDetectada, setAreaDetectada] = useState(null);
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [mostrarSelecaoAreasMapa, setMostrarSelecaoAreasMapa] = useState(false);
  const [mostrarSelecaoDepositoMapa, setMostrarSelecaoDepositoMapa] = useState(false);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas || item?.coordenadas || null);
  const tipoAtual = item?.tipo || "";
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: "" });
  const [formData, setFormData] = useState(createEmptyForm());
  const [selecionouSetorManualmente, setSelecionouSetorManualmente] = useState(false);
  const [selecionouAreasManualmente, setSelecionouAreasManualmente] = useState(false);
  const idAjudaLimiteCocho = useId();
  const idAjudaReposicao = useId();
  const idAjudaLimiteDeposito = useId();
  const idAjudaEstoqueMinimo = useId();
  const idAvisoEstoqueMinimo = useId();

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarIconesPorTipoEntidade(null);
      return all.filter((itemIcone) => itemIcone.tipo_entidade === "Ponto" && itemIcone.ativo !== false);
    },
    enabled: true
  });

  // Tipos nativos não dependem de um registro de imagem no cadastro de ícones.
  const tiposPonto = useMemo(() => {
    const opcoes = iconesConfig.map((icone) => ({
      valor: icone.id, categoria: icone.categoria, iconeId: icone.id,
    }));
    for (const categoria of ["Cocho", "Depósito"]) {
      if (!opcoes.some((opcao) => normalizeText(opcao.categoria) === normalizeText(categoria))) {
        opcoes.push({ valor: `nativo:${normalizeText(categoria)}`, categoria, iconeId: "" });
      }
    }
    return opcoes;
  }, [iconesConfig]);
  const tipoSelecionado = formData.configuracao_icone_id ||
    tiposPonto.find((opcao) => normalizeText(opcao.categoria) === normalizeText(formData.tipo))?.valor || "";

  const { setores, areas, getAreasBySetor } = useSetorAreas(empresaSelecionadaId);

  const { data: pontosSuplementacao = [], isSuccess: pontosSuplementacaoLoaded } = useQuery({
    queryKey: ["pontos-suplementacao-form", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarTodosPontosSuplementacao();
      return all.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId
  });

  // Pontos de referência da empresa: dizem de quem é cada lugar, para um
  // cocho/depósito no lugar de OUTRO ponto não ligar a este pelo nome.
  const { data: pontosReferenciaForm = [], isSuccess: pontosReferenciaLoaded } = useQuery({
    queryKey: ["pontos-referencia-form", empresaSelecionadaId],
    queryFn: () => listarPontosAtivos(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId
  });

  const { data: bebedourosForm = [] } = useQuery({
    queryKey: ["bebedouros-form", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarTodosBebedouros();
      return all.filter((bebedouro) => bebedouro.empresa_id === empresaSelecionadaId && bebedouro.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  // Ligação pela regra única (empresa + categoria do tipo ATUAL do ponto + nome;
  // coordenadas desempatam; sigla sozinha nunca liga). O detalhe que a lista do
  // Cadastro de Pontos já resolveu (pontosComDetalhes) usa a mesma regra.
  const ligacaoSuplementacao = useMemo(() => {
    if (!item) return { registro: null, ambiguo: false };
    if (item.detalhe_suplementacao?.id) return { registro: item.detalhe_suplementacao, ambiguo: false };
    // Sem a lista de pontos não dá para saber de quem é cada lugar: a ligação
    // fica PENDENTE (o formulário espera e o salvar recusa) em vez de cair na
    // regra só por nome, que ligaria a sobra ao depósito de outro ponto.
    const precisaLigacao = categoriaSuplementacaoDoTipo(item.tipo) !== null;
    if (precisaLigacao && !pontosReferenciaLoaded) return { registro: null, ambiguo: false, pendente: true };
    return resolverSuplementacaoDoPonto(
      { ...item, empresa_id: item.empresa_id ?? empresaSelecionadaId },
      pontosSuplementacao,
      { outrosPontos: pontosReferenciaForm }
    );
  }, [item, pontosSuplementacao, pontosReferenciaForm, pontosReferenciaLoaded, empresaSelecionadaId]);
  const pontoSuplementacaoExistente = ligacaoSuplementacao.registro;

  // Bebedouro: SOMENTE pelo `ponto_referencia_id` (nome/sigla iguais não ligam).
  const bebedouroExistente = useMemo(() => {
    if (!item?.id) return null;
    return bebedourosDoPonto(item, bebedourosForm)[0] || null;
  }, [item, bebedourosForm]);

  const depositosDisponiveis = useMemo(() => {
    return pontosSuplementacao.filter((ponto) => normalizeText(ponto.categoria_ponto || "") === "DEPOSITO");
  }, [pontosSuplementacao]);



  // Ponto novo: o formulário só volta ao vazio quando o item MUDA — não quando
  // as áreas ou os cochos terminam de carregar (isso apagava o que já fora digitado).
  useEffect(() => {
    if (!item) setFormData(createEmptyForm());
  }, [item]);

  useEffect(() => {
    if (!item) return;

    // Para itens existentes que são cochosD depósitos, aguardar a query carregar antes de popular
    const tipoNorm = normalizeText(item.tipo || "");
    const precisaSupl = tipoNorm.includes("COCHO") || tipoNorm.includes("DEPOSITO");
    if (precisaSupl && (!pontosSuplementacaoLoaded || !pontosReferenciaLoaded)) return;

    const isBatchItem = Boolean(onBatchUpdate);
    setFormData({
      nome: item.nome || "",
      sigla: item.sigla || "",
      tipo: item.tipo || "",
      configuracao_icone_id: item.configuracao_icone_id || "",
      observacoes: item.observacoes || (!isBatchItem ? pontoSuplementacaoExistente?.observacoes : "") || "",
      produto_padrao: item.produto_padrao || (!isBatchItem ? pontoSuplementacaoExistente?.produto_padrao : "") || "",
      capacidade_cocho_kg: item.capacidade_cocho_kg || (!isBatchItem ? pontoSuplementacaoExistente?.capacidade_cocho_kg : "") || "",
      setor_id: item.setor_id || (!isBatchItem ? bebedouroExistente?.setor_id || pontoSuplementacaoExistente?.setor_id : "") || areas.find((area) => area.id === item.area_vinculada_id)?.setor_id || "",
      area_vinculada_id: item.area_vinculada_id || (!isBatchItem ? bebedouroExistente?.pasto_id || pontoSuplementacaoExistente?.area_vinculada_id : "") || "",
      area_vinculada_ids: item.area_vinculada_ids?.length ? item.area_vinculada_ids : (!isBatchItem && bebedouroExistente?.area_vinculada_ids?.length ? bebedouroExistente.area_vinculada_ids : (!isBatchItem && pontoSuplementacaoExistente?.area_vinculada_ids?.length ? pontoSuplementacaoExistente.area_vinculada_ids : [])),
      deposito_origem_id: item.deposito_origem_id || (!isBatchItem ? pontoSuplementacaoExistente?.deposito_origem_id : "") || "",
      metragem_cocho_m: item.metragem_cocho_m || (!isBatchItem ? pontoSuplementacaoExistente?.metragem_cocho_m : "") || "",
      cobertura_cocho: item.cobertura_cocho || (!isBatchItem ? pontoSuplementacaoExistente?.cobertura_cocho : "") || "",
      consumo_ideal_por_cabeca_kg: item.consumo_ideal_por_cabeca_kg || (!isBatchItem ? pontoSuplementacaoExistente?.consumo_ideal_por_cabeca_kg : "") || "",
      limite_minimo_consumo: item.limite_minimo_consumo || (!isBatchItem ? pontoSuplementacaoExistente?.limite_minimo_consumo : "") || "",
      limite_maximo_consumo: item.limite_maximo_consumo || (!isBatchItem ? pontoSuplementacaoExistente?.limite_maximo_consumo : "") || "",
      dias_alerta_reposicao: item.dias_alerta_reposicao || (!isBatchItem ? pontoSuplementacaoExistente?.dias_alerta_reposicao : "") || "3",
      estoque_minimo_kg: item.estoque_minimo_kg || (!isBatchItem ? pontoSuplementacaoExistente?.estoque_minimo_kg : "") || "",
      alerta_sem_lancamento_dias: item.alerta_sem_lancamento_dias || (!isBatchItem ? pontoSuplementacaoExistente?.alerta_sem_lancamento_dias : "") || "10",
      tipo_bebedouro: (!isBatchItem ? bebedouroExistente?.tipo : "") || "Bebedouro australiano",
      capacidade_agua_litros: (!isBatchItem ? bebedouroExistente?.capacidade_litros : "") || "",
      origem_agua: (!isBatchItem ? bebedouroExistente?.origem_agua : "") || "Poço",
      dias_limpeza_personalizado: (!isBatchItem ? bebedouroExistente?.dias_limpeza_personalizado : "") || "30",
      dias_inspecao_personalizado: (!isBatchItem ? bebedouroExistente?.dias_inspecao_personalizado : "") || "7"
    });
  }, [item, pontoSuplementacaoExistente, bebedouroExistente, areas, pontosSuplementacaoLoaded, pontosReferenciaLoaded]);

  const handleCapturaGPS = (localizacao) => {
    setCoordenadasGPS(localizacao);
    setMostrarCapturaGPS(false);
    toast.success("Localização GPS capturada!");
  };

  const toggleAreaVinculada = (areaId, checked) => {
    setSelecionouAreasManualmente(true);
    setFormData((prev) => {
      const atuais = Array.isArray(prev.area_vinculada_ids) ? prev.area_vinculada_ids : [];
      const proximas = checked ? Array.from(new Set([...atuais, areaId])) : atuais.filter((id) => id !== areaId);
      return {
        ...prev,
        area_vinculada_ids: proximas,
        area_vinculada_id: proximas[0] || ""
      };
    });
  };

  useEffect(() => {
    // Só sincroniza setor com área quando não está editando um item existente
    if (item) return;
    const areaPrincipal = areas.find((area) => area.id === formData.area_vinculada_id);
    if (areaPrincipal && formData.setor_id !== areaPrincipal.setor_id) {
      setFormData((prev) => ({ ...prev, setor_id: areaPrincipal.setor_id || "" }));
    }
  }, [areas, formData.area_vinculada_id, formData.setor_id, item]);

  useEffect(() => {
    if (!item && !onBatchUpdate) {
      setSelecionouSetorManualmente(false);
      setSelecionouAreasManualmente(false);
    }
  }, [item, onBatchUpdate, coordenadasGPS, coordenadas]);

  useEffect(() => {
    // Detecção automática de área só para pontos NOVOS (sem item existente)
    if (item) return;
    const pontoCoords = coordenadasGPS || coordenadas;
    if (!pontoCoords || !areas.length) return;

    let detectada = null;

    for (const area of areas) {
      const areaCoords = area.coordenadas?.coords || [];
      if (areaCoords.length < 3) continue;

      const polygon = areaCoords.map((coord) => ({ lat: coord[0] || coord.lat, lng: coord[1] || coord.lng }));
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lat;
        const yi = polygon[i].lng;
        const xj = polygon[j].lat;
        const yj = polygon[j].lng;
        const intersect = yi > pontoCoords.lng !== yj > pontoCoords.lng && pontoCoords.lat < (xj - xi) * (pontoCoords.lng - yi) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }

      if (inside) {
        detectada = area;
        break;
      }
    }

    if (detectada) {
      setAreaDetectada(detectada);
      setFormData((prev) => {
        const proximasMudancas = {};
        const areaIds = Array.isArray(prev.area_vinculada_ids) ? prev.area_vinculada_ids : [];
        const isCochoOuBebedouro = normalizeText(prev.tipo || tipoAtual).includes("COCHO") || normalizeText(prev.tipo || tipoAtual).includes("BEBEDOURO");

        if (detectada.setor_id && (!prev.setor_id || !selecionouSetorManualmente) && prev.setor_id !== detectada.setor_id) {
          proximasMudancas.setor_id = detectada.setor_id;
        }

        if (isCochoOuBebedouro && !selecionouAreasManualmente) {
          const mesmaAreaUnica = areaIds.length === 1 && areaIds[0] === detectada.id;
          if (!mesmaAreaUnica || prev.area_vinculada_id !== detectada.id) {
            proximasMudancas.area_vinculada_id = detectada.id;
            proximasMudancas.area_vinculada_ids = [detectada.id];
          }
        }

        return Object.keys(proximasMudancas).length ? { ...prev, ...proximasMudancas } : prev;
      });
    } else {
      setAreaDetectada(null);
    }
  }, [coordenadasGPS, coordenadas, areas, selecionouSetorManualmente, selecionouAreasManualmente, tipoAtual, item]);



  const ehCocho = normalizeText(formData.tipo).includes("COCHO");
  const ehDeposito = normalizeText(formData.tipo).includes("DEPOSITO");
  const limiteDepositoKg = parseFloat(formData.capacidade_cocho_kg);
  const minimoDepositoKg = parseFloat(formData.estoque_minimo_kg);
  const minimoAcimaDoLimite = ehDeposito && Number.isFinite(limiteDepositoKg) && Number.isFinite(minimoDepositoKg) && limiteDepositoKg > 0 && minimoDepositoKg >= limiteDepositoKg;
  const ehBebedouro = normalizeText(formData.tipo).includes("BEBEDOURO");
  const areasDoSetor = formData.setor_id ? getAreasBySetor(formData.setor_id) : [];

  const createPontoMutation = useMutation({
    mutationFn: async (data) => {
      const configIcone = iconesConfig.find((icone) => icone.id === data.configuracao_icone_id) ||
      iconesConfig.find((icone) => normalizeText(icone.categoria) === normalizeText(data.tipo));
      const novaCategoria = data.tipo_categoria || null;
      const novoEhBebedouro = tipoEhBebedouro(data.tipo);
      const coordenadasPonto = coordenadasGPS || coordenadas;

      // ── Conferências antes de gravar qualquer coisa ──────────────────────
      if (item && ligacaoSuplementacao.pendente) throw new Error(MSG_LIGACAO_PENDENTE);
      if (item && ligacaoSuplementacao.ambiguo) throw new Error(MSG_LIGACAO_AMBIGUA);
      // Trocar o tipo (cocho ↔ depósito, ou deixar de ser cocho/depósito) remove o
      // registro antigo — nunca o reaproveita com outra categoria. Com histórico, bloqueia.
      const suplementacaoAntiga = pontoSuplementacaoExistente;
      const removerSuplementacaoAntiga = Boolean(suplementacaoAntiga) &&
        categoriaDoRegistroSuplementacao(suplementacaoAntiga) !== novaCategoria;
      if (removerSuplementacaoAntiga) {
        try {
          await verificarRemocaoSuplementacao(suplementacaoAntiga);
        } catch (erro) {
          if (erro?.code === "MAPA_DELETE_BLOCKED") throw new Error(MSG_TROCA_COM_HISTORICO);
          throw erro;
        }
      }
      const suplementacaoParaAtualizar = removerSuplementacaoAntiga ? null : suplementacaoAntiga;
      // D-PROD-316: a versão do cocho/depósito que a pessoa abriu; o servidor só grava se ele ainda está nela.
      let versaoDoPonto = suplementacaoParaAtualizar?.updated_date ?? null;

      setProgresso({ show: true, atual: 1, total: 3, mensagem: item ? "Atualizando ponto de referência..." : "Criando ponto de referência..." });

      // `numero_ponto` do ponto de referência é do servidor (sequência do tenant).
      const payloadPonto = {
        nome: data.nome,
        sigla: data.sigla,
        tipo: data.tipo,
        configuracao_icone_id: data.configuracao_icone_id || null,
        icone_url: configIcone?.icone_url || null,
        sub_icone_url: configIcone?.sub_icone_url || null,
        observacoes: data.observacoes,
        empresa_id: empresaSelecionadaId,
        ativo: true,
        cor: configIcone?.cor_padrao || "#0066ff",
        coordenadas: coordenadasPonto
      };

      const pontoReferencia = item ?
      // D-PROD-344: a versão do ponto que a pessoa abriu; o servidor só grava se ele ainda está nela.
      await atualizarPonto(item.id, item.updated_date ? { ...payloadPonto, versao_esperada: item.updated_date } : payloadPonto) :
      await criarPonto(payloadPonto);
      const pontoReferenciaId = pontoReferencia?.id || item?.id;
      /** Local do depósito NOVO, criado pelo servidor junto com o depósito. */
      let localNovo = null;

      try {
        if (novoEhBebedouro || item) {
          const bebedouros = await listarTodosBebedouros();
          const ligados = bebedourosDoPonto({ id: pontoReferenciaId }, bebedouros);
          if (novoEhBebedouro) {
            const payloadBebedouro = montarPayloadBebedouro({
              data, pontoReferenciaId, empresaId: empresaSelecionadaId, areas, setores, coordenadas: coordenadasPonto,
            });
            if (ligados[0]) await atualizarBebedouro(ligados[0].id, payloadBebedouro);
            else await criarBebedouro(payloadBebedouro);
          } else {
            // Deixou de ser bebedouro: o cadastro do bebedouro é inativado (o histórico fica).
            for (const bebedouro of ligados.filter((b) => b.ativo !== false)) {
              await atualizarBebedouro(bebedouro.id, { ativo: false, status: "Inativo" });
            }
          }
        }

        if (removerSuplementacaoAntiga) {
          setProgresso({ show: true, atual: 2, total: 3, mensagem: "Removendo o cocho/depósito anterior..." });
          await removerPontoSuplementacao(suplementacaoAntiga.id);
        }

        if (!novaCategoria) return pontoReferencia;

        setProgresso({ show: true, atual: 2, total: 3, mensagem: novaCategoria === "DEPOSITO" ? "Configurando depósito..." : "Configurando cocho..." });

        const pontosSuplementacaoEmpresa = await listarTodosPontosSuplementacao();
        const pontosAtivosEmpresa = pontosSuplementacaoEmpresa.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.status === "Ativo");
        let localEstoqueId = suplementacaoParaAtualizar?.local_estoque_id || null;
        let localEstoqueNome = suplementacaoParaAtualizar?.local_estoque_nome || null;

        if (novaCategoria === "DEPOSITO") {
          const descricaoLocal = `DEPÓSITO DE SUPLEMENTAÇÃO - ${data.nome}`;

          if (!localEstoqueId && suplementacaoParaAtualizar) {
            const locais = await listarTodosLocais();
            const nomesAntigos = [
              suplementacaoParaAtualizar.local_estoque_nome,
              suplementacaoParaAtualizar.nome_ponto,
              item?.nome
            ].filter(Boolean).map(normalizeText);
            const localExistente = locais.find((local) =>
              nomesAntigos.includes(normalizeText(local.nome)) ||
              nomesAntigos.includes(normalizeText(String(local.descricao || "").replace("DEPÓSITO DE SUPLEMENTAÇÃO -", "")))
            );
            if (localExistente) {
              localEstoqueId = localExistente.id;
              // D-PROD-137 (F6): pelo Mapa Cadastro o servidor só renomeia o local JÁ
              // ligado a um depósito. Depósito legado sem vínculo: grava o vínculo
              // antes de renomear (senão o PATCH do local é recusado com 403).
              const vinculado = await atualizarPontoSuplementacao(suplementacaoParaAtualizar.id, {
                categoria_ponto: "DEPOSITO",
                local_estoque_id: localExistente.id,
                local_estoque_nome: localExistente.nome,
                ...(versaoDoPonto ? { versao_esperada: versaoDoPonto } : {})
              });
              // D-PROD-316: o vínculo é o primeiro passo desta mesma gravação; o próximo vai com a versão nova.
              versaoDoPonto = vinculado?.updated_date ?? null;
            }
          }

          if (localEstoqueId) {
            await atualizarLocal(localEstoqueId, { nome: data.nome, descricao: descricaoLocal });
            localEstoqueNome = data.nome;

            const [lotesEstoque, movimentacoesEstoque] = await Promise.all([
              buscarLotesNotaPorCriterio({ local_estoque_id: localEstoqueId }),
              listarMovimentacoesRecentes()
            ]);

            await Promise.all([
              ...lotesEstoque.map((lote) => atualizarLoteNota(lote.id, { local_estoque_nome: data.nome })),
              ...movimentacoesEstoque
                .filter((mov) => mov.local_estoque_origem === localEstoqueId || mov.local_estoque_destino === localEstoqueId)
                .map((mov) => atualizarMovimentacao(mov.id, {
                  ...(mov.local_estoque_origem === localEstoqueId ? { local_origem: data.nome } : {}),
                  ...(mov.local_estoque_destino === localEstoqueId ? { local_destino: data.nome } : {})
                }))
            ]);
          } else if (!suplementacaoParaAtualizar) {
            // Depósito novo: o servidor cria o local na MESMA transação do depósito,
            // então uma falha do depósito não deixa local órfão.
            localNovo = { nome: data.nome, descricao: descricaoLocal };
          } else {
            const localCriado = await criarLocal({ nome: data.nome, descricao: descricaoLocal });
            localEstoqueId = localCriado.id;
            localEstoqueNome = localCriado.nome;
          }
        }

        // `numero_ponto` do cocho/depósito é do servidor: sequência do tenant, na
        // transação da criação (antes o navegador calculava e colidia no unique).
        const payloadSuplementacao = montarPayloadSuplementacao({
          data,
          empresaId: empresaSelecionadaId,
          areas,
          setores,
          depositoOrigem: depositosDisponiveis.find((ponto) => ponto.id === data.deposito_origem_id) || null,
          localEstoqueId,
          localEstoqueNome,
          coordenadas: coordenadasPonto,
        });

        const registroSuplementacao = suplementacaoParaAtualizar ?
        await atualizarPontoSuplementacao(suplementacaoParaAtualizar.id, versaoDoPonto ? { ...payloadSuplementacao, versao_esperada: versaoDoPonto } : payloadSuplementacao) :
        await criarPontoSuplementacao(localNovo ? { ...payloadSuplementacao, local_estoque: localNovo } : payloadSuplementacao);

        if (novaCategoria === "DEPOSITO") {
          setProgresso({ show: true, atual: 3, total: 3, mensagem: "Atualizando cochos vinculados..." });
          const cochosRelacionados = pontosAtivosEmpresa.filter((ponto) => ponto.deposito_origem_id === registroSuplementacao.id);
          for (const cocho of cochosRelacionados) {
            await atualizarPontoSuplementacao(cocho.id, { deposito_origem_nome: data.nome });
          }
        }

        return pontoReferencia;
      } catch (erro) {
        if (item) throw erro;
        // Ponto NOVO: não deixa o ponto de referência órfão quando o cocho/depósito
        // ou o bebedouro não pôde ser gravado.
        const desfeito = await desfazerCriacaoDePonto({ pontoId: pontoReferenciaId });
        const motivo = erro?.message ? `${erro.message} ` : "";
        throw new Error(desfeito ?
          `${motivo}O ponto não foi cadastrado.` :
          `${motivo}O cadastro do ponto ficou incompleto; confira a lista de pontos antes de tentar de novo.`);
      }
    },
    onSuccess: () => {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
      invalidarCachesDoMapa(queryClient, ["pontos", "pontos-suplementacao-form", "pontos-referencia-form", "mapa-pontos", "mapa-pontos-supl", "pontos-suplementacao", "bebedouros", "bebedouros-form", "locais-estoque", "saldo-deposito", "historico-deposito", "movimentacoes-deposito-detalhe", "mapa-estoque-lotes", "movimentacoes"]);
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success(item ? "Ponto atualizado com sucesso." : "Ponto cadastrado com sucesso.");
      onSave();
    },
    onError: (error) => {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
      // D-PROD-316: o conflito de versão diz quem alterou e quando (a mensagem vem dos detalhes do servidor).
      toast.error(getApiErrorMessage(error, error?.message || "Erro ao salvar o ponto."));
    }
  });

  // A barra do motor (registro) mostra "Salvando…" enquanto o ponto grava (D-PROD-174).
  useEffect(() => {
    onSalvandoChange?.(progresso.show || createPontoMutation.isPending);
  }, [progresso.show, createPontoMutation.isPending, onSalvandoChange]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;

    if (!formData.nome || !formData.tipo) {
      toast.error("Preencha o nome e o tipo do ponto.");
      return;
    }

    if (!coordenadasGPS && !coordenadas) {
      toast.error("Coordenadas não informadas.");
      return;
    }

    if ((ehCocho || ehDeposito || ehBebedouro) && !formData.setor_id) {
      toast.error("Selecione o setor do ponto.");
      return;
    }

    if (ehCocho && !(formData.area_vinculada_ids || []).length) {
      toast.error("Selecione pelo menos uma área do cocho.");
      return;
    }

    if (ehBebedouro && !(formData.area_vinculada_ids || []).length) {
      toast.error("Selecione pelo menos um pasto do bebedouro.");
      return;
    }

    if (ehBebedouro && !formData.capacidade_agua_litros) {
      toast.error("Informe a capacidade de água do bebedouro.");
      return;
    }

    if (ehCocho && !formData.deposito_origem_id) {
      toast.error("Selecione o depósito vinculado ao cocho.");
      return;
    }

    if (ehCocho && !formData.capacidade_cocho_kg) {
      toast.error("Informe o limite operacional do cocho em kg.");
      return;
    }

    if (ehCocho && !formData.metragem_cocho_m) {
      toast.error("Informe a metragem do cocho.");
      return;
    }



    if (ehCocho && !formData.cobertura_cocho) {
      toast.error("Selecione se o cocho é coberto ou não coberto.");
      return;
    }

    if (ehDeposito && !formData.capacidade_cocho_kg) {
      toast.error("Informe o limite operacional do depósito em kg.");
      return;
    }

    if (ehDeposito && !formData.estoque_minimo_kg) {
      toast.error("Informe o estoque mínimo do depósito em kg.");
      return;
    }

    if (onBatchUpdate) {
      onBatchUpdate({
        ...formData,
        nome: formData.nome.toUpperCase(),
        sigla: formData.sigla.toUpperCase(),
        tipo_categoria: ehDeposito ? "DEPOSITO" : ehCocho ? "COCHO" : null
      });
      return;
    }

    createPontoMutation.mutate({
      nome: formData.nome.toUpperCase(),
      sigla: formData.sigla.toUpperCase(),
      tipo: formData.tipo,
      configuracao_icone_id: formData.configuracao_icone_id,
      observacoes: formData.observacoes?.toUpperCase(),
      setor_id: formData.setor_id,
      produto_padrao: ehCocho ? formData.produto_padrao : null,
      capacidade_cocho_kg: formData.capacidade_cocho_kg,
      area_vinculada_id: ehCocho || ehBebedouro ? formData.area_vinculada_ids?.[0] || "" : null,
      area_vinculada_ids: ehCocho || ehBebedouro ? formData.area_vinculada_ids : [],
      deposito_origem_id: ehCocho ? formData.deposito_origem_id : null,
      metragem_cocho_m: ehCocho ? formData.metragem_cocho_m : null,
      cobertura_cocho: ehCocho ? formData.cobertura_cocho : null,
      consumo_ideal_por_cabeca_kg: ehCocho ? formData.consumo_ideal_por_cabeca_kg : null,
      limite_minimo_consumo: ehCocho ? formData.limite_minimo_consumo : null,
      limite_maximo_consumo: ehCocho ? formData.limite_maximo_consumo : null,
      dias_alerta_reposicao: ehCocho ? formData.dias_alerta_reposicao : null,
      estoque_minimo_kg: ehDeposito ? formData.estoque_minimo_kg : null,
      alerta_sem_lancamento_dias: ehCocho ? formData.alerta_sem_lancamento_dias : null,
      tipo_bebedouro: ehBebedouro ? formData.tipo_bebedouro : null,
      capacidade_agua_litros: ehBebedouro ? formData.capacidade_agua_litros : null,
      origem_agua: ehBebedouro ? formData.origem_agua : null,
      dias_limpeza_personalizado: ehBebedouro ? formData.dias_limpeza_personalizado : null,
      dias_inspecao_personalizado: ehBebedouro ? formData.dias_inspecao_personalizado : null,
      tipo_categoria: ehDeposito ? "DEPOSITO" : ehCocho ? "COCHO" : null
    });
  };

  if (mostrarCapturaGPS) {
    return (
      <CapturaGPSPonto
        onCapturar={handleCapturaGPS}
        onCancelar={() => {
          setMostrarCapturaGPS(false);
          if (usarGPS) onCancel();
        }} />);


  }

  if (mostrarSelecaoAreasMapa) {
    return (
      <SelecaoAreasMapa
        selectionMode
        selectedIds={formData.area_vinculada_ids}
        onClose={() => setMostrarSelecaoAreasMapa(false)}
        onConfirmSelection={(ids) => {
          setSelecionouAreasManualmente(true);
          const primeiraArea = areas.find((area) => area.id === ids[0]);
          setFormData((prev) => ({
            ...prev,
            area_vinculada_ids: ids,
            area_vinculada_id: ids[0] || "",
            setor_id: primeiraArea?.setor_id || prev.setor_id
          }));
          setMostrarSelecaoAreasMapa(false);
        }} />);
  }

  if (mostrarSelecaoDepositoMapa) {
    return (
      <SelecaoDepositoMapa
        cochoCoords={coordenadasGPS || coordenadas || item?.coordenadas || null}
        depositoSelecionadoId={formData.deposito_origem_id}
        onSelect={(depositoId) => setFormData((prev) => ({ ...prev, deposito_origem_id: depositoId }))}
        onClose={() => setMostrarSelecaoDepositoMapa(false)}
      />);
  }

  return (
    <>
      <div className={registro ? "w-full" : "bg-card text-card-foreground rounded-xl border shadow-sm border-slate-300"}>
        {registro ? null : (
        <div className="flex flex-col space-y-1.5 p-6 bg-[#FAFCFE] border-b py-1 px-1">
          <div className="text-sm font-semibold text-slate-900">{item ? 'Editar Ponto' : 'Novo Ponto'}</div>
        </div>
        )}
        <div className={registro ? "" : "p-1"}>
          <form id={formId} onSubmit={handleSubmit} className="mk-mapa-form mk-mapa-form--ponto space-y-3" data-testid="b1-form-ponto" data-densidade={registro ? DENSIDADE_BASE1 : undefined}>
          <fieldset disabled={readOnly} className="contents">
        <div className="mk-mapa-form__grid grid grid-cols-1 lg:grid-cols-2 gap-3">
          <FL label="Nome do ponto" required><Input value={formData.nome} onChange={(e) => setFormData((prev) => ({ ...prev, nome: e.target.value }))} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" required /></FL>
          <FL label="Sigla"><Input value={formData.sigla} onChange={(e) => setFormData((prev) => ({ ...prev, sigla: e.target.value }))} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" maxLength={10} /></FL>
        </div>
        <FL label="Ponto de referência" required>
          <Select value={tipoSelecionado} onValueChange={(value) => {const opcao = tiposPonto.find((tipo) => tipo.valor === value);if (opcao) setFormData((prev) => ({ ...prev, configuracao_icone_id: opcao.iconeId, tipo: opcao.categoria }));}}>
            <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione o tipo do ponto" /></SelectTrigger>
            <SelectContent>{tiposPonto.map((opcao) => <SelectItem key={opcao.valor} value={opcao.valor} className="text-xs">{opcao.categoria}</SelectItem>)}</SelectContent>
          </Select>
        </FL>
        <FL label="Observações"><Textarea value={formData.observacoes} onChange={(e) => setFormData((prev) => ({ ...prev, observacoes: e.target.value }))} rows={3} className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>

        {ehCocho &&
            <div className="mk-mapa-form__secao space-y-3 border-t pt-3">
            <div className="text-xs font-semibold text-slate-700">Dados do Cocho</div>
            {areaDetectada && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Área detectada: {areaDetectada.nome}</div>}

            <div className="mk-mapa-form__grid grid grid-cols-1 lg:grid-cols-2 gap-3">
              <FL label="Setor" required>
                <Select value={formData.setor_id || '__none__'} onValueChange={(value) => {
                  setSelecionouSetorManualmente(true);
                  setSelecionouAreasManualmente(true);
                  setFormData((prev) => ({ ...prev, setor_id: value === '__none__' ? '' : value, area_vinculada_id: '', area_vinculada_ids: [] }));
                }}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
                    {setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
              <div className="space-y-1 lg:col-span-2">
                <Label className="text-xs">Áreas vinculadas *</Label>
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-[11px] text-slate-500">Selecione uma ou mais áreas que consomem neste mesmo cocho.</p>
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMostrarSelecaoAreasMapa(true)}>Selecionar no mapa</Button>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-20 overflow-y-auto pr-1">
                    {areasDoSetor.map((area) => {
                        const checked = formData.area_vinculada_ids?.includes(area.id);
                        const nomeArea = area.nome || area.area_vinculada_nome || `ÁREA ${area.numero_area || ''}`.trim();
                        const descricaoMapa = [area.numero_area ? `MAPA ${area.numero_area}` : null, area.setor_nome || null].filter(Boolean).join(" • ");
                        return (
                          <label key={area.id} className="flex items-start gap-2 py-1 text-xs cursor-pointer group">
                          <Checkbox checked={checked} onCheckedChange={(value) => toggleAreaVinculada(area.id, Boolean(value))} className="mt-0.5" />
                          <span className="flex flex-col leading-tight">
                            <span className="font-medium text-slate-700 group-hover:text-emerald-700 transition-colors">{nomeArea}</span>
                            
                          </span>
                        </label>);

                      })}
                  </div>
                </div>
              </div>

              <div className="space-y-1 lg:col-span-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label className="text-xs">Depósito vinculado *</Label>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMostrarSelecaoDepositoMapa(true)}>Selecionar no mapa</Button>
                </div>
                <div className="rounded-md border border-slate-300">
                  <Select value={formData.deposito_origem_id || "__none__"} onValueChange={(value) => setFormData((prev) => ({ ...prev, deposito_origem_id: value === "__none__" ? "" : value }))}>
                    <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione o depósito" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">Selecione o depósito</SelectItem>
                      {depositosDisponiveis.map((deposito) => <SelectItem key={deposito.id} value={deposito.id} className="text-xs">{deposito.nome_ponto}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

              </div>
              <FL label="Produto padrão">
                <ProdutoSuplementacaoSelect value={formData.produto_padrao} onChange={(value) => setFormData((prev) => ({ ...prev, produto_padrao: value }))} />
              </FL>
              <div className="space-y-1.5">
                <FL label="Limite operacional do cocho (kg)" required>
                  <InputComAjuda type="number" step="0.01" value={formData.capacidade_cocho_kg} onChange={(e) => setFormData((prev) => ({ ...prev, capacidade_cocho_kg: e.target.value }))} aria-describedby={idAjudaLimiteCocho} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </FL>
                <p id={idAjudaLimiteCocho} className="px-1 text-[11px] leading-snug text-slate-500">{AJUDA_LIMITE_OPERACIONAL}</p>
              </div>
              <FL label="Metragem do cocho (m)" required>
                <Input type="number" step="0.01" value={formData.metragem_cocho_m} onChange={(e) => setFormData((prev) => ({ ...prev, metragem_cocho_m: e.target.value }))} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
              <FL label="Cobertura" required>
                <Select value={formData.cobertura_cocho} onValueChange={(value) => setFormData((prev) => ({ ...prev, cobertura_cocho: value }))}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Coberto" className="text-xs">Coberto</SelectItem>
                    <SelectItem value="Não Coberto" className="text-xs">Não Coberto</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
              <div className="space-y-1.5">
                <FL label="Dias de alerta para reposição">
                  <InputComAjuda type="number" min="0" step="1" value={formData.dias_alerta_reposicao} onChange={(e) => setFormData((prev) => ({ ...prev, dias_alerta_reposicao: e.target.value }))} placeholder="3" aria-describedby={idAjudaReposicao} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </FL>
                <p id={idAjudaReposicao} className="px-1 text-[11px] leading-snug text-slate-500">Avisa quando o saldo estimado durar este número de dias ou menos. Não muda o percentual de saldo.</p>
              </div>
              <FL label="Alerta sem lançamento (dias)">
                <Input type="number" value={formData.alerta_sem_lancamento_dias} onChange={(e) => setFormData((prev) => ({ ...prev, alerta_sem_lancamento_dias: e.target.value }))} placeholder="10" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
            </div>

            {depositosDisponiveis.length === 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Cadastre primeiro um ponto do tipo depósito para vincular este cocho.</div>}
          </div>
            }

        {ehBebedouro &&
            <div className="mk-mapa-form__secao space-y-3 border-t pt-3">
            <div className="text-xs font-semibold text-slate-700">Dados do Bebedouro</div>
            {areaDetectada && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Área detectada: {areaDetectada.nome}</div>}
            <div className="mk-mapa-form__grid grid grid-cols-1 lg:grid-cols-2 gap-3">
              <FL label="Setor" required>
                <Select value={formData.setor_id || '__none__'} onValueChange={(value) => {
                  setSelecionouSetorManualmente(true);
                  setSelecionouAreasManualmente(true);
                  setFormData((prev) => ({ ...prev, setor_id: value === '__none__' ? '' : value, area_vinculada_id: '', area_vinculada_ids: [] }));
                }}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
                    {setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
              <div className="space-y-1 lg:col-span-2">
                <Label className="text-xs">Pastos vinculados *</Label>
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-[11px] text-slate-500">Selecione um ou mais pastos atendidos por este mesmo bebedouro.</p>
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMostrarSelecaoAreasMapa(true)}>Selecionar no mapa</Button>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-20 overflow-y-auto pr-1">
                    {areasDoSetor.map((area) => {
                      const checked = formData.area_vinculada_ids?.includes(area.id);
                      const nomeArea = area.nome || area.area_vinculada_nome || `ÁREA ${area.numero_area || ''}`.trim();
                      return (
                        <label key={area.id} className="flex items-start gap-2 py-1 text-xs cursor-pointer group">
                          <Checkbox checked={checked} onCheckedChange={(value) => toggleAreaVinculada(area.id, Boolean(value))} className="mt-0.5" />
                          <span className="font-medium text-slate-700 group-hover:text-emerald-700 transition-colors">{nomeArea}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
              <FL label="Tipo do bebedouro" required>
                <Select value={formData.tipo_bebedouro} onValueChange={(value) => setFormData((prev) => ({ ...prev, tipo_bebedouro: value }))}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {["Caixa d’água", "Bebedouro australiano", "Concreto", "Tambor", "Natural", "Outro"].map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
              <FL label="Capacidade de água (litros)" required>
                <Input type="number" step="0.01" value={formData.capacidade_agua_litros} onChange={(e) => setFormData((prev) => ({ ...prev, capacidade_agua_litros: e.target.value }))} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
              <FL label="Origem / tipo de água">
                <Select value={formData.origem_agua} onValueChange={(value) => setFormData((prev) => ({ ...prev, origem_agua: value }))}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {["Poço", "Água encanada", "Mina", "Rio", "Represa", "Rede", "Outro"].map((origem) => <SelectItem key={origem} value={origem} className="text-xs">{origem}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
              <FL label="Rotina de limpeza (dias)">
                <Input type="number" value={formData.dias_limpeza_personalizado} onChange={(e) => setFormData((prev) => ({ ...prev, dias_limpeza_personalizado: e.target.value }))} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
              <FL label="Rotina de inspeção (dias)">
                <Input type="number" value={formData.dias_inspecao_personalizado} onChange={(e) => setFormData((prev) => ({ ...prev, dias_inspecao_personalizado: e.target.value }))} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">Ao salvar, este ponto será criado também no módulo de Gestão de Bebedouros.</div>
          </div>
            }

        {ehDeposito &&
            <div className="mk-mapa-form__secao space-y-3 border-t pt-3">
            <div className="text-xs font-semibold text-slate-700">Depósito de Suplementação</div>
            <div className="rounded-lg border border-slate-200 bg-[#FAFCFE] px-3 py-2 text-xs text-slate-700">Ao salvar este ponto, um local de estoque será criado automaticamente para uso exclusivo dos produtos de suplementação.</div>
            <div className="mk-mapa-form__grid grid grid-cols-1 lg:grid-cols-2 gap-3">
              <FL label="Setor" required>
                <Select value={formData.setor_id || '__none__'} onValueChange={(value) => setFormData((prev) => ({ ...prev, setor_id: value === '__none__' ? '' : value }))}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
                    {setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
              <div className="space-y-1.5">
                <FL label="Limite operacional do depósito (kg)" required>
                  <InputComAjuda type="number" step="0.01" value={formData.capacidade_cocho_kg} onChange={(e) => setFormData((prev) => ({ ...prev, capacidade_cocho_kg: e.target.value }))} aria-describedby={idAjudaLimiteDeposito} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </FL>
                <p id={idAjudaLimiteDeposito} className="px-1 text-[11px] leading-snug text-slate-500">{AJUDA_LIMITE_OPERACIONAL}</p>
              </div>
              <div className="space-y-1.5">
                <FL label="Estoque mínimo (kg)" required>
                  <InputComAjuda type="number" step="0.01" value={formData.estoque_minimo_kg} onChange={(e) => setFormData((prev) => ({ ...prev, estoque_minimo_kg: e.target.value }))} aria-describedby={minimoAcimaDoLimite ? `${idAjudaEstoqueMinimo} ${idAvisoEstoqueMinimo}` : idAjudaEstoqueMinimo} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </FL>
                <p id={idAjudaEstoqueMinimo} className="px-1 text-[11px] leading-snug text-slate-500">{AJUDA_ESTOQUE_MINIMO}</p>
                {minimoAcimaDoLimite && <p id={idAvisoEstoqueMinimo} className="px-1 text-[11px] font-medium leading-snug text-amber-800">{AVISO_MINIMO_ACIMA_DO_LIMITE}</p>}
              </div>
            </div>
            {pontoSuplementacaoExistente?.local_estoque_nome && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Local de estoque atual: {pontoSuplementacaoExistente.local_estoque_nome}</div>}
          </div>
            }

          </fieldset>
        {registro ? null : (
        <div className="cadastro-b1 flex justify-end gap-1 pt-1 border-t">
          <button type="button" className="tb-btn tb-btn-gray" onClick={onCancel} disabled={progresso.show}>
            <X className="h-4 w-4" aria-hidden />
            Cancelar
          </button>
          <button type="submit" className="tb-btn tb-btn-green" disabled={progresso.show}>
            <Check className="h-4 w-4" aria-hidden />
            {progresso.show ? "Salvando..." : onBatchUpdate ? "Confirmar ponto no lote" : item ? "Salvar alterações" : "Salvar ponto"}
          </button>
        </div>
        )}
          </form>
        </div>
      </div>

      <Dialog open={progresso.show} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Salvando...</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">{progresso.mensagem}</p>
            <Progress value={progresso.total ? progresso.atual / progresso.total * 100 : 0} className="w-full h-1.5" />
          </div>
        </DialogContent>
      </Dialog>
    </>);

}