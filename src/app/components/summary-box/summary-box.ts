// summary-box.ts - Versión completa
import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Gasolinera } from '../../models/station';
import { Filters } from '../../models/filter';
import { GasolineraService } from '../../services/api/gasolinera';

@Component({
  selector: 'app-summary-box',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './summary-box.html',
  styleUrls: ['./summary-box.scss']
})
export class SummaryBoxComponent implements OnInit, OnDestroy {  // ← Asegúrate que es SummaryBoxComponent
  @Input() stations: Gasolinera[] = [];
  @Input() filters!: Filters;
  
  horaActual: string = '';
  actualizadoHace: string = '0 segundos';
  private ultimaActualizacion: Date = new Date();
  private intervalHora: any;
  private intervalActualizado: any;
  
  ordenSeleccionado: 'distance' | 'price' = 'distance';
  radioSeleccionado: number = 10;
  
  tiposCombustible = [
    { value: 'Gasolina 95 E5', label: 'Gasolina 95' },
    { value: 'Gasolina 98 E5', label: 'Gasolina 98' },
    { value: 'Gasóleo A', label: 'Diésel' },
    { value: 'Gasóleo Premium', label: 'Diésel Premium' },
    { value: 'GLP', label: 'GLP' }
  ];
  combustibleSeleccionado: string = 'Gasolina 95 E5';
  
  topGasolineras: Gasolinera[] = [];

  constructor(private gasolineraService: GasolineraService) {}

  ngOnInit(): void {
    this.actualizarHora();
    this.actualizarTiempoTranscurrido();
    
    this.intervalHora = setInterval(() => {
      this.actualizarHora();
    }, 1000);
    
    this.intervalActualizado = setInterval(() => {
      this.actualizarTiempoTranscurrido();
    }, 30000);
    
    this.actualizarTopGasolineras();
  }

  ngOnDestroy(): void {
    if (this.intervalHora) clearInterval(this.intervalHora);
    if (this.intervalActualizado) clearInterval(this.intervalActualizado);
  }

  actualizarHora(): void {
    const ahora = new Date();
    this.horaActual = ahora.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
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

  actualizarTopGasolineras(): void {
    if (!this.stations.length) return;
    
    let gasolinerasFiltradas = this.stations;
    
    if (this.ordenSeleccionado === 'distance') {
      gasolinerasFiltradas = [...gasolinerasFiltradas].sort(() => 0.5 - Math.random());
    } else if (this.ordenSeleccionado === 'price') {
      gasolinerasFiltradas = [...gasolinerasFiltradas].sort((a, b) => {
        const precioA = this.obtenerPrecioGasolinera(a, this.combustibleSeleccionado);
        const precioB = this.obtenerPrecioGasolinera(b, this.combustibleSeleccionado);
        
        if (precioA === 0 && precioB === 0) return 0;
        if (precioA === 0) return 1;
        if (precioB === 0) return -1;
        
        return precioA - precioB;
      });
    }
    
    this.topGasolineras = gasolinerasFiltradas.slice(0, 10);
    this.ultimaActualizacion = new Date();
  }

  obtenerPrecioGasolinera(gasolinera: Gasolinera, combustible: string): number {
    switch (combustible) {
      case 'Gasolina 95 E5': return gasolinera.precioGasolina95 || 0;
      case 'Gasolina 98 E5': return gasolinera.precioGasolina98 || 0;
      case 'Gasóleo A': return gasolinera.precioDiesel || 0;
      case 'Gasóleo Premium': return gasolinera.precioDieselPremium || 0;
      case 'GLP': return gasolinera.precioGLP || 0;
      default: return 0;
    }
  }

  obtenerDistanciaSimulada(index: number): number {
    if (index === 0) return 0.5 + Math.random() * 0.5;
    if (index === 1) return 1.0 + Math.random() * 1.0;
    if (index === 2) return 1.5 + Math.random() * 1.0;
    return 2.0 + Math.random() * 3.0;
  }

  onOrdenChange(): void {
    this.actualizarTopGasolineras();
  }

  onRadioChange(): void {
    this.actualizarTopGasolineras();
  }

  onCombustibleChange(): void {
    this.actualizarTopGasolineras();
  }

  obtenerHorarioFormateado(horario: string): string {
    if (!horario) return 'No disponible';
    const horarioLower = horario.toLowerCase();
    
    if (horarioLower.includes('24h') || horarioLower.includes('24 horas')) {
      return '✅ 24h';
    } else if (horarioLower.includes('cerrado')) {
      return '🔴 Cerrado';
    }
    
    return horario;
  }

  obtenerValoracionEstrellas(): string {
    return '★★★★☆';
  }

  obtenerEmpresa(gasolinera: Gasolinera): string {
    const rotulo = gasolinera.rotulo || '';
    
    if (rotulo.includes('REPSOL')) return 'REPSOL';
    if (rotulo.includes('CEPSA')) return 'CEPSA';
    if (rotulo.includes('BP')) return 'BP';
    if (rotulo.includes('GALP')) return 'GALP';
    if (rotulo.includes('AVIA')) return 'AVIA';
    if (rotulo.includes('PETRONOR')) return 'PETRONOR';
    if (rotulo.includes('CARREFOUR')) return 'CARREFOUR';
    if (rotulo.includes('ALCAMPO')) return 'ALCAMPO';
    if (rotulo.includes('E.LECLERC') || rotulo.includes('LECLERC')) return 'E.LECLERC';
    if (rotulo.includes('SHELL')) return 'SHELL';
    
    return rotulo.split(' ')[0] || 'Desconocida';
  }
}