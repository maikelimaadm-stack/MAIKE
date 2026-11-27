package com.makgestao.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.capacitorjs.plugins.googlemaps.MaikeCamera;
import com.google.android.gms.maps.MapView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * D-PROD-376 — a camada nativa do Mapa Geral no mapa do Google do app ({@link CamadaDoMapaView}).
 *
 * A página (src/lib/mapaNativo/camadaNativa.js):
 *  - {@code ligar({ mapId })}: põe a camada por cima do mapa do plugin {@code @capacitor/google-maps} com esse id;
 *  - {@code imagens({ imagens: [{ chave, url }] })}: as imagens (URL {@code data:} em base64), uma vez cada;
 *  - {@code definir({ grupo, itens })}: troca os itens de um grupo;
 *  - {@code tocar({ lat, lng })}: o item de cima que recebe toque nesse ponto, ou nada;
 *  - {@code desligar()}: tira a camada.
 */
@CapacitorPlugin(name = "CamadaDoMapa")
public class CamadaDoMapaPlugin extends Plugin {

    /** As imagens por chave (o mesmo desenho em vários itens usa a mesma imagem). */
    private final Map<String, Bitmap> imagens = new ConcurrentHashMap<>();
    private final ExecutorService decodificar = Executors.newSingleThreadExecutor();
    private CamadaDoMapaView camada;

    @PluginMethod
    public void ligar(PluginCall call) {
        String mapId = call.getString("mapId");
        if (mapId == null) {
            call.reject("mapId faltando");
            return;
        }
        getActivity().runOnUiThread(() -> {
            View raiz = (View) getBridge().getWebView().getParent();
            View pai = raiz instanceof ViewGroup ? raiz.findViewWithTag(mapId) : null;
            MapView mapView = pai instanceof ViewGroup ? acharMapView((ViewGroup) pai) : null;
            if (mapView == null) {
                call.reject("mapa não encontrado");
                return;
            }
            tirarCamada();
            CamadaDoMapaView nova = new CamadaDoMapaView(getContext(), mapView, imagens);
            ((ViewGroup) pai).addView(nova, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            camada = nova;
            // o mapa avisa cada passo da câmera (remendo D-PROD-376 do plugin): a camada desenha junto
            MaikeCamera.aoMexer = nova::mexeu;
            mapView.getMapAsync((mapa) -> {
                nova.usarMapa(mapa);
                call.resolve();
            });
        });
    }

    private static MapView acharMapView(ViewGroup grupo) {
        for (int i = 0; i < grupo.getChildCount(); i++) {
            View filho = grupo.getChildAt(i);
            if (filho instanceof MapView) return (MapView) filho;
        }
        return null;
    }

    @PluginMethod
    public void imagens(PluginCall call) {
        JSArray lista = call.getArray("imagens");
        if (lista == null) {
            call.resolve();
            return;
        }
        decodificar.execute(() -> {
            int prontas = 0;
            for (int i = 0; i < lista.length(); i++) {
                JSONObject o = lista.optJSONObject(i);
                if (o == null) continue;
                String chave = o.optString("chave", "");
                String url = o.optString("url", "");
                int virgula = url.indexOf(',');
                if (chave.isEmpty() || virgula < 0 || imagens.containsKey(chave)) continue;
                try {
                    byte[] bytes = Base64.decode(url.substring(virgula + 1), Base64.DEFAULT);
                    Bitmap b = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                    if (b != null) {
                        imagens.put(chave, b);
                        prontas++;
                    }
                } catch (IllegalArgumentException e) {
                    // imagem estragada: o item dela não aparece
                }
            }
            JSObject r = new JSObject();
            r.put("prontas", prontas);
            getActivity().runOnUiThread(() -> {
                if (camada != null) camada.invalidate();
                call.resolve(r);
            });
        });
    }

    @PluginMethod
    public void definir(PluginCall call) {
        String grupo = call.getString("grupo");
        JSArray lista = call.getArray("itens");
        if (grupo == null || lista == null) {
            call.reject("grupo ou itens faltando");
            return;
        }
        List<CamadaDoMapaView.Item> itens = new ArrayList<>();
        for (int i = 0; i < lista.length(); i++) {
            JSONObject o = lista.optJSONObject(i);
            if (o == null) continue;
            CamadaDoMapaView.Item it = new CamadaDoMapaView.Item();
            it.id = o.optString("id", "");
            it.chave = o.optString("chave", "");
            it.lat = o.optDouble("lat", Double.NaN);
            it.lng = o.optDouble("lng", Double.NaN);
            if (Double.isNaN(it.lat) || Double.isNaN(it.lng) || it.chave.isEmpty()) continue;
            it.w = (float) o.optDouble("w", 0);
            it.h = (float) o.optDouble("h", 0);
            it.dx = (float) o.optDouble("dx", 0);
            it.dy = (float) o.optDouble("dy", 0);
            it.topo = "topo".equals(o.optString("ancora", "centro"));
            it.z = o.optDouble("z", 0);
            it.toque = o.optBoolean("toque", false);
            JSONArray escala = o.optJSONArray("escala");
            if (escala != null && escala.length() > 0) {
                it.escala = new float[escala.length()];
                for (int k = 0; k < escala.length(); k++) it.escala[k] = (float) escala.optDouble(k, 1);
            }
            itens.add(it);
        }
        getActivity().runOnUiThread(() -> {
            if (camada != null) camada.definir(grupo, itens);
            call.resolve();
        });
    }

    @PluginMethod
    public void tocar(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lng = call.getDouble("lng");
        getActivity().runOnUiThread(() -> {
            JSObject r = new JSObject();
            CamadaDoMapaView.Item it = camada != null && lat != null && lng != null ? camada.itemNoPonto(lat, lng) : null;
            if (it != null) {
                r.put("grupo", it.grupo);
                r.put("id", it.id);
            }
            call.resolve(r);
        });
    }

    @PluginMethod
    public void desligar(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            tirarCamada();
            imagens.clear();
            call.resolve();
        });
    }

    private void tirarCamada() {
        CamadaDoMapaView velha = camada;
        camada = null;
        if (velha == null) return;
        MaikeCamera.aoMexer = null;
        velha.limpar();
        if (velha.getParent() instanceof ViewGroup) ((ViewGroup) velha.getParent()).removeView(velha);
    }
}
