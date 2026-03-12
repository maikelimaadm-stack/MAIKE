import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Hash, ChevronRight, RotateCcw } from "lucide-react";

/**
 * Componente para sequenciamento automático de brincos no cadastro.
 * Quando ativo, o número do animal é preenchido automaticamente
 * e avança para o próximo após salvar.
 * 
 * Props:
 * - ativo: boolean - se a sequência está ativa
 * - onAtivoChange: (ativo: boolean) => void
 * - brincoAtual: string - número atual do brinco
 * - onBrincoAtualChange: (valor: string) => void
 * - onSetNumeroAnimal: (valor: string) => void - seta o campo de identificação
 */
export default function SequenciaBrincos({ ativo, onAtivoChange, brincoAtual, onBrincoAtualChange, onSetNumeroAnimal }) {
  const [brincoInicial, setBrincoInicial] = useState("");
  const [brincoFinal, setBrincoFinal] = useState("");
  const [prefixo, setPrefixo] = useState("");

  // Extrair parte numérica de um brinco (ex: "BR7000" -> 7000, prefixo "BR")
  const extrairPartes = (valor) => {
    const match = valor.match(/^([A-Za-z]*)(\d+)$/);
    if (match) {
      return { prefixo: match[1], numero: parseInt(match[2]), digitos: match[2].length };
    }
    return null;
  };

  const iniciarSequencia = () => {
    if (!brincoInicial.trim()) return;
    
    const partes = extrairPartes(brincoInicial.trim());
    if (!partes) {
      // Se não tem número, usar como está
      onAtivoChange(true);
      onBrincoAtualChange(brincoInicial.trim());
      onSetNumeroAnimal(brincoInicial.trim());
      setPrefixo("");
      return;
    }

    setPrefixo(partes.prefixo);
    const numeroFormatado = partes.prefixo + String(partes.numero).padStart(partes.digitos, '0');
    onBrincoAtualChange(numeroFormatado);
    onSetNumeroAnimal(numeroFormatado);
    onAtivoChange(true);
  };

  const pararSequencia = () => {
    onAtivoChange(false);
    onBrincoAtualChange("");
    setBrincoInicial("");
    setBrincoFinal("");
    setPrefixo("");
  };

  // Avançar para o próximo brinco
  const avancarBrinco = () => {
    if (!brincoAtual) return null;

    const partes = extrairPartes(brincoAtual);
    if (!partes) return null;

    const proximo = partes.numero + 1;
    
    // Verificar se passou do final
    if (brincoFinal.trim()) {
      const partesFinal = extrairPartes(brincoFinal.trim());
      if (partesFinal && proximo > partesFinal.numero) {
        return null; // Sequência terminou
      }
    }

    const proximoFormatado = partes.prefixo + String(proximo).padStart(partes.digitos, '0');
    return proximoFormatado;
  };

  // Calcular progresso
  const getProgresso = () => {
    if (!brincoAtual || !brincoInicial) return null;
    
    const partesAtual = extrairPartes(brincoAtual);
    const partesInicial = extrairPartes(brincoInicial.trim());
    
    if (!partesAtual || !partesInicial) return null;

    const atual = partesAtual.numero - partesInicial.numero + 1;
    
    if (brincoFinal.trim()) {
      const partesFinal = extrairPartes(brincoFinal.trim());
      if (partesFinal) {
        const total = partesFinal.numero - partesInicial.numero + 1;
        return { atual, total, percentual: Math.round((atual / total) * 100) };
      }
    }
    
    return { atual, total: null, percentual: null };
  };

  // Expor a função avancar via ref-like pattern (callback)
  useEffect(() => {
    if (ativo) {
      window.__sequenciaBrincos = {
        avancar: () => {
          const proximo = avancarBrinco();
          if (proximo) {
            onBrincoAtualChange(proximo);
            onSetNumeroAnimal(proximo);
            return true;
          }
          // Sequência terminou
          onAtivoChange(false);
          onBrincoAtualChange("");
          return false;
        }
      };
    } else {
      delete window.__sequenciaBrincos;
    }
    return () => { delete window.__sequenciaBrincos; };
  }, [ativo, brincoAtual, brincoFinal]);

  const progresso = ativo ? getProgresso() : null;

  return (
    <div className="flex items-end gap-1.5 flex-wrap">
      {!ativo ? (
        <>
          <div className="space-y-1">
            <Label className="text-xs font-medium flex items-center gap-1">
              <Hash className="w-3 h-3" /> Brinco Inicial
            </Label>
            <Input
              value={brincoInicial}
              onChange={(e) => setBrincoInicial(e.target.value)}
              className="h-9 text-sm w-28"
              placeholder="Ex: 7000"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Brinco Final</Label>
            <Input
              value={brincoFinal}
              onChange={(e) => setBrincoFinal(e.target.value)}
              className="h-9 text-sm w-28"
              placeholder="Ex: 7025"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={iniciarSequencia}
            disabled={!brincoInicial.trim()}
            className="h-9 text-xs bg-amber-500 hover:bg-amber-600 text-white gap-1"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            Iniciar Sequência
          </Button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-300 rounded text-amber-800">
            <Hash className="w-3.5 h-3.5" />
            <span className="text-xs font-bold">Brinco: {brincoAtual}</span>
            {progresso && (
              <Badge variant="outline" className="text-[10px] bg-amber-100 border-amber-300">
                {progresso.total
                  ? `${progresso.atual}/${progresso.total} (${progresso.percentual}%)`
                  : `#${progresso.atual}`
                }
              </Badge>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={pararSequencia}
            className="h-8 text-xs gap-1 text-red-600 border-red-300 hover:bg-red-50"
          >
            <RotateCcw className="w-3 h-3" />
            Parar Sequência
          </Button>
        </>
      )}
    </div>
  );
}