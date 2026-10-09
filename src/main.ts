import './style.css';
import { App } from './ui/app';

const app = new App();
if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
