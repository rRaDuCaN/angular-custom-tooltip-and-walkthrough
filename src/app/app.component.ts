import { TakeTheTourStore } from './custom-modules/app-walkthrough.module';
import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  title = 'angular-custom-tooltip-and-walkthrough';

  constructor(private _takeTheTourStore: TakeTheTourStore) {}

  toggleTakeTheTour() {
    this._takeTheTourStore.toggleTourBtn();
  }
}
