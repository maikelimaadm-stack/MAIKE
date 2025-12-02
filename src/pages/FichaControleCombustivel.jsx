import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer, Fuel } from "lucide-react";

export default function FichaControleCombustivel() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [config, setConfig] = useState({
    linhas: 25,
    mes: "",
    ano: new Date().getFullYear(),
    tipoCombustivel: "DIESEL",
  });

  const { data: empresa } = useQuery({
    queryKey: ['empresa-ficha', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Empresa.list();
      return all.find(e => e.id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const handlePrint = () => {
    window.print();
  };

  const meses = [
    "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
    "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"
  ];

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Configurações - não aparece na impressão */}
      <div className="print:hidden p-4 bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Fuel className="w-5 h-5" />
            Ficha de Controle de Combustível - Impressão
          </h1>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Mês</Label>
              <select
                value={config.mes}
                onChange={(e) => setConfig({ ...config, mes: e.target.value })}
                className="w-full h-9 border rounded px-2 text-sm"
              >
                <option value="">Selecione</option>
                {meses.map((mes, idx) => (
                  <option key={idx} value={mes}>{mes}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Ano</Label>
              <Input
                type="number"
                value={config.ano}
                onChange={(e) => setConfig({ ...config, ano: parseInt(e.target.value) || 2025 })}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Tipo Combustível</Label>
              <select
                value={config.tipoCombustivel}
                onChange={(e) => setConfig({ ...config, tipoCombustivel: e.target.value })}
                className="w-full h-9 border rounded px-2 text-sm"
              >
                <option value="DIESEL">DIESEL</option>
                <option value="DIESEL S10">DIESEL S10</option>
                <option value="GASOLINA">GASOLINA</option>
                <option value="ETANOL">ETANOL</option>
                <option value="ARLA 32">ARLA 32</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Qtd de Linhas</Label>
              <Input
                type="number"
                min="10"
                max="40"
                value={config.linhas}
                onChange={(e) => setConfig({ ...config, linhas: parseInt(e.target.value) || 25 })}
                className="h-9"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handlePrint} className="w-full h-9 gap-2">
                <Printer className="w-4 h-4" />
                Imprimir Ficha
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Ficha de Controle - Página Inteira */}
      <div className="p-4 print:p-0">
        <div className="max-w-[210mm] mx-auto bg-white shadow-lg print:shadow-none" style={{ minHeight: '297mm' }}>
          <div className="p-6 print:p-8">
            {/* Cabeçalho */}
            <div className="text-center border-2 border-black p-3 mb-4">
              <h1 className="text-xl font-bold text-black">{empresa?.apelido || empresa?.nome || 'FAZENDA'}</h1>
              <h2 className="text-lg font-bold text-black mt-1">CONTROLE DE COMBUSTÍVEL - {config.tipoCombustivel}</h2>
              <p className="text-sm font-semibold text-black mt-1">
                {config.mes ? `${config.mes} / ${config.ano}` : `ANO: ${config.ano}`}
              </p>
            </div>

            {/* Informações iniciais */}
            <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
              <div className="border border-black p-2">
                <span className="font-bold">SALDO ANTERIOR:</span>
                <span className="ml-2 border-b border-black inline-block w-24"></span> L
              </div>
              <div className="border border-black p-2">
                <span className="font-bold">TANQUE:</span>
                <span className="ml-2 border-b border-black inline-block w-32"></span>
              </div>
              <div className="border border-black p-2">
                <span className="font-bold">CAPACIDADE:</span>
                <span className="ml-2 border-b border-black inline-block w-20"></span> L
              </div>
            </div>

            {/* Tabela de Controle */}
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-black p-1 w-16">DATA</th>
                  <th className="border border-black p-1">MÁQUINA / VEÍCULO</th>
                  <th className="border border-black p-1 w-20">HORÍMETRO</th>
                  <th className="border border-black p-1 w-16">ENTRADA (L)</th>
                  <th className="border border-black p-1 w-16">SAÍDA (L)</th>
                  <th className="border border-black p-1 w-16">SALDO (L)</th>
                  <th className="border border-black p-1">OPERADOR</th>
                  <th className="border border-black p-1 w-14">VISTO</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: config.linhas }).map((_, idx) => (
                  <tr key={idx}>
                    <td className="border border-black p-1" style={{ height: '22px' }}></td>
                    <td className="border border-black p-1"></td>
                    <td className="border border-black p-1"></td>
                    <td className="border border-black p-1"></td>
                    <td className="border border-black p-1"></td>
                    <td className="border border-black p-1"></td>
                    <td className="border border-black p-1"></td>
                    <td className="border border-black p-1"></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Resumo do mês */}
            <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
              <div className="border border-black p-2 text-center">
                <span className="font-bold block">TOTAL ENTRADA</span>
                <span className="border-b border-black inline-block w-20 mt-1"></span> L
              </div>
              <div className="border border-black p-2 text-center">
                <span className="font-bold block">TOTAL SAÍDA</span>
                <span className="border-b border-black inline-block w-20 mt-1"></span> L
              </div>
              <div className="border border-black p-2 text-center">
                <span className="font-bold block">SALDO FINAL</span>
                <span className="border-b border-black inline-block w-20 mt-1"></span> L
              </div>
              <div className="border border-black p-2 text-center">
                <span className="font-bold block">AFERIÇÃO TANQUE</span>
                <span className="border-b border-black inline-block w-20 mt-1"></span> L
              </div>
            </div>

            {/* Observações */}
            <div className="mt-4 border border-black p-2">
              <span className="font-bold text-sm">OBSERVAÇÕES:</span>
              <div className="border-b border-black mt-4" style={{ minHeight: '40px' }}></div>
            </div>

            {/* Assinaturas */}
            <div className="flex justify-between mt-8 pt-4">
              <div className="text-center flex-1">
                <div className="border-t border-black mx-8 pt-1">
                  <span className="text-xs font-bold">Responsável pelo Abastecimento</span>
                </div>
              </div>
              <div className="text-center flex-1">
                <div className="border-t border-black mx-8 pt-1">
                  <span className="text-xs font-bold">Supervisor / Gerente</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:p-0 { padding: 0 !important; }
          .print\\:p-8 { padding: 2rem !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          @page { margin: 0; size: A4; }
        }
      `}</style>
    </div>
  );
}