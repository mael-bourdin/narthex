/// <reference types="vite/client" />
import type { NarthexApi } from "../../preload/index.ts";

declare global {
  interface Window {
    narthex: NarthexApi;
  }
}
