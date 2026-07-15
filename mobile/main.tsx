import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BoardApp } from "../app/components/board/BoardApp";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BoardApp />
  </StrictMode>,
);
