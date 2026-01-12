// src/app/pages/home/home.ts
import { Component, OnInit, OnDestroy, AfterViewChecked, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

import { GasolineraService } from '../../services/api/gasolinera';
import { GeolocationService } from '../../services/geolocation';
import { StorageService } from '../../services/storage';
import { CompanyNormalizerService } from '../../services/company-normalizer';

import { Gasolinera, CandidateRouteInfo } from '../../models/station';
import { Filters, FuelType } from '../../models/filter';
import { FiltersComponent } from '../../components/filters/filters';
import { SummaryBoxComponent } from '../../components/summary-box/summary-box';
import { Ubicacion } from '../../models/location';
import { StationList } from '../../components/station-list/station-list';

import { haversineKm } from '../../utils/haversine';

// ===========================
// 🧪 DEBUG INTERFACES
// ===========================

interface DebugRutaInput {
  modo: string;
  filters: Filters | null;
  autonomia: {
    kmDisponibles: number;
    reservaMinKm: number;
    kmUsables: number;
    consumoFijoL100: number;
  };
  origenRaw: Ubicacion | null;
  destinoRaw: Ubicacion | null;
  origenResolved: LatLng | null;
  destinoResolved: LatLng | null;
  geocodeProvider: string;
}

interface DebugRutaBaseRoute {
  distBaseKm: number;
  durBaseSec: number;
  pointsCount: number;
  sampleFirstLast: { first: LatLng; last: LatLng } | null;
  polylinePresent: boolean;
}

interface DebugRutaDataset {
  totalStations: number;
  afterDatasetFilters: number;
  radioKm: number;

  // ✅ NUEVO: métricas claras para no confundir
  corridorCandidatesTotal: number;        // antes de aplicar autonomía
  corridorCandidatesEnAutonomia: number;  // después de aplicar autonomía (los que pasan a preRank)

  N: number;
  preRankTop: Array<{ rotulo: string; minDistRuta: number; precio: number }>;
  topN: Array<{ rotulo: string; minDistRuta: number; precio: number }>;
}

interface DebugRutaGoogleCalls {
  concurrency: number;
  requested: number;
  finished: number;
  failed: number;
  discardedByAutonomy: number;
  errors: Array<{ rotulo: string; msg: string }>;
}

interface DebugRutaEnriched {
  resultsCount: number;
  results: Array<any>;
}

interface DebugRutaFinal {
  sortedCount: number;
  top3: Array<any>;
}

interface DebugRutaUi {
  busquedaEnCurso: boolean;
  mostrarResultados: boolean;
  error: string | null;
}

interface DebugRutaType {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number;
  input: DebugRutaInput;
  baseRoute: DebugRutaBaseRoute;
  dataset: DebugRutaDataset;
  googleCalls: DebugRutaGoogleCalls;
  enriched: DebugRutaEnriched;
  final: DebugRutaFinal;
  ui: DebugRutaUi;
}

// ✅ Tipos auxiliares para modo ruta
type LatLng = { lat: number; lng: number };

type RouteBaseInfo = {
  distBaseKm: number;
  durBaseSec: number;
  polyline: string;
  points: LatLng[];
};

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, FiltersComponent, SummaryBoxComponent],
  templateUrl: './home.html',
  styleUrls: ['./home.scss'],
})
export class Home implements OnInit, OnDestroy, AfterViewChecked {
  // ---------------------------
  // DATA
  // ---------------------------
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
    direccionCompleta: '',
  };

  destino: Ubicacion = {
    latitud: 0,
    longitud: 0,
    calle: '',
    numero: '',
    ciudad: '',
    provincia: '',
    direccionCompleta: '',
  };

  // ✅ Autonomía (km) y reserva (km)
  kmDisponiblesUsuario: number = 0;
  readonly reservaMinKm = 15;
  readonly consumoFijoL100 = 6.0;

  // ✅ Google (opcional). Si no pones key, usa fallback Nominatim para geocoding.
  googleApiKey: string = '';

  filters: Filters = {
    fuelType: 'Gasolina 95 E5',
    companies: [],
    maxPrice: 0,
    maxDistance: 50,
    onlyOpen: false,
    sortBy: 'distance',
    companyMode: 'include',
  };

  cargando = false;
  busquedaEnCurso = false;
  mostrarResultados = false;
  error: string | null = null;
  empresasDisponibles: string[] = [];
  mostrarBotonScrollTop = false;

  acordeonAbierto = {
    modo: false,
    inicio: false,
    destino: false,
    filtros: false,
    resultados: false,
    detalles: false,
    depuracion: false,
  };

  // Variable para guardar los filtros mientras el usuario los modifica
  filtersTemporales: Filters = { ...this.filters };

  // Observers / listeners
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private onWinResize = () => this.checkScrollNeeded();
  private onWinScroll = () => this.checkScrollNeeded();

  constructor(
    private cd: ChangeDetectorRef, // ✅ AÑADIDO: ChangeDetectorRef
    private gasolineraService: GasolineraService,
    private geolocationService: GeolocationService,
    private storageService: StorageService,
    private companyNormalizer: CompanyNormalizerService,
    private http: HttpClient
  ) {}

  // ===========================
  // 🧪 DEBUG / DEPURACIÓN RUTA
  // ===========================
  DEBUG_UI = true;

  // Control de secciones expandidas del debug panel
  debugSections = {
    inputs: true,
    route: true,
    dataset: true,
    googleCalls: false,
    enriched: false,
    final: false,
    ui: false,
  };

  debugRuta: DebugRutaType = {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    elapsedMs: 0,

    input: {
      modo: '',
      filters: null,
      autonomia: { kmDisponibles: 0, reservaMinKm: 0, kmUsables: 0, consumoFijoL100: 0 },
      origenRaw: null,
      destinoRaw: null,
      origenResolved: null,
      destinoResolved: null,
      geocodeProvider: '',
    },

    baseRoute: {
      distBaseKm: 0,
      durBaseSec: 0,
      pointsCount: 0,
      sampleFirstLast: null,
      polylinePresent: false,
    },

    dataset: {
      totalStations: this.gasolineras.length,
      afterDatasetFilters: 0,
      radioKm: 0,

        // ✅ NUEVO
      corridorCandidatesTotal: 0,
      corridorCandidatesEnAutonomia: 0,

      N: 0,
      preRankTop: [],
      topN: [],
    },

    googleCalls: {
      concurrency: 5,
      requested: 0,
      finished: 0,
      failed: 0,
      discardedByAutonomy: 0,
      errors: [],
    },

    enriched: {
      resultsCount: 0,
      results: [],
    },

    final: {
      sortedCount: 0,
      top3: [],
    },

    ui: {
      busquedaEnCurso: false,
      mostrarResultados: false,
      error: null,
    },
  };

// ✅ Método mejorado para actualizar debugRuta - SIN detectChanges() (evita NG0100)
private updateDebugRuta(updates: Partial<typeof this.debugRuta>): void {
  // 1) Copia profunda del estado actual (para no mutar)
  let current: any;
  try {
    current = JSON.parse(JSON.stringify(this.debugRuta));
  } catch {
    current = { ...this.debugRuta };
  }

  // 2) Merge profundo (objetos) sin mutar referencias
  const mergeDeep = (target: any, source: any): any => {
    if (source === null || source === undefined) return target;

    // si es primitivo o array -> reemplaza
    if (typeof source !== 'object' || Array.isArray(source)) return source;

    // target debe ser objeto
    if (typeof target !== 'object' || target === null || Array.isArray(target)) target = {};

    for (const key of Object.keys(source)) {
      const sVal = source[key];
      const tVal = target[key];

      // si es array -> reemplaza completo
      if (Array.isArray(sVal)) {
        target[key] = [...sVal];
        continue;
      }

      // si es objeto -> merge recursivo
      if (sVal && typeof sVal === 'object') {
        target[key] = mergeDeep(tVal, sVal);
        continue;
      }

      // primitivo
      target[key] = sVal;
    }

    return target;
  };

  const merged = mergeDeep(current, updates);

  // 3) Asignación INMUTABLE (nuevo objeto)
  this.debugRuta = { ...merged };

  // 4) Opcional: marca para check (útil si en el futuro pones OnPush)
  this.cd.markForCheck();
}

// ✅ Método ESPECÍFICO para actualizar dataset - SIN detectChanges() (evita NG0100)
private updateDebugDataset(updates: Partial<typeof this.debugRuta.dataset>): void {
  const newDataset = {
    ...this.debugRuta.dataset,
    ...updates,
  };

  this.debugRuta = {
    ...this.debugRuta,
    dataset: newDataset,
  };

  // Opcional
  this.cd.markForCheck();
}

// ✅ Reset debug - SIN detectChanges() (evita NG0100)
private debugReset(): void {
  const now = new Date();

  this.debugRuta = {
    status: 'running',
    startedAt: now.toISOString(),
    finishedAt: null,
    elapsedMs: 0,

    input: {
      modo: this.modoSeleccionado,
      filters: { ...this.filters },
      autonomia: {
        kmDisponibles: Number(this.kmDisponiblesUsuario),
        reservaMinKm: this.reservaMinKm,
        kmUsables: Number(this.kmDisponiblesUsuario) - this.reservaMinKm,
        consumoFijoL100: this.consumoFijoL100,
      },
      origenRaw: { ...this.ubicacionUsuario },
      destinoRaw: { ...this.destino },
      origenResolved: null,
      destinoResolved: null,
      geocodeProvider: this.googleApiKey ? 'google' : 'nominatim',
    },

    baseRoute: {
      distBaseKm: 0,
      durBaseSec: 0,
      pointsCount: 0,
      sampleFirstLast: null,
      polylinePresent: false,
    },

    dataset: {
  totalStations: this.gasolineras.length,
  afterDatasetFilters: 0,
  radioKm: 0,

  // ✅ NUEVO
  corridorCandidatesTotal: 0,
  corridorCandidatesEnAutonomia: 0,

  N: 0,
  preRankTop: [],
  topN: [],
},

    googleCalls: {
      concurrency: 5,
      requested: 0,
      finished: 0,
      failed: 0,
      discardedByAutonomy: 0,
      errors: [],
    },

    enriched: {
      resultsCount: 0,
      results: [],
    },

    final: {
      sortedCount: 0,
      top3: [],
    },

    ui: {
      busquedaEnCurso: this.busquedaEnCurso,
      mostrarResultados: this.mostrarResultados,
      error: this.error,
    },
  };

  this.cd.markForCheck();
}


  private debugFinish(ok: boolean): void {
    const end = new Date();

    this.updateDebugRuta({
      finishedAt: end.toISOString(),
      elapsedMs: this.debugRuta.startedAt ? end.getTime() - new Date(this.debugRuta.startedAt).getTime() : 0,
      status: ok ? 'done' : 'error',
      ui: {
        busquedaEnCurso: this.busquedaEnCurso,
        mostrarResultados: this.mostrarResultados,
        error: this.error,
      },
    });
  }

  formatAddressForUi(g: any): string {
    const parts = [g?.direccion || g?.direccionCompleta, g?.municipio, g?.provincia].filter(Boolean);
    if (parts.length) return parts.join(', ');
    const parts2 = [g?.calle, g?.numero, g?.ciudad, g?.provincia].filter(Boolean);
    return parts2.join(', ');
  }

  // ---------------------------
  // LIFECYCLE
  // ---------------------------
  ngOnInit(): void {
    const savedLocation = this.storageService.obtenerUbicacion();
    if (savedLocation) this.ubicacionUsuario = savedLocation;

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

    this.setupObservers();
    setTimeout(() => this.checkScrollNeeded(), 100);

    const gifElement = document.querySelector('.gif-coche img') as HTMLImageElement;
    if (gifElement) {
      gifElement.style.animation = 'rotar 3s ease-out 1';
    }

    // Si DEBUG_UI está activo, añadir intervalo para actualizar tiempo
    if (this.DEBUG_UI) {
     setInterval(() => {
    if (this.debugRuta.status === 'running' && this.debugRuta.startedAt) {
      const now = new Date();
      const elapsed = now.getTime() - new Date(this.debugRuta.startedAt).getTime();
      this.updateDebugRuta({ elapsedMs: elapsed });
      }
     }, 100);
    }
  }

  ngAfterViewChecked(): void {
    setTimeout(() => this.checkScrollNeeded(), 50);
  }

  ngOnDestroy(): void {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.mutationObserver) this.mutationObserver.disconnect();

    window.removeEventListener('resize', this.onWinResize);
    window.removeEventListener('scroll', this.onWinScroll);
  }

  // ---------------------------
  // UI / ACCORDEON
  // ---------------------------
  setModo(modo: 'buscar' | 'ruta'): void {
    if (this.modoSeleccionado === modo) return;

    this.modoSeleccionado = modo;

    if (modo === 'ruta') {
      this.destino = {
        latitud: 0,
        longitud: 0,
        calle: '',
        numero: '',
        ciudad: '',
        provincia: '',
        direccionCompleta: '',
      };
    } else {
      this.acordeonAbierto.destino = false;
    }

    setTimeout(() => this.checkScrollNeeded(), 100);
  }

  toggleAcordeon(seccion: keyof typeof this.acordeonAbierto): void {
    this.acordeonAbierto[seccion] = !this.acordeonAbierto[seccion];
    setTimeout(() => this.checkScrollNeeded(), 350);
  }

  // Añade este método nuevo para el debug panel
  toggleDebugSection(section: keyof typeof this.debugSections): void {
    this.debugSections[section] = !this.debugSections[section];
  }

  private setupObservers(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.checkScrollNeeded());

      const homeContainer = document.querySelector('.home-container');
      if (homeContainer) this.resizeObserver.observe(homeContainer);

      this.resizeObserver.observe(document.body);
    }

    this.mutationObserver = new MutationObserver(() => this.checkScrollNeeded());

    const homeContainer = document.querySelector('.home-container');
    if (homeContainer) {
      this.mutationObserver.observe(homeContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }

    window.addEventListener('resize', this.onWinResize);
    window.addEventListener('scroll', this.onWinScroll);
  }

  checkScrollNeeded(): void {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    this.mostrarBotonScrollTop = documentHeight > windowHeight + 50;
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------------------
  // LOCATION
  // ---------------------------
  obtenerUbicacion(): void {
    this.geolocationService
      .getCurrentLocation()
      .then((nuevaUbicacion) => {
        this.ubicacionUsuario = {
          latitud: nuevaUbicacion.latitud,
          longitud: nuevaUbicacion.longitud,
          calle: nuevaUbicacion.calle || '',
          numero: nuevaUbicacion.numero || '',
          ciudad: nuevaUbicacion.ciudad || 'Ubicación actual',
          provincia: nuevaUbicacion.provincia || '',
          direccionCompleta: nuevaUbicacion.direccionCompleta || '',
        };

        this.storageService.guardarUbicacion(this.ubicacionUsuario);
      })
      .catch((error) => {
        alert(`Error obteniendo ubicación: ${error.message}`);
      });
  }

  // ---------------------------
  // SEARCH ENTRYPOINT
  // ---------------------------
  async ejecutarBusqueda(): Promise<void> {
    if (!this.ubicacionUsuario.ciudad && !this.ubicacionUsuario.calle) {
      alert('Por favor, ingresa una ubicación de inicio');
      return;
    }

    if (this.modoSeleccionado === 'ruta' && !this.destino.ciudad && !this.destino.calle) {
      alert('En modo ruta, ingresa una ubicación de destino');
      return;
    }

    // ✅ VERIFICACIÓN CRÍTICA: asegurar que tenemos gasolineras cargadas
    if (this.gasolineras.length === 0) {
      this.error = 'Cargando gasolineras...';
      this.busquedaEnCurso = true;

      // Esperar a que se carguen las gasolineras
      try {
        await new Promise<void>((resolve, reject) => {
          if (this.gasolineras.length > 0) {
            resolve();
          } else {
            // Crear un observador para esperar la carga
            let attempts = 0;
            const maxAttempts = 100; // 100 * 100ms = 10 segundos

            const checkInterval = setInterval(() => {
              attempts++;
              if (this.gasolineras.length > 0) {
                console.log(`✅ Gasolineras cargadas después de ${attempts} intentos: ${this.gasolineras.length}`);
                clearInterval(checkInterval);
                resolve();
              } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                reject(new Error('No se pudieron cargar las gasolineras después de 10 segundos'));
              }
            }, 100);
          }
        });

        this.error = null; // Limpiar mensaje de error si tuvo éxito
      } catch (e: any) {
        this.error = e?.message ?? 'Error al cargar las gasolineras. Intenta recargar la página.';
        this.busquedaEnCurso = false;
        return;
      }
    }

    this.busquedaEnCurso = true;
    this.error = null;
    this.filters = { ...this.filtersTemporales };

    try {
      if (this.modoSeleccionado === 'buscar') {
        this.ejecutarBusquedaLocal();
      } else {
        await this.ejecutarBusquedaEnRuta();
      }

      this.mostrarResultados = true;

      if (this.gasolinerasFiltradas.length > 0) {
        this.acordeonAbierto.resultados = true;
        setTimeout(() => {
          const elementoResultados = document.getElementById('resultados-container');
          if (elementoResultados) {
            elementoResultados.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 300);
      }

      this.storageService.guardarFiltros(this.filters);
      setTimeout(() => this.checkScrollNeeded(), 500);
    } catch (e: any) {
      this.error = e?.message ?? 'Error en la búsqueda.';
    } finally {
      this.busquedaEnCurso = false;
    }
  }

  private ejecutarBusquedaLocal(): void {
    this.aplicarFilters();
  }

  // ---------------------------
  // LOAD STATIONS
  // ---------------------------
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
        this.cargando = false;

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
      .map((g) => this.companyNormalizer.normalizeCompanyName(g.rotulo) || g.rotulo)
      .filter((empresa, index, self) => empresa && self.indexOf(empresa) === index)
      .sort();

    this.empresasDisponibles = empresas;
  }

  // ---------------------------
  // FILTERS (local / modo buscar)
  // ---------------------------
  aplicarFilters(): void {
    if (!this.gasolineras.length) return;

    // ✅ parte de todo el dataset
    this.gasolinerasFiltradas = [...this.gasolineras];

    // ✅ autonomía en modo buscar: si es 0 => ilimitado (no filtra)
    if (this.kmDisponiblesUsuario > 0) {
      this.gasolinerasFiltradas = this.gasolinerasFiltradas.filter((gasolinera) => {
        const distanciaKm = this.gasolineraService.calcularDistancia(
          this.ubicacionUsuario.latitud,
          this.ubicacionUsuario.longitud,
          gasolinera.latitud,
          gasolinera.longitud
        );
        return distanciaKm <= this.kmDisponiblesUsuario;
      });
    }

    this.ordenarGasolineras();
    setTimeout(() => this.checkScrollNeeded(), 100);
  }

  // ✅ FIX: aquí antes estaba roto (g.distanceKm = length)
  ordenarGasolineras(): void {
    // ✅ Calcula distancia REAL desde la ubicación actual (solo modo buscar)
    this.gasolinerasFiltradas.forEach((g) => {
      g.distanceKm = this.gasolineraService.calcularDistancia(
        this.ubicacionUsuario.latitud,
        this.ubicacionUsuario.longitud,
        g.latitud,
        g.longitud
      );
    });

    if (this.filters.sortBy === 'distance') {
      this.gasolinerasFiltradas.sort((a, b) => (a.distanceKm ?? 999999) - (b.distanceKm ?? 999999));
      return;
    }

    if (this.filters.sortBy === 'price') {
      this.gasolinerasFiltradas.sort((a, b) => {
        const precioA = this.obtenerPrecioRelevante(a);
        const precioB = this.obtenerPrecioRelevante(b);

        if (precioA === 0 && precioB === 0) return 0;
        if (precioA === 0) return 1;
        if (precioB === 0) return -1;

        const diff = precioA - precioB;
        if (diff !== 0) return diff;

        return (a.distanceKm ?? 999999) - (b.distanceKm ?? 999999);
      });
    }
  }

  obtenerPrecioRelevante(g: Gasolinera): number {
    switch (this.filters.fuelType) {
      case 'Gasolina 95 E5':
        return g.precioGasolina95;
      case 'Gasolina 98 E5':
        return g.precioGasolina98;
      case 'Gasóleo A':
        return g.precioDiesel;
      case 'Gasóleo Premium':
        return g.precioDieselPremium;
      case 'GLP':
        return g.precioGLP;
      default:
        return g.precioGasolina95;
    }
  }

  onFiltersCambiados(nuevosFilters: Filters): void {
    this.filtersTemporales = nuevosFilters;
  }

  onGasolineraSeleccionada(g: Gasolinera): void {
    this.gasolineraSeleccionada = g;
    this.acordeonAbierto.detalles = true;
    setTimeout(() => this.checkScrollNeeded(), 100);
  }

  // ---------------------------
  // RESET
  // ---------------------------
  restablecerTodo(): void {
    Object.keys(this.acordeonAbierto).forEach((key) => {
      this.acordeonAbierto[key as keyof typeof this.acordeonAbierto] = false;
    });

    this.filters = {
      fuelType: 'Gasolina 95 E5',
      companies: [],
      maxPrice: 0,
      maxDistance: 50,
      onlyOpen: false,
      sortBy: 'distance',
      companyMode: 'include',
    };
    this.filtersTemporales = { ...this.filters };

    this.ubicacionUsuario = {
      latitud: 0,
      longitud: 0,
      calle: '',
      numero: '',
      ciudad: '',
      provincia: '',
      direccionCompleta: '',
    };

    this.setModo('buscar');

    this.destino = {
      latitud: 0,
      longitud: 0,
      calle: '',
      numero: '',
      ciudad: '',
      provincia: '',
      direccionCompleta: '',
    };

    this.kmDisponiblesUsuario = 0;

    this.gasolineraSeleccionada = null;
    this.error = null;
    this.mostrarResultados = false;
    this.gasolinerasFiltradas = [];

    this.storageService.guardarUbicacion(this.ubicacionUsuario);
    this.storageService.guardarFiltros(this.filters);

    this.cargarGasolineras();
  }

  restablecerFiltros(): void {
    this.filtersTemporales = {
      fuelType: 'Gasolina 95 E5',
      companies: [],
      maxPrice: 0,
      maxDistance: 50,
      onlyOpen: false,
      sortBy: 'distance',
      companyMode: 'include',
    };

    if (this.mostrarResultados && this.modoSeleccionado === 'buscar') {
      this.filters = { ...this.filtersTemporales };
      this.aplicarFilters();
      this.storageService.guardarFiltros(this.filters);
    }
  }

  // =========================================================
  // ✅ MODO RUTA (CUBOS + AUTONOMÍA ANTES DEL DESVÍO REAL)
  // =========================================================
  // Opción 1: la autonomía valida SOLO “llegar desde el origen a la gasolinera”.
  // Si autonomía es 0 => ilimitada (recorre toda la ruta).
  private async ejecutarBusquedaEnRuta(): Promise<void> {
    this.debugReset();

    let ok = false;

    // ✅ muestras descartadas por autonomía (leg1)
    let discardsAutonomy = 0;
    const discardSamples: Array<{ rotulo: string; leg1Km: number; kmUsables: number }> = [];

    try {
      // ✅ VERIFICACIÓN CRÍTICA: asegurar que tenemos datos
      if (!this.gasolineras || this.gasolineras.length === 0) {
        throw new Error('No hay gasolineras cargadas. Por favor, intenta de nuevo.');
      }

      // ✅ Total stations al inicio
      this.updateDebugDataset({ totalStations: this.gasolineras.length } as any);

      // ✅ Autonomía (si está vacía o <=0 => ILIMITADA)
      const kmDisponibles = Number(this.kmDisponiblesUsuario);
      const autonomiaIlimitada = !Number.isFinite(kmDisponibles) || kmDisponibles <= 0;

      const kmUsables = autonomiaIlimitada ? Number.POSITIVE_INFINITY : kmDisponibles - this.reservaMinKm;

      if (!autonomiaIlimitada && (!Number.isFinite(kmUsables) || kmUsables <= 0)) {
        throw new Error(
          `Autonomía insuficiente: reserva mínima ${this.reservaMinKm} km. Ingresa una autonomía mayor a ${this.reservaMinKm} km.`
        );
      }

      // ✅ reflejar autonomía real en debug
      this.updateDebugRuta({
        input: {
          ...this.debugRuta.input,
          modo: this.modoSeleccionado,
          filters: { ...this.filters },
          autonomia: {
            kmDisponibles: autonomiaIlimitada ? 0 : kmDisponibles,
            reservaMinKm: this.reservaMinKm,
            kmUsables: autonomiaIlimitada ? 0 : kmUsables,
            consumoFijoL100: this.consumoFijoL100,
          },
          origenRaw: { ...this.ubicacionUsuario },
          destinoRaw: { ...this.destino },
          geocodeProvider: this.googleApiKey ? 'google' : 'nominatim',
        },
      });

      // ✅ resolver coordenadas
      const origen = await this.resolveLatLngFromUbicacion(this.ubicacionUsuario);
      const destino = await this.resolveLatLngFromUbicacion(this.destino);

      this.updateDebugRuta({
        input: {
          ...this.debugRuta.input,
          origenResolved: origen,
          destinoResolved: destino,
          geocodeProvider: this.googleApiKey ? 'google' : 'nominatim',
        },
      });

      // ✅ ruta base
      const base = await this.getRouteBase(origen, destino);

      this.updateDebugRuta({
        baseRoute: {
          distBaseKm: base.distBaseKm,
          durBaseSec: base.durBaseSec,
          pointsCount: base.points?.length || 0,
          sampleFirstLast: base.points?.length ? { first: base.points[0], last: base.points[base.points.length - 1] } : null,
          polylinePresent: !!base.polyline,
        },
      });

      // ✅ filtro dataset (sin distancia circular)
      const filtradasPorDataset = this.filtrarDatasetSinDistanciaCircular(this.gasolineras, this.filters);
      const radioKm = this.filters.maxDistance;

      this.updateDebugDataset({
        afterDatasetFilters: filtradasPorDataset.length,
        radioKm: radioKm,
      });

      if (filtradasPorDataset.length === 0) {
        this.gasolinerasFiltradas = [];
        ok = true;
        return;
      }

      // ✅ corredor
      const candidatasCorredor = this.filtrarPorCorredorRuta(filtradasPorDataset, base.points, radioKm);

      // ✅ Debug: total en corredor (ANTES de autonomía)
      this.updateDebugDataset({
       corridorCandidatesTotal: candidatasCorredor.length,
      });

      // ✅ autonomía ANTES de nada caro (solo “leg1” aproximado = haversine origen->gas)
      let candidatasAutonomia = candidatasCorredor;
      if (!autonomiaIlimitada) {
        candidatasAutonomia = candidatasCorredor.filter((g) => {
          const d = haversineKm(origen.lat, origen.lng, g.latitud, g.longitud);
          return d <= kmUsables;
        });
      }

      // ✅ Debug: en autonomía (DESPUÉS de autonomía)
      this.updateDebugDataset({
      corridorCandidatesEnAutonomia: candidatasAutonomia.length,
      });

      // ✅ pre-rank (asigna _minDistToRouteKm)
      const preRank = this.preRankCandidates(candidatasAutonomia, base.points, this.filters);

      // ✅ intervalKm dinámico + límite visible por autonomía
      const intervalKm = this.computeIntervalKm(base.distBaseKm, kmUsables, autonomiaIlimitada);
      const maxKmVisible = autonomiaIlimitada ? base.distBaseKm : Math.min(kmUsables, base.distBaseKm);

      // ✅ construir cubos (guardamos top 6 por cubo como “reservas”)
      type BucketItem = { g: Gasolinera; kmFromOrigin: number };
      const bucketMap = new Map<number, BucketItem[]>();

      for (const g of preRank) {
        const kmFromOrigin = this.estimateKmAlongSegment(origen, destino, { lat: g.latitud, lng: g.longitud });

        if (kmFromOrigin > maxKmVisible) continue;

        const bucket = Math.floor(kmFromOrigin / intervalKm);
        const arr = bucketMap.get(bucket) ?? [];
        arr.push({ g, kmFromOrigin });
        bucketMap.set(bucket, arr);
      }

      for (const [b, arr] of bucketMap.entries()) {
        arr.sort((x, y) => this.compareBySort(x.g, y.g, this.filters));
        bucketMap.set(b, arr.slice(0, 6)); // reservas por cubo
      }

      const bucketsSorted = Array.from(bucketMap.keys()).sort((a, b) => a - b);

      // ✅ Debug dataset: N = número de cubos (dinámico), topN = muestra de primeras reservas
      const firstBucketPreview = bucketsSorted.length ? bucketMap.get(bucketsSorted[0]) ?? [] : [];
      
      this.updateDebugDataset({
  // ✅ ya se guardaron antes:
  // corridorCandidatesTotal
  // corridorCandidatesEnAutonomia

  N: bucketsSorted.length, // número de cubos
  preRankTop: preRank.slice(0, 10).map((g: any) => ({
    rotulo: g.rotulo,
    minDistRuta: (g as any)._minDistToRouteKm,
    precio: this.getPrecioLitroSegunFiltro(g, this.filters.fuelType),
  })),
  topN: firstBucketPreview.slice(0, 10).map((x: any) => ({
    rotulo: x.g.rotulo,
    minDistRuta: (x.g as any)._minDistToRouteKm,
    precio: this.getPrecioLitroSegunFiltro(x.g, this.filters.fuelType),
  })),
});


      // ✅ reset googleCalls/enriched/final
      this.updateDebugRuta({
        googleCalls: {
          ...this.debugRuta.googleCalls,
          concurrency: 1, // por cubo intentamos en serie para poder sustituir
          requested: 0,
          finished: 0,
          failed: 0,
          discardedByAutonomy: 0,
          errors: [],
        },
        enriched: { ...this.debugRuta.enriched, results: [], resultsCount: 0 },
        final: { ...this.debugRuta.final, sortedCount: 0, top3: [] },
      });

      // ✅ si no hay cubos => no hay resultados
      if (bucketsSorted.length === 0) {
        this.gasolinerasFiltradas = [];
        this.error = autonomiaIlimitada
          ? 'No hay gasolineras que cumplan los filtros en el corredor.'
          : `No hay gasolineras alcanzables (<= ${Math.round(kmUsables)} km) que cumplan filtros en el corredor.`;
        ok = true;
        return;
      }

      // ✅ Selección final: 2 por cubo, sustituyendo si falla
      const finalSelected: Gasolinera[] = [];
      const enrichedRows: any[] = [];

      for (const b of bucketsSorted) {
        const candidates = bucketMap.get(b) ?? [];
        let chosenCount = 0;

        for (let i = 0; i < candidates.length && chosenCount < 2; i++) {
          const g = candidates[i].g;
          const stop = { lat: g.latitud, lng: g.longitud };

          // ✅ requested++
          this.updateDebugRuta({
            googleCalls: {
              ...this.debugRuta.googleCalls,
              requested: (this.debugRuta.googleCalls.requested || 0) + 1,
            },
          });

          try {
            const info = await this.getRouteWithStop(origen, stop, destino);

            const leg1Km = info.distToGasKm;
            const extraKmReal = Math.max(0, info.distConParadaKm - base.distBaseKm);

            // ✅ autonomía opción 1: SOLO leg1 real
            if (!autonomiaIlimitada && leg1Km > kmUsables) {
              discardsAutonomy++;
              if (discardSamples.length < 3) discardSamples.push({ rotulo: g.rotulo, leg1Km, kmUsables });

              this.updateDebugRuta({
                googleCalls: {
                  ...this.debugRuta.googleCalls,
                  discardedByAutonomy: (this.debugRuta.googleCalls.discardedByAutonomy || 0) + 1,
                },
              });

              continue; // probar siguiente del cubo
            }

            // ✅ sanity
            if (!Number.isFinite(extraKmReal) || extraKmReal < 0) {
              continue;
            }

            const precioLitro = this.getPrecioLitroSegunFiltro(g, this.filters.fuelType);
            const litrosExtra = (extraKmReal * this.consumoFijoL100) / 100;
            const costeDesvio = litrosExtra * precioLitro;

            const finalInfo: CandidateRouteInfo = {
              distToGasKm: info.distToGasKm,
              distConParadaKm: info.distConParadaKm,
              extraKmReal,
              litrosExtra,
              costeDesvio,
            };

            g.routeInfo = finalInfo;
            g.distanceKm = finalInfo.extraKmReal;

            // ✅ etiqueta km desde origen (para UI)
            (g as any)._kmFromOrigin = candidates[i].kmFromOrigin;

            finalSelected.push(g);

            enrichedRows.push({
              bucket: b,
              rotulo: g.rotulo,
              kmFromOrigin: Number((candidates[i].kmFromOrigin ?? 0).toFixed(2)),
              precioLitro,
              distToGasKm: Number((info.distToGasKm ?? 0).toFixed(2)),
              distConParadaKm: Number((info.distConParadaKm ?? 0).toFixed(2)),
              extraKmReal: Number((extraKmReal ?? 0).toFixed(2)),
              litrosExtra: Number((litrosExtra ?? 0).toFixed(2)),
              costeDesvio: Number((costeDesvio ?? 0).toFixed(2)),
              minDistToRouteKm: Number(((g as any)._minDistToRouteKm ?? 0).toFixed(2)),
            });

            // ✅ finished++
            this.updateDebugRuta({
              googleCalls: {
                ...this.debugRuta.googleCalls,
                finished: (this.debugRuta.googleCalls.finished || 0) + 1,
              },
              enriched: {
                ...this.debugRuta.enriched,
                results: [...(this.debugRuta.enriched.results || []), enrichedRows[enrichedRows.length - 1]],
                resultsCount: enrichedRows.length,
              },
            });

            chosenCount++;
          } catch (err: any) {
            const currentGoogleCalls = this.debugRuta.googleCalls;
            const currentErrors = currentGoogleCalls.errors || [];

            const newFailed = (currentGoogleCalls.failed || 0) + 1;

            const newErrors = [
              ...currentErrors,
              {
                rotulo: g.rotulo,
                msg: err?.message ?? String(err),
              },
            ];

            this.updateDebugRuta({
              googleCalls: {
                ...currentGoogleCalls,
                failed: newFailed,
                errors: newErrors,
              },
            });

            continue;
          }
        }
      }

      // ✅ resumen autonomía
      console.log(`⛽ Autonomía (opción 1): descartadas por leg1 = ${discardsAutonomy}`);
      if (discardSamples.length) {
        console.log(
          '📌 Ejemplos descartados (máx 3):',
          discardSamples.map((x) => ({
            rotulo: x.rotulo,
            leg1Km: Number(x.leg1Km.toFixed(2)),
            kmUsables: x.kmUsables,
          }))
        );
      }

      // ✅ Orden final respetando sortBy (tu punto 14)
      finalSelected.sort((a, b) => this.compareBySort(a, b, this.filters));

      // ✅ si no hay resultados
      if (finalSelected.length === 0) {
        this.gasolinerasFiltradas = [];
        this.error = autonomiaIlimitada
          ? 'No hay gasolineras que cumplan los filtros en el corredor.'
          : `No hay gasolineras alcanzables (<= ${Math.round(kmUsables)} km) que cumplan filtros en el corredor.`;
        ok = true;
        return;
      }

      // ✅ debug final/top3 (solo preview)
      const top3 = finalSelected.slice(0, 3);
      this.updateDebugRuta({
        final: {
          sortedCount: finalSelected.length,
          top3: top3.map((g) => ({
            rotulo: g.rotulo,
            precio: this.getPrecioLitroSegunFiltro(g, this.filters.fuelType),
            extraKmReal: g.routeInfo?.extraKmReal,
            costeDesvio: g.routeInfo?.costeDesvio,
            kmFromOrigin: (g as any)._kmFromOrigin,
          })),
        },
      });

      // ✅ resultados UI: “sin límite”, depende de cubos
      this.gasolinerasFiltradas = finalSelected;

      console.log(`✅ Búsqueda en ruta completada. Mostrando: ${finalSelected.length} (2 por cubo, dentro de autonomía)`);

      ok = true;
    } catch (e: any) {
      console.error('❌ Error en ejecutarBusquedaEnRuta:', e);
      this.error = e?.message ?? 'Error en búsqueda en ruta';
      ok = false;
      throw e;
    } finally {
      this.debugFinish(ok);
    }
  }

  // ---------------------------
  // Dataset filtering (ruta)
  // ---------------------------

  private filtrarDatasetSinDistanciaCircular(gasolineras: Gasolinera[], filtros: Filters): Gasolinera[] {
    return gasolineras.filter((g) => {
      // 1. Verificar combustible y precio
      if (!this.tieneCombustibleYPrecioOK(g, filtros)) return false;

      // 2. Verificar empresas (solo si hay empresas seleccionadas)
      if (filtros.companies && filtros.companies.length > 0) {
        const pertenece = filtros.companies.some((empresa) => this.companyNormalizer.belongsToCompany(g.rotulo, empresa));

        // Modo "include": debe pertenecer a alguna de las empresas seleccionadas
        if (filtros.companyMode === 'include' && !pertenece) return false;

        // Modo "exclude": NO debe pertenecer a ninguna de las empresas seleccionadas
        if (filtros.companyMode === 'exclude' && pertenece) return false;
      }

      // 3. Verificar horario
      if (filtros.onlyOpen) {
        if (!this.estaAbiertaRudimentario(g.horario || '')) return false;
      }

      return true;
    });
  }

  private tieneCombustibleYPrecioOK(g: Gasolinera, filtros: Filters): boolean {
    if (filtros.fuelType === 'all') {
      const precios = [g.precioGasolina95, g.precioGasolina98, g.precioDiesel, g.precioDieselPremium, g.precioGLP].filter(
        (p) => p > 0
      );

      if (precios.length === 0) return false;

      if (filtros.maxPrice > 0) {
        const min = Math.min(...precios);
        if (min > filtros.maxPrice) return false;
      }
      return true;
    }

    const precio = this.getPrecioLitroSegunFiltro(g, filtros.fuelType);
    if (!(precio > 0)) return false;

    if (filtros.maxPrice > 0 && precio > filtros.maxPrice) return false;

    return true;
  }

  private getPrecioLitroSegunFiltro(g: Gasolinera, fuelType: FuelType | string): number {
    const tipo = fuelType as FuelType;

    switch (tipo) {
      case 'Gasolina 95 E5':
        return g.precioGasolina95 || 0;
      case 'Gasolina 98 E5':
        return g.precioGasolina98 || 0;
      case 'Gasóleo A':
        return g.precioDiesel || 0;
      case 'Gasóleo Premium':
        return g.precioDieselPremium || 0;
      case 'GLP':
        return g.precioGLP || 0;
      case 'all': {
        const precios = [g.precioGasolina95, g.precioGasolina98, g.precioDiesel, g.precioDieselPremium, g.precioGLP].filter(
          (p) => p > 0
        );
        return precios.length ? Math.min(...precios) : 0;
      }
      default:
        return g.precioGasolina95 || 0;
    }
  }

  private estaAbiertaRudimentario(horario: string): boolean {
    const h = (horario || '').toLowerCase();
    if (!h) return true;
    if (h.includes('cerrad')) return false;
    if (h.includes('clausur')) return false;
    return true;
  }

  // ---------------------------
  // Corredor de ruta
  // ---------------------------
  private filtrarPorCorredorRuta(gasolineras: Gasolinera[], routePoints: LatLng[], radioKm: number): Gasolinera[] {
    console.log('🛣️ filtrarPorCorredorRuta: puntos de ruta:', routePoints?.length || 0, 'gasolineras:', gasolineras.length);

    if (!routePoints || routePoints.length === 0) {
      console.warn('⚠️ No hay puntos de ruta para filtrar por corredor');
      return [];
    }

    if (routePoints.length === 1) {
      // Si solo hay un punto (origen=destino), filtrar por distancia directa
      const punto = routePoints[0];
      return gasolineras.filter((g) => {
        const distancia = haversineKm(punto.lat, punto.lng, g.latitud, g.longitud);
        return distancia <= radioKm;
      });
    }

    const sampled = this.sampleRoutePoints(routePoints, 1.5);
    console.log('🛣️ Puntos muestreados:', sampled.length);

    const resultado = gasolineras.filter((g) => {
      const p: LatLng = { lat: g.latitud, lng: g.longitud };
      const d = this.minDistancePointToPolylineKm(p, sampled);
      const dentro = d <= radioKm;

      // Debug para las primeras 5 gasolineras
      if (g === gasolineras[0]) {
        console.log('🔍 Ejemplo distancia:', {
          rótulo: g.rotulo,
          distancia: d.toFixed(2),
          radioKm,
          dentro,
        });
      }

      return dentro;
    });

    console.log('🛣️ Gasolineras en corredor:', resultado.length);
    return resultado;
  }

  private preRankCandidates(candidates: Gasolinera[], routePoints: LatLng[], filtros: Filters): Gasolinera[] {
    if (!candidates || candidates.length === 0) {
      console.log('📊 preRankCandidates: sin candidatos');
      return [];
    }

    console.log('📊 preRankCandidates: procesando', candidates.length, 'candidatos');

    const sampled = this.sampleRoutePoints(routePoints, 1.5);

    const withMetric = candidates.map((g) => {
      const p = { lat: g.latitud, lng: g.longitud };
      const minDist = this.minDistancePointToPolylineKm(p, sampled);

      // ✅ Asegurar que la propiedad se asigna correctamente
      (g as any)._minDistToRouteKm = minDist;

      // Debug para las primeras 3
      if (candidates.indexOf(g) < 3) {
        console.log('📊 preRank ejemplo:', {
          rótulo: g.rotulo,
          minDistToRouteKm: minDist.toFixed(2),
          precio: this.getPrecioLitroSegunFiltro(g, filtros.fuelType),
        });
      }

      return g;
    });

    if (filtros.sortBy === 'price') {
      withMetric.sort((a, b) => {
        const pa = this.getPrecioLitroSegunFiltro(a, filtros.fuelType);
        const pb = this.getPrecioLitroSegunFiltro(b, filtros.fuelType);
        if (pa !== pb) return pa - pb;
        return ((a as any)._minDistToRouteKm ?? 999) - ((b as any)._minDistToRouteKm ?? 999);
      });
    } else {
      withMetric.sort((a, b) => {
        const da = (a as any)._minDistToRouteKm ?? 999;
        const db = (b as any)._minDistToRouteKm ?? 999;
        if (da !== db) return da - db;
        const pa = this.getPrecioLitroSegunFiltro(a, filtros.fuelType);
        const pb = this.getPrecioLitroSegunFiltro(b, filtros.fuelType);
        return pa - pb;
      });
    }

    console.log('📊 preRankCandidates: ordenados', withMetric.length);
    return withMetric;
  }

  private sampleRoutePoints(points: LatLng[], stepKm: number): LatLng[] {
    if (!points || points.length === 0) return [];
    if (points.length <= 2) return points;

    const out: LatLng[] = [points[0]];
    let acc = 0;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const d = haversineKm(prev.lat, prev.lng, cur.lat, cur.lng);
      acc += d;

      if (acc >= stepKm) {
        out.push(cur);
        acc = 0;
      }
    }

    if (out[out.length - 1] !== points[points.length - 1]) {
      out.push(points[points.length - 1]);
    }

    console.log('📊 sampleRoutePoints: entrada', points.length, 'salida', out.length);
    return out;
  }

  private minDistancePointToPolylineKm(p: LatLng, poly: LatLng[]): number {
    let best = Number.POSITIVE_INFINITY;

    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1];
      const b = poly[i];
      const d = this.distancePointToSegmentKm(p, a, b);
      if (d < best) best = d;
    }
    return best;
  }

  private distancePointToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
    const R = 6371;

    const lat0 = (p.lat * Math.PI) / 180;
    const x = (lng: number) => ((lng * Math.PI) / 180) * Math.cos(lat0) * R;
    const y = (lat: number) => ((lat * Math.PI) / 180) * R;

    const px = x(p.lng);
    const py = y(p.lat);

    const ax = x(a.lng);
    const ay = y(a.lat);

    const bx = x(b.lng);
    const by = y(b.lat);

    const abx = bx - ax;
    const aby = by - ay;

    const apx = px - ax;
    const apy = py - ay;

    const ab2 = abx * abx + aby * aby;
    if (ab2 === 0) {
      const dx = px - ax;
      const dy = py - ay;
      return Math.sqrt(dx * dx + dy * dy);
    }

    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));

    const cx = ax + t * abx;
    const cy = ay + t * aby;

    const dx = px - cx;
    const dy = py - cy;

    return Math.sqrt(dx * dx + dy * dy);
  }

  // ---------------------------
  // Geocoding + Routes (Google / fallback)
  // ---------------------------
  private async resolveLatLngFromUbicacion(u: Ubicacion): Promise<LatLng> {
    if (Number.isFinite(u.latitud) && Number.isFinite(u.longitud) && u.latitud !== 0 && u.longitud !== 0) {
      return { lat: u.latitud, lng: u.longitud };
    }

    const texto = this.formatAddress(u);
    if (!texto.trim()) throw new Error('Dirección inválida para geocodificar.');

    if (this.googleApiKey) {
      return await this.googleGeocode(texto);
    }

    return await this.nominatimGeocode(texto);
  }

  private formatAddress(u: Ubicacion): string {
    const parts = [u.calle, u.numero, u.ciudad, u.provincia].filter(Boolean);
    return parts.join(', ');
  }

  private async googleGeocode(address: string): Promise<LatLng> {
    const url =
      'https://maps.googleapis.com/maps/api/geocode/json?address=' +
      encodeURIComponent(address) +
      '&key=' +
      encodeURIComponent(this.googleApiKey);

    const res: any = await this.http.get(url).toPromise();
    const loc = res?.results?.[0]?.geometry?.location;
    if (!loc) throw new Error('No se pudo geocodificar la dirección (Google).');

    return { lat: loc.lat, lng: loc.lng };
  }

  private async nominatimGeocode(address: string): Promise<LatLng> {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=' + encodeURIComponent(address);

    const res: any = await this.http.get(url).toPromise();
    const item = res?.[0];
    if (!item) throw new Error('No se pudo geocodificar la dirección (Nominatim).');

    return { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
  }

  private async getRouteBase(origen: LatLng, destino: LatLng): Promise<RouteBaseInfo> {
    // ✅ Fallback SIN Google: ruta simple origen->destino
    if (!this.googleApiKey) {
      const dist = haversineKm(origen.lat, origen.lng, destino.lat, destino.lng);
      const points = [origen, destino];

      console.log('[getRouteBase] fallback SIN Google', { distBaseKm: dist, pointsCount: points.length, origen, destino });

      return {
        distBaseKm: dist,
        durBaseSec: 0,
        polyline: '',
        points,
      };
    }

    // ✅ Con Google Routes
    const body = {
      origin: { location: { latLng: { latitude: origen.lat, longitude: origen.lng } } },
      destination: { location: { latLng: { latitude: destino.lat, longitude: destino.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      computeAlternativeRoutes: false,
      routeModifiers: { avoidTolls: false, avoidHighways: false, avoidFerries: false },
      languageCode: 'es-ES',
      units: 'METRIC',
    };

    const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';

    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': this.googleApiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    };

    const res: any = await this.http.post(url, body, { headers }).toPromise();

    const route = res?.routes?.[0];
    if (!route) throw new Error('No se pudo calcular la ruta base (Google Routes).');

    const distBaseKm = (route.distanceMeters || 0) / 1000;
    const durBaseSec = this.parseGoogleDurationSeconds(route.duration);
    const polyline = route.polyline?.encodedPolyline || '';
    const points = polyline ? this.decodePolyline(polyline) : [origen, destino];

    console.log('[getRouteBase] Google', { distBaseKm, pointsCount: points.length, polylinePresent: !!polyline });

    return { distBaseKm, durBaseSec, polyline, points };
  }

  private async getRouteWithStop(
    origen: LatLng,
    stop: LatLng,
    destino: LatLng
  ): Promise<{ distToGasKm: number; distFromGasKm: number; distConParadaKm: number }> {
    console.log('🔍 getRouteWithStop llamado:', {
      origen,
      stop,
      destino,
    });

    if (!this.googleApiKey) {
      const distTo = haversineKm(origen.lat, origen.lng, stop.lat, stop.lng);
      const distFrom = haversineKm(stop.lat, stop.lng, destino.lat, destino.lng);
      const distTot = distTo + distFrom;
      return { distToGasKm: distTo, distFromGasKm: distFrom, distConParadaKm: distTot };
    }

    const body = {
      origin: { location: { latLng: { latitude: origen.lat, longitude: origen.lng } } },
      destination: { location: { latLng: { latitude: destino.lat, longitude: destino.lng } } },
      intermediates: [{ location: { latLng: { latitude: stop.lat, longitude: stop.lng } } }],
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      computeAlternativeRoutes: false,
      languageCode: 'es-ES',
      units: 'METRIC',
    };

    const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';

    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': this.googleApiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.legs.distanceMeters',
    };

    const res: any = await this.http.post(url, body, { headers }).toPromise();
    const route = res?.routes?.[0];
    if (!route) throw new Error('No se pudo calcular la ruta con parada (Google Routes).');

    const legs = route.legs || [];
    const leg1 = legs[0];
    const leg2 = legs[1];

    const distToGasKm = ((leg1?.distanceMeters || 0) / 1000) || 0;
    const distFromGasKm = ((leg2?.distanceMeters || 0) / 1000) || 0;
    const distConParadaKm = ((route.distanceMeters || 0) / 1000) || 0;

    return { distToGasKm, distFromGasKm, distConParadaKm };
  }

  private parseGoogleDurationSeconds(duration: any): number {
    if (typeof duration === 'string' && duration.endsWith('s')) {
      const n = Number(duration.replace('s', ''));
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  private decodePolyline(encoded: string): LatLng[] {
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;
    const points: LatLng[] = [];

    while (index < len) {
      let b: number;
      let shift = 0;
      let result = 0;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);

      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);

      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }

    return points;
  }

  // ---------------------------
  // Helpers
  // ---------------------------
  private clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }

  private async mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length) as any;
    let i = 0;

    const workers = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx], idx);
      }
    });

    await Promise.all(workers);
    return results;
  }

  // =========================================================
  // ✅ NUEVOS HELPERS (CUBOS)
  // =========================================================
  private estimateKmAlongSegment(origen: LatLng, destino: LatLng, p: LatLng): number {
    // Proyección en un plano local (km). Aproximado pero estable.
    const R = 6371;
    const lat0 = (origen.lat * Math.PI) / 180;

    const x = (lng: number) => ((lng * Math.PI) / 180) * Math.cos(lat0) * R;
    const y = (lat: number) => ((lat * Math.PI) / 180) * R;

    const ax = x(origen.lng),
      ay = y(origen.lat);
    const bx = x(destino.lng),
      by = y(destino.lat);
    const px = x(p.lng),
      py = y(p.lat);

    const abx = bx - ax,
      aby = by - ay;
    const apx = px - ax,
      apy = py - ay;

    const ab2 = abx * abx + aby * aby;
    if (ab2 === 0) return 0;

    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));

    const projx = ax + t * abx;
    const projy = ay + t * aby;

    const dx = projx - ax;
    const dy = projy - ay;

    return Math.sqrt(dx * dx + dy * dy);
  }

  private computeIntervalKm(distBaseKm: number, kmUsables: number, autonomiaIlimitada: boolean): number {
    let interval = this.clamp(Math.round(distBaseKm / 12), 15, 60);
    if (!autonomiaIlimitada && Number.isFinite(kmUsables) && kmUsables > 0) {
      interval = Math.max(15, Math.min(interval, Math.round(kmUsables / 3)));
    }
    return interval;
  }

  private compareBySort(a: Gasolinera, b: Gasolinera, filtros: Filters): number {
    const pa = this.getPrecioLitroSegunFiltro(a, filtros.fuelType);
    const pb = this.getPrecioLitroSegunFiltro(b, filtros.fuelType);
    const da = (a as any)._minDistToRouteKm ?? 999999;
    const db = (b as any)._minDistToRouteKm ?? 999999;

    if (filtros.sortBy === 'price') {
      if (pa !== pb) return pa - pb;
      return da - db;
    } else {
      if (da !== db) return da - db;
      return pa - pb;
    }
  }
}
