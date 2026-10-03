/** ru dictionary — mirrors the English master file by file. */
import type { DeepPartial } from './index';
import type { en } from './en';
import { core } from './ru/core';
import { messages } from './ru/messages';
import { shell } from './ru/shell';
import { dashboard } from './ru/pages/dashboard';
import { accounts } from './ru/pages/accounts';
import { payments } from './ru/pages/payments';
import { cards } from './ru/pages/cards';
import { docs } from './ru/pages/docs';
import { growth } from './ru/pages/growth';
import { services } from './ru/pages/services';
import { staff } from './ru/pages/staff';
import { personal } from './ru/pages/personal';

export const ru: DeepPartial<typeof en> = { ...core, ...messages, ...shell, ...dashboard, ...accounts, ...payments, ...cards, ...docs, ...growth, ...services, ...staff, ...personal };
