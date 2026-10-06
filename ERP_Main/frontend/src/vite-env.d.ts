/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_CONTROL_PLANE_URL?: string;
  readonly VITE_CONTROL_PLANE_API_URL?: string;
  readonly VITE_CENTRAL_AUTH_API?: string;
  readonly VITE_COOKIE_DOMAIN?: string;
  readonly VITE_YINGLIMA_URL?: string;
  readonly VITE_YINGLIMA_API_URL?: string;
  readonly VITE_INHYMA_URL?: string;
  readonly VITE_INHYMA_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
