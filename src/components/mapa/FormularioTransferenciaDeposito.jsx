import React, { useEffect, useMemo, useRef, useState } from "react";
import { listarTodosLocais, listarTodosProdutos, listarTodosLotesNota } from "@/services/estoqueMapaService";
import { getCurrentUser } from "@/services/sessionService";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import B1Select from "@/components/cadastro/base1/B1Select";
import LancField from "@/components/cadastro/base1/LancField";
import { LancLoteForm, LancLoteGrade, LancLoteAviso, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import AutocompleteGenerico from "../financeiro/AutocompleteGenerico";
import { toast } from "sonner";
import {
  normalizeText,
  obterSaldoTransferivelProduto,
  parseNumber,
} from "../suplementacao/estoqueSuplementacaoUtils";
import { registrarTransferenciaEntreLocais } from "@/services/suplementacaoEstoqueService";
import { formatQuantidadeTecnica } from "../suplementacao/formatters";
import { produtoSuportaSacos, sacosParaKg, kgParaSacos } from "../suplementacao/unidadeConversaoUtils";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { listEmpresas } from "@/services/empresaService";
import { hojeNoFuso } from "@/lib/diaCivil";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { invalidarCachesDoMapa } from "./invalidarCachesMapa";

/**
 * D-PROD-268 — `operation_id` PERSISTIDA por envio. Antes cada clique gerava chave nova:
 * se a resposta se perdia (rede, timeout) depois do commit, o reenvio virava SEGUNDA
 * transferência. Agora a chave nasce no primeiro envio de um conteúdo (assinatura dos campos
 * escolhidos) e fica gravada até uma resposta DEFINITIVA do servidor; reenviar o MESMO
 * conteúdo reusa a MESMA chave. Conteúdo diferente = operação nova. Por tenant + usuário +
 * depósito + sentido.
 *
 * Travas contra o reuso errado da chave (revisão da D-PROD-268):
 *  - a pendência VENCE em `JANELA_REENVIO_MS` (15 min, muito acima do pior caso do servidor):
 *    uma transferência legítima igual, lançada mais tarde, nasce com chave nova;
 *  - `replay: true` NUNCA é mostrado como "registrada": avisa que o envio anterior já tinha sido
 *    gravado e nada novo foi gravado; o formulário fica aberto e a pendência é limpa (um novo
 *    envio, consciente, é outra operação);
 *  - `IDEMPOTENCY_CONFLICT` (a chave já foi usada com outro corpo — o rateio FIFO calculado no
 *    navegador muda quando o 1º envio esgotou um lote) prova que o envio anterior chegou ao
 *    servidor: a chave FICA (o reenvio repete o 409, nunca grava a segunda) e a tela manda
 *    conferir o histórico;
 *  - com pendência do mesmo conteúdo e saldo local que já não cobre a quantidade, o aviso é o
 *    mesmo "pode já ter sido registrada" (e não "saldo insuficiente").
 */
export const JANELA_REENVIO_MS = 15 * 60 * 1000;
export const TEXTO_TRANSFERENCIA_TALVEZ_REGISTRADA =
  "Esta transferência pode já ter sido registrada no envio anterior. Confira o histórico do depósito antes de enviar de novo.";
export const TEXTO_TRANSFERENCIA_JA_REGISTRADA =
  "Esta transferência já tinha sido registrada no envio anterior; nada novo foi gravado. Para lançar outra igual, envie de novo.";
const chaveDoEnvioPendente = (escopo, depositoId, direcao) => `maike_transferencia_deposito_envio:${escopo}:${depositoId}:${direcao}`;
const novaChaveDeEnvio = () =>
  `transf-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
/** @typedef {{ assinatura: string, operation_id: string, em: number }} EnvioPendente */
/** Pendência gravada e ainda dentro da janela; vencida (ou sem `em`) é descartada. @returns {EnvioPendente | null} */
const lerEnvioPendente = (chave) => {
  try {
    const dados = JSON.parse(window.localStorage.getItem(chave) || "null");
    if (!dados || typeof dados.assinatura !== "string" || typeof dados.operation_id !== "string") return null;
    if (!Number.isFinite(dados.em) || Date.now() - dados.em > JANELA_REENVIO_MS || dados.em > Date.now() + 60 * 1000) {
      window.localStorage.removeItem(chave);
      return null;
    }
    return dados;
  } catch {
    return null;
  }
};
const gravarEnvioPendente = (chave, dados) => {
  try {
    window.localStorage.setItem(chave, JSON.stringify(dados));
  } catch {
    /* sem storage: vale a chave em memória (ref) */
  }
};
const limparEnvioPendente = (chave) => {
  try {
    window.localStorage.removeItem(chave);
  } catch {
    /* idem */
  }
};
/** Resultado desconhecido (a chave FICA): sem código do servidor (rede/timeout) ou conflito transitório. */
const CODIGOS_QUE_GUARDAM_A_CHAVE = new Set(["CONCURRENCY_CONFLICT", "IDEMPOTENCY_IN_PROGRESS", "INTERNAL_ERROR", "IDEMPOTENCY_CONFLICT"]);
const codigoDoErro = (erro) => (typeof erro?.cause?.code === "string" ? erro.cause.code : null);
/** Resposta DEFINITIVA do servidor (nada a reenviar com esta chave); o resto guarda a chave. */
const respostaDefinitiva = (erro) => {
  const codigo = codigoDoErro(erro);
  return Boolean(codigo) && !CODIGOS_QUE_GUARDAM_A_CHAVE.has(codigo);
};

/**
 * Entrada e Saída do depósito (transferência entre locais de estoque), no desenho do
 * lançamento de manejo (D-PROD-222): `LancLoteForm` com os campos em `LancField`
 * (rótulo dentro da caixa), a grade de duas colunas, o resumo Origem · Destino ·
 * Saldo num `LancLoteAviso` neutro e a ação no `LancLoteRodape` — dentro do
 * `LancLoteDialogo` ela vira o ✕/✓ do cabeçalho; fora dele, o rodapé Cancelar/ação.
 * Os campos, as validações e as mensagens, as conversões (kg/sacas), o envio, o
 * refresh do cache do mapa e as invalidações são os de antes: só a apresentação mudou.
 *
 * @param {{
 *   deposito: any,
 *   initialDirection?: string,
 *   onSuccess?: () => void,
 *   onCancel?: () => void,
 * }} props
 *   `initialDirection`: "entrada" (o depósito recebe de outro local) ou "saida"
 *   (o depósito manda para outro local).
 */
export default function FormularioTransferenciaDeposito({ deposito, initialDirection = "entrada", onSuccess, onCancel }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const direction = initialDirection;
  const [localRelacionadoId, setLocalRelacionadoId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  // A data PADRÃO é o dia civil da FAZENDA (`Empresa.fuso_horario`, D-PROD-155/178), como no
  // lançamento do cocho: o dia em UTC (`toISOString`) gravava a movimentação da noite no dia seguinte.
  // Sem fuso (ou enquanto ele não chega), o relógio do navegador.
  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listEmpresas(),
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const fusoFazenda = useMemo(() => {
    const empresa = (Array.isArray(empresas) ? empresas : []).find((e) => String(e?.id) === String(empresaSelecionadaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresas, empresaSelecionadaId]);
  const hojeFazenda = hojeNoFuso(fusoFazenda);
  const [dataMovimentacao, setDataMovimentacao] = useState(() => hojeNoFuso(null));
  // A data que a pessoa escolheu não é trocada quando o fuso chega; o padrão é aplicado uma vez.
  const dataEditada = useRef(false);
  const padraoDoFusoAplicado = useRef(false);
  useEffect(() => {
    if (!fusoFazenda || padraoDoFusoAplicado.current) return;
    padraoDoFusoAplicado.current = true;
    if (dataEditada.current) return;
    setDataMovimentacao(hojeNoFuso(fusoFazenda));
  }, [fusoFazenda]);
  const [observacoes, setObservacoes] = useState("");
  const [unidadeInput, setUnidadeInput] = useState("KG");
  const [saving, setSaving] = useState(false);
  const envioRef = useRef(/** @type {EnvioPendente | null} */ (null));
  const [aviso, setAviso] = useState(/** @type {string | null} */ (null));

  const { data: user } = useQuery({ queryKey: ["user-transferencia-deposito"], queryFn: () => getCurrentUser() });
  const { data: locais = [] } = useQuery({ queryKey: ["locais-estoque-deposito"], queryFn: () => listarTodosLocais() });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-suplementacao-transferencia", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarTodosProdutos();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotesNota = [] } = useQuery({
    queryKey: ["estoque-lotes-transferencia", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarTodosLotesNota();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId,
  });

  // Local inativo não recebe estoque (o servidor recusa `local_inativo`): fora da lista de DESTINO.
  // Como ORIGEM (entrada) continua, para tirar o saldo que ficou nele.
  const outrosLocais = useMemo(() => {
    return locais
      .filter((l) => l.id !== deposito.local_estoque_id && (direction !== "saida" || l.ativo !== false))
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR", { sensitivity: "base" }));
  }, [locais, deposito.local_estoque_id, direction]);

  const localOrigemId = direction === "entrada" ? localRelacionadoId : deposito.local_estoque_id;
  const localOrigemNome = direction === "entrada"
    ? outrosLocais.find((l) => l.id === localRelacionadoId)?.nome || ""
    : deposito.local_estoque_nome;
  const localDestinoId = direction === "entrada" ? deposito.local_estoque_id : localRelacionadoId;
  const localDestinoNome = direction === "entrada"
    ? deposito.local_estoque_nome
    : outrosLocais.find((l) => l.id === localRelacionadoId)?.nome || "";

  const localFonteId = direction === "entrada" ? localRelacionadoId : deposito.local_estoque_id;
  const localFonteNome = direction === "entrada"
    ? outrosLocais.find((l) => l.id === localRelacionadoId)?.nome || ""
    : deposito.local_estoque_nome;

  // Filter products: only those with saldo in the SOURCE local
  const produtosDisponiveis = useMemo(() => {
    if (!localFonteId) return [];
    return produtos.filter((p) => {
      const tipoUsoNutricaoAnimal = normalizeText(p.tipo_uso || "") === normalizeText("Nutrição Animal");
      if (!tipoUsoNutricaoAnimal) return false;
      return obterSaldoTransferivelProduto({ produto: p, lotesNota, localEstoqueId: localFonteId, localEstoqueNome: localFonteNome }) > 0;
    });
  }, [direction, localRelacionadoId, deposito.local_estoque_id, produtos, lotesNota, localFonteId, localFonteNome]);

  const produtoSelecionado = useMemo(() => produtos.find((p) => p.id === produtoId) || null, [produtos, produtoId]);
  const suportaSacos = useMemo(() => produtoSelecionado ? produtoSuportaSacos(produtoSelecionado) : false, [produtoSelecionado]);
  const pesoPorSaco = Number(produtoSelecionado?.peso_por_saco_kg || 0);

  const saldoDisponivel = useMemo(() => {
    if (!produtoSelecionado || !localOrigemId) return 0;
    return obterSaldoTransferivelProduto({ produto: produtoSelecionado, lotesNota, localEstoqueId: localOrigemId, localEstoqueNome: localOrigemNome });
  }, [produtoSelecionado, localOrigemId, localOrigemNome, lotesNota]);

  const saldoEmSacos = useMemo(() => {
    if (!suportaSacos || pesoPorSaco <= 0) return 0;
    return kgParaSacos(saldoDisponivel, pesoPorSaco);
  }, [saldoDisponivel, suportaSacos, pesoPorSaco]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!localRelacionadoId) return toast.error("Selecione o local.");
    if (!dataMovimentacao) return toast.error("Informe a data da movimentação.");
    if (dataMovimentacao > hojeFazenda) return toast.error("A data da movimentação não pode ser futura.");
    if (!produtoSelecionado) return toast.error("Selecione um produto.");

    const inputNum = parseNumber(quantidade);
    const quantidadeFinal = unidadeInput === "SACO" ? sacosParaKg(inputNum, pesoPorSaco) : inputNum;
    if (quantidadeFinal <= 0) return toast.error("Informe uma quantidade válida.");

    // Mesma chave para o MESMO conteúdo até a resposta definitiva (D-PROD-268), dentro da janela.
    const chaveStorage = chaveDoEnvioPendente(`${user?.cliente_id ?? "-"}:${user?.id ?? user?.usuario_id ?? "-"}`, deposito.id, direction);
    const assinatura = JSON.stringify([empresaSelecionadaId, produtoSelecionado.id, localOrigemId, localDestinoId, quantidadeFinal, dataMovimentacao, observacoes]);
    const daMemoria = envioRef.current?.assinatura === assinatura && Date.now() - envioRef.current.em <= JANELA_REENVIO_MS ? envioRef.current : null;
    const gravado = lerEnvioPendente(chaveStorage);
    const anterior = daMemoria ?? (gravado?.assinatura === assinatura ? gravado : null);

    if (quantidadeFinal > saldoDisponivel) {
      // Com pendência do mesmo conteúdo, o saldo que falta é provavelmente o do envio anterior que gravou.
      if (!anterior) return toast.error("Quantidade maior que o saldo disponível.");
      setAviso(TEXTO_TRANSFERENCIA_TALVEZ_REGISTRADA);
      return toast.warning(TEXTO_TRANSFERENCIA_TALVEZ_REGISTRADA);
    }

    const envio = anterior ?? { assinatura, operation_id: novaChaveDeEnvio(), em: Date.now() };
    envioRef.current = envio;
    gravarEnvioPendente(chaveStorage, envio);
    setAviso(null);

    const recarregar = async () => {
      // O histórico do depósito e o mapa leem primeiro o IndexedDB, e o refresh comum respeita o intervalo
      // de 60 s: sem `force` a transferência recém-gravada não aparecia ao reabrir o histórico.
      await Promise.all([
        refreshMapaCacheEntry("movimentacaoEstoque", empresaSelecionadaId, { force: true }),
        refreshMapaCacheEntry("estoqueLotes", empresaSelecionadaId, { force: true }),
      ]).catch(() => {});
      invalidarCachesDoMapa(queryClient, ["estoque-lotes-transferencia", "saldo-deposito", "cochos-vinculados-deposito", "lotes-nota-suplementacao", "mapa-pontos-supl", "movimentacoes", "produtos", "historico-deposito", "movimentacoes-deposito-detalhe"]);
    };

    setSaving(true);
    try {
      const resposta = await registrarTransferenciaEntreLocais({
        empresaId: empresaSelecionadaId, produto: produtoSelecionado,
        quantidade: quantidadeFinal, localOrigemId, localOrigemNome, localDestinoId, localDestinoNome,
        observacoes: observacoes || `${direction === 'entrada' ? 'Entrada' : 'Saída'} pelo depósito ${deposito.nome_ponto}`, lotesNota,
        dataMovimentacao,
        operationId: envio.operation_id,
      });
      envioRef.current = null;
      limparEnvioPendente(chaveStorage);
      if (resposta?.aguardandoEnvio) {
        // D-PROD-296: sem internet, ficou no aparelho (o motor envia depois com esta chave).
        // O saldo do depósito já mostra o efeito; o histórico mostra quando chegar ao servidor.
        invalidarCachesDoMapa(queryClient, ["estoque-lotes-transferencia", "saldo-deposito", "cochos-vinculados-deposito", "lotes-nota-suplementacao", "mapa-pontos-supl", "produtos"]);
        toast.success("Transferência registrada.");
        onSuccess?.();
        return;
      }
      await recarregar();
      if (resposta?.replay === true) {
        // O servidor devolveu o envio ANTERIOR desta chave: nada novo foi gravado. Não é "registrada".
        setAviso(TEXTO_TRANSFERENCIA_JA_REGISTRADA);
        toast.warning(TEXTO_TRANSFERENCIA_JA_REGISTRADA);
        return;
      }
      toast.success("Transferência registrada.");
      onSuccess?.();
    } catch (error) {
      if (respostaDefinitiva(error)) {
        envioRef.current = null;
        limparEnvioPendente(chaveStorage);
      }
      if (codigoDoErro(error) === "IDEMPOTENCY_CONFLICT") {
        // A chave já está no servidor: o envio anterior chegou. Mostra o que foi gravado; a chave fica.
        await recarregar();
        setAviso(TEXTO_TRANSFERENCIA_TALVEZ_REGISTRADA);
        toast.warning(TEXTO_TRANSFERENCIA_TALVEZ_REGISTRADA);
      } else {
        toast.error(getApiErrorMessage(error, "Erro ao registrar a transferência."));
      }
    } finally {
      setSaving(false);
    }
  };

  // Origem · Destino · Saldo: os mesmos números e textos de antes, numa linha só (quebra entre os itens).
  /** @type {Array<[string, string]>} */
  const resumo = [
    ["Origem", localOrigemNome || "-"],
    ["Destino", localDestinoNome || "-"],
    ["Saldo (kg)", formatQuantidadeTecnica(saldoDisponivel, 3)],
  ];
  if (suportaSacos) resumo.push(["Saldo (sacas)", saldoEmSacos.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })]);

  return (
    <LancLoteForm onSubmit={handleSubmit} data-testid="form-transferencia-deposito">
      <LancLoteGrade>
        <LancField label="Data da movimentação" required>
          <Input type="date" value={dataMovimentacao} max={hojeFazenda} onChange={(e) => { dataEditada.current = true; setDataMovimentacao(e.target.value); }} className={LL_CTL} />
        </LancField>
        <LancField label={direction === "entrada" ? "Local de Origem" : "Local de Destino"} required>
          <AutocompleteGenerico
            items={outrosLocais}
            value={localRelacionadoId}
            onChange={(v) => { setLocalRelacionadoId(v); setProdutoId(""); setQuantidade(""); }}
            placeholder="BUSCAR LOCAL..."
            displayField="nome"
            searchFields={["nome", "numero_local"]}
            className="w-full"
            inputClassName={LL_CTL}
          />
        </LancField>
        {/* Campos de escolha do manejo (B1Select): o painel das listas no desktop e a folha no celular. */}
        <LancField label="Produto de Suplementação" required className="mk-ll__cheio">
          {/* O B1Select chama o onChange também com o item já escolhido (o Select de antes não chamava):
              só um produto DIFERENTE volta a unidade para KG e limpa a quantidade. */}
          <B1Select value={produtoId} onChange={(e) => { const v = e.target.value; if (v === produtoId) return; setProdutoId(v); setUnidadeInput("KG"); setQuantidade(""); }} disabled={!localFonteId} className={LL_CTL}>
            {produtosDisponiveis.map((p) => <option key={p.id} value={p.id}>{p.nome_produto} ({p.unidade_medida || "KG"})</option>)}
          </B1Select>
        </LancField>
        <LancField label="Unidade">
          <B1Select value={unidadeInput} onChange={(e) => setUnidadeInput(e.target.value)} disabled={!suportaSacos} className={LL_CTL}>
            <option value="KG">KG</option>
            {suportaSacos && <option value="SACO">Sacas ({pesoPorSaco} kg/saco)</option>}
          </B1Select>
        </LancField>
        <LancField label={`Quantidade (${unidadeInput === "SACO" ? "sacas" : "kg"})`} required>
          <Input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} type="number" step="0.01" className={LL_CTL} placeholder="0,00" />
        </LancField>
      </LancLoteGrade>

      <LancLoteAviso tom="neutro" data-testid="transferencia-resumo">
        {resumo.map(([rotulo, valor], i) => (
          <React.Fragment key={rotulo}>
            {i > 0 ? <span aria-hidden="true"> · </span> : null}
            <span className="inline-block">{rotulo}: <b className="font-semibold">{valor}</b></span>
          </React.Fragment>
        ))}
      </LancLoteAviso>

      {aviso ? (
        <LancLoteAviso tom="ambar" role="status" data-testid="transferencia-aviso-envio-anterior">
          {aviso}
        </LancLoteAviso>
      ) : null}

      <LancField label="Observações">
        <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className={LL_CTL} />
      </LancField>

      <LancLoteRodape
        onCancelar={onCancel}
        textoAcao={direction === "entrada" ? "Registrar Entrada" : "Registrar Saída"}
        textoEnviando="Salvando..."
        enviando={saving}
      />
    </LancLoteForm>
  );
}