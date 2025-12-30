export interface Ubicacion {
  calle?: string;
  numero?: string;
  ciudad?: string;
  provincia?: string;
  latitud: number;
  longitud: number;
  direccionCompleta?: string;
  direccion?: string; // Mantener por compatibilidad
}