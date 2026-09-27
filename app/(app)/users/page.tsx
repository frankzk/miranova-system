import { redirect } from "next/navigation";

// Usuarios ahora vive en Ajustes; se conserva esta ruta para enlaces anteriores.
export default function UsersRedirect() {
  redirect("/settings/users");
}
