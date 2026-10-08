"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useSheet } from "./side-sheet";
import { SubmitButton } from "./submit-button";
import { MIN_PASSWORD, PERMISSIONS, type Permission } from "@/lib/permissions";

export type FormState = { ok: boolean; msg: string } | null;
type Action = (prev: FormState, form: FormData) => Promise<FormState>;

function Msg({ state }: { state: FormState }) {
  if (!state) return null;
  return <p className="fu-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

/** Contraseña legible para compartir: sin caracteres que se confunden (0/O, 1/l). */
function generatePassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** Campo de contraseña temporal con botón para generarla (queda visible para copiarla). */
function TempPassword({ label = "Contraseña temporal" }: { label?: string }) {
  const [value, setValue] = useState("");
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <span className="hint">mínimo {MIN_PASSWORD}; la cambiará al entrar</span>
      </label>
      <div className="uf-pass">
        <input
          id={id}
          className="input"
          name="password"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
          spellCheck={false}
        />
        <button type="button" className="btn" onClick={() => setValue(generatePassword())}>Generar</button>
      </div>
    </div>
  );
}

/** Casillas de permisos. Las que el administrador no puede otorgar quedan como están, sin editar. */
function PermissionChecks({ value, lockedPerms, allLocked }: { value: readonly string[]; lockedPerms: readonly Permission[]; allLocked?: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set(value));
  const toggle = (k: string, on: boolean) => {
    const next = new Set(sel);
    if (on) next.add(k);
    else next.delete(k);
    // editar tiendas incluye verlas
    if (k === "stores_edit" && on) next.add("stores");
    if (k === "stores" && !on) next.delete("stores_edit");
    if (k === "photos" && on) next.add("products");
    if (k === "products" && !on) next.delete("photos");
    setSel(next);
  };
  return (
    <fieldset className="uf-perms" disabled={allLocked}>
      <legend>Qué puede ver y hacer</legend>
      {PERMISSIONS.map((p) => {
        const locked = lockedPerms.includes(p.key);
        return (
          <label key={p.key} className="uf-perm" data-locked={locked || undefined}>
            <input type="checkbox" name="perm" value={p.key} checked={sel.has(p.key)} disabled={locked} onChange={(e) => toggle(p.key, e.target.checked)} />
            <span className="t">{p.label}</span>
            <span className="h">{locked ? "Solo quien tiene este permiso puede darlo o quitarlo" : p.hint}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Nuevo usuario: nombre, usuario, contraseña temporal y permisos. */
export function NewUserForm({ action, lockedPerms, canMakeOwner, canMail = false }: { action: Action; lockedPerms: Permission[]; canMakeOwner: boolean; canMail?: boolean }) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  useEffect(() => {
    if (state?.ok) {
      const t = setTimeout(() => sheet?.close(), 2500);
      return () => clearTimeout(t);
    }
  }, [state, sheet]);
  return (
    <form action={run} className="uf-form">
      <div className="ct-row">
        <label className="field">
          <span>Nombre</span>
          <input className="input" name="name" required maxLength={80} autoComplete="off" />
        </label>
        <label className="field">
          <span>Usuario <span className="hint">para entrar</span></span>
          <input className="input" name="username" required pattern="[a-z0-9._+@\-]{3,80}" autoCapitalize="none" spellCheck={false} autoComplete="off" placeholder="ej. andrea o su correo" />
        </label>
      </div>
      <TempPassword />
      {canMail && <MailCheck label="Enviarle su acceso por correo" hint="Solo si su usuario es un correo." />}
      {canMakeOwner && <OwnerCheck defaultChecked={false} />}
      <PermissionChecks value={["stores", "products", "opportunities", "orders"]} lockedPerms={lockedPerms} />
      <div className="fu-actions">
        <Msg state={state} />
        <SubmitButton className="btn btn-primary" pending="Creando…">Crear usuario</SubmitButton>
      </div>
    </form>
  );
}

function OwnerCheck({ defaultChecked, disabled }: { defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className="uf-perm uf-owner">
      <input type="checkbox" name="is_owner" defaultChecked={defaultChecked} disabled={disabled} />
      <span className="t">Dueño</span>
      <span className="h">Todos los permisos, incluidos los que se agreguen después. Solo un dueño puede editar a otro dueño.</span>
    </label>
  );
}

export type EditableUser = { id: string; name: string; username: string; permissions: string[]; is_owner: boolean; active: boolean };

/** Editar nombre, permisos, rol de dueño y si está activo. */
export function EditUserForm({
  action, user, lockedPerms, canMakeOwner, self,
}: { action: Action; user: EditableUser; lockedPerms: Permission[]; canMakeOwner: boolean; self: boolean }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="uf-form">
      <input type="hidden" name="id" value={user.id} />
      <label className="field">
        <span>Nombre</span>
        <input className="input" name="name" required maxLength={80} defaultValue={user.name} autoComplete="off" />
      </label>
      <label className="uf-perm uf-active">
        <input type="checkbox" name="active" defaultChecked={user.active} disabled={self} />
        <span className="t">Activo</span>
        <span className="h">{self ? "No puedes desactivar tu propio usuario" : "Desactivado, no puede entrar y se cierran sus sesiones"}</span>
      </label>
      {self && <input type="hidden" name="active" value="on" />}
      {canMakeOwner ? <OwnerCheck defaultChecked={user.is_owner} /> : user.is_owner && <input type="hidden" name="is_owner" value="on" />}
      <PermissionChecks value={user.is_owner ? PERMISSIONS.map((p) => p.key) : user.permissions} lockedPerms={lockedPerms} />
      <div className="fu-actions">
        <Msg state={state} />
        <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar cambios</SubmitButton>
      </div>
    </form>
  );
}

/** Casilla para enviar la contraseña temporal por correo (Ajustes → Correo). */
function MailCheck({ label, hint }: { label: string; hint: string }) {
  return (
    <label className="uf-perm">
      <input type="checkbox" name="send_email" defaultChecked />
      <span className="t">{label}</span>
      <span className="h">{hint}</span>
    </label>
  );
}

/** Restablecer la contraseña de otro usuario (queda como temporal). `mailTo`: su correo, si se le puede enviar. */
export function ResetPasswordForm({ action, userId, mailTo }: { action: Action; userId: string; mailTo?: string | null }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="uf-form">
      <input type="hidden" name="id" value={userId} />
      <TempPassword label="Nueva contraseña temporal" />
      {mailTo && <MailCheck label={`Enviársela por correo a ${mailTo}`} hint="Le llega con el enlace para entrar; al entrar deberá cambiarla." />}
      <div className="fu-actions">
        <Msg state={state} />
        <SubmitButton className="btn" pending="Guardando…">Restablecer contraseña</SubmitButton>
      </div>
    </form>
  );
}

/** Mi cuenta: cambiar la contraseña propia. */
export function ChangePasswordForm({ action, first }: { action: Action; first: boolean }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="uf-form">
      <label className="field">
        <span>{first ? "Contraseña temporal" : "Contraseña actual"}</span>
        <input className="input" name="current" type="password" required autoComplete="current-password" />
      </label>
      <div className="ct-row">
        <label className="field">
          <span>Nueva contraseña <span className="hint">mínimo {MIN_PASSWORD}</span></span>
          <input className="input" name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>Repite la nueva</span>
          <input className="input" name="confirm" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
        </label>
      </div>
      <div className="fu-actions">
        <Msg state={state} />
        <SubmitButton className="btn btn-primary" pending="Guardando…">Cambiar contraseña</SubmitButton>
      </div>
    </form>
  );
}

/** Mi cuenta: cerrar la sesión en los demás dispositivos. */
export function CloseSessionsButton({ action }: { action: (prev: FormState) => Promise<FormState> }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="uf-inline">
      <SubmitButton className="btn" pending="Cerrando…">Cerrar sesión en otros dispositivos</SubmitButton>
      <Msg state={state} />
    </form>
  );
}
