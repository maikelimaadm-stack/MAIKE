export function shouldShowDeleteDialog(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("não é possível excluir") ||
    text.includes("registros vinculados") ||
    text.includes("registro vinculado") ||
    text.includes("possui ") ||
    text.includes("exclusão bloqueada") ||
    text.includes("não pode ser exclu") ||
    text.includes("não é possível excluir este")
  );
}

export function emitDeleteDialog(message, title = "Não é possível excluir") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("base44:delete-dialog", {
      detail: {
        title,
        description: String(message || "Não foi possível concluir a exclusão."),
      },
    })
  );
}