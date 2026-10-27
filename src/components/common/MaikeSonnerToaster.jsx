import React from "react";
import { Toaster } from "sonner";

/** Host Sonner — cartões custom via `maikeNotify` (unstyled). */
export default function MaikeSonnerToaster() {
  return (
    <Toaster
      theme="light"
      position="top-center"
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
