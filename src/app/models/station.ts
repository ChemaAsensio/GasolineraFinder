// src/app/models/station.ts

export interface StationPrices {
  [fuelName: string]: number | null;
}

// ✅ Tipo para modo ruta
export type CandidateRouteInfo = {
  distToGasKm: number;
  distConParadaKm: number;
  extraKmReal: number;
  litrosExtra: number;
  costeDesvio: number;
};

export interface Gasolinera {
  id: string;
  rotulo: string;
  
  // Dirección
  direccion: string;
  direccionCompleta?: string;  // Añadido
  calle?: string;              // Añadido
  numero?: string;             // Añadido

  municipio: string;
  provincia: string;
  codigoPostal: string;
  latitud: number;
  longitud: number;
  localidad: string;
  margen: string;
  tipoVenta: string;
  horario: string;
  valoracion?: number;

  // precios unificados
  precios: StationPrices;

  remision: string;
  bioEtanol: string;
  esterMetilico: string;
  porcentajeBioEtanol: string;
  porcentajeEsterMetilico: string;

  // calculadas
  distanceKm?: number;

  // ✅ modo ruta
  routeInfo?: CandidateRouteInfo;

  // precios “planos”
  precioGasolina95: number;
  precioGasolina98: number;
  precioDiesel: number;
  precioDieselPremium: number;
  precioGLP: number;
}



// Extensiones opcionales para modo ruta
export interface GasolineraRuta extends Gasolinera {
  distToGasKm?: number;       // leg1
  distConParadaKm?: number;   // total
  extraKmReal?: number;       // total - base
  costeDesvio?: number;       // litrosExtra * precioLitro
}

export type Station = Gasolinera;
