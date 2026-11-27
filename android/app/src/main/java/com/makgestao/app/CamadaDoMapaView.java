package com.makgestao.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;

import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.MapView;
import com.google.android.gms.maps.model.CameraPosition;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * D-PROD-376 — a camada do Mapa Geral desenhada pelo próprio Android, colada no mapa do Google.
 *
 * A página manda as imagens UMA vez (as mesmas do sistema: lote, cocho, ponto, tarefa, nome do pasto) e a lista de
 * itens com a regra de tamanho por zoom. A cada passo da câmera (o mapa avisa, {@link #mexeu}) esta camada lê a câmera
 * do mapa e desenha tudo no lugar e no tamanho certos: nada passa pela ponte página → Android durante o gesto, e os nomes crescem e diminuem
 * junto com o zoom, como no MapLibre.
 *
 * A projeção é a do mapa do Google: Web Mercator com ladrilho de 256 dp, centro da câmera no meio do mapa, girada pelo
 * rumo (a mesma conta de {@code projetarNaCamera} da página). Mapa inclinado: sem projeção plana, a camada some.
 *
 * O toque é do mapa (a camada não recebe toque): o toque rápido chega pelo clique do mapa e a página pergunta qual
 * item está no ponto ({@link #itemNoPonto}).
 */
@SuppressLint("ViewConstructor")
public class CamadaDoMapaView extends View {

    /** Folga em volta do ícone para o toque do dedo (dp), a mesma da página. */
    static final float FOLGA_TOQUE_DP = 4f;
    /** Primeiro zoom das paradas de tamanho (zoom do MapLibre = zoom do Google - 1). */
    static final int ZOOM_INICIAL = 0;

    /** Um item na camada: imagem, ponto, tamanho em dp, deslocamento, âncora, ordem, toque e tamanho por zoom. */
    static final class Item {
        String grupo;
        String id;
        String chave;
        double lat;
        double lng;
        float w;
        float h;
        float dx;
        float dy;
        boolean topo;
        double z;
        boolean toque;
        /** Fator de tamanho por zoom do MapLibre inteiro (índice 0 = zoom {@link #ZOOM_INICIAL}); null = fixo. */
        float[] escala;
        /** Ordem de chegada (empate de z: o posto depois fica por cima). */
        long ordem;
    }

    private final MapView mapView;
    private final Map<String, Bitmap> imagens;
    private final Map<String, List<Item>> grupos = new HashMap<>();
    private final List<Item> desenho = new ArrayList<>();
    private final Paint pintura = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final RectF caixa = new RectF();
    private final float densidade;
    private GoogleMap mapa;
    private long proximaOrdem = 0;

    CamadaDoMapaView(Context contexto, MapView mapView, Map<String, Bitmap> imagens) {
        super(contexto);
        this.mapView = mapView;
        this.imagens = imagens;
        this.densidade = contexto.getResources().getDisplayMetrics().density;
        setClickable(false);
        setFocusable(false);
        setWillNotDraw(false);
        // o mapa muda de lugar ou de tamanho na tela (a página rolou, a tela girou): desenha de novo
        mapView.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> invalidate());
    }

    /** O mapa do Google ficou pronto: a camada passa a seguir a câmera dele. */
    void usarMapa(GoogleMap mapa) {
        this.mapa = mapa;
        invalidate();
    }

    /** Troca os itens de um grupo (os outros grupos ficam). */
    void definir(String grupo, List<Item> itens) {
        for (Item it : itens) {
            it.grupo = grupo;
            it.ordem = proximaOrdem++;
        }
        grupos.put(grupo, itens);
        refazerOrdem();
        invalidate();
    }

    /** Tira todos os itens. */
    void limpar() {
        grupos.clear();
        desenho.clear();
        invalidate();
    }

    private void refazerOrdem() {
        desenho.clear();
        for (List<Item> l : grupos.values()) desenho.addAll(l);
        Collections.sort(desenho, (a, b) -> a.z != b.z ? Double.compare(a.z, b.z) : Long.compare(a.ordem, b.ordem));
    }

    // ─── A câmera mexeu: desenha de novo ───
    //
    // O próprio mapa avisa a cada passo da câmera (o remendo D-PROD-376 do plugin chama {@code MaikeCamera.mexeu()} no
    // {@code onCameraMove}, que roda na thread da tela): a camada desenha no mesmo ritmo do mapa, sem ficar olhando a
    // câmera à toa com o mapa parado.

    /** A câmera mexeu (ou o mapa mudou de lugar): desenha de novo. */
    void mexeu() {
        invalidate();
    }

    // ─── Projeção (Web Mercator do Google, em px da tela) ───

    /** Projeção da câmera de agora, ou null (mapa ainda não pronto, inclinado ou sem tamanho). */
    private Projecao projecao() {
        GoogleMap m = mapa;
        if (m == null || mapView.getWidth() == 0 || mapView.getHeight() == 0) return null;
        CameraPosition c = m.getCameraPosition();
        if (c.tilt > 0.5f) return null;
        return new Projecao(c, densidade, mapView.getLeft(), mapView.getTop(), mapView.getWidth(), mapView.getHeight());
    }

    static final class Projecao {
        final double tam;
        final double cx;
        final double cy;
        final double cos;
        final double sin;
        final float meioX;
        final float meioY;
        /** Zoom do MapLibre (o do Google - 1): o tamanho dos nomes é o do Mapa Geral. */
        final double zoomMapLibre;

        Projecao(CameraPosition c, float densidade, int esquerda, int topo, int largura, int altura) {
            tam = 256.0 * densidade * Math.pow(2, c.zoom);
            double[] centro = noMundo(c.target.latitude, c.target.longitude, tam);
            cx = centro[0];
            cy = centro[1];
            double b = Math.toRadians(c.bearing);
            cos = Math.cos(b);
            sin = Math.sin(b);
            meioX = esquerda + largura / 2f;
            meioY = topo + altura / 2f;
            zoomMapLibre = c.zoom - 1;
        }

        static double[] noMundo(double lat, double lng, double tam) {
            double s = Math.min(Math.max(Math.sin(Math.toRadians(lat)), -0.9999), 0.9999);
            return new double[] { (lng + 180) / 360 * tam, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * tam };
        }

        /** Ponto na tela (px) de lat/lng: [x, y]. */
        void projetar(double lat, double lng, float[] saida) {
            double[] p = noMundo(lat, lng, tam);
            double dx = p[0] - cx;
            // o caminho mais curto pelo meridiano 180
            if (dx > tam / 2) dx -= tam;
            if (dx < -tam / 2) dx += tam;
            double dy = p[1] - cy;
            saida[0] = (float) (meioX + dx * cos + dy * sin);
            saida[1] = (float) (meioY - dx * sin + dy * cos);
        }
    }

    /** Fator de tamanho do item no zoom (interpolado entre os zooms inteiros, como o {@code icon-size} do MapLibre). */
    static float fatorNoZoom(float[] escala, double zoom) {
        if (escala == null || escala.length == 0) return 1f;
        double i = zoom - ZOOM_INICIAL;
        if (i <= 0) return valido(escala[0]);
        int n = escala.length - 1;
        if (i >= n) return valido(escala[n]);
        int a = (int) Math.floor(i);
        double t = i - a;
        return valido((float) (escala[a] + (escala[a + 1] - escala[a]) * t));
    }

    private static float valido(float f) {
        return Float.isNaN(f) || f <= 0 ? 1f : f;
    }

    /** A caixa do item na tela (px) num ponto projetado: centro (ou topo) no ponto + deslocamento. */
    private void caixaDoItem(Item it, float px, float py, double zoom, RectF saida) {
        float f = fatorNoZoom(it.escala, zoom);
        float w = it.w * f * densidade;
        float h = it.h * f * densidade;
        float x = px + it.dx * densidade - w / 2f;
        float y = it.topo ? py + it.dy * densidade : py + it.dy * densidade - h / 2f;
        saida.set(x, y, x + w, y + h);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        Projecao p = projecao();
        if (p == null || desenho.isEmpty()) return;
        float[] ponto = new float[2];
        int esquerda = mapView.getLeft();
        int topo = mapView.getTop();
        int direita = esquerda + mapView.getWidth();
        int baixo = topo + mapView.getHeight();
        // só dentro do mapa (a camada cobre o contêiner inteiro do plugin)
        canvas.save();
        canvas.clipRect(esquerda, topo, direita, baixo);
        for (Item it : desenho) {
            Bitmap imagem = imagens.get(it.chave);
            if (imagem == null) continue;
            p.projetar(it.lat, it.lng, ponto);
            caixaDoItem(it, ponto[0], ponto[1], p.zoomMapLibre, caixa);
            if (caixa.right < esquerda || caixa.bottom < topo || caixa.left > direita || caixa.top > baixo) continue;
            canvas.drawBitmap(imagem, null, caixa, pintura);
        }
        canvas.restore();
    }

    /** O item de cima, que recebe toque, no ponto do mapa (lat/lng do clique), ou null. */
    Item itemNoPonto(double lat, double lng) {
        Projecao p = projecao();
        if (p == null) return null;
        float[] alvo = new float[2];
        p.projetar(lat, lng, alvo);
        float folga = FOLGA_TOQUE_DP * densidade;
        float[] ponto = new float[2];
        for (int i = desenho.size() - 1; i >= 0; i--) {
            Item it = desenho.get(i);
            if (!it.toque || !imagens.containsKey(it.chave)) continue;
            p.projetar(it.lat, it.lng, ponto);
            caixaDoItem(it, ponto[0], ponto[1], p.zoomMapLibre, caixa);
            if (alvo[0] >= caixa.left - folga && alvo[0] <= caixa.right + folga && alvo[1] >= caixa.top - folga && alvo[1] <= caixa.bottom + folga) {
                return it;
            }
        }
        return null;
    }
}
