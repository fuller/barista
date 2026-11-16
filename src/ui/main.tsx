import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {QueryClientProvider} from '@tanstack/react-query';
import {catalogQueryClient} from './catalog-query';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={catalogQueryClient}><App/></QueryClientProvider></React.StrictMode>);
