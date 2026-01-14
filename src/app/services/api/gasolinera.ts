// src/app/services/api/gasolinera.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, catchError, of, tap } from 'rxjs';
import { Gasolinera } from '../../models/station';
import { Filters, FuelType } from '../../models/filter';
import { Ubicacion } from '../../models/location';
import { CompanyNormalizerService } from '../company-normalizer';

@Injectable({ providedIn: 'root' })
export class GasolineraService {
  private apiUrl =
    'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes';

  // ✅ Para GET no hace falta Content-Type (y puede dar problemas)
  // ✅ Importante: NO se puede setear User-Agent desde el navegador.
  private httpHeaders = new HttpHeaders({
    Accept: 'application/json',
  });

  constructor(
    private http: HttpClient,
    private companyNormalizer: CompanyNormalizerService
  ) {}

  // Obtener todas las gasolineras
  getGasolineras(): Observable<Gasolinera[]> {
    const url = `${this.apiUrl}/EstacionesTerrestres/`;
    console.log('🌐 Llamando a API:', url);

    return this.http.get<any>(url, { headers: this.httpHeaders }).pipe(
      tap((response) => {
        console.log('📦 Respuesta API recibida');
        console.log(
          '🔢 Número de gasolineras:',
          response?.ListaEESSPrecio?.length || 0
        );
      }),
      map((response) => this.transformarDatosAPI(response)),
      catchError((error) => {
        console.error('❌ Error en petición HTTP:', error);
        return this.getGasolinerasConFetch();
      })
    );
  }

  private getGasolinerasConFetch(): Observable<Gasolinera[]> {
    return new Observable((observer) => {
      console.log('🔧 Usando fetch como fallback...');

      fetch(`${this.apiUrl}/EstacionesTerrestres/`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          // ⚠️ NO poner User-Agent aquí. El navegador lo bloqueará igual.
        },
      })
        .then((response) => response.text())
        .then((text) => {
          const cleanedText = text.replace(/^\uFEFF/, '');
          try {
            const data = JSON.parse(cleanedText);
            const gasolineras = this.transformarDatosAPI(data);
            observer.next(gasolineras);
            observer.complete();
          } catch {
            observer.next([]);
            observer.complete();
          }
        })
        .catch(() => {
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

    const gasolineras: Gasolinera[] = data.ListaEESSPrecio.map((estacion: any) => {
      const precioGasolina95 = this.parsearPrecio(estacion['Precio Gasolina 95 E5']);
      const precioGasolina98 = this.parsearPrecio(estacion['Precio Gasolina 98 E5']);
      const precioDiesel = this.parsearPrecio(estacion['Precio Gasóleo A']);
      const precioDieselPremium = this.parsearPrecio(estacion['Precio Gasóleo Premium']);
      const precioGLP = this.parsearPrecio(estacion['Precio Gases licuados del petróleo']);

      const precios = {
        'Gasolina 95 E5': precioGasolina95 || null,
        'Gasolina 98 E5': precioGasolina98 || null,
        'Gasóleo A': precioDiesel || null,
        'Gasóleo Premium': precioDieselPremium || null,
        GLP: precioGLP || null,
      };

      return {
        id: estacion['IDEESS'] || '',
        rotulo: estacion['Rótulo'] || '',
        direccion: estacion['Dirección'] || '',
        direccionCompleta: estacion['Dirección'] || '',
        calle: estacion['Calle'] || '',
        numero: estacion['Numero'] || '',
        municipio: estacion['Municipio'] || '',
        provincia: estacion['Provincia'] || '',
        codigoPostal: estacion['C.P.'] || '',
        latitud: this.parsearCoordenada(estacion['Latitud']),
        longitud: this.parsearCoordenada(estacion['Longitud (WGS84)']),
        localidad: estacion['Localidad'] || '',
        margen: estacion['Margen'] || '',
        tipoVenta: estacion['Tipo Venta'] || '',
        horario: estacion['Horario'] || '',
        remision: estacion['Remisión'] || '',
        bioEtanol: estacion['BioEtanol'] || '',
        esterMetilico: estacion['Éster metílico'] || '',
        porcentajeBioEtanol: estacion['% BioEtanol'] || '',
        porcentajeEsterMetilico: estacion['% Éster metílico'] || '',

        // ✅ unificados
        precios,

        // ✅ precios “planos”
        precioGasolina95,
        precioGasolina98,
        precioDiesel,
        precioDieselPremium,
        precioGLP,
      };
    });

    // Filtrar gasolineras con coordenadas inválidas
    const gasolinerasValidas = gasolineras.filter(
      (g: Gasolinera) => g.latitud !== 0 && g.longitud !== 0
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
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(value: number): number {
    return (value * Math.PI) / 180;
  }

  filtrarGasolineras(
    gasolineras: Gasolinera[],
    filtros: Filters,
    ubicacionUsuario: Ubicacion
  ): Gasolinera[] {
    console.log('🔧 Aplicando filtros:', filtros);
    console.log(`📍 Ubicación: lat=${ubicacionUsuario.latitud}, lon=${ubicacionUsuario.longitud}`);

    if (!gasolineras || gasolineras.length === 0) {
      console.log('⚠️ No hay gasolineras para filtrar');
      return [];
    }

    const resultado = gasolineras.filter((gasolinera: Gasolinera) => {
      const distancia = this.calcularDistancia(
        ubicacionUsuario.latitud,
        ubicacionUsuario.longitud,
        gasolinera.latitud,
        gasolinera.longitud
      );

      if (distancia > filtros.maxDistance) return false;

      // Combustible + precio
      if (filtros.fuelType === 'all') {
        const preciosDisponibles = [
          gasolinera.precioGasolina95,
          gasolinera.precioGasolina98,
          gasolinera.precioDiesel,
          gasolinera.precioDieselPremium,
          gasolinera.precioGLP,
        ].filter((p) => p > 0);

        if (preciosDisponibles.length === 0) return false;

        if (filtros.maxPrice > 0) {
          const precioMinimo = Math.min(...preciosDisponibles);
          if (precioMinimo > filtros.maxPrice) return false;
        }
      } else {
        const precioRelevante = this.obtenerPrecioPorTipo(gasolinera, filtros.fuelType);
        if (!(precioRelevante > 0)) return false;
        if (filtros.maxPrice > 0 && precioRelevante > filtros.maxPrice) return false;
      }

      // Empresas (include/exclude) con normalización
      if (filtros.companies && filtros.companies.length > 0) {
        const pertenece = filtros.companies.some((empresa) =>
          this.companyNormalizer.belongsToCompany(gasolinera.rotulo, empresa)
        );

        if (filtros.companyMode === 'include' && !pertenece) return false;
        if (filtros.companyMode === 'exclude' && pertenece) return false;
      }

      // Horario
      if (filtros.onlyOpen) {
        if (!this.estaAbiertaSegunHorario(gasolinera.horario || '')) return false;
      }

      return true;
    });

    console.log(`✅ ${resultado.length} gasolineras después de filtros (de ${gasolineras.length})`);

    if (resultado.length === 0) {
      this.analizarPorQueNoHayResultados(gasolineras, filtros, ubicacionUsuario);
    }

    return resultado;
  }

  private estaAbiertaSegunHorario(horario: string): boolean {
    if (!horario || horario.trim() === '') return true;

    const horarioLower = horario.toLowerCase();

    const indicadoresAbierto24h = ['24h', '24 horas', '24horas', 'siempre abierto', 'abierto 24', 'abierto todo el día'];

    const indicadoresCerrado = [
      'cerrado', 'cerrada', 'cl.', 'cl ', 'c/', 'permanente', 'clausurada', 'fuera de servicio', 'no disponible',
    ];

    const estaClaramenteCerrado = indicadoresCerrado.some((x) => horarioLower.includes(x));
    const estaAbierto24h = indicadoresAbierto24h.some((x) => horarioLower.includes(x));

    if (estaClaramenteCerrado && !estaAbierto24h) return false;
    if (estaAbierto24h) return true;

    return true;
  }

  private analizarPorQueNoHayResultados(
    gasolineras: Gasolinera[],
    filtros: Filters,
    ubicacionUsuario: Ubicacion
  ): void {
    console.log('🔍 Analizando por qué no hay resultados...');

    const conteoCombustible: Record<string, number> = {};
    const tipos = ['Gasolina 95 E5', 'Gasolina 98 E5', 'Gasóleo A', 'Gasóleo Premium', 'GLP'] as const;

    tipos.forEach((tipo) => {
      const disponibles = gasolineras.filter((g) => this.obtenerPrecioPorTipo(g, tipo) > 0);
      conteoCombustible[tipo] = disponibles.length;
    });

    console.log('Disponibilidad por combustible:', conteoCombustible);

    const distancias = gasolineras
      .map((g) =>
        this.calcularDistancia(
          ubicacionUsuario.latitud,
          ubicacionUsuario.longitud,
          g.latitud,
          g.longitud
        )
      )
      .filter((d) => !isNaN(d));

    if (distancias.length > 0) {
      const distanciaMin = Math.min(...distancias);
      const distanciaMax = Math.max(...distancias);
      const distanciaProm = distancias.reduce((a, b) => a + b, 0) / distancias.length;

      console.log(
        `📏 Distancias: min=${distanciaMin.toFixed(2)}km, max=${distanciaMax.toFixed(2)}km, prom=${distanciaProm.toFixed(2)}km`
      );
      console.log(`📏 Filtro distancia: ${filtros.maxDistance}km`);
    }

    if (filtros.fuelType !== 'all') {
      const precios = gasolineras
        .map((g) => this.obtenerPrecioPorTipo(g, filtros.fuelType))
        .filter((p) => p > 0);

      if (precios.length > 0) {
        const precioMin = Math.min(...precios);
        const precioMax = Math.max(...precios);
        const precioProm = precios.reduce((a, b) => a + b, 0) / precios.length;

        console.log(
          `💰 ${filtros.fuelType}: min=${precioMin.toFixed(3)}, max=${precioMax.toFixed(3)}, prom=${precioProm.toFixed(3)}`
        );
        console.log(`💰 Filtro precio: ${filtros.maxPrice > 0 ? filtros.maxPrice : 'Sin límite'}`);
      } else {
        console.log(`💰 ${filtros.fuelType}: No hay precios disponibles en la zona`);
      }
    }
  }

  private obtenerPrecioPorTipo(gasolinera: Gasolinera, fuelType: FuelType): number {
    switch (fuelType) {
      case 'Gasolina 95 E5': return gasolinera.precioGasolina95;
      case 'Gasolina 98 E5': return gasolinera.precioGasolina98;
      case 'Gasóleo A': return gasolinera.precioDiesel;
      case 'Gasóleo Premium': return gasolinera.precioDieselPremium;
      case 'GLP': return gasolinera.precioGLP;
      case 'all': {
        const precios = [
          gasolinera.precioGasolina95,
          gasolinera.precioGasolina98,
          gasolinera.precioDiesel,
          gasolinera.precioDieselPremium,
          gasolinera.precioGLP
        ].filter(p => p > 0);

        return precios.length ? Math.min(...precios) : 0;
      }
      default:
        return 0;
    }
  }

  obtenerEstadisticasZona(
    gasolineras: Gasolinera[],
    ubicacionUsuario: Ubicacion,
    radioKm: number = 50
  ): any {
    const gasolinerasCercanas = gasolineras.filter((g) => {
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
      conGasolina95: gasolinerasCercanas.filter((g) => g.precioGasolina95 > 0).length,
      conGasolina98: gasolinerasCercanas.filter((g) => g.precioGasolina98 > 0).length,
      conDiesel: gasolinerasCercanas.filter((g) => g.precioDiesel > 0).length,
      conDieselPremium: gasolinerasCercanas.filter((g) => g.precioDieselPremium > 0).length,
      conGLP: gasolinerasCercanas.filter((g) => g.precioGLP > 0).length,
    };

    console.log(`📊 Estadísticas en ${radioKm}km:`, estadisticas);
    return estadisticas;
  }
}
