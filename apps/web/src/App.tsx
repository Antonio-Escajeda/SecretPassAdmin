import CreateSecret from "./pages/CreateSecret";
import ViewSecret from "./pages/ViewSecret";

export default function App() {
  const { pathname } = window.location;

  if (pathname.startsWith("/s/")) {
    return <ViewSecret />;
  }

  return <CreateSecret />;
}
