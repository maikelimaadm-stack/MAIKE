import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import DialogoConcluirServico from "@/components/lancamento-atividades/DialogoConcluirServico";
import JanelaLancamentoPorTipo, { lancamentoDoTipo, lancamentosPermitidos } from "@/components/lancamento-atividades/JanelaLancamentoPorTipo";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import { resumoDasFrentes } from "@/lib/aberturaServicoRegras";
import { RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";
import { STATUS_AREA, areasDaAtividade } from "@/lib/atividadeAreasRegras";
import { LINHA_MAO_OBRA, LINHA_PRODUTO, LINHA_SERVICO, flagsDoTipoDaAtividade } from "@/lib/atividadeLinhasRegras";
import { acoesDaAtividade, mensagemDeErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { QUERY_ATIVIDADES_DA_AREA } from "@/lib/registroDeCampoRegras";
import { concluirAtividade } from "@/services/lancamentoAtividadesService";
import DiarioDoPasto from "./DiarioDoPasto";
import { lerAtividadeParaAcoes } from "./lerAtividadeParaAcoes";

// A leitura da atividade inteira mora em ./lerAtividadeParaAcoes (o DiarioDoPasto a usa sem importar este arquivo).
export { lerAtividadeParaAcoes };

/**
 * MAIKE-MAPA-ATIVIDADE-ACOES (D-PROD-278) e MAIKE-MAPA-ATIVIDADE-SEM-MENU (D-PROD-369) — as ações de uma atividade em
 * andamento, nos Detalhes da área do Mapa ("Atividades em andamento"). O único caminho de lançar é o Diário:
 *
 *  - TOCAR NA LINHA abre o Diário das atividades do pasto (`DiarioDoPasto`) já na atividade (`abrirDiario`). Sem o menu
 *    das janelas antigas por cima. Só com a permissão de lançar apontamento (`podeAbrirDiario`);
 *  - as janelas antigas de UM lançamento (`JanelaLancamentoPorTipo`, D-PROD-233/252), presas NESTA área, ficam numa
 *    fileira discreta dentro da própria linha (`acoesSecundariasDe`), só para o que o Diário ainda não cobre:
 *      · "Só mão de obra" e "Só serviço de terceiro": só quando a operação permite;
 *      · "Só insumo": só numa atividade SEM máquina (o tipo não exige máquina e não há frente aberta lida), porque o Diário
 *        exige máquina, horímetro e responsável na abertura. Com máquina, o insumo é do Diário;
 *    "Só máquina" saiu: o Diário tem a opção Máquina (horas do dia dentro da frente);
 *  - "Finalizar", numa atividade SEM máquina e com dia lançado na área: o mesmo diálogo da lista
 *    (`DialogoConcluirServico`). Numa atividade COM máquina, o encerramento é o do Diário ("Encerrar serviço").
 *
 * As permissões são as da lista (`acoesDaAtividade`, o fuso da fazenda = `podeGravar`): lançar pede `lancarApontamento`,
 * concluir pede `editar`. Sem permissão de lançar, a linha não é tocável. O resumo da área traz a atividade "leve": no toque,
 * lê-se a atividade inteira (`GET /atividades/:id`: versão, operação, áreas) e, da lista filtrada pela área, o `andamento`.
 * Depois de gravar, o resumo da área e as consultas da tela de atividades se relêem. "Abrir atividade" fica de fora.
 */

/** As janelas antigas de UM lançamento, pelo tipo, com o rótulo do mapa ("Só …"), na ordem da fileira. */
const SO_DO_TIPO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    [LINHA_MAO_OBRA]: "Só mão de obra",
    [LINHA_PRODUTO]: "Só insumo",
    [LINHA_SERVICO]: "Só serviço de terceiro",
  }),
);
const ORDEM_DO_TIPO = [LINHA_MAO_OBRA, LINHA_PRODUTO, LINHA_SERVICO];

/**
 * @param {{ area: any, tipos: any[] }} p `tipos`: as operações ativas (as que os Detalhes da área já leem).
 * @returns {{
 *   podeAbrirDiario: (linha: any) => boolean,
 *   abrirDiario: (linha: any) => void,
 *   acoesSecundariasDe: (linha: any, frentes: any[] | null) => Array<{ key: string, rotulo: string, onSelect: () => void }>,
 *   janelas: React.ReactNode,
 *   buscando: boolean,
 * }}
 */
export function useAcoesDaAtividadeDaArea({ area, tipos }) {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaAtividades();
  const { fusoOk, hoje } = useFusoDaFazenda(empresaId);
  const { clienteId } = useAuth();
  // Escopo da pendência de `operation_id` (cliente e login): o mesmo do Lançamento de Atividades.
  const escopo = `${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`;
  const podeGravar = Boolean(empresaId) && fusoOk;
  const areaId = String(area?.id ?? "");

  const [aberta, setAberta] = useState(/** @type {{ modo: 'tipo'|'concluir'|'diario', atividade: any, tipo?: string, chave: number } | null} */ (null));
  const [buscando, setBuscando] = useState(false);

  /** O resumo da área (atividades e custos), os registros e as consultas da tela de atividades se relêem. */
  const reler = () => {
    void queryClient.invalidateQueries({ queryKey: [QUERY_ATIVIDADES_DA_AREA] });
    void queryClient.invalidateQueries({ queryKey: [RAIZ_CONSULTAS_ATIVIDADES] });
  };

  /** @param {any} linha @param {'tipo'|'concluir'|'diario'} modo @param {string} [tipo] */
  const abrir = async (linha, modo, tipo) => {
    if (buscando) return;
    setBuscando(true);
    try {
      const atividade = await lerAtividadeParaAcoes(String(linha.atividade_id), areaId);
      setAberta({ modo, atividade, tipo, chave: Date.now() });
    } catch (erro) {
      notifyWarning("Não foi possível abrir a atividade", mensagemDeErroAtividade(erro, "Confira a conexão e tente de novo."));
    } finally {
      setBuscando(false);
    }
  };

  /** A linha é tocável só com a permissão de lançar apontamento (e a fazenda com fuso). @param {any} linha */
  const podeAbrirDiario = (linha) => {
    if (!podeGravar || !linha?.atividade_id) return false;
    return acoesDaAtividade({ id: linha.atividade_id, status: linha.status }, acoes).lancarApontamento === true;
  };

  /** Tocar na linha: o Diário das atividades do pasto, já na atividade (um caminho só). @param {any} linha */
  const abrirDiario = (linha) => {
    if (!podeAbrirDiario(linha)) return;
    void abrir(linha, "diario");
  };

  /**
   * As janelas antigas de UM lançamento e o "Finalizar" da linha (ver o cabeçalho). Lista vazia = nada a mostrar.
   * `frentes`: as frentes lidas da atividade (`frentesDosApontamentos`), ou nulo quando não foram lidas.
   * @param {any} linha @param {any[] | null} frentes
   */
  const acoesSecundariasDe = (linha, frentes) => {
    if (!podeGravar || !linha?.atividade_id) return [];
    const ac = acoesDaAtividade({ id: linha.atividade_id, status: linha.status }, acoes);
    const emAndamentoNaArea = linha.area_status === STATUS_AREA.EM_ANDAMENTO;
    // O tipo da atividade na lista de tipos: sem ele (ainda carregando, ou fora da lista), nada de janela antiga.
    const doTipo = (Array.isArray(tipos) ? tipos : []).find((t) => t && String(t.id) === String(linha.tipo_atividade_id ?? ""));
    if (!doTipo) return [];
    // Atividade SEM máquina: o tipo não exige máquina E as frentes foram lidas e não há nenhuma aberta.
    const semMaquina = doTipo.exige_maquina !== true && Array.isArray(frentes) && resumoDasFrentes(frentes).abertas === 0;

    const lancar = [];
    if (ac.lancarApontamento && emAndamentoNaArea) {
      const permitidos = lancamentosPermitidos(flagsDoTipoDaAtividade(linha, tipos))
        .filter((l) => ORDEM_DO_TIPO.includes(l.tipo))
        .filter((l) => l.tipo !== LINHA_PRODUTO || semMaquina)
        .sort((a, b) => ORDEM_DO_TIPO.indexOf(a.tipo) - ORDEM_DO_TIPO.indexOf(b.tipo));
      for (const l of permitidos) {
        lancar.push({ key: `so-${l.tipo}`, rotulo: SO_DO_TIPO[l.tipo], onSelect: () => void abrir(linha, "tipo", l.tipo) });
      }
    }
    // "Finalizar" numa atividade sem máquina, com dia lançado na área (a regra da lista). Com máquina, o Diário encerra,
    // salvo para quem só pode editar (sem lançar apontamento): a linha não abre o Diário, então o diálogo é o caminho.
    const finalizar =
      (semMaquina || !podeAbrirDiario(linha)) && ac.concluir && (emAndamentoNaArea || Boolean(linha.ultimo_dia))
        ? [{ key: "concluir", rotulo: "Finalizar", onSelect: () => void abrir(linha, "concluir") }]
        : [];
    return [...lancar, ...finalizar];
  };

  /** "Concluir": `POST /atividades/:id/concluir` com o último dia; a recusa volta ao diálogo (ele mostra a frase). @param {string} dia @param {Array<{ atividade_area_id: string, hectares: string }>} [areas] */
  const concluir = async (dia, areas = undefined) => {
    const alvo = aberta?.atividade;
    if (!alvo) return;
    const r = /** @type {any} */ (await concluirAtividade(String(alvo.id), { versao: alvo.versao, data_conclusao: dia, ...(areas ? { areas } : {}) }));
    reler();
    setAberta(null);
    const numero = (r ?? alvo)?.numero;
    notifySuccess("Sucesso", `Atividade ${numero != null ? `nº ${numero} ` : ""}finalizada.`);
  };

  const fechar = () => setAberta(null);
  let janelas = null;
  if (aberta?.modo === "tipo" && aberta.tipo && lancamentoDoTipo(aberta.tipo)) {
    // Presa NESTA área: a área da atividade (o vínculo) cuja área do mapa é a dos detalhes.
    const daArea = areasDaAtividade(aberta.atividade).find((a) => String(a.area_id ?? a.area?.id ?? "") === areaId) ?? null;
    janelas = (
      <JanelaLancamentoPorTipo
        key={`so-${aberta.chave}`}
        atividade={aberta.atividade}
        tipo={aberta.tipo}
        acoes={acoes}
        flags={flagsDoTipoDaAtividade(aberta.atividade, tipos)}
        escopo={escopo}
        onFechar={fechar}
        onAtividadeAtualizada={reler}
        areaInicial={daArea ? String(daArea.id) : null}
      />
    );
  } else if (aberta?.modo === "diario") {
    // O mesmo diário da pílula "Manejos" (DiarioDoPasto); ele já relê o resumo da área depois de gravar.
    janelas = <DiarioDoPasto key={`diario-${aberta.chave}`} area={area} tipos={tipos} atividade={aberta.atividade} onFechar={fechar} />;
  } else if (aberta?.modo === "concluir") {
    janelas = (
      <DialogoConcluirServico key={`concluir-${aberta.chave}`} item={aberta.atividade} hoje={hoje} onFechar={fechar} onConcluir={concluir} />
    );
  }

  return { podeAbrirDiario, abrirDiario, acoesSecundariasDe, janelas, buscando };
}
