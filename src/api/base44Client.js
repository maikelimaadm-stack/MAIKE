import { createClient } from '@base44/sdk';
import { getDataProviderConfig } from '@/config/runtimeConfig';
import { applyDeleteGuards } from '@/lib/entityDeleteGuards';
import { installTextNormalization } from '@/lib/textNormalization';
import { installOfflineEntitySync } from '@/lib/offlineEntitySync';

const { appId, serverUrl, token, functionsVersion } = getDataProviderConfig();

const base44Client = createClient({
  appId,
  serverUrl,
  token,
  functionsVersion,
  requiresAuth: false
});

installTextNormalization(base44Client);
applyDeleteGuards(base44Client);
installOfflineEntitySync(base44Client);

export const base44 = base44Client;