import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { applyDeleteGuards } from '@/lib/entityDeleteGuards';

const { appId, serverUrl, token, functionsVersion } = appParams;

const base44Client = createClient({
  appId,
  serverUrl,
  token,
  functionsVersion,
  requiresAuth: false
});

applyDeleteGuards(base44Client);

export const base44 = base44Client;