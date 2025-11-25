import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Truck, Fuel, Wrench, Plus, Calendar, DollarSign } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import FormularioAbastecimento from "./FormularioAbastecimento";
import FormularioManutencao from "./FormularioManutencao";

export default function FichaMaquina({ maquina, onClose }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showAbastecimento, setShowAbastecimento] = useState(false);
  const [showManutencao, setShowManutencao] = useState(false);
  const queryClient = useQueryClient();

  const { data: abastecimentos = [] } = useQuery({
    queryKey: ['abastecimentos', maquina.id],
    queryFn: async () => {
      const all = await base44.entities.AbastecimentoMaquina.list('-data_abastecimento');
      return all.filter(a => a.maquina_id === maquina.id);
    },
  });

  const { data: manutencoes = [] } = useQuery({
    queryKey: ['manutencoes', maquina.id],
    queryFn: async () => {
      const all = await base44.entities.ManutencaoMaquina.list('-data_manutencao');
      return all.filter(m => m.maquina_id === maquina.id);
    },
  });

  const totalCombustivel = abastecimentos.reduce((sum, a) => sum + (a.quantidade_litros || 0), 0);
  const totalGastoCombustivel = abastecimentos.reduce((sum, a) => sum + (a.valor_total || 0), 0);
  const totalGastoManutencao = manutencoes.reduce((sum, m) => sum + (m.valor_total || 0), 0);

  const statusColors = {
    'Ativo': 'bg-emerald-100 text-emerald-800',
    'Em Manutenção': 'bg-amber-100 text-amber-800',
    'Inativo': 'bg-slate-100 text-slate-800',
    'Vendido': 'bg-red-100 text-red-800',
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-start gap-4">
        <div className="w-20 h-20 bg-slate-100 rounded-lg flex items-center justify-center">
          {maquina.foto_url ? (
            <img src={maquina.foto_url} alt={maquina.nome} className="w-full h-full object-cover rounded-lg" />
          ) : (
            <Truck className="w-10 h-10 text-slate-400" />
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-slate-900">{maquina.nome}</h2>
            <Badge className={statusColors[maquina.status]}>{maquina.status}</Badge>
          </div>
          <p className="text-sm text-slate-600">{maquina.tipo} - {maquina.marca} {maquina.modelo}</p>
          <p className="text-xs text-slate-500">{maquina.placa || maquina.codigo || '-'}</p>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-blue-700">{maquina.horimetro_atual || 0}h</div>
            <div className="text-xs text-blue-600">Horímetro</div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-emerald-700">{totalCombustivel.toFixed(0)}L</div>
            <div className="text-xs text-emerald-600">Combustível</div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-amber-700">{manutencoes.length}</div>
            <div className="text-xs text-amber-600">Manutenções</div>
          </CardContent>
        </Card>
        <Card className="bg-purple-50 border-purple-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-purple-700">
              R$ {(totalGastoCombustivel + totalGastoManutencao).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-purple-600">Total Gasto</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="abastecimentos" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="abastecimentos" className="text-xs">
            <Fuel className="w-3 h-3 mr-1" />
            Abastecimentos
          </TabsTrigger>
          <TabsTrigger value="manutencoes" className="text-xs">
            <Wrench className="w-3 h-3 mr-1" />
            Manutenções
          </TabsTrigger>
          <TabsTrigger value="info" className="text-xs">
            <Truck className="w-3 h-3 mr-1" />
            Informações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="abastecimentos" className="mt-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold">Histórico de Abastecimentos</h3>
            <Button size="sm" onClick={() => setShowAbastecimento(true)} className="h-8 gap-1">
              <Plus className="w-3 h-3" />
              Abastecer
            </Button>
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {abastecimentos.length === 0 ? (
              <p className="text-center text-slate-500 text-sm py-8">Nenhum abastecimento registrado</p>
            ) : abastecimentos.map(a => (
              <div key={a.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <div className="text-sm font-medium">{a.quantidade_litros}L - {a.tipo_combustivel}</div>
                  <div className="text-xs text-slate-500">
                    {format(new Date(a.data_abastecimento), 'dd/MM/yyyy')} • {a.local_abastecimento}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-emerald-700">R$ {a.valor_total?.toFixed(2)}</div>
                  <div className="text-xs text-slate-500">R$ {a.valor_litro?.toFixed(2)}/L</div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="manutencoes" className="mt-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold">Histórico de Manutenções</h3>
            <Button size="sm" onClick={() => setShowManutencao(true)} className="h-8 gap-1">
              <Plus className="w-3 h-3" />
              Manutenção
            </Button>
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {manutencoes.length === 0 ? (
              <p className="text-center text-slate-500 text-sm py-8">Nenhuma manutenção registrada</p>
            ) : manutencoes.map(m => (
              <div key={m.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <div className="text-sm font-medium">{m.categoria} - {m.tipo_manutencao}</div>
                  <div className="text-xs text-slate-500">
                    {format(new Date(m.data_manutencao), 'dd/MM/yyyy')} • {m.descricao?.substring(0, 30)}...
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-amber-700">R$ {m.valor_total?.toFixed(2)}</div>
                  <Badge variant="outline" className="text-[10px]">{m.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="info" className="mt-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-slate-500">Chassi:</span> <span className="font-medium">{maquina.chassi || '-'}</span></div>
            <div><span className="text-slate-500">Renavam:</span> <span className="font-medium">{maquina.renavam || '-'}</span></div>
            <div><span className="text-slate-500">Ano:</span> <span className="font-medium">{maquina.ano_fabricacao || '-'}</span></div>
            <div><span className="text-slate-500">Potência:</span> <span className="font-medium">{maquina.potencia_cv ? `${maquina.potencia_cv} CV` : '-'}</span></div>
            <div><span className="text-slate-500">Consumo Médio:</span> <span className="font-medium">{maquina.consumo_medio || '-'}</span></div>
            <div><span className="text-slate-500">Tanque:</span> <span className="font-medium">{maquina.capacidade_tanque ? `${maquina.capacidade_tanque}L` : '-'}</span></div>
            <div><span className="text-slate-500">Aquisição:</span> <span className="font-medium">{maquina.data_aquisicao ? format(new Date(maquina.data_aquisicao), 'dd/MM/yyyy') : '-'}</span></div>
            <div><span className="text-slate-500">Valor Aquisição:</span> <span className="font-medium">{maquina.valor_aquisicao ? `R$ ${maquina.valor_aquisicao.toLocaleString()}` : '-'}</span></div>
          </div>
          {maquina.observacoes && (
            <div className="mt-4 p-3 bg-slate-50 rounded-lg">
              <div className="text-xs text-slate-500 mb-1">Observações:</div>
              <div className="text-sm">{maquina.observacoes}</div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showAbastecimento} onOpenChange={setShowAbastecimento}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar Abastecimento</DialogTitle>
          </DialogHeader>
          <FormularioAbastecimento
            maquina={maquina}
            onSave={() => {
              setShowAbastecimento(false);
              queryClient.invalidateQueries({ queryKey: ['abastecimentos'] });
            }}
            onCancel={() => setShowAbastecimento(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showManutencao} onOpenChange={setShowManutencao}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar Manutenção</DialogTitle>
          </DialogHeader>
          <FormularioManutencao
            maquina={maquina}
            onSave={() => {
              setShowManutencao(false);
              queryClient.invalidateQueries({ queryKey: ['manutencoes'] });
            }}
            onCancel={() => setShowManutencao(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}