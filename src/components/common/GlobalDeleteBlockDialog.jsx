import React from "react";
import TopNoticeDialog from "@/components/common/TopNoticeDialog";

export default function GlobalDeleteBlockDialog() {
  const [dialog, setDialog] = React.useState({
    open: false,
    title: "Não é possível excluir",
    description: "",
  });

  React.useEffect(() => {
    const handleOpen = (event) => {
      setDialog({
        open: true,
        title: event.detail?.title || "Não é possível excluir",
        description: event.detail?.description || "Existem registros vinculados a este item.",
      });
    };

    window.addEventListener("base44:delete-dialog", handleOpen);
    return () => window.removeEventListener("base44:delete-dialog", handleOpen);
  }, []);

  return (
    <TopNoticeDialog
      open={dialog.open}
      onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))}
      badge="AVISO"
      title={dialog.title}
      description={dialog.description}
      type="danger"
      confirmText={null}
    />
  );
}