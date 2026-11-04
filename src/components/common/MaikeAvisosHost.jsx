import React from "react";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { registrarHostDeAvisos } from "@/lib/maikeConfirmar";
import { EVENTO_EXCLUSAO_BLOQUEADA } from "@/lib/deleteDialogBus";

/**
 * Mostra as confirmações (`confirmar`) e os avisos de exclusão bloqueada
 * (`emitDeleteDialog`) no diálogo do sistema, um de cada vez (D-PROD-121).
 */
export default function MaikeAvisosHost() {
  const [fila, setFila] = React.useState(/** @type {Array<{ pedido: import("@/lib/maikeConfirmar").PedidoConfirmacao, resolver: (ok: boolean) => void }>} */ ([]));
  const atual = fila[0];

  React.useEffect(
    () =>
      registrarHostDeAvisos(
        (pedido) => new Promise((resolver) => setFila((f) => [...f, { pedido, resolver }])),
      ),
    [],
  );

  React.useEffect(() => {
    const aoBloquear = (/** @type {any} */ e) => {
      const { title, description } = e.detail || {};
      setFila((f) => [...f, { pedido: { titulo: title, descricao: description, textoConfirmar: "Entendi", soInformar: true }, resolver: () => {} }]);
    };
    window.addEventListener(EVENTO_EXCLUSAO_BLOQUEADA, aoBloquear);
    return () => window.removeEventListener(EVENTO_EXCLUSAO_BLOQUEADA, aoBloquear);
  }, []);

  const responder = (ok) => {
    if (!atual) return;
    atual.resolver(ok);
    setFila((f) => f.slice(1));
  };

  if (!atual) return null;
  const { pedido } = atual;
  return (
    <ConfirmDialog
      key={fila.length}
      open
      onOpenChange={(v) => !v && responder(false)}
      onConfirm={() => responder(true)}
      title={pedido.titulo || (pedido.perigo ? "Confirme a exclusão" : "Confirmação")}
      description={pedido.descricao}
      confirmText={pedido.textoConfirmar || (pedido.perigo ? "Excluir" : "Confirmar")}
      cancelText={pedido.textoCancelar || "Cancelar"}
      variant={pedido.perigo ? "destructive" : "default"}
      soInformar={pedido.soInformar}
    />
  );
}
