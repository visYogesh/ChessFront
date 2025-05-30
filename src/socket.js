import { io } from "socket.io-client";

const backendURL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
const socket = io(backendURL, {
  transports: ['websocket'] // Optional: forces websocket transport
});
