import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CatalogPage from './CatalogPage';
import './styles.css';

const isCatalog = /^\/catalogo(?:\/|$)/i.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isCatalog ? <CatalogPage /> : <App />}
  </React.StrictMode>
);
