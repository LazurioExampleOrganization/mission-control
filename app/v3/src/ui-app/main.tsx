import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter-tight';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import App from './App.tsx';
import './index.css';
import '../instance/theme.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
