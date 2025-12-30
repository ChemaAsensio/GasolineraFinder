// src/app/models/station.ts

export interface StationPrices {
  [fuelName: string]: number | null;
}

export interface Gasolinera {
  id: string;
  rotulo: string;
  direccion: string;
  municipio: string;
  provincia: string;
  codigoPostal: string;
  latitud: number;
  longitud: number;
  localidad: string;
  margen: string;
  tipoVenta: string;
  horario: string;
  valoracion?: number; // opcional

  // precios unificados (los usa el SummaryBox)
  precios: StationPrices;

  remision: string;
  bioEtanol: string;
  esterMetilico: string;
  porcentajeBioEtanol: string;
  porcentajeEsterMetilico: string;

  // calculadas
  distanceKm?: number;

  // (si las usas en UI o cálculos)
  precioGasolina95: number;
  precioGasolina98: number;
  precioDiesel: number;
  precioDieselPremium: number;
  precioGLP: number;
}
export interface Ubicacion {
  calle: string;  // Nueva propiedad
  numero: string;  // Nueva propiedad
  ciudad: string;
  provincia: string;  // Nueva propiedad
  latitud: number;
  longitud: number;
  direccionCompleta?: string;  // Opcional para almacenar la dirección completa
}
// Alias por compatibilidad si alguien importaba Station
export type Station = Gasolinera;
