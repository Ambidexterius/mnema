import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './main.tsx';
createRoot(document.getElementById('app')!).render(<App/>);
