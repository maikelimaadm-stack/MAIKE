import React, { useState } from "react";
import { useVerCusto } from "@/components/lancamento-atividades/VerCusto";
import { Check, Loader2 } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { formatarMoedaAtividade } from "@/lib/atividadeLinhasRegras";
import { mensagemDeErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { areasParaTrocarCapim, perguntaDaTrocaDeCapim } from "@/lib/reformaRegras";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

/**
 * MAIKE-ENTREGA3 (D-PROD-276) — "Concluir a reforma" (o dono, normalmente depois do primeiro pastejo): a data de conclusão
 * (hoje por padrão; nunca no futuro nem antes do início) e, quando o capim que vai ficar é diferente do capim de hoje de
 * alguma área, a pergunta "Trocar o capim da área para MOMBAÇA?" — isso mantém o mapa certo (o capim da área é o que dá as
 * alturas de manejo). "Sim, trocar e concluir" manda `trocar_capim: true` (o servidor troca pelo caminho de sempre da área,
 * auditado, na mesma transação); "Não, só concluir" conclui sem mexer na área. Sem a permissão de editar o Mapa Cadastro,
 * só o "concluir sem trocar" fica disponível (e a frase diz por quê). A recusa fica no diálogo.
 *
 * @param {{ reforma: any, hoje: string, podeTrocarCapim: boolean, onFechar: () => void,
 *   onConcluir: (dados: { data_conclusao: string, trocar_capim: boolean }) => Promise<unknown> }} props
 */
export default function DialogoConcluirReforma({ reforma, hoje, podeTrocarCapim, onFechar, onConcluir }) {
  // Diário da máquina (Fase 2): R$ só para o administrador da fazenda.
  const verCusto = useVerCusto();
  const [dia, setDia] = useState(hoje || "");
  const [erro, setErro] = useState(/** @type {string|null} */ (null));
  const [aviso, setAviso] = useState(/** @type {string|null} */ (null));
  const [enviando, setEnviando] = useState(/** @type {null|'trocar'|'concluir'} */ (null));
  const pergunta = perguntaDaTrocaDeCapim(reforma);
  const trocas = areasParaTrocarCapim(reforma);
  const custo = reforma?.custo ?? {};

  /** @param {boolean} trocar */
  const concluir = async (trocar) => {
    if (enviando) return;
    const inicio = typeof reforma?.data_inicio === "string" ? reforma.data_inicio : "";
    const e = !/^\d{4}-\d{2}-\d{2}$/.test(dia)
      ? "Informe a data de conclusão."
      : hoje && dia > hoje
        ? "A data de conclusão não pode ser futura."
        : inicio && dia < inicio
          ? "A data de conclusão não pode ser antes do início da reforma."
          : null;
    setErro(e);
    if (e) return;
    setEnviando(trocar ? "trocar" : "concluir");
    setAviso(null);
    try {
      await onConcluir({ data_conclusao: dia, trocar_capim: trocar });
    } catch (falha) {
      setAviso(
        ehResultadoIncerto(falha)
          ? "Não recebemos a resposta do servidor: a reforma PODE ter sido concluída. Feche e confira a lista antes de tentar de novo."
          : mensagemDeErroAtividade(falha, "Não foi possível concluir a reforma. Nada foi alterado."),
      );
    } finally {
      setEnviando(null);
    }
  };

  const giro = <Loader2 className="h-4 w-4 animate-spin" aria-hidden />;
  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!enviando}
      titulo={<span data-testid="dialogo-concluir-reforma-titulo">Concluir a {reforma?.nome ?? "reforma"}</span>}
      testId="dialogo-concluir-reforma"
      className="b1-concluir-servico b1-concluir-reforma"
      contentProps={{ "data-permissao-explicita": "" }}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={Boolean(enviando)} data-testid="dialogo-concluir-reforma-cancelar">
            Voltar
          </button>
          {pergunta ? (
            <>
              <button type="button" className={BOTAO_SECUNDARIO} onClick={() => void concluir(false)} disabled={Boolean(enviando)} data-testid="dialogo-concluir-reforma-so-concluir">
                {enviando === "concluir" ? giro : null}
                Não, só concluir
              </button>
              <button
                type="button"
                className={BOTAO_PRIMARIO}
                onClick={() => void concluir(true)}
                disabled={Boolean(enviando) || !podeTrocarCapim}
                data-testid="dialogo-concluir-reforma-trocar"
              >
                {enviando === "trocar" ? giro : <Check className="h-4 w-4" aria-hidden />}
                Sim, trocar e concluir
              </button>
            </>
          ) : (
            <button type="button" className={BOTAO_PRIMARIO} onClick={() => void concluir(false)} disabled={Boolean(enviando)} data-testid="dialogo-concluir-reforma-enviar">
              {enviando ? giro : <Check className="h-4 w-4" aria-hidden />}
              {enviando ? "Concluindo…" : "Concluir reforma"}
            </button>
          )}
        </>
      }
    >
      <div className="b1 mg-b1-form-grid b1-form-embutido" data-densidade={DENSIDADE_BASE1}>
        <CampoDia
          label="Data de conclusão"
          value={dia}
          onChange={(v) => {
            setDia(v || "");
            setErro(null);
          }}
          min={typeof reforma?.data_inicio === "string" ? reforma.data_inicio : undefined}
          max={hoje || undefined}
          required
          span={12}
          error={erro}
          testId="dialogo-concluir-reforma-dia"
        />
        {verCusto ? (
        <p className="col-span-12 min-w-0 text-[13px] text-[#141413]" data-testid="dialogo-concluir-reforma-custo">
          Custo total <strong>{formatarMoedaAtividade(custo.custo_total) || "R$ 0,00"}</strong>
          {custo.custo_por_ha ? (
            <>
              {" "}
              · <strong>{formatarMoedaAtividade(custo.custo_por_ha)}</strong>/ha
            </>
          ) : null}
        </p>
        ) : null}
        {pergunta ? (
          <div className="col-span-12 min-w-0 b1-parado b1-reforma-capim" role="group" aria-label="Trocar o capim" data-testid="dialogo-concluir-reforma-pergunta">
            <p className="b1-parado__pergunta">{pergunta}</p>
            <ul className="b1-reforma-capim__areas">
              {trocas.map((a) => (
                <li key={a.area_id}>
                  {a.nome}: {a.cultura?.nome ?? "sem capim no cadastro"} → <strong>{reforma.cultura_alvo?.nome}</strong>
                </li>
              ))}
            </ul>
            <p className="b1-parado__nome">O capim da área é o que dá as alturas de manejo no mapa.</p>
            {!podeTrocarCapim ? (
              <p className="text-[12px] text-amber-800" data-testid="dialogo-concluir-reforma-sem-permissao">
                Para trocar o capim da área é preciso a permissão de editar o Cadastro do Mapa. Você pode concluir sem trocar.
              </p>
            ) : null}
          </div>
        ) : null}
        {aviso ? (
          <p className="col-span-12 text-[12.5px] text-amber-800" role="alert" data-testid="dialogo-concluir-reforma-erro">
            {aviso}
          </p>
        ) : null}
      </div>
    </B1Janela>
  );
}
