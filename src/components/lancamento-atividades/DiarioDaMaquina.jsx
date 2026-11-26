import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import DialogoConcluirServico from "@/components/lancamento-atividades/DialogoConcluirServico";
import JanelaLancamentoPorTipo from "@/components/lancamento-atividades/JanelaLancamentoPorTipo";
import JanelaRegistroDeCampo from "@/components/lancamento-atividades/RegistroDeCampo";
import {
  CHAVE_DIARIO,
  Nota,
  Rodape,
  SecaoAbastecer,
  SecaoAbrirServico,
  SecaoEncerrar,
  SecaoMais,
  SecaoPasso1,
  SecaoPasso2,
  SecaoResumo,
  SecaoTrocar,
  BotaoAcao,
  BotaoVoltar,
} from "@/components/lancamento-atividades/DiarioSecoes";
import { useVerCusto } from "@/components/lancamento-atividades/VerCusto";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import { RAIZ_CONSULTAS_ATIVIDADES, normalizarPaginaDeOpcoes } from "@/lib/atividadeApontamentoRegras";
import { rotuloDaAreaDaAtividade, areasDaAtividade } from "@/lib/atividadeAreasRegras";
import { LINHA_MAO_OBRA, LINHA_MAQUINA, LINHA_SERVICO, flagsDoTipoDaAtividade } from "@/lib/atividadeLinhasRegras";
import { mensagemDeErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { QUERY_ATIVIDADES_DA_AREA } from "@/lib/registroDeCampoRegras";
import { corpoDaAplicacao, corpoDaMistura, corpoDaSobra, corpoDoTrajeto, ehFalhaDeRota, misturaAberta, resumoDoImplemento, TIPO_SOBRA, textoDaBarra } from "@/lib/implementoRegras";
import { formatarQuantidade } from "@/lib/abastecimentoRegras";
import { horaNoFuso, lerServico, marcadorDoServico, observacaoComServico, servicoAberto } from "@/lib/diarioServicoRegras";
import { mensagemDoBloqueioAbastecimento } from "@/lib/patrimonioErros";
import { avisarAbastecimentoGravado } from "@/hooks/useFluxoAbastecimento";
import { confirmarAbastecimento, previaDoAbastecimento } from "@/services/abastecimentoService";
import {
  aplicarMistura,
  criarMistura,
  diarioDisponivel,
  garantirDiaDoDiario,
  lancamentosDoDia,
  listarMisturas,
  lerResumoDoDia,
  registrarSobra,
  registrarTrajeto,
} from "@/services/diarioMaquinaService";
import {
  concluirAtividade,
  editarApontamento,
  listarOpcoesBens,
  listarOpcoesImplementos,
  listarOpcoesOperadores,
  obterAtividade,
  registrarCampo,
} from "@/services/lancamentoAtividadesService";

/**
 * O DIÁRIO DAS ATIVIDADES (D-PROD-314, fases 3 a 7; D-PROD-325 para a entrada): UMA janela Base1 (680px; tela cheia no
 * celular) que troca de CONTEÚDO por seção, sem abrir janela sobre janela.
 *
 * ENTRADA (D-PROD-325, corrigida): o "Abrir serviço" acontece AO INICIAR uma atividade nova, não dentro de uma já em
 * andamento. Pasto SEM atividade em andamento: a primeira tela é o formulário ÚNICO "Abrir serviço" (operação, máquina,
 * responsável, implemento e hora de início); confirmar CRIA a atividade e abre o serviço no mesmo passo. Pasto COM
 * atividade em andamento: a tela vai direto às ações do dia, com ou sem serviço aberto hoje; nunca reabre o formulário.
 * O serviço é da ATIVIDADE e do dia: o lançamento de hoje é reaproveitado (ou um novo é criado, sem apagar nada). Com o
 * serviço aberto, a tela mostra o cabeçalho (máquina · responsável · implemento · desde HH:MM) e as ações do dia:
 * Lançar produto/mistura, Aplicar, Abastecer, Trocar pasto, Encerrar e Mais (serviços, mão de obra, outros custos).
 * Encerrar grava a hora de fim e leva ao resumo do dia. Não há "abrir outro serviço": com a atividade ainda aberta, o
 * servidor junta o registro nela (só cria outra se a atual estiver concluída ou parada há mais de 30 dias); ver o relatório.
 *
 * O serviço aberto fica na OBSERVAÇÃO do lançamento do dia (`lib/diarioServicoRegras`), sem coluna nova.
 *
 * DEGRADAÇÃO: sem as rotas novas no servidor (`diarioDisponivel`), o cabeçalho mostra o aviso e o "Lançamento de hoje" — o
 * fluxo que já existe. O "Abrir serviço" só usa rotas que já existem (`POST …/apontamentos` via `registrar`).
 *
 * Permissão: quem abre esta janela já passou pela regra de lançar. Sem permissão de lançar, a janela recusa.
 *
 * @param {{
 *   atividade: any|null, areaId: string, areaNome?: string, tipos?: any[], onFechar: () => void, onGravou?: () => void,
 * }} props `areaId` é o id da área do mapa onde o pasto está. `atividade` é nula quando o pasto não tem atividade em andamento.
 */
export default function DiarioDaMaquina({ atividade, areaId, areaNome = "", tipos = [], onFechar, onGravou = undefined }) {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const { hoje, fuso, fusoOk } = useFusoDaFazenda(empresaId);
  const acoes = useAcoesTelaAtividades();
  const verCusto = useVerCusto();
  const celular = useCelular();
  const { clienteId } = useAuth();
  // A atividade criada pelo "Abrir serviço" (quando o pasto não tinha atividade em andamento).
  const [atividadeCriada, setAtividadeCriada] = useState(/** @type {any} */ (null));
  const atv = atividadeCriada ?? atividade ?? null;
  const atividadeId = atv?.id ? String(atv.id) : "";
  const escopo = `${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`;
  const flags = flagsDoTipoDaAtividade(atv, tipos);
  const podeLancar = acoes?.lancarApontamento === true && Boolean(fusoOk);

  // O pasto atual: começa no da entrada e muda quando a pessoa troca de pasto.
  const [pasto, setPasto] = useState(() => ({ id: String(areaId ?? ""), nome: areaNome || nomeDaAreaNaAtividade(atividade, areaId) }));
  const areasDaAtiv = areasDaAtividade(atv);
  const areaAtividade = areasDaAtiv.find((a) => String(a.area_id ?? a.area?.id ?? "") === pasto.id) ?? null;
  const areaAtividadeId = areaAtividade ? String(areaAtividade.id) : null;

  const [secao, setSecao] = useState("diario");
  const [externa, setExterna] = useState(/** @type {{ tipo: string, voltar: string } | null} */ (null));
  const [concluindo, setConcluindo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // ─── Consultas ──────────────────────────────────────────────────────────
  // O diário só lê as rotas novas quando há atividade (a degradação). O serviço aberto lê os lançamentos existentes.
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

  // Os lançamentos de HOJE da atividade (todas as áreas, o mais novo primeiro). O serviço aberto é o do lançamento mais
  // novo que traz a linha do serviço; o lançamento do pasto atual é o `dia` (sobra, abastecimento).
  const doDiaQ = useQuery({
    queryKey: [CHAVE_DIARIO, "dia", atividadeId, hoje],
    queryFn: () => lancamentosDoDia(atividadeId, hoje),
    enabled: Boolean(atividadeId && hoje && empresaId),
    staleTime: 15 * 1000,
  });
  const doDia = Array.isArray(doDiaQ.data) ? doDiaQ.data : [];
  const dia = areaAtividadeId ? doDia.find((a) => String(a?.atividade_area_id ?? "") === areaAtividadeId) ?? null : null;
  const servicoAp = doDia.find((a) => lerServico(a?.observacao)) ?? null;
  const servico = lerServico(servicoAp?.observacao);
  const aberto = servicoAberto(servico);
  const encerrado = Boolean(servico) && !aberto;
  const responsavelPadrao = doDia.find((a) => a?.operador_usuario_id)?.operador_usuario_id ?? "";

  const implementosQ = useQuery({
    queryKey: [CHAVE_DIARIO, "implementos", empresaId],
    queryFn: async () => normalizarPaginaDeOpcoes(await listarOpcoesImplementos({})).itens,
    enabled: Boolean(empresaId) && podeLancar,
    staleTime: 60 * 1000,
  });
  const implementos = Array.isArray(implementosQ.data) ? implementosQ.data : [];
  const maquinasQ = useQuery({
    queryKey: [CHAVE_DIARIO, "maquinas", empresaId],
    queryFn: async () => normalizarPaginaDeOpcoes(await listarOpcoesBens({})).itens,
    enabled: Boolean(empresaId) && podeLancar,
    staleTime: 60 * 1000,
  });
  const maquinas = Array.isArray(maquinasQ.data) ? maquinasQ.data : [];
  const responsaveisQ = useQuery({
    queryKey: [CHAVE_DIARIO, "responsaveis", empresaId],
    queryFn: async () => normalizarPaginaDeOpcoes(await listarOpcoesOperadores({})).itens,
    enabled: Boolean(empresaId) && podeLancar,
    staleTime: 60 * 1000,
  });
  const responsaveis = Array.isArray(responsaveisQ.data) ? responsaveisQ.data : [];

  const implementoNome = implementos.find((i) => String(i.id) === String(aberta?.implemento_bem_id ?? ""))?.nome ?? "";
  const ultimaImplementoId = misturas.slice().sort((a, b) => (Number(b.numero) || 0) - (Number(a.numero) || 0))[0]?.implemento_bem_id ?? null;

  // O cabeçalho: máquina · responsável · implemento · desde HH:MM (tudo do serviço aberto, sem pedir de novo).
  const nomeDaMaquina = servico?.bemId
    ? maquinas.find((m) => String(m.id) === String(servico.bemId))?.nome ?? (String(atv?.bem_id ?? atv?.bem?.id ?? "") === servico.bemId ? atv?.bem?.nome : "") ?? ""
    : "";
  const maquina = nomeDaMaquina || atv?.bem?.nome || "";
  const responsavelNome = servicoAp?.operador?.nome ?? responsaveis.find((r) => String(r.id) === String(servicoAp?.operador_usuario_id ?? ""))?.nome ?? "";
  const implementoDoServico = servico?.implementoId ? implementos.find((i) => String(i.id) === String(servico.implementoId)) ?? null : null;
  const implementoDoServicoNome = implementoDoServico?.nome ?? implementoNome;

  const resumoQ = useQuery({
    queryKey: [CHAVE_DIARIO, "resumo", atividadeId, hoje],
    queryFn: () => lerResumoDoDia(atividadeId, hoje),
    enabled: disponivel && secao === "resumo" && Boolean(hoje),
  });

  const opcoesDePasto = areasDaAtiv
    .filter((a) => String(a.area_id ?? a.area?.id ?? "") !== pasto.id)
    .map((a) => ({ value: String(a.area_id ?? a.area?.id ?? ""), label: rotuloDaAreaDaAtividade(a) }));

  /** O nome do pasto pelo id da área do mapa (para o resumo). @param {unknown} id */
  const nomeDaArea = (id) => nomeDaAreaNaAtividade(atv, id);

  // O formulário "Abrir serviço" é a entrada de uma atividade NOVA: só existe quando o pasto não tem atividade em andamento
  // (então ele pede a operação e cria a atividade junto com o serviço). Atividade em andamento, com ou sem serviço hoje,
  // nunca cai nele: entra nas ações do dia (D-PROD-325, correção do fluxo).
  const pedirOperacao = !atividadeId;
  const emAbrir = !atividadeId;

  // ─── Escritas ───────────────────────────────────────────────────────────

  /** Depois de gravar: as consultas do diário e as da tela de atividades (a área, o resumo e os totais) se relêem. */
  const reler = async () => {
    void queryClient.invalidateQueries({ queryKey: [CHAVE_DIARIO, "misturas", atividadeId] });
    await queryClient.invalidateQueries({ queryKey: [CHAVE_DIARIO, "dia"] });
    void queryClient.invalidateQueries({ queryKey: [CHAVE_DIARIO, "resumo"] });
    void queryClient.invalidateQueries({ queryKey: [QUERY_ATIVIDADES_DA_AREA] });
    void queryClient.invalidateQueries({ queryKey: [RAIZ_CONSULTAS_ATIVIDADES] });
    onGravou?.();
  };

  /** Uma falha de gravação: a mensagem do servidor (sem R$) e a tela continua como está. @param {unknown} erro @param {string} fallback */
  const falhou = (erro, fallback) => notifyWarning("Não foi possível gravar", mensagemDeErroAtividade(erro, fallback));

  /**
   * Grava o serviço (a linha do marcador). Com o lançamento do pasto de hoje e a permissão de editar, ele é ATUALIZADO (o
   * texto que já estava nele fica). Sem isso, cria um lançamento de hoje SEM linhas, só com a linha do serviço (quem só
   * lança não edita, D-PROD-325). @param {{ servico: any, responsavelId: string|null, ap: any, tipoId: string }} p
   */
  const gravarMarcadorDoServico = async ({ servico: s, responsavelId, ap, tipoId }) => {
    const operador = responsavelId || ap?.operador_usuario_id || null;
    if (ap && atividadeId && acoes?.editarApontamento === true) {
      return editarApontamento(atividadeId, String(ap.id), {
        versao: ap.versao,
        observacao: observacaoComServico(ap.observacao, s),
        ...(operador ? { operador_usuario_id: String(operador) } : {}),
      });
    }
    return registrarCampo({
      area_id: pasto.id,
      tipo_atividade_id: tipoId,
      data_operacional: hoje,
      observacao: marcadorDoServico(s),
      ...(operador ? { operador_usuario_id: String(operador) } : {}),
    });
  };

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
      void reler();
      notifySuccess("Sucesso", "Implemento cheio.");
      setSecao("diario");
    } catch (erro) {
      falhou(erro, "A mistura não foi gravada. Confira e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  /** Passo 2: aplica a mistura neste pasto. Sem o lançamento de hoje, o servidor cria (D-PROD-325). @param {{ esvaziou: boolean, sobra: string }} p */
  const gravarAplicacao = async ({ esvaziou, sobra }) => {
    if (!aberta) return;
    setEnviando(true);
    try {
      await aplicarMistura(atividadeId, String(aberta.id), corpoDaAplicacao({ empresaId: String(empresaId), esvaziou, sobra }));
      void reler();
      notifySuccess("Sucesso", esvaziou ? "Aplicação gravada. Implemento esvaziado." : "Aplicação gravada. Sobrou no implemento.");
      setSecao("diario");
    } catch (erro) {
      falhou(erro, "A aplicação não foi gravada. Confira e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  /**
   * Abrir serviço (D-PROD-325): a máquina, o responsável, o implemento e a hora de início vão na linha do serviço. Se o
   * pasto não tem atividade, o servidor abre uma com a operação escolhida (o mesmo "Registrar" da tela de atividades).
   * @param {{ bemId: string, responsavelId: string, implementoId: string|null, inicio: string, tipoId: string|null }} f
   */
  const gravarAbrirServico = async ({ bemId, responsavelId, implementoId, inicio, tipoId }) => {
    setEnviando(true);
    try {
      const resposta = /** @type {any} */ (
        await gravarMarcadorDoServico({
          servico: { inicio, bemId, implementoId, fim: null },
          responsavelId,
          ap: dia,
          tipoId: String(atv?.tipo_atividade_id ?? tipoId ?? ""),
        })
      );
      if (!atividadeId) {
        const novaId = resposta?.atividade?.id ?? resposta?.apontamento?.atividade_id;
        if (!novaId) throw new Error("O servidor não devolveu a atividade aberta.");
        setAtividadeCriada(await obterAtividade(String(novaId)));
      }
      await reler();
      notifySuccess("Sucesso", "Serviço aberto.");
      setSecao("diario");
    } catch (erro) {
      falhou(erro, "O serviço não foi aberto. Confira e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  /**
   * Trocar pasto: a sobra vai junto, volta ao depósito ou é perda; o pasto de chegada vira o atual. Os horímetros são
   * gravados SEMPRE que informados (D-PROD-325): a transferência os leva no próprio movimento da sobra; sem transferência
   * (sem sobra, ou sobra devolvida/perdida), vão num trajeto só com horímetros, sem mexer em estoque.
   */
  const trocarPasto = async ({ proximo, sobra, horimetroSaida, horimetroChegada }) => {
    setEnviando(true);
    try {
      const transferencia = Boolean(sobra && aberta && sobra.tipo === TIPO_SOBRA.TRANSFERENCIA);
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
            horimetroSaida: transferencia ? horimetroSaida : undefined,
            horimetroChegada: transferencia ? horimetroChegada : undefined,
          }),
        );
      }
      if (!transferencia) {
        const trajeto = corpoDoTrajeto({ empresaId: String(empresaId), deAreaId: pasto.id, paraAreaId: proximo, horimetroSaida, horimetroChegada });
        if (trajeto) await registrarTrajeto(atividadeId, trajeto);
      }
      void reler();
      setPasto({ id: proximo, nome: nomeDaArea(proximo) });
      notifySuccess("Sucesso", `Agora em ${nomeDaArea(proximo)}.`);
      setSecao("diario");
    } catch (erro) {
      falhou(erro, "A troca de pasto não foi gravada. Confira e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  /**
   * Encerrar serviço (D-PROD-325): grava a hora de fim (no fuso da fazenda) e o destino da sobra (se houver). "Fez o pasto
   * todo" abre a conclusão, depois de fechar o diário; senão, leva ao resumo do dia.
   */
  const encerrar = async ({ sobra, fezTodo }) => {
    setEnviando(true);
    try {
      if (servico && aberto) {
        await gravarMarcadorDoServico({
          servico: { ...servico, fim: horaNoFuso(fuso) },
          responsavelId: null,
          ap: servicoAp,
          tipoId: String(atv?.tipo_atividade_id ?? ""),
        });
      }
      if (sobra && aberta) {
        await registrarSobra(
          atividadeId,
          String(aberta.id),
          corpoDaSobra({ empresaId: String(empresaId), tipo: sobra.tipo, apontamentoId: dia?.id ? String(dia.id) : undefined, motivo: sobra.motivo }),
        );
      }
      await reler();
      if (fezTodo) setConcluindo(true);
      else setSecao("resumo");
    } catch (erro) {
      falhou(erro, "O serviço não foi encerrado. Confira e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  /**
   * Abastecer (D-PROD-325, item 1): prévia e confirmação pelo MESMO caminho da tela Abastecimentos, ligado ao lançamento
   * de hoje desta área (criado aqui se faltar). Se a rota não existir no servidor, cai no formulário antigo.
   * @param {any} form
   */
  const gravarAbastecimento = async (form) => {
    setEnviando(true);
    try {
      let apontamentoId = dia?.id ? String(dia.id) : "";
      if (!apontamentoId) {
        const ap = await garantirDiaDoDiario(atividadeId, pasto.id);
        apontamentoId = String(ap?.id ?? "");
        void queryClient.invalidateQueries({ queryKey: [CHAVE_DIARIO, "dia"] });
      }
      const comDia = { ...form, apontamento_id: apontamentoId };
      const previa = await previaDoAbastecimento(String(empresaId), comDia);
      const bloqueios = Array.isArray(previa?.bloqueios) ? previa.bloqueios : [];
      if (bloqueios.length) {
        notifyWarning("Não foi possível abastecer", bloqueios.map(mensagemDoBloqueioAbastecimento).join(" "));
        return;
      }
      const registro = /** @type {any} */ (await confirmarAbastecimento(String(empresaId), comDia, previa.plano, { escopo }));
      avisarAbastecimentoGravado(queryClient, registro, String(empresaId));
      void reler();
      notifySuccess("Sucesso", `Abastecimento de ${formatarQuantidade(registro?.quantidade, registro?.unidade)} registrado.`);
      setSecao("diario");
    } catch (erro) {
      if (ehFalhaDeRota(erro)) {
        notifyWarning("Abastecimento", "Abastecer por aqui ainda não está ligado no servidor. Use o formulário de sempre.");
        setSecao("diario");
        setExterna({ tipo: LINHA_MAQUINA, voltar: "mais" });
      } else {
        falhou(erro, "O abastecimento não foi gravado. Confira e tente de novo.");
      }
    } finally {
      setEnviando(false);
    }
  };

  /** "Finalizar" da atividade (o mesmo do menu da lista): `POST /atividades/:id/concluir` com o último dia. */
  const concluir = async (dataConclusao, areas = undefined) => {
    const r = /** @type {any} */ (await concluirAtividade(atividadeId, { versao: atv?.versao, data_conclusao: dataConclusao, ...(areas ? { areas } : {}) }));
    void reler();
    onFechar();
    const numero = (r ?? atv)?.numero;
    notifySuccess("Sucesso", `Atividade ${numero != null ? `nº ${numero} ` : ""}finalizada.`);
  };

  // ─── Janelas que substituem este diário (sem empilhar) ──────────────────

  if (!podeLancar) {
    return (
      <B1Janela aberto onFechar={onFechar} titulo="Diário das atividades" testId="diario-maquina" className={celular ? "b1-janela--tela-cheia" : ""}>
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
        atividade={atv}
        tipo={externa.tipo}
        acoes={acoes}
        flags={flags}
        escopo={escopo}
        onFechar={() => {
          setExterna(null);
          setSecao(externa.voltar);
        }}
        onAtividadeAtualizada={() => void reler()}
        areaInicial={areaAtividadeId}
      />
    );
  }

  if (secao === "lancamento") {
    return <JanelaRegistroDeCampo key="lancamento-de-hoje" tipos={tipos} continuar={atv} onGravou={() => void reler()} onFechar={() => setSecao("diario")} />;
  }

  if (concluindo) {
    return <DialogoConcluirServico key="concluir-diario" item={atv} hoje={hoje} onFechar={onFechar} onConcluir={concluir} />;
  }

  // ─── A janela: uma só, com o conteúdo da seção ─────────────────────────

  const titulos = {
    diario: "Diário das atividades",
    abrir: "Abrir serviço",
    passo1: "Lançar produto / mistura",
    passo2: "Aplicar no pasto",
    abastecer: "Abastecer",
    mais: "Mais",
    trocar: "Trocar pasto",
    encerrar: "Encerrar serviço",
    resumo: "Resumo do dia",
  };
  const titulo = (
    <span>
      {titulos[emAbrir ? "abrir" : secao] ?? titulos.diario}
      {pasto.nome ? <small className="block text-[11.5px] font-medium text-[#73726c]">{pasto.nome}</small> : null}
    </span>
  );

  let corpo = null;
  let rodape = null;

  if (!empresaId) {
    corpo = <AvisoGestao testId="diario-sem-empresa">Selecione uma fazenda para abrir o diário.</AvisoGestao>;
  } else if (emAbrir) {
    // O "Abrir serviço" só usa rotas que já existem no servidor: abre mesmo sem as rotas novas.
    corpo = (
      <SecaoAbrirServico
        key={`abrir-${atividadeId || "nova"}`}
        maquinas={maquinas}
        responsaveis={responsaveis}
        implementos={implementos}
        padroes={{
          bemId: atv?.bem_id ?? atv?.bem?.id ?? "",
          responsavelId: responsavelPadrao,
          implementoId: ultimaImplementoId ?? "",
          inicio: horaNoFuso(fuso),
        }}
        pedirOperacao={pedirOperacao}
        operacoes={tipos}
        voltarRotulo="Fechar"
        onVoltar={onFechar}
        onAbrir={gravarAbrirServico}
        enviando={enviando}
      />
    );
    rodape = null;
  } else if (atividadeId && disponivelQ.isPending && !disponivelQ.isError) {
    corpo = <Nota testId="diario-carregando">Carregando o diário…</Nota>;
  } else if (atividadeId && disponivelQ.isError) {
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
  } else if (doDiaQ.isError) {
    corpo = (
      <div className="flex flex-col gap-3">
        <AvisoGestao testId="diario-sem-conexao">Não foi possível ler o diário de hoje. Tente de novo.</AvisoGestao>
        <Rodape>
          <BotaoVoltar onClick={() => void doDiaQ.refetch()} testId="diario-tentar-de-novo" children="Tentar de novo" />
        </Rodape>
      </div>
    );
  } else if (!doDiaQ.isSuccess) {
    corpo = <Nota testId="diario-carregando">Carregando o diário…</Nota>;
  } else if (secao === "diario") {
    const cabecalho = [maquina, responsavelNome, implementoDoServicoNome, encerrado ? `encerrado às ${servico.fim}` : servico ? `desde ${servico.inicio}` : ""]
      .filter(Boolean)
      .join(" · ");
    corpo = (
      <div className="flex flex-col gap-3" data-testid="diario-corpo">
        <div className="rounded-[10px] border border-[#e5e4dc] bg-[#fafaf7] p-3" data-testid="diario-cabecalho">
          <p className="text-[13.5px] font-semibold text-[#141413]">{cabecalho || "—"}</p>
        </div>
        <div className="rounded-[10px] border border-[#c9f2d4] bg-[#f3fdf6] p-3" data-testid="diario-barra">
          <p className="text-[13px] font-semibold text-[#373733]">{textoDaBarra(resumo)}</p>
          {resumo.existe ? (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#ecebe6]" aria-hidden>
              <div className="h-full bg-[#16a34a]" style={{ width: `${resumo.percentual}%` }} />
            </div>
          ) : null}
        </div>
        {/* Caso residual (atividade em andamento sem serviço aberto hoje, p.ex. atividade antiga ou serviço apagado da
            observação): sem o formulário; as ações seguem e o aviso diz o que falta. Não reabre "Abrir serviço". */}
        {doDiaQ.isSuccess && !servico ? (
          <AvisoGestao testId="diario-sem-servico" tone="blue">
            Sem serviço aberto hoje nesta atividade. As ações abaixo seguem; o cabeçalho fica sem máquina e responsável.
          </AvisoGestao>
        ) : null}
        <div className="flex flex-col gap-2">
          <button type="button" className={`${BOTAO_PRIMARIO} w-full`} onClick={() => setSecao("passo1")} data-testid="diario-passo-1-botao">
            Lançar produto / mistura
          </button>
          {aberta ? (
            <button type="button" className={`${BOTAO_SECUNDARIO} w-full`} onClick={() => setSecao("passo2")} data-testid="diario-passo-2-botao">
              Aplicar no pasto
            </button>
          ) : null}
          <button type="button" className={`${BOTAO_SECUNDARIO} w-full`} onClick={() => setSecao("abastecer")} data-testid="diario-abastecer-botao">
            Abastecer
          </button>
          <button type="button" className={`${BOTAO_SECUNDARIO} w-full`} onClick={() => setSecao("trocar")} data-testid="diario-trocar-botao">
            Trocar pasto (horímetro)
          </button>
          {/* Encerrar só com o serviço aberto: sem ele não há hora de fim a gravar. */}
          {aberto ? (
            <button type="button" className={`${BOTAO_SECUNDARIO} w-full`} onClick={() => setSecao("encerrar")} data-testid="diario-encerrar-botao">
              Encerrar serviço
            </button>
          ) : null}
          <button type="button" className={`${BOTAO_SECUNDARIO} w-full`} onClick={() => setSecao("mais")} data-testid="diario-mais-botao">
            Mais (serviços, mão de obra, outros custos)
          </button>
          <button type="button" className={`${BOTAO_SECUNDARIO} w-full`} onClick={() => setSecao("resumo")} data-testid="diario-resumo-botao">
            Resumo do dia
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
        implementoFixo={servico?.implementoId ? { id: servico.implementoId, nome: implementoDoServicoNome } : null}
        onVoltar={() => setSecao("diario")}
        onGravar={gravarMistura}
        enviando={enviando}
      />
    );
  } else if (secao === "passo2") {
    corpo = <SecaoPasso2 mistura={aberta} onVoltar={() => setSecao("diario")} onGravar={gravarAplicacao} enviando={enviando} />;
  } else if (secao === "mais") {
    corpo = (
      <SecaoMais
        onServicos={() => setExterna({ tipo: LINHA_SERVICO, voltar: "mais" })}
        onMaoObra={() => setExterna({ tipo: LINHA_MAO_OBRA, voltar: "mais" })}
        onOutrosCustos={() => setSecao("lancamento")}
        onVoltar={() => setSecao("diario")}
      />
    );
  } else if (secao === "abastecer") {
    corpo = (
      <SecaoAbastecer
        empresaId={String(empresaId)}
        bem={{ id: servico?.bemId ?? atv?.bem_id ?? atv?.bem?.id ?? null, nome: maquina }}
        hoje={hoje}
        onVoltar={() => setSecao("diario")}
        onGravar={gravarAbastecimento}
        enviando={enviando}
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
