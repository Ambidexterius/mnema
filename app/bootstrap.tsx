import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './main.tsx';
import './mnemonika-design.css';
createRoot(document.getElementById('app')!).render(<App/>);
