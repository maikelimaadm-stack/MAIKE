import React, { useEffect, useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import FormularioAbastecimento, { FORMULARIO_ABASTECIMENTO_ID } from "@/components/patrimonio/FormularioAbastecimento";
import {
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
  CorpoDaPreviaAbastecimento,
  useEnvioAbastecimento,
} from "@/components/patrimonio/DialogosAbastecimento";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAcoesTelaAbastecimento } from "@/hooks/usePatrimonioSessao";
import { useFluxoAbastecimento } from "@/hooks/useFluxoAbastecimento";
import { useAuth } from "@/lib/AuthContext";
import { formularioDoApontamento } from "@/lib/abastecimentoRegras";

/**
 * Abastecimento feito de dentro da área (D-PROD-251, reorganizado na D-PROD-252): o MESMO formulário, a mesma revisão e a
 * mesma confirmação da tela Abastecimentos, já ligado ao registro do dia daquela área. Nada de gravação nova: usa
 * `useFluxoAbastecimento`. Quem abre escolhe o registro do dia (`apontamento`); o servidor deriva a atividade e a área dele.
 *
 * Um nível só (D-PROD-252): o título é "Abastecimento", sem subtítulo nem os campos travados Atividade / Lançamento
 * (emenda 3: a área e a atividade já estão no cabeçalho da tela). A janela é a padrão do Base1, 680px, como todas as outras. Os botões ficam no rodapé: no formulário, Cancelar e Revisar abastecimento; na revisão
 * ("Confira antes de confirmar", o mesmo corpo do diálogo da tela Abastecimentos, mas DENTRO desta janela), Cancelar e
 * Confirmar abastecimento. No celular a janela ocupa a tela, como a dos outros lançamentos.
 *
 * @param {{
 *   atividade: any,
 *   apontamento: any,
 *   nomeArea: string,
 *   onFechar: () => void,
 *   onGravou: (texto: string) => void,
 * }} props
 */
export default function JanelaAbastecimentoDaArea({ atividade, apontamento, nomeArea, onFechar, onGravou }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const { hoje } = useFusoDaFazenda(empresaId);
  const acoes = useAcoesTelaAbastecimento();
  const { clienteId } = useAuth();
  const celular = useCelular();
  const escopo = `${clienteId || "sem-tenant"}:${acoes.login || "sem-login"}`;
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));
  const dia = hoje || "";

  const fluxo = useFluxoAbastecimento({
    empresaId,
    hoje: dia,
    podeCriar: acoes.criar === true,
    escopo,
    onConcluido: (registro, _emp, tipo) => {
      if (tipo !== "confirmar") return;
      const litros = [registro?.quantidade, registro?.unidade].filter(Boolean).join(" ");
      onGravou(litros ? `Abastecimento de ${litros} registrado.` : "Abastecimento registrado.");
      onFechar();
    },
  });
  // O formulário nasce já ligado ao registro do dia da área (a data é a dele; dá para mudar).
  const { iniciar } = fluxo;
  useEffect(() => {
    iniciar(formularioDoApontamento(dia, apontamento));
    // Só ao abrir: depois, o que a pessoa digita não pode ser apagado.
  }, []);

  // A confirmação (um envio por vez, com o aviso de resultado incerto), a mesma do diálogo de revisão.
  const envio = useEnvioAbastecimento(fluxo.confirmarDaPrevia, "Não foi possível confirmar o abastecimento. Nada foi gravado.");
  const enviando = envio.estado.fase === "enviando";
  const consultar = async () => {
    const texto = await fluxo.consultarConfirmacao();
    if (texto) envio.setEstado((e) => ({ ...e, consulta: texto }));
  };

  const revisando = Boolean(fluxo.previa) && fluxo.previaAberta && fluxo.situacaoPrevia === "valida";
  const previa = fluxo.previa?.resposta ?? null;
  const podeConfirmar = acoes.criar === true && Boolean(previa?.plano) && !(Array.isArray(previa?.bloqueios) && previa.bloqueios.length);

  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!fluxo.previando && !enviando}
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo="Abastecimento"
      testId="janela-abastecimento-area"
      className={celular ? "b1-janela--tela-cheia" : ""}
      // Os botões daqui seguem as ações da tela Abastecimentos: a heurística de texto do Layout não vale.
      contentProps={{ "data-permissao-explicita": "", "data-celular": celular ? "" : undefined, className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
      fora={<div ref={setAlvoFolha} className="contents" />}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={fluxo.previando || enviando} data-testid="janela-abastecimento-cancelar">
            Cancelar
          </button>
          {revisando ? (
            podeConfirmar ? (
              <button type="button" className={BOTAO_PRIMARIO} disabled={enviando} data-testid="abastecimento-confirmar" onClick={() => envio.disparar(null)}>
                {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                {enviando ? "Confirmando…" : envio.estado.fase === "incerto" ? "Repetir o mesmo envio" : "Confirmar abastecimento"}
              </button>
            ) : null
          ) : (
            <>
              {fluxo.situacaoPrevia === "valida" ? (
                <button type="button" className={BOTAO_SECUNDARIO} onClick={() => fluxo.setPreviaAberta(true)} data-testid="abastecimento-reabrir-previa">
                  Voltar à revisão
                </button>
              ) : null}
              <button type="submit" form={FORMULARIO_ABASTECIMENTO_ID} className={BOTAO_PRIMARIO} disabled={fluxo.previando} data-testid="abastecimento-previa">
                <Eye size={16} aria-hidden /> {fluxo.previando ? "Calculando…" : "Revisar abastecimento"}
              </button>
            </>
          )}
        </>
      }
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        {/* O formulário fica montado durante a revisão (escondido): voltar a corrigir não perde o que foi digitado. */}
        <div hidden={revisando}>
          <FormularioAbastecimento
            empresaId={/** @type {string} */ (empresaId)}
            form={fluxo.form}
            setForm={fluxo.setForm}
            hoje={dia}
            erros={fluxo.erros}
            limparErro={fluxo.limparErro}
            previando={fluxo.previando}
            situacaoPrevia={fluxo.situacaoPrevia}
            onPrevia={fluxo.pedirPrevia}
            onReabrirPrevia={() => fluxo.setPreviaAberta(true)}
            botoesNoRodape
          />
        </div>
        {revisando ? (
          <section className="min-w-0" aria-labelledby="abastecimento-confira-t" data-testid="abastecimento-revisao">
            <h3 className="mb-1 text-[14px] font-semibold" id="abastecimento-confira-t">
              Confira antes de confirmar
            </h3>
            <CorpoDaPreviaAbastecimento
              previa={previa}
              origem={fluxo.origemDaPrevia}
              custoExterno={fluxo.custoExternoDaPrevia}
              estado={envio.estado}
              podeConfirmar={acoes.criar === true}
              onRepetir={() => envio.disparar(null)}
              onConsultar={consultar}
            />
            <button type="button" className={`${BOTAO_SECUNDARIO} mt-2`} onClick={() => fluxo.setPreviaAberta(false)} disabled={enviando} data-testid="abastecimento-corrigir">
              Corrigir os dados
            </button>
          </section>
        ) : null}
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}
