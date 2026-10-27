import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});

/** Limpa cache React Query entre sessões (logout / troca de identidade). */
export const resetAppQueryCache = () => {
	queryClientInstance.cancelQueries();
	queryClientInstance.clear();
};