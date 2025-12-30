import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Ubicacion } from '../../models/location';
import { GeolocationService } from '../../services/geolocation';

@Component({
  selector: 'app-location-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './location-selector.html',
  styleUrl: './location-selector.scss',
})
export class LocationSelectorComponent {
  @Output() locationChange = new EventEmitter<Ubicacion>();

  latText = '';
  lonText = '';

  errorMsg: string | null = null;
  loading = false;

  constructor(private geo: GeolocationService) {}

  emitManualLocation() {
    this.errorMsg = null;

    const latitud = Number(this.latText.replace(',', '.'));
    const longitud = Number(this.lonText.replace(',', '.'));

    if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
      this.errorMsg = 'Latitud/longitud inválidas.';
      return;
    }
    if (latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) {
      this.errorMsg = 'Latitud o longitud fuera de rango.';
      return;
    }

    const ubicacion: Ubicacion = {
      latitud,
      longitud,
      ciudad: 'Ubicación manual',
    };

    this.locationChange.emit(ubicacion);
  }

  async useMyLocation() {
    this.errorMsg = null;
    this.loading = true;

    try {
      const loc = await this.geo.getCurrentLocation();
      this.latText = String(loc.latitud);
      this.lonText = String(loc.longitud);
      this.locationChange.emit(loc);
    } catch (e: any) {
      this.errorMsg = e?.message ?? 'Error obteniendo ubicación.';
    } finally {
      this.loading = false;
    }
  }
}
