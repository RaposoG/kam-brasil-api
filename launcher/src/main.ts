import { createApp } from "vue";

// Fontes empacotadas, não buscadas na rede: a CSP do Tauri é `default-src 'self'`
// e o Google Fonts seria bloqueado. O Vite embute os .woff2 no bundle.
import "@fontsource/cinzel/400.css";
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/600.css";
import "@fontsource/spectral/400-italic.css";

import "./theme.css";
import App from "./App.vue";

createApp(App).mount("#app");
