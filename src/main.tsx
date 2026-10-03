import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/features.css';
import './styles/features/accounts.css';
import './styles/features/payments.css';
import './styles/features/cards.css';
import './styles/features/docs.css';
import './styles/features/growth.css';
import './styles/features/services.css';
import './styles/features/staff.css';
import './styles/features/personal.css';
import './styles/print.css';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
