import React, { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function VisualizarFicha() {
  const urlParams = new URLSearchParams(window.location.search);
  const fichaId = urlParams.get('id');
  const autoPrint = urlParams.get('print') === '1';
  
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: ficha, isLoading: loadingFicha } = useQuery({
    queryKey: ['ficha', fichaId],
    queryFn: async () => {
      const fichas = await base44.entities.FichaPersonalizada.list();
      return fichas.find(f => f.id === fichaId);
    },
    enabled: !!fichaId,
  });

  const { data: empresa } = useQuery({
    queryKey: ['empresa-ficha', empresaSelecionadaId],
    queryFn: async () => {
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    if (autoPrint && ficha && empresa) {
      setTimeout(() => window.print(), 500);
    }
  }, [autoPrint, ficha, empresa]);

  if (loadingFicha) {
    return <div className="p-6 text-center text-slate-500">Carregando...</div>;
  }

  if (!ficha) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500 mb-4">Ficha não encontrada</p>
        <Link to={createPageUrl("FichasPersonalizadas")}>
          <Button variant="outline" size="sm">Voltar</Button>
        </Link>
      </div>
    );
  }

  const renderCampo = (campo, index) => {
    const larguraStyle = { width: campo.largura };
    
    switch (campo.tipo) {
      case 'texto':
        return (
          <div key={campo.id} style={larguraStyle} className="inline-block align-top p-1">
            <div className="text-[10px] font-semibold text-gray-700 mb-0.5">{campo.label}:</div>
            <div className="border-b border-black min-h-[20px]"></div>
          </div>
        );
      
      case 'texto_longo':
        return (
          <div key={campo.id} style={larguraStyle} className="inline-block align-top p-1">
            <div className="text-[10px] font-semibold text-gray-700 mb-0.5">{campo.label}:</div>
            <div 
              className="border border-gray-400" 
              style={{ minHeight: `${(campo.altura || 3) * 20}px` }}
            ></div>
          </div>
        );
      
      case 'numero':
        return (
          <div key={campo.id} style={larguraStyle} className="inline-block align-top p-1">
            <div className="text-[10px] font-semibold text-gray-700 mb-0.5">{campo.label}:</div>
            <div className="border-b border-black min-h-[20px]"></div>
          </div>
        );
      
      case 'data':
        return (
          <div key={campo.id} style={larguraStyle} className="inline-block align-top p-1">
            <div className="text-[10px] font-semibold text-gray-700 mb-0.5">{campo.label}:</div>
            <div className="border-b border-black min-h-[20px] flex items-end">
              <span className="text-[10px] text-gray-400">____/____/________</span>
            </div>
          </div>
        );
      
      case 'hora':
        return (
          <div key={campo.id} style={larguraStyle} className="inline-block align-top p-1">
            <div className="text-[10px] font-semibold text-gray-700 mb-0.5">{campo.label}:</div>
            <div className="border-b border-black min-h-[20px] flex items-end">
              <span className="text-[10px] text-gray-400">____:____</span>
            </div>
          </div>
        );
      
      case 'checkbox':
        return (
          <div key={campo.id} style={larguraStyle} className="inline-block align-top p-1">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border border-black"></div>
              <span className="text-[10px] font-semibold text-gray-700">{campo.label}</span>
            </div>
          </div>
        );
      
      case 'selecao':
        return (
          <div key={campo.id} style={larguraStyle} className="inline-block align-top p-1">
            <div className="text-[10px] font-semibold text-gray-700 mb-1">{campo.label}:</div>
            <div className="flex flex-wrap gap-2">
              {(campo.opcoes || []).map((opcao, i) => (
                <div key={i} className="flex items-center gap-1">
                  <div className="w-3 h-3 border border-black rounded-full"></div>
                  <span className="text-[10px]">{opcao}</span>
                </div>
              ))}
            </div>
          </div>
        );
      
      case 'assinatura':
        return (
          <div key={campo.id} style={larguraStyle} className="inline-block align-top p-1">
            <div 
              className="border-b border-black" 
              style={{ minHeight: `${(campo.altura || 2) * 25}px` }}
            ></div>
            <div className="text-[10px] text-center text-gray-600 mt-0.5">{campo.label}</div>
          </div>
        );
      
      case 'separador':
        return (
          <div key={campo.id} className="w-full p-1">
            <hr className="border-t border-gray-400" />
          </div>
        );
      
      case 'titulo_secao':
        return (
          <div key={campo.id} className="w-full p-1">
            <div className="text-xs font-bold text-gray-800 border-b border-gray-400 pb-0.5 mt-2">
              {campo.label}
            </div>
          </div>
        );
      
      case 'tabela':
        const colunas = campo.colunas || 3;
        const linhas = campo.linhas || 5;
        return (
          <div key={campo.id} className="w-full p-1">
            <div className="text-[10px] font-semibold text-gray-700 mb-1">{campo.label}:</div>
            <table className="w-full border-collapse">
              <tbody>
                {Array.from({ length: linhas }).map((_, rowIndex) => (
                  <tr key={rowIndex}>
                    {Array.from({ length: colunas }).map((_, colIndex) => (
                      <td key={colIndex} className="border border-gray-400 h-6 px-1"></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      
      case 'espaco':
        return (
          <div 
            key={campo.id} 
            className="w-full"
            style={{ height: `${(campo.altura || 1) * 20}px` }}
          ></div>
        );
      
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Barra de Ferramentas */}
      <div className="bg-white border-b p-2 flex justify-between items-center print:hidden sticky top-0 z-10">
        <Link to={createPageUrl("FichasPersonalizadas")}>
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1">
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Button>
        </Link>
        <Button onClick={() => window.print()} size="sm" className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700">
          <Printer className="w-4 h-4" />
          Imprimir
        </Button>
      </div>

      {/* Área de Impressão */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page { 
            size: ${ficha.orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'}; 
            margin: 1cm; 
          }
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { 
            position: absolute; 
            left: 0; 
            top: 0; 
            width: 100%; 
            background: white;
            padding: 0;
          }
          .print\\:hidden { display: none !important; }
        }
      `}} />

      <div className="print-area bg-white max-w-4xl mx-auto my-4 p-6 shadow-lg print:shadow-none print:my-0 print:max-w-none">
        {/* Cabeçalho */}
        {(ficha.mostrar_logo || ficha.mostrar_cabecalho) && (
          <div className="border-b-2 border-black pb-2 mb-3">
            <div className="flex items-start gap-4">
              {ficha.mostrar_logo && empresa?.logotipo_url && (
                <img 
                  src={empresa.logotipo_url} 
                  alt={empresa.apelido || "Logo"} 
                  className="h-16 w-16 object-contain"
                />
              )}
              {ficha.mostrar_cabecalho && (
                <div className="flex-1">
                  <h1 className="text-sm font-bold uppercase">{empresa?.nome || 'Empresa'}</h1>
                  {empresa?.apelido && empresa.apelido !== empresa.nome && (
                    <p className="text-[10px]">{empresa.apelido}</p>
                  )}
                  {empresa?.endereco && (
                    <p className="text-[10px]">
                      {empresa.endereco}
                      {empresa?.cidade && empresa?.estado && `, ${empresa.cidade}-${empresa.estado}`}
                    </p>
                  )}
                  {empresa?.telefone && <p className="text-[10px]">Tel: {empresa.telefone}</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Título da Ficha */}
        <div className="text-center mb-4">
          <h2 className="text-base font-bold uppercase">{ficha.titulo_ficha}</h2>
          {ficha.subtitulo_ficha && (
            <p className="text-xs text-gray-600">{ficha.subtitulo_ficha}</p>
          )}
        </div>

        {/* Campos */}
        <div className="flex flex-wrap">
          {(ficha.campos || []).map((campo, index) => renderCampo(campo, index))}
        </div>

        {/* Rodapé */}
        {(ficha.rodape || ficha.mostrar_data_impressao) && (
          <div className="mt-6 pt-2 border-t border-gray-300 text-[10px] text-gray-500">
            <div className="flex justify-between">
              {ficha.rodape && <span>{ficha.rodape}</span>}
              {ficha.mostrar_data_impressao && (
                <span>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}