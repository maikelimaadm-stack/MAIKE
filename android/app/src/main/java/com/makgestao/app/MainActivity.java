package com.makgestao.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // D-PROD-346: aviso de registros esperando envio com o app fechado (plugin do próprio app).
        registerPlugin(AvisoDeEnvioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
