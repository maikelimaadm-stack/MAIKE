import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import CadastroRapidoSheet from "@/components/common/CadastroRapidoSheet";
import FormularioSetor, { FORMULARIO_SETOR_ID } from "@/components/setores/FormularioSetor";
import { criarSetor } from "@/services/setorService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";

/**
 * "Novo setor" aberto pelo + do campo Setor (ex.: formulário do Lote).
 *
 * @param {{ open: boolean, onClose: () => void, empresaId: string | null, nomeInicial?: string, onCreated: (setor: any) => void }} props
 */
export default function CadastroRapidoSetor({ open, onClose, empresaId, nomeInicial = "", onCreated }) {
  const queryClient = useQueryClient();
  const [salvando, setSalvando] = React.useState(false);

  const salvar = async (dados) => {
    setSalvando(true);
    try {
      const criado = await criarSetor(dados, { empresaId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["setores"] }),
        queryClient.invalidateQueries({ queryKey: ["setores-por-area"] }),
        queryClient.invalidateQueries({ queryKey: ["areas-por-setor"] }),
      ]);
      notifySuccess("Sucesso", "Setor cadastrado");
      onCreated(criado);
      onClose();
    } catch (err) {
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o setor."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <CadastroRapidoSheet open={open} onClose={onClose} title="Novo setor" formId={FORMULARIO_SETOR_ID} saving={salvando}>
      {open ? (
        <FormularioSetor
          variant="embedded"
          toolbarActions
          initialData={{ nome: nomeInicial.toUpperCase() }}
          isSubmitting={salvando}
          onSubmit={salvar}
          onCancel={onClose}
        />
      ) : null}
    </CadastroRapidoSheet>
  );
}
