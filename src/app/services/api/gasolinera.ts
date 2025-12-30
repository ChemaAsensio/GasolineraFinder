// src/app/services/api/gasolinera.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, catchError, of, tap } from 'rxjs';
import { Gasolinera } from '../../models/station';
import { Filters, FuelType } from '../../models/filter';
import { Ubicacion } from '../../models/location';
import { CompanyNormalizerService } from '../company-normalizer'; // ← Añade esta importación

@Injectable({
  providedIn: 'root'
})
export class GasolineraService {
  private apiUrl = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes';

  private httpHeaders = new HttpHeaders({
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'GasolineraFinder/1.0'
  });

  constructor(
    private http: HttpClient,
    private companyNormalizer: CompanyNormalizerService // ← Añade esto al constructor
  ) { }

  // Obtener todas las gasolineras
  getGasolineras(): Observable<Gasolinera[]> {
    console.log('🌐 Llamando a API:', `${this.apiUrl}/EstacionesTerrestres/`);
    
    return this.http.get<any>(`${this.apiUrl}/EstacionesTerrestres/`, { 
      headers: this.httpHeaders 
    }).pipe(
      tap(response => {
        console.log('📦 Respuesta API recibida');
        console.log('🔢 Número de gasolineras:', response?.ListaEESSPrecio?.length || 0);
      }),
      map(response => this.transformarDatosAPI(response)),
      catchError(error => {
        console.error('❌ Error en petición HTTP:', error);
        return this.getGasolinerasConFetch();
      })
    );
  }

  private getGasolinerasConFetch(): Observable<Gasolinera[]> {
    return new Observable(observer => {
      console.log('🔧 Usando fetch como fallback...');
      
      fetch('https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/')
        .then(response => response.text())
        .then(text => {
          const cleanedText = text.replace(/^\uFEFF/, '');
          try {
            const data = JSON.parse(cleanedText);
            const gasolineras = this.transformarDatosAPI(data);
            observer.next(gasolineras);
            observer.complete();
          } catch (e) {
            observer.next([]);
            observer.complete();
          }
        })
        .catch(error => {
          observer.next([]);
          observer.complete();
        });
    });
  }

  private transformarDatosAPI(data: any): Gasolinera[] {
    if (!data?.ListaEESSPrecio) {
      console.log('⚠️ No hay ListaEESSPrecio en la respuesta');
      return [];
    }

    const gasolineras = data.ListaEESSPrecio.map((estacion: any) => ({
      id: estacion['IDEESS'] || '',
      rotulo: estacion['Rótulo'] || '',
      direccion: estacion['Dirección'] || '',
      latitud: this.parsearCoordenada(estacion['Latitud']),
      longitud: this.parsearCoordenada(estacion['Longitud (WGS84)']),
      horario: estacion['Horario'] || '',
      municipio: estacion['Municipio'] || '',
      provincia: estacion['Provincia'] || '',
      precioGasolina95: this.parsearPrecio(estacion['Precio Gasolina 95 E5']),
      precioGasolina98: this.parsearPrecio(estacion['Precio Gasolina 98 E5']),
      precioDiesel: this.parsearPrecio(estacion['Precio Gasóleo A']),
      precioDieselPremium: this.parsearPrecio(estacion['Precio Gasóleo Premium']),
      precioGLP: this.parsearPrecio(estacion['Precio Gases licuados del petróleo'])
    }));

    // Filtrar gasolineras con coordenadas inválidas
    const gasolinerasValidas = gasolineras.filter((g: Gasolinera) => 
      g.latitud !== 0 && g.longitud !== 0
    );
    
    console.log(`✅ ${gasolinerasValidas.length} gasolineras válidas`);
    return gasolinerasValidas;
  }

  private parsearCoordenada(coordenada: string): number {
    if (!coordenada || coordenada.trim() === '') return 0;
    const limpia = coordenada.replace(',', '.').trim();
    const numero = parseFloat(limpia);
    return isNaN(numero) ? 0 : numero;
  }

  private parsearPrecio(precio: string): number {
    if (!precio || precio.trim() === '' || precio === 'N/A' || precio === 'N/D') {
      return 0;
    }
    const limpio = precio.replace(',', '.').trim();
    const numero = parseFloat(limpio);
    return isNaN(numero) ? 0 : numero;
  }

  calcularDistancia(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(value: number): number {
    return value * Math.PI / 180;
  }

  filtrarGasolineras(
    gasolineras: Gasolinera[],
    filtros: Filters,
    ubicacionUsuario: Ubicacion
  ): Gasolinera[] {
    console.log('🔧 Aplicando filtros:', filtros);
    console.log(`📍 Ubicación: lat=${ubicacionUsuario.latitud}, lon=${ubicacionUsuario.longitud}`);

    // Si no hay gasolineras, retornar array vacío
    if (!gasolineras || gasolineras.length === 0) {
      console.log('⚠️ No hay gasolineras para filtrar');
      return [];
    }

    let resultado = gasolineras.filter((gasolinera: Gasolinera) => {
      // 1. Calcular distancia desde el usuario
      const distancia = this.calcularDistancia(
        ubicacionUsuario.latitud,
        ubicacionUsuario.longitud,
        gasolinera.latitud,
        gasolinera.longitud
      );
      
      // 2. Filtro de distancia máxima
      if (distancia > filtros.maxDistance) {
        return false;
      }

      // 3. Determinar si el tipo de combustible está disponible
      let tieneCombustible = false;
      let precioRelevante = 0;

      if (filtros.fuelType === 'all') {
        // Para "todos los combustibles", verificar si hay ALGÚN precio disponible
        tieneCombustible = 
          gasolinera.precioGasolina95 > 0 || 
          gasolinera.precioGasolina98 > 0 || 
          gasolinera.precioDiesel > 0 || 
          gasolinera.precioDieselPremium > 0 || 
          gasolinera.precioGLP > 0;
        
        // Para "todos los combustibles" con filtro de precio máximo
        if (tieneCombustible && filtros.maxPrice > 0) {
          const preciosDisponibles = [
            gasolinera.precioGasolina95,
            gasolinera.precioGasolina98,
            gasolinera.precioDiesel,
            gasolinera.precioDieselPremium,
            gasolinera.precioGLP
          ].filter(p => p > 0);
          
          if (preciosDisponibles.length > 0) {
            const precioMinimo = Math.min(...preciosDisponibles);
            if (precioMinimo > filtros.maxPrice) {
              return false;
            }
          }
        }
      } else {
        // Para un tipo de combustible específico
        precioRelevante = this.obtenerPrecioPorTipo(gasolinera, filtros.fuelType);
        tieneCombustible = precioRelevante > 0;
        
        if (!tieneCombustible) {
          return false;
        }
        
        // Filtro de precio máximo para combustible específico
        if (filtros.maxPrice > 0 && precioRelevante > filtros.maxPrice) {
          return false;
        }
      }

      // 4. Filtro de empresas con normalización mejorada
      if (filtros.companies && filtros.companies.length > 0) {
        const empresaNormalizada = this.companyNormalizer.normalizeCompanyName(gasolinera.rotulo);
        let pertenece = false;
        
        if (empresaNormalizada) {
          // Verificar si alguna de las empresas seleccionadas coincide con la normalizada
          pertenece = filtros.companies.some(empresa => 
            this.companyNormalizer.belongsToCompany(gasolinera.rotulo, empresa)
          );
        } else {
          // Si no se puede normalizar, verificar coincidencia exacta
          pertenece = filtros.companies.includes(gasolinera.rotulo);
        }
        
        if (filtros.companyMode === 'include') {
          // Modo INCLUIR: mostrar SOLO las empresas seleccionadas
          if (!pertenece) {
            return false;
          }
        } else {
          // Modo EXCLUIR: excluir las empresas seleccionadas
          if (pertenece) {
            return false;
          }
        }
      }

      // 5. Filtro de "solo abiertas" - VERSIÓN MEJORADA
      if (filtros.onlyOpen) {
        if (!this.estaAbiertaSegunHorario(gasolinera.horario || '')) {
          return false;
        }
      }

      return true;
    });

    console.log(`✅ ${resultado.length} gasolineras después de filtros (de ${gasolineras.length})`);

    // Si no hay resultados, hacer un análisis de por qué
    if (resultado.length === 0) {
      this.analizarPorQueNoHayResultados(gasolineras, filtros, ubicacionUsuario);
    }

    return resultado;
  }

  // Función para verificar si está abierto según horario - VERSIÓN MEJORADA
  private estaAbiertaSegunHorario(horario: string): boolean {
    if (!horario || horario.trim() === '') {
      return true; // Sin información, asumir abierto
    }
    
    const horarioLower = horario.toLowerCase();
    
    // Casos especiales - DEFINITIVAMENTE ABIERTOS
    const indicadoresAbierto24h = [
      '24h',
      '24 horas',
      '24horas',
      'siempre abierto',
      'abierto 24',
      'abierto todo el día'
    ];
    
    // Casos especiales - DEFINITIVAMENTE CERRADOS
    const indicadoresCerrado = [
      'cerrado',
      'cerrada', 
      'cl.',
      'cl ',
      'c/',
      'permanente',
      'clausurada',
      'fuera de servicio',
      'no disponible'
    ];
    
    // Verificar si está claramente cerrado
    const estaClaramenteCerrado = indicadoresCerrado.some(indicador => 
      horarioLower.includes(indicador)
    );
    
    // Verificar si está abierto 24h
    const estaAbierto24h = indicadoresAbierto24h.some(indicador => 
      horarioLower.includes(indicador)
    );
    
    // Si está claramente cerrado y no está abierto 24h, filtrar
    if (estaClaramenteCerrado && !estaAbierto24h) {
      return false;
    }
    
    // Si está abierto 24h, mostrar
    if (estaAbierto24h) {
      return true;
    }
    
    // Para horarios específicos (ej: "L-D: 07:00-22:00"), podríamos verificar hora actual
    // Pero por ahora, si no es claramente cerrado, lo mostramos
    return true;
  }

  private analizarPorQueNoHayResultados(
    gasolineras: Gasolinera[],
    filtros: Filters,
    ubicacionUsuario: Ubicacion
  ): void {
    console.log('🔍 Analizando por qué no hay resultados...');
    
    // Contar gasolineras por combustible
    const conteoCombustible: Record<string, number> = {};
    const tipos = ['Gasolina 95 E5', 'Gasolina 98 E5', 'Gasóleo A', 'Gasóleo Premium', 'GLP'] as const;
    
    tipos.forEach(tipo => {
      const disponibles = gasolineras.filter(g => 
        this.obtenerPrecioPorTipo(g, tipo as Exclude<FuelType, 'all'>) > 0
      );
      conteoCombustible[tipo] = disponibles.length;
    });
    
    console.log('Disponibilidad por combustible:', conteoCombustible);
    
    // Analizar distancias
    const distancias = gasolineras.map(g => 
      this.calcularDistancia(
        ubicacionUsuario.latitud,
        ubicacionUsuario.longitud,
        g.latitud,
        g.longitud
      )
    ).filter(d => !isNaN(d));
    
    if (distancias.length > 0) {
      const distanciaMin = Math.min(...distancias);
      const distanciaMax = Math.max(...distancias);
      const distanciaProm = distancias.reduce((a, b) => a + b, 0) / distancias.length;
      
      console.log(`📏 Distancias: min=${distanciaMin.toFixed(2)}km, max=${distanciaMax.toFixed(2)}km, prom=${distanciaProm.toFixed(2)}km`);
      console.log(`📏 Filtro distancia: ${filtros.maxDistance}km`);
    }
    
    // Analizar precios si hay un combustible específico
    if (filtros.fuelType !== 'all') {
      const precios = gasolineras
        .map(g => this.obtenerPrecioPorTipo(g, filtros.fuelType as Exclude<FuelType, 'all'>))
        .filter(p => p > 0);
      
      if (precios.length > 0) {
        const precioMin = Math.min(...precios);
        const precioMax = Math.max(...precios);
        const precioProm = precios.reduce((a, b) => a + b, 0) / precios.length;
        
        console.log(`💰 ${filtros.fuelType}: min=${precioMin.toFixed(3)}, max=${precioMax.toFixed(3)}, prom=${precioProm.toFixed(3)}`);
        console.log(`💰 Filtro precio: ${filtros.maxPrice > 0 ? filtros.maxPrice : 'Sin límite'}`);
      } else {
        console.log(`💰 ${filtros.fuelType}: No hay precios disponibles en la zona`);
      }
    }
  }

  private getCampoPorTipo(fuelType: Exclude<FuelType, 'all'>): keyof Gasolinera {
    switch (fuelType) {
      case 'Gasolina 95 E5': return 'precioGasolina95';
      case 'Gasolina 98 E5': return 'precioGasolina98';
      case 'Gasóleo A': return 'precioDiesel';
      case 'Gasóleo Premium': return 'precioDieselPremium';
      case 'GLP': return 'precioGLP';
      default: return 'precioGasolina95';
    }
  }

  private obtenerPrecioPorTipo(gasolinera: Gasolinera, fuelType: Exclude<FuelType, 'all'>): number {
    switch (fuelType) {
      case 'Gasolina 95 E5': return gasolinera.precioGasolina95;
      case 'Gasolina 98 E5': return gasolinera.precioGasolina98;
      case 'Gasóleo A': return gasolinera.precioDiesel;
      case 'Gasóleo Premium': return gasolinera.precioDieselPremium;
      case 'GLP': return gasolinera.precioGLP;
      default: return 0;
    }
  }

  // Método para obtener estadísticas de la zona
  obtenerEstadisticasZona(
    gasolineras: Gasolinera[],
    ubicacionUsuario: Ubicacion,
    radioKm: number = 50
  ): any {
    const gasolinerasCercanas = gasolineras.filter(g => {
      const distancia = this.calcularDistancia(
        ubicacionUsuario.latitud,
        ubicacionUsuario.longitud,
        g.latitud,
        g.longitud
      );
      return distancia <= radioKm;
    });

    const estadisticas = {
      total: gasolinerasCercanas.length,
      conGasolina95: gasolinerasCercanas.filter(g => g.precioGasolina95 > 0).length,
      conGasolina98: gasolinerasCercanas.filter(g => g.precioGasolina98 > 0).length,
      conDiesel: gasolinerasCercanas.filter(g => g.precioDiesel > 0).length,
      conDieselPremium: gasolinerasCercanas.filter(g => g.precioDieselPremium > 0).length,
      conGLP: gasolinerasCercanas.filter(g => g.precioGLP > 0).length,
    };

    console.log(`📊 Estadísticas en ${radioKm}km:`, estadisticas);
    return estadisticas;
  }
}