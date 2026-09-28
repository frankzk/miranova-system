"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { finishUpload, removeMedia, saveCaption, startUpload } from "@/app/(app)/products/photo-actions";
import { IconCheck, IconCopy, IconDownload, IconPlay, IconShare, IconTrash, IconUpload } from "./icons";
import { downloadName, fmtBytes, MAX_FILES_PER_UPLOAD, MEDIA_ACCEPT, mediaProblem } from "@/lib/media-rules";
import "./media-panel.css";

export type PanelItem = {
  id: string;
  kind: "photo" | "video";
  content_type: string;
  size_bytes: number | null;
  caption: string | null;
  created_at: string;
  by: string | null;
};

const src = (id: string) => `/api/media/${id}`;
const dl = (id: string, name: string, n?: number) => `/api/media/${id}?dl=${encodeURIComponent(name)}${n ? `&n=${n}` : ""}`;

async function fileOf(id: string, name: string): Promise<File> {
  const res = await fetch(src(id));
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  return new File([blob], downloadName(name, blob.type), { type: blob.type });
}

/** PNG de la foto, que es lo que el portapapeles acepta en todos los navegadores. */
async function pngOf(id: string): Promise<Blob> {
  const res = await fetch(src(id));
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  if (blob.type === "image/png") return blob;
  const bmp = await createImageBitmap(blob);
  // hasta 4096 px por lado: suficiente para WhatsApp y evita portapapeles enormes
  const k = Math.min(1, 4096 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("png"))), "image/png"));
}

/** Subir un archivo al enlace firmado de Storage, con avance (fetch no informa el avance de subida). */
function put(url: string, file: File, type: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((ok, bad) => {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file.type === type ? file : new File([file], file.name, { type }));
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? ok() : bad(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => bad(new Error("red"));
    xhr.send(body);
  });
}

type Upload = { name: string; progress: number; error?: string; done?: boolean };

function Uploader({ mediaKey }: { mediaKey: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const busy = uploads.some((u) => !u.done && !u.error);

  async function send(files: File[]) {
    if (busy || !files.length) return;
    const list = files.slice(0, MAX_FILES_PER_UPLOAD);
    const state: Upload[] = list.map((f) => ({ name: f.name, progress: 0, error: mediaProblem(f.type, f.name, f.size) ?? undefined }));
    if (files.length > list.length) state.push({ name: `${files.length - list.length} más`, progress: 0, error: `Máximo ${MAX_FILES_PER_UPLOAD} archivos por vez.` });
    setUploads([...state]);
    const set = (i: number, u: Partial<Upload>) => {
      state[i] = { ...state[i], ...u };
      setUploads([...state]);
    };
    let any = false;
    for (let i = 0; i < list.length; i++) {
      if (state[i].error) continue;
      const f = list[i];
      try {
        const start = await startUpload(mediaKey, f.name, f.type, f.size);
        if (!start.ok) { set(i, { error: start.msg }); continue; }
        await put(start.url, f, start.type, (p) => set(i, { progress: p }));
        const fin = await finishUpload(mediaKey, start.path, f.name);
        if (!fin.ok) { set(i, { error: fin.msg }); continue; }
        set(i, { progress: 1, done: true });
        any = true;
      } catch {
        set(i, { error: `${f.name}: no se pudo subir. Revisa la conexión e inténtalo de nuevo.` });
      }
    }
    if (any) router.refresh();
    // se limpian solos los que salieron bien; los errores quedan a la vista
    setTimeout(() => setUploads((u) => u.filter((x) => !x.done)), 2500);
  }

  return (
    <div className="mp-upload">
      <div
        className="mp-drop"
        data-over={over || undefined}
        data-busy={busy || undefined}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(Array.from(e.dataTransfer.files)); }}
      >
        <IconUpload size={18} />
        <div className="grow">
          <b>{busy ? "Subiendo…" : "Subir fotos o videos"}</b>
          <span>Arrástralos aquí o elígelos · JPG, PNG, WEBP, MP4 o MOV hasta 50 MB</span>
        </div>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>Elegir archivos</button>
        <input
          ref={input}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          hidden
          onChange={(e) => { send(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
      </div>
      {uploads.length > 0 && (
        <ul className="mp-queue" aria-live="polite">
          {uploads.map((u, i) => (
            <li key={i} data-error={u.error ? true : undefined}>
              <span className="n">{u.error ?? u.name}</span>
              {!u.error && (u.done ? <IconCheck /> : <progress max={1} value={u.progress} aria-label={`Subiendo ${u.name}`} />)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Caption({ item, canEdit }: { item: PanelItem; canEdit: boolean }) {
  const [value, setValue] = useState(item.caption ?? "");
  const [saved, setSaved] = useState(item.caption ?? "");
  const [, start] = useTransition();
  if (!canEdit) return item.caption ? <p className="mp-cap">{item.caption}</p> : null;
  return (
    <input
      className="mp-cap-input"
      value={value}
      maxLength={200}
      placeholder="Nota (ej. frente, caja, uso)"
      aria-label="Nota de la foto"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() === saved.trim()) return;
        start(async () => {
          const r = await saveCaption(item.id, value);
          if (r.ok) setSaved(value);
        });
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Tile({ item, n, name, canEdit, canShare, onMsg }: { item: PanelItem; n: number; name: string; canEdit: boolean; canShare: boolean; onMsg: (m: string) => void }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const photo = item.kind === "photo";

  async function copy() {
    try {
      // la promesa va dentro de ClipboardItem para que Safari no pierda el gesto del clic
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(item.id) })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      onMsg("Foto copiada: pégala en WhatsApp o donde la necesites.");
    } catch {
      onMsg("Este navegador no dejó copiar la imagen. Usa Descargar.");
    }
  }

  async function share() {
    try {
      await navigator.share({ files: [await fileOf(item.id, `${name}-${n}`)] });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") onMsg("No se pudo compartir. Usa Descargar.");
    }
  }

  function remove() {
    if (!confirm(`¿Borrar ${photo ? "esta foto" : "este video"}? No se puede deshacer.`)) return;
    start(async () => {
      const r = await removeMedia(item.id);
      if (!r.ok) onMsg(r.msg);
      else router.refresh();
    });
  }

  return (
    <li className="mp-tile" data-pending={pending || undefined}>
      <a className="mp-thumb" href={src(item.id)} target="_blank" rel="noreferrer" title="Abrir en tamaño real">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src(item.id)} alt={item.caption ?? `Foto ${n} de ${name}`} loading="lazy" decoding="async" />
        ) : (
          <>
            <video src={`${src(item.id)}#t=0.1`} preload="metadata" muted playsInline />
            <span className="mp-play" aria-hidden><IconPlay size={14} /></span>
          </>
        )}
      </a>
      <div className="mp-meta">
        <span>{photo ? "Foto" : "Video"}{item.size_bytes ? ` · ${fmtBytes(item.size_bytes)}` : ""}</span>
        {item.by && <span title={new Date(item.created_at).toLocaleString("es")}>{item.by}</span>}
      </div>
      <Caption item={item} canEdit={canEdit} />
      <div className="mp-actions">
        {photo && (
          <button type="button" className="btn btn-sm" onClick={copy} title="Copiar la imagen para pegarla">
            {copied ? <IconCheck /> : <IconCopy />} {copied ? "Copiada" : "Copiar"}
          </button>
        )}
        <a className="btn btn-sm" href={dl(item.id, name, n)} download title="Descargar el archivo original">
          <IconDownload /> Descargar
        </a>
        {canShare && (
          <button type="button" className="btn btn-sm btn-icon" onClick={share} aria-label="Compartir" title="Compartir (WhatsApp, etc.)">
            <IconShare />
          </button>
        )}
        {canEdit && (
          <button type="button" className="btn btn-sm btn-icon btn-ghost mp-del" onClick={remove} disabled={pending} aria-label="Borrar" title="Borrar">
            <IconTrash />
          </button>
        )}
      </div>
    </li>
  );
}

/** Contenido del panel de un producto: fotos y videos, con copiar, descargar, compartir y subir. */
export function MediaPanel({ mediaKey, name, items, canEdit }: { mediaKey: string; name: string; items: PanelItem[]; canEdit: boolean }) {
  const [msg, setMsg] = useState("");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    try {
      setCanShare(!!navigator.canShare?.({ files: [new File([""], "x.jpg", { type: "image/jpeg" })] }) && matchMedia("(pointer: coarse)").matches);
    } catch {
      setCanShare(false);
    }
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  async function downloadAll() {
    for (let i = 0; i < items.length; i++) {
      const a = document.createElement("a");
      a.href = dl(items[i].id, name, i + 1);
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  const photos = items.filter((i) => i.kind === "photo").length;
  return (
    <div className="mp">
      {canEdit && <Uploader mediaKey={mediaKey} />}
      {items.length === 0 ? (
        <p className="mp-empty">{canEdit ? "Todavía no hay fotos reales de este producto. Sube las primeras arriba." : "Todavía no hay fotos reales de este producto."}</p>
      ) : (
        <>
          <div className="mp-head">
            <span>{photos} {photos === 1 ? "foto" : "fotos"}{items.length > photos ? ` · ${items.length - photos} ${items.length - photos === 1 ? "video" : "videos"}` : ""}</span>
            {items.length > 1 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={downloadAll}><IconDownload /> Descargar todo</button>
            )}
          </div>
          <ul className="mp-grid">
            {items.map((it, i) => (
              <Tile key={it.id} item={it} n={i + 1} name={name} canEdit={canEdit} canShare={canShare} onMsg={setMsg} />
            ))}
          </ul>
        </>
      )}
      <p className="mp-toast" role="status" aria-live="polite" data-show={msg ? true : undefined}>{msg}</p>
    </div>
  );
}
