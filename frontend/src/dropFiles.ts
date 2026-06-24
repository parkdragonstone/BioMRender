// Extract .c3d / .trc files from a drag-and-drop, supporting dropped folders
// (recursed via the webkitGetAsEntry filesystem API). Where the browser exposes
// a writable FileSystemFileHandle (Chrome/Edge, top-level dropped files), we keep
// it so Save can overwrite the original file in place.

export interface DroppedItem {
  file: File
  handle?: FileSystemFileHandle   // present only for top-level files in supporting browsers
}

export async function filesFromDrop(dt: DataTransfer): Promise<DroppedItem[]> {
  const items = dt.items ? Array.from(dt.items) : []
  const supportsEntries = items.length > 0 && typeof (items[0] as any).webkitGetAsEntry === 'function'

  const out: DroppedItem[] = []

  if (supportsEntries) {
    // entries + handles must be grabbed synchronously while the event is alive
    const grabbed = items.map((it) => ({
      entry: (it as any).webkitGetAsEntry?.() as FileSystemEntry | null,
      handle: typeof (it as any).getAsFileSystemHandle === 'function'
        ? ((it as any).getAsFileSystemHandle() as Promise<FileSystemHandle>)
        : null,
      file: it.getAsFile(),
    }))
    for (const g of grabbed) {
      if (g.entry?.isFile) {
        const h = g.handle ? await g.handle.catch(() => null) : null
        const handle = h && h.kind === 'file' ? (h as FileSystemFileHandle) : undefined
        const files: File[] = []
        await walkEntry(g.entry, files)
        for (const f of files) out.push({ file: f, handle })
      } else if (g.entry?.isDirectory) {
        const files: File[] = []
        await walkEntry(g.entry, files)
        for (const f of files) out.push({ file: f })   // nested folder files: no handle
      } else if (g.file) {
        out.push({ file: g.file })
      }
    }
  } else {
    for (const f of Array.from(dt.files || [])) out.push({ file: f })
  }

  return out.filter((r) => /\.(c3d|trc)$/i.test(r.file.name))
}

function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(
        (f) => { out.push(f); resolve() },
        () => resolve(),
      )
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const all: FileSystemEntry[] = []
      const readBatch = () => reader.readEntries(
        async (batch) => {
          if (batch.length) { all.push(...batch); readBatch() }
          else { for (const c of all) await walkEntry(c, out); resolve() }
        },
        () => resolve(),
      )
      readBatch()
    } else resolve()
  })
}
