import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: 'patient' | 'nurse' | 'request';
  label?: string;
}

const COLORS = { patient: '#0b4a9c', nurse: '#14a39a', request: '#5db83a' };

function icon(kind: MapMarker['kind']) {
  const c = COLORS[kind];
  const glyph = kind === 'nurse' ? '✚' : kind === 'patient' ? '⌂' : '•';
  return L.divIcon({
    className: 'map-pin',
    html: `<div style="background:${c}" class="map-pin-dot">${glyph}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

interface Props {
  markers: MapMarker[];
  center?: { lat: number; lng: number };
  onPick?: (p: { lat: number; lng: number }) => void;
  route?: boolean;
  height?: number | string;
  zoom?: number;
}

/** Carte OpenStreetMap légère (Leaflet). */
export function MapView({ markers, center, onPick, route, height = 220, zoom = 14 }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const layer = useRef<L.LayerGroup>();
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!el.current) return;
    const c = center ?? markers[0] ?? { lat: 13.5137, lng: 2.1098 };
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([c.lat, c.lng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => {
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const mk of markers) {
      const marker = L.marker([mk.lat, mk.lng], { icon: icon(mk.kind) });
      if (mk.label) marker.bindTooltip(mk.label);
      marker.addTo(g);
    }
    if (route && markers.length >= 2) {
      L.polyline(
        markers.map((mk) => [mk.lat, mk.lng] as [number, number]),
        { color: '#14a39a', weight: 4, dashArray: '6 8' },
      ).addTo(g);
    }
    if (markers.length >= 2) m.fitBounds(L.latLngBounds(markers.map((mk) => [mk.lat, mk.lng])), { padding: [40, 40], maxZoom: 15 });
    else if (center) m.setView([center.lat, center.lng], m.getZoom());
  }, [markers, center, route]);

  return <div ref={el} className="map" style={{ height }} />;
}
