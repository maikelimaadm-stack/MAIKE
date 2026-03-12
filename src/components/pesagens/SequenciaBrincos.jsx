import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Hash, ChevronRight, RotateCcw, SkipForward } from "lucide-react";

/**
 * Sequência Inteligente de Brincos.
 * Pula automaticamente números já cadastrados no banco de dados.
 * Props:
 *  - ativo: boolean
 *  - onAtivoChange: (boolean) => void
 *  - brincoAtual: string
 *  - onBrincoAtualChange: (string) => void
 *  - onSetNumeroAnimal: (string) => void
 *  - numerosUsados: Set<string> — números de animal já registrados (sincronizados + pendentes)
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

export default function SequenciaBrincos({ ativo, onAtivoChange, brincoAtual, onBrincoAtualChange, onSetNumeroAnimal, numerosUsados, onFocusPeso }) {
  const [brincoInicial, setBrincoInicial] = useState("");
  const [brincoFinal, setBrincoFinal] = useState("");
  const [pulados, setPulados] = useState(0);

  // Refs para manter estado interno atualizado (evita stale closures)
  const sequenciaRef = useRef(null); // { prefixo, numeroAtual, digitos, numeroInicial, numeroFinal }
  const numerosUsadosRef = useRef(numerosUsados || new Set());

  // Manter ref sincronizada com a prop
  useEffect(() => {
    numerosUsadosRef.current = numerosUsados || new Set();
  }, [numerosUsados]);

  // Encontra o próximo número livre a partir de 'inicio', respeitando 'limite'
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
    // Se não tem limite definido, avança até 10 pulos
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
    return null; // Nenhum número livre encontrado
  }, []);

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
    const limite = partesFinal ? partesFinal.numero : null;
    const usados = numerosUsadosRef.current;

    // Buscar o primeiro número livre dentro do intervalo
    const livre = encontrarProximoLivre(partes.prefixo, partes.numero, limite, partes.digitos, usados);

    if (!livre) {
      // Todos os números já estão cadastrados
      const toast = window.__toast;
      if (toast) toast.info("Todos os números do intervalo já estão cadastrados!");
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
    onBrincoAtualChange(livre.formatado);
    onSetNumeroAnimal(livre.formatado);
    onAtivoChange(true);
    if (onFocusPeso) onFocusPeso();

    if (livre.pulos > 0) {
      const toast = window.__toast;
      if (toast) toast.info(`${livre.pulos} número(s) pulado(s) (já cadastrados). Iniciando em ${livre.formatado}`);
    }
  };

  const pararSequencia = () => {
    sequenciaRef.current = null;
    onAtivoChange(false);
    onBrincoAtualChange("");
    setBrincoInicial("");
    setBrincoFinal("");
    setPulados(0);
  };

  // Registrar/atualizar window.__sequenciaBrincos sempre que ativo muda
  useEffect(() => {
    if (ativo) {
      window.__sequenciaBrincos = {
        /**
         * Avança para o próximo número livre na sequência.
         * Recebe opcionalmente um Set atualizado de números usados.
         * Retorna: { ok: true, formatado, pulos } ou { ok: false } se acabou.
         */
        avancar: (usadosAtualizado) => {
          const seq = sequenciaRef.current;
          if (!seq) return { ok: false };

          const usados = usadosAtualizado || numerosUsadosRef.current;

          // Adicionar o número que acabou de ser salvo ao Set local
          const atualFormatado = formatarBrinco(seq.prefixo, seq.numeroAtual, seq.digitos);
          usados.add(atualFormatado);
          numerosUsadosRef.current = usados;

          const proximo = seq.numeroAtual + 1;
          const livre = encontrarProximoLivre(seq.prefixo, proximo, seq.numeroFinal, seq.digitos, usados);

          if (!livre) {
            // Sequência terminou
            sequenciaRef.current = null;
            onAtivoChange(false);
            onBrincoAtualChange("");
            setPulados(0);
            return { ok: false };
          }

          // Atualizar ref interna
          seq.numeroAtual = livre.numero;
          setPulados((prev) => prev + livre.pulos);

          onBrincoAtualChange(livre.formatado);
          onSetNumeroAnimal(livre.formatado);
          if (onFocusPeso) onFocusPeso();
          return { ok: true, formatado: livre.formatado, pulos: livre.pulos };
        },
        getState: () => sequenciaRef.current,
      };
    } else {
      delete window.__sequenciaBrincos;
    }
    return () => { delete window.__sequenciaBrincos; };
  }, [ativo, encontrarProximoLivre]);

  // Calcular progresso
  const getProgresso = () => {
    const seq = sequenciaRef.current;
    if (!seq) return null;

    const atual = seq.numeroAtual - seq.numeroInicial + 1;

    if (seq.numeroFinal !== null) {
      const total = seq.numeroFinal - seq.numeroInicial + 1;
      // Contar quantos do intervalo já estão usados
      const usados = numerosUsadosRef.current;
      let disponiveis = 0;
      for (let i = seq.numeroInicial; i <= seq.numeroFinal; i++) {
        const fmt = formatarBrinco(seq.prefixo, i, seq.digitos);
        if (!usados.has(fmt)) disponiveis++;
      }
      return { atual, total, disponiveis, percentual: Math.round(((total - disponiveis) / total) * 100) };
    }

    return { atual, total: null, disponiveis: null, percentual: null };
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
                  ? `${progresso.percentual}% usado`
                  : `#${progresso.atual}`
                }
              </Badge>
            )}
            {progresso?.disponiveis !== null && (
              <Badge variant="outline" className="text-[10px] bg-emerald-100 border-emerald-300 text-emerald-700">
                {progresso.disponiveis} livres
              </Badge>
            )}
            {pulados > 0 && (
              <Badge variant="outline" className="text-[10px] bg-blue-100 border-blue-300 text-blue-700">
                <SkipForward className="w-2.5 h-2.5 mr-0.5" />
                {pulados} pulados
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