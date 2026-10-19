import { render } from 'preact';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);
