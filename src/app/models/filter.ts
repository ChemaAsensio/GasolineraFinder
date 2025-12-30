// src/app/models/filter.ts
export type FuelType = 
  | 'Gasolina 95 E5'
  | 'Gasolina 98 E5'
  | 'Gasóleo A'
  | 'Gasóleo Premium'
  | 'GLP'
  | 'all';  

export interface Filters {
  fuelType: FuelType;
  companies: string[];
  maxPrice: number;
  maxDistance: number;
  onlyOpen: boolean;
  sortBy: 'distance' | 'price';
  companyMode: 'include' | 'exclude';
}

// Mapeo de nombres normalizados a patrones de búsqueda
export const COMPANY_PATTERNS: Record<string, string[]> = {
  'REPSOL': ['REPSOL', 'REPSOL AUTOGAS', 'REPSOL BUTANO'],
  'CEPSA': ['CEPSA', 'CEPSA URBAN', 'CEPSA EXPRESS'],
  'BP': ['BP', 'BP OIL', 'BP SERVICE'],
  'GALP': ['GALP', 'GALPENERGIA'],
  'AVIA': ['AVIA'],
  'PETRONOR': ['PETRONOR'],
  'CARREFOUR': ['CARREFOUR', 'CARREFOUR EXPRESS'],
  'ALCAMPO': ['ALCAMPO', 'ALCAMPO SUPERMERCADOS'],
  'E.LECLERC': ['E.LECLERC', 'LECLERC', 'CENTRE LECLERC'],
  'SHELL': ['SHELL', 'SHELL AUTOSERVICIO']
};

export const EMPRESAS_NORMALIZADAS = Object.keys(COMPANY_PATTERNS);

export const TIPO_TO_FUEL_LABEL: Record<FuelType, string> = {
  'Gasolina 95 E5': 'Gasolina 95',
  'Gasolina 98 E5': 'Gasolina 98',
  'Gasóleo A': 'Diésel',
  'Gasóleo Premium': 'Diésel Premium',
  'GLP': 'GLP',
  'all': 'Todos los combustibles'
};

export const FUEL_TYPE_KEYS: Record<string, FuelType> = {
  gasolina95: 'Gasolina 95 E5',
  gasolina98: 'Gasolina 98 E5',
  diesel: 'Gasóleo A',
  dieselPremium: 'Gasóleo Premium',
  glp: 'GLP',
  all: 'all'
};