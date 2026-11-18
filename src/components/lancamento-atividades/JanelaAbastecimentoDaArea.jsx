import React, { useEffect, useState } from "react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { MobileSheetPortalCtx } from "@/components/common/MobileSheet";
import FormularioAbastecimento from "@/components/patrimonio/FormularioAbastecimento";
import { DialogoPreviaAbastecimento } from "@/components/patrimonio/DialogosAbastecimento";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAcoesTelaAbastecimento } from "@/hooks/usePatrimonioSessao";
import { useFluxoAbastecimento } from "@/hooks/useFluxoAbastecimento";
import { useAuth } from "@/lib/AuthContext";
import { formularioDoApontamento } from "@/lib/abastecimentoRegras";

/**
 * Abastecimento feito de dentro da área (D-PROD-251): o MESMO formulário, a mesma revisão e a mesma confirmação da tela
 * Abastecimentos, já ligado ao registro do dia daquela área. Nada de gravação nova: usa `useFluxoAbastecimento`.
 * Quem abre escolhe o registro do dia (`apontamento`); o servidor deriva a atividade e a área dele.
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

  return (
    <>
      <B1Janela
        aberto
        onFechar={onFechar}
        podeFechar={!fluxo.previando}
        aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
        titulo="Registrar abastecimento"
        descricao={[nomeArea, String(atividade?.nome ?? "")].filter(Boolean).join(" · ")}
        testId="janela-abastecimento-area"
        // Os botões daqui seguem as ações da tela Abastecimentos: a heurística de texto do Layout não vale.
        contentProps={{ "data-permissao-explicita": "" }}
        fora={<div ref={setAlvoFolha} className="contents" />}
      >
        <MobileSheetPortalCtx.Provider value={alvoFolha}>
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
            vinculo={{ atividade, apontamento }}
          />
        </MobileSheetPortalCtx.Provider>
      </B1Janela>
      {fluxo.previa ? (
        <DialogoPreviaAbastecimento
          key={`previa-${fluxo.previa.seq}`}
          aberto={fluxo.previaAberta && fluxo.situacaoPrevia === "valida"}
          previa={fluxo.previa.resposta}
          origem={fluxo.origemDaPrevia}
          custoExterno={fluxo.custoExternoDaPrevia}
          podeConfirmar={acoes.criar === true}
          onFechar={() => fluxo.setPreviaAberta(false)}
          onConfirmar={fluxo.confirmarDaPrevia}
          onConsultar={fluxo.consultarConfirmacao}
        />
      ) : null}
    </>
  );
}
