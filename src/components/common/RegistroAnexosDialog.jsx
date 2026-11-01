import React, { useRef, useState } from "react";
import { listarAnexos, anexarArquivo, excluirAnexo } from "@/services/anexoService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import MobileSheet from "@/components/common/MobileSheet";
import { ExternalLink, FileText, Loader2, Paperclip, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const formatSize = (bytes = 0) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function RegistroAnexosDialog({ open, onOpenChange, entityName, recordId, title, pendingAnexos = [], onPendingChange }) {
  const inputRef = useRef(null);
  /**
   * Contador monotônico por diálogo (P1.3-R1).
   *
   * O id anterior era `pending-${novosAnexos.length}-${file.name}`, e
   * `novosAnexos` reinicia a cada seleção: escolher `nota.pdf` duas vezes em
   * seleções separadas gerava `pending-0-nota.pdf` nas duas. React via a mesma
   * key, e remover um item removia o outro.
   *
   * O contador vive num ref, então sobrevive a re-render e só cresce enquanto o
   * diálogo estiver montado.
   */
  const proximoIdPendente = useRef(0);
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [attachmentName, setAttachmentName] = useState("");
  const queryKey = ["registro-anexos", entityName, recordId];

  const { data: savedAnexos = [] } = useQuery({
    queryKey,
    queryFn: () => listarAnexos({ entityName, recordId }),
    enabled: open && !!entityName && !!recordId,
    initialData: []
  });

  const anexos = recordId ? savedAnexos : pendingAnexos;

  const deleteMutation = useMutation({
    mutationFn: (id) => excluirAnexo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Anexo removido.");
    }
  });

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    if (!attachmentName.trim()) {
      toast.error("Informe o nome do arquivo antes de anexar.");
      event.target.value = "";
      return;
    }
    setUploading(true);
    const novosAnexos = [];
    try {
      for (const file of files) {
        if (recordId) {
          await anexarArquivo({ entityName, recordId, arquivo: file, nome: attachmentName.trim() });
        } else {
          // Sem `recordId` o registro ainda não existe: o anexo fica pendente no
          // cliente e é persistido depois que o lote é criado.
          novosAnexos.push({
            entity_name: entityName,
            record_id: recordId,
            attachment_name: attachmentName.trim(),
            file_name: file.name,
            file_type: file.type,
            file_size: file.size,
            arquivo: file,
            id: `pendente-${(proximoIdPendente.current += 1)}`
          });
        }
      }
    } catch (error) {
      // Mensagem pública do catálogo — nunca o texto cru do provider.
      toast.error(getApiErrorMessage(error, "Não foi possível anexar o arquivo."));
      setUploading(false);
      event.target.value = "";
      return;
    }
    if (!recordId && novosAnexos.length) {
      onPendingChange?.([...pendingAnexos, ...novosAnexos]);
    }
    setUploading(false);
    setAttachmentName("");
    event.target.value = "";
    queryClient.invalidateQueries({ queryKey });
    toast.success(files.length === 1 ? "Arquivo anexado." : "Arquivos anexados.");
  };

  const escolherArquivo = () => inputRef.current?.click();
  const podeAnexar = !uploading && Boolean(attachmentName.trim());

  // Folha padrão do sistema (D-PROD-95): ✕ à esquerda, título, + verde à
  // direita; nome do anexo numa pílula e a lista agrupada com divisórias.
  // No tablet/desktop a mesma folha vira diálogo centralizado.
  return (
    <MobileSheet
      open={open}
      onClose={() => onOpenChange(false)}
      label="Anexos"
      title="Anexos"
      aside={title || entityName || null}
      className="mk-anexos"
      headerAction={
        <button
          type="button"
          className="mk-sheet__new"
          onClick={escolherArquivo}
          disabled={!podeAnexar}
          aria-label="Anexar arquivo"
          title={attachmentName.trim() ? "Anexar arquivo" : "Informe o nome do arquivo"}
        >
          {uploading ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Plus size={22} aria-hidden />}
        </button>
      }
    >
      <input ref={inputRef} type="file" multiple className="hidden" onChange={handleFiles} />
      <div className="mk-pill mk-anexos__nome">
        <span className="mk-pill__icon" aria-hidden>
          <Paperclip size={16} />
        </span>
        <input
          value={attachmentName}
          onChange={(e) => setAttachmentName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && podeAnexar) {
              e.preventDefault();
              escolherArquivo();
            }
          }}
          placeholder="EX: CONTRATO, NOTA FISCAL, GTA..."
          aria-label="Nome do arquivo"
          style={{ textTransform: "uppercase" }}
        />
      </div>
      <div className="mk-anexos__dica">Dê um nome e toque em + para escolher o arquivo.</div>

      {anexos.length === 0 ? (
        <div className="mk-anexos__vazio">Nenhum arquivo anexado.</div>
      ) : (
        <div className="mgs__lista mk-anexos__lista" role="list" aria-label="Arquivos anexados">
          {anexos.map((anexo) => (
            <div key={anexo.id} role="listitem" className="mgs__op mk-anexos__item">
              <span className="mk-anexos__ic" aria-hidden>
                <FileText size={18} />
              </span>
              <span className="mk-anexos__txt">
                <span className="mk-anexos__titulo">{anexo.attachment_name || anexo.file_name}</span>
                {/* Pendente ainda não foi enviado: sem `file_url` não há link (evita <a href={undefined}>). */}
                {anexo.file_url ? (
                  <a href={anexo.file_url} target="_blank" rel="noreferrer" className="mk-anexos__arquivo">
                    <span className="truncate">{anexo.file_name}</span>
                    <span className="shrink-0">{formatSize(anexo.file_size)}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                  </a>
                ) : (
                  <span className="mk-anexos__arquivo">
                    <span className="truncate">{anexo.file_name}</span>
                    <span className="shrink-0">{formatSize(anexo.file_size)}</span>
                    <span className="mk-anexos__pendente">Pendente</span>
                  </span>
                )}
              </span>
              <button
                type="button"
                className="mk-anexos__remover"
                aria-label={`Remover anexo ${anexo.attachment_name || anexo.file_name}`}
                title="Remover"
                onClick={() =>
                  recordId ? deleteMutation.mutate(anexo.id) : onPendingChange?.(pendingAnexos.filter((item) => item.id !== anexo.id))
                }
              >
                <Trash2 size={17} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </MobileSheet>
  );
}
