import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Plus } from "lucide-react";
import DialogoConcluirServico from "@/components/lancamento-atividades/DialogoConcluirServico";
import JanelaLancamentoPorTipo, { lancamentoDoTipo, lancamentosPermitidos } from "@/components/lancamento-atividades/JanelaLancamentoPorTipo";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import { RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";
import { STATUS_AREA, areasDaAtividade } from "@/lib/atividadeAreasRegras";
import { LINHA_MAO_OBRA, LINHA_MAQUINA, LINHA_SERVICO, flagsDoTipoDaAtividade } from "@/lib/atividadeLinhasRegras";
import { acoesDaAtividade, mensagemDeErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { QUERY_ATIVIDADES_DA_AREA } from "@/lib/registroDeCampoRegras";
import { concluirAtividade } from "@/services/lancamentoAtividadesService";
import DiarioDoPasto from "./DiarioDoPasto";
import { lerAtividadeParaAcoes } from "./lerAtividadeParaAcoes";

// A leitura da atividade inteira mora em ./lerAtividadeParaAcoes (o DiarioDoPasto a usa sem importar este arquivo).
export { lerAtividadeParaAcoes };

/**
 * MAIKE-MAPA-ATIVIDADE-ACOES (D-PROD-278) — as ações rápidas de uma atividade em andamento, tocada nos Detalhes da área do
 * Mapa ("Atividades em andamento"): as MESMAS do Lançamento de Atividades, sem refazer tudo pela "Nova realização".
 *
 *  - "+ Lançamento" (o "+ Lançar dia" de antes): o Diário das atividades do pasto (`DiarioDoPasto`) já na atividade — o
 *    mesmo caminho da pílula "Manejos" (um só caminho para lançar numa atividade em andamento, D-PROD-348);
 *  - "Só máquina", "Só mão de obra", "Só serviço de terceiro": a janela de UM lançamento
 *    (`JanelaLancamentoPorTipo`, D-PROD-233/252) presa NESTA área; só os que a operação permite (`flagsDoTipoDaAtividade`)
 *    e só com a área em andamento na atividade (a janela recusa as outras). "Só insumo" saiu: o diário lança o insumo
 *    pela carga (a opção Insumo do serviço). Máquina, mão de obra e serviço de terceiro ainda são "Em breve" no diário;
 *  - "Concluir": o mesmo diálogo da linha da lista (`DialogoConcluirServico`), só com dia lançado na área.
 *
 * As permissões são as da lista (`acoesDaAtividade`, o fuso da fazenda = `podeGravar`): lançar pede `lancarApontamento`,
 * concluir pede `editar`. Sem nenhuma ação, a linha não é tocável. O resumo da área traz a atividade "leve": no toque de
 * uma ação, lê-se a atividade inteira (`GET /atividades/:id`: versão, operação, áreas) e, da lista filtrada pela área, o
 * `andamento` (o que a lista do Lançamento de Atividades passa às mesmas janelas). Depois de gravar, o resumo da área
 * (atividades e custos) e as consultas da tela de atividades se relêem. "Abrir atividade" fica de fora: a tela de
 * atividades não abre uma atividade pelo endereço.
 */

/**
 * As ações por tipo, com o rótulo do mapa ("Só …"), na ordem do pedido do dono. O insumo (`LINHA_PRODUTO`) não está aqui:
 * o Diário das atividades já o lança (a carga do serviço), então "Só insumo" duplicava o diário e saiu.
 */
const SO_DO_TIPO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    [LINHA_MAQUINA]: "Só máquina",
    [LINHA_MAO_OBRA]: "Só mão de obra",
    [LINHA_SERVICO]: "Só serviço de terceiro",
  }),
);
const ORDEM_DO_TIPO = [LINHA_MAQUINA, LINHA_MAO_OBRA, LINHA_SERVICO];

/**
 * @param {{ area: any, tipos: any[] }} p `tipos`: as operações ativas (as que os Detalhes da área já leem).
 * @returns {{ gruposDe: (linha: any) => Array<Array<{ key: string, label: string, icon?: React.ReactNode, onSelect: () => void }>> | null, janelas: React.ReactNode, buscando: boolean }}
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

  /**
   * Os grupos do menu de UMA linha do resumo (a mesma regra da lista); `null` = a linha não é tocável.
   * @param {any} linha
   */
  const gruposDe = (linha) => {
    if (!podeGravar || !linha?.atividade_id) return null;
    const ac = acoesDaAtividade({ id: linha.atividade_id, status: linha.status }, acoes);
    const emAndamentoNaArea = linha.area_status === STATUS_AREA.EM_ANDAMENTO;
    const lancar = ac.lancarApontamento
      ? [
          // "+ Lançamento" = o Diário das atividades do pasto, já na atividade (D-PROD-348: um caminho só). É a mesma entrada
          // da pílula "Manejos" do rodapé (o DiarioDoPasto).
          { key: "lancar-dia", label: "+ Lançamento", icon: <Plus size={16} strokeWidth={1.75} />, onSelect: () => void abrir(linha, "diario") },
          ...(emAndamentoNaArea
            ? lancamentosPermitidos(flagsDoTipoDaAtividade(linha, tipos))
                .filter((l) => SO_DO_TIPO[l.tipo])
                .slice()
                .sort((a, b) => ORDEM_DO_TIPO.indexOf(a.tipo) - ORDEM_DO_TIPO.indexOf(b.tipo))
                .map((l) => ({
                  key: `so-${l.tipo}`,
                  label: SO_DO_TIPO[l.tipo],
                  icon: <l.Icone size={16} strokeWidth={1.75} />,
                  onSelect: () => void abrir(linha, "tipo", l.tipo),
                }))
            : []),
        ]
      : [];
    // "Concluir" só com dia lançado na área (a lista só mostra o botão no serviço em andamento).
    const concluir =
      ac.concluir && (emAndamentoNaArea || Boolean(linha.ultimo_dia))
        ? [{ key: "concluir", label: "Finalizar", icon: <CircleCheck size={16} strokeWidth={1.75} />, onSelect: () => void abrir(linha, "concluir") }]
        : [];
    const grupos = [lancar, concluir];
    return grupos.some((g) => g.length) ? grupos : null;
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
    // O mesmo diário da pílula "Manejos" e do "+ Lançamento" (DiarioDoPasto); ele já relê o resumo da área depois de gravar.
    janelas = <DiarioDoPasto key={`diario-${aberta.chave}`} area={area} tipos={tipos} atividade={aberta.atividade} onFechar={fechar} />;
  } else if (aberta?.modo === "concluir") {
    janelas = (
      <DialogoConcluirServico key={`concluir-${aberta.chave}`} item={aberta.atividade} hoje={hoje} onFechar={fechar} onConcluir={concluir} />
    );
  }

  return { gruposDe, janelas, buscando };
}
