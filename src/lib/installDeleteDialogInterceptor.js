import { toast } from "sonner";
import { emitDeleteDialog, shouldShowDeleteDialog } from "@/lib/deleteDialogBus";

if (typeof window !== "undefined" && !window.__deleteDialogInterceptorInstalled) {
  const originalToastError = toast.error.bind(toast);

  toast.error = (...args) => {
    const firstArg = args[0];
    const message = typeof firstArg === "string"
      ? firstArg
      : firstArg?.message || firstArg?.description || "";

    if (shouldShowDeleteDialog(message)) {
      emitDeleteDialog(message);
      return message;
    }

    return originalToastError(...args);
  };

  window.__deleteDialogInterceptorInstalled = true;
}