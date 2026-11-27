package com.makgestao.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * D-PROD-346 — acordado pelo Android a cada 15 minutos, só com internet. Com registros esperando envio e o app fora
 * de uso há pelo menos {@link #FORA_DE_USO_MS}, mostra UM aviso (substitui o anterior, sem tocar de novo). O toque abre
 * o app, que envia sozinho. Nunca envia nada: só o app sabe enviar.
 */
public class AvisoDeEnvioWorker extends Worker {

    static final String CANAL = "envio_pendente";
    static final int ID_DO_AVISO = 4601;
    /** Com o app em uso (ou recém-fechado) ele mesmo envia: nada de aviso. */
    static final long FORA_DE_USO_MS = 10L * 60L * 1000L;

    public AvisoDeEnvioWorker(@NonNull Context contexto, @NonNull WorkerParameters parametros) {
        super(contexto, parametros);
    }

    static void tirarAviso(Context contexto) {
        NotificationManagerCompat.from(contexto).cancel(ID_DO_AVISO);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context contexto = getApplicationContext();
        SharedPreferences preferencias = AvisoDeEnvioPlugin.preferencias(contexto);
        int pendentes = preferencias.getInt(AvisoDeEnvioPlugin.PENDENTES, 0);
        long ultimoUso = preferencias.getLong(AvisoDeEnvioPlugin.ULTIMO_USO, 0L);
        if (pendentes <= 0) return Result.success();
        if (System.currentTimeMillis() - ultimoUso < FORA_DE_USO_MS) return Result.success();
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(contexto, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return Result.success();
        }
        criarCanal(contexto);
        Intent abrir = new Intent(contexto, MainActivity.class);
        abrir.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent aoTocar = PendingIntent.getActivity(contexto, 0, abrir, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String texto = pendentes == 1
            ? "1 registro feito sem internet ainda não chegou ao sistema. Toque para enviar."
            : pendentes + " registros feitos sem internet ainda não chegaram ao sistema. Toque para enviar.";
        NotificationCompat.Builder aviso = new NotificationCompat.Builder(contexto, CANAL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Registros esperando envio")
            .setContentText(texto)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(texto))
            .setContentIntent(aoTocar)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(contexto).notify(ID_DO_AVISO, aviso.build());
        } catch (SecurityException semPermissao) {
            // A pessoa tirou a permissão de avisos: nada a fazer.
        }
        return Result.success();
    }

    private static void criarCanal(Context contexto) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager gerenciador = contexto.getSystemService(NotificationManager.class);
        if (gerenciador == null || gerenciador.getNotificationChannel(CANAL) != null) return;
        NotificationChannel canal = new NotificationChannel(CANAL, "Envio pendente", NotificationManager.IMPORTANCE_DEFAULT);
        canal.setDescription("Avisa quando o que foi feito sem internet ainda não chegou ao sistema.");
        gerenciador.createNotificationChannel(canal);
    }
}
