import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import CadastroRapidoSheet from "@/components/common/CadastroRapidoSheet";
import FormularioCategoriaManejo, {
  FORMULARIO_CATEGORIA_MANEJO_ID,
  getInitialFormData,
} from "@/components/categorias-manejo/FormularioCategoriaManejo";
import { criarCategoriaManejo } from "@/services/categoriaManejoService";
import { useCategoriasOficiaisDisponiveis } from "@/hooks/useCategoriasOficiaisDisponiveis";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";

/**
 * "Nova categoria de manejo" aberta pelo + do campo Categoria de Manejo do Lote.
 *
 * @param {{ open: boolean, onClose: () => void, empresaId: string | null, nomeInicial?: string, onCreated: (categoria: any) => void }} props
 */
export default function CadastroRapidoCategoriaManejo({ open, onClose, empresaId, nomeInicial = "", onCreated }) {
  const queryClient = useQueryClient();
  const categoriasOficiais = useCategoriasOficiaisDisponiveis(open ? empresaId : null);
  const [salvando, setSalvando] = React.useState(false);

  const salvar = async (dados) => {
    setSalvando(true);
    try {
      const criada = await criarCategoriaManejo(dados, { empresaId });
      await queryClient.invalidateQueries({ queryKey: ["categorias-manejo"] });
      notifySuccess("Sucesso", "Categoria cadastrada");
      onCreated(criada);
      onClose();
    } catch (err) {
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível cadastrar a categoria."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <CadastroRapidoSheet
      open={open}
      onClose={onClose}
      title="Nova categoria de manejo"
      formId={FORMULARIO_CATEGORIA_MANEJO_ID}
      saving={salvando}
    >
      {open ? (
        <FormularioCategoriaManejo
          variant="embedded"
          toolbarActions
          isEditing
          initialData={{ ...getInitialFormData(), nome: nomeInicial.toUpperCase() }}
          categoriasOficiaisDisponiveis={categoriasOficiais}
          isSubmitting={salvando}
          onSubmit={salvar}
          onCancel={onClose}
        />
      ) : null}
    </CadastroRapidoSheet>
  );
}
