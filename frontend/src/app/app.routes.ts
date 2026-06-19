import { Routes } from '@angular/router';

import { DivisionRemainderPageComponent } from './division-remainder-page/division-remainder-page.component';
import { HomePageComponent } from './home-page/home-page.component';
import { PlustableEquationsPageComponent } from './plustable-equations-page/plustable-equations-page.component';
import { PlustablePageComponent } from './plustable-page/plustable-page.component';
import { TimestablePageComponent } from './timestable-page/timestable-page.component';
import { TimestableEquationsPageComponent } from './timestable-equations-page/timestable-equations-page.component';

export const routes: Routes = [
	{
		path: '',
		component: HomePageComponent
	},
	{
		path: 'timestable',
		component: TimestablePageComponent
	},
	{
		path: 'timestable-equations',
		component: TimestableEquationsPageComponent
	},
	{
		path: 'plustable',
		component: PlustablePageComponent
	},
	{
		path: 'plustable-equations',
		component: PlustableEquationsPageComponent
	},
	{
		path: 'division-remainder',
		component: DivisionRemainderPageComponent
	}
];
