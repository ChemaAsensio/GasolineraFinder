import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LatLng } from './google-geocoding.service';

export interface RouteInfo {
  distanceKm: number;
  durationSec: number;
  polyline?: string; // encoded polyline
  leg1DistanceKm?: number; // distancia hasta el waypoint (si lo hay)
}

@Injectable({ providedIn: 'root' })
export class GoogleRoutesService {
  // Routes API (ComputeRoutes)
  private readonly url = 'https://routes.googleapis.com/directions/v2:computeRoutes';

  constructor(private http: HttpClient) {}

  async computeRoute(
    origin: LatLng,
    destination: LatLng,
    waypoint?: LatLng
  ): Promise<RouteInfo> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': environment.googleMapsApiKey,
      // Pedimos lo necesario: distancia, duración, polyline y legs
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters'
    });

    const body: any = {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      computeAlternativeRoutes: false,
      languageCode: 'es-ES',
      units: 'METRIC',
    };

    if (waypoint) {
      body.intermediates = [
        { location: { latLng: { latitude: waypoint.lat, longitude: waypoint.lng } } }
      ];
    }

    const res = await firstValueFrom(this.http.post<any>(this.url, body, { headers }));
    const route = res?.routes?.[0];
    if (!route) throw new Error('No se pudo calcular la ruta (ComputeRoutes).');

    const distanceKm = (route.distanceMeters ?? 0) / 1000;
    const durationSec = this.parseDuration(route.duration);

    const polyline = route.polyline?.encodedPolyline;

    // legs[0] = origen->waypoint (si hay waypoint)
    let leg1DistanceKm: number | undefined;
    if (waypoint && route.legs?.length) {
      leg1DistanceKm = (route.legs[0].distanceMeters ?? 0) / 1000;
    }

    return { distanceKm, durationSec, polyline, leg1DistanceKm };
  }

  private parseDuration(duration: any): number {
    // v2 devuelve duration como string tipo "1234s" o en algunos casos objeto.
    if (typeof duration === 'string' && duration.endsWith('s')) {
      return Number(duration.replace('s', '')) || 0;
    }
    if (typeof duration === 'object' && duration?.seconds != null) {
      return Number(duration.seconds) || 0;
    }
    return 0;
  }
}
