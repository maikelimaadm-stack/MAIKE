import React from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortalComprasSkin } from "./portalComprasSkinContext";

/**
 * Lista flutuante de operadores do filtro `fpop` (paridade CDE `seletor-de-operador.tsx`).
 *
 * @param {object} props
 * @param {string} props.valor
 * @param {readonly { value: string; label: string }[]} props.opcoes
 * @param {(valor: string) => void} props.onChange
 */
export default function SeletorDeOperador({ valor, opcoes, onChange }) {
  const portalSkin = usePortalComprasSkin();
  return (
    <Select.Root value={valor} onValueChange={onChange}>
      <Select.Trigger className="fselb" aria-label="Condição">
        <span className="fselb-l">
          <Select.Value />
        </span>
        <Select.Icon className="fselb-c">
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <div className={cn("b1ref", portalSkin && "b1-portal-compras")} data-filtro-camada="">
          <Select.Content
            position="popper"
            sideOffset={4}
            className="fsell foperadores"
            aria-label="Condição"
            data-filtro-camada=""
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.stopPropagation()}
          >
            <Select.Viewport>
              {opcoes.map((o) => (
                <Select.Item
                  key={o.value}
                  value={o.value}
                  className={cn("fopt", o.value === valor && "on")}
                >
                  <span className="fopt-c">
                    <Select.ItemIndicator>
                      <Check size={12} />
                    </Select.ItemIndicator>
                  </span>
                  <Select.ItemText>{o.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </div>
      </Select.Portal>
    </Select.Root>
  );
}
