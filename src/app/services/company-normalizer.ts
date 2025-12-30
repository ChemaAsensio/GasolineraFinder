// src/app/services/company-normalizer.ts
import { Injectable } from '@angular/core';
import { COMPANY_PATTERNS, EMPRESAS_NORMALIZADAS } from '../models/filter';

@Injectable({
  providedIn: 'root'
})
export class CompanyNormalizerService {
  
  // Normalizar el nombre de una empresa (de "BP BILBAO" a "BP")
  normalizeCompanyName(companyName: string): string | null {
    if (!companyName || companyName.trim() === '') {
      return null;
    }
    
    const nombreUpper = companyName.toUpperCase().trim();
    
    // Buscar coincidencias exactas o parciales
    for (const [empresaNormalizada, patrones] of Object.entries(COMPANY_PATTERNS)) {
      for (const patron of patrones) {
        if (nombreUpper.includes(patron)) {
          return empresaNormalizada;
        }
      }
    }
    
    return null;
  }
  
  // Verificar si una empresa pertenece a una empresa normalizada
  belongsToCompany(gasolineraName: string, empresaNormalizada: string): boolean {
    const normalized = this.normalizeCompanyName(gasolineraName);
    return normalized === empresaNormalizada;
  }
  
  // Extraer todas las empresas únicas normalizadas de una lista de gasolineras
  extractNormalizedCompanies(gasolineras: any[]): string[] {
    const empresasSet = new Set<string>();
    
    gasolineras.forEach(g => {
      const normalized = this.normalizeCompanyName(g.rotulo);
      if (normalized) {
        empresasSet.add(normalized);
      }
    });
    
    return Array.from(empresasSet).sort();
  }
  
  // Filtrar gasolineras por empresas normalizadas
  filterByNormalizedCompanies(
    gasolineras: any[],
    empresasSeleccionadas: string[],
    mode: 'include' | 'exclude'
  ): any[] {
    return gasolineras.filter(gasolinera => {
      const empresaNormalizada = this.normalizeCompanyName(gasolinera.rotulo);
      
      // Si no se puede normalizar, tratar como empresa independiente
      if (!empresaNormalizada) {
        // En modo INCLUIR: si no está normalizada y no está seleccionada, excluir
        // En modo EXCLUIR: si no está normalizada, incluir (a menos que esté en la lista)
        if (mode === 'include') {
          return empresasSeleccionadas.includes(gasolinera.rotulo);
        } else {
          return !empresasSeleccionadas.includes(gasolinera.rotulo);
        }
      }
      
      // Verificar si la empresa normalizada está en la lista de seleccionadas
      const estaSeleccionada = empresasSeleccionadas.some(empresa => 
        this.belongsToCompany(gasolinera.rotulo, empresa)
      );
      
      if (mode === 'include') {
        return estaSeleccionada;
      } else {
        return !estaSeleccionada;
      }
    });
  }
}