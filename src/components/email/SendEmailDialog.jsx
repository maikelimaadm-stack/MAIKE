import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Mail, Send } from "lucide-react";
import { toast } from "sonner";

export default function SendEmailDialog({ open, onOpenChange, senderEmail, senderName }) {
  const [formData, setFormData] = useState({
    to: "",
    subject: "",
    message: "",
  });
  const [isSending, setIsSending] = useState(false);

  const destinatarios = useMemo(
    () => formData.to.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean),
    [formData.to]
  );

  const resetForm = () => {
    setFormData({ to: "", subject: "", message: "" });
    onOpenChange(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!destinatarios.length || !formData.subject.trim() || !formData.message.trim()) {
      toast.error("Preencha destinatários, assunto e mensagem.");
      return;
    }

    setIsSending(true);
    const body = formData.message
      .split("\n")
      .map((line) => `<p>${line || "&nbsp;"}</p>`)
      .join("");

    await Promise.all(
      destinatarios.map((to) =>
        base44.integrations.Core.SendEmail({
          to,
          subject: formData.subject.trim(),
          body,
          from_name: senderName,
        })
      )
    );

    toast.success(`E-mail enviado para ${destinatarios.length} destinatário(s).`);
    setIsSending(false);
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Mail className="w-4 h-4" />
            Enviar e-mail
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs">Remetente</Label>
              <Input value={senderEmail} readOnly className="h-8 text-xs bg-slate-50" />
            </div>

            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs">Destinatários</Label>
              <Input
                value={formData.to}
                onChange={(e) => setFormData((prev) => ({ ...prev, to: e.target.value }))}
                placeholder="Digite um ou mais e-mails separados por vírgula, ponto e vírgula ou quebra de linha"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs">Assunto</Label>
              <Input
                value={formData.subject}
                onChange={(e) => setFormData((prev) => ({ ...prev, subject: e.target.value }))}
                placeholder="Assunto do e-mail"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs">Mensagem</Label>
              <Textarea
                value={formData.message}
                onChange={(e) => setFormData((prev) => ({ ...prev, message: e.target.value }))}
                placeholder="Escreva o conteúdo do e-mail"
                className="min-h-[180px] text-xs"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={resetForm}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={isSending}>
              <Send className="w-3.5 h-3.5" />
              {isSending ? "Enviando..." : "Enviar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}