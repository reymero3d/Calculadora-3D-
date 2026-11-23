/* Capa de compartir: usa el plugin nativo de Capacitor cuando está disponible,
   Web Share API en el navegador y cae a descarga/WhatsApp si no hay soporte. */
(function (global) {
  "use strict";

  function isNative() {
    const c = global.Capacitor;
    return !!(c && typeof c.isNativePlatform === "function" && c.isNativePlatform());
  }

  function plugin(name) {
    const c = global.Capacitor;
    if (!c) return null;
    if (c.Plugins && c.Plugins[name]) return c.Plugins[name];
    if (c[name]) return c[name];
    return null;
  }

  function notify(message) {
    if (typeof global.toast === "function") global.toast(message);
  }

  async function shareText(text, title) {
    const label = title || "Pedido Reymero3d";
    if (isNative()) {
      const share = plugin("Share");
      if (share && share.share) {
        try {
          await share.share({ title: label, text: text, dialogTitle: label });
          return true;
        } catch (e) {
          if (e && String(e.message || e).toLowerCase().includes("cancel")) return false;
        }
      }
    }
    if (global.navigator.share) {
      try {
        await global.navigator.share({ title: label, text: text });
        return true;
      } catch (e) {
        if (e && e.name === "AbortError") return false;
      }
    }
    try {
      if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
        await global.navigator.clipboard.writeText(text);
        notify("Texto copiado al portapapeles");
        return true;
      }
    } catch (e) {}
    return false;
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "").split(",")[1] || ""); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function shareFile(blob, filename, mime, text, title, fallbackMsg, url) {
    const label = title || "Reymero3d";
    const type = mime || blob.type || "application/octet-stream";
    const name = filename || "archivo";

    if (isNative()) {
      const share = plugin("Share");
      const fs = plugin("Filesystem");
      if (share && share.share && fs && fs.writeFile) {
        try {
          const base64 = await blobToBase64(blob);
          const res = await fs.writeFile({ path: name, data: base64, directory: "CACHE" });
          let uri = res && res.uri;
          if (fs.getUri) {
            try { const u = await fs.getUri({ path: name, directory: "CACHE" }); uri = u.uri || uri; }
            catch (e) {}
          }
          if (uri) {
            // No pasar url separado cuando hay archivos: en Android puede hacer que se comparta solo el link.
            const payload = { title: label, text: text, dialogTitle: label, files: [uri] };
            try {
              await share.share(payload);
              return true;
            } catch (e) {
              if (e && String(e.message || e).toLowerCase().includes("cancel")) return false;
              // Reintento solo con imagen; el texto/link puede pegarse manualmente en el estado.
              try {
                await share.share({ title: label, dialogTitle: label, files: [uri] });
                notify("Imagen compartida. Si falta el texto, pegá: " + (text || ""));
                return true;
              } catch (e2) {
                if (e2 && String(e2.message || e2).toLowerCase().includes("cancel")) return false;
              }
            }
          }
        } catch (e) {
          if (e && String(e.message || e).toLowerCase().includes("cancel")) return false;
        }
      }
    }

    if (global.navigator.share && global.navigator.canShare) {
      try {
        const file = new File([blob], name, { type: type });
        if (global.navigator.canShare({ files: [file] })) {
          // Omitir url separado al compartir archivos: mejora compatibilidad (WhatsApp/Android).
          const payload = { files: [file], title: label, text: text };
          try {
            await global.navigator.share(payload);
            return true;
          } catch (e) {
            if (e && e.name === "AbortError") return false;
            // Reintentar sin texto extra si el objetivo no lo acepta
            try {
              await global.navigator.share({ files: [file], title: label });
              return true;
            } catch (e2) {
              if (e2 && e2.name === "AbortError") return false;
            }
          }
        }
      } catch (e) {
        if (e && e.name === "AbortError") return false;
      }
    }

    download(blob, name);
    notify(fallbackMsg || "Archivo descargado. Podés compartirlo desde tu app.");
    return false;
  }

  async function sharePdf(blob, filename, text, title) {
    return shareFile(blob, filename, "application/pdf", text, title || "Comprobante Reymero3d", "PDF descargado. Podés adjuntarlo desde tu app de WhatsApp.");
  }

  global.ReymeroShare = Object.freeze({
    isNative: isNative,
    shareText: shareText,
    shareFile: shareFile,
    sharePdf: sharePdf,
    download: download
  });
})(window);
