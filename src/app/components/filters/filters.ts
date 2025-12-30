// src/app/components/filters/filters.ts
import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Filters, FuelType } from '../../models/filter';  // ← Importar desde models

@Component({
  selector: 'app-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './filters.html',
  styleUrls: ['./filters.scss']
})
export class FiltersComponent implements OnInit {
  @Input() empresasDisponibles: string[] = [];
  
  @Input() set filters(value: Filters) {
    this._filters = value;
    this.updateDisplayValues();
  }
  
  get filters(): Filters {
    return this._filters;
  }
  
  @Output() filterChange = new EventEmitter<Filters>();

  private _filters!: Filters;
  
  distanciaDisplay: string = '50 km';
  precioDisplay: string = 'Sin límite';
  
  // Solo las 10 empresas principales
  empresasPrincipales: string[] = [
    'REPSOL',
    'CEPSA', 
    'BP',
    'GALP',
    'AVIA',
    'PETRONOR',
    'CARREFOUR',
    'ALCAMPO',
    'E.LECLERC',
    'SHELL'
  ];
  
  tiposCombustible: {value: FuelType, label: string}[] = [
    { value: 'all', label: 'Todos los combustibles' },
    { value: 'Gasolina 95 E5', label: 'Gasolina 95 E5' },
    { value: 'Gasolina 98 E5', label: 'Gasolina 98 E5' },
    { value: 'Gasóleo A', label: 'Gasóleo A' },
    { value: 'Gasóleo Premium', label: 'Gasóleo Premium' },
    { value: 'GLP', label: 'GLP' }
  ];
  
  opcionesOrden: {value: 'distance' | 'price', label: string}[] = [
    { value: 'distance', label: 'Distancia' },
    { value: 'price', label: 'Precio' }
  ];

  ngOnInit() {
    if (!this._filters) {
      this._filters = {
        fuelType: 'all',
        companies: [],
        maxPrice: 0,
        maxDistance: 50,
        onlyOpen: false,
        sortBy: 'distance',
        companyMode: 'include'
      };
    }
    this.updateDisplayValues();
  }

  onCompanyModeChange(mode: 'include' | 'exclude'): void {
    this.filters.companyMode = mode;
    this.emitChanges();
  }

  toggleCompany(empresa: string, event: Event): void {
    const isChecked = (event.target as HTMLInputElement).checked;
    
    if (isChecked) {
      if (!this.filters.companies.includes(empresa)) {
        this.filters.companies = [...this.filters.companies, empresa];
      }
    } else {
      this.filters.companies = this.filters.companies.filter(e => e !== empresa);
    }
    
    this.emitChanges();
  }

  onCombustibleChange(value: FuelType): void {
    this.filters.fuelType = value;
    this.emitChanges();
  }

  onDistanciaChange(value: string | number): void {
    const numValue = typeof value === 'string' ? Number(value) : value;
    this.filters.maxDistance = numValue;
    this.updateDisplayValues();
    this.emitChanges();
  }

  onPrecioChange(value: string | number): void {
    const numValue = typeof value === 'string' ? Number(value) : value;
    this.filters.maxPrice = numValue === 0 ? 0 : numValue;
    this.updateDisplayValues();
    this.emitChanges();
  }

  onOnlyOpenChange(event: Event): void {
    this.filters.onlyOpen = (event.target as HTMLInputElement).checked;
    this.emitChanges();
  }

  onOrdenChange(value: 'distance' | 'price'): void {
    this.filters.sortBy = value;
    this.emitChanges();
  }

  updateDisplayValues(): void {
    if (this.filters.maxDistance >= 100) {
      this.distanciaDisplay = '100+ km';
    } else {
      this.distanciaDisplay = `${this.filters.maxDistance} km`;
    }
    
    if (this.filters.maxPrice === 0 || this.filters.maxPrice >= 3) {
      this.precioDisplay = 'Sin límite';
    } else {
      this.precioDisplay = `${this.filters.maxPrice.toFixed(3)} €/L`;
    }
  }

  restablecerFiltros(): void {
    this._filters = {
      fuelType: 'all',
      companies: [],
      maxPrice: 0,
      maxDistance: 50,
      onlyOpen: false,
      sortBy: 'distance',
      companyMode: 'include'
    };
    this.updateDisplayValues();
    this.emitChanges();
  }

  emitChanges(): void {
    this.filterChange.emit({...this._filters});
  }

  isEmpresaSeleccionada(empresa: string): boolean {
    return this.filters.companies.includes(empresa);
  }
}