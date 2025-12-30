// src/app/components/filters/filters.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FiltersComponent } from './filters';  // ← Cambia esto
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

describe('FiltersComponent', () => {  // ← Cambia esto también
  let component: FiltersComponent;  // ← Cambia esto
  let fixture: ComponentFixture<FiltersComponent>;  // ← Cambia esto

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule, FiltersComponent]  // ← Agrega los módulos necesarios
    })
    .compileComponents();

    fixture = TestBed.createComponent(FiltersComponent);  // ← Cambia esto
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
