import {messages} from './localization.mjs';
import {Component, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app.jsx';
import {createReaderStore} from './reader-store.mjs';
import {createBrowserReaderServices} from './reader-services.mjs';
import {site} from './site-config.mjs';
import './style.css';
import './loading.css';

class ReaderErrorBoundary extends Component {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {
    return this.state.failed ? <main><h1>{messages.startup.renderError}</h1><p>{messages.startup.reloadHint}</p><a href="./">{messages.startup.reloadReader}</a></main> : this.props.children;
  }
}

const store = createReaderStore(site, createBrowserReaderServices(site));
const navigationPosition = {current: null};
const root = createRoot(document.querySelector('#root'));
root.render(<StrictMode><ReaderErrorBoundary><App store={store} site={site} navigationPosition={navigationPosition}/></ReaderErrorBoundary></StrictMode>);
// Application IO starts once, outside React's repeatable render/effect lifecycle.
store.getState().start({onNavigate: (route, y) => {navigationPosition.current = {route, y};}});
if (import.meta.hot) import.meta.hot.dispose(() => {store.getState().destroy(); root.unmount();});
