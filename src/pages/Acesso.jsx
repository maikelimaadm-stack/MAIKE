import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function Acesso() {
  const [cpf, setCpf] = useState("");
  const [senha, setSenha] = useState("");
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Verificar se já está logado
    const usuarioLogado = localStorage.getItem('usuario_logado');
    if (usuarioLogado) {
      window.location.href = '/';
    }
  }, []);

  const formatarCPF = (valor) => {
    const numeros = valor.replace(/\D/g, '');
    if (numeros.length <= 11) {
      return numeros
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    }
    return valor;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!cpf) {
      toast.error('❌ Digite seu CPF');
      return;
    }
    
    if (!senha) {
      toast.error('❌ Digite sua senha');
      return;
    }

    setLoading(true);

    try {
      // Buscar todos os usuários
      const usuarios = await base44.entities.User.list();
      
      // Limpar CPF (remover pontos e traços)
      const cpfLimpo = cpf.replace(/\D/g, '');
      
      // Buscar usuário pelo CPF
      const usuario = usuarios.find(u => u.cpf === cpfLimpo);

      if (!usuario) {
        toast.error('❌ CPF não encontrado!');
        setLoading(false);
        return;
      }

      // Verificar se está ativo
      if (usuario.ativo === false) {
        toast.error('❌ Usuário inativo! Entre em contato com o administrador.');
        setLoading(false);
        return;
      }

      // Verificar senha
      if (usuario.senha !== senha) {
        toast.error('❌ Senha incorreta!');
        setLoading(false);
        return;
      }

      // Login bem-sucedido
      toast.success(`✅ Bem-vindo(a), ${usuario.full_name}!`);
      
      // Salvar dados do usuário logado
      localStorage.setItem('usuario_logado', JSON.stringify({
        id: usuario.id,
        full_name: usuario.full_name,
        email: usuario.email,
        cpf: usuario.cpf,
        role: usuario.role,
        cargo: usuario.cargo,
        permissoes: usuario.permissoes || {}
      }));

      // Redirecionar para a home
      setTimeout(() => {
        window.location.href = '/';
      }, 500);

    } catch (error) {
      console.error('Erro no login:', error);
      toast.error('❌ Erro ao fazer login. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-slate-50 to-emerald-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="shadow-2xl border-slate-200 bg-white/95 backdrop-blur">
          <CardHeader className="space-y-4 pb-6">
            <div className="flex justify-center">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-emerald-600 rounded-2xl flex items-center justify-center shadow-lg">
                <LogIn className="w-10 h-10 text-white" />
              </div>
            </div>
            <CardTitle className="text-center">
              <h1 className="text-2xl font-bold text-slate-900">Sistema de Gestão</h1>
              <p className="text-sm text-slate-600 font-normal mt-2">Faça login para continuar</p>
            </CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cpf" className="text-sm font-semibold text-slate-700">
                  CPF
                </Label>
                <Input
                  id="cpf"
                  type="text"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={(e) => setCpf(formatarCPF(e.target.value))}
                  maxLength={14}
                  className="h-12 text-base"
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="senha" className="text-sm font-semibold text-slate-700">
                  Senha
                </Label>
                <div className="relative">
                  <Input
                    id="senha"
                    type={showSenha ? "text" : "password"}
                    placeholder="Digite sua senha"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="h-12 text-base pr-12"
                    disabled={loading}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowSenha(!showSenha)}
                    className="absolute right-1 top-1 h-10 w-10"
                    disabled={loading}
                    tabIndex={-1}
                  >
                    {showSenha ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </Button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-base font-semibold shadow-lg"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    <LogIn className="w-5 h-5 mr-2" />
                    Entrar
                  </>
                )}
              </Button>
            </form>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-blue-900">Informações de Acesso</p>
                  <p className="text-xs text-blue-700">
                    Use seu CPF e senha cadastrados no sistema para fazer login.
                  </p>
                  <p className="text-xs text-blue-700">
                    Em caso de problemas, entre em contato com o administrador.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <p className="text-sm text-slate-600">
            © 2025 Sistema de Gestão - Todos os direitos reservados
          </p>
        </div>
      </motion.div>
    </div>
  );
}