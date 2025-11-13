import React, { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export default function ComboboxFornecedor({ fornecedores, value, onChange, className }) {
  const [open, setOpen] = useState(false);

  const fornecedorSelecionado = fornecedores.find(f => f.id === value);

  const formatarDocumento = (fornecedor) => {
    if (fornecedor.cnpj) {
      return `CNPJ: ${fornecedor.cnpj}`;
    }
    if (fornecedor.cpf) {
      return `CPF: ${fornecedor.cpf}`;
    }
    return '';
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between h-8 text-xs", className)}
        >
          {fornecedorSelecionado ? (
            <span className="truncate">{fornecedorSelecionado.nome}</span>
          ) : (
            "Selecione o fornecedor..."
          )}
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar por nome ou CNPJ/CPF..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="text-xs py-6 text-center text-slate-500">
              Nenhum fornecedor encontrado
            </CommandEmpty>
            <CommandGroup>
              {fornecedores.map((fornecedor) => (
                <CommandItem
                  key={fornecedor.id}
                  value={`${fornecedor.nome} ${fornecedor.cnpj || ''} ${fornecedor.cpf || ''}`}
                  onSelect={() => {
                    onChange(fornecedor.id);
                    setOpen(false);
                  }}
                  className="text-xs cursor-pointer"
                >
                  <Check
                    className={cn(
                      "mr-2 h-3 w-3",
                      value === fornecedor.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex-1">
                    <div className="font-medium">{fornecedor.nome}</div>
                    <div className="text-[10px] text-slate-500">{formatarDocumento(fornecedor)}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}