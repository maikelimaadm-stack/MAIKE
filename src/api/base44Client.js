import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { applyDeleteGuards } from '@/lib/entityDeleteGuards';
import { installTextNormalization } from '@/lib/textNormalization';
import { installOfflineEntitySync } from '@/lib/offlineEntitySync';

const { appId, serverUrl, token, functionsVersion } = appParams;

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