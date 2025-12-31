import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Gasolinera } from '../../models/station';
import { Filters } from '../../models/filter';
import { GasolineraService } from '../../services/api/gasolinera';

@Component({
  selector: 'app-summary-box',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './summary-box.html',
  styleUrls: ['./summary-box.scss']
})
export class SummaryBoxComponent implements OnInit, OnDestroy, OnChanges {
  @Input() stations: Gasolinera[] = [];
  @Input() filters!: Filters;
  @Input() ubicacionUsuario: any;
  
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

  constructor(private gasolineraService: GasolineraService) {}

  ngOnInit(): void {
    this.actualizarTiempo();
    this.actualizarTiempoTranscurrido();
    
    this.intervalHora = setInterval(() => {
      this.actualizarTiempo();
    }, 1000);
    
    this.intervalActualizado = setInterval(() => {
      this.actualizarTiempoTranscurrido();
    }, 30000);
    
    this.calcularEstadisticas();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['stations'] || changes['filters']) {
      this.calcularEstadisticas();
      this.ultimaActualizacion = new Date();
    }
  }

  ngOnDestroy(): void {
    if (this.intervalHora) clearInterval(this.intervalHora);
    if (this.intervalActualizado) clearInterval(this.intervalActualizado);
  }

  actualizarTiempo(): void {
    const ahora = new Date();
    
    // Formatear fecha (ej: "Lunes, 15 de Enero 2024")
    const fechaStr = ahora.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    // Capitalizar primera letra
    this.fechaActual = fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1);
    
    // Formatear hora (ej: "14:30:45")
    this.horaActual = ahora.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false // Para formato 24h
    });
  }

  actualizarTiempoTranscurrido(): void {
    const ahora = new Date();
    const diferencia = Math.floor((ahora.getTime() - this.ultimaActualizacion.getTime()) / 1000);
    
    if (diferencia < 60) {
      this.actualizadoHace = `${diferencia} segundos`;
    } else if (diferencia < 3600) {
      this.actualizadoHace = `${Math.floor(diferencia / 60)} minutos`;
    } else {
      this.actualizadoHace = `${Math.floor(diferencia / 3600)} horas`;
    }
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

      // Verificar si está abierta ahora
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
      abiertasAhora: abiertasAhora,
      porcentajeAbiertasAhora: this.stations.length > 0 ? (abiertasAhora / this.stations.length) * 100 : 0,
      masCercana: masCercana,
      masBarata: masBarata
    };
  }

  // NUEVO MÉTODO: Verificar si una gasolinera está abierta ahora
  estaAbiertaAhora(horario: string, horaActual: number): boolean {
    if (!horario) return false;
    
    const horarioLower = horario.toLowerCase();
    
    // Si está abierta 24h, está abierta ahora
    if (horarioLower.includes('24h') || horarioLower.includes('24 horas') || horarioLower.includes('24horas')) {
      return true;
    }
    
    // Si dice cerrado, no está abierta
    if (horarioLower.includes('cerrado')) {
      return false;
    }
    
    // Intentar extraer horario del formato "08:00-22:00"
    const match = horario.match(/(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?/);
    if (match) {
      const horaInicio = parseInt(match[1]) + (match[2] ? parseInt(match[2]) / 60 : 0);
      const horaFin = parseInt(match[3]) + (match[4] ? parseInt(match[4]) / 60 : 0);
      
      // Si el horario cruza medianoche (ej: 22:00-06:00)
      if (horaFin < horaInicio) {
        return horaActual >= horaInicio || horaActual <= horaFin;
      } else {
        return horaActual >= horaInicio && horaActual <= horaFin;
      }
    }
    
    // Por defecto, asumir horario comercial (8:00-22:00) si no podemos parsear
    return horaActual >= 8 && horaActual <= 22;
  }

  obtenerPrecioRelevante(gasolinera: Gasolinera): number {
    if (!this.filters || this.filters.fuelType === 'all') {
      const preciosDisponibles = [];
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

  obtenerUbicacionFormateada(): string {
    if (this.ubicacionUsuario?.ciudad && this.ubicacionUsuario?.provincia) {
      return `${this.ubicacionUsuario.ciudad}, ${this.ubicacionUsuario.provincia}`;
    } else if (this.ubicacionUsuario?.provincia) {
      return this.ubicacionUsuario.provincia;
    } else if (this.stations[0]?.provincia) {
      return this.stations[0].provincia;
    }
    return 'Ubicación no disponible';
  }

  // NUEVO MÉTODO: Obtener tipo de combustible seleccionado
  obtenerTipoCombustibleSeleccionado(): string {
    if (!this.filters || !this.filters.fuelType || this.filters.fuelType === 'all') {
      return 'Todos los tipos';
    }
    
    // Mapear tipos de combustible a nombres más legibles
    const fuelNames: {[key: string]: string} = {
      'Gasolina 95 E5': 'Gasolina 95 E5',
      'Gasolina 98 E5': 'Gasolina 98 E5',
      'Gasóleo A': 'Gasóleo A',
      'Gasóleo Premium': 'Gasóleo Premium',
      'GLP': 'GLP'
    };
    
    return fuelNames[this.filters.fuelType] || this.filters.fuelType;
  }

  formatearHorario(horario: string): string {
    if (!horario) return 'Horario no disponible';
    const horarioLower = horario.toLowerCase();
    
    if (horarioLower.includes('24h') || horarioLower.includes('24 horas')) {
      return '✅ 24h';
    } else if (horarioLower.includes('cerrado')) {
      return '🔴 Cerrado';
    }
    
    return horario;
  }

  cleanCompanyName(value: string): string {
    if (!value) return '';
    const words = value.split(' ').filter(word => word.trim() !== '');
    const uniqueWords = [...new Set(words)];
    
    if (uniqueWords.length === 1) {
      return uniqueWords[0];
    }
    
    const palabrasComunes = [
      'BILBAO', 'MADRID', 'BARCELONA', 'VALENCIA', 'SEVILLA',
      'C/', 'AV.', 'AVENIDA', 'CALLE', 'PLAZA', 'PASEO',
      'DE', 'LA', 'EL', 'LOS', 'LAS', 'DEL', 'AL',
      'S/N', 'S/Nº', 'KM', 'Nº', 'NUM', 'NUMBER', 'STO', 'DOMINGO'
    ];
    
    const filteredWords = uniqueWords.filter(word => 
      !palabrasComunes.includes(word.toUpperCase())
    );
    
    return filteredWords.length > 0 ? filteredWords.join(' ') : uniqueWords[0] || value;
  }

  formatPrice(value: number): string {
    if (value === null || value === undefined || value === 0) {
      return '--';
    }
    return `€${value.toFixed(3).replace('.', ',')}`;
  }

  formatPercentage(value: number): string {
    return `${value.toFixed(0)}%`;
  }
}