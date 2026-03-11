import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MapPin, Calendar, User as UserIcon, Paperclip, Save, Plus, History, ClipboardList } from "lucide-react";
import { fmtNum, fmtHa } from "../common/formatNumber";
import { format } from "date-fns";
import { toast } from "sonner";
import FormularioOperacao from "../operacoes/FormularioOperacao";

export default function AreaPanel({ area, onClose }) {
  const queryClient = useQueryClient();
  const empresaId = localStorage.getItem('empresa_selecionada_id');

  const [currentUser, setCurrentUser] = useState(null);
  useEffect(() => {
    (async () => {
      try { setCurrentUser(await base44.auth.me()); } catch { setCurrentUser(null); }
    })();
  }, []);

  // Tarefas da área
  const { data: tarefas = [], isLoading: tarefasLoading } = useQuery({
    queryKey: ['tarefas-area', area?.id],
    queryFn: async () => {
      const all = await base44.entities.TarefaMapa.list();
      return all.filter(t => t.area_id === area.id).sort((a,b) => new Date(b.updated_date||0) - new Date(a.updated_date||0));
    },
    enabled: !!area?.id,
    staleTime: 0,
  });

  const { data: operacoes = [], isLoading: operacoesLoading } = useQuery({
    queryKey: ['operacoes-area', area?.id],
    queryFn: async () => {
      const all = await base44.entities.OperacaoAgricola.list('-data_inicio');
      return all.filter(o => o.area_id === area.id);
    },
    enabled: !!area?.id,
    staleTime: 0,
  });

  const tarefasResumo = useMemo(() => {
    const byStatus = { 'Pendente': 0, 'Em Andamento': 0, 'Concluída': 0 };
    tarefas.forEach(t => { if (byStatus[t.status] !== undefined) byStatus[t.status]++; });
    return byStatus;
  }, [tarefas]);

  // Form Novo Lançamento (Tarefa de Manejo)
  const [titulo, setTitulo] = useState("");
  const [dataPrevista, setDataPrevista] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [novoTipo, setNovoTipo] = useState('tarefa');

  useEffect(() => {
    if (currentUser && !responsavel) {
      setResponsavel(currentUser.full_name || currentUser.email || "");
    }
  }, [currentUser]);

  const createMutation = useMutation({
    mutationFn: (payload) => base44.entities.TarefaMapa.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-area', area?.id] });
      toast.success('Lançamento criado');
      // reset form
      setTitulo(""); setDataPrevista(""); setObservacoes(""); setFiles([]);
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!titulo) { toast.error('Informe a atividade'); return; }
    setSubmitting(true);
    try {
      // Upload anexos (se houver)
      const anexos_urls = [];
      if (files && files.length > 0) {
        const uploads = await Promise.all(Array.from(files).map(async (f) => {
          const { file_url } = await base44.integrations.Core.UploadFile({ file: f });
          return file_url;
        }));
        uploads.forEach(u => anexos_urls.push(u));
      }

      const payload = {
        empresa_id: empresaId,
        titulo,
        tipo: 'Manejo',
        status: 'Pendente',
        data_prevista: dataPrevista || undefined,
        area_id: area.id,
        area_nome: area.nome,
        responsavel: responsavel || undefined,
        descricao: observacoes || undefined,
        anexos_urls: anexos_urls.length ? anexos_urls : undefined,
      };
      await createMutation.mutateAsync(payload);
    } catch (err) {
      toast.error('Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full flex flex-col" translate="no">
      {/* Cabeçalho */}
      <div className="px-4 py-3 border-b bg-white">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-bold text-slate-900">{area.nome}</span>
            </div>
            <div className="text-xs text-slate-600 mt-1 flex gap-2">
              <span>{fmtHa(area.tamanho_hectares || 0)}</span>
              <span>•</span>
              <span>{area.tipo_pastagem || 'Sem tipo'}</span>
              {area.tipo_cultura && <><span>•</span><span>{area.tipo_cultura}</span></>}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="resumo" className="h-full flex flex-col">
          <div className="px-4 pt-3">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="resumo" className="text-xs">Resumo</TabsTrigger>
              <TabsTrigger value="novo" className="text-xs">Novo Lançamento</TabsTrigger>
              <TabsTrigger value="historico" className="text-xs">Histórico</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="resumo" className="px-4 py-3 space-y-3 overflow-auto">
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-lg font-bold text-slate-700">{tarefasResumo['Pendente']}</div>
                <div className="text-[10px] text-slate-600">Pendentes</div>
              </div>
              <div className="text-center p-2 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-lg font-bold text-slate-700">{tarefasResumo['Em Andamento']}</div>
                <div className="text-[10px] text-slate-600">Em Andamento</div>
              </div>
              <div className="text-center p-2 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-lg font-bold text-slate-700">{tarefasResumo['Concluída']}</div>
                <div className="text-[10px] text-slate-600">Concluídas</div>
              </div>
            </div>

            <Card className="border-slate-200 bg-slate-50">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <History className="w-4 h-4 text-slate-600" />
                  <span className="text-xs font-semibold text-slate-900">Últimos lançamentos</span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-auto">
                  {tarefasLoading ? (
                    <div className="text-xs text-slate-500">Carregando...</div>
                  ) : tarefas.length === 0 ? (
                    <div className="text-xs text-slate-500 py-4 text-center">Sem lançamentos</div>
                  ) : tarefas.slice(0,5).map(t => (
                    <div key={t.id} className="flex items-center justify-between p-2 bg-white rounded border border-slate-200">
                      <div>
                        <div className="text-xs font-medium">{t.titulo}</div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-2">
                          {t.data_prevista && <><Calendar className="w-3 h-3" />{format(new Date(t.data_prevista), 'dd/MM/yy')}</>}
                          {t.responsavel && <><UserIcon className="w-3 h-3" />{t.responsavel}</>}
                        </div>
                      </div>
                      <Badge className="text-[10px]">{t.status}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="novo" className="px-4 py-3 overflow-auto">
            <div className="mb-3 flex gap-2">
              <Button size="sm" variant={novoTipo==='tarefa' ? 'default' : 'outline'} className="h-8 text-xs" onClick={()=>setNovoTipo('tarefa')}>Tarefa</Button>
              <Button size="sm" variant={novoTipo==='operacao' ? 'default' : 'outline'} className="h-8 text-xs" onClick={()=>setNovoTipo('operacao')}>Operação</Button>
            </div>

            {novoTipo === 'tarefa' ? (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <Label className="text-xs">Atividade</Label>
                    <Input value={titulo} onChange={(e)=>setTitulo(e.target.value)} placeholder="Ex: Roçada, Aplicação, Manutenção" className="h-8 text-xs" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Data</Label>
                      <Input type="date" value={dataPrevista} onChange={(e)=>setDataPrevista(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">Responsável</Label>
                      <Input value={responsavel} onChange={(e)=>setResponsavel(e.target.value)} placeholder="Nome do responsável" className="h-8 text-xs" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Observações</Label>
                    <Textarea value={observacoes} onChange={(e)=>setObservacoes(e.target.value)} placeholder="Detalhes do serviço..." className="text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs">Anexos/Fotos</Label>
                    <div className="flex items-center gap-2">
                      <Input type="file" multiple accept="image/*" onChange={(e)=>setFiles(e.target.files)} className="h-8 text-xs" />
                      <Paperclip className="w-4 h-4 text-slate-500" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancelar</Button>
                  <Button type="submit" size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs" disabled={submitting}>
                    <Save className="w-3.5 h-3.5 mr-2" />
                    {submitting ? 'Salvando...' : 'Salvar'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-2">
                <FormularioOperacao
                  operacao={{ area_id: area.id, area_nome: area.nome }}
                  onSave={() => {
                    queryClient.invalidateQueries({ queryKey: ['operacoes-area'] });
                    toast.success('Operação registrada!');
                  }}
                  onCancel={() => {}}
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="historico" className="px-4 py-3 overflow-auto">
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">Tarefas</div>
                {tarefasLoading ? (
                  <div className="text-xs text-slate-500">Carregando...</div>
                ) : tarefas.length === 0 ? (
                  <div className="text-xs text-slate-500 text-center py-4">Sem tarefas</div>
                ) : tarefas.map(t => (
                  <Card key={t.id} className="border-slate-200">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-slate-900">{t.titulo}</div>
                        <Badge className="text-[10px]">{t.status}</Badge>
                      </div>
                      <div className="text-[10px] text-slate-600 mt-1 flex flex-wrap gap-3">
                        {t.data_prevista && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(t.data_prevista), 'dd/MM/yy')}</span>}
                        {t.responsavel && <span className="flex items-center gap-1"><UserIcon className="w-3 h-3" />{t.responsavel}</span>}
                      </div>
                      {t.descricao && (
                        <div className="text-xs text-slate-700 mt-2 whitespace-pre-wrap">{t.descricao}</div>
                      )}
                      {Array.isArray(t.anexos_urls) && t.anexos_urls.length > 0 && (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {t.anexos_urls.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer" className="block">
                              <img src={url} alt="anexo" className="w-full h-20 object-cover rounded border" />
                            </a>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">Operações</div>
                {operacoesLoading ? (
                  <div className="text-xs text-slate-500">Carregando...</div>
                ) : operacoes.length === 0 ? (
                  <div className="text-xs text-slate-500 text-center py-4">Sem operações</div>
                ) : operacoes.map(op => (
                  <Card key={op.id} className="border-slate-200">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-slate-900">{op.tipo_operacao}</div>
                        <Badge className="text-[10px]">{op.status}</Badge>
                      </div>
                      <div className="text-[10px] text-slate-600 mt-1 flex flex-wrap gap-3">
                        {op.data_inicio && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(op.data_inicio), 'dd/MM/yy')}</span>}
                        {op.maquina_nome && <span className="text-[10px]">{op.maquina_nome}</span>}
                        {op.hectares_trabalhados && <span className="text-[10px]">{op.hectares_trabalhados} ha</span>}
                      </div>
                      {op.custo_total && (
                        <div className="text-xs text-slate-700 mt-1">Custo: R$ {Number(op.custo_total).toFixed(2)}</div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}