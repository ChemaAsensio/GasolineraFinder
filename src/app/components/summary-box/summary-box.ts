import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Gasolinera } from '../../models/station';
import { Filters } from '../../models/filter';
import { GasolineraService } from '../../services/api/gasolinera';

type ModoBusqueda = 'buscar' | 'ruta';

type RutaRowVM = {
  station: Gasolinera;
  kmFromOrigin: number;
  precio: number;
  desvioKm: number;
  desvioEur: number;
  horario: string;
};

type RutaBucketVM = {
  fromKm: number;
  toKm: number;
  items: RutaRowVM[];
};

@Component({
  selector: 'app-summary-box',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './summary-box.html',
  styleUrls: ['./summary-box.scss']
})
export class SummaryBoxComponent implements OnInit, OnDestroy, OnChanges {
  @Input() stations: Gasolinera[] = [];
  @Input() filters: Filters | null = null;
  @Input() ubicacionUsuario: any = null;

  @Input() modo: ModoBusqueda = 'buscar';

  fechaActual: string = '';
  horaActual: string = '';
  actualizadoHace: string = '0 segundos';
  private ultimaActualizacion: Date = new Date();
  private intervalHora: any;
  private intervalActualizado: any;

  estadisticas = {
    total: 0,
    precioPromedio: 0,
    abiertasAhora: 0,
    porcentajeAbiertasAhora: 0,
    masCercana: null as any,
    masBarata: null as any
  };

  rutasPorCubo: RutaBucketVM[] = [];

  constructor(private gasolineraService: GasolineraService) {}

  ngOnInit(): void {
    this.actualizarTiempo();
    this.actualizarTiempoTranscurrido();

    this.intervalHora = setInterval(() => this.actualizarTiempo(), 1000);
    this.intervalActualizado = setInterval(() => this.actualizarTiempoTranscurrido(), 30000);

    this.calcularEstadisticas();
    this.rebuildViewModels();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['stations'] || changes['filters'] || changes['modo']) {
      this.calcularEstadisticas();
      this.ultimaActualizacion = new Date();
      this.rebuildViewModels();
    }
  }

  ngOnDestroy(): void {
    if (this.intervalHora) clearInterval(this.intervalHora);
    if (this.intervalActualizado) clearInterval(this.intervalActualizado);
  }

  // =========================================================
  // Dirección para fallback (Maps)
  // =========================================================
  formatAddressForUi(g: any): string {
    const parts = [g?.direccion || g?.direccionCompleta, g?.municipio, g?.provincia].filter(Boolean);
    if (parts.length) return parts.join(', ');

    const parts2 = [g?.calle, g?.numero, g?.ciudad, g?.provincia].filter(Boolean);
    return parts2.join(', ');
  }

  // =========================================================
  // ✅ BOTÓN “Ir a maps”
  // =========================================================
  openInGoogleMaps(g: Gasolinera): void {
    if (Number.isFinite(g.latitud) && Number.isFinite(g.longitud) && g.latitud !== 0 && g.longitud !== 0) {
      const url = `https://www.google.com/maps/search/?api=1&query=${g.latitud},${g.longitud}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    const addr = this.formatAddressForUi(g);
    if (addr) {
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  // =========================
  // ✅ Tabla modo ruta (VM)
  // =========================
  private rebuildViewModels(): void {
    if (this.modo !== 'ruta') {
      this.rutasPorCubo = [];
      return;
    }

    const rows = (this.stations ?? [])
      .map((s) => this.mapStationToRutaRow(s))
      .filter(r => Number.isFinite(r.kmFromOrigin) && r.kmFromOrigin >= 0)
      .sort((a, b) => a.kmFromOrigin - b.kmFromOrigin);

    if (rows.length === 0) {
      this.rutasPorCubo = [];
      return;
    }

    const maxKm = rows[rows.length - 1].kmFromOrigin;
    const intervalKm = this.inferIntervalKm(maxKm);

    const bucketsMap = new Map<number, RutaBucketVM>();

    for (const r of rows) {
      const idx = Math.floor(r.kmFromOrigin / intervalKm);
      const fromKm = idx * intervalKm;
      const toKm = fromKm + intervalKm;

      if (!bucketsMap.has(idx)) {
        bucketsMap.set(idx, { fromKm, toKm, items: [] });
      }
      bucketsMap.get(idx)!.items.push(r);
    }

    this.rutasPorCubo = Array.from(bucketsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v);
  }

  private inferIntervalKm(maxKm: number): number {
    const raw = Math.round(maxKm / 7);
    const clamped = Math.min(60, Math.max(15, raw));
    return Math.max(5, Math.round(clamped / 5) * 5);
  }

  private mapStationToRutaRow(station: Gasolinera): RutaRowVM {
    const kmFromOrigin = this.getKmFromOrigin(station);
    const precio = this.obtenerPrecioRelevante(station);

    const ri: any = (station as any).routeInfo ?? null;
    const desvioKm = Number.isFinite(ri?.extraKmReal) ? ri.extraKmReal : NaN;
    const desvioEur = Number.isFinite(ri?.costeDesvio) ? ri.costeDesvio : NaN;

    return {
      station,
      kmFromOrigin,
      precio,
      desvioKm,
      desvioEur,
      horario: station.horario || ''
    };
  }

  private getKmFromOrigin(station: Gasolinera): number {
    const anyS: any = station as any;
    if (Number.isFinite(anyS.kmFromOrigin)) return anyS.kmFromOrigin;
    if (Number.isFinite(anyS._kmFromOrigin)) return anyS._kmFromOrigin;
    return NaN;
  }

  // =========================
  // Lo tuyo (sin cambios)
  // =========================
  obtenerPrecioRelevante(gasolinera: Gasolinera): number {
    if (!this.filters || this.filters.fuelType === 'all') {
      const preciosDisponibles: number[] = [];
      if (gasolinera.precioGasolina95 > 0) preciosDisponibles.push(gasolinera.precioGasolina95);
      if (gasolinera.precioGasolina98 > 0) preciosDisponibles.push(gasolinera.precioGasolina98);
      if (gasolinera.precioDiesel > 0) preciosDisponibles.push(gasolinera.precioDiesel);
      if (gasolinera.precioDieselPremium > 0) preciosDisponibles.push(gasolinera.precioDieselPremium);
      if (gasolinera.precioGLP > 0) preciosDisponibles.push(gasolinera.precioGLP);
      return preciosDisponibles.length > 0 ? Math.min(...preciosDisponibles) : 0;
    }

    switch (this.filters.fuelType) {
      case 'Gasolina 95 E5': return gasolinera.precioGasolina95 || 0;
      case 'Gasolina 98 E5': return gasolinera.precioGasolina98 || 0;
      case 'Gasóleo A': return gasolinera.precioDiesel || 0;
      case 'Gasóleo Premium': return gasolinera.precioDieselPremium || 0;
      case 'GLP': return gasolinera.precioGLP || 0;
      default: return 0;
    }
  }

  obtenerTipoCombustibleSeleccionado(): string {
    if (!this.filters || !this.filters.fuelType || this.filters.fuelType === 'all') return 'Todos los tipos';

    const fuelNames: { [key: string]: string } = {
      'Gasolina 95 E5': 'Gasolina 95 E5',
      'Gasolina 98 E5': 'Gasolina 98 E5',
      'Gasóleo A': 'Gasóleo A',
      'Gasóleo Premium': 'Gasóleo Premium',
      'GLP': 'GLP'
    };
    return fuelNames[this.filters.fuelType] || this.filters.fuelType;
  }

  actualizarTiempo(): void {
    const ahora = new Date();

    const fechaStr = ahora.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    this.fechaActual = fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1);

    this.horaActual = ahora.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  actualizarTiempoTranscurrido(): void {
    const ahora = new Date();
    const diferencia = Math.floor((ahora.getTime() - this.ultimaActualizacion.getTime()) / 1000);

    if (diferencia < 60) this.actualizadoHace = `${diferencia} segundos`;
    else if (diferencia < 3600) this.actualizadoHace = `${Math.floor(diferencia / 60)} minutos`;
    else this.actualizadoHace = `${Math.floor(diferencia / 3600)} horas`;
  }

  calcularEstadisticas(): void {
    if (!this.stations.length) {
      this.estadisticas = {
        total: 0,
        precioPromedio: 0,
        abiertasAhora: 0,
        porcentajeAbiertasAhora: 0,
        masCercana: null,
        masBarata: null
      };
      return;
    }

    let precioTotal = 0;
    let precioCount = 0;
    let abiertasAhora = 0;

    let masCercana = this.stations[0];
    let masBarata = this.stations[0];
    let precioMinimo = this.obtenerPrecioRelevante(this.stations[0]);

    const ahora = new Date();
    const horaActual = ahora.getHours();
    const minutosActual = ahora.getMinutes();
    const horaCompletaActual = horaActual + (minutosActual / 60);

    this.stations.forEach(gasolinera => {
      const precio = this.obtenerPrecioRelevante(gasolinera);
      if (precio > 0) {
        precioTotal += precio;
        precioCount++;
      }

      if (this.estaAbiertaAhora(gasolinera.horario, horaCompletaActual)) {
        abiertasAhora++;
      }

      const precioActual = this.obtenerPrecioRelevante(gasolinera);
      if (precioActual > 0 && precioActual < precioMinimo) {
        precioMinimo = precioActual;
        masBarata = gasolinera;
      }
    });

    this.estadisticas = {
      total: this.stations.length,
      precioPromedio: precioCount > 0 ? precioTotal / precioCount : 0,
      abiertasAhora,
      porcentajeAbiertasAhora: this.stations.length > 0 ? (abiertasAhora / this.stations.length) * 100 : 0,
      masCercana,
      masBarata
    };
  }

  estaAbiertaAhora(horario: string, horaActual: number): boolean {
    if (!horario) return false;

    const horarioLower = horario.toLowerCase();
    if (horarioLower.includes('24h') || horarioLower.includes('24 horas') || horarioLower.includes('24horas')) return true;
    if (horarioLower.includes('cerrado')) return false;

    const match = horario.match(/(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?/);
    if (match) {
      const horaInicio = parseInt(match[1], 10) + (match[2] ? parseInt(match[2], 10) / 60 : 0);
      const horaFin = parseInt(match[3], 10) + (match[4] ? parseInt(match[4], 10) / 60 : 0);

      if (horaFin < horaInicio) return horaActual >= horaInicio || horaActual <= horaFin;
      return horaActual >= horaInicio && horaActual <= horaFin;
    }

    return horaActual >= 8 && horaActual <= 22;
  }

  obtenerUbicacionFormateada(): string {
    if (this.ubicacionUsuario?.ciudad && this.ubicacionUsuario?.provincia) return `${this.ubicacionUsuario.ciudad}, ${this.ubicacionUsuario.provincia}`;
    if (this.ubicacionUsuario?.provincia) return this.ubicacionUsuario.provincia;
    if (this.stations[0]?.provincia) return this.stations[0].provincia;
    return 'Ubicación no disponible';
  }

  formatearHorario(horario: string): string {
    if (!horario) return 'Horario no disponible';
    const horarioLower = horario.toLowerCase();

    if (horarioLower.includes('24h') || horarioLower.includes('24 horas')) return '✅ 24h';
    if (horarioLower.includes('cerrado')) return '🔴 Cerrado';
    return horario;
  }

  cleanCompanyName(value: string): string {
    if (!value) return '';
    const words = value.split(' ').filter(word => word.trim() !== '');
    const uniqueWords = [...new Set(words)];

    if (uniqueWords.length === 1) return uniqueWords[0];

    const palabrasComunes = [
      'BILBAO', 'MADRID', 'BARCELONA', 'VALENCIA', 'SEVILLA',
      'C/', 'AV.', 'AVENIDA', 'CALLE', 'PLAZA', 'PASEO',
      'DE', 'LA', 'EL', 'LOS', 'LAS', 'DEL', 'AL',
      'S/N', 'S/Nº', 'KM', 'Nº', 'NUM', 'NUMBER', 'STO', 'DOMINGO'
    ];

    const filteredWords = uniqueWords.filter(word => !palabrasComunes.includes(word.toUpperCase()));
    return filteredWords.length > 0 ? filteredWords.join(' ') : uniqueWords[0] || value;
  }

  formatPrice(value: number): string {
    if (value === null || value === undefined || value === 0 || isNaN(value)) return '--';
    return `€${value.toFixed(3).replace('.', ',')}`;
  }

  formatPercentage(value: number): string {
    if (value === null || value === undefined || isNaN(value)) return '0%';
    return `${value.toFixed(0)}%`;
  }

  formatKm1(value: number): string {
    if (value === null || value === undefined || isNaN(value)) return '--';
    return `${value.toFixed(1)}`;
  }

  formatEur2(value: number): string {
    if (value === null || value === undefined || isNaN(value) || value === 0) return '--';
    return `€${value.toFixed(2).replace('.', ',')}`;
  }

  getDireccionCompleta(g: Gasolinera): string {
    return (
      (g as any).direccionCompleta
      || g.direccion
      || (g.calle ? (g.calle + (g.numero ? (', ' + g.numero) : '')) : '')
      || (g.municipio ? (g.municipio + (g.provincia ? (', ' + g.provincia) : '')) : '')
      || 'Dirección no disponible'
    );
  }

  getRouteInfo(g: Gasolinera): any | null {
    return (g as any)?.routeInfo ?? null;
  }

  getDesvioKm(g: Gasolinera): number | null {
    const ri = this.getRouteInfo(g);
    return ri?.extraKmReal ?? null;
  }

  getDesvioEuro(g: Gasolinera): number | null {
    const ri = this.getRouteInfo(g);
    return ri?.costeDesvio ?? null;
  }

  getDireccionVisible(g: Gasolinera): string {
    const anyG: any = g as any;
    return (
      anyG?.direccionCompleta ||
      g.direccion ||
      (g.calle ? (g.calle + (g.numero ? (', ' + g.numero) : '')) : '') ||
      (g.municipio ? (g.municipio + (g.provincia ? (', ' + g.provincia) : '')) : '') ||
      'Dirección no disponible'
    );
  }
}
