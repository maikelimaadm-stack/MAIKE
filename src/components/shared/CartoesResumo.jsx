import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown } from "lucide-react";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarNumero = (num) => {
  if (!num && num !== 0) return "0";
  return num.toLocaleString('pt-BR');
};

export default function CartoesResumo({ cartoes }) {
  const [ocultar, setOcultar] = useState(() => {
    return localStorage.getItem('ocultar_cartoes_resumo') === 'true';
  });

  const toggleOcultar = () => {
    const novoEstado = !ocultar;
    setOcultar(novoEstado);
    localStorage.setItem('ocultar_cartoes_resumo', String(novoEstado));
  };

  if (!cartoes || cartoes.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={toggleOcultar}
          className="h-7 px-2 gap-1 text-xs text-slate-600"
        >
          {ocultar ? (
            <>
              <ChevronDown className="w-3 h-3" />
              Mostrar Resumo
            </>
          ) : (
            <>
              <ChevronUp className="w-3 h-3" />
              Ocultar Resumo
            </>
          )}
        </Button>
      </div>

      {!ocultar && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {cartoes.map((cartao) => {
            const Icon = cartao.icon;
            const valorFormatado = cartao.tipo === 'moeda' 
              ? formatarMoeda(cartao.valor) 
              : formatarNumero(cartao.valor);

            return (
              <Card 
                key={cartao.id} 
                className={`shadow-sm border-l-4 border-l-${cartao.cor}-500 hover:shadow-md transition-shadow ${cartao.onClick ? 'cursor-pointer' : ''}`}
                onClick={cartao.onClick}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-600 mb-0.5 truncate">{cartao.label}</p>
                      <p className={`text-xl font-bold text-${cartao.cor}-700 truncate`}>{valorFormatado}</p>
                      {cartao.sublabel && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{cartao.sublabel}</p>
                      )}
                    </div>
                    <div className={`w-9 h-9 rounded-lg bg-${cartao.cor}-50 flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 text-${cartao.cor}-600`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}