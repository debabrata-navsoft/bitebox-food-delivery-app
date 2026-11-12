import { RatingSummary } from './review.models';
import { Pagination } from './api.models';
import { Order, OrderStatus, RiderCard, VehicleType } from './checkout.models';

export const ACTIVE_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'assigned',
  'picked_up',
  'on_the_way',
];

export const TRACKED_STATUSES: OrderStatus[] = ['assigned', 'picked_up', 'on_the_way'];

export type OrderCounts = Partial<Record<OrderStatus, number>>;

export interface RestaurantOrder extends Omit<Order, 'deliveryAddress' | 'rider'> {
  deliveryAddress: { recipientName: string; area?: string; city: string };
  riderAssigned: boolean;
  respondBy?: string;
  pickupBy?: string;
}

export interface RestaurantActiveOrders {
  items: RestaurantOrder[];
  counts: OrderCounts;
}

export interface RestaurantOrderHistory {
  items: RestaurantOrder[];
  pagination: Pagination;
}

export type RestaurantAction = 'confirmed' | 'rejected' | 'preparing' | 'ready_for_pickup';

// Rider
export interface RiderProfile {
  id: string;
  vehicleType?: VehicleType;
  vehicleNumber?: string;
  isOnline: boolean;
  locationUpdatedAt?: string;
  completedDeliveries: number;
  rating?: RatingSummary;
}

export interface RiderOrder extends Omit<Order, 'deliveryAddress' | 'rider' | 'cancellation'> {
  deliveryAddress: Partial<Order['deliveryAddress']> & {
    location: { type: 'Point'; coordinates: [number, number] };
  };
  offerExpiresAt: string | null;
  offerWindowSeconds: number;
  /** What the delivery pays the rider (Django API; absent from the Node API). */
  estimatedEarningsPaise?: number;
  /** Straight-line metres from the rider's last GPS fix to the restaurant (offers only; Django). */
  pickupDistanceMeters?: number | null;
}

/** GET /delivery/stats (Django API only). Money in paise. */
export interface RiderStats {
  today: { deliveries: number; earningsPaise: number };
  week: { deliveries: number; earningsPaise: number };
  total: { deliveries: number; earningsPaise: number };
  rating: { average: number; count: number };
}

export interface RiderDashboard {
  profile: RiderProfile;
  offer: RiderOrder | null;
  activeOrder: RiderOrder | null;
}

export type RiderAction = 'picked_up' | 'on_the_way' | 'delivered';

// Admin
export interface AdminOrderList {
  items: Order[];
  pagination: Pagination;
  counts: OrderCounts;
}

export interface AdminOrder extends Order {
  offer: { rider: RiderCard | null; expiresAt: string } | null;
}

export interface AdminRider {
  id: string;
  name: string;
  email: string;
  phone?: string;
  status: 'active' | 'suspended';
  createdAt: string;
  vehicleType: VehicleType | null;
  vehicleNumber: string | null;
  isOnline: boolean;
  locationUpdatedAt: string | null;
  completedDeliveries: number;
  rating: RatingSummary | null;
  activeOrder: { id: string; orderNumber: string; status: OrderStatus } | null;
}
