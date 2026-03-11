import { useRef, useCallback } from "react";

/**
 * Hook que gerencia a renderização incremental dos elementos do mapa Google.
 * Em vez de destruir e recriar tudo, compara o que mudou e atualiza apenas o necessário.
 */
export default function useMapRenderer(mapInstanceRef) {
  const polygonsRef = useRef(new Map()); // key: area.id
  const labelsRef = useRef(new Map());   // key: area.id
  const markersRef = useRef(new Map());  // key: item.id
  const polylinesRef = useRef(new Map()); // key: linha.id
  const userMarkerRef = useRef(null);
  const userCircleRef = useRef(null);

  const clearAll = useCallback(() => {
    polygonsRef.current.forEach(p => p.setMap(null));
    polygonsRef.current.clear();
    labelsRef.current.forEach(l => l.setMap(null));
    labelsRef.current.clear();
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current.clear();
    polylinesRef.current.forEach(l => l.setMap(null));
    polylinesRef.current.clear();
    if (userMarkerRef.current) { userMarkerRef.current.setMap(null); userMarkerRef.current = null; }
    if (userCircleRef.current) { userCircleRef.current.setMap(null); userCircleRef.current = null; }
  }, []);

  // ─── Áreas (Polígonos) ───
  const syncAreas = useCallback((areas, show, onClickArea, onRightClickArea) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentIds = new Set(show ? areas.map(a => a.id) : []);

    // Remover polígonos que não existem mais
    polygonsRef.current.forEach((poly, id) => {
      if (!currentIds.has(id)) {
        poly.setMap(null);
        polygonsRef.current.delete(id);
      }
    });
    labelsRef.current.forEach((overlay, id) => {
      if (!currentIds.has(id)) {
        overlay.setMap(null);
        labelsRef.current.delete(id);
      }
    });

    if (!show) return;

    areas.forEach(area => {
      const coords = area.coordenadas?.coords || [];
      if (coords.length < 3) return;

      const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const cor = area.coordenadas?.cor || area.cor || '#61aad9';

      // Verificar se polígono já existe
      if (polygonsRef.current.has(area.id)) {
        // Já existe - não recriar
        return;
      }

      // Criar novo polígono
      const polygon = new google.maps.Polygon({
        paths,
        strokeColor: cor,
        strokeOpacity: 0.6,
        strokeWeight: 1,
        fillColor: cor,
        fillOpacity: 0.5,
      });

      polygon.addListener('mouseover', () => {
        polygon.setOptions({ strokeColor: '#ffffff', strokeOpacity: 1, strokeWeight: 3 });
      });
      polygon.addListener('mouseout', () => {
        polygon.setOptions({ strokeColor: cor, strokeOpacity: 0.6, strokeWeight: 1 });
      });
      polygon.addListener('click', (e) => {
        if (e.vertex === undefined) onClickArea(area);
      });
      polygon.addListener('rightclick', () => {
        onRightClickArea(area);
      });

      polygon.setMap(map);
      polygonsRef.current.set(area.id, polygon);

      // Label do nome da área
      const center = calcCentroid(paths);
      const labelDiv = document.createElement('div');
      labelDiv.innerHTML = `<div style="color:white;text-align:center;white-space:nowrap;text-shadow:1px 1px 2px rgba(0,0,0,0.7);pointer-events:none;font-family:Arial,sans-serif;font-size:12px;font-weight:600;">${area.nome || 'Sem nome'}</div>`;

      const overlay = new google.maps.OverlayView();
      overlay.onAdd = function () { this.getPanes().markerLayer.appendChild(labelDiv); };
      overlay.draw = function () {
        const proj = this.getProjection();
        if (!proj) return;
        const pos = proj.fromLatLngToDivPixel(center);
        if (!pos) return;
        labelDiv.style.position = 'absolute';
        labelDiv.style.left = pos.x + 'px';
        labelDiv.style.top = pos.y + 'px';
        labelDiv.style.transform = 'translate(-50%, -50%)';
        labelDiv.style.zIndex = '100';
      };
      overlay.onRemove = function () { labelDiv.parentNode?.removeChild(labelDiv); };
      overlay.setMap(map);
      labelsRef.current.set(area.id, overlay);
    });
  }, [mapInstanceRef]);

  // ─── Pontos de Referência ───
  const syncPontos = useCallback((pontos, show, iconesConfig) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const prefix = 'ponto_';
    const currentIds = new Set(show ? pontos.map(p => prefix + p.id) : []);

    // Remover não existentes
    markersRef.current.forEach((m, id) => {
      if (id.startsWith(prefix) && !currentIds.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    });

    if (!show) return;

    pontos.forEach(ponto => {
      const key = prefix + ponto.id;
      if (markersRef.current.has(key)) return;

      const coords = ponto.coordenadas || {};
      if (!coords.lat || !coords.lng) return;

      const configIcone = iconesConfig.find(ic => ic.tipo_entidade === 'Ponto' && ic.categoria?.toUpperCase().trim() === ponto.tipo?.toUpperCase().trim());
      let markerIcon;
      if (configIcone?.icone_url) {
        markerIcon = { url: configIcone.icone_url, scaledSize: new google.maps.Size(70, 70), anchor: new google.maps.Point(35, 35) };
      } else {
        markerIcon = { path: google.maps.SymbolPath.CIRCLE, scale: 30, fillColor: configIcone?.cor_padrao || ponto.cor || '#0066ff', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 4 };
      }

      const marker = new google.maps.Marker({
        position: { lat: coords.lat, lng: coords.lng },
        map,
        icon: markerIcon,
        title: ponto.nome,
      });

      marker.addListener('click', () => {
        const iw = new google.maps.InfoWindow({
          content: `<div style="padding:10px;"><strong style="font-size:14px;">${ponto.nome}</strong><br/><span style="font-size:12px;color:#666;">${ponto.tipo}</span></div>`
        });
        iw.open(map, marker);
      });

      markersRef.current.set(key, marker);
    });
  }, [mapInstanceRef]);

  // ─── Linhas Geográficas ───
  const syncLinhas = useCallback((linhas, show) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentIds = new Set(show ? linhas.map(l => l.id) : []);

    polylinesRef.current.forEach((pl, id) => {
      if (!currentIds.has(id)) {
        pl.setMap(null);
        polylinesRef.current.delete(id);
      }
    });

    if (!show) return;

    linhas.forEach(linha => {
      if (polylinesRef.current.has(linha.id)) return;

      const coords = linha.coordenadas?.coords || [];
      if (coords.length < 2) return;

      const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const cor = linha.coordenadas?.cor || linha.cor || '#f59e0b';

      const polyline = new google.maps.Polyline({
        path: paths,
        strokeColor: cor,
        strokeOpacity: 1,
        strokeWeight: 3,
      });

      polyline.addListener('click', () => {
        const bounds = new google.maps.LatLngBounds();
        paths.forEach(p => bounds.extend(p));
        const iw = new google.maps.InfoWindow({
          content: `<div style="padding:10px;"><strong style="font-size:14px;">${linha.nome}</strong><br/><span style="font-size:12px;color:#666;">${linha.tipo} - ${linha.comprimento_metros ? (linha.comprimento_metros / 1000).toFixed(2) + ' km' : 'N/A'}</span></div>`
        });
        iw.setPosition(bounds.getCenter());
        iw.open(map);
      });

      polyline.setMap(map);
      polylinesRef.current.set(linha.id, polyline);
    });
  }, [mapInstanceRef]);

  // ─── Pontos de Suplementação ───
  const syncPontosSuplementacao = useCallback((pontosSupl, show, iconesConfig, onClick) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const prefix = 'supl_';
    const currentIds = new Set(show ? pontosSupl.map(p => prefix + p.id) : []);

    markersRef.current.forEach((m, id) => {
      if (id.startsWith(prefix) && !currentIds.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    });

    if (!show) return;

    pontosSupl.forEach(ponto => {
      const key = prefix + ponto.id;
      if (markersRef.current.has(key)) return;

      const coords = ponto.coordenadas || {};
      if (!coords.lat || !coords.lng) return;

      const configIcone = iconesConfig.find(ic =>
        ic.categoria?.toUpperCase().trim() === 'COCHO' ||
        ic.categoria?.toUpperCase().trim() === ponto.tipo?.toUpperCase().trim()
      );

      let markerIcon;
      if (configIcone?.icone_url) {
        markerIcon = { url: configIcone.icone_url, scaledSize: new google.maps.Size(70, 70), anchor: new google.maps.Point(35, 35) };
      } else {
        markerIcon = { path: google.maps.SymbolPath.CIRCLE, scale: 30, fillColor: configIcone?.cor_padrao || '#10b981', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 4 };
      }

      const marker = new google.maps.Marker({
        position: { lat: coords.lat, lng: coords.lng },
        map,
        icon: markerIcon,
        title: ponto.nome_ponto,
        zIndex: 500
      });

      marker.addListener('click', () => onClick(ponto));
      markersRef.current.set(key, marker);
    });
  }, [mapInstanceRef]);

  // ─── Lotes (agrupados por área) ───
  const syncLotes = useCallback((lotesFiltrados, areas, show, iconesConfig, onClickLotes, onDragLotes) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const prefix = 'lote_area_';

    // Primeiro: agrupar lotes por área
    const lotesPorArea = {};
    if (show) {
      lotesFiltrados.forEach(lote => {
        if (!lote.area_atual_id) return;
        if (!lotesPorArea[lote.area_atual_id]) lotesPorArea[lote.area_atual_id] = [];
        lotesPorArea[lote.area_atual_id].push(lote);
      });
    }

    const currentIds = new Set(Object.keys(lotesPorArea).map(id => prefix + id));

    // Remover antigos
    markersRef.current.forEach((m, id) => {
      if (id.startsWith(prefix) && !currentIds.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    });

    if (!show) return;

    Object.entries(lotesPorArea).forEach(([areaId, lotesNaArea]) => {
      const key = prefix + areaId;
      const area = areas.find(a => a.id === areaId);
      if (!area || !area.coordenadas?.coords || area.coordenadas.coords.length < 3) return;

      const paths = area.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const bounds = new google.maps.LatLngBounds();
      paths.forEach(p => bounds.extend(p));
      const center = bounds.getCenter();

      const totalCabecas = lotesNaArea.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);
      const categorias = [...new Set(lotesNaArea.map(l => l.categoria?.toUpperCase().trim()).filter(Boolean))].sort();

      // Buscar ícone
      let configIcone;
      if (categorias.length === 1) {
        configIcone = iconesConfig.find(ic => ic.tipo_entidade === 'Lote' && ic.categoria?.toUpperCase().trim() === categorias[0]);
      } else if (categorias.length > 1) {
        const configsMisto = iconesConfig.filter(ic =>
          ic.tipo_entidade === 'Lote' && ic.categoria?.toUpperCase() === 'MISTO' && Array.isArray(ic.categorias_misto) && ic.categorias_misto.length > 0
        );
        const configsValidos = configsMisto
          .filter(c => categorias.every(cat => (c.categorias_misto || []).map(x => x.toUpperCase().trim()).includes(cat)))
          .sort((a, b) => a.categorias_misto.length - b.categorias_misto.length);
        if (configsValidos.length > 0) configIcone = configsValidos[0];
      }

      let markerIcon;
      if (configIcone?.icone_url) {
        markerIcon = { url: configIcone.icone_url, scaledSize: new google.maps.Size(70, 70), anchor: new google.maps.Point(35, 35), labelOrigin: new google.maps.Point(35, 25) };
      } else {
        markerIcon = { path: google.maps.SymbolPath.CIRCLE, scale: 30, fillColor: '#10b981', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 4, labelOrigin: new google.maps.Point(0, 0) };
      }

      const totalAlertas = lotesNaArea.reduce((sum, l) => sum + (l.alertas?.length || 0), 0);

      // Verificar se já existe
      if (markersRef.current.has(key)) {
        const existing = markersRef.current.get(key);
        // Atualizar label se mudou
        const currentLabel = existing.getLabel();
        if (currentLabel?.text !== String(totalCabecas)) {
          existing.setLabel({ text: String(totalCabecas), color: '#ffffff', fontSize: '11px', fontWeight: 'bold' });
        }
        // Atualizar dados associados
        existing._lotesNaArea = lotesNaArea;
        return;
      }

      const marker = new google.maps.Marker({
        position: center,
        map,
        icon: markerIcon,
        label: { text: String(totalCabecas), color: '#ffffff', fontSize: '11px', fontWeight: 'bold' },
        title: area.nome,
        zIndex: totalAlertas > 0 ? 2000 : 1000,
        draggable: true
      });

      marker._lotesNaArea = lotesNaArea;
      marker._center = center;
      marker._areaId = areaId;

      marker.addListener('click', () => onClickLotes(marker._lotesNaArea));

      marker.addListener('dragend', (e) => {
        marker.setPosition(marker._center); // Volta para posição original imediatamente
        onDragLotes(e.latLng, marker._lotesNaArea, areaId, areas);
      });

      markersRef.current.set(key, marker);
    });
  }, [mapInstanceRef]);

  // ─── Tarefas no Mapa ───
  const syncTarefas = useCallback((tarefasMapa, onClickTarefa) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const prefix = 'tarefa_';
    const currentIds = new Set(tarefasMapa.map(t => prefix + t.id));

    markersRef.current.forEach((m, id) => {
      if (id.startsWith(prefix) && !currentIds.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    });

    const prioridadeCores = { 'Baixa': '#94a3b8', 'Normal': '#3b82f6', 'Alta': '#f59e0b', 'Urgente': '#ef4444' };

    tarefasMapa.forEach(tarefa => {
      const key = prefix + tarefa.id;
      if (markersRef.current.has(key)) return;
      if (!tarefa.coordenadas?.lat || !tarefa.coordenadas?.lng) return;

      const cor = prioridadeCores[tarefa.prioridade] || '#3b82f6';

      const marker = new google.maps.Marker({
        position: { lat: tarefa.coordenadas.lat, lng: tarefa.coordenadas.lng },
        map,
        icon: {
          path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
          fillColor: cor, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2, scale: 1.8, anchor: new google.maps.Point(12, 22)
        },
        title: tarefa.titulo,
        zIndex: tarefa.prioridade === 'Urgente' ? 3000 : 2500
      });

      marker.addListener('click', () => onClickTarefa(tarefa));
      markersRef.current.set(key, marker);
    });
  }, [mapInstanceRef]);

  // ─── Localização do Usuário ───
  const syncUserLocation = useCallback((userLocation, show) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!show || !userLocation) {
      if (userMarkerRef.current) { userMarkerRef.current.setMap(null); userMarkerRef.current = null; }
      if (userCircleRef.current) { userCircleRef.current.setMap(null); userCircleRef.current = null; }
      return;
    }

    if (!userMarkerRef.current) {
      userMarkerRef.current = new google.maps.Marker({
        position: userLocation,
        map,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 12, fillColor: '#4285F4', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 },
        title: 'Sua localização',
        zIndex: 10000
      });
      userCircleRef.current = new google.maps.Circle({
        map, center: userLocation, radius: 20,
        fillColor: '#4285F4', fillOpacity: 0.15, strokeColor: '#4285F4', strokeOpacity: 0.3, strokeWeight: 1, zIndex: 9999
      });
    } else {
      userMarkerRef.current.setPosition(userLocation);
      userCircleRef.current.setCenter(userLocation);
    }
  }, [mapInstanceRef]);

  return {
    clearAll,
    syncAreas,
    syncPontos,
    syncLinhas,
    syncPontosSuplementacao,
    syncLotes,
    syncTarefas,
    syncUserLocation,
  };
}

// ─── Helpers ───
function calcCentroid(paths) {
  let centroidLat = 0, centroidLng = 0, signedArea = 0;

  for (let i = 0; i < paths.length; i++) {
    const x0 = paths[i].lat, y0 = paths[i].lng;
    const x1 = paths[(i + 1) % paths.length].lat;
    const y1 = paths[(i + 1) % paths.length].lng;
    const a = x0 * y1 - x1 * y0;
    signedArea += a;
    centroidLat += (x0 + x1) * a;
    centroidLng += (y0 + y1) * a;
  }

  signedArea *= 0.5;
  centroidLat /= (6 * signedArea);
  centroidLng /= (6 * signedArea);

  if (!isFinite(centroidLat) || !isFinite(centroidLng) || !signedArea) {
    const bounds = new google.maps.LatLngBounds();
    paths.forEach(p => bounds.extend(p));
    return bounds.getCenter();
  }

  return new google.maps.LatLng(centroidLat, centroidLng);
}