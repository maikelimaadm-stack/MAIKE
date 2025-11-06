
import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function FichaFornecedor({ fornecedor, open, onClose }) {
  if (!fornecedor) return null;

  const handlePrint = () => {
    window.print();
  };

  const isPessoaFisica = fornecedor.tipo_pessoa === 'Física';

  const formatarData = (dataString) => {
    if (!dataString) return '-';
    try {
      const date = new Date(dataString);
      if (isNaN(date.getTime())) return '-';
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch {
      return '-';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl p-0 print:max-w-full print:shadow-none print:border-0">
        <div className="print:hidden flex justify-end gap-2 p-4 border-b">
          <Button onClick={handlePrint} size="sm" className="gap-2 bg-green-600 hover:bg-green-700">
            <Printer className="w-4 h-4" />
            Imprimir
          </Button>
          <Button variant="outline" onClick={onClose} size="sm" className="gap-2">
            <X className="w-4 h-4" />
            Fechar
          </Button>
        </div>

        <div id="ficha-content" className="p-8">
          <style dangerouslySetInnerHTML={{__html: `
            @media print {
              @page {
                size: A4;
                margin: 0.5cm; /* Changed from 1cm to 0.5cm */
              }
              body * {
                visibility: hidden;
              }
              #ficha-content,
              #ficha-content * {
                visibility: visible;
              }
              #ficha-content {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
              }
              .page-footer { /* New CSS for page footer */
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                height: 20px;
                font-size: 9px;
                display: flex;
                justify-content: space-between;
                padding: 0 0.5cm;
              }
            }
          `}} />
          
          {/* Cabeçalho */}
          <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-6">
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
              alt="Fazenda Palmital"
              className="h-16 print:h-20"
            />
            <div className="text-right">
              <h1 className="text-2xl font-bold">Fazenda Palmital</h1>
              <p className="text-sm">Antonio Lemos Beraldo</p>
              <p className="text-xs">Vila Bela da Ss. Trindade - MT</p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-bold text-center">FICHA DE CADASTRO - {isPessoaFisica ? 'PESSOA FÍSICA' : 'PESSOA JURÍDICA'}</h2>
          </div>

          {/* Dados Principais */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-xs text-gray-600 uppercase">Nome {isPessoaFisica ? 'Completo' : 'Fantasia'}</p>
              <p className="font-semibold text-lg border-b border-gray-300">{fornecedor.nome}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase">Tipo de Pessoa</p>
              <p className="font-semibold text-lg border-b border-gray-300">{fornecedor.tipo_pessoa}</p>
            </div>
          </div>

          {/* Documentos Pessoa Física */}
          {isPessoaFisica && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <p className="text-xs text-gray-600 uppercase">CPF</p>
                <p className="font-semibold border-b border-gray-300">{fornecedor.cpf || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 uppercase">RG</p>
                <p className="font-semibold border-b border-gray-300">{fornecedor.rg || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 uppercase">Data de Nascimento</p>
                <p className="font-semibold border-b border-gray-300">
                  {formatarData(fornecedor.data_nascimento)}
                </p>
              </div>
            </div>
          )}

          {/* Documentos Pessoa Jurídica */}
          {!isPessoaFisica && (
            <>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-xs text-gray-600 uppercase">Razão Social</p>
                  <p className="font-semibold border-b border-gray-300">{fornecedor.razao_social || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 uppercase">CNPJ</p>
                  <p className="font-semibold border-b border-gray-300">{fornecedor.cnpj || '-'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-xs text-gray-600 uppercase">Inscrição Estadual</p>
                  <p className="font-semibold border-b border-gray-300">{fornecedor.inscricao_estadual || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 uppercase">Nome do Responsável</p>
                  <p className="font-semibold border-b border-gray-300">{fornecedor.nome_responsavel || '-'}</p>
                </div>
              </div>
            </>
          )}

          {/* Contato */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-xs text-gray-600 uppercase">Telefone</p>
              <p className="font-semibold border-b border-gray-300">{fornecedor.telefone || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase">E-mail</p>
              <p className="font-semibold border-b border-gray-300">{fornecedor.email || '-'}</p>
            </div>
          </div>

          {/* Endereço */}
          <div className="mb-4">
            <p className="text-xs text-gray-600 uppercase">Endereço</p>
            <p className="font-semibold border-b border-gray-300">{fornecedor.endereco || '-'}</p>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div>
              <p className="text-xs text-gray-600 uppercase">Cidade</p>
              <p className="font-semibold border-b border-gray-300">{fornecedor.cidade || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase">Estado</p>
              <p className="font-semibold border-b border-gray-300">{fornecedor.estado || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase">CEP</p>
              <p className="font-semibold border-b border-gray-300">{fornecedor.cep || '-'}</p>
            </div>
          </div>

          {/* Observações */}
          {fornecedor.observacoes && (
            <div className="mb-6">
              <p className="text-xs text-gray-600 uppercase">Observações</p>
              <p className="border border-gray-300 p-3 rounded min-h-[80px]">{fornecedor.observacoes}</p>
            </div>
          )}

          {/* Rodapé customizado */}
          <div className="page-footer hidden print:flex">
            <span>Página 1 de 1</span>
            <span>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
