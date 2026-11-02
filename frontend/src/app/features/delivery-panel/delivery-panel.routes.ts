import { Routes } from '@angular/router';

export const DELIVERY_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Delivery dashboard | BiteBox',
    loadComponent: () => import('./dashboard/delivery-dashboard').then((m) => m.DeliveryDashboard),
  },
  {
    path: 'profile',
    title: 'Profile | BiteBox Delivery',
    loadComponent: () => import('../profile/profile').then((m) => m.Profile),
  },
];
