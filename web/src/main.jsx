import {Component, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app.jsx';
import {createReaderStore} from './reader-store.mjs';
import {site} from './site-config.mjs';
import './style.css';
import './loading.css';

class ReaderErrorBoundary extends Component {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {
    return this.state.failed ? <main><h1>The reader could not display your library.</h1><p>Your browser’s stored library has not been cleared. Reload the page to try again.</p><a href="./">Reload reader</a></main> : this.props.children;
  }
}

const store = createReaderStore(site);
const navigationPosition = {current: null};
const root = createRoot(document.querySelector('#root'));
root.render(<StrictMode><ReaderErrorBoundary><App store={store} site={site} navigationPosition={navigationPosition}/></ReaderErrorBoundary></StrictMode>);
// Application IO starts once, outside React's repeatable render/effect lifecycle.
store.getState().start({onNavigate: (route, y) => {navigationPosition.current = {route, y};}});
if (import.meta.hot) import.meta.hot.dispose(() => {store.getState().destroy(); root.unmount();});
