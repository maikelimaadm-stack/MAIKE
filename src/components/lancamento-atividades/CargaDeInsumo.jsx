import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, X } from "lucide-react";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { AvisoGestao, CampoSelect, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { AvisoEnvioDaLinha, useEnvioDaLinha, useSaldoDoProduto } from "@/components/lancamento-atividades/JanelasDaLinha";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { parseHorimetroPtBr } from "@/lib/aberturaServicoRegras";
import { rotuloDaUnidade } from "@/lib/abastecimentoRegras";
import {
  LIMITES_LINHA,
  LINHA_PRODUTO,
  formatarDecimalLinha,
  formularioProdutoVazio,
  mensagemDeErroLinha,
  produtoEscolhido,
  validarLinhaProduto,
} from "@/lib/atividadeLinhasRegras";
import { RAIZ_CONSULTAS_ATIVIDADES, chaveApontamentos, itensDaLista, normalizarPaginaDeOpcoes, normalizarRespostaDeEscrita } from "@/lib/atividadeApontamentoRegras";
import { LOCALE_ATIVIDADE } from "@/lib/lancamentoAtividadesRegras";
import { mensagemDeLoteVencido } from "@/lib/estoqueLotesRegras";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { apontamentoDeHoje, linhasDaCarga, localMaisCheio, proximaCarga, subDaCarga, tituloDaCarga } from "@/lib/cargaInsumoRegras";
import {
  ACAO_LANCAR_LINHA,
  adicionarLinha,
  alvoDasLinhas,
  criarApontamento,
  limparPendenciaDaLinha,
  listarApontamentos,
  listarOpcoesProdutos,
} from "@/services/lancamentoAtividadesService";

/** Até quantos produtos cabem numa Mistura (uma carga). */
const MAX_PRODUTOS_NA_CARGA = 10;
/** A mensagem de falha quando a carga nem começou (nada gravado ainda). */
const FALLBACK_LINHA = "Não foi possível lançar o insumo. Nada foi gravado.";
/** O id do formulário: o botão "Salvar carga" fica no rodapé da janela (fora do <form>) e o referencia por `form=`. */
const ID_FORMULARIO = "formulario-carga-insumo";

/** Contador de blocos (a chave de React e o alvo das atualizações, sem depender da posição). */
let sequenciaDoBloco = 0;
/** Um bloco de produto novo (o formulário de linha de produto, mais o identificador do bloco). */
const novoBloco = () => ({ ...formularioProdutoVazio(), uid: ++sequenciaDoBloco });

/** @param {any} o O detalhe da opção de produto (a unidade do cadastro e a marca de já usado). */
const detalheDoProduto = (o) => {
  const unidade = rotuloDaUnidade(o?.unidade_principal_estoque);
  const favorito = o?.favorito === true || o?.usado_na_atividade === true || o?.ja_usado === true;
  return [unidade, favorito ? "já usado nesta atividade" : ""].filter(Boolean).join(" · ") || null;
};

/**
 * Um produto da carga: o seletor (listas reais, paginadas), o saldo e o local, a quantidade e a unidade do cadastro ao
 * lado (só leitura). O saldo é lido aqui (um hook por produto). O produto que controla lote NÃO tem tela de lote nesta
 * janela: o servidor aplica o FEFO na baixa.
 * @param {{
 *   atividadeId: string, bloco: any, indice: number, modo: "produto" | "mistura", erros: Record<string, string>,
 *   bloqueado: boolean, podeRemover: boolean, onMudar: (fn: (b: any) => any) => void, onRemover: () => void,
 * }} props
 */
function BlocoDeProduto({ atividadeId, bloco, indice, modo, erros, bloqueado, podeRemover, onMudar, onRemover }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const saldo = useSaldoDoProduto(empresaId, bloco, onMudar);
  const { consulta, locais, escolhido, unidade } = saldo;
  const rotuloUnidade = rotuloDaUnidade(unidade);
  const testId = `carga-item-${indice}`;
  const { aviso } = validarLinhaProduto(bloco, { disponivel: saldo.disponivel });

  // Mais de um local com saldo: o de MAIOR disponível entra sozinho (o campo de local deixa trocar). Com um só, o hook escolhe.
  useEffect(() => {
    if (!bloco.produto?.id || bloco.local_estoque_id || locais.length < 2) return;
    const local = localMaisCheio(locais);
    if (local) onMudar((f) => (f.produto?.id === bloco.produto.id && !f.local_estoque_id ? { ...f, local_estoque_id: local } : f));
  }, [bloco.produto?.id, bloco.local_estoque_id, locais.length, onMudar]);

  let blocoLocal = null;
  if (bloco.produto?.id && unidade) {
    if (consulta.isError) {
      blocoLocal = (
        <div className="col-span-12">
          <AvisoGestao testId={`${testId}-locais-erro`}>
            Não foi possível ler o saldo deste produto. Confira de novo.{" "}
            <button type="button" className="underline" onClick={() => consulta.refetch()}>
              Tentar novamente
            </button>
          </AvisoGestao>
        </div>
      );
    } else if (consulta.isLoading) {
      blocoLocal = (
        <p role="status" className="b1-carga-nota col-span-12">
          Conferindo o saldo deste produto…
        </p>
      );
    } else if (!locais.length) {
      blocoLocal = (
        <div className="col-span-12">
          <AvisoGestao testId={`${testId}-sem-saldo`}>Sem saldo deste produto nesta fazenda: dê entrada no estoque antes de lançar.</AvisoGestao>
        </div>
      );
    } else {
      blocoLocal = (
        <>
          {locais.length > 1 ? (
            <CampoSelect
              label="Local do estoque"
              value={bloco.local_estoque_id ?? ""}
              onChange={(v) => onMudar((f) => ({ ...f, local_estoque_id: v || null }))}
              options={locais.map((l) => ({ value: String(l.local_estoque_id), label: `${String(l.local_nome ?? "")} (disponível ${formatarDecimalLinha(l.disponivel) || "0"}${rotuloUnidade ? ` ${rotuloUnidade}` : ""})` }))}
              placeholder="— Escolha o local —"
              readOnly={bloqueado}
              required
              span={12}
              error={erros.local_estoque_id}
            />
          ) : null}
          {escolhido ? (
            <p className="b1-carga-nota col-span-12" data-testid={`${testId}-disponivel`}>
              Disponível neste local: {formatarDecimalLinha(escolhido.disponivel) || "0"}
              {rotuloUnidade ? ` ${rotuloUnidade}` : ""} · {String(escolhido.local_nome ?? "")}
            </p>
          ) : null}
        </>
      );
    }
  }

  return (
    <div className="col-span-12 grid grid-cols-12 gap-3" data-testid={testId}>
      {modo === "mistura" ? (
        <div className="col-span-12 flex min-w-0 items-center justify-between gap-2">
          <strong className="text-[13px] font-semibold text-[var(--mg-text-2,#475569)]">Produto {indice + 1}</strong>
          {podeRemover ? (
            <button type="button" className={BOTAO_SECUNDARIO} onClick={onRemover} disabled={bloqueado} data-testid={`${testId}-remover`}>
              <X className="h-4 w-4" aria-hidden />
              Remover
            </button>
          ) : null}
        </div>
      ) : null}
      <SeletorPaginadoGestao
        rotulo="Produto"
        testId={`${testId}-produto`}
        chave={[RAIZ_CONSULTAS_ATIVIDADES, "produtos", empresaId, atividadeId]}
        buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesProdutos(atividadeId, { q, cursor, limit }))}
        value={bloco.produto ? { id: bloco.produto.id, rotulo: bloco.produto.rotulo } : null}
        onChange={(o) => onMudar((f) => ({ ...f, produto: produtoEscolhido(o), local_estoque_id: null, unidade: "", gravado: null }))}
        rotuloDaOpcao={(o) => String(o?.nome ?? "")}
        detalheDaOpcao={detalheDoProduto}
        readOnly={bloqueado}
        obrigatorio
        erro={erros.produto}
        span={12}
        maiusculas={false}
      />
      {blocoLocal}
      <div className="b1-carga-qtd col-span-12">
        <div className="min-w-0">
          <CampoNumero
            label="Quantidade colocada"
            value={bloco.quantidade}
            onChange={(v) => onMudar((f) => ({ ...f, quantidade: v }))}
            locale={LOCALE_ATIVIDADE}
            limites={LIMITES_LINHA}
            readOnly={bloqueado}
            required
            span={12}
            error={erros.quantidade}
            testId={`${testId}-quantidade`}
          />
        </div>
        {/* A unidade vem do cadastro do produto (sem seletor, sem conversão): só leitura. */}
        <span className="b1-carga-un" data-testid={`${testId}-unidade`}>
          {rotuloUnidade || "—"}
        </span>
      </div>
      {aviso ? (
        <div className="col-span-12">
          <AvisoGestao testId={`${testId}-saldo-insuficiente`}>{aviso}</AvisoGestao>
        </div>
      ) : null}
      {erros.lotes ? <p className="col-span-12 -mt-1 text-[12px] text-red-700">{erros.lotes}</p> : null}
    </div>
  );
}

/**
 * D-PROD-334 — a tela "Carga de insumo" (maquete 06), na MESMA janela do serviço aberto. Produto ou Mistura (vários produtos
 * reais na mesma carga: não há cadastro de misturas de insumo). Cada produto vira UMA linha de produto com o número da
 * carga no campo `jato` e, se houver, o horímetro no marcador da observação. Gravação pelas rotas que já existem:
 *  - com o apontamento CONFIRMADO de hoje: `adicionarLinha`, UMA linha por vez, em sequência (a `versao` de cada resposta
 *    vai para a seguinte);
 *  - sem ele (serviço aberto em dia anterior): UM `criarApontamento` com `produtos[]`, atômico.
 * A Mistura não é atômica no caso da sequência: o progresso fica num ref (linhas já gravadas DEFINITIVAMENTE); na
 * retentativa não reenvia o que já saiu, e a falha no meio diz quantos saíram. A baixa de estoque é do servidor (o motor
 * de estoque físico, com FEFO nos produtos com lote); o cliente não calcula nem grava saldo.
 *
 * @param {{
 *   atividadeId: string,
 *   atividadeAreaId: string | null,   // a área (pasto) da atividade, quando ela tem áreas
 *   apontamentos: any[],              // os apontamentos da atividade (a lista da consulta)
 *   hoje: string,                     // o "hoje" da fazenda (AAAA-MM-DD)
 *   implementoNome: string,
 *   podeGravar: boolean,
 *   escopo: string,
 *   alvoRodape: HTMLElement | null,   // o lugar do botão "Salvar carga" no rodapé da janela
 *   onSalvo: (resposta: any) => void,
 * }} props
 */
export default function CargaDeInsumo({ atividadeId, atividadeAreaId, filtrarPorArea = false, onEnviando = undefined, apontamentos, hoje, implementoNome, podeGravar, escopo, alvoRodape, onSalvo }) {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  // Atividade com várias áreas: o destino (e a numeração) é só o apontamento DESTE pasto.
  const areaDoDestino = filtrarPorArea ? atividadeAreaId : null;
  /** O envio guardado deixa de valer quando a pessoa mexe no formulário (a pendência pergunta antes de abandonar). */
  const esquecerRef = useRef(() => {});
  const [modo, setModo] = useState(/** @type {"produto" | "mistura"} */ ("produto"));
  const [blocos, setBlocos] = useState(() => [novoBloco()]);
  const [horimetro, setHorimetro] = useState("");
  const [erroHorimetro, setErroHorimetro] = useState("");
  const [errosPorBloco, setErrosPorBloco] = useState(/** @type {Record<string, Record<string, string>>} */ ({}));
  // A carga é fixa a partir do primeiro envio: a linha gravada muda a "próxima carga" e não pode mudar o número no meio.
  const [cargaFixa, setCargaFixa] = useState(/** @type {number | null} */ (null));
  const carga = cargaFixa ?? proximaCarga(apontamentos, hoje, areaDoDestino);
  /** O progresso da carga: o apontamento de destino (depois de criado), a `versao` atual e os produtos já gravados. */
  const progressoRef = useRef({ apontamentoId: /** @type {string | null} */ (null), versao: /** @type {number | null} */ (null), gravados: /** @type {string[]} */ ([]) });
  /** A mensagem de falha no meio da sequência ("N de M já foram lançados"); null = a mensagem comum. */
  const parcialRef = useRef(/** @type {string | null} */ (null));

  /** Os blocos e os erros de UM bloco (por uid). */
  const mudarBloco = (uid) => (fn) => {
    esquecerRef.current();
    setBlocos((lista) => lista.map((b) => (b.uid === uid ? (() => {
      const nova = fn(b);
      return nova === b ? b : { ...nova, uid };
    })() : b)));
    setErrosPorBloco((e) => (e[uid] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== String(uid))) : e));
  };

  const trocarModo = (novo) => {
    esquecerRef.current();
    setErrosPorBloco({});
    if (novo === "mistura") {
      setBlocos((lista) => (lista.length >= 2 ? lista : [...lista, ...Array.from({ length: 2 - lista.length }, novoBloco)]));
    } else {
      setBlocos((lista) => lista.slice(0, 1));
    }
    setModo(novo);
  };

  const adicionarBloco = () => (esquecerRef.current(), setBlocos((lista) => (lista.length >= MAX_PRODUTOS_NA_CARGA ? lista : [...lista, novoBloco()])));
  const removerBloco = (uid) => (esquecerRef.current(), setBlocos((lista) => (lista.length > 2 ? lista.filter((b) => b.uid !== uid) : lista)));

  /**
   * O envio da carga: sem apontamento de destino, um `criarApontamento` (atômico); com ele, `adicionarLinha` por produto,
   * em sequência. Os produtos já gravados (no progresso) saem da conta; a falha no meio marca o que saiu.
   * @param {any} arg
   * @param {{ retentativa: boolean }} o
   */
  const gravarCarga = async (arg, { retentativa }) => {
    parcialRef.current = null;
    const p = progressoRef.current;
    const pendentes = arg.itens.filter((/** @type {any} */ i) => !p.gravados.includes(i.produtoId));
    const apontamentoId = p.apontamentoId ?? arg.apontamentoId;
    if (!apontamentoId) {
      const resposta = /** @type {any} */ (await criarApontamento(
        arg.atividadeId,
        { data_operacional: arg.dia, ...(arg.atividadeAreaId ? { atividade_area_id: arg.atividadeAreaId } : {}), produtos: pendentes.map((/** @type {any} */ i) => i.corpo) },
        { escopo, retentativa },
      ));
      const norma = normalizarRespostaDeEscrita(resposta);
      if (norma.apontamento?.id == null) throw new Error("O servidor não devolveu o apontamento da carga.");
      progressoRef.current = { apontamentoId: String(norma.apontamento.id), versao: norma.apontamento.versao ?? null, gravados: pendentes.map((/** @type {any} */ i) => i.produtoId) };
      return { ...resposta, avisos: Array.isArray(resposta?.avisos) ? resposta.avisos : [] };
    }
    progressoRef.current = { ...p, apontamentoId, versao: p.apontamentoId ? p.versao : arg.versao };
    /** @type {any} */
    let ultima = null;
    const avisos = [];
    for (const item of pendentes) {
      const atual = progressoRef.current;
      try {
        ultima = /** @type {any} */ (await adicionarLinha(LINHA_PRODUTO, arg.atividadeId, { id: atual.apontamentoId, versao: atual.versao }, item.corpo, { escopo, retentativa }));
      } catch (erro) {
        const feitos = progressoRef.current.gravados.length;
        if (feitos > 0) {
          const total = feitos + pendentes.filter((/** @type {any} */ i) => !progressoRef.current.gravados.includes(i.produtoId)).length;
          parcialRef.current = `${feitos} de ${total} produtos já foram lançados na Carga ${arg.carga}; revise e salve de novo para lançar os restantes.`;
        }
        throw erro;
      }
      const norma = normalizarRespostaDeEscrita(ultima);
      progressoRef.current = {
        apontamentoId: atual.apontamentoId,
        versao: norma.apontamento?.versao ?? atual.versao,
        gravados: [...progressoRef.current.gravados, item.produtoId],
      };
      if (Array.isArray(ultima?.avisos)) avisos.push(...ultima.avisos);
    }
    return { ...(ultima ?? {}), avisos };
  };

  /** Depois de gravar tudo (ou de confirmar pela consulta): aviso, lista atualizada e volta ao serviço. */
  /** @param {any} resposta */
  const concluir = async (resposta) => {
    notifySuccess("Sucesso", `${tituloDaCarga(carga)} lançada.`);
    const alerta = mensagemDeLoteVencido(resposta?.avisos);
    if (alerta) notifyWarning("Lote vencido", alerta);
    await queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, atividadeId) });
    onSalvo(normalizarRespostaDeEscrita(resposta));
  };

  const ultimaArgRef = useRef(/** @type {any} */ (null));
  const { estado, setEstado, disparar, esquecerUltimo } = useEnvioDaLinha(gravarCarga, (erro) =>
    parcialRef.current ?? mensagemDeErroLinha(erro, FALLBACK_LINHA, {}),
  );
  const enviando = estado.fase === "enviando";
  esquecerRef.current = esquecerUltimo;
  // O pai trava o voltar e o fechar enquanto a carga está saindo (senão a janela some com o envio no ar).
  useEffect(() => {
    onEnviando?.(enviando);
    return () => onEnviando?.(false);
  }, [enviando]);

  const salvar = async () => {
    if (enviando || !podeGravar) return;
    // Validação de cada produto (todos os blocos existem e valem) e do produto repetido na mistura.
    /** @type {Record<string, Record<string, string>>} */
    const novos = {};
    const vistos = new Set();
    for (const b of blocos) {
      const v = validarLinhaProduto(b, {});
      const erros = { ...v.erros };
      const produtoId = b.produto?.id != null ? String(b.produto.id) : "";
      if (produtoId && vistos.has(produtoId)) erros.produto = "Este produto já está na mistura.";
      if (produtoId) vistos.add(produtoId);
      if (Object.keys(erros).length) novos[String(b.uid)] = erros;
    }
    const horimetroCanonico = horimetro.trim() ? parseHorimetroPtBr(horimetro) : null;
    const erroH = horimetro.trim() && horimetroCanonico === null ? "Horímetro inválido." : "";
    setErrosPorBloco(novos);
    setErroHorimetro(erroH);
    if (Object.keys(novos).length || erroH) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }

    setCargaFixa(carga);
    const dia = hoje;
    const p = progressoRef.current;
    const pendentes = blocos.filter((b) => !p.gravados.includes(String(b.produto.id)));
    const corpos = linhasDaCarga(pendentes, { carga, horimetro: horimetroCanonico });
    const apontamentoDia = p.apontamentoId ? null : apontamentoDeHoje(apontamentos, dia, areaDoDestino);
    const arg = {
      carga,
      atividadeId,
      atividadeAreaId,
      dia,
      itens: pendentes.map((b, i) => ({ produtoId: String(b.produto.id), corpo: corpos[i] })),
      apontamentoId: p.apontamentoId ?? (apontamentoDia?.id != null ? String(apontamentoDia.id) : null),
      versao: p.apontamentoId ? p.versao : (apontamentoDia?.versao ?? null),
    };
    ultimaArgRef.current = arg;
    const r = await disparar(arg);
    if (!r) return;
    if (r.ok) {
      await concluir(r.resposta);
      return;
    }
    // Falha no meio: os produtos que já saíram somem do formulário (estão em "Lançado hoje"); o resto fica para salvar de novo.
    const gravados = progressoRef.current.gravados;
    if (gravados.length) setBlocos((lista) => lista.filter((b) => !gravados.includes(String(b.produto?.id))));
  };

  /** "Consultar" depois de um envio sem resposta: o que já aparece gravado na carga de hoje conta como gravado. */
  const consultar = async () => {
    try {
      const lista = itensDaLista(await listarApontamentos(atividadeId));
      const ap = apontamentoDeHoje(lista, hoje, areaDoDestino);
      const arg = ultimaArgRef.current;
      const linhasDaCargaGravadas = ap ? (Array.isArray(ap.produtos) ? ap.produtos : []).filter((l) => l?.status === "CONFIRMADO" && String(l.jato) === String(carga)) : [];
      const cobertos = (arg?.itens ?? []).filter((/** @type {any} */ i) => linhasDaCargaGravadas.some((l) => String(l.produto_id) === i.produtoId));
      if (ap && cobertos.length) {
        const ids = cobertos.map((/** @type {any} */ i) => i.produtoId);
        progressoRef.current = { apontamentoId: String(ap.id), versao: ap.versao ?? progressoRef.current.versao, gravados: [...progressoRef.current.gravados, ...ids] };
        limparPendenciaDaLinha(escopo, ACAO_LANCAR_LINHA, alvoDasLinhas(LINHA_PRODUTO, String(ap.id)));
        setBlocos((lista) => lista.filter((b) => !ids.includes(String(b.produto?.id))));
        if (cobertos.length === (arg?.itens ?? []).length) {
          await concluir({ apontamento: ap, atividade: null, avisos: [] });
          return;
        }
        setEstado((e) => ({ ...e, consulta: `Parte da carga já está gravada (${cobertos.length} de ${arg.itens.length}). Repita o mesmo envio para lançar o restante.` }));
        return;
      }
      setEstado((e) => ({ ...e, consulta: "O envio ainda não aparece gravado. Repita o mesmo envio: ele não será duplicado." }));
    } catch {
      setEstado((e) => ({ ...e, consulta: "Não foi possível consultar agora. Tente de novo." }));
    }
  };

  const bloqueado = enviando;
  const pagina = (
    <form
      id={ID_FORMULARIO}
      className="grid grid-cols-12 gap-3 b1-form-embutido b1-realizacao__abertura"
      data-densidade={DENSIDADE_BASE1}
      noValidate
      data-testid="carga-form"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <div className="col-span-12 b1-carga-cab" data-testid="carga-cabecalho">
        <strong>{tituloDaCarga(carga)}</strong>
        <span>{subDaCarga(implementoNome)}</span>
      </div>
      <div className="col-span-12 b1-carga-modo" role="group" aria-label="Tipo de carga">
        <button type="button" className={modo === "produto" ? "on" : undefined} aria-pressed={modo === "produto"} onClick={() => trocarModo("produto")} disabled={bloqueado} data-testid="carga-modo-produto">
          Produto
        </button>
        <button type="button" className={modo === "mistura" ? "on" : undefined} aria-pressed={modo === "mistura"} onClick={() => trocarModo("mistura")} disabled={bloqueado} data-testid="carga-modo-mistura">
          Mistura
        </button>
      </div>
      {blocos.map((b, i) => (
        <BlocoDeProduto
          key={b.uid}
          atividadeId={atividadeId}
          bloco={b}
          indice={i}
          modo={modo}
          erros={errosPorBloco[String(b.uid)] ?? {}}
          bloqueado={bloqueado}
          podeRemover={modo === "mistura" && blocos.length > 2}
          onMudar={mudarBloco(b.uid)}
          onRemover={() => removerBloco(b.uid)}
        />
      ))}
      {modo === "mistura" ? (
        <div className="col-span-12">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={adicionarBloco} disabled={bloqueado || blocos.length >= MAX_PRODUTOS_NA_CARGA} data-testid="carga-adicionar-produto">
            <Plus className="h-4 w-4" aria-hidden />
            Adicionar produto
          </button>
        </div>
      ) : null}
      <CampoTexto
        label="Horímetro (opcional)"
        value={horimetro}
        onChange={(v) => {
          esquecerRef.current();
          setHorimetro(v);
          setErroHorimetro("");
        }}
        error={erroHorimetro || undefined}
        span={12}
        inputMode="decimal"
        keepCase
        readOnly={bloqueado}
        testId="carga-horimetro"
      />
      <div className="col-span-12 min-w-0">
        <AvisoEnvioDaLinha estado={estado} produto onRepetir={() => void salvar()} onConsultar={() => void consultar()} />
      </div>
    </form>
  );

  return (
    <>
      {pagina}
      {alvoRodape
        ? createPortal(
            <button type="submit" form={ID_FORMULARIO} className={`${BOTAO_PRIMARIO} b1-aberto-rodape-unico`} disabled={enviando || !podeGravar} data-testid="carga-salvar">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              {enviando ? "Salvando…" : "Salvar carga"}
            </button>,
            alvoRodape,
          )
        : null}
    </>
  );
}
