import { createCreateSecretPage } from "./pages/CreateSecret.js";
import { createViewSecretPage } from "./pages/ViewSecret.js";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

if (window.location.pathname.startsWith("/s/")) {
  root.appendChild(createViewSecretPage());
} else {
  root.appendChild(createCreateSecretPage());
}
