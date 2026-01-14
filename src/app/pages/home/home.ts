// src/app/pages/home/home.ts
import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewChecked,
  ChangeDetectorRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { GasolineraService } from '../../services/api/gasolinera';
import { GeolocationService } from '../../services/geolocation';
import { StorageService } from '../../services/storage';
import { CompanyNormalizerService } from '../../services/company-normalizer';

import { Gasolinera, CandidateRouteInfo } from '../../models/station';
import { Filters, FuelType } from '../../models/filter';
import { FiltersComponent } from '../../components/filters/filters';
import { SummaryBoxComponent } from '../../components/summary-box/summary-box';
import { Ubicacion } from '../../models/location';
import { environment } from '../../../environments/environment';

import { haversineKm } from '../../utils/haversine';
import { GoogleRoutesService } from '../../services/google/google-routes.service';

// ✅ Google Maps (Angular wrapper)
import {
  GoogleMapsModule,
  GoogleMap,
  MapMarker,
  MapPolyline,
  MapInfoWindow
} from '@angular/google-maps';

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

  corridorCandidatesTotal: number;
  corridorCandidatesEnAutonomia: number;

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
  discardedByDetour: number; // ✅ NUEVO
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
  imports: [CommonModule, FormsModule, FiltersComponent, SummaryBoxComponent, GoogleMapsModule],
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

  // ✅ Ya NO usamos “googleApiKey” para llamar a Google “a mano”.
  // El service usa environment.googleMapsApiKey.
  private get hasGoogleKey(): boolean {
    return !!(environment.googleMapsApiKey && environment.googleMapsApiKey.trim().length > 0);
  }

  filters: Filters = {
    fuelType: 'Gasolina 95 E5',
    companies: [],
    maxPrice: 0,
    maxDistance: 50, // ✅ EN MODO RUTA: esto lo tratamos como "DESVÍO MÁXIMO" (km)
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

  // ✅ NUEVO: radio fijo del “corredor” (distancia lateral a la ruta)
  // El slider maxDistance lo usamos SOLO como “desvío máximo real”.
  private readonly corridorRadiusKm = 7;

  // =========================================================
  // ✅ MAPA (origen/destino/selección + fit bounds)
  // =========================================================

  
  @ViewChild(MapInfoWindow) infoWindow?: MapInfoWindow;

selectedInfoForMap: {
  rotulo: string;
  direccion: string;
  precio: number;
  horario: string;
} | null = null;


onStationMarkerClick(marker: MapMarker, station: Gasolinera): void {
  this.onGasolineraSeleccionada(station, false);

  this.selectedInfoForMap = {
    rotulo: station.rotulo || 'Gasolinera',
    direccion: this.formatAddress(station as any),
    precio: this.obtenerPrecioRelevante(station),
    horario: station.horario || ''
  };

  this.cd.detectChanges();
  setTimeout(() => this.infoWindow?.open(marker), 0);
}




  
  // =========================================================
  // ✅ MAPA (origen/destino/selección + fit bounds)
  // =========================================================
  @ViewChild(GoogleMap) googleMap?: GoogleMap;

  // Center/zoom iniciales (si no hay bounds)
  mapCenter: google.maps.LatLngLiteral = { lat: 40.4168, lng: -3.7038 };
  mapZoom = 6;

  mapOptions: google.maps.MapOptions = {
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  };

  markerOrigen?: google.maps.LatLngLiteral;
  markerDestino?: google.maps.LatLngLiteral;
  markerSeleccion?: google.maps.LatLngLiteral;

  constructor(
    private cd: ChangeDetectorRef,
    private gasolineraService: GasolineraService,
    private geolocationService: GeolocationService,
    private storageService: StorageService,
    private companyNormalizer: CompanyNormalizerService,
    private http: HttpClient,
    private googleRoutes: GoogleRoutesService
  ) {}

  // ===========================
  // 🧪 DEBUG / DEPURACIÓN RUTA
  // ===========================
  DEBUG_UI = true;

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
      totalStations: 0,
      afterDatasetFilters: 0,
      radioKm: 0,

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
      discardedByDetour: 0,
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

  private updateDebugRuta(updates: Partial<typeof this.debugRuta>): void {
    let current: any;
    try {
      current = JSON.parse(JSON.stringify(this.debugRuta));
    } catch {
      current = { ...this.debugRuta };
    }

    const mergeDeep = (target: any, source: any): any => {
      if (source === null || source === undefined) return target;
      if (typeof source !== 'object' || Array.isArray(source)) return source;
      if (typeof target !== 'object' || target === null || Array.isArray(target)) target = {};

      for (const key of Object.keys(source)) {
        const sVal = source[key];
        const tVal = target[key];

        if (Array.isArray(sVal)) {
          target[key] = [...sVal];
          continue;
        }
        if (sVal && typeof sVal === 'object') {
          target[key] = mergeDeep(tVal, sVal);
          continue;
        }
        target[key] = sVal;
      }
      return target;
    };

    const merged = mergeDeep(current, updates);
    this.debugRuta = { ...merged };
    this.cd.markForCheck();
  }

  private updateDebugDataset(updates: Partial<typeof this.debugRuta.dataset>): void {
    this.debugRuta = {
      ...this.debugRuta,
      dataset: { ...this.debugRuta.dataset, ...updates },
    };
    this.cd.markForCheck();
  }

  private debugReset(): void {
    const now = new Date();

    this.debugRuta = {
      ...this.debugRuta,
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
        geocodeProvider: 'nominatim',
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
        discardedByDetour: 0,
        errors: [],
      },

      enriched: { resultsCount: 0, results: [] },
      final: { sortedCount: 0, top3: [] },
      ui: { busquedaEnCurso: this.busquedaEnCurso, mostrarResultados: this.mostrarResultados, error: this.error },
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

// =========================================================
// ✅ POLILÍNEA RUTA + MARKERS GASOLINERAS
// =========================================================
routePath: google.maps.LatLngLiteral[] = [];
routePolylineOptions: google.maps.PolylineOptions = {
  strokeOpacity: 0.9,
  strokeWeight: 5,
  clickable: false,
  geodesic: true
};

// Markers para gasolineras resultado
stationMarkers: Array<{
  position: google.maps.LatLngLiteral;
  title: string;
  station: Gasolinera;
}> = [];

private starIcon(): google.maps.Icon {
  // SVG inline (estrella). Así no dependes de URLs externas.
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24">
      <path fill="#FFD54A" stroke="#111" stroke-width="1"
        d="M12 2.5l2.9 6.2 6.8.6-5.2 4.5 1.6 6.7L12 17.9 5.9 20.5l1.6-6.7-5.2-4.5 6.8-.6L12 2.5z"/>
    </svg>
  `);

  return {
    url: `data:image/svg+xml;charset=UTF-8,${svg}`,
    scaledSize: new google.maps.Size(28, 28),
    anchor: new google.maps.Point(14, 14),
  };
}

stationMarkerOptions: google.maps.MarkerOptions = {
  clickable: true,
};

private buildStationMarkersFromResults(): void {
  const list = (this.gasolinerasFiltradas ?? [])
    .filter(g => Number.isFinite(g.latitud) && Number.isFinite(g.longitud) && g.latitud !== 0 && g.longitud !== 0)
    // opcional: limitar para no llenar el mapa (ajusta si quieres)
    .slice(0, 60);

  this.stationMarkers = list.map(g => ({
    position: { lat: g.latitud, lng: g.longitud },
    title: g.rotulo || 'Gasolinera',
    station: g
  }));

  this.cd.markForCheck();
}

private clearRouteAndStationsOnMap(): void {
  this.routePath = [];
  this.stationMarkers = [];
  this.cd.markForCheck();
}



  // =========================================================
  // ✅ Actualizar mapa: origen/destino/selección + fitBounds
  // =========================================================
  private updateRouteMapMarkers(origen: LatLng | null, destino: LatLng | null): void {
    if (origen) this.markerOrigen = { lat: origen.lat, lng: origen.lng };
    if (destino) this.markerDestino = { lat: destino.lat, lng: destino.lng };

    // Center fallback
    if (origen) {
      this.mapCenter = { lat: origen.lat, lng: origen.lng };
      this.mapZoom = 9;
    }

    this.cd.markForCheck();

    // Fit bounds cuando el mapa ya existe
    setTimeout(() => this.fitMapToMarkers(), 80);
  }

private fitMapToMarkers(): void {
  if (!this.googleMap?.googleMap) return;

  const bounds = new google.maps.LatLngBounds();
  let count = 0;

  const add = (p?: google.maps.LatLngLiteral) => {
    if (!p) return;
    bounds.extend(p);
    count++;
  };

  // Origen / destino / selección
  add(this.markerOrigen);
  add(this.markerDestino);
  add(this.markerSeleccion);

  // ✅ Ruta (polilínea)
  if (this.routePath?.length) {
    // Para no meter 1000 puntos en bounds, muestreamos
    const step = Math.max(1, Math.floor(this.routePath.length / 60));
    for (let i = 0; i < this.routePath.length; i += step) {
      add(this.routePath[i]);
    }
    // Asegura último punto
    add(this.routePath[this.routePath.length - 1]);
  }

  // ✅ Estrellas (markers de resultados)
  if (this.stationMarkers?.length) {
    for (const m of this.stationMarkers.slice(0, 80)) {
      add(m.position);
    }
  }

  if (count === 0) return;

  if (count === 1) {
    const only = this.markerOrigen || this.markerDestino || this.markerSeleccion || this.routePath?.[0] || this.stationMarkers?.[0]?.position;
    if (only) {
      this.googleMap.googleMap.setCenter(only);
      this.googleMap.googleMap.setZoom(12);
    }
    return;
  }

  this.googleMap.googleMap.fitBounds(bounds, 60);
}


  // Si eliges una gasolinera, ponemos el marcador y reajustamos el mapa
private setSelectedMarkerFromStation(g: Gasolinera | null, ajustarMapa: boolean = true): void {
  if (!g) {
    this.markerSeleccion = undefined;
    if (ajustarMapa) setTimeout(() => this.fitMapToMarkers(), 50);
    return;
  }

  if (Number.isFinite(g.latitud) && Number.isFinite(g.longitud) && g.latitud !== 0 && g.longitud !== 0) {
    this.markerSeleccion = { lat: g.latitud, lng: g.longitud };
    if (ajustarMapa) setTimeout(() => this.fitMapToMarkers(), 50);
  }
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

    // Inicializa marcador de origen si ya hay coords guardadas
    if (this.ubicacionUsuario.latitud && this.ubicacionUsuario.longitud) {
      this.markerOrigen = { lat: this.ubicacionUsuario.latitud, lng: this.ubicacionUsuario.longitud };
      this.mapCenter = { ...this.markerOrigen };
    }

    this.cargarGasolineras();

    this.stationMarkerOptions = {
    clickable: true,
    icon: this.starIcon()
    };

    this.setupObservers();
    setTimeout(() => this.checkScrollNeeded(), 100);

    const gifElement = document.querySelector('.gif-coche img') as HTMLImageElement;
    if (gifElement) {
      gifElement.style.animation = 'rotar 3s ease-out 1';
    }

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
    // Reset destino + marcador destino (pero NO borramos origen)
    this.destino = {
      latitud: 0,
      longitud: 0,
      calle: '',
      numero: '',
      ciudad: '',
      provincia: '',
      direccionCompleta: '',
    };
    this.markerDestino = undefined;

    // ✅ En modo ruta, limpiamos selección previa y marcadores de resultados anteriores
    this.markerSeleccion = undefined;
    this.stationMarkers = [];
    // La ruta se pintará cuando ejecutes búsqueda en ruta (routePath se setea al obtener la ruta base)
    this.routePath = [];

    setTimeout(() => this.fitMapToMarkers(), 80);
  } else {
    // Volvemos a modo buscar
    this.acordeonAbierto.destino = false;

    // ✅ Quitamos destino, selección y la polilínea de ruta
    this.markerDestino = undefined;
    this.markerSeleccion = undefined;
    this.routePath = [];

    // ✅ (Opcional pero recomendado) también limpiamos estrellas de resultados anteriores
    // Si luego haces una búsqueda en modo buscar, se volverán a crear con buildStationMarkersFromResults()
    this.stationMarkers = [];

    setTimeout(() => this.fitMapToMarkers(), 80);
  }

  setTimeout(() => this.checkScrollNeeded(), 100);
}


  toggleAcordeon(seccion: keyof typeof this.acordeonAbierto): void {
    this.acordeonAbierto[seccion] = !this.acordeonAbierto[seccion];
    setTimeout(() => this.checkScrollNeeded(), 350);
  }

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

        // ✅ Actualiza marcador de origen
        this.markerOrigen = { lat: this.ubicacionUsuario.latitud, lng: this.ubicacionUsuario.longitud };
        this.mapCenter = { ...this.markerOrigen };
        this.mapZoom = 11;
        setTimeout(() => this.fitMapToMarkers(), 80);
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

    if (this.gasolineras.length === 0) {
      this.error = 'Cargando gasolineras...';
      this.busquedaEnCurso = true;

      try {
        await new Promise<void>((resolve, reject) => {
          if (this.gasolineras.length > 0) {
            resolve();
          } else {
            let attempts = 0;
            const maxAttempts = 100;

            const checkInterval = setInterval(() => {
              attempts++;
              if (this.gasolineras.length > 0) {
                clearInterval(checkInterval);
                resolve();
              } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                reject(new Error('No se pudieron cargar las gasolineras después de 10 segundos'));
              }
            }, 100);
          }
        });

        this.error = null;
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

      // ✅ Marcar gasolineras resultado con estrella
      this.buildStationMarkersFromResults();

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
    // En modo buscar, si hay origen, intentamos que el mapa lo refleje
    if (this.ubicacionUsuario.latitud && this.ubicacionUsuario.longitud) {
      this.markerOrigen = { lat: this.ubicacionUsuario.latitud, lng: this.ubicacionUsuario.longitud };
      this.mapCenter = { ...this.markerOrigen };
      this.mapZoom = 11;
      setTimeout(() => this.fitMapToMarkers(), 80);
    }
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

    this.gasolinerasFiltradas = [...this.gasolineras];

    // ✅ Autonomía en modo buscar: si es 0 => ilimitada (no filtra)
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

  ordenarGasolineras(): void {
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

onGasolineraSeleccionada(g: Gasolinera, ajustarMapa: boolean = true): void {
  this.gasolineraSeleccionada = g;
  this.acordeonAbierto.detalles = true;

  // ✅ marcador “selección”
  this.setSelectedMarkerFromStation(g);

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

    // ✅ limpiar mapa
    this.markerOrigen = undefined;
    this.markerDestino = undefined;
    this.markerSeleccion = undefined;
    this.mapCenter = { lat: 40.4168, lng: -3.7038 };
    this.mapZoom = 6;

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
  // ✅ MODO RUTA
  //   - Autonomía: limita “leg1Km” (origen -> gasolinera)
  //   - Slider maxDistance: limita “extraKmReal” (desvío real total)
  //   - distanceKm YA NO se usa para desvío (evita el “161 km”)
  // =========================================================
  private async ejecutarBusquedaEnRuta(): Promise<void> {
    this.debugReset();

    let ok = false;

    try {
      if (!this.gasolineras || this.gasolineras.length === 0) {
        throw new Error('No hay gasolineras cargadas. Por favor, intenta de nuevo.');
      }

      this.updateDebugDataset({ totalStations: this.gasolineras.length } as any);

      const kmDisponibles = Number(this.kmDisponiblesUsuario);
      const autonomiaIlimitada = !Number.isFinite(kmDisponibles) || kmDisponibles <= 0;

      const kmUsables = autonomiaIlimitada ? Number.POSITIVE_INFINITY : kmDisponibles - this.reservaMinKm;

      if (!autonomiaIlimitada && (!Number.isFinite(kmUsables) || kmUsables <= 0)) {
        throw new Error(
          `Autonomía insuficiente: reserva mínima ${this.reservaMinKm} km. Ingresa una autonomía mayor a ${this.reservaMinKm} km.`
        );
      }

      // ✅ Desvío máximo (slider)
      const maxDesvioKm = Number(this.filters.maxDistance);
      const hasMaxDesvio = Number.isFinite(maxDesvioKm) && maxDesvioKm > 0;

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
          geocodeProvider: 'nominatim',
        },
      });

      const origen = await this.resolveLatLngFromUbicacion(this.ubicacionUsuario);
      const destino = await this.resolveLatLngFromUbicacion(this.destino);

      this.updateDebugRuta({
        input: {
          ...this.debugRuta.input,
          origenResolved: origen,
          destinoResolved: destino,
          geocodeProvider: 'nominatim',
        },
      });

      // ✅ actualizar mapa: origen/destino + fitBounds
      this.updateRouteMapMarkers(origen, destino);

      const base = await this.getRouteBase(origen, destino);

      // ✅ Pintar ruta (polyline) en el mapa
      this.routePath = (base.points ?? []).map(p => ({ lat: p.lat, lng: p.lng }));
      this.cd.markForCheck();

      this.updateDebugRuta({
        baseRoute: {
          distBaseKm: base.distBaseKm,
          durBaseSec: base.durBaseSec,
          pointsCount: base.points?.length || 0,
          sampleFirstLast: base.points?.length ? { first: base.points[0], last: base.points[base.points.length - 1] } : null,
          polylinePresent: !!base.polyline,
        },
      });

      const filtradasPorDataset = this.filtrarDatasetSinDistanciaCircular(this.gasolineras, this.filters);

      // ✅ Radio del corredor: fijo, NO el slider
      const radioKm = this.corridorRadiusKm;

      this.updateDebugDataset({
        afterDatasetFilters: filtradasPorDataset.length,
        radioKm: radioKm,
      });

      if (filtradasPorDataset.length === 0) {
        this.gasolinerasFiltradas = [];
        ok = true;
        return;
      }

      const candidatasCorredor = this.filtrarPorCorredorRuta(filtradasPorDataset, base.points, radioKm);

      this.updateDebugDataset({
        corridorCandidatesTotal: candidatasCorredor.length,
      });

      let candidatasAutonomia = candidatasCorredor;
      if (!autonomiaIlimitada) {
        candidatasAutonomia = candidatasCorredor.filter((g) => {
          const d = haversineKm(origen.lat, origen.lng, g.latitud, g.longitud);
          return d <= kmUsables;
        });
      }

      this.updateDebugDataset({
        corridorCandidatesEnAutonomia: candidatasAutonomia.length,
      });

      const preRank = this.preRankCandidates(candidatasAutonomia, base.points, this.filters);

      const intervalKm = this.computeIntervalKm(base.distBaseKm, kmUsables, autonomiaIlimitada);
      const maxKmVisible = autonomiaIlimitada ? base.distBaseKm : Math.min(kmUsables, base.distBaseKm);

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
        bucketMap.set(b, arr.slice(0, 6));
      }

      const bucketsSorted = Array.from(bucketMap.keys()).sort((a, b) => a - b);

      const firstBucketPreview = bucketsSorted.length ? bucketMap.get(bucketsSorted[0]) ?? [] : [];

      this.updateDebugDataset({
        N: bucketsSorted.length,
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

      this.updateDebugRuta({
        googleCalls: {
          ...this.debugRuta.googleCalls,
          concurrency: 1,
          requested: 0,
          finished: 0,
          failed: 0,
          discardedByAutonomy: 0,
          discardedByDetour: 0,
          errors: [],
        },
        enriched: { ...this.debugRuta.enriched, results: [], resultsCount: 0 },
        final: { ...this.debugRuta.final, sortedCount: 0, top3: [] },
      });

      if (bucketsSorted.length === 0) {
        this.gasolinerasFiltradas = [];
        this.error = autonomiaIlimitada
          ? 'No hay gasolineras que cumplan los filtros en el corredor.'
          : `No hay gasolineras alcanzables (<= ${Math.round(kmUsables)} km) que cumplan filtros en el corredor.`;
        ok = true;
        return;
      }

      const finalSelected: Gasolinera[] = [];
      const enrichedRows: any[] = [];

      for (const b of bucketsSorted) {
        const candidates = bucketMap.get(b) ?? [];
        let chosenCount = 0;

        for (let i = 0; i < candidates.length && chosenCount < 2; i++) {
          const g = candidates[i].g;
          const stop = { lat: g.latitud, lng: g.longitud };

          // ✅ siempre guardamos kmFromOrigin en el objeto (para SummaryBox)
          (g as any)._kmFromOrigin = candidates[i].kmFromOrigin;

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

            // ✅ Autonomía SOLO valida el “primer tramo” (origen->gasolinera)
            if (!autonomiaIlimitada && leg1Km > kmUsables) {
              this.updateDebugRuta({
                googleCalls: {
                  ...this.debugRuta.googleCalls,
                  discardedByAutonomy: (this.debugRuta.googleCalls.discardedByAutonomy || 0) + 1,
                },
              });
              continue;
            }

            if (!Number.isFinite(extraKmReal) || extraKmReal < 0) continue;

            // ✅ Slider maxDistance = DESVÍO MÁXIMO (extraKmReal)
            if (hasMaxDesvio && extraKmReal > maxDesvioKm) {
              this.updateDebugRuta({
                googleCalls: {
                  ...this.debugRuta.googleCalls,
                  discardedByDetour: (this.debugRuta.googleCalls.discardedByDetour || 0) + 1,
                },
              });
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

            // ✅ Si quieres que “distanceKm” tenga un significado en modo ruta:
            g.distanceKm = (g as any)._kmFromOrigin;

            finalSelected.push(g);

            enrichedRows.push({
              bucket: b,
              rotulo: g.rotulo,
              direccion: this.formatAddress(g),
              kmFromOrigin: Number((candidates[i].kmFromOrigin ?? 0).toFixed(2)),
              precioLitro,
              distToGasKm: Number((info.distToGasKm ?? 0).toFixed(2)),
              distConParadaKm: Number((info.distConParadaKm ?? 0).toFixed(2)),
              extraKmReal: Number((extraKmReal ?? 0).toFixed(2)),
              litrosExtra: Number((litrosExtra ?? 0).toFixed(2)),
              costeDesvio: Number((costeDesvio ?? 0).toFixed(2)),
              minDistToRouteKm: Number(((g as any)._minDistToRouteKm ?? 0).toFixed(2)),
            });

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

      // ✅ Orden final (price o “distancia a ruta” según filtro)
      finalSelected.sort((a, b) => this.compareBySort(a, b, this.filters));

      if (finalSelected.length === 0) {
        this.gasolinerasFiltradas = [];
        this.error = autonomiaIlimitada
          ? 'No hay gasolineras que cumplan los filtros en el corredor.'
          : `No hay gasolineras alcanzables (<= ${Math.round(kmUsables)} km) que cumplan filtros en el corredor.`;
        ok = true;
        return;
      }

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

      this.gasolinerasFiltradas = finalSelected;
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
      if (!this.tieneCombustibleYPrecioOK(g, filtros)) return false;

      if (filtros.companies && filtros.companies.length > 0) {
        const pertenece = filtros.companies.some((empresa) => this.companyNormalizer.belongsToCompany(g.rotulo, empresa));

        if (filtros.companyMode === 'include' && !pertenece) return false;
        if (filtros.companyMode === 'exclude' && pertenece) return false;
      }

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
    if (!routePoints || routePoints.length === 0) return [];

    if (routePoints.length === 1) {
      const punto = routePoints[0];
      return gasolineras.filter((g) => {
        const distancia = haversineKm(punto.lat, punto.lng, g.latitud, g.longitud);
        return distancia <= radioKm;
      });
    }

    const sampled = this.sampleRoutePoints(routePoints, 1.5);

    return gasolineras.filter((g) => {
      const p: LatLng = { lat: g.latitud, lng: g.longitud };
      const d = this.minDistancePointToPolylineKm(p, sampled);
      return d <= radioKm;
    });
  }

  private preRankCandidates(candidates: Gasolinera[], routePoints: LatLng[], filtros: Filters): Gasolinera[] {
    if (!candidates || candidates.length === 0) return [];

    const sampled = this.sampleRoutePoints(routePoints, 1.5);

    const withMetric = candidates.map((g) => {
      const p = { lat: g.latitud, lng: g.longitud };
      const minDist = this.minDistancePointToPolylineKm(p, sampled);
      (g as any)._minDistToRouteKm = minDist;
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

  // =========================================================
  // ✅ Geocoding + Routes
  //   - Geocoding: SIEMPRE Nominatim
  //   - Routes: GoogleRoutesService si hay key (con fallback)
  // =========================================================

  private async resolveLatLngFromUbicacion(u: Ubicacion): Promise<LatLng> {
    if (Number.isFinite(u.latitud) && Number.isFinite(u.longitud) && u.latitud !== 0 && u.longitud !== 0) {
      return { lat: u.latitud, lng: u.longitud };
    }

    const texto = this.formatAddress(u);
    if (!texto.trim()) throw new Error('Dirección inválida para geocodificar.');

    try {
      const r = await this.nominatimGeocode(texto);
      if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lng) || (r.lat === 0 && r.lng === 0)) {
        throw new Error('Nominatim no devolvió coordenadas válidas.');
      }
      return r;
    } catch (e: any) {
      console.warn('⚠️ Nominatim Geocoding falló:', {
        address: texto,
        msg: e?.message ?? String(e),
      });
      throw e;
    }
  }

  private formatAddress(u: Ubicacion): string {
    const full = (u.direccionCompleta || '').trim();
    if (full) return full;

    const parts = [u.calle, u.numero, u.ciudad, u.provincia].filter(Boolean);
    return parts.join(', ');
  }

  private async nominatimGeocode(address: string): Promise<LatLng> {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=' + encodeURIComponent(address);

    const res: any = await firstValueFrom(this.http.get(url));
    const item = res?.[0];
    if (!item) throw new Error('No se pudo geocodificar la dirección (Nominatim).');

    return { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
  }

  private async getRouteBase(origen: LatLng, destino: LatLng): Promise<RouteBaseInfo> {
    if (!this.hasGoogleKey) {
      const dist = haversineKm(origen.lat, origen.lng, destino.lat, destino.lng);
      return { distBaseKm: dist, durBaseSec: 0, polyline: '', points: [origen, destino] };
    }

    try {
      const r = await this.googleRoutes.computeRoute(origen as any, destino as any);
      const polyline = r.polyline || '';
      const points = polyline ? this.decodePolyline(polyline) : [origen, destino];
      return {
        distBaseKm: r.distanceKm || 0,
        durBaseSec: r.durationSec || 0,
        polyline,
        points,
      };
    } catch (e: any) {
      console.warn('⚠️ Google Routes (ruta base) falló. Fallback a haversine.', e?.message ?? e);
      const dist = haversineKm(origen.lat, origen.lng, destino.lat, destino.lng);
      return { distBaseKm: dist, durBaseSec: 0, polyline: '', points: [origen, destino] };
    }
  }

  private async getRouteWithStop(
    origen: LatLng,
    stop: LatLng,
    destino: LatLng
  ): Promise<{ distToGasKm: number; distFromGasKm: number; distConParadaKm: number }> {
    if (!this.hasGoogleKey) {
      const distTo = haversineKm(origen.lat, origen.lng, stop.lat, stop.lng);
      const distFrom = haversineKm(stop.lat, stop.lng, destino.lat, destino.lng);
      return { distToGasKm: distTo, distFromGasKm: distFrom, distConParadaKm: distTo + distFrom };
    }

    try {
      const r = await this.googleRoutes.computeRoute(origen as any, destino as any, stop as any);
      const distConParadaKm = r.distanceKm || 0;

      const approxLeg1 = haversineKm(origen.lat, origen.lng, stop.lat, stop.lng);
      const distToGasKm = Number.isFinite(r.leg1DistanceKm) ? (r.leg1DistanceKm as number) : approxLeg1;

      const distFromGasKm = Math.max(0, distConParadaKm - distToGasKm);
      return { distToGasKm, distFromGasKm, distConParadaKm };
    } catch (e: any) {
      console.warn('⚠️ Google Routes (con parada) falló. Fallback a haversine.', e?.message ?? e);
      const distTo = haversineKm(origen.lat, origen.lng, stop.lat, stop.lng);
      const distFrom = haversineKm(stop.lat, stop.lng, destino.lat, destino.lng);
      return { distToGasKm: distTo, distFromGasKm: distFrom, distConParadaKm: distTo + distFrom };
    }
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

  // =========================================================
  // Helpers
  // =========================================================
  private clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }

  private estimateKmAlongSegment(origen: LatLng, destino: LatLng, p: LatLng): number {
    const R = 6371;
    const lat0 = (origen.lat * Math.PI) / 180;

    const x = (lng: number) => (((lng * Math.PI) / 180) * Math.cos(lat0) * R);
    const y = (lat: number) => (((lat * Math.PI) / 180) * R);

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

