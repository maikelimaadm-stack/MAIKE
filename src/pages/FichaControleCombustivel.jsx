import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer, Fuel, Settings } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function FichaControleCombustivel() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState({
    linhas: 25,
    mes: "",
    ano: new Date().getFullYear(),
    tipoCombustivel: "DIESEL",
    orientacao: "retrato",
    larguraData: 70,
    larguraMaquina: 200,
    larguraHorimetro: 80,
    larguraEntrada: 70,
    larguraSaida: 70,
    larguraVisto: 60,
    alturaLinha: 22,
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
      {/* Barra de ações - não aparece na impressão */}
      <div className="print:hidden p-4 bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Fuel className="w-5 h-5" />
              Ficha de Controle de Combustível
            </h1>
            <p className="text-xs text-slate-600">Impressão de fichas para controle manual</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowConfig(true)} className="h-8 gap-1 text-xs">
              <Settings className="w-3.5 h-3.5" />
              Config
            </Button>
            <Button onClick={handlePrint} size="sm" className="h-8 gap-2 bg-emerald-600 hover:bg-emerald-700">
              <Printer className="w-4 h-4" />
              Imprimir
            </Button>
          </div>
        </div>
      </div>

      {/* Dialog de Configurações */}
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurações da Ficha</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                <Label className="text-xs">Orientação</Label>
                <select
                  value={config.orientacao}
                  onChange={(e) => setConfig({ ...config, orientacao: e.target.value })}
                  className="w-full h-9 border rounded px-2 text-sm"
                >
                  <option value="retrato">Retrato (A4)</option>
                  <option value="paisagem">Paisagem (A4)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Qtd de Linhas</Label>
                <Input
                  type="number"
                  min="10"
                  max="50"
                  value={config.linhas}
                  onChange={(e) => setConfig({ ...config, linhas: parseInt(e.target.value) || 25 })}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Altura Linha (px)</Label>
                <Input
                  type="number"
                  min="18"
                  max="40"
                  value={config.alturaLinha}
                  onChange={(e) => setConfig({ ...config, alturaLinha: parseInt(e.target.value) || 22 })}
                  className="h-9"
                />
              </div>
            </div>

            {/* Configuração de largura das colunas */}
            <div className="pt-3 border-t">
              <Label className="text-xs font-semibold text-slate-700 mb-2 block">Largura das Colunas (px)</Label>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                <div>
                  <Label className="text-[10px] text-slate-500">Data</Label>
                  <Input
                    type="number"
                    min="50"
                    max="150"
                    value={config.larguraData}
                    onChange={(e) => setConfig({ ...config, larguraData: parseInt(e.target.value) || 70 })}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-500">Máquina</Label>
                  <Input
                    type="number"
                    min="100"
                    max="350"
                    value={config.larguraMaquina}
                    onChange={(e) => setConfig({ ...config, larguraMaquina: parseInt(e.target.value) || 200 })}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-500">Horímetro</Label>
                  <Input
                    type="number"
                    min="50"
                    max="120"
                    value={config.larguraHorimetro}
                    onChange={(e) => setConfig({ ...config, larguraHorimetro: parseInt(e.target.value) || 80 })}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-500">Entrada</Label>
                  <Input
                    type="number"
                    min="40"
                    max="120"
                    value={config.larguraEntrada}
                    onChange={(e) => setConfig({ ...config, larguraEntrada: parseInt(e.target.value) || 70 })}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-500">Saída</Label>
                  <Input
                    type="number"
                    min="40"
                    max="120"
                    value={config.larguraSaida}
                    onChange={(e) => setConfig({ ...config, larguraSaida: parseInt(e.target.value) || 70 })}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-500">Visto</Label>
                  <Input
                    type="number"
                    min="30"
                    max="100"
                    value={config.larguraVisto}
                    onChange={(e) => setConfig({ ...config, larguraVisto: parseInt(e.target.value) || 60 })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Área de Impressão */}
      <div className={`bg-white print:shadow-none ${config.orientacao === 'paisagem' ? 'print:landscape' : ''}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page {
              size: ${config.orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'};
              margin: 1cm;
            }
            body * {
              visibility: hidden;
            }
            .print-area, .print-area * {
              visibility: visible;
            }
            .print-area {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
            }
            header, nav, .no-print, .print\\:hidden {
              display: none !important;
            }
          }
        `}} />

        <div className="print-area p-6 print:p-0">
          {/* Cabeçalho igual aos relatórios */}
          <div className="border-b-2 border-black pb-1 mb-3">
            <div className="flex items-center justify-between gap-3">
              {empresa?.logotipo_url ? (
                <img 
                  src={empresa.logotipo_url} 
                  alt={empresa.apelido || "Logo"}
                  className="h-20 w-20 object-contain"
                />
              ) : (
                <div className="h-20 w-20 bg-gray-100 flex items-center justify-center border">
                  <Fuel className="w-8 h-8 text-gray-400" />
                </div>
              )}
              <div className="flex-1 text-center">
                <h1 className="text-base font-bold leading-tight uppercase">{empresa?.nome || 'Empresa'}</h1>
                {empresa?.apelido && empresa.apelido !== empresa.nome && (
                  <p className="text-xs leading-tight">{empresa.apelido}</p>
                )}
                {empresa?.endereco && (
                  <p className="text-xs leading-tight">
                    {empresa.endereco}
                    {empresa?.cidade && empresa?.estado && `, ${empresa.cidade}-${empresa.estado}`}
                  </p>
                )}
                <p className="text-xs leading-tight">
                  {empresa?.telefone && `Telefone: ${empresa.telefone}`}
                  {empresa?.email && ` E-mail: ${empresa.email}`}
                </p>
              </div>
            </div>
            
            {/* Título */}
            <div className="mt-2">
              <h2 className="text-base font-bold">CONTROLE DE COMBUSTÍVEL - {config.tipoCombustivel}</h2>
              <p className="text-xs text-gray-600">
                {config.mes ? `${config.mes} / ${config.ano}` : `ANO: ${config.ano}`}
              </p>
            </div>
          </div>

          {/* Informações iniciais */}
          <div className="grid grid-cols-3 gap-3 mb-3 text-[11px]">
            <div className="border border-black p-1.5">
              <span className="font-bold">SALDO ANTERIOR:</span>
              <span className="ml-2 border-b border-black inline-block w-20"></span> L
            </div>
            <div className="border border-black p-1.5">
              <span className="font-bold">TANQUE:</span>
              <span className="ml-2 border-b border-black inline-block w-28"></span>
            </div>
            <div className="border border-black p-1.5">
              <span className="font-bold">CAPACIDADE:</span>
              <span className="ml-2 border-b border-black inline-block w-16"></span> L
            </div>
          </div>

          {/* Tabela de Controle */}
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-black p-1 font-bold" style={{ width: `${config.larguraData}px` }}>DATA</th>
                <th className="border border-black p-1 font-bold" style={{ width: `${config.larguraMaquina}px` }}>MÁQUINA / VEÍCULO</th>
                <th className="border border-black p-1 font-bold" style={{ width: `${config.larguraHorimetro}px` }}>HORÍMETRO</th>
                <th className="border border-black p-1 font-bold" style={{ width: `${config.larguraEntrada}px` }}>ENTRADA (L)</th>
                <th className="border border-black p-1 font-bold" style={{ width: `${config.larguraSaida}px` }}>SAÍDA (L)</th>
                <th className="border border-black p-1 font-bold" style={{ width: `${config.larguraVisto}px` }}>VISTO</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: config.linhas }).map((_, idx) => (
                <tr key={idx}>
                  <td className="border border-gray-400 p-1" style={{ height: `${config.alturaLinha}px` }}></td>
                  <td className="border border-gray-400 p-1"></td>
                  <td className="border border-gray-400 p-1"></td>
                  <td className="border border-gray-400 p-1"></td>
                  <td className="border border-gray-400 p-1"></td>
                  <td className="border border-gray-400 p-1"></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Resumo do mês */}
          <div className="grid grid-cols-3 gap-3 mt-3 text-[11px]">
            <div className="border border-black p-1.5 text-center bg-gray-100">
              <span className="font-bold block">TOTAL ENTRADA</span>
              <span className="border-b border-black inline-block w-20 mt-1"></span> L
            </div>
            <div className="border border-black p-1.5 text-center bg-gray-100">
              <span className="font-bold block">TOTAL SAÍDA</span>
              <span className="border-b border-black inline-block w-20 mt-1"></span> L
            </div>
            <div className="border border-black p-1.5 text-center bg-gray-100">
              <span className="font-bold block">SALDO FINAL</span>
              <span className="border-b border-black inline-block w-20 mt-1"></span> L
            </div>
          </div>

          {/* Observações */}
          <div className="mt-3 border border-black p-2 text-[11px]">
            <span className="font-bold">OBSERVAÇÕES:</span>
            <div className="border-b border-black mt-3" style={{ minHeight: '30px' }}></div>
          </div>

          {/* Assinaturas */}
          <div className="flex justify-between mt-6 pt-4 text-[11px]">
            <div className="text-center flex-1">
              <div className="border-t border-black mx-6 pt-1">
                <span className="font-bold">Responsável pelo Abastecimento</span>
              </div>
            </div>
            <div className="text-center flex-1">
              <div className="border-t border-black mx-6 pt-1">
                <span className="font-bold">Supervisor / Gerente</span>
              </div>
            </div>
          </div>

          {/* Rodapé */}
          <div className="mt-4 pt-2 border-t border-gray-300 text-center text-[10px] text-gray-500">
            <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}