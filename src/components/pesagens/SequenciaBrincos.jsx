import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Hash, ChevronRight, RotateCcw } from "lucide-react";

/**
 * Sequência automática de brincos.
 * Mantém um "contador interno" via useRef para evitar problemas de closure/stale state.
 * Quando ativo, cada chamada a window.__sequenciaBrincos.avancar() incrementa o número
 * e chama onBrincoAtualChange com o próximo valor.
 */

const extrairPartes = (valor) => {
  if (!valor) return null;
  const match = valor.trim().match(/^([A-Za-z]*)(\d+)$/);
  if (match) {
    return { prefixo: match[1], numero: parseInt(match[2]), digitos: match[2].length };
  }
  return null;
};

const formatarBrinco = (prefixo, numero, digitos) => {
  return prefixo + String(numero).padStart(digitos, '0');
};

export default function SequenciaBrincos({ ativo, onAtivoChange, brincoAtual, onBrincoAtualChange, onSetNumeroAnimal }) {
  const [brincoInicial, setBrincoInicial] = useState("");
  const [brincoFinal, setBrincoFinal] = useState("");

  // Refs para manter estado interno atualizado (evita stale closures)
  const sequenciaRef = useRef(null); // { prefixo, numeroAtual, digitos, numeroFinal }

  const iniciarSequencia = () => {
    if (!brincoInicial.trim()) return;

    const partes = extrairPartes(brincoInicial);
    if (!partes) {
      onAtivoChange(true);
      onBrincoAtualChange(brincoInicial.trim());
      onSetNumeroAnimal(brincoInicial.trim());
      sequenciaRef.current = null;
      return;
    }

    const partesFinal = brincoFinal.trim() ? extrairPartes(brincoFinal) : null;

    sequenciaRef.current = {
      prefixo: partes.prefixo,
      numeroAtual: partes.numero,
      digitos: partes.digitos,
      numeroFinal: partesFinal ? partesFinal.numero : null,
    };

    const formatado = formatarBrinco(partes.prefixo, partes.numero, partes.digitos);
    onBrincoAtualChange(formatado);
    onSetNumeroAnimal(formatado);
    onAtivoChange(true);
  };

  const pararSequencia = () => {
    sequenciaRef.current = null;
    onAtivoChange(false);
    onBrincoAtualChange("");
    setBrincoInicial("");
    setBrincoFinal("");
  };

  // Registrar/atualizar window.__sequenciaBrincos sempre que ativo muda
  useEffect(() => {
    if (ativo) {
      window.__sequenciaBrincos = {
        avancar: () => {
          const seq = sequenciaRef.current;
          if (!seq) return false;

          const proximo = seq.numeroAtual + 1;

          // Verificar se ultrapassou o final
          if (seq.numeroFinal !== null && proximo > seq.numeroFinal) {
            // Sequência terminou
            sequenciaRef.current = null;
            onAtivoChange(false);
            onBrincoAtualChange("");
            return false;
          }

          // Atualizar ref interna
          seq.numeroAtual = proximo;

          const proximoFormatado = formatarBrinco(seq.prefixo, proximo, seq.digitos);
          onBrincoAtualChange(proximoFormatado);
          onSetNumeroAnimal(proximoFormatado);
          return true;
        }
      };
    } else {
      delete window.__sequenciaBrincos;
    }
    return () => { delete window.__sequenciaBrincos; };
  }, [ativo]); // Só depende de "ativo" — o resto usa refs mutáveis

  // Calcular progresso
  const getProgresso = () => {
    const seq = sequenciaRef.current;
    if (!seq) return null;

    const partesInicial = extrairPartes(brincoInicial.trim());
    if (!partesInicial) return null;

    const atual = seq.numeroAtual - partesInicial.numero + 1;

    if (seq.numeroFinal !== null) {
      const total = seq.numeroFinal - partesInicial.numero + 1;
      return { atual, total, percentual: Math.round((atual / total) * 100) };
    }

    return { atual, total: null, percentual: null };
  };

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
              placeholder="Ex: 7500"
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