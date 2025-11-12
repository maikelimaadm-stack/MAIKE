import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { UserPlus, Save, X, Shield, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const MODULOS_PERMISSOES = [
  {
    id: 'dashboard',
    nome: 'Dashboard',
    acoes: ['visualizar']
  },
  {
    id: 'pesagens',
    nome: 'Pesagens',
    acoes: ['visualizar', 'incluir', 'editar', 'excluir', 'imprimir']
  },
  {
    id: 'custos_safra',
    nome: 'Custos de Safra',
    acoes: ['visualizar', 'incluir', 'editar', 'excluir']
  },
  {
    id: 'movimentacoes_estoque',
    nome: 'Movimentações Estoque',
    acoes: ['visualizar', 'incluir', 'editar', 'excluir']
  },
  {
    id: 'financeiro',
    nome: 'Financeiro',
    acoes: ['visualizar', 'incluir', 'editar', 'excluir', 'dar_baixa']
  },
  {
    id: 'fiscal',
    nome: 'Fiscal',
    acoes: ['visualizar']
  },
  {
    id: 'fornecedores',
    nome: 'Fornecedores/Clientes',
    acoes: ['visualizar', 'incluir', 'editar', 'excluir', 'imprimir']
  },
  {
    id: 'produtos',
    nome: 'Produtos',
    acoes: ['visualizar', 'incluir', 'editar', 'excluir', 'imprimir']
  },
  {
    id: 'cadastros',
    nome: 'Cadastros',
    acoes: ['visualizar', 'editar']
  },
  {
    id: 'relatorios',
    nome: 'Relatórios',
    acoes: ['visualizar', 'exportar']
  },
  {
    id: 'usuarios',
    nome: 'Usuários',
    acoes: ['visualizar', 'incluir', 'editar', 'excluir']
  }
];

const ACOES_LABELS = {
  visualizar: 'Visualizar',
  incluir: 'Incluir',
  editar: 'Editar',
  excluir: 'Excluir',
  imprimir: 'Imprimir',
  exportar: 'Exportar',
  dar_baixa: 'Dar Baixa'
};

export default function FormularioUsuario({ onSubmit, onCancel, initialData }) {
  const [showSenha, setShowSenha] = useState(false);
  const [formData, setFormData] = useState(() => {
    const defaults = {
      full_name: "",
      email: "",
      cpf: "",
      senha: "",
      telefone: "",
      cargo: "",
      role: "user",
      ativo: true,
      permissoes: MODULOS_PERMISSOES.reduce((acc, modulo) => {
        acc[modulo.id] = modulo.acoes.reduce((acoes, acao) => {
          acoes[acao] = false;
          return acoes;
        }, {});
        return acc;
      }, {})
    };

    if (!initialData) return defaults;

    return {
      ...defaults,
      ...initialData,
      senha: "", // Não preencher senha ao editar
      permissoes: initialData.permissoes || defaults.permissoes
    };
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePermissaoChange = (modulo, acao, value) => {
    setFormData(prev => ({
      ...prev,
      permissoes: {
        ...prev.permissoes,
        [modulo]: {
          ...prev.permissoes[modulo],
          [acao]: value
        }
      }
    }));
  };

  const handleMarcarTodosModulo = (modulo, value) => {
    const moduloConfig = MODULOS_PERMISSOES.find(m => m.id === modulo);
    if (!moduloConfig) return;

    setFormData(prev => ({
      ...prev,
      permissoes: {
        ...prev.permissoes,
        [modulo]: moduloConfig.acoes.reduce((acc, acao) => {
          acc[acao] = value;
          return acc;
        }, {})
      }
    }));
  };

  const handleMarcarTodosGeral = (value) => {
    setFormData(prev => ({
      ...prev,
      permissoes: MODULOS_PERMISSOES.reduce((acc, modulo) => {
        acc[modulo.id] = modulo.acoes.reduce((acoes, acao) => {
          acoes[acao] = value;
          return acoes;
        }, {});
        return acc;
      }, {})
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.full_name) {
      toast.error('❌ Nome completo é obrigatório!');
      return;
    }

    if (!formData.email) {
      toast.error('❌ E-mail é obrigatório!');
      return;
    }

    if (!formData.cpf) {
      toast.error('❌ CPF é obrigatório!');
      return;
    }

    if (!initialData && !formData.senha) {
      toast.error('❌ Senha é obrigatória!');
      return;
    }

    const data = {
      ...formData,
      full_name: formData.full_name.toUpperCase(),
      email: formData.email.toLowerCase(),
      cpf: formData.cpf.replace(/\D/g, ''),
      telefone: formData.telefone?.replace(/\D/g, ''),
      cargo: formData.cargo?.toUpperCase()
    };

    // Se estiver editando e senha estiver vazia, não enviar senha
    if (initialData && !formData.senha) {
      delete data.senha;
    }

    await onSubmit(data);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-xl border-slate-200 bg-white">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-white" />
            </div>
            {initialData ? 'Editar Usuário' : 'Novo Usuário'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* DADOS BÁSICOS */}
            <Card className="bg-slate-50 border-slate-200">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-base">Dados Básicos</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Nome Completo *</Label>
                    <Input
                      value={formData.full_name}
                      onChange={(e) => handleChange('full_name', e.target.value)}
                      placeholder="NOME COMPLETO"
                      required
                      className="uppercase h-10"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">E-mail *</Label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      placeholder="email@exemplo.com"
                      required
                      className="h-10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">CPF (Login) *</Label>
                    <Input
                      value={formData.cpf}
                      onChange={(e) => handleChange('cpf', e.target.value)}
                      placeholder="000.000.000-00"
                      required
                      className="h-10"
                      maxLength={14}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Senha {!initialData && '*'}</Label>
                    <div className="relative">
                      <Input
                        type={showSenha ? "text" : "password"}
                        value={formData.senha}
                        onChange={(e) => handleChange('senha', e.target.value)}
                        placeholder={initialData ? "Deixe vazio para não alterar" : "Digite a senha"}
                        required={!initialData}
                        className="h-10 pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowSenha(!showSenha)}
                        className="absolute right-1 top-1 h-8 w-8"
                      >
                        {showSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Telefone</Label>
                    <Input
                      value={formData.telefone}
                      onChange={(e) => handleChange('telefone', e.target.value)}
                      placeholder="(00) 00000-0000"
                      className="h-10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Cargo/Função</Label>
                    <Input
                      value={formData.cargo}
                      onChange={(e) => handleChange('cargo', e.target.value)}
                      placeholder="GERENTE"
                      className="uppercase h-10"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Perfil *</Label>
                    <Select value={formData.role} onValueChange={(v) => handleChange('role', v)}>
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrador</SelectItem>
                        <SelectItem value="user">Usuário</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Status</Label>
                    <Select value={formData.ativo ? "true" : "false"} onValueChange={(v) => handleChange('ativo', v === "true")}>
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Ativo</SelectItem>
                        <SelectItem value="false">Inativo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* PERMISSÕES */}
            <Card className="bg-amber-50 border-amber-200">
              <CardHeader className="py-3 px-4">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="w-5 h-5 text-amber-600" />
                    Permissões de Acesso
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleMarcarTodosGeral(true)}
                      className="h-8 text-xs"
                    >
                      Marcar Todos
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleMarcarTodosGeral(false)}
                      className="h-8 text-xs"
                    >
                      Desmarcar Todos
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-4">
                  {MODULOS_PERMISSOES.map(modulo => (
                    <Card key={modulo.id} className="bg-white border-slate-200">
                      <CardContent className="p-3">
                        <div className="flex justify-between items-center mb-3">
                          <h4 className="font-semibold text-sm text-slate-900">{modulo.nome}</h4>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleMarcarTodosModulo(modulo.id, true)}
                              className="h-7 text-xs"
                            >
                              Todos
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleMarcarTodosModulo(modulo.id, false)}
                              className="h-7 text-xs"
                            >
                              Nenhum
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                          {modulo.acoes.map(acao => (
                            <div key={acao} className="flex items-center space-x-2">
                              <Checkbox
                                id={`${modulo.id}-${acao}`}
                                checked={formData.permissoes[modulo.id]?.[acao] || false}
                                onCheckedChange={(v) => handlePermissaoChange(modulo.id, acao, v)}
                              />
                              <label
                                htmlFor={`${modulo.id}-${acao}`}
                                className="text-xs cursor-pointer"
                              >
                                {ACOES_LABELS[acao]}
                              </label>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* BOTÕES */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
                <X className="w-4 h-4" />
                Cancelar
              </Button>
              <Button type="submit" className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 gap-2 shadow-lg">
                <Save className="w-4 h-4" />
                {initialData ? 'Atualizar' : 'Cadastrar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}