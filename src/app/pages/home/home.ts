import { Component, OnInit, OnDestroy, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GasolineraService } from '../../services/api/gasolinera';
import { GeolocationService } from '../../services/geolocation';
import { StorageService } from '../../services/storage';
import { CompanyNormalizerService } from '../../services/company-normalizer';
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
    SummaryBoxComponent,
    StationList,
  ],
  templateUrl: './home.html',
  styleUrls: ['./home.scss'],
})
export class Home implements OnInit, OnDestroy, AfterViewChecked {
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
    fuelType: 'Gasolina 95 E5',
    companies: [],
    maxPrice: 0,
    maxDistance: 50,
    onlyOpen: false,
    sortBy: 'distance',
    companyMode: 'include'
  };

  cargando = false;
  busquedaEnCurso = false;
  mostrarResultados = false;
  error: string | null = null;
  empresasDisponibles: string[] = [];
  mostrarBotonScrollTop: boolean = false;

  acordeonAbierto = {
    modo: false,
    inicio: false,
    destino: false,
    filtros: false,
    resultados: false,
    detalles: false,
    depuracion: false
  };

  // Variable para guardar los filtros mientras el usuario los modifica
  filtersTemporales: Filters = { ...this.filters };

  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;

  constructor(
    private gasolineraService: GasolineraService,
    private geolocationService: GeolocationService,
    private storageService: StorageService,
    private companyNormalizer: CompanyNormalizerService
  ) {}

  ngOnInit(): void {
    const savedLocation = this.storageService.obtenerUbicacion();
    if (savedLocation) {
      this.ubicacionUsuario = savedLocation;
    }

    const savedFilters = this.storageService.obtenerFiltros();
    if (savedFilters) {
      this.filtersTemporales = savedFilters;
      this.filters = { ...savedFilters };
    }

    if (!this.filters.companyMode) {
      this.filters.companyMode = 'include';
      this.filtersTemporales.companyMode = 'include';
    }

    this.cargarGasolineras();
    
    // Configurar observadores para detectar cambios en el DOM
    this.setupObservers();
    
    // Verificar inicialmente
    setTimeout(() => this.checkScrollNeeded(), 100);
  }

  ngAfterViewChecked(): void {
    // Verificar después de cada cambio en la vista
    setTimeout(() => this.checkScrollNeeded(), 50);
  }

  // Configurar observadores para detectar cambios
  private setupObservers(): void {
    // Observer para cambios de tamaño
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.checkScrollNeeded();
      });
      
      const homeContainer = document.querySelector('.home-container');
      if (homeContainer) {
        this.resizeObserver.observe(homeContainer);
      }
      
      // Observar también el body para cambios generales
      this.resizeObserver.observe(document.body);
    }
    
    // Observer para cambios en el DOM (acordeones que se abren/cierran)
    this.mutationObserver = new MutationObserver(() => {
      this.checkScrollNeeded();
    });
    
    const homeContainer = document.querySelector('.home-container');
    if (homeContainer) {
      this.mutationObserver.observe(homeContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }
    
    // También escuchar eventos de scroll y resize
    window.addEventListener('resize', () => this.checkScrollNeeded());
    window.addEventListener('scroll', () => this.checkScrollNeeded());
  }

  // Verificar si se necesita el botón de scroll
  checkScrollNeeded(): void {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    
    // Mostrar el botón SIEMPRE que la altura del documento sea mayor que la altura de la ventana
    // Agregamos un pequeño margen (50px) para evitar falsos positivos
    const tieneScrollPosible = documentHeight > windowHeight + 50;
    
    this.mostrarBotonScrollTop = tieneScrollPosible;
  }

  // Hacer scroll al inicio de la página
  scrollToTop(): void {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  ngOnDestroy(): void {
    // Limpiar observadores y event listeners
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }
    
    window.removeEventListener('resize', () => this.checkScrollNeeded());
    window.removeEventListener('scroll', () => this.checkScrollNeeded());
  }

  // ✅ Cambia el modo desde los botones
  setModo(modo: 'buscar' | 'ruta'): void {
    if (this.modoSeleccionado === modo) return;

    this.modoSeleccionado = modo;

    // Si cambia a ruta, reinicia destino
    if (modo === 'ruta') {
      this.destino = { calle: '', numero: '', ciudad: '', provincia: '' };
    }

    // Si vuelve a buscar, opcionalmente podrías cerrar destino
    if (modo === 'buscar') {
      this.acordeonAbierto.destino = false;
    }
    
    // Verificar scroll después de cambiar modo
    setTimeout(() => this.checkScrollNeeded(), 100);
  }

  toggleAcordeon(seccion: keyof typeof this.acordeonAbierto): void {
    this.acordeonAbierto[seccion] = !this.acordeonAbierto[seccion];
    
    // Después de abrir/cerrar un acordeón, verificar scroll
    setTimeout(() => this.checkScrollNeeded(), 350); // 350ms para dar tiempo a la animación
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
      })
      .catch((error) => {
        alert(`Error obteniendo ubicación: ${error.message}`);
      });
  }

  // ✅ BOTÓN DE BÚSQUEDA PRINCIPAL - 
  ejecutarBusqueda(): void {
    // Validar datos básicos
    if (!this.ubicacionUsuario.ciudad && !this.ubicacionUsuario.calle) {
      alert('Por favor, ingresa una ubicación de inicio');
      return;
    }
    
    if (this.modoSeleccionado === 'ruta' && !this.destino.ciudad && !this.destino.calle) {
      alert('En modo ruta, ingresa una ubicación de destino');
      return;
    }
    
    if (this.gasolineras.length === 0) {
      alert('No hay gasolineras disponibles. Intenta recargar la página.');
      return;
    }

    // Iniciar búsqueda
    this.busquedaEnCurso = true;
    this.error = null;
    
    // Aplicar los filtros temporales a los filtros reales
    this.filters = { ...this.filtersTemporales };
    
    // Aplicar filtros con los datos actuales
    this.aplicarFilters();
    
    // Marcar que se ha hecho una búsqueda
    this.mostrarResultados = true;
    
    // Abrir el acordeón de resultados si hay resultados
    if (this.gasolinerasFiltradas.length > 0) {
      this.acordeonAbierto.resultados = true;
      
      // Scroll suave a la sección de resultados después de un breve delay
      setTimeout(() => {
        const elementoResultados = document.getElementById('resultados-container');
        if (elementoResultados) {
          elementoResultados.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
      }, 300);
    }
    
    // Finalizar carga
    this.busquedaEnCurso = false;
    
    // Guardar filtros
    this.storageService.guardarFiltros(this.filters);
    
    // Después de la búsqueda, verificar scroll
    setTimeout(() => this.checkScrollNeeded(), 500);
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
        // NO aplicar filtros automáticamente aquí
        this.cargando = false;
        
        // Después de cargar gasolineras, verificar scroll
        setTimeout(() => this.checkScrollNeeded(), 300);
      },
      error: () => {
        this.error = 'Error al cargar gasolineras. La API podría no estar disponible.';
        this.cargando = false;
      },
    });
  }

  extraerEmpresasUnicas(): void {
    const empresas = this.gasolineras
      .map((g) => {
        const empresaNormalizada = this.companyNormalizer.normalizeCompanyName(g.rotulo);
        return empresaNormalizada || g.rotulo;
      })
      .filter((empresa, index, self) => empresa && self.indexOf(empresa) === index)
      .sort();

    this.empresasDisponibles = empresas;
  }

  aplicarFilters(): void {
    if (!this.gasolineras.length) return;

    // Aplicar filtros a las gasolineras
    this.gasolinerasFiltradas = this.gasolineraService.filtrarGasolineras(
      this.gasolineras,
      this.filters,
      this.ubicacionUsuario
    );

    // Ordenar según el criterio seleccionado
    this.ordenarGasolineras();
    
    // Verificar scroll después de aplicar filtros
    setTimeout(() => this.checkScrollNeeded(), 100);
  }

  ordenarGasolineras(): void {
    // Calcular distancias para todas las gasolineras filtradas
    this.gasolinerasFiltradas.forEach(gasolinera => {
      gasolinera.distanceKm = this.gasolineraService.calcularDistancia(
        this.ubicacionUsuario.latitud,
        this.ubicacionUsuario.longitud,
        gasolinera.latitud,
        gasolinera.longitud
      );
    });

    // Ordenar según el criterio seleccionado
    if (this.filters.sortBy === 'distance') {
      this.gasolinerasFiltradas.sort((a, b) => (a.distanceKm || 999) - (b.distanceKm || 999));
    } else if (this.filters.sortBy === 'price') {
      this.gasolinerasFiltradas.sort((a, b) => {
        const precioA = this.obtenerPrecioRelevante(a);
        const precioB = this.obtenerPrecioRelevante(b);

        if (precioA === 0 && precioB === 0) return 0;
        if (precioA === 0) return 1;
        if (precioB === 0) return -1;

        return precioA - precioB;
      });
    }
  }

  obtenerPrecioRelevante(gasolinera: Gasolinera): number {
    switch (this.filters.fuelType) {
      case 'Gasolina 95 E5': return gasolinera.precioGasolina95;
      case 'Gasolina 98 E5': return gasolinera.precioGasolina98;
      case 'Gasóleo A': return gasolinera.precioDiesel;
      case 'Gasóleo Premium': return gasolinera.precioDieselPremium;
      case 'GLP': return gasolinera.precioGLP;
      default: return gasolinera.precioGasolina95;
    }
  }

  // Cuando el usuario modifica los filtros, solo se guardan temporalmente
  onFiltersCambiados(nuevosFilters: Filters): void {
    this.filtersTemporales = nuevosFilters;
    // NO aplicar filtros aquí, solo se aplicarán cuando el usuario pulse "Buscar"
  }

  onGasolineraSeleccionada(gasolinera: Gasolinera): void {
    this.gasolineraSeleccionada = gasolinera;
    this.acordeonAbierto.detalles = true;
    setTimeout(() => this.checkScrollNeeded(), 100);
  }

  restablecerTodo(): void {
    // Cerrar todos los acordeones
    Object.keys(this.acordeonAbierto).forEach(key => {
      this.acordeonAbierto[key as keyof typeof this.acordeonAbierto] = false;
    });

    // Restablecer filtros (tanto los reales como los temporales)
    this.filters = {
      fuelType: 'Gasolina 95 E5',
      companies: [],
      maxPrice: 0,
      maxDistance: 50,
      onlyOpen: false,
      sortBy: 'distance',
      companyMode: 'include'
    };
    
    this.filtersTemporales = { ...this.filters };

    // Restablecer ubicación
    this.ubicacionUsuario = {
      latitud: 0,
      longitud: 0,
      calle: '',
      numero: '',
      ciudad: '',
      provincia: '',
      direccionCompleta: ''
    };

    // Restablecer modo
    this.setModo('buscar');

    // Restablecer destino
    this.destino = { calle: '', numero: '', ciudad: '', provincia: '' };
    
    // Limpiar resultados
    this.gasolineraSeleccionada = null;
    this.error = null;
    this.mostrarResultados = false;
    this.gasolinerasFiltradas = [];

    // Guardar en storage
    this.storageService.guardarUbicacion(this.ubicacionUsuario);
    this.storageService.guardarFiltros(this.filters);
    
    // Recargar gasolineras
    this.cargarGasolineras();
  }

  restablecerFiltros(): void {
    // Restablecer filtros temporales
    this.filtersTemporales = {
      fuelType: 'Gasolina 95 E5',
      companies: [],
      maxPrice: 0,
      maxDistance: 50,
      onlyOpen: false,
      sortBy: 'distance',
      companyMode: 'include'
    };
    
    // Si ya había resultados, también restablecer los filtros reales
    if (this.mostrarResultados) {
      this.filters = { ...this.filtersTemporales };
      this.aplicarFilters();
      this.storageService.guardarFiltros(this.filters);
    }
  }
}