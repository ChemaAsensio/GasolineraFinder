import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
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
    const url = `${this.baseUrl}?address=${encodeURIComponent(address)}&key=${environment.googleMapsApiKey}`;

    const res = await firstValueFrom(this.http.get<any>(url));
    if (!res?.results?.length) {
      throw new Error('No se pudo geocodificar la dirección.');
    }

    const loc = res.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  }
}
