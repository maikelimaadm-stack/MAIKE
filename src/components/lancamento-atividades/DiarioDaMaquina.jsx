import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import DialogoConcluirServico from "@/components/lancamento-atividades/DialogoConcluirServico";
import JanelaLancamentoPorTipo from "@/components/lancamento-atividades/JanelaLancamentoPorTipo";
import JanelaRegistroDeCampo from "@/components/lancamento-atividades/RegistroDeCampo";
import { CHAVE_DIARIO, Nota, Rodape, SecaoEncerrar, SecaoMais, SecaoPasso1, SecaoPasso2, SecaoResumo, SecaoTrocar, BotaoAcao, BotaoVoltar } from "@/components/lancamento-atividades/DiarioSecoes";
import { useVerCusto } from "@/components/lancamento-atividades/VerCusto";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import { RAIZ_CONSULTAS_ATIVIDADES, normalizarPaginaDeOpcoes } from "@/lib/atividadeApontamentoRegras";
import { rotuloDaAreaDaAtividade, areasDaAtividade } from "@/lib/atividadeAreasRegras";
import { LINHA_MAO_OBRA, LINHA_MAQUINA, flagsDoTipoDaAtividade } from "@/lib/atividadeLinhasRegras";
import { mensagemDeErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { QUERY_ATIVIDADES_DA_AREA } from "@/lib/registroDeCampoRegras";
import { corpoDaAplicacao, corpoDaMistura, corpoDaSobra, misturaAberta, resumoDoImplemento, textoDaBarra } from "@/lib/implementoRegras";
import {
  aplicarMistura,
  apontamentoDoDia,
  criarMistura,
  diarioDisponivel,
  listarMisturas,
  lerResumoDoDia,
  registrarSobra,
} from "@/services/diarioMaquinaService";
import { concluirAtividade, listarOpcoesImplementos } from "@/services/lancamentoAtividadesService";

/**
 * O DIÁRIO DA MÁQUINA (D-PROD-314, fases 3 a 7; protótipo v5): UMA janela Base1 (680px; tela cheia no celular) que troca
 * de CONTEÚDO por seção, sem abrir janela sobre janela. As seções: o diário (pasto, máquina, implemento, a barra "no
 * implemento" e os botões), Passo 1 (mistura no implemento), Passo 2 (aplicar no pasto), Mais (abastecer e mão de obra),
 * Trocar pasto (com a sobra e os horímetros), Encerrar o dia e Resumo do dia.
 *
 * Abastecer, mão de obra e o horímetro final abrem a janela de lançamento que já existe (`JanelaLancamentoPorTipo`) NO
 * LUGAR deste diário; "Lançamento de hoje" abre a `JanelaRegistroDeCampo` do mesmo jeito. "Fez o pasto todo? Sim" abre
 * o `DialogoConcluirServico` depois de fechar o diário.
 *
 * DEGRADAÇÃO: sem as rotas novas no servidor (`diarioDisponivel`), a janela mostra o aviso e o "Lançamento de hoje" —
 * o fluxo que já existe, sem mudança.
 *
 * Permissão: quem abre esta janela já passou pela regra de lançar (o mapa e a lista só mostram a ação com ela). Sem
 * permissão de lançar, a janela recusa.
 *
 * @param {{
 *   atividade: any, areaId: string, areaNome?: string, tipos?: any[], onFechar: () => void, onGravou?: () => void,
 * }} props `areaId` é o id da área do mapa onde o pasto está (a área da atividade é achada por ele).
 */
export default function DiarioDaMaquina({ atividade, areaId, areaNome = "", tipos = [], onFechar, onGravou = undefined }) {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const { hoje, fusoOk } = useFusoDaFazenda(empresaId);
  const acoes = useAcoesTelaAtividades();
  const verCusto = useVerCusto();
  const celular = useCelular();
  const { clienteId } = useAuth();
  const atividadeId = atividade?.id ? String(atividade.id) : "";
  const escopo = `${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`;
  const flags = flagsDoTipoDaAtividade(atividade, tipos);
  const podeLancar = acoes?.lancarApontamento === true && Boolean(fusoOk);

  // O pasto atual: começa no da entrada e muda quando a pessoa troca de pasto.
  const [pasto, setPasto] = useState(() => ({ id: String(areaId ?? ""), nome: areaNome || nomeDaAreaNaAtividade(atividade, areaId) }));
  const areasDaAtiv = areasDaAtividade(atividade);
  const areaAtividade = areasDaAtiv.find((a) => String(a.area_id ?? a.area?.id ?? "") === pasto.id) ?? null;
  const areaAtividadeId = areaAtividade ? String(areaAtividade.id) : null;

  const [secao, setSecao] = useState("diario");
  const [externa, setExterna] = useState(/** @type {{ tipo: string, voltar: string } | null} */ (null));
  const [concluindo, setConcluindo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // ─── Consultas (o diário só lê quando as rotas novas estão ligadas) ─────
  const disponivelQ = useQuery({
    queryKey: [CHAVE_DIARIO, "disponivel", atividadeId],
    queryFn: () => diarioDisponivel(atividadeId),
    enabled: Boolean(atividadeId && empresaId),
    staleTime: 5 * 60 * 1000,
  });
  const disponivel = disponivelQ.data === true;
  const indisponivel = disponivelQ.data === false;

  const misturasQ = useQuery({
    queryKey: [CHAVE_DIARIO, "misturas", atividadeId],
    queryFn: () => listarMisturas(atividadeId),
    enabled: disponivel,
  });
  const misturas = Array.isArray(misturasQ.data) ? misturasQ.data : [];
  const aberta = misturaAberta(misturas);
  const resumo = resumoDoImplemento(aberta);

  const diaQ = useQuery({
    queryKey: [CHAVE_DIARIO, "dia", atividadeId, areaAtividadeId, hoje],
    queryFn: () => apontamentoDoDia(atividadeId, areaAtividadeId, hoje),
    enabled: disponivel && Boolean(hoje),
    staleTime: 15 * 1000,
  });
  const dia = diaQ.data ?? null;

  const implementosQ = useQuery({
    queryKey: [CHAVE_DIARIO, "implementos", empresaId],
    queryFn: async () => normalizarPaginaDeOpcoes(await listarOpcoesImplementos({})).itens,
    enabled: disponivel && Boolean(empresaId),
    staleTime: 60 * 1000,
  });
  const implementos = Array.isArray(implementosQ.data) ? implementosQ.data : [];
  const implementoNome = implementos.find((i) => String(i.id) === String(aberta?.implemento_bem_id ?? ""))?.nome ?? "";
  const ultimaImplementoId = misturas.slice().sort((a, b) => (Number(b.numero) || 0) - (Number(a.numero) || 0))[0]?.implemento_bem_id ?? null;
  const maquina = atividade?.bem?.nome ?? atividade?.maquina?.nome ?? "";

  const resumoQ = useQuery({
    queryKey: [CHAVE_DIARIO, "resumo", atividadeId, hoje],
    queryFn: () => lerResumoDoDia(atividadeId, hoje),
    enabled: disponivel && secao === "resumo" && Boolean(hoje),
  });

  const opcoesDePasto = areasDaAtiv
    .filter((a) => String(a.area_id ?? a.area?.id ?? "") !== pasto.id)
    .map((a) => ({ value: String(a.area_id ?? a.area?.id ?? ""), label: rotuloDaAreaDaAtividade(a) }));

  /** O nome do pasto pelo id da área do mapa (para o resumo). @param {unknown} id */
  const nomeDaArea = (id) => nomeDaAreaNaAtividade(atividade, id);

  // ─── Escritas ───────────────────────────────────────────────────────────

  /** Depois de gravar: as consultas do diário e as da tela de atividades (a área, o resumo e os totais) se relêem. */
  const reler = () => {
    void queryClient.invalidateQueries({ queryKey: [CHAVE_DIARIO, "misturas", atividadeId] });
    void queryClient.invalidateQueries({ queryKey: [CHAVE_DIARIO, "dia"] });
    void queryClient.invalidateQueries({ queryKey: [CHAVE_DIARIO, "resumo"] });
    void queryClient.invalidateQueries({ queryKey: [QUERY_ATIVIDADES_DA_AREA] });
    void queryClient.invalidateQueries({ queryKey: [RAIZ_CONSULTAS_ATIVIDADES] });
    onGravou?.();
  };

  /** Uma falha de gravação: a mensagem do servidor (sem R$) e a tela continua como está. @param {unknown} erro @param {string} fallback */
  const falhou = (erro, fallback) => notifyWarning("Não foi possível gravar", mensagemDeErroAtividade(erro, fallback));

  /** Passo 1: a mistura do implemento cheio (não baixa estoque). @param {{ implementoId: string, linhas: any[] }} p */
  const gravarMistura = async ({ implementoId, linhas }) => {
    setEnviando(true);
    try {
      const corpo = corpoDaMistura({
        empresaId: String(empresaId),
        implementoId,
        areaId: pasto.id,
        linhas: linhas.map((l) => ({ produto_id: String(l.produto.id), local_estoque_id: String(l.local_estoque_id), quantidade: String(l.quantidade) })),
      });
      await criarMistura(atividadeId, corpo);
      reler();
      notifySuccess("Sucesso", "Implemento cheio.");
      setSecao("diario");
    } catch (erro) {
      falhou(erro, "A mistura não foi gravada. Confira e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  /** Passo 2: aplica a mistura neste pasto. @param {{ esvaziou: boolean, sobra: string }} p */
  const gravarAplicacao = async ({ esvaziou, sobra }) => {
    if (!aberta || !dia) return;
    setEnviando(true);
    try {
      await aplicarMistura(atividadeId, String(dia.id), String(aberta.id), corpoDaAplicacao({ empresaId: String(empresaId), esvaziou, sobra }));
      reler();
      notifySuccess("Sucesso", esvaziou ? "Aplicação gravada. Implemento esvaziado." : "Aplicação gravada. Sobrou no implemento.");
      setSecao("diario");
    } catch (erro) {
      falhou(erro, "A aplicação não foi gravada. Confira e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  /** Trocar pasto: a sobra vai junto, volta ao depósito ou é perda; o pasto de chegada vira o atual. */
  const trocarPasto = async ({ proximo, sobra, horimetroSaida, horimetroChegada }) => {
    setEnviando(true);
    try {
      if (sobra && aberta) {
        await registrarSobra(
          atividadeId,
          String(aberta.id),
          corpoDaSobra({
            empresaId: String(empresaId),
            tipo: sobra.tipo,
            paraAreaId: proximo,
            apontamentoId: dia?.id ? String(dia.id) : undefined,
            motivo: sobra.motivo,
            horimetroSaida,
            horimetroChegada,
          }),
        );
      }
      reler();
      setPasto({ id: proximo, nome: nomeDaArea(proximo) });
      notifySuccess("Sucesso", `Agora em ${nomeDaArea(proximo)}.`);
      setSecao("diario");
    } catch (erro) {
      falhou(erro, "A troca de pasto não foi gravada. Confira e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  /** Encerrar o dia: o destino da sobra (se houver); "fez o pasto todo" abre a conclusão, depois de fechar o diário. */
  const encerrar = async ({ sobra, fezTodo }) => {
    setEnviando(true);
    try {
      if (sobra && aberta) {
        await registrarSobra(
          atividadeId,
          String(aberta.id),
          corpoDaSobra({ empresaId: String(empresaId), tipo: sobra.tipo, apontamentoId: dia?.id ? String(dia.id) : undefined, motivo: sobra.motivo }),
        );
      }
      reler();
      if (fezTodo) setConcluindo(true);
      else onFechar();
    } catch (erro) {
      falhou(erro, "O dia não foi encerrado. Confira e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  /** "Finalizar" da atividade (o mesmo do menu da lista): `POST /atividades/:id/concluir` com o último dia. */
  const concluir = async (dataConclusao, areas = undefined) => {
    const r = /** @type {any} */ (await concluirAtividade(atividadeId, { versao: atividade.versao, data_conclusao: dataConclusao, ...(areas ? { areas } : {}) }));
    reler();
    onFechar();
    const numero = (r ?? atividade)?.numero;
    notifySuccess("Sucesso", `Atividade ${numero != null ? `nº ${numero} ` : ""}finalizada.`);
  };

  // ─── Janelas que substituem este diário (sem empilhar) ──────────────────

  if (!podeLancar) {
    return (
      <B1Janela aberto onFechar={onFechar} titulo="Diário da máquina" testId="diario-maquina" className={celular ? "b1-janela--tela-cheia" : ""}>
        <AvisoGestao testId="diario-sem-permissao">Você não pode lançar nesta atividade.</AvisoGestao>
        <Rodape>
          <BotaoVoltar onClick={onFechar} testId="diario-fechar" children="Fechar" />
        </Rodape>
      </B1Janela>
    );
  }

  if (externa) {
    return (
      <JanelaLancamentoPorTipo
        key={`externa-${externa.tipo}`}
        atividade={atividade}
        tipo={externa.tipo}
        acoes={acoes}
        flags={flags}
        escopo={escopo}
        onFechar={() => {
          setExterna(null);
          setSecao(externa.voltar);
        }}
        onAtividadeAtualizada={() => reler()}
        areaInicial={areaAtividadeId}
      />
    );
  }

  if (secao === "lancamento") {
    return <JanelaRegistroDeCampo key="lancamento-de-hoje" tipos={tipos} continuar={atividade} onGravou={reler} onFechar={() => setSecao("diario")} />;
  }

  if (concluindo) {
    return <DialogoConcluirServico key="concluir-diario" item={atividade} hoje={hoje} onFechar={onFechar} onConcluir={concluir} />;
  }

  // ─── A janela: uma só, com o conteúdo da seção ─────────────────────────

  const titulos = {
    diario: "Diário da máquina",
    passo1: "Passo 1 · Mistura no implemento",
    passo2: "Passo 2 · Aplicar no pasto",
    mais: "Mais",
    trocar: "Trocar pasto",
    encerrar: "Encerrar o dia",
    resumo: "Resumo do dia",
  };
  const subtitulo = secao === "diario" ? [maquina, implementoNome].filter(Boolean).join(" · ") : pasto.nome;

  const titulo = (
    <span>
      {titulos[secao] ?? titulos.diario}
      {subtitulo ? <small className="block text-[11.5px] font-medium text-[#73726c]">{subtitulo}</small> : null}
    </span>
  );

  let corpo = null;
  let rodape = null;

  if (!atividadeId) {
    corpo = <AvisoGestao testId="diario-sem-atividade">Escolha uma atividade para abrir o diário.</AvisoGestao>;
  } else if (!empresaId) {
    corpo = <AvisoGestao testId="diario-sem-empresa">Selecione uma fazenda para abrir o diário.</AvisoGestao>;
  } else if (disponivelQ.isPending && !disponivelQ.isError) {
    corpo = <Nota testId="diario-carregando">Carregando o diário…</Nota>;
  } else if (disponivelQ.isError) {
    corpo = (
      <div className="flex flex-col gap-3">
        <AvisoGestao testId="diario-sem-conexao">Sem conexão com o servidor. Tente de novo.</AvisoGestao>
        <Rodape>
          <BotaoVoltar onClick={() => void disponivelQ.refetch()} testId="diario-tentar-de-novo" children="Tentar de novo" />
        </Rodape>
      </div>
    );
  } else if (indisponivel) {
    // Degradação: o servidor ainda não tem o diário. O fluxo que já existe continua (o lançamento de hoje).
    corpo = (
      <div className="flex flex-col gap-3" data-testid="diario-indisponivel">
        <AvisoGestao testId="diario-indisponivel-aviso" tone="blue">
          Diário da máquina ainda não está ligado no servidor. Use o lançamento de hoje.
        </AvisoGestao>
        <Rodape>
          <BotaoVoltar onClick={onFechar} testId="diario-fechar" children="Fechar" />
          <BotaoAcao onClick={() => setSecao("lancamento")} testId="diario-lancamento-de-hoje">
            Lançamento de hoje
          </BotaoAcao>
        </Rodape>
      </div>
    );
  } else if (secao === "diario") {
    const temMistura = Boolean(aberta);
    corpo = (
      <div className="flex flex-col gap-3" data-testid="diario-corpo">
        <p className="text-[13px] text-[#73726c]">
          Pasto: <b className="text-[#141413]">{pasto.nome || "—"}</b> · Máquina: <b className="text-[#141413]">{maquina || "—"}</b> · Implemento:{" "}
          <b className="text-[#141413]">{implementoNome || "—"}</b>
        </p>
        <div className="rounded-[10px] border border-[#c9f2d4] bg-[#f3fdf6] p-3" data-testid="diario-barra">
          <p className="text-[13px] font-semibold text-[#373733]">{textoDaBarra(resumo)}</p>
          {resumo.existe ? (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#ecebe6]" aria-hidden>
              <div className="h-full bg-[#16a34a]" style={{ width: `${resumo.percentual}%` }} />
            </div>
          ) : null}
        </div>
        {temMistura && !dia ?<Nota testId="diario-sem-dia-hoje">Ainda não há lançamento de hoje nesta área. Para aplicar, lance o dia primeiro.</Nota> : null}
        <div className="flex flex-col gap-2">
          {aberta ? (
            <button type="button" className={`${BOTAO_PRIMARIO} w-full`} onClick={() => setSecao("passo2")} data-testid="diario-passo-2-botao">
              Passo 2 · Aplicar no pasto
            </button>
          ) : (
            <button type="button" className={`${BOTAO_PRIMARIO} w-full`} onClick={() => setSecao("passo1")} data-testid="diario-passo-1-botao">
              Passo 1 · Mistura no implemento
            </button>
          )}
          <button type="button" className={`${BOTAO_SECUNDARIO} w-full`} onClick={() => setSecao("mais")} data-testid="diario-mais-botao">
            Mais
          </button>
          <button type="button" className={`${BOTAO_SECUNDARIO} w-full`} onClick={() => setSecao("trocar")} data-testid="diario-trocar-botao">
            Trocar pasto
          </button>
          <button type="button" className={`${BOTAO_SECUNDARIO} w-full`} onClick={() => setSecao("encerrar")} data-testid="diario-encerrar-botao">
            Encerrar o dia
          </button>
          <button type="button" className={`${BOTAO_SECUNDARIO} w-full`} onClick={() => setSecao("resumo")} data-testid="diario-resumo-botao">
            Resumo
          </button>
        </div>
      </div>
    );
    rodape = (
      <Rodape>
        <BotaoVoltar onClick={onFechar} testId="diario-fechar" children="Fechar" />
      </Rodape>
    );
  } else if (secao === "passo1") {
    corpo = (
      <SecaoPasso1
        atividadeId={atividadeId}
        empresaId={String(empresaId)}
        implementos={implementos}
        ultimaImplementoId={ultimaImplementoId}
        onVoltar={() => setSecao("diario")}
        onGravar={gravarMistura}
        enviando={enviando}
      />
    );
  } else if (secao === "passo2") {
    corpo = (
      <SecaoPasso2
        mistura={aberta}
        dia={dia}
        onVoltar={() => setSecao("diario")}
        onGravar={gravarAplicacao}
        onLancarHoje={() => setSecao("lancamento")}
        enviando={enviando}
      />
    );
  } else if (secao === "mais") {
    corpo = (
      <SecaoMais
        onAbastecer={() => setExterna({ tipo: LINHA_MAQUINA, voltar: "mais" })}
        onMaoObra={() => setExterna({ tipo: LINHA_MAO_OBRA, voltar: "mais" })}
        onVoltar={() => setSecao("diario")}
      />
    );
  } else if (secao === "trocar") {
    corpo = <SecaoTrocar opcoesDePasto={opcoesDePasto} mistura={aberta} onVoltar={() => setSecao("diario")} onTrocar={trocarPasto} enviando={enviando} />;
  } else if (secao === "encerrar") {
    corpo = (
      <SecaoEncerrar
        mistura={aberta}
        onVoltar={() => setSecao("diario")}
        onEncerrar={encerrar}
        onLancarHorimetro={() => setExterna({ tipo: LINHA_MAQUINA, voltar: "encerrar" })}
        enviando={enviando}
      />
    );
  } else if (secao === "resumo") {
    corpo = (
      <SecaoResumo
        dados={resumoQ.data}
        carregando={resumoQ.isLoading}
        erro={resumoQ.isError}
        verCusto={verCusto}
        nomeDaArea={nomeDaArea}
        onVoltar={() => setSecao("diario")}
      />
    );
  }

  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      titulo={titulo}
      testId="diario-maquina"
      className={celular ? "b1-janela--tela-cheia" : ""}
      contentProps={{ "data-permissao-explicita": "", "data-tipo": "diario-maquina", className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
      rodape={rodape}
    >
      {corpo}
    </B1Janela>
  );
}

/** O nome do pasto (área da atividade) pelo id da área do mapa. @param {any} atividade @param {unknown} id */
function nomeDaAreaNaAtividade(atividade, id) {
  const a = areasDaAtividade(atividade).find((x) => String(x.area_id ?? x.area?.id ?? "") === String(id ?? ""));
  return a ? rotuloDaAreaDaAtividade(a) : "";
}
