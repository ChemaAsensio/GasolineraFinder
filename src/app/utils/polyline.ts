export interface LatLngPoint {
  lat: number;
  lng: number;
}

// Decoder estándar de encoded polyline
export function decodePolyline(encoded: string): LatLngPoint[] {
  let index = 0;
  const len = encoded.length;
  const path: LatLngPoint[] = [];
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    path.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return path;
}

// Muestras cada X km (aprox) usando “salto” por índice (simple y suficiente)
export function samplePolyline(points: LatLngPoint[], stepEveryNPoints: number): LatLngPoint[] {
  if (points.length <= 2) return points;
  const out: LatLngPoint[] = [];
  for (let i = 0; i < points.length; i += stepEveryNPoints) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

// Distancia Haversine (km)
export function haversineKm(a: LatLngPoint, b: LatLngPoint): number {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Distancia mínima aproximada de un punto a la polyline (recta por tramos)
export function minDistancePointToPolylineKm(point: LatLngPoint, poly: LatLngPoint[]): number {
  if (poly.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const d = distancePointToSegmentKm(point, poly[i], poly[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

// Aproximación: proyectar en plano “local” (bien para distancias cortas)
function distancePointToSegmentKm(p: LatLngPoint, a: LatLngPoint, b: LatLngPoint): number {
  // Convertimos a “xy” usando equirectangular
  const toXY = (x: LatLngPoint, refLat: number) => {
    const k = 111.32; // km por grado aprox
    const cos = Math.cos((refLat * Math.PI) / 180);
    return { x: x.lng * k * cos, y: x.lat * k };
  };

  const refLat = (a.lat + b.lat) / 2;
  const P = toXY(p, refLat);
  const A = toXY(a, refLat);
  const B = toXY(b, refLat);

  const ABx = B.x - A.x;
  const ABy = B.y - A.y;

  const APx = P.x - A.x;
  const APy = P.y - A.y;

  const ab2 = ABx * ABx + ABy * ABy;
  const t = ab2 === 0 ? 0 : (APx * ABx + APy * ABy) / ab2;

  const tt = Math.max(0, Math.min(1, t));
  const proj = { x: A.x + tt * ABx, y: A.y + tt * ABy };

  const dx = P.x - proj.x;
  const dy = P.y - proj.y;

  return Math.sqrt(dx * dx + dy * dy);
}
