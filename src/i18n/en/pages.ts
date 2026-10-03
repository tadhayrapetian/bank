/** English master dictionary — feature pages (one module per file). */
import { docs } from './pages/docs';
import { money } from './pages/money';
import { growth } from './pages/growth';
import { services } from './pages/services';
import { staff } from './pages/staff';

export const pages = { ...docs, ...money, ...growth, ...services, ...staff };
