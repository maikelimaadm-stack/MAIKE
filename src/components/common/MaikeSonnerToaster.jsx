import React from "react";
import { Toaster } from "sonner";

/** Host Sonner — todas as notificações no canto superior direito. */
export default function MaikeSonnerToaster() {
  return (
    <Toaster
      theme="light"
      position="top-right"
      visibleToasts={8}
      expand
      gap={10}
      offset={16}
      toastOptions={{
        unstyled: true,
        className: "mg-toast-host",
      }}
    />
  );
}
