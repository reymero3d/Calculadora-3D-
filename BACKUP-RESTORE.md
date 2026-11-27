# Backup / Restore — Reymero 3D (pre-migración Cloudflare)

## Estado respaldado

- **Repositorio:** `https://github.com/reymero3d/Calculadora-3D-`
- **Rama original:** `main`
- **Commit respaldado:** `099d26d` (Auditoría responsive/a11y tienda y modales)
- **Fecha de backup:** 2026-11-27
- **Alcance:** copia completa del directorio `calculadora-3d` en su estado original, incluyendo `.git`, HTML/CSS/JS, assets, `supabase/*.sql`, `products.json`, `config.js` y archivos de configuración del repo. Se excluyó `backups/` para evitar recursión.

## Ubicación del backup

- **ZIP local (fuera de la carpeta de trabajo):**
  `C:\Users\Esteban\AppData\Local\Temp\opencode\reymero3d-backup-20261127\calculadora-3d-pre-migration.zip`

> Nota: este backup es local. No contiene claves privadas/service_role añadidas por la migración; `config.js` ya incluye la publishable/anon key pública del frontend existente en el repo original. No copiar este ZIP a ubicaciones públicas.

## Verificación del backup

Verificado al crearlo:

- El ZIP se puede leer.
- Contiene archivos originales clave: `index.html`, `tienda.html`, `producto.html`, `productos.html`, `pedidos.html`, `cart.js`, `config.js`.
- Contiene `.git/HEAD` e historial Git.
- Contiene `supabase/001_orders_checkout_proposal.sql`, `002...`, `003...`.

Para verificar nuevamente:

```powershell
tar -t -f "C:\Users\Esteban\AppData\Local\Temp\opencode\reymero3d-backup-20261127\calculadora-3d-pre-migration.zip" | findstr /B "index.html tienda.html .git/HEAD supabase/001"
```

## Restauración completa (recomendada)

Usar esta opción para volver exactamente al estado previo a la migración.

1. Cerrar procesos que puedan bloquear archivos en la carpeta del repo.
2. Elegir una carpeta destino vacía o renombrar la carpeta actual como respaldo adicional.
3. Extraer el ZIP:

```powershell
$zip = "C:\Users\Esteban\AppData\Local\Temp\opencode\reymero3d-backup-20261127\calculadora-3d-pre-migration.zip"
$dest = "C:\Users\Esteban\Documents\Proyecto predeterminado\calculadora-3d-restaurado"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
tar -x -f $zip -C $dest
```

4. Verificar Git:

```powershell
cd "C:\Users\Esteban\Documents\Proyecto predeterminado\calculadora-3d-restaurado"
git status
git log --oneline -5
```

5. Si la restauración es correcta, reemplazar la carpeta de trabajo por la restaurada (manteniendo una copia de seguridad del intento de migración si hace falta auditarlo).

## Restauración solo Git (si el repo local sigue intacto)

```powershell
cd "C:\Users\Esteban\Documents\Proyecto predeterminado\calculadora-3d"
git fetch origin
git checkout main
git reset --hard 099d26d
git clean -fd -e backups/
```

Esto revierte el código al commit respaldado. No borra datos de Supabase. No toca Cloudflare/DNS externos.

## Restauración de despliegue

- **GitHub Pages** no debe ser eliminado ni sobrescrito destructivamente durante la migración. Si Cloudflare Pages falla, el dominio personalizado debe apuntarse de vuelta al estado DNS anterior por el propietario DNS/Cloudflare; el contenido original sigue en `main`/GitHub Pages.
- **Cloudflare Pages:** se puede desasociar el dominio personalizado `tienda.reymero3d.com` del proyecto Pages y volver a la URL anterior. No eliminar el proyecto hasta confirmar la restauración.
- **Supabase:** no se realizan migraciones destructivas. Si se agregaron URLs de redirect permitidas, se pueden quitar manualmente desde el panel de Supabase Auth; no hay cambios de esquema/RLS/datos previstos.

## Qué NO restaura este backup

- Cambios externos realizados en Cloudflare Dashboard/DNS/Auth.
- Datos nuevos creados en Supabase después del backup (pedidos/usuarios reales no deben borrarse).
- La APK instalada en dispositivos; la APK no debe verse afectada por esta migración.

## Regla de seguridad

Si aparece un problema crítico durante la migración: detener el despliegue, no borrar `main`, no ejecutar SQL destructivo, y restaurar usando este documento.