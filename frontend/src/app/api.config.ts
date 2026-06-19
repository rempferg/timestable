declare const ngDevMode: boolean | undefined;

const isDev = typeof ngDevMode === 'undefined' ? true : ngDevMode;

const devHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const devProtocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';

export const API_BASE_URL = isDev ? `${devProtocol}//${devHost}:8000/api` : '/api';
