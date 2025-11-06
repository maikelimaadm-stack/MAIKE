import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Users, Trash2, Shield, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

export default function Usuarios() {
  const queryClient = useQueryClient();

  const { data: usuarios, isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: async () => {
      try {
        return await base44.entities.User.list('-created_date');
      } catch (error) {
        return [];
      }
    },
    initialData: [],
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.User.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      toast.success('Usuário excluído com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao excluir usuário.');
    }
  });

  const handleDelete = (id) => {
    if (currentUser?.id === id) {
      toast.error('Você não pode excluir seu próprio usuário!');
      return;
    }
    
    if (window.confirm('Tem certeza que deseja excluir este usuário?')) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Usuários do Sistema</h1>
            <p className="text-slate-600">Visualize os usuários cadastrados</p>
          </div>
        </div>
      </div>

      {/* Card de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-lg border-slate-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-700">Total de Usuários</CardTitle>
            <Users className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">{usuarios.length}</div>
            <p className="text-xs text-slate-600 mt-1">Usuários cadastrados</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-slate-200 bg-gradient-to-br from-white to-purple-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-700">Administradores</CardTitle>
            <Shield className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">
              {usuarios.filter(u => u.role === 'admin').length}
            </div>
            <p className="text-xs text-slate-600 mt-1">Com permissões administrativas</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-slate-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-700">Operadores</CardTitle>
            <UserIcon className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">
              {usuarios.filter(u => u.role === 'user').length}
            </div>
            <p className="text-xs text-slate-600 mt-1">Usuários padrão</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de Usuários */}
      <Card className="shadow-xl border-slate-200">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-200">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <Users className="w-5 h-5" />
            Lista de Usuários
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="font-semibold text-slate-700">Nome</TableHead>
                  <TableHead className="font-semibold text-slate-700">Email</TableHead>
                  <TableHead className="font-semibold text-slate-700">Perfil</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      Carregando usuários...
                    </TableCell>
                  </TableRow>
                ) : usuarios.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Users className="w-12 h-12" />
                        <p>Nenhum usuário encontrado</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  usuarios.map((user) => (
                    <TableRow key={user.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <TableCell className="font-medium text-slate-900">
                        {user.full_name}
                        {currentUser?.id === user.id && (
                          <Badge variant="outline" className="ml-2 text-xs">Você</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-700">{user.email}</TableCell>
                      <TableCell>
                        <Badge className={user.role === 'admin' ? 'bg-purple-100 text-purple-800 border-purple-300' : 'bg-green-100 text-green-800 border-green-300'}>
                          {user.role === 'admin' ? (
                            <><Shield className="w-3 h-3 mr-1" /> Administrador</>
                          ) : (
                            <><UserIcon className="w-3 h-3 mr-1" /> Operador</>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(user.id)}
                            className="hover:bg-red-50 hover:text-red-700"
                            title="Excluir"
                            disabled={currentUser?.id === user.id}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}