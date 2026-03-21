import { useEffect } from "react";
import { toast } from "sonner";

function normalizeLabel(text = "") {
  return String(text).replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

function getFieldLabel(element) {
  const id = element.getAttribute("id");
  if (id) {
    const labelByFor = document.querySelector(`label[for="${id}"]`);
    if (labelByFor) return normalizeLabel(labelByFor.textContent);
  }

  const fieldWrapper = element.closest("div");
  const nearbyLabel = fieldWrapper?.querySelector("label");
  if (nearbyLabel) return normalizeLabel(nearbyLabel.textContent);

  return normalizeLabel(element.getAttribute("placeholder") || element.getAttribute("name") || "Campo obrigatório");
}

export default function GlobalRequiredFieldsGuard() {
  useEffect(() => {
    let toastTimer = null;
    let pendingLabels = [];

    const showMissingFieldsToast = () => {
      const uniqueLabels = [...new Set(pendingLabels.filter(Boolean))];
      if (!uniqueLabels.length) return;

      const preview = uniqueLabels.slice(0, 3).join(", ");
      const extraCount = uniqueLabels.length - 3;
      const suffix = extraCount > 0 ? ` e mais ${extraCount}` : "";

      toast.error(`Preencha os campos obrigatórios: ${preview}${suffix}.`);
      pendingLabels = [];
    };

    const handleInvalid = (event) => {
      const element = event.target;
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;

      event.preventDefault();
      element.setAttribute("aria-invalid", "true");
      pendingLabels.push(getFieldLabel(element));

      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(showMissingFieldsToast, 0);
    };

    const clearInvalidState = (event) => {
      const element = event.target;
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
      if (element.checkValidity()) {
        element.removeAttribute("aria-invalid");
      }
    };

    document.addEventListener("invalid", handleInvalid, true);
    document.addEventListener("input", clearInvalidState, true);
    document.addEventListener("change", clearInvalidState, true);

    return () => {
      document.removeEventListener("invalid", handleInvalid, true);
      document.removeEventListener("input", clearInvalidState, true);
      document.removeEventListener("change", clearInvalidState, true);
      if (toastTimer) clearTimeout(toastTimer);
    };
  }, []);

  return null;
}