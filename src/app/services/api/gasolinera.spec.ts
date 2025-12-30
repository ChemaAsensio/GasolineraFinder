import { TestBed } from '@angular/core/testing';
import { GeolocationService } from '../../services/geolocation';

describe('GeolocationService', () => {
  let service: GeolocationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GeolocationService],
    });
    service = TestBed.inject(GeolocationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
