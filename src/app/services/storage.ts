import { Injectable } from '@angular/core';
import { Filters } from '../models/filter';
import { Ubicacion } from '../models/location';

@Injectable({
  providedIn: 'root'
})
export class StorageService {  // Asegúrate que se llama StorageService
  private readonly FILTERS_KEY = 'gasolinera_filters';
  private readonly LOCATION_KEY = 'gasolinera_location';

  guardarFiltros(filters: Filters): void {
    localStorage.setItem(this.FILTERS_KEY, JSON.stringify(filters));
  }

  obtenerFiltros(): Filters | null {
    const data = localStorage.getItem(this.FILTERS_KEY);
    return data ? JSON.parse(data) : null;
  }

  guardarUbicacion(ubicacion: Ubicacion): void {
    localStorage.setItem(this.LOCATION_KEY, JSON.stringify(ubicacion));
  }

  obtenerUbicacion(): Ubicacion | null {
    const data = localStorage.getItem(this.LOCATION_KEY);
    return data ? JSON.parse(data) : null;
  }

  limpiarStorage(): void {
    localStorage.removeItem(this.FILTERS_KEY);
    localStorage.removeItem(this.LOCATION_KEY);
  }
}