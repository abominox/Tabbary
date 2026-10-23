import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';

const rootEl = document.getElementById('app-root');
if (!rootEl) throw new Error('Missing #app-root element');

const surface = rootEl.dataset.surface ?? 'side-panel';

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App surface={surface} />
  </React.StrictMode>,
);