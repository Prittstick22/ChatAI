/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chat API base URL, e.g. http://192.168.1.20:8000. Defaults to this page's host on port 8000. */
  readonly VITE_CHAT_API_URL?: string;
}
