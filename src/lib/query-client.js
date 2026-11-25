import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			// D-PROD-301: sem internet a leitura RODA (lê do celular: cache do mapa, leituras
			// guardadas, entidades). Com o padrão ('online') o React Query pausava toda consulta
			// sem sinal: o detalhe do depósito ficava "carregando"/zerado até a internet voltar.
			// As gravações (mutations) continuam no padrão: as telas recusam ou guardam na fila.
			networkMode: 'always',
		},
	},
});

/** Limpa cache React Query entre sessões (logout / troca de identidade). */
export const resetAppQueryCache = () => {
	queryClientInstance.cancelQueries();
	queryClientInstance.clear();
};