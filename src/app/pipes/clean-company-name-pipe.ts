import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'cleanCompanyName',
})
export class CleanCompanyNamePipe implements PipeTransform {

  transform(value: unknown, ...args: unknown[]): unknown {
    return null;
  }

}
