import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OperationsPortal } from '@relayroom/ui';

createRoot(document.getElementById('root')!).render(<StrictMode><OperationsPortal kind="carrier"/></StrictMode>);
