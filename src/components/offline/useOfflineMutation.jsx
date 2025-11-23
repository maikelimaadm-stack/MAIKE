import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function useOfflineMutation({ 
  mutationFn, 
  onSuccess, 
  onError,
  entityName,
  operation = 'create',
  invalidateQueries = []
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      // Se estiver offline, salvar localmente
      if (!navigator.onLine) {
        const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
        const action = {
          id: Date.now(),
          type: 'entity_operation',
          entityName,
          operation,
          data,
          timestamp: new Date().toISOString(),
          invalidateQueries
        };
        pending.push(action);
        localStorage.setItem('pending_actions', JSON.stringify(pending));
        
        toast.success(`💾 Salvo offline - sincronizará quando conectar`);
        
        // Chamar onSuccess se fornecido
        if (onSuccess) onSuccess({ offline: true });
        
        return { offline: true, data };
      }

      // Se online, executar normalmente
      return await mutationFn(data);
    },
    onSuccess: (data) => {
      if (!data?.offline) {
        invalidateQueries.forEach(query => {
          queryClient.invalidateQueries({ queryKey: [query] });
        });
        if (onSuccess) onSuccess(data);
      }
    },
    onError: (error) => {
      if (onError) onError(error);
      toast.error('Erro: ' + error.message);
    }
  });
}