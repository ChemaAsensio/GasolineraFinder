import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface LatLng {
  lat: number;
  lng: number;
}

@Injectable({ providedIn: 'root' })
export class GoogleGeocodingService {
  private readonly baseUrl = 'https://maps.googleapis.com/maps/api/geocode/json';

  constructor(private http: HttpClient) {}

  async geocodeAddress(address: string): Promise<LatLng> {
  const url = `${this.baseUrl}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(environment.googleMapsApiKey)}&language=es&region=es&components=country:ES`;

  try {
    const res = await firstValueFrom(this.http.get<any>(url));

    if (!res) throw new Error('Respuesta vacía de Geocoding.');
    if (res.status !== 'OK' || !res.results?.length) {
      const msg = res.error_message || `status=${res.status}`;
      throw new Error(`Geocoding: ${msg}`);
    }

    const loc = res.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  } catch (err: any) {
    // Esto te deja un mensaje claro aunque sea error HTTP
    const msg =
      err?.error?.error_message ||
      err?.error?.message ||
      err?.message ||
      'Error desconocido en Geocoding';
    throw new Error(msg);
  }
}

}
