import { Routes } from '@angular/router';

import { DataProtectionNoticeComponent } from './data-protection-notice/data-protection-notice.component';
import { DivisionRemainderPageComponent } from './division-remainder-page/division-remainder-page.component';
import { HomePageComponent } from './home-page/home-page.component';
import { ImprintComponent } from './imprint/imprint.component';
import { PlustableEquationsPageComponent } from './plustable-equations-page/plustable-equations-page.component';
import { PlustablePageComponent } from './plustable-page/plustable-page.component';
import { TimestablePageComponent } from './timestable-page/timestable-page.component';
import { TimestableEquationsPageComponent } from './timestable-equations-page/timestable-equations-page.component';
import { WordsPageComponent } from './words-page/words-page.component';

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
	},
	{
		path: 'words',
		component: WordsPageComponent
	},
	{
		path: 'impressum',
		component: ImprintComponent
	},
	{
		path: 'datenschutzerklaerung',
		component: DataProtectionNoticeComponent
	}
];
