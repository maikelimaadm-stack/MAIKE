import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronRight, RotateCcw } from "lucide-react";

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

export default function SequenciaBrincos({ visivel = true, brincoAtual, onSetNumeroAnimal, numerosUsados, onFocusPeso, onAtivoChange }) {
  const [usarSequencia, setUsarSequencia] = useState(false);
  const [brincoInicial, setBrincoInicial] = useState("");
  const [brincoFinal, setBrincoFinal] = useState("");
  const [pulados, setPulados] = useState(0);
  const [ativoInterno, setAtivoInterno] = useState(false);

  const sequenciaRef = useRef(null);
  const numerosUsadosRef = useRef(numerosUsados || new Set());

  useEffect(() => {
    numerosUsadosRef.current = numerosUsados || new Set();
  }, [numerosUsados]);

  const encontrarProximoLivre = useCallback((prefixo, inicio, limite, digitos, usados) => {
    let atual = inicio;
    let pulosCount = 0;

    while (limite !== null && atual <= limite) {
      const formatado = formatarBrinco(prefixo, atual, digitos);
      if (!usados.has(formatado)) {
        return { numero: atual, formatado, pulos: pulosCount };
      }
      pulosCount++;
      atual++;
    }

    if (limite === null) {
      while (pulosCount < 10) {
        const formatado = formatarBrinco(prefixo, atual, digitos);
        if (!usados.has(formatado)) {
          return { numero: atual, formatado, pulos: pulosCount };
        }
        pulosCount++;
        atual++;
      }
    }

    return null;
  }, []);

  const pararSequencia = useCallback(() => {
    sequenciaRef.current = null;
    setAtivoInterno(false);
    setPulados(0);
    onAtivoChange?.(false);
  }, [onAtivoChange]);

  useEffect(() => {
    if (!usarSequencia) {
      pararSequencia();
    }
  }, [usarSequencia, pararSequencia]);

  const iniciarSequencia = () => {
    if (!usarSequencia || !brincoInicial.trim()) return;

    const partes = extrairPartes(brincoInicial);
    if (!partes) {
      sequenciaRef.current = null;
      setAtivoInterno(true);
      setPulados(0);
      onAtivoChange?.(true);
      onSetNumeroAnimal?.(brincoInicial.trim());
      onFocusPeso?.();
      return;
    }

    const partesFinal = brincoFinal.trim() ? extrairPartes(brincoFinal) : null;
    const limite = partesFinal ? partesFinal.numero : null;
    const livre = encontrarProximoLivre(partes.prefixo, partes.numero, limite, partes.digitos, numerosUsadosRef.current);

    if (!livre) {
      window.__toast?.info("Todos os números do intervalo já estão cadastrados!");
      return;
    }

    sequenciaRef.current = {
      prefixo: partes.prefixo,
      numeroAtual: livre.numero,
      numeroInicial: partes.numero,
      digitos: partes.digitos,
      numeroFinal: limite,
    };

    setPulados(livre.pulos);
    setAtivoInterno(true);
    onAtivoChange?.(true);
    onSetNumeroAnimal?.(livre.formatado);
    onFocusPeso?.();
  };

  useEffect(() => {
    if (ativoInterno) {
      window.__sequenciaBrincos = {
        avancar: (usadosAtualizado) => {
          const seq = sequenciaRef.current;
          if (!seq) return { ok: false };

          const usados = usadosAtualizado || numerosUsadosRef.current;
          const atualFormatado = formatarBrinco(seq.prefixo, seq.numeroAtual, seq.digitos);
          usados.add(atualFormatado);
          numerosUsadosRef.current = usados;

          const livre = encontrarProximoLivre(seq.prefixo, seq.numeroAtual + 1, seq.numeroFinal, seq.digitos, usados);

          if (!livre) {
            sequenciaRef.current = null;
            setAtivoInterno(false);
            setPulados(0);
            onAtivoChange?.(false);
            return { ok: false };
          }

          seq.numeroAtual = livre.numero;
          setPulados((prev) => prev + livre.pulos);
          onSetNumeroAnimal?.(livre.formatado);
          onFocusPeso?.();
          return { ok: true, formatado: livre.formatado, pulos: livre.pulos };
        },
        getState: () => sequenciaRef.current,
      };
    } else {
      delete window.__sequenciaBrincos;
    }

    return () => {
      delete window.__sequenciaBrincos;
    };
  }, [ativoInterno, encontrarProximoLivre, onAtivoChange, onFocusPeso, onSetNumeroAnimal]);

  return (
    <div className={visivel ? "mt-2 p-3 border-t bg-slate-50 rounded" : "hidden"}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="usar-sequencia-brincos" className="text-xs flex items-center gap-2">
            <Checkbox
              id="usar-sequencia-brincos"
              checked={usarSequencia}
              onCheckedChange={(checked) => setUsarSequencia(checked === true)}
              aria-label="Ativar sequência"
            />
            <span>Brinco inicial</span>
          </Label>
          <Input
            value={brincoInicial}
            onChange={(e) => setBrincoInicial(e.target.value)}
            className="h-8 text-xs w-28"
            placeholder="Ex: 7000"
            disabled={!usarSequencia}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Brinco final</Label>
          <Input
            value={brincoFinal}
            onChange={(e) => setBrincoFinal(e.target.value)}
            className="h-8 text-xs w-28"
            placeholder="Ex: 7500"
            disabled={!usarSequencia}
          />
        </div>

        <Button
          type="button"
          size="sm"
          onClick={iniciarSequencia}
          disabled={!usarSequencia || !brincoInicial.trim()}
          className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
        >
          <ChevronRight className="w-3.5 h-3.5" />
          Iniciar
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={pararSequencia}
          disabled={!ativoInterno}
          className="h-8 text-xs gap-1"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reiniciar
        </Button>

        {usarSequencia && ativoInterno && (
          <div className="space-y-1">
            <Label className="text-xs">Brinco atual</Label>
            <Input value={brincoAtual || ""} readOnly className="h-8 text-xs w-28 font-semibold" />
          </div>
        )}

        {usarSequencia && pulados > 0 && (
          <div className="text-xs text-slate-500 pb-1">
            Pulados: {pulados}
          </div>
        )}
      </div>
    </div>
  );
}