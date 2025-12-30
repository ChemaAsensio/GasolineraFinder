import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GasolineraService } from '../../services/api/gasolinera';
import { GeolocationService } from '../../services/geolocation';
import { StorageService } from '../../services/storage';
import { CompanyNormalizerService } from '../../services/company-normalizer'; // ← Agrega esta importación
import { Gasolinera } from '../../models/station';
import { Filters } from '../../models/filter';
import { FiltersComponent } from '../../components/filters/filters';
import { SummaryBoxComponent } from '../../components/summary-box/summary-box';
import { StationList } from '../../components/station-list/station-list';
import { Ubicacion } from '../../models/location';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    FiltersComponent,
    SummaryBoxComponent,  // ← Cambia SummaryBox por SummaryBoxComponent
    StationList
  ],
  templateUrl: './home.html',
  styleUrls: ['./home.scss'],
})
export class Home implements OnInit {
  gasolineras: Gasolinera[] = [];
  gasolinerasFiltradas: Gasolinera[] = [];
  gasolineraSeleccionada: Gasolinera | null = null;

  modoSeleccionado: 'buscar' | 'ruta' = 'buscar';  

  ubicacionUsuario: Ubicacion = {
    latitud: 40.4168,
    longitud: -3.7038,
    calle: '',
    numero: '',
    ciudad: 'Madrid',
    provincia: 'Madrid',
    direccionCompleta: ''
  };

  destino = {
    calle: '',
    numero: '',
    ciudad: '',
    provincia: ''
  };

  filters: Filters = {
    fuelType: 'all',
    companies: [],
    maxPrice: 0,
    maxDistance: 50,
    onlyOpen: false,
    sortBy: 'distance',
    companyMode: 'include'
  };

  cargando = false;
  error: string | null = null;
  empresasDisponibles: string[] = [];

  constructor(
    private gasolineraService: GasolineraService,
    private geolocationService: GeolocationService,
    private storageService: StorageService,
    private companyNormalizer: CompanyNormalizerService // ← Agrega esta inyección
  ) {}

  ngOnInit(): void {
    const savedLocation = this.storageService.obtenerUbicacion();
    if (savedLocation) {
      this.ubicacionUsuario = savedLocation;
    }
    
    // Inicializar companyMode si no existe (para compatibilidad)
    if (!this.filters.companyMode) {
      this.filters.companyMode = 'include';
    }
    
    this.cargarGasolineras();
  }

  obtenerUbicacion(): void {
    this.geolocationService.getCurrentLocation()
      .then((nuevaUbicacion) => {
        this.ubicacionUsuario = {
          latitud: nuevaUbicacion.latitud,
          longitud: nuevaUbicacion.longitud,
          calle: nuevaUbicacion.calle || '',
          numero: nuevaUbicacion.numero || '',
          ciudad: nuevaUbicacion.ciudad || 'Ubicación actual',
          provincia: nuevaUbicacion.provincia || '',
          direccionCompleta: nuevaUbicacion.direccionCompleta || ''
        };
        
        this.storageService.guardarUbicacion(this.ubicacionUsuario);
        this.cargarGasolineras();
      })
      .catch((error) => {
        alert(`Error obteniendo ubicación: ${error.message}`);
      });
  }

  // Método para analizar la zona
  analizarZona(): void {
    console.log('=== ANÁLISIS DE ZONA ===');
    
    if (!this.gasolineras.length) {
      console.log('No hay gasolineras cargadas');
      alert('Primero debes cargar las gasolineras');
      return;
    }
    
    const estadisticas = this.gasolineraService.obtenerEstadisticasZona(
      this.gasolineras,
      this.ubicacionUsuario,
      50 // radio de 50km
    );
    
    // Mostrar alerta informativa
    alert(`📊 Estadísticas en 50km:\n` +
      `Total: ${estadisticas.total} gasolineras\n` +
      `Gasolina 95: ${estadisticas.conGasolina95}\n` +
      `Gasolina 98: ${estadisticas.conGasolina98}\n` +
      `Diésel: ${estadisticas.conDiesel}\n` +
      `Diésel Premium: ${estadisticas.conDieselPremium}\n` +
      `GLP: ${estadisticas.conGLP}\n\n` +
      `📍 Ubicación actual:\n` +
      `Lat: ${this.ubicacionUsuario.latitud.toFixed(4)}\n` +
      `Lon: ${this.ubicacionUsuario.longitud.toFixed(4)}`);
  }

  cargarGasolineras(): void {
    this.cargando = true;
    this.error = null;
    
    this.gasolineraService.getGasolineras().subscribe({
      next: (data) => {
        if (data.length === 0) {
          this.error = 'No se encontraron gasolineras en la API.';
          this.cargando = false;
          return;
        }
        this.gasolineras = data;
        this.extraerEmpresasUnicas();
        this.aplicarFilters();
        this.cargando = false;
      },
      error: (error) => {
        this.error = 'Error al cargar gasolineras. La API podría no estar disponible.';
        this.cargando = false;
      },
    });
  }


depurarFiltroAbiertas(): void {
  if (!this.gasolineras.length) {
    console.log('No hay gasolineras cargadas');
    alert('Primero carga las gasolineras');
    return;
  }
  
  console.log('=== DEPURACIÓN FILTRO "SOLO ABIERTAS" ===');
  console.log(`Filtro activado: ${this.filters.onlyOpen ? 'SÍ' : 'NO'}`);
  
  // Contar gasolineras por tipo de horario
  const conteoHorarios = {
    con24h: 0,
    conCerrado: 0,
    sinHorario: 0,
    otros: 0
  };
  
  const ejemplosOtros: string[] = [];
  
  // Analizar horarios de todas las gasolineras
  this.gasolineras.forEach((g, index) => {
    const horario = g.horario || '';
    const horarioLower = horario.toLowerCase();
    
    if (horario === '') {
      conteoHorarios.sinHorario++;
    } else if (horarioLower.includes('24h') || horarioLower.includes('24 horas')) {
      conteoHorarios.con24h++;
    } else if (horarioLower.includes('cerrado') || horarioLower.includes('cl.')) {
      conteoHorarios.conCerrado++;
    } else {
      conteoHorarios.otros++;
      
      // Guardar algunos ejemplos de otros horarios
      if (ejemplosOtros.length < 5) {
        ejemplosOtros.push(horario);
      }
    }
  });
  
  console.log('📊 Estadísticas de horarios:');
  console.log(`  Con "24h": ${conteoHorarios.con24h}`);
  console.log(`  Con "cerrado" o "cl.": ${conteoHorarios.conCerrado}`);
  console.log(`  Sin horario: ${conteoHorarios.sinHorario}`);
  console.log(`  Otros formatos: ${conteoHorarios.otros}`);
  
  if (ejemplosOtros.length > 0) {
    console.log('🔍 Ejemplos de otros horarios:');
    ejemplosOtros.forEach((horario, i) => {
      console.log(`  ${i+1}. "${horario}"`);
    });
  }
  
  // Probar el filtro actual
  const filtradas = this.gasolineras.filter(g => {
    const horario = g.horario?.toLowerCase() || '';
    return !(horario.includes('cerrado') && !horario.includes('24h'));
  });
  
  console.log(`🔧 Con filtro activado: ${filtradas.length} de ${this.gasolineras.length} gasolineras`);
  
  // Mostrar algunas gasolineras filtradas y no filtradas
  console.log('🔍 Ejemplos (primeras 5):');
  for (let i = 0; i < Math.min(5, this.gasolineras.length); i++) {
    const g = this.gasolineras[i];
    const horario = g.horario || '';
    const pasaFiltro = !(horario.toLowerCase().includes('cerrado') && !horario.toLowerCase().includes('24h'));
    
    console.log(`  ${i+1}. ${g.rotulo} - Horario: "${horario}" - ${pasaFiltro ? '✅ PASA' : '❌ FILTRADA'}`);
  }
  
  alert(`📊 Estadísticas de horarios:\n` +
    `• Con "24h": ${conteoHorarios.con24h}\n` +
    `• Con "cerrado": ${conteoHorarios.conCerrado}\n` +
    `• Sin horario: ${conteoHorarios.sinHorario}\n` +
    `• Otros: ${conteoHorarios.otros}\n\n` +
    `Con filtro activado: ${filtradas.length} de ${this.gasolineras.length} gasolineras`);
}

// Método para exportar datos a la consola
exportarDatosParaDepuracion(): void {
  console.log('=== DATOS PARA DEPURACIÓN ===');
  console.log('Gasolineras disponibles:', this.gasolineras.length);
  console.log('Gasolineras filtradas:', this.gasolinerasFiltradas.length);
  
  // Crear un objeto con los datos relevantes
  const datos = {
    filtros: this.filters,
    ubicacion: this.ubicacionUsuario,
    empresasDisponibles: this.empresasDisponibles.slice(0, 10),
    ejemploGasolineras: this.gasolineras.slice(0, 5).map(g => ({
      rotulo: g.rotulo,
      horario: g.horario,
      precioGasolina95: g.precioGasolina95
    }))
  };
  
  console.log('Datos de depuración:', datos);
  
  // También guardar en window para acceder desde consola
  (window as any).depuracionGasolineras = {
    gasolineras: this.gasolineras,
    filtradas: this.gasolinerasFiltradas,
    filtros: this.filters
  };
  
  console.log('💡 Accede desde consola con: depuracionGasolineras');
  alert('Datos exportados a la consola. Usa "depuracionGasolineras" para acceder.');
}


  extraerEmpresasUnicas(): void {
    // Usar el normalizador para extraer empresas normalizadas
    const empresas = this.gasolineras
      .map((g) => {
        // Intentar normalizar el nombre de la empresa
        const empresaNormalizada = this.companyNormalizer.normalizeCompanyName(g.rotulo);
        return empresaNormalizada || g.rotulo; // Usar el normalizado o el nombre original
      })
      .filter((empresa, index, self) => empresa && self.indexOf(empresa) === index)
      .sort();
    
    this.empresasDisponibles = empresas;
    
    console.log(`📊 ${empresas.length} empresas únicas encontradas (normalizadas)`);
    console.log('Empresas disponibles:', empresas.slice(0, 20)); // Mostrar primeras 20
  }

  aplicarFilters(): void {
    if (!this.gasolineras.length) return;
    
    console.log('🔄 Aplicando filtros:', this.filters);
    
    this.gasolinerasFiltradas = this.gasolineraService.filtrarGasolineras(
      this.gasolineras,
      this.filters,
      this.ubicacionUsuario
    );
    
    console.log(`✅ ${this.gasolinerasFiltradas.length} gasolineras después de filtros`);
    
    // Aplicar ordenamiento local
    this.ordenarGasolineras();
    
    this.storageService.guardarFiltros(this.filters);
  }

  ordenarGasolineras(): void {
    if (this.filters.sortBy === 'distance') {
      this.gasolinerasFiltradas.sort((a, b) => {
        const distA = this.gasolineraService.calcularDistancia(
          this.ubicacionUsuario.latitud,
          this.ubicacionUsuario.longitud,
          a.latitud,
          a.longitud
        );
        const distB = this.gasolineraService.calcularDistancia(
          this.ubicacionUsuario.latitud,
          this.ubicacionUsuario.longitud,
          b.latitud,
          b.longitud
        );
        return distA - distB;
      });
    } else if (this.filters.sortBy === 'price') {
      this.gasolinerasFiltradas.sort((a, b) => {
        const precioA = this.obtenerPrecioRelevante(a);
        const precioB = this.obtenerPrecioRelevante(b);
        
        // Manejar precios no disponibles (0)
        if (precioA === 0 && precioB === 0) return 0;
        if (precioA === 0) return 1;
        if (precioB === 0) return -1;
        
        return precioA - precioB;
      });
    }
  }

  obtenerPrecioRelevante(gasolinera: Gasolinera): number {
    if (this.filters.fuelType === 'all') {
      // Para "todos los combustibles", devolver el precio más bajo disponible
      const preciosDisponibles = [];
      
      if (gasolinera.precioGasolina95 > 0) preciosDisponibles.push(gasolinera.precioGasolina95);
      if (gasolinera.precioGasolina98 > 0) preciosDisponibles.push(gasolinera.precioGasolina98);
      if (gasolinera.precioDiesel > 0) preciosDisponibles.push(gasolinera.precioDiesel);
      if (gasolinera.precioDieselPremium > 0) preciosDisponibles.push(gasolinera.precioDieselPremium);
      if (gasolinera.precioGLP > 0) preciosDisponibles.push(gasolinera.precioGLP);
      
      if (preciosDisponibles.length === 0) return 0;
      
      return Math.min(...preciosDisponibles);
    }
    
    // Para un tipo específico de combustible
    switch (this.filters.fuelType) {
      case 'Gasolina 95 E5': 
        return gasolinera.precioGasolina95;
      case 'Gasolina 98 E5': 
        return gasolinera.precioGasolina98;
      case 'Gasóleo A': 
        return gasolinera.precioDiesel;
      case 'Gasóleo Premium': 
        return gasolinera.precioDieselPremium;
      case 'GLP': 
        return gasolinera.precioGLP;
      default: 
        return 0;
    }
  }

  onFiltersCambiados(nuevosFilters: Filters): void {
    this.filters = nuevosFilters;
    this.aplicarFilters();
  }

  onUbicacionCambiada(nuevaUbicacion: Ubicacion): void {
    this.ubicacionUsuario = nuevaUbicacion;
    this.storageService.guardarUbicacion(nuevaUbicacion);
    this.aplicarFilters();
  }

  onGasolineraSeleccionada(gasolinera: Gasolinera): void {
    this.gasolineraSeleccionada = gasolinera;
  }

  toggleModoSeleccionado(modo: 'buscar' | 'ruta'): void {
    this.modoSeleccionado = modo;
    if (modo === 'ruta') {
      this.destino = { calle: '', numero: '', ciudad: '', provincia: '' };
    }
  }

  onModoCambiado(): void {
    this.toggleModoSeleccionado(this.modoSeleccionado);
  }

  restablecerFiltros(): void {
    this.filters = {
      fuelType: 'all',
      companies: [],
      maxPrice: 0,
      maxDistance: 50,
      onlyOpen: false,
      sortBy: 'distance',
      companyMode: 'include'
    };
    this.aplicarFilters();
  }

getUbicacionFormateada(): string {
  if (this.ubicacionUsuario.ciudad && this.ubicacionUsuario.provincia) {
    return `${this.ubicacionUsuario.ciudad}, ${this.ubicacionUsuario.provincia}`;
  } else if (this.ubicacionUsuario.ciudad) {
    return this.ubicacionUsuario.ciudad;
  } else {
    return 'Ubicación no especificada';
  }
}

getRadioBusqueda(): number {
  return this.filters.maxDistance;
}

}