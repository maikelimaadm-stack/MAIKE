import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
    <AlertDialog open={dialog.open} onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))}>
      <AlertDialogContent className="[&>button]:hidden">
        <AlertDialogHeader>
          <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
          <AlertDialogDescription>{dialog.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction className="bg-red-600 hover:bg-red-700">Entendi</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}