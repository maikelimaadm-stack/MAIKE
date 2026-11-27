package com.makgestao.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.concurrent.TimeUnit;

/**
 * D-PROD-346 — aviso de registros esperando envio, com o app fechado.
 *
 * As filas do app (o que foi feito sem internet) vivem dentro do app e só o app sabe enviá-las. Com o app fechado,
 * o Android acorda {@link AvisoDeEnvioWorker} a cada 15 minutos, só com internet; se ainda houver registros esperando
 * e o app estiver fora de uso há algum tempo, ele mostra um aviso. O toque abre o app, que envia na hora.
 *
 * O app informa a quantidade com {@link #definirPendentes}. Sem nada pendente, o trabalho é cancelado e o aviso sai.
 */
@CapacitorPlugin(
    name = "AvisoDeEnvio",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = AvisoDeEnvioPlugin.PERMISSAO) }
)
public class AvisoDeEnvioPlugin extends Plugin {

    static final String PERMISSAO = "avisos";
    static final String PREFERENCIAS = "maike_aviso_de_envio";
    static final String PENDENTES = "pendentes";
    static final String ULTIMO_USO = "ultimo_uso";
    static final String TRABALHO = "maike-aviso-de-envio";

    static SharedPreferences preferencias(Context contexto) {
        return contexto.getSharedPreferences(PREFERENCIAS, Context.MODE_PRIVATE);
    }

    private void marcarUso() {
        preferencias(getContext()).edit().putLong(ULTIMO_USO, System.currentTimeMillis()).apply();
    }

    @Override
    public void load() {
        marcarUso();
    }

    @Override
    protected void handleOnResume() {
        marcarUso();
        // O app aberto envia sozinho: o aviso que estava na tela sai.
        AvisoDeEnvioWorker.tirarAviso(getContext());
    }

    @Override
    protected void handleOnPause() {
        marcarUso();
    }

    @PluginMethod
    public void definirPendentes(PluginCall call) {
        int quantidade = Math.max(0, call.getInt("quantidade", 0));
        preferencias(getContext()).edit().putInt(PENDENTES, quantidade).putLong(ULTIMO_USO, System.currentTimeMillis()).apply();
        WorkManager trabalhos = WorkManager.getInstance(getContext());
        if (quantidade > 0) {
            Constraints comInternet = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
            PeriodicWorkRequest pedido = new PeriodicWorkRequest.Builder(AvisoDeEnvioWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(comInternet)
                .build();
            trabalhos.enqueueUniquePeriodicWork(TRABALHO, ExistingPeriodicWorkPolicy.KEEP, pedido);
        } else {
            trabalhos.cancelUniqueWork(TRABALHO);
            AvisoDeEnvioWorker.tirarAviso(getContext());
        }
        call.resolve();
    }

    @PluginMethod
    public void pedirPermissao(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState(PERMISSAO) == PermissionState.GRANTED) {
            responderPermissao(call, true);
            return;
        }
        requestPermissionForAlias(PERMISSAO, call, "aoResponderPermissao");
    }

    @PermissionCallback
    private void aoResponderPermissao(PluginCall call) {
        responderPermissao(call, getPermissionState(PERMISSAO) == PermissionState.GRANTED);
    }

    private void responderPermissao(PluginCall call, boolean concedida) {
        JSObject resposta = new JSObject();
        resposta.put("concedida", concedida);
        call.resolve(resposta);
    }
}
