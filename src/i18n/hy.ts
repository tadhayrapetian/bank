/** hy dictionary — mirrors the English master file by file. */
import type { DeepPartial } from './index';
import type { en } from './en';
import { core } from './hy/core';
import { messages } from './hy/messages';
import { shell } from './hy/shell';
import { dashboard } from './hy/pages/dashboard';
import { accounts } from './hy/pages/accounts';
import { payments } from './hy/pages/payments';
import { cards } from './hy/pages/cards';
import { docs } from './hy/pages/docs';
import { growth } from './hy/pages/growth';
import { services } from './hy/pages/services';
import { staff } from './hy/pages/staff';
import { personal } from './hy/pages/personal';

export const hy: DeepPartial<typeof en> = { ...core, ...messages, ...shell, ...dashboard, ...accounts, ...payments, ...cards, ...docs, ...growth, ...services, ...staff, ...personal };
