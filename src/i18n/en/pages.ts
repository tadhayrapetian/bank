/** English master dictionary — feature pages (one module per file, each owning its namespaces). */
import { dashboard } from './pages/dashboard';
import { accounts } from './pages/accounts';
import { payments } from './pages/payments';
import { cards } from './pages/cards';
import { docs } from './pages/docs';
import { growth } from './pages/growth';
import { services } from './pages/services';
import { staff } from './pages/staff';
import { personal } from './pages/personal';

export const pages = { ...dashboard, ...accounts, ...payments, ...cards, ...docs, ...growth, ...services, ...staff, ...personal };
