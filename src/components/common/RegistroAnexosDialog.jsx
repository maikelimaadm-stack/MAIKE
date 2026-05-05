import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Paperclip, Upload, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

const formatSize = (bytes = 0) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function RegistroAnexosDialog({ open, onOpenChange, entityName, recordId, title }) {
  const inputRef = useRef(null);
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const queryKey = ["registro-anexos", entityName, recordId];

  const { data: anexos = [] } = useQuery({
    queryKey,
    queryFn: () => base44.entities.RegistroAnexo.filter({ entity_name: entityName, record_id: recordId }, "-created_date"),
    enabled: open && !!entityName && !!recordId,
    initialData: []
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.RegistroAnexo.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Anexo removido.");
    }
  });

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await base44.entities.RegistroAnexo.create({
        entity_name: entityName,
        record_id: recordId,
        file_name: file.name,
        file_url,
        file_type: file.type,
        file_size: file.size
      });
    }
    setUploading(false);
    event.target.value = "";
    queryClient.invalidateQueries({ queryKey });
    toast.success(files.length === 1 ? "Arquivo anexado." : "Arquivos anexados.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Paperclip className="w-4 h-4" />
            Anexos {title ? `- ${title}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <input ref={inputRef} type="file" multiple className="hidden" onChange={handleFiles} />
          <Button type="button" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading || !recordId} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Anexar arquivo
          </Button>

          <div className="border border-slate-200 rounded-sm divide-y divide-slate-200 max-h-80 overflow-auto">
            {anexos.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">Nenhum arquivo anexado.</div>
            ) : anexos.map((anexo) => (
              <div key={anexo.id} className="flex items-center gap-2 p-2 text-xs">
                <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-700">{anexo.file_name}</div>
                  <div className="text-slate-400">{formatSize(anexo.file_size)}</div>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" asChild>
                  <a href={anexo.file_url} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5" /></a>
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => deleteMutation.mutate(anexo.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}