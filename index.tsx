
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

console.log("index.tsx: Bootstrapping React application...");

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error("index.tsx: Root element not found!");
  throw new Error("Could not find root element to mount to");
}

console.log("index.tsx: Root element found, creating React root...");
const root = ReactDOM.createRoot(rootElement);
const renderApp = () => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  console.log("index.tsx: React render called.");
};

if ((window as any).Holistic) {
  renderApp();
} else {
  console.log("index.tsx: Waiting for MediaPipe to load offline...");
  window.addEventListener('mediapipe_loaded', renderApp, { once: true });
}
