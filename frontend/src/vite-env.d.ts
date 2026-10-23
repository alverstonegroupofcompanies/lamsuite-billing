/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ADMIN_PORTAL_URL?: string;
  readonly VITE_DEFAULT_LAN_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
