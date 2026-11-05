import { Routes } from '@angular/router';
import { permissionGuard as can } from '../../core/guards/auth.guards';

/**
 * One admin panel for every admin role. Each route needs a permission (mirroring the API);
 * without it the guard sends the admin to their own dashboard (ROLE_META[role].home).
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Admin dashboard | BiteBox',
    canActivate: [can('admins:manage')],
    loadComponent: () => import('./dashboard/admin-dashboard').then((m) => m.AdminDashboard),
  },

  // Super admin
  {
    path: 'admins',
    title: 'Admin management | BiteBox Admin',
    canActivate: [can('admins:manage')],
    loadComponent: () => import('./admins/admin-staff').then((m) => m.AdminStaff),
  },
  {
    path: 'audit-log',
    title: 'Audit log | BiteBox Admin',
    canActivate: [can('audit:view')],
    loadComponent: () => import('./audit-log/audit-log').then((m) => m.AuditLogPage),
  },
  {
    path: 'users',
    title: 'Users | BiteBox Admin',
    canActivate: [can('users:manage')],
    loadComponent: () => import('./users/admin-users').then((m) => m.AdminUsers),
  },
  {
    path: 'categories',
    title: 'Food categories | BiteBox Admin',
    canActivate: [can('catalog:manage')],
    loadComponent: () => import('./categories/admin-categories').then((m) => m.AdminCategories),
  },
  {
    path: 'coupons',
    title: 'Coupons | BiteBox Admin',
    canActivate: [can('catalog:manage')],
    loadComponent: () => import('./coupons/admin-coupons').then((m) => m.AdminCoupons),
  },

  // Operations
  {
    path: 'operations',
    title: 'Operations | BiteBox Admin',
    canActivate: [can('operations:view')],
    loadComponent: () =>
      import('./operations/dashboard/operations-dashboard').then((m) => m.OperationsDashboardPage),
  },
  {
    path: 'operations/monitoring',
    title: 'Order monitoring | BiteBox Admin',
    canActivate: [can('operations:view')],
    loadComponent: () =>
      import('./operations/monitoring/order-monitoring').then((m) => m.OrderMonitoring),
  },
  {
    path: 'operations/reports',
    title: 'Delivery performance | BiteBox Admin',
    canActivate: [can('operations:view')],
    loadComponent: () =>
      import('./operations/performance/delivery-performance').then((m) => m.DeliveryPerformancePage),
  },
  {
    path: 'orders',
    title: 'Orders | BiteBox Admin',
    canActivate: [can('orders:view')],
    loadComponent: () => import('./orders/admin-orders').then((m) => m.AdminOrders),
  },
  {
    path: 'restaurants',
    title: 'Restaurants | BiteBox Admin',
    canActivate: [can('restaurants:manage')],
    loadComponent: () => import('./restaurants/admin-restaurants').then((m) => m.AdminRestaurants),
  },
  {
    path: 'restaurants/:id',
    title: 'Review restaurant | BiteBox Admin',
    canActivate: [can('restaurants:manage')],
    loadComponent: () =>
      import('./restaurant-review/admin-restaurant-review').then((m) => m.AdminRestaurantReview),
  },
  {
    path: 'foods',
    title: 'Food items | BiteBox Admin',
    canActivate: [can('restaurants:manage')],
    loadComponent: () => import('./foods/admin-foods').then((m) => m.AdminFoods),
  },
  {
    path: 'delivery-partners',
    title: 'Delivery partners | BiteBox Admin',
    canActivate: [can('riders:manage')],
    loadComponent: () =>
      import('./delivery-partners/admin-delivery-partners').then((m) => m.AdminDeliveryPartners),
  },

  // Finance
  {
    path: 'finance',
    title: 'Finance | BiteBox Admin',
    canActivate: [can('finance:view')],
    loadComponent: () =>
      import('./finance/dashboard/finance-dashboard').then((m) => m.FinanceDashboardPage),
  },
  {
    path: 'finance/payouts/:type',
    title: 'Payouts | BiteBox Admin',
    canActivate: [can('payouts:manage')],
    loadComponent: () => import('./finance/payouts/payouts').then((m) => m.PayoutsPage),
  },
  {
    path: 'finance/refunds',
    title: 'Refunds | BiteBox Admin',
    canActivate: [can('finance:view')],
    loadComponent: () => import('./finance/refunds/refunds').then((m) => m.RefundsPage),
  },
  {
    path: 'finance/commission',
    title: 'Commission | BiteBox Admin',
    canActivate: [can('finance:view')],
    loadComponent: () => import('./finance/commission/commission').then((m) => m.CommissionPage),
  },
  {
    path: 'payments',
    title: 'Transactions | BiteBox Admin',
    canActivate: [can('finance:view')],
    loadComponent: () => import('./payments/admin-payments').then((m) => m.AdminPayments),
  },
  {
    path: 'reports',
    title: 'Financial reports | BiteBox Admin',
    canActivate: [can('finance:view')],
    loadComponent: () => import('./reports/admin-reports').then((m) => m.AdminReports),
  },

  // Support
  {
    path: 'support',
    title: 'Support | BiteBox Admin',
    canActivate: [can('support:manage')],
    loadComponent: () =>
      import('./support/dashboard/support-dashboard').then((m) => m.SupportDashboardPage),
  },
  {
    path: 'support/queue/:view',
    title: 'Support tickets | BiteBox Admin',
    canActivate: [can('support:manage')],
    loadComponent: () => import('./support/tickets/support-tickets').then((m) => m.SupportTickets),
  },
  {
    path: 'support/ticket/:id',
    title: 'Support ticket | BiteBox Admin',
    canActivate: [can('support:manage')],
    loadComponent: () => import('./support/ticket/support-ticket').then((m) => m.SupportTicketPage),
  },
  {
    path: 'reviews',
    title: 'Reviews | BiteBox Admin',
    canActivate: [can('reviews:moderate')],
    loadComponent: () => import('./reviews/admin-reviews').then((m) => m.AdminReviews),
  },

  // Everyone in the panel
  {
    path: 'notifications',
    title: 'Notifications | BiteBox Admin',
    loadComponent: () => import('../notifications/notifications-page').then((m) => m.NotificationsPage),
  },
  {
    path: 'profile',
    title: 'Profile | BiteBox Admin',
    loadComponent: () => import('../profile/profile').then((m) => m.Profile),
  },
];
