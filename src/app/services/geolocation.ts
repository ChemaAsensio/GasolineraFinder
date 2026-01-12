import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Ubicacion } from '../models/location';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  constructor(private http: HttpClient) {}

  getCurrentLocation(options?: PositionOptions): Promise<Ubicacion> {
    return new Promise<Ubicacion>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalización no soportada por el navegador.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;

          try {
            const direccionData = await this.getDireccionOpenStreetMap(lat, lon);

            const ubicacion: Ubicacion = {
              latitud: lat,
              longitud: lon,
              calle: direccionData.calle || '',
              numero: direccionData.numero || '',
              ciudad: direccionData.ciudad || 'Ubicación actual',
              provincia: direccionData.provincia || '',
              direccionCompleta: direccionData.direccionCompleta || '',
            };

            resolve(ubicacion);
          } catch {
            // Devolver ubicación básica si falla la geocodificación
            resolve({
              latitud: lat,
              longitud: lon,
              calle: '',
              numero: '',
              ciudad: 'Ubicación actual',
              provincia: '',
              direccionCompleta: `Lat: ${lat}, Lon: ${lon}`,
            });
          }
        },
        (err) => {
          let errorMsg = 'Error obteniendo ubicación';
          switch (err.code) {
            case err.PERMISSION_DENIED:
              errorMsg = 'Permiso de geolocalización denegado.';
              break;
            case err.POSITION_UNAVAILABLE:
              errorMsg = 'Ubicación no disponible.';
              break;
            case err.TIMEOUT:
              errorMsg = 'Tiempo de espera agotado.';
              break;
          }
          reject(new Error(errorMsg));
        },
        options ?? {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  }

  // Servicio GRATUITO - OpenStreetMap (Nominatim reverse)
  private async getDireccionOpenStreetMap(lat: number, lon: number): Promise<{
    direccionCompleta?: string;
    calle?: string;
    numero?: string;
    ciudad?: string;
    provincia?: string;
  }> {
    // (encodeURIComponent aquí es “por higiene”, aunque lat/lon son números)
    const url =
      `https://nominatim.openstreetmap.org/reverse` +
      `?format=json` +
      `&lat=${encodeURIComponent(String(lat))}` +
      `&lon=${encodeURIComponent(String(lon))}` +
      `&zoom=18` +
      `&addressdetails=1` +
      `&accept-language=es`;

    const response: any = await firstValueFrom(this.http.get(url));

    if (!response?.address) {
      throw new Error('No se pudo obtener la dirección.');
    }

    const address = response.address;

    return {
      direccionCompleta: response.display_name || '',
      calle: address.road || address.street || address.pedestrian || '',
      numero: address.house_number || '',
      ciudad: address.city || address.town || address.village || address.municipality || '',
      provincia: address.state || address.region || '',
    };
  }

  obtenerUbicacionActual(): Promise<Ubicacion> {
    return this.getCurrentLocation();
  }
}
