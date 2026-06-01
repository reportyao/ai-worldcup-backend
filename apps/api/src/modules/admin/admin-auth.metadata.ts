import { SetMetadata } from '@nestjs/common';

export const ADMIN_PUBLIC_ROUTE_KEY = 'admin:public-route';

export const AdminPublic = () => SetMetadata(ADMIN_PUBLIC_ROUTE_KEY, true);
